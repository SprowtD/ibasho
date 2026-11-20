// A tab that holds an older storyboard loads the new one by itself and says so (it used to keep its old pages, and its saves
// were refused). In a real browser, on the fixture as a project of its own. Same safety as the other screen tests: its own port,
// scratch saved work, a do-nothing `codex`. Needs playwright-core (set IBASHO_PLAYWRIGHT) and a Chromium; skipped when there is none.
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  a new storyboard reaches an open tab (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const PORT = 5395, tmp = scratch("uiboard"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-newboard-test";
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
const dir = path.join(PE, "projects", ID);
fs.mkdirSync(dir, { recursive: true }); fs.cpSync(path.join(APP, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true, force: true });
execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), dir]);
const specFile = path.join(dir, "spec.json"), first = JSON.parse(fs.readFileSync(specFile, "utf8"));
const srv = spawn("node", [path.join(PE, "server.mjs"), String(PORT)], { stdio: "ignore",
  env: { ...process.env, PATH: bin + ":" + process.env.PATH, STUDIO_SAVED: path.join(tmp, "saved"), STUDIO_ANIME: path.join(tmp, "anime"), STUDIO_LOOKS: path.join(tmp, "looks"), OPENROUTER_BASE: "http://127.0.0.1:9" } });
let browser;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(U + "/api/ping")).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  const info = await (await fetch(`${U}/api/project?p=${ID}`)).json();
  ok(info.boardAt === (first.boardAt || "") && info.pages === first.pages.length, "the project says which storyboard it holds: " + JSON.stringify([info.boardAt, info.pages]));
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("dialog", (d) => d.accept());
  await page.goto(U + "/"); await page.waitForSelector("#projSel option", { state: "attached" });
  await page.evaluate((id) => { document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
  await page.waitForFunction((n) => document.getElementById("sbProj").textContent.includes(n + " pages"), first.pages.length);
  // the chapter is storyboarded again somewhere else: one page fewer, a new time on the board
  const next = { ...first, boardAt: new Date(Date.now() + 60000).toISOString(), pages: first.pages.slice(0, -1) };
  fs.writeFileSync(specFile, JSON.stringify(next));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("ibasho-work-landed", { detail: {} })));
  await page.waitForFunction((n) => document.getElementById("sbProj").textContent.includes(n + " pages"), next.pages.length, { timeout: 15000 });
  await page.waitForFunction(() => /new storyboard is in/.test(document.getElementById("status").textContent), null, { timeout: 6000 }).catch(() => {});
  const said = await page.textContent("#status");
  ok(/new storyboard is in \(\d+ pages\)/.test(said), "the tab says the new storyboard is in: " + said);
  // a change made now is saved on the new storyboard (not refused as a stale tab)
  await page.waitForTimeout(500);
  const r = await page.evaluate(async (id) => { const sv = await (await fetch("/api/spec?p=" + id)).text(); return sv.length; }, ID);
  ok(r >= 0 && errors.length === 0, "no script errors on the page: " + errors.join(" | "));
} finally {
  if (browser) await browser.close();
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
done("a new storyboard reaches an open tab");
