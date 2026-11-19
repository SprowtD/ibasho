// Audit items 8 and 9: reserved names are refused; a character rename finishes everywhere or changes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startApp, makeProject } from "./harness.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
test("__proto__, constructor and prototype are never names", async () => {
  const a = await startApp();
  try {
    const dir = makeProject(a, "t-ch01");
    for (const n of ["__proto__", "constructor", "prototype"]) {
      assert.equal((await fetch(`${a.base}/api/sheet?p=t-ch01&name=${n}`, { method: "PUT", body: JSON.stringify({ dataUrl: PNG }) })).status, 400, "upload " + n);
      assert.equal((await fetch(`${a.base}/api/sheet?p=t-ch01&name=${n}`, { method: "POST" })).status, 400, "draw " + n);
      assert.equal((await fetch(`${a.base}/api/bible?p=t-ch01`, { method: "PUT", body: `{"cast":{"${n}":{"desc":"x","approved":true}}}` })).status, 400, "bible " + n);
    }
    assert.equal(JSON.parse(readFileSync(join(dir, "bible.json"), "utf8")).cast.constructor, Object, "no own key was written");
    // an ordinary name still works
    assert.equal((await fetch(`${a.base}/api/sheet?p=t-ch01&name=Ann`, { method: "PUT", body: JSON.stringify({ dataUrl: PNG }) })).status, 200);
    assert.ok(JSON.parse(readFileSync(join(dir, "bible.json"), "utf8")).cast.Ann.sheet);
  } finally { await a.stop(); }
});

test("renaming a character with brackets in the name reaches every file", async () => {
  const a = await startApp();
  try {
    const dir = makeProject(a, "t-ch01", { bible: { cast: { "Ann (young)": { desc: "ANN (YOUNG): a girl." } } } });
    writeFileSync(join(dir, "script.json"), JSON.stringify({ lines: [{ speaker: "Ann (young)", text: "Hi." }] }));
    writeFileSync(join(a.saved, "t-ch01.json"), JSON.stringify({ pages: [{ id: "p1", layout: { rows: [{ panels: [{ id: "a1", board: { who: [{ name: "Ann (young)" }], action: "Ann (young) waves at $1." } }] }] } }] }));
    const r = await fetch(`${a.base}/api/cast/rename?p=t-ch01`, { method: "POST", body: JSON.stringify({ from: "Ann (young)", to: "Annie $&" }) });
    assert.equal(r.status, 200, await r.text());
    const b = JSON.parse(readFileSync(join(dir, "bible.json"), "utf8")), sc = JSON.parse(readFileSync(join(dir, "script.json"), "utf8")), sv = JSON.parse(readFileSync(join(a.saved, "t-ch01.json"), "utf8"));
    assert.deepEqual(Object.keys(b.cast), ["Annie $&"]);
    assert.equal(sc.lines[0].speaker, "Annie $&");
    const q = sv.pages[0].layout.rows[0].panels[0].board; assert.equal(q.who[0].name, "Annie $&"); assert.equal(q.action, "Annie $& waves at $1.");
  } finally { await a.stop(); }
});

test("a rename that cannot finish changes nothing and says why", async () => {
  const a = await startApp();
  try {
    const dir = makeProject(a, "t-ch01", { bible: { cast: { Ann: { desc: "ANN." } } } });
    writeFileSync(join(dir, "script.json"), "{ broken");
    const r = await fetch(`${a.base}/api/cast/rename?p=t-ch01`, { method: "POST", body: JSON.stringify({ from: "Ann", to: "Bea" }) });
    assert.equal(r.status, 400); assert.match((await r.json()).error, /script\.json is not readable/);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, "bible.json"), "utf8")).cast), ["Ann"]);
    assert.equal((await fetch(`${a.base}/api/cast/rename?p=t-ch01`, { method: "POST", body: JSON.stringify({ from: "Ann", to: "__proto__" }) })).status, 400);
  } finally { await a.stop(); }
});
