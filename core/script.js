/* Screenplay reader: a chapter script in our markdown screenplay format -> numbered beats.
 * Format: "## 3. PLACE. TIME. (about 1:20)" scene headings; plain paragraphs = action;
 * "**NAME**" or "**NAME (aside)**" starts dialogue, optional "(parenthetical)" line, then the line itself.
 * Dialogue is matched, in order, to the project's numbered lines (paragraphs.json: [{source_id, text}]).
 * Works in the browser (window.ScriptReader) and in Node (module.exports).
 */
(function (g) {
  "use strict";
  const norm = (s) => String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

  function parse(md, paragraphs) {
    const beats = [];
    let scene = null, sceneNo = 0, n = 0, pending = null;
    const blocks = md.replace(/\r/g, "").split(/\n\s*\n/);
    for (const raw of blocks) {
      const b = raw.trim();
      if (!b || b === "---") continue;
      const h = b.match(/^##\s+(\d+)\.\s+(.*)$/);
      if (h) { sceneNo = +h[1]; scene = h[2].replace(/\s*\(about [^)]*\)\s*$/, "").trim(); beats.push({ id: `S${sceneNo}`, scene: sceneNo, type: "scene", text: scene }); n = 0; continue; }
      if (!sceneNo) continue; // title block and notes before scene 1
      const lines = b.split("\n").map((s) => s.trim());
      const sp = lines[0].match(/^\*\*(.+?)\*\*$/);
      if (sp && !/^END OF/i.test(sp[1])) {
        const m = sp[1].match(/^(.*?)\s*\((.*)\)\s*$/);
        let speaker = (m ? m[1] : sp[1]).trim(), aside = m ? m[2] : "";
        let rest = lines.slice(1);
        let paren = "";
        if (rest.length && /^\(.*\)$/.test(rest[0])) { paren = rest[0].slice(1, -1); rest = rest.slice(1); }
        beats.push({ id: `S${sceneNo}.${++n}`, scene: sceneNo, type: "line", speaker: titleCase(speaker), paren: [aside, paren].filter(Boolean).join("; "), text: rest.join(" ") });
        continue;
      }
      if (/^\*\*END OF/i.test(b)) continue;
      beats.push({ id: `S${sceneNo}.${++n}`, scene: sceneNo, type: "action", text: b.replace(/\n/g, " ") });
    }
    // match dialogue to numbered lines, in order
    if (paragraphs) {
      let j = 0;
      for (const bt of beats) {
        if (bt.type !== "line") continue;
        while (j < paragraphs.length && norm(paragraphs[j].text) !== norm(bt.text)) j++;
        if (j < paragraphs.length) { bt.source_id = paragraphs[j].source_id; bt.text = paragraphs[j].text; j++; }
        else bt.unmatched = true;
      }
    }
    return beats;
  }
  function titleCase(s) { return s.toLowerCase().replace(/(^|[\s-])\w/g, (c) => c.toUpperCase()); }

  const api = { parse, norm };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else g.ScriptReader = api;
})(typeof window !== "undefined" ? window : globalThis);
