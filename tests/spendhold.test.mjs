// A paid job that fails before anything was sent gives its held amount back: the retry is not refused by the cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardSpend } from "../page-editor/spend.mjs";

test("the cap counts a job under way, and stops counting it when the job fails unpaid", async () => {
  const saved = mkdtempSync(join(tmpdir(), "ibasho-test-spend-"));
  try {
    writeFileSync(join(saved, "spend-settings.json"), JSON.stringify({ askOver: 5, cap: 1 }));
    const free = await guardSpend(saved, 0.6, "This picture");
    await assert.rejects(guardSpend(saved, 0.6, "This picture"), /spending cap/);
    free(); free(); // twice is harmless
    const again = await guardSpend(saved, 0.6, "This picture");
    assert.equal(typeof again, "function");
    await assert.rejects(guardSpend(saved, 0.6, "This picture", { usd: 0, asked: false }), /spending cap/);
  } finally { rmSync(saved, { recursive: true, force: true }); }
});
