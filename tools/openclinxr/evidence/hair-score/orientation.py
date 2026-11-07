#!/usr/bin/env python3
"""Strand-direction (orientation) metric for OpenClinXR hair scoring.

Research practice (Nam et al., CVPR 2019, strand-accurate multi-view hair
capture; Paris et al.) compares an orientation map from a bank of oriented
filters inside the hair mask. Our scorer previously measured shape
(silhouette IoU) and brightness/colour only, so tangent changes were
invisible to every gate. This module adds the missing direction axis.

Method
------
* Grayscale (Rec.709 luminance) Gabor bank, 180 orientations at 1 deg steps.
* Kernel: 15x15 px, wavelength 4.0 px, sigma 3.0, gamma 0.5, psi 0.
    - Wavelength 4 px matches the 2-4 px strand/ridge period at 1024 px
      (target-views set-back are 1024x1024; renders are 1024 px).
    - Sigma 3.0 gives an effective support of ~+/-2.5 sigma ~= the 15 px
      kernel, so truncation is negligible while keeping filter2D cheap.
    - Gamma 0.5 elongates the Gaussian envelope along the strand, which is
      what makes the response direction-selective (gamma 1.0 would be an
      isotropic blob detector, not an orientation detector).
    - Psi 0 (even-symmetric) makes it a ridge detector: maximal on the
      bright strand centre, not on its edges.
* Per pixel: orientation = argmax over the 180 magnitude responses
  (filter-theta frame, modulo 180 deg; the frame offset cancels in every
  render-vs-target comparison and in rotation deltas), confidence =
  (peak - mean) / (peak + eps), i.e. peak response vs the mean over
  orientations.
* Registration render->target uses the judge v6 similarity transform
  (``register_view``: uniform scale + translation from the
  crown/chin/centre triple; no rotation), with render triples from
  hair-curtain3/landmarks.json and target triples from the judge's
  target-set-back/landmarks.json (front in skull mode with the same 10 mm
  hair-over-skull offset the judge applies; three_quarter has no judge
  registration so the transform is identity). Orientation maps are compared
  at the native 1024 judge frame: downsampling would halve the 2-4 px
  strand period the 4 px Gabor wavelength is tuned to.
* Scores per view, inside the intersection of the two hair masks:
    - meanAbsErrDeg: confidence-product-weighted mean of
      min(|a-b|, 180-|a-b|).
    - histEMD: 18-bin (10 deg) confidence-weighted orientation histogram,
      normalised; earth-mover distance on the line =
      binWidth * sum |CDF_r - CDF_t|.

Only numpy + Pillow + cv2 (the Blender-bundled subset; no scipy), so this
module imports both inside Blender (via score.py) and under system python
(self-tests).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

# Gabor bank parameters (see module docstring for why).
KSIZE = 15
WAVELENGTH = 4.0
SIGMA = 3.0
GAMMA = 0.5
PSI = 0.0
N_THETA = 180
N_BINS = 18
WORK = 1024  # orientation working resolution = judge frame (native, no resampling)
SIZE = 1024  # judge working frame
PARAMS_TAG = f"k{KSIZE}-l{WAVELENGTH}-s{SIGMA}-g{GAMMA}"

# Render triples (a_row, b_row, c_col) from hair-curtain3/landmarks.json.
RENDER_TRIPLES = {
    "front": (103.0, 583.0, 512.0),
    "three_quarter": None,  # no judge registration -> identity
    "profile_90": (131.0, 561.0, 209.0),
    "back": (155.0, 651.0, 512.0),
}
# Raw target triples from the judge's target-set-back/landmarks.json.
# Front is adjusted to skull mode (+10 mm hair-over-skull offset) by
# target_triples(), exactly as judge() does.
TARGET_TRIPLES_RAW = {
    "front": (127.0, 608.0, 513.0),
    "three_quarter": None,
    "profile_90": (125.0, 577.0, 344.0),
    "back": (130.0, 646.0, 513.0),
}
SKULL_OFFSET_MM = 10.0
SKULL_H_MM = 210.65914630889893  # judge landmarks-canonical.json H_mm


def target_triples(h_mm: float = SKULL_H_MM) -> dict:
    """Target (a,b,c) triples with the judge's skull-mode front offset."""
    out = dict(TARGET_TRIPLES_RAW)
    a, b, c = TARGET_TRIPLES_RAW["front"]
    offset = SKULL_OFFSET_MM * ((b - a) / h_mm)
    out["front"] = (a + offset, b, c)
    return out


