#!/usr/bin/env python3
"""The Toner's first part (tools/toner.py), on pictures drawn here by code: flat greys become screentone layers with masks.
Run: /usr/bin/python3 tests/manga-direction/toner_test.py [folder to keep the pictures in]
Writes only to a temp folder (or the folder given). No model, nothing paid."""
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

APP = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(APP / "tools"))
import toner  # noqa: E402

passed = failed = 0


def ok(cond, what):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1; print("  FAIL:", what)


def picture(w=900, h=640):
    """A stand-in for what the Artist will draw: pen lines, flat greys where tone goes, one shaded area. No dots."""
    S = 3; im = Image.new("L", (w * S, h * S), 255); d = ImageDraw.Draw(im)
    g = lambda pct: round(255 * (1 - pct / 100))
    grad = np.tile(np.linspace(0.12, 0.55, w * S, dtype=np.float32), (150 * S, 1))  # a shaded floor: light to dark
    im.paste(Image.fromarray(np.uint8(255 * (1 - grad))), (0, (h - 150) * S))
    d.rectangle([60 * S, 60 * S, 380 * S, 440 * S], fill=g(20), outline=0, width=4 * S)        # a wall panel, 20%
    d.ellipse([470 * S, 90 * S, 730 * S, 350 * S], fill=g(40), outline=0, width=5 * S)          # a head of hair, 40%
    d.polygon([(520 * S, 350 * S), (700 * S, 350 * S), (800 * S, 490 * S), (430 * S, 490 * S)], fill=255, outline=0)
    d.line([(430 * S, 490 * S), (800 * S, 490 * S)], fill=0, width=4 * S)
    for x in range(100, 360, 40):                                                                 # pen hatching over the 20% area
        d.line([(x * S, 120 * S), ((x + 20) * S, 400 * S)], fill=0, width=2 * S)
    d.line([(0, (h - 150) * S), (w * S, (h - 150) * S)], fill=0, width=4 * S)
    return im.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.4)).convert("RGB")


