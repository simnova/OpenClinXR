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
import hashlib
import json
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(SCRIPT_DIR, "fixtures")
GATE_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "face-gate"))
REPORT_FILE = os.path.join(SCRIPT_DIR, "shape-report.json")
FRAME_FILE = os.path.join(SCRIPT_DIR, "tint-box-frame.json")

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


# --------------------------------------------------------------------------
# Subject mode: cut the fixture-rule crops from the SUBJECT's own render
# (landmarks detected on that render, never copied) and run the same
# measures against the shape-report.json thresholds (read here, not restated).
# --------------------------------------------------------------------------
def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_cutoff(clause):
    with open(REPORT_FILE) as f:
        report = json.load(f)
    for row in report["clauses"] if isinstance(report, dict) else report:
        if row.get("clause") == clause:
            return row["cutoff"]
    raise KeyError("clause %s not in %s" % (clause, REPORT_FILE))


def eye_crop_from_render(rgb, pts, contour):
    """Eye-A/B landmark box +30 px (sweep-lid.json fixture rule).

    contour = the 16-pt eye contour index set; box = floored landmark bbox
    expanded 30 px each side, clamped to the image. Verified byte-exact:
    contourA on S/project/edit-v9/named/view-0.png reproduces
    fixtures/lid-known-good.png, on S/polish/ref4-polish-front.png
    reproduces fixtures/lid-known-bad.png.
    """
    xs = pts[contour][:, 0]
    ys = pts[contour][:, 1]
    h, w = rgb.shape[:2]
    margin_px = 30  # sweep-lid.json: "eye-A landmark box +30 px"
    x0 = max(0, int(math.floor(float(xs.min()))) - margin_px)
    y0 = max(0, int(math.floor(float(ys.min()))) - margin_px)
    x1 = min(w, int(math.floor(float(xs.max()))) + margin_px)
    y1 = min(h, int(math.floor(float(ys.max()))) + margin_px)
    return (x0, y0, x1, y1), rgb[y0:y1, x0:x1]


def read_box_frame():
    with open(FRAME_FILE) as f:
        return json.load(f)


def cheek_box_from_landmarks(pts):
    """TINT box in the landmark frame (tint-box-frame.json: origin eye-A
    outer corner index 33, uniform scale |33-263|, axis-aligned).

    The recorded fixture box is expressed once as normalized (u, v) corners
    and mapped through landmarks detected on the given image, the same way
    LID cuts eye crops from the subject's own render. Exact on the fitting
    image by construction (float error ~1e-13, then round to pixels).
    Returns (box, anchors) with full-precision anchor coordinates so the
    box recomputes from the report without a model.
    """
    frame = read_box_frame()["uv"]
    ox, oy = float(pts[33][0]), float(pts[33][1])
    ex, ey = float(pts[263][0]), float(pts[263][1])
    s = math.hypot(ex - ox, ey - oy)
    box = (int(round(ox + frame["x0"] * s)),
           int(round(oy + frame["y0"] * s)),
           int(round(ox + frame["x1"] * s)),
           int(round(oy + frame["y1"] * s)))
    anchors = {"origin_idx": 33, "scale_idx": 263,
               "origin_xy": [ox, oy], "scale_pt_xy": [ex, ey], "scale": s,
               "frame_file": "tint-box-frame.json"}
    return box, anchors


