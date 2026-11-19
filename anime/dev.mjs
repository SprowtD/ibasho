// Test server for the anime side alone: node anime/dev.mjs [port]  (default 5191)
// Serves the anime screens + the manga editor's project files read-only. Use STUDIO_ANIME=<scratch dir> so tests never touch real scenes.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { anime } from "./server.mjs";
const EDITOR = join(dirname(fileURLToPath(import.meta.url)), "..", "page-editor"), PORT = +process.argv[2] || 5191;
const TYPES = { ".jpg": "image/jpeg", ".png": "image/png", ".json": "application/json", ".js": "text/javascript" };
createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (await anime(req, res, url)) return;
  const p = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, "");
  if (!/^(samples|projects|anime-scenes)\//.test(p) || p.includes("..")) { res.statusCode = 404; return res.end(); }
  try { res.setHeader("content-type", TYPES[extname(p)] || "application/octet-stream"); res.end(await readFile(join(EDITOR, p))); } catch { res.statusCode = 404; res.end(); }
}).listen(PORT, () => console.log("anime test server http://localhost:" + PORT));
