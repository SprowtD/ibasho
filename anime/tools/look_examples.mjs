// The example picture of each template look (anime/ui/looks/<id>.jpg): the same scene drawn in every look, so they can be compared.
// node anime/tools/look_examples.mjs [id ...]   (Codex's image tool, about 3 minutes a picture; skips looks that already have one)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = join(dirname(fileURLToPath(import.meta.url)), ".."), OUT = join(HERE, "ui", "looks"), WORK = join(OUT, "work");
const SCENE = "A girl of about seventeen with a short brown bob, in a navy school blazer with a red ribbon tie, and a boy of the same age with messy black hair, in a grey hooded jacket, share one clear umbrella at a pedestrian crossing in light evening rain. She looks up at him, smiling; he looks ahead, a little shy. A tram passes behind them and shop lights reflect on the wet street. Medium two-shot from the front, eye level.";
const looks = JSON.parse(await readFile(join(HERE, "core", "looks.json"), "utf8")), only = process.argv.slice(2);
await mkdir(WORK, { recursive: true });
for (const l of looks) {
  if ((only.length && !only.includes(l.id)) || existsSync(join(OUT, l.id + ".jpg"))) continue;
  const pic = join(WORK, l.id + ".png"), task = join(WORK, l.id + "-TASK.md");
  const prompt = ["Use case: illustration-story. Create ONE frame from an animated film, landscape 1536x1024: a single finished still. One picture only: no borders, no insets, no black bars.", "NO TEXT: no letters, signs with writing, subtitles, logos, watermarks or signatures anywhere.", "THE LOOK. " + l.text, "THE SHOT. " + SCENE].join("\n\n");
  await writeFile(task, `# Codex task: example picture for the look "${l.name}"\n\nUse your built-in image generation tool at the highest quality it offers. Send the fenced prompt exactly as written, with no images attached. Save the picture to the Save as path, then stop. Write nothing else.\n\n**Save as:** \`${pic}\`\n\n**Size:** 1536 x 1024\n\n\`\`\`\n${prompt}\n\`\`\`\n`);
  if (!existsSync(pic)) await new Promise((ok) => { const c = spawn("codex", ["exec", "--skip-git-repo-check", "--sandbox", "workspace-write", "-C", WORK, `Read the task file ${task} and follow it exactly: one picture made with your built-in image generation tool, saved at the Save as path. Then stop.`], { stdio: "ignore" }); c.on("exit", ok); c.on("error", ok); });
  if (!existsSync(pic)) { console.log(l.id, "NOT drawn"); continue; }
  await new Promise((ok) => execFile("/usr/bin/python3", ["-c", "import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).convert('RGB').resize((720,480)).save(sys.argv[2],quality=84)", pic, join(OUT, l.id + ".jpg")], ok));
  console.log(l.id, existsSync(join(OUT, l.id + ".jpg")) ? "done" : "NOT converted");
}
