// The MCP server on a scratch app: reading direction, jobs and weights, layout by weight, the checks, a page as a picture.
// Same safety as server_reading.test.mjs (own port, scratch saved work, a do-nothing `codex`, OpenRouter at a dead port).
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import { createInterface } from "node:readline";
import { APP, scratch, ok, done } from "./helpers.mjs";
const PORT = 5393, tmp = scratch("mcp"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-mcp-test";
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
const hadProjects = fs.existsSync(path.join(PE, "projects")), dir = path.join(PE, "projects", ID);
fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(path.join(APP, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true });
fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({ name: "Zz MCP Test", chapter: 1 })); // an older project: no reading direction, so left to right
execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), dir]);
const env = { ...process.env, PATH: bin + ":" + process.env.PATH, STUDIO_SAVED: path.join(tmp, "saved"), STUDIO_ANIME: path.join(tmp, "anime"), STUDIO_LOOKS: path.join(tmp, "looks"), OPENROUTER_BASE: "http://127.0.0.1:9", IBASHO_URL: U };
const srv = spawn("node", [path.join(PE, "server.mjs"), String(PORT)], { stdio: "ignore", env });
let mcp;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(U + "/api/ping")).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  mcp = spawn("node", [path.join(PE, "mcp.mjs")], { stdio: ["pipe", "pipe", "inherit"], env });
  const waiting = new Map(); let n = 0;
  createInterface({ input: mcp.stdout }).on("line", (l) => { const m = JSON.parse(l); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
  const rpc = (method, params) => new Promise((res) => { const id = ++n; waiting.set(id, res); mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  const call = async (name, args) => { const r = (await rpc("tools/call", { name, arguments: args })).result; const t = r.content.find((c) => c.type === "text"); let v = t ? t.text : ""; try { v = JSON.parse(v); } catch { /* plain words */ } return { v, err: !!r.isError, content: r.content }; };
  const tools = (await rpc("tools/list", {})).result.tools;
  const def = (name) => tools.find((t) => t.name === name);
  ok(def("new_project").inputSchema.properties.reading && def("series_settings").inputSchema.properties.reading, "new_project and series_settings take a reading direction");
  ok(def("edit_panel").inputSchema.properties.job && def("edit_panel").inputSchema.properties.weight && !def("apply_template").inputSchema.required.includes("code"), "edit_panel takes job and weight; apply_template can pick by itself");
  ok(/READING DIRECTION/.test((await call("guide", {})).v) && /PANEL DIRECTOR/.test((await call("guide", {})).v), "the guide explains both");
  const list = (await call("list_projects", {})).v.find((p) => p.id === ID);
  ok(list && list.reads === "left to right", "list_projects says which way a chapter reads");
  let pg = (await call("get_page", { project: ID, page: 1 })).v;
  ok(/left to right/.test(pg.reads) && pg.panels_in_reading_order[0].job === "establish" && pg.panels_in_reading_order[0].weight === 4, "get_page gives the direction, and each panel's job and weight");
  const firstId = pg.panels_in_reading_order[0].id, x0 = pg.panels_in_reading_order[2].box[0];
  await call("letter_pages", { project: ID, pages: [1] });
  const before = (await call("get_page", { project: ID, page: 1 })).v;
  // turn the series
  const turned = (await call("series_settings", { project: ID, reading: "rtl" })).v;
  ok(turned.reads === "right to left" && turned.pages_turned === 4, "series_settings turns the whole chapter: " + JSON.stringify({ reads: turned.reads, pages: turned.pages_turned }));
  pg = (await call("get_page", { project: ID, page: 1 })).v;
  ok(pg.layout.rtl === true && pg.panels_in_reading_order[0].id === firstId, "the page is right to left and the reading order is the same");
  ok(pg.panels_in_reading_order[2].box[0] !== x0, "the panels of a shared tier changed sides");
  const moved = pg.balloons.every((b, i) => { const p0 = before.panels_in_reading_order.find((q) => q.id === b.panel), p1 = pg.panels_in_reading_order.find((q) => q.id === b.panel); return Math.abs((b.at[0] * 1000 - p1.box[0]) - (before.balloons[i].at[0] * 1000 - p0.box[0])) < 2; });
  ok(pg.balloons.length === before.balloons.length && moved, "every balloon kept its place inside its own panel");
  ok(JSON.parse(fs.readFileSync(path.join(tmp, "saved", ID + ".json"), "utf8")).pages.every((p) => p.layout.rtl === true), "the saved chapter is right to left");
  // letter it right to left: no reading-order flags
  const let2 = (await call("letter_pages", { project: ID })).v;
  ok(let2.lettered.length === 4, "letter_pages letters the chapter");
  const chk = (await call("check_pages", { project: ID })).v;
  ok(typeof chk === "string" || !JSON.stringify(chk).includes("reading order"), "no balloon is out of reading order: " + JSON.stringify(chk).slice(0, 200));
  // jobs and weights: make the small insert the heaviest panel, see the check, let the director fix the layout
  const insert = pg.panels_in_reading_order[2].id;
  ok(!(await call("edit_panel", { project: ID, panel: insert, job: "big", weight: 5 })).err, "edit_panel sets a job and a weight");
  const flagged = JSON.stringify((await call("check_pages", { project: ID, pages: [1] })).v);
  ok(/carries the most weight/.test(flagged), "the check sees the heaviest panel is not the biggest");
  const ap = (await call("apply_template", { project: ID, page: 1 })).v;
  ok(ap.picked_by_weight === true, "apply_template with no code picks by weight: " + JSON.stringify(ap).slice(0, 120));
  pg = (await call("get_page", { project: ID, page: 1 })).v;
  const areas = pg.panels_in_reading_order.map((q) => (q.box[2] - q.box[0]) * (q.box[3] - q.box[1]));
  ok(areas.indexOf(Math.max(...areas)) === 2 && pg.layout.rtl === true, "now that panel is the biggest, and the page still reads right to left");
  ok(pg.panels_in_reading_order.every((q, i) => q.action === before.panels_in_reading_order[i].action), "every panel kept its storyboard, in order");
  ok(!/carries the most weight/.test(JSON.stringify((await call("check_pages", { project: ID, pages: [1] })).v)), "and the flag is gone");
  // advice level
  await call("edit_panel", { project: ID, panel: pg.panels_in_reading_order[3].id, reveal: true });
  const adv = (await call("check_pages", { project: ID, pages: [1] })).v;
  ok(Object.values(adv.faults || {}).flat().some((f) => f.level === "advice" && /first thing seen after the turn/.test(f.msg)), "a reveal that is not first on its page comes back as advice");
  // split_page keeps the direction
  const sp = (await call("split_page", { project: ID, page: 4, after_panel: (await call("get_page", { project: ID, page: 4 })).v.panels_in_reading_order[1].id })).v;
  ok(sp.pages_now === 5 && (await call("get_page", { project: ID, page: 5 })).v.layout.rtl === true, "split_page keeps both halves right to left");
  // a picture of the page
  const view = await call("view_page", { project: ID, page: 1, width: 500 }), img = view.content.find((c) => c.type === "image");
  ok(!!img && Buffer.from(img.data, "base64").length > 5000, "view_page draws the page" + (view.err ? ": " + JSON.stringify(view.v).slice(0, 200) : ""));
  if (img && process.env.IBASHO_SHOTS) fs.writeFileSync(path.join(process.env.IBASHO_SHOTS, "mcp-view-page.png"), Buffer.from(img.data, "base64"));
} finally {
  if (mcp) mcp.kill(); srv.kill();
  fs.rmSync(dir, { recursive: true, force: true }); if (!hadProjects) fs.rmSync(path.join(PE, "projects"), { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}
done("MCP server: reading direction and the panel director");
