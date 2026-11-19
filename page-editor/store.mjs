// Saving whole documents safely (19 Nov 2026 audit item 11). Plans, bibles, the art list, saved chapters and sound lists were
// read, changed and written whole with no lock and no temp file: two finishing jobs, or a job and a browser tab, could erase each
// other's work, and a crash mid-write left half a file.
//   lockDoc(file, fn)      one change at a time per document (keyed by its real path: a chapter's bible.json is its book's)
//   writeAtomic(file, s)   write a temp file beside it, then rename over: the old or the new file, never half of one
//   updateJson(file, fn)   lock, read, let fn change the object (return false to leave it), write atomically
// These hold inside this server; tools run by the server (Python, Codex) are started from inside the same locks where they write.
import { readFile, writeFile, rename, rm, realpath } from "node:fs/promises";
import { resolve } from "node:path";

const chains = new Map();
const keyOf = async (f) => { try { return await realpath(f); } catch { return resolve(f); } };

export async function lockDoc(file, fn) {
  const key = await keyOf(file), prev = chains.get(key) || Promise.resolve();
  const run = prev.then(fn, fn), tail = run.then(() => {}, () => {});
  chains.set(key, tail); tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}
export async function writeAtomic(file, data) {
  const real = await keyOf(file), tmp = real + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2, 8);
  await writeFile(tmp, data);
  try { await rename(tmp, real); } catch (e) { await rm(tmp, { force: true }); throw e; }
}
export const writeJson = (file, obj) => writeAtomic(file, JSON.stringify(obj, null, 1));
/** dflt: what to start from when the file is not there (a function); without it a missing or unreadable file is an error. */
export function updateJson(file, fn, dflt) {
  return lockDoc(file, async () => {
    let j;
    try { j = JSON.parse(await readFile(file, "utf8")); }
    catch (e) { if (dflt && e.code === "ENOENT") j = dflt(); else throw Object.assign(new Error(`${file.split("/").slice(-2).join("/")} could not be read: ${e.code || "not readable JSON"}`), { status: 500 }); }
    if ((await fn(j)) === false) return j;
    await writeJson(file, j); return j;
  });
}
