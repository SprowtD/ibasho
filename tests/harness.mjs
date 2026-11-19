// Test harness: every test runs Ibasho on a COPY of this checkout, in a scratch folder, on its own port.
// Nothing touches page-editor/saved/, projects/, series/ of the real app, or the app on port 5178.
// No paid model can be reached: OPENROUTER_BASE points at a closed port, and `codex` is a fake on PATH (tests/fake-codex.mjs).
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });

/** A copy of the app in a scratch folder. Returns { app, scratch, saved, series, anime, looks }. */
export function copyApp() {
  const scratch = mkdtempSync(join(process.env.TEST_TMP || tmpdir(), "ibasho-test-"));
  const app = join(scratch, "app");
  execFileSync("rsync", ["-a", "--exclude", ".git", "--exclude", "landing", "--exclude", "node_modules", "--exclude", "page-editor/saved", "--exclude", "page-editor/projects", "--exclude", "page-editor/series",
    "--exclude", "page-editor/anime-scenes", "--exclude", "page-editor/anime-looks", REPO + "/", app + "/"]);
  const dirs = { saved: join(scratch, "saved"), series: join(app, "page-editor", "series"), anime: join(scratch, "anime-scenes"), looks: join(scratch, "anime-looks"), bin: join(scratch, "bin"), log: join(scratch, "codex-log.jsonl") };
  for (const d of [dirs.saved, dirs.series, dirs.anime, dirs.looks, dirs.bin, join(app, "page-editor", "projects")]) mkdirSync(d, { recursive: true });
  const fake = join(dirs.bin, "codex"); writeFileSync(fake, `#!/bin/sh\nexec node ${JSON.stringify(join(REPO, "tests", "fake-codex.mjs"))} "$@"\n`); chmodSync(fake, 0o755);
  return { scratch, app, ...dirs };
}

/** Start the copy's server. opts.env adds to the environment. Returns { base, port, stop(), out() , ...copy }. */
export async function startApp(copy = copyApp(), opts = {}) {
  const port = await freePort();
  const env = { ...process.env, PATH: copy.bin + ":" + process.env.PATH, STUDIO_SAVED: copy.saved, STUDIO_SERIES: copy.series, STUDIO_ANIME: copy.anime, STUDIO_LOOKS: copy.looks,
    OPENROUTER_BASE: "http://127.0.0.1:9", FAKE_CODEX_LOG: copy.log, ...(opts.env || {}) };
  let out = "";
  const child = spawn(process.execPath, [join(copy.app, "page-editor", "server.mjs"), String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(base + "/api/ping"); if (r.ok) break; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 100)); }
  return { ...copy, base, port, child, out: () => out,
    stop: async () => { child.kill(); await new Promise((r) => child.once("exit", r)); if (!process.env.KEEP_TEST) rmSync(copy.scratch, { recursive: true, force: true }); } };
}

/** Every call the fake codex received: [{ argv, cwd }]. */
export const codexCalls = (copy) => (existsSync(copy.log) ? readFileSync(copy.log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

/** A small project made by hand in the copy (no Paneler): one page, one panel. */
export function makeProject(copy, id = "test-ch01", extra = {}) {
  const dir = join(copy.app, "page-editor", "projects", id);
  mkdirSync(join(dir, "art", "panels"), { recursive: true });
  const spec = { project: "Test", chapter: 1, kind: "storyboard", pages: [{ id: "p1", number: 1, layout: { rows: [{ panels: [{ id: "a1", board: { who: [], lines: [] } }] }] } }], ...(extra.spec || {}) };
  writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
  writeFileSync(join(dir, "project.json"), JSON.stringify({ name: "Test", chapter: 1, ...(extra.meta || {}) }));
  writeFileSync(join(dir, "bible.json"), JSON.stringify({ project: "Test", style: "ink", cast: {}, ...(extra.bible || {}) }));
  writeFileSync(join(dir, "script.md"), "A test script that is long enough to count as one.\n");
  return dir;
}

/** A scene made by hand in the copy. */
export function makeScene(copy, id = "scene-one", plan = {}) {
  const dir = join(copy.anime, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "scene.json"), JSON.stringify({ id, title: "Scene one", project: "", made: new Date().toISOString(), look: "look-one" }));
  writeFileSync(join(dir, "SCENE_PLAN.json"), JSON.stringify({ scene_id: id, shots: [{ shot_id: "S01", duration: 3, action: "She waves." }], dialogue: [], ...plan }));
  mkdirSync(join(copy.looks, "look-one"), { recursive: true });
  writeFileSync(join(copy.looks, "look-one", "look.json"), JSON.stringify({ id: "look-one", name: "Look one", text: "", refs: [], cast: {} }));
  return dir;
}
