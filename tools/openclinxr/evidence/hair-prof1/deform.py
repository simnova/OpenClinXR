#!/usr/bin/env python3
"""hair-prof1 STEP 2 deformations: one targeted construction change per
top where.json region, each a separate cell on b9 (=tilt5 s5 repaired).

View-axis decoupling (verified from camera geometry):
  profile cols <-> world y (depth); front/back cols <-> world x (lateral).
  => y-shifts fix profile invisibly to front/back; x-shifts fix front
     invisibly to profile.

Cells (roots/radii fixed; points deformed; repair afterwards):
  c_pb profile back_edge  (guide-equivalent surface shift): rear fibres
         anterior (-y) 25 mm rigid beyond 150 mm arc fade. Target: six-height
         deltas -23..-28 mm rows 250-610 (row 700 needs -51, accepted partial).
  c_pf profile front_edge (guide-equivalent surface shift): anterior curtain
         (y < -0.05) posterior (+y) 10 mm, z-tapered to 0 at crown (z>=1.64)
         and hem (z<=1.38), 150 mm arc fade. Target: front-edge deltas
         +9..+17 mm rows 240-360, +5..+8 rows 420-540.
  c_fo front lower_outer  (children-equivalent lateral extension): curtain
         fibres with |root_x| > 0.055, points pushed outward +/-x by 10 mm
         x full below z=1.46, 0 above z=1.51 (eye row z=1.552 untouched;
         inner curtain roots untouched -> jaw/eye openings preserved).
  c_fc front eye_cheek    (children-equivalent medial extension, gate-capped):
         points near |x|=62 mm pulled medially 3 mm peak at z~1.51, 0 above
         z=1.543 (eye row 356 + closing smear protected) and 0 below z=1.48
         (jaw row 562 protected).

System python (numpy only). Operates on b9 repaired points; guides untouched.
"""
from __future__ import annotations

import numpy as np


def smooth(v):
    v = np.clip(v, 0.0, 1.0)
    return v * v * (3.0 - 2.0 * v)


def arc(points):
    return np.concatenate([np.zeros((len(points), 1)),
                           np.cumsum(np.linalg.norm(np.diff(points, axis=1), axis=2), axis=1)], axis=1)


def stats(out, pts):
    t0 = np.gradient(pts, axis=1)
    t0 /= np.maximum(np.linalg.norm(t0, axis=2, keepdims=True), 1e-9)
    t1 = np.gradient(out, axis=1)
    t1 /= np.maximum(np.linalg.norm(t1, axis=2, keepdims=True), 1e-9)
    ang = np.degrees(np.arccos(np.clip((t0 * t1).sum(axis=2), -1.0, 1.0)))
    disp = np.linalg.norm(out - pts, axis=2) * 1000.0
    return {"tangentRms": float(np.sqrt(np.mean(ang ** 2))),
            "tangentP95": float(np.percentile(ang, 95)),
            "tangentMax": float(ang.max()),
            "dispP50": float(np.percentile(disp.max(axis=1), 50)),
            "dispP95": float(np.percentile(disp.max(axis=1), 95)),
            "dispMax": float(disp.max())}


def endpoint_stats(points):
    vec = points[:, -1] - points[:, -5]
    deg = np.degrees(np.arctan2(np.linalg.norm(vec[:, :2], axis=1),
                                np.abs(vec[:, 2]) + 1e-12))
    return {"p50": float(np.percentile(deg, 50)),
            "p95": float(np.percentile(deg, 95)),
            "max": float(deg.max())}


def fade_arc(pts, length=0.15):
    return smooth(arc(pts) / length)


def c_pb(points, roots, apex):
    """Rear sheet 25 mm anterior, 150 mm root fade."""
    out = np.asarray(points, float).copy()
    rear = np.asarray(roots)[:, 1] > float(apex)
    w = fade_arc(out)
    out[rear, :, 1] -= 0.025 * w[rear]
    return out, {"cell": "c_pb", "dy": -0.025, "fadeArcMm": 150.0,
                 "rearFibres": int(rear.sum())}


