"""Station-owned registration: 3-parameter similarity (scale + 2D translation).

Model: render-frame pixel p_r maps to target-frame pixel p_t by
    p_t = scale * p_r + t
with (scale, tx, ty) solved from one landmark triple
    a = crown row, b = chin/shoulder row, c = centre column:
    scale = (b_t - a_t) / (b_r - a_r)
    tx    = c_t - scale * c_r
    ty    = a_t - scale * a_r

Same model as the scorer-side judge. Pure NumPy: this module imports
nothing but numpy and reads no files.
"""
from __future__ import annotations

import numpy as np


def similarity_from_triples(a_r, b_r, c_r, a_t, b_t, c_t):
    """Return {scale, tx, ty} mapping render triple onto target triple."""
    a_r = float(np.float64(a_r))
    b_r = float(np.float64(b_r))
    c_r = float(np.float64(c_r))
    a_t = float(np.float64(a_t))
    b_t = float(np.float64(b_t))
    c_t = float(np.float64(c_t))
    h_r = np.float64(b_r) - np.float64(a_r)
    h_t = np.float64(b_t) - np.float64(a_t)
    if not np.isfinite([h_r, h_t]).all() or h_r <= 0.0 or h_t <= 0.0:
        raise ValueError("triple heights must be finite and positive, got %r %r" % (h_r, h_t))
    s = np.float64(h_t) / np.float64(h_r)
    tx = np.float64(c_t) - s * np.float64(c_r)
    ty = np.float64(a_t) - s * np.float64(a_r)
    return {"scale": float(s), "tx": float(tx), "ty": float(ty)}


def apply_triple(a_r, b_r, c_r, transform):
    """Map a render triple into the target frame. Returns (a, b, c) floats."""
    s = float(np.float64(transform["scale"]))
    mapped = np.array([a_r, b_r, c_r], dtype=np.float64)
    rows = s * mapped[:2] + float(np.float64(transform["ty"]))
    col = s * mapped[2] + float(np.float64(transform["tx"]))
    return (float(rows[0]), float(rows[1]), float(col))


def residuals(a_r, b_r, c_r, a_t, b_t, c_t, transform):
    """Per-landmark residual px of mapped render triple vs target triple."""
    m_a, m_b, m_c = apply_triple(a_r, b_r, c_r, transform)
    vec = np.array([m_a - a_t, m_b - b_t, m_c - c_t], dtype=np.float64)
    return {
        "da_px": float(vec[0]),
        "db_px": float(vec[1]),
        "dc_px": float(vec[2]),
        "rms_px": float(np.sqrt(np.mean(vec * vec))),
    }
