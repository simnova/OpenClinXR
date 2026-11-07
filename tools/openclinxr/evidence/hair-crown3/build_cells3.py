#!/usr/bin/env python3
"""hair-crown3 STEP 2 strand cells (numpy; deterministic seed 7).

Base = crown2 spread.npz (73228).
frontroots: ~4200 new roots in the gap between the cap front boundary
  (y=-0.148) and the current first hair row (y=-0.124): y~U(-0.147,-0.124),
  |x|<=w(y) (w: 37mm@front -> 44mm@-0.124, from live-cap boundary), z = cap
  surface (kNN=8 mean) + 0.5mm lift. Shape = nearest spread root (y>=-0.124,
  xy distance) point-offsets (same flow as neighbours). ~50% of donor-band
  density (crown2 c_den precedent).
part: flank strands (|x_root|<=2.5mm, y_root in [-0.11,0.02]) shifted rigidly
  outward 0.75mm to open the visible line to ~8px over the tinted strip.
combo: frontroots + part nudge.
Raw outputs *_raw.npz; repair runs in Blender (repair_cells3.py).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
BASE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2/tools/openclinxr/evidence/hair-crown2/cells/spread.npz")
CAP = E / "probe_out" / "cap_live.npz"
N_NEW = 4200
SEED = 7
GAP_Y0, GAP_Y1 = -0.147, -0.124
PART_X, PART_Y0, PART_Y1, NUDGE = 0.0025, -0.11, 0.02, 0.00075


def cap_z_at(xy: np.ndarray, V: np.ndarray) -> np.ndarray:
    out = np.empty(len(xy))
    for i in range(0, len(xy), 512):
        d2 = ((V[None, :, :2] - xy[i:i + 512, None, :]) ** 2).sum(-1)
        idx = np.argpartition(d2, 8, axis=1)[:, :8]
        out[i:i + 512] = V[idx, 2].mean(axis=1)
    return out


def main():
    rng = np.random.default_rng(SEED)
    src = np.load(BASE)
    points = np.asarray(src["points"], float)
    roots = np.asarray(src["roots"], float)
    radii = np.asarray(src["radii"], np.float32)
    apex, cx = float(src["apex_y"]), float(src["cx"])
    cap = np.load(CAP)
    V = np.asarray(cap["verts"], float)
    cells = E / "cells"
    cells.mkdir(exist_ok=True)
    meta = {}

    # ---- frontroots ----
    ys = rng.uniform(GAP_Y0, GAP_Y1, N_NEW)
    w = 0.037 + (ys + 0.147) * 0.3
    xs = (rng.uniform(-1, 1, N_NEW)) * w
    z = cap_z_at(np.c_[xs, ys], V) + 0.0005
    new_roots = np.c_[xs, ys, z]
    cand = np.flatnonzero(roots[:, 1] >= -0.124)
    d2 = ((roots[cand, None, :2].transpose(1, 0, 2) - new_roots[None, :, :2].transpose(1, 0, 2)) ** 2).sum(-1) \
        if False else None
    # chunked nearest donor
    donor = np.empty(N_NEW, dtype=int)
    for i in range(0, N_NEW, 512):
        dd = ((roots[cand][None, :, :2] - new_roots[i:i + 512, None, :2]) ** 2).sum(-1)
        donor[i:i + 512] = cand[dd.argmin(axis=1)]
    offsets = points[donor] - roots[donor][:, None, :]
    add = new_roots[:, None, :] + offsets
    fr_points = np.concatenate([points, add])
    fr_radii = np.concatenate([radii, radii[donor]])
    fr_roots = np.concatenate([roots, new_roots])
    meta["frontroots"] = {"added": N_NEW, "newTotal": int(len(fr_points)),
                          "donorPool": int(len(cand))}
    np.savez_compressed(cells / "frontroots_raw.npz", points=fr_points.astype(np.float32),
                        roots=fr_roots.astype(np.float32), radii=fr_radii,
                        apex_y=apex, cx=cx)
    print("frontroots", N_NEW, "total", len(fr_points), flush=True)

    # ---- part nudge (on spread base) ----
    flank = (np.abs(roots[:, 0]) <= PART_X) & (roots[:, 1] >= PART_Y0) & (roots[:, 1] <= PART_Y1)
    sgn = np.sign(points[flank][:, 0, 0] - cx)
    sgn[sgn == 0] = 1.0
    p_points = points.copy()
    p_points[flank, :, 0] += sgn[:, None] * NUDGE
    p_roots = roots.copy()
    p_roots[flank, 0] += sgn * NUDGE
    meta["part"] = {"nudged": int(flank.sum()), "nudgeMm": NUDGE * 1000}
    np.savez_compressed(cells / "part_raw.npz", points=p_points.astype(np.float32),
                        roots=p_roots.astype(np.float32), radii=radii,
                        apex_y=apex, cx=cx)
    print("part nudged", int(flank.sum()), flush=True)

    # ---- combo ----
    c_points = np.concatenate([p_points, add])
    c_radii = np.concatenate([radii, radii[donor]])
    c_roots = np.concatenate([p_roots, new_roots])
    np.savez_compressed(cells / "combo_raw.npz", points=c_points.astype(np.float32),
                        roots=c_roots.astype(np.float32), radii=c_radii,
                        apex_y=apex, cx=cx)
    meta["combo"] = {"added": N_NEW, "nudged": int(flank.sum()),
                     "newTotal": int(len(c_points))}
    print("combo total", len(c_points), flush=True)
    (E / "cell_meta.json").write_text(json.dumps(meta, indent=1) + "\n")


if __name__ == "__main__":
    main()
