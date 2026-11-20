// The Assistant on the anime scene screen, in a real browser, with the model's answers played by the test (no model is called):
// shot-level steps change only their shots, at once, and are saved; every button says what it really did; a step that cannot
// run says why; the next message carries those facts; Undo takes a step back; planning the whole scene again asks first.
// The scene lives in a scratch folder; nothing of the real app is touched.
import { spawn } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  the Assistant's shot steps (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const PORT = 5398, tmp = scratch("uianimeassistant"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "pier";
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
const sdir = path.join(tmp, "anime", ID), planFile = path.join(sdir, "SCENE_PLAN.json");
fs.mkdirSync(sdir, { recursive: true }); fs.mkdirSync(path.join(tmp, "looks", "look-one"), { recursive: true });
fs.writeFileSync(path.join(sdir, "scene.json"), JSON.stringify({ id: ID, title: "The pier", project: "", made: new Date().toISOString(), look: "look-one" }));
fs.writeFileSync(path.join(tmp, "looks", "look-one", "look.json"), JSON.stringify({ id: "look-one", name: "Look one", text: "", refs: [], cast: {} }));
const LONG = "Mara turns from the rail and looks at him for a long moment before she speaks. ".repeat(4).trim();
fs.writeFileSync(planFile, JSON.stringify({ scene_id: ID, title: "The pier",
  dialogue: [{ line_id: "L1", speaker: "Mara", text: "You came." }, { line_id: "L2", speaker: "Tobias", text: "I said I would." }, { line_id: "L3", speaker: "Mara", text: "Sit." }],
  shots: [
    { shot_id: "S01", duration: 3, scene_type: "establishing", camera: { framing: "wide", move: "still" }, action: "The pier at dusk.", lines: [] },
    { shot_id: "S02", duration: 4, scene_type: "dialogue", camera: { framing: "medium", move: "still" }, action: LONG, lines: ["L1", "L2"], line_placement: "on_speaker" },
    { shot_id: "S03", duration: 2, scene_type: "dialogue", camera: { framing: "close-up", move: "still" }, action: "Tobias sits.", lines: ["L3"], line_placement: "on_speaker" },
    { shot_id: "S04", duration: 1.5, scene_type: "insert", camera: { framing: "close-up", move: "still" }, action: "A cup on the table.", lines: [] } ] }));
const srv = spawn("node", [path.join(PE, "server.mjs"), String(PORT)], { stdio: "ignore",
  env: { ...process.env, PATH: bin + ":" + process.env.PATH, STUDIO_SAVED: path.join(tmp, "saved"), STUDIO_ANIME: path.join(tmp, "anime"), STUDIO_LOOKS: path.join(tmp, "looks"), OPENROUTER_BASE: "http://127.0.0.1:9" } });
