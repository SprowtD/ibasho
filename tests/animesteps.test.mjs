// The Assistant's shot-level steps on the anime scene screen (anime/core/steps.js): each changes only the shots it names,
// says in one sentence what really changed, refuses with the reason when it cannot run (and then changes nothing),
// and never rewrites, adds or drops a spoken line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startApp } from "./harness.mjs";
const require = createRequire(import.meta.url), AS = require("../anime/core/steps.js"), P = require("../anime/core/plan.js");

const plan = () => ({ scene_id: "s", dialogue: [{ line_id: "L1", speaker: "Mara", text: "You came." }, { line_id: "L2", speaker: "Tobias", text: "I said I would." }, { line_id: "L3", speaker: "Mara", text: "Sit." }],
  shots: [
    { shot_id: "S01", duration: 3, scene_type: "establishing", camera: { framing: "wide", move: "still" }, action: "The pier at dusk.", lines: [], still: "a.png" },
    { shot_id: "S02", duration: 4, scene_type: "dialogue", camera: { framing: "medium", move: "still" }, action: "Mara turns.", lines: ["L1", "L2"], line_placement: "on_speaker", still: "b.png", tout: "black", tout_dur: 0.5 },
    { shot_id: "S03", duration: 2, scene_type: "dialogue", camera: { framing: "close-up", move: "still" }, action: "Tobias sits.", lines: ["L3"], line_placement: "on_speaker", still: "c.png" },
    { shot_id: "S04", duration: 1.5, scene_type: "insert", camera: { framing: "close-up", move: "still" }, action: "A cup on the table.", lines: [] } ] });
const lines = (p) => p.shots.flatMap((s) => s.lines || []).join(",");
const refused = (fn, re) => { const p = plan(), was = JSON.stringify(p); assert.throws(() => fn(p), re); assert.equal(JSON.stringify(p), was, "a refused step changes nothing"); };

test("a shot that is not there is refused, with the shots there are", () => {
  assert.equal(AS.has(plan(), "S02"), ""); assert.equal(AS.has(plan(), "shot S02"), "");
  assert.match(AS.has(plan(), "S99"), /There is no shot "S99" in this scene\. Its shots: S01, S02, S03, S04\./);
  for (const fn of [AS.edit, AS.split, AS.join, AS.move, AS.setJoin, AS.longTake]) refused((p) => fn(p, { shot: "S99", to: "later", how: "cut", on: "yes" }), /There is no shot "S99"/);
});

test("edit a shot: only what is given changes, the lines never", () => {
  const p = plan(), r = AS.edit(p, { shot: "S02", action: "Mara turns from the rail.", framing: "close-up", move: "slow push in", move_reason: "she lets him in", type: "emotional", seconds: 5.5, lines: ["L9"], text: "new words" }, Object.keys(P.TARGETS));
  const s = p.shots[1];
  assert.deepEqual([s.action, s.camera.framing, s.camera.move, s.camera.move_reason, s.scene_type, s.duration], ["Mara turns from the rail.", "close-up", "slow push in", "she lets him in", "emotional", 5.5]);
  assert.deepEqual(s.lines, ["L1", "L2"]); assert.equal(p.dialogue[0].text, "You came.");
  assert.match(r.msg, /Shot S02: changed what happens, the framing, the camera move, the reason for the move, its type, its length \(5\.5 s\)\. Its lines are untouched\. The picture is the old one/);
  assert.equal(JSON.stringify(p.shots[0]), JSON.stringify(plan().shots[0]), "the other shots are as they were");
  const again = AS.edit(p, { shot: "S02", framing: "close-up" }); assert.ok(again.same); assert.match(again.msg, /Nothing to change/);
  refused((q) => AS.edit(q, { shot: "S02", type: "chase" }, Object.keys(P.TARGETS)), /"chase" is not a shot type\. The types: dialogue,/);
  refused((q) => AS.edit(q, { shot: "S02", seconds: 0 }), /0\.2 to 60 seconds/);
});

test("split a shot: the time is shared, lines go where asked, the fade out moves to the end, a clip stays with the first part", () => {
  let p = plan(), r = AS.split(p, { shot: "S02", line: "L2" });
  assert.deepEqual(p.shots.map((s) => s.shot_id), ["S01", "S02", "S02b", "S03", "S04"]);
  assert.deepEqual([p.shots[1].duration, p.shots[2].duration], [2, 2]); assert.deepEqual([p.shots[1].lines, p.shots[2].lines], [["L1"], ["L2"]]);
  assert.equal(lines(p), "L1,L2,L3"); assert.equal(p.shots[1].tout, undefined); assert.equal(p.shots[2].tout, "black");
  assert.equal(r.shot, "S02b"); assert.match(r.msg, /Shot S02 is now two shots: S02 \(2 s, 1 line\) and the new S02b \(2 s, 1 line\)/);
  assert.equal(P.check(p).errors.filter((e) => /lines/.test(e.msg)).length, 0, "the plan check finds every line placed once, in order");
  p = plan(); AS.split(p, { shot: "S02", seconds: 1 }); assert.deepEqual([p.shots[1].duration, p.shots[2].duration, p.shots[2].lines.length, p.shots[2].line_placement], [1, 3, 0, undefined]);
  p = plan(); Object.assign(p.shots[1], { clip: "v.mp4", clip_dur: 4, join: "wipe", join_cover: "a back", long_take: true }); r = AS.split(p, { shot: "S02" });
  assert.equal(p.shots[2].clip, undefined); assert.equal(p.shots[2].join, undefined); assert.equal(p.shots[2].long_take, undefined); assert.equal(p.shots[1].clip, "v.mp4"); assert.match(r.msg, /The video clip stays on S02\./);
  refused((q) => AS.split(q, { shot: "S02", line: "L3" }), /Shot S02 has no line "L3"\. Its lines: L1, L2\./);
  refused((q) => AS.split(q, { shot: "S02", seconds: 3.9 }), /must leave both parts 0\.2 s or more/);
  p = plan(); AS.split(p, { shot: "S02" }); AS.split(p, { shot: "S02" }); assert.deepEqual(p.shots.map((s) => s.shot_id).slice(1, 4), ["S02", "S02c", "S02b"], "a second split gets its own id");
});

