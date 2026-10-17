"""Sclera-shade metrics (CARD tsk_c120564ce449c2b1, handback 1).

One script used on goal photos and renders alike. Landmarks come from the
MediaPipe face landmarker that the face-fit tools use
(tools/openclinxr/evidence/face-fit/fit_facefit2.py MODEL asset:
store/face-fit/face_landmarker.task).

Masks (handback 1: the old eye-contour polygon ran past the inner canthus
onto skin and missed part of the white, so every old M1/M2/D90 mixed skin
and lid into "sclera"):
- renders (--id <id.png>): sclera = pixels of the eye GLOBE material visible
  in the frame, taken from an ID render of the same variant (materialOverrides
  paint only the globe material a flat unlit key colour: color #000000 +
  emissive #00ff00; occlusion shell and tearline hidden for the ID pass; same
  camera), minus the iris circle (MediaPipe 468-477 on the beauty frame).
  Key threshold (calibrated 2026-10-17 on ss-aisha-id-front.png, tone-mapped
  key median RGB 141,225,89): G-R >= 30 and G-B >= 30 and G >= 80.
  Key pixels are assigned per eye by proximity to the iris centre within a
  5 px-dilated eye polygon (strays outside any eye region are dropped).
- goal photos (no --id): MediaPipe eye polygon eroded 2 px minus the iris
  circle.

Skin = an infraorbital patch below each eye, defined once in landmark
coordinates (same fractions for every image).

Metrics (L* = CIELAB L from sRGB, D65):
- M1  = median sclera L* minus median skin L*.
- M2a = median L* of limbus-adjacent sclera minus canthal sclera. Each
        sclera pixel is assigned to the nearer of two prototypes: the iris
        edge (distance-to-edge scaled by 0.5 * that eye's iris radius) or
        the nearer canthus (distance scaled by 0.25 * that eye's
        corner-to-corner length). DEVIATION from the brief's "thirds along
        the corner axis": measured 2026-10-17, the literal middle third is
        anatomically the iris (middle-third survivor counts with correct
        masks: goal Aisha 3 px, goal body2 33 px, PRE Aisha 36 px, PRE
        body2 11 px), so the brief's split is unmeasurable once skin/lid
        contamination is removed; the Voronoi partition measures the same
        canthal-shading gradient on well-populated sets.
- M2b = upper-half minus lower-half sclera median L*.
- D90 = 90th-percentile sclera L* minus median skin L*.

Refusals (exit 2, error JSON): NaN in any metric, fewer than 50 mask px in
either eye, empty thirds/halves split, ID/beauty size mismatch, no face.

Usage:
  mise exec -C /Volumes/files/src/openclinxr -- python3 \
    tools/openclinxr/asset-pipeline/realism-head/sclera-shade/sclera_metrics.py \
    --image <beauty.png> [--id <id.png>] [--out <json>] [--debug <overlay.png>]
"""

import argparse
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.environ.get(
    "OPENCLINXR_ASSET_STORE",
    "/Volumes/files/openclinxr-assets/store/face-fit",
)
MODEL_PATH = os.path.join(STORE, "face_landmarker.task")

# Eye-contour polygons (MediaPipe FaceMesh index sets, image coordinates).
EYE_R = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
EYE_L = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398]
# Corner-to-corner axes: (outer, inner) per eye.
CORNERS_R = (33, 133)
CORNERS_L = (362, 263)
# Iris ring + pupil centre per eye.
IRIS_R = ([469, 470, 471, 472], 468)
IRIS_L = ([474, 475, 476, 477], 473)

# ID-pass key threshold (see module docstring for calibration).
KEY_GR_MIN = 30
KEY_GB_MIN = 30
KEY_G_MIN = 80
# Goal-photo polygon erosion, px.
ERODE_PX = 2
# ID per-eye assignment: key pixels must fall inside the eye polygon dilated
# by this many px (drops stray key-coloured pixels elsewhere in the frame).
ASSIGN_DILATE_PX = 5
# Refusal floor: mask px per eye.
MIN_PX_PER_EYE = 50


class RefusalError(Exception):
    pass


def refuse(msg):
    raise RefusalError(msg)


def srgb_to_lab_l(rgb):
    """CIELAB L* for an (..., 3) uint8 sRGB array (D65)."""
    a = rgb.astype(np.float64) / 255.0
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    m = np.array(
        [
            [0.4124564, 0.3575761, 0.1804375],
            [0.2126729, 0.7151522, 0.0721750],
            [0.0193339, 0.1191920, 0.9503041],
        ]
    )
    xyz = lin @ m.T
    xyz /= np.array([0.95047, 1.0, 1.08883])
    eps = 216 / 24389
    kap = 24389 / 27
    f = np.where(xyz > eps, np.cbrt(xyz), (kap * xyz + 16) / 116)
    return 116 * f[..., 1] - 16


