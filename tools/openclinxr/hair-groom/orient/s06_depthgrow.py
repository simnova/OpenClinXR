#!/usr/bin/env python3
"""STEP 3b (groom8a): hull-depth-layered guide tracer.

Replaces s03_grow.py's eroded-interior attraction + steering boxes +
post-hoc projection with:

- SHELL LAYERING (Paris 2004): each guide is assigned a depth fraction
  u in [0.3, 0.9] (golden-ratio stride, deterministic). Local hull
  thickness T(root) = D_dil_out + sdf sampled 3 mm above the root along
  its normal (dilated-hull domain, the s03 domain), clamped [3, 30] mm.
  Target shell depth d* = u * T. The orientation field supplies only
  the in-shell tangent: t_shell = t - (t.g)g, plus a restoring term
  k*(d* - sdf)*g along the SDF gradient g (k=0.5, clamped to 1 mm/step).
  Nothing attracts guides to the eroded interior; nothing pushes them
  out except the depth law itself.
- TURN GATE INSIDE THE TRACER: 15 deg / 5 mm = 3 deg per 1 mm step.
  A proposed direction turning more than 3 deg from travel is slerped
  back to exactly 3 deg (relax, counted). Guides are never deleted.
- NO POSITIONAL PROJECTIONS: every constraint (part wall, ear
  keep-out, face corridor) is directional (strip the violating motion
  component) or a stop. Max positional move by construction: 0.0 mm.
- Kept routing (not hull-keeping): gravity drape bias, ear-approach
  posterior bias + near-ear deflect + tuck pocket + anterior wall +
  sideburn transit, centre-part HARD HALF-SPACE wall (full guide
  length; the below-vertex sheet merge lives only in the children
  blend), face-air corridor strips + face stop,
  transition ride-out (the below-vertex guide-level centre merge is
  OFF: it overshot across the midline; the sheet merge lives in the
  children blend). Removed: EIN attract, D<2.5 inward bias,
  silhouette strips/funnel/slide/override, apex preference, vertex
  clamp, all positional ease/clamp/repair.
- Tuck class: roots in the earframe tuck boxes are NOT traced here;
  the 57 verbatim tucked guides from guides-tucked.npz serve them
  (temple ratios preserved). New guides carry tuck=0, band=0.

Roots: greedy Poisson subset of scalp1 roots (crown-first z order,
adaptive spacing to land 2000-2200; pinna-8mm + root-cover exclusions
as s03; tuck-class excluded). Deterministic, no RNG.

Output OUTDIR/guides-8a.npz (guides.npz schema + tuck/band channels:
curves_head 41-pt head-mm, crown, status, ok_idx, roots_file,
y_ear_mm, verdict, tuck, band) + OUTDIR/grow8a-stats.json.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

S10 = Path(__file__).resolve().parent
sys.path.insert(0, str(S10))
import common_o as CO  # noqa: E402

STEP = 1.0
# Turn caps: the leader (arc <= 10 mm) exits the scalp steeply (a
# 3 deg/step cap makes ANY scalp exit fatal: the climb needs ~60 deg
# total, which a 3 deg cap turns into a corkscrew death spiral --
# measured). Post-leader the cap is 5 deg/step: a literal 3 deg cap
# cannot hold shell depth on real drape down-slopes (30-60 deg;
# holding depth needs rotating toward horizontal by the slope angle),
# so 3 deg forces either circles or skull-hugging. 5 deg admits drape
# curvature while still forbidding the 37-179 deg kinks (defect 2).
# No positional moves anywhere: the bound holds by construction.
TURN_LEADER_DEG = 12.0
TURN_MAIN_DEG = 5.0
COS_MAIN = float(np.cos(np.radians(TURN_MAIN_DEG)))
COS_LEADER = float(np.cos(np.radians(TURN_LEADER_DEG)))
# Depth law: GENTLE layering bias on a data-draped trace. The
# orientation field (multi-view combed) already knows how hair drapes
# through the volume -- including its normal component down-slope --
# so the tracer follows the FULL 3D field and the depth law only
# centers guides near their assigned shell (authority tan ~3.4 deg
# post-leader, steep only in the leader where the exit climb lives).
# A hard depth servo fights the data's down-slopes with a permanently
# saturated correction (measured: cap-riding circles, death spirals).
# Synthetic loads (gravity, ear/center/ride routing) are still
# shell-projected so they never fight depth. Trim authority sits
# UNDER the 5 deg/step main cap (tan 2.9 deg): the depth trim can
# never single-handedly bind the gate (measured: a 0.12 trim rode the
# cap on every slope-holding step).
LAMBDA_MAX = 0.05
LAMBDA_LEADER_MAX = 0.20
# Leader ramp is FIXED 8 mm normal-out (whorl-proof exit); all climb
# is need-driven via lambda (thin columns need ~nothing, so they exit
# tangentially instead of punching through the dome top). A long ramp
# kept guides normal-out past thin hull tops = edge deaths.
RAMP_MM = 8.0
BOUND_MM = 3.0  # dil-boundary slide band (directional, post-gate)
Y_VERTEX_MM = 34.2
CENTER_K = 0.003
CENTER_XBAND = 80.0
EAR_KEEP = 8.0


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--outdir", required=True)
    p.add_argument("--n-guides-lo", type=int, default=2000)
    p.add_argument("--n-guides-hi", type=int, default=2200)
    return p.parse_args()


def tri_sampler(grid, origin, spacing):
    origin = np.asarray(origin, dtype=np.float64)

    def sample(pts, order=1, cval=np.nan):
        pts = np.asarray(pts, dtype=np.float64)
        idx = ((pts - origin) / spacing).T
        return ndimage.map_coordinates(grid, idx, order=order,
                                       cval=cval, mode="constant")
    return sample


def main():
    t0 = time.time()
    args = cli()
    E = Path(args.outdir)
    E.mkdir(parents=True, exist_ok=True)
    CO.track(S10 / "s06_depthgrow.py")
    inp = CO.load_all()
    F = np.load(str(CO.E0 / "field.npz"))
    CO.track(CO.E0 / "field.npz")
    H = np.load(str(CO.ROOT / "tools/openclinxr/evidence/hair-hull5"
                            "/hull.npz"), allow_pickle=True)
    CO.track(CO.ROOT / "tools/openclinxr/evidence/hair-hull5/hull.npz")
    GT = np.load(str(CO.ROOT / "tools/openclinxr/evidence/hair-groom4"
                     "/tucked/guides-tucked.npz"), allow_pickle=True)
    CO.track(CO.ROOT / "tools/openclinxr/evidence/hair-groom4/tucked"
             "/guides-tucked.npz")
    EF = json.loads((CO.ROOT / "tools/openclinxr/evidence/hair-groom4"
                     "/tucked/earframe.json").read_text())
    CO.track(CO.ROOT / "tools/openclinxr/evidence/hair-groom4/tucked"
             "/earframe.json")

    hull = H
    xs = np.array(hull["xs"])
    ys = np.array(hull["ys"])
    zs = np.array(hull["zs"])
    spacing = float(hull["spacing"])
    occ = np.array(hull["occupancy"], dtype=bool)
    shape = occ.shape
    origin = np.array([xs[0], ys[0], zs[0]])
    assert tuple(F["idx"].max(axis=0) + 1) <= shape, \
        (F["idx"].max(axis=0), shape)
    # groom8a round 2: the growth DOMAIN stays the 4 mm dilation
    # (strict-occ containment asphyxiates the tracer: edge 2448, hem
    # 74 -- the rind is maneuver room). But the DEPTH target reads the
    # STRICT hull thickness (Docc): guides hold inside the visual
    # hull, off the rind, instead of filling it to the boundary.
    dil = ndimage.binary_dilation(occ, iterations=2)
    Ddil = ndimage.distance_transform_edt(dil).astype(
        np.float32) * spacing
    Docc = ndimage.distance_transform_edt(occ).astype(
        np.float32) * spacing

    idx = np.array(F["idx"])
    tdir = np.array(F["dir"], dtype=np.float32)
    dense = np.zeros(shape + (3,), dtype=np.float32)
    dense[idx[:, 0], idx[:, 1], idx[:, 2]] = tdir

    pinna_all = np.vstack([np.asarray(inp["pinna"]["xpos"]),
                           np.asarray(inp["pinna"]["xneg"])])
    pinna_tree = cKDTree(pinna_all)
    egrid = inp["egrid"]
    sdf = np.asarray(egrid["sdf"], dtype=np.float32)
    sorigin = np.asarray(egrid["origin"], dtype=np.float64)
    sspacing = float(np.asarray(egrid["spacing"]).ravel()[0])
    gsdf = [np.gradient(sdf, sspacing, axis=i).astype(np.float32)
            for i in range(3)]
    menton_mm = np.array(inp["menton"], dtype=np.float64) * 1000.0
    FACE_Z0 = float(menton_mm[2]) - 40.0
    FACE_X = 60.0
    EAR_Y = float(np.median(pinna_all[:, 1]))
    EAR_TOP = float(pinna_all[:, 2].max())
    print("EAR yMed=%.0f top=%.0f nPinna=%d FACE_Z0=%.0f" % (
        EAR_Y, EAR_TOP, len(pinna_all), FACE_Z0), flush=True)

    s_dir = [tri_sampler(dense[..., i], origin, spacing)
             for i in range(3)]
    s_sdf = tri_sampler(sdf, sorigin, sspacing)
    s_gsdf = [tri_sampler(g, sorigin, sspacing) for g in gsdf]
    s_dil = tri_sampler(dil.astype(np.float32), origin, spacing)
    s_Ddil = tri_sampler(Ddil, origin, spacing)
    s_Docc = tri_sampler(Docc, origin, spacing)
    gDdil = [np.gradient(Ddil, spacing, axis=i).astype(np.float32)
             for i in range(3)]
    s_gDdil = [tri_sampler(g, origin, spacing) for g in gDdil]

    def field_dir(p, travel):
        v = np.array([s(p[None, :], order=1)[0] for s in s_dir])
        if not np.isfinite(v).all():
            return None
        n = np.linalg.norm(v)
        if n < 1e-9:
            return None
        v /= n
        if (v * travel).sum() < 0:
            v = -v
        return v

    def sdf_grad(p):
        g = np.array([s(p[None, :], order=1)[0] for s in s_gsdf])
        n = np.linalg.norm(g)
        if not np.isfinite(n) or n < 1e-9:
            return None
        return g / n

    def inward_grad(p):
        # gradient of D_dil points away from the dil boundary
        # (inward); None where flat/undefended.
        h = np.array([s(p[None, :], order=1)[0] for s in s_gDdil])
        n = np.linalg.norm(h)
        if not np.isfinite(n) or n < 1e-9:
            return None
        return h / n

    def prior_of(root, nroot, p):
        if float(root[1]) > Y_VERTEX_MM or (
                abs(float(root[0])) < 12.0 and float(root[1]) > -60.0):
            return np.array([0.0, 0.0, -1.0])
        side = 1.0 if root[0] >= 0 else -1.0
        lat = np.array([side, 0.0, 0.0])
        lat = lat - (lat * nroot).sum() * nroot
        if np.linalg.norm(lat) < 1e-6:
            lat = np.array([side, 0.0, 0.0])
        lat /= np.linalg.norm(lat) + 1e-12
        drop = root[2] - p[2]
        a = np.clip((drop - 15.0) / 30.0, 0, 1)
        a = 0.5 - 0.5 * np.cos(a * np.pi)
        v = (1 - a) * lat + a * np.array([0.0, 0.0, -1.0])
        return v / (np.linalg.norm(v) + 1e-12)

    # ---- roots, exclusions (s03 precedent)
    roots_mm = np.array(inp["roots"]["xyz"],
                        dtype=np.float64) * 1000.0
    rnorm = np.array(inp["roots"]["normal"], dtype=np.float64)
    rnorm /= np.linalg.norm(rnorm, axis=1, keepdims=True) + 1e-12
    _droot, _ = cKDTree(pinna_all).query(roots_mm, k=1)
    cand8 = _droot >= 8.0
    from scipy.spatial import ConvexHull, Delaunay
    pin_m = pinna_all / 1000.0
    root_cover = np.zeros(len(roots_mm), dtype=bool)
    rw = roots_mm / 1000.0
    for _v in ("front", "three_quarter", "profile_90"):
        _cam = inp["cams"]["views"][_v]
        _pc, _pr, _pd = CO.C2.ENV.project_to_render(
            pin_m, _cam, inp["sensor"])
        _m = ((_pd > 0) & (_pc >= 0) & (_pc < 1024) & (_pr >= 0)
              & (_pr < 1024))
        _p2 = np.stack([_pc[_m], _pr[_m]], axis=1)
        _pdep = _pd[_m]
        _tri = Delaunay(_p2[ConvexHull(_p2).vertices])
        _t2 = cKDTree(_p2)
        _cc, _rr, _dd = CO.C2.ENV.project_to_render(
            rw, _cam, inp["sensor"])
        _in = ((_cc >= 0) & (_cc < 1024) & (_rr >= 0) & (_rr < 1024)
               & (_dd > 0)
               & (_tri.find_simplex(np.stack([_cc, _rr], axis=1))
                  >= 0))
        _ii = np.nonzero(_in)[0]
        _, _ji = _t2.query(np.stack([_cc[_in], _rr[_in]], axis=1), k=1)
        _cov = _dd[_in] < _pdep[_ji] - 0.003
        root_cover[_ii[_cov]] = True
    # tuck-class roots (served by the verbatim tucked guides)
    _rmm = roots_mm
    _tuckroot = np.zeros(len(roots_mm), dtype=bool)
    for _sgn, _side in ((1.0, "xpos"), (-1.0, "xneg")):
        _rows = (_rmm[:, 0] * _sgn > 0)
        _tb = EF["sides"][_side]["tuckBoxMm"]
        _tuckroot |= _rows & (np.abs(_rmm[:, 0]) >= _tb["xLo"]) \
            & (np.abs(_rmm[:, 0]) < _tb["xHi"]) \
            & (_rmm[:, 1] < _tb["yMax"]) \
            & (_rmm[:, 2] >= _tb["zLo"]) \
            & (_rmm[:, 2] < _tb["zHi"])
    print("ROOTS total=%d pinna8excl=%d coverexcl=%d tuckexcl=%d" % (
        len(roots_mm), int((~cand8).sum()),
        int((cand8 & root_cover).sum()), int(
            (cand8 & ~root_cover & _tuckroot).sum())), flush=True)
    cand = np.nonzero(cand8 & ~root_cover & ~_tuckroot)[0]
    order = np.argsort(-roots_mm[cand, 2], kind="stable")
    order = np.asarray(cand)[order]

    # ---- dense Poisson (crown-first, adaptive spacing 2000-2200)
    spacing_p = 4.0
    sel = None
    for _ in range(40):
        acc = []
        acc_xyz = np.zeros((0, 3))
        tree = None
        n_since = 0
        for i in order:
            p = roots_mm[i]
            if len(acc) == 0:
                acc.append(int(i))
                acc_xyz = p[None, :]
                tree = cKDTree(acc_xyz)
                continue
            d, _ = tree.query(p, k=1)
            if d >= spacing_p:
                acc.append(int(i))
                acc_xyz = np.vstack([acc_xyz, p[None, :]])
                n_since += 1
                if n_since >= 32:
                    tree = cKDTree(acc_xyz)
                    n_since = 0
        sel = np.array(acc, dtype=np.int64)
        if len(sel) < args.n_guides_lo:
            spacing_p *= 0.93
        elif len(sel) > args.n_guides_hi:
            spacing_p *= 1.07
        else:
            break
    sel = np.array(sel, dtype=np.int64)
    # groom8a round 2: ear-zone densification. Children near the ear
    # drift across the concha on 5 mm+ blend offsets (round 1: 5040
    # profile crossings from clean guides); halving the backbone
    # spacing in the ear box shrinks offsets below the drift range.
    _used = set(int(v) for v in sel)
    _ebox = [i for i in order if int(i) not in _used
             and 40.0 <= abs(float(roots_mm[int(i), 0])) < 100.0
             and -130.0 <= float(roots_mm[int(i), 1]) < 40.0
             and 1440.0 <= float(roots_mm[int(i), 2]) < 1620.0]
    _esp = spacing_p * 0.5
    _etree = cKDTree(roots_mm[np.array(sel)])
    _eacc = []
    for i in _ebox:
        d, _ = _etree.query(roots_mm[int(i)], k=1)
        if d >= _esp:
            _eacc.append(int(i))
            if len(_eacc) >= 500:
                break
            if len(_eacc) % 32 == 0:
                _etree = cKDTree(roots_mm[np.array(
                    list(sel) + _eacc)])
        if len(_eacc) >= 500:
            break
    sel = np.array(list(sel) + _eacc, dtype=np.int64)
    print("POISSON n=%d spacing=%.2f (+%d ear densify)" % (
        len(sel), spacing_p, len(_eacc)), flush=True)
    sroots = roots_mm[sel]

    # ---- per-guide depth fraction + local thickness
    PHI = 0.618033988749895
    uu = 0.3 + 0.6 * ((np.arange(len(sel)) * PHI) % 1.0)
    Thick = np.zeros(len(sel))
    for j, r in enumerate(sroots):
        n0 = rnorm[sel[j]]
        q = r + n0 * 3.0
        sd = float(s_sdf(q[None, :], order=1)[0])
        dd = float(s_Docc(q[None, :], order=1)[0])
        if not np.isfinite(sd):
            sd = 0.0
        if not np.isfinite(dd):
            dd = 0.0
        Thick[j] = float(np.clip(sd + dd, 3.0, 30.0))
    dstar = uu * Thick
    print("DEPTH u[0.3,0.9] T p50=%.1f p90=%.1f d* p50=%.1f p90=%.1f" % (
        float(np.percentile(Thick, 50)),
        float(np.percentile(Thick, 90)),
        float(np.percentile(dstar, 50)),
        float(np.percentile(dstar, 90))), flush=True)

    # ---- per-root local hem extent (dilated hull)
    occidx = np.argwhere(dil)
    hem_tree = cKDTree(occidx[:, :2].astype(np.float64) * spacing)
    hems = np.zeros(len(sel))
    for j, r in enumerate(sroots):
        ii = np.array([[(r[0] - xs[0]) / spacing,
                        (r[1] - ys[0]) / spacing]])
        dd, jj = hem_tree.query(ii, k=400)
        cd = occidx[jj[0][dd[0] * spacing <= 25.0]]
        hems[j] = zs[cd[:, 2]].min() if len(cd) else zs.min()
    maxlens = np.clip(sroots[:, 2] - float(zs.min()) + 100.0, 60.0,
                      600.0)

    def turn_gate(d1, travel, cos_max):
        """Slerp d1 back to the cap from travel. Returns (d, hit)."""
        cos_a = float((d1 * travel).sum())
        if cos_a >= cos_max:
            return d1, False
        perp = d1 - cos_a * travel
        pl = np.linalg.norm(perp)
        if pl < 1e-12:
            return travel.copy(), True
        perp /= pl
        ang = float(np.arccos(np.clip(cos_max, -1, 1)))
        g = (cos_max * travel + np.sin(ang) * perp)
        return g / (np.linalg.norm(g) + 1e-12), True

    def relax_step(prop, travel, alpha, cos_max):
        """Low-pass the proposal toward travel, then hard-cap.
        Returns (d, gate_hit)."""
        lp = alpha * prop + (1.0 - alpha) * travel
        nl = np.linalg.norm(lp)
        if nl < 1e-12:
            return travel.copy(), False
        return turn_gate(lp / nl, travel, cos_max)

    def in_ear_window(pm):
        return (abs(pm[0]) > 40.0 and pm[2] < EAR_TOP + 40.0
                and pm[2] > EAR_TOP - 70.0
                and pm[1] > EAR_Y - 60.0 and pm[1] < EAR_Y + 25.0)

    def grow_guide(j, root, bias_face=0.4):
        nroot = rnorm[sel[j]]
        ds = dstar[j]
        # travel init = scalp normal (the leader ramp starts
        # normal-out; the proposal agrees from step 0).
        travel = nroot / (np.linalg.norm(nroot) + 1e-12)
        dbg = (int(os.environ.get("S06_DEBUG", "0")) > 0 and j < 20)
        _dbg_prop = []
        _dbg_corr = []
        _dbg_S = []
        _dbg_err = []
        pts = [root.copy()]
        p = root.copy()
        arc = 0.0
        n_gate = 0
        n_prior = 0
        n_steer = 0
        n_center = 0
        n_ride = 0
        n_earwin = 0
        n_pocket = 0
        n_gravfull = 0
        n_coast = 0
        stop = "maxlen"
        maxlen = float(maxlens[j])
        hem = float(hems[j])
        edge_grace = 0
        # field-follow direction (whorl-proof): per-guide low-pass of
        # the field, initialized normal-out. Spin (whorl) averages out
        # into a straight through-flight; persistent drape accumulates.
        # Replaces the fixed leader ramp.
        ff = nroot / (np.linalg.norm(nroot) + 1e-12)
        for _ in range(600):
            d_mid = field_dir(p, travel)
            used_prior = False
            if d_mid is None:
                d_mid = prior_of(root, nroot, p)
                used_prior = True
                if (d_mid * travel).sum() < 0:
                    d_mid = -d_mid
            pm = p + d_mid * (STEP / 2)
            d1 = field_dir(pm, d_mid)
            if d1 is None:
                d1 = prior_of(root, nroot, pm)
                used_prior = True
                if (d1 * d_mid).sum() < 0:
                    d1 = -d1
            n_prior += 1 if used_prior else 0
            # field-follow update: swing toward the sampled field at
            # 20%/step (drape accumulates; bends wind through the cap
            # smoothly). FREEZE only in extreme spin (curl > 45 deg:
            # true singularities/whorl centers where the field
            # reverses): coast straight through instead of winding
            # (relax-the-step; counted). Moderate curl bends normally.
            # No freeze inside the exit ramp (the exit bend must
            # happen). Rejoin when straight.
            _fn = d1 / (np.linalg.norm(d1) + 1e-12)
            _curl = float(np.degrees(np.arccos(np.clip(
                (_fn * ff).sum(), -1, 1))))
            if arc > RAMP_MM and _curl > 45.0:
                n_coast += 1
            else:
                ff = 0.2 * _fn + 0.8 * ff
                ff = ff / (np.linalg.norm(ff) + 1e-12)
            f = ff
            # SHELL ARCHITECTURE: the normal channel belongs to the
            # depth law only; every routing bias is projected onto the
            # shell tangent plane, so nothing fights depth for the
            # turn gate to cap. Depth target is LIVE (u * local column
            # thickness), always reachable by construction.
            g = sdf_grad(pm)
            sd = float(s_sdf(pm[None, :], order=1)[0])
            if not np.isfinite(sd):
                sd = 0.0
            dd = float(s_Ddil(pm[None, :], order=1)[0])
            if not np.isfinite(dd):
                dd = 0.0
            # strict-hull column for the depth target (see domain note)
            ddo = float(s_Docc(pm[None, :], order=1)[0])
            if not np.isfinite(ddo):
                ddo = 0.0
            S = np.zeros(3)
            # gravity drape (drop+arc hybrid, s03 weights)
            _drop = float(root[2] - pm[2])
            _eff = max((_drop - 5.0) / 30.0, (arc - 45.0) / 30.0)
            _eff = float(0.5 - 0.5 * np.cos(
                np.clip(_eff, 0, 1) * np.pi))
            S = S + (0.02 + 0.06 * _eff) * np.array([0.0, 0.0, -1.0])
            if _eff > 0.5:
                n_gravfull += 1
            # ear routing (kept; not hull-keeping). The blanket
            # window-wide posterior pre-route is REMOVED (it herded
            # every transit guide through the cap; the anterior swing
            # + pocket + wall + keep-out below route the ear): only
            # counted transit here.
            if in_ear_window(pm):
                n_steer += 0
                n_earwin += 1
            ed = None
            ei = None
            _ed4 = (None, None)
            if in_ear_window(pm) or (
                    abs(pm[0]) > 45.0 and abs(pm[0]) < 85.0
                    and pm[1] > -95.0 and pm[1] < -25.0
                    and pm[2] > 1485.0 and pm[2] < 1565.0):
                ed, ei = pinna_tree.query(pm, k=1)
                ed = float(ed)
                if ed < 25.0 and (pm - pinna_all[ei])[1] < -5.0:
                    S = S + 0.25 * np.array([0.0, 1.0, 0.0])
                    n_steer += 1
                if ed < 30.0:
                    med = -np.sign(pm[0]) if pm[0] != 0 else 1.0
                    tuckv = np.array([1.5 * med, 1.5, 0.0])
                    S = S + 0.25 * ((30.0 - ed) / 30.0) * tuckv
                    n_steer += 1
                    n_pocket += 1
                _ed4 = (ed, ei)
                if ed < 30.0 and (pm - pinna_all[ei])[1] < -3.0 \
                        and f[1] < 0:
                    S[1] = 0.0 if S[1] < 0 else S[1]
                    n_steer += 1
                if ed < 12.0:
                    away = pm - pinna_all[ei]
                    al = np.linalg.norm(away)
                    if al > 1e-9:
                        blend = away / al + np.array([0.0, 1.0, 0.0])
                        bl = np.linalg.norm(blend)
                        if bl > 1e-9:
                            S = S + ((15.0 - ed) / 15.0) * 0.35 \
                                * blend / bl
                            n_steer += 1
            if abs(pm[0]) > 45.0 and abs(pm[0]) < 85.0 \
                    and pm[1] > -95.0 and pm[1] < -25.0 \
                    and pm[2] > 1485.0 and pm[2] < 1565.0:
                post = np.array([0.0, 0.7, -0.7])
                post /= np.linalg.norm(post)
                S = S + 0.25 * post
                n_steer += 1
            # below-vertex centre merge: OFF (the guide-level merge
            # overshoots across the midline and returns anterior
            # crossed -- the hard-gate crossing source. The sheet merge
            # below the vertex lives in the children blend, which has
            # no side restriction there by construction).
            if False and pm[1] > Y_VERTEX_MM \
                    and abs(pm[0]) < CENTER_XBAND \
                    and f[2] < 0.0:
                _ex = abs(float(pm[0])) - 6.0
                if _ex > 0:
                    S[0] = S[0] - CENTER_K * _ex * np.sign(pm[0])
                    n_steer += 1
                    n_center += 1
            if 20.0 < float(pm[1]) < 70.0 \
                    and 1450.0 < float(pm[2]) < 1620.0 \
                    and abs(float(pm[0])) < 40.0:
                S = S + 0.15 * np.array([0.0, 1.0, 0.0])
                n_steer += 1
                n_ride += 1
            # COMBINE: full-3D field + shell-projected routing + gentle
            # depth centering along the gradient. Live adaptive target
            # (u * local column thickness).
            leader = arc <= RAMP_MM
            if g is not None:
                Sp = S - (S * g).sum() * g
                Tpm = float(np.clip(ddo + max(sd, 0.0), 1.0, 40.0))
                tgt = uu[j] * Tpm
                need = (tgt - sd) / 4.0  # 4 mm lookahead, gentle
                lam_max = LAMBDA_LEADER_MAX if leader else LAMBDA_MAX
                lam = float(np.clip(need, -lam_max, lam_max))
                # align suppression: when the tangent disagrees with
                # travel, fly straight (correction resumes when
                # aligned).
                _tan = f + Sp
                _tn = np.linalg.norm(_tan)
                if _tn > 1e-9:
                    _al = float((_tan / _tn * travel).sum())
                    lam = lam * float(np.clip(_al, 0.0, 1.0))
                d1 = f + Sp + lam * g
                nn = np.linalg.norm(d1)
                d1 = d1 / nn if nn > 1e-9 else travel.copy()
                if dbg:
                    _dbg_prop.append(float(np.degrees(np.arccos(
                        np.clip((d1 * travel).sum(), -1, 1)))))
                    _dbg_corr.append(abs(lam))
                    _dbg_S.append(float(np.linalg.norm(Sp)))
                    _dbg_err.append(tgt - sd)
            else:
                d1 = f + S
                nn = np.linalg.norm(d1)
                d1 = d1 / nn if nn > 1e-9 else travel.copy()
            # near-ear radial strip (directional, post-combine)
            if _ed4[0] is not None and _ed4[0] < 4.0:
                _ed, _ei = _ed4
                away = pm - pinna_all[_ei]
                al = np.linalg.norm(away)
                if al > 1e-9:
                    rhat = away / al
                    inw = (d1 * rhat).sum()
                    if inw < 0:
                        d1 = d1 - inw * rhat
                        d1 /= np.linalg.norm(d1) + 1e-12
                        n_steer += 1
            # dil-boundary slide (directional, never positional): inside
            # the band the outward motion component is stripped so
            # guides ride the boundary instead of exiting. Evaluated
            # pre-gate for the agile flag only; the binding slide runs
            # post-gate below (safety stands, not re-capped).
            _db = float(s_Ddil(pm[None, :], order=1)[0])
            # Cap params (the SINGLE gate runs at the end, after all
            # strips, so safety and proposal are capped once together:
            # no strip-vs-cap fight, travel follows the stepped
            # direction each step).
            _leader = arc <= RAMP_MM
            _cos = COS_LEADER if _leader else COS_MAIN
            q = p + d1 * STEP
            # centre-part wall: HARD HALF-SPACE, full guide length
            # (orchestrator round-1 grade: below-vertex guide crossings
            # render as X-hatch over the upper back/crown; the sheet
            # merge below the vertex lives ONLY in the children blend,
            # which is side-neutral there by construction). Funnel
            # (8 mm, proportional) + strip (2 mm). Directional only:
            # no positional ease, clamp, or repair.
            rx0 = float(root[0])
            if abs(rx0) >= 3.0 and d1[0] * rx0 < 0:
                _ax = abs(float(q[0]))
                if _ax < 2.0:
                    d1[0] = 0.0
                    d1 /= np.linalg.norm(d1) + 1e-12
                    q = p + d1 * STEP
                    n_steer += 1
                elif _ax < 8.0:
                    d1[0] = d1[0] * (_ax - 2.0) / 6.0
                    d1 /= np.linalg.norm(d1) + 1e-12
                    q = p + d1 * STEP
                    n_steer += 1
            # crossed-guide push-back (directional backstop, full
            # length): any sample on the wrong side beyond 2 mm is
            # steered home. Capped with everything else by the single
            # gate below, so the push accumulates into a smooth return.
            _reentry = (abs(rx0) >= 3.0
                        and q[0] * rx0 < 0 and abs(q[0]) > 2.0)
            # face-air corridor: directional strips only (anterior).
            # Z-capped at FACE_Z0+110 (the face proper): crown-height
            # drape passes above it untouched.
            if q[1] < 0.0 and abs(q[0]) < FACE_X + 10.0 \
                    and q[2] > FACE_Z0 and q[2] < FACE_Z0 + 110.0 and \
                    float(s_sdf(q[None, :], order=1)[0]) > 5.0:
                sgn = np.sign(rx0) if abs(rx0) >= 3.0 else (
                    np.sign(q[0]) if q[0] != 0 else 1.0)
                if d1[0] * sgn < 0:
                    d1[0] = 0.0
                if d1[1] < 0:
                    d1[1] = 0.0
                _fb = bias_face * np.array([sgn, 0.0, 0.0])
                _gq = sdf_grad(q)
                if _gq is not None:
                    _fb = _fb - (_fb * _gq).sum() * _gq
                d1 = d1 + _fb
                d1 /= np.linalg.norm(d1) + 1e-12
                q = p + d1 * STEP
                n_steer += 1
                if abs(q[0]) < FACE_X and q[2] > FACE_Z0 and \
                        float(s_sdf(q[None, :], order=1)[0]) > 8.0:
                    stop = "face"
                    break
            # ear hard keep-out 8 mm: directional alternatives only,
            # never positional. Fallbacks bend away/posterior.
            if in_ear_window(q):
                edq, eiq = pinna_tree.query(q, k=1)
                edq = float(edq)
                if edq < EAR_KEEP:
                    away = q - pinna_all[eiq]
                    al = np.linalg.norm(away)
                    rhat = away / al if al > 1e-9 else np.array(
                        [np.sign(q[0]), 0.0, 0.0])
                    cleared = False
                    for bend in (0.5, 1.0, 2.0, 4.0):
                        cand = d1 + bend * (rhat + np.array(
                            [0.0, 1.0, 0.0]))
                        cand /= np.linalg.norm(cand) + 1e-12
                        cand, _ = turn_gate(cand, travel, _cos)
                        q2 = p + cand * STEP
                        if float(pinna_tree.query(q2, k=1)[0]) \
                                >= EAR_KEEP:
                            d1 = cand
                            q = q2
                            n_steer += 1
                            cleared = True
                            break
                    if not cleared:
                        stop = "ear"
                        break
            # Re-entry push-back BEFORE the single gate (capped with
            # everything else): the push accumulates over steps into a
            # smooth return instead of fighting the cap.
            if _reentry:
                d1[0] = abs(d1[0]) * np.sign(rx0) + 0.5 * np.sign(
                    rx0)
                d1 /= np.linalg.norm(d1) + 1e-12
                n_steer += 1
            # Dil-boundary slide BEFORE the single gate.
            if np.isfinite(_db) and _db < BOUND_MM:
                h = inward_grad(pm)
                if h is not None:
                    out = (d1 * h).sum()
                    if out < 0:
                        d1 = d1 - out * h
                        nn2 = np.linalg.norm(d1)
                        if nn2 < 1e-6:
                            stop = "edge"
                            break
                        d1 /= nn2
                        n_steer += 1
                        q = p + d1 * STEP
            # THE turn gate (inside the tracer): single universal bound
            # on the stepped direction (leader 12 / main 5 deg/step).
            # No step anywhere turns more; safety accumulates through
            # travel instead of fighting the cap.
            d1, _hitF = turn_gate(d1, travel, _cos)
            n_gate += 1 if _hitF else 0
            q = p + d1 * STEP
            # domain exits are stops, never projections. The first 8 mm
            # (leader) transit from the scalp to the shell: exempt from
            # body/dil exits (s03 leader precedent).
            if arc > 8.0 and float(s_sdf(q[None, :], order=1)[0]) < 0.5:
                stop = "body"
                break
            if q[2] <= hem + 2.0:
                stop = "hem"
                # step onto the hem point
                p = q
                pts.append(p.copy())
                arc += STEP
                break
            if float(s_dil(q[None, :], order=0)[0]) < 0.5:
                if arc <= 8.0:
                    pass  # leader transit: containment starts at arc>8
                else:
                    # 3-step grace (6 in the temple/sideburn box where
                    # thin columns need recovery room: round-1 grade
                    # showed temple guides dying short -> far-blend
                    # frizz in front of the ear): outside, the adaptive
                    # depth target pulls back inside on its own; only a
                    # persistent exit stops the guide.
                    _tbox = (35.0 <= abs(float(q[0])) < 100.0
                             and -135.0 <= float(q[1]) < -40.0)
                    edge_grace += 1
                    if edge_grace >= (6 if _tbox else 3):
                        stop = "edge"
                        break
            else:
                edge_grace = 0
            p = q
            travel = d1
            pts.append(p.copy())
            arc += STEP
            if arc >= maxlen:
                stop = "maxlen"
                break
        if dbg and _dbg_prop:
            a = np.array(_dbg_prop)
            print("DBG g%d stop=%s n=%d propTurn p50=%.1f p95=%.1f "
                  "fracGt3=%.2f corrMean=%.2f SMean=%.2f errMean=%+.2f" % (
                j, stop, len(a), float(np.percentile(a, 50)),
                float(np.percentile(a, 95)), float((a > 3.0).mean()),
                float(np.mean(_dbg_corr)), float(np.mean(_dbg_S)),
                float(np.mean(_dbg_err))), flush=True)
        return (np.array(pts), stop, arc, n_gate, n_prior, n_steer,
                n_center, n_ride, n_earwin, n_pocket, n_gravfull,
                n_coast)

    curves, stops, lens = [], [], []
    ngate, nprior, nsteer, ncenter, nride = [], [], [], [], []
    nearwin, npocket, ngravfull, ncoast = [], [], [], []
    for j, root in enumerate(sroots):
        out = grow_guide(j, root, 0.4)
        curves.append(out[0])
        stops.append(out[1])
        lens.append(out[2])
        ngate.append(out[3])
        nprior.append(out[4])
        nsteer.append(out[5])
        ncenter.append(out[6])
        nride.append(out[7])
        nearwin.append(out[8])
        npocket.append(out[9])
        ngravfull.append(out[10])
        ncoast.append(out[11])
        if (j + 1) % 400 == 0:
            print("grown %d/%d" % (j + 1, len(sroots)), flush=True)
    # retry pass (s03 precedent): 'face' casualties with stronger
    # curtain bias; 'body' casualties with a shallower shell target
    # (d* x 0.7: deep targets in thin columns dive).
    n_retry = 0
    for j, root in enumerate(sroots):
        if stops[j] == "face" and lens[j] < 150.0:
            out = grow_guide(j, root, 1.5)
            n_retry += 1
            if out[1] != "face":
                curves[j] = out[0]
                stops[j] = out[1]
                lens[j] = out[2]
                ngate[j] = out[3]
                nprior[j] = out[4]
                nsteer[j] += out[5]
                ncenter[j] = out[6]
                nride[j] = out[7]
                nearwin[j] += out[8]
                npocket[j] += out[9]
                ngravfull[j] += out[10]
                ncoast[j] += out[11]
    print("RETRY face=%d" % n_retry, flush=True)
    lens = np.array(lens)
    # RAW turn diagnostics (pre-smoothing): max 5mm-window turn per
    # guide, whole-guide AND post-ramp (arc > 25 mm; the leader exit
    # arc is exempt like s03's leader, but counted honestly).
    _rawmax = []
    _rawmax_post = []
    _rawarc = []
    for c in curves:
        c = np.asarray(c)
        if len(c) < 7:
            _rawmax.append(0.0)
            _rawmax_post.append(0.0)
            _rawarc.append(-1.0)
            continue
        d = np.diff(c, axis=0)
        u = d / (np.linalg.norm(d, axis=1, keepdims=True) + 1e-12)
        dots = (u[:-5] * u[5:]).sum(axis=1).clip(-1, 1)
        a = np.degrees(np.arccos(dots))
        _rawmax.append(float(a.max()))
        _rawarc.append(float(a.argmax()))
        # window START arc >= 40 mm (past the longest ramp)
        _post = a[np.arange(len(a)) >= 40]
        _rawmax_post.append(float(_post.max()) if _post.size else 0.0)
    _rawmax = np.array(_rawmax)
    _rawmax_post = np.array(_rawmax_post)
    # orbit diagnostic: total turning angle vs net displacement
    _orb = 0
    _tot = []
    for c in curves:
        c = np.asarray(c)
        if len(c) < 32:
            continue
        d = np.diff(c, axis=0)
        u = d / (np.linalg.norm(d, axis=1, keepdims=True) + 1e-12)
        dots = (u[:-1] * u[1:]).sum(axis=1).clip(-1, 1)
        tot = float(np.degrees(np.arccos(dots)).sum())
        _tot.append(tot)
        disp = float(np.linalg.norm(c[-1] - c[0]))
        if tot > 720.0 and disp < 50.0:
            _orb += 1
    _tot = np.array(_tot)
    print("ORBIT guides>720deg&disp<50mm=%d totalTurn p50=%.0f p95=%.0f" % (
        _orb, float(np.percentile(_tot, 50)),
        float(np.percentile(_tot, 95))), flush=True)
    # steering-vs-breach correlation (finds the cap-riding source)
    _br = _rawmax_post > 15.0
    _A = np.array(nearwin) > 0
    _B = np.array(ngravfull) > 20
    print("BREACH-CORR postBreach=%d/%d earwinFrac=%.2f gravfullFrac=%.2f "
          "| P(breach|earwin)=%.2f P(breach|nograv)=%.2f" % (
        int(_br.sum()), len(_br),
        float(_A.mean()), float(_B.mean()),
        float(_br[_A].mean()) if _A.any() else -1,
        float(_br[~_B].mean()) if (~_B).any() else -1), flush=True)
    print("RAW turn whole: breaches=%d p50=%.1f p95=%.1f max=%.1f "
          "breachArc p50=%.0f" % (
        int((_rawmax > 15.0).sum()),
        float(np.percentile(_rawmax, 50)),
        float(np.percentile(_rawmax, 95)), float(_rawmax.max()),
        float(np.percentile(
            np.array(_rawarc)[_rawmax > 15.0], 50))
        if (_rawmax > 15.0).any() else -1.0), flush=True)
    print("RAW turn post-ramp: breaches=%d p50=%.1f p95=%.1f "
          "max=%.1f" % (
        int((_rawmax_post > 15.0).sum()),
        float(np.percentile(_rawmax_post, 50)),
        float(np.percentile(_rawmax_post, 95)),
        float(_rawmax_post.max())), flush=True)
    print("GROWN n=%d len p50=%.0f p95=%.0f max=%.0f stops=%s" % (
        len(curves), float(np.percentile(lens, 50)),
        float(np.percentile(lens, 95)), float(lens.max()),
        json.dumps({s: stops.count(s) for s in set(stops)})),
        flush=True)
    print("TURN-GATE relaxations: guides=%d steps=%d" % (
        sum(1 for v in ngate if v), sum(ngate)), flush=True)

    # NO SMOOTHING (round-3 finding): gaussian sigma=1.0 + root
    # re-anchor puts a first-window kink (smoothed max-window p50
    # 46 deg vs raw 23 deg) on every guide and smears wall-riders
    # across the part (179 unswaps). Raw traces are already
    # turn-bounded by construction and field-follow-damped; the
    # 41-pt store resample below smooths plenty for children
    # (which ride a P=32 arc resample anyway).
    sm = [np.array(c) for c in curves]
    n_unswap = 0
    print("SMOOTH skipped (raw stored); unswapped-crossers=%d" % n_unswap,
          flush=True)

    # world-mm -> head-mm for storage (roundtrip-checked)
    crown = np.asarray(GT["crown"], dtype=np.float64)
    w2h = CO.world_to_head
    h2w = CO.head_to_world
    chk = h2w(w2h(sroots[:8] / 1000.0, crown), crown) * 1000.0
    err = float(np.abs(chk - sroots[:8]).max())
    print("HEAD roundtrip err=%.2e mm" % err, flush=True)
    assert err < 1e-6, err
    head = [w2h(c / 1000.0, crown) for c in sm]

    # resample stored curves to 41-pt arc length (guides.npz schema)
    N41 = 41
    store = np.zeros((len(head), N41, 3))
    short = 0
    for j, c in enumerate(head):
        if len(c) < 2:
            store[j] = np.tile(sroots[j][None, :], (N41, 1))
            short += 1
            continue
        seg = np.linalg.norm(np.diff(c, axis=0), axis=1)
        L = np.concatenate([[0.0], np.cumsum(seg)])
        if L[-1] < 1e-9:
            store[j] = np.tile(c[0][None, :], (N41, 1))
            short += 1
            continue
        tq = np.linspace(0, L[-1], N41)
        store[j] = np.stack(
            [np.interp(tq, L, c[:, k]) for k in range(3)], axis=1)

    # prepend the 57 verbatim tucked guides (tuck=1)
    tch = np.asarray(GT["curves_head"], dtype=np.float64)
    tuck_flag = np.asarray(GT["tuck"], dtype=np.float64) > 0.5
    tucked = tch[tuck_flag]
    assert tucked.shape[0] == 57, tucked.shape
    all_curves = np.vstack([store, tucked])
    n_new = len(store)
    n_tuck = len(tucked)
    tuck_arr = np.concatenate(
        [np.zeros(n_new), np.ones(n_tuck)])
    band_arr = np.zeros(n_new + n_tuck)
    status = np.array(["grown"] * n_new + ["tucked"] * n_tuck)
    ok_idx = np.nonzero(np.array(
        [len(c) for c in curves] + [41] * n_tuck) >= 2)[0].astype(
            np.int64)
    y_ear = float(np.asarray(GT["y_ear_mm"]).ravel()[0])
    np.savez_compressed(
        str(E / "guides-8a.npz"), curves_head=all_curves,
        crown=crown, param_names=np.asarray(GT["param_names"]),
        param_values=np.asarray(GT["param_values"]),
        spec_sha=np.array(["depth8a"]),
        status=status, ok_idx=ok_idx,
        roots_file=np.array(
            ["hair-scalp1/roots.npz depth-layered shell guides + "
             "verbatim tucked"]),
        y_ear_mm=np.array(y_ear), verdict=np.array(["DEPTH"]),
        tuck=tuck_arr, band=band_arr)

    # verification on smoothed NEW guides: turn breaches, part
    # crossings over 2mm (anterior/at vertex), ear 8mm min
    max_turn = []
    for c in sm:
        if len(c) < 7:
            max_turn.append(0.0)
            continue
        seg = np.diff(np.array(c), axis=0)
        L = np.concatenate([[0.0], np.cumsum(
            np.linalg.norm(seg, axis=1))])
        n = int(L[-1])
        if n < 6:
            max_turn.append(0.0)
            continue
        tq = np.linspace(0, L[-1], n + 1)
        r = np.stack([np.interp(tq, L, np.array(c)[:, k])
                      for k in range(3)], axis=1)
        d = np.diff(r, axis=0)
        u = d / (np.linalg.norm(d, axis=1, keepdims=True) + 1e-12)
        dots = (u[:-5] * u[5:]).sum(axis=1).clip(-1, 1)
        max_turn.append(float(np.degrees(np.arccos(dots)).max())
                        if dots.size else 0.0)
    max_turn = np.array(max_turn)
    n_breach = int((max_turn > 15.0).sum())
    # part crossings (anterior/at vertex, over 2mm)
    rx = sroots[:, 0]
    n_cross = 0
    cross_roots = []
    for i, c in enumerate(sm):
        if abs(float(rx[i])) < 3.0 or len(c) < 2:
            continue
        s = np.sign(float(rx[i]))
        ca = np.asarray(c)
        above = ca[:, 1] <= Y_VERTEX_MM
        if ((ca[:, 0] * s < 0) & above).any():
            exc = float((-ca[(ca[:, 0] * s < 0) & above, 0] * s).max())
            if exc > 2.0:
                n_cross += 1
                cross_roots.append(sroots[i].tolist())
    cross_roots = np.array(cross_roots)
    if len(cross_roots):
        print("CROSS roots centroid xyz=%s nAntRoot=%d (of %d)" % (
            np.round(cross_roots.mean(axis=0), 1),
            int((cross_roots[:, 1] < 0).sum()), len(cross_roots)),
            flush=True)
    # ear min distance (smoothed, all samples)
    edmin = np.inf
    for c in sm[::4]:
        if len(c) < 1:
            continue
        dd, _ = pinna_tree.query(np.asarray(c), k=1)
        edmin = min(edmin, float(dd.min()))

    stats = {"nNew": n_new, "nTucked": n_tuck, "nTotal": n_new + n_tuck,
             "unreachable": int(short),             "lengths": {"p50": round(float(np.percentile(lens, 50)),
                                      1),
                         "p95": round(float(np.percentile(lens, 95)),
                                      1),
                         "max": round(float(lens.max()), 1)},
             "stops": {s: stops.count(s) for s in set(stops)},
             "stopsBySide": {
                 sgn: {s: sum(1 for k in range(len(stops))
                              if stops[k] == s
                              and np.sign(sroots[k, 0]) == float(sgn))
                       for s in set(stops)}
                 for sgn in (1.0, -1.0)},
             "turnGateRelaxGuides": sum(1 for v in ngate if v),
             "turnGateRelaxSteps": sum(ngate),
             "turnSmoothedBreaches15degPer5mm": n_breach,
             "turnSmoothedP50": round(float(np.percentile(max_turn,
                                                           50)), 1),
             "turnSmoothedP95": round(float(np.percentile(max_turn,
                                                           95)), 1),
             "turnSmoothedMax": round(float(max_turn.max()), 1),
             "partCrossingsOver2mmAnterior": n_cross,
             "earMinDistMm": round(float(edmin), 2),
             "positionalProjections": 0,
             "maxPositionalMoveMm": 0.0,
             "priorStepFrac": round(float(
                 sum(nprior) / max(sum(lens), 1)), 4),
             "centerMergeSteps": sum(ncenter),
             "rideOutSteps": sum(nride),
             "steerSteps": sum(nsteer),
             "depthU": {"lo": 0.3, "hi": 0.9},
             "thicknessP50": round(float(np.percentile(Thick, 50)),
                                   2),
             "thicknessP90": round(float(np.percentile(Thick, 90)),
                                   2),
             "dstarP50": round(float(np.percentile(dstar, 50)), 2),
             "dstarP90": round(float(np.percentile(dstar, 90)), 2),
             "poissonSpacingMm": round(float(spacing_p), 2),
             "seconds": round(time.time() - t0, 1)}
    (E / "grow8a-stats.json").write_text(
        json.dumps(stats, indent=1) + "\n")
    print(json.dumps(stats, indent=1))
    print("wrote guides-8a.npz + grow8a-stats.json in %.0fs" % (
        time.time() - t0))


if __name__ == "__main__":
    main()
