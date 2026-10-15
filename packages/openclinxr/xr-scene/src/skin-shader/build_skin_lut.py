"""Pre-integrated skin-scatter LUT (tsk_44e25e12108c307e).

Penner & Borshukov (GPU Pro 2, 2011) "Pre-Integrated Skin Shading": diffuse
as a 2D function of (NdotL, curvature), integrated ONCE offline over a skin
diffusion profile instead of evaluated per-pixel.

Profile: sum-of-Gaussians diffusion fit. Weights/variances below are the
separable-SSS skin fit (Jimenez et al. 2009, "Screen-Space Perceptual
Rendering of Human Skin", following the d'Eon & Luebke GPU Gems 3 ch.14
section 14.4.7 sum-of-Gaussians method for the Donner & Jensen 2005
multipole):
  wRGB = [(0.233,0.455,0.649), (0.100,0.336,0.344), (0.118,0.198,0.0),
          (0.113,0.007,0.007), (0.358,0.004,0.0), (0.078,0.0,0.0)]
  v    = [0.0064, 0.0484, 0.187, 0.567, 1.99, 7.41] mm^2
The LUT stores a scalar factor, so each RGB lobe is collapsed to luminance
(Rec.709) and renormalized to unit sum (total diffuse response of a
Gaussian-sum profile is the sum of its weights: d'Eon/Luebke/Enderton,
"Efficient Rendering of Human Skin", EGSR 2007, eq.13 context).

Geometry model: 1D circle cross-section of radius r. A shading point at
angle 0 with outward normal n, key light at angle tL from n
(NdotL = cos tL). Neighbour at arc-angle p has normal rotated by p and
sees saturate(cos(tL - p)); light arriving there diffuses to the shading
point through K(r*p), K the scalar profile above:
  B(tL, r) = Integral K(r*p) * saturate(cos(tL - p)) * r dp, p in [-pi, pi]
Curvature axis: deviation c = |curv - 0.5| * 2 in [0,1] (the baked map
stores flat as 0.5: skin-shade.ts SKIN_CURVATURE_FLAT; map median 0.51).
Radius r(c) = R_MIN / c (R_MIN = 4mm, recorded constant: ear-helix order;
c=0.25 -> 16mm nose order; c->0 -> flat infinity). At c = 0 the kernel is
a delta and B == saturate(NdotL) exactly; row 0 is PINNED to the identity
ramp so flat surfaces are bit-exact up to 8-bit storage (G1 epsilon
1/255). Angular blur width scales with c, which is the correct scaling
for a fixed world-width kernel on a sphere cross-section (arc angle =
width / r = width * c / R_MIN).

Layout: W=128 (u: NdotL in [-1,1] -> [0,1]), H=16 (v: c in [0,1]).
File row j (top-first, as decoded) = v = j/(H-1); row 0 (v=0) = flat
identity. DataTexture upload uses flipY=false, so data row 0 = v 0.
Values clamped [0,1] and stored 8-bit grayscale RGB.

Outputs (this directory): skin-lut.png + skin-lut-data.ts (base64 bytes
of the same rows, top-first, with the PNG sha recorded inside).

Run: `mise exec -- python3 <this file>` (foreground only).
"""

from __future__ import annotations

import base64
import hashlib
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
W, H = 128, 16
R_MIN_MM = 4.0

# Separable-SSS skin fit lobes (source cited in the module docstring).
W_RGB = np.array(
    [
        [0.233, 0.455, 0.649],
        [0.100, 0.336, 0.344],
        [0.118, 0.198, 0.000],
        [0.113, 0.007, 0.007],
        [0.358, 0.004, 0.000],
        [0.078, 0.000, 0.000],
    ],
    dtype=np.float64,
)
VARIANCES = np.array([0.0064, 0.0484, 0.187, 0.567, 1.99, 7.41], dtype=np.float64)

# Rec.709 luminance collapse, renormalized to unit sum.
LUM = np.array([0.2126, 0.7152, 0.0722], dtype=np.float64)
W_SCALAR = W_RGB @ LUM
W_SCALAR = W_SCALAR / W_SCALAR.sum()


