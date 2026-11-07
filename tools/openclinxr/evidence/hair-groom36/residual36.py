#!/usr/bin/env python3
"""groom36 residual: WHERE do remaining shell/column strands come from?

Usage: residual36.py STRANDS TAG. Same attribution as residual35
(root distance, guide id, routed or not) but "routed" = STEP1
s14 --ear-shell reroute set (guides-36.npz route array, both sides),
NOT the groom30 ROUTED_SIDE union (old 2707 indexing, invalid here).
Reuses residual35.shell_hits + gates34 (import, no copy).
Writes E/residual-TAG.json + stdout.
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

E = Path(__file__).resolve().parent
E35 = E.parent / "hair-groom35"
sys.path.insert(0, str(E35))
sys.path.insert(0, str(E.parents[2] / "openclinxr" / "hair-groom"
                        / "strands"))
import gates34 as G  # noqa: E402
from residual35 import shell_hits  # noqa: E402 (import, no copy)

S36 = Path("/Volumes/files/openclinxr-assets/store/hair-groom34")
P = np.load(str(S36 / "ear-proxy.npz"))
G36 = np.load("/Volumes/files/openclinxr-assets/store/hair-groom36/"
              "guides-36.npz", allow_pickle=True)
ROUTE = np.asarray(G36["route"], dtype=np.float64)
import frames as F  # noqa: E402
_GW = F.head_to_world(np.asarray(G36["curves_head"], dtype=np.float64),
                       np.asarray(G36["crown"], dtype=np.float64))
GSIDE = np.where(_GW[:, 0, 0] >= 0, 1.0, -1.0)
ROUTED36 = {int(g): float(GSIDE[int(g)])
            for g in np.nonzero(ROUTE > 0.5)[0]}


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
           "strandsSha256": G.sha256(spath)[:16],
           "routedDef": "STEP1 s14 --ear-shell reroute set "
                        "(%d guides)" % len(ROUTED36)}
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
                {"guide": int(gg), "n": int(nn),
                 "routed": ROUTED36.get(int(gg), 0.0) == sgn}
                for gg, nn in top]
            row["backboneRoutedFrac"] = round(
                float(sum(1 for gg in ddom
                          if ROUTED36.get(int(gg), 0.0) == sgn))
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
                 "routed": ROUTED36.get(int(gg), 0.0) == sgn}
                for gg, nn in _c2.Counter(cdom.tolist()).most_common(8)]
            row["columnBackboneRoutedFrac"] = round(
                float(sum(1 for gg in cdom
                          if ROUTED36.get(int(gg), 0.0) == sgn))
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
