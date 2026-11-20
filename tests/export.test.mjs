// Export on the manga side: the exported pages of a chapter as one download, a PDF, PNGs or JPEGs (tools/export_pages.py).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { startApp } from "./harness.mjs";

let app; const ID = "my-story-ch03", N = 23;
const py = (code, ...args) => execFileSync("/usr/bin/python3", ["-c", code, ...args], { maxBuffer: 1 << 26 }).toString().trim();
const names = (buf) => { const f = join(app.scratch, "got.zip"); writeFileSync(f, buf); return JSON.parse(py("import sys,zipfile,json\nprint(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))", f)); };
const sizeOf = (buf, name = "got.img") => { const f = join(app.scratch, name); writeFileSync(f, buf); return JSON.parse(py("import sys,json\nfrom PIL import Image\nim=Image.open(sys.argv[1])\nprint(json.dumps([im.format,im.width,im.height]))", f)); };
const get = async (q) => { const r = await fetch(`${app.base}/api/export-file?p=${ID}&${q}`); return { r, buf: Buffer.from(await r.arrayBuffer()), file: (/filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "") || [])[1] }; };

before(async () => {
  app = await startApp();
  const dir = join(app.saved, "exports", ID); mkdirSync(dir, { recursive: true });
  py("import sys\nfrom PIL import Image\nfor i in range(1, int(sys.argv[2]) + 1): Image.new('RGB', (2048, 3072), (i * 10 % 255, 90, 160)).save(f'{sys.argv[1]}/page-{i:02d}.png')", dir, String(N));
});
after(async () => { await app.stop(); });

