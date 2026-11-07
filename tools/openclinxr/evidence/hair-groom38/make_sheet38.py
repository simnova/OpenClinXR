#!/usr/bin/env python3
"""groom38 contact sheet (E driver; PIL only). Same layout as
make_sheet37: rows 3q(+x) / 3q(-x flip) / profile(+x) / profile(-x
flip) / ear +x / ear -x flip; cols target | groom36 | groom38
(-x rows: target cell dark; ear rows: target dark). Flip: np.fliplr.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
E36 = E.parent / "hair-groom36"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
TGT = {"three_quarter": SCR / "target-three_quarter-a1.png",
       "profile_90": SCR / "target-profile.png"}
W = 512


def load(p, w=W):
    im = Image.open(str(p)).convert("RGB")
    return im.resize((w, w))


def flip(im):
    return Image.fromarray(np.fliplr(np.asarray(im)))


def label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, im.width, 28], fill=(0, 0, 0))
    d.text((8, 6), text, fill=(255, 255, 0))
    return im


def dark(text):
    return label(Image.new("RGB", (W, W), (20, 20, 20)), text)


def main():
    nneg = lambda d, v: flip(load(d / (v + ".png")))  # noqa: E731
    rows = []
    for v, nm in (("three_quarter", "3q"), ("profile_90", "profile")):
        rows.append((nm + " +x", [load(TGT[v]),
                                  load(E36 / ("renders-36/" + v + ".png")),
                                  load(E / ("renders-38/" + v + ".png"))]))
        rows.append((nm + " -x flip", [dark("no -x target"),
                                       nneg(E36 / "renders-36neg", v),
                                       nneg(E / "renders-38neg", v)]))
    rows.append(("ear +x", [dark("n/a"),
                             load(E36 / "renders-36ear/front.png"),
                             load(E / "renders-38ear/front.png")]))
    rows.append(("ear -x flip", [dark("n/a"),
                                 flip(load(E36 / "renders-36ear/"
                                            "three_quarter.png")),
                                 flip(load(E / "renders-38ear/"
                                            "three_quarter.png"))]))
    cols = ["target", "36", "38"]
    H = len(rows) * W
    sheet = Image.new("RGB", (3 * W, H), (0, 0, 0))
    for i, (nm, ims) in enumerate(rows):
        for j, im in enumerate(ims):
            sheet.paste(label(im, "%s | %s" % (nm, cols[j])),
                        (j * W, i * W))
    out = E / "sheet.png"
    sheet.save(out)
    print("wrote", out, sheet.size)


if __name__ == "__main__":
    main()
