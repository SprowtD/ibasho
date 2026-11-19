// Smaller audit item: a failure answers 400/500 with its reason and is logged, not "404 not found".
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { startApp, makeProject, makeScene } from "./harness.mjs";

test("bad input is 400, a broken saved file is 500 with a reason and a log line, a missing file is 404", async () => {
  const a = await startApp();
  try {
    makeProject(a, "t-ch01"); makeScene(a, "s1");
    let r = await fetch(`${a.base}/api/cover?p=t-ch01`, { method: "PUT", body: "{nope" });
    assert.equal(r.status, 404, "no board.json: that project has no cover page to set");
    r = await fetch(`${a.base}/api/faces?p=t-ch01&src=x`, { method: "PUT", body: "{nope" });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /not readable JSON/);
    r = await fetch(`${a.base}/api/anime/sound?id=s1`, { method: "PUT", body: "{nope" });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /not readable JSON/);
    mkdirSync(join(a.series, "book")); writeFileSync(join(a.series, "book", "series.json"), "{broken");
    r = await fetch(`${a.base}/api/series?id=book`);
    assert.equal(r.status, 500); assert.match((await r.json()).error, /saved file could not be read/);
    await new Promise((ok) => setTimeout(ok, 100)); assert.match(a.out(), /GET \/api\/series/);
    assert.equal((await fetch(`${a.base}/nothing-here.html`)).status, 404);
  } finally { await a.stop(); }
});