def scalar_kernel(d_mm: np.ndarray) -> np.ndarray:
    """1D cross-section K(d), d in mm: the line integral of the 2D radial
    Gaussian-sum profile, so K_1D(d) = sum w_i (2 pi v_i)^-1/2 e^-d^2/2v_i
    and Integral K dd = sum w_i = 1 (the 2D form (2 pi v)^-1 from
    d'Eon/Luebke/Enderton EGSR 2007 eq.7 integrates to 1 over AREA, not
    over the line — using it here gained 2.8x energy)."""
    out = np.zeros_like(d_mm)
    for w, v in zip(W_SCALAR.tolist(), VARIANCES.tolist()):
        out += w * np.exp(-d_mm * d_mm / (2.0 * v)) / np.sqrt(2.0 * np.pi * v)
    return out


def main() -> int:
    print(f"lobe weights (luminance, normalized): {np.round(W_SCALAR, 5).tolist()}")
    ndl = np.linspace(-1.0, 1.0, W)
    theta = np.arccos(np.clip(ndl, -1.0, 1.0))
    sat = np.clip(ndl, 0.0, 1.0)

    dphi = 0.002
    phi = np.arange(-np.pi, np.pi + dphi / 2.0, dphi)
    lut = np.zeros((H, W), dtype=np.float64)
    lut[0, :] = sat  # G1: flat row pinned to the unhooked physical diffuse.

    max_unclamped = 0.0
    clamped_count = 0
    for j in range(1, H):
        c = j / (H - 1)
        r = R_MIN_MM / c
        k = scalar_kernel(r * phi) * r * dphi  # discrete energy, sums ~1
        energy = float(k.sum())
        # cos(theta_k - phi_m) for all (k, m); saturate; integrate.
        cosmx = np.cos(theta[:, None] - phi[None, :])
        b = k[None, :] @ np.clip(cosmx, 0.0, 1.0).T
        b = np.asarray(b).reshape(-1)
        max_unclamped = max(max_unclamped, float(b.max()))
        clamped_count += int((b > 1.0).sum() + (b < 0.0).sum())
        lut[j, :] = np.clip(b, 0.0, 1.0)
        print(f"row {j:2d} c={c:.3f} r={r:7.2f}mm kernelEnergy={energy:.4f} "
              f"B(ndl=-1)={b[0]:.4f} B(0)={b[W//2]:.4f} B(1)={b[-1]:.4f}")

    print(f"max unclamped value: {max_unclamped:.4f} (clamped texels: {clamped_count})")
    # Continuity: the tightest curved row must already approach identity.
    print(f"row1 vs identity maxAbs: {float(np.abs(lut[1] - sat).max()):.5f}")

    q = np.round(lut * 255.0).astype(np.uint8)
    # G1 self-check: flat row is the identity ramp up to 8-bit quantisation.
    g1 = np.abs(q[0].astype(np.int16) - np.round(sat * 255.0).astype(np.int16))
    print(f"G1 flat-row maxAbs vs saturate(NdotL): {g1.max()}/255")
    assert int(g1.max()) == 0, "flat row must equal the quantized identity ramp"

    rgb = np.repeat(q[:, :, None], 3, axis=2)
    # Rows top-first: file row j = v j/(H-1); write top-first explicitly.
    img = Image.fromarray(rgb.reshape(H, W, 3), mode="RGB")
    png_path = HERE / "skin-lut.png"
    img.save(png_path)
    sha = hashlib.sha256(png_path.read_bytes()).hexdigest()
    print(f"wrote {png_path} sha256={sha} bytes={png_path.stat().st_size}")

    raw = q.tobytes()  # top-first, row-major: data row 0 = v 0 (flipY=false).
    b64 = base64.b64encode(raw).decode("ascii")
    ts = (
        "/**\n"
        " * Generated by build_skin_lut.py — do not hand-edit.\n"
        f" * skin-lut.png sha256: {sha} ({W}x{H} 8-bit grayscale RGB).\n"
        " * Bytes are row-major, top-first: data row 0 = v 0 (flat identity),\n"
        " * uploaded with flipY=false so v 0 samples the identity row.\n"
        " */\n"
        f'export const SKIN_LUT_WIDTH = {W};\n'
        f'export const SKIN_LUT_HEIGHT = {H};\n'
        f'export const SKIN_LUT_PNG_SHA256 = "{sha}";\n'
        f'export const SKIN_LUT_BYTES_BASE64 = "{b64}";\n'
    )
    (HERE / "skin-lut-data.ts").write_text(ts, encoding="utf8")
    print(f"wrote skin-lut-data.ts b64chars={len(b64)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
