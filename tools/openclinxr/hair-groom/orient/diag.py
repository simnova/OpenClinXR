#!/usr/bin/env python3
"""Diagnostic: project grown guides over target thumbs + field quiver.

E/diag-guides.png (4 views: target thumb + guide polylines) and
E/diag-field.png (coronal/sagittal field slices as quiver over hull
occupancy). Used to steer growth fixes; rerun after each change.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

S10 = Path(__file__).resolve().parent
sys.path.insert(0, str(S10))
import common_o as CO  # noqa: E402


def main():
    from PIL import Image, ImageDraw
    CO.track(S10 / "diag.py")
    inp = CO.load_all()
    G = np.load(str(CO.E0 / "grown.npz"))
    curves = [np.array(G["curves_mm"][j])
              for j in range(len(G["roots_mm"]))]
    curves = [c[np.isfinite(c).all(axis=1)] for c in curves]
    stops = [str(s) for s in G["stops"]]
    cols = []
    for view in CO.VIEWS4:
        thumb = (np.clip(inp["targets"][view], 0, 1) * 255).astype(
            np.uint8).copy()
        img = Image.fromarray(thumb).resize((512, 512))
        dr = ImageDraw.Draw(img)
        cam = inp["cams"]["views"][view]
        for c in curves[::2]:
            pts = c / 1000.0
            cc, rr, _ = CO.C2.ENV.project_to_render(pts, cam,
                                                   inp["sensor"])
            cc = cc / 2
            rr = rr / 2
            m = (cc >= 0) & (cc < 512) & (rr >= 0) & (rr < 512)
            if m.sum() > 1:
                dr.line(list(zip(cc[m], rr[m])), fill=(255, 255, 0),
                        width=1)
        cols.append(np.asarray(img))
    fig = np.hstack(cols)
    Image.fromarray(fig).save(CO.E0 / "diag-guides.png")
    print("WROTE diag-guides.png stops hem=%d maxlen=%d stuck=%d "
          "noentry=%d" % (stops.count("hem"), stops.count("maxlen"),
                          stops.count("stuck"), stops.count("noentry")),
          flush=True)

    F = np.load(str(CO.E0 / "field.npz"))
    idx = np.array(F["idx"])
    dd = np.array(F["dir"])
    xs, ys, zs = (np.array(F["xs"]), np.array(F["ys"]),
                  np.array(F["zs"]))
    hull = inp["hull"]
    occ = np.array(hull["occupancy"], dtype=bool)
    n = np.array(F["nviews"])
    panels = []
    # coronal slices (x-z plane) at several y + sagittal (y-z) at x~0
    for ax, fixed, vals, lab in (
            (1, ys, [-140, -60, 20, 100], "coronal"),
            (0, xs, [-60, -20, 0, 20, 60], "sagittal")):
        for v in vals:
            k = int(np.argmin(abs(fixed - v)))
            sel = idx[:, 0 if ax == 1 else 1] == k if False else None
            m = idx[:, ax] == k
            grid = np.zeros((occ.shape[2], occ.shape[0], 3),
                            np.uint8) if ax == 1 else np.zeros(
                (occ.shape[2], occ.shape[1], 3), np.uint8)
            if ax == 1:
                grid[occ[:, k, :].T] = (60, 60, 60)
            else:
                grid[occ[k, :, :].T] = (60, 60, 60)
            im = Image.fromarray(grid).resize((320, 320))
            dr = ImageDraw.Draw(im)
            sx = (occ.shape[0] if ax == 1 else occ.shape[1]) / 320
            sz = occ.shape[2] / 320
            ii = np.nonzero(m)[0][::37]
            for j in ii:
                a, b, c = (int(idx[j, 0]), int(idx[j, 1]),
                           int(idx[j, 2]))
                vv = dd[j] * (1.0 if n[j] >= 2 else 0.4)
                if ax == 1:  # coronal: x horizontal, z vertical(up)
                    x0, y0 = a / sx, 320 - c / sz
                    x1, y1 = (a + vv[0] * 8) / sx, 320 - (
                        c + vv[2] * 8) / sz
                else:  # sagittal: y horizontal, z vertical
                    x0, y0 = b / sx, 320 - c / sz
                    x1, y1 = (b + vv[1] * 8) / sx, 320 - (
                        c + vv[2] * 8) / sz
                dr.line([x0, y0, x1, y1],
                        fill=(0, 255, 0) if n[j] >= 2 else (255, 0, 0))
            panels.append((lab + " " + str(v), np.asarray(im)))
    H = max(p.shape[0] for _, p in panels)
    W = sum(p.shape[1] for _, p in panels)
    fig2 = np.zeros((H + 20, W, 3), np.uint8)
    x = 0
    for lab, p in panels:
        fig2[20:20 + p.shape[0], x:x + p.shape[1]] = p
        x += p.shape[1]
    Image.fromarray(fig2).save(CO.E0 / "diag-field.png")
    print("WROTE diag-field.png", flush=True)
    CO.write_inputs_log([S10 / "diag.py"])


if __name__ == "__main__":
    main()
