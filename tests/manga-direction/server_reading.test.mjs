// The server keeps and reports the reading direction where a project or a book is created.
// Runs its own server on another port, in THIS checkout only (page-editor/projects and page-editor/series here are
// scratch folders, not in git), with saved work, anime scenes and looks pointed at a temp folder, a stand-in `codex`
// that does nothing, and OpenRouter pointed at a dead port: nothing real is touched and nothing can be paid.
import { spawn } from "node:child_process"; import fs from "node:fs"; import path from "node:path";
import { APP, scratch, ok, done } from "./helpers.mjs";
const PORT = 5391, tmp = scratch("server"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
const made = { projects: [], series: [] }, PE = path.join(APP, "page-editor");
const hadProjects = fs.existsSync(path.join(PE, "projects")), hadSeries = fs.existsSync(path.join(PE, "series"));
const srv = spawn("node", [path.join(PE, "server.mjs"), String(PORT)], { stdio: "ignore",
  env: { ...process.env, PATH: bin + ":" + process.env.PATH, STUDIO_SAVED: path.join(tmp, "saved"), STUDIO_ANIME: path.join(tmp, "anime"), STUDIO_LOOKS: path.join(tmp, "looks"), OPENROUTER_BASE: "http://127.0.0.1:9" } });
const j = async (method, p, body) => { const r = await fetch(U + p, { method, body }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const read = (...f) => JSON.parse(fs.readFileSync(path.join(PE, ...f), "utf8"));
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(U + "/api/ping")).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  const script = "REN walks into the hall.\n\nREN\nIs anyone here?\n\nMIKI\nOnly me. Sit down.\n";
  const mk = async (extra) => { const r = await j("POST", "/api/projects", JSON.stringify({ name: "Zz Reading Test", chapter: 1, script, ...extra })); if (r.id) made.projects.push(r.id); return r.id; };
  const a = await mk({});
  ok(a && read("projects", a, "project.json").reading === "rtl", "a new project starts right to left");
  ok(read("projects", a, "spec.json").reading === "rtl" && read("projects", a, "spec.json").pages[0].layout.rtl === true, "its pages are built right to left");
  ok(read("projects", a, "bible.json").reading === "rtl", "the series settings remember it");
  ok((await j("GET", "/api/project?p=" + a)).reading === "rtl", "/api/project reports it");
  ok(((await j("GET", "/api/projects")).find((p) => p.id === a) || {}).reading === "rtl", "/api/projects reports it");
  const b = await mk({ reading: "ltr", name: "Zz Reading Test Comic" });
  ok(b && read("projects", b, "project.json").reading === "ltr" && !read("projects", b, "spec.json").pages[0].layout.rtl, "left to right is one choice away");
  ok(((await j("GET", "/api/projects")).find((p) => p.id === b) || {}).reading === "ltr", "and is reported");
  const c = await mk({ like: b, chapter: 2, name: "Zz Reading Test Comic", reading: "rtl" });
  ok(c && read("projects", c, "project.json").reading === "ltr" && read("projects", c, "spec.json").reading === "ltr", "a chapter that joins a series reads the way the series does, whatever the form sent");
  // a series from before reading direction (no field anywhere): its next chapter stays left to right
  const old = read("projects", b, "bible.json"); delete old.reading; fs.writeFileSync(path.join(PE, "projects", b, "bible.json"), JSON.stringify(old));
  const d = await mk({ like: b, chapter: 3, name: "Zz Reading Test Comic" });
  ok(d && read("projects", d, "project.json").reading === "ltr" && !read("projects", d, "spec.json").pages[0].layout.rtl, "an older series' new chapter stays left to right");
  // the series settings win when they are changed later
  const bib = read("projects", a, "bible.json"); bib.reading = "ltr";
  ok((await fetch(U + "/api/bible?p=" + a, { method: "PUT", body: JSON.stringify(bib) })).ok, "the direction saves through the series settings");
  const { execFileSync } = await import("node:child_process"); execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), path.join(PE, "projects", a)]);
  ok(read("projects", a, "spec.json").reading === "ltr", "and the next build follows the series settings");
  ok(/left to right \(comic\)/.test(fs.readFileSync(execFileSync("node", [path.join(APP, "tools/paneler_task.mjs"), path.join(PE, "projects", a)]).toString().trim(), "utf8")), "so does the Paneler's task");
  // books
  const text = Array.from({ length: 30 }, (_, i) => (i % 10 === 0 ? `Chapter ${i / 10 + 1}\n\n` : "") + `Paragraph ${i + 1}. “Hello there,” said Mara, and the ferry rocked against the pier while the gulls went round.`).join("\n\n");
  const mkBook = async (q) => { const r = await j("POST", `/api/series?name=${encodeURIComponent("Zz Reading Book")}&file=b.txt${q}`, text); if (r.id) made.series.push(r.id); return r.id; };
  const s1 = await mkBook("");
  ok(s1 && read("series", s1, "bible.json").reading === "rtl", "a new book starts right to left");
  ok(((await j("GET", "/api/series")).find((x) => x.id === s1) || {}).reading === "rtl", "/api/series reports it");
  const s2 = await mkBook("&reading=ltr");
  ok(s2 && read("series", s2, "bible.json").reading === "ltr", "or left to right when asked");
  const book = await j("GET", "/api/series?id=" + s1), ch = (book.chapters || []).find((x) => x.kind !== "front");
  if (ch) { const r = await j("POST", `/api/series/chapter?id=${s1}&ch=${ch.id}`); if (r.project) made.projects.push(r.project);
    ok(r.project && read("projects", r.project, "project.json").reading === "rtl" && read("projects", r.project, "spec.json").pages[0].layout.rtl === true, "a chapter started from the book reads the book's way"); }
  else ok(false, "the test book has a chapter");
} finally {
  srv.kill();
  for (const id of made.projects) fs.rmSync(path.join(PE, "projects", id), { recursive: true, force: true });
  for (const id of made.series) fs.rmSync(path.join(PE, "series", id), { recursive: true, force: true });
  if (!hadProjects) fs.rmSync(path.join(PE, "projects"), { recursive: true, force: true });
  if (!hadSeries) fs.rmSync(path.join(PE, "series"), { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}
done("reading direction: server, builder, Paneler task");
