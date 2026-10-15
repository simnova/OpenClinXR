#!/usr/bin/env python3
"""Deterministic, LLM-free face gate: landmark-anchored regional colour/form check.

Compares a rendered portrait against a photo target using anatomical regions
derived from MediaPipe FaceLandmarker (478 landmarks) so the same region is
measured in both images whatever the framing.

CLI:
    face_gate.py --target <png> --render <png> [--render ...] --out <dir>

Outputs under <dir>: aligned/<name>.png, sbs/<name>.png, regions/<name>.png,
report.json, table.md. Prints per-clause value/threshold/pass/margin.

Detection: copied from ../landmarks/landmarks.py (same model, same index
numbering). If no face is detected the image is recorded verbatim as
detected:false and skipped (no hand estimates).
"""
import argparse
import json
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "landmarks",
                                           "models", "face_landmarker.task"))

# --------------------------------------------------------------------------
# Landmark index sets (Face Mesh canonical numbering, 478-point FaceLandmarker
# with iris refinement: 0..467 mesh + 468..472 left iris + 473..477 right iris).
# Every index below is echoed into report.json under "indices".
# --------------------------------------------------------------------------
INDICES = {
    "iris_a": [468, 469, 470, 471, 472],      # centre = mean of the 5
    "iris_b": [473, 474, 475, 476, 477],      # centre = mean of the 5
    "mouth_corners": [61, 291],               # mouth centre = mean of the 2
    # Forehead: top anchor + brow rows (bottom edge) .
    "forehead_top": [10],
    "brow_side_a": [70, 63, 105, 66, 107],
    "brow_side_b": [336, 296, 334, 293, 300],
    # Cheek quads derived from these anchors (see region_polygons).
    "cheek_a": [145, 61, 129, 101, 234],      # eye-lower, mouth-corner,
    "cheek_b": [374, 291, 358, 330, 454],     # nose-side, cheek, face-edge
    # Nose bridge+tip = convex hull of these.
    "nose": [168, 6, 197, 195, 5, 4, 1, 2, 98, 327, 129, 358],
    # Chin quad anchors: lower lip, chin tip, jaw sides.
    "chin": [17, 152, 172, 397],
    # Philtrum quad anchors: nose base, lip top, nostril outers.
    "upperlip_skin": [2, 0, 98, 327],
    # Lips: outer contour minus inner mouth contour.
    "lips_outer": [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409,
                   270, 269, 267, 0, 37, 39, 40, 185],
    "lips_inner": [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415,
                   310, 311, 312, 13, 82, 81, 80, 191],
    # Eyelid strips: brow-lower row (top) + upper lash row (bottom) + corners.
    "eyelid_a_top": [46, 53, 52, 65, 55],
    "eyelid_a_lash": [159, 158, 157, 173],
    "eyelid_a_corners": [33, 133],
    "eyelid_b_top": [276, 283, 282, 295, 285],
    "eyelid_b_lash": [386, 385, 384, 398],
    "eyelid_b_corners": [362, 263],
    # Under-eye strips (combined into one mask): lower lash + corners.
    "undereye_a": [145, 144, 153, 154, 33, 133],
    "undereye_b": [374, 373, 390, 249, 362, 263],
    "face_height": [10, 152],
}

REGION_ORDER = ["forehead", "cheek_side_a", "cheek_side_b", "nose", "chin",
                "upperlip_skin", "lips", "eyelid_a", "eyelid_b", "undereye"]

REGION_COLORS = {  # BGR for cv2 overlay
    "forehead": (255, 0, 0), "cheek_side_a": (0, 255, 0),
    "cheek_side_b": (0, 255, 255), "nose": (255, 0, 255),
    "chin": (0, 165, 255), "upperlip_skin": (255, 255, 0),
    "lips": (0, 0, 255), "eyelid_a": (255, 255, 255),
    "eyelid_b": (128, 128, 128), "undereye": (0, 128, 255),
}

