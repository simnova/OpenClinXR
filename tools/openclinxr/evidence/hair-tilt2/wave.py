#!/usr/bin/env python3
"""Zero-mean per-fibre lateral wave (hair-tilt2, Step 1).

Lineage: exact copy of hair-tilt1/tilt.py lives in this directory as
tilt.py (provenance). This file keeps its helpers (arc, smooth,
sheet_frames, clamp_ends_vertical, endpoint_stats, part_gap) and REPLACES
the root rotation (s*tan(theta), displacement growing with arc) with a
zero-mean wave in the local strand frame:

  wave(s) = A1*sin(2*pi*s/L + phi1) + A2*sin(2*pi*s/(L/2.3) + phi2)

  offset_vec(s) = envelope(s) * wave(s) * (w_in*S + w_out*N)

S = local sheet direction (in-plane, same construction as the a1
pipeline), N = normalize(cross(T, S)) (out-of-sheet, toward/away from the
surface). (w_in, w_out) = (1, 0) for in-plane cells, (0.3, 0.7) for mixed
cells (70% of the amplitude out of the sheet plane). The direction vector
is NOT renormalized, so |d| = 1 (in-plane) or sqrt(.3^2+.7^2) = 0.7616
(mixed); the amplitude calibration divides by |d| so the quoted peak
tangent angle is exact.

Coherence (review 18b): phi1/phi2 are NOT independent per fibre. Each is
drawn from a smooth phase FIELD over the scalp: uniform(-pi, pi) noise on
a 5 mm lattice over the root bounding box, bilinearly interpolated at each
root position, so sub-bundles (~5 mm correlation length) move together and
crossings do not read as frizz. phi1 and phi2 use independent fields.

Envelope: zero for roots within 3 mm (x) of the part; fade-in
smooth(s/15mm) over the first 15 mm of arc; fade-out
1-smooth((s-(Ls-20mm))/20mm) over the last 20 mm of arc, so tips return
toward the unwaved end and the hem silhouette holds. Roots are fixed.

Amplitude calibration: peak slope of the two-component wave is
A1*k1 + A2*k2 with k1 = 2*pi/L, k2 = 2.3*k1, A2 = A1/2, i.e.
A1*k1*2.15 (times |d|). For a target peak tangent angle theta:
A1 = tan(theta)*L/(2*pi*2.15*|d|). L = 80 mm.

Out-of-sheet cap (review 18c): mixed-cell out-of-sheet peak displacement
= (A1+A2)*0.7 <= 1.5 mm by construction (w10m: 1.44 mm).

System python (numpy only). Operates on finished a1 (or r1) points/roots;
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
    """(tangent, sheet) per point. Sheet = local hair-surface tangent,
    perpendicular to the strand (same construction as the a1 pipeline)."""
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
    """(tangent, sheet, out-of-sheet) per point. N = normalize(T x S)."""
    tangent, sheet = sheet_frames(points, cx)
    normal = np.cross(tangent, sheet)
    normal /= np.maximum(np.linalg.norm(normal, axis=2, keepdims=True), 1e-9)
    return tangent, sheet, normal


def phase_field(roots_xy, spacing_m=0.005, seed=0):
    """Smooth phase field over the scalp: uniform(-pi, pi) lattice noise
    with `spacing_m` cells, bilinearly interpolated at root positions.
    Returns (n,) phases. Correlation length ~ spacing_m."""
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


def apply_wave(points, roots, cx, target_deg, w_in=1.0, w_out=0.0,
               wave_len_mm=80.0, seed=0):
    """Zero-mean per-fibre wave with coherent phase fields.

    Returns (displaced_points, info_dict) where info carries the realised
    tangent deviation (rms/p95 deg vs the unwaved strand), per-fibre max
    displacement (p50/p95/max mm), amplitudes, and protection stats.
    """
    pts = np.asarray(points, float).copy()
    roots = np.asarray(roots, float)
    n = len(pts)
    L = float(wave_len_mm) / 1000.0
    L2 = L / 2.3
    dnorm = float(np.sqrt(w_in ** 2 + w_out ** 2))
    k1 = 2.0 * np.pi / L
    A1 = np.tan(np.radians(float(target_deg))) / (k1 * 2.15 * dnorm)
    A2 = A1 / 2.0
    phi1 = phase_field(roots[:, :2], 0.005, seed)
    phi2 = phase_field(roots[:, :2], 0.005, seed + 1)
    protected = np.abs(roots[:, 0] - cx) <= 0.003
    s = arc(pts)  # metres
    ramp_in = smooth(s / 0.015)
    Lstrand = s[:, -1]
    fout = 1.0 - smooth((s - (Lstrand - 0.020)[:, None]) / 0.020)
    envelope = ramp_in * fout
    envelope[protected] = 0.0
    wave = (A1 * np.sin(2.0 * np.pi * s / L + phi1[:, None])
            + A2 * np.sin(2.0 * np.pi * s / L2 + phi2[:, None]))
    wave[protected] = 0.0
    _, sheet, normal = frame_dirs(pts, cx)
    direction = w_in * sheet + w_out * normal
    out = pts + direction * (envelope * wave)[:, :, None]
    # Realised tangent deviation vs the unwaved strand (degrees).
    t0 = np.gradient(pts, axis=1)
    t0 /= np.maximum(np.linalg.norm(t0, axis=2, keepdims=True), 1e-9)
    t1 = np.gradient(out, axis=1)
    t1 /= np.maximum(np.linalg.norm(t1, axis=2, keepdims=True), 1e-9)
    cosang = np.clip((t0 * t1).sum(axis=2), -1.0, 1.0)
    ang = np.degrees(np.arccos(cosang))
    disp_mm = np.linalg.norm(out - pts, axis=2) * 1000.0
    maxdisp = disp_mm.max(axis=1)
    info = {
        "targetDeg": float(target_deg),
        "weights": {"in": float(w_in), "out": float(w_out), "dirNorm": dnorm},
        "amplitudesMm": {"A1": float(A1 * 1000.0), "A2": float(A2 * 1000.0),
                         "peakOutMm": float((A1 + A2) * abs(w_out) * 1000.0)},
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


def clamp_ends_vertical(kids, tail=0.040, blend=0.030):
    """Strict (max_deg=0) end clamp: keep tip xy, pull last 40 mm
    (blended over 30 mm) to vertical above the tip. Numpy-only."""
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
