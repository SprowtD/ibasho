// Any project made in the app: script.json + board.json (+ drawn art) -> spec.json, the file the editor opens.
// Usage: node tools/build_spec.mjs <project dir>
//   project.json { name, chapter, reading?: "rtl" | "ltr" }   reading direction: right to left (manga) or left to right (comic).
//     The series settings (bible.json "reading") win when they say; a project with neither reads left to right, as every
//     chapter made before 19 Nov 2026 does. The choice is written to spec.reading and to every page's layout (layout.rtl).
//   script.json  { title?, beats: [{ id, type: "scene"|"action"|"line", speaker?, text, paren? }] }   (line ids like L001)
//   board.json   { cast: [{name, desc}], pages: [{ note, panels: [ panel, … ] }  |  { note, rows: [{ h, panels: [ panel | { w, rows } ] }] }] }
//     panel = { job?, weight?, shot, angle?, bg?, action, who?: [{name, at:[x,y], size, facing}], lines?: [{id, kind?, parts?, off?}], note?, art?, face?, reveal?, splash?, w? }
//     A page given as a flat list of `panels` (in reading order) is laid out here by the panel director (core/director.js):
//     the layout is picked from the templates by the panels' weights. A page given as `rows` keeps its hand-made layout.
// Lines are always taken word for word from script.json: the board only says where each one goes.
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("../page-editor/render.js"); const R = globalThis.PageRender, Director = require("../core/director.js");
const dir = path.resolve(process.argv[2]), APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (f, d) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) : d);
const meta = read("project.json", {}), script = read("script.json", { beats: [] }), board = read("board.json", { pages: [] });
const norm = (s) => String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
// In a book, speech broken by "said Mara" ends in a comma inside the quotation marks; on the page that balloon ends in a full stop.
const lettered = (t) => (meta.series && /,$/.test(String(t).trim()) ? String(t).trim().slice(0, -1) + "." : t);
const beats = script.beats.map((b) => (b.type === "line" ? { ...b, source_id: b.id, printed: b.text, text: lettered(b.text) } : b));
const byId = new Map(beats.filter((b) => b.type === "line").map((b) => [b.id, b]));
const warn = [];
// which way the pages read: the series settings first (a book's chapters share the book's choice), then the project's own
let reading = meta.reading === "rtl" ? "rtl" : "ltr";
try { const b = JSON.parse(fs.readFileSync(path.join(dir, "bible.json"), "utf8")); if (b.reading === "rtl" || b.reading === "ltr") reading = b.reading; } catch { /* no series settings yet */ }
const rtl = reading === "rtl";
const KIND = new Set(["speech", "shout", "whisper", "thought", "caption", "ambient", "crowd", "phone", "title"]);
const num = (v, d, lo, hi) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);

