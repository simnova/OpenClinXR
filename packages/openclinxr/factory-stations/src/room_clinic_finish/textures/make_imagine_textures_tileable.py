"""Tileable pass + derived maps for the 2026-09-28 Grok Imagine room textures.

Sources (bytes copied unchanged from the grok image_gen session, see
docs/openclinxr/room-realism/imagine-textures-2026-09-28/manifest.json):
  ceiling-tile-face.jpg <- session 1.jpg (kept attempt 1)
  floor-vinyl.jpg       <- session 2.jpg (kept attempt 1)
  wall-plaster.jpg      <- session 3.jpg (kept attempt 1)
  door-maple.jpg        <- session 5.jpg (kept attempt 2)
Session 4.jpg (door attempt 1, mirrored cathedral arches) is kept only as
textures/rejected/door-maple-rejected-attempt1.jpg and is never processed.

Pipeline per kept albedo (deterministic; numpy + Pillow only, no randomness):
  1. Roll by (H//2, W//2) with wraparound; the four original corners meet at
     the new center seam.
  2. Heal the center seam: blend the rolled image toward its Gaussian-blurred
     copy inside a band of SEAM_HALF_WIDTH px around the center row/column.
     Weight w(d) = 0.5 * (1 + cos(pi * d / SEAM_HALF_WIDTH)) for d in
     [0, SEAM_HALF_WIDTH), 0 outside; row and column bands combine by max.
  3. Normal map: height = Rec.709 luminance / 255; Sobel 3x3 gradients with
     wraparound sampling (so the map tiles); n = normalize(-gx*s, -gy*s, 1)
     with NORMAL_STRENGTH s; encoded (n*0.5+0.5)*255.
  4. Roughness map: local stddev of luminance in a ROUGH_WINDOW square window
     (wraparound); rough = 1 - (std - min) / (max - min) over the texture, so
     flat areas read rough (1) and the highest-contrast feature reads 0.
  5. 2x2 tiled preview of the tiled albedo for product-owner grading.

Outputs: <base>-tileable.jpg (q95), <base>-normal.png, <base>-roughness.png
in this directory; preview-2x2-<base>.jpg (q90) plus derivation-params.json
under docs/openclinxr/room-realism/imagine-textures-2026-09-28/.

Regenerate:  python3 make_imagine_textures_tileable.py
Requires: Pillow, numpy (built with Pillow 12.3.0, numpy 2.5.1).
"""

import hashlib
import json
import os

import numpy as np
from PIL import Image, ImageFilter

TEXTURE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = TEXTURE_DIR.split("packages")[0]
JOB_DIR = os.path.join(
    ROOT,
    "docs",
    "openclinxr",
    "room-realism",
    "imagine-textures-2026-09-28",
)

KEPT = (
    "ceiling-tile-face.jpg",
    "floor-vinyl.jpg",
    "wall-plaster.jpg",
    "door-maple.jpg",
)

SEAM_HALF_WIDTH = 24
BLUR_RADIUS = 8
NORMAL_STRENGTH = 2.0
ROUGH_WINDOW = 5
TILEABLE_JPEG_Q = 95
PREVIEW_JPEG_Q = 90

SOBEL_X = np.array([[-1.0, 0.0, 1.0], [-2.0, 0.0, 2.0], [-1.0, 0.0, 1.0]])
SOBEL_Y = SOBEL_X.T


