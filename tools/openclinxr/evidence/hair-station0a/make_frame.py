#!/usr/bin/env python3
"""Evidence-only figure: warped target masks overlaid on station renders.

For front/profile_90/back the pinned 1024 target mask is inverse-warped
through the station registration into the 512 render frame and overlaid
in red; render-triple markers are yellow, mapped target-triple markers
cyan. three_quarter/crown_top have no target triple: render only.
Writes frame.png and frame-stats.json (incl. per-render distinct-colour
counts proving the Workbench per-object colours).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
RUN = Path("/tmp/station0a-run-a")
BAR = 28


def warp_target_into_render(mask, s, tx, ty, size=512):
    """Nearest-sample the 1024 target mask at each render pixel via inverse map."""
    grid = np.arange(size, dtype=np.float64)
    x_t = np.round(s * (2 * grid) + tx).astype(int)
    y_t = np.round(s * (2 * grid) + ty).astype(int)
    h, w = mask.shape
    ok_x = (x_t >= 0) & (x_t < w)
    ok_y = (y_t >= 0) & (y_t < h)
    out = np.zeros((size, size), dtype=bool)
    out[np.ix_(ok_y, ok_x)] = mask[y_t[ok_y]][:, x_t[ok_x]]
    return out


def cross(draw, x, y, color):
    x, y = int(round(x)), int(round(y))
    draw.line([(x - 6, y), (x + 6, y)], fill=color, width=2)
    draw.line([(x, y - 6), (x, y + 6)], fill=color, width=2)


def distinct_colors(path):
    small = np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8)
    q = (small // 8).reshape(-1, 3)
    return int(len(set(map(tuple, q[::7].tolist()))))


def main():
    registration = json.loads((RUN / "registration.json").read_text())
    manifest = json.loads((RUN / "run-record.json").read_text())
    views = manifest["views"]
    panels, stats = [], {}
    for view in views:
        render = Image.open(RUN / ("%s.png" % view)).convert("RGB")
        assert render.size == (512, 512), render.size
        stats[view] = {"distinctColorsQ8": distinct_colors(RUN / ("%s.png" % view))}
        entry = registration["views"][view]
        label = view
        if entry.get("status") == "NO_TRIPLE":
            label += " NO_TRIPLE"
        else:
            mask_path = manifest["targets"]["masks"][view]["path"]
            mask = np.asarray(Image.open(mask_path).convert("L")) > 127
            t = entry["transform"]
            warped = warp_target_into_render(mask, t["scale"], t["tx"], t["ty"])
            stats[view]["warpedTargetPx"] = int(warped.sum())
            base = np.asarray(render).astype(float)
            base[warped] = 0.55 * base[warped] + 0.45 * np.array([255.0, 40.0, 40.0])
            render = Image.fromarray(base.astype(np.uint8))
            a_r, b_r, c_r = entry["renderTriple"]
            a_t, b_t, c_t = entry["targetTriple"]
            s, tx, ty = t["scale"], t["tx"], t["ty"]
            draw = ImageDraw.Draw(render)
            for row, col in ((a_r, c_r), (b_r, c_r)):
                cross(draw, col / 2.0, row / 2.0, (255, 255, 0))
            for row, col in ((a_t, c_t), (b_t, c_t)):
                cross(draw, ((col - tx) / s) / 2.0, ((row - ty) / s) / 2.0, (0, 255, 255))
            label += " s=%.3f" % s
        panel = Image.new("RGB", (512, 512 + BAR), (16, 16, 16))
        panel.paste(render, (0, BAR))
        ImageDraw.Draw(panel).text((8, 7), label, fill=(255, 255, 255))
        panels.append(panel)
    frame = Image.new("RGB", (512 * len(panels), 512 + BAR), (0, 0, 0))
    for i, panel in enumerate(panels):
        frame.paste(panel, (512 * i, 0))
    frame.save(E / "frame.png")
    stats["panelOrder"] = views
    stats["note"] = "red = pinned target mask warped into render frame; yellow = render triple; cyan = mapped target triple"
    (E / "frame-stats.json").write_text(json.dumps(stats, indent=2, sort_keys=True) + "\n")
    print("FRAME", E / "frame.png", frame.size)
    for view in views:
        print("  %s" % view, stats[view])


if __name__ == "__main__":
    main()
