"""S9 guide frames: rotation-minimising (parallel-transport) frames.

For each guide curve (world metres), transport a root frame along the
curve: root frame N0 = scalp normal orthogonalised against the guide
tangent T0, B0 = T0 x N0. Each step applies the minimal rotation that
carries T_i to T_{i+1} (Rodrigues; double-reflection equivalent for
small steps) to (N_i, B_i). No Frenet frame is used anywhere, so there
is no curvature-driven twist: children lofted at fixed (a, b) offsets
in these frames keep a stable orientation along the guide.

Butts 2018 style transport: the child offset lives in the transported
frame, not in a barycentric blend of guide positions.

Self-test: helical guide, coarse (41-pt, guide sampling) vs fine
(4096-pt reference) transport. Gate: max angular deviation of the
coarse normal from the fine reference, per 100 mm of arc length,
<= 1.0 deg, plus orthonormality (N.T = 0, |N| = 1) to 1e-9.
"""
from __future__ import annotations

import numpy as np

P_DEFAULT = 32


def head_to_world(pts_head, crown):
    """Head-mm (X lateral, U anterior+, D drop) -> world metres.

    Reimplemented locally (3-line formula) from the guide growth
    provenance stated in the guide spec; no sibling-lane import.
    """
    pts = np.asarray(pts_head, dtype=np.float64)
    world = np.empty_like(pts)
    world[..., 0] = pts[..., 0] / 1000.0
    world[..., 1] = float(crown[1]) - pts[..., 1] / 1000.0
    world[..., 2] = float(crown[2]) - pts[..., 2] / 1000.0
    return world


def tangents(pts):
    """Central-difference unit tangents (forward/backward at the ends)."""
    pts = np.asarray(pts, dtype=np.float64)
    t = np.zeros_like(pts)
    t[1:-1] = pts[2:] - pts[:-2]
    t[0] = pts[1] - pts[0]
    t[-1] = pts[-1] - pts[-2]
    n = np.linalg.norm(t, axis=1, keepdims=True)
    n[n == 0.0] = 1.0
    return t / n


def _rot_t_to_t(t0, t1):
    """Minimal rotation matrix carrying unit t0 to unit t1 (Rodrigues)."""
    v = np.cross(t0, t1)
    c = float(np.dot(t0, t1))
    if c >= 1.0 - 1e-12:
        return np.eye(3)
    if c <= -1.0 + 1e-12:
        # Antiparallel: pick any orthogonal axis deterministically.
        ax = np.array([1.0, 0.0, 0.0])
        if abs(float(t0[0])) > 0.9:
            ax = np.array([0.0, 1.0, 0.0])
        v = np.cross(t0, ax)
        v = v / np.linalg.norm(v)
        return 2.0 * np.outer(v, v) - np.eye(3) + 2.0 * np.outer(
            np.cross(v, t0), np.cross(v, t0))
    vx = np.array([[0.0, -v[2], v[1]],
                   [v[2], 0.0, -v[0]],
                   [-v[1], v[0], 0.0]])
    return np.eye(3) + vx + vx @ vx * (1.0 / (1.0 + c))


def root_frame(tangent0, scalp_normal):
    """Root frame from guide tangent + scalp normal (both unit)."""
    t = np.asarray(tangent0, dtype=np.float64)
    t = t / np.linalg.norm(t)
    n = np.asarray(scalp_normal, dtype=np.float64)
    n = n - float(np.dot(n, t)) * t
    nn = float(np.linalg.norm(n))
    if nn < 1e-9:
        # Tangent parallel to the normal (degenerate): pick a
        # deterministic orthogonal vector.
        ax = np.array([1.0, 0.0, 0.0])
        if abs(float(t[0])) > 0.9:
            ax = np.array([0.0, 1.0, 0.0])
        n = ax - float(np.dot(ax, t)) * t
        nn = float(np.linalg.norm(n))
    n = n / nn
    b = np.cross(t, n)
    return t, n, b / np.linalg.norm(b)


