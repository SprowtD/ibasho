#!/usr/bin/python3
"""Book import: a long text file -> a series folder with every paragraph numbered and the chapters found.

Usage: /usr/bin/python3 tools/import_book.py <file> <series dir> [--name "Title"] [--code B01]
  file: .txt / .md (paragraphs split on blank lines), .docx, .epub, or a paragraphs.json already numbered
        ([{source_id, chapter_id, text}], ids like B01:CH001:P0019: kept exactly as they are).
Writes <series dir>/source/paragraphs.json  [{source_id, chapter_id, n, text, sha256}]   (n = place in the whole file)
       <series dir>/series.json             {name, code, source, words, chapters: [{id, number, title, kind, first, last,
                                              paragraphs, words, pages_est, opens}], notes: [...]}
A paragraph's id never changes once written: balloons and captions made from the book carry it back to the source.
No models are used: chapters are found from headings ("Chapter 3", "Prologue", # headings, Word heading styles).
Standard library only.
"""
import hashlib, html, json, re, sys, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

WORDS_PER_PAGE = 115   # measured on one book's drawn chapters (1,446 words -> 12 pages; 2,899 -> 26)
NUM = r"(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[- ]\w+)?|thirty(?:[- ]\w+)?|forty(?:[- ]\w+)?|fifty(?:[- ]\w+)?)"
CHAPTER = re.compile(rf"^\s*(chapter|ch\.|episode|ep\.)\s*{NUM}\b", re.I)
SPECIAL = re.compile(r"^\s*(prologue|epilogue|interlude|afterword|foreword|preface|introduction)\b[\s:.\-–—]*(.{0,80})$", re.I)
norm = lambda s: re.sub(r"[ \t ]+", " ", s.replace("\r", "")).strip()
words = lambda s: len(s.split())


def read_text(p):
    raw = p.read_bytes()
    for enc in ("utf-8-sig", "utf-16", "cp1252"):
        try: return raw.decode(enc)
        except UnicodeError: pass
    return raw.decode("utf-8", "replace")


def from_plain(p):
    """[(text, heading level or 0)] from .txt / .md. Blank lines separate paragraphs; a file with none is one line each."""
    t = read_text(p).replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n\s*\n", t) if re.search(r"\n\s*\n", t) else t.split("\n")
    out = []
    for b in blocks:
        lines = [l for l in b.split("\n") if l.strip()]
        if not lines: continue
        m = re.match(r"^(#{1,6})\s+(.*)$", lines[0])
        if m:  # a markdown heading is its own paragraph, even with text straight under it
            out.append((norm(m.group(2).rstrip("#")), len(m.group(1))))
            lines = lines[1:]
            if not lines: continue
        # hard-wrapped prose: lines of one paragraph are joined; verse or a list keeps its lines apart
        out.append((norm(" ".join(l.strip() for l in lines)), 0))
    return out


# A .docx or .epub is a zip: a small file can unpack to gigabytes (a zip bomb). Each part is read only up to MAX_PART, and a
# whole book only up to MAX_BOOK unpacked; the sizes the zip declares are checked first, and the bytes read are counted too.
MAX_PART, MAX_BOOK = 64 << 20, 256 << 20
class Zip:
    def __init__(self, p): self.z = zipfile.ZipFile(p); self.used = 0
    def __enter__(self): return self
    def __exit__(self, *a): self.z.close()
    def read(self, name):
        info = self.z.getinfo(name)
        if info.file_size > MAX_PART or self.used + info.file_size > MAX_BOOK: raise SystemExit("That book unpacks to more than Ibasho reads (a part over 64 MB or a book over 256 MB).")
        with self.z.open(info) as f: data = f.read(MAX_PART + 1)
        if len(data) > MAX_PART: raise SystemExit("That book unpacks to more than Ibasho reads.")
        self.used += len(data); return data


W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
def from_docx(p):
    with Zip(p) as z: root = ET.fromstring(z.read("word/document.xml"))
    out = []
    for para in root.iter(W + "p"):
        parts = []
        for el in para.iter():
            if el.tag == W + "t": parts.append(el.text or "")
            elif el.tag in (W + "tab",): parts.append(" ")
            elif el.tag in (W + "br", W + "cr"): parts.append(" ")
        text = norm("".join(parts))
        if not text: continue
        st = para.find(f"{W}pPr/{W}pStyle"); style = (st.get(W + "val") or "") if st is not None else ""
        m = re.match(r"(?i)heading\s*(\d)", style)
        out.append((text, int(m.group(1)) if m else (1 if style.lower() == "title" else 0)))
    return out


