#!/usr/bin/env python3
"""Per-case brow form, hb1 (card tsk_b438966217dd814e).

Last chain stage. The painted brow left in the albedo is either cleared
(brow form mesh: only the fitted mesh brow shows) or shifted toward the
case goal brow (brow form texture: one solved Lab pair per case).

  mesh:    clear painted texels only (coverage-gated: smoothstep(0.15,
           0.45, coverage) so unpainted skin inside the mask is untouched),
           filled from forehead skin ABOVE the brow only (eye masks and
           everything below the union lower edge excluded from the source),
           then grain restore: low-pass fill plus the high-pass band
           sampled at the nearest source texel above in the same column.
           (eye masks and everything below the union lower edge are
           excluded from the source: the source region is neutralized to
           the forehead mean before the Telea march, so no lid-crease
           dark can drag up), then restore grain: low-pass fill plus the
           high-pass band sampled from the forehead strip above, offset
           by the brow height. Bounded-inside smoothstep feather keeps
           zero writes outside the union.
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


def offset_grain(rgb: np.ndarray, union: np.ndarray,
                 source_ok: np.ndarray) -> np.ndarray:
    """High-pass band sampled from the forehead skin directly above.

    For each union texel, sample the (rgb - gaussian(rgb, 1)) field at
    the nearest source texel above it in the same column (the source
    region already excludes the dilated union, so the paint itself is
    never sampled). The sigma-1 band carries the fine grain the sigma-2
    gate measures, at the strip's own amplitude (no fitted gain).
    Zero where no source texel exists above.
    """
    h, w = rgb.shape[:2]
    f = rgb.astype(np.float64)
    hp = np.stack([f[:, :, c] - ndimage.gaussian_filter(f[:, :, c], 1)
                   for c in range(3)], axis=2)
    grain = np.zeros_like(f)
    cols = np.where(union.any(axis=0))[0]
    for x in cols:
        src_rows = np.where(source_ok[:, x])[0]
        if not len(src_rows):
            continue
        ys = np.where(union[:, x])[0]
        idx = np.searchsorted(src_rows, ys - 4, side="right") - 1
        ok = idx >= 0
        grain[ys[ok], x] = hp[src_rows[idx[ok]], x]
    return grain


def clear_mesh(rgb: np.ndarray, union: np.ndarray, alpha: np.ndarray,
               facecore: np.ndarray | None, eyes: np.ndarray | None,
               radius: int) -> np.ndarray:
    filled, source_ok, _ = restricted_fill(rgb, union, facecore,
                                              eyes, radius)
    lab = rgb2lab(rgb.astype(np.float64) / 255.0)
    skin_L = rgb2lab(filled / 255.0)[:, :, 0]
    Lp = lab[:, :, 0][union]
    core = float(np.mean(np.sort(Lp)[:max(1, int(0.1 * Lp.size))]))
    denom = np.maximum(skin_L[union] - core, 1e-9)
    cov = np.clip((skin_L[union] - Lp) / denom, 0.0, 1.0)
    t = np.clip((cov - 0.15) / 0.30, 0.0, 1.0)
    clear_w = np.zeros(rgb.shape[:2])
    clear_w[union] = t * t * (3.0 - 2.0 * t)
    a = (alpha * clear_w)[:, :, None]
    low_orig = np.stack(
        [ndimage.gaussian_filter(rgb.astype(np.float64)[:, :, c], 2)
         for c in range(3)], axis=2)
    g = offset_grain(rgb, union, source_ok)
    # Pre-compensate the sigma-2 gate blur: adding grain alone reads back
    # attenuated (the gate high-passes the sum), so carry its own blur too;
    # the sum reads back at the strip's energy with no fitted gain.
    g_full = g + np.stack(
        [ndimage.gaussian_filter(g[:, :, c], 2) for c in range(3)], axis=2)
    cw3 = clear_w[:, :, None]
    smooth = (rgb.astype(np.float64) * (1.0 - a)
              + (cw3 * filled + (1.0 - cw3) * low_orig) * a)
    out = smooth
    wgt = alpha[union][:, None]
    out[union] += g_full[union] * wgt
    return np.clip(out, 0, 255)


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
        result = clear_mesh(rgb, union, alpha, facecore, eyes, radius)
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
