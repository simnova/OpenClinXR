#!/usr/bin/env python3
"""Per-case brow form, hb2 (card tsk_b438966217dd814e).

Last chain stage. The painted brow left in the albedo is either cleared
(brow form mesh: only the fitted mesh brow shows) or shifted toward the
case goal brow (brow form texture: one solved Lab pair per case).

  mesh:    clear every painted departure inside the full brow mask (a
           paint-presence gate at coverage 0.03, dilated 2 px: faint
           outlines go too, unlike hb1's 0.15-0.45 window) with a
           bounded-inside smoothstep feathered edge, filled from forehead
           skin ABOVE the brow only (eye masks and everything below the
           union lower edge excluded from the source, neutralized to the
           forehead mean before the Telea march, so no lid-crease dark can
           drag up). Unpainted skin keeps its own low frequencies (the
           light band above the lid keeps its tone); only painted texels
           take Telea fill. Grain by seeded 2D patch transplant: the
           high-pass of the source skin (rgb minus gaussian-16) is splatted
           over the union from random (seeded) P x P source patches blended
           with a Hann window and normalized by the weight field (seamless;
           uniform random positions, so no grid stride is imprinted on the
           row means). P spans the forehead grain wavelength. Paint inside
           the union is never sampled (sources lie in the forehead above).
   texture: shift each pixel by its brow coverage only: coverage from how
           far the pixel departs from the local skin underneath
           (skin estimate = the mesh-case restricted fill;
           coverage = clip((L_skin - L_px)/(L_skin - L_brow_core),0,1)
           with L_brow_core the mean of the darkest decile in the union),
           weight = coverage^power, shift = (dL,dC)*weight*feather.
           Bare skin inside the mask (coverage < 0.2) barely moves; the
           per-hair shift exceeds the mean gap by construction.

The mode arrives via --brow-form from the replay driver, which reads it
from case-inputs.json (chain_subject reverse lookup). This script names
no case and no subject; an unknown mode refuses.
"""
import argparse
import json
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage
from skimage.color import lab2rgb, rgb2lab


def load_rgb(path: str) -> np.ndarray:
    return np.array(Image.open(path).convert("RGB"))


def load_mask(path: str | None, shape: tuple[int, int]) -> np.ndarray | None:
    if path is None:
        return None
    m = np.array(Image.open(path).convert("L"))
    if m.shape != shape:
        m = np.array(Image.open(path).convert("L").resize(
            (shape[1], shape[0]), Image.NEAREST))
    return m > 127


def inside_alpha(union: np.ndarray, feather_px: float) -> np.ndarray:
    """Bounded-inside smoothstep: 0 outside/at the edge, 1 deep inside."""
    if feather_px <= 0:
        return union.astype(np.float64)
    dist = ndimage.distance_transform_edt(union)
    t = np.clip(dist / float(feather_px), 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t) * union).astype(np.float64)


def restricted_fill(rgb: np.ndarray, union: np.ndarray,
                    facecore: np.ndarray | None,
                    eyes: np.ndarray | None, radius: int) -> tuple[np.ndarray, np.ndarray, float]:
    """Fill the union from forehead-above only.

    Returns (filled_rgb_float, source_ok_bool, brow_height_px).
    Everything outside the source region is neutralized to the source
    skin mean before the Telea march, so lid-crease/socket dark below
    the brow cannot bleed into the cleared area.
    """
    h, w = rgb.shape[:2]
    yy = np.arange(h)[:, None]
    if facecore is None:
        facecore = np.ones((h, w), bool)
    excl = ndimage.binary_dilation(union, iterations=4)
    if eyes is not None:
        excl |= ndimage.binary_dilation(eyes, iterations=4)
    rows = np.where(union)[0]
    bottom = int(rows.max()) if rows.size else h
    source_ok = facecore & ~excl & (yy <= bottom - 2)
    if not source_ok.any():
        source_ok = ~excl
    skin_rgb = np.median(rgb[source_ok].reshape(-1, 3), axis=0)
    tmp = rgb.copy()
    tmp[~source_ok] = skin_rgb
    bgr = tmp[:, :, ::-1].copy()
    hole = union.astype(np.uint8) * 255
    filled = cv2.inpaint(bgr, hole, radius, cv2.INPAINT_TELEA)[:, :, ::-1]
    heights = []
    for x in np.where(union.any(axis=0))[0]:
        col = np.where(union[:, x])[0]
        heights.append(int(col.max() - col.min() + 1))
    brow_h = float(np.median(heights)) if heights else 0.0
    return filled.astype(np.float64), source_ok, brow_h


