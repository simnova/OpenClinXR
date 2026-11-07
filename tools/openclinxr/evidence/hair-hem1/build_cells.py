#!/usr/bin/env python3
"""hair-hem1 STEP 2: build absorb / blunt / widen cells on hem1 base.

Base = cover1 best4 strands (98549). RAIL = curtain roots (y<=apex) with
|tip_x|>0.10 & tip_z<1.42 (same rule as cover1 c_hem; 10604 here).

absorb: each rail fibre re-guided into its nearest sheet guide (nearest by
  mid-shaft arc12..16 mean xyz among non-rail fibres). Mid-length (arc
  0..14) untouched -> lateral spread at mid-length kept; arc 15..31 follows
  the guide's lower-path shape anchored at the rail's own arc-15 point,
  blended 0.33/0.66 at idx 15/16, full from 17. (No tip clamp: the width
  comes from the sheet, rails join it.)
blunt: one smooth hem curve from the TARGET back-mask hem, mapped to world
  z via our projected tip calibration; LOWER fibres (tip_z<1.42, whole
  lower sheet incl. rails) below the curve are shortened up to it
  (smoothstep ramp idx 24..31, z-only). Fibres above the curve untouched.
widen: ~8k short under-fibre dups of lateral sheet-edge curtain fibres
  (|x_mid| in [0.080,0.100), tip_z<1.45, inside the sheet; arc 0..24
  resampled to 32, outward x-jitter 0.5..1.5mm capped at |x|<=0.0995, no
  fringe tips) + c_hem rail trim on rail fibres (|tip_x|>0.10 pulled to
  +-0.10, ramp idx22..31).
Writes E/cells/<tag>/strands_waved.npz + deform_meta.json.
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
N = len(P0)
print("base n =", N, flush=True)

tips = P0[:, -1]
rear = R0[:, 1] > APEX
RAIL = (~rear) & (np.abs(tips[:, 0]) > 0.10) & (tips[:, 2] < 1.42)
ri = np.where(RAIL)[0]
gi = np.where(~RAIL)[0]
print("RAIL fibres:", len(ri), flush=True)


def save(tag, points, roots, radii, info):
    cell = E / "cells" / tag
    cell.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        cell / "strands_waved.npz", points=points.astype(np.float32),
        roots=roots.astype(np.float32), radii=np.asarray(radii, np.float32),
        apex_y=np.asarray(src["apex_y"]), cx=np.asarray(src["cx"]))
    (cell / "deform_meta.json").write_text(
        json.dumps({"tag": tag, "base": "hair-hem1/base/strands.npz",
                    "deform": info}, indent=2) + "\n")
    print("CELL", tag, json.dumps(info), flush=True)


# ---------------- absorb ----------------
mid_rail = P0[ri][:, 12:17].mean(axis=1)     # (Rn,3)
mid_guide = P0[gi][:, 12:17].mean(axis=1)    # (Gn,3)
nearest = np.empty(len(ri), dtype=int)
CH = 400
for a in range(0, len(ri), CH):
    b = min(a + CH, len(ri))
    d2 = ((mid_rail[a:b, None, :] - mid_guide[None, :, :]) ** 2).sum(axis=2)
    nearest[a:b] = gi[d2.argmin(axis=1)]
    if a % 2000 == 0:
        print("  absorb nn", a, "/", len(ri), flush=True)
absorb = P0.copy()
G = P0[nearest]                               # matched guides
anchor_r = P0[ri][:, 15]                      # rail arc-15
anchor_g = G[:, 15]
shape = G[:, 15:, :] - anchor_g[:, None, :]   # guide lower-path shape
new_low = anchor_r[:, None, :] + shape
w = np.ones(17)
w[0] = w[1] = 0.0                             # idx15,16 -> w below
w = np.array([0.33, 0.66] + [1.0] * 15)       # idx15..31
absorb[ri, 15:, :] = ((1 - w[None, :, None]) * P0[ri][:, 15:, :]
                      + w[None, :, None] * new_low)
save("c_absorb", absorb, R0.copy(), RAD0.copy(),
     {"cell": "absorb", "railFibres": int(len(ri)),
      "rule": "rail arc15..31 follows nearest sheet-guide lower path, "
              "anchored at own arc15, blend 0.33/0.66 then full; "
              "mid-length untouched"})


# ---------------- blunt ----------------
def project_back(Pts):
    sc = json.load(open(E / "base" / "score.json"))
    M = np.array(sc["render"]["cameras"]["back"]["matrixWorld"], float)
    F = 50.0 / 36.0 * S
    Minv = np.linalg.inv(M)
    flat = Pts.reshape(-1, 3)
    Pc = (Minv @ np.concatenate(
        [flat, np.ones((len(flat), 1))], axis=1).T).T[:, :3]
    uu = S / 2 + F * Pc[:, 0] / (-Pc[:, 2])
    vv = S / 2 - F * Pc[:, 1] / (-Pc[:, 2])
    return uu.reshape(Pts.shape[:-1]), vv.reshape(Pts.shape[:-1])


LOW = tips[:, 2] < 1.42
li = np.where(LOW)[0]
uu, vv = project_back(P0[li][:, -1])
# regress pixel -> world (linear; hair near-planar in back view)
Ax = np.polyfit(uu, P0[li][:, -1, 0], 1)
Az = np.polyfit(vv, P0[li][:, -1, 2], 1)
rx = float(np.corrcoef(uu, P0[li][:, -1, 0])[0, 1])
rz = float(np.corrcoef(vv, P0[li][:, -1, 2])[0, 1])
print(f"calib u->xw r={rx:.4f} v->zw r={rz:.4f}", flush=True)

tm = np.asarray(Image.open(J / "mask-back-v3.png").convert("L")) > 127
yb = np.full(S, np.nan)
cols = np.where(tm.any(axis=0))[0]
for x in cols:
    yb[x] = float(np.where(tm[:, x])[0].max())
ok = ~np.isnan(yb)
# smooth target hem with wide median (same spirit as ruler) then polyfit
yf = yb.copy()
yf[~ok] = np.interp(np.where(~ok)[0], np.where(ok)[0], yb[ok])
k = 30
pad = np.pad(yf, (k, k), mode="edge")
med = np.median(
    np.lib.stride_tricks.sliding_window_view(pad, 61), axis=1)
xok = cols[(cols >= 200) & (cols <= 824)]
poly = np.polyfit(xok, np.interp(xok, np.arange(S), med), 5)
xw_grid = np.polyval(Ax, xok)
zw_curve = np.polyval(Az, np.polyval(poly, xok))
# world-space smooth hem curve as poly in xw
hem_poly = np.polyfit(xw_grid, zw_curve, 5)
pred = np.polyval(hem_poly, P0[li][:, -1, 0])
print("hem curve zw range:", float(pred.min()), float(pred.max()),
      "our lower tip z median:", float(np.median(tips[LOW, 2])), flush=True)

blunt = P0.copy()
need = tips[LOW, 2] < (pred - 0.001)   # strictly below curve: shorten up
ni = li[need]
gap = (pred[need] - P0[ni][:, -1, 2])  # positive mm-scale in m
t = np.linspace(0, 1, 8)
ramp = np.zeros(32)
ramp[24:] = t * t * (3 - 2 * t)        # smoothstep idx24..31
blunt[ni, :, 2] += gap[:, None] * ramp[None, :]
save("c_blunt", blunt, R0.copy(), RAD0.copy(),
     {"cell": "blunt", "lowerFibres": int(len(li)),
      "raisedFibres": int(len(ni)),
      "rule": "tips of lower sheet (tip_z<1.42) below smooth hem curve "
              "fitted to TS back-mask hem (deg5, v->zw calib r=%.4f) "
              "raised to curve, smoothstep idx24..31, z-only" % rz})


# ---------------- widen ----------------
xm = np.abs(P0[:, 8:24, 0]).mean(axis=1)
EDGE = ((~rear) & (~RAIL) & (xm >= 0.080) & (xm < 0.100)
        & (tips[:, 2] < 1.45))
ei = np.where(EDGE)[0]
print("EDGE pool:", len(ei), flush=True)
step = max(1, len(ei) // 8000)
sel = ei[::step][:8000]
print("widen dups:", len(sel), flush=True)


def resample_short(pts):
    out = np.empty((len(pts), 32, 3))
    for kk in range(len(pts)):
        p = pts[kk]
        seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
        arc = np.r_[0.0, np.cumsum(seg)]
        want = np.linspace(0.0, arc[-1], 32)
        for c in range(3):
            out[kk, :, c] = np.interp(want, arc, p[:, c])
    return out


def resample_vec(v):
    out = np.empty((len(v), 32), np.float32)
    x = np.linspace(0, 24, 32)
    xi = np.arange(25)
    for kk in range(len(v)):
        out[kk] = np.interp(x, xi, v[kk])
    return out


rng = np.random.default_rng(7101)
dup_pts = resample_short(P0[sel][:, 0:25])
dup_rad = resample_vec(np.asarray(RAD0[sel][:, 0:25], float))
sgn = np.sign(P0[sel][:, 16, 0])
sgn[sgn == 0] = 1.0
mag = 0.0005 + 0.0010 * rng.random(len(sel))   # 0.5..1.5mm outward
dx = sgn * mag
dup_pts[:, :, 0] += dx[:, None]
over = np.abs(dup_pts[:, :, 0]) > 0.0995
dup_pts[:, :, 0] = np.where(
    over, np.sign(dup_pts[:, :, 0]) * 0.0995, dup_pts[:, :, 0])
dup_roots = R0[sel].copy()
dup_roots[:, 0] += dx
dup_roots[:, 0] = np.where(np.abs(dup_roots[:, 0]) > 0.0995,
                           np.sign(dup_roots[:, 0]) * 0.0995,
                           dup_roots[:, 0])
wpts = np.vstack([P0, dup_pts])
wroots = np.vstack([R0, dup_roots])
wrad = np.vstack([RAD0, dup_rad])
# c_hem rail trim on originals (dups are inside +-0.0995 already)
wrail = np.zeros(len(wpts), bool)
wrail[ri] = True
excess = np.abs(wpts[wrail, 22:32, 0]) - 0.10
ramp2 = np.linspace(0.15, 1.0, 10)[None, :]
pull = np.maximum(excess, 0.0) * ramp2
wpts[np.where(wrail)[0][:, None], np.arange(22, 32), 0] -= (
    np.sign(wpts[wrail, 22:32, 0]) * pull)
save("c_widen", wpts, wroots, wrad,
     {"cell": "widen", "dupFibres": int(len(sel)),
      "form": "short under-fibres (arc0..24->32, no fringe tips), "
              "edge band |x_mid| in [0.080,0.100), outward 0.5..1.5mm "
              "capped |x|<=0.0995",
      "trim": "rails (|tip_x|>0.10) x to +-0.10 ramp idx22..31",
      "totalFibres": int(len(wpts))})
