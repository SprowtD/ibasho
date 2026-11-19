// Audit items 11 and 12: one lock per document and whole-file writes; landed stills survive an old screen's save; a history copy
// before plan saves; a bad plan does not break the scene lists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { startApp, makeProject, makeScene } from "./harness.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
test("twenty sheets uploaded at once all reach the bible (no lost updates, no temp files left)", async () => {
  const a = await startApp();
  try {
    const dir = makeProject(a, "t-ch01");
    const names = Array.from({ length: 20 }, (_, i) => "Person " + i);
    const rs = await Promise.all(names.map((n) => fetch(`${a.base}/api/sheet?p=t-ch01&name=${encodeURIComponent(n)}`, { method: "PUT", body: JSON.stringify({ dataUrl: PNG }) })));
    assert.ok(rs.every((r) => r.status === 200));
    const cast = JSON.parse(readFileSync(join(dir, "bible.json"), "utf8")).cast;
    assert.deepEqual(names.filter((n) => !cast[n]), []);
    assert.deepEqual(readdirSync(dir).filter((n) => n.includes(".tmp-")), []);
  } finally { await a.stop(); }
});

test("a still that lands while a screen has the old plan is kept when that screen saves", async () => {
  const a = await startApp();
  try {
    const dir = makeScene(a, "s1", { shots: [{ shot_id: "S01", duration: 3, action: "x" }, { shot_id: "S02", duration: 2, action: "y" }] });
    const old = (await (await fetch(`${a.base}/api/anime/scene?id=s1`)).json()).plan;
    const pic = join(a.scratch, "p.png"); execFileSync("/usr/bin/python3", ["-c", "import sys\nfrom PIL import Image\nImage.new('RGB',(300,200),(0,0,200)).save(sys.argv[1])", pic]);
    const up = await (await fetch(`${a.base}/api/create/upload?name=p.png`, { method: "POST", body: readFileSync(pic) })).json();
    const sent = await (await fetch(`${a.base}/api/create/send`, { method: "POST", body: JSON.stringify({ id: up.id, to: "shot", scene: "s1", shot: "S01" }) })).json();
    assert.match(sent.still, /stills\/S01-take01\.png/);
    old.shots[1].action = "edited on the old screen";
    const put = await (await fetch(`${a.base}/api/anime/plan?id=s1`, { method: "PUT", body: JSON.stringify(old) })).json();
    assert.ok(put.media && put.media.S01, "the server says which shot it kept");
    const now = JSON.parse(readFileSync(join(dir, "SCENE_PLAN.json"), "utf8"));
    assert.equal(now.shots[0].still, sent.still); assert.equal(now.shots[1].action, "edited on the old screen");
    // the screen took the kept fields: its next save may change the still on purpose
    const mine = JSON.parse(JSON.stringify(now)); mine.shots[0].still = "";
    await fetch(`${a.base}/api/anime/plan?id=s1`, { method: "PUT", body: JSON.stringify(mine) });
    assert.equal(JSON.parse(readFileSync(join(dir, "SCENE_PLAN.json"), "utf8")).shots[0].still, "");
  } finally { await a.stop(); }
});

test("plan saves keep history copies; a save that drops shots always does", async () => {
  const a = await startApp();
  try {
    const dir = makeScene(a, "s1", { shots: [{ shot_id: "S01", duration: 3 }, { shot_id: "S02", duration: 2 }] });
    const put = (plan) => fetch(`${a.base}/api/anime/plan?id=s1`, { method: "PUT", body: JSON.stringify(plan) });
    await put({ shots: [{ shot_id: "S01", duration: 3 }, { shot_id: "S02", duration: 4 }] });
    await put({ shots: [{ shot_id: "S01", duration: 3 }, { shot_id: "S02", duration: 5 }] }); // within ten minutes: no second ordinary copy
    await put({ shots: [{ shot_id: "S01", duration: 3 }] });
    const h = readdirSync(join(dir, "history"));
    assert.equal(h.filter((n) => n.endsWith("-before-save.json")).length, 1);
    assert.equal(h.filter((n) => n.endsWith("-before-save-fewer.json")).length, 1);
    assert.equal((await put({ shots: [{ shot_id: "S01" }, { shot_id: "S01" }] })).status, 400, "two shots with one id");
    assert.equal((await put({ shots: "nope" })).status, 400);
  } finally { await a.stop(); }
});

