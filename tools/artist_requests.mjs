// Artist agent, the editor's queue: panels where someone pressed "Generate" -> one Codex task (one picture per panel).
// Usage: node tools/artist_requests.mjs <project dir> <saved spec json>
//   saved spec = page-editor/saved/<project>.json (local editor), or the artifact's saved copy
//   (ArtifactData get, collection "specs", doc "<project>", its "spec" field written to a file).
// The prompt is sent exactly as the person saw or wrote it. Then: check each picture, add faces to art/faces.json,
// and run tools/artist_panel.py <project dir> <panel id> <image> for each.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
import { inside } from "../page-editor/paths.mjs";
import { DATA_RULE } from "../page-editor/codex.mjs"; // prompts go to Codex as data files // a saved spec or bible names files inside the project, never anywhere on the disk
const StandIns = createRequire(import.meta.url)("../core/stand_ins.js"); // series switch: real names left out of picture prompts
// Optional 3rd argument: a folder of uploaded references, one <id>.json each with a "dataUrl" field
//   (local editor: page-editor/saved/refs; published test: ArtifactData list, collection "refs", with out_dir -> <out_dir>/refs).
// Flags (used by the editor's own job runner): --only <panel id> = just that panel; --auto = unattended run: Codex also
//   writes <picture>.faces.json (who is where), because nobody checks the picture before it lands.
const flags = {}, pos = [];
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a === "--only") flags.only = process.argv[++i]; else if (a === "--auto") flags.auto = true; else pos.push(a); }
process.argv.splice(2, process.argv.length, ...pos);
const dir = path.resolve(process.argv[2]), saved = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const bible = JSON.parse(fs.readFileSync(path.join(dir, "bible.json"), "utf8"));
const out = path.join(dir, "art", "panels"); fs.mkdirSync(out, { recursive: true });
const SERIES = process.env.STUDIO_SERIES || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "page-editor", "series"); // a book chapter's bank/ is a link into its book
const upDir = process.argv[4] ? path.resolve(process.argv[4]) : null;
const refOut = path.join(out, "refs"); fs.mkdirSync(refOut, { recursive: true });
/** One reference -> a picture file on disk (character bank sheet, a crop of a drawn panel, or an upload). */
function refFile(r, tag) {
  if (r.type === "bank") { const all = (r.kind === "place" ? bible.places : r.kind === "prop" ? bible.props : bible.cast) || {}, c = Object.hasOwn(all, r.name) ? all[r.name] : null; if (!c || !(c.ref || c.sheet)) throw new Error("no character sheet for " + r.name);
    const f = c.sheet ? inside(dir, c.sheet, [SERIES]) : bible.ref_root ? inside(bible.ref_root, c.ref) : ""; if (!f) throw new Error("the sheet of " + r.name + " is not in the project"); return f; }
  if (r.type === "panel") {
    const src = inside(dir, r.src), f = path.join(refOut, `${tag}.png`); if (!src) throw new Error("that reference picture is not in the project");
    execFileSync("/usr/bin/python3", ["-c", `
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB"); b = json.loads(sys.argv[2])
if b: im = im.crop((round(b[0]*im.width), round(b[1]*im.height), round(b[2]*im.width), round(b[3]*im.height)))
k = 1024 / max(im.size)
if k > 1: im = im.resize((round(im.width*k), round(im.height*k)), Image.LANCZOS)  # a small face crop is enlarged so the model can read it
im.save(sys.argv[3])`, src, JSON.stringify(r.box || null), f]);
    return f;
  }
  if (r.type === "upload") {
    if (!upDir) throw new Error("uploaded reference " + r.id + " needs the uploads folder (3rd argument)");
    const d = JSON.parse(fs.readFileSync(path.join(upDir, String(r.id).replace(/[^\w-]/g, "_") + ".json"), "utf8")), url = d.dataUrl || (d.data && d.data.dataUrl);
    const f = path.join(refOut, `${tag}.jpg`); fs.writeFileSync(f, Buffer.from(url.split(",")[1], "base64")); return f;
  }
  throw new Error("unknown reference type " + r.type);
}
const jobs = [];
const walk = (rows, pg) => { for (const r of rows) for (const q of r.panels) { if (q.rows) walk(q.rows, pg); else if (q.request && q.request.status === "queued") jobs.push({ pg, q }); } };
for (const pg of saved.pages || []) if (pg.layout) { walk(pg.layout.rows, pg); for (const q of pg.layout.insets || []) if (q.request && q.request.status === "queued") jobs.push({ pg, q }); }
if (flags.only) jobs.splice(0, jobs.length, ...jobs.filter((j) => j.q.id === flags.only));
if (!jobs.length) { console.log("no queued panels"); process.exit(0); }
const DRAWS = new Set(["codex", "openrouter"]); // sources the studio can draw with today (openrouter: the server sends the picture itself, see page-editor/openrouter.mjs)
const other = jobs.filter((j) => !DRAWS.has(j.q.request.source));
if (other.length) console.log(`skipping ${other.length} request(s) for sources that are not connected: ${[...new Set(other.map((j) => j.q.request.source))].join(", ")}`);
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + (flags.only ? "-" + flags.only : "");
let md = `# Codex task: ${saved.project || ""} panels requested in the editor (Artist agent, ${new Date().toISOString().slice(0, 10)})\n\n` +
  `Use your built-in image generation tool at the highest quality it offers. The local \`python\` command does not exist; use \`python3\`.\n\n${DATA_RULE}\n\n## Rules\n\n` +
  `- Each picture's prompt is the whole text of its **Prompt** DATA file: use it **exactly as written**, at the **Size** given, with the images listed under **Attach** in that order (none listed = no images).\n` +
  `- Never overwrite a file. If the service blocks a picture (moderation_blocked), send the SAME prompt again unchanged, up to 3 tries in all (these blocks are often random); never rephrase it. Record every block in the report; after 3 blocks move on.\n- Save each picture to its **Save as** path.\n` +
  `- After each picture, look at it and REPORT what you see (do not reject): any colour, any writing, any speech balloon, any panel border or second picture, who is in it, and anything the series settings describe exactly that came out differently.\n` +
  (flags.auto ? `- Beside each picture also write \`<Save as path>.faces.json\`: a JSON list with one entry per clearly visible face of a NAMED cast member from the prompt, \`{"who": "<name exactly as in the prompt's cast list, in Title Case; where a **Who is who** line is given, the real name from it>", "box": [left, top, right, bottom]}\` in pixels of the saved picture (the face only, hairline to chin). Use \`[]\` if there are none. Unnamed background people are left out.\n` : "") +
  (flags.auto ? `- Then check your own picture against its prompt, honestly, and write \`<Save as path>.review.json\`: a JSON list of short plain sentences, one per real problem a reader would notice. Check: any writing, letters or numbers that the prompt did not ask for; a speech balloon or caption box; a panel border, a split picture or a second picture; a named character missing, or drawn twice; an extra person the prompt did not ask for; a character who does not match their attached reference (hair, face, clothes); hands with the wrong number of fingers or a badly broken face; ${bible.colour ? "" : "any colour in a black-and-white series; "}the action shown is not the action asked for. Write \`[]\` when the picture is fine: do not list matters of taste.\n` : "") +
  `- Write \`${out}/REPORT_${stamp}.md\`: one row per image with the path and what you saw. Then STOP. No lettering, no compositing, write nothing outside \`${out}\`.\n`;