def detect_landmarks(rgb):
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    if not os.path.isfile(MODEL_PATH):
        refuse(f"face landmarker absent: {MODEL_PATH}")
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    options = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
    )
    with vision.FaceLandmarker.create_from_options(options) as landmarker:
        res = landmarker.detect(mp_img)
    if not res.face_landmarks:
        refuse("no face detected")
    lm = res.face_landmarks[0]
    h, w = rgb.shape[:2]
    return np.array([[p.x * w, p.y * h] for p in lm])


def rasterize_polygon(shape, pts):
    from PIL import Image as I

    mask = I.new("L", (shape[1], shape[0]), 0)
    ImageDraw.Draw(mask).polygon([tuple(p) for p in pts], fill=255)
    return np.array(mask) > 0


def morph_bool(mask, radius_px, erode):
    """Binary erode (MinFilter) / dilate (MaxFilter) by radius_px."""
    from PIL import Image as I

    img = I.fromarray((mask * 255).astype(np.uint8), mode="L")
    size = 2 * radius_px + 1
    filt = ImageFilter.MinFilter(size) if erode else ImageFilter.MaxFilter(size)
    return np.array(img.filter(filt)) > 127


def sha_of(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def eye_band_crop(rgb_tinted, poly, mask, scale=1.6):
    """Native-pixel eye-band crop around an eye polygon (no rescale)."""
    h, w = rgb_tinted.shape[:2]
    x0, y0 = poly.min(axis=0)
    x1, y1 = poly.max(axis=0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hw, hh = (x1 - x0) / 2 * scale, (y1 - y0) / 2 * scale * 1.6
    x0i, x1i = max(0, int(cx - hw)), min(w, int(cx + hw))
    y0i, y1i = max(0, int(cy - hh)), min(h, int(cy + hh))
    crop = rgb_tinted[y0i:y1i, x0i:x1i].copy()
    m = mask[y0i:y1i, x0i:x1i]
    tint = np.array([255, 0, 255], dtype=np.float64)
    crop[m] = (0.5 * crop[m].astype(np.float64) + 0.5 * tint).astype(np.uint8)
    return crop


def measure_image(path, id_path=None, debug=None):
    rgb = np.array(Image.open(path).convert("RGB"))
    h, w = rgb.shape[:2]
    L = srgb_to_lab_l(rgb)
    pts = detect_landmarks(rgb)
    if pts.shape[0] < 478:
        refuse(f"need 478 landmarks, got {pts.shape[0]}")

    yy, xx = np.mgrid[0:h, 0:w]
    iris_union = np.zeros((h, w), dtype=bool)
    per_eye = []
    for contour, (ring, pupil), (co, ci) in (
        (EYE_R, IRIS_R, CORNERS_R),
        (EYE_L, IRIS_L, CORNERS_L),
    ):
        poly = pts[contour]
        centre = pts[pupil]
        ring_pts = pts[ring]
        radius = float(np.max(np.linalg.norm(ring_pts - centre, axis=1)))
        iris_mask = (xx - centre[0]) ** 2 + (yy - centre[1]) ** 2 <= radius**2
        iris_union |= iris_mask
        per_eye.append(
            {
                "poly": poly,
                "centre": centre,
                "radius": radius,
                "iris_mask": iris_mask,
            }
        )

    id_sha = None
    key_stats = None
    if id_path is not None:
        mask_kind = "id-globe"
        id_rgb = np.array(Image.open(id_path).convert("RGB"))
        if id_rgb.shape[:2] != (h, w):
            refuse(
                f"ID/beauty size mismatch: id {id_rgb.shape[1]}x{id_rgb.shape[0]} "
                f"vs beauty {w}x{h} (same camera required)"
            )
        id_sha = sha_of(id_path)
        R, G, B = (id_rgb[:, :, i].astype(int) for i in range(3))
        key = (G - R >= KEY_GR_MIN) & (G - B >= KEY_GB_MIN) & (G >= KEY_G_MIN)
        key_stats = {
            "nKey": int(key.sum()),
            "keyFrac": round(float(key.mean()), 6),
            "keyMedianRGB": [round(float(v), 1) for v in np.median(id_rgb[key], axis=0)]
            if key.sum()
            else None,
        }
        # Per-eye assignment: key pixels inside the dilated eye polygon,
        # minus the iris union; nearer iris centre wins overlaps.
        d0 = np.full((h, w), np.inf)
        owner = np.full((h, w), -1, dtype=np.int8)
        for i, e in enumerate(per_eye):
            region = morph_bool(
                rasterize_polygon(rgb.shape, e["poly"]), ASSIGN_DILATE_PX, False
            )
            e["region"] = region
            dist = np.sqrt(
                (xx - e["centre"][0]) ** 2 + (yy - e["centre"][1]) ** 2
            )
            closer = region & (dist < d0)
            d0[closer] = dist[closer]
            owner[closer] = i
        sclera_masks = []
        for i, e in enumerate(per_eye):
            m = key & (owner == i) & ~iris_union
            e["sclera"] = m
            sclera_masks.append(m)
    else:
        mask_kind = "eroded-polygon"
        sclera_masks = []
        for e in per_eye:
            poly_mask = rasterize_polygon(rgb.shape, e["poly"])
            eroded = morph_bool(poly_mask, ERODE_PX, True)
            m = eroded & ~iris_union
            e["sclera"] = m
            e["region"] = poly_mask
            sclera_masks.append(m)

    for i, e in enumerate(per_eye):
        n = int(e["sclera"].sum())
        e["nSclera"] = n
        if n < MIN_PX_PER_EYE:
            refuse(
                f"eye {i}: only {n} sclera px (< {MIN_PX_PER_EYE}; mask={mask_kind})"
            )
        iris_rgb = rgb[e["iris_mask"]]
        e["irisMeanRGB"] = (
            [float(c) for c in iris_rgb.mean(axis=0)] if iris_rgb.size else None
        )

    # Infraorbital skin patch below each eye, fixed landmark fractions:
    # width 0.5*corner-distance centred under the eye centre, top 0.20w
    # below the lower lid margin, height 0.30w.
    skin_vals = []
    patch_boxes = []
    for contour, (_, pupil), (co, ci) in (
        (EYE_R, IRIS_R, CORNERS_R),
        (EYE_L, IRIS_L, CORNERS_L),
    ):
        outer, inner = pts[co], pts[ci]
        w_eye = float(np.linalg.norm(inner - outer))
        cx = float(pts[pupil][0])
        lower_y = float(np.max(pts[contour][:, 1]))
        x0, x1 = cx - 0.25 * w_eye, cx + 0.25 * w_eye
        y0, y1 = lower_y + 0.20 * w_eye, lower_y + 0.50 * w_eye
        x0i, x1i = max(0, int(x0)), min(w, int(x1))
        y0i, y1i = max(0, int(y0)), min(h, int(y1))
        patch = L[y0i:y1i, x0i:x1i]
        if patch.size == 0:
            refuse("empty skin patch")
        skin_vals.append(patch.ravel())
        patch_boxes.append([x0i, y0i, x1i, y1i])

    skin = np.concatenate(skin_vals)
    skin_med = float(np.median(skin))
    all_sclera = np.concatenate([L[e["sclera"]] for e in per_eye])
    m1 = float(np.median(all_sclera)) - skin_med
    # M2a: limbus-adjacent vs canthal partition (see docstring deviation
    # note). Halves (M2b) pooled per eye, then pooled across eyes.
    mids, canthals, ups, los = [], [], [], []
    for (co, ci), e in zip((CORNERS_R, CORNERS_L), per_eye):
        outer, inner = pts[co], pts[ci]
        axis = inner - outer
        axis_len = float(np.linalg.norm(axis))
        if not np.isfinite(axis_len) or axis_len <= 0:
            refuse("degenerate eye corner axis")
        u = axis / axis_len
        centre = e["centre"]
        r_eye = float(e["radius"])
        if not np.isfinite(r_eye) or r_eye <= 0:
            refuse("degenerate iris radius")
        sel = e["sclera"]
        d_iris_edge = (
            np.sqrt((xx - centre[0]) ** 2 + (yy - centre[1]) ** 2)[sel] - r_eye
        )
        d_outer = np.sqrt((xx - outer[0]) ** 2 + (yy - outer[1]) ** 2)[sel]
        d_inner = np.sqrt((xx - inner[0]) ** 2 + (yy - inner[1]) ** 2)[sel]
        d_corner = np.minimum(d_outer, d_inner)
        s_limb = d_iris_edge / (0.5 * r_eye)
        s_canth = d_corner / (0.25 * axis_len)
        sL = L[sel]
        is_limbus = s_limb <= s_canth
        mids.append(sL[is_limbus])
        canthals.append(sL[~is_limbus])
        n = np.array([-u[1], u[0]])
        v = (xx - outer[0]) * n[0] + (yy - outer[1]) * n[1]
        iris_v = float((centre - outer) @ n)
        upper_m = (v[sel] - iris_v) < 0
        ups.append(sL[upper_m])
        los.append(sL[~upper_m])
    parts = {
        "limbus": np.concatenate(mids),
        "canthal": np.concatenate(canthals),
        "upper": np.concatenate(ups),
        "lower": np.concatenate(los),
    }
    for name, arr in parts.items():
        if arr.size == 0:
            refuse(f"empty '{name}' split (mask={mask_kind}; cannot median)")
    m2a = float(np.median(parts["limbus"])) - float(np.median(parts["canthal"]))
    m2b = float(np.median(parts["upper"])) - float(np.median(parts["lower"]))
    d90 = float(np.percentile(all_sclera, 90)) - skin_med
    for name, val in (("M1", m1), ("M2a", m2a), ("M2b", m2b), ("D90", d90)):
        if not np.isfinite(val):
            refuse(f"{name} is NaN (mask={mask_kind})")

    out = {
        "image": os.path.abspath(path),
        "sha256": sha_of(path),
        "size": [w, h],
        "maskKind": mask_kind,
        "idImage": os.path.abspath(id_path) if id_path else None,
        "idSha256": id_sha,
        "keyThreshold": {"grMin": KEY_GR_MIN, "gbMin": KEY_GB_MIN, "gMin": KEY_G_MIN}
        if id_path
        else None,
        "keyStats": key_stats,
        "M1": round(m1, 3),
        "M2a": round(m2a, 3),
        "M2b": round(m2b, 3),
        "D90": round(d90, 3),
        "scleraMedianL": round(float(np.median(all_sclera)), 3),
        "scleraP90L": round(float(np.percentile(all_sclera, 90)), 3),
        "skinMedianL": round(skin_med, 3),
        "midMedianL": round(float(np.median(parts["limbus"])), 3),
        "canthalMedianL": round(float(np.median(parts["canthal"])), 3),
        "nLimbus": int(parts["limbus"].size),
        "nCanthal": int(parts["canthal"].size),
        "nUpper": int(parts["upper"].size),
        "nLower": int(parts["lower"].size),
        "upperMedianL": round(float(np.median(parts["upper"])), 3),
        "lowerMedianL": round(float(np.median(parts["lower"])), 3),
        "nSclera": int(all_sclera.size),
        "nSkin": int(skin.size),
        "irisMeanRGB": {
            "R": round(float(np.mean([e["irisMeanRGB"][0] for e in per_eye])), 2),
            "G": round(float(np.mean([e["irisMeanRGB"][1] for e in per_eye])), 2),
            "B": round(float(np.mean([e["irisMeanRGB"][2] for e in per_eye])), 2),
        },
        "perEye": [
            {
                "nSclera": e["nSclera"],
                "irisRadiusPx": round(float(e["radius"]), 2),
                "irisMeanRGB": [round(c, 2) for c in e["irisMeanRGB"]],
            }
            for e in per_eye
        ],
    }
    if debug:
        tinted = rgb.copy()
        full_mask = np.zeros((h, w), dtype=bool)
        for e in per_eye:
            full_mask |= e["sclera"]
        tint = np.array([255, 0, 255], dtype=np.float64)
        tinted[full_mask] = (
            0.5 * tinted[full_mask].astype(np.float64) + 0.5 * tint
        ).astype(np.uint8)
        dbg = Image.fromarray(tinted)
        d = ImageDraw.Draw(dbg, "RGBA")
        for (x0, y0, x1, y1) in patch_boxes:
            d.rectangle([x0, y0, x1, y1], outline=(0, 255, 0), width=3)
        for e in per_eye:
            d.polygon([tuple(p) for p in e["poly"]], outline=(255, 0, 0))
            c = tuple(e["centre"])
            d.ellipse(
                [c[0] - e["radius"], c[1] - e["radius"],
                 c[0] + e["radius"], c[1] + e["radius"]],
                outline=(0, 0, 255),
                width=2,
            )
        full = np.array(dbg)
        crops = [eye_band_crop(full, e["poly"], e["sclera"]) for e in per_eye]
        cw = max(c.shape[1] for c in crops)
        rows = []
        for c in crops:
            pad = cw - c.shape[1]
            rows.append(
                np.pad(c, ((0, 0), (0, pad), (0, 0)), mode="constant")
            )
        strip = np.concatenate(rows, axis=0)
        if strip.shape[1] < w:
            strip = np.pad(
                strip, ((0, 0), (0, w - strip.shape[1]), (0, 0)), mode="constant"
            )
        else:
            strip = strip[:, :w]
        sheet = np.concatenate([full, strip], axis=0)
        Image.fromarray(sheet).save(debug)
        out["debug"] = os.path.abspath(debug)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--id", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--debug", default=None)
    args = ap.parse_args()
    try:
        out = measure_image(args.image, args.id, args.debug)
    except RefusalError as e:
        err = {
            "image": os.path.abspath(args.image),
            "idImage": os.path.abspath(args.id) if args.id else None,
            "error": f"REFUSED: {e}",
        }
        text = json.dumps(err, indent=1)
        if args.out:
            with open(args.out, "w") as f:
                f.write(text + "\n")
        print(text)
        sys.exit(2)
    text = json.dumps(out, indent=1)
    if args.out:
        with open(args.out, "w") as f:
            f.write(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
