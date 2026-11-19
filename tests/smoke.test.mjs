import { test } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "./harness.mjs";
test("the copy starts and answers", async () => {
  const a = await startApp();
  try { assert.equal(await (await fetch(a.base + "/api/ping")).text(), "ok"); } finally { await a.stop(); }
});
