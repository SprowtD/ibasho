// Shared by the tests in this folder. Nothing here touches page-editor/saved or page-editor/projects: tests read the
// fixture in this folder (and a sample beside the app, when there is one) and write only to a scratch folder.
import { createRequire } from "node:module";
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { execFileSync } from "node:child_process";
export const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const require = createRequire(import.meta.url);
require(path.join(APP, "page-editor/render.js"));
export const R = globalThis.PageRender;
export const Paneler = require(path.join(APP, "core/paneler.js"));
export const Artist = require(path.join(APP, "core/artist.js"));
export const TEMPLATES = JSON.parse(fs.readFileSync(path.join(APP, "page-editor/templates.json"), "utf8"));
/** An older, hand-built storyboard beside the app (page-editor/samples/<id>/, with its series settings), when there is one: "" in a fresh copy. */
export const SAMPLE = (() => { const d = path.join(APP, "page-editor/samples"); try { return fs.readdirSync(d).sort().find((id) => fs.existsSync(path.join(d, id, "bible.json")) && fs.existsSync(path.join(d, id, "spec.json"))) || ""; } catch { return ""; } })();
export const hasSample = (id) => !!id && fs.existsSync(path.join(APP, "page-editor/samples", id, "spec.json"));
/** A storyboard to test on: the named sample when it is beside the app, else the fixture's storyboard, built in a scratch folder. */
export const sample = (id) => {
  if (hasSample(id)) return JSON.parse(fs.readFileSync(path.join(APP, "page-editor/samples", id, "spec.json"), "utf8"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ibasho-test-fixture-"));
  fs.cpSync(path.join(APP, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true });
  execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), dir], { stdio: "ignore" });
  const spec = JSON.parse(fs.readFileSync(path.join(dir, "spec.json"), "utf8")); fs.rmSync(dir, { recursive: true, force: true });
  return spec;
};
export const clone = (v) => JSON.parse(JSON.stringify(v));
/** A stand-in for the browser's text measuring: every letter is half its type size wide. Good enough for layout tests. */
export const measureText = (font, s) => { const m = /(\d+(?:\.\d+)?)px/.exec(font); return String(s).length * (m ? +m[1] : 30) * 0.5; };
export const scratch = (name) => fs.mkdtempSync(path.join(os.tmpdir(), "ibasho-test-" + name + "-"));
let failed = 0, passed = 0;
export function ok(cond, what) { if (cond) passed++; else { failed++; console.log("  FAIL: " + what); } }
export function near(a, b, what, eps = 0.01) { ok(Math.abs(a - b) <= eps, `${what} (${a} vs ${b})`); }
export function done(name) { console.log(`${failed ? "FAILED" : "ok"}  ${name}: ${passed} passed${failed ? ", " + failed + " failed" : ""}`); if (failed) process.exitCode = 1; }
/** The same page read the other way: the layout flag, and everything placed by hand mirrored with it. */
export function mirrored(page) {
  const p = clone(page); p.layout.rtl = !p.layout.rtl;
  const walk = (rows) => { for (const r of rows) for (const q of r.panels) { if (q.rows) walk(q.rows); else if (q.board) for (const w of q.board.who || []) { w.at = [1 - w.at[0], w.at[1]]; w.facing = { left: "right", right: "left" }[w.facing] || w.facing; } } };
  walk(p.layout.rows);
  return p;
}
