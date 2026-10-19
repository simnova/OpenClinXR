#!/usr/bin/env python3
"""Whole-face regression region metrics (card tsk_0e618fa5e9ac3e15).

THE single region implementation: the named-region index table lives here
only. TypeScript (regions.ts / metrics.ts) holds no table, no mask code and
no colour math; the contract test and the `check` CLI both drive this file
through `mise exec -C /Volumes/files/src/openclinxr -- python3`.

Masks come from the GOLDEN render's landmarks and are applied to BOTH images,
so a region that moved cannot shrink its own mask to hide the move. Masks are
DISJOINT by precedence (eye_L, eye_R, brow_L, brow_R, lips, nose first; cheeks,
forehead, chin are their hulls minus every earlier mask, and minus each other
in precedence order), so a declared eye or brow change cannot fail an
undeclared cheek or forehead that merely shares hull indices.

Per region: mean CIEDE2000 dE (skimage), SSIM on L*, and mean landmark
displacement in px (reported, never gated). The landmark model is the PINNED
face-gate model, and detection is face_gate_v2.detect_median (median of 3).
Neither the detector nor the model resolver is copied here: face_gate.py /
face_gate_v2.py are imported. `--golden-landmarks/--current-landmarks` skip
detection with 478 x [x,y] px JSON fixtures (what the contract test uses).

Writes the metrics JSON plus, per region, a full-image per-pixel dE heatmap
PNG that sheets.ts composes into the check sheet (fixed colour scale, stated
in the JSON so the sheet never re-derives colour).

Run only through mise so the face-gate python env is on PATH:

  mise exec -C /Volumes/files/src/openclinxr -- python3 \
    tools/openclinxr/evidence/face-regression/src/regions.py \
    --golden <png> --current <png> --out <json> [--case <id>] [--view <n>] \
    [--golden-landmarks <json> --current-landmarks <json>] \
    [--heatmap-dir <dir>]
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_FACE_GATE_DIR = os.path.normpath(
    os.path.join(SCRIPT_DIR, "..", "..", "face-gate"))
if _FACE_GATE_DIR not in sys.path:
    sys.path.insert(0, _FACE_GATE_DIR)


# Named face regions as pinned MediaPipe FaceLandmarker indices (478-point).
# Single copy: nothing in TypeScript names these indices.
REGION_LANDMARKS = {
    "eye_L": [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
    "eye_R": [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
    "brow_L": [70, 63, 105, 66, 107, 46, 53, 52, 65, 55],
    "brow_R": [336, 296, 334, 293, 300, 276, 283, 282, 295, 285],
    "lips": [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
    "nose": [168, 6, 197, 195, 5, 4, 1, 2, 98, 327, 129, 358],
    "cheek_L": [145, 61, 129, 101, 234, 50, 118, 117, 123, 147, 187, 205, 206],
    "cheek_R": [374, 291, 358, 330, 454, 280, 346, 347, 352, 376, 411, 425, 426],
    "forehead": [10, 67, 69, 104, 108, 151, 9, 8, 337, 299, 333, 297, 338],
    "chin": [17, 152, 172, 397],
}
# Disjoint-mask precedence (H3): eyes, brows, lips, nose win every overlap;
# cheeks, forehead, chin keep only what no earlier region claimed. Overlaps
# this resolves: cheek_L/R share lower-lid (145/374) and mouth-corner (61/291)
# indices with eye_L/R and lips; nose shares 129/358 with both cheeks; the
# forehead hull can reach the inner brows.
PRECEDENCE = ["eye_L", "eye_R", "brow_L", "brow_R", "lips", "nose",
              "cheek_L", "cheek_R", "forehead", "chin"]
assert list(REGION_LANDMARKS.keys()) == PRECEDENCE, "table order is the precedence order"
REGION_ORDER = list(PRECEDENCE)

# Fixed heatmap colour scale (stated in every metrics JSON; sheets compose).
HEATMAP_MAX_DE = 10.0
HEATMAP_SCALE = {
    "metric": "CIEDE2000 dE",
    "min": 0.0,
    "max": HEATMAP_MAX_DE,
    "mapping": "linear black -> red, dE >= max clamps to full red (255,0,0)",
}

REQUIRED_LANDMARKS = 1 + max(i for idxs in REGION_LANDMARKS.values() for i in idxs)


def _polygon(points):
    import cv2
    pts = np.asarray(points, dtype=np.float32).reshape(-1, 1, 2)
    return cv2.convexHull(pts).reshape(-1, 2).astype(np.int32)


def region_masks(landmarks, w, h):
    """Disjoint binary masks + hull bboxes from the golden landmarks.

    Hulls are built in PRECEDENCE order; each mask is its hull minus the union
    of every earlier mask, so the ten masks never share a pixel.
    """
    import cv2
    masks = {}
    bboxes = {}
    taken = np.zeros((h, w), dtype=np.uint8)
    for region in PRECEDENCE:
        idxs = REGION_LANDMARKS[region]
        pts = np.asarray([landmarks[i] for i in idxs], dtype=np.float64)
        hull = _polygon(pts)
        m = np.zeros((h, w), dtype=np.uint8)
        if len(hull) >= 3:
            cv2.fillPoly(m, [hull], 1)
        xs = hull[:, 0] if len(hull) else np.array([0])
        ys = hull[:, 1] if len(hull) else np.array([0])
        bboxes[region] = {
            "x0": int(max(0, np.floor(xs.min()))),
            "y0": int(max(0, np.floor(ys.min()))),
            "x1": int(min(w, np.ceil(xs.max()))),
            "y1": int(min(h, np.ceil(ys.max()))),
        }
        m = (m & (1 - taken)).astype(np.uint8)
        masks[region] = m
        taken = (taken | m).astype(np.uint8)
    return masks, bboxes


def _ssim_on_L(L_ref, L_cur, mask):
    """Single-window SSIM on L* restricted to the mask (1.0 when identical)."""
    sel = mask > 0
    n = int(sel.sum())
    if n == 0:
        return 1.0
    a = L_ref[sel].astype(np.float64)
    b = L_cur[sel].astype(np.float64)
    ma, mb = a.mean(), b.mean()
    va = float(((a - ma) ** 2).mean())
    vb = float(((b - mb) ** 2).mean())
    cov = float(((a - ma) * (b - mb)).mean())
    L = 100.0
    C1 = (0.01 * L) ** 2
    C2 = (0.03 * L) ** 2
    den = (ma * ma + mb * mb + C1) * (va + vb + C2)
    if den == 0:
        return 1.0
    return float(((2 * ma * mb + C1) * (2 * cov + C2)) / den)


def heatmap_rgb(dE_field):
    """Fixed-scale dE heat: 0 -> black, >= HEATMAP_MAX_DE -> red."""
    t = np.clip(dE_field / HEATMAP_MAX_DE, 0.0, 1.0)
    rgb = np.zeros(dE_field.shape + (3,), dtype=np.uint8)
    rgb[:, :, 0] = (255 * t).round().astype(np.uint8)
    rgb[:, :, 1] = (255 * np.maximum(0.0, t - 0.5) * 2).round().astype(np.uint8)
    return rgb


def measure(golden_rgb, current_rgb, golden_pts, current_pts):
    import face_gate as v1
    from skimage.color import deltaE_ciede2000
    h, w = golden_rgb.shape[:2]
    lab_g = v1.rgb_to_lab(golden_rgb)
    lab_c = v1.rgb_to_lab(current_rgb)
    L_g, L_c = lab_g[:, :, 0], lab_c[:, :, 0]
    dE_field = np.asarray(deltaE_ciede2000(lab_g, lab_c), dtype=np.float64)
    masks, bboxes = region_masks(golden_pts, w, h)
    out = []
    for region in REGION_ORDER:
        mask = masks[region]
        sel = mask > 0
        n = int(sel.sum())
        if n == 0:
            out.append({"region": region, "dE": 0.0, "ssimL": 1.0,
                        "landmarkDispPx": 0.0, "pixels": 0,
                        "bbox": bboxes[region]})
            continue
        de = float(dE_field[sel].mean())
        disp = 0.0
        idxs = REGION_LANDMARKS[region]
        for i in idxs:
            g = golden_pts[i]
            c = current_pts[i]
            disp += float(np.hypot(g[0] - c[0], g[1] - c[1]))
        disp /= len(idxs)
        out.append({
            "region": region,
            "dE": de,
            "ssimL": _ssim_on_L(L_g, L_c, mask),
            "landmarkDispPx": disp,
            "pixels": n,
            "bbox": bboxes[region],
        })
    return out, masks, dE_field


def load_landmark_override(path):
    with open(path) as f:
        pts = json.load(f)
    if not isinstance(pts, list) or len(pts) < REQUIRED_LANDMARKS:
        raise SystemExit(
            "refused: %s holds %s landmarks, need >= %d"
            % (os.path.basename(path),
               len(pts) if isinstance(pts, list) else type(pts).__name__,
               REQUIRED_LANDMARKS))
    return np.asarray([[float(p[0]), float(p[1])] for p in pts], dtype=np.float64)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--golden", required=False, default=None, help="golden PNG (mask source)")
    ap.add_argument("--current", required=False, default=None, help="current PNG")
    ap.add_argument("--out", required=False, default=None, help="metrics JSON path")
    ap.add_argument("--model", default=None, help="explicit landmark model path")
    ap.add_argument("--landmarks-out", default=None,
                    help="optional JSON path for golden+current landmarks")
    ap.add_argument("--golden-landmarks", default=None,
                    help="fixture landmarks JSON (478 x [x,y] px); skips detection")
    ap.add_argument("--current-landmarks", default=None,
                    help="fixture landmarks JSON (478 x [x,y] px); skips detection")
    ap.add_argument("--heatmap-dir", default=None,
                    help="per-region dE heatmap PNG dir (default: <out dir>/heatmaps)")
    ap.add_argument("--dump-regions", action="store_true",
                    help="print the region table + precedence as JSON and exit")
    ap.add_argument("--case", default=None)
    ap.add_argument("--view", default=None)
    args = ap.parse_args(argv)

    if args.dump_regions:
        print(json.dumps({"REGION_LANDMARKS": REGION_LANDMARKS,
                          "REGION_ORDER": REGION_ORDER,
                          "PRECEDENCE": PRECEDENCE}))
        return

    if not args.golden or not args.current or not args.out:
        raise SystemExit("refused: --golden, --current and --out are required (or use --dump-regions)")

    import face_gate as v1

    if args.golden_landmarks and args.current_landmarks:
        g_pts = load_landmark_override(args.golden_landmarks)
        c_pts = load_landmark_override(args.current_landmarks)
        model_info = {"path": None,
                      "note": "landmarks overridden; no detection, no model"}
        detection = {"golden": {"source": "override", "path": args.golden_landmarks},
                     "current": {"source": "override", "path": args.current_landmarks}}
    else:
        import face_gate_v2 as v2
        model = v1.resolve_model_path(args.model)
        landmarker = v1.create_landmarker(model)
        g_pts, g_jit = v2.detect_median(landmarker, Image.open(args.golden))
        c_pts, c_jit = v2.detect_median(landmarker, Image.open(args.current))
        if g_pts is None or c_pts is None:
            raise SystemExit(
                "refused: no face detected (golden runs_ok=%s current runs_ok=%s)"
                % (g_jit.get("runs_ok"), c_jit.get("runs_ok")))
        model_info = {"path": model, "sha256": v1.sha256_of(model)}
        detection = {"golden": g_jit, "current": c_jit}

    golden_rgb = v1.load_rgb(args.golden)
    current_rgb = v1.load_rgb(args.current)
    if golden_rgb.shape[:2] != current_rgb.shape[:2]:
        raise SystemExit(
            "refused: dimension mismatch %s %s vs %s %s"
            % (os.path.basename(args.golden), golden_rgb.shape[:2],
               os.path.basename(args.current), current_rgb.shape[:2]))

    metrics, masks, dE_field = measure(golden_rgb, current_rgb, g_pts, c_pts)

    heatmap_dir = args.heatmap_dir or os.path.join(
        os.path.dirname(os.path.abspath(args.out)), "heatmaps")
    os.makedirs(heatmap_dir, exist_ok=True)
    for m in metrics:
        region = m["region"]
        heat = heatmap_rgb(np.where(masks[region] > 0, dE_field, 0.0))
        name = "%s.png" % region
        Image.fromarray(heat, mode="RGB").save(os.path.join(heatmap_dir, name))
        m["heatmap"] = name

    report = {
        "case": args.case,
        "view": args.view,
        "model": model_info,
        "detection": detection,
        "precedence": PRECEDENCE,
        "heatmapScale": HEATMAP_SCALE,
        "heatmapDir": heatmap_dir,
        "metrics": metrics,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    if args.landmarks_out:
        lms = {
            "golden": [[float(x), float(y)] for x, y in g_pts],
            "current": [[float(x), float(y)] for x, y in c_pts],
        }
        os.makedirs(os.path.dirname(os.path.abspath(args.landmarks_out)),
                    exist_ok=True)
        with open(args.landmarks_out, "w") as f:
            json.dump(lms, f)
            f.write("\n")
    print(args.out)


if __name__ == "__main__":
    main()
