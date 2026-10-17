"""Shell-alpha diagnostic overlay (CARD tsk_c120564ce449c2b1, grader note).

Composites, for one subject+config: the beauty front render, the shell-only
pass (globe hidden; the brown veil over the dark hole reads shell alpha as
intensity), and an overlay (beauty + sclera ID mask tinted magenta). All
panels are native-pixel eye-band crops at identical coordinates (the three
passes share the portrait camera; headBoxPx equality is asserted from the
render JSONs).

Usage:
  mise exec -C /Volumes/files/src/openclinxr -- python3 \
    tools/openclinxr/asset-pipeline/realism-head/sclera-shade/diag_shell_overlay.py \
    --beauty <beauty.png> --beauty-record <beauty.json> \
    --shell <shell-only.png> --shell-record <shell.json> \
    --id <id.png> --out <diag.png>
Prints a JSON line with headBox deltas, band box, and shell-veil luminance
inside each sclera quadrant (uc/lc/ul/ll) vs outside-mask eye surroundings.
"""

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sclera_metrics as sm
from sclera_metrics import (
    ASSIGN_DILATE_PX,
    KEY_G_MIN,
    KEY_GB_MIN,
    KEY_GR_MIN,
    detect_landmarks,
    morph_bool,
    rasterize_polygon,
    srgb_to_lab_l,
)


def load(p):
    return np.array(Image.open(p).convert("RGB"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--beauty", required=True)
    ap.add_argument("--beauty-record", required=True)
    ap.add_argument("--shell", required=True)
    ap.add_argument("--shell-record", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    brec = json.load(open(args.beauty_record))
    srec = json.load(open(args.shell_record))
    bb, sb = brec["portrait"]["headBoxPx"], srec["portrait"]["headBoxPx"]
    deltas = {k: round(abs(bb[k] - sb[k]), 3) for k in bb}
    if any(v > 0.5 for v in deltas.values()):
        raise SystemExit(f"camera mismatch beauty vs shell-only: {deltas}")

    beauty = load(args.beauty)
    shell = load(args.shell)
    h, w = beauty.shape[:2]
    if shell.shape[:2] != (h, w):
        raise SystemExit("shell/beauty size mismatch")
    idrgb = load(args.id).astype(int)
    R, G, B = (idrgb[:, :, i] for i in range(3))
    key = (G - R >= KEY_GR_MIN) & (G - B >= KEY_GB_MIN) & (G >= KEY_G_MIN)

    L = srgb_to_lab_l(beauty)
    pts = detect_landmarks(beauty)
    yy, xx = np.mgrid[0:h, 0:w]
    iris_union = np.zeros((h, w), dtype=bool)
    infos = []
    for contour, (ring, pupil), (co, ci) in (
        (sm.EYE_R, sm.IRIS_R, sm.CORNERS_R),
        (sm.EYE_L, sm.IRIS_L, sm.CORNERS_L),
    ):
        poly = pts[contour]
        centre = pts[pupil]
        rr = pts[ring]
        radius = float(np.max(np.linalg.norm(rr - centre, axis=1)))
        iris = (xx - centre[0]) ** 2 + (yy - centre[1]) ** 2 <= radius**2
        iris_union |= iris
        infos.append({"poly": poly, "centre": centre, "radius": radius,
                      "outer": pts[co], "inner": pts[ci]})
    d0 = np.full((h, w), np.inf)
    owner = np.full((h, w), -1, dtype=np.int8)
    for i, e in enumerate(infos):
        region = morph_bool(rasterize_polygon(beauty.shape, e["poly"]),
                            ASSIGN_DILATE_PX, False)
        dist = np.sqrt((xx - e["centre"][0]) ** 2 + (yy - e["centre"][1]) ** 2)
        closer = region & (dist < d0)
        d0[closer] = dist[closer]
        owner[closer] = i
    masks = [(key & (owner == i) & ~iris_union) for i in range(2)]
    full_mask = masks[0] | masks[1]

    # Eye band: union bbox of both polys, expanded 25%, clamped. Native px.
    allp = np.vstack([e["poly"] for e in infos])
    x0, y0 = allp.min(axis=0)
    x1, y1 = allp.max(axis=0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hw, hh = (x1 - x0) / 2 * 1.5, (y1 - y0) / 2 * 2.2
    bx0, bx1 = max(0, int(cx - hw)), min(w, int(cx + hw))
    by0, by1 = max(0, int(cy - hh)), min(h, int(cy + hh))

    overlay = beauty.copy()
    tint = np.array([255, 0, 255], dtype=np.float64)
    overlay[full_mask] = (0.5 * overlay[full_mask].astype(np.float64)
                           + 0.5 * tint).astype(np.uint8)

    panels = [beauty[by0:by1, bx0:bx1],
              shell[by0:by1, bx0:bx1],
              overlay[by0:by1, bx0:bx1]]
    pw = max(p.shape[1] for p in panels)
    normed = []
    for p in panels:
        if p.shape[1] < pw:
            p = np.pad(p, ((0, 0), (0, pw - p.shape[1]), (0, 0)))
        normed.append(p)
    sheet = np.concatenate(normed, axis=1)
    Image.fromarray(sheet).save(args.out)

    # Numbers: shell-veil luminance (shell-only pass) inside mask quadrants.
    lum = 0.2126 * shell[:, :, 0] + 0.7152 * shell[:, :, 1] + 0.0722 * shell[:, :, 2]
    quad_vals = {"uc": [], "lc": [], "ul": [], "ll": []}
    iris_v_list = []
    for (co, ci), e, m in zip((sm.CORNERS_R, sm.CORNERS_L), infos, masks):
        outer, inner = pts[co], pts[ci]
        axis = inner - outer
        axis_len = float(np.linalg.norm(axis))
        u = axis / axis_len
        n = np.array([-u[1], u[0]])
        v = (xx - outer[0]) * n[0] + (yy - outer[1]) * n[1]
        iv = float((e["centre"] - outer) @ n)
        upper = np.zeros((h, w), dtype=bool)
        upper[m] = (v[m] - iv) < 0
        d_iris = np.sqrt((xx - e["centre"][0]) ** 2
                         + (yy - e["centre"][1]) ** 2)[m] - e["radius"]
        d_cor = np.minimum(
            np.sqrt((xx - outer[0]) ** 2 + (yy - outer[1]) ** 2)[m],
            np.sqrt((xx - inner[0]) ** 2 + (yy - inner[1]) ** 2)[m])
        canthal = np.zeros((h, w), dtype=bool)
        canthal[m] = (d_cor / (0.25 * axis_len)) < (d_iris / (0.5 * e["radius"]))
        quad_vals["uc"].append(lum[m & upper & ~canthal])
        quad_vals["lc"].append(lum[m & upper & canthal])
        quad_vals["ul"].append(lum[m & ~upper & ~canthal])
        quad_vals["ll"].append(lum[m & ~upper & canthal])
        iris_v_list.append(iv)
    surround = lum[(owner >= 0) & ~full_mask & ~iris_union]
    summary = {
        "headBoxDelta": deltas,
        "band": [bx0, by0, bx1, by1],
        "bandWidthPx": bx1 - bx0,
        "veilLuminance": {
            k: {"n": int(np.concatenate(v).size),
                "median": round(float(np.median(np.concatenate(v))), 2)
                if np.concatenate(v).size else None}
            for k, v in quad_vals.items()
        },
        "surroundVeilMedian": round(float(np.median(surround)), 2),
        "out": os.path.abspath(args.out),
    }
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
