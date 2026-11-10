"""3-up sheets per view at native resolution: target | strand round | card round (numpy + Pillow).

    <blender python> sheet3.py --strands <groom round> --cards <card round dir> --out-dir <dir> \
        [--crop r0,r1,c0,c1]

Each sheet is the three 1024 px images side by side, unscaled (targets keep their own framing; the
rubric maps them through grade/frames.json, this sheet does not). --crop also writes the same canonical
window of the strand and card images side by side (1:1) for close inspection; the target is left out of
crops because its frame differs.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
TARGETS = {"front": "target-front-a1.png", "three_quarter_left": "target-three_quarter-a1.png",
           "side": "target-profile-a1.png", "back": "target-back-a1.png"}


def rgb(p):
    return np.asarray(Image.open(p).convert("RGB"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strands", required=True)
    ap.add_argument("--cards", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--crop", action="append", default=[], help="view:r0,r1,c0,c1")
    a = ap.parse_args()
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    tg = HERE.parent / "targets"
    for v, t in TARGETS.items():
        ims = [rgb(tg / t), rgb(Path(a.strands) / (v + ".png")), rgb(Path(a.cards) / (v + ".png"))]
        gap = np.full((1024, 8, 3), 255, np.uint8)
        Image.fromarray(np.concatenate([ims[0], gap, ims[1], gap, ims[2]], 1)).save(out / ("3up-%s.png" % v))
    for c in a.crop:
        v, box = c.split(":")
        r0, r1, c0, c1 = (int(x) for x in box.split(","))
        s, k = rgb(Path(a.strands) / (v + ".png"))[r0:r1, c0:c1], rgb(Path(a.cards) / (v + ".png"))[r0:r1, c0:c1]
        gap = np.full((r1 - r0, 6, 3), 255, np.uint8)
        Image.fromarray(np.concatenate([s, gap, k], 1)).save(out / ("crop-%s-r%d-%d-c%d-%d.png" % (v, r0, r1, c0, c1)))


if __name__ == "__main__":
    main()
