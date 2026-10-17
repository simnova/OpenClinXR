"""Detail-band skin layer for the face-replay chain (after beard_shadow).

Reshapes albedo detail by frequency band, generic and case-driven (no
subject names or literals anywhere in this file; per-case amounts live in
chain-manifest.json subject overrides, solved per case against that case's
goal photo):

- crease_gain g in [0, 1]: the crease band B = G(s_pore) - G(s_crease) of
  Lab L is removed by fixed-point iteration (work -= B(work), N_ITER 4:
  one DoG subtraction is not a projection, so the total removal is
  iterated to convergence) and scaled by g inside the gated facecore.
  s_crease = CREASE_SMOOTH_MM * texels_per_mm isolates fold-scale albedo
  variation (forehead-fold spacing ~8-15 mm); s_pore = PORE_SMOOTH_MM *
  texels_per_mm keeps fine grain out of the attenuated band. The
  iteration runs on the whole albedo; the gate blends the result.
- pore_gain p in Lab L units: ADDS real pore-scale structure, not
  amplified noise and not a tiled patch: seeded deterministic gaussian
  splats (same splat shape as beard_shadow.apply_stipple) at PORE_D_MM
  diameter and PORE_DENSITY_PER_MM2, random sign per dot (pits and rims),
  normalised to RMS 1 over the support so p is the added L RMS. Dot size
  in texels via the mesh texel density (texels_per_mm; measured
  4.079 tex/mm at 4096, beard_shadow.py); dot diameter/density sourced
  from Flament et al. 2015 (visible facial skin pores 250-500 um, cheek
  density 10-90/cm2; defaults 0.5 mm and 0.5/mm2 sit at the top/middle of
  those ranges so the render projection lands in the measured pore band).

Scales (all in mm via texels_per_mm, never in texels):
- CREASE_SMOOTH_MM 3.0: crease-band upper gaussian; forehead folds span
  ~8-15 mm, so 3 mm keeps fold energy inside the removed band.
- PORE_SMOOTH_MM 0.35: crease-band lower gaussian; fine grain below
  ~2 mm stays in the high band the attenuator spares.
- PORE_D_MM 0.5 / PORE_DENSITY_PER_MM2 0.5: Flament et al., Clin Cosmet
  Investig Dermatol 2015 (multiethnic cheek dermoscopy, n=2585): visible
  skin pores 250-500 um (detection threshold 250 um), cheek density
  10-90/cm2 = 0.1-0.9/mm2.
- SEED 11: fixed seed, seeded default_rng stream (operator/consult
  decision, same convention as beard_shadow).
- FEATHER_TEX 2.0 / SUPPORT_DILATE_TEX 6: gate feather and bit-exact
  restore margin (same order as fix_lips feather 6 / beard support fade).

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
PORE_D_MM = 0.5
PORE_DENSITY_PER_MM2 = 0.5
FEATHER_TEX = 2.0
SUPPORT_DILATE_TEX = 6


def gauss(img: np.ndarray, sigma: float) -> np.ndarray:
    return cv2.GaussianBlur(img, (0, 0), sigma)


def load_mask(path: Path, shape: tuple[int, int]) -> np.ndarray:
    m = np.asarray(Image.open(path).convert("L"), dtype=np.float64) / 255.0
    if m.shape != shape:
        m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize(
            (shape[1], shape[0]), Image.BILINEAR), dtype=np.float64) / 255.0
    return m


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Detail-band skin layer")
    ap.add_argument("albedo_in", type=Path)
    ap.add_argument("albedo_out", type=Path)
    ap.add_argument("--facecore-mask", type=Path, required=True)
    ap.add_argument("--lips-mask", type=Path, default=None)
    ap.add_argument("--eyes-mask", type=Path, default=None)
    ap.add_argument("--crease-gain", type=float, default=0.0)
    ap.add_argument("--pore-gain", type=float, default=0.0)
    ap.add_argument("--seed", type=int, default=SEED_DEFAULT)
    ap.add_argument("--texels-per-mm", type=float, required=True)
    ap.add_argument("--pore-d-mm", type=float, default=PORE_D_MM)
    ap.add_argument("--pore-density-per-mm2", type=float,
                    default=PORE_DENSITY_PER_MM2)
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
    facecore = load_mask(a.facecore_mask, (h, wpx))

    if g == 0.0 and p == 0.0:
        # Identity by construction (fix_lips ratio-1.0 pattern): a PIL
        # re-encode would drop PNG metadata and change the sha.
        shutil.copyfile(a.albedo_in, a.albedo_out)
        print("detail_bands: zero gains no-op, copied %s" % a.albedo_out, flush=True)
        return 0

    gate = gauss(facecore.astype(np.float32), FEATHER_TEX)
    if float(gate.max()) > 0:
        gate = gate / float(gate.max())
    support = cv2.dilate((facecore > 0.5).astype(np.uint8),
                         np.ones((2 * SUPPORT_DILATE_TEX + 1,
                                  2 * SUPPORT_DILATE_TEX + 1), np.uint8)) > 0
    for opt, name in ((a.lips_mask, "lips"), (a.eyes_mask, "eyes")):
        if opt is not None:
            excl = gauss(load_mask(opt, (h, wpx)).astype(np.float32), FEATHER_TEX)
            if float(excl.max()) > 0:
                excl = excl / float(excl.max())
            gate = gate * (1.0 - excl)
            support = support & ~(cv2.dilate(
                (load_mask(opt, (h, wpx)) > 0.5).astype(np.uint8),
                np.ones((2 * SUPPORT_DILATE_TEX + 1,
                         2 * SUPPORT_DILATE_TEX + 1), np.uint8)) > 0)

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
    if p != 0.0:
        area_mm2 = float(support.sum()) / tpm / tpm
        n = int(round(float(a.pore_density_per_mm2) * area_mm2))
        rng = np.random.default_rng(int(a.seed))
        ys, xs = np.where(support)
        field = np.zeros_like(lum)
        if n > 0 and len(xs):
            take = min(n, len(xs))
            idx = rng.choice(len(xs), size=take, replace=False)
            cx = xs[idx].astype(np.float64) + rng.uniform(-0.5, 0.5, size=take)
            cy = ys[idx].astype(np.float64) + rng.uniform(-0.5, 0.5, size=take)
            sign = np.where(rng.random(take) < 0.5, -1.0, 1.0)
            rad = (float(a.pore_d_mm) / 2.0) * tpm * np.exp(0.2 * rng.standard_normal(take))
            rad = np.clip(rad, 0.2, None)
            for qx, qy, sgn, r in zip(cx.tolist(), cy.tolist(),
                                      sign.tolist(), rad.tolist()):
                ext = int(np.ceil(1.6 * r)) + 1
                x0, x1 = max(0, int(np.floor(qx - ext))), min(wpx, int(np.ceil(qx + ext)) + 1)
                y0, y1 = max(0, int(np.floor(qy - ext))), min(h, int(np.ceil(qy + ext)) + 1)
                if x0 >= x1 or y0 >= y1:
                    continue
                yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float64)
                dot = np.exp(-2.0 * (((xx - qx) / r) ** 2 + ((yy - qy) / r) ** 2))
                dot[dot < 0.05] = 0.0
                field[y0:y1, x0:x1] += sgn * dot
            n_dots = take
        rms = float(np.sqrt((field[support] ** 2).mean())) if support.sum() else 0.0
        if rms > 0:
            field = field / rms
            added_rms = float(p)
            shaped = shaped + p * field
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
                       "dots": n_dots, "added_rms": added_rms,
                       "support_px": int(support.sum())}, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
