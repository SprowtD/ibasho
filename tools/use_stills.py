#!/usr/bin/python3
"""Use existing stills: put pictures that already exist (an anime scene's stills) onto storyboard panels, many at once.
The same result as tools/artist_panel.py for each one (a jpg beside the page art, an entry in art/library.json, the panel's
entry in art/assignments.json), then ONE rebuild of the chapter. True grey for a black-and-white series. No faces are
labelled on a reused still: the Letterer goes by the storyboard's positions until someone checks them.
Usage: /usr/bin/python3 tools/use_stills.py <project dir> <picks.json>     picks.json = [{"panel": id, "shot": id, "file": path}]
"""
import json, re, subprocess, sys
from pathlib import Path
from PIL import Image, ImageOps

APP = Path(__file__).resolve().parents[1]
proj, picks = Path(sys.argv[1]).resolve(), json.loads(Path(sys.argv[2]).read_text())
art = proj / "art"; art.mkdir(exist_ok=True)
if not (proj / "board.json").exists(): sys.exit("This project has no storyboard file (board.json) to rebuild from.")
load = lambda n, d: json.loads((art / n).read_text()) if (art / n).exists() else d
spec = json.loads((proj / "spec.json").read_text())
where = {}
def walk(pg, rows):
    for r in rows:
        for q in r["panels"]:
            if q.get("rows"): walk(pg, q["rows"])
            elif q.get("id"): where[q["id"]] = pg
for pg in spec["pages"]:
    if pg.get("layout"): walk(pg, pg["layout"]["rows"])
colour = json.loads((proj / "bible.json").read_text()).get("colour") if (proj / "bible.json").exists() else False
lib, assign, n = load("library.json", []), load("assignments.json", {}), 0
for p in picks:
    pid, shot, src = str(p["panel"]), re.sub(r"[^\w.-]", "_", str(p["shot"]))[:60], Path(p["file"])
    if pid not in where or not src.is_file(): continue
    im = Image.open(src).convert("RGB")
    if not colour: im = ImageOps.grayscale(im).convert("RGB")
    stem = f"still-{shot}"
    im.save(art / f"{stem}.jpg", quality=88)
    entry = {"src": f"art/{stem}.jpg", "label": f"Page {where[pid]['number']} · {pid}", "size": list(im.size), "protect": [], "single": True,
             "from": f"still {p['shot']}", "still": True, "faces": "none labelled"}
    lib = [e for e in lib if e["src"] != entry["src"]] + [entry]
    assign[pid] = {"image": entry["src"], "take": stem}
    n += 1
(art / "library.json").write_text(json.dumps(lib, indent=1, ensure_ascii=False))
(art / "assignments.json").write_text(json.dumps(assign, indent=1))
subprocess.check_call(["node", str(APP / "tools/build_spec.mjs"), str(proj)], stdout=subprocess.DEVNULL)
print(f"{n} stills in place")
