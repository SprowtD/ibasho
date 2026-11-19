// StageFlow scores for the moving grey animatic: where StageFlow is, a check of a score against its plan,
// re-timing a score after shot lengths change (no AI), and rendering it to mp4.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url)), APP = resolve(HERE, "..", "..");
/** StageFlow install: STUDIO_STAGEFLOW, else a folder called stageflow next to the app. */
export const STAGEFLOW = process.env.STUDIO_STAGEFLOW || resolve(APP, "..", "stageflow");
/** A finished score the Previs agent can read as a worked example, when there is one: STUDIO_STAGEFLOW_EXAMPLE, else stageflow-example.yaml next to the app. */
export const EXAMPLE = [process.env.STUDIO_STAGEFLOW_EXAMPLE, resolve(APP, "..", "stageflow-example.yaml")].find((f) => f && existsSync(f)) || "";
const YAML = () => createRequire(join(STAGEFLOW, "package.json"))("yaml");
export const parseScore = (text) => YAML().parse(text);
export const dumpScore = (obj) => YAML().stringify(obj, { lineWidth: 0 });

const r2 = (x) => Math.round(x * 100) / 100;
/** Shot timings of a plan: [{ id, start, end }]. */
export function timings(plan) {
  let t = 0; return (plan.shots || []).map((s) => { const d = Math.max(0.1, +s.duration || 0), o = { id: s.shot_id, start: r2(t), end: r2(t + d) }; t += d; return o; });
}
/** Does the score still match the plan's shots and lengths? */
export function inStep(score, plan) {
  const a = timings(plan), b = (score.shots || []).map((s) => ({ id: s.id, start: r2(+s.start), end: r2(+s.end) }));
  return a.length === b.length && a.every((x, i) => x.id === b[i].id && Math.abs(x.start - b[i].start) < 0.02 && Math.abs(x.end - b[i].end) < 0.02);
}
/** Same shots in the same order, only lengths changed: move every shot and blocking cue to the new times. Returns null if the shots differ. */
export function retime(score, plan) {
  const now = timings(plan), old = score.shots || [];
  if (now.length !== old.length || now.some((x, i) => x.id !== old[i].id)) return null;
  const map = new Map(old.map((s, i) => [s.id, { o0: +s.start, o1: +s.end, n0: now[i].start, n1: now[i].end }]));
  const at = (t) => { // a time inside an old shot -> the same fraction of the new shot
    for (const m of map.values()) if (t >= m.o0 - 1e-6 && t <= m.o1 + 1e-6) { const k = m.o1 > m.o0 ? (t - m.o0) / (m.o1 - m.o0) : 0; return r2(m.n0 + k * (m.n1 - m.n0)); }
    return t <= 0 ? 0 : now[now.length - 1].end;
  };
  for (const s of old) { const m = map.get(s.id); s.start = m.n0; s.end = m.n1; }
  for (const b of score.blocking || []) { const s = at(+b.start), e = at(+b.end); b.start = s; b.end = Math.max(e, r2(s + 0.1)); }
  score.duration = now[now.length - 1].end;
  return score;
}
// ---- camera geometry: where a shot's camera sits, and what it would be inside ----
const rad = (d) => (d * Math.PI) / 180;
/** Entity positions at time t: start position, then every blocking cue that has finished (or is running, interpolated). */
function positionsAt(score, t) {
  const pos = new Map((score.entities || []).map((e) => [e.id, { p: (e.position || [0, 0, 0]).map(Number), size: (e.size || [0.4, 1.7, 0.3]).map(Number), kind: e.kind, style: e.style, label: e.label || e.id }]));
  for (const b of (score.blocking || []).slice().sort((a, c) => +a.start - +c.start)) {
    const e = pos.get(b.entity); if (!e || !Array.isArray(b.position) || +b.start > t) continue;
    const k = +b.end <= t ? 1 : (t - +b.start) / Math.max(0.01, +b.end - +b.start);
    e.p = e.p.map((v, i) => v + (Number(b.position[i]) - v) * k);
  }
  return pos;
}
function aim(target, pos) { // a camera target: a point, an entity id (its chest), or a list of entities (their middle)
  if (Array.isArray(target) && target.length === 3 && target.every((v) => typeof v === "number")) return target;
  const ids = Array.isArray(target) ? target : [target], pts = ids.map((id) => pos.get(id)).filter(Boolean).map((e) => [e.p[0], e.p[1] + e.size[1] * 0.8, e.p[2]]);
  if (!pts.length) return null;
  return [0, 1, 2].map((i) => pts.reduce((a, q) => a + q[i], 0) / pts.length);
}
/** Camera positions of a shot at its start and end (StageFlow: yaw 0 = from +Z, +90 = from +X; positive pitch = above, looking down). */
export function cameraPoints(cam, pos) {
  const out = [], rig = cam.rig && Array.isArray(cam.rig.position) ? cam.rig.position.map(Number) : null;
  if (rig) return [rig, rig]; // a tripod: the camera stands there and turns
  for (const end of [false, true]) {
    const tg = aim(end && cam.target_end ? cam.target_end : cam.from && cam.maneuver === "dolly" && !end ? cam.from : cam.target, pos) || aim(cam.target, pos);
    if (!tg) continue;
    const pick = (k) => { const v = cam[k + (end ? "_end" : "_start")]; return v != null ? +v : cam[k] != null ? +cam[k] : null; };
    const d = pick("distance"), pitch = pick("pitch") || 0, yaw = pick("yaw") || 0;
    if (d == null) continue;
    out.push([tg[0] + d * Math.cos(rad(pitch)) * Math.sin(rad(yaw)), tg[1] + d * Math.sin(rad(pitch)), tg[2] + d * Math.cos(rad(pitch)) * Math.cos(rad(yaw))]);
  }
  return out;
}
/** What a point is inside: a solid prop box or a character's body (with a head allowance). skip = entity ids to ignore. */
function insideOf(pt, pos, skip) {
  for (const [id, e] of pos) {
    if (skip && skip.has(id)) continue;
    if (e.style === "wireframe" || e.style === "glass") continue;
    const [x, y, z] = e.p, [w, h, dpt] = e.size, pad = e.kind === "character" ? 0.12 : 0.02;
    const r = e.kind === "character" ? Math.max(w, dpt) / 2 + pad : null;
    if (e.kind === "character") { const dx = pt[0] - x, dz = pt[2] - z; if (Math.hypot(dx, dz) < r && pt[1] > y - pad && pt[1] < y + h + pad) return e.label; }
    else if (Math.abs(pt[0] - x) < w / 2 + pad && Math.abs(pt[2] - z) < dpt / 2 + pad && pt[1] > y - pad && pt[1] < y + h + pad) return e.label;
  }
  return null;
}
const idsAt = (pt, pos) => new Set([...pos].filter(([, e]) => { const [x, y, z] = e.p, [w, h, d] = e.size; return Math.abs(pt[0] - x) < w / 2 + 0.3 && Math.abs(pt[2] - z) < d / 2 + 0.3 && pt[1] > y - 0.3 && pt[1] < y + h + 0.3; }).map(([id]) => id));
/** Someone or something solid on the line from the camera to what it frames (the first 80% of the way). */
function blocker(cam, tg, pos, targets) {
  const skip = new Set([...targets, ...idsAt(cam, pos)]);
  for (let k = 0.06; k <= 0.8; k += 0.02) { const q = [0, 1, 2].map((i) => cam[i] + (tg[i] - cam[i]) * k), hit = insideOf(q, pos, skip); if (hit) return hit; }
  return null;
}

