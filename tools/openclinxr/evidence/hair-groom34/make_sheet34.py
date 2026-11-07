"""groom34 contact sheets (E driver; PIL only).

--mode before: E/before-sheet.png. Rows 3q(+x) / 3q(-x, flipped) /
  profile(+x) / profile(-x, flipped); cols target | groom33; plus an
  ear close-up row (groom33 +x | groom33 -x flipped).
--mode final: E/sheet.png. Same rows; cols target | groom33 | groom34
  (-x rows: target cell dark, labelled no -x target).
Flip: horizontal (np.fliplr) so -x reads like +x.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
E33 = E.parent / "hair-groom33"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
SETB = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
            "/target-views/set-back")
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
    ap.add_argument("--mode", choices=("before", "final"), required=True)
    args = ap.parse_args()
    W = 512
    neg33 = E / "renders-33neg"
    ear33 = E / "renders-33ear"
    if args.mode == "before":
        cols = ["target", "groom33 +x", "groom33 -x flip"]
        rows = []
        for v, nm in (("three_quarter", "3q"), ("profile_90", "profile")):
            rows.append((nm + " +x", [load(TGT[v], W),
                                      load(R33 / (v + ".png"), W),
                                      flip(load(neg33 / (v + ".png"), W))]))
        # ear close-ups: front slot = +x, three_quarter slot = -x
        ex = load(ear33 / "front.png", W)
        en = flip(load(ear33 / "three_quarter.png", W))
        rows.append(("ear", [dark(W, "n/a"), ex, en]))
        out = E / "before-sheet.png"
    else:
        neg34 = E / "renders-34neg"
        ear34 = E / "renders-34ear"
        R34 = E / "renders-34"
        rows = []
        for v, nm in (("three_quarter", "3q"), ("profile_90", "profile")):
            rows.append((nm + " +x", [load(TGT[v], W),
                                      load(R33 / (v + ".png"), W),
                                      load(R34 / (v + ".png"), W)]))
            rows.append((nm + " -x flip",
                         [dark(W, "no -x target"),
                          flip(load(neg33 / (v + ".png"), W)),
                          flip(load(neg34 / (v + ".png"), W))]))
        rows.append(("ear +x", [dark(W, "n/a"),
                                load(ear33 / "front.png", W),
                                load(ear34 / "front.png", W)]))
        rows.append(("ear -x flip", [dark(W, "n/a"),
                                     flip(load(ear33 / "three_quarter.png",
                                               W)),
                                     flip(load(ear34 / "three_quarter.png",
                                               W))]))
        out = E / "sheet.png"
    H = len(rows) * W
    Wd = 3 * W
    sheet = Image.new("RGB", (Wd, H), (0, 0, 0))
    for i, (nm,ims) in enumerate(rows):
        for j, im in enumerate(ims):
            sheet.paste(label(im, "%s | %s" % (
                nm, ("target", "+x", "-x")[j] if args.mode == "before"
                else ("target", "groom33", "groom34")[j])), (j * W, i * W))
    sheet.save(out)
    print("wrote", out, sheet.size)


if __name__ == "__main__":
    main()
