"""Station-owned SDF height transfer (hair-groom18).

Mechanism, not an offset. Blender's Interpolate children dive through the
skull between outside guides (hair-groom16/17 measured this): a guide's
shape copied to another root on a curved skull dips in where the skull
bulges, and blending moves points toward the chord between guides. So a
child's own SDF profile is wrong; but the guides' SDF profile is right
(groom16 cleared the guides and gated them out of the body).

height_transfer sets each child sample to the HEIGHT its guides have
above the body at the SAME arc fraction:

  h(s) = weighted blend of the source guides' body-SDF values at arc
         fraction s, weights = inverse distance from the child's root to
         its 3 nearest guide roots on the scalp (Blender does not export
         the Interpolate weights, so the root-distance fallback is used;
         stated in E/RESULT.txt).
  target(s) = max(h(s), 0.5 mm)
  move the sample along the body-SDF gradient until its SDF == target.

Only the radial (gradient) coordinate moves; tangential position is left
alone, so Clump and Noise survive. No strand is hidden or deleted.

Units: world metres; SDF millimetres (negative inside), matching
children.sdf_sampler and body_clear.
"""
from __future__ import annotations

import numpy as np

import body_clear as BC

MIN_TARGET_MM = 0.5
N_BLEND_GUIDES = 3
ARC_NODES = 41


def _cumfrac(curve):
    seg = np.linalg.norm(np.diff(curve, axis=0), axis=1)
    c = np.concatenate([[0.0], np.cumsum(seg)])
    if c[-1] <= 1e-12:
        return np.linspace(0.0, 1.0, len(curve))
    return c / c[-1]


def guide_profiles(guides_w, sample, nodes=ARC_NODES):
    """Resample every guide's body-SDF onto a common normalized-arc grid.

    Returns (nodes, prof) with prof shape (G, nodes); off-grid samples are
    NaN and are dropped before interpolation. A guide with <2 finite
    samples gets an all-NaN profile (its children fall back to no move).
    """
    gw = np.asarray(guides_w, dtype=np.float64)
    G, P, _ = gw.shape
    vals = BC.sample_mm(sample, gw.reshape(-1, 3)).reshape(G, P)
    nd = np.linspace(0.0, 1.0, int(nodes))
    prof = np.full((G, int(nodes)), np.nan, dtype=np.float64)
    for i in range(G):
        v = vals[i]
        fin = np.isfinite(v)
        if int(fin.sum()) < 2:
            continue
        a = _cumfrac(gw[i])
        prof[i] = np.interp(nd, a[fin], v[fin])
    return nd, prof


def nearest_guide_roots(child_roots, guide_roots, k=N_BLEND_GUIDES,
                        chunk=2048):
    """k nearest guide roots per child, inverse-distance weights.

    Returns (idx (N,k), w (N,k) rows sum to 1). Pure numpy (no scipy in
    Blender).
    """
    cr = np.asarray(child_roots, dtype=np.float64)
    gr = np.asarray(guide_roots, dtype=np.float64)
    N = len(cr)
    k = int(min(k, len(gr)))
    idx = np.empty((N, k), dtype=np.int64)
    w = np.empty((N, k), dtype=np.float64)
    for a in range(0, N, chunk):
        b = min(a + chunk, N)
        d = np.linalg.norm(cr[a:b, None, :] - gr[None, :, :], axis=2)
        part = np.argpartition(d, k - 1, axis=1)[:, :k]
        dd = np.take_along_axis(d, part, axis=1)
        order = np.argsort(dd, axis=1)
        idx[a:b] = np.take_along_axis(part, order, axis=1)
        dd = np.take_along_axis(dd, order, axis=1)
        w[a:b] = 1.0 / np.maximum(dd, 1e-4)
    w /= np.maximum(w.sum(axis=1, keepdims=True), 1e-12)
    return idx, w


def target_height(points, guides_w, sample, k=N_BLEND_GUIDES, nodes=ARC_NODES):
    """Per-sample target height (mm) = max(blended guide SDF, 0.5).

    Returns (target (N,P), h_raw (N,P), offgrid_guides (N,P) bool).
    """
    pts = np.asarray(points, dtype=np.float64)
    N, P, _ = pts.shape
    nd, prof = guide_profiles(guides_w, sample, nodes=nodes)
    guide_roots = np.asarray(guides_w, dtype=np.float64)[:, 0, :]
    idx, w = nearest_guide_roots(pts[:, 0, :], guide_roots, k=k)
    # child normalized arc fraction per sample
    seg = np.linalg.norm(np.diff(pts, axis=1), axis=2)
    arc = np.concatenate([np.zeros((N, 1)), np.cumsum(seg, axis=1)], axis=1)
    tot = arc[:, -1:]
    afrac = np.where(tot > 1e-12, arc / np.maximum(tot, 1e-12),
                     np.linspace(0.0, 1.0, P)[None, :])
    u = np.clip(afrac, 0.0, 1.0) * (len(nd) - 1)
    m0 = np.clip(np.floor(u).astype(np.int64), 0, len(nd) - 2)
    fr = u - m0
    h = np.zeros((N, P), dtype=np.float64)
    wsum = np.zeros((N, P), dtype=np.float64)
    for s in range(idx.shape[1]):
        g = idx[:, s]
        pg = prof[g]
        p0 = np.take_along_axis(pg, m0, axis=1)
        p1 = np.take_along_axis(pg, m0 + 1, axis=1)
        hs = p0 * (1.0 - fr) + p1 * fr
        good = np.isfinite(hs)
        h += np.where(good, hs, 0.0) * w[:, s, None]
        wsum += np.where(good, 1.0, 0.0) * w[:, s, None]
    offgrid = wsum <= 1e-9
    h = np.where(offgrid, np.nan, h / np.maximum(wsum, 1e-12))
    target = np.maximum(h, MIN_TARGET_MM)
    return target, h, offgrid