test("PDF: one file named after the project, a page for every exported page, in order, the picture edge to edge", async () => {
  const { r, buf, file } = await get("format=pdf&title=" + encodeURIComponent("My Story · Chapter 3"));
  assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "application/pdf"); assert.equal(file, ID + ".pdf");
  const s = buf.toString("latin1");
  assert.ok(s.startsWith("%PDF-1.4") && s.trimEnd().endsWith("%%EOF"));
  assert.equal((s.match(/\/Type \/Page /g) || []).length, N);
  assert.match(s, new RegExp(`/Count ${N} `)); assert.match(s, /\/MediaBox \[0 0 432\.00 648\.00\]/); assert.match(s, /\/Width 2048 \/Height 3072/);
  assert.doesNotMatch(s, /\/Direction \/R2L/);
  assert.match(s, /\/Title <FEFF004D0079/); // the title, safe for any alphabet
  const xref = +/startxref\n(\d+)/.exec(s)[1]; assert.equal(s.slice(xref, xref + 4), "xref"); // a reader finds its table
  const offs = s.slice(xref).split("\n").filter((l) => / 00000 n $/.test(l)).map((l) => +l.slice(0, 10));
  offs.forEach((o, i) => assert.equal(s.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
});
test("PDF of a right-to-left chapter is marked to open right to left; picked pages only; the smaller size", async () => {
  const s = (await get("format=pdf&rtl=1&pages=2,5,9&size=web")).buf.toString("latin1");
  assert.match(s, /\/ViewerPreferences << \/Direction \/R2L >>/);
  assert.equal((s.match(/\/Type \/Page /g) || []).length, 3); assert.match(s, /\/Width 1365 \/Height 2048/);
});
test("PNG and JPEG: a zip, every file named from the project and the page", async () => {
  const png = await get("format=png&pages=1,2,3"), jpg = await get("format=jpeg&pages=4,10");
  assert.equal(png.file, ID + "-png.zip"); assert.deepEqual(names(png.buf), [1, 2, 3].map((n) => `${ID}-page-0${n}.png`));
  assert.equal(jpg.file, ID + "-jpeg.zip"); assert.deepEqual(names(jpg.buf), [`${ID}-page-04.jpg`, `${ID}-page-10.jpg`]);
});
test("one page asked for comes as the picture itself, at the size chosen", async () => {
  const a = await get("format=jpeg&pages=7&size=web"), b = await get("format=png&pages=7");
  assert.equal(a.file, ID + "-page-07.jpg"); assert.equal(a.r.headers.get("content-type"), "image/jpeg"); assert.deepEqual(sizeOf(a.buf), ["JPEG", 1365, 2048]);
  assert.equal(b.file, ID + "-page-07.png"); assert.deepEqual(sizeOf(b.buf), ["PNG", 2048, 3072]);
});
test("folders of 20 for posting: 23 pages make two folders, page numbers carry on", async () => {
  const { buf, file } = await get("format=jpeg&size=web&sets=20"), n = names(buf);
  assert.equal(file, ID + "-jpeg-sets-of-20.zip"); assert.equal(n.length, N);
  assert.equal(n[0], `post-01/${ID}-page-01.jpg`); assert.equal(n[19], `post-01/${ID}-page-20.jpg`); assert.equal(n[20], `post-02/${ID}-page-21.jpg`);
  assert.deepEqual(names((await get("format=jpeg&sets=20&pages=1,2")).buf), [`${ID}-page-01.jpg`, `${ID}-page-02.jpg`]); // one post needs no folder
});
test("the two older addresses still answer (PNG zip, and JPEGs for X)", async () => {
  const z = await fetch(`${app.base}/api/export-zip?p=${ID}`), x = await fetch(`${app.base}/api/export-x?p=${ID}`);
  assert.equal(names(Buffer.from(await z.arrayBuffer())).length, N);
  assert.equal(names(Buffer.from(await x.arrayBuffer()))[20], `post-02/${ID}-page-21.jpg`);
});
test("asked for something that is not there: a plain answer, and nothing left behind", async () => {
  assert.equal((await get("format=gif")).r.status, 400);
  assert.equal((await get("format=pdf&pages=99")).r.status, 404);
  assert.equal((await fetch(`${app.base}/api/export-file?p=never-made&format=pdf`)).status, 404);
  assert.equal((await fetch(`${app.base}/api/export-file?p=..%2F..&format=pdf`)).status, 404);
  assert.deepEqual(readdirSync(join(app.saved, "exports")), [ID]); // no half-made download files
});
test("Print PDF: the cut page of the chosen paper, 3 mm of bleed, trim marks, the whole page fitted to the paper's height", async () => {
  const MM = 72 / 25.4, f2 = (v) => v.toFixed(2);
  for (const [paper, tw, th] of [["b5", 182, 257], ["a5", 148, 210], ["us", 168.3, 260.4]]) {
    const { r, buf, file } = await get(`format=print&paper=${paper}&pages=1,2&rtl=1`);
    assert.equal(r.status, 200); assert.equal(file, `${ID}-print-${paper}.pdf`);
    const s = buf.toString("latin1"); assert.ok(s.startsWith("%PDF-1.4") && s.trimEnd().endsWith("%%EOF")); assert.equal((s.match(/\/Type \/Page /g) || []).length, 2);
    const boxes = Object.fromEntries([...s.matchAll(/\/(MediaBox|BleedBox|TrimBox) \[([\d. ]+)\]/g)].slice(0, 3).map((m) => [m[1], m[2].split(" ").map(Number)]));
    const T = boxes.TrimBox, B = boxes.BleedBox, M = boxes.MediaBox;
    assert.ok(Math.abs(T[2] - T[0] - tw * MM) < 0.02 && Math.abs(T[3] - T[1] - th * MM) < 0.02, paper + ": the cut page is the paper's size");
    assert.ok([0, 1].every((i) => Math.abs(T[i] - B[i] - 3 * MM) < 0.02) && [2, 3].every((i) => Math.abs(B[i] - T[i] - 3 * MM) < 0.02), "3 mm of bleed all round");
    assert.ok(B[0] > 0 && B[1] > 0 && B[2] < M[2] && B[3] < M[3], "room outside the bleed for the trim marks");
    const [, pw, ph, px, py] = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im0 Do Q/.exec(s).map(Number);
    const tall = Math.abs(ph - (th + 6) * MM) < 0.02, wide = Math.abs(pw - (tw + 6) * MM) < 0.02; // as tall as the bleed, or (a squat paper like the US comic) as wide as it
    assert.ok((tall || wide) && pw <= (tw + 6) * MM + 0.02 && ph <= (th + 6) * MM + 0.02 && Math.abs(pw / ph - 2048 / 3072) < 0.001, paper + ": the whole picture, in its own shape, fills the bleed one way and stays inside it the other");
    assert.ok(Math.abs(px + pw / 2 - (T[0] + T[2]) / 2) < 0.02 && Math.abs(py + ph / 2 - (T[1] + T[3]) / 2) < 0.02, "centred on the cut page");
    assert.equal((s.match(/ l S\n/g) || []).length, 16, "eight trim marks on each of the two sheets"); assert.match(s, /\/Direction \/R2L/); assert.match(s, /\/Width 2048 \/Height 3072/);
  }
  assert.equal((await get("format=print&paper=nonsense&pages=1")).file, `${ID}-print-b5.pdf`, "an unknown paper is B5");
});