def register_view_local(mask_r, beauty_r, a_r, b_r, c_r, a_t, b_t, c_t):
    """Local replica of judge v6 register_view (identical math).

    Similarity render->target from (a_row, b_row, c_col) triples. score.py
    passes the real ``J.register_view``; standalone use (self-tests) falls
    back to this. beauty_r is float64 HxWx3 in [0,1] or None (mask-only).
    """
    H_t = float(b_t - a_t)
    H_r = float(b_r - a_r)
    s = H_t / H_r
    tx = float(c_t) - s * float(c_r)
    ty = float(a_t) - s * float(a_r)
    transform = {"scale": s, "tx": tx, "ty": ty}
    if s == 1.0 and tx == 0.0 and ty == 0.0:
        return mask_r.copy(), (beauty_r.copy() if beauty_r is not None else None), transform
    inv = (1.0 / s, 0.0, -tx / s, 0.0, 1.0 / s, -ty / s)
    m_img = Image.fromarray((mask_r.astype(np.uint8) * 255))
    m_t = np.array(m_img.transform((SIZE, SIZE), Image.AFFINE, inv, Image.NEAREST)) > 127
    if beauty_r is None:
        return m_t, None, transform
    b_img = Image.fromarray((np.clip(beauty_r, 0, 1) * 255 + 0.5).astype(np.uint8))
    b_t = np.array(b_img.transform((SIZE, SIZE), Image.AFFINE, inv,
                                   Image.BILINEAR)).astype(np.float64) / 255.0
    return m_t, b_t, transform


_kernels_cache: list | None = None


def gabor_kernels() -> list:
    """180 Gabor kernels, 1 deg steps, float32."""
    global _kernels_cache
    if _kernels_cache is None:
        _kernels_cache = [
            cv2.getGaborKernel((KSIZE, KSIZE), SIGMA, np.deg2rad(t),
                               WAVELENGTH, GAMMA, PSI, ktype=cv2.CV_32F)
            for t in range(N_THETA)
        ]
    return _kernels_cache


def luminance(beauty: np.ndarray) -> np.ndarray:
    return (0.2126 * beauty[..., 0] + 0.7152 * beauty[..., 1]
            + 0.0722 * beauty[..., 2])


