#!/usr/bin/env python3
"""Make the requested TS | h5 | best registered comparison sheet."""
from pathlib import Path

from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
L3 = E.parent / "hair-look3"
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
TARGET_NAMES = {
    "front": "target-front.png",
    "three_quarter": "target-three_quarter.png",
    "profile_90": "target-profile.png",
    "back": "target-back.png",
}
EAR_BOX = (100, 240, 484, 624)
BACK_BOX = (320, 280, 704, 664)


def source(row, view):
    if row == "TS":
        return TARGET / TARGET_NAMES[view]
    if row == "h5":
        return L3 / "cells/best" / f"{view}.png"
    return E / "cells/best" / f"{view}.png"


columns = (
    ("front", "front", None),
    ("three_quarter", "three_quarter", None),
    ("profile_90", "profile_90", None),
    ("back", "back", None),
    ("ear crop", "three_quarter", EAR_BOX),
    ("back crop", "back", BACK_BOX),
)
rows = ("TS", "h5", "best")
tile, label_height = 384, 32
canvas = Image.new("RGB", (tile * len(columns), len(rows) * (tile + label_height)), "white")
draw = ImageDraw.Draw(canvas)
for row_index, row in enumerate(rows):
    for column_index, (label, view, crop) in enumerate(columns):
        image = Image.open(source(row, view)).convert("RGB")
        if crop is not None:
            image = image.crop(crop)
        image = image.resize((tile, tile), Image.Resampling.LANCZOS)
        x = column_index * tile
        y = row_index * (tile + label_height)
        canvas.paste(image, (x, y + label_height))
        draw.text((x + 6, y + 8), f"{row} | {label}", fill="black")
canvas.save(E / "look-sheet.png")
print("SHEET_DONE", E / "look-sheet.png")
