#!/usr/bin/env python3
"""STEP 2: 3D orientation field on hull3's voxels (Wei et al. 2005 pattern).

Domain: hull occupancy dilated by 4 mm (2 voxels at 2.0 mm spacing; the
tucked side shell is thin, so the undilated rind would starve the field).

Per voxel, per view where it constrains (state INSIDE_MASK i.e. 0 = not
BODY_OCCLUDED and inside the mask, in-frame, map confidence >= floor
0.30): form the plane through the camera centre containing the projected
2D strand line. Plane normal n_v = normalize(cross(P - C, R^T d)) with
d = (t_u/f, -t_v/f, 0) the lifted image tangent, (t_u,t_v) = (-sin a,
cos a) from the filter angle a (s01 mapping), f the focal px, R the
world->cam rotation, C the camera centre (world m).

Voxel direction: unit vector minimising sum_v w_v (t . n_v)^2 =
smallest eigenvector of M = sum_v w_v n_v n_v^T, w_v = confidence.
Eigen-gap g = (l1 - l0) / max(trace, eps), trace = sum w.

Fewer than 2 views or small gap -> blend toward prior. Prior: lateral
away from the centre part on the scalp tangent (nearest-root side,
projected perp the root normal), cosine-blended to gravity over 15-45 mm
drop below the root (gates1.expected_flow release, same numbers).
Blend weight beta = min(nviews,2)/2 * clip(g/0.2, 0, 1) (stated; gap0 =
0.2). Data vector pre-aligned to the prior; final sign: flip so t points
away-from-part-then-downward (dot with normalize(lat_away + (0,0,-1))
>= 0).

Smooth: one 3x3x3 box pass with per-neighbour sign alignment to the
centre vector, renormalised (stated).

Residuals: reprojected 3D direction vs each constraining view's 2D map
(p50/p95 per view, unweighted). Output E/field.npz.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

S10 = Path(__file__).resolve().parent
sys.path.insert(0, str(S10))
import common_o as CO  # noqa: E402

DIL_MM = 4.0
CONF_FLOOR = 0.30
GAP0 = 0.2


def unpack_state(packed, vi):
    return (np.asarray(packed, dtype=np.int64) // (3 ** vi)) % 3


def main():
    t0 = time.time()
    CO.track(S10 / "s02_field.py")
    inp = CO.load_all()
    o2 = np.load(str(CO.E0 / "orient2d.npz"))
    hull = inp["hull"]
    xs = np.array(hull["xs"], dtype=np.float64)
    ys = np.array(hull["ys"], dtype=np.float64)
    zs = np.array(hull["zs"], dtype=np.float64)
    spacing = float(hull["spacing"])
    occ = np.array(hull["occupancy"], dtype=bool)
    assert abs(spacing - 2.0) < 1e-9, spacing
    # Hull-view map (hair-groom1 card): hull3 carries exactly VIEWS4 but
    # hull5 carries 6 views (L/R-symmetric + mirrors). The four scoring
    # views must index their own packed states, not positions 0..3.
    hviews = [str(v) for v in hull["views"]]
    assert all(v in hviews for v in CO.VIEWS4), hviews
    vidx = {v: hviews.index(v) for v in CO.VIEWS4}

    from scipy import ndimage
    dil_iter = int(round(DIL_MM / spacing))
    dil = ndimage.binary_dilation(occ, iterations=dil_iter)
    idx = np.argwhere(dil).astype(np.int64)  # (N,3) x,y,z
    n = len(idx)
    xyz_mm = np.stack([xs[idx[:, 0]], ys[idx[:, 1]], zs[idx[:, 2]]],
                      axis=1)
    P = xyz_mm / 1000.0  # world m
    print("FIELD occ=%d dil=%d (dil_mm=%.1f)" % (int(occ.sum()), n,
                                                DIL_MM), flush=True)

    packed = np.array(hull["states_packed"])
    cams, sensor = inp["cams"], inp["sensor"]
    M = np.zeros((n, 3, 3), dtype=np.float64)
    W = np.zeros(n, dtype=np.float64)
    NV = np.zeros(n, dtype=np.int64)
    # per-view constraint mask + sampled angle for residuals
    cons = {}
    for vi, view in enumerate(CO.VIEWS4):
        cam = cams["views"][view]
        mat = np.array(cam["matrixWorld"], dtype=np.float64)
        Rw2c = np.linalg.inv(mat)[:3, :3]
        C = mat[:3, 3]
        f = float(cam["lensMm"]) / float(sensor) * 1024.0
        cols, rows, dep = CO.C2.ENV.project_to_render(P, cam, sensor)
        infr = ((cols >= 0) & (cols < 1024) & (rows >= 0)
                & (rows < 1024) & (dep > 0))
        st = unpack_state(packed, vidx[view])[idx[:, 0], idx[:, 1],
                                                   idx[:, 2]]
        ci = np.clip(np.rint(cols).astype(np.int64), 0, 1023)
        ri = np.clip(np.rint(rows).astype(np.int64), 0, 1023)
        ang = np.array(o2[view + "/angle"])
        cf = np.array(o2[view + "/conf"])
        w = np.where(infr, cf[ri, ci], 0.0)
        use = infr & (st == 0) & (w >= CONF_FLOOR)
        cons[view] = use
        print("FIELD view=%s inside=%d constrain=%d (floor %.2f)" % (
            view, int((st == 0).sum()), int(use.sum()), CONF_FLOOR),
            flush=True)
        if use.sum() == 0:
            continue
        a = np.deg2rad(ang[ri[use], ci[use]].astype(np.float64))
        tu, tv = -np.sin(a), np.cos(a)
        dcam = np.stack([tu / f, -tv / f, np.zeros_like(tu)], axis=1)
        dw = dcam @ Rw2c  # R^T d  (row-vector convention)
        ray = P[use] - C
        nv = np.cross(ray, dw)
        nl = np.linalg.norm(nv, axis=1)
        nl[nl == 0] = 1.0
        nv /= nl[:, None]
        wu = w[use]
        M[use] += wu[:, None, None] * nv[:, :, None] * nv[:, None, :]
        W[use] += wu
        NV[use] += 1

    lam, vec = np.linalg.eigh(M)
    t_data = vec[:, :, 0]
    trace = np.maximum(lam.sum(axis=1), 1e-12)
    gap = (lam[:, 1] - lam[:, 0]) / trace

    # Prior: away-from-part scalp tangent -> gravity (15-45 mm cosine).
    roots = np.array(inp["roots"]["xyz"],
                     dtype=np.float64) * 1000.0  # world m -> mm
    nr = np.array(inp["roots"]["normal"], dtype=np.float64)
    nr /= np.linalg.norm(nr, axis=1, keepdims=True) + 1e-12
    tree = cKDTree(roots)
    _, ji = tree.query(xyz_mm, k=1)
    rx = roots[ji, 0]
    side = np.where(rx >= 0, 1.0, -1.0)
    nn = nr[ji]
    lat = np.stack([side, np.zeros(n), np.zeros(n)], axis=1)
    lat = lat - (lat * nn).sum(axis=1, keepdims=True) * nn
    bad = np.linalg.norm(lat, axis=1) < 1e-6
    nb = int(bad.sum())
    lat[bad] = np.stack([side[bad], np.zeros(nb),
                         np.zeros(nb)], axis=1)
    lat /= np.linalg.norm(lat, axis=1, keepdims=True) + 1e-12
    # groom2: taper the lateral part-away near the midline
    # (|x| <= 8 mm -> none, full beyond 20 mm). The side label is
    # meaningless at the part line itself; an untapered prior splays
    # crown guides wider than the target part (render 21-26 px vs
    # target 5-9 px at back rows 160-200). Tapered voxels fall back to
    # gravity (down), letting confident data (not the prior) set the
    # part divergence.
    wlat = np.clip((np.abs(xyz_mm[:, 0]) - 8.0) / 12.0, 0, 1)
    lat_t = lat * wlat[:, None]
    g = np.array([0.0, 0.0, -1.0])
    drop = roots[ji, 2] - xyz_mm[:, 2]
    ab = np.clip((drop - 15.0) / 30.0, 0, 1)
    ab = 0.5 - 0.5 * np.cos(ab * np.pi)
    prior = ((1 - ab)[:, None] * lat_t
             + (((1 - ab) * (1 - wlat)) + ab)[:, None]
             * np.broadcast_to(g, (n, 3)))
    prior /= np.linalg.norm(prior, axis=1, keepdims=True) + 1e-12

    sgn = np.where((t_data * prior).sum(axis=1) >= 0, 1.0, -1.0)
    t_data *= sgn[:, None]
    beta = (np.minimum(NV, 2) / 2.0) * np.clip(gap / GAP0, 0, 1)
    t = beta[:, None] * t_data + (1 - beta)[:, None] * prior
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-12
    ref = lat_t + np.broadcast_to(g, (n, 3))
    ref /= np.linalg.norm(ref, axis=1, keepdims=True) + 1e-12
    flip = (t * ref).sum(axis=1) < 0
    t[flip] *= -1.0

    # One 3x3x3 box smooth with sign alignment, renormalised.
    shape = dil.shape
    dense = np.zeros(shape + (3,), dtype=np.float32)
    dense[idx[:, 0], idx[:, 1], idx[:, 2]] = t.astype(np.float32)
    acc = np.zeros_like(dense)
    cnt = np.zeros(shape, dtype=np.float32)
    tc = dense
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                sh = np.roll(np.roll(np.roll(dense, dx, 0), dy, 1),
                             dz, 2)
                valid = np.roll(np.roll(np.roll(dil, dx, 0), dy, 1),
                                dz, 2) & dil
                s = np.sign((sh * tc).sum(axis=-1))
                s[~valid] = 0.0
                acc += sh * s[..., None] * valid[..., None]
                cnt += valid.astype(np.float32)
    ts = acc / np.maximum(cnt, 1)[..., None]
    ts /= np.linalg.norm(ts, axis=-1, keepdims=True) + 1e-12
    t = ts[idx[:, 0], idx[:, 1], idx[:, 2]].astype(np.float64)

    # Residuals: reproject t vs each constraining view's map.
    resid = {}
    for vi, view in enumerate(CO.VIEWS4):
        use = cons[view]
        if use.sum() == 0:
            resid[view] = {"n": 0}
            continue
        cam = cams["views"][view]
        mat = np.array(cam["matrixWorld"], dtype=np.float64)
        C = mat[:3, 3]
        P2 = P[use] + t[use] * 0.002  # +2 mm along t
        c0, r0, _ = CO.C2.ENV.project_to_render(P[use], cam, sensor)
        c1, r1, _ = CO.C2.ENV.project_to_render(P2, cam, sensor)
        du, dv = c1 - c0, r1 - r0
        ok = (np.hypot(du, dv) > 1e-9)
        ap = np.mod(np.degrees(np.arctan2(-du[ok], dv[ok])), 180.0)
        ci = np.clip(np.rint(c0[ok]).astype(np.int64), 0, 1023)
        ri = np.clip(np.rint(r0[ok]).astype(np.int64), 0, 1023)
        am = np.array(o2[view + "/angle"])[ri, ci].astype(np.float64)
        d = np.abs(ap - am)
        d = np.minimum(d, 180.0 - d)
        resid[view] = {"n": int(ok.sum()),
                       "p50": round(float(np.percentile(d, 50)), 2),
                       "p95": round(float(np.percentile(d, 95)), 2),
                       "mean": round(float(d.mean()), 2)}
        print("RESID %s n=%d p50=%.1f p95=%.1f mean=%.1f" % (
            view, resid[view]["n"], resid[view]["p50"],
            resid[view]["p95"], resid[view]["mean"]), flush=True)

    hist = {int(k): int((NV == k).sum()) for k in range(5)}
    print("NVIEW-HIST " + json.dumps(hist), flush=True)
    print("GAP p10/50/90 " + json.dumps(
        [round(float(v), 3) for v in np.percentile(gap, [10, 50, 90])]),
        flush=True)
    print("BETA mean %.3f frac-pure-prior %.3f" % (
        float(beta.mean()), float((beta == 0).mean())), flush=True)

    CO.E0.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        str(CO.E0 / "field.npz"), idx=idx, xyz_mm=xyz_mm, dir=t,
        prior=prior.astype(np.float32), nviews=NV.astype(np.uint8),
        gap=gap.astype(np.float32), beta=beta.astype(np.float32),
        xs=xs, ys=ys, zs=zs, spacing=np.array(spacing),
        dilation_mm=np.array(DIL_MM), conf_floor=np.array(CONF_FLOOR),
        gap0=np.array(GAP0),
        blend=np.array(["beta=min(nviews,2)/2*clip(gap/0.2,0,1); "
                        "one 3x3x3 sign-aligned box smooth"]),
        resid=np.array([json.dumps(resid)]),
        nview_hist=np.array([json.dumps(hist)]))
    CO.write_inputs_log([S10 / "s02_field.py", CO.E0 / "field.npz"])
    print("STEP2 done in %.0fs" % (time.time() - t0), flush=True)


if __name__ == "__main__":
    main()
