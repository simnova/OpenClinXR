#!/usr/bin/env python3
"""g1_canthus.py — G1 bright-fraction instrument for the eye-corner fill.

Method (corner-assets manifest lineage: bright texel r>150 g>140 b>130):
per eye, the neon lash aperture of the SAME view is split into lateral and
medial sixths (full aperture height); the lateral sixth is the outer
canthus, the medial sixth the inner canthus. Fractions are computed over
HEAD pixels only: the render background (#18211d) can never be bright, so
an unmasked crop makes the yaw threshold unachievable by construction
(proved by the backgroundFraction column: up to ~0.5 of a grazing corner
crop is background). Head = max(|r-24|,|g-33|,|b-29|) > 16 on the natural
render.

G1 gate: fill[yaw+-40][eye][canthus] >= fill[front][eye][canthus]
(threshold = frontal, same bake). Base values reported for context.

Usage:
  g1_canthus.py <store/eye-corner dir>   # reads eye-corner-sheet-record.json
    + eyecorner-natural-{base,fill}-{front,yaw25,yaw-25,yaw40,yaw-40}.png
Prints JSON {g1: {bake: {view: {L: {inner, outer, ...}, R: ...}}}}.
"""

import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("PIL required: `mise exec -- python3`")

BG = (24, 33, 29)


def bright(p):
    return p[0] > 150 and p[1] > 140 and p[2] > 130


def head(p):
    return max(abs(p[0] - BG[0]), abs(p[1] - BG[1]),
               abs(p[2] - BG[2])) > 16


def main():
    store = sys.argv[1]
    rec = json.load(open(os.path.join(store,
                                      "eye-corner-sheet-record.json")))
    out = {}
    for bake in ("base", "fill"):
        out[bake] = {}
        for v in ("front", "yaw25", "yaw-25", "yaw40", "yaw-40"):
            im = Image.open(os.path.join(
                store, f"eyecorner-natural-{bake}-{v}.png")).convert("RGB")
            px = im.load()
            boxes = rec["apertures"][bake][v]
            row = {}
            for half in ("L", "R"):
                b = boxes[half]
                if b is None:
                    row[half] = None
                    continue
                w = b["x1"] - b["x0"] + 1
                t = max(1, w // 6)
                mid = (b["x0"] + b["x1"]) / 2 < 512
                inner = (b["x1"] - t + 1, b["x1"]) if mid else \
                    (b["x0"], b["x0"] + t - 1)
                outer = (b["x0"], b["x0"] + t - 1) if mid else \
                    (b["x1"] - t + 1, b["x1"])
                cell = {}
                for name, (x0, x1) in (("inner", inner), ("outer", outer)):
                    n = hd = br = 0
                    for y in range(b["y0"], b["y1"] + 1):
                        for x in range(x0, x1 + 1):
                            p = px[x, y]
                            if not head(p):
                                continue
                            hd += 1
                            n += 1
                            if bright(p):
                                br += 1
                    cell[name] = {
                        "brightFraction": round(br / max(1, n), 4),
                        "headPx": hd,
                        "backgroundFraction": round(
                            1 - hd / max(1, (x1 - x0 + 1)
                                         * (b["y1"] - b["y0"] + 1)), 4),
                    }
                row[half] = cell
            out[bake][v] = row
    print(json.dumps({"g1": out}, indent=1))


if __name__ == "__main__":
    main()
