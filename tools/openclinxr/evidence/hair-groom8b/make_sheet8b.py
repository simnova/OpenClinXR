#!/usr/bin/env python3
"""hair-groom8b STEP 4: E/sheet.png (target | groom8a | groom8b) and
E/crops.png (same rows; cols 3q ear, profile ear, back crown/part,
back hem L/R, nape, front curtain L/R, top 3q). No gate refusal:
gates are reported honestly in RESULT/GATES_PASS instead.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
E8A = ROOT / "tools/openclinxr/evidence/hair-groom8a"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
VIEWS = ("front", "three_quarter", "profile_90", "back")
TGT = {"front": "target-front-a1.png",
       "three_quarter": "target-three_quarter-a1.png",
       "profile_90": "target-profile.png",
       "back": "target-back.png"}
T = 512
LABEL_W = 200
CROPS = {"three_quarter_ear": ("three_quarter", (380, 660, 330, 610)),
         "profile_ear": ("profile_90", (250, 530, 270, 550)),
         "back_crown_part": ("back", (412, 636, 140, 364)),
         "back_hem_left": ("back", (261, 337, 690, 830)),
         "back_hem_right": ("back", (690, 766, 690, 830)),
         "nape": ("back", (440, 585, 480, 640)),
         "front_curtain_L": ("front", (300, 420, 450, 650)),
         "front_curtain_R": ("front", (600, 720, 450, 650)),
         "top_3q": ("three_quarter", (300, 700, 80, 330))}


def main():
    rows = [("target", None), ("groom8a", E8A / "renders-studio"),
            ("groom8b", E / "renders-studio")]
    sheet = Image.new("RGB", (LABEL_W + 4 * T, 3 * T), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    for i, (label, src) in enumerate(rows):
        for j, v in enumerate(VIEWS):
            tim = Image.open(SCR / TGT[v]).convert("RGB").resize((T, T)) \
                if src is None else Image.open(
                    src / (v + ".png")).convert("RGB").resize((T, T))
            sheet.paste(tim, (LABEL_W + j * T, i * T))
        dr.text((18, i * T + T // 2 - 10), label, fill=(240, 240, 240))
    sheet.save(E / "sheet.png")

    cnames = list(CROPS.keys())
    cw = max(c[1][1] - c[1][0] for c in CROPS.values())
    ch = max(c[1][3] - c[1][2] for c in CROPS.values())
    crops = Image.new("RGB", (LABEL_W + len(cnames) * (cw + 8),
                              3 * (ch + 8) + 30), (18, 18, 18))
    dc = ImageDraw.Draw(crops)
    for j, cn in enumerate(cnames):
        v, (c0, c1, r0, r1) = CROPS[cn]
        dc.text((LABEL_W + j * (cw + 8) + 8, 5), cn, fill=(240, 240, 240))
        for i, (label, src) in enumerate(rows):
            im = Image.open(SCR / TGT[v]).convert("RGB") if src is None \
                else Image.open(src / (v + ".png")).convert("RGB")
            cell = Image.new("RGB", (cw, ch), (18, 18, 18))
            cell.paste(im.crop((c0, r0, c1, r1)), (0, 0))
            crops.paste(cell, (LABEL_W + j * (cw + 8), 30 + i * (ch + 8)))
        if j == 0:
            for i, (label, _) in enumerate(rows):
                dc.text((18, 30 + i * (ch + 8) + ch // 2 - 10), label,
                        fill=(240, 240, 240))
    crops.save(E / "crops.png")
    print("wrote sheet.png crops.png")


if __name__ == "__main__":
    main()
