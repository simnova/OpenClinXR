#!/usr/bin/env python3
"""hair-groom8a round-2 diagnostics (numpy-only): guide ear clearance,
R-LOOP strand zones, B-side guide coverage, temple-tip roots."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
import sys
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
import frames as F

g = np.load(str(E / "build" / "guides-8a.npz"), allow_pickle=True)
ch = np.asarray(g["curves_head"], dtype=np.float64)
tuck = np.asarray(g["tuck"], dtype=np.float64) > 0.5
crown = np.asarray(g["crown"])
gw = F.head_to_world(ch, crown) * 1000.0  # world mm
n_new = int((~tuck).sum())
print("guides total=%d new=%d" % (len(ch), n_new))

pin = np.load(str(ROOT / "tools/openclinxr/evidence/hair-hull3/workspace"
                        "/ear_pinna.npz"), allow_pickle=True)
pall = np.vstack([np.asarray(pin["xyz"], dtype=np.float64)[
    np.asarray(pin["idx_earXpos"])],
    np.asarray(pin["xyz"], dtype=np.float64)[
    np.asarray(pin["idx_earXneg"])]]) * 1000.0
tree = cKDTree(pall)
# guide min pinna distance (new guides, all 41-pt samples)
dmin = np.empty(n_new)
cov = np.load(str(E / "build" / "strands.npz"), allow_pickle=True)
pts = np.asarray(cov["points"], dtype=np.float64).reshape(-1, 3) * 1000.0
for i, j in enumerate(np.nonzero(~tuck)[0]):
    dd, _ = tree.query(gw[j], k=1)
    dmin[i] = dd.min()
print("GUIDE ear minDist: p50=%.1f p5=%.1f min=%.1f nLt8=%d" % (
    np.percentile(dmin, 50), np.percentile(dmin, 5), dmin.min(),
    int((dmin < 8.0).sum())))

# B-side guide coverage: new-guide samples with y>vertex, by side, low third
m = (gw[~tuck][:, :, 1] > 34.2)
for sgn, nm in ((1.0, "xpos"), (-1.0, "xneg")):
    s = (gw[~tuck][:, :, 0] * sgn > 0) & m
    z = gw[~tuck][:, :, 2][s]
    print("drape %s: n=%d zmin=%.0f zp5=%.0f" % (nm, s.sum(), z.min(),
                                                 np.percentile(z, 5)))

# temple-tip roots: children tips in temple boxes off skin (reuse A boxes)
b6 = json.loads((ROOT / "tools/openclinxr/evidence/hair-groom6"
                       "/baseline.json").read_text())
s8 = json.load(open(str(E / "score8a.json")))
print("A-tips:", {k: v["tipsGt3mm"] for k, v in s8["A"].items()
                  if k.startswith("groom8a")})
print("R-LOOP groom8a:", s8["loopProfile"]["nProfile"], "noWrap:",
      s8["loopProfile"]["countNoWrapExclusion"])
