#!/usr/bin/env python3
"""hair-part1 sheet: groom36 vs best variant vs target, part views.

Usage: make_sheet.py BEST_TAG
Columns: crown_top (hair-top1 rig), crown part crop at native pixels,
front part crop at native pixels, three_quarter (render_studio std).
Rows: g36 (identity build), BEST, target (TS set-back front; aisha-v3
3q, the lane's IoU target; no target top view exists).
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
TS = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
A3 = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
CROWN_CROP = (384, 380, 640, 892)   # 256x512 native, crown to hairline
FRONT_CROP = (384, 60, 640, 316)    # 256 px native, above hairline
STORE = Path("/Volumes/files/openclinxr-assets/store/hair-part1/renders")
T = 256
LAB = 26


def tile(src, crop=None):
    im = Image.open(src).convert("RGB")
    if crop:
        return im.crop(crop)
    return im.resize((T * 2, T * 2), Image.Resampling.LANCZOS)


def main():
    best = sys.argv[1]
    rows = [("g36 (groom36 identity)", "id"), ("best: " + best, best),
            ("target", None)]
    widths = [2 * T, T, T, 2 * T]
    W = sum(widths)
    H = len(rows) * (2 * T + LAB)
    sheet = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(sheet)
    for ri, (label, tag) in enumerate(rows):
        y = ri * (2 * T + LAB)
        if tag:
            c = E / "cells" / tag
            ims = [tile(c / "crown_top.png"), tile(c / "crown_top.png", CROWN_CROP),
                   tile(c / "front.png", FRONT_CROP),
                   tile(STORE / ("renders-" + tag) / "three_quarter.png")]
        else:
            ims = [None, None, tile(TS / "target-front.png", FRONT_CROP),
                   tile(A3 / "target-three_quarter.png")]
        x = 0
        for w, im, name in zip(widths, ims, ("crown_top", "crown crop 1:1",
                                             "front crop 1:1", "three_quarter")):
            d.text((x + 6, y + 6), label + " | " + name, fill="black")
            if im is not None:
                sheet.paste(im, (x, y + LAB))
            x += w
    out = E / "sheet.png"
    sheet.save(out)
    print(out)


if __name__ == "__main__":
    main()
