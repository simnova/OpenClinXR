#!/usr/bin/env python3
"""Rear-only independent lean-return with strength/length variants (hair-tilt5).

Lineage: entire hair-tilt4/wave.py kept verbatim below; tilt5 adds
apply_lean_return_rear_held (generic hold fraction) and
apply_curtain_below_jaw (curtain-only lean below a world-z jaw line).

Lineage: helpers (arc, smooth, sheet_frames, frame_dirs, phase_field,
clamp_ends_vertical, endpoint_stats, part_gap, apply_long_wave,
apply_lean_return) are verbatim from hair-tilt3/wave.py. Tilt4 adds:

  rear_mask(roots, apex): roots[:,1] > apex (37647/69181 fibres in a1).
    Curtain = the rest (31534 front fibres), left exactly as a1.

  theta_field(roots_xy, spacing_m=0.010, seed=0): bundle-coherent lean
    angles. Gaussian N(0,1) lattice noise on a `spacing_m` grid over the
    root bounding box, bilinearly interpolated at each root (same sampler
    as phase_field, ~10 mm correlation length), then rescaled so the
    realised std over the REAR fibres equals 1.0; caller multiplies by
    sigma. Neighbours lean together, so the outline moves as a sheet.

  apply_lean_return_rear(points, roots, cx, apex, sigma_deg, seed,
    coherent): per-fibre lean-return (tilt3 convention: theta held as
    s*tan(theta) for the first 60% of arc, smooth return over last 40%,
    3 mm part protection, 15 mm fade-in, roots fixed, in-plane sheet
    direction) applied ONLY to rear fibres. Curtain fibres are bitwise
    identical to the input. Coherent=True draws theta from theta_field
    (10 mm); False draws independent N(0,sigma) per fibre (tilt3 LR).

  compensate_outline(a1, leaned, roots, cx, apex, nbins=12): silhouette
    compensation. Per z-bin over the a1 rear sheet, half-width =
    p99(|x - med_a1|) with med_a1 the bin median (local sheet
    centreline). Ratio = a1_half / leaned_half (capped at 1.0: pull in
    only). Each rear point moves to med_a1 + (leaned_x - med_a1)*ratio
    of its bin (y,z untouched). Curtain untouched. Tips are ~fixed
    because tip displacement is already 0, so tip-bin ratios are ~1.

System python (numpy only). Operates on finished a1 points/roots;
guides untouched.
"""
from __future__ import annotations

import numpy as np


def smooth(value):
    value = np.clip(value, 0.0, 1.0)
    return value * value * (3.0 - 2.0 * value)


def arc(points):
    return np.concatenate([np.zeros((len(points), 1)),
                           np.cumsum(np.linalg.norm(np.diff(points, axis=1), axis=2), axis=1)], axis=1)


def sheet_frames(points, cx):
    tangent = np.gradient(points, axis=1)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=2, keepdims=True), 1e-9)
    radial = points.copy()
    radial[:, :, 0] -= cx
    radial[:, :, 2] = 0.0
    radial /= np.maximum(np.linalg.norm(radial, axis=2, keepdims=True), 1e-9)
    sheet = np.cross(tangent, radial)
    sheet /= np.maximum(np.linalg.norm(sheet, axis=2, keepdims=True), 1e-9)
    return tangent, sheet


def frame_dirs(points, cx):
    tangent, sheet = sheet_frames(points, cx)
    normal = np.cross(tangent, sheet)
    normal /= np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-9)
    return tangent, sheet, normal