def c_pf(points, roots, apex):
    """Anterior curtain (+y zone) 10 mm posterior, crown/hem tapered."""
    pts = np.asarray(points, float).copy()
    rear = np.asarray(roots)[:, 1] > float(apex)
    cur = ~rear
    z = pts[:, :, 2]
    ztaper = smooth((1.64 - z) / 0.03) * smooth((z - 1.38) / 0.04)
    anterior = smooth((-0.05 - pts[:, :, 1]) / 0.03)
    w = fade_arc(pts) * ztaper * anterior
    w[rear] = 0.0
    out = pts.copy()
    out[cur, :, 1] += 0.010 * w[cur]
    return out, {"cell": "c_pf", "dy": 0.010, "fadeArcMm": 150.0,
                 "note": "y<-0.05 zone; taper 0 at z>=1.64 / z<=1.38"}


def c_fo(points, roots, apex):
    """Outer curtain (|root_x|>55mm) lateral +10 mm below z 1.46-1.51."""
    pts = np.asarray(points, float).copy()
    rear = np.asarray(roots)[:, 1] > float(apex)
    outer = (~rear) & (np.abs(np.asarray(roots)[:, 0]) > 0.055)
    z = pts[:, :, 2]
    zband = smooth((1.51 - z) / 0.05)
    w = fade_arc(pts) * zband
    w[~outer, :] = 0.0
    sgn = np.sign(pts[:, :, 0])
    sgn[sgn == 0.0] = 1.0
    out = pts.copy()
    out[outer, :, 0] += (sgn * 0.010 * w)[outer]
    return out, {"cell": "c_fo", "dx": 0.010, "rootSelMm": 55.0,
                 "zband": "0 above 1.51, full below 1.46"}


def c_fc(points, roots, apex):
    """Inner-edge cheek fibres (|x|~62mm) medial 3 mm at z~1.51."""
    pts = np.asarray(points, float).copy()
    rear = np.asarray(roots)[:, 1] > float(apex)
    ax = np.abs(pts[:, :, 0])
    xband = np.exp(-((ax - 0.062) / 0.012) ** 2)
    z = pts[:, :, 2]
    zband = smooth((1.543 - z) / 0.010) * smooth((z - 1.48) / 0.015)
    w = fade_arc(pts) * xband * zband
    w[rear] = 0.0
    sgn = np.sign(pts[:, :, 0])
    sgn[sgn == 0.0] = 1.0
    out = pts.copy()
    out[:, :, 0] -= sgn * 0.003 * w
    return out, {"cell": "c_fc", "dxMedial": 0.003, "xbandMm": "gauss 62+-12",
                 "zband": "0 above 1.543 / below 1.48, peak ~1.51"}


def c_pf2(points, roots, apex):
    """c_pf retry: same +10 mm posterior target, gentler spatial spectrum.

    c_pf scored profile +0.012 but front orientation +1.18 (>1 KEEP bar).
    Longer arc fade (250 mm) + wider z-taper blends cut shear tilt while
    keeping the outline displacement.
    """
    pts = np.asarray(points, float).copy()
    rear = np.asarray(roots)[:, 1] > float(apex)
    cur = ~rear
    z = pts[:, :, 2]
    ztaper = smooth((1.64 - z) / 0.06) * smooth((z - 1.38) / 0.08)
    anterior = smooth((-0.05 - pts[:, :, 1]) / 0.06)
    w = fade_arc(pts, 0.25) * ztaper * anterior
    w[rear] = 0.0
    out = pts.copy()
    out[cur, :, 1] += 0.010 * w[cur]
    return out, {"cell": "c_pf2", "dy": 0.010, "fadeArcMm": 250.0,
                 "note": "gentler retry of c_pf (front ori 1.18->target <1.0)"}


