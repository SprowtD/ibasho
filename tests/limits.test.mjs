// Audit item 10: size limits wherever a body or an upload is read; a clip upload goes to a temp file; a zipped book cannot be a bomb.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { startApp, makeProject, makeScene } from "./harness.mjs";

const big = (n) => JSON.stringify({ x: "a".repeat(n) });
const claim = (base, path, bytes) => new Promise((ok, bad) => { // says it will send `bytes`, sends 1 KB, waits for the answer
  const u = new URL(base + path), r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST", headers: { "content-length": bytes } }, (res) => { res.resume(); ok(res.statusCode); });
  r.on("error", bad); r.write(Buffer.alloc(1024)); });

test("JSON routes refuse bodies larger than they carry", async () => {
  const a = await startApp();
  try {
    makeProject(a, "t-ch01"); makeScene(a, "s1");
    const st = async (path, b, method = "POST") => (await fetch(a.base + path, { method, body: b })).status;
    assert.equal(await st("/api/cast/rename?p=t-ch01", big(100 << 10)), 413);
    assert.equal(await st("/api/assistant", big(3 << 20)), 413);
    assert.equal(await st("/api/connections", big(300 << 10)), 413);
    assert.equal(await st("/api/spend", big(300 << 10)), 413);
    assert.equal(await st("/api/anime/plan?id=s1", big(9 << 20), "PUT"), 413);
    assert.equal(await st("/api/create", big(2 << 20)), 413);
    // ordinary sizes still pass
    assert.notEqual(await st("/api/anime/plan?id=s1", JSON.stringify({ shots: [{ shot_id: "S01", duration: 2 }] }), "PUT"), 413);
  } finally { await a.stop(); }
});

test("a clip upload is streamed to a file, and one that claims too much is refused at once", async () => {
  const a = await startApp();
  try {
    const dir = makeScene(a, "s1");
    assert.equal(await claim(a.base, "/api/anime/upload?id=s1&kind=clip&name=big.mp4", 700 << 20), 413);
    assert.deepEqual(existsSync(join(dir, "clips")) ? readdirSync(join(dir, "clips")) : [], [], "no half file left behind");
    const mp4 = join(a.scratch, "c.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4]);
    const r = await (await fetch(`${a.base}/api/anime/upload?id=s1&kind=clip&name=c.mp4`, { method: "POST", body: readFileSync(mp4) })).json();
    assert.match(r.url || "", /clips/); assert.ok(r.dur > 0.5);
    assert.equal(readdirSync(join(dir, "clips")).filter((n) => n.startsWith(".in-")).length, 0);
  } finally { await a.stop(); }
});

test("a zipped book that unpacks to too much is refused", async () => {
  const a = await startApp();
  try {
    const docx = join(a.scratch, "bomb.docx");
    execFileSync("/usr/bin/python3", ["-c", "import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED)\nz.writestr('word/document.xml', b'<a>' + b' ' * (80<<20) + b'</a>')\nz.close()", docx]);
    const r = await fetch(`${a.base}/api/series?name=Bomb&file=bomb.docx`, { method: "POST", body: readFileSync(docx) });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /unpacks to more/);
  } finally { await a.stop(); }
});

test("a body with no stated length that grows past the limit still gets its 413 (the connection is not cut under the answer)", async () => {
  const a = await startApp();
  try {
    makeProject(a, "t-ch01");
    const status = await new Promise((ok, bad) => { // chunked: no content-length
      const u = new URL(a.base + "/api/cast/rename?p=t-ch01"), r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: "POST" }, (res) => { res.resume(); ok(res.statusCode); });
      r.on("error", bad); for (let i = 0; i < 8; i++) r.write(Buffer.alloc(64 << 10, 97)); r.end(); });
    assert.equal(status, 413);
    assert.equal((await fetch(a.base + "/api/ping")).status, 200);
  } finally { await a.stop(); }
});
