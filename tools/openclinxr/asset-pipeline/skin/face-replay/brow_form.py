#!/usr/bin/env python3
"""Per-case brow form (card tsk_b438966217dd814e).

Last chain stage: the painted brow left in the albedo is either cleared
(brow form mesh: only the fitted mesh brow shows) or shifted toward the
case goal brow (brow form texture: one solved Lab pair per case).

  mesh:    Telea inpaint of the brow-union texels from the surrounding
           skin, blended under a bounded-inside smoothstep feather (alpha
           0 at the union edge, 1 at feather_px inside, 0 outside). Zero
           writes outside the union by construction; the fill is
           deterministic (fixed Telea radius) and seamless (edge alpha 0
           keeps the original edge texels).
  texture: L += dL * alpha, chroma += dC * alpha (a, b scaled per texel),
           same bounded-inside feather. dL/dC come from the chain-manifest
           subject overrides (solved per case against the one-brow goal);
           0/0 is a byte copy.

The mode arrives via --brow-form from the replay driver, which reads it
from case-inputs.json (chain_subject reverse lookup). This script names
no case and no subject; an unknown mode refuses.

All work is under the derive brow masks; every number below is measured
on the input files, never assumed.
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


def load_mask(path: str, shape: tuple[int, int]) -> np.ndarray:
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


def clear_mesh(rgb: np.ndarray, union: np.ndarray,
               alpha: np.ndarray, radius: int) -> np.ndarray:
    bgr = rgb[:, :, ::-1].copy()
    hole = union.astype(np.uint8) * 255
    filled = cv2.inpaint(bgr, hole, radius, cv2.INPAINT_TELEA)[:, :, ::-1]
    a = alpha[:, :, None]
    return np.clip(rgb * (1.0 - a) + filled.astype(np.float64) * a,
                   0, 255)


def shift_texture(rgb: np.ndarray, union: np.ndarray, alpha: np.ndarray,
                  dL: float, dC: float) -> np.ndarray:
    if dL == 0.0 and dC == 0.0:
        return rgb.astype(np.float64)
    lab = rgb2lab(rgb.astype(np.float64) / 255.0)
    out = rgb.astype(np.float64)
    hit = alpha > 0
    sub = lab[hit]
    a = alpha[hit]
    L = sub[:, 0] + dL * a
    C = np.hypot(sub[:, 1], sub[:, 2])
    Cn = np.maximum(C + dC * a, 0.0)
    scale = np.divide(Cn, C, out=np.ones_like(Cn), where=C > 1e-9)
    moved = np.stack([L, sub[:, 1] * scale, sub[:, 2] * scale], axis=1)
    back = np.clip(lab2rgb(moved) * 255.0, 0, 255)
    out[hit] = back
    keep = np.ones(rgb.shape[:2], bool)
    keep[hit] = False
    out[keep] = rgb[keep]
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--brows-mask-L", required=True)
    ap.add_argument("--brows-mask-R", required=True)
    ap.add_argument("--brow-form", required=True, choices=["mesh", "texture"])
    ap.add_argument("--dL", type=float, default=0.0)
    ap.add_argument("--dC", type=float, default=0.0)
    ap.add_argument("--feather-px", type=float, default=6.0)
    args = ap.parse_args(argv)

    rgb = load_rgb(args.input)
    h, w = rgb.shape[:2]
    union = (load_mask(args.brows_mask_L, (h, w)) |
             load_mask(args.brows_mask_R, (h, w)))
    if int(union.sum()) == 0:
        raise RuntimeError("brow union empty: refuse")
    alpha = inside_alpha(union, args.feather_px)

    if args.brow_form == "mesh":
        radius = max(3, int(round(args.feather_px)) + 2)
        result = clear_mesh(rgb, union, alpha, radius)
    elif args.brow_form == "texture":
        result = shift_texture(rgb, union, alpha, args.dL, args.dC)
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
        "mask_px": int(union.sum()),
        "in_mask_mean_dLab": float(d[union].mean()),
        "outside_max_dLab": float(d[~union].max()),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
