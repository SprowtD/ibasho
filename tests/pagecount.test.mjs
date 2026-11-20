// A chapter over 20 pages is advice only (X takes 20 pictures a post): never a fault, never sent back, nothing cut.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./harness.mjs";
const require = createRequire(import.meta.url);
require(join(REPO, "page-editor/render.js")); const R = globalThis.PageRender, Paneler = require(join(REPO, "core/paneler.js"));
const chapter = (n) => ({ kind: "storyboard", script: [], pages: Array.from({ length: n }, (_, i) => ({ id: "p" + i, number: i + 1, layout: { rows: [{ h: 1, panels: [{ id: "a" + i, w: 1, board: { who: [], lines: [] } }] }] } })) });

test("21 pages: one line of advice on the chapter, no script problem; 20 pages: nothing said", () => {
  const long = Paneler.check(chapter(21), R), fits = Paneler.check(chapter(20), R);
  assert.equal(long.chapter.length, 0);
  assert.equal(long.advice.filter((a) => /21 pages.*20 pictures a post.*replies/.test(a.msg)).length, 1);
  assert.equal(fits.advice.filter((a) => /pictures a post/.test(a.msg)).length, 0);
});
test("neither the Paneler's task nor the book check holds a chapter to 20 pages", () => {
  assert.doesNotMatch(readFileSync(join(REPO, "tools/paneler_task.mjs"), "utf8"), /never a 21st page|At most 20 PAGES/);
  assert.doesNotMatch(readFileSync(join(REPO, "tools/book_board.mjs"), "utf8"), /limit is 20/);
});
