// Work you can see (TODO 35a): every job in the studio's queue with a label, how long it usually takes, and a short history.
// saved/work.json  = the last 80 finished jobs (done or failed), so a reload or a restart still shows what landed.
// saved/work-times.json = how long each kind of job took on each model (last 12), so "usually" learns from this computer.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { choiceFor } from "./models.mjs";

const HIST = (saved) => join(saved, "work.json"), TIMES = (saved) => join(saved, "work-times.json");
const readJson = async (f, d) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return d; } };
// Usual seconds before this computer has its own figures.
const DEFAULT = { picture: { codex: 180, openrouter: 45 }, video: { openrouter: 150 }, storyboard: { codex: 420, openrouter: 90 }, check: { codex: 600 }, sheet: { codex: 150, openrouter: 45 }, look: { codex: 60 }, tone: { codex: 45 } };

/** What kind of work a queue job is: picture | video | storyboard | check | sheet | look. */
export function typeOf(j) {
  if (j.kind === "create") return j.what === "video" ? "video" : "picture";
  if (j.kind === "anime") return j.what === "video" ? "video" : j.what === "sheet" ? "sheet" : j.what === "check" ? "check" : "picture";
  if (j.kind === "paneler") return "storyboard";
  if (j.kind === "check") return "check";
  if (j.kind === "sheet") return "sheet";
  if (j.kind === "look") return "look";
  if (j.kind === "tone") return "tone";
  return "picture";
}
/** A short plain label and where to look at the result. */
export function describe(j) {
  const t = typeOf(j), m = j.model && j.model !== "codex" ? String(j.model).split("/").pop() : j.model === "codex" ? "Codex" : "";
  let label, link;
  if (j.kind === "create") { label = `Create · ${t === "video" ? "a video" : "a picture"}`; link = "/create"; }
  else if (j.kind === "anime") { const sc = j.scene || ""; label = `${sc} · ${t === "video" ? "video of shot " + j.shot : t === "sheet" ? "sheet: " + j.name : t === "check" ? "asset check" : "still for shot " + j.shot}`; link = sc.startsWith("look~") ? "/anime/#/" : `/anime/#/scene/${encodeURIComponent(sc)}`; }
  else if (j.kind === "paneler") { label = `${j.project} · storyboard`; link = "/#home"; }
  else if (j.kind === "check") { label = `${j.project} · asset check`; link = "/"; }
  else if (j.kind === "sheet") { label = `${j.project} · sheet: ${j.name}`; link = "/"; }
  else if (j.kind === "tone") { label = `${j.project} · the Toner${j.only ? ", one panel" : ""}`; link = "/"; }
  else if (j.kind === "breakout") { label = `${j.project} · break-out${j.name ? ": " + j.name : ""}`; link = "/"; }
  else if (j.kind === "look") { label = `${j.project} · looking for faces`; link = "/"; }
  else { label = `${j.project} · panel ${j.panel}`; link = "/"; }
  return { type: t, label, link, model: m };
}
const keyOf = (type, model) => `${type}:${model || "codex"}`;
/** Seconds this job usually takes: this computer's own average for the kind and model, else a default. */
export async function expectFor(saved, j) {
  const type = typeOf(j); let model = j.model || (j.pick && j.pick.model) || "";
  if (!model) { try { const c = await choiceFor(saved, type === "storyboard" ? "text" : type === "video" ? "video" : "picture"); model = c ? c.model : "codex"; } catch { model = "codex"; } }
  const t = (await readJson(TIMES(saved), {}))[keyOf(type, model)];
  if (Array.isArray(t) && t.length) return Math.round(t.reduce((a, b) => a + b, 0) / t.length);
  const d = DEFAULT[type] || { codex: 180 }; return model === "codex" ? d.codex || 180 : d.openrouter || 90;
}
/** A finished job: remember how long it took (when it worked) and put it in the history. */
export async function recordDone(saved, j) {
  try {
    await mkdir(saved, { recursive: true });
    const d = describe(j), took = Math.round((j.took || 0) / 1000);
    if (j.status === "done" && took > 2 && !j.resumed) { const T = await readJson(TIMES(saved), {}), k = keyOf(d.type, j.model || "codex"); T[k] = (T[k] || []).concat(took).slice(-12); await writeFile(TIMES(saved), JSON.stringify(T)); }
    const H = await readJson(HIST(saved), []);
    H.push({ key: j.project + "/" + j.panel, ...d, status: j.status, msg: j.msg || "", took, cost: j.cost ?? null, at: new Date().toISOString() });
    await writeFile(HIST(saved), JSON.stringify(H.slice(-80)));
  } catch { /* history is a record, never a gate */ }
}
/** A job that will not run (stopped by a restart before it was sent): shown in the history so it is never silently lost. */
export async function recordDropped(saved, j, msg) { await recordDone(saved, { ...j, status: "failed", msg, took: 0 }); }

/** GET /api/work -> { now, running: [...], waiting: [...], recent: [...] } (running and waiting from the live queue). */
export async function work(req, res, url, saved, jobs) {
  if (url.pathname !== "/api/work") return false;
  const now = Date.now(), live = [...jobs.values()].filter((j) => j.status === "drawing" || j.status === "waiting");
  const view = async (j) => ({ key: j.project + "/" + j.panel, ...describe(j), status: j.status === "drawing" ? "working" : "waiting", msg: j.msg || "", started: j.at || null, queued: j.queued || null, expect: j.expect || (await expectFor(saved, j)) });
  const out = { now, running: [], waiting: [], recent: (await readJson(HIST(saved), [])).filter((h) => now - Date.parse(h.at) < 36 * 3600e3).reverse().slice(0, 25) };
  for (const j of live) (j.status === "drawing" ? out.running : out.waiting).push(await view(j));
  res.statusCode = 200; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(out)); return true;
}
