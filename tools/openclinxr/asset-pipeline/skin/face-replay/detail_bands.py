"""Detail-band skin layer for face-replay (after beard_shadow).

Reshapes albedo detail by frequency band, generic and case-driven (no
subject names or literals anywhere in this file; per-case amounts live in
chain-manifest.json subject overrides, solved per case against that case's
goal photo under the corrected G1: POST closer to goal than PRE in log
ratio AND past the midpoint toward the goal; overshooting the goal by
more than the PRE gap fails).

- crease_gain g in [0, 1]: the crease band B = G(s_pore) - G(s_crease) of
  Lab L is removed by fixed-point iteration (work -= B(work), N_ITER 4:
  one DoG subtraction is not a projection, so the total removal is
  iterated to convergence) and scaled by g inside the gated facecore.
  s_crease = CREASE_SMOOTH_MM * texels_per_mm isolates fold-scale albedo
  variation (forehead-fold spacing ~8-15 mm); s_pore = PORE_SMOOTH_MM *
  texels_per_mm keeps fine grain out of the attenuated band. The
  iteration runs on the whole albedo; the gate blends the result.
- pore_gain p in Lab L units: ADDS darkening-only pore structure (pores
  are small dark pits; there are no bright pores). Seeded deterministic
  soft small-gaussian pits (same splat shape as beard_shadow, sign always
  negative) at PORE_D_MM diameter and PORE_DENSITY_PER_MM2, plus a fine
  sub-pore grain octave (SUB_D_MM, SUB_DENSITY_PER_MM2, SUB_AMP_FRAC of
  the main-octave amplitude); no amplified noise and no tiled patch. The
  COMBINED darkening field is demeaned over the support (uniform lift =
  -field mean, recorded as lift_L): the stage preserves the facecore L
  mean exactly (tone-neutral by construction; the lift is structureless
  DC, invisible to every band gate), while every LOCAL excursion stays
  darkening-only. The COMBINED darkening field is normalised to RMS 1
  over the support, so p is the added L RMS. Dot diameter in texels via the mesh texel density
  (texels_per_mm; measured 4.079 tex/mm at 4096, beard_shadow.py); dot
  diameter/density sourced from Flament et al. 2015 (visible facial skin
  pores 250-500 um, cheek density 10-90/cm2; defaults 0.3 mm and
  0.8/mm2 sit inside those ranges at small-dot size so individual pores
  barely resolve at portrait distance).

Scales (all in mm via texels_per_mm, never in texels):
- CREASE_SMOOTH_MM 3.0: crease-band upper gaussian; forehead folds span
  ~8-15 mm, so 3 mm keeps fold energy inside the removed band.
- PORE_SMOOTH_MM 0.35: crease-band lower gaussian; fine grain below
  ~2 mm stays in the high band the attenuator spares.
- PORE_D_MM 0.3 / PORE_DENSITY_PER_MM2 0.8: Flament et al., Clin Cosmet
  Investig Dermatol 2015 (multiethnic cheek dermoscopy, n=2585): visible
  skin pores 250-500 um (detection threshold 250 um), cheek density
  10-90/cm2 = 0.1-0.9/mm2. Handback 1: individual pores should barely
  resolve, so the lower end of the cited size range at the top of the
  cited density range.
- SUB_D_MM 0.15 / SUB_DENSITY_PER_MM2 3.2 / SUB_AMP_FRAC 0.5:
  operator/consult decision: sub-pore grain octave at half the cited pore
  size, denser, half amplitude (fine micro-texture under the pits).
- SEED 11: fixed seed, seeded default_rng stream (operator/consult
  decision, same convention as beard_shadow).
- FEATHER_MM 1.0: gate feather (operator/consult decision: between the
  fix_lips 6-texel feather and the beard 3.0 mm outer fade). The pore
  field covers the whole face skin region (facecore minus lips/eyes/
  brows); dot centres sit inside the hard mask eroded by (pore radius +
  feather) so no dot crosses the support edge, and the gate fades the
  field smoothly: no hard boundary by construction.
- N_ITER 4: fixed-point crease-removal iterations (bit-deterministic).

Identity: crease_gain 0 + pore_gain 0 returns a byte copy (shutil,
fix_lips ratio-1.0 pattern). Texels outside the dilated support are
bit-exact.
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

from fix_lips import lab_to_rgb, rgb_to_lab  # noqa: E402

SEED_DEFAULT = 11
CREASE_SMOOTH_MM = 3.0
PORE_SMOOTH_MM = 0.35
PORE_D_MM = 0.3
PORE_DENSITY_PER_MM2 = 0.8
SUB_D_MM = 0.15
SUB_DENSITY_PER_MM2 = 3.2
SUB_AMP_FRAC = 0.5
FEATHER_MM = 1.0


def gauss(img: np.ndarray, sigma: float) -> np.ndarray:
    return cv2.GaussianBlur(img, (0, 0), sigma)


def load_mask(path: Path, shape: tuple[int, int]) -> np.ndarray:
    m = np.asarray(Image.open(path).convert("L"), dtype=np.float64) / 255.0
    if m.shape != shape:
        m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize(
            (shape[1], shape[0]), Image.BILINEAR), dtype=np.float64) / 255.0
    return m


def splat_dots(shape, centres, radii):
    """Darkening-only gaussian pits (soft small-gaussian profile)."""
    h, w = shape
    field = np.zeros((h, w), dtype=np.float64)
    for (qx, qy), r in zip(centres.tolist(), radii.tolist()):
        ext = int(np.ceil(1.6 * r)) + 1
        x0, x1 = max(0, int(np.floor(qx - ext))), min(w, int(np.ceil(qx + ext)) + 1)
        y0, y1 = max(0, int(np.floor(qy - ext))), min(h, int(np.ceil(qy + ext)) + 1)
        if x0 >= x1 or y0 >= y1:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float64)
        dot = np.exp(-2.0 * (((xx - qx) / r) ** 2 + ((yy - qy) / r) ** 2))
        dot[dot < 0.05] = 0.0
        field[y0:y1, x0:x1] -= dot
    return field


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Detail-band skin layer")
    ap.add_argument("albedo_in", type=Path)
    ap.add_argument("albedo_out", type=Path)
    ap.add_argument("--facecore-mask", type=Path, required=True)
    ap.add_argument("--lips-mask", type=Path, default=None)
    ap.add_argument("--eyes-mask", type=Path, default=None)
    ap.add_argument("--brows-mask", type=Path, default=None)
    ap.add_argument("--crease-gain", type=float, default=0.0)
    ap.add_argument("--pore-gain", type=float, default=0.0)
    ap.add_argument("--seed", type=int, default=SEED_DEFAULT)
    ap.add_argument("--texels-per-mm", type=float, required=True)
    ap.add_argument("--pore-d-mm", type=float, default=PORE_D_MM)
    ap.add_argument("--pore-density-per-mm2", type=float,
                    default=PORE_DENSITY_PER_MM2)
    ap.add_argument("--pore-sub-d-mm", type=float, default=SUB_D_MM)
    ap.add_argument("--pore-sub-density-per-mm2", type=float,
                    default=SUB_DENSITY_PER_MM2)
    ap.add_argument("--pore-sub-amp-frac", type=float, default=SUB_AMP_FRAC)
    ap.add_argument("--feather-mm", type=float, default=FEATHER_MM)
    ap.add_argument("--report-out", type=Path, default=None)
    a = ap.parse_args(argv)
    g = float(a.crease_gain)
    p = float(a.pore_gain)
    tpm = float(a.texels_per_mm)
    if not tpm > 0:
        raise RuntimeError("detail_bands refuses: texels-per-mm must be positive")
    if not 0.0 <= g <= 1.0:
        raise RuntimeError("detail_bands refuses: crease-gain must be in [0,1]")

    alb = np.array(Image.open(a.albedo_in).convert("RGB"))
    h, wpx = alb.shape[:2]
    hard = load_mask(a.facecore_mask, (h, wpx)) > 0.5
    for opt in (a.lips_mask, a.eyes_mask, a.brows_mask):
        if opt is not None:
            hard = hard & ~(load_mask(opt, (h, wpx)) > 0.5)

    if g == 0.0 and p == 0.0:
        # Identity by construction (fix_lips ratio-1.0 pattern): a PIL
        # re-encode would drop PNG metadata and change the sha.
        shutil.copyfile(a.albedo_in, a.albedo_out)
        print("detail_bands: zero gains no-op, copied %s" % a.albedo_out, flush=True)
        return 0

    feather_tex = max(float(a.feather_mm) * tpm, 1.0)
    gate = gauss(hard.astype(np.float32), feather_tex)
    if float(gate.max()) > 0:
        gate = gate / float(gate.max())
    support = cv2.dilate(hard.astype(np.uint8),
                         np.ones((2 * int(round(feather_tex)) + 1,
                                  2 * int(round(feather_tex)) + 1), np.uint8)) > 0

    lab = rgb_to_lab(alb)
    lum = lab[..., 0].astype(np.float64)
    s_pore = PORE_SMOOTH_MM * tpm
    s_crease = CREASE_SMOOTH_MM * tpm
    # Converged band removal (N_ITER fixed, bit-deterministic): one DoG
    # subtraction is not a projection (re-measuring the band leaves
    # G(s_crease)-shaped leakage ~0.3 of a sine), so iterate
    # work -= band(work) to convergence, then scale the TOTAL removal by
    # g. g = 1 removes the band, g = 0.5 removes exactly half of it.
    N_ITER = 4
    work = lum.copy()
    removed = np.zeros_like(lum)
    for _ in range(N_ITER):
        b = gauss(work, s_pore) - gauss(work, s_crease)
        work = work - b
        removed = removed + b
    shaped = lum - g * removed
    added_rms = 0.0
    n_dots = 0
    lift_L = 0.0
    field = np.zeros_like(lum)
    if p != 0.0:
        # Dot centres inside the hard mask eroded by (dot radius +
        # feather): no dot crosses the support edge, and the gate fades
        # the field smoothly (no hard boundary by construction).
        margin_tex = int(round((float(a.pore_d_mm) / 2.0 + float(a.feather_mm)) * tpm))
        core = cv2.erode(hard.astype(np.uint8),
                         np.ones((2 * margin_tex + 1, 2 * margin_tex + 1),
                                 np.uint8)) > 0
        if not core.any():
            raise RuntimeError("detail_bands refuses: eroded pore core is empty")
        area_mm2 = float(core.sum()) / tpm / tpm
        rng = np.random.default_rng(int(a.seed))
        field = np.zeros_like(lum)
        for d_mm, dens, amp in ((float(a.pore_d_mm), float(a.pore_density_per_mm2), 1.0),
                               (float(a.pore_sub_d_mm),
                                float(a.pore_sub_density_per_mm2),
                                float(a.pore_sub_amp_frac))):
            n = int(round(dens * area_mm2))
            ys, xs = np.where(core)
            if n <= 0 or not len(xs):
                continue
            take = min(n, len(xs))
            idx = rng.choice(len(xs), size=take, replace=False)
            cx = xs[idx].astype(np.float64) + rng.uniform(-0.5, 0.5, size=take)
            cy = ys[idx].astype(np.float64) + rng.uniform(-0.5, 0.5, size=take)
            rad = (d_mm / 2.0) * tpm * np.exp(0.2 * rng.standard_normal(take))
            rad = np.clip(rad, 0.2, None)
            field = field + amp * splat_dots((h, wpx),
                                             np.stack([cx, cy], axis=1), rad)
            n_dots += take
    rms = float(np.sqrt((field[support] ** 2).mean())) if support.sum() and p != 0.0 else 0.0
    if rms > 0:
        field = field / rms
        # Mean-preserving pore texture: demean over the support so the
        # facecore L mean (and every tone-gate region mean) is unchanged
        # by construction; local excursions stay darkening-only.
        lift_L = float(-field[support].mean())
        field = field + lift_L
        added_rms = float(np.sqrt((field[support] ** 2).mean()))
        shaped = shaped + p * field * gate
    lab[..., 0] = np.clip(gate * shaped + (1.0 - gate) * lum, 0, 100)
    out = lab_to_rgb(lab)
    # Bit-exact outside the dilated support: the stage changes only
    # texels inside its derived mask plus the small restore margin.
    out[~support] = alb[~support]
    Image.fromarray(out).save(a.albedo_out)
    print("detail_bands: crease-gain=%s pore-gain=%s dots=%d wrote %s"
          % (a.crease_gain, a.pore_gain, n_dots, a.albedo_out), flush=True)
    if a.report_out is not None:
        with open(a.report_out, "w") as f:
            json.dump({"size": [h, wpx], "texels_per_mm": tpm,
                       "seed": int(a.seed), "crease_gain": g,
                       "pore_gain": p, "pore_d_mm": float(a.pore_d_mm),
                       "pore_density_per_mm2": float(a.pore_density_per_mm2),
                       "pore_sub_d_mm": float(a.pore_sub_d_mm),
                       "pore_sub_density_per_mm2": float(a.pore_sub_density_per_mm2),
                       "pore_sub_amp_frac": float(a.pore_sub_amp_frac),
                       "feather_mm": float(a.feather_mm),
                       "lift_L": lift_L,
                       "dots": n_dots, "added_rms": added_rms,
                       "support_px": int(support.sum())}, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