def c_fo2(points, roots, apex):
    """c_fo retry: margin-capped lateral extension, back-safe by construction.

    c_fo scored front +0.018 but back -0.024 (widened curtain poked beyond
    the rear sheet at low z). Per-point shift = clip(rearMaxX(z)-5mm-|x|,
    0, 8mm): never exceeds 5 mm inside the rear surface, so the rear sheet
    keeps occluding it from behind. Outer curtain roots only (|root_x|>55).
    """
    pts = np.asarray(points, float).copy()
    r = np.asarray(roots)
    rear = r[:, 1] > float(apex)
    # rear |x| ceiling per 10 mm z-bin
    zr = pts[rear][:, :, 2].ravel()
    xr = np.abs(pts[rear][:, :, 0]).ravel()
    zbins = np.arange(1.30, 1.70, 0.01)
    idx = np.clip(np.digitize(zr, zbins) - 1, 0, len(zbins) - 2)
    ceil = np.full(len(zbins) - 1, -1.0)
    for b in range(len(ceil)):
        sel = xr[idx == b]
        ceil[b] = float(sel.max()) if len(sel) else -1.0
    # fill empty bins by nearest filled
    for b in range(len(ceil)):
        if ceil[b] < 0:
            near = np.where(ceil >= 0)[0]
            ceil[b] = float(ceil[near[np.argmin(np.abs(near - b))]])
    z = pts[:, :, 2]
    zi = np.clip(np.digitize(z, zbins) - 1, 0, len(ceil) - 1)
    cap = ceil[zi] - 0.005 - np.abs(pts[:, :, 0])
    outer = (~rear) & (np.abs(r[:, 0]) > 0.055)
    zband = smooth((1.51 - z) / 0.05)
    want = np.minimum(0.008 * fade_arc(pts) * zband, np.maximum(cap, 0.0))
    want[~outer, :] = 0.0
    sgn = np.sign(pts[:, :, 0])
    sgn[sgn == 0.0] = 1.0
    out = pts.copy()
    out[outer, :, 0] += (sgn * want)[outer]
    applied = want[outer]
    return out, {"cell": "c_fo2", "dxMax": 0.008, "rootSelMm": 55.0,
                 "capRule": "rearMaxX(z)-5mm-|x|, floor 0",
                 "appliedP50Mm": float(np.percentile(applied, 50) * 1000.0),
                 "appliedP95Mm": float(np.percentile(applied, 95) * 1000.0)}


def c_fc2(points, roots, apex):
    """c_fc retry: 6 mm peak + wider plateau (c_fc +0.004 clean, eye/jaw 0)."""
    pts = np.asarray(points, float).copy()
    rear = np.asarray(roots)[:, 1] > float(apex)
    ax = np.abs(pts[:, :, 0])
    xband = np.exp(-((ax - 0.062) / 0.014) ** 2)
    z = pts[:, :, 2]
    zband = smooth((1.543 - z) / 0.010) * smooth((z - 1.48) / 0.015)
    plateau = 0.5 + 0.5 * smooth((0.012 - np.abs(z - 1.5125)) / 0.008)
    w = fade_arc(pts) * xband * zband * plateau
    w[rear] = 0.0
    sgn = np.sign(pts[:, :, 0])
    sgn[sgn == 0.0] = 1.0
    out = pts.copy()
    out[:, :, 0] -= sgn * 0.006 * w
    return out, {"cell": "c_fc2", "dxMedial": 0.006,
                 "note": "c_fc at 2x + plateau z 1.50-1.525"}


def _rear_ceiling(pts, roots, apex):
    """rear max|x| per 10 mm z-bin (for back-occlusion caps)."""
    r = np.asarray(roots)
    rear = r[:, 1] > float(apex)
    zr = pts[rear][:, :, 2].ravel()
    xr = np.abs(pts[rear][:, :, 0]).ravel()
    zbins = np.arange(1.30, 1.70, 0.01)
    idx = np.clip(np.digitize(zr, zbins) - 1, 0, len(zbins) - 2)
    ceil = np.full(len(zbins) - 1, -1.0)
    for b in range(len(ceil)):
        sel = xr[idx == b]
        ceil[b] = float(sel.max()) if len(sel) else -1.0
    for b in range(len(ceil)):
        if ceil[b] < 0:
            near = np.where(ceil >= 0)[0]
            ceil[b] = float(ceil[near[np.argmin(np.abs(near - b))]])
    return zbins, ceil


