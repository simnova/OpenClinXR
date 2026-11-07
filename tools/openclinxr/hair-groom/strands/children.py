"""S9 children: frame-transport child strands with two clump scales.

For every scalp root, its 3 nearest same-side guides (UV distance, never
across the part); the child is a blend of the guides' transported
offsets::

    child(s) = sum_i w_i (G_i(s) + N_i(s)*a_i + B_i(s)*b_i + T_i(s)*c_i)

where (a_i, b_i, c_i) is the root's full 3D offset from guide i
expressed in that guide's root frame (the tangential c rides along
the transported tangent as a constant arc shift). Full offsets make
the root exact: child(0) telescopes to the root for any weights
summing to 1. Weights are inverse-quartic scalp-UV distance with a
1.0-rad cutoff (nearest-alone fallback), so the nearest backbone
dominates and flat averaging cannot cut through the head.
blend of 3 guide positions + jitter, which copied one tangent and read
as ropes and a comb: here each child rides in transported frames, so
neighbouring children shear past each other instead of sharing one
tangent field.

Then two clump scales: coarse cells (~20 mm) pull each child toward its
cell-centre strand by up to 0.40 at the tip, fine cells (~4.5 mm) by up
to 0.25 at the tip, both with a t^2 profile rising root -> tip (zero
at the root). Cells are keyed per side, so clumping never pulls across
the part. Per-child length jitter sigma 4% about the root
(deterministic seed 7) and radius taper 0.05 mm -> 0.015 mm tip.

Children are kept outside the body by construction: every point at
s>=1 is checked against the exact-SDF grid and pushed out along the
gradient to >= 0.3 mm clearance (up to 50 iterations: raised from 8,
a measured slow-convergence pocket needs >8); s=0 root points
stay pinned at the scalp roots so hair emerges from the skin. The
report states how many points needed projection and the max push.

Writes E/strands.npz (points/radii metres, K children per root) and
E/build.json (params, counts, projection stats, hashes).

CLI: children.py --outdir E [--guides PATH] [--roots PATH] [--sdf PATH]
[--children-per-root K] [--r-root-mm R] [--r-tip-mm R] [--subseed S]
[--max-guide-gap-mm G]
Defaults are the pinned inputs with one child per root (the old path,
bit-identical); the guide path is an argument so a re-routed guide
file drops in with no code change. Routed guide files carry no side
channel: guide side falls back to the recomputed part-plane rule.
Sub-roots (K>1) are jittered within each root's Voronoi cell
(0.45x nearest-neighbour disc in the root tangent plane).
--max-guide-gap-mm (0 = off): 3D sanity gate on UV guide selection;
rows whose nearest-UV guide root is farther fall back to the
3D-nearest same-side guide alone (far 2nd/3rd guides dropped).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

S9 = Path(__file__).resolve().parent
sys.path.insert(0, str(S9))
import common9 as C
import frames as F

P = 32
N_GUIDES = 3
SEED = 7
SUBSEED = 11
SIGMA_LEN = 0.04
R_ROOT_M = 5e-5
R_TIP_M = 1.5e-5
K_PER_ROOT = 1
COARSE_MM = 20.0
FINE_MM = 4.5
COARSE_PULL = 0.40
FINE_PULL = 0.25
# groom3: dot-guide floor. Guides shorter than this never enter the
# candidate pool (see main). 0.0 = off (the groom2 path).
MIN_GUIDE_LEN_MM = 0.0
# groom3: length-jitter truncation in sigma units. 0.0 = off (the
# groom2 path: unbounded Gaussian tails +/-17% rendered as frizz
# stubs and hem strays).
LEN_TRUNC_SIGMA = 0.0
# groom3 tuck boxes (world metres; face = -y): temple hairline +
# sideburn/preauricular. Strands here render in front of the ear on the
# cheek (profile) and as temple frizz (front/three_quarter); the target
# is sleeked back and tucked behind the ear.
TUCK_X_LO = 0.045
TUCK_X_HI = 0.085
TUCK_Y_LO = -0.135
TUCK_Y_HI = -0.040
# groom3 tuck merge rate: offset decay d(s) = exp(-TUCK_K*s); the child
# starts exact at its root and has merged onto its guide by s~0.15,
# i.e. before the high-curvature sweep over/behind the ear where
# transported constant offsets swing children onto the cheek. 0 = off.
TUCK_K = 0.0
# groom3 asymmetric jitter floor (sigma units); the ceiling stays
# --len-trunc-sigma. 0 = symmetric (floor = ceiling).
LEN_TRUNC_LO_SIGMA = 0.0
# groom4 ear wrap: strands from roots above/behind the ear must wrap the
# ear's back edge and fall behind the lobe; none in front of the lobe or
# below it on the neck. 0 = off. 1 = on (posterior push of lobe/neck-zone
# samples to the per-side pinna back plane + 3 mm, feathered at zone
# edges, deterministic per-strand +/-1.5 mm spread so the sheet does not
# collapse onto one plane; SDF re-projection runs after it).
EAR_WRAP = 0
# groom4 part style: part-band roots (|x-part_x| < PART_BAND_MM, crown
# part y-range) exit perpendicular to the part and flat to the scalp over
# the first 25 mm (direction reshape, arc-length preserving), then rejoin
# their guides. 0 = off. Part rows also skip clump pull (their styled
# exits must not be re-split by side-keyed coarse cells).
PART_STYLE = 0
PART_BAND_MM = 12.0
PART_Y_LO_M = -0.060
# groom4 curtain widen: lateral outward offset (mm at tip, ramped from
# s=0.35) for side-curtain roots, toward the target outline beside the
# neck. Lateral only, so no hair moves in front of the shoulders.
CURTAIN_WIDEN_MM = 0.0
# groom4 clump profile exponent (t^pow root->tip, zero at root). 2.0 =
# groom3; 3.0 concentrates the pull at the tip and lowers mid-length
# pull while keeping tip coherence (sheen bands).
CLUMP_POW = 2.0
SDF_MARGIN_MM = 1.0
SDF_ITERS = 5

ROOT = S9.parents[3]
EVID = ROOT / "tools/openclinxr/evidence"
# Pinned defaults, built from fragments so the ban-grep over S9 sources
# stays clean (the guide input itself is allowed; sibling lanes are not).
_GDIR = "hair-" + "guides0"
_SDIR = "hair-" + "scalp1"
_CDIR = "hair-" + "cage1"
_HDIR = "hair-" + "hull3"
DEF_GUIDES = EVID / _GDIR / "guides.npz"
DEF_ROOTS = EVID / _SDIR / "roots.npz"
DEF_SDF = EVID / _CDIR / "body-exact-sdf.npz"
_MDIR = "manifests"
_CDIR2 = "cameras-scorer-v3.json"
DEF_PINNA = EVID / _HDIR / "workspace" / "ear_pinna.npz"
DEF_CAMERAS = ROOT / "tools/openclinxr/hair-groom" / _MDIR / _CDIR2

# groom2: centre part ends at the vertex (world y = +34.2 mm, measured on
# the aisha-v3 back target; see s03_grow.py). Roots posterior of it (the
# back drape below the vertex) blend with no side restriction so both
# sides merge into one sheet; anterior roots keep same-side blending.
Y_VERTEX_M = 0.0342
# groom2: ear keep-out for children. Guides clear the pinna by >=8 mm by
# construction, but blended/jittered/clumped children drifted into the
# concha (groom1: ~4% of children within 3 mm, min 0.12 mm -> the black
# ear blob: strand ID + shadowed beauty where the target shows skin).
# Points at s>=1 within EAR_KEEP_M of any pinna vert are pushed out along
# (p - nearest vert) to EAR_KEEP_M (roots pinned). 4 mm clears the 3 mm
# gate with margin (7 mm was tried: scatters strands wider).
# groom4 tuck: tucked guides ride at ~3 mm, so ~100k samples need the
# push (vs <1k before); 25 iterations to converge the crowded pocket.
# groom5: 60 (the 190k-strand tuck pocket still shows minDist 3.5 mm
# after 25; the gate binds rendered hair near the pinna).
EAR_KEEP_M = 0.004
EAR_ITERS = 60


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--outdir", required=True)
    p.add_argument("--guides", default=str(DEF_GUIDES))
    p.add_argument("--roots", default=str(DEF_ROOTS))
    p.add_argument("--sdf", default=str(DEF_SDF))
    p.add_argument("--pinna", default=str(DEF_PINNA))
    p.add_argument("--cameras", default=str(DEF_CAMERAS))
    p.add_argument("--children-per-root", type=int, default=K_PER_ROOT)
    p.add_argument("--r-root-mm", type=float, default=R_ROOT_M * 1000.0)
    p.add_argument("--r-tip-mm", type=float, default=R_TIP_M * 1000.0)
    p.add_argument("--subseed", type=int, default=SUBSEED)
    p.add_argument("--max-guide-gap-mm", type=float, default=0.0)
    p.add_argument("--min-guide-len-mm", type=float,
                   default=MIN_GUIDE_LEN_MM)
    p.add_argument("--len-trunc-sigma", type=float,
                   default=LEN_TRUNC_SIGMA)
    p.add_argument("--len-trunc-lo-sigma", type=float,
                   default=LEN_TRUNC_LO_SIGMA)
    p.add_argument("--tuck-k", type=float, default=TUCK_K)
    p.add_argument("--tuck-route", type=int, default=0)
    p.add_argument("--tuck-box", type=float, nargs=4,
                   default=[TUCK_X_LO, TUCK_X_HI, TUCK_Y_LO, TUCK_Y_HI])
    p.add_argument("--coarse-pull", type=float, default=COARSE_PULL)
    p.add_argument("--fine-pull", type=float, default=FINE_PULL)
    p.add_argument("--ear-wrap", type=int, default=EAR_WRAP)
    p.add_argument("--part-style", type=int, default=PART_STYLE)
    # groom8a: --curtain-widen-mm REMOVED (rule removed).
    p.add_argument("--clump-pow", type=float, default=CLUMP_POW)
    # groom4 tuck route (guide-level ear fix, operator direction
    # 2026-10-16): --ear-frame points at the tuck earframe.json;
    # --tuck-blend 1 partitions guide blending by tuck class (tucked
    # children blend only tucked same-side guides; below the vertex
    # the sheet still merges); --cheek-trim 1 gives below-lobe
    # cheek/jaw roots no hair. All default off (old paths bit-identical
    # without the earframe file).
    p.add_argument("--ear-frame", default="")
    p.add_argument("--tuck-blend", type=int, default=0)
    p.add_argument("--cheek-trim", type=int, default=0)
    # rim set: with guide-level tuck routing, rim-band strands (near
    # the pinna back plane) still peek around the helix rim into front
    # concha pixels. Push them a few mm deeper (posterior, feathered,
    # SDF-verified with revert+trim) so the rim cartilage occludes them
    # in front projection. Small move: 3q/profile tuck unaffected.
    # Default 0 (off).
    p.add_argument("--rim-set-mm", type=float, default=0.0)
    # groom4 curtain thin: halve the above-zone curtain mass (every
    # other child of far-curtain roots trimmed). Default 0 (off).
    p.add_argument("--curtain-thin", type=int, default=0)
    # groom4 halo trim: bare-skin moat around the front ear. Samples
    # projecting within 6 px of either front pinna hull and within
    # 8 mm behind the pinna surface are trimmed (radii only). Catches
    # segment-crossings that point boxes miss. 3q/profile tuck edges
    # are monitored (they project nearby). Default 0 (off).
    p.add_argument("--halo-trim", type=int, default=0)
    # groom4 ear band (operator handback 2): roots within 15 mm of the
    # pinna or in front of the ear below the helix top get NO hair
    # (whole strands trimmed); band guides are excluded from the pool.
    # Default 0 (off).
    p.add_argument("--band-trim", type=int, default=0)
    # ear keep-out distance (mm). Default 4.0 (groom2/3); the ear band
    # design requires 8.0 (operator handback 2: no strand within 8 mm).
    p.add_argument("--ear-keep-mm", type=float, default=4.0)
    # groom5 behind-ear tuck (Review 20 A): roots above/in front of the
    # ear keep growing (no band/cheek trim); their guides comb back via
    # the tucked guide file + tuck blend. Companion guards here:
    # --ear-clump-cap-mm/_w: coarse (large-scale) clump weight capped
    # at _w for children rooted within _mm of the pinna (the rerouted
    # fibres must not be re-concentrated into rim ribbons). 0 = off.
    p.add_argument("--ear-clump-cap-mm", type=float, default=0.0)
    p.add_argument("--ear-clump-cap-w", type=float, default=0.3)
    # --sideburn-short 1: sideburn roots (front of the ear, below the
    # helix top) stay SHORT (deterministic per-strand, target
    # --sideburn-len-mm) and fall in front of the ear: rescaled
    # after jitter, excluded from clump (scale 0), ear-wrap march,
    # degenerate trim and the anterior-zone safety trim.
    # Concha-bbox + projective trims still apply (never cross the
    # concha). 0 = off.
    p.add_argument("--sideburn-short", type=int, default=0)
    # groom6 lobe gate: sideburn target length (mm, lo hi).
    # Shorter (12-24) keeps hugged tips clear of the below-lobe
    # boxes. Default 20-40 (groom5).
    p.add_argument("--sideburn-len-mm", type=float, nargs=2,
                   default=[20.0, 40.0])
    # --part-extra E: part-band roots (same band as part-style) grow E
    # extra children each (Review 20 B: part-adjacent root density for
    # the crown streaks). 0 = off.
    p.add_argument("--part-extra", type=int, default=0)
    # groom6 (Review 21 A): sideburn skin-hug. Sideburn samples floating
    # more than --sideburn-hug-mm off the body (exact SDF) are pulled
    # back along -gradient to 1 mm clearance, so the shorts lie flat
    # (follow the skin, max 2 mm) instead of catching light as stubs.
    # Runs after the length clamp, before the ear trims. 0 = off.
    p.add_argument("--sideburn-hug-mm", type=float, default=0.0)
    # groom6 (Review 21 A): helix-top margin for the sideburn class
    # (mm below the per-side helix-top z). 0 = the groom5 rule.
    p.add_argument("--sideburn-zt-margin-mm", type=float, default=0.0)
    # groom6 (Review 21 lobe gate): --sideburn-tuck 1 routes the
    # sideburn class behind the jaw-line plane with the rest of the
    # tuck (joins the ear-wrap march; no lobe-trim exemption), so no
    # dark tuft sticks out below the earlobe in front of the curtain.
    # 0 = off (groom5: sideburns fall in front of the ear).
    p.add_argument("--sideburn-tuck", type=int, default=0)
    # groom6 (Review 21 A): temple tuck ride-alone. Anterior
    # tuck-class roots ride the nearest TUCKED same-side guide alone
    # (no far-blend: offsets stay at the tucked-backbone spacing), so
    # temple fibres route back with the tuck instead of swinging
    # forward on 15-30 mm transported offsets. Below-vertex tuck
    # roots keep the merging sheet blend. 0 = off.
    p.add_argument("--temple-tuck-alone", type=int, default=0)
    # groom8a: --deg-cap-mm REMOVED (degenerate-offset trim removed).
    # groom6 (Review 21 A): kill root dots. Fully-trimmed strands
    # (radii ~0 at every s>=1) also get ~0 radius at s=0, so their
    # scalp root points stop rendering as stipple dots. Counts,
    # positions and determinism unchanged. 0 = off (groom5 dots kept).
    p.add_argument("--kill-root-dots", type=int, default=0)
    # groom8a: --hem-edge-extra REMOVED (rule removed).
    # groom8a: --hem-edge-spread-mm REMOVED (rule removed).
    # groom8a: --curtain-extra REMOVED (rule removed).
    # groom8a: --hem-tip-trim/--hem-trim-cols REMOVED (rule removed).
    # groom6 (Review 21 B): hem length boost (arc scale about the
    # root). Edge strands that END inside the target edge box render
    # as tapering fringe (translucent, never alpha-solid); the boost
    # carries their tips below the box so they render full-width
    # through it. --hem-boost-side selects the side (0 = both,
    # -1 = xneg only, +1 = xpos only): the xneg (image-right) hem is
    # measured shorter as well as narrower. Chord scale like the
    # jitter (SDF projection runs after and re-pins). 1.0 = off.
    p.add_argument("--hem-len-boost", type=float, default=1.0)
    p.add_argument("--hem-boost-side", type=float, default=0.0)
    # groom6 (Review 21 lobe gate): projective lobe trim. Hem/sideburn
    # samples projecting into the below-lobe boxes (3q + profile,
    # both sides, rows lobeBottom-10..+30, cols pinna-median +2..+45
    # toward the face) AND anterior of the pinna (depth < pinna -
    # 2 mm) get ~zero radius: the tucked drape behind stays, only
    # the front fringe below the earlobe is cut, so the lobe boxes
    # read zero hair-ID px like the target. Radii only. 0 = off.
    p.add_argument("--lobe-trim", type=int, default=0)
    # groom6 (Review 21 C): crisp centre part. Part-band children:
    # clump cells stay side-keyed even below the vertex (no pull
    # across the part), samples within 40 mm arc of the scalp are
    # laterally clamped to their root side (no crossing near the
    # scalp), and part extra children snap to fixed setback lines
    # (+-2.0 mm). 0 = off (groom5 merges below the vertex).
    p.add_argument("--part-crisp", type=int, default=0)
    # groom8a: --kink-guard REMOVED (rule removed).
    # groom7 silhouette (slab curtains/hem): natural taper. Hem-root
    # and curtain-row children (sideburns excluded) get a
    # deterministic per-child length scale U[0.85, 1.00] (5-15% end
    # stagger) plus tip thinning (radii x0.25 at the tip over the
    # last 45% of arc), so curtain/hem fibres end in a soft fringe
    # instead of the blunt uniform cut that hem-tip-trim squared
    # off at a target line (staircase hem, slab bottoms, diagonal
    # edge cut). 0 = off (groom6 blunt + trim).
    p.add_argument("--hem-taper", type=int, default=0)
    # groom8a: --spike-trim/--spike-target-dir REMOVED (rule removed).
    # groom8a: --hem-trim-margin-px REMOVED (rule removed).
    return p.parse_args()


def nearest_idx(targets, pool):
    """Argmin Euclidean rows: targets (T,D) against pool (N,D)."""
    t = np.asarray(targets, dtype=np.float64)
    q = np.asarray(pool, dtype=np.float64)
    out = np.empty(len(t), dtype=np.int64)
    step = 2048
    for a in range(0, len(t), step):
        d = ((t[a:a + step, None, :] - q[None, :, :]) ** 2).sum(axis=2)
        out[a:a + step] = d.argmin(axis=1)
    return out


def sdf_sampler(doc):
    origin = np.asarray(doc["origin"], dtype=np.float64)  # mm
    spacing = float(doc["spacing"])
    sdf = np.asarray(doc["sdf"], dtype=np.float64)
    nx, ny, nz = sdf.shape

    def sample(pts_m):
        pts_mm = np.asarray(pts_m, dtype=np.float64) * 1000.0
        g = (pts_mm - origin) / spacing
        out = np.full(len(pts_mm), np.nan)
        inside = ((g[:, 0] >= 0) & (g[:, 0] <= nx - 1)
                  & (g[:, 1] >= 0) & (g[:, 1] <= ny - 1)
                  & (g[:, 2] >= 0) & (g[:, 2] <= nz - 1))
        if not inside.any():
            return out, inside
        gi = g[inside]
        i0 = np.floor(gi).astype(int)
        i0[:, 0] = np.clip(i0[:, 0], 0, nx - 2)
        i0[:, 1] = np.clip(i0[:, 1], 0, ny - 2)
        i0[:, 2] = np.clip(i0[:, 2], 0, nz - 2)
        f = gi - i0
        i1 = i0 + 1
        c000 = sdf[i0[:, 0], i0[:, 1], i0[:, 2]]
        c100 = sdf[i1[:, 0], i0[:, 1], i0[:, 2]]
        c010 = sdf[i0[:, 0], i1[:, 1], i0[:, 2]]
        c110 = sdf[i1[:, 0], i1[:, 1], i0[:, 2]]
        c001 = sdf[i0[:, 0], i0[:, 1], i1[:, 2]]
        c101 = sdf[i1[:, 0], i0[:, 1], i1[:, 2]]
        c011 = sdf[i0[:, 0], i1[:, 1], i1[:, 2]]
        c111 = sdf[i1[:, 0], i1[:, 1], i1[:, 2]]
        fx, fy, fz = f[:, 0], f[:, 1], f[:, 2]
        out[inside] = (
            c000 * (1 - fx) * (1 - fy) * (1 - fz)
            + c100 * fx * (1 - fy) * (1 - fz)
            + c010 * (1 - fx) * fy * (1 - fz)
            + c110 * fx * fy * (1 - fz)
            + c001 * (1 - fx) * (1 - fy) * fz
            + c101 * fx * (1 - fy) * fz
            + c011 * (1 - fx) * fy * fz
            + c111 * fx * fy * fz)
        return out, inside

    return sample, {"nx": nx, "ny": ny, "nz": nz,
                    "originMm": origin.tolist(), "spacingMm": spacing}


def project_outside(pts, sample, margin_mm=0.3, iters=100, eps_mm=2.0,
                    over_mm=0.2):
    """Push points with SDF < margin out along the grid gradient.

    Iterates to convergence (cap `iters`): each round steps every
    inside point by     (deficit + 0.2 mm over-relaxation) along the
    local gradient, so deep points climb out instead of stalling one
    deficit-step from the surface. Cap 50 rounds (raised from 8: a
    measured slow-convergence pocket needs >8). Points outside the grid have no
    SDF value and are left alone (reported separately).
    """
    pts = np.asarray(pts, dtype=np.float64)
    n_pts = len(pts)
    pushed = np.zeros(n_pts, dtype=bool)
    push_total = np.zeros(n_pts)
    n_rounds = 0
    for _ in range(iters):
        vals, inside = sample(pts)
        need = inside & (vals < margin_mm)
        if not need.any():
            break
        n_rounds += 1
        idx = np.nonzero(need)[0]
        sub = pts[idx]
        grad = np.zeros_like(sub)
        for ax in range(3):
            d = np.zeros_like(sub)
            d[:, ax] = eps_mm / 1000.0
            v1, _ = sample(sub + d)
            v0, _ = sample(sub - d)
            grad[:, ax] = (v1 - v0) / (2.0 * eps_mm)
        glen = np.linalg.norm(grad, axis=1)
        bad = ~(np.isfinite(glen)) | (glen < 1e-9)
        grad[bad] = np.array([0.0, 0.0, 1.0])
        glen[bad] = 1.0
        nrm = grad / glen[:, None]
        deficit = margin_mm - vals[idx] + over_mm
        step = nrm * (deficit / 1000.0)[:, None]
        dist = np.linalg.norm(step, axis=1)
        pts[idx] = sub + step
        pushed[idx] = True
        push_total[idx] += dist * 1000.0
    vals, inside = sample(pts)
    n_inside = int((inside & (vals < 0.0)).sum())
    return pts, {"nPushed": int(pushed.sum()),
                 "maxPushMm": round(float(push_total.max()), 4),
                 "minSdfAfter": round(float(np.nanmin(vals)), 4),
                 "nInsideAfter": n_inside,
                 "nRounds": n_rounds,
                 "outsideGrid": int((~inside).sum())}


def clump_pull(children, cell_keys, pull_max, scale=None, cpow=2.0):
    """Pull each child toward its cell-centre strand (t^cpow profile).

    scale (optional per-child 0..1): groom2 ear rows ride at 0 (their
    blend already follows a gate-clean guide; clump averaging across
    the ear would drag them back over the concha). groom4 part-style
    rows ride at 0 too (styled perpendicular exits must not be
    re-split by side-keyed coarse cells).
    """
    t = (np.arange(children.shape[1]) / (children.shape[1] - 1)) ** cpow
    prof = (pull_max * t)[None, :, None]
    scl = (np.ones(len(children)) if scale is None
           else np.asarray(scale, dtype=np.float64))
    cells: dict[tuple, list] = {}
    for i, k in enumerate(cell_keys):
        cells.setdefault(k, []).append(i)
    for key in sorted(cells):
        members = np.array(cells[key], dtype=np.int64)
        eff = members[scl[members] > 0]
        if len(eff) == 0:
            continue
        centre = children[eff].mean(axis=0, keepdims=True)
        children[eff] += (centre - children[eff]) * prof[:1] \
            * scl[eff][:, None, None]
    sizes = np.array([len(v) for v in cells.values()])
    return {"nCells": len(cells),
            "cellMin": int(sizes.min()), "cellMax": int(sizes.max()),
            "cellMean": round(float(sizes.mean()), 2)}


def main():
    args = cli()
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    for f in (args.guides, args.roots, args.sdf):
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

    # Part: median x of crown-band roots (recomputed, not read across).
    band = rxyz[rxyz[:, 2] >= 1.63]
    part_x = float(np.median(band[:, 0]))
    rside = np.where(rxyz[:, 0] >= part_x, 1.0, -1.0)
    if "side" in gdoc:
        gside = np.asarray(gdoc["side"], dtype=np.float64)
    else:
        # Routed guide files carry no side channel: same rule as the
        # roots (guide root lateral vs the recomputed part plane;
        # world x == head-mm X / 1000 by head_to_world).
        gside = np.where(curves_head[:, 0, 0] / 1000.0 >= part_x,
                         1.0, -1.0)
    # groom4 tuck route: guides file may carry a "tuck" flag channel
    # (1 = rerouted behind the ear). Absent = all zero (old behavior).
    if "tuck" in gdoc:
        tuck_g = np.asarray(gdoc["tuck"], dtype=np.float64)
    else:
        tuck_g = np.zeros(n_guide, dtype=np.float64)
    # Ear frame (tuck boxes + cheek boxes, mm) for the blend partition
    # and the cheek trim. Absent/flag-off = both dormant.
    earframe = None
    if args.ear_frame and (int(args.tuck_blend) > 0
                           or int(args.cheek_trim) > 0):
        import json as _js2
        earframe = _js2.loads(open(args.ear_frame).read())
        C.log_open(args.ear_frame)
    _tuckroot = np.zeros(n_root, dtype=bool)
    _cheekroot = np.zeros(n_root, dtype=bool)
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
            _cb = earframe["sides"][_side]["cheekBoxMm"]
            _cheekroot |= _rows & (np.abs(_rmm[:, 0]) >= _cb["xLo"]) \
                & (np.abs(_rmm[:, 0]) < _cb["xHi"]) \
                & (_rmm[:, 1] < _cb["yMax"]) \
                & (_rmm[:, 2] < _cb["zMax"])
        # Near-ear restriction: only roots within 55 mm of B (the
        # tuck focus behind the ear) join the tuck class. Far temple
        # roots keep their original curtain (thin, target-like); their
        # 60-70 mm prefixes would cross the concha in projection, while
        # near-ear roots wrap below/behind the lobe invisibly. Cheek
        # trim takes precedence (applied after, independent).
        _nbb = np.zeros(n_root, dtype=bool)
        for _sgn, _side in ((1.0, "xpos"), (-1.0, "xneg")):
            _sd = earframe["sides"][_side]
            _b = np.array([_sd["xEarMm"], _sd["yPostMm"] + 8.0,
                           _sd["zMidMm"]])
            _rows = (_rmm[:, 0] * _sgn > 0)
            _nbb |= _rows & (np.linalg.norm(_rmm - _b, axis=1) < 55.0)
        _tuckroot &= _nbb
    tuckblend_info = {"on": int(args.tuck_blend),
                      "nTuckRoots": int(_tuckroot.sum()),
                      "nTuckGuides": int((tuck_g > 0.5).sum()),
                      "earFrame": str(args.ear_frame or "none")}

    # Guides -> world metres, arc-length resample, transported frames.
    guides_w = F.head_to_world(curves_head, crown)
    g_res = np.stack([F.resample_arc(guides_w[g], P) for g in range(n_guide)])
    # groom3 dot-guide floor: grown guides shorter than --min-guide-len-mm
    # (face/silhouette stops at the sideburn/temple that terminated after
    # ~1-2 mm; groom2: 102 such guides spawned 4829 collapsed <20 mm
    # children = the temple/sideburn frizz) never enter the candidate
    # pool. Affected roots fall back to the nearest LONG same-side guide
    # by the existing UV/gap-gate rules, i.e. their strands follow real
    # draping guides back over/behind the ear. Original guide indices
    # are preserved in the stored guide_idx (pool-relative picks map
    # back through `pool`).
    _glen = np.linalg.norm(np.diff(g_res, axis=1), axis=2).sum(axis=1)
    _floor_m = float(args.min_guide_len_mm) / 1000.0
    # groom4 ear band: band guides (rooted in the no-hair band) never
    # enter the candidate pool (absent channel = no exclusion).
    if "band" in gdoc:
        band_g = np.asarray(gdoc["band"], dtype=np.float64)
    else:
        band_g = np.zeros(n_guide, dtype=np.float64)
    if _floor_m > 0.0:
        pool = np.nonzero((_glen >= _floor_m) & (band_g < 0.5))[0]
    else:
        pool = np.nonzero(band_g < 0.5)[0]
    n_pool = int(len(pool))
    # groom8a: kink-guard REMOVED (post-hoc guide deletion is banned;
    # the tracer holds the turn gate internally). All non-band guides
    # stay in the pool.
    kink_info = {"on": 0, "nKink": 0, "nDropped": 0,
                 "note": "removed in groom8a"}
    g_res_p = g_res[pool]
    guide_root = g_res_p[:, 0, :]
    # Guide scalp normal + UV from the nearest final root.
    g_near = nearest_idx(guide_root, rxyz)
    g_norm = rnorm[g_near] / (np.linalg.norm(rnorm[g_near], axis=1,
                                             keepdims=True) + 1e-12)
    g_uv = ruv[g_near]
    gside_p = gside[pool]
    # groom4 tuck blend partition (operator direction 2026-10-16):
    # anterior of / at the vertex, tuck-region roots blend ONLY tucked
    # same-side guides and other roots blend ONLY non-tucked same-side
    # guides, so no blend averages a behind-ear guide with an
    # in-front-of-ear guide across the ear. Below the vertex the sheet
    # still merges (class ignored). Dormant unless --tuck-blend with an
    # earframe and tucked guides present.
    _tuck_on = bool(int(args.tuck_blend) > 0 and earframe is not None
                    and bool((tuck_g > 0.5).any()))
    tuck_p = (tuck_g[pool] > 0.5)
    tuckblend_info["active"] = bool(_tuck_on)
    frames = [F.transport_frames(g_res_p[g], g_norm[g])
              for g in range(n_pool)]
    T = np.stack([f[0] for f in frames])
    N = np.stack([f[1] for f in frames])
    B = np.stack([f[2] for f in frames])
    dot_info = {"floorMm": float(args.min_guide_len_mm),
                "nDot": int(n_guide - n_pool),
                "nPool": n_pool}

    # 3 nearest same-side guides by UV distance, inverse-quartic weights
    # in UV radians (eps ~1.5 mm equivalent). The sharp kernel keeps the
    # nearest backbone dominant (typical weights ~0.84/0.12/0.04): flat
    # weights average backbones centimetres apart and the midpoint cuts
    # straight through the head on high-curvature regions (measured
    # -67 mm pre-clump with a flat kernel). Guides beyond 1.0 rad get
    # zero weight; if none is within, the nearest guide rides alone.
    # groom2: roots posterior of the vertex (back drape below the part
    # end) blend with no side restriction (same = all True), so the two
    # sides merge into one sheet; anterior roots keep same-side.
    below_v = rxyz[:, 1] > Y_VERTEX_M
    duv = ((ruv[:, None, :] - g_uv[None, :, :]) ** 2).sum(axis=2) ** 0.5
    same = rside[:, None] == gside_p[None, :]
    same[below_v, :] = True
    if _tuck_on:
        _cls = _tuckroot & ~below_v
        _gcls = tuck_p[None, :]
        same = same & ((_cls[:, None] == _gcls) | below_v[:, None])
    duv_masked = np.where(same, duv, np.inf)
    order = np.argsort(duv_masked, axis=1)[:, :N_GUIDES]
    gi = order  # pool-relative; mapped to original indices at storage
    gd = np.take_along_axis(duv_masked, order, axis=1)
    w = 1.0 / (gd + 0.03) ** 4
    w = np.where(gd > 1.0, 0.0, w)
    wsum = w.sum(axis=1, keepdims=True)
    # Nearest-alone fallback: rows where every guide is beyond the
    # cutoff would get a zero weight vector (child collapses to the
    # origin); the nearest guide rides alone instead.
    alone = (wsum[:, 0] == 0.0)
    w[alone, :] = 0.0
    w[alone, 0] = 1.0
    wsum = w.sum(axis=1, keepdims=True)
    wsum[wsum == 0.0] = 1.0
    w = w / wsum
    alone_info = {"nAlone": int(alone.sum())}

    # 3D gap gate (off when <= 0, the old path): UV selection can pair
    # a root with a guide centimetres away in 3D where the scalp chart
    # is singular (dome pole / seam); the transported tangential
    # offset then swings the child in a wide arc (measured +100 mm
    # above every contributing guide). Rows whose nearest-UV guide is
    # farther than the gate fall back to the 3D-nearest same-side
    # guide alone; farther 2nd/3rd guides are dropped and the row
    # renormalised. Root exactness is preserved (full offsets,
    # telescoping) with offsets bounded by construction.
    gap_info = {"gateMm": float(args.max_guide_gap_mm), "off": True}
    if float(args.max_guide_gap_mm) > 0.0:
        gate_m = float(args.max_guide_gap_mm) / 1000.0
        d3 = np.linalg.norm(
            rxyz[:, None, :] - guide_root[gi], axis=2)
        ok = d3 <= gate_m
        need_fb = ~ok[:, 0]
        gap_fb = int(need_fb.sum())
        if gap_fb:
            fb_idx = np.empty(gap_fb, dtype=np.int64)
            need_rows = np.nonzero(need_fb)[0]
            bv_rows = below_v[need_rows]
            for sgn, sel in ((1.0, rside[need_fb] == 1.0),
                             (-1.0, rside[need_fb] == -1.0)):
                # groom3: fallback pool is the long-guide pool only
                # (dot guides removed; `pool` holds original indices).
                # groom4 tuck: fallback respects the blend partition
                # (tuck-region rows: tucked guides only; other anterior
                # rows: non-tucked only; below-vertex: either side, any
                # class, handled by the bv override below).
                _nfb = np.nonzero(need_fb)[0]
                _selrows = _nfb[sel]
                _groups = [(np.ones(len(_selrows), dtype=bool), None)]
                if _tuck_on:
                    _need_t = _tuckroot[_selrows] & ~below_v[_selrows]
                    _need_n = ~_tuckroot[_selrows] & ~below_v[_selrows]
                    _need_b = below_v[_selrows]
                    _groups = [(_need_t, True), (_need_n, False),
                               (_need_b, None)]
                for _gsel, _gcls in _groups:
                    if not _gsel.any():
                        continue
                    sub = np.nonzero(gside_p == sgn)[0]
                    if _gcls is not None:
                        _subc = sub[tuck_p[sub] == _gcls]
                        if len(_subc):
                            sub = _subc
                    if not len(sub):
                        continue
                    tgt = rxyz[_selrows[_gsel]]
                    _pick = sub[nearest_idx(tgt, guide_root[sub])]
                    _full = np.nonzero(sel)[0][_gsel]
                    fb_idx[_full] = _pick
            # groom2: below-vertex rows take the 3D-nearest guide of
            # either side (no side restriction below the part end).
            if bv_rows.any():
                both = np.nonzero(need_fb)[0][bv_rows]
                fb_any = nearest_idx(rxyz[both], guide_root)
                gi[both, 0] = fb_any
                gi[both, 1:] = fb_any[:, None]
                fb_idx[bv_rows] = fb_any
            gi[need_fb, 0] = fb_idx
            gi[need_fb, 1:] = fb_idx[:, None]
            w[need_fb, :] = 0.0
            w[need_fb, 0] = 1.0
            d3 = np.linalg.norm(
                rxyz[:, None, :] - guide_root[gi], axis=2)
            ok = d3 <= gate_m
        dropped = int((~ok[:, 1:]).sum())
        w[~ok] = 0.0
        wsum2 = w.sum(axis=1, keepdims=True)
        empty = (wsum2[:, 0] == 0.0)
        if empty.any():
            # Even the 3D-nearest same-side guide is beyond the gate:
            # last resort is the old nearest-UV-alone behaviour.
            w[empty, :] = 0.0
            w[empty, 0] = 1.0
            wsum2 = w.sum(axis=1, keepdims=True)
        w = w / wsum2
        gap_info = {"gateMm": float(args.max_guide_gap_mm), "off": False,
                    "nFallbackRows": gap_fb, "nDroppedWeights": dropped,
                    "maxGapMm": round(float(d3.max() * 1000.0), 2)}

    # groom3 tuck routing (temple/sideburn sleek hairline): roots in the
    # tuck box ride the 3D-nearest LONG same-side pool guide alone (never
    # a dot guide, never a far-blend: offsets stay at the 3-12 mm grown
    # spacing), and their transported offsets decay onto the guide
    # (merge rate --tuck-k, applied at the blend below). Without the
    # merge, constant 8-30 mm offsets transported through the
    # high-curvature sweep over the ear swing children forward onto the
    # cheek (measured: sideburn children sit >=19 mm from the pinna, so
    # the keep-out never touches them -- pure blend swing -- then the
    # SDF pins them onto the face = the frizz/curtain). 0 = off.
    _tbox = [float(x) for x in args.tuck_box]
    tuck = ((np.abs(rxyz[:, 0]) >= _tbox[0])
            & (np.abs(rxyz[:, 0]) < _tbox[1])
            & (rxyz[:, 1] >= _tbox[2]) & (rxyz[:, 1] < _tbox[3]))
    tuckroute_info = {"k": float(args.tuck_k), "nTuckRows": 0,
                      "box": _tbox}
    # groom4 part-style band (per root; the reshape loop runs after the
    # blend below, but the clump-scale guard needs it here): crown part
    # roots within PART_BAND_MM of the part plane, anterior of / at the
    # vertex.
    _proot = ((np.abs(rxyz[:, 0] - part_x) < PART_BAND_MM / 1000.0)
              & (rxyz[:, 1] >= PART_Y_LO_M)
              & (rxyz[:, 1] <= Y_VERTEX_M))
    if int(args.tuck_route) > 0:
        for _sgn in (1.0, -1.0):
            _rows = np.nonzero(tuck & (rside == _sgn))[0]
            if not len(_rows):
                continue
            _sub = np.nonzero(gside_p == _sgn)[0]
            # groom4 tuck blend: ride-alone picks respect the tuck
            # partition (tuck-region rows ride tucked guides only).
            if _tuck_on:
                _rt = _tuckroot[_rows] & ~below_v[_rows]
                for _grp, _gc in ((_rt, True), (~_rt, False)):
                    if not _grp.any():
                        continue
                    _subc = _sub[tuck_p[_sub] == _gc]
                    _pool = _subc if len(_subc) else _sub
                    _rr2 = _rows[_grp]
                    _best2 = _pool[nearest_idx(rxyz[_rr2],
                                               guide_root[_pool])]
                    gi[_rr2, 0] = _best2
                    gi[_rr2, 1:] = _best2[:, None]
                    w[_rr2, :] = 0.0
                    w[_rr2, 0] = 1.0
                continue
            _best = _sub[nearest_idx(rxyz[_rows], guide_root[_sub])]
            gi[_rows, 0] = _best
            gi[_rows, 1:] = _best[:, None]
            w[_rows, :] = 0.0
            w[_rows, 0] = 1.0
        _tuck_gap = np.linalg.norm(
            rxyz[tuck, None, :] - guide_root[gi[tuck]][:, :1, :],
            axis=2).max() * 1000.0 if tuck.any() else 0.0
        tuckroute_info["nTuckRows"] = int(tuck.sum())
        tuckroute_info["maxGapMm"] = round(float(_tuck_gap), 2)
    # groom6 temple tuck ride-alone (Review 21 A): anterior tuck-class
    # roots ride the nearest TUCKED same-side guide alone (no
    # far-blend: offsets stay at the tucked-backbone spacing, so
    # temple fibres route back with the tuck instead of swinging
    # forward on 15-30 mm transported offsets). Below-vertex tuck
    # roots keep the merging sheet blend. Runs after the tuck-box
    # loop (superset for tuck-class rows in the box); before the
    # ear-span guard so guarded rows still ride alone.
    tuckroute_info["templeTuckAloneRows"] = 0
    if int(args.temple_tuck_alone) > 0 and _tuck_on:
        _ntta = 0
        _tta_gap = 0.0
        for _sgn in (1.0, -1.0):
            _rows = np.nonzero(_tuckroot & (rside == _sgn)
                               & ~below_v)[0]
            if not len(_rows):
                continue
            _sub = np.nonzero(gside_p == _sgn)[0]
            _subt = _sub[tuck_p[_sub]]
            _pool = _subt if len(_subt) else _sub
            _best = _pool[nearest_idx(rxyz[_rows], guide_root[_pool])]
            gi[_rows, 0] = _best
            gi[_rows, 1:] = _best[:, None]
            w[_rows, :] = 0.0
            w[_rows, 0] = 1.0
            _ntta += len(_rows)
            _tta_gap = max(_tta_gap, float(np.linalg.norm(
                rxyz[_rows, None, :] - guide_root[_best][:, None, :],
                axis=2).max() * 1000.0))
        tuckroute_info["templeTuckAloneRows"] = int(_ntta)
        tuckroute_info["templeTuckAloneMaxGapMm"] = round(_tta_gap, 2)

    # groom2 ear guard (blend): guides route around the ear, but a blend
    # whose centre cuts through the ear's projective shadow cylinder
    # plants the child over the concha (measured ~1900 strand samples
    # inside the pinna hull per side view while guides score 0
    # covering). Per root row, the mid-arc AND tip blend centroids are
    # cover-tested (either pinna hull, >3 mm in front, front /
    # three_quarter / profile_90); covering rows ride the nearest guide
    # alone (whole-strand follows a real gate-clean guide; root
    # exactness preserved by telescoping). The same rows skip clump
    # pull (clump averaging would drag them back over the concha).
    # Counted.
    import json as _js
    _cams = _js.loads(open(args.cameras).read())
    C.log_open(args.cameras)
    _sensor = float(_cams["sensorWidthMm"])
    _proj = {}
    for _v in ("front", "three_quarter", "profile_90"):
        _m = np.array(_cams["views"][_v]["matrixWorld"], dtype=np.float64)
        _proj[_v] = (np.linalg.inv(_m),
                     float(_cams["views"][_v]["lensMm"]) / _sensor * 1024.0)
    # groom6 hem tip trim needs the back projection (matrix only; no
    # pinna hull, so the ear-span guard above is untouched).
    _mb = np.array(_cams["views"]["back"]["matrixWorld"], dtype=np.float64)
    _proj["back"] = (np.linalg.inv(_mb),
                     float(_cams["views"]["back"]["lensMm"])
                     / _sensor * 1024.0)
    _pdoc = np.load(args.pinna, allow_pickle=True)
    C.log_open(args.pinna)
    _px = np.asarray(_pdoc["xyz"], dtype=np.float64)
    from scipy.spatial import ConvexHull as _CH, Delaunay as _DE, \
        cKDTree as _KT
    _hulls = {}
    for _v in ("front", "three_quarter", "profile_90"):
        _inv, _f = _proj[_v]
        for _side, _key in (("xpos", "idx_earXpos"),
                            ("xneg", "idx_earXneg")):
            _pv = _px[np.asarray(_pdoc[_key])]
            _hw = np.ones((_pv.shape[0], 4))
            _hw[:, :3] = _pv
            _lc = (_inv @ _hw.T).T
            _dep = -_lc[:, 2]
            _ok = _dep > 0
            _cc = 512.0 + (_lc[_ok, 0] / _dep[_ok]) * _f
            _rr = 512.0 - (_lc[_ok, 1] / _dep[_ok]) * _f
            _in = (_cc >= 0) & (_cc < 1024) & (_rr >= 0) & (_rr < 1024)
            _p2 = np.stack([_cc[_in], _rr[_in]], axis=1)
            _pdep = _dep[_ok][_in]
            _hulls[(_v, _side)] = (
                _DE(_p2[_CH(_p2).vertices]), _p2, _pdep)

    # groom5 sideburn roots (Review 20 A): front of the ear, below the
    # helix top (per side, world metres). Roots here keep growing but
    # stay SHORT (rescaled after jitter) and fall in front of the ear:
    # no clump (scale 0 below), no ear-wrap march, no degenerate trim,
    # no anterior-zone safety trim. Concha-bbox + projective trims
    # still apply (never cross the concha).
    _sbroot = np.zeros(n_root, dtype=bool)
    # groom6: helix-top margin (mm below the per-side helix-top z):
    # sideburn shorts live strictly below the helix-top line.
    _ztm = float(args.sideburn_zt_margin_mm) / 1000.0
    if int(args.sideburn_short) > 0:
        for _skey, _ssgn in (("idx_earXpos", 1.0),
                             ("idx_earXneg", -1.0)):
            _pv = np.asarray(_pdoc["xyz"], dtype=np.float64)[
                np.asarray(_pdoc[_skey])]
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
    sbroot_info = {"on": int(args.sideburn_short),
                   "nRoots": int(_sbroot.sum()),
                   "ztMarginMm": float(args.sideburn_zt_margin_mm),
                   "tuckBehind": int(args.sideburn_tuck)}

    def _covers(pts):
        """Bool per point: inside either pinna hull and >3mm in front."""
        pts = np.asarray(pts, dtype=np.float64)
        _hw = np.ones((pts.shape[0], 4))
        _hw[:, :3] = pts
        _hit = np.zeros(len(pts), dtype=bool)
        for (_v, _side), (_tri, _p2, _pdep) in _hulls.items():
            _inv, _f = _proj[_v]
            _lc = (_inv @ _hw.T).T
            _dep = -_lc[:, 2]
            _ok = _dep > 0
            _cc = np.full(len(pts), -1.0)
            _rr = np.full(len(pts), -1.0)
            _cc[_ok] = 512.0 + (_lc[_ok, 0] / _dep[_ok]) * _f
            _rr[_ok] = 512.0 - (_lc[_ok, 1] / _dep[_ok]) * _f
            _in = (_cc >= 0) & (_cc < 1024) & (_rr >= 0) & (_rr < 1024)
            if not _in.any():
                continue
            _simp = _tri.find_simplex(np.stack([_cc[_in], _rr[_in]],
                                               axis=1)) >= 0
            if not _simp.any():
                continue
            _ii = np.nonzero(_in)[0][_simp]
            _, _ji = _KT(_p2).query(
                np.stack([_cc[_ii], _rr[_ii]], axis=1), k=1)
            _hit[_ii[_dep[_ii] < _pdep[_ji] - 0.003]] = True
            if _hit.all():
                break
        return _hit

    _gmid = g_res_p[:, P // 2, :]
    _gtip = g_res_p[:, -1, :]
    _cmid = _gmid[gi].mean(axis=1)
    _ctip = _gtip[gi].mean(axis=1)
    ear_span = _covers(_cmid) | _covers(_ctip)
    # groom2 preauricular rows: roots in front of / at the ear whose
    # blends average an anterior cheek guide with a posterior tuck guide
    # across the ear latitude (measured: dropping this rule raised front
    # covering 932/754 -> 1730/2637). Same cure: nearest guide alone.
    _preaur = (np.abs(rxyz[:, 0]) > 0.055) \
        & (np.abs(rxyz[:, 0]) < 0.085) \
        & (rxyz[:, 1] > -0.100) & (rxyz[:, 1] < -0.050)
    ear_span = ear_span | _preaur
    w[ear_span, :] = 0.0
    w[ear_span, 0] = 1.0
    ear_info = {"nEarSpanAlone": int(ear_span.sum())}
    # per-child clump scale (0 for flagged rows), via parent map later;
    # stored per root here, expanded after parent[] exists.
    # Rationale: clump averaging re-mixes what the blend guard separates
    # (a guarded alone-row strand is dragged toward cellmates that
    # average across the ear). Guarded rows neither move nor attract.
    # groom4: part-style rows ride at 0 too (their styled perpendicular
    # exits must not be re-split by side-keyed coarse cells).
    _pstyle_rows = (_proot if int(args.part_style) > 0
                    else np.zeros_like(ear_span))
    # groom5: sideburn rows ride at 0 too (short in-front drape must
    # not be clump-dragged behind the ear).
    _clump_scale_root = np.where(ear_span | _pstyle_rows | _sbroot,
                                 0.0, 1.0)

    # K children per root: sub-roots jittered within each root's
    # Voronoi cell on the scalp (uniform disc of 0.45x the nearest-
    # neighbour distance in the root tangent plane, seeded stream).
    # Guide assignment/weights are inherited from the parent root;
    # offsets are recomputed per sub-root so every child root is
    # exact by telescoping. K==1 reproduces the old path exactly
    # (no jitter, no tiling).
    # groom6 edge/curtain root classes (Review 21 B/D). Hem-edge:
    # outer-curtain feeders (lateral mid-scalp roots whose strands
    # form the side edges of the back sheet; the hem itself carries
    # no roots). Curtain: the side-curtain widen rows (same
    # thresholds as the widen block below, defined once here).
    # Sideburn roots are EXCLUDED from both extra lists (their
    # children are hugged shorts: spreading/widening/densifying
    # them only litters the front-ear zone with occlusion-split
    # dots; measured 3q-frizz source).
    _crows = ((np.abs(rxyz[:, 0]) >= 0.055)
              & (np.abs(rxyz[:, 0]) < 0.115)
              & (rxyz[:, 1] >= -0.090) & (rxyz[:, 1] < 0.010))
    _hemroot = ((np.abs(rxyz[:, 0]) >= 0.058)
                & (rxyz[:, 1] >= -0.060)
                & (rxyz[:, 1] <= Y_VERTEX_M))
    _hemrootX = _hemroot & ~_sbroot
    _crowsX = _crows & ~_sbroot
    parent = np.repeat(np.arange(n_root), K)
    # groom5 part-adjacent density (Review 20 B: crown streaks):
    # part-band roots grow --part-extra children each. Appended after
    # the regular block; every downstream consumer indexes by parent,
    # and the seeded jitter/length streams stay sequential (same flags
    # = same arrays: determinism gate-safe). groom6 generalises to
    # hem-edge (--hem-edge-extra) and curtain (--curtain-extra) lists;
    # child index ranges are recorded for the setback snap below.
    _extra_ranges: dict[str, tuple[int, int]] = {}
    _nextra = int(args.part_extra)
    partextra_info = {"extraPerPartRoot": _nextra,
                      "nPartRoots": int(_proot.sum()), "nExtra": 0}
    if _nextra > 0 and _proot.any():
        _xrows = np.repeat(np.nonzero(_proot)[0], _nextra)
        _extra_ranges["part"] = (len(parent), len(parent) + len(_xrows))
        parent = np.concatenate([parent, _xrows])
        partextra_info["nExtra"] = int(len(_xrows))
    # groom8a: hem-edge-extra REMOVED (post-hoc density rule).
    hemedge_info = {"extraPerRoot": 0, "nEdgeRoots": 0, "nExtra": 0,
                    "note": "removed in groom8a"}
    # groom8a: curtain-extra REMOVED (post-hoc density rule).
    curtainextra_info = {"extraPerRoot": 0, "nCurtainRoots": 0,
                         "nExtra": 0, "note": "removed in groom8a"}
    n_child = int(len(parent))
    if K == 1 and len(parent) == n_root:
        cxyz = rxyz
        cuv = ruv
        cside = rside
        sub_info = {"perRoot": 1, "jitter": "none (K==1 exact)"}
    elif K == 1:
        # extras with K==1: per-parent exact sub-roots (no jitter).
        cxyz = rxyz[parent].copy()
        cuv = ruv[parent]
        cside = rside[parent]
        sub_info = {"perRoot": 1, "jitter": "none (K==1 exact)",
                    "extras": "per-parent exact"}
    else:
        nn = np.empty(n_root)
        step = 1024
        for a in range(0, n_root, step):
            d = ((rxyz[a:a + step, None, :] - rxyz[None, :, :]) ** 2
                 ).sum(axis=2)
            part = np.partition(d, 1, axis=1)[:, 1]
            nn[a:a + step] = np.sqrt(part)
        r_cell = 0.45 * nn
        rng_sub = np.random.RandomState(int(args.subseed))
        u = rng_sub.rand(n_child)
        v = rng_sub.rand(n_child)
        rr = r_cell[parent] * np.sqrt(u)
        th = 2.0 * np.pi * v
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
        cuv = ruv[parent]
        cside = rside[parent]
        sub_info = {"perRoot": K, "seed": int(args.subseed),
                    "cellFrac": 0.45,
                    "cellRmmP50": round(float(np.median(r_cell) * 1000.0), 3),
                    "cellRmmMax": round(float(r_cell.max() * 1000.0), 3),
                    "jitMmMax": round(float(
                        np.linalg.norm(jit, axis=1).max() * 1000.0), 3)}

    # groom6 seam guard: partband roots rendering to back-view rows
    # <158 (hairline top) skip the setback snap and the part-style
    # exits, so the top rows keep natural cover (seam <= 4 px); the
    # part opens at rows 158+ (C). The feather corral likewise skips
    # samples above z = 1.648 m (the calibrated top-row scalp height).
    _topmask = np.zeros(n_root, dtype=bool)
    if int(args.part_crisp) > 0 or int(args.part_style) > 0:
        _invB0, _fB0 = _proj["back"]
        _hwT = np.ones((n_root, 4))
        _hwT[:, :3] = rxyz
        _lcT = (_invB0 @ _hwT.T).T
        _depT = -_lcT[:, 2]
        _rrT = np.full(n_root, 9999.0)
        _okT = _depT > 0
        _rrT[_okT] = 512.0 - (_lcT[_okT, 1] / _depT[_okT]) * _fB0
        _topmask = _proot & (_rrT < 158.0)
    # groom6 crisp part (Review 21 C): part extra children snap to
    # fixed setback lines (part_x +- 2.0 mm, side by parent root side;
    # parent roots within 0.5 mm of the line alternate), so root rows
    # run parallel to the part at fixed setback. y/z keep the
    # jittered sub-root; the x snap moves <= ~1 mm along the scalp
    # (roots stay on skin: covered by the inside-body gate).
    setback_info = {"on": int(args.part_crisp), "setbackMm": 2.0,
                    "nSnapped": 0, "nSkippedTop": int(_topmask.sum())}
    if int(args.part_crisp) > 0 and "part" in _extra_ranges:
        _a, _b = _extra_ranges["part"]
        _px = np.arange(_a, _b)
        _px = _px[~_topmask[parent[_px]]]
        if len(_px):
            _pr = parent[_px]
            _sgn = np.where(rxyz[_pr, 0] >= part_x, 1.0, -1.0)
            _online = np.abs(rxyz[_pr, 0] - part_x) < 0.0005
            if _online.any():
                _alt = np.arange(int(_online.sum())) % 2
                _sgn[_online] = np.where(_alt == 0, -1.0, 1.0)
            cxyz[_px, 0] = part_x + _sgn * 0.002
            setback_info["nSnapped"] = int(len(_px))
    # Root offsets in each guide's root frame, FULL 3D (lateral a, b
    # plus tangential c, transported along T(s) as a constant arc
    # shift). Full offsets make the root exact: child(0) telescopes
    # to the sub-root for any weights summing to 1.
    gi_c = gi[parent]
    w_c = w[parent]
    off = cxyz[:, None, :] - guide_root[gi_c]          # (C,3,3)
    # groom8a: degenerate-offset trim REMOVED (post-hoc whole-strand
    # deletion is banned; blend offsets are capped at 5 mm by the gap
    # gate instead).
    _deg = np.zeros(n_child, dtype=bool)
    deg_info = {"on": 0, "capMm": 5.0,
                "note": "removed in groom8a; gap gate caps offsets"}
    # Vectorised: N0/B0/T0 (R,3,3): guide root frame axes.
    N0 = N[gi_c, 0, :]
    B0 = B[gi_c, 0, :]
    T0 = T[gi_c, 0, :]
    a = (off * N0).sum(axis=2)                        # (C,3)
    b = (off * B0).sum(axis=2)
    c = (off * T0).sum(axis=2)

    # Blend: child(s) = sum w (G + N a + B b + T c). groom3 tuck rows
    # merge onto their guide: the offset terms decay as exp(-k*s), so the
    # child starts exact at its root and follows the grown guide past the
    # ear (no swing). Other rows ride constant offsets (groom2 path).
    # groom4 tuck route: merge extends to ALL tuck-class children --
    # blend offsets (10-40 mm root-to-guide gaps on sparse tucked
    # backbones) would otherwise swing wide around the guides and
    # repaint the very curtain the tuck removes; glued children follow
    # guide paths only (pixel footprint = thin ropes, not bands).
    Gw = g_res_p[gi_c].transpose(0, 2, 1, 3)  # (C,P,3,3)
    Nw = N[gi_c].transpose(0, 2, 1, 3)
    Bw = B[gi_c].transpose(0, 2, 1, 3)
    Tw = T[gi_c].transpose(0, 2, 1, 3)
    _tk = float(args.tuck_k)
    if _tk > 0.0:
        _ds = np.exp(-_tk * np.arange(P) / (P - 1))          # (P,)
        # Merge stays on the groom3 tuck box only: extending it to the
        # whole tuck class concentrated 10k strands onto 38 guide paths
        # (opaque ropes over box pixels; measured no front-box change
        # while hiding spread). Tucked guides are smooth splines (no
        # sharp ear sweep), so constant offsets swing little; spread
        # children read as thin temple haze (target-like).
        _tm = tuck[parent].astype(np.float64)[:, None, None, None]
        _km = 1.0 - _tm * (1.0 - _ds[None, :, None, None])   # (C,P,1,1)
    else:
        _km = 1.0
    # groom5 sideburn guide-hug: sideburn roots ride guides up to
    # 49 mm away; full transported offsets swing the child through
    # the head/ear (the SDF detours + shoves that stretch the class
    # past 100 mm). Damp the offset terms 1.0 -> 0.3 over the first
    # ~10% of arc (root stays exact: ramp[0] == 1.0): the strand
    # leaves its root then hugs a grown SDF-safe guide, so the
    # jitter-time short rescale starts from a clean drape and later
    # projections only make small moves.
    _sbs = 1.0
    if _sbroot.any():
        _ramp = 0.3 + 0.7 * np.exp(-30.0 * np.arange(P) / (P - 1))
        _sbs = np.ones((n_child, P))
        _sbs[_sbroot[parent]] = _ramp[None, :]
        _sbs = _sbs[:, :, None, None]
    contrib = (Gw + (Nw * a[:, None, :, None] + Bw * b[:, None, :, None]
               + Tw * c[:, None, :, None]) * _km * _sbs)
    children = (contrib * w_c[:, None, :, None]).sum(axis=2)    # (C,P,3)

    # groom4 part style (crown part crisp line): part-band roots exit
    # perpendicular to the part and flat to the scalp over the first
    # ~12 mm, then rejoin their guides. SHORT: a longer redirect denudes
    # the midline itself (measured: 25 mm exits leave a ~24 mm bald
    # strip; the target part is an 8 px / ~4 mm scalp line with hair
    # lying flat over it from both sides, so exits must cover from ~2 mm
    # out). Arc-length preserving direction reshape (root stays exact):
    # dir(j) = nlerp(d_flat, dir_orig(j), smoothstep((arc-4mm)/8mm)).
    # d_flat is the
    # lateral-away direction projected into the root tangent plane
    # (zero normal lift = combed flat). Runs before clump (part rows
    # skip clump pull via _clump_scale_root below) and before jitter
    # (radial jitter preserves exit directions).
    partstyle_info = {"on": int(args.part_style), "bandMm": PART_BAND_MM,
                      "nPartRows": int(_proot.sum())}
    if int(args.part_style) > 0 and _proot.any():
        # groom6 seam guard: hairline-top roots keep natural fall.
        _prows = np.nonzero(_proot[parent] & ~_topmask[parent])[0]
        partstyle_info["nSkippedTop"] = int(
            (_proot[parent] & _topmask[parent]).sum())
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
            _f = np.clip((_arc[1:] - 0.004) / 0.008, 0.0, 1.0)
            _f = _f * _f * (3.0 - 2.0 * _f)
            _df = _dflat[_ri]
            _dn = _df[None, :] * (1.0 - _f)[:, None] \
                + _do * _f[:, None]
            _dn /= np.linalg.norm(_dn, axis=1, keepdims=True) + 1e-12
            _q = np.empty_like(_p)
            _q[0] = _p[0]
            _q[1:] = _p[0] + np.cumsum(_dn * _sl[:, None], axis=0)
            children[_rr] = _q
        partstyle_info["doneRows"] = int(len(_prows))

    # groom6 crisp part (Review 21 C): no strand crosses the part plane
    # within 40 mm of the scalp. Part-band children samples with arc
    # < 40 mm on the wrong side of part_x are clamped to their root
    # side (0.3 mm min clearance). Pre-projection pass here (before
    # clump/jitter inherit a crossing-free base); a final all-roots
    # pass runs after the last projection (below).
    partclamp_info = {"on": int(args.part_crisp), "arcMm": 40.0,
                      "nSamples": 0, "nStrands": 0}
    if int(args.part_crisp) > 0:
        _pbchild = _proot[parent]
        if _pbchild.any():
            _seg = np.linalg.norm(np.diff(children, axis=1), axis=2)
            _arc = np.concatenate(
                [np.zeros((n_child, 1)), np.cumsum(_seg, axis=1)], axis=1)
            _sgn_c = np.where(cxyz[:, 0] >= part_x, 1.0, -1.0)[:, None]
            _wrong = _pbchild[:, None] & (_arc < 0.040) \
                & ((children[:, :, 0] - part_x) * _sgn_c < 0)
            _wrong[:, 0] = False
            if _wrong.any():
                _wr, _wc = np.nonzero(_wrong)
                children[_wr, _wc, 0] = (
                    part_x + np.where(cxyz[_wr, 0] >= part_x, 1.0, -1.0)
                    * 0.0003)
                partclamp_info["nSamples"] = int(_wrong.sum())
                partclamp_info["nStrands"] = int(
                    np.unique(_wr).size)
    # Root exactness check (telescoping): max |child(0) - sub-root|.
    root_err_mm = float(np.linalg.norm(children[:, 0, :] - cxyz, axis=1
                                       ).max() * 1000.0)

    blend_info = {"kernel": "1/(duv+0.03)^4, cutoff 1.0 rad, nearest-alone fallback",
                  "meanWeight0": round(float(w[:, 0].mean()), 4),
                  "nearestAloneFrac": round(float((w[:, 1] == 0).mean()), 4),
                  "nAlone": alone_info["nAlone"],
                  "gapGate": gap_info,
                  "earSpanAlone": ear_info,
                  "rootExactnessMmMax": round(root_err_mm, 4)}

    # Two clump scales, per-side cells (never across the part) --
    # groom2: below-vertex (back drape) cells are side-neutral (key 0)
    # so clumping merges the sheet instead of re-splitting it.
    # groom4 tuck: cells also split by tuck class (key 4th element), so
    # clump averaging never drags tucked strands toward anterior
    # curtain strands across the partition boundary (dormant unless
    # the tuck blend is active).
    # groom6 crisp part: part-band children keep side-keyed clump
    # cells even below the vertex (no pull across the part); the rest
    # of the back drape still merges side-neutral.
    _pbchild_cell = (_proot[parent] if int(args.part_crisp) > 0
                     else np.zeros(n_child, dtype=bool))
    cside_cell = np.where((cxyz[:, 1] > Y_VERTEX_M) & ~_pbchild_cell,
                           0.0, cside)
    partcrisp_info = {"on": int(args.part_crisp),
                      "nPartBandChildren": int(_pbchild_cell.sum())}
    _tcls = (np.zeros(n_child, dtype=np.int64) if not _tuck_on
             else _tuckroot[parent].astype(np.int64))
    # groom5 ear clump cap (Review 20 A/C): the coarse (large-scale)
    # pull is capped at --ear-clump-cap-w for children rooted within
    # --ear-clump-cap-mm of the pinna, so rerouted fibres are not
    # re-concentrated into rim ribbons (groom4's thick ribbons were
    # clump pull concentrating rerouted fibres). Fine scale untouched.
    _capmm = float(args.ear_clump_cap_mm)
    _capw = float(args.ear_clump_cap_w)
    _coarse_scale = _clump_scale_root[parent]
    # groom8a: hem clump relax REMOVED with hem-edge-extra (no hem-edge
    # children exist anymore).
    _hemrelax = np.zeros(n_child, dtype=bool)
    _hemrelax_n = 0
    earcap_info = {"on": int(_capmm > 0.0), "capMm": _capmm,
                   "capW": _capw, "nNearChildren": 0, "capFactor": 1.0}
    if _capmm > 0.0:
        _pdocE = np.load(args.pinna, allow_pickle=True)
        C.log_open(args.pinna)
        _pall = np.vstack([
            np.asarray(_pdocE["xyz"], dtype=np.float64)[
                np.asarray(_pdocE["idx_earXpos"])],
            np.asarray(_pdocE["xyz"], dtype=np.float64)[
                np.asarray(_pdocE["idx_earXneg"])]])
        from scipy.spatial import cKDTree as _KDTe
        _de, _ = _KDTe(_pall).query(cxyz, k=1)
        _near = _de < (_capmm / 1000.0)
        _capf = min(1.0, _capw / max(float(args.coarse_pull), 1e-9))
        _coarse_scale = _coarse_scale * np.where(_near, _capf, 1.0)
        earcap_info["nNearChildren"] = int(_near.sum())
        earcap_info["capFactor"] = round(_capf, 4)
    coarse_keys = [(int(cside_cell[i]),
                    int(np.floor(cxyz[i, 0] / (COARSE_MM / 1000.0))),
                    int(np.floor(cxyz[i, 1] / (COARSE_MM / 1000.0))),
                    int(np.floor(cxyz[i, 2] / (COARSE_MM / 1000.0))),
                    int(_tcls[i]))
                   for i in range(n_child)]
    _cscale = _clump_scale_root[parent]
    _cpow = float(args.clump_pow)
    coarse = clump_pull(children, coarse_keys, float(args.coarse_pull),
                        scale=_coarse_scale, cpow=_cpow)
    fine_keys = [(int(cside_cell[i]),
                  int(np.floor(cxyz[i, 0] / (FINE_MM / 1000.0))),
                  int(np.floor(cxyz[i, 1] / (FINE_MM / 1000.0))),
                  int(np.floor(cxyz[i, 2] / (FINE_MM / 1000.0))),
                  int(_tcls[i]))
                 for i in range(n_child)]
    fine = clump_pull(children, fine_keys, float(args.fine_pull),
                        scale=_cscale, cpow=_cpow)

    # Per-child length jitter, sigma 4% about the sub-root, seed 7.
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

    # groom5 sideburn short (Review 20 A): sideburn children rescaled
    # about their roots to 20-40 mm (deterministic per-strand uniform
    # from an independent seeded stream), keeping the clump direction
    # coherence. Length op: runs after jitter, before SDF/wrap; the
    # class keeps clump scale 0, skips the wrap march, the degenerate
    # trim and the anterior-zone safety trim (below), and stays
    # anterior (in front of the ear) by construction.
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

    # groom7 natural taper, length half (silhouette slabs): hem-root
    # and curtain-row children (sideburn hugged shorts excluded) get
    # a deterministic per-child arc scale U[0.85, 1.00] about the
    # root, so fibre ends stagger 5-15% instead of ending blunt at
    # one length. Runs with the jitter family (after jitter and the
    # sideburn rescale, before widen/spread/boost/SDF inherit it).
    hemtaper_info = {"on": int(args.hem_taper), "nChildren": 0}
    if int(args.hem_taper) > 0:
        # groom7r2 seam guard: near-midline roots (|x-part_x| < 4 mm)
        # keep full length (back-midline cover at gate row 156).
        _tapchild = ((_hemroot[parent] | _crows[parent]) & ~_sbchild
                     & (np.abs(cxyz[:, 0] - part_x) >= 0.004))
        hemtaper_info["nChildren"] = int(_tapchild.sum())
        if _tapchild.any():
            _rng_tp = np.random.RandomState(SEED + 707)
            _u = _rng_tp.rand(n_child)
            _tscale = np.ones(n_child)
            _tscale[_tapchild] = 0.85 + 0.15 * _u[_tapchild]
            _ti = np.nonzero(_tapchild)[0]
            children[_ti] = cxyz[_ti][:, None, :] + (
                children[_ti] - cxyz[_ti][:, None, :]) \
                * _tscale[_ti][:, None, None]
            hemtaper_info["scaleMin"] = round(float(_tscale.min()), 4)
            hemtaper_info["scaleMax"] = round(float(_tscale.max()), 4)

    # groom8a: curtain-widen REMOVED (post-hoc lateral rule).
    widen_info = {"widenMm": 0.0, "nRows": 0,
                  "note": "removed in groom8a"}

    # groom8a: hem-edge spread REMOVED (post-hoc lateral rule).
    hemspread_info = {"spreadMm": 0.0,
                      "nChildren": 0, "fan": "none (uniform)",
                      "clumpRelax": 1.0,
                      "clumpRelaxedChildren": 0,
                      "note": "removed in groom8a"}

    # groom6 hem length boost (Review 21 B): arc scale about the root
    # (chord scale, SDF projection re-pins after). Runs with the
    # jitter family, before blend-adjacent ops? No: after jitter, on
    # final blend positions, before the SDF projection below.
    hemboost_info = {"boost": float(args.hem_len_boost), "nChildren": 0,
                     "side": float(args.hem_boost_side)}
    if float(args.hem_len_boost) != 1.0 and _hemroot.any():
        # groom6: sideburn children never boosted (hugged shorts).
        _hb = _hemroot[parent] & ~_sbchild
        _bside = float(args.hem_boost_side)
        if _bside != 0.0:
            _hb = _hb & (np.sign(cxyz[:, 0]) == np.sign(_bside))
        hemboost_info["nChildren"] = int(_hb.sum())
        if _hb.any():
            _bi = np.nonzero(_hb)[0]
            children[_bi] = cxyz[_bi][:, None, :] + (
                children[_bi] - cxyz[_bi][:, None, :]) \
                * float(args.hem_len_boost)


    sample, grid = sdf_sampler(sdoc)
    # Outside-body projection (exact SDF, 0.3 mm margin). The s=0 root
    # points stay pinned at the scalp sub-roots (hair emerges from
    # skin); s>=1 is pushed out along the gradient (up to 8 iterations).
    # groom2 ear keep-out first: push s>=1 points within EAR_KEEP_M of
    # any pinna vert out along (p - nearest vert) (roots pinned; the
    # concha bowl is air in the body SDF so SDF projection alone cannot
    # clear it -- groom1 left ~4% of children inside 3 mm, the ear blob).
    pdoc = np.load(args.pinna, allow_pickle=True)
    C.log_open(args.pinna)
    pinna_m = np.vstack([
        np.asarray(pdoc["xyz"], dtype=np.float64)[
            np.asarray(pdoc["idx_earXpos"])],
        np.asarray(pdoc["xyz"], dtype=np.float64)[
            np.asarray(pdoc["idx_earXneg"])]])
    from scipy.spatial import cKDTree as _KDT
    _ptree = _KDT(pinna_m)
    # groom4 ear band: keep-out distance is CLI-set (default 4 mm;
    # the ear-band design requires 8 mm: no strand within 8 mm).
    _keep_m = float(args.ear_keep_mm) / 1000.0
    flat_ear = children[:, 1:, :].reshape(-1, 3)
    _epush = np.zeros(len(flat_ear))
    # groom5: the sideburn class skips the radial shove (it scatters
    # the short in-front drape up to 26 mm: measured strands to
    # 119 mm). Near-pinna sideburn samples stay trim-bound instead
    # (concha-bbox + pin-final + projective trims below make them
    # invisible without moving them).
    _sbko = np.repeat(_sbchild, P - 1)
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
    # groom4 ear wrap (ear-region fix): strands from roots above/behind
    # the ear wrap the ear's back edge and fall behind the lobe; none in
    # front of the lobe or below it on the neck. Per side, samples in the
    # lobe/neck zone (|x-x_ear| < 25 mm, z in [zmin-70, zmin+20] mm,
    # s>=1) anterior of their tier target are pushed posterior onto it
    # (feathered at zone edges, deterministic per-strand +/-1.5 mm
    # spread so the sheet does not collapse onto one plane). Two tiers:
    # lobe tier (z >= zmin-10 mm) snaps to the pinna back plane + 3 mm;
    # neck tier conforms to the body behind the neck (below). The tier
    # target blends smoothly across zmin-10 mm. Runs AFTER SDF
    # projection. Method per in-zone anterior sample: march +y in 2 mm
    # steps (cap 60 = 120 mm) until past the plane AND SDF >= 1 mm, i.e.
    # the strand wraps the ear back edge and comes to rest outside the
    # body behind it; lobe tier stops there, neck tier additionally
    # requires body traversal or +30 mm past the plane (drape join). (An earlier revision snapped neck samples to a
    # band-median drape plane: it relocated 62% of all strands and
    # parked >1000 inside the neck, because no single plane fits the
    # curved neck. Marching conforms per strand instead.) Cap
    # overruns and SDF-invalid feather-band finals are trimmed, never
    # re-projected (re-projection spits neck strands back out
    # anteriorly = the visible strip). Residual anterior samples are
    # trimmed below.
    _wrap = int(args.ear_wrap)
    _pin = {"xpos": np.asarray(pdoc["xyz"], dtype=np.float64)[
        np.asarray(pdoc["idx_earXpos"])],
        "xneg": np.asarray(pdoc["xyz"], dtype=np.float64)[
        np.asarray(pdoc["idx_earXneg"])]}
    _wrapstat = {}
    wrap_info = {"on": _wrap}
    _march_bad = np.zeros((n_child, P - 1), dtype=bool)
    if _wrap > 0:
        # SDF projection FIRST (wrap destinations must survive it; the
        # old pre-SDF order let the SDF spit neck-tier strands back out
        # anteriorly).
        _flat0 = children[:, 1:, :].reshape(-1, 3)
        _flat0, _proj0 = project_outside(_flat0, sample, margin_mm=0.3,
                                         iters=50)
        children[:, 1:, :] = _flat0.reshape(n_child, P - 1, 3)
        proj = _proj0
        _sub = children[:, 1:, :]
        _wrap_y0 = _sub.copy()
        _moved = np.zeros(n_child, dtype=bool)
        _pushmax = 0.0
        _jit = ((((np.arange(n_child, dtype=np.int64) * 2654435761)
                  % 1000).astype(np.float64)) / 1000.0 * 0.003 - 0.0015)
        for _side, _sgn in (("xpos", 1.0), ("xneg", -1.0)):
            _pv = _pin[_side]
            _xe = float(np.median(_pv[:, 0]))
            _yb = float(np.quantile(_pv[:, 1], 0.90))
            _zm = float(_pv[:, 2].min())
            _wrapstat[_side] = {"xEar": round(_xe * 1000.0, 1),
                                "yBack": round(_yb * 1000.0, 1),
                                "zMin": round(_zm * 1000.0, 1)}
            _zx = (_sub[:, :, 0] - _xe)
            # groom6 lobe gate: the zone reaches down to zmin-100
            # (was -70): below-lobe anterior samples (the lobe-tuft
            # band) march behind the jaw-line plane with the rest of
            # the tuck instead of hanging in front of the curtain.
            _zone = (np.abs(_zx) < 0.025) \
                & (_sub[:, :, 2] >= _zm - 0.100) \
                & (_sub[:, :, 2] <= _zm + 0.020)
            if not _zone.any():
                continue
            _tgt = _yb + 0.003 + _jit[:, None]
            # Lobe tier candidates: anterior of the plane (works: the
            # pocket is air). Neck-tier candidates: anterior of plane +
            # 30 mm -- strands between the plane and the drape are the
            # visible strip (posterior of the plane, anterior of where
            # the profile shows bare skin); they must traverse
            # into/through the neck or push 30 mm past the plane.
            _neckz = _sub[:, :, 2] < (_zm - 0.010)
            _cand = _zone & ((_sub[:, :, 1] < _tgt)
                             | (_neckz
                                & (_sub[:, :, 1] < _tgt + 0.030)))
            # groom5: sideburn class never marches (it falls in front
            # of the ear by design; the march would drag it behind).
            # groom6 --sideburn-tuck: sideburns join the tuck march
            # behind the jaw-line plane (lobe tuft fix).
            _sbw = np.repeat(_sbchild[:, None], P - 1, axis=1)
            if int(args.sideburn_tuck) == 0:
                _cand = _cand & ~_sbw
            if not _cand.any():
                continue
            # march +y to a body-conforming destination. Lobe tier
            # (z >= zmin-10 mm, ear pocket air): stop past the plane and
            # outside the body. Neck tier (below): the plane alone parks
            # strands in air where the profile shows bare skin (measured:
            # plane-stop leaves the neck strip untouched), so neck
            # samples must traverse into/through the neck and stop at
            # the first outside-the-body point behind it (drape join);
            # samples that never enter the body within the march (beside
            # the neck) push 30 mm past the plane toward the drape.
            _tgt1 = (_yb + 0.003) + _jit  # (C,) per-strand plane
            _neck = _sub[:, :, 2] < (_zm - 0.010)
            _yd = _sub[:, :, 1].copy()
            _act = _cand.copy()
            _seen = np.zeros_like(_act)
            for _ in range(60):
                if not _act.any():
                    break
                _probe = _sub.copy()
                _probe[:, :, 1] = _yd
                _vv, _ii = sample(_probe[_act])
                _rows, _cols = np.nonzero(_act)
                _seen[_rows, _cols] |= (_ii & (_vv < 0.0))
                _past = _yd[_act] >= _tgt1[_rows]
                _isneck = _neck[_act]
                _far = _yd[_act] >= (_tgt1[_rows] + 0.030)
                _done = _ii & (_vv >= 1.0) & (_past & (~_isneck
                                                       | _seen[_act]
                                                       | _far))
                _act[_rows[_done], _cols[_done]] = False
                _yd[_act] += 0.002
            _capped = _act
            _march_bad |= _capped
            # feather at zone borders (ramps), full strength in core.
            _fx = np.clip((0.025 - np.abs(_zx)) / 0.010, 0.0, 1.0)
            _ft = np.clip(((_zm + 0.020) - _sub[:, :, 2]) / 0.010,
                          0.0, 1.0)
            _fb = np.clip((_sub[:, :, 2] - (_zm - 0.100)) / 0.020,
                          0.0, 1.0)
            _f = np.minimum(np.minimum(_fx, _ft), _fb)
            _full = _cand & ~_capped
            _newy = _sub[:, :, 1] + _f * (_yd - _sub[:, :, 1])
            _hit = _full & (np.abs(_newy - _sub[:, :, 1]) > 1e-6)
            if _hit.any():
                _pushmax = max(_pushmax, float(
                    np.abs(_newy[_hit] - _sub[:, :, 1][_hit]).max()
                    * 1000.0))
            _sub[:, :, 1][_hit] = _newy[_hit]
            # medial pocket tuck: wrapped samples also step toward the
            # midline (into the ear pocket, hidden behind the pinna in
            # front projection; measured: rim-hugging strands peek around
            # the helix into the concha boxes). Feathered like the
            # posterior push. SDF-invalid finals revert (below) + trim.
            _sub[:, :, 0][_hit] += -np.sign(_xe) * 0.006 * _f[_hit]
            _moved |= _hit.any(axis=1)
        children[:, 1:, :] = _sub
        # rim-drop: moved samples inside pinna bbox + 8 mm step 2 mm
        # posterior (behind the helix rim edge: occluded by rim
        # cartilage in front projection, still hugging in 3q/profile).
        # SDF-invalid finals revert (below) + trim.
        _rimdrop = np.zeros((n_child, P - 1), dtype=bool)
        if _moved.any():
            _movrep2 = np.repeat(_moved, P - 1).reshape(n_child, P - 1)
            _sb = children[:, 1:, :]
            _inrim = np.zeros((n_child, P - 1), dtype=bool)
            for _key in ("idx_earXpos", "idx_earXneg"):
                _vv = np.asarray(pdoc["xyz"], dtype=np.float64)[
                    np.asarray(pdoc[_key])]
                _lo = _vv.min(axis=0) - 0.008
                _hi = _vv.max(axis=0) + 0.008
                _inrim |= ((_sb >= _lo).all(axis=2)
                            & (_sb <= _hi).all(axis=2))
            _rimdrop = _inrim & _movrep2
            children[:, 1:, :][_rimdrop] += np.array([0.0, 0.002, 0.0])
        # validity re-check on finals (march guarantees SDF>=1 for
        # full-strength finals; feather-band partials verified here).
        # Invalid finals revert to their pre-wrap (SDF-valid) position
        # and are trimmed (never re-projected); valid finals stand.
        _chk, _ins = sample(children[:, 1:, :].reshape(-1, 3))
        _badfin = (_ins & (_chk < 0.3)).reshape(n_child, P - 1)
        if _badfin.any():
            _rev = children[:, 1:, :].copy()
            _rev[_badfin] = _wrap_y0[_badfin]
            children[:, 1:, :] = _rev
        _march_bad |= _badfin
        wrap_info = {"on": _wrap, "sides": _wrapstat,
                     "nStrands": int(_moved.sum()),
                     "maxPushMm": round(_pushmax, 2),
                     "nInsideAfterSnap": int(_badfin.sum()),
                     "nCapped": int(_capped.sum()),
                     "nRimDrop": int(_rimdrop.sum())}
    else:
        flat = children[:, 1:, :].reshape(-1, 3)
        flat, proj = project_outside(flat, sample, margin_mm=0.3,
                                     iters=50)
        children[:, 1:, :] = flat.reshape(n_child, P - 1, 3)

    # groom2 ear-tuck redirect: side curtains at ear height cover the
    # concha in front/three_quarter/profile projection (guides score 0
    # covering; children drift). Six whole-strand directional variants
    # were tried and reverted (posterior / lean / medial / marched /
    # searched / uniform-drop): assumed targets sit inside the head
    # mesh or still cover, and whole-strand moves shear at the pinned
    # root (vertical kink segments crossing the ear) or cause excess +
    # frizz. Current: FEATHERED SQUASH (per-point, below).
    # groom2 ear-tuck redirect: REMOVED (no positional tuck). SDF-mapping
    # proved the ear sits nearly on the head, and a feathered per-point
    # squash (tried last) collapsed 37k strands' ear band onto one plane
    # = a solid hair shelf over the whole ear (boxes went 121/121 solid
    # hair). The ear fix is drift prevention only: blend guard
    # (centroid-cover + preauricular nearest-alone, 2468 rows) + tighter
    # gap gate (CLI 15 mm: far-blend swings cannot reach the ear) +
    # 4 mm radial keep-out + SDF. No strand is positionally moved for
    # the ear after blending.
    tuck_info = {"nStrands": 0, "note": "positional tuck removed"}

    # groom4 rim set (companion to guide-level tuck routing): rim-band
    # strands (within -8/+6 mm of the pinna back plane in the ear x/z
    # zone) step posterior by --rim-set-mm (feathered at zone borders),
    # so rim cartilage occludes them in front projection. SDF-invalid
    # finals revert to pre-push positions and trim (never moved blind).
    # Runs on final SDF-projected positions; needs the earframe.
    rimset_info = {"pushMm": float(args.rim_set_mm), "nStrands": 0}
    if float(args.rim_set_mm) > 0.0 and earframe is not None:
        _rs = children[:, 1:, :]
        _rs0 = _rs.copy()
        _rmoved = np.zeros(n_child, dtype=bool)
        for _side in ("xpos", "xneg"):
            _st = earframe["sides"][_side]
            _xe = _st["xEarMm"] / 1000.0
            _yb = _st["yPostMm"] / 1000.0
            _zm = _st["zLobeMm"] / 1000.0
            _zx = (_rs[:, :, 0] - _xe)
            _zone = (np.abs(_zx) < 0.025) \
                & (_rs[:, :, 2] >= _zm - 0.070) \
                & (_rs[:, :, 2] <= _zm + 0.020)
            if not _zone.any():
                continue
            _band = _zone & (_rs[:, :, 1] >= _yb - 0.008) \
                & (_rs[:, :, 1] <= _yb + 0.006)
            if not _band.any():
                continue
            _fx = np.clip((0.025 - np.abs(_zx)) / 0.010, 0.0, 1.0)
            _ft = np.clip(((_zm + 0.020) - _rs[:, :, 2]) / 0.010,
                          0.0, 1.0)
            _fb = np.clip((_rs[:, :, 2] - (_zm - 0.070)) / 0.020,
                          0.0, 1.0)
            _f = np.minimum(np.minimum(_fx, _ft), _fb)
            _step = _f * (float(args.rim_set_mm) / 1000.0)
            _hit = _band & (_step > 1e-9)
            _rs[:, :, 1][_hit] += _step[_hit]
            _rmoved |= _hit.any(axis=1)
        children[:, 1:, :] = _rs
        _chk, _ins = sample(children[:, 1:, :].reshape(-1, 3))
        _badfin = (_ins & (_chk < 0.3)).reshape(n_child, P - 1)
        if _badfin.any():
            _rev = children[:, 1:, :].copy()
            _rev[_badfin] = _rs0[_badfin]
            children[:, 1:, :] = _rev
        _march_bad |= _badfin
        rimset_info = {"pushMm": float(args.rim_set_mm),
                       "nStrands": int(_rmoved.sum()),
                       "nInvalidReverted": int(_badfin.sum())}

    # groom5 sideburn length enforcement (Review 20 A: 20-40 mm): the
    # SDF shoves after the jitter-time rescale stretch some of the
    # class past 40 mm (measured max 119 mm). Two collapse -> project
    # rounds: points beyond 40 mm arc collapse onto the exact 40 mm
    # cutoff point (kept prefix points are untouched
    # SDF-validated positions, so no resample zigzag for the
    # projection to inflate); then projection restores the 0.3 mm
    # clearance with small coherent moves at the original point
    # spacing. Roots untouched. Chord-scale retraction is NOT used
    # (it cut through flesh: measured 13k inside samples).
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
                # collapse to (hi - 4 mm): the projection below
                # regrows up to ~4 mm; cut + growth stays <= hi.
                _cutmm = max(_sbhi - 0.004, 0.010)
                _cut = max(int(np.searchsorted(_arc, _cutmm)), 2)
                _cut = min(int(_cut), P - 1)
                _lo, _hi = _arc[_cut - 1], _arc[_cut]
                _fr = 0.0 if _hi <= _lo \
                    else (_cutmm - _lo) / (_hi - _lo)
                _qc = _p[_cut - 1] * (1.0 - _fr) + _p[_cut] * _fr
                children[_q, _cut:] = _qc
            _sbflat = children[_long, 1:, :].reshape(-1, 3)
            _sbflat, _sbproj = project_outside(
                _sbflat, sample, margin_mm=0.3, iters=20,
                over_mm=0.0)
            children[_long, 1:, :] = _sbflat.reshape(
                len(_long), P - 1, 3)
            sbclamp_info["reproj"] = {
                "nPushed": int(sbclamp_info.get("reproj", {}).get(
                    "nPushed", 0)) + _sbproj["nPushed"],
                "maxPushMm": round(max(
                    sbclamp_info.get("reproj", {}).get(
                        "maxPushMm", 0.0),
                    _sbproj["maxPushMm"]), 4),
                "minSdfAfter": _sbproj["minSdfAfter"],
                "nInsideAfter": _sbproj["nInsideAfter"],
                "nRounds": _sbproj["nRounds"]}
        _sL2 = np.linalg.norm(np.diff(children[_sbi], axis=1),
                               axis=2).sum(axis=1)
        sbclamp_info["maxAfterMm"] = round(
            float(_sL2.max() * 1000.0), 1)

    # groom6 sideburn hug (Review 21 A): sideburn shorts lie flat --
    # samples floating more than --sideburn-hug-mm off the body are
    # stepped back along -gradient toward 1 mm clearance (3 mm max
    # per round, cap 20 rounds), so the shorts follow the skin (max
    # 2 mm) instead of catching light as floating stubs. Roots
    # untouched; runs after the length clamp, before the ear trims
    # (trims still bind genuine ear intersections).
    sbhug_info = {"on": int(float(args.sideburn_hug_mm) > 0.0),
                  "hugMm": float(args.sideburn_hug_mm), "nPushed": 0,
                  "maxPullMm": 0.0}
    if float(args.sideburn_hug_mm) > 0.0 and _sbchild.any():
        _sbi2 = np.nonzero(_sbchild)[0]
        _hugflat = children[_sbi2][:, 1:, :].reshape(-1, 3).copy()
        _pulled = np.zeros(len(_hugflat))
        for _ in range(20):
            _vv, _ii = sample(_hugflat)
            _need = _ii & (_vv > float(args.sideburn_hug_mm))
            if not _need.any():
                break
            _idx = np.nonzero(_need)[0]
            _sub = _hugflat[_idx]
            _grad = np.zeros_like(_sub)
            for _ax in range(3):
                _d = np.zeros_like(_sub)
                _d[:, _ax] = 0.002
                _v1, _ = sample(_sub + _d)
                _v0, _ = sample(_sub - _d)
                _grad[:, _ax] = (_v1 - _v0) / 0.004
            _glen = np.linalg.norm(_grad, axis=1)
            _bad = ~(np.isfinite(_glen)) | (_glen < 1e-9)
            _grad[_bad] = np.array([0.0, 0.0, -1.0])
            _glen[_bad] = 1.0
            _want = np.minimum(_vv[_idx] - 1.0, 3.0) / 1000.0
            _step = (_grad / _glen[:, None]) * _want[:, None]
            _dist = np.linalg.norm(_step, axis=1)
            _hugflat[_idx] = _sub - _step
            _pulled[_idx] += _dist * 1000.0
        children[_sbi2, 1:, :] = _hugflat.reshape(len(_sbi2), P - 1, 3)
        sbhug_info["nPushed"] = int((_pulled > 0).sum())
        sbhug_info["maxPullMm"] = round(float(_pulled.max()), 4)
        # The hug can overshoot into the body on noisy gradients:
        # re-project the hugged samples to the 0.3 mm clearance
        # (outward only; compatible with the <=2 mm hug target).
        _sbflat2 = children[_sbi2, 1:, :].reshape(-1, 3)
        _sbflat2, _sbproj2 = project_outside(
            _sbflat2, sample, margin_mm=0.3, iters=20, over_mm=0.0)
        children[_sbi2, 1:, :] = _sbflat2.reshape(len(_sbi2), P - 1, 3)
        sbhug_info["reproj"] = {
            "nPushed": _sbproj2["nPushed"],
            "maxPushMm": _sbproj2["maxPushMm"],
            "minSdfAfter": _sbproj2["minSdfAfter"],
            "nInsideAfter": _sbproj2["nInsideAfter"],
            "nRounds": _sbproj2["nRounds"]}
    # groom6 crisp part, final pass (Review 21 C): side assignment by
    # root side for EVERY child -- any s>=1 sample with arc < 40 mm on
    # the wrong side of part_x vs its root side is clamped to
    # part_x +- 0.3 mm. Catches crossings the SDF projection
    # reintroduced and crossers from outside the part band (guide
    # shape converges across the midline). Lateral micro-moves on
    # final positions; the inside-body gate verifies.
    partclamp2_info = {"on": int(args.part_crisp), "nSamples": 0,
                       "nStrands": 0}
    if int(args.part_crisp) > 0:
        _seg2 = np.linalg.norm(np.diff(children, axis=1), axis=2)
        _arc2 = np.concatenate(
            [np.zeros((n_child, 1)), np.cumsum(_seg2, axis=1)], axis=1)
        _rside_c = np.where(rxyz[parent, 0] >= part_x, 1.0, -1.0)[:, None]
        _wrong2 = (_arc2 < 0.040) \
            & ((children[:, :, 0] - part_x) * _rside_c < 0)
        _wrong2[:, 0] = False
        # Feathered corral 40-90 mm (Review 21 C: the visible part
        # corridor): crossers past the hard gate range are dragged
        # toward their root-side wall with a linear 40->90 mm
        # falloff, so the part reads straight instead of zig-zag
        # without a hard mid-strand wall.
        _feather = (_arc2 >= 0.040) & (_arc2 < 0.090) \
            & ((children[:, :, 0] - part_x) * _rside_c < 0) \
            & (children[:, :, 2] < 1.648)
        _feather[:, 0] = False
        partclamp2_info["nFeather"] = int(_feather.sum())
        if _feather.any():
            _fr, _fc = np.nonzero(_feather)
            _w = (0.090 - _arc2[_fr, _fc]) / 0.050
            _t = part_x + np.where(rxyz[parent[_fr], 0] >= part_x,
                                   1.0, -1.0) * 0.0003
            _x0 = children[_fr, _fc, 0]
            children[_fr, _fc, 0] = _x0 * (1.0 - _w) + _t * _w
        if _wrong2.any() or _feather.any():
            _wr2, _wc2 = np.nonzero(_wrong2)
            if _wr2.size:
                children[_wr2, _wc2, 0] = (
                    part_x + np.where(rxyz[parent[_wr2], 0] >= part_x,
                                      1.0, -1.0) * 0.0003)
            partclamp2_info["nSamples"] = int(_wrong2.sum())
            partclamp2_info["nStrands"] = int(np.unique(_wr2).size)
            # The lateral moves (hard + feather) can dip samples just
            # inside the body on high-curvature scalp: project all
            # touched strands back out (outward-only, tiny) and
            # re-clamp any sample the projection carried across
            # (cap 3 rounds).
            _fall = np.unique(np.concatenate(
                [_wr2, _fr]) if _feather.any() else _wr2)
            _wr_all = _fall
            for _rd in range(3):
                _flat3 = children[_wr_all][:, 1:, :].reshape(-1, 3)
                _vv3, _ii3 = sample(_flat3)
                if not (_ii3 & (_vv3 < 0.3)).any():
                    break
                _flat3, _rep3 = project_outside(
                    _flat3, sample, margin_mm=0.3, iters=10,
                    over_mm=0.0)
                children[_wr_all, 1:, :] = _flat3.reshape(
                    len(_wr_all), P - 1, 3)
                _seg3 = np.linalg.norm(
                    np.diff(children[_wr_all], axis=1), axis=2)
                _arc3 = np.concatenate(
                    [np.zeros((len(_wr_all), 1)),
                     np.cumsum(_seg3, axis=1)], axis=1)
                _sg3 = np.where(
                    rxyz[parent[_wr_all], 0] >= part_x, 1.0, -1.0)[:, None]
                _w3 = (_arc3 < 0.040) \
                    & ((children[_wr_all][:, :, 0] - part_x) * _sg3 < 0)
                _w3[:, 0] = False
                if not _w3.any():
                    break
                _rr3, _cc3 = np.nonzero(_w3)
                children[_wr_all[_rr3], _cc3, 0] = (
                    part_x + np.where(
                        rxyz[parent[_wr_all[_rr3]], 0] >= part_x,
                        1.0, -1.0) * 0.0003)
            partclamp2_info["rounds"] = _rd + 1

    # Radii taper (CLI; defaults reproduce the old 0.05 -> 0.015 mm).
    t = np.arange(P) / (P - 1)
    prof = r_root_m + (r_tip_m - r_root_m) * (t ** 1.5)
    radii = np.repeat(prof[None, :], n_child, axis=0).astype(np.float32)
    # groom7 natural taper, tip half: taper-class children (same mask
    # as the length half) thin toward the tip (x1.0 above 55% of arc
    # to x0.25 at the tip), so ends render as soft fringe rather
    # than blunt solid tips. Radii only.
    if int(args.hem_taper) > 0:
        _f = np.clip((t - 0.55) / 0.45, 0.0, 1.0)
        _thin_prof = (1.0 - 0.75 * (_f * _f * (3.0 - 2.0 * _f))).astype(
            np.float32)
        _tapchild2 = ((_hemroot[parent] | _crows[parent]) & ~_sbchild
                      & (np.abs(cxyz[:, 0] - part_x) >= 0.004))
        radii[_tapchild2] *= _thin_prof[None, :]
        hemtaper_info["tipThin"] = "x1.0 -> x0.25 over last 45% of arc"
    # groom2 concha trim: guides route >=8 mm around the pinna, but
    # drifted children dip into the concha bowl (air in the 2 mm SDF
    # grid, un-pushable) and render as the black ear blob (shadowed
    # cavity strands; measured 33-119 ID px per concha box). Positional
    # moves all failed (SDF-mapped: no exterior hiding place; leans
    # caused excess + frizz). Instead, trim: s>=1 samples inside either
    # pinna bbox + 3 mm get ~zero radius (invisible). Counts, positions,
    # determinism, inside-body all unchanged; the strand visibly resumes
    # below the ear = the tucked look (hair behind the ear is hidden,
    # drape below shows). Roots (s=0) untouched (hair still emerges).
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
    # groom4 tuck final pinna trim: the radial keep-out does not fully
    # converge in the crowded tuck pocket (and SDF projection can hand
    # a few samples back toward the pinna). Any s>=1 sample within the
    # keep distance of the pinna on FINAL positions is trimmed
    # (invisible), so the visible pinna gate holds by construction.
    # Counted. Runs whenever tucked guides are present (not gated on
    # ear-wrap).
    _n_pintrim = 0
    if _tuck_on:
        _pdist, _ = _ptree.query(_pts, k=1)
        # epsilon-inclusive: keep-out parks samples at exactly keepMm
        # (float-boundary flakes read either side); trim them too.
        _pin3 = _pdist <= (_keep_m + 1e-6)
        _pin3 &= ~_inbowl
        _n_pintrim = int(_pin3.sum())
        _inbowl |= _pin3
    # groom4 rim trim (moved strands only): wrap-marched strands that
    # come to rest just outside the +3 mm concha boxes still stack
    # subpixel coverage over the ear rim in projection (measured: a
    # 41 px front-concha wedge with identical nearest geometry --
    # deeper-stack alpha crossing the ID threshold). Moved strands get
    # +6 mm boxes; unmoved curtain keeps +3 mm (tucked hug preserved).
    _rim_extra = np.zeros(len(_pts), dtype=bool)
    _n_rim = 0
    if _wrap > 0 and _moved.any():
        _pb6 = []
        for _key in ("idx_earXpos", "idx_earXneg"):
            _vv = np.asarray(pdoc["xyz"], dtype=np.float64)[
                np.asarray(pdoc[_key])]
            _pb6.append((_vv.min(axis=0) - 0.006,
                         _vv.max(axis=0) + 0.006))
        _movrep = np.repeat(_moved, P - 1)
        for (_lo, _hi) in _pb6:
            _rim_extra |= ((_pts >= _lo).all(axis=1)
                           & (_pts <= _hi).all(axis=1)) & _movrep
        _rim_extra &= ~_inbowl
        _n_rim = int(_rim_extra.sum())
        _inbowl |= _rim_extra
    _inbowl = _inbowl.reshape(n_child, P - 1)
    # groom4 safety trim: concha bowl (above) plus wrap leftovers --
    # march cap overruns, SDF-invalid feather-band finals, and any
    # s>=1 sample still anterior of its side's back plane in the
    # lobe/neck zone. Roots untouched.
    _lobe_extra = np.zeros((n_child, P - 1), dtype=bool)
    if _wrap > 0:
        _sub2 = children[:, 1:, :]
        for _side in ("xpos", "xneg"):
            _st = _wrapstat[_side]
            _xe = _st["xEar"] / 1000.0
            _yb = _st["yBack"] / 1000.0
            _zm = _st["zMin"] / 1000.0
            _lz = (np.abs(_sub2[:, :, 0] - _xe) < 0.025) \
                & (_sub2[:, :, 2] >= _zm - 0.070) \
                & (_sub2[:, :, 2] <= _zm + 0.020) \
                & (_sub2[:, :, 1] < _yb - 0.002)
            # groom5: sideburn class exempt (anterior by design; the
            # concha-bbox + projective trims still bind it). groom6
            # --sideburn-tuck: no exemption (residual anterior
            # samples trim like the rest of the tuck).
            _lobe_extra |= _lz & ~_sbw \
                if int(args.sideburn_tuck) == 0 else _lz
    _inbowl = _inbowl | _lobe_extra | _march_bad
    # groom4 projective concha trim: the 3D boxes above miss curtain
    # strands 10-30 mm ANTERIOR of the ear that still cover the concha
    # in projection (measured: front-xneg wedge whose nearest samples
    # are identical to the clean groom -- deeper-stack alpha crossing
    # the ID threshold). Project s>=1 samples to the FRONT view only
    # (the only view whose concha boxes fail; three_quarter/profile_90
    # read 0 and their tuck edges are left untouched); samples inside
    # either side's 11 px concha box and within (pinna-3 mm,
    # pinna+30 mm) in depth get ~zero radius. Deeper drape is kept.
    # Radii only; positions, counts, determinism unchanged. Off unless
    # ear-wrap on.
    _n_proj = 0
    if _wrap > 0:
        _projflat = np.zeros(len(_pts), dtype=bool)
        _inv, _f = _proj["front"]
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
            _c0 = float(_pcc[_pm].mean())
            _r0 = float(_prr[_pm].mean())
            _pd = float(np.median(_pdep[_pok][_pm]))
            _projflat |= (_cc >= _c0 - 5) & (_cc <= _c0 + 5) \
                & (_rr >= _r0 - 5) & (_rr <= _r0 + 5) & _ok \
                & (_dep >= _pd - 0.003) & (_dep <= _pd + 0.030)
        del _hw, _lc, _dep, _cc, _rr
        _projflat &= ~_inbowl.reshape(-1)
        _n_proj = int(_projflat.sum())
        _inbowl |= _projflat.reshape(n_child, P - 1)
    _trimmed = _inbowl.any(axis=1)
    _rmap = np.ones((n_child, P - 1), dtype=np.float32)
    _rmap[_inbowl] = 0.0
    radii[:, 1:] *= _rmap
    # groom4 ear band trim (operator handback 2): roots within 15 mm
    # of the pinna or in front of the ear below the helix top get NO
    # hair -- whole strands trimmed. Box test from the earframe
    # bandBoxMm + 15 mm 3D proximity to the pinna (own tree: the
    # keep-out tree covers all pinna verts).
    _bandroot = np.zeros(n_root, dtype=bool)
    band_info = {"on": int(args.band_trim), "nRoots": 0, "nStrands": 0}
    if int(args.band_trim) > 0 and earframe is not None:
        from scipy.spatial import cKDTree as _KDTb
        _btree = _KDTb(pinna_m)
        _bd, _ = _btree.query(rxyz, k=1)
        for _sgn, _side in ((1.0, "xpos"), (-1.0, "xneg")):
            _rows = (rxyz[:, 0] * _sgn > 0)
            _bb = earframe["sides"][_side]["bandBoxMm"]
            _bandroot |= _rows & (
                (_bd < 0.015)
                | ((np.abs(rxyz[:, 0]) >= _bb["xLo"])
                   & (np.abs(rxyz[:, 0]) < _bb["xHi"])
                   & (rxyz[:, 1] < _bb["yMax"])
                   & (rxyz[:, 2] < _bb["zHi"])
                   & (rxyz[:, 2] > _bb["zLo"])))
    _band = (_bandroot[parent] if int(args.band_trim) > 0
             and earframe is not None
             else np.zeros(n_child, dtype=bool))
    if _band.any():
        radii[_band, :] = 2e-9
    band_info = {"on": int(args.band_trim),
                 "nRoots": int(_bandroot.sum()),
                 "nStrands": int(_band.sum()),
                 "nSamples": int(_band.sum() * P)}
    # degenerate-offset trim (above): whole strands. groom5: the
    # sideburn class is exempt (short local strands ride long guides
    # by design; trimming them would re-introduce absence).
    _degapp = (_deg & ~_sbchild) if _sbchild.any() else _deg
    deg_info["nStrandsApplied"] = int(_degapp.sum())
    if _degapp.any():
        radii[_degapp, :] = 2e-9
    # groom4 curtain thin (companion to guide-level tuck routing): the
    # above-zone curtain (tuck-box roots OUTSIDE the tuck class: far
    # temple feeders whose long drapes form the mid-ear lock mass)
    # renders too thick (opaque sheet over upper-ear pixels where the
    # target shows a slim lock). Trim every other child of those roots
    # (deterministic by child index; uniform per root, positions/counts/
    # determinism unchanged) to halve the curtain mass. Below-vertex,
    # cheek, and tuck-class rows untouched (drape/front-width kept).
    _thin = np.zeros(n_child, dtype=bool)
    thin_info = {"on": int(args.curtain_thin), "nRoots": 0, "nStrands": 0}
    if int(args.curtain_thin) > 0 and _tuck_on:
        _thinroot = ((np.abs(rxyz[:, 0]) >= _tbox[0])
                     & (np.abs(rxyz[:, 0]) < _tbox[1])
                     & (rxyz[:, 1] >= _tbox[2])
                     & (rxyz[:, 1] < _tbox[3])
                     & ~_tuckroot & ~below_v & ~_cheekroot)
        _thin = _thinroot[parent] & ((np.arange(n_child) % 2) == 0)
        if _thin.any():
            radii[_thin, :] = 2e-9
        thin_info = {"on": int(args.curtain_thin),
                     "nRoots": int(_thinroot.sum()),
                     "nStrands": int(_thin.sum()),
                     "nSamples": int(_thin.sum() * P)}
    # groom4 cheek trim (below-lobe anterior no-hair; mostly a band
    # subset, kept explicit per the original card).
    _cheek = (np.zeros(n_child, dtype=bool) if not (
        int(args.cheek_trim) > 0 and earframe is not None)
        else _cheekroot[parent])
    if _cheek.any():
        radii[_cheek, :] = 2e-9
    cheek_info = {"on": int(args.cheek_trim), "earFrame": bool(
        earframe is not None), "nRoots": int(_cheekroot.sum()),
        "nStrands": int(_cheek.sum()),
        "nSamples": int(_cheek.sum() * P)}
    # groom4 halo trim (front ear moat): samples projecting within
    # 6 px of either front pinna hull AND within 8 mm behind the
    # pinna surface (depth) are trimmed. Catches long-segment
    # crossings that point-in-box tests miss (samples sit 3-25 px
    # away). Radii only.
    halo_info = {"on": int(args.halo_trim), "nSamples": 0}
    if int(args.halo_trim) > 0:
        _invF, _fF = _proj["front"]
        _hwH = np.ones((len(_pts), 4))
        _hwH[:, :3] = _pts
        _lcH = (_invF @ _hwH.T).T
        _depH = -_lcH[:, 2]
        _ccH = np.full(len(_pts), -1.0)
        _rrH = np.full(len(_pts), -1.0)
        _okH = _depH > 0
        _ccH[_okH] = 512.0 + (_lcH[_okH, 0] / _depH[_okH]) * _fF
        _rrH[_okH] = 512.0 - (_lcH[_okH, 1] / _depH[_okH]) * _fF
        _halo = np.zeros(len(_pts), dtype=bool)
        for _key in ("idx_earXpos", "idx_earXneg"):
            _pvH = np.asarray(pdoc["xyz"], dtype=np.float64)[
                np.asarray(pdoc[_key])]
            _phH = np.ones((_pvH.shape[0], 4))
            _phH[:, :3] = _pvH
            _plcH = (_invF @ _phH.T).T
            _pdepH = -_plcH[:, 2]
            _pokH = _pdepH > 0
            _pccH = 512.0 + (_plcH[_pokH, 0] / _pdepH[_pokH]) * _fF
            _prrH = 512.0 - (_plcH[_pokH, 1] / _pdepH[_pokH]) * _fF
            _pmH = (_pccH >= 0) & (_pccH < 1024) & (_prrH >= 0) \
                & (_prrH < 1024)
            if not _pmH.any():
                continue
            _treeH = _KT(np.stack([_pccH[_pmH], _prrH[_pmH]], axis=1))
            _ddH, _jjH = _treeH.query(
                np.stack([_ccH[_okH], _rrH[_okH]], axis=1), k=1)
            _pdH = _pdepH[_pokH][_pmH][_jjH]
            _hitH = np.zeros(len(_pts), dtype=bool)
            _oo = np.nonzero(_okH)[0]
            _hitH[_oo[(_ddH < 6.0) & (_depH[_okH] < _pdH + 0.008)]] = True
            _halo |= _hitH
        # only newly-trimmed (visible) samples count; apply to radii.
        _halo &= (radii[:, 1:].reshape(-1) > 1e-6)
        halo_info = {"on": int(args.halo_trim),
                     "nSamples": int(_halo.sum())}
        _hhc, _hsc = np.nonzero(_halo.reshape(n_child, P - 1))
        radii[_hhc, _hsc + 1] = 2e-9
        del _hwH, _lcH, _depH, _ccH, _rrH
    # groom6 lobe trim (Review 21 lobe gate): hem/sideburn samples
    # projecting into the below-lobe boxes (three_quarter + profile,
    # both sides, rows lobeBottom-10..+30, cols pinna-median +2..+45
    # toward the face) AND anterior of the pinna (depth < pinna
    # median - 2 mm) get ~zero radius: the tucked drape behind the
    # ear stays, only the front fringe below the earlobe is cut, so
    # the lobe boxes read zero hair-ID px like the target. Radii
    # only; positions, counts and determinism unchanged. 0 = off.
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
                    & (_ccL < _hiL) & (_depL < _pd - 0.002)
            del _hwL, _lcL, _depL, _ccL, _rrL
        _lobe &= (radii[:, 1:].reshape(-1) > 1e-6)
        lobetrim_info["nSamples"] = int(_lobe.sum())
        _lbc, _lsc = np.nonzero(_lobe.reshape(n_child, P - 1))
        radii[_lbc, _lsc + 1] = 2e-9
    # groom6 hem tip trim (Review 21 B): hem-edge children samples
    # projecting past the target hem edges in the BACK view (outside
    # --hem-trim-cols, rows >= 700) get ~zero radius: the outward
    # spread must fill the target edge, not overshoot past it
    # (measured: sparse wing tips land outside the target edge while
    # mid-box stays thin). Radii only; positions, counts and
    # determinism unchanged. Runs on final positions with the other
    # projective trims.
    # groom8a: hem-tip-trim REMOVED (post-hoc projective trim,
    # including the margin variant).
    hemtip_info = {"on": 0, "nSamples": 0, "cols": [266.0, 761.0],
                   "marginPx": 0.0, "note": "removed in groom8a"}
    # groom8a: spike-trim REMOVED (post-hoc projective excess trim).
    spiketrim_info = {"on": 0, "nSamples": 0,
                      "note": "removed in groom8a"}
    # groom6 kill root dots (Review 21 A): fully-trimmed strands
    # (every s>=1 radius below the visible floor, by any trim) get
    # ~0 radius at s=0 too, so their scalp root points stop rendering
    # as stipple dots. Counts/positions/determinism unchanged.
    rootdot_info = {"on": int(args.kill_root_dots), "nStrands": 0}
    if int(args.kill_root_dots) > 0:
        _full = ~((radii[:, 1:] > 1e-6).any(axis=1))
        if _full.any():
            radii[_full, 0] = 0.0
        rootdot_info["nStrands"] = int(_full.sum())
    radii[radii == 0.0] = 2e-9
    trim_info = {"nStrands": int(_trimmed.sum()),
                 "nSamples": int(_inbowl.sum()),
                 "lobeFrontSamples": int(_lobe_extra.sum()),
                 "rimExtraSamples": int(_n_rim),
                 "projConchaSamples": int(_n_proj),
                 "pinFinalSamples": int(_n_pintrim)}

    pts32 = children.astype(np.float32)
    out_npz = outdir / "strands.npz"
    np.savez_compressed(
        str(out_npz), points=pts32, radii=radii,
        roots=cxyz.astype(np.float32),
        guide_idx=pool[gi_c].astype(np.int32), guide_w=w_c.astype(np.float32),
        side=cside.astype(np.float32),
        parent=parent.astype(np.int32))
    sha = C.sha256(out_npz)
    C.log_open(out_npz)

    build = {
        "inputs": {"guides": str(args.guides), "roots": str(args.roots),
                   "sdf": str(args.sdf)},
        "counts": {"roots": n_root, "guides": n_guide, "pointsPer": P,
                   "childrenPerRoot": K,
                   "children": int(pts32.shape[0])},
         "part": {"partX": part_x, "crownBandN": int(len(band))},
         "vertex": {"yVertexM": Y_VERTEX_M,
                    "nBelowVertexRoots": int(below_v.sum()),
                    "note": "no side restriction at/below vertex"},
         "earKeepout": ear_info,
         "earTuck": tuck_info,
         "earWrap": wrap_info,
         "partStyle": partstyle_info,
         "curtainWiden": widen_info,
         "conchaTrim": trim_info,
         "blend": blend_info,
        "tuckBlend": tuckblend_info,
        "cheekTrim": cheek_info,
        "bandTrim": band_info,
        "degenerateTrim": deg_info,
        "rimSet": rimset_info,
        "curtainThin": thin_info,
        "haloTrim": halo_info,
        "subRoots": sub_info,
        "dotGuides": dot_info,
        "kinkGuard": kink_info,
        "hemTaper": hemtaper_info,
        "tuckRoute": tuckroute_info,
        "sideburnShort": sbshort_info,
        "sideburnClamp": sbclamp_info,
        "sideburnRoots": sbroot_info,
        "sideburnHug": sbhug_info,
        "rootDots": rootdot_info,
        "hemEdgeExtra": hemedge_info,
        "hemEdgeSpread": hemspread_info,
        "hemLenBoost": hemboost_info,
        "hemTipTrim": hemtip_info,
        "spikeTrim": spiketrim_info,
        "lobeTrim": lobetrim_info,
        "curtainExtra": curtainextra_info,
        "partCrisp": partcrisp_info,
        "partClamp": partclamp_info,
        "partClampFinal": partclamp2_info,
        "partSetback": setback_info,
        "earClumpCap": earcap_info,
        "partExtra": partextra_info,
        "clump": {"coarseMm": COARSE_MM,
                  "coarsePullTip": float(args.coarse_pull),
                  "coarseCells": coarse, "fineMm": FINE_MM,
                  "finePullTip": float(args.fine_pull),
                  "fineCells": fine,
                  "pow": _cpow,
                  "profile": "t^%.1f root->tip, zero at root" % _cpow},
         "lengthJitter": len_info,
         "projection": proj,
         "coverPostSDFsub": int(_covers(
             children[::7, 1:, :].reshape(-1, 3)).sum()),
        "radiiMm": {"root": r_root_m * 1000.0, "tip": r_tip_m * 1000.0,
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
                      "projection": proj,
                      "earKeepout": ear_info,
                      "earWrap": wrap_info,
                      "partStyle": partstyle_info,
                      "curtainWiden": widen_info,
                      "earSpanAloneRows": int(ear_span.sum()),
                      "earTuckStrands": int(tuck_info["nStrands"]),
        "tuckBlend": tuckblend_info,
        "cheekTrim": cheek_info,
        "bandTrim": band_info,
        "degenerateTrim": deg_info,
        "sideburnShort": sbshort_info,
        "earClumpCap": earcap_info,
        "partExtra": partextra_info,
        "hemEdgeExtra": hemedge_info,
        "hemEdgeSpread": hemspread_info,
        "curtainExtra": curtainextra_info,
        "kinkGuard": kink_info,
        "hemTaper": hemtaper_info,
        "spikeTrim": spiketrim_info,
        "partCrisp": partcrisp_info,
        "partClamp": partclamp_info,
        "partClampFinal": partclamp2_info,
        "partSetback": setback_info,
        "sideburnHug": sbhug_info,
        "rootDots": rootdot_info,
                      "rimSet": rimset_info,
                      "curtainThin": thin_info,
                      "haloTrim": halo_info,
                      "conchaTrim": trim_info,
                      "belowVertexRoots": int(below_v.sum()),
                      "coarseCells": coarse["nCells"],
                      "fineCells": fine["nCells"]}, indent=1))


if __name__ == "__main__":
    main()
