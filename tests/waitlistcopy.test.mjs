// The landing page's waitlist keeps a second copy; a sign-up that only one of the two files has is put back in the other at start.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { REPO } from "./harness.mjs";
const SERVER = join(REPO, "landing", "server.mjs");
const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });
async function start(dir) {
  const port = await freePort(), child = spawn(process.execPath, [SERVER, String(port)], { env: { ...process.env, WAITLIST_FILE: join(dir, "a", "waitlist.jsonl"), WAITLIST_COPY: join(dir, "b", "copy.jsonl"), WAITLIST_TOKEN: "t".repeat(32) }, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`; for (let i = 0; i < 80; i++) { try { await fetch(base + "/"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  return { base, stop: () => new Promise((r) => { child.once("exit", r); child.kill(); }) };
}
const emails = (f) => (existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).email) : []);
const join1 = (base, email) => fetch(base + "/api/waitlist", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email }) });

test("every sign-up is written twice, and a lost or cut-short list is mended from the other copy", { skip: !existsSync(SERVER) }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ibasho-test-waitlist-")), A = join(dir, "a", "waitlist.jsonl"), B = join(dir, "b", "copy.jsonl");
  try {
    let app = await start(dir), r1, r2;
    try { r1 = (await join1(app.base, "kai@example.com")).status; r2 = (await join1(app.base, "aya@example.com")).status; } finally { await app.stop(); }
    assert.equal(r1, 200); assert.equal(r2, 200);
    assert.deepEqual(emails(A), ["kai@example.com", "aya@example.com"]); assert.deepEqual(emails(B), emails(A), "the second copy has the same sign-ups");
    rmSync(A); writeFileSync(B, readFileSync(B, "utf8") + "{ a damaged line\n"); // the list is lost; the copy has a bad line
    app = await start(dir); let again;
    try { again = await (await join1(app.base, "kai@example.com")).json(); await join1(app.base, "mio@example.com"); } finally { await app.stop(); }
    assert.ok(again.already, "the people in the copy are still known");
    assert.deepEqual(emails(A).sort(), ["aya@example.com", "kai@example.com", "mio@example.com"], "the list was written back from the copy, and takes new sign-ups");
    writeFileSync(B, ""); app = await start(dir); await app.stop();
    assert.deepEqual(emails(B).sort(), ["aya@example.com", "kai@example.com", "mio@example.com"], "an emptied copy is filled again from the list");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
