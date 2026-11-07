#!/usr/bin/env python3
"""Provisional scalp roots for the guide-field fit (station-owned sampling).

Reads the station0b bare-body mesh (topper excluded), takes head-surface
verts above a simple hairline rule, computes area-weighted vertex normals,
and Poisson-subsamples (deterministic greedy, fixed order) to ~256 guide
roots. Writes E/roots-provisional.npz (+ E/roots-alt.npz with a different
spacing/seed for the no-code-change swap test).

PROVISIONAL HAIRLINE RULE (stated; scalp1 replaces this file, not the code):
  head frame mm: X = x*1000, U = (crown_y - y)*1000 (anterior+),
  D = (crown_z - z)*1000 (drop below crown). az = atan2(X, U) deg.
  keep verts with D < HL(az) where HL = 80 anterior half (|az| <= 90),
  65 posterior half; and U < 95 (brow plane exclusion); and D >= -5
  (above the crown point). No face, no neck, no ears carve-out.

Output npz: pos_head (N,3) X/U/D mm, nrm_head (N,3) unit outward,
crown (3) world m, az_deg (N,), rule (json string), source sha.
grow.py consumes ONLY this file (plus the spec); swapping files needs no
code change.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

S4 = Path(__file__).resolve().parent
ROOT = S4.parents[3]
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom"))

OPENED = []


def track(path):
    OPENED.append(str(Path(path).resolve()))
    return Path(path)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


CROWN = np.array([1.1403722410818773e-09, -0.053241077810525894,
                  1.6599169969558716])


def vertex_normals(verts, faces):
    nrm = np.zeros_like(verts)
    v0, v1, v2 = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    fn = np.cross(v1 - v0, v2 - v0)
    area = np.linalg.norm(fn, axis=1, keepdims=True)
    area[area == 0.0] = 1.0
    fn = fn / area
    for k in range(3):
        np.add.at(nrm, faces[:, k], fn)
    lens = np.linalg.norm(nrm, axis=1, keepdims=True)
    lens[lens == 0.0] = 1.0
    return nrm / lens


def subdivide_once(verts, faces, mask):
    """One midpoint-subdivision pass over faces fully inside mask.

    Returns densified (verts, faces); new-vertex normals are recomputed by
    the caller. Deterministic (edge map keyed on sorted index pairs)."""
    edge_mid = {}
    new_verts = [verts]
    add = []

    def midpoint(a, b):
        key = (a, b) if a < b else (b, a)
        m = edge_mid.get(key)
        if m is None:
            m = verts.shape[0] + len(add)
            add.append(0.5 * (verts[a] + verts[b]))
            edge_mid[key] = m
        return m

    tris = []
    for tri in faces:
        if not (mask[tri[0]] and mask[tri[1]] and mask[tri[2]]):
            continue
        a, b, c = (int(tri[0]), int(tri[1]), int(tri[2]))
        mab, mbc, mca = midpoint(a, b), midpoint(b, c), midpoint(c, a)
        tris += [(a, mab, mca), (b, mbc, mab), (c, mca, mbc),
                 (mab, mbc, mca)]
    if add:
        new_verts.append(np.array(add))
    return np.vstack(new_verts), np.array(tris, dtype=np.int64)


def hairline_keep(X, U, D):
    az = np.degrees(np.arctan2(X, U))
    HL = np.where(np.abs(az) <= 90.0, 80.0, 65.0)
    return (D >= -5.0) & (D < HL) & (U < 95.0)


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
    ap.add_argument("--spacing", type=float, default=12.0)
    ap.add_argument("--alt-spacing", type=float, default=10.0)
    ap.add_argument("--stem", default="roots-provisional")
    ap.add_argument("--alt-stem", default="roots-alt")
    args = ap.parse_args()
    evidence = Path(args.evidence)
    evidence.mkdir(parents=True, exist_ok=True)

    mesh_path = track(ROOT / "tools/openclinxr/evidence/hair-station0b"
                      / "body-verts.npz")
    mesh_sha = sha256_file(mesh_path)
    doc = np.load(str(mesh_path))
    verts = np.array(doc["vertices"], dtype=np.float64)  # world m
    faces = np.array(doc["faces"], dtype=np.int64)
    X = verts[:, 0] * 1000.0
    U = (CROWN[1] - verts[:, 1]) * 1000.0
    D = (CROWN[2] - verts[:, 2]) * 1000.0
    coarse = hairline_keep(X, U, D)
    # widen one ring so subdivision covers the cap edge, then subdivide
    wide = coarse.copy()
    for tri in faces:
        if coarse[tri].any():
            wide[tri] = True
    verts, faces = subdivide_once(verts, faces, wide)
    nrm = vertex_normals(verts, faces)
    X = verts[:, 0] * 1000.0
    U = (CROWN[1] - verts[:, 1]) * 1000.0
    D = (CROWN[2] - verts[:, 2]) * 1000.0
    head = np.stack([X, U, D], axis=1)
    keep = hairline_keep(X, U, D)
    pool = head[keep]
    pool_n = nrm[keep]
    print("POOL %d verts above hairline rule" % pool.shape[0], flush=True)
    rule = ("provisional: D < 80mm anterior (|az|<=90) / 65mm posterior, "
            "U < 95mm brow exclusion, D >= -5mm; crown=(%.6f, %.6f, %.6f); "
            "mesh_sha=%s" % (CROWN[0], CROWN[1], CROWN[2], mesh_sha))

    for stem, spacing in ((args.stem, args.spacing),
                          (args.alt_stem, args.alt_spacing)):
        sel = poisson_greedy(pool, spacing)
        # worldTaylor -> head frame: X=x, U=crown_y-y, D=crown_z-z, so
        # normals flip y and z.
        nh = pool_n[sel].copy()
        nh[:, 1] *= -1.0
        nh[:, 2] *= -1.0
        nh = nh / np.maximum(np.linalg.norm(nh, axis=1, keepdims=True),
                             1e-12)
        az = np.degrees(np.arctan2(pool[sel, 0], pool[sel, 1]))
        out = {"pos_head": pool[sel], "nrm_head": nh,
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
    dest.write_text("\n".join(sorted(seen)) + "\n")


if __name__ == "__main__":
    main()
