"""Station-owned body-clearance operators (hair-groom16).

Deterministic numpy helpers that push guide/child samples out of the exact
body SDF (hair-cage1/body-exact-sdf.npz: head + ears + body + garments)
along the SDF gradient. Blender has no scipy here, so everything is
pure numpy. Used by:
  - blender_children.py: guide clearance (produce cleared guides) and the
    child outside pass.
  - nothing else edits these guides.

Measured defect this fixes (hair-groom15 RESULT sections 3/6): the guides
themselves sit inside the body (guides-8a skull-SDF min -6.0 mm parietal,
-10.1 mm temple/crown), so every child inherits that penetration and no
Shrinkwrap setting gives depth and collision at once. The fix is upstream:
clear the guides, then build children with no Shrinkwrap and one bounded
outside pass.

Conventions: all public functions take/return world metres; SDF values are
millimetres (negative inside), matching children.sdf_sampler.
"""
from __future__ import annotations

import numpy as np


def sample_mm(sample, pts_m):
    """Signed distance (mm) at world-metre points; NaN outside the grid."""
    vals, inside = sample(np.asarray(pts_m, dtype=np.float64))
    return np.where(inside, vals, np.nan)


def sdf_gradient(sample, pts_m, eps_mm=2.0):
    """Central-difference SDF gradient at world-metre points.

    Returns (grad, ok): grad points toward increasing SDF (outward), ok is
    False where the stencil fell off the grid (component NaNs). Bad rows
    are returned as zero and flagged.
    """
    pts = np.asarray(pts_m, dtype=np.float64)
    grad = np.zeros_like(pts)
    ok = np.ones(len(pts), dtype=bool)
    for ax in range(3):
        d = np.zeros_like(pts)
        d[:, ax] = eps_mm / 1000.0
        v1 = sample_mm(sample, pts + d)
        v0 = sample_mm(sample, pts - d)
        g = (v1 - v0) / (2.0 * eps_mm)
        bad = ~np.isfinite(g)
        ok &= ~bad
        g = np.where(bad, 0.0, g)
        grad[:, ax] = g
    return grad, ok


def _unit(grad):
    gn = np.linalg.norm(grad, axis=1, keepdims=True)
    tiny = gn[:, 0] < 1e-9
    out = grad / np.maximum(gn, 1e-12)
    if tiny.any():
        out[tiny] = np.array([0.0, 0.0, 1.0])
    return out, tiny


def project_outside(sample, pts_m, target_mm, thresh_mm, iters=8, eps_mm=2.0):
    """Push every point with SDF < thresh_mm out to target_mm along grad.

    Iterates (the trilinearly interpolated field is curved, so one step is
    not enough). Points outside the SDF grid (NaN) are left untouched.
    Returns (new_pts, total_move_m, n_offgrid).
    """
    pts = np.asarray(pts_m, dtype=np.float64).copy()
    total = np.zeros(len(pts))
    n_offgrid = 0
    for r in range(iters):
        v = sample_mm(sample, pts)
        off = ~np.isfinite(v)
        if r == 0:
            n_offgrid = int(off.sum())
        need = np.isfinite(v) & (v < thresh_mm)
        if not need.any():
            break
        idx = np.nonzero(need)[0]
        sub = pts[idx]
        grad, _ = sdf_gradient(sample, sub, eps_mm=eps_mm)
        u, _ = _unit(grad)
        step_mm = (float(target_mm) - v[idx])
        disp = u * (step_mm / 1000.0)[:, None]
        sub2 = sub + disp
        total[idx] += np.linalg.norm(sub2 - sub, axis=1)
        pts[idx] = sub2
    return pts, total, n_offgrid


def _cumlen(curve):
    seg = np.linalg.norm(np.diff(curve, axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(seg)])


