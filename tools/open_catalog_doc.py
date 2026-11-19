#!/usr/bin/env python3
"""Write docs/providers/OPEN_MODELS_AND_GPUS.md from core/models/open_models.json and core/models/gpu_clouds.json.
Usage: python3 tools/open_catalog_doc.py   (standard library only)"""
import json
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
om = json.loads((APP / "core/models/open_models.json").read_text())
gc = json.loads((APP / "core/models/gpu_clouds.json").read_text())
KINDS = [("picture", "Pictures"), ("edit", "Picture editing"), ("video", "Video"), ("voice", "Voices"), ("music", "Music"),
         ("sfx", "Sound effects"), ("text", "Writing (chat and reasoning)"), ("upscale", "Upscaling"), ("interpolate", "Frame interpolation")]
COMM = {"yes": "yes", "limited": "with limits", "no": "no"}

L = [f"# Open-source models and GPU clouds ({om['checked']})", "",
     "Models anyone can download and run on a rented GPU (or their own), and the clouds Ibasho can rent GPUs from.",
     "★ = Suggested. **US: permission needed** = the licence needs the maker's permission in the United States (for the model and what it makes). Ibasho never blocks it: it links to the licence page to apply, and once you have permission you switch on \"I have permission\".", ""]
for k, title in KINDS:
    rows = [m for m in om["models"] if m["kind"] == k]
    if not rows:
        continue
    rows.sort(key=lambda m: (not m.get("suggested"), "US" in m["excluded"], m["vram_gb"]))
    L += [f"## {title}", ""]
    sug = [m for m in rows if m.get("suggested")]
    if sug:
        L += [f"- ★ **{m['name']}**: {m['suggested']}." for m in sug] + [""]
    jp = k == "voice"
    L += ["| Model | GPU memory | Commercial use | Where | ComfyUI" + (" | Japanese" if jp else "") + " | Note |",
          "| --- | --- | --- | --- | --- |" + (" --- |" if jp else "") + " --- |"]
    for m in rows:
        mem = "CPU is enough" if not m["vram_gb"] else f"{m['vram_gb']} GB" + (f" (min {m['vram_min_gb']})" if m.get("vram_min_gb") and m["vram_min_gb"] != m["vram_gb"] else "")
        where = "everywhere" if not m["excluded"] else ("**permission needed in** " + ", ".join(m["excluded"]) + (f" ([apply]({m['licence_request']}))" if m.get("licence_request") else ""))
        L.append(f"| {'★ ' if m.get('suggested') else ''}{m['name']} `{m['hf']}` | {mem} | {COMM[m['commercial']]} ({m['licence']}) | {where} | {m['comfyui']}"
                 + (f" | {'yes' if m.get('japanese') else 'no'}" if jp else "") + f" | {m['note']} |")
    L.append("")

gpus = list(gc["gpus"])
L += ["## GPU clouds", "", "Starting prices in $ an hour for one GPU (live prices replace these where the cloud has a price API).", "",
      "| Cloud | " + " | ".join(gpus) + " | Billing | Live prices | First wave |", "| --- |" + " --- |" * (len(gpus) + 3)]
for c in gc["clouds"]:
    L.append(f"| {c['name']} | " + " | ".join(f"${c['prices'][g]:.2f}" if g in c["prices"] else "–" for g in gpus)
             + f" | {c['billing']} | {'yes' if c['live_prices'] and 'only' not in c['live_prices'] else ('stock only' if c['live_prices'] else 'no')} | {'yes' if c['first'] else 'later'} |")
L += ["", "GPU memory and rough speed (RTX 4090 = 1): " + ", ".join(f"{g} {v['vram']} GB ×{v['speed']}" for g, v in gc["gpus"].items()) + ".", "",
      "## How Ibasho picks a GPU", "",
      f"- **Fits:** {gc['rule']['fit']}.", f"- **Time:** {gc['rule']['time']}.", f"- **Cheapest:** {gc['rule']['cheapest']}.",
      f"- **Fastest:** {gc['rule']['fastest']}.", f"- **Default:** {gc['rule']['default']}.",
      "- The estimate is shown before anything starts, and the machine is always stopped after.", "",
      "Examples with today's starting prices (`core/gpu_route.mjs`):", "",
      "- One Anima picture (8 GB, ~6 s on a 4090): RunPod serverless RTX 5090, ~34 s with start-up, about $0.02.",
      "- One Wan 2.2 14B clip (48 GB, ~10 min on a 4090): cheapest = Vast.ai A100, 15 min, $0.18; default = H100, 6 min, $0.25 (60% quicker for 37% more); fastest = B200, 3.6 min, $0.65.",
      "- 50 Wan clips in a row: default = RunPod H100 pod, ~4.2 h, about $8.40 (half the time of the cheapest for 37% more).", ""]
(APP / "docs/providers/OPEN_MODELS_AND_GPUS.md").write_text("\n".join(L))
print("written", len(L), "lines")
