"""S8 STEP 1a (numpy): hull0c outer surface via marching cubes + Taubin smooth.

Reads: E_hull/hull.npz (occupancy bool (261,211,233), 2 mm grid, xs/ys/zs
mm). Writes: WS/shell_raw.obj (world metres) + WS/shell_raw.npz (verts
m, faces, volumeBefore/AfterM3, smoother iterations) + WS/mesh_hash.json.

Smoother: Taubin lambda|mu (volume-preserving, no shrinkage), lambda=0.5
mu=-0.53, 30 iterations (15 lambda+mu pairs) on the full-res mesh. The
mesh volume (divergence theorem) is reported before/after to evidence
the preservation claim. Marching cubes + Taubin are fixed-order numpy
ops: deterministic by construction (no RNG anywhere in this file).
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

S8 = Path(__file__).resolve().parent
sys.path.insert(0, str(S8))
from common import log_open, sha256  # noqa: E402

ROOT = S8.parents[3]
E_HULL = ROOT / "tools/openclinxr/evidence/hair-hull0c"
E = ROOT / "tools/openclinxr/evidence/hair-shell0"
WS = E / "workspace"

TAUBIN_LAMBDA = 0.5
TAUBIN_MU = -0.53
TAUBIN_ITERS = 30  # even: alternating lambda/mu passes


def mesh_volume(verts, faces) -> float:
    v0 = verts[faces[:, 0]]
    v1 = verts[faces[:, 1]]
    v2 = verts[faces[:, 2]]
    return float(np.sum(np.einsum("ij,ij->i", v0, np.cross(v1, v2))) / 6.0)


def taubin_smooth(verts, faces, lam, mu, iters):
    n = len(verts)
    e0 = np.concatenate([faces[:, 0], faces[:, 1], faces[:, 2]])
    e1 = np.concatenate([faces[:, 1], faces[:, 2], faces[:, 0]])
    order = np.argsort(e0, kind="stable")
    e0s = e0[order]
    e1s = e1[order]
    uniq, starts = np.unique(e0s, return_index=True)
    bounds = np.concatenate([starts, [len(e0s)]])
    nbr_sum = np.empty_like(verts)
    v = verts.copy()
    for it in range(iters):
        nbr_sum[:] = 0.0
        np.add.at(nbr_sum, e1s, v[e0s])
        cnt = np.diff(bounds)
        mean = nbr_sum[uniq] / cnt[:, None]
        step = lam if it % 2 == 0 else mu
        v[uniq] += step * (mean - v[uniq])
    return v


def main():
    E.mkdir(parents=True, exist_ok=True)
    WS.mkdir(parents=True, exist_ok=True)
    log_open(Path(__file__))
    log_open(S8 / "common.py")
    hn = E_HULL / "hull.npz"
    log_open(hn)
    h = np.load(str(hn))
    occ = np.array(h["occupancy"], dtype=bool)
    xs, ys, zs = (np.array(h["xs"]), np.array(h["ys"]),
                  np.array(h["zs"]))
    spacing = float(h["spacing"])
    assert spacing == 2.0, spacing
    assert occ.shape == (len(xs), len(ys), len(zs)), occ.shape

    from skimage.measure import marching_cubes
    verts_idx, faces, _, _ = marching_cubes(
        occ.astype(np.float32), level=0.5,
        spacing=(spacing, spacing, spacing))
    origin = np.array([xs[0], ys[0], zs[0]])
    verts_mm = verts_idx + origin
    vol_before = mesh_volume(verts_mm, faces)  # mm^3
    print("MARCHING_CUBES verts=%d tris=%d volBefore=%.1f mm^3" % (
        len(verts_mm), len(faces), vol_before), flush=True)

    smooth_mm = taubin_smooth(verts_mm, faces.astype(np.int64),
                              TAUBIN_LAMBDA, TAUBIN_MU, TAUBIN_ITERS)
    vol_after = mesh_volume(smooth_mm, faces)
    drift_pct = 100.0 * (vol_after - vol_before) / abs(vol_before)
    print("TAUBIN lambda=%.2f mu=%.2f iters=%d volAfter=%.1f mm^3 "
          "drift=%+.3f%%" % (
              TAUBIN_LAMBDA, TAUBIN_MU, TAUBIN_ITERS, vol_after,
              drift_pct), flush=True)

    verts_m = np.ascontiguousarray(smooth_mm / 1000.0)
    faces_i = np.ascontiguousarray(faces.astype(np.int64))
    with open(WS / "shell_raw.obj", "w") as f:
        f.write("# hair-shell0 raw outer surface (marching cubes + "
                "taubin, world m)\n")
        for p in verts_m:
            f.write("v %.6f %.6f %.6f\n" % (p[0], p[1], p[2]))
        for t in faces_i:
            f.write("f %d %d %d\n" % (t[0] + 1, t[1] + 1, t[2] + 1))
    np.savez(str(WS / "shell_raw.npz"), verts=verts_m, faces=faces_i,
             volumeBeforeMm3=np.float64(vol_before),
             volumeAfterMm3=np.float64(vol_after),
             taubinIters=np.int64(TAUBIN_ITERS),
             taubinLambda=np.float64(TAUBIN_LAMBDA),
             taubinMu=np.float64(TAUBIN_MU))
    log_open(WS / "shell_raw.obj")
    log_open(WS / "shell_raw.npz")
    mh = hashlib.sha256()
    mh.update(np.ascontiguousarray(verts_m).tobytes())
    mh.update(np.ascontiguousarray(faces_i).tobytes())
    (WS / "mesh_hash.json").write_text(json.dumps(
        {"stage": "raw", "sha256": mh.hexdigest(),
         "verts": int(len(verts_m)), "tris": int(len(faces_i)),
         "volumeBeforeMm3": round(vol_before, 1),
         "volumeAfterMm3": round(vol_after, 1),
         "driftPct": round(drift_pct, 4)}, indent=1) + "\n")
    print("RAW_HASH %s" % mh.hexdigest()[:16], flush=True)


if __name__ == "__main__":
    main()
