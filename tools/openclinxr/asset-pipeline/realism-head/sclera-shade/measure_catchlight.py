"""Catch-light peak metric (CARD tsk_57f4ae74d62739e0).

Peak luminance of the catch-light spot: max 5x5 box mean of CIELAB L*
inside the iris circle (MediaPipe 468-477 ring/pupil landmarks, same as
sclera_metrics.py), max over both eyes. Noise: change in that value when
the iris radius is eroded/dilated 1 px on the SAME image.

Usage:
  mise exec -C /Volumes/files/src/openclinxr -- python3 \
    tools/openclinxr/asset-pipeline/realism-head/sclera-shade/measure_catchlight.py \
    --image <beauty.png> [--out <json>]
"""

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sclera_metrics as sm


def box5_max_mean(L, cx, cy, radius):
    """Max 5x5 box mean of L whose box centre falls inside the iris disk."""
    h, w = L.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    inside = (xx - cx) ** 2 + (yy - cy) ** 2 <= radius**2
    # Integral image for 5x5 means (centres with a full window in-bounds).
    integ = np.zeros((h + 1, w + 1), dtype=np.float64)
    integ[1:, 1:] = np.cumsum(np.cumsum(L.astype(np.float64), axis=0), axis=1)
    y0 = np.clip((yy - 2), 0, h - 5)
    y1 = y0 + 5
    x0 = np.clip((xx - 2), 0, w - 5)
    x1 = x0 + 5
    means = (integ[y1, x1] - integ[y0, x1] - integ[y1, x0] + integ[y0, x0]) / 25.0
    edge = (yy < 2) | (yy > h - 3) | (xx < 2) | (xx > w - 3)
    cand = inside & ~edge
    if not cand.any():
        raise sm.RefusalError("empty catch-light candidate set")
    return float(means[cand].max())


def measure_image(path):
    rgb = np.array(Image.open(path).convert("RGB"))
    L = sm.srgb_to_lab_l(rgb)
    pts = sm.detect_landmarks(rgb)
    if pts.shape[0] < 478:
        raise sm.RefusalError(f"need 478 landmarks, got {pts.shape[0]}")
    vals = []
    for ring, pupil in (sm.IRIS_R, sm.IRIS_L):
        centre = pts[pupil]
        ring_pts = pts[ring]
        radius = float(np.max(np.linalg.norm(ring_pts - centre, axis=1)))
        v = box5_max_mean(L, float(centre[0]), float(centre[1]), radius)
        v_lo = box5_max_mean(L, float(centre[0]), float(centre[1]), radius - 1.0)
        v_hi = box5_max_mean(L, float(centre[0]), float(centre[1]), radius + 1.0)
        vals.append((v, v_lo, v_hi))
    v = max(t[0] for t in vals)
    noise = max(
        max(abs(t[0] - t[1]), abs(t[0] - t[2])) for t in vals
    )
    return {
        "image": os.path.abspath(path),
        "sha256": sm.sha_of(path),
        "catchlightPeakL": round(v, 3),
        "catchlightNoiseL": round(float(noise), 3),
        "perEye": [
            {"peakL": round(t[0], 3),
             "erode1L": round(t[1], 3),
             "dilate1L": round(t[2], 3)}
            for t in vals
        ],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    try:
        out = measure_image(args.image)
    except sm.RefusalError as e:
        err = {"image": os.path.abspath(args.image),
               "error": f"REFUSED: {e}"}
        text = json.dumps(err, indent=1)
        if args.out:
            with open(args.out, "w") as f:
                f.write(text + "\n")
        print(text)
        sys.exit(2)
    text = json.dumps(out, indent=1)
    if args.out:
        with open(args.out, "w") as f:
            f.write(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