THRESHOLDS = {
    "C1_de2000": {"value": 8.0, "source": "CALIBRATED by self-test: same-person "
                  "flat-light noise floor reached dE 7.13 on the lit cheek, "
                  "so 6 was too tight; 8 keeps every true render failing "
                  "(min true maxdE 6.78 still fails skin via C2/C3)"},
    "C2a_abstol": {"value": 2.5, "source": "DERIVED max(2.5_brief_floor, "
                   "1.5*0.581_noise)=2.5: flat-vs-lit a-spread noise 0.581 "
                   "(flat-vs-lit-sweep.json) so 1.5*noise=0.87, brief floor "
                   "2.5 applies; flat 0.58 + good 0.80 pass, bad 2.70 fails"},
    "C2b_abstol": {"value": 6.24, "source": "DERIVED max(5.0_brief_floor, "
                   "1.5*4.16_noise)=6.24: flat-vs-lit L-spread noise 4.16 "
                   "(flat-vs-lit-sweep.json) so 1.5*noise=6.24 wins over the "
                   "brief floor; flat 4.16 + good 0.76 pass, bad 14.6 fails"},
    "C3a_abstol": {"value": 5.0, "source": "DERIVED max(5.0_brief_floor, "
                   "1.5*0.154_noise)=5.0: flat-vs-lit da noise 0.154 "
                   "(flat-vs-lit-sweep.json) so 1.5*noise=0.23, brief floor "
                   "5.0 applies; good 4.06 passes, bad 7.4/10.82 fail"},
    "C3b_abstol": {"value": 5.0, "source": "DERIVED max(5.0_brief_floor, "
                   "1.5*0.224_noise)=5.0: flat-vs-lit db noise 0.224 "
                   "(flat-vs-lit-sweep.json) so 1.5*noise=0.34, brief floor "
                   "5.0 applies; good 0.31 passes, bad 15.33 fails"},
    "C3ratio_abstol": {"value": 0.08, "source": "DERIVED max(0.08_brief_floor, "
                       "1.5*0.010_noise)=0.08: flat-vs-lit ratio noise 0.010 "
                       "(flat-vs-lit-sweep.json) so 1.5*noise=0.015, brief "
                       "floor 0.08 applies; good 0.037 passes, bad 0.29 fails"},
    "C4_abstol": {"value": 3.0, "source": "DERIVED max(3.0_brief_floor, "
                  "1.5*1.539_noise)=3.0: flat-vs-lit eyelid noise 1.539 "
                  "(flat-vs-lit-sweep.json) so 1.5*noise=2.31, brief floor "
                  "3.0 applies; good 2.00 passes, bad 17.28 fails"},
    "C5_abstol": {"value": 4.0, "source": "DERIVED max(4.0_brief_floor, "
                  "1.5*0.164_noise)=4.0: flat-vs-lit philtrum noise 0.164 "
                  "(flat-vs-lit-sweep.json) so 1.5*noise=0.25, brief floor "
                  "4.0 applies; good 0.07 passes, bad 6.37 fails"},
    "C6_frac": {"value": 0.5, "source": "DERIVED 0.5_external_frac * "
                "v_target(chain_input): target cheek shading 0.235 "
                "(flat-vs-lit-sweep.json) gives thr 0.117; flat 0.066 fails, "
                "good 0.231 passes; LIGHTING clause, albedo cannot fix it"},
}

DETECT_FAIL_NOTE = ("no face detected by FaceLandmarker; "
                    "no hand estimate substituted")


# --------------------------------------------------------------------------
# Detection (copied from ../landmarks/landmarks.py)
# --------------------------------------------------------------------------
def create_landmarker():
    import mediapipe as mp  # noqa: F401
    from mediapipe.tasks.python import BaseOptions, vision
    options = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
    )
    return vision.FaceLandmarker.create_from_options(options)


def detect_points(landmarker, pil_img):
    """Nx2 pixel array of 478 landmarks, or None if no face."""
    import mediapipe as mp
    rgb = pil_img.convert("RGB")
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB,
                      data=np.asarray(rgb))
    result = landmarker.detect(mp_img)
    if not result.face_landmarks:
        return None
    w, h = rgb.size
    return np.array([[p.x * w, p.y * h] for p in result.face_landmarks[0]])


def load_rgb(path):
    return np.asarray(Image.open(path).convert("RGB"))


# --------------------------------------------------------------------------
# Alignment: similarity (scale/rotation/translation) render -> target from
# the two iris centres + mouth centre, irises ordered by x in each image
# (so a mirrored render still aligns instead of fitting a 180-deg rotation).
# --------------------------------------------------------------------------
def align_keys(pts):
    ia = pts[INDICES["iris_a"]].mean(axis=0)
    ib = pts[INDICES["iris_b"]].mean(axis=0)
    mouth = pts[INDICES["mouth_corners"]].mean(axis=0)
    first, second = (ia, ib) if ia[0] <= ib[0] else (ib, ia)
    return np.array([first, second, mouth], dtype=np.float64)


def estimate_similarity(src_pts, dst_pts):
    M, _ = cv2.estimateAffinePartial2D(src_pts, dst_pts, method=cv2.LMEDS)
    if M is None:
        raise RuntimeError("similarity estimation failed")
    return M


def similarity_params(M):
    scale = float(np.hypot(M[0, 0], M[1, 0]))
    rot_deg = float(math.degrees(math.atan2(M[1, 0], M[0, 0])))
    return scale, rot_deg, float(M[0, 2]), float(M[1, 2])


def warp_to_target(render_rgb, M, wt, ht):
    return cv2.warpAffine(render_rgb, M, (wt, ht),
                          flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_REPLICATE)


def apply_affine_to_points(poly, M):
    ones = np.ones((len(poly), 1))
    return (M @ np.hstack([poly, ones]).T).T


