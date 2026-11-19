// Paths that come from saved documents (a plan's still or clip, a sound clip, a bible's sheet, a spec's picture) are names inside one
// folder, never free paths: before 19 Nov 2026 a plan could point a still at any file on the disk and have it rendered or sent away.
import { realpathSync, existsSync } from "node:fs";
import { resolve, sep, isAbsolute } from "node:path";

const real = (p) => { try { return realpathSync(p); } catch { return null; } };
const within = (root, p) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

/**
 * The file `rel` inside `root`, or "" when it would leave it. `rel` must be relative with no "..", and when the file exists its real
 * place (links followed) must be inside `root` or inside one of `also` (the app's own links: a chapter's bank/ points at its book's bank).
 */
export function inside(root, rel, also = []) {
  rel = String(rel == null ? "" : rel);
  if (!rel || rel.includes("\0") || isAbsolute(rel) || /^[a-z]+:/i.test(rel) || rel.split(/[\\/]/).includes("..")) return "";
  const abs = resolve(root, rel); if (!within(resolve(root), abs)) return "";
  if (!existsSync(abs)) return abs; // not there (yet): nothing to follow
  const r = real(abs); if (!r) return "";
  for (const ok of [root, ...also]) { const rr = real(ok); if (rr && within(rr, r)) return abs; }
  return "";
}
/** A name that would reach into every object of the server if used as a key. */
export const reserved = (n) => n === "__proto__" || n === "constructor" || n === "prototype";
