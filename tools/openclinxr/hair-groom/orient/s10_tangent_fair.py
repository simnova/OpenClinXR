#!/usr/bin/env python3
"""Groom20 STEP 0: BACK-region tangent fairing; FRONT/TEMPLE byte-identical to groom19.

Region split by GUIDE ROOT (world metres via frames.head_to_world):
  BACK = (root_y < Y_EAR) & (root_z > Z_NAPE)
    Y_EAR  = -0.0635 m: coronal plane through the ear canals, defined as
             the mean of the left/right pinna-centroid y from
             hair-hull3/workspace/ear_pinna.npz
             (xpos median y -0.0589, xneg median y -0.0681; mean -0.0635).
             Median of the pooled pinna verts is -0.0607; the mean of the
             two side medians (-0.0635) is used so the plane sits between
             the canals rather than biasing to the denser side.
    Z_NAPE = 1.51 m: BACK requires root_z > 1.51 m (above the nape). Only
             3 of 2707 guide roots sit at/below 1.51 (the nape fringe);
             they stay FRONT/verbatim to avoid neck artifacts.
  FRONT/TEMPLE = the rest. Copied byte-identical from guides-19.npz
             (head-mm bits, all 41 samples per FRONT guide).

BACK treatment (from guides-8a originals):
- take-off verbatim only to 15 mm arc (the back has no hairline sweep
  to protect); every sample with arc < 15 mm copied from the input bits.
- unit tangents in each sample's scalp-tangent frame (normal = body-SDF
  gradient), smoothed over the neighbour graph of BACK guides whose
  roots are within 20 mm (3D chord), restricted to BACK guides on the
  SAME side of the part (part side-keying), tangential anchor 0.3 to the
  guide's own tangent, normal coefficient kept exact; two fairing passes
  (second pass re-smooths the first-pass tangents over the same graph
  and re-integrates from the same 15 mm point at the guide's own segment
  lengths), each new point projected to stay >= 1.5 mm outside the body.
- hull advisory only (outside-count reported, never enforced).
- never delete guides.

Part side-keying: part_x = median x of guide roots with z >= 1.63 m
(same crown-band definition as interp_children); side = sign(x-part_x).

Outputs: <outdir>/guides-20.npz + <outdir>/fairing.json.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import numpy as np
from scipy.spatial import cKDTree
from scipy import sparse

STRANDS = Path(__file__).resolve().parents[1] / "strands"
sys.path.insert(0, str(STRANDS))
import frames as F  # noqa: E402
from children import sdf_sampler  # noqa: E402

P_IN = 41
VERBATIM_BACK_MM = 15.0
KERNEL_MM = 20.0
ANCHOR = 0.3
PASSES = 2
GATE_ROOT_MM = 6.0
MARGIN_MM = 1.5
Y_EAR = -0.0635
Z_NAPE = 1.51


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--guides", required=True,
                   help="guides-8a.npz (fairing source for BACK)")
    p.add_argument("--guides19", required=True,
                   help="guides-19.npz (byte-identical source for FRONT)")
    p.add_argument("--sdf", required=True)
    p.add_argument("--hull", required=True)
    p.add_argument("--outdir", required=True)
    p.add_argument("--anchor", type=float, default=ANCHOR)
    p.add_argument("--kernel-mm", type=float, default=KERNEL_MM)
    p.add_argument("--verbatim-mm", type=float, default=VERBATIM_BACK_MM,
                   help="BACK verbatim arc (mm); FRONT is fully copied")
    p.add_argument("--passes", type=int, default=PASSES)
    p.add_argument("--margin-mm", type=float, default=MARGIN_MM)
    p.add_argument("--y-ear", type=float, default=Y_EAR)
    p.add_argument("--z-nape", type=float, default=Z_NAPE)
    return p.parse_args()


def distribution(a):
    a = np.asarray(a, dtype=np.float64)
    return {"n": int(a.size), "min": round(float(a.min()), 3),
            "p50": round(float(np.percentile(a, 50)), 3),
            "p90": round(float(np.percentile(a, 90)), 3),
            "p99": round(float(np.percentile(a, 99)), 3),
            "max": round(float(a.max()), 3)}


def pair_separation(curves, pairs):
    return np.linalg.norm(curves[pairs[:, 0]] - curves[pairs[:, 1]],
                          axis=2).max(axis=1)


def main():
    args = cli()
    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    anchor = float(args.anchor)
    assert abs(anchor - 0.3) < 1e-9, "BACK anchor must be 0.3 per card (got %s)" % anchor
    assert int(args.passes) == 2, "BACK requires two fairing passes per card"

    src = np.load(args.guides, allow_pickle=True)
    head_in = np.asarray(src["curves_head"], dtype=np.float64)
    crown = np.asarray(src["crown"], dtype=np.float64)
    n, Pin, _ = head_in.shape
    assert Pin == P_IN, (Pin, P_IN)
    curves = F.head_to_world(head_in, crown)  # world metres
    roots = curves[:, 0].copy()

    src19 = np.load(args.guides19, allow_pickle=True)
    head19 = np.asarray(src19["curves_head"], dtype=np.float64)
    assert head19.shape == head_in.shape, (head19.shape, head_in.shape)
    assert np.array_equal(np.asarray(src19["crown"]), crown), "crown mismatch"

    # region split
    y_ear = float(args.y_ear)
    z_nape = float(args.z_nape)
    back_mask = (roots[:, 1] < y_ear) & (roots[:, 2] > z_nape)
    front_mask = ~back_mask
    n_back = int(back_mask.sum())
    n_front = int(front_mask.sum())

    # part side-keying
    band = roots[roots[:, 2] >= 1.63]
    part_x = float(np.median(band[:, 0]))
    side = np.where(roots[:, 0] >= part_x, 1.0, -1.0)

    # arc length per guide (world metres)
    seg = np.linalg.norm(np.diff(curves, axis=1), axis=2)
    arc = np.concatenate([np.zeros((n, 1)), np.cumsum(seg, axis=1)], axis=1)
    verbatim = arc < (float(args.verbatim_mm) / 1000.0)
    verbatim[:, 0] = True
    k0 = verbatim.sum(axis=1)  # first faired index per guide

    # SDF sampler + gradient
    sdoc = np.load(args.sdf, allow_pickle=True)
    sample, _ = sdf_sampler(sdoc)
    eps = 0.002

    def grad(pts):
        pts = np.asarray(pts, dtype=np.float64)
        g = np.zeros_like(pts)
        for ax in range(3):
            d = np.zeros_like(pts)
            d[:, ax] = eps
            v1, _ = sample(pts + d)
            v0, _ = sample(pts - d)
            g[:, ax] = (v1 - v0) / (2.0 * eps)
        return g

    bidx = np.nonzero(back_mask)[0]
    nb = len(bidx)
    # neighbour graph on BACK roots only, 20 mm chord, same-side only
    b_tree = cKDTree(roots[back_mask])
    b_neigh = b_tree.query_ball_tree(b_tree, float(args.kernel_mm) / 1000.0)
    b_side = side[back_mask]
    rows, cols = [], []
    for i, js in enumerate(b_neigh):
        for j in js:
            if b_side[i] != b_side[j]:
                continue
            rows.append(i)
            cols.append(j)
    Wb = sparse.csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(nb, nb))
    Wb = Wb.multiply(1.0 / np.asarray(Wb.sum(axis=1)).ravel()[:, None]).tocsr()

    # hull sampler (nearest occupancy)
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
        out = np.zeros(len(pts_m), dtype=bool)
        out[valid] = occ[ix[valid], iy[valid], iz[valid]]
        return out

    def smooth_pass(curves_in):
        """One tangential smoothing pass over BACK guides; returns Ts (nb,P,3)
        unit smoothed tangents in world frame, plus frames for debug."""
        T = np.zeros_like(curves_in)
        T[:, 1:-1] = curves_in[:, 2:] - curves_in[:, :-2]
        T[:, 0] = curves_in[:, 1] - curves_in[:, 0]
        T[:, -1] = curves_in[:, -1] - curves_in[:, -2]
        Tn = np.linalg.norm(T, axis=2, keepdims=True)
        Tn[Tn == 0.0] = 1.0
        T = T / Tn
        C1 = np.zeros((nb, Pin))
        C2 = np.zeros((nb, Pin))
        Cn = np.zeros((nb, Pin))
        E1s = np.zeros((nb, Pin, 3))
        E2s = np.zeros((nb, Pin, 3))
        Ns = np.zeros((nb, Pin, 3))
        for j in range(Pin):
            pts = curves_in[:, j]
            g = grad(pts)
            gl = np.linalg.norm(g, axis=1)
            bad = (~np.isfinite(gl)) | (gl < 1e-9)
            g[bad] = np.array([0.0, 0.0, 1.0])
            gl[bad] = 1.0
            N = g / gl[:, None]
            ref = np.zeros_like(N)
            ref[:, 0] = 1.0
            flip = np.abs(N[:, 0]) > 0.9
            ref[flip, 0] = 0.0
            ref[flip, 1] = 1.0
            E1 = ref - (ref * N).sum(axis=1)[:, None] * N
            e1l = np.linalg.norm(E1, axis=1)
            e1l[e1l < 1e-12] = 1.0
            E1 = E1 / e1l[:, None]
            E2 = np.cross(N, E1)
            E1s[:, j] = E1
            E2s[:, j] = E2
            Ns[:, j] = N
            C1[:, j] = (T[:, j] * E1).sum(axis=1)
            C2[:, j] = (T[:, j] * E2).sum(axis=1)
            Cn[:, j] = (T[:, j] * N).sum(axis=1)
        S1 = anchor * C1 + (1.0 - anchor) * (Wb @ C1)
        S2 = anchor * C2 + (1.0 - anchor) * (Wb @ C2)
        Sn = Cn
        Ts = S1[:, :, None] * E1s + S2[:, :, None] * E2s + Sn[:, :, None] * Ns
        Tsl = np.linalg.norm(Ts, axis=2, keepdims=True)
        Tsl[~np.isfinite(Tsl)] = 1.0
        Tsl[Tsl < 1e-12] = 1.0
        Ts = Ts / Tsl
        return Ts

    # two passes, re-integrating from the same 15 mm verbatim point
    cur_back = curves[back_mask].copy()
    seg_back0 = np.linalg.norm(np.diff(curves[back_mask], axis=1), axis=2)
    k0b = k0[back_mask]
    for _pass in range(int(args.passes)):
        Ts = smooth_pass(cur_back)
        faired_b = cur_back.copy()
        margin = float(args.margin_mm)
        for ii in range(nb):
            k = int(k0b[ii])
            if k >= Pin:
                continue
            for j in range(k, Pin):
                Lj = float(seg_back0[ii, j - 1]) if j - 1 < seg_back0.shape[1] else 0.0
                if not np.isfinite(Lj) or Lj <= 0.0:
                    faired_b[ii, j] = faired_b[ii, j - 1]
                    continue
                cand = faired_b[ii, j - 1] + Ts[ii, j] * Lj
                for _ in range(50):
                    v, ins = sample(cand[None, :])
                    if not ins[0] or not np.isfinite(v[0]):
                        break
                    if v[0] >= margin:
                        break
                    gg = grad(cand[None, :])[0]
                    gl = float(np.linalg.norm(gg))
                    if not np.isfinite(gl) or gl < 1e-9:
                        gg = np.array([0.0, 0.0, 1.0])
                        gl = 1.0
                    step = (margin - float(v[0]) + 0.2) / 1000.0
                    cand = cand + (gg / gl) * step
                faired_b[ii, j] = cand
        cur_back = faired_b

    faired = curves.copy()
    faired[back_mask] = cur_back

    # head-mm output: FRONT copies guides-19 bits exactly; BACK verbatim
    # copies guides-8a bits, faired indices recomputed from world
    head_out = np.empty_like(head_in)
    head_out[front_mask] = head19[front_mask]
    # BACK verbatim part: copy input bits
    for i_g, ii in enumerate(bidx):
        k = int(k0[ii])
        head_out[ii, :k] = head_in[ii, :k]
        for j in range(k, Pin):
            w = faired[ii, j]
            head_out[ii, j, 0] = w[0] * 1000.0
            head_out[ii, j, 1] = (float(crown[1]) - w[1]) * 1000.0
            head_out[ii, j, 2] = (float(crown[2]) - w[2]) * 1000.0

    # stats
    moved = np.linalg.norm(faired - curves, axis=2).max(axis=1) * 1000.0
    moved_back = moved[back_mask]
    moved_front = moved[front_mask]
    tree = cKDTree(roots[back_mask])
    tpairs = np.asarray(list(tree.query_pairs(GATE_ROOT_MM / 1000.0)),
                        dtype=np.int64)
    before = pair_separation(curves[back_mask], tpairs) * 1000.0 if len(tpairs) else np.zeros(0)
    after = pair_separation(faired[back_mask], tpairs) * 1000.0 if len(tpairs) else np.zeros(0)

    def dist(a):
        a = np.asarray(a, dtype=np.float64)
        if not a.size:
            return {"n": 0}
        return {"n": int(a.size), "min": round(float(a.min()), 3),
                "p50": round(float(np.percentile(a, 50)), 3),
                "p90": round(float(np.percentile(a, 90)), 3),
                "p99": round(float(np.percentile(a, 99)), 3),
                "max": round(float(a.max()), 3)}

    n_verbatim_back = int(verbatim[back_mask].sum())
    exact_back = bool(np.array_equal(head_out[back_mask][verbatim[back_mask]],
                                     head_in[back_mask][verbatim[back_mask]]))
    max_abs_back = float(np.abs(head_out[back_mask][verbatim[back_mask]]
                                - head_in[back_mask][verbatim[back_mask]]).max()) \
        if n_verbatim_back else 0.0
    # FRONT byte-identical (all samples)
    n_front_samples = int(front_mask.sum() * Pin)
    exact_front = bool(np.array_equal(head_out[front_mask], head19[front_mask]))
    max_abs_front = float(np.abs(head_out[front_mask] - head19[front_mask]).max()) \
        if n_front_samples else 0.0

    flat = faired.reshape(-1, 3)
    vals, ins = sample(flat)
    n_below = int((ins & (vals < margin)).sum())
    n_inside0 = int((ins & (vals < 0.0)).sum())
    hull_in = inside_hull(flat)
    n_out_hull = int((~hull_in).sum())

    stats = {
        "schema": "openclinxr.hair-guide-back-tangent-fair.v1",
        "method": "BACK-region scalp-tangent-frame unit-tangent smoothing over same-side BACK 20mm root graph, anchor 0.3, two passes, re-integrate at own segment lengths from 15mm, hull+body projection; FRONT copied byte-identical from guides-19",
        "parameters": {"anchor": anchor, "kernelMm": float(args.kernel_mm),
                        "verbatimBackMm": float(args.verbatim_mm),
                        "passes": int(args.passes),
                        "marginMm": margin, "gateRootMm": GATE_ROOT_MM,
                        "P": Pin, "yEarM": y_ear, "zNapeM": z_nape,
                        "partXM": part_x},
        "regionSplit": {"BACK": n_back, "FRONT": n_front, "total": int(n),
                        "yEarM": y_ear, "zNapeM": z_nape, "partXM": part_x},
        "guides": {"input": int(n), "output": int(n), "deleted": 0,
                   "verbatimBackSamples": n_verbatim_back,
                   "frontSamplesCopied": n_front_samples},
        "guideMaxMoveMm": dist(moved),
        "guideMaxMoveMmBACK": dist(moved_back),
        "guideMaxMoveMmFRONT": dist(moved_front),
        "backPairs": {"n": int(len(tpairs))},
        "nearRootPairFullPathSeparationMmBeforeBACK": dist(before),
        "nearRootPairFullPathSeparationMmAfterBACK": dist(after),
        "coherenceGateBACK": {"p90MaxMm": 25.0, "absoluteMaxMm": 60.0,
                              "pass": bool(len(after) and np.percentile(after, 90) <= 25.0
                                            and after.max() <= 60.0)},
        "takeoffBACK": {"verbatimSamples": n_verbatim_back,
                        "byteIdentical": exact_back,
                        "maxAbsDiffHeadMm": max_abs_back,
                        "pass": bool(exact_back)},
        "frontIdentical": {"samples": n_front_samples,
                           "byteIdentical": exact_front,
                           "maxAbsDiffHeadMm": max_abs_front,
                           "pass": bool(exact_front)},
        "body": {"samplesLtMargin": n_below, "samplesInside0": n_inside0,
                 "marginMm": margin},
        "hull": {"samplesOutsideHull": n_out_hull},
    }

    payload = {k: np.asarray(src[k]) for k in src.files}
    payload["curves_head"] = head_out.astype(np.float64)
    payload["spec_sha"] = np.array(["tangentfair20back"])
    payload["verdict"] = np.array(["FAIRED20"])
    payload["roots_file"] = np.array([
        "guides-8a BACK tangent fairing from 15mm arc, anchor 0.30 x2 passes, same-side 20mm graph; FRONT byte-identical guides-19"
    ])
    np.savez_compressed(out / "guides-20.npz", **payload)
    (out / "fairing.json").write_text(json.dumps(stats, indent=1) + "\n")
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
