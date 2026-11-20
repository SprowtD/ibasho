#!/usr/bin/env python3
"""The Toner, first part: flat greys -> real screentone, made by code at the page's final size, kept as layers with masks.

Why (TODO.md, 19 Nov 2026, item 6 and reference I, a working manga artist): when the image model draws the dots inside
the picture, tone changes from panel to panel, cannot be edited, and can moire when the picture is scaled into its panel.
So the Artist draws line art with FLAT GREYS where tone goes, and this tool turns each grey into screentone:

  * at the page's final size (the picture is scaled into its panel FIRST, the dots are made after, so dots are never resampled);
  * with ONE line count and ONE angle for the whole chapter (60 lines at 45 degrees to start), laid on the page's own
    grid, so every panel matches and dots run on across panel borders;
  * as a separate layer for each tone of each panel, with a mask. The tone itself is never destroyed: taking tone away
    is painting the mask black, and it can be painted back.

No model is used and nothing is paid for. Needs Pillow and numpy (the app already needs both).

  toner.py panel  <picture> <out dir> [--box x0,y0,x1,y1] [--name "panel 2"]   one panel picture -> layers
  toner.py page   <project dir> <page number> <out dir>                        every drawn panel of a page -> layers + the flat page
                  [--saved <file>]   the page as the person last saved it is used by itself (page-editor/saved/<project>.json);
                                     name another saved file here, or "" for the built page only
                  [--by-id]          one folder a panel named by the panel's id (what the app uses), each with its flat-<n>.png
                  [--only <panel id>] tone that one panel again and leave the others as they are
                  the page is named by its number, or by its id (a page made in the editor has no number in the built file)
  toner.py strokes <panel layer dir> <strokes.json>                            scraping and painting back, done by hand -> a new flat picture
  toner.py flatten <layer dir> <out.png>                                       layers -> one picture (what the export will do)
  toner.py check  <picture or layer dir>                                       dots already drawn into a picture? layers on one line count?
  toner.py moire  <exported page or a folder of page-NN.png>                   a measured moire test: is a second set of dots lying over the first?

Chapter settings: <project dir>/toner.json  {"lines": 60, "angle": 45, "page_inches": 5.83, "page_px": 2048, "kind": "dots"}
  lines        the line count: rows of dots to the inch on the printed page (higher = finer)
  kind         dots (screentone dots) or noise (a fine grain, no dots) for the flat greys; a shade from light to dark is always dots
               (the app sets lines and kind from the screen: Art, Screentone)
  page_inches  how wide the printed page is taken to be (5.83 in = A5); with page_px it gives the dot spacing in pixels

Layers written for a panel (layers.json lists them, named the way a manga artist names tone layers):
  lines.png                  the line art, black on clear
  tone-20.png + mask-20.png  "panel 2, dots 60 lines 20%": the tone over the WHOLE panel, and the mask that shows it
  tone-gradient.png + mask-gradient.png   "panel 2, gradient 60 lines": dots that grow with the grey of a shaded area
  strokes.json               what the person scraped away or painted back by hand: {"size": [w, h], "strokes": [{"tool", "size", "points"}]}
                             tool = soft (a soft scrape) | hatch (a cross-hatch scrape) | back (paint the tone back).
                             The masks are never changed by it: the strokes are laid over them at flatten time, so every one can be undone,
                             and "Tone again" keeps them.
"""
import json
import math
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

APP = Path(__file__).resolve().parent.parent
DEFAULTS = {"lines": 60, "angle": 45, "page_inches": 5.83, "page_px": 2048}
LEVELS = [10, 20, 30, 40, 50, 60]  # the chapter's tones, in percent of black
BLACK, WHITE = 0.22, 0.93  # darker than BLACK is line or solid black; lighter than WHITE is paper


def settings(project=None, **over):
    s = dict(DEFAULTS)
    if project and (Path(project) / "toner.json").exists():
        s.update(json.loads((Path(project) / "toner.json").read_text()))
    s.update({k: v for k, v in over.items() if v is not None})
    s["period"] = s["page_px"] / (s["page_inches"] * s["lines"])  # pixels from one row of dots to the next
    return s


def dots(box, density, st):
    """Screentone over a box of the page, as 0..1 ink. `density` is one number, or an array the size of the box
    (a gradient). The dots sit on the PAGE's grid, so two panels side by side share one pattern."""
    x0, y0, x1, y1 = box
    ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    a = math.radians(st["angle"]); p = st["period"]
    u = (xs * math.cos(a) + ys * math.sin(a)) / p
    v = (-xs * math.sin(a) + ys * math.cos(a)) / p
    fu, fv = u - np.floor(u) - 0.5, v - np.floor(v) - 0.5
    d = np.clip(np.asarray(density, dtype=np.float32), 0, 1)
    # a round dot whose area is the density; past about 78% the dots touch, so the paper is drawn as round holes instead
    r_dot = np.sqrt(np.minimum(d, 0.5) / math.pi)
    r = np.sqrt(fu * fu + fv * fv)
    ink = np.clip((r_dot - r) * p + 0.5, 0, 1)
    if np.any(d > 0.5):
        gu, gv = np.abs(fu) - 0.5, np.abs(fv) - 0.5  # distance to the cell corner, where the holes sit
        rh = np.sqrt(gu * gu + gv * gv)
        hole = np.clip((np.sqrt(np.maximum(1 - d, 0) / math.pi) - rh) * p + 0.5, 0, 1)
        ink = np.where(d > 0.5, 1 - hole, ink)
    return ink


