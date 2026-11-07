"""Shared measurement helpers for hair-orient0 (S10, new code).

Small pure functions COPIED VERBATIM-ish from route2.py / gates.py /
gates1.py / instruments.py lineages (read-only; originals untouched):
resample_1mm, tube_raster4, ear_gate, regional_pq, part_crossings,
turn5_of_curve/turn_stats, occluded_union. Copies (not imports) so the
orient slice is self-contained and runnable even if route code moves;
identical math, same constants (tube 3 mm, ear 3 mm, occlude margin).
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy.spatial import ConvexHull, Delaunay, cKDTree

S10 = Path(__file__).resolve().parent
sys.path.insert(0, str(S10))
import common_o as CO  # noqa: E402

VIEWS4 = CO.VIEWS4
EAR_CLEAR_MM = 3.0
TURN_GATE = 15.0


def resample_1mm(c):
    c = np.asarray(c, dtype=np.float64)
    seg = np.linalg.norm(np.diff(c, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(seg)])
    L = float(arc[-1])
    n = max(int(L) + 1, 2)
    tt = np.linspace(0, L, n)
    out = np.zeros((n, 3))
    j = 0
    for k in range(n):
        while j < len(seg) - 1 and arc[j + 1] < tt[k]:
            j += 1
        f = (0.0 if arc[j + 1] == arc[j]
             else (tt[k] - arc[j]) / (arc[j + 1] - arc[j]))
        out[k] = c[j] * (1 - f) + c[j + 1] * f
    return out


def resample_arc41(pts, m=41):
    pts = np.asarray(pts, dtype=np.float64)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    total = seg.sum()
    if total <= 0:
        return np.repeat(pts[:1], m, axis=0)
    cum = np.concatenate([[0.0], np.cumsum(seg)]) / total
    t = np.linspace(0.0, 1.0, m)
    out = np.zeros((m, 3))
    j = 0
    for k in range(m):
        while j < len(seg) - 1 and cum[j + 1] < t[k]:
            j += 1
        f = 0.0 if cum[j + 1] == cum[j] else (
            (t[k] - cum[j]) / (cum[j + 1] - cum[j]))
        out[k] = pts[j] * (1 - f) + pts[j + 1] * f
    return out


def tube_raster4(curves_mm, inp, tube_r_mm=3.0):
    """(route2.tube_raster4 copy) visible tube cover+depth per view."""
    sensor = inp["sensor"]
    cams = inp["cams"]
    out = {}
    for view in VIEWS4:
        cam = cams["views"][view]
        focal = float(cam["lensMm"]) / float(sensor) * 1024
        cover = np.zeros((1024, 1024), dtype=bool)
        depth = np.full((1024, 1024), np.inf)
        bdepth = np.array(inp["body"][view]["depth"], dtype=np.float64)
        for c in curves_mm:
            pts = np.asarray(c, dtype=np.float64) / 1000.0
            cols, rows, dep = CO.C2.ENV.project_to_render(pts, cam,
                                                          sensor)
            rr = tube_r_mm / 1000.0 * focal / np.maximum(dep, 1e-6)
            for k in range(len(pts)):
                if dep[k] <= 0:
                    continue
                r = float(rr[k])
                if r < 0.5:
                    r = 0.5
                c0, r0 = float(cols[k]), float(rows[k])
                xlo, xhi = max(int(c0 - r), 0), min(int(c0 + r), 1023)
                ylo, yhi = max(int(r0 - r), 0), min(int(r0 + r), 1023)
                if xhi < xlo or yhi < ylo:
                    continue
                yy, xx = np.mgrid[ylo:yhi + 1, xlo:xhi + 1]
                disc = (xx - c0) ** 2 + (yy - r0) ** 2 <= r * r
                if not disc.any():
                    continue
                win_b = bdepth[ylo:yhi + 1, xlo:xhi + 1]
                vis = disc & (dep[k] < win_b - 0.0005)
                if not vis.any():
                    continue
                sub = np.zeros_like(disc, dtype=bool)
                cur = depth[ylo:yhi + 1, xlo:xhi + 1]
                sub[vis] = dep[k] < cur[vis]
                cur[sub] = dep[k]
                depth[ylo:yhi + 1, xlo:xhi + 1] = cur
                cov = cover[ylo:yhi + 1, xlo:xhi + 1]
                cov |= vis
                cover[ylo:yhi + 1, xlo:xhi + 1] = cov
        out[view] = (cover, depth)
    return out


def occluded_union(render_cover, body_maps, transforms, views=VIEWS4,
                   margin_m=0.001):
    """(instruments.occluded_union copy; identity transforms here.)"""
    out = {}
    for view in views:
        cover, depth = render_cover[view]
        _, bdepth = body_maps[view]
        vis = cover & (depth < bdepth - margin_m)
        t = transforms[view]
        s = float(t["scale"])
        rr, cc = np.mgrid[0:1024, 0:1024]
        rs = np.rint((rr - float(t["ty"])) / s).astype(np.int64)
        cs = np.rint((cc - float(t["tx"])) / s).astype(np.int64)
        hit = ((rs >= 0) & (rs < 1024) & (cs >= 0) & (cs < 1024))
        warped = np.zeros((1024, 1024), dtype=bool)
        warped[hit] = vis[rs[hit], cs[hit]]
        out[view] = warped
    return out


def regional_pq(fitted, target):
    """(gates.regional_pq copy) boundary p50/p95 excess+miss."""
    from scipy import ndimage
    bf = fitted ^ ndimage.binary_erosion(fitted)
    bt = target ^ ndimage.binary_erosion(target)
    edt_t = ndimage.distance_transform_edt(~bt)
    edt_f = ndimage.distance_transform_edt(~bf)
    fr, fc = np.nonzero(bf)
    tr, tc = np.nonzero(bt)
    out_f = ~target[fr, fc] if fr.size else np.zeros(0, dtype=bool)
    out_t = ~fitted[tr, tc] if tr.size else np.zeros(0, dtype=bool)
    de = edt_t[fr, fc][out_f] if fr.size else np.zeros(0)
    dm = edt_f[tr, tc][out_t] if tr.size else np.zeros(0)
    q = lambda a, p: round(float(np.percentile(a, p)), 1) \
        if a.size else 0.0  # noqa: E731
    return {"excessN": int(out_f.sum()), "excessP50": q(de, 50),
            "excessP95": q(de, 95),
            "missN": int(out_t.sum()), "missP50": q(dm, 50),
            "missP95": q(dm, 95)}


def part_crossings(roots_x, curves):
    """(gates.part_crossings copy) opposite-side excursions > 2 mm."""
    raw = over = 0
    maxexc = 0.0
    for i, c in enumerate(curves):
        if abs(float(roots_x[i])) < 3.0:
            continue
        s = np.sign(float(roots_x[i]))
        opp = c[:, 0] * s < 0
        if opp.any():
            raw += 1
            exc = float((-c[opp, 0] * s).max())
            maxexc = max(maxexc, exc)
            if exc > 2.0:
                over += 1
    return {"rawFlips": raw, "crossingsOver2mm": over,
            "maxExcursionMm": round(maxexc, 2)}


def turn5_of_curve(c):
    """(gates1.turn5_of_curve copy) angle per 5 mm window."""
    pts = resample_1mm(c)
    T = np.diff(pts, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    if len(T) < 6:
        return np.zeros(0)
    d = (T[5:] * T[:-5]).sum(axis=1).clip(-1, 1)
    return np.degrees(np.arccos(d))


def turn_stats(curves):
    """(gates1.turn_stats copy)."""
    per = np.array([turn5_of_curve(c).max()
                    if turn5_of_curve(c).size else 0.0
                    for c in curves])
    allv = np.concatenate([turn5_of_curve(c) for c in curves
                           if turn5_of_curve(c).size])
    q = lambda a, p: round(float(np.percentile(a, p)), 2) \
        if a.size else 0.0  # noqa: E731
    return {"max": round(float(per.max()), 2),
            "p95": q(allv, 95), "p50": q(allv, 50),
            "fracGuidesOver15": round(float((per > 15).mean()), 4),
            "nGuidesOver15": int((per > 15).sum()),
            "gate": TURN_GATE}


def ear_gate(curves, pinna, inp):
    """(route2.ear_gate copy) 3 mm clearance + view-correct occlusion."""
    res = {}
    cams = inp["cams"]
    sensor = inp["sensor"]
    for side in ("xpos", "xneg"):
        pv = np.asarray(pinna[side], dtype=np.float64)
        t3 = cKDTree(pv)
        dmins = []
        near = []
        for c in curves:
            pts = resample_1mm(c)
            d, _ = t3.query(pts, k=1)
            dmins.append(float(d.min()))
            near.append(bool(float(d.min()) < EAR_CLEAR_MM))
        dmins = np.array(dmins)
        res[side] = {
            "nGuidesNear3mm": int(np.sum(near)),
            "nearIdx": [int(i) for i, v in enumerate(near) if v],
            "minDistMm": round(float(dmins.min()), 2),
            "p50DistMm": round(float(np.percentile(dmins, 50)), 2)}
    pv_all = np.vstack([np.asarray(pinna["xpos"]),
                        np.asarray(pinna["xneg"])]) / 1000.0
    covering = {}
    n_behind = n_cover = 0
    for view in ("front", "three_quarter", "profile_90"):
        cam = cams["views"][view]
        pc, pr, pd = CO.C2.ENV.project_to_render(pv_all, cam, sensor)
        m = ((pd > 0) & (pc >= 0) & (pc < 1024) & (pr >= 0)
             & (pr < 1024))
        pts2 = np.stack([pc[m], pr[m]], axis=1)
        pdep = pd[m]
        tri = Delaunay(pts2[ConvexHull(pts2).vertices])
        t2 = cKDTree(pts2)
        for j, c in enumerate(curves):
            s = resample_1mm(c) / 1000.0
            cc, rr, dd = CO.C2.ENV.project_to_render(s, cam, sensor)
            inside = ((cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
                      & (dd > 0)
                      & (tri.find_simplex(np.stack([cc, rr], axis=1))
                         >= 0))
            if not inside.any():
                continue
            _, ji = t2.query(np.stack([cc[inside], rr[inside]], axis=1),
                             k=1)
            ref = pdep[ji]
            is_cover = dd[inside] < ref - 0.003
            is_behind = dd[inside] > ref + 0.003
            n_cover += int(is_cover.sum())
            n_behind += int(is_behind.sum())
            if is_cover.any():
                covering.setdefault(view, []).append(
                    (j, int(is_cover.sum())))
    cov_guides = sorted(set(j for v in covering.values() for j, _ in v))
    res["occlusion"] = {
        "coveringSamples": n_cover, "behindSamples": n_behind,
        "nGuidesCovering": len(cov_guides), "coveringIdx": cov_guides,
        "perView": {v: covering.get(v, []) for v in
                    ("front", "three_quarter", "profile_90")}}
    res["gate"] = {"clearMm": EAR_CLEAR_MM, "pass": bool(
        res["xpos"]["nGuidesNear3mm"] == 0
        and res["xneg"]["nGuidesNear3mm"] == 0
        and len(cov_guides) == 0)}
    return res


def back_gap_tips(tips_x, roots_y, y_ear_mm):
    """(route2 back_gap adapted to guide tip x) centre gap of back hem."""
    fam_curtain = np.asarray(roots_y) < y_ear_mm
    bx = sorted(float(v) for v, f in zip(tips_x, fam_curtain)
                if not f and abs(float(v)) <= 80.0)
    gaps = [b - a for a, b in zip(bx, bx[1:])] if len(bx) > 1 else []
    return {"n": len(bx),
            "maxGapMm": round(max(gaps), 2) if gaps else 0.0}
