// The Create space (TODO item 35): make a picture or a video from any connected model, keep everything made in one history,
// and send a result to a manga panel or an anime shot. Files live in <saved>/create/: <id>.png|jpg|mp4 + <id>.json (what made it).
// Jobs run through the studio's one queue (server.mjs calls runCreate); paid jobs are priced, capped and logged like the rest (spend.mjs).
import { readFile, writeFile, readdir, mkdir, copyFile, rm, stat } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { join, dirname, extname } from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { routeModel, orModel, estimate, videoRes } from "./models.mjs";
import { orPicture, orVideo } from "./openrouter.mjs";
import { logSpend, guardSpend, okFrom } from "./spend.mjs";
import { attachToShot, shotTargets } from "../anime/server.mjs";
import { readBody as readLimited, MB } from "./limits.mjs";
import { webMp4 } from "./media.mjs";
import { codexRun as runCodex, dataFile, DATA_RULE } from "./codex.mjs"; // the person's prompt goes to Codex as a data file

const HERE = dirname(fileURLToPath(import.meta.url)), APP = join(HERE, "..");
const DIR = (saved) => join(saved, "create");
const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4" };
const ASPECTS = { "1:1": [1024, 1024], "2:3": [1024, 1536], "3:2": [1536, 1024], "16:9": [1536, 864], "9:16": [864, 1536] };
const newId = () => new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 6);
const safeId = (s) => String(s || "").replace(/[^\w-]/g, "");
const run = (cmd, args) => new Promise((ok, no) => execFile(cmd, args, { maxBuffer: 1 << 24, timeout: 600000 }, (e, o, err) => (e ? no(new Error(String(err || e.message).trim().split("\n").pop())) : ok(String(o)))));

async function meta(saved, id) { try { return JSON.parse(await readFile(join(DIR(saved), safeId(id) + ".json"), "utf8")); } catch { return null; } }
async function setMeta(saved, m) { await mkdir(DIR(saved), { recursive: true }); await writeFile(join(DIR(saved), m.id + ".json"), JSON.stringify(m, null, 1)); }
const fileOf = (saved, m) => (m && m.file ? join(DIR(saved), m.file) : "");

/** Everything made or uploaded here, newest first. */
async function list(saved) {
  let names = []; try { names = await readdir(DIR(saved)); } catch { return []; }
  const out = []; for (const n of names.filter((x) => x.endsWith(".json"))) { const m = await meta(saved, n.slice(0, -5)); if (m) out.push(m); }
  return out.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}

/** A picture that came back in another shape than the one asked for is cut to that shape, from the middle (nothing is stretched).
 * Returns "1536x1024 to 1024x1024" when it cut, "" when the shape was right or the file could not be read. */