# --------------------------------------------------------------------------
# Regions: polygons in the coordinate frame of the given landmarks.
# The gate measures the TARGET's own polygons on the target, and the same
# target-frame polygons mapped BACK through the inverse similarity onto the
# render's UNWARPED original pixels (resampling never blurs the statistics).
# --------------------------------------------------------------------------
def region_polygons(pts):
    P = {i: pts[i] for i in range(len(pts))}
    polys = {}

    # Forehead: bottom row = brow points sorted by x, lifted 22% toward crown
    # (clears brow hair); top row = same points pulled 55% toward landmark 10
    # (stays below the hairline, inset from temples as brow span < temple span).
    p10 = P[10]
    brow = sorted([P[i] for i in INDICES["brow_side_a"] + INDICES["brow_side_b"]],
                  key=lambda p: p[0])
    bot = [b + (p10 - b) * 0.22 for b in brow]
    top = [b + (p10 - b) * 0.55 for b in brow]
    polys["forehead"] = np.array(bot + top[::-1])

    # Cheek quads: below eye, lateral to nose, above mouth corner, inset edge.
    def cheek_quad(eye_low, corner, nose_side, cheek, edge):
        top_y = eye_low[1] + 0.28 * (corner[1] - eye_low[1])
        bot_y = corner[1] - 0.18 * (corner[1] - eye_low[1])
        if cheek[0] > nose_side[0]:  # image-left anatomy order
            med = nose_side[0] + 0.20 * (cheek[0] - nose_side[0])
            lat = edge[0] - 0.30 * (edge[0] - cheek[0])
        else:
            med = nose_side[0] - 0.20 * (nose_side[0] - cheek[0])
            lat = edge[0] + 0.30 * (cheek[0] - edge[0])
        lo, hi = sorted([med, lat])
        return np.array([[lo, top_y], [hi, top_y], [hi, bot_y], [lo, bot_y]])

    polys["cheek_side_a"] = cheek_quad(P[145], P[61], P[129], P[101], P[234])
    polys["cheek_side_b"] = cheek_quad(P[374], P[291], P[358], P[330], P[454])

    # Nose bridge+tip: convex hull of bridge/base/nostril indices.
    nose_pts = np.array([P[i] for i in INDICES["nose"]], dtype=np.float32)
    polys["nose"] = cv2.convexHull(nose_pts).reshape(-1, 2).astype(float)

    # Chin: below lower lip, above chin tip, inset from jaw sides.
    y_top = P[17][1] + 0.22 * (P[152][1] - P[17][1])
    y_bot = P[152][1] - 0.10 * (P[152][1] - P[17][1])
    x_l = P[172][0] + 0.18 * (P[152][0] - P[172][0])
    x_r = P[397][0] - 0.18 * (P[397][0] - P[152][0])
    lo, hi = sorted([x_l, x_r])
    polys["chin"] = np.array([[lo, y_top], [hi, y_top], [hi, y_bot],
                              [lo, y_bot]])

    # Upper-lip skin (philtrum): between nose base and upper lip.
    y_t = P[2][1] + 0.15 * (P[0][1] - P[2][1])
    y_b = P[0][1] - 0.04 * (P[0][1] - P[2][1])
    x_l = P[98][0] + 0.25 * (P[2][0] - P[98][0])
    x_r = P[327][0] - 0.25 * (P[327][0] - P[2][0])
    lo, hi = sorted([x_l, x_r])
    polys["upperlip_skin"] = np.array([[lo, y_t], [hi, y_t], [hi, y_b],
                                       [lo, y_b]])

    # Lips: outer contour with inner mouth contour subtracted at raster time.
    polys["lips"] = np.array([P[i] for i in INDICES["lips_outer"]])
    polys["_lips_inner"] = np.array([P[i] for i in INDICES["lips_inner"]])

    # Eyelid strips: middle of the brow-lower-row -> upper-lash-row band
    # (30% down from the brow clears brow hair, 85% stops above the lash
    # line), corners inset 12%.
    def eyelid(top_idx, lash_idx, corners):
        brow_y = float(np.mean([P[i][1] for i in top_idx]))
        lash_y = float(np.mean([P[i][1] for i in lash_idx]))
        top_y = brow_y + 0.30 * (lash_y - brow_y)
        bot_y = brow_y + 0.85 * (lash_y - brow_y)
        xs = sorted([P[c][0] for c in corners])
        lo = xs[0] + 0.12 * (xs[1] - xs[0])
        hi = xs[1] - 0.12 * (xs[1] - xs[0])
        t, b = (top_y, bot_y) if top_y <= bot_y else (bot_y, top_y)
        return np.array([[lo, t], [hi, t], [hi, b], [lo, b]])

    polys["eyelid_a"] = eyelid(INDICES["eyelid_a_top"],
                               INDICES["eyelid_a_lash"],
                               INDICES["eyelid_a_corners"])
    polys["eyelid_b"] = eyelid(INDICES["eyelid_b_top"],
                               INDICES["eyelid_b_lash"],
                               INDICES["eyelid_b_corners"])

    # Under-eye: one combined mask of two strips below the lower lash.
    face_h = abs(P[152][1] - P[10][1])
    strips = []
    for lash_idx in (INDICES["undereye_a"][:4], INDICES["undereye_b"][:4]):
        top_y = float(np.mean([P[i][1] for i in lash_idx]))
        bot_y = top_y + 0.05 * face_h
        xs = sorted([P[INDICES["undereye_a"][4]][0],
                     P[INDICES["undereye_a"][5]][0]]) \
            if lash_idx == INDICES["undereye_a"][:4] else \
            sorted([P[INDICES["undereye_b"][4]][0],
                    P[INDICES["undereye_b"][5]][0]])
        lo = xs[0] + 0.10 * (xs[1] - xs[0])
        hi = xs[1] - 0.10 * (xs[1] - xs[0])
        strips.append(np.array([[lo, top_y], [hi, top_y], [hi, bot_y],
                                [lo, bot_y]]))
    polys["undereye"] = strips  # list of 2 quads, OR-combined at raster
    return polys


