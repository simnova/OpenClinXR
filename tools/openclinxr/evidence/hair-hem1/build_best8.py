#!/usr/bin/env python3
"""hair-hem1 combo c_best7: DELETE rails + splayed edge dups + self-edge seal.

Last untested mechanism: prior cells moved/thinned rails but left their
diagonal shafts (bundle read) or broke front width. c_best7 removes the
10,604 rail fibres entirely and replaces them with 12k dups of neighbouring
edge fibres SPLAYED outward around their own roots (smooth root-pivot bend,
roots/drape preserved, tips land 4..12mm outward in rail territory, cap
|x|<=0.128), tips sealed to the self-edge curve -1mm; all other lower tips
sealed the same. No trim.
Self-edge = c_best3 empirical edge (per-bin median tip z, deg5, flat
outside, minus 1mm).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

E = Path("tools/openclinxr/evidence/hair-hem1")
S = 1024

src = np.load(E / "cells_source_best.npz")
P0 = np.asarray(src["points"], float)
R0 = np.asarray(src["roots"], float)
RAD0 = np.asarray(src["radii"])
APEX = float(np.asarray(src["apex_y"]))
tips = P0[:, -1]
rear = R0[:, 1] > APEX
RAIL = (~rear) & (np.abs(tips[:, 0]) > 0.10) & (tips[:, 2] < 1.42)
keep = ~RAIL
print("deleted rails:", int(RAIL.sum()), "kept:", int(keep.sum()), flush=True)
P1 = P0[keep].copy()
R1 = R0[keep].copy()
D1 = RAD0[keep].copy()

sc = json.load(open(E / "base" / "score.json"))
M = np.array(sc["render"]["cameras"]["back"]["matrixWorld"], float)
F = 50.0 / 36.0 * S
Minv = np.linalg.inv(M)
T1 = P1[:, -1]
SHEET = T1[:, 2] < 1.42
si = np.where(SHEET)[0]
flat = P1[si][:, -1]
Pc = (Minv @ np.concatenate(
    [flat, np.ones((len(flat), 1))], axis=1).T).T[:, :3]
uu = S / 2 + F * Pc[:, 0] / (-Pc[:, 2])
bins = np.arange(255, 771, 10)
cu, cz = [], []
for b0 in bins:
    m = (uu >= b0 - 15) & (uu < b0 + 15)
    if m.sum() < 30:
        continue
    cu.append(b0)
    cz.append(np.median(P1[si][m][:, -1, 2]))
cu, cz = np.array(cu), np.array(cz)
ePoly = np.polyfit(cu, cz, 5)
Ax = np.polyfit(uu, P1[si][:, -1, 0], 1)
U_MIN, U_MAX = float(cu.min()), float(cu.max())
EPS = 0.001


def edge_z(xtip):
    u = np.clip((np.asarray(xtip, float) - Ax[1]) / Ax[0], U_MIN, U_MAX)
    return np.polyval(ePoly, u) - EPS


t = np.linspace(0, 1, 8)
ramp = np.zeros(32)
ramp[24:] = t * t * (3 - 2 * t)


def seal(pts, idx):
    pred = edge_z(pts[idx][:, -1, 0])
    below = pts[idx][:, -1, 2] < (pred - 0.001)
    ni = idx[below]
    gap = pred[below] - pts[ni][:, -1, 2]
    pts[ni, :, 2] += gap[:, None] * ramp[None, :]
    return int(below.sum())


# splayed dups from kept edge pool
xm = np.abs(P1[:, 8:24, 0]).mean(axis=1)
rear1 = R1[:, 1] > APEX
ei = np.where((~rear1) & (xm >= 0.075) & (xm < 0.105)
              & (T1[:, 2] < 1.45))[0]
print("pool:", len(ei), flush=True)
stride = len(ei) / 12000
sel = ei[np.unique(np.clip((np.arange(12000) * stride).astype(int), 0,
                           len(ei) - 1))]
print("dups:", len(sel), flush=True)
rng = np.random.default_rng(7701)
sgn = np.sign(P1[sel][:, 16, 0])
sgn[sgn == 0] = 1.0
want_dx = sgn * (0.004 + 0.008 * rng.random(len(sel)))  # 4..12mm
dup = P1[sel].copy()
for k in range(len(sel)):
    base = P1[sel[k]]
    v = base - R1[sel[k]][None, :]
    leng = np.linalg.norm(v[-1]) + 1e-9
    th = -float(want_dx[k]) / leng     # outward splay (see meta)
    w = (np.arange(32) / 31.0) ** 1.5
    # rotate (x,z) about root by th*w (y-axis rotation, small angle approx
    # via exact per-point rotation to preserve length)
    ang = th * w
    ca, sa = np.cos(ang), np.sin(ang)
    x, z = v[:, 0].copy(), v[:, 2].copy()
    v[:, 0] = ca * x + sa * z
    v[:, 2] = -sa * x + ca * z
    dup[k] = R1[sel[k]][None, :] + v
over = np.abs(dup[:, :, 0]) > 0.128
dup[:, :, 0] = np.where(over, np.sign(dup[:, :, 0]) * 0.128, dup[:, :, 0])
dup_roots = R1[sel].copy()                  # roots stay on scalp
jy = (rng.random(len(sel)) - 0.5) * 0.0006
dup[:, :, 1] += jy[:, None]

LOW = np.where(P1[:, -1, 2] < 1.42)[0]
n_seal = seal(P1, LOW)
allp = np.vstack([P1, dup])
di = np.arange(len(P1), len(allp))[dup[:, -1, 2] < 1.42]
n_seal_dup = seal(allp, di)

cell = E / "cells" / "c_best8"
cell.mkdir(parents=True, exist_ok=True)
np.savez_compressed(
    cell / "strands_waved.npz", points=allp.astype(np.float32),
    roots=np.vstack([R1, dup_roots]).astype(np.float32),
    radii=np.vstack([D1, D1[sel]]).astype(np.float32),
    apex_y=np.asarray(src["apex_y"]), cx=np.asarray(src["cx"]))
info = {"cell": "best-combo-delete-splay-out",
        "splaySign": "outward: vee rotation x'=ca*x+sa*z with th=-dx/len "
                     "moves +x-side tips +x (z<0 below root); best7 had the "
                     "sign flipped (dups went inward)",
        "deletedRails": int(RAIL.sum()), "sealedLower": n_seal,
        "dupFibres": int(len(sel)), "sealedDups": n_seal_dup,
        "totalFibres": int(len(allp)),
        "rule": "rails deleted; 12k root-pivot-splayed (tips +4..12mm "
                "outward, cap 0.128) full-length edge dups; self-edge-1mm "
                "seal of all lower tips; no trim"}
(cell / "deform_meta.json").write_text(
    json.dumps({"tag": "c_best8", "base": "hair-hem1/base/strands.npz",
                "deform": info}, indent=2) + "\n")
print("CELL c_best8", json.dumps(info), flush=True)
