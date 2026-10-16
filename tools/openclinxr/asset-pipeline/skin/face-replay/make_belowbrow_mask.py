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
|x| separation. Brow line: brow_row = eye_row - BROW_IED*ied (ied-scaled
so the mask band starts on the same anatomy on every face size; ratio
from the goal placement, see constants).

Mouth: the lip parting (darkest horizontal band of the face-column
lightness profile below the nose) and mouth_bottom (first row below the
sub-labial crease dip where chin skin resumes). No enclosed-hole
requirement, so closed lips (which pass the skin gate) no longer fall
through to the nostril. mouth_bottom anchors the chin patch.

Regions (Lab over polygon pixels intersected with the eroded skin
gate, n>=300 floor; gatefrac = kept/poly): forehead, L/R cheek, chin
from FaceLandmarker polygons (face_landmark_regions.py wiring
face-gate/face_gate.py, read-only), plus measured-but-ungated
upperlip_skin. The 40x40 legacy boxes survive under "legacy_boxes" for
comparison (L/R cheek at (cx-+115, eye_row+95);
forehead-below-brow at (cx, eye_row-FH_IED*ied); chin at
(cx, mouth_bottom+CHIN_MARGIN*ied)).

Outputs: <out-png> mask (255 = keep), <out-json> with method, rows,
per-region Lab, and the hole shortlist. Refuses (non-zero exit) if no
eye pair is found.
"""
import json
import math
import sys

import cv2
import numpy as np
from PIL import Image
from skimage.color import rgb2lab

BROW_OFFSET = 60  # legacy fixed-pixel value, kept for reference only
# Brow and forehead offsets in ied units, ratios taken from the GOAL's
# landed placement (S/port5/goal-bb-mask.json: eye_row 419, brow_row 359,
# forehead centre 384, ied 264.9): brow sits (419-359)/264.9 = 0.2265
# ied above the eye line, the forehead patch centre (419-384)/264.9 =
# 0.1321 ied above it. The old fixed 60px brow offset put the render
# forehead box (smaller face, ied 225.4) on the glabella while the goal
# box sat above the brows; scaling by ied lands both on the same
# anatomy (goal placement unchanged by construction).
BROW_IED = 60.0 / 264.9
FH_IED = 35.0 / 264.9
# Mouth profile rule (all in ied units; sourced from the STEP0 column
# profiles S/mouthlm/profile.json, mean Lab over cx+-15, 1024px images):
# - PART_LO/PART_HI: parting sits ~1.2 ied below eye_row (render
#   (812-527.4)/225.4=1.26, goal (728-419)/264.9=1.17, pre-hb1
#   (819-539.6)/238.8=1.17); the window [0.95,1.35] excludes the
#   nostril shadow above (~0.89 ied on render: (728-527.4)/225.4) and
#   the sub-labial/jaw shadow below (>=1.38 ied: goal (784-419)/264.9,
#   render (868-527.4)/225.4=1.51).
# - DIP_LO/DIP_HI: the sub-labial crease dip sits ~0.2 ied below the
#   parting (render (870-816)/225.4=0.24, goal (785-733)/264.9=0.20,
#   pre-hb1 (869-819)/238.8=0.21); the window [0.15,0.50] brackets it
#   while excluding the parting's own dark skirt (ends <0.1 ied below
#   the minimum) and the jaw shadow (>=0.5 ied below the parting:
#   render (944-816)/225.4=0.57, goal (868-733)/264.9=0.51,
#   pre-hb1 (945-819)/238.8=0.53). The dip separates lip red above from
#   chin skin below, so no chroma test is needed: lip a* reaches 29
#   (pre-hb1 lower lip) while chin a* reaches 20 (pre-hb1 chin), which
#   no single a* threshold separates, while every image carries an L<35
#   crease trough between them.
# - PROF_HALF: column half-width; the STEP0 +-15px probe is 15/225.4=0.067
#   ied (render) and 15/264.9=0.057 ied (goal); 0.07 reproduces it.
# - SKIN_L_MIN: chin-skin resume test (lightness only; chroma cannot
#   separate lip red from red chin skin, so the crease dip does).
#   Crease troughs read L<=33 on all three images (render 868-876
#   L 25-32, goal 780-800 L 10-28, pre-hb1 857-877 L 23-33) while
#   chin-skin plateaus read L>=38 at resume. The resume needs a
#   sustained run (RESUME_LEN), not one row.
# - RESUME_LEN: sustained-run length; 0.10 ied ~= 23/26 rows, longer than
#   any post-dip bright flicker and shorter than any chin plateau
#   (~50px ~= 0.2 ied: render 880-930, goal 808-864, pre-hb1 880-944).
# - CHIN_MARGIN: chin centre below mouth_bottom; 0.12 ied ~= 27/32px puts
#   the 40px box mid-plateau (render 880+27=907: box 887-927 in 880-930;
#   goal 808+32=840: box 820-860 in 808-864).
PART_LO, PART_HI = 0.95, 1.35
DIP_LO, DIP_HI = 0.15, 0.50
PROF_HALF = 0.07
SKIN_L_MIN = 35.0
RESUME_LEN = 0.10
CHIN_MARGIN = 0.12
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


def mouth_parting(L, eye_row, ied, cx, w, h):
    """Mouth = the lip parting: darkest row of the face-column lightness
    profile in [eye+PART_LO*ied, eye+PART_HI*ied].

    The column mean (over cx+-PROF_HALF*ied) averages out speckle while
    the window brackets the ~1.2-ied eye-to-mouth distance, so neither
    the nostril shadow above nor the sub-labial/jaw shadow below can win.
    No enclosed-hole requirement: closed lips pass the skin gate, so the
    old hole rule fell through to the nostril. Refuses only when the
    window is empty (framing assumption visibly broken).
    """
    hw = max(8, int(round(PROF_HALF * ied)))
    cols = np.arange(max(0, cx - hw), min(w, cx + hw))
    lo = int(math.ceil(eye_row + PART_LO * ied))
    hi = int(math.floor(eye_row + PART_HI * ied))
    if hi <= lo or lo >= h:
        raise RuntimeError(
            "no parting search window: eye_row/ied framing broken")
    hi = min(hi, h - 1)
    prof = L[lo:hi + 1][:, cols].mean(axis=1)
    row = lo + int(np.argmin(prof))
    return row, float(prof[row - lo])


def mouth_bottom_row(L, parting_row, ied, cx, w, h):
    """mouth_bottom = lower edge of the mouth complex: the sub-labial
    crease dip (darkest column-lightness row in
    [parting+DIP_LO*ied, parting+DIP_HI*ied]) anchors the search, and
    mouth_bottom is the first row below the dip where lightness returns
    to skin (L>=SKIN_L_MIN sustained for RESUME_LEN*ied rows).

    The dip separates lip red above from chin skin below on every
    image, so the resume test needs no chroma threshold (lip a* hits
    29 while reddish chin skin hits 20: inseparable). Refuses when the
    dip window is empty or no resume follows (framing broken).
    """
    hw = max(8, int(round(PROF_HALF * ied)))
    cols = np.arange(max(0, cx - hw), min(w, cx + hw))
    prof = L[:, cols].mean(axis=1)
    dlo = parting_row + int(math.floor(DIP_LO * ied))
    dhi = parting_row + int(math.ceil(DIP_HI * ied))
    if dhi <= dlo or dlo >= h:
        raise RuntimeError(
            "no crease-dip search window: parting/ied framing broken")
    dhi = min(dhi, h - 1)
    dip = dlo + int(np.argmin(prof[dlo:dhi + 1]))
    need = max(4, int(round(RESUME_LEN * ied)))
    run = 0
    for r in range(dip + 1, h):
        run = run + 1 if prof[r] >= SKIN_L_MIN else 0
        if run >= need:
            return r - need + 1, dip
    raise RuntimeError("no chin-skin resume below the crease dip: refuse")


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
    brow_row = int(round(eye_row - BROW_IED * ied))
    fh_cy = int(round(eye_row - FH_IED * ied))
    parting_row, parting_L = mouth_parting(L, eye_row, ied, cx, w, h)
    skin_resume, crease_dip = mouth_bottom_row(L, parting_row, ied, cx, w, h)
    chin_cy = skin_resume + int(round(CHIN_MARGIN * ied))
    keep = ((me > 0) & (np.arange(h)[:, None] > brow_row)).astype(np.uint8)
    legacy_boxes = {
        "L_cheek": patch_lab(lab, keep, cx - 115, int(round(eye_row + 95))),
        "R_cheek": patch_lab(lab, keep, cx + 115, int(round(eye_row + 95))),
        "forehead_below_brow": patch_lab(lab, keep, cx, fh_cy),
        "chin": patch_lab(lab, keep, cx, chin_cy),
    }
    import face_landmark_regions as _flr
    regions, lm_info, _polys = _flr.polygon_regions(
        lab, (me > 0).astype(np.uint8), pil,
        _flr.create_landmarker())
    lip_agree = dict(lm_info["lip_rows"], parting_row=parting_row)
    Image.fromarray(keep * 255).save(png_out)
    ys, xs = np.where(keep > 0)
    info = {"input": png_in,
            "method": "skinchroma-a6-largest-erode8-below-brow60-lipparting",
            "cx": cx, "eye_row": round(eye_row, 1), "ied": round(ied, 1),
            "brow_row": brow_row,
            "mouth_centroid": [cx, parting_row],
            "parting_row": parting_row,
            "parting_L": parting_L,
            "crease_dip_row": crease_dip,
            "mouth_bottom": skin_resume,
            "chin_margin_ied": CHIN_MARGIN,
            "legacy_boxes": legacy_boxes,
            "landmarks": {"spread_px": lm_info["spread_px"],
                          "model_path": lm_info["model_path"],
                          "model_sha256": lm_info["model_sha256"],
                          "cheek_mapping": lm_info["cheek_mapping"]},
            "lip_agreement_rows": lip_agree,
            "n": int((keep > 0).sum()),
            "bbox_xywh": [int(xs.min()), int(ys.min()),
                          int(xs.max() - xs.min()),
                          int(ys.max() - ys.min())],
            "regions": regions, "eye_hole_shortlist": short}
    json.dump(info, open(json_out, "w"), indent=1)
    print(json.dumps(info), flush=True)


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2], sys.argv[3])
