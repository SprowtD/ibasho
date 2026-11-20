#!/usr/bin/python3
"""Artist agent, step 4: cut a generated page into panel pictures and put them into the storyboard page.

Image models never follow the layout guide exactly, so the panels are FOUND in the drawing (white gutter flood from
the page edge; what is left are the drawn panels), matched to the storyboard panels, and cut on their real borders.
The page then takes the drawn proportions (art/fit.json, read by build_board.py), so the art is not cropped to fit.
Faces: art/faces.json holds face boxes in page pixels, keyed by the image name (written by whoever checked the page:
the agent by eye, or a vision model); without it the storyboard head positions are used.
Records art/library.json + art/assignments.json, then rebuilds spec.json.
Usage: /usr/bin/python3 tools/artist_split.py <project dir> <page number> <page image>
"""
import json, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage as ndi

APP = Path(__file__).resolve().parents[1]
proj, num, src = Path(sys.argv[1]).resolve(), int(sys.argv[2]), Path(sys.argv[3]).resolve()
art = proj / "art"; art.mkdir(parents=True, exist_ok=True)  # a project that has no drawn picture yet has no art folder
PW, PH = 1024, 1536
K = PW / 1000  # page units -> pixels


def load(name, default):
    return json.loads((art / name).read_text()) if (art / name).exists() else default


page = json.loads(subprocess.check_output(["node", "-e", """
require(process.argv[1]); const R=globalThis.PageRender, fs=require('fs');
const spec=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); const p=spec.pages.find(q=>q.number===+process.argv[3]);
const G=R.layoutGeom(p.layout);
const flat=!(p.layout.insets||[]).length && p.layout.rows.every(r=>r.panels.every(q=>!q.rows));
console.log(JSON.stringify({id:p.id, flat, rows:p.layout.rows.map(r=>r.panels.length),
  cells:G.cells.map(c=>({id:c.panel.id, bbox:c.bbox, heads:R.boardHeads(c).map(h=>({who:h.who, box:h.box}))}))}))""",
    str(APP / "page-editor/render.js"), str(proj / "spec.json"), str(num)]))
cells = page["cells"]

full = Image.open(src).convert("RGB")
if full.size != (PW, PH):
    full = full.resize((PW, PH), Image.LANCZOS)
im = ImageOps.grayscale(full)  # the panels are found in grey; a black-and-white series also keeps this true grey (it drops the model's faint tint)
colour = json.loads((proj / "bible.json").read_text()).get("colour") if (proj / "bible.json").exists() else False  # a colour series keeps its colours, as tools/artist_panel.py does
g = np.asarray(im)


def find_panels():
    """Drawn panels as pixel boxes just inside their borders, or None if the page cannot be read."""
    ink = ndi.binary_dilation(g < 200, iterations=3)  # close small gaps in hand-ruled borders
    lab, _ = ndi.label(~ink)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    gutter = np.isin(lab, list(edge))
    plab, n = ndi.label(~gutter)
    out = []
    for i, sl in enumerate(ndi.find_objects(plab), 1):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if w * h < 0.015 * PW * PH or w < 60 or h < 60:
            continue
        m = ndi.binary_fill_holes(plab[sl] == i)
        # the upright box inside the drawn shape (a slanted border leaves a thin wedge out, not a whole side)
        mid = m[int(h * 0.1):int(h * 0.9)]  # sides from the middle rows, then top and bottom from the columns between them
        left, right = int(np.percentile(mid.argmax(axis=1), 95)), int(np.percentile(w - 1 - mid[:, ::-1].argmax(axis=1), 5))
        cut = m[:, left:right + 1]
        top, bot = int(np.percentile(cut.argmax(axis=0), 95)), int(np.percentile(h - 1 - cut[::-1].argmax(axis=0), 5))
        ins = 9  # dilation + the drawn border
        out.append(tuple(int(v) for v in (sl[1].start + left + ins, sl[0].start + top + ins, sl[1].start + right + 1 - ins, sl[0].start + bot + 1 - ins)))
    return out


def iou(a, b):
    ix, iy = max(0, min(a[2], b[2]) - max(a[0], b[0])), max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


