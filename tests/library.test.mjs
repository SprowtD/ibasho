// The Library: one searchable list of every picture and video made (manga projects, anime scenes, Create). Read only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readdirSync, statSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { copyApp, startApp, makeProject, makeScene } from "./harness.mjs";
import { matches } from "../page-editor/library.mjs";

const PIC = "import sys\nfrom PIL import Image\nImage.new('RGB',(64,48),(200,60,40)).save(sys.argv[1])";
const pic = (f) => execFileSync("/usr/bin/python3", ["-c", PIC, f]);
let app, copy, dir, scene;
const get = async (q = "") => { const r = await fetch(app.base + "/api/library" + q); return { status: r.status, j: await r.json() }; };
const tree = (d) => readdirSync(d, { recursive: true }).map(String).sort().map((n) => n + ":" + statSync(join(d, n)).size).join("|");

before(async () => {
  copy = copyApp(); rmSync(join(copy.app, "page-editor", "samples"), { recursive: true, force: true }); // this scratch copy holds only what the test makes
  dir = makeProject(copy, "ferry-ch01", { spec: { project: "The Last Ferry", chapter: 1, pages: [{ id: "p1", number: 1, label: "Page 1", text: [], layout: { rows: [{ panels: [
    { id: "a1", w: 1, image: "art/a1.jpg", board: { action: "Mara waits on the pier in the rain.", who: [{ name: "Mara", at: [0.5, 0.4], size: "medium", facing: "left" }], lines: [] } },
    { id: "a2", w: 1, image: "art/a2.jpg", board: { action: "The ferry lamp, lit.", who: [], lines: [] } }] }] } }] } });
  pic(join(dir, "art", "a1.jpg")); pic(join(dir, "art", "a2.jpg")); pic(join(copy.scratch, "outside.jpg"));
  symlinkSync(join(copy.scratch, "outside.jpg"), join(dir, "art", "link.jpg")); // a link out of the project: never listed
  writeFileSync(join(dir, "art", "library.json"), JSON.stringify([{ src: "art/a1.jpg", label: "Page 1 · a1" }, { src: "art/a2.jpg", label: "Page 1 · a2" },
    { src: "art/gone.jpg", label: "deleted" }, { src: "../../../outside.jpg", label: "out" }, { src: "art/link.jpg", label: "linked out" }, { src: "spec.json", label: "not a picture" }]));
  scene = makeScene(copy, "scene-one", { shots: [
    { shot_id: "S01", duration: 3, action: "She waves from the deck.", framing: "wide", still: "api/anime/media?id=scene-one&f=stills/S01-take1.png", clip: "api/anime/media?id=scene-one&f=clips/S01.mp4", lines: ["L1"] },
    { shot_id: "S02", duration: 2, action: "No picture yet." }, { shot_id: "S03", duration: 2, action: "A bad address.", still: "api/anime/media?id=scene-one&f=../scene.json" }],
    dialogue: [{ line_id: "L1", speaker: "Joss", text: "Over here!" }] });
  mkdirSync(join(scene, "stills")); mkdirSync(join(scene, "clips")); pic(join(scene, "stills", "S01-take1.png")); writeFileSync(join(scene, "clips", "S01.mp4"), "not really a video");
  mkdirSync(join(copy.saved, "create"), { recursive: true });
  pic(join(copy.saved, "create", "c1.png")); writeFileSync(join(copy.saved, "create", "c2.mp4"), "x"); pic(join(copy.saved, "create", "c2.jpg"));
  const meta = (m) => writeFileSync(join(copy.saved, "create", m.id + ".json"), JSON.stringify(m));
  meta({ id: "c1", kind: "picture", status: "done", file: "c1.png", prompt: "A lighthouse at dusk, loose pen.", model: "google/some-picture-model", at: "2026-11-01T10:00:00.000Z" });
  meta({ id: "c2", kind: "video", status: "done", file: "c2.mp4", poster: "c2.jpg", prompt: "Waves against the hull.", model: "x/some-video-model", at: "2026-11-02T10:00:00.000Z" });
  meta({ id: "c3", kind: "picture", status: "failed", prompt: "never landed", at: "2026-11-03T10:00:00.000Z" });
  meta({ id: "c4", kind: "picture", status: "done", file: "../../ferry-secret.png", prompt: "points outside", at: "2026-11-03T10:00:00.000Z" });
  app = await startApp(copy);
});
after(async () => { await app.stop(); });

