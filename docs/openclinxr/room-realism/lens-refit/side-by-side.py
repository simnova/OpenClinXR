#!/usr/bin/env python3
"""Lens-refit side-by-side sheets (v2 reference LEFT, runtime capture RIGHT).

Reads the committed v2 set docs/openclinxr/room-realism/imagine-multiview-v2/
and docs/openclinxr/room-realism/lens-refit/captures/, writes
docs/openclinxr/room-realism/lens-refit/<name>-side-by-side.png (all 1280x720,
8px divider + label bar). Also writes 50/50 overlay blends for 01/02 as the
crop-compare audit trail for the frame-fraction fit.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.normpath(os.path.join(HERE, "..", "imagine-multiview-v2"))
CAP = os.path.join(HERE, "captures")

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
        d.text((12, 10), f"v2 reference {name}.jpg (imagine-multiview-v2, NOT stale v1)",
               fill=(255, 255, 255))
        d.text((ref.size[0] + DIV + 12, 10),
               f"runtime-{name} (ward chain seed 205, lens-refit poses)", fill=(120, 220, 255))
        d.rectangle([ref.size[0], LABEL_H, ref.size[0] + DIV - 1, H + LABEL_H - 1],
                    fill=(90, 90, 90))
        out = os.path.join(HERE, f"{name}-side-by-side.png")
        sheet.save(out)
        print(f"[sheet] {out} {sheet.size[0]}x{sheet.size[1]}")
    for name in ["01-toward-door", "02-toward-bed-wall"]:
        ref = Image.open(os.path.join(REF, f"{name}.jpg")).convert("RGB")
        cap = Image.open(os.path.join(CAP, f"runtime-{name}.png")).convert("RGB")
        out = os.path.join(HERE, f"{name}-overlay.png")
        Image.blend(ref, cap, 0.5).save(out)
        print(f"[overlay] {out}")


if __name__ == "__main__":
    main()
