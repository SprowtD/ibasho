// Connections: the services a person links to Ibasho (sign-ins and API keys), and which one each kind of job goes to.
// Keys live only on this computer, in <saved>/connections.json (owner-only file), and are never sent back to the browser.
// Research behind the list and the prices: docs/providers/RESEARCH_2026-11-18.md
import { readFile, writeFile, chmod, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
import { PERMISSION_CONFIRM, licenceStatus } from "../core/gpu_route.mjs";
import { readBody as readLimited, KB } from "./limits.mjs";
const readBody256 = (req) => readLimited(req, 256 * KB);
/** Open models whose licence needs the maker's permission somewhere, with their state for this person (never a block: a warning and a link). */
async function licences(saved) {
  const p = await permissions(saved), on = await permittedModels(saved);
  const models = JSON.parse(await readFile(join(HERE, "..", "core/models/open_models.json"), "utf8")).models.filter((m) => (m.excluded || []).length);
  return { region: p.region || "", wording: PERMISSION_CONFIRM, regions: [["US", "United States"], ["UK", "United Kingdom"], ["EU", "European Union"], ["KR", "South Korea"], ["OTHER", "Somewhere else"]],
    models: models.map((m) => ({ id: m.id, name: m.name, kind: m.kind, licence: m.licence, excluded: m.excluded, link: m.licence_request || null, on: on.includes(m.id), at: ((p.models || {})[m.id] || {}).at || null, ...licenceStatus(m, p.region, on) })) };
}

/** The kinds of job the studio can send out. Order = order on the screen. */
export const KINDS = [
  { id: "text", name: "Writing and the assistant" },
  { id: "picture", name: "Pictures" },
  { id: "edit", name: "Picture editing" },
  { id: "video", name: "Video" },
  { id: "voice", name: "Voices" },
  { id: "voicechange", name: "Voice change" },
  { id: "sfx", name: "Sound effects" },
  { id: "music", name: "Music" },
  { id: "stt", name: "Speech to text" },
  { id: "upscale", name: "Upscaling" },
];

/**
 * Every service. how: "cli" = signed in with its own program on this computer; "key" = an API key pasted here;
 * "url" = an address (a ComfyUI of your own). kinds = what it can do for Ibasho. ready = Ibasho can test it today.
 * soon = listed so people can see it is coming, not yet connectable.
 */
export const PROVIDERS = [
  { id: "codex", name: "Codex", by: "OpenAI (your ChatGPT plan)", how: "cli", kinds: ["text", "picture"], ready: true,
    help: "Sign in once on this computer: open a terminal and run  codex login", link: "https://github.com/openai/codex" },
  { id: "openrouter", name: "OpenRouter", by: "one key for hundreds of models", how: "key", kinds: ["text", "picture", "video"], ready: true,
    help: "Make a key at openrouter.ai, under Keys. Models cost what their makers charge; OpenRouter adds 5.5% when you top up by card.", link: "https://openrouter.ai/settings/keys" },
  { id: "google", name: "Google AI Studio", by: "Gemini, Nano Banana, Gemini voices, Lyria", how: "key", kinds: ["text", "picture", "edit", "video", "voice", "music", "stt"], ready: true,
    help: "Make a key at aistudio.google.com (Get API key). This is billed apart from a Gemini app subscription, which other apps cannot use. Gemini voices have a free tier.", link: "https://aistudio.google.com/apikey" },
  { id: "elevenlabs", name: "ElevenLabs", by: "voices, cloning, sound effects, music", how: "key", kinds: ["voice", "voicechange", "sfx", "music", "stt"], ready: true,
    help: "Make a key at elevenlabs.io under Developers, API keys.", link: "https://elevenlabs.io/app/developers/api-keys" },
  { id: "anthropic", name: "Claude", by: "Anthropic API", how: "key", kinds: ["text"], ready: true,
    help: "Make a key at console.anthropic.com. (Signing in with a Claude subscription is not offered yet.)", link: "https://console.anthropic.com/settings/keys" },
  { id: "fal", name: "fal", by: "almost every image and video model", how: "key", kinds: ["picture", "edit", "video", "voice", "sfx", "music", "upscale"], ready: true,
    help: "Make a key at fal.ai under Keys.", link: "https://fal.ai/dashboard/keys" },
  { id: "replicate", name: "Replicate", by: "open models of every kind", how: "key", kinds: ["picture", "edit", "video", "voice", "music", "upscale"], ready: true,
    help: "Make a token at replicate.com under API tokens.", link: "https://replicate.com/account/api-tokens" },
  { id: "runway", name: "Runway", by: "Gen-4.5, plus Seedance, Kling and more", how: "key", kinds: ["picture", "video", "upscale"], ready: true,
    help: "Make a key in the Runway developer portal.", link: "https://dev.runwayml.com/" },
  { id: "runpod", name: "RunPod", by: "rent a GPU by the second for open models", how: "key", kinds: ["video", "upscale"], ready: true,
    help: "Make a key at runpod.io under Settings, API keys.", link: "https://www.runpod.io/console/user/settings" },
  { id: "minimax", name: "MiniMax", by: "H3 video with sound, MiniMax voices", how: "key", kinds: ["video", "voice", "music"], ready: false,
    help: "Make a key on the MiniMax platform. Ibasho keeps it, but cannot test it yet.", link: "https://platform.minimax.io/" },
  { id: "comfyui", name: "ComfyUI", by: "your own ComfyUI, on this computer or another", how: "url", kinds: ["picture", "edit", "video", "upscale"], ready: true,
    help: "The address ComfyUI shows when it starts, for example http://127.0.0.1:8188", link: "https://www.comfy.org/" },
  { id: "higgsfield", name: "Higgsfield", by: "sign in and use your Higgsfield credits", how: "cli", kinds: ["picture", "video", "voice", "upscale"], soon: true,
    help: "Coming: sign in with your Higgsfield account.", link: "https://higgsfield.ai/" },
  { id: "claude-signin", name: "Claude subscription", by: "sign in with your Claude plan", how: "cli", kinds: ["text"], soon: true,
    help: "Coming once Anthropic's terms for apps like this are checked. A Claude API key works now.", link: "https://claude.com/" },
];

/** Who does each kind of job best for the money, cheapest first (see the research file). The first CONNECTED one is used. */
const ORDER = {
  text: ["codex", "anthropic", "openrouter", "google"],
  picture: ["codex", "google", "openrouter", "fal", "replicate", "runway", "comfyui", "higgsfield"],
  edit: ["google", "fal", "replicate", "comfyui"],
  video: ["openrouter", "minimax", "fal", "runway", "runpod", "higgsfield", "replicate", "comfyui", "google"],
  voice: ["google", "elevenlabs", "minimax", "fal", "replicate"],
  voicechange: ["elevenlabs"],
  sfx: ["elevenlabs", "fal"],
  music: ["google", "elevenlabs", "minimax", "fal", "replicate"],
  stt: ["google", "elevenlabs"],
  upscale: ["fal", "replicate", "runway", "comfyui", "runpod", "higgsfield"],
};

const STORE = (saved) => join(saved, "connections.json");
async function load(saved) { try { return JSON.parse(await readFile(STORE(saved), "utf8")); } catch { return {}; } }
async function save(saved, data) {
  await mkdir(saved, { recursive: true });
  await writeFile(STORE(saved), JSON.stringify(data, null, 2), { mode: 0o600 });
  await chmod(STORE(saved), 0o600).catch(() => {});
}

/** What the browser may see about a stored secret: never the secret itself. */
const hint = (k) => (k ? "…" + String(k).slice(-4) : "");

const run = (cmd, args, ms = 15000) => new Promise((ok) => execFile(cmd, args, { timeout: ms }, (e, out, err) => ok({ code: e ? (e.code ?? 1) : 0, out: String(out || "") + String(err || "") })));

async function get(url, headers, ms = 12000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { headers, signal: ctl.signal }); let j = null; try { j = await r.json(); } catch { /* not JSON */ } return { ok: r.ok, status: r.status, j }; }
  // never e.message: for a key with a line break in it, fetch's error quotes the whole header, key and all (audit, 19 Nov 2026)
  catch (e) { const c = (e && e.cause && e.cause.code) || ""; return { ok: false, status: 0, j: null, err: e.name === "AbortError" ? "no answer in time" : /header/i.test(String(e && e.message)) ? "the key has a character no key has, such as a space or a line break" : /^E[A-Z]+$/.test(c) ? c : "network" }; }
  finally { clearTimeout(t); }
}
const bad = (r) => (r.status === 401 || r.status === 403 ? "The service refused this key." : r.status === 0 ? "Could not reach the service (" + (r.err || "network") + ")." : "The service answered " + r.status + ".");

