"""Comparison sheet: target at native 512 beside the front render downscaled to 512
(LANCZOS, downscale only), plus a 512 strip of all views. Plain python + Pillow.

    python3 sheet.py --target <target.png> --round-dir <EV/r<n>>
"""
import argparse
from pathlib import Path

from PIL import Image

VIEWS = ("front", "three_quarter_left", "side")
SIZE = 512


def down(path):
    im = Image.open(path).convert("RGB")
    if im.width < SIZE or im.height < SIZE:
        raise SystemExit("refusing to upscale %s" % path)
    return im if im.size == (SIZE, SIZE) else im.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True)
    ap.add_argument("--round-dir", required=True)
    a = ap.parse_args()
    rd = Path(a.round_dir)
    t = Image.open(a.target).convert("RGB")
    if t.size != (SIZE, SIZE):
        raise SystemExit("target must be native %d" % SIZE)
    s = Image.new("RGB", (2 * SIZE, SIZE))
    s.paste(t, (0, 0))
    s.paste(down(rd / "front.png"), (SIZE, 0))
    s.save(rd / "sheet.png")
    v = Image.new("RGB", (3 * SIZE, SIZE))
    for i, name in enumerate(VIEWS):
        if (rd / (name + ".png")).exists():
            v.paste(down(rd / (name + ".png")), (i * SIZE, 0))
    v.save(rd / "views-512.png")
    print("SHEET", rd / "sheet.png")


if __name__ == "__main__":
    main()