const templates = JSON.parse(fs.readFileSync(path.join(APP, "page-editor/templates.json"), "utf8")); // the page layouts every project starts with
function panel(q) {
  if (Array.isArray(q.rows) && q.rows.length) return { w: num(q.w, 1, 0.05, 20), rows: q.rows.map(row) };
  const lines = [];
  for (const l of q.lines || []) {
    const b = byId.get(l.id || l.source_id);
    if (!b) { warn.push(`unknown line ${l.id}`); continue; }
    let parts = Array.isArray(l.parts) && l.parts.length > 1 ? l.parts.map(String) : [b.text];
    if (norm(parts.join(" ")) !== norm(b.text) && norm(parts.join(" ")) !== norm(b.printed || b.text)) { warn.push(`${b.id}: split did not match the script, kept whole`); parts = [b.text]; }
    parts[parts.length - 1] = lettered(parts[parts.length - 1]);
    for (const t of parts) {
      const d = { source_id: b.id, speaker: b.speaker || "", kind: KIND.has(l.kind) ? l.kind : "speech", text: t };
      if (b.src) d.src = String(b.src);
      if (parts.length > 1) d.join = true;
      if (l.off) d.off = true;
      if (l.bridge && parts.length === 1) d.bridge = true; // the balloon sits on the border to the next panel
      lines.push(d);
    }
  }
  const who = (q.who || []).filter((w) => w && w.name).map((w) => ({ name: String(w.name), at: [num(w.at && w.at[0], 0.5, 0.05, 0.95), num(w.at && w.at[1], 0.45, 0.05, 0.95)],
    size: ["close", "medium", "wide", "tiny"].includes(w.size) ? w.size : "medium", facing: ["left", "right", "camera", "away", "up", "down"].includes(w.facing) ? w.facing : "camera" }));
  const b = { shot: String(q.shot || "medium"), angle: String(q.angle || "eye level"), action: String(q.action || ""), who, bg: ["full", "simple", "tone", "white"].includes(q.bg) ? q.bg : "simple", lines };
  if (Director.JOBS[q.job]) b.job = q.job; // what the panel is for, and how much of the page it should own (core/director.js)
  if (Number.isFinite(+q.weight) && +q.weight > 0) b.weight = Math.min(5, Math.max(1, Math.round(+q.weight)));
  if (q.face === "big") b.face = "big"; // the one big expression of its page
  if (q.reveal === true) b.reveal = true; // the surprise: belongs first on its page
  if (q.splash === true) b.splash = true;
  if (q.note) b.note = String(q.note);
  if (q.art) b.art = String(q.art);
  if (Array.isArray(q.src) && q.src.length) b.src = q.src.map(String);
  if (q.breakout && String(q.breakout).trim()) b.breakout = String(q.breakout).trim().slice(0, 300); // what should stand above this panel's borders: offered in Layout as a break-out to add
  return { w: num(q.w, 1, 0.05, 20), type: "framed", board: b };
}
function row(r) { return { h: num(r.h, 1, 0.05, 20), panels: (r.panels || []).map(panel) }; }

const spec = { project: meta.name || "Untitled", chapter: meta.chapter || 1, kind: "storyboard", reading, voices: {}, styles: {}, library: [], templates,
  script: beats.map((b) => { const o = {}; for (const k of ["id", "type", "speaker", "text", "source_id", "paren", "src"]) if (b[k] != null) o[k] = b[k]; return o; }), pages: [] };
