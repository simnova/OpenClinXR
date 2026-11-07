#!/usr/bin/env python3
"""Diagnose foe-xneg rise + part-corridor long crossers (groom5 vs groom6)."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
G5 = Path("/Volumes/files/src/openclinxr/.openclinxr/asset-production"
          "/hair-groom5/strands.npz")
G6 = ROOT / "tools/openclinxr/evidence/hair-groom6/build/strands.npz"
CAMS = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"
PINNA = ROOT / "tools/openclinxr/evidence/hair-hull3/workspace/ear_pinna.npz"
ROOTS = ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz"
GTUCK = ROOT / "tools/openclinxr/evidence/hair-groom4/tucked/guides-tucked.npz"
EFRAME = ROOT / "tools/openclinxr/evidence/hair-groom4/tucked/earframe.json"
B5 = json.loads((ROOT / "tools/openclinxr/evidence/hair-groom5/build.json")
                .read_text())
B6 = json.loads((ROOT / "tools/openclinxr/evidence/hair-groom6/build.json")
                .read_text())

cams = json.loads(CAMS.read_text())
sensor = float(cams["sensorWidthMm"])
PROJ = {}
for v in ("profile_90", "three_quarter"):
    M = np.array(cams["views"][v]["matrixWorld"], dtype=np.float64)
    f = float(cams["views"][v]["lensMm"]) / sensor * 1024.0
    PROJ[v] = (np.linalg.inv(M), f)


def project(pts, v):
    inv, f = PROJ[v]
    pts = np.asarray(pts, dtype=np.float64)
    hw = np.ones((len(pts), 4))
    hw[:, :3] = pts
    lc = (inv @ hw.T).T
    dep = -lc[:, 2]
    cc = np.full(len(pts), -1.0)
    rr = np.full(len(pts), -1.0)
    ok = dep > 0
    cc[ok] = 512.0 + (lc[ok, 0] / dep[ok]) * f
    rr[ok] = 512.0 - (lc[ok, 1] / dep[ok]) * f
    return cc, rr, dep


from scipy.spatial import ConvexHull as _CH, Delaunay as _DE  # noqa: E402

pdoc = np.load(PINNA, allow_pickle=True)
pin = {s: np.asarray(pdoc["xyz"], dtype=np.float64)[np.asarray(pdoc[k])]
       for s, k in (("xpos", "idx_earXpos"), ("xneg", "idx_earXneg"))}
rdoc = np.load(str(ROOTS), allow_pickle=True)
rxyz = np.asarray(rdoc["xyz"], dtype=np.float64)

for view in ("profile_90", "three_quarter"):
    for side in ("xneg",):
        cc, rr, dd = project(pin[side], view)
        ok = ((cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024) & (dd > 0))
        pd = float(np.median(dd[ok]))
        top = float(rr[ok].min())
        p2 = np.stack([cc[ok], rr[ok]], axis=1)
        tri = _DE(p2[_CH(p2).vertices])
        for tag, Gp, Bp in (("groom5", G5, B5), ("groom6", G6, B6)):
            D = np.load(str(Gp), allow_pickle=True)
            pts = np.asarray(D["points"], dtype=np.float64)
            rad = np.asarray(D["radii"], dtype=np.float64)
            n, P, _ = pts.shape
            par = np.asarray(D["parent"], dtype=np.int64) \
                if "parent" in D.files else None
            flat = pts[:, 1:, :].reshape(-1, 3)
            fcc, frr, fdd = project(flat, view)
            inside = tri.find_simplex(np.stack([fcc, frr], axis=1)) >= 0
            ant = inside & (rad[:, 1:].reshape(-1) > 1e-6) \
                & (fdd < pd - 0.003) & (frr <= top + 100.0)
            sids = np.unique(np.repeat(np.arange(n), P - 1)[ant]) \
                if ant.any() else np.array([], int)
            print("%s %s/%s foe strands=%d" % (tag, view, side, len(sids)),
                  flush=True)
            if par is not None and len(sids):
                proots = par[sids]
                qy = np.quantile(rxyz[proots][:, 1] * 1000,
                                 [0, .5, 1]).round(1).tolist()
                qz = np.quantile(rxyz[proots][:, 2] * 1000,
                                 [0, .5, 1]).round(1).tolist()
                print("  root y[q0/50/100]=%s z[q]=%s |x|p50=%.1fmm"
                      % (qy, qz, float(np.median(
                          np.abs(rxyz[proots][:, 0])) * 1000)),
                      flush=True)
                # extras vs K-block?
                K = 13
                nK = 14155 * K
                print("  in K-block: %d partExtra: %d hemExtra+cExtra: %d"
                      % (int((sids < nK).sum()),
                         int(((sids >= nK)
                              & (sids < nK + 5838)).sum()),
                         int((sids >= nK + 5838).sum())), flush=True)
                hh = np.nonzero(np.isin(
                    np.unique(proots),
                    np.nonzero((np.abs(rxyz[:, 0]) >= 0.058)
                               & (rxyz[:, 1] >= -0.060)
                               & (rxyz[:, 1] <= 0.0342))[0]))[0]
                print("  n unique roots=%d of which hem-roots=%d"
                      % (len(np.unique(proots)), len(hh)), flush=True)

# part-corridor long crossers in groom6 (arc 40-120mm across part plane)
part_x = float(B6["part"]["partX"])
D = np.load(str(G6), allow_pickle=True)
pts = np.asarray(D["points"], dtype=np.float64)
rad = np.asarray(D["radii"], dtype=np.float64)
n, P, _ = pts.shape
par = np.asarray(D["parent"], dtype=np.int64)
rside = np.where(rxyz[:, 0] >= part_x, 1.0, -1.0)[par]
arc = np.zeros((n, P))
arc[:, 1:] = np.cumsum(np.linalg.norm(np.diff(pts, axis=1), axis=2), axis=1)
xs = pts[:, :, 0] - part_x
vis = rad[:, 1:] > 1e-6
for lo, hi in ((0.040, 0.120), (0.120, 0.300)):
    band = (arc[:, 1:] >= lo) & (arc[:, 1:] < hi)
    hit = band & ((xs[:, 1:] >= 0) != (rside >= 0)[:, None]) & vis
    sids = np.unique(np.repeat(np.arange(n), P - 1)[hit.reshape(-1)]) \
        if hit.any() else np.array([], int)
    print("corridor arc %d-%dmm: strands=%d samples=%d" % (
        int(lo * 1000), int(hi * 1000), len(sids), int(hit.sum())),
        flush=True)
