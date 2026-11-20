// Publish, in a real browser: the Chapter screen's dialog against a stand-in reading site (no real site is reached).
// Same safety as the other screen tests.
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  publish (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
import http from "node:http";
const PORT = 5387, tmp = scratch("uipublish"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-publish-test", KEY = "ibr_1a2b3c4d_" + "k".repeat(48);
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
const dir = path.join(PE, "projects", ID);
fs.mkdirSync(dir, { recursive: true }); fs.cpSync(path.join(APP, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true, force: true });
execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), dir]);
const got = [], drafts = new Map(); let SITE = "";
const site = http.createServer(async (req, res) => {
  const send = (code, j) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); }, chunks = []; for await (const c of req) chunks.push(c);
  if (req.headers.authorization !== "Bearer " + KEY) return send(401, { error: "Missing or invalid publishing key.", code: "unauthorized" });
  if (req.method === "GET") return send(200, { author: "Tester", books: [{ id: 7, title: "Ferry", book_label: "Book One", published: true, url: "", chapters: [{ number: 1, title: "One", pages: 20, status: "published" }, { number: 2, title: "Two", pages: 9, status: "draft" }, ...[...drafts.values()]] }] });
  const fd = await new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers["content-type"] } }).formData(), pages = fd.getAll("pages"), number = +fd.get("number");
  got.push({ number, title: fd.get("title"), replace: fd.get("replace"), names: pages.map((p) => p.name) });
  if ((number === 2 || drafts.has(number)) && fd.get("replace") !== "true") return send(409, { error: "A draft with that number is already here.", code: "chapter_exists" });
  const was = number === 2 || drafts.has(number); drafts.set(number, { number, title: fd.get("title"), pages: pages.length, status: "draft" });
  send(was ? 200 : 201, { chapter: { number, title: fd.get("title"), pages: pages.length, status: "draft", preview_url: "", review_url: SITE + "/studio/stories/7/chapters/" + number + "/" }, message: "Received as a draft." });
});
await new Promise((r) => site.listen(0, "127.0.0.1", r)); SITE = "http://127.0.0.1:" + site.address().port;
const srv = spawn("node", [path.join(PE, "server.mjs"), String(PORT)], { stdio: "ignore",
  env: { ...process.env, PATH: bin + ":" + process.env.PATH, STUDIO_SAVED: path.join(tmp, "saved"), STUDIO_ANIME: path.join(tmp, "anime"), STUDIO_LOOKS: path.join(tmp, "looks"), OPENROUTER_BASE: "http://127.0.0.1:9" } });
