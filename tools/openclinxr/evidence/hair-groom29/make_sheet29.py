#!/usr/bin/env python3
"""hair-groom29 sheet.png + crops.png (target | groom19 | groom26 | groom29).

groom29 = re-draped -x back curtain (s14) + s11 anchor-0.6 hem-keep-200
+ pool60 + temple-taper-0.5 + lobe-drop-65, renders-29. Native rows:
back-knot box (rows 150-420, cols 512-765), 3q-ear, profile-ear, 3q
temple-hairline band (rows 106-214 = top 3-20% of the 3q target mask
bbox); the rest height-normalised to TH. Lobe rows: under-lobe pixel
boxes from E/earlobe29-gate.json (camera-side xpos), shown with a margin.
"""
from pathlib import Path
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
G19 = E.parent / "hair-groom19" / "renders-studio"
G26 = E.parent / "hair-groom26" / "renders-26"
G29 = E / "renders-29"
TGT = {"front": "target-front-a1.png", "three_quarter": "target-three_quarter-a1.png",
       "profile_90": "target-profile.png", "back": "target-back.png"}
VIEWS = ["front", "three_quarter", "profile_90", "back"]
ROWS = [("target", None), ("groom19", G19), ("groom26", G26), ("groom29", G29)]
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
dr.text((14, 8), "hair-groom29 sheet (redrape+keep200+taper+lobedrop)", fill=(240, 240, 240))
sheet.save(E / "sheet.png")
print("sheet", sheet.size)

NATIVE = [
    ("back-knot-NATIVE", "back", (512, 150, 765, 420)),
    ("3q-ear-NATIVE", "three_quarter", (540, 340, 780, 560)),
    ("profile-ear-NATIVE", "profile_90", (400, 360, 600, 560)),
    ("3q-temple-hairline-NATIVE", "three_quarter", (240, 106, 769, 214)),
]
CROPS = [
    ("back-crown-part", "back", (380, 60, 644, 330)),
    ("back-hem-L", "back", (300, 700, 512, 950)),
    ("back-hem-R", "back", (512, 700, 724, 950)),
    ("nape", "back", (400, 480, 624, 700)),
    ("front-hairline-band", "front", (291, 98, 733, 196)),
    ("lobe-3q-xpos", "three_quarter", (478 - 60, 439 - 60, 553 + 60, 501 + 60)),
    ("lobe-profile-xpos", "profile_90", (306 - 60, 438 - 60, 408 + 60, 495 + 60)),
]
TH = 220


def load(label_src, v):
    label, src = label_src
    p = SCR / TGT[v] if src is None else src / (v + ".png")
    return Image.open(p).convert("RGB")


tiles = []
for kn_name, kn_v, (kl, kt, kr, kb) in NATIVE:
    knrow = [load(rs, kn_v).crop((kl, kt, kr, kb)) for rs in ROWS]
    kh = knrow[0].size[1]
    tiles.append((kn_name + " (native %dx%d)" % knrow[0].size, knrow, kh))
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
