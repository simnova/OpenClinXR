#!/usr/bin/env python3
"""Hair evaluator v1: deterministic, headless, LLM-free scorer for hair renders.

Usage: python3 evaluate.py <image.png> [--json]
Prints one JSON object with scale-free metrics computed on a hair mask.

Hair mask rule (fixed for this series: dark hair, grey background, pale skin):
  luminance = 0.2126R + 0.7152G + 0.0722B on 0..1
  candidate = luminance < 0.30 inside head region
    head region = columns 15%..85% of width, rows 0..75% of height
  keep only the largest 4-connected component touching the top-centre
  column band (columns 45%..55% of width, within the head region).

v1 metrics (new definitions):
  structure = mean over erode(mask, 3px) of (hp/local)^2,
    hp = lum - gauss(lum, sigma 2), local = gauss(lum, sigma 8) + 0.02;
    gauss = separable numpy convolution; erosion = 3x3 min filter x3.
    The v0 value is kept under structureV0. When erosion empties the mask
    (hair thinner than 3 px everywhere) the mean falls back to the mask.
  faceRegion = columns 30%..70% of width, rows 25%..70% of height.
  skin = lum > 0.55 and |sat - median sat of face-region pixels with
    lum > 0.55| < 0.1 (sat = max(R,G,B) - min(R,G,B) on 0..1).
  eyeRow = row in faceRegion with the longest horizontal run of NON-skin
    pixels flanked by skin on both sides within the region; fallback 45%
    of height with eyeRowFound:false.
  hairlineRatio = (eyeRow - hairRow) / (eyeRow - bboxTop); hairRow = median
    over centre-band (+/-5% width) columns of the first mask row going UP
    from eyeRow; null (never 0) when absent or denominator not positive.
  fringeDetected = mask below hairRow in temple columns (+/-25% width,
    outside the centre band) while the centre band has hair directly
    above the eye row.
  partGapMm = median top-35%-bbox-row width of the non-mask run crossing
    the bbox centre line within +/-15% of bbox width, times 150/faceWidthPx
    (faceWidthPx = skin run width at eyeRow; 150 mm head width); null when
    no row qualifies. partGapScore = abs(partGapMm - 3).

Dependencies: numpy and PIL only. No Blender, no network, no scipy.
"""

import json
import math
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
FACE_COL_LO, FACE_COL_HI = 0.30, 0.70
FACE_ROW_LO, FACE_ROW_HI = 0.25, 0.70
SKIN_LUMINANCE = 0.55
SKIN_SAT_TOLERANCE = 0.1
STRUCTURE_SIGMA_HP = 2.0
STRUCTURE_SIGMA_LOCAL = 8.0
ERODE_PASSES = 3
CENTRE_BAND_HALF = 0.05
TEMPLE_HALF = 0.25
PART_WINDOW_HALF = 0.15
HEAD_WIDTH_MM = 150.0
PART_TARGET_MM = 3.0


def load_image(path):
    img = Image.open(path).convert("RGB")
    arr = np.asarray(img, dtype=np.float64) / 255.0
    lum = 0.2126 * arr[:, :, 0] + 0.7152 * arr[:, :, 1] + 0.0722 * arr[:, :, 2]
    sat = arr.max(axis=2) - arr.min(axis=2)
    return img.size, arr, lum, sat  # (width, height), HxWx3, HxW, HxW


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


def gaussian_kernel1d(sigma):
    r = int(math.ceil(3.0 * sigma))
    x = np.arange(-r, r + 1, dtype=np.float64)
    k = np.exp(-0.5 * (x / sigma) ** 2)
    k /= k.sum()
    return r, k


