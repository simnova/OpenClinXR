"""Grading sheet for the eyeshade card: PRE | POST | EEVEE eye crops.

Rows: aisha-front, aisha-yaw25, body2-front, body2-yaw25 (subject-left eye).
Cols: PRE | POST | Oct-15-method EEVEE reference. Every cell 420x420 native
pixels, no resampling, no labels baked in (mapping in the report).
three.js cells: 420px crop centred on the MediaPipe-473 (anatomical-left)
pupil detected on PRE (same centre for PRE+POST). EEVEE cells: eyeL crops
(bone-projected +-210px): body2 from store/lid-conform-any (card-named),
aisha rendered by lidany_aisha into eevee/.

Usage:
  mise exec -C /Volumes/files/src/openclinxr -- python3 probe_sheet.py
Writes eyes-runtime-shading/sheet/eyes-runtime-shading-sheet.png + sha.
"""
import hashlib
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "sclera-shade"))
import sclera_metrics as sm  # noqa: E402

FRAMES = "/Volumes/files/openclinxr-assets/store/eyes-runtime-shading/frames"
SHEETD = "/Volumes/files/openclinxr-assets/store/eyes-runtime-shading/sheet"
EEVEE_BODY2 = "/Volumes/files/openclinxr-assets/store/lid-conform-any"
EEVEE_AISHA = "/Volumes/files/openclinxr-assets/store/eyes-runtime-shading/eevee"

ROWS = [
    ("aisha-front", f"{EEVEE_AISHA}/sheet-aisha-new-front-eyeL-crop.png"),
    ("aisha-yaw25", f"{EEVEE_AISHA}/sheet-aisha-new-yaw25-eyeL-crop.png"),
    ("body2-front", f"{EEVEE_BODY2}/sheet-body2-new-front-eyeL-crop.png"),
    ("body2-yaw25", f"{EEVEE_BODY2}/sheet-body2-new-yaw25-eyeL-crop.png"),
]


def crop_around_pupil(path, cx, cy, size=420):
    img = np.array(Image.open(path).convert("RGB"))
    h, w = img.shape[:2]
    half = size // 2
    x0 = min(max(0, int(round(cx)) - half), w - size)
    y0 = min(max(0, int(round(cy)) - half), h - size)
    return img[y0 : y0 + size, x0 : x0 + size]


def main():
    os.makedirs(SHEETD, exist_ok=True)
    grid = []
    mapping = []
    for cell, eevee_path in ROWS:
        pre_p = os.path.join(FRAMES, f"pre-{cell}.png")
        post_p = os.path.join(FRAMES, f"post-{cell}.png")
        rgb = np.array(Image.open(pre_p).convert("RGB"))
        pts = sm.detect_landmarks(rgb)
        cx, cy = float(pts[473][0]), float(pts[473][1])
        pre_c = crop_around_pupil(pre_p, cx, cy)
        post_c = crop_around_pupil(post_p, cx, cy)
        eevee_c = np.array(Image.open(eevee_path).convert("RGB"))
        assert eevee_c.shape[:2] == (420, 420), (eevee_path, eevee_c.shape)
        assert pre_c.shape[:2] == (420, 420) and post_c.shape[:2] == (420, 420)
        grid.append(np.concatenate([pre_c, post_c, eevee_c], axis=1))
        mapping.append({"row": cell, "eye": "anatomical-left (MediaPipe 473 / eye.L bone)", "pre": pre_p, "post": post_p, "eevee": eevee_path})
        print(f"OK {cell} pupil=({cx:.0f},{cy:.0f})")
    sheet = np.concatenate(grid, axis=0)
    out = os.path.join(SHEETD, "eyes-runtime-shading-sheet.png")
    Image.fromarray(sheet).save(out)
    sha = hashlib.sha256(open(out, "rb").read()).hexdigest()
    json_path = os.path.join(SHEETD, "eyes-runtime-shading-sheet.mapping.json")
    import json as js

    rec = {"sheet": out, "sha256": sha}
    rec["size"] = [int(sheet.shape[1]), int(sheet.shape[0])]
    rec["cols"] = ["PRE", "POST", "EEVEE-Oct15-method"]
    rec["rows"] = mapping
    js.dump(rec, open(json_path, "w"), indent=1)
    print(f"wrote {out} sha={sha}")
    print(f"mapping {json_path}")


if __name__ == "__main__":
    main()