def from_epub(p):
    out = []
    with Zip(p) as z:
        opf = ET.fromstring(z.read("META-INF/container.xml")).find(".//{*}rootfile").get("full-path")
        pk = ET.fromstring(z.read(opf)); base = opf.rsplit("/", 1)[0] + "/" if "/" in opf else ""
        items = {i.get("id"): i.get("href") for i in pk.iter("{*}item")}
        for ref in pk.iter("{*}itemref"):
            href = items.get(ref.get("idref"))
            if not href: continue
            try: doc = z.read(base + href.split("#")[0]).decode("utf-8", "replace")
            except KeyError: continue
            doc = re.sub(r"(?is)<(script|style|head)\b.*?</\1>", " ", doc)
            for m in re.finditer(r"(?is)<(h[1-6]|p|li|blockquote|div)\b[^>]*>(.*?)</\1>", doc):
                tag, inner = m.group(1).lower(), m.group(2)
                if tag == "div" and re.search(r"(?i)<(p|div|h[1-6])\b", inner): continue  # a wrapper: its own blocks are read
                text = norm(html.unescape(re.sub(r"(?s)<[^>]+>", " ", re.sub(r"(?i)<br\s*/?>", " ", inner))))
                if text: out.append((text, int(tag[1]) if tag[0] == "h" else 0))
    return out


def chapter_title(text):
    """A chapter heading -> its display title, or None."""
    if len(text) > 120: return None
    if CHAPTER.match(text) or SPECIAL.match(text): return text
    return None


def split_chapters(paras, notes):
    """paras [(text, level)] -> [(title, kind, start index)]. kind: chapter | front | part (no headings found)."""
    hits = [i for i, (t, _) in enumerate(paras) if chapter_title(t)]
    # a contents list: chapter titles one after another with no text between, each named again later where the chapter starts
    later = lambda i: any(j > i and paras[j][0].lower() == paras[i][0].lower() for j in hits)
    toc = {i for k, i in enumerate(hits) if later(i) and ((k + 1 < len(hits) and hits[k + 1] == i + 1) or (k > 0 and hits[k - 1] == i - 1))}
    if toc: hits = [i for i in hits if i not in toc]; notes.append(f"A contents list of {len(toc)} lines was found at the front and left out of the chapters.")
    if len(hits) >= 1 and any(CHAPTER.match(paras[i][0]) for i in hits): starts = [(paras[i][0], "chapter", i) for i in hits]
    else:
        # no "Chapter N" lines: use the heading level (markdown # or a Word heading style) that occurs most, at least twice
        levels = {}
        for i, (t, lv) in enumerate(paras):
            if lv and len(t) <= 120: levels.setdefault(lv, []).append(i)
        best = max((lv for lv in levels if len(levels[lv]) >= 2), key=lambda lv: (len(levels[lv]), -lv), default=None)
        if best: starts = [(paras[i][0], "chapter", i) for i in levels[best]]
        else:
            # nothing to go on: even parts of about 3,000 words, cut at paragraph breaks
            total = sum(words(t) for t, _ in paras)
            if total <= 4500: return [("The whole text", "part", 0)]
            n = max(2, round(total / 3000)); goal = total / n; starts = [("Part 1", "part", 0)]; run = 0
            for i, (t, _) in enumerate(paras):
                if run >= goal * len(starts) and len(starts) < n: starts.append((f"Part {len(starts) + 1}", "part", i))
                run += words(t)
            notes.append(f"No chapter headings were found, so the text was cut into {len(starts)} parts of about {round(goal):,} words.")
            return starts
    if starts[0][2] > 0:  # title page, dedication, contents list: kept, but not a chapter to draw
        starts.insert(0, ("Before chapter 1", "front", 0))
    return starts


