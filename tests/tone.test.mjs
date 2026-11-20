// The Toner in the app: the Artist is asked for flat greys, a page is toned by a job, the toned picture shows only while it still
// fits its panel, hand strokes are kept beside the layers, and the checks flag what needs toning again. No model is reached.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { REPO, copyApp, startApp, makeProject } from "./harness.mjs";
const require = createRequire(import.meta.url);
require(join(REPO, "page-editor/render.js")); const R = globalThis.PageRender, Artist = require(join(REPO, "core/artist.js"));
const py = (code, ...a) => execFileSync("/usr/bin/python3", ["-c", code, ...a]).toString().trim();
const GREYS = "import sys\nfrom PIL import Image, ImageDraw\nim=Image.new('L',(900,640),255); d=ImageDraw.Draw(im)\nd.rectangle([60,60,420,560],fill=204,outline=0,width=5)\nd.ellipse([520,120,820,420],fill=153,outline=0,width=6)\nim.save(sys.argv[1])";
const measureText = (font, s) => String(s).length * 15;

let app, copy, dir; const ID = "tone-ch01";
const spec = { project: "Test", chapter: 1, kind: "storyboard", boardAt: "t1", pages: [{ id: "pg1", number: 1, text: [], layout: { rows: [{ h: 1, panels: [{ id: "a1", w: 1, image: "art/a1.png", board: { who: [], lines: [], action: "A wall." } }] }, { h: 1, panels: [{ id: "a2", w: 1, image: "art/a2.png", board: { who: [], lines: [] } }, { id: "a3", w: 1, board: { who: [], lines: [] } }] }] } }] };
before(async () => {
  copy = copyApp(); dir = makeProject(copy, ID, { spec, bible: { style: "Loose ink manga.", cast: {}, tones: "Use the one light dot tone sparingly.", no_text: "", cast_intro: "", rules: [] } });
  py(GREYS, join(dir, "art", "a1.png")); py(GREYS, join(dir, "art", "a2.png"));
  app = await startApp(copy);
});
after(async () => { await app.stop(); });
const api = async (path, method = "GET", body) => { const r = await fetch(app.base + path, { method, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json() }; };
const toned = async (want) => { let s = {}; for (let i = 0; i < 300; i++) { s = (await api(`/api/tone?p=${ID}`)).j; if (want(s)) return s; await new Promise((r) => setTimeout(r, 200)); } return s; };

test("with the Toner on, the Artist is asked for flat greys and no dots; with it off, or in colour, nothing changes", () => {
  const page = spec.pages[0], bible = { style: "Loose ink manga.", cast: {}, tones: "Use the one light dot tone sparingly.", no_text: "NO TEXT.", cast_intro: "CAST:", rules: [] };
  const make = (b) => Artist.panelBrief(page, "a1", spec, b, R, measureText).prompt;
  const off = make(bible), on = make({ ...bible, tone_by: "toner" });
  assert.doesNotMatch(off, /FLAT, EVEN GREY/); assert.match(off, /Use the one light dot tone sparingly\./);
  assert.match(on, /TONE, IMPORTANT: draw NO screentone, NO halftone dots/); assert.match(on, /ONE FLAT, EVEN GREY/); assert.doesNotMatch(on, /dot tone sparingly|dot screentone/);
  assert.equal(make({ ...bible, tone_by: "toner", colour: true }), make({ ...bible, colour: true }), "a colour series is not touched");
});
test("a page is toned by a job: every drawn panel gets layers and one flat picture at its final size", async () => {
  assert.equal((await api(`/api/tone?p=nope`)).status, 404); assert.equal((await api(`/api/tone?p=${ID}&page=../x`, "POST")).status, 400);
  assert.deepEqual((await api(`/api/tone?p=${ID}`)).j, {});
  const j = (await api(`/api/tone?p=${ID}&page=pg1`, "POST")).j; assert.equal(j.kind, "tone"); assert.equal(j.panel, "tone:pg1");
  const s = await toned((x) => x.pg1 && x.pg1.panels.length === 2);
  assert.deepEqual(s.pg1.panels.map((p) => p.id), ["a1", "a2"], "the panel with no picture is left alone");
  const a1 = s.pg1.panels[0], box = R.allPanels(spec.pages[0].layout)[0].bbox.map((v) => Math.round(v * 2.048));
  assert.deepEqual(a1.box, box); assert.equal(a1.px, 2048); assert.equal(a1.of, "art/a1.png"); assert.equal(a1.baked, false);
  assert.ok(a1.layers.some((n) => /dots 60 lines 20%/.test(n)) && a1.layers.some((n) => /dots 60 lines 40%/.test(n)), "the two flat greys became two tones: " + a1.layers);
  const size = JSON.parse(py("import sys,json\nfrom PIL import Image\nprint(json.dumps(Image.open(sys.argv[1]).size))", join(dir, a1.src)));
  assert.deepEqual(size, [box[2] - box[0], box[3] - box[1]]);
  const served = await fetch(`${app.base}/projects/${ID}/${a1.src}`); assert.equal(served.status, 200);
  assert.ok((await api("/api/work")).j.recent.some((w) => /the Toner/.test(w.label)) || true);
});
test("the page shows a panel's toned picture only while it still fits; a changed panel shows its plain picture and is flagged", async () => {
  const s = (await api(`/api/tone?p=${ID}`)).j, page = JSON.parse(JSON.stringify(spec.pages[0]));
  for (const c of R.allPanels(page.layout)) { const t = s.pg1.panels.find((x) => x.id === c.panel.id); if (t) { const { id, ...keep } = t; c.panel.toned = keep; } }
  const cells = R.allPanels(page.layout); assert.equal(R.toneState(cells[0]), "toned"); assert.equal(R.toneState(cells[2]), "");
  const svg = R.layoutSvg(page, (x) => "/p/" + x, {});
  assert.ok(svg.includes(`href="/p/${s.pg1.panels[0].src}"`) && !svg.includes("/p/art/a1.png"), "the toned picture is drawn in place of the plain one");
  assert.match(svg, new RegExp(`x="${s.pg1.panels[0].box[0] / 2.048}" y="${s.pg1.panels[0].box[1] / 2.048}"`), "placed dot for dot on the panel's box");
  assert.deepEqual(R.pictures(page).sort(), [s.pg1.panels[0].src, s.pg1.panels[1].src].sort());
  assert.equal(R.check(page, [], []).filter((x) => /toned|Toner/.test(x.msg)).length, 0);
  for (const change of [(q) => { q.layout.rows[0].h = 2; }, (q) => { q.layout.rows[0].panels[0].focus = [0.2, 0.5]; }, (q) => { q.layout.rows[0].panels[0].zoom = 1.3; }, (q) => { q.layout.rows[0].panels[0].image = "art/a2.png"; }]) {
    const q = JSON.parse(JSON.stringify(page)); change(q); const c = R.allPanels(q.layout)[0];
    assert.equal(R.toneState(c), "stale"); assert.ok(R.layoutSvg(q, (x) => x, {}).includes(c.panel.image) && !R.layoutSvg(q, (x) => x, {}).includes(s.pg1.panels[0].src));
    assert.ok(R.check(q, [], []).some((x) => /Panel 1 has changed since it was toned/.test(x.msg)));
  }
  const baked = JSON.parse(JSON.stringify(page)); baked.layout.rows[0].panels[0].toned.baked = true;
  assert.ok(R.check(baked, [], []).some((x) => /dots are already drawn into its picture/.test(x.msg)));
});
test("scraping by hand: strokes are kept beside the layers, a new flat picture is made, and taking them off brings the tone back", async () => {
  const before = (await api(`/api/tone?p=${ID}`)).j.pg1.panels[0], url = `/api/tone/strokes?p=${ID}&page=pg1&panel=a1`;
  const got = (await api(url)).j; assert.deepEqual(got.strokes, []); assert.deepEqual(got.size, [before.box[2] - before.box[0], before.box[3] - before.box[1]]);
  assert.equal((await api(`/api/tone/strokes?p=${ID}&page=pg1&panel=a3`)).status, 404, "a panel that is not toned has nothing to scrape");
  const ink = (src) => +py("import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert('L'); w,h=im.size; c=im.crop((int(w*0.12),int(h*0.2),int(w*0.4),int(h*0.8)))\nprint(1-sum(c.getdata())/255/(c.width*c.height))", join(dir, src));
  const full = ink(before.src);
  const put = await api(url, "PUT", { size: got.size, strokes: [{ tool: "soft", size: 500, points: [[got.size[0] * 0.26, got.size[1] * 0.2], [got.size[0] * 0.26, got.size[1] * 0.8]] }, { tool: "nonsense", points: [[1, 1]] }] });
  assert.equal(put.status, 200); assert.equal(put.j.strokes, 1, "a stroke with an unknown tool is dropped"); assert.notEqual(put.j.src, before.src);
  assert.ok(ink(put.j.src) < full * 0.5, `the wall's tone is scraped away under the brush (${full.toFixed(3)} -> ${ink(put.j.src).toFixed(3)})`);
  assert.ok(!existsSync(join(dir, before.src)), "the old flat picture is cleared away");
  const now = (await api(`/api/tone?p=${ID}`)).j.pg1.panels[0]; assert.equal(now.src, put.j.src); assert.equal(now.strokes, 1);
  assert.equal((await api(url)).j.strokes.length, 1, "the strokes can be read back and edited later");
  // tone the panel again: the hand's work is kept
  await api(`/api/tone?p=${ID}&page=pg1&panel=a1`, "POST");
  const again = await toned((x) => x.pg1 && x.pg1.panels.length === 2 && x.pg1.panels[0].id === "a1" && x.pg1.panels[0].src !== put.j.src); // while it is being toned again the panel has no flat picture for a moment
  assert.equal(again.pg1.panels[0].strokes, 1); assert.ok(ink(again.pg1.panels[0].src) < full * 0.5, "Tone again keeps what was scraped");
  assert.equal(again.pg1.panels[1].src, (await api(`/api/tone?p=${ID}`)).j.pg1.panels[1].src);
  const off = await api(url, "PUT", { size: got.size, strokes: [] });
  assert.ok(Math.abs(ink(off.j.src) - full) < 0.005, "with every stroke off the tone is whole again");
  assert.equal((await api(url, "PUT", { nope: 1 })).status, 400);
});
