#!/usr/bin/env python3
"""hair-groom4 STEP 4a: sheet + native crops.

E/sheet.png rows target | groom3 | groom4, cols front/3q/profile/back.
E/crops.png rows target | groom3 | groom4, cols 3q-ear / profile-ear /
back-crown / back-hem / front-curtain (native 1024 crops, no resize).
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

E4 = Path(__file__).resolve().parent
ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
E3 = ROOT / "tools/openclinxr/evidence/hair-groom3"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
VIEWS = ("front", "three_quarter", "profile_90", "back")
TGT = {"front": "target-front-a1.png",
       "three_quarter": "target-three_quarter-a1.png",
       "profile_90": "target-profile.png",
       "back": "target-back.png"}
T = 512
LABEL_W = 200
CROPS = {"three_quarter_ear": ("three_quarter", 380, 660, 330, 610),
         "profile_ear": ("profile_90", 250, 530, 270, 550),
         "back_crown": ("back", 412, 636, 140, 364),
         "back_hem": ("back", 362, 686, 688, 950),
         "front_curtain": ("front", 180, 460, 450, 730)}


def main():
    opened = [str(Path(__file__).resolve())]
    rows = [("aisha-v3 target", None),
            ("groom3 studio", E3 / "renders-studio"),
            ("cfgG before", E4 / "cfgG" / "renders1024"),
            ("groom4 tuck", E4 / "renders-studio")]
    sheet = Image.new("RGB", (LABEL_W + 4 * T, 4 * T), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    for i, (label, src) in enumerate(rows):
        for j, v in enumerate(VIEWS):
            p = (SCR / TGT[v]) if src is None else (src / (v + ".png"))
            opened.append(str(p))
            tim = Image.open(p).convert("RGB")
            assert tim.size == (1024, 1024), (v, tim.size)
            sheet.paste(tim.resize((T, T)), (LABEL_W + j * T, i * T))
        dr.text((18, i * T + T // 2 - 10), label, fill=(240, 240, 240))
    sheet.save(E4 / "sheet.png")
    opened.append(str(E4 / "sheet.png"))

    cols = list(CROPS)
    cw = max(c1 - c0 for _, c0, c1, _, _ in CROPS.values())
    ch = max(r1 - r0 for _, _, _, r0, r1 in CROPS.values())
    crops = Image.new("RGB", (LABEL_W + len(cols) * cw, 4 * ch),
                      (18, 18, 18))
    dr = ImageDraw.Draw(crops)
    clabel = {"three_quarter_ear": "3q ear [380:660, 330:610]",
              "profile_ear": "profile ear [250:530, 270:550]",
              "back_crown": "back crown [412:636, 140:364]",
              "back_hem": "back hem [362:686, 688:950]",
              "front_curtain": "front curtain [180:460, 450:730]"}
    for i, (label, src) in enumerate(rows):
        for j, cn in enumerate(cols):
            v, c0, c1, r0, r1 = CROPS[cn]
            p = (SCR / TGT[v]) if src is None else (src / (v + ".png"))
            opened.append(str(p))
            tim = Image.open(p).convert("RGB")
            cell = Image.new("RGB", (cw, ch), (18, 18, 18))
            cell.paste(tim.crop((c0, r0, c1, r1)), (0, 0))
            crops.paste(cell, (LABEL_W + j * cw, i * ch))
            if i == 0:
                dr.text((LABEL_W + j * cw + 8, 8), clabel[cn],
                        fill=(240, 240, 240))
        dr.text((18, i * ch + ch // 2 - 10), label, fill=(240, 240, 240))
    crops.save(E4 / "crops.png")
    opened.append(str(E4 / "crops.png"))
    prev = []
    if (E4 / "inputs-opened.txt").exists():
        prev = [ln.strip() for ln in
                (E4 / "inputs-opened.txt").read_text().splitlines()
                if ln.strip()]
    (E4 / "inputs-opened.txt").write_text(
        "\n".join(sorted(set(prev) | set(opened))) + "\n")
    print("wrote sheet.png + crops.png")


if __name__ == "__main__":
    main()
