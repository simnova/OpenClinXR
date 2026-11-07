#!/usr/bin/env python3
"""groom37 ears.png: native 1:1 ear close-ups, groom36 vs groom37.

Rows ear +x | ear -x (flipped to read like +x); cols groom36 |
groom37 (+ dark target cell to mirror the sheet's 3-col layout).
640x640 center crop at 1:1 (cameras center the ear by construction).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
E36 = E.parent / "hair-groom36"


def main():
    e6 = E36 / "renders-36ear"
    e7 = E / "renders-37ear"
    rows = []
    for view, nm in (("front", "ear +x"),
                     ("three_quarter", "ear -x flip")):
        cells = [Image.open(str(d / (view + ".png"))).convert("RGB")
                 for d in (e6, e7)]
        if nm.endswith("flip"):
            cells = [Image.fromarray(np.fliplr(np.asarray(im)))
                     for im in cells]
        w, h = cells[0].size
        S = 640
        box = ((w - S) // 2, (h - S) // 2, (w + S) // 2, (h + S) // 2)
        rows.append((nm, [im.crop(box) for im in cells]))
    cw, ch = rows[0][1][0].size
    tgt = Image.new("RGB", (cw, ch), (20, 20, 20))
    W = cw * 3
    H = sum(r[1][0].size[1] for r in rows)
    sheet = Image.new("RGB", (W, H), (0, 0, 0))
    y = 0
    tags = ["target(n/a)", "groom36", "groom37"]
    for nm, cells in rows:
        for x, (im, tag) in enumerate(zip([tgt] + cells, tags)):
            c = im.copy()
            d = ImageDraw.Draw(c)
            d.rectangle([0, 0, c.width, 28], fill=(0, 0, 0))
            d.text((8, 6), "%s | %s" % (nm, tag), fill=(255, 255, 0))
            sheet.paste(c, (x * cw, y))
        y += ch
    out = E / "ears.png"
    sheet.save(out)
    print("wrote", out, sheet.size)


if __name__ == "__main__":
    main()
