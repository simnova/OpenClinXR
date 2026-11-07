#!/usr/bin/env python3
"""hair-hem2 STEP 2: build taper / curve / tips cells + best combo.

Base = hem2/base/strands.npz (hem1 c_best8 repaired) + back-camera matrices
from hem2/base/score.json. Lower sheet = tip_z < 1.42 (hem1 convention).

Calib (measured this card): back-view projection via matrixWorld inverse,
  u->xw linear r=-0.99995, v->zw linear r=-0.986 (1px ~= 0.43mm).
Target = mask-back-v3 (U: centre v=821, flanks ~758/783; cols 303..743).

taper: per-fibre lateral scale x*=s(v_tip) about x=0, s from smoothed
  target/ours width-ratio profile over the lower-40% band, clipped to
  [0.80,1.0] (inward only), s=1 above the band. Fibre rigid (all 32 pts
  share the tip's factor) -> drape preserved, hem pulled inward.
curve: per-fibre tip z set toward the target y_bottom U-curve (61-wide
  median sheet edge, v->zw mapped): raise fibres above the curve, extend
  fibres below it down (cap 15mm), smoothstep ramp idx24..31, z-only.
tips:  last ~10% (idx29..31) of each lower fibre: independent length jitter
  sigma 3mm along end tangent + 1mm inward curl at tip, ramped. No comb.
best:  taper then curve then tips, in that order.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

E = Path("tools/openclinxr/evidence/hair-hem2")
J = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back")
S = 1024
SHEET_Z = 1.42

src = np.load(E / "base" / "strands.npz")
P0 = np.asarray(src["points"], float)
R0 = np.asarray(src["roots"], float)
RAD0 = np.asarray(src["radii"])
APEX = float(np.asarray(src["apex_y"]))
print("base n =", len(P0), flush=True)

tips = P0[:, -1]
LOW = tips[:, 2] < SHEET_Z
li = np.where(LOW)[0]
print("lower fibres:", len(li), flush=True)

sc = json.load(open(E / "base" / "score.json"))
M = np.array(sc["render"]["cameras"]["back"]["matrixWorld"], float)
F = 50.0 / 36.0 * S
Minv = np.linalg.inv(M)


def project(Pts):
    flat = np.asarray(Pts, float).reshape(-1, 3)
    Pc = (Minv @ np.concatenate(
        [flat, np.ones((len(flat), 1))], axis=1).T).T[:, :3]
    uu = S / 2 + F * Pc[:, 0] / (-Pc[:, 2])
    vv = S / 2 - F * Pc[:, 1] / (-Pc[:, 2])
    return uu, vv


uu_all, vv_all = project(P0[li][:, -1])
Ax = np.polyfit(uu_all, P0[li][:, -1, 0], 1)
Az = np.polyfit(vv_all, P0[li][:, -1, 2], 1)
print("Ax", Ax.tolist(), "Az", Az.tolist(), flush=True)


def save(tag, points, roots, radii, info):
    cell = E / "cells" / tag
    cell.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        cell / "strands_waved.npz", points=points.astype(np.float32),
        roots=roots.astype(np.float32), radii=np.asarray(radii, np.float32),
        apex_y=np.asarray(src["apex_y"]), cx=np.asarray(src["cx"]))
    (cell / "deform_meta.json").write_text(
        json.dumps({"tag": tag, "base": "hair-hem2/base/strands.npz",
                    "deform": info}, indent=2) + "\n")
    print("CELL", tag, json.dumps(info), flush=True)


# ---- target width-ratio profile s(v), back view, registered frame ----
sys_path = True
import sys as _sys
_sys.path.insert(0, str(E))
from shape_ruler import register_mask, RENDER_TRIPLE, TARGET_TRIPLE  # noqa: E402

tm = np.asarray(Image.open(J / "mask-back-v3.png").convert("L")) > 127
mo = np.asarray(Image.open(E / "base" / "back-id.png").convert("RGBA"))[..., 3] >= 230
a_r, b_r, c_r = RENDER_TRIPLE["back"]
a_t, b_t, c_t = TARGET_TRIPLE["back"]
ours_reg, _ = register_mask(mo, a_r, b_r, c_r, a_t, b_t, c_t)
rows_t = np.where(tm.any(axis=1))[0]
LO = int(round(rows_t.min() + 0.6 * (rows_t.max() - rows_t.min())))
YB = int(rows_t.max())
wt = tm[LO:YB + 1, :].sum(axis=1).astype(float)
wo = ours_reg[LO:YB + 1, :].sum(axis=1).astype(float)
ratio = wt / np.maximum(wo, 1.0)
# smooth ratio (15-row mean, edge-padded), clip inward-only
pad = np.pad(ratio, (7, 7), mode="edge")
sm = np.convolve(pad, np.ones(15) / 15, mode="valid")
S_PROF = np.clip(sm, 0.80, 1.0)
VV = np.arange(LO, YB + 1)


def taper_factor(z_tip: np.ndarray) -> np.ndarray:
    v = (z_tip - Az[1]) / Az[0]
    idx = np.clip(np.round(v - LO).astype(int), 0, len(S_PROF) - 1)
    s = S_PROF[idx]
    return np.where(v < LO, 1.0, s)


def apply_taper(Pts: np.ndarray) -> tuple[np.ndarray, dict]:
    P = Pts.copy()
    zt = P[li][:, -1, 2]
    s = taper_factor(zt)
    P[li, :, 0] *= s[:, None]
    return P, {"sMin": round(float(s.min()), 4), "sMean": round(float(s.mean()), 4),
               "moved": int((s < 0.999).sum())}


# ---- target U-curve (sheet edge, 61-wide median of target y_bottom) ----
yb_t = np.full(S, np.nan)
cols = np.where(tm.any(axis=0))[0]
for x in cols:
    yb_t[x] = float(np.where(tm[:, x])[0].max())
yf = yb_t.copy()
ok = ~np.isnan(yf)
yf[~ok] = np.interp(np.where(~ok)[0], np.where(ok)[0], yb_t[ok])
k = 30
pad2 = np.pad(yf, (k, k), mode="edge")
edge = np.median(np.lib.stride_tricks.sliding_window_view(pad2, 61), axis=1)
U_MIN, U_MAX = int(cols.min()), int(cols.max())


def curve_z(x_tip: np.ndarray) -> np.ndarray:
    u = np.clip((np.asarray(x_tip, float) - Ax[1]) / Ax[0], U_MIN, U_MAX)
    return Az[0] * edge[u.astype(int)] + Az[1]


T_RAMP = np.zeros(32)
_t = np.linspace(0, 1, 8)
T_RAMP[24:] = _t * _t * (3 - 2 * _t)
CAP_DOWN, CAP_UP = 0.015, 0.020


def apply_curve(Pts: np.ndarray) -> tuple[np.ndarray, dict]:
    P = Pts.copy()
    T = P[li][:, -1]
    want = curve_z(T[:, 0])
    delta = want - T[:, 2]  # >0: lengthen down; <0: raise
    delta = np.clip(delta, -CAP_UP, CAP_DOWN)
    P[li, :, 2] += delta[:, None] * T_RAMP[None, :]
    return P, {"capDownMm": CAP_DOWN * 1000, "capUpMm": CAP_UP * 1000,
               "meanAbsDeltaMm": round(float(np.abs(delta).mean() * 1000), 2),
               "downFibres": int((delta > 0.0005).sum()),
               "upFibres": int((delta < -0.0005).sum())}


def apply_tips(Pts: np.ndarray, seed: int) -> tuple[np.ndarray, dict]:
    rng = np.random.default_rng(seed)
    P = Pts.copy()
    seg = P[li][:, -1] - P[li][:, -2]
    leng = np.linalg.norm(seg, axis=1) + 1e-9
    tang = seg / leng[:, None]
    jit = rng.normal(0.0, 0.003, len(li))  # sigma 3mm
    P[li][:, -1] += tang * jit[:, None]
    P[li][:, -2] += tang * (jit * 0.4)[:, None]
    inward = -np.sign(P[li][:, -1, 0])
    inward[inward == 0] = 1.0
    curl = 0.001 * rng.uniform(0.5, 1.0, len(li))  # ~0.5..1mm inward
    P[li][:, -1, 0] += inward * curl
    P[li][:, -2, 0] += inward * curl * 0.4
    return P, {"seed": seed, "sigmaMm": 3.0, "curlMm": "0.5..1 inward"}


tapered, t_info = apply_taper(P0)
save("c_taper", tapered, R0.copy(), RAD0.copy(),
     {"cell": "taper", "lowerFibres": int(len(li)), **t_info,
      "rule": "per-fibre rigid x*=s(v_tip): s=smoothed tgt/ours width ratio "
              "over lower-40% band clipped [0.80,1.0], s=1 above band"})

curved, c_info = apply_curve(P0)
save("c_curve", curved, R0.copy(), RAD0.copy(),
     {"cell": "curve", "lowerFibres": int(len(li)), **c_info,
      "rule": "tip z toward target U sheet-edge (61-wide median y_bottom, "
              "v->zw mapped); raise capped 20mm, extend capped 15mm, "
              "smoothstep idx24..31 z-only"})

tipped, p_info = apply_tips(P0, 7202)
save("c_tips", tipped, R0.copy(), RAD0.copy(),
     {"cell": "tips", "lowerFibres": int(len(li)), **p_info,
      "rule": "last ~10% (idx29..31) independent length jitter sigma 3mm "
              "along end tangent + 0.5..1mm inward curl"})

bt, _ = apply_taper(P0)
bc, _ = apply_curve(bt)
bb, _ = apply_tips(bc, 7202)
save("c_best", bb, R0.copy(), RAD0.copy(),
     {"cell": "best-combo", "lowerFibres": int(len(li)),
      "rule": "taper then curve then tips (same params as singles)"})