def noise(box, density, seed=7):
    """Noise tone: random grain of the given density (the same grain everywhere on the page for one seed)."""
    x0, y0, x1, y1 = box
    ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.uint64)
    M = np.uint64(0xFFFFFFFF)
    h = (xs * np.uint64(374761393) + ys * np.uint64(668265263) + np.uint64(seed * 2654435761 % 4294967296)) & M
    h = ((h ^ (h >> np.uint64(13))) * np.uint64(1274126177)) & M
    return (((h ^ (h >> np.uint64(16))) & M).astype(np.float64) / 4294967295.0 < np.asarray(density)).astype(np.float32)


def _img(a):
    return Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8), "L")


def _arr(im):
    return np.asarray(im, dtype=np.float32) / 255.0


def _open(mask, r):
    """Drop anything thinner than about 2r pixels (the grey fringe of a pen line is not tone), keep the rest as it was."""
    im = _img(mask.astype(np.float32))
    return _arr(im.filter(ImageFilter.MinFilter(2 * r + 1)).filter(ImageFilter.MaxFilter(2 * r + 1))) > 0.5


def _grow(mask, r):
    return _arr(_img(mask.astype(np.float32)).filter(ImageFilter.MaxFilter(2 * r + 1))) > 0.5


def _areas(mask):
    """Separate areas of a mask -> (labels, count). scipy when it is there; otherwise a plain flood, one area at a time."""
    try:
        from scipy import ndimage
        return ndimage.label(mask)
    except Exception:  # no scipy on this computer
        labels = np.zeros(mask.shape, dtype=np.int32); left = mask.copy(); n = 0
        while left.any() and n < 60:
            n += 1; y, x = np.argwhere(left)[0]; cur = np.zeros_like(mask); cur[y, x] = True
            while True:
                nxt = (_arr(_img(cur.astype(np.float32)).filter(ImageFilter.MaxFilter(9))) > 0.5) & left
                if nxt.sum() == cur.sum():
                    break
                cur = nxt
            labels[cur] = n; left &= ~cur
        return labels, n


def grey(picture):
    """A picture as 8-bit grey: clear areas are paper (white), and 16-bit greys are brought down to 8."""
    im = picture if isinstance(picture, Image.Image) else Image.open(picture)
    if im.mode in ("I;16", "I;16L", "I;16B", "I"):
        return im.point(lambda v: v / 256).convert("L")
    if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA"); paper = Image.new("RGBA", im.size, (255, 255, 255, 255)); paper.alpha_composite(im); im = paper
    return im.convert("L")


def fit(picture, w, h, focus=(0.5, 0.5), zoom=1.0):
    """The picture scaled and cropped into a panel of w x h final pixels (the same cover-crop the page uses)."""
    im = grey(picture)
    iw, ih = im.size
    scale = max(w / iw, h / ih) * max(zoom, 1e-6)
    cw, ch = min(w / scale, iw), min(h / scale, ih)
    x = max(0.0, min(focus[0] * iw - cw / 2, iw - cw)); y = max(0.0, min(focus[1] * ih - ch / 2, ih - ch))  # never below 0: a picture that exactly fills the panel gives -0.00000000000006
    return im.resize((w, h), Image.LANCZOS, box=(x, y, x + cw, y + ch))


