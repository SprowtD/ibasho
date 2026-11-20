#!/usr/bin/python3
"""A stand-in for Codex in the break-out screen test: it "draws" a plain figure on white where the task file says to save it.
No model is reached. It reads the task file named in its prompt, exactly as Codex is asked to."""
import re, sys
from PIL import Image, ImageDraw
said = " ".join(sys.argv[1:])
m = re.search(r"task file (\S+\.md)", said)
if not m:
    sys.exit(0)
task = open(m.group(1), encoding="utf8").read()
save = re.search(r"\*\*Save as:\*\* `([^`]+)`", task).group(1)
im = Image.new("RGB", (1024, 1536), (253, 253, 252)); d = ImageDraw.Draw(im)
d.ellipse((360, 150, 660, 450), fill=(255, 255, 255), outline=(10, 10, 10), width=10)
d.polygon([(300, 470), (720, 470), (820, 1300), (210, 1300)], fill=(255, 255, 255))
d.line([(300, 470), (720, 470), (820, 1300), (210, 1300), (300, 470)], fill=(10, 10, 10), width=10)
d.rectangle((420, 600, 600, 900), fill=(120, 120, 120))
im.save(save)
