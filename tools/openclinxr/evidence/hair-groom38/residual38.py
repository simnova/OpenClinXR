#!/usr/bin/env python3
"""groom38 attribution: remaining shell strands (root, guide, blocker).

No fix added (card: attribute and stop). Same shell predicate as
gates34.segments_in_shell (pierce OR midpoint-inside, MT +
+X-parity primitives imported from gates34), mask-retained for
attribution. Body SDF via children.sdf_sampler; shell exits via
ear_collide.ShellCollider.

Blocker labels per remaining shell segment (midpoint m, strand s,
segment j with arc position a):
- near-pin: a < 30 mm from the root (pin = first 20 mm; the chain
  just outside the pin is length-locked);
- anterior-exit: shell exit vector at m points anterior (-y): the
  posterior rule projects these to tangent strides, so the anterior
  wall is never pushed out directly;
- flesh-trapped: body SDF at m < 0.5 mm (exit destinations land in
  flesh clearance -> flesh-halving stalls the push);
- seam: |bodySDF(m)| <= 3 mm AND y(m) > sides[nm] yfront: tucked
  contact at the attachment seam behind the ear (operator decides).

Also: moved-vs-never-moved (byte compare vs groom36 base),
root-proxy distances, dominant-guide backbones + routed frac
(ROUTED36 from residual36; children ride guides-36).
Writes E38/residual-38.json.
"""
from __future__ import annotations

import collections as _c
import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

E = Path(__file__).resolve().parent
E36 = E.parent / "hair-groom36"
sys.path.insert(0, str(E.parents[2] / "openclinxr" / "hair-groom"
                      / "strands"))
sys.path.insert(0, str(E36))
import gates34 as G  # noqa: E402
import residual36 as R36  # noqa: E402
from children import sdf_sampler  # noqa: E402
from ear_collide import ShellCollider  # noqa: E402

STORE = Path("/Volumes/files/openclinxr-assets/store")
S36 = STORE / "hair-groom36/build-36/strands.npz"
S38 = STORE / "hair-groom38/build-38/strands.npz"
PROXY = STORE / "hair-groom34/ear-proxy.npz"
BODY_SDF = (E.parents[2] / "openclinxr" / "evidence"
            / "hair-cage1/body-exact-sdf.npz")


def shell_mask(pts, sv, sf, chunk=40000):
    """gates34.segments_in_shell predicate, mask-retained."""
    pts = np.ascontiguousarray(pts, dtype=np.float64)
    n, Pm, _ = pts.shape
    sv = np.ascontiguousarray(sv, dtype=np.float64)
    sf = np.ascontiguousarray(sf, dtype=np.int64)
    tris = sv[sf]
    tmin = tris.min(axis=1)
    tmax = tris.max(axis=1)
    sbmin = sv.min(axis=0)
    sbmax = sv.max(axis=0)
    hit = np.zeros((n, Pm - 1), dtype=bool)
    for a in range(0, n, chunk):
        sl = slice(a, min(a + chunk, n))
        p0 = pts[sl, :-1, :].reshape(-1, 3)
        p1 = pts[sl, 1:, :].reshape(-1, 3)
        m = p0.shape[0]
        smin = np.minimum(p0, p1)
        smax = np.maximum(p0, p1)
        cand = ((smax[:, 0] >= sbmin[0]) & (smin[:, 0] <= sbmax[0])
                & (smax[:, 1] >= sbmin[1]) & (smin[:, 1] <= sbmax[1])
                & (smax[:, 2] >= sbmin[2]) & (smin[:, 2] <= sbmax[2]))
        ci = np.nonzero(cand)[0]
        if not len(ci):
            continue
        q0, q1 = p0[ci], p1[ci]
        dv = q1 - q0
        pierced = np.zeros(len(ci), dtype=bool)
        for t in range(len(tris)):
            if pierced.all():
                break
            if not ((tmax[t] >= smin[ci].min(axis=0)).all()
                    and (tmin[t] <= smax[ci].max(axis=0)).all()):
                continue
            pierced |= G._mt_intersect(q0, dv, tris[t, 0], tris[t, 1],
                                       tris[t, 2])
        rest = np.nonzero(~pierced)[0]
        if len(rest):
            mid = (q0[rest] + q1[rest]) / 2.0
            dd = np.zeros(len(rest), dtype=np.int32)
            dvx = np.zeros_like(mid)
            dvx[:, 0] = 1.0
            for t in range(len(tris)):
                dd += G._mt_intersect(mid, dvx, tris[t, 0], tris[t, 1],
                                      tris[t, 2]).astype(np.int32)
            pierced[rest] |= (dd % 2) == 1
        full = np.zeros(m, dtype=bool)
        full[ci] = pierced
        hit[sl] = full.reshape(min(chunk, n - a), Pm - 1)
    return hit


