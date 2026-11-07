#!/usr/bin/env python3
"""hair-crown3 frontroots v2: lie-flat-back cover Visible liner.

v1 (donor-copy) grew a fringe: fringe-zone donors are long face-framing
strands; rooted 24mm forward they hang onto the forehead (IoU f -0.039).
v2: procedural strands that lie ON the scalp pointing back under the dense
mass (crown flow): 32pts/32mm, tangent-back direction, 0.4mm + 1.2mm bow
lift, donor-median radii taper. Placed only where empty (>2mm from any
spread root in xy). Deterministic seed 11.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
SPREAD = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2/tools/openclinxr/evidence/hair-crown2/cells/spread.npz")
CAP = E / "probe_out" / "cap_live.npz"
N_TRY, SEED, L = 4000, 13, 0.040


def vert_normals(V: np.ndarray, F: np.ndarray) -> np.ndarray:
    N = np.zeros_like(V)
    e1 = V[F[:, 1]] - V[F[:, 0]]
    e2 = V[F[:, 2]] - V[F[:, 0]]
    fn = np.cross(e1, e2)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
    return N


def main():
    rng = np.random.default_rng(SEED)
    src = np.load(SPREAD)
    points = np.asarray(src["points"], float)
    roots = np.asarray(src["roots"], float)
    radii = np.asarray(src["radii"], np.float32)
    apex, cx = float(src["apex_y"]), float(src["cx"])
    cap = np.load(CAP)
    V = np.asarray(cap["verts"], float)
    F = np.asarray(cap["faces"], int)
    N = vert_normals(V, F)
    ys = rng.uniform(-0.146, -0.125, N_TRY)
    w = 0.037 + (ys + 0.147) * 0.3
    xs = rng.uniform(-1, 1, N_TRY) * w
    # keep only empty spots
    keep = np.ones(N_TRY, bool)
    for i in range(0, N_TRY, 500):
        d2 = ((roots[None, :, :2] - np.c_[xs[i:i + 500], ys[i:i + 500]][:, None, :]) ** 2).sum(-1)
        keep[i:i + 500] = d2.min(axis=1) > 0.002 ** 2
    xs, ys = xs[keep], ys[keep]
    print("v2 kept", int(keep.sum()), "of", N_TRY, flush=True)
    # nearest cap vert -> surface point + normal
    z = np.empty(len(xs))
    nrm = np.empty((len(xs), 3))
    for i in range(0, len(xs), 500):
        d2 = ((V[None, :, :2] - np.c_[xs[i:i + 500], ys[i:i + 500]][:, None, :]) ** 2).sum(-1)
        j = d2.argmin(axis=1)
        z[i:i + 500] = V[j, 2]
        nrm[i:i + 500] = N[j]
    new_roots = np.c_[xs, ys, z + 0.0005]
    back = np.array([0.0, 0.35, 1.0])
    t = back[None, :] - nrm * (nrm @ back)[:, None]
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-12
    s = np.linspace(0, L, 32)
    lift = 0.0005 + 0.002 * np.sin(np.pi * s / L)
    add = (new_roots[:, None, :] + t[:, None, :] * s[None, :, None]
           + nrm[:, None, :] * lift[None, :, None])
    # donor-median radii taper from fringe-zone strands
    m = (roots[:, 1] >= -0.124) & (roots[:, 1] < -0.09)
    prof = np.median(radii[m], axis=0).astype(np.float32)
    v2_points = np.concatenate([points, add])
    v2_radii = np.concatenate([radii, np.tile(prof, (len(add), 1))])
    v2_roots = np.concatenate([roots, new_roots])
    cells = E / "cells"
    np.savez_compressed(cells / "frontroots_v2_raw.npz", points=v2_points.astype(np.float32),
                        roots=v2_roots.astype(np.float32), radii=v2_radii,
                        apex_y=apex, cx=cx)
    (E / "cell_meta_v2.json").write_text(json.dumps(
        {"frontroots_v2": {"added": int(len(add)), "lengthMm": L * 1000,
                           "radiiProfile": "median fringe-zone taper"}}, indent=1) + "\n")
    print("v2 total", len(v2_points), flush=True)


if __name__ == "__main__":
    main()
