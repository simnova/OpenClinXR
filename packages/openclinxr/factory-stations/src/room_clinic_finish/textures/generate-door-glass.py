#!/usr/bin/env python3
"""Generate the deterministic ward vision-lite reflection texture."""

from pathlib import Path
import math

from PIL import Image


OUT = Path(__file__).with_name("door-glass-reflection.png")
WIDTH, HEIGHT = 256, 512


def clamp(value: float) -> int:
    return max(0, min(255, round(value)))


pixels = []
for y in range(HEIGHT):
    for x in range(WIDTH):
        # Cool corridor-light field with two broad reflected mullions and a
        # soft diagonal highlight.  No random state: identical source bytes
        # on every producer run.
        wave = 6.0 * math.sin(x * 0.075) + 4.0 * math.sin(y * 0.039 + x * 0.018)
        mullion = -18.0 if 0.18 < x / WIDTH < 0.25 or 0.72 < x / WIDTH < 0.78 else 0.0
        diagonal = 18.0 * math.exp(-((x / WIDTH - (0.22 + 0.38 * y / HEIGHT)) / 0.10) ** 2)
        vignette = -10.0 * ((2.0 * x / WIDTH - 1.0) ** 2)
        value = wave + mullion + diagonal + vignette
        pixels.append((clamp(194 + value), clamp(205 + value), clamp(203 + value)))

image = Image.new("RGB", (WIDTH, HEIGHT))
image.putdata(pixels)
image.save(OUT, optimize=True)
print(OUT)
