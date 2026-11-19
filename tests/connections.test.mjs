// Smaller audit items in Connections: a key is never echoed back in an error; the ComfyUI test no longer reports on other machines.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startApp } from "./harness.mjs";

test("a key with a bad character never comes back in a message or the saved test note", async () => {
  const a = await startApp();
  try {
    const key = "sk-or-SECRETSECRET\u0000SECONDHALF"; // a character no header may carry: fetch fails before anything is sent (no request leaves this computer)
    const r = await (await fetch(`${a.base}/api/connections`, { method: "POST", body: JSON.stringify({ id: "anthropic", secret: key }) })).json();
    assert.doesNotMatch(JSON.stringify(r), /SECRETSECRET|SECONDHALF/);
    assert.doesNotMatch(JSON.stringify(JSON.parse(readFileSync(join(a.saved, "connections.json"), "utf8")).anthropic.last), /SECRET|SECOND/);
    assert.match(JSON.stringify(JSON.parse(readFileSync(join(a.saved, "connections.json"), "utf8")).anthropic.last), /a character no key has/);
  } finally { await a.stop(); }
});

test("the ComfyUI test says only whether a ComfyUI answered", async () => {
  const other = http.createServer((q, s) => { s.statusCode = 401; s.end("router login"); }); await new Promise((ok) => other.listen(0, "127.0.0.1", ok));
  const comfy = http.createServer((q, s) => { s.setHeader("content-type", "application/json"); s.end(JSON.stringify({ system: { os: "posix" }, devices: [{ name: "cuda:0 RTX" }] })); }); await new Promise((ok) => comfy.listen(0, "127.0.0.1", ok));
  const a = await startApp();
  try {
    const t = async (secret) => { const r = await (await fetch(`${a.base}/api/connections`, { method: "POST", body: JSON.stringify({ id: "comfyui", secret }) })).json(); return (r.services || r.list || []).find ? JSON.stringify(r) : JSON.stringify(r); };
    const closed = await t("http://127.0.0.1:9"), open = await t(`http://127.0.0.1:${other.address().port}`), ok = await t(`http://127.0.0.1:${comfy.address().port}`), file = await t("file:///etc/passwd");
    assert.match(closed, /No ComfyUI answered/); assert.match(open, /No ComfyUI answered/); assert.doesNotMatch(open, /401|refused/);
    assert.match(ok, /ComfyUI answered\. It runs on cuda:0 RTX/); assert.match(file, /Use an http/);
  } finally { await a.stop(); other.close(); comfy.close(); }
});
