#!/usr/bin/env node
// Ibasho MCP server: lets an agent (Claude Code, Codex, any MCP client) work the studio the way a person does.
// It talks to the RUNNING app over its own /api routes, so the app and the agent never disagree.
//
//   node page-editor/mcp.mjs            (stdio; the app must be running: node page-editor/server.mjs)
//   IBASHO_URL     where the app is (default http://127.0.0.1:5178)
//   IBASHO_CHROME  a Chrome/Chromium binary, for view_page and export_pages (found by itself when it can be)
//
// Same rules as the screens: paid jobs are estimated first and wait for the person's yes over their "ask me first"
// amount, the monthly cap is respected, strict books refuse characters with no approved sheet, and nothing here
// deletes saved work unless the call says `destructive: true`.
// Node built-ins only. Text is measured with Pillow (already needed by the app) so lettering matches the browser closely.
import { createRequire } from "node:module";
import { execFileSync, execFile } from "node:child_process";
import { existsSync, readdirSync, mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require("./render.js"); // sets globalThis.PageRender (no DOM in it)
const R = globalThis.PageRender;
const Artist = require("../core/artist.js");
const Paneler = require("../core/paneler.js");
const Director = require("../core/director.js");
const BASE = (process.env.IBASHO_URL || "http://127.0.0.1:5178").replace(/\/+$/, "");
const clone = (v) => JSON.parse(JSON.stringify(v));
const enc = encodeURIComponent;
class Stop extends Error {} // a refusal with a plain reason: shown to the agent as the tool's answer

// ---------------------------------------------------------------- talking to the app
/** ok = what the person agreed to spend on this call: the app refuses a paid job over their "ask me first" amount without it. */
const okHead = (est, approved) => (approved > 0 ? { "x-ibasho-ok": String(approved), "x-ibasho-asked": "1" } : est > 0 ? { "x-ibasho-ok": String(est) } : {});
async function api(method, path, { json, raw, type, as = "auto", ok } = {}) {
  let res;
  try {
    res = await fetch(BASE + (path.startsWith("/") ? path : "/" + path), { method, body: json !== undefined ? JSON.stringify(json) : raw,
      headers: { ...(json !== undefined ? { "content-type": "application/json" } : type ? { "content-type": type } : {}), ...(process.env.IBASHO_CODE ? { "x-ibasho-access": process.env.IBASHO_CODE } : {}), ...(ok || {}) } }); // IBASHO_CODE: the access code, needed when the app runs on another computer
  } catch (e) { throw new Stop(`Ibasho is not answering at ${BASE}. Start it with: node page-editor/server.mjs  (or set IBASHO_URL).`); }
  if (as === "response") return res;
  const buf = Buffer.from(await res.arrayBuffer());
  if (as === "buffer") { if (!res.ok) throw new Stop(`${method} ${path} answered ${res.status}`); return buf; }
  const text = buf.toString("utf8"); let data = text;
  try { data = JSON.parse(text); } catch { /* plain text */ }
  if (!res.ok) throw new Stop(`${method} ${path} answered ${res.status}: ${typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`);
  return data;
}
const get = (p) => api("GET", p);
async function getOr(p, fallback) { try { return await get(p); } catch { return fallback; } }

// ---------------------------------------------------------------- measuring text without a browser
const FONT_FILES = { playpen: ["Playpen Sans", "PlaypenSans.ttf", "100 800"], bangers: ["Bangers", "Bangers.ttf", "400"], vollkorn: ["Vollkorn", "Vollkorn.ttf", "400 900"], patrick: ["Patrick Hand", "PatrickHand.ttf", "400"], comicneue: ["Comic Neue", "ComicNeue-Bold.ttf", "700"], kalam: ["Kalam", "Kalam-Bold.ttf", "700"] };
const FAMILY_FILE = Object.fromEntries(Object.values(FONT_FILES).map(([fam, file]) => [fam.toLowerCase(), file]));
const advances = new Map(); // "file|weight" -> { char: advance at 1000 px }
function advanceTable(file, weight) {
  const key = file + "|" + weight;
  if (!advances.has(key)) {
    const py = `
import sys, json
from PIL import ImageFont
f = ImageFont.truetype(sys.argv[1], 1000)
try:
    axes = f.get_variation_axes()
    if axes: f.set_variation_by_axes([min(max(float(sys.argv[2]), a['minimum']), a['maximum']) if a['name'] in (b'Weight', 'Weight') or i == 0 else a['default'] for i, a in enumerate(axes)])
except Exception: pass
chars = [chr(c) for c in list(range(32, 592)) + [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x2022, 0x266a, 0x2665]]
print(json.dumps({c: f.getlength(c) for c in chars}))`;
    let table = null;
    for (const bin of ["/usr/bin/python3", "python3"]) { try { table = JSON.parse(execFileSync(bin, ["-c", py, join(HERE, "fonts", file), String(weight)], { maxBuffer: 1 << 24 }).toString()); break; } catch { /* try the next one */ } }
    if (!table) throw new Stop("Text could not be measured: Python 3 with Pillow is needed (the app needs it too).");
    advances.set(key, table);
  }
  return advances.get(key);
}
function measureText(font, s) {
  const m = /^\s*(\d+)\s+([\d.]+)px\s+(.+)$/.exec(font) || [null, "400", "16", "Playpen Sans"];
  const fam = m[3].split(",")[0].replace(/['"]/g, "").trim().toLowerCase(), t = advanceTable(FAMILY_FILE[fam] || "PlaypenSans.ttf", +m[1]);
  let w = 0; for (const ch of String(s)) w += t[ch] ?? t["n"] ?? 500;
  return (w * +m[2]) / 1000;
}

// ---------------------------------------------------------------- a chapter: the project's built pages + the person's saved edits
const leaves = (rows, out = []) => { for (const row of rows || []) for (const q of row.panels) { if (q.rows && q.rows.length) leaves(q.rows, out); else out.push(q); } return out; };
const eachPanel = (rows, fn) => { for (const row of rows || []) for (const q of row.panels) { fn(q); if (q.rows) eachPanel(q.rows, fn); } };
const panelsOf = (p) => (p.layout ? leaves(p.layout.rows).concat(p.layout.insets || []) : []);
/** The editor's own merge (editor.js mergeSaved), kept word for word in what it does. */
function mergeSaved(original, saved) {
  if ((saved.boardAt || "") !== (original.boardAt || "")) { const fresh = clone(original); for (const k of ["bank", "voices", "styles"]) if (saved[k]) fresh[k] = saved[k]; return fresh; }
  const byId = new Map((saved.pages || []).map((p) => [p.id, p]));
  const mergeOne = (p, s) => {
    if (!s || (p.artTake || "") !== (s.artTake || "")) { const n = clone(p); if (s) { n.number = s.number; n.label = s.label; } return n; }
    if (p.plan) s.plan = clone(p.plan);
    if (p.layout && s.layout) {
      const key = (q) => (q.board ? q.board.action || "" : ""), mineL = leaves(s.layout.rows), want = new Map(leaves(p.layout.rows).map((q) => [key(q), q.id])), have = new Set(mineL.map((q) => q.id));
      for (const q of mineL) { const id = key(q) && want.get(key(q)); if (!id || id === q.id || have.has(id)) continue; for (const it of s.text || []) if (it.panel === q.id) it.panel = id; have.delete(q.id); have.add(id); q.id = id; }
      const mine = new Map(); eachPanel(s.layout.rows, (q) => mine.set(q.id, q)); for (const q of s.layout.insets || []) mine.set(q.id, q);
      const take = (o) => { const q = mine.get(o.id); if (q && o.take && o.take !== q.take) { q.image = o.image; q.take = o.take; delete q.focus; delete q.zoom; delete q.request; } };
      eachPanel(p.layout.rows, take); for (const o of p.layout.insets || []) take(o);
    }
    return s;
  };
  const orig = new Map(original.pages.map((p) => [p.id, p]));
  const pages = (saved.pages || []).filter((s) => orig.has(s.id) || !/^board-cover/.test(s.id)).map((s) => (orig.has(s.id) ? mergeOne(orig.get(s.id), s) : s));
  original.pages.forEach((p, i) => { if (!byId.has(p.id)) pages.splice(Math.min(i, pages.length), 0, clone(p)); });
  return Object.assign({}, saved, { pages, library: original.library, templates: original.templates, script: original.script });
}
async function projectMeta(id) {
  const all = await get("/api/projects"), m = all.find((p) => p.id === id);
  if (!m) throw new Stop(`There is no project "${id}". Projects: ${all.map((p) => p.id).join(", ") || "none yet"}.`);
  return m;
}
async function loadChapter(id) {
  const meta = await projectMeta(id), built = await get("/" + meta.dir + "spec.json");
  const res = await api("GET", "/api/spec?p=" + enc(id), { as: "response" });
  let saved = null; if (res.ok) { try { saved = await res.json(); } catch { /* none */ } }
  const spec = saved && saved.pages ? mergeSaved(built, saved) : clone(built);
  spec.reading = built.reading === "rtl" ? "rtl" : "ltr"; // what the project was built with; the series settings win in readingOf
  for (const p of spec.pages) if (!p.text) p.text = [];
  { const newId = () => "p" + Math.random().toString(36).slice(2, 8), walk = (rows) => { for (const r of rows || []) for (const q of r.panels || []) { if (q.rows) walk(q.rows); else if (!q.id) q.id = newId(); } }; // older samples: the app refuses a save with a panel that has no id
    for (const p of spec.pages) if (p.layout) { walk(p.layout.rows); for (const q of p.layout.insets || []) if (!q.id) q.id = newId(); } }
  const bible = await getOr("/" + meta.dir + "bible.json", null);
  const ch = { id, meta, spec, bible: bible && typeof bible === "object" ? bible : null };
  ch.turned = syncReading(ch); // the series' direction may have been changed from another chapter: the caller's save keeps it
  return ch;
}
// Reading direction: right to left (manga) or left to right (comic), one choice for the whole series (bible.reading);
// a project without that keeps what it was built with; anything older reads left to right. The same rule as the editor.
const readingOf = (ch) => (ch.bible && (ch.bible.reading === "rtl" || ch.bible.reading === "ltr") ? ch.bible.reading : ch.spec.reading === "rtl" ? "rtl" : "ltr");
const READS = { rtl: "right to left (manga): the first panel of a row is on the right, and in a panel the first balloon is top right", ltr: "left to right (comic): the first panel of a row is on the left" };
/** Turn every page to the series' direction: panels change sides, each balloon keeps its place inside its own panel. -> pages turned */
function syncReading(ch) {
  const want = readingOf(ch), rtl = want === "rtl"; let n = 0;
  for (const p of ch.spec.pages) {
    if (!p.layout || !!p.layout.rtl === rtl) continue;
    const before = new Map(R.allPanels(p.layout).map((c) => [c.panel.id, c.bbox[0]]));
    if (rtl) p.layout.rtl = true; else delete p.layout.rtl;
    const after = new Map(R.allPanels(p.layout).map((c) => [c.panel.id, c.bbox[0]])), r3 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
    for (const it of p.text || []) { if (!it.panel || it.free || !before.has(it.panel)) continue; const dx = (after.get(it.panel) - before.get(it.panel)) / R.W; it.at = [r3(it.at[0] + dx), it.at[1]]; if (it.tail) it.tail = [r3(it.tail[0] + dx), it.tail[1]]; }
    n++;
  }
  ch.spec.reading = want;
  return n;
}
async function saveChapter(ch) {
  const body = clone(ch.spec); delete body.library; delete body.templates; delete body.script; // these always come from the project
  await api("PUT", "/api/spec?p=" + enc(ch.id), { json: body });
}
function pageOf(ch, n) {
  const p = typeof n === "string" && isNaN(+n) ? ch.spec.pages.find((q) => q.id === n) : ch.spec.pages[+n - 1];
  if (!p) throw new Stop(`There is no page ${n}: this chapter has ${ch.spec.pages.length} pages (count from 1, or use a page id).`);
  return p;
}
function findPanel(ch, pid) {
  for (const page of ch.spec.pages) { const panel = panelsOf(page).find((q) => q.id === pid); if (panel) return { page, panel }; }
  throw new Stop(`There is no panel "${pid}" in ${ch.id}. Use get_chapter to list panel ids.`);
}
const libOf = (spec) => Object.fromEntries((spec.library || []).map((it) => [it.src, it]));
const sizesOf = (spec) => Object.fromEntries((spec.library || []).map((it) => [it.src, it.size]));
const newId = () => "p" + Math.random().toString(36).slice(2, 8);
const panelBrief = (q) => ({ id: q.id, drawn: !!q.image, image: q.image || null, queued: !!q.request, type: q.type || "framed",
  shot: q.board?.shot, angle: q.board?.angle, bg: q.board?.bg, action: q.board?.action || "", who: (q.board?.who || []).map((w) => w.name),
  lines: (q.board?.lines || []).map((l) => `${l.speaker || l.kind || "caption"}: ${l.text}`), note: q.board?.note, splash: q.board?.splash || undefined,
  job: q.board?.job, weight: q.board ? Director.weightOf(q.board) : undefined, face: q.board?.face, reveal: q.board?.reveal || undefined });
function pageChecks(ch, page) {
  const measured = (page.text || []).map((it) => R.measure(it, ch.spec, measureText));
  const out = R.check(page, measured, R.protectBoxes(page, libOf(ch.spec))).map((r) => ({ level: r.level, about: r.i >= 0 ? R.plain(page.text[r.i].text).slice(0, 40) : "page", msg: r.msg }));
  if (page.layout && ch.spec.kind === "storyboard") for (const q of Paneler.check(ch.spec, R).pages[page.id] || []) out.push({ level: q.advice ? "advice" : q.level, about: "storyboard", msg: q.msg });
  return out;
}

// ---------------------------------------------------------------- money: the same rules as the screens
async function spendGate(estimate, what, approved) {
  if (!estimate && estimate !== null) return { cost: 0 };
  const s = await getOr("/api/spend", { settings: { askOver: 0.1, cap: null }, total: 0 });
  const ask = s.settings?.askOver ?? 0.1, cap = s.settings?.cap, spent = s.total || 0, est = estimate ?? null;
  if (cap != null && est != null && spent + est > cap) throw new Stop(`Not started: ${what} is about $${est.toFixed(2)} and the monthly cap is $${cap} ($${spent.toFixed(2)} spent). The person can raise the cap in Connections > Spending.`);
  if ((est === null || est > ask) && !(approved != null && (est === null ? approved > 0 : approved >= est - 1e-9)))
    throw new Stop(`NOT STARTED, needs the person's yes first. ${what} will cost ${est === null ? "an amount the model does not list" : "about $" + est.toFixed(2)} (paid through their own OpenRouter key; "ask me first" is set at $${ask}). Ask them, then call again with approved_usd set to the amount they agreed to.`);
  return { cost: est };
}
/** What a storyboard costs with the Writing model in use: null for Codex (free); undefined when a paid model lists no price. */
async function storyboardCost() {
  const m = await getOr("/api/models?kind=text", null), c = m?.choice; if (!c || c.service !== "openrouter") return null;
  const o = (m.options || []).find((x) => x.service === c.service && x.model === c.model) || {};
  return { name: c.name || o.name || c.model, usd: o.jobUsd > 0 ? o.jobUsd : undefined };
}
async function pictureModel() {
  const m = await getOr("/api/models?kind=picture", null), c = m?.choice || { service: "codex", model: "codex", name: "Codex image tool" };
  const opt = (m?.options || []).find((o) => o.service === c.service && o.model === c.model) || {};
  return { service: c.service || "codex", model: c.model || "codex", name: c.name || opt.name || c.model, quality: c.quality || "", refs: opt.refs, est: c.service === "openrouter" ? (opt.est ?? null) : 0, connected: opt.connected !== false };
}

// ---------------------------------------------------------------- pictures of pages (needs a Chrome/Chromium)
function chromePath() {
  if (process.env.IBASHO_CHROME) return process.env.IBASHO_CHROME;
  for (const c of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"]) { try { return execFileSync("which", [c]).toString().trim(); } catch { /* next */ } }
  const pw = join(homedir(), ".cache", "ms-playwright");
  try { for (const d of readdirSync(pw).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (existsSync(join(pw, d, rel))) return join(pw, d, rel); } catch { /* none */ }
  for (const c of ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"]) if (existsSync(c)) return c;
  throw new Stop("Pages are drawn to a picture with Chrome or Chromium, and none was found. Install one or set IBASHO_CHROME to its path. (The page's words and layout can still be read with get_page.)");
}
const dataUrl = async (path, mime) => `data:${mime};base64,${(await api("GET", path, { as: "buffer" })).toString("base64")}`;
const mimeOf = (f) => ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" })[extname(f).toLowerCase()] || "application/octet-stream";
/** One finished page (art + lettering) as PNG bytes: the editor's own pageBlob, with Chrome doing the drawing. */
async function pagePng(ch, page, width = 2048) {
  const measured = (page.text || []).map((it) => R.measure(it, ch.spec, measureText)), used = new Set(measured.map((L) => L.fontKey)); used.add("vollkorn");
  let css = "";
  for (const k of used) { const [fam, file, wt] = FONT_FILES[k]; css += `@font-face{font-family:'${fam}';src:url(${await dataUrl("/fonts/" + file, "font/ttf")});font-weight:${wt};}`; }
  let art;
  if (page.layout) { const map = {}; for (const q of panelsOf(page)) if (q.image && !map[q.image]) map[q.image] = await dataUrl("/" + ch.meta.dir + q.image, mimeOf(q.image)); art = R.layoutSvg(page, (s) => map[s], sizesOf(ch.spec)); }
  else art = `<image href="${await dataUrl("/" + ch.meta.dir + page.art, mimeOf(page.art))}" x="0" y="0" width="${R.W}" height="${R.H}" preserveAspectRatio="none"/>`;
  const h = Math.round((width * R.H) / R.W);
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}svg{display:block}${css}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${R.W} ${R.H}" width="${width}" height="${h}">${art}${R.letteringSvg(measured)}${R.pageNumberSvg(page)}</svg>`;
  const dir = mkdtempSync(join(tmpdir(), "ibasho-page-")), f = join(dir, "page.html"), out = join(dir, "page.png");
  writeFileSync(f, html);
  await new Promise((res, rej) => execFile(chromePath(), ["--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${width},${h}`, "--virtual-time-budget=4000", `--screenshot=${out}`, "file://" + f], { timeout: 90000 }, (e) => (existsSync(out) ? res() : rej(new Stop("Chrome could not draw the page: " + String(e?.message || "no picture came out").slice(0, 200))))));
  return readFileSync(out);
}

// ---------------------------------------------------------------- the tools
const T = {};
const tool = (name, description, properties, required, run) => { T[name] = { def: { name, description, inputSchema: { type: "object", properties, required } }, run }; };
const S = { type: "string" }, N = { type: "number" }, B = { type: "boolean" }, O = { type: "object" }, A = (items = S) => ({ type: "array", items });
const PROJECT = { ...S, description: "Project id, from list_projects" };
const APPROVED = { ...N, description: "Dollars the person has agreed to spend on this call. Only set it after they said yes to the estimate." };

const GUIDE = `IBASHO FOR AGENTS
The app is a manga and anime studio. This server drives the running app (${BASE}).

MANGA, the usual order:
  list_projects -> get_chapter (pages, panel ids, what is drawn) -> get_page (one page in full)
  storyboard (the Paneler rebuilds every page from the script; pictures come off the pages) | split_page, set_layout, apply_template, edit_panel (one page at a time, nothing else touched)
  series_settings (style, cast looks, sheets) -> draw_sheet -> draw_panels -> wait_for_jobs -> view_page (look at it)
  letter_pages (the Letterer places every balloon) -> edit_balloons -> check_pages -> view_page -> export_pages
  PANEL DIRECTOR: every panel has a job (establish | talk | act | react | insert | big) and a weight 1..5 (edit_panel). apply_template with no code picks the page's layout by weight.
  check_pages then flags an even grid, lined-up gutters, repeated cameras, swapped sides, a background in a connecting panel, and gives story advice (never a block; a book's words are never changed).
  READING DIRECTION: a series reads right to left (manga) or left to right (comic); get_chapter and get_page say which ("reads"). \`panels\` in a row are always listed in reading order,
  so on a right-to-left page the first one is drawn on the right, templates are mirrored, and the Letterer puts the first balloon of a panel top right. Change it with series_settings reading.
ANIME: anime_overview -> anime_scene -> anime_edit_shots -> anime_draw (stills, videos, sheets) -> anime_run (blocking, previs, render, export, check, episode) -> anime_scene to watch the job.
EVERYTHING ELSE goes through \`request\` (any route of the app). The useful ones:
  Books      GET /api/series, GET /api/series?id=, GET /api/series/chapter?id=&ch= (the text), POST /api/series/chapter?id=&ch= (start drawing it), POST /api/series?name=&file=book.epub (body_file), GET|POST|PUT /api/series/cast?id=
  Models     GET /api/models?kind=text|picture|video, POST /api/models {kind, service, model, quality}
  Spending   GET /api/spend, POST /api/spend {askOver, cap}
  Create     POST /api/create {kind:"picture"|"video", prompt, ...} (paid unless Codex), GET /api/create/list, POST /api/create/send {id, to:"panel", project, panel} | {id, to:"shot", scene, shot}
  Styles     GET|POST /api/styles      Cover: PUT /api/cover?p= {action, title}      Rename a character everywhere: POST /api/cast/rename?p= {from, to}
  Faces      PUT /api/faces?p=&src= {protect:[{who, box}]}, POST /api/faces/look?p=&panel=
  Checks     GET|POST /api/check?p= (the asset checker), PUT {id, verdict}
  Anime      GET /api/anime/shows | show?show= | scenes | scene?id= ; POST /api/anime/shows {name, idea, template} ; POST /api/anime/scenes {title, script, show, episode} or {project, pageIds}
             PUT /api/anime/look?show= (whole look) ; PUT /api/anime/show?show= (whole episode list) ; PUT /api/anime/sound?id= (whole sound.json) ; PUT /api/anime/style?id= ; PUT /api/anime/grade?id=
             POST /api/anime/upload?id=&kind=clip|audio|still|style|look|sheet|voice&name=file.ext (body_file) ; GET /api/anime/media?id=&f=export/x.mp4 (save_to)
  Files      GET /<project dir>/art/<picture> with save_to, then look at the file.
RULES
  Money: Codex jobs are in the person's plan (free). OpenRouter jobs are paid: tools estimate first and refuse without approved_usd when the cost is over the person's "ask me first" amount. Never raise approved_usd yourself; ask.
  Whole-document saves: PUT routes for plan, sound, look, show and bible replace the WHOLE document. Read it, change it, send all of it back. Prefer the tools here, which do that for you.
  A browser tab open on the same chapter or scene saves its own copy and can overwrite yours; ask the person to reload it after you change things.
  After a restart of the app, storyboard / blocking job states are forgotten; read the chapter or scene itself to see what landed.
  Never delete: DELETE routes and re-storyboarding need destructive:true in \`request\`, and only when the person asked.`;

tool("guide", "How to work in Ibasho: the order of the tools, the routes reachable through `request`, and the rules on money and saved work. Read this first.", {}, [], async () => GUIDE);

tool("status", "Is the app running, what it is working on now, this month's spending, and which models are picked.", {}, [], async () => {
  const [work, spend, models] = await Promise.all([get("/api/work"), getOr("/api/spend", null), getOr("/api/models", null)]);
  return { app: BASE, working: (work.running || []).map((j) => ({ what: j.label, status: j.msg || j.status, expect_seconds: j.expect })), waiting: (work.waiting || []).map((j) => j.label), finished_lately: (work.recent || []).slice(0, 8).map((j) => ({ what: j.label, status: j.status, cost: j.cost, msg: j.msg })),
    spending: spend && { this_month: spend.total, cap: spend.settings?.cap, ask_me_first_over: spend.settings?.askOver, openrouter_credit_left: spend.credit?.left },
    models: models && { writing: models.text?.name || models.text?.model, pictures: models.picture?.name || models.picture?.model, video: models.video?.name || models.video?.model } };
});

const PAID_ROUTES = [/^\/api\/generate/, /^\/api\/create$/, /^\/api\/anime\/draw/, /^\/api\/assistant/, /^\/api\/projects$/, /^\/api\/storyboard/];
tool("request", "Any route of the app, for everything the other tools do not cover (see `guide`). Returns the answer; binary answers need save_to.",
  { method: { ...S, enum: ["GET", "POST", "PUT", "DELETE"] }, path: { ...S, description: "Path with its query, e.g. /api/series?id=book-1" }, body: { description: "JSON body" }, body_file: { ...S, description: "A file to send as the raw body (uploads)" }, save_to: { ...S, description: "Save the answer to this file instead of returning it" },
    destructive: { ...B, description: "Needed for DELETE and for a re-storyboard. Only when the person asked for it." }, approved_usd: APPROVED }, ["method", "path"],
  async (a) => {
    const path = a.path.startsWith("/") ? a.path : "/" + a.path, bare = path.split("?")[0];
    if (/^\/api\/connections/.test(bare) && a.method !== "GET") throw new Stop("Keys and sign-ins are the person's to change, on the Connections screen.");
    if (/^\/api\/(spend|permissions)$/.test(bare) && a.method !== "GET") throw new Stop("The spending cap, the ask-me-first amount and licence permissions are the person's to change, on the Connections screen.");
    if ((a.method === "DELETE" || (a.method === "POST" && /^\/api\/(storyboard|cast\/rename)/.test(bare)) || /fresh=1/.test(path)) && !a.destructive) throw new Stop("This removes or rewrites saved work. Call it again with destructive:true only if the person asked for exactly this.");
    if (a.method === "POST" && PAID_ROUTES.some((r) => r.test(bare)) && !(a.approved_usd > 0)) {
      const m = await getOr("/api/models", {}), paid = /anime\/draw/.test(bare) ? /what=video/.test(path) || m.picture?.service === "openrouter" : /generate|create/.test(bare) ? true : m.text?.service === "openrouter";
      if (paid) throw new Stop("This route can spend the person's money and `request` cannot estimate it. Use the tool made for it (draw_panels, storyboard, anime_draw), or get their yes and pass approved_usd.");
    }
    const raw = a.body_file ? readFileSync(resolve(a.body_file)) : undefined;
    const res = await api(a.method, path, { json: raw ? undefined : a.body, raw, as: "response", ok: okHead(0, a.approved_usd) });
    const buf = Buffer.from(await res.arrayBuffer()), type = res.headers.get("content-type") || "";
    if (a.save_to) { const f = resolve(a.save_to); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, buf); return { status: res.status, saved: f, bytes: buf.length, type }; }
    if (!/json|text|javascript|yaml|csv/.test(type) && buf.length > 2000 && buf.includes(0)) return { status: res.status, type, bytes: buf.length, note: "A file. Call again with save_to to keep it." };
    const text = buf.toString("utf8"); let data = text; try { data = JSON.parse(text); } catch { /* text */ }
    return { status: res.status, answer: typeof data === "string" ? data.slice(0, 60000) : data };
  });

// ----- manga: reading
tool("list_projects", "Every manga chapter in the studio: pages, panels drawn, lettered, exported, and whether a storyboard is running.", {}, [], async () =>
  (await get("/api/projects")).map((p) => ({ id: p.id, title: p.label || p.title || p.project, own: p.own, book: p.series || undefined, reads: p.reading === "rtl" ? "right to left" : "left to right", pages: p.pages, panels: p.panels, drawn: p.drawn, lettered: p.lettered, exported: p.exported, storyboard: p.storyboard?.status && p.storyboard.status !== "none" ? p.storyboard : undefined, open_faults: p.check?.open })));

tool("get_chapter", "A chapter page by page: every panel's id, what happens in it, who is in it, its lines, and whether it is drawn or waiting.", { project: PROJECT }, ["project"], async (a) => {
  const ch = await loadChapter(a.project);
  return { project: ch.id, title: ch.spec.project, kind: ch.spec.kind || "art pages", reads: READS[readingOf(ch)], cast: ch.bible ? Object.keys(ch.bible.cast || {}) : [], strict_sheets: !!ch.bible?.strict,
    pages: ch.spec.pages.map((p, i) => ({ page: i + 1, id: p.id, label: p.label, note: p.note, balloons: (p.text || []).length, lines_planned: p.layout ? R.planFor(p).length : undefined, panels: p.layout ? R.allPanels(p.layout).map((c) => panelBrief(c.panel)) : "one picture: " + p.art })) };
});

tool("get_page", "One page in full: its layout (rows, widths, heights, slants), each panel's storyboard, and every balloon with its position.", { project: PROJECT, page: { description: "Page number (from 1) or page id" } }, ["project", "page"], async (a) => {
  const ch = await loadChapter(a.project), p = pageOf(ch, a.page);
  return { id: p.id, label: p.label, note: p.note, reads: READS[readingOf(ch)], layout: p.layout, panels_in_reading_order: p.layout ? R.allPanels(p.layout).map((c) => ({ ...panelBrief(c.panel), box: c.bbox.map((v) => Math.round(v)), board: c.panel.board, request: c.panel.request && { status: c.panel.request.status, model: c.panel.request.modelName } })) : [],
    plan: p.layout ? R.planFor(p) : [], balloons: (p.text || []).map((it, i) => ({ index: i, ...it })), page_size: [R.W, R.H], templates: (ch.spec.templates || []).map((t) => `${t.code} ${t.name}`).slice(0, 400) };
});

// ----- manga: changing one page
tool("edit_panel", "Change one panel's storyboard or framing, leaving everything else as it is. Background strength is bg: full | simple (a hint) | tone | white. Every panel has a job (what it is for) and a weight (1 light to 5 the big moment): the layout, the background and how much is drawn follow from them; connecting panels (talk, react, insert) carry no background.",
  { project: PROJECT, panel: S, action: S, shot: S, angle: S, bg: { ...S, enum: ["full", "simple", "tone", "white"] }, note: S, art: { ...S, description: "Extra direction for the Artist" }, splash: B,
    job: { ...S, enum: ["establish", "talk", "act", "react", "insert", "big", ""], description: "establish (sets the place) | talk | act (something happens) | react | insert (a detail) | big (the page's big moment); \"\" clears it" }, weight: { ...N, description: "1 to 5: how much of the page the panel owns" },
    face: { ...S, enum: ["big", ""], description: "big = the page's ONE big expression; \"\" = calm" }, reveal: { ...B, description: "A surprise: it belongs first on its page" },
    who: { ...A(O), description: "[{name, at:[x,y] 0..1, size: close|medium|wide|tiny, facing}] replaces the list" }, lines: { ...A(O), description: "[{source_id, speaker, kind, text}] replaces the panel's lines; the Paneler's rule is to keep every spoken line word for word" },
    type: { ...S, enum: ["framed", "borderless", "bleed"] }, focus: { ...A(N), description: "[x,y] 0..1: which part of the picture sits in the panel" }, zoom: N, sfx: S, writing: S, clear_picture: B }, ["project", "panel"],
  async (a) => {
    const ch = await loadChapter(a.project), { panel } = findPanel(ch, a.panel); panel.board = panel.board || { action: "" };
    for (const k of ["action", "shot", "angle", "bg", "note", "art", "splash", "who", "lines", "job", "weight", "face", "reveal"]) if (a[k] !== undefined) { if (k === "job" && a[k] && !["establish", "talk", "act", "react", "insert", "big"].includes(a[k])) throw new Stop("job is one of: establish, talk, act, react, insert, big (or \"\" to clear it).");
      if ((a[k] === "" || a[k] === false) && k !== "action") delete panel.board[k]; else panel.board[k] = a[k]; } // an emptied action stays as "": the page draws it
    if (panel.board.weight !== undefined) panel.board.weight = Math.min(5, Math.max(1, Math.round(+panel.board.weight) || 3));
    for (const k of ["type", "focus", "zoom"]) if (a[k] !== undefined) panel[k] = a[k];
    if (a.sfx !== undefined || a.writing !== undefined) panel.inart = { ...(panel.inart || {}), ...(a.sfx !== undefined ? { sfx: a.sfx } : {}), ...(a.writing !== undefined ? { writing: a.writing } : {}) };
    if (a.clear_picture) { delete panel.image; delete panel.take; delete panel.focus; delete panel.zoom; }
    await saveChapter(ch); return { saved: panelBrief(panel), next: a.lines ? "The lines changed: run letter_pages on this page." : undefined };
  });

function fillLayout(rows, old, remove, made) {
  const used = new Set();
  const walk = (rs) => rs.map((row) => ({ h: +row.h || 1, ...(row.slant ? { slant: +row.slant } : {}), panels: (row.panels || []).map((q) => {
    if (q.rows) return { w: +q.w || 1, ...(q.slant ? { slant: +q.slant } : {}), rows: walk(q.rows) };
    if (q.id) { const o = old.get(q.id); if (!o) throw new Stop(`set_layout: there is no panel "${q.id}" on this page.`); if (used.has(q.id)) throw new Stop(`set_layout: panel "${q.id}" is listed twice.`); used.add(q.id);
      return { ...o, w: +q.w || 1, ...(q.type ? { type: q.type } : {}), slant: q.slant ? +q.slant : undefined }; }
    const n = { id: newId(), w: +q.w || 1, type: q.type || "framed", board: { shot: q.shot || "medium", action: q.action || "", who: [], bg: q.bg || "simple", lines: [] } }; if (q.slant) n.slant = +q.slant; made.push(n.id); return n;
  }) }));
  const out = walk(rows), lost = [...old.keys()].filter((id) => !used.has(id) && !remove.includes(id));
  if (lost.length) throw new Stop(`set_layout would drop panel${lost.length > 1 ? "s" : ""} ${lost.join(", ")}. Put ${lost.length > 1 ? "them" : "it"} in the layout, or list ${lost.length > 1 ? "them" : "it"} in remove if the person wants ${lost.length > 1 ? "them" : "it"} gone.`);
  return out;
}
tool("set_layout", "Lay one page out again by hand. rows = [{h, slant?, panels:[{id, w, slant?, type?} | {w, rows:[...]} | {w, action, shot, bg} for a NEW panel]}]. h and w are shares (2 beside 1 = two thirds and one third). Panels in a row are listed in READING ORDER: on a right-to-left chapter (get_page says which) the first one is drawn on the right. slant tilts a border (about -0.06 to 0.06). Existing panels keep their storyboard and picture by id. Sizes should follow weight: the moment that matters big, reactions small, never an even grid.",
  { project: PROJECT, page: {}, rows: A(O), remove: { ...A(), description: "Panel ids the person wants deleted" } }, ["project", "page", "rows"],
  async (a) => {
    const ch = await loadChapter(a.project), p = pageOf(ch, a.page); if (!p.layout) throw new Stop("This page is one whole picture, with no panels to lay out.");
    const made = [], old = new Map(leaves(p.layout.rows).map((q) => [q.id, q]));
    p.layout.rows = fillLayout(a.rows, old, a.remove || [], made);
    const alive = new Set(panelsOf(p).map((q) => q.id)); for (const it of p.text || []) if (it.panel && !alive.has(it.panel)) delete it.panel;
    await saveChapter(ch); return { page: p.id, panels: R.allPanels(p.layout).map((c) => ({ id: c.panel.id, box: c.bbox.map((v) => Math.round(v)) })), new_panels: made, next: "Balloons kept their old places: run letter_pages on this page, then view_page." };
  });
tool("apply_template", "Put a page's panels into one of the ready-made layouts (codes are listed by get_page). Panels go in, in reading order; the template must have the same number of panels. LEAVE `code` OUT and the panel director picks the layout by the panels' weights (the heaviest panel becomes the biggest, no even grid, never the layout of the page before or after): set jobs and weights with edit_panel first. Either way the sizes are pulled toward the weights. On a right-to-left chapter the template is mirrored with the page.",
  { project: PROJECT, page: {}, code: S }, ["project", "page"],
  async (a) => {
    const ch = await loadChapter(a.project), p = pageOf(ch, a.page); if (!p.layout) throw new Stop("This page is one whole picture.");
    const panelsNow = leaves(p.layout.rows), i0 = ch.spec.pages.indexOf(p), near = [ch.spec.pages[i0 - 1], ch.spec.pages[i0 + 1]].filter((q) => q && q.layout && !q.cover).map((q) => Director.shape(q.layout.rows));
    const ranked = panelsNow.length > 1 ? Director.sorted(panelsNow, ch.spec.templates || [], R, { avoid: near }) : [], hit = a.code ? ranked.find((x) => x.template.code === a.code) : ranked[0];
    if (!a.code && !hit) throw new Stop(`No ready-made layout has ${panelsNow.length} panels. Use set_layout.`);
    const t = hit ? { code: hit.template.code, name: hit.template.name, rows: hit.rows } : (ch.spec.templates || []).find((q) => q.code === a.code);
    if (!t) throw new Stop(`There is no template "${a.code}".`);
    const mine = R.allPanels(p.layout).filter((c) => !(p.layout.insets || []).includes(c.panel)).map((c) => c.panel), slots = leaves(clone(t.rows));
    if (slots.length !== mine.length) throw new Stop(`Template ${a.code} has ${slots.length} panels and this page has ${mine.length}. Pick one with ${mine.length}: ${(ch.spec.templates || []).filter((q) => leaves(q.rows).length === mine.length).slice(0, 40).map((q) => q.code).join(", ")}.`);
    const rows = clone(t.rows); let i = 0; eachPanel(rows, (q) => { if (!q.rows) { const o = mine[i++]; for (const k of Object.keys(o)) if (k !== "w" && k !== "slant") q[k] = o[k]; } });
    p.layout.rows = rows; await saveChapter(ch); return { page: p.id, template: t.code + " " + t.name, picked_by_weight: !a.code || undefined, why_not_perfect: hit && hit.why.length ? hit.why : undefined, next: "Run letter_pages on this page, then view_page." };
  });
tool("split_page", "Spread a crowded page over two: the panels after `after_panel` (in reading order) move to a new page right after it. Nothing else in the chapter changes.",
  { project: PROJECT, page: {}, after_panel: { ...S, description: "The last panel id that stays on the first page" } }, ["project", "page", "after_panel"],
  async (a) => {
    const ch = await loadChapter(a.project), p = pageOf(ch, a.page); if (!p.layout) throw new Stop("This page is one whole picture.");
    const order = R.allPanels(p.layout).map((c) => c.panel).filter((q) => !(p.layout.insets || []).includes(q)), at = order.findIndex((q) => q.id === a.after_panel);
    if (at < 0 || at === order.length - 1) throw new Stop("after_panel must be a panel on this page that is not the last one.");
    const stack = (list) => list.map((q) => ({ h: 1, panels: [{ ...q, w: 1, slant: undefined }] })), first = order.slice(0, at + 1), second = order.slice(at + 1), ids = new Set(second.map((q) => q.id));
    const np = { id: "board-" + newId(), number: p.number, label: (p.label || "Page") + " (second half)", note: p.note || "", layout: { ...(p.layout.rtl ? { rtl: true } : {}), rows: stack(second) }, text: (p.text || []).filter((it) => ids.has(it.panel)) };
    p.layout = { ...(p.layout.rtl ? { rtl: true } : {}), rows: stack(first) }; p.text = (p.text || []).filter((it) => !ids.has(it.panel)); delete p.plan;
    const i = ch.spec.pages.indexOf(p); ch.spec.pages.splice(i + 1, 0, np);
    ch.spec.pages.forEach((q, n) => { if (!q.cover) { q.number = n + 1; if (/^Page \d+$/.test(q.label || "")) q.label = "Page " + (n + 1); } });
    for (const q of [p, np]) if (R.planFor(q).length) q.text = R.autoPlace(q, ch.spec, libOf(ch.spec), measureText);
    await saveChapter(ch); return { first: { id: p.id, panels: first.map((q) => q.id) }, second: { id: np.id, panels: second.map((q) => q.id) }, pages_now: ch.spec.pages.length, next: "Both halves are stacked one panel a row and lettered again. Give each a real layout with set_layout or apply_template, then view_page. A chapter is at most 20 pages (X takes 20 pictures a post)." };
  });
tool("set_picture", "Put a picture on a panel: one already in the project's art list (library src, e.g. art/b01-n1-take02.jpg), or a picture file from disk, which becomes the panel's next take.",
  { project: PROJECT, panel: S, src: { ...S, description: "A library src from the project" }, file: { ...S, description: "A PNG or JPEG on this computer" } }, ["project", "panel"],
  async (a) => {
    const ch = await loadChapter(a.project), { panel } = findPanel(ch, a.panel);
    if (a.src) { if (!(ch.spec.library || []).some((e) => e.src === a.src)) throw new Stop(`"${a.src}" is not in this project's art list.`); panel.image = a.src; panel.take = a.src.split("/").pop().replace(/\.\w+$/, ""); delete panel.focus; delete panel.zoom; delete panel.request; await saveChapter(ch); return { panel: panel.id, image: panel.image }; }
    if (!a.file) throw new Stop("Give src or file.");
    const f = resolve(a.file), up = await api("POST", "/api/create/upload?name=" + enc(f.split(/[\\/]/).pop()), { raw: readFileSync(f), type: mimeOf(f) });
    const sent = await api("POST", "/api/create/send", { json: { id: up.id, to: "panel", project: a.project, panel: a.panel } });
    const again = await loadChapter(a.project); await saveChapter(again); return { panel: a.panel, take: sent.take, image: findPanel(again, a.panel).panel.image };
  });

// ----- manga: drawing
function buildRequest(ch, page, panel, model, o = {}) {
  const bible = ch.bible || { cast: {} };
  if (bible.strict) { const lack = [...new Set((panel.board?.who || []).map((w) => w.name))].filter((n) => { const c = bible.cast[n]; return !(c && (c.ref || c.sheet) && c.approved !== false); }); if (lack.length) return { held: lack }; }
  const a = Artist.panelBrief(page, panel.id, ch.spec, bible, R, measureText, o.prompt ? { noRefLine: true, own: o.prompt } : { noRefLine: true });
  if (!a) return { held: ["(no storyboard on this panel: give a prompt)"] };
  const bank = (n) => (ch.spec.bank || []).find((b) => b.name === n), limit = model.service === "openrouter" ? Math.min(6, +model.refs || 0) : 6;
  const refs = a.refs.map((n) => ({ type: "bank", name: n, note: bible.cast[n]?.ref_role || n }))
    .concat((a.cast || []).filter((n) => !(a.named || []).includes(n)).map(bank).filter(Boolean).map((b) => ({ type: "panel", src: b.src, who: b.name, box: b.box, saved: true, note: `${b.name} as already drawn in this chapter: take the face, hair and clothes only; the pose here is new` })))
    .concat((a.things || []).filter((t) => t.sheet).map((t) => ({ type: "bank", kind: t.kind, name: t.name, note: bible[t.kind === "place" ? "places" : "props"]?.[t.name]?.ref_role || t.name }))).slice(0, limit);
  let text = a.prompt.trim(); if (o.note) text += "\n\nNOTE FROM THE AUTHOR (it wins over anything above it contradicts): " + o.note;
  const refLine = refs.length ? `\n\nINPUT REFERENCES, ordered: ${refs.map((r, i) => `Image ${i + 1}: ${(r.note || "reference").trim()}`).join("; ")}.` : "";
  const tags = [...new Set(refs.map((r) => (r.type === "bank" ? (r.kind || "person") + "|" + r.name : "person|" + r.who)).concat((a.cast || []).map((n) => "person|" + n), (a.things || []).map((t) => t.kind + "|" + t.name)))];
  return { request: { source: model.service, model: model.model, modelName: model.name + (model.quality ? " · " + model.quality : ""), quality: model.quality || "", mode: o.prompt ? "custom" : "artist", keepStyle: true, status: "queued", at: new Date().toISOString(),
    size: a.size, ...(o.prompt ? { own: o.prompt } : { edited: !!o.note }), refList: refs, prompt: text + refLine, tags } };
}
tool("draw_panels", "Have the Artist draw panels with the picture model the person picked: named panels, a whole page, or everything in the chapter not drawn yet. note = a direction added to the Artist's own prompt (keeps the storyboard); prompt = your whole description instead. dry_run shows the prompts and the cost without drawing.",
  { project: PROJECT, panels: A(), page: {}, all_missing: B, note: S, prompt: S, redraw: { ...B, description: "For page: also redraw panels that have a picture" }, dry_run: B, approved_usd: APPROVED }, ["project"],
  async (a) => {
    const ch = await loadChapter(a.project), model = await pictureModel(); let list = [];
    if (a.panels?.length) list = a.panels.map((id) => findPanel(ch, id));
    else if (a.page !== undefined) { const p = pageOf(ch, a.page); list = panelsOf(p).filter((q) => a.redraw || (!q.image && !q.request)).map((panel) => ({ page: p, panel })); }
    else if (a.all_missing) for (const p of ch.spec.pages) for (const panel of panelsOf(p)) if (!panel.image && !panel.request) list.push({ page: p, panel });
    if (!list.length) return "There is nothing to draw: give panels, a page, or all_missing (panels already drawn or waiting are skipped).";
    const ready = [], held = {};
    for (const { page, panel } of list) { const r = buildRequest(ch, page, panel, model, { note: a.note, prompt: a.prompt }); if (r.held) held[panel.id] = r.held; else ready.push({ panel, request: r.request }); }
    const est = model.est === 0 ? 0 : model.est == null ? null : model.est * ready.length;
    if (a.dry_run) return { model: model.name, estimate_usd: est, would_draw: ready.map((r) => ({ panel: r.panel.id, size: r.request.size, references: r.request.refList.map((x) => x.name || x.who), prompt: r.request.prompt })), held_for_approved_sheets: held };
    if (!ready.length) return { drawn: 0, held_for_approved_sheets: held, why: "This book only draws characters with an approved sheet. Approve or draw the sheets (series_settings, draw_sheet)." };
    const gate = await spendGate(est, `Drawing ${ready.length} picture${ready.length > 1 ? "s" : ""} with ${model.name}`, a.approved_usd);
    for (const r of ready) r.panel.request = r.request;
    await saveChapter(ch);
    for (const r of ready) await api("POST", `/api/generate?p=${enc(a.project)}&panel=${enc(r.panel.id)}`, { ok: okHead(est, a.approved_usd) });
    return { started: ready.map((r) => r.panel.id), model: model.name, estimate_usd: gate.cost, held_for_approved_sheets: Object.keys(held).length ? held : undefined, next: `Two are drawn at a time, about ${model.service === "codex" ? 3 : 1} minute${model.service === "codex" ? "s" : ""} each. Call wait_for_jobs, then view_page.` };
  });
tool("wait_for_jobs", "Wait (up to `seconds`, default 100) for a project's drawings, sheets and storyboard to finish, then put finished pictures into the chapter. Call again while things are still running.",
  { project: PROJECT, seconds: N }, ["project"],
  async (a) => {
    const until = Date.now() + Math.min(110, Math.max(1, a.seconds ?? 100)) * 1000; let jobs = [], board = null;
    for (;;) {
      jobs = await get("/api/jobs?p=" + enc(a.project)); board = (await getOr("/api/project?p=" + enc(a.project), {})).storyboard;
      const busy = jobs.some((j) => j.status === "waiting" || j.status === "drawing") || (board && (board.status === "waiting" || board.status === "drawing"));
      if (!busy || Date.now() > until) break; await new Promise((r) => setTimeout(r, 4000));
    }
    const ch = await loadChapter(a.project); await saveChapter(ch); // lands new takes on their panels and clears their requests
    const left = jobs.filter((j) => j.status === "waiting" || j.status === "drawing");
    return { still_running: left.map((j) => ({ what: j.panel, status: j.status, ahead: j.ahead })), storyboard: board || undefined, done: jobs.filter((j) => j.status === "done").map((j) => j.panel), failed: jobs.filter((j) => j.status === "failed").map((j) => ({ what: j.panel, why: j.msg })),
      pictures: ch.spec.pages.reduce((n, p) => n + panelsOf(p).filter((q) => q.image).length, 0) + " panels have a picture" };
  });
tool("storyboard", "Run the Paneler on a chapter made in the app: every page and panel is rebuilt from the script, and pictures come off the pages (they stay in the art list; a copy of the old board is kept in history). For one crowded page use split_page or set_layout instead. Takes about 6 minutes with Codex.",
  { project: PROJECT, note: { ...S, description: "What to change, for the Paneler" }, confirm_rebuild: { ...B, description: "Must be true: the person agreed to rebuild the whole chapter" }, approved_usd: APPROVED }, ["project", "confirm_rebuild"],
  async (a) => {
    if (!a.confirm_rebuild) throw new Stop("Storyboarding again rebuilds EVERY page of the chapter. Only do it when the person asked for the whole chapter; set confirm_rebuild:true then.");
    const meta = await projectMeta(a.project), sb = meta.series ? null : await storyboardCost();
    if (sb) await spendGate(sb.usd ?? null, `A storyboard with ${sb.name}`, a.approved_usd);
    const job = await api("POST", "/api/storyboard?p=" + enc(a.project), { json: a.note ? { note: a.note } : {}, ok: okHead(0, a.approved_usd) });
    return { started: true, status: job.status, next: "Call wait_for_jobs until the storyboard is done, then get_chapter to see the new pages." };
  });
tool("new_project", "Start a new chapter from a script. The Paneler storyboards it straight away. style = a style id from GET /api/styles. like = an existing project whose cast, style and reading direction this chapter shares. reading = rtl (right to left, manga: the default for a new series) or ltr (left to right, comic); ask the person if they have not said.",
  { name: S, chapter: {}, script: S, script_file: S, style: S, like: S, reading: { ...S, enum: ["rtl", "ltr"] }, approved_usd: APPROVED }, ["name", "chapter"],
  async (a) => {
    const script = a.script || (a.script_file ? readFileSync(resolve(a.script_file), "utf8") : ""); if (script.trim().length < 40) throw new Stop("Give the script (script or script_file), at least a few lines.");
    const sb = await storyboardCost(); if (sb) await spendGate(sb.usd ?? null, `A storyboard with ${sb.name}`, a.approved_usd);
    const r = await api("POST", "/api/projects", { json: { name: a.name, chapter: a.chapter, script, style: a.style, like: a.like, reading: a.reading }, ok: okHead(0, a.approved_usd) });
    return { project: r.id, next: "The Paneler is working (about 6 minutes with Codex). Call wait_for_jobs with this project, then get_chapter." };
  });

// ----- manga: lettering, checks, pictures of pages
const whichPages = (ch, pages) => (pages?.length ? pages.map((n) => pageOf(ch, n)) : ch.spec.pages);
tool("letter_pages", "The Letterer: place every balloon on the given pages (or the whole chapter) in reading order (it follows the chapter's reading direction), off faces, tails at the speakers. Replaces the balloons on those pages.",
  { project: PROJECT, pages: { ...A({}), description: "Page numbers or ids; leave out for the whole chapter" } }, ["project"],
  async (a) => {
    const ch = await loadChapter(a.project), out = [];
    for (const p of whichPages(ch, a.pages)) { if (!p.layout || !R.planFor(p).length) { out.push({ page: p.id, balloons: 0, note: "no lines on this page" }); continue; }
      p.text = R.autoPlace(p, ch.spec, libOf(ch.spec), measureText); const faults = pageChecks(ch, p); out.push({ page: p.id, balloons: p.text.length, must_fix: faults.filter((f) => f.level === "error").length, to_look_at: faults.filter((f) => f.level !== "error").length }); }
    await saveChapter(ch); return { lettered: out, next: "view_page to look; edit_balloons to move or change one; check_pages for the faults." };
  });
tool("edit_balloons", "Change, add or delete balloons on one page. Positions are fractions of the page (0..1). kind: speech | shout | whisper | thought | caption | ambient | crowd | phone | title. font: playpen | bangers | vollkorn | patrick | comicneue | kalam.",
  { project: PROJECT, page: {}, set: { ...A(O), description: "[{index, ...fields}] fields: text, speaker, kind, at:[x,y], tail:[x,y], width, size, font, rotate, bleed" }, add: { ...A(O), description: "[{kind, speaker, text, at:[x,y], tail?, width?}]" }, delete: A(N) }, ["project", "page"],
  async (a) => {
    const ch = await loadChapter(a.project), p = pageOf(ch, a.page); p.text = p.text || [];
    const place = (it) => { if (!p.layout || it.free) return; const c = R.allPanels(p.layout).reverse().find((q) => { const [x0, y0, x1, y1] = q.bbox; return it.at[0] * R.W >= x0 && it.at[0] * R.W <= x1 && it.at[1] * R.H >= y0 && it.at[1] * R.H <= y1; }); if (c) it.panel = c.panel.id; else delete it.panel; };
    for (const s of a.set || []) { const it = p.text[s.index]; if (!it) throw new Stop(`There is no balloon ${s.index} on this page (it has ${p.text.length}).`); for (const [k, v] of Object.entries(s)) if (k !== "index") { if (v === null) delete it[k]; else it[k] = v; } if (s.at) place(it); }
    for (const n of a.add || []) { if (!n.text || !Array.isArray(n.at)) throw new Stop("A new balloon needs text and at:[x,y]."); const it = { kind: "speech", speaker: "", ...n }; place(it); p.text.push(it); }
    for (const i of [...(a.delete || [])].sort((x, y) => y - x)) p.text.splice(i, 1);
    await saveChapter(ch); const faults = pageChecks(ch, p);
    return { balloons: p.text.length, faults: faults.length ? faults : "All checks pass" };
  });
tool("check_pages", "The page check and the Paneler's check: words that do not fit, balloons over faces or out of reading order, a page that is too crowded, backgrounds all on one level; the page's build (an even grid, upright gutters that line up, no big panel, neighbours with the same camera, the heaviest panel not the biggest); manga flow (people swapping sides, too many big expressions, a background in a connecting panel, a long balloon); and story advice (level \"advice\": a reveal that is not first on its page, a wordy opening, a line that only repeats its panel). Advice never blocks, and a book's words are never changed.", { project: PROJECT, pages: A({}) }, ["project"],
  async (a) => { const ch = await loadChapter(a.project), out = {}; let n = 0; for (const p of whichPages(ch, a.pages)) { const f = pageChecks(ch, p); if (f.length) { out[p.id] = f; n += f.length; } }
    const whole = ch.spec.kind === "storyboard" ? Paneler.check(ch.spec, R) : { chapter: [], advice: [] }, chapter = whole.chapter.map((c) => c.msg).concat((whole.advice || []).map((c) => c.msg));
    return n || chapter.length ? { faults: out, chapter: chapter.length ? chapter : undefined } : "All checks pass."; });
tool("view_page", "Look at a page as it stands now (art, borders, balloons): returns the picture. Use it after every change you want to judge by eye.", { project: PROJECT, page: {}, width: { ...N, description: "Pixels wide, 400 to 1400 (default 800)" } }, ["project", "page"],
  async (a) => { const ch = await loadChapter(a.project), p = pageOf(ch, a.page), png = await pagePng(ch, p, Math.round(Math.min(1400, Math.max(400, a.width || 800))));
    return { content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }, { type: "text", text: `${ch.id}, ${p.label || p.id}: ${panelsOf(p).filter((q) => q.image).length} of ${panelsOf(p).length} panels drawn, ${(p.text || []).length} balloons.` }] }; });
tool("export_pages", "Export finished pages as 2048 x 3072 PNGs, the same as the Export button. With no pages, the whole chapter is exported afresh (the last chapter export is replaced). Files can then be fetched: /api/export-zip?p=, or /api/export-x?p= for JPEGs in sets of 20 for X.",
  { project: PROJECT, pages: A({}) }, ["project"],
  async (a) => {
    const ch = await loadChapter(a.project), whole = !a.pages?.length, list = whichPages(ch, a.pages), out = [];
    if (whole) await api("DELETE", "/api/exports?p=" + enc(a.project));
    for (const p of list) { const name = `page-${String(ch.spec.pages.indexOf(p) + 1).padStart(2, "0")}.png`; await api("POST", `/api/export?p=${enc(a.project)}&name=${name}`, { raw: await pagePng(ch, p, 2048), type: "image/png" }); out.push(`${BASE}/exports/${a.project}/${name}`); }
    return { exported: out, zip: `${BASE}/api/export-zip?p=${a.project}`, for_x: `${BASE}/api/export-x?p=${a.project}` };
  });

// ----- manga: the series (style, cast, sheets)
tool("series_settings", "Read the series settings (art style, each character's look and sheet, places, props), or change them. set_cast / set_places / set_props merge into what is there: {Name: {desc, approved, ...}} adds or changes, {Name: null} removes. A book chapter shares its settings with the whole book. reading = rtl | ltr turns the whole series to read right to left (manga) or left to right (comic): every page's panels change sides and balloons keep their place in their panel; pictures already drawn are not redrawn, so only do it when the person asked.",
  { project: PROJECT, style: S, style_id: S, strict: B, reading: { ...S, enum: ["rtl", "ltr"] }, set_cast: O, set_places: O, set_props: O }, ["project"],
  async (a) => {
    const meta = await projectMeta(a.project), bible = await getOr("/" + meta.dir + "bible.json", null); if (!bible || typeof bible !== "object") throw new Stop("This project has no series settings yet.");
    const changing = ["style", "style_id", "strict", "reading", "set_cast", "set_places", "set_props"].some((k) => a[k] !== undefined);
    let turned;
    if (changing) {
      for (const k of ["style", "style_id", "strict", "reading"]) if (a[k] !== undefined) bible[k] = a[k];
      for (const [arg, field] of [["set_cast", "cast"], ["set_places", "places"], ["set_props", "props"]]) for (const [n, v] of Object.entries(a[arg] || {})) { bible[field] = bible[field] || {}; if (v === null) delete bible[field][n]; else bible[field][n] = { ...(bible[field][n] || {}), ...v }; }
      await api("PUT", "/api/bible?p=" + enc(a.project), { json: bible });
      if (a.reading !== undefined) { const ch = await loadChapter(a.project); turned = ch.turned; if (turned) await saveChapter(ch); } // this chapter turns now; the series' other chapters when they are next opened
    }
    const brief = (o) => Object.fromEntries(Object.entries(o || {}).map(([n, c]) => [n, { desc: c.desc, sheet: c.sheet || c.ref || null, approved: c.approved !== false && !!(c.sheet || c.ref) }]));
    return { saved: changing || undefined, reads: bible.reading === "rtl" ? "right to left" : bible.reading === "ltr" ? "left to right" : "left to right (never set: a series from before reading direction)", pages_turned: turned, style_id: bible.style_id, style: bible.style, colour: bible.colour, strict: !!bible.strict, cast: brief(bible.cast), places: brief(bible.places), props: brief(bible.props) };
  });
tool("draw_sheet", "Draw a character, place or prop sheet with Codex (free, about 90 seconds). A drawn character sheet waits for approval: series_settings set_cast {Name:{approved:true}} once the person likes it.",
  { project: PROJECT, name: S, kind: { ...S, enum: ["character", "place", "prop"] } }, ["project", "name"],
  async (a) => { const job = await api("POST", `/api/sheet?p=${enc(a.project)}&name=${enc(a.name)}${a.kind && a.kind !== "character" ? "&kind=" + a.kind : ""}`); return { status: job.status, next: "wait_for_jobs, then series_settings to see the sheet's file; fetch it with request + save_to to look at it." }; });

// ----- anime
tool("anime_overview", "Every show with its episodes and scenes, plus scenes not in an episode: shots, seconds, how many are drawn, plan faults, running jobs.", {}, [], async () => {
  const sc = (s) => ({ id: s.id, title: s.title, shots: s.shots, seconds: s.seconds, drawn: s.drawn, plan_faults: s.errors, sound_clips: s.sound, job: s.job || undefined });
  return (await get("/api/anime/shows")).map((w) => ({ show: w.id, name: w.name, about: w.about, job: w.job || undefined, sheets: `${w.people?.sheets ?? 0} of ${w.people?.all ?? 0} people`, episodes: (w.episodes || []).map((e) => ({ id: e.id, title: e.title, ideas_not_written: e.planned, scenes: (e.scenes || []).map(sc) })), loose_scenes: (w.loose || []).map(sc) }));
});
tool("anime_scene", "One scene: every shot (type, seconds, camera, action, lines, picture, clip), the plan check, the job running on it, what is being drawn, and the newest exports.", { scene: S, full_plan: { ...B, description: "Also return the whole SCENE_PLAN.json" } }, ["scene"], async (a) => {
  const s = await get("/api/anime/scene?id=" + enc(a.scene)), lines = new Map((s.plan.dialogue || []).map((l) => [l.line_id, l]));
  return { id: a.scene, title: s.scene.title, show: s.scene.look, job: s.job || undefined, check: { pass: s.check?.pass, errors: s.check?.errors, warnings: (s.check?.warnings || []).slice(0, 30), stats: s.check?.stats },
    shots: (s.plan.shots || []).map((h) => ({ id: h.shot_id, type: h.scene_type, seconds: h.duration, camera: h.camera && `${h.camera.framing || ""} / ${h.camera.move || "still"}${h.camera.move_reason ? " (" + h.camera.move_reason + ")" : ""}`, action: h.action, lines: (h.lines || []).map((id) => { const l = lines.get(id); return l ? `${l.speaker || l.kind}: ${l.text}${l.mouth === "off" ? " [mouth off]" : ""}` : id; }), still: h.still || null, takes: (s.takes?.[h.shot_id] || []).length || undefined, clip: h.clip || undefined, draw_note: h.draw_note, video_note: h.video_note, tin: h.tin, tout: h.tout })),
    drawing: s.draws, exports: (s.exports || []).map((e) => `${BASE}/${e.url}`), previs: s.previs, plan: a.full_plan ? s.plan : undefined };
});
tool("anime_edit_shots", "Edit a scene's shot list and save it (the whole plan is read, changed and written back). set changes fields of a shot; delete moves a deleted shot's lines to the shot before it; add puts a new shot after another; order re-orders. Shot fields include: scene_type, duration, action, camera{framing, move, move_reason}, lines[line ids], line_placement, draw_note, video_note, still, tin, tout, title. Every camera move needs a move_reason.",
  { scene: S, set: { ...A(O), description: "[{shot_id, ...fields}]" }, add: { ...A(O), description: "[{after: shot_id|\"\" for first, shot: {scene_type, duration, action, ...}}]" }, delete: A(), order: { ...A(), description: "All shot ids in the new order" }, dialogue: { ...A(O), description: "[{line_id, mouth:\"on\"|\"off\"}] changes to lines (words are not changed here)" },
    scene_cards: { ...O, description: "The scene's own cards, merged in: intent{feel, peak, must_know}, palette[{hex, role}] (4 to 6), lighting_mood, sound_plan, signature_gestures{Name: gesture}, craft_checks{geography, cause, ...}" } }, ["scene"],
  async (a) => {
    const s = await get("/api/anime/scene?id=" + enc(a.scene)), plan = s.plan, by = (id) => { const h = plan.shots.find((q) => q.shot_id === id); if (!h) throw new Stop(`There is no shot "${id}" in this scene.`); return h; };
    for (const [k, v] of Object.entries(a.scene_cards || {})) { if (!["intent", "palette", "lighting_mood", "sound_plan", "signature_gestures", "craft_checks", "title"].includes(k)) throw new Stop(`scene_cards cannot set "${k}".`); plan[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(plan[k] || {}), ...v } : v; }
    for (const c of a.set || []) { const h = by(c.shot_id); for (const [k, v] of Object.entries(c)) if (k !== "shot_id") { if (v === null) delete h[k]; else if (k === "camera" && h.camera && typeof v === "object") h.camera = { ...h.camera, ...v }; else h[k] = v; } }
    for (const id of a.delete || []) { const i = plan.shots.indexOf(by(id)), h = plan.shots[i], to = plan.shots[i - 1] || plan.shots[i + 1]; if (to && h.lines?.length) to.lines = i > 0 ? (to.lines || []).concat(h.lines) : h.lines.concat(to.lines || []); plan.shots.splice(i, 1); }
    for (const n of a.add || []) { let k = 1, id; do id = "S" + String(plan.shots.length + k++).padStart(3, "0"); while (plan.shots.some((q) => q.shot_id === id)); const h = { shot_id: id, scene_type: "insert", duration: 1.5, action: "", camera: { framing: "", move: "still" }, lines: [], line_placement: "on_speaker", source_ids: ["added:" + id], ...(n.shot || {}) }; h.shot_id = id; plan.shots.splice(n.after ? plan.shots.indexOf(by(n.after)) + 1 : 0, 0, h); }
    if (a.order) { if (a.order.length !== plan.shots.length || new Set(a.order).size !== a.order.length) throw new Stop("order must list every shot id once."); plan.shots = a.order.map(by); }
    for (const d of a.dialogue || []) { const l = (plan.dialogue || []).find((q) => q.line_id === d.line_id); if (!l) throw new Stop(`There is no line "${d.line_id}".`); if (d.mouth) l.mouth = d.mouth; }
    const r = await api("PUT", "/api/anime/plan?id=" + enc(a.scene), { json: plan });
    return { saved: true, shots: plan.shots.length, seconds: Math.round(plan.shots.reduce((t, h) => t + (+h.duration || 0), 0) * 10) / 10, check: { pass: r.check?.pass, errors: r.check?.errors, warnings: (r.check?.warnings || []).slice(0, 20) } };
  });
tool("anime_draw", "Draw for a scene: stills for shots, videos for shots (always paid, from the shot's still), or a sheet for someone in the look. note is saved on the shot as its direction first. dry_run shows the exact prompt and cost without spending.",
  { scene: S, shots: A(), what: { ...S, enum: ["still", "video"] }, sheet: { ...S, description: "A cast name: draw their sheet in the look instead (Codex, free)" }, note: S, dry_run: B, approved_usd: APPROVED }, ["scene"],
  async (a) => {
    const id = enc(a.scene);
    if (a.sheet) { await api("POST", `/api/anime/draw?id=${id}&sheet=${enc(a.sheet)}`); return { started: "sheet for " + a.sheet, next: "anime_scene shows it under drawing." }; }
    if (!a.shots?.length) throw new Stop("Give shots (shot ids) or sheet."); const video = a.what === "video";
    if (a.note) { const s = await get("/api/anime/scene?id=" + id); for (const sh of a.shots) { const h = s.plan.shots.find((q) => q.shot_id === sh); if (!h) throw new Stop(`There is no shot "${sh}".`); h[video ? "video_note" : "draw_note"] = a.note; } await api("PUT", "/api/anime/plan?id=" + id, { json: s.plan }); }
    const previews = []; let est = 0;
    for (const sh of a.shots) previews.push({ shot: sh, ...(await get(`/api/anime/${video ? "video-request" : "request"}?id=${id}&shot=${enc(sh)}`)) });
    if (video) { const m = await get("/api/models?kind=video"), c = m.choice || {}, opt = (m.options || []).find((o) => o.service === c.service && o.model === c.model) || {}; est = opt.est != null ? previews.reduce((t, p) => t + opt.est * Math.max(+p.duration || 0, 1), 0) : null; }
    else { const pm = await pictureModel(); est = pm.est === 0 ? 0 : pm.est == null ? null : pm.est * a.shots.length; }
    if (a.dry_run) return { estimate_usd: est, would_send: previews };
    const gate = await spendGate(est, `${video ? "Video" : "Stills"} for ${a.shots.length} shot${a.shots.length > 1 ? "s" : ""}`, a.approved_usd);
    for (const sh of a.shots) await api("POST", `/api/anime/draw?id=${id}&shot=${enc(sh)}${video ? "&what=video" : ""}`, { ok: okHead(est, a.approved_usd) });
    return { started: a.shots, estimate_usd: gate.cost, next: "anime_scene shows progress under drawing; a finished still or clip is put on its shot by the app." };
  });
tool("anime_run", "Start one of the long jobs. On a scene: blocking (the Blocking pass rewrites the plan, 10 to 20 min), previs (grey 3D score), render (view: pov | top), export (the scene as a video), check (asset check of the drawn stills). On a show: episode (join every scene of an episode into one video), show_idea (the Writer adds people and episodes from an idea). One job runs per scene at a time.",
  { kind: { ...S, enum: ["blocking", "previs", "render", "export", "check", "episode", "show_idea"] }, scene: S, show: S, episode: S, note: S, view: { ...S, enum: ["pov", "top"] }, subtitles: B }, ["kind"],
  async (a) => {
    const sub = a.subtitles === false ? 0 : 1; let job;
    if (a.kind === "episode") job = await api("POST", `/api/anime/episode?show=${enc(a.show)}&ep=${enc(a.episode)}&subs=${sub}`);
    else if (a.kind === "show_idea") job = await api("POST", `/api/anime/showidea?show=${enc(a.show)}`, { json: { idea: a.note || "" } });
    else { if (!a.scene) throw new Stop("Give the scene."); const id = enc(a.scene);
      job = a.kind === "blocking" ? await api("POST", "/api/anime/block?id=" + id, { json: { note: a.note || "" } }) : a.kind === "previs" ? await api("POST", "/api/anime/previs?id=" + id, { json: { note: a.note || "" } })
        : a.kind === "render" ? await api("POST", `/api/anime/render?id=${id}&view=${a.view || "pov"}`) : a.kind === "export" ? await api("POST", `/api/anime/export?id=${id}&subs=${sub}`) : await api("POST", "/api/anime/check?id=" + id); }
    const running = job?.kind && job.kind !== a.kind && job.status === "running";
    return { job: job?.kind ? { kind: job.kind, status: job.status, msg: job.msg } : "queued", note: running ? `Another job (${job.kind}) is already running on this ${a.scene ? "scene" : "show"}; yours did not start. Try again when it is done.` : undefined, next: a.scene ? "anime_scene shows the job and, for an export, the new file." : "anime_overview shows the show's job." };
  });

// ---------------------------------------------------------------- MCP over stdio (JSON-RPC 2.0, one message a line)
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") return send({ jsonrpc: "2.0", id, result: { protocolVersion: params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "ibasho", version: "0.1.0" }, instructions: "Ibasho: a manga and anime studio. Call `guide` first. Paid jobs need the person's yes (approved_usd)." } });
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: Object.values(T).map((t) => t.def) } });
  if (method === "tools/call") {
    const t = T[params?.name];
    if (!t) return send({ jsonrpc: "2.0", id, error: { code: -32602, message: "No such tool: " + params?.name } });
    try {
      const out = await t.run(params.arguments || {});
      return send({ jsonrpc: "2.0", id, result: out && out.content ? out : { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 1) }] } });
    } catch (e) { return send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: e instanceof Stop ? e.message : "The tool failed: " + String(e?.message || e).slice(0, 500) }] } }); }
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } });
}
let pending = Promise.resolve();
createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return; let msg; try { msg = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  pending = pending.then(() => handle(msg)).catch((e) => process.stderr.write(String(e) + "\n")); // one call at a time: two edits of one chapter never cross
});
