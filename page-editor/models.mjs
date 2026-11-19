// The model picker's lists, and which model each kind of job uses (the person's choice, kept on this computer).
// Lists come from the catalogues in core/models/ (tools/openrouter_catalog.py makes openrouter.json) plus each connected service.
// Kinds with a picker so far: text (writing: the storyboard), picture (manga panels, anime stills), video (an anime shot from its still).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { secretFor } from "./connections.mjs";
import { createRequire } from "node:module";
const Price = createRequire(import.meta.url)("./price.js"); // the same estimate the screens show

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PICK_KINDS = { text: "Writing", picture: "Pictures", video: "Video" };
const CODEX = { // Codex has no list of its own: it uses whatever the person's ChatGPT plan gives it
  text: { service: "codex", model: "codex", name: "Codex", by: "your ChatGPT plan", price: "Included in your plan", est: 0, suggested: "no extra cost", why: "Reads and writes the project's files itself; slower, but costs nothing extra." },
  picture: { service: "codex", model: "codex", name: "Codex image tool", by: "your ChatGPT plan", price: "Included in your plan", est: 0, suggested: "no extra cost", why: "The image tool in Codex. Also labels the faces and checks its own picture.", tags: ["references", "faces"] },
};
let catalogue = null;
import { execFile } from "node:child_process";
import { readBody as readLimited, KB } from "./limits.mjs";
const readBody256 = (req) => readLimited(req, 256 * KB);
/** Fetch the OpenRouter lists again (tools/openrouter_catalog.py: public lists, no key). Returns what changed, and any picked model that is gone. */
let refreshing = null, refreshedAt = 0, lastRefresh = null; // one fetch at a time, and not again within a minute (anyone could fire it in a loop)
export function refreshCatalogue(saved) {
  if (refreshing) return refreshing;
  if (lastRefresh && Date.now() - refreshedAt < 60000) return Promise.resolve(lastRefresh);
  refreshing = refreshNow(saved).then((r) => { lastRefresh = r; refreshedAt = Date.now(); return r; }).finally(() => { refreshing = null; });
  return refreshing;
}
async function refreshNow(saved) {
  const old = await orCatalogue().catch(() => null), ids = (c) => new Set(c ? [...c.chat, ...c.all_text_models, ...c.pictures, ...c.video].map((m) => m.id) : []);
  const before = ids(old);
  await new Promise((ok, no) => execFile("/usr/bin/python3", [join(APP, "tools/openrouter_catalog.py")], { timeout: 300000, maxBuffer: 1 << 24 }, (e, out, err) => (e ? no(new Error("Could not fetch the lists: " + String(err || e.message).trim().split("\n").pop())) : ok(out))));
  catalogue = null; const now = await orCatalogue(), after = ids(now);
  const gone = [...before].filter((x) => !after.has(x)), added = [...after].filter((x) => !before.has(x)), picked = await choices(saved);
  const lost = Object.entries(picked).filter(([, c]) => c && c.service === "openrouter" && !after.has(c.model)).map(([k, c]) => ({ kind: k, model: c.model, name: c.name }));
  return { fetched: now.fetched, added: added.length, gone, lost };
}
/** On start: refresh when the lists are more than a week old (quietly; the old lists stay if it fails). */
export async function refreshIfOld(saved) { try { const c = await orCatalogue(); if (Date.now() - Date.parse(c.fetched) > 7 * 864e5) { const r = await refreshCatalogue(saved); console.log(`Model lists refreshed: ${r.added} new, ${r.gone.length} gone`); } } catch (e) { console.log("Model lists not refreshed: " + e.message); } }
async function orCatalogue() { if (!catalogue) catalogue = JSON.parse(await readFile(join(APP, "core/models/openrouter.json"), "utf8")); return catalogue; }

const money = (v) => (v == null ? "" : v < 0.01 ? "$" + v.toFixed(4).replace(/0+$/, "") : "$" + v.toFixed(v < 1 ? 3 : 2).replace(/0$/, ""));
/** The resolution a shot video is made at: 720p when the model has it, else the smallest it has above that, else its biggest. */
export function videoRes(m) {
  const order = ["360p", "480p", "720p", "768p", "1080p", "1K", "2K", "4K"], have = (m.resolutions || []).slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return have.includes("720p") ? "720p" : have.find((r) => order.indexOf(r) > order.indexOf("720p")) || have[have.length - 1] || "";
}
/** Video models that take recordings as references (OpenRouter: "audio and video references are only honored by ... BytePlus Seedance generation 2 and newer"). */
export const audioRefs = (id) => /^bytedance\/seedance-2/.test(String(id));
/** The shortest length the model makes that covers the shot (shots are short; the clip is played from its start). */
export function videoLen(m, seconds) { const L = (m.lengths || []).slice().sort((a, b) => a - b).filter((x) => x > 0); return L.find((x) => x >= seconds) || L[L.length - 1] || Math.max(1, Math.ceil(seconds)); }

