#!/usr/bin/python3
"""Artist agent: put ONE panel picture (drawn on its own from the editor's "Generate") into its storyboard panel.
True grey, saved as a jpg beside the page art; faces come from art/faces.json (boxes in this picture's pixels, keyed by
the image name) if someone checked them. The editor then swaps only this panel and clears its request.
Usage: /usr/bin/python3 tools/artist_panel.py <project dir> <panel id> <image>
"""
import json, subprocess, sys
from pathlib import Path
from PIL import Image, ImageOps

APP = Path(__file__).resolve().parents[1]
proj, pid, src = Path(sys.argv[1]).resolve(), sys.argv[2], Path(sys.argv[3]).resolve()
art = proj / "art"
load = lambda n, d: json.loads((art / n).read_text()) if (art / n).exists() else d
spec = json.loads((proj / "spec.json").read_text())
def find(rows):
    for r in rows:
        for q in r["panels"]:
            if q.get("rows"):
                f = find(q["rows"])
                if f: return f
            elif q.get("id") == pid: return q
where = next(((pg, q) for pg in spec["pages"] if pg.get("layout") for q in [find(pg["layout"]["rows"])] if q), None)
if not where: sys.exit(f"no panel {pid} in the storyboard")
pg, _ = where
colour = json.loads((proj / "bible.json").read_text()).get("colour") if (proj / "bible.json").exists() else False
im = Image.open(src).convert("RGB")
if not colour: im = ImageOps.grayscale(im).convert("RGB")  # true grey for black-and-white series: drops the model's faint tint
w, h = im.size
name = f"{src.stem}.jpg"
im.save(art / name, quality=88)
faces = load("faces.json", {}).get(src.stem, [])
absent = load("faces.json", {}).get(src.stem + ":absent", [])
prot = [{"who": f["who"], "box": [round(min(max(f["box"][i] / (w, h)[i % 2], 0), 1), 3) for i in range(4)]} for f in faces]
prot = [f for f in prot if f["box"][2] > f["box"][0] and f["box"][3] > f["box"][1]]
entry = {"src": "art/" + name, "label": f"Page {pg['number']} · {pid}", "size": [w, h], "protect": prot, "single": True,
         "from": str(src.relative_to(proj)) if src.is_relative_to(proj) else str(src), "faces": "checked on the art" if faces else "none labelled"}
try:  # the Artist's own check of the picture (tools/artist_requests.mjs, unattended runs)
    review = [str(x)[:240] for x in json.loads(Path(str(src) + ".review.json").read_text()) if str(x).strip()][:8]
except Exception: review = None
if review is not None: entry["review"] = review
if absent: entry["absent"] = absent  # in the storyboard, but Codex could not find them in the picture
lib = [e for e in load("library.json", []) if e["src"] != entry["src"]] + [entry]
assign = load("assignments.json", {})
assign[pid] = {"image": entry["src"], "take": src.stem}
(art / "library.json").write_text(json.dumps(lib, indent=1, ensure_ascii=False))
(art / "assignments.json").write_text(json.dumps(assign, indent=1))
# rebuild the project's spec: projects made in the app carry a board.json; an older hand-built sample has its own builder, when that is here
if (proj / "board.json").exists(): subprocess.check_call(["node", str(APP / "tools/build_spec.mjs"), str(proj)], stdout=subprocess.DEVNULL)
elif (APP / "tools/build_board.py").exists(): subprocess.check_call(["/usr/bin/python3", str(APP / "tools/build_board.py")], stdout=subprocess.DEVNULL)
else: sys.exit("This project has no storyboard file (board.json) to rebuild from.")
print(f"page {pg['number']} panel {pid}: {name} in place ({len(prot)} faces)")
