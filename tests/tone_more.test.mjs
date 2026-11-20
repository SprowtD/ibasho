// The Toner on what is not a plain panel: a break-out (a cut-out figure above the panel borders) and a page that is one whole picture.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { REPO, copyApp, startApp, makeProject } from "./harness.mjs";
const require = createRequire(import.meta.url);
require(join(REPO, "page-editor/render.js")); const R = globalThis.PageRender;
const py = (code, ...a) => execFileSync("/usr/bin/python3", ["-c", code, ...a]).toString().trim();
const GREYS = "import sys\nfrom PIL import Image, ImageDraw\nim=Image.new('L',(900,640),255); d=ImageDraw.Draw(im)\nd.rectangle([60,60,420,560],fill=204,outline=0,width=5)\nd.ellipse([520,120,820,420],fill=153,outline=0,width=6)\nim.save(sys.argv[1])";
// a cut-out: a grey figure with a black outline, clear all round it, wider on its left side so a flip can be seen
const CUTOUT = "import sys\nfrom PIL import Image, ImageDraw\nim=Image.new('RGBA',(600,900),(0,0,0,0)); d=ImageDraw.Draw(im)\nd.ellipse([150,60,450,360],fill=(204,204,204,255),outline=(0,0,0,255),width=8)\nd.rectangle([60,360,450,860],fill=(204,204,204,255),outline=(0,0,0,255),width=8)\nim.save(sys.argv[1])";
const WHOLE = "import sys\nfrom PIL import Image, ImageDraw\nim=Image.new('L',(1024,1536),255); d=ImageDraw.Draw(im)\nd.rectangle([100,100,900,700],fill=204,outline=0,width=6)\nd.ellipse([200,800,800,1400],fill=128,outline=0,width=6)\nim.save(sys.argv[1])";

let app, copy, dir; const ID = "tonemore-ch01";
const bo = { id: "bo1", box: [0.3, 0.2, 0.7, 0.8], image: "art/breakouts/bo1-take01.png", who: "Kai", action: "stands" };
const spec = { project: "Test", chapter: 1, kind: "storyboard", boardAt: "t1", pages: [
  { id: "pg1", number: 1, text: [], layout: { rows: [{ h: 1, panels: [{ id: "a1", w: 1, image: "art/a1.png", board: { who: [], lines: [] } }] }, { h: 1, panels: [{ id: "a2", w: 1, board: { who: [], lines: [] } }] }], breakouts: [bo, { id: "bo2", box: [0.1, 0.1, 0.2, 0.2], who: "Aya", action: "not drawn yet" }] } },
  { id: "pg2", number: 2, text: [], art: "art/whole.png" }] };