/** Check a score against its plan. errors stop the render. */
export function checkScore(score, plan) {
  const errors = [], warnings = [];
  if (!score || typeof score !== "object") return { errors: ["the score is not readable"], warnings };
  const now = timings(plan), shots = score.shots || [];
  if (!Array.isArray(score.entities) || !score.entities.length) errors.push("no entities (set, props and characters)");
  const ids = new Set((score.entities || []).map((e) => e.id));
  if (shots.length !== now.length) errors.push(`the score has ${shots.length} shots; the plan has ${now.length}`);
  now.forEach((x, i) => {
    const s = shots[i]; if (!s) return;
    if (s.id !== x.id) errors.push(`shot ${i + 1} is "${s.id}"; the plan has ${x.id} there`);
    if (Math.abs(+s.start - x.start) > 0.02 || Math.abs(+s.end - x.end) > 0.02) errors.push(`${x.id}: runs ${s.start} to ${s.end} s; the plan needs ${x.start} to ${x.end} s`);
    const c = s.stage_camera; if (!c) { errors.push(`${x.id}: no stage_camera`); return; }
    for (const k of ["target", "from"]) { const v = c[k]; if (typeof v === "string" && !ids.has(v)) errors.push(`${x.id}: camera ${k} "${v}" is not an entity`); if (Array.isArray(v) && v.some((e) => typeof e === "string" && !ids.has(e))) errors.push(`${x.id}: camera ${k} names an entity that does not exist`); }
    if (!c.lens) warnings.push(`${x.id}: no lens`);
    const framing = String((((plan.shots || [])[i] || {}).camera || {}).framing || "") + " " + String(s.note || "");
    const pov = /\bpov\b|point of view|eyes of/i.test(framing), ots = /over[- ]the[- ]shoulder|\bots\b|foreground|past (his|her|their)|through/i.test(framing);
    for (const [k, t] of [["start", x.start + 0.01], ["end", x.end - 0.01]]) { // a camera inside a wall, prop or person sees only that
      const pos = positionsAt(score, t), pts = cameraPoints(c, pos), pt = pts[k === "start" ? 0 : pts.length - 1];
      if (!pt) continue;
      const hit = insideOf(pt, pos, pov ? new Set([...pos].filter(([, e]) => e.kind === "character").map(([id]) => id)) : null);
      if (hit) { errors.push(`${x.id}: at its ${k} the camera is inside ${hit} (at ${pt.map((v) => v.toFixed(2)).join(", ")}); move it out (distance, yaw or pitch)`); break; }
      const tg = aim(c.target, pos); if (!tg) continue;
      const targets = new Set(Array.isArray(c.target) && typeof c.target[0] === "string" ? c.target : typeof c.target === "string" ? [c.target] : [...idsAt(tg, pos)]);
      const b = blocker(pt, tg, pos, targets);
      if (b) { (ots ? warnings : errors).push(`${x.id}: at its ${k} ${b} stands between the camera and what it frames${ots ? " (fine if this is the foreground shoulder)" : "; move the camera or the person, or call it an over-the-shoulder in the note"}`); break; }
    }
  });
  for (const b of score.blocking || []) {
    if (!ids.has(b.entity)) errors.push(`blocking ${b.id}: entity "${b.entity}" does not exist`);
    if (!(+b.end > +b.start)) errors.push(`blocking ${b.id}: end must be after start`);
    const bid = String(b.id || ""), x = now.filter((t) => bid.endsWith("-" + t.id) || new RegExp("-" + t.id.replace(/[^\w]/g, "\\$&") + "-\\d+$").test(bid)).sort((a, c) => c.id.length - a.id.length)[0], sid = x && x.id;
    if (!x) warnings.push(`blocking ${b.id}: its id does not end in a shot id (<entity>-<shot_id>)`);
    else if (+b.start < x.start - 0.02 || +b.end > x.end + 0.02) errors.push(`blocking ${b.id}: ${b.start} to ${b.end} s is outside shot ${sid} (${x.start} to ${x.end} s)`);
  }
  const chars = (score.entities || []).filter((e) => e.kind === "character");
  if (!chars.length) warnings.push("no characters");
  for (const e of chars) { const h = Array.isArray(e.size) ? +e.size[1] : 0; if (h && (h < 0.5 || h > 2.4)) warnings.push(`${e.id}: height ${h} m looks wrong`); }
  if (Math.abs((+score.duration || 0) - (now.length ? now[now.length - 1].end : 0)) > 0.05) errors.push(`root duration ${score.duration} should be ${now.length ? now[now.length - 1].end : 0}`);
  return { errors, warnings };
}
/** Render a score: view "pov" (the shot cameras) or "top" (from above, with the cameras shown). Resolves with the output path. */
export function render(scoreFile, out, { view = "pov", fps = 12, shot = null, minutes = 30 } = {}, onProgress) {
  const args = ["run", "record", "--", scoreFile, "--res", "720p", "--fps", String(fps), "--theme", "warm", "-o", out];
  if (view === "pov") args.push("--camera", "stage-pov", "--labels", "off"); else args.push("--camera", "scripted", "--preset", "top", "--hud", "--labels", "camera-only");
  if (shot) args.push("--shot", shot);
  return new Promise((ok, bad) => {
    const c = spawn("npm", args, { cwd: STAGEFLOW, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const eat = (d) => { tail = (tail + d).slice(-3000); const m = String(d).match(/(\d+)% \| Frame (\d+)\/(\d+)/g); if (m && onProgress) { const z = m[m.length - 1].match(/(\d+)%/); onProgress(+z[1]); } };
    c.stdout.on("data", eat); c.stderr.on("data", eat);
    const t = setTimeout(() => { c.kill(); bad(new Error(`the render took longer than ${minutes} minutes`)); }, minutes * 60000);
    c.on("error", (e) => { clearTimeout(t); bad(new Error("StageFlow could not start: " + e.message)); });
    c.on("exit", (code) => { clearTimeout(t); code === 0 && existsSync(out) ? ok(out) : bad(new Error("the render stopped: " + tail.replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").filter(Boolean).slice(-2).join(" "))); });
  });
}
export async function readScore(f) { return parseScore(await readFile(f, "utf8")); }
export async function writeScore(f, s) { await writeFile(f, dumpScore(s)); }
