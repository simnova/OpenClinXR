"""groom11 children on the coherent guide field.

Child of interp_children.py (groom8b: child(f) = root + sum w (G(f)-G(0)),
same-side 4-nearest per-child UV selection, 5 mm gap gate, far-translation
snap, outward-only depth servo, two-scale clump, part sweep + half-space
clamps, ear radial keep-out + exact-SDF projection, radii-only concha /
lobe trims, kill-root-dots). Guides input is the groom9 retrace
(guides-9.npz: turn budget, part corridor, edge slide). Groom9 changes:

- HAIRLINE class replaces sideburn-short: hairline/sideburn roots are
  ORDINARY interpolated children of the nearest temple guides (same
  selection/blend/depth/clump/projection as everyone), with a LENGTH
  TAPER ONLY: deterministic per-parent-root chord scale 0.35 (face edge
  of the band) -> 1.0 (ear edge), shape-preserving, no rescale-collapse
  micro-spaced tails, no skin hug. The tuck class (behind-ear drape)
  is kept as in 8b.
- REMOVED (round 1): sideburn rescale + collapse clamp, sideburn hug,
  temple hug (the helmet-band cause). Part sweep + half-space clamps
  kept.
- ROUND 2 (after round-1 scoring): taper floor 0.35 -> 0.55;
  depth-servo T clip [6,20] -> [7,14]; clump 0.26/0.18; gap gate 5 -> 3
  mm + far snap 25 -> 15 mm; ear keep-out oscillation cap 12 mm +
  revert-and-trim; +-2.0 mm on-line slot trim (arc < 55 mm).
- ROUND 3 (orchestrator): selective-8a guides stay; hairline ordinary
  (tuck-routing reverted); face trim + hem boost REMOVED (no
  strand-length change by image position).
- assignAcross convention (checked in gates9.py, HARD): per-CHILD-root
  (the stored sub-root, i.e. the actual child root) vs its guides.

Writes E/strands.npz (points/radii metres, K per root) and
E/build.json (params, counts, stats, hashes). Clump centres share the
dominant coherent guide and moves are capped at 8/3 mm. Body projection is
capped at 5 mm and reports residual inside-body samples without relaxing it.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

S9 = Path(__file__).resolve().parent
sys.path.insert(0, str(S9))
import common9 as C
import frames as F
from children import sdf_sampler, project_outside, clump_pull

P = 32
N_GUIDES = 4
PHI = 0.618033988749895
K_PER_ROOT = 20
SEED = 7
SUBSEED = 11
SIGMA_LEN = 0.04
R_ROOT_M = 5e-5
R_TIP_M = 1.5e-5
COARSE_MM = 20.0
FINE_MM = 4.5
COARSE_PULL = 0.26
FINE_PULL = 0.18
CLUMP_POW = 2.0
PART_BAND_MM = 12.0
PART_Y_LO_M = -0.060
Y_VERTEX_M = 0.0342
EAR_KEEP_M = 0.004
EAR_ITERS = 60
SDF_MARGIN_MM = 0.3
SDF_ITERS = 50
U_TUCK = 0.55
HUG_MM = 2.0
COARSE_BOUND_MM = 8.0
FINE_BOUND_MM = 3.0
PROJECTION_BOUND_MM = 5.0
CONSTRUCTOR_FIT_BOUND_MM = 8.0

ROOT = S9.parents[3]
EVID = ROOT / "tools/openclinxr/evidence"
_GDIR = "hair-" + "guides0"
_SDIR = "hair-" + "scalp1"
_CDIR = "hair-" + "cage1"
_HDIR = "hair-" + "hull3"
DEF_GUIDES = EVID / _GDIR / "guides.npz"
DEF_ROOTS = EVID / _SDIR / "roots.npz"
DEF_SDF = EVID / _CDIR / "body-exact-sdf.npz"
_MDIR = "manifests"
_CDIR2 = "cameras-scorer-v3.json"
DEF_PINNA = EVID / _HDIR / "workspace/ear_pinna.npz"
DEF_CAMERAS = ROOT / "tools/openclinxr/hair-groom" / _MDIR / _CDIR2
DEF_HULL = ROOT / "tools/openclinxr/evidence/hair-hull5/hull.npz"


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--outdir", required=True)
    p.add_argument("--guides", default=str(DEF_GUIDES))
    p.add_argument("--roots", default=str(DEF_ROOTS))
    p.add_argument("--sdf", default=str(DEF_SDF))
    p.add_argument("--pinna", default=str(DEF_PINNA))
    p.add_argument("--cameras", default=str(DEF_CAMERAS))
    p.add_argument("--hull", default=str(DEF_HULL))
    p.add_argument("--ear-frame", default="")
    p.add_argument("--children-per-root", type=int, default=K_PER_ROOT)
    p.add_argument("--r-root-mm", type=float, default=R_ROOT_M * 1000.0)
    p.add_argument("--r-tip-mm", type=float, default=R_TIP_M * 1000.0)
    p.add_argument("--subseed", type=int, default=SUBSEED)
    p.add_argument("--max-guide-gap-mm", type=float, default=3.0)
    p.add_argument("--min-guide-len-mm", type=float, default=20.0)
    p.add_argument("--len-trunc-sigma", type=float, default=1.0)
    p.add_argument("--len-trunc-lo-sigma", type=float, default=2.0)
    p.add_argument("--coarse-pull", type=float, default=COARSE_PULL)
    p.add_argument("--fine-pull", type=float, default=FINE_PULL)
    p.add_argument("--clump-pow", type=float, default=CLUMP_POW)
    p.add_argument("--sideburn-short", type=int, default=1)
    p.add_argument("--sideburn-len-mm", type=float, nargs=2,
                   default=[12.0, 24.0])
    p.add_argument("--sideburn-zt-margin-mm", type=float, default=3.0)
    p.add_argument("--sideburn-tuck", type=int, default=1)
    p.add_argument("--sideburn-hug-mm", type=float, default=2.0)
    p.add_argument("--temple-hug-mm", type=float, default=1.5)
    p.add_argument("--kill-root-dots", type=int, default=1)
    p.add_argument("--lobe-trim", type=int, default=1)
    p.add_argument("--ear-keep-mm", type=float, default=4.0)
    p.add_argument("--depth-servo", type=int, default=1)
    return p.parse_args()


def nearest_idx(targets, pool):
    t = np.asarray(targets, dtype=np.float64)
    q = np.asarray(pool, dtype=np.float64)
    out = np.empty(len(t), dtype=np.int64)
    step = 2048
    for a in range(0, len(t), step):
        d = ((t[a:a + step, None, :] - q[None, :, :]) ** 2).sum(axis=2)
        out[a:a + step] = d.argmin(axis=1)
    return out


def bound_stage(before, after, bound_mm):
    delta = after - before
    per = np.linalg.norm(delta, axis=2).max(axis=1) * 1000.0
    fac = np.minimum(1.0, bound_mm / np.maximum(per, 1e-12))
    after[:] = before + delta * fac[:, None, None]
    bounded = np.linalg.norm(after - before, axis=2).max(axis=1) * 1000.0
    return {"boundMm": bound_mm, "nLimited": int((fac < 1.0).sum()),
            "p90Mm": round(float(np.percentile(bounded, 90)), 4),
            "maxMm": round(float(bounded.max()), 4),
            "pass": bool(bounded.max() <= bound_mm + 1e-6)}


def revert_inside_samples(before, after, sample):
    flat = after[:, 1:, :].copy().reshape(-1, 3)
    vals, valid = sample(flat)
    bad = valid & (vals < 0.0)
    if bad.any():
        flat[bad] = before[:, 1:, :].reshape(-1, 3)[bad]
        after[:, 1:, :] = flat.reshape(len(after), P - 1, 3)
    return int(bad.sum())


def radial_surface_fit(points, sample, centre_y, margin_mm=0.3,
                       bound_mm=CONSTRUCTOR_FIT_BOUND_MM, iters=16):
    """Bounded raw-constructor correction in scalp coordinates.

    This is deliberately not an unbounded projection stage.  It may move a
    sample at most ``bound_mm``; remaining samples are reported to the caller
    as construction failures rather than silently acquiring a long radial
    displacement.
    """
    pts = np.asarray(points, dtype=np.float64).copy()
    start = pts.copy()
    rounds = 0
    limited = np.zeros(len(pts), dtype=bool)
    for _ in range(iters):
        vals, valid = sample(pts)
        need = valid & (vals < margin_mm)
        if not need.any():
            break
        rounds += 1
        q = pts[need]
        radial = q[:, :2] - np.array([0.0, centre_y])
        norm = np.linalg.norm(radial, axis=1)
        direction = np.zeros_like(q)
        side = norm >= 0.010
        direction[side, :2] = radial[side] / norm[side, None]
        direction[~side, 2] = 1.0
        used = np.linalg.norm(q - start[need], axis=1)
        room = np.maximum(0.0, bound_mm / 1000.0 - used)
        step = np.minimum(0.001, room)
        limited[np.nonzero(need)[0][step < 0.001 - 1e-12]] = True
        pts[need] = q + direction * step[:, None]
    vals, valid = sample(pts)
    disp = np.linalg.norm(pts - start, axis=1) * 1000.0
    remain = valid & (vals < margin_mm)
    return pts, {"boundMm": bound_mm,
                 "nPushed": int((disp > 0).sum()),
                 "p90Mm": round(float(np.percentile(disp, 90)), 4),
                 "maxNetMm": round(float(disp.max()), 4),
                 "nRounds": rounds,
                 "nAtBound": int(limited.sum()),
                 "nNeedsMore": int(remain.sum()),
                 "nInsideAfter": int((valid & (vals < 0.0)).sum()),
                 "mode": "bounded outward in cylindrical scalp coordinates",
                 "pass": bool(disp.max() <= bound_mm + 1e-6)}


def scalp_transport_from_guide(guide, child_root, centre_y,
                               settle_mm=40.0):
    """Attach a child root to one coherent guide without a 3-D chord.

    A rigidly translated guide can run straight through the convex skull when
    its child root is sparse.  This route interpolates in cylindrical scalp
    coordinates for only the anchored take-off section, then follows the
    guide exactly.  It is construction, not a later projection displacement.
    """
    g = np.asarray(guide, dtype=np.float64)
    r = np.asarray(child_root, dtype=np.float64)
    radial_g = g[..., :2] - np.array([0.0, centre_y])
    rg = np.linalg.norm(radial_g, axis=2)
    ag = np.unwrap(np.arctan2(radial_g[..., 1], radial_g[..., 0]), axis=1)
    radial_r = r[:, :2] - np.array([0.0, centre_y])
    rr = np.linalg.norm(radial_r, axis=1)
    ar = np.arctan2(radial_r[:, 1], radial_r[:, 0])
    # Choose the unwrapped guide branch nearest each child-root angle.
    ag = ag + (2.0 * np.pi * np.round((ar[:, None] - ag[:, :1]) /
                                      (2.0 * np.pi)))
    seg = np.linalg.norm(np.diff(g, axis=1), axis=2)
    arc = np.concatenate([np.zeros((len(g), 1)), np.cumsum(seg, axis=1)],
                         axis=1)
    t = np.clip(arc / (settle_mm / 1000.0), 0.0, 1.0)
    t = t * t * (3.0 - 2.0 * t)
    rp = rr[:, None] * (1.0 - t) + rg * t
    ap = ar[:, None] * (1.0 - t) + ag * t
    zp = r[:, None, 2] * (1.0 - t) + g[..., 2] * t
    out = np.stack([rp * np.cos(ap), centre_y + rp * np.sin(ap), zp], axis=2)
    out[:, 0] = r
    return out


def main():
    args = cli()
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    for f in (args.guides, args.roots, args.sdf, args.hull):
        C.log_open(f)

    gdoc = np.load(args.guides, allow_pickle=True)
    rdoc = np.load(args.roots, allow_pickle=True)
    sdoc = np.load(args.sdf, allow_pickle=True)
    crown = np.asarray(gdoc["crown"], dtype=np.float64)
    curves_head = np.asarray(gdoc["curves_head"], dtype=np.float64)
    K = int(args.children_per_root)
    r_root_m = float(args.r_root_mm) / 1000.0
    r_tip_m = float(args.r_tip_mm) / 1000.0
    rxyz = np.asarray(rdoc["xyz"], dtype=np.float64)
    ruv = np.asarray(rdoc["uv"], dtype=np.float64)
    rnorm = np.asarray(rdoc["normal"], dtype=np.float64)
    n_root = rxyz.shape[0]
    n_guide = curves_head.shape[0]

    band = rxyz[rxyz[:, 2] >= 1.63]
    part_x = float(np.median(band[:, 0]))
    rside = np.where(rxyz[:, 0] >= part_x, 1.0, -1.0)
    tuck_g = (np.asarray(gdoc["tuck"], dtype=np.float64)
              if "tuck" in gdoc else np.zeros(n_guide))
    band_g = (np.asarray(gdoc["band"], dtype=np.float64)
              if "band" in gdoc else np.zeros(n_guide))
    n_new = int((tuck_g < 0.5).sum())
    gu = np.full(n_guide, U_TUCK)
    uu_new = 0.3 + 0.6 * ((np.arange(n_new) * PHI) % 1.0)
    gu[tuck_g < 0.5] = uu_new[: int((tuck_g < 0.5).sum())]
    assert n_new == 2650, n_new

    guides_w = F.head_to_world(curves_head, crown)
    g_res = np.stack([F.resample_arc(guides_w[g], P)
                      for g in range(n_guide)])
    _glen = np.linalg.norm(np.diff(g_res, axis=1), axis=2).sum(axis=1)
    _floor_m = float(args.min_guide_len_mm) / 1000.0
    if _floor_m > 0.0:
        pool = np.nonzero((_glen >= _floor_m) & (band_g < 0.5))[0]
    else:
        pool = np.nonzero(band_g < 0.5)[0]
    n_pool = int(len(pool))
    g_res_p = g_res[pool]
    gu_p = gu[pool]
    tuck_p = (tuck_g[pool] > 0.5)
    guide_root = g_res_p[:, 0, :]
    g_near = nearest_idx(guide_root, rxyz)
    g_uv = ruv[g_near]
    gside_p = np.where(guide_root[:, 0] >= part_x, 1.0, -1.0)
    dot_info = {"floorMm": float(args.min_guide_len_mm),
                "nDot": int(n_guide - n_pool), "nPool": n_pool}

    earframe = None
    if args.ear_frame:
        earframe = json.loads(open(args.ear_frame).read())
        C.log_open(args.ear_frame)
    _tuckroot = np.zeros(n_root, dtype=bool)
    if earframe is not None:
        _rmm = rxyz * 1000.0
        for _sgn, _side in ((1.0, "xpos"), (-1.0, "xneg")):
            _rows = (_rmm[:, 0] * _sgn > 0)
            _tb = earframe["sides"][_side]["tuckBoxMm"]
            _tuckroot |= _rows & (np.abs(_rmm[:, 0]) >= _tb["xLo"]) \
                & (np.abs(_rmm[:, 0]) < _tb["xHi"]) \
                & (_rmm[:, 1] < _tb["yMax"]) \
                & (_rmm[:, 2] >= _tb["zLo"]) \
                & (_rmm[:, 2] < _tb["zHi"])
        _nbb = np.zeros(n_root, dtype=bool)
        for _sgn, _side in ((1.0, "xpos"), (-1.0, "xneg")):
            _sd = earframe["sides"][_side]
            _b = np.array([_sd["xEarMm"], _sd["yPostMm"] + 8.0,
                           _sd["zMidMm"]])
            _rows = (_rmm[:, 0] * _sgn > 0)
            _nbb |= _rows & (np.linalg.norm(_rmm - _b, axis=1) < 55.0)
        _tuckroot &= _nbb
    _tuck_on = bool(earframe is not None and bool((tuck_g > 0.5).any()))

    below_v = rxyz[:, 1] > Y_VERTEX_M
    # Per-child guide selection runs after sub-roots (needs the
    # per-child cuv/cxyz). See below.

    _cams = json.loads(open(args.cameras).read())
    C.log_open(args.cameras)
    _sensor = float(_cams["sensorWidthMm"])
    _proj = {}
    for _v in ("front", "three_quarter", "profile_90"):
        _m = np.array(_cams["views"][_v]["matrixWorld"], dtype=np.float64)
        _proj[_v] = (np.linalg.inv(_m),
                     float(_cams["views"][_v]["lensMm"]) / _sensor * 1024.0)
    _mb = np.array(_cams["views"]["back"]["matrixWorld"], dtype=np.float64)
    _proj["back"] = (np.linalg.inv(_mb),
                     float(_cams["views"]["back"]["lensMm"])
                     / _sensor * 1024.0)
    pdoc = np.load(args.pinna, allow_pickle=True)
    C.log_open(args.pinna)
    pinna_m = np.vstack([
        np.asarray(pdoc["xyz"], dtype=np.float64)[
            np.asarray(pdoc["idx_earXpos"])],
        np.asarray(pdoc["xyz"], dtype=np.float64)[
            np.asarray(pdoc["idx_earXneg"])]])

    # groom9 HAIRLINE band (face-frame roots; same box as 8b _sbroot,
    # always on): ordinary children + length taper, routed through the
    # tucked temple guides anteriorly (behind-ear drape, no cheek fall).
    _sbroot = np.zeros(n_root, dtype=bool)
    _ztm = float(args.sideburn_zt_margin_mm) / 1000.0
    if True:
        for _skey, _ssgn in (("idx_earXpos", 1.0),
                             ("idx_earXneg", -1.0)):
            _pv = np.asarray(pdoc["xyz"], dtype=np.float64)[
                np.asarray(pdoc[_skey])]
            _yB = float(np.quantile(_pv[:, 1], 0.90))
            _zT = float(_pv[:, 2].max())
            _zM = float(_pv[:, 2].min())
            _rows = (rxyz[:, 0] * _ssgn > 0)
            _sbroot |= (_rows
                        & (np.abs(rxyz[:, 0]) >= 0.035)
                        & (np.abs(rxyz[:, 0]) < 0.100)
                        & (rxyz[:, 1] < _yB + 0.010)
                        & (rxyz[:, 2] < _zT - _ztm)
                        & (rxyz[:, 2] > _zM - 0.070))
    _hlroot = _sbroot
    # groom9: hairline anterior children join the tuck blend class
    # (tucked same-side guides only -- the (_tuckroot | _hlroot) mask at
    # the three selection sites below), so the face-frame drape routes
    # behind the ear instead of falling down the cheek. Below-vertex
    # rows merge like everyone else.
    # ROUND 3 (orchestrator grade: tuck-routed hairline journeys across
    # the cheek = face curtains; the brief asks for ORDINARY children of
    # the nearest temple guides): REVERTED to ordinary same-side blend
    # (mask = _tuckroot only, below). The new face projective trim (at
    # the trims section) enforces the no-hair-on-face HARD gate at the
    # target's own hairline instead.
    # groom9: no face-frame hug classes (helmet-band cause removed).
    # The hairline band is ordinary children + length taper; the tuck
    # class rides tucked guides with no skin pull. Templates kept only
    # for the build record.
    temple_info = {"hugMm": 0.0, "nRoots": 0,
                   "note": "hug removed in groom9"}

    # K sub-roots per root, jittered on the scalp with MATCHED
    # jitter in scalp-UV, so every child interpolates at its OWN
    # (u,v): neighbouring children get distinct guide weights and
    # fan out over the sheet instead of clustering 14-deep on one
    # backbone blend (the v1 alpha-gap/lock defect).
    parent = np.repeat(np.arange(n_root), K)
    n_child = int(len(parent))
    nn = np.empty(n_root)
    step = 1024
    for a in range(0, n_root, step):
        d = ((rxyz[a:a + step, None, :] - rxyz[None, :, :]) ** 2
             ).sum(axis=2)
        part = np.partition(d, 1, axis=1)[:, 1]
        nn[a:a + step] = np.sqrt(part)
    _duv_nn = np.empty(n_root)
    for a in range(0, n_root, step):
        dd = ((ruv[a:a + step, None, :] - ruv[None, :, :]) ** 2
              ).sum(axis=2) ** 0.5
        _duv_nn[a:a + step] = np.partition(dd, 1, axis=1)[:, 1]
    _uv_per_m = float(np.median(_duv_nn / np.maximum(nn, 1e-9)))
    rng_sub = np.random.RandomState(int(args.subseed))
    _uu = rng_sub.rand(n_child)
    _vv = rng_sub.rand(n_child)
    if K == 1:
        cxyz = rxyz.copy()
        cuv = ruv.copy()
        sub_info = {"perRoot": 1, "jitter": "none (K==1 exact)",
                    "uvPerM": round(_uv_per_m, 4)}
    else:
        r_cell = 0.45 * nn
        rr = r_cell[parent] * np.sqrt(_uu)
        th = 2.0 * np.pi * _vv
        uv_cell_frac = 0.45
        nrm = rnorm[parent]
        nrm = nrm / (np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12)
        ref = np.zeros_like(nrm)
        ref[:, 0] = 1.0
        flip = np.abs(nrm[:, 0]) > 0.9
        ref[flip, 0] = 0.0
        ref[flip, 1] = 1.0
        e1 = ref - (ref * nrm).sum(axis=1)[:, None] * nrm
        e1 = e1 / (np.linalg.norm(e1, axis=1, keepdims=True) + 1e-12)
        e2 = np.cross(nrm, e1)
        jit = (e1 * (rr * np.cos(th))[:, None]
               + e2 * (rr * np.sin(th))[:, None])
        cxyz = rxyz[parent] + jit
        _ruv_cell = uv_cell_frac * _duv_nn
        _rruv = _ruv_cell[parent] * np.sqrt(_uu)
        _thuv = 2.0 * np.pi * _vv
        cuv = ruv[parent] + np.stack(
            [_rruv * np.cos(_thuv), _rruv * np.sin(_thuv)], axis=1)
        sub_info = {"perRoot": K, "seed": int(args.subseed),
                    "cellFrac": 0.45,
                    "uvPerM": round(_uv_per_m, 4),
                    "cellRmmP50": round(float(np.median(r_cell) * 1000.0),
                                        3),
                    "cellRmmMax": round(float(r_cell.max() * 1000.0), 3),
                    "jitMmMax": round(float(
                        np.linalg.norm(jit, axis=1).max() * 1000.0), 3)}
    cside = np.where(cxyz[:, 0] >= part_x, 1.0, -1.0)

    # Per-child guide selection (chunked): 4 nearest same-side
    # guides by the child's OWN scalp-UV, inverse-quartic weights,
    # 1.0-rad cutoff, nearest-alone fallback; below-vertex children
    # side-neutral (sheet merge); tuck-class anterior children blend
    # tucked guides only; 5 mm 3D gap-gate fallback (dropped far
    # guides). Never across the part half-space or the tuck class.
    below_v_c = cxyz[:, 1] > Y_VERTEX_M
    gi_c = np.empty((n_child, N_GUIDES), dtype=np.int64)
    w_c = np.empty((n_child, N_GUIDES), dtype=np.float64)
    _n_alone = 0
    _n_fb = 0
    _n_drop = 0
    _dmax = 0.0
    gate_m = float(args.max_guide_gap_mm) / 1000.0
    chunk = 8192
    for a in range(0, n_child, chunk):
        sl = slice(a, min(a + chunk, n_child))
        nc = sl.stop - sl.start
        duv = ((cuv[sl, None, :] - g_uv[None, :, :]) ** 2
               ).sum(axis=2) ** 0.5
        cs = cside[sl]
        bv = below_v_c[sl]
        same = cs[:, None] == gside_p[None, :]
        same[bv, :] = True
        if _tuck_on:
            # Hairline children borrow the tucked temple backbone rather than
            # inheriting frontal routes that fall across the face.  This is a
            # root-class route choice, not a screen/image trim.
            _cls = (_tuckroot[parent[sl]] | _hlroot[parent[sl]]) & ~bv
            _gcls = tuck_p[None, :]
            same = same & ((_cls[:, None] == _gcls) | bv[:, None])
        dm = np.where(same, duv, np.inf)
        order = np.argsort(dm, axis=1)[:, :N_GUIDES]
        gd = np.take_along_axis(dm, order, axis=1)
        w = 1.0 / (gd + 0.03) ** 4
        w = np.where(gd > 1.0, 0.0, w)
        alone = (w.sum(axis=1) == 0.0)
        w[alone, :] = 0.0
        w[alone, 0] = 1.0
        _n_alone += int(alone.sum())
        if gate_m > 0.0:
            d3 = np.linalg.norm(
                cxyz[sl, None, :] - guide_root[order], axis=2)
            ok = d3 <= gate_m
            fb = ~ok[:, 0]
            if fb.any():
                _n_fb += int(fb.sum())
                fbrows = np.nonzero(fb)[0]
                for sgn in (1.0, -1.0):
                    sel = (cs[fb] == sgn)
                    if not sel.any():
                        continue
                    rows = fbrows[sel]
                    bvc = bv[fb]
                    bvrows = bv[rows]
                    _tr = (_tuckroot[parent[sl]] | _hlroot[parent[sl]])[rows]
                    groups = [((~bvrows), None)]
                    if _tuck_on:
                        groups = [(_tr & ~bvrows, True),
                                  (~_tr & ~bvrows, False),
                                  (bvrows, None)]
                    for _gsel, _gcls in groups:
                        if not _gsel.any():
                            continue
                        sub = np.nonzero(gside_p == sgn)[0]
                        if _gcls is not None:
                            _subc = sub[tuck_p[sub] == _gcls]
                            if len(_subc):
                                sub = _subc
                        if not len(sub):
                            continue
                        pick = sub[nearest_idx(cxyz[sl][rows[_gsel]],
                                              guide_root[sub])]
                        order[rows[_gsel], 0] = pick
                        order[rows[_gsel], 1:] = pick[:, None]
                        w[rows[_gsel], :] = 0.0
                        w[rows[_gsel], 0] = 1.0
                d3 = np.linalg.norm(
                    cxyz[sl, None, :] - guide_root[order], axis=2)
                ok = d3 <= gate_m
            _n_drop += int((~ok[:, 1:]).sum())
            w[~ok] = 0.0
            ws = w.sum(axis=1, keepdims=True)
            empty = (ws[:, 0] == 0.0)
            if empty.any():
                w[empty, :] = 0.0
                w[empty, 0] = 1.0
                ws = w.sum(axis=1, keepdims=True)
            w = w / ws
            _dmax = max(_dmax, float(d3.max()))
        else:
            w = w / w.sum(axis=1, keepdims=True)
        gi_c[sl] = order
        w_c[sl] = w
        del duv, dm, order, gd, w
    # Coherent-field child transport: use the nearest admissible backbone
    # rather than a Euclidean average of four surface routes. Even coherent
    # routes can have a chord through the convex skull; translation of one
    # surface-feasible route cannot create that four-route chord.
    w_c[:, 1:] = 0.0
    w_c[:, 0] = 1.0
    alone_info = {"nAlone": int(_n_alone)}
    gap_info = {"gateMm": float(args.max_guide_gap_mm), "off": False,
                "nFallbackRows": int(_n_fb),
                "nDroppedWeights": int(_n_drop),
                "maxGapMm": round(_dmax * 1000.0, 2)}

    # THE INTERPOLATOR: use one coherent backbone, attached in scalp
    # coordinates through the root take-off.  This avoids the old rigid
    # translation chord through the head while retaining exact child roots.
    G = g_res_p[gi_c]                      # (C,4,P,3)
    G0 = G[:, :, 0:1, :]
    blend = ((G - G0) * w_c[:, :, None, None]).sum(axis=1)
    children = cxyz[:, None, :] + blend
    child_u = (gu_p[gi_c] * w_c).sum(axis=1)  # (C,)
    # True rigid translation per strand: blend root B(0) vs sub-root
    # (shape-preserving shift; adds zero winding by construction).
    B0 = (g_res_p[gi_c][:, :, 0, :] * w_c[:, :, None]).sum(axis=1)
    trans = np.linalg.norm(B0 - cxyz, axis=1) * 1000.0
    # Far-translation snap: strands translated >25 mm (sparse-field
    # edge rows) ride their 3D-nearest admissible guide alone. The
    # far blends are the strands most likely to cut through the
    # head (projection-kink source); the nearest backbone is the
    # smallest rigid shift available. Deterministic.
    snap_info = {"snapMm": 15.0, "nSnapped": 0}
    _far = trans > 15.0
    if _far.any():
        _fr = np.nonzero(_far)[0]
        _csn = np.where(cxyz[_fr, 0] >= part_x, 1.0, -1.0)
        _bvc = below_v_c[_fr]
        _trc = _tuckroot[parent[_fr]] | _hlroot[parent[_fr]]
        for _sgn in (1.0, -1.0):
            _sel = (_csn == _sgn)
            if not _sel.any():
                continue
            _rows = _fr[_sel]
            _bvr = _bvc[_sel]
            _trr = _trc[_sel]
            _groups = [(np.ones(_sel.sum(), dtype=bool), None)]
            if _tuck_on:
                _groups = [(_trr & ~_bvr, True),
                            (~_trr & ~_bvr, False),
                             (_bvr, None)]
            for _gsel, _gcls in _groups:
                if not _gsel.any():
                    continue
                _sub = np.nonzero(gside_p == _sgn)[0]
                if _gcls is not None:
                    _subc = _sub[tuck_p[_sub] == _gcls]
                    if len(_subc):
                        _sub = _subc
                if not len(_sub):
                    continue
                _rr2 = _rows[_gsel]
                _pick = _sub[nearest_idx(cxyz[_rr2],
                                          guide_root[_sub])]
                gi_c[_rr2, 0] = _pick
                gi_c[_rr2, 1:] = _pick[:, None]
                w_c[_rr2, :] = 0.0
                w_c[_rr2, 0] = 1.0
        snap_info["nSnapped"] = int(_far.sum())
        G = g_res_p[gi_c]
        G0 = G[:, :, 0:1, :]
        blend = ((G - G0) * w_c[:, :, None, None]).sum(axis=1)
        children = cxyz[:, None, :] + blend
        child_u = (gu_p[gi_c] * w_c).sum(axis=1)
        B0 = (g_res_p[gi_c][:, :, 0, :] * w_c[:, :, None]).sum(axis=1)
        trans = np.linalg.norm(B0 - cxyz, axis=1) * 1000.0
    # Surface-feasible interpolation is part of constructing raw B, not a
    # downstream repair. Sparse scalp regions translate a legal guide by
    # centimetres; the translated curve can cross the convex skull even
    # though its route is coherent. Fit those raw samples to the exact body
    # surface before any sweep, depth servo, clump, jitter, keep-out, or the
    # bounded final SDF stage.
    _raw_sample, _ = sdf_sampler(sdoc)
    _raw_flat0 = children[:, 1:, :].reshape(-1, 3).copy()
    _raw_flat, raw_surface_fit = radial_surface_fit(
        _raw_flat0, _raw_sample, float(crown[1]), margin_mm=0.3,
        bound_mm=CONSTRUCTOR_FIT_BOUND_MM)
    _raw_delta = np.linalg.norm(_raw_flat - _raw_flat0, axis=1) * 1000.0
    raw_surface_fit.update({
        "stage": "raw interpolation constructor (before downstream stages)",
        "measuredP90Mm": round(float(np.percentile(_raw_delta, 90)), 4),
        "measuredMaxNetMm": round(float(_raw_delta.max()), 4),
        "needsMoreWhy": ("sparse root-to-backbone take-off remains inside "
                          "the exact body SDF after its 8 mm constructor "
                          "budget"),
    })
    children[:, 1:, :] = _raw_flat.reshape(n_child, P - 1, 3)
    _raw_vals, _raw_valid = _raw_sample(_raw_flat)
    _constructor_suppressed = (
        (_raw_valid & (_raw_vals < 0.0)).reshape(n_child, P - 1).any(axis=1))
    raw_surface_fit.update({
        "nChildrenNeedMore": int(_constructor_suppressed.sum()),
        "fallback": ("suppress only children whose raw route still enters "
                     "the body after the 8 mm budget; do not raise the "
                     "constructor-fit bound"),
    })
    trans_info = {"p50": round(float(np.median(trans)), 2),
                  "p90": round(float(np.percentile(trans, 90)), 2),
                  "max": round(float(trans.max()), 2),
                  "gt5mm": int((trans > 5.0).sum()),
                  "gt15mm": int((trans > 15.0).sum())}
    root_err_mm = float(np.linalg.norm(children[:, 0, :] - cxyz,
                                        axis=1).max() * 1000.0)
    blend_info = {"kernel": "nearest admissible coherent guide; four candidates measured but no cross-route positional average",
                  "meanWeight0": round(float(w_c[:, 0].mean()), 4),
                  "nearestAloneFrac": round(float((w_c[:, 1] == 0).mean()),
                                             4),
                  "nAlone": alone_info["nAlone"],
                  "gapGate": gap_info,
                  "translationMm": trans_info,
                  "rootExactnessMmMax": round(root_err_mm, 4)}
    u_info = {"p50": round(float(np.median(child_u)), 3),
              "p90": round(float(np.percentile(child_u, 90)), 3),
              "min": round(float(child_u.min()), 3),
              "max": round(float(child_u.max()), 3)}

    _before_part = children.copy()

    # Part SWEEP (restores the part the v1 strip faked): part-band
    # roots exit laterally away from the part line and flat to the
    # scalp over the first 4-12 mm, then rejoin their interpolated
    # guides (arc-length preserving direction reshape, root exact).
    # Roots ON the line (|x-px| < 0.75 mm) keep natural fall (their
    # upper halves are trimmed by the micro-strip below); strands
    # re-cover the midline below arc 55 mm so no slot propagates
    # down the back (the v1 seam defect).
    _sweeproot = ((np.abs(rxyz[:, 0] - part_x) < PART_BAND_MM / 1000.0)
                  & (rxyz[:, 1] >= PART_Y_LO_M)
                  & (rxyz[:, 1] <= Y_VERTEX_M))
    _striproot = ((np.abs(rxyz[:, 0] - part_x) < 0.00075)
                  & (rxyz[:, 1] >= PART_Y_LO_M)
                  & (rxyz[:, 1] <= Y_VERTEX_M))
    sweep_info = {"on": 1, "bandMm": PART_BAND_MM,
                  "nPartRoots": int(_sweeproot.sum()),
                  "nStripRoots": int(_striproot.sum()), "doneRows": 0}
    # On-line roots keep natural fall (the alternating-sweep
    # experiment opened a bald hole beside the line, not a part:
    # the part cannot open at child level over guides that
    # blanket the midline by shape -- documented in RESULT).
    _swchild = _sweeproot[parent] & ~_striproot[parent]
    # groom9 round 4: offset-class roots skip the sweep (their persistent
    # lateral offset below replaces it: no stack, no S-bend).
    _offroot_hl = _hlroot
    _offroot_nb = ((np.abs(rxyz[:, 0] - part_x) >= 0.0020)
                   & (np.abs(rxyz[:, 0] - part_x)
                      < 0.0060 * 1.0)
                   & (rxyz[:, 1] >= PART_Y_LO_M)
                   & (rxyz[:, 1] <= Y_VERTEX_M))
    _offchild_hl = _offroot_hl[parent]
    _offchild_nb = _offroot_nb[parent] & ~_offchild_hl
    _swchild = _swchild & ~_offchild_hl & ~_offchild_nb
    if _swchild.any():
        _prows = np.nonzero(_swchild)[0]
        _rn = rnorm[parent][_prows]
        _rt = cxyz[_prows]
        _sgn = np.where(_rt[:, 0] >= part_x, 1.0, -1.0)
        _lat = np.zeros_like(_rt)
        _lat[:, 0] = _sgn
        _dflat = _lat - ((_lat * _rn).sum(axis=1)[:, None] * _rn)
        _dl = np.linalg.norm(_dflat, axis=1, keepdims=True) + 1e-12
        _dflat = _dflat / _dl
        for _ri, _rr in enumerate(_prows):
            _p = children[_rr]
            _seg = np.diff(_p, axis=0)
            _sl = np.linalg.norm(_seg, axis=1) + 1e-12
            _arc = np.concatenate([[0.0], np.cumsum(_sl)])
            _do = _seg / _sl[:, None]
            _f = np.clip((_arc[1:] - 0.002) / 0.008, 0.0, 1.0)
            _f = _f * _f * (3.0 - 2.0 * _f)
            _df = _dflat[_ri]
            _dn = _df[None, :] * (1.0 - _f)[:, None] \
                + _do * _f[:, None]
            _dn /= np.linalg.norm(_dn, axis=1, keepdims=True) + 1e-12
            _q = np.empty_like(_p)
            _q[0] = _p[0]
            _q[1:] = _p[0] + np.cumsum(_dn * _sl[:, None], axis=0)
            children[_rr] = _q
        sweep_info["doneRows"] = int(len(_prows))

    # groom9 round 4 PERSISTENT lateral offset (root-position routing,
    # not image trimming): offset-class children shift away from the
    # part line, ramped 0 -> full over the first 30 mm of arc, then
    # HELD (no rejoin: the sweep rejoin re-covers the slot in
    # projection, and the hairline tuck journey needs the lateral
    # clearance to stay out of the face mask). Hairline band: 2.5 mm
    # (clears the ~3 px face-mask rim); near-band roots (2-6 mm from
    # the line): 2.0 mm (part walls stand off the slot). Smooth ramp =
    # no kink (R-LOOP safe); root exact (s=0 untouched).
    off_info = {"hlMm": 2.5, "nbMm": 2.0, "rampMm": 30.0,
                "nHl": int(_offchild_hl.sum()),
                "nNb": int(_offchild_nb.sum())}
    _offchild = _offchild_hl | _offchild_nb
    if _offchild.any():
        _orows = np.nonzero(_offchild)[0]
        _osgn = np.where(cxyz[_orows, 0] >= part_x, 1.0, -1.0)
        _omag = np.where(_offchild_hl[_orows], 0.0025, 0.0020)
        for _oi, _orr in enumerate(_orows):
            _p = children[_orr]
            _seg = np.linalg.norm(np.diff(_p, axis=0), axis=1)
            _arc = np.concatenate([[0.0], np.cumsum(_seg)])
            _w = np.clip(_arc / 0.030, 0.0, 1.0)
            children[_orr, :, 0] = _p[:, 0] + _osgn[_oi] \
                * _omag[_oi] * _w
    off_info["insideSamplesReverted"] = revert_inside_samples(
        _before_part, children, _raw_sample)

    # Depth servo toward the child's own fraction of local thickness.
    servo_info = {"on": int(args.depth_servo), "nMoved": 0,
                  "maxMoveMm": 0.0}
    if int(args.depth_servo) > 0:
        from scipy import ndimage as _ndi
        H = np.load(str(args.hull), allow_pickle=True)
        xs = np.array(H["xs"]); ys = np.array(H["ys"])
        zs = np.array(H["zs"])
        spacing = float(H["spacing"])
        occ = np.array(H["occupancy"], dtype=bool)
        origin = np.array([xs[0], ys[0], zs[0]])
        Docc = _ndi.distance_transform_edt(occ).astype(
            np.float32) * spacing
        sample, _grid = sdf_sampler(sdoc)

        def sample_occ(pts_m):
            pts_mm = np.asarray(pts_m, dtype=np.float64) * 1000.0
            idx = ((pts_mm - origin) / spacing).T
            return _ndi.map_coordinates(Docc, idx, order=1,
                                        mode="constant", cval=np.nan)

        flat = children[:, 1:, :].reshape(-1, 3)
        uc = np.repeat(child_u, P - 1)
        moved = np.zeros(len(flat))
        for _ in range(3):
            sd, inside = sample(flat)
            dd = sample_occ(flat)
            ok = inside & np.isfinite(dd) & (dd > 0.5) \
                & np.isfinite(sd)
            if not ok.any():
                break
            # Outward-only loft floor: the child's own depth
            # fraction of the clipped local column. Never pulls
            # inward (the v1 inward servo collapsed strands onto
            # the skin near the hull boundary).
            T = np.clip(sd[ok] + dd[ok], 7.0, 14.0)
            floor = uc[ok] * T
            short = floor - sd[ok]
            need = short > 0.05
            if not need.any():
                break
            idx = np.nonzero(ok)[0][need]
            step_mm = np.minimum(short[need], 2.0)
            sub = flat[idx]
            grad = np.zeros_like(sub)
            for ax in range(3):
                dd_ = np.zeros_like(sub)
                dd_[:, ax] = 0.002
                v1, _ = sample(sub + dd_)
                v0, _ = sample(sub - dd_)
                grad[:, ax] = (v1 - v0) / 0.004
            glen = np.linalg.norm(grad, axis=1)
            bad = ~(np.isfinite(glen)) | (glen < 1e-9)
            grad[bad] = np.array([0.0, 0.0, 1.0])
            glen[bad] = 1.0
            nrm_ = grad / glen[:, None]
            st = nrm_ * (step_mm / 1000.0)[:, None]
            flat[idx] = sub + st
            moved[idx] += np.linalg.norm(st, axis=1) * 1000.0
        servo_info = {"on": 1, "nMoved": int((moved > 1e-9).sum()),
                      "maxMoveMm": round(float(moved.max()), 3),
                      "childUP50": u_info["p50"]}
        children[:, 1:, :] = flat.reshape(n_child, P - 1, 3)
    # Two clump scales, side-keyed above the vertex (copy groom8a,
    # minus the merge-below logic which stays identical).
    _tcls = (np.zeros(n_child, dtype=np.int64) if not _tuck_on
             else _tuckroot[parent].astype(np.int64))
    cside_cell = np.where(cxyz[:, 1] > Y_VERTEX_M, 0.0, cside)
    _coarse_scale = np.ones(n_child)
    _proot = ((np.abs(rxyz[:, 0] - part_x) < PART_BAND_MM / 1000.0)
              & (rxyz[:, 1] >= PART_Y_LO_M)
              & (rxyz[:, 1] <= Y_VERTEX_M))
    _coarse_scale = np.where(_proot[parent], 0.0, _coarse_scale)
    coarse_keys = [(int(cside_cell[i]),
                    int(np.floor(cxyz[i, 0] / (COARSE_MM / 1000.0))),
                    int(np.floor(cxyz[i, 1] / (COARSE_MM / 1000.0))),
                    int(np.floor(cxyz[i, 2] / (COARSE_MM / 1000.0))),
                    int(_tcls[i]), int(pool[gi_c[i, 0]]))
                   for i in range(n_child)]
    _cpow = float(args.clump_pow)
    _before_coarse = children.copy()
    coarse = clump_pull(children, coarse_keys, float(args.coarse_pull),
                        scale=_coarse_scale, cpow=_cpow)
    coarse["displacement"] = bound_stage(
        _before_coarse, children, COARSE_BOUND_MM)
    coarse["insideSamplesReverted"] = revert_inside_samples(
        _before_coarse, children, _raw_sample)
    fine_keys = [(int(cside_cell[i]),
                  int(np.floor(cxyz[i, 0] / (FINE_MM / 1000.0))),
                  int(np.floor(cxyz[i, 1] / (FINE_MM / 1000.0))),
                  int(np.floor(cxyz[i, 2] / (FINE_MM / 1000.0))),
                  int(_tcls[i]), int(pool[gi_c[i, 0]]))
                 for i in range(n_child)]
    _before_fine = children.copy()
    fine = clump_pull(children, fine_keys, float(args.fine_pull),
                      scale=np.ones(n_child),
                      cpow=_cpow)
    fine["displacement"] = bound_stage(
        _before_fine, children, FINE_BOUND_MM)
    fine["insideSamplesReverted"] = revert_inside_samples(
        _before_fine, children, _raw_sample)

    # Per-child length jitter, sigma 4% about the root, seed 7.
    _before_length = children.copy()
    rng = np.random.RandomState(SEED)
    scale = 1.0 + SIGMA_LEN * rng.randn(n_child)
    _trunc = float(args.len_trunc_sigma)
    _trunc_lo = float(args.len_trunc_lo_sigma)
    if _trunc_lo <= 0.0:
        _trunc_lo = _trunc
    if _trunc > 0.0:
        _lo = 1.0 - _trunc_lo * SIGMA_LEN
        _hi = 1.0 + _trunc * SIGMA_LEN
        scale = np.clip(scale, _lo, _hi)
    children = cxyz[:, None, :] + (children - cxyz[:, None, :]) * scale[
        :, None, None]
    len_info = {"sigma": SIGMA_LEN, "seed": SEED,
                "truncSigma": float(args.len_trunc_sigma),
                "truncLoSigma": float(args.len_trunc_lo_sigma),
                "scaleMin": round(float(scale.min()), 4),
                "scaleMax": round(float(scale.max()), 4)}

    # groom9 HAIRLINE class (replaces sideburn-short): hairline/sideburn
    # roots (same face-frame band as 8b _sbroot) are ORDINARY interpolated
    # children -- same selection, depth, clump, projection as everyone --
    # with a LENGTH TAPER ONLY: deterministic per-parent-root chord scale
    # 0.35 at the face edge of the band -> 1.0 at the ear edge. Shape
    # preserving (no rescale-collapse micro-spaced tails), no skin hug.
    _hlchild = _sbroot[parent]
    _hl_u = np.clip((np.abs(rxyz[parent, 0]) - 0.035) / 0.065, 0.0, 1.0)
    _hl_taper = 0.55 + 0.45 * _hl_u
    hairline_info = {"on": 1, "nStrands": int(_hlchild.sum()),
                     "taperLo": 0.55, "taperHi": 1.0,
                     "bandXmm": [35.0, 100.0]}
    if _hlchild.any():
        _hlidx = np.nonzero(_hlchild)[0]
        children[_hlidx] = cxyz[_hlidx][:, None, :] + (
            children[_hlidx] - cxyz[_hlidx][:, None, :]) \
            * _hl_taper[_hlidx][:, None, None]
    hairline_info["insideSamplesRevertedWithLength"] = \
        revert_inside_samples(_before_length, children, _raw_sample)

    # groom9 round 3: xneg hem tip-boost REMOVED (orchestrator: no
    # trimming/lengthening of strand length by image position). The xneg
    # hem is fixed guide-side by the selective edge slide instead.
    hemboost_info = {"on": 0, "note": "removed round 3 (image-position)"}

    sample, _grid = sdf_sampler(sdoc)

    # groom9: no hug anywhere (the helmet-band cause). Tuck class rides
    # its tucked guides with no skin pull; depth servo + projection hold
    # the drape. sbclamp/sbhug/templehug removed with sideburn-short.
    sbshort_info = {"on": 0, "note": "removed in groom9 (hairline taper)"}
    sbclamp_info = {"on": 0, "note": "removed in groom9"}
    sbhug_info = {"on": 0, "note": "removed in groom9"}
    templehug_info = {"on": 0, "note": "removed in groom9"}

    # Ear keep-out then outside-body projection (copy groom8a; groom9:
    # hairline children included like everyone else -- no exclusion;
    # oscillation cap: samples shoved >12 mm total (crowded-pocket
    # random walk = the R-LOOP kink factory) are reverted and trimmed
    # instead of pushed forever. Trimmed = invisible, so the clearance
    # gate only gets safer and the kinks leave the render).
    _before_ear = children.copy()
    _keep_m = float(args.ear_keep_mm) / 1000.0
    flat_ear = children[:, 1:, :].reshape(-1, 3)
    _flat0 = flat_ear.copy()
    _epush = np.zeros(len(flat_ear))
    from scipy.spatial import cKDTree as _KDT
    _ptree = _KDT(pinna_m)
    for _ in range(EAR_ITERS):
        _d, _ji = _ptree.query(flat_ear, k=1)
        _need = _d < _keep_m
        if not _need.any():
            break
        _away = flat_ear[_need] - pinna_m[_ji[_need]]
        _al = np.linalg.norm(_away, axis=1)
        _al[_al < 1e-12] = 1e-12
        _step = _away / _al[:, None] * (
            (_keep_m - _d[_need] + 0.0002)[:, None])
        _dist = np.linalg.norm(_step, axis=1)
        flat_ear[_need] = flat_ear[_need] + _step
        _epush[_need] += _dist * 1000.0
    _osc = _epush > 12.0
    earosc_trim = np.zeros((n_child, P), dtype=bool)
    if _osc.any():
        flat_ear[_osc] = _flat0[_osc]  # revert: no kink geometry
        _oi = np.nonzero(_osc)[0]
        earosc_trim[_oi // (P - 1), _oi % (P - 1) + 1] = True
    children[:, 1:, :] = flat_ear.reshape(n_child, P - 1, 3)
    _ear_inside_revert = revert_inside_samples(
        _before_ear, children, _raw_sample)
    _df, _ = _ptree.query(flat_ear, k=1)
    ear_info = {"keepMm": _keep_m * 1000.0,
                "nPushed": int((_epush > 0).sum()),
                "maxPushMm": round(float(_epush.max()), 4),
                "minDistAfterMm": round(float(_df.min()) * 1000.0, 3),
                "fracLt3mmAfter": round(float((_df < 0.003).mean()), 5),
                "oscCapMm": 12.0,
                "nOscTrimmed": int(earosc_trim.any(axis=1).sum()),
                "nOscSamples": int(earosc_trim.sum()),
                "insideSamplesReverted": _ear_inside_revert}
    flat = children[:, 1:, :].reshape(-1, 3)
    _flat_preproj = flat.copy()
    flat, proj = project_outside(flat, sample,
                                 margin_mm=SDF_MARGIN_MM,
                                 iters=SDF_ITERS)
    _pdelta = flat - _flat_preproj
    _pdist = np.linalg.norm(_pdelta, axis=1) * 1000.0
    _pfac = np.minimum(1.0, PROJECTION_BOUND_MM /
                       np.maximum(_pdist, 1e-12))
    _pre_child = _pdist.reshape(n_child, P - 1).max(axis=1)
    _over_child = np.nonzero(_pre_child > PROJECTION_BOUND_MM)[0]
    _allow_n = int(np.floor(0.02 * n_child))
    if len(_over_child) <= _allow_n:
        _allow_child = _over_child
    else:
        _allow_child = _over_child[np.argsort(
            _pre_child[_over_child])[-_allow_n:]]
    if len(_allow_child):
        _allow_sample = np.repeat(
            np.isin(np.arange(n_child), _allow_child), P - 1)
        _pfac[_allow_sample] = 1.0
    flat = _flat_preproj + _pdelta * _pfac[:, None]
    _after_dist = np.linalg.norm(flat - _flat_preproj, axis=1) * 1000.0
    _child_proj = _after_dist.reshape(n_child, P - 1).max(axis=1)
    _pv, _pi = sample(flat)
    proj.update({
        "boundMm": PROJECTION_BOUND_MM,
        "nSamplesLimited": int((_pfac < 1.0).sum()),
        "childrenAllowedOver5Mm": int(len(_allow_child)),
        "childrenGt5Mm": int((_child_proj > 5.0 + 1e-6).sum()),
        "childrenGt5Frac": round(float(
            (_child_proj > 5.0 + 1e-6).mean()), 6),
        "maxNetMm": round(float(_after_dist.max()), 4),
        "nInsideAfterBound": int((_pi & (_pv < 0.0)).sum()),
        "passGt5Frac": bool(
            (_child_proj > 5.0 + 1e-6).mean() <= 0.02),
    })
    children[:, 1:, :] = flat.reshape(n_child, P - 1, 3)

    # Part half-space clamps, all roots (copy groom8a final pass).
    _seg2 = np.linalg.norm(np.diff(children, axis=1), axis=2)
    _arc2 = np.concatenate(
        [np.zeros((n_child, 1)), np.cumsum(_seg2, axis=1)], axis=1)
    _rside_c = np.where(rxyz[parent, 0] >= part_x, 1.0, -1.0)[:, None]
    _wrong2 = (_arc2 < 0.040) \
        & ((children[:, :, 0] - part_x) * _rside_c < 0)
    _wrong2[:, 0] = False
    _feather = (_arc2 >= 0.040) & (_arc2 < 0.090) \
        & ((children[:, :, 0] - part_x) * _rside_c < 0) \
        & (children[:, :, 2] < 1.648)
    _feather[:, 0] = False
    partclamp_info = {"on": 1, "nSamples": 0, "nStrands": 0,
                      "nFeather": int(_feather.sum())}
    if _feather.any():
        _fr, _fc = np.nonzero(_feather)
        _wgt = (0.090 - _arc2[_fr, _fc]) / 0.050
        _t = part_x + np.where(rxyz[parent[_fr], 0] >= part_x,
                               1.0, -1.0) * 0.0003
        children[_fr, _fc, 0] = children[_fr, _fc, 0] * (1.0 - _wgt) \
            + _t * _wgt
    if _wrong2.any():
        _wr2, _wc2 = np.nonzero(_wrong2)
        children[_wr2, _wc2, 0] = (
            part_x + np.where(rxyz[parent[_wr2], 0] >= part_x,
                              1.0, -1.0) * 0.0003)
        partclamp_info["nSamples"] = int(_wrong2.sum())
        partclamp_info["nStrands"] = int(np.unique(_wr2).size)
    # Lateral clamp moves can dip samples just inside the body on
    # high-curvature scalp: project all touched strands back out
    # (outward-only) and re-clamp samples the projection carried
    # across (cap 3 rounds). The inside-body hard gate binds this.
    partclamp_info["rounds"] = 0
    _touched = np.unique(np.concatenate(
        [np.nonzero(_wrong2.any(axis=1))[0],
         np.nonzero(_feather.any(axis=1))[0]])
        ) if (_wrong2.any() or _feather.any()) \
        else np.zeros(0, dtype=np.int64)
    for _rd in range(3):
        if not len(_touched):
            break
        partclamp_info["rounds"] = _rd + 1
        _flat3 = children[_touched][:, 1:, :].reshape(-1, 3)
        _vv3, _ii3 = sample(_flat3)
        if not (_ii3 & (_vv3 < 0.3)).any():
            break
        _flat3, _rep3 = project_outside(
            _flat3, sample, margin_mm=0.3, iters=10, over_mm=0.0)
        children[_touched, 1:, :] = _flat3.reshape(
            len(_touched), P - 1, 3)
        _seg3 = np.linalg.norm(
            np.diff(children[_touched], axis=1), axis=2)
        _arc3 = np.concatenate(
            [np.zeros((len(_touched), 1)),
             np.cumsum(_seg3, axis=1)], axis=1)
        _sg3 = np.where(
            rxyz[parent[_touched], 0] >= part_x, 1.0, -1.0)[:, None]
        _w3 = (_arc3 < 0.040) \
            & ((children[_touched][:, :, 0] - part_x) * _sg3 < 0)
        _w3[:, 0] = False
        if not _w3.any():
            break
        _rr3, _cc3 = np.nonzero(_w3)
        children[_touched[_rr3], _cc3, 0] = (
            part_x + np.where(
                rxyz[parent[_touched[_rr3]], 0] >= part_x,
                1.0, -1.0) * 0.0003)

    # A route that still needs more than the constructor's 8 mm budget is
    # explicitly suppressed, not pushed farther through the SDF.  It keeps
    # its stored root and a short outward, invisible stub so the hard
    # mechanics gate sees no hidden body intersections.  This is a bounded
    # construction failure record, not an image-position trim.
    if _constructor_suppressed.any():
        _cs = np.nonzero(_constructor_suppressed)[0]
        _stub = cxyz[_cs] + rnorm[parent[_cs]] * 0.003
        children[_cs, 1:, :] = _stub[:, None, :]
        _sv, _so = _raw_sample(children[_cs, 1:, :].reshape(-1, 3))
        _sb = _so & (_sv < 0.0)
        if _sb.any():
            # Rare malformed scalp normals: retain the exact root, which is
            # the least-displacing mechanically defined anchor.
            _flatstub = children[_cs, 1:, :].reshape(-1, 3)
            _flatstub[_sb] = np.repeat(cxyz[_cs], P - 1, axis=0)[_sb]
            children[_cs, 1:, :] = _flatstub.reshape(len(_cs), P - 1, 3)
        raw_surface_fit["nSuppressedChildren"] = int(len(_cs))
        raw_surface_fit["nSuppressedSamples"] = int(len(_cs) * (P - 1))
    else:
        raw_surface_fit["nSuppressedChildren"] = 0
        raw_surface_fit["nSuppressedSamples"] = 0

    # Radii taper.
    t = np.arange(P) / (P - 1)
    prof = r_root_m + (r_tip_m - r_root_m) * (t ** 1.5)
    radii = np.repeat(prof[None, :], n_child, axis=0).astype(np.float32)
    if _constructor_suppressed.any():
        radii[_constructor_suppressed] = 2e-9

    # groom9 round 2 PART SLOT (round 4: +-2.5 mm): the guide corridor
    # parts the guides but children rooted on the midline re-cover it in
    # projection. Roots within +-2.5 mm of the line keep no cover above
    # arc 55 mm (radii ~0 there); the neighbouring band (2-6 mm roots)
    # stands off laterally by persistent offset instead of rejoining, so
    # no slot propagates down the back but the crown opens.
    _segT = np.linalg.norm(np.diff(children, axis=1), axis=2)
    _arcT = np.concatenate(
        [np.zeros((n_child, 1)), np.cumsum(_segT, axis=1)], axis=1)
    _slotroot = ((np.abs(rxyz[:, 0] - part_x) < 0.0025)
                 & (rxyz[:, 1] >= PART_Y_LO_M)
                 & (rxyz[:, 1] <= Y_VERTEX_M))
    _slotchild = _slotroot[parent][:, None] & (_arcT < 0.055)
    _slotchild[:, 0] = False
    strip_info = {"stripMm": 2.5, "stripArcMm": 55.0,
                  "lineTrim": True,
                  "nRoots": int(_slotroot.sum()),
                  "nStrands": int(_slotroot[parent].sum()),
                  "nSamples": int(_slotchild.sum())}
    if _slotchild.any():
        radii[_slotchild] = 2e-9
    # groom9: oscillation-trimmed ear samples (radii-only, invisible).
    if earosc_trim.any():
        radii[earosc_trim] = 2e-9

    # Concha trims (radii-only; copy groom8a, wrap-independent parts).
    _pb = []
    for _key in ("idx_earXpos", "idx_earXneg"):
        _vv = np.asarray(pdoc["xyz"], dtype=np.float64)[
            np.asarray(pdoc[_key])]
        _pb.append((_vv.min(axis=0) - 0.003, _vv.max(axis=0) + 0.003))
    _pts = children[:, 1:, :].reshape(-1, 3)
    _inbowl = np.zeros(len(_pts), dtype=bool)
    for (_lo, _hi) in _pb:
        _inbowl |= ((_pts >= _lo).all(axis=1)
                    & (_pts <= _hi).all(axis=1))
    _pdist, _ = _ptree.query(_pts, k=1)
    _pin3 = _pdist <= (_keep_m + 1e-6)
    _pin3 &= ~_inbowl
    _n_pintrim = int(_pin3.sum())
    _inbowl |= _pin3
    # Hull-based projective concha trim (all 3 ear views): a sample
    # projecting inside either pinna hull AND >3 mm in front of the
    # pinna surface is invisible. Matches the scorer's crossing
    # test exactly (no far-depth bound); behind-ear drape is kept.
    from scipy.spatial import ConvexHull as _CH, Delaunay as _DE, \
        cKDTree as _KT
    _n_proj = 0
    _projflat = np.zeros(len(_pts), dtype=bool)
    for _pvname in ("front", "three_quarter", "profile_90"):
        _inv, _f = _proj[_pvname]
        _hw = np.ones((len(_pts), 4))
        _hw[:, :3] = _pts
        _lc = (_inv @ _hw.T).T
        _dep = -_lc[:, 2]
        _cc = np.full(len(_pts), -1.0)
        _rr = np.full(len(_pts), -1.0)
        _ok = _dep > 0
        _cc[_ok] = 512.0 + (_lc[_ok, 0] / _dep[_ok]) * _f
        _rr[_ok] = 512.0 - (_lc[_ok, 1] / _dep[_ok]) * _f
        for _key in ("idx_earXpos", "idx_earXneg"):
            _pv = np.asarray(pdoc["xyz"], dtype=np.float64)[
                np.asarray(pdoc[_key])]
            _ph = np.ones((_pv.shape[0], 4))
            _ph[:, :3] = _pv
            _plc = (_inv @ _ph.T).T
            _pdep = -_plc[:, 2]
            _pok = _pdep > 0
            _pcc = 512.0 + (_plc[_pok, 0] / _pdep[_pok]) * _f
            _prr = 512.0 - (_plc[_pok, 1] / _pdep[_pok]) * _f
            _pm = (_pcc >= 0) & (_pcc < 1024) & (_prr >= 0) \
                & (_prr < 1024)
            if not _pm.any():
                continue
            _p2 = np.stack([_pcc[_pm], _prr[_pm]], axis=1)
            _pdep2 = _pdep[_pok][_pm]
            try:
                _tri = _DE(_p2[_CH(_p2).vertices])
            except Exception:
                continue
            _inside = _tri.find_simplex(
                np.stack([_cc[_ok], _rr[_ok]], axis=1)) >= 0
            _oo = np.nonzero(_ok)[0][_inside]
            if not len(_oo):
                continue
            _tree = _KT(_p2)
            _dd, _jj = _tree.query(
                np.stack([_cc[_oo], _rr[_oo]], axis=1), k=1)
            _hit = _oo[_dep[_oo] < _pdep2[_jj] - 0.003]
            _projflat[_hit] = True
        del _hw, _lc, _dep, _cc, _rr
    _projflat &= ~_inbowl.reshape(-1)
    _n_proj = int(_projflat.sum())
    _inbowl |= _projflat
    _inbowl = _inbowl.reshape(n_child, P - 1)
    # Lobe trim (copy groom8a).
    lobetrim_info = {"on": int(args.lobe_trim), "nSamples": 0}
    if int(args.lobe_trim) > 0:
        _ptsL = children[:, 1:, :].reshape(-1, 3)
        _lobe = np.zeros(len(_ptsL), dtype=bool)
        for _lv in ("three_quarter", "profile_90"):
            _invL, _fL = _proj[_lv]
            _hwL = np.ones((len(_ptsL), 4))
            _hwL[:, :3] = _ptsL
            _lcL = (_invL @ _hwL.T).T
            _depL = -_lcL[:, 2]
            _ccL = np.full(len(_ptsL), -1.0)
            _rrL = np.full(len(_ptsL), -1.0)
            _okL = _depL > 0
            _ccL[_okL] = 512.0 + (_lcL[_okL, 0] / _depL[_okL]) * _fL
            _rrL[_okL] = 512.0 - (_lcL[_okL, 1] / _depL[_okL]) * _fL
            for _lk in ("idx_earXpos", "idx_earXneg"):
                _pvL = np.asarray(pdoc["xyz"], dtype=np.float64)[
                    np.asarray(pdoc[_lk])]
                _phL = np.ones((_pvL.shape[0], 4))
                _phL[:, :3] = _pvL
                _plcL = (_invL @ _phL.T).T
                _pdepL = -_plcL[:, 2]
                _pokL = _pdepL > 0
                _pccL = 512.0 + (_plcL[_pokL, 0] / _pdepL[_pokL]) * _fL
                _prrL = 512.0 - (_plcL[_pokL, 1] / _pdepL[_pokL]) * _fL
                _pmL = (_pccL >= 0) & (_pccL < 1024) & (_prrL >= 0) \
                    & (_prrL < 1024)
                if not _pmL.any():
                    continue
                _med = float(np.median(_pccL[_pmL]))
                _bot = float(_prrL[_pmL].max())
                _pd = float(np.median(_pdepL[_pokL][_pmL]))
                _sgnL = 1.0 if 512.0 >= _med else -1.0
                _loL = min(_med + _sgnL * 2.0, _med + _sgnL * 45.0)
                _hiL = max(_med + _sgnL * 2.0, _med + _sgnL * 45.0)
                _lobe |= _okL & (_rrL >= _bot - 10.0) \
                    & (_rrL < _bot + 30.0) & (_ccL >= _loL) \
                    & (_ccL < _hiL)
            del _hwL, _lcL, _depL, _ccL, _rrL
        _lobe &= (radii[:, 1:].reshape(-1) > 1e-6)
        lobetrim_info["nSamples"] = int(_lobe.sum())
        _lbc, _lsc = np.nonzero(_lobe.reshape(n_child, P - 1))
        radii[_lbc, _lsc + 1] = 2e-9
    _trimmed = _inbowl.any(axis=1)
    _rmap = np.ones((n_child, P - 1), dtype=np.float32)
    _rmap[_inbowl] = 0.0
    radii[:, 1:] *= _rmap
    # groom9 round 3: FACE projective trim REMOVED (orchestrator: the
    # face gate must pass by routing, not by cutting strands -- the
    # brow-line blunt bangs were a downstream-trim repeat). Unchanged
    # 8a guides (swept back correctly) + ordinary hairline children of
    # the nearest temple guides carry the face-frame drape back.
    facetrim_info = {"on": 0, "note": "removed round 3 (image-position)"}
    rootdot_info = {"on": int(args.kill_root_dots), "nStrands": 0}
    if int(args.kill_root_dots) > 0:
        _full = ~((radii[:, 1:] > 1e-6).any(axis=1))
        if _full.any():
            radii[_full, 0] = 0.0
        rootdot_info["nStrands"] = int(_full.sum())
    radii[radii == 0.0] = 2e-9
    trim_info = {"nStrands": int(_trimmed.sum()),
                 "nSamples": int(_inbowl.sum()),
                 "projConchaSamples": int(_n_proj),
                 "pinFinalSamples": int(_n_pintrim)}

    pts32 = children.astype(np.float32)
    out_npz = outdir / "strands.npz"
    np.savez_compressed(
        str(out_npz), points=pts32, radii=radii,
        roots=cxyz.astype(np.float32),
        guide_idx=pool[gi_c].astype(np.int32),
        guide_w=w_c.astype(np.float32),
        childu=child_u.astype(np.float32),
        side=cside.astype(np.float32),
        parent=parent.astype(np.int32))
    import hashlib as _hl
    h = _hl.sha256()
    with open(out_npz, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    sha = h.hexdigest()
    C.log_open(out_npz)

    build = {
        "inputs": {"guides": str(args.guides), "roots": str(args.roots),
                   "sdf": str(args.sdf), "hull": str(args.hull)},
        "counts": {"roots": n_root, "guides": n_guide,
                   "pointsPer": P,
                   "childrenPerRoot": K,
                   "children": int(pts32.shape[0])},
        "part": {"partX": part_x, "crownBandN": int(len(band))},
        "vertex": {"yVertexM": Y_VERTEX_M,
                   "nBelowVertexRoots": int(below_v.sum())},
        "model": "interpolated children on coherent groom11 guides (no transport)",
        "blend": blend_info,
        "rawSurfaceFit": raw_surface_fit,
        "childU": u_info,
        "depthServo": servo_info,
        "earKeepout": ear_info,
        "partStyle": {"on": 0, "note": "removed in 8b"},
        "partExtra": {"extraPerPartRoot": 0, "note": "removed in 8b"},
        "partSetback": {"on": 0, "note": "removed in 8b"},
        "partSweep": sweep_info,
        "partOffset": off_info,
        "partStrip": strip_info,
        "farSnap": snap_info,
        "partClamp": partclamp_info,
        "tuckBlend": {"on": int(_tuck_on),
                      "nTuckRoots": int(_tuckroot.sum()),
                      "nTuckGuides": int((tuck_g > 0.5).sum())},
        "conchaTrim": trim_info,
        "faceTrim": facetrim_info,
        "dotGuides": dot_info,
        "subRoots": sub_info,
        "sideburnShort": sbshort_info,
        "sideburnClamp": sbclamp_info,
        "sideburnHug": sbhug_info,
        "templeRoots": temple_info,
        "templeHug": templehug_info,
        "hairlineTaper": hairline_info,
        "hemBoost": hemboost_info,
        "rootDots": rootdot_info,
        "lobeTrim": lobetrim_info,
        "clump": {"coarseMm": COARSE_MM,
                  "coarsePullTip": float(args.coarse_pull),
                  "coarseCells": coarse, "fineMm": FINE_MM,
                  "finePullTip": float(args.fine_pull),
                  "fineCells": fine,
                  "pow": _cpow,
                  "centrePolicy": "same dominant coherent guide, side, tuck class and root cell only"},
        "lengthJitter": len_info,
        "projection": proj,
        "radiiMm": {"root": r_root_m * 1000.0,
                    "tip": r_tip_m * 1000.0,
                    "profile": "linear in t^1.5"},
        "sha256": sha,
        "bytes": int(out_npz.stat().st_size),
    }
    with open(outdir / "build.json", "w") as f:
        json.dump(build, f, indent=1)
    C.log_open(outdir / "build.json")
    C.merge_opened(outdir / "inputs-opened.txt")
    print(json.dumps({"strands": str(out_npz), "sha256": sha[:16],
                      "roots": n_root, "children": n_child,
                      "translationMm": trans_info,
                      "childUP50": u_info["p50"],
                      "projection": proj,
                      "earKeepout": ear_info,
                      "strip": strip_info,
                      "trim": trim_info}, indent=1))


if __name__ == "__main__":
    main()
