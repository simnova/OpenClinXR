#!/usr/bin/env python3
"""hair-cover1 STEP 1: holes overlay + attribution by projected curves (system python)."""
import json
import numpy as np
import cv2
from pathlib import Path
from PIL import Image

E = Path("tools/openclinxr/evidence/hair-cover1")
BASE = E / "base"

def hair_mask(path):
    a = np.asarray(Image.open(path).convert("RGBA"))[..., 3]
    return a >= 230

def holes_of(hair):
    bg = (~hair).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(bg, connectivity=8)
    h, w = hair.shape
    border = set(np.unique(np.concatenate(
        [labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]])).tolist())
    hole = np.zeros_like(hair, dtype=bool)
    sizes = []
    for i in range(1, n):
        if i in border:
            continue
        hole |= (labels == i)
        sizes.append(int(stats[i, cv2.CC_STAT_AREA]))
    return hole, sizes, labels

hair = hair_mask(BASE / "profile_90-id.png")
hole, sizes, labels = holes_of(hair)
print("hair px", int(hair.sum()), "hole px", int(hole.sum()),
      "pct", 100*float(hole.sum())/float(hair.sum()),
      "ncomp", len(sizes), "largest", max(sizes) if sizes else 0)
ss = np.array(sorted(sizes, reverse=True))
print("top10 sizes:", ss[:10].tolist())
print("holes >100px:", int((ss > 100).sum()), "px in them:", int(ss[ss > 100].sum()))

# where are holes: row/col histogram of hole mass
ys, xs = np.where(hole)
print("hole rows p5/p50/p95:", np.percentile(ys, [5, 50, 95]).tolist())
print("hole cols p5/p50/p95:", np.percentile(xs, [5, 50, 95]).tolist())
print("hair rows p5/p50/p95:",
      np.percentile(np.where(hair)[0], [5, 50, 95]).tolist())
print("hair cols p5/p50/p95:",
      np.percentile(np.where(hair)[1], [5, 50, 95]).tolist())

# overlay: beauty + hair tint + holes red
beauty = np.asarray(Image.open(BASE / "profile_90.png").convert("RGB"))
ov = beauty.copy().astype(float) * 0.55
ov[hair] = ov[hair] * 0.4 + np.array([40, 180, 255]) * 0.6
ov[hole] = np.array([255, 30, 30])
Image.fromarray(ov.astype(np.uint8)).save(E / "holes-overlay.png")
print("WROTE", E / "holes-overlay.png")

# largest-hole crop for reading
n2, lab2, st2, _ = cv2.connectedComponentsWithStats(hole.astype(np.uint8), connectivity=8)
big = 1 + int(np.argmax(st2[1:, cv2.CC_STAT_AREA]))
x, y, w, h, area = (int(st2[big, cv2.CC_STAT_LEFT]), int(st2[big, cv2.CC_STAT_TOP]),
                    int(st2[big, cv2.CC_STAT_WIDTH]), int(st2[big, cv2.CC_STAT_HEIGHT]),
                    int(st2[big, cv2.CC_STAT_AREA]))
print("largest hole bbox x,y,w,h,area:", x, y, w, h, area)
pad = 60
x0, y0 = max(x - pad, 0), max(y - pad, 0)
crop = ov[y0:y + h + pad, x0:x + w + pad]
Image.fromarray(crop.astype(np.uint8)).save(E / "holes-largest-crop.png")
np.save(E / "hole-mask.npy", hole)
print("WROTE largest crop", (x0, y0, x + w + pad, y + h + pad))
