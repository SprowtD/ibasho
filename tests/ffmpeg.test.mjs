// Smaller audit item: uploads reach ffmpeg only as local files in the containers Ibasho takes (no playlists, no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { startApp, makeScene } from "./harness.mjs";

test("a playlist dressed as an mp4 is refused, and nothing is left behind", async () => {
  const a = await startApp();
  try {
    const dir = makeScene(a, "s1");
    for (const body of ["#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:1.0,\n/etc/hostname\n#EXT-X-ENDLIST\n", "ffconcat version 1.0\nfile '/etc/hostname'\n"]) {
      const r = await fetch(`${a.base}/api/anime/upload?id=s1&kind=clip&name=evil.mp4`, { method: "POST", body });
      assert.equal(r.status, 400); assert.match((await r.json()).error, /could not be read as a video/);
    }
    assert.deepEqual(existsSync(join(dir, "clips")) ? readdirSync(join(dir, "clips")) : [], []);
  } finally { await a.stop(); }
});
