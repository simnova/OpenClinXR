#!/usr/bin/env python3
"""hair-count2 look sheet (system python, PIL only).

Rows TS | base | n2 | tt0 ; cols front, back, back crop
(320,280,704,664), ear crop (three_quarter 100,240,484,624).
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
TS = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
TSNAMES = {"front": "target-front.png", "back": "target-back.png",
           "three_quarter": "target-three_quarter.png"}
BACK_CROP = (320, 280, 704, 664)
EAR_CROP = (100, 240, 484, 624)


def main():
    rows = (("TS", None), ("base", E / "base"), ("n2", E / "n2"), ("tt0", E / "tt0"))
    cols = (("front", "front", None), ("back", "back", None),
            ("back crop", "back", BACK_CROP), ("ear crop", "three_quarter", EAR_CROP))
    tile, label = 256, 28
    canvas = Image.new("RGB", (tile * len(cols), (tile + label) * len(rows)), "white")
    draw = ImageDraw.Draw(canvas)
    for ri, (name, root) in enumerate(rows):
        for ci, (title, view, crop) in enumerate(cols):
            if name == "TS":
                im = Image.open(TS / TSNAMES[view]).convert("RGB")
            else:
                im = Image.open(root / f"{view}.png").convert("RGB")
            if crop:
                im = im.crop(crop)
            im = im.resize((tile, tile), Image.Resampling.LANCZOS)
            x, y = ci * tile, ri * (tile + label)
            canvas.paste(im, (x, y + label))
            draw.text((x + 7, y + 8), f"{name} | {title}", fill="black")
    canvas.save(E / "look-sheet.png")
    print("WROTE", E / "look-sheet.png", canvas.size, flush=True)


if __name__ == "__main__":
    main()
