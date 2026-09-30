#!/usr/bin/env python3
"""Generate the deterministic centre-bright troffer diffuser texture."""

from pathlib import Path

import numpy as np
from PIL import Image

WIDTH = 256
HEIGHT = 128
EDGE_RGB = np.array([196.0, 196.0, 193.0])
CENTER_RGB = np.array([238.0, 238.0, 235.0])


def main() -> None:
    yy, xx = np.mgrid[0:HEIGHT, 0:WIDTH]
    nx = (xx - (WIDTH - 1) / 2) / ((WIDTH - 1) / 2)
    ny = (yy - (HEIGHT - 1) / 2) / ((HEIGHT - 1) / 2)
    radius = np.sqrt(nx * nx + ny * ny)
    falloff = np.clip(1.0 - radius, 0.0, 1.0) ** 0.7
    rgb = EDGE_RGB + falloff[..., None] * (CENTER_RGB - EDGE_RGB)
    # Fine deterministic diffusion mottling avoids a synthetic vector ramp;
    # amplitude is sub-clipping and does not invert the falloff.
    grain = 0.9 * np.sin(xx * 0.37 + yy * 0.19) + 0.6 * np.sin(xx * 0.11 - yy * 0.29)
    rgb = np.clip(rgb + grain[..., None], 0, 254).astype(np.uint8)
    output = Path(__file__).with_name("troffer-diffuser-gradient.png")
    Image.fromarray(rgb, "RGB").save(output, optimize=True)
    print(output)


if __name__ == "__main__":
    main()
