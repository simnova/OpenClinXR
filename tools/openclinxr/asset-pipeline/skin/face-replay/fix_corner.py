"""Eye corner fix: paint socket-wall texels visible through eye corners as conjunctiva.

Ported from S/eyegeo/fix_corner.py for the face-replay hand-steps chain.
Uses DERIVED socket walls from derive.py (not hardcoded constants).

The scratch script split socket faces into inner/outer by 3-D sidedness vs
the subject eye-mesh centroid. The port splits the derived socket-wall texels
the same way in UV space: each texel goes to the nearer of the two derived
eye-corner landmarks (eye-corner-<side>-inner/outer from landmarks-uv.json,
row=v*S). Inner paints caruncle pink, outer pale conjunctiva.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("albedo_in", type=Path)
    ap.add_argument("albedo_out", type=Path)
    ap.add_argument("--socket-wall-L", type=Path, required=True)
    ap.add_argument("--socket-wall-R", type=Path, required=True)
    ap.add_argument("--landmarks", type=Path, required=True)
    ap.add_argument("--inner-rgb", type=int, nargs=3, default=[200, 140, 125])
    ap.add_argument("--outer-rgb", type=int, nargs=3, default=[215, 185, 170])
    ap.add_argument("--feather-px", type=int, default=8)
    args = ap.parse_args(argv)

    alb = Image.open(args.albedo_in).convert("RGB")
    W, H = alb.size
    out = np.asarray(alb).astype(float)

    lm = json.loads(args.landmarks.read_text())
    assert lm.get("row") == "v*S", "landmarks must be row=v*S convention"
    sc = W / float(lm["size"])
    # uv_texel = [u*S, v*S] -> image (col, row).
    pts = {k: (float(v["uv_texel"][0]) * sc, float(v["uv_texel"][1]) * sc)
           for k, v in lm["landmarks"].items()}

    yy, xx = np.mgrid[0:H, 0:W]
    used = np.zeros((H, W), np.float64)
    for side in ("L", "R"):
        sock = np.array(Image.open(
            args.socket_wall_L if side == "L" else args.socket_wall_R
        ).convert("L")).astype(np.float32) / 255.0
        if sock.shape != (H, W):
            sock = np.array(Image.fromarray(
                (sock * 255).astype(np.uint8)).resize((W, H),
                                                      Image.BILINEAR)
                            ).astype(np.float32) / 255.0
        zone = sock > 0.5
        if not zone.any():
            print(f"{side} socket wall: no texels above threshold "
                  f"(not_scripted input missing)", flush=True)
            continue
        ci = pts[f"eye-corner-{side}-inner"]
        co = pts[f"eye-corner-{side}-outer"]
        d_in = (xx - ci[0]) ** 2 + (yy - ci[1]) ** 2
        d_out = (xx - co[0]) ** 2 + (yy - co[1]) ** 2
        for tag, region, rgb in (("inner", zone & (d_in <= d_out),
                                  args.inner_rgb),
                                 ("outer", zone & (d_in > d_out),
                                  args.outer_rgb)):
            if not region.any():
                print(f" {side} {tag}: no texels", flush=True)
                continue
            mask = Image.fromarray((region * 255).astype(np.uint8))
            mask = mask.filter(ImageFilter.GaussianBlur(args.feather_px))
            a_mask = (np.asarray(mask).astype(float) / 255.0)[..., None]
            out = out * (1 - a_mask) + np.array(rgb, dtype=float) * a_mask
            used = np.maximum(used, a_mask[..., 0])
            print(f" {side} {tag} texels {int(region.sum())} painted {rgb}",
                  flush=True)

    result = out.astype(np.uint8)
    # Bit-exact outside the feathered paint: paste the source back so the
    # stage changes only texels inside its derived mask.
    result[used == 0] = np.asarray(alb)[used == 0]
    Image.fromarray(result).save(args.albedo_out)
    print("wrote", args.albedo_out, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
