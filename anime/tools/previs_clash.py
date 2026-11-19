#!/usr/bin/python3
"""Where do people pass through each other, or through furniture, in a previs score? No picture is made.
Usage: previs_clash.py <score.yaml>   -> one line per clash: who, with what, from when to when, in which shot."""
import sys, yaml, math
d = yaml.safe_load(open(sys.argv[1])); ents = {e["id"]: e for e in d["entities"]}; moves = {}
for b in d.get("blocking", []): moves.setdefault(b["entity"], []).append(b)
for v in moves.values(): v.sort(key=lambda b: b["start"])
sm = lambda k: 0.0 if k <= 0 else 1.0 if k >= 1 else k * k * (3 - 2 * k)
def state(i, t):
    e = ents[i]; p = list(e["position"]); vis = e.get("visible", True)
    for b in moves.get(i, []):
        if t < b["start"]: break
        k = 1.0 if b.get("cut") else sm((t - b["start"]) / max(1e-6, b["end"] - b["start"]))
        if "position" in b: p = [p[j] + (b["position"][j] - p[j]) * k for j in range(3)]
        if "visible" in b and k >= 1: vis = b["visible"]
    return p, vis
chars = [e for e in d["entities"] if e["kind"] == "character"]
solid = [e for e in d["entities"] if e["kind"] != "character" and e.get("style") == "solid" and max(e["size"][0], e["size"][2]) >= 0.5 and e["position"][1] + e["size"][1] > 0.3]
shot = lambda t: next((s["id"] for s in d["shots"] if s["start"] <= t < s["end"]), "?")
hits = {}; t = 0.0
while t < d["duration"]:
    st = {c["id"]: state(c["id"], t) for c in chars}
    for i, a in enumerate(chars):
        pa, va = st[a["id"]]
        if not va: continue
        for b in chars[i + 1:]:
            pb, vb = st[b["id"]]
            if vb and math.hypot(pa[0] - pb[0], pa[2] - pb[2]) < 0.34: hits.setdefault((a["id"], b["id"]), []).append(t)
        for s in solid:
            seat = s["position"][1] + s["size"][1] <= 0.65 and pa[1] < -0.2 and "table" not in s["id"]  # sitting on it is not a clash
            if s["position"][1] > max(0.0, pa[1]) + a["size"][1] * 0.9: continue  # it is overhead (an awning, a canopy)
            if not seat and abs(pa[0] - s["position"][0]) < s["size"][0] / 2 - 0.05 and abs(pa[2] - s["position"][2]) < s["size"][2] / 2 - 0.05: hits.setdefault((a["id"], s["id"]), []).append(t)
    t += 0.05
for (a, b), ts in hits.items():
    runs = [[ts[0], ts[0]]]
    for x in ts[1:]:
        if x - runs[-1][1] < 0.11: runs[-1][1] = x
        else: runs.append([x, x])
    for r0, r1 in runs: print(f"{a} passes through {b}: {r0:.2f} s to {r1:.2f} s ({shot(r0)}{'' if shot(r0) == shot(r1) else ' to ' + shot(r1)})")
if not hits: print("No clashes found.")
