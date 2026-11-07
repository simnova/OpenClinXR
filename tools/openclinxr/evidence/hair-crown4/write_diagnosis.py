#!/usr/bin/env python3
"""hair-crown4 STEP 1: measured diagnosis A/B/C -> E/diagnosis.json (numpy).

(A) root-to-cap-front-boundary: for each front-arc boundary vert, nearest-root
    xy distance; plus per-x-bin y-gap between cap front edge and first roots.
(B) strand height above the scalp surface at arc 5/10/20/40mm for strands
    rooted within 30mm (y) of the front boundary (y<-0.118).
(C) tangent direction at 10mm for the same front-zone strands vs part-band
    flow reference (|x|<=4mm): sideways |x| share, forward/backward share.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
C3 = E.parent / "hair-crown3"
C2 = E.parent / "hair-crown2"


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
    rng = np.random.default_rng(1)
    cap = np.load(C3 / "probe_out" / "cap_live.npz")
    V = np.asarray(cap["verts"], dtype=float)
    F = np.asarray(cap["faces"], dtype=int)
    N = vert_normals(V, F)
    ec: Counter = Counter()
    for tri in F:
        a, b, c = (int(v) for v in tri)
        for u, v in ((a, b), (b, c), (c, a)):
            ec[(min(u, v), max(u, v))] += 1
    bnd = sorted({v for e, n in ec.items() if n == 1 for v in e})
    BV = V[np.array(bnd)]
    front = BV[BV[:, 1] < -0.12]

    sp = np.load(C2 / "cells" / "spread.npz")
    pts = np.asarray(sp["points"], dtype=float)
    roots = np.asarray(sp["roots"], dtype=float)

    # ---- A ----
    dmin = np.empty(len(front))
    for i in range(0, len(front), 256):
        d2 = ((roots[None, :, :2] - front[i:i + 256, None, :2]) ** 2).sum(-1)
        dmin[i:i + 256] = np.sqrt(d2.min(axis=1))
    noseam = np.abs(front[:, 0]) >= 0.003
    bins = {}
    for x0, x1 in [(-0.04, -0.02), (-0.02, -0.01), (-0.01, 0.01),
                   (0.01, 0.02), (0.02, 0.04)]:
        cb = front[(front[:, 0] >= x0) & (front[:, 0] < x1)]
        rb = roots[(roots[:, 0] >= x0) & (roots[:, 0] < x1)]
        bins[f"x[{x0},{x1}]"] = {
            "capFrontYmm": round(float(cb[:, 1].min() * 1000), 1),
            "firstRootYmm": round(float(rb[:, 1].min() * 1000), 1),
            "gapMm": round(float((rb[:, 1].min() - cb[:, 1].min()) * 1000), 1),
        }
    A = {
        "capFrontYmm": round(float(V[:, 1].min() * 1000), 1),
        "firstRootYmm": round(float(roots[:, 1].min() * 1000), 1),
        "frontBndToNearestRootMm": {
            "p0": round(float(dmin.min() * 1000), 2),
            "p10": round(float(np.percentile(dmin, 10) * 1000), 2),
            "p50": round(float(np.median(dmin) * 1000), 2),
            "p90": round(float(np.percentile(dmin, 90) * 1000), 2),
            "max": round(float(dmin.max() * 1000), 2),
            "mean": round(float(dmin.mean() * 1000), 2),
        },
        "noseamP50Mm": round(float(np.median(dmin[noseam]) * 1000), 2),
        "perXBin": bins,
        "nFrontBndVerts": int(len(front)),
        "nStrands": int(len(roots)),
    }

    # ---- B + C ----
    fz = np.flatnonzero(roots[:, 1] < -0.118)
    seg = np.linalg.norm(np.diff(pts, axis=1), axis=2)
    cum = np.concatenate([np.zeros((len(pts), 1)), np.cumsum(seg, axis=1)], axis=1)

    def pos_tan(idx: int, s: float):
        c = cum[idx]
        p = pts[idx]
        j = int(np.searchsorted(c, s, side="right") - 1)
        j = min(max(j, 0), p.shape[0] - 2)
        t = (s - c[j]) / max(c[j + 1] - c[j], 1e-12)
        pos = p[j] * (1 - t) + p[j + 1] * t
        tan = p[j + 1] - p[j]
        return pos, tan / (np.linalg.norm(tan) + 1e-12)

    take = rng.choice(fz, size=min(2000, len(fz)), replace=False)
    B = {}
    for s_mm in (5, 10, 20, 40):
        s = s_mm / 1000
        P = np.array([pos_tan(int(i), s)[0] for i in take])
        h = np.empty(len(take))
        for a in range(0, len(take), 500):
            d2 = ((V[None, :, :] - P[a:a + 500, None, :]) ** 2).sum(-1)
            j = d2.argmin(axis=1)
            h[a:a + 500] = ((P[a:a + 500] - V[j]) * N[j]).sum(axis=1)
        B[f"arc{s_mm}mm"] = {
            "heightAboveScalpMm": {
                "p50": round(float(np.median(h) * 1000), 2),
                "mean": round(float(h.mean() * 1000), 2),
                "p90": round(float(np.percentile(h, 90) * 1000), 2),
                "max": round(float(h.max() * 1000), 2),
            }
        }
    # strand reach into the bare band
    minY = pts[fz][:, :, 1].min(axis=1)
    B["bareBandReach"] = {
        "fracReachYltMinus124": round(float((minY < -0.124).mean()), 3),
        "fracReachYltMinus140": round(float((minY < -0.140).mean()), 4),
        "note": "bare band y in [-0.148,-0.124]; front 8mm (y<-0.140) never touched",
    }

    def flow_stats(idx: np.ndarray) -> dict:
        T = np.array([pos_tan(int(i), 0.010)[1] for i in idx])
        return {
            "n": int(len(idx)),
            "absX p50": round(float(np.median(np.abs(T[:, 0]))), 3),
            "absY p50": round(float(np.median(np.abs(T[:, 1]))), 3),
            "z median": round(float(np.median(T[:, 2])), 3),
            "sidewaysFrac": round(float((np.abs(T[:, 0]) > 0.5).mean()), 3),
            "forwardFrac": round(float((T[:, 1] < 0).mean()), 3),
            "backwardFrac": round(float((T[:, 1] > 0).mean()), 3),
        }

    pb = np.flatnonzero((np.abs(roots[:, 0]) < 0.004) & (np.abs(roots[:, 1] + 0.05) < 0.05))
    C = {
        "frontZone": flow_stats(rng.choice(fz, size=2000, replace=False)),
        "partBandRef": flow_stats(rng.choice(pb, size=min(1000, len(pb)), replace=False)),
        "convention": "-y=forward(toward forehead), +y=backward, z=up; part flow=sweep sideways flat",
    }

    diag = {
        "base": "crown2 spread.npz (73228) + cap_live.npz; no liner/strip",
        "A_rootsVsCapFront": A,
        "B_heightAboveScalp": B,
        "C_tangentAt10mm": C,
        "verdict": ("A PRIMARY: 20-26mm bare band, zero roots, front 8mm untouched "
                    "by any strand. C CONTRIBUTING: front strands dive forward-down "
                    "(sideways 0.42 vs part-flow 1.00) instead of sweeping sideways "
                    "flat. B NOT the front-band cause: strands hug (0.0-0.2mm) "
                    "where present; lift only by 40mm."),
    }
    (E / "diagnosis.json").write_text(json.dumps(diag, indent=1) + "\n")
    print(json.dumps(diag, indent=1), flush=True)


if __name__ == "__main__":
    main()
