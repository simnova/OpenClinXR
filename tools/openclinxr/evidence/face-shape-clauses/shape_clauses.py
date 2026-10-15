#!/usr/bin/env python3
"""Region-bound face-shape clauses: TINT (hard-edged tint patch) + LID (lid
opening white length-fraction) + planted single-row counterweight.

Both clauses are REGION measures by construction:
  TINT reads the AREA of connected moderate-change regions whose boundary is
  steep (a hard-edged patch), not a line profile.
  LID reads white coverage along the WHOLE lid-opening length (every column
  of the opening's upper half), not one row.

Inputs are small fixture PNG crops (see fixtures/); no landmark model, no
network, fully deterministic. Thresholds live in shape-report.json and are
good/bad midpoints per the face-gate rule (clause-sources.json h2); the only
literals here are measurement-definition constants, each cited below.

  TINT white... bands: moderate change dLab in [3, 12] (definition: below 3
  is sensor/quantisation wash, above 12 is a recolour not a tint), Sobel
  boundary gradient k = 2.0/px (definition: f3 front-only smooth drift peaks
  at 1.5, patch edges score 3.2+, see sweep-tint.json), min component area
  200 px (definition: speckle guard; f0 dust peaks at 190 px).
  LID white mask: L > 60 and chroma < 12 (definition constants: tried grid
  L in {55,58,60} x C in {12,16,20,25} in sweep-lid.json; L60/C12 is the
  strictest pair that still separates bad (>=0.28) while passing both
  target-photo eyes).

PLANT (counterweight, report-only): white fraction on the SINGLE row y=2
(skin above the opening). Reads 0 on both good and bad: zero separation, so
the midpoint rule gives it margin 0 and it can never gate. A gate reading
one row certifies the staring eye whenever the row misses the white band.
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(SCRIPT_DIR, "fixtures")

TINT_LO, TINT_HI = 3.0, 12.0
TINT_K = 2.0
TINT_MIN_AREA = 200
LID_L, LID_C = 60.0, 12.0
PLANT_ROW = 2


def load_rgb(path):
    return np.asarray(Image.open(path).convert("RGB"))


def lab_parts(rgb):
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float64)
    L = lab[:, :, 0] * 100.0 / 255.0
    A = lab[:, :, 1] - 128.0
    B = lab[:, :, 2] - 128.0
    return L, A, B, np.sqrt(A ** 2 + B ** 2)


def tint_measure(pre_rgb, post_rgb):
    """Hard-edged patch area fraction between a pre/post crop pair."""
    assert pre_rgb.shape == post_rgb.shape, "pre/post crop shapes differ"
    h, w = pre_rgb.shape[:2]
    Lp, Ap, Bp, _ = lab_parts(pre_rgb)
    Lq, Aq, Bq, _ = lab_parts(post_rgb)
    d = np.sqrt((Lq - Lp) ** 2 + (Aq - Ap) ** 2 + (Bq - Bp) ** 2)
    roi = np.zeros((h, w), np.uint8)
    roi[2:h - 2, 2:w - 2] = 1  # border guard: Sobel needs a margin
    M = ((d >= TINT_LO) & (d <= TINT_HI) & (roi > 0)).astype(np.uint8)
    gx = cv2.Sobel(d, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(d, cv2.CV_64F, 0, 1, ksize=3)
    g = np.sqrt(gx ** 2 + gy ** 2)
    nlab, lbl = cv2.connectedComponents(M)
    kept = 0
    kept_n = 0
    top = []
    kern = np.ones((3, 3), np.uint8)
    for i in range(1, nlab):
        c = (lbl == i)
        a = int(c.sum())
        dil = cv2.dilate(c.astype(np.uint8), kern)
        ero = cv2.erode(c.astype(np.uint8), kern)
        b = (dil - ero) > 0
        bg = float(g[b].mean()) if b.any() else 0.0
        top.append({"area": a, "bgrad": round(bg, 2)})
        if bg > TINT_K and a >= TINT_MIN_AREA:
            kept += a
            kept_n += 1
    top.sort(key=lambda r: -r["area"])
    roi_n = int(roi.sum())
    return {"kept_px": kept, "kept_regions": kept_n,
            "value": kept / roi_n, "roi_px": roi_n,
            "n_components": nlab - 1, "top": top[:5]}


def lid_measure(eye_rgb):
    """Sclera length-fraction: columns of the upper opening half holding any
    white pixel. Samples the whole opening length, not one row."""
    L, _, _, ch = lab_parts(eye_rgb)
    white = (L > LID_L) & (ch < LID_C)
    h, w = eye_rgb.shape[:2]
    up = white[: h // 2]
    colcov = up.any(axis=0)
    return {"value": float(colcov.mean()),
            "white_up_px": int(up.sum()),
            "opening_len_px": int(w),
            "cols_with_white": int(colcov.sum()),
            "profile": [round(float(white[y].mean()), 4) for y in range(h)]}


def plant_measure(eye_rgb):
    """Counterweight: white fraction on the SINGLE row PLANT_ROW."""
    L, _, _, ch = lab_parts(eye_rgb)
    white = (L > LID_L) & (ch < LID_C)
    y = min(PLANT_ROW, eye_rgb.shape[0] - 1)
    return {"value": float(white[y].mean()), "row": y}


def verify():
    pre = load_rgb(os.path.join(FIX, "tint-pre.png"))
    out = {}
    for name in ("tint-known-good", "tint-known-bad"):
        out[name] = tint_measure(pre, load_rgb(os.path.join(FIX, name + ".png")))
    for name in ("lid-known-good", "lid-known-bad"):
        rgb = load_rgb(os.path.join(FIX, name + ".png"))
        out[name] = lid_measure(rgb)
        out[name.replace("lid-", "plant-on-")] = plant_measure(rgb)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Face-shape region clauses.")
    ap.add_argument("--verify", action="store_true",
                    help="recompute every clause on fixtures, print JSON")
    args = ap.parse_args(argv)
    if args.verify:
        print(json.dumps(verify(), indent=2, sort_keys=True))
        return 0
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