def c_fo3(points, roots, apex):
    """c_fo retry 2: full +10 mm band extended down, poke capped at +2 mm.

    c_fo (uncapped) front +0.018/back -0.024; c_fo2 (poke<=rear-5) neutered
    to +0.0036. c_fo3 allows up to 2 mm beyond the rear surface with the
    full +10 mm wherever rear covers: shift = min(10*band, rearMax+2-|x|).
    """
    pts = np.asarray(points, float).copy()
    r = np.asarray(roots)
    rear = r[:, 1] > float(apex)
    zbins, ceil = _rear_ceiling(pts, roots, apex)
    z = pts[:, :, 2]
    zi = np.clip(np.digitize(z, zbins) - 1, 0, len(ceil) - 1)
    cap = ceil[zi] + 0.002 - np.abs(pts[:, :, 0])
    outer = (~rear) & (np.abs(r[:, 0]) > 0.055)
    band = smooth((1.53 - z) / 0.04)
    want = np.minimum(0.010 * fade_arc(pts) * band, np.maximum(cap, 0.0))
    want[~outer, :] = 0.0
    sgn = np.sign(pts[:, :, 0])
    sgn[sgn == 0.0] = 1.0
    out = pts.copy()
    out[outer, :, 0] += (sgn * want)[outer]
    applied = want[outer]
    return out, {"cell": "c_fo3", "dxMax": 0.010, "rootSelMm": 55.0,
                 "capRule": "min(10*band, rearMaxX(z)+2mm-|x|), floor 0",
                 "appliedP50Mm": float(np.percentile(applied, 50) * 1000.0),
                 "appliedP95Mm": float(np.percentile(applied, 95) * 1000.0)}


def c_fc3(points, roots, apex):
    """c_fc retry 2: root-selected face-framing locks, wider plateau.

    c_fc2's x-gaussian underweighted the visible edge (peak 62 vs edge 67)
    and saturated at +0.0045. c_fc3 selects whole lock fibres by root
    (40-80 mm), uniform 5 mm medial over plateau z 1.495-1.535.
    """
    pts = np.asarray(points, float).copy()
    r = np.asarray(roots)
    rear = r[:, 1] > float(apex)
    lock = (~rear) & (np.abs(r[:, 0]) > 0.040) & (np.abs(r[:, 0]) < 0.080)
    z = pts[:, :, 2]
    plateau = smooth((1.543 - z) / 0.008) * smooth((z - 1.48) / 0.015)
    edge = 0.5 + 0.5 * smooth((0.020 - np.abs(z - 1.515)) / 0.010)
    w = fade_arc(pts) * plateau * edge
    w[~lock, :] = 0.0
    sgn = np.sign(pts[:, :, 0])
    sgn[sgn == 0.0] = 1.0
    out = pts.copy()
    out[lock, :, 0] -= (sgn * 0.005 * w)[lock]
    return out, {"cell": "c_fc3", "dxMedial": 0.005,
                 "rootSelMm": "40-80 curtain",
                 "zband": "plateau 1.495-1.535, 0 above 1.543 / below 1.48"}


def c_cr1(points, roots, apex):
    """Crown lowering: cap zone (z>1.60) down up to 7 mm (cross-view).

    where.json: profile crown_top FP 6371 (ours above TS crown row 125);
    front part_crown FP 3553. One -z shift of the cap fixes both (+back top).
    Roots untouched (part gap safe); tips untouched (end angle safe).
    """
    pts = np.asarray(points, float).copy()
    z = pts[:, :, 2]
    w = smooth((z - 1.60) / 0.02)
    out = pts.copy()
    out[:, :, 2] -= 0.007 * w
    return out, {"cell": "c_cr1", "dz": -0.007,
                 "zone": "0 at z<=1.60, full above 1.62"}
