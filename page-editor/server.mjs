// Local studio server for the page editor: serves the editor and saves edits/exports to disk.
// Usage: node server.mjs [port]   then open http://localhost:5178
import http from "node:http";
import { readFile, writeFile, mkdir, stat, readdir, rm, copyFile, symlink, realpath, rename } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { anime, animeDraw, useQueue } from "../anime/server.mjs"; // the anime side (anime/README.md)
import { connections } from "./connections.mjs"; // sign-ins and API keys (Settings > Connections)
import { models, routeModel, estimate, refreshIfOld } from "./models.mjs";
import { gpuPricesRoute } from "./gpu_prices.mjs"; // live GPU prices (RunPod, Vast.ai)
import { spend, logSpend, guardSpend, okFrom } from "./spend.mjs";
import { readBody, MB, KB } from "./limits.mjs";
import { codexRun, codexLook, jsonFrom, dataFile, DATA_RULE } from "./codex.mjs"; // untrusted text as data files; look-only jobs read-only // how much each route may be sent
import { inside, reserved } from "./paths.mjs";
import { lockDoc, writeAtomic, writeJson, updateJson } from "./store.mjs"; // one change at a time per document, written whole (audit item 11) // saved paths stay inside their folder; names that would reach every object
import { gate, accessCode } from "./access.mjs"; // who may talk to this app: this computer, and devices that typed the access code
import { create, runCreate, abandonCreate } from "./create.mjs";
import { assistant } from "./assistant.mjs";
import { work, expectFor, recordDone, recordDropped } from "./work.mjs"; // the "Working on" list: progress, history, usual times // the Assistant: a chat that can do the app's own actions // the Create space: a picture or a video from any model // what paid jobs cost, the monthly cap // the model picker: which model each kind of job uses
import { orPicture, orText } from "./openrouter.mjs"; // OpenRouter calls (writing, pictures; video is on the anime side)

const ROOT = dirname(fileURLToPath(import.meta.url));
const SAVED = process.env.STUDIO_SAVED || join(ROOT, "saved"); // tests point this elsewhere: saved/ holds real work
// A chapter's saved edits live beside the app's own settings files in saved/. Only a real project's name is ever turned into a file
// here: before 19 Nov 2026, p=connections returned the keys file and p=spend-settings could be overwritten.
const NOT_CHAPTERS = new Set(["connections", "models", "queue", "permissions", "spend-settings", "work", "work-times", "styles", "access"]);
const specFile = (url) => {
  const id = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_");
  if (NOT_CHAPTERS.has(id) || !(existsSync(join(ROOT, "projects", id, "spec.json")) || existsSync(join(ROOT, "samples", id, "spec.json")))) throw Object.assign(new Error("No such project."), { code: 404 });
  return join(SAVED, id + ".json");
};
const okId = (v) => typeof v === "string" && /^[\w-]{1,80}$/.test(v);
/** A saved chapter must look like one: pages with clean ids (ids are put into the page as they are). */
function checkSpec(s) {
  if (!s || typeof s !== "object" || Array.isArray(s) || !Array.isArray(s.pages)) throw new Error("not a chapter");
  const walk = (rows) => { for (const row of rows || []) for (const q of (row && row.panels) || []) { if (q && q.rows) walk(q.rows); else if (!q || !okId(q.id)) throw new Error("a panel has a bad id"); } };
  for (const p of s.pages) { if (!p || !okId(p.id)) throw new Error("a page has a bad id"); if (p.layout) { walk(p.layout.rows); for (const q of p.layout.insets || []) if (!q || !okId(q.id)) throw new Error("an inset has a bad id"); } }
}
/** Series settings sent by the editor: sheets and pictures are names inside the project (bank/...), never paths elsewhere; where the
 * reference pictures live (ref_root) is only ever set on disk, not by a request. */
const relOk = (v) => v == null || v === "" || (typeof v === "string" && v.length < 300 && !v.includes("\0") && !/^([a-z]+:|[\\/])/i.test(v) && !v.split(/[\\/]/).includes(".."));
function checkBible(b, old) {
  if (typeof b !== "object" || Array.isArray(b)) throw new Error("not series settings");
  if (b.reading != null && b.reading !== "" && b.reading !== "rtl" && b.reading !== "ltr") throw new Error("the reading direction is rtl (right to left) or ltr (left to right)");
  for (const f of ["cast", "places", "props"]) {
    if (b[f] == null) continue;
    if (typeof b[f] !== "object" || Array.isArray(b[f])) throw new Error(f + " is not a list of names");
    for (const [n, c] of Object.entries(b[f])) {
      if (reserved(n) || !n.trim() || n.length > 80) throw new Error(`"${n.slice(0, 40)}" cannot be used as a name`);
      if (!c || typeof c !== "object") throw new Error(n + " has no settings");
      for (const k of ["sheet", "thumb", "ref"]) if (!relOk(c[k])) throw new Error(`the ${k} of ${n} is not a picture in the project`);
    }
  }
  if (old && old.ref_root) b.ref_root = old.ref_root; else delete b.ref_root;
}
const PORT = +process.argv[2] || 5178;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2", ".css": "text/css", ".txt": "text/plain; charset=utf-8" };
/** What the static route may hand out (19 Nov 2026: it used to serve every file under the app, links followed: the server's source,
 * task files with home paths, scripts, history). The screens' own files; from a project or sample only its pages (spec.json), its
 * series settings (bible.json) and pictures; core/ only scripts and data. Anything else, or a link that leads out, is "not found". */
const PICTURE = /\.(png|jpe?g|webp)$/i;
function staticFile(p) {
  const parts = p.split(/[\\/]/), ext = extname(p).toLowerCase();
  if (parts.includes("..") || parts.some((x) => x.startsWith("."))) return "";
  if (parts[0] === "core") return /\.(js|json)$/.test(ext) ? inside(APP, p) : "";
  if (parts[0] === "projects" || parts[0] === "samples") {
    const okName = parts.length === 3 && (parts[2] === "spec.json" || parts[2] === "bible.json");
    if (!okName && !(parts.length >= 3 && PICTURE.test(p))) return "";
    return inside(ROOT, p, [SERIES]); // a book chapter's bible.json and bank/ are the app's links into its book
  }
  if (["saved", "series", "anime-scenes", "anime-looks", "node_modules"].includes(parts[0])) return "";
  if (parts[0] === "styles") return PICTURE.test(p) ? inside(ROOT, p) : "";
  if (parts[0] === "fonts") return /\.(ttf|woff2|otf)$/.test(ext) ? inside(ROOT, p) : "";
  return parts.length === 1 && /^\.(html|js|css|svg)$/.test(ext) ? inside(ROOT, p) : ""; // the screens themselves (never the server's .mjs)
}
const SKELETON = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style></head><body>';

