#!/usr/bin/env python3
"""hair-groom28 STEP 1d: children-level cover check (no render).

Compares strands-ctrl vs strands-25b sample density per side in the
lower-back drape region, to locate the guide->child cover break.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
STORE25 = Path("/Volumes/files/openclinxr-assets/store/hair-groom25")
Y_EAR = -0.0635


def load(name):
    d = np.load(str(STORE25 / name), allow_pickle=True)
    return np.asarray(d["points"], dtype=np.float64)


def main():
    out = {}
    for tag in ("strands-ctrl.npz", "strands-25b.npz"):
        p = load(tag)  # metres? check scale via roots z
        out[tag] = {"p50z": round(float(np.median(p[..., 2])), 4)}
    print(json.dumps(out, indent=1))
    pc = load("strands-ctrl.npz")
    p5 = load("strands-25b.npz")
    print("ctrl range x", float(pc[..., 0].min()), float(pc[..., 0].max()),
          "z", float(pc[..., 2].min()), float(pc[..., 2].max()))
    res = {}
    for name, p in (("ctrl", pc), ("b25", p5)):
        s = {}
        # drape column: posterior (y<Y_EAR), below z 1.55, |x|<0.12
        col = ((p[..., 1] < Y_EAR) & (p[..., 2] < 1.55)
               & (np.abs(p[..., 0]) < 0.12))
        for side, m in (("posX", p[..., 0] >= 0.0),
                        ("negX", p[..., 0] < 0.0)):
            sel = col & m
            slow = sel & (p[..., 2] < 1.40)  # bottom band
            smid = sel & (p[..., 2] >= 1.40)  # mid band
            s[side] = {"nCol": int(sel.sum()),
                       "nMid": int(smid.sum()), "nBot": int(slow.sum())}
        res[name] = s
    res["delta_b25_minus_ctrl"] = {
        side: {k: res["b25"][side][k] - res["ctrl"][side][k]
               for k in ("nCol", "nMid", "nBot")} for side in ("posX", "negX")}
    (E / "side-diag-children.json").write_text(json.dumps(res, indent=1)
                                               + "\n")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
