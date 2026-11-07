#!/usr/bin/env python3
"""groom9 prep 2: region-wise orientation-field along-streamline
curvature in CHORD space (5 mm chords, tracer's damped 20% follow +
45-deg whorl coast, no steering). Take-off excluded (arc > 40 mm):
the budget must not bind the scalp-normal -> sweep take-off bend.

Regions by guide root (mm world): faceframe (temple/hairline take-off),
crown (part zone), back (drape), other. Budget per region = ceil(p95).
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/orient"))
import common_o as CO  # noqa: E402

E0 = ROOT / "tools/openclinxr/evidence/hair-orient0"
F = np.load(str(E0 / "field.npz"))
hull = np.load(str(ROOT / "tools/openclinxr/evidence/hair-hull5/hull.npz"),
               allow_pickle=True)
xs = np.array(hull["xs"]); ys = np.array(hull["ys"]); zs = np.array(hull["zs"])
spacing = float(hull["spacing"])
origin = np.array([xs[0], ys[0], zs[0]])
idx = np.array(F["idx"])
tdir = np.array(F["dir"], dtype=np.float32)
dense = np.zeros(tuple(idx.max(axis=0) + 1) + (3,), dtype=np.float32)
dense[idx[:, 0], idx[:, 1], idx[:, 2]] = tdir

def tri_sampler(grid):
    def sample(pts, order=1, cval=np.nan):
        pts = np.asarray(pts, dtype=np.float64)
        g = ((pts - origin) / spacing).T
        return ndimage.map_coordinates(grid, g, order=order,
                                       cval=cval, mode="constant")
    return sample

s_dir = [tri_sampler(dense[..., i]) for i in range(3)]
G = np.load(str(ROOT / "tools/openclinxr/evidence/hair-groom8a/build/guides-8a.npz"),
            allow_pickle=True)
crown = np.asarray(G["crown"], dtype=np.float64)
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
import frames as FR  # noqa: E402
gw = FR.head_to_world(np.asarray(G["curves_head"], dtype=np.float64),
                      crown) * 1000.0
roots = gw[:2650, 0, :].copy()

def fdir(p, travel):
    v = np.array([s(p[None, :], order=1)[0] for s in s_dir])
    if not np.isfinite(v).all():
        return None
    n = np.linalg.norm(v)
    if n < 1e-9:
        return None
    v /= n
    return v if (v * travel).sum() >= 0 else -v

def region_of(r):
    if 35.0 <= abs(r[0]) < 100.0 and r[1] < -40.0:
        return "faceframe"
    if r[2] > 1600.0 and -60.0 <= r[1] <= 34.2:
        return "crown"
    if r[1] > 34.2:
        return "back"
    return "other"

acc = {"faceframe": [], "crown": [], "back": [], "other": []}
for j in range(len(roots)):
    r0 = roots[j]
    p = r0.copy()
    travel = fdir(p, np.array([0.0, 0.0, 1.0]))
    if travel is None:
        continue
    ff = travel.copy()
    pts = [p.copy()]
    arc = 0.0
    for _ in range(600):
        d0 = fdir(p, travel)
        if d0 is None:
            break
        pm = p + d0 * 0.5
        fn = fdir(pm, d0)
        if fn is None:
            break
        if (fn * d0).sum() < 0:
            fn = -fn
        _curl = float(np.degrees(np.arccos(np.clip(
            (fn * ff).sum(), -1, 1))))
        if arc > 8.0 and _curl > 45.0:
            pass
        else:
            ff = 0.2 * fn + 0.8 * ff
            ff = ff / (np.linalg.norm(ff) + 1e-12)
        d1 = ff
        if (d1 * travel).sum() < 0:
            d1 = -d1
        p = p + d1
        travel = d1
        pts.append(p.copy())
        arc += 1.0
    pts = np.array(pts)
    # chord-space total past 40 mm
    cum = 0.0
    ref = None
    for k in range(0, len(pts) - 5, 5):
        if k + 5 <= 40:
            continue
        ch = pts[k + 5] - pts[k]
        n = np.linalg.norm(ch)
        if n < 1e-9:
            continue
        ch /= n
        if ref is not None:
            cum += float(np.degrees(np.arccos(np.clip(
                (ch * ref).sum(), -1, 1))))
        ref = ch
    acc[region_of(r0)].append(cum)

out = {}
for rg, v in acc.items():
    v = np.array(v)
    out[rg] = {"n": int(len(v)), "p50": round(float(np.percentile(v, 50)), 1),
               "p95": round(float(np.percentile(v, 95)), 1),
               "max": round(float(v.max()), 1),
               "budget": int(np.ceil(np.percentile(v, 95) / 10.0) * 10)}
print(json.dumps(out, indent=1))