def phase_field(roots_xy, spacing_m=0.005, seed=0):
    roots_xy = np.asarray(roots_xy, float)
    rng = np.random.default_rng(seed)
    lo = roots_xy.min(axis=0) - spacing_m
    hi = roots_xy.max(axis=0) + spacing_m
    nx = max(int(np.ceil((hi[0] - lo[0]) / spacing_m)) + 2, 2)
    ny = max(int(np.ceil((hi[1] - lo[1]) / spacing_m)) + 2, 2)
    lattice = rng.uniform(-np.pi, np.pi, (ny, nx))
    gx = np.clip((roots_xy[:, 0] - lo[0]) / spacing_m, 0.0, nx - 1.001)
    gy = np.clip((roots_xy[:, 1] - lo[1]) / spacing_m, 0.0, ny - 1.001)
    x0 = gx.astype(int)
    y0 = gy.astype(int)
    fx = gx - x0
    fy = gy - y0
    return ((1 - fx) * (1 - fy) * lattice[y0, x0]
            + fx * (1 - fy) * lattice[y0, x0 + 1]
            + (1 - fx) * fy * lattice[y0 + 1, x0]
            + fx * fy * lattice[y0 + 1, x0 + 1])


def rear_mask(roots, apex):
    return np.asarray(roots)[:, 1] > float(apex)


def theta_field(roots_xy, rear, spacing_m=0.010, seed=0):
    """Smooth unit-variance lean field (~spacing_m correlation)."""
    roots_xy = np.asarray(roots_xy, float)
    rng = np.random.default_rng(seed)
    lo = roots_xy.min(axis=0) - spacing_m
    hi = roots_xy.max(axis=0) + spacing_m
    nx = max(int(np.ceil((hi[0] - lo[0]) / spacing_m)) + 2, 2)
    ny = max(int(np.ceil((hi[1] - lo[1]) / spacing_m)) + 2, 2)
    lattice = rng.normal(0.0, 1.0, (ny, nx))
    gx = np.clip((roots_xy[:, 0] - lo[0]) / spacing_m, 0.0, nx - 1.001)
    gy = np.clip((roots_xy[:, 1] - lo[1]) / spacing_m, 0.0, ny - 1.001)
    x0 = gx.astype(int)
    y0 = gy.astype(int)
    fx = gx - x0
    fy = gy - y0
    f = ((1 - fx) * (1 - fy) * lattice[y0, x0]
         + fx * (1 - fy) * lattice[y0, x0 + 1]
         + (1 - fx) * fy * lattice[y0 + 1, x0]
         + fx * fy * lattice[y0 + 1, x0 + 1])
    s = float(f[rear].std()) if rear.sum() else 1.0
    return f / max(s, 1e-12)


def _stats(out, pts):
    t0 = np.gradient(pts, axis=1)
    t0 /= np.maximum(np.linalg.norm(t0, axis=2, keepdims=True), 1e-9)
    t1 = np.gradient(out, axis=1)
    t1 /= np.maximum(np.linalg.norm(t1, axis=2, keepdims=True), 1e-9)
    cosang = np.clip((t0 * t1).sum(axis=2), -1.0, 1.0)
    ang = np.degrees(np.arccos(cosang))
    disp_mm = np.linalg.norm(out - pts, axis=2) * 1000.0
    maxdisp = disp_mm.max(axis=1)
    return ang, maxdisp


def apply_long_wave(points, roots, cx, target_deg, wave_len_mm=240.0,
                    seed=0):
    pts = np.asarray(points, float).copy()
    roots = np.asarray(roots, float)
    L = float(wave_len_mm) / 1000.0
    k = 2.0 * np.pi / L
    A = np.tan(np.radians(float(target_deg))) / k
    phi = phase_field(roots[:, :2], 0.005, seed)
    protected = np.abs(roots[:, 0] - cx) <= 0.003
    s = arc(pts)
    ramp_in = smooth(s / 0.015)
    Lstrand = s[:, -1]
    fout = 1.0 - smooth((s - (Lstrand - 0.020)[:, None]) / 0.020)
    envelope = ramp_in * fout
    envelope[protected] = 0.0
    wave = A * np.sin(2.0 * np.pi * s / L + phi[:, None])
    wave[protected] = 0.0
    _, sheet, _ = frame_dirs(pts, cx)
    out = pts + sheet * (envelope * wave)[:, :, None]
    ang, maxdisp = _stats(out, pts)
    info = {
        "targetDeg": float(target_deg),
        "amplitudeMm": float(A * 1000.0),
        "tangentDevDeg": {"rms": float(np.sqrt(np.mean(ang ** 2))),
                          "p95": float(np.percentile(ang, 95)),
                          "max": float(ang.max())},
        "maxDispMm": {"p50": float(np.percentile(maxdisp, 50)),
                      "p95": float(np.percentile(maxdisp, 95)),
                      "max": float(maxdisp.max())},
        "protectedFibres": int(protected.sum()),
        "seed": int(seed),
        "waveLenMm": float(wave_len_mm),
    }
    return out, info


