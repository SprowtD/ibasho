#!/usr/bin/python3
"""Detailed grey 3D animatic: films a scene's previs score in Blender with real mannequins (anime/tools/previs_blender.py).
Usage: previs_v2.py <scene dir> [start end] [--size 854x480] [--fps 24] [--out name] [--frames 218,246,...]   -> <scene dir>/previs/<name>.mp4
--frames films only those frame numbers (a check sheet's stills, in previs/work-<name>/), all in one Blender start.
Blender is the Windows program (a `blender` link in WSL), so every path it gets is turned into a Windows path."""
import json, subprocess, sys, shutil, yaml
from pathlib import Path
a = [x for x in sys.argv[1:] if not x.startswith("--")]; opt = {sys.argv[i][2:]: sys.argv[i + 1] for i in range(1, len(sys.argv) - 1) if sys.argv[i].startswith("--")}
a = [x for x in a if x not in opt.values()]
scene = Path(a[0]).resolve(); pv = scene / "previs"; score = yaml.safe_load((pv / "score.yaml").read_text())
t0 = float(a[1]) if len(a) > 2 else 0.0; t1 = float(a[2]) if len(a) > 2 else float(score["duration"])
w, h = (int(v) for v in opt.get("size", "854x480").split("x")); fps = int(opt.get("fps", 24)); name = opt.get("out", "detailed")
work = pv / ("work-" + name); shutil.rmtree(work, ignore_errors=True); work.mkdir(parents=True)
(work / "score.json").write_text(json.dumps(score))
win = lambda p: subprocess.run(["wslpath", "-w", str(p)], capture_output=True, text=True).stdout.strip()
tool = Path(__file__).with_name("previs_blender.py")
r = subprocess.run(["blender", "-b", "-P", win(tool), "--", win(work / "score.json"), win(work), str(t0), str(t1), str(w), str(h), str(fps)] + ([opt["frames"]] if "frames" in opt else []), capture_output=True, text=True)
if "PREVIS_DONE" not in r.stdout: sys.exit("Blender did not finish:\n" + (r.stdout[-1500:] + r.stderr[-1500:]))
out = pv / (name + ".mp4")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(fps), "-i", str(work / "f%05d.png"), "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", str(out)], check=True)
print(json.dumps({"out": str(out), "frames": json.loads((work / "frames.json").read_text())["frames"], "from": t0, "to": t1}))
