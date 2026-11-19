#!/usr/bin/env python3
"""Synthetic tests for eye_detail.py (no Blender, no browser).

Known-good: black canthus ring -> fraction > 0.5; vertical blob in the
sclera -> streak > 3x flat; dense dark brow -> coverage > 0.8.
Counterweights: skin-painted ring -> < 0.02; sparse grey brow -> < 0.4.
Probe: CANTHUS_L_MAX 15 -> 101 turns the counterweight RED; restore GREEN.
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare import COLORS  # noqa: E402
from eye_detail import analyze  # noqa: E402

H, W = 120, 120
EYE = (slice(50, 70), slice(40, 80))  # rows 50..69, cols 40..79
BROW = (slice(10, 20), slice(30, 70))
SKINBAND = (slice(0, 10), slice(0, 120))


def blank_mask():
    return np.zeros((H, W, 3), dtype=np.uint8)


def paint(mask, sl, name):
    mask[sl] = COLORS[name]
    return mask


def grey(v):
    return np.full((H, W, 3), v, dtype=np.uint8)


def eye_case(ring_v):
    mask = paint(blank_mask(), EYE, "eyes")
    img = grey(180)  # skin-ish L*~73
    img[EYE] = (200, 200, 200)  # low-chroma sclera
    ring = np.zeros((H, W), bool)
    yy, xx = np.mgrid[0:H, 0:W]
    from scipy.ndimage import binary_dilation

    eye = np.zeros((H, W), bool)
    eye[EYE] = True
    ring = binary_dilation(eye, iterations=6) & ~eye
    img[ring] = (ring_v, ring_v, ring_v)
    return img, mask


def test_canthus_known_good():
    img, mask = eye_case(0)
    m = analyze(img, mask)
    assert m["canthus_dark"]["L"]["fraction"] > 0.5, m["canthus_dark"]
    assert m["canthus_dark"]["R"]["fraction"] > 0.5, m["canthus_dark"]


def test_canthus_counterweight():
    img, mask = eye_case(180)
    m = analyze(img, mask)
    assert m["canthus_dark"]["L"]["fraction"] < 0.02, m["canthus_dark"]
    assert m["canthus_dark"]["R"]["fraction"] < 0.02, m["canthus_dark"]


def sclera_case(streaky):
    mask = paint(blank_mask(), EYE, "eyes")
    img = grey(180)
    rng = np.random.default_rng(7)
    base = rng.normal(200, 1.5, (20, 40))
    if streaky:
        yy = np.arange(20)[:, None]
        blob = 60 * np.exp(-(((yy - 10) / 4) ** 2))
        base[:, 15:25] += blob
    img[EYE] = np.clip(base, 0, 255).astype(np.uint8)[..., None].repeat(3, axis=2)
    return img, mask


def test_streak():
    flat = analyze(*sclera_case(False))["sclera_streak"]
    streaky = analyze(*sclera_case(True))["sclera_streak"]
    assert flat < 3.0, flat
    assert streaky > 3 * max(flat, 1e-9), (flat, streaky)


def brow_case(dense):
    mask = blank_mask()
    mask = paint(mask, EYE, "eyes")
    mask = paint(mask, BROW, "hair")
    mask = paint(mask, SKINBAND, "skin")
    img = grey(180)
    img[EYE] = (200, 200, 200)
    img[SKINBAND] = (170, 170, 170)  # skin band L*~69
    brow = np.zeros((H, W), bool)
    brow[BROW] = True
    if dense:
        img[brow] = (30, 30, 30)
    else:
        img[brow] = (150, 150, 150)  # grey, above skin-15 threshold
        flat = np.zeros((H, W), bool)
        flat[BROW] = True
        every4 = np.zeros((H, W), bool)
        idx = np.flatnonzero(flat)
        sel = np.zeros((H, W), bool)
        sel.flat[idx[::4]] = True
        img[sel] = (30, 30, 30)
        _ = every4
    return img, mask


def test_brow_dense():
    m = analyze(*brow_case(True))["brow"]
    assert m["pixels"] > 0, m
    assert m["coverage"] is not None and m["coverage"] > 0.8, m


def test_brow_sparse():
    m = analyze(*brow_case(False))["brow"]
    assert m["pixels"] > 0, m
    assert m["coverage"] is not None and m["coverage"] < 0.4, m


if __name__ == "__main__":
    test_canthus_known_good()
    test_canthus_counterweight()
    test_streak()
    test_brow_dense()
    test_brow_sparse()
    print("eye_detail_test: 5/5 GREEN")
