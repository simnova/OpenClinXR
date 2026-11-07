"""hair-part-1: deterministic numpy children station (world-space guide blend + part closure/fill).

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
      tools/openclinxr/evidence/hair-part/blend_part.py -- \\
      --guides tools/openclinxr/evidence/hair-guides6/guides6.npz \\
      --out tools/openclinxr/evidence/hair-part --cell C0
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

E_DEFAULT = Path.cwd() / "tools/openclinxr/evidence/hair-scalp"
GUIDES_DEFAULT = Path.cwd() / "tools/openclinxr/evidence/hair-guides6/guides6.npz"
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
PART_VIEWS = ("front", "crown_top")

# M2 lateral-closure parameters (all metres internally; table in mm).
# Children rooted within ROOT_RADIUS_MM of the slit plane shift TOWARD the
# slit by up to C_MAX_MM scaled by (1 - root_dist/ROOT_RADIUS_MM), with a
# smooth bump that is 0 at the root, 1 on [ARC_FULL_FROM_MM, ARC_PEAK_HI_MM]
# and 0 beyond ARC_ZERO_AFTER_MM. Points never cross x = 0 (clamped to
# SLIT_MARGIN_MM from the slit plane). Lateral only: no y/z change, so the
# RISE_CAP_MM bound is enforced explicitly on the normal-projected shift.
PART_CLOSURE = {
    "C_MAX_MM": 3.0,
    "ROOT_RADIUS_MM": 10.0,
    "ARC_FULL_FROM_MM": 10.0,
    "ARC_PEAK_HI_MM": 30.0,
    "ARC_ZERO_AFTER_MM": 45.0,
    "SLIT_MARGIN_MM": 0.3,
    "RISE_CAP_MM": 2.0,
}

# M3 root-fill parameters: child-root density within FILL_RADIUS_MM of the
# slit is raised to FILL_FACTOR x the cap average by adding seeded extra
# roots (extra stream SEED_OFFSET so C0 off/off is bit-identical to blend.py).
PART_FILL = {
    "FILL_RADIUS_MM": 6.0,
    "FILL_FACTOR": 1.5,
    "SEED_OFFSET": 101,
}


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


def _blend_children_base(guides, cap, n, seed=0, meta=None,
                         _roots_override=None, _closure_on=False):
    """M1-M4: deterministic world-space blend children (base).

    _roots_override=(roots_cap, root_nor, pinfo): skip poisson and use these
    roots (M3 fill path; the wrapper already drew the base stream from the
    same seed, so off/off is bit-identical to blend.py). _closure_on applies
    the M2 lateral closure after jitter.


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
    if _roots_override is not None:
        roots_cap, root_nor, pinfo = _roots_override
        n = int(len(roots_cap))
    else:
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

    # PART-CLOSURE (M2): lateral shift toward the slit plane for roots within
    # ROOT_RADIUS_MM of the slit (front of the apex, where the slit exists).
    # Smooth bump: 0 at the root, 1 on [ARC_FULL_FROM_MM, ARC_PEAK_HI_MM],
    # 0 beyond ARC_ZERO_AFTER_MM. Never crosses x = 0 (SLIT_MARGIN_MM clamp).
    # Lateral only (no y/z change); the normal-projected shift is capped at
    # RISE_CAP_MM. Deterministic: no RNG.
    _pc = PART_CLOSURE
    _prad = _pc["ROOT_RADIUS_MM"] / 1000.0
    _psel = (np.abs(roots_cap[:, 0]) < _prad) & (roots_cap[:, 1] < apex_y)
    _part_close_info = {"affected": 0, "maxShiftMm": 0.0, "riseMaxMm": 0.0}
    if _closure_on and bool(_psel.any()):
        _rdist = np.abs(roots_cap[:, 0])
        _cmax = (_pc["C_MAX_MM"] / 1000.0) * (1.0 - _rdist / _prad)
        _cseg = np.diff(kids, axis=1)
        _cseglen = np.linalg.norm(_cseg, axis=2)
        _carc = np.concatenate([np.zeros((n, 1)),
                                np.cumsum(_cseglen, axis=1)], axis=1)
        _a0 = _pc["ARC_FULL_FROM_MM"] / 1000.0
        _a1 = _pc["ARC_PEAK_HI_MM"] / 1000.0
        _a2 = _pc["ARC_ZERO_AFTER_MM"] / 1000.0
        _bump = (_smoothstep(_carc / _a0)
                 * (1.0 - _smoothstep((_carc - _a1) / max(_a2 - _a1, 1e-12))))
        _shift = _bump * _cmax[:, None]
        _side = np.where(roots_cap[:, 0] < 0.0, -1.0, 1.0)
        _margin = _pc["SLIT_MARGIN_MM"] / 1000.0
        _xn = kids[:, :, 0] - _side[:, None] * _shift
        _pos = _side > 0.0
        _xn = np.where(_pos[:, None], np.maximum(_xn, _margin),
                       np.minimum(_xn, -_margin))
        _dx = np.where(_psel[:, None], _xn - kids[:, :, 0], 0.0)
        _nx = root_nor[:, 0]
        _rise = _dx * _nx[:, None]
        _cap = _pc["RISE_CAP_MM"] / 1000.0
        _over = (_psel[:, None] & (_rise > _cap)
                 & (np.abs(_nx[:, None]) > 1e-9))
        if bool(_over.any()):
            _safe_nx = np.where(np.abs(_nx[:, None]) > 1e-9, _nx[:, None], 1.0)
            _dx = np.where(_over, _cap / _safe_nx, _dx)
            _xn = kids[:, :, 0] + _dx
            _xn = np.where(_pos[:, None], np.maximum(_xn, _margin),
                           np.minimum(_xn, -_margin))
            _dx = np.where(_psel[:, None], _xn - kids[:, :, 0], 0.0)
            _rise = _dx * _nx[:, None]
        kids[:, :, 0] = np.where(_psel[:, None], _xn, kids[:, :, 0])
        _part_close_info = {
            "affected": int(_psel.sum()),
            "maxShiftMm": float(np.abs(_dx[_psel]).max() * 1000.0),
            "riseMaxMm": float(_rise[_psel].max() * 1000.0),
        }

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
                     "root_nor": root_nor,
                     "part_close": dict(_part_close_info),
                     "part_n_extra": int(pinfo.get("part_n_extra", 0)),
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


# ------------------------------------------------- hair-part-1 M1/M3 helpers (pure numpy)

