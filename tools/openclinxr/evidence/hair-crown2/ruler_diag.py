#!/usr/bin/env python3
"""hair-crown2 STEP 1 ruler diagnostic overlay (numpy/PIL/scipy only).

Overlays on OUR base frames: projected cap fill (head-mesh UV region that
hair covers), projected anatomical hairline loop, hair silhouette
(ID alpha>=30, closed+dilated), and the H-normalized crown band. Read this
before locking the ruler definition.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

E = Path(__file__).resolve().parent
SIZE = 1024


def load_id(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGBA"), dtype=np.uint8)[..., 3]


def main():
    R = E / "ruler"
    proj = np.load(R / "cap_projection.npz")
    capnpz = np.load(E.parent / "hair-cap8" / "cap-v8.npz")
    faces = np.asarray(capnpz["faces"], dtype=np.int64)
    side_meta = {"front": None, "back": None}
    import json as _json
    meta = _json.loads(np.asarray(proj["meta"]).item())
    side_meta = {"front": meta["front_camera"], "back": meta["back_camera"]}
    base_score = json.loads((E / "base" / "score.json").read_text())
    lm = base_score["judgeV6"]["landmarks"]
    out = []
    for view in ("front", "back"):
        px = np.asarray(proj[f"{view}_cap_px"])
        fh = np.asarray(proj[f"{view}_forehead_px"])
        camloc = np.array(side_meta[view]["location"], float)
        verts = np.asarray(capnpz["verts"], float)  # world (cap matrix identity)
        # Backface cull: keep faces whose outward normal faces the camera.
        # Without this, far-side (e.g. nape) faces project THROUGH the head
        # onto the face in front view.
        a, b, c = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
        n = np.cross(b - a, c - a)
        n /= (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)
        ctr = (a + b + c) / 3.0
        vd = camloc[None, :] - ctr
        vd /= (np.linalg.norm(vd, axis=1, keepdims=True) + 1e-12)
        keep = (n * vd).sum(axis=1) > 0.0
        print(f"{view}: faces front-facing kept={keep.sum()}/{len(faces)}", flush=True)
        # cap fill: rasterize all projected faces (union outline)
        fill = Image.new("L", (SIZE, SIZE), 0)
        dr = ImageDraw.Draw(fill)
        nskip = 0
        for i in np.flatnonzero(keep):
            a, b, c = faces[i]
            poly = [(float(px[a, 0]), float(px[a, 1])),
                    (float(px[b, 0]), float(px[b, 1])),
                    (float(px[c, 0]), float(px[c, 1]))]
            if all(not (0 <= x < SIZE and 0 <= y < SIZE) for x, y in poly):
                nskip += 1
                continue
            dr.polygon(poly, fill=255)
        fill_a = np.asarray(fill) > 0
        print(f"{view}: cap fill frac={fill_a.mean():.4f} "
              f"in-frame rows=[{np.where(fill_a.any(axis=1))[0].min()},{np.where(fill_a.any(axis=1))[0].max()}] "
              f"faces skipped off-frame={nskip}/{len(faces)}", flush=True)
        # hair silhouette from ID
        alpha = load_id(E / "base" / f"{view}-id.png")
        hair = alpha >= 30
        sil = ndimage.binary_closing(hair, iterations=7)
        sil = ndimage.binary_dilation(sil, iterations=5)
        print(f"{view}: hair frac={hair.mean():.4f} silhouette frac={sil.mean():.4f}", flush=True)
        # canvas
        beauty = Image.open(E / "base" / f"{view}.png").convert("RGB")
        ov = beauty.copy()
        tint = Image.new("RGB", ov.size, (255, 0, 0))
        m = Image.fromarray((fill_a * 90).astype(np.uint8))
        ov = Image.composite(Image.blend(ov, tint, 0.45), ov, m)
        tint2 = Image.new("RGB", ov.size, (0, 120, 255))
        m2 = Image.fromarray((sil * 70).astype(np.uint8))
        ov = Image.composite(Image.blend(ov, tint2, 0.35), ov, m2)
        d = ImageDraw.Draw(ov)
        # hairline loop (green); only in-frame segments
        pts = [(float(x), float(y)) for x, y in fh
               if 0 <= x < SIZE and 0 <= y < SIZE]
        if len(pts) > 1:
            d.line(pts, fill=(0, 255, 0), width=3)
        d.text((8, 8), f"{view}: RED=cap-fill UNDER-HAIR-scalp  BLUE=silhouette  GREEN=hairline-loop",
               fill=(255, 255, 0))
        ov.save(R / f"diag_{view}.png")
        out.append(ov)
        # per-column cap row extent at cols 399-623 (old box) for the record
        cols = np.clip(px[:, 0].astype(int), 0, SIZE - 1)
        rows = px[:, 1]
        in_old = (cols >= 399) & (cols <= 623)
        print(f"{view}: cap verts in old cols frac={in_old.mean():.3f} "
              f"their rows [{rows[in_old].min():.0f},{rows[in_old].max():.0f}]", flush=True)
    side = Image.new("RGB", (SIZE * 2, SIZE))
    side.paste(out[0], (0, 0))
    side.paste(out[1], (SIZE, 0))
    side.save(R / "diag_overlay.png")
    print("saved diag_overlay.png", flush=True)


if __name__ == "__main__":
    main()
