#!/usr/bin/env python3
"""Quick native-1024 crop check: rows target|groom5|groom6."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
E6 = ROOT / "tools/openclinxr/evidence/hair-groom6"
E5 = ROOT / "tools/openclinxr/evidence/hair-groom5"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
TGT = {"front": "target-front-a1.png",
       "three_quarter": "target-three_quarter-a1.png",
       "profile_90": "target-profile.png", "back": "target-back.png"}
CROPS = {"q_ear": ("three_quarter", (380, 660, 330, 610)),
         "p_ear": ("profile_90", (250, 530, 270, 550)),
         "crown": ("back", (412, 636, 140, 364)),
         "hemL": ("back", (261, 337, 690, 830)),
         "hemR": ("back", (690, 766, 690, 830)),
         "nape": ("back", (440, 585, 480, 640))}
ROWS = [("target", None), ("groom5", E5 / "renders-studio"),
        ("groom6", E6 / "renders-studio")]
cnames = list(CROPS.keys())
cw = max(c[1][1] - c[1][0] for c in CROPS.values())
ch = max(c[1][3] - c[1][2] for c in CROPS.values())
LW = 120
img = Image.new("RGB", (LW + len(cnames) * (cw + 8), 3 * (ch + 8) + 30),
                (18, 18, 18))
dc = ImageDraw.Draw(img)
for j, cn in enumerate(cnames):
    v, (c0, c1, r0, r1) = CROPS[cn]
    dc.text((LW + j * (cw + 8) + 8, 5), cn, fill=(240, 240, 240))
    for i, (label, src) in enumerate(ROWS):
        im = Image.open(SCR / TGT[v]).convert("RGB") if src is None \
            else Image.open(src / (v + ".png")).convert("RGB")
        cell = Image.new("RGB", (cw, ch), (18, 18, 18))
        cell.paste(im.crop((c0, r0, c1, r1)), (0, 0))
        img.paste(cell, (LW + j * (cw + 8), 30 + i * (ch + 8)))
    if j == 0:
        for i, (label, _) in enumerate(ROWS):
            dc.text((18, 30 + i * (ch + 8) + ch // 2 - 10), label,
                    fill=(240, 240, 240))
img.save(E6 / "crops-check.png")
print("wrote crops-check.png")
