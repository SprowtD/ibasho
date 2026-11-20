// Home: a chapter or book put away only leaves the list (nothing on disk moves), and comes back; each chapter says when it was last worked on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { copyApp, startApp, makeProject } from "./harness.mjs";

const post = (app, body) => fetch(app.base + "/api/put-away", { method: "POST", body: JSON.stringify(body) });

test("put a chapter away and bring it back: only a mark in saved/home.json changes", async () => {
  const copy = copyApp(), dir = makeProject(copy, "zz-one"); makeProject(copy, "zz-two", { spec: { chapter: 2 } });
  const app = await startApp(copy);
  try {
    const files = () => readdirSync(dir).sort().join(",");
    const before = files(), list = async () => (await (await fetch(app.base + "/api/projects")).json());
    const one = (await list()).find((q) => q.id === "zz-one");
    assert.equal(one.archived, false); assert.match(one.changed, /^\d{4}-\d\d-\d\dT/);
    let r = await post(app, { kind: "project", id: "zz-one", on: true }); assert.equal(r.status, 200);
    assert.equal((await list()).find((q) => q.id === "zz-one").archived, true);
    assert.equal((await list()).find((q) => q.id === "zz-two").archived, false);
    assert.equal(files(), before); assert.ok(existsSync(join(dir, "spec.json")));
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(copy.saved, "home.json"), "utf8")).archived), ["project:zz-one"]);
    assert.equal((await fetch(app.base + "/api/project?p=zz-one")).status, 200); // still opens
    r = await post(app, { kind: "project", id: "zz-one", on: false }); assert.equal(r.status, 200);
    assert.equal((await list()).find((q) => q.id === "zz-one").archived, false);
    assert.deepEqual(JSON.parse(readFileSync(join(copy.saved, "home.json"), "utf8")).archived, {});
  } finally { await app.stop(); }
});

test("a chapter or book that is not there, or a name that is a path, is refused and nothing is written", async () => {
  const copy = copyApp(); makeProject(copy, "zz-one");
  const app = await startApp(copy);
  try {
    for (const b of [{ kind: "project", id: "nobody", on: true }, { kind: "book", id: "nobody", on: true }, { kind: "project", id: "../zz-one", on: true }, { kind: "project", id: "__proto__", on: true }, { kind: "book", id: "", on: true }])
      assert.equal((await post(app, b)).status, 404, JSON.stringify(b));
    assert.equal(existsSync(join(copy.saved, "home.json")), false);
    assert.equal((await fetch(app.base + "/api/put-away", { method: "POST", body: "not json" })).status, 400);
  } finally { await app.stop(); }
});
