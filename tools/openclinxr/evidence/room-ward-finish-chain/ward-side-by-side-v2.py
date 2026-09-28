#!/usr/bin/env python3
"""Side-by-side sheets for the v2 pose re-placement (poses 01 + 06 only).

Left: v2 Imagine reference from the ward-reference-v2 worktree
(docs/openclinxr/room-realism/imagine-multiview-v2/<name>.jpg).
Right: runtime capture at the committed hand-placed pose against the
seed-205 chain work GLB (STAGE2_CAPTURE_GLB), same framing the pose
iteration used. Both scaled to height 720 with an 8px divider + labels.

Usage (from the repo root of THIS worktree):
  STAGE2_CAPTURE_GLB=.openclinxr/evidence/ward-finish-chain/ward-chain.work.glb \\
  STAGE2_POSES_FILE=tools/openclinxr/evidence/room-ward-finish-chain/hand-placed-poses.json \\
  STAGE2_CAPTURE_OUT_DIR=docs/openclinxr/room-realism/ward-finish-chain-2026-09-27/captures-v2 \\
  pnpm exec tsx tools/openclinxr/evidence/room-ward-finish-chain/ward-finish-chain-capture.ts
  # (repeat with STAGE2_MULTIVIEW_ONLY=runtime-01-toward-door and
  # STAGE2_MULTIVIEW_ONLY=runtime-06-floor-base)
  python3 tools/openclinxr/evidence/room-ward-finish-chain/ward-side-by-side-v2.py
"""
import os
from PIL import Image, ImageDraw

THIS_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))))
V2_REPO = "/Volumes/files/src/openclinxr-wt/ward-reference-v2"
REF = os.path.join(V2_REPO, "docs/openclinxr/room-realism/imagine-multiview-v2")
EVIDENCE = os.path.join(
    THIS_REPO, "docs/openclinxr/room-realism/ward-finish-chain-2026-09-27")
CAP = os.path.join(EVIDENCE, "captures-v2")

NAMES = ["01-toward-door", "06-floor-base"]
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
               f"ours runtime-{name} (chain seed 205, hand-placed pose)", fill=(120, 220, 255))
        d.rectangle([ref.size[0], LABEL_H, ref.size[0] + DIV - 1, H + LABEL_H - 1],
                    fill=(90, 90, 90))
        out = os.path.join(EVIDENCE, f"{name}-v2-side-by-side.png")
        sheet.save(out)
        print(f"[sheet] {out} {sheet.size[0]}x{sheet.size[1]}")


if __name__ == "__main__":
    main()
