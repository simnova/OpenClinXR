#!/usr/bin/env python3
"""Tearline G2/G3-byte measurement from GLB bytes (read-only).

G2 (margin coverage): fraction of the lower lid-margin loop arc length
(body eye-opening boundary, the anatomical truth) within D mm of the
tearline mesh + the longest uncovered gap along the loop.
G3 (blink closure 1.0): pose body with eye-*-closure = 1.0 and the
tearline with its own closure morph (static if the prim carries no
targets, as in pre-transfer bakes); a tearline vert counts as OUTSIDE
when it is visible (no closed-body surface within 4 mm in front along
+z, Moller-Trumbore over eye-window tris) AND > 1 mm below the closed
lower seam at the same x.

Usage: measure_tearline.py <glb> [--D 0.003]
Prints JSON to stdout.
"""
import json
import struct
import sys

import numpy as np

sys.path.insert(0, __import__("pathlib").Path(__file__).resolve().parent.as_posix())
from probe_tearline import load_glb, make_reader  # noqa: E402


def hole_loop(BV, BF, cx):
    ec = {}
    for a, b, c in BF:
        for u, v in ((a, b), (b, c), (c, a)):
            k = (u, v) if u < v else (v, u)
            ec[k] = ec.get(k, 0) + 1
    pts = np.array([BV[u] for (u, v), n in ec.items() if n == 1
                    for _ in (0,) if abs(BV[u][0] - cx) < 0.025
                    and abs(BV[u][1] - 1.546) < 0.03 and abs(BV[u][2] - 0.133) < 0.05])
    o = pts[np.argsort(pts[:, 0])]
    xs = np.arange(o[:, 0].min(), o[:, 0].max(), 0.001)
    loop = np.array([o[np.argmin(np.abs(o[:, 0] - x))] for x in xs])
    return loop[loop[:, 1] < loop[:, 1].mean()]


def ray_hits_front(orig, tris, max_t=0.004):
    """For each origin, True if any tri is hit within (0, max_t] along +z."""
    d = np.array([0.0, 0.0, 1.0])
    e1 = tris[:, 1] - tris[:, 0]
    e2 = tris[:, 2] - tris[:, 0]
    pvec = np.cross(d, e2)
    det = np.einsum("ij,ij->i", e1, pvec)
    ok = np.abs(det) > 1e-14
    inv = np.zeros_like(det)
    inv[ok] = 1.0 / det[ok]
    hits = np.zeros(len(orig), bool)
    for s in range(0, len(orig), 32):
        O = orig[s:s + 32]
        tvec = O[:, None, :] - tris[None, :, 0]
        u = (tvec * pvec[None, :, :]).sum(axis=2) * inv[None, :]
        q = np.cross(tvec, e1[None, :, :])
        v = (q @ d) * inv[None, :]
        t = np.einsum("sij,ij->si", q, e2) * inv[None, :]
        good = ok[None, :] & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-9) & (t <= max_t)
        hits[s:s + 32] = good.any(axis=1)
    return hits


