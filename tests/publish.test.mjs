// Publish: a finished chapter goes to the person's reading site as a private draft. The site here is a stand-in that keeps to
// the site's own handoff (keys, limits, answers); no real site is reached.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { startApp } from "./harness.mjs";

const KEY = "ibr_1a2b3c4d_" + "k".repeat(48), ID = "my-story-ch03";
let app, site, siteUrl, cancelled = false; const got = [], drafts = new Map(); // what the stand-in site received
const py = (code, ...args) => execFileSync("/usr/bin/python3", ["-c", code, ...args], { maxBuffer: 1 << 26 }).toString().trim();
const api = async (path, method = "GET", body) => { const r = await fetch(app.base + path, { method, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json() }; };
const exportPages = (n, w = 2048, h = 3072) => { const dir = join(app.saved, "exports", ID); mkdirSync(dir, { recursive: true }); for (const f of existsSync(dir) ? readdirSync(dir) : []) execFileSync("rm", ["-f", join(dir, f)]);
  py("import sys\nfrom PIL import Image\nfor i in range(1, int(sys.argv[2]) + 1): Image.new('RGB', (int(sys.argv[3]), int(sys.argv[4])), (i * 9 % 255, 90, 160)).save(f'{sys.argv[1]}/page-{i:02d}.png')", dir, String(n), String(w), String(h)); };

before(async () => {
  site = http.createServer(async (req, res) => {
    const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    const chunks = []; for await (const c of req) chunks.push(c);
    if (req.headers.authorization !== "Bearer " + KEY || cancelled) return send(401, { error: "That key is missing, mistyped or cancelled.", code: "unauthorized" });
    const books = [{ id: 1, title: "The Girl Who Noticed", book_label: "Book One", published: true, url: siteUrl + "/stories/1/", chapters: [
      { number: 1, title: "One", pages: 20, status: "published", preview_url: "", review_url: "" }, ...[...drafts.values()].map((d) => ({ number: d.number, title: d.title, pages: d.pages, status: "draft", preview_url: "", review_url: "" }))] }];
    if (req.method === "GET" && req.url === "/api/v1/books/") return send(200, { author: "Tester", books });
    const m = /^\/api\/v1\/books\/(\d+)\/chapters\/$/.exec(req.url);
    if (req.method === "POST" && m) {
      if (m[1] !== "1") return send(404, { error: "That book was not found.", code: "book_not_found" });
      const fd = await new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers["content-type"] } }).formData(), pages = fd.getAll("pages"), number = +fd.get("number");
      got.push({ number, title: fd.get("title"), thumb: fd.get("thumbnail_page"), notes: fd.get("notes"), replace: fd.get("replace"), names: pages.map((p) => p.name), types: pages.map((p) => p.type), bytes: pages.reduce((a, p) => a + p.size, 0), first: Buffer.from(await pages[0].arrayBuffer()) });
      if (number === 1) return send(409, { error: "Chapter 1 is already published.", code: "chapter_published" });
      if (drafts.has(number) && fd.get("replace") !== "true") return send(409, { error: "A draft of chapter " + number + " is already on the site.", code: "chapter_exists" });
      const was = drafts.has(number); drafts.set(number, { number, title: fd.get("title"), pages: pages.length });
      return send(was ? 200 : 201, { chapter: { number, title: fd.get("title"), pages: pages.length, status: "draft", preview_url: siteUrl + "/stories/1/chapters/" + number + "/", review_url: siteUrl + "/studio/stories/1/chapters/12/" }, message: "Received as a draft. Review it in the studio, then publish." });
    }
    send(404, { error: "not found", code: "not_found" });
  });
  await new Promise((r) => site.listen(0, "127.0.0.1", r)); siteUrl = "http://127.0.0.1:" + site.address().port;
  app = await startApp();
});
after(async () => { await app.stop(); site.close(); });