/** Test one connection. Costs nothing: each test only reads the account. Returns { ok, msg }. */
async function test(id, secret) {
  if (id === "codex") {
    const r = await run("codex", ["login", "status"]);
    if (r.code === 0 && /logged in/i.test(r.out)) return { ok: true, msg: r.out.trim().split("\n").pop() };
    return { ok: false, msg: /ENOENT|not found/i.test(r.out) ? "Codex is not installed on this computer." : "Not signed in. Run  codex login  in a terminal on this computer." };
  }
  if (!secret) return { ok: false, msg: "Nothing saved yet." };
  if (id === "openrouter") {
    const r = await get("https://openrouter.ai/api/v1/key", { authorization: "Bearer " + secret });
    if (!r.ok) return { ok: false, msg: bad(r) };
    const d = (r.j && r.j.data) || {}, left = d.limit_remaining ?? (d.limit != null ? d.limit - (d.usage || 0) : null);
    return { ok: true, msg: "Key works." + (left != null ? ` $${Number(left).toFixed(2)} left on this key.` : "") + (d.usage != null ? ` $${Number(d.usage).toFixed(2)} used.` : "") };
  }
  if (id === "google") {
    const r = await get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { "x-goog-api-key": secret });
    if (!r.ok) return { ok: false, msg: r.status === 400 ? "The service refused this key." : bad(r) };
    const n = ((r.j && r.j.models) || []).length;
    return { ok: true, msg: `Key works. ${n} models available to it.` };
  }
  if (id === "elevenlabs") {
    const r = await get("https://api.elevenlabs.io/v1/user/subscription", { "xi-api-key": secret });
    if (!r.ok) return { ok: false, msg: bad(r) };
    const s = r.j || {}; const left = s.character_limit != null ? s.character_limit - (s.character_count || 0) : null;
    return { ok: true, msg: "Key works." + (s.tier ? ` Plan: ${s.tier}.` : "") + (left != null ? ` ${left.toLocaleString("en-US")} characters left this month.` : "") };
  }
  if (id === "anthropic") {
    const r = await get("https://api.anthropic.com/v1/models?limit=1", { "x-api-key": secret, "anthropic-version": "2023-06-01" });
    return r.ok ? { ok: true, msg: "Key works." } : { ok: false, msg: bad(r) };
  }
  if (id === "fal") {
    const r = await get("https://api.fal.ai/v1/models?limit=1", { authorization: "Key " + secret });
    return r.ok ? { ok: true, msg: "Key works." } : { ok: false, msg: bad(r) };
  }
  if (id === "replicate") {
    const r = await get("https://api.replicate.com/v1/account", { authorization: "Bearer " + secret });
    return r.ok ? { ok: true, msg: "Token works." + (r.j && r.j.username ? ` Account: ${r.j.username}.` : "") } : { ok: false, msg: bad(r) };
  }
  if (id === "runway") {
    const r = await get("https://api.dev.runwayml.com/v1/organization", { authorization: "Bearer " + secret, "x-runway-version": "2024-11-06" });
    return r.ok ? { ok: true, msg: "Key works." + (r.j && r.j.creditBalance != null ? ` ${r.j.creditBalance} credits.` : "") } : { ok: false, msg: bad(r) };
  }
  if (id === "runpod") {
    const r = await get("https://rest.runpod.io/v1/pods", { authorization: "Bearer " + secret });
    return r.ok ? { ok: true, msg: `Key works. ${Array.isArray(r.j) ? r.j.length : 0} pods on the account.` } : { ok: false, msg: bad(r) };
  }
  if (id === "comfyui") { // only says whether a ComfyUI answered: nothing about other machines or ports (it was a way to scan the home network)
    let u; try { u = new URL(secret); } catch { return { ok: false, msg: "That is not an address. It looks like http://127.0.0.1:8188" }; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return { ok: false, msg: "Use an http:// or https:// address, like http://127.0.0.1:8188" };
    const r = await get(new URL("/system_stats", u).href, {}, 6000), dev = r.ok && r.j && Array.isArray(r.j.devices) ? r.j.devices[0] : null;
    if (!dev || !r.j.system) return { ok: false, msg: "No ComfyUI answered at that address. Is it running?" };
    return { ok: true, msg: "ComfyUI answered." + (dev.name ? ` It runs on ${String(dev.name).slice(0, 80)}.` : "") };
  }
  return { ok: null, msg: "Saved. Ibasho cannot test this service yet." };
}