def raster_masks(polys, w, h, erode_px=3):
    """Rasterize polygons to uint8 masks, eroded so edges do not leak."""
    kernel = np.ones((3, 3), np.uint8)
    masks = {}
    for region in REGION_ORDER:
        m = np.zeros((h, w), np.uint8)
        if region == "lips":
            cv2.fillPoly(m, [polys["lips"].astype(np.int32)], 1)
            hole = np.zeros((h, w), np.uint8)
            cv2.fillPoly(hole, [polys["_lips_inner"].astype(np.int32)], 1)
            m = m * (1 - hole)
        elif region == "undereye":
            for q in polys["undereye"]:
                cv2.fillPoly(m, [q.astype(np.int32)], 1)
        else:
            cv2.fillPoly(m, [polys[region].astype(np.int32)], 1)
        m = cv2.erode(m, kernel, iterations=erode_px)
        masks[region] = m
    return masks


def rgb_to_lab(rgb):
    from skimage.color import rgb2lab
    return rgb2lab(rgb.astype(np.float64) / 255.0)


def measure_region(lab, L, mask, face_h):
    px = mask > 0
    n = int(px.sum())
    if n == 0:
        return {"L": None, "a": None, "b": None, "chroma": None,
                "band_rms": None, "n": 0}
    vals = lab[px]
    Lm, am, bm = (float(vals[:, 0].mean()), float(vals[:, 1].mean()),
                  float(vals[:, 2].mean()))
    chroma = float(math.hypot(am, bm))
    # 3-12 px band rms of L on an image resampled so the face is 512 tall.
    s = 512.0 / max(face_h, 1.0)
    Ls = cv2.resize(L, None, fx=s, fy=s, interpolation=cv2.INTER_LINEAR)
    ms = cv2.resize(mask, (Ls.shape[1], Ls.shape[0]),
                    interpolation=cv2.INTER_NEAREST) > 0
    if int(ms.sum()) == 0:
        band = None
    else:
        g3 = cv2.GaussianBlur(Ls, (0, 0), 3)
        g12 = cv2.GaussianBlur(Ls, (0, 0), 12)
        band = g3 - g12
        band = float(math.sqrt(np.mean(band[ms] ** 2)))
    return {"L": Lm, "a": am, "b": bm, "chroma": chroma, "band_rms": band,
            "n": n}


def de2000(lab1, lab2):
    from skimage.color import deltaE_ciede2000
    a = np.asarray([[lab1]], dtype=float)
    b = np.asarray([[lab2]], dtype=float)
    return float(deltaE_ciede2000(a, b)[0, 0])


