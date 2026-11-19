// List 1, job 1: the access code on the Settings screen comes from GET /api/access, which answers only the computer itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { networkInterfaces } from "node:os";
import { startApp } from "./harness.mjs";

const lan = Object.values(networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal);

test("GET /api/access gives the code, the port and addresses to this computer only", async () => {
  const a = await startApp(undefined, { env: { STUDIO_ADDRESSES: "192.168.0.20,100.64.0.7" } });
  try {
    const r = await (await fetch(a.base + "/api/access")).json();
    assert.match(r.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.equal(r.port, a.port);
    assert.deepEqual(r.addresses.slice(0, 2), ["192.168.0.20", "100.64.0.7"]);
    if (lan) { // the same request from another address of this machine counts as another device
      const far = await fetch(`http://${lan.address}:${a.port}/api/access`);
      assert.equal(far.status, 403);
      const page = await fetch(`http://${lan.address}:${a.port}/api/projects`);
      assert.equal(page.status, 401);
      const inside = await fetch(`http://${lan.address}:${a.port}/api/projects`, { headers: { "x-ibasho-access": r.code } });
      assert.equal(inside.status, 200);
    }
    const js = await (await fetch(a.base + "/studio.js")).text();
    assert.match(js, /Let another device in/);
  } finally { await a.stop(); }
});

test("a malformed address is answered, and the app keeps running", async () => {
  const { request } = await import("node:http");
  const a = await startApp();
  try {
    const status = await new Promise((ok, no) => { const r = request({ host: "127.0.0.1", port: a.port, path: "//", method: "GET" }, (res) => { res.resume(); ok(res.statusCode); }); r.on("error", no); r.end(); });
    assert.equal(status, 400);
    assert.equal((await fetch(a.base + "/api/ping")).status, 200);
  } finally { await a.stop(); }
});

test("a request relayed by a proxy on this computer is not this computer: no code is handed out, a broken cookie is no cookie", async () => {
  const a = await startApp();
  try {
    assert.equal((await fetch(a.base + "/api/access")).status, 200);
    assert.equal((await fetch(a.base + "/api/access", { headers: { "x-forwarded-for": "100.64.0.9" } })).status, 403);
    const r = await fetch(a.base + "/api/projects", { headers: { "x-forwarded-for": "100.64.0.9", cookie: "ibasho_access=%E0%A4%A" } });
    assert.equal(r.status, 401);
  } finally { await a.stop(); }
});
