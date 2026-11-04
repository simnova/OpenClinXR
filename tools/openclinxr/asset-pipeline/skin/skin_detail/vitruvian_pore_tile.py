#!/usr/bin/env python3
"""Vitruvian cheek pore tile synthesis (st-vitpore D2).

Cheek pore detail tile from the CC0 Vitruvian Face Height scan, packed as a
tangent-space normal PNG for the OPENCLINXR_skin_shade glTF extension
(detailNormalTexture carrier, station-side).

Pipeline (all constants relative; no absolute pore-depth / sigma / budget
gates feed any acceptance decision — see the plan's "Numbers that must not
go into a contract"):
  1. Read the source EXR (float32 height), the C2 cheek crop (256px).
  2. Moisan 2011 periodic-plus-smooth decomposition of the raw crop; retain
     the periodic component so opposite edges agree without amplitude taper.
  3. Wrap-around high-pass: tile the periodic component 3x3, apply
     GaussianBlur(sigma=8px), and retain the centre tile. Height is then
     normalized to unit variance (sibling convention).
  4. Amplifier: SLOPE_GAIN applied to the unit-variance height before the
     gradient (sibling: STRENGTH=1.2). A flat control still reproduces flat
     (zero gradient), so the null result stays attributable, not hidden.
  5. Periodic central differences -> tangent normal RGB (sibling convention from
     coherent-normal/bake_coherent_pore_normal.py).
  6. Non-interlaced PNG (zlib/struct writer, same as sibling); JSON manifest.

The normal tile is UNIT-FREE: caller (D3) sets KHR_texture_transform scale so
tile spacing lands in the 250-500 um literature band; mm/texel of the tile is
recorded in the manifest for that step.

Usage:
  mise exec -- python3 tools/openclinxr/asset-pipeline/skin/skin_detail/vitruvian_pore_tile.py \
    --out-dir <dir> [--size 256] [--sigma 8] [--crop-cx 1216] [--crop-cy 1760] \
    [--seed <int>] [--shuffle-source]
  --shuffle-source: G1 counterweight — deterministic shuffle (seeded) of the
  source pixels before the pipeline; the spacing peak must vanish or move >2x.

Deps: python3 / numpy / opencv (OPENCV_IO_ENABLE_OPENEXR=1 for .exr read).
Env overrides: VITRUVIAN_SRC, OUT_DIR.
"""
import argparse
import hashlib
import json
import os
import struct
import sys
import zlib
from pathlib import Path

import numpy

SRC_DEFAULT = ("/Volumes/files/openclinxr-assets/store/vitruvian-src/4K/"
               "Vitruvian_Face_Height_Utility - Raw.exr")
METHOD = "periodic-smooth-decomposition-wrap-highpass"
SIZE_DEFAULT = 256
SIGMA_DEFAULT = 8.0
CROP_CX_DEFAULT = 1216
CROP_CY_DEFAULT = 1760
ALPHA = 0.25
# Slope gain applied to the unit-variance height before the gradient.
# Sibling convention (coherent-normal/bake_coherent_pore_normal.py:
# STRENGTH=1.2 on unit-variance height, targeting visible normal deviation).
# Construction parameter, recorded in the manifest — NOT a gate. The visible
# amplitude is decided by the runtime detailNormalStrength sweep (D5).
SLOPE_GAIN = 1.2


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def read_source(path: str) -> tuple["numpy.ndarray", str]:
    import cv2
    raw = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if raw is None:
        raise SystemExit(f"cannot read EXR: {path} "
                         "(need OPENCV_IO_ENABLE_OPENEXR=1)")
    img = numpy.asarray(raw, dtype=numpy.float64).squeeze()
    assert img.ndim == 2, f"expected single-channel height, got {img.shape}"
    return img, sha(Path(path).read_bytes())


def tukey(n: int, alpha: float) -> "numpy.ndarray":
    w = numpy.ones(n)
    m = int(alpha * n / 2)
    ramp = 0.5 * (1 - numpy.cos(numpy.pi * numpy.arange(m) / m))
    w[:m] = ramp
    w[-m:] = ramp[::-1]
    return w