before(async () => {
  copy = copyApp(); dir = makeProject(copy, ID, { spec, bible: { style: "Loose ink manga.", cast: {}, rules: [] } });
  execFileSync("mkdir", ["-p", join(dir, "art", "breakouts")]);
  py(GREYS, join(dir, "art", "a1.png")); py(CUTOUT, join(dir, bo.image)); py(WHOLE, join(dir, "art", "whole.png"));
  app = await startApp(copy);
});
after(async () => { await app.stop(); });
const api = async (path, method = "GET", body) => { const r = await fetch(app.base + path, { method, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json() }; };
const toned = async (want) => { let s = {}; for (let i = 0; i < 300; i++) { s = (await api(`/api/tone?p=${ID}`)).j; if (want(s)) return s; await new Promise((r) => setTimeout(r, 200)); } return s; };
const STATS = "import sys,json\nfrom PIL import Image\nimport numpy as np\nim=Image.open(sys.argv[1]); a=np.asarray(im.convert('LA')).astype(float)\nL,A=a[...,0],a[...,1]\nin_=A>250\nmid=((L>40)&(L<215)&in_).sum()/max(in_.sum(),1)\nh,w=L.shape\nleft=(A[:, :w//2]>128).sum(); right=(A[:, w//2:]>128).sum()\nprint(json.dumps({'mode':im.mode,'size':im.size,'corner':float(A[2,2]),'covered':float(in_.mean()),'mid':float(mid),'dark':float(((L<40)&in_).sum()/max(in_.sum(),1)),'left':int(left),'right':int(right)}))";

test("a break-out is toned with its page: dots on the page's grid, still a cut-out, at its place and final size", async () => {
  await api(`/api/tone?p=${ID}&page=pg1`, "POST");
  const s = await toned((x) => x.pg1 && x.pg1.panels.length === 2);
  assert.deepEqual(s.pg1.panels.map((p) => [p.id, p.kind || "panel"]), [["a1", "panel"], ["bo1", "breakout"]], "the drawn panel and the drawn break-out; the break-out with no picture is left alone");
  const t = s.pg1.panels[1], k = 2048 / R.W;
  assert.deepEqual(t.box, [0.3 * R.W, 0.2 * R.H, 0.7 * R.W, 0.8 * R.H].map((v) => Math.round(v * k))); assert.equal(t.of, bo.image); assert.equal(t.flip, false);
  assert.ok(t.layers.some((n) => /^break-out 1, dots 60 lines/.test(n)), "its greys became dot layers: " + t.layers.join("; "));
  const st = JSON.parse(py(STATS, join(dir, t.src)));
  assert.equal(st.mode, "LA"); assert.deepEqual(st.size, [t.box[2] - t.box[0], t.box[3] - t.box[1]]); assert.equal(st.corner, 0, "clear outside the figure");
  assert.ok(st.covered > 0.2 && st.mid < 0.3 && st.dark > 0.1, "inside the figure it is black dots on white, no flat grey left: " + JSON.stringify(st));
  assert.ok(st.left > st.right * 1.05, "not flipped: the figure's wide side is on the left");
  // on the page: the toned picture is used while the break-out is where it was toned, with no flip of its own
  const { id, kind, ...keep } = t, b = { ...bo, toned: keep }, page = { ...spec.pages[0], layout: { ...spec.pages[0].layout, breakouts: [b] } };
  assert.equal(R.breakoutTone(b), "toned"); assert.ok(R.breakoutsSvg(page, (x) => x).includes(t.src)); assert.ok(R.pictures(page).includes(t.src) && !R.pictures(page).includes(bo.image));
  for (const moved of [{ ...b, box: [0.31, 0.2, 0.71, 0.8] }, { ...b, flip: true }, { ...b, image: "art/breakouts/bo1-take02.png" }]) {
    assert.equal(R.breakoutTone(moved), "stale"); assert.ok(!R.breakoutsSvg({ ...page, layout: { ...page.layout, breakouts: [moved] } }, (x) => x).includes(t.src), "moved, flipped or drawn again: the plain picture shows");
  }
  const said = (pg) => R.check(pg, [], []).map((x) => x.msg).join(" | ");
  assert.match(said({ ...page, layout: { ...page.layout, breakouts: [{ ...b, flip: true }] } }), /Break-out 1 has changed since it was toned/);
});
test("a flipped break-out is toned turned round, so its dots still sit on the page's grid", async () => {
  const sv = JSON.parse(JSON.stringify(spec)); sv.pages[0].layout.breakouts[0].flip = true;
  assert.equal((await fetch(app.base + `/api/spec?p=${ID}`, { method: "PUT", body: JSON.stringify(sv) })).status, 200);
  await api(`/api/tone?p=${ID}&page=pg1&panel=bo1`, "POST");
  const s = await toned((x) => x.pg1 && x.pg1.panels.some((p) => p.id === "bo1" && p.flip));
  const t = s.pg1.panels.find((p) => p.id === "bo1"); assert.equal(s.pg1.panels.length, 2, "toning one again keeps the other");
  const st = JSON.parse(py(STATS, join(dir, t.src))); assert.ok(st.right > st.left * 1.05, "the wide side is now on the right: " + JSON.stringify(st));
});
test("a page that is one whole picture is toned as one", async () => {
  await api(`/api/tone?p=${ID}&page=pg2`, "POST");
  const s = await toned((x) => x.pg2 && x.pg2.panels.length === 1), t = s.pg2.panels[0];
  assert.equal(t.kind, "page"); assert.deepEqual(t.box, [0, 0, 2048, 3072]); assert.equal(t.of, "art/whole.png");
  assert.ok(t.layers.some((n) => /^the page, dots 60 lines 20%/.test(n)) && t.layers.some((n) => /50%/.test(n)), t.layers.join("; "));
  const st = JSON.parse(py(STATS, join(dir, t.src))); assert.deepEqual(st.size, [2048, 3072]); assert.ok(st.mid < 0.3 && st.dark > 0.05, "dots, not grey: " + JSON.stringify(st));
  const { id, kind, ...keep } = t, pg = { ...spec.pages[1], toned: keep };
  assert.equal(R.pageTone(pg), "toned"); assert.equal(R.pageArt(pg), t.src); assert.deepEqual(R.pictures(pg), [t.src]);
  assert.equal(R.pageArt({ ...pg, art: "art/other.png" }), "art/other.png", "a new picture shows plain until it is toned");
});
test("the exported pages are measured for moire: a second set of dots over the first is found, a clean page is not", async () => {
  const MK = `import sys\nsys.path.insert(0, ${JSON.stringify(join(REPO, "tools"))})\nimport toner, numpy as np\nst=toner.settings(); bx=(0,0,1024,1536); one=toner.dots(bx,0.3,st)\ntoner._img(1-one).save(sys.argv[1])\ntoner._img(1-np.maximum(one, toner.dots(bx,0.2,toner.settings(None, lines=70)))).save(sys.argv[2])`;
  const a = join(copy.root || dir, "clean.png"), b = join(copy.root || dir, "clash.png"); py(MK, a, b);
  const { readFileSync } = await import("node:fs");
  assert.deepEqual((await api(`/api/exports/moire?p=${ID}`)).j, [], "nothing exported yet: nothing to say");
  for (const [n, f] of [["page-01.png", a], ["page-02.png", b]]) assert.equal((await fetch(app.base + `/api/export?p=${ID}&name=${n}`, { method: "POST", body: readFileSync(f) })).status, 200);
  const m = (await api(`/api/exports/moire?p=${ID}`)).j;
  assert.deepEqual(m.map((x) => [x.name, x.moire]), [["page-01.png", false], ["page-02.png", true]], JSON.stringify(m));
  assert.ok(m[1].every_px > 10 && m[1].strength >= 0.3 && m[0].tiles > 0);
});
