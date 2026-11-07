#!/usr/bin/env python3
"""hair-cover1 STEP 2b: c_den2 (short under-fibres) + best (den2+rad) (system python).

c_den2: duplicate hole-zone curtain fibres as SHORTER under-fibres: take arc
  idx 0..24, resample to 32 pts (no degenerate segments), deterministic
  y-jitter +-0.5mm (profile-column fill), x untouched. No tips at the fringe
  -> cannot solidify hem wisps (c_den's measured back -0.032 mechanism).
best: c_den2 points + c_rad radii on zone fibres (originals arc 4..26 x1.7;
  duplicates arc 5..30 x1.7 = same physical mid-shaft band).
"""
import json
import numpy as np
from pathlib import Path

E = Path("tools/openclinxr/evidence/hair-cover1")
src = np.load(E / "base/strands.npz")
P0 = np.asarray(src["points"], float)
R0 = np.asarray(src["roots"], float)
RAD0 = np.asarray(src["radii"])
N = len(P0)

ZI = np.load(E / "zone2_idx.npy")
print("zone fibres:", len(ZI))


def resample_short(pts):
    """pts (F,25,3) arc 0..24 -> (F,32,3) by arc-length linear interp."""
    out = np.empty((len(pts), 32, 3))
    for k in range(len(pts)):
        p = pts[k]
        seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
        arc = np.r_[0.0, np.cumsum(seg)]
        want = np.linspace(0.0, arc[-1], 32)
        for c in range(3):
            out[k, :, c] = np.interp(want, arc, p[:, c])
    return out


def resample_vec(v):
    out = np.empty((len(v), 32), np.float32)
    x = np.linspace(0, 24, 32)
    xi = np.arange(25)
    for k in range(len(v)):
        out[k] = np.interp(x, xi, v[k])
    return out


short_pts = resample_short(P0[ZI][:, 0:25])
short_rad = resample_vec(np.asarray(RAD0[ZI][:, 0:25], float))

rng = np.random.default_rng(3303)
r = rng.random(len(ZI))
jy = np.where(r > 0.5, 1.0, -1.0) * (0.0002 + 0.0003 * rng.random(len(ZI)))
short_pts[:, :, 1] += jy[:, None]
short_roots = R0[ZI].copy()
short_roots[:, 1] += jy

den2_pts = np.vstack([P0, short_pts])
den2_roots = np.vstack([R0, short_roots])
den2_rad = np.vstack([RAD0, short_rad])

# best radii: zone originals arc 4..26 x1.7; dup short-fibres arc 5..30 x1.7
best_rad = den2_rad.copy().astype(np.float64)
zone_all = np.zeros(len(den2_pts), bool)
zone_all[ZI] = True
best_rad[zone_all, 4:27] *= 1.7
best_rad[N:, 5:31] *= 1.7

for tag, pts, roots, rad, info in [
    ("c_den2", den2_pts, den2_roots, den2_rad,
     {"cell": "c_den2", "dupFibres": int(len(ZI)),
      "form": "arc 0..24 resampled to 32 (short under-fibres, no fringe tips)",
      "jitterYmm": "0.2..0.5 det, x 0", "totalFibres": int(len(den2_pts))}),
    ("best", den2_pts, den2_roots, best_rad,
     {"cell": "best", "combo": "c_den2 points + c_rad radii on zone",
      "totalFibres": int(len(den2_pts))}),
]:
    cell = E / "cells" / tag
    cell.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cell / "strands_waved.npz",
                        points=pts.astype(np.float32),
                        roots=roots.astype(np.float32),
                        radii=np.asarray(rad, dtype=np.float32),
                        apex_y=np.asarray(src["apex_y"]), cx=np.asarray(src["cx"]))
    (cell / "deform_meta.json").write_text(json.dumps(info, indent=2) + "\n")
    print("CELL", tag, "n =", len(pts), flush=True)
