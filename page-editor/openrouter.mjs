// OpenRouter: one key for writing, pictures and video (docs: openrouter.ai/docs; checked 18 Nov 2026).
//   writing  POST /api/v1/chat/completions
//   pictures POST /api/v1/images            -> data[].b64_json (reference pictures go as data URLs in input_references)
//   video    POST /api/v1/videos -> poll polling_url until completed -> GET /api/v1/videos/<id>/content?index=0
// Every call here spends the person's OpenRouter credit, so nothing in this file is ever called without a job they started.
// OPENROUTER_BASE points the calls at a stand-in server for tests (tools/test_openrouter.mjs).
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const BASE = () => (process.env.OPENROUTER_BASE || "https://openrouter.ai").replace(/\/$/, "");
const HEAD = (key) => ({ authorization: "Bearer " + key, "content-type": "application/json", "http-referer": "https://github.com/SprowtD/ibasho-studio", "x-title": "Ibasho" });
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg" };

/** A plain sentence for the person when OpenRouter says no. */
function why(status, j, text) {
  const m = (j && j.error && (j.error.message || j.error)) || (text || "").slice(0, 300);
  if (status === 401 || status === 403) return "OpenRouter refused the key. Check it in Connections.";
  if (status === 402) return "Not enough OpenRouter credit for this. Top up at openrouter.ai/credits.";
  if (status === 429) return "OpenRouter says too many requests right now. Try again in a minute.";
  if (status === 400) return "OpenRouter could not use these settings: " + m;
  return `OpenRouter answered ${status}${m ? ": " + m : ""}`;
}
async function call(key, path, body, ms = 300000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(BASE() + path, { method: body ? "POST" : "GET", headers: HEAD(key), body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
    if (!r.ok) throw new Error(why(r.status, j, text));
    return j;
  } catch (e) { throw e.name === "AbortError" ? new Error("OpenRouter did not answer in time.") : e.message === "fetch failed" ? new Error("Could not reach OpenRouter. Is the internet on for the computer running Ibasho?") : e; }
  finally { clearTimeout(t); }
}
/** What a model sent back is checked before it is saved (audit, 19 Nov 2026: it was saved whatever it was, at any size):
 * a picture must be a PNG, JPEG, WebP or GIF of at most 60 MB; a video an MP4/MOV or WebM of at most 600 MB. */
const LIMIT = { picture: 60 << 20, video: 600 << 20 };
function checked(bytes, kind) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), hex = b.subarray(0, 4).toString("hex"), at4 = b.subarray(4, 8).toString("latin1");
  if (b.length > LIMIT[kind]) throw new Error(`OpenRouter sent back a ${kind} larger than Ibasho keeps (${Math.round(b.length / 1048576)} MB).`);
  const ok = kind === "picture" ? hex === "89504e47" || hex.startsWith("ffd8ff") || (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") || b.subarray(0, 3).toString("latin1") === "GIF"
    : at4 === "ftyp" || hex === "1a45dfa3";
  if (!ok) throw new Error(`OpenRouter sent back something that is not a ${kind}.`);
  return b;
}
/** A file a model's answer links to: https only, read up to the limit. */
async function fetchCapped(url, kind, headers = {}) {
  if (!/^https:\/\//i.test(url) && !url.startsWith(BASE())) throw new Error(`OpenRouter's ${kind} link is not a secure address.`);
  const r = await fetch(url, { headers }); if (!r.ok) return { r, bytes: null };
  if (+r.headers.get("content-length") > LIMIT[kind]) throw new Error(`OpenRouter sent back a ${kind} larger than Ibasho keeps.`);
  const parts = []; let n = 0; for await (const c of r.body) { n += c.length; if (n > LIMIT[kind]) throw new Error(`OpenRouter sent back a ${kind} larger than Ibasho keeps.`); parts.push(c); }
  return { r, bytes: checked(Buffer.concat(parts), kind) };
}
const dataUrl = async (file) => `data:${MIME[extname(file).toLowerCase()] || "image/png"};base64,${(await readFile(file)).toString("base64")}`;

/** Writing: messages in, the answer's text out. Returns { text, cost }. */
export async function orText(key, model, messages, { json = false, maxTokens } = {}) {
  const j = await call(key, "/api/v1/chat/completions", { model, messages, ...(json ? { response_format: { type: "json_object" } } : {}), ...(maxTokens ? { max_tokens: maxTokens } : {}) }, 15 * 60000);
  const text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!text) throw new Error("The model sent back no words" + (j && j.choices && j.choices[0] && j.choices[0].finish_reason ? ` (it stopped: ${j.choices[0].finish_reason})` : "") + ".");
  return { text: Array.isArray(text) ? text.map((p) => p.text || "").join("") : String(text), cost: j.usage && j.usage.cost };
}

