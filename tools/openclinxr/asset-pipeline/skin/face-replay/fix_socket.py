"""Socket-red fix: fill eye-band texels (dilate 8) with cheek hue/chroma at L45.

Scripted from what S/polish/RESULT.md records (D1 fix line):
  "socket-red texels (eye-band verts, dilate 8) filled with cheek hue/chroma
   at L45 (132,100,80), feather 6. Wedge mean a* (12x12) L 20.8->9.2,
   R 24.2->11.0; adjacent skin 12.7/14.0; edit 9.3/9.5."
cheek_lab default (45, 12.7, 14.0) = L45 + adjacent-skin a*/b* from that line;
dilate_px=8 and feather_px=6 likewise. The eye-band vertex selection rule is
NOT recorded (no mesh/window/threshold), so the band is the DERIVED eye-mask
union dilated by 8 (documented substitution, recorded in the manifest).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    from skimage.color import rgb2lab
    return rgb2lab(rgb.astype(np.float64) / 255.0).astype(np.float32)


def lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    from skimage.color import lab2rgb
    return np.clip(np.round(lab2rgb(lab.astype(np.float64)) * 255), 0, 255).astype(np.uint8)


def gauss(img: np.ndarray, sigma: float) -> np.ndarray:
    return cv2.GaussianBlur(img, (0, 0), sigma)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("albedo_in", type=Path)
    ap.add_argument("albedo_out", type=Path)
    ap.add_argument("--eye-mask", type=Path, required=True)
    ap.add_argument("--cheek-l", type=float, default=45.0)
    ap.add_argument("--cheek-a", type=float, default=12.7)
    ap.add_argument("--cheek-b", type=float, default=14.0)
    ap.add_argument("--dilate-px", type=int, default=8)
    ap.add_argument("--feather-px", type=int, default=6)
    args = ap.parse_args(argv)

    alb = np.array(Image.open(args.albedo_in).convert("RGB"))
    eye_mask = np.array(Image.open(args.eye_mask).convert("L")).astype(np.float32) / 255.0
    eye_bin = (eye_mask > 0.5).astype(np.uint8)

    # Dilate eye mask to get socket band
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (args.dilate_px * 2 + 1, args.dilate_px * 2 + 1))
    dilated = cv2.dilate(eye_bin, kernel)
    socket_band = (dilated > 0) & (eye_bin == 0)

    if not socket_band.any():
        print("socket: no band texels", flush=True)
        Image.fromarray(alb).save(args.albedo_out)
        return 0

    # Feather the band
    feather = gauss(socket_band.astype(np.float32), args.feather_px)
    if feather.max() > 0:
        feather /= feather.max()

    # Target Lab: cheek hue/chroma at specified L
    lab = rgb_to_lab(alb)
    target_lab = lab.copy()
    target_lab[..., 0] = args.cheek_l
    target_lab[..., 1] = args.cheek_a
    target_lab[..., 2] = args.cheek_b

    # Blend
    lab = feather[..., None] * target_lab + (1 - feather[..., None]) * lab
    lab[..., 0] = np.clip(lab[..., 0], 0, 100)
    out = lab_to_rgb(lab)
    # Bit-exact outside the feathered band: the stage changes only texels
    # inside its derived mask.
    out[feather == 0] = alb[feather == 0]
    Image.fromarray(out).save(args.albedo_out)
    print(f"socket: band texels={int(socket_band.sum())} cheek_Lab=({args.cheek_l},{args.cheek_a},{args.cheek_b}) wrote {args.albedo_out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())