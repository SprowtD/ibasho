// Spending: what each paid job cost, a monthly cap, and when to ask before spending (TODO item 4).
// Kept on the computer that runs Ibasho: saved/spend.jsonl (one line per paid job) and saved/spend-settings.json.
// The cost is OpenRouter's own figure when it sends one (usage.cost), else our estimate (marked estimated).
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { secretFor } from "./connections.mjs";
import { readBody as readLimited, KB } from "./limits.mjs";
const readBody256 = (req) => readLimited(req, 256 * KB);

const LOG = (saved) => join(saved, "spend.jsonl"), SET = (saved) => join(saved, "spend-settings.json");
const DEFAULTS = { askOver: 0.1, cap: null }; // ask before anything over 10 cents; no monthly cap until the person sets one
const month = (d = new Date()) => d.toISOString().slice(0, 7);

export async function spendSettings(saved) { try { return { ...DEFAULTS, ...JSON.parse(await readFile(SET(saved), "utf8")) }; } catch { return { ...DEFAULTS }; } }
async function entries(saved) {
  let t = ""; try { t = await readFile(LOG(saved), "utf8"); } catch { return []; }
  return t.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
/** Write down one paid job. e = { project, what, kind, service, model, quality, usd (real or null), est }. Never throws: the job already happened. */
export async function logSpend(saved, e) {
  if (e.est != null) { const i = held.findIndex((h) => Math.abs(h.est - e.est) < 1e-9); if (i >= 0) held.splice(i, 1); } // it is in the log now
  try {
    const usd = e.usd != null && isFinite(+e.usd) ? +e.usd : e.est != null && isFinite(+e.est) ? +e.est : null; if (usd == null) return;
    await mkdir(saved, { recursive: true });
    await appendFile(LOG(saved), JSON.stringify({ at: new Date().toISOString(), project: e.project || "", what: e.what || "", kind: e.kind || "", service: e.service || "openrouter", model: e.model || "", quality: e.quality || "", usd: Math.round(usd * 1e6) / 1e6, estimated: e.usd == null }) + "\n");
  } catch { /* the log is a record, not a gate */ }
}
export async function monthSpent(saved) { const m = month(); return (await entries(saved)).filter((x) => x.at.startsWith(m)).reduce((a, x) => a + x.usd, 0); }
/** What the caller says the person agreed to: the screens (and the MCP server) send it with a paid request once the person
 * has seen the price. { usd: the amount they saw, asked: true when they pressed yes to a question }. */
export function okFrom(req) { const usd = +req.headers["x-ibasho-ok"]; return { usd: isFinite(usd) && usd > 0 ? usd : 0, asked: req.headers["x-ibasho-asked"] === "1" }; }
const held = []; // estimates of jobs that have been let through and are not in the log yet, so two at once cannot both slip under the cap
const waiting = () => { const now = Date.now(); while (held.length && now - held[0].at > 30 * 60000) held.shift(); return held.reduce((a, h) => a + h.est, 0); };
/** Stop a paid job before it starts (returns a function that gives the held amount back, for a job that then fails unpaid): over the person's "ask me first" amount with no yes from them, or past the monthly cap.
 * est = this job's estimate (null when the model lists no price); ok = okFrom(req), kept with the job. */
let gate = Promise.resolve(); // one check at a time: two jobs asked for in the same moment used to both read the month's total before either was held, and both pass a cap only one fitted under
export function guardSpend(saved, est, label = "This", ok) { const r = gate.then(() => guardOne(saved, est, label, ok)); gate = r.catch(() => {}); return r; }
async function guardOne(saved, est, label, ok) {
  const s = await spendSettings(saved), ask = +s.askOver || 0;
  if (est != null && est > ask && !(ok && ok.asked && ok.usd >= est * 0.8))
    throw new Error(`${label} was not started: it costs about $${(+est).toFixed(2)}, which is over your "ask me first" amount ($${ask.toFixed(2)}), and nobody said yes to it. Start it from the screen, which asks first.`);
  if (s.cap != null) {
    if (est == null) throw new Error(`${label} was not started: this model lists no price, so your monthly cap ($${(+s.cap).toFixed(2)}) cannot be kept. Pick a model with a listed price.`);
    const spent = (await monthSpent(saved)) + waiting();
    if (spent >= s.cap || spent + est > s.cap) throw new Error(`${label} was not started: this month's spending cap is $${(+s.cap).toFixed(2)} and $${spent.toFixed(2)} is spent or under way (this would add about $${(+est).toFixed(2)}). Raise the cap under Connections > Spending.`);
  }
  if (!est) return () => {};
  const h = { est: +est, at: Date.now() }; held.push(h);
  return () => { const i = held.indexOf(h); if (i >= 0) held.splice(i, 1); }; // call it when the job failed before anything was spent
}

/** The first time: what this OpenRouter key spent this month before Ibasho kept a log, as one line. */
async function seedOnce(saved) {
  try { await readFile(LOG(saved)); return; } catch { /* no log yet */ }
  const key = await secretFor(saved, "openrouter"); if (!key) return;
  try { const r = await fetch((process.env.OPENROUTER_BASE || "https://openrouter.ai") + "/api/v1/key", { headers: { authorization: "Bearer " + key } }); if (!r.ok) return;
    const d = (await r.json()).data || {}, u = d.usage_monthly ?? d.usage; await mkdir(saved, { recursive: true });
    await writeFile(LOG(saved), u > 0 ? JSON.stringify({ at: new Date().toISOString(), project: "(before the log)", what: "OpenRouter spending this month before Ibasho kept a log", kind: "earlier", service: "openrouter", model: "", quality: "", usd: Math.round(u * 1e6) / 1e6, estimated: false }) + "\n" : "");
  } catch { /* try again next time */ }
}
let credit = { at: 0, v: null };
async function openRouterCredit(saved) { // what is left on the account; asked at most once a minute
  if (Date.now() - credit.at < 60000) return credit.v;
  const key = await secretFor(saved, "openrouter"); if (!key) { credit = { at: Date.now(), v: null }; return null; }
  let v = null;
  try {
    const r = await fetch((process.env.OPENROUTER_BASE || "https://openrouter.ai") + "/api/v1/credits", { headers: { authorization: "Bearer " + key } });
    if (r.ok) { const d = (await r.json()).data || {}; if (d.total_credits != null) v = { left: d.total_credits - (d.total_usage || 0) }; }
    if (!v) { const k = await fetch((process.env.OPENROUTER_BASE || "https://openrouter.ai") + "/api/v1/key", { headers: { authorization: "Bearer " + key } });
      if (k.ok) { const d = (await k.json()).data || {}; if (d.limit_remaining != null) v = { left: d.limit_remaining, keyLimit: true }; } }
  } catch { /* offline: no figure */ }
  credit = { at: Date.now(), v }; return v;
}

const readBody = async (req) => { const b = await readBody256(req); try { return JSON.parse(b.toString("utf8") || "{}"); } catch { return {}; } }; // settings: small
const json = (res, data, code = 200) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(data)); return true; };