def tone_panel(picture, out, box=None, name="panel", st=None, focus=(0.5, 0.5), zoom=1.0, kind="dots", cover=None):
    """One panel picture -> lines.png, tone and mask layers, layers.json. Returns the list of layers.
    cover: for a cut-out (a break-out), what of the box the figure covers; kept as alpha.png, and the flat picture is clear outside it."""
    st = st or settings()
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    if box is None:
        w, h = Image.open(picture).size; box = (0, 0, w, h)
    box = tuple(int(round(v)) for v in box); w, h = box[2] - box[0], box[3] - box[1]
    L = _arr(fit(picture, w, h, focus, zoom))
    r = max(2, round(0.0035 * st["page_px"]))
    # The tone UNDER the pen. Only INK is lifted off (dark pen lines and their soft edge, thinner than about 2r pixels), which
    # leaves the flat grey it was drawn over: hatching across a grey wall stays one grey wall, and tone runs under lines.
    # A small or thin GREY shape (a ripple on water, a fold's shadow, a strand of hair) is not ink: it stays, and gets its dots.
    # (Until 19 Nov 2026 everything thin was lifted off, grey or black. On a real picture the ripples then stayed flat grey
    # beside the dots, and toned areas had blocky edges.)
    pen = _grow(L < 0.34, 2)
    closed = _arr(_img(L).filter(ImageFilter.MaxFilter(2 * r + 1)).filter(ImageFilter.MinFilter(2 * r + 1)))
    under = np.where(pen, closed, L)
    soft = _arr(_img(under).filter(ImageFilter.GaussianBlur(1.6)))
    # A SOLID BLACK shape is often drawn as charcoal, not pure black: its darkness wanders either side of BLACK. Pixel by pixel
    # that left holes: the part just lighter than BLACK was neither kept as black nor given tone, and came out white in blocks
    # (seen on a real picture, 20 Nov 2026: a black pool ball). So a dark area is judged whole: when a fair part of it is as
    # dark as black, all of it is solid black. A dark GREY area with no black in it is still tone.
    black_area = np.zeros(L.shape, dtype=bool)
    dark = soft < 0.34; dl, dn = _areas(dark)
    if dn:
        size = np.bincount(dl.ravel(), minlength=dn + 1); seeds = np.bincount(dl.ravel(), weights=(soft < BLACK + 0.03).ravel(), minlength=dn + 1)
        keep = seeds > 0.25 * size; keep[0] = False; black_area = keep[dl]
        black_area = black_area | (_grow(black_area, 3) & (L < 0.5))  # and its soft edge, so no white hairline is left inside its outline
    raw = (soft > BLACK + 0.03) & (soft < WHITE) & ~black_area
    blur = lambda m, px: _arr(_img(m.astype(np.float32)).filter(ImageFilter.GaussianBlur(px)))
    # a hairline of grey (the soft edge of solid black) is not tone: opened with a ROUND brush, so edges stay smooth, then
    # pulled in a little: the blur above spreads a grey edge, and tone must not peep out past its outline
    grey = (blur(blur(raw, 2.0) > 0.9, 2.0) > 0.1) & raw
    grey = (blur(grey, 1.2) > 0.82) & grey
    dens = 1 - soft
    solid = _grow((under < BLACK) | black_area, 2)  # solid black: tone tucks a little way under its edge, so no white hairline shows
    levels = np.array(LEVELS, dtype=np.float32) / 100
    # every separate grey area is one tone: FLAT (one of the chapter's levels) or SHADED (a gradient), by how far its grey ranges
    labels, count = _areas(grey)
    flat = {pct: np.zeros_like(grey) for pct in LEVELS}; shaded = np.zeros_like(grey)
    try:
        from scipy import ndimage
    except Exception:
        ndimage = None
    if ndimage is not None and count:
        idx = np.arange(1, count + 1)
        size = ndimage.sum(grey, labels, idx)
        core = (blur(grey, float(r)) > 0.9) & grey  # well away from its edges, where the outline and the neighbour bleed in
        csize = ndimage.sum(core, labels, idx); cl = np.where(core, labels, 0)
        use_core = csize > 50
        with np.errstate(invalid="ignore", divide="ignore"):  # an area with no core has no core figures: its whole-area ones are used
            med = np.where(use_core, ndimage.median(dens, cl, idx), ndimage.median(dens, labels, idx))
        # which layer each area goes to: 0 none (a speck), 1..n a flat level, -1 the gradient
        to = np.zeros(count + 1, dtype=np.int32)
        for k in range(count):
            if size[k] < 30:
                continue
            to[k + 1] = int(np.abs(levels - med[k]).argmin()) + 1
            if size[k] > 0.002 * grey.size:  # only an area of some size can be a shade from light to dark: measured the careful way
                vals = dens[cl == k + 1] if use_core[k] else dens[labels == k + 1]
                lo, hi = np.percentile(vals, [5, 95])
                if hi - lo > 0.07:
                    to[k + 1] = -1
        where = to[labels]
        shaded = where == -1
        for i, pct in enumerate(LEVELS):
            flat[pct] = where == i + 1
    else:  # no scipy on this computer: one area at a time, and the very small ones are left alone
        for k in range(1, count + 1):
            a = labels == k
            if a.mean() < 0.002:
                continue
            core = _arr(_img(a.astype(np.float32)).filter(ImageFilter.MinFilter(2 * r + 1))) > 0.5
            vals = dens[core] if core.sum() > 50 else dens[a]
            lo, hi = np.percentile(vals, [5, 95])
            if hi - lo > 0.07:
                shaded |= a
            else:
                flat[LEVELS[int(np.abs(levels - np.median(vals)).argmin())]] |= a
    layers = []
    for pct in LEVELS:
        m = flat[pct]
        if m.mean() < 0.002:
            continue
        m = m | (_grow(m, 3) & solid)
        tone = noise(box, pct / 100) if kind == "noise" else dots(box, pct / 100, st)
        label = f"{name}, noise grey {pct}%" if kind == "noise" else f"{name}, dots {st['lines']} lines {pct}%"
        _img(tone).save(out / f"tone-{pct}.png"); _img(m.astype(np.float32)).save(out / f"mask-{pct}.png")
        layers.append({"name": label, "kind": kind, "percent": pct, "lines": st["lines"], "angle": st["angle"], "period_px": round(st["period"], 3),
                       "tone": f"tone-{pct}.png", "mask": f"mask-{pct}.png", "share": round(float(m.mean()), 4)})
    if shaded.mean() >= 0.002:
        m = shaded | (_grow(shaded, 3) & solid)
        tone = dots(box, _arr(_img(dens).filter(ImageFilter.GaussianBlur(r))), st)
        _img(tone).save(out / "tone-gradient.png"); _img(m.astype(np.float32)).save(out / "mask-gradient.png")
        layers.append({"name": f"{name}, gradient {st['lines']} lines", "kind": "gradient", "lines": st["lines"], "angle": st["angle"], "period_px": round(st["period"], 3),
                       "tone": "tone-gradient.png", "mask": "mask-gradient.png", "share": round(float(m.mean()), 4)})
    # the line art: whatever is darker than the tone under it (pen lines over grey, pen lines on paper), and solid black
    alpha = np.where((under > BLACK) & ~black_area, np.clip((under - L) / np.maximum(under - 0.06, 0.05), 0, 1), 1 - L)
    alpha = np.where(alpha < 0.06, 0, alpha)  # paper grain is not ink
    lines = Image.merge("LA", (_img(np.zeros_like(L)), _img(alpha)))
    lines.save(out / "lines.png")
    doc = {"name": name, "box": list(box), "size": [w, h], "lines_file": "lines.png", "settings": {k: st[k] for k in ("lines", "angle", "page_inches", "page_px")}, "layers": layers}
    if cover is not None:
        cover.convert("L").save(out / "alpha.png"); doc["alpha_file"] = "alpha.png"
    elif (out / "alpha.png").exists():
        (out / "alpha.png").unlink()
    (out / "layers.json").write_text(json.dumps(doc, indent=1))
    return doc


