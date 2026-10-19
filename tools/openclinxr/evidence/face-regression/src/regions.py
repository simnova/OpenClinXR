#!/usr/bin/env python3
"""Whole-face regression region metrics (card tsk_0e618fa5e9ac3e15).

Masks come from the GOLDEN render's landmarks and are applied to BOTH images,
so a region that moved cannot shrink its own mask to hide the move.

Per region: mean CIEDE2000 dE, SSIM on L*, and mean landmark displacement in px
(reported, never gated). The landmark model is the PINNED face-gate model, and
detection is face_gate_v2.detect_median (median of 3). Neither the detector nor
the model resolver is copied here: face_gate.py / face_gate_v2.py are imported.

Run only through mise so the face-gate python env is on PATH:

  mise exec -C /Volumes/files/src/openclinxr -- python3 \
    tools/openclinxr/evidence/face-regression/src/regions.py \
    --golden <png> --current <png> --out <json> [--case <id>] [--view <n>]

The index table below mirrors src/regions.ts (they are the same anatomy, listed
once per language so neither silently drifts).
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_FACE_GATE_DIR = os.path.normpath(
    os.path.join(SCRIPT_DIR, "..", "..", "face-gate"))
if _FACE_GATE_DIR not in sys.path:
    sys.path.insert(0, _FACE_GATE_DIR)

import face_gate as v1  # noqa: E402
import face_gate_v2 as v2  # noqa: E402
from skimage.color import deltaE_ciede2000  # noqa: E402

# Named face regions as pinned MediaPipe FaceLandmarker indices (478-point).
# Mirrors tools/openclinxr/evidence/face-regression/src/regions.ts.
REGION_LANDMARKS = {
    "eye_L": [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
    "eye_R": [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
    "brow_L": [70, 63, 105, 66, 107, 46, 53, 52, 65, 55],
    "brow_R": [336, 296, 334, 293, 300, 276, 283, 282, 295, 285],
    "lips": [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
    "forehead": [10, 67, 69, 104, 108, 151, 9, 8, 337, 299, 333, 297, 338],
    "cheek_L": [145, 61, 129, 101, 234, 50, 118, 117, 123, 147, 187, 205, 206],
    "cheek_R": [374, 291, 358, 330, 454, 280, 346, 347, 352, 376, 411, 425, 426],
    "nose": [168, 6, 197, 195, 5, 4, 1, 2, 98, 327, 129, 358],
    "chin": [17, 152, 172, 397],
}
REGION_ORDER = list(REGION_LANDMARKS.keys())


def _polygon(points):
    import cv2
    pts = np.asarray(points, dtype=np.float32).reshape(-1, 1, 2)
    return cv2.convexHull(pts).reshape(-1, 2).astype(np.int32)


def region_masks(landmarks, w, h):
    """Binary masks from the golden landmarks (convex hull per region)."""
    import cv2
    masks = {}
    for region, idxs in REGION_LANDMARKS.items():
        pts = np.asarray([landmarks[i] for i in idxs], dtype=np.float64)
        hull = _polygon(pts)
        m = np.zeros((h, w), dtype=np.uint8)
        if len(hull) >= 3:
            cv2.fillPoly(m, [hull], 1)
        masks[region] = m
    return masks


def _ssim_on_L(L_ref, L_cur, mask):
    """Single-window SSIM on L* restricted to the mask (1.0 when identical)."""
    sel = mask > 0
    n = int(sel.sum())
    if n == 0:
        return 1.0
    a = L_ref[sel].astype(np.float64)
    b = L_cur[sel].astype(np.float64)
    ma, mb = a.mean(), b.mean()
    va = float(((a - ma) ** 2).mean())
    vb = float(((b - mb) ** 2).mean())
    cov = float(((a - ma) * (b - mb)).mean())
    L = 100.0
    C1 = (0.01 * L) ** 2
    C2 = (0.03 * L) ** 2
    den = (ma * ma + mb * mb + C1) * (va + vb + C2)
    if den == 0:
        return 1.0
    return float(((2 * ma * mb + C1) * (2 * cov + C2)) / den)


def measure(golden_rgb, current_rgb, golden_pts, current_pts):
    h, w = golden_rgb.shape[:2]
    lab_g = v1.rgb_to_lab(golden_rgb)
    lab_c = v1.rgb_to_lab(current_rgb)
    L_g, L_c = lab_g[:, :, 0], lab_c[:, :, 0]
    masks = region_masks(golden_pts, w, h)
    out = []
    for region in REGION_ORDER:
        mask = masks[region]
        sel = mask > 0
        n = int(sel.sum())
        if n == 0:
            out.append({"region": region, "dE": 0.0, "ssimL": 1.0,
                        "landmarkDispPx": 0.0, "pixels": 0})
            continue
        de = float(deltaE_ciede2000(lab_g[sel], lab_c[sel]).mean())
        disp = 0.0
        idxs = REGION_LANDMARKS[region]
        for i in idxs:
            g = golden_pts[i]
            c = current_pts[i]
            disp += float(np.hypot(g[0] - c[0], g[1] - c[1]))
        disp /= len(idxs)
        out.append({
            "region": region,
            "dE": de,
            "ssimL": _ssim_on_L(L_g, L_c, mask),
            "landmarkDispPx": disp,
            "pixels": n,
        })
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--golden", required=True, help="golden PNG (mask source)")
    ap.add_argument("--current", required=True, help="current PNG")
    ap.add_argument("--out", required=True, help="metrics JSON path")
    ap.add_argument("--model", default=None, help="explicit landmark model path")
    ap.add_argument("--landmarks-out", default=None,
                    help="optional JSON path for golden+current landmarks")
    ap.add_argument("--case", default=None)
    ap.add_argument("--view", default=None)
    args = ap.parse_args(argv)

    model = v1.resolve_model_path(args.model)
    landmarker = v1.create_landmarker(model)

    golden_rgb = v1.load_rgb(args.golden)
    current_rgb = v1.load_rgb(args.current)
    if golden_rgb.shape[:2] != current_rgb.shape[:2]:
        raise SystemExit(
            "refused: dimension mismatch %s %s vs %s %s"
            % (os.path.basename(args.golden), golden_rgb.shape[:2],
               os.path.basename(args.current), current_rgb.shape[:2]))

    g_pts, g_jit = v2.detect_median(landmarker, Image.open(args.golden))
    c_pts, c_jit = v2.detect_median(landmarker, Image.open(args.current))
    if g_pts is None or c_pts is None:
        raise SystemExit(
            "refused: no face detected (golden runs_ok=%s current runs_ok=%s)"
            % (g_jit.get("runs_ok"), c_jit.get("runs_ok")))

    metrics = measure(golden_rgb, current_rgb, g_pts, c_pts)
    report = {
        "case": args.case,
        "view": args.view,
        "model": {"path": model, "sha256": v1.sha256_of(model)},
        "detection": {"golden": g_jit, "current": c_jit},
        "metrics": metrics,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    if args.landmarks_out:
        lms = {
            "golden": [[float(x), float(y)] for x, y in g_pts],
            "current": [[float(x), float(y)] for x, y in c_pts],
        }
        os.makedirs(os.path.dirname(os.path.abspath(args.landmarks_out)),
                    exist_ok=True)
        with open(args.landmarks_out, "w") as f:
            json.dump(lms, f)
            f.write("\n")
    print(args.out)


if __name__ == "__main__":
    main()
