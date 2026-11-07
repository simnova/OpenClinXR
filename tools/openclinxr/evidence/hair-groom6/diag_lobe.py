#!/usr/bin/env python3
"""Diagnose lobe-box strands + 3q-frizz dotted strands on current build."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
E6 = ROOT / "tools/openclinxr/evidence/hair-groom6"
R6 = E6 / "renders-studio"
G6 = E6 / "build" / "strands.npz"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
CAMS = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"
PINNA = ROOT / "tools/openclinxr/evidence/hair-hull3/workspace/ear_pinna.npz"
ROOTS = ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz"

cams = json.loads(CAMS.read_text())
sensor = float(cams["sensorWidthMm"])
PROJ = {}
for v in ("three_quarter", "profile_90"):
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


pdoc = np.load(PINNA, allow_pickle=True)
pin = {s: np.asarray(pdoc["xyz"], dtype=np.float64)[np.asarray(pdoc[k])]
       for s, k in (("xpos", "idx_earXpos"), ("xneg", "idx_earXneg"))}
rdoc = np.load(str(ROOTS), allow_pickle=True)
rxyz = np.asarray(rdoc["xyz"], dtype=np.float64)
D = np.load(str(G6), allow_pickle=True)
pts = np.asarray(D["points"], dtype=np.float64)
rad = np.asarray(D["radii"], dtype=np.float64)
par = np.asarray(D["parent"], dtype=np.int64)
n, P, _ = pts.shape
b6 = json.loads((E6 / "build.json").read_text())
K = 13
nK = 14155 * K
nP = 5838
nH = b6["hemEdgeExtra"]["nExtra"]
print("layout: K=%d partX=%d hemX=%d curX=%d-%d" % (
    nK, nK + nP, nK + nP + nH, nK + nP + nH, n), flush=True)

flat = pts[:, 1:, :].reshape(-1, 3)
vis = (rad[:, 1:].reshape(-1) > 1e-6)
sid = np.repeat(np.arange(n), P - 1)
visfrac = vis.reshape(n, P - 1).mean(axis=1)

for view in ("three_quarter", "profile_90"):
    a = np.array(Image.open(R6 / (view + "-id.png"))
                 .convert("RGBA"))[:, :, 3]
    for side in ("xpos", "xneg"):
        cc, rr, dd = project(pin[side], view)
        ok = ((cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024) & (dd > 0))
        c0, r0 = float(cc[ok].mean()), float(rr[ok].mean())
        bot = float(rr[ok].max())
        med = float(np.median(cc[ok]))
        toward = 1.0 if 512.0 >= med else -1.0
        cA = int(med + toward * 2)
        cB = int(med + toward * 45)
        lo, hi = sorted([cA, cB])
        r0b, r1b = int(bot) - 10, int(bot) + 60
        bm = np.zeros((1024, 1024), dtype=bool)
        bm[max(r0b, 0):min(r1b, 1024), max(lo, 0):min(hi, 1024)] = True
        hpx = int((bm & (a >= 230)).sum())
        fcc, frr, fdd = project(flat, view)
        inb = (fcc >= lo) & (fcc < hi) & (frr >= r0b) & (frr < r1b)
        hit = inb & vis
        sids = np.unique(sid[hit]) if hit.any() else np.array([], int)
        print("LOBE %s/%s box r[%d,%d] c[%d,%d]: hairPx=%d nStrands=%d"
              % (view, side, r0b, r1b, lo, hi, hpx, len(sids)), flush=True)
        if len(sids):
            pr = par[sids]
            roots = rxyz[pr]
            sb = ((np.abs(roots[:, 0]) >= 0.035)
                  & (np.abs(roots[:, 0]) < 0.100))
            print("  root x[q]=%s y[q]=%s z[q]=%s" % (
                np.quantile(roots[:, 0] * 1000, [0, .5, 1]).round(1),
                np.quantile(roots[:, 1] * 1000, [0, .5, 1]).round(1),
                np.quantile(roots[:, 2] * 1000, [0, .5, 1]).round(1)),
                flush=True)
            print("  K-block=%d partX=%d hemX=%d curX=%d visFracP50=%.2f" % (
                int((sids < nK).sum()),
                int(((sids >= nK) & (sids < nK + nP)).sum()),
                int(((sids >= nK + nP) & (sids < nK + nP + nH)).sum()),
                int((sids >= nK + nP + nH).sum()),
                round(float(np.median(visfrac[sids])), 2)), flush=True)
            print("  rootIds[:40]=%s" % (sorted(set(pr.tolist()))[:40],),
                  flush=True)

# 3q frizz box dotted strands: visible samples in box + heavily trimmed
a3 = np.array(Image.open(R6 / "three_quarter-id.png")
              .convert("RGBA"))[:, :, 3]
bm = np.zeros((1024, 1024), dtype=bool)
bm[350:520, 400:560] = True
solid = bm & (a3 >= 230)
lab, _ = ndimage.label(solid)
sz = np.bincount(lab.ravel())
iso = np.isin(lab, np.nonzero(sz[1:] < 30)[0] + 1) if len(sz) > 1 else None
print("3Q frizzbox: solid=%d iso=%d" % (
    int(solid.sum()), int(iso.sum()) if iso is not None else 0), flush=True)
fcc, frr, fdd = project(flat, "three_quarter")
inb = (fcc >= 400) & (fcc < 560) & (frr >= 350) & (frr < 520)
hit = inb & vis
sids = np.unique(sid[hit]) if hit.any() else np.array([], int)
print("3Q box strands=%d" % len(sids), flush=True)
if len(sids):
    vf = visfrac[sids]
    dotty = sids[vf < 0.2]
    print("heavily-trimmed (vis<0.2): %d" % len(dotty), flush=True)
    if len(dotty):
        pr = par[dotty]
        print("  dotty K=%d partX=%d hemX=%d curX=%d" % (
            int((dotty < nK).sum()),
            int(((dotty >= nK) & (dotty < nK + nP)).sum()),
            int(((dotty >= nK + nP) & (dotty < nK + nP + nH)).sum()),
            int((dotty >= nK + nP + nH).sum())), flush=True)
        print("  dotty rootIds[:30]=%s" % (sorted(set(pr.tolist()))[:30],),
              flush=True)