// A chapter storyboard is roughly 30,000 tokens read and 20,000 written: priced that way so people can compare in money, not tokens.
const board = (m) => `about ${money((m.in || 0) * 0.03 + (m.out || 0) * 0.02)} a storyboard`;
function orOptions(cat, kind) {
  const base = { service: "openrouter", by: "OpenRouter" };
  if (kind === "text") {
    const picks = cat.chat.map((m) => ({ ...base, model: m.id, name: m.name.replace(/^[^:]+:\s*/, ""), maker: m.name.split(":")[0], price: board(m), est: m.out, jobUsd: (m.in || 0) * 0.03 + (m.out || 0) * 0.02, suggested: m.suggested || "", why: m.why_suggested || m.why || "", tier: m.tier, tags: [m.reads_pictures ? "reads pictures" : "", m.context >= 400000 ? "very long scripts" : ""].filter(Boolean) }));
    const seen = new Set(picks.map((p) => p.model));
    const more = cat.all_text_models.filter((m) => !seen.has(m.id)).map((m) => ({ ...base, model: m.id, name: m.name.replace(/^[^:]+:\s*/, ""), maker: m.name.split(":")[0], price: m.in === 0 && m.out === 0 ? "Free (rate limited)" : board(m), est: m.out, more: true }));
    return picks.concat(more);
  }
  if (kind === "picture") return cat.pictures.map((m) => { const at = (q) => Price.picture(m, { quality: q, size: [1024, 1536], chars: 3000 }), mid = at("medium");
    const qs = (m.qualities || []).filter((q) => ["low", "medium", "high"].includes(q));
    return { ...base, model: m.id, name: m.name.replace(/^[^:]+:\s*/, ""), maker: m.name.split(":")[0],
    price: mid.usd != null ? `about ${Price.money(mid.usd)} a panel${qs.length ? " at medium quality" : ""}` : "price per picture not listed", est: mid.usd,
    qualities: m.qualities || [], qprices: qs.map((q) => `${Price.LABEL[q]} ${Price.money(at(q).usd)}`), pm: { id: m.id, prices: m.prices, input_prices: m.input_prices, qualities: m.qualities, about_per_picture: m.about_per_picture },
    suggested: m.suggested || "", why: m.why_suggested || "", refs: m.edits_pictures ? m.max_references || 1 : 0,
    tags: [qs.length ? "quality: " + qs.map((q) => `${Price.LABEL[q].toLowerCase()} ${Price.money(at(q).usd)}`).join(", ") : "", m.edits_pictures ? `up to ${m.max_references || 1} reference pictures` : "words only, no references", m.transparent ? "see-through background" : ""].filter(Boolean) }; });
  if (kind === "video") return cat.video.filter((m) => m.kind === "make" && (m.frames || []).includes("first_frame")).map((m) => {
    const res = videoRes(m), ps = (m.per_second || {})[res], len = videoLen(m, 3);
    return { ...base, model: m.id, name: m.name.replace(/^[^:]+:\s*/, ""), maker: m.name.split(":")[0], res, perSecond: ps,
      price: ps != null ? `${money(ps)} a second at ${res} (a ${len} s clip about ${money(ps * len)})` : "price not listed", est: ps,
      suggested: m.suggested || "", why: m.why_suggested || "", lengths: m.lengths, resolutions: m.resolutions || [], perSecondAll: m.per_second || {}, last: (m.frames || []).includes("last_frame"), sound: !!m.sound, voices: audioRefs(m.id),
      tags: [m.lengths && m.lengths.length ? `${Math.min(...m.lengths)} to ${Math.max(...m.lengths)} s` : "", audioRefs(m.id) ? "speaks in your characters' voices" : m.sound ? "makes its own voices" : "no sound", (m.frames || []).includes("last_frame") ? "first + last frame" : "first frame"].filter(Boolean) };
  });
  return [];
}

const STORE = (saved) => join(saved, "models.json");
async function choices(saved) { try { return JSON.parse(await readFile(STORE(saved), "utf8")); } catch { return {}; } }
async function connectedSet(saved) {
  let store = {}; try { store = JSON.parse(await readFile(join(saved, "connections.json"), "utf8")); } catch { /* nothing yet */ }
  const on = new Set(); if (!(store.codex && store.codex.last && store.codex.last.ok === false)) on.add("codex"); // Codex is the app's own route: assumed until a check says otherwise
  if (store.openrouter && store.openrouter.secret && !(store.openrouter.last && store.openrouter.last.ok === false)) on.add("openrouter");
  return on;
}

