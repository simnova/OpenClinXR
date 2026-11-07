#!/usr/bin/env python3
"""Guide-level ear band + temple route (hair-groom4, EAR BAND design).

Operator direction (handback 2, supersedes tuck-waypoint experiments):
the target shows BARE SKIN in a band around the ear. So:

1. EAR BAND: every scalp root within 15 mm (3D) of the pinna
   base/attachment, and every root in front of the ear below the helix
   top, gets NO hair (children trimmed; band guides excluded from the
   guide pool). Counts per side stated.
2. TEMPLE ROOTS (in front of the ear, above the helix top): their
   guides comb BACK above the ear: root -> H -> orientation-field
   continuation falling behind the ear. H sits 10-15 mm above the
   helix top and 10 mm behind it. No waypoint at or around the rim
   (the rim waypoint funneled 22k strands over the same concha pixels).
3. Hair behind the ear comes from roots behind the band (posterior
   drape, untouched guides); coverage checked dense (skin-through
   gate, scored in score4).
4. Children of temple guides blend only temple same-side guides
   (the children partition, keyed off the earframe temple box; below
   the vertex the sheet still merges).

Called from s03_grow.py when HAIR_TUCK=1 (env-gated hook), or standalone:

    tuck.py --outdir E --grown <grown.npz> --field <field.npz>

Reads the common_o inputs (tracked) for roots/hull/SDF/pinna/crown.
Writes outdir/tucked-grown.npz (grown schema + tuck/band flags),
outdir/guides-tucked.npz (guides.npz schema + tuck + band arrays),
outdir/earframe.json (boxes for children), outdir/tuck-stats.json,
outdir/tuck-map.png (temple routes over target tiles).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from scipy import ndimage
from scipy.spatial import ConvexHull, Delaunay, cKDTree

S10 = Path(__file__).resolve().parent
sys.path.insert(0, str(S10))
import common_o as CO  # noqa: E402
import measure as ME  # noqa: E402

STEP = 1.0
PIN_CLEAR = 3.0
SDF_CLEAR = 2.0
BAND_NEAR_MM = 15.0
BAND_X_LO = 35.0
BAND_X_HI = 100.0
TEMPLE_X_LO = 40.0
TEMPLE_X_HI = 100.0
H_UP_LO = 10.0
H_UP_HI = 15.0
H_BACK = 10.0


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--outdir", required=True)
    p.add_argument("--grown", default=None)
    p.add_argument("--field", default=None)
    return p.parse_args()


def tri_sampler(grid, origin, spacing):
    origin = np.asarray(origin, dtype=np.float64)

    def sample(pts, order=1, cval=np.nan):
        pts = np.asarray(pts, dtype=np.float64)
        idx = ((pts - origin) / spacing).T
        return ndimage.map_coordinates(grid, idx, order=order,
                                       cval=cval, mode="constant")
    return sample


def catmull_rom(pts, per=1.0):
    """Resample a Catmull-Rom spline through pts at ~per mm spacing."""
    pts = np.asarray(pts, dtype=np.float64)
    big = [pts[0]]
    big += list(pts)
    big += [pts[-1]]
    big = np.asarray(big)
    out = [big[1].copy()]
    for i in range(1, len(big) - 2):
        p0, p1, p2, p3 = big[i - 1], big[i], big[i + 1], big[i + 2]
        seg = float(np.linalg.norm(p2 - p1))
        n = max(2, int(round(seg / per)) + 1)
        for k in range(1, n):
            t = k / float(n - 1)
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t
                              + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return np.asarray(out)


def main(outdir=None, grown_path=None, field_path=None):
    t0 = time.time()
    E = Path(outdir)
    E.mkdir(parents=True, exist_ok=True)
    CO.track(S10 / "tuck.py")
    inp = CO.load_all()

    if grown_path is None:
        grown_path = str(CO.E0 / "grown.npz")
    if field_path is None:
        field_path = str(CO.E0 / "field.npz")
    CO.track(grown_path)
    CO.track(field_path)
    G = np.load(grown_path)
    F = np.load(field_path)

    hull = inp["hull"]
    xs = np.array(hull["xs"])
    ys = np.array(hull["ys"])
    zs = np.array(hull["zs"])
    spacing = float(hull["spacing"])
    occ = np.array(hull["occupancy"], dtype=bool)
    origin = np.array([xs[0], ys[0], zs[0]])
    dil = ndimage.binary_dilation(occ, iterations=4)  # 8 mm domain
    dil8 = ndimage.binary_dilation(occ, iterations=8)  # 16 mm domain
    D = ndimage.distance_transform_edt(dil).astype(np.float32) * spacing
    gD = [np.gradient(D, spacing, axis=i).astype(np.float32)
          for i in range(3)]
    egrid = inp["egrid"]
    sdf = np.asarray(egrid["sdf"], dtype=np.float32)
    sorigin = np.asarray(egrid["origin"], dtype=np.float64)
    sspacing = float(np.asarray(egrid["spacing"]).ravel()[0])
    gsdf = [np.gradient(sdf, sspacing, axis=i).astype(np.float32)
            for i in range(3)]

    idx = np.array(F["idx"])
    tdir = np.array(F["dir"], dtype=np.float32)
    dense = np.zeros(occ.shape + (3,), dtype=np.float32)
    dense[idx[:, 0], idx[:, 1], idx[:, 2]] = tdir
    s_dir = [tri_sampler(dense[..., i], origin, spacing)
             for i in range(3)]
    s_occ = tri_sampler(dil.astype(np.float32), origin, spacing)
    s_occ8 = tri_sampler(dil8.astype(np.float32), origin, spacing)
    D8 = ndimage.distance_transform_edt(dil8).astype(np.float32) * spacing
    gD8 = [np.gradient(D8, spacing, axis=i).astype(np.float32)
           for i in range(3)]
    s_gD8 = [tri_sampler(g, origin, spacing) for g in gD8]
    s_D = tri_sampler(D, origin, spacing)
    s_gD = [tri_sampler(g, origin, spacing) for g in gD]
    s_sdf = tri_sampler(sdf, sorigin, sspacing)
    s_gsdf = [tri_sampler(g, sorigin, sspacing) for g in gsdf]

    pin = {s: np.asarray(inp["pinna"][s], dtype=np.float64)
           for s in ("xpos", "xneg")}
    trees = {s: cKDTree(pin[s]) for s in pin}

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

    def grad_of(samplers, p):
        g = np.array([s(p[None, :], order=1)[0] for s in samplers])
        n = np.linalg.norm(g)
        if not np.isfinite(n) or n < 1e-9:
            return None
        return g / n

    def sdf_at(p):
        return float(s_sdf(p[None, :], order=1)[0])

    # ---- ear frame per side (world mm).
    frame = {}
    for side, sgn in (("xpos", 1.0), ("xneg", -1.0)):
        pv = pin[side]
        itop = int(np.argmax(pv[:, 2]))
        ilobe = int(np.argmin(pv[:, 2]))
        frame[side] = {
            "sgn": sgn,
            "xEar": float(np.median(pv[:, 0])),
            "yPost": float(pv[:, 1].max()),
            "zLobe": float(pv[:, 2].min()),
            "zTop": float(pv[:, 2].max()),
            "zMid": float((pv[:, 2].min() + pv[:, 2].max()) / 2.0),
            "helixTop": [float(v) for v in pv[itop]],
            "lobeBottom": [float(v) for v in pv[ilobe]],
            "nPinna": int(len(pv)),
        }
    print("FRAME " + json.dumps(
        {s: {k: f[k] for k in ("xEar", "yPost", "zLobe", "zTop")}
         for s, f in frame.items()}), flush=True)

    curves = [np.asarray(G["curves_mm"][j], dtype=np.float64)
              for j in range(len(G["roots_mm"]))]
    curves = [c[np.isfinite(c).all(axis=1)] for c in curves]
    roots = np.asarray(G["roots_mm"], dtype=np.float64)
    lengths = np.asarray(G["lengths"], dtype=np.float64)

    # ---- 1. EAR BAND roots (full scalp set): within 15 mm 3D of the
    # pinna base, or in front of the ear below the helix top. NO HAIR.
    rfull = np.asarray(inp["roots"]["xyz"], dtype=np.float64) * 1000.0
    band_idx = {}
    for side, sgn in (("xpos", 1.0), ("xneg", -1.0)):
        f = frame[side]
        d, _ = trees[side].query(rfull, k=1)
        near = d < BAND_NEAR_MM
        front = ((rfull[:, 0] * sgn > 0)
                 & (np.abs(rfull[:, 0]) >= BAND_X_LO)
                 & (np.abs(rfull[:, 0]) < BAND_X_HI)
                 & (rfull[:, 1] < f["yPost"] + 10.0)
                 & (rfull[:, 2] < f["zTop"])
                 & (rfull[:, 2] > f["zLobe"] - 70.0))
        band_idx[side] = sorted(int(i) for i in np.nonzero(
            near | front)[0])
    n_band = sum(len(v) for v in band_idx.values())
    print("BAND %d scalp roots (no hair): %s" % (
        n_band, {s: len(v) for s, v in band_idx.items()}), flush=True)

    # ---- cheek/jaw no-hair roots (below-lobe anterior; mostly a band
    # subset, kept explicit per the original card).
    cheek = {}
    for side, sgn in (("xpos", 1.0), ("xneg", -1.0)):
        f = frame[side]
        m = ((rfull[:, 0] * sgn > 0)
             & (np.abs(rfull[:, 0]) >= 35.0)
             & (np.abs(rfull[:, 0]) < 100.0)
             & (rfull[:, 2] < f["zLobe"])
             & (rfull[:, 1] < -20.0))
        cheek[side] = sorted(int(i) for i in np.nonzero(m)[0])
    n_cheek = sum(len(v) for v in cheek.values())
    print("CHEEK %d scalp roots below-lobe anterior (no hair)" % n_cheek,
          flush=True)

    # ---- 2. TEMPLE candidates: grown guides rooted in front of the
    # ear above the helix top (band roots excluded: band wins).
    bandset = set(i for v in band_idx.values() for i in v)
    rsel = np.asarray(G["roots_sel"]).ravel()
    # Proven drape corridor per side: median (x, y) per 10 mm z-bin of
    # grown sideband guides clearing the pinna by >= 8 mm (navigable by
    # construction). The tuck funnel herds toward it.
    corr = {}
    for _s, _sgn in (("xpos", 1.0), ("xneg", -1.0)):
        _bins: dict = {}
        for _j, _cc in enumerate(curves):
            if len(_cc) < 2:
                continue
            _r = roots[_j]
            if not ((_r[0] * _sgn > 0) and 30.0 <= abs(float(_r[0]))
                    <= 100.0):
                continue
            _d, _ = trees[_s].query(_cc, k=1)
            if float(_d.min()) < 8.0:
                continue
            for _p in _cc[::5]:
                _b = int(np.floor(float(_p[2]) / 10.0))
                _bins.setdefault(_b, []).append(_p[:2])
        _cm = {}
        for _b, _pts in _bins.items():
            if len(_pts) >= 20:
                _a = np.asarray(_pts)
                _cm[_b] = (float(np.median(_a[:, 0])),
                           float(np.median(_a[:, 1])))
        corr[_s] = _cm
    print("CORRIDOR bins xpos=%d xneg=%d" % (len(corr["xpos"]),
                                            len(corr["xneg"])),
          flush=True)
    cand = []
    for j, r in enumerate(roots):
        if len(curves[j]) < 2:
            continue
        if int(rsel[j]) in bandset:
            continue
        side = "xpos" if r[0] >= 0 else "xneg"
        f = frame[side]
        if (abs(float(r[0])) >= TEMPLE_X_LO
                and abs(float(r[0])) < TEMPLE_X_HI
                and float(r[1]) < f["yPost"] + 10.0
                and float(r[2]) >= f["zTop"]):
            cand.append(j)
    print("TEMPLE %d/%d guides to route" % (len(cand), len(roots)),
          flush=True)

    PRIOR = np.array([0.0, 0.5, -1.0])
    PRIOR /= np.linalg.norm(PRIOR)
    tuck_flag = np.zeros(len(roots), dtype=np.float64)
    band_g = np.zeros(len(roots), dtype=np.float64)
    for j, r in enumerate(roots):
        if int(rsel[j]) in bandset:
            band_g[j] = 1.0
    new_curves = [None] * len(roots)
    stat = {"nCand": len(cand), "nTucked": 0, "shortFallback": 0,
            "clearFallback": 0, "contStops": {}}

    for j in cand:
        r = roots[j]
        side = "xpos" if r[0] >= 0 else "xneg"
        f = frame[side]
        pv = pin[side]
        tree = trees[side]
        orig = curves[j]

        # H: 12 mm above the helix top, 10 mm behind it (brief:
        # 10-15 above, 10 behind), spread +-5 mm per guide by index
        # (a shared H funnels 118 ropes through the same temple pixels;
        # spread reads as a natural tuft where the target has mass).
        _jx = ((j * 37) % 11) - 5.0
        _jy = ((j * 53) % 11) - 5.0
        _jz = ((j * 29) % 7) - 3.0
        H = np.array([f["helixTop"][0] + _jx,
                      f["helixTop"][1] + H_BACK + _jy,
                      f["zTop"] + 12.0 + _jz])
        for _ in range(5):
            d, ei = tree.query(H, k=1)
            if d >= PIN_CLEAR and sdf_at(H) >= 1.0:
                break
            away = H - pv[ei]
            al = float(np.linalg.norm(away)) or 1.0
            H = H + away / al * max(PIN_CLEAR + 0.2 - d, 0.0)
            H[2] += 0.5
        # continuation initial dir at H.
        arr = H - r
        arr /= (np.linalg.norm(arr) + 1e-12)
        dH = field_dir(H, arr)
        if dH is None:
            dH = PRIOR.copy()
            if (dH * arr).sum() < 0:
                dH = -dH

        # prefix root -> H (+ lead-out), 1 mm resample.
        lead = H + dH * 12.0
        pre = catmull_rom(np.stack([r, H, lead]), per=1.0)
        for _ in range(5):
            dd, ji = tree.query(pre, k=1)
            bad = dd < PIN_CLEAR
            if not bad.any():
                vv = np.array([sdf_at(p) for p in pre])
                bad2 = vv < -1.0
                if not bad2.any():
                    break
                for bi in np.nonzero(bad2)[0]:
                    g = grad_of(s_gsdf, pre[bi])
                    if g is not None:
                        pre[bi] = pre[bi] + g * 0.5
                continue
            for bi in np.nonzero(bad)[0]:
                away = pre[bi] - pv[ji[bi]]
                al = float(np.linalg.norm(away)) or 1.0
                pre[bi] = pre[bi] + away / al * (
                    PIN_CLEAR + 0.2 - dd[bi])
        # air dive: H sits outside the growth domain (12 mm above the
        # surface). March down-posterior (no hull check, SDF > -1 and
        # pinna >= 3 mm only) until inside the wide domain near the mass,
        # then run the constrained continuation.
        dive = [pre[-1].copy()]
        dp = pre[-1].copy()
        dtr = dH.copy()
        for _ in range(40):
            _dd = field_dir(dp, dtr)
            _step = np.array([0.0, 0.2, -1.0])
            _step /= (np.linalg.norm(_step) + 1e-12)
            if _dd is not None:
                _step = 0.5 * _dd + 0.5 * _step
                _step /= (np.linalg.norm(_step) + 1e-12)
            dq = dp + _step * STEP
            _dpin, _ = tree.query(dq, k=1)
            if _dpin < PIN_CLEAR or sdf_at(dq) <= -1.0:
                break
            dp = dq
            dtr = _step
            dive.append(dp.copy())
            if float(s_occ8(dp[None, :], order=1)[0]) > 0.5 \
                    and sdf_at(dp) < 10.0:
                break
        # continuation: field + gravity + posterior drive until past
        # the lobe, then normal drape (+ funnel below z 1450). Starts
        # at the dive end (inside the wide domain).
        cont = [dp.copy()]
        p = dp.copy()
        travel = dtr.copy()
        stop = "len"
        carc = 0.0
        zH0 = float(H[2])
        for _ in range(500):
            dm = field_dir(p, travel)
            if dm is None:
                dm = PRIOR.copy()
                if (dm * travel).sum() < 0:
                    dm = -dm
            _drop = max(0.0, zH0 - float(p[2]))
            _eff = max((_drop - 5.0) / 30.0, (carc - 45.0) / 30.0)
            _eff = float(0.5 - 0.5 * np.cos(
                np.clip(_eff, 0, 1) * np.pi))
            _gb = 0.15 + 0.9 * _eff
            dm = dm + _gb * np.array([0.0, 0.0, -1.0])
            dm /= np.linalg.norm(dm) + 1e-12
            if float(p[1]) < f["yPost"] + 5.0:
                # not yet behind the ear: drive posterior, no anterior.
                dm = dm + 0.4 * np.array([0.0, 1.0, 0.0])
                dm /= np.linalg.norm(dm) + 1e-12
                if dm[1] < 0:
                    dm[1] = 0.0
                    dm /= np.linalg.norm(dm) + 1e-12
            if float(p[2]) >= 1500.0:
                # upper phase: descend the lateral air rind (x anchored
                # lateral, slight posterior); the rind SDF is 1-4 mm and
                # the flesh wall is medial -- any medial pull parks
                # strands inside the head (measured: all stuck on SDF).
                _lat = np.array([sgn * 72.0 - float(p[0]),
                                 8.0, -25.0])
                _lat /= (np.linalg.norm(_lat) + 1e-12)
                dm = dm * 0.4 + _lat * 0.8
                dm /= np.linalg.norm(dm) + 1e-12
            else:
                # lower phase: corridor funnel (proven manifold).
                _cb = int(np.floor((float(p[2]) - 20.0) / 10.0))
                _cm = corr[side].get(_cb)
                if _cm is None and corr[side]:
                    _ks = np.array(sorted(corr[side].keys()))
                    _cm = corr[side][int(_ks[np.argmin(
                        np.abs(_ks - _cb))])]
                if _cm is not None:
                    _fun = np.array([_cm[0] - float(p[0]),
                                     _cm[1] - float(p[1]), -20.0])
                    _fun /= (np.linalg.norm(_fun) + 1e-12)
                    dm = dm * 0.5 + _fun * 0.8
                    dm /= np.linalg.norm(dm) + 1e-12
            q = p + dm * STEP
            v_pin, _ = tree.query(q, k=1)
            v_sdf = sdf_at(q)
            v_hull = float(s_occ8(q[None, :], order=1)[0])
            # temple clearance is SDF >= -3.0 (guides may skin/hug the
            # scalp and graze shallow flesh -- children re-project out;
            # deeper flesh stays a wall so guides cannot tunnel the
            # head; pinna cartilage always a wall).
            if v_pin < PIN_CLEAR or v_sdf < -3.0 or v_hull < 0.5:
                ds = dm.copy()
                if v_sdf < -3.0:
                    g = grad_of(s_gsdf, q)
                    if g is not None:
                        ds = ds - (ds * g).sum() * g
                if v_hull < 0.5:
                    g = grad_of(s_gD8, q)
                    if g is not None:
                        ds = ds - (ds * g).sum() * g
                if v_pin < PIN_CLEAR:
                    dPQ, eiQ = tree.query(q, k=1)
                    away = q - pv[eiQ]
                    al = float(np.linalg.norm(away)) or 1.0
                    rhat = away / al
                    inw = (ds * rhat).sum()
                    if inw < 0:
                        ds = ds - inw * rhat
                nn = float(np.linalg.norm(ds))
                if nn < 1e-6:
                    stop = "stuck@degenerate"
                    break
                ds /= nn
                q = p + ds * STEP
                v_pin, _ = tree.query(q, k=1)
                v_sdf = sdf_at(q)
                v_hull = float(s_occ8(q[None, :], order=1)[0])
                if v_pin < PIN_CLEAR or v_sdf < -3.0 \
                        or v_hull < 0.5:
                    stop = "stuck@pin%d/sdf%d/hull%d" % (
                        v_pin < PIN_CLEAR, v_sdf < -3.0, v_hull < 0.5)
                    break
                dm = ds
            p = q
            travel = dm
            carc += STEP
            cont.append(p.copy())
            prelen = float(np.linalg.norm(np.diff(pre, axis=0),
                                          axis=1).sum())
            conlen = float(np.linalg.norm(np.diff(np.asarray(cont),
                                                  axis=0), axis=1).sum())
            if prelen + conlen >= float(lengths[j]):
                break
            if float(p[2]) <= float(zs.min()) + 8.0:
                stop = "hemfloor"
                break
        else:
            stop = "maxlen"
        stat["contStops"][stop] = stat["contStops"].get(stop, 0) + 1
        if stop.startswith("stuck") and len(
                stat.get("stuckPos", [])) < 12:
            stat.setdefault("stuckPos", []).append(
                [round(float(v), 1) for v in p] + [stop])
        full = np.vstack([pre, np.asarray(dive)[1:],
                          np.asarray(cont)[1:]])
        sm = ndimage.gaussian_filter1d(full, 1.0, axis=0,
                                       mode="nearest")
        sm[0] = r
        if stop != "len":
            _cut = 0
            for _bi in range(len(sm) - 1, max(len(sm) - 41, 0), -1):
                _dp, _ = tree.query(sm[_bi], k=1)
                if _dp >= 0.005 and sdf_at(sm[_bi]) >= 2.5:
                    break
                _cut += 1
            if _cut:
                sm = sm[:len(sm) - _cut]
                sm[0] = r
                stat["tipBacktrack"] = stat.get("tipBacktrack", 0) + 1
        sm[0] = r
        dd, _ = tree.query(sm, k=1)
        dmin = float(dd.min())
        total = float(np.linalg.norm(np.diff(sm, axis=0), axis=1).sum())
        if dmin < PIN_CLEAR or total < 60.0:
            stat["clearFallback"] += 1
            if total < 60.0:
                stat["shortFallback"] += 1
            new_curves[j] = orig
            continue
        new_curves[j] = sm
        tuck_flag[j] = 1.0
        stat["nTucked"] += 1

    for j in range(len(roots)):
        if new_curves[j] is None:
            new_curves[j] = curves[j]

    # ---- dent pass (non-tucked, non-band guides): samples within
    # 5 mm of the pinna sitting anterior of back-plane + 2 mm are
    # pushed posteriorly onto back-plane + 3 mm (feathered +-25 mm).
    # SDF-invalid dents revert per sample.
    dent_info = {"nGuides": 0, "nSamples": 0, "nReverted": 0}
    for j in range(len(roots)):
        if tuck_flag[j] > 0.5 or band_g[j] > 0.5:
            continue
        c = np.asarray(new_curves[j], dtype=np.float64)
        if len(c) < 2:
            continue
        side = "xpos" if roots[j, 0] >= 0 else "xneg"
        tree = trees[side]
        f = frame[side]
        dd, _ = tree.query(c, k=1)
        hit = (dd < 0.005) & (c[:, 1] < f["yPost"] + 0.002)
        if not hit.any():
            continue
        tgt = f["yPost"] + 0.003
        idx = np.nonzero(hit)[0]
        lo = max(int(idx.min()) - 25, 0)
        hi = min(int(idx.max()) + 26, len(c))
        seg = np.arange(lo, hi)
        wgt = np.ones(len(seg))
        n0 = int(idx.min()) - lo
        n1 = hi - 1 - int(idx.max())
        if n0 > 1:
            wgt[:n0] = 0.5 - 0.5 * np.cos(
                np.pi * np.arange(n0) / float(n0))
            wgt[0] = 0.0
        if n1 > 1:
            tail = 0.5 + 0.5 * np.cos(
                np.pi * (1.0 + np.arange(n1) / float(n1)))
            wgt[len(seg) - n1:] = tail[::-1]
            wgt[-1] = 0.0
        c2 = c.copy()
        push = np.maximum(tgt - c2[seg, 1], 0.0) * wgt
        c2[seg, 1] += push
        bad = np.zeros(len(seg), dtype=bool)
        for k, s_ in enumerate(seg):
            if push[k] > 1e-9 and sdf_at(c2[s_]) < 1.0:
                bad[k] = True
        c2[seg[bad]] = c[seg[bad]]
        dent_info["nReverted"] += int(bad.sum())
        cs = ndimage.gaussian_filter1d(c2, 1.0, axis=0, mode="nearest")
        cs[0] = roots[j]
        dd2, _ = tree.query(cs, k=1)
        if float(dd2.min()) < PIN_CLEAR:
            continue
        new_curves[j] = cs
        dent_info["nGuides"] += 1
        dent_info["nSamples"] += int((push > 1e-9).sum())
    stat["dent"] = dent_info

    # ---- write tucked-grown.npz (grown schema + tuck/band).
    L = max(len(c) for c in new_curves)
    pad = np.full((len(new_curves), L, 3), np.nan)
    for j, c in enumerate(new_curves):
        pad[j, :len(c)] = c
    lens = np.array([float(np.linalg.norm(np.diff(c, axis=0),
                                          axis=1).sum())
                     for c in new_curves])
    status = np.array(G["status"]).astype(object)
    stops = np.array(G["stops"]).astype(object)
    for j in range(len(roots)):
        if tuck_flag[j] > 0.5:
            status[j] = "tucked"
            stops[j] = "tuck"
        elif band_g[j] > 0.5:
            status[j] = "bandexcluded"
    np.savez_compressed(
        str(E / "tucked-grown.npz"), curves_mm=pad,
        roots_mm=np.asarray(G["roots_mm"]),
        roots_side=np.asarray(G["roots_side"]),
        roots_sel=np.asarray(G["roots_sel"]),
        status=np.array(status), stops=np.array(stops),
        lengths=lens, nproj=np.asarray(G["nproj"]),
        projmag=np.asarray(G["projmag"]),
        contain=np.asarray(G["contain"]),
        y_ear_mm=np.asarray(G["y_ear_mm"]),
        poisson_spacing=np.asarray(G["poisson_spacing"]),
        tuck=tuck_flag, band=band_g)
    print("WROTE tucked-grown.npz tuck=%d bandguides=%d/%d" % (
        int(tuck_flag.sum()), int(band_g.sum()), len(roots)),
        flush=True)

    # ---- export guides-tucked.npz (s05 schema + tuck + band).
    crown = np.asarray(inp["crown"], dtype=np.float64)
    ch = np.zeros((len(new_curves), 41, 3))
    ok_idx = []
    exp_status = []
    for j, c in enumerate(new_curves):
        if len(c) < 2 or band_g[j] > 0.5:
            exp_status.append("bandexcluded" if band_g[j] > 0.5
                              else "unreachable")
            continue
        ch[j] = CO.world_to_head(ME.resample_arc41(c / 1000.0, 41),
                                 crown)
        ok_idx.append(j)
        exp_status.append("tucked" if tuck_flag[j] > 0.5 else "grown")
    ok_idx = np.array(ok_idx, dtype=np.int64)
    np.savez_compressed(
        str(E / "guides-tucked.npz"), curves_head=ch, crown=crown,
        param_names=np.array(["tube_r"]),
        param_values=np.array([3.0]),
        spec_sha=np.array(["tuck4band"]),
        status=np.array(exp_status),
        ok_idx=ok_idx,
        roots_file=np.array(["hair-scalp1/roots.npz Poisson "
                             "streamline-grown on orient field + "
                             "ear band + temple route"]),
        y_ear_mm=np.array([float(np.asarray(
            G["y_ear_mm"]).ravel()[0])]),
        verdict=np.array(["TUCK"]),
        tuck=tuck_flag,
        band=band_g)
    print("WROTE guides-tucked.npz ok=%d tuck=%d" % (
        len(ok_idx), int(tuck_flag[ok_idx].sum())), flush=True)

    # ---- earframe.json (boxes for children, mm). tuckBoxMm carries
    # the TEMPLE box (children partition key unchanged); bandBoxMm
    # carries the front-band box for the band trim.
    earframe = {"sides": {}, "cheekIdx": cheek,
                "nCheek": int(n_cheek),
                "bandIdx": band_idx,
                "nBand": int(n_band)}
    for side in ("xpos", "xneg"):
        f = frame[side]
        earframe["sides"][side] = {
            "xEarMm": f["xEar"], "yPostMm": f["yPost"],
            "zLobeMm": f["zLobe"], "zTopMm": f["zTop"],
            "zMidMm": f["zMid"], "helixTopMm": f["helixTop"],
            "lobeBottomMm": f["lobeBottom"],
            "tuckBoxMm": {"xLo": TEMPLE_X_LO, "xHi": TEMPLE_X_HI,
                          "yMax": f["yPost"] + 10.0,
                          "zLo": f["zTop"], "zHi": f["zTop"] + 60.0},
            "bandBoxMm": {"xLo": BAND_X_LO, "xHi": BAND_X_HI,
                          "yMax": f["yPost"] + 10.0,
                          "zLo": f["zLobe"] - 70.0,
                          "zHi": f["zTop"]},
            "cheekBoxMm": {"xLo": 35.0, "xHi": 100.0,
                           "yMax": -20.0, "zMax": f["zLobe"]},
        }
    (E / "earframe.json").write_text(
        json.dumps(earframe, indent=1) + "\n")

    # ---- guide gates on shipped (non-band) curves.
    smg = [new_curves[j] for j in ok_idx]
    rgx = roots[ok_idx, 0]
    pc = ME.part_crossings(rgx, smg)
    over = 0
    over_below = 0
    maxexc = 0.0
    for i, c in enumerate(smg):
        rx = float(rgx[i])
        if abs(rx) < 3.0:
            continue
        s = np.sign(rx)
        opp = (np.asarray(c)[:, 0] * s < 0)
        if opp.any():
            exc = float((-np.asarray(c)[opp, 0] * s).max())
            maxexc = max(maxexc, exc)
            post = np.asarray(c)[opp, 1] > 34.2
            if exc > 2.0 and not post.all():
                over += 1
            if exc > 2.0 and post.any():
                over_below += 1
    eg = ME.ear_gate(smg, inp["pinna"], inp)
    dmins = []
    for j in ok_idx:
        c = new_curves[j]
        d, _ = cKDTree(pin["xpos"] if roots[j, 0] >= 0
                       else pin["xneg"]).query(c, k=1)
        dmins.append(float(d.min()))
    dmins = np.array(dmins)
    tips = np.array([c[-1, 0] for c in smg])
    y_ear = float(np.asarray(G["y_ear_mm"]).ravel()[0])
    bg = ME.back_gap_tips(tips, roots[ok_idx, 1], y_ear)
    tn = ME.turn_stats(smg)
    stats = {"nGuides": len(smg),
             "nTucked": int(tuck_flag[ok_idx].sum()),
             "nBandGuides": int(band_g.sum()),
             "nBandRoots": {s: len(v) for s, v in band_idx.items()},
             "nCheekNoHair": int(n_cheek),
             "partCrossingsOver2mm": over,
             "partCrossingsBelowVertexAllowed": over_below,
             "partMaxExcursionMm": round(maxexc, 2),
             "partWhole": pc,
             "earNear3mm": {
                 "xpos": eg["xpos"]["nGuidesNear3mm"],
                 "xneg": eg["xneg"]["nGuidesNear3mm"]},
             "tuckEar": {"minDistMm": round(float(dmins.min()), 2),
                         "nBelow3mm": int((dmins < 3.0).sum()),
                         "gateMinGe3mm": bool((dmins >= 3.0).all())},
             "backGap": bg, "turn": tn,
             "contStops": stat["contStops"],
             "stuckPos": stat.get("stuckPos", []),
             "clearFallback": stat["clearFallback"],
             "shortFallback": stat.get("shortFallback", 0),
             "tipBacktrack": stat.get("tipBacktrack", 0)}
    (E / "tuck-stats.json").write_text(
        json.dumps(stats, indent=1) + "\n")
    print("TUCK-STATS " + json.dumps(stats), flush=True)

    # ---- tuck map (temple routes over target tiles, 3q/profile).
    from PIL import Image, ImageDraw
    cams = json.loads((CO.ROOT / "tools/openclinxr/hair-groom"
                       "/manifests/cameras-scorer-v3.json").read_text())
    sensor = float(cams["sensorWidthMm"])
    tidx = np.nonzero(tuck_flag[ok_idx] > 0.5)[0]

    def project(pts, v):
        m = np.array(cams["views"][v]["matrixWorld"],
                     dtype=np.float64)
        inv = np.linalg.inv(m)
        f = float(cams["views"][v]["lensMm"]) / sensor * 1024.0
        hw = np.ones((len(pts), 4))
        hw[:, :3] = np.asarray(pts, dtype=np.float64) / 1000.0
        lc = (inv @ hw.T).T
        dep = -lc[:, 2]
        cc = np.full(len(pts), -1.0)
        rr = np.full(len(pts), -1.0)
        ok = dep > 0
        cc[ok] = 512.0 + (lc[ok, 0] / dep[ok]) * f
        rr[ok] = 512.0 - (lc[ok, 1] / dep[ok]) * f
        return cc, rr

    TGT = {"three_quarter": "target-three_quarter-a1.png",
           "profile_90": "target-profile.png"}
    cells = []
    for v in ("three_quarter", "profile_90"):
        base = Image.open(CO.SCRATCH / TGT[v]).convert("RGB")
        lay = Image.new("RGBA", base.size, (0, 0, 0, 0))
        dr = ImageDraw.Draw(lay)
        for j in tidx:
            c = smg[j][::3]
            cc, rr = project(c, v)
            m = (cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
            pts = list(zip(cc[m].tolist(), rr[m].tolist()))
            if len(pts) > 1:
                dr.line(pts, fill=(255, 80, 40, 220), width=2)
        cells.append(Image.alpha_composite(
            base.convert("RGBA"), lay).convert("RGB"))
    W, H = cells[0].size
    sheet = Image.new("RGB", (2 * W, H + 26), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    dr.text((8, 5), "temple routes (%d) over aisha-v3 target" % len(tidx),
            fill=(240, 240, 240))
    sheet.paste(cells[0], (0, 26))
    sheet.paste(cells[1], (W, 26))
    sheet.save(E / "tuck-map.png")
    print("WROTE tuck-map.png", flush=True)
    _prev = []
    _log = E / "inputs-opened.txt"
    if _log.exists():
        _prev = [ln.strip() for ln in _log.read_text().splitlines()
                 if ln.strip()]
    _log.write_text("\n".join(sorted(set(_prev) | set(CO.OPENED) | {
        str(E / "tucked-grown.npz"), str(E / "guides-tucked.npz"),
        str(E / "earframe.json")})) + "\n")
    print("tuck done in %.0fs" % (time.time() - t0), flush=True)


if __name__ == "__main__":
    args = cli()
    E = Path(args.outdir)
    E.mkdir(parents=True, exist_ok=True)
    import os as _os
    _E0 = _os.environ.get("TUCK_E0", None)
    if args.grown is None:
        base = Path(_E0) if _E0 else E
        main(E, str(base / "grown.npz"), str(base / "field.npz"))
    else:
        main(E, args.grown, args.field)
