// The Library in a real browser, desktop and phone: everything made in one list, Find, kind and place, and a tap that opens it where it lives.
// It runs on a scratch copy of the app (tests/harness.mjs); nothing in page-editor/saved or page-editor/projects is touched.
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module"; import { execFileSync } from "node:child_process";
import { ok, done } from "./helpers.mjs";
import { copyApp, startApp, makeProject, makeScene } from "../harness.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  the Library (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const pic = (f, c) => execFileSync("/usr/bin/python3", ["-c", "import sys\nfrom PIL import Image\nImage.new('RGB',(320,240),tuple(int(v) for v in sys.argv[2].split(','))).save(sys.argv[1])", f, c]);

const copy = copyApp(); fs.rmSync(path.join(copy.app, "page-editor", "samples"), { recursive: true, force: true });
const dir = makeProject(copy, "ferry-ch01", { spec: { project: "The Last Ferry", chapter: 1, pages: [{ id: "p1", number: 1, label: "Page 1", text: [], layout: { rows: [{ h: 1, panels: [
  { id: "a1", w: 1, image: "art/a1.jpg", board: { shot: "medium", action: "Mara waits on the pier in the rain.", who: [{ name: "Mara", at: [0.5, 0.4], size: "medium", facing: "left" }], lines: [] } },
  { id: "a2", w: 1, image: "art/a2.jpg", board: { shot: "insert", action: "The ferry lamp, lit.", who: [], lines: [] } }] }] } }] } });
pic(path.join(dir, "art", "a1.jpg"), "200,60,40"); pic(path.join(dir, "art", "a2.jpg"), "40,60,200");
fs.writeFileSync(path.join(dir, "art", "library.json"), JSON.stringify([{ src: "art/a1.jpg", label: "Page 1 · a1", size: [320, 240] }, { src: "art/a2.jpg", label: "Page 1 · a2", size: [320, 240] }]));
const scene = makeScene(copy, "scene-one", { shots: [{ shot_id: "S01", duration: 3, action: "She waves from the deck.", framing: "wide", still: "api/anime/media?id=scene-one&f=stills/S01-take1.png", clip: "api/anime/media?id=scene-one&f=clips/S01.mp4", lines: ["L1"] }], dialogue: [{ line_id: "L1", speaker: "Joss", text: "Over here!" }] });
fs.mkdirSync(path.join(scene, "stills")); fs.mkdirSync(path.join(scene, "clips")); pic(path.join(scene, "stills", "S01-take1.png"), "60,160,90"); fs.writeFileSync(path.join(scene, "clips", "S01.mp4"), "x");
fs.mkdirSync(path.join(copy.saved, "create"), { recursive: true }); pic(path.join(copy.saved, "create", "c1.png"), "220,200,60"); fs.writeFileSync(path.join(copy.saved, "create", "c2.mp4"), "x");
for (const m of [{ id: "c1", kind: "picture", status: "done", file: "c1.png", prompt: "A lighthouse at dusk, loose pen.", model: "x/picture-model", at: "2026-11-01T10:00:00.000Z" }, { id: "c2", kind: "video", status: "done", file: "c2.mp4", prompt: "Waves against the hull.", model: "x/video-model", at: "2026-11-02T10:00:00.000Z" }])
  fs.writeFileSync(path.join(copy.saved, "create", m.id + ".json"), JSON.stringify(m));
