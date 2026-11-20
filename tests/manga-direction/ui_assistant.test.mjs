// The Assistant on the manga screen, in a real browser, with the model's answers played by the test (no model is called):
// page-level steps change only their page, at once; every button says what it really did; a step that cannot run says why;
// the next message carries those facts; a whole re-storyboard asks first. Same safety as the other screen tests.
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  the Assistant's page steps (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const PORT = 5397, tmp = scratch("uiassistant"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-assistant-test";
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
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
  const asked = []; page.on("dialog", (d) => { asked.push(d.message()); if (/WHOLE chapter/.test(d.message())) d.dismiss(); else d.accept(); });
  let boards = 0; page.on("request", (r) => { if (r.url().includes("/api/storyboard") && r.method() === "POST") boards++; });
  // the model: each answer is made by the test from what the screen sent
  let sent = null, answer = () => ({ reply: "", actions: [] });
  await page.route("**/api/assistant", async (route) => { sent = JSON.parse(route.request().postData()); await route.fulfill({ contentType: "application/json", body: JSON.stringify({ model: "Test", cost: 0, ...answer(sent) }) }); });
  await page.goto(U + "/"); await page.waitForSelector("#projSel option", { state: "attached" });
  await page.evaluate((id) => { localStorage.removeItem("ibasho-assistant"); document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
  await page.waitForFunction(() => document.getElementById("sbProj").textContent.includes("4 pages"));
  const say = async (text) => { const n = await page.$$eval(".as-m.assistant", (l) => l.length); await page.fill("#asText", text); await page.press("#asText", "Enter"); await page.waitForFunction((k) => document.querySelectorAll(".as-m.assistant").length > k && !/Thinking/.test(document.getElementById("asLog").textContent), n); };
  const btn = (label) => page.locator(".as-m.assistant").last().locator(".as-acts .btn", { hasText: label });
  const pagesNow = async () => +/(\d+) pages/.exec(await page.textContent("#sbProj"))[1];
  await page.click(".as-btn");

  // 1. "spread out page 1": one page changes, at once; a made-up panel is refused with the reason
  let P;
  answer = (b) => { P = b.where.pages; return { reply: "I can spread page 1 over two pages.", dropped: 1, actions: [{ name: "split_page", args: { page: 1, after: P[0].panels[1].id }, why: "two panels a page" }, { name: "edit_panel", args: { panel: "no-such-panel", action: "x" }, why: "" }] }; };
  await say("Page 1 is crowded: spread it out");
  ok(P.length === 4 && P[0].panels.length === 4 && P[0].panels[0].id && P[0].panels[0].action.length > 10 && Array.isArray(P[0].panels[0].lines), "the Assistant is shown every page and panel, with what each shows and says");
  const longest = Math.max(...P.flatMap((p) => p.panels.map((q) => q.action.length))), real = JSON.parse(fs.readFileSync(path.join(dir, "board.json"), "utf8")).pages.flatMap((p) => p.panels.map((q) => (q.action || "").length));
  ok(longest === Math.max(...real), `a panel's action is shown whole, not cut at 220 letters (longest ${longest})`);
  ok(sent.actions.some((a) => a.name === "split_page") && ["move_panel", "join_pages", "layout_page", "edit_panel", "open_page", "storyboard_again"].every((n) => sent.actions.some((a) => a.name === n)), "page-level steps are offered: " + sent.actions.map((a) => a.name).join(", "));
  ok(/LAST RESORT/.test(sent.actions.find((a) => a.name === "storyboard_again").desc), "the whole re-storyboard is offered as a last resort");
  ok(/1 step it proposed cannot be done from this screen/.test(await page.locator(".as-m.assistant").last().textContent()), "a step the model made up is reported, not hidden");
  ok(await btn("Change panel no-such-panel").isDisabled() && /Cannot run: There is no panel/.test(await btn("Change panel no-such-panel").textContent()), "a step naming a panel that is not there is greyed, with the reason");
  const before = P.map((p) => p.panels.map((q) => q.id));
  await btn("Spread page 1 over 2 pages").click();
  await page.waitForFunction(() => document.getElementById("sbProj").textContent.includes("5 pages"));
  ok(/✓.*Page 1 is now pages 1 and 2 \(2, 2 panels\)/.test(await btn("Spread page 1").textContent()), "the button says what the step did: " + await btn("Spread page 1").textContent());
  ok(/Undo takes it back/.test(await page.textContent("#status")) && !(await page.isDisabled("#undoBtn")), "the status line says it, and Undo is on");
  ok(boards === 0, "no storyboard run was started for a one-page change");
  if (process.env.IBASHO_SHOTS) fs.writeFileSync(path.join(process.env.IBASHO_SHOTS, "assistant-sent.json"), JSON.stringify(sent)); // what the screen sends, to try on a real model by hand
  if (process.env.IBASHO_SHOTS) await page.screenshot({ path: path.join(process.env.IBASHO_SHOTS, "assistant-split.png") }); // to look at it by eye

  // 2. the next message carries the facts; the other page steps
  answer = (b) => { P = b.where.pages; const last2 = P[1].panels[P[1].panels.length - 1].id; return { reply: "More steps.", actions: [
    { name: "move_panel", args: { panel: P[2].panels[0].id, to: "previous" }, why: "" }, { name: "move_panel", args: { panel: P[2].panels[1].id, to: "next" }, why: "not the last one" },
    { name: "edit_panel", args: { panel: P[0].panels[0].id, weight: 5, job: "big", action: "A wide view of the harbour at dusk, the last ferry at the pier." }, why: "" },
    { name: "layout_page", args: { page: 1 }, why: "" }, { name: "join_pages", args: { page: 4 }, why: "" }, { name: "storyboard_again", args: { note: "more pages" }, why: "" }, { name: "open_page", args: { page: 3 }, why: "" }] }; };
  await say("What happened, and what else can you do?");
  const facts = sent.messages[1].content;
  ok(/\[STEPS, written by the app: split_page\(.*\) = RAN: Page 1 is now pages 1 and 2/.test(facts) && /edit_panel\(.*\) = DID NOT RUN: Cannot run: There is no panel/.test(facts), "the next message tells the model what really ran and what did not: " + facts.slice(-260));
  ok(JSON.stringify(P.map((p) => p.panels.map((q) => q.id))) === JSON.stringify([before[0].slice(0, 2), before[0].slice(2), before[1], before[2], before[3]]), "only page 1 changed: its panels are on two pages, in order, and every other page is as it was");
  ok(P.every((p, i) => p.page === i + 1), "pages are numbered in order after the change");
  await btn(`Move panel ${P[2].panels[0].id} to the previous`).click();
  ok(/✓.*moved to page 2 \(3 panels there now, 2 left on page 3\)/.test(await btn(`Move panel ${P[2].panels[0].id}`).textContent()), "the first panel of a page moves to the end of the page before: " + await btn(`Move panel ${P[2].panels[0].id}`).textContent());
  await btn(`Move panel ${P[2].panels[1].id} to the next`).click();
  ok(/Only the last panel of a page can move to the next page/.test(await btn(`Move panel ${P[2].panels[1].id}`).textContent()) && !(await btn(`Move panel ${P[2].panels[1].id}`).isDisabled()), "a move that would put the story out of order is refused, with the reason, and nothing is marked done");
  await btn("Change panel " + P[0].panels[0].id).click();
  ok(/✓.*changed what it shows, its job, its weight\. Its lines are untouched/.test(await btn("Change panel " + P[0].panels[0].id).textContent()), "one panel's storyboard is changed, its lines kept: " + await btn("Change panel " + P[0].panels[0].id).textContent());
  await btn("Lay out page 1 again").click();
  ok(/✓.*(laid out again|already has the layout that fits best)/.test(await btn("Lay out page 1 again").textContent()), "a page is laid out again by weight: " + await btn("Lay out page 1 again").textContent());
  await btn("Join page 4").click();
  await page.waitForFunction(() => document.getElementById("sbProj").textContent.includes("4 pages"));
  ok(/✓.*Pages 4 and 5 are now one page, 4, with 6 panels/.test(await btn("Join page 4").textContent()), "two pages are joined: " + await btn("Join page 4").textContent());
  await btn("Storyboard the WHOLE chapter again").click(); await page.waitForTimeout(300);
  ok(asked.some((m) => /All 4 pages are rebuilt.*six minutes/s.test(m)) && boards === 0 && /Not started: you cancelled/.test(await btn("Storyboard the WHOLE").textContent()), "a whole re-storyboard asks first, says what is lost, and a No starts nothing");

  // 3. what the chapter holds now, and Undo
  answer = (b) => { P = b.where.pages; return { reply: "ok", actions: [] }; };
  await say("And now?");
  const all = before.flat(), now = P.flatMap((p) => p.panels.map((q) => q.id));
  ok(JSON.stringify(now) === JSON.stringify(all), "after every step, every panel is still there, once, in story order");
  ok(P[0].panels[0].weight === 5 && P[0].panels[0].job === "big" && /harbour at dusk/.test(P[0].panels[0].action), "the changed panel carries its new storyboard");
  ok(/storyboard_again\(.*\) = DID NOT RUN: Not started: you cancelled/.test(sent.messages[3].content) && /open_page\(.*\) = RAN/.test(sent.messages[3].content), "cancelled and auto-run steps are in the record too");
  await page.click(".as-panel [data-as=close]"); await page.click("#undoBtn");
  ok(await pagesNow() === 5, "Undo takes the last step back (the join): 5 pages again");
  const saved = await page.evaluate(async (id) => { await new Promise((r) => setTimeout(r, 2500)); const j = await (await fetch("/api/spec?p=" + id)).json(); return j.pages ? j.pages.length : -1; }, ID);
  ok(saved === 5, "the change is saved like any other edit (" + saved + " pages saved)");

  // 4. a lettered chapter: a page step keeps the balloons where the person had them, wherever they still sit cleanly
  const getSpec = async () => page.evaluate(async (id) => { await new Promise((r) => setTimeout(r, 2500)); return (await fetch("/api/spec?p=" + id)).json(); }, ID);
  const places = (sp) => page.evaluate((sp) => { const R = window.PageRender, out = {}; // each balloon's place inside its own panel
    for (const p of sp.pages) { if (!p.layout) continue; const G = new Map(R.allPanels(p.layout).map((c) => [c.panel.id, c.bbox]));
      for (const it of p.text || []) { const b = G.get(it.panel); if (!b) continue; (out[it.panel] = out[it.panel] || []).push({ hand: !!it.hand, text: it.text, rel: [(it.at[0] * R.W - b[0]) / (b[2] - b[0]), (it.at[1] * R.H - b[1]) / (b[3] - b[1])] }); } }
    return out; }, sp);
  await page.evaluate(() => document.getElementById("letterAllBtn").click()); // the button is on the Chapter screen
  let sp = await getSpec(); const lettered = sp.pages.reduce((n, q) => n + (q.text || []).length, 0);
  ok(lettered > 4, `the chapter is lettered (${lettered} balloons)`);
  for (const q of sp.pages) for (const it of q.text || []) it.hand = true; // every balloon is now "the person's": a balloon the Letterer makes afresh has no such mark
  const put = await page.evaluate(async ([id, body]) => (await fetch("/api/spec?p=" + id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status, [ID, sp]);
  ok(put === 200, "the marked chapter is saved (" + put + ")");
  const was4 = await places(sp);
  await page.reload(); await page.waitForSelector("#projSel option", { state: "attached" });
  await page.evaluate((id) => { document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
  await page.waitForFunction(() => document.getElementById("sbProj").textContent.includes("5 pages"));
  await page.click(".as-btn");
  answer = () => ({ reply: "Joining.", actions: [{ name: "join_pages", args: { page: 1 }, why: "" }] });
  await say("Join page 1 and 2");
  await btn("Join page 1").click();
  await page.waitForFunction(() => document.getElementById("sbProj").textContent.includes("4 pages"));
  const said = await btn("Join page 1").textContent(), m4 = /balloons kept (where you placed them|as placed in (\d+) panels?, (\d+) lettered again)/.exec(said);
  ok(!!m4, "the step says the balloons were kept: " + said);
  sp = await getSpec(); const now4 = await places(sp), onPage = new Set(Object.keys(now4).filter((id) => sp.pages[sp.pages.findIndex((q) => !q.cover)].text.some((it) => it.panel === id)));
  const keptIds = [...onPage].filter((id) => now4[id].every((x) => x.hand)), freshIds = [...onPage].filter((id) => now4[id].every((x) => !x.hand));
  ok(keptIds.length + freshIds.length === onPage.size, "a panel's balloons are all kept or all placed afresh, never mixed");
  ok(keptIds.length >= 1 && (!m4 || !m4[2] || +m4[2] === keptIds.length), `balloons were kept in ${keptIds.length} of ${onPage.size} lettered panels, as the step said`);
  ok(keptIds.every((id) => now4[id].length === was4[id].length && now4[id].every((x, k) => x.text === was4[id][k].text && Math.abs(x.rel[0] - was4[id][k].rel[0]) < 0.01 && Math.abs(x.rel[1] - was4[id][k].rel[1]) < 0.01)), "a kept balloon has its words and the same place inside its panel");
  const lines4 = Object.values(was4).flat().length, after4 = Object.values(now4).flat().length;
  ok(after4 >= lines4 - 1 && after4 <= lines4 + 3, `no line was lost or doubled (${lines4} balloons before, ${after4} after)`);
  ok(errors.length === 0, "no script errors: " + errors.join(" | "));
} finally {
  if (browser) await browser.close();
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
done("the Assistant's page steps");
