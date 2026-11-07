#!/usr/bin/env python3
"""hair-crown4 STEP 1: overlay root points on cap-green renders -> E/diagnose.png.

Red dots = strand roots (every 12th, in-Blender projection). Green = exposed
cap (first-surface scalp with no hair over it). Read before naming a cause.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
SIZE = 1024


def main():
    raw = E / "diag_raw"
    uv = json.loads((raw / "diag_root_uv.json").read_text())
    panels = []
    for view in ("front", "three_quarter"):
        im = Image.open(raw / f"diag_{view}.png").convert("RGB")
        a = np.asarray(im, dtype=float) / 255.0
        green = (a[..., 1] > 0.5) & (a[..., 0] < 0.3) & (a[..., 2] < 0.3)
        dr = ImageDraw.Draw(im)
        for _, x, y, _z in uv[view]["uvs"]:
            if 0 <= x < SIZE and 0 <= y < SIZE:
                dr.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(255, 0, 0))
        dr.text((8, 8), f"{view}: GREEN=exposed cap RED=roots(n={len(uv[view]['uvs'])})",
                fill=(255, 255, 0))
        dr.text((8, 24), f"green px={int(green.sum())}", fill=(255, 255, 0))
        panels.append(im)
    sheet = Image.new("RGB", (SIZE * 2, SIZE), "black")
    sheet.paste(panels[0], (0, 0))
    sheet.paste(panels[1], (SIZE, 0))
    sheet.save(E / "diagnose.png")
    print("saved diagnose.png", sheet.size, flush=True)


if __name__ == "__main__":
    main()