# --------------------------------------------------------------------------
# Clauses
# --------------------------------------------------------------------------
def evaluate_clauses(stats_t, stats_r):
    T, R = stats_t, stats_r
    cl = {}

    def reg(s, r):
        return (s[r]["L"], s[r]["a"], s[r]["b"])

    # C1: regional colour per forehead / cheeks / chin. Cheeks are evaluated
    # under both side assignments and the better is taken: landmark indices
    # are image-anchored (verified: mirrored input keeps iris_a image-left),
    # so the swapped assignment recovers anatomical correspondence for
    # mirrored inputs, and for non-mirrored renders it only forgives a
    # flipped lighting gradient (C6's domain), never a wrong skin colour.
    c1subs = {}
    for r in ["forehead", "chin"]:
        d = de2000(reg(T, r), reg(R, r))
        thr = THRESHOLDS["C1_de2000"]["value"]
        c1subs[r] = {"value": d, "threshold": thr, "pass": bool(d <= thr),
                     "margin": d - thr,
                     "source": THRESHOLDS["C1_de2000"]["source"]}
    dE = {(t, r): de2000(reg(T, t), reg(R, r))
          for t in ("cheek_side_a", "cheek_side_b")
          for r in ("cheek_side_a", "cheek_side_b")}
    ident = max(dE[("cheek_side_a", "cheek_side_a")],
                dE[("cheek_side_b", "cheek_side_b")])
    swapped = max(dE[("cheek_side_a", "cheek_side_b")],
                  dE[("cheek_side_b", "cheek_side_a")])
    assign = "identity" if ident <= swapped else "swapped"
    for (t, r), d in dE.items():
        thr = THRESHOLDS["C1_de2000"]["value"]
        c1subs["%s_vs_%s" % (r, t)] = {
            "value": d, "threshold": thr, "pass": bool(d <= thr),
            "margin": d - thr, "source": THRESHOLDS["C1_de2000"]["source"]}
    cmax = min(ident, swapped)
    thr = THRESHOLDS["C1_de2000"]["value"]
    c1subs["cheeks_assignment"] = assign
    c1pass = all(c1subs[r]["pass"] for r in ("forehead", "chin")) and \
        bool(cmax <= thr)
    c1max = max(c1subs["forehead"]["value"], c1subs["chin"]["value"], cmax)
    cl["C1"] = {"regions": c1subs, "pass": bool(c1pass),
                "value": c1max, "assignment": assign,
                "threshold": THRESHOLDS["C1_de2000"]["value"],
                "margin": c1max - THRESHOLDS["C1_de2000"]["value"],
                "source": THRESHOLDS["C1_de2000"]["source"]}

    def cheek_mean_a(s):
        return (s["cheek_side_a"]["a"] + s["cheek_side_b"]["a"]) / 2.0

    def cheek_mean_L(s):
        return (s["cheek_side_a"]["L"] + s["cheek_side_b"]["L"]) / 2.0

    # C2: regional spread preserved.
    a_spread_t = cheek_mean_a(T) - T["forehead"]["a"]
    a_spread_r = cheek_mean_a(R) - R["forehead"]["a"]
    d_a = abs(a_spread_r - a_spread_t)
    L_spread_t = T["forehead"]["L"] - T["chin"]["L"]
    L_spread_r = R["forehead"]["L"] - R["chin"]["L"]
    d_L = abs(L_spread_r - L_spread_t)
    c2a = {"value": d_a, "threshold": THRESHOLDS["C2a_abstol"]["value"],
           "pass": bool(d_a <= THRESHOLDS["C2a_abstol"]["value"]),
           "margin": d_a - THRESHOLDS["C2a_abstol"]["value"],
           "source": THRESHOLDS["C2a_abstol"]["source"]}
    c2b = {"value": d_L, "threshold": THRESHOLDS["C2b_abstol"]["value"],
           "pass": bool(d_L <= THRESHOLDS["C2b_abstol"]["value"]),
           "margin": d_L - THRESHOLDS["C2b_abstol"]["value"],
           "source": THRESHOLDS["C2b_abstol"]["source"]}
    cl["C2"] = {"a_spread": c2a, "L_spread": c2b,
                "pass": bool(c2a["pass"] and c2b["pass"])}

    # C3: lips vs cheek.
    da = abs((R["lips"]["a"] - cheek_mean_a(R))
             - (T["lips"]["a"] - cheek_mean_a(T)))
    db = abs((R["lips"]["b"] - cheek_mean_b(R))
             - (T["lips"]["b"] - cheek_mean_b(T)))
    # use mean-cheek L for the ratio (stable under asymmetry)
    ratio_t = T["lips"]["L"] / cheek_mean_L(T)
    ratio_r = R["lips"]["L"] / cheek_mean_L(R)
    d_ratio = abs(ratio_r - ratio_t)
    c3a = {"value": da, "threshold": THRESHOLDS["C3a_abstol"]["value"],
           "pass": bool(da <= THRESHOLDS["C3a_abstol"]["value"]),
           "margin": da - THRESHOLDS["C3a_abstol"]["value"],
           "source": THRESHOLDS["C3a_abstol"]["source"]}
    c3b = {"value": db, "threshold": THRESHOLDS["C3b_abstol"]["value"],
           "pass": bool(db <= THRESHOLDS["C3b_abstol"]["value"]),
           "margin": db - THRESHOLDS["C3b_abstol"]["value"],
           "source": THRESHOLDS["C3b_abstol"]["source"]}
    c3c = {"value": d_ratio,
           "threshold": THRESHOLDS["C3ratio_abstol"]["value"],
           "pass": bool(d_ratio <= THRESHOLDS["C3ratio_abstol"]["value"]),
           "margin": d_ratio - THRESHOLDS["C3ratio_abstol"]["value"],
           "source": THRESHOLDS["C3ratio_abstol"]["source"]}
    cl["C3"] = {"a_diff": c3a, "b_diff": c3b, "L_ratio": c3c,
                "pass": bool(c3a["pass"] and c3b["pass"] and c3c["pass"])}

    # C4: eyelids vs cheek.
    def eyelid_mean_a(s):
        return (s["eyelid_a"]["a"] + s["eyelid_b"]["a"]) / 2.0

    d_e = abs((eyelid_mean_a(R) - cheek_mean_a(R))
              - (eyelid_mean_a(T) - cheek_mean_a(T)))
    c4 = {"value": d_e, "threshold": THRESHOLDS["C4_abstol"]["value"],
          "pass": bool(d_e <= THRESHOLDS["C4_abstol"]["value"]),
          "margin": d_e - THRESHOLDS["C4_abstol"]["value"],
          "source": THRESHOLDS["C4_abstol"]["source"]}
    cl["C4"] = {**c4, "pass": bool(c4["pass"])}

    # C5: upper-lip skin vs forehead (L).
    d_u = abs((R["upperlip_skin"]["L"] - R["forehead"]["L"])
              - (T["upperlip_skin"]["L"] - T["forehead"]["L"]))
    c5 = {"value": d_u, "threshold": THRESHOLDS["C5_abstol"]["value"],
          "pass": bool(d_u <= THRESHOLDS["C5_abstol"]["value"]),
          "margin": d_u - THRESHOLDS["C5_abstol"]["value"],
          "source": THRESHOLDS["C5_abstol"]["source"]}
    cl["C5"] = {**c5, "pass": bool(c5["pass"])}

    # C6: form shading (LIGHTING clause; albedo cannot fix it).
    lit = "cheek_side_a" if T["cheek_side_a"]["L"] >= T["cheek_side_b"]["L"] \
        else "cheek_side_b"
    shadow = "cheek_side_b" if lit == "cheek_side_a" else "cheek_side_a"
    v_t = (T[lit]["L"] - T[shadow]["L"]) / cheek_mean_L(T)
    v_r = (R[lit]["L"] - R[shadow]["L"]) / cheek_mean_L(R)
    c6pass = bool(v_r >= THRESHOLDS["C6_frac"]["value"] * v_t) if v_t > 1e-9 \
        else bool(abs(v_r) <= 1e-9)
    cl["C6"] = {"value": v_r, "target_value": v_t,
                "threshold": THRESHOLDS["C6_frac"]["value"] * v_t,
                "pass": c6pass, "margin": v_r - THRESHOLDS["C6_frac"]["value"]
                * v_t, "lit_side": lit,
                "source": THRESHOLDS["C6_frac"]["source"]}

    skin = all(cl[k]["pass"] for k in ["C1", "C2", "C3", "C4", "C5"])
    cl["skinPass"] = bool(skin)
    cl["lightingPass"] = bool(cl["C6"]["pass"])
    return cl


