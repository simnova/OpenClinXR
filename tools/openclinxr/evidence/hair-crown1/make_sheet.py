#!/usr/bin/env python3
"""hair-crown1 look-sheet: rows TS | base | best(=base); cols front, back,
crown crop front, crown crop back, crown_top. TS crown_top cell is blank
(no target crown photo in set-back)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
T = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
FC = (80, 300, 360, 664)
BC = (130, 340, 380, 648)
TH = 200  # thumb height for full views


def thumb(path: Path, h: int = TH) -> Image.Image:
    im = Image.open(path).convert("RGB")
    return im.resize((int(im.width * h / im.height), h), Image.LANCZOS)


def crop2(path: Path, box, scale: int = 1) -> Image.Image:
    r0, r1, c0, c1 = box
    im = Image.open(path).convert("RGB").crop((c0, r0, c1, r1))
    if scale != 1:
        im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    return im


def label(im: Image.Image, text: str) -> Image.Image:
    d = ImageDraw.Draw(im)
    d.text((8, 8), text, fill=(255, 255, 0))
    return im


def main():
    cols = ["front", "back", "crown crop front", "crown crop back", "crown_top"]
    rows = []
    # TS row
    ts = [label(thumb(T / "target-front.png"), "TS front"),
          label(thumb(T / "target-back.png"), "TS back"),
          label(crop2(T / "target-front.png", FC), "TS crown crop front"),
          label(crop2(T / "target-back.png", BC), "TS crown crop back"),
          label(Image.new("RGB", thumb(E / "base/crown_top.png").size, (20, 20, 20)),
                "TS crown_top: no target")]
    rows.append(ts)
    for tag, src in (("base", E / "base"), ("best(=base)", E / "best")):
        r0 = [label(thumb(src / "front.png"), f"{tag} front"),
              label(thumb(src / "back.png"), f"{tag} back"),
              label(crop2(src / "front.png", FC), f"{tag} crown crop front"),
              label(crop2(src / "back.png", BC), f"{tag} crown crop back"),
              label(thumb(src / "crown_top.png"), f"{tag} crown_top")]
        rows.append(r0)
    widths = [max(r[c].width for r in rows) for c in range(5)]
    heights = [max(im.height for im in r) for r in rows]
    sheet = Image.new("RGB", (sum(widths), sum(heights)), "black")
    y = 0
    for r in rows:
        x = 0
        for c, im in enumerate(r):
            sheet.paste(im, (x, y))
            x += widths[c]
        y += heights[rows.index(r)]
    sheet.save(E / "look-sheet.png")
    print("saved", sheet.size)


if __name__ == "__main__":
    main()
