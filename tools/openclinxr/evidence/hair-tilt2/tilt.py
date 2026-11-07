#!/usr/bin/env python3
"""Per-fibre tilt + low-frequency wave (hair-tilt1, Step 2).

Faithful copy of the a1 children-pipeline helpers (arc, smooth, sheet
frames as in children_asymmetry.decorrelate_triangle_weights) plus the
tilt/wave operator. Guides untouched: this operates on the finished a1
points/roots. System python (numpy only; clamp is the numpy-only replica
of station.clamp_ends_vertical strict mode, same as hair-geo7).
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


def apply_tilt_wave(points, roots, cx, sigma_deg, wave_amp_mm=0.0,
                    wave_len_mm=90.0, seed=0):
    """Per-child constant tilt + optional low-frequency wave.

    Tilt: per-child angle theta ~ N(0, sigma_deg), applied as a rotation
    about the root in the local sheet plane, i.e. lateral offset
    s*tan(theta) growing linearly with arc length s.
    Wave: lateral offset W*sin(2*pi*s/L + phi), phi ~ U(-pi, pi) per child.
    Both are zero for roots within 3 mm of the part and ramp in from 0 at
    the root to full over the first 15 mm of arc. Roots are fixed.
    Returns (displaced_points, theta_deg, phase).
    """
    pts = np.asarray(points, float).copy()
    roots = np.asarray(roots, float)
    n = len(pts)
    rng = np.random.default_rng(seed)
    theta = rng.normal(0.0, float(sigma_deg), n)
    phase = rng.uniform(-np.pi, np.pi, n)
    protected = np.abs(roots[:, 0] - cx) <= 0.003
    theta[protected] = 0.0
    phase[protected] = 0.0
    s = arc(pts)  # metres
    ramp = smooth(s / 0.015)
    ramp[protected] = 0.0
    _, sheet = sheet_frames(pts, cx)
    tilt_m = s * np.tan(np.radians(theta))[:, None] * ramp
    out = pts + sheet * tilt_m[:, :, None]
    if wave_amp_mm:
        wave_m = ((float(wave_amp_mm) / 1000.0)
                  * np.sin(2.0 * np.pi * s / (float(wave_len_mm) / 1000.0)
                           + phase[:, None]) * ramp)
        wave_m[protected] = 0.0
        out = out + sheet * wave_m[:, :, None]
    else:
        wave_m = np.zeros_like(s)
    return out, theta, phase


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
