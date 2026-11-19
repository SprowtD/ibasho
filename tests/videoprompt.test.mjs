// List 1, job 6 (anime, screens and checks only; nothing is sent to a video model): the video prompt in blocks with timecoded
// beats, the join between two shots, the words-a-second meter, and the plan check's new rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startApp, makeScene, codexCalls } from "./harness.mjs";
const P = createRequire(import.meta.url)("../anime/core/plan.js");

test("the video prompt has its blocks, the beats, both sides of a hidden wipe, and a meter", async () => {
  const a = await startApp();
  try {
    makeScene(a, "s1", { shots: [
      { shot_id: "S01", duration: 3, action: "Mara walks off.", blocking: [{ name: "Mara", facing: "left" }] },
      { shot_id: "S02", duration: 12, action: "They talk.", long_take: true, join: "wipe", join_cover: "a passing tram", join_reason: "hide the jump in time", beats: "0-4 Tobias looks up\n4-8 Mara sits\n8-12 They laugh", blocking: [{ name: "Tobias" }] } ] });
    const one = await (await fetch(`${a.base}/api/anime/video-request?id=s1&shot=S01&preview=1`)).json();
    for (const b of ["ONE SHOT", "WHO IS WHERE", "LOOK:", "CAMERA:", "BEATS:", "CONTINUITY:"]) assert.match(one.prompt, new RegExp(b));
    assert.match(one.prompt, /0-3 s: Mara walks off\./); assert.match(one.prompt, /ENDS as a passing tram moves across and fills the whole frame/);
    assert.doesNotMatch(one.prompt, /Tobias/, "only the cast in this shot is named");
    const two = await (await fetch(`${a.base}/api/anime/video-request?id=s1&shot=S02&preview=1`)).json();
    assert.match(two.prompt, /OPENS from a passing tram filling the whole frame/); assert.match(two.prompt, /one continuous take/);
    assert.match(two.prompt, /4-8 s: Mara sits/);
    assert.equal(two.meter.seconds, 12); assert.equal(two.meter.level, "ok");
    assert.ok(one.meter.wps > 0); assert.equal(codexCalls(a).length, 0);
    // without preview, a shot with no picture is still refused for a real video
    assert.equal((await fetch(`${a.base}/api/anime/video-request?id=s1&shot=S01`)).status, 400);
  } finally { await a.stop(); }
});

test("the plan check: a hidden wipe needs its cover, a join that moves wants a reason, a long take 10 to 15 s and 3 to 5 beats", () => {
  const plan = (s) => ({ shots: [{ shot_id: "A", duration: 2 }, { shot_id: "B", duration: 4, ...s }], dialogue: [] });
  const msgs = (s) => { const c = P.check(plan(s)); return [...c.errors, ...c.warnings].filter((x) => x.shot === "B").map((x) => x.msg).join(" | "); };
  assert.match(msgs({ join: "wipe" }), /hidden wipe needs what fills the frame/);
  assert.match(msgs({ join: "match", join_cover: "a swing of the arm" }), /needs a reason/);
  assert.doesNotMatch(msgs({ join: "wipe", join_cover: "a back", join_reason: "time jump" }), /wipe|reason for|join that/);
  assert.match(msgs({ long_take: true, beats: "a\nb" }), /long take runs 10 to 15 s .*\| .*3 to 5 beats|3 to 5 beats.*\|.*10 to 15/);
});

test("a beat that starts with the letter s keeps it; the unit 's' is still read; a beat past the shot's end keeps its own times", async () => {
  const a = await startApp();
  try {
    makeScene(a, "s2", { shots: [{ shot_id: "S01", duration: 6, action: "x", beats: "0-3 she turns to him\n3-6s: smoke rises", blocking: [{ name: "Mara" }] },
      { shot_id: "S02", duration: 3, action: "y", beats: "0-2 s Stops.\n4-6 He leaves", blocking: [{ name: "Mara" }] }] });
    const one = (await (await fetch(`${a.base}/api/anime/video-request?id=s2&shot=S01&preview=1`)).json()).prompt;
    assert.match(one, /0-3 s: she turns to him/); assert.match(one, /3-6 s: smoke rises/);
    const two = (await (await fetch(`${a.base}/api/anime/video-request?id=s2&shot=S02&preview=1`)).json()).prompt;
    assert.match(two, /0-2 s: Stops\./); assert.match(two, /4-6 s: He leaves/);
  } finally { await a.stop(); }
});
