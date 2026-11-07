"""groom34 ears.png: native 1:1 crops of both ear close-ups, groom33 vs mask20-best.
Crop = tight hair-pixel bbox (alpha>=230 in -id) +64px margin, unified per row;
no resizing (1:1). Rows: ear +x | ear -x(flipped to read like +x). Cols: groom33 | mask20."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
A = 230
M = 64


def hair_mask(idp):
    return np.array(Image.open(str(idp)).convert("RGBA"))[:, :, 3] >= A


def cropbox(m, w, h):
    ys, xs = np.nonzero(m)
    x0, x1 = max(0, xs.min() - M), min(w, xs.max() + M)
    y0, y1 = max(0, ys.min() - M), min(h, ys.max() + M)
    return x0, y0, x1, y1


def main():
    e33, e34 = E / "renders-33ear", E / "renders-34mask20ear"
    rows = []
    for view, nm in (("front", "ear +x"), ("three_quarter", "ear -x flip")):
        cells = []
        for d in (e33, e34):
            im = Image.open(str(d / (view + ".png"))).convert("RGB")
            if nm.endswith("flip"):
                im = Image.fromarray(np.fliplr(np.asarray(im)))
            cells.append(im)
        # FIXED anatomical window: look-at cameras center the ear centroid
        # in frame by construction; 640x640 center crop at 1:1 (no resize).
        w, h = cells[0].size
        S = 640
        box = ((w - S) // 2, (h - S) // 2, (w + S) // 2, (h + S) // 2)
        print(nm, "fixed center crop", box)
        rows.append((nm, [im.crop(box) for im in cells]))
    cw, ch = rows[0][1][0].size
    assert all(c.size == (cw, ch) for _, r in rows for c in r), "unify per row only"
    W = cw * 2
    H = sum(r[1][0].size[1] for r in rows)
    sheet = Image.new("RGB", (W, H), (0, 0, 0))
    y = 0
    for nm, (a, b) in rows:
        for x, im, tag in ((0, a, "groom33"), (cw, b, "mask20")):
            d = ImageDraw.Draw(im)
            d.rectangle([0, 0, im.width, 28], fill=(0, 0, 0))
            d.text((8, 6), "%s | %s 1:1" % (nm, tag), fill=(255, 255, 0))
            sheet.paste(im, (x, y))
        y += a.size[1]
    out = E / "ears.png"
    sheet.save(out)
    print("wrote", out, sheet.size)


if __name__ == "__main__":
    main()
