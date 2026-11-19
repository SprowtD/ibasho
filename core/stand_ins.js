/* Stand-ins: leave real names out of picture prompts (fan fiction, famous books).
 * Image services refuse prompts that name characters, places and things from well-known stories ("moderation_blocked"),
 * even when the drawing itself is fine. With the series switch on, every name in the series' list is swapped for its
 * plain stand-in ("Sherlock" -> "the tall, thin detective in a deerstalker") just before the prompt is sent. The pictures still
 * follow the attached character sheets, so the people stay the same.
 * bible.no_names = true; bible.stand_ins = "Name = stand-in" lines (one per line; # starts a comment).
 * Works in the browser (window.StandIns) and in node (require / import default).
 */
(function (g) {
  "use strict";
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** "Name = stand-in" lines -> [[name, stand-in]], longest name first so "Madam Malkin's Robes" wins over "Madam Malkin". */
  function parse(text) {
    const out = [];
    for (const raw of String(text || "").split("\n")) {
      const line = raw.replace(/#.*$/, "").trim(), i = line.indexOf("=");
      if (i < 1) continue;
      const name = line.slice(0, i).trim(), sub = line.slice(i + 1).trim();
      if (name) out.push([name, sub]);
    }
    return out.sort((a, b) => b[0].length - a[0].length);
  }
  /** The prompt with every listed name swapped (whole words, any case; curly or straight apostrophes match). */
  function apply(prompt, bible) {
    if (!bible || !bible.no_names) return prompt;
    let s = String(prompt || "");
    for (const [name, sub] of parse(bible.stand_ins)) {
      const pat = esc(name).replace(/['’]/g, "['’]");
      s = s.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${pat}(?=$|[^\\p{L}\\p{N}])`, "giu"), (m, pre) => pre + sub);
    }
    return s;
  }
  /** Names from the list that are still in the prompt (a check: should be empty). */
  function leftover(prompt, bible) {
    if (!bible || !bible.no_names) return [];
    const s = apply(prompt, bible);
    return parse(bible.stand_ins).map(([n]) => n).filter((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(n)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(s));
  }
  const api = { parse, apply, leftover };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else g.StandIns = api;
})(typeof window !== "undefined" ? window : globalThis);