guide = [tuple(v * K for v in c["bbox"]) for c in cells]
found, boxes = find_panels(), None
if len(found) == len(cells):
    pairs = sorted(((iou(guide[i], f), i, j) for i in range(len(cells)) for j, f in enumerate(found)), reverse=True)
    got, used = {}, set()
    for s, i, j in pairs:
        if i not in got and j not in used and s > 0.3:
            got[i] = j; used.add(j)
    if len(got) == len(cells):
        boxes = [found[got[i]] for i in range(len(cells))]
if boxes is None:
    print(f"page {num}: WARNING found {len(found)} drawn panels for {len(cells)} storyboard panels; cutting on the guide instead")
    boxes = [(round(x0) + 7, round(y0) + 7, round(x1) - 7, round(y1) - 7) for x0, y0, x1, y1 in guide]
    fitted = False
else:
    fitted = page["flat"]

# the page takes the drawn proportions (simple rows of panels only)
fit = load("fit.json", {})
if fitted:
    rows, i = [], 0
    for n in page["rows"]:
        bs = boxes[i:i + n]; i += n
        rows.append({"h": max(b[3] for b in bs) - min(b[1] for b in bs), "w": [b[2] - b[0] for b in bs]})
    th = sum(r["h"] for r in rows)
    fit[page["id"]] = [{"h": round(r["h"] / th, 4), "w": [round(w / sum(r["w"]), 4) for w in r["w"]]} for r in rows]
else:
    fit.pop(page["id"], None)
(art / "fit.json").write_text(json.dumps(fit, indent=1))

faces = load("faces.json", {}).get(src.stem)
lib, assign = load("library.json", []), load("assignments.json", {})
rgb = full if colour else im.convert("RGB")
for i, (c, box) in enumerate(zip(cells, boxes), 1):
    bx0, by0, bx1, by1 = box
    name = f"p{num:02d}-panel{i}.jpg"
    rgb.crop(box).save(art / name, quality=88)
    w, h = bx1 - bx0, by1 - by0
    if faces is not None:  # checked faces, page pixels: each goes to the panel that holds its centre
        mine = [f for f in faces if bx0 <= (f["box"][0] + f["box"][2]) / 2 <= bx1 and by0 <= (f["box"][1] + f["box"][3]) / 2 <= by1]
        prot = [{"who": f["who"], "box": [round(min(1, max(0, (f["box"][0] - bx0) / w)), 3), round(min(1, max(0, (f["box"][1] - by0) / h)), 3),
                                           round(min(1, max(0, (f["box"][2] - bx0) / w)), 3), round(min(1, max(0, (f["box"][3] - by0) / h)), 3)]} for f in mine]
        how = "checked on the art"
    else:
        x0, y0, x1, y1 = c["bbox"]
        prot = [{"who": hd["who"], "box": [round((hd["box"][0] - x0) / (x1 - x0), 3), round((hd["box"][1] - y0) / (y1 - y0), 3),
                                             round((hd["box"][2] - x0) / (x1 - x0), 3), round((hd["box"][3] - y0) / (y1 - y0), 3)]} for hd in c["heads"]]
        how = "storyboard positions (check against the art)"
    entry = {"src": "art/" + name, "label": f"Page {num} panel {i}", "size": [w, h], "protect": prot,
             "from": str(src.relative_to(proj)) if src.is_relative_to(proj) else str(src), "faces": how}
    lib = [e for e in lib if e["src"] != entry["src"]] + [entry]
    assign[c["id"]] = {"image": entry["src"], "take": src.stem}
(art / "library.json").write_text(json.dumps(lib, indent=1, ensure_ascii=False))
(art / "assignments.json").write_text(json.dumps(assign, indent=1))
# rebuild THIS project's pages. A project made in the app has its storyboard in board.json (tools/build_spec.mjs); only the old
# hand-built sample is rebuilt by build_board.py. (Until 20 Nov 2026 that sample was rebuilt whatever project was cut.)
if (proj / "board.json").exists():
    subprocess.check_call(["node", str(APP / "tools/build_spec.mjs"), str(proj)], stdout=subprocess.DEVNULL)
elif proj.parent == (APP / "page-editor/samples").resolve() and (APP / "tools/build_board.py").exists():  # the hand-built sample, where there is one
    subprocess.check_call(["/usr/bin/python3", str(APP / "tools/build_board.py")], stdout=subprocess.DEVNULL)
print(f"page {num}: {len(cells)} panels cut ({'on the drawn borders' if fitted or len(found) == len(cells) else 'on the guide'}; faces: {how})")
print(json.dumps({"boxes": boxes, "fit": fit.get(page["id"])}))