def gaussian_blur(lum, sigma):
    """Separable Gaussian blur with edge replication (no scipy)."""
    h, w = lum.shape
    r, k = gaussian_kernel1d(sigma)
    padded = np.pad(lum, ((0, 0), (r, r)), mode="edge")
    tmp = np.zeros_like(lum)
    for i, kv in enumerate(k):
        tmp += kv * padded[:, i : i + w]
    padded = np.pad(tmp, ((r, r), (0, 0)), mode="edge")
    out = np.zeros_like(lum)
    for i, kv in enumerate(k):
        out += kv * padded[i : i + h, :]
    return out


def min_filter3(f):
    """One pass of a 3x3 minimum filter with edge replication."""
    padded = np.pad(f, 1, mode="edge")
    h, w = f.shape
    out = padded[1 : h + 1, 1 : w + 1].copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            out = np.minimum(out, padded[1 + dy : h + 1 + dy, 1 + dx : w + 1 + dx])
    return out


def erode_mask(mask, passes=ERODE_PASSES):
    f = mask.astype(np.float64)
    for _ in range(passes):
        f = min_filter3(f)
    return f > 0.5


def structure_v0(lum, mask):
    mean_lum = float(lum[mask].mean())
    lap = laplacian4(lum)
    return float(lap[mask].var() / (mean_lum + 0.02) ** 2)


def structure_v1(lum, mask):
    # Attempt 2 (attempt 1 = mean of (hp/local)^2 gave r13 > target > r45,
    # see findings.txt): strand structure grows with both strand contrast
    # AND strand-bearing area, so total high-pass contrast energy over the
    # eroded interior instead of the area-normalized mean. Same building
    # blocks (hp, local, 3px erosion), different aggregate.
    hp = lum - gaussian_blur(lum, STRUCTURE_SIGMA_HP)
    local = gaussian_blur(lum, STRUCTURE_SIGMA_LOCAL) + 0.02
    energy = np.abs(hp / local)
    interior = erode_mask(mask)
    if not interior.any():
        interior = mask
    return float(energy[interior].sum())


def face_region(h, w):
    fx0, fx1 = int(w * FACE_COL_LO), int(w * FACE_COL_HI)
    fy0, fy1 = int(h * FACE_ROW_LO), int(h * FACE_ROW_HI)
    return fx0, fx1, fy0, fy1


def skin_mask(lum, sat, fx0, fx1, fy0, fy1):
    bright = lum[fy0:fy1, fx0:fx1] > SKIN_LUMINANCE
    ref = sat[fy0:fy1, fx0:fx1][bright]
    med_sat = float(np.median(ref)) if ref.size else 0.0
    skin = (lum > SKIN_LUMINANCE) & (np.abs(sat - med_sat) < SKIN_SAT_TOLERANCE)
    return skin, med_sat


def find_eye_row(skin, fx0, fx1, fy0, fy1, h):
    """Row with the longest skin-flanked non-skin run; fallback 45% height."""
    best_row = None
    best_len = 0
    for y in range(fy0, min(fy1, h)):
        row = skin[y, fx0:fx1]
        x = 0
        n = fx1 - fx0
        while x < n:
            if row[x]:
                x += 1
                continue
            run_l = x
            while x < n and not row[x]:
                x += 1
            run_r = x - 1
            left_skin = row[:run_l].any()
            right_skin = row[run_r + 1 :].any()
            if left_skin and right_skin and (run_r - run_l + 1) > best_len:
                best_len = run_r - run_l + 1
                best_row = y
    if best_row is None:
        return int(h * 0.45), False
    return best_row, True


def skin_run_width_at_row(skin, y, fx0, fx1):
    row = skin[y, fx0:fx1]
    best = 0
    cur = 0
    for v in row:
        if v:
            cur += 1
            best = max(best, cur)
        else:
            cur = 0
    return float(best)


def hair_row_from_band(mask, eye_row, cx, w):
    half = int(w * CENTRE_BAND_HALF)
    cols = range(max(cx - half, 0), min(cx + half + 1, mask.shape[1]))
    hits = []
    for x in cols:
        for y in range(min(eye_row, mask.shape[0] - 1), -1, -1):
            if mask[y, x]:
                hits.append(y)
                break
    if not hits:
        return None
    return float(np.median(hits))