# hb2 grain transplant: seed + patch size are method constants (recorded in
# stdout and the brow-form report; not per-case solves, so the manifest is
# untouched). PATCH spans the forehead grain wavelength (4.0 px zero-crossing
# median of the high-pass on the mesh-case PRE forehead strip, invariant
# across high-pass sigmas 8/16/32): smaller pieces average more per row, so
# row means stay flat (G10), while each piece still carries the grain.
# SIGMA splits tone (Telea low-pass, kept) from texture (transplanted
# high-pass, periods below ~2x sigma).
GRAIN_SEED = 20261019
GRAIN_PATCH = 6
GRAIN_SIGMA = 16
GRAIN_COVERAGE = 8.0


def patch_grain(rgb: np.ndarray, union: np.ndarray,
                source_ok: np.ndarray, seed: int = GRAIN_SEED,
                patch: int = GRAIN_PATCH,
                sigma: float = GRAIN_SIGMA,
                coverage: float = GRAIN_COVERAGE) -> tuple[np.ndarray, dict]:
    """Forehead grain by seeded gridless patch-splat transplant.

    The high-pass (rgb minus gaussian(sigma)) of the source skin is splatted
    over the union bbox from random P x P source patches (seeded RNG,
    uniform positions: no grid, so no stride period is imprinted on the row
    means)     blended with a Hann window and normalized by the weight field
    (seamless). Each patch is demeaned (tiles carry texture, not tone steps)
    and amplitude-matched to the pool std (a flat texture envelope: no
    patch-scale amplitude modulation in the row means); dense overlap
    averaging attenuates variance, so a measured per-channel
    renormalization matches the grain to the source high-pass std
    (deterministic energy match, recorded in stdout). Source origins
    are valid only when the whole patch lies inside source_ok in the
    forehead ABOVE the union (the G9/G10 reference rows: paint inside the
    union is never sampled). The low base sets the mean tone. Returns
    (grain, info dict).
    """
    h, w = rgb.shape[:2]
    f = rgb.astype(np.float64)
    hp = np.stack([f[:, :, c] - ndimage.gaussian_filter(f[:, :, c], sigma)
                   for c in range(3)], axis=2)
    ok = source_ok.astype(np.float64)
    ii = np.zeros((h + 1, w + 1))
    ii[1:, 1:] = np.cumsum(np.cumsum(ok, axis=0), axis=1)
    full = float(patch * patch)
    ys_u = np.where(union)[0]
    top_u = int(ys_u.min())
    H_u = int(ys_u.max()) - top_u + 1
    # Patch sources live in the forehead ABOVE the union (the same rows as
    # the G9/G10 reference strip).
    src_last = top_u - max(2, H_u // 60) - patch
    valid = []
    for y in range(0, min(src_last, h - patch) + 1):
        for x in range(0, w - patch + 1):
            s = ii[y + patch, x + patch] - ii[y, x + patch] \
                - ii[y + patch, x] + ii[y, x]
            if s >= full - 1e-9:
                valid.append((y, x))
    grain = np.zeros_like(f)
    weight = np.zeros((h, w))
    n_valid = len(valid)
    if not n_valid:
        return grain, 0
    ys, xs = np.where(union)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    win1 = np.hanning(patch)
    win = (win1[:, None] * win1[None, :])[:, :, None]
    pool_std = np.array([np.concatenate(
        [hp[y:y + patch, x:x + patch, c].ravel() for (y, x) in valid]
    ).std() for c in range(3)])
    rng = np.random.default_rng(seed)
    n_splat = int(coverage * (y1 - y0) * (x1 - x0) / full)
    for _ in range(n_splat):
        jy = int(rng.integers(y0, y1))
        jx = int(rng.integers(x0, x1))
        ey, ex = min(jy + patch, h), min(jx + patch, w)
        if ey - jy < 2 or ex - jx < 2:
            continue
        if not union[jy:ey, jx:ex].any():
            continue
        sy, sx = valid[int(rng.integers(n_valid))]
        p = hp[sy:sy + (ey - jy), sx:sx + (ex - jx)].copy()
        # Demean (no tone steps) and amplitude-match (flat envelope) each
        # patch per channel, guarded so near-flat patches cannot blow up.
        p -= p.reshape(-1, 3).mean(axis=0)
        ps = p.reshape(-1, 3).std(axis=0)
        pg = np.clip(pool_std / np.maximum(ps, 0.25 * pool_std),
                     0.25, 4.0)
        p *= pg
        g = p * win[:ey - jy, :ex - jx]
        grain[jy:ey, jx:ex] += g
        weight[jy:ey, jx:ex] += win[:ey - jy, :ex - jx, 0]
    nz = weight > 0
    grain[nz] /= weight[nz][:, None]
    # Energy renormalization (measured, not fitted): dense overlap averaging
    # attenuates variance by the effective overlap count, so the transplant
    # reads smoother than the source skin (G8/G9 energy shortfall). Scale each
    # channel so the grain over covered union pixels matches the source
    # high-pass std over the valid pool. Deterministic given seed + inputs.
    grow = np.zeros_like(f)
    gain = []
    for c in range(3):
        cov = union & nz
        gs = float(grain[cov][:, c].std()) if cov.any() else 0.0
        g = (pool_std[c] / gs) if gs > 1e-9 else 1.0
        gain.append(g)
        grow[:, :, c] = grain[:, :, c] * g
    return grow, {"n_splat": n_splat, "n_valid": n_valid,
                  "gain": [round(g, 4) for g in gain]}


def clear_mesh(rgb: np.ndarray, union: np.ndarray, alpha: np.ndarray,
               facecore: np.ndarray | None, eyes: np.ndarray | None,
               radius: int) -> tuple[np.ndarray, dict]:
    filled, source_ok, _ = restricted_fill(rgb, union, facecore,
                                           eyes, radius)
    f = rgb.astype(np.float64)
    # Paint-presence gate (NOT a coverage window): any departure from the
    # local skin goes, including the faint outline hb1's 0.15-0.45 window
    # left behind. Coverage is measured against the darkest-decile core as
    # in the texture branch; the 0.03 threshold sits at ~1 Lab unit of
    # departure, dilated 2 px to catch stroke edges, feathered inside.
    # Unpainted skin keeps its own low frequencies (so the light band above
    # the lid keeps its tone: G7) and only painted texels take Telea fill.
    skin_L = rgb2lab(filled / 255.0)[:, :, 0]
    lab = rgb2lab(f / 255.0)
    Lp = lab[:, :, 0][union]
    core = float(np.mean(np.sort(Lp)[:max(1, int(0.1 * Lp.size))]))
    denom = np.maximum(skin_L[union] - core, 1e-9)
    cov = np.clip((skin_L[union] - lab[:, :, 0][union]) / denom, 0.0, 1.0)
    paint = np.zeros_like(union)
    paint[union] = cov > 0.03
    paint = ndimage.binary_dilation(paint, iterations=2) & union
    alpha_p = inside_alpha(paint, 4.0)
    low_telea = np.stack(
        [ndimage.gaussian_filter(filled[:, :, c], GRAIN_SIGMA)
         for c in range(3)], axis=2)
    low_pre = np.stack(
        [ndimage.gaussian_filter(f[:, :, c], GRAIN_SIGMA)
         for c in range(3)], axis=2)
    ap = alpha_p[:, :, None]
    low = low_pre * (1.0 - ap) + low_telea * ap
    grain, ginfo = patch_grain(rgb, union, source_ok)
    a = alpha[:, :, None]
    out = f * (1.0 - a) + (low + grain) * a
    return np.clip(out, 0, 255), {
        "grain_seed": GRAIN_SEED,
        "grain_patch": GRAIN_PATCH,
        "grain_sigma": GRAIN_SIGMA,
        "paint_frac": round(float(paint.sum() / union.sum()), 4),
        **ginfo,
    }


def shift_texture(rgb: np.ndarray, union: np.ndarray, alpha: np.ndarray,
                  facecore: np.ndarray | None, eyes: np.ndarray | None,
                  radius: int, dL: float, dC: float,
                  power: float) -> tuple[np.ndarray, dict]:
    info: dict = {"coverage_mean": 0.0, "g6_max_dL": 0.0, "g6_max_dC": 0.0}
    if dL == 0.0 and dC == 0.0:
        return rgb.astype(np.float64), info
    filled, _, _ = restricted_fill(rgb, union, facecore, eyes, radius)
    lab = rgb2lab(rgb.astype(np.float64) / 255.0)
    skin_L = rgb2lab(filled / 255.0)[:, :, 0]
    Lp = lab[:, :, 0][union]
    core = float(np.mean(np.sort(Lp)[:max(1, int(0.1 * Lp.size))]))
    denom = np.maximum(skin_L[union] - core, 1e-9)
    cov = np.clip((skin_L[union] - Lp) / denom, 0.0, 1.0)
    w = np.power(cov, power) * alpha[union]
    out = rgb.astype(np.float64)
    sub = lab[union]
    L = sub[:, 0] + dL * w
    C = np.hypot(sub[:, 1], sub[:, 2])
    Cn = np.maximum(C + dC * w, 0.0)
    scale = np.divide(Cn, C, out=np.ones_like(Cn), where=C > 1e-9)
    moved = np.stack([L, sub[:, 1] * scale, sub[:, 2] * scale], axis=1)
    back = np.clip(lab2rgb(moved) * 255.0, 0, 255)
    hit = np.zeros(rgb.shape[:2], bool)
    hit[union] = w > 0
    out[hit] = back[w > 0]
    keep = np.ones(rgb.shape[:2], bool)
    keep[hit] = False
    out[keep] = rgb[keep]
    post = rgb2lab(np.clip(out, 0, 255).astype(np.float64) / 255.0)
    d = np.abs(post - lab)
    bare = np.zeros(rgb.shape[:2], bool)
    bare[union] = cov < 0.2
    if bare.any():
        info["g6_max_dL"] = float(d[bare][:, 0].max())
        info["g6_max_dC"] = float(
            np.abs(np.hypot(post[bare][:, 1], post[bare][:, 2])
                   - np.hypot(lab[bare][:, 1], lab[bare][:, 2])).max())
    info["coverage_mean"] = float(cov.mean())
    return out, info


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--brows-mask-L", required=True)
    ap.add_argument("--brows-mask-R", required=True)
    ap.add_argument("--facecore-mask", default=None)
    ap.add_argument("--eyes-mask-L", default=None)
    ap.add_argument("--eyes-mask-R", default=None)
    ap.add_argument("--brow-form", required=True, choices=["mesh", "texture"])
    ap.add_argument("--dL", type=float, default=0.0)
    ap.add_argument("--dC", type=float, default=0.0)
    ap.add_argument("--feather-px", type=float, default=6.0)
    ap.add_argument("--coverage-power", type=float, default=2.0)
    args = ap.parse_args(argv)

    rgb = load_rgb(args.input)
    h, w = rgb.shape[:2]
    union = (load_mask(args.brows_mask_L, (h, w)) |
             load_mask(args.brows_mask_R, (h, w)))
    if int(union.sum()) == 0:
        raise RuntimeError("brow union empty: refuse")
    facecore = load_mask(args.facecore_mask, (h, w))
    eyes = None
    for key in (args.eyes_mask_L, args.eyes_mask_R):
        m = load_mask(key, (h, w))
        if m is not None:
            eyes = m if eyes is None else (eyes | m)
    alpha = inside_alpha(union, args.feather_px)
    radius = max(3, int(round(args.feather_px)) + 2)
    info: dict = {}

    if args.brow_form == "mesh":
        result, info = clear_mesh(rgb, union, alpha, facecore, eyes, radius)
    elif args.brow_form == "texture":
        result, info = shift_texture(rgb, union, alpha, facecore, eyes,
                                    radius, args.dL, args.dC,
                                    args.coverage_power)
    else:
        raise RuntimeError(f"unknown brow form {args.brow_form}: refuse")

    Image.fromarray(np.clip(result + 0.5, 0, 255).astype(np.uint8)).save(
        args.output)
    lab_before = rgb2lab(rgb.astype(np.float64) / 255.0)
    lab_after = rgb2lab(np.clip(result, 0, 255).astype(np.float64) / 255.0)
    d = np.abs(lab_after - lab_before).max(axis=2)
    print(json.dumps({
        "mode": args.brow_form,
        "dL": args.dL,
        "dC": args.dC,
        "coverage_power": args.coverage_power,
        "mask_px": int(union.sum()),
        "in_mask_mean_dLab": float(d[union].mean()),
        "outside_max_dLab": float(d[~union].max()),
        **info,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
