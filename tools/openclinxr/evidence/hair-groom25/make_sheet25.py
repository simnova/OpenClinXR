#!/usr/bin/env python3
"""hair-groom25 sheet.png + crops.png (target | groom19 | groom24 | groom25).

groom25 = opt 25b (anchor 0.6), renders-25b. crops.png rows: back-knot box
at NATIVE resolution (rows 150-420, cols 512-765 of the 1024 back frame,
groom10diag box) first, then the regional boxes (height-normalised to TH).
"""
from pathlib import Path
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
G19 = E.parent / "hair-groom19" / "renders-studio"
G24 = E.parent / "hair-groom24" / "renders-24"
G25 = E / "renders-25b"
TGT = {"front": "target-front-a1.png", "three_quarter": "target-three_quarter-a1.png",
       "profile_90": "target-profile.png", "back": "target-back.png"}
VIEWS = ["front", "three_quarter", "profile_90", "back"]
ROWS = [("target", None), ("groom19", G19), ("groom24", G24), ("groom25=25b", G25)]
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
dr.text((14, 8), "hair-groom25 sheet (groom25 = anchor-0.6 25b)", fill=(240, 240, 240))
sheet.save(E / "sheet.png")
print("sheet", sheet.size)

KNOT = ("back-knot-NATIVE", "back", (512, 150, 765, 420))
CROPS = [
    ("3q-ear", "three_quarter", (540, 340, 780, 560)),
    ("profile-ear", "profile_90", (400, 360, 600, 560)),
    ("back-crown-part", "back", (380, 60, 644, 330)),
    ("back-hem-L", "back", (300, 700, 512, 950)),
    ("back-hem-R", "back", (512, 700, 724, 950)),
    ("nape", "back", (400, 480, 624, 700)),
    ("front-curtain-L", "front", (270, 240, 430, 620)),
    ("front-curtain-R", "front", (594, 240, 754, 620)),
    ("front-hairline-band", "front", (291, 98, 733, 196)),
]
TH = 220


def load(label_src, v):
    label, src = label_src
    p = SCR / TGT[v] if src is None else src / (v + ".png")
    return Image.open(p).convert("RGB")


kn_name, kn_v, (kl, kt, kr, kb) = KNOT
knrow = [load(rs, kn_v).crop((kl, kt, kr, kb)) for rs in ROWS]
kh = knrow[0].size[1]
tiles = [(kn_name + " (native %dx%d)" % knrow[0].size, knrow, kh)]
for name, v, box in CROPS:
    row = []
    for rs in ROWS:
        im = load(rs, v).crop(box)
        w, h = im.size
        im = im.resize((int(w * TH / h), TH))
        row.append(im)
    tiles.append((name, row, TH))

total_h = sum(h for _, _, h in tiles)
max_w = max(sum(im.size[0] for im in row) for _, row, _ in tiles)
crops = Image.new("RGB", (LW + max_w, total_h), (16, 16, 16))
dr = ImageDraw.Draw(crops)
y = 0
for name, row, h in tiles:
    x = LW
    for im in row:
        crops.paste(im, (x, y))
        x += im.size[0]
    dr.text((8, y + h // 2 - 10), name.split(" (")[0], fill=(240, 240, 240))
    y += h
crops.save(E / "crops.png")
print("crops", crops.size)
