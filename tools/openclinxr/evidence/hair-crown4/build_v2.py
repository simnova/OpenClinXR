#!/usr/bin/env python3
"""hair-crown4 STEP 2 v2: full-set assemblies + sides/edge cells (numpy).

v1 scoring: flatten thins the crown centre (TP -1944 centre, IoU f -0.078);
combo v1 (flatten+fills) IoU f -0.037, ori f +2.4 -> both reverted as
composed. v2: cover only where the target supports hair (flanks + hair-edge
drape from behind), centre handled tonally (fade_tone cell via --liner).
  fill_flat_full : base + fill_flat_raw new strands (FULL SET for scoring).
  fill_long_full : base + fill_long_raw new strands (FULL SET for scoring).
  side_fill : +3000 roots, bare-band flanks |x| in [25,45]mm, L=45mm flat.
  edge_fill : +4000 roots just behind the band (y in [-0.124,-0.110],
              |x|>=2mm), L=30mm flat sideways drape into the band.
  combo2    : base + side_fill + edge_fill (no flatten, no centre fill).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from build_cells4 import NPTS, SEAM, Scalp, drape

E = Path(__file__).resolve().parent
C2 = E.parent / "hair-crown2"
BASE = C2 / "cells" / "spread.npz"


def band_roots_x(scalp: Scalp, rng: np.random.Generator, n: int,
                 y0: float, y1: float, xlo: float, xhi: float):
    xs_list, ys_list = [], []
    need = n
    guard = 0
    while need > 0 and guard < 60:
        ys = rng.uniform(y0, y1, need * 2)
        ax = rng.uniform(xlo, xhi, need * 2)
        sx = rng.choice(np.array([-1.0, 1.0]), need * 2)
        xs = sx * ax
        keep = np.abs(xs) >= SEAM
        xs, ys = xs[keep], ys[keep]
        _, _, dxy = scalp.query(np.c_[xs, ys])
        inside = dxy < 0.002
        xs_list.append(xs[inside][:need])
        ys_list.append(ys[inside][:need])
        need -= int(inside.sum())
        guard += 1
    xs = np.concatenate(xs_list)[:n]
    ys = np.concatenate(ys_list)[:n]
    z, _, _ = scalp.query(np.c_[xs, ys])
    return np.c_[xs, ys, z + 0.0004]


def main():
    scalp = Scalp()
    src = np.load(BASE)
    points = np.asarray(src["points"], dtype=float)
    roots = np.asarray(src["roots"], dtype=float)
    radii = np.asarray(src["radii"], np.float32)
    apex, cx = float(src["apex_y"]), float(src["cx"])
    cells = E / "cells"
    meta = json.loads((E / "cell_meta.json").read_text())
    prof_m = (roots[:, 1] >= -0.124) & (roots[:, 1] < -0.09)
    prof = np.median(radii[prof_m], axis=0).astype(np.float32)

    def full(base_pts, base_roots, base_radii, new_pts, new_roots):
        return (np.concatenate([base_pts, new_pts]),
                np.concatenate([base_roots, new_roots]),
                np.concatenate([base_radii, np.tile(prof, (len(new_roots), 1))]))

    def save(tag, pts, rts, rad):
        np.savez_compressed(cells / f"{tag}_raw.npz", points=pts.astype(np.float32),
                            roots=rts.astype(np.float32), radii=rad,
                            apex_y=apex, cx=cx)
        print(tag, len(pts), flush=True)

    # full-set assemblies of v1 fills (for standalone scoring)
    for tag in ("fill_flat", "fill_long"):
        raw = np.load(cells / f"{tag}_raw.npz")
        np_new, nr_new = len(raw["points"]), len(raw["roots"])
        pts, rts, rad = full(points, roots, radii,
                             np.asarray(raw["points"], dtype=float),
                             np.asarray(raw["roots"], dtype=float))
        assert len(pts) == len(points) + np_new
        save(f"{tag}_full", pts, rts, rad)
        meta[f"{tag}_full"] = {"added": np_new, "newTotal": int(len(pts))}

    # side_fill: flanks only
    rng = np.random.default_rng(11)
    sroots = band_roots_x(scalp, rng, 3000, -0.146, -0.122, 0.025, 0.045)
    sstr = drape(scalp, sroots[:, :2], 0.045, long=False)
    pts, rts, rad = full(points, roots, radii, sstr, sroots)
    save("side_fill", pts, rts, rad)
    meta["side_fill"] = {"added": int(len(sroots)), "lengthMm": 45,
                         "zone": "|x| in [25,45]mm, y in [-146,-122]mm"}

    # edge_fill: behind the band, drape in
    rng = np.random.default_rng(12)
    ys = rng.uniform(-0.124, -0.110, 12000)
    xs = rng.uniform(-0.045, 0.045, 12000)
    keep = np.abs(xs) >= SEAM
    xs, ys = xs[keep], ys[keep]
    _, _, dxy = scalp.query(np.c_[xs, ys])
    inside = dxy < 0.002
    xs, ys = xs[inside][:4000], ys[inside][:4000]
    z, _, _ = scalp.query(np.c_[xs, ys])
    eroots = np.c_[xs, ys, z + 0.0004]
    estr = drape(scalp, eroots[:, :2], 0.030, long=False)
    pts2, rts2, rad2 = full(points, roots, radii, estr, eroots)
    save("edge_fill", pts2, rts2, rad2)
    meta["edge_fill"] = {"added": int(len(eroots)), "lengthMm": 30,
                         "zone": "y in [-124,-110]mm, |x|>=2mm"}

    # combo2: base + side + edge
    c3 = np.concatenate([points, sstr, estr])
    cr3 = np.concatenate([roots, sroots, eroots])
    crad3 = np.concatenate([radii, np.tile(prof, (len(sroots) + len(eroots), 1))])
    save("combo2", c3, cr3, crad3)
    meta["combo2"] = {"added": int(len(sroots) + len(eroots)),
                      "newTotal": int(len(c3)),
                      "note": "base+side_fill+edge_fill; no flatten, no centre fill"}
    (E / "cell_meta.json").write_text(json.dumps(meta, indent=1) + "\n")


if __name__ == "__main__":
    main()
