#!/usr/bin/env python3
"""Synthetic tests for eye_detail.py (no Blender, no browser).

corner_dark (inside the eye mask only, cap42 R2):
  known-good: black wedge planted INSIDE a mask end zone -> fraction > 0.5.
  counterweight: the same wedge OUTSIDE the mask -> all fractions stay ~0
    (the withdrawn ring measured the outside, where the voids are).
  probe: drop the inside-mask restriction -> the counterweight goes RED.

sclera_bars (running-median detrend, cap42 R2):
  known-good: a white vertical bar in the sclera raises max_resid.
  counterweights: a uniform lift of the whole sclera does not raise it;
    a whole-sclera linear gradient (broad change, no bars) does not either.
  probe: replace the running median with a mean -> the gradient counterweight
    goes RED (the mean cannot track a ramp; the median can).

brow (unchanged): dense dark brow -> coverage > 0.8; sparse grey -> < 0.4.
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


def eye_img(base=180):
    img = grey(base)
    img[EYE] = (200, 200, 200)  # low-chroma sclera
    return img


def test_corner_inside_zone():
    mask = paint(blank_mask(), EYE, "eyes")
    img = eye_img()
    img[50:70, 40:44] = (0, 0, 0)  # L outer end zone (cols 40..43 of the 40-col eye)
    m = analyze(img, mask)["corner_dark"]
    assert m["L"]["outer"]["fraction"] > 0.5, m["L"]
    assert m["R"]["outer"]["fraction"] < 0.02, m["R"]


def test_corner_outside_mask_ignored():
    mask = paint(blank_mask(), EYE, "eyes")
    img = eye_img()
    img[50:70, 30:34] = (0, 0, 0)  # black wedge fully OUTSIDE the mask
    img[30:34, 40:80] = (0, 0, 0)  # black bar above the eye (lash zone)
    m = analyze(img, mask)["corner_dark"]
    for side in ("L", "R"):
        for zone in ("inner", "outer"):
            assert m[side][zone]["fraction"] < 0.02, (side, zone, m[side][zone])


def _sclera_case(kind):
    mask = paint(blank_mask(), EYE, "eyes")
    if kind == "bar":
        img = eye_img()
        img[50:70, 55:58] = (255, 255, 255)  # narrow white vertical bar
    elif kind == "lift":
        img = grey(180)
        img[EYE] = (220, 220, 220)  # uniform lift, no bars
    elif kind == "gradient":
        img = grey(180)
        ramp = np.linspace(180, 220, 40).round().astype(np.uint8)
        img[50:70, 40:80] = ramp[None, :, None].repeat(3, axis=2)
    else:
        raise AssertionError(kind)
    return img, mask


def test_bars_white_bar():
    flat = analyze(*_sclera_case("lift"))["sclera_bars"]
    bar = analyze(*_sclera_case("bar"))["sclera_bars"]
    got = max(bar["L"]["max_resid"], bar["R"]["max_resid"])
    base = max(flat["L"]["max_resid"], flat["R"]["max_resid"])
    assert got > 5.0, (got, base)
    assert got > 5 * max(base, 1e-9), (got, base)


def test_bars_uniform_lift_ignored():
    m = analyze(*_sclera_case("lift"))["sclera_bars"]
    assert m["L"]["max_resid"] < 1.0, m["L"]
    assert m["R"]["max_resid"] < 1.0, m["R"]


def test_bars_gradient_ignored():
    m = analyze(*_sclera_case("gradient"))["sclera_bars"]
    assert m["L"]["max_resid"] < 2.0, m["L"]
    assert m["R"]["max_resid"] < 2.0, m["R"]


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
    test_corner_inside_zone()
    test_corner_outside_mask_ignored()
    test_bars_white_bar()
    test_bars_uniform_lift_ignored()
    test_bars_gradient_ignored()
    test_brow_dense()
    test_brow_sparse()
    print("eye_detail_test: 7/7 GREEN")
