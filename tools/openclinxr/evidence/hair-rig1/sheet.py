#!/usr/bin/env python3
"""Hair rig 1 look-sheet: rows TS | b9 base | best; cols 4 views + 2 crops."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
TARGET_NAMES = {"front": "target-front.png", "three_quarter": "target-three_quarter.png",
                "profile_90": "target-profile.png", "back": "target-back.png"}

COLUMNS = (("front", "front", None), ("three_quarter", "three_quarter", None),
           ("profile_90", "profile_90", None), ("back", "back", None),
           ("ear crop", "three_quarter", (100, 240, 484, 624)),
           ("back crop", "back", (320, 280, 704, 664)))
ROWS = (("TS", TARGET, True), ("b9 base", E / "base", False), ("best", E / "best", False))


def main():
    tile, label = 256, 28
    canvas = Image.new("RGB", (tile * len(COLUMNS), (tile + label) * len(ROWS)), "white")
    draw = ImageDraw.Draw(canvas)
    for ri, (row, root, is_target) in enumerate(ROWS):
        for ci, (title, view, crop) in enumerate(COLUMNS):
            source = root / TARGET_NAMES[view] if is_target else root / f"{view}.png"
            image = Image.open(source).convert("RGB")
            if crop:
                image = image.crop(crop)
            image = image.resize((tile, tile), Image.Resampling.LANCZOS)
            x, y = ci * tile, ri * (tile + label)
            canvas.paste(image, (x, y + label))
            draw.text((x + 7, y + 8), f"{row} | {title}", fill="black")
    canvas.save(E / "look-sheet.png")
    print("SHEET", str(E / "look-sheet.png"))


if __name__ == "__main__":
    main()
