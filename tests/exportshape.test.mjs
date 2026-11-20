// The scene's video export in another shape (9:16 upright, 1:1 square), cut around the people in each shot; and the on-twos finish
// (each drawing of a video clip held for two frames). Made with ffmpeg on pictures and a clip made by code. No model is reached.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO } from "./harness.mjs";
const { exportScene, focusOf, shapeOf } = await import(join(REPO, "anime/core/export.mjs"));

let dir;
const ff = (...a) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a]);
const size = (f) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", f]).toString().trim();
const hasSound = (f) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", f]).toString().trim();
/** The frames of a video as small grey pictures (32 x 32), and the mean red and blue of each frame. */
const greys = (f) => { const b = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", f, "-vf", "scale=32:32,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 }); const out = []; for (let i = 0; i + 1024 <= b.length; i += 1024) out.push(b.subarray(i, i + 1024)); return out; };
const colour = (f, t) => { const b = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", f, "-frames:v", "1", "-vf", "scale=1:1,format=rgb24", "-f", "rawvideo", "-"]); return [b[0], b[1], b[2]]; };
const differ = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };

before(() => {
  dir = mkdtempSync(join(tmpdir(), "ibasho-test-exportshape-")); mkdirSync(join(dir, "stills"));
  // a wide still: its left half red, its right half blue
  ff("-f", "lavfi", "-i", "color=c=red:s=800x900", "-f", "lavfi", "-i", "color=c=blue:s=800x900", "-filter_complex", "hstack", "-frames:v", "1", join(dir, "stills", "wide.png"));
  // a clip in which every frame is a different picture (a bar that moves 16 px a frame over a split red and blue ground)
  ff("-f", "lavfi", "-i", "color=c=red:s=320x360:r=24:d=2", "-f", "lavfi", "-i", "color=c=blue:s=320x360:r=24:d=2", "-f", "lavfi", "-i", "color=c=white:s=40x360:r=24:d=2", "-filter_complex", "[0:v][1:v]hstack[bg];[bg][2:v]overlay=x='mod(n*16,600)':y=0", "-t", "2", "-r", "24", "-pix_fmt", "yuv420p", join(dir, "stills", "clip.mp4"));
});
after(() => { rmSync(dir, { recursive: true, force: true }); });
const file = (u) => join(dir, u);
const still = (id, at) => ({ shot_id: id, duration: 1, still: "stills/wide.png", camera: { motion: { kind: "still" } }, ...(at ? { blocking: [{ name: "Kai", at }] } : {}) });

