"""UV chart + point-in-polygon shared by the scalp/root steps (pure NumPy).

Chart (identical constants to the hairline step): U = signed azimuth about
the head axis (atan2(dx, -dy): 0 = front, + toward +X, seam +-pi at the back
midline, side-preserving -- never abs()), V = elevation about the chart
centre (ax, ay, elevCentreZ).

The hairline loop encircles the axis, so its UV polygon spans ~2pi in U and
closes across the seam. pip_inside unwraps the polygon once and shifts each
query point by multiples of 2pi into the polygon U-range before the
even-odd test (exactly one shift lands in range because the span is <4pi).
"""
from __future__ import annotations

import numpy as np

TWO_PI = 2.0 * np.pi


def chart(points, ax, ay, ecz):
    pts = np.asarray(points, dtype=np.float64)
    dx = pts[..., 0] - ax
    dy = pts[..., 1] - ay
    u = np.arctan2(dx, -dy)
    v = np.arctan2(pts[..., 2] - ecz, np.hypot(dx, dy))
    return np.stack([u, v], axis=-1)


def unwrap_poly(poly):
    poly = np.asarray(poly, dtype=np.float64)
    u = np.unwrap(poly[:, 0])
    return np.stack([u, poly[:, 1]], axis=-1)


def pip_inside(pts, poly_unwrapped):
    """Even-odd point-in-polygon. pts (K,2), poly (L,2) unwrapped. Returns bool[K].

    Polar-cap rule: the loop winds once around the head axis, so the polar
    cap above the loop (V > polygon Vmax, crown side) is inside and the
    region below the loop bottom (V < polygon Vmin, neck side) is outside,
    regardless of the even-odd count (the pole has no image point in the
    (azimuth, elevation) chart, which breaks plain even-odd there).
    """
    pts = np.asarray(pts, dtype=np.float64)
    poly = np.asarray(poly_unwrapped, dtype=np.float64)
    umin, umax = poly[:, 0].min(), poly[:, 0].max()
    vmax, vmin = poly[:, 1].max(), poly[:, 1].min()
    cap = pts[:, 1] > vmax        # polar cap: inside
    below = pts[:, 1] < vmin      # below the loop: outside
    mid = ~(cap | below)
    out = np.zeros(len(pts), dtype=bool)
    out[cap] = True
    x = pts[:, 0]
    # candidate shifts (at most 3 can land in a <4pi span; test each)
    for k in (-1, 0, 1, 2):
        xk = x + k * TWO_PI
        sel = mid & (xk >= umin) & (xk <= umax)
        if not sel.any():
            continue
        inside = np.zeros(len(pts), dtype=bool)
        xs, ys = xk, pts[:, 1]
        x1, y1 = poly[:, 0], poly[:, 1]
        x2, y2 = np.roll(x1, -1), np.roll(y1, -1)
        for i in range(len(poly)):
            xa, ya, xb, yb = x1[i], y1[i], x2[i], y2[i]
            cond = ((ya > ys) != (yb > ys)) & (xs < (xb - xa) * (ys - ya) / (yb - ya + 1e-300) + xa)
            inside ^= cond
        out |= inside & sel
    out[below] = False
    return out


def unwrap_tris(tu):
    """Per-triangle UV unwrap for seam-crossing faces.

    Faces straddling the back-midline seam have vertices at U≈+pi and -pi;
    naive UV triangles then span the whole chart and fake overlaps/folds.
    For each tri: if its U span exceeds pi, add 2pi to its negative-U verts
    (minimises span); then shift the whole tri by multiples of 2pi to bring
    its centroid into [-pi-0.2, pi]. Returns (tu_unwrapped, shifts).
    """
    tu = np.asarray(tu, dtype=np.float64).copy()
    n = len(tu)
    shifts = np.zeros(n, dtype=np.int64)
    for i in range(n):
        u = tu[i, :, 0]
        if u.max() - u.min() > np.pi:
            tu[i, u < 0, 0] += TWO_PI
        c = tu[i, :, 0].mean()
        while c > np.pi:
            tu[i, :, 0] -= TWO_PI
            c -= TWO_PI
            shifts[i] -= 1
        while c <= -np.pi - 0.2:
            tu[i, :, 0] += TWO_PI
            c += TWO_PI
            shifts[i] += 1
    return tu, shifts


def self_test():
    rng = np.random.default_rng(0)
    sq = np.array([[0.2, -0.5], [1.0, -0.5], [1.0, 0.5], [0.2, 0.5]])
    pin = np.array([[0.5, 0.0], [0.9, 0.4]])
    pout = np.array([[0.0, 0.0], [1.5, 0.0], [0.5, -0.9]])
    assert pip_inside(pin, sq).all() and not pip_inside(pout, sq).any()
    # polar cap: above polygon Vmax is inside, below Vmin is outside
    assert pip_inside(np.array([[0.5, 0.9]]), sq)[0]
    assert not pip_inside(np.array([[0.5, -0.9]]), sq)[0]
    # seam-crossing polygon: wrap a box across +-pi
    box = np.array([[2.8, -0.5], [3.5, -0.5], [3.5, 0.5], [2.8, 0.5]])
    box[:, 0] = (box[:, 0] + np.pi) % TWO_PI - np.pi
    bu = unwrap_poly(box)
    assert (bu[:, 0].max() - bu[:, 0].min()) < 4 * np.pi
    assert pip_inside(np.array([[3.1, 0.0], [-3.0, 0.0]]), bu).tolist() == [True, True]
    assert not pip_inside(np.array([[0.0, 0.0]]), bu)[0]
    # random check on the square, mid band only (cap/below rules own the rest)
    q = rng.uniform(-1, 2, size=(2000, 2))
    q = q[(q[:, 1] <= 0.5) & (q[:, 1] >= -0.5)]
    assert (pip_inside(q, sq) == ((q[:, 0] > 0.2) & (q[:, 0] < 1.0) & (np.abs(q[:, 1]) < 0.5))).all()
    # seam unwrap: tri spanning +-pi collapses; shifts recorded
    tu = np.array([[[3.0, 0.0], [3.1, 0.1], [-3.05, 0.05]]])
    uw, sh = unwrap_tris(tu)
    assert uw[0, :, 0].max() - uw[0, :, 0].min() < 0.5
    tu2 = np.array([[[0.1, 0.0], [0.2, 0.1], [0.15, 0.2]]])
    uw2, sh2 = unwrap_tris(tu2)
    assert (sh2 == 0).all() and np.allclose(uw2, tu2)
    return True
