#!/usr/bin/env python3
"""hair-crown1 STEP 2 cell construction (numpy; deterministic; one change each).

Base: hair-prof1/cells/combo/strands.npz. All cells target the STEP 1 verdict
(exposed scalp in the part/crown lattice), not lights or hue.
  c_den  +50% roots in the part band (|x-cx|<=4mm, y<=apex+20mm), +40um x-offset
         outward from midline (deterministic duplicate, n2/int1 precedent).
  c_slit part-slit overhang: roots within 3mm of midline lean over the slit,
         1.2mm at root fading over the first 12 points.
  c_lift root press: part-band points[1:7] z pulled 25% toward root z (less tent).
  c_liner: no strand change (combo strands); dark cap liner added at render time
         by score_liner.py (hair-int1 scalp_patch precedent).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
BASE = E.parent / "hair-prof1/cells/combo/strands.npz"


def end_p95(points: np.ndarray) -> dict:
    end_vec = points[:, -1] - points[:, -5]
    deg = np.degrees(np.arctan2(np.linalg.norm(end_vec[:, :2], axis=1),
                                np.abs(end_vec[:, 2]) + 1e-12))
    return {"p50": float(np.percentile(deg, 50)),
            "p95": float(np.percentile(deg, 95)),
            "max": float(deg.max())}


def main():
    src = np.load(BASE)
    points = np.asarray(src["points"], float)
    roots = np.asarray(src["roots"], float)
    radii = np.asarray(src["radii"], np.float32)
    cx, apex = float(src["cx"]), float(src["apex_y"])
    cells = E / "cells"
    cells.mkdir(exist_ok=True)
    meta = {}

    band = (np.abs(roots[:, 0] - cx) <= 0.004) & (roots[:, 1] <= apex + 0.02)

    # c_den: deterministic +50% in band
    take = np.flatnonzero(band)[::2]
    side = np.where(points[take][:, 0, 0] >= cx, 1.0, -1.0)
    add = points[take].copy()
    add[:, :, 0] += side[:, None] * 0.00004
    d_points = np.concatenate([points, add])
    d_radii = np.concatenate([radii, radii[take]])
    d_roots = np.concatenate([roots, roots[take] + np.c_[side * 0.00004,
                                                         np.zeros(len(take)),
                                                         np.zeros(len(take))]])
    meta["c_den"] = {"change": "+50pct duplicates in part band |x|<=4mm y<=apex+20mm, +40um outward x",
                     "baseCount": int(len(points)), "newCount": int(len(d_points)),
                     "addedCount": int(len(take))}
    np.savez_compressed(cells / "c_den.npz", points=d_points.astype(np.float32),
                        roots=d_roots.astype(np.float32), radii=d_radii,
                        apex_y=float(apex), cx=float(cx))

    # c_slit: overhang lean over the slit
    near = (np.abs(roots[:, 0] - cx) <= 0.003) & (roots[:, 1] <= apex + 0.02)
    s_points = points.copy()
    sgn = np.sign(points[near][:, 0, 0] - cx)
    fade = 0.0012 * (1.0 - np.arange(12) / 12.0)
    idx = np.flatnonzero(near)
    for k, j in enumerate(range(12)):
        s_points[idx, j, 0] -= sgn * fade[j]
    meta["c_slit"] = {"change": "roots within 3mm of midline lean over slit, 1.2mm at root fading over first 12 pts",
                      "movedCount": int(len(idx))}
    np.savez_compressed(cells / "c_slit.npz", points=s_points.astype(np.float32),
                        roots=roots.astype(np.float32), radii=radii,
                        apex_y=float(apex), cx=float(cx))

    # c_lift: press initial segment toward root height
    l_points = points.copy()
    lidx = np.flatnonzero(band)
    rz = roots[lidx][:, 2]
    for j in range(1, 7):
        l_points[lidx, j, 2] = rz + (l_points[lidx, j, 2] - rz) * 0.75
    meta["c_lift"] = {"change": "part-band points[1:7] z 25pct toward root z (less tent over scalp)",
                      "movedCount": int(len(lidx))}
    np.savez_compressed(cells / "c_lift.npz", points=l_points.astype(np.float32),
                        roots=roots.astype(np.float32), radii=radii,
                        apex_y=float(apex), cx=float(cx))

    for tag, arr in (("c_den", d_points), ("c_slit", s_points), ("c_lift", l_points)):
        meta[tag]["endAngleDeg"] = end_p95(arr)
    (E / "cell_meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(json.dumps({k: {kk: meta[k][kk] for kk in ("newCount", "movedCount", "addedCount") if kk in meta[k]}
                      for k in meta}, indent=1))


if __name__ == "__main__":
    main()
