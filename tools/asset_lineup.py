#!/usr/bin/python3
"""Asset checker, step 1: line-ups. Nothing is drawn by a model here.
Usage: asset_lineup.py <project dir> <pages json (saved copy or spec.json)> [--fallback spec.json] [--only name,name] [--roots dir:dir]
Every picture named by the pages or the bible must be inside the project (or one of --roots, plus the book folder its bank/ links to):
a saved document never points this tool at any other file on the disk.
For every cast member, place and prop of the project, gather where they appear in the pictures in use now, cut a
head crop and a figure crop from each (faces come from art/library.json "protect", fractions of the picture), and
lay them out as numbered tiles in art/check/<slug>-N.jpg (8 tiles a picture at most). Writes art/check/lineups.json:
{ checked: {panel: image}, groups: [{name, kind, desc, sheet, lineups: [file], tiles: [{n, panel, page, image, face}]}] }
"""
import json, re, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

proj = Path(sys.argv[1]); pages = json.loads(Path(sys.argv[2]).read_text())["pages"]
import os
ROOTS = [proj] + ([Path(r) for r in sys.argv[sys.argv.index("--roots") + 1].split(":") if r] if "--roots" in sys.argv else []) + [Path(os.environ.get("STUDIO_SERIES") or Path(__file__).resolve().parent.parent / "page-editor" / "series")]
def inside(root, rel):
    """root/rel when it stays inside root (links followed: inside root or one of ROOTS), else None."""
    rel = str(rel or "")
    if not rel or "\0" in rel: return None
    p = Path(rel)
    if p.is_absolute():  # only the anime check passes whole paths, and only inside its --roots
        if not any(_within(r, p) for r in ROOTS[1:]): return None
    elif ".." in p.parts: return None
    else: p = Path(root) / p
    try: real = p.resolve()
    except OSError: return None
    return p if any(_within(r, real) for r in [Path(root)] + ROOTS) else None
def _within(root, p):
    try: Path(p).resolve().relative_to(Path(root).resolve()); return True
    except (ValueError, OSError): return False
only = None
if "--only" in sys.argv: only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
load = lambda p, d: json.loads(p.read_text()) if p.exists() else d
bible = load(proj / "bible.json", {}); lib = {e["src"]: e for e in load(proj / "art" / "library.json", [])}
out = proj / "art" / "check"; out.mkdir(parents=True, exist_ok=True)
for old in out.glob("*-[0-9]*.jpg"): old.unlink()
slug = lambda s: re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "x"
low = lambda s: str(s).lower().strip()

def leaves(rows, acc):
    for row in rows or []:
        for q in row.get("panels", []):
            if q.get("rows"): leaves(q["rows"], acc)
            else: acc.append(q)
    return acc

fallback = {}  # the saved copy may not have a picture that landed since it was last opened: spec.json has it
if "--fallback" in sys.argv:
    for p in json.loads(Path(sys.argv[sys.argv.index("--fallback") + 1]).read_text())["pages"]:
        lay = p.get("layout") or {}
        for q in leaves(lay.get("rows"), []) + list(lay.get("insets") or []):
            if q.get("id") and q.get("image"): fallback[q["id"]] = q["image"]
panels = []  # in reading order: {panel, page, image, who:[names], text}
for i, p in enumerate(pages):
    lay = p.get("layout")
    if not lay: continue
    for q in leaves(lay.get("rows"), []) + list(lay.get("insets") or []):
        if not q.get("image") and fallback.get(q.get("id")): q["image"] = fallback[q["id"]]
        if not q.get("image") or not inside(proj, q["image"]) or not inside(proj, q["image"]).exists(): continue
        b = q.get("board") or {}
        def side(w):  # where the storyboard puts a person's head: at[0] is 0 at the panel's left edge, 1 at its right (either reading direction)
            try: x = float((w.get("at") or [0.5])[0])
            except (TypeError, ValueError): x = 0.5
            return "left" if x < 0.4 else "right" if x > 0.6 else "middle"
        staging = "; ".join(f'{w.get("name", "")} on the {side(w)}' + (f', facing {w["facing"]}' if w.get("facing") in ("left", "right", "camera", "away") else "") for w in b.get("who") or [] if w.get("name"))
        panels.append({"panel": q.get("id", ""), "page": p.get("number", i + 1), "image": q["image"], "who": [w.get("name", "") for w in b.get("who") or []],
                       "text": " ".join(str(b.get(k) or "") for k in ("action", "note", "place")), "staging": staging})

def font(size):
    for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        try: return ImageFont.truetype(f, size)
        except OSError: pass
    return ImageFont.load_default()
F = font(34); TH = 520; GAP = 14

def fit(im, h):  # scale to a height
    return im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)

