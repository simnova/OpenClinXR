#!/usr/bin/env python3
"""hair-ends1 STEP 2: build taper / thin / spread cells + best combo.

Base = E/base/strands.npz (hem2 c_curve repaired, 99945 fibres).
Lower sheet = tip_z < 1.42 (hem1 convention, 65953 fibres).

taper: radius tapered to 20% over last 15% of arc (ALL fibres):
  r85 = radii[:,27] (entry of last-15% window idx27..31); for j=27..31
  r[:,j] = r85 * (1 - 0.8*(j-27)/4). Tip = 0.2*r85.

thin: lower-sheet radius back to 0.05mm (undo cover1 x1.7 boost on
  arc 0..26) + fibre count raised to keep diameter-coverage:
  for lower fibres radii[:,0:27] = 0.05mm; tips (27..31) untouched.
  coverage proxy S = sum(mid radii idx16); deficit/S .05 -> 18055 full-
  length dups (random lower fibres, x/y sigma 0.3mm jitter, radii 0.05
  + same tip taper as thinned). n thin = 99945+18055 = 118000.

spread: independent per-fibre lateral lean sigma 2.5deg over lower 30%
  of arc (tilt4 sheet-frame method, ALL fibres so all views move):
  theta~N(0,2.5deg) (seed 1507); offset = (s-0.7L)+ * tan(theta) along
  sheet-frame lateral dir, smooth ramp, roots/upper fixed, tip max
  (~5mm at sigma). No radius change.

best: thin then taper then spread (same params).
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np

E = Path("tools/openclinxr/evidence/hair-ends1")
SHEET_Z = 1.42
SIGMA = 2.5
SEED = 1507

src = np.load(E/"base"/"strands.npz")
P0 = np.asarray(src["points"], float)
R0 = np.asarray(src["radii"], float)
RTS = np.asarray(src["roots"], float)
APEX = float(np.asarray(src["apex_y"])); CX = float(np.asarray(src["cx"]))
N = len(P0)
tips = P0[:,-1]
LOW = tips[:,2] < SHEET_Z
li = np.where(LOW)[0]
print("base n =", N, "lower =", len(li), flush=True)

def save(tag, points, roots, radii, info):
    cell = E/"cells"/tag
    cell.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cell/"strands_waved.npz", points=points.astype(np.float32),
        roots=roots.astype(np.float32), radii=np.asarray(radii, np.float32),
        apex_y=np.asarray(src["apex_y"]), cx=np.asarray(src["cx"]))
    (cell/"deform_meta.json").write_text(json.dumps({"tag":tag,"base":"hair-ends1/base/strands.npz","deform":info},indent=2)+"\n")
    print("CELL", tag, json.dumps(info), flush=True)

def apply_taper_radii(R):
    R = R.copy()
    r85 = R[:,27].copy()
    for k,j in enumerate(range(27,32)):
        f = 1.0 - 0.8*(k/4.0)
        R[:,j] = r85*f
    return R

def thin_arrays():
    R = R0.copy()
    R[li,0:27] = 0.00005  # 0.05mm
    # coverage: sum idx16
    s_before = float(R0[li][:,16].sum())
    s_after = float(R[li][:,16].sum())
    need = int(round((s_before-s_after)/0.00005))
    rng = np.random.default_rng(8101)
    pick = rng.choice(li, size=need, replace=True)
    dup_P = P0[pick].copy()
    jit = rng.normal(0.0, 0.0003, (need,1,2))  # 0.3mm x/y
    dup_P[:,:,0:2] += jit
    dup_R = np.full((need,32), 0.00005)
    # copy tip taper shape from thinned source fibre
    dup_R[:,27:32] = R[pick][:,27:32]
    P1 = np.concatenate([P0, dup_P], axis=0)
    R1 = np.concatenate([R, dup_R], axis=0)
    roots1 = np.concatenate([RTS, RTS[pick]], axis=0)
    return P1, roots1, R1, {"need": need, "sBefore": s_before, "sAfterThin": s_after}

def sheet_frames(points, cx):
    tangent = np.gradient(points, axis=1)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=2, keepdims=True), 1e-9)
    radial = points.copy(); radial[:,:,0] -= cx; radial[:,:,2]=0.0
    radial /= np.maximum(np.linalg.norm(radial, axis=2, keepdims=True), 1e-9)
    sheet = np.cross(tangent, radial)
    sheet /= np.maximum(np.linalg.norm(sheet, axis=2, keepdims=True), 1e-9)
    return sheet

def smooth(x):
    x=np.clip(x,0,1); return x*x*(3-2*x)

def apply_spread(Pts, roots, cx, sigma=SIGMA, seed=SEED):
    P = Pts.copy()
    n = len(P)
    rng = np.random.default_rng(seed)
    theta = rng.normal(0.0, sigma, n)
    # arc length
    s = np.concatenate([np.zeros((n,1)), np.cumsum(np.linalg.norm(np.diff(P,axis=1),axis=2),axis=1)],axis=1)
    L = s[:,-1]
    over = np.maximum(s - 0.7*L[:,None], 0.0)
    ramp = smooth((s-0.7*L[:,None])/np.maximum(0.3*L[:,None],1e-9))
    ramp = np.where(s<=0.7*L[:,None], 0.0, ramp)
    tilt = over*np.tan(np.radians(theta))[:,None]*ramp
    sheet = sheet_frames(P, cx)
    P = P + sheet*tilt[:,:,None]
    return P, theta

# taper
save("c_taper", P0.copy(), RTS.copy(), apply_taper_radii(R0),
     {"cell":"taper","rule":"radii taper to 20% over last 15% arc (idx27..31) all fibres"})

# thin
Pthin, Rthin_roots, Rthin, tinfo = thin_arrays()
save("c_thin", Pthin, Rthin_roots, Rthin,
     {"cell":"thin","rule":"lower radii[:,0:27]=0.05mm + full-length dups w/ x/y 0.3mm jitter","lowerFibres":int(len(li)),**{k:(round(v,6) if isinstance(v,float) else v) for k,v in tinfo.items()},"n":int(len(Pthin))})

# spread (on base points, base radii)
Psp, th = apply_spread(P0, RTS, CX)
save("c_spread", Psp, RTS.copy(), R0.copy(),
     {"cell":"spread","rule":"independent per-fibre lateral lean sigma 2.5deg over lower 30% arc (tilt4 sheet-frame, all fibres)","seed":SEED,"thetaStd":round(float(th.std()),3),"thetaMaxAbs":round(float(np.abs(th).max()),3)})

# best: thin then taper then spread
Rb = apply_taper_radii(Rthin)
Pb, thb = apply_spread(Pthin, Rthin_roots, CX, sigma=SIGMA, seed=SEED+1)
# need cx? roots extended; cx same
save("c_best", Pb, Rthin_roots.copy(), Rb,
     {"cell":"best-combo","rule":"thin then taper then spread (same params, spread seed %d)"%(SEED+1),"n":int(len(Pb)),"thetaStd":round(float(thb.std()),3)})