def transfer(points, guides_w, sample, min_mm=MIN_TARGET_MM,
              k=N_BLEND_GUIDES, iters=120, tol_mm=0.05, relax=0.8, eps_mm=2.0,
              max_step_mm=10.0, max_total_move_mm=150.0):
    """Set every child sample's body-SDF to max(h(s), min_mm).

    Moves along the SDF gradient only. Returns (new_points (N,P,3),
    per_sample_net_move_mm (N,P), per_child_max_net_move_mm (N,), stats).
    Samples whose blended guide height is off-grid (all source guides NaN)
    are left untouched and counted; no strand is ever deleted.

    Step bounding (hair-groom18 handback: the unbounded walker's path max
    was 773 mm against a net displacement max of 124 mm — a far-field
    gradient fault):
      deficit-sized steps (0.8 * (tgt - v)) assume the target isosurface
      lies along the gradient at distance ~= deficit. Deep samples
      overshoot across thin structures, the gradient flips, and the walk
      ping-pongs: 24 iters x ~30 mm of path for ~120 mm of net. So:
      - each iteration's step is capped at max_step_mm (default 10 mm);
      - each sample's cumulative path is capped at max_total_move_mm
        (default 150 mm; samples that hit it stop and are counted);
      - the best-residual position per sample is tracked and restored at
        the end, so oscillation never leaves a sample worse than its
        closest approach.
    Only the active (unconverged) set is sampled per round; converged and
    capped samples are deactivated.
    """
    pts = np.asarray(points, dtype=np.float64)
    N, P, _ = pts.shape
    target, h_raw, offg = target_height(pts, guides_w, sample, k=k)
    tgt = target.reshape(-1)
    leave = offg.reshape(-1)
    flat = pts.reshape(-1, 3).copy()
    net0 = flat.copy()
    path = np.zeros(len(flat), dtype=np.float64)
    v0, inside0 = sample(flat)
    offgrid_cnt = int((~inside0).sum())
    finite0 = inside0 & np.isfinite(v0)
    best_pos = flat.copy()
    best_resid = np.where(finite0 & ~leave, np.abs(v0 - tgt), np.inf)
    active = finite0 & ~leave & (best_resid > tol_mm)
    capped = np.zeros(len(flat), dtype=bool)
    n_step_capped = np.zeros(len(flat), dtype=np.int32)
    n_rounds = 0

    step_cap_m = float(max_step_mm) / 1000.0
    total_cap_m = float(max_total_move_mm) / 1000.0

    for r in range(int(iters)):
        if not active.any():
            break
        n_rounds = r + 1
        j = np.nonzero(active)[0]
        vj, inj = sample(flat[j])
        vj = np.where(inj, vj, np.nan)
        ok = np.isfinite(vj)
        # samples that stepped off-grid: freeze at best, deactivate
        if not ok.all():
            bad = j[~ok]
            active[bad] = False
            j = j[ok]
            vj = vj[ok]
            if not len(j):
                continue
        resid = np.abs(vj - tgt[j])
        improved = resid < best_resid[j]
        if improved.any():
            ji = j[improved]
            best_pos[ji] = flat[ji]
            best_resid[ji] = resid[improved]
        conv = resid <= tol_mm
        if conv.any():
            active[j[conv]] = False
        need_m = ~conv
        jn = j[need_m]
        if not len(jn):
            continue
        vn = vj[need_m]
        grad, gok = BC.sdf_gradient(sample, flat[jn], eps_mm=eps_mm)
        u, tiny = BC._unit(grad)
        dead = (~gok) | tiny
        step = (tgt[jn] - vn) * float(relax)
        disp = u * (step / 1000.0)[:, None]
        disp[dead] = 0.0
        dl = np.linalg.norm(disp, axis=1)
        over = dl > step_cap_m
        if over.any():
            n_step_capped[jn[over]] += 1
            disp[over] *= (step_cap_m
                           / np.maximum(dl[over], 1e-12))[:, None]
            dl = np.linalg.norm(disp, axis=1)
        remain = np.maximum(total_cap_m - path[jn], 0.0)
        scale = np.ones_like(dl)
        pos = dl > 0
        scale[pos] = np.minimum(
            1.0, remain[pos] / np.maximum(dl[pos], 1e-12))
        touched = scale < 1.0
        if touched.any():
            disp[touched] *= scale[touched][:, None]
            capped[jn[touched]] = True
            active[jn[touched]] = False
        applied = np.linalg.norm(disp, axis=1)
        flat[jn] += disp
        path[jn] += applied

    moved = path > 0
    flat[moved] = best_pos[moved]

    post, _ = sample(flat)
    post = np.where(np.isfinite(post), post, np.nan)
    path_mm = (path.reshape(N, P) * 1000.0)
    net_mm = (np.linalg.norm((flat - net0).reshape(N, P, 3), axis=2)
              * 1000.0)
    per_child = net_mm.max(axis=1)
    per_child_path = path_mm.max(axis=1)
    tgt_t = target
    resid = np.abs(post.reshape(N, P) - tgt_t)
    q = lambda a, p: (round(float(np.percentile(a, p)), 4)  # noqa: E731
                      if len(a) else 0.0)
    mv = path_mm.ravel()
    nt = net_mm.ravel()
    pc = per_child
    # move budget by root band (same root-band defs as the depth scorer)
    r0 = pts[:, 0, :]
    bands = {
        "parietal": (np.abs(r0[:, 0] * 1000.0) >= 50.0)
        & (np.abs(r0[:, 0] * 1000.0) < 85.0),
        "temple": (np.abs(r0[:, 0] * 1000.0) >= 35.0)
        & (np.abs(r0[:, 0] * 1000.0) < 85.0)
        & (r0[:, 1] * 1000.0 >= -135.0) & (r0[:, 1] * 1000.0 < -40.0),
        "crown": r0[:, 2] >= 1.60,
        "back": r0[:, 1] > 0.0342,
    }
    band_move = {}
    for bn, bm in bands.items():
        sel = pc[bm]
        band_move[bn] = {
            "nChildren": int(bm.sum()),
            "nGt3mm": int((sel > 3.0).sum()),
            "fracGt3mm": round(float((sel > 3.0).mean()), 6)
            if sel.size else 0.0,
        }
    stats = {
        "min": float(min_mm), "nBlendGuides": int(k), "iters": int(iters),
        "itersUsed": int(n_rounds),
        "weighting": "inverse-distance to 3 nearest guide roots",
        "stepBound": {"maxStepMm": float(max_step_mm),
                      "maxTotalMoveMm": float(max_total_move_mm),
                      "note": "per-iter step cap + per-sample path cap + "
                      "best-residual restore; child_move_mm is NET "
                      "displacement, path reported separately"},
        "nSamples": int(N * P),
        "samplesLeftUntouchedGuideOffGrid": int(leave.sum()),
        "offGridSamples": int(offgrid_cnt),
        "moveMm_p50": q(mv, 50), "moveMm_p90": q(mv, 90),
        "moveMm_p99": q(mv, 99),
        "moveMm_max": round(float(mv.max()), 4) if mv.size else 0.0,
        "netMm_p50": q(nt, 50), "netMm_p90": q(nt, 90),
        "netMm_p99": q(nt, 99),
        "netMm_max": round(float(nt.max()), 4) if nt.size else 0.0,
        "childMaxMoveMm_p50": q(pc, 50), "childMaxMoveMm_p90": q(pc, 90),
        "childMaxMoveMm_p99": q(pc, 99),
        "childMaxMoveMm_max": round(float(pc.max()), 4) if pc.size else 0.0,
        "childMaxPathMm_p50": q(per_child_path, 50),
        "childMaxPathMm_p90": q(per_child_path, 90),
        "childMaxPathMm_p99": q(per_child_path, 99),
        "childMaxPathMm_max": round(float(per_child_path.max()), 4)
        if per_child_path.size else 0.0,
        "nSamplesStepCapped": int((n_step_capped > 0).sum()),
        "nSamplesTotalCapped": int(capped.sum()),
        "nChildrenTotalCapped": int(capped.reshape(N, P).any(axis=1).sum()),
        "nChildrenMovedGt3mm": int((pc > 3.0).sum()),
        "fracChildrenMovedGt3mm": round(float((pc > 3.0).mean()), 6),
        "nChildrenMoved": int((pc > 0.05).sum()),
        "fracChildrenMoved": round(float((pc > 0.05).mean()), 6),
        "moveByBand": band_move,
        "residMm_p50": q(resid.ravel(), 50),
        "residMm_p90": q(resid.ravel(), 90),
        "residMm_p99": q(resid.ravel(), 99),
        "residMm_max": round(float(np.nanmax(resid)), 4)
        if np.isfinite(resid).any() else None,
        "postInsideSamples": int(np.nansum(post < 0.0)),
        "postBelowMin": int(np.nansum(post < float(min_mm) - 0.05)),
    }
    return flat.reshape(N, P, 3), net_mm, per_child, stats