test("join two shots: lengths add, lines follow each other, both actions kept; refused at the end and with a video clip", () => {
  const p = plan(), r = AS.join(p, { shot: "S02" });
  assert.deepEqual(p.shots.map((s) => s.shot_id), ["S01", "S02", "S04"]); assert.equal(p.shots[1].duration, 6); assert.deepEqual(p.shots[1].lines, ["L1", "L2", "L3"]);
  assert.equal(p.shots[1].action, "Mara turns. Then: Tobias sits."); assert.equal(p.shots[1].still, "b.png"); assert.equal(p.shots[1].tout, undefined, "it ends as the second shot did");
  assert.match(r.msg, /Shots S02 and S03 are now one shot, S02: 6 s, 3 lines\. 3 shots in the scene\. S03's picture is no longer used\./);
  refused((q) => AS.join(q, { shot: "S04" }), /S04 is the last shot/);
  { const q = plan(); q.shots[2].clip = "v.mp4"; const was = JSON.stringify(q); assert.throws(() => AS.join(q, { shot: "S02" }), /Shot S03 has a video clip/); assert.equal(JSON.stringify(q), was); }
});

test("move a shot one place; the script stays in order; a join on the new first shot goes back to a cut", () => {
  let p = plan(), r = AS.move(p, { shot: "S04", to: "earlier" });
  assert.deepEqual(p.shots.map((s) => s.shot_id), ["S01", "S02", "S04", "S03"]); assert.equal(lines(p), "L1,L2,L3"); assert.match(r.msg, /Shot S04 now plays before S03\./);
  refused((q) => AS.move(q, { shot: "S02", to: "later" }), /S02 and S03 both carry lines/);
  refused((q) => AS.move(q, { shot: "S01", to: "earlier" }), /already the first shot/);
  refused((q) => AS.move(q, { shot: "S01", to: "sideways" }), /earlier or later/);
  p = plan(); Object.assign(p.shots[1], { join: "wipe", join_cover: "a back", lines: [] }); delete p.shots[1].line_placement; p.dialogue = [p.dialogue[2]];
  r = AS.move(p, { shot: "S02", to: "earlier" }); assert.equal(p.shots[0].shot_id, "S02"); assert.equal(p.shots[0].join, undefined); assert.match(r.msg, /S02 is first now, so its join is back to a cut/);
});

test("set how a shot joins the one before: a wipe needs its cover, the first shot has nothing to join, the plan check agrees", () => {
  const p = plan(); let r = AS.setJoin(p, { shot: "S03", how: "hidden wipe", cover: "Tobias's back crossing the lens", reason: "hide the jump in time" });
  assert.deepEqual([p.shots[2].join, p.shots[2].join_cover, p.shots[2].join_reason], ["wipe", "Tobias's back crossing the lens", "hide the jump in time"]);
  assert.match(r.msg, /Shot S03 now joins S02 with a hidden wipe: Tobias's back crossing the lens\./);
  assert.equal([...P.check(p).errors, ...P.check(p).warnings].filter((x) => x.shot === "S03" && /wipe|join/.test(x.msg)).length, 0);
  r = AS.setJoin(p, { shot: "S03", how: "match", cover: "the swing of his arm" }); assert.equal(p.shots[2].join, "match"); assert.equal(p.shots[2].join_reason, undefined); assert.match(r.msg, /No reason is given yet/);
  r = AS.setJoin(p, { shot: "S03", how: "cut" }); assert.equal(p.shots[2].join, undefined); assert.equal(p.shots[2].join_cover, undefined); assert.match(r.msg, /plain cut/);
  assert.ok(AS.setJoin(p, { shot: "S03", how: "cut" }).same);
  refused((q) => AS.setJoin(q, { shot: "S03", how: "wipe" }), /needs what fills the frame/);
  refused((q) => AS.setJoin(q, { shot: "S01", how: "wipe", cover: "x" }), /first shot/);
  refused((q) => AS.setJoin(q, { shot: "S03", how: "dissolve" }), /cut, wipe .* or match/);
});

test("the Long take tick: on and off, and it says what the shot still needs", () => {
  const p = plan(); let r = AS.longTake(p, { shot: "S02", on: "yes" });
  assert.equal(p.shots[1].long_take, true); assert.match(r.msg, /now a long take\. Still to do: it is 4 s and a long take runs 10 to 15 s; it has 0 beats and wants 3 to 5/);
  assert.ok(AS.longTake(p, { shot: "S02", on: true }).same);
  r = AS.longTake(p, { shot: "S02", on: "no" }); assert.equal(p.shots[1].long_take, undefined); assert.match(r.msg, /no longer a long take\.$/);
  refused((q) => AS.longTake(q, { shot: "S02", on: "maybe" }), /yes or no/);
});

test("the step code is served to the anime screen", async () => {
  const a = await startApp();
  try {
    const r = await fetch(a.base + "/anime/core/steps.js"); assert.equal(r.status, 200); assert.match(await r.text(), /AnimeSteps/);
    assert.match(await (await fetch(a.base + "/anime/")).text(), /\/anime\/core\/steps\.js/);
  } finally { await a.stop(); }
});
