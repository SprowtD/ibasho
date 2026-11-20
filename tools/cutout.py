#!/usr/bin/python3
"""Cut a figure out of its plain background, for a break-out (a figure that stands above the panel borders).

  cutout.py <picture on a plain flat background> <out.png> [edge]

The background is whatever colour runs round the picture's edge. Everything joined to the edge in that colour becomes clear;
white inside the figure's outline stays white (it must hide the panel behind it). `edge` (pixels at 1024 wide, default 9)
leaves that much of the background round the figure as a clean rim, the way a cut-out sticker has one, so the figure reads
against any panel art; 0 cuts on the outline. The result is trimmed to the figure. Prints one line of JSON: {"w", "h", "share"}.
"""
import json, sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter


def cut(src, out, edge=9):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    k = w / 1024.0
    # the background colour: the most common colour round the edge
    rim = list(im.crop((0, 0, w, 3)).getdata()) + list(im.crop((0, h - 3, w, h)).getdata()) + list(im.crop((0, 0, 3, h)).getdata()) + list(im.crop((w - 3, 0, w, h)).getdata())
    q = lambda c: tuple(v // 8 for v in c)
    counts = {}
    for c in rim:
        counts[q(c)] = counts.get(q(c), 0) + 1
    top = max(counts, key=counts.get)
    if counts[top] < len(rim) * 0.6:
        sys.exit("This picture has no plain background round its edge to cut away.")
    near_rim = [c for c in rim if q(c) == top]
    bg = tuple(sum(c[i] for c in near_rim) // len(near_rim) for i in range(3))
    # pixels close to the background colour
    diff = ImageChops.difference(im, Image.new("RGB", im.size, bg))
    r, g, b = diff.split()
    far = ImageChops.lighter(ImageChops.lighter(r, g), b)
    near = far.point(lambda v: 255 if v < 22 else 0)
    # the flood must not leak through a small gap in the outline: shrink the open area a little first, flood from the edge, grow it back
    gap = max(3, int(round(11 * k)) | 1)  # closes gaps up to about 10 pixels at 1024 wide
    tight = near.filter(ImageFilter.MinFilter(gap))
    pad = Image.new("L", (w + 2, h + 2), 255)
    pad.paste(tight, (1, 1))
    ImageDraw.floodfill(pad, (0, 0), 128)
    outside = pad.crop((1, 1, w + 1, h + 1)).point(lambda v: 255 if v == 128 else 0)
    outside = ImageChops.multiply(outside.filter(ImageFilter.MaxFilter(gap)), near)  # back to the outline, never into the figure
    figure = ImageChops.invert(outside)
    share = sum(figure.histogram()[128:]) / float(w * h)
    if share < 0.02 or share > 0.97:
        sys.exit("The figure could not be told from its background (it fills %d%% of the picture)." % round(share * 100))
    e = int(round(edge * k))
    alpha = figure.filter(ImageFilter.MaxFilter(2 * e + 1)) if e > 0 else figure.filter(ImageFilter.MinFilter(3))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.8 * k))
    res = im.convert("RGBA")
    if e > 0:  # the rim is the page's white, whatever the background colour was
        white = Image.new("RGBA", im.size, (255, 255, 255, 255))
        res = Image.composite(res, white, figure.filter(ImageFilter.GaussianBlur(0.6 * k)))
    res.putalpha(alpha)
    box = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    res = res.crop(box)
    res.save(out, "PNG", optimize=True)
    print(json.dumps({"w": res.width, "h": res.height, "share": round(share, 3)}))


if __name__ == "__main__":
    cut(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 9)
