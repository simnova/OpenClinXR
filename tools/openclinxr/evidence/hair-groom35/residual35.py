#!/usr/bin/env python3
"""groom35 residual: WHERE do remaining shell/column strands come from?

Usage: residual35.py STRANDS TAG. Per side: shell-hit strands ->
parent-root distance to the ear proxy, dominant backbone guide ids
(global, from strands guide_idx), routed-or-not (groom30 REROUTE
union), entry midpoints. Same for earlobe-column strands.
Imports gates34 (no copy). Writes E/residual-TAG.json + stdout.
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

E = Path(__file__).resolve().parent
sys.path.insert(0, str(E.parents[2] / "openclinxr" / "hair-groom"
                        / "strands"))
import gates34 as G  # noqa: E402
from interp_children import ROUTED_SIDE  # noqa: E402 (import, no copy)

S34 = Path("/Volumes/files/openclinxr-assets/store/hair-groom34")
P = np.load(str(S34 / "ear-proxy.npz"))


def shell_hits(pts, sv, sf):
    n, Pm, _ = pts.shape
    sv = np.ascontiguousarray(sv)
    sf = np.ascontiguousarray(sf, dtype=np.int64)
    tris = sv[sf]
    tmin, tmax = tris.min(axis=1), tris.max(axis=1)
    sbmin, sbmax = sv.min(axis=0), sv.max(axis=0)
    hit = np.zeros((n, Pm - 1), dtype=bool)
    for a in range(0, n, 40000):
        sl = slice(a, min(a + 40000, n))
        p0 = pts[sl, :-1, :].reshape(-1, 3)
        p1 = pts[sl, 1:, :].reshape(-1, 3)
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
                dd += G._mt_intersect(
                    mid, dvx, tris[t, 0], tris[t, 1],
                    tris[t, 2]).astype(np.int32)
            pierced[rest] |= (dd % 2) == 1
        full = np.zeros(p0.shape[0], dtype=bool)
        full[ci] = pierced
        hit[sl] = full.reshape(min(40000, n - a), Pm - 1)
    return hit


def main():
    spath, tag = sys.argv[1], sys.argv[2]
    D = np.load(spath, allow_pickle=True)
    pts = np.ascontiguousarray(np.asarray(D["points"], dtype=np.float64))
    n, Pm, _ = pts.shape
    proot = np.asarray(D["roots"], dtype=np.float64)
    gidx = np.asarray(D["guide_idx"], dtype=np.int64)
    gw = np.asarray(D["guide_w"], dtype=np.float64)
    dom = gidx[np.arange(n), gw.argmax(axis=1)]
    sides = G.mirrored_sides()
    out = {"tag": tag, "strands": spath,
           "strandsSha256": G.sha256(spath)[:16]}
    for nm, sgn in (("xpos", 1.0), ("xneg", -1.0)):
        sv = np.asarray(P[nm + "_shell_v"], dtype=np.float64)
        sf = np.asarray(P[nm + "_shell_f"])
        hit = shell_hits(pts, sv, sf)
        hs = hit.any(axis=1)
        outer = sv[:len(sv) // 2]
        tree = cKDTree(outer)
        row = {"shellStrands": int(hs.sum()),
               "shellSegs": int(hit.sum())}
        if hs.any():
            pr = proot[hs]
            dd, _ = tree.query(pr)
            row["rootProxyDistMm"] = {
                "min": round(float(dd.min() * 1000.0), 1),
                "p10": round(float(np.percentile(dd, 10) * 1000.0), 1),
                "p50": round(float(np.median(dd) * 1000.0), 1),
                "p90": round(float(np.percentile(dd, 90) * 1000.0), 1),
                "max": round(float(dd.max() * 1000.0), 1)}
            row["rootAbsXMm"] = {
                "p10": round(float(np.percentile(np.abs(pr[:, 0]), 10)
                                   * 1000.0), 1),
                "p50": round(float(np.median(np.abs(pr[:, 0]))
                                    * 1000.0), 1),
                "p90": round(float(np.percentile(np.abs(pr[:, 0]), 90)
                                    * 1000.0), 1)}
            ddom = dom[hs]
            import collections as _c
            top = _c.Counter(ddom.tolist()).most_common(8)
            row["topBackbones"] = [
                {"guide": int(gg),
                 "n": int(nn),
                 "routed": ROUTED_SIDE.get(int(gg), 0.0) == sgn}
                for gg, nn in top]
            row["backboneRoutedFrac"] = round(
                float(sum(1 for gg in ddom
                          if ROUTED_SIDE.get(int(gg), 0.0) == sgn))
                / max(1, len(ddom)), 4)
            si, sj = np.nonzero(hit)
            mid = (pts[si, sj, :] + pts[si, sj + 1, :]) / 2
            row["entryMidYmM"] = [round(float(np.percentile(
                mid[:, 1], q) * 1000.0), 1) for q in (10, 50, 90)]
            row["entryMidZ"] = [round(float(np.percentile(
                mid[:, 2], q)), 4) for q in (10, 50, 90)]
        col = G.earlobe_columns(pts, sides)[nm]
        row["column"] = col
        if col["strands"]:
            flat = pts[:, 1:, :].reshape(-1, 3)
            s = sides[nm]
            sm = ((flat[:, 2] < s["zmin"])
                  & (flat[:, 1] >= s["yback"])
                  & (flat[:, 1] <= s["yfront"])
                  & ((flat[:, 0] * sgn) > 0)
                  & (np.abs(flat[:, 0]) >= s["xmin"] - 0.005)
                  & (np.abs(flat[:, 0]) <= s["xmax"]))
            has = sm.reshape(n, Pm - 1).any(axis=1)
            crow = proot[has]
            dd, _ = tree.query(crow)
            cdom = dom[has]
            import collections as _c2
            row["columnRootProxyDistMmP50"] = round(
                float(np.median(dd) * 1000.0), 1)
            row["columnTopBackbones"] = [
                {"guide": int(gg), "n": int(nn),
                 "routed": ROUTED_SIDE.get(int(gg), 0.0) == sgn}
                for gg, nn in _c2.Counter(cdom.tolist()).most_common(8)]
            row["columnBackboneRoutedFrac"] = round(
                float(sum(1 for gg in cdom
                          if ROUTED_SIDE.get(int(gg), 0.0) == sgn))
                / max(1, len(cdom)), 4)
        out[nm] = row
        print("== %s shell %d/%d col %d routedFrac %s/%s" % (
            nm, row["shellStrands"], row["shellSegs"],
            row["column"]["strands"], row.get("backboneRoutedFrac"),
            row.get("columnBackboneRoutedFrac")), flush=True)
    (E / ("residual-%s.json" % tag)).write_text(
        json.dumps(out, indent=1) + "\n")
    print("WROTE E/residual-%s.json" % tag)


if __name__ == "__main__":
    main()
