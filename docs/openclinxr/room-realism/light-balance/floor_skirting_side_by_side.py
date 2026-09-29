#!/usr/bin/env python3
"""Floor+skirting side-by-sides: v2 reference (left) vs runtime capture (right).

Usage (repo root):
  python3 docs/openclinxr/room-realism/light-balance/floor_skirting_side_by_side.py
Reads docs/openclinxr/room-realism/light-balance/captures-floor-skirting/runtime-*.png
Writes docs/openclinxr/room-realism/light-balance/floor-skirting-<name>-v2-side-by-side.png
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))))
LB = os.path.join(ROOT, "docs/openclinxr/room-realism/light-balance")
REF = os.path.join(ROOT, "docs/openclinxr/room-realism/imagine-multiview-v2")
CAP = os.path.join(LB, "captures-floor-skirting")

NAMES = ["01-toward-door", "02-toward-bed-wall", "03-ceiling-corner",
         "04-door-inside", "05-troffer-junction", "06-floor-base"]
H = 720
DIV = 8
LABEL_H = 36


def fit_height(im, h):
    w, hh = im.size
    return im.resize((round(w * h / hh), h), Image.LANCZOS)


def main():
    for name in NAMES:
        ref = fit_height(Image.open(os.path.join(REF, f"{name}.jpg")).convert("RGB"), H)
        cap = fit_height(Image.open(os.path.join(CAP, f"runtime-{name}.png")).convert("RGB"), H)
        sheet = Image.new("RGB", (ref.size[0] + DIV + cap.size[0], H + LABEL_H), (16, 16, 16))
        sheet.paste(ref, (0, LABEL_H))
        sheet.paste(cap, (ref.size[0] + DIV, LABEL_H))
        d = ImageDraw.Draw(sheet)
        d.text((10, 10), f"v2 ref {name}", fill=(255, 255, 255))
        d.text((ref.size[0] + DIV + 10, 10), "runtime floor-skirting (chain seed 205)", fill=(120, 220, 255))
        out = os.path.join(LB, f"floor-skirting-{name}-v2-side-by-side.png")
        sheet.save(out)
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
