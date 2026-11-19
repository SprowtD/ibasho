// The Paneler for a chapter of a book, unattended: adapts the numbered paragraphs into a storyboard that adds nothing.
// Usage: node tools/book_board.mjs <project dir>        (a project started from a book: project.json has "series")
//   1. the chapter is cut into sections of about 1,300 words (at a scene break where there is one)
//   2. Codex storyboards each section (tools/paneler_task.mjs in book mode), three at a time
//   3. every section is checked against the book: each lettered line sits word for word in the paragraph it names,
//      every stretch of speech is used, every paragraph is drawn, the order is the book's. A section that fails is sent back once.
//   4. the sections are joined into script.json + board.json (the caller then runs tools/build_spec.mjs)
// Work files are in <project>/sections/; progress in sections/progress.json. A section already done is not done again
// unless --fresh is given.
import fs from "node:fs"; import path from "node:path"; import { spawn, execFileSync } from "node:child_process";

const dir = path.resolve(process.argv[2] || "."), fresh = process.argv.includes("--fresh"), APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EFFORT = process.env.STUDIO_BOARD_EFFORT || "high", WORDS = 1300, TOGETHER = 3, PER_PAGE = 115;
const work = path.join(dir, "sections");
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const meta = readJson(path.join(dir, "project.json")) || {};
const paras = [...fs.readFileSync(path.join(dir, "script.md"), "utf8").matchAll(/^\[([^\]\n]+)\] (.*)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
if (!paras.length) { console.error("This chapter has no numbered paragraphs."); process.exit(1); }
if (fresh) fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
const count = (s) => (String(s).match(/\S+/g) || []).length;
const flat = (s) => String(s || "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
const short = (id) => String(id).split(":").pop();
const progress = (p) => fs.writeFileSync(path.join(work, "progress.json"), JSON.stringify({ ...p, pid: process.pid, now: Date.now() }));

function codex(cwd, prompt, minutes = 25) {
  return new Promise((res, rej) => {
    const c = spawn("codex", ["exec", "-c", `model_reasoning_effort="${EFFORT}"`, "--skip-git-repo-check", "--sandbox", "workspace-write", "-C", cwd, prompt], { stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; c.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
    const t = setTimeout(() => { c.kill(); rej(new Error(`Codex took longer than ${minutes} minutes`)); }, minutes * 60000);
    c.on("error", (e) => { clearTimeout(t); rej(new Error("Codex could not start: " + e.message)); });
    c.on("exit", (code) => { clearTimeout(t); code === 0 ? res() : rej(new Error("Codex stopped (" + code + "): " + err.trim().split("\n").pop())); });
  });
}

// ---------- 1. sections ----------
const total = paras.reduce((n, p) => n + count(p.text), 0), want = Math.max(1, Math.round(total / WORDS)), share = total / want;
const isBreak = (t) => /^[\s*#~·•\-–—_]{1,12}$/.test(t) || /^\*\s*\*\s*\*$/.test(t.trim());
const sections = []; { let cur = [], n = 0;
  paras.forEach((p, i) => {
    cur.push(p); n += count(p.text);
    const left = paras.slice(i + 1).reduce((a, q) => a + count(q.text), 0), next = paras[i + 1];
    const full = n >= share * 0.95 || (n >= share * 0.7 && next && isBreak(next.text)); // a scene break a little early beats a cut mid-scene
    if (next && sections.length < want - 1 && full && left >= share * 0.5) { sections.push(cur); cur = []; n = 0; }
  });
  if (cur.length) sections.push(cur); }
// which way the chapter reads (the book's settings first, as in tools/build_spec.mjs): a storyboard made for one direction is not reused for the other
const reading = (() => { const b = readJson(path.join(dir, "bible.json")) || {}; return b.reading === "rtl" || b.reading === "ltr" ? b.reading : meta.reading === "rtl" ? "rtl" : "ltr"; })();
const key = (sec) => sec[0].id + ">" + sec[sec.length - 1].id + ":" + (meta.paneler_note || "") + (reading === "rtl" ? ":rtl" : "");
// a page's reveal belongs first on its page: sections are joined end to end, so the check for it runs on the whole chapter in the editor

// ---------- 3. the checks ----------
/** Speech in a paragraph: the stretches between quotation marks (a word or two in quotes with no punctuation is not speech). */
function speech(text) {
  const out = [], t = text.replace(/"([^"]*)"/g, "“$1”");
  for (const m of t.matchAll(/“([^”]*)(?:”|$)/g)) { const s = m[1].trim(); if (s && (count(s) >= 3 || /[.!?,…—-]$/.test(s))) out.push(s); }
  return out;
}
/** A page's rows: its own hand-made layout, or (the usual case since the panel director) its flat list of panels as one row. */
const rowsOf = (pg) => (Array.isArray(pg.rows) ? pg.rows : [{ panels: pg.panels || [] }]);
function check(sec, script, board) {
  const faults = [], ids = new Set(sec.map((p) => p.id)), text = new Map(sec.map((p) => [p.id, p.text])), order = new Map(sec.map((p, i) => [p.id, i]));
  const lines = (script.beats || []).filter((b) => b.type === "line"), byPara = new Map();
  let last = -1;
  for (const l of lines) {
    if (!l.src || !ids.has(l.src)) { faults.push(`Line ${l.id} (“${String(l.text).slice(0, 40)}”) has no \`src\` paragraph from this text.`); continue; }
    if (!flat(text.get(l.src)).includes(flat(l.text).replace(/,$/, ""))) faults.push(`Line ${l.id} is not word for word from ${l.src}: “${String(l.text).slice(0, 70)}”. Copy the book's words exactly.`);
    if (order.get(l.src) < last) faults.push(`Line ${l.id} (${short(l.src)}) comes before an earlier line in the book: keep the book's order.`);
    last = Math.max(last, order.get(l.src));
    if (!l.speaker && count(l.text) > 30) faults.push(`Caption ${l.id} is ${count(l.text)} words: keep captions to 25 or fewer, or let the picture carry it.`);
    byPara.set(l.src, (byPara.get(l.src) || []).concat(flat(l.text).replace(/,$/, "")));
  }
  for (const p of sec) for (const s of speech(p.text)) { // every stretch of speech is lettered
    let rest = flat(s);
    for (const t of byPara.get(p.id) || []) { const i = rest.indexOf(t); if (i >= 0) rest = rest.slice(0, i) + " " + rest.slice(i + t.length); }
    if (/[a-z0-9]/.test(rest)) faults.push(`Speech left out or cut short in ${p.id}: “${s.slice(0, 70)}”. Every stretch of speech is a line.`);
  }
  const drawn = new Set(), walk = (rows) => { for (const r of rows || []) for (const q of r.panels || []) { if (q.rows) walk(q.rows); else for (const s of q.src || []) drawn.add(s); } };
  for (const pg of board.pages || []) walk(rowsOf(pg));
  const missing = sec.filter((p) => !drawn.has(p.id) && !isBreak(p.text) && count(p.text) > 3).map((p) => p.id);
  if (missing.length) faults.push(`These paragraphs are in no panel's \`src\` (nothing that happens may be left out): ${missing.join(", ")}.`);
  const used = new Set(); for (const pg of board.pages || []) (function w(rows) { for (const r of rows || []) for (const q of r.panels || []) { if (q.rows) w(q.rows); else for (const l of q.lines || []) used.add(l.id); } })(rowsOf(pg));
  const text2 = new Map(lines.map((l) => [l.id, l.text]));
  (board.pages || []).forEach((pg, n) => { // the page limits every storyboard keeps
    let panels = 0, words = 0; const said = new Set();
    (function w(rows) { for (const r of rows || []) for (const q of r.panels || []) { if (q.rows) { w(q.rows); continue; } panels++; if ((q.lines || []).length > 3) faults.push(`Page ${n + 1}: a panel has ${(q.lines || []).length} balloons (at most 3). Add a panel.`);
      for (const l of q.lines || []) { if (l.kind === "title" || !text2.has(l.id)) continue; said.add(l.id); words += count(text2.get(l.id)); } } })(rowsOf(pg));
    if (panels > 6) faults.push(`Page ${n + 1} has ${panels} panels (the limit is 6). Move beats to a new page.`);
    if (said.size > 5) faults.push(`Page ${n + 1} has ${said.size} spoken lines (the limit is 5). Move beats to a new page.`);
    if (words > 70) faults.push(`Page ${n + 1} has ${words} lettered words (the limit is 70). Move beats to a new page.`);
  });
  if ((board.pages || []).length > 20) faults.push(`The chapter has ${(board.pages || []).length} pages (the limit is 20: X takes 20 pictures a post). Fit it into 20 pages: fuller pages within the page limits, fewer separate beats.`);
  for (const l of lines) if (!used.has(l.id)) faults.push(`Line ${l.id} is in script.json but on no page.`);
  return faults;
}

// ---------- 2. one section ----------
async function doSection(sec, i) {
  const nn = String(i + 1).padStart(2, "0"), sd = path.join(work, nn), k = key(sec), done = readJson(path.join(sd, "done.json"));
  if (done && done.key === k) return done;
  fs.rmSync(sd, { recursive: true, force: true }); fs.mkdirSync(sd, { recursive: true });
  const words = sec.reduce((n, p) => n + count(p.text), 0);
  fs.writeFileSync(path.join(sd, "script.md"), sec.map((p) => `[${p.id}] ${p.text}`).join("\n\n") + "\n");
  fs.writeFileSync(path.join(sd, "project.json"), JSON.stringify({ paneler_note: meta.paneler_note || "", reading }));
  if (fs.existsSync(path.join(dir, "bible.json"))) fs.copyFileSync(path.join(dir, "bible.json"), path.join(sd, "bible.json")); // the series' known names
  const before = i ? sections[i - 1].slice(-4).map((p) => p.text).join("\n").slice(-900) : "";
  fs.writeFileSync(path.join(sd, "book.json"), JSON.stringify({ section: i + 1, of: sections.length, example: sec[0].id, title: i === 0 && /^(chapter|part|prologue|epilogue)\b/i.test(sec[0].text) && count(sec[0].text) < 14, before, pages: Math.max(2, Math.round(words / PER_PAGE)) }));
  const task = execFileSync("node", [path.join(APP, "tools/paneler_task.mjs"), sd]).toString().trim();
  const load = () => { const s = readJson(path.join(sd, "script.json")), b = readJson(path.join(sd, "board.json")); if (!s || !Array.isArray(s.beats) || !b || !Array.isArray(b.pages) || !b.pages.length) throw new Error(`Codex did not leave a readable storyboard for section ${i + 1}`); return { script: s, board: b }; };
  let got, last;
  for (let go = 0; go < 2 && !got; go++) {
    try { await codex(sd, `Read the task file ${task} and follow it exactly: write script.json and board.json in this folder, then stop.`); got = load(); } catch (e) { last = e; }
  }
  if (!got) throw last;
  let faults = check(sec, got.script, got.board);
  if (faults.length) { // sent back once with what the checks found
    const fix = path.join(sd, "BOOK_FIX.md"), keep = { s: JSON.stringify(got.script), b: JSON.stringify(got.board) };
    fs.writeFileSync(fix, `# Paneler: fix this section against the book\n\nYour \`script.json\` and \`board.json\` in \`${sd}\` were checked against the book's text (\`script.md\`). These must be fixed:\n\n${faults.map((m) => "- " + m).join("\n")}\n\nRewrite both files (same format and rules as \`PANELER_TASK.md\`) so every one is fixed. A missing line or paragraph usually needs a new panel or a new page: more pages is fine. Add nothing that is not in the book. Then stop.\n`);
    try {
      await codex(sd, `Read the task file ${fix} and follow it exactly: rewrite script.json and board.json in this folder, then stop.`);
      const again = load(), f2 = check(sec, again.script, again.board);
      if (f2.length < faults.length) { got = again; faults = f2; } else throw new Error("no better");
    } catch { fs.writeFileSync(path.join(sd, "script.json"), keep.s); fs.writeFileSync(path.join(sd, "board.json"), keep.b); got = { script: JSON.parse(keep.s), board: JSON.parse(keep.b) }; }
  }
  const out = { key: k, script: got.script, board: got.board, faults };
  fs.writeFileSync(path.join(sd, "done.json"), JSON.stringify(out));
  return out;
}

// ---------- run ----------
const started = Date.now();
try {
  let done = 0; const res = new Array(sections.length), queue = sections.map((s, i) => i);
  progress({ status: "storyboarding", done, total: sections.length, started });
  await Promise.all(Array.from({ length: Math.min(TOGETHER, sections.length) }, async () => {
    while (queue.length) { const i = queue.shift(); res[i] = await doSection(sections[i], i); progress({ status: "storyboarding", done: ++done, total: sections.length, started }); }
  }));
  // 4. join: beats and lines renumbered through the chapter
  const beats = [], pages = [], cast = [], faults = []; let L = 0, A = 0, Sn = 0, title = "";
  res.forEach((r, i) => {
    const map = new Map();
    if (!title && r.script.title) title = String(r.script.title);
    for (const b of r.script.beats) {
      const o = { ...b };
      if (b.type === "line") { o.id = "L" + String(++L).padStart(3, "0"); map.set(b.id, o.id); } else if (b.type === "scene") o.id = "S" + ++Sn; else o.id = "A" + String(++A).padStart(3, "0");
      beats.push(o);
    }
    const fixRows = (rows) => (rows || []).map((row) => ({ ...row, panels: (row.panels || []).map((q) => (q.rows ? { ...q, rows: fixRows(q.rows) } : { ...q, lines: (q.lines || []).filter((l) => map.has(l.id)).map((l) => ({ ...l, id: map.get(l.id) })) })) }));
    for (const pg of r.board.pages) pages.push(Array.isArray(pg.rows) ? { ...pg, rows: fixRows(pg.rows) } : { ...pg, panels: fixRows(rowsOf(pg))[0].panels });
    for (const c of r.board.cast || []) if (c && c.name && !cast.some((x) => x.name === c.name)) cast.push(c);
    for (const f of r.faults) faults.push(sections.length > 1 ? `Section ${i + 1}: ${f}` : f);
  });
  fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify({ title, beats }, null, 1));
  fs.writeFileSync(path.join(dir, "board.json"), JSON.stringify({ cast, pages }, null, 1));
  fs.writeFileSync(path.join(work, "faults.json"), JSON.stringify(faults, null, 1));
  progress({ status: "done", done, total: sections.length, started, took: Date.now() - started });
  console.log(JSON.stringify({ sections: sections.length, pages: pages.length, lines: L, book_faults: faults, minutes: Math.round((Date.now() - started) / 6000) / 10 }));
} catch (e) {
  progress({ status: "failed", msg: String(e.message || e).slice(0, 300), started });
  console.error(String(e.message || e)); process.exit(1);
}
