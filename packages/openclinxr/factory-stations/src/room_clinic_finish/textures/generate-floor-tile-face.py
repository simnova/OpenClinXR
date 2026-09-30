"""Regenerate the procedural vinyl floor-tile texture (600 mm module).

Deterministic (seeded) single-tile face for the ward finish chain: one
repeat spans exactly one 0.6 m tile, so the 0.6 m UV repeat in compose.py
renders every tile at the v2 spec module and the grid lines the room shows
are baked seam borders, never geometry.

Reference anchor (imagine-multiview-v2/02-toward-bed-wall.jpg floor box
500,640,620,700 and 06-floor-base.jpg floor patches): neutral light-grey
vinyl tile, mean sRGB ~(214,213,209) in the pose-02 box, fine visible
seams on a ~600 mm module, fine speckle, NO large-scale mottle (the
BumpyRubberFloor shell reads as a low-frequency cloud; this texture
carries zero low-frequency energy by construction: per-pixel grain plus
sparse darker chips only, so the sigma-8-blur std stays at the ref
floor, not the cloud).

Runtime calibration: the prior baseline rendered R-B=13.6 in poses 01,
02, and 06 while the references span R-B=2.0..8.2 under the same rig.
That pose-invariant excess identifies the tile albedo, rather than the
lighting, as the warm cast. Raising the blue baseline by 14 sRGB units
neutralises that cast after lighting and ACES; a 0.7-unit red trim keeps
pose 06 inside the +/-8 channel gate with rounding margin. Green stays
fixed. Same deterministic seed and grain operators as before.

Seams: a symmetric darkened border (SEAM_PX each side, wraparound-safe)
plus a matching groove in the derived normal map, so every tile edge in
every repeat reads as one fine line at native 1280x720.

Regenerate:  python3 generate-floor-tile-face.py
Writes:      floor-vinyl-tile.png (albedo),
             floor-vinyl-tile-derived-normal.png,
             floor-vinyl-tile-derived-roughness.png (all in this directory).
"""

from __future__ import annotations

import os

import numpy as np
from PIL import Image

SIZE = 512
SEED = 21
# Runtime-calibrated baseline: blue is deliberately 14 sRGB units above
# the prior 170.9 value to cancel the rig's measured pose-invariant warm
# shift. Red is trimmed 0.7 for pose-06 channel-margin; green stays fixed.
BASE_RGB = (177.0, 176.5, 184.9)
# Fine grain only (no mottle cells: low-frequency energy is the defect).
# Mostly shared luminance grain (keeps the warm gap) plus an independent
# per-channel term. Albedo stddev ~7 renders as ~1.5-2.5 after lighting
# minification, inside the ref 1.2-1.5 band with seam pixels excluded.
LUMA_GRAIN_SIGMA = 6.0
CHANNEL_GRAIN_SIGMA = 3.0
# Sparse darker vinyl chips: fraction of pixels darkened by a random depth.
CHIP_FRACTION = 0.012
CHIP_DEPTH_MIN = 12.0
CHIP_DEPTH_MAX = 30.0
# Seam border: symmetric darkened band SEAM_PX wide on every edge (wraps
# seamlessly: the band is identical on opposite edges, so repeats join
# into one continuous line of width 2*SEAM_PX ≈ 0.7 cm on the 0.6 m
# module -- fine but resolved at native 1280x720).
SEAM_PX = 3
SEAM_DEPTH = 26.0
# Derived normal map: height-from-luminance Sobel, same strength
# convention as the ceiling tile-face derived maps (strength 2.0).
NORMAL_STRENGTH = 2.0
# Derived roughness: vinyl semi-matte base with slight variation; seams
# read slightly rougher (grout-line convention, same operator family as
# the ceiling inverted-local-contrast roughness).
ROUGH_BASE = 0.52
ROUGH_GRAIN = 0.06