def apply_lean_return(points, roots, cx, sigma_deg=4.0, seed=0):
    pts = np.asarray(points, float).copy()
    roots = np.asarray(roots, float)
    n = len(pts)
    rng = np.random.default_rng(seed)
    theta = rng.normal(0.0, float(sigma_deg), n)
    protected = np.abs(roots[:, 0] - cx) <= 0.003
    theta[protected] = 0.0
    s = arc(pts)
    Lstrand = s[:, -1]
    ramp_in = smooth(s / 0.015)
    ret = 1.0 - smooth((s - 0.6 * Lstrand[:, None])
                       / np.maximum(0.4 * Lstrand[:, None], 1e-9))
    window = np.where(s <= 0.6 * Lstrand[:, None], ramp_in,
                      ramp_in[np.arange(n), np.argmin(np.abs(s - 0.6 * Lstrand[:, None]), axis=1)][:, None] * ret)
    window[protected] = 0.0
    tilt_m = s * np.tan(np.radians(theta))[:, None] * window
    _, sheet = sheet_frames(pts, cx)
    out = pts + sheet * tilt_m[:, :, None]
    ang, maxdisp = _stats(out, pts)
    info = {
        "sigmaDeg": float(sigma_deg),
        "thetaStd": float(theta.std()),
        "thetaMaxAbs": float(np.abs(theta).max()),
        "tangentDevDeg": {"rms": float(np.sqrt(np.mean(ang ** 2))),
                          "p95": float(np.percentile(ang, 95)),
                          "max": float(ang.max())},
        "maxDispMm": {"p50": float(np.percentile(maxdisp, 50)),
                      "p95": float(np.percentile(maxdisp, 95)),
                      "max": float(maxdisp.max())},
        "protectedFibres": int(protected.sum()),
        "seed": int(seed),
    }
    return out, theta, info


def apply_lean_return_rear(points, roots, cx, apex, sigma_deg=4.0,
                           seed=0, coherent=False, spacing_m=0.010):
    """Rear-only lean-return. Curtain fibres bitwise identical to input."""
    pts = np.asarray(points, float).copy()
    roots = np.asarray(roots, float)
    n = len(pts)
    rear = rear_mask(roots, apex)
    protected = np.abs(roots[:, 0] - cx) <= 0.003
    if coherent:
        field = theta_field(roots[:, :2], rear, spacing_m, seed)
        theta = field * float(sigma_deg)
    else:
        theta = np.random.default_rng(seed).normal(0.0, float(sigma_deg), n)
    theta[~rear] = 0.0
    theta[protected] = 0.0
    s = arc(pts)
    Lstrand = s[:, -1]
    ramp_in = smooth(s / 0.015)
    ret = 1.0 - smooth((s - 0.6 * Lstrand[:, None])
                       / np.maximum(0.4 * Lstrand[:, None], 1e-9))
    piv = np.argmin(np.abs(s - 0.6 * Lstrand[:, None]), axis=1)
    window = np.where(s <= 0.6 * Lstrand[:, None], ramp_in,
                      ramp_in[np.arange(n), piv][:, None] * ret)
    window[~rear] = 0.0
    window[protected] = 0.0
    tilt_m = s * np.tan(np.radians(theta))[:, None] * window
    _, sheet = sheet_frames(pts, cx)
    out = pts + sheet * tilt_m[:, :, None]
    out[~rear] = pts[~rear]
    ang, maxdisp = _stats(out, pts)
    rear_disp = maxdisp[rear]
    info = {
        "sigmaDeg": float(sigma_deg),
        "coherent": bool(coherent),
        "fieldSpacingMm": float(spacing_m * 1000.0) if coherent else 0.0,
        "thetaStdRear": float(theta[rear].std()),
        "thetaMaxAbsRear": float(np.abs(theta[rear]).max()),
        "rearFibres": int(rear.sum()),
        "tangentDevDeg": {"rms": float(np.sqrt(np.mean(ang ** 2))),
                          "p95": float(np.percentile(ang, 95)),
                          "max": float(ang.max())},
        "tangentDevDegRear": {"rms": float(np.sqrt(np.mean(ang[rear] ** 2))),
                             "p95": float(np.percentile(ang[rear], 95))},
        "maxDispMm": {"p50": float(np.percentile(maxdisp, 50)),
                      "p95": float(np.percentile(maxdisp, 95)),
                      "max": float(maxdisp.max())},
        "maxDispMmRear": {"p50": float(np.percentile(rear_disp, 50)),
                         "p95": float(np.percentile(rear_disp, 95)),
                         "max": float(rear_disp.max())},
        "protectedFibres": int(protected.sum()),
        "seed": int(seed),
    }
    return out, theta, info


