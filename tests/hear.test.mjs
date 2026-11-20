// "Write down what is said": a local Whisper listens to a scene's sound or video clip. Free and local only; a stand-in is used here.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, readFileSync, chmodSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { REPO, copyApp, startApp, makeScene } from "./harness.mjs";
import { tidy } from "../anime/hear.mjs";

let app, copy, scene, log, fake;
const call = async (method, q) => { const r = await fetch(app.base + "/api/anime/hear?id=scene-one&" + q, { method }); return { status: r.status, j: await r.json() }; };
const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).argv) : []);

before(async () => {
  copy = copyApp(); log = join(copy.scratch, "whisper-log.jsonl"); fake = join(copy.bin, "my-whisper");
  writeFileSync(fake, `#!/bin/sh\nexec node ${JSON.stringify(join(REPO, "tests", "fake-whisper.mjs"))} "$@"\n`); chmodSync(fake, 0o755);
  scene = makeScene(copy, "scene-one"); mkdirSync(join(scene, "audio")); mkdirSync(join(scene, "clips"));
  writeFileSync(join(scene, "audio", "joss-line.m4a"), "sound"); writeFileSync(join(scene, "clips", "S01.mp4"), "video"); writeFileSync(join(copy.scratch, "secret.mp4"), "no");
  app = await startApp(copy, { env: { STUDIO_WHISPER: fake, FAKE_WHISPER_LOG: log } });
});
after(async () => { await app.stop(); });

test("a sound of the scene is written down with times, kept beside the scene, and nothing else can be listened to", async () => {
  const first = await call("GET", "f=audio/joss-line.m4a");
  assert.equal(first.status, 200); assert.equal(first.j.can, true); assert.equal(first.j.heard, null);
  const got = await call("POST", "f=audio/joss-line.m4a");
  assert.equal(got.status, 200, JSON.stringify(got.j));
  assert.deepEqual(got.j.heard.segments, [{ start: 0.4, end: 1.9, text: "こっちだ！" }, { start: 2.25, end: 4.1, text: "フェリーが出るよ。" }], "only real pieces of speech, tidied");
  assert.equal(got.j.heard.language, "ja");
  assert.deepEqual(calls()[0], [join(scene, "audio", "joss-line.m4a")], "the listener is given the file on this computer and nothing else");
  const again = await call("GET", "f=audio/joss-line.m4a"); assert.deepEqual(again.j.heard, got.j.heard, "it is kept"); assert.ok(again.j.at);
  assert.ok(existsSync(join(scene, "hear", "joss-line.m4a.json")));
  // in English is asked for and kept apart; the language can be named
  const en = await call("POST", "f=clips/S01.mp4&to=en&lang=ja");
  assert.equal(en.j.heard.segments[0].text, "Over here!"); assert.deepEqual(calls()[1].slice(1), ["--to", "en", "--lang", "ja"]);
  assert.equal((await call("GET", "f=clips/S01.mp4")).j.heard, null, "the spoken-language answer is another one");
  // the sound was replaced: the old words are not shown for the new file
  writeFileSync(join(scene, "audio", "joss-line.m4a"), "another take"); utimesSync(join(scene, "audio", "joss-line.m4a"), new Date(), new Date(Date.now() + 5000));
  assert.equal((await call("GET", "f=audio/joss-line.m4a")).j.heard, null);
  // only this scene's sound and clips
  for (const f of ["../secret.mp4", "audio/../../secret.mp4", "stills/S01.png", "scene.json", "audio/x.txt", ""]) assert.equal((await call("POST", "f=" + encodeURIComponent(f))).status, 400, f);
  assert.equal((await call("POST", "f=audio/none.mp3")).status, 404);
  assert.equal((await fetch(app.base + "/api/anime/hear?id=no-such-scene&f=audio/a.mp3", { method: "POST" })).status, 404);
  assert.equal((await call("DELETE", "f=audio/joss-line.m4a")).status, 405);
  assert.equal(calls().length, 2, "nothing refused ever reached the listener");
  assert.equal((await fetch(app.base + "/api/anime/media?id=scene-one&f=hear/joss-line.m4a.json")).status, 404, "the kept words are not a media file");
});
test("with no local speech-to-text the answer says what to install, and no service is called", async () => {
  const c2 = copyApp(), s2 = makeScene(c2, "scene-one"); mkdirSync(join(s2, "audio")); writeFileSync(join(s2, "audio", "a.mp3"), "x");
  const a2 = await startApp(c2, { env: { STUDIO_WHISPER: join(c2.scratch, "not-installed") } });
  try {
    const g = await (await fetch(a2.base + "/api/anime/hear?id=scene-one&f=audio/a.mp3")).json();
    assert.equal(g.can, false); assert.match(g.how, /pip install faster-whisper/); assert.match(g.how, /free/);
    const r = await fetch(a2.base + "/api/anime/hear?id=scene-one&f=audio/a.mp3", { method: "POST" }), j = await r.json();
    assert.equal(r.status, 409); assert.equal(j.install, true); assert.match(j.error, /No speech-to-text is installed/);
  } finally { await a2.stop(); }
});
test("a listener that fails says so; odd answers are tidied", async () => {
  const c3 = copyApp(), s3 = makeScene(c3, "scene-one"); mkdirSync(join(s3, "audio")); writeFileSync(join(s3, "audio", "a.mp3"), "x");
  const f3 = join(c3.bin, "my-whisper"); writeFileSync(f3, `#!/bin/sh\nexec node ${JSON.stringify(join(REPO, "tests", "fake-whisper.mjs"))} "$@"\n`); chmodSync(f3, 0o755);
  const a3 = await startApp(c3, { env: { STUDIO_WHISPER: f3, FAKE_WHISPER_FAIL: "1" } });
  try { const r = await fetch(a3.base + "/api/anime/hear?id=scene-one&f=audio/a.mp3", { method: "POST" }), j = await r.json(); assert.equal(r.status, 500); assert.match(j.error, /could not be written down: the model file is missing/); assert.ok(!existsSync(join(s3, "hear"))); }
  finally { await a3.stop(); }
  assert.deepEqual(tidy({ language: "en", segments: [{ start: "1", end: "2.004", text: " a\n b " }, { start: -1, end: 2, text: "x" }, { start: 1, end: "z", text: "x" }, null, { start: 3, end: 3, text: "ok" }] }).segments, [{ start: 1, end: 2, text: "a b" }, { start: 3, end: 3, text: "ok" }]);
  assert.deepEqual(tidy(null).segments, []);
});
