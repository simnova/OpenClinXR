#!/usr/bin/env python3
"""Groom22 STEP 3: BACK guide re-trace through the smoothed orientation field.

Reuses s06_depthgrow.py's tracer VERBATIM (same constants, same routing,
same turn gates, same depth law, same stops, same retry, same 41-pt
arc-uniform resample). Documented deltas vs s06 (only three):

1. FIELD: the direction sampler reads --field (field-smooth22.npz: BACK
   voxels smoothed by s12_back_smooth.py, FRONT voxels untouched) instead
   of hair-orient0/field.npz. Same idx grid, same hull5 dilation domain.
2. ROOTS: no Poisson reselection. The retraced set is exactly the
   guides-19 BACK non-tuck guides (563 BACK roots, 524 non-tuck retraced;
   39 BACK-tuck + 2144 FRONT byte-identical out). Same roots (world m),
   same depth fractions u_j = 0.3+0.6*((j*PHI)%1) with j = the guide's
   ORIGINAL s06 index (guides-8a/19 preserve s06 order: rows 0..2649 are
   the s06 new guides, rows 2650..2706 the verbatim tucked set), same
   Thick/dstar/hem/maxlen formulas from the same SDF/hull inputs.
3. TAKE-OFF: per-guide own arc from guides-19; every retraced sample
   with guides-19 arc < 40 mm is overwritten with the guides-19 head-mm
   bits (s11 verbatim rule). FRONT/tuck rows copy guides-19 bits exactly.

Never deletes guides. Outputs <outdir>/<stem>.npz + <stem>-retrace.json.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

S13 = Path(__file__).resolve().parent
sys.path.insert(0, str(S13))
sys.path.insert(0, str(S13.parent / "strands"))
sys.path.insert(0, str(S13.parent))
import common_o as CO  # noqa: E402  (read-only loader, same as s06)
import frames as FFF  # noqa: E402  (head/world conversions)

# ---- s06 constants, verbatim ----
STEP = 1.0
TURN_LEADER_DEG = 12.0
TURN_MAIN_DEG = 5.0
COS_MAIN = float(np.cos(np.radians(TURN_MAIN_DEG)))
COS_LEADER = float(np.cos(np.radians(TURN_LEADER_DEG)))
LAMBDA_MAX = 0.05
LAMBDA_LEADER_MAX = 0.20
RAMP_MM = 8.0
BOUND_MM = 3.0
Y_VERTEX_MM = 34.2
CENTER_K = 0.003
CENTER_XBAND = 80.0
EAR_KEEP = 8.0
P_IN = 41
VERBATIM_MM = 40.0
PHI = 0.618033988749895
Y_EAR = -0.0635
Z_NAPE = 1.51


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--guides", required=True, help="guides-19.npz")
    p.add_argument("--field", required=True, help="field-smooth22.npz")
    p.add_argument("--outdir", required=True)
    p.add_argument("--stem", default="guides-22")
    return p.parse_args()


def tri_sampler(grid, origin, spacing):
    origin = np.asarray(origin, dtype=np.float64)

    def sample(pts, order=1, cval=np.nan):
        pts = np.asarray(pts, dtype=np.float64)
        idx = ((pts - origin) / spacing).T
        return ndimage.map_coordinates(grid, idx, order=order,
                                       cval=cval, mode="constant")
    return sample


def distribution(a):
    a = np.asarray(a, dtype=np.float64)
    if not a.size:
        return {"n": 0}
    return {"n": int(a.size), "min": round(float(a.min()), 3),
            "p50": round(float(np.percentile(a, 50)), 3),
            "p90": round(float(np.percentile(a, 90)), 3),
            "max": round(float(a.max()), 3)}


def crossing_count(curves, crown, mask):
    """s11_back_coherent.crossing_count, verbatim semantics."""
    roots = curves[:, 0]
    seg = np.linalg.norm(np.diff(curves, axis=1), axis=2)
    arc = np.concatenate([np.zeros((len(curves), 1)),
                          np.cumsum(seg, axis=1)], axis=1)
    win = (arc >= 0.040) & (arc <= 0.200)
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
    cross = 0
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
                cross += 1
    return {"nCrossPairs": int(cross), "nGuides": int(m),
            "nPairs": int(m * (m - 1) // 2)}


def main():
    t0 = time.time()
    args = cli()
    E = Path(args.outdir)
    E.mkdir(parents=True, exist_ok=True)

    # ---- inputs (same files s06 reads, except field) ----
    inp = CO.load_all()
    fld = np.load(args.field, allow_pickle=True)
    H = np.load(str(CO.ROOT / "tools/openclinxr/evidence/hair-hull5"
                            "/hull.npz"), allow_pickle=True)
    EF = json.loads((CO.ROOT / "tools/openclinxr/evidence/hair-groom4"
                     "/tucked/earframe.json").read_text())

    src = np.load(args.guides, allow_pickle=True)
    head_in = np.asarray(src["curves_head"], dtype=np.float64)
    crown = np.asarray(src["crown"], dtype=np.float64)
    n, Pin, _ = head_in.shape
    assert Pin == P_IN, (Pin, P_IN)
    curves19 = FFF.head_to_world(head_in, crown)
    roots19 = curves19[:, 0].copy()
    tuck = (np.asarray(src["tuck"]) > 0.5) if "tuck" in src.files \
        else np.zeros(n, dtype=bool)
    back_mask = (roots19[:, 1] < Y_EAR) & (roots19[:, 2] > Z_NAPE)
    retraced_mask = back_mask & ~tuck
    ridx = np.nonzero(retraced_mask)[0]
    nrt = len(ridx)
    print("RETRACE back=%d retraced=%d front+tuck=%d" % (
        int(back_mask.sum()), nrt, int((~retraced_mask).sum())), flush=True)

    # ---- hull / field domain (s06 code, verbatim) ----
    hull = H
    xs = np.array(hull["xs"])
    ys = np.array(hull["ys"])
    zs = np.array(hull["zs"])
    spacing = float(hull["spacing"])
    occ = np.array(hull["occupancy"], dtype=bool)
    shape = occ.shape
    origin = np.array([xs[0], ys[0], zs[0]])
    idx = np.array(fld["idx"])
    tdir = np.array(fld["dir"], dtype=np.float32)
    assert tuple(idx.max(axis=0) + 1) <= shape, \
        (idx.max(axis=0), shape)
    dil = ndimage.binary_dilation(occ, iterations=2)
    Ddil = ndimage.distance_transform_edt(dil).astype(
        np.float32) * spacing
    Docc = ndimage.distance_transform_edt(occ).astype(
        np.float32) * spacing
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
        nn = np.linalg.norm(v)
        if nn < 1e-9:
            return None
        v /= nn
        if (v * travel).sum() < 0:
            v = -v
        return v

    def sdf_grad(p):
        g = np.array([s(p[None, :], order=1)[0] for s in s_gsdf])
        nn = np.linalg.norm(g)
        if not np.isfinite(nn) or nn < 1e-9:
            return None
        return g / nn

    def inward_grad(p):
        h = np.array([s(p[None, :], order=1)[0] for s in s_gDdil])
        nn = np.linalg.norm(h)
        if not np.isfinite(nn) or nn < 1e-9:
            return None
        return h / nn

    # ---- root normals: nearest scalp root (exact coincidence, s06 roots
    # are scalp roots; verified max dist 2.2e-14 mm) ----
    sc_xyz = np.asarray(inp["roots"]["xyz"], dtype=np.float64) * 1000.0
    sc_n = np.asarray(inp["roots"]["normal"], dtype=np.float64)
    sc_n /= np.linalg.norm(sc_n, axis=1, keepdims=True) + 1e-12
    sroots = roots19[ridx] * 1000.0  # mm
    dd, ii = cKDTree(sc_xyz).query(sroots, k=1)
    print("ROOT match dist max=%.2e mm" % float(dd.max()), flush=True)
    assert float(dd.max()) < 1e-6, float(dd.max())
    rnorm = sc_n[ii]

    # ---- depth fractions: s06 golden stride by ORIGINAL index (same u) ----
    gidx_all = ridx  # global indices into guides-19 (= s06 j for j<2650)
    assert bool((gidx_all < 2650).all()), "retraced set must be s06 new guides"
    uu_full = 0.3 + 0.6 * ((np.arange(2650) * PHI) % 1.0)
    uu = uu_full[gidx_all]

    Thick = np.zeros(nrt)
    for j in range(nrt):
        n0 = rnorm[j]
        q = sroots[j] + n0 * 3.0
        sd = float(s_sdf((q / 1000.0)[None, :], order=1)[0])
        dd2 = float(s_Docc((q / 1000.0)[None, :], order=1)[0])
        if not np.isfinite(sd):
            sd = 0.0
        if not np.isfinite(dd2):
            dd2 = 0.0
        Thick[j] = float(np.clip(sd + dd2, 3.0, 30.0))
    dstar = uu * Thick

    occidx = np.argwhere(dil)
    hem_tree = cKDTree(occidx[:, :2].astype(np.float64) * spacing)
    hems = np.zeros(nrt)
    for j in range(nrt):
        r = sroots[j]
        iii = np.array([[(r[0] - xs[0]) / spacing,
                         (r[1] - ys[0]) / spacing]])
        ddd, jjj = hem_tree.query(iii, k=400)
        cd = occidx[jjj[0][ddd[0] * spacing <= 25.0]]
        hems[j] = zs[cd[:, 2]].min() if len(cd) else zs.min()
    maxlens = np.clip(sroots[:, 2] - float(zs.min()) + 100.0, 60.0, 600.0)

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

    def turn_gate(d1, travel, cos_max):
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

    def in_ear_window(pm):
        return (abs(pm[0]) > 40.0 and pm[2] < EAR_TOP + 40.0
                and pm[2] > EAR_TOP - 70.0
                and pm[1] > EAR_Y - 60.0 and pm[1] < EAR_Y + 25.0)

    def grow_guide(j, root, bias_face=0.4):
        # s06 grow_guide body, verbatim; j indexes the retrace subset,
        # uu[j]/dstar[j] carry the ORIGINAL s06 depth fractions.
        nroot = rnorm[j]
        ds = dstar[j]
        travel = nroot / (np.linalg.norm(nroot) + 1e-12)
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
            _fn = d1 / (np.linalg.norm(d1) + 1e-12)
            _curl = float(np.degrees(np.arccos(np.clip(
                (_fn * ff).sum(), -1, 1))))
            if arc > RAMP_MM and _curl > 45.0:
                n_coast += 1
            else:
                ff = 0.2 * _fn + 0.8 * ff
                ff = ff / (np.linalg.norm(ff) + 1e-12)
            f = ff
            g = sdf_grad(pm)
            sd = float(s_sdf(pm[None, :], order=1)[0])
            if not np.isfinite(sd):
                sd = 0.0
            dd3 = float(s_Ddil(pm[None, :], order=1)[0])
            if not np.isfinite(dd3):
                dd3 = 0.0
            ddo = float(s_Docc(pm[None, :], order=1)[0])
            if not np.isfinite(ddo):
                ddo = 0.0
            S = np.zeros(3)
            _drop = float(root[2] - pm[2])
            _eff = max((_drop - 5.0) / 30.0, (arc - 45.0) / 30.0)
            _eff = float(0.5 - 0.5 * np.cos(
                np.clip(_eff, 0, 1) * np.pi))
            S = S + (0.02 + 0.06 * _eff) * np.array([0.0, 0.0, -1.0])
            if _eff > 0.5:
                n_gravfull += 1
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
            leader = arc <= RAMP_MM
            if g is not None:
                Sp = S - (S * g).sum() * g
                Tpm = float(np.clip(ddo + max(sd, 0.0), 1.0, 40.0))
                tgt = uu[j] * Tpm
                need = (tgt - sd) / 4.0
                lam_max = LAMBDA_LEADER_MAX if leader else LAMBDA_MAX
                lam = float(np.clip(need, -lam_max, lam_max))
                _tan = f + Sp
                _tn = np.linalg.norm(_tan)
                if _tn > 1e-9:
                    _al = float((_tan / _tn * travel).sum())
                    lam = lam * float(np.clip(_al, 0.0, 1.0))
                d1 = f + Sp + lam * g
                nn = np.linalg.norm(d1)
                d1 = d1 / nn if nn > 1e-9 else travel.copy()
            else:
                d1 = f + S
                nn = np.linalg.norm(d1)
                d1 = d1 / nn if nn > 1e-9 else travel.copy()
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
            _db = float(s_Ddil(pm[None, :], order=1)[0])
            _leader = arc <= RAMP_MM
            _cos = COS_LEADER if _leader else COS_MAIN
            q = p + d1 * STEP
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
            _reentry = (abs(rx0) >= 3.0
                        and q[0] * rx0 < 0 and abs(q[0]) > 2.0)
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
            if _reentry:
                d1[0] = abs(d1[0]) * np.sign(rx0) + 0.5 * np.sign(
                    rx0)
                d1 /= np.linalg.norm(d1) + 1e-12
                n_steer += 1
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
            d1, _hitF = turn_gate(d1, travel, _cos)
            n_gate += 1 if _hitF else 0
            q = p + d1 * STEP
            if arc > 8.0 and float(s_sdf(q[None, :], order=1)[0]) < 0.5:
                stop = "body"
                break
            if q[2] <= hem + 2.0:
                stop = "hem"
                p = q
                pts.append(p.copy())
                arc += STEP
                break
            if float(s_dil(q[None, :], order=0)[0]) < 0.5:
                if arc <= 8.0:
                    pass
                else:
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
        return (np.array(pts), stop, arc, n_gate, n_prior, n_steer,
                n_center, n_ride, n_earwin, n_pocket, n_gravfull,
                n_coast)

    curves, stops, lens = [], [], []
    ngate = []
    # s06 unit convention, verbatim: everything (roots, pinna, field
    # voxels, SDF grid) is in MILLIMETRES (hull xs ~ -252..120 mm,
    # egrid origin/spacing likewise). Samplers take mm points.
    print("SDF origin=%s spacing=%s" % (
        np.asarray(egrid["origin"]), np.asarray(egrid["spacing"])),
        flush=True)
    for j, root in enumerate(sroots):
        out = grow_guide(j, root, 0.4)
        curves.append(out[0])
        stops.append(out[1])
        lens.append(out[2])
        ngate.append(out[3])
        if (j + 1) % 100 == 0:
            print("grown %d/%d" % (j + 1, nrt), flush=True)
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
    print("RETRY face=%d" % n_retry, flush=True)
    lens = np.array(lens)

    # ---- 41-pt arc resample + head-mm (s06, verbatim; mm -> head) ----
    w2h = CO.world_to_head
    chk = CO.head_to_world(
        w2h(np.asarray(curves[0][:8]) / 1000.0, crown), crown) * 1000.0
    err = float(np.abs(chk - np.asarray(curves[0][:8])).max())
    print("HEAD roundtrip err=%.2e mm" % err, flush=True)
    assert err < 1e-6, err
    head = [w2h(c / 1000.0, crown) for c in curves]
    N41 = 41
    store = np.zeros((nrt, N41, 3))
    for j, c in enumerate(head):
        if len(c) < 2:
            store[j] = np.tile(c[0][None, :] if len(c) else sroots[j][None, :],
                               (N41, 1))
            continue
        seg = np.linalg.norm(np.diff(c, axis=0), axis=1)
        L = np.concatenate([[0.0], np.cumsum(seg)])
        if L[-1] < 1e-9:
            store[j] = np.tile(c[0][None, :], (N41, 1))
            continue
        tq = np.linspace(0, L[-1], N41)
        store[j] = np.stack(
            [np.interp(tq, L, c[:, k]) for k in range(3)], axis=1)

    # ---- assemble: FRONT/tuck byte-identical; BACK retraced + 40mm verbatim
    head_out = head_in.copy()
    seg19 = np.linalg.norm(np.diff(curves19, axis=1), axis=2)
    arc19 = np.concatenate([np.zeros((n, 1)), np.cumsum(seg19, axis=1)],
                           axis=1)
    verb_m = VERBATIM_MM / 1000.0
    k0 = (arc19 < verb_m).sum(axis=1).astype(int)
    for a, gi in enumerate(ridx):
        k = int(k0[gi])
        head_out[gi] = store[a]
        if k > 0:
            head_out[gi, :k] = head_in[gi, :k]
    world_out = FFF.head_to_world(head_out, crown)

    # ---- stats ----
    xc_in = crossing_count(curves19, crown, back_mask & ~tuck)
    xc_out = crossing_count(world_out, crown, back_mask & ~tuck)
    verb = arc19 < verb_m
    n_verb = int(verb.sum())
    exact_take = bool(np.array_equal(head_out[verb], head_in[verb]))
    max_abs_take = float(np.abs(head_out[verb] - head_in[verb]).max()) \
        if n_verb else 0.0
    front_m = ~retraced_mask
    exact_front = bool(np.array_equal(head_out[front_m], head_in[front_m]))
    max_abs_front = float(np.abs(head_out[front_m] - head_in[front_m]).max())
    h = hashlib.sha256()
    h.update(np.ascontiguousarray(head_out).tobytes())
    out_hash = h.hexdigest()
    h2 = hashlib.sha256()
    h2.update(np.ascontiguousarray(head_in).tobytes())
    in_hash = h2.hexdigest()
    moved = np.linalg.norm(world_out[ridx] - curves19[ridx], axis=2).max(
        axis=1) * 1000.0

    stats = {
        "schema": "openclinxr.hair-guide-back-retrace.v1",
        "method": "s06_depthgrow tracer verbatim on smoothed BACK field; "
                  "same roots, same depth fractions (golden stride by "
                  "original s06 index), verbatim 40mm take-off; FRONT + "
                  "tuck byte-identical guides-19",
        "field": str(args.field),
        "sourceGuides": str(args.guides),
        "retraced": int(nrt), "frontTuckRows": int(front_m.sum()),
        "guides": {"input": int(n), "output": int(n), "deleted": 0,
                   "inputSha256": in_hash, "outputSha256": out_hash},
        "stops": {s: int(stops.count(s)) for s in set(stops)},
        "lengthsMm": distribution(lens),
        "guideMaxMoveMmBACK": distribution(moved),
        "turnGateRelaxSteps": int(sum(ngate)),
        "crossingBACKNonTuck": {
            "input": xc_in, "output": xc_out,
            "gate30pct": 2914,
            "pass": bool(xc_out["nCrossPairs"] <= 2914)},
        "takeoff": {"verbatimMm": VERBATIM_MM, "verbatimSamples": n_verb,
                    "byteIdentical": exact_take,
                    "maxAbsDiffHeadMm": max_abs_take,
                    "pass": bool(exact_take)},
        "frontIdentical": {"rows": int(front_m.sum()),
                           "byteIdentical": exact_front,
                           "maxAbsDiffHeadMm": max_abs_front,
                           "pass": bool(exact_front)},
        "depthU": {"rule": "0.3+0.6*((j*PHI)%1), j=original s06 index",
                   "p50": round(float(np.percentile(uu, 50)), 4),
                   "p90": round(float(np.percentile(uu, 90)), 4)},
        "seconds": round(time.time() - t0, 1),
    }
    payload = {k: np.asarray(src[k]) for k in src.files}
    payload["curves_head"] = head_out.astype(np.float64)
    payload["spec_sha"] = np.array(["retrace22back"])
    payload["verdict"] = np.array(["RETRACE22BACK"])
    payload["roots_file"] = np.array([
        "guides-19 BACK re-trace through smoothed field (s06 tracer "
        "verbatim, same roots/depth fractions, 40mm verbatim take-off); "
        "FRONT + tuck byte-identical guides-19"])
    np.savez_compressed(str(E / (args.stem + ".npz")), **payload)
    (E / (args.stem + "-retrace.json")).write_text(
        json.dumps(stats, indent=1) + "\n")
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
