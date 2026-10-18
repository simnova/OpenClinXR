#!/usr/bin/env python3
"""One-brow measurement (card tsk_6f4a446db8bf5164).

Measures the eyebrow that a rendered portrait actually shows, and the eyebrow
in the subject's goal photo, from FACE LANDMARKS ONLY (the pinned face-gate
landmark model, tools/openclinxr/evidence/face-gate/landmark-model.json), so
the render's framing (1280, product rig) and the goal photo's framing (1024,
flat) never enter a number.

Detection is imported verbatim from ../face-gate/face_gate.py (create_landmarker,
detect_points, load_rgb, region_polygons, raster_masks) so the same model that
the face gate pins is the one used here. No new model, no hand estimates.

Per subject we measure THREE images: A (albedo brow alone: mesh hidden),
M (mesh brow alone: painted brow removed from the scratch albedo) and PRE
(as shipped, both brows). Each is scored against the subject's goal photo.

METRICS (per side; side A = image-left landmarks 33/133/159, side B =
image-right 362/263/386; eye width = |33-133| resp |362-263|):

  pos   = (upper_lid_apex_y - brow_centroid_y) / eye_width
          upper-lid apex = landmark 159 (A) / 386 (B); brow centroid =
          unweighted mean y of the brow pixels below.
  thick = mean vertical extent (max_y - min_y + 1) of the brow pixels, over
          the THICKEST third of the brow's x-span, divided by eye_width.
          The brow x-span (min..max brow-pixel x) is split into three equal
          thirds; each third's mean per-column vertical extent is taken; the
          largest of the three is `thick`.
  dL    = mean L* of the brow pixels - median L* of the forehead skin
  dC    = mean chroma of the brow pixels - median chroma of the forehead skin
          (both differenced against the SAME image's forehead, so exposure,
          tone mapping and rig cancel to first order.)

BROW-PIXEL RULE (stated once, drawn on the overlay): a pixel counts as brow
iff it lies inside the landmark brow box AND its L* is more than K_CON below
a large-radius LOCAL skin background (bgL - L > K_CON). The background is a
Gaussian blur of the image L* channel at sigma = 0.40 * eye width, so at the
brow the background is the surrounding forehead/upper-lid skin and at flat
skin bgL - L ~ 0. This is the "contrast to the forehead/skin" the card asks
for, made local so a smooth lid-crease shading gradient (uniformly ~10 L*
below forehead everywhere, brow or not) does not read as brow. The brow box
is [min..max x of that side's brow landmark row, +/- 18% of the eye width] x
[top = min brow-landmark y - 0.35 eye widths, bottom = max brow-landmark y +
0.18 eye widths]. K_CON = 8 L* units (calibrated on the goal photo and the
shipped render: brow-hair ink measures 12-25 L* below the blurred local skin,
flat skin under 4).

DISTANCE vs the goal (lower is closer; the winner must win on BOTH subjects):
  D = |pos - pos_goal| / 0.10            (0.10 eye widths = POS_UNIT)
    + |thick - thick_goal| / 0.10         (0.10 eye widths = THICK_UNIT)
    + (|dL - dL_goal| + |dC - dC_goal|) / 10.0   (10 L*/C units = COL_UNIT)
The per-side D is averaged over the two sides for the reported per-image D.
The units are fixed, documented tolerances, not fitted to any candidate.

CLI:
  measure_brow.py --goal <goal.png> --image A=<png> --image M=<png>
                  --image PRE=<png> --out <dir>
Writes <dir>/<label>.overlay.png and prints one JSON object to stdout.
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
FACE_GATE = os.path.normpath(os.path.join(HERE, "..", "..", "face-gate", "face_gate.py"))

K_CON = 8.0
POS_UNIT = 0.10
THICK_UNIT = 0.10
COL_UNIT = 10.0

SIDES = {
    "L": {"outer": 33, "inner": 133, "apex": 159,
          "brow": [70, 63, 105, 66, 107]},
    "R": {"outer": 362, "inner": 263, "apex": 386,
          "brow": [336, 296, 334, 293, 300]},
}


def load_face_gate():
    spec = importlib.util.spec_from_file_location("face_gate_mod", FACE_GATE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def rgb_to_lab(rgb):
    from skimage.color import rgb2lab
    return rgb2lab(rgb.astype(np.float64) / 255.0)


def chroma(lab):
    return np.hypot(lab[..., 1], lab[..., 2])


def measure_image(fg, landmarker, path):
    rgb = fg.load_rgb(path)
    pts = fg.detect_points(landmarker, Image.fromarray(rgb))
    if pts is None:
        return {"path": path, "detected": False}
    lab = rgb_to_lab(rgb)
    L = lab[..., 0]
    h, w = rgb.shape[:2]

    polys = fg.region_polygons(pts)
    fgm = np.zeros((h, w), np.uint8)
    cv2.fillPoly(fgm, [polys["forehead"].astype(np.int32)], 1)
    fgm = cv2.erode(fgm, np.ones((3, 3), np.uint8), iterations=3) > 0
    f_L = float(np.median(L[fgm]))
    f_C = float(np.median(chroma(lab)[fgm]))

    overlay = rgb.copy()
    cv2.polylines(overlay, [polys["forehead"].astype(np.int32)], True, (0, 255, 0), 1)
    sides = {}
    for name, s in SIDES.items():
        outer, inner = pts[s["outer"]], pts[s["inner"]]
        eye_w = float(np.hypot(*(outer - inner)))
        apex = pts[s["apex"]]
        bx = np.array([pts[i] for i in s["brow"]], dtype=float)
        bgL = cv2.GaussianBlur(L, (0, 0), 0.40 * eye_w)
        x0 = int(np.floor(bx[:, 0].min() - 0.18 * eye_w))
        x1 = int(np.ceil(bx[:, 0].max() + 0.18 * eye_w))
        y0 = int(np.floor(bx[:, 1].min() - 0.35 * eye_w))
        y1 = int(np.ceil(bx[:, 1].max() + 0.18 * eye_w))
        x0, x1 = max(x0, 0), min(x1, w - 1)
        y0, y1 = max(y0, 0), min(y1, h - 1)
        box = np.zeros((h, w), bool)
        box[y0:y1 + 1, x0:x1 + 1] = True
        brow = box & ((bgL - L) > K_CON)
        # Exclude the coloured forehead-guide polyline region from nothing; box is fine.
        ys, xs = np.where(brow)
        if xs.size < 5:
            sides[name] = {"eyeWidth": eye_w, "n": int(xs.size),
                           "pos": None, "thick": None, "dL": None, "dC": None}
            cv2.rectangle(overlay, (x0, y0), (x1, y1), (0, 255, 255), 1)
            continue
        centroid_y = float(ys.mean())
        pos = (float(apex[1]) - centroid_y) / eye_w
        xmin, xmax = float(xs.min()), float(xs.max())
        span = max(xmax - xmin, 1.0)
        thirds = []
        for t in range(3):
            ta = xmin + t * span / 3.0
            tb = xmin + (t + 1) * span / 3.0
            extents = []
            for x in range(int(np.floor(ta)), int(np.ceil(tb)) + 1):
                col = np.where(brow[:, x])[0]
                if col.size:
                    extents.append(col.max() - col.min() + 1.0)
            thirds.append(float(np.mean(extents)) if extents else 0.0)
        thick = max(thirds) / eye_w
        dL = float(L[brow].mean()) - f_L
        dC = float(chroma(lab)[brow].mean()) - f_C
        # draw
        overlay[brow] = (255, 0, 255)
        cv2.rectangle(overlay, (x0, y0), (x1, y1), (0, 255, 255), 1)
        cv2.circle(overlay, (int(round(centroid_y * 0 + np.mean(xs))), int(round(centroid_y))), 4, (0, 0, 255), -1)
        cv2.circle(overlay, (int(apex[0]), int(apex[1])), 4, (255, 128, 0), -1)
        sides[name] = {
            "eyeWidth": round(eye_w, 2),
            "n": int(xs.size),
            "pos": round(pos, 4),
            "thick": round(thick, 4),
            "dL": round(dL, 3),
            "dC": round(dC, 3),
            "boxPx": [x0, y0, x1, y1],
        }
    # mean over sides that measured
    ok = [s for s in sides.values() if s.get("pos") is not None]
    mean = None
    if ok:
        mean = {k: round(float(np.mean([s[k] for s in ok])), 4)
                for k in ("pos", "thick", "dL", "dC")}
    return {"path": path, "detected": True, "foreheadL": round(f_L, 2),
            "foreheadC": round(f_C, 2), "sides": sides, "mean": mean,
            "_overlay": overlay}


def distance(mean, gmean):
    dp = abs(mean["pos"] - gmean["pos"]) / POS_UNIT
    dt = abs(mean["thick"] - gmean["thick"]) / THICK_UNIT
    dc = (abs(mean["dL"] - gmean["dL"]) + abs(mean["dC"] - gmean["dC"])) / COL_UNIT
    return {"pos": round(dp, 4), "thick": round(dt, 4), "colour": round(dc, 4),
            "D": round(dp + dt + dc, 4)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--goal", required=True)
    ap.add_argument("--image", action="append", required=True,
                    help="LABEL=path")
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    fg = load_face_gate()
    landmarker = fg.create_landmarker()
    goal = measure_image(fg, landmarker, args.goal)
    if not goal["detected"]:
        print("goal face not detected", file=sys.stderr)
        return 2
    out = {"goal": {k: v for k, v in goal.items() if k != "_overlay"},
           "images": {}, "formula": {
               "D": "|pos-gpos|/%.2f + |thick-gthick|/%.2f + (|dL-gdL|+|dC-gdC|)/%.1f"
                    % (POS_UNIT, THICK_UNIT, COL_UNIT),
               "K_CON": K_CON,
               "browBox": "brow-landmark x +/-18% eye width; y top=min brow y -0.55 eye widths; y bottom=upper-lid apex",
           }}
    Image.fromarray(goal["_overlay"]).save(os.path.join(args.out, "goal.overlay.png"))
    gmean = goal["mean"]
    for item in args.image:
        label, path = item.split("=", 1)
        m = measure_image(fg, landmarker, path)
        if not m["detected"]:
            out["images"][label] = {"path": path, "detected": False}
            print("image %s face not detected" % label, file=sys.stderr)
            continue
        Image.fromarray(m["_overlay"]).save(
            os.path.join(args.out, "%s.overlay.png" % label))
        d = distance(m["mean"], gmean) if (m["mean"] and gmean) else None
        out["images"][label] = {k: v for k, v in m.items() if k != "_overlay"}
        out["images"][label]["distance"] = d
    with open(os.path.join(args.out, "measurements.json"), "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
