"""Overlay the 3D hairline loop on the beauty renders (PIL, pure python).

CORRECTION 1: draws the TARGET frontal arc (green, interp lighter), PRIOR
temple (cyan), PRIOR sideburn/nape (amber), departure markers (white rings),
and the part-band span (red dashed verticals on the front tile).
Reads: E/hairline.json, E/render_<view>.png, manifest + cameras (pinned
projection). Writes: E/hairline_overlay.png (front/profile/three_quarter).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

S2 = Path(__file__).resolve().parent
sys.path.insert(0, str(S2))
import common as C

E = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2/tools/openclinxr/evidence/hair-scalp1")

COLORS = {"TARGET-front": (46, 204, 64), "TARGET-interp": (140, 255, 140),
          "PRIOR-temple": (0, 220, 220),
          "PRIOR-sideburn": (255, 170, 0), "PRIOR-nape": (255, 170, 0)}


def project(points, view_rec, sensor):
    lens = float(view_rec["lensMm"])
    f = C.FRAME * lens / float(sensor)
    M = np.array(view_rec["matrixWorld"], dtype=np.float64)
    R = M[:3, :3]
    T = M[:3, 3]
    out = []
    for p in points:
        v = np.array(p, dtype=np.float64) - T
        cam = R.T @ v
        if cam[2] >= 0:
            out.append(None)
            continue
        col = C.FRAME / 2.0 + (cam[0] / -cam[2]) * f
        row = C.FRAME / 2.0 - (cam[1] / -cam[2]) * f
        out.append((col, row))
    return out


def main():
    doc, _ = C.load_manifest()
    cams, _ = C.load_cameras(doc)
    hl = json.loads((E / "hairline.json").read_text())
    sensor = float(cams["sensorWidthMm"])
    d2 = json.loads((E / "hairline_2d.json").read_text())
    tiles = []
    for view in ("front", "profile_90", "three_quarter"):
        img = Image.open(E / ("render_%s.png" % view)).convert("RGB")
        W, H = img.size
        proj = project(hl["loop"]["points"], cams["views"][view], sensor)
        src = hl["loop"]["source"]
        vis = hl["loop"]["visible"][view]
        dr = ImageDraw.Draw(img)
        for (pp, s, v) in zip(proj, src, vis):
            if pp is None or not v:
                continue
            x, y = pp[0] * W / C.FRAME, pp[1] * H / C.FRAME
            if 0 <= x < W and 0 <= y < H:
                r = 3 if s == "TARGET-interp" else 2
                dr.ellipse([x - r, y - r, x + r, y + r], fill=COLORS.get(s, (255, 0, 0)))
        if view == "front":
            # departure markers: re-project the departure 3D loop ends is
            # ambiguous; mark the 2D departure pixels mapped to the render frame
            for key in ("departureL", "departureR"):
                mk = hl["markers"][key]
                col_r, row_r = C.target_to_render(
                    mk["col"], mk["row"], "front", cams, C.load_register())
                x, y = col_r * W / C.FRAME, row_r * H / C.FRAME
                dr.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(255, 255, 255), width=2)
            # part band span
            for cc in d2["part"]["bandCols"]:
                col_r, _ = C.target_to_render(cc, 200, "front", cams, C.load_register())
                x = col_r * W / C.FRAME
                dr.line([(x, 0), (x, H)], fill=(255, 60, 60), width=1)
        dr.text((8, 8), view, fill=(255, 255, 255))
        tiles.append(img)
    sheet = Image.new("RGB", (tiles[0].width * 3, tiles[0].height), (20, 20, 20))
    for i, t in enumerate(tiles):
        sheet.paste(t, (i * t.width, 0))
    sheet.save(E / "hairline_overlay.png")
    C.write_opened(E / "inputs-opened.txt")
    print("OVERLAY_DONE")


if __name__ == "__main__":
    main()
