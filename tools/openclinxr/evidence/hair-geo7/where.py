#!/usr/bin/env python3
"""STEP 1 (hair-geo7): WHERE does the strand-direction error live?

Reads score.py's orientation machinery (hair-score/orientation.py) but adds a
spatial grid: per view, signed mean angle difference (ours - target, wrapped
to [-90,90)) plus both histograms, in cells:
  profile_90 / three_quarter : 6 rows crown->hem x 3 cols front/mid/back
  back                       : 6 rows x 3 cols left/centre/right (image px)
  front                      : 6 rows x 2 cols (left/right curtains, image px)
Plus per-height-band tangent angles: our 3D strands/guides vs the 2D
orientation maps (render + target) per row band.

Render inputs are the CURRENT groom + CURRENT material: hair-look7/best
(a1 strands rendered with look7 best-params). No Blender needed; the judge's
register_view math is replicated by orientation.register_view_local
(identical math, per module docstring).

Convention (calibrated below with synthetic ridges): slant s>0 means the
strand top leans toward image +x ("/"-leaning). Anatomy per view:
  back    : image +x = subject-left? NO -- measured below from landmarks:
            ear_front_L(+x world) projects image-LEFT, so image +x = -x
            world = subject-RIGHT. s>0 = top leans subject-right.
  profile : camera at +x, image +x = world +y = backward. s>0 = slanted backward.
  3q      : camera at (+x,-y), image +x ~= (+x+y). s>0 leans +x/+y mix.
  front   : camera at -y (mirror): image +x = world -x = subject-right.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
E = HERE
sys.path.insert(0, str(ROOT / "tools/openclinxr/evidence/hair-score"))
import orientation as O  # noqa: E402

RENDER_DIR = ROOT / "tools/openclinxr/evidence/hair-look7/best"
TARGET_DIR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
JUDGE_MASKS = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back")
GUIDES = ROOT / "tools/openclinxr/evidence/hair-look1/guides16.npz"
A1 = ROOT / "tools/openclinxr/evidence/hair-real1/cells/a1/strands.npz"
VIEWS = ("front", "three_quarter", "profile_90", "back")
TARGET_IMG = {"front": "target-front.png", "three_quarter": "target-three_quarter.png",
              "profile_90": "target-profile.png", "back": "target-back.png"}
TARGET_MSK = {"front": "mask-front-v2.png", "three_quarter": "mask-three_quarter.png",
              "profile_90": "mask-profile-v2.png", "back": "mask-back-v3.png"}


def rgb(p: Path) -> np.ndarray:
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float64) / 255.0


def mask_render(p: Path) -> np.ndarray:
    return np.asarray(Image.open(p).convert("RGBA"), dtype=np.uint8)[..., 3] >= 230


def mask_target(p: Path) -> np.ndarray:
    im = Image.open(p)
    if im.mode == "RGBA":
        m = np.asarray(im)[..., 3] >= 230
    else:
        m = np.asarray(im.convert("L")) > 127
    if m.shape != (1024, 1024):
        m = np.asarray(Image.fromarray((m.astype(np.uint8)) * 255).resize(
            (1024, 1024), Image.NEAREST)) > 127
    return m


def wrap90(d: np.ndarray) -> np.ndarray:
    return ((np.asarray(d, dtype=np.float64) + 90.0) % 180.0) - 90.0


def slant(a: np.ndarray, a_vert: float) -> np.ndarray:
    """Signed slant from vertical, deg, in [-90,90). s>0 = top toward image +x."""
    return wrap90(a.astype(np.float64) - a_vert)


def calibrate_frame() -> tuple[float, float]:
    """Find the Gabor angle of a truly vertical ridge + sign of a known lean."""
    H = W = 256
    xx = np.arange(W, dtype=np.float32)
    vert = (np.sin(2 * np.pi * xx / 4.0)[None, :].repeat(H, axis=0) * 0.5 + 0.5)
    a_v, c_v = O.orientation_map(vert.astype(np.float64))
    a_vert = float(np.median(a_v[100:156, 100:156]))
    # Ridge leaning top-toward-+x by 20 deg: brightness varies along the
    # perpendicular direction n = (cos20, sin20) in (x, y-down) coords.
    t = np.deg2rad(20.0)
    nx, ny = np.cos(t), np.sin(t)
    X, Y = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    lean = (np.sin(2 * np.pi * (X * nx + Y * ny) / 4.0) * 0.5 + 0.5)
    a_l, _ = O.orientation_map(lean.astype(np.float64))
    s = float(np.median(wrap90(a_l[100:156, 100:156].astype(float) - a_vert)))
    return a_vert, s


def grid_cells(view: str, h: int, w: int):
    """Yield (label, y0,y1,x0,x1). Rows top(crown)->bottom(hem)."""
    if view == "front":
        cols = [("curtain_image_left", 0.0, 0.5), ("curtain_image_right", 0.5, 1.0)]
    elif view == "back":
        cols = [("left", 0.0, 1 / 3), ("centre", 1 / 3, 2 / 3), ("right", 2 / 3, 1.0)]
    else:  # profile_90, three_quarter: image-left = face-front
        cols = [("front", 0.0, 1 / 3), ("mid", 1 / 3, 2 / 3), ("back", 2 / 3, 1.0)]
    for r in range(6):
        for name, c0, c1 in cols:
            yield (f"row{r}_{name}", int(r * h / 6), int((r + 1) * h / 6),
                   int(c0 * w), int(min(w, max(c1 * w, c0 * w + 1))))


def main() -> None:
    render_tag = sys.argv[1] if len(sys.argv) > 1 else None
    out_name = sys.argv[2] if len(sys.argv) > 2 else "where.json"
    global RENDER_DIR
    if render_tag:
        RENDER_DIR = E / "cells" / render_tag / "score"
    a_vert, lean_sign = calibrate_frame()
    print(f"CALIB a_vert={a_vert:.2f} known_top_to_+x20deg_reads={lean_sign:+.2f}", flush=True)
    assert lean_sign > 10.0, "sign calibration failed"

    rtriples = {"front": (103.0, 583.0, 512.0), "three_quarter": None,
                "profile_90": (131.0, 561.0, 209.0), "back": (155.0, 651.0, 512.0)}
    ttriples = O.target_triples()
    doc: dict = {"conventions": {
        "slant_gt0": "strand top leans toward image +x",
        "back_image+x": "world -x = subject-right (ear_front_L/+x projects image-left per landmarks)",
        "profile_image+x": "world +y = backward; s>0 = slanted backward",
        "three_quarter_image+x": "~world(+x+y); image-left = face-front, image-right = back of head",
        "front_view": "mirror: image +x = world -x = subject-right",
        "rows": "row0 = crown/top of hair bbox, row5 = hem/bottom",
        "signedDiff": "wrap90(ours - target), confidence-product-weighted mean",
        "gaborFrameVerticalDeg": round(a_vert, 2)},
        "views": {}}

    for view in VIEWS:
        rb, rm = rgb(RENDER_DIR / f"{view}.png"), mask_render(RENDER_DIR / f"{view}-id.png")
        tb, tm = rgb(TARGET_DIR / TARGET_IMG[view]), mask_target(JUDGE_MASKS / TARGET_MSK[view])
        rt, tt = rtriples[view], ttriples[view]
        if rt is None or tt is None:
            m_o, b_o = rm.copy(), rb.copy()
        else:
            m_o, b_o, _ = O.register_view_local(rm, rb, rt[0], rt[1], rt[2], tt[0], tt[1], tt[2])
        g_r, m_r, g_t, m_t, inter = O.crop_to_inter(O.luminance(b_o), m_o, O.luminance(tb), tm)
        a_r, c_r = O.orientation_map(g_r)
        a_t, c_t = O.orientation_map(g_t)
        diff = wrap90(a_r.astype(float) - a_t.astype(float))
        w = (c_r.astype(float) * c_t.astype(float))
        h, wd = inter.shape
        s_r, s_t = slant(a_r, a_vert), slant(a_t, a_vert)
        cells = []
        for label, y0, y1, x0, x1 in grid_cells(view, h, wd):
            sel = np.zeros_like(inter)
            sel[y0:y1, x0:x1] = True
            m = inter & sel
            px = int(m.sum())
            if px == 0:
                cells.append({"cell": label, "pixels": 0})
                continue
            ww = w[m]
            cells.append({
                "cell": label, "pixels": px,
                "signedMeanDiffDeg": round(float((ww * diff[m]).sum() / max(ww.sum(), 1e-12)), 2),
                "meanAbsDiffDeg": round(float(np.abs(diff[m]).mean()), 2),
                "meanSlantOursDeg": round(float(s_r[m].mean()), 2),
                "meanSlantTargetDeg": round(float(s_t[m].mean()), 2),
                "histOurs": [round(float(v), 4) for v in O.orientation_histogram(a_r, c_r, m)],
                "histTarget": [round(float(v), 4) for v in O.orientation_histogram(a_t, c_t, m)],
            })
        ww_all = w[inter]
        doc["views"][view] = {
            "pixels": int(inter.sum()),
            "overallSignedDiffDeg": round(float((ww_all * diff[inter]).sum() / max(ww_all.sum(), 1e-12)), 2),
            "overallMeanAbsDiffDeg": round(float(np.abs(diff[inter]).mean()), 2),
            "overallMeanSlantOursDeg": round(float(s_r[inter].mean()), 2),
            "overallMeanSlantTargetDeg": round(float(s_t[inter].mean()), 2),
            "cells": cells,
        }
        print(f"VIEW {view}: px={inter.sum()} signed={doc['views'][view]['overallSignedDiffDeg']:+.2f} "
              f"abs={doc['views'][view]['overallMeanAbsDiffDeg']:.2f} "
              f"slantOurs={doc['views'][view]['overallMeanSlantOursDeg']:+.2f} "
              f"slantTgt={doc['views'][view]['overallMeanSlantTargetDeg']:+.2f}", flush=True)

    # --- 3D strand tangents per height band (ours) vs 2D row bands (maps) ---
    gd = np.load(GUIDES)
    guides = np.asarray(gd["points"], float)  # (576,32,3)
    zmin, zmax = float(guides[..., 2].min()), float(guides[..., 2].max())
    edges = np.linspace(zmin, zmax, 7)  # band0 = crown(top) .. band5 = hem
    guide_bands = []
    for b in range(6):
        mid = guides[:, 1:, :]  # segment midpoints
        zm = mid[..., 2]
        # band b=0 is top: z in [edges[5],edges[6]]
        lo, hi = edges[5 - b], edges[6 - b]
        sel = (zm >= lo) & (zm <= hi)
        tan = np.diff(guides, axis=1)
        t = tan[sel]
        n = t / np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-12)
        down = -n[:, 2]
        guide_bands.append({
            "band": f"zband{b}_crown_to_hem", "zRange": [round(lo, 4), round(hi, 4)],
            "segments": int(sel.sum()),
            "meanAngleFromVerticalDeg": round(float(np.degrees(np.arctan2(
                np.linalg.norm(n[:, :2], axis=1), np.clip(down, 1e-9, None))).mean()), 2),
            "meanSlantBackDeg": round(float(np.degrees(np.arctan2(n[:, 1], np.clip(down, 1e-9, None))).mean()), 2),
            "meanSlantLeftDeg": round(float(np.degrees(np.arctan2(n[:, 0], np.clip(down, 1e-9, None))).mean()), 2),
        })
    doc["guideTangents3D"] = guide_bands

    # 2D row-band slants from the maps already computed? Recompute cheaply per
    # view from stored cells: average row{r}_* means weighted by pixels.
    rowbands = {}
    for view in VIEWS:
        rows = []
        for r in range(6):
            members = [c for c in doc["views"][view]["cells"] if c.get("pixels") and c["cell"].startswith(f"row{r}_")]
            px = sum(c["pixels"] for c in members)
            if not px:
                rows.append({"row": r, "pixels": 0})
                continue
            rows.append({"row": r, "pixels": px,
                         "meanSlantOursDeg": round(sum(c["meanSlantOursDeg"] * c["pixels"] for c in members) / px, 2),
                         "meanSlantTargetDeg": round(sum(c["meanSlantTargetDeg"] * c["pixels"] for c in members) / px, 2),
                         "signedMeanDiffDeg": round(sum(c["signedMeanDiffDeg"] * c["pixels"] for c in members) / px, 2)})
        rowbands[view] = rows
    doc["rowBands2D"] = rowbands

    (E / out_name).write_text(json.dumps(doc, indent=2) + "\n")
    print("WROTE", E / out_name, flush=True)


if __name__ == "__main__":
    main()
