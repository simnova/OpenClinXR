"""Apply occlusion: albedo *= AO^p, a* += k*(1-AO), occupancy-gated.

Ported from S/shade/apply_occ.py for the face-replay hand-steps chain.
Parameters p=0.9, k=2 per S/shade/RESULT.md and S/brow2/RESULT.md.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def lab_of(rgb: np.ndarray) -> np.ndarray:
    from skimage.color import rgb2lab
    return rgb2lab(rgb.astype(np.float64) / 255.0).astype(np.float32)


def lab_to_srgb(lab: np.ndarray) -> np.ndarray:
    from skimage.color import lab2rgb
    return np.clip(np.round(lab2rgb(lab.astype(np.float64)) * 255), 0, 255).astype(np.uint8)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--ao", type=Path, required=True)
    ap.add_argument("--occupancy", type=Path, required=True)
    ap.add_argument("--p", type=float, default=0.9)
    ap.add_argument("--k", type=float, default=2.0)
    a = ap.parse_args(argv)

    new = np.array(Image.open(a.inp).convert("RGB"))
    ao = np.array(Image.open(a.ao).convert("L")).astype(np.float32) / 255.0
    occ = np.array(Image.open(a.occupancy).convert("L")).astype(np.float32) / 255.0
    occ = (occ > 0.5).astype(np.float32)[..., None]

    f = (np.clip(ao, 0, 1) ** float(a.p))[..., None].astype(np.float32)
    rgb = (new.astype(np.float32) * (occ * f + (1 - occ))).clip(0, 255)
    lab = lab_of(np.round(rgb).astype(np.uint8))
    lab[..., 1] = lab[..., 1] + float(a.k) * (1 - ao).astype(np.float32) * occ[..., 0]
    out = lab_to_srgb(np.stack([np.clip(lab[..., 0], 0, 100), lab[..., 1], lab[..., 2]], -1))
    # Bit-exact outside occupancy: the stage changes only texels inside its
    # derived mask (the Lab roundtrip is not bit-exact in general).
    out[occ[..., 0] == 0] = new[occ[..., 0] == 0]
    Image.fromarray(out).save(a.out)
    print(f"wrote {a.out} p={a.p} k={a.k}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())