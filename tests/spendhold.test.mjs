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
    again(); // nothing is left held for the next test
  } finally { rmSync(saved, { recursive: true, force: true }); }
});
test("two paid jobs asked for in the same moment cannot both slip under the cap", async () => {
  const saved = mkdtempSync(join(tmpdir(), "ibasho-test-spend2-"));
  try {
    writeFileSync(join(saved, "spend-settings.json"), JSON.stringify({ askOver: 5, cap: 1 }));
    const got = await Promise.allSettled([1, 2, 3, 4].map(() => guardSpend(saved, 0.6, "This picture")));
    assert.equal(got.filter((g) => g.status === "fulfilled").length, 1, "one fits under a $1 cap at $0.60 each");
    assert.ok(got.filter((g) => g.status === "rejected").every((g) => /spending cap/.test(g.reason.message)));
    got.find((g) => g.status === "fulfilled").value(); // given back: the others' refusals do not block what comes after
    assert.equal(typeof (await guardSpend(saved, 0.6, "This picture")), "function");
  } finally { rmSync(saved, { recursive: true, force: true }); }
});
