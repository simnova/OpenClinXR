#!/usr/bin/env python3
"""hair-hem1 STEP 2 combo: c_best = blunt seal + full-length sealed edge
dups, no trim (system python).

From singles: trim costs front width (-0.02, twice proven); rails re-guided
inward cost front too (-0.0185). Short under-fibre dups do not reach the
hem rows where front width lives. So: keep every fibre's lateral x (no
trim, no inward pull), seal ALL lower tips (tip_z<1.42, incl. rails) up to
the smooth target-fitted hem curve (shorten-only, smoothstep idx24..31),
and add ~8k FULL-LENGTH edge dups (|x_mid| in [0.080,0.100), outward
0.5..1.5mm capped |x|<=0.0995, tips sealed to the same curve) to carry hem-
row width inside the sheet.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

E = Path("tools/openclinxr/evidence/hair-hem1")
J = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back")
S = 1024

src = np.load(E / "cells_source_best.npz")
P0 = np.asarray(src["points"], float)
R0 = np.asarray(src["roots"], float)
RAD0 = np.asarray(src["radii"])
APEX = float(np.asarray(src["apex_y"]))
CX = float(np.asarray(src["cx"]))
tips = P0[:, -1]
rear = R0[:, 1] > APEX
RAIL = (~rear) & (np.abs(tips[:, 0]) > 0.10) & (tips[:, 2] < 1.42)

# target hem curve (identical to build_cells.py blunt)
sc = json.load(open(E / "base" / "score.json"))
M = np.array(sc["render"]["cameras"]["back"]["matrixWorld"], float)
F = 50.0 / 36.0 * S
Minv = np.linalg.inv(M)
LOW = tips[:, 2] < 1.42
li = np.where(LOW)[0]
flat = P0[li][:, -1]
Pc = (Minv @ np.concatenate(
    [flat, np.ones((len(flat), 1))], axis=1).T).T[:, :3]
uu = S / 2 + F * Pc[:, 0] / (-Pc[:, 2])
vv = S / 2 - F * Pc[:, 1] / (-Pc[:, 2])
Ax = np.polyfit(uu, P0[li][:, -1, 0], 1)
Az = np.polyfit(vv, P0[li][:, -1, 2], 1)
tm = np.asarray(Image.open(J / "mask-back-v3.png").convert("L")) > 127
yb = np.full(S, np.nan)
cols = np.where(tm.any(axis=0))[0]
for x in cols:
    yb[x] = float(np.where(tm[:, x])[0].max())
ok = ~np.isnan(yb)
yf = yb.copy()
yf[~ok] = np.interp(np.where(~ok)[0], np.where(ok)[0], yb[ok])
pad = np.pad(yf, (30, 30), mode="edge")
med = np.median(np.lib.stride_tricks.sliding_window_view(pad, 61), axis=1)
xok = cols[(cols >= 200) & (cols <= 824)]
poly = np.polyfit(xok, np.interp(xok, np.arange(S), med), 5)
xw_grid_fit = np.polyval(Ax, xok)
hem_poly = np.polyfit(xw_grid_fit, np.polyval(Az, np.polyval(poly, xok)), 5)
XW_MIN, XW_MAX = float(xw_grid_fit.min()), float(xw_grid_fit.max())
print("hem fit xw range:", XW_MIN, XW_MAX, flush=True)


def hem_z(xtip):
    return np.polyval(hem_poly, np.clip(xtip, XW_MIN, XW_MAX))

t = np.linspace(0, 1, 8)
ramp = np.zeros(32)
ramp[24:] = t * t * (3 - 2 * t)


def seal(pts, idx):
    pred = hem_z(pts[idx][:, -1, 0])
    below = pts[idx][:, -1, 2] < (pred - 0.001)
    ni = idx[below]
    gap = pred[below] - pts[ni][:, -1, 2]
    pts[ni, :, 2] += gap[:, None] * ramp[None, :]
    return int(below.sum())


pts = P0.copy()
n_seal = seal(pts, li)

# full-length edge dups, sealed
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

# rail tail taper: rails are boosted x1.7 fibres (0.085 vs 0.05mm);
# thin tails where below-hem pixels live, keep roots lush.
RAD = np.asarray(RAD0, dtype=np.float64)
ri = np.where(RAIL)[0]
taper = np.ones(32); taper[18:] = 0.35; taper[8:18] = 0.7
RAD[ri] *= taper[None, :]
RAD0T = RAD.astype(np.float32)
cell = E / "cells" / "c_best5"
cell.mkdir(parents=True, exist_ok=True)
np.savez_compressed(
    cell / "strands_waved.npz", points=allp.astype(np.float32),
    roots=np.vstack([R0, dup_roots]).astype(np.float32),
    radii=np.vstack([RAD0T, RAD0T[sel]]).astype(np.float32),
    apex_y=np.asarray(src["apex_y"]), cx=np.asarray(src["cx"]))
info = {"cell": "best-combo-taper",
        "sealedLower": n_seal, "dupFibres": int(len(sel)),
        "sealedDups": n_seal_dup, "totalFibres": int(len(allp)),
        "rule": "blunt seal (shorten-only to TS-fitted smooth hem curve) "
                "on all lower tips + full-length edge dups sealed to same "
                "curve; no trim, no inward pull"}
(cell / "deform_meta.json").write_text(
    json.dumps({"tag": "c_best5", "base": "hair-hem1/base/strands.npz",
                "deform": info}, indent=2) + "\n")
print("CELL c_best", json.dumps(info), flush=True)