TOOLS = ("soft", "hatch", "back")


def clean_strokes(doc, size=None):
    """Strokes as the tool keeps them: known tools, sane sizes, points inside the panel; scaled when the panel has changed size."""
    doc = doc if isinstance(doc, dict) else {"strokes": doc}
    was = doc.get("size") or size; out = []
    kx, ky = (size[0] / was[0], size[1] / was[1]) if size and was and was[0] and was[1] else (1.0, 1.0)
    for s in (doc.get("strokes") or [])[:400]:
        if not isinstance(s, dict) or s.get("tool") not in TOOLS:
            continue
        pts = [[round(float(p[0]) * kx, 1), round(float(p[1]) * ky, 1)] for p in (s.get("points") or [])[:2000] if isinstance(p, (list, tuple)) and len(p) == 2]
        if pts:
            out.append({"tool": s["tool"], "size": max(4.0, min(600.0, float(s.get("size") or 40) * (kx + ky) / 2)), "points": pts})
    return {"size": list(size or was or [0, 0]), "strokes": out}


def scrape_field(size, strokes):
    """How much tone the hand has taken away at each pixel, 0..1, from the strokes in the order they were made.
    A soft scrape has a feathered edge. A cross-hatch scrape cuts crossing white lines, the way a blade drawn two ways over
    tone does. Painting back puts the tone back under the brush (it undoes scraping; it cannot add tone where there was none)."""
    w, h = size; S = np.zeros((h, w), dtype=np.float32); grid = None
    for s in strokes:
        width = int(round(s["size"])); m = Image.new("L", (w, h), 0); d = ImageDraw.Draw(m); pts = [tuple(p) for p in s["points"]]
        if len(pts) > 1:
            d.line(pts, fill=255, width=width, joint="curve")
        for x, y in (pts[0], pts[-1]):
            d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=255)
        if s["tool"] == "hatch":
            if grid is None:
                grid = np.mgrid[0:h, 0:w].astype(np.float32)
            p = min(30.0, max(14.0, width / 12.0)); t = p * 0.38; ys, xs = grid  # fine lines whatever the brush: a blade's cuts, not a lattice
            cut = (((xs + ys * 0.55) % p) < t) | (((xs * 0.55 - ys) % p) < t)  # two sets of lines that cross at an angle, not a square grid
            S = np.maximum(S, _arr(m) * cut)
        else:
            if s["tool"] == "soft":
                S = np.maximum(S, _arr(m.filter(ImageFilter.GaussianBlur(max(1.0, width * 0.22)))))  # a feathered edge
            else:
                S = S * (1 - _arr(m.filter(ImageFilter.GaussianBlur(max(1.0, width * 0.06)))))  # painting back is firm: under the brush the tone is whole again
    return S


