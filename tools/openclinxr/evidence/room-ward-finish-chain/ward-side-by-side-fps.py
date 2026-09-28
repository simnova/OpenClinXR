#!/usr/bin/env python3
"""Side-by-side sheets for finish-preserve-shell (poses 01/02/03/06 + normal-toggle).

Left: v2 Imagine reference (ward-reference-v2 imagine-multiview-v2).
Right: runtime capture from docs/openclinxr/room-realism/finish-preserve-shell/captures/.
Both scaled to height 720 with an 8px divider + labels.

Usage (repo root): python3 tools/openclinxr/evidence/room-ward-finish-chain/ward-side-by-side-fps.py
Env overrides: FPS_JOB_DIR, FPS_V2_REF.
"""
import os
from PIL import Image, ImageDraw

REPO = "/Volumes/files/src/openclinxr-wt/finish-preserve-shell"
JOB = os.environ.get("FPS_JOB_DIR", os.path.join(REPO, "docs/openclinxr/room-realism/finish-preserve-shell"))
REF = os.environ.get("FPS_V2_REF", "/Volumes/files/src/openclinxr-wt/ward-reference-v2/docs/openclinxr/room-realism/imagine-multiview-v2")
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


def sheet_for(name, cap_name=None, out_name=None):
    ref = fit_height(Image.open(os.path.join(REF, f"{name}.jpg")).convert("RGB"), H)
    cap = fit_height(Image.open(os.path.join(CAP, cap_name or f"runtime-{name}.png")).convert("RGB"), H)
    w = ref.size[0] + DIV + cap.size[0]
    sheet = Image.new("RGB", (w, H + LABEL_H), (16, 16, 16))
    sheet.paste(ref, (0, LABEL_H))
    sheet.paste(cap, (ref.size[0] + DIV, LABEL_H))
    d = ImageDraw.Draw(sheet)
    d.text((12, 10), f"v2 reference {name}.jpg", fill=(255, 255, 255))
    d.text((ref.size[0] + DIV + 12, 10),
           f"ours {cap_name or ('runtime-' + name)} (finish-preserve-shell, ward chain seed 205)", fill=(120, 220, 255))
    d.rectangle([ref.size[0], LABEL_H, ref.size[0] + DIV - 1, H + LABEL_H - 1], fill=(90, 90, 90))
    out = os.path.join(JOB, out_name or f"{name}-side-by-side.png")
    sheet.save(out)
    print(f"[sheet] {out} {sheet.size[0]}x{sheet.size[1]}")


def main():
    for name in NAMES:
        sheet_for(name)
    # Normal-map toggle comparison: same v2 reference, runtime capture with
    # the ceiling/door normal maps stripped for that capture only.
    toggle = "runtime-03-ceiling-corner-nonormal.png"
    if os.path.exists(os.path.join(CAP, toggle)):
        sheet_for("03-ceiling-corner", cap_name=toggle,
                  out_name="03-ceiling-corner-nonormal-side-by-side.png")


if __name__ == "__main__":
    main()
