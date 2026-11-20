// Custom panel styles, part 1: layouts with a strip of tiny panels, and a person's own saved layouts.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, startApp } from "./harness.mjs";
const require = createRequire(import.meta.url);
require(join(REPO, "page-editor/render.js")); const R = globalThis.PageRender, D = require(join(REPO, "core/director.js")), Paneler = require(join(REPO, "core/paneler.js"));
const T = JSON.parse(readFileSync(join(REPO, "page-editor/templates.json"), "utf8"));
const panels = (ws) => ws.map((w, i) => ({ id: "p" + i, board: { weight: w, who: [], lines: [] } }));
const page = (ws) => ({ kind: "storyboard", script: [], pages: [{ id: "p1", number: 1, note: "n", layout: { rows: D.layout(panels(ws), T, R, {}).rows } }] });

test("a run of 3 to 5 tiny beats is laid out as one thin strip; a page without one never gets a strip", () => {
  for (const ws of [[5, 1, 1, 1], [5, 1, 1, 1, 1], [3, 1, 1, 1, 4], [4, 2, 1, 1, 1, 3, 2], [2, 2, 1, 1, 1, 1, 1, 4]]) {
    const got = D.layout(panels(ws), T, R, {}), strip = got.rows.find((r) => r.strip), n = ws.filter((w) => w === 1).length;
    assert.match(got.code, /^T/, ws.join("") + " -> " + got.code); assert.equal(strip.panels.length, n);
    assert.ok(strip.h <= 0.2, "the strip stays thin: " + strip.h);
    let i = 0; for (const r of got.rows) for (const q of r.panels) { assert.equal(q.id, "p" + i); assert.equal(!!r.strip, ws[i] === 1, "only the tiny beats are in the strip"); i++; } // reading order kept
    const rt = D.rate(got.rows, R), big = Math.max(...rt.shares); assert.ok(rt.shares.every((s, k) => ws[k] !== 1 || s < big / 4), "strip panels are much smaller than the big one");
  }
  for (const ws of [[5, 2, 2, 2, 2], [3, 2, 3, 2, 4], [4, 1, 1, 3], [2, 3, 4]]) assert.doesNotMatch(D.layout(panels(ws), T, R, {}).code, /^T/, ws.join(""));
});
test("a strip counts as one panel toward the six a page; eight is still the most", () => {
  assert.equal(D.counted(panels([4, 2, 1, 1, 1, 3, 2])), 5); assert.equal(D.counted(panels([1, 1, 3])), 3); assert.equal(D.counted(panels([1, 1, 1, 1, 1, 1, 3])), 7);
  const errs = (ws) => Paneler.check(page(ws), R).pages.p1.filter((x) => x.level === "error" && /panels \(max/.test(x.msg));
  assert.equal(errs([4, 2, 1, 1, 1, 3, 2]).length, 0, "seven panels with a strip of three pass");
  assert.equal(errs([3, 2, 3, 2, 4, 2, 3]).length, 1, "seven ordinary panels do not");
  assert.equal(errs([4, 1, 1, 1, 1, 1, 2, 3, 2]).length, 1, "nine panels never pass");
});
test("every strip layout is a real layout: thin strip, 3 to 5 in it, nothing a sliver", () => {
  const strips = T.filter((t) => t.rows.some((r) => r.strip)); assert.ok(strips.length >= 15);
  assert.equal(new Set(T.map((t) => t.code)).size, T.length, "no code is used twice");
  for (const t of strips) { const rt = D.rate(t.rows, R); assert.ok(rt.aspect.every((a) => a > 0.42 && a < 3.4), t.code); assert.ok(t.rows.filter((r) => r.strip).every((r) => r.panels.length >= 3 && r.panels.length <= 5 && r.h <= 0.2), t.code); }
  assert.match(readFileSync(join(REPO, "tools/paneler_task.mjs"), "utf8"), /A TINY STRIP/);
});

let app; before(async () => { app = await startApp(); }); after(async () => { await app.stop(); });
const call = async (method, q = "", body) => { const r = await fetch(app.base + "/api/layouts" + q, { method, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json() }; };
test("your own layouts: saved with only the build kept, numbered, listed, removed", async () => {
  assert.deepEqual((await call("GET")).j, { layouts: [] });
  const rows = [{ h: 2, slant: 0.04, panels: [{ w: 1, id: "x1", image: "art/a.png", board: { action: "secret" }, type: "bleed" }] }, { h: 1, strip: true, panels: [{ w: 1 }, { w: 1, rows: [{ h: 1, panels: [{ w: 1 }] }] }, { w: 2, shape: [[0, 0], [1, 0.1], [0.9, 1], [0, 1]] }] }];
  const a = await call("POST", "", { name: "  My action page  ", rows }); assert.equal(a.status, 200); assert.equal(a.j.code, "MY-01");
  const saved = a.j.layouts[0]; assert.equal(saved.name, "My action page");
  assert.deepEqual(saved.rows, [{ h: 2, slant: 0.04, panels: [{ w: 1, type: "bleed" }] }, { h: 1, strip: true, panels: [{ w: 1 }, { w: 1, rows: [{ h: 1, panels: [{ w: 1 }] }] }, { w: 2, shape: [[0, 0], [1, 0.1], [0.9, 1], [0, 1]] }] }]);
  assert.doesNotMatch(JSON.stringify(saved), /secret|art\/a|x1/, "no picture, storyboard or id is kept");
  assert.equal((await call("POST", "", { rows })).j.code, "MY-02");
  assert.equal((await call("DELETE", "?code=MY-01")).j.layouts.length, 1);
  assert.equal((await call("POST", "", { rows })).j.code, "MY-03", "a removed number is not used again while a later one exists");
  assert.deepEqual((await call("GET")).j.layouts.map((t) => t.code), ["MY-02", "MY-03"]);
});
test("something that is not a layout is refused", async () => {
  for (const rows of [null, [], [{ h: 1 }], [{ h: 1, panels: [] }], [{ h: 1, panels: Array(7).fill({ w: 1 }) }], Array(3).fill({ h: 1, panels: Array(5).fill({ w: 1 }) })]) assert.equal((await call("POST", "", { rows })).status, 400, JSON.stringify(rows).slice(0, 60));
});
