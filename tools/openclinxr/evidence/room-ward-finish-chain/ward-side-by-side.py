#!/usr/bin/env python3
"""Compose ward-finish-chain side-by-side sheets: reference JPG | runtime PNG.

Reads docs/openclinxr/room-realism/imagine-multiview/<name>.jpg (left) and
docs/openclinxr/room-realism/ward-finish-chain-2026-09-27/captures/
runtime-<name>.png (right), scales both to height 720, stacks horizontally
with a 8px divider + text labels, writes
docs/openclinxr/room-realism/ward-finish-chain-2026-09-27/
<nn>-<name>-side-by-side.png.
"""
import os
from PIL import Image, ImageDraw

REPO = "/Volumes/files/src/openclinxr-wt/ward-finish-chain"
REF = os.path.join(REPO, "docs/openclinxr/room-realism/imagine-multiview")
CAP = os.path.join(REPO, "docs/openclinxr/room-realism/ward-finish-chain-2026-09-27/captures")
OUT = os.path.join(REPO, "docs/openclinxr/room-realism/ward-finish-chain-2026-09-27")

NAMES = [
    "01-toward-door",
    "02-toward-bed-wall",
    "03-ceiling-corner",
    "04-door-inside",
    "05-troffer-junction",
    "06-floor-base",
]
H = 720
DIV = 8
LABEL_H = 36


def fit_height(im, h):
    w, hh = im.size
    nw = round(w * h / hh)
    return im.resize((nw, h), Image.LANCZOS)


def main():
    for name in NAMES:
        ref = fit_height(Image.open(os.path.join(REF, f"{name}.jpg")).convert("RGB"), H)
        cap = fit_height(Image.open(os.path.join(CAP, f"runtime-{name}.png")).convert("RGB"), H)
        w = ref.size[0] + DIV + cap.size[0]
        sheet = Image.new("RGB", (w, H + LABEL_H), (16, 16, 16))
        sheet.paste(ref, (0, LABEL_H))
        sheet.paste(cap, (ref.size[0] + DIV, LABEL_H))
        d = ImageDraw.Draw(sheet)
        d.text((12, 10), f"reference {name}.jpg", fill=(255, 255, 255))
        d.text((ref.size[0] + DIV + 12, 10), f"ours runtime-{name} (ward chain seed 205)", fill=(120, 220, 255))
        d.rectangle([ref.size[0], LABEL_H, ref.size[0] + DIV - 1, H + LABEL_H - 1], fill=(90, 90, 90))
        out = os.path.join(OUT, f"{name}-side-by-side.png")
        sheet.save(out)
        print(f"[sheet] {out} {sheet.size[0]}x{sheet.size[1]}")


if __name__ == "__main__":
    main()
