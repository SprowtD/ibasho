#!/usr/bin/env python3
"""OpenRouter's models, sorted into what Ibasho uses them for: chat and reasoning, pictures, video, voice, music, speech to text.

Usage: python3 tools/openrouter_catalog.py            -> writes core/models/openrouter.json and docs/providers/OPENROUTER_MODELS.md
Public lists only (no key needed): /api/v1/models, /api/v1/images/models (+ each model's /endpoints for its price), /api/v1/videos/models.
Standard library only. Run it again whenever OpenRouter adds models; the hand-picked chat list (PICKS) is checked against the live list.
"""
import json, sys, time, urllib.request, concurrent.futures as cf
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
OUT = APP / "core" / "models" / "openrouter.json"
DOC = APP / "docs" / "providers" / "OPENROUTER_MODELS.md"
BASE = "https://openrouter.ai"

# Chat and reasoning: a spread of price ranges for scripts, ideas and running the studio's flows.
# tier: top (hardest work, long flows), strong (everyday high quality), value (cheap and good), budget (very cheap), free (rate limited).
PICKS = [
    ("anthropic/claude-fable-5.2", "top", "Anthropic's most capable model; best for whole flows and long scripts"),
    ("openai/gpt-6.2-astra", "top", "OpenAI's flagship"),
    ("google/gemini-4-argon", "top", "Google's flagship reasoning model"),
    ("google/gemini-4-carbon", "top", "Google frontier model; #1 for writing and chat on Arena"),
    ("anthropic/claude-opus-5.5", "top", "Very strong writing and long multi-step work, half Fable's price"),
    ("anthropic/claude-sonnet-5.5", "strong", "Everyday writing and storyboards"),
    ("openai/gpt-6.2-sol", "strong", "OpenAI's everyday model"),
    ("google/gemini-4-hydrogen", "strong", "Gemini 4 workhorse, fast"),
    ("x-ai/grok-4.7", "strong", "xAI flagship"),
    ("qwen/qwen4-max", "strong", "Alibaba flagship, low price for its class"),
    ("openai/gpt-6.1-terra", "value", "Mid-price OpenAI, good with screenshots"),
    ("google/gemini-3.8-flash", "value", "Fast, reads pictures, audio and video"),
    ("mistralai/mistral-large-4-0", "value", "Mistral flagship"),
    ("moonshotai/kimi-k3.1-pro", "value", "Open-weight, cheap input, long context"),
    ("anthropic/claude-haiku-5.5", "budget", "Small and fast Claude"),
    ("openai/gpt-6-luna", "budget", "Small and fast GPT"),
    ("deepseek/deepseek-v4.1-flash", "budget", "Very cheap, good reasoning"),
    ("minimax/minimax-m3.1-flash", "budget", "Very cheap, reads pictures"),
    ("qwen/qwen3.8-flash", "budget", "Very cheap, reads pictures and video"),
    ("nvidia/nemotron-3-ultra-550b-a55b:free", "free", "Free, rate limited; large reasoning model"),
    ("nvidia/nemotron-3.5-super-vl:free", "free", "Free, rate limited; reads pictures"),
    ("google/gemma-4-31b-it:free", "free", "Free, rate limited; Google open model"),
]
TIERS = {"top": "Top: the hardest work", "strong": "Strong: everyday high quality", "value": "Value: good and cheap", "budget": "Budget: very cheap", "free": "Free (rate limited)"}
# "Suggested": the best-performing or newest strong model in each category, so a long list does not overwhelm.
# From public rankings, checked 18 Nov 2026: Artificial Analysis (AA) and Arena (arena.ai, was LMArena). Recheck when rebuilding.
SUGGEST = {
    # chat and reasoning
    "anthropic/claude-fable-5.2": ("best quality", "#1 on the AA Intelligence Index (65) and Arena Agent"),
    "openai/gpt-6.2-astra": ("best quality", "#2 on AA (62) at about 1/6 of Fable's cost per task"),
    "google/gemini-4-carbon": ("best for writing", "#1 on Arena Text (1526); #3 on AA (60)"),
    "openai/gpt-6.2-sol": ("best value", "AA 57 at about $1 a task"),
    "google/gemini-3.8-flash": ("best value", "#9 on Arena Text (1497); cheap and fast"),
    "deepseek/deepseek-v4.1-flash": ("cheapest good", "AA 33 at $0.60 a task, the cheapest that holds up"),
    "moonshotai/kimi-k3.1-pro": ("best open", "top open-weight model on AA (46)"),
    # pictures
    "openai/gpt-image-2.6-sunburst": ("best quality", "#1 on AA text-to-image (1261); #2 on Arena's cartoon and anime board"),
    "microsoft/mai-image-2.7": ("newest strong", "#4 on Arena's cartoon and anime board; #4 for editing"),
    "openai/gpt-image-2": ("most proven", "#5 on Arena's cartoon and anime board from 44,000 votes; #5 for editing"),
    "google/gemini-nano-banana-2.1": ("good and cheap", "#8 on AA text-to-image; takes up to 14 reference pictures"),
    # video
    "bytedance/seedance-2.5": ("best quality", "#1 on AA image-to-video (1161); #2 on Arena"),
    "google/gemini-omni-1.2-flash": ("newest strong", "#1 on Arena image-to-video and text-to-video; $0.07 a second at 720p with sound"),
    "alibaba/wan-3.0": ("best value", "#1 on AA text-to-video (1174); $0.05–0.10 a second with sound, up to 30 s"),
    "bytedance/seedance-2.0": ("best value", "#3 on AA image-to-video at about 2/3 of Seedance 2.5's price"),
    "minimax/hailuo-3": ("strong, with sound", "MiniMax H3: #3 on Arena image-to-video; 2K with sound"),
}

