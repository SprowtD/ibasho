// "Tone a new picture by itself" (Series, off unless turned on), in a real browser: a break-out that lands is toned with its page.
// Codex is played by tests/manga-direction/fixtures/fake_draw.py (a plain figure on white; no model is reached). Same safety as the other screen tests.
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  auto-tone: break-outs (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const PORT = 5396, tmp = scratch("uitoneauto"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-toneauto-test";
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), `#!/bin/sh\nexec /usr/bin/python3 ${JSON.stringify(path.join(APP, "tests/manga-direction/fixtures/fake_draw.py"))} "$@"\n`, { mode: 0o755 }); // "draws" a plain figure on white
const dir = path.join(PE, "projects", ID);
fs.mkdirSync(dir, { recursive: true }); fs.cpSync(path.join(APP, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true, force: true });
execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), dir]);
{ const f = path.join(dir, "bible.json"), b = JSON.parse(fs.readFileSync(f, "utf8")); b.tone_by = "toner"; fs.writeFileSync(f, JSON.stringify(b)); } // the series has the Toner on
const srv = spawn("node", [path.join(PE, "server.mjs"), String(PORT)], { stdio: "ignore",
  env: { ...process.env, PATH: bin + ":" + process.env.PATH, STUDIO_SAVED: path.join(tmp, "saved"), STUDIO_ANIME: path.join(tmp, "anime"), STUDIO_LOOKS: path.join(tmp, "looks"), OPENROUTER_BASE: "http://127.0.0.1:9" } });
let browser;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(U + "/api/ping")).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  const asked = []; page.on("dialog", (d) => { asked.push(d.message()); d.type() === "prompt" ? d.accept(/Who or what/.test(d.message()) ? "Mara" : "Leaping off the pier, coat flying, one arm reaching toward the reader.") : d.accept(); });
  const shot = async (n, sel) => { if (process.env.IBASHO_SHOTS) await (sel ? page.locator(sel) : page).screenshot({ path: path.join(process.env.IBASHO_SHOTS, n + ".png") }); };
  await page.goto(U + "/"); await page.waitForSelector("#projSel option", { state: "attached" });
  await page.evaluate((id) => { document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
  await page.waitForFunction((id) => localStorage.getItem("ld-project") === id && /pages/.test(document.getElementById("sbProj").textContent) && document.getElementById("status").textContent === "Saved", ID);
  const py = (code, ...a) => execFileSync("/usr/bin/python3", ["-c", code, ...a]).toString().trim();
  const saved = async () => { await page.waitForFunction(() => document.getElementById("status").textContent !== "Saving…", null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1600); return (await (await fetch(`${U}/api/spec?p=${ID}`)).json()).pages[0].layout.breakouts || []; };
  const toned = () => page.locator('#page image[href*="art/tone/"]').count();
  const drawBo = async (n) => { await page.click('#modeTabs [data-mode="layout"]'); await page.locator("#page polygon.phit").nth(n).click({ force: true }); await page.click("#boBtn");
    await page.waitForFunction((k) => document.querySelectorAll('#page image[href*="art/breakouts/"], #page image[href*="art/tone/"]').length >= k && !document.querySelector("#page .bo-wait"), n, { timeout: 60000 }); };
  // the switch: shown with the Toner on, off to begin with
  await page.click('#side [data-page="0"]'); await page.click('#modeTabs [data-mode="series"]');
  await page.waitForSelector("#seToneAutoBox", { state: "visible" });
  ok(!(await page.isChecked("#seToneAuto")) && await page.isChecked("#seToner"), "Series shows “Tone a new picture by itself”, off");
  await shot("toneauto-series", "#seToneAutoBox");
  // off: a break-out lands and nothing is toned
  await drawBo(1); await page.waitForTimeout(5000);
  ok(await toned() === 0 && !fs.existsSync(path.join(dir, "art", "tone")), "with it off, a picture that lands is left as drawn");
  // on: the next one that lands has its page toned by itself, and the one drawn before with it
  await page.click('#modeTabs [data-mode="series"]'); await page.check("#seToneAuto");
  await page.waitForFunction(() => /Saved|saved/.test(document.getElementById("seStyleNote").textContent), null, { timeout: 8000 }).catch(() => {});
  ok(JSON.parse(fs.readFileSync(path.join(dir, "bible.json"), "utf8")).tone_auto === true, "the choice is kept with the series");
  await page.click('#side [data-page="0"]'); await drawBo(2);
  await page.waitForFunction(() => document.querySelectorAll('#page image[href*="art/tone/"]').length === 2, null, { timeout: 90000 }).catch(() => {});
  ok(await toned() === 2 && await page.locator('#page image[href*="art/breakouts/"]').count() === 0, "with it on, the page is toned as soon as the picture lands: both break-outs show the Toner's picture");
  ok(/screentone is on 2 pictures/.test(await page.textContent("#status")), "and the status line says so: " + await page.textContent("#status"));
  await shot("toneauto-page", "#page");
  // turned off again, it stops
  await page.click('#modeTabs [data-mode="series"]'); await page.uncheck("#seToneAuto"); await page.waitForTimeout(1500);
  ok(JSON.parse(fs.readFileSync(path.join(dir, "bible.json"), "utf8")).tone_auto === undefined, "turned off, the setting is gone");
  ok(errors.length === 0, "no script errors: " + errors.join(" | "));
} finally {
  if (browser) await browser.close();
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
done("tone a new picture by itself");
