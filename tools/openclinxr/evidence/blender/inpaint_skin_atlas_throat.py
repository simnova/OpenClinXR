"""Inpaint the throat UV island of a baked skin albedo atlas (class-C collar T).

Class-C verdict (tools/openclinxr/evidence/humanoid-vetting/
mpfb-nurse-sternal-t-classify.json): throat skin tris render atlas texels a
half-step off neighboring skin (T median ~[174,160,145] vs adjacent
~[165,152,137]); straight T edges follow the throat UV-island boundary, not a
mask boundary. Fix is texel-only: replace island texels with the
neighboring-skin median sampled from a ring OUTSIDE the island, never from
the T itself. No geometry is invented; no other island is touched.

UV convention: glTF/Blender UV origin is bottom-left (OpenGL). PNG row 0 is
top, so row = floor((1 - v) * H) and col = floor(u * W).

No bpy dependency. The materializer imports and calls inpaint_throat_island()
after bake_skin_material_to_texture.
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np
from PIL import Image

# Adult nurse throat island on the baked skin atlas (classify record).
DEFAULT_UV_BBOX = (0.157, 0.412, 0.604, 0.468)  # (u0, v0, u1, v1)

# Face island sits on the right of the 1024 atlas; never written.
DEFAULT_PROTECT = ((0.65, 0.0, 1.0, 1.0),)  # (u0, v0, u1, v1)


def _uv_rect_to_pixels(uv_bbox, w, h):
    u0, v0, u1, v1 = uv_bbox
    c0 = max(0, min(w - 1, int(np.floor(u0 * w))))
    c1 = max(0, min(w - 1, int(np.ceil(u1 * w)) - 1))
    r_top = max(0, min(h - 1, int(np.floor((1.0 - v1) * h))))
    r_bot = max(0, min(h - 1, int(np.ceil((1.0 - v0) * h)) - 1))
    if c1 < c0 or r_bot < r_top:
        raise ValueError("uv_bbox %r maps to an empty pixel rect on %dx%d" % (uv_bbox, w, h))
    return c0, r_top, c1, r_bot


def _rects_overlap(a, b):
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def _median_rgb(px):
    return [int(x) for x in np.median(px.reshape(-1, 3).astype(np.float64), axis=0).round()]


def inpaint_throat_island(png_path, uv_bbox=DEFAULT_UV_BBOX, out_path=None,
                          ring_width=6, max_ring_dist=40, protect=DEFAULT_PROTECT):
    """Replace throat-island texels with the outside-ring skin median.

    Returns {"texelsChanged", "medianBefore", "medianAfter", "neighborMedian",
    "ringTexels", "ringTrimKept", "outPath", "uvConvention"}.
    """
    img = Image.open(png_path)
    mode = img.mode
    if mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
        mode = "RGB"
    w, h = img.size
    arr = np.array(img)
    rgb = arr[:, :, :3].copy()

    c0, r_top, c1, r_bot = _uv_rect_to_pixels(uv_bbox, w, h)

    protects = [protect] if protect and len(protect) == 4 and isinstance(protect[0], float) else list(protect or [])
    for pb in protects:
        pr = _uv_rect_to_pixels(pb, w, h)
        if _rects_overlap((c0, r_top, c1, r_bot), pr):
            raise ValueError("protect bbox %r overlaps the inpaint bbox" % (pb,))

    median_before = _median_rgb(rgb[r_top:r_bot + 1, c0:c1 + 1])

    # Ring: dilated rect minus the island itself. Ring width clamps at edges.
    rc0 = max(0, c0 - ring_width)
    rc1 = min(w - 1, c1 + ring_width)
    rr_top = max(0, r_top - ring_width)
    rr_bot = min(h - 1, r_bot + ring_width)
    ring_mask = np.ones((rr_bot - rr_top + 1, rc1 - rc0 + 1), dtype=bool)
    ring_mask[r_top - rr_top:r_bot - rr_top + 1, c0 - rc0:c1 - rc0 + 1] = False
    ring = rgb[rr_top:rr_bot + 1, rc0:rc1 + 1][ring_mask]
    if ring.shape[0] == 0:
        raise ValueError("empty neighbor ring for uv_bbox %r" % (uv_bbox,))

    # Trim garment/background strays: keep ring texels near the ring median.
    ring_med = np.median(ring.astype(np.float64), axis=0)
    keep = np.abs(ring.astype(np.float64) - ring_med).max(axis=1) <= max_ring_dist
    trimmed = ring[keep] if keep.any() else ring
    fill = np.median(trimmed.astype(np.float64), axis=0).round().astype(np.uint8)
    neighbor_median = [int(x) for x in fill]

    island = rgb[r_top:r_bot + 1, c0:c1 + 1]
    changed = int((np.abs(island.astype(np.int16) - fill.astype(np.int16)).max(axis=2) > 0).sum())
    island[:, :] = fill
    median_after = _median_rgb(rgb[r_top:r_bot + 1, c0:c1 + 1])

    # Protected islands must be byte-stable (fail closed).
    for pb in protects:
        pc0, pr_top, pc1, pr_bot = _uv_rect_to_pixels(pb, w, h)
        if not np.array_equal(rgb[pr_top:pr_bot + 1, pc0:pc1 + 1],
                              arr[pr_top:pr_bot + 1, pc0:pc1 + 1, :3]):
            raise RuntimeError("protected bbox %r changed during inpaint" % (pb,))

    dest = out_path or png_path
    if mode == "RGBA":
        out = np.dstack([rgb, arr[:, :, 3]])
    else:
        out = rgb
    Image.fromarray(out, mode).save(dest)

    return {
        "texelsChanged": changed,
        "medianBefore": median_before,
        "medianAfter": median_after,
        "neighborMedian": neighbor_median,
        "ringTexels": int(ring.shape[0]),
        "ringTrimKept": int(trimmed.shape[0]),
        "outPath": os.path.abspath(dest),
        "uvConvention": "opengl-bottom-left",
    }


def _parse_bbox(s):
    vals = tuple(float(x) for x in s.split(","))
    if len(vals) != 4:
        raise argparse.ArgumentTypeError("bbox needs u0,v0,u1,v1")
    return vals


def main(argv=None):
    ap = argparse.ArgumentParser(description="Inpaint the throat UV island of a baked skin atlas.")
    ap.add_argument("png", help="baked albedo PNG (overwritten unless --out)")
    ap.add_argument("--uv-bbox", type=_parse_bbox, default=DEFAULT_UV_BBOX)
    ap.add_argument("--out", default=None, help="sibling output path (default: in place)")
    ap.add_argument("--ring-width", type=int, default=6)
    ap.add_argument("--max-ring-dist", type=int, default=40)
    ap.add_argument("--protect", type=_parse_bbox, action="append", default=None,
                    help="repeatable protected UV bbox (default: right-side face island)")
    args = ap.parse_args(argv)
    census = inpaint_throat_island(args.png, uv_bbox=args.uv_bbox, out_path=args.out,
                                   ring_width=args.ring_width,
                                   max_ring_dist=args.max_ring_dist,
                                   protect=args.protect if args.protect is not None else DEFAULT_PROTECT)
    print(json.dumps(census))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