def sheet_halfwidths(points, roots, cx, apex, nbins=12, pct=99.0):
    """Per-z-bin rear sheet half-width: p`pct`(|x - bin_median|)."""
    pts = np.asarray(points, float)
    roots = np.asarray(roots, float)
    rear = rear_mask(roots, apex)
    z = pts[rear][:, :, 2].ravel()
    x = pts[rear][:, :, 0].ravel()
    lo, hi = float(z.min()), float(z.max())
    edges = np.linspace(lo, hi, nbins + 1)
    rows = []
    for b in range(nbins):
        sel = (z >= edges[b]) & (z <= edges[b + 1] if b == nbins - 1 else z < edges[b + 1])
        xb = x[sel]
        if len(xb) == 0:
            rows.append({"bin": b, "z0": edges[b], "z1": edges[b + 1],
                         "median": float(cx), "half": 0.0, "n": 0})
            continue
        med = float(np.median(xb))
        half = float(np.percentile(np.abs(xb - med), pct))
        rows.append({"bin": b, "z0": float(edges[b]), "z1": float(edges[b + 1]),
                     "median": med, "half": half, "n": int(len(xb))})
    return rows, (lo, hi)


def compensate_outline(a1, leaned, roots, cx, apex, nbins=12):
    """Pull rear lateral offsets toward the a1 silhouette per z-bin."""
    a1 = np.asarray(a1, float)
    leaned = np.asarray(leaned, float).copy()
    roots = np.asarray(roots, float)
    rear = rear_mask(roots, apex)
    a_rows, (lo, hi) = sheet_halfwidths(a1, roots, cx, apex, nbins)
    l_rows, _ = sheet_halfwidths(leaned, roots, cx, apex, nbins)
    edges = np.linspace(lo, hi, nbins + 1)
    ratios = []
    for a_r, l_r in zip(a_rows, l_rows):
        if l_r["half"] > 1e-12:
            r = a_r["half"] / l_r["half"]
        else:
            r = 1.0
        ratios.append(min(float(r), 1.0))
    idx = np.clip(np.digitize(a1[rear][:, :, 2], edges) - 1, 0, nbins - 1)
    meds = np.array([a_rows[b]["median"] for b in idx.flat]).reshape(idx.shape)
    rats = np.array([ratios[b] for b in idx.flat]).reshape(idx.shape)
    sub = leaned[rear]
    sub[:, :, 0] = meds + (sub[:, :, 0] - meds) * rats
    leaned[rear] = sub
    c_rows, _ = sheet_halfwidths(leaned, roots, cx, apex, nbins)
    report = [{"bin": b, "z0": a_rows[b]["z0"], "z1": a_rows[b]["z1"],
               "a1HalfMm": a_rows[b]["half"] * 1000.0,
               "leanedHalfMm": l_rows[b]["half"] * 1000.0,
               "ratio": ratios[b],
               "compHalfMm": c_rows[b]["half"] * 1000.0} for b in range(nbins)]
    return leaned, {"ratios": ratios, "rows": report, "nbins": nbins}


