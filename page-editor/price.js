/* What one picture will cost before it is drawn, from a model's OpenRouter catalogue entry (core/models/openrouter.json).
 * Shared by the server (models.mjs) and the screens (window.IbashoPrice). Everything here is an estimate: the bill comes from OpenRouter.
 *   the picture itself  by the image, by the megapixel, or by output tokens (OpenAI: depends on the quality and the size)
 *   reference pictures  by the image or by input tokens (about 1,100 tokens for a sheet-sized picture)
 *   the words           by input tokens (about 4 letters a token)
 * Why quality is always sent: left on "auto", GPT Image picked "high" by itself on 18 Nov and a panel cost $0.17 instead of about $0.04. */
(function (root) {
  "use strict";
  // OpenAI image output tokens (OpenAI's own table for GPT Image): square 1024 x 1024, and 1024 x 1536 either way round.
  const OPENAI = { low: [272, 408], medium: [1056, 1584], high: [4160, 6240] };
  const ROUGH = { xhigh: 1.5, max: 2 }; // not published: priced as high x 1.5 and x 2, marked rough
  const REF_TOKENS = 1100;
  const LABEL = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };

  function outTokens(quality, w, h) {
    const q = OPENAI[quality] ? quality : ROUGH[quality] ? "high" : "medium", [sq, tall] = OPENAI[q];
    const area = w * h, base = Math.abs(w - h) < 64 ? sq * (area / (1024 * 1024)) : tall * (area / (1024 * 1536));
    return Math.round(base * (ROUGH[quality] || 1));
  }
  /** m = catalogue entry; o = { quality, size: [w, h], refs: number of reference pictures, chars: prompt length }.
   * Returns { usd, picture, refs, words, rough } in dollars. */
  function picture(m, o) {
    o = o || {}; const [w, h] = o.size || [1024, 1024], refs = Math.max(0, o.refs || 0), chars = Math.max(0, o.chars || 0);
    const quality = (m.qualities || []).length ? (m.qualities.includes(o.quality) ? o.quality : "medium") : "";
    const out = (m.prices || [])[0] || {}, inp = m.input_prices || {}, mp = (w * h) / 1e6;
    let pic = null, rough = !!ROUGH[quality];
    if (out.unit === "image") {
      const big = mp > 1.6 ? "2k" : "1k", v = (m.prices || []).find((p) => p.variant === `${quality}_${big}`) || (m.prices || []).find((p) => String(p.variant).startsWith(quality + "_")) || out;
      pic = v.usd;
    } else if (out.unit === "megapixel") pic = out.usd * mp;
    else if (out.unit === "token" && /^openai\//.test(m.id)) pic = out.usd * outTokens(quality || "medium", w, h);
    else if (out.unit === "token" && /^google\//.test(m.id)) { pic = out.usd * 1120 * Math.max(1, mp); rough = true; }
    else if (m.about_per_picture != null) { pic = m.about_per_picture; rough = true; }
    const ri = inp.image, refUsd = !refs || !ri ? 0 : ri.unit === "image" ? ri.usd * refs : ri.unit === "megapixel" ? ri.usd * 1.05 * refs : ri.usd * REF_TOKENS * refs;
    const ti = inp.text, wordUsd = ti && ti.unit === "token" ? ti.usd * (chars / 4) : 0;
    return { usd: pic == null ? null : pic + refUsd + wordUsd, picture: pic, refs: refUsd, words: wordUsd, rough, quality };
  }
  const money = (v) => (v == null ? "?" : v < 0.01 ? "under $0.01" : "$" + v.toFixed(2));
  root.IbashoPrice = { picture, money, LABEL };
  if (typeof module === "object" && module.exports) module.exports = root.IbashoPrice;
})(typeof window !== "undefined" ? window : globalThis);
