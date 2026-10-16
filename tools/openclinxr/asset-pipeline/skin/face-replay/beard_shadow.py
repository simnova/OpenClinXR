"""Beard-shadow skin layer for the face-replay chain (after socket).

Male beard shadow (dark stipple on upper lip, chin, jaw): the mask
derives ONLY from the subject derive outputs (landmarks-uv.json plus
mask-lips.png and mask-facecore.png). The treatment is a seeded
deterministic stipple (follicle-sized dots) plus a low-band
darken/desaturate, both scaled by one weight. Weight 0 returns a byte
copy (identity by construction, as skin_layers.apply_layers does).
Texels outside the hard beard mask are bit-exact.

Mask: facecore texels below a landmark-derived top edge, outside the
dilated lips mask, bounded laterally by the ear-attach landmarks and
past the chin by a short jaw margin. The top edge is the nostril line
at the centre, rising outward along the nose-wing to mouth-corner line
(constant-projection edges drift up the face at the island sides: a
flat nostril line rendered onto under-eye skin in the green-paint
probe, so the edge follows anatomy instead). Every size is in mm via
the mesh texel density; every mm value is sourced below.

Anatomy sources (all spatial constants in mm):
- TEXEL density: sqrt(sum UV-texel area / sum 3D mm area) over
  facecore-gated skin faces, the skin_layers.py method; body2 measured
  4.079 texels/mm at albedo size (S/beard/RESULT.md).
- STIPPLE_R_MM 0.25: beard shaft mean diameter ~0.125 mm (Caucasian
  beard mean 125.6 um, ~1.83x scalp, SCC comparative study Table I);
  the visible stubble dot (shaft plus root shadow) is modelled at twice
  the shaft diameter. Per-dot radius jitter keeps dots from gridding.
- BASE_DENSITY 0.65/mm2 (65/cm2, mid chin 45-80 FU/cm2) and zone total
  1.50/mm2 (150/cm2, mustache central 150-160 FU/cm2), Dua facial-hair
  transplantation review; consistent with 20-80 follicles/cm2 across
  facial areas (Elsner/Wiley beard review).
- FEATHER_MM 1.5: derive.py lips feather sigma 6 texels, ~1.5 mm at the
  measured body2 density.
- LOW_SIGMA_MM 12.0: fix_sym.py low band sigma 48 texels, ~12 mm.
- LIPS_EXCLUDE_MM 2.0: clears the vermilion plus the lip-mask soft edge.
- Top edge: nostril line at the centre, rising outward with the slope
  from the nose wing (nostril landmarks) to the mouth corner (outer
  15% of the lips mask); below the lip line the jaw curtain hangs full
  ear width, so jaw and low sideburns are kept while under-eye drift
  is cut. Sideburns above lip level stay untreated (recorded limit).
- MUSTACHE_ZONE_MM 22.0: dense mustache band above the lips (higher on
  the upper edge/philtrum, Dua review). Measured body2 distance-to-lips:
  upper lip 7.7 mm, philtrum mid 19.4 mm, philtrum top 28.8 mm, cheeks
  34+ mm, jaw 27.7 mm, chin 36.8 mm (S/beard/RESULT.md); 22 mm covers
  the philtrum while cheeks/jaw/chin stay at base density. LIP_TOP_TOL_MM
  2.0 keeps the zone above the lip line (goatee stays base).
- CHIN_BEYOND_MM 10.0: beard continues past the chin point onto the jaw
  (goal shows jaw stipple); the facecore mask bounds it anyway.
- LOW deltas (L -8, a -2.5, b -1.0 at weight 1): measured need is chin
  dL -8.2 and upper-lip dL -15.4 (low band -8 plus the denser mustache
  stipple mean near -7), S/beard/RESULT.md. The mustache zone carries
  ZONE_BOOST_L 1.0 extra L darkening (zone ~2x: mustache central
  150-160 vs chin 45-80 FU/cm2, Dua review); chroma is not boosted
  (dense hair darkens first, desaturation saturates).
- STIPPLE_DEPTH 26: terminal hair surface near L 20-30 against skin
  near L 55-65; STIPPLE_R_MM 0.32 keeps dots visible after the render
  downsample (dot near 0.6 mm across with its root shadow).
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from fix_lips import lab_to_rgb, rgb_to_lab  # noqa: E402

SEED_DEFAULT = 11
STIPPLE_R_MM = 0.32
BASE_DENSITY_PER_MM2 = 0.65
EXTRA_DENSITY_PER_MM2 = 0.85
FEATHER_MM = 1.5
LOW_SIGMA_MM = 12.0
LIPS_EXCLUDE_MM = 2.0
MUSTACHE_ZONE_MM = 22.0
LIP_TOP_TOL_MM = 2.0
CHIN_BEYOND_MM = 10.0
ZONE_BOOST_L = 1.0
LOW_DARKEN_L = -8.0
LOW_SHIFT_A = -2.5
LOW_SHIFT_B = -1.0
STIPPLE_DEPTH = 26.0
STIPPLE_DESAT = 1.0

NEEDED_LANDMARKS = ("nose-tip", "nostril-L", "nostril-R", "chin",
                    "ear-attach-L", "ear-attach-R")


def gauss(img: np.ndarray, sigma: float) -> np.ndarray:
    return cv2.GaussianBlur(img, (0, 0), sigma)


def dilate(bin_img: np.ndarray, radius_tex: float) -> np.ndarray:
    r = max(int(round(radius_tex)), 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.dilate(bin_img, kernel) > 0


def load_mask(path: Path, shape: tuple[int, int]) -> np.ndarray:
    m = np.asarray(Image.open(path).convert("L"), dtype=np.float64) / 255.0
    if m.shape != shape:
        m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize(
            (shape[1], shape[0]), Image.BILINEAR), dtype=np.float64) / 255.0
    return m


def build_beard_mask(facecore: np.ndarray, lips: np.ndarray,
                     landmarks: dict, tpm: float) -> dict:
    size = float(landmarks["size"])
    h, w = facecore.shape
    pts: dict[str, np.ndarray] = {}
    missing = [k for k in NEEDED_LANDMARKS if k not in landmarks["landmarks"]]
    if missing:
        raise RuntimeError("beard_shadow refuses: landmarks missing: %s" % ",".join(missing))
    for k in NEEDED_LANDMARKS:
        u, v = landmarks["landmarks"][k]["uv_texel"]
        pts[k] = np.array([float(u) / size * w, float(v) / size * h])
    nose, chin = pts["nose-tip"], pts["chin"]
    d = chin - nose
    n = float(np.linalg.norm(d))
    if n < 1e-6:
        raise RuntimeError("beard_shadow refuses: nose-tip==chin")
    d = d / n
    perp = np.array([-d[1], d[0]])
    p0 = (pts["nostril-L"] + pts["nostril-R"]) / 2.0
    rr, cc = np.mgrid[0:h, 0:w].astype(np.float64)
    proj = (cc - p0[0]) * d[0] + (rr - p0[1]) * d[1]
    lat = (cc - p0[0]) * perp[0] + (rr - p0[1]) * perp[1]
    ear_half = max(float(abs(((pts["ear-attach-L"] - p0) * perp).sum())),
                   float(abs(((pts["ear-attach-R"] - p0) * perp).sum())))
    chin_proj = float(((chin - p0) * d).sum())
    lips_bin = (lips > 0.5).astype(np.uint8)
    if not lips_bin.any():
        raise RuntimeError("beard_shadow refuses: lips mask is empty")
    lips_excl = dilate(lips_bin, LIPS_EXCLUDE_MM * tpm)
    lip_top = float(proj[lips_bin > 0].min())
    lip_half = float(np.abs(lat[lips_bin > 0]).max())
    nostril_lat = float((abs(((pts["nostril-L"] - p0) * perp).sum())
                          + abs(((pts["nostril-R"] - p0) * perp).sum())) / 2.0)
    outer = (lips_bin > 0) & (np.abs(lat) >= 0.85 * lip_half)
    corner_top = float(proj[outer].min()) if outer.any() else lip_top
    run = lip_half - nostril_lat
    slope = max(corner_top / run, 0.0) if run > 1.0 else 0.0
    rise = slope * np.clip(np.abs(lat) - nostril_lat, 0, None)
    # Above the lip line the steep nose-to-mouth-corner rise cuts the
    # island-side drift; below it the jaw curtain hangs full width.
    below_lips = proj > lip_top + LIP_TOP_TOL_MM * tpm
    lat_ok = np.abs(lat) <= ear_half
    hard = ((facecore > 0.5) & (below_lips | (proj > rise)) & lat_ok
            & (proj <= chin_proj + CHIN_BEYOND_MM * tpm) & (~lips_excl))
    dist_lips = cv2.distanceTransform((1 - lips_bin).astype(np.uint8),
                                      cv2.DIST_L2, 3).astype(np.float64)
    zone = (hard & (proj <= lip_top + LIP_TOP_TOL_MM * tpm)
            & (dist_lips <= MUSTACHE_ZONE_MM * tpm))
    soft = gauss(hard.astype(np.float32), FEATHER_MM * tpm).astype(np.float64)
    soft = soft * hard
    return {"hard": hard, "soft": soft, "zone": zone,
            "area_mm2": float(hard.sum()) / tpm / tpm,
            "zone_mm2": float(zone.sum()) / tpm / tpm}


def stipple_centres(mask: np.ndarray, count: int,
                    rng: np.random.Generator) -> np.ndarray:
    ys, xs = np.where(mask)
    if count <= 0 or len(xs) == 0:
        return np.zeros((0, 2), np.float64)
    take = min(count, len(xs))
    idx = rng.choice(len(xs), size=take, replace=False)
    jx = rng.uniform(-0.5, 0.5, size=take)
    jy = rng.uniform(-0.5, 0.5, size=take)
    return np.stack([xs[idx] + jx, ys[idx] + jy], axis=1)


def apply_stipple(lab: np.ndarray, hard: np.ndarray,
                  centres: np.ndarray, radii: np.ndarray,
                  weight: float) -> None:
    h, w = hard.shape
    for (cx, cy), r in zip(centres.tolist(), radii.tolist()):
        ext = int(np.ceil(1.6 * r)) + 1
        x0, x1 = max(0, int(np.floor(cx - ext))), min(w, int(np.ceil(cx + ext)) + 1)
        y0, y1 = max(0, int(np.floor(cy - ext))), min(h, int(np.ceil(cy + ext)) + 1)
        if x0 >= x1 or y0 >= y1:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float64)
        a = np.exp(-2.0 * (((xx - cx) / r) ** 2 + ((yy - cy) / r) ** 2))
        a[a < 0.05] = 0.0
        a = a * hard[y0:y1, x0:x1]
        if not a.any():
            continue
        lab[y0:y1, x0:x1, 0] -= weight * STIPPLE_DEPTH * a
        lab[y0:y1, x0:x1, 1] -= weight * STIPPLE_DESAT * a
        lab[y0:y1, x0:x1, 2] -= weight * STIPPLE_DESAT * a


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Beard-shadow skin layer")
    ap.add_argument("albedo_in", type=Path)
    ap.add_argument("albedo_out", type=Path)
    ap.add_argument("--landmarks", type=Path, required=True)
    ap.add_argument("--lips-mask", type=Path, required=True)
    ap.add_argument("--facecore-mask", type=Path, required=True)
    ap.add_argument("--weight", type=float, default=0.0)
    ap.add_argument("--seed", type=int, default=SEED_DEFAULT)
    ap.add_argument("--texels-per-mm", type=float, required=True)
    ap.add_argument("--mask-out", type=Path, default=None)
    ap.add_argument("--report-out", type=Path, default=None)
    ap.add_argument("--paint-mask", action="store_true")
    a = ap.parse_args(argv)
    w = float(a.weight)
    tpm = float(a.texels_per_mm)
    if not tpm > 0:
        raise RuntimeError("beard_shadow refuses: texels-per-mm must be positive")

    alb = np.array(Image.open(a.albedo_in).convert("RGB"))
    h, wpx = alb.shape[:2]
    facecore = load_mask(a.facecore_mask, (h, wpx))
    lips = load_mask(a.lips_mask, (h, wpx))
    with open(a.landmarks) as f:
        landmarks = json.load(f)

    if w == 0.0 and not a.paint_mask:
        # Identity by construction (fix_lips.py ratio-1.0 pattern): a PIL
        # re-encode would drop PNG metadata and change the sha.
        shutil.copyfile(a.albedo_in, a.albedo_out)
        print("beard_shadow: weight=0 no-op, copied %s" % a.albedo_out, flush=True)
        return 0

    parts = build_beard_mask(facecore, lips, landmarks, tpm)
    hard, soft, zone = parts["hard"], parts["soft"], parts["zone"]
    if a.mask_out is not None:
        Image.fromarray((hard * 255).astype(np.uint8)).save(a.mask_out)

    if a.paint_mask:
        green = alb.copy()
        green[hard] = (0, 255, 0)
        Image.fromarray(green).save(a.albedo_out)
        print("beard_shadow: painted mask texels=%d wrote %s"
              % (int(hard.sum()), a.albedo_out), flush=True)
    else:
        lab = rgb_to_lab(alb)
        zoneprox = gauss(zone.astype(np.float32), FEATHER_MM * tpm)
        zoneprox = np.clip(zoneprox, 0, None)
        if float(zoneprox.max()) > 0:
            zoneprox = zoneprox / float(zoneprox.max())
        field_L = soft * (1.0 + ZONE_BOOST_L * zoneprox)
        low_L = gauss(field_L.astype(np.float32), LOW_SIGMA_MM * tpm)
        low_ab = gauss(soft.astype(np.float32), LOW_SIGMA_MM * tpm)
        low_L = np.clip(low_L, 0, None) * hard
        low_ab = np.clip(low_ab, 0, None) * hard
        lab[..., 0] += w * LOW_DARKEN_L * low_L
        lab[..., 1] += w * LOW_SHIFT_A * low_ab
        lab[..., 2] += w * LOW_SHIFT_B * low_ab
        rng = np.random.default_rng(int(a.seed))
        n_base = int(round(BASE_DENSITY_PER_MM2 * parts["area_mm2"]))
        n_extra = int(round(EXTRA_DENSITY_PER_MM2 * parts["zone_mm2"]))
        centres = np.vstack([stipple_centres(hard, n_base, rng),
                             stipple_centres(zone, n_extra, rng)])
        radii = STIPPLE_R_MM * tpm * np.exp(0.2 * rng.standard_normal(len(centres)))
        radii = np.clip(radii, 0.6, None)
        apply_stipple(lab, hard, centres, radii, w)
        lab[..., 0] = np.clip(lab[..., 0], 0, 100)
        out = lab_to_rgb(lab)
        # Bit-exact outside the hard mask: the stage changes only texels
        # inside its derived mask.
        out[~hard] = alb[~hard]
        Image.fromarray(out).save(a.albedo_out)
        print("beard_shadow: weight=%s mask=%d zone=%d dots=%d wrote %s"
              % (a.weight, int(hard.sum()), int(zone.sum()),
                 len(centres), a.albedo_out), flush=True)

    if a.report_out is not None:
        with open(a.report_out, "w") as f:
            json.dump({"size": [h, wpx], "texels_per_mm": tpm,
                       "seed": int(a.seed), "weight": float(a.weight),
                       "mask_px": int(hard.sum()),
                       "area_mm2": round(parts["area_mm2"], 1),
                       "zone_mm2": round(parts["zone_mm2"], 1),
                       "mask_frac": round(float(hard.mean()), 6)}, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
