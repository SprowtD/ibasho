// Audit item 6: file serving follows no links out, and serves only listed file types.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { startApp, makeProject, makeScene } from "./harness.mjs";

test("static files: the screens, a project's pages, settings and pictures; nothing else", async () => {
  const a = await startApp();
  try {
    const dir = makeProject(a, "t-ch01");
    writeFileSync(join(dir, "art", "panels", "a1-take01.png"), "png");
    writeFileSync(join(dir, "PANELER_TASK.md"), "/a/private/path");
    mkdirSync(join(dir, "history")); writeFileSync(join(dir, "history", "board.json"), "{}");
    writeFileSync(join(a.scratch, "outside.png"), "secret"); symlinkSync(join(a.scratch, "outside.png"), join(dir, "art", "panels", "link.png"));
    const st = async (path) => (await fetch(a.base + path)).status;
    for (const ok of ["/", "/index.html", "/editor.js", "/studio.css", "/ibasho-mark.svg", "/fonts/Bangers.ttf", "/core/styles.json", "/projects/t-ch01/spec.json", "/projects/t-ch01/bible.json", "/projects/t-ch01/art/panels/a1-take01.png", "/anime/", "/anime/app.js", "/anime/core/plan.js", "/anime/looks/clean-tv.jpg"])
      assert.equal(await st(ok), 200, ok);
    for (const no of ["/server.mjs", "/spend.mjs", "/projects/t-ch01/script.md", "/projects/t-ch01/PANELER_TASK.md", "/projects/t-ch01/project.json", "/projects/t-ch01/history/board.json", "/projects/t-ch01/art/panels/link.png", "/core/../page-editor/server.mjs", "/anime/core/export.mjs", "/anime/core/score.mjs", "/saved/access.json", "/../TODO.md", "/%2e%2e/TODO.md"])
      assert.notEqual(await st(no), 200, no);
    const r = await fetch(a.base + "/editor.js"); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  } finally { await a.stop(); }
});

test("scene media: only pictures in stills/ and look/, only sound in audio/", async () => {
  const a = await startApp();
  try {
    const dir = makeScene(a, "s1");
    for (const d of ["stills", "audio", "look"]) mkdirSync(join(dir, d));
    writeFileSync(join(dir, "stills", "a.png"), "x"); writeFileSync(join(dir, "stills", "evil.html"), "<script>alert(1)</script>"); writeFileSync(join(dir, "audio", "v.mp3"), "x"); writeFileSync(join(dir, "audio", "evil.html"), "x"); writeFileSync(join(dir, "look", "x.svg"), "<svg/>");
    const st = async (f) => (await fetch(`${a.base}/api/anime/media?id=s1&f=${encodeURIComponent(f)}`)).status;
    assert.equal(await st("stills/a.png"), 200); assert.equal(await st("audio/v.mp3"), 200);
    for (const f of ["stills/evil.html", "audio/evil.html", "look/x.svg", "SCENE_PLAN.json", "stills/../SCENE_PLAN.json"]) assert.equal(await st(f), 404, f);
  } finally { await a.stop(); }
});