export async function fitShape(file, aspect) {
  const want = ASPECTS[aspect]; if (!want) return "";
  const py = `import sys
from PIL import Image
f, tw, th = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
im = Image.open(f); w, h = im.size; r = tw / th
if abs(w / h - r) / r < 0.02: sys.exit(0)
nw, nh = (round(h * r), h) if w / h > r else (w, round(w / r))
x, y = (w - nw) // 2, (h - nh) // 2
im.crop((x, y, x + nw, y + nh)).save(f)
print(f"{w}x{h} to {nw}x{nh}")`;
  return new Promise((ok) => execFile("/usr/bin/python3", ["-c", py, file, String(want[0]), String(want[1])], { timeout: 60000 }, (e, out) => ok(e ? "" : String(out).trim())));
}
// Codex's image tool takes three sizes; each shape goes to the nearest one.
const CODEX_SIZE = { "1:1": "1024 x 1024", "2:3": "1024 x 1536", "9:16": "1024 x 1536", "3:2": "1536 x 1024", "16:9": "1536 x 1024" };
const codexRun = (dir, prompt, minutes = 12) => runCodex(dir, prompt, { minutes });
/** Run one Create job (called by the studio queue). job = { kind: "create", cid }. */
export async function runCreate(saved, job) {
  const m = await meta(saved, job.cid); if (!m) throw new Error("That request is gone.");
  const upd = async (o) => { Object.assign(m, o); await setMeta(saved, m); };
  try {
    await upd({ status: "working", msg: "" });
    const r = await routeModel(saved, m.kind, { service: m.service, model: m.model, quality: m.quality }); job.model = r.model; job.what = m.kind;
    if (m.kind === "picture") {
      if (r.service === "codex") { // Codex: its built-in image tool, included in the person's ChatGPT plan (no OpenRouter cost)
        const refs = (m.refs || []).map((id) => join(DIR(saved), id)).filter((f) => existsSync(f));
        const out = join(DIR(saved), m.id + ".png"), task = join(DIR(saved), m.id + "-CODEX_TASK.md"), said = await dataFile(join(DIR(saved), m.id + "-PROMPT.txt"), m.prompt); // the person's prompt: a data file, never inside the task (it could close a code fence and add orders)
        const size = CODEX_SIZE[m.aspect] || "1024 x 1024";
        await writeFile(task, `# Codex task: one picture for the Create space\n\nUse your built-in image generation tool at the highest quality it offers. The prompt is the whole text of the DATA file \`${said}\`: send it exactly as written, at the size given` +
          (refs.length ? `, with the pictures listed under Attach in that order as references` : `, with no images attached`) + `. Save the picture as a PNG at the Save as path (never overwrite a file), then stop. Write nothing else.\n\n${DATA_RULE}\n\n` +
          `**Save as:** \`${out}\`\n\n**Size:** ${size}\n\n` + (refs.length ? `**Attach:**\n${refs.map((f) => "- `" + f + "`").join("\n")}\n\n` : ""));
        await upd({ msg: "Drawing with Codex (about 2 to 4 minutes)" });
        await codexRun(DIR(saved), `Read the task file ${task} and follow it exactly: one picture made with your built-in image generation tool, saved at the Save as path. Then stop.`);
        if (!existsSync(out)) throw new Error("Codex finished without saving the picture. Try again, or pick another model.");
        const cut = await fitShape(out, m.aspect); // Codex draws in three sizes only and sometimes not the one asked for
        await rm(task, { force: true }); await rm(said, { force: true });
        await logSpend(saved, { project: "Create", what: "picture", kind: "picture", service: "codex", model: "codex", usd: 0, est: 0 });
        job.cost = 0; await upd({ status: "done", msg: "", file: m.id + ".png", service: "codex", model: "codex", cost: 0, estimated: false, ...(cut ? { cropped: cut } : {}) });
        return;
      }
      const refs = (m.refs || []).map((id) => existsSync(join(DIR(saved), id)) ? join(DIR(saved), id) : "").filter(Boolean);
      const size = ASPECTS[m.aspect] || [1024, 1024], est = await estimate("picture", r.model, { quality: r.quality, size, refs: refs.length, chars: m.prompt.length });
      const free = await guardSpend(saved, est, "This picture", job.ok);
      await upd({ msg: "Sent to " + r.model.split("/").pop() });
      const got = await orPicture(r.key, r.model, { prompt: m.prompt, size, refs, quality: r.quality }).catch((e) => { free(); throw e; });
      await writeFile(join(DIR(saved), m.id + ".png"), got.bytes);
      await logSpend(saved, { project: "Create", what: "picture", kind: "picture", model: r.model, quality: r.quality, usd: got.cost, est });
      job.cost = got.cost ?? est; await upd({ status: "done", msg: "", file: m.id + ".png", cost: got.cost ?? est, estimated: got.cost == null });
    } else if (m.kind === "video") {
      if (r.service !== "openrouter") throw new Error("Pick a video model first.");
      const cat = await orModel("video", r.model); if (!cat) throw new Error("That video model is not on the list any more.");
      const res = m.resolution && (cat.resolutions || []).includes(m.resolution) ? m.resolution : videoRes(cat);
      const first = m.first ? join(DIR(saved), m.first) : null, last = m.last ? join(DIR(saved), m.last) : null;
      const est = await estimate("video", r.model, { resolution: res, seconds: m.seconds }); const free = m.orJob ? () => {} : await guardSpend(saved, est, "This video", job.ok);
      const got = await orVideo(r.key, r.model, { prompt: m.prompt, duration: m.seconds, resolution: res, aspect: m.aspect || "16:9", first: first && existsSync(first) ? first : null, last: last && existsSync(last) ? last : null, sound: !!m.sound, resumeId: m.orJob || "", onJob: async (id) => { m.orJob = id; job.orJob = id; await setMeta(saved, m); }, onStatus: (t) => { m.msg = t; job.msg = t; setMeta(saved, m).catch(() => {}); } }).catch(async (e) => { // nothing was sent, or it failed: the held amount goes back. Sent and never came back in time: it may still be charged, so the estimate is logged
        if (m.orJob && /^No video after/.test(e.message || "")) await logSpend(saved, { project: "Create", what: "video (no answer in time: may still be charged)", kind: "video", model: r.model, est }); else free(); throw e; });
      const raw = join(DIR(saved), m.id + ".in.mp4"), out = join(DIR(saved), m.id + ".mp4"); await writeFile(raw, got.bytes);
      try { await webMp4(raw, out); } finally { await rm(raw, { force: true }); } // usually re-wrapped in a second, not re-encoded
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "0.3", "-i", out, "-frames:v", "1", "-q:v", "3", join(DIR(saved), m.id + ".jpg")]).catch(() => {});
      await logSpend(saved, { project: "Create", what: "video", kind: "video", model: r.model, usd: got.cost, est });
      job.cost = got.cost ?? est; await upd({ status: "done", msg: "", file: m.id + ".mp4", poster: existsSync(join(DIR(saved), m.id + ".jpg")) ? m.id + ".jpg" : "", resolution: res, cost: got.cost ?? est, estimated: got.cost == null });
    } else throw new Error("Unknown kind.");
  } catch (e) { await upd({ status: "failed", msg: String(e.message || e).slice(0, 300) }); throw e; }
}

