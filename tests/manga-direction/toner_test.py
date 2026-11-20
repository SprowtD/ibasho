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
    # ---- page mode reads the page as the person last saved it (a dragged gutter), not only the built spec
    proj = tmp / "proj"; proj.mkdir()
    layout = lambda w1: {"rows": [{"h": 1, "panels": [{"id": "a", "w": w1}, {"id": "b", "w": 1 - w1}]}]}
    (proj / "spec.json").write_text(json.dumps({"boardAt": "t1", "pages": [{"id": "p1", "number": 1, "layout": layout(0.5)}]}))
    saved = tmp / "saved.json"; saved.write_text(json.dumps({"boardAt": "t1", "pages": [{"id": "p1", "number": 1, "layout": layout(0.25)}]}))
    built, _ = toner.page_geometry(proj, 1, saved="")
    mine, _ = toner.page_geometry(proj, 1, saved=saved)
    wide = lambda cells, i: cells[i]["box"][2] - cells[i]["box"][0]
    ok(built[0]["from"] == "built" and abs(wide(built, 0) - wide(built, 1)) < 8, "with no saved copy the built page is used: %s" % [c["box"] for c in built])
    ok(mine[0]["from"] == "saved" and wide(mine, 1) > wide(mine, 0) * 2, "a dragged gutter in the saved copy moves the panel boxes: %s" % [c["box"] for c in mine])
    saved.write_text(json.dumps({"boardAt": "older", "pages": [{"id": "p1", "number": 1, "layout": layout(0.25)}]}))
    ok(toner.page_geometry(proj, 1, saved=saved)[0][0]["from"] == "built", "a saved copy of an older storyboard is not used")
    # ---- the hand: a soft scrape, a cross-hatch scrape, painting back. The masks are never changed; every stroke can be undone.
    d = tmp / "panel"; base = toner._arr(toner.flatten_panel(d)[0]); masks0 = {p.name: p.read_bytes() for p in d.glob("mask-*.png")}
    wall = reg(90, 150, 340, 380); P = lambda x, y: [x * sx, y * sy]; SZ = [w, h]  # inside the 20% wall; strokes are in the panel's own pixels
    ok(0.12 < 1 - base[wall].mean() < 0.3, "before scraping, the wall carries its tone (%.3f ink)" % (1 - base[wall].mean()))
    r1 = toner.set_strokes(d, {"size": SZ, "strokes": [{"tool": "soft", "size": 120 * sx, "points": [P(120, 200), P(320, 330)]}]})
    soft = toner._arr(Image.open(d / r1["flat"]))
    ok(r1["strokes"] == 1 and r1["flat"] == "flat-1.png" and (d / "flat-1.png").exists(), "a stroke is kept with the panel and a new flat picture is written: %s" % r1)
    mid = reg(200, 240, 240, 290)
    ok((1 - soft[mid].mean()) < (1 - base[mid].mean()) * 0.35, "a soft scrape takes the dots off under the brush (%.3f -> %.3f); pen lines stay" % (1 - base[mid].mean(), 1 - soft[mid].mean()))
    far = reg(480, 60, 720, 100)
    ok(np.array_equal(soft[far], base[far]), "and nothing changes away from the brush")
    ok(all((d / n).read_bytes() == b for n, b in masks0.items()), "the masks themselves are untouched: the scrape is laid over them")
    hair = reg(540, 170, 660, 270)  # inside the 40% hair
    r2 = toner.set_strokes(d, {"size": SZ, "strokes": [{"tool": "hatch", "size": 140 * sx, "points": [P(540, 220), P(660, 220)]}]})
    hat = toner._arr(Image.open(d / r2["flat"]))
    ink0, ink1 = 1 - base[hair].mean(), 1 - hat[hair].mean()
    ok(ink1 < ink0 * 0.75 and ink1 > ink0 * 0.2, "a cross-hatch scrape cuts white lines through the tone and leaves tone between them (%.3f -> %.3f)" % (ink0, ink1))
    ok(r2["flat"] == "flat-2.png" and not (d / "flat-1.png").exists(), "each flat picture has a new name, and the old one is cleared away")
    r3 = toner.set_strokes(d, {"size": SZ, "strokes": [{"tool": "soft", "size": 120 * sx, "points": [P(120, 200), P(320, 330)]}, {"tool": "back", "size": 200 * sx, "points": [P(120, 200), P(320, 330)]}]})
    back = toner._arr(Image.open(d / r3["flat"]))
    ok(np.abs(back[mid] - base[mid]).max() < 0.02, "painting back over a scrape brings the tone back as it was")
    r4 = toner.set_strokes(d, {"strokes": []})
    ok(np.array_equal(np.asarray(Image.open(d / r4["flat"])), np.uint8(np.clip(base * 255 + 0.5, 0, 255))), "with every stroke undone the panel is exactly as the Toner made it")
    junk = toner.clean_strokes({"size": [450, 320], "strokes": [{"tool": "erase-everything", "points": [[1, 1]]}, {"tool": "soft", "size": 99999, "points": [[10, 10], "x", [20, 20]]}, "no"]}, [900, 640])
    ok(len(junk["strokes"]) == 1 and junk["strokes"][0]["points"] == [[20.0, 20.0], [40.0, 40.0]] and junk["strokes"][0]["size"] <= 600, "strokes are cleaned, and scaled when the panel has changed size: %s" % junk)
    # ---- the app's page mode: one folder a panel by its id, each with its flat picture; one panel can be toned again alone
    Image.open(src).save(proj / "a.png"); Image.open(src).save(proj / "b.png")
    pg = {"id": "page-x", "layout": {"rows": [{"h": 1, "panels": [{"id": "a", "w": 1, "image": "a.png"}]}, {"h": 1, "panels": [{"id": "b", "w": 1, "image": "b.png", "focus": [0.3, 0.5]}, {"id": "c", "w": 1}]}]}}
    (proj / "spec.json").write_text(json.dumps({"boardAt": "t2", "pages": [{"id": "p1", "number": 1, "layout": layout(0.5)}]}))
    saved.write_text(json.dumps({"boardAt": "t2", "pages": [{"id": "p1", "number": 1, "layout": layout(0.5)}, pg]}))  # a page made in the editor: only in the saved copy
    outp = tmp / "tone-page"; res = toner.tone_page(proj, "page-x", outp, saved, by_id=True)
    ok([r["id"] for r in res] == ["a", "b"] and all((outp / r["dir"] / r["flat"]).exists() and r["px"] == 2048 and len(r["box"]) == 4 for r in res), "a page that exists only in the saved copy is toned by its id, one folder a drawn panel: %s" % [(r["id"], r["dir"], r["flat"], r["box"]) for r in res])
    fa = Image.open(outp / "a" / res[0]["flat"]); ok(fa.size == (res[0]["box"][2] - res[0]["box"][0], res[0]["box"][3] - res[0]["box"][1]), "the flat picture is the panel at its final size: %s" % (fa.size,))
    toner.set_strokes(outp / "a", {"size": list(fa.size), "strokes": [{"tool": "soft", "size": 80, "points": [[100, 100], [300, 300]]}]})
    again = toner.tone_page(proj, "page-x", outp, saved, by_id=True, only="b")
    ok([r["id"] for r in again] == ["a", "b"] and again[0]["flat"] == res[0]["flat"] and again[1]["flat"] != res[1]["flat"], "toning one panel again leaves the other as it was")
    whole = toner.tone_page(proj, "page-x", outp, saved, by_id=True)
    ok(whole[0]["strokes"] == 1, "toning the page again keeps what was scraped by hand")
    # ---- a solid black shape drawn as charcoal (its darkness wanders either side of "black") stays one solid shape: no white holes (a real picture, 20 Nov 2026)
    rng = np.random.default_rng(3); ch = np.full((600, 900), 1.0, dtype=np.float32); yy, xx = np.mgrid[0:600, 0:900]
    disc = (xx - 300) ** 2 + (yy - 300) ** 2 < 170 ** 2
    blot = toner._arr(toner._img(rng.random((600, 900)).astype(np.float32)).filter(ImageFilter.GaussianBlur(14)))
    ch[disc] = (0.17 + 0.09 * (blot - blot[disc].min()) / (np.ptp(blot[disc]) + 1e-9))[disc]  # 0.17 to 0.26, in soft patches
    ch[(xx > 560) & (xx < 840) & (yy > 150) & (yy < 450)] = 0.30  # beside it, a dark GREY area with no black in it
    toner._img(ch).save(tmp / "charcoal.png"); dch = toner.tone_panel(tmp / "charcoal.png", tmp / "charcoal", None, "panel 9", st)
    fl = 1 - toner._arr(toner.flatten_panel(tmp / "charcoal")[0]); inner = (xx - 300) ** 2 + (yy - 300) ** 2 < 150 ** 2
    ok(fl[inner].min() > 0.6 and fl[inner].mean() > 0.72, "a charcoal-black shape stays solid, with no white holes: darkest paper inside it %.2f, mean ink %.2f" % (1 - fl[inner].min(), fl[inner].mean()))
    gz = fl[180:420, 590:810]; ok(any("60%" in ly["name"] for ly in dch["layers"]) and ((gz > 0.9).mean() > 0.3 and (gz < 0.1).mean() > 0.1), "a dark grey area beside it, with no black in it, is still tone (dots): %s" % [ly["name"] for ly in dch["layers"]])
    # ---- the measured moire test on a finished page: a second set of dots over the first is found; clean tone, edges, pen hatching and a smaller copy are not
    bx = (0, 0, 1024, 1024); pic = lambda a: toner._img(1 - a); one = toner.dots(bx, 0.3, st)
    m = toner.moire(pic(one)); ok(not m["moire"] and m["strength"] < 0.12 and m["tiles"] == 9, "moire test, clean dots: none (%s)" % m["strength"])
    grad = np.tile(np.linspace(0.05, 0.6, 1024, dtype=np.float32), (1024, 1))
    ok(not toner.moire(pic(toner.dots(bx, grad, st)))["moire"], "moire test, a shade from light to dark: none")
    two = np.where(np.arange(1024)[None, :] >= 512, toner.dots(bx, 0.4, st), toner.dots(bx, 0.2, st))
    ok(not toner.moire(pic(two))["moire"], "moire test, two tones side by side on one grid: none")
    busy = pic(one).copy(); d = ImageDraw.Draw(busy); d.ellipse([200, 200, 800, 800], outline=0, width=8); d.rectangle([100, 500, 600, 900], fill=255, outline=0, width=6)
    for i in range(0, 1024, 37):
        d.line([(i, 0), (i + 300, 1024)], fill=0, width=3)
    ok(not toner.moire(busy)["moire"], "moire test, pen hatching, an outline and a white shape over tone: none")
    ok(not toner.moire(pic(one).resize((683, 683), Image.LANCZOS))["moire"], "moire test, the page at the smaller export size: none")
    for label, over in (("70 lines over 60", {"lines": 70}), ("the same dots turned 7 degrees", {"angle": 52})):
        st2 = toner.settings(None, **over); m = toner.moire(pic(np.maximum(one, toner.dots(bx, 0.2, st2))))
        ok(m["moire"] and m["strength"] >= 0.3 and m["every_px"] and m["at"], "moire test, %s: found, a pattern every %s px (%s)" % (label, m["every_px"], m["strength"]))
    from PIL import ImageFont
    words = Image.new("L", (1024, 1024), 255); dw = ImageDraw.Draw(words); words.paste(pic(one).crop((0, 0, 300, 1024)), (0, 0))
    for row in range(12):
        dw.text((340, 30 + row * 80), "MEDIUM LOW ANGLE HHHHHH " * 2, fill=40, font=ImageFont.load_default(size=44) if hasattr(ImageFont, "load_default") else None)
    m = toner.moire(words); ok(not m["moire"], "moire test, even rows of lettering beside a toned strip: none (%s)" % m["strength"])
    m = toner.moire(tmp / "panel-flat.png"); ok(not m["moire"] and m["tiles"] > 0, "moire test, the panel toned above: none (%s over %d places)" % (m["strength"], m["tiles"]))
    print(("FAILED" if failed else "ok") + "  toner, first part: %d passed" % passed + (", %d failed" % failed if failed else ""))
    if keep:
        print("  pictures kept in", tmp)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