def periodic(u: "numpy.ndarray") -> "numpy.ndarray":
    """Moisan 2011 periodic-plus-smooth decomposition; return periodic part."""
    rows, cols = u.shape
    boundary = numpy.zeros_like(u)
    boundary[0, :] += u[-1, :] - u[0, :]
    boundary[-1, :] += u[0, :] - u[-1, :]
    boundary[:, 0] += u[:, -1] - u[:, 0]
    boundary[:, -1] += u[:, 0] - u[:, -1]
    row_freq = numpy.arange(rows)[:, None]
    col_freq = numpy.arange(cols)[None, :]
    denominator = (2 * numpy.cos(2 * numpy.pi * row_freq / rows)
                   + 2 * numpy.cos(2 * numpy.pi * col_freq / cols) - 4)
    denominator[0, 0] = 1
    smooth = numpy.fft.ifft2(numpy.fft.fft2(boundary) / denominator).real
    smooth -= smooth.mean()
    return u - smooth


def wrap_highpass(p: "numpy.ndarray", sigma: float) -> "numpy.ndarray":
    import cv2
    rows, cols = p.shape
    tiled = numpy.tile(p, (3, 3))
    blurred = cv2.GaussianBlur(tiled, (0, 0), sigma)
    return (tiled - blurred)[rows:2 * rows, cols:2 * cols]


def heights_to_normal(h: "numpy.ndarray", gain: float):
    dhdy = (numpy.roll(h, -1, axis=0) - numpy.roll(h, 1, axis=0)) / 2
    dhdx = (numpy.roll(h, -1, axis=1) - numpy.roll(h, 1, axis=1)) / 2
    nx = -dhdx * gain
    ny = -dhdy * gain
    inv = 1.0 / numpy.sqrt(nx * nx + ny * ny + 1.0)
    r = numpy.clip((nx * inv * 0.5 + 0.5) * 255, 0, 255).astype(numpy.uint8)
    g = numpy.clip((ny * inv * 0.5 + 0.5) * 255, 0, 255).astype(numpy.uint8)
    b = numpy.clip((inv * 0.5 + 0.5) * 255, 0, 255).astype(numpy.uint8)
    return r, g, b


