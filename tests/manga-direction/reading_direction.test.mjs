// Reading direction in the renderer: a right-to-left page is the exact mirror of the left-to-right one,
// reading order (the order of `panels`) does not change, and the Letterer's placement mirrors with it.
import { R, sample, SAMPLE, clone, measureText, mirrored, ok, near, done } from "./helpers.mjs";
const spec = sample(SAMPLE);
let cells = 0, balloons = 0, ties = 0;
for (const page of spec.pages) {
  if (!page.layout) continue;
  const ltr = page.layout.rtl ? mirrored(page) : clone(page), rtl = mirrored(ltr); // the fixture is right to left, an older sample left to right
  const A = R.layoutGeom(ltr.layout), B = R.layoutGeom(rtl.layout);
  ok(!A.rtl && B.rtl, "geometry says which way it reads");
  ok(A.cells.length === B.cells.length, "same number of panels");
  A.cells.forEach((c, i) => {
    const d = B.cells[i]; cells++;
    ok(c.panel.id === d.panel.id, `${page.id} panel ${i + 1}: reading order is unchanged`);
    near(c.bbox[0], R.W - d.bbox[2], `${page.id} panel ${i + 1} left edge mirrors`);
    near(c.bbox[2], R.W - d.bbox[0], `${page.id} panel ${i + 1} right edge mirrors`);
    near(c.bbox[1], d.bbox[1], `${page.id} panel ${i + 1} top is the same`);
    ok(d.poly.length !== 4 || (d.poly[0][0] <= d.poly[1][0] && d.poly[3][0] <= d.poly[2][0]), "corners stay top-left, top-right, bottom-right, bottom-left");
  });
  // the first panel of the first row sits on the right
  const first = B.cells[0], rowMates = B.cells.filter((c) => c.path.length === 0 && c.r === 0);
  ok(rowMates.every((c) => c.bbox[2] <= first.bbox[2] + 0.01), `${page.id}: the first panel is the rightmost of its row`);
  // gutter lines mirror, and the tilt knob keeps its height
  A.colLines.forEach((L, i) => { near(L.xc, R.W - B.colLines[i].xc, "column gutter mirrors"); near(L.p1[0], R.W - B.colLines[i].p1[0], "column gutter's lower end mirrors"); });
  A.rowLines.forEach((L, i) => { near(L.p1[1], B.rowLines[i].p1[1], "row gutter knob keeps its height"); near(L.p1[0], R.W - B.rowLines[i].p1[0], "row gutter knob changes side"); });
  // layoutBoxes mirrors too
  R.layoutBoxes(ltr.layout).forEach((b, i) => near(b.box[0], R.W - R.layoutBoxes(rtl.layout)[i].box[2], "row boxes mirror"));
  // the Letterer: same balloons, mirrored places, mirrored tails
  const pa = R.autoPlace(ltr, spec, {}, measureText), pb = R.autoPlace(rtl, spec, {}, measureText);
  ok(pa.length === pb.length, `${page.id}: same number of balloons both ways (${pa.length} vs ${pb.length})`);
  const cellOf = (id) => A.cells.find((c) => c.panel.id === id);
  let tie = false; // a face in the exact middle of its panel: left to right the old rule lets rounding pick the side, so those pages are not compared (the rule itself is unchanged for old chapters)
  for (const it of pa) { const c = cellOf(it.panel); if (!c) continue; for (const hd of R.boardHeads(c)) if (hd.who === it.speaker && Math.abs((hd.box[0] - c.bbox[0]) - (c.bbox[2] - hd.box[2])) < 0.5) tie = true; }
  if (tie) ties++;
  pa.forEach((it, i) => {
    const o = pb[i]; if (!o || tie) return; balloons++;
    ok(it.text === o.text && it.panel === o.panel, "same words in the same panel");
    near(it.at[0], 1 - o.at[0], `${page.id} balloon ${i + 1} mirrors across`, 0.0021);
    near(it.at[1], o.at[1], `${page.id} balloon ${i + 1} keeps its height`, 0.0011);
    if (it.tail && o.tail) near(it.tail[0], 1 - o.tail[0], "tail mirrors", 0.0021);
  });
  // placed right to left, nothing is out of reading order by the page check
  const Ls = pb.map((it) => R.measure(it, spec, measureText));
  const late = R.check(rtl, Ls, []).filter((c) => /reading order/.test(c.msg));
  ok(late.length === 0, `${page.id}: automatic placement passes the reading-order check right to left (${late.length} flagged)`);
  const Ls2 = pa.map((it) => R.measure(it, spec, measureText));
  ok(R.check(ltr, Ls2, []).filter((c) => /reading order/.test(c.msg)).length === 0, `${page.id}: and left to right`);
}
// a hand-made case: two balloons level in one panel
{
  const page = { id: "t", layout: { rows: [{ h: 1, panels: [{ w: 1, id: "a" }] }] }, text: [] };
  const mk = (x) => R.measure({ kind: "speech", text: "Hello there", at: [x, 0.3], panel: "a", join: true }, spec, measureText);
  const order = (p, xs) => R.check(p, xs.map(mk), []).filter((c) => /reading order/.test(c.msg)).length;
  ok(order(page, [0.3, 0.7]) === 0 && order(page, [0.7, 0.3]) === 1, "left to right: the second balloon belongs on the right");
  page.layout.rtl = true;
  ok(order(page, [0.7, 0.3]) === 0 && order(page, [0.3, 0.7]) === 1, "right to left: the second balloon belongs on the left");
}
// insets keep their place
{
  const lay = { rtl: true, rows: [{ h: 1, panels: [{ w: 1, id: "a" }, { w: 2, id: "b" }] }], insets: [{ id: "i", box: [0.1, 0.1, 0.3, 0.3] }] };
  const G = R.layoutGeom(lay);
  near(G.insets[0].poly[0][0], 100, "an inset is not mirrored");
  ok(G.cells[0].bbox[0] > G.cells[1].bbox[2], "panel 1 (the narrow one) is on the right");
  near(G.cells[0].bbox[2], R.W - R.MARGIN, "and touches the right margin");
}
console.log(`  ${cells} panels and ${balloons} balloons compared; ${ties} pages with a dead-centre face left out of the balloon comparison`);
done("reading direction: renderer");
