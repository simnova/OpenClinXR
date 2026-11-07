#!/usr/bin/env python3
"""groom35 contact sheet (E driver; PIL only).

Rows 3q(+x) / 3q(-x flip) / profile(+x) / profile(-x flip) /
ear +x / ear -x flip; cols target | groom34 | step2 | step3
(-x rows: target cell dark, no -x target; ear rows: target dark).
Flip: horizontal (np.fliplr) so -x reads like +x.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
E34 = E.parent / "hair-groom34"
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
    R34, N34, C34 = (E34 / "renders-34mask20", E34 / "renders-34mask20neg",
                     E34 / "renders-34mask20ear")
    nneg = lambda d, v: flip(load(d / (v + ".png")))  # noqa: E731
    rows = []
    for v, nm in (("three_quarter", "3q"), ("profile_90", "profile")):
        rows.append((nm + " +x", [load(TGT[v]),
                                  load(R34 / (v + ".png")),
                                  load(E / ("renders-35step2/"
                                            + v + ".png")),
                                  load(E / ("renders-35step3/"
                                            + v + ".png"))]))
        rows.append((nm + " -x flip", [dark("no -x target"),
                                       nneg(N34, v),
                                       nneg(E / "renders-35step2neg", v),
                                       nneg(E / "renders-35step3neg", v)]))
    rows.append(("ear +x", [dark("n/a"), load(C34 / "front.png"),
                             load(E / "renders-35step2ear/front.png"),
                             load(E / "renders-35step3ear/front.png")]))
    rows.append(("ear -x flip", [dark("n/a"),
                                 flip(load(C34 / "three_quarter.png")),
                                 flip(load(E / "renders-35step2ear/"
                                            "three_quarter.png")),
                                 flip(load(E / "renders-35step3ear/"
                                            "three_quarter.png"))]))
    cols = ["target", "groom34", "step2", "step3"]
    H = len(rows) * W
    sheet = Image.new("RGB", (4 * W, H), (0, 0, 0))
    for i, (nm, ims) in enumerate(rows):
        for j, im in enumerate(ims):
            sheet.paste(label(im, "%s | %s" % (nm, cols[j])),
                        (j * W, i * W))
    out = E / "sheet.png"
    sheet.save(out)
    print("wrote", out, sheet.size)


if __name__ == "__main__":
    main()
