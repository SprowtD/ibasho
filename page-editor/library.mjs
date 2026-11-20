// The Library: one list of every picture and video made in Ibasho, from every manga project, every anime scene and the
// Create space, that can be searched. It only reads: nothing is moved, copied or deleted, and every item is shown through
// the address the app already serves it from (a project's art, a scene's media, Create's file).
//   GET /library                      the screen
//   GET /api/library?q=&kind=&source=&from=&n=   -> { total, counts, items: [...], from, more }
//     q       words: an item is kept when every word is found in where it is from, its panel or shot, its words, or its cast
//     kind    "picture" | "video" | ""      source  "manga" | "anime" | "create" | ""
//     from, n paging (n at most 120), newest first
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inside, reserved } from "./paths.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENES = () => process.env.STUDIO_ANIME || join(HERE, "anime-scenes");
const okId = (v) => typeof v === "string" && /^[\w-]{1,80}$/.test(v) && !reserved(v);
const E = encodeURIComponent;
const json = (res, data, code = 200) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(data)); return true; };
const readJson = async (f, d) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return d; } };
const when = async (f) => { try { return (await stat(f)).mtime.toISOString(); } catch { return ""; } };
const cut = (s, n = 400) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
const PIC = /\.(png|jpe?g|webp)$/i;

