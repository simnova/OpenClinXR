"""Blender side of the exact collision field (runs inside Blender only).

Builds a BVHTree from the station0b bare-body export (body-verts.npz: the
same mesh the voxel SDF was built from, topper excluded) and evaluates the
exact signed distance on a 2 mm grid over the head/neck/shoulder region:
  closest point via BVHTree.find_nearest (exact distance to the triangles),
  sign via ray parity along +X (odd crossings = inside, negative).
A miss returns the 4-None tuple in Blender 5.1 (not None) and ends the
parity walk. Writes E/body-exact-sdf.npz (float32) + scalp reference
(topmost vertex + area-weighted normal) for the STEP 1 self-test.

Usage (foreground Blender):
  Blender --background --python export_exact_sdf.py -- \
    --body-verts <body-verts.npz> --out <body-exact-sdf.npz>
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# world-mm grid over the head/neck/shoulder region (covers every cage
# sample: |X| <= ~260 at the widest hem, U in [-200, +150] rel crown,
# drops 0..520 below the 1659.9 mm crown, plus margin for trilinear).
ORIGIN = (-260.0, -260.0, 1080.0)
END = (260.0, 160.0, 1720.0)
H = 2.0


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--body-verts", required=True)
    parser.add_argument("--out", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def main():
    import time

    import numpy as np
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree

    args = cli()
    body = np.load(str(Path(args.body_verts).resolve()))
    verts = np.array(body["vertices"], dtype=np.float64)  # metres, world
    faces = np.array(body["faces"], dtype=np.int64)
    tree = BVHTree.FromPolygons(
        [Vector((float(a), float(b), float(c))) for a, b, c in verts],
        [tuple(int(x) for x in f) for f in faces])
    print("EXACT tree verts=%d tris=%d" % (len(verts), len(faces)),
          flush=True)

    nx = int(round((END[0] - ORIGIN[0]) / H)) + 1
    ny = int(round((END[1] - ORIGIN[1]) / H)) + 1
    nz = int(round((END[2] - ORIGIN[2]) / H)) + 1
    print("EXACT grid nx=%d ny=%d nz=%d total=%.2fM" % (
        nx, ny, nz, nx * ny * nz / 1e6), flush=True)
    sdf = np.empty((nx, ny, nz), dtype=np.float32)

    xs = (np.arange(nx) * H + ORIGIN[0]) / 1000.0  # metres
    DX = Vector((1.0, 0.0, 0.0))
    t0 = time.time()
    parity_iters = 0
    for iz in range(nz):
        z = (ORIGIN[2] + iz * H) / 1000.0
        for iy in range(ny):
            y = (ORIGIN[1] + iy * H) / 1000.0
            for ix in range(nx):
                x = float(xs[ix])
                p = Vector((x, y, z))
                hit = tree.find_nearest(p)
                d = float((p - hit[0]).length) * 1000.0
                cnt = 0
                ox = x + 1e-4
                for _ in range(12):
                    r = tree.ray_cast(Vector((ox, y, z)), DX)
                    if r is None or r[0] is None:
                        break  # miss tuple: outside past this point
                    cnt += 1
                    parity_iters += 1
                    ox += float(r[3]) + 1e-4
                sdf[ix, iy, iz] = -d if cnt % 2 == 1 else d
        if iz % 20 == 0 or iz == nz - 1:
            print("EXACT slab iz=%d/%d secs=%.0f" % (
                iz, nz, time.time() - t0), flush=True)

    # scalp reference: topmost vertex + area-weighted vertex normal (mm)
    vmm = verts * 1000.0
    top = int(np.argmax(vmm[:, 2]))
    tri = vmm[faces]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    area = np.linalg.norm(fn, axis=1)
    fn = fn / np.maximum(area[:, None], 1e-12)
    vn = np.zeros_like(vmm)
    np.add.at(vn, faces[:, 0], fn * area[:, None])
    np.add.at(vn, faces[:, 1], fn * area[:, None])
    np.add.at(vn, faces[:, 2], fn * area[:, None])
    n = vn[top] / max(np.linalg.norm(vn[top]), 1e-12)

    out = Path(args.out)
    np.savez_compressed(
        str(out), sdf=np.ascontiguousarray(sdf),
        origin=np.array(ORIGIN, dtype=np.float64),
        spacing=np.float64(H),
        region=np.array([ORIGIN[0], ORIGIN[1], ORIGIN[2],
                         END[0], END[1], END[2]], dtype=np.float64),
        scalpPointMm=np.array(vmm[top], dtype=np.float64),
        scalpNormal=np.array(n, dtype=np.float64),
        scalpVertIdx=np.int64(top),
        method=np.array("BVHTree.find_nearest + ray parity +X, 2mm grid"),
        sign=np.array("negative inside"))
    print("EXACT wrote %s secs=%.0f parityHits=%d" % (
        out, time.time() - t0, parity_iters), flush=True)


if __name__ == "__main__":
    main()