def _part_face_areas(verts, faces):
    """Per-face area + centroid (same convention as poisson_roots)."""
    A = verts[faces[:, 0]]
    Bm = verts[faces[:, 1]]
    Cm = verts[faces[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(Bm - A, Cm - A), axis=1)
    cent = (A + Bm + Cm) / 3.0
    return area, cent


def _part_extra_count(verts, faces, apex_y, n):
    """M3: extra root count raising slit-strip density to FILL_FACTOR x mean.

    Strip = cap faces whose centroid is within FILL_RADIUS_MM of the slit
    plane (|x|) and in front of the apex (where the slit exists).
    target = FILL_FACTOR * (n/total) * stripArea; extra = target - expected.
    """
    area, cent = _part_face_areas(verts, faces)
    total = float(area.sum())
    half = PART_FILL["FILL_RADIUS_MM"] / 1000.0
    m = (np.abs(cent[:, 0]) < half) & (cent[:, 1] < apex_y)
    strip = float(area[m].sum())
    expected = n * strip / max(total, 1e-18)
    target = PART_FILL["FILL_FACTOR"] * expected
    return int(round(target - expected)), {
        "stripAreaCm2": strip * 1e4, "capAreaCm2": total * 1e4,
        "expectedInStrip": float(expected), "targetInStrip": float(target)}


def _sample_strip_roots(verts, faces, cx, cy, apex_y, m, seed):
    """M3: m seeded area-weighted roots inside the slit strip.

    Same barycentric sampler + outward-face-normal convention as
    poisson_roots, restricted to strip faces, with the same 0.5 mm slit
    rejection. Deterministic on seed (the caller passes seed+SEED_OFFSET so
    the base poisson stream is untouched).
    """
    area, cent = _part_face_areas(verts, faces)
    half = PART_FILL["FILL_RADIUS_MM"] / 1000.0
    keep = np.nonzero((np.abs(cent[:, 0]) < half) & (cent[:, 1] < apex_y))[0]
    assert len(keep) > 0
    A = verts[faces[:, 0]][keep]
    Bm = verts[faces[:, 1]][keep]
    Cm = verts[faces[:, 2]][keep]
    e1 = Bm - A
    e2 = Cm - A
    nrm = np.cross(e1, e2)
    fa = 0.5 * np.linalg.norm(nrm, axis=1)
    fa[fa <= 1e-18] = 1e-18
    fn = nrm / (2.0 * fa)[:, None]
    cc = (A + Bm + Cm) / 3.0
    ref = np.stack([cc[:, 0] - cx, cc[:, 1] - cy,
                    np.full(len(cc), 0.05)], axis=1)
    flip = (fn * ref).sum(axis=1) < 0.0
    fn[flip] *= -1.0
    tot = float(fa.sum())
    cum = np.cumsum(fa)
    rng = np.random.default_rng(seed)
    got_p, got_f = [], []
    while sum(len(g) for g in got_p) < m:
        b = max(m * 2, 1024)
        u = rng.random(b) * tot
        fi = np.minimum(np.searchsorted(cum, u, side="left"), len(cum) - 1)
        s = rng.random(b)
        tt = rng.random(b)
        sq = np.sqrt(s)
        w0 = 1.0 - sq
        w1 = sq * (1.0 - tt)
        w2 = sq * tt
        cand = w0[:, None] * A[fi] + w1[:, None] * Bm[fi] + w2[:, None] * Cm[fi]
        keepm = ~((np.abs(cand[:, 0]) < SLIT_HALF_M) & (cand[:, 1] < apex_y))
        idx = np.nonzero(keepm)[0][:m - sum(len(g) for g in got_p)]
        got_p.append(cand[idx])
        got_f.append(fi[idx])
    return (np.concatenate(got_p, axis=0)[:m],
            fn[np.concatenate(got_f, axis=0)[:m]])


def root_density_bins(roots, verts, faces):
    """M1: root density per cm^2 in 2 mm |x| bins out to 20 mm.

    Bin area = cap faces whose centroid |x| falls in the bin (all y).
    Cap average = len(roots)/total cap area.
    """
    area, cent = _part_face_areas(verts, faces)
    ax = np.abs(np.asarray(roots, dtype=np.float64)[:, 0])
    cx_ = np.abs(cent[:, 0])
    out = []
    for lo_mm in range(0, 20, 2):
        lo, hi = lo_mm / 1000.0, (lo_mm + 2) / 1000.0
        cnt = int(((ax >= lo) & (ax < hi)).sum())
        a = float(area[(cx_ >= lo) & (cx_ < hi)].sum())
        out.append({"binMm": [float(lo_mm), float(lo_mm + 2)], "count": cnt,
                    "areaCm2": a * 1e4,
                    "densityPerCm2": (cnt / (a * 1e4)) if a > 0 else 0.0})
    return out, float(len(roots) / (float(area.sum()) * 1e4))


def _arc_of(kids):
    seg = np.diff(kids, axis=1)
    seglen = np.linalg.norm(seg, axis=2)
    return np.concatenate([np.zeros((len(kids), 1)),
                           np.cumsum(seglen, axis=1)], axis=1)


def lateral_medians(kids, roots_cap):
    """M1: for children rooted within 10 mm of the slit plane, median |x| at
    arc 5/10/20/30 mm, grouped by root-distance bin. Linear interpolation
    along each strand's cumulative arc length."""
    kids = np.asarray(kids, dtype=np.float64)
    roots_cap = np.asarray(roots_cap, dtype=np.float64)
    ax = np.abs(kids[:, :, 0])
    cum = _arc_of(kids)
    rd = np.abs(roots_cap[:, 0])
    out = []
    for lo_mm in range(0, 10, 2):
        lo, hi = lo_mm / 1000.0, (lo_mm + 2) / 1000.0
        idx = np.nonzero((rd >= lo) & (rd < hi))[0]
        row = {"rootBinMm": [float(lo_mm), float(lo_mm + 2)],
               "n": int(len(idx))}
        for tag, at in (("medAt05mm", 0.005), ("medAt10mm", 0.010),
                        ("medAt20mm", 0.020), ("medAt30mm", 0.030)):
            if len(idx) == 0:
                row[tag] = 0.0
                continue
            vals = np.empty(len(idx))
            for k, i in enumerate(idx):
                vals[k] = float(np.interp(at, cum[i], ax[i]))
            row[tag] = float(np.median(vals) * 1000.0)
        out.append(row)
    return out


def ridge_stats(kids, roots_cap, root_nor, apex_y):
    """G4: for children rooted within 10 mm of the slit (front of the apex),
    max rise above the lifted-root plane over arc 0-40 mm.

    Rise = max(0, dot(point - (root_cap + LIFT*nor), nor)): the lifted root
    (LIFT above the cap) is the strand's scalp reference, so a strand that
    only falls from its root scores 0 and a standing ridge scores its height
    above the root. This is the operational "no ridge" reading of "max
    clearance above the scalp": the 3 mm root lift is common to every strand
    (blend.py LIFT) and only rise above it can form a visible ridge."""
    kids = np.asarray(kids, dtype=np.float64)
    roots_cap = np.asarray(roots_cap, dtype=np.float64)
    root_nor = np.asarray(root_nor, dtype=np.float64)
    sel = ((np.abs(roots_cap[:, 0]) < 0.010)
           & (roots_cap[:, 1] < apex_y))
    idx = np.nonzero(sel)[0]
    if len(idx) == 0:
        return {"n": 0, "nNoScalp": 0, "fracLe6mm": 1.0, "p50mm": 0.0,
                "p99mm": 0.0, "maxmm": 0.0}
    cum = _arc_of(kids)
    lifted = roots_cap[idx] + root_nor[idx] * LIFT
    mx = np.empty(len(idx))
    for k, i in enumerate(idx):
        d = (kids[i] - lifted[k]) * root_nor[i]
        clr = d.sum(axis=1)
        m = cum[i] <= 0.040
        mx[k] = float(clr[m].max()) if m.any() else 0.0
    mx = np.maximum(mx, 0.0)
    return {"n": int(len(idx)), "nNoScalp": 0,
            "fracLe6mm": float((mx <= 0.006).mean()),
            "p50mm": float(np.median(mx) * 1000.0),
            "p99mm": float(np.percentile(mx, 99) * 1000.0),
            "maxmm": float(mx.max() * 1000.0)}


def blend_children(guides, cap, n, seed=0, meta=None, part_closure=False,
                   part_fill=False):
    """hair-part-1 entry point (M2 lateral closure, M3 root fill).

    part_closure/part_fill False/False is bit-identical to blend.py: the base
    poisson stream on seed is untouched (fill draws the base roots itself on
    seed, then extra roots on seed+SEED_OFFSET; closure adds no RNG).
    """
    override = None
    if part_fill:
        verts, faces, apex_y, cx, cy, _sl, _fh = cap_parts(cap)
        n_extra, _finfo = _part_extra_count(verts, faces, apex_y, n)
        if n_extra > 0:
            b_roots, b_nor, pinfo = poisson_roots(verts, faces, cx, cy,
                                                  apex_y, n, seed)
            e_roots, e_nor = _sample_strip_roots(
                verts, faces, cx, cy, apex_y, n_extra,
                (seed + PART_FILL["SEED_OFFSET"]) & 0xFFFFFFFF)
            pinfo = dict(pinfo, part_n_extra=int(n_extra))
            override = (np.concatenate([b_roots, e_roots], axis=0),
                        np.concatenate([b_nor, e_nor], axis=0), pinfo)
    return _blend_children_base(
        guides, cap, n + (len(override[0]) - n if override is not None else 0),
        seed, meta, _roots_override=override,
        _closure_on=bool(part_closure))


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


# ------------------------------------------------- hair-part-1 cells (Blender side)

CELL_FLAGS = {"C0": (False, False), "C1": (True, False),
              "C2": (False, True), "C3": (True, True)}


def _centre_gap_widths(id_path, centre=512, row_lo=0, row_hi=1024):
    """Centre-containing non-hair gap width per row of an ID mask.

    hair = alpha >= 0.5 (same encoding as _render_id emission/holdout).
    Rows where the centre pixel itself is hair contribute no gap.
    Returns (widths_px list, rows list). Pure numpy+Pillow; no bpy.
    """
    from PIL import Image as _PILImage
    a = np.asarray(_PILImage.open(id_path).convert("RGBA"),
                   dtype=np.float64) / 255.0
    hair = a[..., 3] > 0.5
    H, W = hair.shape
    c = min(max(int(centre), 0), W - 1)
    widths, rows = [], []
    for y in range(max(int(row_lo), 0), min(int(row_hi), H)):
        row = hair[y]
        if not row.any():
            continue
        if row[c]:
            continue
        lo = c
        while lo - 1 >= 0 and not row[lo - 1]:
            lo -= 1
        hi = c
        while hi + 1 < W and not row[hi + 1]:
            hi += 1
        widths.append(int(hi - lo + 1))
        rows.append(int(y))
    return widths, rows


def _px_per_m_at(handle, apex_y, crown_z):
    """Pixels per metre at the part under the CURRENT camera (Blender side)."""
    import bpy
    from bpy_extras.object_utils import world_to_camera_view
    from mathutils import Vector as _V
    scene = bpy.context.scene
    cam = handle.camera
    W = int(scene.render.resolution_x)
    p0 = world_to_camera_view(scene, cam, _V((0.0, apex_y, crown_z)))
    p1 = world_to_camera_view(scene, cam, _V((0.001, apex_y, crown_z)))
    return abs(float(p1.x) - float(p0.x)) * W / 0.001


def _summarize_widths(widths, px_per_m):
    import numpy as _np
    w = _np.asarray(widths, dtype=np.float64)
    if len(w) == 0:
        return {"bandPx": 0.0, "bandP90Px": 0.0, "bandMaxPx": 0,
                "bandMm": 0.0, "bandP90Mm": 0.0, "bandMaxMm": 0.0,
                "pxPerM": float(px_per_m)}
    return {"bandPx": float(_np.median(w)),
            "bandP90Px": float(_np.percentile(w, 90)),
            "bandMaxPx": int(w.max()),
            "bandMm": float(_np.median(w) / px_per_m * 1000.0),
            "bandP90Mm": float(_np.percentile(w, 90) / px_per_m * 1000.0),
            "bandMaxMm": float(w.max() / px_per_m * 1000.0),
            "pxPerM": float(px_per_m)}


def run_cell(guides_path, out_dir, cell):
    """One M4 cell at pass-B scale (front + crown_top, 1024, with ID masks).

    cell in C0..C3 selects PART flags per CELL_FLAGS. M1 measurements
    (root bins, lateral medians, ridge, crown/front bands) and the judge-v3
    score (landmarks 103,583,512) plus the M5 ID-mask show-through are
    recorded to blend_part-<cell>.json. No shrinkwrap/collision passes: the
    card studies the part, and blend-1 kept raw on guides6.
    """
    import bpy
    assert cell in CELL_FLAGS, cell
    part_closure, part_fill = CELL_FLAGS[cell]
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
    gdata = np.load(str(guides_path))
    capd = np.load(str(CAP_DEFAULT))
    G, R = guide_parts(gdata)
    _vv, _ff, apex_y, cx, cy, _sl, _fh = cap_parts(capd)
    crown_z = float(np.asarray(gdata["crown_z"]))
    n_req = N_B
    radius = 0.00005

    meta1 = {}
    kids1 = blend_children(gdata, capd, n_req, SEED, meta1,
                           part_closure=part_closure, part_fill=part_fill)
    t_gen = meta1["seconds_total"]
    kids2 = blend_children(gdata, capd, n_req, SEED, None,
                           part_closure=part_closure, part_fill=part_fill)
    h1, h2 = sha256_of(kids1), sha256_of(kids2)
    print("CELL %s hash=%s equal=%s n=%d" % (
        cell, h1[:16], h1 == h2, len(kids1)), flush=True)
    nan_count = int(np.isnan(kids1).sum())
    flat = kids1.reshape(-1, 3)
    cross, near = _g3_crossings(flat, apex_y, crown_z)

    bins, avg = root_density_bins(meta1["roots_cap"], _vv, _ff)
    lat = lateral_medians(kids1, meta1["roots_cap"])
    ridge = ridge_stats(kids1, meta1["roots_cap"], meta1["root_nor"],
                        apex_y)

    obj = build_blend_curves(handle, cap, kids1, "UVMap", "part" + cell)
    prof_mod, prof_rb = add_profile(c3, obj, groups, radius)
    rad = eval_radius_minmax(obj)
    print("RADIUS %s" % json.dumps(rad, sort_keys=True), flush=True)
    ev = evaluated_points_world(obj)
    assert ev["n"] == len(kids1), (ev["n"], len(kids1))
    ev_diff = float(np.abs(ev["points"] - flat).max())
    print("EVAL_DIFF_MAX %.3e" % ev_diff, flush=True)

    visible = apply_r4_visibility(handle, obj)
    old_hair = handle.hair
    handle.hair = obj
    cdir = out_dir / ("cell" + cell)
    cdir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    renders = {}
    for view in PART_VIEWS:
        c3.set_final_view(handle, view)
        beauty = cdir / (view + ".png")
        id_path = cdir / (view + "-id.png")
        scene.render.resolution_x = scene.render.resolution_y = 1024
        scene.cycles.samples = 64
        scene.cycles.seed = 0
        scene.render.film_transparent = False
        scene.render.filepath = str(beauty)
        bpy.ops.render.render(write_still=True)
        hs._render_id(handle, id_path, 1024)
        bpy.context.view_layer.update()
        renders[view] = {"png": str(beauty), "id_png": str(id_path)}
        print("RENDERED_CELL %s/%s" % (cell, view), flush=True)

    sil_path = out_dir / "cap-silhouette-part.png"
    c3.render_cap_silhouette(handle, cap, sil_path)

    c3.set_final_view(handle, "crown_top")
    bpy.context.view_layer.update()
    crown_ppm = _px_per_m_at(handle, apex_y, crown_z)
    cw, _crows = _centre_gap_widths(renders["crown_top"]["id_png"])
    crown_band = _summarize_widths(cw, crown_ppm)
    c3.set_final_view(handle, "front")
    bpy.context.view_layer.update()
    front_ppm = _px_per_m_at(handle, apex_y, crown_z)
    fw, brows = _centre_gap_widths(renders["front"]["id_png"],
                                   row_lo=80, row_hi=220)
    front_band = _summarize_widths(fw, front_ppm)
    import numpy as _np2
    front_band = dict(front_band)
    front_band["partRow"] = (int(_np2.median(brows)) if brows else None)
    front_band["centre"] = 512
    front_band["frontPxPerM"] = float(front_ppm)

    sys.path.insert(0, str(JUDGE_DIR))
    import importlib.util as _ilu
    _spec = _ilu.spec_from_file_location("hair_judge",
                                         JUDGE_DIR / "hair_judge.py")
    hj = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(hj)
    jdir = out_dir / ("judge-" + cell)
    jdir.mkdir(parents=True, exist_ok=True)
    j = hj.judge(renders["front"]["png"], renders["front"]["id_png"],
                 "part-" + cell, "103,583,512", str(jdir))

    _here = Path(__file__).resolve().parent
    _sspec = _ilu.spec_from_file_location("show_through_id",
                                          _here / "show_through_id.py")
    stid = _ilu.module_from_spec(_sspec)
    _sspec.loader.exec_module(stid)
    idr = stid.show_through_id(renders["front"]["id_png"], 103, 583, 512)
    handle.hair = old_hair

    metrics = {
        "cell": cell, "partClosure": bool(part_closure),
        "partFill": bool(part_fill), "requested": n_req,
        "evaluatedCurveCount": ev["n"],
        "pointsPerCurve": P, "nanCount": nan_count,
        "sha256": h1, "sha256_twice_equal": bool(h1 == h2),
        "crossings": cross, "nearSlitPoints": near,
        "rootDensityBins": bins, "capAveragePerCm2": avg,
        "lateral": lat, "ridge": ridge,
        "crownBand": crown_band, "frontBand": front_band,
        "judge": {"partPx": j.get("part_ours_px"), "iou": j.get("iou"),
                  "widthRms": j.get("width_rms"),
                  "eyeOurs": (j.get("openings", {}).get("eye", {})
                              .get("ours")),
                  "judgeShow": j.get("show_through", {}).get("fraction")},
        "idShow": idr,
        "radiusMinMax": rad, "renders": renders,
        "silhouette": str(sil_path), "visible": visible,
        "capInfo": cap_info, "radius": radius,
        "crownZ": crown_z, "apexY": apex_y,
        "generatorMeta": {
            "fallback_all": meta1["fallback_all"],
            "fallback_count": meta1["fallback_count"],
            "attempts": meta1["attempts"],
            "tipFactorMean": meta1["tipFactorMean"],
            "part_n_extra": meta1.get("part_n_extra", 0),
            "part_close": meta1.get("part_close", {}),
            "seconds_locate": meta1["seconds_locate"]},
        "evalDiffMax": ev_diff,
        "generatorSeconds": t_gen,
        "wallSeconds": time.perf_counter() - t_start,
    }
    with (out_dir / ("blend_part-%s.json" % cell)).open("w") as stream:
        json.dump(metrics, stream, indent=2)
    bpy.ops.wm.save_as_mainfile(
        filepath=str(out_dir / ("blend_part-%s.blend" % cell)))
    print("CELL_DONE %s curves=%d part=%s idshow=%.4f" % (
        cell, ev["n"], j.get("part_ours_px"), idr["fraction"]), flush=True)


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

# ------------------------------------------------- hair-part-1 assembly (system python)

PART_PACK_MASKS = [
    ("search1", "/Users/patrick/.grok/worktrees/src-openclinxr/hair-search/tools/openclinxr/evidence/hair-search/best-1024-id.png"),
    ("search2", "/Users/patrick/.grok/worktrees/src-openclinxr/hair-search2/tools/openclinxr/evidence/hair-search2/best-1024-id.png"),
    ("length15", "/Users/patrick/.grok/worktrees/src-openclinxr/hair-length2/tools/openclinxr/evidence/hair-length/length2-1.5x-id.png"),
    ("attach", "/Users/patrick/.grok/worktrees/src-openclinxr/hair-nodes/tools/openclinxr/evidence/hair-nodes/C1/front-id.png"),
    ("packdup", "/Users/patrick/.grok/worktrees/src-openclinxr/hair-guides/tools/openclinxr/evidence/hair-guides/G0/front-id.png"),
]


def run_assemble_part(out_dir):
    """Build row-part.json (M1 diagnosis + per-cell numbers) and part-sheet.png."""
    import importlib.util as _ilu
    out_dir = Path(out_dir)
    from PIL import Image as PILImage
    from PIL import ImageDraw
    _here = Path(__file__).resolve().parent
    _sspec = _ilu.spec_from_file_location("show_through_id",
                                          _here / "show_through_id.py")
    stid = _ilu.module_from_spec(_sspec)
    _sspec.loader.exec_module(stid)

    cells = {}
    for cell in ("C0", "C1", "C2", "C3"):
        m = json.load(open(out_dir / ("blend_part-%s.json" % cell)))
        jj = json.load(open(out_dir / ("judge-" + cell)
                            / ("part-" + cell + ".json")))
        eye = ((jj.get("openings") or {}).get("eye") or {}).get("ours")
        cells[cell] = {
            "flags": {"partClosure": m["partClosure"],
                      "partFill": m["partFill"]},
            "requested": m["requested"],
            "evaluatedCurveCount": m["evaluatedCurveCount"],
            "pointsPerCurve": m["pointsPerCurve"],
            "nanCount": m["nanCount"],
            "sha256": m["sha256"],
            "sha256_twice_equal": m["sha256_twice_equal"],
            "crossings": m["crossings"],
            "nearSlitPoints": m["nearSlitPoints"],
            "ridge": m["ridge"],
            "crownBand": m["crownBand"],
            "frontBand": m["frontBand"],
            "partPx": jj.get("part_ours_px"),
            "iou": jj.get("iou"),
            "widthRms": jj.get("width_rms"),
            "eyeOurs": eye,
            "judgeShow": (jj.get("show_through") or {}).get("fraction"),
            "idShow": m["idShow"]["fraction"],
            "idShowRegion": m["idShow"]["region_px"],
            "generatorMeta": m["generatorMeta"],
        }

    c0 = json.load(open(out_dir / "blend_part-C0.json"))
    diagnosis = {
        "rootDensityBinsPerCm2": c0["rootDensityBins"],
        "capAveragePerCm2": c0["capAveragePerCm2"],
        "lateralMedMm": c0["lateral"],
        "crownBandMm": {"bandPx": c0["crownBand"]["bandPx"],
                        "bandP90Px": c0["crownBand"]["bandP90Px"],
                        "bandMaxPx": c0["crownBand"]["bandMaxPx"],
                        "bandMm": c0["crownBand"]["bandMm"],
                        "bandP90Mm": c0["crownBand"]["bandP90Mm"],
                        "bandMaxMm": c0["crownBand"]["bandMaxMm"],
                        "pxPerM": c0["crownBand"]["pxPerM"]},
        "frontBandMm": {"bandPx": c0["frontBand"]["bandPx"],
                        "partRow": c0["frontBand"]["partRow"],
                        "centre": c0["frontBand"]["centre"],
                        "bandMm": c0["frontBand"]["bandMm"]},
    }

    pack = []
    for name, path in PART_PACK_MASKS:
        try:
            r = stid.show_through_id(path, 103, 583, 512)
            pack.append({"name": name, "path": path, "idShow": r})
        except Exception as err:
            pack.append({"name": name, "path": path,
                         "unreadable": str(err)[:200]})

    row = {"schemaVersion": 1, "slice": "hair-part-1",
           "guides": "tools/openclinxr/evidence/hair-guides6/guides6.npz",
           "station": "tools/openclinxr/evidence/hair-part/blend_part.py",
           "landmarks": "103,583,512",
           "partClosure": PART_CLOSURE, "partFill": PART_FILL,
           "d1_diagnosis": diagnosis, "cells": cells, "packIdShow": pack}
    with (out_dir / "row-part.json").open("w") as stream:
        json.dump(row, stream, indent=2)

    col_w = 320
    front_h, crown_s = 280, 320
    top_h, mid_h = 24, 24
    sheet = PILImage.new("RGB", (col_w * 4, top_h + front_h + mid_h + crown_s),
                         (18, 18, 18))
    d = ImageDraw.Draw(sheet)
    for ci, cell in enumerate(("C0", "C1", "C2", "C3")):
        m = json.load(open(out_dir / ("blend_part-%s.json" % cell)))
        cc = cells[cell]
        front = PILImage.open(
            m["renders"]["front"]["png"]).convert("RGB").crop(
                (352, 20, 672, 300))
        crown = PILImage.open(
            m["renders"]["crown_top"]["png"]).convert("RGB").resize(
                (crown_s, crown_s), PILImage.LANCZOS).crop(
                (0, 0, col_w, crown_s))
        x0 = ci * col_w
        d.text((x0 + 6, 4),
               "%s part %s px band %.3f mm id %.3f" % (
                   cell, cc["partPx"], cc["crownBand"]["bandMm"],
                   cc["idShow"]), fill=(255, 255, 0))
        sheet.paste(front, (x0, top_h))
        d.text((x0 + 6, top_h + front_h + 4),
               "%s crown IoU %.3f w %.3f" % (
                   cell, cc["iou"], cc["widthRms"]), fill=(255, 255, 255))
        sheet.paste(crown, (x0, top_h + front_h + mid_h))
    sheet.save(out_dir / "part-sheet.png", compress_level=1)
    print("ASSEMBLE_PART_DONE " + json.dumps(
        {k: {"part": v["partPx"], "idshow": round(v["idShow"], 4),
             "iou": round(v["iou"], 4)} for k, v in cells.items()},
        sort_keys=True))


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


def main_part_legacy():
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
        ap.add_argument("--cell", choices=("C0", "C1", "C2", "C3"),
                        required=True)
        ap.add_argument("--part-closure", choices=("on", "off"),
                        required=True)
        ap.add_argument("--part-fill", choices=("on", "off"), required=True)
        a = ap.parse_args(argv)
        want = CELL_FLAGS[a.cell]
        got = (a.part_closure == "on", a.part_fill == "on")
        assert got == want, (got, want, a.cell)
        run_cell(a.guides, a.out, a.cell)
    else:
        ap = argparse.ArgumentParser()
        ap.add_argument("--phase",
                        choices=("assemble", "assemble-part"),
                        required=True)
        ap.add_argument("--out", default=str(E_DEFAULT))
        a = ap.parse_args()
        if a.phase == "assemble":
            run_assemble(a.out)
        elif a.phase == "assemble-part":
            run_assemble_part(a.out)


if __name__ == "__main__" and False:
    main_scalp()  # entry guard lives at the end of the file (appended scalp block)
# ---------------- hair-scalp-1 additions (M2/M3/M4; geometry path untouched) ----------------
# COPY-AND-MUTATE of blend_part.py: every generator symbol above (blend_children,
# poisson roots, closure/fill, profile/shrinkwrap builders, visibility, judge
# plumbing) is reused byte-for-byte. New code here changes MATERIALS and LIGHT
# only. All four cells use part_closure=True + part_fill=True (PT C3 geometry);
# G1 asserts the child-array sha256 equals PT C3's in every cell.

SCALP_VIEWS = ("front", "three_quarter", "profile_90", "crown_top")
PT_C3_SHA = "ba151b15262cf983058c8a89b63c672eb0daab25708bfd00711f75c7abdd4a3b"
SCALP_MASK_ATTR = "OCLX_scalp_mask"
SCALP_MIX = 0.65
SCALP_ROUGH = 0.9
# M3: melanin/roughness up from S2 (0.851/0.141) in 3 steps toward P1.
# Melanin is a 0..1 parameter (values >1 brighten: verified 2026-10-13, the
# S0-S2 run above with melanin 1.1-2.0 raised p50 and greyed R/B to 1.02).
SHADE_STEPS = (
    {"melanin": 0.90, "redness": 0.80, "roughness": 0.25, "radial": 0.30, "coat": 0.0},
    {"melanin": 0.93, "redness": 0.80, "roughness": 0.32, "radial": 0.35, "coat": 0.0},
    {"melanin": 0.96, "redness": 0.80, "roughness": 0.40, "radial": 0.35, "coat": 0.0},
)
# M4: 12-evaluation coordinate search grid (4 elev x 3 energy factors).
KEY_SEARCH_ELEV = (25.0, 35.0, 45.0, 55.0)
KEY_SEARCH_EFAC = (0.7, 1.0, 1.3)
KEY_SEARCH_P50 = 0.078
KEY_SEARCH_P90 = 0.159


def _smoothstep01(t):
    t = min(max(float(t), 0.0), 1.0)
    return t * t * (3.0 - 2.0 * t)


def scalp_photo_metrics(beauty_path, id_path):
    """Hair-mask luminance p10/p50/p90 + R/B + redness, part band, face/bg/forehead.

    Landmark-free definitions (applied identically to every cell):
    - hair = ID coverage >= 0.9; luminance = Rec.709.
    - face-top r* = topmost row in [120,400) where cols centre+-30 mean cov < 0.2.
    - part band = rows [110,r*) x cols centre+-15 (between hairline and crown).
    - face skin = non-hair pixels rows [r*,583) x cols centre+-150.
    - background = 10 px image frame. forehead = rows [r*+11,r*+33) x cols +-30
      (5-15 mm outside the hairline at the ~2143 px/m front scale).
    Pure numpy+Pillow; no bpy (runs in-Blender and in system python).
    """
    from PIL import Image as _PIL
    import numpy as _np
    rgb = _np.asarray(_PIL.open(beauty_path).convert("RGB")).astype(_np.float64) / 255.0
    L = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    im = _PIL.open(id_path)
    if im.mode == "RGBA":
        cov = _np.array(im)[:, :, 3].astype(_np.float64) / 255.0
    else:
        cov = _np.array(im.convert("L")).astype(_np.float64) / 255.0
    hair = cov >= 0.9
    hl = L[hair]
    cw = cov.shape[1] // 2
    m = cov[120:400, cw - 30:cw + 31].mean(1)
    rs = _np.nonzero(m < 0.2)[0]
    rstar = int(rs[0]) + 120 if len(rs) else 264
    band = L[110:rstar, cw - 15:cw + 16]
    p50 = float(_np.percentile(hl, 50))
    R = float(rgb[..., 0][hair].mean())
    B = float(rgb[..., 2][hair].mean())
    sk = cov[rstar:583, cw - 150:cw + 151] < 0.5
    skin = L[rstar:583, cw - 150:cw + 151][sk]
    bg = _np.concatenate([L[:10, :].ravel(), L[-10:, :].ravel(),
                          L[:, :10].ravel(), L[:, -10:].ravel()])
    fb = L[rstar + 11:rstar + 33, cw - 30:cw + 31]
    return {
        "p10": float(_np.percentile(hl, 10)), "p50": p50,
        "p90": float(_np.percentile(hl, 90)),
        "RB": float(R / B), "redness": float(R - B),
        "partBand": float(band.mean()),
        "partBandRatio": float(float(band.mean()) / p50),
        "faceTopRow": int(rstar), "faceSkin": float(skin.mean()),
        "bgMean": float(bg.mean()), "forehead": float(fb.mean()),
        "hairPx": int(hair.sum()),
    }


def _sock(node, name):
    """Socket by .name (RNA [] lookup keys on identifier, which differs for
    some built-in sockets, e.g. hair "Color")."""
    for s in node.inputs:
        if s.name == name:
            return s
    raise KeyError("socket %r not in %s" % (name, node.name))


def apply_scalp_undertone(handle, cap_verts, mix=SCALP_MIX):
    """M2: node-mask undertone on the head material (no image-file edits).

    Mask attribute OCLX_scalp_mask on OCLX_Aisha_head = 1 on the cap footprint
    (head verts within 2 mm of the cap surface), smooth falloff to 0 at 8 mm.
    Mixes Base Color toward the hair shader's current root colour at 65% and
    mixes Roughness toward 0.9. Returns footprint + node record.
    """
    import bpy
    import numpy as np
    from mathutils import Vector
    from mathutils.kdtree import KDTree
    head = handle.head
    cv = np.asarray(cap_verts, dtype=np.float64)
    mw = head.matrix_world
    nv = len(head.data.vertices)
    hv = np.empty((nv, 3))
    for i, v in enumerate(head.data.vertices):
        hv[i] = tuple(mw @ v.co)
    kd = KDTree(len(cv))
    for i, p in enumerate(cv):
        kd.insert(Vector((float(p[0]), float(p[1]), float(p[2]))), i)
    kd.balance()
    dmin = np.empty(nv)
    for i in range(nv):
        _co, _ix, dist = kd.find(Vector((float(hv[i, 0]), float(hv[i, 1]), float(hv[i, 2]))))
        dmin[i] = dist
    mask = 1.0 - np.array([_smoothstep01((d - 0.002) / 0.006) for d in dmin])
    attr = head.data.attributes.get(SCALP_MASK_ATTR)
    if attr is None:
        attr = head.data.attributes.new(SCALP_MASK_ATTR, "FLOAT", "POINT")
    for i in range(nv):
        attr.data[i].value = float(mask[i])
    faces_in = 0
    area = 0.0
    for p in head.data.polygons:
        dd = np.array([dmin[i] for i in p.vertices])
        if bool((dd <= 0.002).all()):
            vs = np.array([hv[i] for i in p.vertices])
            ar = 0.5 * np.linalg.norm(np.cross(vs[1] - vs[0], vs[2] - vs[0]))
            if len(vs) > 3:
                ar += 0.5 * np.linalg.norm(np.cross(vs[2] - vs[0], vs[3] - vs[0]))
            faces_in += 1
            area += ar
    hmat = handle.hair.data.materials.get("OCLX_hair_dark")
    hnode = hmat.node_tree.nodes.get("Principled Hair BSDF")
    if hnode is None:
        hnode = next(x for x in hmat.node_tree.nodes if x.type == "BSDF_HAIR_PRINCIPLED")
    try:
        root_col = tuple(float(x) for x in _sock(hnode, "Color").default_value)[:3]
    except KeyError:
        print("UNDERTONE_DIAG hmat=%s hnode=%s inputs=%s" % (
            hmat.name, hnode.name, [i.name for i in hnode.inputs]), flush=True)
        raise
    mat = head.data.materials[0]
    skin_mat_name = mat.name
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    base_src = next(iter(_sock(bsdf, "Base Color").links)).from_socket
    rough_src = next(iter(_sock(bsdf, "Roughness").links)).from_socket
    an = nodes.new("ShaderNodeAttribute")
    an.attribute_name = SCALP_MASK_ATTR
    mm = nodes.new("ShaderNodeMath")
    mm.operation = "MULTIPLY"
    mm.inputs[1].default_value = float(mix)
    links.new(an.outputs["Fac"], mm.inputs[0])
    mx = nodes.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    mx.inputs["B"].default_value = (root_col[0], root_col[1], root_col[2], 1.0)
    links.new(base_src, mx.inputs["A"])
    links.new(mm.outputs[0], mx.inputs["Factor"])
    links.new(mx.outputs["Result"], _sock(bsdf, "Base Color"))
    mr = nodes.new("ShaderNodeMix")
    mr.data_type = "FLOAT"
    mr.inputs["B"].default_value = SCALP_ROUGH
    links.new(rough_src, mr.inputs["A"])
    links.new(mm.outputs[0], mr.inputs["Factor"])
    links.new(mr.outputs["Result"], _sock(bsdf, "Roughness"))
    head.data.update_tag()
    bpy.context.view_layer.update()
    return {"attr": SCALP_MASK_ATTR, "mix": float(mix), "rough": SCALP_ROUGH,
            "rootColour": [root_col[0], root_col[1], root_col[2]],
            "skinMaterial": skin_mat_name,
            "footFaces": int(faces_in), "footAreaCm2": float(area * 1e4),
            "maskMean": float(mask.mean())}


def apply_scalp_hair(hs, handle, ov):
    """M3: hair-shading overrides on the shared OCLX_hair_dark material.

    Material sockets only: never hs.apply_params (it rescales handle.hair
    points for the length param, and handle.hair is the blend object here;
    geometry must stay PT-C3-identical)."""
    import bpy
    mat = handle.hair.data.materials.get("OCLX_hair_dark")
    node = mat.node_tree.nodes.get("Principled Hair BSDF")
    if node is None:
        node = next(x for x in mat.node_tree.nodes if x.type == "BSDF_HAIR_PRINCIPLED")
    for key, sock in (("melanin", "Melanin"), ("redness", "Melanin Redness"),
                      ("roughness", "Roughness")):
        if key in ov:
            _sock(node, sock).default_value = float(ov[key])
    if "radial" in ov:
        _sock(node, "Radial Roughness").default_value = float(ov["radial"])
    if "coat" in ov:
        _sock(node, "Coat").default_value = float(ov["coat"])
    mat.update_tag()
    bpy.context.view_layer.update()
    return {"melanin": float(_sock(node, "Melanin").default_value),
            "redness": float(_sock(node, "Melanin Redness").default_value),
            "roughness": float(_sock(node, "Roughness").default_value),
            "radial": float(_sock(node, "Radial Roughness").default_value),
            "coat": float(_sock(node, "Coat").default_value)}


def apply_scalp_key(handle, elev_deg, energy=None):
    """M4: key elevation (+ optional energy) change only."""
    import bpy
    import math
    from mathutils import Vector
    key = handle.lights[0]
    tgt = handle.target
    dx = key.location.x - tgt.x
    dy = key.location.y - tgt.y
    key.location.z = tgt.z + math.hypot(dx, dy) * math.tan(math.radians(float(elev_deg)))
    key.rotation_euler = (Vector((tgt.x, tgt.y, tgt.z)) - key.location).to_track_quat("-Z", "Y").to_euler()
    if energy is not None:
        key.data.energy = float(energy)
    key.data.update_tag()
    bpy.context.view_layer.update()
    return {"elev_deg": float(elev_deg), "energy": float(key.data.energy),
            "key_z": float(key.location.z)}


def _render_pair(c3, hs, handle, view, beauty, idp, size=1024, samples=64):
    import bpy
    c3.set_final_view(handle, view)
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = int(size)
    sc.cycles.samples = int(samples)
    sc.cycles.seed = 0
    sc.render.film_transparent = False
    sc.render.filepath = str(beauty)
    bpy.ops.render.render(write_still=True)
    hs._render_id(handle, idp, int(size))
    bpy.context.view_layer.update()


def _scalp_setup(guides_path):
    c3 = import_children3()
    hs = c3.load_hair_scene()
    handle = hs.build_scene()
    groups = load_groups_blend()
    uv_layer = next((l for l in handle.head.data.uv_layers if l.active_render), None)
    head_uv = uv_layer.name if uv_layer else handle.head.data.uv_layers[0].name
    cap, cap_info = c3.build_cap_surface(handle, head_uv)
    gdata = np.load(str(guides_path))
    capd = np.load(str(CAP_DEFAULT))
    _G, _R = guide_parts(gdata)
    _vv, _ff, apex_y, cx, cy, _sl, _fh = cap_parts(capd)
    crown_z = float(np.asarray(gdata["crown_z"]))
    return c3, hs, handle, groups, cap, cap_info, gdata, capd, apex_y, crown_z


def _scalp_grow(guides_path, capd, apex_y, crown_z):
    meta1 = {}
    kids1 = blend_children(guides_path, capd, N_B, SEED, meta1,
                           part_closure=True, part_fill=True)
    kids2 = blend_children(guides_path, capd, N_B, SEED, None,
                           part_closure=True, part_fill=True)
    h1, h2 = sha256_of(kids1), sha256_of(kids2)
    nan_count = int(np.isnan(kids1).sum())
    flat = kids1.reshape(-1, 3)
    cross, near = _g3_crossings(flat, apex_y, crown_z)
    return kids1, {"sha256": h1, "twice_equal": bool(h1 == h2),
                   "nan": nan_count, "crossings": cross, "nearSlit": near,
                   "n_extra": meta1.get("part_n_extra", 0)}


def run_scalp_cell(guides_path, out_dir, kn, undertone, hair_ov, key_ov, mix=SCALP_MIX):
    """One scalp cell: K0..K3, front/three_quarter/profile/crown_top at 1024."""
    import bpy
    import importlib.util as _ilu
    t_start = time.perf_counter()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    c3, hs, handle, groups, cap, cap_info, gdata, capd, apex_y, crown_z = _scalp_setup(guides_path)
    hair_rb = apply_scalp_hair(hs, handle, dict(hair_ov or {}))
    under = apply_scalp_undertone(handle, capd["verts"], mix) if undertone else None
    key_rb = apply_scalp_key(handle, key_ov["elev_deg"],
                             key_ov.get("energy")) if key_ov else None
    kids1, grow = _scalp_grow(gdata, capd, apex_y, crown_z)
    print("SCALP %s hash=%s ptc3=%s equal=%s n=%d" % (
        kn, grow["sha256"][:16], PT_C3_SHA[:16],
        grow["sha256"] == PT_C3_SHA, len(kids1)), flush=True)
    obj = build_blend_curves(handle, cap, kids1, "UVMap", "scalp" + kn)
    _prof_mod, _prof_rb = add_profile(c3, obj, groups, 0.00005)
    ev = evaluated_points_world(obj)
    assert ev["n"] == len(kids1), (ev["n"], len(kids1))
    visible = apply_r4_visibility(handle, obj)
    old_hair = handle.hair
    handle.hair = obj
    cdir = out_dir / ("cell" + kn)
    cdir.mkdir(parents=True, exist_ok=True)
    renders = {}
    for view in SCALP_VIEWS:
        beauty = cdir / (view + ".png")
        id_path = cdir / (view + "-id.png")
        _render_pair(c3, hs, handle, view, beauty, id_path)
        renders[view] = {"png": str(beauty), "id_png": str(id_path)}
        print("RENDERED_SCALP %s/%s" % (kn, view), flush=True)
    sys.path.insert(0, str(JUDGE_DIR))
    _spec = _ilu.spec_from_file_location("hair_judge", JUDGE_DIR / "hair_judge.py")
    hj = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(hj)
    jdir = out_dir / ("judge-" + kn)
    jdir.mkdir(parents=True, exist_ok=True)
    j = hj.judge(renders["front"]["png"], renders["front"]["id_png"],
                 "scalp-" + kn, "103,583,512", str(jdir))
    _here = Path(__file__).resolve().parent
    stid = None
    try:
        _sspec = _ilu.spec_from_file_location(
            "show_through_id_ref", Path.cwd() / "tools/openclinxr/evidence/hair-part/show_through_id.py")
        stid_mod = _ilu.module_from_spec(_sspec)
        _sspec.loader.exec_module(stid_mod)
        stid = stid_mod
    except Exception:
        stid = None
    idr = stid.show_through_id(renders["front"]["id_png"], 103, 583, 512) if stid else None
    photo = scalp_photo_metrics(renders["front"]["png"], renders["front"]["id_png"])
    handle.hair = old_hair
    rec = {
        "cell": kn, "partClosure": True, "partFill": True,
        "undertone": bool(undertone), "hair": hair_rb,
        "hairRequested": dict(hair_ov or {}), "undertoneRec": under,
        "key": key_rb, "keyRequested": dict(key_ov or {}),
        "requested": N_B, "evaluatedCurveCount": ev["n"],
        "pointsPerCurve": P, "nanCount": grow["nan"],
        "sha256": grow["sha256"], "sha256_twice_equal": grow["twice_equal"],
        "sha256_is_pt_c3": bool(grow["sha256"] == PT_C3_SHA),
        "crossings": grow["crossings"], "nearSlitPoints": grow["nearSlit"],
        "judge": {"partPx": j.get("part_ours_px"), "iou": j.get("iou"),
                  "widthRms": j.get("width_rms"),
                  "judgeShow": (j.get("show_through") or {}).get("fraction")},
        "idShow": (idr["fraction"] if idr else None),
        "idShowRegion": (idr["region_px"] if idr else None),
        "photo": photo, "renders": renders, "visible": visible,
        "wallSeconds": time.perf_counter() - t_start,
    }
    with (out_dir / ("scalp-%s.json" % kn)).open("w") as stream:
        json.dump(rec, stream, indent=2)
    print("SCALP_DONE %s p50=%.4f rb=%.3f band=%.3f part=%s idshow=%s" % (
        kn, photo["p50"], photo["RB"], photo["partBandRatio"],
        j.get("part_ours_px"), idr["fraction"] if idr else None), flush=True)


def run_shade_steps(guides_path, out_dir):
    """M3: K1 base (undertone on, S2 hair) + 3 front-only shading candidates."""
    import bpy
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    c3, hs, handle, groups, cap, cap_info, gdata, capd, apex_y, crown_z = _scalp_setup(guides_path)
    base_rb = apply_scalp_hair(hs, handle, {})
    under = apply_scalp_undertone(handle, capd["verts"])
    kids1, grow = _scalp_grow(gdata, capd, apex_y, crown_z)
    print("SHADE hash=%s ptc3=%s" % (grow["sha256"][:16], PT_C3_SHA[:16]), flush=True)
    obj = build_blend_curves(handle, cap, kids1, "UVMap", "scalpShade")
    add_profile(c3, obj, groups, 0.00005)
    apply_r4_visibility(handle, obj)
    old_hair = handle.hair
    handle.hair = obj
    steps = []
    for i, step in enumerate(SHADE_STEPS):
        rb = apply_scalp_hair(hs, handle, dict(step))
        beauty = out_dir / ("shade-S%d-front.png" % i)
        idp = out_dir / ("shade-S%d-front-id.png" % i)
        _render_pair(c3, hs, handle, "front", beauty, idp)
        m = scalp_photo_metrics(str(beauty), str(idp))
        steps.append({"step": i, "requested": dict(step), "readback": rb,
                      "png": str(beauty), "id_png": str(idp), "photo": m})
        print("SHADE_STEP %d p50=%.4f p90=%.4f rb=%.3f red=%.5f" % (
            i, m["p50"], m["p90"], m["RB"], m["redness"]), flush=True)
    handle.hair = old_hair
    with (out_dir / "shade-steps.json").open("w") as stream:
        json.dump({"base": base_rb, "undertone": under,
                   "sha_is_pt_c3": bool(grow["sha256"] == PT_C3_SHA),
                   "steps": steps}, stream, indent=2)
    print("SHADE_DONE", flush=True)


def run_key_search(guides_path, out_dir, hair_ov, k0face, mix=SCALP_MIX,
                     elevs=None, efacs=None, tag=""):
    """M4: coordinate search on the shaded+undertone base (front only)."""
    import bpy
    import math as _math
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    c3, hs, handle, groups, cap, cap_info, gdata, capd, apex_y, crown_z = _scalp_setup(guides_path)
    apply_scalp_hair(hs, handle, dict(hair_ov or {}))
    apply_scalp_undertone(handle, capd["verts"], mix)
    kids1, grow = _scalp_grow(gdata, capd, apex_y, crown_z)
    obj = build_blend_curves(handle, cap, kids1, "UVMap", "scalpKeySearch")
    add_profile(c3, obj, groups, 0.00005)
    apply_r4_visibility(handle, obj)
    old_hair = handle.hair
    handle.hair = obj
    key = handle.lights[0]
    e0 = float(key.data.energy)
    evals = []
    for elev in (elevs or KEY_SEARCH_ELEV):
        for ef in (efacs or KEY_SEARCH_EFAC):
            rb = apply_scalp_key(handle, elev, e0 * ef)
            beauty = out_dir / ("key-e%g-f%g-front.png" % (elev, ef))
            idp = out_dir / ("key-e%g-f%g-front-id.png" % (elev, ef))
            _render_pair(c3, hs, handle, "front", beauty, idp)
            m = scalp_photo_metrics(str(beauty), str(idp))
            obj_score = abs(_math.log(m["p50"] / KEY_SEARCH_P50)) + abs(_math.log(m["p90"] / KEY_SEARCH_P90))
            feas = abs(m["faceSkin"] - k0face) / k0face <= 0.15
            evals.append({"elev": elev, "efac": ef, "energy": rb["energy"],
                          "p50": m["p50"], "p90": m["p90"], "faceSkin": m["faceSkin"],
                          "obj": obj_score, "feasible": bool(feas),
                          "png": str(beauty)})
            print("KEY_EVAL elev=%g ef=%g p50=%.4f p90=%.4f face=%.4f obj=%.4f feas=%s" % (
                elev, ef, m["p50"], m["p90"], m["faceSkin"], obj_score, feas), flush=True)
    feas = [e for e in evals if e["feasible"]]
    pool = feas or evals
    best = min(pool, key=lambda e: e["obj"])
    best["allFeasible"] = bool(feas)
    handle.hair = old_hair
    with (out_dir / ("key-search%s.json" % tag)).open("w") as stream:
        json.dump({"e0": e0, "k0face": k0face, "mix": float(mix),
                   "hair": dict(hair_ov or {}), "evals": evals, "best": best}, stream, indent=2)
    print("KEY_BEST " + json.dumps({k: best[k] for k in ("elev", "efac", "energy", "obj", "feasible")}, sort_keys=True), flush=True)


def _gate_status(cells, k0photo):
    """G1..G6 over per-cell records (front metrics). Returns dict of gates."""
    g = {}
    g["G1"] = {"measured": " ".join(
        "%s:%s" % (k, "match" if cells[k]["sha256"] == PT_C3_SHA else "CHANGED")
        for k in ("K0", "K1", "K2", "K3")),
        "bar": "child-array sha256 equals PT C3 in every cell",
        "status": "PASS" if all(cells[k]["sha256"] == PT_C3_SHA for k in ("K0", "K1", "K2", "K3")) else "MISS"}
    b = cells["K3"]["photo"] if "K3" in cells else cells["K2"]["photo"]
    bk = "K3" if "K3" in cells else "K2"
    g["G2"] = {"measured": "band ratio %.3f part %s px" % (b["partBandRatio"], cells[bk]["partPx"]),
               "bar": "part band <= 1.6 x hair p50 and part px <= 27",
               "status": "PASS" if (b["partBandRatio"] <= 1.6 and (cells[bk]["partPx"] or 99) <= 27) else "MISS"}
    g["G3"] = {"measured": "p50 %.4f p90 %.4f RB %.3f red %.5f (K0 red %.5f)" % (
        b["p50"], b["p90"], b["RB"], b["redness"], k0photo["redness"]),
        "bar": "p50 in [0.06,0.10], p90 in [0.11,0.20], RB in [1.3,1.7], red <= 0.6xK0",
        "status": "PASS" if (0.06 <= b["p50"] <= 0.10 and 0.11 <= b["p90"] <= 0.20
                             and 1.3 <= b["RB"] <= 1.7 and b["redness"] <= 0.6 * k0photo["redness"]) else "MISS"}
    g["G4"] = {"measured": "face %.4f vs K0 %.4f bg %.4f vs K0 %.4f" % (
        b["faceSkin"], k0photo["faceSkin"], b["bgMean"], k0photo["bgMean"]),
        "bar": "face within +-15% of K0, bg within +-10% of K0",
        "status": "PASS" if (abs(b["faceSkin"] - k0photo["faceSkin"]) / k0photo["faceSkin"] <= 0.15
                             and abs(b["bgMean"] - k0photo["bgMean"]) / k0photo["bgMean"] <= 0.10) else "MISS"}
    bk = "K3" if "K3" in cells else "K2"
    g["G5"] = {"measured": "IoU %.4f ID show %.4f" % (cells[bk]["iou"], cells[bk]["idShow"]),
               "bar": "IoU >= 0.608, ID show-through <= 3.2%",
               "status": "PASS" if (cells[bk]["iou"] >= 0.608 and cells[bk]["idShow"] <= 0.032) else "MISS"}
    g["G6"] = {"measured": "forehead %.4f vs K0 %.4f" % (b["forehead"], k0photo["forehead"]),
               "bar": "forehead 5-15mm outside hairline within +-10% of K0",
               "status": "PASS" if abs(b["forehead"] - k0photo["forehead"]) / k0photo["forehead"] <= 0.10 else "MISS"}
    return g


def run_assemble_scalp(out_dir):
    """O2/O3/O4: row-scalp.json + sheets + best.json (system python)."""
    out_dir = Path(out_dir)
    from PIL import Image as PILImage
    from PIL import ImageDraw
    import importlib.util as _ilu
    _spec = _ilu.spec_from_file_location(
        "hair_judge_asm", JUDGE_DIR / "hair_judge.py")
    hj = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(hj)
    cells = {}
    for kn in ("K0", "K1", "K2", "K3"):
        p = out_dir / ("scalp-%s.json" % kn)
        if not p.exists():
            continue
        m = json.load(open(p))
        jj = json.load(open(out_dir / ("judge-" + kn) / ("scalp-" + kn + ".json")))
        cells[kn] = {
            "undertone": m["undertone"], "hair": m["hair"],
            "hairRequested": m["hairRequested"], "undertoneRec": m.get("undertoneRec"),
            "key": m["key"], "keyRequested": m["keyRequested"],
            "requested": m["requested"], "evaluatedCurveCount": m["evaluatedCurveCount"],
            "pointsPerCurve": m["pointsPerCurve"], "nanCount": m["nanCount"],
            "sha256": m["sha256"], "sha256_twice_equal": m["sha256_twice_equal"],
            "crossings": m["crossings"], "partPx": jj.get("part_ours_px"),
            "iou": jj.get("iou"), "widthRms": jj.get("width_rms"),
            "judgeShow": (jj.get("show_through") or {}).get("fraction"),
            "idShow": m["idShow"], "idShowRegion": m["idShowRegion"],
            "photo": m["photo"], "renders": m["renders"],
        }
    shade = json.load(open(out_dir / "shade-steps.json")) if (out_dir / "shade-steps.json").exists() else None
    keysearch = None
    for _kp in ("key-search.json", "key-search-2.json"):
        if (out_dir / _kp).exists():
            keysearch = json.load(open(out_dir / _kp))
    keysearch1 = json.load(open(out_dir / "key-search.json")) if (out_dir / "key-search.json").exists() else None
    keysearch2 = json.load(open(out_dir / "key-search-2.json")) if (out_dir / "key-search-2.json").exists() else None
    k0photo = cells["K0"]["photo"]
    gates = _gate_status(cells, k0photo)
    best_kn = "K3" if "K3" in cells else "K2"
    best = cells[best_kn]
    row = {"schemaVersion": 1, "slice": "hair-scalp-1",
           "guides": "tools/openclinxr/evidence/hair-guides6/guides6.npz",
           "cap": "tools/openclinxr/evidence/hair-flow/cap-v4.npz",
           "station": "tools/openclinxr/evidence/hair-scalp/scalp.py",
           "landmarks": "103,583,512", "ptC3Sha256": PT_C3_SHA,
           "shadeSteps": SHADE_STEPS, "shadeSearch": shade,
           "keySearch": keysearch, "keySearchAttempt1": keysearch1,
           "keySearchAttempt2": keysearch2, "cells": cells,
           "bestCell": best_kn, "gates": gates}
    with (out_dir / "row-scalp.json").open("w") as stream:
        json.dump(row, stream, indent=2)
    # O2 scalp-sheet: columns K0..K3 x rows [front, part crop native, three_quarter, crown top]
    present = [k for k in ("K0", "K1", "K2", "K3") if k in cells]
    cw = 320
    fh, chh = 280, 320
    th, mh = 24, 24
    sheet = PILImage.new("RGB", (cw * len(present), th + fh + mh + mh + fh + mh + chh), (18, 18, 18))
    d = ImageDraw.Draw(sheet)
    for ci, kn in enumerate(present):
        cc = cells[kn]
        ph = cc["photo"]
        front = PILImage.open(cc["renders"]["front"]["png"]).convert("RGB")
        crop = front.crop((352, 20, 672, 300))
        tq = PILImage.open(cc["renders"]["three_quarter"]["png"]).convert("RGB").resize((cw, fh), PILImage.LANCZOS)
        crown = PILImage.open(cc["renders"]["crown_top"]["png"]).convert("RGB").resize((chh, chh), PILImage.LANCZOS).crop((0, 0, cw, chh))
        x0 = ci * cw
        d.text((x0 + 6, 4), "%s p50 %.3f RB %.2f band %.2f" % (kn, ph["p50"], ph["RB"], ph["partBandRatio"]), fill=(255, 255, 0))
        sheet.paste(front.resize((cw, fh), PILImage.LANCZOS), (x0, th))
        d.text((x0 + 6, th + fh + 4), "%s part band native px" % kn, fill=(255, 255, 255))
        sheet.paste(crop, (x0, th + fh + mh))
        d.text((x0 + 6, th + fh + mh + fh + 4), "%s 3/4 part %s IoU %.3f" % (kn, cc["partPx"], cc["iou"]), fill=(255, 255, 255))
        sheet.paste(tq, (x0, th + fh + mh + fh + mh))
        y4 = th + fh + mh + fh + mh + fh
        sheet2 = PILImage.new("RGB", (cw * len(present), mh + chh), (18, 18, 18))
        d.text((x0 + 6, y4 + 4), "%s crown" % kn, fill=(255, 255, 255))
        sheet.paste(crown, (x0, y4 + mh))
    sheet.save(out_dir / "scalp-sheet.png", compress_level=1)
    # O3 target-vs-scalp
    s3 = 512
    tv = PILImage.new("RGB", (s3 * 4, s3 + 26), (18, 18, 18))
    d = ImageDraw.Draw(tv)
    tf = "/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/target-front.png"
    tp = "/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/target-profile.png"
    panels = [(tf, "target front"), (best["renders"]["front"]["png"], best_kn + " front"),
              (tp, "target profile"), (best["renders"]["profile_90"]["png"], best_kn + " profile")]
    for ci, (p, label) in enumerate(panels):
        tv.paste(PILImage.open(p).convert("RGB").resize((s3, s3), PILImage.LANCZOS), (ci * s3, 26))
        d.text((ci * s3 + 6, 6), label, fill=(255, 255, 0))
    tv.save(out_dir / "target-vs-scalp.png", compress_level=1)
    # O4 best.json (replaces S2 for this groom)
    s2 = json.load(open(Path.cwd() / "tools/openclinxr/evidence/hair-search2/best.json"))["params"]
    bj = {"slice": "hair-scalp-1", "cell": best_kn,
          "replaces": "tools/openclinxr/evidence/hair-search2/best.json",
          "params": {"melanin": best["hair"]["melanin"], "redness": best["hair"]["redness"],
                     "roughness": best["hair"]["roughness"], "radial": best["hair"]["radial"],
                     "coat": best["hair"]["coat"],
                     "key_elev_deg": (best["key"] or {}).get("elev_deg", s2["key_elev_deg"]),
                     "key_energy": (best["key"] or {}).get("energy"),
                     "key_size_m": s2["key_size_m"], "fill_W": s2["fill_W"],
                     "fill_elev_deg": s2["fill_elev_deg"], "rim_W": s2["rim_W"],
                     "worldStrength": 0.4190625, "length": s2["length"]},
          "scalpUndertone": {"attr": SCALP_MASK_ATTR,
                             "mix": (best["undertoneRec"] or {}).get("mix", SCALP_MIX),
                             "rough": SCALP_ROUGH,
                             "rootColour": (best["undertoneRec"] or {}).get("rootColour")},
          "gates": {k: v["status"] for k, v in gates.items()}}
    with (out_dir / "best.json").open("w") as stream:
        json.dump(bj, stream, indent=2)
    print("ASSEMBLE_SCALP_DONE gates=" + json.dumps(
        {k: v["status"] for k, v in gates.items()}, sort_keys=True))


def main_scalp():
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
        ap.add_argument("--cell", choices=("K0", "K1", "K2", "K3"))
        ap.add_argument("--scalp-undertone", choices=("on", "off"), default="off")
        ap.add_argument("--hair-json", default=None)
        ap.add_argument("--key-json", default=None)
        ap.add_argument("--shade-steps", action="store_true")
        ap.add_argument("--key-search", action="store_true")
        ap.add_argument("--k0face", type=float, default=None)
        ap.add_argument("--scalp-mix", type=float, default=SCALP_MIX)
        ap.add_argument("--elev-list", default=None)
        ap.add_argument("--efac-list", default=None)
        ap.add_argument("--search-tag", default="")
        a = ap.parse_args(argv)
        if a.shade_steps:
            run_shade_steps(a.guides, a.out)
        elif a.key_search:
            assert a.hair_json and a.k0face, "key-search needs --hair-json and --k0face"
            run_key_search(a.guides, a.out, json.loads(a.hair_json), a.k0face,
                           a.scalp_mix,
                           [float(x) for x in a.elev_list.split(",")] if a.elev_list else None,
                           [float(x) for x in a.efac_list.split(",")] if a.efac_list else None,
                           a.search_tag)
        else:
            assert a.cell, "--cell required"
            hair_ov = json.loads(a.hair_json) if a.hair_json else {}
            key_ov = json.loads(a.key_json) if a.key_json else None
            run_scalp_cell(a.guides, a.out, a.cell,
                           a.scalp_undertone == "on", hair_ov, key_ov,
                           a.scalp_mix)
    else:
        ap = argparse.ArgumentParser()
        ap.add_argument("--phase", choices=("assemble",), required=True)
        ap.add_argument("--out", default=str(E_DEFAULT))
        a = ap.parse_args()
        run_assemble_scalp(a.out)


if __name__ == "__main__":
    main_scalp()
