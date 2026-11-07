#!/usr/bin/env python3
"""hair-groom15 depth probe: child skull-SDF p50/p90/std per band from
an npz, compared against E/guide-depth.json (the causal-chain reference).

Same shell-arc definition as score15 depth bands (arc 10-80 mm).
No render needed. Usage: python3 depthprobe15.py <strands.npz> [tag]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
from children import sdf_sampler  # noqa: E402

SDFP = ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz"
GUIDE_DEPTH = E / "guide-depth.json"


def depth_bands(pts, sample):
    seg = np.linalg.norm(np.diff(pts, axis=1), axis=2)
    arc = np.concatenate([np.zeros((len(pts), 1)),
                          np.cumsum(seg, axis=1)], axis=1)
    shell = (arc >= 0.010) & (arc <= 0.080)
    flatp = pts[:, 1:, :].reshape(-1, 3)
    vals, inside = sample(flatp)
    vals = np.where(inside, vals, np.nan)
    bandm = {"parietal": (np.abs(pts[:, 0, 0] * 1000.0) >= 50.0)
             & (np.abs(pts[:, 0, 0] * 1000.0) < 85.0),
             "temple": (np.abs(pts[:, 0, 0] * 1000.0) >= 35.0)
             & (np.abs(pts[:, 0, 0] * 1000.0) < 85.0)
             & (pts[:, 0, 1] * 1000.0 >= -135.0)
             & (pts[:, 0, 1] * 1000.0 < -40.0),
             "crown": pts[:, 0, 2] >= 1.60,
             "back": pts[:, 0, 1] > 0.0342}
    dd = {}
    for bn, bm in bandm.items():
        sel = (shell[:, 1:] & bm[:, None]).reshape(-1)
        v = vals.reshape(-1)[sel]
        v = v[np.isfinite(v)]
        dd[bn] = {"n": int(v.size),
                  "p50": round(float(np.percentile(v, 50)), 3)
                  if v.size else 0.0,
                  "p90": round(float(np.percentile(v, 90)), 3)
                  if v.size else 0.0,
                  "std": round(float(v.std()), 3) if v.size else 0.0}
    return dd


def main():
    p = Path(sys.argv[1])
    tag = sys.argv[2] if len(sys.argv) > 2 else p.stem
    doc = np.load(str(p), allow_pickle=True)
    pts = np.asarray(doc["points"], dtype=np.float64)
    sample, _ = sdf_sampler(np.load(str(SDFP), allow_pickle=True))
    dd = depth_bands(pts, sample)
    print(json.dumps({tag: dd}, indent=1))
    if GUIDE_DEPTH.exists():
        ref = json.loads(GUIDE_DEPTH.read_text())["bands"]
        for bn in ("parietal", "temple"):
            g = ref[bn]
            c = dd[bn]
            print("DEPTH %s %-9s guide p50=%.2f p90=%.2f std=%.2f | "
                  "child p50=%.2f p90=%.2f std=%.2f | "
                  "p50 ratio=%.3f p90 ratio=%.3f std ratio=%.3f" % (
                      tag, bn, g["p50"], g["p90"], g["std"],
                      c["p50"], c["p90"], c["std"],
                      c["p50"] / g["p50"], c["p90"] / g["p90"],
                      c["std"] / max(g["std"], 1e-9)))
    print("PROBE %s parietal %s temple %s" % (
        tag, dd["parietal"], dd["temple"]))


if __name__ == "__main__":
    main()