// ---------- the Artist's job runner: "Generate" in the editor draws the panel with Codex, one picture at a time ----------
const APP = join(ROOT, "..");
const jobs = new Map(); // "<project>/<panel id>" -> { project, panel, status: waiting | drawing | done | failed, msg, at, took }
const line = [];
const run = (cmd, args, opts = {}) => new Promise((res, rej) => execFile(cmd, args, { maxBuffer: 1 << 24, ...opts }, (e, out, err) => (e ? rej(new Error((err || e.message).toString().trim().split("\n").slice(-3).join(" "))) : res(out.toString()))));
const codex = (dir, prompt, minutes = 15) => codexRun(dir, prompt, { minutes }); // jobs that make something; look-only jobs use codexLook (read-only)
// Projects: any samples beside the app, and the ones made in the app (projects/, not in git: they are the person's own work).
const projDir = (id) => (existsSync(join(ROOT, "projects", id, "spec.json")) ? join(ROOT, "projects", id) : join(ROOT, "samples", id));
const projUrl = (id) => (existsSync(join(ROOT, "projects", id, "spec.json")) ? "projects/" : "samples/") + id + "/";
const leavesOf = (rows, out = []) => { for (const r of rows || []) for (const q of r.panels || []) { if (q.rows) leavesOf(q.rows, out); else out.push(q); } return out; };
async function listProjects() {
  const out = [];
  for (const base of ["projects", "samples"]) {
    let names = []; try { names = await readdir(join(ROOT, base)); } catch { continue; }
    for (const id of names.sort()) {
      const f = join(ROOT, base, id, "spec.json"); if (!existsSync(f)) continue;
      try {
        const spec = JSON.parse(await readFile(f, "utf8"));
        let pages = spec.pages, meta = {}; // counts follow the person's saved copy when there is one (and it is of this storyboard)
        try { const sv = JSON.parse(await readFile(join(SAVED, id + ".json"), "utf8")); if (sv.pages && sv.pages.length && (sv.boardAt || "") === (spec.boardAt || "")) pages = sv.pages; } catch { /* none saved */ }
        try { meta = JSON.parse(await readFile(join(ROOT, base, id, "project.json"), "utf8")); } catch { /* a sample */ }
        const panels = pages.flatMap((p) => (p.layout ? leavesOf(p.layout.rows) : [{ image: p.art }]));
        const job = jobs.get(id + "/paneler");
        let exported = 0; try { exported = (await readdir(join(SAVED, "exports", id))).filter((n) => n.endsWith(".png")).length; } catch { /* never exported */ }
        let cast = 0, sheets = 0, turned = ""; try { const b = JSON.parse(await readFile(join(ROOT, base, id, "bible.json"), "utf8")), cs = Object.values(b.cast || {}); if (b.reading === "rtl" || b.reading === "ltr") turned = b.reading; cast = cs.length; sheets = cs.filter((c) => c && (c.ref || c.sheet)).length; } catch { /* no series settings */ }
        let check = null; try { const cs = await checkState(id); check = { at: cs.check ? cs.check.at : "", open: cs.open, changed: cs.changed.length, running: !!cs.job && (cs.job.status === "waiting" || cs.job.status === "drawing") }; } catch { /* no check */ }
        out.push({ id, check, cast, sheets, lettered: pages.filter((p) => (p.text || []).length).length, exported, dir: base + "/" + id + "/", own: base === "projects", series: meta.series || "", title: meta.title || "", reading: turned || (spec.reading === "rtl" ? "rtl" : "ltr"), project: spec.project, chapter: spec.chapter, kind: spec.kind || "art",
          label: `${spec.project} · Chapter ${spec.chapter}` + (spec.kind === "storyboard" ? "" : " · art pages"),
          pages: pages.length, panels: panels.length, drawn: panels.filter((q) => q.image).length, cover: (spec.library && spec.library[0] && spec.library[0].src) || (pages[0] && pages[0].art) || "",
          storyboard: job ? { status: job.status, msg: job.msg, at: job.at, now: Date.now() } : existsSync(join(ROOT, base, id, "board.json")) || base === "samples" ? null : { status: "none" } });
      } catch { /* unreadable project: leave it out */ }
    }
  }
  return out;
}
const readingOf = (v) => (v === "ltr" ? "ltr" : "rtl"); // reading direction: a new project or book reads right to left (manga) unless it asks for left to right
async function createProject({ name, chapter, script, style, like, reading }) {
  name = String(name || "").trim().slice(0, 80); script = String(script || "");
  if (!name) throw new Error("Give the project a name.");
  if (script.trim().length < 40) throw new Error("Paste the chapter script first.");
  const ch = Math.max(1, Math.min(999, parseInt(chapter, 10) || 1));
  const slug = (name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project") + "-ch" + String(ch).padStart(2, "0");
  let id = slug, n = 1; while (existsSync(join(ROOT, "projects", id)) || existsSync(join(ROOT, "samples", id))) id = slug + "-" + ++n;
  const dir = join(ROOT, "projects", id);
  await mkdir(join(dir, "art", "panels"), { recursive: true });
  await writeFile(join(dir, "project.json"), JSON.stringify({ name, chapter: ch, reading: readingOf(reading), created: new Date().toISOString() }, null, 1));
  await writeFile(join(dir, "script.md"), script);
  // another chapter of a series that already exists: it shares that project's style, cast, places, props and sheets
  const first = like && existsSync(join(ROOT, "projects", clean(like), "bible.json")) && !existsSync(join(ROOT, "projects", clean(like), "sections")) ? clean(like) : "";
  if (first) {
    const { realpath } = await import("node:fs/promises"), { relative } = await import("node:path");
    const src = join(ROOT, "projects", first);
    await mkdir(join(src, "bank"), { recursive: true });
    await symlink(relative(dir, await realpath(join(src, "bible.json"))), join(dir, "bible.json"));
    await symlink(relative(dir, await realpath(join(src, "bank"))), join(dir, "bank"));
    let theirs = "ltr"; try { const b = JSON.parse(await readFile(join(src, "bible.json"), "utf8")); if (b.reading === "rtl") theirs = "rtl"; } catch { /* unreadable settings: left to right */ } // a new chapter reads the way its series does
    await writeFile(join(dir, "project.json"), JSON.stringify({ name, chapter: ch, shares: first, reading: theirs, created: new Date().toISOString() }, null, 1));
  }
  await run("node", [join(APP, "tools/build_spec.mjs"), dir]); // opens as one blank page until the Paneler has run
  const preset = first ? null : (await allStyles()).find((q) => q.id === style);
  if (preset) { // the look chosen on the new-project form
    const f = join(dir, "bible.json"), bible = JSON.parse(await readFile(f, "utf8"));
    Object.assign(bible, { style: preset.style, style_id: preset.id, colour: !!preset.colour }); await writeJson(f, bible);
  }
  return id;
}
// ---------- art styles: the ready-made ones (core/styles.json) and the person's own (saved/styles.json) ----------
const OWN_STYLES = join(SAVED, "styles.json");
const ownStyles = async () => { try { return JSON.parse(await readFile(OWN_STYLES, "utf8")); } catch { return []; } };
const allStyles = async () => JSON.parse(await readFile(join(APP, "core/styles.json"), "utf8")).concat(await ownStyles());
const saveOwnStyle = (b) => lockDoc(OWN_STYLES, () => saveOwnStyleNow(b));
async function saveOwnStyleNow({ id, name, style, colour, dataUrl }) {
  const list = await ownStyles(); name = String(name || "").trim().slice(0, 40);
  let st = id ? list.find((q) => q.id === id) : list.find((q) => q.name.toLowerCase() === name.toLowerCase());
  if (!st) { if (!name || String(style || "").trim().length < 20) throw new Error("A style needs a name and its style text."); st = { id: "own-" + Date.now().toString(36), own: true, name, blurb: "Your own style.", example: "" }; list.push(st); }
  if (style != null && String(style).trim().length >= 20) { st.style = String(style).trim(); st.colour = !!colour; }
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl || "");
  if (m) { await mkdir(join(SAVED, "styles"), { recursive: true }); const file = `${st.id}-${Date.now().toString(36)}.${m[1] === "png" ? "png" : "jpg"}`; await writeFile(join(SAVED, "styles", file), Buffer.from(m[2], "base64")); st.example = "/own-style/" + file; }
  await mkdir(SAVED, { recursive: true }); await writeJson(OWN_STYLES, list); return st;
}
// ---------- one character renamed everywhere: the series settings, and every chapter that shares them ----------
const escRe = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // before 19 Nov 2026 this class was broken: "Ann (young)" made a bad pattern
function renameDeep(v, from, to, re = new RegExp("(^|[^A-Za-z])" + escRe(from) + "(?![A-Za-z])", "g")) {
  if (Array.isArray(v)) { for (const x of v) renameDeep(x, from, to, re); return; }
  if (!v || typeof v !== "object") return;
  for (const k of Object.keys(v)) {
    if ((k === "name" || k === "who" || k === "speaker") && v[k] === from) v[k] = to;
    else if ((k === "action" || k === "note" || k === "art" || k === "desc") && typeof v[k] === "string") v[k] = v[k].replace(re, (_, a) => a + to); // what a panel shows, in the storyboard's own words (never the spoken lines)
    else if (k === "absent" && Array.isArray(v[k])) v[k] = v[k].map((x) => (x === from ? to : x));
    else if (k === "voices" && v[k] && typeof v[k] === "object" && !Array.isArray(v[k]) && Object.hasOwn(v[k], from) && !Object.hasOwn(v[k], to)) { v[k][to] = v[k][from]; delete v[k][from]; renameDeep(v[k], from, to, re); }
    else renameDeep(v[k], from, to, re);
  }
}
const renameCharacter = async (id, from, to) => lockDoc(join(projDir(id), "bible.json"), () => renameCharacterNow(id, from, to)); // the bible's own lock: no other save of it in between
async function renameCharacterNow(id, from, to) {
  to = String(to || "").replace(/\s+/g, " ").trim().slice(0, 40); const dir = projDir(id), bf = await realpath(join(dir, "bible.json"));
  const bible = JSON.parse(await readFile(bf, "utf8"));
  if (reserved(to) || reserved(from)) throw new Error(`"${to}" cannot be used as a name.`);
  if (!to || !bible.cast || !Object.hasOwn(bible.cast, from)) throw new Error("Type the new name.");
  if (to === from) return;
  if (Object.keys(bible.cast).some((k) => k !== from && k.toLowerCase() === to.toLowerCase())) throw new Error(`There is already someone called ${to}.`);
  // Every chapter's files are read and renamed in memory first: a file that cannot be read or changed stops the rename before
  // anything is written (it used to be skipped silently, leaving the bible renamed and the pages with the old name).
  const pending = [], chapters = [];
  for (const pid of await readdir(join(ROOT, "projects"))) { // every chapter drawn from these settings
    const d = join(ROOT, "projects", pid); let same = false; try { same = (await realpath(join(d, "bible.json"))) === bf; } catch { /* no settings */ }
    if (!same) continue; chapters.push(d);
    for (const f of [join(d, "board.json"), join(d, "script.json"), join(d, "art", "library.json"), join(d, "art", "faces.json"), join(d, "cover.json"), join(SAVED, pid + ".json")]) {
      let text; try { text = await readFile(f, "utf8"); } catch (e) { if (e.code === "ENOENT") continue; throw new Error(`Not renamed: ${f.split("/").slice(-2).join("/")} could not be read (${e.code || e.message}).`); }
      let j; try { j = JSON.parse(text); } catch { throw new Error(`Not renamed: ${f.split("/").slice(-2).join("/")} is not readable JSON. Nothing was changed.`); }
      renameDeep(j, from, to); pending.push([f, JSON.stringify(j, null, 1)]);
    }
  }
  const next = {}; for (const k of Object.keys(bible.cast)) next[k === from ? to : k] = bible.cast[k];
  const c = next[to]; if (typeof c.desc === "string" && c.desc.startsWith(from.toUpperCase())) c.desc = to.toUpperCase() + c.desc.slice(from.length);
  if (c.ref_role) c.ref_role = c.ref_role.replace(from, to);
  bible.cast = next;
  for (const [f, text] of pending) await writeAtomic(f, text);
  await writeAtomic(bf, JSON.stringify(bible, null, 1));
  let meta = {}; try { meta = JSON.parse(await readFile(join(dir, "project.json"), "utf8")); } catch { /* a sample */ }
  if (meta.series) { // the book's own list follows, and remembers the name for later readings
    try { const cf = join(SERIES, meta.series, "cast.json"), cast = JSON.parse(await readFile(cf, "utf8")), row = cast.people.find((x) => x.name === from);
      if (row && !cast.people.some((x) => x !== row && x.name.toLowerCase() === to.toLowerCase())) { row.also = [from].concat((row.also || []).filter((a) => a !== from && a.toLowerCase() !== to.toLowerCase())); row.name = to; await writeJson(cf, cast);
        const nf = join(SERIES, meta.series, "names.json"); let names = { people: {}, places: {} }; try { names = JSON.parse(await readFile(nf, "utf8")); } catch { /* first */ }
        names.people[Object.keys(names.people).find((k) => names.people[k] === from) || from] = to; await writeJson(nf, names); } } catch { /* no list read yet */ }
  }
  for (const d of chapters) if (existsSync(join(d, "board.json"))) await run("node", [join(APP, "tools/build_spec.mjs"), d]);
  return chapters.length;
}
// ---------- books: one long text, numbered and split into chapters; every chapter shares the book's style, cast and sheets ----------
const SERIES = process.env.STUDIO_SERIES || join(ROOT, "series"); // tests of the book screens point this at a copy (starting a chapter always links to the real folder)
const clean = (s) => String(s || "").replace(/[^\w-]/g, "_");
const readSeries = async (id) => JSON.parse(await readFile(join(SERIES, id, "series.json"), "utf8"));
async function listSeries() {
  let names = []; try { names = await readdir(SERIES); } catch { return []; }
  const out = [];
  for (const id of names.sort()) {
    try {
      const s = await readSeries(id), real = s.chapters.filter((c) => c.kind !== "front");
      let reading = "ltr"; try { if (JSON.parse(await readFile(join(SERIES, id, "bible.json"), "utf8")).reading === "rtl") reading = "rtl"; } catch { /* no settings */ }
      out.push({ id, name: s.name, reading, chapters: real.length, words: s.words, pages_est: s.pages_est, started: real.filter((c) => c.project && existsSync(join(ROOT, "projects", c.project, "spec.json"))).length });
    } catch { /* unreadable: leave it out */ }
  }
  return out;
}
/** A new book from an uploaded file (.txt, .md, .docx, .epub, or an already numbered paragraphs.json). No models: tools/import_book.py. */
async function createSeries({ name, file, style, reading }, bytes) {
  name = String(name || "").trim().slice(0, 80);
  if (!name) throw new Error("Give the book a name.");
  const ext = (extname(String(file || "")).toLowerCase().match(/^\.(txt|md|markdown|docx|epub|json)$/) || [])[0];
  if (!ext) throw new Error("That kind of file cannot be read yet. Use .txt, .md, .docx or .epub.");
  if (bytes.length < 200) throw new Error("That file is almost empty.");
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "book";
  let id = slug, n = 1; while (existsSync(join(SERIES, id))) id = slug + "-" + ++n;
  const dir = join(SERIES, id), src = join(dir, "source", "original" + ext);
  await mkdir(join(dir, "source"), { recursive: true }); await mkdir(join(dir, "bank"), { recursive: true });
  try {
    await writeFile(src, bytes);
    await run("/usr/bin/python3", [join(APP, "tools/import_book.py"), src, dir, "--name", name]);
    const bible = JSON.parse(await readFile(join(APP, "core/default-bible.json"), "utf8")), preset = (await allStyles()).find((q) => q.id === style);
    if (preset) Object.assign(bible, { style: preset.style, style_id: preset.id, colour: !!preset.colour });
    bible.project = name; bible.cast = bible.cast || {}; bible.strict = true; // a book is drawn only from approved sheets
    bible.reading = readingOf(reading); // every chapter of the book reads this way
    await writeFile(join(dir, "bible.json"), JSON.stringify(bible, null, 1));
  } catch (e) { await rm(dir, { recursive: true, force: true }); throw e; }
  return id;
}
const chapterRows = async (id, ch) => JSON.parse(await readFile(join(SERIES, id, "source", "paragraphs.json"), "utf8")).filter((r) => r.chapter_id === ch.chapter_id);
/** One chapter of a book becomes a project. Its bible.json and bank/ are links to the book's, so the look and the cast are shared. */
async function startChapter(id, chId) {
  const s = await readSeries(id), ch = s.chapters.find((c) => c.id === chId && c.kind !== "front");
  if (!ch) throw new Error("no such chapter");
  if (ch.project && existsSync(join(ROOT, "projects", ch.project, "spec.json"))) return ch.project;
  const base = `${id}-ch${String(ch.number).padStart(2, "0")}`; let pid = base, n = 1;
  while (existsSync(join(ROOT, "projects", pid)) || existsSync(join(ROOT, "samples", pid))) pid = base + "-" + ++n;
  const dir = join(ROOT, "projects", pid), rows = await chapterRows(id, ch);
  await mkdir(join(dir, "art", "panels"), { recursive: true });
  let reading = "ltr"; try { const b = JSON.parse(await readFile(join(SERIES, id, "bible.json"), "utf8")); if (b.reading === "rtl") reading = "rtl"; } catch { /* a book from before reading direction: left to right */ }
  await writeFile(join(dir, "project.json"), JSON.stringify({ name: s.name, chapter: ch.number, title: ch.title, series: id, chapter_id: ch.chapter_id, reading, created: new Date().toISOString() }, null, 1));
  // the chapter's text, each paragraph led by its id in the book: the source every balloon and caption is traced back to
  await writeFile(join(dir, "script.md"), rows.map((r) => `[${r.source_id}] ${r.text}`).join("\n\n") + "\n");
  await symlink(join("..", "..", "series", id, "bible.json"), join(dir, "bible.json"));
  await symlink(join("..", "..", "series", id, "bank"), join(dir, "bank"));
  await run("node", [join(APP, "tools/build_spec.mjs"), dir]);
  await updateJson(join(SERIES, id, "series.json"), (now) => { const c = now.chapters.find((x) => x.id === chId); if (!c) return false; c.project = pid; });
  return pid;
}
// ---------- casting: the people and places of a whole book, with the book's own words for how they look (tools/book_cast.mjs) ----------
const casting = new Map(); // book id -> the running reader
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function castJob(id) {
  let p = null; try { p = JSON.parse(await readFile(join(SERIES, id, "cast", "progress.json"), "utf8")); } catch { return null; }
  if ((p.status === "reading" || p.status === "folding") && !casting.has(id) && !alive(p.pid)) { p.status = "failed"; p.msg = "The reading was interrupted. Start it again: the parts already read are kept."; }
  return { status: p.status, done: p.done, total: p.total, started: p.started, took: p.took, msg: p.msg, now: Date.now() };
}
function startCasting(id, fresh) {
  if (casting.has(id)) return;
  const c = spawn("node", [join(APP, "tools/book_cast.mjs"), join(SERIES, id)].concat(fresh ? ["--fresh"] : []), { stdio: "ignore" });
  casting.set(id, c); c.on("exit", () => casting.delete(id)); c.on("error", () => casting.delete(id));
}
/** A person or place gets the name the owner wants (the book's list, the shared cast, and every later reading of the book). */
const renameInCast = (id, r) => lockDoc(join(SERIES, id, "cast.json"), () => lockDoc(join(SERIES, id, "bible.json"), () => renameInCastNow(id, r)));
async function renameInCastNow(id, { from, to, kind }) {
  to = String(to || "").replace(/\s+/g, " ").trim().slice(0, 60); const key = kind === "place" ? "places" : "people";
  if (reserved(to) || reserved(from)) throw new Error(`"${to}" cannot be used as a name.`);
  const cf = join(SERIES, id, "cast.json"), cast = JSON.parse(await readFile(cf, "utf8")), row = cast[key].find((x) => x.name === from);
  if (!row || !to) throw new Error("Type the new name.");
  if (to === from) return;
  if (cast[key].some((x) => x !== row && x.name.toLowerCase() === to.toLowerCase())) throw new Error(`There is already ${kind === "place" ? "a place" : "someone"} called ${to}.`);
  row.also = [from].concat((row.also || []).filter((a) => a.toLowerCase() !== to.toLowerCase() && a !== from)); row.name = to;
  await writeJson(cf, cast);
  const nf = join(SERIES, id, "names.json"); let names = { people: {}, places: {} }; try { names = JSON.parse(await readFile(nf, "utf8")); } catch { /* first rename */ }
  const first = Object.keys(names[key]).find((k) => names[key][k] === from) || from; // renamed twice: keep pointing from the book's own name
  names[key][first] = to; await writeJson(nf, names);
  const bf = join(SERIES, id, "bible.json"), bible = JSON.parse(await readFile(bf, "utf8")), field = kind === "place" ? "places" : "cast", old = bible[field] || {};
  if (old[from] && !old[to]) {
    const next = {}; for (const k of Object.keys(old)) next[k === from ? to : k] = old[k];
    const c = next[to]; if (typeof c.desc === "string" && c.desc.startsWith(from.toUpperCase())) c.desc = to.toUpperCase() + c.desc.slice(from.length);
    if (c.ref_role) c.ref_role = c.ref_role.replace(from, to);
    bible[field] = next; await writeJson(bf, bible);
  }
}
/** Put people and places from the book's list into the book's series settings (shared by every chapter). Nothing already there is changed. */
const addFromCast = (id, b) => lockDoc(join(SERIES, id, "bible.json"), () => addFromCastNow(id, b));
async function addFromCastNow(id, { people = [], places = [] }) {
  const cast = JSON.parse(await readFile(join(SERIES, id, "cast.json"), "utf8")), f = join(SERIES, id, "bible.json"), bible = JSON.parse(await readFile(f, "utf8"));
  bible.cast = bible.cast || {}; bible.places = bible.places || {};
  const has = (o, n) => Object.keys(o).some((k) => k.toLowerCase() === n.toLowerCase()); let added = 0;
  for (const n of people) { const c = cast.people.find((x) => x.name === n); if (!c || reserved(n) || has(bible.cast, n)) continue;
    bible.cast[n] = { desc: `${n.toUpperCase()}${c.age ? ", " + c.age : ""}: ${c.look || ""}`, from_book: true }; added++; }
  for (const n of places) { const c = cast.places.find((x) => x.name === n); if (!c || reserved(n) || has(bible.places, n)) continue;
    bible.places[n] = { desc: `${n.toUpperCase()}: ${[c.who, c.look].filter(Boolean).join(" ")}`, from_book: true }; added++; }
  await writeJson(f, bible); return added;
}
/** The Paneler, unattended: Codex reads script.md and writes script.json + board.json; then the project is rebuilt.
 * Storyboarding again keeps the old board in history/ and takes the pictures off the pages (they stay in the art list):
 * panel ids belong to the old board, so old art would land in the wrong panels. A failed run puts the old board back. */