/** The screen's whole state: every service, its state and hint, and who each kind of job would go to now. */
async function state(saved) {
  const store = await load(saved);
  const list = PROVIDERS.map((p) => {
    const s = store[p.id] || {};
    const connected = p.how === "cli" ? !!(s.last && s.last.ok) : !!s.secret;
    return { id: p.id, name: p.name, by: p.by, how: p.how, kinds: p.kinds, ready: !!p.ready, soon: !!p.soon, help: p.help, link: p.link,
      connected, hint: p.how === "url" ? s.secret || "" : hint(s.secret), last: s.last || null };
  });
  const on = new Set(list.filter((p) => p.connected && !p.soon && (!p.last || p.last.ok !== false)).map((p) => p.id));
  const routes = KINDS.map((k) => ({ ...k, use: (ORDER[k.id] || []).find((id) => on.has(id)) || null, options: (ORDER[k.id] || []).filter((id) => on.has(id)) }));
  return { providers: list, kinds: routes };
}

/** For the rest of the server: the stored secret for a service (never sent to a browser), and who should do a kind of job. */
export async function secretFor(saved, id) { return ((await load(saved))[id] || {}).secret || null; }
// "I have permission" for a model whose licence needs its maker's permission where the person is (core/gpu_route.mjs licenceStatus).
// Never a block: the person confirms, and the confirmation (wording, date and time) is kept on their own computer.
const PERMS = (saved) => join(saved, "permissions.json");
export async function permissions(saved) { try { return JSON.parse(await readFile(PERMS(saved), "utf8")); } catch { return { region: "", models: {} }; } }
/** The ids of models the person has confirmed permission for (for licenceStatus). */
export async function permittedModels(saved) { const p = await permissions(saved); return Object.keys(p.models || {}).filter((id) => p.models[id].on); }