/** After a restart: a Create job that was waiting or half done is not sent again by itself (it may be paid for already). */
export async function abandonCreate(saved, cid) { // true = it can carry on (a video OpenRouter already has); false = stopped
  const m = await meta(saved, cid); if (!m || !(m.status === "waiting" || m.status === "working")) return false;
  if (m.kind === "video" && m.orJob) return true;
  m.status = "failed"; m.msg = "Stopped by a restart of Ibasho. Press Make again if you still want it."; await setMeta(saved, m); return false; }
/** The manga panels of a project, for "send to a panel". */
async function panelTargets(projDir) {
  const spec = JSON.parse(await readFile(join(projDir, "spec.json"), "utf8")), out = [];
  const walk = (rows, pg) => { for (const r of rows || []) for (const q of r.panels || []) { if (q.rows) walk(q.rows, pg); else out.push({ id: q.id, label: `${pg.label || "Page " + pg.number} · ${((q.board && q.board.action) || q.id).slice(0, 80)}` }); } };
  for (const pg of spec.pages || []) if (pg.layout) { walk(pg.layout.rows, pg); for (const q of pg.layout.insets || []) out.push({ id: q.id, label: `${pg.label || "Page " + pg.number} · inset` }); }
  return out;
}

const readBody = (req, max = 1 * MB) => readLimited(req, max); // JSON asks: 1 MB; an uploaded picture: 30 MB
const json = (res, data, code = 200) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(data)); return true; };

