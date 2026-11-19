// Audit item 7: stored text that reaches the page is escaped (the Sound tab's loudness fields; panel and style ids in the editor).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startApp, makeScene, REPO } from "./harness.mjs";

const EVIL = '"><img src=x onerror=alert(1)>';
test("the sound list keeps numbers as numbers and kinds as plain words", async () => {
  const a = await startApp();
  try {
    const dir = makeScene(a, "s1");
    const r = await fetch(`${a.base}/api/anime/sound?id=s1`, { method: "PUT", body: JSON.stringify({ tracks: [{ id: "t1", kind: EVIL, name: "Music", gain: EVIL }, { id: "t2", kind: "music", gain: "0.6" }], clips: [{ id: "c1", track: "t1", gain: EVIL, offset: "1.5", fadeIn: EVIL, name: EVIL, line: EVIL }] }) });
    assert.equal(r.status, 200);
    const s = JSON.parse(readFileSync(join(dir, "sound.json"), "utf8"));
    assert.equal(s.tracks[0].kind, undefined); assert.equal(s.tracks[0].gain, undefined); assert.equal(s.tracks[1].gain, 0.6);
    assert.equal(s.clips[0].gain, undefined); assert.equal(s.clips[0].offset, 1.5); assert.equal(s.clips[0].fadeIn, undefined); assert.equal(s.clips[0].line, undefined);
    assert.equal(s.clips[0].name, EVIL, "a name is text: kept, and escaped by the screen");
  } finally { await a.stop(); }
});
test("the screens escape the fields the audit found", () => {
  const app = readFileSync(join(REPO, "anime/ui/app.js"), "utf8"), ed = readFileSync(join(REPO, "page-editor/editor.js"), "utf8");
  assert.doesNotMatch(app, /data-[st]="gain" value="\$\{[ct]\.gain/);
  assert.doesNotMatch(app, /class="lclip \$\{t\.kind\}/);
  assert.doesNotMatch(ed, /data-pid="\$\{(c\.panel|q)\.id\}"/);
  assert.doesNotMatch(ed, /data-style="\$\{s\.id\}"/);
});
