#!/usr/bin/env python3
"""Hair-light-2 image measurements shared by probes, search, and verifier."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def rgb(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float64) / 255.0


def mask(path: Path, target: bool = False) -> np.ndarray:
    image = Image.open(path)
    if target:
        a = np.asarray(image.convert("L"), dtype=np.uint8)
        return a >= 128
    a = np.asarray(image.convert("RGBA"), dtype=np.uint8)[..., 3]
    return a >= 230


def lum(a: np.ndarray) -> np.ndarray:
    return .2126 * a[..., 0] + .7152 * a[..., 1] + .0722 * a[..., 2]


def stats(image: np.ndarray, selected: np.ndarray) -> dict:
    px = image[selected]
    if not len(px):
        return {"pixels": 0, "p50": None, "p90": None, "RB": None, "mean_luminance": None}
    ll = lum(px)
    mean = px.mean(axis=0)
    return {
        "pixels": int(len(px)),
        "p50": float(np.percentile(ll, 50)),
        "p90": float(np.percentile(ll, 90)),
        "RB": float(mean[0] / max(mean[2], 1e-9)),
        "mean_luminance": float(ll.mean()),
    }


def front_regions(m: np.ndarray) -> dict[str, np.ndarray]:
    yy, xx = np.nonzero(m)
    y0, y1, x0, x1 = yy.min(), yy.max(), xx.min(), xx.max()
    h, w = y1 - y0 + 1, x1 - x0 + 1
    Y, X = np.indices(m.shape)
    crown = (Y <= y0 + .35 * h) & (X >= x0 + .35 * w) & (X <= x0 + .65 * w)
    sides = (Y >= y0 + .18 * h) & (Y <= y0 + .68 * h) & (
        (X <= x0 + .28 * w) | (X >= x0 + .72 * w))
    lower = (Y >= y0 + .65 * h)
    return {"crown_part_band": m & crown, "sides": m & sides, "lower_sheet": m & lower}


def cheek_stats(image: np.ndarray, hair: np.ndarray) -> dict:
    h, w = hair.shape
    Y, X = np.indices(hair.shape)
    # Symmetric cheek band, beneath the eyes and above the mouth. Hair pixels
    # are excluded so this is a light-on-face constraint, not hair spill.
    box = (Y >= .40*h) & (Y <= .52*h) & (X >= .39*w) & (X <= .61*w) & ~hair
    values = lum(image)[box]
    return {"box_norm": [.39, .40, .61, .52], "pixels": int(len(values)),
            "p50": float(np.percentile(values, 50))}


def measure_set(front: Path, front_mask: Path, back: Path, back_mask: Path,
                is_target: bool = False) -> dict:
    fi, fm = rgb(front), mask(front_mask, is_target)
    bi, bm = rgb(back), mask(back_mask, is_target)
    out = {name: stats(fi, selected) for name, selected in front_regions(fm).items()}
    out["back_view"] = stats(bi, bm)
    all_front = stats(fi, fm)
    out["whole_front"] = all_front
    out["part_side_ratio"] = float(
        out["crown_part_band"]["mean_luminance"] / max(out["sides"]["mean_luminance"], 1e-9))
    out["cheek"] = cheek_stats(fi, fm)
    out["mask_area"] = {"front_px": int(fm.sum()), "back_px": int(bm.sum())}
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--front", type=Path, required=True)
    p.add_argument("--front-mask", type=Path, required=True)
    p.add_argument("--back", type=Path, required=True)
    p.add_argument("--back-mask", type=Path, required=True)
    p.add_argument("--target", action="store_true")
    p.add_argument("--out", type=Path)
    a = p.parse_args()
    result = measure_set(a.front, a.front_mask, a.back, a.back_mask, a.target)
    text = json.dumps(result, indent=2) + "\n"
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(text)
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