const list = [];
for (const { pg, q } of jobs.filter((j) => DRAWS.has(j.q.request.source))) {
  if (!/^[\w-]{1,80}$/.test(String(q.id))) { console.log("skipping a panel with a bad id"); continue; }
  let take = 1; const name = (t) => `${q.id}-take${String(t).padStart(2, "0")}`;
  while (fs.existsSync(path.join(out, name(take) + ".png"))) take++;
  const save = path.join(out, name(take) + ".png"), r = q.request, sent = StandIns.apply(r.prompt, bible); // what the image service sees
  const refs = r.refList || (r.refs || []).filter((n) => bible.cast[n] && (bible.cast[n].ref || bible.cast[n].sheet)).map((n) => ({ type: "bank", name: n }));
  const files = refs.map((x, i) => refFile(x, `${name(take)}-ref${i + 1}`)), attach = files.map((f, i) => `Image ${i + 1}: \`${f}\``).join("; ");
  const said = save.replace(/\.png$/, ".prompt.txt"); fs.writeFileSync(said, sent); // the prompt is the person's words (or the Artist's from the storyboard): a data file, never the task itself
  md += `\n---\n\n## ${pg.label || "Page " + pg.number}, panel ${q.id}\n\n**Save as:** \`${save}\`\n\n**Size:** ${(r.size || [1024, 1024]).join(" x ")}\n\n**Attach:** ${attach || "none"}\n\n**Prompt:** the DATA file \`${said}\`\n\n${sent !== r.prompt ? `**Who is who** (for faces.json and your report only; never put these names in the prompt): ${StandIns.parse(bible.stand_ins).filter(([n]) => Object.hasOwn(bible.cast, n) && r.prompt.includes(n)).map(([n, s]) => `${s} = ${n}`).join("; ") || "none"}\n\n` : ""}`;
  list.push({ panel: q.id, page: pg.number, save, mode: r.mode, source: r.source, model: r.model || "", quality: r.quality || "", prompt: sent, size: r.size || [1024, 1024], refs: files, who: ((q.board && q.board.who) || []).map((w) => ({ name: w.name, at: w.at, size: w.size, facing: w.facing })),
    // speakers the storyboard kept out of frame: the picture may show them anyway, and then their balloon needs a tail
    voices: [...new Set(((q.board && q.board.lines) || []).map((l) => l.speaker).filter((n) => n && !((q.board.who || []).some((w) => w.name === n))))] });
}
const task = path.join(out, `CODEX_TASK_${stamp}.md`);
fs.writeFileSync(task, md); console.log(task); console.log(JSON.stringify(list));
