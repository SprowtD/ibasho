// The editor's screens, in a real browser: the choice on the new-project and new-book forms, turning a series in
// Series settings, the layout tools on a right-to-left page, and the saved copy.
// Needs playwright-core (set IBASHO_PLAYWRIGHT to its folder) and a Chromium; skipped when there is none.
// Same safety as server_reading.test.mjs: its own port, scratch saved work, a do-nothing `codex`, OpenRouter at a dead port.
import { spawn } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, SAMPLE, scratch, ok, near, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  reading direction: editor screens (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
if (!SAMPLE) { console.log("skipped  reading direction: editor screens (needs an older left-to-right sample chapter beside the app)"); process.exit(0); }
const PORT = 5392, tmp = scratch("ui"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-reading-test";
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
const hadProjects = fs.existsSync(path.join(PE, "projects")), dir = path.join(PE, "projects", ID);
fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(path.join(PE, "samples", SAMPLE), dir, { recursive: true }); // a copy of the sample, as a project of its own
fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ name: "Zz UI Reading Test", chapter: 2 }));
const srv = spawn("node", [path.join(PE, "server.mjs"), String(PORT)], { stdio: "ignore",
  env: { ...process.env, PATH: bin + ":" + process.env.PATH, STUDIO_SAVED: path.join(tmp, "saved"), STUDIO_ANIME: path.join(tmp, "anime"), STUDIO_LOOKS: path.join(tmp, "looks"), OPENROUTER_BASE: "http://127.0.0.1:9" } });
let browser;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(U + "/api/ping")).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  const shot = async (name, sel) => { if (process.env.IBASHO_SHOTS) await (sel ? page.locator(sel) : page).screenshot({ path: path.join(process.env.IBASHO_SHOTS, name + ".png") }); }; // pictures for a person to look at
  await page.goto(U + "/"); await page.waitForSelector("#npReading [data-reading]", { state: "attached" });
  ok(await page.getAttribute('#npReading [data-reading="rtl"]', "aria-pressed") === "true", "new project: right to left is chosen to begin with");
  await page.evaluate(() => { document.getElementById("newProj").open = true; });
  await page.click('#npReading [data-reading="ltr"]');
  ok(await page.getAttribute('#npReading [data-reading="ltr"]', "aria-pressed") === "true", "new project: left to right is one tap away");
  await page.click('#npReading [data-reading="rtl"]');
  await shot("new-project-form", "#newForm");
  ok(await page.getAttribute('#nbReading [data-reading="rtl"]', "aria-pressed") === "true", "new book: right to left is chosen to begin with");
  // joining a series shows that series' direction, locked
  await page.selectOption("#npLike", ID);
  ok(await page.getAttribute('#npReading [data-reading="ltr"]', "aria-pressed") === "true" && await page.isDisabled('#npReading [data-reading="rtl"]'), "a chapter joining an older series shows left to right, locked");
  await page.selectOption("#npLike", "");
  // open the project, go to page 2, read the first panel's place
  await page.evaluate((id) => { document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
  await page.waitForFunction((id) => localStorage.getItem("ld-project") === id && /pages/.test(document.getElementById("sbProj").textContent) && document.getElementById("status").textContent === "Saved", ID);
  await page.click('#side [data-page="1"]'); await page.click('#modeTabs [data-mode="layout"]');
  const firstPanel = () => page.evaluate(() => { const b = document.querySelector("#page polygon.phit").getBBox(); return [b.x, b.x + b.width]; });
  const before = await firstPanel();
  near(before[0], 40, "left to right: panel 1 starts at the left margin", 1);
  await page.click('#modeTabs [data-mode="series"]');
  ok(await page.getAttribute('#seReading [data-reading="ltr"]', "aria-pressed") === "true", "Series: an older series shows left to right");
  await page.click('#seReading [data-reading="rtl"]');
  await page.waitForFunction(() => /now reads right to left/.test(document.getElementById("status").textContent));
  ok(JSON.parse(fs.readFileSync(path.join(dir, "bible.json"), "utf8")).reading === "rtl", "Series: the choice is saved in the series settings");
  await shot("series-reading", "#seriesView");
  await page.click('#modeTabs [data-mode="layout"]');
  const after = await firstPanel();
  await page.evaluate(() => { document.getElementById("tmplDetails").open = true; document.getElementById("tmplDetails").dispatchEvent(new Event("toggle")); }); await page.waitForTimeout(300);
  await shot("layout-rtl");
  near(after[1], 960, "right to left: panel 1 ends at the right margin", 1);
  near(after[1] - after[0], before[1] - before[0], "and keeps its width", 1);
  // templates are drawn mirrored too
  // drag the first upright gutter 60 px to the right: on a right-to-left page that narrows panel 1 (it is on the right)
  const knob = await page.$('#page g.gut[data-gut="col"] .gut-knob'), kb = await knob.boundingBox();
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2); await page.mouse.down(); await page.mouse.move(kb.x + kb.width / 2 + 60, kb.y + kb.height / 2, { steps: 5 }); await page.mouse.up();
  const dragged = await firstPanel();
  ok(dragged[1] - dragged[0] < after[1] - after[0] - 20, `dragging the gutter right narrows the right-hand panel (${Math.round(after[1] - after[0])} to ${Math.round(dragged[1] - dragged[0])})`);
  near(dragged[1], 960, "which still ends at the right margin", 1);
  // the saved copy carries the direction
  await page.waitForTimeout(2500);
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, "saved", ID + ".json"), "utf8"));
  ok(saved.reading === "rtl" && saved.pages.every((p) => !p.layout || p.layout.rtl === true), "the saved chapter is right to left on every page");
  // reload: it comes back right to left, and turning it back restores the left-to-right page
  await page.reload(); await page.waitForFunction((id) => localStorage.getItem("ld-project") === id && /pages/.test(document.getElementById("sbProj").textContent) && document.getElementById("status").textContent === "Saved", ID);
  await page.click('#side [data-page="1"]'); await page.click('#modeTabs [data-mode="layout"]');
  near((await firstPanel())[1], 960, "after a reload it is still right to left", 1);
  await page.click('#modeTabs [data-mode="series"]'); await page.click('#seReading [data-reading="ltr"]');
  await page.waitForFunction(() => /now reads left to right/.test(document.getElementById("status").textContent));
  await page.click('#modeTabs [data-mode="layout"]');
  near((await firstPanel())[0], 40, "turned back: panel 1 starts at the left margin again", 1);
  await page.click('#modeTabs [data-mode="letter"]'); await page.waitForTimeout(300);
  ok(errors.length === 0, "no script errors on the page: " + errors.join(" | "));
} finally {
  if (browser) await browser.close();
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true }); if (!hadProjects) fs.rmSync(path.join(PE, "projects"), { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}
done("reading direction: editor screens");
