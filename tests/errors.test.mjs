// Smaller audit item: a failure answers 400/500 with its reason and is logged, not "404 not found".
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { startApp, makeProject, makeScene } from "./harness.mjs";

test("bad input is 400, a broken saved file is 500 with a reason and a log line, a missing file is 404", async () => {
  const a = await startApp();
  try {
    makeProject(a, "t-ch01"); makeScene(a, "s1");
    let r = await fetch(`${a.base}/api/cover?p=t-ch01`, { method: "PUT", body: "{nope" });
    assert.equal(r.status, 404, "no board.json: that project has no cover page to set");
    r = await fetch(`${a.base}/api/faces?p=t-ch01&src=x`, { method: "PUT", body: "{nope" });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /not readable JSON/);
    r = await fetch(`${a.base}/api/anime/sound?id=s1`, { method: "PUT", body: "{nope" });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /not readable JSON/);
    mkdirSync(join(a.series, "book")); writeFileSync(join(a.series, "book", "series.json"), "{broken");
    r = await fetch(`${a.base}/api/series?id=book`);
    assert.equal(r.status, 500); assert.match((await r.json()).error, /saved file could not be read/);
    await new Promise((ok) => setTimeout(ok, 100)); assert.match(a.out(), /GET \/api\/series/);
    assert.equal((await fetch(`${a.base}/nothing-here.html`)).status, 404);
  } finally { await a.stop(); }
});

test("a damaged saved file met during a save is ours (500), not the sender's mistake (400)", async () => {
  const { sentBadJson } = await import("../page-editor/limits.mjs");
  const bad = (() => { try { JSON.parse("{broken"); } catch (e) { return e; } })();
  assert.equal(sentBadJson({ method: "PUT", sentBody: Buffer.from('{"ok":1}') }, bad), false, "what was sent is fine: the broken JSON is a file on this computer");
  assert.equal(sentBadJson({ method: "PUT", sentBody: "{nope" }, bad), true, "what was sent is not JSON");
  assert.equal(sentBadJson({ method: "PUT", sentBody: Buffer.alloc(0) }, bad), true, "nothing was sent where JSON was wanted");
  assert.equal(sentBadJson({ method: "POST" }, bad), false, "nothing was read from the sender");
  assert.equal(sentBadJson({ method: "GET", sentBody: "{nope" }, bad), false);
  assert.equal(sentBadJson({ method: "PUT", sentBody: "{nope" }, new Error("disk full")), false, "not a JSON failure at all");
});

test("a new project with a reading direction nobody knows is refused, and nothing is made", async () => {
  const a = await startApp();
  try {
    const before = (await (await fetch(`${a.base}/api/projects`)).json()).length;
    const r = await fetch(`${a.base}/api/projects`, { method: "POST", body: JSON.stringify({ name: "Zed", script: "A line of script that is long enough to count as one, twice over.", reading: "sideways" }) });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /rtl \(right to left\) or ltr/);
    assert.equal((await (await fetch(`${a.base}/api/projects`)).json()).length, before);
  } finally { await a.stop(); }
});

test("Generate on a panel with no saved request says so at once, and queues nothing", async () => {
  const a = await startApp();
  try {
    makeProject(a, "t-ch01");
    let r = await fetch(`${a.base}/api/generate?p=t-ch01&panel=a1`, { method: "POST" }); // the chapter was never opened: nothing saved
    assert.equal(r.status, 400); assert.match((await r.json()).error, /no drawing request saved/);
    assert.equal((await fetch(`${a.base}/api/generate?p=nobody&panel=a1`, { method: "POST" })).status, 404);
    writeFileSync(join(a.saved, "t-ch01.json"), JSON.stringify({ pages: [{ id: "p1", layout: { rows: [{ panels: [{ id: "a1" }] }] } }] })); // saved, but nobody pressed Generate
    assert.equal((await fetch(`${a.base}/api/generate?p=t-ch01&panel=a1`, { method: "POST" })).status, 400);
    const work = await (await fetch(`${a.base}/api/work`)).json();
    assert.equal(work.running.length + work.waiting.length, 0);
  } finally { await a.stop(); }
});
