// Custom panel styles, part 4: a panel's own shape (corners placed by hand), ready-made shapes, and free-shape panels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { REPO } from "./harness.mjs";
const require = createRequire(import.meta.url);
require(join(REPO, "page-editor/render.js")); const R = globalThis.PageRender, D = require(join(REPO, "core/director.js"));
const rows = (shape) => [{ h: 1, panels: [{ w: 1, id: "a", ...(shape ? { shape } : {}) }, { w: 1, id: "b" }] }, { h: 1, panels: [{ w: 1, id: "c" }] }];
const cell = (layout, id) => R.allPanels(layout).find((c) => c.panel.id === id);

test("a shape's corners are shares of the plain panel's box, and may reach outside it", () => {
  const plain = cell({ rows: rows() }, "a"), [x0, y0, x1, y1] = plain.bbox, w = x1 - x0, h = y1 - y0;
  const c = cell({ rows: rows([[0, 0], [1.2, 0.1], [1, 1], [0.5, 1.15], [0, 1]]) }, "a");
  assert.equal(c.shaped, true); assert.deepEqual(c.frame, plain.bbox); assert.equal(c.drawPoly.length, 5);
  assert.deepEqual(c.drawPoly[1].map(Math.round), [Math.round(x0 + 1.2 * w), Math.round(y0 + 0.1 * h)]);
  assert.ok(c.bbox[2] > x1 && c.bbox[3] > y1, "its box grows with it: balloons and art follow the real shape");
  assert.deepEqual(cell({ rows: rows([[0, 0], [1.2, 0.1], [1, 1], [0, 1]]) }, "b").bbox, cell({ rows: rows() }, "b").bbox, "its neighbour keeps its place");
  for (const bad of [[[0, 0], [1, 1]], "oval", [[0, 0], [1, 0], [1, "x"]], [[0, 0], [1, 0], [NaN, 1]]]) assert.equal(!!cell({ rows: rows(bad) }, "a").shaped, false, "not a shape: " + JSON.stringify(bad));
  const far = cell({ rows: rows([[-9, -9], [9, 0], [9, 9]]) }, "a"); assert.ok(far.bbox[0] >= 0 && far.bbox[2] <= R.W && far.bbox[1] >= 0 && far.bbox[3] <= R.H, "never off the page");
});
test("on a right-to-left page a shaped panel is mirrored with the page", () => {
  const shape = [[0, 0], [1, 0], [0.7, 1], [0, 1]]; // cut away at the bottom, on the far side from where reading starts
  const ltr = cell({ rows: rows(shape) }, "a"), rtl = cell({ rows: rows(shape), rtl: true }, "a");
  const mirror = ltr.drawPoly.map(([x, y]) => [R.W - x, y]);
  assert.deepEqual(rtl.drawPoly.map((p) => p.map(Math.round)), mirror.map((p) => p.map(Math.round)));
});
test("a shaped panel is drawn after the plain ones, with a white gutter of its own, clipped to its shape", () => {
  const svg = R.layoutSvg({ layout: { rows: rows(R.SHAPES.burst.make()) } }, (s) => s, {});
  const polys = [...svg.matchAll(/<polygon points="([^"]+)" fill="none" stroke="#000"/g)].map((m) => m[1].split(" ").length);
  assert.deepEqual(polys, [4, 4, 28], "the burst's border is drawn last");
  assert.equal((svg.match(/stroke="#fff"/g) || []).length, 1);
});
test("the ready-made shapes are real shapes, the same every time", () => {
  assert.deepEqual(Object.keys(R.SHAPES), ["slant", "jagged", "burst", "oval"]);
  for (const [k, s] of Object.entries(R.SHAPES)) { const a = s.make(); assert.ok(R.validShape(a), k); assert.deepEqual(a, s.make(), k + " is the same on every screen");
    assert.ok(a.every(([u, v]) => u >= -0.1 && u <= 1.1 && v >= -0.1 && v <= 1.1), k + " stays about in its box");
    const c = cell({ rows: rows(a) }, "a"), area = D.area(c.poly), box = (c.frame[2] - c.frame[0]) * (c.frame[3] - c.frame[1]); assert.ok(area > box * 0.55 && area < box * 1.15, `${k} keeps most of its panel (${(area / box).toFixed(2)})`); }
});
test("a layout's shape belongs to its place: the panel put there takes it, and loses the one it had", () => {
  const tmpl = [{ code: "MY-01", name: "mine", rows: [{ h: 2, panels: [{ w: 1, shape: R.SHAPES.jagged.make() }] }, { h: 1, panels: [{ w: 1 }, { w: 1 }] }] }];
  const got = D.layout([{ id: "x", board: { weight: 5 }, shape: R.SHAPES.oval.make() }, { id: "y", board: { weight: 2 }, shape: R.SHAPES.oval.make() }, { id: "z", board: { weight: 2 } }], tmpl, R, {});
  const flat = got.rows.flatMap((r) => r.panels);
  assert.deepEqual(flat[0].shape, R.SHAPES.jagged.make()); assert.equal(flat[1].shape, undefined); assert.equal(flat[2].shape, undefined); assert.deepEqual(flat.map((q) => q.id), ["x", "y", "z"]);
});
