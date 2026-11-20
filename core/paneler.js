/* Paneler checks: a storyboarded chapter against the script and the paneling rules.
 * check(spec, R) -> { chapter: [{level, msg}], pages: {pageId: [{level, msg}]} }   (R = PageRender for geometry)
 * Rules: every script line used once, whole, in order; word budget 35-55 (limit 70); at most 6 panels and 5 spoken lines; at most 3 balloons
 * a panel; one panel clearly larger than the rest; no two pages in a row on the same grid; every page ends on a
 * stated beat (note); a speaker must be in frame or the line marked as an off-panel voice.
 *
 * Added 19 Nov 2026 (from posts by manga makers and readers), all of them things that can be counted:
 *   Manga flow (5): people keep their side of the picture within a scene; at most one big expression a page; connecting
 *     panels (talk, react, insert) carry no background; a chapter has silent panels; a long balloon is split.
 *   Panel director (1): no even grid; upright gutters do not line up from tier to tier; neighbours do not share camera
 *     distance and angle; a big panel every two pages; the heaviest panel is the biggest (core/director.js).
 *   Story and page turn (7): a reveal is the first panel of its page and the biggest picture of the chapter; the opening
 *     pages carry fewer words; a line that only repeats its panel is pointed out.
 *   Manga editor notes (20 Nov 2026, from a working editor's notes on a submission, and readers of a 24-page AI manga), all advice:
 *     the first panel after a page turn is not the same picture as the last one before it; a page mixes shot sizes; a page
 *     is not mostly face close-ups; a chapter is not mostly medium shots with no wide ones; a new scene gets a panel that
 *     shows the place; a tiny reaction ("Oh.", "Mm.") is floating hand-drawn text, not a balloon; a chapter where things
 *     happen has at least one sound effect; an original story can say its hook in one line.
 * Story checks are ADVICE (`advice: true`, message starts "Advice:"): they never block, and a book's words are never changed.
 * check() also returns `advice`: [{msg}] for the whole chapter.
 */