def clamp_ends_vertical(kids, tail=0.040, blend=0.030):
    out = kids.copy()
    for i, p in enumerate(out):
        s = np.r_[0., np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
        L = s[-1]
        tip = p[-1].copy()
        target_xy = tip[:2].copy()
        n = p.shape[0]
        for j in range(n):
            remain = L - s[j]
            if remain > tail + blend:
                continue
            w = smooth((tail + blend - remain) / blend) if remain > tail else 1.0
            out[i, j, :2] = (1 - w) * out[i, j, :2] + w * target_xy
    return out


def endpoint_stats(points):
    vec = points[:, -1] - points[:, -5]
    deg = np.degrees(np.arctan2(np.linalg.norm(vec[:, :2], axis=1),
                                np.abs(vec[:, 2]) + 1e-12))
    return {"p50": float(np.percentile(deg, 50)),
            "p95": float(np.percentile(deg, 95)),
            "max": float(deg.max())}


def part_gap(roots, cx, apex):
    front = roots[:, 1] <= apex
    left = cx - roots[front & (roots[:, 0] < cx), 0]
    right = roots[front & (roots[:, 0] >= cx), 0] - cx
    return float((left.min() + right.min()) * 1000.0)


def apply_lean_return_rear_held(points, roots, cx, apex, sigma_deg=4.0,
                                seed=0, hold=0.6):
    """Rear-only independent lean-return with generic hold fraction.

    Identical to apply_lean_return_rear(coherent=False) except the lean is
    held for the first `hold` fraction of arc and smoothly returned over
    the last (1-hold): offset(s) = s*tan(theta)*w(s),
    w = ramp_in(s) for s <= hold*Ls,
    w = ramp_in(hold*Ls)*(1-smooth((s-hold*Ls)/((1-hold)*Ls))) after.
    Curtain fibres bitwise identical to input. hold=0.6 reproduces tilt4.
    """
    pts = np.asarray(points, float).copy()
    roots = np.asarray(roots, float)
    n = len(pts)
    hold = float(hold)
    rear = rear_mask(roots, apex)
    protected = np.abs(roots[:, 0] - cx) <= 0.003
    theta = np.random.default_rng(seed).normal(0.0, float(sigma_deg), n)
    theta[~rear] = 0.0
    theta[protected] = 0.0
    s = arc(pts)
    Lstrand = s[:, -1]
    ramp_in = smooth(s / 0.015)
    denom = np.maximum((1.0 - hold) * Lstrand[:, None], 1e-9)
    ret = 1.0 - smooth((s - hold * Lstrand[:, None]) / denom)
    piv = np.argmin(np.abs(s - hold * Lstrand[:, None]), axis=1)
    window = np.where(s <= hold * Lstrand[:, None], ramp_in,
                      ramp_in[np.arange(n), piv][:, None] * ret)
    window[~rear] = 0.0
    window[protected] = 0.0
    tilt_m = s * np.tan(np.radians(theta))[:, None] * window
    _, sheet = sheet_frames(pts, cx)
    out = pts + sheet * tilt_m[:, :, None]
    out[~rear] = pts[~rear]
    ang, maxdisp = _stats(out, pts)
    rear_disp = maxdisp[rear]
    info = {
        "sigmaDeg": float(sigma_deg),
        "coherent": False,
        "hold": hold,
        "thetaStdRear": float(theta[rear].std()),
        "thetaMaxAbsRear": float(np.abs(theta[rear]).max()),
        "rearFibres": int(rear.sum()),
        "tangentDevDeg": {"rms": float(np.sqrt(np.mean(ang ** 2))),
                          "p95": float(np.percentile(ang, 95)),
                          "max": float(ang.max())},
        "tangentDevDegRear": {"rms": float(np.sqrt(np.mean(ang[rear] ** 2))),
                             "p95": float(np.percentile(ang[rear], 95))},
        "maxDispMm": {"p50": float(np.percentile(maxdisp, 50)),
                      "p95": float(np.percentile(maxdisp, 95)),
                      "max": float(maxdisp.max())},
        "maxDispMmRear": {"p50": float(np.percentile(rear_disp, 50)),
                         "p95": float(np.percentile(rear_disp, 95)),
                         "max": float(rear_disp.max())},
        "protectedFibres": int(protected.sum()),
        "seed": int(seed),
    }
    return out, theta, info


def apply_curtain_below_jaw(points_b8, roots, cx, apex, sigma_deg=4.0,
                            seed=0, hold=0.6, jaw_z=1.46, fade_m=0.030):
    """Curtain-only lean below a world-z jaw line, faded in over fade_m.

    Starts from b8 points (rear already leaned, left untouched bitwise).
    For curtain fibres (roots y <= apex): independent theta ~ N(0,sigma),
    same hold/return window as apply_lean_return_rear_held, multiplied by
    a per-point jaw weight w_jaw(z) = smooth((jaw_z - z)/fade_m) so the
    face/eye region (z >> jaw_z) stays bitwise b8 and the lean fades in
    over 30 mm below the jaw. 3 mm part protection, roots fixed.
    """
    pts = np.asarray(points_b8, float).copy()
    roots = np.asarray(roots, float)
    n = len(pts)
    rear = rear_mask(roots, apex)
    curtain = ~rear
    protected = np.abs(roots[:, 0] - cx) <= 0.003
    theta = np.random.default_rng(seed).normal(0.0, float(sigma_deg), n)
    theta[rear] = 0.0
    theta[protected] = 0.0
    s = arc(pts)
    Lstrand = s[:, -1]
    ramp_in = smooth(s / 0.015)
    denom = np.maximum((1.0 - float(hold)) * Lstrand[:, None], 1e-9)
    ret = 1.0 - smooth((s - float(hold) * Lstrand[:, None]) / denom)
    piv = np.argmin(np.abs(s - float(hold) * Lstrand[:, None]), axis=1)
    window = np.where(s <= float(hold) * Lstrand[:, None], ramp_in,
                      ramp_in[np.arange(n), piv][:, None] * ret)
    window[rear] = 0.0
    window[protected] = 0.0
    w_jaw = smooth((float(jaw_z) - pts[:, :, 2]) / float(fade_m))
    w_jaw[rear] = 0.0
    window = window * w_jaw
    tilt_m = s * np.tan(np.radians(theta))[:, None] * window
    _, sheet = sheet_frames(pts, cx)
    out = pts + sheet * tilt_m[:, :, None]
    out[rear] = pts[rear]
    # exact-bitwise guard above jaw: weight is exactly 0 there
    above = curtain[:, None] & (pts[:, :, 2] >= float(jaw_z))
    out[above] = pts[above]
    ang, maxdisp = _stats(out, pts)
    cur_disp = maxdisp[curtain]
    info = {
        "sigmaDeg": float(sigma_deg),
        "hold": float(hold),
        "jawZ": float(jaw_z),
        "fadeMm": float(fade_m * 1000.0),
        "thetaStdCurtain": float(theta[curtain].std()),
        "thetaMaxAbsCurtain": float(np.abs(theta[curtain]).max()),
        "curtainFibres": int(curtain.sum()),
        "tangentDevDeg": {"rms": float(np.sqrt(np.mean(ang ** 2))),
                          "p95": float(np.percentile(ang, 95)),
                          "max": float(ang.max())},
        "maxDispMm": {"p50": float(np.percentile(maxdisp, 50)),
                      "p95": float(np.percentile(maxdisp, 95)),
                      "max": float(maxdisp.max())},
        "maxDispMmCurtain": {"p50": float(np.percentile(cur_disp, 50)),
                            "p95": float(np.percentile(cur_disp, 95)),
                            "max": float(cur_disp.max())},
        "protectedFibres": int(protected.sum()),
        "seed": int(seed),
    }
    return out, theta, info
