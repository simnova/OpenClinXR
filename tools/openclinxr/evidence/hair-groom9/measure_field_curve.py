#!/usr/bin/env python3
"""groom9 prep: measure the orientation field's OWN along-streamline
curvature (pure field-following, no steering/depth/projection), so the
total-turn budget is target-consistent rather than fitted.

Integrates RK-midpoint 1 mm streamlines from the groom8a guide roots
following ONLY the field (sign-aligned to travel), 600 steps max, and
reports cumulative |turn| over arc past the crown take-off (arc>25mm):
p50/p95/max. The budget must sit above the field's own curvature but
far below the pathological 400-495 deg guide totals named in 8b.
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
dense = np.zeros(tuple(dense_shape := idx.max(axis=0) + 1) + (3,),
                 dtype=np.float32)
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
                      crown) * 1000.0  # mm, world
roots = gw[:2650, 0, :].copy()  # new-guide roots only (tuck verbatim excluded)

def fdir(p, travel):
    v = np.array([s(p[None, :], order=1)[0] for s in s_dir])
    if not np.isfinite(v).all():
        return None
    n = np.linalg.norm(v)
    if n < 1e-9:
        return None
    v /= n
    return v if (v * travel).sum() >= 0 else -v

tots = []
n_coast = 0
for j in range(len(roots)):
    p = roots[j].copy()
    travel = fdir(p, np.array([0.0, 0.0, 1.0]))
    if travel is None:
        continue
    ff = travel.copy()  # s06 field-follow state: low-pass 20%/step
    cum = 0.0
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
            n_coast += 1  # singular spin: coast straight through
        else:
            ff = 0.2 * fn + 0.8 * ff
            ff = ff / (np.linalg.norm(ff) + 1e-12)
        d1 = ff
        if (d1 * travel).sum() < 0:
            d1 = -d1
        cos_a = float(np.clip((d1 * travel).sum(), -1, 1))
        ang = float(np.degrees(np.arccos(cos_a)))
        arc += 1.0
        if arc > 25.0:
            cum += ang
        p = p + d1
        travel = d1
    tots.append(cum)
tots = np.array(tots)
print("coast=%d" % n_coast)
print("pure-field total-turn past 25mm arc: n=%d p50=%.1f p95=%.1f max=%.1f" % (
    len(tots), float(np.percentile(tots, 50)),
    float(np.percentile(tots, 95)), float(tots.max())))
# same stat restricted to the 8b knot region roots
tuck = np.asarray(G["tuck"], dtype=np.float64)[:len(tots)]
r = roots[:len(tots)]
region = (r[:, 0] < -15.0) & (r[:, 0] > -100.0) & (r[:, 1] >= -60.0) \
    & (r[:, 1] <= 34.2) & (r[:, 2] > 1600.0) & (tuck < 0.5)
print("knot-region roots: %d pure-field p50=%.1f p95=%.1f max=%.1f" % (
    int(region.sum()), float(np.percentile(tots[region], 50)),
    float(np.percentile(tots[region], 95)), float(tots[region].max())))