def resmooth_guide(curve, fix=(0, 1), passes=2, amount=0.35):
    """Laplacian-smooth a guide's interior, keep total arc length and the
    fixed samples (root=0, first take-off=1).

    Fixing two adjacent samples at the root pins the take-off direction;
    the arc-length reparametrisation restores the original length so the
    clearance projection cannot shorten the strand.
    """
    g = np.asarray(curve, dtype=np.float64).copy()
    s0 = _cumlen(g)
    keep = {i: g[i].copy() for i in fix}
    lo, hi = max(fix) + 1, len(g) - 1
    for _ in range(passes):
        if hi - lo < 1:
            break
        new = g.copy()
        new[lo:hi] = g[lo:hi] + amount * (
            0.5 * (g[lo - 1:hi - 1] + g[lo + 1:hi + 1]) - g[lo:hi])
        g = new
    for i, p in keep.items():
        g[i] = p
    s = _cumlen(g)
    if s[-1] > 1e-12:
        out = np.empty_like(g)
        for ax in range(3):
            out[:, ax] = np.interp(s0, s, g[:, ax])
        for i, p in keep.items():
            out[i] = p
        g = out
    return g


def clear_guides(guides_w, sample, clearance_mm=2.0, thresh_mm=2.0,
                 gate_mm=1.5, smooth_passes=2, smooth_amount=0.35,
                 eps_mm=2.0):
    """Body-clear the guide field (station-owned, deterministic).

    1. project every sample closer than thresh_mm out to clearance_mm,
    2. re-smooth each guide (keep length, root, first take-off),
    3. re-project to clearance_mm (smoothing can dip samples back in).

    Returns (cleared_guides_w, stats). No guide is ever deleted.
    """
    gw = np.asarray(guides_w, dtype=np.float64)
    n, P, _ = gw.shape
    flat0 = gw.reshape(-1, 3)
    pre = sample_mm(sample, flat0)
    pre_offgrid = int((~np.isfinite(pre)).sum())
    pre_lt2 = int(np.nansum(pre < 2.0))
    pre_inside = int(np.nansum(pre < 0.0))

    g, _, _ = project_outside(sample, flat0, clearance_mm, thresh_mm,
                              eps_mm=eps_mm)
    g = g.reshape(n, P, 3)
    for i in range(n):
        g[i] = resmooth_guide(g[i], passes=smooth_passes,
                              amount=smooth_amount)
    # Re-project until the gate holds (smoothing dips a few samples back in;
    # a single pass can stall on a curved pocket, so iterate).
    for _ in range(8):
        g, _, _ = project_outside(sample, g.reshape(-1, 3), clearance_mm,
                                  gate_mm, iters=16, eps_mm=eps_mm)
        g = g.reshape(n, P, 3)
        post = sample_mm(sample, g.reshape(-1, 3))
        if int(np.nansum(post < gate_mm)) == 0:
            break

    post = sample_mm(sample, g.reshape(-1, 3))
    move_mm = np.linalg.norm(g - gw, axis=2) * 1000.0
    per_guide = move_mm.max(axis=1)
    finite_post = post[np.isfinite(post)]
    q = lambda a, p: (round(float(np.percentile(a, p)), 4)  # noqa: E731
                      if len(a) else 0.0)
    stats = {
        "nGuides": int(n), "pointsPerGuide": int(P),
        "clearanceMm": float(clearance_mm), "threshMm": float(thresh_mm),
        "gateMm": float(gate_mm),
        "preOffGridSamples": pre_offgrid,
        "preSamplesLt2mm": pre_lt2,
        "preSamplesInside": pre_inside,
        "preMinMm": round(float(np.nanmin(pre)), 4) if np.isfinite(pre).any()
        else None,
        "postOffGridSamples": int((~np.isfinite(post)).sum()),
        "postSamplesLtGate": int(np.nansum(post < gate_mm)),
        "postSamplesLtClearance": int(np.nansum(post < clearance_mm)),
        "postMinMm": round(float(finite_post.min()), 4)
        if finite_post.size else None,
        "nGuidesMovedGt0p05mm": int((per_guide > 0.05).sum()),
        "fracGuidesMoved": round(float((per_guide > 0.05).mean()), 4),
        "guideMaxMoveMm_p50": q(per_guide, 50),
        "guideMaxMoveMm_p90": q(per_guide, 90),
        "guideMaxMoveMm_p99": q(per_guide, 99),
        "guideMaxMoveMm_max": round(float(per_guide.max()), 4),
        "sampleMoveMm_p50": q(move_mm.ravel(), 50),
        "sampleMoveMm_p90": q(move_mm.ravel(), 90),
        "sampleMoveMm_p99": q(move_mm.ravel(), 99),
        "sampleMoveMm_max": round(float(move_mm.max()), 4),
        "nSamplesMovedGt0p05mm": int((move_mm > 0.05).sum()),
        "pass": bool(np.nansum(post < gate_mm) == 0),
    }
    return g, stats


