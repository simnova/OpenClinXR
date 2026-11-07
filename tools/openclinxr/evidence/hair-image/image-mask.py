#!/usr/bin/env python3
"""Generate/measure the repaired visible-hair ID mask without beauty renders."""
import argparse
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageFilter


HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../../.."))
TARGET = "/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/target-front.png"
TARGET_MASK = "/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/mask-front.png"
RIMS = (80, 40, 20, 0)
LUMA = np.array([0.2126, 0.7152, 0.0722])


def stats(rgb, mask):
    count = int(mask.sum())
    if not count:
        raise RuntimeError("Error: mask has zero covered pixels")
    pixels = rgb[mask]
    values = (rgb @ LUMA)[mask]
    p10, p50, p90 = np.percentile(values, [10, 50, 90])
    mean_rgb = pixels.mean(axis=0)
    return {
        "coveragePixels": count,
        "p10": float(p10),
        "p50": float(p50),
        "p90": float(p90),
        "meanRGB": [float(v) for v in mean_rgb],
        "meanRBSpread": float(mean_rgb[0] - mean_rgb[2]),
    }


def overlay(beauty_path, mask, color, output_path):
    rgb = np.asarray(Image.open(beauty_path).convert("RGB"), dtype=np.float64)
    tint = np.array(color, dtype=np.float64)
    out = rgb.copy()
    out[mask] = 0.55 * out[mask] + 0.45 * tint
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB").save(output_path)


def render_id():
    env = dict(os.environ)
    env["MISE_TRUSTED_CONFIG_PATHS"] = REPO
    proc = subprocess.run([
        "blender", "--background", "--python", os.path.join(HERE, "image-rim.py"),
        "--", "--out-dir", HERE, "--id-only",
    ], cwd=REPO, env=env, text=True)
    if proc.returncode:
        raise RuntimeError("Error: Blender ID pass exited %d" % proc.returncode)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--render-id", action="store_true",
                        help="run image-rim.py's ID-only Blender path first")
    args = parser.parse_args()
    row_path = os.path.join(HERE, "row-mask.json")
    try:
        if args.render_id:
            render_id()
        fixed_path = os.path.join(HERE, "hair-id-fixed.png")
        alpha = np.asarray(Image.open(fixed_path).convert("RGBA"))[..., 3]
        mask = alpha >= 230

        old_alpha = np.asarray(Image.open(
            os.path.join(HERE, "hair-id-rim-0.png")).convert("RGBA"))[..., 3]
        overlay(os.path.join(HERE, "rim-0.png"), old_alpha >= 230, (255, 0, 0),
                os.path.join(HERE, "mask-overlay-before.png"))
        overlay(os.path.join(HERE, "rim-0.png"), mask, (0, 255, 0),
                os.path.join(HERE, "mask-overlay-fixed.png"))

        cells = []
        for watts in RIMS:
            rgb = np.asarray(Image.open(os.path.join(HERE, "rim-%d.png" % watts)).convert("RGB"),
                             dtype=np.float64) / 255.0
            cell_stats = stats(rgb, mask)
            cells.append({"rimWatts": watts, **cell_stats})

        target = np.asarray(Image.open(TARGET).convert("RGB"), dtype=np.float64) / 255.0
        target_mask_image = Image.open(TARGET_MASK).convert("L").resize(
            (target.shape[1], target.shape[0]), Image.Resampling.NEAREST)
        # One source-mask pixel of erosion after the 2x resize rejects boundary
        # antialiasing while retaining the dark hair interior.
        target_mask = np.asarray(target_mask_image.filter(ImageFilter.MinFilter(5))) >= 230
        reference = stats(target, target_mask)
        failures = [c for c in cells if c["meanRBSpread"] >= 0.12]
        if failures:
            raise RuntimeError("Error: visible-hair mean R-B spread >= 0.12: %s" % failures)
        row = {
            "ok": True,
            "stage": "measure",
            "error": "",
            "mask": "hair-id-fixed.png",
            "overlay": "mask-overlay-fixed.png",
            "cells": cells,
            "reference": reference,
            "comparison": "hair darker than target" if all(
                c["p50"] < reference["p50"] for c in cells) else "hair not darker than target",
        }
    except Exception as exc:
        row = {"ok": False, "stage": "measure", "error": str(exc), "cells": []}
        with open(row_path, "w") as handle:
            json.dump(row, handle, indent=2)
        raise
    with open(row_path, "w") as handle:
        json.dump(row, handle, indent=2)
    print(json.dumps(row, indent=2))


if __name__ == "__main__":
    main()
