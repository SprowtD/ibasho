// A drawing request is kept with its job on the server. Another tab saving the chapter from a copy without the request used to wipe
// it ("that panel has no request waiting", 65 of 68 pictures one night). Also: a real Cancel, and no old request on a new storyboard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { startApp, makeProject, codexCalls } from "./harness.mjs";

const page = (reqs) => ({ pages: [{ id: "p1", number: 1, layout: { rows: [{ h: 1, panels: ["a1", "a2"].map((id) => ({ id, w: 0.5, board: { who: [], lines: [] }, ...(reqs[id] ? { request: { source: "codex", mode: "custom", status: "queued", prompt: reqs[id], size: [1024, 1024], refList: [] } } : {}) })) }] } }] });
const spec = { project: "Test", chapter: 1, kind: "storyboard", ...page({}) };
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } throw new Error("timed out"); };
const jobsOf = async (a) => (await fetch(`${a.base}/api/jobs?p=t-ch01`)).json();
const prompts = (dir) => { const d = join(dir, "art", "panels"); return existsSync(d) ? readdirSync(d).filter((n) => n.endsWith(".prompt.txt")).map((n) => readFileSync(join(d, n), "utf8")) : []; };

test("a save from a tab that never had the request does not wipe it: the waiting picture is still drawn as asked", async () => {
  const a = await startApp(undefined, { env: { STUDIO_DRAWERS: "1", FAKE_CODEX_SLEEP: "1200" } });
  try {
    const dir = makeProject(a, "t-ch01", { spec });
    const put = async (reqs) => assert.equal((await fetch(`${a.base}/api/spec?p=t-ch01`, { method: "PUT", body: JSON.stringify({ ...spec, ...page(reqs) }) })).status, 200);
    await put({ a1: "FIRST PICTURE: a red kite.", a2: "SECOND PICTURE: a blue boat." });
    for (const id of ["a1", "a2"]) { const r = await fetch(`${a.base}/api/generate?p=t-ch01&panel=${id}`, { method: "POST" }); assert.equal(r.status, 200); assert.equal((await r.json()).request, undefined, "the kept request is not sent back to the browser"); }
    await put({}); // the other tab saves its copy: no requests in it
    await until(async () => { const js = await jobsOf(a); return js.length === 2 && js.every((j) => j.status === "failed" || j.status === "done"); });
    const js = await jobsOf(a);
    for (const j of js) assert.doesNotMatch(j.msg || "", /no request waiting/, j.panel + ": " + j.msg); // the stand-in Codex saves no picture: that is the only failure
    assert.deepEqual(prompts(dir).sort(), ["FIRST PICTURE: a red kite.", "SECOND PICTURE: a blue boat."]);
    assert.equal(codexCalls(a).length, 2);
    assert.deepEqual(existsSync(join(a.saved, "jobs")) ? readdirSync(join(a.saved, "jobs")) : [], [], "no work file is left behind");
  } finally { await a.stop(); }
});

test("Cancel takes a waiting picture out of the line; one being drawn cannot be stopped", async () => {
  const a = await startApp(undefined, { env: { STUDIO_DRAWERS: "1", FAKE_CODEX_SLEEP: "1500" } });
  try {
    const dir = makeProject(a, "t-ch01", { spec });
    await fetch(`${a.base}/api/spec?p=t-ch01`, { method: "PUT", body: JSON.stringify({ ...spec, ...page({ a1: "ONE.", a2: "TWO." }) }) });
    for (const id of ["a1", "a2"]) await fetch(`${a.base}/api/generate?p=t-ch01&panel=${id}`, { method: "POST" });
    await until(async () => (await jobsOf(a)).some((j) => j.panel === "a1" && j.status === "drawing"));
    assert.equal((await fetch(`${a.base}/api/generate?p=t-ch01&panel=a1`, { method: "DELETE" })).status, 409);
    assert.deepEqual(await (await fetch(`${a.base}/api/generate?p=t-ch01&panel=a2`, { method: "DELETE" })).json(), { cancelled: true });
    await until(async () => { const js = await jobsOf(a); return js.length === 1 && js[0].status !== "drawing" && js[0].status !== "waiting"; });
    assert.deepEqual(prompts(dir), ["ONE."]); assert.equal(codexCalls(a).length, 1);
  } finally { await a.stop(); }
});

test("a picture asked for on the old storyboard is not drawn onto the new one", async () => {
  const a = await startApp(undefined, { env: { STUDIO_DRAWERS: "1", FAKE_CODEX_SLEEP: "1200" } });
  try {
    const old = { ...spec, boardAt: "2026-11-19T01:00:00.000Z" }, dir = makeProject(a, "t-ch01", { spec: old });
    await fetch(`${a.base}/api/spec?p=t-ch01`, { method: "PUT", body: JSON.stringify({ ...old, ...page({ a1: "ONE.", a2: "TWO." }) }) });
    for (const id of ["a1", "a2"]) await fetch(`${a.base}/api/generate?p=t-ch01&panel=${id}`, { method: "POST" });
    writeFileSync(join(dir, "spec.json"), JSON.stringify({ ...old, boardAt: "2026-11-19T02:00:00.000Z" })); // storyboarded again while a2 waits
    await until(async () => { const js = await jobsOf(a); return js.length === 2 && js.every((j) => j.status === "failed" || j.status === "done"); });
    const a2 = (await jobsOf(a)).find((j) => j.panel === "a2");
    assert.match(a2.msg, /storyboarded again/); assert.ok(codexCalls(a).length <= 1, "the waiting picture never reached Codex");
  } finally { await a.stop(); }
});
