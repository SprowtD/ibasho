// A panel that takes up an entire page, in a real browser: framed inside the margins, or to the page's edges with no border.
// Same safety as the other screen tests.
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  full-page panel (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const PORT = 5397, tmp = scratch("uifullpage"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-fullpage-test";
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
const dir = path.join(PE, "projects", ID);
fs.mkdirSync(dir, { recursive: true }); fs.cpSync(path.join(APP, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true, force: true });
{ // page 3 becomes the splash alone on its page (its silent second panel goes)
  const f = path.join(dir, "board.json"), b = JSON.parse(fs.readFileSync(f, "utf8")); b.pages[2].panels = b.pages[2].panels.filter((q) => q.splash); fs.writeFileSync(f, JSON.stringify(b)); }
const built = JSON.parse(execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), dir], { encoding: "utf8" }));
ok(built.directed.includes("3:L1-02") && !built.faults.length, "a splash alone on its page is laid out to the page's edges: " + JSON.stringify(built.directed) + " " + JSON.stringify(built.faults));
{ const sp = JSON.parse(fs.readFileSync(path.join(dir, "spec.json"), "utf8")); sp.templates = sp.templates.filter((t) => !/^L1-/.test(t.code)); fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify(sp)); } // as a project made before these layouts existed
const srv = spawn("node", [path.join(PE, "server.mjs"), String(PORT)], { stdio: "ignore",
  env: { ...process.env, PATH: bin + ":" + process.env.PATH, STUDIO_SAVED: path.join(tmp, "saved"), STUDIO_ANIME: path.join(tmp, "anime"), STUDIO_LOOKS: path.join(tmp, "looks"), OPENROUTER_BASE: "http://127.0.0.1:9" } });
let browser;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(U + "/api/ping")).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  for (const vp of [{ width: 1400, height: 1100 }, { width: 390, height: 800 }]) {
    const page = await browser.newPage({ viewport: vp }), at = vp.width < 600 ? "phone" : "desktop";
    const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("dialog", (d) => d.accept());
    const shot = async (n, sel) => { if (process.env.IBASHO_SHOTS) await (sel ? page.locator(sel) : page).screenshot({ path: path.join(process.env.IBASHO_SHOTS, n + "-" + at + ".png") }); };
    await page.goto(U + "/"); await page.waitForSelector("#projSel option", { state: "attached" });
    await page.evaluate((id) => { document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
    await page.waitForFunction((id) => localStorage.getItem("ld-project") === id && /pages/.test(document.getElementById("sbProj").textContent), ID);
    const polys = () => page.evaluate(() => [...document.querySelectorAll("#page polygon.phit")].map((p) => { const b = p.getBBox(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }));
    const borders = () => page.evaluate(() => [...document.querySelectorAll('#page polygon[stroke="#000"]')].length);
    const W = await page.evaluate(() => PageRender.W), H = await page.evaluate(() => PageRender.H), M = await page.evaluate(() => PageRender.MARGIN);
    await page.evaluate(() => { document.querySelector('#side [data-page="2"]').click(); document.querySelector('#modeTabs [data-mode="layout"]').click(); });
    let b = await polys();
    ok(b.length === 1 && JSON.stringify(b[0]) === JSON.stringify([0, 0, W, H]) && await borders() === 0, at + ": page 3 is one picture over the whole page, no border: " + JSON.stringify(b));
    await shot("fullpage-bleed", "#page");
    if (!(await page.evaluate(() => document.getElementById("tmplDetails").open))) await page.evaluate(() => document.querySelector("#tmplDetails summary").click());
    await page.waitForSelector('#tmplFilters [data-tf="1"]');
    await page.evaluate(() => document.querySelector('#tmplFilters [data-tf="1"]').click());
    ok(await page.locator("#tmplGrid .tmpl").count() === 2 && /one panel/.test(await page.textContent("#tmplHint")), at + ": Page layouts lists the two one-panel layouts, with a line that says what they are");
    ok(await page.getAttribute('#tmplGrid .tmpl >> nth=0', "data-tmpl") === "L1-02", at + ": for the splash, to the page's edges is listed first");
    await shot("fullpage-layouts", "#layoutPanel");
    await page.evaluate(() => document.querySelector('#tmplGrid [data-tmpl="L1-01"]').click());
    b = await polys();
    ok(b.length === 1 && JSON.stringify(b[0]) === JSON.stringify([M, M, W - 2 * M, H - 2 * M]) && await borders() === 1, at + ": L1-01 puts it inside the margins with a border: " + JSON.stringify(b));
    await shot("fullpage-framed", "#page");
    await page.evaluate(() => document.querySelector('#tmplGrid [data-tmpl="L1-02"]').click());
    b = await polys();
    ok(JSON.stringify(b[0]) === JSON.stringify([0, 0, W, H]) && await borders() === 0, at + ": L1-02 runs it to the page's edges again");
    // a page of four panels is not offered them, and keeps its borders
    await page.evaluate(() => document.querySelector('#side [data-page="0"]').click());
    ok((await polys()).length === 4 && await borders() === 4 && await page.locator('#tmplGrid [data-tmpl="L1-02"]').count() === 0 || await page.getAttribute('#tmplFilters [data-tf="1"]', "aria-pressed") === "true", at + ": a four-panel page is untouched");
    ok(errors.length === 0, at + ": no script errors: " + errors.join(" | "));
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
done("a panel that takes up an entire page");
