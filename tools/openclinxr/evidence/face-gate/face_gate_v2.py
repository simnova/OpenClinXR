#!/usr/bin/env python3
"""Face gate v2: v1 C1-C6 (imported unchanged) plus G8/G9/G10/G11/G12.

C1-C6 are imported from face_gate.py and never redefined here.
New clauses (brief k2-gate-v2): each prints value, threshold, pass/fail and
where the threshold comes from. Thresholds are DERIVED at runtime from the
target + noise-floor pair (--targetflat); only brief-given constants are
stated literally, each cited as "brief".

  G8  LIP SPLIT: upper/lower lip split by the inner-mouth landmark line
      (segment 78->308). dL = L_upper - L_lower + per-lip L std.
      thr_dL = max(4, 1.5*|dL_target - dL_flat|) [brief formula];
      thr_std = 1.5 * target std [brief formula].
  G9  APERTURE: 5px band on the inner-mouth line in the UNWARPED render at
      its own scale. FAIL if any horizontal run >= 3px has
      L > meanL(lower lip)+25 AND chroma < 8 [brief constants].
  G10 EYES: per eye iris disk (iris landmarks) + sclera mask (eye contour
      minus iris disk, eroded 1px). Sclera mean a*/b*; catch-light =
      connected blob >= 3px with L > 85 in the iris disk [brief constants].
      thr = target a* + max(3, 1.5*|a*_t - a*_f|) [brief formula];
      catch-light required only when the target has one [brief].
  G11 STRUCTURE (provisional): optional --ref (image-model edit of the SAME
      render). Correlation of low-band gradient magnitude (DoG sigma 4-16
      at 1024 scale) inside (a) eye box (b) face hull minus mouth.
      Provisional threshold = midpoint of known-good (ref vs sigma-1 blur
      of itself) and known-bad (p0-shipped-front vs view-0), all computed
      at runtime from the actual files, never typed.
  G12 VIEWS: --view-yaw <deg>. Regions come from THAT view's landmarks.
      At 40 deg the render is mirror-checked against the target with the
      nose-tip landmark (mirror ONE, reported); only the visible-side
      cheek feeds C1; C2/C6 need both cheeks -> "not visible", skipped.

Overall v2 verdict per view: skinPass (C1-C5 + G8), mouthPass (G9),
eyePass (G10), structure (G11, provisional), lighting (C6; n/a at yaw).

G7 (lip placement vs the mesh's own lip vertices) is NOT implemented here:
see RESULT-v2.md for what it would need.
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
S_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, ".."))
sys.path.insert(0, SCRIPT_DIR)
import face_gate as v1

EYE_CONTOUR_A = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158,
                 159, 160, 161, 246]
EYE_CONTOUR_B = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387,
                 386, 385, 384, 398]
BROW_ALL = [70, 63, 105, 66, 107, 336, 296, 334, 293, 300]
LASH_LOW = [145, 144, 153, 154, 374, 373, 390, 249]
EYE_CORNERS = [33, 133, 362, 263]

CAL_P0 = os.path.join(S_DIR, "variants-product", "p0-shipped-front.png")
CAL_REF0 = os.path.join(S_DIR, "project", "edit-v9", "named", "view-0.png")


# --------------------------------------------------------------------------
# Detection: median of 3 (mask-coverage jitter guard) + residual report.
# --------------------------------------------------------------------------
def detect_median(landmarker, pil_img, runs=3):
    pts = []
    for _ in range(runs):
        q = v1.detect_points(landmarker, pil_img)
        if q is not None:
            pts.append(q)
    if not pts:
        return None, {"runs_ok": 0, "jitter_px": None}
    med = np.median(np.stack(pts), axis=0)
    jit = 0.0
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            d = np.sqrt(((pts[i] - pts[j]) ** 2).sum(axis=1)).mean()
            jit = max(jit, float(d))
    return med, {"runs_ok": len(pts), "jitter_px": round(jit, 4)}


# --------------------------------------------------------------------------
# Shared per-face measurements (unwarped image, own landmarks, own scale).
# --------------------------------------------------------------------------
def lab_of(rgb):
    lab = v1.rgb_to_lab(rgb)
    L, A, B = lab[:, :, 0], lab[:, :, 1], lab[:, :, 2]
    return lab, L, A, B, np.sqrt(A ** 2 + B ** 2)


def lip_split(lab_L, q, w, h, erode_iter=3):
    """Upper/lower lip masks split by the inner-mouth line (78->308)."""
    outer = np.array([q[i] for i in v1.INDICES["lips_outer"]])
    inner = np.array([q[i] for i in v1.INDICES["lips_inner"]])
    lipm = np.zeros((h, w), np.uint8)
    cv2.fillPoly(lipm, [outer.astype(np.int32)], 1)
    hole = np.zeros((h, w), np.uint8)
    cv2.fillPoly(hole, [inner.astype(np.int32)], 1)
    lipm = lipm * (1 - hole)
    x0, y0 = float(q[78][0]), float(q[78][1])
    x1, y1 = float(q[308][0]), float(q[308][1])
    if x0 > x1:
        x0, y0, x1, y1 = x1, y1, x0, y0
    xs = np.arange(int(round(x0)), int(round(x1)) + 1)
    ys = y0 + (y1 - y0) * (xs - x0) / max(x1 - x0, 1e-9)
    line_y = np.full(w, np.nan)
    line_y[np.clip(xs, 0, w - 1)] = ys
    yy, xx = np.mgrid[0:h, 0:w]
    above = yy < line_y[xx]
    kern = np.ones((3, 3), np.uint8)
    up = cv2.erode(np.logical_and(lipm > 0, above).astype(np.uint8),
                   kern, iterations=erode_iter)
    lo = cv2.erode(np.logical_and(lipm > 0, np.logical_not(above))
                   .astype(np.uint8), kern, iterations=erode_iter)
    Lu = lab_L[up > 0]
    Ll = lab_L[lo > 0]
    return {"LUp": float(Lu.mean()), "sdUp": float(Lu.std()),
            "nUp": int((up > 0).sum()),
            "LLo": float(Ll.mean()), "sdLo": float(Ll.std()),
            "nLo": int((lo > 0).sum()),
            "dL": float(Lu.mean() - Ll.mean()),
            "seg": (x0, y0, x1, y1)}


def aperture_scan(lab_L, chroma, q, w, h, LLo):
    """5px band on the inner-mouth line; near-white horizontal runs."""
    x0, y0, x1, y1 = lip_split_segment(q)
    xs = np.arange(int(round(x0)), int(round(x1)) + 1)
    ys = (y0 + (y1 - y0) * (xs - x0) / max(x1 - x0, 1e-9)).round().astype(int)
    bandL = np.zeros((5, len(xs)))
    bandC = np.zeros((5, len(xs)))
    for j, dy in enumerate([-2, -1, 0, 1, 2]):
        yy = np.clip(ys + dy, 0, h - 1)
        xx = np.clip(xs, 0, w - 1)
        bandL[j] = lab_L[yy, xx]
        bandC[j] = chroma[yy, xx]
    thr = LLo + 25.0  # brief constant
    bad = np.logical_and(bandL > thr, bandC < 8.0)  # brief constants
    maxrun = 0
    for j in range(5):
        run = 0
        for vv in list(bad[j]):
            run = run + 1 if bool(vv) else 0
            maxrun = max(maxrun, run)
    return {"thr": float(thr), "maxrun": int(maxrun),
            "peakL": float(bandL[bad].max()) if bad.any() else 0.0,
            "nbad": int(bad.sum()),
            "pass": bool(maxrun < 3)}


def lip_split_segment(q):
    x0, y0 = float(q[78][0]), float(q[78][1])
    x1, y1 = float(q[308][0]), float(q[308][1])
    if x0 > x1:
        x0, y0, x1, y1 = x1, y1, x0, y0
    return x0, y0, x1, y1


def eye_measure(lab_L, lab_A, lab_B, q, w, h):
    """Per-eye iris disk + sclera mask (contour minus disk, eroded 1px)."""
    out = {}
    for contour, nm, iris in (
            (EYE_CONTOUR_A, "A", v1.INDICES["iris_a"]),
            (EYE_CONTOUR_B, "B", v1.INDICES["iris_b"])):
        poly = np.array([q[i] for i in contour])
        em = np.zeros((h, w), np.uint8)
        cv2.fillPoly(em, [poly.astype(np.int32)], 1)
        ip = np.array([q[i] for i in iris])
        c = ip.mean(axis=0)
        d = ip[:4] - c
        r = float(np.sqrt((d ** 2).sum(axis=1)).mean())
        cv2.circle(em, (int(c[0]), int(c[1])), int(round(r)), 0, -1)
        em = cv2.erode(em, np.ones((3, 3), np.uint8), iterations=1)
        nsc = int((em > 0).sum())
        dm = np.zeros((h, w), np.uint8)
        cv2.circle(dm, (int(c[0]), int(c[1])), int(round(r)), 1, -1)
        hot = np.logical_and(dm > 0, lab_L > 85.0)  # brief constants
        nlab, lbl = cv2.connectedComponents(hot.astype(np.uint8))
        blobs = []
        for i in range(1, nlab):
            s = int((lbl == i).sum())
            if s >= 3:  # brief constant
                blobs.append(s)
        out[nm] = {"sclA": float(lab_A[em > 0].mean()) if nsc else None,
                   "sclB": float(lab_B[em > 0].mean()) if nsc else None,
                   "nsc": nsc, "iris_r": round(r, 2),
                   "catch": bool(blobs),
                   "catch_blobs": sorted(blobs, reverse=True)[:4]}
    return out


# --------------------------------------------------------------------------
# G8 / G9 / G10 verdicts (thresholds derived from target + flat at runtime).
# --------------------------------------------------------------------------
def g8_verdict(split_r, split_t, split_f):
    thr_dL = max(4.0, 1.5 * abs(split_t["dL"] - split_f["dL"]))
    thr_up = 1.5 * split_t["sdUp"]
    thr_lo = 1.5 * split_t["sdLo"]
    d_dL = abs(split_r["dL"] - split_t["dL"])
    p_dL = bool(d_dL <= thr_dL)
    p_up = bool(split_r["sdUp"] <= thr_up)
    p_lo = bool(split_r["sdLo"] <= thr_lo)
    return {
        "dL_render": r3(split_r["dL"]), "dL_target": r3(split_t["dL"]),
        "dL_flat": r3(split_f["dL"]),
        "dL_diff": r3(d_dL), "dL_thr": r3(thr_dL), "dL_pass": p_dL,
        "dL_source": ("brief formula max(4, 1.5*|dL_t-dL_f|); noise "
                      "1.5*|%.3f| = %.3f, max floor 4 applies"
                      % (abs(split_t["dL"] - split_f["dL"]),
                         1.5 * abs(split_t["dL"] - split_f["dL"]))),
        "sdUp_render": r3(split_r["sdUp"]), "sdUp_thr": r3(thr_up),
        "sdUp_pass": p_up,
        "sdLo_render": r3(split_r["sdLo"]), "sdLo_thr": r3(thr_lo),
        "sdLo_pass": p_lo,
        "std_source": ("brief formula 1.5x target std "
                       "(up %.3f, lo %.3f)"
                       % (split_t["sdUp"], split_t["sdLo"])),
        "pass": bool(p_dL and p_up and p_lo)}


def g10_verdict(eyes_r, eyes_t, eyes_f):
    sclA_r = (eyes_r["A"]["sclA"] + eyes_r["B"]["sclA"]) / 2.0
    sclA_t = (eyes_t["A"]["sclA"] + eyes_t["B"]["sclA"]) / 2.0
    sclA_f = (eyes_f["A"]["sclA"] + eyes_f["B"]["sclA"]) / 2.0
    tol = max(3.0, 1.5 * abs(sclA_t - sclA_f))
    thr = sclA_t + tol
    p_scl = bool(sclA_r <= thr)
    ct_t = {e: bool(eyes_t[e]["catch"]) for e in ("A", "B")}
    ct_r = {e: bool(eyes_r[e]["catch"]) for e in ("A", "B")}
    required = [e for e in ("A", "B") if ct_t[e]]
    p_catch = all(ct_r[e] for e in required) if required else True
    return {
        "sclA_render": r3(sclA_r), "sclA_target": r3(sclA_t),
        "sclA_flat": r3(sclA_f), "sclA_thr": r3(thr),
        "sclA_pass": p_scl,
        "sclA_source": ("brief formula target + max(3, 1.5*|a*_t-a*_f|); "
                        "noise 1.5*|%.3f| = %.3f, floor 3 applies"
                        % (abs(sclA_t - sclA_f),
                           1.5 * abs(sclA_t - sclA_f))),
        "sclB_render": r3((eyes_r["A"]["sclB"] + eyes_r["B"]["sclB"]) / 2.0),
        "sclB_target": r3((eyes_t["A"]["sclB"] + eyes_t["B"]["sclB"]) / 2.0),
        "per_eye": {e: {"render_a": r3(eyes_r[e]["sclA"]),
                        "target_a": r3(eyes_t[e]["sclA"]),
                        "render_catch": ct_r[e], "target_catch": ct_t[e],
                        "render_blobs": eyes_r[e]["catch_blobs"]}
                    for e in ("A", "B")},
        "catch_required_eyes": required,
        "catch_pass": bool(p_catch),
        "catch_source": ("brief: catch-light (blob >= 3px, L > 85) required "
                         "only when the target has one; target has %s"
                         % ("none -> vacuous" if not required
                            else ",".join(required))),
        "pass": bool(p_scl and p_catch)}


# --------------------------------------------------------------------------
# G11: DoG gradient-magnitude correlation vs photographic ref (provisional).
# --------------------------------------------------------------------------
def dog_grad_mag(L):
    from scipy.ndimage import gaussian_filter
    g4 = gaussian_filter(L.astype(float), 4)
    g16 = gaussian_filter(L.astype(float), 16)
    gy, gx = np.gradient(g4 - g16)
    return np.sqrt(gx ** 2 + gy ** 2)


def eye_box(q, w, h):
    brow = [q[i] for i in BROW_ALL]
    top = min(p[1] for p in brow)
    fh = abs(q[152][1] - q[10][1])
    bot = max(q[i][1] for i in LASH_LOW) + 0.08 * fh
    xs = [q[i][0] for i in EYE_CORNERS] + [p[0] for p in brow]
    return (int(max(0, min(xs) - 10)), int(max(0, top - 10)),
            int(min(w, max(xs) + 10)), int(min(h, bot + 10)))


def face_region_mask(q, w, h):
    hull = cv2.convexHull(q[:468].astype(np.float32)).reshape(-1, 2)
    m = np.zeros((h, w), np.uint8)
    cv2.fillConvexPoly(m, hull.astype(np.int32), 1)
    hole = np.zeros((h, w), np.uint8)
    cv2.fillPoly(hole, [np.array(
        [q[i] for i in v1.INDICES["lips_inner"]]).astype(np.int32)], 1)
    return m * (1 - hole)


def _corr(a, b, mask):
    x = a[mask > 0].ravel().astype(float)
    y = b[mask > 0].ravel().astype(float)
    return float(np.corrcoef(x, y)[0, 1])


_cal_cache = {}


def g11_compare(ref_rgb, render_rgb, ref_pts, calib_desc="front pair"):
    H, W = ref_rgb.shape[:2]
    if render_rgb.shape[1] != W or render_rgb.shape[0] != H:
        render_rgb = np.asarray(
            Image.fromarray(render_rgb).resize((W, H), Image.LANCZOS))
    _, Lref, _, _, _ = lab_of(ref_rgb)
    _, Lren, _, _, _ = lab_of(render_rgb)
    Gref, Gren = dog_grad_mag(Lref), dog_grad_mag(Lren)
    x0, y0, x1, y1 = eye_box(ref_pts, W, H)
    me = np.zeros((H, W), np.uint8)
    me[y0:y1, x0:x1] = 1
    mf = face_region_mask(ref_pts, W, H)
    c_eye, c_face = _corr(Gref, Gren, me), _corr(Gref, Gren, mf)
    # known-good: ref vs sigma-1-blurred copy of itself (runtime-derived).
    from scipy.ndimage import gaussian_filter
    blur = np.clip(gaussian_filter(ref_rgb.astype(float), (1, 1, 0)),
                   0, 255).astype(np.uint8)
    _, Lb, _, _, _ = lab_of(blur)
    Gb = dog_grad_mag(Lb)
    g_eye, g_face = _corr(Gref, Gb, me), _corr(Gref, Gb, mf)
    # known-bad: fixed calibration pair p0-shipped-front vs view-0.
    key = "bad"
    if key not in _cal_cache:
        b0 = v1.load_rgb(CAL_P0)
        r0 = v1.load_rgb(CAL_REF0)
        if b0.shape[1] != r0.shape[1] or b0.shape[0] != r0.shape[0]:
            b0 = np.asarray(Image.fromarray(b0).resize(
                (r0.shape[1], r0.shape[0]), Image.LANCZOS))
        lm0 = v1.create_landmarker()
        q0, _ = detect_median(
            lm0, Image.fromarray(r0))
        _, L0, _, _, _ = lab_of(r0)
        _, Lp, _, _, _ = lab_of(b0)
        G0, Gp = dog_grad_mag(L0), dog_grad_mag(Lp)
        H0, W0 = r0.shape[:2]
        a0, b0b, c0, d0 = eye_box(q0, W0, H0)
        mb = np.zeros((H0, W0), np.uint8)
        mb[b0b:d0, a0:c0] = 1
        mfb = face_region_mask(q0, W0, H0)
        _cal_cache[key] = (_corr(G0, Gp, mb), _corr(G0, Gp, mfb))
        try:
            lm0.__exit__(None, None, None)
        except Exception:
            pass
    b_eye, b_face = _cal_cache[key]
    t_eye, t_face = (g_eye + b_eye) / 2.0, (g_face + b_face) / 2.0
    return {
        "corr_eye": r3(c_eye), "corr_face": r3(c_face),
        "good_eye": r3(g_eye), "good_face": r3(g_face),
        "bad_eye": r3(b_eye), "bad_face": r3(b_face),
        "thr_eye": r3(t_eye), "thr_face": r3(t_face),
        "pass_eye": bool(c_eye >= t_eye), "pass_face": bool(c_face >= t_face),
        "pass": bool(c_eye >= t_eye and c_face >= t_face),
        "provisional": True,
        "source": ("provisional midpoint of runtime-derived known-good "
                   "(ref vs sigma-1 blur solves to ~1) and known-bad "
                   "(%s: p0-shipped-front vs view-0); bad pair fixed by "
                   "brief, values computed here" % calib_desc)}


# --------------------------------------------------------------------------
# Yaw (G12): nose-tip mirror check + visible-cheek verdict adaptation.
# --------------------------------------------------------------------------
def nose_sign(q):
    cx = float(q[:, 0].mean())
    return float(q[4][0] - cx)


def cheek_widths(q):
    wa = abs(float(q[234][0]) - float(q[129][0]))
    wb = abs(float(q[454][0]) - float(q[358][0]))
    return wa, wb


def r3(x):
    return None if x is None else round(float(x), 3)


def v2_cells(clauses, g8, g9, g10, g11, yaw_info):
    c = clauses
    cells = dict(v1.clause_cells(c))
    cells["G8"] = (("PASS" if g8["pass"] else "FAIL") +
                   " ddL=%.2f(thr%.2f) sdu=%.2f(%.1f) sdl=%.2f(%.1f)" % (
                       g8["dL_diff"], g8["dL_thr"], g8["sdUp_render"],
                       g8["sdUp_thr"], g8["sdLo_render"], g8["sdLo_thr"]))
    cells["G9"] = (("PASS" if g9["pass"] else "FAIL") +
                   " run=%d peakL=%.1f(thr%.1f) nbad=%d" % (
                       g9["maxrun"], g9["peakL"], g9["thr"], g9["nbad"]))
    cells["G10"] = (("PASS" if g10["pass"] else "FAIL") +
                    " a*=%.2f(thr%.2f) catch=%s" % (
                        g10["sclA_render"], g10["sclA_thr"],
                        ("req:" + ",".join(g10["catch_required_eyes"])
                         + ("ok" if g10["catch_pass"] else "MISSING"))
                        if g10["catch_required_eyes"] else "n/a"))
    if g11 is None:
        cells["G11"] = "no-ref"
    else:
        cells["G11"] = (("PASS" if g11["pass"] else "FAIL") +
                        " eye=%.3f(thr%.3f) face=%.3f(thr%.3f) PROV" % (
                            g11["corr_eye"], g11["thr_eye"],
                            g11["corr_face"], g11["thr_face"]))
    if yaw_info:
        cells["C1"] += " yaw[%s-only]" % yaw_info["visible"]
        for k in ("C2", "C6"):
            cells[k] = "not-visible(skipped)"
    return cells


def main(argv=None):
    ap = argparse.ArgumentParser(description="Face gate v2 (C1-C6 + G8-G12).")
    ap.add_argument("--target", required=True)
    ap.add_argument("--targetflat", default=os.path.join(
        S_DIR, "target-views", "target-flat-front.png"))
    ap.add_argument("--render", nargs="+", action="append", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--view-yaw", type=float, default=0.0)
    ap.add_argument("--ref", default=None)
    ap.add_argument("--ref-stems", nargs="*", default=None)
    ap.add_argument("--model", default=None,
                    help="landmark model file; must match the pinned sha256 "
                    "(landmark-model.json) or the run refuses.")
    args = ap.parse_args(argv)
    render_paths = [p for group in args.render for p in group]

    os.makedirs(args.out, exist_ok=True)
    try:
        resolved_model = v1.resolve_model_path(args.model)
    except v1.ModelRefused as e:
        print(str(e), file=sys.stderr)
        return 2
    landmarker = v1.create_landmarker(resolved_model)
    try:
        target_rgb = v1.load_rgb(args.target)
        flat_rgb = v1.load_rgb(args.targetflat)
    except (FileNotFoundError, OSError):
        print("target/targetflat unreadable; aborting", file=sys.stderr)
        return 2
    ref_rgb = None
    if args.ref:
        try:
            ref_rgb = v1.load_rgb(args.ref)
        except (FileNotFoundError, OSError):
            print("ref unreadable; continuing without ref", file=sys.stderr)
            ref_rgb = None
    Ht, Wt = target_rgb.shape[:2]

    pts_t, jit_t = detect_median(landmarker,
                                 Image.fromarray(target_rgb))
    if pts_t is None:
        print("target: " + v1.DETECT_FAIL_NOTE, file=sys.stderr)
        return 2
    pts_f, jit_f = detect_median(landmarker, Image.fromarray(flat_rgb))
    if pts_f is None:
        print("targetflat: " + v1.DETECT_FAIL_NOTE, file=sys.stderr)
        return 2
    _, Lt, At, Bt, cht = lab_of(target_rgb)
    split_t = lip_split(Lt, pts_t, Wt, Ht)
    split_f = None
    Hf, Wf = flat_rgb.shape[:2]
    _, Lf, Af, Bf, chf = lab_of(flat_rgb)
    split_f = lip_split(Lf, pts_f, Wf, Hf)
    eyes_t = eye_measure(Lt, At, Bt, pts_t, Wt, Ht)
    eyes_f = eye_measure(Lf, Af, Bf, pts_f, Wf, Hf)

    pts_ref = None
    if ref_rgb is not None:
        pts_ref, jit_ref = detect_median(landmarker,
                                         Image.fromarray(ref_rgb))
        if pts_ref is None:
            print("ref: " + v1.DETECT_FAIL_NOTE + "; continuing without ref",
                  file=sys.stderr)
            ref_rgb = None

    yaw = abs(args.view_yaw) >= 20.0
    yaw_info_global = None
    if yaw:
        wa_t, wb_t = cheek_widths(pts_t)
        vis = "a" if wa_t >= wb_t else "b"
        yaw_info_global = {"visible": vis, "wa": round(wa_t, 1),
                           "wb": round(wb_t, 1),
                           "asym": round(min(wa_t, wb_t) / max(wa_t, wb_t), 3)}

    report = {"target": args.target, "targetflat": args.targetflat,
              "view_yaw": args.view_yaw, "ref": args.ref,
              "model": {"path": resolved_model,
                        "sha256": v1.sha256_of(resolved_model)},
              "clauses_C1_C6": "imported unchanged from face_gate.py",
              "renders": {}}
    table_rows = []
    for rpath in render_paths:
        name = os.path.splitext(os.path.basename(rpath))[0]
        try:
            render_rgb = v1.load_rgb(rpath)
        except (FileNotFoundError, OSError):
            report["renders"][name] = {"src": rpath, "detected": False,
                                       "note": "unreadable; skipped"}
            print("%s: unreadable or missing image; skipped" % name)
            continue
        Hr, Wr = render_rgb.shape[:2]
        pts_r, jit_r = detect_median(landmarker, Image.fromarray(render_rgb))
        if pts_r is None:
            report["renders"][name] = {"src": rpath, "detected": False,
                                       "note": v1.DETECT_FAIL_NOTE}
            print("%s: %s" % (name, v1.DETECT_FAIL_NOTE))
            continue
        # G8/G9/G10 use the render's OWN unwarped pixels + own landmarks.
        _, Lr, Ar, Br, chr_r = lab_of(render_rgb)
        split_r = lip_split(Lr, pts_r, Wr, Hr)
        ap_r = aperture_scan(Lr, chr_r, pts_r, Wr, Hr, split_r["LLo"])
        eyes_r = eye_measure(Lr, Ar, Br, pts_r, Wr, Hr)

        yaw_info = None
        cmp_rgb = render_rgb
        cmp_pts_note = "none"
        if yaw:
            s_t, s_r = nose_sign(pts_t), nose_sign(pts_r)
            if (s_t >= 0) != (s_r >= 0):
                cmp_rgb = np.asarray(
                    Image.fromarray(render_rgb).transpose(
                        Image.FLIP_LEFT_RIGHT))
                cmp_pts_note = ("mirrored the RENDER (nose-tip x-cx: target "
                                "%+.0f, render %+.0f, opposite sides)"
                                % (s_t, s_r))
                pts_m, _ = detect_median(landmarker,
                                         Image.fromarray(cmp_rgb))
                s_r2 = nose_sign(pts_m) if pts_m is not None else float("nan")
                cmp_pts_note += ("; after mirror render %+.0f, same side: %s"
                                 % (s_r2, (s_t >= 0) == (s_r2 >= 0)))
            else:
                cmp_pts_note = ("no mirror (nose-tip x-cx target %+.0f, "
                                "render %+.0f, same side)" % (s_t, s_r))
            yaw_info = dict(yaw_info_global)

        # C1-C6 (imported, unchanged) on target frame vs (maybe mirrored)
        # render.
        cmp = v1.compare_pair(landmarker, target_rgb, cmp_rgb)
        if not cmp.get("render_detected", False):
            report["renders"][name] = {"src": rpath, "detected": False,
                                       "note": v1.DETECT_FAIL_NOTE}
            print("%s: %s" % (name, v1.DETECT_FAIL_NOTE))
            continue
        cl = cmp["clauses"]
        g8 = g8_verdict(split_r, split_t, split_f)
        g9 = {"thr": r3(ap_r["thr"]), "maxrun": ap_r["maxrun"],
              "peakL": r3(ap_r["peakL"]), "nbad": ap_r["nbad"],
              "pass": ap_r["pass"],
              "source": ("brief: band 5px on inner-mouth line, fail on "
                         "run >= 3px with L > lower-lip mean + 25 and "
                         "chroma < 8")}
        g10 = g10_verdict(eyes_r, eyes_t, eyes_f)
        use_ref = (ref_rgb is not None and pts_ref is not None and
                   (args.ref_stems is None or name in args.ref_stems))
        g11 = (g11_compare(ref_rgb, render_rgb, pts_ref,
                           "front pair" if not yaw else "front pair reused "
                           "for yaw row (bad pair is frontal)")
               if use_ref else None)

        if yaw:
            regs = cl["C1"]["regions"]
            vis = yaw_info["visible"]
            key = ("cheek_side_%s_vs_cheek_side_%s" % (vis, vis))
            c1yaw = bool(regs["forehead"]["pass"] and regs["chin"]["pass"]
                         and regs[key]["pass"])
            skin = bool(c1yaw and cl["C3"]["pass"] and cl["C4"]["pass"]
                        and cl["C5"]["pass"] and g8["pass"])
            light = None
        else:
            skin = bool(cl["skinPass"] and g8["pass"])
            light = bool(cl["lightingPass"])
        mouth = bool(g9["pass"])
        eye = bool(g10["pass"])
        cells = v2_cells(cl, g8, g9, g10, g11, yaw_info)
        entry = {"src": rpath, "detected": True,
                 "mirror_note": cmp_pts_note,
                 "yaw": yaw_info,
                 "jitter_px": {"target": jit_t["jitter_px"],
                               "flat": jit_f["jitter_px"],
                               "render": jit_r["jitter_px"]},
                 "alignment": {k: (round(float(vv), 4)
                                   if isinstance(vv, float) else vv)
                               for k, vv in cmp["alignment"].items()},
                 "clauses_C1_C6": v1.round_clauses(cl),
                 "G8": g8, "G9": g9, "G10": g10,
                 "G11": g11,
                 "skinPass": skin, "mouthPass": mouth, "eyePass": eye,
                 "lightingPass": light,
                 "structureProvisional": (g11["pass"] if g11 else None)}
        report["renders"][name] = entry
        table_rows.append((name, cells, skin, mouth, eye, light, g11))
        g11s = ("G11:%s" % cells["G11"]) if g11 else "G11:no-ref"
        print(("%s: skin=%s mouth=%s eye=%s light=%s | "
               "G8:%s | G9:%s | G10:%s | %s%s" % (
                   name, "PASS" if skin else "FAIL",
                   "PASS" if mouth else "FAIL", "PASS" if eye else "FAIL",
                   ("PASS" if light else "FAIL") if light is not None
                   else "n/a(yaw)",
                   cells["G8"], cells["G9"], cells["G10"], g11s,
                   (" | " + cmp_pts_note) if yaw else "")))

    with open(os.path.join(args.out, "report.json"), "w") as f:
        json.dump(report, f, indent=2, sort_keys=True)
        f.write("\n")
    with open(os.path.join(args.out, "table.md"), "w") as f:
        f.write("| render | C1 | C2 | C3 | C4 | C5 | C6 | G8 | G9 | G10 | "
                "G11 | skin | mouth | eye | light |\n")
        f.write("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n")
        for name, cells, skin, mouth, eye, light, _g in table_rows:
            f.write("| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | "
                    "%s | %s | %s | %s | %s |\n" % (
                        name, cells["C1"], cells["C2"], cells["C3"],
                        cells["C4"], cells["C5"], cells["C6"], cells["G8"],
                        cells["G9"], cells["G10"], cells["G11"],
                        "PASS" if skin else "FAIL",
                        "PASS" if mouth else "FAIL",
                        "PASS" if eye else "FAIL",
                        ("PASS" if light else "FAIL")
                        if light is not None else "n/a"))
    print("wrote %s/report.json + table.md (%d/%d detected)" % (
        args.out, len(table_rows), len(render_paths)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