def cheek_mean_b(s):
    return (s["cheek_side_a"]["b"] + s["cheek_side_b"]["b"]) / 2.0


# --------------------------------------------------------------------------
# Full comparison of one target/render pair
# --------------------------------------------------------------------------
def compare_pair(landmarker, target_rgb, render_rgb):
    ht, wt = target_rgb.shape[:2]
    hr, wr = render_rgb.shape[:2]
    pts_t = detect_points(landmarker, Image.fromarray(target_rgb))
    pts_r = detect_points(landmarker, Image.fromarray(render_rgb))
    if pts_t is None:
        return {"target_detected": False, "note": DETECT_FAIL_NOTE}
    if pts_r is None:
        return {"target_detected": True, "render_detected": False,
                "note": DETECT_FAIL_NOTE}

    M = estimate_similarity(align_keys(pts_r), align_keys(pts_t))
    Minv = cv2.invertAffineTransform(M)
    scale, rot, tx, ty = similarity_params(M)
    aligned = warp_to_target(render_rgb, M, wt, ht)

    # Regions defined once in the target frame; mapped back for the render.
    polys_t = region_polygons(pts_t)
    masks_t = raster_masks(polys_t, wt, ht)
    polys_back, masks_r = {}, {}
    back = {k: (apply_affine_to_points(v, Minv) if isinstance(v, np.ndarray)
                else [apply_affine_to_points(q, Minv) for q in v])
            for k, v in polys_t.items()}
    tmp = dict(back)
    tmp["lips"], tmp["_lips_inner"] = back["lips"], back["_lips_inner"]
    masks_r = raster_masks({**{k: v for k, v in tmp.items()
                               if not isinstance(v, list)},
                            "undereye": tmp["undereye"]}, wr, hr)

    lab_t, lab_r = rgb_to_lab(target_rgb), rgb_to_lab(render_rgb)
    face_h_t = abs(pts_t[152][1] - pts_t[10][1])
    face_h_r = abs(pts_r[152][1] - pts_r[10][1])
    stats_t = {r: measure_region(lab_t, lab_t[:, :, 0], masks_t[r], face_h_t)
               for r in REGION_ORDER}
    stats_r = {r: measure_region(lab_r, lab_r[:, :, 0], masks_r[r], face_h_r)
               for r in REGION_ORDER}
    clauses = evaluate_clauses(stats_t, stats_r)

    # Face bbox from target landmarks + 12% margin, clamped.
    allp = pts_t
    x0, y0, x1, y1 = (float(allp[:, 0].min()), float(allp[:, 1].min()),
                      float(allp[:, 0].max()), float(allp[:, 1].max()))
    mx, my = (x1 - x0) * 0.12, (y1 - y0) * 0.12
    crop = [max(0, int(x0 - mx)), max(0, int(y0 - my)),
            min(wt, int(x1 + mx)), min(ht, int(y1 + my))]
    return {"target_detected": True, "render_detected": True,
            "M": M.tolist(), "Minv": Minv.tolist(),
            "alignment": {"scale": scale, "rotation_deg": rot, "tx": tx,
                          "ty": ty, "upscaled": bool(scale > 1.25)},
            "crop": crop, "target_stats": stats_t, "render_stats": stats_r,
            "clauses": clauses, "aligned": aligned, "polys_t": polys_t,
            "back": back,
            "face_h": {"target": float(face_h_t), "render": float(face_h_r)}}


def draw_regions_overlay(rgb, polys, title_regions=True):
    vis = cv2.cvtColor(rgb.copy(), cv2.COLOR_RGB2BGR)
    for region in REGION_ORDER:
        p = polys.get(region)
        if p is None:
            continue
        quads = p if isinstance(p, list) else [p]
        for q in quads:
            cv2.polylines(vis, [q.astype(np.int32)], True,
                          REGION_COLORS[region], 2)
    if title_regions and "_lips_inner" in polys:
        cv2.polylines(vis, [polys["_lips_inner"].astype(np.int32)], True,
                      (255, 255, 255), 1)
    return cv2.cvtColor(vis, cv2.COLOR_BGR2RGB)


def r3(x):
    return None if x is None else round(float(x), 3)


