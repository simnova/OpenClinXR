#!/usr/bin/env python3
"""hair-groom27: gradAniso (diag23 step-B _aniso_darkstats verbatim) in the
back-knot box for target + ctrl(25) + 26 + 27 back renders.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(E.parent / "hair-groom23diag"))
sys.path.insert(0, str(ROOT / "tools/openclinxr/evidence/hair-score"))

import diag23 as D  # noqa: E402
import orientation as ORI  # noqa: E402

E25 = E.parent / "hair-groom25"
RENDERS = {
    "ctrl": E25 / "renders-ctrl",
    "opt29": E.parent / "hair-groom29/renders-29",
    "opt30": E / "renders-30",
}


def main():
    tr = D.reg_transform_back()
    t0b, t1b, c0b, c1b = D.map_box_to_target(D.BOX, tr)
    tb, tm = ORI.load_beauty_mask(
        str(D.SCR / "target-back.png"), str(D.SCR / "mask-back.png"))
    gray_t = D.gray_of(tb)
    Ht = tm[t0b:t1b, c0b:c1b]
    out = {"registration": tr, "targetBox": [t0b, t1b, c0b, c1b],
           "boxNote": "groom10diag back-knot box rows 150-420 cols 512-765 "
                      "mapped render->target with scorer judge-v6"}
    out["target"] = D._aniso_darkstats(
        gray_t[t0b:t1b, c0b:c1b], Ht)
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
        st = D._aniso_darkstats(gbox, H)
        st["nHairPx"] = int(H.sum())
        st["renderSha"] = D.sha_of(rdir / "back.png")
        out[g] = st
        print("gradAniso %s gy/gx=%.4f nHair=%d"
              % (g, st["gradAniso_gyOvergx"], st["nHairPx"]), flush=True)
    (E / "metrics-grad30.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE E/metrics-grad30.json")


if __name__ == "__main__":
    main()