def flatten_panel(layer_dir):
    """Lines over tones through their masks, on white: what the export will do. A mask painted black takes tone away; nothing is lost.
    What the person scraped or painted back by hand (strokes.json) is laid over the masks here, and can always be undone."""
    d = Path(layer_dir); doc = json.loads((d / "layers.json").read_text())
    w, h = doc["size"]; ink = np.zeros((h, w), dtype=np.float32)
    for ly in doc["layers"]:
        ink = np.maximum(ink, _arr(Image.open(d / ly["tone"])) * _arr(Image.open(d / ly["mask"]).convert("L")))
    if (d / "strokes.json").exists():
        st = clean_strokes(json.loads((d / "strokes.json").read_text()), [w, h])
        if st["strokes"]:
            ink = ink * (1 - scrape_field((w, h), st["strokes"]))
    ink = np.maximum(ink, _arr(Image.open(d / doc["lines_file"]).getchannel("A")))
    flat = _img(1 - ink)
    if doc.get("alpha_file"):  # a cut-out: clear where the figure is not
        flat = Image.merge("LA", (flat, Image.open(d / doc["alpha_file"]).convert("L")))
    return flat, doc


def write_flat(layer_dir):
    """The panel flattened into flat-<n>.png, a new number each time (so a screen never shows an old one). -> the file's name"""
    d = Path(layer_dir); n = 0
    for p in d.glob("flat-*.png"):
        try:
            n = max(n, int(p.stem.split("-")[1]))
        except ValueError:
            pass
        p.unlink()
    name = f"flat-{n + 1}.png"; flatten_panel(d)[0].save(d / name); return name


def set_strokes(layer_dir, doc):
    """Keep the hand's strokes with the panel and flatten it again. -> {"flat", "strokes"}"""
    d = Path(layer_dir); size = json.loads((d / "layers.json").read_text())["size"]
    st = clean_strokes(doc, size)
    (d / "strokes.json").write_text(json.dumps(st))
    return {"flat": write_flat(d), "strokes": len(st["strokes"])}