let browser;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(U + "/api/ping")).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  for (const vp of [{ width: 1400, height: 1100 }, { width: 390, height: 800 }]) {
    const page = await browser.newPage({ viewport: vp }), at = vp.width < 600 ? "phone" : "desktop", first = at === "desktop";
    const errors = [], asked = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("dialog", (d) => { asked.push(d.message()); d.accept(); });
    const shot = async (n, sel) => { if (process.env.IBASHO_SHOTS) await (sel ? page.locator(sel) : page).screenshot({ path: path.join(process.env.IBASHO_SHOTS, n + "-" + at + ".png") }); };
    await page.goto(U + "/"); await page.waitForSelector("#projSel option", { state: "attached" });
    await page.evaluate((id) => { document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
    await page.waitForFunction((id) => localStorage.getItem("ld-project") === id && /pages/.test(document.getElementById("sbProj").textContent), ID);
    await page.evaluate(() => document.querySelector('#modeTabs [data-mode="chapter"]').click()); await page.waitForSelector("#publishBtn", { state: "attached" });
    await page.evaluate(() => document.getElementById("publishBtn").click()); await page.waitForSelector("#pubDlg[open]");
    if (first) {
      await page.waitForFunction(() => /not set up yet/.test(document.getElementById("pubSetState").textContent));
      ok(await page.isHidden("#pubForm") && await page.isDisabled("#pubGo") && await page.inputValue("#pubSite") === "https://read.ibasho.studio" && /private draft/.test(await page.textContent("#pubDlg")), at + ": before a key is saved there is only the settings, with the site's usual address, and it says the chapter goes as a private draft");
      await page.fill("#pubSite", "http://example.com"); await page.fill("#pubKey", KEY); await page.click("#pubSave");
      await page.waitForFunction(() => /https:\/\//.test(document.getElementById("pubSetNote").textContent));
      ok(/must start with https/.test(await page.textContent("#pubSetNote")), at + ": a plain http address that is not this computer is refused");
      await page.fill("#pubSite", SITE); await page.fill("#pubKey", "ibr_00000000_" + "w".repeat(48)); await page.click("#pubSave");
      await page.waitForFunction(() => /does not work/.test(document.getElementById("pubSetNote").textContent));
      ok(await page.isHidden("#pubForm"), at + ": a wrong key says so and nothing can be sent");
      await page.fill("#pubKey", KEY); await page.click("#pubSave");
    }
    await page.waitForFunction(() => /connected$/.test(document.getElementById("pubSetState").textContent.trim()) && !document.getElementById("pubForm").hidden, null, { timeout: 15000 });
    ok(/ibr_1a2b3c4d_••••/.test(await page.textContent("#pubKeyNow")) && await page.inputValue("#pubKey") === "" && !(await page.content()).includes("kkkkkk"), at + ": the saved key is shown masked and is nowhere in the page");
    ok(/Book One · Ferry/.test(await page.textContent("#pubBook")), at + ": the book list comes from the site");
    if (first) {
      ok(await page.inputValue("#pubNumber") === "3" && await page.inputValue("#pubTitle") === "Chapter 3", at + ": the number offered is one after the highest on the site: " + await page.inputValue("#pubNumber"));
      await page.fill("#pubNumber", "1"); ok(/already published on the site and cannot be replaced/.test(await page.textContent("#pubNumberNote")) && await page.isDisabled("#pubGo"), at + ": a number that is public on the site cannot be sent");
      await page.fill("#pubNumber", "3"); await page.fill("#pubTitle", "Third Crossing"); await shot("publish-form", "#pubDlg");
      await page.click("#pubGo"); await page.waitForFunction(() => /Sent to Ibasho Read as a draft/.test(document.getElementById("pubResult").textContent), null, { timeout: 120000 });
      const g = got.at(-1), n = await page.evaluate(() => document.querySelectorAll("#side [data-page]").length);
      ok(g.number === 3 && g.title === "Third Crossing" && g.names.length === n && g.names[0] === "001.png" && g.names.at(-1) === String(n).padStart(3, "0") + ".png" && g.replace === null, at + ": every page went, in order, as a new draft: " + JSON.stringify(g));
      ok(await page.isVisible("#pubOpen") && (await page.getAttribute("#pubOpen", "href")) === SITE + "/studio/stories/7/chapters/3/", at + ": the result offers the site's review page");
      await shot("publish-sent", "#pubDlg");
    } else {
      ok(await page.inputValue("#pubNumber") === "3" && await page.inputValue("#pubTitle") === "Third Crossing", at + ": opened again, it offers where this chapter went last time");
      asked.length = 0; await page.evaluate(() => document.getElementById("pubGo").click());
      await page.waitForFunction(() => /in place of the draft/.test(document.getElementById("pubResult").textContent), null, { timeout: 120000 });
      ok(asked.length === 1 && /Replace that draft/.test(asked[0]) && got.at(-1).replace === "true", at + ": sending the same number again asks first, then replaces the draft: " + JSON.stringify(asked));
      await shot("publish-phone", "#pubDlg");
    }
    ok(errors.length === 0, at + ": no script errors: " + errors.join(" | "));
    await page.close();
  }
  ok(!fs.readdirSync(dir).some((f) => { try { return fs.statSync(path.join(dir, f)).isFile() && fs.readFileSync(path.join(dir, f), "utf8").includes("kkkkkk"); } catch { return false; } }), "the key is in no project file");
} finally {
  if (browser) await browser.close();
  srv.kill(); site.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
done("publish to a reading site");
