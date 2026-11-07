#!/usr/bin/env python3
"""Groom29 STEP 1: re-drape the world -x BACK curtain before fairing.

Cause (groom28, measured): guides-19's world -x back drape is a narrow
central curtain (hem |x| p50 11.7 mm vs 24.1 mm on +x for all back
non-tuck guides; 7.3 vs 46.9 mm for the long-arc subset); the anchor-0.6
fairing drags the inner half of that curtain outward ~20 mm and scatters
it, losing cover image-right. The fairing code is x-symmetric and the
azimuth cut is inert, so the fix is geometric: spread the -x drape to
mirror the +x drape BEFORE fairing.

What this stage does (guides-19 -> guides-29a, no other input):
- Set S: world -x (root x < 0) BACK (root_y < Y_EAR, root_z > Z_NAPE)
  non-tuck guides with total arc > 40 mm (mappable drape; shorter guides
  are entirely inside the take-off and stay verbatim). Set T: the +x
  mirror set (same cuts). T is the target distribution and is NEVER
  modified.
- HEM quantile mapping: the S hem-|x| distribution is quantile-mapped
  onto the T hem-|x| distribution (per-guide mid-quantile rank ->
  target hem). Each guide keeps its input lateral SHAPE; only a scalar
  hem offset results.
- Apply laterally only (x changes; y, z verbatim) as an ADDITIVE shift:
  x_out = x_in + s*phi*d_hem, with s the guide's take-off-exit sign and
  phi a monotone C1 fraction ramp (0 at/below the take-off exit at arc
  40 mm -- root and take-off byte-verbatim -- smoothstep to 1 at the
  hem). Additive (never mirrored) means no cusps can form where strands
  cross the midline: for -x hems the landing is EXACT (-tgt); crossed
  hems land fanned at 2*hem-tgt. Earlier variants (per-fraction surface
  mapping; mirrored |x|) folded strands (measured max kink 114-176 deg)
  and were reverted. Barely-long guides (total 40-120 mm) get a
  smoothstep dilution to full weight at >= 120 mm, so short hinges stay
  gentle. Short guides (total <= 40 mm) are fully verbatim.
- Exit-sign rule (fold-free): each guide keeps the sign of its input x
  at the take-off exit uniformly (guides that crossed to +x inside the
  take-off stay crossed; guides that wrap to centre past take-off --
  the narrow-curtain hem behaviour -- stay on -x and fan out).
- Body guard per modified guide: no NEW SDF < 1.5 mm samples on moved
  samples (strict, backtrack to zero). Hull is advisory: hull5 does not
  contain the real drape (the +x reference itself is 29% outside on
  moved samples), so new hull-outside samples are allowed up to the +x
  reference rate and reported (symmetric-envelope reading).
- Untouched rows (all +x guides, all FRONT/TEMPLE guides, all tuck
  guides, all verbatim samples) copy the input head-mm bits exactly;
  hashes are reported to prove it.

Complexity: O(n*P) over guides only; no O(n^2) passes, no
children touches.

Outputs: <outdir>/<stem>.npz + <stem>-redrape.json (re-drape table:
before/after hem |x| p50/p90 per side + long-subset table, hashes,
body/hull counts, kink check).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
from scipy import ndimage

S14 = Path(__file__).resolve().parent
sys.path.insert(0, str(S14.parent / "strands"))
import frames as F  # noqa: E402
from children import sdf_sampler  # noqa: E402

P_IN = 41
VERBATIM_MM = 40.0
RAMP_MM = 40.0  # smoothstep 40 -> 80 mm of own arc
Y_EAR = -0.0635
Z_NAPE = 1.51
MARGIN_MM = 1.5
NF = 41
NV = 64
SURF_SIGMA = 1.5


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--guides", required=True, help="guides-19.npz")
    p.add_argument("--sdf", required=True)
    p.add_argument("--hull", required=True)
    p.add_argument("--outdir", required=True)
    p.add_argument("--stem", default="guides-29a")
    p.add_argument("--verbatim-mm", type=float, default=VERBATIM_MM)
    p.add_argument("--ramp-mm", type=float, default=RAMP_MM)
    p.add_argument("--margin-mm", type=float, default=MARGIN_MM)
    return p.parse_args()


def dist(a):
    a = np.asarray(a, dtype=np.float64)
    if not a.size:
        return {"n": 0}
    return {"n": int(a.size), "min": round(float(a.min()), 3),
            "mean": round(float(a.mean()), 3),
            "p50": round(float(np.percentile(a, 50)), 3),
            "p90": round(float(np.percentile(a, 90)), 3),
            "max": round(float(a.max()), 3)}


def smoothstep(t):
    t = np.clip(np.asarray(t, dtype=np.float64), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def max_turn_deg(curves):
    d = np.diff(curves, axis=1)
    n0 = np.linalg.norm(d[:, :-1], axis=2)
    n1 = np.linalg.norm(d[:, 1:], axis=2)
    denom = np.maximum(n0 * n1, 1e-12)
    cosang = np.clip((d[:, :-1] * d[:, 1:]).sum(axis=2) / denom, -1.0, 1.0)
    return np.degrees(np.arccos(cosang)).max(axis=1)


def main():
    t0 = time.time()
    args = cli()
    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    verb_m = float(args.verbatim_mm) / 1000.0
    ramp_m = float(args.ramp_mm) / 1000.0

    src = np.load(args.guides, allow_pickle=True)
    head_in = np.asarray(src["curves_head"], dtype=np.float64)
    crown = np.asarray(src["crown"], dtype=np.float64)
    n, Pin, _ = head_in.shape
    assert Pin == P_IN, (Pin, P_IN)
    curves = F.head_to_world(head_in, crown)  # world metres
    roots = curves[:, 0].copy()
    tuck = (np.asarray(src["tuck"]) > 0.5) if "tuck" in src else np.zeros(n, dtype=bool)

    back_mask = (roots[:, 1] < Y_EAR) & (roots[:, 2] > Z_NAPE)
    graph_mask = back_mask & ~tuck

    seg = np.linalg.norm(np.diff(curves, axis=1), axis=2)
    arc = np.concatenate([np.zeros((n, 1)), np.cumsum(seg, axis=1)], axis=1)
    total = arc[:, -1]
    long_mask = total > verb_m  # mappable drape; rest fully verbatim

    pos_mask = graph_mask & (roots[:, 0] >= 0.0) & long_mask  # T set
    neg_mask = graph_mask & (roots[:, 0] < 0.0) & long_mask    # S set
    s_idx = np.nonzero(neg_mask)[0]
    nT, nS = int(pos_mask.sum()), int(neg_mask.sum())
    assert nT > 10 and nS > 10, (nT, nS)

    # exit sign per guide (fold-free rule): sign of input x at the
    # take-off exit (first sample with arc >= 40 mm), uniform over all
    # written samples (see SIGN RULE below)
    exit_j = np.argmax(arc[s_idx] >= verb_m, axis=1)
    sgn_exit = np.full(nS, -1.0)
    for k in range(nS):
        i = int(s_idx[k])
        e = int(exit_j[k])
        for j in range(e, P_IN):
            if curves[i, j, 0] > 0.0:
                sgn_exit[k] = 1.0
                break
            if curves[i, j, 0] < 0.0:
                sgn_exit[k] = -1.0
                break

    # HEM quantile mapping + monotone fraction ramp. (A per-fraction
    # surface mapping was tried first: even with surface smoothing,
    # delta smoothing and sign rules it folded strands -- measured max
    # kink 114-176 deg -- because quantile matching AMPLIFIES input
    # wiggles where S is concentrated relative to T. The hem-scalar +
    # monotone ramp below cannot introduce wiggles by construction:
    # each strand keeps its input lateral shape, spread by a smoothly
    # varying scalar offset.)
    hem_T = np.abs(curves[pos_mask][:, -1, 0])
    ax = np.abs(curves[..., 0])  # (n, P)
    hem_S = ax[s_idx, -1]
    t_sorted = np.sort(hem_T)
    order = np.argsort(hem_S, kind="stable")
    ranks = np.empty(nS)
    ranks[order] = (np.arange(nS) + 0.5) / nS  # mid-quantiles, tie-stable
    tgt_hem = np.interp(ranks, (np.arange(nT) + 0.5) / nT, t_sorted)
    hem_signed = curves[s_idx, -1, 0]  # signed input hem x (metres)
    total_S = total[s_idx]
    # dilution for barely-long guides: full weight at total >= 120 mm,
    # smoothstepped to 0 at the 40 mm take-off (a 20 mm hem move over
    # 9 mm of strand would hinge-sharp otherwise)
    dil = smoothstep((total_S * 1000.0 - float(args.verbatim_mm)) / 80.0)
    # SIGNED landing: full-weight guides land EXACTLY on s*tgt (both -x
    # hems and crossed hems); the additive shift only moves the midline-
    # crossing point, never mirroring, so no cusp can form
    d_hem = (sgn_exit * tgt_hem - hem_signed) * dil
    # monotone C1 ramp per guide: 0 at take-off exit, 1 at hem
    with np.errstate(divide="ignore", invalid="ignore"):
        f_own = np.where(total[:, None] > 1e-12,
                         arc / np.maximum(total[:, None], 1e-12), 0.0)
    f_own[:, 0] = 0.0
    f_exit = (float(args.verbatim_mm) / 1000.0) / np.maximum(total_S, 1e-12)
    f_exit = np.minimum(f_exit, 1.0)
    phi = np.zeros((nS, P_IN))
    for k in range(nS):
        fe = float(f_exit[k])
        if fe >= 1.0:
            continue
        phi[k] = smoothstep((f_own[int(s_idx[k])] - fe) / max(1.0 - fe, 1e-12))
        phi[k][arc[int(s_idx[k])] < verb_m] = 0.0
    # SIGN RULE (fold-free): exit sign uniform over written samples (see
    # above). Verbatim samples keep input bits, and phi = 0 at the exit,
    # so the junction is continuous by construction; no mid-strand sign
    # flip can fold the strand. Guides that crossed to +x inside the
    # take-off stay crossed; guides that wrap to centre past take-off
    # (the narrow-curtain hem behaviour) are pulled back to -x and fan
    # out -- the additive shift only moves the crossing point, smoothly.
    sgn = np.tile(sgn_exit[:, None], (1, P_IN))
    # NOTE d_hem already carries the exit sign (d = s*tgt - hem); it is
    # applied directly, NOT multiplied by sgn again
    new_x = curves[s_idx][..., 0] + phi * d_hem[:, None]
    new_world = curves[s_idx].copy()
    new_world[..., 0] = new_x
    # effective per-sample applied delta (for the guard backtrack)
    w_arc = phi  # ramp weights, 0 below take-off
    delta = phi * d_hem[:, None]

    # body/hull guard. Measured (groom29 probe): on moved samples
    # (arc >= 40 mm) the +x reference drape itself has ZERO SDF < 1.5 mm
    # samples but 928 hull5-outside samples -- hull5 does not contain the
    # real drape, so an absolute inside-hull rule would forbid mirroring
    # +x. Rule enforced here: no NEW body violations (SDF < margin) on
    # moved samples (strict, backtrack to zero); hull is advisory --
    # new hull-outside samples are allowed up to the +x reference rate
    # and reported (symmetric-envelope reading of "inside the hull").
    sample, _ = sdf_sampler(np.load(args.sdf, allow_pickle=True))
    H = np.load(str(args.hull), allow_pickle=True)
    occ = np.asarray(H["occupancy"], dtype=bool)
    xs, ys, zs = (np.asarray(H["xs"], dtype=np.float64),
                  np.asarray(H["ys"], dtype=np.float64),
                  np.asarray(H["zs"], dtype=np.float64))
    sp = float(H["spacing"])
    x0, y0, z0 = float(xs[0]), float(ys[0]), float(zs[0])
    nx, ny, nz = occ.shape

    def violations(pts):
        flat = np.asarray(pts, dtype=np.float64).reshape(-1, 3)
        vals, ins = sample(flat)
        bad_body = (ins & (vals < float(args.margin_mm))).reshape(pts.shape[:2])
        pmm = flat * 1000.0
        ix = np.round((pmm[:, 0] - x0) / sp).astype(np.int64)
        iy = np.round((pmm[:, 1] - y0) / sp).astype(np.int64)
        iz = np.round((pmm[:, 2] - z0) / sp).astype(np.int64)
        valid = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny) & (iz >= 0) & (iz < nz)
        o = np.zeros(len(flat), dtype=bool)
        o[valid] = occ[ix[valid], iy[valid], iz[valid]]
        bad_hull = (~o).reshape(pts.shape[:2])
        return bad_body | bad_hull

    def body_bad(pts):
        flat = np.asarray(pts, dtype=np.float64).reshape(-1, 3)
        vals, ins = sample(flat)
        return ((ins & (vals < float(args.margin_mm)))
                .reshape(np.asarray(pts).shape[:2]))

    base = curves[s_idx]
    base_bad = body_bad(base)
    scale = np.ones(nS)
    n_scaled = 0
    n_reverted = 0
    for k in range(nS):
        moved_m = (arc[s_idx[k]] >= verb_m) & (w_arc[k] > 0)
        if not moved_m.any():
            scale[k] = 0.0
            n_reverted += 1
            continue
        bb = base_bad[k] & moved_m
        if not (body_bad(new_world[k:k + 1])[0] & moved_m & ~bb).any():
            continue
        s = 1.0
        trial = new_world[k]
        for _ in range(12):
            s *= 0.5
            trial = base[k].copy()
            trial[..., 0] = base[k][:, 0] + s * phi[k] * d_hem[k]
            if not (body_bad(trial[None])[0] & moved_m & ~bb).any():
                break
        else:
            trial = base[k].copy()
            s = 0.0
        new_world[k] = trial
        scale[k] = s
        if s == 0.0:
            n_reverted += 1
        else:
            n_scaled += 1

    # head-mm bits: untouched rows/samples copy input exactly
    head_out = head_in.copy()
    for k in range(nS):
        i = int(s_idx[k])
        p = new_world[k]
        for j in range(P_IN):
            if arc[i, j] < verb_m:
                continue  # keep input bits verbatim
            head_out[i, j, 0] = p[j, 0] * 1000.0
            head_out[i, j, 1] = (float(crown[1]) - p[j, 1]) * 1000.0
            head_out[i, j, 2] = (float(crown[2]) - p[j, 2]) * 1000.0
    world_out = F.head_to_world(head_out, crown)

    # ---- verification ----
    hem_in = np.abs(curves[:, -1, 0]) * 1000.0
    hem_out = np.abs(world_out[:, -1, 0]) * 1000.0
    gm = graph_mask
    pxm = gm & (roots[:, 0] >= 0.0)
    nxm = gm & (roots[:, 0] < 0.0)
    table_all = {}
    for nm, m in (("posX", pxm), ("negX", nxm)):
        table_all[nm] = {"before": dist(hem_in[m]), "after": dist(hem_out[m])}
    table_long = {}
    for nm, m in (("posX", pxm & long_mask), ("negX", nxm & long_mask)):
        table_long[nm] = {"before": dist(hem_in[m]), "after": dist(hem_out[m])}
    # mid-strand spread check: |x| at arc fraction 0.5, long subsets
    def mid_absx(world, mask):
        idx = np.nonzero(mask)[0]
        f = arc[idx] / np.maximum(total[idx, None], 1e-12)
        axm = np.abs(world[idx, :, 0])
        return np.array([np.interp(0.5, f[k], axm[k]) for k in range(len(idx))]) * 1000.0
    table_mid = {}
    for nm, m in (("posX", pxm & long_mask), ("negX", nxm & long_mask)):
        table_mid[nm] = {"before": dist(mid_absx(curves, m)),
                         "after": dist(mid_absx(world_out, m))}

    def rows_sha(rows):
        h = hashlib.sha256()
        h.update(np.ascontiguousarray(head_out[rows]).tobytes())
        return h.hexdigest()

    def rows_sha_in(rows):
        h = hashlib.sha256()
        h.update(np.ascontiguousarray(head_in[rows]).tobytes())
        return h.hexdigest()

    all_rows = np.arange(n)
    pos_rows = np.nonzero(pxm | (~gm & (roots[:, 0] >= 0.0)))[0]
    front_rows = np.nonzero(~back_mask)[0]
    plus_rows = np.nonzero((roots[:, 0] >= 0.0) | ~graph_mask)[0]
    # every row that is NOT a modified S row must be bit-identical
    unmod = np.nonzero(~neg_mask)[0]
    exact_unmod = bool(np.array_equal(head_out[unmod], head_in[unmod]))
    # verbatim samples of modified rows must be bit-identical
    verb = arc < verb_m
    # direct per-sample check:
    vt = True
    for k in range(nS):
        i = int(s_idx[k])
        m = arc[i] < verb_m
        if not np.array_equal(head_out[i][m], head_in[i][m]):
            vt = False
            break

    moved = np.linalg.norm(world_out - curves, axis=2).max(axis=1) * 1000.0
    kink_before = max_turn_deg(curves[s_idx])
    kink_after = max_turn_deg(world_out[s_idx])

    flat_o = world_out.reshape(-1, 3)
    vals, ins = sample(flat_o)
    n_below = int((ins & (vals < float(args.margin_mm))).sum())
    n_inside0 = int((ins & (vals < 0.0)).sum())
    bad_out = violations(world_out)
    bad_in = violations(curves)
    # new violations restricted to moved samples of S guides must be zero
    moved_all = np.zeros((n, P_IN), dtype=bool)
    moved_all[s_idx] = (arc[s_idx] >= verb_m) & (phi > 0)
    n_new_viol = int((bad_out & ~bad_in & moved_all).sum())
    # hull advisory: hull-outside rate on moved samples, S before/after
    # vs the +x reference T rate (symmetric-envelope check)
    t_rows = np.nonzero(pos_mask)[0]
    moved_T = (arc[t_rows] >= verb_m)
    hull_T = float(bad_in[t_rows][moved_T].mean()) if moved_T.any() else 0.0
    hull_S_before = float((bad_in[s_idx] & moved_all[s_idx]).mean())
    hull_S_after = float((bad_out[s_idx] & moved_all[s_idx]).mean())
    pmm = flat_o * 1000.0
    ix = np.round((pmm[:, 0] - x0) / sp).astype(np.int64)
    iy = np.round((pmm[:, 1] - y0) / sp).astype(np.int64)
    iz = np.round((pmm[:, 2] - z0) / sp).astype(np.int64)
    valid = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny) & (iz >= 0) & (iz < nz)
    o = np.zeros(len(flat_o), dtype=bool)
    o[valid] = occ[ix[valid], iy[valid], iz[valid]]
    n_out_hull = int((~o).sum())

    h = hashlib.sha256()
    h.update(np.ascontiguousarray(head_out).tobytes())
    h2 = hashlib.sha256()
    h2.update(np.ascontiguousarray(head_in).tobytes())

    stats = {
        "schema": "openclinxr.hair-guide-back-redrape-negx.v1",
        "method": ("hem-quantile-map -x BACK long-drape |x| to +x hem "
                   "distribution, monotone C1 fraction ramp, exit-sign "
                   "rule, lateral-only; root/take-off verbatim; "
                   "+x/FRONT/tuck byte-identical"),
        "parameters": {"verbatimMm": float(args.verbatim_mm),
                       "dilutionFullMm": 120.0,
                       "marginMm": float(args.margin_mm),
                       "yEarM": Y_EAR, "zNapeM": Z_NAPE, "P": P_IN,
                       "nFrac": NF},
        "sets": {"backNonTuck": int(gm.sum()),
                 "posXlong_T": nT, "negXlong_S": nS,
                 "negXshortVerbatim": int((nxm & ~long_mask).sum()),
                 "posXshortVerbatim": int((pxm & ~long_mask).sum())},
        "hemAbsXmm_allBackNonTuck": table_all,
        "hemAbsXmm_longSubset": table_long,
        "midAbsXmm_frac05_longSubset": table_mid,
        "byteIdentical": {
            "nonSRowsExact": exact_unmod,
            "nonSRowsShaIn": rows_sha_in(unmod),
            "nonSRowsShaOut": rows_sha(unmod),
            "takeoffSamplesExact_S": bool(vt),
        },
        "moveMm_S": dist(moved[s_idx]),
        "guard": {"nScaledBack": int(n_scaled), "nReverted": int(n_reverted),
                  "scales": dist(scale),
                  "nNewViolationsMovedSamples": int(n_new_viol),
                  "hullOutsideRateMoved": {
                      "S_before": round(hull_S_before, 4),
                      "S_after": round(hull_S_after, 4),
                      "T_ref": round(hull_T, 4)}},
        "kinkDeg_S": {"before": dist(kink_before), "after": dist(kink_after)},
        "body": {"samplesLtMargin": n_below, "samplesInside0": n_inside0,
                 "marginMm": float(args.margin_mm)},
        "hull": {"samplesOutsideHull": n_out_hull},
        "guides": {"input": int(n), "output": int(n), "deleted": 0,
                   "inputSha256": h2.hexdigest(),
                   "outputSha256": h.hexdigest()},
        "seconds": round(time.time() - t0, 1),
    }

    payload = {k: np.asarray(src[k]) for k in src.files}
    payload["curves_head"] = head_out.astype(np.float64)
    payload["spec_sha"] = np.array(["redrape29a-negx"])
    payload["verdict"] = np.array(["REDRAPE29A"])
    payload["roots_file"] = np.array([
        "guides-19 -x BACK long drape quantile-mapped to +x |x|(f); "
        "lateral-only, ramp 40-80mm; FRONT/+x/tuck verbatim"])
    np.savez_compressed(out / (args.stem + ".npz"), **payload)
    (out / (args.stem + "-redrape.json")).write_text(
        json.dumps(stats, indent=1) + "\n")
    print(json.dumps({"hem_all": {k: {"before_p50": v["before"]["p50"],
                                      "before_p90": v["before"]["p90"],
                                      "after_p50": v["after"]["p50"],
                                      "after_p90": v["after"]["p90"]}
                                  for k, v in table_all.items()},
                      "hem_long": {k: {"before_p50": v["before"]["p50"],
                                       "before_p90": v["before"]["p90"],
                                       "after_p50": v["after"]["p50"],
                                       "after_p90": v["after"]["p90"]}
                                   for k, v in table_long.items()},
                      "nonSRowsExact": exact_unmod, "takeoffExact": bool(vt),
                      "nScaledBack": int(n_scaled), "nReverted": int(n_reverted),
                      "nNewViol": int(n_new_viol),
                      "body": stats["body"], "hull": stats["hull"],
                      "sha": h.hexdigest()}, indent=1))


if __name__ == "__main__":
    main()