let browser;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(U + "/api/ping")).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  for (const view of [{ name: "desktop", width: 1400, height: 1000 }, { name: "phone", width: 400, height: 800 }]) {
    const first = view.name === "desktop";
    const page = await browser.newPage({ viewport: { width: view.width, height: view.height } });
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    const asked = []; page.on("dialog", (d) => { asked.push(d.message()); if (/WHOLE scene/.test(d.message())) d.dismiss(); else d.accept(); });
    let blocks = 0; page.on("request", (r) => { if (r.url().includes("/api/anime/block") && r.method() === "POST") blocks++; });
    let sent = null, answer = () => ({ reply: "", actions: [] });
    await page.route("**/api/assistant", async (route) => { sent = JSON.parse(route.request().postData()); await route.fulfill({ contentType: "application/json", body: JSON.stringify({ model: "Test", cost: 0, ...answer(sent) }) }); });
    await page.goto(U + "/anime/"); await page.evaluate(() => localStorage.removeItem("ibasho-assistant"));
    await page.goto(U + "/anime/#/scene/" + ID); await page.reload(); await page.waitForSelector("#shots .shot");
    const say = async (text) => { const n = await page.$$eval(".as-m.assistant", (l) => l.length); await page.fill("#asText", text); await page.press("#asText", "Enter"); await page.waitForFunction((k) => document.querySelectorAll(".as-m.assistant").length > k && !/Thinking/.test(document.getElementById("asLog").textContent), n); };
    const btn = (label) => page.locator(".as-m.assistant").last().locator(".as-acts .btn", { hasText: label });
    const saved = async (test) => { for (let i = 0; i < 40; i++) { const p = JSON.parse(fs.readFileSync(planFile, "utf8")); if (test(p)) return p; await new Promise((r) => setTimeout(r, 150)); } return JSON.parse(fs.readFileSync(planFile, "utf8")); };
    const T = (what) => `${view.name}: ${what}`;
    await page.click(".as-btn");

    // 1. what the Assistant is shown, and a split: one shot changes, at once; a made-up shot is refused with the reason
    let W;
    answer = (b) => { W = b.where; return { reply: "I can split shot S02 so each line has its own shot.", dropped: 1, actions: [{ name: "split_shot", args: { shot: "S02", line: "L2" }, why: "one line a shot" }, { name: "edit_shot", args: { shot: "S77", action: "x" }, why: "" }] }; };
    await say("Shot S02 is too long: split it");
    ok(W.screen === "anime" && W.shots.length === 4 && W.shots[1].id === "S02" && W.shots[1].lines.length === 2 && /^L1 Mara: You came\.$/.test(W.shots[1].lines[0]) && W.shots[1].type === "dialogue", T("the Assistant is shown every shot, with its lines and their ids"));
    ok(W.shots[1].action === LONG, T(`a shot's action is shown whole, not cut at 220 letters (${W.shots[1].action.length})`));
    ok(["open_shot", "edit_shot", "split_shot", "join_shots", "move_shot", "set_join", "long_take", "undo_step", "plan_again"].every((n) => sent.actions.some((a) => a.name === n)), T("shot-level steps are offered: " + sent.actions.map((a) => a.name).join(", ")));
    ok(/LAST RESORT/.test(sent.actions.find((a) => a.name === "plan_again").desc), T("planning the whole scene again is offered as a last resort"));
    ok(/1 step it proposed cannot be done from this screen/.test(await page.locator(".as-m.assistant").last().textContent()), T("a step the model made up is reported, not hidden"));
    ok(await btn("Change shot S77").isDisabled() && /Cannot run: There is no shot "S77"/.test(await btn("Change shot S77").textContent()), T("a step naming a shot that is not there is greyed, with the reason"));
    ok(await page.locator("#asUndo").isHidden(), T("no Undo button before any step"));
    await btn("Split shot S02 in two").click();
    await page.waitForFunction(() => document.querySelectorAll("#shots .shot").length === 5);
    ok(/✓.*Shot S02 is now two shots: S02 \(2 s, 1 line\) and the new S02b \(2 s, 1 line\).*Undo takes it back/.test(await btn("Split shot S02").textContent()), T("the button says what the step did: " + await btn("Split shot S02").textContent()));
    ok(await page.locator("#asUndo").isVisible(), T("Undo is offered on the scene"));
    let p = await saved((q) => q.shots.length === 5);
    ok(p.shots.map((s) => s.shot_id).join() === "S01,S02,S02b,S03,S04" && p.shots[1].lines.join() === "L1" && p.shots[2].lines.join() === "L2" && p.dialogue.length === 3 && p.dialogue[1].text === "I said I would.", T("the split is saved; every line is still there, word for word"));
    ok(blocks === 0, T("no Blocking pass was started for a one-shot change"));
    if (process.env.IBASHO_SHOTS && first) fs.writeFileSync(path.join(process.env.IBASHO_SHOTS, "anime-assistant-sent.json"), JSON.stringify(sent)); // what the screen sends, to try on a real model by hand
    if (process.env.IBASHO_SHOTS) await page.screenshot({ path: path.join(process.env.IBASHO_SHOTS, `anime-assistant-split-${view.name}.png`) });

    // 2. the next message carries the facts; the other shot steps
    answer = (b) => { W = b.where; return { reply: "More steps.", actions: [
      { name: "edit_shot", args: { shot: "S02b", action: "Tobias, close, rain on his coat.", framing: "close-up", seconds: 2.5 }, why: "" },
      { name: "move_shot", args: { shot: "S04", to: "earlier" }, why: "" }, { name: "move_shot", args: { shot: "S02", to: "later" }, why: "both have lines" },
      { name: "set_join", args: { shot: "S03", how: "wipe", cover: "Tobias's back crosses the lens", reason: "hide the jump in time" }, why: "" }, { name: "set_join", args: { shot: "S01", how: "wipe", cover: "fog" }, why: "the first shot" },
      { name: "long_take", args: { shot: "S02", on: "yes" }, why: "" }, { name: "join_shots", args: { shot: "S03" }, why: "never tapped" }] }; };
    await say("Now tidy the rest");
    const told = sent.messages.filter((m) => m.role === "assistant").pop().content;
    ok(/\[STEPS, written by the app:.*split_shot\(.*\) = RAN: Shot S02 is now two shots/.test(told) && /edit_shot\(.*S77.*\) = DID NOT RUN: Cannot run: There is no shot/.test(told), T("the model is told what ran and what did not"));
    ok(W.shots.length === 5 && W.shots[2].id === "S02b", T("and is shown the scene as it now is"));
    await btn("Change shot S02b: action, framing, seconds").click();
    ok(/✓.*Shot S02b: changed what happens, the framing, its length \(2\.5 s\)\. Its lines are untouched/.test(await btn("Change shot S02b").textContent()), T("edit_shot says what changed: " + await btn("Change shot S02b").textContent()));
    await btn("Move shot S04 one place earlier").click();
    ok(/✓.*Shot S04 now plays before S03/.test(await btn("Move shot S04").textContent()), T("move_shot moved the shot"));
    await btn("Move shot S02 one place later").click();
    ok(/both carry lines/.test(await btn("Move shot S02").textContent()) && !(await btn("Move shot S02").isDisabled()), T("a move that would put the script out of order is refused with the reason: " + await btn("Move shot S02").textContent()));
    await btn("Shot S03: join the shot before with a hidden wipe").click();
    ok(/✓.*Shot S03 now joins S04 with a hidden wipe: Tobias's back crosses the lens/.test(await btn("Shot S03: join").textContent()), T("set_join set the hidden wipe: " + await btn("Shot S03: join").textContent()));
    await btn("Shot S01: join the shot before").click();
    ok(/first shot/.test(await btn("Shot S01: join").textContent()), T("the first shot has no shot before it to join"));
    await btn("Shot S02: long take on").click();
    ok(/✓.*now a long take\. Still to do: it is 2 s and a long take runs 10 to 15 s/.test(await btn("Shot S02: long take").textContent()), T("long_take ticks it and says what the shot still needs"));
    p = await saved((q) => q.shots[1] && q.shots[1].long_take && q.shots[4] && q.shots[4].join === "wipe");
    ok(p.shots.map((s) => s.shot_id).join() === "S01,S02,S02b,S04,S03" && p.shots[2].action === "Tobias, close, rain on his coat." && p.shots[2].camera.framing === "close-up" && p.shots[2].duration === 2.5 && p.shots[2].lines.join() === "L2"
      && p.shots[4].join === "wipe" && p.shots[4].join_cover === "Tobias's back crosses the lens" && p.shots[4].join_reason === "hide the jump in time" && p.shots[1].long_take === true && !p.shots[0].join, T("all of it is saved, and nothing else changed: " + p.shots.map((s) => s.shot_id).join()));
    if (first) { // the shot's own form shows the join and the tick
      const ed = await page.textContent("#shotEd"); ok(/Long take/.test(ed), T("the shot editor is open on the changed shot"));
    }

    // 3. Undo: the Assistant's own step, then the button on the scene; the untapped step is reported as not run
    answer = () => ({ reply: "I can take the last step back.", actions: [{ name: "undo_step", args: {}, why: "" }] });
    await say("Undo that long take");
    const told2 = sent.messages.filter((m) => m.role === "assistant").pop().content;
    ok(/join_shots\(.*\) = NOT RUN \(the person has not tapped it\)/.test(told2) && /move_shot\(.*S02.*\) = DID NOT RUN:.*both carry lines/.test(told2) && /long_take\(.*\) = RAN: Shot S02 is now a long take/.test(told2), T("untapped, refused and run steps each go back to the model as what they were"));
    await btn("Take back the last step").click();
    ok(/✓.*Taken back: the Long take tick on shot S02/.test(await btn("Take back the last step").textContent()), T("undo_step says what it took back: " + await btn("Take back the last step").textContent()));
    p = await saved((q) => !q.shots[1].long_take && q.shots[4].join === "wipe"); ok(!p.shots[1].long_take && p.shots[4].join === "wipe", T("only the last step is taken back"));
    await page.click("#asUndo"); // the join setting
    p = await saved((q) => !q.shots[4].join); ok(!p.shots[4].join && p.shots.length === 5, T("the Undo button on the scene takes back the step before it"));
    await page.click("#asUndo"); await page.click("#asUndo"); await page.click("#asUndo"); // the move, the edit, the split
    await page.waitForFunction(() => document.querySelectorAll("#shots .shot").length === 4);
    p = await saved((q) => q.shots.length === 4);
    ok(p.shots.map((s) => s.shot_id).join() === "S01,S02,S03,S04" && p.shots[1].lines.join() === "L1,L2" && p.shots[1].duration === 4 && p.shots[1].action === LONG, T("taking every step back gives the scene as it was"));
    ok(await page.locator("#asUndo").isHidden(), T("and the Undo button goes when there is nothing left to take back"));

    // 4. joining, and the whole scene again asks first
    answer = () => ({ reply: "Joining the two, or I can plan the whole scene again: that rebuilds every shot and takes 10 to 20 minutes.", actions: [{ name: "join_shots", args: { shot: "S03" }, why: "" }, { name: "plan_again", args: { note: "slower" }, why: "" }, { name: "undo_step", args: {}, why: "" }] });
    await say("Join the last two shots");
    ok(await btn("Take back the last step").isDisabled() && /There is no step to take back/.test(await btn("Take back the last step").textContent()), T("undo_step is greyed when there is nothing to take back"));
    await btn("Join shot S03 with the shot after it").click();
    await page.waitForFunction(() => document.querySelectorAll("#shots .shot").length === 3);
    ok(/✓.*Shots S03 and S04 are now one shot, S03: 3\.5 s, 1 line\. 3 shots in the scene/.test(await btn("Join shot S03").textContent()), T("join_shots says what it did: " + await btn("Join shot S03").textContent()));
    p = await saved((q) => q.shots.length === 3); ok(p.shots[2].action === "Tobias sits. Then: A cup on the table." && p.shots[2].duration === 3.5, T("the joined shot keeps both actions and the whole time"));
    await btn("Plan the WHOLE scene again").click();
    await page.waitForFunction(() => /you cancelled/.test(document.getElementById("asLog").textContent));
    ok(asked.some((m) => /Plan the WHOLE scene again\?[\s\S]*All 3 shots[\s\S]*10 to 20 minutes[\s\S]*To change one shot, cancel/.test(m)), T("planning the whole scene again asks first, and says what it costs"));
    ok(blocks === 0 && /Not started: you cancelled\. Nothing changed/.test(await btn("Plan the WHOLE scene again").textContent()), T("cancelled: no Blocking pass was started, and the button says so"));
    await page.click("#asUndo"); await page.waitForFunction(() => document.querySelectorAll("#shots .shot").length === 4); await saved((q) => q.shots.length === 4); // as it was, for the next screen size
    ok(!errors.length, T("no script errors: " + errors.join(" | ")));
    await page.close();
  }
} finally { if (browser) await browser.close(); srv.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
done("the Assistant's shot steps on the anime screen");