def md5(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def roll_half(arr):
    h, w = arr.shape[:2]
    return np.roll(arr, shift=(h // 2, w // 2), axis=(0, 1))


def seam_weights(h, w):
    yy = np.abs(np.arange(h) - h // 2).astype(np.float64)
    xx = np.abs(np.arange(w) - w // 2).astype(np.float64)

    def falloff(d):
        m = np.zeros_like(d)
        inside = d < SEAM_HALF_WIDTH
        m[inside] = 0.5 * (1.0 + np.cos(np.pi * d[inside] / SEAM_HALF_WIDTH))
        return m

    return np.maximum(falloff(yy)[:, None], falloff(xx)[None, :])


def make_tileable(rgb):
    rolled = roll_half(rgb)
    img = Image.fromarray(rolled)
    blurred = np.asarray(img.filter(ImageFilter.GaussianBlur(BLUR_RADIUS)))
    w = seam_weights(rgb.shape[0], rgb.shape[1])[..., None]
    out = w * blurred.astype(np.float64) + (1.0 - w) * rolled.astype(np.float64)
    return np.clip(np.round(out), 0, 255).astype(np.uint8)


def luminance(rgb):
    f = rgb.astype(np.float64)
    return 0.2126 * f[..., 0] + 0.7152 * f[..., 1] + 0.0722 * f[..., 2]


def sobel_wrap(h):
    gx = (
        SOBEL_X[0, 0] * np.roll(h, (1, 1), (0, 1))
        + SOBEL_X[0, 2] * np.roll(h, (1, -1), (0, 1))
        + SOBEL_X[1, 0] * np.roll(h, (0, 1), (0, 1))
        + SOBEL_X[1, 2] * np.roll(h, (0, -1), (0, 1))
        + SOBEL_X[2, 0] * np.roll(h, (-1, 1), (0, 1))
        + SOBEL_X[2, 2] * np.roll(h, (-1, -1), (0, 1))
    )
    gy = (
        SOBEL_Y[0, 0] * np.roll(h, (1, 1), (0, 1))
        + SOBEL_Y[0, 1] * np.roll(h, (1, 0), (0, 1))
        + SOBEL_Y[0, 2] * np.roll(h, (1, -1), (0, 1))
        + SOBEL_Y[2, 0] * np.roll(h, (-1, 1), (0, 1))
        + SOBEL_Y[2, 1] * np.roll(h, (-1, 0), (0, 1))
        + SOBEL_Y[2, 2] * np.roll(h, (-1, -1), (0, 1))
    )
    return gx / 255.0, gy / 255.0


def normal_map(tiled):
    h = luminance(tiled)
    gx, gy = sobel_wrap(h)
    nx = -gx * NORMAL_STRENGTH
    ny = -gy * NORMAL_STRENGTH
    nz = np.ones_like(nx)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack((nx * inv, ny * inv, nz * inv), axis=-1)
    return np.clip(np.round((n * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8)


def box_mean(a, k):
    p = k // 2
    b = np.pad(a, p, mode="wrap")
    ii = np.zeros((b.shape[0] + 1, b.shape[1] + 1))
    ii[1:, 1:] = np.cumsum(np.cumsum(b, axis=0), axis=1)
    h, w = a.shape
    s = ii[k : k + h, k : k + w] - ii[0:h, k : k + w] - ii[k : k + h, 0:w] + ii[0:h, 0:w]
    return s / float(k * k)


def roughness_map(tiled):
    lum = luminance(tiled)
    mean = box_mean(lum, ROUGH_WINDOW)
    mean2 = box_mean(lum * lum, ROUGH_WINDOW)
    std = np.sqrt(np.maximum(mean2 - mean * mean, 0.0))
    lo, hi = float(std.min()), float(std.max())
    if hi - lo < 1e-9:
        rough = np.ones_like(std)
    else:
        rough = 1.0 - (std - lo) / (hi - lo)
    return np.clip(np.round(rough * 255.0), 0, 255).astype(np.uint8), lo, hi


def main():
    import PIL

    record = {
        "script": os.path.basename(__file__),
        "pillow": PIL.__version__,
        "numpy": np.__version__,
        "seamHalfWidthPx": SEAM_HALF_WIDTH,
        "seamFalloff": "0.5*(1+cos(pi*d/SEAM_HALF_WIDTH)), row/col bands combined by max",
        "healBlur": "GaussianBlur radius %d" % BLUR_RADIUS,
        "normalHeight": "Rec.709 luminance/255",
        "normalOperator": "Sobel 3x3 with wraparound sampling",
        "normalStrength": NORMAL_STRENGTH,
        "roughnessFormula": "1-(std-min)/(max-min); std = local luminance stddev in ROUGH_WINDOW square box window with wraparound",
        "roughWindow": ROUGH_WINDOW,
        "tileableJpegQ": TILEABLE_JPEG_Q,
        "previewJpegQ": PREVIEW_JPEG_Q,
        "textures": [],
    }
    os.makedirs(JOB_DIR, exist_ok=True)
    for base in KEPT:
        stem = base[: -len(".jpg")]
        src = os.path.join(TEXTURE_DIR, base)
        rgb = np.asarray(Image.open(src).convert("RGB"))
        tiled = make_tileable(rgb)
        nrm = normal_map(tiled)
        rgh, lo, hi = roughness_map(tiled)

        tiled_path = os.path.join(TEXTURE_DIR, stem + "-tileable.jpg")
        nrm_path = os.path.join(TEXTURE_DIR, stem + "-normal.png")
        rgh_path = os.path.join(TEXTURE_DIR, stem + "-roughness.png")
        Image.fromarray(tiled).save(tiled_path, quality=TILEABLE_JPEG_Q)
        Image.fromarray(nrm).save(nrm_path)
        Image.fromarray(rgh).save(rgh_path)

        strip = np.concatenate(
            (np.concatenate((tiled, tiled), axis=1), np.concatenate((tiled, tiled), axis=1)),
            axis=0,
        )
        preview_path = os.path.join(JOB_DIR, "preview-2x2-%s.jpg" % stem)
        Image.fromarray(strip).save(preview_path, quality=PREVIEW_JPEG_Q)

        entry = {
            "source": base,
            "sourceMd5": md5(src),
            "size": [int(rgb.shape[1]), int(rgb.shape[0])],
            "tiled": os.path.relpath(tiled_path, ROOT),
            "tiledMd5": md5(tiled_path),
            "normal": os.path.relpath(nrm_path, ROOT),
            "normalMd5": md5(nrm_path),
            "roughness": os.path.relpath(rgh_path, ROOT),
            "roughnessMd5": md5(rgh_path),
            "roughnessStdMin": lo,
            "roughnessStdMax": hi,
            "preview": os.path.relpath(preview_path, ROOT),
            "previewMd5": md5(preview_path),
        }
        record["textures"].append(entry)
        print("%s: tiled=%s preview=%s roughStd=[%.4f, %.4f]" % (base, entry["tiledMd5"][:8], entry["previewMd5"][:8], lo, hi))

    sidecar = os.path.join(JOB_DIR, "derivation-params.json")
    with open(sidecar, "w") as f:
        json.dump(record, f, indent=2)
        f.write("\n")
    print("sidecar: %s" % sidecar)


if __name__ == "__main__":
    main()
