#!/usr/bin/env python3
"""Side-by-side sheets for room-dimensions-fix (all six poses).

Left: v2 Imagine reference from THIS repo
(docs/openclinxr/room-realism/imagine-multiview/<name>.jpg) -- the same set
STEP 1 measured (ref 02 ratio 2.09 reproduced on these bytes).
Right: runtime capture from docs/openclinxr/room-realism/room-dimensions-fix/captures/.
Both scaled to height 720 with an 8px divider + labels.

Usage (repo root): python3 tools/openclinxr/evidence/room-ward-finish-chain/ward-side-by-side-room-dims.py
Env overrides: RD_JOB_DIR (default docs/openclinxr/room-realism/room-dimensions-fix).
"""
import os
from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))))
JOB = os.environ.get("RD_JOB_DIR", os.path.join(REPO, "docs/openclinxr/room-realism/room-dimensions-fix"))
REF = os.path.join(REPO, "docs/openclinxr/room-realism/imagine-multiview")
CAP = os.path.join(JOB, "captures")

NAMES = ["01-toward-door", "02-toward-bed-wall", "03-ceiling-corner",
         "04-door-inside", "05-troffer-junction", "06-floor-base"]
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
        d.text((12, 10), f"v2 reference {name}.jpg", fill=(255, 255, 255))
        d.text((ref.size[0] + DIV + 12, 10),
               f"ours runtime-{name} (room-dimensions-fix, ward chain seed 205, 4.3x3.9x2.4)",
               fill=(120, 220, 255))
        d.rectangle([ref.size[0], LABEL_H, ref.size[0] + DIV - 1, H + LABEL_H - 1],
                    fill=(90, 90, 90))
        out = os.path.join(JOB, f"{name}-side-by-side.png")
        sheet.save(out)
        print(f"[sheet] {out} {sheet.size[0]}x{sheet.size[1]}")


if __name__ == "__main__":
    main()
