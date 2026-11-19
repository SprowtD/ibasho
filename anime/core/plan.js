/* Anime scene plans: a draft shot list from manga panels, and the plan check (craft gate G1).
 * draftFromPages(pages, opts) -> SCENE_PLAN (one shot per panel; the Blocking pass fills movement, cameras, intent ...)
 * check(plan) -> { errors: [...], warnings: [...], stats }
 * The check is a port of an earlier Python checker, scene_plan.py `check` (16 Nov 2026), minus the
 * previs camera list (no previs in the app yet). Same file format, so plans move between the app and our production.
 * Runs in the browser (window.AnimePlan) and in node (require).
 */
(function (g) {
  "use strict";

  // median shot length targets in seconds
  const TARGETS = { dialogue: [1.5, 3.0], comedy: [1.5, 3.0], action: [0.3, 1.0], romance: [4.0, 8.0], emotional: [4.0, 8.0], establishing: [2.0, 4.0], insert: [0.8, 2.5] };
  const PLACEMENTS = ["on_speaker", "over_reaction", "over_insert", "voiceover"];
  const LAYERS = ["environment", "group", "individual", "camera", "cut"];
  const AIDEN = {
    geography: "establishing or two-shot before the close-ups; every off-screen target placed and kept on one side",
    cause: "no effect without its source on screen (or someone we know is there)",
    organic_reactions: "what each character would really think; no gags or comedy faces in serious beats",
    not_faces: "pose / hand / back / silhouette beats, cropped faces for stunned moments; not 99% faces",
    subjective: "slow-mo + muffled sound while dazed, then hard cut, full sound, wide (or N/A with reason)",
    staged_reveal: "anticipation beat for big actions; payoff shown in fragments first (or N/A with reason)",
    colour_story: "planned colour shift at the turning point",
    background_continuity: "same props, extras and damage across every angle",
  };
  const KUROSAWA = {
    signature_gestures: "one gesture per main character from the source (the author picks)",
    world_shows_feeling: "light / weather / crowd carries the feeling at the turning point",
    cut_rhythm: "cut on movement; a still end then a hard cut into motion; peaks breathe",
    depth_staging: "foreground and background readable; frames within frames; readable shadows",
  };
  const CRAFT = Object.assign({}, AIDEN, KUROSAWA);

  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const words = (s) => norm(s).split(" ").filter(Boolean).length;
  const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const round = (x) => Math.round(x * 10) / 10;
  function leaves(rows, out = []) { for (const r of rows || []) for (const q of r.panels || []) { if (q.rows && q.rows.length) leaves(q.rows, out); else out.push(q); } return out; }

  /** A rough scene type for a manga panel: the Blocking pass refines it. */
  function sceneType(b, first) {
    const a = norm(b.action).toLowerCase(), lines = (b.lines || []).filter((l) => l.kind !== "title" && l.kind !== "caption" && l.kind !== "sfx");
    if (b.shot === "insert") return "insert";
    if (/comedy|chibi|deadpan|gag/.test(a + " " + norm(b.note).toLowerCase())) return "comedy";
    if (first && /wide|establish|full/.test(b.shot || "")) return "establishing";
    if (lines.length) return "dialogue";
    if (/wide|establish/.test(b.shot || "")) return "establishing";
    return "dialogue";
  }
  /** Long enough to say the lines at a calm pace (2.6 words a second + a breath), inside the type's range. */
  function durationFor(type, spoken) {
    const [lo, hi] = TARGETS[type]; const need = spoken ? spoken / 2.6 + 0.6 : 0;
    return round(Math.max(need, (lo + hi) / 2));
  }

  /**
   * One shot per panel, in reading order. pages = the manga project's pages (saved copy if there is one).
   * opts: { project, projectUrl ("samples/x/" or "projects/x/"), sceneId, title, pageIds }
   */
  function draftFromPages(pages, opts) {
    opts = opts || {};
    const pick = opts.pageIds && opts.pageIds.length ? pages.filter((p) => opts.pageIds.includes(p.id)) : pages;
    const dialogue = [], shots = [], byLine = new Map();
    let n = 0;
    for (const p of pick) {
      for (const q of leaves(p.layout && p.layout.rows)) {
        const b = q.board; if (!b) continue;
        n++;
        const type = sceneType(b, n === 1), ids = [];
        let spoken = 0;
        const who = (b.who || []).map((w) => w.name);
        for (const l of b.lines || []) {
          if (!l.source_id || !norm(l.text)) continue;
          let d = byLine.get(l.source_id);
          if (d) { if (!d.text.includes(norm(l.text))) d.text = norm(d.text + " " + l.text); continue; } // a line split over joined balloons is one spoken line
          const narr = /^(title|caption|narration)$/.test(l.kind || "");
          d = { line_id: l.source_id, speaker: l.speaker || "", text: norm(l.text), kind: l.kind || "speech",
            mouth: !narr && l.speaker && who.includes(l.speaker) && !l.off ? "on" : "off" };
          byLine.set(l.source_id, d); dialogue.push(d); ids.push(l.source_id);
          if (!narr) spoken += words(l.text);
        }
        const dur = durationFor(type, spoken), lines = ids, spk = lines.map((id) => byLine.get(id));
        const shot = {
          shot_id: "S" + String(n).padStart(3, "0"),
          from_panel: { project: opts.project || "", page: p.id, panel: q.id },
          source_ids: lines.length ? lines.slice() : ["manga:" + (opts.project || "") + ":" + q.id],
          scene_type: type,
          camera: { framing: norm([b.shot, b.angle].filter(Boolean).join(", ")), move: "still", move_reason: "" },
          action: norm(b.action),
          blocking: (b.who || []).map((w) => ({ name: w.name, at: w.at, facing: w.facing || "" })),
          expressions: {},
          lines,
          line_placement: lines.length ? (spk.some((d) => d.mouth === "on") ? "on_speaker" : spk.every((d) => d.kind === "title" || d.kind === "caption") ? "voiceover" : "over_reaction") : undefined,
          duration: dur,
          movement: {},
          book_verb: "",
          interpretation: ["VISUAL_INTERPRETATION: shot taken from the manga panel; camera, timing and acting to be planned"],
          still: q.image ? (opts.projectUrl || "") + q.image : "",
        };
        if (!shot.line_placement) delete shot.line_placement;
        if (b.note) shot.panel_note = norm(b.note);
        shots.push(shot);
      }
    }
    return {
      scene_id: opts.sceneId || "scene",
      title: opts.title || "",
      status: "DRAFT",
      made_from: { project: opts.project || "", pages: pick.map((p) => p.id), at: new Date().toISOString().slice(0, 10) },
      intent: { feel: "", peak: "", must_know: "" },
      palette: [],
      lighting_mood: "",
      sound_plan: "",
      signature_gestures: {},
      craft_checks: {},
      dialogue,
      shots,
    };
  }

  /** A scene with no manga behind it. Each paragraph of the script is a shot; "NAME: words" is a spoken line on the shot it follows
   *  (at most two lines a shot). No script gives one empty shot. The Blocking pass turns this into a real plan. */
  /** A script name typed in capitals ("MARA") is the same person as "Mara" on the cast list. */
  function nameCase(n) { return n.length > 1 && n === n.toUpperCase() ? n.toLowerCase().replace(/(^|[\s.'’-])([a-z])/g, function (_, a, b) { return a + b.toUpperCase(); }) : n; }
  function draftFromScript(text, opts) {
    opts = opts || {};
    const dialogue = [], shots = [];
    const add = (action) => { const s = { shot_id: "S" + String(shots.length + 1).padStart(3, "0"), source_ids: ["script:" + (shots.length + 1)], scene_type: shots.length ? "action" : "establishing",
      camera: { framing: "", move: "still", move_reason: "" }, action: norm(action), expressions: {}, lines: [], duration: 2, movement: {}, book_verb: "",
      interpretation: ["VISUAL_INTERPRETATION: shot taken from the script; camera, timing and acting to be planned"], still: "" }; shots.push(s); return s; };
    let cur = null;
    for (const raw of String(text || "").split(/\n+/)) {
      const ln = norm(raw.replace(/^[#>*\-\s]+/, "")); if (!ln) continue;
      const m = ln.match(/^([A-Z][\w .'’-]{0,30}?)\s*(\([^)]*\))?\s*:\s*["“]?(.+?)["”]?$/);
      if (m && words(m[1]) <= 3) {
        if (!cur || cur.lines.length >= 2) cur = add("");
        const id = "L" + String(dialogue.length + 1).padStart(3, "0"), narr = /^(caption|narrator|narration|title)$/i.test(m[1]);
        dialogue.push({ line_id: id, speaker: narr ? "" : nameCase(m[1].trim()), text: norm(m[3]), kind: narr ? "caption" : "speech", mouth: narr ? "off" : "on" });
        cur.lines.push(id); cur.source_ids = cur.lines.slice();
      } else cur = add(ln);
    }
    if (!shots.length) add("");
    for (const s of shots) {
      const ls = s.lines.map((id) => dialogue.find((d) => d.line_id === id)), spoken = ls.reduce((a, d) => a + (d.kind === "speech" ? words(d.text) : 0), 0);
      if (ls.length) { if (s.scene_type !== "establishing") s.scene_type = "dialogue"; s.line_placement = ls.some((d) => d.mouth === "on") ? "on_speaker" : "voiceover"; }
      s.duration = durationFor(s.scene_type, spoken);
    }
    return { scene_id: opts.sceneId || "scene", title: opts.title || "", status: "DRAFT", made_from: { script: true, at: new Date().toISOString().slice(0, 10) },
      intent: { feel: "", peak: "", must_know: "" }, palette: [], lighting_mood: "", sound_plan: "", signature_gestures: {}, craft_checks: {}, dialogue, shots };
  }

  function movementOf(s) {
    let mv = s.movement || {};
    if (Array.isArray(mv)) { const o = {}; for (const m of mv) o[String(m).split(":")[0].trim()] = m; mv = o; }
    return mv;
  }
  const isClose = (f) => /close|ecu|\bcu\b/.test(f);

  /** Craft gate G1. Errors stop the plan from going to the author; warnings are worth a look. */
  function check(plan) {
    const errors = [], warnings = [], E = (shot, msg) => errors.push({ shot, msg }), W = (shot, msg) => warnings.push({ shot, msg });
    const shots = plan.shots || [], dialogue = plan.dialogue || [];
    const lines = new Map(dialogue.map((l) => [l.line_id, l])), order = dialogue.map((l) => l.line_id), used = [];
    for (const s of shots) {
      const id = s.shot_id || "?", t = s.scene_type;
      if (!(s.source_ids || []).length) E(id, "no source ids");
      if (!TARGETS[t]) E(id, "scene type must be one of " + Object.keys(TARGETS).join(", "));
      else { const [lo, hi] = TARGETS[t], d = +s.duration || 0; if (d < lo * 0.5 || d > hi * 2) W(id, `${d} s is far outside the ${t} target of ${lo} to ${hi} s`); }
      for (const l of s.lines || []) { if (!lines.has(l)) E(id, "unknown line " + l); used.push(l); }
      if ((s.lines || []).length && !PLACEMENTS.includes(s.line_placement)) E(id, "line placement must be one of " + PLACEMENTS.join(", "));
      if (s.comedy_face) {
        if (t !== "comedy") W(id, `comedy face on a ${t} shot; only light beats may use one`);
        if (!(s.interpretation || []).some((i) => /comedy/i.test(i))) E(id, "a comedy face must be listed as interpretation");
      }
      if (!Object.keys(s.expressions || {}).length) W(id, "no expressions named");
    }
    const missing = order.filter((l) => !used.includes(l)), dupes = [...new Set(used.filter((l, i) => used.indexOf(l) !== i))];
    if (missing.length) E(null, "lines never placed in a shot: " + missing.join(", "));
    if (dupes.length) E(null, "lines placed twice: " + dupes.join(", "));
    const a = used.filter((l) => order.includes(l)), b = order.filter((l) => used.includes(l));
    if (a.join() !== b.join()) E(null, "lines are out of script order across shots");
    if (!norm(plan.lighting_mood)) E(null, "no lighting mood for the scene");

    // craft gate: intent card, palette, sound plan, Aiden Guo + Kurosawa checks
    const it = plan.intent || {};
    for (const k of ["feel", "peak", "must_know"]) if (!norm(it[k])) E(null, `intent card: "${k.replace("_", " ")}" missing`);
    let pal = plan.palette || []; if (!Array.isArray(pal)) pal = pal.colours || [];
    if (pal.length < 4) E(null, "palette card needs 4 to 6 colours with roles");
    if (!norm(typeof plan.sound_plan === "string" ? plan.sound_plan : JSON.stringify(plan.sound_plan || ""))) E(null, "no sound plan (ambience, one focus sound per beat, silences, music)");
    const cc = plan.craft_checks || {};
    for (const k in CRAFT) if (!norm(cc[k])) E(null, `craft check "${k.replace(/_/g, " ")}" not answered (${CRAFT[k]})`);
    const seen = new Set();
    for (const s of shots) {
      const id = s.shot_id || "?", mv = movementOf(s);
      const got = LAYERS.filter((k) => norm(mv[k]) && !/^still/i.test(norm(mv[k])));
      got.forEach((k) => seen.add(k));
      if (got.length < 2) E(id, `movement: ${got.length ? got.join(", ") : "nothing"}; every shot needs 2 or more of ${LAYERS.join(", ")}`);
      if (got.length === 5) W(id, "all five movement layers in one shot (never all five)");
      if (/\bwind\b/i.test(norm(mv.environment)) && !s.outdoors) E(id, "wind on a shot not marked outdoors (no wind indoors)");
      if (s.effect && !s.cause) E(id, "an effect shot needs its cause");
      if (t(s) === "action") for (const k of ["cut_on", "entry_pose", "exit_pose"]) if (!s[k]) E(id, "action shot needs " + k.replace("_", " "));
      const cam = s.camera || {};
      if (cam.move && !/^(still|locked)$/i.test(cam.move) && !norm(cam.move_reason)) W(id, "camera move without a reason");
      if (!norm(s.book_verb)) W(id, "no book verb (what the source gives the person on screen to do)");
      // how this shot joins the one before (19 Nov X posts item 3): a hidden wipe needs what fills the frame; a join that moves needs a reason
      const k = shots.indexOf(s);
      if (s.join === "wipe" || s.join === "match") {
        if (!k) W(id, "the first shot has no shot before it to join");
        if (!norm(s.join_cover)) E(id, s.join === "wipe" ? "a hidden wipe needs what fills the frame (a back, a pillar, darkness)" : "a match move needs the movement both shots share");
        if (!norm(s.join_reason)) W(id, "a join that moves needs a reason (why hide this cut, or carry the move on)");
      }
      // a long take for talk (item 2): one 10 to 15 s clip with 3 to 5 beats
      if (s.long_take) { const d = +s.duration || 0, nb = String(s.beats || "").split("\n").filter((x) => x.trim()).length;
        if (d < 10 || d > 15) W(id, `a long take runs 10 to 15 s (this one is ${d} s)`);
        if (nb < 3 || nb > 5) W(id, `a long take has 3 to 5 beats (this one has ${nb})`); }
    }
    const notSeen = LAYERS.filter((k) => !seen.has(k));
    if (shots.length && notSeen.length) E(null, "the scene never uses movement layer(s): " + notSeen.join(", "));
    // coverage: same setup twice in a row, more than 3 uses of a setup
    const setup = (s) => (s.camera && s.camera.previs_cam) || null, counts = {};
    shots.forEach((s, i) => { const c = setup(s); if (!c || c === "none") return; (counts[c] = counts[c] || []).push(s.shot_id); if (i && setup(shots[i - 1]) === c) E(s.shot_id, `same camera setup ${c} as the shot before`); });
    for (const c in counts) if (counts[c].length > 3) E(null, `setup ${c} used ${counts[c].length} times (${counts[c].join(", ")}); 3 at most`);
    let run = 0, who = null;
    for (const l of dialogue) {
      if (l.mouth !== "on" && l.mouth !== "off") { E(null, `${l.line_id}: mouth on or off not set`); continue; }
      if (l.mouth === "off" && l.speaker === who) run++; else if (l.mouth === "off") { run = 1; who = l.speaker; } else { run = 0; who = null; }
      if (run > 3 && l.speaker) W(null, `${l.line_id}: more than 3 mouth-off lines in a row from ${who}; come back to the face`);
    }
    const framings = shots.map((s) => norm(s.camera && s.camera.framing).toLowerCase());
    const faces = framings.filter(isClose).length;
    if (shots.length && faces / shots.length > 0.6) W(null, `${faces} of ${shots.length} shots are face close-ups (not 99% faces)`);
    const firstClose = framings.findIndex((f) => /close|ecu/.test(f));
    if (firstClose > -1 && !framings.slice(0, firstClose).some((f) => /wide|establish|two|full|medium/.test(f))) W(null, "no wide or two-shot before the first close-up (geography first)");

    const durs = shots.map((s) => +s.duration || 0), stats = { shots: shots.length, seconds: round(durs.reduce((x, y) => x + y, 0)), median: round(median(durs) * 100) / 100 };
    if (durs.length >= 6) {
      const k = Math.floor(durs.length / 3), thirds = [durs.slice(0, k), durs.slice(k, 2 * k), durs.slice(2 * k)].map((x) => Math.round(mean(x) * 100) / 100);
      stats.thirds = thirds;
      if (thirds[2] > thirds[0]) W(null, "the last third is slower than the first (jo-ha-kyū: begin slow, end swift); intended?");
    }
    return { errors, warnings, stats, pass: !errors.length };
    function t(s) { return s.scene_type; }
  }

  // ---- Colour grade of a scene: the same sums in the player (an SVG filter) and in the exported video (ffmpeg) ----
  const GRADES = { "": { name: "None" }, warm: { name: "Warm", warm: 0.5, sat: 1.08 }, cool: { name: "Cool", warm: -0.5 }, punchy: { name: "Punchy", contrast: 0.3, sat: 1.25 }, soft: { name: "Soft", contrast: -0.25, sat: 0.85, bright: 0.08 }, night: { name: "Night", bright: -0.2, warm: -0.5, sat: 0.8, contrast: 0.1 }, bw: { name: "Black and white", sat: 0, contrast: 0.15 } };
  /** g: { bright -1..1, contrast -1..1, sat 0..2, warm -1..1 } -> null when it changes nothing, else { k (contrast slope around mid grey), m (3 rows of 3: saturation, warmth, brightness) } */
  function gradeOf(g) {
    g = g && typeof g === "object" ? g : {}; const lim = (v, a, b, d) => (isFinite(+v) && v !== "" && v != null ? Math.max(a, Math.min(b, +v)) : d);
    const b = lim(g.bright, -1, 1, 0), c = lim(g.contrast, -1, 1, 0), s = lim(g.sat, 0, 2, 1), w = lim(g.warm, -1, 1, 0);
    if (!b && !c && s === 1 && !w) return null;
    const L = [0.2126, 0.7152, 0.0722], gain = 1 + 0.5 * b, ch = [1 + 0.12 * w, 1, 1 - 0.12 * w], r4 = (x) => Math.round(x * 10000) / 10000;
    return { k: r4(1 + 0.5 * c), m: [0, 1, 2].map((i) => [0, 1, 2].map((j) => r4((L[j] * (1 - s) + (i === j ? s : 0)) * ch[i] * gain))) };
  }

  const api = { GRADES, gradeOf, draftFromPages, draftFromScript, check, leaves, TARGETS, PLACEMENTS, LAYERS, CRAFT };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else g.AnimePlan = api;
})(typeof window !== "undefined" ? window : globalThis);
