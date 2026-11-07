"""PNG metrics for hair image 02 (numpy + PIL only).

Usage: python3 measure.py <front-png>
Prints JSON: crownScalpFraction, sweaterPixels, meanHairLuminance, volume.

Definitions (mirrors hair-eval/evaluate.py conventions):
- head region: columns 15%-85%, rows 0-75%.
- hair mask: luminance < 0.30 inside the head region.
- crownScalpFraction: fraction of skin pixels (luminance > 0.55 and
  |saturation - median face sat| < 0.1, median over the face region
  columns 30%-70% rows 25%-60%) inside the hair bounding box's top 30%.
- sweaterPixels: pixels in the bottom 30% with hue 330-360 or 0-10 deg
  and saturation > 0.3.
- meanHairLuminance: mean luminance over the hair mask.
- volume: mask pixels / head-region pixels.
"""
import json
import sys

import numpy as np
from PIL import Image


def rgb_to_hs_np(rgb):
    f = rgb.astype(np.float64) / 255.0
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    mx = np.max(f, axis=-1)
    mn = np.min(f, axis=-1)
    d = mx - mn
    sat = np.where(mx > 0, d / np.maximum(mx, 1e-9), 0.0)
    hue = np.zeros_like(mx)
    m = d > 1e-9
    mr = m & (mx == r)
    mg = m & (mx == g) & ~mr
    mb = m & ~(mr | mg)
    hue[mr] = ((g[mr] - b[mr]) / d[mr]) % 6.0
    hue[mg] = (b[mg] - r[mg]) / d[mg] + 2.0
    hue[mb] = (r[mb] - g[mb]) / d[mb] + 4.0
    return (hue * 60.0) % 360.0, sat


