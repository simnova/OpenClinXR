#!/usr/bin/env python3
"""STEP 3: grow guides as streamlines through the orientation field.

Roots: greedy Poisson subset of scalp1 roots (crown-first z order,
adaptive spacing to land 300-500; both sides; deterministic, no RNG).

Integration: RK2 midpoint, 1 mm steps. dir(p) = trilinear field sample
(sign-aligned to travel); where the field is undefined (root leaders
cross air outside the dilated hull) fall back to the s02 prior of the
owning root (lateral-away scalp tangent -> gravity over 15-45 mm drop).

Constraints: beyond the first 8 mm leader (route accept precedent:
leader exempt from hull, exact-SDF > -1 mm) stay inside the dilated
hull (trilinear occupancy > 0.5) and exact-SDF >= 2 mm. Violations are
projected along the constraint gradient (counts + magnitudes reported);
persistent violation stops the guide ('stuck').

Stop: next step leaves the hull at its lower boundary ('hem': outside
eroded interior at z <= hemLocal + 2 mm), or arc length exceeds a
generous cap ('maxlen': per-root (root_z - globalHem) + 100 mm, so the
hem/silhouette exit terminates first wherever the hull reaches).

groom2 changes (stated): the centre-part wall applies only anterior of /
at the vertex (world y <= 34.2 mm, the measured target part end; below
it the back drape merges); silhouette masks dilated 5 -> 12 px, no
x-mirrored 3q/profile test, plus a bounded drape override (down-steps in
the drape zone instead of silhouette stops); per-view silhouette trigger
counters + above/below-vertex part tallies in grow-stats.json.

Smooth: one Gaussian sigma=1.0 mm pass, root re-anchored (stated).

Gates (measure.py copies of route2 rules): part crossings (0), ear
clearance (3 mm + occlusion), back-centre gap, max turn per 5 mm.
Output E/grown.npz + E/grow-stats.json.
"""

from __future__ import annotations

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
import measure as ME  # noqa: E402

STEP = 1.0
SDF_CLEAR = 2.0
LEADER = 8.0

