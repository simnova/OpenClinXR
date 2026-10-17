"""Shell shadow-field differential (CARD tsk_c120564ce449c2b1, grader note).

Per-pixel shell effect: dL* = L*(shell beauty) - L*(no-shell beauty), where
the no-shell pass hides only the occlusion shell/tearline/caruncle meshes
(same GLB, same portrait camera; headBoxPx equality asserted). Positive
darkening reads as shadow. Panels (native-pixel eye band): beauty |
no-shell | darkening false-colour (magenta intensity, mask contoured).

Usage:
  mise exec -C /Volumes/files/src/openclinxr -- python3 \
    tools/openclinxr/asset-pipeline/realism-head/sclera-shade/diff_shell_shadow.py \
    --beauty <beauty.png> --beauty-record <beauty.json> \
    --noshell <noshell.png> --noshell-record <noshell.json> \
    --id <id.png> --out <diag.png>
Prints JSON with headBox deltas, band box, and median dL* over the sclera
mask (overall + uc/lc/ul/ll quadrants) and over the iris disk (control: the
shell must barely touch the pupil).
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--beauty", required=True)
    ap.add_argument("--beauty-record", required=True)
    ap.add_argument("--noshell", required=True)
    ap.add_argument("--noshell-record", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    brec = json.load(open(args.beauty_record))
    nrec = json.load(open(args.noshell_record))
    bb, nb = brec["portrait"]["headBoxPx"], nrec["portrait"]["headBoxPx"]
    deltas = {k: round(abs(bb[k] - nb[k]), 3) for k in bb}
    if any(v > 0.5 for v in deltas.values()):
        raise SystemExit(f"camera mismatch beauty vs noshell: {deltas}")

    beauty = np.array(Image.open(args.beauty).convert("RGB"))
    noshell = np.array(Image.open(args.noshell).convert("RGB"))
    h, w = beauty.shape[:2]
    if noshell.shape[:2] != (h, w):
        raise SystemExit("noshell/beauty size mismatch")
    Lb = srgb_to_lab_l(beauty)
    Ln = srgb_to_lab_l(noshell)
    dL = Lb - Ln  # negative where the shell darkens

    idrgb = np.array(Image.open(args.id).convert("RGB")).astype(int)
    R, G, B = (idrgb[:, :, i] for i in range(3))
    key = (G - R >= KEY_GR_MIN) & (G - B >= KEY_GB_MIN) & (G >= KEY_G_MIN)

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

    allp = np.vstack([e["poly"] for e in infos])
    x0, y0 = allp.min(axis=0)
    x1, y1 = allp.max(axis=0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hw, hh = (x1 - x0) / 2 * 1.5, (y1 - y0) / 2 * 2.2
    bx0, bx1 = max(0, int(cx - hw)), min(w, int(cx + hw))
    by0, by1 = max(0, int(cy - hh)), min(h, int(cy + hh))

    # False-colour darkening: magenta intensity ∝ -dL* (clipped 0..40).
    mag = np.clip(-dL, 0, 40) / 40.0
    false = beauty.copy().astype(np.float64)
    tint = np.array([255, 0, 255], dtype=np.float64)
    false = (1 - mag[..., None]) * false + mag[..., None] * tint
    false = np.clip(false, 0, 255).astype(np.uint8)

    panels = [beauty[by0:by1, bx0:bx1],
              noshell[by0:by1, bx0:bx1],
              false[by0:by1, bx0:bx1]]
    pw = max(p.shape[1] for p in panels)
    normed = [p if p.shape[1] == pw
              else np.pad(p, ((0, 0), (0, pw - p.shape[1]), (0, 0)))
              for p in panels]
    Image.fromarray(np.concatenate(normed, axis=1)).save(args.out)

    quads = {"uc": [], "lc": [], "ul": [], "ll": []}
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
        quads["uc"].append(dL[m & upper & ~canthal])
        quads["lc"].append(dL[m & upper & canthal])
        quads["ul"].append(dL[m & ~upper & ~canthal])
        quads["ll"].append(dL[m & ~upper & canthal])
    summary = {
        "headBoxDelta": deltas,
        "band": [bx0, by0, bx1, by1],
        "bandWidthPx": bx1 - bx0,
        "shellDarkeningDL": {
            "all": round(float(np.median(dL[full_mask])), 2),
            **{k: {"n": int(np.concatenate(v).size),
                   "medianDL": round(float(np.median(np.concatenate(v))), 2)
                   if np.concatenate(v).size else None}
               for k, v in quads.items()},
        },
        "irisControlDL": round(float(np.median(dL[iris_union])), 2),
        "out": os.path.abspath(args.out),
    }
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
