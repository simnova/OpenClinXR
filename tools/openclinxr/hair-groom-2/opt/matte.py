"""matte.py: runtime hair matte (A1b) from the opt/batch.ts matte renders.

  hair_matte(colour_png, nohair_png, hair_png, empty_png) -> bool mask
    = erode( (|hair - empty|.max > 3/255) & (|colour - nohair|.max > 3/255), 2 )     (sheen_gate.render_hair's threshold/erosion)
  The first term is the hair silhouette from a render with every body mesh hidden (no skin/shirt pixels the hair shades);
  the second removes hair hidden behind the body (colour == nohair there). 'hair_only_mask' is the first term alone.
Usage: matte.py write <colour prefix> <nohair prefix> <out prefix>
       reads <colour prefix>-<view>{,-hair,-empty}.png (batch.ts matte:true writes the three) and <nohair prefix>-<view>.png;
       writes <out prefix>-<view>.png (RGBA, alpha = UNeroded matte * 255; sheen_gate's matte path and score_trial --matte
       read alpha > .5 and erode by 2, which gives hair_matte())
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "grade"))
import sheen_gate as sg  # noqa: E402

VIEWS = ["front", "three_quarter_left", "side", "back"]
T = 3 / 255.


def hair_only_mask(hair, empty):
    return np.abs(hair - empty).max(2) > T


def raw_matte(colour, nohair, hair, empty):
    """Un-eroded visible-hair matte."""
    return hair_only_mask(hair, empty) & (np.abs(colour - nohair).max(2) > T)


def hair_matte(colour, nohair, hair, empty):
    return sg.erode(raw_matte(colour, nohair, hair, empty), 2)


def write(prefix, nohair_prefix, out_prefix):
    for v in VIEWS:
        c, h, e = (sg.load("%s-%s%s.png" % (prefix, v, s)) for s in ("", "-hair", "-empty"))
        n = sg.load("%s-%s.png" % (nohair_prefix, v))
        m = raw_matte(c, n, h, e)
        a = np.zeros(m.shape + (4,), np.uint8)
        a[..., :3] = 255
        a[..., 3] = m * 255
        Image.fromarray(a, "RGBA").save("%s-%s.png" % (out_prefix, v))


if __name__ == "__main__":
    if sys.argv[1] == "write":
        write(*sys.argv[2:5])
