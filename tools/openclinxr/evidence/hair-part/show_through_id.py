"""ID-mask show-through clause (hair-part-1 M5; judge J is read-only, untouched).

Show-through from the hair ID mask: inside the hair hull above the brow row,
fraction of pixels with hair coverage < 0.5. Hull = per-row scanline fill
between the leftmost and rightmost hair pixel of each row in
[crown_row, brow_row). The face opening = the non-hair region 4-connected to
the brow-row centre pixel (same definition as hair_judge.opening_connected,
reimplemented here so this file is standalone) is excluded from the region.

Hair pixel: RGBA alpha >= 0.5, else (RGB/L) mean > 0.5. Brow row =
crown + 0.40 * (chin - crown) (judge BROW_FRAC).

Usage:
  python3 show_through_id.py --mask front-id.png --landmarks 103,583,512
  python3 show_through_id.py --mask front-id.png --landmarks 103,583,512 --json
"""
from __future__ import annotations

import argparse
import json
from collections import deque

import numpy as np
from PIL import Image

BROW_FRAC = 0.40


def load_coverage(path):
    """Return float coverage array in [0,1] (H,W)."""
    im = Image.open(path)
    if im.mode == "RGBA":
        a = np.array(im)[:, :, 3].astype(np.float64) / 255.0
        return a
    g = np.array(im.convert("L")).astype(np.float64) / 255.0
    return g


def opening_connected(nonhair, seed_row, centre):
    """Non-hair pixels 4-connected to the seed (brow-row centre).

    Seed = contiguous non-hair run containing centre at seed_row (the face
    hole). Empty when the centre pixel itself is hair.
    """
    H, W = nonhair.shape
    r0 = min(max(int(seed_row), 0), H - 1)
    c0 = min(max(int(centre), 0), W - 1)
    if not nonhair[r0, c0]:
        return np.zeros_like(nonhair, dtype=bool)
    row = nonhair[r0]
    lo = c0
    while lo - 1 >= 0 and row[lo - 1]:
        lo -= 1
    hi = c0
    while hi + 1 < W and row[hi + 1]:
        hi += 1
    seen = np.zeros_like(nonhair, dtype=bool)
    q = deque()
    for c in range(lo, hi + 1):
        seen[r0, c] = True
        q.append((r0, c))
    while q:
        r, c = q.popleft()
        if r > 0 and nonhair[r - 1, c] and not seen[r - 1, c]:
            seen[r - 1, c] = True
            q.append((r - 1, c))
        if r + 1 < H and nonhair[r + 1, c] and not seen[r + 1, c]:
            seen[r + 1, c] = True
            q.append((r + 1, c))
        if c > 0 and nonhair[r, c - 1] and not seen[r, c - 1]:
            seen[r, c - 1] = True
            q.append((r, c - 1))
        if c + 1 < W and nonhair[r, c + 1] and not seen[r, c + 1]:
            seen[r, c + 1] = True
            q.append((r, c + 1))
    return seen


def show_through_id(mask_path, crown_row, chin_row, centre_col,
                    brow_frac=BROW_FRAC):
    """Return dict with fraction / region_px / nonhair_px / brow_row."""
    cov = load_coverage(mask_path)
    H, W = cov.shape
    hair = cov >= 0.5
    nonhair = ~hair
    Hh = float(chin_row - crown_row)
    brow = int(round(crown_row + brow_frac * Hh))
    r0 = min(max(int(round(crown_row)), 0), H - 1)
    r1 = min(max(brow, 0), H)
    region = 0
    nonhair_n = 0
    for y in range(r0, r1):
        xs = np.nonzero(hair[y])[0]
        if len(xs) == 0:
            continue
        lo, hi = int(xs.min()), int(xs.max())
        if lo > hi:
            continue
        region += hi - lo + 1
        nonhair_n += int(nonhair[y, lo:hi + 1].sum())
    opening = opening_connected(nonhair, brow, int(centre_col))
    open_n = 0
    open_nonhair = 0
    for y in range(r0, r1):
        xs = np.nonzero(hair[y])[0]
        if len(xs) == 0:
            continue
        lo, hi = int(xs.min()), int(xs.max())
        seg = opening[y, lo:hi + 1]
        open_n += int(seg.sum())
        open_nonhair += int(seg.sum())  # opening cells are non-hair by construction
    region_ex = region - open_n
    nonhair_ex = nonhair_n - open_nonhair
    frac = (nonhair_ex / region_ex) if region_ex else 0.0
    return {"fraction": float(frac), "region_px": int(region_ex),
            "nonhair_px": int(nonhair_ex), "brow_row": int(brow),
            "region_raw_px": int(region), "opening_px": int(open_n)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--mask", required=True)
    ap.add_argument("--landmarks", required=True,
                    help="crown_row,chin_row,centre_col")
    ap.add_argument("--brow-frac", type=float, default=BROW_FRAC)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    crown, chin, centre = [float(x) for x in a.landmarks.split(",")]
    r = show_through_id(a.mask, crown, chin, centre, a.brow_frac)
    if a.json:
        print(json.dumps(r, sort_keys=True))
    else:
        print("ID show-through %.4f (region %dpx nonhair %dpx brow %d opening %dpx)"
              % (r["fraction"], r["region_px"], r["nonhair_px"],
                 r["brow_row"], r["opening_px"]))
    return r


if __name__ == "__main__":
    main()