test("one unreadable plan does not break the scene and show lists, and can be put back from history", async () => {
  const a = await startApp();
  try {
    makeScene(a, "good"); const bad = makeScene(a, "bad");
    await fetch(`${a.base}/api/anime/plan?id=bad`, { method: "PUT", body: JSON.stringify({ shots: [{ shot_id: "S01", duration: 3 }] }) }); // keeps a history copy
    writeFileSync(join(bad, "SCENE_PLAN.json"), '{"shots": [ {"shot_id": "S01"'); // cut off mid-write
    const scenes = await fetch(`${a.base}/api/anime/scenes`); assert.equal(scenes.status, 200);
    const list = await scenes.json(); assert.ok(list.find((x) => x.id === "good" && !x.broken)); assert.ok(list.find((x) => x.id === "bad" && x.broken));
    assert.equal((await fetch(`${a.base}/api/anime/shows`)).status, 200);
    assert.equal((await fetch(`${a.base}/api/create/targets`)).status, 200);
    const r = await fetch(`${a.base}/api/anime/scene?id=bad`); assert.equal(r.status, 409);
    const d = await r.json(); assert.ok(d.broken && d.history.length);
    assert.equal((await fetch(`${a.base}/api/anime/history?id=bad`, { method: "POST", body: JSON.stringify({ name: d.history[0] }) })).status, 200);
    assert.equal((await fetch(`${a.base}/api/anime/scene?id=bad`)).status, 200);
  } finally { await a.stop(); }
});

test("a tab holding an older storyboard cannot save over the newer one; a current tab can", async () => {
  const a = await startApp();
  try {
    const page = { id: "p1", number: 1, layout: { rows: [{ panels: [{ id: "a1", board: { who: [], lines: [] } }] }] } };
    makeProject(a, "s-ch01", { spec: { boardAt: "2026-11-19T10:00:00.000Z" } });
    const put = (boardAt) => fetch(`${a.base}/api/spec?p=s-ch01`, { method: "PUT", body: JSON.stringify({ project: "Test", boardAt, pages: [page] }) });
    const stale = await put("2026-11-18T09:00:00.000Z");
    assert.equal(stale.status, 409); assert.match((await stale.json()).error, /storyboarded again/);
    assert.equal((await put(undefined)).status, 409, "a tab from before the first storyboard is older too");
    assert.equal(existsSync(join(a.saved, "s-ch01.json")), false, "nothing was written");
    const fresh = await put("2026-11-19T10:00:00.000Z");
    assert.equal(fresh.status, 200);
    assert.equal(JSON.parse(readFileSync(join(a.saved, "s-ch01.json"), "utf8")).boardAt, "2026-11-19T10:00:00.000Z");
    assert.equal((await fetch(`${a.base}/api/spec?p=s-ch01`, { method: "PUT", body: "{ not json" })).status, 400);
  } finally { await a.stop(); }
});

test("a still that lands does not put back the clip fields a screen changed meanwhile", async () => {
  const a = await startApp();
  try {
    const dir = makeScene(a, "s3", { shots: [{ shot_id: "S01", duration: 3, action: "x" }] });
    const old = (await (await fetch(`${a.base}/api/anime/scene?id=s3`)).json()).plan;
    const pic = join(a.scratch, "p.png"); execFileSync("/usr/bin/python3", ["-c", "import sys\nfrom PIL import Image\nImage.new('RGB',(300,200),(0,0,200)).save(sys.argv[1])", pic]);
    const up = await (await fetch(`${a.base}/api/create/upload?name=p.png`, { method: "POST", body: readFileSync(pic) })).json();
    const sent = await (await fetch(`${a.base}/api/create/send`, { method: "POST", body: JSON.stringify({ id: up.id, to: "shot", scene: "s3", shot: "S01" }) })).json();
    old.shots[0].clip_from = 1.5; // changed on the old screen, before it heard of the still
    const put = await (await fetch(`${a.base}/api/anime/plan?id=s3`, { method: "PUT", body: JSON.stringify(old) })).json();
    assert.equal(put.media.S01.still, sent.still); assert.ok(!("clip_from" in put.media.S01), "the clip fields are not sent back");
    const now = JSON.parse(readFileSync(join(dir, "SCENE_PLAN.json"), "utf8")).shots[0];
    assert.equal(now.still, sent.still); assert.equal(now.clip_from, 1.5);
  } finally { await a.stop(); }
});