def orientation_map(gray512: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(angles [0,180) float32, confidence float32) at 512 px.

    gray512: float64 HxW in [0,1]. Deterministic: fixed kernels, no RNG.
    """
    img = gray512.astype(np.float32)
    kernels = gabor_kernels()
    best = np.full(img.shape, -1.0, dtype=np.float32)
    arg = np.zeros(img.shape, dtype=np.int16)
    total = np.zeros(img.shape, dtype=np.float64)
    for t, kernel in enumerate(kernels):
        resp = np.abs(cv2.filter2D(img, cv2.CV_32F, kernel))
        total += resp.astype(np.float64)
        better = resp > best
        best[better] = resp[better]
        arg[better] = t
    mean = total / N_THETA
    conf = (best.astype(np.float64) - mean) / (best.astype(np.float64) + 1e-6)
    return arg.astype(np.float32), np.clip(conf, 0.0, 1.0).astype(np.float32)


def to_work(gray1024: np.ndarray, mask1024: np.ndarray):
    """Downsample 1024 beauty/mask to the 512 orientation frame."""
    g = np.array(Image.fromarray(
        (np.clip(gray1024, 0, 1) * 255 + 0.5).astype(np.uint8)).resize(
        (WORK, WORK), Image.BILINEAR)).astype(np.float64) / 255.0
    m = np.array(Image.fromarray(
        (mask1024.astype(np.uint8) * 255)).resize(
        (WORK, WORK), Image.NEAREST)) > 127
    return g, m


def downsample_map(field: np.ndarray, is_mask: bool = False):
    how = Image.NEAREST if is_mask else Image.BILINEAR
    if is_mask:
        return np.array(Image.fromarray(
            (field.astype(np.uint8) * 255)).resize(
            (WORK, WORK), how)) > 127
    return np.array(Image.fromarray(
        (np.clip(field, 0, 1) * 255 + 0.5).astype(np.uint8)).resize(
        (WORK, WORK), how)).astype(np.float64) / 255.0


MARGIN = 8  # crop margin; Gabor kernel radius is 7, so interior is exact


def crop_to_inter(gray_r, mask_r, gray_t, mask_t):
    """Crop all fields to the mask-intersection bbox (+margin).

    Gabor filtering is O(px); hair covers a fraction of the frame, so
    filtering only the intersection bbox (minus a margin ring, where the
    kernel would see the crop edge) is exact on the kept pixels and ~10x
    faster. Returns (gray_r, mask_r, gray_t, mask_t, inter) in crop frame,
    or Nones when the intersection is empty.
    """
    inter = mask_r & mask_t
    ys, xs = np.nonzero(inter)
    if len(ys) == 0:
        return None, None, None, None, None
    y0, y1 = max(int(ys.min()) - MARGIN, 0), min(int(ys.max()) + MARGIN + 1, SIZE)
    x0, x1 = max(int(xs.min()) - MARGIN, 0), min(int(xs.max()) + MARGIN + 1, SIZE)
    slices = (slice(y0, y1), slice(x0, x1))
    valid = np.zeros_like(inter[slices], dtype=bool)
    valid[MARGIN:-MARGIN or None, MARGIN:-MARGIN or None] = True
    return (gray_r[slices], mask_r[slices], gray_t[slices], mask_t[slices],
            inter[slices] & valid)


def angular_diff(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    d = np.abs(a.astype(np.float64) - b.astype(np.float64))
    return np.minimum(d, 180.0 - d)


def orientation_histogram(angles: np.ndarray, conf: np.ndarray,
                          mask: np.ndarray) -> np.ndarray:
    """Normalised confidence-weighted 18-bin histogram over mask."""
    sel = mask & (conf > 0)
    hist = np.zeros(N_BINS, dtype=np.float64)
    if not sel.any():
        return hist
    bins = np.minimum((angles[sel] / 10.0).astype(int), N_BINS - 1)
    np.add.at(hist, bins, conf[sel])
    total = hist.sum()
    return hist / total if total > 0 else hist


def hist_emd(h_r: np.ndarray, h_t: np.ndarray) -> float:
    """Earth-mover distance on the line, in degrees (bin width 10 deg)."""
    return float(10.0 * np.abs(np.cumsum(h_r) - np.cumsum(h_t)).sum())


def compare(angles_r, conf_r, angles_t, conf_t, inter: np.ndarray) -> dict:
    """Scores inside the mask intersection."""
    pixels = int(inter.sum())
    if pixels == 0:
        return {"meanAbsErrDeg": None, "meanConfRender": 0.0,
                "meanConfTarget": 0.0, "histEMD": None, "pixels": 0}
    diff = angular_diff(angles_r, angles_t)[inter]
    w = (conf_r[inter].astype(np.float64) * conf_t[inter].astype(np.float64))
    w_sum = w.sum()
    err = float((w * diff).sum() / w_sum) if w_sum > 0 else float(diff.mean())
    h_r = orientation_histogram(angles_r, conf_r, inter)
    h_t = orientation_histogram(angles_t, conf_t, inter)
    return {"meanAbsErrDeg": err,
            "meanConfRender": float(conf_r[inter].mean()),
            "meanConfTarget": float(conf_t[inter].mean()),
            "histEMD": hist_emd(h_r, h_t), "pixels": pixels}


def score_view(render_beauty, render_mask, target_beauty, target_mask,
               view: str, register_fn=None,
               render_triple=None, target_triple=None) -> dict:
    """Register render->target (judge v6 similarity) and score orientation.

    All images in the 1024 judge frame: beauties float64 HxWx3 [0,1], masks
    bool. register_fn defaults to the local replica; score.py passes
    ``J.register_view`` (identical math).
    """
    reg = register_fn or register_view_local
    rt = render_triple or RENDER_TRIPLES[view]
    tt = target_triple or target_triples()[view]
    if rt is None or tt is None:
        transform = {"scale": 1.0, "tx": 0.0, "ty": 0.0}
        m_o, b_o = render_mask.copy(), render_beauty.copy()
    else:
        m_o, b_o, transform = reg(render_mask, render_beauty,
                                  rt[0], rt[1], rt[2], tt[0], tt[1], tt[2])
    g_r, m_r = luminance(b_o), m_o
    g_t, m_t = luminance(target_beauty), target_mask
    cropped = crop_to_inter(g_r, m_r, g_t, m_t)
    if cropped[0] is None:
        out = {"meanAbsErrDeg": None, "meanConfRender": 0.0,
               "meanConfTarget": 0.0, "histEMD": None, "pixels": 0}
        out["transform"] = {k: float(v) for k, v in transform.items()}
        return out
    g_r, m_r, g_t, m_t, inter = cropped
    a_r, c_r = orientation_map(g_r)
    a_t, c_t = orientation_map(g_t)
    out = compare(a_r, c_r, a_t, c_t, inter)
    out["transform"] = {k: float(v) for k, v in transform.items()}
    return out


def load_beauty_mask(beauty_path, mask_path):
    b = np.asarray(Image.open(beauty_path).convert("RGB"),
                   dtype=np.float64) / 255.0
    im = Image.open(mask_path)
    if im.mode == "RGBA":
        a = np.asarray(im)[..., 3]
        m = a >= 230
    else:
        m = np.asarray(im.convert("L")) > 127
    if b.shape[:2] != (SIZE, SIZE):
        b = np.asarray(Image.fromarray(
            (b * 255 + 0.5).astype(np.uint8)).resize(
            (SIZE, SIZE), Image.BILINEAR)).astype(np.float64) / 255.0
    if m.shape != (SIZE, SIZE):
        m = np.asarray(Image.fromarray(
            (m.astype(np.uint8) * 255)).resize(
            (SIZE, SIZE), Image.NEAREST)) > 127
    return b, m


def target_map_cache_path(cache_dir: Path, view: str) -> Path:
    return cache_dir / f"target-{view}-{PARAMS_TAG}.npz"


def target_orientation(view: str, target_beauty_path, target_mask_path,
                       cache_dir: Path | None = None):
    """Target (angles, confidence, mask, histogram); cached to disk."""
    beauty_path, mask_path = str(target_beauty_path), str(target_mask_path)
    if cache_dir is not None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        cp = target_map_cache_path(cache_dir, view)
        key = hashlib.sha256(
            (beauty_path + "|" + mask_path).encode()).hexdigest()[:16]
        if cp.exists():
            try:
                z = np.load(cp)
                if str(z["key"]) == key:
                    return (z["angles"], z["conf"],
                            z["mask"].astype(bool), z["hist"])
            except Exception:
                pass
    b, m = load_beauty_mask(beauty_path, mask_path)
    g, m512 = to_work(luminance(b), m)
    a, c = orientation_map(g)
    h = orientation_histogram(a, c, m512)
    if cache_dir is not None:
        np.savez_compressed(target_map_cache_path(cache_dir, view),
                            angles=a, conf=c, mask=m512, hist=h,
                            key=np.array(key))
    return a, c, m512, h
