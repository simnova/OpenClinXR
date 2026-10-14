"""Lip chroma fix: scale lip-texel chroma by RATIO under feathered UV lip mask.

Ported from S/eyelip/fix_lips.py for the face-replay hand-steps chain.
Default ratio=1.0 (no change). Value 1.30 was tuned on female skin, correctly
skipped on male (S/skins/RESULT.md). Parameter recorded per subject.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

# sRGB <-> CIELAB (D65), matching skimage rgb2lab/lab2rgb convention.
_XYZ_WHITE = np.array([0.95047, 1.0, 1.08883])


def _srgb_to_linear(c: np.ndarray) -> np.ndarray:
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * (c ** (1.0 / 2.4)) - 0.055)


_RGB2XYZ = np.array([[0.4124564, 0.3575761, 0.1804375],
                     [0.2126729, 0.7151522, 0.0721750],
                     [0.0193339, 0.1191920, 0.9503041]])
_XYZ2RGB = np.linalg.inv(_RGB2XYZ)


def _f(t: np.ndarray) -> np.ndarray:
    return np.where(t > (6.0 / 29.0) ** 3, t ** (1.0 / 3.0),
                    t / (3 * (6.0 / 29.0) ** 2) + 4.0 / 29.0)


def _finv(t: np.ndarray) -> np.ndarray:
    return np.where(t > 6.0 / 29.0, t ** 3,
                    3 * (6.0 / 29.0) ** 2 * (t - 4.0 / 29.0))


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    xyz = _srgb_to_linear(rgb.astype(np.float64) / 255.0) @ _RGB2XYZ.T
    xyz = xyz / _XYZ_WHITE
    fx, fy, fz = _f(xyz[..., 0]), _f(xyz[..., 1]), _f(xyz[..., 2])
    return np.stack([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)], axis=-1)


def lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    fy = (lab[..., 0] + 16) / 116.0
    fx = fy + lab[..., 1] / 500.0
    fz = fy - lab[..., 2] / 200.0
    xyz = np.stack([_finv(fx), _finv(fy), _finv(fz)], axis=-1) * _XYZ_WHITE
    return np.clip(np.round(_linear_to_srgb(xyz @ _XYZ2RGB.T) * 255), 0, 255).astype(np.uint8)


def gauss(img: np.ndarray, sigma: float) -> np.ndarray:
    return cv2.GaussianBlur(img, (0, 0), sigma)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("albedo_in", type=Path)
    ap.add_argument("albedo_out", type=Path)
    ap.add_argument("--ratio", type=float, default=1.0)
    ap.add_argument("--lipuv", type=Path, required=True)
    a = ap.parse_args(argv)

    new = np.array(Image.open(a.albedo_in).convert("RGB"))
    if float(a.ratio) == 1.0:
        # Default is defined as no change (S/skins/RESULT.md: 1.30 tuned on
        # female skin, correctly skipped on male): byte-identical copy
        # (a PIL re-encode would drop PNG metadata and change the sha).
        import shutil
        shutil.copyfile(a.albedo_in, a.albedo_out)
        print("lips: ratio=1.0 no-op, copied %s" % a.albedo_out, flush=True)
        return 0
    z = np.load(a.lipuv)
    core = np.maximum(np.maximum(z["up"] > 0, z["hard_up"] > 0),
                      np.maximum(z["lo"] > 0, z["hard_lo"] > 0)).astype(np.float32)
    feather = gauss(core, 6)[..., None].astype(np.float64)
    lab = rgb_to_lab(new)
    adj = lab.copy()
    adj[..., 1] = float(a.ratio) * lab[..., 1]
    adj[..., 2] = float(a.ratio) * lab[..., 2]
    lab = feather * adj + (1 - feather) * lab
    lab[..., 0] = np.clip(lab[..., 0], 0, 100)
    out = lab_to_rgb(lab)
    # Bit-exact outside the feathered lip mask: the stage changes only
    # texels inside its derived mask.
    out[feather[..., 0] == 0] = new[feather[..., 0] == 0]
    Image.fromarray(out).save(a.albedo_out)
    print("lips: ratio=%s feathered-texels=%d wrote %s"
          % (a.ratio, int((feather[..., 0] > 0.001).sum()), a.albedo_out), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())