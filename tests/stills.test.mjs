// "Use existing stills": an anime scene's pictures are matched to a chapter's panels (same panel or paragraph, same people, closest
// framing, no still twice), the accepted ones are put on the panels, and a face's place is kept. The stills are made by code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, writeFileSync, cpSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { copyApp, startApp, makeScene, REPO } from "./harness.mjs";
import { matchStills, distance } from "../page-editor/stills.mjs";

const panel = (id, board) => ({ id, board: { who: [], lines: [], ...board } });
const shot = (id, o) => ({ shot_id: id, still: "stills/" + id + ".png", source_ids: [], ...o });

test("matching: the paragraph first, then the people in frame, then the framing; no still is used twice", () => {
  const panels = [
    panel("a", { src: ["B01:CH001:P0020"], shot: "close", who: [{ name: "Mara" }] }),
    panel("b", { src: ["B01:CH001:P0020"], shot: "wide", who: [{ name: "Mara" }, { name: "Joss" }] }),
    panel("c", { src: ["B01:CH001:P0021"], shot: "medium", who: [{ name: "Joss" }] }),
    panel("d", { src: ["B01:CH001:P0099"], shot: "medium", who: [{ name: "Joss" }] }),
    panel("e", { lines: [{ source_id: "L001" }], shot: "medium", who: [] }),
  ];
  const shots = [
    shot("S1", { source_ids: ["B01:CH001:P0020"], camera: { framing: "WS" }, expressions: { mara: "calm", joss: "late" } }),
    shot("S2", { source_ids: ["B01:CH001:P0020"], camera: { framing: "CU low" }, expressions: { mara: "cross" } }),
    shot("S3", { source_ids: ["B01:CH001:P0020"], camera: { framing: "MCU" }, expressions: { mara: "cross" } }),
    shot("S4", { source_ids: ["B01:CH001:P0021"], camera: { framing: "MS" }, blocking: [{ name: "Joss" }] }),
    shot("S5", { source_ids: ["B01:CH001:P0050"], camera: { framing: "MS" }, blocking: [{ name: "Joss" }] }),
    shot("S6", { source_ids: ["script:9"], lines: ["L001"], camera: { framing: "MS" } }),
  ];
  const m = matchStills(panels, shots, { script: [{ id: "L001", type: "line", src: "B01:CH001:P0030" }] });
  assert.equal(m.a.pick, "S2"); assert.match(m.a.why, /same paragraph.*same people.*same framing/);
  assert.equal(m.b.pick, "S1");
  assert.equal(m.c.pick, "S4");
  assert.equal(m.d.pick, "", "a panel with nothing in common with any still gets none");
  assert.equal(m.d.options.length, 0);
  assert.equal(m.e.pick, "S6"); assert.match(m.e.why, /same line/);
  assert.deepEqual(m.a.options.map((o) => o.shot), ["S2", "S3", "S1"], "the other stills of the same paragraph are offered, best first");
  const picks = Object.values(m).map((x) => x.pick).filter(Boolean); assert.equal(new Set(picks).size, picks.length);
  // two panels, one still: the better fit gets it, the other is left for the Artist
  const two = matchStills([panel("x", { src: ["P7"], shot: "wide" }), panel("y", { src: ["P7"], shot: "close" })], [shot("S9", { source_ids: ["P7"], camera: { framing: "close-up" } })]);
  assert.equal(two.y.pick, "S9"); assert.equal(two.x.pick, ""); assert.equal(two.x.options.length, 1);
  // a shot made from this very panel beats a shot that only shares its line
  const own = matchStills([panel("b01-n1", { lines: [{ source_id: "L001" }] })], [shot("S1", { source_ids: ["L001"] }), shot("S2", { source_ids: ["L001"], from_panel: { project: "ch", panel: "b01-n1" } })], { project: "ch" });
  assert.equal(own["b01-n1"].pick, "S2");
  assert.equal(distance("MCU low"), 2.5); assert.equal(distance("extreme close"), 4); assert.equal(distance("full figure"), 0.75); assert.equal(distance(""), null);
});