def run_subject(subject, render_path, pre_path=None, model=None):
    if GATE_DIR not in sys.path:
        sys.path.insert(0, GATE_DIR)
    import face_gate as gate
    try:
        resolved_model = gate.resolve_model_path(model)
    except gate.ModelRefused as e:
        print(str(e), file=sys.stderr)
        return None
    try:
        rgb = load_rgb(render_path)
    except (FileNotFoundError, OSError):
        print("render unreadable: %s" % render_path, file=sys.stderr)
        return None
    landmarker = gate.create_landmarker(resolved_model)
    pts = gate.detect_points(landmarker, Image.fromarray(rgb))
    h, w = rgb.shape[:2]
    out = {"subject": subject,
           "render": {"path": render_path, "sha256": sha256_of(render_path),
                      "size": [w, h]},
           "model": {"path": resolved_model,
                     "sha256": gate.sha256_of(resolved_model)},
           "rule": {"lid": "eye-contour landmark box +30 px per eye, "
                           "landmarks detected on this render "
                           "(sweep-lid.json fixture rule)",
                    "tint": "recorded cheek box mapped through the "
                            "landmark frame (tint-box-frame.json, origin "
                            "index 33, scale |33-263|); box from the PRE "
                            "image landmarks (or the render's own when no "
                            "pre), same pixels on pre/post under one rig"}}
    if pts is None:
        out["detected"] = False
        out["note"] = gate.DETECT_FAIL_NOTE
        return out
    out["detected"] = True
    out["nose_tip_idx1_xy"] = [float(pts[1][0]), float(pts[1][1])]
    eye_boxes, lids = {}, {}
    for eye, contour in (
            ("A", [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157,
                   158, 159, 160, 161, 246]),
            ("B", [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388,
                   387, 386, 385, 384, 398])):
        box, crop = eye_crop_from_render(rgb, pts, contour)
        eye_boxes[eye] = list(box)
        m = lid_measure(crop)
        m["crop_sha256"] = hashlib.sha256(
            np.ascontiguousarray(crop).tobytes()).hexdigest()
        lids[eye] = m
    out["eye_boxes"] = eye_boxes
    cutoff = read_cutoff("LID")
    out["LID"] = {"eye": "A", "box": eye_boxes["A"],
                  "value": lids["A"]["value"], "cutoff": cutoff,
                  "pass": bool(lids["A"]["value"] <= cutoff),
                  "source": "shape-report.json LID cutoff (read, not "
                            "restated)"}
    out["LID_eyeB_observation"] = {"eye": "B", "box": eye_boxes["B"],
                                   "value": lids["B"]["value"],
                                   "cutoff": cutoff,
                                   "pass": bool(lids["B"]["value"] <= cutoff)}
    if pre_path is not None:
        try:
            pre_rgb = load_rgb(pre_path)
        except (FileNotFoundError, OSError):
            print("pre unreadable: %s" % pre_path, file=sys.stderr)
            return None
        out["pre"] = {"path": pre_path, "sha256": sha256_of(pre_path),
                      "size": [int(pre_rgb.shape[1]), int(pre_rgb.shape[0])]}
        if pre_rgb.shape != rgb.shape:
            out["TINT"] = {"error": "pre/post shapes differ: %s vs %s" %
                            (list(pre_rgb.shape), list(rgb.shape))}
        else:
            pre_pts = gate.detect_points(landmarker,
                                         Image.fromarray(pre_rgb))
            if pre_pts is None:
                out["TINT"] = {"error": "no face in pre: %s" % pre_path}
            else:
                out["pre_nose_tip_idx1_xy"] = [float(pre_pts[1][0]),
                                               float(pre_pts[1][1])]
                (x0, y0, x1, y1), anchors = cheek_box_from_landmarks(
                    pre_pts)
                x0, y0 = max(0, x0), max(0, y0)
                x1, y1 = min(w, x1), min(h, y1)
                out["cheek_box"] = [x0, y0, x1, y1]
                out["cheek_box_anchors"] = anchors
                m = tint_measure(pre_rgb[y0:y1, x0:x1], rgb[y0:y1, x0:x1])
                tcut = read_cutoff("TINT")
                out["TINT"] = {"box": [x0, y0, x1, y1],
                               "box_from": "pre landmarks",
                               "anchors": anchors,
                               "value": m["value"],
                               "kept_px": m["kept_px"],
                               "kept_regions": m["kept_regions"],
                               "cutoff": tcut,
                               "pass": bool(m["value"] <= tcut),
                               "source": "shape-report.json TINT cutoff "
                                         "(read, not restated)"}
    else:
        (x0, y0, x1, y1), anchors = cheek_box_from_landmarks(pts)
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(w, x1), min(h, y1)
        out["tint_box_no_pre"] = {"box": [x0, y0, x1, y1],
                                  "box_from": "render landmarks (no pre)",
                                  "anchors": anchors}
        out["TINT"] = None
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Face-shape region clauses.")
    ap.add_argument("--verify", action="store_true",
                    help="recompute every clause on fixtures, print JSON")
    ap.add_argument("--subject", default=None,
                    help="case id the render belongs to (subject mode)")
    ap.add_argument("--render", default=None,
                    help="subject render png (subject mode post image)")
    ap.add_argument("--pre", default=None,
                    help="subject pre image for TINT (same rig as --render)")
    ap.add_argument("--out", default=None,
                    help="write subject-mode JSON report here")
    ap.add_argument("--model", default=None,
                    help="landmark model file; must match the face-gate "
                    "pinned sha256 or the run refuses.")
    args = ap.parse_args(argv)
    if args.verify:
        print(json.dumps(verify(), indent=2, sort_keys=True))
        return 0
    if args.subject is not None or args.render is not None:
        if args.subject is None or args.render is None or args.out is None:
            print("subject mode needs --subject, --render and --out",
                  file=sys.stderr)
            return 2
        out = run_subject(args.subject, args.render, args.pre, args.model)
        if out is None:
            return 2
        if not out.get("detected", False):
            with open(args.out, "w") as f:
                json.dump(out, f, indent=2, sort_keys=True)
                f.write("\n")
            print("%s: %s" % (args.subject,
                              out.get("note", "no face detected")),
                  file=sys.stderr)
            return 2
        with open(args.out, "w") as f:
            json.dump(out, f, indent=2, sort_keys=True)
            f.write("\n")
        lid = out["LID"]
        tint = out["TINT"]
        print("%s: LID=%.6f%s TINT=%s boxA=%s boxB=%s" % (
            args.subject, lid["value"],
            " PASS" if lid["pass"] else " FAIL",
            ("%.6f%s" % (tint["value"],
                         " PASS" if tint["pass"] else " FAIL"))
            if isinstance(tint, dict) and "value" in tint else tint,
            lid["box"], out["LID_eyeB_observation"]["box"]))
        return 0
    ap.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
