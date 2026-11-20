// Custom panel styles, part 3: break-outs. The cut-out tool, the page renderer, and the server's drawing job (Codex is a stand-in).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { writeFileSync, readFileSync, readdirSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { REPO, copyApp, startApp, makeProject } from "./harness.mjs";
const require = createRequire(import.meta.url);
require(join(REPO, "page-editor/render.js")); const R = globalThis.PageRender;
const py = (code, ...a) => execFileSync("/usr/bin/python3", ["-c", code, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const cutout = (...a) => { try { return { out: execFileSync("/usr/bin/python3", [join(REPO, "tools/cutout.py"), ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString() }; } catch (e) { return { err: String(e.stderr) }; } };
const DRAW = `import sys\nfrom PIL import Image, ImageDraw\nbg=tuple(int(v) for v in sys.argv[2].split(','))\nim=Image.new('RGB',(1024,1536),bg); d=ImageDraw.Draw(im)\nif sys.argv[3]=='figure':\n    d.ellipse((300,200,700,600),fill=(255,255,255),outline=(10,10,10),width=10)\n    d.rectangle((250,640,760,1300),fill=bg,outline=(10,10,10),width=10)\n    d.line([(500,640),(507,640)],fill=bg,width=12)\n    d.rectangle((400,800,600,1000),fill=(200,30,30))\nelif sys.argv[3]=='busy':\n    [d.rectangle((x,0,x+40,1536),fill=(x%255,90,200)) for x in range(0,1024,80)]\nim.save(sys.argv[1])`;

let app, copy;
before(async () => {
  copy = copyApp(); makeProject(copy, "bo-ch01", { bible: { style: "Loose ink manga.", cast: { Kai: { desc: "A tall boy in a long coat." } }, strict: false } });
  writeFileSync(join(copy.bin, "codex"), `#!/bin/sh\nexec /usr/bin/python3 ${JSON.stringify(join(REPO, "tests/manga-direction/fixtures/fake_draw.py"))} "$@"\n`); chmodSync(join(copy.bin, "codex"), 0o755);
  app = await startApp(copy);
});
after(async () => { await app.stop(); });

test("cut-out: the background joined to the edge goes clear, white inside the outline stays, a small gap does not leak, a rim is left", () => {
  const src = join(app.scratch, "f.png"), out = join(app.scratch, "f-cut.png"); py(DRAW, src, "250,251,249", "figure");
  const r = cutout(src, out); assert.ok(r.out, r.err); const j = JSON.parse(r.out); assert.ok(j.share > 0.25 && j.share < 0.45, "the figure's share: " + j.share);
  const px = JSON.parse(py("import sys,json\nfrom PIL import Image\nim=Image.open(sys.argv[1]); w,h=im.size\nprint(json.dumps([im.mode,[w,h],im.getpixel((1,1))[3],im.getpixel((w//2,h//5)),im.getpixel((w//2,int(h*0.9))),im.getpixel((w//2,int(h*0.62)))]))", out));
  assert.equal(px[0], "RGBA"); assert.ok(px[1][0] < 600 && px[1][1] < 1200, "trimmed to the figure: " + px[1]);
  assert.equal(px[2], 0, "clear outside"); assert.deepEqual(px[3], [255, 255, 255, 255], "the head's white inside is kept");
  assert.equal(px[4][3], 255, "the body is not hollowed out through the gap in its outline"); assert.deepEqual(px[5].slice(0, 3), [200, 30, 30]);
  const tight = JSON.parse(cutout(src, join(app.scratch, "f0.png"), "0").out); assert.ok(tight.w < j.w, "edge 0 cuts on the outline: no rim");
});
test("cut-out: any flat background colour works; a picture with no plain background is refused", () => {
  const g = join(app.scratch, "g.png"); py(DRAW, g, "40,200,90", "figure"); assert.ok(cutout(g, join(app.scratch, "g-cut.png")).out);
  const b = join(app.scratch, "b.png"); py(DRAW, b, "0,0,0", "busy"); assert.match(cutout(b, join(app.scratch, "b-cut.png")).err, /no plain background/);
  const e = join(app.scratch, "e.png"); py(DRAW, e, "255,255,255", "empty"); assert.match(cutout(e, join(app.scratch, "e-cut.png")).err, /could not be told from its background/);
});
test("a break-out is drawn over the panels and their borders; one not drawn yet shows nothing", () => {
  const page = { layout: { rows: [{ h: 1, panels: [{ w: 1, id: "a" }] }, { h: 1, panels: [{ w: 1, id: "b" }] }], breakouts: [{ id: "bo1", box: [0.2, 0.3, 0.6, 0.7], image: "art/breakouts/bo1-take01.png" }, { id: "bo2", box: [0.5, 0.1, 0.8, 0.4], image: "art/breakouts/bo2-take01.png", flip: true }, { id: "bo3", box: [0, 0, 0.2, 0.2], who: "Kai" }] } };
  const svg = R.layoutSvg(page, (s) => "/x/" + s, {});
  assert.equal((svg.match(/<image /g) || []).length, 2);
  assert.ok(svg.lastIndexOf('stroke="#000"') < svg.indexOf("bo1-take01"), "after every panel border");
  assert.match(svg, /href="\/x\/art\/breakouts\/bo1-take01\.png" x="200" y="450" width="400" height="600" preserveAspectRatio="xMidYMid meet"\/>/);
  assert.match(svg, /bo2-take01\.png"[^>]*transform="translate\(1300 0\) scale\(-1 1\)"/);
  assert.equal(R.layoutSvg({ layout: { rows: page.layout.rows } }, (s) => s, {}).includes("<image"), false);
});
test("the drawing job: one figure alone on white is asked for, cut out, and offered as the newest take", async () => {
  const post = (b) => fetch(`${app.base}/api/breakouts?p=bo-ch01`, { method: "POST", body: JSON.stringify(b) });
  assert.equal((await post({ id: "../x", who: "Kai" })).status, 400); assert.equal((await post({ id: "bo1" })).status, 400);
  assert.equal((await fetch(`${app.base}/api/breakouts?p=nope`)).status, 404);
  const j = await (await post({ id: "bo1", who: "Kai", action: "Swinging his sword down at the reader." })).json(); assert.equal(j.kind, "breakout"); assert.equal(j.panel, "breakout:bo1");
  let takes = {}; for (let i = 0; i < 100 && !takes.bo1; i++) { await new Promise((r) => setTimeout(r, 200)); takes = await (await fetch(`${app.base}/api/breakouts?p=bo-ch01`)).json(); }
  assert.deepEqual(takes, { bo1: "art/breakouts/bo1-take01.png" });
  const dir = join(copy.app, "page-editor/projects/bo-ch01/art/breakouts"), prompt = readFileSync(join(dir, "BREAKOUT_TASK_bo1.prompt.txt"), "utf8");
  assert.match(prompt, /ONE BLACK-AND-WHITE CUT-OUT FIGURE/); assert.match(prompt, /Loose ink manga\./); assert.match(prompt, /WHO OR WHAT\. Kai: A tall boy in a long coat\./); assert.match(prompt, /THE POSE\. Swinging his sword down/);
  assert.doesNotMatch(readFileSync(join(dir, "BREAKOUT_TASK_bo1.md"), "utf8"), /sword|tall boy/, "the person's words are in the data file, never in the task");
  assert.ok(existsSync(join(dir, "bo1-take01-raw.png")), "the picture as drawn is kept beside the cut-out");
  const served = await fetch(`${app.base}/projects/bo-ch01/${takes.bo1}`); assert.equal(served.status, 200); assert.match(served.headers.get("content-type"), /png/);
  let work = { recent: [] }; for (let i = 0; i < 40 && !work.recent.some((w) => /break-out/.test(w.label)); i++) { await new Promise((r) => setTimeout(r, 150)); work = await (await fetch(`${app.base}/api/work`)).json(); } // the job is marked finished a moment after its file lands
  assert.ok(work.recent.some((w) => /break-out: Kai/.test(w.label) && w.status === "done"), JSON.stringify(work.recent.map((w) => w.label)));
  await (await post({ id: "bo1", who: "Kai", action: "Again." })).json();
  for (let i = 0; i < 100 && takes.bo1 !== "art/breakouts/bo1-take02.png"; i++) { await new Promise((r) => setTimeout(r, 200)); takes = await (await fetch(`${app.base}/api/breakouts?p=bo-ch01`)).json(); }
  assert.equal(takes.bo1, "art/breakouts/bo1-take02.png", "drawing again makes a second take and never overwrites the first");
  assert.equal(readdirSync(dir).filter((n) => /^bo1-take0[12](-raw)?\.png$/.test(n)).length, 4);
});
