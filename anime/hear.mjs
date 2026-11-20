// "Write down what is said": the words of a recorded voice or a video clip, with times, from a Whisper installed on THIS computer.
// Free and local only: no service is called and nothing is paid. When no local Whisper is found, the answer says what to install.
//   GET  /api/anime/hear?id=<scene>&f=<audio/x | clips/x>[&to=en]   what was written down before (kept beside the scene), and whether this computer can listen
//   POST /api/anime/hear?id=<scene>&f=...[&to=en][&lang=ja]         listen now (one file at a time; a minute of sound takes about a minute on a plain processor)
// Where the listener comes from, first found:
//   STUDIO_WHISPER         a program of your own: it is run as  <program> <file> [--to en] [--lang xx] [--model m]  and prints the JSON below
//   a Python that has faster-whisper or openai-whisper: STUDIO_WHISPER_PYTHON, python3, /usr/bin/python3, then ~/.venvs/*/bin/python; it runs anime/tools/hear.py
// The JSON: { language, model, engine, segments: [{ start, end, text }] }   (seconds from the start of the file)
import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { inside } from "../page-editor/paths.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OK_FILE = /^audio\/[\w][\w.-]*\.(mp3|wav|m4a|aac|ogg|flac|webm|mp4)$|^clips\/[\w][\w.-]*\.(mp4|m4a)$/;
const HOW = "No speech-to-text is installed on this computer. It is free and runs here, with nothing sent anywhere: in a terminal, run  pip install faster-whisper  (or set STUDIO_WHISPER_PYTHON to a Python that has it), then press this again. The first listen downloads the model once.";
const json = (res, data, code = 200) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(data)); return true; };
const run = (cmd, args, ms) => new Promise((ok, bad) => execFile(cmd, args, { timeout: ms, maxBuffer: 1 << 24 }, (e, out, err) => (e ? bad(Object.assign(new Error(String(err || e.message).trim().split("\n").pop().slice(0, 300)), { code: e.code })) : ok(String(out)))));

let found = { at: 0, v: null };
/** How this computer can listen: { cmd, args } to put before the file, or null. Looked for at most once a minute. */
export async function listener() {
  if (Date.now() - found.at < 60000) return found.v;
  let v = null;
  const own = (process.env.STUDIO_WHISPER || "").trim();
  if (own) v = existsSync(own) ? { cmd: own, args: [], name: "your own program" } : null;
  else {
    const pys = [process.env.STUDIO_WHISPER_PYTHON, "python3", "/usr/bin/python3"].filter(Boolean);
    try { for (const d of (await readdir(join(homedir(), ".venvs"))).sort()) pys.push(join(homedir(), ".venvs", d, "bin", "python")); } catch { /* no such folder */ }
    for (const py of pys) {
      try { const got = (await run(py, ["-c", "import importlib.util as u\nprint('faster-whisper' if u.find_spec('faster_whisper') else 'whisper' if u.find_spec('whisper') else '')"], 20000)).trim();
        if (got) { v = { cmd: py, args: [join(HERE, "tools", "hear.py")], name: got }; break; } } catch { /* not this one */ }
    }
  }
  found = { at: Date.now(), v }; return v;
}
/** Sane segments only: times in order, text of a sane length. */
export function tidy(doc) {
  const segs = [];
  for (const s of (doc && Array.isArray(doc.segments) ? doc.segments : []).slice(0, 2000)) {
    if (!s || typeof s !== "object") continue;
    const a = +s.start, b = +s.end, text = String(s.text == null ? "" : s.text).replace(/\s+/g, " ").trim().slice(0, 600);
    if (!text || !isFinite(a) || !isFinite(b) || a < 0 || b < a) continue;
    segs.push({ start: Math.round(a * 100) / 100, end: Math.round(b * 100) / 100, text });
  }
  return { language: String((doc && doc.language) || "").slice(0, 12), model: String((doc && doc.model) || "").slice(0, 40), engine: String((doc && doc.engine) || "").slice(0, 40), segments: segs };
}
let chain = Promise.resolve(); // one listen at a time: it uses every core
const oneAtATime = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };

export async function hear(req, res, url, dir) {
  const f = String(url.searchParams.get("f") || ""), to = url.searchParams.get("to") === "en" ? "en" : "", lang = /^[a-z]{2,3}$/.test(url.searchParams.get("lang") || "") ? url.searchParams.get("lang") : "";
  if (!OK_FILE.test(f)) return json(res, { error: "Only a sound or a video clip of this scene can be listened to." }, 400);
  const file = inside(dir, f); let st; try { if (!file) throw 0; st = await stat(file); if (!st.isFile()) throw 0; } catch { return json(res, { error: "That file is not in this scene." }, 404); }
  const keep = join(dir, "hear", basename(f).replace(/[^\w.-]/g, "_") + (to ? ".en" : "") + ".json");
  const kept = async () => { try { const j = JSON.parse(await readFile(keep, "utf8")); return j && j.of === st.mtimeMs && j.size === st.size ? j : null; } catch { return null; } }; // a file that was replaced is listened to afresh
  if (req.method === "GET") { const l = await listener(), j = await kept(); return json(res, { can: !!l, engine: l ? l.name : "", how: l ? "" : HOW, heard: j ? j.heard : null, at: j ? j.at : "" }); }
  if (req.method !== "POST") return json(res, { error: "GET or POST." }, 405);
  const l = await listener(); if (!l) return json(res, { error: HOW, install: true }, 409);
  try {
    const heard = await oneAtATime(async () => {
      const args = [...l.args, file, ...(to ? ["--to", "en"] : []), ...(lang ? ["--lang", lang] : []), ...(process.env.STUDIO_WHISPER_MODEL ? ["--model", process.env.STUDIO_WHISPER_MODEL.replace(/[^\w.-]/g, "")] : [])];
      const out = await run(l.cmd, args, 30 * 60000);
      let doc; try { doc = JSON.parse(out.trim().split("\n").pop()); } catch { throw new Error("the listener's answer could not be read"); }
      return tidy(doc);
    });
    const at = new Date().toISOString();
    await mkdir(dirname(keep), { recursive: true }); await writeFile(keep, JSON.stringify({ of: st.mtimeMs, size: st.size, at, to, heard }, null, 1));
    return json(res, { can: true, engine: l.name, heard, at });
  } catch (e) { found.at = 0; return json(res, { error: "It could not be written down: " + String(e.message || e).slice(0, 300) }, 500); }
}