def person_tile(im, box):
    W, H = im.size
    if box:
        x0, y0, x1, y1 = box[0] * W, box[1] * H, box[2] * W, box[3] * H; w, h = x1 - x0, y1 - y0; cx = (x0 + x1) / 2
        m = max(w, h) * 0.45
        head = im.crop((max(0, round(x0 - m)), max(0, round(y0 - m)), min(W, round(x1 + m)), min(H, round(y1 + m))))
        fig = im.crop((max(0, round(cx - 2.4 * w)), max(0, round(y0 - 0.5 * h)), min(W, round(cx + 2.4 * w)), min(H, round(y0 + 7 * h))))
        a, b = fit(head, TH), fit(fig, TH)
        if a.width > TH: a = a.resize((TH, round(a.height * TH / a.width)), Image.LANCZOS)
        t = Image.new("RGB", (a.width + 6 + b.width, TH), "white"); t.paste(a, (0, 0)); t.paste(b, (a.width + 6, 0)); return t
    return fit(im, TH)  # no face labelled: the whole picture

def sheet_of(c):
    if not c: return ""
    if c.get("sheet") and inside(proj, c["sheet"]) and inside(proj, c["sheet"]).exists(): return str(inside(proj, c["sheet"]))
    if c.get("ref") and bible.get("ref_root") and not Path(str(c["ref"])).is_absolute() and ".." not in Path(str(c["ref"])).parts and (Path(bible["ref_root"]) / c["ref"]).exists(): return str(Path(bible["ref_root"]) / c["ref"])
    return ""

groups = []
def add_group(name, kind, c, tiles):  # tiles: [(panel dict, PIL tile, face bool)]
    if not tiles: return
    files, meta = [], []
    for k in range(0, len(tiles), 8):
        part = tiles[k:k + 8]; rows = [part[:4], part[4:]]; rows = [r for r in rows if r]
        width = max(sum(t[1].width for t in r) + GAP * (len(r) + 1) for r in rows); height = len(rows) * (TH + 46 + GAP) + GAP
        sheet = Image.new("RGB", (width, height), (238, 238, 238)); d = ImageDraw.Draw(sheet); y = GAP
        for r in rows:
            x = GAP
            for j, (pn, t, face) in enumerate(r):
                n = len(meta) + 1
                d.rectangle((x, y, x + t.width, y + 44), fill=(20, 20, 20)); d.text((x + 8, y + 3), f"{n}   page {pn['page']} · {pn['panel']}"[: max(6, t.width // 19)], fill="white", font=F)
                sheet.paste(t, (x, y + 46)); x += t.width + GAP
                meta.append({"n": n, "panel": pn["panel"], "page": pn["page"], "image": pn["image"], "face": face})
            y += TH + 46 + GAP
        if sheet.width > 2400: sheet = sheet.resize((2400, round(sheet.height * 2400 / sheet.width)), Image.LANCZOS)
        f = out / f"{slug(name)}-{len(files) + 1}.jpg"; sheet.save(f, quality=88); files.append("art/check/" + f.name)
    groups.append({"name": name, "kind": kind, "desc": str((c or {}).get("desc") or "") + ((" OTHER OUTFITS the story calls for (not faults): " + str(c["outfits"])) if (c or {}).get("outfits") else ""), "sheet": sheet_of(c), "sheetUrl": (c or {}).get("thumb") or (c or {}).get("sheet") or "", "lineups": files, "tiles": meta})

cache = {}
def pic(src):
    if src not in cache: cache[src] = Image.open(inside(proj, src)).convert("RGB")
    return cache[src]

names = list((bible.get("cast") or {}).keys())
for p in panels:  # someone drawn but not in the cast list still gets a line-up
    for f in (lib.get(p["image"]) or {}).get("protect") or []:
        if f.get("who") and not any(low(n) == low(f["who"]) for n in names): names.append(f["who"])
for name in names:
    if only and name not in only: continue
    tiles = []
    for p in panels:
        faces = [f for f in (lib.get(p["image"]) or {}).get("protect") or [] if low(f.get("who")) == low(name) and f.get("box")]
        if faces: tiles.append((p, person_tile(pic(p["image"]), faces[0]["box"]), True))
        elif any(low(w) == low(name) for w in p["who"]): tiles.append((p, person_tile(pic(p["image"]), None), False))
    add_group(name, "person", (bible.get("cast") or {}).get(name), tiles)
for field, kind in (("places", "place"), ("props", "prop")):
    for name, c in (bible.get(field) or {}).items():
        if only and name not in only: continue
        rx = re.compile(r"(?<![A-Za-z0-9])" + re.escape(name) + r"(?![A-Za-z0-9])", re.I)
        tiles = [(p, fit(pic(p["image"]), TH), False) for p in panels if rx.search(p["text"])]
        add_group(name, kind, c, tiles)

res = {"checked": {p["panel"]: p["image"] for p in panels}, "panels": [{k: p[k] for k in ("panel", "page", "image", "who")} | {"action": p["text"][:400], "staging": p["staging"]} for p in panels], "groups": groups}
(out / "lineups.json").write_text(json.dumps(res, indent=1))
print(json.dumps({"groups": len(groups), "tiles": sum(len(g["tiles"]) for g in groups), "pictures": len(panels)}))
