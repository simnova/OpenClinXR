#!/usr/bin/env python3
"""hair-groom29: gradAniso at sigma 2 AND 4 (diag23 step-B _aniso_darkstats
generalised) in the back-knot box for target + ctrl(25) + groom19 +
groom26 + groom29 back renders.

groom28 measured (E/metrics-aniso28.json): at the gate metric's sigma 2,
gy/gx moves 0.063 over a 4x strand-radius change (reads fineness); at
sigma 4 the movement is 0.037 (reads locks, not fineness). Gate: sigma-4
gradAniso <= groom19-family midpoint (target+ctrl)/2 at sigma 4; sigma 2
reported with the strand radii. Writes E/metrics-grad29.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2 as _cv
import numpy as np
from PIL import Image

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(E.parent / "hair-groom23diag"))
sys.path.insert(0, str(ROOT / "tools/openclinxr/evidence/hair-score"))

import diag23 as D  # noqa: E402
import orientation as ORI  # noqa: E402

E25 = E.parent / "hair-groom25"
E26 = E.parent / "hair-groom26"
E19 = E.parent / "hair-groom19"
RENDERS = {
    "ctrl": E25 / "renders-ctrl",
    "groom19": E19 / "renders-studio",
    "groom26": E26 / "renders-26",
    "groom29": E / "renders-29",
}
SIGMAS = (2.0, 4.0)


def aniso_darkstats_sigma(gbox, H, sigma):
    """D._aniso_darkstats verbatim, blur sigma parameterised."""
    g2 = _cv.GaussianBlur(np.asarray(gbox, dtype=np.float32), (0, 0), sigma)
    _gx = _cv.Sobel(g2, _cv.CV_32F, 1, 0, ksize=3)
    _gy = _cv.Sobel(g2, _cv.CV_32F, 0, 1, ksize=3)
    aniso = float(np.abs(_gy[H]).mean() / max(np.abs(_gx[H]).mean(), 1e-9)) \
        if H.any() else None
    vals = np.asarray(gbox, dtype=np.float64)[H]
    if vals.size:
        p10 = float(np.percentile(vals, 10))
        dark = np.logical_and(H, np.asarray(gbox, dtype=np.float64) <= p10
                              ).astype(np.uint8)
        n, _, st, _ = _cv.connectedComponentsWithStats(dark, 8, _cv.CV_32S)
        ar = st[1:, _cv.CC_STAT_AREA] if n > 1 else np.array([0])
        big = ar[ar >= 500]
    else:
        p10, ar, big = 0.0, np.array([0]), np.array([0])
    return {"gradAniso_gyOvergx": round(aniso, 4) if aniso is not None else None,
            "darkComp_meanAreaPx": round(float(ar.mean()), 2),
            "darkComp_count": int(len(ar)),
            "darkComp_bigFrac": round(float(big.sum() / max(int(H.sum()), 1)), 4),
            "darkComp_p10": round(p10, 4)}


def main():
    tr = D.reg_transform_back()
    t0b, t1b, c0b, c1b = D.map_box_to_target(D.BOX, tr)
    tb, tm = ORI.load_beauty_mask(
        str(D.SCR / "target-back.png"), str(D.SCR / "mask-back.png"))
    gray_t = D.gray_of(tb)
    Ht = tm[t0b:t1b, c0b:c1b]
    out = {"registration": tr, "targetBox": [t0b, t1b, c0b, c1b],
           "boxNote": "groom10diag back-knot box rows 150-420 cols 512-765 "
                      "mapped render->target with scorer judge-v6",
           "sigmas": list(SIGMAS),
           "strandRadiiMm": {"root": 0.05, "tip": 0.015,
                             "note": "interp_children defaults "
                                     "R_ROOT_M=5e-5 R_TIP_M=1.5e-5, "
                                     "linear in t^1.5 (build.json radiiMm)"}}
    out["target"] = {str(s): aniso_darkstats_sigma(
        gray_t[t0b:t1b, c0b:c1b], Ht, s) for s in SIGMAS}
    out["target"]["nHairPx"] = int(Ht.sum())
    for g, rdir in RENDERS.items():
        rb, rm = ORI.load_beauty_mask(str(rdir / "back.png"),
                                      str(rdir / "back-id.png"))
        rt = ORI.RENDER_TRIPLES["back"]
        tt = ORI.target_triples()["back"]
        m_o, b_o, _ = ORI.register_view_local(
            rm, rb, rt[0], rt[1], rt[2], tt[0], tt[1], tt[2])
        H = m_o[t0b:t1b, c0b:c1b] & tm[t0b:t1b, c0b:c1b]
        gbox = (0.2126 * np.clip(b_o, 0, 1)[..., 0]
                + 0.7152 * np.clip(b_o, 0, 1)[..., 1]
                + 0.0722 * np.clip(b_o, 0, 1)[..., 2])[t0b:t1b, c0b:c1b]
        st = {str(s): aniso_darkstats_sigma(gbox, H, s) for s in SIGMAS}
        st["nHairPx"] = int(H.sum())
        st["renderSha"] = D.sha_of(rdir / "back.png")
        out[g] = st
        print("gradAniso %s s2=%.4f s4=%.4f nHair=%d"
              % (g, st["2.0"]["gradAniso_gyOvergx"],
                 st["4.0"]["gradAniso_gyOvergx"], st["nHairPx"]), flush=True)
    (E / "metrics-grad29.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE E/metrics-grad29.json")


if __name__ == "__main__":
    main()