test("everything made is listed once, from where the app already serves it; nothing outside its own folder", async () => {
  const { status, j } = await get();
  assert.equal(status, 200); assert.equal(j.total, 6, JSON.stringify(j.items.map((x) => x.key)));
  assert.deepEqual(j.counts, { all: 6, picture: 4, video: 2, manga: 2, anime: 2, create: 2 });
  assert.deepEqual(j.items.map((x) => x.key).sort(), ["anime:scene-one:clips/S01.mp4", "anime:scene-one:stills/S01-take1.png", "create:c1", "create:c2", "manga:ferry-ch01:art/a1.jpg", "manga:ferry-ch01:art/a2.jpg"]);
  const a1 = j.items.find((x) => x.key === "manga:ferry-ch01:art/a1.jpg");
  assert.equal(a1.from, "The Last Ferry, chapter 1"); assert.equal(a1.where, "Page 1 · a1"); assert.match(a1.words, /Mara waits on the pier/); assert.deepEqual(a1.cast, ["Mara"]); assert.deepEqual(a1.open, { type: "manga", project: "ferry-ch01", page: "p1" });
  const clip = j.items.find((x) => x.kind === "video" && x.source === "anime");
  assert.equal(clip.where, "shot S01"); assert.deepEqual(clip.cast, ["Joss"]); assert.match(clip.thumb, /stills\/S01-take1\.png|stills%2FS01-take1\.png/); assert.deepEqual(clip.open, { type: "anime", scene: "scene-one" });
  for (const it of j.items) for (const u of [it.thumb, it.file].filter(Boolean)) { const r = await fetch(app.base + u); assert.equal(r.status, 200, "the app serves " + u); await r.arrayBuffer(); }
  assert.ok(j.items.every((x, i) => i === 0 || String(j.items[i - 1].at) >= String(x.at)), "newest first");
});
test("Find keeps an item when every word typed is in it; kind and source narrow it; pages stay small", async () => {
  assert.deepEqual((await get("?q=mara")).j.items.map((x) => x.key), ["manga:ferry-ch01:art/a1.jpg"], "a name in the panel");
  assert.equal((await get("?q=" + encodeURIComponent("ferry lamp"))).j.total, 1, "every word, in any order and any field");
  assert.equal((await get("?q=" + encodeURIComponent("last ferry"))).j.total, 2, "the project's name");
  assert.equal((await get("?q=LIGHTHOUSE")).j.items[0].key, "create:c1", "the words it was made from, any case");
  assert.equal((await get("?q=joss")).j.total, 2, "who speaks in the shot");
  assert.equal((await get("?q=s01")).j.total, 2); assert.equal((await get("?q=zebra")).j.total, 0);
  assert.equal((await get("?kind=video")).j.total, 2); assert.equal((await get("?source=create&kind=picture")).j.total, 1); assert.equal((await get("?source=anime&q=waves")).j.total, 2);
  const p1 = (await get("?n=4")).j, p2 = (await get("?n=4&from=4")).j;
  assert.equal(p1.items.length, 4); assert.equal(p1.more, true); assert.equal(p2.items.length, 2); assert.equal(p2.more, false);
  assert.equal(new Set(p1.items.concat(p2.items).map((x) => x.key)).size, 6);
  assert.ok((await get("?n=99999")).j.items.length <= 120);
  assert.equal(matches({ from: "Café Été", where: "", words: "", cast: [] }, "cafe ete"), true, "accents do not get in the way");
});
test("the Library only reads: no route changes anything, and the folders are as they were", async () => {
  const before = [tree(dir), tree(scene), tree(join(copy.saved, "create"))].join("#");
  for (const m of ["POST", "PUT", "DELETE"]) assert.equal((await fetch(app.base + "/api/library", { method: m })).status, 405);
  await get("?fresh=1"); await get("?q=mara");
  assert.equal([tree(dir), tree(scene), tree(join(copy.saved, "create"))].join("#"), before);
  const page = await fetch(app.base + "/library"); assert.equal(page.status, 200); assert.match(await page.text(), /<title>Library · Ibasho<\/title>/);
});
