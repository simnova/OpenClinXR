"""Part-lift and length probe on a round's strands.npz (no render needed).

    <blender python> standoff.py <round-dir>

Side-silhouette lift, the geometric counterpart of rubric C1: per 2 mm world-y bin,
highest hair point minus highest scalp vertex (+-4 mm bin), median over the bins.
frontPart = y -0.10..-0.04 m (the C1 span); crownCtrl = y 0.00..+0.06 m.
Tip z: median/p10/p90 of strand tips (rubric I7).
"""
import json, sys
import numpy as np
from pathlib import Path

rd = Path(sys.argv[1])
d = np.load(rd / "strands.npz")
P, S, off = d["positions"], d["scalpVerts"], d["offsets"]
tips = P[off[1:] - 1][:, 2]


def lift(y0, y1):
    out = []
    for y in np.arange(y0, y1 + 1e-9, 0.002):
        m, ms = np.abs(P[:, 1] - y) < 0.001, np.abs(S[:, 1] - y) < 0.004
        if m.any() and ms.any():
            out.append(P[m, 2].max() - S[ms, 2].max())
    return float(np.median(out) * 1000)


out = {"frontPartMm": lift(-0.10, -0.04), "crownCtrlMm": lift(0.0, 0.06),
       "tipZ": {"median": float(np.median(tips)), "p10": float(np.percentile(tips, 10)), "p90": float(np.percentile(tips, 90))}}
print("STANDOFF", json.dumps(out))
(rd / "standoff.json").write_text(json.dumps(out, indent=1))
