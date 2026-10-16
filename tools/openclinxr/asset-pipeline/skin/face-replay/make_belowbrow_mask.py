#!/usr/bin/env python3
"""Below-brow face mask builder (port5 scratch, not tracked).

Mask = skin gate AND rows below the brow line. Same procedure on every
render (pre, final, goal); no per-image constants.

Skin gate: identical to make_render_mask.py (CIELAB a*>6, 25<L<90,
largest connected component, hole-fill, erode 8px@1024).

Eye positions: enclosed holes of the largest skin component (flood-fill
from the image corner; background connects to the border so only truly
enclosed non-skin regions remain). Candidate eye holes: area>=800,
centroid rows in [0.35H,0.62H], |x-cx|>=40 where cx is the component
centroid x. Largest candidate left of cx + largest right of cx merge to
the eye pair. eye_row = mean of the two centroid rows; IED = their
|x| separation. Brow line: brow_row = eye_row - 60 (fixed offset, same
for all images; ~brow-to-eye distance at 1024px).

Mouth: enclosed holes below the eyes scored by dark-core strength
(oral gap = strongest L<20 line), restricted to holes with clean skin
below (rejects jaw/neck crease). mouth_bottom anchors the chin patch.

Regions (40x40 boxes, Lab over gate&below-brow pixels if n>=300,
gatefrac noted): L/R cheek at (cx-+115, eye_row+95);
forehead-below-brow at (cx, brow_row+25); chin at (cx, mouth_bottom+35).

Outputs: <out-png> mask (255 = keep), <out-json> with method, rows,
per-region Lab, and the hole shortlist. Refuses (non-zero exit) if no
eye pair is found.
"""
import json
import sys

import cv2
import numpy as np
from PIL import Image
from skimage.color import rgb2lab

BROW_OFFSET = 60
MOUTH_LO, MOUTH_HI = 80, 330
DARK_HALF = 100
BELOW_CLEAN_MAX = 0.15
PATCH_R = 20
PATCH_MIN_N = 300


def skin_gate_biggest(lab):
    L, A = lab[..., 0], lab[..., 1]
    gate = ((A > 6) & (L > 25) & (L < 90)).astype(np.uint8)
    ncc, comp, stats, cent = cv2.connectedComponentsWithStats(gate, 8)
    if ncc < 2:
        raise RuntimeError("empty skin gate")
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return gate, comp, biggest, cent


def eroded_filled(comp, biggest, w, h):
    m = (comp == biggest).astype(np.uint8) * 255
    flood = m.copy()
    ffmask = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(flood, ffmask, (0, 0), 128)
    holes = ((flood != 128) & (m == 0)).astype(np.uint8)
    k = max(3, int(8 * w / 1024) | 1)
    me = cv2.erode(m, np.ones((k, k), np.uint8))
    return me, holes


def eye_pair(holes, cx, h):
    nh, _, sh, ceh = cv2.connectedComponentsWithStats(holes, 8)
    cands = []
    for i in range(1, nh):
        area, cxx, cyy = sh[i, 4], ceh[i][0], ceh[i][1]
        if area >= 800 and 0.35 * h <= cyy <= 0.62 * h and abs(cxx - cx) >= 40:
            cands.append((area, i))
    left = [(a, i) for a, i in cands if ceh[i][0] < cx]
    right = [(a, i) for a, i in cands if ceh[i][0] > cx]
    if not left or not right:
        raise RuntimeError(
            f"no enclosed eye pair: {len(left)} left / {len(right)} right "
            f"candidates (cx={cx})")
    li, ri = max(left)[1], max(right)[1]
    eye_row = float(ceh[li][1] + ceh[ri][1]) / 2.0
    ied = float(abs(ceh[li][0] - ceh[ri][0]))
    holes_short = [
        {"area": int(sh[i, 4]),
         "centroid": [round(float(ceh[i][0]), 1), round(float(ceh[i][1]), 1)],
         "bbox_xywh": [int(sh[i, 0]), int(sh[i, 1]),
                       int(sh[i, 2]), int(sh[i, 3])]}
        for _, i in sorted(cands, reverse=True)[:6]]
    return eye_row, ied, holes_short


