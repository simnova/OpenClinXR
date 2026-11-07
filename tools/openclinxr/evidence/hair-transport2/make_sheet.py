#!/usr/bin/env python3
"""STEP 3 (hair-transport2): look-sheet.png rows TS | current | best, cols
front, three_quarter, profile_90, back, back-crop(320,280,704,664).
Current renders reused from the scored geo7 baseline (same scorer/material);
best = r1 renders from this slice."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
GEO7 = ROOT / "tools/openclinxr/evidence/hair-geo7"
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
BEST = "r1"
CROP = (320, 280, 704, 664)
TS_NAMES = {"front": "target-front.png", "three_quarter": "target-three_quarter.png",
            "profile_90": "target-profile.png", "back": "target-back.png"}


def src(row: str, view: str) -> Path:
    if row == "TS":
        return TARGET / TS_NAMES[view]
    if row == "current":
        return GEO7 / "cells" / "current" / "score" / f"{view}.png"
    return HERE / "cells" / BEST / "score" / f"{view}.png"


def main() -> None:
    rows = ["TS", "current", f"best({BEST})"]
    cols = ["front", "three_quarter", "profile_90", "back", "back crop"]
    tile, label = 256, 28
    canvas = Image.new("RGB", (tile * len(cols), (tile + label) * len(rows)), "white")
    draw = ImageDraw.Draw(canvas)
    for ri, row in enumerate(rows):
        for ci, title in enumerate(cols):
            view = "back" if title == "back crop" else title
            image = Image.open(src(row, view)).convert("RGB")
            if title == "back crop":
                image = image.crop(CROP)
            image = image.resize((tile, tile), Image.Resampling.LANCZOS)
            x, y = ci * tile, ri * (tile + label)
            canvas.paste(image, (x, y + label))
            draw.text((x + 7, y + 8), f"{row} | {title}", fill="black")
    canvas.save(HERE / "look-sheet.png")
    print("WROTE", HERE / "look-sheet.png", flush=True)


if __name__ == "__main__":
    main()
