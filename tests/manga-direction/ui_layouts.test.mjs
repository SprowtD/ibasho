// Custom panel styles, part 1, in a real browser: layouts with a strip of tiny panels, and saving a page's layout as your own.
// Same safety as the other screen tests.
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  own layouts and strips (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const PORT = 5399, tmp = scratch("uilayouts"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-layouts-test";
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
const dir = path.join(PE, "projects", ID);
fs.mkdirSync(dir, { recursive: true }); fs.cpSync(path.join(APP, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true, force: true });
execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), dir]);
const srv = spawn("node", [path.join(PE, "server.mjs"), String(PORT)], { stdio: "ignore",
  env: { ...process.env, PATH: bin + ":" + process.env.PATH, STUDIO_SAVED: path.join(tmp, "saved"), STUDIO_ANIME: path.join(tmp, "anime"), STUDIO_LOOKS: path.join(tmp, "looks"), OPENROUTER_BASE: "http://127.0.0.1:9" } });
let browser;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(U + "/api/ping")).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  let name = "Mara at the pier"; page.on("dialog", (d) => (d.type() === "prompt" ? d.accept(name) : d.accept()));
  const shot = async (n, sel) => { if (process.env.IBASHO_SHOTS) await (sel ? page.locator(sel) : page).screenshot({ path: path.join(process.env.IBASHO_SHOTS, n + ".png") }); };
  await page.goto(U + "/"); await page.waitForSelector("#projSel option", { state: "attached" });
  await page.evaluate((id) => { document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
  await page.waitForFunction((id) => localStorage.getItem("ld-project") === id && /pages/.test(document.getElementById("sbProj").textContent) && document.getElementById("status").textContent === "Saved", ID);
  const polys = () => page.evaluate(() => [...document.querySelectorAll("#page polygon.phit")].map((p) => { const b = p.getBBox(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }));
  await page.click('#side [data-page="0"]'); await page.click('#modeTabs [data-mode="layout"]');
  await page.click("#tmplDetails summary");
  ok(await page.isVisible("#tmplSave") && await page.locator('#tmplFilters [data-tf="strip"]').count() === 1 && await page.locator('#tmplFilters [data-tf="mine"]').count() === 0, "Page layouts offers Save as mine and Strips; no Mine before one is saved");
  // strips: a 4-panel page takes "big panel + a strip of three"
  await page.click('#tmplFilters [data-tf="strip"]');
  ok(await page.locator("#tmplGrid .tmpl").count() >= 15 && await page.locator('#tmplGrid [data-tmpl="T4-01"]').count() === 1, "the strip layouts are listed");
  await page.click('#tmplGrid [data-tmpl="T4-01"]');
  let b = await polys(); const hs = b.map((x) => x[3]).sort((x, y) => x - y);
  ok(b.length === 4 && hs[2] < hs[3] / 3 && hs[0] === hs[2], "page 1 is one big panel and a thin strip of three: " + JSON.stringify(b));
  await shot("strip-page", "#page");
  // save this page's layout as mine
  const mine = JSON.stringify(b);
  await page.click("#tmplSave");
  await page.waitForFunction(() => /Saved as MY-01/.test(document.getElementById("status").textContent));
  ok(await page.getAttribute('#tmplFilters [data-tf="mine"]', "aria-pressed") === "true" && await page.locator("#tmplGrid .tmpl").count() === 1 && /MY-01/.test(await page.textContent("#tmplGrid .tmpl")), "it is listed under Mine as MY-01");
  const file = JSON.parse(fs.readFileSync(path.join(tmp, "saved", "layouts.json"), "utf8"));
  ok(file.layouts[0].name === name && !/board|image|"id"/.test(JSON.stringify(file.layouts[0].rows)) && file.layouts[0].rows.some((r) => r.strip), "saved on this computer with only its build: " + JSON.stringify(file.layouts[0]).slice(0, 160));
  await shot("layouts-mine", "#layoutPanel");
  // use it on another page with four panels (page 4), after a reload: it is offered in the list
  await page.waitForFunction(() => document.getElementById("status").textContent === "Saved" || /Saved as/.test(document.getElementById("status").textContent)); await page.waitForTimeout(1500);
  await page.goto(U + "/"); await page.waitForSelector("#projSel option", { state: "attached" });
  await page.evaluate((id) => { document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
  await page.waitForFunction(() => /pages/.test(document.getElementById("sbProj").textContent));
  await page.click('#side [data-page="3"]'); await page.click('#modeTabs [data-mode="layout"]');
  if (!(await page.evaluate(() => document.getElementById("tmplDetails").open))) await page.click("#tmplDetails summary");
  await page.waitForSelector('#tmplFilters [data-tf="mine"]'); await page.click('#tmplFilters [data-tf="mine"]');
  const before4 = JSON.stringify(await polys());
  await page.click('#tmplGrid [data-tmpl="MY-01"]');
  b = await polys();
  ok(JSON.stringify(b) !== before4 && b.length === 4 && b.filter((x) => x[3] < 320).length === 3, "after a reload, my layout is applied to another page: " + JSON.stringify(b));
  // remove it
  await page.click('#tmplGrid [data-tmpl-del="MY-01"]');
  await page.waitForFunction(() => /Removed MY-01/.test(document.getElementById("status").textContent), null, { timeout: 5000 }).catch(async () => console.log("  status: " + await page.textContent("#status") + " | errors: " + errors.join(" ")));
  ok(await page.locator('#tmplFilters [data-tf="mine"]').count() === 0 && JSON.parse(fs.readFileSync(path.join(tmp, "saved", "layouts.json"), "utf8")).layouts.length === 0, "Remove takes it off the list and off the computer");
  ok(JSON.stringify(await polys()) === JSON.stringify(b), "the page that used it keeps its layout");
  ok(errors.length === 0, "no script errors: " + errors.join(" | "));
} finally {
  if (browser) await browser.close();
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
done("own layouts and strips");