def baked_dots(picture):
    """Are screentone dots already drawn into this picture? Dots are a lattice: sharp, isolated peaks in the picture's
    spectrum in TWO directions at one spacing. Pen hatching repeats in one direction only, and a straight edge is a
    ridge, not a peak, so neither counts. -> {"baked": bool, "period_px": spacing found, "strength": how far it stands out}"""
    im = Image.open(picture).convert("L") if not isinstance(picture, Image.Image) else picture.convert("L")
    n = 256; iw, ih = im.size
    if iw < n or ih < n:
        im = im.resize((max(iw, n), max(ih, n)), Image.BICUBIC); iw, ih = im.size
    yy, xx = np.mgrid[-n // 2:n // 2, -n // 2:n // 2]; rad = np.sqrt(xx * xx + yy * yy); ang = np.degrees(np.arctan2(yy, xx)) % 180
    band = (rad > n / 14) & (rad < n / 2.4)  # repeats every 2.4 to 14 pixels
    win = np.outer(np.hanning(n), np.hanning(n))
    best = {"baked": False, "period_px": None, "strength": 0.0}
    tiles = [(x, y) for y in range(0, ih - n + 1, n // 2) for x in range(0, iw - n + 1, n // 2)]
    for x, y in tiles[:: max(1, len(tiles) // 60)]:
        t = _arr(im.crop((x, y, x + n, y + n)))
        if t.std() < 0.012:
            continue  # blank paper or solid black
        f = np.abs(np.fft.fftshift(np.fft.fft2((t - t.mean()) * win)))
        floor = np.median(f[band]) + 0.002 * f.max() + 1e-9
        fb = np.where(band, f, 0); peaks = []
        for _ in range(8):  # the strongest peaks, each compared with what lies along its own ray (a ridge fails this)
            k = int(np.argmax(fb)); py, px = divmod(k, n); v = fb[py, px]
            if v <= 0:
                break
            r0 = rad[py, px]; a0 = ang[py, px]
            near = np.minimum(np.abs(ang - a0), 180 - np.abs(ang - a0)) < 4
            ray = near & (rad > 0.35 * r0) & (rad < 0.72 * r0)  # an edge is a ridge that is stronger nearer the centre; a lattice peak stands alone
            iso = v / (f[ray].max() + 1e-9) if ray.any() else 0
            if iso > 2.5 and v / floor > 8:
                peaks.append((v / floor, r0, a0))
            fb[max(py - 4, 0):py + 5, max(px - 4, 0):px + 5] = 0
        for i, (s1, r1, a1) in enumerate(peaks):
            for s2, r2, a2 in peaks[i + 1:]:
                if abs(r1 - r2) < 0.12 * r1 and min(abs(a1 - a2), 180 - abs(a1 - a2)) > 25:
                    strength = float(min(s1, s2))
                    if strength > best["strength"]:
                        best = {"baked": True, "period_px": round(n / float(r1), 2), "strength": round(strength, 1)}
    return best


def moire(picture, n=512):
    """A measured moire test on a finished page (the exported picture). Screentone is ONE lattice of dots: in the picture's
    spectrum, peaks at the dot spacing in two directions, and their multiples. Moire is what the eye sees when a SECOND
    lattice lies over it (dots drawn into a picture under the Toner's, two line counts meeting, dots that were resampled):
    then there are strong peaks that do not sit on the first lattice, and the pattern the eye sees repeats at the
    distance between the two. Pen hatching and edges are ridges, not lattices, and do not count.
    -> {"moire": bool, "strength": the second set against the first (0.3 and over is flagged; a clean page is under 0.1),
        "every_px": how often the pattern repeats, "at": [x, y] the middle of the worst place, "tiles": places with dots that were measured}"""
    im = (Image.open(picture) if not isinstance(picture, Image.Image) else picture).convert("L"); iw, ih = im.size
    out = {"moire": False, "strength": 0.0, "every_px": None, "at": None, "tiles": 0}
    if iw < n or ih < n:
        return out
    yy, xx = np.mgrid[-n // 2:n // 2, -n // 2:n // 2]; rad = np.sqrt(xx * xx + yy * yy); ang = np.degrees(np.arctan2(yy, xx)) % 180
    win = np.outer(np.hanning(n), np.hanning(n)); wsum = win.sum()
    band = (rad > n / 16) & (rad < n / 2.05)  # repeats every 2 to 16 pixels: where dots live
    polar = lambda p: (math.hypot(p[1], p[2]), math.degrees(math.atan2(p[2], p[1])) % 180)
    apart = lambda a, b: min(abs(a - b), 180 - abs(a - b))
    def look(t0):
        """One tile (its mean taken off, windowed) -> None when it has no lattice of dots, else (first peak, strength, repeat in px)."""
        f = np.abs(np.fft.fftshift(np.fft.fft2(t0))) / wsum * 2
        fb = np.where(band, f, 0); floor = np.median(f[band]) + 1e-9; peaks = []
        for _ in range(40):
            k = int(np.argmax(fb)); py, px = divmod(k, n); v = fb[py, px]
            if v < 0.004 or v < 12 * floor:
                break
            peaks.append((float(v), px - n // 2, py - n // 2))
            fb[max(py - 3, 0):py + 4, max(px - 3, 0):px + 4] = 0
        if not peaks or peaks[0][0] < 0.04:
            return None
        v1 = peaks[0]; r1, a1 = polar(v1)
        v2 = next((p for p in peaks[1:] if abs(polar(p)[0] - r1) < 0.12 * r1 and apart(polar(p)[1], a1) > 25 and p[0] > 0.3 * v1[0]), None)
        if v2 is None:
            return None  # no lattice of dots here
        off = []; best = (0.0, None)
        for p in peaks[1:]:
            miss = min(math.hypot(p[1] - i * v1[1] - j * v2[1], p[2] - i * v1[2] - j * v2[2]) for i in range(-4, 5) for j in range(-4, 5))
            if miss <= 4.0:
                continue  # on the lattice: the dots themselves
            r0, a0 = polar(p)
            ray = (np.minimum(np.abs(ang - a0), 180 - np.abs(ang - a0)) < 4) & (rad > 0.3 * r0) & (rad < 0.8 * r0)
            if ray.any() and p[0] / (f[ray].max() + 1e-9) < 2.5:
                continue  # a ridge (an edge, pen hatching), not a dot
            off.append((p[0] / v1[0], r0, a0, miss))
        for i, (s1, ra, aa, m1) in enumerate(off):  # a second set of dots is a lattice too: two peaks at one spacing, in two directions
            for s2, rb, ab, m2 in off[i + 1:]:
                if abs(ra - rb) < 0.12 * ra and apart(aa, ab) > 25:
                    # close beside the first lattice's own peaks lies the smear every edge of a toned area makes: there it must be stronger to count
                    st = min(s1, s2) * (1.0 if min(m1, m2) > 8 else 0.6)
                    if st > best[0]:
                        best = (st, n / min(m1, m2))
        return v1, best[0], best[1]

    for y in range(0, ih - n + 1, n // 2):
        for x in range(0, iw - n + 1, n // 2):
            t = _arr(im.crop((x, y, x + n, y + n)))
            if t.std() < 0.012:
                continue  # blank paper or solid black
            t0 = t - t.mean(); got = look(t0 * win)
            if got is None:
                continue
            out["tiles"] += 1
            if got[1] >= 0.3:
                # Moire needs the two sets of dots in the SAME place. Lettering beside a toned area is regular too (letters at an even
                # pitch) and is not moire: so the tile is looked at again through a mask of where the first set of dots really is.
                F = np.fft.fftshift(np.fft.fft2(t0)); v1 = got[0]
                near = np.exp(-((xx - v1[1]) ** 2 + (yy - v1[2]) ** 2) / (2 * 6.0 ** 2))
                amp = np.abs(np.fft.ifft2(np.fft.ifftshift(F * near)))  # how strongly the dots are there, place by place
                mask = np.clip((amp / (amp.max() + 1e-9) - 0.3) / 0.25, 0, 1)
                if mask.mean() < 0.03:
                    continue
                again = look((t - (t * mask).sum() / (mask.sum() + 1e-9)) * mask * win)
                got = again if again is not None else (v1, 0.0, None)
            if got[1] > out["strength"]:
                out.update({"strength": round(float(got[1]), 3), "every_px": round(got[2], 1) if got[2] else None, "at": [x + n // 2, y + n // 2]})
    out["moire"] = out["strength"] >= 0.3
    return out


def check_layers(layer_dir):
    """One line count and one angle through every layer under this folder? (Different ones moire where they meet.)"""
    docs = [json.loads(p.read_text()) for p in sorted(Path(layer_dir).rglob("layers.json"))]
    seen = {(ly["lines"], ly["angle"]) for d in docs for ly in d["layers"] if ly["kind"] != "noise"}
    return {"panels": len(docs), "layers": sum(len(d["layers"]) for d in docs), "line_counts": sorted({s[0] for s in seen}), "angles": sorted({s[1] for s in seen}), "ok": len(seen) <= 1}


def cutout_in_box(picture, w, h, flip=False):
    """A cut-out figure scaled whole into a box of w x h final pixels, centred (the way the page places a break-out).
    -> (the figure on white paper, as grey; what of the box it covers)"""
    im = Image.open(picture).convert("RGBA")
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    k = min(w / im.width, h / im.height); nw, nh = max(1, round(im.width * k)), max(1, round(im.height * k))
    on_paper = grey(im).resize((nw, nh), Image.LANCZOS); cover = im.getchannel("A").resize((nw, nh), Image.LANCZOS)  # scaled apart, so no dark fringe from clear pixels
    at = ((w - nw) // 2, (h - nh) // 2)
    L = Image.new("L", (w, h), 255); L.paste(on_paper, at); A = Image.new("L", (w, h), 0); A.paste(cover, at)
    return L, A


def saved_copy(project):
    """Where the app keeps the person's saved edits of this chapter (gutters dragged, a template applied, pan and zoom)."""
    root = Path(os.environ.get("STUDIO_SAVED") or APP / "page-editor/saved")
    return root / (Path(project).resolve().name + ".json")


def page_geometry(project, number, saved=None):
    """The drawn panels of a page with their boxes at the final size, from the app's own page geometry.
    The page is taken as the person last saved it when there is a saved copy of this same storyboard (the built
    spec.json does not have their layout edits); `saved` names another saved file, or "" for the built page only."""
    js = """
require(process.argv[1]); const R=globalThis.PageRender, fs=require('fs');
const spec=JSON.parse(fs.readFileSync(process.argv[2],'utf8')), k=+process.argv[4]/R.W;
const want=process.argv[3], pick=(pages)=>pages.find(q=>q.id===want)||(/^\\d+$/.test(want)?(pages.find(q=>q.number===+want)||pages[+want-1]):null);
let p=pick(spec.pages), from='built';
try { const sv=JSON.parse(fs.readFileSync(process.argv[5],'utf8')); if (Array.isArray(sv.pages) && (sv.boardAt||'')===(spec.boardAt||'')) { const q=p?sv.pages.find(x=>x.id&&x.id===p.id):pick(sv.pages); if (q&&q.layout) { p=q; from='saved'; } } } catch (e) { /* no saved copy */ }
if (!p||(!p.layout&&!p.art)) { console.error('There is no such page with panels.'); process.exit(2); }
if (!p.layout) { console.log(JSON.stringify([{n:1,id:'page',kind:'page',image:p.art,focus:[0.5,0.5],zoom:1,box:[0,0,Math.round(R.W*k),Math.round(R.H*k)],from,page:p.id||''}])); process.exit(0); }
const cells=R.allPanels(p.layout).map((c,i)=>({n:i+1,id:c.panel.id,image:c.panel.image||null,focus:c.panel.focus||[0.5,0.5],zoom:c.panel.zoom||1,box:c.bbox.map(v=>Math.round(v*k)),from,page:p.id||''}));
(p.layout.breakouts||[]).forEach((b,i)=>{ if (b&&b.id&&b.image&&Array.isArray(b.box)) cells.push({n:i+1,id:b.id,kind:'breakout',image:b.image,flip:!!b.flip,box:[b.box[0]*R.W,b.box[1]*R.H,b.box[2]*R.W,b.box[3]*R.H].map(v=>Math.round(v*k)),from,page:p.id||''}); });
console.log(JSON.stringify(cells))"""
    st = settings(project)
    sv = saved_copy(project) if saved is None else saved
    out = subprocess.check_output(["node", "-e", js, str(APP / "page-editor/render.js"), str(Path(project) / "spec.json"), str(number), str(st["page_px"]), str(sv)])
    return json.loads(out), st


def tone_page(project, number, out, saved=None, by_id=False, only=None):
    """by_id: one folder a panel, named by the panel's id, each with its own flat-<n>.png (what the app shows and exports);
    only: tone that one panel again and keep what page.json says of the others."""
    cells, st = page_geometry(project, number, saved)
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    W = st["page_px"]; H = round(W * 1.5)
    safe = lambda s: "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in str(s))
    page = Image.new("L", (W, H), 255); done = []
    old = {}
    if only and (out / "page.json").exists():
        old = {p.get("id"): p for p in json.loads((out / "page.json").read_text()).get("panels", [])}
    for c in cells:
        if not c["image"]:
            continue
        if only and c.get("id") != only:
            if c.get("id") in old:
                done.append(old[c["id"]])
            continue
        kind_of = c.get("kind") or "panel"; how = "noise" if st.get("kind") == "noise" else "dots"
        if kind_of == "breakout":  # a figure that stands above the panel borders: toned on the page's own grid, in its place, and still a cut-out
            bw, bh = c["box"][2] - c["box"][0], c["box"][3] - c["box"][1]
            if bw < 4 or bh < 4:
                continue
            d = out / (safe(c["id"]) if by_id else f"breakout-{c['n']:02d}")
            figure, cover = cutout_in_box(Path(project) / c["image"], bw, bh, c.get("flip"))
            doc = tone_panel(figure, d, c["box"], f"break-out {c['n']}", st, kind=how, cover=cover)
            rec = {"panel": c["n"], "id": c.get("id"), "kind": "breakout", "flip": bool(c.get("flip")), "layers": [ly["name"] for ly in doc["layers"]], "baked_dots": baked_dots(grey(Path(project) / c["image"]))}
        else:
            d = out / (safe(c["id"]) if by_id and c.get("id") else f"panel-{c['n']:02d}")
            doc = tone_panel(Path(project) / c["image"], d, c["box"], "the page" if kind_of == "page" else f"panel {c['n']}", st, c["focus"], c["zoom"], kind=how)
            rec = {"panel": c["n"], "id": c.get("id"), "layers": [ly["name"] for ly in doc["layers"]], "baked_dots": baked_dots(Path(project) / c["image"])}
            if kind_of == "page":
                rec["kind"] = "page"
        if by_id:
            rec.update({"dir": d.name, "flat": write_flat(d), "box": c["box"], "image": c["image"], "focus": c.get("focus", [0.5, 0.5]), "zoom": c.get("zoom", 1), "px": W,
                        "strokes": len(clean_strokes(json.loads((d / "strokes.json").read_text()), doc["size"])["strokes"]) if (d / "strokes.json").exists() else 0})
        else:
            flat, _ = flatten_panel(d)
            page.paste(flat.getchannel(0), (c["box"][0], c["box"][1]), flat.getchannel("A")) if flat.mode == "LA" else page.paste(flat, (c["box"][0], c["box"][1]))
        done.append(rec)
    if not by_id:
        page.save(out / "page.png")
    (out / "page.json").write_text(json.dumps({"page": number, "settings": {k: st[k] for k in ("lines", "angle", "page_inches", "page_px")}, "panels": done, "check": check_layers(out)}, indent=1))
    return done


def main(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(__doc__); return 0
    cmd, args = argv[1], argv[2:]
    opt = lambda k: args[args.index("--" + k) + 1] if "--" + k in args else None
    if cmd == "panel":
        box = tuple(float(v) for v in opt("box").split(",")) if opt("box") else None
        st = settings(opt("project"), lines=opt("lines") and float(opt("lines")), angle=opt("angle") and float(opt("angle")))
        doc = tone_panel(args[0], args[1], box, opt("name") or "panel", st, kind=opt("kind") or "dots")
        flatten_panel(args[1])[0].save(Path(args[1]) / "flat.png")
        print(json.dumps({"layers": [ly["name"] for ly in doc["layers"]], "baked_dots": baked_dots(args[0])}, indent=1))
    elif cmd == "page":
        print(json.dumps(tone_page(args[0], args[1], args[2], opt("saved"), "--by-id" in args, opt("only")), indent=1))
    elif cmd == "strokes":
        print(json.dumps(set_strokes(args[0], json.loads(Path(args[1]).read_text()))))
    elif cmd == "flatten":
        flatten_panel(args[0])[0].save(args[1]); print(args[1])
    elif cmd == "moire":  # one exported page, or a folder of them (page-NN.png): one line of JSON, a result a page
        p = Path(args[0]); files = sorted(p.glob("page-*.png")) if p.is_dir() else [p]
        print(json.dumps([dict(moire(f), name=f.name) for f in files]))
    elif cmd == "check":
        p = Path(args[0]); print(json.dumps(check_layers(p) if p.is_dir() else baked_dots(p), indent=1))
    else:
        print(__doc__); return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