def main():
    P = np.load(str(PROXY))
    sides = G.mirrored_sides()
    D38 = np.load(str(S38), allow_pickle=True)
    pts = np.ascontiguousarray(np.asarray(D38["points"], dtype=np.float64))
    n, Pm, _ = pts.shape
    D36 = np.load(str(S36), allow_pickle=True)
    base = np.ascontiguousarray(np.asarray(D36["points"], dtype=np.float64))
    moved = (np.abs(pts - base).max(axis=(1, 2)) > 0)
    proot = np.asarray(D38["roots"], dtype=np.float64)
    gidx = np.asarray(D38["guide_idx"], dtype=np.int64)
    gw = np.asarray(D38["guide_w"], dtype=np.float64)
    dom = gidx[np.arange(n), gw.argmax(axis=1)]
    body_sample, _ = sdf_sampler(np.load(str(BODY_SDF), allow_pickle=True))
    out = {"tag": "38", "strands": str(S38),
           "strandsSha256": G.sha256(str(S38))[:16],
           "nMoved": int(moved.sum()),
           "predicate": "gates34.segments_in_shell (pierce OR "
           "midpoint-inside), mask-retained"}
    for nm, sgn in (("xpos", 1.0), ("xneg", -1.0)):
        sv = np.asarray(P[nm + "_shell_v"], dtype=np.float64)
        sf = np.asarray(P[nm + "_shell_f"])
        hit = shell_mask(pts, sv, sf)
        hs = hit.any(axis=1)
        s = sides[nm]
        si, sj = np.nonzero(hit)
        row = {"shellSegs": int(hit.sum()),
               "shellStrands": int(hs.sum()),
               "shellStrandsMoved": int((hs & moved).sum()),
               "shellStrandsNeverMoved": int((hs & ~moved).sum())}
        if hs.any():
            outer = sv[:len(sv) // 2]
            tree = cKDTree(outer)
            pr = proot[hs]
            dd, _ = tree.query(pr)
            row["rootProxyDistMm"] = {
                "min": round(float(dd.min() * 1000.0), 1),
                "p10": round(float(np.percentile(dd, 10) * 1000.0), 1),
                "p50": round(float(np.median(dd) * 1000.0), 1),
                "p90": round(float(np.percentile(dd, 90) * 1000.0), 1),
                "max": round(float(dd.max() * 1000.0), 1)}
            ddom = dom[hs]
            row["topBackbones"] = [
                {"guide": int(gg), "n": int(nn)}
                for gg, nn in _c.Counter(ddom.tolist()).most_common(8)]
            row["backboneRoutedFrac"] = round(
                float(sum(1 for gg in ddom
                          if R36.ROUTED36.get(int(gg), 0.0) == sgn))
                / max(1, len(ddom)), 4)
            # --- per-segment blocker labels ---
            mid = (pts[si, sj, :] + pts[si, sj + 1, :]) / 2.0
            seglen = np.linalg.norm(np.diff(pts, axis=1), axis=2)
            arc = np.zeros((n, Pm))
            arc[:, 1:] = np.cumsum(seglen, axis=1)
            arcpos = (arc[si, sj] + arc[si, sj + 1]) / 2.0
            near_pin = arcpos < 0.030
            collider = ShellCollider(sv, sf)
            ev, _d = collider.exit_vectors(mid, k=12)
            anterior_exit = ev[:, 1] < 0
            bv, bi = body_sample(mid)
            bv = np.where(bi, bv, np.inf)
            flesh = bv < 0.5
            seam = (np.abs(bv) <= 3.0) & (mid[:, 1] > s["yfront"])
            row["blockers"] = {
                "nearPin30mm": int(near_pin.sum()),
                "anteriorExit": int(anterior_exit.sum()),
                "fleshTrapped05mm": int(flesh.sum()),
                "seam3mm": int(seam.sum()),
                "nSegs": int(len(si))}
            row["blockerStrands"] = {
                "nearPin30mm": int(np.unique(si[near_pin]).size),
                "anteriorExit": int(np.unique(si[anterior_exit]).size),
                "fleshTrapped05mm": int(np.unique(si[flesh]).size),
                "seam3mm": int(np.unique(si[seam]).size)}
            row["entryMidYmM"] = [round(float(np.percentile(
                mid[:, 1], q) * 1000.0), 1) for q in (10, 50, 90)]
        col = G.earlobe_columns(pts, sides)[nm]
        row["column"] = col
        out[nm] = row
        print("== %s segs=%d strands=%d (moved %d / never %d) "
              "blockers=%s col=%d" % (
                  nm, row["shellSegs"], row["shellStrands"],
                  row["shellStrandsMoved"], row["shellStrandsNeverMoved"],
                  row.get("blockers"), col["strands"]), flush=True)
    (E / "residual-38.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE", E / "residual-38.json", flush=True)


if __name__ == "__main__":
    main()
