// List 1, job 4: a voice recording in a look can be fetched (it used to answer 404: the route served pictures only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { startApp, makeScene } from "./harness.mjs";

test("a look's voice file plays, with byte ranges; other kinds of file are still refused", async () => {
  const a = await startApp();
  try {
    makeScene(a, "s1");
    const mp3 = join(a.scratch, "v.mp3"); execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", mp3]);
    const up = await (await fetch(`${a.base}/api/anime/upload?show=look-one&kind=voice&name=ann.mp3`, { method: "POST", body: readFileSync(mp3) })).json();
    assert.match(up.url, /lookfile\?look=look-one&f=voice-ann\.mp3/);
    const r = await fetch(`${a.base}/${up.url}`); assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "audio/mpeg");
    assert.equal((await r.arrayBuffer()).byteLength, readFileSync(mp3).length);
    const part = await fetch(`${a.base}/${up.url}`, { headers: { range: "bytes=0-99" } }); assert.equal(part.status, 206); assert.equal((await part.arrayBuffer()).byteLength, 100);
    for (const f of ["look.json", "show.json", "../../x.mp3"]) assert.equal((await fetch(`${a.base}/api/anime/lookfile?look=look-one&f=${encodeURIComponent(f)}`)).status, 404, f);
  } finally { await a.stop(); }
});
