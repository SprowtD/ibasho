// Custom panel styles, part 2, in a real browser: a sound effect as huge letters, and a balloon that bridges two panels.
// Same safety as the other screen tests.
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  sound effects and bridging balloons (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const PORT = 5400, tmp = scratch("uisfx"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-sfx-test";
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
  const items = () => page.evaluate(async (id) => (await (await fetch("/api/spec?p=" + id)).json()).pages[0].text, ID);
  const saved = () => page.waitForFunction(() => document.getElementById("status").textContent === "Saved", null, { timeout: 8000 }).catch(() => {});
  await page.click('#side [data-page="0"]'); await page.click('#modeTabs [data-mode="letter"]');
  await page.click("#letterAllBtn").catch(() => {}); // not on this screen: letter page 1 from the chapter screen instead
  // a sound effect from the Add menu
  await page.click("#addDetails summary");
  ok(/Sound effect/.test(await page.textContent('#addMenu [data-add="sfx"]')), "Add offers a sound effect");
  await page.click('#addMenu [data-add="sfx"]');
  await page.waitForSelector("#textIn", { state: "visible" });
  ok(await page.inputValue("#textIn") === "KRAK", "it starts as a sound, ready to retype");
  ok(await page.isVisible("#hollowChk") && !(await page.isVisible("#tailChk")) && !(await page.isVisible("#joinChk")) && await page.getAttribute("#sizeIn", "max") === "4", "its controls: hollow letters and a size up to 4; no tail, no join");
  await page.fill("#textIn", "BOOM"); await page.evaluate(() => { const s = document.getElementById("sizeIn"); s.value = "2.6"; s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true })); });
  const big = await page.evaluate(() => { const t = [...document.querySelectorAll("#page text")].find((x) => x.textContent.trim() === "BOOM"); const b = t.getBBox(); return [Math.round(b.width), Math.round(b.height), t.getAttribute("stroke"), t.getAttribute("fill")]; });
  ok(big[0] > 450 && big[2] === "#fff" && big[3] === "#000", "BOOM is drawn as huge edged letters: " + JSON.stringify(big));
  await page.check("#hollowChk");
  ok(await page.evaluate(() => { const t = [...document.querySelectorAll("#page text")].find((x) => x.textContent.trim() === "BOOM"); return t.getAttribute("fill") === "#fff" && t.getAttribute("stroke") === "#000"; }), "hollow letters: white with a dark edge");
  ok(!/Spills out|Overlaps/.test(await page.textContent("#checks")), "the checks do not complain about a sound effect crossing borders");
  await shot("sfx-page", "#page");
  await saved(); await page.waitForTimeout(1500);
  let t = await items(); const fx = t.find((x) => x.kind === "sfx");
  ok(fx && fx.text === "BOOM" && fx.hollow === true && fx.size === 2.6, "it is saved with the page: " + JSON.stringify(fx));
  // a balloon that bridges to the next panel
  await page.click("#addDetails summary"); await page.click('#addMenu [data-add="speech"]'); await page.fill("#textIn", "And then");
  ok(await page.isVisible("#bridgeChk") && !(await page.isVisible("#hollowChk")), "a balloon offers Bridges to the next panel");
  await page.check("#bridgeChk");
  ok(await page.isChecked("#bleedChk") && /sits on the border/.test(await page.textContent("#status")), "it moves onto the border and is marked as crossing the edge: " + await page.isChecked("#bleedChk") + " / " + await page.textContent("#status"));
  ok(!/bridging balloon belongs|Spills out/.test(await page.textContent("#checks")), "the checks accept it there");
  await shot("bridge-page", "#page");
  await saved(); await page.waitForTimeout(1500);
  t = await items(); const br = t.find((x) => x.bridge);
  await page.click('#modeTabs [data-mode="layout"]');
  const borders = await page.evaluate(() => [...document.querySelectorAll("#page polygon.phit")].map((p) => { const b = p.getBBox(); return [b.x, b.y, b.x + b.width, b.y + b.height]; }));
  await page.click('#modeTabs [data-mode="letter"]'); await page.locator("#page [data-i]").last().click({ force: true }).catch(() => {});
  ok(br && br.bleed && borders.filter((b) => br.at[0] * 1000 > b[0] - 60 && br.at[0] * 1000 < b[2] + 60 && br.at[1] * 1500 > b[1] - 60 && br.at[1] * 1500 < b[3] + 60).length >= 2, "saved on the border between two panels: " + JSON.stringify(br && br.at) + " " + JSON.stringify(borders.map((b) => b.map(Math.round))));
  await page.uncheck("#bleedChk");
  ok(!(await page.isChecked("#bridgeChk")), "turning off Crosses panel edge turns the bridge off too");
  ok(errors.length === 0, "no script errors: " + errors.join(" | "));
} finally {
  if (browser) await browser.close();
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
done("sound effects and bridging balloons");