/** Routes. ctx = { saved, queue(job) -> job, projDir(id), projects() }. */
export async function create(req, res, url, ctx) {
  const p = url.pathname, saved = ctx.saved;
  if (p === "/create" || p === "/create/") { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(await readFile(join(HERE, "create.html"))); return true; }
  if (!p.startsWith("/api/create")) return false;
  try {
    if (p === "/api/create/file") { // a made or uploaded file
      const m = await meta(saved, url.searchParams.get("id")), f = url.searchParams.get("poster") && m && m.poster ? join(DIR(saved), m.poster) : fileOf(saved, m);
      if (!f || !existsSync(f)) return json(res, { error: "not found" }, 404);
      const st = await stat(f); res.setHeader("content-type", TYPES[extname(f).toLowerCase()] || "application/octet-stream"); res.setHeader("content-length", st.size); res.setHeader("cache-control", "max-age=3600");
      if (url.searchParams.get("download")) res.setHeader("content-disposition", `attachment; filename="ibasho-${m.id}${extname(f)}"`);
      const rs = createReadStream(f); rs.on("error", () => res.destroy()); rs.pipe(res); return true;
    }
    if (p === "/api/create/upload" && req.method === "POST") { // a picture of the person's own, to use as a reference or a frame
      const name = String(url.searchParams.get("name") || "picture.png"), ext = extname(name).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return json(res, { error: "Use a jpg, png or webp picture." }, 400);
      const id = newId(), data = await readBody(req, 30 * MB); await mkdir(DIR(saved), { recursive: true }); await writeFile(join(DIR(saved), id + ext), data);
      const m = { id, kind: "upload", status: "done", file: id + ext, prompt: name.slice(0, 80), at: new Date().toISOString() }; await setMeta(saved, m); return json(res, m);
    }
    if (p === "/api/create/list") return json(res, await list(saved));
    if (p === "/api/create/targets") { // where a result can go: manga projects with their panels, anime scenes with their shots
      const pid = url.searchParams.get("project");
      if (pid) return json(res, await panelTargets(ctx.projDir(safeId(pid))));
      return json(res, { projects: (await ctx.projects()).map((x) => ({ id: x.id, label: x.label || x.title || x.id })), scenes: await shotTargets() });
    }
    if (p === "/api/create/send" && req.method === "POST") { // put a result on a panel or a shot
      const b = JSON.parse((await readBody(req)).toString() || "{}"), m = await meta(saved, b.id), f = fileOf(saved, m);
      if (!f || !existsSync(f)) return json(res, { error: "That file is gone." }, 404);
      if (b.to === "shot") return json(res, await attachToShot(String(b.scene), String(b.shot), f, `Create: ${(m.model || "").split("/").pop()}`));
      if (b.to === "panel") {
        if (m.kind === "video") return json(res, { error: "A manga panel takes a picture, not a video." }, 400);
        const proj = ctx.projDir(safeId(b.project)), panel = safeId(b.panel), dir = join(proj, "art", "panels"); await mkdir(dir, { recursive: true });
        let n = 1, name; do name = `${panel}-take${String(n++).padStart(2, "0")}.png`; while (existsSync(join(dir, name)));
        await run("/usr/bin/python3", ["-c", "import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).convert('RGB').save(sys.argv[2])", f, join(dir, name)]);
        await run("/usr/bin/python3", [join(APP, "tools/artist_panel.py"), proj, panel, join(dir, name)]);
        return json(res, { ok: true, take: name });
      }
      return json(res, { error: "Send it where?" }, 400);
    }
    if (p === "/api/create" && req.method === "DELETE") {
      const m = await meta(saved, url.searchParams.get("id")); if (!m) return json(res, { ok: true });
      for (const f of [m.file, m.poster, m.id + ".json"].filter(Boolean)) await rm(join(DIR(saved), f), { force: true });
      return json(res, { ok: true });
    }
    if (p === "/api/create" && req.method === "POST") { // start one picture or video
      const b = JSON.parse((await readBody(req)).toString() || "{}"), kind = b.kind === "video" ? "video" : "picture", prompt = String(b.prompt || "").trim().slice(0, 8000);
      if (!prompt) return json(res, { error: "Write what to make first." }, 400);
      const r = await routeModel(saved, kind, b.service ? { service: b.service, model: b.model, quality: b.quality } : undefined);
      if (r.service === "openrouter" && !(await orModel(kind, r.model))) return json(res, { error: "That model is not on the list." }, 400); // only models whose price we know how to look up
      const items = await list(saved), fileFor = (id) => (items.find((x) => x.id === id) || {}).file || null;
      const m = { id: newId(), kind, status: "waiting", prompt, service: r.service, model: r.model, quality: r.quality || "", aspect: String(b.aspect || (kind === "video" ? "16:9" : "1:1")), at: new Date().toISOString(),
        ...(kind === "picture" ? { refs: (Array.isArray(b.refs) ? b.refs : []).slice(0, 16).map(fileFor).filter(Boolean) } : { seconds: Math.max(1, Math.min(30, Math.round(+b.seconds || 5))), resolution: String(b.resolution || ""), sound: !!b.sound, first: fileFor(b.first), last: fileFor(b.last) }) };
      await setMeta(saved, m); ctx.queue({ kind: "create", cid: m.id, what: kind, model: r.model, project: "create", panel: "create:" + m.id, ok: okFrom(req) }); return json(res, m);
    }
  } catch (e) { return json(res, { error: e.message }, e.status || 400); }
  return json(res, { error: "not found" }, 404);
}
