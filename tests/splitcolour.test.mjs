// The older whole-page path (one drawn page cut into its panels): a colour series keeps its colours; a black-and-white one gets true grey.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process"; import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO } from "./harness.mjs";
const require = createRequire(import.meta.url);
require(join(REPO, "page-editor/render.js")); const R = globalThis.PageRender;
const DRAW = "import sys,json\nfrom PIL import Image, ImageDraw\nim=Image.new('RGB',(1024,1536),'white'); d=ImageDraw.Draw(im)\nfor b in json.loads(sys.argv[2]):\n    d.rectangle([b[0]+6,b[1]+6,b[2]-6,b[3]-6],fill=(200,60,40),outline=(0,0,0),width=6)\nim.save(sys.argv[1])";
const SAT = "import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert('RGB'); r,g,b=im.getpixel((im.width//2, im.height//2)); print(max(r,g,b)-min(r,g,b))";

for (const colour of [true, false]) test(`a whole drawn page cut into panels ${colour ? "keeps its colours in a colour series" : "is true grey in a black-and-white series"}`, () => {
  const dir = mkdtempSync(join(tmpdir(), "ibasho-test-split-")); cpSync(join(REPO, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true });
  try {
    const env = { ...process.env, STUDIO_SAVED: join(dir, "none") };
    execFileSync("node", [join(REPO, "tools/build_spec.mjs"), dir], { env });
    const bf = join(dir, "bible.json"), bible = JSON.parse(readFileSync(bf, "utf8")); if (colour) bible.colour = true; else delete bible.colour; writeFileSync(bf, JSON.stringify(bible));
    const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8")), k = 1024 / R.W, boxes = R.allPanels(spec.pages[0].layout).map((c) => c.bbox.map((v) => Math.round(v * k)));
    const page = join(dir, "page.png"); execFileSync("/usr/bin/python3", ["-c", DRAW, page, JSON.stringify(boxes)]);
    execFileSync("/usr/bin/python3", [join(REPO, "tools/artist_split.py"), dir, "1", page], { env, stdio: "pipe" });
    const built = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8")); assert.ok(R.allPanels(built.pages[0].layout).every((c) => /^art\//.test(c.panel.image || "")), "the project's own pages are rebuilt with the cut pictures on their panels");
    const cut = readdirSync(join(dir, "art")).filter((n) => /\.jpe?g$/.test(n)); assert.ok(cut.length >= boxes.length, "every panel was cut out: " + cut.join(", "));
    const sat = +execFileSync("/usr/bin/python3", ["-c", SAT, join(dir, "art", cut[0])]).toString().trim();
    if (colour) assert.ok(sat > 100, "the red is still red: " + sat); else assert.ok(sat < 8, "no colour is left: " + sat);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