/** Writing with a picked OpenRouter model instead of Codex: the model cannot open files, so the task and the files it names are sent with it,
 * and it answers with one JSON object holding each file to write. names = the files it must write; extra = files it should read. */
async function writeWithModel(r, dir, task, names, extra = []) {
  const read = async (f) => { try { return await readFile(join(dir, f), "utf8"); } catch { return null; } };
  const parts = [`# The task\n\n${await readFile(task, "utf8")}`];
  for (const f of extra) { const t = await read(f); if (t != null) parts.push(`# The file \`${f}\` (it is in the folder; you are given its text here)\n\n\`\`\`\n${t}\n\`\`\``); }
  parts.push(`# How to answer\n\nYou cannot write files. Answer with ONE JSON object and nothing else: ${names.map((n) => `"${n}": <the whole content of ${n}, as JSON>`).join(", ")}. Ibasho writes each one into the folder for you.`);
  const out = await orText(r.key, r.model, [{ role: "system", content: "You are the Paneler of a manga studio app. Follow the task exactly. Your whole answer is one JSON object." }, { role: "user", content: parts.join("\n\n") }]);
  const t = out.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""), a = t.indexOf("{"), b = t.lastIndexOf("}");
  let got; try { got = JSON.parse(t.slice(a, b + 1)); } catch { throw new Error(`${r.model.split("/").pop()} did not answer with readable JSON`); }
  for (const n of names) { if (got[n] == null) throw new Error(`${r.model.split("/").pop()} left out ${n}`); await writeFile(join(dir, n), JSON.stringify(typeof got[n] === "string" ? JSON.parse(got[n]) : got[n], null, 1)); }
  return out.cost;
}
async function storyboard(job) {
  const dir = join(ROOT, "projects", job.project), keep = ["script.json", "board.json", "art/assignments.json"];
  const again = existsSync(join(dir, "board.json")), hist = join(dir, "history", new Date().toISOString().replace(/[-:]/g, "").slice(0, 15));
  if (again) { await mkdir(join(hist, "art"), { recursive: true }); for (const f of keep) if (existsSync(join(dir, f))) await copyFile(join(dir, f), join(hist, f)); }
  const build = async () => JSON.parse((await run("node", [join(APP, "tools/build_spec.mjs"), dir])).trim().split("\n").pop());
  try {
    let meta = {}; try { meta = JSON.parse(await readFile(join(dir, "project.json"), "utf8")); } catch { /* none */ }
    const isBook = !!meta.series;
    const pen = isBook ? { service: "codex" } : await routeModel(SAVED, "text"); // book chapters still go through Codex (tools/book_board.mjs)
    if (isBook) { // a chapter of a book: adapted section by section and checked against the book's own words (tools/book_board.mjs)
      const tick = setInterval(async () => { try { const p = JSON.parse(await readFile(join(dir, "sections", "progress.json"), "utf8")); if (p.total > 1) job.msg = `${p.done} of ${p.total} sections storyboarded`; } catch { /* not started */ } }, 4000);
      try { await run("node", [join(APP, "tools/book_board.mjs"), dir].concat(again ? ["--fresh"] : []), { timeout: 4 * 3600 * 1000 }); } finally { clearInterval(tick); delete job.msg; }
    } else {
    const task = (await run("node", [join(APP, "tools/paneler_task.mjs"), dir])).trim();
    if (pen.service === "openrouter") { const est = await estimate("text", pen.model); const free = await guardSpend(SAVED, est, "The storyboard", job.ok);
      job.msg = "Writing with " + pen.model.split("/").pop(); const cost = await writeWithModel(pen, dir, task, ["script.json", "board.json"], ["script.md"]).catch((e) => { free(); throw e; }); delete job.msg;
      await logSpend(SAVED, { project: job.project, what: "storyboard", kind: "text", model: pen.model, usd: cost, est }); }
    else await codex(dir, `Read the task file ${task} and follow it exactly: write script.json and board.json in this folder, then stop.`);
    }
    for (const f of ["script.json", "board.json"]) { try { JSON.parse(await readFile(join(dir, f), "utf8")); } catch { throw new Error(`Codex did not leave a readable ${f}`); } }
    if (again && existsSync(join(dir, "art/assignments.json"))) await rm(join(dir, "art/assignments.json"));
    let out = await build();
    if (!out.pages || !out.lines) throw new Error("the storyboard came back empty");
    const faults = (o) => (o.faults || []).concat(o.warnings || []);
    if (isBook) { try { out.faults = (out.faults || []).concat(JSON.parse(await readFile(join(dir, "sections", "faults.json"), "utf8"))); } catch { /* none */ } await writeFile(join(dir, "board-faults.json"), JSON.stringify(faults(out), null, 1)); }
    if (faults(out).length && !isBook) { // nobody reviews the board before the person sees it: send it back once with what the checks found
      const fix = join(dir, "PANELER_FIX.md");
      const faultsFile = await dataFile(join(dir, "PANELER_FIX_DATA.json"), faults(out)); // the faults quote the script's words: data, not task
      await writeFile(fix, `# Paneler: fix the storyboard\n\nYour \`board.json\` in \`${dir}\` breaks the rules listed in the DATA file \`${faultsFile}\` (a JSON list, one fault a line).\n\n${DATA_RULE}\n\nRewrite \`board.json\` (same format and rules as \`PANELER_TASK.md\`) so every one is fixed. The usual fix for a crowded page is to move beats onto a new page: more pages is fine. Keep every line id exactly once, in script order. Do not change \`script.json\`. Then stop.\n`);
      const first = await readFile(join(dir, "board.json"), "utf8");
      try {
        if (pen.service === "openrouter") { const est = await estimate("text", pen.model); const free = await guardSpend(SAVED, est, "The storyboard's second pass", job.ok); // the fix is a second paid call: it is checked like the first
          const cost = await writeWithModel(pen, dir, fix, ["board.json"], ["PANELER_FIX_DATA.json", "script.json", "board.json", "PANELER_TASK.md"]).catch((e) => { free(); throw e; }); await logSpend(SAVED, { project: job.project, what: "storyboard fix", kind: "text", model: pen.model, usd: cost, est }); }
        else await codex(dir, `Read the task file ${fix} and follow it exactly: rewrite board.json in this folder, then stop.`);
        JSON.parse(await readFile(join(dir, "board.json"), "utf8"));
        const o2 = await build();
        if (!o2.pages || !o2.lines || faults(o2).length > faults(out).length) throw new Error("the fix was no better");
        out = o2;
      } catch { await writeFile(join(dir, "board.json"), first); out = await build(); } // keep the first board
    }
    job.msg = `${out.pages} pages, ${out.lines} lines` + (faults(out).length ? `, ${faults(out).length} to check` : "");
  } catch (e) {
    if (again) { for (const f of keep) if (existsSync(join(hist, f))) await copyFile(join(hist, f), join(dir, f)); await build().catch(() => {}); }
    throw e;
  }
}
/** Start (or report) the Paneler's job for a project; a note from the person is kept with the project for this and later runs. */
async function startStoryboard(id, note, ok) {
  const key = id + "/paneler", old = jobs.get(key);
  if (old && (old.status === "waiting" || old.status === "drawing")) return old;
  if (note != null) await updateJson(join(ROOT, "projects", id, "project.json"), (meta) => { meta.paneler_note = String(note).trim().slice(0, 600); });
  const job = { project: id, panel: "paneler", kind: "paneler", status: "waiting", queued: Date.now(), ok }; jobs.set(key, job); line.push(job); pump();
  return job;
}
// Character sheets: one picture per character that every later panel is drawn from, so the cast keeps one look.
const slugOf = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "character";
const FIELD = { place: "places", prop: "props" }; // besides the cast, a series keeps places and props, each with a look and a reference picture
async function setSheet(dir, name, file, approved = true, kind = "") { // a sheet the person uploaded is theirs; a character sheet Codex drew waits for their yes
  const rel = "bank/" + file.split("/").pop(), thumb = rel.replace(/\.[a-z]+$/i, "") + "-thumb.jpg";
  await run("/usr/bin/python3", ["-c", "import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert('RGB'); im.thumbnail((720,720)); im.save(sys.argv[2],quality=84)", file, join(dir, thumb)]);
  if (reserved(name)) throw new Error(`"${name}" cannot be used as a name.`); // bible.cast.__proto__ is every object in the server
  await updateJson(join(dir, "bible.json"), (bible) => { const field = FIELD[kind] || "cast";
  bible[field] = bible[field] || {};
  const role = kind === "place" ? `${name} (the place: keep its layout, furniture, colours and light; the camera angle is new)` : kind === "prop" ? `${name} (the object: match its shape and details exactly)` : `${name} (character sheet: match the face, hair, build and clothes)`;
  bible[field][name] = Object.assign((Object.hasOwn(bible[field], name) && bible[field][name]) || { desc: name.toUpperCase() + "." }, { sheet: rel, thumb, approved: kind ? true : approved, sheet_style: bible.style_id || "", ref_role: role });
  });
}
async function drawSheet(job) {
  const dir = projDir(job.project), bank = join(dir, "bank"), bible = JSON.parse(await readFile(join(dir, "bible.json"), "utf8")), kind = job.thing || "", all = bible[FIELD[kind] || "cast"] || {}, c = Object.hasOwn(all, job.name) ? all[job.name] : null;
  if (!c) throw new Error(kind ? "no such " + kind : "no such character");
  await mkdir(bank, { recursive: true });
  const tag = kind || "sheet";
  let take = 1; const nm = (t) => `${slugOf(job.name)}-${tag}-take${String(t).padStart(2, "0")}.png`;
  while (existsSync(join(bank, nm(take)))) take++;
  const pic = join(bank, nm(take)), task = join(bank, `SHEET_TASK_${tag}_${slugOf(job.name)}.md`), ink = bible.colour ? "FULL-COLOUR" : "BLACK-AND-WHITE";
  const lead = kind === "place"
    ? [`Use case: illustration-story. Create ONE ${ink} PLACE REFERENCE PICTURE, landscape 1536x1024: one wide, clear view of the whole place from eye level, so that an artist can draw any corner of it afterwards. NO people, no animals, no figures of any kind. One picture only: no panel borders, no insets.`, "THE PLACE. " + c.desc]
    : kind === "prop"
    ? [`Use case: illustration-story. Create ONE ${ink} PROP REFERENCE SHEET, landscape 1536x1024, on plain white paper. ONE object only, drawn twice side by side at the same size: (left) the whole object seen from the side; (right) the same object in three-quarter view. No hands, no people, no scenery, no panel borders.`, "THE OBJECT. " + c.desc]
    : [`Use case: illustration-story. Create ONE ${ink} CHARACTER REFERENCE SHEET, landscape 1536x1024, on plain white paper.` + " ONE character only, drawn three times in a row, the same person in the same clothes: (left) the full figure standing, front view, arms relaxed at the sides; (middle) head and shoulders, front view, calm neutral expression, mouth closed; (right) head and shoulders, three-quarter view. No other people, no props unless the description names one, no scenery, no panel borders.", "THE CHARACTER. " + c.desc];
  const prompt = [lead[0],
    "NO TEXT: no letters, labels, names, captions, numbers, arrows or signatures anywhere.",
    bible.style,
    `This is a reference ${kind === "place" ? "picture" : "sheet"}, not a manga page: where the style text speaks of a page, panels, ${kind === "place" ? "" : "backgrounds, "}borders, gutters or margins, ignore it. Draw it in exactly this art style.`,
    lead[1],
  ].join("\n\n");
  const said = await dataFile(task.replace(/\.md$/, ".prompt.txt"), prompt); // the style and the description are the person's words: a data file, never the task
  await writeFile(task, `# Codex task: reference ${kind || "sheet"} for one ${kind || "character"}\n\nUse your built-in image generation tool at the highest quality it offers. The prompt is the whole text of the DATA file \`${said}\`: send it exactly as written, with no images attached. Save the picture to the Save as path (never overwrite a file), then stop. Write nothing else.\n\n${DATA_RULE}\n\n**Save as:** \`${pic}\`\n\n**Size:** 1536 x 1024\n`);
  await codex(bank, `Read the task file ${task} and follow it exactly: one picture made with your built-in image generation tool, saved at the Save as path. Then stop.`);
  if (!existsSync(pic)) throw new Error("Codex finished without saving the picture");
  await oneAtATime(() => setSheet(dir, job.name, pic, false, kind));
}
/** People the storyboard put in a panel whose face Codex did not list: one more look at the finished picture (nothing is drawn). */
async function secondLook(pic, missing, found, cast) {
  const out = pic + ".faces2.json", task = pic.replace(/\.\w+$/, "") + "-FACES_TASK.md", data = pic.replace(/\.\w+$/, "") + "-FACES_DATA.json";
  await rm(out, { force: true });
  const side = (w) => (!w.at ? "" : `${w.at[1] < 0.4 ? "upper" : w.at[1] > 0.6 ? "lower" : "middle"} ${w.at[0] < 0.4 ? "left" : w.at[0] > 0.6 ? "right" : "centre"}`);
  await dataFile(data, { // names and descriptions are the person's words: kept out of the task
    find: missing.map((w) => ({ name: w.name, description: (Object.hasOwn(cast, w.name) && cast[w.name].desc) || "no description", ...(w.voice ? { speaks_off_frame: true } : { storyboard_place: side(w), size: w.size || "medium", facing: w.facing || "camera" }) })),
    already_listed: found.map((f) => ({ who: f.who, box: f.box })) });
  await writeFile(task, `# Codex task: find people in a finished picture\n\nOpen the picture \`${pic}\` and look at it carefully. Do NOT generate, edit or save any image, and write no file.\n\n${DATA_RULE}\n\n` +
    `The DATA file \`${data}\` lists, under \`find\`, characters with no face listed yet. Each one either was put in this picture by the storyboard (\`storyboard_place\`, \`size\`, \`facing\`), or speaks in this panel and may have been drawn in it (\`speaks_off_frame\`: they may not be in the picture at all; a hand or sleeve alone does not count). Under \`already_listed\` are faces already found: do not list them again.\n\n` +
    `Find each one's head, even when it is small, far away, turned away, partly hidden, in shadow or a silhouette. Your final message is the answer and nothing else: a JSON list with one entry per character in \`find\`, ` +
    `\`{"who": "<name exactly as given>", "box": [left, top, right, bottom]}\` in pixels of the picture (the head only: top of the hair to the chin; for someone turned away, the back of the head). ` +
    `If a character truly is not in the picture, give \`{"who": "<name>", "box": null}\`.\n`);
  const answer = await codexLook(dirname(pic), `Read the task file ${task} and follow it exactly: look at one picture and answer with one small JSON list as your final message. Do not generate images and write no files.`, { minutes: 6 });
  const got = jsonFrom(answer); await writeFile(out, JSON.stringify(got, null, 1)); // kept beside the picture, as before
  if (!Array.isArray(got)) throw new Error("the second look did not answer with a list");
  const low = (s) => String(s).toLowerCase().trim(), faces = [], absent = [];
  for (const w of missing) {
    const g = got.find((x) => x && low(x.who) === low(w.name));
    if (g && Array.isArray(g.box) && g.box.length === 4 && g.box.every(Number.isFinite) && g.box[2] > g.box[0] && g.box[3] > g.box[1]) faces.push({ who: w.name, box: g.box, by: "second look" });
    else if (g && g.box === null && !w.voice) absent.push(w.name);
  }
  return { faces, absent };
}
async function rebuild(proj) { // a project made in the app has a board.json; an older hand-built sample has its own builder, when that is here
  if (existsSync(join(proj, "board.json"))) await run("node", [join(APP, "tools/build_spec.mjs"), proj]);
  else if (existsSync(join(APP, "tools/build_board.py"))) await run("/usr/bin/python3", [join(APP, "tools/build_board.py")]);
  else throw new Error("This project has no storyboard file (board.json) to rebuild from.");
}
/** "Look again for the missing faces" on a picture that is already in a panel: the same second look, nothing is drawn. */
async function lookAgain(job) {
  const proj = projDir(job.project), lf = join(proj, "art", "library.json"), lib = JSON.parse(await readFile(lf, "utf8"));
  const find = (spec) => { for (const pg of spec.pages || []) if (pg.layout) for (const q of leavesOf(pg.layout.rows).concat(pg.layout.insets || [])) if (q.id === job.pid) return q; return null; };
  let q = null; try { q = find(JSON.parse(await readFile(join(SAVED, job.project + ".json"), "utf8"))); } catch { /* nothing saved */ }
  if (!q) q = find(JSON.parse(await readFile(join(proj, "spec.json"), "utf8")));
  const entry = q && q.image && lib.find((e) => e.src === q.image);
  if (!entry) throw new Error("that panel has no picture");
  const b = q.board || {}, who = (b.who || []).map((w) => ({ name: w.name, at: w.at, size: w.size, facing: w.facing }));
  const voices = [...new Set((b.lines || []).map((l) => l.speaker).filter((n) => n && !who.some((w) => w.name === n)))].map((name) => ({ name, voice: true }));
  const have = entry.protect || [], missing = who.concat(voices).filter((w) => !have.some((f) => f.who === w.name));
  if (!missing.length) { job.msg = "Everyone already has a face."; return; }
  const pic = entry.from && existsSync(join(proj, entry.from)) ? join(proj, entry.from) : join(proj, entry.src), [w, h] = entry.size;
  let cast = {}; try { cast = JSON.parse(await readFile(join(proj, "bible.json"), "utf8")).cast || {}; } catch { /* no bible */ }
  const more = await secondLook(pic, missing, have.map((f) => ({ who: f.who, box: [f.box[0] * w, f.box[1] * h, f.box[2] * w, f.box[3] * h].map(Math.round) })), cast);
  const r3 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  await oneAtATime(async () => { // other pictures may have landed while Codex looked: change only this entry, in the list as it is now
    const now = JSON.parse(await readFile(lf, "utf8")), e = now.find((x) => x.src === entry.src); if (!e) return;
    const had = e.protect || [];
    e.protect = had.concat(more.faces.filter((f) => !had.some((h) => h.who === f.who)).map((f) => ({ who: f.who, box: [r3(f.box[0] / w), r3(f.box[1] / h), r3(f.box[2] / w), r3(f.box[3] / h)], by: "second look" })));
    e.absent = [...new Set((e.absent || []).concat(more.absent))].filter((n) => !e.protect.some((f) => f.who === n));
    if (!e.absent.length) delete e.absent;
    await writeJson(lf, now); await rebuild(proj);
  });
  job.msg = more.faces.length ? `Found ${more.faces.map((f) => f.who).join(" and ")}.` : "Nobody new was found in the picture.";
}
// ---------- the asset checker: do the pictures in use agree with each other and with the approved sheets? ----------
// tools/asset_lineup.py cuts every appearance of each character, place and prop into numbered line-ups; the Checker agent (Codex, looking only)
// answers a fixed list per appearance. Kept in <project>/art/check/check.json. A fault only warns: nothing is ever blocked by it.
const ABOUT = ["face", "age", "hair", "outfit", "hands", "prop", "mark", "place", "other"], SURE = ["high", "medium", "low"];
const checkFile = (id) => join(projDir(id), "art", "check", "check.json");
async function pagesFor(id) { // the person's saved copy when it is of this storyboard, else the built pages
  const spec = join(projDir(id), "spec.json"), saved = join(SAVED, id + ".json");
  try { const a = JSON.parse(await readFile(saved, "utf8")), b = JSON.parse(await readFile(spec, "utf8")); if (a.pages && a.pages.length && (a.boardAt || "") === (b.boardAt || "")) return [saved, "--fallback", spec]; } catch { /* no saved copy */ }
  return [spec];
}
async function inUse(id) { // panel -> picture, as the editor shows them now
  const [first, , second] = await pagesFor(id), out = {}, walk = (pages, fill) => { for (const p of pages || []) if (p.layout) for (const q of leavesOf(p.layout.rows).concat(p.layout.insets || [])) if (q.id && q.image && (fill || !out[q.id])) out[q.id] = q.image; };
  if (second) { try { walk(JSON.parse(await readFile(second, "utf8")).pages, true); } catch { /* unreadable */ } }
  try { const a = JSON.parse(await readFile(first, "utf8")).pages, has = new Set(); for (const p of a || []) if (p.layout) for (const q of leavesOf(p.layout.rows).concat(p.layout.insets || [])) { if (q.id) has.add(q.id); if (q.id && q.image) out[q.id] = q.image; } for (const k of Object.keys(out)) if (!has.has(k)) delete out[k]; } catch { /* unreadable */ }
  return out;
}
async function checkState(id) {
  let c = null; try { c = JSON.parse(await readFile(checkFile(id), "utf8")); } catch { /* never checked */ }
  const now = await inUse(id), job = jobs.get(id + "/check"), drawn = Object.keys(now).length;
  const changed = c ? Object.keys(now).filter((k) => c.checked[k] !== now[k]) : Object.keys(now);
  const open = c ? c.faults.filter((f) => !c.verdicts[f.id] && now[f.panel] === f.image).length : 0;
  return { check: c, drawn, changed, open, job: job ? { status: job.status, msg: job.msg || "", at: job.at || job.queued, now: Date.now() } : null };
}
async function assetCheck(job) {
  const id = job.project, proj = projDir(id), dir = join(proj, "art", "check"), report = join(dir, "report.json"), task = join(dir, "CHECK_TASK.md"), t0 = Date.now();
  await mkdir(dir, { recursive: true }); await rm(report, { force: true });
  const made = JSON.parse((await run("/usr/bin/python3", [join(APP, "tools/asset_lineup.py"), proj, ...(await pagesFor(id))])).trim().split("\n").pop());
  if (!made.tiles) throw new Error("Nothing to check yet: no drawn picture has a labelled face, a place or a prop in it.");
  const L = JSON.parse(await readFile(join(dir, "lineups.json"), "utf8")), act = Object.fromEntries(L.panels.map((p) => [p.panel, p.action]));
  const role = await readFile(join(APP, "agents/checker/role.md"), "utf8"), data = join(dir, "CHECK_DATA.json");
  await dataFile(data, { groups: L.groups.map((g) => ({ name: g.name, kind: g.kind, description: g.desc || "none given", approved_sheet: g.sheet || null, lineups: g.lineups.map((f) => join(proj, f)),
    tiles: g.tiles.map((t) => ({ n: t.n, page: t.page, panel: t.panel, face_labelled: !!t.face, whole_picture: join(proj, t.image), what_happens: act[t.panel] || "not said" })) })) });
  await writeFile(task, [role, "", "## This check", "", "Do NOT generate, edit or save any picture, and write no file: you cannot write here. Where the instructions above say to write one JSON file, give that JSON as your final message instead, and nothing else.", "", DATA_RULE, "",
    `Everything to check is in the DATA file \`${data}\`: for each character, place and prop its description, its approved sheet (null = none: compare the tiles with each other and the description), its line-up pictures and its tiles (number, page, panel, whether a face was labelled or the tile is the whole picture, the whole picture's file, and what happens in that panel). Open the pictures it names.`].join("\n"));
  let got; try { got = jsonFrom(await codexLook(dir, `Read the task file ${task} and follow it exactly: look at the pictures it lists and answer with one JSON object as your final message. Do not generate images and write no files.`, { minutes: 25 })); await writeFile(report, JSON.stringify(got, null, 1)); }
  catch (e) { throw new Error("The Checker finished without a readable answer" + (/Codex/.test(e.message) ? ": " + e.message : "")); }
  let old = null; try { old = JSON.parse(await readFile(checkFile(id), "utf8")); } catch { /* first check */ }
  const faults = [];
  for (const f of Array.isArray(got.faults) ? got.faults : []) {
    const g = L.groups.find((x) => x.name.toLowerCase() === String(f && f.name).toLowerCase().trim()), t = g && g.tiles.find((x) => x.n === +f.tile); if (!t || !String(f.what || "").trim()) continue;
    const about = ABOUT.includes(f.about) ? f.about : "other";
    faults.push({ id: [g.name, t.panel, t.image, about].join("|"), name: g.name, kind: g.kind, tile: t.n, panel: t.panel, page: t.page, image: t.image, about, what: String(f.what).trim().slice(0, 400), sure: SURE.includes(f.sure) ? f.sure : "medium" });
  }
  const verdicts = {}; for (const f of faults) if (old && old.verdicts && old.verdicts[f.id]) verdicts[f.id] = old.verdicts[f.id]; // "It is fine" holds while the same picture is in use
  await writeFile(checkFile(id), JSON.stringify({ at: new Date().toISOString(), took: Date.now() - t0, checked: L.checked, pictures: made.pictures,
    groups: L.groups.map((g) => ({ name: g.name, kind: g.kind, sheet: g.sheetUrl, lineups: g.lineups, tiles: g.tiles })), faults,
    sheetNotes: (Array.isArray(got.sheet_notes) ? got.sheet_notes : []).filter((n) => n && n.name && n.what).slice(0, 20).map((n) => ({ name: String(n.name).slice(0, 80), what: String(n.what).slice(0, 400) })), verdicts }, null, 1));
  job.msg = faults.length ? `${faults.length} to look at` : "Nothing found";
}
async function draw(job) {
  if (job.kind === "check") return assetCheck(job);
  if (job.kind === "anime") return animeDraw(job); // a shot's still or a look sheet on the anime side
  if (job.kind === "paneler") return storyboard(job);
  if (job.kind === "create") return runCreate(SAVED, job);
  if (job.kind === "look") return lookAgain(job);
  if (job.kind === "sheet") return drawSheet(job);
  const proj = projDir(job.project), saved = join(SAVED, job.project + ".json"), panels = join(proj, "art", "panels");
  const out = await run("node", [join(APP, "tools/artist_requests.mjs"), proj, saved, join(SAVED, "refs"), "--only", job.panel, "--auto"]);
  const lines = out.trim().split("\n"), list = lines[lines.length - 1].startsWith("[") ? JSON.parse(lines[lines.length - 1]) : [];
  if (!list.length) throw new Error("that panel has no request waiting");
  { // a series that only draws approved characters (every book starts that way): nobody is drawn from words alone
    let bb = {}; try { bb = JSON.parse(await readFile(join(proj, "bible.json"), "utf8")); } catch { /* no settings */ }
    const lack = bb.strict ? (list[0].who || []).map((w) => w.name).filter((n) => { const c = (bb.cast || {})[n]; return !(c && (c.ref || c.sheet) && c.approved !== false); }) : [];
    if (lack.length) throw new Error(`Not drawn: ${lack.join(" and ")} ${lack.length === 1 ? "has" : "have"} no approved character sheet. Add or approve ${lack.length === 1 ? "it" : "them"} in Series.`);
  }
  const task = lines[lines.length - 2], pic = list[0].save;
  job.model = list[0].source === "openrouter" ? list[0].model : "codex";
  if (list[0].source === "openrouter") { // a picked OpenRouter model: the server sends the prompt and the references itself
    const r = await routeModel(SAVED, "picture", { service: "openrouter", model: list[0].model, quality: list[0].quality });
    const est = await estimate("picture", r.model, { quality: r.quality, size: list[0].size, refs: list[0].refs.length, chars: list[0].prompt.length });
    const free = await guardSpend(SAVED, est, "This picture", job.ok);
    job.msg = "Sent to " + r.model.split("/").pop();
    const got = await orPicture(r.key, r.model, { prompt: list[0].prompt, size: list[0].size, refs: list[0].refs, quality: r.quality }).catch((e) => { free(); throw e; });
    await logSpend(SAVED, { project: job.project, what: "panel " + job.panel, kind: "picture", model: r.model, quality: r.quality, usd: got.cost, est });
    await mkdir(dirname(pic), { recursive: true }); await writeFile(pic, got.bytes); delete job.msg;
    if (got.cost != null) job.cost = got.cost;
    await writeFile(pic + ".faces.json", "[]"); // nobody labelled yet: the second look below finds the storyboard's people
  } else
  await codex(panels, `Read the task file ${task} and follow it exactly. It is one manga panel picture made with your built-in image generation tool: send the text of its Prompt data file exactly as written, at the size given, with the pictures listed under Attach in that order. Save the result at the Save as path, write the faces file and the report the task asks for, then stop.`);
  if (!existsSync(pic)) throw new Error("Codex finished without saving the picture (it may have been blocked; see the report in art/panels)");
  // who is where, as Codex saw it: lets the Letterer aim balloons and the character bank offer "save"
  let faces = [], cast = {}, absent = [];
  try { faces = JSON.parse(await readFile(pic + ".faces.json", "utf8")).filter((f) => f && f.who && Array.isArray(f.box) && f.box.length === 4); } catch { /* no faces file: the picture still lands */ }
  try { cast = JSON.parse(await readFile(join(proj, "bible.json"), "utf8")).cast || {}; } catch { /* no bible */ }
  const names = Object.keys(cast), low = (s) => String(s).toLowerCase().trim(); // Codex may write "Old Tobias" for the cast's "Tobias": use the cast's own spelling
  for (const f of faces) { const hit = names.find((n) => low(n) === low(f.who)) || names.find((n) => low(f.who).includes(low(n)) || low(n).includes(low(f.who))); if (hit) f.who = hit; }
  // every character the storyboard put in this panel needs a labelled face: ask once more for anyone missing
  const missing = (list[0].who || []).concat((list[0].voices || []).map((name) => ({ name, voice: true }))).filter((w) => !faces.some((f) => low(f.who) === low(w.name)));
  if (missing.length) {
    job.msg = `Drawn. Looking again for ${missing.map((w) => w.name).join(", ")}`;
    try { const more = await secondLook(pic, missing, faces, cast); faces.push(...more.faces); absent = more.absent; } catch { /* still unlabelled: the editor falls back to the storyboard's position */ }
    delete job.msg;
  }
  await oneAtATime(async () => {
  try {
    const ff = join(proj, "art", "faces.json"), all = existsSync(ff) ? JSON.parse(await readFile(ff, "utf8")) : {}, stem = pic.split("/").pop().replace(/\.png$/, "");
    all[stem] = faces; if (absent.length) all[stem + ":absent"] = absent;
    await writeJson(ff, all);
  } catch { /* the picture still lands */ }
  await run("/usr/bin/python3", [join(APP, "tools/artist_panel.py"), proj, job.panel, pic]);
  });
}
// The queue is written to disk at every change, so a restart (of the editor or the computer) carries on where it stopped.
const QUEUE = join(SAVED, "queue.json");
// Several pictures are drawn at once (each is its own Codex run); what they write into the project is done one at a time.
const WORKERS = Math.max(1, Math.min(4, +process.env.STUDIO_DRAWERS || 2)), running = new Set();
let chain = Promise.resolve();
const oneAtATime = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };
async function persist() {
  try { await mkdir(SAVED, { recursive: true }); await writeFile(QUEUE, JSON.stringify([...running].concat(line).map((j) => ({ project: j.project, panel: j.panel, kind: j.kind, name: j.name, thing: j.thing, pid: j.pid, queued: j.queued, scene: j.scene, what: j.what, shot: j.shot, pick: j.pick, cid: j.cid, orJob: j.orJob, model: j.model, look: j.look, ok: j.ok })))); } catch { /* the queue still runs */ }
}
async function pump() {
  await persist();
  while (running.size < WORKERS && line.length) {
    const job = line.shift(); job.status = "drawing"; job.at = Date.now(); running.add(job);
    (async () => {
      try { job.expect = await expectFor(SAVED, job); } catch { /* shown without a bar */ }
      try { await draw(job); job.status = "done"; } catch (e) { job.status = "failed"; job.msg = String(e.message || e).slice(0, 300); }
      job.took = Date.now() - job.at; running.delete(job); await recordDone(SAVED, job); pump();
    })();
  }
}
// The anime side draws through this same queue: one line for the whole studio.
useQueue({
  save: () => persist(), // a job's OpenRouter number is kept the moment it is sent
  add(a) { const project = "anime~" + a.scene, panel = a.what === "sheet" ? "sheet:" + a.name : a.what === "check" ? "check" : a.what === "video" ? "video:" + a.shot : a.shot, key = project + "/" + panel, old = jobs.get(key);
    if (!old || old.status === "done" || old.status === "failed") { const job = { ...a, project, panel, kind: "anime", status: "waiting", queued: Date.now() }; jobs.set(key, job); line.push(job); pump(); }
    return jobs.get(key); },
  of: (scene) => [...jobs.values()].filter((j) => j.kind === "anime" && j.scene === scene),
});
async function resumeQueue() { // jobs that were waiting, or half done, when the server last stopped
  let old = []; try { old = JSON.parse(await readFile(QUEUE, "utf8")); } catch { return; }
  for (const j of old) { if (!j || !j.project || !j.panel || (j.kind !== "anime" && j.kind !== "create" && !existsSync(projDir(j.project)))) continue;
    if (j.kind === "anime" && j.what === "video" && !j.orJob) { await recordDropped(SAVED, j, "Stopped by a restart before it was sent. Press Make a video again."); continue; }
    if (j.kind === "create" && !(await abandonCreate(SAVED, j.cid))) { await recordDropped(SAVED, j, "Stopped by a restart. Press Make again in Create."); continue; } // never re-sent by itself: it may be paid for already // a paid video is never sent again by itself: it may already have been paid for; the person presses again
    const job = { ...j, status: "waiting", resumed: true }; jobs.set(j.project + "/" + j.panel, job); line.push(job); }
  if (line.length) { console.log(`Carrying on with ${line.length} job${line.length === 1 ? "" : "s"} from before the restart`); pump(); }
}

