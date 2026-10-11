#!/usr/bin/env python3
"""Hair evaluator v0: deterministic, headless, LLM-free scorer for hair renders.

Usage: python3 evaluate.py <image.png> [--json]
Prints one JSON object with scale-free metrics computed on a hair mask.

Hair mask rule (fixed for this series: dark hair, grey background, pale skin):
  luminance = 0.2126R + 0.7152G + 0.0722B on 0..1
  candidate = luminance < 0.30 inside head region
    head region = columns 15%..85% of width, rows 0..75% of height
  keep only the largest 4-connected component touching the top-centre
  column band (columns 45%..55% of width, within the head region).

Dependencies: numpy and PIL only. No Blender, no network, no scipy.
"""

import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

LUMINANCE_THRESHOLD = 0.30
HEAD_COL_LO, HEAD_COL_HI = 0.15, 0.85
HEAD_ROW_HI = 0.75
BAND_COL_LO, BAND_COL_HI = 0.45, 0.55
TOP_ROWS_FRACTION = 0.30


def load_luminance(path):
    img = Image.open(path).convert("RGB")
    arr = np.asarray(img, dtype=np.float64) / 255.0
    lum = 0.2126 * arr[:, :, 0] + 0.7152 * arr[:, :, 1] + 0.0722 * arr[:, :, 2]
    return img.size, lum  # (width, height), HxW float64


def largest_band_component(candidate, band):
    """Largest 4-connected component of `candidate` intersecting `band`.

    BFS seeded from masked band pixels; each seed reached while unlabeled
    starts exactly one component, so the max over seeds is the max over all
    band-touching components. Returns a boolean mask (all False when none).
    """
    h, w = candidate.shape
    labeled = np.zeros((h, w), dtype=bool)
    best = None
    best_size = 0
    seeds = np.argwhere(candidate & band)
    for sy, sx in seeds:
        sy, sx = int(sy), int(sx)
        if labeled[sy, sx]:
            continue
        size = 0
        cells = []
        queue = deque([(sy, sx)])
        labeled[sy, sx] = True
        while queue:
            y, x = queue.popleft()
            cells.append((y, x))
            size += 1
            if y > 0 and candidate[y - 1, x] and not labeled[y - 1, x]:
                labeled[y - 1, x] = True
                queue.append((y - 1, x))
            if y + 1 < h and candidate[y + 1, x] and not labeled[y + 1, x]:
                labeled[y + 1, x] = True
                queue.append((y + 1, x))
            if x > 0 and candidate[y, x - 1] and not labeled[y, x - 1]:
                labeled[y, x - 1] = True
                queue.append((y, x - 1))
            if x + 1 < w and candidate[y, x + 1] and not labeled[y, x + 1]:
                labeled[y, x + 1] = True
                queue.append((y, x + 1))
        if size > best_size:
            best_size = size
            best = cells
    mask = np.zeros((h, w), dtype=bool)
    if best:
        ys, xs = zip(*best)
        mask[np.array(ys), np.array(xs)] = True
    return mask


def laplacian4(lum):
    """Discrete 4-neighbour Laplacian with edge replication at borders."""
    padded = np.pad(lum, 1, mode="edge")
    return (
        padded[:-2, 1:-1]
        + padded[2:, 1:-1]
        + padded[1:-1, :-2]
        + padded[1:-1, 2:]
        - 4.0 * lum
    )


def evaluate(path):
    (width, height), lum = load_luminance(path)
    h, w = lum.shape

    x0, x1 = int(w * HEAD_COL_LO), int(w * HEAD_COL_HI)
    y1 = int(h * HEAD_ROW_HI)
    head_pixels = (x1 - x0) * y1

    candidate = np.zeros((h, w), dtype=bool)
    candidate[0:y1, x0:x1] = lum[0:y1, x0:x1] < LUMINANCE_THRESHOLD

    band = np.zeros((h, w), dtype=bool)
    bx0, bx1 = int(w * BAND_COL_LO), int(w * BAND_COL_HI)
    band[0:y1, bx0:bx1] = True

    mask = largest_band_component(candidate, band)
    mask_pixels = int(mask.sum())

    if mask_pixels == 0:
        return {
            "image": os.path.basename(path),
            "width": width,
            "height": height,
            "hairAreaFraction": 0.0,
            "hairBboxAspect": 0.0,
            "volume": 0.0,
            "structure": 0.0,
            "partGapFraction": 0.0,
            "hairlineRatio": 1.0,
            "meanHairLuminance": 0.0,
            "maskPixels": 0,
        }

    hair_area_fraction = mask_pixels / head_pixels

    ys, xs = np.argwhere(mask).T
    top, bottom = int(ys.min()), int(ys.max()) + 1
    left, right = int(xs.min()), int(xs.max()) + 1
    bbox_w = right - left
    bbox_h = bottom - top
    bbox_aspect = bbox_h / bbox_w if bbox_w else 0.0

    mean_lum = float(lum[mask].mean())
    lap = laplacian4(lum)
    structure = float(lap[mask].var() / (mean_lum + 0.02) ** 2)

    cx = (left + right) // 2
    cut = top + int(bbox_h * TOP_ROWS_FRACTION)
    part_gap_fraction = 0.0
    for y in range(top, min(cut, h)):
        if not (left <= cx < right):
            break
        if mask[y, cx]:
            continue
        run_l = cx
        while run_l - 1 >= left and not mask[y, run_l - 1]:
            run_l -= 1
        run_r = cx
        while run_r + 1 < right and not mask[y, run_r + 1]:
            run_r += 1
        part_gap_fraction = max(part_gap_fraction, (run_r - run_l + 1) / bbox_w)

    hairline_ratio = 1.0
    if left <= cx < right:
        for y in range(top, min(bottom, h)):
            if not mask[y, cx]:
                hairline_ratio = (y - top) / bbox_h if bbox_h else 1.0
                break

    return {
        "image": os.path.basename(path),
        "width": width,
        "height": height,
        "hairAreaFraction": hair_area_fraction,
        "hairBboxAspect": bbox_aspect,
        "volume": hair_area_fraction,
        "structure": structure,
        "partGapFraction": part_gap_fraction,
        "hairlineRatio": hairline_ratio,
        "meanHairLuminance": mean_lum,
        "maskPixels": mask_pixels,
    }


def main(argv):
    args = [a for a in argv[1:] if a != "--json"]
    if len(args) != 1:
        print("usage: evaluate.py <image.png> [--json]", file=sys.stderr)
        return 2
    path = args[0]
    if not os.path.isfile(path):
        print("missing file: %s" % path, file=sys.stderr)
        return 1
    print(json.dumps(evaluate(path)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