def round_stats(stats):
    return {r: {k: (r3(v) if isinstance(v, float) else v)
                for k, v in d.items()} for r, d in stats.items()}


def round_clauses(clauses):
    out = {}
    for k, v in clauses.items():
        if isinstance(v, bool):
            out[k] = v
            continue
        if k == "C1":
            out[k] = {"pass": v["pass"], "value": r3(v["value"]),
                      "assignment": v.get("assignment"),
                      "threshold": v["threshold"], "margin": r3(v["margin"]),
                      "source": v["source"],
                      "regions": {rk: ({kk: (r3(vv) if kk in
                                             ("value", "margin") else vv)
                                        for kk, vv in rv.items()}
                                       if isinstance(rv, dict) else rv)
                                  for rk, rv in v["regions"].items()}}
        elif k == "C2":
            out[k] = {"pass": v["pass"],
                      "a_spread": {kk: (r3(vv) if kk in ("value", "margin")
                                        else vv) for kk, vv in
                                   v["a_spread"].items()},
                      "L_spread": {kk: (r3(vv) if kk in ("value", "margin")
                                        else vv) for kk, vv in
                                   v["L_spread"].items()}}
        elif k == "C3":
            out[k] = {"pass": v["pass"],
                      **{sk: {kk: (r3(vv) if kk in ("value", "margin") else vv)
                              for kk, vv in v[sk].items()}
                         for sk in ("a_diff", "b_diff", "L_ratio")}}
        elif k in ("C4", "C5"):
            out[k] = {kk: (r3(vv) if kk in ("value", "margin") else vv)
                      for kk, vv in v.items()}
        elif k == "C6":
            out[k] = {kk: (r3(vv) if kk in ("value", "target_value",
                                            "threshold", "margin") else vv)
                      for kk, vv in v.items()}
    return out


def clause_cells(clauses):
    """Compact per-clause cell strings for table.md / console."""
    c = clauses
    cells = {}
    regs = c["C1"]["regions"]
    swap = c["C1"].get("assignment") == "swapped"
    cheek_keys = ("cheek_side_a_vs_cheek_side_b",
                  "cheek_side_b_vs_cheek_side_a") if swap else \
        ("cheek_side_a_vs_cheek_side_a", "cheek_side_b_vs_cheek_side_b")
    shown = [("forehead", regs["forehead"])] + \
        [(k.replace("cheek_side_", "chk").replace("_vs_cheek_side_", ">"),
          regs[k]) for k in cheek_keys] + [("chin", regs["chin"])]
    cells["C1"] = ("PASS" if c["C1"]["pass"] else "FAIL") + \
        " maxdE=%.2f%s" % (c["C1"]["value"], "[swap]" if swap else "") + \
        " (%s)" % ("/".join("%s:%.1f%s" % (k, v["value"],
                                           "+" if v["pass"] else "-")
                            for k, v in shown))
    cells["C2"] = ("PASS" if c["C2"]["pass"] else "FAIL") + \
        " da=%.2f(db%.1f) dL=%.2f(db%.1f)" % (
            c["C2"]["a_spread"]["value"], c["C2"]["a_spread"]["threshold"],
            c["C2"]["L_spread"]["value"], c["C2"]["L_spread"]["threshold"])
    cells["C3"] = ("PASS" if c["C3"]["pass"] else "FAIL") + \
        " da=%.2f db=%.2f dr=%.3f" % (c["C3"]["a_diff"]["value"],
                                      c["C3"]["b_diff"]["value"],
                                      c["C3"]["L_ratio"]["value"])
    cells["C4"] = ("PASS" if c["C4"]["pass"] else "FAIL") + " d=%.2f" % \
        c["C4"]["value"]
    cells["C5"] = ("PASS" if c["C5"]["pass"] else "FAIL") + " d=%.2f" % \
        c["C5"]["value"]
    cells["C6"] = ("PASS" if c["C6"]["pass"] else "FAIL") + \
        " v=%.3f(tgt%.3f)" % (c["C6"]["value"], c["C6"]["target_value"])
    return cells


