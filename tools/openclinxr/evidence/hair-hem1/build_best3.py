#!/usr/bin/env python3
"""hair-hem1 combo c_best3: SELF-edge seal + full-length edge dups.

Lesson from c_best/c_best2: the target-fitted curve via global v->zw
calibration misestimates the sides (depth-varying projection slope), so it
shortened cols 280-300 by 48 rows and left side rails plunging 70px below
the local edge. c_best3 instead seals to OUR OWN sheet edge, empirically:
  edge rows = per-10px-bin median tip rows of projected lower sheet fibres
  (back view), deg5 smooth over sheet cols 255-770, flat outside;
  edge z per bin = median tip z of the same fibres (no projection model).
Seal shorten-only to (edge z - 1mm, ~= ruler 2px tolerance) for all lower
tips (tip_z<1.42); plus 8k full-length edge dups (|x_mid| in
[0.080,0.100), outward 0.5..1.5mm cap 0.0995) sealed the same; no trim.
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

sc = json.load(open(E / "base" / "score.json"))
M = np.array(sc["render"]["cameras"]["back"]["matrixWorld"], float)
F = 50.0 / 36.0 * S
Minv = np.linalg.inv(M)

SHEET = (~RAIL) & (tips[:, 2] < 1.42)
si = np.where(SHEET)[0]
flat = P0[si][:, -1]
Pc = (Minv @ np.concatenate(
    [flat, np.ones((len(flat), 1))], axis=1).T).T[:, :3]
uu = S / 2 + F * Pc[:, 0] / (-Pc[:, 2])

# empirical edge: median tip z per 10px u-bin over sheet cols
bins = np.arange(255, 771, 10)
cu, cz = [], []
for b0 in bins:
    m = (uu >= b0 - 15) & (uu < b0 + 15)
    if m.sum() < 30:
        continue
    cu.append(b0)
    cz.append(np.median(P0[si][m][:, -1, 2]))
cu, cz = np.array(cu), np.array(cz)
ePoly = np.polyfit(cu, cz, 5)
print("edge bins:", len(cu), "z range:", round(float(cz.min()), 4),
      round(float(cz.max()), 4), flush=True)
# u<-xw map from same fibres (measured r=-0.9999)
Ax = np.polyfit(uu, P0[si][:, -1, 0], 1)
u_of_x = lambda x: (x - Ax[1]) / Ax[0]   # noqa
U_MIN, U_MAX = float(cu.min()), float(cu.max())
EPS = 0.001  # 1mm ~= ruler 2px tolerance


def edge_z(xtip):
    u = np.clip(u_of_x(np.asarray(xtip, float)), U_MIN, U_MAX)
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


LOW = np.where(tips[:, 2] < 1.42)[0]
pts = P0.copy()
n_seal = seal(pts, LOW)

xm = np.abs(P0[:, 8:24, 0]).mean(axis=1)
ei = np.where((~rear) & (~RAIL) & (xm >= 0.080) & (xm < 0.100)
              & (tips[:, 2] < 1.45))[0]
sel = ei[::max(1, len(ei) // 8000)][:8000]
rng = np.random.default_rng(7101)
dup = P0[sel].copy()
sgn = np.sign(P0[sel][:, 16, 0])
sgn[sgn == 0] = 1.0
dx = sgn * (0.0005 + 0.0010 * rng.random(len(sel)))
dup[:, :, 0] += dx[:, None]
over = np.abs(dup[:, :, 0]) > 0.0995
dup[:, :, 0] = np.where(over, np.sign(dup[:, :, 0]) * 0.0995, dup[:, :, 0])
dup_roots = R0[sel].copy()
dup_roots[:, 0] += dx
dup_roots[:, 0] = np.where(np.abs(dup_roots[:, 0]) > 0.0995,
                           np.sign(dup_roots[:, 0]) * 0.0995,
                           dup_roots[:, 0])
allp = np.vstack([pts, dup])
di = np.arange(len(pts), len(allp))[dup[:, -1, 2] < 1.42]
n_seal_dup = seal(allp, di)

cell = E / "cells" / "c_best3"
cell.mkdir(parents=True, exist_ok=True)
np.savez_compressed(
    cell / "strands_waved.npz", points=allp.astype(np.float32),
    roots=np.vstack([R0, dup_roots]).astype(np.float32),
    radii=np.vstack([RAD0, RAD0[sel]]).astype(np.float32),
    apex_y=np.asarray(src["apex_y"]), cx=np.asarray(src["cx"]))
info = {"cell": "best-combo-self-edge",
        "sealedLower": n_seal, "dupFibres": int(len(sel)),
        "sealedDups": n_seal_dup, "totalFibres": int(len(allp)),
        "rule": "shorten-only seal of all lower tips to own-sheet smooth "
                "edge minus 1mm + full-length sealed edge dups; no trim"}
(cell / "deform_meta.json").write_text(
    json.dumps({"tag": "c_best3", "base": "hair-hem1/base/strands.npz",
                "deform": info}, indent=2) + "\n")
print("CELL c_best3", json.dumps(info), flush=True)