/** The closest aspect ratio OpenRouter knows for a width x height. */
const RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "1:2", "2:1", "21:9", "9:21"];
export function aspectOf(w, h) {
  const r = w / h; let best = "1:1", d = 9;
  for (const a of RATIOS) { const [x, y] = a.split(":").map(Number), e = Math.abs(Math.log(x / y / r)); if (e < d) { d = e; best = a; } }
  return best;
}

/** Pictures: a prompt and up to 16 reference pictures (files on this computer) in; the picture's bytes out. Returns { bytes, cost }. */
export async function orPicture(key, model, { prompt, size = [1024, 1024], refs = [], quality = "" }) {
  const input_references = [];
  for (const f of refs.slice(0, 16)) input_references.push({ type: "image_url", image_url: { url: await dataUrl(f) } });
  const j = await call(key, "/api/v1/images", { model, prompt, aspect_ratio: aspectOf(size[0], size[1]), n: 1, output_format: "png", ...(quality ? { quality } : {}), ...(input_references.length ? { input_references } : {}) }, 10 * 60000);
  const d = j && Array.isArray(j.data) && j.data[0];
  if (d && d.b64_json) return { bytes: checked(Buffer.from(d.b64_json, "base64"), "picture"), cost: j.usage && j.usage.cost };
  if (d && d.url) { const { bytes } = await fetchCapped(d.url, "picture"); if (bytes) return { bytes, cost: j.usage && j.usage.cost }; }
  throw new Error("OpenRouter sent back no picture (the model may have refused the prompt).");
}

/** Video: submit, wait, download. first/last = picture files for the first and last frame. onStatus(text) is told how it is going.
 * Returns { bytes, cost, id }. */
export async function orVideo(key, model, { prompt, duration, resolution, aspect = "16:9", first, last, sound = false, voices = [], onStatus = () => {}, onJob = () => {}, resumeId = "", pollMs = 5000, maxMinutes = 30 }) {
  if (resumeId) return waitForVideo(key, model, { id: resumeId, status: "in_progress", polling_url: `/api/v1/videos/${resumeId}` }, { onStatus, pollMs, maxMinutes }); // after a restart: the job is already paid for, only fetch it
  const frame_images = [], input_references = [];
  if (voices.length) { // reference mode: OpenRouter treats frame images + references as plain image-to-video, so the still goes as reference Image 1 instead
    if (first) input_references.push({ type: "image_url", image_url: { url: await dataUrl(first) } });
    for (const f of voices.slice(0, 3)) input_references.push({ type: "audio_url", audio_url: { url: await dataUrl(f) } });
    first = null;
  }
  if (first) frame_images.push({ type: "image_url", image_url: { url: await dataUrl(first) }, frame_type: "first_frame" });
  if (last) frame_images.push({ type: "image_url", image_url: { url: await dataUrl(last) }, frame_type: "last_frame" });
  const job = await call(key, "/api/v1/videos", { model, prompt, ...(duration ? { duration } : {}), ...(resolution ? { resolution } : {}), ...(aspect ? { aspect_ratio: aspect } : {}), generate_audio: !!sound, ...(frame_images.length ? { frame_images } : {}), ...(input_references.length ? { input_references } : {}) }, 120000);
  if (!job || !job.id) throw new Error("OpenRouter did not start the video.");
  try { await onJob(job.id); } catch { /* kept in memory anyway */ }
  onStatus("Sent to " + model.split("/").pop() + ". Waiting for the video…");
  return waitForVideo(key, model, job, { onStatus, pollMs, maxMinutes });
}
/** Poll an OpenRouter video job until it is done, then download it. */
async function waitForVideo(key, model, job, { onStatus, pollMs, maxMinutes }) {
  let st = job; const t0 = Date.now();
  while (st.status !== "completed") {
    if (["failed", "cancelled", "expired"].includes(st.status)) throw new Error("The video " + (st.status === "failed" ? "failed" : "was " + st.status) + (st.error ? ": " + (st.error.message || st.error) : "."));
    if (Date.now() - t0 > maxMinutes * 60000) throw new Error(`No video after ${maxMinutes} minutes. OpenRouter job ${job.id} may still finish: it can be fetched later.`);
    await new Promise((r) => setTimeout(r, pollMs));
    const u = new URL(st.polling_url || job.polling_url || `/api/v1/videos/${job.id}`, BASE());
    st = await call(key, u.pathname + u.search, null, 60000);
    onStatus(`Making the video (${st.status || "working"}, ${Math.round((Date.now() - t0) / 60000)} min)`);
  }
  const { r, bytes } = await fetchCapped(`${BASE()}/api/v1/videos/${encodeURIComponent(job.id)}/content?index=0`, "video", { authorization: "Bearer " + key });
  if (!bytes) throw new Error(why(r.status, null, await r.text()));
  return { bytes, cost: st.usage && st.usage.cost, id: job.id };
}
