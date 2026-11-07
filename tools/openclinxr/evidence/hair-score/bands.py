#!/usr/bin/env python3
"""Lit highlight-band metrics for OpenClinXR hair scoring.

The "sheet look" of straight dark hair is photometric: a small number of
large, smooth specular bands, not confetti. Silhouette IoU and median
brightness cannot see that structure, so this module counts lit bands:
connected components above the hair mask's p90 luminance, in two fixed
1024-frame crops, plus the column-luminance autocorrelation peak (regular
band spacing gives a strong off-zero peak; frizzy/confetti hair does not).

Crops (x0, y0, x1, y1, 1024 frame, canonical absolute cameras):
* back crop (sheet fall): (320, 280, 704, 664) -- 384x384.
* ear crop (three_quarter, side fall over the ear): (100, 240, 484, 624).

Per crop, on beauty luminance with the hair ID/target mask:
* p90: 90th percentile of luminance over masked pixels in the crop.
* bright: masked pixels with luminance >= p90.
* count / meanAreaPx: cv2 8-way connected components of bright (background
  excluded; 0 / 0.0 when empty).
* acPeak / acLag: column-mean luminance profile over the crop (columns with
  no masked pixels take the crop masked mean), mean-subtracted normalised
  autocorrelation; peak value and lag over lags 2..191 (lag 0 is trivially
  1.0; 191 is half the 384 px crop width). A clean sheet shows a high peak
  at the band spacing; confetti shows a low flat spectrum.

Only numpy + Pillow + cv2 (Blender-bundled subset; no scipy), so this
module imports both inside Blender (via score.py) and under system python.
"""

from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

SIZE = 1024
BACK_BOX = (320, 280, 704, 664)
EAR_BOX = (100, 240, 484, 624)
MIN_LAG = 2
MAX_LAG = 191


def luminance(beauty: np.ndarray) -> np.ndarray:
    return (0.2126 * beauty[..., 0] + 0.7152 * beauty[..., 1]
            + 0.0722 * beauty[..., 2])


def crop(field: np.ndarray, box):
    x0, y0, x1, y1 = box
    return field[y0:y1, x0:x1]


def detrended(colmeans: np.ndarray, width: int = 41) -> np.ndarray:
    """Mean-subtracted residual after a centred boxcar trend removal.

    The crop-scale light falloff (dark roots to lit ends) would otherwise
    dominate the autocorrelation with a trivial short-lag peak; removing a
    41 px boxcar trend leaves the band-scale ripple whose spacing is the
    sheet signal. Pure numpy (no scipy): boxcar via cumsum, edges clamped.
    """
    x = colmeans.astype(np.float64)
    r = width // 2
    padded = np.pad(x, r, mode="edge")
    cs = np.cumsum(np.insert(padded, 0, 0.0))
    trend = (cs[width:] - cs[:-width]) / width
    return x - trend


def column_autocorr_peak(colmeans: np.ndarray) -> tuple[float, int]:
    """(peak value, lag) of the normalised autocorrelation, lags 2..191."""
    x = detrended(colmeans)
    denom = float((x ** 2).sum())
    if denom <= 0:
        return 0.0, MIN_LAG
    full = np.correlate(x, x, mode="full")
    zero = len(x) - 1
    ac = full[zero:] / denom
    lo, hi = MIN_LAG, min(MAX_LAG, len(ac) - 1)
    if hi < lo:
        return 0.0, MIN_LAG
    seg = ac[lo:hi + 1]
    k = int(np.argmax(seg))
    return float(seg[k]), lo + k


def band_stats(gray1024: np.ndarray, mask1024: np.ndarray, box) -> dict:
    """Band metrics for one crop. gray float64 [0,1], mask bool, 1024."""
    g = crop(gray1024, box)
    m = crop(mask1024, box)
    pixels = int(m.sum())
    if pixels == 0:
        return {"count": 0, "meanAreaPx": 0.0, "acPeak": 0.0, "acLag": MIN_LAG,
                "p90": 0.0, "pixels": 0}
    vals = g[m]
    p90 = float(np.percentile(vals, 90))
    bright = np.logical_and(m, g >= p90).astype(np.uint8)
    n, _, areas, _ = cv2.connectedComponentsWithStats(bright, connectivity=8)
    count = int(n - 1)
    mean_area = float(areas[1:, cv2.CC_STAT_AREA].mean()) if count else 0.0
    cols = np.full(g.shape[1], vals.mean(), dtype=np.float64)
    for j in range(g.shape[1]):
        col = g[:, j][m[:, j]]
        if col.size:
            cols[j] = col.mean()
    peak, lag = column_autocorr_peak(cols)
    return {"count": count, "meanAreaPx": mean_area, "acPeak": peak,
            "acLag": int(lag), "p90": p90, "pixels": pixels}


def score_beauty(beauty1024: np.ndarray, mask1024: np.ndarray) -> dict:
    """{'back': stats, 'ear': stats} for one image+mask pair."""
    gray = luminance(beauty1024)
    return {"back": band_stats(gray, mask1024, BACK_BOX),
            "ear": band_stats(gray, mask1024, EAR_BOX)}


def load_beauty_mask(beauty_path, mask_path):
    b = np.asarray(Image.open(beauty_path).convert("RGB"),
                   dtype=np.float64) / 255.0
    im = Image.open(mask_path)
    if im.mode == "RGBA":
        m = np.asarray(im)[..., 3] >= 230
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
