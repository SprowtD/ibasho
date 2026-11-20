/* Artist: a storyboard page -> a text-free art brief for an image model (whole page at once, drawn to a layout guide),
 * using the series bible (approved style text, cast descriptions and reference sheets).
 * brief(page, spec, bible, R, measureText) -> { prompt, attach: [{path, role}], panels: [...], cast: [...] }
 * Clear space for lettering comes from where the Letterer plans to put each balloon on the storyboard.
 */
(function (g) {
  "use strict";
  const posWord = (fx, fy) => {
    const v = fy < 0.34 ? "top" : fy > 0.66 ? "bottom" : "", h = fx < 0.34 ? "left" : fx > 0.66 ? "right" : "centre";
    if (!v) return h === "centre" ? "centre" : `${h} side`;
    return `${v} ${h}`;
  };
  const SIZE = { close: "close-up, head and shoulders large in the frame", medium: "medium shot, waist up", wide: "small in the frame, full figure", tiny: "very small in the frame" };
  const FACING = { left: "facing left", right: "facing right", camera: "facing the viewer", away: "seen from behind", down: "looking down", up: "looking up" };
  const BG_BW = { full: "Background: the place, drawn in a few quick thin ruler lines, mostly white.", simple: "Simple background: a hint of the place, mostly white.",
    tone: "Background: one light flat dot screentone, no details.", white: "Plain white background." };

  // The Toner (19 Nov 2026): when the series has its screentone made by code, the Artist draws FLAT GREYS and no dots.
  // The dots are laid over afterwards at the page's final size, one line count for the whole chapter, so nothing clashes.
  const TONER_RULE = "TONE, IMPORTANT: draw NO screentone, NO halftone dots, NO dot or line patterns and no hatching used as shading. Wherever a tone belongs (hair, clothes, a shadow, a wall, the sky), fill that area with ONE FLAT, EVEN GREY: light, middle or dark. Keep each grey area clean and closed by its outline. A soft shade from light to dark is allowed only where the picture truly needs one (a floor falling into shadow). Solid black stays solid black, white stays white paper. The studio lays the real screentone over the greys afterwards.";
  const byToner = (bible, text) => { const on = !!(bible && bible.tone_by === "toner" && !bible.colour); return text == null ? on : on ? String(text).replace(BG_BW.tone, "Background: one light, flat, even grey, no details.") : text; };

  function where(c, W, H) {
    const [x0, y0, x1, y1] = c.bbox, cx = (x0 + x1) / 2 / W, cy = (y0 + y1) / 2 / H, w = (x1 - x0) / W, h = (y1 - y0) / H;
    const vert = cy < 0.36 ? "top" : cy > 0.64 ? "bottom" : "middle", horiz = w > 0.8 ? "full width" : cx < 0.4 ? "left" : cx > 0.6 ? "right" : "centre";
    const shape = w > 0.8 && h < 0.3 ? "wide strip" : h > w * 1.6 ? "tall" : w > h * 1.6 ? "wide" : "";
    return [shape, horiz === "full width" ? `across the ${vert}` : `${vert} ${horiz}`].filter(Boolean).join(", ");
  }

  /** One panel in words: shot, background, who is where, the action, and the clear space the Letterer needs. */
  // background wording for colour series (the black-and-white wording speaks of dot tone and white paper)
  // never plain white in colour: an empty white panel looks unfinished beside painted ones (19 Nov 2026)
  const BG_COLOUR = { full: "Background: the place, fully drawn in this style.", simple: "Simple background: the place behind, softly out of focus, in the same light and colours as the rest of the scene. Never a plain white or empty background.",
    tone: "Background: the place behind, very soft and out of focus, in the scene's own light and colours. Never plain white.", white: "Background: the place behind, very soft and out of focus, in the scene's own light and colours. Never plain white." };
  /** Which way the page reads, in words for the image model (only said for right to left: left to right is what a model assumes). */
  const readsRtl = (page, R) => !!(page && page.layout && page.layout.rtl);
  const RTL_PANEL = "READING DIRECTION: this panel belongs to a page that is read RIGHT TO LEFT, like a Japanese manga. Draw every person on the side of the picture given for them (left means the viewer's left) and never mirror the picture: the person on the right is the one the reader meets first.";
  // Manga flow (19 Nov 2026, references G and H): how much is drawn follows the panel's job, and faces are calm unless the
  // storyboard spends the page's one big expression here. Only said for storyboards that give panels a job, so the prompts of
  // chapters made before this are word for word what they were.
  const DENSITY = {
    establish: "DENSITY: this panel sets the place. It is the one panel of the page that is drawn fully: the room or the street, where everyone stands, depth.",
    act: "DENSITY: the action is the picture. Draw the people and the one thing they do clearly; keep the surroundings to a few lines.",
    talk: "DENSITY: a connecting panel. Draw ONLY the speaker, head and shoulders, {PAPER}: no room, no furniture, no props that are not named above. Few lines, plenty of open space.",
    react: "DENSITY: a connecting panel. Draw ONLY the face (or the hand) that reacts, {PAPER}: no room, no furniture, no props. Few lines, plenty of open space.",
    insert: "DENSITY: a detail panel. Draw ONLY the one thing named, large, {PAPER}. Nothing else in the picture.",
    big: "DENSITY: the big moment of the page. One person, framed from the chest up, drawn with care and weight; everything else kept simple so the eye goes straight to the face.",
  };
  const CALM = "EXPRESSION: calm and small. The feeling shows in the eyes and the set of the mouth, not in a shout, tears, sweat drops or a comedy face.";
  const BIGFACE = "EXPRESSION: this is the ONE big expression of the page: let it be big (the open mouth, the tears, the comedy face), because every other panel is calm.";
  function describe(c, placed, R, named, colour) {
    const W = R.W, H = R.H, b = c.panel.board || {}, shot = b.shot || "medium", BG = colour ? BG_COLOUR : BG_BW;
    let s = `${cap(shot)}${/shot$|insert|flash|diagram|figure/.test(shot) ? "" : " shot"}${b.angle && b.angle !== "eye level" ? ", " + b.angle : ""}. `;
    s += (BG[b.bg] || BG.simple) + " ";
    for (const w of b.who || []) s += `${w.name.toUpperCase()} at the ${posWord(w.at[0], w.at[1])} of the panel, ${SIZE[w.size] || SIZE.medium}, ${FACING[w.facing] || "facing the viewer"}. `;
    s += b.action || "";
    if (b.splash) s += " THIS IS THE SPLASH PANEL, the big moment of the page: design it as one bold image. The main figure is large and pushes toward the viewer from a strong angle, with a clear silhouette; weight comes from big simple shapes of dark against open light, not from more detail; everything else in the picture is kept simple so the eye goes straight to the figure.";
    if (c.bbox && c.bbox[2] - c.bbox[0] > W * 0.88 && c.bbox[3] - c.bbox[1] > H * 0.88) s += c.panel.type === "bleed"
      ? " THIS PICTURE IS THE WHOLE PAGE, printed to the page's edges with no border: an upright page-shaped picture (2 wide by 3 tall). Faces, hands and anything that must be read stay a clear margin in from every edge, because the outer edge may be trimmed; the picture itself still runs right to the edges."
      : " THIS PANEL IS THE WHOLE PAGE: an upright page-shaped picture (2 wide by 3 tall), composed as one image for the full page.";
    if (!(b.who || []).length && !/wide|establish|diagram/.test(shot)) s += named && named.length
      ? ` EXTREME CLOSE-UP of only what is described, filling the frame. NO FACE: no head, no neck, no shoulders and no chest anywhere in the picture; ${named.join(" and ")} is cropped off at the forearms.`
      : " NO PEOPLE in this panel: no faces and no figures, only what is described; a hand may enter the frame if the action needs it.";
    if (b.job && DENSITY[b.job]) {
      s += " " + DENSITY[b.job].replace("{PAPER}", colour ? "against a soft, out-of-focus wash of the scene's own colours (colour pages are never left plain white)" : "on empty paper");
      if ((b.who || []).length) s += " " + (b.face === "big" || (b.lines || []).some((l) => l.kind === "shout") ? BIGFACE : CALM);
    }
    { const D = typeof module !== "undefined" && module.exports ? require("./director.js") : g.Director; // the camera follows the feeling
      if (b.tension && D && D.TENSION && D.TENSION[b.tension]) s += " " + D.TENSION[b.tension].camera; }
    if (b.art) s += " " + b.art;
    const ia = c.panel.inart || {}; // lettering that belongs to the drawing itself, asked for by the person on this panel
    if (b.sfx && !ia.sfx) s += `\nA sound effect ("${b.sfx}") is lettered over this picture afterwards, in huge letters. Draw NO sound-effect letters yourself, and keep one area of the picture simple (open air, floor, a plain wall) so the letters have somewhere to sit.`;
    if (ia.sfx) s += `\nSOUND EFFECT, the one exception to the no-text rule: hand-draw the sound effect "${ia.sfx}" into the picture as part of the art, in bold manga sound-effect lettering, beside the thing that makes the sound. No other writing.`;
    if (ia.writing) s += `\nWRITING IN THE PICTURE, an exception to the no-text rule: this writing is hand-drawn as part of the art, on the sign, note or screen the panel shows, spelled exactly, letter by letter: "${ia.writing}". No other writing.`;
    const mine = placed.filter((t) => t.panel === c.panel.id);
    if (mine.length) {
      const [x0, y0, x1, y1] = c.bbox;
      const spots = mine.map((t) => posWord((t.at[0] * W - x0) / (x1 - x0), (t.at[1] * H - y0) / (y1 - y0)));
      const words = mine.reduce((a, t) => a + R.plain(t.text).split(/\s+/).filter(Boolean).length, 0);
      s += `\nCLEAR SPACE FOR LETTERING: keep the ${[...new Set(spots)].join(" and the ")} of this panel plain, with no faces or key hands, for ${words} word${words === 1 ? "" : "s"} of type.`;
    }
    return s;
  }
  function castOf(cells) {
    const cast = [];
    for (const c of cells) for (const w of (c.panel.board && c.panel.board.who) || []) if (!cast.includes(w.name)) cast.push(w.name);
    for (const c of cells) for (const l of (c.panel.board && c.panel.board.lines) || []) if (l.speaker && !l.off && !cast.includes(l.speaker)) cast.push(l.speaker);
    return cast;
  }

  /** One panel drawn as its own picture (the editor's "Generate" on a panel).
   * opts.noRefLine = leave out the "INPUT REFERENCES" line (the editor adds it from the person's own list of references).
   * opts.own = the user's own description, used in place of the storyboard's; opts.bare = send only opts.own, no series style or cast.
   * -> { prompt, refs: [cast names with a reference sheet], size: [w, h], cast } */
  function panelBrief(page, panelId, spec, bible, R, measureText, opts) {
    opts = opts || {};
    const cells = R.allPanels(page.layout), c = cells.find((q) => q.panel.id === panelId);
    if (!c) return null;
    const [x0, y0, x1, y1] = c.bbox, ar = (x1 - x0) / (y1 - y0);
    const size = ar > 1.25 ? [1536, 1024] : ar < 0.8 ? [1024, 1536] : [1024, 1024];
    if (opts.bare) return { prompt: (opts.own || "").trim(), refs: [], size, cast: [] };
    const cast = castOf([c]), said = `${(c.panel.board || {}).action || ""} ${(c.panel.board || {}).art || ""} ${opts.own || ""}`.toLowerCase();
    const named = []; // named in the action only (a hands insert still needs the right sleeves, but a face sheet would pull a portrait)
    const flat = (s) => String(s).toLowerCase().replace(/[’‘]/g, "'"); // curly and straight apostrophes are the same
    const sayIn = (text, n) => new RegExp("(^|[^a-z])" + flat(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z]|$)").test(flat(text));
    const says = (n) => sayIn(said, n); // whole words: "Ron" is not in "front"
    // only a panel with nobody in frame (a hands insert) borrows people named in its action: "Dudley's jumper" or "Madam Malkin's shop" puts nobody in the picture
    if (!cast.length) for (const n of Object.keys(bible.cast)) if (!cast.includes(n) && says(n)) { cast.push(n); named.push(n); }
    // a book's cast can be dozens of people: only warn the model off those who are in this chapter
    const here = new Set(); for (const pg of spec.pages || []) if (pg.layout) for (const n of castOf(R.allPanels(pg.layout))) here.add(n);
    const absent = Object.keys(bible.cast).filter((n) => !cast.includes(n) && here.has(n));
    // places and props from the series settings, when the panel's description names them
    const things = []; for (const [kind, field] of [["place", "places"], ["prop", "props"]]) for (const n of Object.keys(bible[field] || {})) if (says(n)) things.push({ kind, name: n, desc: bible[field][n].desc || "", sheet: !!bible[field][n].sheet });
    // a place is named once (the panel where they walk in) and then the scene stays there: a panel that names no place keeps the last one named before it in the chapter
    const placeNames = (text) => Object.keys(bible.places || {}).filter((n) => [n].concat(bible.places[n].also || []).some((a) => sayIn(text, a)));
    for (const n of placeNames(said)) if (!things.some((x) => x.name === n)) things.push({ kind: "place", name: n, desc: bible.places[n].desc || "", sheet: !!bible.places[n].sheet });
    if (!things.some((x) => x.kind === "place") && !/recollection|memory|remembers|imagin|flashback/i.test(said)) { // a memory is somewhere else
      let last = null;
      outer: for (const pg of spec.pages || []) { if (!pg.layout) continue;
        for (const q of R.allPanels(pg.layout)) { if (q.panel.id === panelId) break outer; const b = q.panel.board || {}; const n = placeNames(`${b.action || ""} ${b.art || ""}`); if (n.length) last = n[n.length - 1]; } }
      if (last) things.push({ kind: "place", name: last, desc: bible.places[last].desc || "", sheet: !!bible.places[last].sheet, carried: true });
    }
    const places = things.filter((t) => t.kind === "place" && t.desc).map((t) => t.desc), props = things.filter((t) => t.kind === "prop" && t.desc).map((t) => t.desc);
    const refs = cast.filter((n) => bible.cast[n] && (bible.cast[n].ref || bible.cast[n].sheet) && !named.includes(n));
    const placed = page.text && page.text.length ? page.text : R.autoPlace(page, spec, {}, measureText);
    const castLines = cast.map((n) => (bible.cast[n] ? bible.cast[n].desc : `${n.toUpperCase()}: as in the reference.`));
    const prompt = [
      `Use case: illustration-story. Create ONE ${bible.colour ? "FULL-COLOUR" : "BLACK-AND-WHITE"} manga PANEL illustration: a single picture, ${size[0] > size[1] ? "landscape" : size[0] < size[1] ? "portrait" : "square"} ${size[0]}x${size[1]}. Original series.`,
      bible.no_text,
      bible.style,
      "ONE PANEL ONLY: this picture fills the whole image, edge to edge. No panel border, no gutters, no margin and no second picture. Where the style text speaks of a page, borders, gutters or margins, it describes the page this panel will be placed on.",
      (cast.length ? `${bible.cast_intro}\n${castLines.join("\n")}\n` : "") + (absent.length && !bible.no_names ? `NOT IN THIS PANEL: ${absent.join(", ")}. Do not draw them.\n` : "") /* a list of famous people, even as stand-ins, gets the picture refused */ + `${bible.tones}\n${(bible.rules || []).join("\n")}`,
      places.length ? `THE PLACE (keep it the same in every panel set here):\n${places.join("\n")}` : "",
      props.length ? `PROPS (draw each exactly as described; where a reference picture is attached, match it):\n${props.join("\n")}` : "",
      refs.length && !opts.noRefLine ? `INPUT REFERENCES, ordered: ${refs.map((n, i) => `Image ${i + 1}: ${bible.cast[n].ref_role || n}`).join("; ")}.` : "",
      readsRtl(page, R) ? RTL_PANEL : "",
      "THE PANEL. " + (opts.own != null ? opts.own.trim() : byToner(bible, describe(c, placed, R, named, bible.colour))),
      byToner(bible) ? TONER_RULE : "",
    ].filter(Boolean).join("\n\n").replace(byToner(bible) ? "Use the one light dot tone sparingly." : "\u0000", "Use tone sparingly: one light flat grey, on few areas.");
    return { prompt, refs, size, cast, named, things };
  }

  function brief(page, spec, bible, R, measureText) {
    const W = R.W, H = R.H, G = R.layoutGeom(page.layout), cells = G.cells;
    const areas = cells.map((c) => (c.bbox[2] - c.bbox[0]) * (c.bbox[3] - c.bbox[1]));
    const dom = areas.indexOf(Math.max(...areas));
    // where the Letterer will put balloons (storyboard placement), per panel
    const placed = page.text && page.text.length ? page.text : R.autoPlace(page, spec, {}, measureText);
    const cast = castOf(cells);
    const absent = Object.keys(bible.cast).filter((n) => !cast.includes(n));
    const refs = cast.filter((n) => bible.cast[n] && bible.cast[n].ref).map((n) => ({ path: bible.cast[n].ref, role: bible.cast[n].ref_role || n }));
    const attach = refs.concat([{ path: "(layout guide)", role: "panel layout guide" }]);

    const panelText = cells.map((c, i) => ({ n: i + 1, id: c.panel.id,
      text: (`PANEL ${i + 1}, ${where(c, W, H)}${i === dom ? " (the dominant panel)" : ""}. ` + describe(c, placed, R)).trim() }));

    const castLines = cast.map((n) => (bible.cast[n] ? bible.cast[n].desc : `${n.toUpperCase()}: as in the reference.`));
    const prompt = [
      bible.header,
      bible.no_text,
      bible.style,
      `${bible.cast_intro}\n${castLines.join("\n")}${absent.length ? `\nNOT ON THIS PAGE: ${absent.join(", ")}. Do not draw them.` : ""}\n${bible.tones}\n${(bible.rules || []).join("\n")}`,
      `Layout: the LAST image attached is the panel layout only: draw the page with exactly these panel borders and gutters (slanted borders stay slanted). Do not draw its red numbers. ${cells.length} panels, numbered in reading order. Panel ${dom + 1} is the dominant panel.` +
        (readsRtl(page, R) ? " READING DIRECTION: this page is read RIGHT TO LEFT, like a Japanese manga: panel 1 is at the top right, and each row runs from the right to the left, exactly as the layout guide numbers them. Never mirror the page or a panel; left and right in the panel notes mean the viewer's left and right." : ""),
      `INPUT REFERENCES, ordered: ${attach.map((a, i) => `Image ${i + 1}: ${a.role}`).join("; ")}.`,
      ...panelText.map((p) => p.text),
    ].join("\n\n");
    return { prompt, attach, panels: panelText, cast, absent };
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  const api = { brief, panelBrief };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else g.Artist = api;
})(typeof window !== "undefined" ? window : globalThis);