def outside_pass(points, sample, target_mm=0.5, thresh_mm=0.5, iters=8,
                 eps_mm=2.0):
    """Bound the child field: every sample with SDF < thresh_mm moves out
    to target_mm along the gradient. Root sample (index 0) is included
    (the spec says each sample; the 0.5 mm move preserves scalp contact
    within render tolerance).

    Returns (new_points, per_child_max_move_mm, stats).
    """
    pts = np.asarray(points, dtype=np.float64)
    n, P, _ = pts.shape
    flat = pts.reshape(-1, 3)
    pre = sample_mm(sample, flat)
    pre_inside = int(np.nansum(pre < 0.0))
    pre_total = int(np.isfinite(pre).sum())
    pre_band = (pre < 0.0)
    # per-child pre-pass inside fraction (samples s>=1, matching the gate)
    pre_s1 = pre.reshape(n, P)[:, 1:]
    child_pre_inside = (pre_s1 < 0.0).sum(axis=1)
    child_pre_n = np.isfinite(pre_s1).sum(axis=1)

    # pre-pass inside fraction per band (card falsifier wants bands)
    r = pts[:, 0, :]
    bandm = {
        "parietal": (np.abs(r[:, 0] * 1000.0) >= 50.0)
        & (np.abs(r[:, 0] * 1000.0) < 85.0),
        "temple": (np.abs(r[:, 0] * 1000.0) >= 35.0)
        & (np.abs(r[:, 0] * 1000.0) < 85.0)
        & (r[:, 1] * 1000.0 >= -135.0)
        & (r[:, 1] * 1000.0 < -40.0),
        "crown": r[:, 2] >= 1.60,
        "back": r[:, 1] > 0.0342,
    }
    pre_band = {}
    pre_s = pre.reshape(n, P)[:, 1:]
    for bn, bm in bandm.items():
        sel = pre_s[bm]
        fin = np.isfinite(sel)
        pre_band[bn] = {
            "nSamples": int(fin.sum()),
            "insideFrac": round(float(
                (sel[fin] < 0.0).sum() / max(fin.sum(), 1)), 6)}

    new, total_mm, n_offgrid = project_outside(
        sample, flat, target_mm, thresh_mm, iters=iters, eps_mm=eps_mm)
    new = new.reshape(n, P, 3)
    move_mm = np.linalg.norm(new - pts, axis=2) * 1000.0
    per_child = move_mm.max(axis=1)
    post = sample_mm(sample, new.reshape(-1, 3))
    n_child_gt3 = int((per_child > 3.0).sum())
    frac_gt3 = float(n_child_gt3) / max(n, 1)
    stats = {
        "targetMm": float(target_mm), "threshMm": float(thresh_mm),
        "nChildren": int(n), "pointsPerChild": int(P),
        "offGridSamples": int(n_offgrid),
        "preSamplesInside": pre_inside,
        "preSamplesFinite": pre_total,
        "preInsideFracSamples": round(pre_inside / max(pre_total, 1), 6),
        "preInsideFracByBand": pre_band,
        "preChildrenWithInside": int((child_pre_inside > 0).sum()),
        "preChildInsideFracMax": round(float(
            (child_pre_inside / np.maximum(child_pre_n, 1)).max()), 6),
        "postSamplesLt0": int(np.nansum(post < 0.0)),
        "postSamplesLtTarget": int(np.nansum(post < target_mm)),
        "nChildrenMoveGt3mm": n_child_gt3,
        "fracChildrenMoveGt3mm": round(frac_gt3, 6),
        "childMoveMm_p50": round(float(np.percentile(per_child, 50)), 4),
        "childMoveMm_p90": round(float(np.percentile(per_child, 90)), 4),
        "childMoveMm_p99": round(float(np.percentile(per_child, 99)), 4),
        "childMoveMm_max": round(float(per_child.max()), 4),
        "nChildrenMovedGt0p05mm": int((per_child > 0.05).sum()),
        "pass": bool(frac_gt3 <= 0.02),
    }
    return new, per_child, stats
