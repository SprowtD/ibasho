#!/usr/bin/python3
"""The published test page's saved copy -> one saved-spec file the Artist tools read.
First dump the database with ArtifactData and an out_dir: get specs/<project>, list specs/<project>/pages, list refs.
Usage: /usr/bin/python3 tools/saved_from_db.py <out_dir> <project> <saved spec to write>
Handles both layouts: everything in one document (old), or an index plus one document per page.
"""
import json, sys
from pathlib import Path
out, proj, dest = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
unwrap = lambda d: d.get("data", d) if "spec" not in d and "page" not in d else d
spec = unwrap(json.loads((out / "specs" / f"{proj}.json").read_text()))["spec"]
if "pageIds" in spec:
    pages = {}
    for f in (out / "specs" / proj / "pages").glob("*.json"):
        pg = unwrap(json.loads(f.read_text()))["page"]; pages[pg["id"]] = pg
    spec["pages"] = [pages[i] for i in spec.pop("pageIds") if i in pages]
dest.write_text(json.dumps(spec))
print(len(spec["pages"]), "pages ->", dest)