def fringe_detected(mask, hair_row, eye_row, cx, w, h):
    if hair_row is None:
        return False
    half_band = int(w * CENTRE_BAND_HALF)
    half_temple = int(w * TEMPLE_HALF)
    lo = max(int(cx - half_temple), 0)
    hi = min(int(cx + half_temple + 1), w)
    band_lo = max(int(cx - half_band), 0)
    band_hi = min(int(cx + half_band + 1), w)
    hr = int(hair_row)
    below = False
    for x in list(range(lo, band_lo)) + list(range(band_hi, hi)):
        if mask[hr + 1 :, x].any():
            below = True
            break
    strip_top = max(hr, eye_row - max(int(h * 0.05), 1))
    above_eye = bool(mask[strip_top:eye_row, band_lo:band_hi].any())
    return bool(below and above_eye)


def part_gap_mm(mask, top, bottom, left, right, face_width_px):
    bbox_w = right - left
    bbox_h = bottom - top
    if bbox_w <= 0 or face_width_px <= 0:
        return None
    cx = (left + right) // 2
    cut = top + int(bbox_h * TOP_ROWS_FRACTION)
    window = bbox_w * PART_WINDOW_HALF
    gaps = []
    for y in range(top, min(cut, mask.shape[0])):
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
        if run_l < cx - window or run_r > cx + window:
            continue
        gaps.append(run_r - run_l + 1)
    if not gaps:
        return None
    return float(np.median(gaps)) * HEAD_WIDTH_MM / face_width_px


def evaluate(path):
    (width, height), _arr, lum, sat = load_image(path)
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

    fx0, fx1, fy0, fy1 = face_region(h, w)
    skin, _med_sat = skin_mask(lum, sat, fx0, fx1, fy0, fy1)
    eye_row, eye_found = find_eye_row(skin, fx0, fx1, fy0, fy1, h)
    face_width_px = skin_run_width_at_row(skin, eye_row, fx0, fx1)

    if mask_pixels == 0:
        return {
            "image": os.path.basename(path),
            "width": width,
            "height": height,
            "hairAreaFraction": 0.0,
            "hairBboxAspect": 0.0,
            "volume": 0.0,
            "structure": 0.0,
            "structureV0": 0.0,
            "partGapFraction": 0.0,
            "partGapMm": None,
            "partGapScore": None,
            "hairlineRatio": None,
            "fringeDetected": False,
            "eyeRowFound": eye_found,
            "faceWidthPx": face_width_px,
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
    struct_v0 = structure_v0(lum, mask)
    struct_v1 = structure_v1(lum, mask)

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

    cx_face = (fx0 + fx1) // 2
    hair_row = hair_row_from_band(mask, eye_row, cx_face, w)
    denom = eye_row - top
    if hair_row is None or denom <= 0:
        hairline_ratio = None
    else:
        hairline_ratio = (eye_row - hair_row) / denom

    fringe = fringe_detected(mask, hair_row, eye_row, cx_face, w, h)

    gap_mm = part_gap_mm(mask, top, bottom, left, right, face_width_px)
    gap_score = abs(gap_mm - PART_TARGET_MM) if gap_mm is not None else None

    return {
        "image": os.path.basename(path),
        "width": width,
        "height": height,
        "hairAreaFraction": hair_area_fraction,
        "hairBboxAspect": bbox_aspect,
        "volume": hair_area_fraction,
        "structure": struct_v1,
        "structureV0": struct_v0,
        "partGapFraction": part_gap_fraction,
        "partGapMm": gap_mm,
        "partGapScore": gap_score,
        "hairlineRatio": hairline_ratio,
        "fringeDetected": fringe,
        "eyeRowFound": eye_found,
        "faceWidthPx": face_width_px,
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