/** What was sent, up to a limit that fits the route (1 MB unless it asks for more): nobody fills the memory or the disk with one request. */
const body = (req, limit = 1 * MB) => readBody(req, limit);

/** A request that failed, answered with what went wrong (19 Nov 2026: every failure used to answer "404 not found" and nothing was
 * logged, so a failed save looked like a missing page). Missing file = 404; bad request = 400; too large = 413; the rest = 500, logged. */
function failed(req, res, e) {
  const sent = e instanceof SyntaxError && req.method !== "GET"; // a body that is not JSON is the sender's mistake; a saved file that is not JSON is ours
  const code = e && (e.status || (e.code === 413 ? 413 : e.code === "ENOENT" || e.code === 404 ? 404 : sent ? 400 : 500));
  const msg = code === 404 ? "not found" : sent ? "What was sent is not readable JSON." : e instanceof SyntaxError ? "A saved file could not be read: " + e.message : String((e && e.message) || e).slice(0, 300);
  if (code >= 500) console.error(new Date().toISOString(), req.method, req.url.split("?")[0], (e && e.stack) || e);
  if (res.headersSent) { res.destroy(); return; }
  res.statusCode = code; const api = req.url.startsWith("/api/");
  res.setHeader("content-type", api ? "application/json" : "text/plain; charset=utf-8");
  res.end(api ? JSON.stringify({ error: msg }) : msg);
}

