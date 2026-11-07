#!/usr/bin/env python3
"""Groom22 STEP 1+2: measure then smooth the BACK orientation-field voxels.

Measure (card step 1):
  Per field voxel (hair-orient0/field.npz domain), the unsigned angular
  disagreement to its present 26-neighbours (arccos(|dot|) in degrees,
  0..90). Pooled over neighbour pairs per region + per-voxel means.
  Regions (voxel xyz_mm): BACK = (y < Y_EAR) & (z > Z_NAPE),
  FRONT = the rest of the field domain. Y_EAR=-63.5mm, Z_NAPE=1510mm
  (same planes as the guide-root split; stated).
  Eigen quantities archived in field.npz (gap, beta, nviews) per region.
  NOTE: s02 does not archive lam0 itself, so the smallest-eigenvector
  residual lam0/trace cannot be read back exactly; gap=(l1-l0)/trace,
  beta and nviews are reported as the archived eigen-certainty record.

Smooth (card step 2):
  Coherence-weighted Laplacian on BACK voxels only. Weight = eigen
  certainty c = clip(gap/GAP0,0,1) * min(nviews,2)/2 (== s02 beta).
  Each iteration: for every BACK voxel, sign-align present neighbours
  to the voxel, take the certainty-weighted mean direction m, then
  t <- normalize((1-lam)*t + lam*m) with lam=0.5. FRONT voxels are
  never updated (used as fixed boundary neighbours). Iterate until the
  BACK pooled-pair disagreement p90 <= FRONT pooled-pair p90 measured
  in step 1 (front reference fixed before smoothing), max 200 iters.

Outputs:
  E/back-field.json  measure record (before; front reference p90)
  E/back-field.png   back-view (x-z) voxel scatter coloured by per-voxel
                     mean disagreement + groom19 crossing-pair midpoints
  <outdir>/field-smooth22.npz  smoothed field (same idx/xyz, dir updated
                     on BACK voxels only) + <outdir>/field-smooth22.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

S12 = Path(__file__).resolve().parent
sys.path.insert(0, str(S12))
sys.path.insert(0, str(S12.parent / "strands"))
import frames as F  # noqa: E402  (world/head conversions for guides)

Y_EAR_MM = -63.5
Z_NAPE_MM = 1510.0
GAP0 = 0.2
LAM = 0.5
MAX_ITERS = 200
ARC_LO_M = 0.040
ARC_HI_M = 0.200


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--field", required=True, help="hair-orient0/field.npz")
    p.add_argument("--guides", required=True, help="guides-19.npz")
    p.add_argument("--outdir", required=True, help="evidence dir E")
    p.add_argument("--smooth-outdir", required=True)
    p.add_argument("--stem", default="field-smooth22")
    return p.parse_args()


def dist(a):
    a = np.asarray(a, dtype=np.float64)
    if not a.size:
        return {"n": 0}
    return {"n": int(a.size), "min": round(float(a.min()), 3),
            "p50": round(float(np.percentile(a, 50)), 3),
            "p90": round(float(np.percentile(a, 90)), 3),
            "max": round(float(a.max()), 3),
            "mean": round(float(a.mean()), 3)}


def crossing_pairs(curves, crown, mask):
    """Copied semantics from s11_back_coherent.crossing_count (verbatim
    logic): returns (cross pair index list over masked guides, window info)."""
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
    pairs = []
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
                pairs.append((int(idx[i]), int(idx[j])))
    return pairs, {"win": win, "u": u, "v": v, "arc": arc}


def main():
    args = cli()
    E = Path(args.outdir)
    E.mkdir(parents=True, exist_ok=True)
    SO = Path(args.smooth_outdir)
    SO.mkdir(parents=True, exist_ok=True)

    fld = np.load(args.field, allow_pickle=True)
    idx = np.asarray(fld["idx"], dtype=np.int64)
    xyz = np.asarray(fld["xyz_mm"], dtype=np.float64)
    tdir = np.asarray(fld["dir"], dtype=np.float64)
    gap = np.asarray(fld["gap"], dtype=np.float64)
    beta = np.asarray(fld["beta"], dtype=np.float64)
    nviews = np.asarray(fld["nviews"]).astype(np.int64)
    xs = np.asarray(fld["xs"], dtype=np.float64)
    ys = np.asarray(fld["ys"], dtype=np.float64)
    zs = np.asarray(fld["zs"], dtype=np.float64)
    spacing = float(np.asarray(fld["spacing"]).ravel()[0])
    n = len(idx)
    shape = (int(idx[:, 0].max() + 1), int(idx[:, 1].max() + 1),
             int(idx[:, 2].max() + 1))

    back_vox = (xyz[:, 1] < Y_EAR_MM) & (xyz[:, 2] > Z_NAPE_MM)
    front_vox = ~back_vox

    # dense position -> row id
    pos2row = -np.ones(shape, dtype=np.int64)
    pos2row[idx[:, 0], idx[:, 1], idx[:, 2]] = np.arange(n, dtype=np.int64)

    offs = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1)
            for dz in (-1, 0, 1) if not (dx == 0 and dy == 0 and dz == 0)]

    def pooled_stats(mask, dirs):
        pair_angles = []
        pervox_mean = np.full(n, np.nan)
        pervox_p90 = np.full(n, np.nan)
        rows = np.nonzero(mask)[0]
        for r in rows:
            ix, iy, iz = idx[r]
            nb = []
            for (dx, dy, dz) in offs:
                jx, jy, jz = ix + dx, iy + dy, iz + dz
                if jx < 0 or jy < 0 or jz < 0 or jx >= shape[0] \
                        or jy >= shape[1] or jz >= shape[2]:
                    continue
                q = pos2row[jx, jy, jz]
                if q < 0:
                    continue
                d = abs(float(dirs[r] @ dirs[q]))
                d = min(d, 1.0)
                a = float(np.degrees(np.arccos(d)))
                nb.append(a)
                # count each unordered pair once (q > r to avoid double)
                if q > r:
                    pair_angles.append(a)
            if nb:
                nb = np.asarray(nb)
                pervox_mean[r] = float(nb.mean())
                pervox_p90[r] = float(np.percentile(nb, 90))
        pair_angles = np.asarray(pair_angles, dtype=np.float64)
        return pair_angles, pervox_mean, pervox_p90

    b_pairs, b_mean, b_p90 = pooled_stats(back_vox, tdir)
    f_pairs, f_mean, f_p90 = pooled_stats(front_vox, tdir)
    front_ref_p90 = float(np.percentile(f_pairs, 90)) if f_pairs.size else 90.0

    rec = {
        "schema": "openclinxr.hair-back-field-measure.v1",
        "field": str(args.field),
        "guides": str(args.guides),
        "region": {"yEarMm": Y_EAR_MM, "zNapeMm": Z_NAPE_MM,
                   "backVoxels": int(back_vox.sum()),
                   "frontVoxels": int(front_vox.sum()),
                   "totalVoxels": int(n), "spacingMm": spacing},
        "disagreementDeg": {
            "backPooledPairs": dist(b_pairs),
            "frontPooledPairs": dist(f_pairs),
            "backPerVoxMean": dist(b_mean[back_vox & np.isfinite(b_mean)]),
            "backPerVoxP90": dist(b_p90[back_vox & np.isfinite(b_p90)]),
            "frontPerVoxMean": dist(f_mean[front_vox & np.isfinite(f_mean)]),
            "frontPerVoxP90": dist(f_p90[front_vox & np.isfinite(f_p90)]),
            "frontRefP90": round(front_ref_p90, 3)},
        "eigen": {
            "note": "s02 archives gap/beta/nviews, not lam0; "
                    "residual lam0/trace not recoverable exactly",
            "backGap": dist(gap[back_vox]),
            "frontGap": dist(gap[front_vox]),
            "backBeta": dist(beta[back_vox]),
            "frontBeta": dist(beta[front_vox]),
            "backNviewsMean": round(float(nviews[back_vox].mean()), 3),
            "frontNviewsMean": round(float(nviews[front_vox].mean()), 3)},
    }

    # groom19 crossing pairs (s11 metric) for the overlay + record
    src = np.load(args.guides, allow_pickle=True)
    head_in = np.asarray(src["curves_head"], dtype=np.float64)
    crown = np.asarray(src["crown"], dtype=np.float64)
    curves = F.head_to_world(head_in, crown)
    roots = curves[:, 0].copy()
    tuck = (np.asarray(src["tuck"]) > 0.5) if "tuck" in src.files \
        else np.zeros(len(curves), dtype=bool)
    y_ear_m = -0.0635
    z_nape_m = 1.51
    back_g = (roots[:, 1] < y_ear_m) & (roots[:, 2] > z_nape_m)
    pairs, winfo = crossing_pairs(curves, crown, back_g & ~tuck)
    rec["crossingBACK19"] = {"nCrossPairs": len(pairs),
                             "gate30pct": 2914, "baseline9715": 9715}
    # crossing-pair midpoints (world) for the overlay: first found
    # crossing segment midpoint per pair (cap 4000 pairs for the plot)
    mids = []
    win = winfo["win"]
    for (a, b) in pairs[:4000]:
        pa = curves[a][win[a]]
        pb = curves[b][win[b]]
        mids.append(((pa[len(pa) // 2] + pb[len(pb) // 2]) / 2.0).tolist())
    mids = np.asarray(mids, dtype=np.float64) * 1000.0  # mm
    rec["crossingMidSampleN"] = int(len(mids))

    (E / "back-field.json").write_text(json.dumps(rec, indent=1) + "\n")
    print(json.dumps(rec, indent=1))

    # ---- render back-field.png: x-z scatter coloured by per-voxel mean
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(10, 8))
    # back slab: all back voxels (x-z projection), colour = per-voxel mean
    sel = back_vox & np.isfinite(b_mean)
    sc = ax.scatter(xyz[sel, 0], xyz[sel, 2], c=b_mean[sel], s=1,
                    vmin=0, vmax=60, cmap="inferno", rasterized=True)
    plt.colorbar(sc, ax=ax, label="mean 26-nb disagreement (deg)")
    if len(mids):
        ax.scatter(mids[:, 0] * 1.0, mids[:, 2] * 1.0, s=4, c="cyan",
                   alpha=0.5, label="groom19 crossing-pair mids (<=4000)")
        ax.legend(loc="upper right", fontsize=8)
    ax.set_xlabel("x (mm)")
    ax.set_ylabel("z (mm)")
    ax.set_title("back field x-z projection coloured by local disagreement\n"
                 "cyan = groom19 crossing-pair pass (mid sample)")
    ax.set_aspect("equal", adjustable="datalim")
    fig.tight_layout()
    fig.savefig(E / "back-field.png", dpi=150)
    plt.close(fig)

    # ---- smooth BACK voxels until back p90 <= front reference
    cert = np.clip(gap / GAP0, 0.0, 1.0) * (np.minimum(nviews, 2) / 2.0)
    dirs = tdir.copy()
    iters = 0
    cur_back_p90 = float(np.percentile(b_pairs, 90)) if b_pairs.size else 0.0
    history = [round(cur_back_p90, 3)]
    back_rows = np.nonzero(back_vox)[0]
    for it in range(1, MAX_ITERS + 1):
        new = dirs.copy()
        for r in back_rows:
            ix, iy, iz = idx[r]
            acc = np.zeros(3)
            wsum = 0.0
            for (dx, dy, dz) in offs:
                jx, jy, jz = ix + dx, iy + dy, iz + dz
                if jx < 0 or jy < 0 or jz < 0 or jx >= shape[0] \
                        or jy >= shape[1] or jz >= shape[2]:
                    continue
                q = pos2row[jx, jy, jz]
                if q < 0:
                    continue
                v = dirs[q]
                if (v @ dirs[r]) < 0:
                    v = -v
                w = float(cert[q]) + 1e-3
                acc += w * v
                wsum += w
            if wsum <= 0:
                continue
            m = acc / wsum
            nl = np.linalg.norm(m)
            if nl < 1e-12:
                continue
            m /= nl
            if (m @ dirs[r]) < 0:
                m = -m
            v = (1.0 - LAM) * dirs[r] + LAM * m
            nl = np.linalg.norm(v)
            if nl < 1e-12:
                continue
            new[r] = v / nl
        dirs = new
        iters = it
        bp, _, _ = pooled_stats(back_vox, dirs)
        cur_back_p90 = float(np.percentile(bp, 90)) if bp.size else 0.0
        history.append(round(cur_back_p90, 3))
        print("SMOOTH it=%d backPooledP90=%.3f ref=%.3f" % (
            it, cur_back_p90, front_ref_p90), flush=True)
        if cur_back_p90 <= front_ref_p90:
            break

    bp_after, bmean_after, _ = pooled_stats(back_vox, dirs)
    smooth_rec = {
        "schema": "openclinxr.hair-back-field-smooth.v1",
        "weight": "certainty c=clip(gap/0.2,0,1)*min(nviews,2)/2 "
                  "(s02 beta), neighbour-weighted mean, lam=0.5",
        "iterations": iters,
        "frontRefP90": round(front_ref_p90, 3),
        "backPooledP90Before": history[0],
        "backPooledP90After": round(cur_back_p90, 3),
        "backPooledAfter": dist(bp_after),
        "historyP90": history,
        "gate": "backPooledP90 <= frontRefP90",
        "pass": bool(cur_back_p90 <= front_ref_p90),
        "frontUntouched": True,
    }
    # verify front untouched
    front_same = bool(np.array_equal(dirs[front_vox], tdir[front_vox]))
    smooth_rec["frontByteIdentical"] = front_same

    payload = {k: np.asarray(fld[k]) for k in fld.files}
    payload["dir"] = dirs.astype(np.float64)
    np.savez_compressed(str(SO / (args.stem + ".npz")), **payload)
    (SO / (args.stem + ".json")).write_text(
        json.dumps(smooth_rec, indent=1) + "\n")
    # merge smooth record into back-field.json for one-look evidence
    rec["smoothing"] = smooth_rec
    (E / "back-field.json").write_text(json.dumps(rec, indent=1) + "\n")
    print(json.dumps(smooth_rec, indent=1))


if __name__ == "__main__":
    main()
