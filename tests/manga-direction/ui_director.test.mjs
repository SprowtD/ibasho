// The editor's panel director controls, in a real browser: a job and a weight on a panel, "Pick the layout by weight",
// layouts listed best fit first, and the new checks in the page's check list. Skipped without playwright-core.
// This test deletes nothing: it reuses one scratch project folder in THIS checkout (page-editor/projects/zz-ui-director-test,
// not in git) and a fresh temp folder for saved work each run. Remove them by hand when you like.
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  panel director: editor screens (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const PORT = 5394, tmp = scratch("uidir"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-director-test";
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
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("dialog", (d) => d.accept());
  const shot = async (name, sel) => { if (process.env.IBASHO_SHOTS) await (sel ? page.locator(sel) : page).screenshot({ path: path.join(process.env.IBASHO_SHOTS, name + ".png") }); };
  await page.goto(U + "/"); await page.waitForSelector("#projSel option", { state: "attached" });
  await page.evaluate((id) => { document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
  await page.waitForFunction((id) => localStorage.getItem("ld-project") === id && /pages/.test(document.getElementById("sbProj").textContent) && document.getElementById("status").textContent === "Saved", ID);
  await page.click('#side [data-page="0"]'); await page.click('#modeTabs [data-mode="layout"]');
  const boxes = () => page.evaluate(() => [...document.querySelectorAll("#page polygon.phit")].map((p) => { const b = p.getBBox(); return Math.round(b.width * b.height); }));
  const start = await boxes();
  ok(start.indexOf(Math.max(...start)) === 0, "page 1 as built: the establishing panel is the biggest");
  // tap the insert (panel 3) and make it the big moment
  await page.locator("#page polygon.phit").nth(2).click({ force: true });
  await page.waitForSelector("#pjob", { state: "visible" });
  ok(await page.inputValue("#pjob") === "insert" && await page.getAttribute('#pweight [data-pw="1"]', "aria-pressed") === "true", "the panel's job and weight show (insert, 1)");
  await page.selectOption("#pjob", "big"); await page.click('#pweight [data-pw="5"]');
  ok(await page.getAttribute('#pweight [data-pw="5"]', "aria-pressed") === "true" && /biggest panel/i.test(await page.textContent("#pjobHint")), "job and weight change, with the job's hint");
  await page.click('#modeTabs [data-mode="letter"]');
  ok(/carries the most weight/.test(await page.textContent("#checks")), "the page's check list says the heaviest panel is not the biggest");
  await page.click('#modeTabs [data-mode="layout"]');
  await page.evaluate(() => { document.getElementById("tmplDetails").open = true; document.getElementById("tmplDetails").dispatchEvent(new Event("toggle")); });
  await page.waitForSelector("#tmplPick", { state: "visible" });
  const best = await page.locator("#tmplGrid .tmpl[data-best]").count(), faded = await page.locator("#tmplGrid .tmpl[data-fault]").count();
  ok(best === 1 && faded > 3, `layouts: the best fit is marked (${best}), even grids and lined-up gutters are faded (${faded})`);
  await shot("director-layouts");
  await page.click("#tmplPick");
  const after = await boxes();
  ok(after.length === start.length && after.indexOf(Math.max(...after)) === 2, `"Pick the layout by weight" makes that panel the biggest (${after})`);
  await page.click('#modeTabs [data-mode="letter"]');
  ok(!/carries the most weight/.test(await page.textContent("#checks")), "and the check is answered");
  // the storyboard came along: the panel still has its action text and the page its lines
  const kept = await page.evaluate(() => document.querySelector("#page").textContent);
  ok(/wristwatch/.test(kept) && /Ferry pier at night/.test(kept), "every panel kept its storyboard");
  // a reveal that is not first: advice in the list
  await page.click('#modeTabs [data-mode="layout"]'); await page.locator("#page polygon.phit").nth(3).click({ force: true }); await page.check("#preveal");
  await page.click('#modeTabs [data-mode="letter"]');
  ok(await page.locator('#checks li:has-text("first thing seen after the turn") .chip').first().textContent() === "Advice", "a reveal in the middle of a page is listed as Advice");
  await shot("director-checks"); await page.waitForTimeout(2200);
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, "saved", ID + ".json"), "utf8")), b = saved.pages[0].layout.rows.flatMap((r) => r.panels).map((q) => q.board);
  ok(b.some((x) => x.job === "big" && x.weight === 5) && b.some((x) => x.reveal === true), "job, weight and reveal are saved");
  ok(b.flatMap((x) => x.lines.map((l) => l.text)).join(" | ") === "You said nine. | I said about nine. | It is ten to ten.", "and the page's lines came through the new layout, in order");
  ok(errors.length === 0, "no script errors on the page: " + errors.join(" | "));
} finally {
  if (browser) await browser.close();
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true }); // the test's own project, out of the real projects folder
}
done("panel director: editor screens");