export async function routeFor(saved, kind) { return (await state(saved)).kinds.find((k) => k.id === kind)?.use || null; }

const readBody = async (req) => { const b = await readBody256(req); try { return JSON.parse(b.toString("utf8") || "{}"); } catch { return {}; } }; // settings: small
const json = (res, data, code = 200) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(data)); };

/** Routes: GET /api/connections; POST /api/connections {id, secret} saves and tests; POST /api/connections/test {id}; DELETE /api/connections?id= */
export async function connections(req, res, url, saved) {
  if (url.pathname === "/connections" || url.pathname === "/connections/") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(await readFile(join(HERE, "connections.html")));
    return true;
  }
  if (url.pathname === "/api/licences") { json(res, await licences(saved)); return true; }
  if (url.pathname === "/api/permissions") { // GET: { region, models: { id: { on, confirmed, at } } }; POST { region } or { model, on, confirmed }
    const p = await permissions(saved);
    if (req.method === "POST") {
      const b = await readBody(req);
      if (typeof b.region === "string") p.region = b.region.slice(0, 8).toUpperCase();
      if (b.model) {
        const id = String(b.model).slice(0, 80);
        if (b.on && !b.confirmed) { json(res, { error: "Confirm the permission wording first." }, 400); return true; }
        p.models = p.models || {};
        p.models[id] = b.on ? { on: true, confirmed: String(b.confirmed).slice(0, 400), at: new Date().toISOString() } : { on: false, at: new Date().toISOString() };
      }
      await mkdir(saved, { recursive: true }); await writeFile(PERMS(saved), JSON.stringify(p, null, 2));
    }
    json(res, p); return true;
  }
  if (!url.pathname.startsWith("/api/connections")) return false;
  const known = (id) => PROVIDERS.find((p) => p.id === id && !p.soon);
  if (url.pathname === "/api/connections" && req.method === "GET") { json(res, await state(saved)); return true; }
  if (url.pathname === "/api/connections" && req.method === "POST") {
    const { id, secret } = await readBody(req), p = known(id);
    if (!p) { json(res, { error: "unknown service" }, 400); return true; }
    const store = await load(saved), s = id === "comfyui" ? String(secret || "").trim() : String(secret || "").replace(/\s+/g, ""); // a key has no spaces or line breaks: ones pasted along are dropped
    if (p.how !== "cli" && (!s || s.length > 500)) { json(res, { error: "Paste the key first." }, 400); return true; }
    const last = { ...(await test(id, p.how === "cli" ? null : s)), at: new Date().toISOString() };
    store[id] = { ...(p.how === "cli" ? {} : { secret: s }), last, saved: new Date().toISOString() };
    await save(saved, store);
    json(res, await state(saved)); return true;
  }
  if (url.pathname === "/api/connections/test" && req.method === "POST") {
    const { id } = await readBody(req), p = known(id);
    if (!p) { json(res, { error: "unknown service" }, 400); return true; }
    const store = await load(saved), s = store[id] || {};
    s.last = { ...(await test(id, s.secret)), at: new Date().toISOString() };
    store[id] = s; await save(saved, store);
    json(res, await state(saved)); return true;
  }
  if (url.pathname === "/api/connections" && req.method === "DELETE") {
    const id = url.searchParams.get("id"), store = await load(saved);
    delete store[id]; await save(saved, store);
    json(res, await state(saved)); return true;
  }
  json(res, { error: "not found" }, 404); return true;
}
