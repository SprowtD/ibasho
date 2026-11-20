// Custom panel styles, part 2: sound effects as huge letters, and a balloon that bridges two panels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { REPO } from "./harness.mjs";
const require = createRequire(import.meta.url);
require(join(REPO, "page-editor/render.js")); const R = globalThis.PageRender;
const measureText = (font, s) => { const m = /(\d+(?:\.\d+)?)px/.exec(font); return String(s).length * (m ? +m[1] : 30) * 0.5; };
const spec = { voices: {}, styles: {} };
const page = (rows, text, rtl) => ({ id: "p1", number: 1, layout: { ...(rtl ? { rtl: true } : {}), rows }, text });
const stacked = [{ h: 1, panels: [{ w: 1, id: "a", board: { who: [], lines: [] } }] }, { h: 1, panels: [{ w: 1, id: "b", board: { who: [], lines: [] } }, { w: 1, id: "c", board: { who: [], lines: [] } }] }];
const M = (p) => p.text.map((it) => R.measure(it, spec, measureText)), msgs = (p) => R.check(p, M(p), []).map((x) => x.msg);

test("a sound effect is huge letters with no balloon, edged so it reads over a picture", () => {
  const it = { kind: "sfx", text: "krak", at: [0.5, 0.25], panel: "a" }, L = R.measure(it, spec, measureText);
  assert.equal(L.st.shape, "none"); assert.ok(L.size >= 100, "big: " + L.size); assert.equal(L.rotate, -8);
  const svg = R.letteringSvg([L]);
  assert.match(svg, />KRAK</); assert.doesNotMatch(svg, /<polygon|<ellipse|<rect/, "no balloon is drawn");
  assert.match(svg, /fill="#000" stroke="#fff"/); assert.match(svg, /rotate\(-8 /);
  assert.match(R.letteringSvg([R.measure({ ...it, hollow: true }, spec, measureText)]), /fill="#fff" stroke="#000"/);
  assert.ok(R.measure({ ...it, size: 3 }, spec, measureText).size >= 300, "it can be made to run across a panel");
});
test("a sound effect may cross borders and run behind a balloon, and is not counted as words or read in turn", () => {
  const sfx = { kind: "sfx", text: "BOOM", at: [0.5, 0.5], size: 2.5, panel: "a" }, said = { kind: "speech", speaker: "Kai", text: "Down!", at: [0.5, 0.47], tail: [0.5, 0.56], panel: "a" };
  const m = msgs(page(stacked, [said, sfx]));
  assert.ok(!m.some((x) => /Spills out|Overlaps|Out of reading order|No tail|words on this page/.test(x)), m.join(" | "));
  const many = Array.from({ length: 5 }, () => ({ kind: "sfx", text: "ratatatatat ratatatatat ratatat", at: [0.5, 0.2], panel: "a" }));
  assert.ok(!msgs(page(stacked, many)).some((x) => /words on this page/.test(x)), "sound effects never use up the page's words");
  assert.ok(msgs(page(stacked, [{ kind: "sfx", text: "the door slams shut very loudly", at: [0.5, 0.2], panel: "a" }])).some((x) => /words in a sound effect/.test(x)), "a sentence is not a sound");
  assert.ok(R.check(page(stacked, [sfx]), M(page(stacked, [sfx])), [[0.4, 0.4, 0.6, 0.6]]).some((x) => /Covers a face/.test(x.msg)), "it still must not cover a face");
});
test("a bridging balloon sits on the border to the next panel in reading order", () => {
  const p = page(stacked, []), cells = R.allPanels(p.layout), box = (id) => cells.find((c) => c.panel.id === id).bbox;
  const a = box("a"), b = box("b"), c = box("c");
  const ab = R.bridgeSpot(p, { panel: "a", at: [0.3, 0.2] }); // a is above b: onto the row border, over both
  assert.ok(ab[1] > a[3] - 1 && ab[1] < b[1] + 1 && ab[0] > Math.max(a[0], b[0]) && ab[0] < Math.min(a[2], b[2]), JSON.stringify(ab));
  const bc = R.bridgeSpot(p, { panel: "b", at: [0.3, 0.8] }); // b beside c: onto the upright border, at the balloon's own height
  assert.ok(bc[0] > b[2] - 1 && bc[0] < c[0] + 1 && Math.abs(bc[1] - 0.8 * R.H) < 1, JSON.stringify(bc));
  assert.equal(R.bridgeSpot(p, { panel: "c", at: [0.7, 0.8] }), null, "the page's last panel has no next panel");
  const r = page(stacked, [], true), rc = R.allPanels(r.layout); assert.equal(rc[1].panel.id, "b"); assert.ok(rc[1].bbox[0] > rc[2].bbox[0], "right to left: b is drawn on the right");
  const rb = R.bridgeSpot(r, { panel: "b", at: [0.7, 0.8] }); assert.ok(rb[0] > rc[2].bbox[2] - 1 && rb[0] < rc[1].bbox[0] + 1, "and its bridge is on the border to c, on its left");
});
test("checks: a bridge on the border passes; a bridge left inside one panel is flagged", () => {
  const p = page(stacked, []), spot = R.bridgeSpot(p, { panel: "a", at: [0.5, 0.3] });
  const on = { kind: "speech", speaker: "Kai", text: "And then", at: [spot[0] / R.W, spot[1] / R.H], tail: [0.5, 0.4], panel: "a", bridge: true, bleed: true };
  assert.ok(!msgs(page(stacked, [on])).some((x) => /Spills out|bridging balloon/.test(x)), msgs(page(stacked, [on])).join(" | "));
  assert.ok(msgs(page(stacked, [{ ...on, at: [0.5, 0.2] }])).some((x) => /bridging balloon belongs across the border/.test(x)));
});
test("the Letterer puts a line marked bridge on the border, and leaves it in its panel when a face is in the way", () => {
  const rows = (who) => [{ h: 1, panels: [{ w: 1, id: "a", board: { who: [{ name: "Kai", at: [0.5, 0.35], size: "medium", facing: "right" }], lines: [{ source_id: "L1", speaker: "Kai", kind: "speech", text: "I told you", bridge: true }] } }] },
    { h: 1, panels: [{ w: 1, id: "b", board: { who, lines: [{ source_id: "L2", speaker: "Kai", kind: "speech", text: "it would rain." }] } }] }];
  const p = page(rows([{ name: "Kai", at: [0.5, 0.6], size: "medium", facing: "left" }]), []), items = R.autoPlace(p, spec, {}, measureText);
  assert.equal(items.length, 2); assert.equal(items[0].bridge, true); assert.equal(items[0].bleed, true);
  const cells = R.allPanels(p.layout), y = items[0].at[1] * R.H; assert.ok(y > cells[0].bbox[3] - 1 && y < cells[1].bbox[1] + 1, "on the border: " + y);
  p.text = items; assert.ok(!msgs(p).some((x) => /bridging|Overlaps|Covers a face/.test(x)), msgs(p).join(" | "));
  const blocked = page(rows([{ name: "Kai", at: [0.5, 0.02], size: "close", facing: "left" }, { name: "Aya", at: [0.15, 0.02], size: "close", facing: "right" }, { name: "Jun", at: [0.85, 0.02], size: "close", facing: "left" }]), []), got = R.autoPlace(blocked, spec, {}, measureText);
  assert.ok(!got[0].bridge, "faces along the border: the balloon stays in its own panel");
});
