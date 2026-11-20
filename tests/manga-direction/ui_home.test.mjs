// Home: chapters of one series sit under the series' name, a long list can be searched, and a chapter can be put away and brought
// back. In a real browser, desktop and phone size, on a scratch COPY of the app (tests/harness.mjs): its own port, scratch saved
// work, a stand-in `codex`. Needs playwright-core (set IBASHO_PLAYWRIGHT) and a Chromium; skipped when there is none.
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { ok, done } from "./helpers.mjs";
import { copyApp, startApp, makeProject } from "../harness.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  Home: series, search, put away (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);

const copy = copyApp();
fs.rmSync(path.join(copy.app, "page-editor", "samples"), { recursive: true, force: true }); // only the chapters made here
const pages = [{ id: "p1", number: 1, text: [], layout: { rows: [{ h: 1, panels: [{ id: "a1", w: 1, board: { who: [], lines: [] } }] }] } }];
// three chapters of one series, made out of order, and seven chapters each of its own series
for (const n of [3, 1, 2]) makeProject(copy, "zz-tide-ch0" + n, { spec: { project: "Tide", chapter: n, pages }, meta: { name: "Tide", chapter: n } });
const SOLO = ["Amber", "Birch", "Cedar", "Dune", "Ember", "Fjord", "Grove"];
for (const s of SOLO) makeProject(copy, "zz-" + s.toLowerCase() + "-ch01", { spec: { project: s, chapter: 1, pages }, meta: { name: s } });
const app = await startApp(copy);
let browser;
try {
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  for (const [name, viewport] of [["desktop", { width: 1400, height: 1000 }], ["phone", { width: 390, height: 800 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("dialog", (d) => d.accept());
    await page.goto(app.base + "/"); await page.waitForSelector("#homeGrid .prow", { timeout: 8000 }).catch(async () => { console.log("  home did not list: " + errors.join(" | ") + " / " + await page.evaluate(() => document.getElementById("status").textContent + " / " + document.getElementById("homeView").hidden + " / " + document.getElementById("homeGrid").innerHTML.slice(0, 300))); });
    const T = (what) => `${name}: ${what}`;
    const seen = () => page.evaluate(() => [...document.querySelectorAll("#homeGrid .prow")].filter((r) => r.offsetParent).map((r) => r.querySelector(".pn b").textContent.trim()));
    // the series
    const group = await page.evaluate(() => { const g = document.querySelector("#homeGrid .pgroup"); return g && { n: document.querySelectorAll("#homeGrid .pgroup").length, head: g.querySelector(".pgh").textContent, rows: [...g.querySelectorAll(".prow .pn b")].map((b) => b.textContent.trim()) }; });
    ok(group && group.n === 1 && /^Tide/.test(group.head) && /3 chapters/.test(group.head), T("one series heading, for the series with three chapters: " + JSON.stringify(group)));
    ok(group && group.rows.join("|") === "Tide · Chapter 1|Tide · Chapter 2|Tide · Chapter 3", T("its chapters are in chapter order: " + (group && group.rows.join("|"))));
    ok((await seen()).length === 10, T("all ten chapters are listed"));
    ok(/worked on/.test(await page.textContent("#homeGrid .prow .pn small")), T("a chapter says when it was last worked on"));
    // search
    ok(await page.isVisible("#homeFind"), T("with ten chapters there is a search box"));
    await page.fill("#homeFind", "ced");
    ok((await seen()).join("|") === "Cedar · Chapter 1" && (await page.textContent("#homeFindN")) === "1 of 10", T("typing part of a name leaves that chapter: " + (await seen()).join("|") + " / " + await page.textContent("#homeFindN")));
    ok(!(await page.isVisible("#homeGrid .pgroup")), T("the series heading goes when none of its chapters match"));
    await page.fill("#homeFind", "tide");
    ok((await seen()).length === 3 && await page.isVisible("#homeGrid .pgh"), T("a series name finds every chapter of it"));
    await page.fill("#homeFind", "tide 2");
    ok((await seen()).join("|") === "Tide · Chapter 2", T("two words narrow it to one chapter"));
    await page.fill("#homeFind", "qqq");
    ok((await seen()).length === 0 && /Nothing by that name/.test(await page.textContent("#homeFindN")), T("no match says so"));
    await page.fill("#homeFind", "");
    ok((await seen()).length === 10, T("clearing the box brings every chapter back"));
    // put away, bring back
    ok(!(await page.isVisible("#homeAway")), T("nothing is put away at first, so there is no fold"));
    ok((await page.locator("#homeView button", { hasText: /delete/i }).count()) === 0, T("there is no delete button"));
    await page.click('#homeGrid [data-put][data-id="zz-dune-ch01"]');
    await page.waitForFunction(() => !document.getElementById("homeAway").hidden);
    ok(!(await seen()).includes("Dune · Chapter 1") && (await seen()).length === 9, T("the chapter left the list"));
    ok(/Put away \(1\)/.test(await page.textContent("#homeAwayN")), T("the fold counts it: " + await page.textContent("#homeAwayN")));
    ok(/Nothing was deleted/.test(await page.textContent("#status")), T("the status line says nothing was deleted"));
    ok(fs.existsSync(path.join(copy.app, "page-editor/projects/zz-dune-ch01/spec.json")), T("its files are still on the disk"));
    await page.reload(); await page.waitForSelector("#homeGrid .prow");
    ok(!(await seen()).includes("Dune · Chapter 1"), T("still put away after a reload"));
    await page.fill("#homeFind", "dune");
    ok(await page.evaluate(() => document.getElementById("homeAway").open) && await page.isVisible("#awayGrid .prow"), T("searching for it opens the fold and shows it"));
    await page.fill("#homeFind", "");
    await page.evaluate(() => { document.getElementById("homeAway").open = true; });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(sw <= 1, T("the page does not scroll sideways: " + sw));
    if (process.env.IBASHO_SHOTS) await page.screenshot({ path: path.join(process.env.IBASHO_SHOTS, `home-${name}.png`), fullPage: true });
    await page.click('#awayGrid [data-put][data-id="zz-dune-ch01"]');
    await page.waitForFunction(() => document.getElementById("homeAway").hidden);
    ok((await seen()).includes("Dune · Chapter 1") && (await seen()).length === 10, T("Bring back returns it to the list"));
    // opening a chapter still works from a grouped row
    await page.click('#homeGrid .pgroup [data-proj="zz-tide-ch02"]');
    await page.waitForFunction(() => document.getElementById("homeView").hidden, null, { timeout: 8000 }).catch(() => {});
    ok(await page.evaluate(() => document.getElementById("homeView").hidden), T("a chapter under a series heading opens"));
    ok(errors.length === 0, T("no script errors: " + errors.join(" | ")));
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  await app.stop();
}
done("Home: series, search, put away");
