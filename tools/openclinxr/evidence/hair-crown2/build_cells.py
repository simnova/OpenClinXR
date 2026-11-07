#!/usr/bin/env python3
"""hair-crown2 STEP 2: spread cell (numpy; deterministic).

spread: part-band root duplicates with REAL subpixel-beating offsets.
  band: |x-cx| <= 4mm, y <= apex+60mm (crown1 band extended 20->60mm behind
  the apex to touch the back-crown lattice).
  take every 2nd root in band (+50%, c_den precedent); duplicate shifted
  rigidly outward from midline by a deterministic 0.3->1.0mm ramp
  (0.3mm ~= 0.6px at 2px/mm — first scale that covers new ground).
Raw (pre-repair) saved as *_raw.npz; repair runs in Blender (repair_spread.py).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
BASE = E / "strands_base.npz"


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

    band = (np.abs(roots[:, 0] - cx) <= 0.004) & (roots[:, 1] <= apex + 0.06)
    take = np.flatnonzero(band)[::2]
    order = np.argsort(roots[take][:, 1], kind="stable")
    take = take[order]
    side = np.where(points[take][:, 0, 0] >= cx, 1.0, -1.0)
    ramp = 0.0003 + 0.0007 * np.arange(len(take)) / max(len(take) - 1, 1)
    add = points[take].copy()
    add[:, :, 0] += side[:, None] * ramp[:, None]
    s_points = np.concatenate([points, add])
    s_radii = np.concatenate([radii, radii[take]])
    s_roots = np.concatenate([roots, roots[take] + np.c_[side * ramp,
                                                          np.zeros(len(take)),
                                                          np.zeros(len(take))]])
    meta = {"spread": {
        "change": ("part-band |x|<=4mm y<=apex+60mm, +50pct duplicates, "
                   "rigid outward 0.3->1.0mm ramp by root-y order"),
        "baseCount": int(len(points)), "newCount": int(len(s_points)),
        "addedCount": int(len(take)),
        "bandCount": int(band.sum()),
        "offsetMm": {"min": 0.3, "max": 1.0},
        "endAngleDeg": end_p95(s_points)}}
    np.savez_compressed(cells / "spread_raw.npz", points=s_points.astype(np.float32),
                        roots=s_roots.astype(np.float32), radii=s_radii,
                        apex_y=float(apex), cx=float(cx))
    np.savez_compressed(cells / "spread.npz", points=s_points.astype(np.float32),
                        roots=s_roots.astype(np.float32), radii=s_radii,
                        apex_y=float(apex), cx=float(cx))
    (E / "cell_meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(json.dumps(meta["spread"], indent=1), flush=True)


if __name__ == "__main__":
    main()