/** A chapter built from the fixture, and a folder of stills made by code: one red-ish picture per shot, 300 x 200. */
function setUp() {
  const copy = copyApp(), proj = join(copy.app, "page-editor", "projects", "zz-stills");
  mkdirSync(proj, { recursive: true }); cpSync(join(REPO, "tests/manga-direction/fixtures/ferry"), proj, { recursive: true });
  execFileSync("node", [join(copy.app, "tools/build_spec.mjs"), proj], { stdio: "ignore" });
  const root = join(copy.scratch, "stills-root"), folder = join(root, "ep01", "pier");
  mkdirSync(join(folder, "stills"), { recursive: true });
  const shots = [
    { shot_id: "RS001", source_ids: ["L001"], camera: { framing: "WS high" }, expressions: { mara: "still", joss: "running" }, action: "The pier at night.", still: "stills/RS001.png" },
    { shot_id: "RS002", source_ids: ["L002"], camera: { framing: "MS" }, expressions: { joss: "shrug" }, still: "stills/RS002.png" },
    { shot_id: "RS003", source_ids: ["L003"], camera: { framing: "CU low" }, expressions: { mara: "flat" }, still: "stills/RS003.png" },
    { shot_id: "RS004", source_ids: ["L003"], camera: { framing: "WS" }, expressions: { mara: "flat" }, still: "stills/RS004.png" },
    { shot_id: "RS005", source_ids: ["L004"], camera: { framing: "FS" }, expressions: { joss: "wet" }, still: "../outside.png" }, // points out of the folder: never read
    { shot_id: "RS006", source_ids: ["L005"], camera: { framing: "MS" }, expressions: { mara: "arms crossed" }, still: "stills/link.png" }, // a link out of the folder: never read
    { shot_id: "RS007", source_ids: ["L006"], camera: { framing: "CU" }, expressions: { joss: "grin" } }, // no still yet
  ];
  writeFileSync(join(folder, "SCENE_PLAN.json"), JSON.stringify({ scene_id: "pier", shots }));
  writeFileSync(join(copy.scratch, "secret.png"), "not for anyone");
  execFileSync("/usr/bin/python3", ["-c", "import sys\nfrom PIL import Image\nfor i,n in enumerate(sys.argv[2:]): Image.new('RGB',(300,200),(200,40+30*i,40)).save(sys.argv[1]+'/'+n+'.png')", join(folder, "stills"), "RS001", "RS002", "RS003", "RS004"]);
  execFileSync("/usr/bin/python3", ["-c", "import sys\nfrom PIL import Image\nImage.new('RGB',(300,200),(1,2,3)).save(sys.argv[1])", join(root, "outside.png")]);
  symlinkSync(join(copy.scratch, "secret.png"), join(folder, "stills", "link.png"));
  return { copy, proj, root, folder };
}
const post = (app, what, body, headers = {}) => fetch(app.base + "/api/stills/" + what, { method: "POST", body: JSON.stringify(body), headers });

