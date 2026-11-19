// How much a request may send (19 Nov 2026 audit item 10: every JSON route used to buffer any size, and a clip upload held
// about 1.2 GB in memory). Every route reads its body through one of these, with a limit that fits what it carries.
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";

export const KB = 1024, MB = 1024 * 1024;
const tooBig = (limit) => Object.assign(new Error(`That is too large to send (the most is ${limit >= MB ? Math.round(limit / MB) + " MB" : Math.round(limit / KB) + " KB"}).`), { code: 413, status: 413 });

/** The body as bytes, up to `limit`; more than that stops the request (413). */
export async function readBody(req, limit = 1 * MB) {
  const len = +req.headers["content-length"]; if (len > limit) { req.resume(); throw tooBig(limit); }
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) { req.destroy(); throw tooBig(limit); } chunks.push(c); }
  return Buffer.concat(chunks);
}
/** The body as JSON (an empty body is {}); text that is not JSON is a 400. */
export async function readJson(req, limit = 1 * MB) {
  const t = (await readBody(req, limit)).toString("utf8");
  if (!t.trim()) return {};
  try { return JSON.parse(t); } catch { throw Object.assign(new Error("That is not readable JSON."), { code: 400, status: 400 }); }
}
/** The body streamed into a file (never all in memory), up to `limit`; a request that is too large leaves no file behind. */
export async function bodyToFile(req, file, limit) {
  const len = +req.headers["content-length"]; if (len > limit) { req.resume(); throw tooBig(limit); }
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