def main():
    path, D = sys.argv[1], 0.003
    for a in sys.argv[2:]:
        if a.startswith("--D="):
            D = float(a[4:])
    g, blob = load_glb(path)
    acc = make_reader(g, blob)
    tear = next(m for m in g["meshes"] if "tearline" in m["name"])
    tp = tear["primitives"][0]
    TV = np.array(acc(tp["attributes"]["POSITION"]), dtype=float)
    TI = np.array(acc(tp["indices"]).ravel(), dtype=int).reshape(-1, 3)
    tnames = (tear.get("extras", {}) or {}).get("targetNames", [])
    body = next(m for m in g["meshes"] if "body" in m["name"].lower())
    bnames = (body.get("extras", {}) or {}).get("targetNames", [])
    BVs, BF, BDs, off = [], [], {}, 0
    for p in body["primitives"]:
        V = np.array(acc(p["attributes"]["POSITION"]), dtype=float)
        I = np.array(acc(p["indices"]).ravel(), dtype=int).reshape(-1, 3) + off
        off += len(V)
        BVs.append(V)
        BF.append(I)
    BV = np.vstack(BVs)
    BF = np.vstack(BF)
    out = {"glb": path, "tearVerts": len(TV), "tearTris": len(TI),
           "tearTargets": len(tp.get("targets", []) or []), "g2": {}, "g3": {}}
    P = TV[TI]
    e = np.stack([np.linalg.norm(P[:, 1] - P[:, 0], axis=1),
                  np.linalg.norm(P[:, 2] - P[:, 1], axis=1),
                  np.linalg.norm(P[:, 0] - P[:, 2], axis=1)], axis=1)
    mxe = e.max(axis=1)
    areas = np.linalg.norm(np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]), axis=1) / 2.0
    out["film"] = {
        "maxEdgeP50Mm": round(float(np.median(mxe) * 1000), 2),
        "maxEdgeP90Mm": round(float(np.quantile(mxe, 0.9) * 1000), 2),
        "maxEdgeMaxMm": round(float(mxe.max() * 1000), 2),
        "minAreaM2": float(areas.min()),
        "degenerateTris": int((areas < 1e-12).sum()),
    }
    for side, cx, sgn in (("L", -0.0308, -1), ("R", 0.0308, 1)):
        lo = hole_loop(BV, BF, cx)
        T = TV[(TV[:, 0] * cx) > 0]
        d = np.linalg.norm(lo[:, None, :] - T[None, :, :], axis=2).min(axis=1)
        seg = np.linalg.norm(np.diff(lo, axis=0), axis=1)
        tot = float(seg.sum())
        covered = d[:-1] < D
        # longest uncovered run along the loop (gap), in mm
        runs, cur, best = [], 0.0, 0.0
        for i, c in enumerate(covered):
            if not c:
                cur += float(seg[i])
                best = max(best, cur)
            else:
                cur = 0.0
        out["g2"][side] = {
            "loopLenMm": round(tot * 1000, 1),
            "recallPct": round(float(seg[covered].sum() / tot * 100), 1),
            "maxGapMm": round(best * 1000, 1),
        }
        # G3: closure 1.0
        bkey = f"eye-{'left' if side == 'L' else 'right'}-closure"
        closed = BV.copy()
        Dall = np.zeros_like(BV)
        if bkey in bnames:
            ki = bnames.index(bkey)
            o2 = 0
            for p in body["primitives"]:
                n = acc(p["attributes"]["POSITION"]).shape[0]
                tg = p.get("targets", [])
                if len(tg) > ki and "POSITION" in tg[ki]:
                    dd = np.array(acc(tg[ki]["POSITION"]), dtype=float)
                    closed[o2:o2 + n] += dd
                    Dall[o2:o2 + n] = dd
                o2 += n
        # seam: lower-loop + closure delta of nearest closed vert
        d2 = np.linalg.norm(lo[:, None, :] - closed[None, :, :], axis=2)
        nn = d2.argmin(axis=1)
        seam = closed[nn]
        # pose tearline with its own closure morph (static if none)
        TVc = T.copy()
        if bkey in tnames:
            ki = tnames.index(bkey)
            tg = tp.get("targets", [])
            if len(tg) > ki and "POSITION" in tg[ki]:
                dall = np.array(acc(tg[ki]["POSITION"]), dtype=float)
                TVc += dall[(TV[:, 0] * cx) > 0]
        # window tris (closed), near the eye
        wsel = (np.abs(BV[:, 0] - cx) < 0.03) & (np.abs(BV[:, 1] - 1.546) < 0.025)
        wset = set(np.where(wsel)[0].tolist())
        wtris = np.array([t for t in BF if all(int(v) in wset for v in t)])
        wpos = closed[wtris]
        vis = ray_hits_front(TVc, wpos) if len(wtris) else np.zeros(len(TVc), bool)
        order = np.argsort(seam[:, 0])
        sx, sy = seam[order][:, 0], seam[order][:, 1]
        seamy = np.interp(np.clip(TVc[:, 0], sx[0], sx[-1]), sx, sy)
        below = seamy - TVc[:, 1]
        outside = (~vis) & (below > 0.001)
        # Lid mobility at each tearline vert = closure-delta magnitude of the
        # nearest closed body vert. Canthus hinges (mobility 0) render
        # identically open vs closed, so only mobile-zone outsiders can peek
        # at blink; hinge residuals are covered by the open-render band scan.
        mobd = np.linalg.norm(TVc[:, None, :] - closed[None, :, :], axis=2)
        mob = np.linalg.norm(Dall[mobd.argmin(axis=1)], axis=1)
        out["g3"][side] = {
            "tearVerts": int(len(TVc)),
            "visibleVerts": int((~vis).sum()),
            "outsideVerts": int(outside.sum()),
            "mobileOutsideVerts": int((outside & (mob > 0.0005)).sum()),
            "maxBelowMm": round(float(below.max() * 1000), 2),
        }
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
