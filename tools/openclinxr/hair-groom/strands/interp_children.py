"""groom8b STEP 1: interpolated children on the dense guide set.

Replaces the frame-transport child model (children.py) with
station-owned interpolation in (scalp u,v, depth fraction):

  child(f) = root + sum_i w_i (G_i(f) - G_i(0))

each child sample is a weighted blend of guide samples at the SAME
arc fraction f = s/(P-1), rigidly translated so the root is exact.
No transported frames, no constant 3D offsets in rotating frames:
the rope source named by the groom8a falsifier is gone by
construction. Shape coherence comes from the guides themselves
(turn-gated <=5 deg/step); density from K sub-roots per root.

Depth: each guide carries a depth fraction u (the s06 golden-stride
assignment, recomputed deterministically; tucked guides u=0.55).
Each child gets u_c = sum w_i u_i, and every s>=1 sample is
re-projected toward its own depth fraction of the LOCAL hull column
thickness T(p) = sdf_body(p) + Docc(p) (strict hull5 + exact SDF):
gentle servo (3 rounds, <=1 mm/round, 3 mm cap) along the body-SDF
gradient, then the standard outside-body projection.

Selection (same-side, never across the part half-space or the
tuck/no-tuck boundary): 4 nearest guides by scalp-UV distance,
inverse-quartic weights, 1.0-rad cutoff, nearest-alone fallback;
below-vertex rows side-neutral (sheet merge); tuck-class anterior
rows blend tucked guides only; dot-guide floor 20 mm; band
exclusion; 5 mm 3D gap-gate fallback (far guides dropped).
groom21 flags (all default OFF = legacy behavior above):
--region-weight, --uv-cutoff (default 1.0), --pool-max-move-mm
(default 0.0 = disabled) + --pool-ref.

Kept from groom8a (child-side, transport-free): sub-root jitter,
length jitter sigma 4% trunc [0.92,1.04], two-scale clump
0.20/0.15, sideburn shorts + hug + tuck-behind + clamp, temple hug,
part half-space clamps, ear radial keep-out + exact-SDF projection,
radii-only trims (concha bbox, pin-final, front projective concha,
lobe boxes), kill-root-dots, part SWEEP (lateral flat exits that
vacate the line) + MICRO-STRIP (on-line roots bare above arc 55 mm
only, so no slot propagates down the back).

Dropped: transported frames, tuck-k merge, part-style exits,
part-extra density, setback snap, ear-wrap march, rim-set,
curtain-thin, halo trim, cheek/band trims, hem/curtain extras,
boosts, taper.
groom26 flags (all default OFF = groom25 behaviour):
--backfill-extra + --backfill-xmax/--backfill-zlo/--backfill-zhi:
add N extra children per scalp root in the world -x lower-back box
(root x < xmax, zlo <= z <= zhi, y < y-ear); deterministic continuation
of the sub-root RNG stream so default builds are bit-identical.
--temple-taper F: 0 = off; >0 multiplies temple/sideburn-child tip radii
by (1 - F*t^2) (child-side tip taper, no guide change).
groom30 flags (all default OFF = groom26 behaviour):
--sideburn-cap-lobe: cap sideburn/peri-lobe-short strands from roots in
front of the ear back edge so the lowest sample ends 3 mm above the
lobe bottom; drop strands whose root sits at/below that level.
groom35 flags (all default OFF = groom34 behaviour):
--ear-band-routed: children whose root lies in the ear band
(earframe bandBox/tuckBox union per side) take interpolation weights
ONLY from same-side s14_ear_route-routed guides (groom30 route-stats
REROUTE union, 39 guides; recorded below) and carry a band bit in the
clump keys so they clump to each other (the routed tuck shape) instead
of the curtain mass. No sample moves, no trims.
groom31 flags (all default OFF = groom30 behaviour):
--shirt-sdf PATH + --shirt-clear-mm MM (0.0 = off): keep-out against
the UNION of body SDF and the shirt SDF (same grid schema): every
project-outward call after the depth servo uses min(body, shirt - off)
with off = clear - 0.3, so samples rest `clear` mm off the shirt where
it covers the body (0.3 mm body margin preserved elsewhere).
--cap-reproject: after the sideburn cap, re-project capped strands
outside the keep-out field (the cap collapse drags samples toward
jittered sub-roots sitting at SDF ~ 0).
--lobe-sweep-postcap: re-run the lobe sweep after the cap (the cap's
about-root rescale pulls swept y values back toward the root, partly
undoing the pre-cap sweep on capped strands).
groom36 flags (all default OFF = groom34 behaviour):
--expect-n-new INT (default 2650): legacy non-tuck guide-count guard;
pass the exact-mirror count (2669) for STEP2-built guide sets.
groom37 flags (all default OFF = groom36 behaviour):
--shell-routed-only: children whose BLENDED path (post far-snap, before
any downstream move) enters the 3 mm ear shell take interpolation
weights ONLY from same-side STEP1-routed guides (the "route" array in
the guides file, groom36 = 60 guides; NOT the stale groom30
ROUTED_SIDE union above). Same 4-nearest UV inverse-quartic kernel,
uv-cutoff, region rule, gap gate (fallback = 3D-nearest same-side
routed guide), and 25 mm far-snap (same-side routed) as the main
loop. No clumping change (standard keys, no band bit), no position
moves added: only gi_c/w_c rows change; every downstream stage runs
unchanged. --ear-proxy PATH supplies the xpos/xneg shells.

Writes E/strands.npz (points/radii metres, K per root) and
E/build.json (params, counts, stats, hashes).
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
import part_line as PL
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
COARSE_PULL = 0.20
FINE_PULL = 0.15
CLUMP_POW = 2.0
PART_BAND_MM = 12.0
PART_Y_LO_M = -0.060
Y_VERTEX_M = 0.0342
EAR_KEEP_M = 0.004
EAR_ITERS = 60
SDF_MARGIN_MM = 0.3
SDF_ITERS = 50
# groom35 STEP 3: s14_ear_route-routed guide set = REROUTE union across
# groom30's four route passes (build-30b/c/d/e guides-*-route.json
# "guides" entries with decision == "REROUTE"; per-pass sides agree,
# no conflicts). Index order is unchanged by mirror34 (aux arrays kept
# verbatim), so these global ids apply to guides-34mirror directly.
ROUTED_XPOS = (445, 521, 522, 533, 537, 550, 551, 642, 645, 1666,
               2118, 2137, 2145, 2507, 2589)
ROUTED_XNEG = (93, 208, 346, 523, 580, 620, 654, 682, 698, 725, 822,
               886, 1013, 1664, 1702, 1788, 1795, 1854, 1927, 1932,
               2109, 2263, 2646, 2700)
ROUTED_SIDE = {g: 1.0 for g in ROUTED_XPOS}
ROUTED_SIDE.update({g: -1.0 for g in ROUTED_XNEG})
U_TUCK = 0.55
HUG_MM = 2.0

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
    p.add_argument("--expect-n-new", type=int, default=2650,
                   help="groom36: legacy shape guard for the non-tuck "
                   "guide count (2707-57); pass the new-set count "
                   "(e.g. 2669) for exact-mirror builds")
    p.add_argument("--r-root-mm", type=float, default=R_ROOT_M * 1000.0)
    p.add_argument("--r-tip-mm", type=float, default=R_TIP_M * 1000.0)
    p.add_argument("--subseed", type=int, default=SUBSEED)
    p.add_argument("--max-guide-gap-mm", type=float, default=5.0)
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
    # groom21: region-limited child pools. ALL default OFF so default
    # builds are bit-identical to groom8b/19 (proven by rebuild hash).
    p.add_argument("--region-weight", action="store_true", default=False,
                   help="blend a child only with guides whose boundary "
                   "weight w(root) differs from its own by <= 0.5, at "
                   "most 1 cross-boundary guide")
    p.add_argument("--uv-cutoff", type=float, default=1.0,
                   help="scalp-UV cutoff rad (default 1.0 = legacy)")
    p.add_argument("--pool-max-move-mm", type=float, default=0.0,
                   help="<=0 disables; >0 drops pool guides displaced "
                   "more than this from --pool-ref")
    p.add_argument("--pool-ref", default="",
                   help="reference guides .npz for --pool-max-move-mm")
    p.add_argument("--region-y-ear", type=float, default=-0.0635)
    p.add_argument("--region-z-nape", type=float, default=1.51)
    # groom26: world -x lower-back density backfill (default OFF).
    p.add_argument("--backfill-extra", type=int, default=0,
                   help="0 = off; >0 extra children per qualifying root")
    p.add_argument("--backfill-xmax", type=float, default=-0.01,
                   help="qualify roots with world x < xmax (metres)")
    p.add_argument("--backfill-zlo", type=float, default=1.51,
                   help="qualify roots with world z >= zlo (metres)")
    p.add_argument("--backfill-zhi", type=float, default=1.60,
                   help="qualify roots with world z <= zhi (metres)")
    # groom26: child-side temple tip taper (default OFF).
    p.add_argument("--temple-taper", type=float, default=0.0,
                   help="0 = off; >0 tip taper factor for temple children")
    # groom26 FIX3: below-lobe source fix (default OFF = legacy).
    p.add_argument("--lobe-drop-roots", action="store_true", default=False,
                   help="drop scalp roots below the lobe lowest point and "
                   "in front of the ear back edge from the child-root "
                   "mask (no children for them)")
    p.add_argument("--lobe-tuck", action="store_true", default=False,
                    help="sweep ear-column samples (z within 25 mm below "
                    "the lobe, y in ear span) behind the ear (child-side "
                    "positional re-route into the curtain, then "
                    "re-project outside the body)")
    p.add_argument("--sideburn-cap-lobe", action="store_true",
                    default=False,
                    help="cap strands from roots in front of the ear back "
                    "edge so tips end >= 3 mm above the lobe bottom "
                    "(per-root 3D length rule; default OFF)")
    # groom31: shirt-as-obstacle + cap fixes (all default OFF).
    p.add_argument("--shirt-sdf", default="",
                    help="shirt SDF grid (.npz, sdf_sampler schema); "
                    "empty = off (legacy body-only keep-out)")
    p.add_argument("--shirt-clear-mm", type=float, default=0.0,
                    help="<=0 disables; >0 keep-out clearance in mm off "
                    "the shirt surface where it covers the body")
    p.add_argument("--cap-reproject", action="store_true",
                    default=False,
                    help="re-project capped strands outside the keep-out "
                    "field after the sideburn cap")
    p.add_argument("--lobe-sweep-postcap", action="store_true",
                     default=False,
                     help="re-run the lobe sweep after the cap")
    # groom35: ear-band routed tuck (default OFF = legacy blends).
    p.add_argument("--ear-band-routed", action="store_true",
                     default=False,
                     help="children whose root lies in the ear band "
                     "(earframe bandBox/tuckBox union per side) blend "
                     "ONLY same-side s14_ear_route-routed guides and "
                     "carry a band bit in the clump keys")
    # groom37: routed-only re-blend for shell-entering children
    # (default OFF = legacy blends).
    p.add_argument("--shell-routed-only", action="store_true",
                     default=False,
                     help="children whose blended path enters the 3 mm "
                     "ear shell re-blend ONLY from same-side "
                     "STEP1-routed guides (guides-file route array)")
    p.add_argument("--part-jitter-mm", type=float, default=0.0,
                   help="hair-part1 (a): max lateral part-line noise; "
                        "0 = legacy straight plane (byte-identical)")
    p.add_argument("--part-jitter-seed", type=int, default=20261106)
    p.add_argument("--flow-bias-deg", type=float, default=0.0,
                   help="hair-part1 (c): one-sided crown flow yaw about "
                        "the root normal; 0 = off (byte-identical)")
    p.add_argument("--flow-bias-side", type=float, default=1.0)
    p.add_argument("--ear-proxy", default="",
                     help="ear-proxy.npz with xpos/xneg 3 mm shells; "
                     "required with --shell-routed-only")
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
    # hair-part1 (a): seeded jittered part line; off -> scalar legacy plane
    _pj, part_jitter_rec = PL.make(args.part_jitter_mm,
                                   args.part_jitter_seed)

    def pline(y):
        return part_x if _pj is None else part_x + _pj(y)

    rside = np.where(rxyz[:, 0] >= pline(rxyz[:, 1]), 1.0, -1.0)
    tuck_g = (np.asarray(gdoc["tuck"], dtype=np.float64)
              if "tuck" in gdoc else np.zeros(n_guide))
    band_g = (np.asarray(gdoc["band"], dtype=np.float64)
              if "band" in gdoc else np.zeros(n_guide))
    n_new = int((tuck_g < 0.5).sum())
    gu = np.full(n_guide, U_TUCK)
    uu_new = 0.3 + 0.6 * ((np.arange(n_new) * PHI) % 1.0)
    gu[tuck_g < 0.5] = uu_new[: int((tuck_g < 0.5).sum())]
    assert n_new == int(args.expect_n_new), (n_new, args.expect_n_new)

    guides_w = F.head_to_world(curves_head, crown)
    g_res = np.stack([F.resample_arc(guides_w[g], P)
                      for g in range(n_guide)])
    _glen = np.linalg.norm(np.diff(g_res, axis=1), axis=2).sum(axis=1)
    _floor_m = float(args.min_guide_len_mm) / 1000.0
    if _floor_m > 0.0:
        pool = np.nonzero((_glen >= _floor_m) & (band_g < 0.5))[0]
    else:
        pool = np.nonzero(band_g < 0.5)[0]
    # groom21 --pool-max-move-mm: drop pool guides displaced more than
    # the threshold from the reference set (guides-8a). Disabled (<=0)
    # leaves the pool bit-identical to legacy.
    pool_drop_info = {"on": False, "ref": str(args.pool_ref),
                      "maxMoveMm": float(args.pool_max_move_mm),
                      "nDropped": 0}
    if float(args.pool_max_move_mm) > 0.0 and str(args.pool_ref):
        _rdoc = np.load(str(args.pool_ref), allow_pickle=True)
        _rhead = np.asarray(_rdoc["curves_head"], dtype=np.float64)
        _rcrown = np.asarray(_rdoc["crown"], dtype=np.float64)
        assert _rhead.shape == curves_head.shape, \
            (_rhead.shape, curves_head.shape)
        _rw = F.head_to_world(_rhead, _rcrown)
        _mv = np.linalg.norm(guides_w - _rw, axis=2).max(axis=1) \
            * 1000.0
        _keep = _mv[pool] <= float(args.pool_max_move_mm)
        pool_drop_info["on"] = True
        pool_drop_info["nDropped"] = int((~_keep).sum())
        pool_drop_info["moveP50"] = round(float(np.median(_mv[pool])), 3)
        pool_drop_info["moveP90"] = round(
            float(np.percentile(_mv[pool], 90)), 3)
        pool_drop_info["moveMax"] = round(float(_mv[pool].max()), 3)
        pool = pool[_keep]
        C.log_open(args.pool_ref)
    n_pool = int(len(pool))
    g_res_p = g_res[pool]
    gu_p = gu[pool]
    tuck_p = (tuck_g[pool] > 0.5)
    guide_root = g_res_p[:, 0, :]
    g_near = nearest_idx(guide_root, rxyz)
    g_uv = ruv[g_near]
    gside_p = np.where(guide_root[:, 0] >= pline(guide_root[:, 1]), 1.0, -1.0)
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
    # groom35 STEP 3 (default OFF): ear-band roots per side = roots in
    # the earframe bandBox/tuckBox UNION (no near-ball: the band is the
    # routing-relevant zone, not the tuck class). Band children blend
    # ONLY same-side s14_ear_route-routed guides (ROUTED_* above).
    _band_on = bool(args.ear_band_routed) and (earframe is not None)
    _bandroot = np.zeros(n_root, dtype=bool)
    if _band_on:
        for _sgn, _side in ((1.0, "xpos"), (-1.0, "xneg")):
            _bb = earframe["sides"][_side]["bandBoxMm"]
            _tb = earframe["sides"][_side]["tuckBoxMm"]
            _xlo = min(float(_bb["xLo"]), float(_tb["xLo"]))
            _xhi = max(float(_bb["xHi"]), float(_tb["xHi"]))
            _ymax = max(float(_bb["yMax"]), float(_tb["yMax"]))
            _zlo = min(float(_bb["zLo"]), float(_tb["zLo"]))
            _zhi = max(float(_bb["zHi"]), float(_tb["zHi"]))
            _rows = (_rmm[:, 0] * _sgn > 0)
            _bandroot |= _rows & (np.abs(_rmm[:, 0]) >= _xlo) \
                & (np.abs(_rmm[:, 0]) < _xhi) \
                & (_rmm[:, 1] < _ymax) \
                & (_rmm[:, 2] >= _zlo) \
                & (_rmm[:, 2] < _zhi)
    _routed_side_p = np.array([ROUTED_SIDE.get(int(g), 0.0)
                               for g in pool], dtype=np.float64)
    band_info = {"on": int(_band_on),
                 "nBandRoots": int(_bandroot.sum()) if _band_on else 0,
                 "routedXpos": [int(g) for g in ROUTED_XPOS],
                 "routedXneg": [int(g) for g in ROUTED_XNEG],
                 "routedInPoolXpos": int(((_routed_side_p == 1.0)).sum()),
                 "routedInPoolXneg": int((_routed_side_p == -1.0).sum()),
                 "src": "groom30 REROUTE union (build-30b/c/d/e "
                        "guides-*-route.json)",
                 "bandDef": "earframe bandBox/tuckBox union per side, "
                            "no near-ball",
                 "clumpKey": "band bit appended to coarse/fine keys "
                             "when on"}

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

    # groom26 FIX3: below-lobe per-side thresholds from the pinna
    # (metres, world): lobe lowest = min z; front/back edges = max/min y;
    # |x| span for the side test. Computed always (cheap); APPLIED only
    # via --lobe-drop-roots / --lobe-tuck, so default builds stay
    # bit-identical.
    _lobe = {}
    for _lkey, _lsgn in (("idx_earXpos", 1.0), ("idx_earXneg", -1.0)):
        _lpv = np.asarray(pdoc["xyz"], dtype=np.float64)[
            np.asarray(pdoc[_lkey])]
        _lobe[_lsgn] = {"zmin": float(_lpv[:, 2].min()),
                        "yfront": float(_lpv[:, 1].max()),
                        "yback": float(_lpv[:, 1].min()),
                        "xmin": float(np.abs(_lpv[:, 0]).min()),
                        "xmax": float(np.abs(_lpv[:, 0]).max())}
    # (a) roots below the lobe lowest point and in front of the ear's
    # back edge (the scalp ends at the hairline above/behind the lobe).
    _lobedrop = np.zeros(n_root, dtype=bool)
    for _lsgn, _lb in _lobe.items():
        _lobedrop |= ((rxyz[:, 0] * _lsgn > 0)
                      & (rxyz[:, 2] < _lb["zmin"])
                      & (rxyz[:, 1] > _lb["yback"])
                      & (np.abs(rxyz[:, 0]) >= _lb["xmin"] - 0.020)
                      & (np.abs(rxyz[:, 0]) <= _lb["xmax"] + 0.020))
    _lobe_drop_on = bool(args.lobe_drop_roots)
    lobe_drop_info = {"on": _lobe_drop_on,
                      "nRoots": int(_lobedrop.sum()) if _lobe_drop_on
                      else 0,
                      "thresholdsM": {str(k): v for k, v in _lobe.items()}}

    # Sideburn roots (front of ear, below helix top; copy groom8a).
    _sbroot = np.zeros(n_root, dtype=bool)
    _ztm = float(args.sideburn_zt_margin_mm) / 1000.0
    if int(args.sideburn_short) > 0:
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
    # Face-frame hug classes (narrow by design): the sideburn
    # shorts plus the tuck class (near-ear drape routed behind).
    # The broad curtain is NOT hugged (v2 hugged the whole temple
    # band to <=1.5 mm and collapsed the loft gate to 1.0/1.2 mm;
    # guides read 8.4/17.6 parietal, 6.7/11.9 temple).
    _temple = _sbroot | _tuckroot
    temple_info = {"hugMm": float(args.temple_hug_mm),
                   "nRoots": int(_temple.sum())}

    # groom26 FIX3 (b): ear-band roots whose strands would fall UNDER the
    # lobe are re-routed behind the ear: they join the tuck class for
    # guide selection (tuck-guides-only blending). Band = ear |x| +/- 20
    # mm, y from 10 mm behind the back edge to 30 mm in front of the
    # front edge, z at/above the lobe bottom - 10 mm; sideburn shorts
    # keep their own style (excluded); dropped (a) roots are gone anyway.
    _lobeband = np.zeros(n_root, dtype=bool)
    for _lsgn, _lb in _lobe.items():
        _lobeband |= ((rxyz[:, 0] * _lsgn > 0)
                      & (np.abs(rxyz[:, 0]) >= _lb["xmin"] - 0.020)
                      & (np.abs(rxyz[:, 0]) <= _lb["xmax"] + 0.020)
                      & (rxyz[:, 1] >= _lb["yback"] - 0.010)
                      & (rxyz[:, 1] <= _lb["yfront"] + 0.030)
                      & (rxyz[:, 2] >= _lb["zmin"] - 0.010))
    _lobeband &= ~_sbroot
    if _lobe_drop_on:
        _lobeband &= ~_lobedrop
    _lobe_tuck_on = bool(args.lobe_tuck)
    # groom26 FIX3 (b): ear-band root mask (re-route candidates). The
    # sweep itself runs on positions after the outside-body projection
    # (below): samples hanging in the ear column (z within 25 mm below
    # the lobe, y in ear span, |x| at/under the ear outer edge) are
    # swept behind the ear into the curtain, then re-projected outside
    # the body. Guide selection is untouched (legacy blends).
    _lobe_sweep_on = bool(args.lobe_tuck)
    lobe_tuck_info = {"on": _lobe_tuck_on,
                      "nRoots": int(_lobeband.sum()) if _lobe_tuck_on
                      else 0}

    # K sub-roots per root, jittered on the scalp with MATCHED
    # jitter in scalp-UV, so every child interpolates at its OWN
    # (u,v): neighbouring children get distinct guide weights and
    # fan out over the sheet instead of clustering 14-deep on one
    # backbone blend (the v1 alpha-gap/lock defect).
    _kept = np.nonzero(~_lobedrop if _lobe_drop_on
                       else np.ones(n_root, dtype=bool))[0]
    parent = np.repeat(_kept, K)
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
        cxyz = rxyz[_kept].copy()
        cuv = ruv[_kept].copy()
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
    cside = np.where(cxyz[:, 0] >= pline(cxyz[:, 1]), 1.0, -1.0)

    # groom26 world -x lower-back density backfill (default OFF).
    # Qualifying ROOTS: x < xmax, zlo <= z <= zhi, y < y_ear (behind the
    # ear plane = back). Each qualifying root gets --backfill-extra extra
    # children with jitter drawn as a deterministic continuation of the
    # sub-root RNG stream. Guarded so the default path consumes no extra
    # RNG and stays bit-identical.
    _bf_extra = int(args.backfill_extra)
    _bf_info = {"on": bool(_bf_extra > 0),
                "extraPerRoot": _bf_extra,
                "xmaxM": float(args.backfill_xmax),
                "zloM": float(args.backfill_zlo),
                "zhiM": float(args.backfill_zhi),
                "yEarM": float(args.region_y_ear),
                "nRoots": 0, "nExtra": 0}
    if _bf_extra > 0:
        _bf_qual = ((rxyz[:, 0] < float(args.backfill_xmax))
                    & (rxyz[:, 2] >= float(args.backfill_zlo))
                    & (rxyz[:, 2] <= float(args.backfill_zhi))
                    & (rxyz[:, 1] < float(args.region_y_ear)))
        if _lobe_drop_on:
            _bf_qual &= ~_lobedrop
        _bf_roots = np.nonzero(_bf_qual)[0]
        _bf_info["nRoots"] = int(len(_bf_roots))
        if len(_bf_roots):
            _bf_parent = np.repeat(_bf_roots, _bf_extra)
            _n_bf = int(len(_bf_parent))
            _bf_info["nExtra"] = _n_bf
            _uub = rng_sub.rand(_n_bf)
            _vvb = rng_sub.rand(_n_bf)
            if K == 1:
                _bf_cxyz = rxyz[_bf_parent].copy()
                _bf_cuv = ruv[_bf_parent].copy()
            else:
                _bf_rr = r_cell[_bf_parent] * np.sqrt(_uub)
                _bf_th = 2.0 * np.pi * _vvb
                _bf_nrm = rnorm[_bf_parent]
                _bf_nrm = _bf_nrm / (np.linalg.norm(
                    _bf_nrm, axis=1, keepdims=True) + 1e-12)
                _bf_ref = np.zeros_like(_bf_nrm)
                _bf_ref[:, 0] = 1.0
                _bf_flip = np.abs(_bf_nrm[:, 0]) > 0.9
                _bf_ref[_bf_flip, 0] = 0.0
                _bf_ref[_bf_flip, 1] = 1.0
                _bf_e1 = _bf_ref - (_bf_ref * _bf_nrm).sum(
                    axis=1)[:, None] * _bf_nrm
                _bf_e1 = _bf_e1 / (np.linalg.norm(
                    _bf_e1, axis=1, keepdims=True) + 1e-12)
                _bf_e2 = np.cross(_bf_nrm, _bf_e1)
                _bf_jit = (_bf_e1 * (_bf_rr * np.cos(_bf_th))[:, None]
                           + _bf_e2 * (_bf_rr * np.sin(_bf_th))[:, None])
                _bf_cxyz = rxyz[_bf_parent] + _bf_jit
                _bf_ruv_cell = uv_cell_frac * _duv_nn
                _bf_rruv = _bf_ruv_cell[_bf_parent] * np.sqrt(_uub)
                _bf_thuv = 2.0 * np.pi * _vvb
                _bf_cuv = ruv[_bf_parent] + np.stack(
                    [_bf_rruv * np.cos(_bf_thuv),
                     _bf_rruv * np.sin(_bf_thuv)], axis=1)
            parent = np.concatenate([parent, _bf_parent])
            n_child = int(len(parent))
            cxyz = np.vstack([cxyz, _bf_cxyz])
            cuv = np.vstack([cuv, _bf_cuv])
            cside = np.where(cxyz[:, 0] >= pline(cxyz[:, 1]), 1.0, -1.0)

    # groom21 region weights: the same w(root) as s11_back_coherent
    # (smoothstep over 25 mm across the coronal plane through the ear
    # canals; tuck guides w = 0). Computed always (cheap); APPLIED
    # only when --region-weight is set, so default builds are
    # bit-identical.
    def _wpos(pts):
        _t = np.clip((float(args.region_y_ear) - pts[:, 1]) / 0.025,
                     0.0, 1.0)
        _w = _t * _t * (3.0 - 2.0 * _t)
        return np.where(pts[:, 2] > float(args.region_z_nape), _w, 0.0)
    _guide_w = _wpos(guide_root)
    _guide_w = np.where(tuck_p, 0.0, _guide_w)
    _child_w = _wpos(cxyz)
    region_info = {"on": bool(args.region_weight),
                   "yEarM": float(args.region_y_ear),
                   "zNapeM": float(args.region_z_nape),
                   "widthMm": 25.0, "tol": 0.5, "maxCross": 1,
                   "nCrossUsed": 0}
    uv_cut = float(args.uv_cutoff)

    # Per-child guide selection (chunked): 4 nearest same-side
    # guides by the child's OWN scalp-UV, inverse-quartic weights,
    # --uv-cutoff rad cutoff (default 1.0 = legacy), nearest-alone
    # fallback; below-vertex children side-neutral (sheet merge);
    # tuck-class anterior children blend tucked guides only; 5 mm 3D
    # gap-gate fallback (dropped far guides). Never across the part
    # half-space or the tuck class. With --region-weight, at most 1
    # cross-boundary (w differs > 0.5) guide per child.
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
            _cls = _tuckroot[parent[sl]] & ~bv
            _gcls = tuck_p[None, :]
            same = same & ((_cls[:, None] == _gcls) | bv[:, None])
        if _band_on:
            # band rows REPLACE the tuck constraint: routed same-side
            # pool only (tuck guides are near-disjoint from the routed
            # set, so intersection would empty the pool).
            _bbr = _bandroot[parent[sl]] & ~bv
            if _bbr.any():
                _rallow = (_routed_side_p[None, :] == cs[:, None])
                same = np.where(_bbr[:, None], _rallow, same)
        dm = np.where(same, duv, np.inf)
        order = np.argsort(dm, axis=1)[:, :N_GUIDES]
        gd = np.take_along_axis(dm, order, axis=1)
        w = 1.0 / (gd + 0.03) ** 4
        w = np.where(gd > uv_cut, 0.0, w)
        if args.region_weight:
            # a child blends only guides whose w differs from its own
            # by <= 0.5, at most 1 cross-boundary guide (the first
            # outside candidate in UV order; the rest zeroed).
            _gw = _guide_w[order]
            _cw = _child_w[sl][:, None]
            _dw = np.abs(_gw - _cw)
            _within = _dw <= 0.5
            _outside = ~_within
            _keep = _within.copy()
            _has = _outside.any(axis=1)
            if _has.any():
                _r = np.nonzero(_has)[0]
                _fc = _outside[_r].argmax(axis=1)
                _keep[_r, _fc] = True
                region_info["nCrossUsed"] += int(
                    ((w[_r] * _keep[_r]).sum(axis=1) > 0).sum())
            w = np.where(_keep, w, 0.0)
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
                    _tr = _tuckroot[parent[sl]][rows]
                    _br = (_bandroot[parent[sl]][rows]
                           if _band_on else
                           np.zeros(len(rows), dtype=bool))
                    groups = [((~bvrows), None)]
                    if _tuck_on:
                        groups = [(_tr & ~bvrows, True),
                                  (~_tr & ~bvrows, False),
                                  (bvrows, None)]
                    if _band_on:
                        # band rows ride the 3D-nearest same-side routed
                        # guide (replaces the tuck class for band rows).
                        _nb = ~_br & ~bvrows
                        if _tuck_on:
                            groups = [(_br & ~bvrows, "routed"),
                                      (_tr & _nb, True),
                                      (~_tr & _nb, False),
                                      (bvrows, None)]
                        else:
                            groups = [(_br & ~bvrows, "routed"),
                                      (_nb, None)]
                    for _gsel, _gcls in groups:
                        if not _gsel.any():
                            continue
                        sub = np.nonzero(gside_p == sgn)[0]
                        if _gcls == "routed":
                            _subc = sub[_routed_side_p[sub] == sgn]
                            if len(_subc):
                                sub = _subc
                            else:
                                continue
                        elif _gcls is not None:
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
    alone_info = {"nAlone": int(_n_alone)}
    gap_info = {"gateMm": float(args.max_guide_gap_mm), "off": False,
                "nFallbackRows": int(_n_fb),
                "nDroppedWeights": int(_n_drop),
                "maxGapMm": round(_dmax * 1000.0, 2)}

    # THE INTERPOLATOR: child(f) = root + sum w (G(f) - G(0)).
    # Root exact by construction; shape = translated guide average.
    G = g_res_p[gi_c]                      # (C,4,P,3)
    G0 = G[:, :, 0:1, :]
    blend = ((G - G0) * w_c[:, :, None, None]).sum(axis=1)  # (C,P,3)
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
    snap_info = {"snapMm": 25.0, "nSnapped": 0}
    _far = trans > 25.0
    if _far.any():
        _fr = np.nonzero(_far)[0]
        _csn = np.where(cxyz[_fr, 0] >= pline(cxyz[_fr, 1]), 1.0, -1.0)
        _bvc = below_v_c[_fr]
        _trc = _tuckroot[parent[_fr]]
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
            if _band_on:
                _brr = _bandroot[parent[_rows]]
                _nb = ~_brr & ~_bvr
                if _tuck_on:
                    _groups = [(_brr & ~_bvr, "routed"),
                               (_trr & _nb, True),
                               (~_trr & _nb, False),
                               (_bvr, None)]
                else:
                    _groups = [(_brr & ~_bvr, "routed"),
                               (_nb, None)]
            for _gsel, _gcls in _groups:
                if not _gsel.any():
                    continue
                _sub = np.nonzero(gside_p == _sgn)[0]
                if _gcls == "routed":
                    _subc = _sub[_routed_side_p[_sub] == _sgn]
                    if len(_subc):
                        _sub = _subc
                    else:
                        continue
                elif _gcls is not None:
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
    trans_info = {"p50": round(float(np.median(trans)), 2),
                   "p90": round(float(np.percentile(trans, 90)), 2),
                   "max": round(float(trans.max()), 2),
                   "gt5mm": int((trans > 5.0).sum()),
                   "gt15mm": int((trans > 15.0).sum())}
    # groom37 STEP 1 (default OFF): routed-only re-blend. Guarded so
    # the default path is bit-identical (no extra RNG, no array
    # changes when off).
    shell_routed_info = {"on": False}
    _rerouted = np.zeros(n_child, dtype=bool)
    if bool(args.shell_routed_only):
        import gates34 as _G
        assert str(args.ear_proxy), "--ear-proxy required"
        _pxdoc = np.load(str(args.ear_proxy), allow_pickle=True)
        C.log_open(args.ear_proxy)
        assert "route" in gdoc, "guides lack STEP1 route array"
        _route = (np.asarray(gdoc["route"], dtype=np.float64) > 0.5)
        shell_routed_info = {
            "on": True, "proxy": str(args.ear_proxy),
            "nRoutedGuides": int(_route.sum()),
            "nRoutedInPoolXpos": 0, "nRoutedInPoolXneg": 0,
            "nHitXpos": 0, "nHitXneg": 0,
            "nReroutedXpos": 0, "nReroutedXneg": 0,
            "nGapFallback": 0, "nGapDropped": 0,
            "nFarSnapRouted": 0}

        def _any_hit(_pts, _sv, _sf):
            _sv = np.ascontiguousarray(
                np.asarray(_sv, dtype=np.float64))
            _sf = np.asarray(_sf, dtype=np.int64)
            _tris = _sv[_sf]
            _sbmin, _sbmax = _sv.min(axis=0), _sv.max(axis=0)
            _n = _pts.shape[0]
            _hit = np.zeros(_n, dtype=bool)
            for _a in range(0, _n, 40000):
                _sl = slice(_a, min(_a + 40000, _n))
                _p0 = _pts[_sl, :-1, :].reshape(-1, 3)
                _p1 = _pts[_sl, 1:, :].reshape(-1, 3)
                _smin = np.minimum(_p0, _p1)
                _smax = np.maximum(_p0, _p1)
                _cand = ((_smax[:, 0] >= _sbmin[0])
                         & (_smin[:, 0] <= _sbmax[0])
                         & (_smax[:, 1] >= _sbmin[1])
                         & (_smin[:, 1] <= _sbmax[1])
                         & (_smax[:, 2] >= _sbmin[2])
                         & (_smin[:, 2] <= _sbmax[2]))
                _ci = np.nonzero(_cand)[0]
                if not len(_ci):
                    continue
                _q0, _q1 = _p0[_ci], _p1[_ci]
                _dv = _q1 - _q0
                _pierced = np.zeros(len(_ci), dtype=bool)
                _tmin = _tris.min(axis=1)
                _tmax = _tris.max(axis=1)
                _gmin = _smin[_ci].min(axis=0)
                _gmax = _smax[_ci].max(axis=0)
                for _t in range(len(_tris)):
                    if _pierced.all():
                        break
                    if not ((_tmax[_t] >= _gmin).all()
                            and (_tmin[_t] <= _gmax).all()):
                        continue
                    _pierced |= _G._mt_intersect(
                        _q0, _dv, _tris[_t, 0], _tris[_t, 1],
                        _tris[_t, 2])
                _rest = np.nonzero(~_pierced)[0]
                if len(_rest):
                    _mid = (_q0[_rest] + _q1[_rest]) / 2.0
                    _dd = np.zeros(len(_rest), dtype=np.int32)
                    _dvx = np.zeros_like(_mid)
                    _dvx[:, 0] = 1.0
                    for _t in range(len(_tris)):
                        _dd += _G._mt_intersect(
                            _mid, _dvx, _tris[_t, 0], _tris[_t, 1],
                            _tris[_t, 2]).astype(np.int32)
                    _pierced[_rest] |= (_dd % 2) == 1
                _full = np.zeros(_p0.shape[0], dtype=bool)
                _full[_ci] = _pierced
                _hm = _full.reshape(min(40000, _n - _a), P - 1)
                _hit[_sl] = _hm.any(axis=1)
            return _hit
        _hit_px = _any_hit(children,
                           _pxdoc["xpos_shell_v"],
                           _pxdoc["xpos_shell_f"])
        _hit_nx = _any_hit(children,
                           _pxdoc["xneg_shell_v"],
                           _pxdoc["xneg_shell_f"])
        _hit = _hit_px | _hit_nx
        shell_routed_info["nHitXpos"] = int(
            (_hit & (cside == 1.0)).sum())
        shell_routed_info["nHitXneg"] = int(
            (_hit & (cside == -1.0)).sum())
        _routed_p = _route[pool]
        _allow = {1.0: np.nonzero(
            _routed_p & (gside_p == 1.0))[0],
            -1.0: np.nonzero(
            _routed_p & (gside_p == -1.0))[0]}
        shell_routed_info["nRoutedInPoolXpos"] = int(
            len(_allow[1.0]))
        shell_routed_info["nRoutedInPoolXneg"] = int(
            len(_allow[-1.0]))
        for _sgn in (1.0, -1.0):
            _sub = _allow[_sgn]
            assert len(_sub) >= N_GUIDES, (_sgn, len(_sub))
            _rows = np.nonzero(_hit & (cside == _sgn))[0]
            if not len(_rows):
                continue
            _duv = ((cuv[_rows, None, :]
                     - g_uv[_sub][None, :, :]) ** 2
                    ).sum(axis=2) ** 0.5
            _ord = np.argsort(_duv, axis=1)[:, :N_GUIDES]
            _pick = _sub[_ord]
            _gd = np.take_along_axis(_duv, _ord, axis=1)
            _w = 1.0 / (_gd + 0.03) ** 4
            _w = np.where(_gd > uv_cut, 0.0, _w)
            if args.region_weight:
                _gw = _guide_w[_pick]
                _cw = _child_w[_rows][:, None]
                _dw = np.abs(_gw - _cw)
                _within = _dw <= 0.5
                _outside = ~_within
                _keep = _within.copy()
                _has = _outside.any(axis=1)
                if _has.any():
                    _r = np.nonzero(_has)[0]
                    _fc = _outside[_r].argmax(axis=1)
                    _keep[_r, _fc] = True
                    region_info["nCrossUsed"] += int(
                        ((_w[_r] * _keep[_r]).sum(axis=1) > 0).sum())
                _w = np.where(_keep, _w, 0.0)
            _alone_r = (_w.sum(axis=1) == 0.0)
            _w[_alone_r, :] = 0.0
            _w[_alone_r, 0] = 1.0
            if gate_m > 0.0:
                _d3 = np.linalg.norm(
                    cxyz[_rows, None, :] - guide_root[_pick],
                    axis=2)
                _ok = _d3 <= gate_m
                _fb = ~_ok[:, 0]
                if _fb.any():
                    _fr = np.nonzero(_fb)[0]
                    _npick = _sub[nearest_idx(
                        cxyz[_rows][_fr], guide_root[_sub])]
                    _pick[_fr, 0] = _npick
                    _pick[_fr, 1:] = _npick[:, None]
                    _w[_fr, :] = 0.0
                    _w[_fr, 0] = 1.0
                    shell_routed_info["nGapFallback"] += int(
                        _fb.sum())
                    _d3 = np.linalg.norm(
                        cxyz[_rows, None, :]
                        - guide_root[_pick], axis=2)
                    _ok = _d3 <= gate_m
                shell_routed_info["nGapDropped"] += int(
                    (~_ok[:, 1:]).sum())
                _w[~_ok] = 0.0
                _ws = _w.sum(axis=1, keepdims=True)
                _empty = (_ws[:, 0] == 0.0)
                if _empty.any():
                    _w[_empty, :] = 0.0
                    _w[_empty, 0] = 1.0
                    _ws = _w.sum(axis=1, keepdims=True)
                _w = _w / _ws
            else:
                _w = _w / _w.sum(axis=1, keepdims=True)
            gi_c[_rows] = _pick
            w_c[_rows] = _w
            _Gr = g_res_p[_pick]
            _blend_r = ((_Gr - _Gr[:, :, 0:1, :])
                        * _w[:, :, None, None]).sum(axis=1)
            children[_rows] = cxyz[_rows, None, :] + _blend_r
            child_u[_rows] = (gu_p[_pick] * _w).sum(axis=1)
            _B0r = (_Gr[:, :, 0, :]
                    * _w[:, :, None]).sum(axis=1)
            _tr = (np.linalg.norm(_B0r - cxyz[_rows], axis=1)
                   * 1000.0)
            _far_r = _tr > 25.0
            if _far_r.any():
                _rr = _rows[_far_r]
                _npick2 = _sub[nearest_idx(
                    cxyz[_rr], guide_root[_sub])]
                gi_c[_rr, 0] = _npick2
                gi_c[_rr, 1:] = _npick2[:, None]
                w_c[_rr, :] = 0.0
                w_c[_rr, 0] = 1.0
                _Gr2 = g_res_p[gi_c[_rr]]
                _bl2 = (_Gr2 - _Gr2[:, :, 0:1, :]).sum(axis=1)
                children[_rr] = cxyz[_rr, None, :] + _bl2
                child_u[_rr] = gu_p[gi_c[_rr, 0]]
                _B0r2 = _Gr2[:, 0, 0, :]
                _tr[_far_r] = (np.linalg.norm(
                    _B0r2 - cxyz[_rr], axis=1) * 1000.0)
                shell_routed_info["nFarSnapRouted"] += int(
                    _far_r.sum())
            trans[_rows] = _tr
            _rerouted[_rows] = True
            if _sgn == 1.0:
                shell_routed_info["nReroutedXpos"] = int(
                    len(_rows))
            else:
                shell_routed_info["nReroutedXneg"] = int(
                    len(_rows))
                del _hit_px, _hit_nx, _hit
    trans_info = {"p50": round(float(np.median(trans)), 2),
                   "p90": round(float(np.percentile(trans, 90)), 2),
                   "max": round(float(trans.max()), 2),
                   "gt5mm": int((trans > 5.0).sum()),
                   "gt15mm": int((trans > 15.0).sum())}
    root_err_mm = float(np.linalg.norm(children[:, 0, :] - cxyz,
                                        axis=1).max() * 1000.0)
    blend_info = {"kernel": "per-child positional 4-nearest UV "
                            "1/(duv+0.03)^4, cutoff 1.0 rad, "
                            "nearest-alone fallback",
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

    # Part SWEEP (restores the part the v1 strip faked): part-band
    # roots exit laterally away from the part line and flat to the
    # scalp over the first 4-12 mm, then rejoin their interpolated
    # guides (arc-length preserving direction reshape, root exact).
    # Roots ON the line (|x-px| < 0.75 mm) keep natural fall (their
    # upper halves are trimmed by the micro-strip below); strands
    # re-cover the midline below arc 55 mm so no slot propagates
    # down the back (the v1 seam defect).
    _sweeproot = ((np.abs(rxyz[:, 0] - pline(rxyz[:, 1])) < PART_BAND_MM / 1000.0)
                  & (rxyz[:, 1] >= PART_Y_LO_M)
                  & (rxyz[:, 1] <= Y_VERTEX_M))
    _striproot = ((np.abs(rxyz[:, 0] - pline(rxyz[:, 1])) < 0.00075)
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
    if _swchild.any():
        _prows = np.nonzero(_swchild)[0]
        _rn = rnorm[parent][_prows]
        _rt = cxyz[_prows]
        _sgn = np.where(_rt[:, 0] >= pline(_rt[:, 1]), 1.0, -1.0)
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
            _f = np.clip((_arc[1:] - 0.002) / 0.004, 0.0, 1.0)
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

    # hair-part1 (c): one-sided flow bias. Children of part-region
    # roots on --flow-bias-side yaw about their root normal through the
    # root by theta * w_x * w_arc (w_x: 1 at the part line -> 0 at
    # 40 mm; w_arc: 1 up to arc 40 mm -> 0 at 80 mm). Off = untouched.
    flowbias_info = None
    if float(args.flow_bias_deg) != 0.0:
        _fb_r = rxyz[parent]
        _fb_d = np.abs(_fb_r[:, 0] - pline(_fb_r[:, 1]))
        _fb_sel = ((rside[parent] == float(args.flow_bias_side))
                   & (_fb_r[:, 1] >= PART_Y_LO_M)
                   & (_fb_r[:, 1] <= Y_VERTEX_M) & (_fb_d < 0.040))
        _fb_rows = np.nonzero(_fb_sel)[0]
        _wx = np.clip(_fb_d[_fb_rows] / 0.040, 0.0, 1.0)
        _wx = 1.0 - _wx * _wx * (3.0 - 2.0 * _wx)
        _pp = children[_fb_rows]
        _sl = np.linalg.norm(np.diff(_pp, axis=1), axis=2)
        _ar = np.concatenate([np.zeros((len(_pp), 1)),
                              np.cumsum(_sl, axis=1)], axis=1)
        _wa = np.clip((_ar - 0.040) / 0.040, 0.0, 1.0)
        _wa = 1.0 - _wa * _wa * (3.0 - 2.0 * _wa)
        _th = np.radians(float(args.flow_bias_deg)) * _wx[:, None] * _wa
        _k = rnorm[parent[_fb_rows]]
        _k = _k / (np.linalg.norm(_k, axis=1, keepdims=True) + 1e-12)
        _v = _pp - _pp[:, :1, :]
        _kk = _k[:, None, :]
        _c, _s = np.cos(_th)[..., None], np.sin(_th)[..., None]
        _rot = (_v * _c + np.cross(np.broadcast_to(_kk, _v.shape), _v) * _s
                + _kk * (_v * _kk).sum(axis=2, keepdims=True) * (1.0 - _c))
        _new = _pp[:, :1, :] + _rot
        _mv = np.linalg.norm(_new - _pp, axis=2) * 1000.0
        children[_fb_rows] = _new
        flowbias_info = {"deg": float(args.flow_bias_deg),
                         "side": float(args.flow_bias_side),
                         "bandMm": 40.0, "arcFullMm": 40.0,
                         "arcZeroMm": 80.0,
                         "nStrands": int(len(_fb_rows)),
                         "moveMmMax": round(float(_mv.max()), 3)
                         if len(_fb_rows) else 0.0}

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
            T = np.clip(sd[ok] + dd[ok], 6.0, 20.0)
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
    # groom35: band bit (tuck-hold shape). Default OFF = zeros; keys
    # below only carry the extra element when the flag is on, so the
    # legacy 5-tuple path is byte-identical.
    _bcls = (_bandroot[parent].astype(np.int64) if _band_on
             else np.zeros(n_child, dtype=np.int64))
    cside_cell = np.where(cxyz[:, 1] > Y_VERTEX_M, 0.0, cside)
    _coarse_scale = np.where(_sbroot[parent], 0.0, 1.0)
    _proot = ((np.abs(rxyz[:, 0] - pline(rxyz[:, 1])) < PART_BAND_MM / 1000.0)
              & (rxyz[:, 1] >= PART_Y_LO_M)
              & (rxyz[:, 1] <= Y_VERTEX_M))
    _coarse_scale = np.where(_proot[parent], 0.0, _coarse_scale)
    coarse_keys = [(int(cside_cell[i]),
                    int(np.floor(cxyz[i, 0] / (COARSE_MM / 1000.0))),
                    int(np.floor(cxyz[i, 1] / (COARSE_MM / 1000.0))),
                    int(np.floor(cxyz[i, 2] / (COARSE_MM / 1000.0))),
                    int(_tcls[i]))
                   + ((int(_bcls[i]),) if _band_on else ())
                   for i in range(n_child)]
    _cpow = float(args.clump_pow)
    coarse = clump_pull(children, coarse_keys, float(args.coarse_pull),
                        scale=_coarse_scale, cpow=_cpow)
    fine_keys = [(int(cside_cell[i]),
                    int(np.floor(cxyz[i, 0] / (FINE_MM / 1000.0))),
                    int(np.floor(cxyz[i, 1] / (FINE_MM / 1000.0))),
                    int(np.floor(cxyz[i, 2] / (FINE_MM / 1000.0))),
                    int(_tcls[i]))
                   + ((int(_bcls[i]),) if _band_on else ())
                   for i in range(n_child)]
    fine = clump_pull(children, fine_keys, float(args.fine_pull),
                      scale=np.where(_sbroot[parent], 0.0, 1.0),
                      cpow=_cpow)

    # Per-child length jitter, sigma 4% about the root, seed 7.
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

    # Sideburn shorts: rescale about roots to 12-24 mm (copy groom8a).
    _sbchild = (_sbroot[parent] if int(args.sideburn_short) > 0
                else np.zeros(n_child, dtype=bool))
    _sblo = float(args.sideburn_len_mm[0]) / 1000.0
    _sbhi = float(args.sideburn_len_mm[1]) / 1000.0
    sbshort_info = {"on": int(args.sideburn_short),
                    "nStrands": int(_sbchild.sum())}
    if _sbchild.any():
        _rng_sb = np.random.RandomState(SEED + 101)
        _u = _rng_sb.rand(n_child)
        _tgt = _sblo + (_sbhi - _sblo) * _u
        _seglen = np.linalg.norm(np.diff(children, axis=1),
                                 axis=2).sum(axis=1) + 1e-12
        _f = (_tgt / _seglen)[_sbchild]
        _sbidx = np.nonzero(_sbchild)[0]
        children[_sbidx] = cxyz[_sbidx][:, None, :] + (
            children[_sbidx] - cxyz[_sbidx][:, None, :]) \
            * _f[:, None, None]
        sbshort_info["targetMm"] = [float(args.sideburn_len_mm[0]),
                                    float(args.sideburn_len_mm[1])]

    sample, _grid = sdf_sampler(sdoc)
    # groom31: shirt-as-obstacle keep-out (default OFF = sample stays
    # the body sampler; default builds provably untouched). When on,
    # sample_keep returns min(body, shirt - off) with inside = either,
    # so every project-outward call below rests samples `clear` mm off
    # the shirt where it covers the body (off = clear - body margin).
    shirt_info = {"on": False, "path": str(args.shirt_sdf),
                  "clearMm": float(args.shirt_clear_mm)}
    sample_keep = sample
    if str(args.shirt_sdf) and float(args.shirt_clear_mm) > 0.0:
        _shdoc = np.load(str(args.shirt_sdf), allow_pickle=True)
        C.log_open(args.shirt_sdf)
        _sh_sample, _ = sdf_sampler(_shdoc)
        _sh_off = float(args.shirt_clear_mm) - SDF_MARGIN_MM

        def sample_keep(pts_m, _b=sample, _s=_sh_sample,
                        _off=_sh_off):
            _bv, _bi = _b(pts_m)
            _svv, _si = _s(pts_m)
            _b2 = np.where(_bi, _bv, np.inf)
            # shirt sign is only trustworthy near its surface (open
            # mesh: neck/sleeve/hem holes, torso-interior votes); use
            # the shirt branch within 10 mm of the surface, body alone
            # elsewhere. Above z 1.40 (the collar rim zone; fabric top
            # 1.422) there is no fabric: the neck-hole parity vote is
            # garbage, so the shirt branch stays off there.
            _near = _si & (np.abs(_svv) < 10.0) & (pts_m[:, 2] < 1.40)
            _s2 = np.where(_near, _svv - _off, np.inf)
            _v = np.minimum(_b2, _s2)
            _in = _bi | _near
            return np.where(_in, _v, np.nan), _in

        shirt_info["on"] = True
        shirt_info["offsetMm"] = round(_sh_off, 3)
    # Sideburn clamp (copy groom8a: collapse + project, 2 rounds).
    sbclamp_info = {"on": int(args.sideburn_short), "nClamped": 0,
                    "maxBeforeMm": 0.0, "maxAfterMm": 0.0, "rounds": 0}
    if _sbchild.any():
        _sbi = np.nonzero(_sbchild)[0]
        _sL = np.linalg.norm(np.diff(children[_sbi], axis=1),
                             axis=2).sum(axis=1)
        sbclamp_info["maxBeforeMm"] = round(float(_sL.max() * 1000.0), 1)
        for _rd in range(2):
            _sL = np.linalg.norm(np.diff(children[_sbi], axis=1),
                                 axis=2).sum(axis=1)
            _long = _sbi[_sL > _sbhi]
            if not len(_long):
                break
            sbclamp_info["rounds"] = _rd + 1
            sbclamp_info["nClamped"] = int(
                sbclamp_info["nClamped"] + len(_long))
            for _q in _long:
                _p = np.asarray(children[_q], dtype=np.float64)
                _seg = np.linalg.norm(np.diff(_p, axis=0), axis=1)
                _arc = np.concatenate([[0.0], np.cumsum(_seg)])
                _cutmm = max(_sbhi - 0.004, 0.010)
                _cut = max(int(np.searchsorted(_arc, _cutmm)), 2)
                _cut = min(int(_cut), P - 1)
                _lo, _hi = _arc[_cut - 1], _arc[_cut]
                _fr = 0.0 if _hi <= _lo \
                    else (_cutmm - _lo) / (_hi - _lo)
                _qc = _p[_cut - 1] * (1.0 - _fr) + _p[_cut] * _fr
                # Micro-spaced tail (not a hard point): zero-length
                # segments produce garbage tangents that fire the
                # turn-event metric; spacing the collapsed tail by
                # 1 um along the incoming direction keeps every
                # segment aligned (no turn) with no visible change.
                _din = _p[_cut - 1] - _p[_cut - 2]
                _din = _din / (np.linalg.norm(_din) + 1e-12)
                _jj = np.arange(P - _cut)[:, None]
                children[_q, _cut:] = _qc + _jj * 1e-6 * _din
            _sbflat = children[_long, 1:, :].reshape(-1, 3)
            _sbflat, _sbproj = project_outside(
                _sbflat, sample_keep, margin_mm=0.3, iters=20,
                over_mm=0.0)
            children[_long, 1:, :] = _sbflat.reshape(
                len(_long), P - 1, 3)
        _sL2 = np.linalg.norm(np.diff(children[_sbi], axis=1),
                               axis=2).sum(axis=1)
        sbclamp_info["maxAfterMm"] = round(
            float(_sL2.max() * 1000.0), 1)

    # Hug: sideburn class + temple band floats pulled to the skin.
    def _hug(mask_child, hug_mm, tag, rounds=40):
        info = {"on": 1, "hugMm": hug_mm, "nPushed": 0,
                "maxPullMm": 0.0}
        if hug_mm <= 0.0 or not mask_child.any():
            info["on"] = 0
            return info
        _idx = np.nonzero(mask_child)[0]
        _flat = children[_idx][:, 1:, :].reshape(-1, 3).copy()
        _pulled = np.zeros(len(_flat))
        for _ in range(rounds):
            _vv, _ii = sample(_flat)
            _need = _ii & (_vv > hug_mm)
            if not _need.any():
                break
            _ix = np.nonzero(_need)[0]
            _sub = _flat[_ix]
            _grad = np.zeros_like(_sub)
            for _ax in range(3):
                _dd = np.zeros_like(_sub)
                _dd[:, _ax] = 0.002
                _v1, _ = sample(_sub + _dd)
                _v0, _ = sample(_sub - _dd)
                _grad[:, _ax] = (_v1 - _v0) / 0.004
            _glen = np.linalg.norm(_grad, axis=1)
            _bad = ~(np.isfinite(_glen)) | (_glen < 1e-9)
            _grad[_bad] = np.array([0.0, 0.0, -1.0])
            _glen[_bad] = 1.0
            _want = np.minimum(_vv[_ix] - 1.0, 3.0) / 1000.0
            _step = (_grad / _glen[:, None]) * _want[:, None]
            _dist = np.linalg.norm(_step, axis=1)
            _flat[_ix] = _sub - _step
            _pulled[_ix] += _dist * 1000.0
        children[_idx, 1:, :] = _flat.reshape(len(_idx), P - 1, 3)
        _sbflat2 = children[_idx, 1:, :].reshape(-1, 3)
        _sbflat2, _sbproj2 = project_outside(
            _sbflat2, sample_keep, margin_mm=0.3, iters=20, over_mm=0.0)
        children[_idx, 1:, :] = _sbflat2.reshape(len(_idx), P - 1, 3)
        info["nPushed"] = int((_pulled > 0).sum())
        info["maxPullMm"] = round(float(_pulled.max()), 4)
        return info

    sbhug_info = _hug(_sbchild, float(args.sideburn_hug_mm), "sb")
    _temple_child = _temple[parent] & ~_sbchild
    templehug_info = _hug(_temple_child, float(args.temple_hug_mm),
                          "temple")

    # Ear keep-out then outside-body projection (copy groom8a).
    _keep_m = float(args.ear_keep_mm) / 1000.0
    flat_ear = children[:, 1:, :].reshape(-1, 3)
    _epush = np.zeros(len(flat_ear))
    _sbko = np.repeat(_sbchild, P - 1)
    from scipy.spatial import cKDTree as _KDT
    _ptree = _KDT(pinna_m)
    for _ in range(EAR_ITERS):
        _d, _ji = _ptree.query(flat_ear, k=1)
        _need = (_d < _keep_m) & ~_sbko
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
    children[:, 1:, :] = flat_ear.reshape(n_child, P - 1, 3)
    _df, _ = _ptree.query(flat_ear, k=1)
    ear_info = {"keepMm": _keep_m * 1000.0,
                "nPushed": int((_epush > 0).sum()),
                "maxPushMm": round(float(_epush.max()), 4),
                "minDistAfterMm": round(float(_df.min()) * 1000.0, 3),
                "fracLt3mmAfter": round(float((_df < 0.003).mean()), 5)}
    flat = children[:, 1:, :].reshape(-1, 3)
    flat, proj = project_outside(flat, sample_keep,
                                 margin_mm=SDF_MARGIN_MM,
                                 iters=SDF_ITERS)
    children[:, 1:, :] = flat.reshape(n_child, P - 1, 3)

    # Part half-space clamps, all roots (copy groom8a final pass).
    _seg2 = np.linalg.norm(np.diff(children, axis=1), axis=2)
    _arc2 = np.concatenate(
        [np.zeros((n_child, 1)), np.cumsum(_seg2, axis=1)], axis=1)
    _rside_c = np.where(rxyz[parent, 0] >= pline(rxyz[parent, 1]),
                        1.0, -1.0)[:, None]
    _wrong2 = (_arc2 < 0.040) \
        & ((children[:, :, 0] - pline(children[:, :, 1])) * _rside_c < 0)
    _wrong2[:, 0] = False
    _feather = (_arc2 >= 0.040) & (_arc2 < 0.090) \
        & ((children[:, :, 0] - pline(children[:, :, 1])) * _rside_c < 0) \
        & (children[:, :, 2] < 1.648)
    _feather[:, 0] = False
    partclamp_info = {"on": 1, "nSamples": 0, "nStrands": 0,
                      "nFeather": int(_feather.sum())}
    if _feather.any():
        _fr, _fc = np.nonzero(_feather)
        _wgt = (0.090 - _arc2[_fr, _fc]) / 0.050
        _t = pline(children[_fr, _fc, 1]) + np.where(
            rxyz[parent[_fr], 0] >= pline(rxyz[parent[_fr], 1]),
                               1.0, -1.0) * 0.0003
        children[_fr, _fc, 0] = children[_fr, _fc, 0] * (1.0 - _wgt) \
            + _t * _wgt
    if _wrong2.any():
        _wr2, _wc2 = np.nonzero(_wrong2)
        children[_wr2, _wc2, 0] = (
            pline(children[_wr2, _wc2, 1]) + np.where(
                rxyz[parent[_wr2], 0] >= pline(rxyz[parent[_wr2], 1]),
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
        _vv3, _ii3 = sample_keep(_flat3)
        if not (_ii3 & (_vv3 < 0.3)).any():
            break
        _flat3, _rep3 = project_outside(
            _flat3, sample_keep, margin_mm=0.3, iters=10, over_mm=0.0)
        children[_touched, 1:, :] = _flat3.reshape(
            len(_touched), P - 1, 3)
        _seg3 = np.linalg.norm(
            np.diff(children[_touched], axis=1), axis=2)
        _arc3 = np.concatenate(
            [np.zeros((len(_touched), 1)),
             np.cumsum(_seg3, axis=1)], axis=1)
        _sg3 = np.where(
            rxyz[parent[_touched], 0] >= pline(rxyz[parent[_touched], 1]),
            1.0, -1.0)[:, None]
        _w3 = (_arc3 < 0.040) \
            & ((children[_touched][:, :, 0]
                - pline(children[_touched][:, :, 1])) * _sg3 < 0)
        _w3[:, 0] = False
        if not _w3.any():
            break
        _rr3, _cc3 = np.nonzero(_w3)
        children[_touched[_rr3], _cc3, 0] = (
            pline(children[_touched[_rr3], _cc3, 1]) + np.where(
                rxyz[parent[_touched[_rr3]], 0]
                >= pline(rxyz[parent[_touched[_rr3]], 1]),
                1.0, -1.0) * 0.0003)

    # groom26 FIX3 (b): sweep ear-column strands behind the ear.
    # Runs on FINAL positions (after the part-clamp projection rounds)
    # so no later stage can drift samples back into the column. The
    # drape must not hang in the ear column below the lobe (the target
    # keeps this column empty; its curtain passes behind). Strands are
    # diverted ABOVE the lobe (over a 30 mm run) so no sample ever
    # enters the under-lobe box. Diverted samples (z below zmin+30mm
    # down to any depth, y in span, |x| at/under the ear outer edge,
    # same side) get y pushed to 10 mm behind the back edge (clear of
    # the head surface, so the re-projection has nothing to snap back
    # into the box) with a smoothstep weight (0 at zmin+30mm, 1
    # at/below the lobe) and a 12 mm front-edge feather (the curtain
    # parts around the ear naturally, no slot). Touched strands are
    # re-projected outside the keep-out field.
    # Guarded (default OFF = no-op).
    lobe_sweep_info = {"on": _lobe_sweep_on, "nSamples": 0,
                       "nStrands": 0, "maxPushMm": 0.0}

    def _run_lobe_sweep(_tag):
        _tot_s = 0
        _touched_all = np.zeros(n_child, dtype=bool)
        _tot_push = 0.0
        _rd = 0
        # Iterate push+project: the blind push target (10 mm behind the
        # back edge) can land inside tissue (ear/head sulcus), whose
        # re-projection then ejects the sample forward into the gate
        # zone. Re-sweep the still-violating samples (escalating push)
        # until the zone reads clear or rounds run out. Vectorised.
        for _rd in range(8):
            _swp = np.zeros((n_child, P - 1), dtype=bool)
            _push = np.zeros((n_child, P - 1), dtype=np.float64)
            for _ssgn, _slb in _lobe.items():
                _zm = _slb["zmin"]
                _in = ((children[:, 1:, 2] < _zm + 0.030)
                       & (children[:, 1:, 1] >= _slb["yback"] - 0.002)
                       & (children[:, 1:, 1] <= _slb["yfront"] + 0.014)
                       & ((children[:, 1:, 0] * _ssgn) > 0)
                       & (np.abs(children[:, 1:, 0])
                          >= _slb["xmin"] - 0.005)
                       & (np.abs(children[:, 1:, 0]) <= _slb["xmax"]))
                _w = np.clip(((_zm + 0.030 - children[:, 1:, 2])
                              / 0.030), 0.0, 1.0)
                _w = _w * _w * (3.0 - 2.0 * _w)
                _fy = np.clip(((_slb["yfront"] + 0.014
                                - children[:, 1:, 1]) / 0.012),
                               0.0, 1.0)
                _fy = _fy * _fy * (3.0 - 2.0 * _fy)
                # groom31: below the lobe there is no curtain to
                # part -- the target column is empty -- so the
                # front-edge feather (which leaves a 12 mm unswept
                # lane the gate counts) is lifted there.
                _below = children[:, 1:, 2] < _zm
                _fy = np.where(_below, 1.0, _fy)
                _w = _w * _fy
                _dst = (_slb["yback"] - 0.010
                        - _rd * 0.015) - children[:, 1:, 1]
                _need = _in & (_dst < 0) & (_w > 0)
                _swp |= _need
                _push = np.where(_need, _dst * _w, _push)
            if not _swp.any():
                break
            _touched = np.nonzero(_swp.any(axis=1))[0]
            _fr, _fc = np.nonzero(_swp)
            children[_fr, _fc + 1, 1] += _push[_fr, _fc]
            _tot_s += int(_swp.sum())
            _touched_all[_touched] = True
            _tot_push = max(_tot_push, round(
                float(np.abs(_push[_swp]).max() * 1000.0), 3))
            _flat4 = children[_touched][:, 1:, :].reshape(-1, 3)
            _flat4, _rep4 = project_outside(
                _flat4, sample_keep, margin_mm=0.3, iters=20,
                over_mm=0.0)
            children[_touched, 1:, :] = _flat4.reshape(
                len(_touched), P - 1, 3)
        _info = {"nSamples": _tot_s,
                 "nStrands": int(_touched_all.sum()),
                 "maxPushMm": _tot_push, "rounds": _rd + 1}
        return _info

    if _lobe_sweep_on:
        _pre = _run_lobe_sweep("pre")
        lobe_sweep_info.update(_pre)

    # groom30: sideburn cap above the lobe (default OFF = no-op).
    # Operator hard rule: no hair below the earlobe. Root class: the
    # builder's sideburn roots (front-of-ear, below helix top) whose
    # sub-root sits in front of the ear's back edge (same side), plus
    # peri-lobe shorts (<= 40 mm strands from roots in the ear |x|
    # band within the ear y-span, in front of the back edge). Any such
    # strand with a sample below the lobe's lowest point is shortened
    # about its root until its LOWEST sample sits 3 mm above the lobe
    # bottom (tip ends at least 3 mm above; anatomy: sideburns end
    # near the tragus). Per-root 3D length rule decided before
    # rendering, not an image trim. Where the root itself sits
    # at/below that level (below-lobe roots the lobe-drop missed via
    # jitter/|x| edge) no shortening can clear the strand, so those
    # are dropped under the same flag. Vectorised (no O(n^2)).
    cap_info = {"on": bool(args.sideburn_cap_lobe), "nCapped": 0,
                "nDroppedRootBelow": 0, "meanShortenMm": 0.0,
                "maxShortenMm": 0.0, "sides": {}}
    if bool(args.sideburn_cap_lobe):
        _segL = np.linalg.norm(np.diff(children, axis=1), axis=2)
        _arcL = np.concatenate(
            [np.zeros((n_child, 1)), np.cumsum(_segL, axis=1)], axis=1)
        _strandLen = _arcL[:, -1]
        _minZ = children[:, 1:, :][:, :, 2].min(axis=1)
        _tips = children[:, -1, :].copy()
        _keep = np.ones(n_child, dtype=bool)
        _cap_all = []
        for _ssgn, _slb in _lobe.items():
            _side = (cxyz[:, 0] * _ssgn > 0)
            _front = cxyz[:, 1] > _slb["yback"]
            _peri = (_side & _front
                     & (np.abs(cxyz[:, 0]) >= _slb["xmin"] - 0.010)
                     & (np.abs(cxyz[:, 0]) <= _slb["xmax"] + 0.010)
                     & (cxyz[:, 1] <= _slb["yfront"] + 0.010)
                     & (_strandLen <= 0.040))
            _sel = ((_sbchild | _peri) & _side & _front
                    & (_minZ < _slb["zmin"]))
            _rows = np.nonzero(_sel)[0]
            _n_cap = 0
            _n_drop = 0
            if len(_rows):
                _tgt = _slb["zmin"] + 0.003
                _can = cxyz[_rows, 2] > _tgt
                _rc = _rows[_can]
                if len(_rc):
                    _den = _minZ[_rc] - cxyz[_rc, 2]
                    _f = (_tgt - cxyz[_rc, 2]) / np.minimum(_den,
                                                            -1e-12)
                    _do = (_f > 0.0) & (_f < 1.0)
                    _rr2 = _rc[_do]
                    if len(_rr2):
                        _ff = _f[_do][:, None, None]
                        _before = _strandLen[_rr2]
                        children[_rr2] = cxyz[_rr2][:, None, :] + (
                            children[_rr2] - cxyz[_rr2][:, None, :]) \
                            * _ff
                        _after = np.linalg.norm(
                            np.diff(children[_rr2], axis=1),
                            axis=2).sum(axis=1)
                        _n_cap = int(len(_rr2))
                        _cap_all.append((_before - _after) * 1000.0)
                _rb = _rows[~_can]
                if len(_rb):
                    _keep[_rb] = False
                    _n_drop = int(len(_rb))
            cap_info["sides"][str(_ssgn)] = {"capped": _n_cap,
                                             "dropped": _n_drop}
        cap_info.update({
            "nCapped": int(sum(v["capped"]
                               for v in cap_info["sides"].values())),
            "nDroppedRootBelow": int(sum(
                v["dropped"] for v in cap_info["sides"].values()))})
        if cap_info["nCapped"]:
            _all = np.concatenate(_cap_all)
            cap_info.update({"meanShortenMm":
                             round(float(_all.mean()), 3),
                             "maxShortenMm":
                             round(float(_all.max()), 3)})
        if cap_info["nDroppedRootBelow"]:
            children = children[_keep]
            parent = parent[_keep]
            cxyz = cxyz[_keep]
            cuv = cuv[_keep]
            cside = cside[_keep]
            gi_c = gi_c[_keep]
            w_c = w_c[_keep]
            child_u = child_u[_keep]
            n_child = int(_keep.sum())

    # groom31: post-cap fixes (both default OFF = no-op). The cap's
    # about-root rescale drags samples toward jittered sub-roots at
    # SDF ~ 0 (inside-body source) and pulls swept y values back toward
    # the root (partly undoing the pre-cap sweep on capped strands).
    cap_reproject_info = {"on": bool(args.cap_reproject), "nPushed": 0,
                          "nInsideAfter": 0}
    if bool(args.cap_reproject) and cap_info.get("nCapped", 0):
        # capped-strand mask: recompute from the cap side records is
        # stale after the drop filter; instead re-project every strand
        # whose samples violate the keep-out (cheap: one sample pass,
        # project only violators). Vectorised, no O(n^2).
        _flatc = children[:, 1:, :].reshape(-1, 3)
        _vc, _ic = sample_keep(_flatc)
        _bad = _ic & (_vc < SDF_MARGIN_MM)
        if _bad.any():
            _rows = np.unique(np.nonzero(_bad.reshape(n_child, P - 1))[0])
            _f = children[_rows][:, 1:, :].reshape(-1, 3)
            _f, _rp = project_outside(_f, sample_keep,
                                      margin_mm=SDF_MARGIN_MM, iters=20,
                                      over_mm=0.0)
            children[_rows, 1:, :] = _f.reshape(len(_rows), P - 1, 3)
            cap_reproject_info["nPushed"] = int(_rp["nPushed"])
            cap_reproject_info["nInsideAfter"] = int(
                _rp["nInsideAfter"])
    lobe_postsweep_info = {"on": bool(args.lobe_sweep_postcap),
                           "nSamples": 0, "nStrands": 0,
                           "maxPushMm": 0.0}
    if bool(args.lobe_sweep_postcap):
        _post = _run_lobe_sweep("post")
        lobe_postsweep_info.update(_post)

    # Radii taper.
    t = np.arange(P) / (P - 1)
    prof = r_root_m + (r_tip_m - r_root_m) * (t ** 1.5)
    radii = np.repeat(prof[None, :], n_child, axis=0).astype(np.float32)
    # groom26 child-side temple tip taper (default OFF = no change).
    _taper_f = float(args.temple_taper)
    taper_info = {"on": bool(_taper_f > 0.0), "factor": _taper_f,
                  "nStrands": 0}
    assert _taper_f == 0.0 or 0.0 < _taper_f < 1.0, _taper_f
    if _taper_f > 0.0:
        _taper_mask = _temple[parent]
        taper_info["nStrands"] = int(_taper_mask.sum())
        if _taper_mask.any():
            _tprof = (1.0 - _taper_f * (t ** 2.0)).astype(np.float32)
            radii[_taper_mask] *= _tprof[None, :]

    # Part MICRO-STRIP: roots exactly on the line keep no cover
    # above arc 55 mm (the part line itself); their lower halves
    # (and all swept neighbours) re-cover the midline below, so no
    # slot propagates down the back (the v1 29 px seam defect).
    _segS = np.linalg.norm(np.diff(children, axis=1), axis=2)
    _arcS = np.concatenate(
        [np.zeros((n_child, 1)), np.cumsum(_segS, axis=1)], axis=1)
    _stripchild = _striproot[parent][:, None] & (_arcS < 0.050)
    _stripchild[:, 0] = False
    strip_info = {"stripMm": 0.75, "stripArcMm": 50.0,
                  "lineTrim": False,
                  "nRoots": int(_striproot.sum()),
                  "nStrands": int(_striproot[parent].sum()),
                  "nSamples": int(_stripchild.sum())}
    if _stripchild.any():
        radii[_stripchild] = 2e-9

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
        parent=parent.astype(np.int32),
        rerouted=_rerouted.astype(np.uint8))
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
        **({"partJitter": part_jitter_rec} if part_jitter_rec else {}),
        **({"flowBias": flowbias_info} if flowbias_info else {}),
        "vertex": {"yVertexM": Y_VERTEX_M,
                   "nBelowVertexRoots": int(below_v.sum())},
        "model": "interpolated children on dense guides (no transport)",
        "blend": blend_info,
        "regionWeight": region_info,
        "uvCutoffRad": float(args.uv_cutoff),
        "poolDrop": pool_drop_info,
        "childU": u_info,
        "depthServo": servo_info,
        "earKeepout": ear_info,
        "partStyle": {"on": 0, "note": "removed in 8b"},
        "partExtra": {"extraPerPartRoot": 0, "note": "removed in 8b"},
        "partSetback": {"on": 0, "note": "removed in 8b"},
        "partSweep": sweep_info,
        "partStrip": strip_info,
        "farSnap": snap_info,
        "partClamp": partclamp_info,
        "tuckBlend": {"on": int(_tuck_on),
                      "nTuckRoots": int(_tuckroot.sum()),
                      "nTuckGuides": int((tuck_g > 0.5).sum())},
        "earBandRouted": dict(band_info,
                              nBandChildren=int(_bandroot[parent].sum())
                              if _band_on else 0),
        "shellRoutedOnly": shell_routed_info,
        "conchaTrim": trim_info,
        "dotGuides": dot_info,
        "subRoots": sub_info,
        "sideburnShort": sbshort_info,
        "sideburnClamp": sbclamp_info,
        "sideburnHug": sbhug_info,
        "templeRoots": temple_info,
        "templeHug": templehug_info,
        "templeTaper": taper_info,
        "backfill": _bf_info,
        "lobeDropRoots": lobe_drop_info,
        "lobeTuck": lobe_tuck_info,
        "lobeSweep": lobe_sweep_info,
        "sideburnCapLobe": cap_info,
        "shirtKeepout": shirt_info,
        "capReproject": cap_reproject_info,
        "lobePostSweep": lobe_postsweep_info,
        "rootDots": rootdot_info,
        "lobeTrim": lobetrim_info,
        "clump": {"coarseMm": COARSE_MM,
                  "coarsePullTip": float(args.coarse_pull),
                  "coarseCells": coarse, "fineMm": FINE_MM,
                  "finePullTip": float(args.fine_pull),
                  "fineCells": fine,
                  "pow": _cpow},
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
                      "shellRoutedOnly": shell_routed_info,
                      "childUP50": u_info["p50"],
                      "projection": proj,
                      "earKeepout": ear_info,
                      "strip": strip_info,
                      "trim": trim_info}, indent=1))


if __name__ == "__main__":
    main()

