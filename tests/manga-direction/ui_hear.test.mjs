// "Write down what is said" on the anime scene screen, in a real browser, desktop and phone. A stand-in plays the local Whisper
// (tests/fake-whisper.mjs): no model is run and nothing is sent anywhere. Runs on a scratch copy of the app.
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { ok, done } from "./helpers.mjs";
import { REPO, copyApp, startApp, makeScene } from "../harness.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  write down what is said (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);

const copy = copyApp(), fake = path.join(copy.bin, "my-whisper");
fs.writeFileSync(fake, `#!/bin/sh\nexec node ${JSON.stringify(path.join(REPO, "tests", "fake-whisper.mjs"))} "$@"\n`); fs.chmodSync(fake, 0o755);
const plan = () => ({ shots: [{ shot_id: "S01", duration: 4, action: "Joss calls from the deck.", scene_type: "dialogue", camera: { framing: "medium", move: "still", move_reason: "" }, lines: ["L1", "L2"],
  clip: "api/anime/media?id=scene-one&f=clips/S01.mp4", clip_dur: 4, clip_sound: false }, { shot_id: "S02", duration: 2, action: "The ferry pulls away.", camera: { framing: "wide", move: "still", move_reason: "" } }],
  dialogue: [{ line_id: "L1", speaker: "Joss", text: "Old words.", kind: "speech" }, { line_id: "L2", speaker: "Mara", text: "", kind: "speech" }] });
const scene = makeScene(copy, "scene-one", plan()); fs.mkdirSync(path.join(scene, "clips")); fs.writeFileSync(path.join(scene, "clips", "S01.mp4"), "not a real video");
const app = await startApp(copy, { env: { STUDIO_WHISPER: fake } }); let browser;
const saved = () => JSON.parse(fs.readFileSync(path.join(scene, "SCENE_PLAN.json"), "utf8"));
const until = async (fn) => { for (let i = 0; i < 60; i++) { if (fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
try {
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  for (const vp of [{ width: 1400, height: 1000 }, { width: 390, height: 800 }]) {
    const at = vp.width < 600 ? "phone" : "desktop";
    fs.writeFileSync(path.join(scene, "SCENE_PLAN.json"), JSON.stringify({ scene_id: "scene-one", ...plan() })); fs.rmSync(path.join(scene, "hear"), { recursive: true, force: true });
    const page = await browser.newPage({ viewport: vp }); const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    let answer = false; const asked = []; page.on("dialog", (d) => { asked.push(d.message()); answer ? d.accept() : d.dismiss(); });
    const shot = async (n) => { if (process.env.IBASHO_SHOTS) await page.screenshot({ path: path.join(process.env.IBASHO_SHOTS, `${n}-${at}.png`) }); };
    await page.goto(app.base + "/anime/#/scene/scene-one"); await page.waitForSelector("#shots .shot");
    if (!(await page.locator("[data-hear]").count())) await page.locator('#shots .shot [data-act="toggle"]').first().click();
    await page.waitForSelector('[data-hear][data-hear-shot="S01"]', { state: "attached" });
    ok(/Write down what is said/.test(await page.locator('[data-hear][data-hear-shot="S01"]').first().textContent()), at + ": a shot with a video clip has “Write down what is said”");
    await page.locator('[data-hear][data-hear-shot="S01"]').first().evaluate((b) => b.click());
    await page.waitForSelector("#hearDlg[open]"); await page.waitForFunction(() => /Ready/.test(document.getElementById("hearMsg").textContent));
    ok(/on this computer/.test(await page.textContent("#hearMsg")) && /Nothing is sent anywhere/.test(await page.textContent("#hearMsg")) && /S01\.mp4/.test(await page.textContent("#hearNote")), at + ": it says a Whisper on this computer will listen: " + await page.textContent("#hearMsg"));
    await page.click("#hearGo"); await page.waitForSelector("#hearOut .hear-seg");
    let segs = await page.locator("#hearOut .hear-seg").allTextContents();
    ok(segs.length === 2 && /0:00\.4 to 0:01\.9/.test(segs[0]) && /こっちだ！/.test(segs[0]) && /0:02\.3 to 0:04\.1|0:02\.2 to 0:04\.1/.test(segs[1]), at + ": the words come back with their times: " + JSON.stringify(segs).slice(0, 200));
    ok(/2 pieces of speech, heard as ja/.test(await page.textContent("#hearMsg")) && await page.isVisible("#hearCopy") && await page.isVisible("#hearFoot"), at + ": and how much was heard");
    // in English, kept apart
    await page.selectOption("#hearTo", "en"); await page.waitForFunction(() => !document.querySelector("#hearOut .hear-seg") && /Ready/.test(document.getElementById("hearMsg").textContent));
    await page.click("#hearGo"); await page.waitForFunction(() => /Over here!/.test(document.getElementById("hearOut").textContent));
    ok(await page.locator("#hearOut .hear-seg select option").count() === 4 && /Joss: Old words\./.test(await page.locator("#hearOut .hear-seg select").first().textContent()), at + ": each piece can go into one of the shot's lines");
    await shot("hear");
    // a line that has words is only replaced after a yes
    answer = false; await page.locator("#hearOut [data-put]").first().click(); await page.waitForTimeout(1200);
    ok(asked.length === 1 && /already has its words/.test(asked[0]) && /Old words\./.test(asked[0]) && /Over here!/.test(asked[0]) && saved().dialogue[0].text === "Old words.", at + ": it asks before replacing a line's words, and No keeps them");
    answer = true; await page.locator("#hearOut [data-put]").first().click();
    ok(await until(() => saved().dialogue[0].text === "Over here!") && /Put into Joss's line/.test(await page.textContent("#hearMsg")), at + ": Yes puts the heard words into the line, and it is saved: " + saved().dialogue[0].text);
    // an empty line takes them with no question
    const n = asked.length; await page.locator("#hearOut .hear-seg select").nth(1).selectOption("L2"); await page.locator("#hearOut [data-put]").nth(1).click();
    ok(await until(() => saved().dialogue[1].text === "The ferry is leaving.") && asked.length === n, at + ": a line with no words yet is filled without a question");
    ok(saved().shots.length === 2 && saved().shots[0].clip === plan().shots[0].clip, at + ": nothing else in the plan changed");
    // closed and opened again: what was written down is still there
    await page.click("#hearClose"); await page.locator('[data-hear][data-hear-shot="S01"]').first().evaluate((b) => b.click());
    await page.waitForFunction(() => /Written down/.test(document.getElementById("hearMsg").textContent)).catch(() => {});
    ok(/Over here!/.test(await page.textContent("#hearOut")) && /Listen again/.test(await page.textContent("#hearGo")), at + ": opened again, the words are kept: " + await page.textContent("#hearMsg"));
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), at + ": nothing runs off the side of the screen");
    ok(errors.length === 0, at + ": no script errors: " + errors.join(" | "));
    await page.close();
  }
} finally { if (browser) await browser.close(); await app.stop(); }
done("write down what is said");