def main():
    path = sys.argv[1]
    im = Image.open(path).convert("RGB")
    a = np.asarray(im)
    H, W, _ = a.shape
    lum = (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]) / 255.0
    hue, sat = rgb_to_hs_np(a)

    x0, x1 = int(W * 0.15), int(W * 0.85)
    y1 = int(H * 0.75)
    head_lum = lum[0:y1, x0:x1]
    head_sat = sat[0:y1, x0:x1]
    hair_mask = head_lum < 0.30
    head_pixels = int(head_lum.size)
    hair_pixels = int(hair_mask.sum())
    volume = hair_pixels / head_pixels if head_pixels else 0.0
    mean_hair_lum = float(head_lum[hair_mask].mean()) if hair_pixels else 0.0
    if hair_pixels:
        _region = a[0:y1, x0:x1].astype(np.float64)
        _hp = _region[hair_mask]
        _s = _hp[:, 0] + _hp[:, 1] + _hp[:, 2]
        hair_warmth = float((((_hp[:, 0] - _hp[:, 2]) / np.maximum(_s, 1e-9))).mean())
    else:
        hair_warmth = 0.0

    fx0, fx1 = int(W * 0.30), int(W * 0.70)
    fy0, fy1 = int(H * 0.25), int(H * 0.60)
    med_sat = float(np.median(sat[fy0:fy1, fx0:fx1]))

    ys, _ = np.nonzero(hair_mask)
    if len(ys):
        top, bot = int(ys.min()), int(ys.max())
        cut = top + max(1, int(0.30 * (bot - top + 1)))
        region_lum = head_lum[top:cut, :]
        region_sat = head_sat[top:cut, :]
        skin = (region_lum > 0.55) & (np.abs(region_sat - med_sat) < 0.1)
        crown = float(skin.sum()) / float(region_lum.size)
    else:
        crown = 1.0

    sy0 = int(H * 0.70)
    swe_hue = hue[sy0:H, :]
    swe_sat = sat[sy0:H, :]
    in_hue = (swe_hue >= 330.0) | (swe_hue <= 10.0)
    sweater = int(((in_hue) & (swe_sat > 0.3)).sum())

    # ---- report-only exposure/width keys (image04a; do not change above) ----
    fx0b, fx1b = int(W * 0.30), int(W * 0.70)
    fy0b, fy1b = int(H * 0.25), int(H * 0.70)
    face_lum = lum[fy0b:fy1b, fx0b:fx1b]
    face_skin = face_lum[face_lum > 0.30]
    face_mean_lum = float(face_skin.mean()) if face_skin.size else 0.0
    p = 32
    corners = []
    for yy, xx in ((0, 0), (0, W - p), (H - p, 0), (H - p, W - p)):
        corners.append(lum[yy:yy + p, xx:xx + p].mean())
    bg_lum = float(sum(corners) / len(corners)) if corners else 0.0
    # skin for eye-row: lum > 0.55 and |sat - med| < 0.1, med over face lum>0.55
    face_sat = sat[fy0b:fy1b, fx0b:fx1b]
    bright = face_lum > 0.55
    med_sat_b = float(np.median(face_sat[bright])) if int(bright.sum()) else float(med_sat)
    full_sat_med = med_sat_b
    skin_full = (lum > 0.55) & (np.abs(sat - full_sat_med) < 0.1)
    # eye row: longest non-skin run flanked by skin within face rows
    eye_row = int(H * 0.45)
    eye_found = False
    best_run = 0
    for yy in range(fy0b, fy1b):
        row = skin_full[yy, fx0b:fx1b]
        # find non-skin runs flanked by skin on both sides
        xs = np.nonzero(~row)[0]
        if xs.size == 0:
            continue
        # split into contiguous runs
        start = int(xs[0])
        prev = int(xs[0])
        runs = []
        for x in xs[1:]:
            x = int(x)
            if x == prev + 1:
                prev = x
            else:
                runs.append((start, prev))
                start = x
                prev = x
        runs.append((start, prev))
        for rs, re in runs:
            if rs > 0 and re < (fx1b - fx0b - 1) and row[rs - 1] and row[re + 1]:
                ln = re - rs + 1
                if ln > best_run:
                    best_run = ln
                    eye_row = yy
                    eye_found = True
    # hair bbox from head-region hair mask
    mask_full = np.zeros_like(lum, dtype=bool)
    mask_full[0:y1, x0:x1] = hair_mask
    ys_nz, xs_nz = np.nonzero(mask_full)
    if len(ys_nz):
        btop, bbot = int(ys_nz.min()), int(ys_nz.max())
    else:
        btop, bbot = 0, H - 1
    chin_row = int(eye_row + 0.9 * (eye_row - btop))
    chin_row = max(0, min(H - 1, chin_row))
    hair_w_chin = int(mask_full[chin_row, :].sum())
    skin_row = skin_full[eye_row, :]
    skin_xs = np.nonzero(skin_row)[0]
    head_w = int(skin_xs.max() - skin_xs.min() + 1) if len(skin_xs) >= 2 else 0
    jaw_ratio = float(hair_w_chin / head_w) if head_w else 0.0
    bbox_h = max(1, bbot - btop + 1)
    sh_row = int(bbot - 0.05 * bbox_h)
    sh_row = max(0, min(H - 1, sh_row))
    hair_w_sh = int(mask_full[sh_row, :].sum())
    sh_ratio = float(hair_w_sh / head_w) if head_w else 0.0

    print(json.dumps({
        "crownScalpFraction": crown,
        "sweaterPixels": sweater,
        "meanHairLuminance": mean_hair_lum,
        "hairWarmth": hair_warmth,
        "volume": volume,
        "hairPixels": hair_pixels,
        "headPixels": head_pixels,
        "medianFaceSat": med_sat,
        "faceMeanLuminance": face_mean_lum,
        "backgroundLuminance": bg_lum,
        "jawWidthRatio": jaw_ratio,
        "shoulderWidthRatio": sh_ratio,
        "eyeRow": int(eye_row),
        "eyeRowFound": bool(eye_found),
        "headWidthPx": int(head_w),
    }))


if __name__ == "__main__":
    main()