def main():
    keep = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    import time
    tmp = (keep / time.strftime("run-%H%M%S")) if keep else Path(tempfile.mkdtemp(prefix="ibasho-toner-"))  # a fresh folder every run: nothing is deleted
    tmp.mkdir(parents=True, exist_ok=True)
    src = tmp / "greys.png"; picture().save(src)
    st = toner.settings()
    ok(abs(st["period"] - 2048 / (5.83 * 60)) < 1e-6, "60 lines on an A5-wide page of 2048 px: dots every %.2f px" % st["period"])

    # ---- one panel at its final size (bigger than the picture: the picture is scaled first, the dots are made after)
    box = (120, 200, 1920, 1480)
    doc = toner.tone_panel(src, tmp / "panel", box, "panel 2", st)
    names = [ly["name"] for ly in doc["layers"]]
    ok("panel 2, dots 60 lines 20%" in names and "panel 2, dots 60 lines 40%" in names, "the flat greys became named tone layers: %s" % names)
    ok(any(ly["kind"] == "gradient" for ly in doc["layers"]), "the shaded floor became a gradient layer")
    ok(len(names) == 3, "and nothing else did (pen lines and their soft edges are not tone): %s" % names)
    w, h = doc["size"]; sx, sy = w / 900, h / 640
    for ly in doc["layers"]:
        t, m = Image.open(tmp / "panel" / ly["tone"]), Image.open(tmp / "panel" / ly["mask"])
        ok(t.size == (w, h) and m.size == (w, h), "%s: tone and mask are at the panel's final size" % ly["name"])
    reg = lambda x0, y0, x1, y1: (slice(int(y0 * sy), int(y1 * sy)), slice(int(x0 * sx), int(x1 * sx)))
    mask20 = toner._arr(Image.open(tmp / "panel" / "mask-20.png")); mask40 = toner._arr(Image.open(tmp / "panel" / "mask-40.png"))
    ok(mask20[reg(80, 80, 360, 420)].mean() > 0.97 and mask20[reg(480, 100, 720, 340)].mean() < 0.02, "the 20% mask covers the wall and not the hair")
    ok(mask40[reg(540, 150, 660, 290)].mean() > 0.97 and mask40[reg(80, 80, 360, 420)].mean() < 0.02, "the 40% mask covers the hair and not the wall")
    ok(mask20[reg(520, 370, 700, 470)].mean() < 0.02 and mask40[reg(520, 370, 700, 470)].mean() < 0.02, "white paper gets no tone")
    # the tone layer is the WHOLE panel: the mask alone decides where it shows (so scraping is never destructive)
    tone20 = toner._arr(Image.open(tmp / "panel" / "tone-20.png"))
    ok(abs(tone20.mean() - 0.20) < 0.015, "the 20%% tone layer is 20%% ink over the whole panel (%.3f)" % tone20.mean())
    ok(abs(toner._arr(Image.open(tmp / "panel" / "tone-40.png")).mean() - 0.40) < 0.02, "and the 40% layer 40%")
    flat, _ = toner.flatten_panel(tmp / "panel"); flat.save(tmp / "panel-flat.png"); F = 1 - toner._arr(flat)
    hair = F[reg(540, 150, 660, 290)].mean(); wall = F[reg(64, 64, 96, 110)].mean()  # a corner of the wall with no hatching
    ok(abs(wall - 0.20) < 0.04, "the wall reads as 20%% grey (%.3f)" % wall)
    lines = toner._arr(Image.open(tmp / "panel" / "lines.png").getchannel("A"))
    ok(lines[reg(60, 60, 380, 64)].mean() > 0.6 and lines[reg(120, 200, 300, 300)].mean() > 0.02 and lines[reg(64, 64, 96, 110)].mean() < 0.01, "the line layer has the outline and the hatching, and no grey")
    ok(mask20[reg(100, 120, 360, 400)].mean() > 0.99, "the tone runs under the hatching: one unbroken mask")
    ok(abs(hair - 0.40) < 0.03, "flattened, the hair reads as 40%% grey from a distance (%.3f)" % hair)
    lo, hi = F[reg(40, 520, 160, 620)].mean(), F[reg(740, 520, 860, 620)].mean()
    ok(lo < 0.25 and hi > 0.42 and hi - lo > 0.2, "the gradient runs light to dark (%.2f to %.2f)" % (lo, hi))
    binar = ((F > 0.05) & (F < 0.95))[reg(540, 150, 660, 290)].mean()
    ok(binar < 0.45, "tone is black dots on white, not grey (%.0f%% of the hair is in between, the dots' soft edges)" % (100 * binar))
    # the dots are on the chapter's one grid: the spacing found in the flat page is the settings' spacing
    found = toner.baked_dots(flat)
    ok(found["baked"] and abs(found["period_px"] - st["period"]) < 0.4, "measured dot spacing %.2f px, set %.2f px" % (found["period_px"] or 0, st["period"]))

    # ---- scraping: paint the mask, the tone itself is untouched, and painting it back restores the picture
    before = (tmp / "panel" / "tone-40.png").read_bytes(); mfile = tmp / "panel" / "mask-40.png"; keepmask = mfile.read_bytes()
    m = Image.open(mfile).convert("L"); ImageDraw.Draw(m).ellipse([int(560 * sx), int(170 * sy), int(640 * sx), int(250 * sy)], fill=0); m.save(mfile)
    F2 = 1 - toner._arr(toner.flatten_panel(tmp / "panel")[0])
    ok(F2[reg(575, 185, 625, 235)].mean() < 0.02 and F2[reg(650, 250, 680, 280)].mean() > 0.3, "tone scraped away where the mask was painted, kept beside it")
    ok((tmp / "panel" / "tone-40.png").read_bytes() == before, "the tone layer itself was not changed")
    mfile.write_bytes(keepmask)
    ok(np.array_equal(np.asarray(toner.flatten_panel(tmp / "panel")[0]), np.asarray(flat)), "painting the mask back gives the same picture again")

    # ---- one pattern for the page: two panels side by side share the dots across the gutter
    a = toner.dots((100, 100, 400, 300), 0.3, st); b = toner.dots((250, 150, 600, 300), 0.3, st)
    ok(np.array_equal(a[50:200, 150:300], b[0:150, 0:150]), "where two panels' boxes overlap on the page the dots are identical")
    doc2 = toner.tone_panel(src, tmp / "panel-b", (1000, 300, 1900, 940), "panel 3", st)
    chk = toner.check_layers(tmp)
    ok(chk["ok"] and chk["line_counts"] == [60] and chk["panels"] == 2, "every layer is on the chapter's one line count: %s" % chk)
    toner.tone_panel(src, tmp / "panel-c", (0, 0, 900, 640), "panel 4", toner.settings(lines=45))
    ok(not toner.check_layers(tmp)["ok"], "a layer on another line count is caught (it would moire where they meet)")

    # ---- dots already drawn into a picture (what the image model does today) are found; flat greys are not
    ok(not toner.baked_dots(src)["baked"], "a picture of flat greys has no dots in it: %s" % toner.baked_dots(src))
    ok(toner.baked_dots(flat)["baked"], "a picture with dots drawn in is flagged")
    pics = sorted((APP / "page-editor/samples").glob("*/art/*panel*.jpg"))[:6]  # only when a sample is beside the app
    if pics:
        res = [toner.baked_dots(p) for p in pics]
        print("  today's sample panels (the image model drew their dots):", [(p.name, r["baked"], r["period_px"]) for p, r in zip(pics, res)])
    # noise tone
    doc3 = toner.tone_panel(src, tmp / "panel-n", (0, 0, 900, 640), "panel 5", st, kind="noise")
    ok(any(ly["name"].startswith("panel 5, noise grey") for ly in doc3["layers"]), "noise tone can be asked for: %s" % [ly["name"] for ly in doc3["layers"]][:2])
    n20 = toner._arr(Image.open(tmp / "panel-n" / "tone-20.png")).mean()
    ok(abs(n20 - 0.20) < 0.02, "and is the right density (%.3f)" % n20)
    print(("FAILED" if failed else "ok") + "  toner, first part: %d passed" % passed + (", %d failed" % failed if failed else ""))
    if keep:
        print("  pictures kept in", tmp)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