test("a folder of stills: found, matched, put on the panels in true grey, the face's place kept through a rebuild", async () => {
  const { copy, proj, root } = setUp();
  const app = await startApp(copy, { env: { STUDIO_STILL_ROOTS: root } });
  try {
    const src = await (await fetch(app.base + "/api/stills/sources")).json();
    assert.deepEqual(src.folders.map((f) => [f.root, f.folder, f.stills]), [[0, "ep01/pier", 4]], "only shots whose picture is inside the folder count");
    assert.equal(src.roots[0].fixed, true);
    const source = { root: 0, folder: "ep01/pier" };
    const m = await (await post(app, "match", { p: "zz-stills", source })).json();
    assert.equal(m.count, 4); assert.equal(m.panels.length, 13);
    const by = Object.fromEntries(m.panels.map((q) => [q.id, q]));
    assert.equal(by["b01-n1"].pick, "RS001"); assert.equal(by["b01-n2"].pick, "RS002"); assert.equal(by["b01-n4"].pick, "RS003", "the close-up of the two stills for that line");
    assert.deepEqual(by["b01-n4"].options.map((o) => o.shot), ["RS003", "RS004"]);
    assert.equal(by["b01-n3"].pick, "", "the wristwatch insert has no still"); assert.equal(by["b02-n1"].pick, "", "the shot whose picture points out of the folder is not offered");
    assert.equal(m.panels.filter((q) => q.pick).length, 3);
    const pic = await fetch(app.base + m.stills.RS001.url); assert.equal(pic.status, 200); assert.equal(pic.headers.get("content-type"), "image/png");
    // nothing has changed yet
    assert.equal(existsSync(join(proj, "art", "assignments.json")), false);
    const used = await post(app, "use", { p: "zz-stills", source, picks: [{ panel: "b01-n1", shot: "RS001" }, { panel: "b01-n4", shot: "RS003" }, { panel: "b01-n2", shot: "RS005" }, { panel: "nobody", shot: "RS002" }] });
    const uj = await used.json(); assert.equal(used.status, 200, JSON.stringify(uj));
    assert.deepEqual(uj.placed, [{ panel: "b01-n1", shot: "RS001" }, { panel: "b01-n4", shot: "RS003" }]);
    const assign = JSON.parse(readFileSync(join(proj, "art", "assignments.json"), "utf8"));
    assert.deepEqual(assign, { "b01-n1": { image: "art/still-RS001.jpg", take: "still-RS001" }, "b01-n4": { image: "art/still-RS003.jpg", take: "still-RS003" } });
    const px = execFileSync("/usr/bin/python3", ["-c", "import sys\nfrom PIL import Image\nprint(Image.open(sys.argv[1]).convert('RGB').getpixel((5,5)))", join(proj, "art", "still-RS001.jpg")]).toString();
    const [r, g, b] = px.match(/\d+/g).map(Number); assert.ok(r === g && g === b, "a black-and-white series gets a true grey picture: " + px);
    const panelOf = (id) => { let f; const walk = (rows) => { for (const row of rows) for (const q of row.panels) { if (q.rows) walk(q.rows); else if (q.id === id) f = q; } }; for (const p of JSON.parse(readFileSync(join(proj, "spec.json"), "utf8")).pages) walk(p.layout.rows); return f; };
    assert.equal(panelOf("b01-n1").image, "art/still-RS001.jpg"); assert.equal(panelOf("b01-n2").image, undefined);
    const lib = JSON.parse(readFileSync(join(proj, "art", "library.json"), "utf8")); assert.equal(lib.length, 2); assert.equal(lib[0].still, true); assert.doesNotMatch(JSON.stringify(lib), /stills-root/, "the folder's place on the disk is not written into the project");
    // the face's place
    assert.equal((await post(app, "focus", { p: "zz-stills", panel: "b01-n4", focus: [0.3, 0.25] })).status, 200);
    assert.equal((await post(app, "focus", { p: "zz-stills", panel: "b01-n2", focus: [0.3, 0.25] })).status, 400, "a panel with no picture");
    assert.equal((await post(app, "focus", { p: "zz-stills", panel: "b01-n4", focus: [3, 0.25] })).status, 400);
    execFileSync("node", [join(copy.app, "tools/build_spec.mjs"), proj], { stdio: "ignore" });
    assert.deepEqual(panelOf("b01-n4").focus, [0.3, 0.25]);
    // the match now says which panels already have a picture
    const again = await (await post(app, "match", { p: "zz-stills", source })).json();
    assert.equal(again.panels.find((q) => q.id === "b01-n1").has, true); assert.equal(again.panels.find((q) => q.id === "b01-n2").has, false);
  } finally { await app.stop(); }
});

