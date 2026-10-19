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
- pore_gain p in Lab L units: ADDS dense continuous low-contrast grain,
  darkening-biased (pores read as dark microstructure; there are no
  bright specks and no individually resolvable dots at portrait
  distance). Seeded deterministic white noise filtered to the instrument
  pore band (the same G(H/1500)-G(H/130) band as wrinkle_bands.py, in
  texels: low cut PORE_NOISE_LO_TEX 0.5 kills single-texel spikes, high
  cut PORE_NOISE_HI_MM * texels_per_mm sits at the instrument sigma_hi;
  the forehead measures ~2 tex/px at portrait scale: facecore island
  ~780 texels wide vs forehead screen patch ~300-400 px, so the hi-cut
  projects inside the render pore band; transfer measured, not assumed),
  then a dark-biased dense grain (asymmetric caps, no demean: the
  field keeps its natural near-zero mean so the floor stays uniform;
  dense low-contrast both sides like the goal micro-contrast, no sparse
  bright specks by construction), detrended at the crease scale and at
  patch scale (no fold-band refill, no support-scale or patch-scale
  swell), tone shift bounded (|support mean| <= 0.12 field-RMS units;
  G3 verifies no regressions) and normalised to RMS 1, so p is the
  added L RMS. No amplified noise (the band filter removes pixel spikes)
  and no tiled patch (seeded full-frame noise, no repetition).

Scales (all in mm via texels_per_mm, never in texels):
- CREASE_SMOOTH_MM 3.0: crease-band upper gaussian; forehead folds span
  ~8-15 mm, so 3 mm keeps fold energy inside the removed band.
- PORE_SMOOTH_MM 0.35: crease-band lower gaussian; fine grain below
  ~2 mm stays in the high band the attenuator spares.
- PORE_NOISE_HI_MM 1.4: noise high cut at the instrument pore-band
  sigma_hi (H/130 at portrait scale ~2 tex/px): keeps the grain below
  crease-band wavelengths so it cannot refill the removed folds.
  pore-scale-fine (card tsk_ca445c4e7f770eaf): this ONE generic
  parameter is the grain band's solved upper scale in mm (the added
  grain is white noise through G(PORE_NOISE_LO_TEX) - G(hi), so moving
  hi moves the grain's spectral peak; the lo cut and the filter form
  are untouched: no added white noise, no blur). Per-case values live
  in chain-manifest.json subject overrides; the stage refuses hi-mm at
  or above CREASE_SMOOTH_MM (grain must stay out of the fold band).
- PORE_DETREND_MM 12.0: second detrend scale (4x the crease smooth):
  kills patch-scale swells the one-sided mapping rectifies into the
  field (handback 3: a bin-1 render-FFT peak on the portrait re-render);
  ~8x above the grain band, so no pore-band energy is removed.
- CAP_POS 1.4 / CAP_NEG -3.0: asymmetric caps (dark extends 2x bright;
  operator/consult decision documented in wrinkle-scale-report.json
  fix.solve): dense low-contrast both sides like the goal
  micro-contrast (goal forehead: ~0.3-0.4 of texels beyond +-1 L each
  way); no sparse bright specks by construction (bright mass is dense,
  capped, and verified by the bright-fraction test).
- SEED 11: fixed seed, seeded default_rng stream (operator/consult
  decision, same convention as beard_shadow).
- FEATHER_MM 1.0: gate feather (operator/consult decision: between the
  fix_lips 6-texel feather and the beard 3.0 mm outer fade).
- LIPS_HUG_MM 0.5 / LIPS_FEATHER_MM 0.5: the grain meets the lips
  with no pale ring: vermilion-core hug + feather exactly like
  beard_shadow.py LIPS_EXCLUDE_MM/LIP_FEATHER_MM (handback 3: the
  derive lips mask carries ~3 mm of margin past the vermilion, measured
  subject albedo a* profile vs mask edge, so the lipuv hard_up|hard_lo
  vermilion core is hugged instead).
