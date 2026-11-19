/* Panel director: every panel has a JOB and a WEIGHT, and the page layout is picked by weight, not by panel count alone.
 * (References A, B, H and J.)
 *
 *   JOBS            what a panel is for: establish | talk | act | react | insert | big
 *   weightOf(b)     a panel's weight 1..5 (given, or the usual one for its job)
 *   rate(rows, R)   what a layout is like: tiers, panels a tier, each panel's share of the page, even grid?, lined-up gutters?
 *   pick(panels, templates, R, opts)   the template that fits these panels' weights best -> { template, score, why }
 *   layout(panels, templates, R, opts) -> rows with the panels put in, in reading order (falls back to plain tiers)
 *   sorted(panels, templates, R, opts) -> every template with the same panel count, best fit first, each with its rating
 *
 * Pure geometry and counting: no models. Works in the browser (window.Director) and in Node (module.exports).
 * R is PageRender (page-editor/render.js), used for the real panel shapes, slants and nested rows included.
 */
(function (g) {
  "use strict";
  // The usual weight of each job, and what the Artist should draw behind it. "Connecting" panels (talk, react, insert) are the
  // light ones: a face or a hand on white, so the big panel has something to be bigger than (references G and L).
  const JOBS = {
    establish: { label: "Sets the place", weight: 4, bg: ["full"], connecting: false, hint: "Where we are and who is here. The one panel with the full background." },
    talk:      { label: "Carries the talk", weight: 2, bg: ["white", "tone", "simple"], connecting: true, hint: "A speaker and a line. No scenery: white or flat tone behind them." },
    act:       { label: "Something happens", weight: 3, bg: ["simple", "full", "tone"], connecting: false, hint: "A move, a hit, a hand-over: the picture carries it." },
    react:     { label: "A reaction", weight: 2, bg: ["white", "tone"], connecting: true, hint: "A face answering what just happened. Often silent. Nothing behind it." },
    insert:    { label: "A detail", weight: 1, bg: ["white", "tone"], connecting: true, hint: "A hand, an eye, an object. Small, on white." },
    big:       { label: "The big moment", weight: 5, bg: ["full", "tone", "simple", "white"], connecting: false, hint: "The page's biggest panel: one person, chest up, a short line." },
  };
  const jobOf = (b) => (b && JOBS[b.job] ? b.job : "");
  const clampW = (v) => Math.min(5, Math.max(1, Math.round(+v)));
  /** A panel's weight, 1 (a tiny beat) to 5 (the big moment). Old storyboards have none: a splash counts 5, the rest 3. */
  function weightOf(b) {
    if (!b) return 3;
    if (Number.isFinite(+b.weight) && +b.weight > 0) return clampW(b.weight);
    if (b.splash) return 5;
    return jobOf(b) ? JOBS[b.job].weight : 3;
  }

  function leaves(rows, out = []) { for (const r of rows || []) for (const q of r.panels || []) { if (q.rows && q.rows.length) leaves(q.rows, out); else out.push(q); } return out; }
  function area(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); }
  function shape(rows) { return JSON.stringify((rows || []).map((r) => [Math.round(r.h * 10), r.panels.map((q) => (q.rows ? ["c", JSON.parse(shape(q.rows))] : Math.round((q.w || 1) * 10)))])); }

  /** What a layout is like. Shares are of the page's panel area, in reading order. */
  function rate(rows, R) {
    const G = R.layoutGeom({ rows }), cells = G.cells, areas = cells.map((c) => area(c.poly)), total = areas.reduce((a, b) => a + b, 0) || 1;
    const shares = areas.map((a) => a / total), sorted = shares.slice().sort((a, b) => b - a);
    const counts = (rows || []).map((r) => r.panels.length), flat = (rows || []).every((r) => r.panels.every((q) => !q.rows));
    // an even grid: two or more tiers, the same number of panels (2+) in each, every panel about the same size, gutters upright
    const even = flat && rows.length >= 2 && counts[0] >= 2 && counts.every((c) => c === counts[0]) && sorted[0] < sorted[sorted.length - 1] * 1.18;
    // upright gutters that line up from one tier to the next (within 1.4% of the page width where the two tiers meet)
    let aligned = 0;
    const top = G.colLines.filter((L) => L.path.length === 0);
    for (let r = 0; r + 1 < (rows || []).length; r++) {
      const a = top.filter((L) => L.r === r), b = top.filter((L) => L.r === r + 1);
      for (const La of a) if (b.some((Lb) => Math.abs(La.p1[0] - Lb.p0[0]) < 14)) aligned++;
    }
    const big = sorted.length > 1 ? sorted[0] >= 0.34 && sorted[0] >= sorted[1] * 1.4 : true; // one panel that owns the page
    const tierOf = flat ? [].concat(...counts.map((c, r) => Array(c).fill(r))) : null; // which tier each panel is in (plain rows only)
    return { n: cells.length, tiers: (rows || []).length, counts, tierOf, shares, aspect: cells.map((c) => (c.bbox[2] - c.bbox[0]) / (c.bbox[3] - c.bbox[1])), even, aligned, big, largest: shares.indexOf(sorted[0]), shape: shape(rows) };
  }

  const WIDE = /wide|establish|overhead|two-shot|group|landscape/i, TALL = /full figure|full-figure|full body|standing|tall/i;
  /** How badly a rated layout fits these panels (0 = perfect). Lower is better. */
  function misfit(panels, rt, opts) {
    const ws = panels.map((q) => weightOf(q.board || q)), sum = ws.reduce((a, b) => a + b, 0) || 1, want = ws.map((w) => w / sum);
    let s = 0; const why = [];
    for (let i = 0; i < want.length; i++) s += Math.abs(want[i] - rt.shares[i]);
    const top = Math.max(...ws), heavy = ws.map((w, i) => (w === top ? i : -1)).filter((i) => i >= 0);
    if (heavy.length === 1 && rt.largest !== heavy[0]) { s += 0.6; why.push("the heaviest panel is not the biggest"); }
    if (heavy.length === 1 && top >= 4 && !rt.big) { s += 0.25; why.push("no panel owns the page"); }
    if (heavy.length === 1 && top >= 4 && rt.n >= 4 && rt.tierOf && rt.counts[rt.tierOf[heavy[0]]] > 1) { s += 0.2; why.push("the heaviest panel shares its tier"); }
    if (rt.even) { s += 1; why.push("an even grid"); }
    if (rt.aligned) { s += 0.35 * rt.aligned; why.push("upright gutters line up"); }
    if (opts && opts.avoid && opts.avoid.includes(rt.shape)) { s += 2; why.push("the same layout as a page beside it"); }
    if (rt.n >= 4) s += 0.08 * Math.abs(rt.tiers - 3); // about five panels in three tiers is the plain page
    panels.forEach((q, i) => { const shot = String((q.board || q).shot || "");
      if (WIDE.test(shot) && rt.aspect[i] < 1.15) s += 0.15; // a wide view wants a wide panel
      if (TALL.test(shot) && rt.aspect[i] > 1.1) s += 0.15; }); // a standing figure wants a tall one
    return { score: s, why };
  }
  const cache = new WeakMap();
  function rated(t, R) { if (!cache.has(t)) cache.set(t, rate(t.rows, R)); return cache.get(t); }

  /** A template's rows with the sizes pulled toward these panels' weights: the template gives the build (tiers, panels a tier,
   * slants), the weights give the proportions. A tier's height follows the weight it holds, a panel's width its own weight;
   * both are blended with the template's own sizes and kept above a floor so nothing becomes a sliver. Nested layouts are left as drawn. */
  function tune(rows, panels) {
    if (!(rows || []).every((r) => r.panels.every((q) => !q.rows))) return rows;
    const K = 0.65, norm = (xs) => { const t = xs.reduce((a, b) => a + b, 0) || 1; return xs.map((x) => x / t); };
    const floor = (xs, lo) => { let ys = norm(xs); for (let n = 0; n < 4; n++) ys = norm(ys.map((y) => Math.max(y, lo))); return ys; };
    let i = 0; const ws = rows.map((r) => r.panels.map(() => weightOf((panels[i++] || {}).board || panels[i - 1] || {})));
    if (new Set([].concat(...ws)).size < 2) return rows; // no panel is heavier than another: the layout keeps its own sizes
    const th = norm(rows.map((r) => r.h || 1)), wh = norm(ws.map((r) => r.reduce((a, b) => a + b, 0)));
    const hs = floor(th.map((t, k) => (1 - K) * t + K * wh[k]), Math.min(0.14, 0.6 / rows.length));
    return rows.map((r, k) => {
      const tw = norm(r.panels.map((q) => q.w || 1)), ww = norm(ws[k]), out = floor(tw.map((t, j) => (1 - K) * t + K * ww[j]), Math.min(0.22, 0.7 / r.panels.length));
      return Object.assign({}, r, { h: Math.round(hs[k] * 1000) / 1000, panels: r.panels.map((q, j) => Object.assign({}, q, { w: Math.round(out[j] * 1000) / 1000 })) });
    });
  }

  /** Every template with this many panels, best fit first (each sized to these panels' weights). */
  function sorted(panels, templates, R, opts) {
    const n = panels.length, out = [], seen = new Set();
    for (const t of templates || []) {
      if (rated(t, R).n !== n) continue;
      const rows = tune(t.rows, panels), rt = rate(rows, R), m = misfit(panels, rt, opts);
      for (const a of rt.aspect) if (a < 0.42 || a > 3.4) m.score += 0.2; // a sliver
      if (seen.has(rt.shape + JSON.stringify(rows.map((r) => [r.slant || 0, r.panels.map((q) => q.slant || 0)])))) continue; // the same layout under another code
      seen.add(rt.shape + JSON.stringify(rows.map((r) => [r.slant || 0, r.panels.map((q) => q.slant || 0)])));
      out.push({ template: t, rows, rating: rt, score: m.score, why: m.why });
    }
    return out.sort((a, b) => a.score - b.score);
  }
  function pick(panels, templates, R, opts) { return sorted(panels, templates, R, opts)[0] || null; }

  /** Plain tiers by weight, for a panel count no template has: heavy panels get a tier of their own, light ones share. */
  function tiers(panels) {
    const rows = []; let cur = [];
    const flush = () => { if (cur.length) { rows.push(cur); cur = []; } };
    for (const q of panels) { const w = weightOf(q.board || q);
      if (w >= 4) { flush(); rows.push([q]); } else { cur.push(q); if (cur.length === (w <= 1 ? 3 : 2)) flush(); } }
    flush();
    return rows.map((r, i) => ({ h: Math.max(...r.map((q) => weightOf(q.board || q))) + (r.length === 1 ? 1 : 0), panels: r.map((q, k) => Object.assign({}, q, { w: weightOf(q.board || q) + ((i + k) % 2 ? 0.35 : 0) })) }));
  }

  /** Rows for these panels (in reading order), each panel object kept, with its width set by the layout. */
  function layout(panels, templates, R, opts) {
    if (!panels.length) return { rows: [], code: "" };
    const best = pick(panels, templates, R, opts);
    if (!best) return { rows: tiers(panels), code: "tiers", score: null, why: ["no ready-made layout has " + panels.length + " panels"] };
    let i = 0;
    const build = (rows) => rows.map((r) => Object.assign({ h: r.h }, r.slant ? { slant: r.slant } : {}, { panels: r.panels.map((q) => {
      if (q.rows) return Object.assign({ w: q.w }, q.slant ? { slant: q.slant } : {}, { rows: build(q.rows) });
      const o = Object.assign({}, panels[i++], { w: q.w }); if (q.slant) o.slant = q.slant; else delete o.slant; return o; }) }));
    return { rows: build(best.rows), code: best.template.code, score: best.score, why: best.why };
  }

  const api = { JOBS, jobOf, weightOf, rate, misfit, tune, sorted, pick, layout, tiers, shape, leaves, area };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else g.Director = api;
})(typeof window !== "undefined" ? window : globalThis);