test("stills are only read from inside a folder that was set up; a stills folder is only added on the computer that runs Ibasho", async () => {
  const { copy, root, folder } = setUp();
  const app = await startApp(copy); // no folder set up when it starts
  try {
    let src = await (await fetch(app.base + "/api/stills/sources")).json();
    assert.deepEqual(src.folders, []); assert.deepEqual(src.roots, []);
    assert.equal((await post(app, "match", { p: "zz-stills", source: { root: 0, folder: "ep01/pier" } })).status, 404);
    assert.equal((await post(app, "match", { p: "zz-stills", source: { folder: folder } })).status, 404, "a whole path in a request is not a source");
    // another device (relayed to this computer) cannot add one, and is not told where the folders are
    const { code } = await (await fetch(app.base + "/api/access")).json(), far = { "x-forwarded-for": "203.0.113.9", "x-ibasho-access": code }; // a device that typed the access code
    assert.equal((await post(app, "roots", { add: root }, far)).status, 403);
    for (const bad of ["relative/folder", "/", join(root, "nothing-here"), join(folder, "SCENE_PLAN.json")]) assert.equal((await post(app, "roots", { add: bad })).status, 400, bad);
    assert.equal((await post(app, "roots", { add: root })).status, 200);
    src = await (await fetch(app.base + "/api/stills/sources")).json();
    assert.equal(src.folders.length, 1); assert.equal(src.roots[0].path, root);
    const away = await (await fetch(app.base + "/api/stills/sources", { headers: far })).json();
    assert.equal(away.roots[0].path, ""); assert.equal(away.local, false);
    const q = "root=0&folder=" + encodeURIComponent("ep01/pier") + "&f=";
    assert.equal((await fetch(app.base + "/api/stills/pic?" + q + "stills/RS001.png")).status, 200);
    for (const f of ["../outside.png", "../../outside.png", "stills/link.png", "SCENE_PLAN.json", "/etc/passwd", "stills/none.png", ""]) assert.equal((await fetch(app.base + "/api/stills/pic?" + q + encodeURIComponent(f))).status, 404, f);
    assert.equal((await fetch(app.base + "/api/stills/pic?root=0&folder=" + encodeURIComponent("../") + "&f=outside.png")).status, 404);
    assert.equal((await fetch(app.base + "/api/stills/pic?root=7&folder=.&f=outside.png")).status, 404);
    assert.equal((await post(app, "match", { p: "../zz-stills", source: { root: 0, folder: "ep01/pier" } })).status, 404);
    assert.equal((await post(app, "use", { p: "zz-stills", source: { root: 0, folder: "ep01/pier" }, picks: [{ panel: "b02-n1", shot: "RS005" }, { panel: "b02-n2", shot: "RS006" }] })).status, 400, "the two shots that point out of the folder cannot be used");
    assert.equal((await post(app, "roots", { remove: root })).status, 200);
    assert.deepEqual((await (await fetch(app.base + "/api/stills/sources")).json()).folders, []);
  } finally { await app.stop(); }
});

test("an anime scene kept in Ibasho is a source too", async () => {
  const { copy, proj } = setUp();
  const dir = makeScene(copy, "pier-scene", { shots: [{ shot_id: "S001", source_ids: ["L002"], from_panel: { project: "zz-stills", page: "board-p01", panel: "b01-n2" }, camera: { framing: "medium, eye level" }, blocking: [{ name: "Joss" }], still: "stills/S001.png" }, { shot_id: "S002", source_ids: ["L003"], camera: { framing: "close" }, action: "No picture yet." }] });
  mkdirSync(join(dir, "stills")); execFileSync("/usr/bin/python3", ["-c", "import sys\nfrom PIL import Image\nImage.new('RGB',(300,200),(9,99,199)).save(sys.argv[1])", join(dir, "stills", "S001.png")]);
  const app = await startApp(copy);
  try {
    const src = await (await fetch(app.base + "/api/stills/sources")).json();
    assert.deepEqual(src.scenes.map((s) => [s.id, s.stills]), [["pier-scene", 1]]);
    const m = await (await post(app, "match", { p: "zz-stills", source: { scene: "pier-scene" } })).json();
    const q = m.panels.find((x) => x.id === "b01-n2"); assert.equal(q.pick, "S001"); assert.match(q.why, /made from this panel/);
    assert.equal((await fetch(app.base + m.stills.S001.url)).status, 200);
    assert.equal((await post(app, "use", { p: "zz-stills", source: { scene: "pier-scene" }, picks: [{ panel: "b01-n2", shot: "S001" }] })).status, 200);
    assert.ok(existsSync(join(proj, "art", "still-S001.jpg")));
    assert.equal((await post(app, "match", { p: "zz-stills", source: { scene: "../pier-scene" } })).status, 404);
  } finally { await app.stop(); }
});