/** Every model for one kind of job, Suggested first, with the person's current choice. */
export async function modelList(saved, kind) {
  if (!PICK_KINDS[kind]) throw new Error("unknown kind of job");
  const on = await connectedSet(saved), cat = await orCatalogue();
  const opts = (CODEX[kind] ? [CODEX[kind]] : []).concat(orOptions(cat, kind)).map((o) => ({ ...o, connected: on.has(o.service) }));
  return { kind, name: PICK_KINDS[kind], choice: await choiceFor(saved, kind), options: opts, services: { codex: on.has("codex"), openrouter: on.has("openrouter") }, fetched: cat.fetched };
}
/** The model a kind of job uses now: the person's pick, else Codex, else the first suggested model of a connected service. */
export async function choiceFor(saved, kind) {
  const c = (await choices(saved))[kind], on = await connectedSet(saved);
  if (c && c.service && on.has(c.service)) return kind === "picture" && c.service === "openrouter" ? { ...c, quality: await qualityFor(c.model, c.quality) } : c;
  if (CODEX[kind] && on.has("codex")) return { service: "codex", model: "codex", name: CODEX[kind].name };
  if (on.has("openrouter")) { const o = orOptions(await orCatalogue(), kind).find((x) => x.suggested); if (o) return { service: "openrouter", model: o.model, name: o.name, ...(kind === "picture" ? { quality: await qualityFor(o.model) } : {}) }; }
  return c && c.service ? { ...c, off: true } : null;
}
/** The quality a picture model is asked for: the one picked if the model has it, else medium, else none (the model has no levels). */
export async function qualityFor(id, want) { const m = (await orCatalogue()).pictures.find((x) => x.id === id), q = (m && m.qualities) || [];
  return !q.length ? "" : q.includes(want) ? want : q.includes("medium") ? "medium" : q[0]; }
/** The estimate for one paid job, for the cap check and the log when OpenRouter sends no figure. */
export async function estimate(kind, id, o = {}) {
  const m = await orModel(kind, id); if (!m) return null;
  if (kind === "picture") return Price.picture(m, o).usd;
  if (kind === "video") { const p = (m.per_second || {})[o.resolution]; return p != null ? p * (o.seconds || 0) : null; }
  return (m.in || 0) * 0.03 + (m.out || 0) * 0.02; // a storyboard
}
/** One model's catalogue entry (OpenRouter), for the job runners: lengths, resolutions, prices. */
export async function orModel(kind, id) { const cat = await orCatalogue(); return (kind === "video" ? cat.video : kind === "picture" ? cat.pictures : cat.chat.concat(cat.all_text_models)).find((m) => m.id === id) || null; }
/** What a job needs to run on the chosen model: { service, model, key } (key only for a paid service). */
export async function routeModel(saved, kind, pick) {
  const c = pick && pick.service ? pick : await choiceFor(saved, kind);
  if (!c) throw new Error(`No ${PICK_KINDS[kind].toLowerCase()} model is connected. Connect one in Connections.`);
  if (c.service === "codex") return { service: "codex", model: "codex" };
  if (c.service === "openrouter") { const key = await secretFor(saved, "openrouter"); if (!key) throw new Error("OpenRouter is not connected. Paste its key in Connections.");
    return { service: "openrouter", model: c.model, key, quality: kind === "picture" ? await qualityFor(c.model, c.quality) : "" }; }
  throw new Error(`${c.service} cannot do this yet.`);
}

const readBody = async (req) => { const b = await readBody256(req); try { return JSON.parse(b.toString("utf8") || "{}"); } catch { return {}; } }; // settings: small
const json = (res, data, code = 200) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(data)); };

/** Routes: GET /api/models?kind=  (the list + current choice); GET /api/models (the choice for every kind); POST /api/models {kind, service, model, name}. */
export async function models(req, res, url, saved) {
  if (url.pathname === "/api/models/refresh" && req.method === "POST") { try { return json(res, await refreshCatalogue(saved)), true; } catch (e) { return json(res, { error: e.message }, 500), true; } }
  if (url.pathname !== "/api/models") return false;
  try {
    if (req.method === "POST") {
      const b = await readBody(req); if (!PICK_KINDS[b.kind]) return json(res, { error: "unknown kind of job" }, 400), true;
      const list = await modelList(saved, b.kind), o = list.options.find((x) => x.service === b.service && x.model === b.model);
      if (!o) return json(res, { error: "That model is not on the list." }, 400), true;
      const all = await choices(saved); all[b.kind] = { service: o.service, model: o.model, name: o.name, ...(b.kind === "picture" && o.service === "openrouter" ? { quality: await qualityFor(o.model, b.quality || (all[b.kind] || {}).quality) } : {}), at: new Date().toISOString() };
      await mkdir(saved, { recursive: true }); await writeFile(STORE(saved), JSON.stringify(all, null, 1));
      return json(res, await modelList(saved, b.kind)), true;
    }
    const kind = url.searchParams.get("kind");
    if (kind) return json(res, await modelList(saved, kind)), true;
    const out = {}; for (const k of Object.keys(PICK_KINDS)) out[k] = await choiceFor(saved, k);
    out.fetched = (await orCatalogue()).fetched;
    return json(res, out), true;
  } catch (e) { return json(res, { error: e.message }, 400), true; }
}
