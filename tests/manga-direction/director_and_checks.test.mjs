// The panel director (jobs, weights, layout by weight), the manga flow checks and the story / page-turn advice.
// Everything here is counted by code on storyboards: no model is called.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { createRequire } from "node:module";
import { APP, R, Paneler, Artist, sample, hasSample, SAMPLE, TEMPLATES, clone, measureText, scratch, ok, near, done } from "./helpers.mjs";
const D = createRequire(import.meta.url)(path.join(APP, "core/director.js"));
const T = TEMPLATES;
const P = (ws, extra = {}) => ws.map((w, i) => ({ id: "p" + i, board: Object.assign({ weight: w, shot: "medium", who: [], lines: [] }, extra[i] || {}) }));
const flags = (spec, re) => Object.values(Paneler.check(spec, R).pages).flat().filter((f) => re.test(f.msg));
const specOf = (pages, more = {}) => Object.assign({ chapter: 2, kind: "storyboard", script: [], pages: pages.map((rows, i) => ({ id: "pg" + (i + 1), number: i + 1, note: "beat", layout: Array.isArray(rows) ? { rows } : rows, text: [] })) }, more);
const pn = (b, w = 1) => ({ w, id: "x" + Math.random().toString(36).slice(2, 7), board: Object.assign({ shot: "medium", angle: "eye level", who: [], lines: [], bg: "white" }, b) });
const who = (name, x, size = "medium") => ({ name, at: [x, 0.4], size, facing: "camera" });
const line = (speaker, text, kind = "speech", id) => ({ source_id: id || "L" + Math.random().toString(36).slice(2, 7), speaker, kind, text });