/** GET /api/spend: settings, this month (total, by project, by kind), the last 40 jobs, OpenRouter credit. POST /api/spend { askOver, cap }. */
export async function spend(req, res, url, saved) {
  if (url.pathname !== "/api/spend") return false;
  if (req.method === "POST") {
    const b = await readBody(req), s = await spendSettings(saved), num = (v) => (v === null || v === "" ? null : isFinite(+v) && +v >= 0 ? Math.round(+v * 100) / 100 : undefined);
    if ("askOver" in b) { const v = num(b.askOver); if (v !== undefined) s.askOver = v ?? 0; }
    if ("cap" in b) { const v = num(b.cap); if (v !== undefined) s.cap = v; }
    await mkdir(saved, { recursive: true }); await writeFile(SET(saved), JSON.stringify(s, null, 1));
  }
  await seedOnce(saved);
  const all = await entries(saved), m = month(), now = all.filter((x) => x.at.startsWith(m)), sum = (xs) => Math.round(xs.reduce((a, x) => a + x.usd, 0) * 1e4) / 1e4;
  const group = (k) => Object.entries(now.reduce((o, x) => ((o[x[k] || "other"] = (o[x[k] || "other"] || 0) + x.usd), o), {})).map(([n, v]) => ({ name: n, usd: Math.round(v * 1e4) / 1e4 })).sort((a, b) => b.usd - a.usd);
  return json(res, { settings: await spendSettings(saved), month: m, total: sum(now), byProject: group("project"), byKind: group("kind"), recent: all.slice(-40).reverse(), allTime: sum(all), credit: await openRouterCredit(saved) });
}
