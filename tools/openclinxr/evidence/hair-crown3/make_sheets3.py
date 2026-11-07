#!/usr/bin/env python3
"""hair-crown3 STEP 3 sheets: crops-best.png + look-sheet.png (read-only art).

crops-best.png: rows = front crown crop, three_quarter crown crop;
  cols = crown2-best | best | target; NATIVE resolution (no scaling).
look-sheet.png: rows TS | crown2-best | best; cols front, three_quarter,
  front crown crop, back crown crop (thumbs + native crops).
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
C2 = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2/tools/openclinxr/evidence/hair-crown2")
T = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
FC = (80, 300, 360, 664)    # front crown crop (crown2)
TQC = (80, 380, 150, 650)   # three_quarter crown crop (edge overlay)
BC = (130, 340, 380, 648)   # back crown crop (crown2)
TH = 200


def thumb(path: Path, h: int = TH) -> Image.Image:
    im = Image.open(path).convert("RGB")
    return im.resize((int(im.width * h / im.height), h), Image.LANCZOS)


def crop(path: Path, box) -> Image.Image:
    r0, r1, c0, c1 = box
    return Image.open(path).convert("RGB").crop((c0, r0, c1, r1))


def label(im: Image.Image, text: str) -> Image.Image:
    d = ImageDraw.Draw(im)
    d.text((8, 8), text, fill=(255, 255, 0))
    return im


def grid(rows: list[list[Image.Image]], out: Path):
    # per-row widths (rows may mix native crop sizes); no black bars.
    y = 0
    row_h = [max(im.height for im in r) for r in rows]
    row_w = [sum(im.width for im in r) for r in rows]
    sheet = Image.new("RGB", (max(row_w), sum(row_h)), "black")
    for r, yy in zip(rows, [sum(row_h[:i]) for i in range(len(rows))]):
        x = 0
        for im in r:
            sheet.paste(im, (x, yy))
            x += im.width
    sheet.save(out)
    print("saved", out, sheet.size, flush=True)


def main():
    base = C2 / "scores" / "spread_s50"
    best = E / "best"
    # crops-best: native resolution
    grid([[label(crop(base / "front.png", FC), "base front crop"),
           label(crop(best / "front.png", FC), "best front crop"),
           label(crop(T / "target-front.png", FC), "TS front crop")],
          [label(crop(base / "three_quarter.png", TQC), "base tq crop"),
           label(crop(best / "three_quarter.png", TQC), "best tq crop"),
           label(crop(T / "target-three_quarter.png", TQC), "TS tq crop")]],
         E / "crops-best.png")
    # look-sheet
    ts = [label(thumb(T / "target-front.png"), "TS front"),
          label(thumb(T / "target-three_quarter.png"), "TS three_quarter"),
          label(crop(T / "target-front.png", FC), "TS crown crop front"),
          label(crop(T / "target-back.png", BC), "TS crown crop back")]
    rows = [ts]
    for tag, src in (("crown2-best", base), ("best", best)):
        rows.append(
            [label(thumb(src / "front.png"), f"{tag} front"),
             label(thumb(src / "three_quarter.png"), f"{tag} three_quarter"),
             label(crop(src / "front.png", FC), f"{tag} crown crop front"),
             label(crop(src / "back.png", BC), f"{tag} crown crop back")])
    grid(rows, E / "look-sheet.png")


if __name__ == "__main__":
    main()
