// "Use existing stills": pictures that already exist (an anime scene's stills) go onto a chapter's panels before anything is drawn.
// A source is a folder with a SCENE_PLAN.json whose shots carry `still` (a picture inside that folder) and `source_ids` (which part
// of the script or book the shot shows). Two kinds of source, and no free paths from a request:
//   - an anime scene kept in Ibasho (its own scene folder);
//   - a folder under a "stills folder" root. Roots are named when Ibasho starts (STUDIO_STILL_ROOTS, paths joined by ":") or added
//     on the computer that runs Ibasho (never from another device); a request then picks a root by number and a folder inside it.
// Matching (no model): same panel or same paragraph first, then the same people in frame, then the closest framing; no still twice.
import { readFile, readdir, stat, mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { join, resolve, extname, isAbsolute, basename } from "node:path";
import { tmpdir } from "node:os";
import { inside, reserved } from "./paths.mjs";
import { updateJson } from "./store.mjs";

const PICS = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const okId = (v) => typeof v === "string" && /^[\w-]{1,80}$/.test(v) && !reserved(v);
const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const first = (s) => norm(s).split(" ")[0] || "";

// ---------- matching ----------
/** How near the camera is, 0 (the widest) to 4 (an insert or extreme close-up); null when the words say nothing. */
export function distance(words) {
  const t = " " + norm(words) + " ";
  if (/ (ecu|xcu|extreme close|insert|detail|macro) /.test(t + " ") || / extreme close up /.test(t)) return 4;
  if (/ (mcu|medium close) /.test(t) || / medium close up /.test(t)) return 2.5;
  if (/ (cu|close|close up|closeup) /.test(t)) return 3;
  if (/ (ews|els|extreme wide|establishing|establish) /.test(t)) return 0;
  if (/ (ws|ls|wide|long|full|full figure|fs) /.test(t)) return 0.75;
  if (/ (mls|mws|medium wide|medium long|cowboy|three quarter) /.test(t)) return 1.25;
  if (/ (ms|medium|mid|two shot|waist) /.test(t)) return 2;
  return null;
}
const tail = (id) => String(id).split(":").pop();
const isPara = (id) => /^(p|para|par)?\d{1,6}$/i.test(tail(id));
/** What a panel is about: its own id, its lines, and the paragraphs it draws. */
export function panelKeys(q, script = []) {
  const b = q.board || {}, bySrc = new Map(script.filter((s) => s && s.id).map((s) => [s.id, s.src]));
  const lines = (b.lines || []).map((l) => l.source_id).filter(Boolean), paras = new Set((b.src || []).map(String));
  for (const id of lines) { const s = bySrc.get(id); for (const x of Array.isArray(s) ? s : s ? [s] : []) paras.add(String(x)); }
  return { lines, paras: [...paras], who: [...new Set((b.who || []).map((w) => first(w.name)).filter(Boolean))], dist: distance([b.shot, b.size].filter(Boolean).join(" ")) };
}
/** What a shot is about. `project` is the chapter being matched: a shot made from one of its panels names that panel. */
export function shotKeys(s) {
  const who = new Set();
  for (const w of s.blocking || []) if (w && w.name) who.add(first(w.name));
  for (const k of Object.keys(s.expressions || {})) who.add(first(k));
  for (const k of s.cast_in_frame || s.cast || []) if (typeof k === "string") who.add(first(k));
  who.delete("");
  return { ids: [...new Set([...(s.source_ids || []), ...(s.lines || [])].map(String))], panel: s.from_panel || null, who: [...who], dist: distance((s.camera && s.camera.framing) || s.framing || "") };
}
/** How well one still suits one panel: 0 = nothing ties them together (never offered). */
export function score(pk, sk, panelId, project) {
  let tie = 0, why = [];
  if (sk.panel && sk.panel.panel === panelId && (!sk.panel.project || !project || sk.panel.project === project)) { tie = 30; why.push("made from this panel"); }
  else {
    const same = sk.ids.filter((id) => pk.lines.includes(id) || pk.paras.includes(id)).length;
    const para = same ? 0 : sk.ids.filter((id) => isPara(id) && pk.paras.some((p) => isPara(p) && tail(p).replace(/^\D+/, "").replace(/^0+/, "") === tail(id).replace(/^\D+/, "").replace(/^0+/, ""))).length;
    if (same) { tie = 10 + Math.min(same, 3); why.push(pk.lines.some((l) => sk.ids.includes(l)) ? "same line" : "same paragraph"); }
    else if (para) { tie = 8; why.push("same paragraph number"); }
  }
  if (!tie) return { n: 0, why: "" };
  let n = tie;
  if (pk.who.length || sk.who.length) {
    const both = pk.who.filter((w) => sk.who.includes(w)).length, all = new Set([...pk.who, ...sk.who]).size, j = all ? both / all : 0;
    n += 3 * j; if (j === 1) why.push("same people in frame"); else if (both) why.push("some of the same people"); else if (pk.who.length && sk.who.length) why.push("other people in frame");
  } else { n += 1.5; }
  if (pk.dist != null && sk.dist != null) { const d = Math.abs(pk.dist - sk.dist); n += 1 - d / 4; why.push(d <= 0.5 ? "same framing" : d <= 1.25 ? "close framing" : "different framing"); }
  return { n: Math.round(n * 100) / 100, why: why.join(", ") };
}
/**
 * panels: [{ id, board }], shots: plan shots that have a still. Returns { [panel id]: { pick: shot id or "", why, options: [{ shot, why, n }] } }.
 * The best pairs are made first, each still used once; a panel whose only stills went elsewhere gets none (the Artist draws it).
 */
export function matchStills(panels, shots, { script = [], project = "" } = {}) {
  const sk = shots.map((s) => ({ id: s.shot_id, k: shotKeys(s) })), out = {}, pairs = [];
  for (const q of panels) {
    const pk = panelKeys(q, script), opts = [];
    for (const s of sk) { const r = score(pk, s.k, q.id, project); if (r.n > 0) opts.push({ shot: s.id, why: r.why, n: r.n }); }
    opts.sort((a, b) => b.n - a.n || String(a.shot).localeCompare(String(b.shot)));
    out[q.id] = { pick: "", why: "", options: opts.slice(0, 8) };
    for (const o of opts) pairs.push({ panel: q.id, ...o });
  }
  const order = new Map(panels.map((q, i) => [q.id, i]));
  pairs.sort((a, b) => b.n - a.n || order.get(a.panel) - order.get(b.panel) || String(a.shot).localeCompare(String(b.shot)));
  const used = new Set();
  for (const p of pairs) { if (out[p.panel].pick || used.has(p.shot)) continue; out[p.panel].pick = p.shot; out[p.panel].why = p.why; used.add(p.shot); }
  return out;
}

// ---------- the server side ----------
export function stillsApi({ ROOT, SAVED, APP, SCENES, run, oneAtATime, isLocal, body }) {
  const FILE = join(SAVED, "stills.json");
  const envRoots = String(process.env.STUDIO_STILL_ROOTS || "").split(":").map((s) => s.trim()).filter((s) => s && isAbsolute(s));
  const roots = async () => { let mine = []; try { mine = JSON.parse(await readFile(FILE, "utf8")).roots || []; } catch { /* none added */ } return [...new Set([...envRoots, ...mine.filter((s) => typeof s === "string" && isAbsolute(s))].map((s) => resolve(s)))]; };
  const readJson = async (f) => JSON.parse(await readFile(f, "utf8"));
  const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
  /** The folder a request means, or an error. Never a path from the request itself. */
  async function sourceDir(src) {
    if (src && src.scene != null) { const id = String(src.scene); if (!okId(id)) throw bad("There is no such anime scene.", 404); const d = join(SCENES, id); if (!existsSync(join(d, "SCENE_PLAN.json"))) throw bad("There is no such anime scene.", 404); return d; }
    if (src && src.root != null) {
      const all = await roots(), root = all[Number(src.root)]; if (!root || !Number.isInteger(Number(src.root))) throw bad("That stills folder is not set up on this computer.", 404);
      const rel = String(src.folder || "."), d = rel === "." ? root : inside(root, rel);
      if (!d || !existsSync(join(d, "SCENE_PLAN.json"))) throw bad("That folder has no SCENE_PLAN.json.", 404);
      return d;
    }
    throw bad("Say where the stills are.");
  }
  /** The shots of a source that have a picture we can read: [{ shot, still (path inside the folder) }] plus the plan's shots. */
  async function stillsOf(dir) {
    let plan; try { plan = await readJson(join(dir, "SCENE_PLAN.json")); } catch { throw bad("That folder's SCENE_PLAN.json could not be read."); }
    const shots = [];
    for (const s of Array.isArray(plan.shots) ? plan.shots : []) {
      if (!s || typeof s.shot_id !== "string" || !/^[\w.-]{1,60}$/.test(s.shot_id) || typeof s.still !== "string") continue;
      const f = inside(dir, s.still); if (!f || !PICS[extname(f).toLowerCase()] || !existsSync(f)) continue;
      shots.push(s);
    }
    return shots;
  }
  const picUrl = (src, rel) => "/api/stills/pic?" + (src.scene != null ? "scene=" + encodeURIComponent(src.scene) : "root=" + Number(src.root) + "&folder=" + encodeURIComponent(src.folder || ".")) + "&f=" + encodeURIComponent(rel);
  /** The chapter's panels as the person has them now (their saved pages when they are of this storyboard). Own projects only. */
  async function chapter(p) {
    if (!okId(p) || !existsSync(join(ROOT, "projects", p, "spec.json"))) throw bad("There is no such chapter.", 404);
    const dir = join(ROOT, "projects", p), spec = await readJson(join(dir, "spec.json"));
    let pages = spec.pages || [];
    try { const sv = await readJson(join(SAVED, p + ".json")); if (sv.pages && sv.pages.length && (sv.boardAt || "") === (spec.boardAt || "")) pages = sv.pages; } catch { /* none saved */ }
    const panels = [];
    const walk = (pg, rows) => { for (const r of rows || []) for (const q of (r && r.panels) || []) { if (q && q.rows) walk(pg, q.rows); else if (q && okId(q.id)) panels.push({ id: q.id, page: pg.id, number: pg.number, cover: !!pg.cover, board: q.board || {}, image: q.image || "" }); } };
    for (const pg of pages) if (pg && pg.layout) walk(pg, pg.layout.rows);
    return { dir, spec, panels };
  }
  async function findFolders(root) { // folders with a SCENE_PLAN.json, up to three levels down
    const out = [];
    const look = async (rel, depth) => {
      const d = rel ? inside(root, rel) : root; if (!d) return;
      if (existsSync(join(d, "SCENE_PLAN.json"))) out.push(rel || ".");
      if (depth >= 3 || out.length >= 200) return;
      let names = []; try { names = (await readdir(d, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules").map((e) => e.name).sort(); } catch { return; }
      for (const n of names.slice(0, 300)) await look(rel ? rel + "/" + n : n, depth + 1);
    };
    await look("", 0);
    return out;
  }

  /** Answers /api/stills/*; false when the address is not one of them. */
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith("/api/stills/")) return false;
    const send = (j, code = 200) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(j)); return true; };
    const what = url.pathname.slice("/api/stills/".length), q = url.searchParams;
    if (what === "sources" && req.method === "GET") { // where stills can come from: Ibasho's own anime scenes, and the stills folders set up on this computer
      const scenes = []; let ids = []; try { ids = (await readdir(SCENES)).sort(); } catch { /* no scenes */ }
      for (const id of ids) { if (!okId(id)) continue; try { const d = join(SCENES, id), n = (await stillsOf(d)).length; if (!n) continue; const sc = await readJson(join(d, "scene.json")).catch(() => ({})); scenes.push({ id, title: String(sc.title || id), stills: n }); } catch { /* not a scene */ } }
      const all = await roots(), local = isLocal(req), folders = [];
      for (let i = 0; i < all.length; i++) for (const rel of await findFolders(all[i])) { let n = 0; try { n = (await stillsOf(rel === "." ? all[i] : inside(all[i], rel))).length; } catch { /* unreadable plan */ } if (n) folders.push({ root: i, folder: rel, name: rel === "." ? basename(all[i]) : basename(all[i]) + "/" + rel, stills: n }); }
      return send({ scenes, folders, local, roots: all.map((r, i) => ({ i, name: basename(r), path: local ? r : "", fixed: envRoots.map((e) => resolve(e)).includes(r) })) });
    }
    if (what === "roots" && req.method === "POST") { // add or take away a stills folder: only on the computer that runs Ibasho
      if (!isLocal(req)) return send({ error: "A stills folder can only be added on the computer that runs Ibasho." }, 403);
      const j = JSON.parse(await body(req));
      if (j.add != null) {
        const p = String(j.add).trim(); let st = null; try { st = await stat(p); } catch { /* not there */ }
        if (!isAbsolute(p) || p.includes("\0") || !st || !st.isDirectory()) return send({ error: "That is not a folder on this computer. Give its whole path, starting with /." }, 400);
        if (resolve(p) === "/") return send({ error: "Pick the folder that holds the stills, not the whole disk." }, 400);
        await updateJson(FILE, (h) => { h.roots = [...new Set([...(Array.isArray(h.roots) ? h.roots : []), resolve(p)])].slice(0, 20); }, () => ({ roots: [] }));
      } else if (j.remove != null) { const p = resolve(String(j.remove)); await updateJson(FILE, (h) => { h.roots = (Array.isArray(h.roots) ? h.roots : []).filter((r) => resolve(r) !== p); }, () => ({ roots: [] })); }
      return send({ ok: true, roots: (await roots()).map((r, i) => ({ i, name: basename(r), path: r })) });
    }
    const srcOf = (o) => (o.scene != null ? { scene: String(o.scene) } : { root: Number(o.root), folder: String(o.folder || ".") });
    if (what === "pic" && req.method === "GET") { // one still of a source: pictures only, never out of the folder
      const src = srcOf(q.get("scene") != null ? { scene: q.get("scene") } : { root: q.get("root"), folder: q.get("folder") });
      const dir = await sourceDir(src), f = inside(dir, q.get("f") || ""), type = f && PICS[extname(f).toLowerCase()];
      let st = null; try { st = f && type ? await stat(f) : null; } catch { /* gone */ }
      if (!st || !st.isFile()) { res.statusCode = 404; res.end(); return true; }
      res.setHeader("content-type", type); res.setHeader("content-length", st.size); res.setHeader("cache-control", "private, max-age=300");
      await new Promise((ok) => { const s = createReadStream(f); s.on("error", () => { res.destroy(); ok(); }); s.on("end", ok); s.pipe(res); });
      return true;
    }
    if (what === "match" && req.method === "POST") { // which still suits which panel; nothing is changed
      const j = JSON.parse(await body(req)), src = srcOf(j.source || {}), dir = await sourceDir(src), shots = await stillsOf(dir), ch = await chapter(String(j.p || ""));
      const real = ch.panels.filter((x) => !x.cover), got = matchStills(real, shots, { script: ch.spec.script || [], project: String(j.p) });
      const stills = {}; for (const s of shots) { const k = shotKeys(s); stills[s.shot_id] = { url: picUrl(src, s.still), action: String(s.action || "").slice(0, 300), who: k.who, framing: String((s.camera && s.camera.framing) || "").slice(0, 60) }; }
      return send({ stills, count: shots.length, panels: real.map((x) => ({ id: x.id, page: x.page, number: x.number, action: String(x.board.action || "").slice(0, 300), shot: String(x.board.shot || ""), who: (x.board.who || []).map((w) => w.name), has: !!x.image, ...got[x.id] })) });
    }
    if (what === "use" && req.method === "POST") { // put the accepted stills on their panels (tools/use_stills.py), then one rebuild of the chapter
      const j = JSON.parse(await body(req)), src = srcOf(j.source || {}), dir = await sourceDir(src), shots = await stillsOf(dir), ch = await chapter(String(j.p || ""));
      if (!existsSync(join(ch.dir, "board.json"))) return send({ error: "This chapter has no storyboard file to rebuild from, so stills cannot be put on it." }, 400);
      const byShot = new Map(shots.map((s) => [s.shot_id, s])), ids = new Set(ch.panels.map((x) => x.id)), seen = new Set(), list = [];
      for (const pk of Array.isArray(j.picks) ? j.picks.slice(0, 2000) : []) {
        const s = pk && byShot.get(String(pk.shot)); if (!s || !ids.has(pk.panel) || seen.has(pk.panel)) continue;
        seen.add(pk.panel); list.push({ panel: pk.panel, shot: s.shot_id, file: inside(dir, s.still) });
      }
      if (!list.length) return send({ error: "No still was accepted." }, 400);
      const tmp = await mkdtemp(join(tmpdir(), "ibasho-stills-"));
      try {
        await writeFile(join(tmp, "picks.json"), JSON.stringify(list));
        const out = await oneAtATime(() => run("/usr/bin/python3", [join(APP, "tools/use_stills.py"), ch.dir, join(tmp, "picks.json")]));
        return send({ ok: true, placed: list.map((x) => ({ panel: x.panel, shot: x.shot })), said: out.trim().split("\n").pop() });
      } finally { await rm(tmp, { recursive: true, force: true }); }
    }
    if (what === "focus" && req.method === "POST") { // where the face is in a panel's still, kept with the picture so a rebuild keeps it
      const j = JSON.parse(await body(req)), ch = await chapter(String(j.p || "")), f = j.focus;
      if (!ch.panels.some((x) => x.id === j.panel) || !Array.isArray(f) || f.length !== 2 || !f.every((v) => typeof v === "number" && v >= 0 && v <= 1)) return send({ error: "Say which panel, and where in the picture (two numbers from 0 to 1)." }, 400);
      const file = join(ch.dir, "art", "assignments.json"); let found = false;
      await oneAtATime(() => updateJson(file, (a) => { if (!a[j.panel] || !a[j.panel].image) return false; a[j.panel].focus = [Math.round(f[0] * 1000) / 1000, Math.round(f[1] * 1000) / 1000]; found = true; }, () => ({})));
      return found ? send({ ok: true }) : send({ error: "That panel has no picture yet." }, 400);
    }
    return send({ error: "not found" }, 404);
  };
}