/** A manga project's pictures: what its art list holds, each with the panel it sits on (what the panel shows, who is in it). */
async function fromProject(root, base, id, saved) {
  const dir = join(root, base, id), spec = await readJson(join(dir, "spec.json"), null); if (!spec) return [];
  const lib = await readJson(join(dir, "art", "library.json"), []); if (!Array.isArray(lib) || !lib.length) return [];
  let pages = spec.pages || []; // the person's saved copy says where each picture sits now, when it is of this storyboard
  const sv = await readJson(join(saved, id + ".json"), null); if (sv && Array.isArray(sv.pages) && sv.pages.length && (sv.boardAt || "") === (spec.boardAt || "")) pages = sv.pages;
  const on = new Map(), walk = (rows, pg) => { for (const r of rows || []) for (const q of r.panels || []) { if (q.rows) walk(q.rows, pg); else if (q.image && !on.has(q.image)) on.set(q.image, { pg, q }); } };
  for (const pg of pages) if (pg && pg.layout) { walk(pg.layout.rows, pg); for (const q of pg.layout.insets || []) if (q.image && !on.has(q.image)) on.set(q.image, { pg, q }); }
  const title = [spec.project, spec.chapter ? "chapter " + spec.chapter : ""].filter(Boolean).join(", ") || id, out = [];
  for (const e of lib) {
    if (!e || typeof e.src !== "string" || !PIC.test(e.src)) continue;
    const f = inside(dir, e.src); if (!f || !existsSync(f)) continue; // only a picture inside its own project
    const at = on.get(e.src), b = (at && at.q.board) || {};
    out.push({ key: `manga:${id}:${e.src}`, kind: "picture", source: "manga", from: title, where: at ? `${at.pg.label || "Page " + (at.pg.number || "")}${at.q.id ? " · " + at.q.id : ""}` : cut(e.label, 80) || "not on a page",
      words: cut(b.action || e.label), cast: (b.who || []).map((w) => cut(w && w.name, 40)).filter(Boolean), at: await when(f),
      thumb: `/${base}/${E(id)}/${e.src.split("/").map(E).join("/")}`, open: { type: "manga", project: id, page: at ? at.pg.id || "" : "" } });
  }
  return out;
}
/** An anime scene's stills and video clips, shot by shot. */
async function fromScene(id) {
  const dir = join(SCENES(), id), sc = await readJson(join(dir, "scene.json"), null), plan = await readJson(join(dir, "SCENE_PLAN.json"), null); if (!sc || !plan || !Array.isArray(plan.shots)) return [];
  const out = [], fileIn = (u) => { const m = typeof u === "string" && u.replace(/^\//, "").startsWith("api/anime/media") && /[?&]f=([^&]+)/.exec(u); if (!m) return null; let rel; try { rel = decodeURIComponent(m[1]); } catch { return null; } return /^(stills|clips)\/[\w][\w.-]*$/.test(rel) ? { rel, f: inside(dir, rel) } : null; };
  const said = (s) => (s.lines || []).map((lid) => (plan.dialogue || []).find((d) => d.line_id === lid)).filter(Boolean);
  for (const s of plan.shots) {
    if (!s || typeof s !== "object") continue;
    const lines = said(s), cast = [...new Set(lines.map((d) => cut(d.speaker || d.character, 40)).filter(Boolean))], words = cut([s.action, s.framing].filter(Boolean).join(" · "));
    for (const [field, kind] of [["still", "picture"], ["clip", "video"]]) {
      const got = fileIn(s[field]); if (!got || !got.f || !existsSync(got.f)) continue;
      const url = `/api/anime/media?id=${E(id)}&f=${E(got.rel)}`;
      out.push({ key: `anime:${id}:${got.rel}`, kind, source: "anime", from: cut(sc.title || id, 120), where: "shot " + cut(s.shot_id, 40), words, cast, at: await when(got.f),
        thumb: kind === "picture" ? url : (fileIn(s.still) && existsSync(fileIn(s.still).f) ? `/api/anime/media?id=${E(id)}&f=${E(fileIn(s.still).rel)}` : ""), file: url, open: { type: "anime", scene: id } });
    }
  }
  return out;
}
/** What was made or uploaded in the Create space. */
async function fromCreate(saved) {
  const dir = join(saved, "create"); let names = []; try { names = await readdir(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith(".json") || !okId(n.slice(0, -5))) continue;
    const m = await readJson(join(dir, n), null); if (!m || m.status !== "done" || typeof m.file !== "string" || !okId(String(m.id))) continue;
    const f = inside(dir, m.file); if (!f || !existsSync(f)) continue;
    const video = /\.mp4$/i.test(m.file), url = `/api/create/file?id=${E(m.id)}`;
    out.push({ key: `create:${m.id}`, kind: video ? "video" : "picture", source: "create", from: "Create", where: m.kind === "upload" ? "uploaded" : cut((m.model || "").split("/").pop(), 60), words: cut(m.prompt), cast: [], at: cut(m.at, 40) || (await when(f)),
      thumb: video ? (m.poster ? url + "&poster=1" : "") : url, file: url, open: { type: "create" } });
  }
  return out;
}

let kept = { at: 0, key: "", items: [] }, building = null;
/** Every item, newest first. Gathered at most once every 15 seconds (one gathering at a time), so a search box that asks on every letter stays light. */
async function everything(root, saved) {
  const key = root + "|" + saved + "|" + SCENES();
  if (kept.key === key && Date.now() - kept.at < 15000) return kept.items;
  if (!building) building = (async () => {
    const items = [];
    for (const base of ["projects", "samples"]) { let ids = []; try { ids = await readdir(join(root, base)); } catch { continue; }
      for (const id of ids.sort()) if (okId(id)) { try { items.push(...await fromProject(root, base, id, saved)); } catch { /* one unreadable project never empties the Library */ } } }
    { let ids = []; try { ids = await readdir(SCENES()); } catch { /* no scenes yet */ }
      for (const id of ids.sort()) if (okId(id)) { try { items.push(...await fromScene(id)); } catch { /* skipped */ } } }
    try { items.push(...await fromCreate(saved)); } catch { /* skipped */ }
    items.sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.key.localeCompare(b.key));
    kept = { at: Date.now(), key, items }; return items;
  })().finally(() => { building = null; });
  return building;
}
const flat = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
/** Is every word typed found somewhere in the item (where it is from, its panel or shot, its words, its cast)? */
export function matches(item, q) {
  const words = flat(q).split(/\s+/).filter(Boolean); if (!words.length) return true;
  const hay = flat([item.from, item.where, item.words, (item.cast || []).join(" "), item.source, item.kind].join(" "));
  return words.every((w) => hay.includes(w));
}

export async function library(req, res, url, ctx) {
  const p = url.pathname;
  if (p === "/library" || p === "/library/") { res.setHeader("content-type", "text/html; charset=utf-8"); res.setHeader("cache-control", "no-cache"); res.end(await readFile(join(HERE, "library.html"))); return true; }
  if (p !== "/api/library") return false;
  if (req.method !== "GET") return json(res, { error: "The Library only shows what is there." }, 405);
  try {
    const q = (url.searchParams.get("q") || "").slice(0, 200), kind = url.searchParams.get("kind") || "", source = url.searchParams.get("source") || "";
    const from = Math.max(0, parseInt(url.searchParams.get("from"), 10) || 0), n = Math.max(1, Math.min(120, parseInt(url.searchParams.get("n"), 10) || 60));
    if (url.searchParams.get("fresh") === "1") kept.at = 0; // asked for by the screen's "Look again"
    const all = await everything(ctx.root, ctx.saved), counts = { all: all.length, picture: 0, video: 0, manga: 0, anime: 0, create: 0 };
    for (const it of all) { counts[it.kind]++; counts[it.source]++; }
    const hit = all.filter((it) => (!kind || it.kind === kind) && (!source || it.source === source) && matches(it, q));
    return json(res, { total: hit.length, counts, from, items: hit.slice(from, from + n), more: from + n < hit.length });
  } catch (e) { return json(res, { error: "The Library could not be read: " + String(e.message || e).slice(0, 200) }, 500); }
}
