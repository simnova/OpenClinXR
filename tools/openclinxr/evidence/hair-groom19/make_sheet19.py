#!/usr/bin/env python3
"""hair-groom19 sheet.png + crops.png (target | groom8a | groom8b | groom19)."""
from pathlib import Path
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
G8 = E.parent / "hair-groom8a" / "renders-studio"
G8B = E.parent / "hair-groom8b" / "renders-studio"
G19 = E / "renders-studio"
TGT = {"front": "target-front-a1.png", "three_quarter": "target-three_quarter-a1.png",
       "profile_90": "target-profile.png", "back": "target-back.png"}
VIEWS = ["front", "three_quarter", "profile_90", "back"]
ROWS = [("target", None), ("groom8a", G8), ("groom8b", G8B), ("groom19", G19)]
T = 512
LW = 170

sheet = Image.new("RGB", (LW + 4 * T, len(ROWS) * T), (16, 16, 16))
dr = ImageDraw.Draw(sheet)
for i, (label, src) in enumerate(ROWS):
    for j, v in enumerate(VIEWS):
        p = SCR / TGT[v] if src is None else src / (v + ".png")
        im = Image.open(p).convert("RGB").resize((T, T))
        sheet.paste(im, (LW + j * T, i * T))
    dr.text((14, i * T + T // 2 - 10), label, fill=(240, 240, 240))
dr.text((14, 8), "hair-groom19 sheet", fill=(240, 240, 240))
sheet.save(E / "sheet.png")
print("sheet", sheet.size)

# crops: (name, view, box[l,t,r,b] in 1024 space)
CROPS = [
    ("3q-ear", "three_quarter", (540, 340, 780, 560)),
    ("profile-ear", "profile_90", (400, 360, 600, 560)),
    ("back-crown-part", "back", (380, 60, 644, 330)),
    ("back-hem-L", "back", (300, 700, 512, 950)),
    ("back-hem-R", "back", (512, 700, 724, 950)),
    ("nape", "back", (400, 480, 624, 700)),
    ("front-curtain-L", "front", (270, 240, 430, 620)),
    ("front-curtain-R", "front", (594, 240, 754, 620)),
    ("top-3q", "three_quarter", (350, 60, 674, 330)),
    ("front-hairline-band", "front", (291, 98, 733, 196)),
]
TH = 220
tiles = []
for name, v, box in CROPS:
    row = []
    for label, src in ROWS:
        p = SCR / TGT[v] if src is None else src / (v + ".png")
        im = Image.open(p).convert("RGB").crop(box)
        w, h = im.size
        im = im.resize((int(w * TH / h), TH))
        row.append(im)
    tiles.append((name, row))
crops = Image.new("RGB", (LW + max(sum(im.size[0] for im in row)
                                    for _, row in tiles), len(tiles) * TH),
                  (16, 16, 16))
dr = ImageDraw.Draw(crops)
for i, (name, row) in enumerate(tiles):
    x = LW
    for im in row:
        crops.paste(im, (x, i * TH))
        x += im.size[0]
    dr.text((8, i * TH + TH // 2 - 10), name, fill=(240, 240, 240))
crops.save(E / "crops.png")
print("crops", crops.size)
for name, v, box in CROPS:
    print("crop", name, v, box)
