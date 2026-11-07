#!/usr/bin/env python3
"""STEP 2 (hair-geo7) Change A: frame-transport lofting for children.

Re-implementation (no third-party code) of the research sketch in
.grok/openclaw/ceo/grok-hair-research/r2.txt Q6 (Butts et al. 2018 procedure +
Iben et al. 2013 frame equations): each child is grown along each of its K
nearest guides by parallel-transporting a frame from the guide root to the
tip (child = guide + root-offset rotated by the transported frame), then the
K lofts are blended with inverse-distance weights. Restricted to same-side
guides, curtain children among curtain guides only.

Why: the old children are a world-space barycentric blend of guide points,
which copies one guide tangent onto every child (over-coherent sheet).
Transporting the frame carries each guide's own direction field into the
child instead.

Length: after blending, each child is rescaled about its root to its
original (a1) arc length -- the production "Length" operator slot -- so the
silhouette/hem is preserved and only the direction field changes.

System python (numpy only). Collider audit is a separate Blender step
(repair.py), reusing the existing base_children.repair_outside.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
GUIDES = ROOT / "tools/openclinxr/evidence/hair-look1/guides16.npz"
CAP = ROOT / "tools/openclinxr/evidence/hair-cap8/cap-v8.npz"
A1 = ROOT / "tools/openclinxr/evidence/hair-real1/cells/a1/strands.npz"


# ---------------------------------------------------------------- frames ---
def _rodrigues(axis: np.ndarray, angle: float) -> np.ndarray:
    k = axis / max(float(np.linalg.norm(axis)), 1e-12)
    K = np.array([[0.0, -k[2], k[1]], [k[2], 0.0, -k[0]], [-k[1], k[0], 0.0]])
    return np.eye(3) + np.sin(angle) * K + (1.0 - np.cos(angle)) * (K @ K)


def _rotate_180(a: np.ndarray) -> np.ndarray:
    # Any 180-deg rotation mapping a -> -a: pick a stable perpendicular axis.
    helper = np.array([1.0, 0.0, 0.0]) if abs(a[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    return _rodrigues(np.cross(a, helper), np.pi)


def transport(points: np.ndarray, scalp_normal: np.ndarray) -> np.ndarray:
    """Bishop-style parallel-transported frames along one guide.

    points (m,3). Returns F (m,3,3), columns [bitangent, tangent, normal-ish];
    column 1 is the tangent.
    """
    edges = np.diff(points, axis=0)
    tangents = edges / np.maximum(np.linalg.norm(edges, axis=1, keepdims=True), 1e-12)
    t0 = tangents[0]
    b0 = np.cross(t0, scalp_normal)
    n = float(np.linalg.norm(b0))
    if n < 1e-12:  # tangent parallel to normal: pick any perpendicular
        helper = np.array([1.0, 0.0, 0.0]) if abs(t0[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
        b0 = np.cross(t0, helper)
        n = float(np.linalg.norm(b0))
    b0 = b0 / n
    n0 = np.cross(b0, t0)
    F = np.empty((len(points), 3, 3))
    F[0] = np.column_stack([b0, t0, n0])
    for i, t in enumerate(tangents, start=1):
        a = F[i - 1][:, 1]
        v = np.cross(a, t)
        c = float(np.dot(a, t))
        s = float(np.linalg.norm(v))
        if s < 1e-12:
            R = np.eye(3) if c > 0 else _rotate_180(a)
        else:
            R = _rodrigues(v / s, np.arctan2(s, c))
        F[i] = R @ F[i - 1]
    return F


# ------------------------------------------------------- curtain replica ---
def curtain_guide_mask(roots: np.ndarray, liftoff: np.ndarray, frontal_drape: np.ndarray,
                       cx: float, cy: float) -> np.ndarray:
    """Replica of base_children.curtain_guide_mask (hair-look1), rev4 rule."""
    az = np.degrees(np.arctan2(np.abs(roots[:, 0] - cx), -(roots[:, 1] - cy)))
    sector = az < 70.0
    lim = np.where(liftoff[:, 0] >= cx, 0.1921 * 0.2107, 0.2004 * 0.2107)
    out = sector & (np.abs(liftoff[:, 0] - cx) >= lim)
    return out | np.asarray(frontal_drape, bool)


def arc_lengths(pts: np.ndarray) -> np.ndarray:
    return np.concatenate([np.zeros((len(pts), 1)),
                           np.cumsum(np.linalg.norm(np.diff(pts, axis=1), axis=2), axis=1)], axis=1)


def smooth01(u: np.ndarray) -> np.ndarray:
    u = np.clip(u, 0.0, 1.0)
    return u * u * (3.0 - 2.0 * u)


# Tip fade: full transported offset at the root (exact attachment), fading to
# the pure guide average at the tip so independently-splaying guide tips
# average back to a vertical hem (the old world-space blend's tip behaviour;
# the end-angle gate measures the last ~5/32 of arc).
FADE_START = 0.6


# ------------------------------------------------- existing end clamp ---
def clamp_ends_vertical(kids: np.ndarray, tail: float = 0.040, blend: float = 0.030,
                        max_deg: float = 0.0) -> np.ndarray:
    """Replica of station.clamp_ends_vertical (hair-look1), strict max_deg=0.

    The accepted groom's 4.6-deg ends come from this op (D1/D2 in hair-geo6
    RESULT): keep the tip xy, pull the last `tail` (40 mm, blended over 30 mm)
    to vertical above the tip. Tip positions (hem/silhouette) are preserved.
    """
    import math as _math
    out = kids.copy()
    for i, p in enumerate(out):
        s = np.r_[0., np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
        L = s[-1]
        anchor = p[np.searchsorted(s, max(0., L - tail))]
        tip = p[-1].copy()
        target_xy = tip[:2].copy()  # strict: zero-slope repair
        n = p.shape[0]
        for j in range(n):
            remain = L - s[j]
            if remain > tail + blend:
                continue
            w = smooth01((tail + blend - remain) / blend) if remain > tail else 1.0
            out[i, j, :2] = (1 - w) * out[i, j, :2] + w * target_xy
    return out


def build(K: int, guides_path: Path | None = None, tag: str | None = None) -> dict:
    gd = np.load(guides_path or GUIDES)
    gpts = np.asarray(gd["points"], float)     # (576,32,3)
    groots = np.asarray(gd["roots"], float)    # (576,3)
    cap = np.load(CAP)
    cx = float(cap["cx"])
    scalp_center = np.array([cx, float(cap["Cy"]), float(cap["Cz"])])
    a1 = np.load(A1)
    croots = np.asarray(a1["roots"], float)
    corig = np.asarray(a1["points"], float)
    radii = np.asarray(a1["radii"])
    apex_y = float(np.asarray(a1["apex_y"]))

    curtain = curtain_guide_mask(groots, np.asarray(gd["liftoff"]),
                                 np.asarray(gd["frontal_drape"]), cx, float(cap["Cy"]))
    print(f"guides={len(gpts)} curtain={curtain.sum()} rear={(~curtain).sum()} cx={cx}", flush=True)

    # Child population: nearer (same-side) curtain-guide root than rear-guide root.
    side_c = croots[:, 0] >= cx
    side_g = groots[:, 0] >= cx
    is_curtain_child = np.zeros(len(croots), bool)
    CH = 4096
    for s in range(0, len(croots), CH):
        take = slice(s, s + CH)
        for side in (False, True):
            ids = np.flatnonzero(side_c[take] == side)
            if not len(ids):
                continue
            gc = np.flatnonzero(curtain & (side_g == side))
            gr = np.flatnonzero(~curtain & (side_g == side))
            dc = np.linalg.norm(croots[take][ids, None, :] - groots[gc][None, :, :], axis=2).min(axis=1)
            dr = np.linalg.norm(croots[take][ids, None, :] - groots[gr][None, :, :], axis=2).min(axis=1)
            is_curtain_child[np.arange(s, s + len(side_c[take]))[ids]] = (dr - dc) >= 0.0
    print(f"children={len(croots)} curtain_region={is_curtain_child.sum()} rear_region={(~is_curtain_child).sum()}", flush=True)

    # Parallel-transported frames for every guide (root normal = outward scalp).
    normals = groots - scalp_center[None, :]
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    F = np.stack([transport(gpts[j], normals[j]) for j in range(len(gpts))]).astype(np.float64)
    F0inv = np.transpose(F[:, 0, :, :], (0, 2, 1))  # F[0].T per guide

    L_orig = arc_lengths(corig)[:, -1]
    out = np.empty_like(corig)
    # Per-guide arc fraction for the tip fade (guides share construction).
    gu = arc_lengths(gpts)
    gu = gu / np.maximum(gu[:, -1, None], 1e-9)
    fade_g = 1.0 - smooth01((gu - FADE_START) / (1.0 - FADE_START))  # (576,32)
    sum_kdist = 0.0
    for s in range(0, len(croots), CH):
        take = np.arange(s, min(s + CH, len(croots)))
        C = len(take)
        near = np.empty((C, K), np.int64)
        w = np.empty((C, K))
        for side in (False, True):
            ids = np.flatnonzero(side_c[take] == side)
            if not len(ids):
                continue
            # per-child population (curtain children among curtain guides)
            for ii in ids:
                pop = np.flatnonzero(((curtain & is_curtain_child[take[ii]])
                                      | (~curtain & ~is_curtain_child[take[ii]])) & (side_g == side))
                d = np.linalg.norm(groots[pop] - croots[take[ii]], axis=1)
                k = min(K, len(pop))
                part = np.argpartition(d, k - 1)[:k]
                order = np.argsort(d[part])
                near[ii, :k] = pop[part[order]]
                dd = d[part[order]]
                if k < K:  # fewer candidates than K: repeat nearest (weight-concentrated)
                    near[ii, k:] = near[ii, 0]
                    dd = np.concatenate([dd, np.full(K - k, dd[0] + 1e-3)])
                wi = 1.0 / np.maximum(dd, 1e-6)
                w[ii] = wi / wi.sum()
                sum_kdist += dd[0]
        G = gpts[near]                                  # (C,K,32,3)
        Fk = F[near]                                    # (C,K,32,3,3)
        delta = np.einsum("ckij,ckj->cki", np.transpose(Fk[:, :, 0, :, :], (0, 1, 3, 2)),
                          croots[take][:, None, :] - groots[near])  # (C,K,3)
        off = np.einsum("ckpij,ckj->ckpi", Fk, delta)               # (C,K,32,3)
        off *= fade_g[near][..., None]                              # tip fade
        lofts = G + off                                             # (C,K,32,3)
        blend = np.einsum("ck,ckpi->cpi", w, lofts)
        blend[:, 0, :] = croots[take]                   # exact root
        Lb = arc_lengths(blend)[:, -1]
        scale = L_orig[take] / np.maximum(Lb, 1e-9)
        out[take] = croots[take][:, None, :] + (blend - croots[take][:, None, :]) * scale[:, None, None]
        print(f"  chunk {s}/{len(croots)}", flush=True)
    out = clamp_ends_vertical(out)  # existing strict end clamp (station.py)

    cell = HERE / "cells" / (tag or f"a_k{K}")
    cell.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cell / "strands_raw.npz",
                        points=out.astype(np.float32), roots=croots.astype(np.float32),
                        radii=radii, apex_y=np.array(apex_y), cx=np.array(cx))
    meta = {"K": K, "method": "frame-transport loft + IDW blend + length-restore",
            "tipFade": f"transported offset x (1 - smoothstep(u; {FADE_START}..1)); tip = pure guide average",
            "meanNearestGuideDistMm": round(float(sum_kdist / len(croots)) * 1000.0, 4),
            "curtainChildren": int(is_curtain_child.sum()), "rearChildren": int((~is_curtain_child).sum()),
            "lengthRestore": "per-strand scale to a1 arc length about the root",
            "guides": "guides16.npz untouched"}
    (cell / "loft_meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"WROTE {cell/'strands_raw.npz'}", flush=True)
    return meta


if __name__ == "__main__":
    import argparse as _ap
    _p = _ap.ArgumentParser()
    _p.add_argument("Ks", nargs="*", default=["3", "5"])
    _p.add_argument("--guides", default=None)
    _p.add_argument("--tag", default=None)
    _a = _p.parse_args()
    for _K in _a.Ks:
        print(f"=== K={_K} ===", flush=True)
        print(json.dumps(build(int(_K),
                               Path(_a.guides) if _a.guides else None,
                               _a.tag), indent=2), flush=True)
