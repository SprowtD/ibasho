// Smaller audit item: scene ids that differ only in punctuation share one folder, so they must share one job lock too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startApp, makeScene, codexCalls } from "./harness.mjs";

test("a.b and a_b are one scene, with one Blocking pass at a time", async () => {
  const a = await startApp(undefined, { env: { FAKE_CODEX_SLEEP: "3000" } });
  try {
    makeScene(a, "a_b");
    const one = await (await fetch(`${a.base}/api/anime/block?id=a.b`, { method: "POST", body: "{}" })).json();
    const two = await (await fetch(`${a.base}/api/anime/block?id=a_b`, { method: "POST", body: "{}" })).json();
    assert.equal(one.status, "running"); assert.equal(two.at, one.at, "the second ask gets the job already running");
    await new Promise((r) => setTimeout(r, 500)); assert.equal(codexCalls(a).length, 1);
  } finally { await a.stop(); }
});