test("the focus of a shot: its own point, else the middle of its people, else the middle of the picture", () => {
  assert.deepEqual(focusOf({ focus: [0.2, 0.7], blocking: [{ at: [0.9, 0.9] }] }), [0.2, 0.7]);
  assert.deepEqual(focusOf({ blocking: [{ at: [0.2, 0.4] }, { at: [0.4, 0.6] }] }).map((v) => Math.round(v * 100) / 100), [0.3, 0.5]);
  assert.deepEqual(focusOf({}), [0.5, 0.5]); assert.deepEqual(focusOf({ focus: [5, -1] }), [1, 0]);
  assert.equal(shapeOf("9:16"), "9:16"); assert.equal(shapeOf("4:3"), "16:9"); assert.equal(shapeOf(undefined), "16:9");
});
test("stills: 16:9 is as before; 9:16 and 1:1 are cut around the people in each shot", async () => {
  const plan = { shots: [still("S01", [0.1, 0.5]), still("S02", [0.9, 0.5]), still("S03")], dialogue: [] };
  const made = async (shape) => { const out = join(dir, `stills-${shape.replace(":", "x")}.mp4`); const r = await exportScene({ dir, plan, sound: { clips: [] }, file, out, subtitles: false, shape }); return { out, r }; };
  const wide = await made("16:9"); assert.equal(size(wide.out), "1280,720"); assert.deepEqual(wide.r.size, [1280, 720]); assert.equal(hasSound(wide.out), "aac");
  { const [r, , b] = colour(wide.out, 0.5); assert.ok(r > 60 && b > 60, "16:9 still shows both halves of the picture: " + [r, b]); }
  for (const [shape, dims] of [["9:16", "720,1280"], ["1:1", "720,720"]]) {
    const { out, r } = await made(shape); assert.equal(size(out), dims); assert.equal(r.shape, shape);
    const a = colour(out, 0.5), b = colour(out, 1.5), c = colour(out, 2.5);
    assert.ok(a[0] > 150 && a[2] < 60, `${shape}: the shot whose people are on the left shows the left of the picture (red): ${a}`);
    assert.ok(b[2] > 150 && b[0] < 60, `${shape}: the shot whose people are on the right shows the right (blue): ${b}`);
    assert.ok(c[0] > 60 && c[2] > 60, `${shape}: a shot with nobody placed is cut from the middle: ${c}`);
  }
});
test("a video clip fills the new shape (no black bars), around the shot's focus; subtitles and titles still fit", async () => {
  const plan = { shots: [{ shot_id: "S01", duration: 1, clip: "stills/clip.mp4", clip_dur: 2, focus: [0, 0.5], lines: ["L1"] }, { shot_id: "S02", duration: 1, title: "A very long title for a narrow picture", title_sub: "and its second line" }], dialogue: [{ line_id: "L1", speaker: "Kai", text: "One ball left and you say I never miss the last one, so watch me." }] };
  const out = join(dir, "clip-9x16.mp4"), r = await exportScene({ dir, plan, sound: { clips: [] }, file, out, shape: "9:16" });
  assert.equal(size(out), "1080,1920", "with a video clip the short side is 1080"); assert.deepEqual(r.size, [1080, 1920]);
  const top = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", "0.5", "-i", out, "-frames:v", "1", "-vf", "crop=iw:ih/8:0:0,scale=1:1,format=rgb24", "-f", "rawvideo", "-"]);
  assert.ok(top[0] > 120 && top[2] < 80, "the top of the picture is the clip's left side (red), not a black bar: " + [...top]);
  const wide = join(dir, "clip-16x9.mp4"); await exportScene({ dir, plan, sound: { clips: [] }, file, out: wide, shape: "16:9" }); assert.equal(size(wide), "1920,1080");
});
test("on twos: each drawing of a video clip is held for two frames; off, every frame is new; the sound and the length are the same", async () => {
  const plan = { shots: [{ shot_id: "S01", duration: 1.5, clip: "stills/clip.mp4", clip_dur: 2 }], dialogue: [] };
  const run = async (twos) => { const out = join(dir, `twos-${twos ? 1 : 0}.mp4`); const r = await exportScene({ dir, plan, sound: { clips: [] }, file, out, subtitles: false, size: "sd", twos }); return { f: greys(out), r, out }; };
  const off = await run(false), on = await run(true);
  assert.equal(off.f.length, 36); assert.equal(on.f.length, 36, "the same number of frames"); assert.equal(on.r.twos, true); assert.equal(off.r.twos, false);
  const moved = (f) => { let n = 0; for (let i = 1; i < f.length; i++) if (differ(f[i - 1], f[i]) > 0.5) n++; return n; };
  assert.ok(moved(off.f) >= 33, "as made, nearly every frame is a new picture: " + moved(off.f));
  const m = moved(on.f); assert.ok(m >= 15 && m <= 19, "on twos, a new picture every second frame: " + m + " changes in 36 frames");
  let pairs = 0; for (let i = 1; i < on.f.length; i++) if (differ(on.f[i - 1], on.f[i]) <= 0.5 && (i < 2 || differ(on.f[i - 2], on.f[i - 1]) > 0.5)) pairs++; assert.ok(pairs >= 15, "each picture is held exactly twice: " + pairs);
  assert.equal(hasSound(on.out), "aac");
  // stills are not put on twos: a slow push over a still stays smooth
  const sp = { shots: [{ shot_id: "S01", duration: 1, still: "stills/wide.png", camera: { motion: { kind: "pan", dir: "left", amount: 0.3 } } }], dialogue: [] };
  const so = join(dir, "still-twos.mp4"); await exportScene({ dir, plan: sp, sound: { clips: [] }, file, out: so, subtitles: false, twos: true });
  assert.ok(readFileSync(so).length > 1000);
});
test("through the app: Export takes the shape and the on-twos choice, and the screen offers both", async () => {
  const { copyApp, startApp, makeScene } = await import("./harness.mjs");
  const copy = copyApp(); makeScene(copy, "shape-scene", { shots: [{ shot_id: "S01", duration: 1, action: "She waves." }] });
  const app = await startApp(copy);
  try {
    const go = async (q) => { await fetch(`${app.base}/api/anime/export?id=shape-scene&${q}`, { method: "POST" }); let j = {};
      for (let i = 0; i < 300; i++) { j = await (await fetch(`${app.base}/api/anime/scene?id=shape-scene`)).json(); if (j.job && j.job.status !== "running") break; await new Promise((r) => setTimeout(r, 100)); } return j; };
    let j = await go("subs=1&shape=9:16&twos=1"); assert.equal(j.job.status, "done", JSON.stringify(j.job)); assert.match(j.job.msg, /9:16 \(720 x 1280\), video clips on twos/);
    assert.equal(size(join(copy.anime, "shape-scene", "export", j.job.file)), "720,1280");
    j = await go("subs=1&shape=nonsense"); assert.equal(j.job.status, "done"); assert.doesNotMatch(j.job.msg, /9:16|1:1|twos/); assert.equal(size(join(copy.anime, "shape-scene", "export", j.job.file)), "1280,720", "a shape nobody knows is 16:9, as before");
    const js = readFileSync(join(REPO, "anime/ui/app.js"), "utf8");
    assert.match(js, /id="exportShape"/); assert.match(js, /id="exportTwos"/); assert.match(js, /ibasho\.exportShape/); assert.match(js, /On twos \(anime cadence\)/);
  } finally { await app.stop(); }
});
