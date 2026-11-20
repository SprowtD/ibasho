// How much a request may send (19 Nov 2026 audit item 10: every JSON route used to buffer any size, and a clip upload held
// about 1.2 GB in memory). Every route reads its body through one of these, with a limit that fits what it carries.
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";

export const KB = 1024, MB = 1024 * 1024;
const tooBig = (limit) => Object.assign(new Error(`That is too large to send (the most is ${limit >= MB ? Math.round(limit / MB) + " MB" : Math.round(limit / KB) + " KB"}).`), { code: 413, status: 413 });

/** Before a "too large" answer: let the rest of what is being sent arrive and throw it away (up to 64 MB, 15 seconds). An answer
 * sent while the sender is still sending closes the connection under it, and the browser then shows "failed to fetch" instead of the
 * reason (it also made the size tests fail about one run in five). Something far larger is answered at once and cut off. */
const DRAIN = 64 * MB;
async function drain(req, len) {
  if (!(len <= DRAIN)) { req.resume(); return; }
  let timer; const late = new Promise((ok) => { timer = setTimeout(ok, 15000); });
  await Promise.race([late, (async () => { try { for await (const c of req) void c; } catch { /* the sender gave up */ } })()]);
  clearTimeout(timer);
}
/** The body as bytes, up to `limit`; more than that is refused (413) and never kept in memory. */
export async function readBody(req, limit = 1 * MB) {
  const len = +req.headers["content-length"]; if (len > limit) { await drain(req, len); throw tooBig(limit); }
  const chunks = []; let size = 0, over = false;
  for await (const c of req) { // a body with no stated length: counted as it arrives
    size += c.length;
    if (size > limit) { over = true; chunks.length = 0; if (size > limit + DRAIN) { req.destroy(); throw tooBig(limit); } continue; }
    chunks.push(c);
  }
  if (over) throw tooBig(limit);
  return Buffer.concat(chunks);
}
/** The body as JSON (an empty body is {}); text that is not JSON is a 400. */
export async function readJson(req, limit = 1 * MB) {
  const t = (await readBody(req, limit)).toString("utf8");
  if (!t.trim()) return {};
  try { return JSON.parse(t); } catch { throw Object.assign(new Error("That is not readable JSON."), { code: 400, status: 400 }); }
}
/** Was this failure the sender's mistake? True when the error is a JSON one and what was sent (kept on the request by the
 * servers' `body`) is itself not JSON. A good body with a JSON error means a saved file on this computer is damaged: that is ours. */
export function sentBadJson(req, e) {
  if (!(e instanceof SyntaxError) || req.method === "GET" || req.sentBody === undefined) return false;
  try { JSON.parse(String(req.sentBody)); return false; } catch { return true; }
}
/** The body streamed into a file (never all in memory), up to `limit`; a request that is too large leaves no file behind. */
export async function bodyToFile(req, file, limit) {
  const len = +req.headers["content-length"]; if (len > limit) { await drain(req, len); throw tooBig(limit); }
  const out = createWriteStream(file, { flags: "wx" }); let size = 0;
  try {
    await new Promise((ok, bad) => {
      out.on("error", bad); req.on("error", bad); req.on("aborted", () => bad(new Error("The upload stopped before it finished.")));
      req.on("data", (c) => { size += c.length; if (size > limit) { req.unpipe(out); req.destroy(); bad(tooBig(limit)); } });
      out.on("finish", ok); req.pipe(out);
    });
  } catch (e) { out.destroy(); await rm(file, { force: true }); throw e; }
  return size;
}
