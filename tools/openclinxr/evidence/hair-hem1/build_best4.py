#!/usr/bin/env python3
"""hair-hem1 combo c_best4: translate-dups densify the side edge + self-edge
seal (system python).

Why (see crops): the bundle read comes from SPARSE diagonal rail shafts
separated by a gap from the sheet, not from tip length. Endpoints must stay
at rail x (front width lives there: rails span front cols to 749 vs TS 762;
every inward pull/trim cost front -0.01..-0.02, twice proven). So: populate
rail territory with translated copies of neighbouring edge fibres:
  pool = non-rail curtain, |x_mid(8..24)| in [0.075,0.105), tip_z<1.45;
  12000 dups (deterministic stride): rigid +x translate by delta ~
  U(4,10mm) outward (cap |x|<=0.128), y jitter +-0.3mm, same radii, roots
  shifted with the fibre; tips sealed to the self-edge curve -1mm.
Rails themselves: tips sealed (shorten-only) to the same curve, paths
otherwise untouched -> embedded in the new dense field, no gap, no bundle.
All other lower tips sealed as in c_best3. No trim.
Self-edge = c_best3 empirical edge (per-bin median tip z of projected lower
sheet fibres, deg5, flat outside, minus 1mm).
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
tips = P0[:, -1]
rear = R0[:, 1] > float(np.asarray(src["apex_y"]))
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
Ax = np.polyfit(uu, P0[si][:, -1, 0], 1)
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


xm = np.abs(P0[:, 8:24, 0]).mean(axis=1)
ei = np.where((~rear) & (~RAIL) & (xm >= 0.075) & (xm < 0.105)
              & (tips[:, 2] < 1.45))[0]
print("pool:", len(ei), flush=True)
stride = len(ei) / 12000
sel = ei[np.unique(np.clip((np.arange(12000) * stride).astype(int), 0,
                           len(ei) - 1))]
print("dups:", len(sel), flush=True)

rng = np.random.default_rng(4404)
sgn = np.sign(P0[sel][:, 16, 0])
sgn[sgn == 0] = 1.0
delta = 0.004 + 0.006 * rng.random(len(sel))   # 4..10mm outward
jy = (rng.random(len(sel)) - 0.5) * 0.0006
dup = P0[sel].copy()
dup[:, :, 0] += (sgn * delta)[:, None]
dup[:, :, 1] += jy[:, None]
over = np.abs(dup[:, :, 0]) > 0.128
dup[:, :, 0] = np.where(over, np.sign(dup[:, :, 0]) * 0.128, dup[:, :, 0])
dup_roots = R0[sel].copy()
dup_roots[:, 0] += sgn * delta
dup_roots[:, 1] += jy
dup_roots[:, 0] = np.where(np.abs(dup_roots[:, 0]) > 0.128,
                           np.sign(dup_roots[:, 0]) * 0.128,
                           dup_roots[:, 0])

pts = P0.copy()
LOW = np.where(tips[:, 2] < 1.42)[0]
n_seal = seal(pts, LOW)
allp = np.vstack([pts, dup])
allr = np.vstack([R0, dup_roots])
di = np.arange(len(pts), len(allp))[dup[:, -1, 2] < 1.42]
n_seal_dup = seal(allp, di)

cell = E / "cells" / "c_best4"
cell.mkdir(parents=True, exist_ok=True)
np.savez_compressed(
    cell / "strands_waved.npz", points=allp.astype(np.float32),
    roots=allr.astype(np.float32),
    radii=np.vstack([RAD0, RAD0[sel]]).astype(np.float32),
    apex_y=np.asarray(src["apex_y"]), cx=np.asarray(src["cx"]))
info = {"cell": "best-combo-translate-densify",
        "sealedLower": n_seal, "dupFibres": int(len(sel)),
        "sealedDups": n_seal_dup, "totalFibres": int(len(allp)),
        "rule": "12k outward-translated (4..10mm, cap 0.128) full-length "
                "edge dups populate rail territory + self-edge-1mm seal "
                "of all lower tips incl rails; no trim, rail paths kept"}
(cell / "deform_meta.json").write_text(
    json.dumps({"tag": "c_best4", "base": "hair-hem1/base/strands.npz",
                "deform": info}, indent=2) + "\n")
print("CELL c_best4", json.dumps(info), flush=True)
