#!/usr/bin/env python3
"""hair-cover1 STEP 2: build hole-region cells on base (system python).

Base = E/base/strands.npz (byte-identical to prof1 combo). Hole zone from
STEP 1: curtain fibres whose projected mid-shaft falls in the profile hole
mask dilated 12px (29,368 curtain + 1,557 rear; curtain only selected).

Cells (one change each):
  c_den duplicate hole-zone curtain fibres 1x with deterministic micro-jitter
          (y +-0.5mm = profile-column fill, x +-0.3mm); same radii.
  c_rad hole-zone curtain fibres radii x1.7 on arc idx 4..26 (tips keep taper).
  c_spr hole-zone curtain fibres mid-shaft y-spread +-1.5mm alternating by
          fibre hash, smooth arc envelope peaking idx 8..24, roots/tips fixed.
  c_hem rail trim: curtain fibres with |tip_x|>0.10 & tip_z<1.42 (8,830, all
          curtain) pull hanging segment (idx 22..31) x inward to +-0.10,
          smooth ramp; z untouched.

Writes E/cells/<tag>/{strands_waved.npz, deform_meta.json}.
"""
import json
import numpy as np
import cv2
from pathlib import Path

E = Path("tools/openclinxr/evidence/hair-cover1")
BASE = E / "base"
S = 1024

score = json.load(open(BASE / "score.json"))
M = np.array(score["render"]["cameras"]["profile_90"]["matrixWorld"], float)
F = 50.0 / 36.0 * S

src = np.load(BASE / "strands.npz")
P0 = np.asarray(src["points"], float)
R0 = np.asarray(src["roots"], float)
RAD0 = np.asarray(src["radii"])
APEX = float(np.asarray(src["apex_y"]))
CX = float(np.asarray(src["cx"]))
N = len(P0)

Minv = np.linalg.inv(M)
Pc = (Minv @ np.concatenate(
    [P0.reshape(-1, 3), np.ones((N * 32, 1))], axis=1).T).T[:, :3]
UU = (S / 2 + F * Pc[:, 0] / (-Pc[:, 2])).reshape(N, 32)
VV = (S / 2 - F * Pc[:, 1] / (-Pc[:, 2])).reshape(N, 32)

hole = np.load(E / "hole-mask.npy")
hdil = cv2.dilate(hole.astype(np.uint8), np.ones((25, 25), np.uint8)) > 0
mid_u = UU[:, 8:24].mean(axis=1)
mid_v = VV[:, 8:24].mean(axis=1)
in_zone = hdil[np.clip(mid_v.astype(int), 0, 1023),
               np.clip(mid_u.astype(int), 0, 1023)]
rear = R0[:, 1] > APEX
ZONE = in_zone & (~rear)
print("ZONE curtain fibres:", int(ZONE.sum()), "of", N)

tips = P0[:, -1]
RAIL = (~rear) & (np.abs(tips[:, 0]) > 0.10) & (tips[:, 2] < 1.42)
print("RAIL fibres:", int(RAIL.sum()))


def hash_signs(idx, seed):
    rng = np.random.default_rng(seed)
    r = rng.random((len(idx), 2))
    return np.where(r > 0.5, 1.0, -1.0), r


def stats(out, pts):
    t0 = np.gradient(pts, axis=1)
    t0 /= np.maximum(np.linalg.norm(t0, axis=2, keepdims=True), 1e-9)
    t1 = np.gradient(out, axis=1)
    t1 /= np.maximum(np.linalg.norm(t1, axis=2, keepdims=True), 1e-9)
    ang = np.degrees(np.arccos(np.clip((t0 * t1).sum(axis=2), -1.0, 1.0)))
    disp = np.linalg.norm(out - pts, axis=2) * 1000.0
    return {"tangentRms": float(np.sqrt(np.mean(ang ** 2))),
            "dispP50": float(np.percentile(disp.max(axis=1), 50)),
            "dispP95": float(np.percentile(disp.max(axis=1), 95)),
            "dispMax": float(disp.max())}


def save(tag, points, roots, radii, info):
    cell = E / "cells" / tag
    cell.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cell / "strands_waved.npz",
                        points=points.astype(np.float32),
                        roots=roots.astype(np.float32), radii=radii,
                        apex_y=np.asarray(src["apex_y"]), cx=np.asarray(src["cx"]))
    (cell / "deform_meta.json").write_text(
        json.dumps({"tag": tag, "base": "hair-cover1/base/strands.npz",
                    "deform": info}, indent=2) + "\n")
    print("CELL", tag, json.dumps(info), flush=True)


zi = np.where(ZONE)[0]

# c_den: duplicate + micro-jitter
sgn, r = hash_signs(zi, 1101)
dup_pts = P0[zi].copy()
jy = sgn[:, 0] * (0.0002 + 0.0003 * r[:, 0])   # +-0.2..0.5mm depth
jx = sgn[:, 1] * (0.0001 + 0.0002 * r[:, 1])   # +-0.1..0.3mm lateral
dup_pts[:, :, 1] += jy[:, None]
dup_pts[:, :, 0] += jx[:, None]
dup_roots = R0[zi].copy()
dup_roots[:, 1] += jy
dup_roots[:, 0] += jx
save("c_den", np.vstack([P0, dup_pts]), np.vstack([R0, dup_roots]),
     np.vstack([RAD0, RAD0[zi]]),
     {"cell": "c_den", "dupFibres": int(ZONE.sum()),
      "jitterYmm": "0.2..0.5 det", "jitterXmm": "0.1..0.3 det",
      "totalFibres": int(N + ZONE.sum())})

# c_rad: regional radius boost
rad = RAD0.copy()
rad[zi, 4:27] *= 1.7
save("c_rad", P0.copy(), R0.copy(), rad,
     {"cell": "c_rad", "zoneFibres": int(ZONE.sum()), "radiusScale": 1.7,
      "arcIdx": "4..26"})

# c_spr: mid-shaft depth spread
spr = P0.copy()
sgn2, _ = hash_signs(zi, 2202)
env = np.zeros(32)
env[4:28] = np.sin(np.pi * (np.arange(4, 28) - 4) / 24.0) ** 2
spr[zi, :, 1] += (sgn2[:, 0] * 0.0015)[:, None] * env[None, :]
save("c_spr", spr, R0.copy(), RAD0.copy(),
     {"cell": "c_spr", "zoneFibres": int(ZONE.sum()), "spreadYmm": "+-1.5",
      "envelope": "sin^2 peak idx 16, 0 at 4/28, roots/tips fixed"})

# c_hem: rail trim
hem = P0.copy()
ri = np.where(RAIL)[0]
excess = np.abs(hem[ri, 22:32, 0]) - 0.10
ramp = np.linspace(0.15, 1.0, 10)[None, :]
pull = np.maximum(excess, 0.0) * ramp
hem[ri, 22:32, 0] -= np.sign(hem[ri, 22:32, 0]) * pull
save("c_hem", hem, R0.copy(), RAD0.copy(),
     {"cell": "c_hem", "railFibres": int(RAIL.sum()),
      "rule": "|tip_x|>0.10 & tip_z<1.42 -> x to +-0.10 ramp idx22..31"})
