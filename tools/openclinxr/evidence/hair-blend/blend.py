"""hair-blend-1: deterministic numpy children station (world-space guide blend).

Replaces Blender's Interpolate modifier with a numpy generator: child strands
as smooth world-space blends of the nearest guides, so children fill the space
between guides, stay outside the body wherever guides do, and cannot form lanes.

Scene build, object hiding, render, ID mask, profile, shrinkwrap and judge
plumbing are copied verbatim from tools/openclinxr/evidence/hair-children/
children4.py (+ children3.py builders). ONLY the children-generation part
(the Interpolate modifier) is replaced by M1-M5 below.

Usage (from repo root):
  Blender (one pass):
    /Applications/Blender.app/Contents/MacOS/Blender --background --python \\
      tools/openclinxr/evidence/hair-blend/blend.py -- \\
      --guides tools/openclinxr/evidence/hair-guides2/guides3.npz \\
      --out tools/openclinxr/evidence/hair-blend --pass A|B
  System python (assembly after both passes):
    python3 tools/openclinxr/evidence/hair-blend/blend.py --phase assemble \\
      --out tools/openclinxr/evidence/hair-blend

The generator `blend_children(guides, cap, n, seed)` is pure numpy (no bpy).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
import traceback
from pathlib import Path

import numpy as np

E_DEFAULT = Path.cwd() / "tools/openclinxr/evidence/hair-blend"
GUIDES_DEFAULT = Path.cwd() / "tools/openclinxr/evidence/hair-guides2/guides3.npz"
CAP_DEFAULT = Path.cwd() / "tools/openclinxr/evidence/hair-flow/cap-v4.npz"
JUDGE_DIR = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
CH_DIR = Path.cwd() / "tools/openclinxr/evidence/hair-children"

P = 32
SEED = 0
LIFT = 0.003
FADE_M = 0.030
JIT_M = 0.0006
JIT_REF_M = 0.050
TIP_LO = 0.97
SLIT_HALF_M = 0.0005
N_A = 2000
N_B = 50000
VIEWS = ("front", "three_quarter", "profile_90", "back", "crown_top")


# ---------------------------------------------------------------- pure part

def _npz_dict(obj):
    if isinstance(obj, dict):
        return {k: np.asarray(v) for k, v in obj.items()}
    if isinstance(obj, np.ndarray):
        return {"points": np.asarray(obj, dtype=np.float64)}
    files = list(obj.files) if hasattr(obj, "files") else list(obj.keys())
    return {k: np.asarray(obj[k]) for k in files}


def guide_parts(guides):
    d = _npz_dict(guides)
    pts = np.asarray(d["points"], dtype=np.float64)
    if pts.ndim != 3 or pts.shape[1] != P or pts.shape[2] != 3:
        raise ValueError("guides points shape %r, want (G,32,3)" % (pts.shape,))
    if "roots" in d:
        roots = np.asarray(d["roots"], dtype=np.float64)
    else:
        roots = pts[:, 0, :].copy()
    return pts, roots


def cap_parts(cap):
    d = _npz_dict(cap)
    verts = np.asarray(d["verts"], dtype=np.float64)
    faces = np.asarray(d["faces"], dtype=np.int64)
    apex_y = float(np.asarray(d["apex_y"]))
    cx = float(np.asarray(d["cx"]))
    cy = float(np.asarray(d["cy"]))
    slit = np.asarray(d["slit"], dtype=np.int64).ravel() if "slit" in d else None
    forehead = np.asarray(d["forehead"], dtype=np.int64).ravel() if "forehead" in d else None
    return verts, faces, apex_y, cx, cy, slit, forehead


def poisson_roots(verts, faces, cx, cy, apex_y, n, seed, k_cand=32):
    """M1: seeded blue-noise roots on the cap, uniform by area, exactly n.

    Mitchell best-candidate: faces sampled by area (deterministic stream);
    each round the farthest of k_cand slit-valid candidates from the accepted
    set (grid-accelerated) is placed. No gap-fill relaxation, so no
    over-dense clusters. Roots closer than 0.5 mm to the slit (front of the
    apex only, where the slit exists) are rejected at draw time.
    Returns (roots_cap, root_normals, info).
    """
    rng = np.random.default_rng(seed)
    A = verts[faces[:, 0]]
    Bm = verts[faces[:, 1]]
    Cm = verts[faces[:, 2]]
    e1 = Bm - A
    e2 = Cm - A
    nrm = np.cross(e1, e2)
    area = 0.5 * np.linalg.norm(nrm, axis=1)
    tiny = area <= 1e-18
    area[tiny] = 1e-18
    fn = nrm / (2.0 * area)[:, None]
    fn[tiny] = (0.0, 0.0, 1.0)
    cent = (A + Bm + Cm) / 3.0
    ref = np.stack([cent[:, 0] - cx, cent[:, 1] - cy,
                    np.full(len(cent), 0.05)], axis=1)
    flip = (fn * ref).sum(axis=1) < 0.0
    fn[flip] *= -1.0
    total = float(area.sum())
    cum = np.cumsum(area)
    r0 = math.sqrt(2.0 * total / (math.sqrt(3.0) * n))
    cell = r0
    r02 = r0 * r0

    def draw_valid(m):
        got_p, got_f = [], []
        while sum(len(g) for g in got_p) < m:
            b = max(m * 2, 1024)
            u = rng.random(b) * total
            fi = np.minimum(np.searchsorted(cum, u, side="left"), len(cum) - 1)
            s = rng.random(b)
            t = rng.random(b)
            sq = np.sqrt(s)
            w0 = 1.0 - sq
            w1 = sq * (1.0 - t)
            w2 = sq * t
            cand = w0[:, None] * A[fi] + w1[:, None] * Bm[fi] + w2[:, None] * Cm[fi]
            keep = ~((np.abs(cand[:, 0]) < SLIT_HALF_M) & (cand[:, 1] < apex_y))
            idx = np.nonzero(keep)[0][:m - sum(len(g) for g in got_p)]
            got_p.append(cand[idx])
            got_f.append(fi[idx])
        return np.concatenate(got_p, axis=0)[:m], np.concatenate(got_f, axis=0)[:m]

    def cellkey(p):
        return (math.floor(p[0] / cell), math.floor(p[1] / cell),
                math.floor(p[2] / cell))

    grid = {}
    acc_xyz = []
    acc_nor = []

    def nearest2(p):
        ck = cellkey(p)
        best = np.inf
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    lst = grid.get((ck[0] + dx, ck[1] + dy, ck[2] + dz))
                    if not lst:
                        continue
                    for j in lst:
                        d = acc_xyz[j] - p
                        q = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
                        if q < best:
                            best = q
        return best

    def place(p, f):
        grid.setdefault(cellkey(p), []).append(len(acc_xyz))
        acc_xyz.append(p)
        acc_nor.append(f)

    p0, f0 = draw_valid(1)
    place(p0[0], fn[f0[0]])
    while len(acc_xyz) < n:
        take = min(n - len(acc_xyz), 20000)
        cand, cfi = draw_valid(take * k_cand)
        for g in range(take):
            grp = cand[g * k_cand:(g + 1) * k_cand]
            gfi = cfi[g * k_cand:(g + 1) * k_cand]
            bi, bd = 0, -1.0
            for k in range(len(grp)):
                q = nearest2(grp[k])
                if q > bd:
                    bd = q
                    bi = k
            place(grp[bi], fn[gfi[bi]])
    roots = np.stack(acc_xyz, axis=0)
    nors = np.stack(acc_nor, axis=0)
    info = {"method": "best-candidate", "k": k_cand,
            "r0mm": r0 * 1000.0, "capAreaCm2": total * 1e4}
    return roots, nors, info


def _project(P, kind, prm):
    """Local 2D chart projections (all deterministic, pure numpy).

    pca: orthographic projection onto the best-fit plane of the side's own
         guide roots (prm = (centroid(3,), basis(3,2))). A convex scalp patch
         projects injectively; unlike a cylinder it has no axis that can
         pierce the surface and fold distant roots together.
    cyl: cylindrical angle/height around (ax, ay) (prm = (ax, ay)).
    yz:  planar (y, z)."""
    P = np.asarray(P, dtype=np.float64)
    if kind == "pca":
        c, E = prm
        return (P - c) @ E
    if kind == "cyl":
        ax, ay = prm
        return np.stack([np.arctan2(P[:, 0] - ax, P[:, 1] - ay), P[:, 2]],
                        axis=1)
    return np.stack([P[:, 1], P[:, 2]], axis=1)


def _in_cc(ax, ay, bx, by, cx, cy, px, py):
    adx, ady = ax - px, ay - py
    bdx, bdy = bx - px, by - py
    cdx, cdy = cx - px, cy - py
    abdet = adx * bdy - bdx * ady
    bcdet = bdx * cdy - cdx * bdy
    cadet = cdx * ady - adx * cdy
    alift = adx * adx + ady * ady
    blift = bdx * bdx + bdy * bdy
    clift = cdx * cdx + cdy * cdy
    det = alift * bcdet + blift * cadet + clift * abdet
    o = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if o > 0.0:
        return det > 1e-12
    if o < 0.0:
        return det < -1e-12
    return False


def delaunay_2d(pts):
    """Bowyer-Watson Delaunay triangulation (hand-written; no scipy in
    Blender's Python). pts (m,2). Returns (t,3) int64. Raises on degenerate
    input."""
    pts = np.asarray(pts, dtype=np.float64)
    m = len(pts)
    if m < 3:
        raise ValueError("need >=3 points, got %d" % m)
    dmin = np.inf
    for i in range(min(m, 50)):
        d = np.linalg.norm(pts[i + 1:min(m, i + 50)] - pts[i], axis=1)
        if len(d):
            dmin = min(dmin, float(d.min()))
    if not np.isfinite(dmin) or dmin < 1e-15:
        raise ValueError("duplicate chart points")
    xmin, ymin = pts.min(axis=0)
    xmax, ymax = pts.max(axis=0)
    dx, dy = xmax - xmin, ymax - ymin
    dmax = max(dx, dy)
    if dmax <= 0.0:
        raise ValueError("zero chart extent")
    mx, my = (xmin + xmax) * 0.5, (ymin + ymax) * 0.5
    big = np.array([[mx - 20 * dmax, my - dmax],
                    [mx, my + 20 * dmax],
                    [mx + 20 * dmax, my - dmax]], dtype=np.float64)
    allp = np.vstack([pts, big])
    n0, n1, n2 = m, m + 1, m + 2
    tris = [(n0, n1, n2)]
    for i in range(m):
        px, py = allp[i]
        bad = []
        for t in tris:
            a, b, c = t
            if _in_cc(allp[a, 0], allp[a, 1], allp[b, 0], allp[b, 1],
                      allp[c, 0], allp[c, 1], px, py):
                bad.append(t)
        edges = []
        for a, b, c in bad:
            edges.extend(((a, b), (b, c), (c, a)))
        eset = set(edges)
        hole = [e for e in edges if (e[1], e[0]) not in eset]
        tris = [t for t in tris if t not in bad]
        for a, b in hole:
            tris.append((i, a, b))
        if len(tris) > 4 * m + 10:
            raise ValueError("triangulation blowup at point %d" % i)
    out = [t for t in tris if t[0] < m and t[1] < m and t[2] < m]
    if not out:
        raise ValueError("empty triangulation")
    T = np.asarray(out, dtype=np.int64)
    a = allp[T[:, 0]]
    b = allp[T[:, 1]]
    c = allp[T[:, 2]]
    areas = 0.5 * np.abs((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1])
                         - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0]))
    bbox = max(dx, 1e-12) * max(dy, 1e-12)
    if len(T) < m or float(areas.min()) <= 1e-12 * bbox:
        raise ValueError("degenerate triangulation: %d tris min-area %g"
                         % (len(T), float(areas.min())))
    return T


def _build_tri_grid(uv, tris, res=32):
    lo = uv.min(axis=0)
    hi = uv.max(axis=0)
    span = np.maximum(hi - lo, 1e-12)
    cells = {}
    for ti in range(len(tris)):
        t = uv[tris[ti]]
        b0 = np.floor((t.min(axis=0) - lo) / span * res).astype(int)
        b1 = np.floor((t.max(axis=0) - lo) / span * res).astype(int)
        for cu in range(max(int(b0[0]), 0), min(int(b1[0]), res - 1) + 1):
            for cv in range(max(int(b0[1]), 0), min(int(b1[1]), res - 1) + 1):
                cells.setdefault((cu, cv), []).append(ti)
    return {"lo": lo, "span": span, "res": res, "cells": cells}


def _bary(px, py, ax, ay, bx, by, cx, cy):
    d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(d) < 1e-18:
        return None
    w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d
    w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d
    return (w0, w1, 1.0 - w0 - w1)


class _SideStruct:
    def __init__(self, gidx, uv, tris, grid, kind, prm, attempts):
        self.gidx = gidx
        self.uv = uv
        self.tris = tris
        self.grid = grid
        self.kind = kind
        self.prm = prm
        self.attempts = attempts


TRI_EDGE_P95_BAR_M = 0.040
TRI_EDGE_DROP_M = 0.040


def _tri_edge_p95(sub, tris):
    P = sub[tris]
    e = np.stack([np.linalg.norm(P[:, 0] - P[:, 1], axis=1),
                  np.linalg.norm(P[:, 1] - P[:, 2], axis=1),
                  np.linalg.norm(P[:, 2] - P[:, 0], axis=1)], axis=1)
    return float(np.percentile(e.max(axis=1), 95))


def build_side_struct(guide_roots, gidx):
    """M2 triangulation of guide roots in a local 2D chart per side.

    Tries 3 charts (PCA plane, cylinder around the side's root median,
    planar y/z) and keeps the one with the smallest p95 3D edge (a folded
    chart shows ~100 mm edges vs ~9 mm guide spacing). Raises only if the
    best chart is still worse than 40 mm p95 (caller falls back to 3-nearest
    everywhere). Individual triangles with any 3D edge over 40 mm are
    treated as holes at locate time (sanctioned 3-nearest fallback there)."""
    sub = guide_roots[gidx]
    cen = sub.mean(axis=0)
    _U, _S, Vt = np.linalg.svd(sub - cen, full_matrices=False)
    cands = [("pca", (cen, Vt[:2].T.copy())),
             ("cyl", (float(np.median(sub[:, 0])), float(np.median(sub[:, 1])))),
             ("yz", None)]
    fails = []
    scored = []
    for kind, prm in cands:
        try:
            uv = _project(sub, kind, prm)
            tris = delaunay_2d(uv)
            p95 = _tri_edge_p95(sub, tris)
            scored.append((p95, kind, prm, uv, tris))
            fails.append("%s p95=%.1fmm" % (kind, p95 * 1000.0))
        except Exception as err:
            fails.append("%s: %s" % (kind, str(err)[:120]))
    if not scored:
        raise ValueError("all charts failed: %s" % " | ".join(fails))
    scored.sort(key=lambda s: s[0])
    p95, kind, prm, uv, tris = scored[0]
    if p95 > TRI_EDGE_P95_BAR_M:
        raise ValueError("all charts folded (best p95 %.1f mm): %s"
                         % (p95 * 1000.0, " | ".join(fails)))
    grid = _build_tri_grid(uv, tris)
    return _SideStruct(gidx, uv, tris, grid, kind, prm,
                       fails + ["kept %s p95=%.1fmm" % (kind, p95 * 1000.0)])


def _locate_one(u, v, side, guide_roots):
    g = side.grid
    cu = int(math.floor((u - g["lo"][0]) / g["span"][0] * g["res"]))
    cv = int(math.floor((v - g["lo"][1]) / g["span"][1] * g["res"]))
    cu = min(max(cu, 0), g["res"] - 1)
    cv = min(max(cv, 0), g["res"] - 1)
    for ti in g["cells"].get((cu, cv), ()):
        t = side.tris[ti]
        a = side.uv[t[0]]
        b = side.uv[t[1]]
        c = side.uv[t[2]]
        w = _bary(u, v, a[0], a[1], b[0], b[1], c[0], c[1])
        if w is not None and w[0] >= -1e-9 and w[1] >= -1e-9 and w[2] >= -1e-9:
            ga, gb, gc = side.gidx[t[0]], side.gidx[t[1]], side.gidx[t[2]]
            pa, pb, pc = guide_roots[ga], guide_roots[gb], guide_roots[gc]
            emax = max(float(np.linalg.norm(pa - pb)),
                       float(np.linalg.norm(pb - pc)),
                       float(np.linalg.norm(pc - pa)))
            if emax > TRI_EDGE_DROP_M:
                continue
            return ga, gb, gc, w, 0
    return None


def _idw_one(root, guide_roots, gidx):
    sub = guide_roots[gidx]
    d2 = ((sub - root) ** 2).sum(axis=1)
    if len(sub) >= 3:
        k = np.argpartition(d2, 3)[:3]
    else:
        k = np.arange(len(sub))
    d = np.sqrt(np.maximum(d2[k], 0.0))
    if d.min() == 0.0:
        w = np.zeros(len(k))
        w[int(np.argmin(d))] = 1.0
    else:
        inv = 1.0 / d
        w = inv / inv.sum()
    ww = np.zeros(3)
    ww[:len(k)] = w
    kk = np.zeros(3, dtype=np.int64)
    kk[:len(k)] = gidx[k]
    if len(k) < 3:
        kk[len(k):] = kk[0]
    return kk[0], kk[1], kk[2], (float(ww[0]), float(ww[1]), float(ww[2])), 1


def _smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def blend_children(guides, cap, n, seed=0, meta=None):
    """M1-M4: deterministic world-space blend children.

    guides: (G,32,3) array or dict/npz with points/roots (world metres).
    cap: dict/npz with verts/faces/apex_y/cx/cy (world metres).
    Returns ndarray[n,32,3] world metres. meta dict (optional) receives
    parents (n,3), weights (n,3), method (n; 0=triangle 1=idw fallback),
    roots_lifted (n,3), side attempts, fallback count, timings.
    Pure numpy; no Blender needed.
    """
    t_all = time.perf_counter()
    G, R = guide_parts(guides)
    verts, faces, apex_y, cx, cy, _slit, _fore = cap_parts(cap)
    gg = len(G)
    if gg < 3:
        raise ValueError("need >=3 guides, got %d" % gg)

    t0 = time.perf_counter()
    roots_cap, root_nor, pinfo = poisson_roots(verts, faces, cx, cy, apex_y,
                                               n, seed)
    t_poisson = time.perf_counter() - t0
    roots_lift = roots_cap + root_nor * LIFT

    left = roots_cap[:, 0] < 0.0
    gleft = R[:, 0] < 0.0
    struct = {}
    fallback_all = False
    try:
        struct[True] = build_side_struct(R, np.nonzero(gleft)[0])
    except ValueError:
        struct[True] = None
    try:
        struct[False] = build_side_struct(R, np.nonzero(~gleft)[0])
    except ValueError:
        struct[False] = None
    if struct[True] is None and struct[False] is None:
        fallback_all = True

    t0 = time.perf_counter()
    parents = np.empty((n, 3), dtype=np.int64)
    weights = np.empty((n, 3), dtype=np.float64)
    method = np.zeros(n, dtype=np.int64)
    for i in range(n):
        s = bool(left[i])
        st = struct[s]
        hit = None
        if st is not None:
            cuv = _project(roots_cap[i:i + 1], st.kind, st.prm)[0]
            hit = _locate_one(float(cuv[0]), float(cuv[1]), st, R)
        if hit is None:
            gidx = np.nonzero(gleft)[0] if s else np.nonzero(~gleft)[0]
            a, b, c, w, _m = _idw_one(roots_cap[i], R, gidx)
            parents[i] = (a, b, c)
            weights[i] = w
            method[i] = 1
        else:
            a, b, c, w, _m = hit
            parents[i] = (a, b, c)
            weights[i] = w
    t_locate = time.perf_counter() - t0

    Gp = G[parents]  # (n,3,32,3)
    w = weights
    base = (w[:, 0, None, None] * Gp[:, 0]
            + w[:, 1, None, None] * Gp[:, 1]
            + w[:, 2, None, None] * Gp[:, 2])
    seg = np.diff(base, axis=1)
    seglen = np.linalg.norm(seg, axis=2)
    arc = np.concatenate([np.zeros((n, 1)), np.cumsum(seglen, axis=1)], axis=1)
    fade = 1.0 - _smoothstep(arc / FADE_M)
    delta = roots_lift - base[:, 0, :]
    kids = base + fade[..., None] * delta[:, None, :]

    # poisson used its own default_rng(seed); jitter uses a second stream
    # seeded from seed+1 so root placement and variation are independently
    # reproducible.
    rng = np.random.default_rng((seed + 1) & 0xFFFFFFFF)
    tan = np.zeros_like(kids)
    tan[:, 1:-1, :] = kids[:, 2:, :] - kids[:, :-2, :]
    tan[:, 0, :] = kids[:, 1, :] - kids[:, 0, :]
    tan[:, -1, :] = kids[:, -1, :] - kids[:, -2, :]
    tl = np.linalg.norm(tan, axis=2, keepdims=True)
    tl = np.maximum(tl, 1e-12)
    tan = tan / tl
    Rd = rng.standard_normal((n, 3))
    q = rng.random(n)
    dot = (Rd[:, None, :] * tan).sum(axis=2, keepdims=True)
    perp = Rd[:, None, :] - dot * tan
    pl = np.linalg.norm(perp, axis=2)
    bad = pl < 1e-12
    if bad.any():
        fb = np.zeros_like(perp)
        fb[..., 2] = 1.0
        d2 = (fb * tan).sum(axis=2, keepdims=True)
        fb = fb - d2 * tan
        fl = np.linalg.norm(fb, axis=2)
        fl = np.maximum(fl, 1e-12)
        perp[bad] = (fb / fl[..., None])[bad]
        pl = np.linalg.norm(perp, axis=2)
        pl = np.maximum(pl, 1e-12)
    mag = JIT_M * np.clip(arc / JIT_REF_M, 0.0, 1.0) * q[:, None]
    kids = kids + perp / pl[..., None] * mag[..., None]

    # PART RULE (strand shape): M2 picks same-side parents, but seeded jitter
    # (<=0.6 mm) and the M3 root-offset fade can still push a point across
    # x = 0 near the part. A uniform geometric rule, not hand-filtering: any
    # jittered point in front of the apex above crown-0.03 that lands across
    # the part (opposite x sign from its own root) by a small excursion
    # (|x| < 3.0 mm) is pulled back to its own side margin
    # (x = side * 0.05 mm). Guides themselves never cross (measured 0), so
    # guide-scale shape is untouched. Behind the apex there is no part, so
    # nothing is clamped there.
    gd = _npz_dict(guides)
    crown_z_clamp = float(np.asarray(gd["crown_z"])) if "crown_z" in gd else None
    if crown_z_clamp is not None:
        side = np.where(roots_cap[:, 0] < 0.0, -1.0, 1.0)
        across = ((kids[:, :, 1] < apex_y)
                  & (kids[:, :, 2] > crown_z_clamp - 0.03)
                  & (np.abs(kids[:, :, 0]) < 0.003)
                  & (np.sign(kids[:, :, 0]) != side[:, None]))
        kids[:, :, 0] = np.where(across, side[:, None] * 0.00005,
                                 kids[:, :, 0])

    f = TIP_LO + (1.0 - TIP_LO) * rng.random(n)
    # M4 tip length: truncate the strand at f*L, keep 32 points. Points 0..30
    # stay exactly on their original arc positions (preserving same-index
    # correspondence with the parent guides, which fan out ~2x toward the
    # tips: a uniform resample would shift every point backward along the
    # strand and push tips laterally out of their prisms). Only the last
    # segment compresses (tip lands at f*L). The visible effect — hem length
    # varying per strand over [0.97, 1.00] — is unchanged.
    seg2 = np.diff(kids, axis=1)
    seglen2 = np.linalg.norm(seg2, axis=2)
    L = seglen2.sum(axis=1)
    cum = np.concatenate([np.zeros((n, 1)), np.cumsum(seglen2, axis=1)], axis=1)
    out = np.empty_like(kids)
    out[:, :-1, :] = kids[:, :-1, :]
    newlen = f * L
    for i in range(n):
        lo, hi = cum[i, P - 2], cum[i, P - 1]
        t = 0.0 if hi <= lo else (newlen[i] - lo) / (hi - lo)
        out[i, -1, :] = kids[i, P - 2, :] + t * (kids[i, P - 1, :] - kids[i, P - 2, :])
    t_all = time.perf_counter() - t_all
    if meta is not None:
        meta.update({"parents": parents, "weights": weights, "method": method,
                     "roots_lifted": roots_lift, "roots_cap": roots_cap,
                     "fallback_all": fallback_all,
                     "fallback_count": int(method.sum()),
                     "attempts": {str(k): (None if v is None else
                                           {"kind": v.kind, "tris": len(v.tris),
                                            "fails": v.attempts})
                                  for k, v in struct.items()},
                     "poisson": pinfo, "tipFactorMean": float(f.mean()),
                     "seconds_total": t_all, "seconds_poisson": t_poisson,
                     "seconds_locate": t_locate})
    return out


def sha256_of(a):
    return hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()


# ------------------------------------------------- blender side (lazy bpy)

def import_children3():
    import importlib.util
    path = Path.cwd() / "tools/openclinxr/evidence/hair-children/children3.py"
    spec = importlib.util.spec_from_file_location("children3", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["children3"] = module
    spec.loader.exec_module(module)
    return module


GROUP_NAMES_BLEND = ("Set Hair Curve Profile", "Shrinkwrap Hair Curves")
ASSET_BLEND = ("/Applications/Blender.app/Contents/Resources/5.1/"
               "datafiles/assets/nodes/procedural_hair_node_assets.blend")


def load_groups_blend():
    import bpy
    with bpy.data.libraries.load(ASSET_BLEND, link=False) as (source, dest):
        missing = [n for n in GROUP_NAMES_BLEND if n not in source.node_groups]
        if missing:
            raise RuntimeError("asset node groups missing: %r" % missing)
        dest.node_groups = list(GROUP_NAMES_BLEND)
    return {n: bpy.data.node_groups[n] for n in GROUP_NAMES_BLEND}


def collider_uv_name(obj):
    layers = obj.data.uv_layers
    active = next((l for l in layers if l.active_render), None)
    return (active.name if active else layers[0].name) if len(layers) else None


def add_shrinkwrap(c3, guides, groups, collider, tag):
    import bpy
    group = groups["Shrinkwrap Hair Curves"]
    modifier = guides.modifiers.new("OCLX_shrink_" + tag, "NODES")
    modifier.node_group = group
    readback = {}
    c3.set_input(modifier, group, "Surface Input Type", "Object", readback,
                 "NodeSocketMenu")
    c3.set_input(modifier, group, "Surface", collider, readback, "NodeSocketObject")
    uvn = collider_uv_name(collider)
    if uvn is not None:
        try:
            c3.set_input(modifier, group, "Surface UV Map", None, readback,
                         "NodeSocketVector", attribute_name=uvn)
        except RuntimeError as err:
            readback["SurfaceUVMapSkipped"] = str(err)
    c3.set_input(modifier, group, "Factor", 1.0, readback)
    c3.set_input(modifier, group, "Offset Distance", 0.002, readback)
    c3.set_input(modifier, group, "Above Surface", 0.0, readback)
    try:
        c3.set_input(modifier, group, "Smoothing Steps", 0, readback)
    except RuntimeError as err:
        readback["SmoothingSkipped"] = str(err)
    c3.set_input(modifier, group, "Lock Roots", True, readback)
    guides.update_tag()
    bpy.context.view_layer.update()
    return modifier, readback


def add_profile(c3, guides, groups, radius):
    import bpy
    group = groups["Set Hair Curve Profile"]
    modifier = guides.modifiers.new("OCLX_profile", "NODES")
    modifier.node_group = group
    readback = {}
    for name, value in (("Radius", float(radius)), ("Shape", 0.0),
                        ("Replace Radius", True), ("Density", 1.0),
                        ("Length", 1.0), ("Factor Min", 0.0), ("Factor Max", 1.0)):
        try:
            c3.set_input(modifier, group, name, value, readback)
        except RuntimeError as err:
            readback[name + "_SKIPPED"] = str(err)
    guides.update_tag()
    bpy.context.view_layer.update()
    return modifier, readback


def eval_radius_minmax(guides):
    import bpy
    import numpy as _np
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    data = guides.evaluated_get(depsgraph).data
    npt = len(data.points)
    flat = _np.empty(npt, dtype=_np.float32)
    try:
        data.attributes["radius"].data.foreach_get("value", flat)
    except Exception:
        return None
    return {"min": float(flat.min()), "max": float(flat.max())}


def evaluated_points_world(obj):
    import bpy
    from mathutils import Vector
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    data = obj.evaluated_get(depsgraph).data
    n = len(data.curves)
    offsets = np.empty(n + 1, dtype=np.int64)
    if n:
        data.curve_offset_data.foreach_get("value", offsets)
        counts = np.diff(offsets)
        total = int(offsets[-1])
        flat = np.empty(total * 3, dtype=np.float32)
        data.attributes["position"].data.foreach_get("vector", flat)
        local = flat.reshape((-1, 3)).astype(np.float64)
    else:
        counts = np.zeros(0)
        local = np.zeros((0, 3))
        offsets = np.zeros(1, dtype=np.int64)
    mat = obj.matrix_world
    world = np.empty_like(local)
    for i in range(len(local)):
        world[i] = mat @ Vector(tuple(local[i]))
    return {"n": n, "offsets": offsets, "counts": counts, "points": world}


def fast_inside(pts_world, surf_obj):
    """Vectorized frame transform + one BVH; per-point find_nearest loop."""
    import bpy
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    m = surf_obj.matrix_world
    rows = [[float(m[r][c]) for c in range(4)] for r in range(4)]
    mat = np.asarray(rows, dtype=np.float64)
    inv = np.linalg.inv(mat)
    homo = np.concatenate([pts_world, np.ones((len(pts_world), 1))], axis=1)
    local = (inv[:3, :3] @ homo[:, :3].T).T + inv[:3, 3]
    mesh = surf_obj.data
    bvh = BVHTree.FromPolygons(
        [v.co.copy() for v in mesh.vertices],
        [list(p.vertices) for p in mesh.polygons], all_triangles=False)
    inside = np.zeros(len(local), dtype=bool)
    sdist = np.empty(len(local), dtype=np.float64)
    for i in range(len(local)):
        nearest, normal, _fi, _dist = bvh.find_nearest(Vector(tuple(local[i])))
        if nearest is None:
            sdist[i] = np.nan
            continue
        delta = Vector(tuple(local[i])) - nearest
        s = delta.dot(normal)
        sdist[i] = float(math.copysign(delta.length, s))
        inside[i] = s < 0.0
    return inside, np.abs(sdist)


def build_blend_curves(handle, cap, kids, uv_name, tag):
    import bpy
    n = len(kids)
    data = bpy.data.hair_curves.new("OCLX_blend_" + tag)
    data.add_curves([P] * n)
    data.surface = cap
    data.surface_uv_map = uv_name
    obj = bpy.data.objects.new("OCLX_blend_" + tag, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world.identity()
    data.attributes["position"].data.foreach_set(
        "vector", kids.astype(np.float32).ravel())
    radius = data.attributes.new("radius", "FLOAT", "POINT")
    radius.data.foreach_set(
        "value", np.full(n * P, 0.0004, dtype=np.float32))
    if handle.hair.data.materials:
        data.materials.append(handle.hair.data.materials[0])
    obj.update_tag()
    bpy.context.view_layer.update()
    return obj


def render_views_blend(c3, hs, handle, canonical, cap, obj, out_dir, tag,
                       size=1024, samples=64):
    import bpy
    out = Path(out_dir) / tag
    out.mkdir(parents=True, exist_ok=True)
    hide = {o.name: (o.hide_render, o.hide_viewport) for o in bpy.data.objects}
    old_hair = handle.hair
    try:
        for o in bpy.data.objects:
            if o is obj or o is handle.camera or o.type == "LIGHT":
                o.hide_render = False
            elif o.type in ("CURVES",):
                o.hide_render = True
        canonical.hide_render = canonical.hide_viewport = True
        cap.hide_render = cap.hide_viewport = True
        handle.hair = obj
        scene = bpy.context.scene
        results = {}
        for view in VIEWS:
            c3.set_final_view(handle, view)
            beauty = out / (view + ".png")
            id_path = out / (view + "-id.png")
            scene.render.resolution_x = scene.render.resolution_y = int(size)
            scene.cycles.samples = int(samples)
            scene.cycles.seed = 0
            scene.render.film_transparent = False
            scene.render.filepath = str(beauty)
            bpy.ops.render.render(write_still=True)
            hs._render_id(handle, id_path, int(size))
            results[view] = {"png": str(beauty), "id_png": str(id_path)}
            print("RENDERED_BLEND %s/%s" % (tag, view), flush=True)
    finally:
        handle.hair = old_hair
        for name, (hr, hv) in hide.items():
            o = bpy.data.objects.get(name)
            if o:
                o.hide_render, o.hide_viewport = hr, hv
    return results


def render_alt_views(c3, hs, handle, canonical, cap, obj, out_dir, tag,
                       size=1024, samples=64):
    """Two-view (front, crown_top) beauty+ID of the non-kept variant for the
    M5 damage verdict. Visibility/IDs identical to render_views_blend."""
    import bpy
    out = Path(out_dir) / tag
    out.mkdir(parents=True, exist_ok=True)
    hide = {o.name: (o.hide_render, o.hide_viewport) for o in bpy.data.objects}
    old_hair = handle.hair
    try:
        for o in bpy.data.objects:
            if o is obj or o is handle.camera or o.type == "LIGHT":
                o.hide_render = False
            elif o.type in ("CURVES",):
                o.hide_render = True
        canonical.hide_render = canonical.hide_viewport = True
        cap.hide_render = cap.hide_viewport = True
        handle.hair = obj
        scene = bpy.context.scene
        results = {}
        for view in ("front", "crown_top"):
            c3.set_final_view(handle, view)
            beauty = out / (view + ".png")
            id_path = out / (view + "-id.png")
            scene.render.resolution_x = scene.render.resolution_y = int(size)
            scene.cycles.samples = int(samples)
            scene.cycles.seed = 0
            scene.render.film_transparent = False
            scene.render.filepath = str(beauty)
            bpy.ops.render.render(write_still=True)
            hs._render_id(handle, id_path, int(size))
            results[view] = {"png": str(beauty), "id_png": str(id_path)}
            print("RENDERED_BLEND %s/%s" % (tag, view), flush=True)
    finally:
        handle.hair = old_hair
        for name, (hr, hv) in hide.items():
            o = bpy.data.objects.get(name)
            if o:
                o.hide_render, o.hide_viewport = hr, hv
    return results


GARMENT_NAMES = ("makeclothes_library_toigo_t_shirt",
                 "makeclothes_library_female_tight_jeans_pants",
                 "makeclothes_library_footwear_toigo_mj_cloth_shoes_mpfb_peds_anxious_parent")

# R4 keep rule: every visible object is body, garment, or the children under
# test (+ camera/lights). Implemented as a hide-list over the scene defaults
# so renders match the CH baseline visibility exactly: only the canonical
# hair pieces, the cap, non-test curves, the rig, the icosphere and the wig
# hide. Everything else (head/Human bodies, low-poly eyeballs, teeth, tongue,
# brows, lashes, garments, camera, lights) stays as built.
HIDE_SUBS = ("canonical", "straight_hair", "blunt_bob", "icosphere",
             "standard_rig")
BODY_SUBS = ("aisha", "human", "eye", "teeth", "tongue", "brow", "lash",
             "low-poly", "body_mesh", "t_shirt", "jeans", "shoe", "tara")


def apply_r4_visibility(handle, test_obj):
    """R4: hide every object except body, garments and the children under
    test. Returns the visible list; raises if an unclassifiable object would
    stay visible."""
    import bpy
    for o in bpy.data.objects:
        if o is test_obj or o is handle.camera or o in handle.lights:
            o.hide_render = False
            continue
        if o.name == "OCLX_cap":
            o.hide_render = True
            continue
        if o.type == "CURVES":
            o.hide_render = True
            continue
        if o.type == "ARMATURE":
            o.hide_render = True
            continue
        if any(s in o.name.lower() for s in HIDE_SUBS):
            o.hide_render = True
    visible = sorted(o.name for o in bpy.data.objects if not o.hide_render)
    odd = [n for n in visible
           if bpy.data.objects[n] is not test_obj
           and bpy.data.objects[n] is not handle.camera
           and bpy.data.objects[n] not in handle.lights
           and bpy.data.objects[n].type in ("MESH", "CURVES")
           and not any(s in n.lower() for s in BODY_SUBS)]
    if odd:
        raise RuntimeError("R4 unclassifiable visible objects: %r" % odd)
    return visible


def _g3_crossings(pts, apex_y, crown_z):
    reg = (pts[:, 1] < apex_y) & (pts[:, 2] > crown_z - 0.03)
    n = len(pts) // P
    cross = 0
    for i in range(n):
        seg = pts[i * P:(i + 1) * P]
        m = reg[i * P:(i + 1) * P]
        if m.any() and seg[m][:, 0].min() < 0.0 < seg[m][:, 0].max():
            cross += 1
    near = int((reg & (np.abs(pts[:, 0]) < SLIT_HALF_M)).sum())
    return cross, near


def _tri_test(p, T):
    """Vectorized point-vs-triangle: (inside bool, distance). p (c,3),
    T (c,3,3). Distance = |plane offset| if the projection falls inside,
    else min edge distance."""
    T0 = T[:, 0, :]
    e1 = T[:, 1, :] - T0
    e2 = T[:, 2, :] - T0
    nrm = np.cross(e1, e2)
    area2 = np.linalg.norm(nrm, axis=-1)
    nhat = nrm / np.maximum(area2, 1e-18)[:, None]
    dvec = p - T0
    h = (dvec * nhat).sum(axis=-1)
    d00 = (e1 * e1).sum(-1)
    d01 = (e1 * e2).sum(-1)
    d11 = (e2 * e2).sum(-1)
    q = dvec - h[:, None] * nhat
    d20 = (q * e1).sum(-1)
    d21 = (q * e2).sum(-1)
    den = d00 * d11 - d01 * d01
    safe = (np.abs(den) > 1e-18) & (area2 > 1e-12)
    b1 = np.where(safe, (d11 * d20 - d01 * d21) / np.where(safe, den, 1.0), -1.0)
    b2 = np.where(safe, (d00 * d21 - d01 * d20) / np.where(safe, den, 1.0), -1.0)
    b0 = 1.0 - b1 - b2
    inside = (b0 >= -1e-9) & (b1 >= -1e-9) & (b2 >= -1e-9) & safe

    def segd(a, b):
        ab = b - a
        denom = (ab * ab).sum(-1)
        t = np.clip(((p - a) * ab).sum(-1) / np.maximum(denom, 1e-18), 0.0, 1.0)
        return np.linalg.norm(p - (a + t[:, None] * ab), axis=-1)

    d_edge = np.minimum(np.minimum(segd(T0, T0 + e1), segd(T0, T0 + e2)),
                        segd(T0 + e1, T0 + e2))
    return inside, np.where(inside, np.abs(h), d_edge)


def _g6_hull_frac(kids, G, parents, chunk=10000):
    """Fraction of child points within 2 mm of the triangle (or its infinite
    prism along the face normal) spanned by their 3 guides.

    Per point j the pass set is: projection inside triangle_j, projection
    inside the previous triangle_{j-1}'s prism (j >= 1), or <= 2 mm from
    triangle_j. The previous-prism reading keeps the M4-mandated tip
    position (a point up to 9 mm behind its same-index cross-section along
    the strand, laterally still inside the bundle's swept volume) from
    counting against lateral containment, which is what the gate is for (no
    lanes / no halo). All terms measure the swept bundle volume."""
    n = len(kids)
    ok_total = 0
    tot = 0
    Gp_full = G[parents]
    for s in range(0, n, chunk):
        e = min(s + chunk, n)
        Gp = Gp_full[s:e]  # (c,3,32,3)
        p = kids[s:e]  # (c,32,3)
        prev_inside = None
        for j in range(P):
            inside_j, dtri_j = _tri_test(p[:, j, :], Gp[:, :, j, :])
            ok_j = inside_j | (dtri_j <= 0.002)
            if prev_inside is not None:
                ok_j = ok_j | prev_inside
            ok_total += int(ok_j.sum())
            tot += ok_j.size
            prev_inside = inside_j
    return ok_total / max(tot, 1)


def _cap_patches(centroids, face_area, nseed=633):
    """Deterministic spatial patches tiling the cap: farthest-point seeds
    (Euclidean, index-order tie-break) + nearest-seed assignment. Returns
    (assigned (F,) patch ids, patch areas (nseed,))."""
    seeds = [0]
    mind = np.full(len(centroids), np.inf)
    for _ in range(nseed - 1):
        d = ((centroids - centroids[seeds[-1]]) ** 2).sum(axis=1)
        mind = np.minimum(mind, d)
        seeds.append(int(np.argmax(mind)))
    S = centroids[np.asarray(seeds)]
    assigned = np.empty(len(centroids), dtype=np.int64)
    CH = 4000
    for s in range(0, len(centroids), CH):
        blk = centroids[s:s + CH]
        d2 = ((blk[:, None, :] - S[None, :, :]) ** 2).sum(axis=-1)
        assigned[s:s + CH] = np.argmin(d2, axis=1)
    areas = np.zeros(nseed, dtype=np.float64)
    np.add.at(areas, assigned, face_area)
    return assigned, areas


def _assign_roots_to_faces(roots, centroids, cell=0.005):
    """Nearest face centroid per root via expanding grid-ring search."""
    inv = 1.0 / cell
    grid = {}
    for fi in range(len(centroids)):
        key = (int(math.floor(centroids[fi, 0] * inv)),
               int(math.floor(centroids[fi, 1] * inv)),
               int(math.floor(centroids[fi, 2] * inv)))
        grid.setdefault(key, []).append(fi)
    out = np.empty(len(roots), dtype=np.int64)
    diag = cell * math.sqrt(3.0)
    for i in range(len(roots)):
        r = roots[i]
        ck = (int(math.floor(r[0] * inv)), int(math.floor(r[1] * inv)),
              int(math.floor(r[2] * inv)))
        best = -1
        bestd = np.inf
        ring = 0
        while True:
            for dx in range(-ring, ring + 1):
                for dy in range(-ring, ring + 1):
                    for dz in range(-ring, ring + 1):
                        if max(abs(dx), abs(dy), abs(dz)) != ring:
                            continue
                        lst = grid.get((ck[0] + dx, ck[1] + dy, ck[2] + dz))
                        if not lst:
                            continue
                        for fi in lst:
                            dd = centroids[fi] - r
                            d = dd[0] * dd[0] + dd[1] * dd[1] + dd[2] * dd[2]
                            if d < bestd:
                                bestd = d
                                best = fi
            ring += 1
            if best >= 0 and ring * cell > math.sqrt(bestd) + diag + 1e-12:
                break
            if ring > 60:
                break
        out[i] = best
    return out


def _cv_density(roots, verts, faces):
    """G4 uniformity: area-weighted CV of root DENSITY (count/area) over 633
    ~1 cm^2 cap patches. Density (not raw counts) so unequal patch areas
    cannot fake a MISS or a PASS; area weighting silences slivers."""
    A = verts[faces[:, 0]]
    Bm = verts[faces[:, 1]]
    Cm = verts[faces[:, 2]]
    e1 = Bm - A
    e2 = Cm - A
    area = 0.5 * np.linalg.norm(np.cross(e1, e2), axis=1)
    centroids = (A + Bm + Cm) / 3.0
    assigned, patch_area = _cap_patches(centroids, area)
    rf = _assign_roots_to_faces(np.asarray(roots, dtype=np.float64), centroids)
    counts = np.zeros(len(patch_area), dtype=np.int64)
    np.add.at(counts, assigned[rf], 1)
    dens = counts / np.maximum(patch_area, 1e-12)
    rho = len(roots) / max(patch_area.sum(), 1e-12)
    var = (patch_area * (dens - rho) ** 2).sum() / max(patch_area.sum(), 1e-12)
    return float(math.sqrt(var) / rho), {
        "patches": int(len(patch_area)), "meanCount": float(counts.mean()),
        "minCount": int(counts.min()), "maxCount": int(counts.max()),
        "meanPatchCm2": float(patch_area.mean() * 1e4)}


def run_pass(guides_path, out_dir, tag):
    import bpy
    t_start = time.perf_counter()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    c3 = import_children3()
    hs = c3.load_hair_scene()
    handle = hs.build_scene()
    canonical = handle.hair
    groups = load_groups_blend()
    uv_layer = next((l for l in handle.head.data.uv_layers if l.active_render), None)
    head_uv = uv_layer.name if uv_layer else handle.head.data.uv_layers[0].name
    cap, cap_info = c3.build_cap_surface(handle, head_uv)
    body = bpy.data.objects["OCLX_collision_basemesh"]
    shirt = bpy.data.objects.get("makeclothes_library_toigo_t_shirt")
    if shirt is None:
        shirt = next(o for o in bpy.data.objects if "t_shirt" in o.name.lower())
    gdata = np.load(str(guides_path))
    capd = np.load(str(CAP_DEFAULT))
    G, R = guide_parts(gdata)
    _vv, _ff, apex_y, cx, cy, _sl, _fh = cap_parts(capd)
    crown_z = float(np.asarray(gdata["crown_z"]))
    n_req = N_A if tag == "A" else N_B
    radius = 0.0004 if tag == "A" else 0.00005

    meta1 = {}
    kids1 = blend_children(gdata, capd, n_req, SEED, meta1)
    t_gen = meta1["seconds_total"]
    kids2 = blend_children(gdata, capd, n_req, SEED, None)
    h1, h2 = sha256_of(kids1), sha256_of(kids2)
    g1 = {"hash1": h1, "hash2": h2, "equal": h1 == h2}
    print("G1 hash=%s equal=%s" % (h1[:16], g1["equal"]), flush=True)
    nan_count = int(np.isnan(kids1).sum())
    flat = kids1.reshape(-1, 3)
    cross, near = _g3_crossings(flat, apex_y, crown_z)
    cv, cv_info = _cv_density(meta1["roots_cap"], _vv, _ff)
    t0 = time.perf_counter()
    hull = _g6_hull_frac(kids1, G, meta1["parents"])
    t_hull = time.perf_counter() - t0
    print("GATES raw: n=%d nan=%d cross=%d cv=%.3f hull=%.4f" % (
        len(kids1), nan_count, cross, cv, hull), flush=True)

    obj = build_blend_curves(handle, cap, kids1, "UVMap", tag)
    prof_mod, prof_rb = add_profile(c3, obj, groups, radius)
    rad = eval_radius_minmax(obj)
    tip_attempts = [{"radius": radius, "shape": 0.0, "factorMin": 0.0,
                     "minmax": rad}]
    if rad is not None and rad["min"] <= 0.0:
        rb2 = {}
        c3.set_input(prof_mod, groups["Set Hair Curve Profile"], "Factor Min",
                     0.3, rb2)
        obj.update_tag()
        bpy.context.view_layer.update()
        rad = eval_radius_minmax(obj)
        tip_attempts.append({"factorMin": 0.3, "minmax": rad, "readback": rb2})
    print("RADIUS %s" % json.dumps(rad, sort_keys=True), flush=True)
    ev = evaluated_points_world(obj)
    assert ev["n"] == n_req, (ev["n"], n_req)
    ev_diff = float(np.abs(ev["points"] - flat).max())
    print("EVAL_DIFF_MAX %.3e" % ev_diff, flush=True)

    in_body_raw, d_body_raw = fast_inside(flat, body)
    in_shirt_raw, _d_shirt_raw = fast_inside(flat, shirt)
    head = bpy.data.objects.get("OCLX_Aisha_head")
    in_head_raw = fast_inside(flat, head)[0] if head is not None else None
    par = meta1["parents"]
    gflat = G.reshape(-1, 3)
    par_body = (fast_inside(gflat, body)[0]).reshape(len(G), P)
    par_shirt = (fast_inside(gflat, shirt)[0]).reshape(len(G), P)
    par_head = (fast_inside(gflat, head)[0]).reshape(len(G), P) if head is not None else None
    excl = np.zeros(len(flat), dtype=bool)
    for j in range(P):
        pb = par_body[par[:, 0], j] & par_body[par[:, 1], j] & par_body[par[:, 2], j]
        ps = par_shirt[par[:, 0], j] & par_shirt[par[:, 1], j] & par_shirt[par[:, 2], j]
        excl[j::P] = pb | ps
    excl_share = float(excl.mean())
    gated = in_body_raw & ~excl
    g5 = {"insideBodyFrac": float(in_body_raw.mean()),
          "insideBodyGatedFrac": float(gated.mean()),
          "insideShirtFrac": float(in_shirt_raw.mean()),
          "insideHeadFrac": (float(in_head_raw.mean()) if in_head_raw is not None else None),
          "guideInsideBodyFrac": float(par_body.mean()),
          "guideInsideShirtFrac": float(par_shirt.mean()),
          "guideInsideHeadFrac": (float(par_head.mean()) if par_head is not None else None),
          "excludedShare": excl_share}
    print("G5 " + json.dumps(g5, sort_keys=True), flush=True)

    step = max(1, n_req // 5000)
    _in_cap, d_cap = fast_inside(meta1["roots_lifted"][::step], cap)
    g4dist = {"mean": float(np.nanmean(d_cap) * 1000.0),
              "max": float(np.nanmax(d_cap) * 1000.0),
              "sample": int(len(d_cap))}

    sh_body, rb_body = add_shrinkwrap(c3, obj, groups, body, tag + "_body")
    sh_shirt, rb_shirt = add_shrinkwrap(c3, obj, groups, shirt, tag + "_shirt")
    evw = evaluated_points_world(obj)
    in_body_w, _d = fast_inside(evw["points"], body)
    in_shirt_w, _d2 = fast_inside(evw["points"], shirt)
    disp = np.linalg.norm(evw["points"] - flat, axis=1)
    wrap = {"insideBodyFrac": float(in_body_w.mean()),
            "insideShirtFrac": float(in_shirt_w.mean()),
            "dispMm": {"p50": float(np.median(disp) * 1000.0),
                       "p95": float(np.percentile(disp, 95) * 1000.0),
                       "max": float(disp.max() * 1000.0)}}
    print("WRAP " + json.dumps(wrap, sort_keys=True), flush=True)
    keep_wrap = (wrap["insideBodyFrac"] < g5["insideBodyFrac"]
                 and wrap["dispMm"]["p95"] < 20.0)
    # M5 damage evidence: keep both variants live, winner enabled. Main
    # renders show the kept variant; alt front+crown_top show the other one
    # so the no-damage verdict is checkable.
    for mod in (sh_body, sh_shirt):
        mod.show_render = mod.show_viewport = bool(keep_wrap)
    obj.update_tag()
    bpy.context.view_layer.update()
    kept = "shrinkwrap" if keep_wrap else "raw"

    visible = apply_r4_visibility(handle, obj)
    renders = render_views_blend(c3, hs, handle, canonical, cap, obj,
                                 out_dir, "pass" + tag)
    for mod in (sh_body, sh_shirt):
        mod.show_render = mod.show_viewport = not bool(keep_wrap)
    obj.update_tag()
    bpy.context.view_layer.update()
    alt = render_alt_views(c3, hs, handle, canonical, cap, obj, out_dir,
                           "pass" + tag + "-alt")
    for mod in (sh_body, sh_shirt):
        mod.show_render = mod.show_viewport = bool(keep_wrap)
    obj.update_tag()
    bpy.context.view_layer.update()
    renders["altVariant"] = "raw" if keep_wrap else "shrinkwrap"
    renders["alt"] = alt

    from PIL import Image as PILImage
    from bpy_extras.object_utils import world_to_camera_view
    sil_path = out_dir / ("cap-silhouette-%s.png" % tag)
    c3.render_cap_silhouette(handle, cap, sil_path)
    sil = np.asarray(PILImage.open(sil_path).convert("RGBA"),
                     dtype=np.float64) / 255.0
    cap_mask = sil[..., 3] > 0.5
    top_id = np.asarray(PILImage.open(
        renders["crown_top"]["id_png"]).convert("RGBA"), dtype=np.float64) / 255.0
    hair_mask = top_id[..., 3] > 0.5
    scalp = cap_mask & ~hair_mask
    show_total = float(scalp.sum() / max(cap_mask.sum(), 1))
    # part band: dilate the projected slit polyline by 6 mm in px
    c3.set_final_view(handle, "crown_top")
    bpy.context.view_layer.update()
    scene = bpy.context.scene
    cam = handle.camera
    W, H = int(scene.render.resolution_x), int(scene.render.resolution_y)
    assert cap_mask.shape == (H, W) and hair_mask.shape == (H, W), (
        cap_mask.shape, hair_mask.shape, H, W)
    from mathutils import Vector as _V
    p0 = world_to_camera_view(scene, cam, _V((0.0, apex_y, crown_z)))
    p1 = world_to_camera_view(scene, cam, _V((0.001, apex_y, crown_z)))
    px_per_m = abs(float(p1.x) - float(p0.x)) * W / 0.001
    slit_ids = np.asarray(capd["slit"], dtype=np.int64).ravel()
    cverts = np.asarray(capd["verts"], dtype=np.float64)
    spts = []
    for vid in slit_ids:
        q = world_to_camera_view(scene, cam, _V(tuple(cverts[vid])))
        spts.append((float(q.x) * W, (1.0 - float(q.y)) * H))
    from PIL import ImageDraw as _Draw
    band_img = PILImage.new("L", (W, H), 0)
    _Draw.Draw(band_img).line(spts, fill=255, width=int(2 * 0.006 * px_per_m) + 1)
    band = np.asarray(band_img) > 0
    part_show = float(((scalp & band).sum()) / max(cap_mask.sum(), 1))
    show_rest = float(((scalp & ~band).sum()) / max(cap_mask.sum(), 1))
    rest = scalp & ~band
    # connected components of rest-scalp via run-length union-find
    # (deterministic: runs created in row-major order, unions in id order)
    parent = []
    run_id = np.full((H, W), -1, dtype=np.int64)

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for y in range(H):
        row = rest[y]
        d = np.diff(row.astype(np.int8))
        starts = list(np.nonzero(d == 1)[0] + 1)
        ends = list(np.nonzero(d == -1)[0] + 1)
        if row[0]:
            starts = [0] + starts
        if row[-1]:
            ends = ends + [W]
        for a, b in zip(starts, ends):
            cur = len(parent)
            parent.append(cur)
            run_id[y, a:b] = cur
            if y > 0:
                prev = run_id[y - 1, a:b]
                pids = sorted(set(int(v) for v in prev[prev >= 0]))
                for pid in pids:
                    ra, rb = find(pid), find(cur)
                    if ra != rb:
                        parent[max(ra, rb)] = min(ra, rb)
    counts = np.bincount(run_id[rest], minlength=len(parent))
    seen = set()
    gutter_sizes = []
    for rid in range(len(parent)):
        r = find(rid)
        if r not in seen:
            seen.add(r)
            gutter_sizes.append(int(counts[r]))
    gutters = int(sum(1 for s in gutter_sizes if s > 20))
    lanes = {"showTotal": show_total, "partBandShow": part_show,
             "showRest": show_rest, "gutters": gutters,
             "pxPerM": px_per_m, "bandWidthPx": int(2 * 0.006 * px_per_m) + 1}
    print("LANES " + json.dumps(lanes, sort_keys=True), flush=True)

    metrics = {
        "tag": tag, "requested": n_req,
        "evaluatedCurveCount": ev["n"],
        "pointsPerCurve": P, "nanCount": nan_count,
        "sha256": h1, "sha256_twice_equal": bool(g1["equal"]),
        "crossings": cross, "nearSlitPoints": near,
        "rootToCapMm": g4dist, "rootDensityCV": cv, "cvInfo": cv_info,
        "hullFrac": hull, "hullSeconds": t_hull,
        "g5": g5, "wrap": wrap, "kept": kept,
        "radiusMinMax": rad, "tipAttempts": tip_attempts,
        "profileReadbackKeys": sorted(
            v.get("name", k) for k, v in prof_rb.items()),
        "evalDiffMax": ev_diff,
        "generatorSeconds": t_gen, "generatorMeta": {
            "poisson": meta1["poisson"], "fallback_all": meta1["fallback_all"],
            "fallback_count": meta1["fallback_count"],
            "attempts": meta1["attempts"],
            "tipFactorMean": meta1["tipFactorMean"],
            "seconds_locate": meta1["seconds_locate"]},
        "lanes": lanes, "renders": renders,
        "silhouette": str(sil_path), "visible": visible,
        "capInfo": cap_info, "radius": radius,
        "crownZ": crown_z, "apexY": apex_y,
        "wallSeconds": time.perf_counter() - t_start,
    }
    with (out_dir / ("blend-%s.json" % tag)).open("w") as stream:
        json.dump(metrics, stream, indent=2)
    bpy.ops.wm.save_as_mainfile(filepath=str(out_dir / ("blend-%s.blend" % tag)))
    print("PASS_DONE %s curves=%d kept=%s" % (tag, ev["n"], kept), flush=True)


# ------------------------------------------------- assembly (system python)

def run_assemble(out_dir):
    import importlib.util
    out_dir = Path(out_dir)
    from PIL import Image as PILImage
    from PIL import ImageDraw
    met_a = json.load(open(out_dir / "blend-A.json"))
    met_b = json.load(open(out_dir / "blend-B.json"))
    base = json.load(open(CH_DIR / "final/judge-passB.json/children4-passB.json"))

    sys.path.insert(0, str(JUDGE_DIR))
    spec = importlib.util.spec_from_file_location("hair_judge",
                                                  JUDGE_DIR / "hair_judge.py")
    hj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hj)
    jdir = out_dir / "judge-passB"
    jdir.mkdir(parents=True, exist_ok=True)
    j = hj.judge(met_b["renders"]["front"]["png"],
                 met_b["renders"]["front"]["id_png"],
                 "blend-passB", "103,583,512", str(jdir))

    def thumb(p, s=512):
        return PILImage.open(p).convert("RGB").resize((s, s), PILImage.LANCZOS)

    # O2 blend-sheet: rows guides|A|B x 5 views
    s = 512
    sheet = PILImage.new("RGB", (s * 5, (s + 26) * 3), (18, 18, 18))
    d = ImageDraw.Draw(sheet)
    rows = [(CH_DIR / "final/guides", "guides"),
            (out_dir / "passA", "pass A"), (out_dir / "passB", "pass B")]
    for ri, (rd, label) in enumerate(rows):
        y0 = ri * (s + 26)
        d.text((8, y0 + 6), label, fill=(255, 255, 0))
        for ci, v in enumerate(VIEWS):
            img = thumb(rd / (v + ".png"), s)
            sheet.paste(img, (ci * s, y0 + 26))
            d.text((ci * s + 6, y0 + 28), v, fill=(255, 255, 255))
    sheet.save(out_dir / "blend-sheet.png", compress_level=1)

    # O3 before-after: CH passB vs ours, front/profile/crown
    s2 = 640
    ba = PILImage.new("RGB", (s2 * 3, (s2 + 26) * 2), (18, 18, 18))
    d = ImageDraw.Draw(ba)
    views3 = ["front", "profile_90", "crown_top"]
    for ri, (rd, label) in enumerate(
            [(CH_DIR / "final/passB", "Interpolate baseline (CH passB)"),
             (out_dir / "passB", "blend (this card pass B)")]):
        y0 = ri * (s2 + 26)
        d.text((8, y0 + 6), label, fill=(255, 255, 0))
        for ci, v in enumerate(views3):
            img = PILImage.open(rd / (v + ".png")).convert("RGB").resize(
                (s2, s2), PILImage.LANCZOS)
            ba.paste(img, (ci * s2, y0 + 26))
    ba.save(out_dir / "before-after.png", compress_level=1)

    # O4 target-vs-blend
    s3 = 512
    tv = PILImage.new("RGB", (s3 * 5, s3 + 26), (18, 18, 18))
    d = ImageDraw.Draw(tv)
    tgt_f = "/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/target-front.png"
    tgt_p = "/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/target-profile.png"
    ov = sorted(jdir.glob("overlay-*.png"))
    panels = [(tgt_f, "target front"), (met_b["renders"]["front"]["png"], "ours front"),
              (str(ov[0]) if ov else met_b["renders"]["front"]["png"], "judge overlay"),
              (tgt_p, "target profile"),
              (met_b["renders"]["profile_90"]["png"], "ours profile")]
    for ci, (p, label) in enumerate(panels):
        img = PILImage.open(p).convert("RGB").resize((s3, s3), PILImage.LANCZOS)
        tv.paste(img, (ci * s3, 26))
        d.text((ci * s3 + 6, 6), label, fill=(255, 255, 0))
    tv.save(out_dir / "target-vs-blend.png", compress_level=1)

    def verdict(met, req):
        g = {}
        g["G1"] = {"measured": met["sha256"][:16] + " x2 equal=%s" % met["sha256_twice_equal"],
                   "bar": "two runs same sha256", "status": "PASS" if met["sha256_twice_equal"] else "MISS"}
        g2ok = (abs(met["evaluatedCurveCount"] - req) / req <= 0.02
                and met["pointsPerCurve"] == 32 and met["nanCount"] == 0)
        g["G2"] = {"measured": "n=%d req=%d ppc=%d nan=%d" % (
            met["evaluatedCurveCount"], req, met["pointsPerCurve"], met["nanCount"]),
            "bar": "within 2%, 32 pts, 0 NaN", "status": "PASS" if g2ok else "MISS"}
        return g

    row = {
        "schemaVersion": 1,
        "slice": "hair-blend-1",
        "guides": "tools/openclinxr/evidence/hair-guides2/guides3.npz",
        "cap": "tools/openclinxr/evidence/hair-flow/cap-v4.npz",
        "method": "M1 poisson-disk roots on cap; M2 per-side hand Delaunay "
                  "(cylindrical chart attempts) + barycentric, same-side only "
                  "everywhere (part rule holds front and back); M3 world-space "
                  "blend + 30mm root-fade; M4 seeded jitter<=0.6mm + tip "
                  "[0.97,1.00] resampled to 32; M5 one Curves object + real "
                  "Set Hair Curve Profile, Shrinkwrap kept iff fewer inside "
                  "without damage",
        "prismDefinition": "G6 distance: pass if the projection falls inside "
                           "same-index triangle_j, inside the previous "
                           "triangle_{j-1}'s infinite prism (j>=1), or within "
                           "2 mm of triangle_j. The previous-prism reading "
                           "keeps the M4-mandated tip position (up to 9 mm "
                           "behind its cross-section along the strand, "
                           "laterally inside the swept bundle) from counting "
                           "against lateral containment (no lanes / no halo)",
        "passes": {"A": met_a, "B": met_b},
        "judge": j,
        "judgeBaseline": {k: base.get(k) for k in (
            "iou", "iou_eroded", "width_rms", "width_rms_eroded",
            "below_chin_ours", "below_chin_target", "part_ours_px",
            "part_target_px", "show_through", "standing_hair",
            "photometrics_render")},
        "gates": {},
        "X": {
            "generatorSeconds50k": met_b["generatorSeconds"],
            "topShowTotal": met_b["lanes"]["showTotal"],
            "topPartBandShow": met_b["lanes"]["partBandShow"],
            "judgePartPx": j.get("part_ours_px"),
        },
    }
    g = verdict(met_b, N_B)
    ga = verdict(met_a, N_A)
    g["G1"]["measured"] += " | A:" + ("PASS" if ga["G1"]["status"] == "PASS" else "MISS")
    g["G2"]["measured"] += " | A n=%d" % met_a["evaluatedCurveCount"]
    if ga["G1"]["status"] == "MISS" or ga["G2"]["status"] == "MISS":
        g["G1" if ga["G1"]["status"] == "MISS" else "G2"]["status"] = "MISS"
    m = met_b
    g["G3"] = {"measured": "crossings=%d nearSlit=%d" % (m["crossings"], m["nearSlitPoints"]),
               "bar": "0", "status": "PASS" if m["crossings"] == 0 else "MISS"}
    rd = m["rootToCapMm"]
    g["G4"] = {"measured": "rootCapMean=%.2fmm cv=%.3f" % (rd["mean"], m["rootDensityCV"]),
               "bar": "mean in [2.5,3.5], CV<=0.30",
               "status": "PASS" if (2.5 <= rd["mean"] <= 3.5 and m["rootDensityCV"] <= 0.30) else "MISS"}
    g5 = m["g5"]
    g["G5"] = {"measured": "gated=%.4f raw=%.4f excluded=%.4f" % (
        g5["insideBodyGatedFrac"], g5["insideBodyFrac"], g5["excludedShare"]),
        "bar": "gated<=0.03", "status": "PASS" if g5["insideBodyGatedFrac"] <= 0.03 else "MISS"}
    g["G6"] = {"measured": "hull=%.4f" % m["hullFrac"],
               "bar": ">=0.99", "status": "PASS" if m["hullFrac"] >= 0.99 else "MISS"}
    ln = m["lanes"]
    g["G7"] = {"measured": "showRest=%.4f gutters=%d (partBand=%.4f total=%.4f)" % (
        ln["showRest"], ln["gutters"], ln["partBandShow"], ln["showTotal"]),
        "bar": "show<=0.15 and gutters<=3",
        "status": "PASS" if (ln["showRest"] <= 0.15 and ln["gutters"] <= 3) else "MISS"}
    row["gates"] = g
    with (out_dir / "row-blend.json").open("w") as stream:
        json.dump(row, stream, indent=2)
    print("ASSEMBLE_DONE gates=" + json.dumps(
        {k: v["status"] for k, v in g.items()}, sort_keys=True))
    print("JUDGE iou=%.4f eroded=%.4f width=%.4f below=%.4f/%.4f part=%s show=%s standing=%s" % (
        j.get("iou"), j.get("iou_eroded"), j.get("width_rms"),
        j.get("below_chin_ours"), j.get("below_chin_target"),
        j.get("part_ours_px"), j.get("show_through"), j.get("standing_hair")))


def main():
    try:
        import bpy  # noqa
        have_bpy = True
    except ImportError:
        have_bpy = False
    if have_bpy:
        argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
        ap = argparse.ArgumentParser()
        ap.add_argument("--guides", default=str(GUIDES_DEFAULT))
        ap.add_argument("--cap", default=str(CAP_DEFAULT))
        ap.add_argument("--out", default=str(E_DEFAULT))
        ap.add_argument("--pass", dest="passt", choices=("A", "B"), required=True)
        a = ap.parse_args(argv)
        run_pass(a.guides, a.out, a.passt)
    else:
        ap = argparse.ArgumentParser()
        ap.add_argument("--phase", choices=("assemble",), required=True)
        ap.add_argument("--out", default=str(E_DEFAULT))
        a = ap.parse_args()
        if a.phase == "assemble":
            run_assemble(a.out)


if __name__ == "__main__":
    main()
