# -*- coding: utf-8 -*-
"""按比例裁图并 2x 放大，便于 read_image 细看穿模。"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LOGS = ROOT / "tools" / "_logs"

def crop(src, name, box, scale=2):
    im = Image.open(LOGS / src).convert("RGB")
    w, h = im.size
    x0, y0, x1, y1 = box
    px = (int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h))
    c = im.crop(px)
    c = c.resize((c.width * scale, c.height * scale), Image.LANCZOS)
    out = LOGS / ("crop_" + name + ".png")
    c.save(out)
    print(out.name, c.size)

if __name__ == "__main__":
    crop("D0_018.png", "bench18", (0.08, 0.19, 0.22, 0.36))
    crop("D0_108.png", "bench108", (0.45, 0.20, 0.60, 0.42))
    crop("D0_288.png", "desk288", (0.15, 0.28, 0.42, 0.52))
    crop("D0_288.png", "eastwall288", (0.32, 0.03, 0.60, 0.48))
    crop("D0_018.png", "leftwall18", (0.07, 0.10, 0.30, 0.36))
    crop("D0_198.png", "bench198", (0.62, 0.40, 0.80, 0.60))
