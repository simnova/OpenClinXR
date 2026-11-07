#!/usr/bin/env python3
"""hair-count2 profile HOLE metric (system python, numpy+cv2+PIL).

HOLE = connected background regions fully enclosed by the hair mask, as %
of hair area. Computed on the 1024 profile_90-id.png (alpha>=230) plus the
TS target mask for reference:
  bg = ~hair; label bg with cv2 8-way connected components; any bg
  component touching the image border is exterior; the rest are holes.
  holePct = 100 * holePixels / hairPixels.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

E = Path(__file__).resolve().parent


def hair_mask_id(path: Path) -> np.ndarray:
    a = np.asarray(Image.open(path).convert("RGBA"))[..., 3]
    return a >= 230


def hair_mask_target(path: Path) -> np.ndarray:
    m = np.asarray(Image.open(path).convert("L")) > 127
    if m.shape != (1024, 1024):
        m = np.asarray(Image.fromarray((m.astype(np.uint8) * 255)).resize(
            (1024, 1024), Image.NEAREST)) > 127
    return m


def holes(hair: np.ndarray) -> dict:
    bg = (~hair).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(bg, connectivity=8)
    h, w = hair.shape
    border = set(np.unique(np.concatenate(
        [labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]])).tolist())
    hole_px = 0
    hole_n = 0
    sizes = []
    for i in range(1, n):
        if i in border:
            continue
        hole_n += 1
        px = int(stats[i, cv2.CC_STAT_AREA])
        hole_px += px
        sizes.append(px)
    hair_px = int(hair.sum())
    return {"holeComponents": hole_n,
            "holePixels": hole_px,
            "hairPixels": hair_px,
            "holePctOfHair": float(100.0 * hole_px / max(hair_px, 1)),
            "largestHolePx": int(max(sizes)) if sizes else 0}


def main():
    tags = sys.argv[1:] or ["base", "n2", "tt0", "tt05", "key15"]
    out = {}
    for tag in tags:
        m = hair_mask_id(E / tag / "profile_90-id.png")
        out[tag] = {"ours": holes(m)}
        print(tag, json.dumps(out[tag]["ours"]), flush=True)
    # TS reference (target mask, resize-only like the judge side views)
    tm = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back/mask-profile-v2.png")
    if tm.exists():
        out["TS_target"] = {"target": holes(hair_mask_target(tm))}
        print("TS_target", json.dumps(out["TS_target"]["target"]), flush=True)
    (E / "holes.json").write_text(json.dumps(out, indent=2) + "\n")
    print("WROTE", E / "holes.json", flush=True)


if __name__ == "__main__":
    main()