const app = await startApp(copy); let browser;
try {
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  for (const vp of [{ width: 1400, height: 1000 }, { width: 390, height: 800 }]) {
    const at = vp.width < 600 ? "phone" : "desktop", ctx = await browser.newContext({ viewport: vp }), page = await ctx.newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    const shot = async (n) => { if (process.env.IBASHO_SHOTS) await page.screenshot({ path: path.join(process.env.IBASHO_SHOTS, `${n}-${at}.png`) }); };
    const tiles = () => page.locator("#grid a.it").count(), settled = (n) => page.waitForFunction((k) => document.querySelectorAll("#grid a.it").length === k, n, { timeout: 8000 }).then(() => true, () => false);
    // the way in: Library is in the top bar of the manga screen and of Create
    await page.goto(app.base + "/"); ok(await page.locator('.ws a.wsb[href="/library"]').count() === 1, at + ": the manga screen's top bar has Library");
    await page.goto(app.base + "/create"); ok(await page.locator('.ws a.wsb[href="/library"]').count() === 1, at + ": Create's top bar has Library");
    await page.goto(app.base + "/library"); ok(await settled(6), at + ": all six things made are listed: " + await tiles());
    ok(/6 of 6 shown/.test(await page.textContent("#count")) && /All 6/.test(await page.textContent("#kinds")) && /Videos 2/.test(await page.textContent("#kinds")) && /Manga 2/.test(await page.textContent("#sources")), at + ": the counts are said: " + await page.textContent("#count"));
    const first = await page.evaluate(() => { const a = document.querySelector('#grid a.it[data-key="manga:ferry-ch01:art/a1.jpg"]'), im = a.querySelector("img"); return { text: a.textContent, src: im && im.getAttribute("src"), href: a.getAttribute("href") }; });
    ok(/The Last Ferry, chapter 1/.test(first.text) && /Page 1 · a1/.test(first.text) && /Mara waits on the pier/.test(first.text) && /Mara/.test(first.text) && /projects\/ferry-ch01\/art\/a1\.jpg/.test(first.src), at + ": a tile says where it is from, its panel, its words and who is in it: " + JSON.stringify(first));
    ok(await page.evaluate(async () => { const im = [...document.querySelectorAll("#grid img")]; await Promise.all(im.map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))); return im.length >= 4 && im.every((i) => i.naturalWidth > 0); }), at + ": the small pictures load");
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), at + ": nothing runs off the side of the screen");
    await shot("library");
    // Find: every word typed
    await page.fill("#find", "ferry lamp"); ok(await settled(1) && /1 of 1 shown \(6 in the whole Library\)/.test(await page.textContent("#count")), at + ": Find keeps what has every word: " + await page.textContent("#count"));
    await page.fill("#find", "joss"); ok(await settled(2), at + ": a speaker's name finds the shot's picture and its clip");
    await page.fill("#find", "zebra"); ok(await settled(0) && /Nothing by that name/.test(await page.textContent("#count")), at + ": no match says so");
    await page.fill("#find", ""); await settled(6);
    // kind and place
    await page.click('#kinds [data-kind="video"]'); ok(await settled(2) && await page.getAttribute('#kinds [data-kind="video"]', "aria-pressed") === "true", at + ": Videos shows the two videos");
    await page.click('#sources [data-source="create"]'); ok(await settled(1) && /Waves against the hull/.test(await page.textContent("#grid")), at + ": and Create narrows it to one");
    await page.reload(); ok(await settled(1), at + ": the two choices are remembered on this device");
    await page.click('#kinds [data-kind=""]'); await page.click('#sources [data-source=""]'); ok(await settled(6), at + ": All and Everywhere bring everything back");
    // a tap opens it where it lives
    await page.click('#grid a.it[data-key="anime:scene-one:stills/S01-take1.png"]'); await page.waitForURL(/\/anime\/#\/scene\/scene-one$/, { timeout: 8000 }).catch(() => {});
    ok(/\/anime\/#\/scene\/scene-one$/.test(page.url()), at + ": an anime still opens its scene: " + page.url());
    await page.goto(app.base + "/library"); await settled(6);
    ok(await page.getAttribute('#grid a.it[data-key="create:c1"]', "href") === "/create", at + ": a Create picture opens Create");
    await page.click('#grid a.it[data-key="manga:ferry-ch01:art/a2.jpg"]'); await page.waitForFunction(() => location.pathname === "/" && document.getElementById("projSel"), null, { timeout: 8000 }).catch(() => {});
    ok(new URL(page.url()).pathname === "/" && await page.evaluate(() => localStorage.getItem("ld-project")) === "ferry-ch01", at + ": a manga picture opens its chapter: " + page.url());
    ok(errors.length === 0, at + ": no script errors: " + errors.join(" | "));
    await ctx.close();
  }
} finally { if (browser) await browser.close(); await app.stop(); }
done("the Library");