def _build_albedo(rng: np.random.Generator) -> np.ndarray:
    base = np.zeros((SIZE, SIZE, 3), np.float64)
    base[:, :] = np.array(BASE_RGB, np.float64)
    luma = rng.normal(0.0, LUMA_GRAIN_SIGMA, (SIZE, SIZE))
    chan = rng.normal(0.0, CHANNEL_GRAIN_SIGMA, (SIZE, SIZE, 3))
    albedo = base + luma[:, :, None] + chan
    chips = rng.random((SIZE, SIZE)) < CHIP_FRACTION
    depth = rng.uniform(CHIP_DEPTH_MIN, CHIP_DEPTH_MAX, (SIZE, SIZE))
    albedo[chips] -= depth[chips, None]
    # Seam border (all four edges, symmetric for wraparound continuity).
    edge = np.zeros((SIZE, SIZE), bool)
    edge[:SEAM_PX, :] = True
    edge[-SEAM_PX:, :] = True
    edge[:, :SEAM_PX] = True
    edge[:, -SEAM_PX:] = True
    albedo[edge] -= SEAM_DEPTH
    return np.clip(albedo, 0.0, 255.0)


def _sobel_normal(height: np.ndarray) -> np.ndarray:
    gx = np.zeros_like(height)
    gy = np.zeros_like(height)
    gx[:, 1:-1] = (height[:, 2:] - height[:, :-2]) * 0.5
    gy[1:-1, :] = (height[2:, :] - height[:-2, :]) * 0.5
    # Wraparound edges (the texture repeats, so derivatives wrap too).
    gx[:, 0] = (height[:, 1] - height[:, -1]) * 0.5
    gx[:, -1] = (height[:, 0] - height[:, -2]) * 0.5
    gy[0, :] = (height[1, :] - height[-1, :]) * 0.5
    gy[-1, :] = (height[0, :] - height[-2, :]) * 0.5
    nx = -gx * NORMAL_STRENGTH / 255.0
    ny = -gy * NORMAL_STRENGTH / 255.0
    nz = np.ones_like(height)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.stack((nx * inv, ny * inv, nz * inv), axis=-1)
    return np.clip(normal * 0.5 + 0.5, 0.0, 1.0) * 255.0


def main() -> None:
    rng = np.random.default_rng(SEED)
    albedo = _build_albedo(rng)
    here = os.path.dirname(os.path.abspath(__file__))
    Image.fromarray(albedo.astype(np.uint8), "RGB").save(
        os.path.join(here, "floor-vinyl-tile.png")
    )
    luminance = albedo.mean(axis=-1)
    Image.fromarray(_sobel_normal(luminance).astype(np.uint8), "RGB").save(
        os.path.join(here, "floor-vinyl-tile-derived-normal.png")
    )
    rough_rng = np.random.default_rng(SEED + 1)
    rough = np.full((SIZE, SIZE), ROUGH_BASE, np.float64)
    rough += rough_rng.normal(0.0, ROUGH_GRAIN, (SIZE, SIZE))
    edge = np.zeros((SIZE, SIZE), bool)
    edge[:SEAM_PX, :] = True
    edge[-SEAM_PX:, :] = True
    edge[:, :SEAM_PX] = True
    edge[:, -SEAM_PX:] = True
    rough[edge] += 0.12
    Image.fromarray(
        (np.clip(rough, 0.0, 1.0) * 255.0).astype(np.uint8), "L"
    ).save(os.path.join(here, "floor-vinyl-tile-derived-roughness.png"))
    flat = albedo[SEAM_PX:-SEAM_PX, SEAM_PX:-SEAM_PX]
    print(
        "floor-vinyl-tile: interior mean=(%.1f, %.1f, %.1f) std=(%.2f, %.2f, %.2f)"
        % (
            flat[:, :, 0].mean(), flat[:, :, 1].mean(), flat[:, :, 2].mean(),
            flat[:, :, 0].std(), flat[:, :, 1].std(), flat[:, :, 2].std(),
        )
    )


if __name__ == "__main__":
    main()
