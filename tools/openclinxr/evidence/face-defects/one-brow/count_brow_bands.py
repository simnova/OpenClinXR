#!/usr/bin/env python3
"""Brow-band counter for CARD tsk_27220fbaeb48dab4 (G1).

Uses the brow-pixel rule from measure_brow.py verbatim (same K_CON, same
per-side brow box, same local-background definition, same landmark model):
a pixel counts as brow iff it lies inside the landmark brow box AND its L*
is more than K_CON below the large-radius local skin background. Per side,
the brow mask's 8-connected components with area >= MIN_BAND_PX each count
as one band. Exactly one band per side means the render shows a single brow
(the station ships one brow per side); two bands means painted + mesh brows
are both present and separated.

Does NOT modify measure_brow.py: imports K_CON/SIDES and the face-gate
loader from it so the rule cannot drift from the instrument.

CLI:
  count_brow_bands.py --image <front.png> [--out <dir>]
Prints one JSON object to stdout; writes <out>/bands.json when --out given.
"""
import argparse
import importlib.util
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MEASURE_BROW = os.path.join(HERE, "measure_brow.py")

MIN_BAND_PX = 50


def load_measure_brow():
    spec = importlib.util.spec_from_file_location("measure_brow_mod", MEASURE_BROW)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def count_bands(mb, fg, landmarker, path):
    rgb = fg.load_rgb(path)
    pts = fg.detect_points(landmarker, Image.fromarray(rgb))
    if pts is None:
        return {"path": path, "detected": False}
    lab = mb.rgb_to_lab(rgb)
    L = lab[..., 0]
    h, w = rgb.shape[:2]
    sides = {}
    for name, s in mb.SIDES.items():
        outer, inner = pts[s["outer"]], pts[s["inner"]]
        eye_w = float(np.hypot(*(outer - inner)))
        bx = np.array([pts[i] for i in s["brow"]], dtype=float)
        bgL = cv2.GaussianBlur(L, (0, 0), 0.40 * eye_w)
        x0 = int(np.floor(bx[:, 0].min() - 0.18 * eye_w))
        x1 = int(np.ceil(bx[:, 0].max() + 0.18 * eye_w))
        y0 = int(np.floor(bx[:, 1].min() - 0.35 * eye_w))
        y1 = int(np.ceil(bx[:, 1].max() + 0.18 * eye_w))
        x0, x1 = max(x0, 0), min(x1, w - 1)
        y0, y1 = max(y0, 0), min(y1, h - 1)
        box = np.zeros((h, w), bool)
        box[y0 : y1 + 1, x0 : x1 + 1] = True
        brow = (box & ((bgL - L) > mb.K_CON)).astype(np.uint8)
        n_comp, _labels, stats, _cent = cv2.connectedComponentsWithStats(brow, 8)
        areas = [int(stats[i, cv2.CC_STAT_AREA]) for i in range(1, n_comp)]
        bands = sum(1 for a in areas if a >= MIN_BAND_PX)
        sides[name] = {
            "eyeWidth": round(eye_w, 2),
            "boxPx": [x0, y0, x1, y1],
            "browPx": int(brow.sum()),
            "components": sorted(areas, reverse=True),
            "bands": bands,
            "minBandPx": MIN_BAND_PX,
            "kCon": mb.K_CON,
        }
    return {"path": path, "detected": True, "sides": sides}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", required=False, default=None)
    args = ap.parse_args(argv)
    mb = load_measure_brow()
    fg = mb.load_face_gate()
    landmarker = fg.create_landmarker()
    out = count_bands(mb, fg, landmarker, args.image)
    if args.out is not None:
        os.makedirs(args.out, exist_ok=True)
        with open(os.path.join(args.out, "bands.json"), "w") as f:
            json.dump(out, f, indent=1, sort_keys=True)
            f.write("\n")
    print(json.dumps(out, indent=1))
    return 0 if out.get("detected") else 2


if __name__ == "__main__":
    sys.exit(main())