def main():
    args = sys.argv[1:]; opt = {}
    for k in ("--name", "--code"):
        if k in args: i = args.index(k); opt[k] = args[i + 1]; del args[i:i + 2]
    src, out = Path(args[0]).resolve(), Path(args[1]).resolve()
    notes, ext = [], src.suffix.lower()
    (out / "source").mkdir(parents=True, exist_ok=True)
    name = opt.get("--name") or src.stem.replace("_", " ").replace("-", " ").strip().title()
    rows, chapters = [], []

    if ext == ".json":  # already numbered (an earlier ingest): ids are kept exactly
        data = json.loads(read_text(src))
        if not (isinstance(data, list) and data and all(isinstance(d, dict) and d.get("source_id") and "text" in d for d in data)):
            sys.exit("that .json file is not a numbered paragraph list ([{source_id, chapter_id, text}])")
        code = opt.get("--code") or str(data[0]["source_id"]).split(":")[0]
        order = []
        for k, d in enumerate(data):
            cid = d.get("chapter_id") or ":".join(str(d["source_id"]).split(":")[:2])
            if cid not in order: order.append(cid)
            if norm(d["text"]): rows.append({"source_id": d["source_id"], "chapter_id": cid, "n": d.get("paragraph_zero_based", k), "text": norm(d["text"])})
        for num, cid in enumerate(order, 1):
            mine = [r for r in rows if r["chapter_id"] == cid]
            head = chapter_title(mine[0]["text"])
            chapters.append({"id": cid.split(":")[-1], "chapter_id": cid, "number": num, "title": head or f"Chapter {num}", "kind": "chapter", "_rows": mine, "_head": bool(head)})
    else:
        if ext == ".docx": paras = from_docx(src)
        elif ext == ".epub": paras = from_epub(src)
        elif ext in (".txt", ".md", ".markdown", ".text", ""): paras = from_plain(src)
        else: sys.exit(f"cannot read {ext} files: use .txt, .md, .docx or .epub")
        if not paras: sys.exit("no text was found in that file")
        code = opt.get("--code") or (re.sub(r"[^A-Z0-9]", "", name.upper())[:6] or "BOOK")
        starts = split_chapters(paras, notes)
        num = 0
        for k, (title, kind, i0) in enumerate(starts):
            i1 = starts[k + 1][2] if k + 1 < len(starts) else len(paras)
            if kind != "front": num += 1
            cid = "CH000" if kind == "front" else f"CH{num:03d}"
            mine = [{"source_id": f"{code}:{cid}:P{i:04d}", "chapter_id": f"{code}:{cid}", "n": i, "text": paras[i][0]} for i in range(i0, i1)]
            rows += mine
            chapters.append({"id": cid, "chapter_id": f"{code}:{cid}", "number": 0 if kind == "front" else num, "title": title, "kind": kind, "_rows": mine, "_head": kind == "chapter"})

    for r in rows: r["sha256"] = hashlib.sha256(r["text"].encode()).hexdigest()
    for c in chapters:
        mine = c.pop("_rows"); body = mine[1:] if c.pop("_head") and len(mine) > 1 else mine
        w = sum(words(r["text"]) for r in body)
        c.update(first=mine[0]["source_id"], last=mine[-1]["source_id"], paragraphs=len(body), words=w,
                 pages_est=max(1, round(w / WORDS_PER_PAGE)), opens=(body[0]["text"][:160] if body else ""))
    real = [c for c in chapters if c["kind"] != "front"]
    if len(real) > 3:
        ws = sorted(c["words"] for c in real); mid = ws[len(ws) // 2]
        for c in real:
            if c["words"] > 4 * mid and c["words"] > 6000: notes.append(f"{c['title'][:50]} is much longer than the others ({c['words']:,} words): a chapter heading may have been missed inside it.")
            if c["words"] < 80: notes.append(f"{c['title'][:50]} has almost no text ({c['words']} words): it may be a contents-list line, not a chapter.")
    (out / "source" / "paragraphs.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    meta_file = out / "series.json"
    meta = json.loads(meta_file.read_text()) if meta_file.exists() else {}
    meta.update(name=meta.get("name") or name, code=code, source={"file": src.name, "kind": ext.lstrip(".") or "txt"},
                paragraphs=len(rows), words=sum(c["words"] for c in real), pages_est=sum(c["pages_est"] for c in real),
                words_per_page=WORDS_PER_PAGE, chapters=chapters, notes=notes)
    meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print(json.dumps({"name": meta["name"], "chapters": len(real), "paragraphs": len(rows), "words": meta["words"], "notes": notes}))


if __name__ == "__main__":
    main()
