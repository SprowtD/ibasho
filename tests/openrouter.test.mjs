// Smaller audit item: what OpenRouter sends back is checked (kind and size) before it is saved. A stand-in OpenRouter on this computer.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let answer = {};
const fake = http.createServer((q, s) => {
  if (q.url.startsWith("/api/v1/images")) { s.setHeader("content-type", "application/json"); return s.end(JSON.stringify({ data: [answer.picture] })); }
  if (q.url === "/api/v1/videos") { s.setHeader("content-type", "application/json"); return s.end(JSON.stringify({ id: "v1", status: "completed", polling_url: "/api/v1/videos/v1" })); }
  if (q.url.startsWith("/api/v1/videos/v1/content")) return s.end(answer.video);
  if (q.url === "/file.html") return s.end("<html>not a picture</html>");
  s.statusCode = 404; s.end();
});
await new Promise((ok) => fake.listen(0, "127.0.0.1", ok));
process.env.OPENROUTER_BASE = `http://127.0.0.1:${fake.address().port}`;
const { orPicture, orVideo } = await import("../page-editor/openrouter.mjs");

test("a picture must be a picture; a link must be https", async () => {
  answer.picture = { b64_json: PNG.toString("base64") }; assert.ok((await orPicture("k", "m", { prompt: "x" })).bytes.length);
  answer.picture = { b64_json: Buffer.from("<script>alert(1)</script>").toString("base64") }; await assert.rejects(orPicture("k", "m", { prompt: "x" }), /not a picture/);
  answer.picture = { url: "http://example.invalid/x.png" }; await assert.rejects(orPicture("k", "m", { prompt: "x" }), /not a secure address/);
  answer.picture = { url: process.env.OPENROUTER_BASE + "/file.html" }; await assert.rejects(orPicture("k", "m", { prompt: "x" }), /not a picture/);
});
test("a video must be a video", async () => {
  answer.video = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(100)]); assert.ok((await orVideo("k", "m", { prompt: "x" })).bytes.length);
  answer.video = "<html>oops</html>"; await assert.rejects(orVideo("k", "m", { prompt: "x" }), /not a video/);
  fake.close();
});
