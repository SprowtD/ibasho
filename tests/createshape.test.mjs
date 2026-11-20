// Create: Codex sometimes returns another shape than the one chosen (asked square, got 1536x1024). The picture is cut to the shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO } from "./harness.mjs";

test("a picture in the wrong shape is cut to the chosen one from the middle; a right one is left alone", async () => {
  const { fitShape } = await import(join(REPO, "page-editor/create.mjs"));
  const dir = mkdtempSync(join(tmpdir(), "ibasho-shape-")), f = join(dir, "a.png");
  const make = (w, h) => execFileSync("/usr/bin/python3", ["-c", "import sys\nfrom PIL import Image\nImage.new('RGB',(int(sys.argv[2]),int(sys.argv[3])),'red').save(sys.argv[1])", f, String(w), String(h)]);
  const size = () => execFileSync("/usr/bin/python3", ["-c", "import sys\nfrom PIL import Image\nprint(*Image.open(sys.argv[1]).size)", f]).toString().trim();
  try {
    make(1536, 1024); assert.equal(await fitShape(f, "1:1"), "1536x1024 to 1024x1024"); assert.equal(size(), "1024 1024");
    make(1024, 1536); assert.equal(await fitShape(f, "9:16"), "1024x1536 to 864x1536"); assert.equal(size(), "864 1536");
    make(1536, 1024); assert.equal(await fitShape(f, "3:2"), ""); assert.equal(size(), "1536 1024");
    assert.equal(await fitShape(join(dir, "nothing.png"), "1:1"), "", "a file that cannot be read is left to the caller");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