// when the storyboard itself is replaced, the editor starts the pages fresh instead of laying old saved pages over it
spec.boardAt = fs.existsSync(path.join(dir, "board.json")) ? fs.statSync(path.join(dir, "board.json")).mtime.toISOString() : "";
const src = board.pages.length ? board.pages : [{ note: "", rows: [{ h: 1, panels: [{ w: 1, shot: "wide", action: "" }] }] }]; // an empty project still opens
// Hard limits on a page (the same numbers as core/paneler.js LIMITS and the Paneler's task): a storyboard over them is sent back.
const LIMITS = { panels: 6, lines: 5, words: 70 }, faults = [], seenLine = new Map();
let prevShapes = []; const directed = [];
src.forEach((pg, i) => {
  const nn = String(i + 1).padStart(2, "0");
  let rows;
  if (!Array.isArray(pg.rows) && Array.isArray(pg.panels) && pg.panels.length) { // a flat list: the director picks the layout by weight, never the same as the page before
    const got = Director.layout(pg.panels.map(panel), templates, R, { avoid: prevShapes });
    rows = got.rows; directed.push(`${i + 1}:${got.code}`);
  } else rows = (pg.rows || []).map(row).filter((r) => r.panels.length);
  prevShapes = [Director.shape(rows)];
  let n = 0; const said = new Set(); let words = 0;
  const ids = (rs) => { for (const r of rs) for (const q of r.panels) { if (q.rows) { ids(q.rows); continue; } q.id = `b${nn}-n${++n}`;
    if (q.board.lines.length > 3 && new Set(q.board.lines.map((l) => l.source_id)).size > 3) faults.push(`Page ${i + 1}, panel ${n}: more than 3 balloons in one panel.`);
    for (const l of q.board.lines) { if (!seenLine.has(l.source_id)) seenLine.set(l.source_id, i + 1); if (l.kind === "title") continue; said.add(l.source_id); words += norm(l.text).split(" ").filter(Boolean).length; if (!seenLine.has(l.source_id)) seenLine.set(l.source_id, i + 1); } } };
  ids(rows);
  if (board.pages.length) {
    if (n > LIMITS.panels) faults.push(`Page ${i + 1} has ${n} panels (the limit is ${LIMITS.panels}).`);
    if (said.size > LIMITS.lines) faults.push(`Page ${i + 1} has ${said.size} spoken lines (the limit is ${LIMITS.lines}).`);
    if (words > LIMITS.words) faults.push(`Page ${i + 1} has ${words} lettered words (the limit is ${LIMITS.words}).`);
  }
  spec.pages.push({ id: `board-p${nn}`, number: i + 1, label: `Page ${i + 1}`, note: String(pg.note || ""), layout: rtl ? { rtl: true, rows } : { rows }, text: [] });
});
// a cover the person asked for (cover.json, kept through "Storyboard again"): one full-page picture with the title lettered on it
const cover = read("cover.json", null);
if (cover && String(cover.action || "").trim()) {
  const rev = cover.rev || 1;
  spec.pages.unshift({ id: `board-cover-${rev}`, number: 0, label: "Cover", note: "The cover.", cover: true, text: [], layout: { rows: [{ h: 1, panels: [{ w: 1, type: "bleed", id: `cover-${rev}-n1`,
    board: { shot: "cover", angle: "eye level", action: String(cover.action).trim(), who: [], bg: "full", lines: cover.title ? [{ source_id: "COVER", speaker: "", kind: "title", text: String(cover.title) }] : [] } }] }] } });
}
// drawn art (tools/artist_panel.py): each picture goes to its panel
const lib = read("art/library.json", null), assign = read("art/assignments.json", {});
if (lib) {
  spec.library = lib;
  const put = (rs) => { for (const r of rs) for (const q of r.panels) { if (q.rows) put(q.rows); else if (assign[q.id]) Object.assign(q, assign[q.id]); } };
  for (const pg of spec.pages) put(pg.layout.rows);
}
// a chapter of a book: the numbered paragraphs travel with the pages, and every lettered line must sit in its paragraph word for word
if (meta.series && fs.existsSync(path.join(dir, "script.md"))) {
  const source = {}; for (const m of fs.readFileSync(path.join(dir, "script.md"), "utf8").matchAll(/^\[([^\]\n]+)\] (.*)$/gm)) source[m[1]] = m[2];
  spec.book = meta.series; spec.source = source;
  const flat = (t) => norm(t).replace(/[\u2013\u2014]/g, "-").toLowerCase();
  for (const b of beats) if (b.type === "line") {
    if (!b.src || !source[b.src]) faults.push(`Line ${b.id} (“${b.text.slice(0, 40)}”) does not say which paragraph of the book it comes from.`);
    else if (!flat(source[b.src]).includes(flat(b.printed).replace(/,$/, ""))) faults.push(`Line ${b.id} is not word for word from the book (${b.src.split(":").pop()}): “${b.text.slice(0, 60)}”.`);
  }
}
if (spec.book) { // what the book check found (tools/book_board.mjs) and what is found here, for the Chapter screen
  let found = []; try { found = JSON.parse(fs.readFileSync(path.join(dir, "sections", "faults.json"), "utf8")); } catch { /* not storyboarded by the book tool */ }
  spec.bookFaults = found.concat(faults.filter((f) => /word for word from the book|which paragraph/.test(f)));
}
fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify(spec, null, 1));
// the series bible the Artist writes prompts from: a default look, plus the cast the Paneler found
const bibleFile = path.join(dir, "bible.json");
const bible = fs.existsSync(bibleFile) ? JSON.parse(fs.readFileSync(bibleFile, "utf8")) : JSON.parse(fs.readFileSync(path.join(APP, "core/default-bible.json"), "utf8"));
bible.project = spec.project; bible.cast = bible.cast || {};
if (!bible.reading && (meta.reading === "rtl" || meta.reading === "ltr")) bible.reading = reading; // the series remembers its direction, so its next chapters read the same way (older series have none: left to right)
for (const c of board.cast || []) if (c && c.name && !bible.cast[c.name]) bible.cast[c.name] = { desc: String(c.desc || `${String(c.name).toUpperCase()}: as described in the panel.`) };
fs.writeFileSync(bibleFile, JSON.stringify(bible, null, 1));
if (board.pages.length) for (const id of byId.keys()) if (!seenLine.has(id)) faults.push(`Line ${id} is missing from the pages.`);
console.log(JSON.stringify({ pages: spec.pages.length, lines: byId.size, warnings: warn, faults, directed }));
