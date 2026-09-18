"""Inpaint the throat UV island of a baked skin albedo atlas (class-C collar T).

Class-C verdict (tools/openclinxr/evidence/humanoid-vetting/
mpfb-nurse-sternal-t-classify.json): throat skin tris render atlas texels a
half-step off neighboring skin (T median ~[174,160,145] vs adjacent
~[165,152,137]); straight T edges follow the throat UV-island boundary, not a
mask boundary. Fix is texel-only: replace island texels with the
neighboring-skin median sampled from a ring OUTSIDE the island, never from
the T itself. No geometry is invented; no other island is touched.

FOLLOW-ON (subdiv2 atlas, 2026-09-18): the old DEFAULT_UV_BBOX above was the
classify record of the OLD shipped GLB. On the skins01+subdiv atlas that bbox
is a 459x59 px black strip (74% black) -- the wrong target. The visible T is
the TOP torso island at u=[0.3428,0.4385] v=[0.8027,0.8672] (atlas px
x=351-449, y=136-202, OpenGL convention). The new default bbox
(0.33,0.79,0.46,0.88) covers it with ~14 px padding (px x=337-471,
y=122-215 on the 1024 atlas).

FOLLOW-ON 2 (hole, not darker skin): the visible T is an INTERIOR unbaked
black hole (724 texels, max(R,G,B) < 16) inside the torso skin island, not a
darker-skin rectangle. Skip-black preserved the defect. Black texels in the
bbox are therefore classified by atlas-level edge connectivity: GUTTER (black
flood-filled from the image borders through black -- byte-stable) vs HOLE
(black not edge-connected -- filled with the neighbor skin median). Skin
texels in the bbox are also replaced (covers lighter-T fixtures too).

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

# Visible collar T on the skins01+subdiv baked atlas: measured T core
# u=[0.3428,0.4385] v=[0.8027,0.8672] (atlas px x=351-449, y=136-202);
# this bbox adds ~14 px padding (px x=337-471, y=122-215 on 1024 atlas).
DEFAULT_UV_BBOX = (0.33, 0.79, 0.46, 0.88)  # (u0, v0, u1, v1)

# Face island sits on the right of the 1024 atlas; never written.
DEFAULT_PROTECT = ((0.65, 0.0, 1.0, 1.0),)  # (u0, v0, u1, v1)

# Texels darker than this are atlas background, never skin, never ring.
SKIN_MIN_MAXC = 16

# Pillow >= 10 moved resampling flags under Image.Resampling.
_RESAMPLE_BILINEAR = getattr(getattr(Image, "Resampling", Image), "BILINEAR", 1)


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


def _edge_connected_black(black):
    """4-connected black texels reachable from the image border (the gutter)."""
    h, w = black.shape
    seen = np.zeros((h, w), dtype=bool)
    stack = []
    for x in range(w):
        for y in (0, h - 1):
            if black[y, x] and not seen[y, x]:
                seen[y, x] = True
                stack.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if black[y, x] and not seen[y, x]:
                seen[y, x] = True
                stack.append((y, x))
    while stack:
        y, x = stack.pop()
        if y > 0 and black[y - 1, x] and not seen[y - 1, x]:
            seen[y - 1, x] = True
            stack.append((y - 1, x))
        if y + 1 < h and black[y + 1, x] and not seen[y + 1, x]:
            seen[y + 1, x] = True
            stack.append((y + 1, x))
        if x > 0 and black[y, x - 1] and not seen[y, x - 1]:
            seen[y, x - 1] = True
            stack.append((y, x - 1))
        if x + 1 < w and black[y, x + 1] and not seen[y, x + 1]:
            seen[y, x + 1] = True
            stack.append((y, x + 1))
    return seen


def inpaint_throat_island(png_path, uv_bbox=DEFAULT_UV_BBOX, out_path=None,
                          ring_width=6, max_ring_dist=40, protect=DEFAULT_PROTECT,
                          source_diffuse=None):
    """Replace bbox skin texels plus the interior black HOLE with the ring skin median.

    Black texels in the bbox are classified by atlas-level edge connectivity:
    GUTTER black (flood-filled from the image borders through black texels)
    is atlas background and stays byte-stable; HOLE black (not
    edge-connected, i.e. an interior unbaked void such as the collar T) is
    filled with the neighbor skin median. All SKIN texels
    (max(R,G,B) >= SKIN_MIN_MAXC) in the bbox are also replaced, so both
    darker-T and lighter-T polarities are covered. The ring likewise uses
    skin texels only and raises ValueError when no skin ring exists or the
    ring median is near-black (fail closed -- never write [0,0,0] as fill).

    source_diffuse: optional path to a source diffuse image; when given, the
    source is resized to the atlas size and its texels are copied onto the
    replaced mask instead of the flat neighbor median (keeps pores).

    Returns {"texelsChanged", "medianBefore", "medianAfter", "neighborMedian",
    "ringTexels", "ringTrimKept", "bboxSkinTexels", "bboxHoleTexels",
    "bboxBlackKept", "outPath", "uvConvention"}.
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

    # Ring: dilated rect minus the island itself, SKIN TEXELS ONLY.
    rc0 = max(0, c0 - ring_width)
    rc1 = min(w - 1, c1 + ring_width)
    rr_top = max(0, r_top - ring_width)
    rr_bot = min(h - 1, r_bot + ring_width)
    ring_mask = np.ones((rr_bot - rr_top + 1, rc1 - rc0 + 1), dtype=bool)
    ring_mask[r_top - rr_top:r_bot - rr_top + 1, c0 - rc0:c1 - rc0 + 1] = False
    ring_all = rgb[rr_top:rr_bot + 1, rc0:rc1 + 1][ring_mask]
    skin_ring = ring_all[ring_all.max(axis=1) >= SKIN_MIN_MAXC]
    if skin_ring.shape[0] == 0:
        raise ValueError("no skin texels in neighbor ring for uv_bbox %r" % (uv_bbox,))

    # Trim garment strays: keep skin-ring texels near the skin-ring median.
    ring_med = np.median(skin_ring.astype(np.float64), axis=0)
    keep = np.abs(skin_ring.astype(np.float64) - ring_med).max(axis=1) <= max_ring_dist
    trimmed = skin_ring[keep] if keep.any() else skin_ring
    fill = np.median(trimmed.astype(np.float64), axis=0).round().astype(np.uint8)
    neighbor_median = [int(x) for x in fill]
    if max(neighbor_median) < SKIN_MIN_MAXC:
        raise ValueError("neighbor ring median %r is near-black; refusing to fill" % (neighbor_median,))

    island = rgb[r_top:r_bot + 1, c0:c1 + 1]
    skin_mask = island.max(axis=2) >= SKIN_MIN_MAXC
    # HOLE vs GUTTER: black texels NOT connected to the image border through
    # black are interior voids (the T) and must be filled; edge-connected
    # black is atlas gutter and stays byte-stable. Flood-fill runs on the
    # whole image so bbox-edge black that continues outside still counts.
    black_full = rgb.max(axis=2) < SKIN_MIN_MAXC
    gutter_full = _edge_connected_black(black_full)
    hole_mask = black_full[r_top:r_bot + 1, c0:c1 + 1] & ~gutter_full[r_top:r_bot + 1, c0:c1 + 1]
    fill_mask = skin_mask | hole_mask
    black_kept = int((~fill_mask).sum())
    hole_n = int(hole_mask.sum())
    if source_diffuse is not None:
        src = Image.open(source_diffuse)
        if src.mode not in ("RGB", "RGBA"):
            src = src.convert("RGB")
        src_rgb = np.array(src.convert("RGB").resize((w, h), _RESAMPLE_BILINEAR))
        src_patch = src_rgb[r_top:r_bot + 1, c0:c1 + 1]
        changed = int((np.abs(island[fill_mask].astype(np.int16)
                              - src_patch[fill_mask].astype(np.int16)).max(axis=1) > 0).sum())
        island[fill_mask] = src_patch[fill_mask]
    else:
        changed = int((np.abs(island[fill_mask].astype(np.int16)
                              - fill.astype(np.int16)).max(axis=1) > 0).sum())
        island[fill_mask] = fill
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
        "ringTexels": int(ring_all.shape[0]),
        "ringTrimKept": int(trimmed.shape[0]),
        "bboxSkinTexels": int(skin_mask.sum()),
        "bboxHoleTexels": hole_n,
        "bboxBlackKept": black_kept,
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
    ap.add_argument("--source-diffuse", default=None,
                    help="optional source diffuse image; its resized texels fill the T mask (keeps pores)")
    args = ap.parse_args(argv)
    census = inpaint_throat_island(args.png, uv_bbox=args.uv_bbox, out_path=args.out,
                                   ring_width=args.ring_width,
                                   max_ring_dist=args.max_ring_dist,
                                   protect=args.protect if args.protect is not None else DEFAULT_PROTECT,
                                   source_diffuse=args.source_diffuse)
    print(json.dumps(census))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
