// Live GPU prices (TODO 25), from the clouds that publish them without an account:
//   RunPod: its public GraphQL gpuTypes (community and secure price an hour; stock needs a key, so it is not shown)
//   Vast.ai: the public offers list (the cheapest rentable machine with that GPU, and how many there are)
// Asked at most every 10 minutes; the starting prices in core/models/gpu_clouds.json stay the fallback.
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
// Our GPU names -> how each cloud names them (with the memory, where one name covers two sizes).
const RUNPOD = { "RTX 4090": [/^RTX 4090$/], "RTX 5090": [/^RTX 5090$/], "L40S": [/^L40S$/], "A100 80GB": [/^A100 (PCIe|SXM)$/, 80], "H100": [/^H100 (PCIe|SXM|NVL)$/], "H200": [/^H200( SXM)?$/], "B200": [/^B200$/] };
const VAST = { "RTX 4090": ["RTX 4090"], "RTX 5090": ["RTX 5090"], "L40S": ["L40S"], "A100 80GB": ["A100 SXM4", "A100 PCIE"], "H100": ["H100 SXM", "H100 PCIE", "H100 NVL"], "H200": ["H200"], "B200": ["B200"] };
let cache = { at: 0, v: null };

async function getJson(url, init, ms = 15000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { ...init, signal: ctl.signal }); return r.ok ? await r.json() : null; } catch { return null; } finally { clearTimeout(t); }
}
async function runpod() {
  const j = await getJson("https://api.runpod.io/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ gpuTypes { displayName memoryInGb communityPrice securePrice } }" }) });
  const types = (j && j.data && j.data.gpuTypes) || []; if (!types.length) return null;
  const out = {};
  for (const [g, [re, mem]] of Object.entries(RUNPOD)) {
    const hits = types.filter((t) => re.test(t.displayName) && (!mem || t.memoryInGb >= mem));
    const comm = hits.map((t) => t.communityPrice).filter((p) => p > 0), sec = hits.map((t) => t.securePrice).filter((p) => p > 0);
    if (comm.length || sec.length) out[g] = { usd: Math.min(...(comm.length ? comm : sec)), secure: sec.length ? Math.min(...sec) : null };
  }
  return out;
}
async function vast() {
  const out = {};
  await Promise.all(Object.entries(VAST).map(async ([g, names]) => {
    const q = { rentable: { eq: true }, gpu_name: { in: names }, num_gpus: { eq: 1 }, order: [["dph_total", "asc"]], limit: 40, ...(g === "A100 80GB" ? { gpu_ram: { gte: 70000 } } : {}) };
    const j = await getJson("https://console.vast.ai/api/v0/bundles/?q=" + encodeURIComponent(JSON.stringify(q)));
    const offers = (j && (j.offers || j)) || []; if (!Array.isArray(offers) || !offers.length) return;
    out[g] = { usd: Math.round(offers[0].dph_total * 1000) / 1000, offers: offers.length, where: offers[0].geolocation || "" };
  }));
  return Object.keys(out).length ? out : null;
}
/** { at, gpus, clouds: [{ id, name, prices: { gpu: usd }, live: { gpu: {...} } | null }] }: the catalogue with live prices laid over it. */
let asking = null; // one round of price questions at a time; "fresh" is honoured at most once a minute
export function gpuPrices(fresh = false) {
  if (cache.v && Date.now() - cache.at < (fresh ? 60000 : 600000)) return Promise.resolve(cache.v);
  if (!asking) asking = askPrices().finally(() => { asking = null; });
  return asking;
}
async function askPrices() {
  const cat = JSON.parse(await readFile(join(APP, "core/models/gpu_clouds.json"), "utf8")), [rp, va] = await Promise.all([runpod(), vast()]);
  const live = { runpod: rp, vast: va };
  const clouds = cat.clouds.map((c) => { const L = live[c.id] || null, prices = { ...(c.prices || {}) };
    if (L) for (const [g, x] of Object.entries(L)) prices[g] = x.usd;
    return { id: c.id, name: c.name, billing: c.billing, prices, live: L, startup_s: c.startup_s, note: c.note || "" }; });
  cache = { at: Date.now(), v: { at: new Date().toISOString(), checked: cat.checked, gpus: Array.isArray(cat.gpus) ? cat.gpus.map((g) => (typeof g === "string" ? g : g.name)) : Object.keys(cat.gpus), clouds } };
  return cache.v;
}
/** GET /api/gpu-prices[?fresh=1] */
export async function gpuPricesRoute(req, res, url) {
  if (url.pathname !== "/api/gpu-prices") return false;
  const v = await gpuPrices(!!url.searchParams.get("fresh"));
  res.statusCode = 200; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(v)); return true;
}
