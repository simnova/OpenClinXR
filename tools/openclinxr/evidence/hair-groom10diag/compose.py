#!/usr/bin/env python3
"""Compose labelled A/B/C diagnostic crops and the stage-colour legend."""
from pathlib import Path

from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
R = E / "renders"
DEFECTS = ("back-knot", "behind-ear-loops", "sideburn-tuft", "hairline-band")
COLORS = [
    ("<5 mm", (31, 82, 204)), ("sweep", (26, 191, 242)),
    ("offset", (26, 217, 140)), ("depth", (140, 230, 26)),
    ("coarse", (255, 179, 13)), ("fine", (255, 89, 13)),
    ("length", (230, 26, 140)), ("hairline", (179, 38, 242)),
    ("ear", (51, 255, 51)), ("SDF", (255, 13, 13)),
    ("clamp/reproj", (140, 13, 13)),
]


def main():
    for name in DEFECTS:
        ims = [Image.open(R / f"{name}-{p}.png").convert("RGB")
               for p in "abc"]
        h = max(i.height for i in ims)
        w = sum(i.width for i in ims)
        top, bottom = 34, 54
        dst = Image.new("RGB", (w, top + h + bottom), (12, 12, 16))
        dr = ImageDraw.Draw(dst)
        x = 0
        labels = ("A  GUIDES ONLY", "B  RAW INTERPOLATION", "C  FINAL / >5mm BY STAGE")
        for im, label in zip(ims, labels):
            dst.paste(im, (x, top))
            dr.text((x + 8, 10), label, fill=(245, 245, 245))
            x += im.width
        x, y = 8, top + h + 8
        for label, color in COLORS:
            tw = 18 + 7 * len(label) + 10
            if x + tw >= w:
                x = 8
                y += 20
            dr.rectangle((x, y, x + 12, y + 12), fill=color)
            dr.text((x + 16, y), label, fill=(220, 220, 225))
            x += tw
        dst.save(E / f"defect-{name}-abc.png")
        print("wrote", E / f"defect-{name}-abc.png")


if __name__ == "__main__":
    main()
