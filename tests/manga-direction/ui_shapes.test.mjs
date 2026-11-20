// Custom panel styles, part 4, in a real browser: ready-made shapes, corners moved by hand, and a new free-shape panel placed point by point.
// Same safety as the other screen tests.
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  free-shape panels (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const PORT = 5403, tmp = scratch("uishapes"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-shapes-test";
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
  let name = "Mara at the pier"; page.on("dialog", (d) => (d.type() === "prompt" ? d.accept(name) : d.accept()));
  const shot = async (n, sel) => { if (process.env.IBASHO_SHOTS) await (sel ? page.locator(sel) : page).screenshot({ path: path.join(process.env.IBASHO_SHOTS, n + ".png") }); };
  await page.goto(U + "/"); await page.waitForSelector("#projSel option", { state: "attached" });
  await page.evaluate((id) => { document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
  await page.waitForFunction((id) => localStorage.getItem("ld-project") === id && /pages/.test(document.getElementById("sbProj").textContent) && document.getElementById("status").textContent === "Saved", ID);
  const pts = (i) => page.evaluate((k) => { const p = document.querySelectorAll("#page polygon.phit")[k]; return p.getAttribute("points").trim().split(/\s+/).map((s) => s.split(",").map(Number)); }, i);
  const saved = async () => { await page.waitForFunction(() => document.getElementById("status").textContent !== "Saving…", null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1600); return (await (await fetch(`${U}/api/spec?p=${ID}`)).json()).pages[0].layout; };
  const svgPoint = (x, y) => page.evaluate(([px, py]) => { const s = document.getElementById("page"), r = s.getBoundingClientRect(), vb = s.viewBox.baseVal; return [r.left + (px - vb.x) / vb.width * r.width, r.top + (py - vb.y) / vb.height * r.height]; }, [x, y]);
  await page.click('#side [data-page="0"]'); await page.click('#modeTabs [data-mode="layout"]');
  await page.locator("#page polygon.phit").nth(0).click({ force: true });
  await page.waitForSelector("#pshapes [data-pshape]");
  ok(JSON.stringify(await page.$$eval("#pshapes .seg", (l) => l.map((b) => b.textContent))) === JSON.stringify(["Plain", "Slanted", "Jagged", "Burst", "Oval"]) && await page.getAttribute('#pshapes [data-pshape=""]', "aria-pressed") === "true", "a panel offers its shape: plain, and four ready-made ones");
  const plain = await pts(0);
  // a ready-made shape
  await page.click('#pshapes [data-pshape="jagged"]');
  let now = await page.evaluate(() => [...document.querySelectorAll("#page polygon.phit")].map((p) => p.getAttribute("points").trim().split(/\s+/).length));
  ok(now.includes(22) && now.filter((n) => n === 4).length === 3, "Jagged gives the panel a toothed edge; the other panels stay plain: " + now);
  await shot("shape-jagged", "#page");
  await page.click('#pshapes [data-pshape="oval"]');
  ok((await saved()).rows[0].panels[0].shape.length === 32, "Oval is saved with the page");
  await page.click('#pshapes [data-pshape=""]');
  ok(JSON.stringify(await pts(0)) === JSON.stringify(plain) && !(await saved()).rows[0].panels[0].shape, "Plain takes the shape off again");
  // corners by hand: drag one outside the panel's place, add one, remove one
  await page.click("#shapeEdit");
  ok(await page.locator("#page .vtx").count() === 4 && await page.locator("#page .vadd").count() === 4 && await page.isVisible("#shapeHint"), "Edit corners shows a dot on each corner and a + on each edge");
  const c2 = await page.locator('#page .vtx[data-k="2"]').boundingBox();
  await page.mouse.move(c2.x + c2.width / 2, c2.y + c2.height / 2); await page.mouse.down(); await page.mouse.move(c2.x + c2.width / 2 - 30, c2.y + c2.height / 2 + 45, { steps: 4 }); await page.mouse.up();
  let L = await saved(), sh = L.rows[0].panels[0].shape;
  ok(sh && sh.length === 4 && sh.some(([u, v]) => v > 1.03), "a corner dragged below the panel's place breaks the frame: " + JSON.stringify(sh));
  ok(await page.getAttribute("#pshapes .seg[disabled]", "aria-pressed") === "true" && /My own/.test(await page.textContent("#pshapes")), "the shape is now marked My own");
  const add = await page.locator('#page .vadd[data-k="0"]').boundingBox();
  await page.mouse.move(add.x + add.width / 2, add.y + add.height / 2); await page.mouse.down(); await page.mouse.move(add.x + add.width / 2, add.y + add.height / 2 + 40, { steps: 3 }); await page.mouse.up();
  sh = (await saved()).rows[0].panels[0].shape;
  ok(sh.length === 5 && sh[1][1] > 0.05, "a + on an edge adds a corner there and drags it: " + JSON.stringify(sh));
  ok(await page.isVisible("#shapeDel"), "the chosen corner can be removed");
  await page.click("#shapeDel");
  ok((await saved()).rows[0].panels[0].shape.length === 4 && !(await page.isVisible("#shapeDel")), "Remove this corner takes it out");
  await shot("shape-corners", "#page");
  await page.click("#shapeEdit");
  ok(await page.locator("#page .vtx").count() === 0, "Done with corners hides the dots");
  // save as mine: the shape goes with the layout
  await page.click("#tmplDetails summary"); await page.click("#tmplSave");
  await page.waitForFunction(() => /Saved as MY-01/.test(document.getElementById("status").textContent));
  const mine = JSON.parse(fs.readFileSync(path.join(tmp, "saved", "layouts.json"), "utf8")).layouts[0];
  ok(JSON.stringify(mine.rows).includes('"shape"'), "my saved layout keeps the hand-made shape");
  // a new free-shape panel, point by point
  await page.click("#freeBtn");
  ok(/Done \(0 corners\)/.test(await page.textContent("#freeBtn")) && await page.isVisible("#freeCancel"), "+ Free-shape panel starts placing corners");
  for (const [x, y] of [[560, 150], [900, 110], [940, 420], [700, 480], [600, 330]]) { const [mx, my] = await svgPoint(x, y); await page.mouse.click(mx, my); }
  ok(/Done \(5 corners\)/.test(await page.textContent("#freeBtn")) && await page.locator("#page .free-line").count() === 1, "each tap is a corner, with the outline shown");
  { const [mx, my] = await svgPoint(560, 150); await page.mouse.click(mx, my); } // the first corner again closes it
  await page.waitForFunction(() => /The panel is on the page/.test(document.getElementById("status").textContent));
  L = await saved(); const ins = (L.insets || [])[0];
  ok(ins && ins.shape.length === 5 && Math.abs(ins.box[0] - 0.56) < 0.01 && Math.abs(ins.box[3] - 0.32) < 0.01, "it becomes a panel of that shape, saved with the page: " + JSON.stringify(ins && [ins.box, ins.shape]));
  ok(await page.locator("#page .vtx").count() === 5 && await page.isVisible("#panelTools"), "it is chosen, with its corners ready to adjust");
  await shot("shape-free", "#page");
  // the plain inset handles still move and resize it, and the shape follows
  const before = JSON.stringify(ins.shape); await page.click("#shapeEdit");
  const mv = await page.locator('#page [data-part="imove"]').boundingBox();
  await page.mouse.move(mv.x + mv.width / 2, mv.y + mv.height / 2); await page.mouse.down(); await page.mouse.move(mv.x + mv.width / 2 - 60, mv.y + mv.height / 2 + 30, { steps: 4 }); await page.mouse.up();
  L = await saved();
  ok(L.insets[0].box[0] < ins.box[0] - 0.03 && JSON.stringify(L.insets[0].shape) === before, "moving it keeps its shape");
  // cancel leaves nothing behind
  await page.click("#freeBtn"); { const [mx, my] = await svgPoint(200, 900); await page.mouse.click(mx, my); } await page.click("#freeCancel");
  ok((await saved()).insets.length === 1 && /No panel added/.test(await page.textContent("#status")), "Cancel adds nothing");
  ok(errors.length === 0, "no script errors: " + errors.join(" | "));
} finally {
  if (browser) await browser.close();
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
done("free-shape panels");
