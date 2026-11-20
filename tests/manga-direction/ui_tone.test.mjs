// The Toner in a real browser: turned on in Series, a page toned, tone scraped by hand, the export, and a panel flagged after its
// gutter moves. The pictures are flat greys drawn by code (what the Artist draws when the Toner is on). No model is reached.
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  the Toner (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const PORT = 5404, tmp = scratch("uitone"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-tone-test";
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
const dir = path.join(PE, "projects", ID);
fs.mkdirSync(dir, { recursive: true }); fs.cpSync(path.join(APP, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true, force: true });
execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), dir]);
{ const GREYS = "import sys\nfrom PIL import Image, ImageDraw\nim=Image.new('L',(900,640),255); d=ImageDraw.Draw(im)\nd.rectangle([60,60,420,560],fill=204,outline=0,width=5)\nd.ellipse([520,120,820,420],fill=153,outline=0,width=6)\nim.save(sys.argv[1])";
  const sf = path.join(dir, "spec.json"), sp = JSON.parse(fs.readFileSync(sf, "utf8")); fs.mkdirSync(path.join(dir, "art"), { recursive: true }); sp.library = [];
  const walk = (rows) => { for (const r of rows) for (const q of r.panels) { if (q.rows) walk(q.rows); else { const f = `art/${q.id}.png`; execFileSync("/usr/bin/python3", ["-c", GREYS, path.join(dir, f)]); q.image = f; sp.library.push({ src: f, label: q.id, size: [900, 640] }); } } };
  walk(sp.pages[0].layout.rows); fs.writeFileSync(sf, JSON.stringify(sp)); }
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
  const py = (code, ...a) => execFileSync("/usr/bin/python3", ["-c", code, ...a]).toString().trim();
  const saved = async () => { await page.waitForFunction(() => document.getElementById("status").textContent !== "Saving…", null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1600); return (await (await fetch(`${U}/api/spec?p=${ID}`)).json()).pages[0]; };
  const first = (pg) => pg.layout.rows[0].panels[0];
  // Series: turn the Toner on
  await page.click('#modeTabs [data-mode="series"]'); await page.waitForSelector("#seToner", { state: "visible" });
  ok(!(await page.isChecked("#seToner")), "Series offers Screentone made by the Toner, off to start");
  await page.check("#seToner"); await page.waitForFunction(() => /Saved/.test(document.getElementById("seStyleNote").textContent), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  ok(JSON.parse(fs.readFileSync(path.join(dir, "bible.json"), "utf8")).tone_by === "toner", "the choice is kept with the series");
  // Art: tone the page
  await page.click('#side [data-page="0"]'); await page.click('#modeTabs [data-mode="art"]');
  await page.locator("#page polygon.phit").nth(0).click({ force: true });
  await page.waitForSelector("#toneBox", { state: "visible" });
  ok(/Not toned yet/.test(await page.textContent("#toneInfo")) && !(await page.isVisible("#toneHand")) && !(await page.isVisible("#toneOne")), "a drawn panel says it is not toned yet: " + await page.textContent("#toneInfo"));
  await page.click("#tonePage");
  await page.waitForSelector('#page image[href*="art/tone/"]', { state: "attached", timeout: 180000 });
  const n = await page.locator('#page image[href*="art/tone/"]').count();
  ok(n === 4 && /screentone is on 4 panels/.test(await page.textContent("#status")), "the Toner's pictures land on all four panels by themselves: " + n);
  ok(/Toned: dots 60 lines 20%; dots 60 lines 40%/.test(await page.textContent("#toneInfo")) && await page.isVisible("#toneHand") && await page.isVisible("#toneOne"), "the panel says what it was toned with: " + await page.textContent("#toneInfo"));
  let pg = await saved(), t0 = first(pg).toned;
  ok(t0 && /^art\/tone\/.+\/flat-1\.png$/.test(t0.src) && t0.px === 2048 && t0.of === first(pg).image, "it is saved with the page: " + JSON.stringify(t0).slice(0, 160));
  await shot("tone-page", "#page");
  // by hand: a soft scrape across the wall
  await page.click("#toneHand"); await page.waitForSelector("#toneDlg[open]");
  ok(await page.getAttribute('#toneTools [data-tool="soft"]', "aria-pressed") === "true" && await page.isDisabled("#toneSave") && await page.isDisabled("#toneUndo"), "the hand tools open on Soft scrape, with nothing to save yet");
  await page.evaluate(() => { const s = document.getElementById("toneSize"); s.value = "600"; s.dispatchEvent(new Event("input", { bubbles: true })); });
  const cv = await page.locator("#toneCanvas").boundingBox();
  await page.mouse.move(cv.x + cv.width * 0.12, cv.y + cv.height * 0.3); await page.mouse.down(); await page.mouse.move(cv.x + cv.width * 0.4, cv.y + cv.height * 0.6, { steps: 8 }); await page.mouse.up();
  await page.click('#toneTools [data-tool="hatch"]');
  await page.mouse.move(cv.x + cv.width * 0.65, cv.y + cv.height * 0.3); await page.mouse.down(); await page.mouse.move(cv.x + cv.width * 0.85, cv.y + cv.height * 0.5, { steps: 6 }); await page.mouse.up();
  ok(!(await page.isDisabled("#toneSave")) && !(await page.isDisabled("#toneUndo")), "two strokes drawn: Save and Undo are on");
  await page.click("#toneSave");
  await page.waitForFunction(() => document.getElementById("toneSave").textContent === "Save" && document.getElementById("toneSave").disabled, null, { timeout: 60000 });
  await shot("tone-hand", "#toneDlg");
  await page.click("#toneDlgX");
  pg = await saved(); const t1 = first(pg).toned;
  ok(t1.src !== t0.src && t1.strokes === 2 && /2 strokes by hand/.test(await page.textContent("#toneInfo")), "saved: a new flat picture, 2 strokes by hand: " + t1.src);
  const ink = (src) => +py("import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert('L'); w,h=im.size; c=im.crop((int(w*0.2),int(h*0.4),int(w*0.32),int(h*0.5)))\nprint(1-sum(c.getdata())/255/(c.width*c.height))", src);
  const tdir = path.join(dir, path.dirname(t1.src));
  ok(fs.existsSync(path.join(tdir, "strokes.json")) && fs.existsSync(path.join(tdir, "mask-20.png")) && ink(path.join(dir, t1.src)) < 0.08, "the dots are scraped off under the brush, and the layers and strokes are kept beside the picture");
  // the export holds the dots
  await page.click("#exportBtn"); await page.waitForSelector("#exDlg[open]"); await page.click('#exFormat [data-format="png"]');
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.click("#exGo")]); const png = path.join(tmp, "page.png"); await dl.saveAs(png);
  const same = +py("import sys\nfrom PIL import Image, ImageChops\nex=Image.open(sys.argv[1]).convert('L'); fl=Image.open(sys.argv[2]).convert('L'); x,y=int(sys.argv[3]),int(sys.argv[4])\nw,h=fl.size; a=ex.crop((x+w//2-150,y+h//2-150,x+w//2+150,y+h//2+150)); b=fl.crop((w//2-150,h//2-150,w//2+150,h//2+150))\nd=ImageChops.difference(a,b); print(sum(1 for v in d.getdata() if v>40)/90000)", png, path.join(dir, t1.src), String(t1.box[0]), String(t1.box[1]));
  ok(same < 0.02, `the exported page carries the Toner's dots exactly, never rescaled (${(same * 100).toFixed(2)}% of pixels differ)`);
  await page.waitForFunction(() => !document.getElementById("exDlg").open);
  // a dragged gutter: the panel is stale, its plain picture shows, and the page check says so
  await page.click('#modeTabs [data-mode="layout"]');
  const gut = await page.locator("#page [data-gut='row']").first().boundingBox();
  await page.mouse.move(gut.x + gut.width / 2, gut.y + gut.height / 2); await page.mouse.down(); await page.mouse.move(gut.x + gut.width / 2, gut.y + gut.height / 2 + 40, { steps: 4 }); await page.mouse.up();
  await page.click('#modeTabs [data-mode="letter"]');
  ok(/has changed since it was toned/.test(await page.textContent("#checks")), "after a gutter is dragged the page check says the panel must be toned again");
  ok(await page.locator('#page image[href*="art/tone/"]').count() < 4, "and its plain picture shows meanwhile");
  await page.click('#modeTabs [data-mode="art"]'); await page.locator("#page polygon.phit").nth(0).click({ force: true });
  ok(/has changed since it was toned/.test(await page.textContent("#toneInfo")), "Art says the same on the panel");
  await page.click("#tonePage");
  await page.waitForFunction(() => document.querySelectorAll('#page image[href*="art/tone/"]').length === 4, null, { timeout: 180000 });
  pg = await saved();
  ok(first(pg).toned.strokes === 2 && !/has changed since/.test(await page.textContent("#toneInfo")), "toning the page again fits the new shape and keeps the hand's strokes");
  // the chapter screen offers the whole chapter
  await page.click('#modeTabs [data-mode="chapter"]');
  ok(await page.isVisible("#toneAllBtn"), "the Chapter screen offers Toner: tone every page");
  ok(errors.length === 0, "no script errors: " + errors.join(" | "));
} finally {
  if (browser) await browser.close();
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
done("the Toner");
