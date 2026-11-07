#!/usr/bin/env python3
"""hair-groom2 colour search scorer: 512px search renders vs aisha-v3.

For each combo dir (back.png/front.png at 512): upscale 2x to 1024,
shared-mask (target mask & render-ID? IDs not rendered in search, so use
target mask for target stats and target mask for render stats -- the
render fills the mask in these views after the groom2 length fix; the
final 1024 verification uses the shared mask properly) stats: lum p50/p90,
hue circular mean, sat mean. Prints one line per view + distance to target.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

E2 = Path(__file__).resolve().parent
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
BEAUTY = {"back": "target-back.png", "front": "target-front-a1.png"}
MASKF = {"back": "mask-back.png", "front": "mask-front.png"}


def rgb_to_hs(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-12), 0.0)
    h = np.zeros_like(mx)
    m = (d > 0)
    mr = m & (mx == r)
    mg = m & (mx == g)
    mb = m & (mx == b)
    h[mr] = ((g[mr] - b[mr]) / d[mr]) % 6.0
    h[mg] = (b[mg] - r[mg]) / d[mg] + 2.0
    h[mb] = (r[mb] - g[mb]) / d[mb] + 4.0
    return (h * 60.0) % 360.0, s


def stats(rgb, m):
    px = rgb[m]
    lum = (0.2126 * px[:, 0] + 0.7152 * px[:, 1]
           + 0.0722 * px[:, 2]) * 255.0
    h, s = rgb_to_hs(px)
    hcirc = float(np.degrees(np.angle(
        np.exp(1j * np.deg2rad(h)).mean()))) % 360.0
    return {"lumP50": round(float(np.percentile(lum, 50)), 1),
            "lumP90": round(float(np.percentile(lum, 90)), 1),
            "hueMean": round(hcirc, 1),
            "satMean": round(float(s.mean()), 3),
            "n": int(px.shape[0])}


def main():
    dirs = sys.argv[1:]
    iddir = Path(sys.argv[0]).parent / "color-search" / "idgeo"
    for d in dirs:
        d = Path(d)
        line = {"combo": d.name}
        for view in ("back", "front"):
            tgt = (np.asarray(Image.open(SCR / BEAUTY[view])
                              .convert("RGB"), dtype=np.float64) / 255.0)
            tmask = np.array(Image.open(SCR / MASKF[view])) > 127
            ren = (np.asarray(Image.open(d / (view + ".png"))
                              .convert("RGB"), dtype=np.float64) / 255.0)
            H = ren.shape[0]
            tmask_full = tmask
            if H != 1024:
                tmask = np.asarray(Image.fromarray(
                    tmask).resize((H, H), Image.NEAREST)) > 0
            rid = np.array(Image.open(iddir / (view + "-id.png"))
                           .convert("RGBA"))[:, :, 3]
            if rid.shape[0] != H:
                rid = np.asarray(Image.fromarray(rid).resize(
                    (H, H), Image.NEAREST))
            fmask = rid >= 230
            both = fmask & tmask
            ct = stats(tgt, tmask_full)
            cr = stats(ren, both)
            dl = abs(cr["lumP50"] - ct["lumP50"]) \
                + 0.5 * abs(cr["lumP90"] - ct["lumP90"])
            dh = min(abs(cr["hueMean"] - ct["hueMean"]),
                     360 - abs(cr["hueMean"] - ct["hueMean"]))
            ds = abs(cr["satMean"] - ct["satMean"])
            line[view] = {"tgt": [ct["lumP50"], ct["lumP90"],
                                  ct["hueMean"], ct["satMean"]],
                          "ren": [cr["lumP50"], cr["lumP90"],
                                  cr["hueMean"], cr["satMean"]],
                          "nInter": int(both.sum()),
                          "dist": round(dl + dh + 100 * ds, 1)}
        print(json.dumps(line))


if __name__ == "__main__":
    main()