def c_fo4(points, roots, apex):
    """c_fo retry 3: zero-poke cap (c_fo3 front +0.023/back -0.0127).

    c_fo (uncapped) front +0.018/back -0.024; c_fo2 (poke<=rear-5) neutered
    to +0.0036. c_fo3 allows up to 2 mm beyond the rear surface with the
    full +10 mm wherever rear covers: shift = min(10*band, rearMax+2-|x|).
    """
    pts = np.asarray(points, float).copy()
    r = np.asarray(roots)
    rear = r[:, 1] > float(apex)
    zbins, ceil = _rear_ceiling(pts, roots, apex)
    z = pts[:, :, 2]
    zi = np.clip(np.digitize(z, zbins) - 1, 0, len(ceil) - 1)
    cap = ceil[zi] + 0.000 - np.abs(pts[:, :, 0])
    outer = (~rear) & (np.abs(r[:, 0]) > 0.055)
    band = smooth((1.53 - z) / 0.04)
    want = np.minimum(0.010 * fade_arc(pts) * band, np.maximum(cap, 0.0))
    want[~outer, :] = 0.0
    sgn = np.sign(pts[:, :, 0])
    sgn[sgn == 0.0] = 1.0
    out = pts.copy()
    out[outer, :, 0] += (sgn * want)[outer]
    applied = want[outer]
    return out, {"cell": "c_fo4", "dxMax": 0.010, "rootSelMm": 55.0,
                 "capRule": "min(10*band, rearMaxX(z)+0mm-|x|), floor 0",
                 "appliedP50Mm": float(np.percentile(applied, 50) * 1000.0),
                 "appliedP95Mm": float(np.percentile(applied, 95) * 1000.0)}


def c_fc3(points, roots, apex):
    """c_fc retry 2: root-selected face-framing locks, wider plateau.

    c_fc2's x-gaussian underweighted the visible edge (peak 62 vs edge 67)
    and saturated at +0.0045. c_fc3 selects whole lock fibres by root
    (40-80 mm), uniform 5 mm medial over plateau z 1.495-1.535.
    """
    pts = np.asarray(points, float).copy()
    r = np.asarray(roots)
    rear = r[:, 1] > float(apex)
    lock = (~rear) & (np.abs(r[:, 0]) > 0.040) & (np.abs(r[:, 0]) < 0.080)
    z = pts[:, :, 2]
    plateau = smooth((1.543 - z) / 0.008) * smooth((z - 1.48) / 0.015)
    edge = 0.5 + 0.5 * smooth((0.020 - np.abs(z - 1.515)) / 0.010)
    w = fade_arc(pts) * plateau * edge
    w[~lock, :] = 0.0
    sgn = np.sign(pts[:, :, 0])
    sgn[sgn == 0.0] = 1.0
    out = pts.copy()
    out[lock, :, 0] -= (sgn * 0.005 * w)[lock]
    return out, {"cell": "c_fc3", "dxMedial": 0.005,
                 "rootSelMm": "40-80 curtain",
                 "zband": "plateau 1.495-1.535, 0 above 1.543 / below 1.48"}


def c_cr1(points, roots, apex):
    """Crown lowering: cap zone (z>1.60) down up to 7 mm (cross-view).

    where.json: profile crown_top FP 6371 (ours above TS crown row 125);
    front part_crown FP 3553. One -z shift of the cap fixes both (+back top).
    Roots untouched (part gap safe); tips untouched (end angle safe).
    """
    pts = np.asarray(points, float).copy()
    z = pts[:, :, 2]
    w = smooth((z - 1.60) / 0.02)
    out = pts.copy()
    out[:, :, 2] -= 0.007 * w
    return out, {"cell": "c_cr1", "dz": -0.007,
                 "zone": "0 at z<=1.60, full above 1.62"}
