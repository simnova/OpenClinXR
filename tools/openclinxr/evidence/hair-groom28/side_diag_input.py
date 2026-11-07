#!/usr/bin/env python3
"""hair-groom28 STEP 1c: guides-19 INPUT asymmetry baseline per side.

Per-side drape length, hem height/spread, root spread for BACK non-tuck
guides. If the -x drape is already sparser/shorter/higher in guides-19,
any smoothing + pool-drop tips it over first.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
T2 = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
sys.path.insert(0, str(T2 / "tools/openclinxr/hair-groom/strands"))
import frames as F  # noqa: E402

G19 = T2 / "tools/openclinxr/evidence/hair-groom19/build/guides-19.npz"
Y_EAR = -0.0635
Z_NAPE = 1.51


def dist(a):
    a = np.asarray(a, dtype=np.float64)
    if not a.size:
        return {"n": 0}
    return {"n": int(a.size), "min": round(float(a.min()), 3),
            "mean": round(float(a.mean()), 3),
            "p50": round(float(np.percentile(a, 50)), 3),
            "p90": round(float(np.percentile(a, 90)), 3),
            "max": round(float(a.max()), 3)}


def main():
    d = np.load(str(G19), allow_pickle=True)
    h = np.asarray(d["curves_head"], dtype=np.float64)
    c = np.asarray(d["crown"], dtype=np.float64)
    tuck = np.asarray(d["tuck"]) > 0.5
    w = F.head_to_world(h, c)
    roots = w[:, 0]
    back = (roots[:, 1] < Y_EAR) & (roots[:, 2] > Z_NAPE)
    graph = back & ~tuck
    seg = np.linalg.norm(np.diff(w, axis=1), axis=2)
    total = seg.sum(axis=1) * 1000.0
    hem = w[:, -1]
    out = {}
    for sname, smask in (("posX", roots[:, 0] >= 0.0),
                         ("negX", roots[:, 0] < 0.0)):
        m = graph & smask
        idx = np.nonzero(m)[0]
        out[sname] = {
            "nGuides": int(m.sum()),
            "totalArcMm": dist(total[idx]),
            "hemZ": dist(hem[idx, 2] * 1000.0),
            "hemX": dist(np.abs(hem[idx, 0]) * 1000.0),
            "rootX": dist(np.abs(roots[idx, 0]) * 1000.0),
            "rootZ": dist(roots[idx, 2] * 1000.0),
        }
    (E / "side-diag-input.json").write_text(json.dumps(out, indent=1)
                                            + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