def main(argv=None):
    ap = argparse.ArgumentParser(description="Landmark-anchored face gate.")
    ap.add_argument("--target", required=True)
    ap.add_argument("--render", nargs="+", action="append", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    # Flatten: --render a b --render c -> [a, b, c]. (Without action="append"
    # argparse kept only the LAST --render group.)
    render_paths = [p for group in args.render for p in group]
    args.render = render_paths

    for mx in INDICES.values():
        vals = mx if isinstance(mx, list) else [mx]
        assert max(vals) < 478, "landmark index out of range"

    os.makedirs(args.out, exist_ok=True)
    for sub in ("aligned", "sbs", "regions"):
        os.makedirs(os.path.join(args.out, sub), exist_ok=True)

    landmarker = create_landmarker()
    try:
        target_rgb = load_rgb(args.target)
    except (FileNotFoundError, OSError):
        print("target unreadable; aborting", file=sys.stderr)
        return 2
    ht, wt = target_rgb.shape[:2]
    pts_t = detect_points(landmarker, Image.fromarray(target_rgb))
    if pts_t is None:
        print("target: " + DETECT_FAIL_NOTE, file=sys.stderr)
        return 2

    report = {"target": args.target,
              "indices": INDICES,
              "thresholds": THRESHOLDS,
              "region_construction": {
                  "forehead": "bottom=brow rows +22% toward 10 (clears brow "
                              "hair), top=same +55% toward 10; x-sorted",
                  "cheek_side_a/b": "quad: top=eyelow+28% to mouth, "
                                    "bot=mouth-18%, medial=nose+20% lateral, "
                                    "lateral=edge-30% inset",
                  "nose": "convex hull of bridge/base/nostril set",
                  "chin": "quad: top=lip+22% to chin, bot=chin-10%, "
                          "sides jaw-inset 18%",
                  "upperlip_skin": "quad: nose-base+15% to lip-top-4%, "
                                   "sides nostril-inset 25%",
                  "lips": "outer contour minus inner mouth contour",
                  "eyelid_a/b": "strip 30%-85% down brow-lower-row to "
                                "upper-lash-row, corners inset 12%",
                  "undereye": "two strips below lower lash, 5% of face height",
                  "erode": "3px (3x3 rect, 3 iterations); masks on UNWARPED "
                           "originals via inverse similarity of target-frame "
                           "polygons"},
              "renders": {}}

    # Target-vs-itself reference row (zero-delta check).
    self_cmp = compare_pair(landmarker, target_rgb, target_rgb)
    report["self"] = {"clauses": round_clauses(self_cmp["clauses"]),
                      "skinPass": self_cmp["clauses"]["skinPass"],
                      "lightingPass": self_cmp["clauses"]["lightingPass"]}

    # Regions overlay for the target itself.
    polys_t = region_polygons(pts_t)
    Image.fromarray(draw_regions_overlay(
        target_rgb, polys_t)).save(
            os.path.join(args.out, "regions", "target.png"))

    table_rows = []
    for rpath in args.render:
        name = os.path.splitext(os.path.basename(rpath))[0]
        try:
            render_rgb = load_rgb(rpath)
        except (FileNotFoundError, OSError):
            report["renders"][name] = {"src": rpath, "detected": False,
                                       "note": "unreadable or missing image; "
                                               "skipped"}
            print("%s: unreadable or missing image; skipped" % name)
            continue
        cmp = compare_pair(landmarker, target_rgb, render_rgb)
        if not cmp.get("render_detected", False):
            report["renders"][name] = {"src": rpath, "detected": False,
                                       "note": DETECT_FAIL_NOTE}
            print("%s: %s" % (name, DETECT_FAIL_NOTE))
            continue
        cl = cmp["clauses"]
        Image.fromarray(cmp["aligned"]).save(
            os.path.join(args.out, "aligned", name + ".png"))
        # Tight side-by-side at native target scale (no extra upscaling).
        x0, y0, x1, y1 = cmp["crop"]
        side = np.hstack([target_rgb[y0:y1, x0:x1],
                          cmp["aligned"][y0:y1, x0:x1]])
        Image.fromarray(side).save(os.path.join(args.out, "sbs",
                                                name + ".png"))
        # Regions overlay on the render original with back-mapped polygons.
        Image.fromarray(draw_regions_overlay(render_rgb,
                                             cmp["back"])).save(
            os.path.join(args.out, "regions", name + ".png"))
        entry = {"src": rpath, "detected": True,
                 "alignment": {k: (round(float(v), 4)
                                   if isinstance(v, float) else v)
                               for k, v in cmp["alignment"].items()},
                 "target_stats": round_stats(cmp["target_stats"]),
                 "render_stats": round_stats(cmp["render_stats"]),
                 "clauses": round_clauses(cl),
                 "skinPass": cl["skinPass"], "lightingPass": cl["lightingPass"]}
        report["renders"][name] = entry
        cells = clause_cells(cl)
        table_rows.append((name, cells, cl["skinPass"], cl["lightingPass"],
                           cmp["alignment"]))
        al = cmp["alignment"]
        print("%s: scale=%.3f%s rot=%.1f "
              "skin=%s light=%s | %s" % (
                  name, al["scale"],
                  " UPSCALED" if al["upscaled"] else "",
                  al["rotation_deg"],
                  "PASS" if cl["skinPass"] else "FAIL",
                  "PASS" if cl["lightingPass"] else "FAIL",
                  " | ".join("%s:%s" % (k, v)
                              for k, v in cells.items())))

    with open(os.path.join(args.out, "report.json"), "w") as f:
        json.dump(report, f, indent=2, sort_keys=True)
        f.write("\n")

    with open(os.path.join(args.out, "table.md"), "w") as f:
        f.write("| render | C1 | C2 | C3 | C4 | C5 | C6 (lighting) | "
                "skin | light |\n")
        f.write("|---|---|---|---|---|---|---|---|---|\n")
        for name, cells, skin, light, _al in table_rows:
            f.write("| %s | %s | %s | %s | %s | %s | %s | %s | %s |\n" % (
                name, cells["C1"], cells["C2"], cells["C3"], cells["C4"],
                cells["C5"], cells["C6"],
                "PASS" if skin else "FAIL", "PASS" if light else "FAIL"))
    print("wrote %s/report.json + table.md (%d/%d detected)" % (
        args.out, len(table_rows), len(args.render)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
