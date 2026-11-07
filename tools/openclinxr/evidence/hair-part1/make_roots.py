#!/usr/bin/env python3
"""hair-part1 (b): part-edge root density on groom36 roots.

For every root in the part region (PART_Y_LO_M <= y <= Y_VERTEX_M) whose
distance to the part line is 0.75-8 mm, insert the midpoint with its
nearest neighbour (unordered pairs deduped; pairs straddling the line
skipped). Midpoint of two scalp points 1.6 mm apart: chord sag < 0.01 mm.
uv = mean, normal = normalised mean, tri = first root's.
The part line comes from part_line.py (same as interp_children), so
--part-jitter-mm makes the edge follow the jittered line (variant d).
Usage: make_roots.py IN.npz OUT.npz [--part-jitter-mm A --part-jitter-seed S]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

E = Path(__file__).resolve().parent
sys.path.insert(0, str(E.parents[1] / "hair-groom" / "strands"))
import part_line as PL  # noqa: E402

EDGE_LO_M, EDGE_HI_M = 0.00075, 0.008


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("out")
    ap.add_argument("--part-jitter-mm", type=float, default=0.0)
    ap.add_argument("--part-jitter-seed", type=int, default=20261106)
    a = ap.parse_args()
    d = np.load(a.inp, allow_pickle=True)
    xyz = np.asarray(d["xyz"], float)
    uv = np.asarray(d["uv"], float)
    tri = np.asarray(d["tri"])
    nrm = np.asarray(d["normal"], float)
    band = xyz[xyz[:, 2] >= 1.63]
    part_x = float(np.median(band[:, 0]))
    j, rec = PL.make(a.part_jitter_mm, a.part_jitter_seed)

    def pline(y):
        return part_x if j is None else part_x + j(y)

    sd = xyz[:, 0] - pline(xyz[:, 1])
    reg = (xyz[:, 1] >= PL.Y_LO_M) & (xyz[:, 1] <= PL.Y_HI_M)
    edge = reg & (np.abs(sd) >= EDGE_LO_M) & (np.abs(sd) <= EDGE_HI_M)
    _, nn = cKDTree(xyz).query(xyz[edge], k=2)
    ia = np.nonzero(edge)[0]
    ib = nn[:, 1]
    pairs = sorted({(min(p, q), max(p, q)) for p, q in zip(ia, ib)
                    if np.sign(sd[p]) == np.sign(sd[q])})
    pa = np.array([p for p, _ in pairs])
    pb = np.array([q for _, q in pairs])
    mx = 0.5 * (xyz[pa] + xyz[pb])
    mn = nrm[pa] + nrm[pb]
    mn /= np.linalg.norm(mn, axis=1, keepdims=True)
    out = {k: d[k] for k in d.files}
    out["xyz"] = np.vstack([xyz, mx])
    out["uv"] = np.vstack([uv, 0.5 * (uv[pa] + uv[pb])])
    out["tri"] = np.concatenate([tri, tri[pa]])
    out["normal"] = np.vstack([nrm, mn])
    np.savez_compressed(a.out, **out)
    gap = np.linalg.norm(xyz[pa] - xyz[pb], axis=1) * 1000.0
    rep = {"in": a.inp, "out": a.out,
           "sha256": hashlib.sha256(Path(a.out).read_bytes()).hexdigest()[:16],
           "nIn": int(len(xyz)), "nEdgeRoots": int(edge.sum()),
           "nAdded": int(len(pa)), "nOut": int(len(out["xyz"])),
           "edgeMm": [EDGE_LO_M * 1000.0, EDGE_HI_M * 1000.0],
           "edgeDensityMultiplier": round(1.0 + len(pa) / max(int(edge.sum()), 1), 4),
           "pairGapMm": {"p50": round(float(np.median(gap)), 3),
                         "max": round(float(gap.max()), 3)},
           "addedXpos": int((mx[:, 0] > part_x).sum()),
           "addedXneg": int((mx[:, 0] < part_x).sum()),
           "partJitter": rec}
    Path(a.out).with_suffix(".json").write_text(json.dumps(rep, indent=1) + "\n")
    print(json.dumps(rep))


if __name__ == "__main__":
    main()