SPEECH_TO_TEXT = ["google/gemini-3.8-flash", "openai/gpt-audio-mini", "qwen/qwen3.8-omni-flash"]  # chat models that take audio in


def get(path):
    req = urllib.request.Request(BASE + path, headers={"user-agent": "ibasho-catalog"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def per_million(p, k):
    v = float(p.get(k) or 0)
    return round(v * 1e6, 4) if v >= 0 else None


# ---------- pictures: one comparable figure, "about $ per 1K picture" ----------
TOKENS_PER_1K = {"google/gemini-2.5-flash-image": 1290}  # Google: 1120 output tokens a 1K picture (1290 for 2.5 Flash Image)


def picture_price(mid, endpoint):
    """(about $ per 1K picture or None, how it is priced, all price lines)."""
    lines = [p for p in endpoint.get("pricing", []) if str(p.get("billable", "")).startswith("output")]
    if not lines:
        return None, "unknown", []
    base = [p for p in lines if not p.get("variant")] or [p for p in lines if p.get("variant") in ("1k", "1K")] or lines
    p = base[0]
    unit, cost = p.get("unit"), float(p.get("cost_usd") or 0)
    if unit == "image":
        est = cost
    elif unit == "megapixel":
        est = cost * 1.05  # 1024 x 1024
    elif unit == "token" and mid.startswith("google/"):
        est = cost * TOKENS_PER_1K.get(mid, 1120)
    elif unit == "token" and mid.startswith("openai/"):
        est = cost * 1056  # medium quality 1024 x 1024
    else:
        est = None
    detail = [{"variant": q.get("variant") or "standard", "unit": q.get("unit"), "usd": q.get("cost_usd")} for q in lines]
    return (round(est, 4) if est is not None else None), unit, detail


# ---------- video: $ per second at 480p / 720p / 1080p, whatever form the price comes in ----------
FPS, SIZES = 24, {"360p": (640, 360), "480p": (854, 480), "720p": (1280, 720), "768p": (1366, 768), "1080p": (1920, 1080), "2K": (2560, 1440), "4K": (3840, 2160)}


def video_prices(v):
    s = {k: float(x) for k, x in (v.get("pricing_skus") or {}).items()}
    res = v.get("supported_resolutions") or []
    out = {}
    for r in res:
        rl = r.lower()
        cands = [f"image_to_video_duration_seconds_{rl}", f"duration_seconds_with_audio_{rl}", f"duration_seconds_{rl}"]
        val = next((s[c] for c in cands if c in s), None)
        if val is None:
            c = next((s[c] / 100 for c in (f"cents_per_video_output_second_{rl}", f"cents_per_second_output_{rl}") if c in s), None)
            val = c
        if val is None and ("video_tokens" in s or f"video_tokens_{rl}" in s) and r in SIZES:
            w, h = SIZES[r]
            val = w * h * FPS / 1024 * s.get(f"video_tokens_{rl}", s.get("video_tokens"))
        if val is None:  # one price for every size, or the size not named
            val = next((s[c] for c in ("duration_seconds_with_audio", "duration_seconds") if c in s), None)
            if val is None and "cents_per_second_output" in s:
                val = s["cents_per_second_output"] / 100
        if val is not None:
            out[r] = round(val, 4)
    if not out and "cents_per_second_output" in s:
        out["any"] = s["cents_per_second_output"] / 100
    if not out and "cents_per_megapixel_second_precise" in s:  # upscaling: priced by the size of the result
        w, h = SIZES["1080p"]
        out["to 1080p"] = round(s["cents_per_megapixel_second_precise"] / 100 * w * h / 1e6, 4)
    return out


def video_kind(v):
    i = v["id"]
    if "avatar" in i:
        return "talking"
    if "upscale" in i:
        return "upscale"
    if "edit" in i or "aleph" in i:
        return "edit"
    return "make"


def main():
    t0 = time.time()
    models = get("/api/v1/models")["data"]
    images = get("/api/v1/images/models")["data"]
    videos = get("/api/v1/videos/models")["data"]
    by_id = {m["id"]: m for m in models}

    def ep(m):
        try:
            return m["id"], get(m["endpoints"])
        except Exception as e:  # noqa: BLE001
            return m["id"], {"error": str(e)}
    with cf.ThreadPoolExecutor(8) as ex:
        eps = dict(ex.map(ep, images))

    # chat and reasoning
    chat, missing = [], []
    for mid, tier, why in PICKS:
        m = by_id.get(mid)
        if not m:
            missing.append(mid); continue
        a, p = m["architecture"], m["pricing"]
        chat.append({"id": mid, "name": m["name"], "tier": tier, "why": why, "in": per_million(p, "prompt"), "out": per_million(p, "completion"),
                     "context": m.get("context_length"), "suggested": SUGGEST.get(mid, (None,))[0], "why_suggested": SUGGEST.get(mid, (None, None))[1], "reads_pictures": "image" in a["input_modalities"], "reasoning": "reasoning" in (m.get("supported_parameters") or [])})
    all_text = sorted(({"id": m["id"], "name": m["name"], "in": per_million(m["pricing"], "prompt"), "out": per_million(m["pricing"], "completion")}
                       for m in models if m["architecture"]["output_modalities"] == ["text"] and ":batch" not in m["id"] and float(m["pricing"].get("prompt") or 0) >= 0),
                      key=lambda x: x["id"])

    # pictures
    pics = []
    for m in images:
        e = eps.get(m["id"], {})
        endpoint = (e.get("endpoints") or [{}])[0]
        est, unit, detail = picture_price(m["id"], endpoint)
        sp = m.get("supported_parameters") or {}
        refs = (sp.get("input_references") or {}).get("max")
        pics.append({"id": m["id"], "name": m["name"], "suggested": SUGGEST.get(m["id"], (None,))[0], "why_suggested": SUGGEST.get(m["id"], (None, None))[1], "about_per_picture": est, "priced_by": unit, "prices": detail,
                     "edits_pictures": "image" in m["architecture"]["input_modalities"], "max_references": refs,
                     "aspect_ratios": (sp.get("aspect_ratio") or {}).get("values"), "transparent": "transparent" in ((sp.get("background") or {}).get("values") or []),
                     # quality levels the model takes (sent on purpose, never left on "auto": auto lets the model pick, and the price with it)
                     "qualities": [q for q in ((sp.get("quality") or {}).get("values") or []) if q != "auto"],
                     # what the words and reference pictures sent with a prompt cost (per token), for the estimate shown before drawing
                     "input_prices": {str(q.get("billable", "")).replace("input_", ""): {"usd": float(q.get("cost_usd") or 0), "unit": q.get("unit")} for q in endpoint.get("pricing", []) if str(q.get("billable", "")).startswith("input_")}})
    pics.sort(key=lambda x: (x["about_per_picture"] is None, x["about_per_picture"] or 0))

    # video
    vids = []
    for v in videos:
        vids.append({"id": v["id"], "name": v["name"], "suggested": SUGGEST.get(v["id"], (None,))[0], "why_suggested": SUGGEST.get(v["id"], (None, None))[1], "kind": video_kind(v), "per_second": video_prices(v), "sound": v.get("generate_audio"),
                     "lengths": [d for d in (v.get("supported_durations") or []) if d and d > 0], "frames": v.get("supported_frame_images") or [],
                     "resolutions": v.get("supported_resolutions") or [], "raw_prices": v.get("pricing_skus")})

    # voice and music (OpenRouter has no text-to-speech list; these are what it carries)
    voice = [{"id": i, "name": by_id[i]["name"], "note": "a chat model that answers out loud; not a voice-acting model"} for i in ("openai/gpt-audio", "openai/gpt-audio-mini") if i in by_id]
    music = [{"id": m["id"], "name": m["name"], "note": "full-length songs, $0.08 a song" if "pro" in m["id"] else "short music clips"} for m in models if m["id"].startswith("google/lyria")]
    stt = [{"id": i, "name": by_id[i]["name"]} for i in SPEECH_TO_TEXT if i in by_id]

    data = {"fetched": time.strftime("%Y-%m-%d"), "source": BASE, "tiers": TIERS, "chat": chat, "all_text_models": all_text,
            "pictures": pics, "video": vids, "voice": voice, "music": music, "speech_to_text": stt,
            "notes": ["Prices are OpenRouter's list prices; it adds 5.5% when credit is bought by card.",
                      "about_per_picture is an estimate for one 1024 x 1024 picture; token-priced models vary with size and quality.",
                      "OpenRouter has no voice-acting (text-to-speech) models: use Google AI Studio or ElevenLabs for voices."]}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=1))
    DOC.write_text(markdown(data))
    print(f"{len(chat)} chat picks ({len(all_text)} text models in all), {len(pics)} picture, {len(vids)} video, {len(voice)} voice, {len(music)} music models. {time.time() - t0:.0f} s")
    gone = [i for i in SUGGEST if i not in by_id and i not in {x["id"] for x in images} and i not in {x["id"] for x in videos}]
    if gone:
        print("Suggested models no longer on OpenRouter (update SUGGEST):", ", ".join(gone), file=sys.stderr)
    if missing:
        print("Picks no longer on OpenRouter (update PICKS):", ", ".join(missing), file=sys.stderr)


