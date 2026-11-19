// Artist agent, step 1: for chosen storyboard pages, write layout guides + one Codex task file.
// Usage: node tools/artist_task.mjs <project dir> <page numbers...>   e.g. node tools/artist_task.mjs page-editor/projects/my-chapter 2 5 6
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
require(path.join(APP, "page-editor/render.js")); const R = globalThis.PageRender; const A = require(path.join(APP, "core/artist.js"));
const dir = path.resolve(process.argv[2]), nums = process.argv.slice(3).map(Number);
const spec = JSON.parse(fs.readFileSync(path.join(dir, "spec.json"), "utf8")), bible = JSON.parse(fs.readFileSync(path.join(dir, "bible.json"), "utf8"));
const art = path.join(dir, "art"); fs.mkdirSync(path.join(art, "guides"), { recursive: true });
const mt = (font, s) => s.length * +font.match(/(\d+(\.\d+)?)px/)[1] * 0.52; // rough measure: briefs only need where balloons go
let md = `# Codex task: ${spec.project} chapter ${spec.chapter}, storyboard pages ${nums.join(", ")} (Artist agent, ${new Date().toISOString().slice(0, 10)})\n\n` +
  `Use your built-in image generation tool at the highest quality it offers. The local \`python\` command does not exist; use \`python3\`.\n\n## Rules\n\n` +
  `- Use each fenced prompt **exactly as written**, with the images listed under **Attach** in that order.\n- Never overwrite a file. If the service blocks a prompt, do not rephrase it; record the block and move on.\n` +
  `- Pages are portrait 1024 x 1536, saved to the **Save as** path given for each page.\n` +
  `- After each page, look at it and REPORT what you see (do not reject): any colour, any writing, any speech balloon, the number and arrangement of panels against the guide, anyone's look or clothes that do not match their description, objects the series settings describe exactly, a polished digital look.\n` +
  `- Write \`${art}/REPORT_TAKES.md\` (new file name if it exists: add -2, -3): one row per image with the path and what you saw. Then STOP. No lettering, no compositing, write nothing outside \`${art}\`.\n`;
const saves = [];
for (const n of nums) {
  const page = spec.pages.find((p) => p.number === n); if (!page) throw new Error("no page " + n);
  const G = R.layoutGeom(page.layout), polys = G.cells.map((c) => c.poly.map(([x, y]) => [x * 1.024, y * 1.024]));
  const guide = path.join(art, "guides", `p${String(n).padStart(2, "0")}-guide.png`);
  execFileSync("/usr/bin/python3", ["-c", `
import json,sys
from PIL import Image, ImageDraw, ImageFont
polys=json.loads(sys.argv[1]); im=Image.new("RGB",(1024,1536),"white"); d=ImageDraw.Draw(im)
f=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",44)
for i,p in enumerate(polys,1):
    d.polygon([tuple(q) for q in p], outline="black", width=4)
    cx=sum(q[0] for q in p)/len(p); cy=sum(q[1] for q in p)/len(p)
    d.ellipse((cx-30,cy-30,cx+30,cy+30),outline=(220,30,30),width=4); d.text((cx,cy),str(i),fill=(220,30,30),font=f,anchor="mm")
im.save(sys.argv[2])`, JSON.stringify(polys), guide]);
  const b = A.brief(page, spec, bible, R, mt);
  const attach = b.attach.map((a, i) => `Image ${i + 1}: \`${a.path === "(layout guide)" ? guide : path.join(bible.ref_root, a.path)}\``).join("; ");
  const nn = String(n).padStart(2, "0"); let take = 1;
  while (fs.existsSync(path.join(art, `p${nn}-take${String(take).padStart(2, "0")}.png`))) take++;
  const save = path.join(art, `p${nn}-take${String(take).padStart(2, "0")}.png`); saves.push(path.basename(save, ".png"));
  md += `\n---\n\n## Page ${n}\n\n**Save as:** \`${save}\`\n\n**Attach:** ${attach}\n\n\`\`\`\n${b.prompt}\n\`\`\`\n`;
}
const task = path.join(art, `CODEX_TASK_${saves.join("_")}.md`);
fs.writeFileSync(task, md); console.log(task);