// ---- the director
{
  ok(D.weightOf({ job: "big" }) === 5 && D.weightOf({ job: "insert" }) === 1 && D.weightOf({}) === 3 && D.weightOf({ splash: true }) === 5 && D.weightOf({ job: "talk", weight: 4 }) === 4, "a panel's weight is given, or the usual one for its job");
  let even = 0, aligned = 0; for (const t of T) { const r = D.rate(t.rows, R); if (r.even) even++; if (r.aligned) aligned++; }
  ok(even >= 5 && aligned >= 10, `the 160 templates are rated: ${even} even grids and ${aligned} with lined-up gutters are marked`);
  ok(D.rate([{ h: 1, panels: [{ w: 1 }, { w: 1 }] }, { h: 1, panels: [{ w: 1 }, { w: 1 }] }], R).even, "2 by 2 is an even grid");
  ok(D.rate([{ h: 1, panels: [{ w: 1 }, { w: 2 }] }, { h: 1, panels: [{ w: 1 }, { w: 2 }] }], R).aligned === 1, "upright gutters that line up are counted");
  ok(!D.rate([{ h: 1, panels: [{ w: 1 }, { w: 2 }] }, { h: 1, panels: [{ w: 2 }, { w: 1 }] }], R).aligned, "and shifted ones are not");
  for (const ws of [[4, 2, 2, 5, 1], [2, 2, 5, 2, 2], [5, 1, 1, 1], [3, 2, 2, 3, 2], [2, 2, 2, 2, 5, 2], [5, 2], [2, 4, 2]]) {
    const got = D.layout(P(ws), T, R), rt = D.rate(got.rows, R), top = ws.indexOf(Math.max(...ws));
    ok(D.leaves(got.rows).map((q) => q.id).join() === ws.map((_, i) => "p" + i).join(), `${ws}: panels stay in reading order`);
    ok(rt.largest === top, `${ws}: the heaviest panel is the biggest (${rt.shares.map((x) => Math.round(x * 100))})`);
    ok(!rt.even && !rt.aligned, `${ws}: no even grid, no lined-up gutters (${got.code})`);
  }
  const a = D.layout(P([2, 2, 5, 2, 2]), T, R), b = D.layout(P([2, 2, 5, 2, 2]), T, R, { avoid: [D.shape(a.rows)] });
  ok(D.shape(a.rows) !== D.shape(b.rows), "the same weights on the next page get another layout");
  ok(D.layout(P([3, 3, 3, 3, 3, 3, 3]), T, R).code === "tiers", "a panel count no template has falls back to plain tiers");
  const same = D.sorted(P([3, 3, 3]), T, R)[0]; ok(JSON.stringify(same.rows) === JSON.stringify(same.template.rows), "with no weights a template keeps its own sizes");
}
// ---- the builder lays out a flat list of panels, right to left, with no flags
{
  const dir = scratch("ferry"); fs.cpSync(path.join(APP, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true });
  const out = JSON.parse(execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), dir]).toString().trim().split("\n").pop());
  const spec = JSON.parse(fs.readFileSync(path.join(dir, "spec.json"), "utf8")), res = Paneler.check(spec, R);
  ok(out.directed.length === 4 && !out.faults.length, "four pages laid out by the director, no faults");
  ok(spec.pages.every((p) => p.layout.rtl === true), "the pages read right to left");
  const all = Object.values(res.pages).flat();
  ok(all.length === 0 && !res.chapter.length, "a board that follows the rules passes every check: " + all.map((f) => f.msg.slice(0, 60)).join(" | "));
  const shapes = spec.pages.map((p) => D.shape(p.layout.rows)); ok(shapes.every((s, i) => !i || s !== shapes[i - 1]), "no two pages in a row share a layout");
  const b = spec.pages[2].layout.rows[0].panels[0].board; ok(b.job === "big" && b.weight === 5 && b.reveal && b.splash, "job, weight, reveal and splash reach the spec");
  const bible = JSON.parse(fs.readFileSync(path.join(dir, "bible.json"), "utf8")), pg = spec.pages[0], cells = R.allPanels(pg.layout);
  const talk = Artist.panelBrief(pg, cells[1].panel.id, spec, bible, R, measureText).prompt, est = Artist.panelBrief(pg, cells[0].panel.id, spec, bible, R, measureText).prompt;
  ok(/a connecting panel\. Draw ONLY the speaker/.test(talk) && /EXPRESSION: calm/.test(talk) && /RIGHT TO LEFT/.test(talk), "the Artist is told: connecting panel, calm face, right to left");
  ok(/sets the place/.test(est) && !/connecting panel/.test(est), "and the establishing panel is the one drawn fully");
  const shout = Artist.panelBrief(spec.pages[3], R.allPanels(spec.pages[3].layout)[3].panel.id, spec, bible, R, measureText).prompt;
  ok(/the ONE big expression of the page/.test(shout), "the page's one big expression is said to the Artist");
  // an old storyboard (no jobs): the Artist's words are what they were
  if (hasSample(SAMPLE)) { const old = sample(SAMPLE), ob = JSON.parse(fs.readFileSync(path.join(APP, "page-editor/samples", SAMPLE, "bible.json"), "utf8"));
  const op = Artist.panelBrief(old.pages[1], R.allPanels(old.pages[1].layout)[0].panel.id, old, ob, R, measureText).prompt;
  ok(!/DENSITY|EXPRESSION|READING DIRECTION/.test(op), "a chapter made before this gets none of the new wording"); }
  fs.rmSync(dir, { recursive: true, force: true });
}
// ---- page build checks
{
  const grid = specOf([[{ h: 1, panels: [pn({}), pn({})] }, { h: 1, panels: [pn({}), pn({})] }]]);
  ok(flags(grid, /An even grid/).length === 1, "an even grid is flagged");
  const lined = specOf([[{ h: 1, panels: [pn({}, 1), pn({}, 2)] }, { h: 2, panels: [pn({}, 1), pn({}, 2)] }]]);
  ok(flags(lined, /Upright gutters line up/).length === 1, "lined-up upright gutters are flagged");
  const cams = specOf([[{ h: 2, panels: [pn({ who: [who("A", 0.5)] })] }, { h: 1, panels: [pn({ who: [who("B", 0.5)] }, 1), pn({ who: [who("A", 0.5)], shot: "close" }, 2)] }]]);
  ok(flags(cams, /same camera distance and angle/).length === 1 && /Panels 1 and 2/.test(flags(cams, /same camera/)[0].msg), "neighbours with the same camera distance and angle are flagged");
  cams.pages[0].layout.rows[1].panels[0].board.angle = "low angle";
  ok(flags(cams, /same camera/).length === 0, "and not once the angle changes");
  const flat = [{ h: 1, panels: [pn({}, 1)] }, { h: 1.1, panels: [pn({}, 1)] }, { h: 1, panels: [pn({}, 1)] }];
  const noBig = specOf([clone(flat), clone(flat).reverse(), [{ h: 3, panels: [pn({})] }, { h: 1, panels: [pn({})] }]]);
  ok(flags(noBig, /No big panel on this page or the one before/).length === 1, "two pages running with no big panel are flagged, once");
  const heavy = specOf([[{ h: 3, panels: [pn({ job: "talk", weight: 2, who: [who("A", 0.5)] })] }, { h: 1, panels: [pn({ job: "big", weight: 5, who: [who("A", 0.5)], shot: "close" })] }]]);
  ok(flags(heavy, /carries the most weight/).length === 1, "the heaviest panel not being the biggest is flagged");
  const two = specOf([[{ h: 2, panels: [pn({ job: "big" })] }, { h: 1, panels: [pn({ job: "big" })] }]]);
  ok(flags(two, /marked as the big moment/).length === 1, "two big moments on one page are flagged");
}
// ---- manga flow
{
  const mk = (mid) => specOf([[{ h: 2, panels: [pn({ shot: "wide", bg: "full", who: [who("Mara", 0.7, "wide"), who("Joss", 0.3, "wide")] })] },
    { h: 1, panels: [pn(mid, 1), pn({ shot: "close", who: [who("Mara", 0.3), who("Joss", 0.7)] }, 2)] }]]);
  ok(flags(mk({ shot: "insert" }), /swapped sides/).length === 1, "people who swap sides within a scene are flagged");
  ok(flags(mk({ shot: "wide", bg: "full" }), /swapped sides/).length === 0, "a wide panel in between lets them move");
  const scenes = mk({ shot: "insert" }); scenes.script = [{ type: "scene", id: "S1" }, { type: "line", source_id: "a" }, { type: "scene", id: "S2" }, { type: "line", source_id: "b" }];
  scenes.pages[0].layout.rows[0].panels[0].board.lines = [line("Mara", "Hello.", "speech", "a")]; scenes.pages[0].layout.rows[1].panels[1].board.lines = [line("Mara", "Later.", "speech", "b")];
  ok(flags(scenes, /swapped sides/).length === 0, "and so does a new scene");
  const first = (rtl, x) => { const s = specOf([[{ h: 1, panels: [pn({ shot: "two-shot", who: [who("Mara", x), who("Joss", 1 - x)], lines: [line("Mara", "You said nine."), line("Joss", "About nine.")] })] }]]); if (rtl) s.pages[0].layout.rtl = true; return flags(s, /speaks first but stands/); };
  ok(first(true, 0.7).length === 0 && first(true, 0.3).length === 1, "right to left: the first speaker belongs on the right");
  ok(first(false, 0.3).length === 0 && first(false, 0.7).length === 1 && first(false, 0.7)[0].advice === true, "left to right: on the left (and it is only advice)");
  const loud = specOf([[{ h: 2, panels: [pn({ who: [who("A", 0.5)], face: "big" })] }, { h: 1, panels: [pn({ who: [who("B", 0.5)], shot: "close", lines: [line("B", "No!", "shout")] }), pn({ who: [who("A", 0.5)], angle: "low angle" })] }]]);
  ok(flags(loud, /shout or a big expression/).length === 1, "a page where most panels have a big expression is flagged");
  loud.pages[0].layout.rows[0].panels[0].board.face = undefined;
  ok(flags(loud, /shout or a big expression/).length === 0, "one big expression on a page is fine");
  const bg = specOf([[{ h: 2, panels: [pn({ job: "establish", bg: "simple" })] }, { h: 1, panels: [pn({ job: "react", bg: "full" }), pn({ job: "talk", bg: "simple" }), pn({ job: "insert", bg: "simple" })] }]]);
  ok(flags(bg, /connecting panel/).length === 2 && flags(bg, /sets the place but has no full background/).length === 1, "connecting panels with a background, and an establishing panel without one, are flagged");
  const long = specOf([[{ h: 1, panels: [pn({ who: [who("A", 0.5)], lines: [line("A", "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen")] })] }]]);
  ok(flags(long, /17-word balloon/).length === 1, "a long balloon is flagged for splitting");
  const quiet = (silent) => specOf([0, 1, 2].map((k) => [{ h: 2 + k, panels: [pn({ who: [who("A", 0.5)], lines: [line("A", "Hi.")] })] }, { h: 1, panels: [pn({ shot: "close", who: [who("A", 0.5)], lines: silent && k === 1 ? [] : [line("A", "Yes.")] })] }]));
  ok(Paneler.check(quiet(false), R).advice.some((a) => /no silent panel/.test(a.msg)) && !Paneler.check(quiet(true), R).advice.length, "a chapter with no silent panel gets that advice; one silent panel answers it");
}
// ---- the Letterer splits a long line at a pause before the type shrinks; the words never change
{
  const text = "I told you yesterday, we are not going back there.";
  let split = 0, n = 0;
  for (const w of [0.3, 0.34, 0.38, 0.42]) for (const h of [0.25, 0.3, 0.35]) for (const fy of [0.3, 0.45, 0.6]) {
    const page = { id: "t", layout: { rows: [{ h, panels: [{ w, id: "a", board: { who: [{ name: "Mara", at: [0.5, fy], size: "close", facing: "left" }], lines: [{ source_id: "L1", speaker: "Mara", kind: "speech", text }, { source_id: "L2", speaker: "Mara", kind: "speech", text: "Not ever." }] } }, { w: 1.01 - w, id: "b", board: { who: [], lines: [] } }] }, { h: 1 - h, panels: [{ w: 1, id: "c", board: { who: [], lines: [] } }] }] }, text: [] };
    const got = R.autoPlace(page, {}, {}, measureText); n++;
    if (got.length === 3) { split++; ok(got[0].join && got[1].join && !got[0].tail && !got[0].size && !got[1].size, "the halves are joined, full size, with one tail"); }
    ok(got.map((i) => i.text).join(" ") === text + " Not ever.", "the words are exactly the script's");
  }
  ok(split > 0, `a line that would not sit cleanly was split at its pause in ${split} of ${n} tight panels`);
}
// ---- story and page turn: advice only
{
  const rev = (i) => { const panels = [pn({ who: [who("A", 0.5)] }, 1), pn({ shot: "close", who: [who("A", 0.5)] }, 1)]; panels[i].board.reveal = true; return specOf([[{ h: 3, panels: [pn({})] }, { h: 1, panels: [pn({ shot: "insert" })] }], [{ h: i ? 1 : 3, panels: [panels[0]] }, { h: i ? 3 : 1, panels: [panels[1]] }]]); };
  ok(flags(rev(0), /A surprise lands when it is the first thing seen/).length === 0, "a reveal that opens its page is fine");
  const late = flags(rev(1), /A surprise lands when it is the first thing seen/);
  ok(late.length === 1 && late[0].advice === true && late[0].level !== "error", "a reveal in the middle of a page gets advice, never a block");
  const small = specOf([[{ h: 1, panels: [pn({})] }], [{ h: 1, panels: [pn({ reveal: true, who: [who("A", 0.5)] }, 1)] }, { h: 2, panels: [pn({ shot: "close" })] }]]);
  ok(flags(small, /not the biggest picture in the chapter/).length === 1, "the turn of the story should be the biggest picture");
  const wordy = (chapter) => specOf([[{ h: 2, panels: [pn({ who: [who("A", 0.5)], lines: [line("A", Array(13).fill("word").join(" ")), line("A", Array(13).fill("more").join(" "))] })] }, { h: 1, panels: [pn({ shot: "close", who: [who("A", 0.5)], lines: [line("A", Array(13).fill("talk").join(" ")), line("A", Array(11).fill("on").join(" "))] })] }]], { chapter });
  ok(flags(wordy(1), /first 5 pages of a story/).length === 1 && flags(wordy(1), /first 5 pages/)[0].advice, "chapter 1: 50 words on an opening page gets advice (45 at most)");
  ok(flags(wordy(2), /first 5 pages/).length === 0, "a later chapter keeps the usual limit");
  ok(Paneler.saidTwice({ kind: "speech", text: "I am so sad." }, { action: "Mara, crying, tears on her cheeks." }) !== "", "“I am so sad” over a crying face is said twice");
  ok(Paneler.saidTwice({ kind: "speech", text: "I am so sad." }, { action: "Mara smiles brightly." }) === "", "over a smile it is not (the line adds something)");
  ok(Paneler.saidTwice({ kind: "speech", text: "He opens the old wooden door." }, { action: "Joss opens the old wooden door." }) !== "", "a line that describes its own panel is said twice");
  ok(Paneler.saidTwice({ kind: "speech", text: "You said nine." }, { action: "Mara stands at the end of the pier." }) === "", "an ordinary line is left alone");
  const book = specOf([[{ h: 1, panels: [pn({ action: "Mara, crying.", who: [who("Mara", 0.5)], lines: [line("Mara", "I am so sad.")] })] }]], { book: "b1" });
  const said = flags(book, /may only repeat what the picture shows/);
  ok(said.length === 1 && said[0].advice && /book's own line, so it stays/.test(said[0].msg), "in a book the advice says the line stays: a book's words are never changed");
  ok(book.pages[0].layout.rows[0].panels[0].board.lines[0].text === "I am so sad.", "and the check changed nothing");
}
// ---- a manga editor's notes (20 Nov 2026): advice only
{
  const adv = (spec, re) => { const r = Paneler.check(spec, R); return [...Object.values(r.pages).flat(), ...r.advice].filter((f) => re.test(f.msg)); };
  // the same picture either side of the page turn
  const turn = (shot2) => specOf([[{ h: 2, panels: [pn({ shot: "wide", who: [who("A", 0.5)] })] }, { h: 1, panels: [pn({ shot: "close", who: [who("A", 0.5)] })] }],
    [{ h: 1, panels: [pn({ shot: shot2, who: [who("A", 0.5)] })] }, { h: 2, panels: [pn({ shot: "wide", who: [who("A", 0.5)] })] }]]);
  const t = adv(turn("close"), /same picture as the last panel of page 1/); ok(t.length === 1 && t[0].advice, "the same picture either side of the page turn gets advice");
  ok(adv(turn("medium"), /same picture as the last panel/).length === 0, "a new distance after the turn is fine");
  // a page with one shot size, and a page of close-ups
  const one = specOf([[{ h: 2, panels: [pn({ who: [who("A", 0.5)] })] }, { h: 1, panels: [pn({ who: [who("B", 0.5)], angle: "low angle" }), pn({ who: [who("A", 0.5)], angle: "high angle" })] }]]);
  ok(adv(one, /every panel with people on this page is a medium shot/).length === 1, "a page where every panel with people is a medium shot gets advice (angles alone are not a mix)");
  one.pages[0].layout.rows[0].panels[0].board.shot = "wide"; ok(adv(one, /every panel with people/).length === 0, "one wide panel answers it");
  const faces = specOf([[{ h: 2, panels: [pn({ shot: "wide", who: [who("A", 0.5)] })] }, { h: 1, panels: [pn({ shot: "close", who: [who("A", 0.5)] }), pn({ shot: "close", angle: "low angle", who: [who("B", 0.5)] })] }, { h: 1, panels: [pn({ shot: "extreme close", who: [who("A", 0.5)] }), pn({ shot: "insert" })] }]]);
  ok(adv(faces, /3 of 5 panels are face close-ups/).length === 1, "a page that is mostly face close-ups gets advice");
  // a chapter of medium shots with no wide one
  const mids = (wide) => specOf([0, 1, 2].map((k) => [{ h: 2, panels: [pn({ shot: wide && k === 1 ? "wide" : "medium", who: [who("A", 0.5)] })] }, { h: 1, panels: [pn({ shot: "medium", angle: "low angle", who: [who("B", 0.5)] }), pn({ shot: "close", who: [who("A", 0.5)] })] }]));
  ok(adv(mids(false), /are medium shots and only 0 are wide/).length === 1, "a chapter of medium shots with no wide one gets advice");
  ok(adv(mids(true), /are medium shots and only/).length === 0, "one wide panel in three pages answers it");
  // a new scene with no panel showing the place
  const scene = (estFirst) => { const s = specOf([[{ h: 2, panels: [pn({ shot: estFirst ? "wide" : "medium", who: [who("A", 0.5)] })] }, { h: 1, panels: [pn({ shot: "close", who: [who("A", 0.5)], lines: [line("A", "Here.", "speech", "a")] }), pn({ shot: "medium", angle: "low angle", who: [who("A", 0.5)] }), pn({ shot: "insert" })] }]]);
    s.script = [{ type: "scene", id: "S1" }, { type: "line", source_id: "a", speaker: "A", text: "Here." }]; return s; };
  ok(adv(scene(false), /a new scene starts at panel 2 and no panel shows the place/).length === 1, "a scene with no wide panel near its start gets advice");
  ok(adv(scene(true), /no panel shows the place/).length === 0, "a silent wide panel just before the first line counts");
  ok(adv(specOf([[{ h: 1, panels: [pn({ who: [who("A", 0.5)] })] }]]), /no panel shows the place/).length === 0, "a script with no scene marks is not checked for it");
  // a tiny reaction in a balloon
  const grunt = (text, kind = "speech") => adv(specOf([[{ h: 1, panels: [pn({ who: [who("A", 0.5)], lines: [line("A", text, kind)] })] }]]), /is a small reaction/);
  ok(grunt("Oh.").length === 1 && grunt("Mm, hm.").length === 1 && grunt("…").length === 1, "“Oh.”, “Mm, hm.” and “…” in a balloon get advice to float as hand-drawn text");
  ok(grunt("Oh no, not again.").length === 0 && grunt("No.").length === 0 && grunt("Oh.", "ambient").length === 0 && grunt("Ow!", "shout").length === 0, "a real line, a “No.”, an ambient one or a shout is left alone");
  // a chapter where things happen with no sound effect
  const noisy = (sfx) => specOf([0, 1, 2, 3].map((k) => [{ h: 2, panels: [pn({ job: "act", shot: k % 2 ? "wide" : "full figure", who: [who("A", 0.5)], sfx: sfx && k === 2 ? "SLAM" : undefined })] }, { h: 1, panels: [pn({ job: "react", bg: "white", shot: "close", who: [who("A", 0.5)] })] }]));
  ok(adv(noisy(false), /no sound effect anywhere/).length === 1, "a chapter of action with no sound effect gets advice");
  ok(adv(noisy(true), /no sound effect anywhere/).length === 0, "one sound effect answers it");
  // the hook, for a story the Writer wrote from an idea
  const idea = (hook) => specOf([[{ h: 1, panels: [pn({})] }]], { story: { from_idea: true, hero: "A", begins: "x", ends: "y", hook } });
  ok(adv(idea(""), /no one-line hook/).length === 1 && adv(idea("A ferry that only runs for liars."), /the hook, in one line/).length === 1, "the hook is asked for, or shown back");
  ok(adv(Object.assign(idea(""), { book: "b1" }), /hook/).length === 0, "never for a book");
  // read on a phone (the default) or in print: how many panels a page reads well
  const busy = (readOn) => Object.assign(specOf([0, 1, 2].map(() => [{ h: 2, panels: [pn({ shot: "wide", who: [who("A", 0.5)] }), pn({ shot: "close", who: [who("A", 0.5)] })] }, { h: 1, panels: [pn({ shot: "insert" }), pn({ shot: "medium", who: [who("B", 0.5)] }), pn({ shot: "close", angle: "low angle", who: [who("A", 0.5)] }), pn({ shot: "insert" })] }])), readOn ? { read_on: readOn } : {});
  ok(adv(busy(), /read on a phone, where 3 to 5 roomy panels/).length === 1, "six panels a page on a phone gets advice (the default)");
  ok(adv(busy("print"), /read on a phone/).length === 0 && adv(busy("print"), /average 6\.0 panels\. About five/).length === 1, "in print the old limit holds");
  // the page budget agreed in the talk with the Writer
  const plan = (pages) => specOf(Array(pages).fill(0).map(() => [{ h: 1, panels: [pn({})] }]), { story: { from_idea: true, hero: "A", begins: "x", ends: "y", hook: "h", acts: [{ part: "Setup", pages: 2 }, { part: "Development", pages: 4 }, { part: "Twist", pages: 3 }, { part: "Ending", pages: 2 }] } });
  ok(adv(plan(11), /plan you agreed with the Writer/).length === 0 && adv(plan(13), /plan you agreed/).length === 0, "a storyboard near the agreed pages is fine");
  ok(/storyboard has 18\. A part may be running long/.test((adv(plan(18), /plan you agreed/)[0] || {}).msg) && /storyboard has 6\. A part may be rushed/.test((adv(plan(6), /plan you agreed/)[0] || {}).msg), "far longer or shorter than the plan gets advice");
}
// ---- the camera follows the feeling: a panel's tension reaches the Artist and survives the builder
{
  ok(Object.keys(D.TENSION).join() === "tense,danger,fear", "three tensions: tense, danger, fear");
  const spec = specOf([[{ h: 1, panels: [pn({ shot: "wide", tension: "danger", who: [who("Mara", 0.5)] }), pn({ shot: "medium", who: [who("Mara", 0.5)] })] }]]);
  const pg = spec.pages[0], cells = R.allPanels(pg.layout), bible = { cast: { Mara: { desc: "MARA" } } };
  ok(/CAMERA: tilted \(a canted frame\)/.test(Artist.panelBrief(pg, cells[0].panel.id, spec, bible, R, measureText).prompt), "a danger beat asks the Artist for a tilted, pulled-back camera");
  ok(!/CAMERA:/.test(Artist.panelBrief(pg, cells[1].panel.id, spec, bible, R, measureText).prompt), "an ordinary beat gets no camera words");
  const dir = scratch("tension"); fs.cpSync(path.join(APP, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true });
  const bf = path.join(dir, "board.json"), bd = JSON.parse(fs.readFileSync(bf, "utf8")); bd.pages[0].panels[0].tension = "fear"; bd.pages[0].panels[1].tension = "spooky"; fs.writeFileSync(bf, JSON.stringify(bd));
  execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), dir]); const built = JSON.parse(fs.readFileSync(path.join(dir, "spec.json"), "utf8")), b0 = R.allPanels(built.pages[0].layout).map((c) => c.panel.board);
  ok(b0.some((b) => b.tension === "fear") && !b0.some((b) => b.tension === "spooky"), "the builder keeps a known tension and drops an unknown one");
  ok(built.read_on === "phone", "a chapter is read on a phone unless its series says print");
  fs.writeFileSync(path.join(dir, "bible.json"), JSON.stringify({ ...JSON.parse(fs.existsSync(path.join(dir, "bible.json")) ? fs.readFileSync(path.join(dir, "bible.json"), "utf8") : "{}"), read_on: "print" }));
  execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), dir]); ok(JSON.parse(fs.readFileSync(path.join(dir, "spec.json"), "utf8")).read_on === "print", "the series setting says print");
  const task = fs.readFileSync(execFileSync("node", [path.join(APP, "tools/paneler_task.mjs"), dir]).toString().trim(), "utf8");
  ok(/about 5 panels/.test(task) && !/READ ON A PHONE/.test(task) && /`tension` \(optional\)/.test(task) && /TINY REACTIONS FLOAT/.test(task) && /crowd, ambient or title/.test(task), "the Paneler is told: print pacing, tension, floating reactions");
  fs.writeFileSync(path.join(dir, "bible.json"), JSON.stringify({ read_on: "phone" }));
  ok(/READ ON A PHONE/.test(fs.readFileSync(execFileSync("node", [path.join(APP, "tools/paneler_task.mjs"), dir]).toString().trim(), "utf8")), "and phone pacing for a phone series");
  fs.rmSync(dir, { recursive: true, force: true });
}
done("panel director, manga flow, story and page-turn checks");