http.createServer(async (req, res) => {
  let url; try { url = new URL(req.url, "http://x"); } catch { res.statusCode = 400; return res.end("bad address"); } // "//" and the like: answered, never thrown (a throw here stops the whole app)
  try {
    res.setHeader("x-content-type-options", "nosniff");
    if (!(await gate(req, res, url, SAVED))) return; // not this computer, not a device that typed the code, or sent by another web site
    if (url.pathname === "/api/ping") return res.end("ok");
    if (url.pathname === "/api/spec" && req.method === "GET") {
      try { const f = specFile(url); res.setHeader("content-type", "application/json"); return res.end(await readFile(f)); }
      catch { res.statusCode = 404; res.setHeader("content-type", "application/json"); return res.end("{}"); }
    }
    if (url.pathname === "/api/spec" && req.method === "PUT") {
      let f; try { f = specFile(url); } catch { res.statusCode = 404; return res.end("no such project"); }
      const b = await body(req, 40 << 20);
      let doc; try { doc = JSON.parse(b.toString()); checkSpec(doc); } catch (e) { res.statusCode = e.status || 400; return res.end("not saved: " + String(e.message || e).slice(0, 120)); }
      { // a tab opened before "Storyboard again" still holds the old board: its save would wipe the new pages and every queued picture
        const id = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_"), cur = join(ROOT, "projects", id, "spec.json");
        if (id && existsSync(cur)) { let at = ""; try { at = JSON.parse(await readFile(cur, "utf8")).boardAt || ""; } catch { /* unreadable: allow */ }
          if (at && (doc.boardAt || "") < at) { res.statusCode = 409; res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ error: "This chapter was storyboarded again since this page was opened. Reload to see the new pages; this save was not kept." })); } }
      }
      await mkdir(SAVED, { recursive: true }); await lockDoc(f, () => writeAtomic(f, b));
      return res.end("saved");
    }
    if (url.pathname === "/api/projects" && req.method === "GET") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(await listProjects())); }
    if (url.pathname === "/api/projects" && req.method === "POST") { // a new project from a script; the Paneler starts straight away
      res.setHeader("content-type", "application/json");
      try {
        const id = await createProject(JSON.parse((await body(req, 4 * MB)).toString()));
        await startStoryboard(id, null, okFrom(req));
        return res.end(JSON.stringify({ id }));
      } catch (e) { res.statusCode = e.status || 400; return res.end(JSON.stringify({ error: String(e.message || e) })); }
    }
    if (url.pathname === "/api/series") {
      res.setHeader("content-type", "application/json");
      const id = clean(url.searchParams.get("id"));
      if (req.method === "POST") { // a new book: the file is the request body
        try { return res.end(JSON.stringify({ id: await createSeries({ name: url.searchParams.get("name"), file: url.searchParams.get("file"), style: url.searchParams.get("style"), reading: url.searchParams.get("reading") }, await body(req, 50 * MB)) })); }
        catch (e) { res.statusCode = e.status || 400; return res.end(JSON.stringify({ error: String(e.message || e).slice(0, 300) })); }
      }
      if (!id) return res.end(JSON.stringify(await listSeries()));
      const s = await readSeries(id), all = await listProjects();
      for (const c of s.chapters) { const p = c.project && all.find((q) => q.id === c.project); c.state = p ? { pages: p.pages, panels: p.panels, drawn: p.drawn, lettered: p.lettered, exported: p.exported, storyboard: p.storyboard } : null; if (!p) delete c.project; }
      return res.end(JSON.stringify(Object.assign({ id }, s)));
    }
    if (url.pathname === "/api/series/cast") { // the book's people and places
      res.setHeader("content-type", "application/json");
      const id = clean(url.searchParams.get("id")); if (!id || !existsSync(join(SERIES, id, "series.json"))) { res.statusCode = 404; return res.end("{}"); }
      if (req.method === "POST") startCasting(id, url.searchParams.get("fresh") === "1");
      if (req.method === "PUT") { try { const b = JSON.parse((await body(req, 1 * MB)).toString()); if (b.rename) await renameInCast(id, b.rename); else await addFromCast(id, b); } catch (e) { res.statusCode = e.status || 400; return res.end(JSON.stringify({ error: String(e.message || e).slice(0, 200) })); } }
      let cast = null, bible = {}; try { cast = JSON.parse(await readFile(join(SERIES, id, "cast.json"), "utf8")); } catch { /* not read yet */ }
      try { bible = JSON.parse(await readFile(join(SERIES, id, "bible.json"), "utf8")); } catch { /* none */ }
      const job = casting.has(id) && !(await castJob(id)) ? { status: "reading", done: 0, total: 0, now: Date.now() } : await castJob(id);
      return res.end(JSON.stringify({ job, cast, in_cast: Object.keys(bible.cast || {}), in_places: Object.keys(bible.places || {}) }));
    }
    if (url.pathname === "/api/series/chapter") {
      res.setHeader("content-type", "application/json");
      const id = clean(url.searchParams.get("id")), chId = clean(url.searchParams.get("ch"));
      if (req.method === "POST") { // start drawing this chapter: it becomes a project
        try { return res.end(JSON.stringify({ project: await startChapter(id, chId) })); }
        catch (e) { res.statusCode = e.status || 400; return res.end(JSON.stringify({ error: String(e.message || e).slice(0, 300) })); }
      }
      const s = await readSeries(id), ch = s.chapters.find((c) => c.id === chId);
      if (!ch) { res.statusCode = 404; return res.end("{}"); }
      return res.end(JSON.stringify({ title: ch.title, paragraphs: (await chapterRows(id, ch)).map((r) => ({ id: r.source_id, text: r.text })) }));
    }
    if (url.pathname === "/api/storyboard" && req.method === "POST") { // run the Paneler again on a project made in the app; the body may carry { note } for the Paneler
      const id = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_");
      if (!existsSync(join(ROOT, "projects", id, "script.md"))) { res.statusCode = 404; return res.end("{}"); }
      let note = null; try { const b = JSON.parse((await body(req, 64 * KB)).toString() || "{}"); if (typeof b.note === "string") note = b.note; } catch { /* no note */ }
      res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(await startStoryboard(id, note, okFrom(req))));
    }
    if (url.pathname === "/api/cover" && req.method === "PUT") { // add, change or (empty text) remove the chapter's cover page
      const id = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_"), dir = join(ROOT, "projects", id), f = join(dir, "cover.json");
      if (!existsSync(join(dir, "board.json"))) { res.statusCode = 404; return res.end("{}"); }
      const b = JSON.parse((await body(req, 64 * KB)).toString()), action = String(b.action || "").trim().slice(0, 1500);
      let old = {}; try { old = JSON.parse(await readFile(f, "utf8")); } catch { /* no cover yet */ }
      if (!action) await rm(f, { force: true }); else await writeJson(f, ({ action, title: String(b.title || "").trim().slice(0, 120), rev: (old.rev || 0) + 1 }));
      await oneAtATime(() => run("node", [join(APP, "tools/build_spec.mjs"), dir]));
      return res.end("{}");
    }
    if (url.pathname === "/api/styles") {
      res.setHeader("content-type", "application/json");
      if (req.method === "POST") { try { return res.end(JSON.stringify(await saveOwnStyle(JSON.parse((await body(req, 25 * MB)).toString())))); } catch (e) { res.statusCode = e.status || 400; return res.end(JSON.stringify({ error: String(e.message || e) })); } }
      if (req.method === "DELETE") { const id = url.searchParams.get("id"); await lockDoc(OWN_STYLES, async () => writeJson(OWN_STYLES, (await ownStyles()).filter((q) => q.id !== id))); }
      return res.end(JSON.stringify(await allStyles()));
    }
    if (url.pathname.startsWith("/own-style/")) { const f = join(SAVED, "styles", url.pathname.split("/").pop().replace(/[^\w.-]/g, "_")); res.setHeader("content-type", f.endsWith(".png") ? "image/png" : "image/jpeg"); return res.end(await readFile(f)); }
    if (url.pathname === "/api/cast/rename" && req.method === "POST") {
      res.setHeader("content-type", "application/json");
      try { const b = JSON.parse((await body(req, 64 * KB)).toString()); return res.end(JSON.stringify({ chapters: await oneAtATime(() => renameCharacter((url.searchParams.get("p") || "").replace(/[^\w-]/g, "_"), String(b.from || ""), b.to)) })); }
      catch (e) { res.statusCode = e.status || 400; return res.end(JSON.stringify({ error: String(e.message || e).slice(0, 200) })); }
    }
    if (url.pathname === "/api/project") { // what the editor needs to know about a project made in the app
      const id = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_"), f = join(ROOT, "projects", id, "project.json"), job = jobs.get(id + "/paneler");
      res.setHeader("content-type", "application/json");
      if (!existsSync(f)) return res.end(JSON.stringify({ own: false }));
      const meta = JSON.parse(await readFile(f, "utf8"));
      let cover = null; try { cover = JSON.parse(await readFile(join(ROOT, "projects", id, "cover.json"), "utf8")); } catch { /* none */ }
      return res.end(JSON.stringify({ own: true, reading: meta.reading === "rtl" ? "rtl" : "ltr", note: meta.paneler_note || "", cover, title: meta.title || "", name: meta.name || "", chapter: meta.chapter, storyboard: job ? { status: job.status, msg: job.msg, at: job.at, now: Date.now() } : null }));
    }
    if (url.pathname === "/api/faces/look" && req.method === "POST") { // look again at a drawn panel for people with no labelled face
      const id = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_"), pid = (url.searchParams.get("panel") || "").replace(/[^\w-]/g, "_"), key = id + "/look:" + pid, old = jobs.get(key);
      if (!old || old.status === "done" || old.status === "failed") { const job = { project: id, panel: "look:" + pid, pid, kind: "look", status: "waiting", queued: Date.now() }; jobs.set(key, job); line.push(job); pump(); }
      res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(jobs.get(key)));
    }
    if (url.pathname === "/api/faces" && req.method === "PUT") { // faces named or moved by hand on a drawn picture
      const id = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_"), src = url.searchParams.get("src") || "", proj = projDir(id), lf = join(proj, "art", "library.json");
      const b = JSON.parse((await body(req, 1 * MB)).toString());
      const done = await oneAtATime(async () => { // the same line as the jobs that write the art list: nobody's faces are written over
      const lib = JSON.parse(await readFile(lf, "utf8")), entry = lib.find((e) => e.src === src);
      if (!entry || !Array.isArray(b.protect)) return false;
      const c01 = (v) => Math.round(Math.min(1, Math.max(0, +v)) * 1000) / 1000;
      entry.protect = b.protect.filter((f) => f && typeof f.who === "string" && f.who.trim() && Array.isArray(f.box) && f.box.length === 4 && f.box.every((v) => Number.isFinite(+v)))
        .map((f) => Object.assign({ who: f.who.trim().slice(0, 80), box: f.box.map(c01) }, f.by ? { by: String(f.by).slice(0, 20) } : {})).filter((f) => f.box[2] > f.box[0] && f.box[3] > f.box[1]);
      if (entry.absent) entry.absent = entry.absent.filter((n) => !entry.protect.some((f) => f.who === n));
      entry.faces = "set by hand";
      await writeJson(lf, lib); await rebuild(proj); return true; });
      if (!done) { res.statusCode = 400; return res.end("No such picture in the art list, or no faces were sent."); }
      return res.end("saved");
    }
    if (url.pathname === "/api/bible" && req.method === "PUT") { // series settings: style text and the cast's looks
      const id = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_"), b = JSON.parse((await body(req, 4 * MB)).toString());
      if (!b || typeof b.cast !== "object" || !existsSync(join(projDir(id), "spec.json"))) { res.statusCode = 400; return res.end("bad"); }
      const bf = join(projDir(id), "bible.json"), err = await lockDoc(bf, async () => {
        let old = {}; try { old = JSON.parse(await readFile(bf, "utf8")); } catch { /* none yet */ }
        try { checkBible(b, old); } catch (e) { return e.message; }
        await writeJson(bf, b); return ""; });
      if (err) { res.statusCode = 400; return res.end("not saved: " + err); }
      return res.end("saved");
    }
    if (url.pathname === "/api/sheet") {
      const id = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_"), name = url.searchParams.get("name") || "", dir = projDir(id), thing = FIELD[url.searchParams.get("kind")] ? url.searchParams.get("kind") : "";
      res.setHeader("content-type", "application/json");
      if (req.method === "PUT") { // an uploaded sheet
        const d = JSON.parse((await body(req, 25 * MB)).toString()), m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(d.dataUrl || "");
        if (!m || !name || reserved(name)) { res.statusCode = 400; return res.end(JSON.stringify({ error: reserved(name) ? "That cannot be used as a name." : "Send a png or jpg picture and a name." })); }
        await mkdir(join(dir, "bank"), { recursive: true });
        const f = join(dir, "bank", `${slugOf(name)}-upload-${Date.now().toString(36)}.${m[1] === "png" ? "png" : "jpg"}`);
        await writeFile(f, Buffer.from(m[2], "base64")); await setSheet(dir, name, f, true, thing); return res.end("{}");
      }
      if (req.method === "POST") { // draw one with Codex
        if (!name || reserved(name)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "That cannot be used as a name." })); }
        const tag = "sheet:" + (thing ? thing + ":" : "") + name, key = id + "/" + tag, old = jobs.get(key);
        if (!old || old.status === "done" || old.status === "failed") { const job = { project: id, panel: tag, name, thing, kind: "sheet", status: "waiting", queued: Date.now() }; jobs.set(key, job); line.push(job); pump(); }
        return res.end(JSON.stringify(jobs.get(key)));
      }
    }
    if (url.pathname === "/api/generate" && req.method === "POST") { // start drawing a queued panel
      const project = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_"), panel = (url.searchParams.get("panel") || "").replace(/[^\w-]/g, "_"), key = project + "/" + panel;
      const old = jobs.get(key);
      if (!old || old.status === "done" || old.status === "failed") { const job = { project, panel, status: "waiting", queued: Date.now(), ok: okFrom(req) }; jobs.set(key, job); line.push(job); pump(); }
      res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(jobs.get(key)));
    }
    if (url.pathname === "/api/check") { // the asset checker: its last answer, start a check, or the person's word on one fault
      const id = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_"); res.setHeader("content-type", "application/json");
      if (!existsSync(join(projDir(id), "spec.json"))) { res.statusCode = 404; return res.end(JSON.stringify({ error: "No such project." })); }
      if (req.method === "POST") { const key = id + "/check", old = jobs.get(key);
        if (!old || old.status === "done" || old.status === "failed") { const job = { project: id, panel: "check", kind: "check", status: "waiting", queued: Date.now() }; jobs.set(key, job); line.push(job); pump(); } }
      if (req.method === "PUT") { const b = JSON.parse(await body(req, 64 * KB));
        await oneAtATime(async () => { const c = JSON.parse(await readFile(checkFile(id), "utf8")); if (!c.faults.some((f) => f.id === b.id)) return;
          if (["fine", "sheet", "redrawn"].includes(b.verdict)) c.verdicts[b.id] = b.verdict; else delete c.verdicts[b.id]; await writeJson(checkFile(id), c); }); }
      return res.end(JSON.stringify(await checkState(id)));
    }
    if (url.pathname === "/api/queue") { // the whole studio's work in progress, for the status bar
      const all = [...jobs.values()], n = (st) => all.filter((j) => j.status === st).length;
      res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ working: n("drawing"), waiting: n("waiting") }));
    }
    if (url.pathname === "/api/jobs") {
      const project = url.searchParams.get("p");
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify([...jobs.values()].filter((j) => j.project === project && j.kind !== "paneler" && j.kind !== "check").map((j) => ({ ...j, ahead: j.status === "waiting" ? line.indexOf(j) + (running.size >= WORKERS ? 1 : 0) : 0, now: Date.now() }))));
    }
    if (url.pathname === "/api/ref") { // uploaded reference pictures
      const f = join(SAVED, "refs", (url.searchParams.get("id") || "x").replace(/[^\w-]/g, "_") + ".json");
      if (req.method === "PUT") { const b = await body(req, 25 * MB); JSON.parse(b.toString()); await mkdir(join(SAVED, "refs"), { recursive: true }); await writeFile(f, b); return res.end("saved"); }
      try { res.setHeader("content-type", "application/json"); return res.end(await readFile(f)); } catch { res.statusCode = 404; return res.end("{}"); }
    }
    if (url.pathname === "/api/export" && req.method === "POST") { // one page; with p= it belongs to a chapter export
      const name = (url.searchParams.get("name") || "page.png").replace(/[^\w.-]/g, "_"), proj = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_");
      const dir = proj ? join(SAVED, "exports", proj) : join(SAVED, "exports");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, name), await body(req, 40 * MB));
      return res.end("exported");
    }
    if (url.pathname === "/api/exports") { // the last chapter export of a project
      const proj = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_"), dir = join(SAVED, "exports", proj);
      if (req.method === "DELETE") { if (proj) await rm(dir, { recursive: true, force: true }); return res.end("cleared"); }
      let names = []; try { names = (await readdir(dir)).filter((n) => n.endsWith(".png")).sort(); } catch { /* none yet */ }
      const out = []; for (const n of names) out.push({ name: n, url: `/exports/${proj}/${n}`, at: (await stat(join(dir, n))).mtimeMs });
      res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(out));
    }
    if (url.pathname === "/api/export-x") { // the exported chapter for posting: JPEGs, numbered, in sets of 20 (one set = one post)
      const proj = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_"), dir = join(SAVED, "exports", proj), zip = join(SAVED, "exports", proj + "-x.zip");
      await run("/usr/bin/python3", ["-c", `
import sys, zipfile, os, io
from PIL import Image
d, per = sys.argv[1], 20
names = sorted(n for n in os.listdir(d) if n.endswith('.png'))
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_STORED) as z:
    for i, n in enumerate(names):
        im = Image.open(os.path.join(d, n)).convert('RGB'); im.thumbnail((1365, 2048), Image.LANCZOS)
        b = io.BytesIO(); im.save(b, 'JPEG', quality=92, optimize=True)
        sets = (len(names) + per - 1) // per
        z.writestr((f'post-{i // per + 1:02d}/' if sets > 1 else '') + f'{i % per + 1:02d}.jpg', b.getvalue())
`, dir, zip]);
      res.setHeader("content-type", "application/zip"); res.setHeader("content-disposition", `attachment; filename="${proj}-for-x.zip"`);
      return res.end(await readFile(zip));
    }
    if (url.pathname === "/api/series/zip") { // every exported chapter of a book, one folder a chapter
      const id = clean(url.searchParams.get("id")), s = await readSeries(id), zip = join(SAVED, "exports", "book-" + id + ".zip");
      const pairs = s.chapters.filter((c) => c.project && existsSync(join(SAVED, "exports", c.project))).map((c) => `chapter-${String(c.number).padStart(2, "0")}=${join(SAVED, "exports", c.project)}`);
      if (!pairs.length) { res.statusCode = 404; return res.end("nothing exported yet"); }
      await run("/usr/bin/python3", ["-c", "import sys,zipfile,os\nwith zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_STORED) as z:\n    for a in sys.argv[2:]:\n        k,d=a.split('=',1)\n        [z.write(os.path.join(d,n),k+'/'+n) for n in sorted(os.listdir(d)) if n.endswith('.png')]", zip, ...pairs]);
      res.setHeader("content-type", "application/zip"); res.setHeader("content-disposition", `attachment; filename="${id}-pages.zip"`);
      return res.end(await readFile(zip));
    }
    if (url.pathname === "/api/export-zip") {
      const proj = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_"), dir = join(SAVED, "exports", proj), zip = join(SAVED, "exports", proj + ".zip");
      await run("/usr/bin/python3", ["-c", "import sys,zipfile,os\nd=sys.argv[1]\nwith zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_STORED) as z:\n    [z.write(os.path.join(d,n),n) for n in sorted(os.listdir(d)) if n.endswith('.png')]", dir, zip]);
      res.setHeader("content-type", "application/zip"); res.setHeader("content-disposition", `attachment; filename="${proj}-pages.zip"`);
      return res.end(await readFile(zip));
    }
    if (url.pathname.startsWith("/exports/")) { // exported pages, to open or save
      const [, , proj, name] = url.pathname.split("/");
      const f = join(SAVED, "exports", String(proj).replace(/[^\w-]/g, "_"), String(name).replace(/[^\w.-]/g, "_"));
      res.setHeader("content-type", "image/png"); return res.end(await readFile(f));
    }
    if (await connections(req, res, url, SAVED)) return; // /connections and /api/connections*
    if (await models(req, res, url, SAVED)) return;
    if (await spend(req, res, url, SAVED)) return;
    if (await assistant(req, res, url, SAVED)) return; // /api/assistant
    if (await work(req, res, url, SAVED, jobs)) return; // /api/work
    if (await gpuPricesRoute(req, res, url)) return; // /api/gpu-prices
    if (await create(req, res, url, { saved: SAVED, projDir, projects: listProjects, queue: (j) => { const job = { ...j, status: "waiting", queued: Date.now() }; jobs.set(j.project + "/" + j.panel, job); line.push(job); pump(); return job; } })) return; // /create and /api/create* // /api/spend: this month's spending, the cap, OpenRouter credit // /api/models: the picker's lists and choices
    if (await anime(req, res, url)) return; // /anime/ screens and /api/anime/*
    let p; try { p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ""); } catch { throw Object.assign(new Error("bad address"), { status: 400 }); }
    if (!p) p = "index.html";
    const file = staticFile(p);
    if (!file) { res.statusCode = 404; return res.end("not found"); }
    let data = await readFile(file);
    if (p === "index.html") data = SKELETON + data + "</body></html>";
    res.setHeader("content-type", TYPES[extname(file)] || "application/octet-stream");
    res.end(data);
  } catch (e) { failed(req, res, e); }
}).listen(PORT, async () => { console.log(`Ibasho: http://localhost:${PORT}`); try { console.log(process.env.STUDIO_OPEN === "1" ? "Open to every device on the network (STUDIO_OPEN=1)." : `Other devices need the access code once: ${await accessCode(SAVED)}`); } catch { /* shown in Settings */ } resumeQueue(); refreshIfOld(SAVED); });
