// After a restart: a picture a PAID model was already drawing is not sent again by itself (it may be paid for already);
// a waiting one, and one Codex was drawing, carry on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { copyApp, startApp, makeProject, codexCalls } from "./harness.mjs";

test("a paid picture that was being drawn when the app stopped is not sent a second time by itself", async () => {
  const copy = copyApp(), ID = "restart-ch01";
  makeProject(copy, ID, { spec: { boardAt: "t1", pages: [{ id: "p1", number: 1, text: [], layout: { rows: [{ panels: ["a1", "a2", "a3"].map((id) => ({ id, w: 1, board: { who: [], lines: [], action: "A wall." } })) }] } }] } });
  const req = (panel) => ({ prompt: "A wall.", size: [1024, 1024], refs: [] });
  writeFileSync(join(copy.saved, "queue.json"), JSON.stringify([
    { project: ID, panel: "a1", queued: 1, was: "drawing", model: "google/some-picture-model", boardAt: "t1", request: req("a1") },
    { project: ID, panel: "a2", queued: 2, was: "drawing", model: "codex", boardAt: "t1", request: req("a2") },
    { project: ID, panel: "a3", queued: 3, was: "waiting", boardAt: "t1", request: req("a3") }]));
  const app = await startApp(copy);
  try {
    let jobs = [], work = {};
    for (let i = 0; i < 100; i++) { jobs = await (await fetch(`${app.base}/api/jobs?p=${ID}`)).json(); if (jobs.length === 3 && /Carrying on/.test(app.out())) break; await new Promise((r) => setTimeout(r, 100)); }
    const a1 = jobs.find((j) => j.panel === "a1");
    assert.ok(a1 && a1.status === "failed" && /may be paid for already/.test(a1.msg) && !a1.resumed, "the paid one is set down with the reason, on its panel: " + JSON.stringify(a1));
    assert.deepEqual(jobs.filter((j) => j.resumed).map((j) => j.panel).sort(), ["a2", "a3"], "the Codex one and the waiting one carry on");
    assert.match(app.out(), /Carrying on with 2 jobs/);
  } finally { await app.stop(); }
});
