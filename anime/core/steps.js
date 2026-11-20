/* The Assistant's shot-level steps on the anime scene screen (20 Nov 2026): each changes only the shots it names, at once.
 * Every function takes the plan and the step's arguments, changes the plan in place and returns { shot, msg }:
 * the shot to show, and one plain sentence of what really changed. It throws (and changes nothing) when the step cannot run.
 * The spoken lines are the script's own words: no step here rewrites, adds or drops one; they only stay with a shot or move with it.
 * Runs in the browser (window.AnimeSteps) and in node (require), so the same code is tested without a screen.
 */
(function (g) {
  "use strict";
  const str = (v) => String(v == null ? "" : v).trim();
  const r2 = (x) => Math.round(x * 100) / 100, sec = (x) => r2(x) + " s";
  const JOINS = { cut: "", "": "", wipe: "wipe", match: "match" }, JOIN_NAME = { "": "a cut", wipe: "a hidden wipe", match: "a match move" };

  /** Where a shot is. Throws when there is none, with the shots there are. */
  function idx(plan, id) {
    const s = str(id).replace(/^shot\s+/i, ""), shots = (plan && plan.shots) || [], i = shots.findIndex((x) => x.shot_id === s);
    if (i < 0) throw new Error(`There is no shot "${str(id)}" in this scene.` + (shots.length && shots.length <= 40 ? ` Its shots: ${shots.map((x) => x.shot_id).join(", ")}.` : ""));
    return i;
  }
  /** "" when the shot is there, else why not: for the greyed button. */
  const has = (plan, id) => { try { idx(plan, id); return ""; } catch (e) { return e.message; } };
  function newId(plan, base) {
    const ids = new Set(plan.shots.map((s) => s.shot_id)), root = String(base).replace(/[a-z]+$/, "");
    for (const c of "bcdefghijklmnopqrstuvwxyz") if (!ids.has(root + c)) return root + c;
    let n = 2; while (ids.has(root + "-" + n)) n++; return root + "-" + n;
  }
  const yes = (v) => (v === true || /^(yes|on|true|1)$/i.test(str(v)) ? true : v === false || /^(no|off|false|0)$/i.test(str(v)) ? false : null);
  const hasClip = (s) => !!s.clip;

  /** Change what a shot shows, how it is framed, how the camera moves (and why), its type or its length. Never its lines. */
  function edit(plan, a, types) {
    const i = idx(plan, a.shot), s = plan.shots[i], done = [];
    const cam = () => (s.camera = s.camera && typeof s.camera === "object" ? s.camera : {});
    if (str(a.action) && str(a.action) !== str(s.action)) { s.action = str(a.action).slice(0, 2000); done.push("what happens"); }
    if (str(a.framing) && str(a.framing) !== str(s.camera && s.camera.framing)) { cam().framing = str(a.framing).slice(0, 120); done.push("the framing"); }
    if (str(a.move) && str(a.move) !== str(s.camera && s.camera.move)) { cam().move = str(a.move).slice(0, 120); done.push("the camera move"); }
    if (str(a.move_reason) && str(a.move_reason) !== str(s.camera && s.camera.move_reason)) { cam().move_reason = str(a.move_reason).slice(0, 200); done.push("the reason for the move"); }
    if (str(a.type)) { const t = str(a.type).toLowerCase(); if (types && !types.includes(t)) throw new Error(`"${str(a.type)}" is not a shot type. The types: ${types.join(", ")}.`); if (s.scene_type !== t) { s.scene_type = t; done.push("its type"); } }
    if (a.seconds != null && str(a.seconds) !== "") {
      const d = r2(+a.seconds); if (!(d >= 0.2 && d <= 60)) throw new Error("A shot's length is 0.2 to 60 seconds.");
      if (d !== r2(+s.duration || 0)) { s.duration = d; done.push(`its length (${sec(d)})`); }
    }
    if (!done.length) return { shot: s.shot_id, msg: `Nothing to change on shot ${s.shot_id}: it already says that.`, same: true };
    const stale = done.some((d) => /happens|framing/.test(d)) && s.still, clipShort = s.clip && +s.clip_dur > 0 && (+s.duration || 0) > +s.clip_dur - (+s.clip_from || 0) + 0.05;
    return { shot: s.shot_id, msg: `Shot ${s.shot_id}: changed ${done.join(", ")}. Its lines are untouched.${stale ? " The picture is the old one until it is drawn again." : ""}${clipShort ? " Its video clip is shorter than the shot now." : ""}` };
  }

  /** One shot becomes two, one after the other. The time is shared (half each, or `seconds` for the first). Lines stay on the first
   *  shot, or from `line` on they go to the second. Both keep the picture; a video clip stays with the first only. */
  function split(plan, a) {
    const i = idx(plan, a.shot), s = plan.shots[i], total = +s.duration || 2, lines = s.lines || [];
    if (total < 0.4) throw new Error(`Shot ${s.shot_id} is ${sec(total)}: too short to split.`);
    let first = r2(total / 2);
    if (a.seconds != null && str(a.seconds) !== "") { first = r2(+a.seconds); if (!(first >= 0.2 && first <= total - 0.2)) throw new Error(`The first part's length must leave both parts 0.2 s or more (shot ${s.shot_id} is ${sec(total)}).`); }
    let k = lines.length;
    if (str(a.line)) { k = lines.indexOf(str(a.line)); if (k < 0) throw new Error(`Shot ${s.shot_id} has no line "${str(a.line)}".` + (lines.length ? ` Its lines: ${lines.join(", ")}.` : " It has no lines.")); }
    const c = JSON.parse(JSON.stringify(s)); c.shot_id = newId(plan, s.shot_id);
    for (const f of ["clip", "clip_dur", "clip_from", "clip_sound", "clip_poster", "clip_takes", "clip_speed", "join", "join_cover", "join_reason", "long_take", "beats", "tin", "tin_dur", "video_note", "draw_note"]) delete c[f];
    if (s.clip_poster && c.still === s.clip_poster) c.still = "";
    c.lines = lines.slice(k); s.lines = lines.slice(0, k);
    if (c.lines.length) c.line_placement = s.line_placement || "on_speaker"; else delete c.line_placement;
    if (!s.lines.length) delete s.line_placement;
    if (s.tout) { c.tout = s.tout; if (s.tout_dur != null) c.tout_dur = s.tout_dur; delete s.tout; delete s.tout_dur; } // the fade out belongs to the end
    s.duration = first; c.duration = r2(total - first);
    c.source_ids = (s.source_ids || []).slice(); c.interpretation = ["VISUAL_INTERPRETATION: split from " + s.shot_id];
    plan.shots.splice(i + 1, 0, c);
    const lost = s.long_take ? " The first part keeps the Long take tick: check its length." : "";
    return { shot: c.shot_id, msg: `Shot ${s.shot_id} is now two shots: ${s.shot_id} (${sec(s.duration)}, ${s.lines.length} line${s.lines.length === 1 ? "" : "s"}) and the new ${c.shot_id} (${sec(c.duration)}, ${c.lines.length} line${c.lines.length === 1 ? "" : "s"}). ${c.shot_id} says the same as ${s.shot_id} until you change it.${s.clip ? ` The video clip stays on ${s.shot_id}.` : ""}${lost}` };
  }

  /** A shot and the shot after it become one: the lengths add up, the lines follow each other, both actions are kept.
   *  The first shot's picture and settings are the ones kept. Refused when either has a video clip (a made video would no longer fit). */
  function join(plan, a) {
    const i = idx(plan, a.shot), s = plan.shots[i], n = plan.shots[i + 1];
    if (!n) throw new Error(`Shot ${s.shot_id} is the last shot: there is no shot after it to join with.`);
    const clips = [s, n].filter(hasClip).map((x) => x.shot_id);
    if (clips.length) throw new Error(`Shot${clips.length > 1 ? "s" : ""} ${clips.join(" and ")} ${clips.length > 1 ? "have" : "has"} a video clip, and a made video would not fit the joined shot. Remove the clip first, or change the shots' lengths instead.`);
    const lost = n.still && n.still !== s.still;
    s.duration = r2((+s.duration || 0) + (+n.duration || 0));
    s.lines = (s.lines || []).concat(n.lines || []); if (s.lines.length && !s.line_placement) s.line_placement = n.line_placement || "on_speaker";
    const an = str(n.action); if (an && an !== str(s.action)) s.action = [str(s.action), an].filter(Boolean).join(" Then: ");
    if (!s.still && n.still) s.still = n.still;
    s.source_ids = [...new Set((s.source_ids || []).concat(n.source_ids || []))];
    if (n.tout) { s.tout = n.tout; if (n.tout_dur != null) s.tout_dur = n.tout_dur; } else { delete s.tout; delete s.tout_dur; } // the joined shot ends as the second one did
    plan.shots.splice(i + 1, 1);
    return { shot: s.shot_id, msg: `Shots ${s.shot_id} and ${n.shot_id} are now one shot, ${s.shot_id}: ${sec(s.duration)}, ${s.lines.length} line${s.lines.length === 1 ? "" : "s"}. ${plan.shots.length} shots in the scene.${lost ? ` ${n.shot_id}'s picture is no longer used.` : ""}` };
  }

  /** A shot changes places with the one before or after it. Refused when both carry lines: the script's order would break. */
  function move(plan, a) {
    const i = idx(plan, a.shot), s = plan.shots[i], to = str(a.to).toLowerCase(), early = /^(earlier|before|up|prev)/.test(to);
    if (!early && !/^(later|after|down|next)/.test(to)) throw new Error('"to" is earlier or later.');
    const j = early ? i - 1 : i + 1, o = plan.shots[j];
    if (!o) throw new Error(`Shot ${s.shot_id} is already the ${early ? "first" : "last"} shot.`);
    if ((s.lines || []).length && (o.lines || []).length) throw new Error(`Shots ${s.shot_id} and ${o.shot_id} both carry lines: changing their places would put the script out of order.`);
    plan.shots[i] = o; plan.shots[j] = s;
    const first = plan.shots[0], note = [];
    for (const x of [s, o]) if (x.join) note.push(`${x.shot_id} joins the shot before it with ${JOIN_NAME[x.join] || "a cut"}: check that it still fits`);
    if (first.join) { delete first.join; delete first.join_cover; delete first.join_reason; note.push(`${first.shot_id} is first now, so its join is back to a cut`); }
    return { shot: s.shot_id, msg: `Shot ${s.shot_id} now plays ${early ? "before" : "after"} ${o.shot_id}.${note.length ? " " + note.join("; ") + "." : ""}` };
  }

  /** How a shot's video joins the shot before: a cut, a hidden wipe (what fills the frame) or a match move (the movement both share). */
  function setJoin(plan, a) {
    const i = idx(plan, a.shot), s = plan.shots[i], asked = str(a.how).toLowerCase().replace(/^hidden[\s_-]*/, "").replace(/[\s_-]*move$/, "");
    if (!(asked in JOINS)) throw new Error('"how" is cut, wipe (a hidden wipe) or match (a match move).');
    const how = JOINS[asked];
    if (how && !i) throw new Error(`Shot ${s.shot_id} is the first shot: it has no shot before it to join.`);
    if (!how) {
      if (!s.join) return { shot: s.shot_id, msg: `Shot ${s.shot_id} already joins the shot before it with a cut. Nothing changed.`, same: true };
      delete s.join; delete s.join_cover; delete s.join_reason;
      return { shot: s.shot_id, msg: `Shot ${s.shot_id} now joins ${plan.shots[i - 1].shot_id} with a plain cut.` };
    }
    const cover = str(a.cover) || (s.join === how ? str(s.join_cover) : ""), reason = str(a.reason) || (s.join === how ? str(s.join_reason) : "");
    if (!cover) throw new Error(how === "wipe" ? "A hidden wipe needs what fills the frame (a back, a pillar, darkness): give it as cover." : "A match move needs the movement both shots share: give it as cover.");
    if (s.join === how && str(s.join_cover) === cover && str(s.join_reason) === reason) return { shot: s.shot_id, msg: `Shot ${s.shot_id} already joins that way. Nothing changed.`, same: true };
    s.join = how; s.join_cover = cover.slice(0, 200); if (reason) s.join_reason = reason.slice(0, 200); else delete s.join_reason;
    return { shot: s.shot_id, msg: `Shot ${s.shot_id} now joins ${plan.shots[i - 1].shot_id} with ${JOIN_NAME[how]}: ${s.join_cover}.${reason ? "" : " No reason is given yet: the plan check asks for one."} Videos already made of the two shots do not have it.` };
  }

  /** The Long take tick: one 10 to 15 s clip with 3 to 5 beats, for talk. */
  function longTake(plan, a) {
    const i = idx(plan, a.shot), s = plan.shots[i], on = yes(a.on);
    if (on === null) throw new Error('"on" is yes or no.');
    if (!!s.long_take === on) return { shot: s.shot_id, msg: `Shot ${s.shot_id} is ${on ? "already a long take" : "not a long take"}. Nothing changed.`, same: true };
    if (on) s.long_take = true; else delete s.long_take;
    const d = +s.duration || 0, beats = str(s.beats).split("\n").filter((x) => x.trim()).length;
    const need = on ? [d < 10 || d > 15 ? `it is ${sec(d)} and a long take runs 10 to 15 s` : "", beats < 3 || beats > 5 ? `it has ${beats} beat${beats === 1 ? "" : "s"} and wants 3 to 5 (the Beats box)` : ""].filter(Boolean) : [];
    return { shot: s.shot_id, msg: `Shot ${s.shot_id} is ${on ? "now a long take" : "no longer a long take"}.${need.length ? " Still to do: " + need.join("; ") + "." : ""}` };
  }

  const api = { idx, has, edit, split, join, move, setJoin, longTake, JOIN_NAME };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else g.AnimeSteps = api;
})(typeof window !== "undefined" ? window : globalThis);
