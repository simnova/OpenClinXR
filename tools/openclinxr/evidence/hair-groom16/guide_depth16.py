#!/usr/bin/env python3
"""hair-groom16 STEP 1 (cleared guides): guide-depth reference E/guide-depth.json.

Skull-SDF p50/p90/std per band (parietal, temple, crown, back) over the
guides-8a guide samples, arc 10-80 mm, the SAME sampling as the scorer's
depth measure (score15.py depth bands). This is the input of the causal
chain: child depth gates compare against these values.

Guides are head-space (curves_head) with crown; converted to world with
the same head_to_world transform blender_children.py uses.

Usage: python3 guide_depth16.py [--guides PATH] [--out PATH]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys_path = str(ROOT / "tools/openclinxr/hair-groom/strands")
import sys  # noqa: E402
sys.path.insert(0, sys_path)
from children import sdf_sampler  # noqa: E402

SDFP = ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz"
GUIDES = ROOT / "tools/openclinxr/evidence/hair-groom16/build/guides-cleared.npz"


def head_to_world(pts_head, crown):
    pts = np.asarray(pts_head, dtype=np.float64)
    world = np.empty_like(pts)
    world[..., 0] = pts[..., 0] / 1000.0
    world[..., 1] = float(crown[1]) - pts[..., 1] / 1000.0
    world[..., 2] = float(crown[2]) - pts[..., 2] / 1000.0
    return world


def band_masks(pts):
    r = pts[:, 0, :]
    return {
        "parietal": (np.abs(r[:, 0] * 1000.0) >= 50.0)
        & (np.abs(r[:, 0] * 1000.0) < 85.0),
        "temple": (np.abs(r[:, 0] * 1000.0) >= 35.0)
        & (np.abs(r[:, 0] * 1000.0) < 85.0)
        & (r[:, 1] * 1000.0 >= -135.0)
        & (r[:, 1] * 1000.0 < -40.0),
        "crown": r[:, 2] >= 1.60,
        "back": r[:, 1] > 0.0342,
    }


def band_stats(pts, sample):
    seg = np.linalg.norm(np.diff(pts, axis=1), axis=2)
    arc = np.concatenate([np.zeros((len(pts), 1)),
                          np.cumsum(seg, axis=1)], axis=1)
    shell = (arc >= 0.010) & (arc <= 0.080)
    flatp = pts[:, 1:, :].reshape(-1, 3)
    vals, inside = sample(flatp)
    vals = np.where(inside, vals, np.nan)
    out = {}
    for bn, bm in band_masks(pts).items():
        sel = (shell[:, 1:] & bm[:, None]).reshape(-1)
        v = vals.reshape(-1)[sel]
        v = v[np.isfinite(v)]
        out[bn] = {
            "n": int(v.size),
            "p50": round(float(np.percentile(v, 50)), 3) if v.size else 0.0,
            "p90": round(float(np.percentile(v, 90)), 3) if v.size else 0.0,
            "std": round(float(v.std()), 3) if v.size else 0.0,
            "min": round(float(v.min()), 3) if v.size else 0.0,
            "max": round(float(v.max()), 3) if v.size else 0.0,
        }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--guides", default=str(GUIDES))
    ap.add_argument("--out", default=str(E / "guide-depth.json"))
    args = ap.parse_args()
    doc = np.load(args.guides, allow_pickle=True)
    crown = np.asarray(doc["crown"], dtype=np.float64)
    gw = head_to_world(np.asarray(doc["curves_head"], dtype=np.float64), crown)
    sample, _ = sdf_sampler(np.load(str(SDFP), allow_pickle=True))
    stats = band_stats(gw, sample)
    out = {"guides": str(args.guides), "units": "m",
           "arcMm": [10, 80], "nGuides": int(gw.shape[0]),
           "bands": stats}
    Path(args.out).write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1))
    print("GUIDE_DEPTH_DONE")


if __name__ == "__main__":
    main()
