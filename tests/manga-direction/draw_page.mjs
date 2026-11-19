// Draw one page of a project to a PNG, with the real renderer, the real fonts and Chrome doing the drawing (as the app's export does).
// Usage: node tests/manga-direction/draw_page.mjs <project dir> <page number> <out.png> [--reading rtl|ltr] [--letter] [--board] [--width 1000]
//   --reading  turn the page to that direction first (balloons are placed afresh)
//   --letter   place the balloons afresh with the Letterer's automatic pass
//   --board    leave the pictures out: show the storyboard panels
// Reads only; writes the PNG and a scratch HTML file beside it.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import os from "node:os";
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const [dirArg, pageArg, outArg, ...rest] = process.argv.slice(2);
const opt = (k) => { const i = rest.indexOf("--" + k); return i < 0 ? null : rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[i + 1] : true; };
const dir = path.resolve(dirArg), out = path.resolve(outArg), width = +(opt("width") || 1000);
const spec = JSON.parse(fs.readFileSync(path.join(dir, "spec.json"), "utf8"));
const page = spec.pages.find((p) => p.number === +pageArg) || spec.pages[+pageArg - 1];
if (!page) { console.error("no such page"); process.exit(1); }
function chrome() {
  if (process.env.IBASHO_CHROME) return process.env.IBASHO_CHROME;
  const pw = path.join(os.homedir(), ".cache/ms-playwright");
  for (const d of fs.readdirSync(pw).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (fs.existsSync(path.join(pw, d, rel))) return path.join(pw, d, rel);
  throw new Error("no Chrome found: set IBASHO_CHROME");
}
const fonts = { "Playpen Sans": ["PlaypenSans.ttf", "100 800"], Bangers: ["Bangers.ttf", "400"], Vollkorn: ["Vollkorn.ttf", "400 900"], "Patrick Hand": ["PatrickHand.ttf", "400"], "Comic Neue": ["ComicNeue-Bold.ttf", "700"], Kalam: ["Kalam-Bold.ttf", "700"] };
const css = Object.entries(fonts).map(([fam, [f, w]]) => `@font-face{font-family:'${fam}';src:url(file://${path.join(APP, "page-editor/fonts", f)});font-weight:${w};}`).join("");
const h = Math.round(width * 1.5);
const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}svg{display:block}${css}</style><div id="o"></div>
<script>${fs.readFileSync(path.join(APP, "page-editor/render.js"), "utf8")}</script>
<script>
const spec = ${JSON.stringify(spec)}, page = spec.pages[${spec.pages.indexOf(page)}], opt = ${JSON.stringify({ reading: opt("reading"), letter: !!opt("letter"), board: !!opt("board") })};
const R = window.PageRender, cv = document.createElement("canvas").getContext("2d");
const mt = (font, s) => { cv.font = font; return cv.measureText(s).width; };
(async () => {
  await Promise.all(Object.values(R.FONTS).map((f) => document.fonts.load(f.b + " 30px " + f.family)));
  const lib = {}, sizes = {}; for (const it of spec.library || []) { lib[it.src] = it; sizes[it.src] = it.size; }
  if (opt.board) { const walk = (rows) => { for (const r of rows) for (const q of r.panels) { if (q.rows) walk(q.rows); else delete q.image; } }; walk(page.layout.rows); }
  let fresh = opt.letter || !(page.text || []).length;
  if (opt.reading) { const rtl = opt.reading === "rtl"; if (!!page.layout.rtl !== rtl) { if (rtl) page.layout.rtl = true; else delete page.layout.rtl; fresh = true; } }
  if (fresh) page.text = R.autoPlace(page, spec, lib, mt);
  const Ls = page.text.map((it) => R.measure(it, spec, mt));
  document.getElementById("o").innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + R.W + ' ' + R.H + '" width="${width}" height="${h}">' + R.layoutSvg(page, (s) => "file://${dir}/" + s, sizes) + R.letteringSvg(Ls) + R.pageNumberSvg(page) + "</svg>";
  document.title = JSON.stringify(R.check(page, Ls, R.protectBoxes(page, lib)).map((c) => c.level + ": " + c.msg));
})();
</script>`;
const f = out.replace(/\.png$/, ".html"); fs.writeFileSync(f, html);
execFileSync(chrome(), ["--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--force-device-scale-factor=1", `--window-size=${width},${h}`, "--virtual-time-budget=6000", `--screenshot=${out}`, "file://" + f], { stdio: "ignore", timeout: 90000 });
console.log(out);