- UNDERLIP_MM 4.0: the band below the vermilion lower edge (B5 analog
  on the passed vermilion: central 60% of its columns, per-column lower
  edge +3..+18 texels, ~4 mm at 4.079 tex/mm) keeps only
  UNDERLIP_CREASE_KEEP of the crease removal at beard weight 0 (the
  ablation carries 97.5% of the B5 darkening in the crease term); the
  pore grain still applies fully there. Positive beard weights keep the
  legacy full-crease path (beard_shadow geometry then owns the groove).
- UNDERLIP_CREASE_KEEP 0.3: the keep fraction for the G3/halo
  frontier (measured on the run4 inputs and the synthetic G3 fixture:
  keep 0.6 leaves the fixture at -1.41 under the -1 gate, keep 0.3
  lands the fixture at -0.84 and real B5 at ~-0.4; lower keeps trade
  halo flips for fixture margin past this knee, higher keeps collapse
  the fixture margin toward zero).
- DARK_TEXEL_GUARD (lum 15..25 smoothstep): the converged crease
  removal fills small dark holes (nostril/mouth interiors brighten tens
  of L as the low-pass leaks skin into them: handback 5 blue-grey
  nostril specks). Texels darker than L25 keep the input (smooth
  value-space transition, no hard edge).
- SCALP_FRINGE_MM 25.0: the pore field covers all face and forehead skin
  up to the scalp boundary: facecore UNION the scalp-mask fringe within
  25 mm of the facecore (the forehead skin above the facecore top, below
  the hairline; handback 2: the facecore mask alone stops mid-forehead),
  minus lips/eyes/brows. The gate fades the field smoothly: no visible
  boundary anywhere by construction.
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
PORE_NOISE_HI_MM = 1.4
PORE_NOISE_LO_TEX = 0.5
PORE_DETREND_MM = 12.0
CAP_POS = 1.4
CAP_NEG = -3.0
FEATHER_MM = 1.0
LIPS_HUG_MM = 0.5
LIPS_FEATHER_MM = 0.5
UNDERLIP_MM = 4.0
UNDERLIP_CREASE_KEEP = 0.3
SCALP_FRINGE_MM = 25.0


def gauss(img: np.ndarray, sigma: float) -> np.ndarray:
    return cv2.GaussianBlur(img, (0, 0), sigma)


def load_mask(path: Path, shape: tuple[int, int]) -> np.ndarray:
    m = np.asarray(Image.open(path).convert("L"), dtype=np.float64) / 255.0
    if m.shape != shape:
        m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize(
            (shape[1], shape[0]), Image.BILINEAR), dtype=np.float64) / 255.0
    return m


def visible_lip_mask(albedo_rgb: np.ndarray, base_mask: np.ndarray) -> np.ndarray:
    """Visible lip from the albedo itself (lane-manager acceptance rule).

    base_mask is the derive lips mask; a texel is visible lip where its
    a* exceeds the surrounding skin a* (median over the ring 12-24 texels
    outside the mask) by at least HALF of (lip a* peak minus skin a*):
    the half-maximum edge (peak = 95th percentile inside the mask, no
    absolute threshold). Closed morphologically (3 iterations) and
    hole-filled (mouth opening stays excluded). No new constants beyond
    the half-max: ring/close/hole sizes are the acceptance rule's own.
    """
    from scipy import ndimage

    lab = rgb_to_lab(np.asarray(albedo_rgb, dtype=np.uint8))
    a = lab[..., 1].astype(np.float64)
    m = np.asarray(base_mask, dtype=bool)
    if not m.any():
        return m
    ring = ndimage.binary_dilation(m, iterations=24) & ~ndimage.binary_dilation(m, iterations=12)
    skin = float(np.median(a[ring])) if np.count_nonzero(ring) else 0.0
    peak = float(np.percentile(a[m], 95))
    raw = m & (a > skin + 0.5 * max(0.0, peak - skin))
    closed = ndimage.binary_closing(raw, iterations=3)
    return ndimage.binary_fill_holes(closed)


