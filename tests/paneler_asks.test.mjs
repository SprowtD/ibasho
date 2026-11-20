// What the Paneler may now ask for by itself: a lettered sound effect and a panel shape. And the check for a shape that crosses itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process"; import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO } from "./harness.mjs";
const require = createRequire(import.meta.url);
require(join(REPO, "page-editor/render.js")); const R = globalThis.PageRender, Paneler = require(join(REPO, "core/paneler.js")), Artist = require(join(REPO, "core/artist.js"));
const measureText = (font, s) => { const m = /(\d+(?:\.\d+)?)px/.exec(font); return String(s).length * (m ? +m[1] : 30) * 0.5; };
function built(change) {
  const dir = mkdtempSync(join(tmpdir(), "ibasho-asks-")); cpSync(join(REPO, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true });
  const f = join(dir, "board.json"), b = JSON.parse(readFileSync(f, "utf8")); change(b); writeFileSync(f, JSON.stringify(b));
  const out = JSON.parse(execFileSync("node", [join(REPO, "tools/build_spec.mjs"), dir], { encoding: "utf8", env: { ...process.env, STUDIO_SAVED: join(dir, "none") } }));
  const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8")); rmSync(dir, { recursive: true, force: true });
  return { out, spec };
}
const panels = (pg) => R.allPanels(pg.layout).map((c) => c.panel);

test("the Paneler's sound effect is kept on the panel and lettered by the Letterer: huge letters, inside its panel, off the faces and balloons", () => {
  const { out, spec } = built((b) => { b.pages[0].panels[0].sfx = "krak"; b.pages[1].panels[0].sfx = "a whole long sentence is not a sound"; b.pages[1].panels[1].sfx = "<b>Thud</b>"; });
  assert.equal(out.faults.length, 0, JSON.stringify(out.faults));
  const p1 = spec.pages[0], q = panels(p1)[0]; assert.equal(q.board.sfx, "KRAK");
  assert.deepEqual(panels(spec.pages[1]).map((x) => x.board.sfx || ""), ["", "BTHUD/B", ""].map((x, i) => (i === 1 ? panels(spec.pages[1])[1].board.sfx : x)), "a sentence is dropped");
  assert.doesNotMatch(panels(spec.pages[1])[1].board.sfx, /[<>]/, "markup is taken out");
  const items = R.autoPlace(p1, spec, [], measureText), fx = items.filter((it) => it.kind === "sfx");
  assert.equal(fx.length, 1); assert.equal(fx[0].text, "KRAK"); assert.equal(fx[0].panel, q.id); assert.equal(fx[0].from, "board");
  const c = R.allPanels(p1.layout)[0], L = R.measure(fx[0], spec, measureText), [ox, oy] = R.outer(L), cx = fx[0].at[0] * R.W, cy = fx[0].at[1] * R.H;
  assert.ok(cx - ox >= c.bbox[0] && cx + ox <= c.bbox[2] && cy - oy >= c.bbox[1] && cy + oy <= c.bbox[3], "the letters sit inside their panel");
  assert.ok(2 * ox > (c.bbox[2] - c.bbox[0]) * 0.3, "and are big: " + Math.round(2 * ox) + " of " + Math.round(c.bbox[2] - c.bbox[0]));
  const lines = items.filter((it) => it.kind !== "sfx"); assert.equal(lines.length, R.planFor(p1).length, "every script line is still lettered");
  for (const it of lines.filter((x) => x.panel === q.id)) { const M = R.measure(it, spec, measureText), [mx, my] = R.outer(M), bx = it.at[0] * R.W, by = it.at[1] * R.H;
    const ov = Math.max(0, Math.min(cx + ox, bx + mx) - Math.max(cx - ox, bx - mx)) * Math.max(0, Math.min(cy + oy, by + my) - Math.max(cy - oy, by - my)); assert.ok(ov < 4 * mx * my * 0.25, "the sound does not sit on the panel's balloon"); }
  // lettering the page twice gives one sound, not two; the Artist is told to leave room and draw no letters
  assert.equal(R.autoPlace({ ...p1, text: items }, spec, [], measureText).filter((it) => it.kind === "sfx").length, 1);
  const brief = Artist.panelBrief(p1, q.id, spec, { cast: {}, style: "", rules: [] }, R, measureText).prompt; assert.match(brief, /A sound effect \("KRAK"\) is lettered over this picture afterwards/);
  // the person had the Artist draw the sound instead: the Letterer adds none
  const drawn = JSON.parse(JSON.stringify(p1)); panels(drawn)[0].inart = { sfx: "KRAK" };
  assert.equal(R.autoPlace(drawn, spec, [], measureText).filter((it) => it.kind === "sfx").length, 0);
});
test("advice: one sound effect a page, and only where something happens", () => {
  const { spec } = built((b) => { b.pages[0].panels.forEach((q) => { q.sfx = "BAM"; }); });
  const said = (Paneler.check(spec, R).pages[spec.pages[0].id] || []).map((x) => x.msg).join(" | ");
  assert.match(said, /Advice: 4 lettered sound effects on this page/); assert.match(said, /nothing happens in it/);
});
test("the Paneler's panel shape is put on the panel; a tiny strip panel and an unknown shape are left plain", () => {
  const { out, spec } = built((b) => { b.pages[0].panels[0].shape = "jagged"; b.pages[1].panels[0].shape = "star-of-doom"; b.pages[3].panels[3].shape = "burst"; });
  assert.equal(out.faults.length, 0);
  const a = panels(spec.pages[0])[0]; assert.equal(a.board.shape, "jagged"); assert.deepEqual(a.shape, R.SHAPES.jagged.make());
  assert.ok(!panels(spec.pages[1])[0].shape && !panels(spec.pages[1])[0].board.shape, "an unknown shape is ignored");
  assert.deepEqual(panels(spec.pages[3])[3].shape, R.SHAPES.burst.make());
  assert.ok(R.allPanels(spec.pages[0].layout)[0].shaped, "the page draws it as a shaped panel");
  for (const k of Object.keys(R.SHAPES)) assert.equal(R.crossesItself(R.SHAPES[k].make()), false, k + " does not cross itself");
});
test("a shape that crosses itself is flagged on the page; a plain or hollowed one is not", () => {
  assert.equal(R.crossesItself([[0, 0], [1, 1], [1, 0], [0, 1]]), true, "a bow tie");
  assert.equal(R.crossesItself([[0, 0], [1, 0], [1, 1], [0, 1]]), false); assert.equal(R.crossesItself([[0, 0], [1, 0], [0.5, 0.4], [1, 1], [0, 1]]), false, "a notch is fine");
  assert.equal(R.crossesItself([[0, 0], [1, 0], [0.5, 1]]), false);
  const { spec } = built(() => {}); const pg = spec.pages[0]; panels(pg)[1].shape = [[0, 0], [1, 1], [1, 0], [0, 1]];
  const msgs = R.check(pg, [], []).map((x) => x.msg).join(" | "); assert.match(msgs, /Panel 2's shape crosses itself/);
  panels(pg)[1].shape = R.SHAPES.oval.make(); assert.doesNotMatch(R.check(pg, [], []).map((x) => x.msg).join(" | "), /crosses itself/);
});
