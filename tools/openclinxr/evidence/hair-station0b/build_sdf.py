#!/usr/bin/env python3
"""Evidence-only: build the offline voxel signed field of the station body.

Voxelizes the exported body triangles (conservative: every voxel touched
by a triangle AABB, padded by one voxel, is marked solid), flood-fills the
interior with binary_fill_holes, then forms the signed field as
outside-EDT minus inside-EDT (negative inside, mm). Sanity asserts guard
a leaked fill (watertight check at head sections). Writes E/body-sdf.npz.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from scipy import ndimage

E = Path(__file__).resolve().parent
VOXEL_MM = 4.0
TOL_MM = 4.0  # one voxel: surface reads within +-1 voxel; collision is
# penetration deeper than TOL_MM (reported raw too)
REGION = {
    "x": (-250.0, 250.0),
    "y": (-350.0, 300.0),
    "z": (950.0, 1800.0),
}


def main():
    body = np.load(str(E / "body-verts.npz"))
    verts_mm = np.array(body["vertices"], dtype=np.float64) * 1000.0
    faces = np.array(body["faces"], dtype=np.int64)
    h = VOXEL_MM
    origin = np.array([REGION["x"][0], REGION["y"][0], REGION["z"][0]])
    shape = tuple(
        int(round((REGION[k][1] - REGION[k][0]) / h)) for k in ("x", "y", "z")
    )
    print("GRID shape=%s origin=%s h=%.1fmm" % (shape, origin.tolist(), h))
    solid = np.zeros(shape, dtype=bool)
    tris = verts_mm[faces]
    lo = np.floor((tris.min(axis=1) - origin) / h).astype(int)
    hi = np.ceil((tris.max(axis=1) - origin) / h).astype(int)
    lo = np.clip(lo, 0, np.array(shape) - 1)
    hi = np.clip(hi, 0, np.array(shape) - 1)
    marked = 0
    for t in range(tris.shape[0]):
        sl = (slice(lo[t, 0], hi[t, 0] + 1), slice(lo[t, 1], hi[t, 1] + 1),
              slice(lo[t, 2], hi[t, 2] + 1))
        n_before = solid[sl].size - solid[sl].sum() if solid[sl].size else 0
        solid[sl] = True
        marked += 1
    print("VOXELIZED tris=%d solidFrac=%.4f" % (marked, solid.mean()))
    filled = ndimage.binary_fill_holes(solid)
    interior_frac = (filled & ~solid).mean()
    print("INTERIOR frac=%.4f" % interior_frac)
    # watertight sanity: head sections must contain interior voxels
    crown_z = float(verts_mm[:, 2].max())
    for drop in (60, 110, 170):
        iz = int(round((crown_z - drop - origin[2]) / h))
        frac = (filled[:, :, iz] & ~solid[:, :, iz]).mean()
        print("  drop=%d interiorFrac=%.4f" % (drop, frac))
        assert frac > 0.002, "fill leaked at drop %d" % drop
    assert 0.001 < interior_frac < 0.2, "suspicious interior frac"
    inside_dt = ndimage.distance_transform_edt(filled) * h
    outside_dt = ndimage.distance_transform_edt(~filled) * h
    sdf = (outside_dt - inside_dt).astype(np.float32)
    np.savez_compressed(
        str(E / "body-sdf.npz"),
        sdf=sdf,
        origin=origin,
        spacing=np.float64(h),
        tolMm=np.float64(TOL_MM),
        region=np.array(
            [REGION["x"][0], REGION["y"][0], REGION["z"][0],
             REGION["x"][1], REGION["y"][1], REGION["z"][1]]
        ),
    )
    print("SDF min=%.1f max=%.1f mean|.|=%.2f" % (
        sdf.min(), sdf.max(), np.abs(sdf).mean()))
    print("SDF_WRITTEN", E / "body-sdf.npz")


if __name__ == "__main__":
    main()
