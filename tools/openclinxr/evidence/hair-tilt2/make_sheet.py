#!/usr/bin/env python3
"""hair-tilt2 look sheet: rows TS | current(a1+look7) | tilt1-t4 | best(w7i);
cols front, three_quarter, profile_90, back, back crop (320,280,704,664),
ear crop (three_quarter 100,240,484,624). System python (PIL only)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
T1 = ROOT / "tools/openclinxr/evidence/hair-tilt1"
TS = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
TS_NAMES = {"front": "target-front.png", "three_quarter": "target-three_quarter.png",
            "profile_90": "target-profile.png", "back": "target-back.png"}
ROWS = (("TS", None),
        ("current", T1 / "scores/a1-look7"),
        ("tilt1-t4", T1 / "scores/t4-look7"),
        ("best-w7i", E / "scores/w7i"))
COLS = ("front", "three_quarter", "profile_90", "back",
        "back-crop", "ear-crop")

TILE, LABEL = 256, 28
canvas = Image.new("RGB", (TILE * len(COLS), (TILE + LABEL) * len(ROWS)), "white")
draw = ImageDraw.Draw(canvas)
for ri, (name, src) in enumerate(ROWS):
    for ci, col in enumerate(COLS):
        x, y = ci * TILE, ri * (TILE + LABEL)
        draw.text((x + 7, y + 8), f"{name} | {col}", fill="black")
        if col == "back-crop":
            view, crop = "back", (320, 280, 704, 664)
        elif col == "ear-crop":
            view, crop = "three_quarter", (100, 240, 484, 624)
        else:
            view, crop = col, None
        if name == "TS":
            im = Image.open(TS / TS_NAMES[view]).convert("RGB")
        else:
            im = Image.open(src / f"{view}.png").convert("RGB")
        if crop:
            im = im.crop(crop)
        im = im.resize((TILE, TILE), Image.Resampling.LANCZOS)
        canvas.paste(im, (x, y + LABEL))
canvas.save(E / "look-sheet.png")
print("WROTE", E / "look-sheet.png", canvas.size, flush=True)
