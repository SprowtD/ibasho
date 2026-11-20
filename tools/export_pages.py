#!/usr/bin/python3
"""One export for the manga side: the exported pages of a chapter as a PDF, PNGs or JPEGs.

  export_pages.py <folder of page-NN.png> <out file> '<options as JSON>'

Options: format (pdf | print | png | jpeg), paper (for print: b5 | a5 | us), name (start of every file name), pages (list of page positions, 1 = first;
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
    return _write(objs, info)


def _write(objs, info):
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


MM = 72 / 25.4  # points in a millimetre
PAPERS = {"b5": (182, 257), "a5": (148, 210), "us": (168.3, 260.4)}  # the cut page, in mm: B5 (manga magazines, most small-press books), A5, US comic book
BLEED, MARK_GAP, MARK_LEN = 3.0, 2.0, 5.0  # mm: how far the picture may run past the cut; the trim marks stand clear of it


def pdf_print(pictures, paper="b5", title="", rtl=False):
    """A PDF for a printer. Each sheet is the cut page (TrimBox) with 3 mm of bleed round it (BleedBox) and trim marks at the
    corners. The page picture is 2 wide by 3 tall and paper is squatter, so the whole picture is fitted to the HEIGHT of the
    bleed (nothing of the page is cut off): a full-page picture then runs off the top and the foot, and the sides stay paper."""
    tw, th = (v * MM for v in PAPERS.get(paper, PAPERS["b5"]))
    bl, pad = BLEED * MM, (BLEED + MARK_GAP + MARK_LEN + 1) * MM
    W, H = tw + 2 * pad, th + 2 * pad
    objs, n = {}, len(pictures)
    kids = [3 + i * 3 for i in range(n)]
    prefs = b" /ViewerPreferences << /Direction /R2L >>" if rtl else b""
    objs[1] = b"<< /Type /Catalog /Pages 2 0 R /PageLayout /SinglePage" + prefs + b" >>"
    objs[2] = b"<< /Type /Pages /Count %d /Kids [%s] >>" % (n, b" ".join(b"%d 0 R" % k for k in kids))
    x0, y0, x1, y1 = pad, pad, pad + tw, pad + th  # the cut page on the sheet
    g, m = MARK_GAP * MM + bl, MARK_LEN * MM
    marks = b"".join(b"%.2f %.2f m %.2f %.2f l S\n" % seg for seg in [
        (x0, y0 - g, x0, y0 - g - m), (x0 - g, y0, x0 - g - m, y0), (x1, y0 - g, x1, y0 - g - m), (x1 + g, y0, x1 + g + m, y0),
        (x0, y1 + g, x0, y1 + g + m), (x0 - g, y1, x0 - g - m, y1), (x1, y1 + g, x1, y1 + g + m), (x1 + g, y1, x1 + g + m, y1)])
    for i, (data, w, h) in enumerate(pictures):
        p = kids[i]
        ph = th + 2 * bl; pw = ph * w / h  # the whole picture, as tall as the bleed
        if pw > tw + 2 * bl:  # a picture wider than the page's shape: fitted to the width instead
            pw = tw + 2 * bl; ph = pw * h / w
        px, py = pad + (tw - pw) / 2, pad + (th - ph) / 2
        draw = b"q %.2f 0 0 %.2f %.2f %.2f cm /Im0 Do Q\n0.25 w 0 G\n" % (pw, ph, px, py) + marks
        objs[p] = (b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] /BleedBox [%.2f %.2f %.2f %.2f] /TrimBox [%.2f %.2f %.2f %.2f] /Contents %d 0 R /Resources << /XObject << /Im0 %d 0 R >> >> >>"
                   % (W, H, x0 - bl, y0 - bl, x1 + bl, y1 + bl, x0, y0, x1, y1, p + 1, p + 2))
        objs[p + 1] = b"<< /Length %d >>\nstream\n%s\nendstream" % (len(draw), draw)
        objs[p + 2] = b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n%s\nendstream" % (w, h, len(data), data)
    info = 3 + n * 3
    objs[info] = b"<< /Producer (Ibasho)" + (b" /Title " + pdf_text(title) if title else b"") + b" >>"
    return _write(objs, info)


def main(folder, out, o):
    fmt = o.get("format", "pdf")
    if fmt not in ("pdf", "png", "jpeg", "print"):
        sys.exit("The format is pdf, print, png or jpeg.")
    names = picked(folder, o.get("pages"))
    if not names:
        sys.exit("None of those pages is exported yet.")
    stem, size, q = o.get("name") or "chapter", o.get("size", "full"), o.get("quality", "best")
    if fmt == "print":  # for a printer: always the full picture at the best quality
        pics = []
        for n in names:
            im = picture(os.path.join(folder, n), "full")
            pics.append((jpeg(im, "best"), im.width, im.height))
        data, kind = pdf_print(pics, o.get("paper", "b5"), o.get("title", ""), bool(o.get("rtl"))), "pdf"
    elif fmt == "pdf":
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
