"""hair-groom34 mirror build inputs (NEW stage; no existing behaviour touched).

Mode `mirror`: symmetric guides+roots by in-place replacement.
  * slots with root x < -MID_MM (default 2.0) are REPLACED by the mirror
    (x -> -x) of the nearest donor slot (root x >= -MID_MM); midline
    slots (|x| <= MID_MM) and +x slots are kept verbatim. Counts, index
    order and every auxiliary array (tuck/band/route/status/ok_idx,
    tri, uv-cell streams) are unchanged, so downstream asserts
    (pool-ref shape, n_new) and the seeded child RNG streams keep their
    shape; asymmetry comes only from the seeded child stages.
  * guides: curves_head x (head-mm; world x = head x / 1000) negated
    from the donor (world mirror across x=0).
  * roots: xyz mirrored; normal x negated (renormalised); uv u -> -u
    (azimuth mirror; v unchanged); tri kept verbatim (unused by
    interp_children; noted in stats).
Mode `mask`: root mask sweep. Drops scalp roots within R_MM of either
inflated ear proxy outer patch (applied to the mirrored roots).

Both modes write npz with identical keys/shapes (mask: fewer rows) plus
a JSON stats sidecar. Deterministic (cKDTree queries, fixed order).
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[4]


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def _mirror_map(curves, mid):
    """Slot replacement map: -x slots <- mirror of nearest +x donor.

    Returns (rep, donor_global, dd, ii). Pairing in head-mm, all three dims.
    Deterministic (cKDTree, fixed order)."""
    from scipy.spatial import cKDTree
    grx = np.asarray(curves, dtype=np.float64)[:, 0, 0] / 1000.0
    rep = grx < -mid
    donor = grx >= -mid
    d_root = np.asarray(curves, dtype=np.float64)[donor][:, 0, :]
    tree = cKDTree(d_root)
    q = np.asarray(curves, dtype=np.float64)[rep][:, 0, :].copy()
    q[:, 0] *= -1.0
    dd, ii = tree.query(q)
    donor_global = np.nonzero(donor)[0][ii]
    return rep, donor_global, dd, ii


def do_mirror(guides_p, roots_p, out_g, out_r, mid_mm, stats_p):
    from scipy.spatial import cKDTree
    mid = float(mid_mm) / 1000.0
    gdoc = dict(np.load(guides_p, allow_pickle=True))
    rdoc = dict(np.load(roots_p, allow_pickle=True))
    curves = np.asarray(gdoc["curves_head"], dtype=np.float64)
    rxyz = np.asarray(rdoc["xyz"], dtype=np.float64)

    stats = {"mode": "mirror", "midMm": float(mid_mm),
             "guidesIn": str(guides_p), "rootsIn": str(roots_p),
             "guidesSha": sha256(guides_p)[:16],
             "rootsSha": sha256(roots_p)[:16],
             "plane": "x=0, midline kept |root x| <= mid"}

    # ---- guides (pairing in head-mm, all three dims) ----
    rep, donor_global, dd, ii = _mirror_map(curves, mid)
    new_curves = curves.copy()
    mir = curves[donor_global].copy()
    mir[:, :, 0] *= -1.0
    new_curves[rep] = mir
    gdoc["curves_head"] = new_curves
    stats["guides"] = {"n": int(len(curves)),
                       "nReplaced": int(rep.sum()),
                       "nDonors": int((~rep).sum()),
                       "donorReuseMax": int(np.bincount(ii).max()),
                       "pairDistMm": {
                           "p50": round(float(np.median(dd)), 5),
                           "p90": round(float(np.percentile(dd, 90)), 5),
                           "max": round(float(dd.max()), 5)},
                       "auxArraysKept": True}

    # ---- roots (same donor-mirror pattern as guides: the -x slot takes
    # the mirrored DONOR position/normal/uv, so the -x set is the mirror
    # of the +x set. Note new_xyz[rrep] = mirrored donor (NOT the slot's
    # own position mirrored, which would teleport -x roots to +x). ----
    rrep = rxyz[:, 0] < -mid
    rdonor = rxyz[:, 0] >= -mid
    ruv = np.asarray(rdoc["uv"], dtype=np.float64)
    rnorm = np.asarray(rdoc["normal"], dtype=np.float64)
    rtree = cKDTree(rxyz[rdonor])
    rq = rxyz[rrep].copy()
    rq[:, 0] *= -1.0
    rdd, rii = rtree.query(rq)
    rdonor_global = np.nonzero(rdonor)[0][rii]
    new_xyz = rxyz.copy()
    mir_r = rxyz[rdonor_global].copy()
    mir_r[:, 0] *= -1.0
    new_xyz[rrep] = mir_r
    new_n = rnorm.copy()
    new_n[rrep] = rnorm[rdonor_global]
    new_n[rrep][:, 0] *= -1.0
    new_n[rrep] /= np.linalg.norm(new_n[rrep], axis=1, keepdims=True)
    new_uv = ruv.copy()
    new_uv[rrep, 0] = -ruv[rdonor_global, 0]
    new_uv[rrep, 1] = ruv[rdonor_global, 1]
    rdoc["xyz"] = new_xyz
    rdoc["normal"] = new_n
    rdoc["uv"] = new_uv
    stats["roots"] = {"n": int(len(rxyz)), "nReplaced": int(rrep.sum()),
                       "nDonors": int(rdonor.sum()),
                       "donorReuseMax": int(np.bincount(rii).max()),
                       "pairDistMm": {
                          "p50": round(float(np.median(rdd) * 1000.0), 5),
                          "p90": round(float(np.percentile(rdd, 90)
                                             * 1000.0), 5),
                          "max": round(float(rdd.max() * 1000.0), 5)},
                      "uvMap": "u -> -u, v kept",
                      "triKept": "verbatim (unused by interp_children)"}
    np.savez_compressed(out_g, **gdoc)
    np.savez_compressed(out_r, **rdoc)
    Path(stats_p).write_text(json.dumps(stats, indent=1) + "\n")
    print(json.dumps(stats, indent=1))


def do_mirror_ref(primary_p, ref_p, out_p, mid_mm, stats_p):
    """Symmetrize a per-index reference guides file with the primary's map.

    pool-drop compares guides per-INDEX against the reference (guides-8a);
    after mirroring, -x slots hold +x-mirrored guides, so the raw reference
    would flag ~1k guides as displaced. Applying the identical slot map
    (derived from the PRIMARY guides) to the reference restores a
    mirror-consistent comparison with unchanged flags.
    Requires identical shapes (the assert pool-drop itself relies on)."""
    from scipy.spatial import cKDTree  # noqa: F401 (parity with do_mirror)
    mid = float(mid_mm) / 1000.0
    pdoc = dict(np.load(primary_p, allow_pickle=True))
    rdoc = dict(np.load(ref_p, allow_pickle=True))
    pcurves = np.asarray(pdoc["curves_head"], dtype=np.float64)
    rcurves = np.asarray(rdoc["curves_head"], dtype=np.float64)
    assert rcurves.shape == pcurves.shape, (rcurves.shape, pcurves.shape)
    rep, donor_global, dd, ii = _mirror_map(pcurves, mid)
    new_r = rcurves.copy()
    mir = rcurves[donor_global].copy()
    mir[:, :, 0] *= -1.0
    new_r[rep] = mir
    rdoc["curves_head"] = new_r
    stats = {"mode": "mirror-ref", "primary": str(primary_p),
             "primarySha": sha256(primary_p)[:16],
             "refIn": str(ref_p), "refSha": sha256(ref_p)[:16],
             "midMm": float(mid_mm), "nReplaced": int(rep.sum()),
             "note": "same slot map as mirror mode; crown is global (3,) "
                     "and untouched"}
    np.savez_compressed(out_p, **rdoc)
    Path(stats_p).write_text(json.dumps(stats, indent=1) + "\n")
    print(json.dumps(stats, indent=1))


def do_mask(roots_p, proxy_p, r_mm, out_r, stats_p):
    from scipy.spatial import cKDTree
    rdoc = dict(np.load(roots_p, allow_pickle=True))
    P = np.load(proxy_p, allow_pickle=True)
    rxyz = np.asarray(rdoc["xyz"], dtype=np.float64)
    # outer = shell first half (build order: outer then skin)
    shell = {}
    for nm in ("xpos", "xneg"):
        sv = np.asarray(P[nm + "_shell_v"], dtype=np.float64)
        shell[nm] = sv[:len(sv) // 2]
    both = np.vstack([shell["xpos"], shell["xneg"]])
    tree = cKDTree(both)
    dd, _ = tree.query(rxyz)
    keep = dd >= float(r_mm) / 1000.0
    for k, v in rdoc.items():
        a = np.asarray(v)
        if a.shape and a.shape[0] == len(rxyz):
            rdoc[k] = a[keep]
    stats = {"mode": "mask", "rootsIn": str(roots_p),
             "rootsSha": sha256(roots_p)[:16],
             "proxy": str(proxy_p), "rMm": float(r_mm),
             "nIn": int(len(rxyz)), "nKept": int(keep.sum()),
             "nDropped": int((~keep).sum()),
             "distToProxyMm": {
                 "min": round(float(dd.min() * 1000.0), 3),
                 "p50": round(float(np.median(dd) * 1000.0), 3)},
             "target": "scalp roots within R of inflated ear outer "
                       "patch, both sides"}
    np.savez_compressed(out_r, **rdoc)
    Path(stats_p).write_text(json.dumps(stats, indent=1) + "\n")
    print(json.dumps(stats, indent=1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=("mirror", "mask", "mirror-ref"),
                    required=True)
    ap.add_argument("--guides", default="")
    ap.add_argument("--roots", default="")
    ap.add_argument("--ref-in", default="")
    ap.add_argument("--proxy", default="")
    ap.add_argument("--r-mm", type=float, default=0.0)
    ap.add_argument("--mid-mm", type=float, default=2.0)
    ap.add_argument("--out-guides", default="")
    ap.add_argument("--out-roots", default="")
    ap.add_argument("--stats", required=True)
    args = ap.parse_args()
    if args.mode == "mirror":
        do_mirror(args.guides, args.roots, args.out_guides,
                  args.out_roots, args.mid_mm, args.stats)
    elif args.mode == "mirror-ref":
        do_mirror_ref(args.guides, args.ref_in, args.out_guides,
                      args.mid_mm, args.stats)
    else:
        do_mask(args.roots, args.proxy, args.r_mm, args.out_roots,
                args.stats)


if __name__ == "__main__":
    main()
