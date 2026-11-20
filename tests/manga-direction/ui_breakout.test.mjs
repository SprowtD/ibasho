// Custom panel styles, part 3, in a real browser: a break-out, a figure drawn by itself, cut out and laid over the panel borders.
// Codex is played by tests/manga-direction/fixtures/fake_draw.py (a plain figure on white; no model is reached). Same safety as the other screen tests.
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  break-outs (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const PORT = 5401, tmp = scratch("uibreakout"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-breakout-test";
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), `#!/bin/sh\nexec /usr/bin/python3 ${JSON.stringify(path.join(APP, "tests/manga-direction/fixtures/fake_draw.py"))} "$@"\n`, { mode: 0o755 }); // "draws" a plain figure on white
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
  const asked = []; page.on("dialog", (d) => { asked.push(d.message()); d.type() === "prompt" ? d.accept(/Who or what/.test(d.message()) ? "Mara" : "Leaping off the pier, coat flying, one arm reaching toward the reader.") : d.accept(); });
  const shot = async (n, sel) => { if (process.env.IBASHO_SHOTS) await (sel ? page.locator(sel) : page).screenshot({ path: path.join(process.env.IBASHO_SHOTS, n + ".png") }); };
  await page.goto(U + "/"); await page.waitForSelector("#projSel option", { state: "attached" });
  await page.evaluate((id) => { document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
  await page.waitForFunction((id) => localStorage.getItem("ld-project") === id && /pages/.test(document.getElementById("sbProj").textContent) && document.getElementById("status").textContent === "Saved", ID);
  const py = (code, ...a) => execFileSync("/usr/bin/python3", ["-c", code, ...a]).toString().trim();
  const saved = async () => { await page.waitForFunction(() => document.getElementById("status").textContent !== "Saving…", null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1600); return (await (await fetch(`${U}/api/spec?p=${ID}`)).json()).pages[0].layout.breakouts || []; };
  await page.click('#side [data-page="0"]'); await page.click('#modeTabs [data-mode="layout"]');
  ok(await page.isVisible("#boBtn") && !(await page.isVisible("#boTools")), "Layout offers + Break-out");
  await page.locator("#page polygon.phit").nth(1).click({ force: true });
  await page.click("#boBtn");
  ok(asked.length === 2 && /Who or what breaks out/.test(asked[0]) && /What are they doing/.test(asked[1]), "it asks who or what, and the pose");
  await page.waitForSelector("#page .bo-wait");
  ok(/Break-out: Mara/.test(await page.textContent("#page .selection")) && await page.isVisible("#boTools") && /Mara: Leaping off the pier/.test(await page.textContent("#boInfo")), "its place shows on the page while it is drawn: " + await page.textContent("#boInfo"));
  // the drawing lands by itself
  await page.waitForSelector('#page image[href*="art/breakouts/"]', { state: "attached", timeout: 60000 });
  const href = await page.getAttribute('#page image[href*="art/breakouts/"]', "href"), bdir = path.join(dir, "art", "breakouts");
  ok(/-take01\.png$/.test(href) && (await page.locator("#page .bo-wait").count()) === 0 && /is drawn and on the page/.test(await page.textContent("#status")), "the drawn figure lands on the page by itself: " + href);
  const files = fs.readdirSync(bdir), raw = files.find((n) => /-take01-raw\.png$/.test(n)), cut = files.find((n) => /-take01\.png$/.test(n));
  const info = JSON.parse(py("import sys,json\nfrom PIL import Image\nim=Image.open(sys.argv[1]); print(json.dumps([im.mode, im.getpixel((1,1))[3], im.getpixel((im.width//2, im.height//2))]))", path.join(bdir, cut)));
  ok(raw && cut && info[0] === "RGBA" && info[1] === 0 && info[2][3] === 255, "the figure is cut out of its white background (clear round it, solid inside): " + JSON.stringify(info));
  const prompt = fs.readFileSync(path.join(bdir, files.find((n) => /\.prompt\.txt$/.test(n))), "utf8");
  ok(/CUT-OUT FIGURE/.test(prompt) && /PURE WHITE background/.test(prompt) && /WHO OR WHAT\. Mara/.test(prompt) && /THE POSE\. Leaping off the pier/.test(prompt), "the Artist is asked for one figure alone on plain white, with the pose");
  let b = (await saved())[0];
  ok(b && b.image === href.replace(/^.*?(art\/breakouts\/)/, "$1") && b.who === "Mara" && b.box.length === 4 && b.panel, "it is saved with the page: " + JSON.stringify(b));
  await shot("breakout-page", "#page");
  // it stands above the borders: its box reaches outside its panel
  const boxes = await page.evaluate(() => [...document.querySelectorAll("#page polygon.phit")].map((p) => { const r = p.getBBox(); return [r.x, r.y, r.x + r.width, r.y + r.height]; }));
  ok(boxes.every((r) => !(b.box[0] * 1000 >= r[0] && b.box[1] * 1500 >= r[1] && b.box[2] * 1000 <= r[2] && b.box[3] * 1500 <= r[3])), "it is not held inside any one panel");
  // move it by its body, resize by its dot, flip
  const at = await page.locator(`#page rect.phit[data-bo]`).boundingBox();
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2); await page.mouse.down(); await page.mouse.move(at.x + at.width / 2 + 40, at.y + at.height / 2 + 60, { steps: 4 }); await page.mouse.up();
  let c = (await saved())[0];
  ok(c.box[0] > b.box[0] + 0.02 && c.box[1] > b.box[1] + 0.02 && Math.abs((c.box[2] - c.box[0]) - (b.box[2] - b.box[0])) < 0.002, "dragging it moves it: " + JSON.stringify(c.box));
  const knob = await page.locator('#page [data-part="bresize"]').boundingBox();
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2); await page.mouse.down(); await page.mouse.move(knob.x + knob.width / 2 + 50, knob.y + knob.height / 2 + 50, { steps: 4 }); await page.mouse.up();
  let d2 = (await saved())[0];
  ok(d2.box[2] - d2.box[0] > c.box[2] - c.box[0] + 0.03 && Math.abs((d2.box[2] - d2.box[0]) / (d2.box[3] - d2.box[1]) - (c.box[2] - c.box[0]) / (c.box[3] - c.box[1])) < 0.02, "its corner dot makes it bigger and keeps its shape: " + JSON.stringify(d2.box));
  await page.click("#boFlip");
  ok(/scale\(-1 1\)/.test(await page.getAttribute('#page image[href*="art/breakouts/"]', "transform") || ""), "Flip mirrors it");
  // it is in the exported page
  await page.click("#exportBtn"); await page.waitForSelector("#exDlg[open]"); await page.click('#exFormat [data-format="png"]');
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#exGo")]); const png = path.join(tmp, "page.png"); await dl.saveAs(png);
  const grey = +py("import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert('RGB').resize((250,375))\nprint(sum(1 for p in im.getdata() if abs(p[0]-120)<6 and abs(p[1]-120)<6 and abs(p[2]-120)<6))", png);
  ok(grey > 40, "the exported page holds the figure (" + grey + " of its grey pixels found)");
  // draw again: a second take replaces the first
  await page.waitForFunction(() => !document.getElementById("exDlg").open);
  ok((await page.textContent("#boDraw")).trim() === "Draw it again", "a drawn break-out offers Draw it again");
  await page.click("#boDraw");
  await page.waitForSelector('#page image[href*="-take02.png"]', { state: "attached", timeout: 60000 });
  ok(true, "the second take lands in its place");
  // remove, and undo
  await page.click("#boRemove");
  ok((await page.locator('#page image[href*="art/breakouts/"]').count()) === 0 && !(await page.isVisible("#boTools")), "Remove takes it off the page");
  await page.click("#undoBtn");
  ok((await page.locator('#page image[href*="art/breakouts/"]').count()) === 1, "Undo brings it back");
  // the lettered page, the chapter screen and a page step keep it
  await page.click('#modeTabs [data-mode="letter"]');
  ok((await page.locator('#page image[href*="art/breakouts/"]').count()) === 1 && (await page.locator("#page rect.phit[data-bo]").count()) === 0, "it shows in Lettering too, and cannot be moved there");
  ok(errors.length === 0, "no script errors: " + errors.join(" | "));
} finally {
  if (browser) await browser.close();
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
done("break-outs");