def mouth_hole(L, gate, holes, eye_row, h, cx, w):
    """Mouth = enclosed hole in the mouth row-band with the strongest dark
    core (oral gap = strongest L<20 line over cx+-100 cols).

    Row-band [0.64H, 0.76H] (same fractions on every image): both the
    tracked portrait capture and the goal photo are 1024px head portraits
    with the face vertically centred, so the mouth line falls in this
    band while nose-base shadow (above) and jaw/neck crease shadow
    (below) fall outside it. No per-image numbers. Refuses when the band
    holds no enclosed hole (framing assumption visibly broken).
    """
    nh, ch, sh, ceh = cv2.connectedComponentsWithStats(holes, 8)
    lo, hi = 0.64 * h, 0.76 * h
    scored = []
    for i in range(1, nh):
        cxx, cyy = ceh[i][0], ceh[i][1]
        if not (lo <= cyy <= hi and abs(cxx - cx) < 100
                and sh[i, 4] >= 400):
            continue
        x, y, ww, hh = (int(sh[i, 0]), int(sh[i, 1]),
                        int(sh[i, 2]), int(sh[i, 3]))
        cols = np.arange(max(0, cx - DARK_HALF), min(w, cx + DARK_HALF))
        core = max(int((L[r, cols] < 20).sum()) for r in range(y, y + hh))
        scored.append((core, i))
    if not scored:
        raise RuntimeError(
            "no enclosed mouth hole in rows [0.64H,0.76H]: refuse")
    core, i = max(scored)
    return (int(ceh[i][0]), int(ceh[i][1]),
            int(sh[i, 1] + sh[i, 3]), core, len(scored))


def patch_lab(lab, keep, cx, cy):
    h, w = keep.shape
    x0, x1 = max(0, cx - PATCH_R), min(w, cx + PATCH_R)
    y0, y1 = max(0, cy - PATCH_R), min(h, cy + PATCH_R)
    box = np.zeros_like(keep)
    box[y0:y1, x0:x1] = 1
    sel = (keep > 0) & (box > 0)
    n = int(sel.sum())
    frac = float(sel.sum() / max(1, (y1 - y0) * (x1 - x0)))
    mean = ([round(float(v), 2) for v in lab[sel].mean(axis=0)]
            if n >= PATCH_MIN_N else None)
    return {"center": [cx, cy], "n": n, "gatefrac": round(frac, 3),
            "Lab": mean}


def build(png_in, png_out, json_out):
    pil = Image.open(png_in).convert("RGB")
    w, h = pil.size
    lab = rgb2lab(np.asarray(pil).astype(float) / 255.0)
    L = lab[..., 0]
    gate, comp, biggest, cent = skin_gate_biggest(lab)
    cx = int(cent[biggest][0])
    me, holes = eroded_filled(comp, biggest, w, h)
    eye_row, ied, short = eye_pair(holes, cx, h)
    brow_row = int(round(eye_row - BROW_OFFSET))
    mouth_cx, mouth_cy, mouth_bottom, mouth_core, mouth_ncand = \
        mouth_hole(L, gate, holes, eye_row, h, cx, w)
    keep = ((me > 0) & (np.arange(h)[:, None] > brow_row)).astype(np.uint8)
    regions = {
        "L_cheek": patch_lab(lab, keep, cx - 115, int(round(eye_row + 95))),
        "R_cheek": patch_lab(lab, keep, cx + 115, int(round(eye_row + 95))),
        "forehead_below_brow": patch_lab(lab, keep, cx, brow_row + 25),
        "chin": patch_lab(lab, keep, cx, mouth_bottom + 35),
    }
    Image.fromarray(keep * 255).save(png_out)
    ys, xs = np.where(keep > 0)
    info = {"input": png_in,
            "method": "skinchroma-a6-largest-erode8-below-brow60",
            "cx": cx, "eye_row": round(eye_row, 1), "ied": round(ied, 1),
            "brow_row": brow_row,
            "mouth_centroid": [mouth_cx, mouth_cy],
            "mouth_bottom": mouth_bottom,
            "mouth_core_Llt20": mouth_core,
            "mouth_band_candidates": mouth_ncand,
            "n": int((keep > 0).sum()),
            "bbox_xywh": [int(xs.min()), int(ys.min()),
                          int(xs.max() - xs.min()),
                          int(ys.max() - ys.min())],
            "regions": regions, "eye_hole_shortlist": short}
    json.dump(info, open(json_out, "w"), indent=1)
    print(json.dumps(info), flush=True)


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2], sys.argv[3])
