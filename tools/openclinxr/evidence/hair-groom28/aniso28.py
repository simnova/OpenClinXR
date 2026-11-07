#!/usr/bin/env python3
"""hair-groom28 STEP 5: gradient-anisotropy radius controls.

gy/gx in the back-knot box at Gaussian sigma 2 and 4 for groom12-8a
strands rendered at strand radius x0.5 / x1.0 (existing groom12
renders-studio-8a) / x2.0. Registration + box identical to grad26
(diag23 judge-v6 + orientation register_view_local). Sigma loop is the
only deviation from _aniso_darkstats verbatim.

Writes E/metrics-aniso28.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
import cv2 as cv

E = Path(__file__).resolve().parent
T2 = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
sys.path.insert(0, str(T2 / "tools/openclinxr/evidence/hair-groom23diag"))
sys.path.insert(0, str(T2 / "tools/openclinxr/evidence/hair-score"))

import diag23 as D  # noqa: E402
import orientation as ORI  # noqa: E402

RENDERS = {
    "r05": E / "renders-aniso-r05",
    "r10": T2 / "tools/openclinxr/evidence/hair-groom12/renders-studio-8a",
    "r20": E / "renders-aniso-r20",
}


def aniso_sigma(gbox, H, sigma):
    g2 = cv.GaussianBlur(np.asarray(gbox, dtype=np.float32), (0, 0), sigma)
    gx = cv.Sobel(g2, cv.CV_32F, 1, 0, ksize=3)
    gy = cv.Sobel(g2, cv.CV_32F, 0, 1, ksize=3)
    if not H.any():
        return None
    return float(np.abs(gy[H]).mean() / max(np.abs(gx[H]).mean(), 1e-9))


def main():
    tr = D.reg_transform_back()
    t0b, t1b, c0b, c1b = D.map_box_to_target(D.BOX, tr)
    tm = ORI.load_beauty_mask(
        str(D.SCR / "target-back.png"),
        str(D.SCR / "mask-back.png"))[1]
    out = {"box": "groom10diag back-knot rows 150-420 cols 512-765 "
                  "render->target judge-v6",
           "targetBox": [t0b, t1b, c0b, c1b]}
    for tag, rdir in RENDERS.items():
        rb, rm = ORI.load_beauty_mask(str(rdir / "back.png"),
                                      str(rdir / "back-id.png"))
        rt = ORI.RENDER_TRIPLES["back"]
        tt = ORI.target_triples()["back"]
        m_o, b_o, _ = ORI.register_view_local(rm, rb, rt[0], rt[1], rt[2],
                                              tt[0], tt[1], tt[2])
        H = m_o[t0b:t1b, c0b:c1b] & tm[t0b:t1b, c0b:c1b]
        gbox = (0.2126 * np.clip(b_o, 0, 1)[..., 0]
                + 0.7152 * np.clip(b_o, 0, 1)[..., 1]
                + 0.0722 * np.clip(b_o, 0, 1)[..., 2])[t0b:t1b, c0b:c1b]
        row = {("sigma%d" % s): round(aniso_sigma(gbox, H, float(s)), 4)
               for s in (2, 4)}
        row["nHairPx"] = int(H.sum())
        row["renderSha"] = D.sha_of(rdir / "back.png")
        out[tag] = row
        print(tag, row, flush=True)
    (E / "metrics-aniso28.json").write_text(json.dumps(out, indent=1)
                                            + "\n")
    print("WROTE E/metrics-aniso28.json")


if __name__ == "__main__":
    main()
