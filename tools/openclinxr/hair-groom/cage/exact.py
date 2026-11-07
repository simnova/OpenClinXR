"""Exact collision field: load + trilinear query + root standoff.

The field is the Blender-exported exact signed distance to the bare-body
mesh (BVHTree closest point + ray-parity sign on a 2 mm grid; negative
inside). Numpy only. Out-of-grid queries return +50 mm (far outside; the
grid covers every cage sample with margin, so this path only fires for
wild parameters).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

OUTSIDE_MM = 50.0


def load_exact(path):
    doc = np.load(str(path))
    return {
        "origin": np.array(doc["origin"], dtype=np.float64),
        "spacing": float(doc["spacing"]),
        "sdf": np.array(doc["sdf"], dtype=np.float64),
        "region": np.array(doc["region"], dtype=np.float64),
        "path": str(Path(path).resolve()),
    }


def query_exact(grid, points_mm):
    """Trilinear sample of the exact field at world points (mm in/out)."""
    origin, h = grid["origin"], grid["spacing"]
    sdf = grid["sdf"]
    pts = np.asarray(points_mm, dtype=np.float64)
    idx = (pts - origin) / h
    inside = ((idx[:, 0] >= 0) & (idx[:, 0] <= sdf.shape[0] - 1)
              & (idx[:, 1] >= 0) & (idx[:, 1] <= sdf.shape[1] - 1)
              & (idx[:, 2] >= 0) & (idx[:, 2] <= sdf.shape[2] - 1))
    out = np.full(pts.shape[0], OUTSIDE_MM, dtype=np.float64)
    if not inside.any():
        return out
    sub = np.clip(idx[inside], 0, np.array(sdf.shape) - 1 - 1e-9)
    lo = np.floor(sub).astype(np.int64)
    fr = sub - lo
    i0, j0, k0 = lo[:, 0], lo[:, 1], lo[:, 2]
    fx, fy, fz = fr[:, 0], fr[:, 1], fr[:, 2]
    c000 = sdf[i0, j0, k0]
    c100 = sdf[i0 + 1, j0, k0]
    c010 = sdf[i0, j0 + 1, k0]
    c110 = sdf[i0 + 1, j0 + 1, k0]
    c001 = sdf[i0, j0, k0 + 1]
    c101 = sdf[i0 + 1, j0, k0 + 1]
    c011 = sdf[i0, j0 + 1, k0 + 1]
    c111 = sdf[i0 + 1, j0 + 1, k0 + 1]
    c00 = c000 * (1 - fx) + c100 * fx
    c10 = c010 * (1 - fx) + c110 * fx
    c01 = c001 * (1 - fx) + c101 * fx
    c11 = c011 * (1 - fx) + c111 * fx
    c0 = c00 * (1 - fy) + c10 * fy
    c1 = c01 * (1 - fy) + c11 * fy
    out[inside] = c0 * (1 - fz) + c1 * fz
    return out


def root_standoff(cage, spec, grid):
    """Exact-field signed distance (mm) of every family root (P0 world).

    cage: {family: ribbon_dict with centre_head}; spec carries the crown.
    Rule (spec v4): every root sits 1-3 mm off the scalp (positive).
    """
    from cage import head_to_world
    crown = spec["crown"]
    per = {}
    for family in sorted(cage):
        root_head = np.asarray(
            cage[family]["centre_head"][0], dtype=np.float64)[None, :]
        root_world = head_to_world(root_head, crown)
        val = float(query_exact(grid, root_world * 1000.0)[0])
        per[family] = round(val, 2)
    vals = np.array(list(per.values()))
    return {"perFamily": per, "minMm": round(float(vals.min()), 2),
            "maxMm": round(float(vals.max()), 2),
            "inBand": bool(((vals >= 1.0) & (vals <= 3.0)).all())}
