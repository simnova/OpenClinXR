"""groom34 sweep sheet (E driver; PIL only). Rows 3q(+x)/3q(-x flip)/profile(+x)/
profile(-x flip)/ear +x/ear -x flip; cols target | groom33 | mask20 BEST-SWEEP
(labeled NOT groom34 - no R passed; verdict FAIL). Flip: np.fliplr."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
E33 = E.parent / "hair-groom33"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
TGT = {"three_quarter": SCR / "target-three_quarter-a1.png",
       "profile_90": SCR / "target-profile.png"}
R33 = E33 / "renders-33"


def load(p, w=512):
    im = Image.open(str(p)).convert("RGB")
    return im.resize((w, w))


def flip(im):
    return Image.fromarray(np.fliplr(np.asarray(im)))


def label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, im.width, 28], fill=(0, 0, 0))
    d.text((8, 6), text, fill=(255, 255, 0))
    return im


def dark(w, text):
    im = Image.new("RGB", (w, w), (20, 20, 20))
    return label(im, text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cand", default="renders-34mask20")
    ap.add_argument("--candneg", default="renders-34mask20neg")
    ap.add_argument("--candear", default="renders-34mask20ear")
    a = ap.parse_args()
    W = 512
    neg33 = E / "renders-33neg"
    ear33 = E / "renders-33ear"
    C, CN, CE = E / a.cand, E / a.candneg, E / a.candear
    third = "mask20 BEST (NOT groom34)"
    rows = []
    for v, nm in (("three_quarter", "3q"), ("profile_90", "profile")):
        rows.append((nm + " +x", [load(TGT[v], W), load(R33 / (v + ".png"), W),
                                  load(C / (v + ".png"), W)]))
        rows.append((nm + " -x flip", [dark(W, "no -x target"),
                                       flip(load(neg33 / (v + ".png"), W)),
                                       flip(load(CN / (v + ".png"), W))]))
    rows.append(("ear +x", [dark(W, "n/a"), load(ear33 / "front.png", W),
                            load(CE / "front.png", W)]))
    rows.append(("ear -x flip", [dark(W, "n/a"),
                                 flip(load(ear33 / "three_quarter.png", W)),
                                 flip(load(CE / "three_quarter.png", W))]))
    H = len(rows) * W
    sheet = Image.new("RGB", (3 * W, H), (0, 0, 0))
    for i, (nm, ims) in enumerate(rows):
        for j, im in enumerate(ims):
            sheet.paste(label(im, "%s | %s" % (nm, ("target", "+x/-x", third)[j])),
                        (j * W, i * W))
    out = E / "sheet.png"
    sheet.save(out)
    print("wrote", out, sheet.size)


if __name__ == "__main__":
    main()
