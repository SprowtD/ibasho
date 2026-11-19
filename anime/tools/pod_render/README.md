# Detailed previs on a rented GPU (first run 17 Nov 2026)

`setup.sh` installs Blender 5.2.3 for Linux on a RunPod pod; `render.sh NAME FRAME0 FRAME1 CHUNKS` films `/workspace/in/score.json` with `previs_blender.py` on the graphics card (`PREVIS_DEVICE=GPU`) and makes `out/NAME.mp4`; `srv.py` is the short control server the pod starts with (same calls as the studio's `rp.sh`).

Measured on one RTX 4090 ($0.89/h, secure), one small room, 1,164 frames at 854x480:
- One Blender process: 0.57 s a frame (the PC: 4.3 s). That is about 11 minutes for the scene.
- Eight processes side by side: 967 s for the scene, SLOWER than one (about 0.83 s a frame). Use CHUNKS = 1.
- The graphics card sat at 0 to 9 % busy: the time goes to Blender preparing each frame on the processor, not to drawing. A cheaper card would be as fast; the next real gain is less work per frame or Blender's fast drawing mode.
- Setup (Blender download + libraries) took about 1 minute. Whole run: about 20 minutes of pod time, about $0.30.
