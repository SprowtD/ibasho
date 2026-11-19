// List 1, job 5: a video clip is re-wrapped (not re-encoded) when it already plays everywhere, starts playing before it has all
// arrived, and has its sound saved beside it for the player.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { startApp, makeScene, REPO } from "./harness.mjs";

test("an uploaded h264 clip is re-wrapped with its index first, and its sound is saved and served beside it", async () => {
  const a = await startApp();
  try {
    const dir = makeScene(a, "s1"), mp4 = join(a.scratch, "c.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=2", "-f", "lavfi", "-i", "sine=f=330:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", mp4]); // index at the end
    const r = await (await fetch(`${a.base}/api/anime/upload?id=s1&kind=clip&name=c.mp4`, { method: "POST", body: readFileSync(mp4) })).json();
    const out = readFileSync(join(dir, "clips", "c.mp4"));
    assert.ok(out.indexOf("moov") < out.indexOf("mdat"), "the index comes first, so a phone can start playing at once");
    const frames = (f) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "v", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", f]).toString().trim();
    assert.equal(frames(join(dir, "clips", "c.mp4")), frames(mp4));
    assert.ok(existsSync(join(dir, "clips", "c.m4a")));
    const m = await fetch(`${a.base}/api/anime/media?id=s1&f=clips/c.m4a`); assert.equal(m.status, 200); assert.equal(m.headers.get("content-type"), "audio/mp4");
    assert.ok(r.sound);
  } finally { await a.stop(); }
});

test("the player no longer seeks while a clip loads, and its clip sound uses the .m4a", () => {
  const app = readFileSync(join(REPO, "anime/ui/app.js"), "utf8"), or = readFileSync(join(REPO, "page-editor/openrouter.mjs"), "utf8");
  assert.match(app, /the video IS the clock/); assert.match(app, /x\.starting/); assert.match(app, /\.m4a/);
  assert.match(or, /pollMs = 5000/);
});
