// "Use existing stills" on the Chapter screen: pick where the stills are, see the match as a sheet, change or untick a panel, put the
// accepted stills on their panels, then tap the face. In a real browser, desktop and phone size, on a scratch COPY of the app
// (tests/harness.mjs): its own port, scratch saved work, a stand-in `codex`; the stills are made by code.
// Needs playwright-core (set IBASHO_PLAYWRIGHT) and a Chromium; skipped when there is none.
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module"; import { execFileSync } from "node:child_process";
import { ok, done } from "./helpers.mjs";
import { copyApp, startApp, REPO } from "../harness.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  use existing stills (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);

const copy = copyApp(), root = path.join(copy.scratch, "stills-root"), folder = path.join(root, "pier");
fs.rmSync(path.join(copy.app, "page-editor", "samples"), { recursive: true, force: true });
const IDS = { desktop: "zz-stills-desktop", phone: "zz-stills-phone" };
for (const id of Object.values(IDS)) { const d = path.join(copy.app, "page-editor", "projects", id); fs.mkdirSync(d, { recursive: true }); fs.cpSync(path.join(REPO, "tests/manga-direction/fixtures/ferry"), d, { recursive: true }); execFileSync("node", [path.join(copy.app, "tools/build_spec.mjs"), d], { stdio: "ignore" }); }
fs.mkdirSync(path.join(folder, "stills"), { recursive: true });
const shots = [
  { shot_id: "RS001", source_ids: ["L001"], camera: { framing: "WS high" }, expressions: { mara: "still", joss: "running" }, action: "The pier at night, one lamp." },
  { shot_id: "RS002", source_ids: ["L002"], camera: { framing: "MS" }, expressions: { joss: "shrug" }, action: "Joss shrugs." },
  { shot_id: "RS003", source_ids: ["L003"], camera: { framing: "CU low" }, expressions: { mara: "flat" }, action: "Mara, flat." },
  { shot_id: "RS004", source_ids: ["L003"], camera: { framing: "WS" }, expressions: { mara: "flat" }, action: "Mara from far off." },
].map((s) => ({ ...s, still: `stills/${s.shot_id}.png` }));
fs.writeFileSync(path.join(folder, "SCENE_PLAN.json"), JSON.stringify({ scene_id: "pier", shots }));
// each still: a flat field with one bright square (the "face") off to the left, so a tap has something to aim at
execFileSync("/usr/bin/python3", ["-c", "import sys\nfrom PIL import Image, ImageDraw\nfor i,n in enumerate(sys.argv[2:]):\n im=Image.new('RGB',(600,400),(60+30*i,90,120)); ImageDraw.Draw(im).rectangle([90,60,210,180],fill=(240,230,200)); im.save(sys.argv[1]+'/'+n+'.png')", path.join(folder, "stills"), ...shots.map((s) => s.shot_id)]);
const app = await startApp(copy, { env: { STUDIO_STILL_ROOTS: root } });
let browser;
try {
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  for (const [name, viewport] of [["desktop", { width: 1400, height: 1000 }], ["phone", { width: 390, height: 800 }]]) {
    const ID = IDS[name], T = (what) => `${name}: ${what}`, proj = path.join(copy.app, "page-editor", "projects", ID);
    const page = await browser.newPage({ viewport, hasTouch: name === "phone" });
    const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("dialog", (d) => d.accept());
    await page.goto(app.base + "/"); await page.waitForSelector("#projSel option", { state: "attached" });
    await page.evaluate((id) => { document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
    await page.waitForFunction(() => document.getElementById("sbProj").textContent.includes("4 pages"));
    await page.waitForSelector("#stillsBtn:not([hidden])");
    await page.click("#stillsBtn"); await page.waitForSelector("#stillsDlg[open] .st-src");
    ok(await page.$$eval(".st-src", (l) => l.map((b) => b.textContent)).then((l) => l.length === 1 && /pier/.test(l[0]) && /4 stills/.test(l[0])), T("the folder of stills is offered with its count"));
    ok(await page.isVisible("#stillsDlg .st-add summary"), T("a way to add a folder kept elsewhere is offered on this computer"));
    await page.click(".st-src"); await page.waitForSelector(".st-sheet .st-row");
    ok(await page.$$eval(".st-row", (l) => l.length) === 13 && await page.$$eval(".st-row img", (l) => l.length) === 3, T("every panel is on the sheet; three have a still"));
    ok(/a still was found for 3/.test(await page.textContent("#stillsNote")) && /Put 3 stills on their panels/.test(await page.textContent("#stillsGo")), T("the sheet says how many: " + await page.textContent("#stillsNote")));
    ok(await page.$eval('[data-pick="b01-n4"]', (s) => s.value) === "RS003", T("the close-up panel got the close-up still"));
    ok(await page.$eval('.st-row[data-panel="b01-n3"]', (r) => /Nothing in the stills shows this part/.test(r.textContent) && !r.querySelector("select")), T("a panel with no still says so and offers none"));
    ok(await page.evaluate(() => [...document.querySelectorAll(".st-row img")].every((i) => i.complete && i.naturalWidth > 0)), T("the stills' pictures load"));
    // change one, untick one
    await page.selectOption('[data-pick="b01-n4"]', "RS004");
    ok(await page.$eval('.st-row[data-panel="b01-n4"] img', (i) => /RS004/.test(i.src)), T("changing a panel's still shows the other picture"));
    await page.selectOption('[data-pick="b01-n2"]', "");
    ok(/Put 2 stills/.test(await page.textContent("#stillsGo")) && await page.$eval('.st-row[data-panel="b01-n2"]', (r) => r.classList.contains("off") && !r.querySelector("img")), T("unticking a panel leaves it for the Artist: " + await page.textContent("#stillsGo")));
    const fits = await page.evaluate(() => { const r = document.getElementById("stillsDlg").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && document.getElementById("stillsDlg").scrollWidth <= document.getElementById("stillsDlg").clientWidth + 1; });
    ok(fits, T("the sheet fits the screen, nothing runs off sideways"));
    if (process.env.IBASHO_SHOTS) await page.screenshot({ path: path.join(process.env.IBASHO_SHOTS, `stills-sheet-${name}.png`) });
    ok(!fs.existsSync(path.join(proj, "art", "assignments.json")), T("nothing is changed before the button is pressed"));
    await page.click("#stillsGo"); await page.waitForSelector(".st-faces .st-face", { timeout: 20000 });
    const assign = JSON.parse(fs.readFileSync(path.join(proj, "art", "assignments.json"), "utf8"));
    ok(JSON.stringify(Object.keys(assign).sort()) === '["b01-n1","b01-n4"]' && assign["b01-n4"].take === "still-RS004", T("the two accepted stills are on their panels: " + JSON.stringify(assign)));
    ok(await page.$$eval(".st-face", (l) => l.length) === 2, T("the face step shows the two placed pictures"));
    ok(/2 stills in place/.test(await page.textContent("#status")), T("the status line says so: " + await page.textContent("#status")));
    // tap the face (the bright square: its middle is a quarter in, 30% down)
    const face = page.locator('[data-face="b01-n4"] img'), box = await face.boundingBox();
    const at = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.3 };
    if (name === "phone") await page.touchscreen.tap(at.x, at.y); else await page.mouse.click(at.x, at.y);
    await page.waitForSelector(".st-faces figure.set");
    const kept = JSON.parse(fs.readFileSync(path.join(proj, "art", "assignments.json"), "utf8"))["b01-n4"].focus;
    ok(kept && Math.abs(kept[0] - 0.25) < 0.02 && Math.abs(kept[1] - 0.3) < 0.02, T("the tap is kept with the picture: " + JSON.stringify(kept)));
    ok(await page.$eval('[data-face="b01-n4"] i', (d) => !d.hidden), T("a dot shows where the tap was"));
    if (process.env.IBASHO_SHOTS) await page.screenshot({ path: path.join(process.env.IBASHO_SHOTS, `stills-faces-${name}.png`) });
    await page.click("#stillsX");
    // the open chapter has the pictures and the focus, and saves them
    await page.waitForFunction(async (id) => { const sv = await (await fetch("/api/spec?p=" + id)).json().catch(() => null); const f = []; const walk = (rows) => { for (const r of rows) for (const q of r.panels) { if (q.rows) walk(q.rows); else f.push(q); } }; for (const p of (sv && sv.pages) || []) if (p.layout) walk(p.layout.rows); const q = f.find((x) => x.id === "b01-n4"); return q && q.image === "art/still-RS004.jpg" && q.focus && Math.abs(q.focus[0] - 0.25) < 0.02; }, ID, { timeout: 15000 }).then(() => ok(true, T("the chapter is saved with the still and the face's place")), () => ok(false, T("the chapter is saved with the still and the face's place")));
    // opened again: the placed panels are marked, and are not ticked to be replaced
    await page.click("#stillsBtn"); await page.waitForSelector("#stillsDlg[open] .st-src"); await page.click(".st-src"); await page.waitForSelector(".st-sheet .st-row");
    ok(await page.$eval('.st-row[data-panel="b01-n1"]', (r) => /already has a picture/.test(r.textContent)) && /Put 1 still on its panel/.test(await page.textContent("#stillsGo")), T("a second look leaves panels that have a picture alone: " + await page.textContent("#stillsGo")));
    await page.click("#stillsX");
    ok(errors.length === 0, T("no script errors: " + errors.join(" | ")));
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  await app.stop();
}
done("use existing stills");