def vermilion_pre_hb8_mask(albedo_rgb: np.ndarray, union: np.ndarray) -> np.ndarray:
    """Pre-hb8 blurred-a* vermilion rule (the post10 lineage).

    Inside the union neighbourhood (dilate-21, past the derive mask
    edge), a texel is vermilion where its blurred a* (sigma 3.0) exceeds
    the surrounding skin a* (median over the wide ring dilate-49 minus
    dilate-25) by at least half of (lip a* max minus skin a*). Closed
    with a 7x7 square, smoothed with a 0.5 mm gaussian thresholded at
    0.5, hole-filled from the image corner, components under 200 texels
    dropped. No absolute threshold; stated numbers are per-image.
    """
    lab = rgb_to_lab(np.asarray(albedo_rgb, dtype=np.uint8))
    h, w = lab.shape[:2]
    av = cv2.GaussianBlur(lab[..., 1].astype(np.float64), (0, 0), 3.0)
    ring = (cv2.dilate(union.astype(np.uint8), np.ones((25, 25), np.uint8)) > 0) & (
        cv2.dilate(union.astype(np.uint8), np.ones((13, 13), np.uint8)) == 0)
    skin = float(np.median(av[ring])) if np.count_nonzero(ring) else 0.0
    near = cv2.dilate(union.astype(np.uint8), np.ones((21, 21), np.uint8)) > 0
    peak = float(av[union].max(initial=skin)) if np.count_nonzero(union) else skin
    thr = skin + 0.5 * max(0.0, peak - skin)
    raw = (av > thr) & near
    cl = cv2.morphologyEx(raw.astype(np.uint8), cv2.MORPH_CLOSE,
                          np.ones((7, 7), np.uint8))
    sm = cv2.GaussianBlur(cl.astype(np.float64), (0, 0), 4.079 * 0.5)
    keep = sm > 0.5
    ff = keep.astype(np.uint8).copy()
    pad = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(ff, pad, (0, 0), 1)
    filled = keep | (ff != 1)
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(filled.astype(np.uint8), 8)
    out = np.zeros(filled.shape, dtype=bool)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= 200:
            out[lbl == i] = True
    return out