test("settings: the site address must be https (plain http only on this computer); a saved key is tested and shown only masked", async () => {
  assert.deepEqual((await api("/api/publish")).j.key, ""); assert.equal((await api("/api/publish")).j.site, "https://read.ibasho.studio");
  assert.equal((await api("/api/publish", "POST", { site: "http://example.com" })).status, 400);
  assert.equal((await api("/api/publish", "POST", { site: siteUrl, key: "short" })).status, 400);
  let s = (await api("/api/publish", "POST", { site: siteUrl + "/anything", key: "ibr_1a2b3c4d_" + "x".repeat(48) })).j;
  assert.equal(s.connected, false); assert.match(s.last.msg, /key does not work/); assert.equal(s.site, siteUrl);
  s = (await api("/api/publish", "POST", { key: "  " + KEY.slice(0, 20) + "\n" + KEY.slice(20) + " " })).j; // pasted with a line break
  assert.equal(s.connected, true); assert.equal(s.key, "ibr_1a2b3c4d_••••"); assert.match(s.last.msg, /Connected as Tester\. 1 manga book\./); assert.equal(s.keys_at, siteUrl + "/studio/keys/");
  assert.ok(!JSON.stringify(s).includes("kkkk"), "the key itself never goes back to the screen");
  const f = join(app.saved, "publish.json"); assert.equal(JSON.parse(readFileSync(f, "utf8")).key, KEY); assert.equal(statSync(f).mode & 0o777, 0o600, "kept in a file only this person can read");
  const b = (await api("/api/publish/books")).j; assert.equal(b.author, "Tester"); assert.equal(b.books[0].book_label, "Book One"); assert.ok(!JSON.stringify(b).includes("kkkk"));
});
test("a chapter is sent as a draft: every exported page, in order, named 001 002 ..., at most 2,000 px wide", async () => {
  assert.equal((await api(`/api/publish/send?p=${ID}`, "POST", { book: 1, number: "3", title: "Silver Eyes" })).j.code, "no_pages");
  exportPages(12);
  assert.equal((await api(`/api/publish/check?p=${ID}`)).j.pages, 12);
  for (const [body, code] of [[{ number: "3", title: "x" }, "no_book"], [{ book: 1, number: "0", title: "x" }, "bad_number"], [{ book: 1, number: "3.5", title: "x" }, "bad_number"], [{ book: 1, number: "3", title: " " }, "bad_title"], [{ book: 1, number: "3", title: "x", notes: "n".repeat(5001) }, "bad_notes"]])
    assert.equal((await api(`/api/publish/send?p=${ID}`, "POST", body)).j.code, code);
  assert.equal(got.length, 0, "nothing was sent while a field was wrong");
  const r = await api(`/api/publish/send?p=${ID}`, "POST", { book: 1, number: "3", title: "Silver Eyes", thumbnail_page: "2", notes: "Thank you for reading." });
  assert.equal(r.status, 200); assert.equal(r.j.ok, true); assert.equal(r.j.status, 201); assert.match(r.j.message, /Sent to Ibasho Read as a draft/); assert.equal(r.j.sent.review_url, siteUrl + "/studio/stories/1/chapters/12/"); assert.equal(r.j.sent.replaced, false);
  const g = got[0]; assert.deepEqual(g.names, Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(3, "0") + ".png")); assert.ok(g.types.every((t) => t === "image/png"));
  assert.equal(g.number, 3); assert.equal(g.title, "Silver Eyes"); assert.equal(g.thumb, "2"); assert.equal(g.notes, "Thank you for reading."); assert.equal(g.replace, null);
  const f = join(app.scratch, "first.png"); (await import("node:fs")).writeFileSync(f, g.first);
  assert.deepEqual(JSON.parse(py("import sys,json\nfrom PIL import Image\nim=Image.open(sys.argv[1]); print(json.dumps([im.width, im.height, im.getpixel((5,5))]))", f)), [2000, 3000, [9, 90, 160]], "page 1 first, scaled to 2,000 px wide");
  assert.deepEqual((await api(`/api/publish/sent?p=${ID}`)).j.number, 3, "where it went is remembered for next time");
});
test("the same number again: the site says a draft exists; with a yes it is replaced. A public chapter is never replaced", async () => {
  let r = await api(`/api/publish/send?p=${ID}`, "POST", { book: 1, number: "3", title: "Silver Eyes" });
  assert.equal(r.status, 409); assert.equal(r.j.code, "chapter_exists"); assert.match(r.j.error, /draft of chapter 3/);
  r = await api(`/api/publish/send?p=${ID}`, "POST", { book: 1, number: "3", title: "Silver Eyes, again", replace: true });
  assert.equal(r.j.ok, true); assert.equal(r.j.status, 200); assert.equal(r.j.sent.replaced, true); assert.equal(got.at(-1).replace, "true");
  r = await api(`/api/publish/send?p=${ID}`, "POST", { book: 1, number: "1", title: "One" });
  assert.equal(r.status, 409); assert.equal(r.j.code, "chapter_published"); assert.match(r.j.next, /cannot be replaced from Ibasho/);
  assert.equal((await api(`/api/publish/send?p=${ID}`, "POST", { book: 9, number: "4", title: "x" })).j.code, "book_not_found");
});
test("over the site's limits it is stopped here, before anything is sent", async () => {
  const before = got.length; exportPages(101, 200, 300);
  const r = await api(`/api/publish/send?p=${ID}`, "POST", { book: 1, number: "5", title: "Too long" });
  assert.equal(r.status, 400); assert.equal(r.j.code, "too_many_pages"); assert.match(r.j.error, /101 pages and the site takes 100/); assert.equal(got.length, before);
  assert.match((await api(`/api/publish/check?p=${ID}`)).j.problems.join(" "), /Split it in two/);
});
test("a cancelled key, and a site that is not there: a plain message, and the key appears in no answer, log or other file", async () => {
  exportPages(2, 400, 600); cancelled = true;
  let r = await api(`/api/publish/send?p=${ID}`, "POST", { book: 1, number: "6", title: "x" });
  assert.equal(r.status, 401); assert.match(r.j.next, /Make a new one on the site/);
  assert.equal((await api("/api/publish/test", "POST")).j.connected, false); cancelled = false;
  await api("/api/publish", "POST", { site: "http://127.0.0.1:9" });
  r = await api(`/api/publish/send?p=${ID}`, "POST", { book: 1, number: "6", title: "x" });
  assert.equal(r.j.code, "network"); assert.match(r.j.error, /could not be reached.*Nothing was saved there/);
  assert.ok(!app.out().includes("kkkk"), "not in the app's log");
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const holders = walk(app.saved).filter((f) => statSync(f).size < 5e6 && readFileSync(f).includes("kkkkkkkk"));
  assert.deepEqual(holders, [join(app.saved, "publish.json")], "the key is in the one settings file and nowhere else");
  assert.equal((await api("/api/publish", "DELETE")).j.key, ""); assert.ok(!readFileSync(join(app.saved, "publish.json"), "utf8").includes("kkkk"), "Forget takes it off this computer");
});
