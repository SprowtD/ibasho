// Smaller audit item: the pod's control server (anime/tools/pod_render/srv.py), run here on a scratch folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO } from "./harness.mjs";

test("srv.py: a long token, files only under the workspace, plain job names", async () => {
  const ws = mkdtempSync(join(process.env.TEST_TMP || tmpdir(), "pod-")), port = 20000 + Math.floor(Math.random() * 20000), T = "t".repeat(32);
  assert.notEqual(spawnSync("python3", [join(REPO, "anime/tools/pod_render/srv.py")], { env: { ...process.env, CTRL_TOKEN: "short", WORKSPACE: ws } }).status, 0, "a short token is refused");
  const c = spawn("python3", [join(REPO, "anime/tools/pod_render/srv.py")], { env: { ...process.env, CTRL_TOKEN: T, WORKSPACE: ws, PORT: String(port) }, stdio: "ignore" });
  try {
    const b = `http://127.0.0.1:${port}`; for (let i = 0; i < 50; i++) { try { await fetch(b, { headers: { "x-token": T } }); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    writeFileSync(join(ws, "a.txt"), "hello");
    assert.equal((await fetch(`${b}/get?path=a.txt`, { headers: { "x-token": "x".repeat(32) } })).status, 403);
    assert.equal(await (await fetch(`${b}/get?path=${ws}/a.txt`, { headers: { "x-token": T } })).text(), "hello");
    assert.equal((await fetch(`${b}/get?path=/etc/hostname`, { headers: { "x-token": T } })).status, 404);
    assert.equal((await fetch(`${b}/get?path=../../etc/hostname`, { headers: { "x-token": T } })).status, 404);
    assert.equal((await fetch(`${b}/put?path=/tmp/x`, { method: "POST", headers: { "x-token": T }, body: "x" })).status, 400);
    assert.equal((await fetch(`${b}/run?name=../../x`, { method: "POST", headers: { "x-token": T }, body: "true" })).status, 400);
    assert.equal((await fetch(`${b}/run?name=ok-1`, { method: "POST", headers: { "x-token": T }, body: "echo hi" })).status, 200);
  } finally { c.kill(); }
});