def write_png(path: Path, r, g, b, size: int) -> None:
    raw = bytearray()
    for yy in range(size):
        raw.append(0)
        for xx in range(size):
            raw += bytes((int(r[yy, xx]), int(g[yy, xx]), int(b[yy, xx])))
    comp = zlib.compress(bytes(raw), 6)

    def chunk(t: bytes, d: bytes) -> bytes:
        c = t + d
        return (struct.pack(">I", len(d)) + c
                + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", comp) + chunk(b"IEND", b""))
    path.write_bytes(png)


def fft_peak_lambda(h: "numpy.ndarray") -> tuple[int, float]:
    """Radial-PSD peak radius (px) and pore-band energy fraction.

    Returns (r_peak, pore_frac) with the pore band r in 8..15 (the band the
    prior-round probes found holds ~0.39 of total power on the C2 crop).
    """
    import cv2
    n = h.shape[0]
    z = h - h.mean()
    F = numpy.fft.fftshift(numpy.fft.fft2(z))
    P = numpy.abs(F) ** 2
    yy, xx = numpy.mgrid[0:n, 0:n]
    rr = numpy.sqrt((yy - n // 2) ** 2 + (xx - n // 2) ** 2)
    prof = numpy.array([P[numpy.abs(rr - r) < 0.75].mean()
                        for r in range(1, n // 4 + 1)])
    tot = prof.sum()
    band = prof[7:15]
    r_peak = int(8 + int(numpy.argmax(band)))
    return r_peak, float(prof[7:15].sum() / tot)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.environ.get("VITRUVIAN_SRC", SRC_DEFAULT))
    ap.add_argument("--out-dir", default=os.environ.get("OUT_DIR", "."))
    ap.add_argument("--size", type=int, default=SIZE_DEFAULT)
    ap.add_argument("--sigma", type=float, default=SIGMA_DEFAULT)
    ap.add_argument("--crop-cx", type=int, default=CROP_CX_DEFAULT)
    ap.add_argument("--crop-cy", type=int, default=CROP_CY_DEFAULT)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--shuffle-source", action="store_true", default=False)
    args = ap.parse_args()

    import cv2
    img, src_sha = read_source(args.src)
    n = args.size
    if args.shuffle_source:
        rng = numpy.random.default_rng(args.seed if args.seed is not None else 0)
        flat = img.ravel().copy()
        rng.shuffle(flat)
        img = flat.reshape(img.shape)

    crop = img[args.crop_cy - n // 2:args.crop_cy + n // 2,
               args.crop_cx - n // 2:args.crop_cx + n // 2].copy()
    assert crop.shape == (n, n), f"crop shape {crop.shape}"
    crop_std = float(crop.std())
    periodic_crop = periodic(crop - crop.mean())
    hp = wrap_highpass(periodic_crop, args.sigma)
    hp_std = float(hp.std())
    # Unit-variance normalize after the wrap-around high-pass, then apply
    # the construction slope gain. No edge weighting or amplitude taper.
    tile_n = (hp / hp_std * SLOPE_GAIN) if hp_std > 0 else hp * 0.0
    gain = SLOPE_GAIN / hp_std if hp_std > 0 else 0.0
    r, g, b = heights_to_normal(tile_n, 1.0)
    lam_px, pore_frac = fft_peak_lambda(tile_n)

    outdir = Path(args.out_dir)
    outdir.mkdir(parents=True, exist_ok=True)
    png_path = outdir / "vitruvian_pore_tile.png"
    write_png(png_path, r, g, b, n)
    png_sha = sha(png_path.read_bytes())

    # Cheek crop visualisation on a downscaled source preview.
    small = cv2.resize(img, (1024, 1024), interpolation=cv2.INTER_AREA)
    lo, hi = float(numpy.percentile(img, 1)), float(numpy.percentile(img, 99))
    prev = numpy.clip((small - lo) / (hi - lo), 0, 1)
    prev = (prev * 255).astype(numpy.uint8)
    prev = cv2.cvtColor(prev, cv2.COLOR_GRAY2BGR)
    s = 1024 / img.shape[1]
    x0 = int((args.crop_cx - n // 2) * s)
    y0 = int((args.crop_cy - n // 2) * s)
    x1 = int((args.crop_cx + n // 2) * s)
    y1 = int((args.crop_cy + n // 2) * s)
    cv2.rectangle(prev, (x0, y0), (x1, y1), (0, 0, 255), 2)
    crop_png = outdir / "cheek_crop_box.png"
    cv2.imwrite(str(crop_png), prev)

    manifest = {
        "stage": "vitruvian_pore_tile",
        "method": METHOD,
        "source": {"path": args.src, "sha256": src_sha},
        "crop": {"cx": args.crop_cx, "cy": args.crop_cy, "size": n,
                 "box_source_px": [args.crop_cx - n // 2, args.crop_cy - n // 2,
                                   args.crop_cx + n // 2, args.crop_cy + n // 2]},
        "highpass_sigma_source_px": args.sigma,
        "tile_size": n,
        "amplifier": {"mode": "unit-variance-plus-slope-gain",
                      "slope_gain": SLOPE_GAIN, "crop_std": crop_std,
                      "periodic_highpass_std": hp_std, "gain": gain},
        "tile_fft_lambda_px": lam_px,
        "tile_pore_band_fraction": pore_frac,
        "output": {"path": str(png_path), "sha256": png_sha},
        "crop_visualisation": str(crop_png),
        "shuffled": args.shuffle_source,
        "seed": args.seed,
        "versions": {"numpy": numpy.__version__, "opencv": cv2.__version__,
                     "python": sys.version.split()[0]},
        # mm/texel of the tile is a D3 output (needs the aisha cheek UV
        # scale first); recorded here as null until D3 fills it.
        "mm_per_texel_tile": None,
    }
    (outdir / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(json.dumps({"tile": str(png_path), "sha256": png_sha,
                      "lambda_px": lam_px, "pore_frac": round(pore_frac, 4),
                      "gain": round(gain, 4),
                      "crop_box": manifest["crop"]["box_source_px"]}))


if __name__ == "__main__":
    main()