def money(x, d=3):
    return "?" if x is None else ("free" if x == 0 else f"${x:.{d}f}".rstrip("0").rstrip("."))


def star(x):
    return "★ " if x.get("suggested") else ""


def suggested_block(rows, price):
    s = [r for r in rows if r.get("suggested")]
    if not s:
        return []
    return ["**Suggested**", ""] + [f"- ★ **{r['name']}** `{r['id']}` · {r['suggested']} · {price(r)}. {r['why_suggested']}." for r in s] + [""]


def markdown(d):
    L = [f"# OpenRouter models for Ibasho ({d['fetched']})", "",
         "Made by `tools/openrouter_catalog.py` from OpenRouter's public lists. Prices are OpenRouter's (the maker's list price); +5.5% when you top up by card.", ""]
    L += ["★ = Suggested: the best-performing or newest strong models in each category, from Artificial Analysis and Arena rankings (18 Nov 2026). Everything else sits under \"More models\".", ""]
    L += ["## Chat and reasoning (scripts, ideas, running the flows)", "", "Price per 1 million words-pieces (tokens) read / written. A chapter script is roughly 5,000–10,000 tokens.", ""]
    L += suggested_block(d["chat"], lambda c: f"{money(c['in'], 2)} in / {money(c['out'], 2)} out")
    for t, title in d["tiers"].items():
        rows = [c for c in d["chat"] if c["tier"] == t]
        if not rows:
            continue
        L += [f"### {title}", "", "| Model | In | Out | Reads pictures | Why |", "| --- | --- | --- | --- | --- |"]
        L += [f"| {star(c)}{c['name']} `{c['id']}` | {money(c['in'], 2)} | {money(c['out'], 2)} | {'yes' if c['reads_pictures'] else 'no'} | {c['why']} |" for c in rows]
        L.append("")
    L += [f"All {len(d['all_text_models'])} text models stay pickable under \"More models\".", ""]
    L += ["## Pictures (all of them)", "", "About $ for one 1024 × 1024 picture, cheapest first. \"Edits\" = takes your pictures as input (references or editing).", ""]
    L += suggested_block(d["pictures"], lambda p: f"about {money(p['about_per_picture'])} a picture" if p['about_per_picture'] is not None else "priced by size and quality")
    L += ["All pictures:", "",
          "| Model | About $ a picture | Priced by | Edits | Max references |", "| --- | --- | --- | --- | --- |"]
    L += [f"| {star(p)}{p['name']} `{p['id']}` | {money(p['about_per_picture']) if p['about_per_picture'] is not None else 'by size and quality'} | {p['priced_by']} | {'yes' if p['edits_pictures'] else 'no'} | {p['max_references'] or '–'} |" for p in d["pictures"]]
    L += ["", "## Video (all of them)", "", "$ per second of video.", ""]
    L += suggested_block(d["video"], lambda v: ", ".join(f"{r} {money(x)}/s" for r, x in v["per_second"].items()))
    for kind, title in (("make", "Make video"), ("talking", "Talking avatars / lip sync"), ("edit", "Edit a video"), ("upscale", "Upscale a video")):
        rows = [v for v in d["video"] if v["kind"] == kind]
        if not rows:
            continue
        rows.sort(key=lambda v: min(v["per_second"].values()) if v["per_second"] else 9)
        L += [f"### {title}", "", "| Model | $ per second | Sound | Start/end frames | Lengths |", "| --- | --- | --- | --- | --- |"]
        for v in rows:
            ps = ", ".join(f"{r} {money(x)}" for r, x in v["per_second"].items()) or "see raw prices"
            ln = f"{min(v['lengths'])}–{max(v['lengths'])} s" if v["lengths"] else "–"
            L.append(f"| {star(v)}{v['name']} `{v['id']}` | {ps} | {'yes' if v['sound'] else 'no'} | {' + '.join(f.replace('_frame', '') for f in v['frames']) or '–'} | {ln} |")
        L.append("")
    L += ["## Voice, music, speech to text", "",
          "OpenRouter has **no voice-acting (text-to-speech) models**. For character voices use Google AI Studio (Gemini voices, cheapest) or ElevenLabs (cloning, sound effects).", ""]
    L += [f"- Voice: {v['name']} `{v['id']}`: {v['note']}" for v in d["voice"]]
    L += [f"- Music: {m['name']} `{m['id']}`: {m['note']}" for m in d["music"]]
    L += [f"- Speech to text: {s['name']} `{s['id']}`" for s in d["speech_to_text"]]
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    main()
