// Audit item 5: paths taken from saved documents stay inside their project, scene or look.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, symlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { startApp, makeProject, makeScene, REPO } from "./harness.mjs";

const png = (f) => execFileSync("/usr/bin/python3", ["-c", "import sys\nfrom PIL import Image\nImage.new('RGB',(64,64),(200,0,0)).save(sys.argv[1])", f]);

test("a scene plan cannot point a still, a clip or a sound at a file outside the scene", async () => {
  const a = await startApp();
  try {
    const secret = join(a.scratch, "secret.png"); png(secret);
    const dir = makeScene(a, "s1", { shots: [
      { shot_id: "S01", duration: 3, action: "x", still: "api/anime/media?id=s1&f=../../secret.png" },
      { shot_id: "S02", duration: 3, action: "x", still: "../" + "../".repeat(12) + secret.slice(1) },
      { shot_id: "S03", duration: 3, action: "x", still: "projects/../../../secret.png" },
      { shot_id: "S04", duration: 3, action: "x", still: "api/anime/media?id=s1&f=stills/ok.png" } ] });
    mkdirSync(join(dir, "stills")); png(join(dir, "stills", "ok.png"));
    symlinkSync(secret, join(dir, "stills", "link.png"));
    for (const shot of ["S01", "S02", "S03"]) {
      const r = await (await fetch(`${a.base}/api/anime/video-request?id=s1&shot=${shot}`)).json();
      assert.match(r.error || "", /Draw or add a picture/, shot + " must not use the outside file");
      const d = await (await fetch(`${a.base}/api/anime/request?id=s1&shot=${shot}`)).json();
      assert.deepEqual(d.images, [], shot + " must attach nothing");
    }
    const ok = await (await fetch(`${a.base}/api/anime/request?id=s1&shot=S04`)).json();
    assert.deepEqual(ok.images, ["ok.png"]);
    assert.equal((await fetch(`${a.base}/api/anime/media?id=s1&f=stills/ok.png`)).status, 200);
    assert.equal((await fetch(`${a.base}/api/anime/media?id=s1&f=stills/link.png`)).status, 404, "a link out of the scene is not followed");
  } finally { await a.stop(); }
});

test("series settings: sheets must be pictures in the project; ref_root cannot be set by a request", async () => {
  const a = await startApp();
  try {
    const dir = makeProject(a, "t-ch01", { bible: { ref_root: "/keep/this", cast: {} } });
    const put = (b) => fetch(`${a.base}/api/bible?p=t-ch01`, { method: "PUT", body: JSON.stringify(b) });
    for (const sheet of ["../../../../etc/passwd", "/etc/passwd", "bank/../../x.png"]) assert.equal((await put({ cast: { Ann: { desc: "A", sheet } } })).status, 400, sheet);
    assert.equal((await put({ cast: { Ann: { desc: "A", sheet: "bank/ann.png" } }, ref_root: "/" })).status, 200);
    const b = JSON.parse(readFileSync(join(dir, "bible.json"), "utf8"));
    assert.equal(b.ref_root, "/keep/this"); assert.equal(b.cast.Ann.sheet, "bank/ann.png");
  } finally { await a.stop(); }
});

test("the Artist's request tool refuses sheets and reference pictures outside the project", async () => {
  const a = await startApp();
  try {
    const secret = join(a.scratch, "secret.png"); png(secret);
    const dir = makeProject(a, "t-ch01", { bible: { cast: { Ann: { desc: "A", sheet: "../../../../secret.png" } } } });
    const saved = join(a.saved, "t-ch01.json"), req = (refList) => ({ project: "Test", pages: [{ id: "p1", number: 1, layout: { rows: [{ panels: [{ id: "a1", request: { status: "queued", source: "codex", prompt: "Ann waves.", refList } }] }] } }] });
    const tool = (spec) => { writeFileSync(saved, JSON.stringify(spec)); return spawnSync("node", [join(a.app, "tools/artist_requests.mjs"), dir, saved, join(a.saved, "refs"), "--only", "a1", "--auto"], { encoding: "utf8", env: { ...process.env, STUDIO_SERIES: a.series } }); };
    let r = tool(req([{ type: "bank", name: "Ann" }])); assert.notEqual(r.status, 0); assert.match(r.stderr, /not in the project/);
    r = tool(req([{ type: "panel", src: "../../../../secret.png" }])); assert.notEqual(r.status, 0); assert.match(r.stderr, /not in the project/);
    mkdirSync(join(dir, "art", "panels"), { recursive: true }); png(join(dir, "art", "panels", "x.png"));
    r = tool(req([{ type: "panel", src: "art/panels/x.png" }])); assert.equal(r.status, 0, r.stderr);
  } finally { await a.stop(); }
});

test("the line-up tool skips pictures outside the project", async () => {
  const a = await startApp();
  try {
    const secret = join(a.scratch, "secret.png"); png(secret);
    const dir = makeProject(a, "t-ch01", { bible: { cast: { Ann: { desc: "A" } } } });
    const pages = join(a.scratch, "pages.json");
    writeFileSync(pages, JSON.stringify({ pages: [{ number: 1, layout: { rows: [{ panels: [{ id: "a1", image: "../../../../secret.png", board: { who: [{ name: "Ann" }] } }, { id: "a2", image: secret, board: { who: [{ name: "Ann" }] } }] }] } }] }));
    const out = JSON.parse(execFileSync("/usr/bin/python3", [join(a.app, "tools/asset_lineup.py"), dir, pages]).toString().trim().split("\n").pop());
    assert.equal(out.pictures, 0);
    mkdirSync(join(dir, "art", "panels"), { recursive: true }); png(join(dir, "art", "panels", "x.png"));
    writeFileSync(pages, JSON.stringify({ pages: [{ number: 1, layout: { rows: [{ panels: [{ id: "a1", image: "art/panels/x.png", board: { who: [{ name: "Ann" }] } }] }] } }] }));
    assert.equal(JSON.parse(execFileSync("/usr/bin/python3", [join(a.app, "tools/asset_lineup.py"), dir, pages]).toString().trim().split("\n").pop()).pictures, 1);
    // the Checker is told where the storyboard put each person, so it can see a swap of sides
    writeFileSync(pages, JSON.stringify({ pages: [{ number: 1, layout: { rows: [{ panels: [{ id: "a1", image: "art/panels/x.png", board: { who: [{ name: "Ann", at: [0.8, 0.4], facing: "left" }, { name: "Bo", at: [0.2, 0.4], facing: "right" }] } }] }] } }] }));
    execFileSync("/usr/bin/python3", [join(a.app, "tools/asset_lineup.py"), dir, pages]);
    const L = JSON.parse(readFileSync(join(dir, "art", "check", "lineups.json"), "utf8"));
    assert.equal(L.panels[0].staging, "Ann on the right, facing left; Bo on the left, facing right");
  } finally { await a.stop(); }
});