# groom2: centre part restricted to the scalp curve front hairline ->
# vertex. Vertex measured on the aisha-v3 target back beauty: the visible
# part (bright midline vs dark hair, >70 grey-level diff) merges at back
# row ~240 (diff <=4 grey levels there); posterior midline scalp roots
# projecting to rows 236-244 (n=12, all y>0 world) have median world
# (x +1.2, y +34.2, z 1601.4) mm. RULE: the part side-wall (and the
# same-side blending in children.py) applies only anterior of / at the
# vertex (world y <= Y_VERTEX_MM); posterior of it (the back drape below
# the vertex) grows and blends with no side restriction, so left/right
# merge into one sheet. Anterior face-framing guides (y<0 all the way
# down) stay restricted, and the face-air corridor still guards the face.
Y_VERTEX_MM = 34.2
# groom2: silhouette wall went from policing to pinching. groom1: 198
# 'silhouette' + 217 'maxlen' stops, back miss p95 80 px / IoU 0.64, while
# the hull5 projection already spans the target mask per-row within ~3 px
# (so the domain reaches the target; the wall stops guides early). Fixes:
# (a) dilate the policing masks 5 -> 12 px (hull rind is 4 mm ~= 8 px at
# ~2 px/mm, tube 3 mm ~= 6 px; 5 px strands guides inside the hull rind
# against the wall); (b) drop the x-mirrored 3q/profile test (it polices
# a guide against the opposite side's pixels and pinches width; L/R
# balance stays via symmetric Poisson roots + symmetric field; verified
# post-hoc); (c) drape override: a silhouette-only rejection while
# heading down in the drape zone (below the ear top, inside hull+SDF)
# steps straight down instead of stopping, so guides continue to the
# hull's lower boundary where the target shows hair (counted).
MASK_DILATE_PX = 12
MIRROR_TEST = False
MAX_SIL_OVERRIDE = 60
# groom2 below-vertex centre merge: below the vertex there is no part,
# yet field-following keeps left guides left and right guides right all
# the way to the hem (groom2 hem tips bimodal p25/p75 -82/+82 mm, only
# 7/423 within 6 mm of midline -> 15-33 px bald hem seam with shirt
# showing). A weak proportional centre pull on posterior tips below the
# vertex (spring to the midline, back sector only, while heading down)
# merges the drape into one sheet. Proportional: strong at the sides,
# negligible near the centre (spread preserved, no rope); sides
# (|x|>=80) and all anterior growth untouched. The pull starts exactly
# at the vertex (a 15 mm anterior lead was tried and reverted: it herds
# walled guides into the wall).
CENTER_K = 0.003
CENTER_XBAND = 80.0
CENTER_LEAD_MM = 15.0


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
    CO.track(S10 / "s03_grow.py")
    CO.track(S10 / "measure.py")
    inp = CO.load_all()
    F = np.load(str(CO.E0 / "field.npz"))
    P2 = np.load(str(CO.track(
        CO.ROOT / "tools/openclinxr/evidence/hair-route2/paths.npz")))
    y_ear = float(np.asarray(P2["y_ear_mm"]).ravel()[0])

    hull = inp["hull"]
    xs = np.array(hull["xs"])
    ys = np.array(hull["ys"])
    zs = np.array(hull["zs"])
    spacing = float(hull["spacing"])
    occ = np.array(hull["occupancy"], dtype=bool)
    shape = occ.shape
    origin = np.array([xs[0], ys[0], zs[0]])
    dil = ndimage.binary_dilation(occ, iterations=2)  # 4 mm, s02 rule

    idx = np.array(F["idx"])
    tdir = np.array(F["dir"], dtype=np.float32)
    dense = np.zeros(shape + (3,), dtype=np.float32)
    dense[idx[:, 0], idx[:, 1], idx[:, 2]] = tdir
    occf = dil.astype(np.float32)
    D = ndimage.distance_transform_edt(dil).astype(np.float32) * 2.0
    Docc = ndimage.distance_transform_edt(~occ).astype(np.float32) * 2.0
    gD = [np.gradient(D, 2.0, axis=i) for i in range(3)]
    gDocc = [np.gradient(Docc, 2.0, axis=i) for i in range(3)]
    pinna_all = np.vstack([np.asarray(inp["pinna"]["xpos"]),
                           np.asarray(inp["pinna"]["xneg"])])
    pinna_tree = cKDTree(pinna_all)
    egrid = inp["egrid"]
    sdf = np.asarray(egrid["sdf"], dtype=np.float32)
    sorigin = np.asarray(egrid["origin"], dtype=np.float64)
    sspacing = float(np.asarray(egrid["spacing"]).ravel()[0])
    assert sdf.shape == (261, 211, 321), sdf.shape
    _sdfsam = tri_sampler(sdf, sorigin, sspacing)
    # Eroded interior (route erosion rule: hull distance >= 3 mm
    # and exact-SDF >= 2 mm per the card): the post-entry domain.
    # Strict (rind excluded): rind-riding guides spill outside
    # view silhouettes and chatter against inward steering.
    gw = np.stack(np.meshgrid(xs, ys, zs, indexing="ij"), axis=-1)
    sdf_h = _sdfsam(gw.reshape(-1, 3), order=1)
    sdf_h = np.where(np.isfinite(sdf_h), sdf_h, -1e3).reshape(
        occ.shape)
    EIN = (D >= 3.0) & (sdf_h >= 2.0)
    # ear keep-out: carve EIN within 4.5 mm of any pinna vert, so
    # post-entry guides clear the 3 mm gate with margin (the hull3
    # carve floor itself is 2.17 mm).
    gw = np.stack(np.meshgrid(xs, ys, zs, indexing="ij"), axis=-1)
    dpin, _ = cKDTree(pinna_all).query(gw.reshape(-1, 3), k=1)
    dpin = dpin.reshape(occ.shape)
    EIN = EIN & (dpin >= 4.5)
    del gw, sdf_h, dpin
    print("EIN vox=%d (occ %d dil %d)" % (int(EIN.sum()),
                                          int(occ.sum()), int(dil.sum())),
          flush=True)
    DE = ndimage.distance_transform_edt(~EIN).astype(np.float32) * 2.0
    gDE = [np.gradient(DE, 2.0, axis=i) for i in range(3)]
    # face-air corridor guard: menton from the station frame.
    menton_mm = np.array(inp["menton"], dtype=np.float64) * 1000.0
    FACE_Z0 = float(menton_mm[2]) - 40.0
    FACE_X = 60.0
    EAR_Y = float(np.median(pinna_all[:, 1]))
    EAR_TOP = float(pinna_all[:, 2].max())
    print("EAR yMed=%.0f top=%.0f nPinna=%d" % (EAR_Y, EAR_TOP,
                                                len(pinna_all)),
          flush=True)

    gsdf = [np.gradient(sdf, sspacing, axis=i).astype(np.float32)
            for i in range(3)]

    s_dir = [tri_sampler(dense[..., i], origin, spacing) for i in range(3)]
    s_occ = tri_sampler(occf, origin, spacing)  # dilated hull: domain
    s_EIN = tri_sampler(EIN.astype(np.float32), origin,
                        spacing)  # eroded interior: entry + domain
    s_D = tri_sampler(D, origin, spacing)
    s_gDE = [tri_sampler(g, origin, spacing) for g in gDE]
    s_gD = [tri_sampler(g, origin, spacing) for g in gD]
    s_sdf = tri_sampler(sdf, sorigin, sspacing)
    s_gsdf = [tri_sampler(g, sorigin, sspacing) for g in gsdf]

    # inline pinhole projectors (avoid per-call mat inv).
    _cams = inp["cams"]["views"]
    _proj = {}
    for _v in CO.VIEWS4:
        _m = np.array(_cams[_v]["matrixWorld"], dtype=np.float64)
        _inv = np.linalg.inv(_m)
        _f = float(_cams[_v]["lensMm"]) / float(inp["sensor"]) * 1024.0
        _proj[_v] = (_inv, _f)
    _masks = {}
    _bdepth = {}
    for v in CO.VIEWS4:
        _m = np.array(inp["masks"][v], dtype=bool)
        # groom2: 12 px (was 5). The growth domain is the 4 mm-dilated
        # hull (~8 px at ~2 px/mm) and guide tubes are 3 mm (~6 px), so a
        # 5 px wall strands guides that are still inside the hull rind
        # against the silhouette and stops them early (groom1: 198
        # silhouette stops, back miss p95 80 px while hull5 already spans
        # the target per-row within ~3 px).
        _masks[v] = ndimage.binary_dilation(_m,
                                            iterations=MASK_DILATE_PX)
        _bdepth[v] = np.array(inp["body"][v]["depth"],
                              dtype=np.float64)

    # groom2 diagnostic: which views fire the silhouette wall (the
    # rejected step's triggering views; groom1 never recorded this).
    sil_triggers = {v: 0 for v in CO.VIEWS4}
    sil_overrides = [0]

    def mask_outside_which(pm):
        """Set of views where pm is VISIBLE yet outside the mask.

        Occlusion-aware (a point hidden behind the body is not
        outside). Visible = depth < body depth - 0.5 mm (cage margin).
        groom2: no x-mirrored test (it polices a guide against the
        opposite side's pixels and pinches width; L/R balance stays via
        symmetric Poisson roots + symmetric field). (A central-band
        front/back-only view-ownership for the posterior midline was
        tried and reverted: inert on stops, and the void is a flow
        hole, not a wall artefact.)
        """
        ph = np.array([pm[0] / 1000.0, pm[1] / 1000.0,
                       pm[2] / 1000.0, 1.0])
        out = set()
        for _v in CO.VIEWS4:
            _inv, _f = _proj[_v]
            _pts = (ph, np.array([-ph[0], ph[1], ph[2], 1.0])) \
                if (MIRROR_TEST and _v not in ("front", "back")) \
                else (ph,)
            for _p in _pts:
                _lc = _inv @ _p
                _dep = -_lc[2]
                if _dep <= 0:
                    out.add(_v)
                    continue
                _c = 512.0 + (_lc[0] / _dep) * _f
                _r = 512.0 - (_lc[1] / _dep) * _f
                if not (0 <= _c < 1024 and 0 <= _r < 1024):
                    out.add(_v)
                    continue
                _ci, _ri = int(_c), int(_r)
                if _dep < _bdepth[_v][_ri, _ci] - 0.0005:
                    if not _masks[_v][_ri, _ci]:
                        out.add(_v)
        return out

    def mask_outside(pm):
        return bool(mask_outside_which(pm))

    def part_active(root, q):
        """groom2: part wall only anterior of / at the vertex.

        Tip-based: any guide whose tip is posterior of the vertex
        (world y > Y_VERTEX_MM, the back drape below the visible part
        end) grows with no side restriction so both sides merge; any
        tip at / anterior of the vertex is walled, including guides
        rooted at the nape that wander back up. (A root-based rule let
        nape-rooted guides cross freely and re-enter the cap on the
        wrong side: measured 2 such guides, 40-48 mm excursions.)
        """
        return float(q[1]) <= Y_VERTEX_MM

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

    def prior_of(root, nroot, p):
        # groom2: nape roots (posterior of the vertex) own the centre
        # sheet below the part end: straight-down prior, no lateral
        # part-away side (the side label is meaningless there and flung
        # midline-nape guides out to +-20..100 mm at the hem). Same for
        # the adaptive midline strip (|x| < 12 mm, y > -60 mm): no side
        # to inherit at the part line itself.
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

    def grad_of(samplers, p):
        g = np.array([s(p[None, :], order=1)[0] for s in samplers])
        n = np.linalg.norm(g)
        if not np.isfinite(n) or n < 1e-9:
            return None
        return g / n

    # ---- Poisson roots (crown-first, adaptive spacing 300-500).
    roots_mm = np.array(inp["roots"]["xyz"],
                        dtype=np.float64) * 1000.0
    rnorm = np.array(inp["roots"]["normal"], dtype=np.float64)
    rnorm /= np.linalg.norm(rnorm, axis=1, keepdims=True) + 1e-12
    # Sideburn/ear-fringe roots inside the 8 mm pinna keep-out can
    # never clear the ear gate (their root sample alone violates
    # it, and the keep-out forbids their neighbourhood); excluded
    # from the candidate pool (counted). Likewise roots whose root
    # sample covers the pinna in any view projection (front /
    # three_quarter / profile_90): the gate counts every sample
    # including the root, so these seeds cannot pass either.
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
        _, _ji = _t2.query(np.stack([_cc[_in], _rr[_in]], axis=1),
                           k=1)
        _cov = _dd[_in] < _pdep[_ji] - 0.003
        root_cover[_ii[_cov]] = True
    print("ROOTS total=%d pinnaExcluded8mm=%d rootCoverExcluded=%d" % (
        len(roots_mm), int((~cand8).sum()),
        int((cand8 & root_cover).sum())), flush=True)
    cand = np.nonzero(cand8 & ~root_cover)[0]
    order = np.argsort(-roots_mm[cand, 2], kind="stable")
    order = np.asarray(cand)[order]
    spacing_p = 8.0
    sel = None
    # NOTE (groom2): 800-1000 dense backbones were tried and reverted:
    # hem exits fell 139 -> 35 absolute (fringe-root composition: the
    # denser Poisson admits lower/temple/nape roots whose guides
    # maxlen/silhouette instead of draping), and the strand render went
    # bare at crown and hem. 300-500 as groom1.
    for _ in range(30):
        acc = []
        acc_xyz = np.zeros((0, 3))
        tree = None
        for i in order:
            p = roots_mm[i]
            if len(acc) == 0:
                acc.append(int(i))
                acc_xyz = p[None, :]
                tree = cKDTree(acc_xyz)
                continue
            d, _ = tree.query(p, k=1)
            if d >= spacing_p:
                tree = None
                acc.append(int(i))
                acc_xyz = np.vstack([acc_xyz, p[None, :]])
                tree = cKDTree(acc_xyz)
        sel = np.array(acc, dtype=np.int64)
        if len(sel) < 300:
            spacing_p *= 0.92
        elif len(sel) > 500:
            spacing_p *= 1.08
        else:
            break
    sel = np.array(sel, dtype=np.int64)
    # groom2 adaptive transition seeding: the vertex-transition flow
    # void (back rows ~277-286 over the occiput bump at world
    # (0, 39, 1581) mm) is a FLOW hole, not sampling -- denser Poisson
    # (tried, reverted) cannot fill it because no streamline goes
    # there. Extra guides are seeded from the unused scalp1 pool along
    # the whole midline strip (|x| < 10 mm, -60 <= y <= 34 mm, same
    # pinna/root-cover exclusions), grown by the identical integrator
    # with a straight-down prior (no part side to inherit at the part
    # line itself): they dive over the bump centrally and they densify
    # the crown part backbones (the +-2 mm wall spreads neighbours
    # apart, leaving the rendered part wider than the target's).
    # Reported as nAdapt.
    _used = set(int(v) for v in sel)
    _pool = [i for i in order if int(i) not in _used]
    _adapt = []
    for i in _pool:
        _p = roots_mm[int(i)]
        if abs(float(_p[0])) < 10.0 and -60.0 <= float(_p[1]) <= 34.0:
            _adapt.append(int(i))
            if len(_adapt) >= 90:
                break
    sel = np.array(list(sel) + _adapt, dtype=np.int64)
    sroots = roots_mm[sel]
    sside = np.where(sroots[:, 0] >= 0, 1, -1)
    print("POISSON n=%d spacing=%.2f L=%d R=%d ADAPT=%d" % (
        len(sel), spacing_p, int((sside < 0).sum()),
        int((sside > 0).sum()), len(_adapt)), flush=True)

    # ---- per-root local hem extent.
    dxy = dil.astype(np.float32)
    hem_tree = cKDTree(idx[:, :2].astype(np.float64) * spacing)
    hems = np.zeros(len(sel))
    for j, r in enumerate(sroots):
        ii = np.array([[(r[0] - xs[0]) / spacing,
                        (r[1] - ys[0]) / spacing]])
        dd, jj = hem_tree.query(ii, k=400)
        cand = idx[jj[0][dd[0] * spacing <= 25.0]]
        hems[j] = zs[cand[:, 2]].min() if len(cand) else zs.min()
    maxlens = np.clip(sroots[:, 2] - float(zs.min()) + 100.0, 60.0,
                      600.0)

    # ---- integrate (per-guide function; two passes: base, then
    # retry of 'face' casualties with stronger curtain bias --
    # route2 retry precedent, stated).
    def grow_guide(j, root, bias_face, bias_tuck):
        nroot = rnorm[sel[j]]
        d0 = field_dir(root, prior_of(root, nroot, root))
        travel = prior_of(root, nroot, root) if d0 is None else d0
        if (travel * prior_of(root, nroot, root)).sum() < 0:
            travel = -travel
        pts = [root.copy()]
        p = root.copy()
        arc = 0.0
        npr = 0
        pmag = 0.0
        npr_step = 0
        nfield_step = 0
        nst_tot = 0
        n_override = [0]  # groom2 drape-override steps (bounded)
        n_center = [0]  # groom2 below-vertex centre-merge steps
        n_apex = [0]  # groom2 apex central slides
        n_ride = [0]  # groom2 transition ride-out steps
        n_clamp = [0]  # groom2 vertex re-entry clamps (bounded)
        entered = bool(float(s_EIN(p[None, :], order=1)[0]) > 0.5)
        stop = "maxlen"
        maxlen = float(maxlens[j])
        hem = float(hems[j])
        for _ in range(600):
            d_mid = field_dir(p, travel)
            used_prior = False
            if d_mid is None:
                d_mid = prior_of(root, nroot, p)
                used_prior = True
                if (d_mid * travel).sum() < 0:
                    d_mid = -d_mid
            else:
                nfield_step += 1
            pm = p + d_mid * (STEP / 2)
            d1 = field_dir(pm, d_mid)
            if d1 is None:
                d1 = prior_of(root, nroot, pm)
                used_prior = True
                if (d1 * d_mid).sum() < 0:
                    d1 = -d1
            else:
                nfield_step += 1
            npr_step += 1 if used_prior else 0
            # steering (stated; field stays primary): gravity bias
            # 0.2 (breaks crown orbital circulation); pre-entry
            # attract 0.8 toward the eroded interior; post-entry
            # inward bias below D=2.5 mm; ear approach pre-route
            # (+y posterior 0.6) + near-ear deflect; part/face
            # handled below as direction strips (no opposing
            # pushes, no positional jumps).
            nsteer = 0
            # drop+arc hybrid gravity: gentle at the scalp (lay),
            # dominant after ~35 mm drop OR ~75 mm arc (drape).
            # Drop alone never engages orbiting guides (they
            # accumulate arc without dropping); arc alone would
            # cut the lay short. The max of the two releases
            # sustained horizontal circulation either way.
            _drop = float(root[2] - pm[2])
            _eff = max((_drop - 5.0) / 30.0, (arc - 45.0) / 30.0)
            _eff = float(0.5 - 0.5 * np.cos(
                np.clip(_eff, 0, 1) * np.pi))
            _gb = 0.15 + 0.9 * _eff
            d1 = d1 + _gb * np.array([0.0, 0.0, -1.0])
            d1 /= np.linalg.norm(d1) + 1e-12
            if not entered:
                g = grad_of(s_gDE, pm)
                if g is not None:
                    d1 = d1 - 0.8 * g
                    d1 /= np.linalg.norm(d1) + 1e-12
                    nsteer += 1
            else:
                Dv = float(s_D(pm[None, :], order=1)[0])
                if np.isfinite(Dv) and Dv < 2.5:
                    g = grad_of(s_gD, pm)
                    if g is not None:
                        d1 = d1 + ((2.5 - Dv) / 2.5) * 0.6 * g
                        d1 /= np.linalg.norm(d1) + 1e-12
                        nsteer += 1
                if mask_outside(pm):
                    # outside some view's silhouette: strip motion
                    # carrying further out + gentle inward nudge
                    # (an opposing pull would reverse the guide).
                    g = grad_of(s_gD, pm)
                    if g is not None:
                        n_out = -g
                        if (d1 * n_out).sum() > 0:
                            d1 = d1 - (d1 * n_out).sum() * n_out
                            d1 /= np.linalg.norm(d1) + 1e-12
                        d1 = d1 + 0.5 * g
                        d1 /= np.linalg.norm(d1) + 1e-12
                        nsteer += 1
            ed, ei = pinna_tree.query(pm, k=1)
            if abs(pm[0]) > 40.0 and pm[2] < EAR_TOP + 40.0 \
                    and pm[2] > EAR_TOP - 70.0 \
                    and pm[1] > EAR_Y - 60.0 and pm[1] < EAR_Y + 25.0:
                d1 = d1 + 1.0 * np.array([0.0, 1.0, 0.0])
                d1 /= np.linalg.norm(d1) + 1e-12
                nsteer += 1
            if ed < 25.0 and (pm - pinna_all[ei])[1] < -5.0:
                # anterior of the ear: swing behind (+y posterior).
                d1 = d1 + 1.2 * np.array([0.0, 1.0, 0.0])
                d1 /= np.linalg.norm(d1) + 1e-12
                nsteer += 1
            if ed < 30.0:
                # tuck into the medial-posterior pocket (tucked
                # style: hair passes between ear and head, behind
                # the pinna, not lateral/anterior of it).
                med = -np.sign(pm[0]) if pm[0] != 0 else 1.0
                tuck = np.array([1.5 * med, 1.5, 0.0])
                d1 = d1 + ((30.0 - ed) / 30.0) * tuck
                d1 /= np.linalg.norm(d1) + 1e-12
                nsteer += 1
            if ed < 30.0 and (pm - pinna_all[ei])[1] < -3.0 \
                    and d1[1] < 0:
                # anterior of the pinna: no anterior advance
                # (hard wall against covering the ear).
                d1[1] = 0.0
                d1 /= np.linalg.norm(d1) + 1e-12
                nsteer += 1
            if abs(pm[0]) > 45.0 and abs(pm[0]) < 85.0 \
                    and pm[1] > -95.0 and pm[1] < -25.0 \
                    and pm[2] > 1485.0 and pm[2] < 1565.0:
                # sideburn transit: tuck posterior-down (the tucked
                # style combs this band back behind the ear; the
                # 2D field cannot supply a growth initial here).
                post = np.array([0.0, 0.7, -0.7])
                post /= np.linalg.norm(post)
                d1 = d1 + bias_tuck * post
                d1 /= np.linalg.norm(d1) + 1e-12
                nsteer += 1
            if ed < 12.0:
                away = pm - pinna_all[ei]
                al = np.linalg.norm(away)
                if al > 1e-9:
                    blend = away / al + np.array([0.0, 1.0, 0.0])
                    bl = np.linalg.norm(blend)
                    if bl > 1e-9:
                        d1 = d1 + ((15.0 - ed) / 15.0) * 1.5 \
                            * blend / bl
                        d1 /= np.linalg.norm(d1) + 1e-12
                        nsteer += 1
            if pm[1] > Y_VERTEX_MM \
                    and abs(pm[0]) < CENTER_XBAND \
                    and d1[2] < 0.0:
                # groom2 below-vertex centre merge (stated above):
                # deadband +-6 mm (a filled centre band, not a rope),
                # proportional pull of the excess. Guides outside the
                # band keep the side mass; anterior growth untouched.
                # (A 15 mm lead of the pull ahead of the vertex was
                # tried: it herds walled guides into the wall -->
                # silhouette 129->172, hem exits 51->3. Reverted.)
                _ex = abs(float(pm[0])) - 6.0
                if _ex > 0:
                    d1[0] = d1[0] - CENTER_K * _ex * np.sign(pm[0])
                    d1 /= np.linalg.norm(d1) + 1e-12
                    nsteer += 1
                    n_center[0] += 1
            if 20.0 < float(pm[1]) < 70.0 \
                    and 1450.0 < float(pm[2]) < 1620.0 \
                    and abs(float(pm[0])) < 40.0:
                # groom2 transition ride-out: guides descending from the
                # crown at y < ~40 stay anterior of the occiput/neck
                # surface and are hidden behind it in the back view
                # (measured: backbones pass within 1.3 mm 3D of the
                # void patch yet occluded) because no term drives +y:
                # the back view cannot observe depth, and side-view
                # data is weak there. A mild posterior drive in the
                # transition window rides the drape out onto the visible
                # posterior surface (same direction family as the
                # ear-approach pre-route). Counted.
                d1 = d1 + 0.5 * np.array([0.0, 1.0, 0.0])
                d1 /= np.linalg.norm(d1) + 1e-12
                nsteer += 1
                n_ride[0] += 1
            if ed < 4.0:
                away = pm - pinna_all[ei]
                al = np.linalg.norm(away)
                if al > 1e-9:
                    rhat = away / al
                    inward = (d1 * rhat).sum()
                    if inward < 0:
                        d1 = d1 - inward * rhat
                        d1 /= np.linalg.norm(d1) + 1e-12
                        nsteer += 1
            nst_tot += nsteer
            q = p + d1 * STEP
            # lookahead funnel: if 6 mm ahead exits the silhouette
            # while q is inside, steer inward NOW (gentle early
            # funnel follows the narrowing tucked silhouette down
            # to the hem instead of stopping at its sides).
            if entered and not mask_outside(q) and mask_outside(
                    p + d1 * 6.0):
                g = grad_of(s_gD, pm)
                if g is not None:
                    d1 = d1 + 1.5 * g
                    d1 /= np.linalg.norm(d1) + 1e-12
                    q = p + d1 * STEP
                    nsteer += 1
                    nst_tot += 1
            # ear hard keep-out 8 mm (grazing projection contacts
            # persist at 5 mm; steering alone compromises).
            edq, eiq = pinna_tree.query(q, k=1)
            if edq < 8.0:
                away = q - pinna_all[eiq]
                al = np.linalg.norm(away)
                if al > 1e-9:
                    rhat = away / al
                    inw = (d1 * rhat).sum()
                    if inw < 0:
                        d1 = d1 - inw * rhat
                        d1 /= np.linalg.norm(d1) + 1e-12
                        q = p + d1 * STEP
                        nsteer += 1
                    edq2, _ = pinna_tree.query(q, k=1)
                    if edq2 < 8.0:
                        push = min(8.0 - edq2, 1.0)
                        q = q + rhat * push
                        npr += 1
                        pmag += push
            # centre-part wall (|root_x| >= 3 mm, 2 mm tolerance):
            # strip the crossing motion, ease back <= 0.5 mm. groom2:
            # only anterior of / at the vertex (part_active); below the
            # vertex (back drape) no side restriction so the sheet
            # merges.
            rx0 = float(root[0])
            wall_on = part_active(root, q)
            if abs(rx0) >= 3.0 and wall_on and q[0] * rx0 < 0 \
                    and abs(q[0]) > 2.0:
                if d1[0] * rx0 < 0:
                    d1[0] = 0.0
                    d1 /= np.linalg.norm(d1) + 1e-12
                    q = p + d1 * STEP
                if q[0] * rx0 < 0 and abs(q[0]) > 2.0:
                    back = min(abs(q[0]) - 2.0, 0.5) * np.sign(rx0)
                    q[0] = q[0] + back
                    pmag += abs(float(back))
                    npr += 1
            # groom2 state clamp: a guide that crossed below the vertex
            # (allowed) and re-enters anterior of the vertex on the
            # wrong side is pinned to the wall (the transition strip
            # above cannot act on travel parallel to the wall).
            # Positional but bounded to the 2 mm wall, counted.
            if abs(rx0) >= 3.0 and wall_on and q[0] * rx0 < 0 \
                    and abs(q[0]) > 2.0:
                move = abs(float(q[0])) - 2.0
                q[0] = 2.0 * np.sign(rx0)
                pmag += move
                npr += 1
                n_clamp[0] += 1
            # face-air corridor: anterior half only (y < 0; the
            # face is anterior). Posterior guides (back drape) must
            # converge centrally, so they skip these strips.
            # Strip centre-ward AND forward motion in the margin,
            # bias curtain-ward; deep inside -> 'face' stop.
            if q[1] < 0.0 and abs(q[0]) < FACE_X + 10.0 \
                    and q[2] > FACE_Z0 and \
                    float(s_sdf(q[None, :], order=1)[0]) > 5.0:
                sgn = np.sign(rx0) if abs(rx0) >= 3.0 else (
                    np.sign(q[0]) if q[0] != 0 else 1.0)
                if d1[0] * sgn < 0:
                    d1[0] = 0.0
                if d1[1] < 0:
                    d1[1] = 0.0
                d1 = d1 + bias_face * np.array([sgn, 0.0, 0.0])
                d1 /= np.linalg.norm(d1) + 1e-12
                q = p + d1 * STEP
                nsteer += 1
                if abs(q[0]) < FACE_X and q[2] > FACE_Z0 and \
                        float(s_sdf(q[None, :], order=1)[0]) > 8.0:
                    stop = "face"
                    break
            if not entered:
                # leader transit: hull containment starts at first
                # eroded-interior entry. Only the head veto applies.
                # The centre-part wall applies here too (groom2: only
                # anterior of / at the vertex).
                if abs(rx0) >= 3.0 and part_active(root, q) \
                        and q[0] * rx0 < 0 \
                        and abs(q[0]) > 2.0 and d1[0] * rx0 < 0:
                    d1[0] = 0.0
                    d1 /= np.linalg.norm(d1) + 1e-12
                    q = p + d1 * STEP
                    nsteer += 1
                if float(s_sdf(q[None, :], order=1)[0]) <= -1.0:
                    stop = "stuck"
                    break
                if float(s_EIN(q[None, :], order=1)[0]) > 0.5:
                    entered = True
                elif arc > 60.0:
                    stop = "noentry"
                    break
            else:
                Dq = float(s_D(q[None, :], order=1)[0])
                Sq = float(s_sdf(q[None, :], order=1)[0])
                if q[2] <= hem + 2.0 and (Dq < 3.0 or Sq < SDF_CLEAR):
                    stop = "hem"
                    break
                v_sdf = Sq < SDF_CLEAR
                v_hull = Dq < 3.0
                trig = mask_outside_which(q)
                v_sil = (not v_sdf and not v_hull) and bool(trig)
                if v_sil:
                    for _tv in trig:
                        sil_triggers[_tv] += 1
                if v_sdf or v_hull or v_sil:
                    # slide: strip the wall-normal part of travel.
                    # A visible-outside-silhouette step is a wall too
                    # (guides stay inside the visual hull); if no
                    # slide direction stays inside, the guide stops
                    # ('silhouette').
                    ds = d1.copy()
                    if v_sdf:
                        g = grad_of(s_gsdf, q)
                        if g is not None:
                            ds = ds - (ds * g).sum() * g
                    if v_hull or v_sil:
                        g = grad_of(s_gD, q)
                        if g is not None:
                            n_out = -g
                            ds = ds - (ds * n_out).sum() * n_out
                    nn = np.linalg.norm(ds)
                    slid = False
                    if nn > 1e-6:
                        # try full tangential, tangential+inward,
                        # half tangential, in order -- except over the
                        # occiput apex (below the vertex, z > 1540):
                        # there the SDF slide sheds strands sideways off
                        # the midline (measured 14-35 px tube void at
                        # back rows 235-321), so every candidate is
                        # evaluated and the most central valid one wins.
                        # Below the apex (neck drape) first-valid is
                        # kept: central preference there herded guides
                        # into the neck column (hem exits 139 -> 16).
                        # (A gravity lay-flat over the apex was tried
                        # and reverted: guides arc over and leave the
                        # surface rays bare.)
                        apex = float(p[1]) > Y_VERTEX_MM \
                            and float(p[2]) > 1540.0
                        gi = grad_of(s_gD, p)
                        cand_ds = [ds / nn]
                        if gi is not None:
                            v = ds / nn + 0.5 * gi
                            if np.linalg.norm(v) > 1e-6:
                                cand_ds.append(v / np.linalg.norm(v))
                        best = None
                        for cd in cand_ds:
                            for frac in (1.0, 0.5):
                                q2 = p + cd * STEP * frac
                                # slide must respect the part wall too
                                # (groom2: only anterior of / at vertex).
                                if abs(rx0) >= 3.0 \
                                        and part_active(root, q2) \
                                        and q2[0] * rx0 < 0 \
                                        and abs(q2[0]) > 2.0:
                                    continue
                                if float(s_D(q2[None, :],
                                             order=1)[0]) >= 3.0 \
                                        and float(s_sdf(
                                            q2[None, :],
                                            order=1)[0]) >= SDF_CLEAR \
                                        and not mask_outside(q2):
                                    if not apex:
                                        pmag += float(np.linalg.norm(q2 - q))
                                        npr += 1
                                        q = q2
                                        d1 = cd
                                        slid = True
                                        break
                                    key = abs(float(q2[0]))
                                    if best is None or key < best[0]:
                                        best = (key, q2, cd)
                            if slid:
                                break
                        if apex and not slid and best is not None:
                            _, q2, cd = best
                            pmag += float(np.linalg.norm(q2 - q))
                            npr += 1
                            q = q2
                            d1 = cd
                            slid = True
                            n_apex[0] += 1
                    if not slid:
                        if v_sil and not v_sdf and not v_hull:
                            # silhouette-redirect: slide failed at a
                            # silhouette side (not body/hull); drop
                            # straight down along the wall if the
                            # domain allows (drape follows walls
                            # down to the hem instead of stopping
                            # mid-drape).
                            qd = p + np.array([0.0, 0.0, -1.0])
                            if float(s_D(qd[None, :], order=1)[0]) \
                                    >= 3.0 and float(s_sdf(
                                        qd[None, :], order=1)[0]) \
                                    >= SDF_CLEAR and not mask_outside(
                                        qd) and not (
                                        abs(rx0) >= 3.0
                                        and part_active(root, qd)
                                        and qd[0] * rx0 < 0
                                        and abs(qd[0]) > 2.0):
                                pmag += float(np.linalg.norm(qd - q))
                                npr += 1
                                q = qd
                                d1 = np.array([0.0, 0.0, -1.0])
                                slid = True
                    if not slid:
                        # groom2 drape override: a silhouette-only
                        # rejection while heading down in the drape zone
                        # (below the ear top, inside hull+SDF by
                        # construction here) steps straight down even
                        # outside the policing silhouette, so the drape
                        # continues to the hull's lower boundary where
                        # the target shows hair instead of stopping
                        # mid-drape. Bounded per guide; counted.
                        if v_sil and not v_sdf and not v_hull \
                                and d1[2] < -0.3 \
                                and float(q[2]) < EAR_TOP \
                                and n_override[0] < MAX_SIL_OVERRIDE:
                            qd = p + np.array([0.0, 0.0, -1.0])
                            if float(s_D(qd[None, :], order=1)[0]) \
                                    >= 3.0 and float(s_sdf(
                                        qd[None, :], order=1)[0]) \
                                    >= SDF_CLEAR and not (
                                        abs(rx0) >= 3.0
                                        and part_active(root, qd)
                                        and qd[0] * rx0 < 0
                                        and abs(qd[0]) > 2.0):
                                pmag += float(np.linalg.norm(qd - q))
                                npr += 1
                                q = qd
                                d1 = np.array([0.0, 0.0, -1.0])
                                slid = True
                                n_override[0] += 1
                    if not slid:
                        stop = "silhouette" if v_sil and not v_sdf \
                            and not v_hull else "stuck"
                        break
            p = q
            travel = d1
            pts.append(p.copy())
            arc += STEP
            if arc >= maxlen:
                stop = "maxlen"
                break
        curves_ret = np.array(pts)
        return (curves_ret, stop, npr, pmag, npr_step, arc, nst_tot,
                n_override[0], n_clamp[0], n_center[0], n_apex[0], n_ride[0])

    curves, stops, nprojs, pmags, nprior, lens = [], [], [], [], [], []
    nover = []
    nclamp = []
    ncenter = []
    nbump = []
    nride = []
    nsteer_acc = 0
    retries = []
    for j, root in enumerate(sroots):
        out = grow_guide(j, root, 0.4, 1.0)
        curves.append(out[0])
        stops.append(out[1])
        nprojs.append(out[2])
        pmags.append(out[3])
        nprior.append(out[4])
        lens.append(out[5])
        nsteer_acc += out[6]
        nover.append(out[7])
        nclamp.append(out[8])
        ncenter.append(out[9])
        nbump.append(out[10])
        nride.append(out[11])
        sil_overrides[0] += out[7]
    # retry pass: 'face' casualties with stronger curtain bias.
    n_retry_ok = 0
    for j, root in enumerate(sroots):
        if stops[j] == "face" and lens[j] < 150.0:
            out = grow_guide(j, root, 1.5, 2.0)
            retries.append(j)
            if out[1] != "face":
                curves[j] = out[0]
                stops[j] = out[1]
                nprojs[j] = out[2]
                pmags[j] = out[3]
                nprior[j] = out[4]
                lens[j] = out[5]
                n_retry_ok += 1
                sil_overrides[0] += out[7] - nover[j]
                nover[j] = out[7]
                nclamp[j] = out[8]
                ncenter[j] = out[9]
                nbump[j] = out[10]
                nride[j] = out[11]
            nsteer_acc += out[6]
    print("RETRY face=%d cleared=%d" % (len(retries), n_retry_ok),
          flush=True)
    lens = np.array(lens)
    print("GROWN n=%d len p50=%.0f p95=%.0f max=%.0f stops=%s" % (
        len(curves), float(np.percentile(lens, 50)),
        float(np.percentile(lens, 95)), float(lens.max()),
        json.dumps({s: stops.count(s) for s in set(stops)})),
        flush=True)
    print("STEER steps=%d (gravity + EIN-attract + inward + ear "
          "approach/deflect + part/face strips)" % nsteer_acc,
          flush=True)
    print("PROJ guides=%d steps=%d magMean=%.2f magMax=%.2f "
          "priorStepsFrac=%.3f" % (
        sum(1 for v in nprojs if v), sum(nprojs),
        float(np.mean(pmags)) if pmags else 0.0,
        float(np.max(pmags)) if pmags else 0.0,
        float(sum(nprior) / max(sum(lens), 1))), flush=True)

    # ---- smooth: Gaussian sigma=2.0 mm (light spline per card),
    # root re-anchored. Upgraded from 1.0: steering/slide corners
    # leave mm-jitter that the orientation measure (3 mm tangent
    # baseline) penalises; sigma 2.0 rounds sub-5 mm corners while
    # preserving drape (all gates re-verified below).
    sm = []
    for pts, root in zip(curves, sroots):
        if len(pts) < 4:
            sm.append(pts.copy())
            continue
        a = np.array(pts)
        b = ndimage.gaussian_filter1d(a, 2.0, axis=0, mode="nearest")
        b[0] = root
        sm.append(b)

    # groom2 post-smooth vertex repair: the sigma=2.0 spline can smear
    # a vertex-clamped corner back over the 2 mm wall by ~1 mm. Any
    # sample anterior of / at the vertex on the wrong side beyond 2 mm
    # is pinned to the wall (below-vertex samples untouched: the merge
    # lives there). Bounded, counted; guarantees the gate.
    n_repair = 0
    for j in range(len(sm)):
        c = np.asarray(sm[j])
        if len(c) < 2:
            continue
        rx = float(sroots[j, 0])
        if abs(rx) < 3.0:
            continue
        s = np.sign(rx)
        bad = (c[:, 0] * s < 0) & (np.abs(c[:, 0]) > 2.0) \
            & (c[:, 1] <= Y_VERTEX_MM)
        if bad.any():
            c[bad, 0] = 2.0 * s
            n_repair += int(bad.sum())
            sm[j] = c
    print("VERTEX-REPAIR samples=%d" % n_repair, flush=True)

    # containment of smoothed (route-accept analogue, beyond 8 mm).
    fracs = []
    for c in sm:
        if len(np.asarray(c)) < 2:
            fracs.append(0.0)
            continue
        r1 = ME.resample_1mm(c)
        seg = np.linalg.norm(np.diff(r1, axis=0), axis=1)
        arc = np.concatenate([[0.0], np.cumsum(seg)])
        sel8 = r1[arc > 8.0]
        if len(sel8) == 0:
            fracs.append(1.0)
            continue
        o = s_occ(sel8, order=1) > 0.5
        s = s_sdf(sel8, order=1) > 0
        fracs.append(float((o & np.isfinite(o) & s).mean()))
    fracs = np.array(fracs)
    print("SMOOTH containFrac p50=%.3f min=%.3f nBelow95=%d" % (
        float(np.percentile(fracs, 50)), float(fracs.min()),
        int((fracs < 0.95).sum())), flush=True)

    unreachable = sum(1 for c in sm if len(c) < 2)
    print("UNREACHABLE %d" % unreachable, flush=True)

    # ---- gates (guides with >= 2 points; shorter ones count as
    # unreachable above).
    gidx = [j for j, c in enumerate(sm) if len(c) >= 2]
    smg = [sm[j] for j in gidx]
    rgx = sroots[gidx, 0]
    rgy = sroots[gidx, 1]
    pc = ME.part_crossings(rgx, smg)
    # groom2: gate counts only ABOVE the vertex (y <= Y_VERTEX_MM);
    # below-vertex crossings are the intended merge (allowed, tallied).
    raw_above = over_above = 0
    maxexc_above = 0.0
    n_below = over_below = 0
    for i, c in enumerate(smg):
        rx = float(rgx[i])
        if abs(rx) < 3.0:
            continue
        s = np.sign(rx)
        above = np.asarray(c)[:, 1] <= Y_VERTEX_MM
        opp = (np.asarray(c)[:, 0] * s < 0)
        if (opp & above).any():
            raw_above += 1
            exc = float((-np.asarray(c)[opp & above, 0] * s).max())
            maxexc_above = max(maxexc_above, exc)
            if exc > 2.0:
                over_above += 1
        if (opp & ~above).any():
            n_below += 1
            excb = float((-np.asarray(c)[opp & ~above, 0] * s).max())
            if excb > 2.0:
                over_below += 1
    pc2 = {"rawFlips": raw_above, "crossingsOver2mm": over_above,
           "maxExcursionMm": round(maxexc_above, 2),
           "wholeCurve": pc,
           "belowVertexAllowed": {"nGuides": n_below,
                                  "over2mm": over_below},
           "yVertexMm": Y_VERTEX_MM}
    print("SILTRIG " + json.dumps(sil_triggers), flush=True)
    print("SILOVERRIDE steps=%d guides=%d" % (
        sil_overrides[0], sum(1 for v in nover if v)), flush=True)
    eg = ME.ear_gate(smg, inp["pinna"], inp)
    # remap ear near/covering indices to full numbering.
    for side in ("xpos", "xneg"):
        eg[side]["nearIdx"] = [gidx[i]
                               for i in eg[side]["nearIdx"]]
    eg["occlusion"]["coveringIdx"] = sorted(
        set(gidx[i] for v in eg["occlusion"]["perView"].values()
            for i, _ in v))
    eg["occlusion"]["perView"] = {
        v: sorted((gidx[i], k) for i, k in pairs)
        for v, pairs in eg["occlusion"]["perView"].items()}
    tips = np.array([c[-1, 0] for c in smg])
    bg = ME.back_gap_tips(tips, rgy, y_ear)
    tn = ME.turn_stats(smg)
    print("PART " + json.dumps(pc), flush=True)
    print("EAR pass=%s xpos=%d xneg=%d covering=%d" % (
        eg["gate"]["pass"], eg["xpos"]["nGuidesNear3mm"],
        eg["xneg"]["nGuidesNear3mm"],
        eg["occlusion"]["nGuidesCovering"]), flush=True)
    print("BACKGAP " + json.dumps(bg), flush=True)
    print("TURN " + json.dumps(tn), flush=True)

    L = max(len(c) for c in sm)
    pad = np.full((len(sm), L, 3), np.nan)
    for j, c in enumerate(sm):
        pad[j, :len(c)] = c
    CO.E0.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        str(CO.E0 / "grown.npz"), curves_mm=pad,
        roots_mm=sroots, roots_side=sside, roots_sel=sel,
        status=np.array(["grown"] * len(sm)),
        stops=np.array(stops), lengths=lens,
        nproj=np.array(nprojs), projmag=np.array(pmags),
        contain=np.array(fracs), y_ear_mm=np.array(y_ear),
        poisson_spacing=np.array(spacing_p))
    stats = {"nGuides": len(sm), "unreachable": unreachable,
             "lengths": {"p50": round(float(np.percentile(lens, 50)), 1),
                         "p95": round(float(np.percentile(lens, 95)), 1),
                         "max": round(float(lens.max()), 1)},
             "stops": {s: stops.count(s) for s in set(stops)},
             "projGuides": sum(1 for v in nprojs if v),
             "projSteps": sum(nprojs),
             "projMagMean": round(float(np.mean(pmags)), 3),
             "projMagMax": round(float(np.max(pmags)), 2),
             "priorStepFrac": round(float(
                 np.mean(nprior) / np.maximum(lens, 1).mean()), 4),
             "partCrossings": pc2, "ear": eg, "backGap": bg, "turn": tn,
             "silTriggers": sil_triggers,
             "silOverrides": {"steps": sil_overrides[0],
                              "guides": sum(1 for v in nover if v)},
             "vertexClamps": {"steps": sum(nclamp),
                              "guides": sum(1 for v in nclamp if v)},
             "vertexRepairSamples": n_repair,
             "centerMergeSteps": sum(ncenter),
             "apexSlides": sum(nbump),
             "rideOutSteps": sum(nride),
             "maskDilatePx": MASK_DILATE_PX, "mirrorTest": MIRROR_TEST,
             "containMin": round(float(fracs.min()), 4),
             "containBelow95": int((fracs < 0.95).sum()),
             "poissonSpacingMm": round(float(spacing_p), 2)}
    (CO.E0 / "grow-stats.json").write_text(
        json.dumps(stats, indent=1) + "\n")
    CO.write_inputs_log([S10 / "s03_grow.py", CO.E0 / "grown.npz"])
    # groom4 tuck hook (env-gated; no-op unless HAIR_TUCK=1): route
    # sideband guides over/behind the ear at growth time.
    if os.environ.get("HAIR_TUCK") == "1":
        import tuck as _TUCK
        CO.track(S10 / "tuck.py")
        _TUCK.main(CO.E0)
    print("STEP3 done in %.0fs" % (time.time() - t0), flush=True)


if __name__ == "__main__":
    main()
