// Manual check (needs Playwright): PLAYWRIGHT_DIR=<folder with node_modules/playwright> CHROME=<chrome path> node tests/manual/choppy.mjs old|new
// "old" runs the anime screen and server from dbf17ba, the last commit before the fix. 19 Nov 2026: old = 237 video seeks in one playthrough, new = 3.
// node choppy.mjs <old|new>: a scene with one 3 s clip (with sound), played on a throttled connection; counts seeks and stalls.
import { startApp, copyApp, makeScene } from "../harness.mjs";
import { execFileSync } from "node:child_process"; import { readFileSync, writeFileSync } from "node:fs"; import { join } from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire((process.env.PLAYWRIGHT_DIR || process.cwd()) + "/")("playwright");
const copy = copyApp();
if (process.argv[2] === "old") { // the screens and server as they were before job 5
  for (const f of ["anime/ui/app.js", "anime/server.mjs"]) writeFileSync(join(copy.app, f), execFileSync("git", ["-C", new URL("../..", import.meta.url).pathname, "show", "dbf17ba:" + f]));
}
const a = await startApp(copy);
makeScene(a, "s1", { shots: [{ shot_id: "S01", duration: 2, action: "x" }, { shot_id: "S02", duration: 3, action: "y" }] });
const mp4 = join(a.scratch, "c.mp4");
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=24:d=3", "-f", "lavfi", "-i", "sine=f=330:d=3", "-c:v", "libx264", "-crf", "17", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", mp4]);
const up = await (await fetch(`${a.base}/api/anime/upload?id=s1&kind=clip&name=c.mp4`, { method: "POST", body: readFileSync(mp4) })).json();
const plan = JSON.parse(readFileSync(join(a.anime, "s1", "SCENE_PLAN.json"), "utf8"));
Object.assign(plan.shots[1], { clip: up.url, clip_dur: up.dur, clip_sound: true, clip_poster: up.poster, clip_from: 0 });
await fetch(`${a.base}/api/anime/plan?id=s1`, { method: "PUT", body: JSON.stringify(plan) });
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const cdp = await p.context().newCDPSession(p);
await cdp.send("Network.enable"); await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 250, downloadThroughput: 500 * 1024, uploadThroughput: 200 * 1024 });
await p.addInitScript(() => { window.__ev = { vseek: 0, aseek: 0, vwait: 0, aplays: 0, vplays: 0 };
  document.addEventListener("seeking", (e) => { if (e.target.tagName === "VIDEO") __ev.vseek++; else __ev.aseek++; }, true);
  document.addEventListener("waiting", (e) => { if (e.target.tagName === "VIDEO") __ev.vwait++; }, true);
  const ap = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { if (this.tagName === "VIDEO") __ev.vplays++; else __ev.aplays++; return ap.call(this); }; });
const reqs = []; p.on("request", (r) => { if (/clips/.test(r.url())) reqs.push(r.url().split("f=")[1]); });
await p.goto(`${a.base}/anime/#/scene/s1`, { waitUntil: "load" }); await p.waitForTimeout(1500);
await p.evaluate(() => { const b = document.getElementById("pPlay"); if (b) b.click(); });
await p.waitForTimeout(9000);
const ev = await p.evaluate(() => ({ ...window.__ev, time: document.getElementById("pTime") && document.getElementById("pTime").textContent }));
console.log(process.argv[2], JSON.stringify(ev), "clip requests:", [...new Set(reqs)].join(" "));
await b.close(); await a.stop();
