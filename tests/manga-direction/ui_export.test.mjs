// The Export button on the manga side, in a real browser: one dialog, a choice of PDF, PNG or JPEG, the whole chapter or the pages
// picked, and a file named from the project. Same safety as the other screen tests: its own port, scratch saved work, a do-nothing
// `codex`. Needs playwright-core (set IBASHO_PLAYWRIGHT) and a Chromium; skipped when there is none.
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  export dialog (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const PORT = 5396, tmp = scratch("uiexport"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-export-test";
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
const dir = path.join(PE, "projects", ID);
fs.mkdirSync(dir, { recursive: true }); fs.cpSync(path.join(APP, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true, force: true });
execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), dir]);
const spec = JSON.parse(fs.readFileSync(path.join(dir, "spec.json"), "utf8")), N = spec.pages.length;
const srv = spawn("node", [path.join(PE, "server.mjs"), String(PORT)], { stdio: "ignore",
  env: { ...process.env, PATH: bin + ":" + process.env.PATH, STUDIO_SAVED: path.join(tmp, "saved"), STUDIO_ANIME: path.join(tmp, "anime"), STUDIO_LOOKS: path.join(tmp, "looks"), OPENROUTER_BASE: "http://127.0.0.1:9" } });
const py = (code, f) => execFileSync("/usr/bin/python3", ["-c", code, f]).toString().trim();
let browser;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(U + "/api/ping")).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  for (const [what, viewport] of [["desktop", { width: 1400, height: 1100 }], ["phone", { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, acceptDownloads: true });
    const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("dialog", (d) => d.accept());
    await page.goto(U + "/"); await page.waitForSelector("#projSel option", { state: "attached" });
    await page.evaluate((id) => { document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
    await page.waitForFunction((n) => document.getElementById("sbProj").textContent.includes(n + " pages"), N);
    await page.waitForSelector("#exportAllBtn:not([hidden])");
    ok((await page.textContent("#exportAllBtn")).trim() === "Export", what + ": one Export button on the chapter");
    await page.click("#exportAllBtn"); await page.waitForSelector("#exDlg[open]");
    ok(await page.evaluate(() => { const r = document.getElementById("exDlg").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.height <= innerHeight; }), what + ": the dialog fits the screen");
    if (process.env.IBASHO_SHOTS) await page.screenshot({ path: path.join(process.env.IBASHO_SHOTS, `export-${what}.png`) }); // to look at the dialog by eye
    ok(await page.$$eval("#exPages [aria-pressed=true]", (l) => l.length) === N && /Export \d+ pages/.test(await page.textContent("#exGo")), what + ": the whole chapter is picked to start");
    ok(await page.$eval("#exSetsRow", (e) => e.hidden) === ((await page.$eval("#exFormat [aria-pressed=true]", (e) => e.dataset.format)) === "pdf"), what + ": folders of 20 are offered for pictures, not for a PDF");
    if (what === "desktop") {
      // the whole chapter as a PDF
      await page.click('#exFormat [data-format="pdf"]');
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.click("#exGo")]);
      const f = path.join(tmp, "a.pdf"); await dl.saveAs(f); const s = fs.readFileSync(f, "latin1");
      ok(dl.suggestedFilename() === ID + ".pdf", "the PDF is named after the project: " + dl.suggestedFilename());
      ok(s.startsWith("%PDF") && (s.match(/\/Type \/Page /g) || []).length === N, `the PDF has all ${N} pages`);
      ok(/\/Width 2048 \/Height 3072/.test(s), "full size pictures in the PDF");
      await page.waitForFunction(() => !document.getElementById("exDlg").open);
      ok(/Exported \d+ pages: /.test(await page.textContent("#status")), "the status says what was exported: " + await page.textContent("#status"));
      ok(await page.$$eval("#exportsBox .exp-grid a", (l) => l.length) === N, "the exported pages are listed on the chapter");
      // the text on the page is in the picture (the page was drawn, not empty): not one flat colour
      const png = path.join(tmp, "saved", "exports", ID, "page-01.png");
      ok(+py("import sys\nfrom PIL import Image\nprint(len(Image.open(sys.argv[1]).convert('L').resize((64,96)).getcolors() or range(999)))", png) > 3, "an exported page holds a drawing");
    } else {
      // two pages picked, as JPEGs at the smaller size; the choice of format is remembered from the PDF above? No: a new browser page, so pick it
      await page.click('#exFormat [data-format="jpeg"]'); await page.click('#exSize [data-size="web"]'); await page.click("#exNone");
      ok(await page.$eval("#exGo", (b) => b.disabled), "nothing picked: Export is off");
      await page.click('#exPages [data-i="0"]'); await page.click('#exPages [data-i="2"]');
      ok(!(await page.$eval("#exSetsRow", (e) => e.hidden)), "two JPEGs: folders of 20 are offered");
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.click("#exGo")]);
      const f = path.join(tmp, "b.zip"); await dl.saveAs(f);
      const names = JSON.parse(py("import sys,zipfile,json\nprint(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))", f));
      ok(dl.suggestedFilename() === ID + "-jpeg.zip" && JSON.stringify(names) === JSON.stringify([`${ID}-page-01.jpg`, `${ID}-page-03.jpg`]), "two picked pages come as JPEGs named from the project and page: " + names);
      ok(fs.readdirSync(path.join(tmp, "saved", "exports", ID)).length === N, "exporting two pages again leaves the rest of the last export in place");
      // from one page: the same dialog, that page picked
      await page.waitForFunction(() => !document.getElementById("exDlg").open);
      await page.click(".pg[data-open='1']"); await page.waitForSelector("#exportBtn", { state: "visible" }).catch(() => {});
      if (await page.isVisible("#exportBtn")) {
        await page.click("#exportBtn"); await page.waitForSelector("#exDlg[open]");
        ok(JSON.stringify(await page.$$eval("#exPages [aria-pressed=true]", (l) => l.map((b) => b.dataset.i))) === '["1"]' && /this page/.test(await page.textContent("#exDlgT")), "Export on a page picks that page");
        ok(await page.$eval("#exFormat [aria-pressed=true]", (e) => e.dataset.format) === "jpeg", "the last format is remembered");
        await page.click('#exFormat [data-format="png"]');
        const [one] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#exGo")]);
        ok(one.suggestedFilename() === ID + "-page-02.png", "one page comes as the picture itself: " + one.suggestedFilename());
      } else ok(false, "the Export button is not reachable on a page at phone size");
    }
    ok(errors.length === 0, what + ": no script errors: " + errors.join(" | "));
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
done("export dialog");
