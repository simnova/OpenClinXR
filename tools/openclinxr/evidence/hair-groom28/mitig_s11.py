#!/usr/bin/env python3
"""Groom21 STEP 0: BACK-region POSITION coherence fairing; FRONT/TEMPLE byte-identical to groom19.

Region split by GUIDE ROOT (world metres via frames.head_to_world):
  BACK = (root_y < Y_EAR) & (root_z > Z_NAPE)
    Y_EAR  = -0.0635 m: coronal plane through the ear canals, defined as
             the mean of the left/right pinna-centroid y from
             hair-hull3/workspace/ear_pinna.npz
             (xpos median y -0.0589, xneg median y -0.0681; mean -0.0635).
    Z_NAPE = 1.51 m: BACK requires root_z > 1.51 m (above the nape).
  FRONT/TEMPLE = the rest. Copied byte-identical from guides-19.npz
             (head-mm bits, all 41 samples per FRONT guide).
Tuck routes (tuck > 0.5 in the input guides file): excluded from the
graph entirely and not anchored (w = 0, byte-identical out).

Boundary weight: d = Y_EAR - root_y (metres, > 0 behind the plane);
t = clip(d / 0.025, 0, 1); w = t*t*(3-2t) (smoothstep over 25 mm).
The fairing delta is applied as delta * w, so FRONT guides (w = 0)
are untouched (no seam: w -> 0 continuously at the plane) and deep
BACK guides (w = 1) are fully faired.

Groom26 hem-preserving variant (default OFF = groom25 behaviour):
- --hem-frac F: 0 = off; 0<F<1 = fair fully up to arc fraction F of each
  guide's own total input arc, then smoothstep-blend the fairing delta
  back to the input position toward the hem (h=1 below F, h ->
  1-smoothstep((f-F)/(1-F)) above, h=0 at the hem). Keeps w==0 rows
  byte-identical; the upper/mid back (locks) stays faired while the
  drape outline returns to guides-19. Combines with --cap-mm/--pin-hem
  (hem factor applied to the capped delta before the w-blend; --pin-hem
  still forces the exact hem sample when both are set).

BACK treatment (from guides-19):
- take-off verbatim to 40 mm of arc: every sample with arc < 40 mm
  copied from the input bits; each guide's own arc sets its own k0.
- position fairing in the s09 cylindrical scalp frame (radius,
  unwrapped azimuth x 100 mm reference radius, height): the neighbour
  graph over BACK non-tuck roots within 20 mm (3D chord, Gaussian
  weights sigma = kernel/2, row-normalised) averages root-relative
  OFFSETS (not tangents); ONE pass, anchor 0.5 to the guide's own
  offset: fair = anchor*own + (1-anchor)*(W @ own).
- blend by w, then verbatim overwrite, then hull/body advisory counts.
- never delete guides.

Falsifier support: --permute-seed N permutes the graph columns with
rng(N) (each guide averaged with unrelated back guides, same kernel
weights, still row-stochastic). --anchor 0.3 runs the anchor-0.3
single-pass variant beside the 0.5 main run.

Crossing metric (the card's lock gate): back NON-TUCK guide
pair-crossing count in the scalp-UV projection (u = global azimuth x
100 mm, v = height) over arc 40-200 mm. Each guide contributes the
polyline of its samples with own-arc in [40, 200] mm (guides with < 2
window samples excluded); a pair counts once if any segment pair
crosses properly (non-degenerate orientation signs). Deterministic.

Outputs: <outdir>/<stem>.npz + <outdir>/<stem>-fairing.json.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from scipy.spatial import cKDTree
from scipy import sparse

STRANDS = Path(
    "/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2b"
    "/tools/openclinxr/hair-groom/strands")
sys.path.insert(0, str(STRANDS))
import frames as F  # noqa: E402
from children import sdf_sampler  # noqa: E402

P_IN = 41
VERBATIM_MM = 40.0
KERNEL_MM = 20.0
ANCHOR = 0.5
PASSES = 1
GATE_ROOT_MM = 6.0
MARGIN_MM = 1.5
Y_EAR = -0.0635
Z_NAPE = 1.51
W_WIDTH_M = 0.025
ARC_LO_M = 0.040
ARC_HI_M = 0.200


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--guides", required=True,
                   help="guides-19.npz (fairing source AND front source)")
    p.add_argument("--sdf", required=True)
    p.add_argument("--hull", required=True)
    p.add_argument("--outdir", required=True)
    p.add_argument("--stem", default="guides-21")
    p.add_argument("--anchor", type=float, default=ANCHOR)
    p.add_argument("--kernel-mm", type=float, default=KERNEL_MM)
    p.add_argument("--verbatim-mm", type=float, default=VERBATIM_MM)
    p.add_argument("--passes", type=int, default=PASSES)
    p.add_argument("--permute-seed", type=int, default=-1,
                   help=">=0: permute graph columns with rng(seed)")
    p.add_argument("--margin-mm", type=float, default=MARGIN_MM)
    p.add_argument("--y-ear", type=float, default=Y_EAR)
    p.add_argument("--z-nape", type=float, default=Z_NAPE)
    p.add_argument("--cap-mm", type=float, default=0.0,
                   help="<=0: off; >0: scale each guide's fairing delta "
                   "to at most this max (world mm)")
    p.add_argument("--pin-hem", action="store_true",
                   help="keep each BACK graph guide's last sample at "
                   "its input position; fair only the middle")
    p.add_argument("--hem-frac", type=float, default=0.0,
                   help="0 = off (groom25 behaviour); 0<F<1 = fair "
                   "fully up to arc fraction F, then smoothstep-blend "
                   "the delta back to input toward the hem")
    p.add_argument("--leaveout-npz", default="",
                    help="MITIG-28 only: .npz with int array 'idx' of guide "
                    "rows forced to w=0 (left unfaired, byte-identical out)")
    p.add_argument("--hem-keep-mm", type=float, default=0.0,
                   help="0 = off; >0 = fair fully for input arc < K mm, "
                   "then smoothstep-blend the delta back to input over "
                   "arc K..hem (keeps the 40-200 mm lock window faired "
                   "when K >= 200; short guides stay fully faired)")
    return p.parse_args()


def distribution(a):
    a = np.asarray(a, dtype=np.float64)
    if not a.size:
        return {"n": 0}
    return {"n": int(a.size), "min": round(float(a.min()), 3),
            "p50": round(float(np.percentile(a, 50)), 3),
            "p90": round(float(np.percentile(a, 90)), 3),
            "p99": round(float(np.percentile(a, 99)), 3),
            "max": round(float(a.max()), 3)}


def pair_separation(curves, pairs):
    return np.linalg.norm(curves[pairs[:, 0]] - curves[pairs[:, 1]],
                          axis=2).max(axis=1)


def smoothstep(t):
    t = np.clip(np.asarray(t, dtype=np.float64), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def crossing_count(curves, crown, mask):
    """Back pair-crossing count in scalp-UV (u=azimuth*100mm, v=z),
    arc 40-200 mm, over masked guides with >=2 window samples."""
    roots = curves[:, 0]
    seg = np.linalg.norm(np.diff(curves, axis=1), axis=2)
    arc = np.concatenate([np.zeros((len(curves), 1)),
                          np.cumsum(seg, axis=1)], axis=1)
    win = (arc >= ARC_LO_M) & (arc <= ARC_HI_M)
    cy = float(np.asarray(crown, dtype=np.float64)[1])
    u = np.arctan2(curves[..., 1] - cy, curves[..., 0]) * 0.100
    v = curves[..., 2]
    ok = mask & (win.sum(axis=1) >= 2)
    idx = np.nonzero(ok)[0]
    U = [np.ascontiguousarray(u[i][win[i]]) for i in idx]
    V = [np.ascontiguousarray(v[i][win[i]]) for i in idx]
    S = [(np.stack([UU[:-1], VV[:-1]], axis=1),
          np.stack([UU[1:], VV[1:]], axis=1)) for UU, VV in zip(U, V)]

    def orient(ax, ay, bx, by, cx, cy_):
        return (bx - ax) * (cy_ - ay) - (by - ay) * (cx - ax)

    m = len(idx)
    cross = 0
    for i in range(m):
        a0, a1 = S[i]
        for j in range(i + 1, m):
            b0, b1 = S[j]
            if (a0[:, 0].max() < b0[:, 0].min()
                    or b0[:, 0].max() < a0[:, 0].min()
                    or a0[:, 1].max() < b0[:, 1].min()
                    or b0[:, 1].max() < a0[:, 1].min()):
                continue
            hit = False
            for k in range(len(a0)):
                d1 = orient(b0[:, 0], b0[:, 1], b1[:, 0], b1[:, 1],
                            a0[k, 0], a0[k, 1])
                d2 = orient(b0[:, 0], b0[:, 1], b1[:, 0], b1[:, 1],
                            a1[k, 0], a1[k, 1])
                d3 = orient(a0[k, 0], a0[k, 1], a1[k, 0], a1[k, 1],
                            b0[:, 0], b0[:, 1])
                d4 = orient(a0[k, 0], a0[k, 1], a1[k, 0], a1[k, 1],
                            b1[:, 0], b1[:, 1])
                if np.any(((d1 > 0) != (d2 > 0)) & ((d3 > 0) != (d4 > 0))
                          & (d1 != 0) & (d2 != 0) & (d3 != 0) & (d4 != 0)):
                    hit = True
                    break
            if hit:
                cross += 1
    return {"nCrossPairs": int(cross), "nGuides": int(m),
            "nPairs": int(m * (m - 1) // 2)}


def main():
    args = cli()
    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    assert int(args.passes) == 1, "BACK position fairing is ONE pass"
    anchor = float(args.anchor)

    src = np.load(args.guides, allow_pickle=True)
    head_in = np.asarray(src["curves_head"], dtype=np.float64)
    crown = np.asarray(src["crown"], dtype=np.float64)
    n, Pin, _ = head_in.shape
    assert Pin == P_IN, (Pin, P_IN)
    curves = F.head_to_world(head_in, crown)  # world metres
    roots = curves[:, 0].copy()
    tuck = (np.asarray(src["tuck"]) > 0.5) if "tuck" in src \
        else np.zeros(n, dtype=bool)

    y_ear = float(args.y_ear)
    z_nape = float(args.z_nape)
    back_mask = (roots[:, 1] < y_ear) & (roots[:, 2] > z_nape)
    graph_mask = back_mask & ~tuck
    gidx = np.nonzero(graph_mask)[0]
    nb = len(gidx)

    # boundary weight: smoothstep over 25 mm across the coronal plane.
    # FRONT rows are w = 0 exactly (byte-identical out); tuck excluded.
    d = y_ear - roots[:, 1]
    w = smoothstep(d / W_WIDTH_M)
    w[tuck] = 0.0
    w[~back_mask] = 0.0
    # MITIG-28: leave the inner -x curtain unfaired (byte-identical out).
    if str(args.leaveout_npz):
        _lo = np.load(str(args.leaveout_npz), allow_pickle=True)
        _li = np.asarray(_lo["idx"], dtype=np.int64)
        w[_li] = 0.0
    n_w0 = int((w == 0.0).sum())
    n_w1 = int((w == 1.0).sum())

    # s09 cylindrical scalp frame (radius, unwrapped azimuth, height)
    centre_y = float(crown[1])
    xx = curves[..., 0]
    yy = curves[..., 1] - centre_y
    radius = np.sqrt(xx * xx + yy * yy)
    angle = np.unwrap(np.arctan2(yy, xx), axis=1)
    offsets = np.stack([
        radius - radius[:, 0, None],
        (angle - angle[:, 0, None]) * 0.100,
        curves[..., 2] - curves[:, 0, None, 2],
    ], axis=2)

    # neighbour graph over BACK non-tuck roots, 20 mm chord, Gaussian
    R = roots[gidx]
    tree = cKDTree(R)
    neigh = tree.query_ball_tree(tree, float(args.kernel_mm) / 1000.0)
    sigma = float(args.kernel_mm) / 2000.0
    rows, cols, values = [], [], []
    for i, js in enumerate(neigh):
        jj = np.asarray(js, dtype=np.int64)
        dist = np.linalg.norm(R[jj] - R[i], axis=1)
        wt = np.exp(-0.5 * (dist / sigma) ** 2)
        wt /= wt.sum()
        rows.extend([i] * len(jj))
        cols.extend(jj.tolist())
        values.extend(wt.tolist())
    W = sparse.csr_matrix((values, (rows, cols)), shape=(nb, nb))
    permuted = int(args.permute_seed) >= 0
    if permuted:
        rng = np.random.RandomState(int(args.permute_seed))
        perm = rng.permutation(nb)
        W = W[:, perm]

    # ONE position pass, anchored to the guide's own offset
    flat = offsets[gidx].reshape(nb, -1)
    fair1 = (anchor * flat + (1.0 - anchor) * (W @ flat)).reshape(
        offsets[gidx].shape)
    off2 = offsets.copy()
    off2[gidx] = fair1
    rr = radius[:, 0, None] + off2[..., 0]
    aa = angle[:, 0, None] + off2[..., 1] / 0.100
    zz = curves[:, 0, None, 2] + off2[..., 2]
    faired = np.stack([rr * np.cos(aa),
                       centre_y + rr * np.sin(aa), zz], axis=2)

    # per-guide arc from the INPUT; verbatim every sample < 40 mm.
    # k = count of verbatim samples (short guides: all samples).
    seg = np.linalg.norm(np.diff(curves, axis=1), axis=2)
    arc = np.concatenate([np.zeros((n, 1)), np.cumsum(seg, axis=1)],
                         axis=1)
    verb_m = float(args.verbatim_mm) / 1000.0
    k0 = (arc < verb_m).sum(axis=1).astype(int)

    # groom25: cap the fairing delta per guide (scale, not clip).
    cap_mm = float(args.cap_mm)
    cap_info = {"on": bool(cap_mm > 0.0), "capMm": cap_mm,
                "nCapped": 0, "maxDeltaBeforeMm": 0.0}
    if cap_mm > 0.0:
        delta = faired - curves
        dm = np.linalg.norm(delta, axis=2).max(axis=1) * 1000.0
        cap_info["maxDeltaBeforeMm"] = round(float(dm.max()), 3)
        scale = np.minimum(1.0, (cap_mm / 1000.0)
                           / np.maximum(np.linalg.norm(delta, axis=2)
                                        .max(axis=1), 1e-12))[:, None, None]
        cap_info["nCapped"] = int((scale[:, 0, 0] < 1.0).sum())
        faired = curves + delta * scale

    # boundary blend, then verbatim overwrite (world), then head-mm bits:
    # every w == 0 row copies input bits exactly (FRONT + tuck).
    # groom26: hem-preserving fairing. h in [0,1] per (guide, sample):
    # fraction mode: h = 1 at/below arc fraction hem_frac, smoothstep
    # back to 0 at hem. keep-mm mode: h = 1 for arc < hem_keep_mm,
    # smoothstep back to 0 over arc hem_keep..hem (short guides with
    # total <= keep stay fully faired). Both keep w==0 rows identical.
    hem_frac = float(args.hem_frac)
    hem_keep = float(args.hem_keep_mm)
    hem_info = {"on": bool(hem_frac > 0.0 or hem_keep > 0.0),
                "hemFrac": hem_frac, "hemKeepMm": hem_keep,
                "nGuides": 0}
    assert hem_frac == 0.0 or 0.0 < hem_frac < 1.0, hem_frac
    assert hem_keep >= 0.0, hem_keep
    assert not (hem_frac > 0.0 and hem_keep > 0.0), "one hem mode only"
    if hem_frac > 0.0:
        total = arc[:, -1]
        total = np.where(total > 1e-12, total, 1e-12)
        f = arc / total[:, None]
        above = np.clip((f - hem_frac) / (1.0 - hem_frac), 0.0, 1.0)
        h = 1.0 - (above * above * (3.0 - 2.0 * above))
        blended = curves + (w[:, None, None] * h[:, :, None]
                            * (faired - curves))
        hem_info["nGuides"] = int(graph_mask.sum())
    elif hem_keep > 0.0:
        keep_m = hem_keep / 1000.0
        total = arc[:, -1]
        denom = np.maximum(total - keep_m, 1e-12)
        above = np.clip((arc - keep_m) / denom[:, None], 0.0, 1.0)
        h = 1.0 - (above * above * (3.0 - 2.0 * above))
        h = np.where(arc <= keep_m, 1.0, h)
        blended = curves + (w[:, None, None] * h[:, :, None]
                            * (faired - curves))
        hem_info["nGuides"] = int(graph_mask.sum())
    else:
        blended = curves + w[:, None, None] * (faired - curves)
    # groom25: pin each BACK graph guide's hem (last sample) to input.
    pin_hem = bool(args.pin_hem)
    hem_pinned = np.zeros(n, dtype=bool)
    if pin_hem:
        blended[gidx, -1] = curves[gidx, -1]
        hem_pinned[gidx] = True
    for i in range(n):
        k = int(k0[i])
        if k > 0:
            blended[i, :k] = curves[i, :k]
    head_out = np.empty_like(head_in)
    w0 = (w == 0.0)
    head_out[w0] = head_in[w0]
    for ii in np.nonzero(~w0)[0]:
        k = int(k0[ii])
        head_out[ii, :k] = head_in[ii, :k]
        if hem_pinned[ii]:
            head_out[ii, -1] = head_in[ii, -1]
            jrange = range(k, Pin - 1)
        else:
            jrange = range(k, Pin)
        for j in jrange:
            p = blended[ii, j]
            head_out[ii, j, 0] = p[0] * 1000.0
            head_out[ii, j, 1] = (float(crown[1]) - p[1]) * 1000.0
            head_out[ii, j, 2] = (float(crown[2]) - p[2]) * 1000.0

    # world output for stats (recompute from head bits exactly as scored)
    world_out = F.head_to_world(head_out, crown)

    # stats
    moved = np.linalg.norm(world_out - curves, axis=2).max(axis=1) \
        * 1000.0
    tree_b = cKDTree(roots[back_mask])
    tpairs = np.asarray(list(tree_b.query_pairs(GATE_ROOT_MM / 1000.0)),
                        dtype=np.int64)
    before = pair_separation(curves[back_mask], tpairs) * 1000.0 \
        if len(tpairs) else np.zeros(0)
    after = pair_separation(world_out[back_mask], tpairs) * 1000.0 \
        if len(tpairs) else np.zeros(0)

    xc_in = crossing_count(curves, crown, back_mask & ~tuck)
    xc_out = crossing_count(world_out, crown, back_mask & ~tuck)

    verb = arc < verb_m
    n_verb = int(verb.sum())
    exact_take = bool(np.array_equal(head_out[verb], head_in[verb]))
    max_abs_take = float(np.abs(head_out[verb] - head_in[verb]).max()) \
        if n_verb else 0.0
    n_front = int((~back_mask).sum() * Pin)
    exact_front = bool(np.array_equal(head_out[~back_mask],
                                      head_in[~back_mask]))
    max_abs_front = float(np.abs(head_out[~back_mask]
                                 - head_in[~back_mask]).max()) \
        if n_front else 0.0
    n_w0samples = int(w0.sum() * Pin)
    exact_w0 = bool(np.array_equal(head_out[w0], head_in[w0]))

    sample, _ = sdf_sampler(np.load(args.sdf, allow_pickle=True))
    flat_o = world_out.reshape(-1, 3)
    vals, ins = sample(flat_o)
    margin = float(args.margin_mm)
    n_below = int((ins & (vals < margin)).sum())
    n_inside0 = int((ins & (vals < 0.0)).sum())

    H = np.load(str(args.hull), allow_pickle=True)
    occ = np.asarray(H["occupancy"], dtype=bool)
    xs = np.asarray(H["xs"], dtype=np.float64)
    ys = np.asarray(H["ys"], dtype=np.float64)
    zs = np.asarray(H["zs"], dtype=np.float64)
    sp = float(H["spacing"])
    x0, y0, z0 = float(xs[0]), float(ys[0]), float(zs[0])
    nx, ny, nz = occ.shape

    def inside_hull(pts_m):
        pts_mm = np.asarray(pts_m, dtype=np.float64) * 1000.0
        ix = np.round((pts_mm[:, 0] - x0) / sp).astype(np.int64)
        iy = np.round((pts_mm[:, 1] - y0) / sp).astype(np.int64)
        iz = np.round((pts_mm[:, 2] - z0) / sp).astype(np.int64)
        valid = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny) \
            & (iz >= 0) & (iz < nz)
        o = np.zeros(len(pts_m), dtype=bool)
        o[valid] = occ[ix[valid], iy[valid], iz[valid]]
        return o

    n_out_hull = int((~inside_hull(flat_o)).sum())

    h = hashlib.sha256()
    h.update(np.ascontiguousarray(head_out).tobytes())
    out_hash = h.hexdigest()
    h2 = hashlib.sha256()
    h2.update(np.ascontiguousarray(head_in).tobytes())
    in_hash = h2.hexdigest()

    stats = {
        "schema": "openclinxr.hair-guide-back-position-coherent.v1",
        "method": "BACK-region root-relative cylindrical-offset position "
                  "smoothing over BACK non-tuck 20mm root graph, anchor "
                  "%.2f, ONE pass, boundary weight w (25mm smoothstep), "
                  "verbatim %.0fmm take-off; FRONT + tuck byte-identical" % (
                      anchor, float(args.verbatim_mm)),
        "parameters": {"anchor": anchor,
                       "kernelMm": float(args.kernel_mm),
                       "verbatimMm": float(args.verbatim_mm),
                       "capMm": cap_mm, "pinHem": pin_hem,
                       "hemFrac": hem_frac, "hemKeepMm": hem_keep,
                       "passes": int(args.passes),
                       "permuteSeed": int(args.permute_seed),
                       "permuted": bool(permuted),
                       "marginMm": margin, "gateRootMm": GATE_ROOT_MM,
                       "P": Pin, "yEarM": y_ear, "zNapeM": z_nape,
                       "boundaryWidthMm": W_WIDTH_M * 1000.0,
                       "arcLoMm": ARC_LO_M * 1000.0,
                       "arcHiMm": ARC_HI_M * 1000.0},
        "regionSplit": {"BACK": int(back_mask.sum()),
                        "FRONT": int((~back_mask).sum()), "total": int(n),
                        "backNonTuck": int(graph_mask.sum()),
                        "tuckTotal": int(tuck.sum()),
                        "wZeroRows": n_w0, "wOneRows": n_w1},
        "guides": {"input": int(n), "output": int(n), "deleted": 0,
                   "inputSha256": in_hash, "outputSha256": out_hash},
        "cap": cap_info,
        "pinHem": {"on": pin_hem,
                   "nPinned": int(hem_pinned.sum())},
        "hemBlend": hem_info,
        "guideMaxMoveMm": distribution(moved),
        "guideMaxMoveMmBACK": distribution(moved[back_mask]),
        "guideMaxMoveMmBACKNonTuck": distribution(moved[graph_mask]),
        "guideMaxMoveMmFRONT": distribution(moved[~back_mask]),
        "backPairs": {"n": int(len(tpairs))},
        "nearRootPairFullPathSeparationMmBeforeBACK": distribution(before),
        "nearRootPairFullPathSeparationMmAfterBACK": distribution(after),
        "crossingBACKNonTuck": {"input": xc_in, "output": xc_out,
                                "ratio": (round(xc_out["nCrossPairs"]
                                          / max(xc_in["nCrossPairs"], 1),
                                          4))},
        "takeoff": {"verbatimMm": float(args.verbatim_mm),
                    "verbatimSamples": n_verb,
                    "byteIdentical": exact_take,
                    "maxAbsDiffHeadMm": max_abs_take,
                    "pass": bool(exact_take)},
        "frontIdentical": {"samples": n_front,
                           "byteIdentical": exact_front,
                           "maxAbsDiffHeadMm": max_abs_front,
                           "pass": bool(exact_front)},
        "wZeroIdentical": {"rows": n_w0, "samples": n_w0samples,
                           "byteIdentical": exact_w0,
                           "pass": bool(exact_w0)},
        "body": {"samplesLtMargin": n_below, "samplesInside0": n_inside0,
                 "marginMm": margin},
        "hull": {"samplesOutsideHull": n_out_hull},
    }

    payload = {k: np.asarray(src[k]) for k in src.files}
    payload["curves_head"] = head_out.astype(np.float64)
    payload["spec_sha"] = np.array(["coherent21back"])
    payload["verdict"] = np.array(["COHERENT21BACK"])
    payload["roots_file"] = np.array([
        "guides-19 BACK position coherence from 40mm arc, anchor "
        "%.2f x1 pass, back non-tuck 20mm graph, 25mm boundary weight; "
        "FRONT + tuck byte-identical guides-19" % anchor
    ])
    np.savez_compressed(out / (args.stem + ".npz"), **payload)
    (out / (args.stem + "-fairing.json")).write_text(
        json.dumps(stats, indent=1) + "\n")
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
