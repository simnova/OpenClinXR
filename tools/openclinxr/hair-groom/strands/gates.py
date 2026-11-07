"""S9 gates: part assignment, inside-body count, root count,
determinism, lane (comb) metric. Writes E/gates.json. Exit nonzero on
any HARD fail.

- part crossings: every root's 3 guides must be same-side as the root
  (never across the part at assignment); child roots are exact by
  telescoping so root-side integrity follows. Tip drift across the
  part plane is REPORTED with a guide-shape calibration (the fitted
  guides themselves converge across the midline by shape: this card
  builds the interpolator, not the shape). Gate: 0 assignment
  crossings (HARD).
- inside body: points at s>=1 with exact-SDF < 0. Gate: 0.
- root count: children == --expect (default 14,155, one per root).
  Gate: equality.
- determinism: rebuild into a temp dir via children.py and compare
  array hashes (points+radii bytes; the npz zip envelope carries
  timestamps so file bytes are not compared). Gate: identical.
- lane metric (prescribed): back-sheet strands at mid-length
  (s=P//2, posterior of the mid-head plane): bin child x into 0.5 mm
  bins, normalised autocorrelation R; guide spacing L0 = median
  nearest-backbone gap at the same arc. peakRatio = R[Le] / mean of
  the flanking lags (local contrast: ~1.0 for monotone decay, >1 for
  a sidelobe). Gate: peakRatio < 1.5 (no periodic peak).
  Supporting (advisory): within-dominant-guide tangent RMS for ours
  vs an old-style barycentric control (fixed blend + 0.6 mm jitter):
  the old read copied one tangent per triplet (RMS ~ jitter floor),
  frame transport shears offsets per child (higher RMS).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

S9 = Path(__file__).resolve().parent
sys.path.insert(0, str(S9))
import common9 as C
import frames as F
from children import sdf_sampler

P = 32
N_ROOT = 14155


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--outdir", required=True)
    p.add_argument("--children", default=None)
    p.add_argument("--guides", default=None)
    p.add_argument("--roots", default=None)
    p.add_argument("--sdf", default=None)
    p.add_argument("--pinna", default=None)
    p.add_argument("--cameras", default=None)
    p.add_argument("--expect", type=int, default=N_ROOT)
    p.add_argument("--children-per-root", type=int, default=1)
    p.add_argument("--r-root-mm", type=float, default=0.05)
    p.add_argument("--r-tip-mm", type=float, default=0.015)
    p.add_argument("--subseed", type=int, default=11)
    p.add_argument("--max-guide-gap-mm", type=float, default=0.0)
    # groom3 passthrough: determinism rebuild must use the same build
    # flags (dot-guide floor, jitter truncation, clump pulls).
    p.add_argument("--min-guide-len-mm", type=float, default=0.0)
    p.add_argument("--len-trunc-sigma", type=float, default=0.0)
    p.add_argument("--len-trunc-lo-sigma", type=float, default=0.0)
    p.add_argument("--tuck-k", type=float, default=0.0)
    p.add_argument("--tuck-route", type=int, default=0)
    p.add_argument("--tuck-box", type=float, nargs=4,
                   default=[0.045, 0.085, -0.135, -0.040])
    p.add_argument("--coarse-pull", type=float, default=0.40)
    p.add_argument("--fine-pull", type=float, default=0.25)
    # groom4 passthrough: determinism rebuild must use the same build
    # flags (ear wrap, part style, curtain widen, clump exponent).
    p.add_argument("--ear-wrap", type=int, default=0)
    p.add_argument("--part-style", type=int, default=0)
    p.add_argument("--curtain-widen-mm", type=float, default=0.0)
    p.add_argument("--clump-pow", type=float, default=2.0)
    # groom4 tuck route: earframe + blend partition + cheek trim.
    p.add_argument("--ear-frame", default="")
    p.add_argument("--tuck-blend", type=int, default=0)
    p.add_argument("--cheek-trim", type=int, default=0)
    p.add_argument("--rim-set-mm", type=float, default=0.0)
    p.add_argument("--curtain-thin", type=int, default=0)
    p.add_argument("--halo-trim", type=int, default=0)
    p.add_argument("--band-trim", type=int, default=0)
    p.add_argument("--ear-keep-mm", type=float, default=4.0)
    p.add_argument("--pinna-clear-mm", type=float, default=3.0)
    # groom5 passthrough (Review 20 A/B).
    p.add_argument("--ear-clump-cap-mm", type=float, default=0.0)
    p.add_argument("--ear-clump-cap-w", type=float, default=0.3)
    p.add_argument("--sideburn-short", type=int, default=0)
    p.add_argument("--part-extra", type=int, default=0)
    # groom6 passthrough (Review 21 A/B/C/D).
    p.add_argument("--sideburn-hug-mm", type=float, default=0.0)
    p.add_argument("--sideburn-tuck", type=int, default=0)
    p.add_argument("--sideburn-zt-margin-mm", type=float, default=0.0)
    p.add_argument("--temple-tuck-alone", type=int, default=0)
    # groom8a: --deg-cap-mm REMOVED (rule removed from children.py).
    p.add_argument("--kill-root-dots", type=int, default=0)
    # groom8a: --hem-edge-extra / --hem-edge-spread-mm REMOVED.
    # groom8a: --hem-tip-trim / --hem-trim-cols REMOVED.
    p.add_argument("--hem-len-boost", type=float, default=1.0)
    p.add_argument("--hem-boost-side", type=float, default=0.0)
    p.add_argument("--lobe-trim", type=int, default=0)
    p.add_argument("--sideburn-len-mm", type=float, nargs=2,
                   default=[20.0, 40.0])
    # groom8a: --curtain-extra REMOVED (rule removed from children.py).
    p.add_argument("--part-crisp", type=int, default=0)
    # groom8a: --kink-guard REMOVED.
    p.add_argument("--hem-taper", type=int, default=0)
    # groom8a: --spike-trim/--spike-target-dir/--hem-trim-margin-px
    # REMOVED.
    return p.parse_args()


def arr_hash(*arrs):
    h = hashlib.sha256()
    for a in arrs:
        h.update(np.ascontiguousarray(a).tobytes())
    return h.hexdigest()


def autocorr(d):
    d = np.asarray(d, dtype=np.float64)
    d = d - d.mean()
    denom = float((d ** 2).sum())
    if denom == 0.0:
        return np.ones(1)
    full = np.correlate(d, d, mode="full")
    return full[len(full) // 2:] / denom


def main():
    args = cli()
    outdir = Path(args.outdir)
    E = outdir
    strands_p = Path(args.children or (E / "strands.npz"))
    C.log_open(strands_p)
    doc = np.load(strands_p, allow_pickle=True)
    pts = np.asarray(doc["points"], dtype=np.float64)
    radii = np.asarray(doc["radii"], dtype=np.float64)
    n, p, _ = pts.shape

    build = json.loads((E / "build.json").read_text())
    part_x = float(build["part"]["partX"])
    C.log_open(E / "build.json")

    # --- count ---
    count_ok = (n == args.expect) and (p == P)

    # --- part crossings: assignment must never cross the part ---
    from children import (DEF_GUIDES as _G, DEF_ROOTS as _R)
    guides_path = args.guides or str(_G)
    roots_path = args.roots or str(_R)
    gdoc = np.load(guides_path, allow_pickle=True)
    C.log_open(guides_path)
    C.log_open(roots_path)
    if "side" in gdoc:
        gside_all = np.asarray(gdoc["side"])
    else:
        gside_all = np.where(
            np.asarray(gdoc["curves_head"])[:, 0, 0] / 1000.0 >= part_x,
            1.0, -1.0)
    crown_g = np.asarray(gdoc["crown"], dtype=np.float64)
    gw_full = F.head_to_world(np.asarray(gdoc["curves_head"]), crown_g)
    gi = np.asarray(doc["guide_idx"])
    rxyz_p = np.asarray(np.load(roots_path,
                                allow_pickle=True)["xyz"], dtype=np.float64)
    n_root_p = rxyz_p.shape[0]
    from children import Y_VERTEX_M as _YV
    # groom6: explicit parent map when stored (hem/curtain extras use
    # different root sets than the part-extra reconstruction below).
    if "parent" in doc.files:
        parent = np.asarray(doc["parent"], dtype=np.int64)
        if len(parent) != n:
            raise SystemExit("stored parent map len %d != children %d"
                             % (len(parent), n))
        K = -1
    else:
        # groom5 part-extra aware multiplicity: n == K*n_root + E*n_part.
        _proot_g0 = ((np.abs(rxyz_p[:, 0] - part_x) < 12.0 / 1000.0)
                     & (rxyz_p[:, 1] >= -0.060) & (rxyz_p[:, 1] <= _YV))
        _npart0 = int(_proot_g0.sum())
        if (n - int(args.part_extra) * _npart0) % n_root_p != 0:
            raise SystemExit("child count %d not K/root + part-extra "
                             "(roots %d, part roots %d, extra %d)"
                             % (n, n_root_p, _npart0, int(args.part_extra)))
        K = (n - int(args.part_extra) * _npart0) // n_root_p
        parent = np.repeat(np.arange(n_root_p), K)
        # groom5 part-extra: extra children appended per part-band root
        # (same band rule as children.py: |x-part_x| < 12 mm, anterior of
        # / at the vertex). Without this the parent map is short.
        if int(args.part_extra) > 0:
            _proot_g = ((np.abs(rxyz_p[:, 0] - part_x) < 12.0 / 1000.0)
                        & (rxyz_p[:, 1] >= -0.060)
                        & (rxyz_p[:, 1] <= _YV))
            parent = np.concatenate(
                [parent, np.repeat(np.nonzero(_proot_g)[0],
                                   int(args.part_extra))])
    if len(parent) != n:
        raise SystemExit("child count %d != K=%d/root + part-extra map %d"
                         % (n, K, len(parent)))
    rside_p = np.where(rxyz_p[:, 0] >= part_x, 1.0, -1.0)[parent]
    # groom2: below-vertex (back drape) rows blend with no side
    # restriction by design (the intended sheet merge), so assignment
    # crossings count only anterior of / at the vertex (HARD 0 there).
    above_v = (rxyz_p[:, 1] <= _YV)[parent]
    _cross = (gside_all[gi] != rside_p[:, None])
    assign_cross = int((_cross & above_v[:, None]).sum())
    assign_cross_below = int((_cross & ~above_v[:, None]).sum())
    assign_ok = assign_cross == 0
    # Reported (advisory): tip drift vs root side + guide calibration.
    rx = pts[:, 0, 0] - part_x
    tx = pts[:, -1, 0] - part_x
    tip_cross = int(((rx >= 0) != (tx >= 0)).sum())
    tip_over = (np.abs(tx[(rx >= 0) != (tx >= 0)])
                if tip_cross else np.array([0.0]))
    _gs0 = np.where(gw_full[:, 0, 0] >= part_x, 1.0, -1.0)
    _gst = np.where(gw_full[:, -1, 0] >= part_x, 1.0, -1.0)
    guide_tip_cross = int((_gs0 != _gst).sum())

    # --- inside body (s>=1, exact SDF < 0) ---
    from children import DEF_SDF as _DEF_SDF, DEF_PINNA as _DEF_PINNA, DEF_CAMERAS as _DEF_CAMERAS
    sdf_path = args.sdf or str(_DEF_SDF)
    pinna_path = args.pinna or str(_DEF_PINNA)
    cameras_path = args.cameras or str(_DEF_CAMERAS)
    C.log_open(cameras_path)
    C.log_open(sdf_path)
    C.log_open(pinna_path)
    sdoc = np.load(sdf_path, allow_pickle=True)
    sample, _ = sdf_sampler(sdoc)
    vals, inside = sample(pts[:, 1:, :].reshape(-1, 3))
    n_inside = int((inside & (vals < 0.0)).sum())
    inside_ok = n_inside == 0

    # --- pinna proximity (operator handback 2): no VISIBLE strand
    # sample (s>=1, radius above the trim floor) within
    # --pinna-clear-mm (default 3.0; ear-band design: 8.0) of any
    # pinna vert. HARD 0. (Trimmed ~zero-radius samples are
    # construction dust, reported separately; the gate binds rendered
    # hair. Guide-level clearance is verified in tuck-stats.)
    from scipy.spatial import cKDTree as _KDT2
    pdoc = np.load(pinna_path, allow_pickle=True)
    C.log_open(pinna_path)
    pinna_m = np.vstack([
        np.asarray(pdoc["xyz"], dtype=np.float64)[
            np.asarray(pdoc["idx_earXpos"])],
        np.asarray(pdoc["xyz"], dtype=np.float64)[
            np.asarray(pdoc["idx_earXneg"])]])
    _ptree = _KDT2(pinna_m)
    _flat = pts[:, 1:, :].reshape(-1, 3)
    _pd, _ = _ptree.query(_flat, k=1)
    _vis = (np.asarray(radii, dtype=np.float64)[:, 1:].ravel() > 1e-6)
    _pclear = float(args.pinna_clear_mm) / 1000.0
    n_pinnear_all = int((_pd < _pclear).sum())
    n_pinnear = int((_pd[_vis] < _pclear).sum())
    pinnear_ok = n_pinnear == 0

    # --- determinism: rebuild elsewhere, compare array hashes ---
    h1 = arr_hash(np.asarray(doc["points"]), np.asarray(doc["radii"]))
    tmp = Path(tempfile.mkdtemp(prefix="strands-det-"))
    try:
        r = subprocess.run(
            [sys.executable, str(S9 / "children.py"), "--outdir", str(tmp),
             "--guides", guides_path, "--roots", roots_path,
             "--sdf", sdf_path, "--pinna", pinna_path, "--cameras", cameras_path,
             "--children-per-root", str(args.children_per_root),
             "--r-root-mm", str(args.r_root_mm),
             "--r-tip-mm", str(args.r_tip_mm),
              "--subseed", str(args.subseed),
              "--max-guide-gap-mm", str(args.max_guide_gap_mm),
              "--min-guide-len-mm", str(args.min_guide_len_mm),
              "--len-trunc-sigma", str(args.len_trunc_sigma),
              "--len-trunc-lo-sigma", str(args.len_trunc_lo_sigma),
              "--tuck-k", str(args.tuck_k),
              "--tuck-route", str(args.tuck_route),
              "--tuck-box", *(str(x) for x in args.tuck_box),
              "--coarse-pull", str(args.coarse_pull),
              "--fine-pull", str(args.fine_pull),
              "--ear-wrap", str(args.ear_wrap),
              "--part-style", str(args.part_style),
              "--clump-pow", str(args.clump_pow),
              "--ear-frame", str(args.ear_frame),
              "--tuck-blend", str(args.tuck_blend),
              "--cheek-trim", str(args.cheek_trim),
              "--rim-set-mm", str(args.rim_set_mm),
              "--curtain-thin", str(args.curtain_thin),
              "--halo-trim", str(args.halo_trim),
              "--band-trim", str(args.band_trim),
              "--ear-keep-mm", str(args.ear_keep_mm),
              "--ear-clump-cap-mm", str(args.ear_clump_cap_mm),
              "--ear-clump-cap-w", str(args.ear_clump_cap_w),
              "--sideburn-short", str(args.sideburn_short),
              "--part-extra", str(args.part_extra),
              "--sideburn-hug-mm", str(args.sideburn_hug_mm),
              "--sideburn-tuck", str(args.sideburn_tuck),
              "--sideburn-zt-margin-mm", str(args.sideburn_zt_margin_mm),
              "--temple-tuck-alone", str(args.temple_tuck_alone),
              "--kill-root-dots", str(args.kill_root_dots),
              "--hem-len-boost", str(args.hem_len_boost),
              "--hem-boost-side", str(args.hem_boost_side),
              "--lobe-trim", str(args.lobe_trim),
              "--sideburn-len-mm", str(args.sideburn_len_mm[0]),
              str(args.sideburn_len_mm[1]),
              "--part-crisp", str(args.part_crisp),
              "--hem-taper", str(args.hem_taper)],
            capture_output=True, text=True, timeout=3600)
        if r.returncode != 0:
            raise RuntimeError("rebuild failed: " + r.stderr[-2000:])
        doc2 = np.load(tmp / "strands.npz", allow_pickle=True)
        h2 = arr_hash(np.asarray(doc2["points"]),
                      np.asarray(doc2["radii"]))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    det_ok = h1 == h2

    # --- lane metric (prescribed x-autocorr + tangent-RMS support) ---
    BIN_MM = 0.5
    mid = pts[:, P // 2, :]
    crown = crown_g
    gw = gw_full
    gmid = gw[:, 15, :]
    # Back sheet: posterior of the mid-head plane (crown y) at mid arc.
    y_cut = float(crown[1]) + 0.02
    back = mid[:, 1] > y_cut
    sel = mid[back, 0]
    gsel = gmid[gmid[:, 1] > y_cut, 0]
    gsel_sorted = np.sort(gsel)
    gaps = np.diff(gsel_sorted)
    gaps = gaps[gaps > 0.5 / 1000.0]
    guide_spacing_m = float(np.median(gaps)) if len(gaps) else 0.01
    lo, hi = float(sel.min()), float(sel.max())
    nb = max(8, int(round((hi - lo) * 1000.0 / BIN_MM)))
    hist, _ = np.histogram(sel, bins=nb, range=(lo, hi))
    R = autocorr(hist)
    Le = max(2, int(round(guide_spacing_m * 1000.0 / BIN_MM)))
    # Local contrast at the guide lag: ~1.0 for monotone decay (no
    # peak), >1 for a sidelobe.
    loW = max(1, Le - 1)
    num = float(R[Le]) if Le < len(R) else 0.0
    flank = ([float(R[loW - 1])]
             if loW - 1 >= 0 else [])
    flank += ([float(R[Le + 1])] if Le + 1 < len(R) else [])
    den = float(np.mean(flank)) if flank else 1.0
    peak_ratio = num / den if den > 0.01 else (1.0 if num <= 0.01 else 9.99)
    lane_ok = bool(peak_ratio < 1.5)
    # Supporting: within-dominant-guide tangent RMS, ours vs an
    # old-style fixed barycentric blend + 0.6 mm jitter control.
    w_all = np.asarray(doc["guide_w"])
    nb = int(back.sum())
    rank = np.argmax(w_all[back], axis=1)
    dom = gi[back][np.arange(nb), rank]
    T = np.diff(pts, axis=1)
    T /= np.linalg.norm(T, axis=2, keepdims=True) + 1e-12
    Tm = T[back][:, P // 2, :]
    rng = np.random.RandomState(99)
    Gsel = gw_full[gi[back]]                                   # (Nb,3,41,3)
    cpts = (Gsel * w_all[back][:, :, None, None]).sum(axis=1)
    # Jitter on the 41-pt control backbone (0.6 mm, seed 99).
    cpts = cpts + rng.randn(*cpts.shape) * 0.0006
    cT = np.diff(cpts, axis=1)
    cT /= np.linalg.norm(cT, axis=2, keepdims=True) + 1e-12
    cTm = cT[:, 20, :]
    cT = np.diff(cpts, axis=1)
    cT /= np.linalg.norm(cT, axis=2, keepdims=True) + 1e-12
    cTm = cT[:, P // 2, :]

    def group_rms(Tm_):
        rms = []
        for g in np.unique(dom):
            m = Tm_[dom == g]
            if len(m) < 3:
                continue
            mu = m.mean(axis=0)
            mu /= np.linalg.norm(mu) + 1e-12
            ang = np.degrees(np.arccos(np.clip(m @ mu, -1.0, 1.0)))
            rms.append(float(np.sqrt((ang ** 2).mean())))
        return (round(float(np.median(rms)), 2) if rms else 0.0,
                int(len(rms)))

    ours_rms, ours_ng = group_rms(Tm)
    ctrl_rms, _ = group_rms(cTm)
    shear = {"oursTangentRmsDeg": ours_rms, "nGroups": ours_ng,
             "controlTangentRmsDeg": ctrl_rms}

    frames_self = F.self_test()

    gates = {
        "count": {"n": n, "pointsPer": p, "expect": args.expect,
                  "pass": bool(count_ok), "hard": True},
        "partCrossings": {"nAssignAcross": assign_cross,
                           "pass": bool(assign_ok), "hard": True,
                           "nAssignAcrossBelowVertexAllowed":
                           assign_cross_below,
                           "tipDriftAcross": tip_cross,
                           "tipOvershootMmP50": round(
                               float(np.median(tip_over)) * 1000.0, 2),
                           "tipOvershootMmMax": round(
                               float(tip_over.max()) * 1000.0, 2),
                           "guideTipCross": guide_tip_cross,
                           "note": "assignment never crosses (HARD); tip "
                                   "drift calibrated vs guide shape "
                                   "(advisory)"},
        "insideBody": {"nSge1Inside": n_inside, "pass": bool(inside_ok),
                       "hard": True},
        "pinnaProximity": {"clearMm": float(args.pinna_clear_mm),
                           "nVisibleSamplesLt": n_pinnear,
                           "nAllSamplesLt": n_pinnear_all,
                           "pass": bool(pinnear_ok), "hard": True,
                           "note": "no visible strand sample (s>=1) "
                                   "within clearMm of any pinna vert "
                                   "(operator handback 2)"},
        "determinism": {"hashA": h1, "hashB": h2,
                        "pass": bool(det_ok), "hard": True},
        "lane": {"nBackStrands": int(len(sel)),
                 "guideSpacingMm": round(guide_spacing_m * 1000.0, 2),
                 "lagBins": Le, "peakRatio": round(float(peak_ratio), 3),
                 "shear": shear,
                 "pass": bool(lane_ok), "hard": True},
        "framesSelfTest": frames_self,
    }
    all_ok = all(v["pass"] for v in gates.values()
                 if isinstance(v, dict) and v.get("hard"))
    gates["pass"] = bool(all_ok)
    with open(E / "gates.json", "w") as f:
        json.dump(gates, f, indent=1)
    C.log_open(E / "gates.json")
    C.merge_opened(E / "inputs-opened.txt")
    print(json.dumps(gates, indent=1))
    if not all_ok:
        raise SystemExit("GATES FAILED")


if __name__ == "__main__":
    main()