def vermilion_mask_from_albedo(albedo_rgb: np.ndarray, union: np.ndarray) -> np.ndarray:
    """Vermilion from the albedo itself (handback 8, union rule).

    The union of the lane-manager half-maximum edge (visible_lip_mask,
    clipped to the derive lips mask) with the pre-hb8 blurred-a* rule
    (vermilion_pre_hb8_mask, neighbourhood past the derive edge). The
    rendered vermilion rim lies outside the derive mask (run4: all 2042
    post10-only rim texels sit outside it), so any rule clipped to the
    mask misses the rim by construction; the pre-hb8 rule re-run on
    run4 inputs reproduces the post10 mask to 20 px xor and covers
    2036/2042 of the rim. Falls back to the union when the union covers
    < 5% of the union (flat albedo, synthetic fixtures).
    """
    cur = visible_lip_mask(albedo_rgb, union)
    old = vermilion_pre_hb8_mask(albedo_rgb, union)
    out = cur | old
    if out.sum() < 0.05 * max(1, int(np.asarray(union).sum())):
        return np.asarray(union, dtype=bool)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Detail-band skin layer")
    ap.add_argument("albedo_in", type=Path)
    ap.add_argument("albedo_out", type=Path)
    ap.add_argument("--facecore-mask", type=Path, required=True)
    ap.add_argument("--scalp-mask", type=Path, default=None)
    ap.add_argument("--lips-mask", type=Path, default=None,
                    help="visible-lip mask (lane-manager acceptance rule on "
                         "the lips albedo, shared with beard_shadow.py): "
                         "grain hugs it with LIPS_HUG_MM + LIPS_FEATHER_MM")
    ap.add_argument("--eyes-mask", type=Path, default=None)
    ap.add_argument("--brows-mask", type=Path, default=None)
    ap.add_argument("--crease-gain", type=float, default=0.0)
    ap.add_argument("--pore-gain", type=float, default=0.0)
    ap.add_argument("--seed", type=int, default=SEED_DEFAULT)
    ap.add_argument("--texels-per-mm", type=float, required=True)
    ap.add_argument("--pore-noise-hi-mm", type=float, default=PORE_NOISE_HI_MM)
    ap.add_argument("--pore-detrend-mm", type=float, default=PORE_DETREND_MM)
    ap.add_argument("--feather-mm", type=float, default=FEATHER_MM)
    ap.add_argument("--lips-hug-mm", type=float, default=LIPS_HUG_MM)
    ap.add_argument("--lips-feather-mm", type=float, default=LIPS_FEATHER_MM)
    ap.add_argument("--beard-weight", type=float, default=0.0,
                    help="beard_shadow weight carried by replay: at 0 the "
                         "under-lower-lip band is spared the crease removal; "
                         "positive weights keep the legacy full-crease path")
    ap.add_argument("--scalp-fringe-mm", type=float, default=SCALP_FRINGE_MM)
    ap.add_argument("--report-out", type=Path, default=None)
    a = ap.parse_args(argv)
    g = float(a.crease_gain)
    p = float(a.pore_gain)
    tpm = float(a.texels_per_mm)
    if not tpm > 0:
        raise RuntimeError("detail_bands refuses: texels-per-mm must be positive")
    if not 0.0 <= g <= 1.0:
        raise RuntimeError("detail_bands refuses: crease-gain must be in [0,1]")
    w_beard = float(a.beard_weight)
    if w_beard < 0:
        raise RuntimeError("detail_bands refuses: beard-weight must be >= 0")
    hi_mm = float(a.pore_noise_hi_mm)
    if not 0.0 < hi_mm < CREASE_SMOOTH_MM:
        raise RuntimeError(
            "detail_bands refuses: pore-noise-hi-mm must lie below the "
            "crease smooth scale (the grain band stays out of the fold band)")

    alb = np.array(Image.open(a.albedo_in).convert("RGB"))
    h, wpx = alb.shape[:2]
    facecore = load_mask(a.facecore_mask, (h, wpx)) > 0.5
    if a.scalp_mask is not None:
        scalp = load_mask(a.scalp_mask, (h, wpx)) > 0.5
        fringe_r = int(round(float(a.scalp_fringe_mm) * tpm))
        near = cv2.dilate(facecore.astype(np.uint8),
                          np.ones((2 * fringe_r + 1, 2 * fringe_r + 1),
                                  np.uint8)) > 0
        hard = facecore | (scalp & near)
    else:
        hard = facecore
    for opt in (a.eyes_mask, a.brows_mask):
        if opt is not None:
            hard = hard & ~(load_mask(opt, (h, wpx)) > 0.5)
    # Lips (visible-lip hug, handback 8): the grain meets the lips with
    # no ring. The derive lips mask carries margin skin past the
    # vermilion, so the visible lip (half-maximum a* edge on the lips
    # albedo, passed as --lips-mask) is hugged with the beard_shadow
    # hug/feather (0.5 mm hug + 0.5 mm feather). The cut is a BOUNDED smoothstep over exactly
    # [hug, hug+feather] texels (a gaussian's tails would smear the
    # transition to ~3x the prescribed width, which is what read as a
    # halo).
    lips_cut = np.ones((h, wpx), dtype=np.float64)
    lips_support_extra = np.zeros((h, wpx), dtype=bool)
    verm = np.zeros((h, wpx), dtype=bool)
    if a.lips_mask is not None:
        hug_tex = max(float(a.lips_hug_mm) * tpm, 0.0)
        feather_tex = max(float(a.lips_feather_mm) * tpm, 0.5)
        verm = load_mask(a.lips_mask, (h, wpx)) > 0.5
        dist = cv2.distanceTransform((1 - verm.astype(np.uint8)),
                                     cv2.DIST_L2, 3)
        t = np.clip((dist - hug_tex) / feather_tex, 0.0, 1.0)
        cut = 1.0 - (t * t * (3.0 - 2.0 * t))
        lips_cut = 1.0 - cut
        lips_support_extra = dist <= (hug_tex + feather_tex)

    # Underlip band (groove floor on the passed vermilion, generic
    # anatomy): central 60% of vermilion columns, per-column lower edge
    # +3..+18 texels (the B5 rows; the legacy darkening over B5 sits at
    # rows 3-17 rel the union edge, peaking rows 9-15, while rows <=2
    # are already bit-exact inside the exclusion). At beard weight 0
    # the crease term there is scaled by UNDERLIP_CREASE_KEEP (the
    # defect ablation); the pore grain still applies fully. Positive
    # weights keep the legacy path.
    underlip = np.zeros((h, wpx), dtype=bool)
    if w_beard <= 0.0 and verm.any():
        uh = int(round(UNDERLIP_MM * tpm))
        ucols = np.where(verm.any(axis=0))[0]
        uc0, uc1 = int(ucols.min()), int(ucols.max())
        ucc0 = int(uc0 + 0.2 * (uc1 - uc0))
        ucc1 = int(uc1 - 0.2 * (uc1 - uc0))
        for x in range(ucc0, ucc1 + 1):
            rows = np.where(verm[:, int(x)])[0]
            if len(rows):
                lo = int(rows.max())
                underlip[lo + 3:min(h, lo + 3 + uh), int(x)] = True

    if g == 0.0 and p == 0.0:
        # Identity by construction (fix_lips ratio-1.0 pattern): a PIL
        # re-encode would drop PNG metadata and change the sha.
        shutil.copyfile(a.albedo_in, a.albedo_out)
        print("detail_bands: zero gains no-op, copied %s" % a.albedo_out, flush=True)
        return 0

    feather_tex = max(float(a.feather_mm) * tpm, 1.0)
    lum = rgb_to_lab(alb)[..., 0].astype(np.float64)
    gate = gauss(hard.astype(np.float32), feather_tex)
    if float(gate.max()) > 0:
        gate = gate / float(gate.max())
    gate = gate * lips_cut
    # Dark-texel guard (handback 5): the converged crease removal fills
    # small dark holes (nostril/mouth interiors brighten tens of L as the
    # low-pass leaks skin into them, then the demeaned field normalises
    # around them). The stage never brightens texels darker than
    # NOSTRIL_L: gate is multiplied by smoothstep((L-15)/10), so dark
    # interiors (and deep moles/eyeliner-class pigment) keep the input
    # byte path with a smooth value-space transition (no hard edge).
    dark_guard = np.clip((lum - 15.0) / 10.0, 0.0, 1.0)
    gate = gate * (dark_guard * dark_guard * (3.0 - 2.0 * dark_guard))
    dil_hard = (cv2.dilate(hard.astype(np.uint8),
                           np.ones((2 * int(round(feather_tex)) + 1,
                                    2 * int(round(feather_tex)) + 1), np.uint8)) > 0)
    # Normalisation support (lips-free by construction): the dilated hard
    # gate alone (facecore/scalp fringe minus eyes/brows: no lips term),
    # so the grain scale is identical for any lips mask. The restore
    # support keeps the lips ring for bit-exactness outside the field.
    norm_support = dil_hard
    support = dil_hard | lips_support_extra

    s_pore = PORE_SMOOTH_MM * tpm
    s_crease = CREASE_SMOOTH_MM * tpm
    # Converged band removal (N_ITER fixed, bit-deterministic): one DoG
    # subtraction is not a projection, so iterate work -= band(work) to
    # convergence, then scale the TOTAL removal by g. g = 1 removes the
    # band, g = 0.5 removes exactly half of it.
    N_ITER = 4
    work = lum.copy()
    removed = np.zeros_like(lum)
    for _ in range(N_ITER):
        b = gauss(work, s_pore) - gauss(work, s_crease)
        work = work - b
        removed = removed + b
    shaped = lum - g * removed
    added_rms = 0.0
    lift_L = 0.0
    if p != 0.0:
        # Dense dark-biased grain: seeded white noise filtered to the
        # instrument pore band (texels), detrended at the crease scale
        # (no fold-band refill) and at patch scale (no support-scale or
        # patch-scale swell), asymmetric caps (dark extends further than
        # bright): pits read deeper than the floor reads bright, dense
        # low-contrast both sides like the goal micro-contrast, no
        # sparse bright specks by construction. No demean: the clipped
        # field keeps its natural near-zero mean.
        rng = np.random.default_rng(int(a.seed))
        white = rng.standard_normal((h, wpx))
        s_hi = float(a.pore_noise_hi_mm) * tpm
        band = gauss(white, PORE_NOISE_LO_TEX) - gauss(white, s_hi)
        sd = float(band[norm_support].std()) if norm_support.sum() else 0.0
        field = np.zeros_like(lum)
        if sd > 0:
            field = band / sd
            # Detrend at the crease scale (no fold-band refill) and at
            # patch scale (no support-scale or patch-scale swell: handback
            # 3 flagged a bin-1 render-FFT peak from rectified low-freq
            # content; the detrend sits ~8x above the grain band so no
            # pore-band energy is removed).
            field = field - gauss(field, s_crease)
            field = field - gauss(field, float(a.pore_detrend_mm) * tpm)
            # Asymmetric caps (no demean: the clipped field keeps its
            # natural near-zero mean, so the floor stays at the uniform
            # level; demeaning would lift the floor back up).
            # CAP_POS/CAP_NEG are operator/consult decision.
            field = np.minimum(field, CAP_POS)
            field = np.maximum(field, CAP_NEG)
            rms = float(np.sqrt((field[norm_support] ** 2).mean()))
            lift_L = 0.0
            if rms > 0:
                field = field / rms
                added_rms = float(np.sqrt((field[norm_support] ** 2).mean()))
                shaped = shaped + p * field * gate
    lab = rgb_to_lab(alb)
    lab[..., 0] = np.clip(gate * shaped + (1.0 - gate) * lum, 0, 100)
    if underlip.any():
        # Beard weight 0: the mentolabial band keeps only
        # UNDERLIP_CREASE_KEEP of the crease term (pore term untouched):
        # lum minus the kept crease plus the gated pore field. At keep 1
        # this is the legacy blend regrouped.
        lab[underlip, 0] = np.clip(
            lum[underlip]
            - UNDERLIP_CREASE_KEEP * (gate * g * removed)[underlip]
            + (gate * p * field * gate)[underlip], 0, 100)
    out = lab_to_rgb(lab)
    # Bit-exact outside the dilated support: the stage changes only
    # texels inside its derived mask plus the small restore margin.
    out[~support] = alb[~support]
    # Bit-exact where the gate is exactly zero (vermilion core, dark
    # interiors): those texels receive literally zero change, so bypass
    # the lossy Lab round trip for them (handback 7 proof (a)).
    out[gate == 0.0] = alb[gate == 0.0]
    Image.fromarray(out).save(a.albedo_out)
    print("detail_bands: crease-gain=%s pore-gain=%s wrote %s"
          % (a.crease_gain, a.pore_gain, a.albedo_out), flush=True)
    if a.report_out is not None:
        with open(a.report_out, "w") as f:
            json.dump({"size": [h, wpx], "texels_per_mm": tpm,
                       "seed": int(a.seed), "crease_gain": g,
                       "pore_gain": p,
                       "pore_noise_hi_mm": float(a.pore_noise_hi_mm),
                       "feather_mm": float(a.feather_mm),
                       "scalp_fringe_mm": float(a.scalp_fringe_mm),
                       "lift_L": lift_L, "added_rms": added_rms,
                       "support_px": int(support.sum())}, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
