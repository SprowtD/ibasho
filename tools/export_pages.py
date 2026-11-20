#!/usr/bin/python3
"""One export for the manga side: the exported pages of a chapter as a PDF, PNGs or JPEGs.

  export_pages.py <folder of page-NN.png> <out file> '<options as JSON>'

Options: format (pdf | png | jpeg), name (start of every file name), pages (list of page positions, 1 = first;
empty = all), size (full = 2048 x 3072 | web = 1365 x 2048), quality (best | small), sets (0, or pictures a post:
folders post-01, post-02 ...), rtl (the PDF opens right to left), title (for the PDF).
The out file is a PDF, one picture (one page asked for), or a zip. Prints one line of JSON: {"kind", "pages"}.
"""
import io, json, os, re, sys, zipfile
from PIL import Image

SIZES = {"full": (2048, 3072), "web": (1365, 2048)}
QUALITY = {"best": 95, "small": 82}
PAGE_W = 432.0  # PDF page: 6 inches wide, the picture edge to edge (made for reading on a screen, no bleed)


def picked(folder, pages):
    names = sorted(n for n in os.listdir(folder) if re.fullmatch(r"page-\d+\.png", n))
    if pages:
        want = {int(p) for p in pages}
        names = [n for n in names if int(n[5:-4]) in want]
    return names


def picture(path, size):
    im = Image.open(path).convert("RGB")
    w, h = SIZES.get(size, SIZES["full"])
    if im.width > w or im.height > h:
        im.thumbnail((w, h), Image.LANCZOS)
    return im


def jpeg(im, quality):
    b = io.BytesIO()
    im.save(b, "JPEG", quality=QUALITY.get(quality, 95), optimize=True)
    return b.getvalue()


def png(im):
    b = io.BytesIO()
    im.save(b, "PNG", optimize=True)
    return b.getvalue()


def pdf_text(s):  # a PDF text string: UTF-16 with a byte order mark, as hex
    return b"<" + ("﻿" + s).encode("utf-16-be").hex().upper().encode() + b">"


def pdf(pictures, title="", rtl=False):
    """pictures: [(jpeg bytes, width, height)]. One page each, in order."""
    objs = {}  # number -> bytes
    n = len(pictures)
    kids = [3 + i * 3 for i in range(n)]  # page objects: 3, 6, 9 ...; then its content and its picture
    prefs = b" /ViewerPreferences << /Direction /R2L >>" if rtl else b""
    objs[1] = b"<< /Type /Catalog /Pages 2 0 R /PageLayout /SinglePage" + prefs + b" >>"
    objs[2] = b"<< /Type /Pages /Count %d /Kids [%s] >>" % (n, b" ".join(b"%d 0 R" % k for k in kids))
    for i, (data, w, h) in enumerate(pictures):
        p, ph = kids[i], PAGE_W * h / w
        draw = b"q %.2f 0 0 %.2f 0 0 cm /Im0 Do Q" % (PAGE_W, ph)
        objs[p] = b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] /Contents %d 0 R /Resources << /XObject << /Im0 %d 0 R >> >> >>" % (PAGE_W, ph, p + 1, p + 2)
        objs[p + 1] = b"<< /Length %d >>\nstream\n%s\nendstream" % (len(draw), draw)
        objs[p + 2] = b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n%s\nendstream" % (w, h, len(data), data)
    info = 3 + n * 3
    objs[info] = b"<< /Producer (Ibasho)" + (b" /Title " + pdf_text(title) if title else b"") + b" >>"
    out, at = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"), {}
    for k in sorted(objs):
        at[k] = len(out)
        out += b"%d 0 obj\n%s\nendobj\n" % (k, objs[k])
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (info + 1)
    for k in range(1, info + 1):
        out += b"%010d 00000 n \n" % at[k]
    out += b"trailer\n<< /Size %d /Root 1 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (info + 1, info, xref)
    return bytes(out)


def main(folder, out, o):
    fmt = o.get("format", "pdf")
    if fmt not in ("pdf", "png", "jpeg"):
        sys.exit("The format is pdf, png or jpeg.")
    names = picked(folder, o.get("pages"))
    if not names:
        sys.exit("None of those pages is exported yet.")
    stem, size, q = o.get("name") or "chapter", o.get("size", "full"), o.get("quality", "best")
    if fmt == "pdf":
        pics = []
        for n in names:
            im = picture(os.path.join(folder, n), size)
            pics.append((jpeg(im, q), im.width, im.height))
        data, kind = pdf(pics, o.get("title", ""), bool(o.get("rtl"))), "pdf"
    else:
        ext = "png" if fmt == "png" else "jpg"

        def one(n):
            im = picture(os.path.join(folder, n), size)
            return png(im) if fmt == "png" else jpeg(im, q)
        if len(names) == 1:
            data, kind = one(names[0]), ext
        else:
            per, b = int(o.get("sets") or 0), io.BytesIO()
            sets = (len(names) + per - 1) // per if per else 1
            with zipfile.ZipFile(b, "w", zipfile.ZIP_STORED) as z:
                for i, n in enumerate(names):
                    folder_in = f"post-{i // per + 1:02d}/" if sets > 1 else ""
                    z.writestr(f"{folder_in}{stem}-{n[:-4]}.{ext}", one(n))
            data, kind = b.getvalue(), "zip"
    with open(out, "wb") as f:
        f.write(data)
    print(json.dumps({"kind": kind, "pages": len(names)}))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], json.loads(sys.argv[3]) if len(sys.argv) > 3 else {})