(function (g) {
  "use strict";
  const norm = (s) => String(s).replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  const words = (s) => norm(s).split(" ").filter(Boolean).length;

  function leaves(rows, out = []) { for (const r of rows || []) for (const q of r.panels) { if (q.rows && q.rows.length) leaves(q.rows, out); else out.push(q); } return out; }
  function shape(rows) { return JSON.stringify((rows || []).map((r) => [Math.round(r.h * 10), r.panels.map((q) => q.rows ? ["c", JSON.parse(shape(q.rows))] : Math.round((q.w || 1) * 10))])); }
  function area(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); }

  const D = typeof module !== "undefined" && module.exports ? require("./director.js") : g.Director; // jobs, weights, layout ratings
  const LIMITS = { panels: 6, lines: 5, words: 70, opening: 45, openingPages: 5, balloon: 16, bigWords: 10 };
  // camera: "Medium shot" and "medium" are the same distance
  const cam = (b) => `${String(b.shot || "medium").toLowerCase().replace(/\bshot\b/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim()}, ${String(b.angle || "eye level").toLowerCase().trim()}`;
  const WIDE = /wide|establish|overhead|full figure|full-figure|long shot/i;
  // camera distance only (no angle): wide, medium or close; null for an insert, a point of view or no shot given
  const dist = (b) => { const s = String(b.shot || "").toLowerCase(); if (!s || /insert|point of view|\bpov\b/.test(s)) return null;
    if (WIDE.test(s)) return "wide"; if (/medium|two-shot|two shot|bust|chest|shoulder|waist|knee/.test(s)) return "medium"; if (/close/.test(s)) return "close"; return "medium"; };
  // a small reaction that reads lighter as floating hand-drawn text (ambient) than in a balloon
  const GRUNT = new Set("oh ah ahh aah eh huh hm hmm hmmm mm mmm mhm uh uhh um umm er erm ugh wow whoa woah oops ow ouch ha hah haha heh hehe tch tsk psst phew aw aww oi eek gah hngh".split(" "));
  const grunt = (t) => { const ws = norm(t).toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean); return ws.length ? ws.length <= 2 && ws.every((w) => GRUNT.has(w)) : /^[.…!?\s]+$/.test(norm(t)) && norm(t).length > 0; };
  const bigFace = (b) => b.face === "big" || (b.lines || []).some((l) => l.kind === "shout");
  // "said twice": a feeling stated in words while the panel already shows it (reference L: when the picture says it, cut the line)
  const FEEL = {
    sad: ["sad", "unhappy", "miserable", "heartbroken", "crying", "cry", "cries", "cried", "tears", "tear", "sob", "sobs", "sobbing", "weep", "weeps", "weeping"],
    angry: ["angry", "furious", "mad", "livid", "rage", "raging", "glare", "glares", "glaring", "scowl", "scowls", "scowling", "fuming", "enraged"],
    scared: ["scared", "afraid", "frightened", "terrified", "fear", "trembling", "trembles", "shaking", "shakes", "cowers", "cowering", "panic", "panicking"],
    happy: ["happy", "glad", "delighted", "overjoyed", "joy", "smile", "smiles", "smiling", "grin", "grins", "grinning", "beaming", "laughing", "laughs"],
    surprised: ["surprised", "shocked", "stunned", "astonished", "shock", "gasp", "gasps", "gasping", "startled", "wide-eyed"],
    tired: ["tired", "exhausted", "sleepy", "worn", "yawn", "yawns", "yawning", "slumps", "slumped", "drowsy"],
    embarrassed: ["embarrassed", "ashamed", "blush", "blushes", "blushing", "flustered", "mortified"],
    cold: ["cold", "freezing", "shiver", "shivers", "shivering"], hungry: ["hungry", "starving", "stomach growls", "stomach rumbles"],
  };
  const STOP = new Set("a an the and or but so of to in on at for with from by is are was were be been am i you he she it we they me him her us them my your his its our their this that these those there here not no yes do does did have has had will would can could just very really too so oh ah well".split(" "));
  const stem = (w) => w.replace(/(ing|ed|es|s)$/, "");
  const content = (t) => norm(t).toLowerCase().replace(/[^a-z' -]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
  /** Why this line may only repeat its panel, or "" (a guess from the words: it is only ever advice). */
  function saidTwice(line, b) {
    if (!line.text || line.kind === "title" || line.kind === "caption" || line.kind === "phone") return "";
    const said = " " + norm(line.text).toLowerCase().replace(/[^a-z' -]/g, " ") + " ", seen = " " + norm(`${b.action || ""} ${b.art || ""}`).toLowerCase().replace(/[^a-z' -]/g, " ") + " ";
    if (/ (i'm|i am|i feel|i was|i'm so|we're|we are) /.test(said)) for (const [name, ws] of Object.entries(FEEL)) {
      const a = ws.find((w) => said.includes(" " + w + " ")), c = ws.find((w) => seen.includes(" " + w + " ") || seen.includes(" " + w));
      if (a && c) return `the line says “${a}” and the panel already shows it (“${c}”)`;
    }
    const mine = content(line.text), theirs = new Set(content(`${b.action || ""} ${b.art || ""}`));
    if (mine.length >= 3 && mine.length <= 9 && mine.filter((w) => theirs.has(w)).length / mine.length >= 0.75) return "almost every word of it is in the panel's own description";
    return "";
  } // hard limits a page; tools/build_spec.mjs sends an unattended board back when it breaks them

  function check(spec, R) {
    const chapter = [], advice = [], pages = {};
    const scriptLines = (spec.script || []).filter((b) => b.type === "line" && b.source_id);
    const order = new Map(scriptLines.map((b, i) => [b.source_id, i]));
    const used = new Map(); // source_id -> joined text
    let lastIdx = -1, prevShape = null;
    // scenes, for "sides stay put": which scene each script line belongs to
    const sceneOf = new Map(); { let sc = ""; for (const b of spec.script || []) { if (b.type === "scene") sc = b.id || b.text; else if (b.type === "line" && b.source_id) sceneOf.set(b.source_id, sc); } }
    let scene = null, sides = new Map(), prevBig = true, pageNo = 0, silent = 0, panelCount = 0, pagesCount = 0;
    const usesJobs = spec.pages.some((p) => p.layout && leaves(p.layout.rows).some((q) => q.board && q.board.job));
    const opening = +(spec.chapter || 1) === 1, everyCell = []; // the opening pages are the first five of the story
    const adv = (out, msg) => out.push({ level: "warn", advice: true, msg: "Advice: " + msg });
    // editor's notes: the picture before the turn, scene starts, shot sizes over the chapter, sound effects
    const scenesMarked = (spec.script || []).some((b) => b.type === "scene");
    let prevLast = null, pending = null, sinceLine = [], sfxSeen = false, acts = 0; const sizes = { wide: 0, medium: 0, close: 0 };
    const flush = (q) => { if (q && !q.found) adv(pages[q.pid], `a new scene starts at panel ${q.panel} and no panel shows the place. At a change of scene give the reader one wide panel of where we are (it can take a third of the page, with a caption or a thought over it).`); };
    for (const p of spec.pages) {
      const out = (pages[p.id] = []);
      if (!p.layout) continue;
      if (!p.cover) pageNo++;
      const cells = R.layoutGeom(p.layout).cells, ls = leaves(p.layout.rows);
      // lines, in reading order
      let n = 0;
      cells.forEach((c, i) => {
        const b = c.panel.board || {}, lines = b.lines || [];
        if (lines.length > 3) out.push({ level: "warn", msg: `Panel ${i + 1} has ${lines.length} balloons (max 3). Add a panel.` });
        const inFrame = new Set((b.who || []).map((w) => w.name));
        for (const l of lines) {
          if (l.kind !== "title") n += words(l.text);
          if (l.speaker && !l.off && !inFrame.has(l.speaker)) out.push({ level: "warn", msg: `Panel ${i + 1}: ${l.speaker} speaks but isn't in the frame. Add them or mark the line as an off-panel voice.` });
          if (!l.source_id || !order.has(l.source_id)) continue;
          const idx = order.get(l.source_id);
          if (idx < lastIdx) out.push({ level: "error", msg: `Line ${l.source_id} is out of script order.` });
          lastIdx = Math.max(lastIdx, idx);
          used.set(l.source_id, (used.has(l.source_id) ? used.get(l.source_id) + " " : "") + l.text);
        }
      });
      if (n > LIMITS.words) out.push({ level: "error", msg: `${n} words: over the ${LIMITS.words}-word limit. Move a beat to another page.` });
      else if (opening && !p.cover && pageNo <= LIMITS.openingPages && n > LIMITS.opening) adv(out, `${n} words on page ${pageNo}. The first ${LIMITS.openingPages} pages of a story read best with ${LIMITS.opening} or fewer: lose the reader here and they are gone. Let pictures carry more, or give the scene another page.`);
      else if (n > 55) out.push({ level: "warn", msg: `${n} words: above the 35–55 target.` });
      { const n = D && D.counted ? D.counted(ls) : ls.length; // a strip of 3 to 5 tiny panels (weight 1) reads as one panel
        if (n > LIMITS.panels || ls.length > LIMITS.panels + 2) out.push({ level: "error", msg: `${ls.length} panels (max ${LIMITS.panels}${n < ls.length ? ", a strip of tiny panels counting as one; 8 at the very most" : ""}). Move a beat to a new page.` }); }
      const said = new Set(); cells.forEach((c) => { for (const l of (c.panel.board || {}).lines || []) if (l.kind !== "title") said.add(l.source_id || l.text); });
      if (said.size > LIMITS.lines) out.push({ level: "error", msg: `${said.size} spoken lines (max ${LIMITS.lines}). The page is crowded: move a beat to a new page.` });
      const areas = cells.map((c) => area(c.poly)).sort((a, b) => b - a);
      if (areas.length > 1 && areas[0] < areas[1] * 1.25) out.push({ level: "warn", msg: "No panel is clearly larger than the rest. Give the page one dominant panel." });
      { // background strength: a page needs strong and weak panels (the detail goes where it matters)
        const bgs = cells.map((c) => (c.panel.board || {}).bg || "simple"), full = bgs.filter((x) => x === "full").length;
        if (bgs.length >= 3 && new Set(bgs).size === 1) out.push({ level: "warn", msg: `Every panel has the same background strength (${bgs[0]}). Give the panel that matters a full background and let the in-between panels go white.` });
        else if (bgs.length >= 4 && full > 2) out.push({ level: "warn", msg: `${full} of ${bgs.length} panels have a full background. Keep the detail for the one or two that matter.` });
      }
      { const sp = cells.filter((c) => (c.panel.board || {}).splash); if (sp.length > 1) out.push({ level: "warn", msg: `${sp.length} splash panels on one page. A page has one big moment at most.` });
        else if (sp.length && cells.length > 1) { const big = cells.map((c) => area(c.poly)).sort((a, b) => b - a)[0]; if (area(sp[0].poly) < big) out.push({ level: "warn", msg: "The splash panel is not the largest panel on its page. Make it the dominant panel." }); } }
      const sh = shape(p.layout.rows);
      if (sh === prevShape) out.push({ level: "warn", msg: "Same grid as the page before. Vary the layout." });
      prevShape = sh;
      if (!p.note) out.push({ level: "warn", msg: "No page-turn beat written for this page." });
      if (p.cover) continue;
      pagesCount++; panelCount += cells.length;
      const rtl = !!p.layout.rtl, rt = D ? D.rate(p.layout.rows, R) : null, B = cells.map((c) => c.panel.board || {});
      cells.forEach((c, i) => everyCell.push({ c, page: pageNo, i, pid: p.id, area: area(c.poly) }));

      // ---- panel director: the page's build
      if (rt) {
        if (rt.even) out.push({ level: "warn", msg: `An even grid (${rt.counts.join(" by ")}): every panel is the same box. Size panels by what they do: the moment that matters big, reactions and details small.` });
        else if (rt.aligned) out.push({ level: "warn", msg: `Upright gutters line up from one tier to the next (${rt.aligned} place${rt.aligned === 1 ? "" : "s"}), so the page reads as a grid. Shift one tier's split.` });
        if (!rt.big && !prevBig) out.push({ level: "warn", msg: "No big panel on this page or the one before. Every two pages, one panel takes a third of a page or more." });
        prevBig = rt.big || cells.length === 1;
        const ws = B.map((b) => D.weightOf(b)), top = Math.max(...ws), heavy = ws.map((w, i) => (w === top ? i : -1)).filter((i) => i >= 0);
        if (B.some((b) => b.weight || b.job) && heavy.length === 1 && cells.length > 1 && rt.largest !== heavy[0] && rt.shares[rt.largest] > rt.shares[heavy[0]] * 1.1)
          out.push({ level: "warn", msg: `Panel ${heavy[0] + 1} carries the most weight (${top}) but panel ${rt.largest + 1} is bigger. Size follows weight: pick a layout by weight, or change the weights.` });
        if (usesJobs && rt.big && cells.length > 1) { const b = B[rt.largest]; if (!b.job && !b.splash && !b.note) adv(out, `panel ${rt.largest + 1} is the big panel of this page, with no reason given. Say what it is for (its job, or a note), or give the size to the panel that earns it.`); }
      }
      { const sh = cells.map((c, i) => (R.validShape(c.panel.shape) ? i : -1)).filter((i) => i >= 0); // panels with a shape of their own
        if (sh.length > 2) adv(out, `${sh.length} panels on this page have a shape of their own (panels ${sh.map((i) => i + 1).join(", ")}). A shaped panel stands out because the others are plain: keep one, two at most.`); }
      { const sx = B.map((b, i) => (b.sfx ? i : -1)).filter((i) => i >= 0); // lettered sound effects the storyboard asks for
        if (sx.length > 1) adv(out, `${sx.length} lettered sound effects on this page (panels ${sx.map((i) => i + 1).join(", ")}). One a page at most: keep the one that matters.`);
        for (const i of sx) if (B[i].job === "talk" || B[i].job === "react" || B[i].job === "insert") adv(out, `panel ${i + 1} has a sound effect (“${B[i].sfx}”) but nothing happens in it (its job is ${B[i].job}). A sound belongs on the panel where the thing happens.`); }
      { const bigs = B.map((b, i) => (b.job === "big" ? i : -1)).filter((i) => i >= 0);
        if (bigs.length > 1) out.push({ level: "warn", msg: `${bigs.length} panels are marked as the big moment. A page has one.` });
        for (const i of bigs) { const w = (B[i].lines || []).reduce((a, l) => a + (l.kind === "title" ? 0 : words(l.text)), 0);
          if (w > LIMITS.bigWords) adv(out, `the big panel (${i + 1}) carries ${w} words. Six to eight land harder: a big panel is one person and one short line.`); } }
      // neighbours with the same camera distance and angle
      { const runs = []; let run = [0];
        for (let i = 1; i <= cells.length; i++) {
          const same = i < cells.length && (B[i].who || []).length && (B[i - 1].who || []).length && cam(B[i]) === cam(B[i - 1]);
          if (same) run.push(i); else { if (run.length > 1) runs.push(run); run = [i]; }
        }
        for (const r of runs) out.push({ level: "warn", msg: `Panels ${r.map((i) => i + 1).join(r.length > 2 ? ", " : " and ")} use the same camera distance and angle (${cam(B[r[0]])}). Change one: closer, wider, higher or lower.` }); }
      // ---- editor's notes (20 Nov 2026): advice only
      { const names = (b) => (b.who || []).map((w) => w.name).sort().join("|"), first = B[0];
        if (prevLast && first && (first.who || []).length && names(first) === names(prevLast.b) && cam(first) === cam(prevLast.b))
          adv(out, `the first panel of this page is the same picture as the last panel of page ${prevLast.page} (${names(first).replace(/\|/g, " and ")}, ${cam(first)}). Never the same composition twice in a row, across the page turn too: a slight turn of the head is not a new picture.`);
        prevLast = B.length ? { b: B[B.length - 1], page: pageNo } : prevLast; }
      { const ds = B.filter((b) => (b.who || []).length).map(dist).filter(Boolean), closes = ds.filter((d) => d === "close").length;
        for (const d of ds) sizes[d]++;
        if (ds.length >= 3 && new Set(ds).size === 1) adv(out, `every panel with people on this page is a ${ds[0]} shot. Mix the sizes: someone small in a wide panel, medium for the talk, one close face where it counts.`);
        else if (cells.length >= 4 && closes > cells.length / 2) adv(out, `${closes} of ${cells.length} panels are face close-ups. A face-only panel is for when the expression is the point; pull back on the others so the reader sees where people are and what they do.`); }
      for (const b of B) { if (b.sfx || (b.lines || []).some((l) => l.kind === "sfx")) sfxSeen = true; if (b.job === "act" || b.job === "big") acts++; }

      // ---- manga flow
      cells.forEach((c, i) => {
        const b = B[i], who = (b.who || []).filter((w) => w && w.name && Array.isArray(w.at));
        const sc = (b.lines || []).map((l) => sceneOf.get(l.source_id)).find((x) => x != null);
        const wide = WIDE.test(String(b.shot || "")) || b.job === "establish";
        if (scenesMarked) { // a new scene: a silent wide panel just before its first line counts, or one of its first three panels
          if (sc != null && sc !== scene) { flush(pending); pending = { pid: p.id, panel: i + 1, left: 3, found: sinceLine.some(Boolean) }; }
          if (pending) { if (wide) pending.found = true; if (--pending.left <= 0) { flush(pending); pending = null; } }
          if ((b.lines || []).length) sinceLine = []; else sinceLine.push(wide); }
        if (sc != null && sc !== scene) { scene = sc; sides = new Map(); } // a new scene: sides are set afresh
        if (wide) sides = new Map(); // a wide panel shows the room again, so people may have moved
        for (let x = 0; x < who.length; x++) for (let y = x + 1; y < who.length; y++) {
          const [a, z] = who[x].name < who[y].name ? [who[x], who[y]] : [who[y], who[x]], dx = a.at[0] - z.at[0];
          if (Math.abs(dx) < 0.12) continue; // one in front of the other: no side to keep
          const key = a.name + "|" + z.name, now = dx < 0 ? -1 : 1, was = sides.get(key);
          if (was && was.side !== now) out.push({ level: "warn", msg: `Panel ${i + 1}: ${a.name} and ${z.name} have swapped sides since ${was.page === pageNo ? "panel " + was.panel : "page " + was.page} (${a.name} was on the ${was.side < 0 ? "left" : "right"}). Within a scene people keep their side; a wide panel in between lets them move.` });
          if (!was) { // the first time these two share a panel in this scene: the one who speaks first stands on the side read first
            const spoke = (b.lines || []).filter((l) => l.speaker && !l.off && (l.speaker === a.name || l.speaker === z.name)).map((l) => l.speaker);
            if (new Set(spoke).size === 2) { const first = spoke[0] === a.name ? a : z, other = first === a ? z : a, firstOnRight = first.at[0] > other.at[0];
              if (firstOnRight !== rtl) adv(out, `panel ${i + 1}: ${first.name} speaks first but stands on the ${firstOnRight ? "right" : "left"}. This page reads ${rtl ? "right to left" : "left to right"}, so the first speaker reads best on the ${rtl ? "right" : "left"}.`); }
          }
          sides.set(key, { side: now, page: pageNo, panel: i + 1 });
        }
        if (!(b.lines || []).length) silent++;
        if (b.job && D && D.JOBS[b.job]) { const J = D.JOBS[b.job], bg = b.bg || "simple"; // a job nobody knows is no job
          if (J.connecting && (bg === "full" || (bg === "simple" && b.job !== "talk"))) out.push({ level: "warn", msg: `Panel ${i + 1} is a connecting panel (${J.label.toLowerCase()}) with a ${bg === "full" ? "full" : "hinted"} background. Connecting panels carry none: white or tone, so the reader is not made to work out a place the story does not show.` });
          if (b.job === "establish" && bg !== "full") out.push({ level: "warn", msg: `Panel ${i + 1} sets the place but has no full background. This is the one panel that gets it.` }); }
        for (const l of b.lines || []) {
          if (l.kind !== "title" && l.kind !== "caption" && words(l.text) > LIMITS.balloon) out.push({ level: "warn", msg: `Panel ${i + 1}: a ${words(l.text)}-word balloon (“${norm(l.text).slice(0, 30)}…”). Split it at a pause into two joined balloons, or over two panels, before the type has to shrink.` });
          if ((l.kind || "speech") === "speech" && grunt(l.text)) adv(out, `panel ${i + 1}: “${norm(l.text).slice(0, 20)}” is a small reaction. Letter it as floating hand-drawn text (ambient, no balloon): it reads lighter, and the balloons left are the lines that matter.`);
          const why = saidTwice(l, b); if (why) adv(out, `panel ${i + 1}: “${norm(l.text).slice(0, 40)}” may only repeat what the picture shows (${why}). When the picture says it, the line can go${spec.book ? ". It is the book's own line, so it stays unless you decide otherwise" : ""}.`);
        }
        if ((b.reveal || b.splash) && i > 0) adv(out, `the ${b.reveal ? "reveal" : "splash"} is panel ${i + 1} of this page. A surprise lands when it is the first thing seen after the turn (or the swipe): start a new page with it, and end the page before on the question or the look that sets it up.`);
      });
      { const people = B.filter((b) => (b.who || []).length).length, loud = B.filter(bigFace).length;
        if (loud >= 2 && loud > people / 2) out.push({ level: "warn", msg: `${loud} of ${people || cells.length} panels have a shout or a big expression. Faces are calm by default: spend the big one on the panel that needs it.` }); }
    }
    flush(pending);
    { const all = sizes.wide + sizes.medium + sizes.close;
      if (pagesCount >= 3 && all >= 8 && sizes.medium / all > 0.6 && sizes.wide / all < 0.1) advice.push({ msg: `Advice: ${sizes.medium} of ${all} panels with people are medium shots and only ${sizes.wide} ${sizes.wide === 1 ? "is" : "are"} wide. Put wide shots in on purpose: they set the place and show how people move.` });
      if (usesJobs && pagesCount >= 4 && acts >= 2 && !sfxSeen) advice.push({ msg: "Advice: things happen in this chapter but there is no sound effect anywhere. One drawn sound on the panel where something happens (a door, a step, a hit) makes it read as manga." }); }
    // the turn of the story gets the biggest picture of the chapter
    { const turns = everyCell.filter((x) => { const b = x.c.panel.board || {}; return b.reveal || b.splash; });
      if (turns.length) { const best = turns.reduce((a, x) => (x.area > a.area ? x : a)), bigger = everyCell.filter((x) => !turns.includes(x)).reduce((a, x) => (!a || x.area > a.area ? x : a), null);
        if (bigger && bigger.area > best.area * 1.1) adv(pages[best.pid], `the reveal is not the biggest picture in the chapter (page ${bigger.page}, panel ${bigger.i + 1} is bigger). The turn of the story gets the biggest picture: a full page when it earns it.`); } }
    if (pagesCount >= 3) {
      if (!silent) advice.push({ msg: "Advice: no silent panel in this chapter. A look, a hand or “…” between lines lets the talk breathe." });
      const mean = panelCount / pagesCount; // read on a phone (the default) a page is smaller: 3 to 5 roomy panels read better than 6 cramped ones
      if (spec.read_on === "print") { if (mean > 5.6) advice.push({ msg: `Advice: pages average ${mean.toFixed(1)} panels. About five in three tiers reads best; six on every page is tiring.` }); }
      else if (mean > 5) advice.push({ msg: `Advice: pages average ${mean.toFixed(1)} panels. This series is read on a phone, where 3 to 5 roomy panels a page read best: give each panel one thing to say, and move a beat to a new page.` });
    }
    for (const b of scriptLines) {
      if (!used.has(b.source_id)) chapter.push({ level: "error", msg: `Line ${b.source_id} (${b.speaker}: “${b.text.slice(0, 40)}”) is missing from the pages.` });
      else if (norm(used.get(b.source_id)) !== norm(b.text)) chapter.push({ level: "error", msg: `Line ${b.source_id} is not word for word: “${used.get(b.source_id).slice(0, 50)}”.` });
    }
    // An original story the Writer wrote from the person's idea (never a book, never a script the person brought finished): the two
    // questions a working manga artist asks of a one-shot. The Writer's own notes (spec.story) say what to look for; the pages are counted.
    if (spec.story && spec.story.from_idea && !spec.book) {
      const s = spec.story, q = (t) => norm(t).toLowerCase().replace(/[^a-z0-9' ]/g, "").replace(/\s+/g, " ").trim(), changed = s.edited ? " (the script was changed after the Writer wrote it, so its notes may no longer hold)" : "";
      if (s.aim_line && +(spec.chapter || 1) === 1) { // the hero's aim is said within the first three pages
        let at = 0, no = 0; const want = q(s.aim_line);
        for (const p of spec.pages) { if (!p.layout) continue; if (!p.cover) no++;
          if (want && !at && leaves(p.layout.rows).some((c) => ((c.board || {}).lines || []).some((l) => { const t = q(l.text || ""); return t && (t === want || (want.length > 12 && (t.includes(want) || want.includes(t) && t.length > 12))); }))) at = no; }
        if (at > 3) advice.push({ msg: `Advice: ${s.hero || "the hero"} says what they want (“${s.aim_line.slice(0, 60)}”) on page ${at}. In an original story the reader should know the hero's aim within the first 3 pages.` });
        else if (!at) advice.push({ msg: `Advice: the line where ${s.hero || "the hero"} says what they want (“${s.aim_line.slice(0, 60)}”) is not on the pages${changed}. In an original story the hero's aim is said within the first 3 pages.` });
      }
      const acts = (s.acts || []).filter((a) => a && a.part), planned = acts.reduce((n, a) => n + (+a.pages || 0), 0), real = spec.pages.filter((p) => p.layout && !p.cover).length;
      if (planned && Math.abs(real - planned) > Math.max(2, planned * 0.3)) advice.push({ msg: `Advice: the plan you agreed with the Writer gave the story about ${planned} pages (${acts.map((a) => `${a.part} ${a.pages}`).join(", ")}); the storyboard has ${real}. ${real > planned ? "A part may be running long: check that each page still moves the story on." : "A part may be rushed: check that the turn still gets room to land."}` });
      if (!s.hook) advice.push({ msg: "Advice: the Writer left no one-line hook. Can you say what makes this chapter worth reading in one line, like a search tag? If not, the idea needs sharpening." });
      else advice.push({ msg: `Advice: the hook, in one line: “${s.hook.slice(0, 120)}”. Page 1 should already promise it.` });
      if (!s.begins || !s.ends) advice.push({ msg: `Advice: does ${s.hero || "the hero"} end one step from where they began? The Writer left no note of it. Read the first and the last page side by side.` });
      else if (q(s.begins) === q(s.ends)) advice.push({ msg: `Advice: ${s.hero || "the hero"} ends where they began (“${s.ends.slice(0, 80)}”). A story lands when the hero is one step further on by the last page, even a small one.` });
      else advice.push({ msg: `Advice: does ${s.hero || "the hero"} end one step from where they began? The Writer's plan: begins “${s.begins.slice(0, 110)}”, ends “${s.ends.slice(0, 110)}”${changed}. Check that the last page shows that step without anyone explaining it.` });
    }
    // 20 pages fit one post on X. It is only ever advice (19 Nov 2026): a chapter is as long as its lines need, and no line is cut to fit.
    { const n = (spec.pages || []).length; if (n > 20) advice.push({ msg: `Advice: this chapter has ${n} pages. X takes 20 pictures a post, so pages 21 to ${n} would go in the replies. Nothing has to be cut.` }); }
    return { chapter, advice, pages };
  }

  const api = { check, leaves, LIMITS, saidTwice };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else g.Paneler = api;
})(typeof window !== "undefined" ? window : globalThis);
