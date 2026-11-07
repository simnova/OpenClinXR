#!/usr/bin/env python3
"""groom31: shirt SDF subgrid (4mm torso box) via trimesh+pyembree.
Same sdf_sampler schema as body-exact-sdf (origin mm, spacing, sdf mm).
Union with body happens at query time: s_eff = min(body, shirt)."""
import time
import numpy as np
from pathlib import Path
import trimesh
STORE31 = Path("/Volumes/files/openclinxr-assets/store/hair-groom31")
ORIGIN = (-350.0, -300.0, 850.0); END = (350.0, 250.0, 1600.0); H = 4.0
def main():
    t0 = time.time()
    m = np.load(str(STORE31 / "aisha-meshes.npz"))
    tm = trimesh.Trimesh(vertices=m["shirt_v"].astype(np.float64),
                         faces=m["shirt_f"], process=False)
    pq = trimesh.proximity.ProximityQuery(tm)
    nx = int(round((END[0]-ORIGIN[0])/H))+1
    ny = int(round((END[1]-ORIGIN[1])/H))+1
    nz = int(round((END[2]-ORIGIN[2])/H))+1
    print("grid %d x %d x %d = %.2fM" % (nx, ny, nz, nx*ny*nz/1e6), flush=True)
    xs = ORIGIN[0] + np.arange(nx)*H
    ys = ORIGIN[1] + np.arange(ny)*H
    sdf = np.empty((nx, ny, nz), dtype=np.float32)
    CH = 1 << 18
    for iz in range(nz):
        z = ORIGIN[2] + iz*H
        XX, YY = np.meshgrid(xs, ys, indexing="ij")
        q = np.stack([XX.ravel(), YY.ravel(), np.full(XX.size, z)], axis=1) / 1000.0
        out = np.empty(len(q), dtype=np.float32)
        for a in range(0, len(q), CH):
            out[a:a+CH] = pq.signed_distance(q[a:a+CH]) * 1000.0
        sdf[:, :, iz] = out.reshape(nx, ny)
        if iz % 20 == 0 or iz == nz-1:
            print("slab %d/%d %.0fs" % (iz, nz, time.time()-t0), flush=True)
    np.savez_compressed(str(STORE31 / "shirt-sdf-4mm.npz"), sdf=sdf,
                        origin=np.array(ORIGIN), spacing=np.float64(H),
                        region=np.array([ORIGIN[0], ORIGIN[1], ORIGIN[2],
                                         END[0], END[1], END[2]]),
                        method=np.array("trimesh+pyembree signed_distance, 4mm torso box"),
                        sign=np.array("negative inside"))
    print("WROTE shirt-sdf-4mm.npz %.0fs min=%.1f max=%.1f" %
          (time.time()-t0, sdf.min(), sdf.max()), flush=True)
if __name__ == "__main__":
    main()
