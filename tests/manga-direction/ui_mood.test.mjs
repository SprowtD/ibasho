// Series mood pictures, in a real browser: uploaded pictures that go with every panel as a guide to the look only.
// Same safety as the other screen tests.
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  mood pictures (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const PORT = 5388, tmp = scratch("uimood"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-mood-test";
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
const dir = path.join(PE, "projects", ID);
fs.mkdirSync(dir, { recursive: true }); fs.cpSync(path.join(APP, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true, force: true });
execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), dir]);
const pic = path.join(tmp, "mood.png"); execFileSync("/usr/bin/python3", ["-c", "import sys\nfrom PIL import Image\nImage.new('RGB',(640,480),(40,90,160)).save(sys.argv[1])", pic]);
const srv = spawn("node", [path.join(PE, "server.mjs"), String(PORT)], { stdio: "ignore",
  env: { ...process.env, PATH: bin + ":" + process.env.PATH, STUDIO_SAVED: path.join(tmp, "saved"), STUDIO_ANIME: path.join(tmp, "anime"), STUDIO_LOOKS: path.join(tmp, "looks"), OPENROUTER_BASE: "http://127.0.0.1:9" } });
let browser;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(U + "/api/ping")).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("dialog", (d) => d.accept());
  const shot = async (n, sel) => { if (process.env.IBASHO_SHOTS) await (sel ? page.locator(sel) : page).screenshot({ path: path.join(process.env.IBASHO_SHOTS, n + ".png") }); };
  await page.goto(U + "/"); await page.waitForSelector("#projSel option", { state: "attached" });
  await page.evaluate((id) => { document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
  await page.waitForFunction((id) => localStorage.getItem("ld-project") === id && /pages/.test(document.getElementById("sbProj").textContent), ID);
  const bible = () => JSON.parse(fs.readFileSync(path.join(dir, "bible.json"), "utf8"));
  await page.click('#side [data-page="0"]'); await page.click('#modeTabs [data-mode="series"]'); await page.waitForSelector("#seMoodBox", { state: "visible" });
  ok(/None yet/.test(await page.textContent("#seMoodList")) && await page.isVisible("#seMoodAdd"), "Series has a Mood pictures box, empty to begin with");
  await page.setInputFiles("#seMoodFile", pic);
  await page.waitForFunction(() => document.querySelectorAll("#seMoodList [data-mood-del]").length === 1, null, { timeout: 8000 });
  await page.waitForSelector("#seMoodList img.rthumb", { timeout: 8000 }); await page.waitForTimeout(1500);
  ok((bible().mood || []).length === 1 && /^u[a-z0-9]+$/.test(bible().mood[0].id) && bible().mood[0].name === "mood.png", "an uploaded picture is kept with the series: " + JSON.stringify(bible().mood));
  await shot("mood-series", "#seMoodBox");
  // it rides along with a panel's own references, last, and the Artist is told what it is for
  await page.click('#side [data-page="0"]'); await page.click('#modeTabs [data-mode="art"]');
  await page.locator("#page polygon.phit").first().click({ force: true }); await page.waitForSelector("#genBtn", { state: "visible" });
  await page.click("#genBtn");
  const pdir = path.join(dir, "art", "panels"); let prompt = "";
  for (let i = 0; i < 60 && !prompt; i++) { await page.waitForTimeout(500); const f = fs.existsSync(pdir) ? fs.readdirSync(pdir).find((n) => /\.prompt\.txt$/.test(n)) : ""; if (f) prompt = fs.readFileSync(path.join(pdir, f), "utf8"); }
  ok(/INPUT REFERENCES, ordered: .*mood picture for this series: take the LOOK only/.test(prompt) && /never copy its people, places or composition/.test(prompt), "the panel's request names the mood picture and says it is for the look only: " + prompt.slice(-260).replace(/\s+/g, " "));
  const refs = fs.existsSync(path.join(pdir, "refs")) ? fs.readdirSync(path.join(pdir, "refs")) : [];
  ok(refs.length >= 1, "and the picture itself is attached: " + refs.join(", "));
  // four at most; removing one takes it off the series
  await page.click('#modeTabs [data-mode="series"]');
  for (let n = 2; n <= 4; n++) { await page.setInputFiles("#seMoodFile", pic); await page.waitForFunction((k) => document.querySelectorAll("#seMoodList [data-mood-del]").length === k, n, { timeout: 8000 }); }
  ok(!(await page.isVisible("#seMoodAdd")), "after four, no more can be added");
  await page.locator("#seMoodList [data-mood-del]").first().click(); await page.waitForFunction(() => document.querySelectorAll("#seMoodList [data-mood-del]").length === 3); await page.waitForTimeout(1500);
  ok(bible().mood.length === 3 && await page.isVisible("#seMoodAdd"), "Remove takes one off the series");
  ok(errors.length === 0, "no script errors: " + errors.join(" | "));
} finally {
  if (browser) await browser.close();
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
done("series mood pictures");
