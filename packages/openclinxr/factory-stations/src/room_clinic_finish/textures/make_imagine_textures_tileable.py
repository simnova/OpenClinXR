"""Tileable pass + derived maps for the 2026-09-28 Grok Imagine room textures.

Sources (bytes copied unchanged from the grok image_gen session, see
docs/openclinxr/room-realism/imagine-textures-2026-09-28/manifest.json):
  ceiling-tile-face.jpg <- session 1.jpg (kept attempt 1)
  floor-vinyl.jpg       <- session 2.jpg (kept attempt 1)
  wall-plaster.jpg      <- session 3.jpg (kept attempt 1)
  door-maple.jpg        <- session 5.jpg (kept attempt 2)
Session 4.jpg (door attempt 1, mirrored cathedral arches) is kept only as
textures/rejected/door-maple-rejected-attempt1.jpg and is never processed.

Row-33 revision (product-owner grading of the row-32 2x2 previews): the wall
preview showed a checkerboard of brightness steps at tile boundaries.
Diagnosed cause: the Imagine sources carry low-frequency illumination
gradients, and half-offset tiling mirrors that gradient into a checkerboard.
A wider seam blend cannot fix a whole-image low-frequency signal, so the
three runtime-tiled textures (ceiling/floor/wall) are flattened FIRST:

  0. Flatten: divide the kept albedo per channel by a heavily-blurred copy
     of itself (Pillow GaussianBlur radius FLATTEN_BLUR_RADIUS ~= W/8),
     then rescale each channel back to that channel's own original mean.
     This removes the illumination gradient, keeps fine detail.
  1. Roll by (H//2, W//2) with wraparound; the four original corners meet at
     the new center seam.
  2. Heal the center seam: blend the rolled image toward its Gaussian-blurred
     copy inside a band of SEAM_HALF_WIDTH px around the center row/column.
     Weight w(d) = 0.5 * (1 + cos(pi * d / SEAM_HALF_WIDTH)) for d in
     [0, SEAM_HALF_WIDTH), 0 outside; row and column bands combine by max.
     (Row-32 blend logic reused UNCHANGED; only the flatten-first step is
     new. Rationale: the mismatch was low-frequency, not a local seam
     artifact, so the local heal needed no widening once flattened.)
  3. Seam metric (measured, not fitted): mean absolute Rec.709 luminance step
     across the center seam column/row pairs of the shipped tile, versus the
     same statistic for every other adjacent interior pair (blend band
     excluded); PASS when seam step <= 95th percentile of the interior
     population. Recorded per texture in derivation-params.json.
  4. Normal map: height = Rec.709 luminance / 255; Sobel 3x3 gradients with
     wraparound sampling (so the map tiles); n = normalize(-gx*s, -gy*s, 1)
     with NORMAL_STRENGTH s; encoded (n*0.5+0.5)*255.
  5. Roughness map: local stddev of luminance in a ROUGH_WINDOW square window
     (wraparound); rough = 1 - (std - min) / (max - min) over the texture, so
     flat areas read rough (1) and the highest-contrast feature reads 0.
  6. 2x2 tiled preview of the tiled albedo for product-owner grading.

The door maple texture is NEVER tiled at runtime (it maps once across the
door leaf, UV 0-1, no repeat), so it gets no flatten/offset pipeline at
all: the kept albedo is center-cropped to the leaf aspect 0.95:2.10
(W:H) and its normal/roughness maps use edge-clamped (non-wrapping)
sampling. No seam metric applies. The leaf mesh/UV already handles the
vision-lite cutout; this job provides only the flat maple field.

Outputs (tiled three): <base>-tileable.jpg (q95), <base>-normal.png,
<base>-roughness.png in this directory; preview-2x2-<base>.jpg (q90) plus
derivation-params.json under
docs/openclinxr/room-realism/imagine-textures-2026-09-28/.
Outputs (door): door-maple-leaf.jpg (q95, leaf aspect, UV 0-1 single map),
door-maple-normal.png, door-maple-roughness.png (edge-clamped operators),
preview-leaf-door-maple.jpg (q90, single leaf, not 2x2).

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

TILED = (
    "ceiling-tile-face.jpg",
    "floor-vinyl.jpg",
    "wall-plaster.jpg",
)
DOOR_SOURCE = "door-maple.jpg"

SEAM_HALF_WIDTH = 24
BLUR_RADIUS = 8
FLATTEN_BLUR_RADIUS = 128  # ~= W/8 for the 1024px sources
NORMAL_STRENGTH = 2.0
ROUGH_WINDOW = 5
TILEABLE_JPEG_Q = 95
PREVIEW_JPEG_Q = 90
DOOR_ASPECT_W = 0.95
DOOR_ASPECT_H = 2.10

SOBEL_X = np.array([[-1.0, 0.0, 1.0], [-2.0, 0.0, 2.0], [-1.0, 0.0, 1.0]])
SOBEL_Y = SOBEL_X.T


def md5(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def flatten_illumination(rgb):
    """Divide per channel by a heavily-blurred copy, restore channel means."""
    f = rgb.astype(np.float64)
    means = f.mean(axis=(0, 1))
    blurred = np.asarray(
        Image.fromarray(rgb).filter(ImageFilter.GaussianBlur(FLATTEN_BLUR_RADIUS))
    ).astype(np.float64)
    blurred = np.maximum(blurred, 1.0)
    flat = f / blurred * means[None, None, :]
    return np.clip(np.round(flat), 0, 255).astype(np.uint8)


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


def seam_metric(tiled):
    """Mean abs luminance step at the center seam vs interior p95.

    Returns (seamStep, interiorP95, passed). Interior population excludes
    adjacent pairs touching the blend band around the center seam.
    """
    lum = luminance(tiled)
    h, w = lum.shape
    ch, cw = h // 2, w // 2
    v_seam = float(np.mean(np.abs(lum[:, cw] - lum[:, cw - 1])))
    h_seam = float(np.mean(np.abs(lum[ch, :] - lum[ch - 1, :])))
    seam = (v_seam + h_seam) / 2.0

    lo = SEAM_HALF_WIDTH + 1
    col_steps = np.mean(np.abs(np.diff(lum, axis=1)), axis=0)  # W-1 values
    row_steps = np.mean(np.abs(np.diff(lum, axis=0)), axis=1)  # H-1 values
    keep_cols = np.ones(w - 1, dtype=bool)
    keep_cols[(cw - lo - 1) : (cw + lo)] = False
    keep_rows = np.ones(h - 1, dtype=bool)
    keep_rows[(ch - lo - 1) : (ch + lo)] = False
    interior = np.concatenate((col_steps[keep_cols], row_steps[keep_rows]))
    p95 = float(np.percentile(interior, 95))
    return seam, p95, bool(seam <= p95)


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


def sobel_edge(h):
    """Sobel 3x3 with edge-clamped sampling (for the non-tiled door leaf)."""
    p = np.pad(h, 1, mode="edge")
    gx = (
        SOBEL_X[0, 0] * p[:-2, :-2]
        + SOBEL_X[0, 2] * p[:-2, 2:]
        + SOBEL_X[1, 0] * p[1:-1, :-2]
        + SOBEL_X[1, 2] * p[1:-1, 2:]
        + SOBEL_X[2, 0] * p[2:, :-2]
        + SOBEL_X[2, 2] * p[2:, 2:]
    )
    gy = (
        SOBEL_Y[0, 0] * p[:-2, :-2]
        + SOBEL_Y[0, 1] * p[:-2, 1:-1]
        + SOBEL_Y[0, 2] * p[:-2, 2:]
        + SOBEL_Y[2, 0] * p[2:, :-2]
        + SOBEL_Y[2, 1] * p[2:, 1:-1]
        + SOBEL_Y[2, 2] * p[2:, 2:]
    )
    return gx / 255.0, gy / 255.0


def encode_normal(gx, gy):
    nx = -gx * NORMAL_STRENGTH
    ny = -gy * NORMAL_STRENGTH
    nz = np.ones_like(nx)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack((nx * inv, ny * inv, nz * inv), axis=-1)
    return np.clip(np.round((n * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8)


def normal_map(tiled):
    return encode_normal(*sobel_wrap(luminance(tiled)))


def normal_map_edge(leaf):
    return encode_normal(*sobel_edge(luminance(leaf)))


def box_mean(a, k, mode="wrap"):
    p = k // 2
    b = np.pad(a, p, mode=mode)
    ii = np.zeros((b.shape[0] + 1, b.shape[1] + 1))
    ii[1:, 1:] = np.cumsum(np.cumsum(b, axis=0), axis=1)
    h, w = a.shape
    s = ii[k : k + h, k : k + w] - ii[0:h, k : k + w] - ii[k : k + h, 0:w] + ii[0:h, 0:w]
    return s / float(k * k)


def roughness_map(tiled, mode="wrap"):
    lum = luminance(tiled)
    mean = box_mean(lum, ROUGH_WINDOW, mode=mode)
    mean2 = box_mean(lum * lum, ROUGH_WINDOW, mode=mode)
    std = np.sqrt(np.maximum(mean2 - mean * mean, 0.0))
    lo, hi = float(std.min()), float(std.max())
    if hi - lo < 1e-9:
        rough = np.ones_like(std)
    else:
        rough = 1.0 - (std - lo) / (hi - lo)
    return np.clip(np.round(rough * 255.0), 0, 255).astype(np.uint8), lo, hi


def crop_door_leaf(rgb):
    """Center-crop to the door leaf aspect (tall narrow, UV 0-1, no tiling)."""
    h, w = rgb.shape[:2]
    target = DOOR_ASPECT_W / DOOR_ASPECT_H
    leaf_w = int(round(h * target))
    leaf_w = max(1, min(w, leaf_w))
    x0 = (w - leaf_w) // 2
    return rgb[:, x0 : x0 + leaf_w, :]


# Ward maple is pale (v2 ref 04 leaf mean ~(180,170,153)); the Imagine row
# photo renders vivid orange in the runtime (~(207,168,109) at the same
# box, delta +27/-2/-44, outside the +-12 pose-04 gate). Desaturate the
# cropped leaf toward Rec.709 luminance by DOOR_DESAT, then apply
# per-channel LEAF_TONE_GAINS to land the rendered box: desat alone left
# (188.8,171.2,147.1), R 0.5 over the gate and B cool-pale short, so
# gains (0.955,0.994,1.041) pull R in and lift B (target ~= ref,
# B no lower than ref-8). Gains run before the normal/roughness
# derivation (luminance-based, so they barely move).
DOOR_DESAT = 0.6
LEAF_TONE_GAINS = (0.955, 0.994, 1.041)


def desaturate(rgb, amount):
    """Pull saturation toward luminance: out = lum + (rgb-lum)*(1-amount)."""
    f = rgb.astype(np.float64)
    lum = (0.299 * f[:, :, 0] + 0.587 * f[:, :, 1] + 0.114 * f[:, :, 2])
    out = lum[:, :, None] + (f - lum[:, :, None]) * (1.0 - amount)
    return np.clip(np.round(out), 0, 255).astype(np.uint8)


def apply_tone_gains(rgb, gains):
    """Per-channel multiply (render-matched leaf tone), clipped."""
    f = rgb.astype(np.float64) * np.asarray(gains, dtype=np.float64)[None, None, :]
    return np.clip(np.round(f), 0, 255).astype(np.uint8)


def main():
    import PIL

    record = {
        "script": os.path.basename(__file__),
        "revision": "row-33: flatten-first for runtime-tiled textures; door leaf-crop, no tiling; ward desaturation toward luminance",
        "pillow": PIL.__version__,
        "numpy": np.__version__,
        "flattenFirst": "per-channel divide by GaussianBlur(radius=FLATTEN_BLUR_RADIUS~=W/8) copy, rescale each channel to its own original mean; applied to kept albedo BEFORE offset/blend",
        "flattenBlurRadius": FLATTEN_BLUR_RADIUS,
        "seamBlend": "REUSED UNCHANGED from row-32 (offset-by-half wrap + cosine heal, SEAM_HALF_WIDTH=24, BLUR_RADIUS=8); no widening -- mismatch was low-frequency, not a local seam artifact",
        "seamHalfWidthPx": SEAM_HALF_WIDTH,
        "seamFalloff": "0.5*(1+cos(pi*d/SEAM_HALF_WIDTH)), row/col bands combined by max",
        "healBlur": "GaussianBlur radius %d" % BLUR_RADIUS,
        "seamMetric": "mean abs Rec.709 luminance step across center seam pairs (col cw|cw-1, row ch|ch-1, averaged) vs SAME stat for every other adjacent interior pair (blend band +/-SEAM_HALF_WIDTH+1 excluded); PASS iff seam <= interior p95",
        "normalHeight": "Rec.709 luminance/255",
        "normalOperator": "Sobel 3x3 with wraparound sampling (tiled three); edge-clamped sampling (door leaf, not tiled)",
        "normalStrength": NORMAL_STRENGTH,
        "roughnessFormula": "1-(std-min)/(max-min); std = local luminance stddev in ROUGH_WINDOW square box window (wraparound for tiled three, edge-clamped for door leaf)",
        "roughWindow": ROUGH_WINDOW,
        "tileableJpegQ": TILEABLE_JPEG_Q,
        "previewJpegQ": PREVIEW_JPEG_Q,
        "doorTreatment": "center-crop kept door-maple.jpg to leaf aspect 0.95:2.10 (W:H); single UV 0-1 map, no repeat, no offset-tiling; vision-lite cutout left to leaf mesh/UV",
        "doorAspectWH": [DOOR_ASPECT_W, DOOR_ASPECT_H],
        "textures": [],
    }
    os.makedirs(JOB_DIR, exist_ok=True)
    for base in TILED:
        stem = base[: -len(".jpg")]
        src = os.path.join(TEXTURE_DIR, base)
        rgb = np.asarray(Image.open(src).convert("RGB"))
        flat = flatten_illumination(rgb)
        tiled = make_tileable(flat)
        seam, p95, passed = seam_metric(tiled)
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
            "treatment": "flatten-first then offset-by-half wrap + cosine seam heal",
            "size": [int(rgb.shape[1]), int(rgb.shape[0])],
            "tiled": os.path.relpath(tiled_path, ROOT),
            "tiledMd5": md5(tiled_path),
            "seamStep": seam,
            "seamInteriorP95": p95,
            "seamPass": passed,
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
        print(
            "%s: seam=%.4f p95=%.4f %s tiled=%s preview=%s roughStd=[%.4f, %.4f]"
            % (base, seam, p95, "PASS" if passed else "FAIL", entry["tiledMd5"][:8], entry["previewMd5"][:8], lo, hi)
        )

    src = os.path.join(TEXTURE_DIR, DOOR_SOURCE)
    rgb = np.asarray(Image.open(src).convert("RGB"))
    leaf = apply_tone_gains(desaturate(crop_door_leaf(rgb), DOOR_DESAT),
                            LEAF_TONE_GAINS)
    lh, lw = leaf.shape[:2]
    nrm = normal_map_edge(leaf)
    rgh, lo, hi = roughness_map(leaf, mode="edge")
    leaf_path = os.path.join(TEXTURE_DIR, "door-maple-leaf.jpg")
    nrm_path = os.path.join(TEXTURE_DIR, "door-maple-normal.png")
    rgh_path = os.path.join(TEXTURE_DIR, "door-maple-roughness.png")
    Image.fromarray(leaf).save(leaf_path, quality=TILEABLE_JPEG_Q)
    Image.fromarray(nrm).save(nrm_path)
    Image.fromarray(rgh).save(rgh_path)
    preview_path = os.path.join(JOB_DIR, "preview-leaf-door-maple.jpg")
    Image.fromarray(leaf).save(preview_path, quality=PREVIEW_JPEG_Q)
    aspect = lw / lh
    target = DOOR_ASPECT_W / DOOR_ASPECT_H
    entry = {
        "source": DOOR_SOURCE,
        "sourceMd5": md5(src),
        "treatment": "center-crop to door leaf aspect 0.95:2.10, desaturation %.1f toward Rec.709 luminance plus tone gains %s (render-matched pale ward maple); single UV 0-1 map, no repeat, no offset-tiling pipeline; vision-lite cutout left to leaf mesh/UV" % (DOOR_DESAT, list(LEAF_TONE_GAINS)),
        "sourceSize": [int(rgb.shape[1]), int(rgb.shape[0])],
        "leafSize": [int(lw), int(lh)],
        "leafAspectWH": aspect,
        "leafAspectTarget": target,
        "leafAspectRelErr": abs(aspect - target) / target,
        "tiled": None,
        "seamMetric": None,
        "leaf": os.path.relpath(leaf_path, ROOT),
        "leafMd5": md5(leaf_path),
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
    print(
        "door-maple.jpg: leaf=%dx%d aspect=%.6f target=%.6f relErr=%.5f preview=%s roughStd=[%.4f, %.4f]"
        % (lw, lh, aspect, target, entry["leafAspectRelErr"], entry["previewMd5"][:8], lo, hi)
    )

    sidecar = os.path.join(JOB_DIR, "derivation-params.json")
    with open(sidecar, "w") as f:
        json.dump(record, f, indent=2)
        f.write("\n")
    print("sidecar: %s" % sidecar)


if __name__ == "__main__":
    main()
