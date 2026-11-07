#!/usr/bin/env python3
"""hair-crown3 v7 temple strands: thicken sparse temple drape in place.

v4-up strands towered 20-38mm over the liner and cast hard shadows
(60px dark-band residue). v7 hugs the drape: roots in the lower gap
(y -0.147..-0.130, |x|>30mm), direction = neighbour drape flow
(outward-down-back, ±0.45/+0.15/-0.85 projected on the scalp tangent),
L=16mm, lift 0.3mm + 1mm bow, donor-median radii. Deterministic seed 21.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
SPREAD = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2/tools/openclinxr/evidence/hair-crown2/cells/spread.npz")
CAP = E / "probe_out" / "cap_live.npz"
SEED, L = 21, 0.016


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
    # candidate pool: lower gap, sides
    ys = rng.uniform(-0.147, -0.130, 6000)
    w = 0.037 + (ys + 0.147) * 0.3
    xs = rng.uniform(-1, 1, 6000) * w
    sel = np.abs(xs) > 0.030
    xs, ys = xs[sel], ys[sel]
    z = np.empty(len(xs))
    nrm = np.empty((len(xs), 3))
    for i in range(0, len(xs), 500):
        d2 = ((V[None, :, :2] - np.c_[xs[i:i + 500], ys[i:i + 500]][:, None, :]) ** 2).sum(-1)
        j = d2.argmin(axis=1)
        z[i:i + 500] = V[j, 2]
        nrm[i:i + 500] = N[j]
    new_roots = np.c_[xs, ys, z + 0.0004]
    flow = np.c_[np.sign(xs) * 0.45, np.full(len(xs), 0.15), np.full(len(xs), -0.85)]
    t = flow - nrm * (nrm * flow).sum(1)[:, None]
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-12
    s = np.linspace(0, L, 32)
    lift = 0.0003 + 0.001 * np.sin(np.pi * s / L)
    add = (new_roots[:, None, :] + t[:, None, :] * s[None, :, None]
           + nrm[:, None, :] * lift[None, :, None])
    m = (roots[:, 1] >= -0.124) & (roots[:, 1] < -0.09)
    prof = np.median(radii[m], axis=0).astype(np.float32)
    pn = np.load(E / "cells" / "part.npz")
    pp, pr, prad = (np.asarray(pn[k]) for k in ("points", "roots", "radii"))
    p2 = np.concatenate([pp[:73228], add])
    r2 = np.concatenate([pr[:73228], new_roots])
    rad2 = np.concatenate([prad[:73228], np.tile(prof, (len(add), 1))])
    np.savez_compressed(E / "cells" / "combo_raw.npz", points=p2.astype(np.float32),
                        roots=r2.astype(np.float32), radii=rad2,
                        apex_y=apex, cx=cx)
    np.savez_compressed(E / "cells" / "combo.npz", points=p2.astype(np.float32),
                        roots=r2.astype(np.float32), radii=rad2,
                        apex_y=apex, cx=cx)
    meta = {"v7temple": {"added": int(len(add)), "lengthMm": L * 1000,
                         "flow": "drape (sx*0.45,0.15,-0.85) on tangent"}}
    (E / "cell_meta_v7.json").write_text(json.dumps(meta, indent=1) + "\n")
    print("v7 added", len(add), "combo total", len(p2), flush=True)


if __name__ == "__main__":
    main()