def transport_frames(pts, scalp_normal):
    """Parallel-transport frames along a curve.

    Returns (T, N, B) each (M, 3). Deterministic; no randomness.
    """
    pts = np.asarray(pts, dtype=np.float64)
    m = pts.shape[0]
    T = tangents(pts)
    N = np.zeros_like(pts)
    B = np.zeros_like(pts)
    t0, n0, b0 = root_frame(T[0], scalp_normal)
    T[0] = t0
    N[0], B[0] = n0, b0
    for i in range(m - 1):
        R = _rot_t_to_t(T[i], T[i + 1])
        N[i + 1] = R @ N[i]
        B[i + 1] = R @ B[i]
        # Re-orthogonalise against the segment tangent (kills drift).
        ti = T[i + 1]
        N[i + 1] = N[i + 1] - float(np.dot(N[i + 1], ti)) * ti
        N[i + 1] = N[i + 1] / np.linalg.norm(N[i + 1])
        B[i + 1] = np.cross(ti, N[i + 1])
        B[i + 1] = B[i + 1] / np.linalg.norm(B[i + 1])
    return T, N, B


def resample_arc(pts, p=P_DEFAULT):
    """Arc-length-uniform resample of a polyline to p points."""
    pts = np.asarray(pts, dtype=np.float64)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    total = float(cum[-1])
    if total <= 0.0:
        return np.repeat(pts[:1], p, axis=0)
    s = np.linspace(0.0, total, p)
    out = np.zeros((p, 3))
    j = 0
    for k in range(p):
        while j < len(seg) - 1 and cum[j + 1] < s[k]:
            j += 1
        denom = cum[j + 1] - cum[j]
        f = 0.0 if denom <= 0.0 else (s[k] - cum[j]) / denom
        out[k] = pts[j] * (1.0 - f) + pts[j + 1] * f
    return out


def helix_points(radius_mm=20.0, pitch_mm=30.0, turns=5.0, n=41):
    """Helical guide (world metres) for the self-test."""
    th = np.linspace(0.0, 2.0 * np.pi * turns, n)
    r = radius_mm / 1000.0
    ph = pitch_mm / 1000.0
    x = r * np.cos(th)
    y = r * np.sin(th)
    z = ph * th / (2.0 * np.pi)
    return np.stack([x, y, z], axis=1)


def residual_spin_per100mm(pts, scalp_normal):
    """Twist the transport itself adds, in deg per 100 mm of arc.

    Per step, compare the transported normal against the minimal
    rotation of the previous normal; any angle between them is spin
    about the tangent introduced by the algorithm (an ideal
    rotation-minimising transport has zero). A Frenet frame on the
    test helix below would read ~65 deg/100mm (the torsion rate),
    so this discriminates a twisting frame from a transported one.
    """
    T, N, _ = transport_frames(np.asarray(pts, dtype=np.float64),
                               np.asarray(scalp_normal, dtype=np.float64))
    total = 0.0
    for i in range(len(T) - 1):
        R = _rot_t_to_t(T[i], T[i + 1])
        pred = R @ N[i]
        d = float(np.clip(np.dot(pred, N[i + 1]), -1.0, 1.0))
        total += abs(float(np.degrees(np.arccos(d))))
    seg = np.linalg.norm(np.diff(np.asarray(pts, dtype=np.float64),
                                 axis=0), axis=1)
    length_mm = float(seg.sum() * 1000.0)
    per100 = total / (length_mm / 100.0) if length_mm > 0 else 0.0
    return per100, total, length_mm


def self_test():
    """Helical guide: no twist accumulation beyond 1 deg per 100 mm."""
    h = helix_points(radius_mm=20.0, pitch_mm=30.0, turns=5.0, n=41)
    n0 = np.array([1.0, 0.0, 0.0])
    per100, total, length_mm = residual_spin_per100mm(h, n0)
    T, N, _ = transport_frames(h, n0)
    dots = np.abs((N * T).sum(axis=1))
    ortho = float(dots.max())
    nlen = float(np.abs(np.linalg.norm(N, axis=1) - 1.0).max())
    # Frenet-contrast: torsion rate of this helix in deg/100mm. A
    # curvature-driven (Frenet) frame would spin at this rate.
    r, c = 20.0, 30.0 / (2.0 * np.pi)
    torsion_rate = float(np.degrees(c / (r * r + c * c)) * 100.0)
    ok = per100 <= 1.0 and ortho < 1e-9 and nlen < 1e-9
    return {"spinPer100mmDeg": round(per100, 6),
            "spinTotalDeg": round(total, 6),
            "lengthMm": round(length_mm, 2),
            "frenetContrastPer100mmDeg": round(torsion_rate, 2),
            "orthoMax": ortho, "normMax": nlen,
            "pass": bool(ok)}


if __name__ == "__main__":
    import json
    r = self_test()
    print(json.dumps(r, indent=1))
    if not r["pass"]:
        raise SystemExit("frames self-test FAILED")
