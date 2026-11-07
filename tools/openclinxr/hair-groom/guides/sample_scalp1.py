#!/usr/bin/env python3
"""Poisson subsample of scalp1 real roots to guide roots (station-owned).

Reads tools/openclinxr/evidence/hair-scalp1/roots.npz (xyz world m + normal
world, 14,155 roots), converts to head-frame mm (X=x*1000,
U=(crown_y-y)*1000 anterior+, D=(crown_z-z)*1000 drop below crown; normals
flip y and z), and deterministic greedy Poisson-subsamples (lexsort order,
same algorithm as make_roots.py) to 300-500 guide roots.

Writes E/roots-v2.npz (+ E/roots-v2-alt.npz with a different spacing for
the no-code-change swap test) in the grow.py roots format (pos_head,
nrm_head, crown, rule). grow.py consumes ONLY this file (plus the spec);
swapping files needs no code change.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

S4 = Path(__file__).resolve().parent
ROOT = S4.parents[3]

CROWN = np.array([1.1403722410818773e-09, -0.053241077810525894,
                  1.6599169969558716])

OPENED = []


def track(path):
    OPENED.append(str(Path(path).resolve()))
    return Path(path)


def poisson_greedy(pts, spacing):
    """Deterministic greedy subset with min spacing (fixed input order)."""
    order = np.lexsort((pts[:, 0], pts[:, 2]))
    kept = []
    kept_pts = []
    cell = spacing
    grid = {}
    for idx in order:
        p = pts[idx]
        key = (int(np.floor(p[0] / cell)), int(np.floor(p[1] / cell)),
               int(np.floor(p[2] / cell)))
        ok = True
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for j in grid.get((key[0] + dx, key[1] + dy,
                                       key[2] + dz), ()):
                        if np.linalg.norm(p - kept_pts[j]) < spacing:
                            ok = False
                            break
                        if not ok:
                            break
                    if not ok:
                        break
                if not ok:
                    break
            if not ok:
                break
        if ok:
            grid.setdefault(key, []).append(len(kept_pts))
            kept_pts.append(p)
            kept.append(idx)
    return np.array(kept, dtype=np.int64)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--evidence", required=True)
    ap.add_argument("--spacing", type=float, default=8.0)
    ap.add_argument("--alt-spacing", type=float, default=7.0)
    args = ap.parse_args()
    evidence = Path(args.evidence)
    evidence.mkdir(parents=True, exist_ok=True)

    src = track(ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz")
    doc = np.load(str(src))
    xyz = np.array(doc["xyz"], dtype=np.float64)
    nrm = np.array(doc["normal"], dtype=np.float64)
    print("SCALP1 N=%d spacing=%.2fmm seed=%d" % (
        xyz.shape[0], float(np.asarray(doc["spacing"])),
        int(np.asarray(doc["seed"]))), flush=True)
    head = np.stack([xyz[:, 0] * 1000.0,
                     (CROWN[1] - xyz[:, 1]) * 1000.0,
                     (CROWN[2] - xyz[:, 2]) * 1000.0], axis=1)
    nh = nrm.copy()
    nh[:, 1] *= -1.0
    nh[:, 2] *= -1.0
    nh = nh / np.maximum(np.linalg.norm(nh, axis=1, keepdims=True), 1e-12)

    rule = ("scalp1 real roots (hair-scalp1/roots.npz, 14155 roots) "
            "Poisson-subsampled to guide roots; crown=(%.6f, %.6f, %.6f)"
            % (CROWN[0], CROWN[1], CROWN[2]))
    for stem, spacing in (("roots-v2", args.spacing),
                          ("roots-v2-alt", args.alt_spacing)):
        sel = poisson_greedy(head, spacing)
        az = np.degrees(np.arctan2(head[sel, 0], head[sel, 1]))
        out = {"pos_head": head[sel], "nrm_head": nh[sel],
               "crown": CROWN, "az_deg": az,
               "rule": np.array([rule]),
               "spacing": np.array([spacing])}
        path = evidence / (stem + ".npz")
        np.savez(str(path), **out)
        print("WROTE %s N=%d spacing=%.1f" % (path.name, sel.size, spacing),
              flush=True)
    dest = evidence / "inputs-opened.txt"
    seen = set(dest.read_text().splitlines()) if dest.exists() else set()
    seen.update(OPENED)
    seen.update([str(Path(__file__).resolve())])
    dest.write_text("\n".join(sorted(seen)) + "\n")


if __name__ == "__main__":
    main()
