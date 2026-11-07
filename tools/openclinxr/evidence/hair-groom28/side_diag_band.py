#!/usr/bin/env python3
"""hair-groom28 STEP 1b: arc-banded fairing-delta direction per side.

Mean delta(x,y,z) per side in arc-fraction bands + hem-sample delta
component distributions. Reads hair-tgt2 guides (read-only).
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
G25B = T2 / "tools/openclinxr/evidence/hair-groom25/build-25b/guides-25b.npz"
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
    d19 = np.load(str(G19), allow_pickle=True)
    d25 = np.load(str(G25B), allow_pickle=True)
    h19 = np.asarray(d19["curves_head"], dtype=np.float64)
    c19 = np.asarray(d19["crown"], dtype=np.float64)
    h25 = np.asarray(d25["curves_head"], dtype=np.float64)
    c25 = np.asarray(d25["crown"], dtype=np.float64)
    tuck = np.asarray(d19["tuck"]) > 0.5
    w19 = F.head_to_world(h19, c19)
    w25 = F.head_to_world(h25, c25)
    roots = w19[:, 0]
    back = (roots[:, 1] < Y_EAR) & (roots[:, 2] > Z_NAPE)
    graph = back & ~tuck

    seg = np.linalg.norm(np.diff(w19, axis=1), axis=2)
    arc = np.concatenate([np.zeros((len(w19), 1)),
                          np.cumsum(seg, axis=1)], axis=1)
    frac = arc / np.maximum(arc[:, -1:], 1e-12)
    delta = (w25 - w19) * 1000.0  # mm

    bands = [(0.0, 0.15, "root-takeoff"), (0.15, 0.5, "upper-mid"),
             (0.5, 0.85, "lower-mid"), (0.85, 1.01, "hem")]
    out = {}
    for sname, smask in (("posX", roots[:, 0] >= 0.0),
                         ("negX", roots[:, 0] < 0.0)):
        m = graph & smask
        idx = np.nonzero(m)[0]
        s = {"nGuides": int(m.sum()), "bands": {}}
        for lo, hi, bn in bands:
            sel = (frac[idx] >= lo) & (frac[idx] < hi)
            dd = delta[idx][sel]
            meanv = dd.mean(axis=0) if dd.size else np.zeros(3)
            n = float(np.linalg.norm(meanv))
            s["bands"][bn] = {
                "nSamples": int(sel.sum()),
                "meanDeltaMm": [round(float(v), 3) for v in meanv],
                "normMm": round(n, 3)}
        hem = delta[idx, -1]
        s["hemDelta"] = {"dx": dist(hem[:, 0]), "dy": dist(hem[:, 1]),
                         "dz": dist(hem[:, 2])}
        # hem vertical move sign count
        s["hemDzUp"] = int((hem[:, 2] > 5.0).sum())
        s["hemDzDown"] = int((hem[:, 2] < -5.0).sum())
        s["hemDxOut"] = int((((hem[:, 0] > 5.0) & (roots[idx, 0] >= 0))
                             | ((hem[:, 0] < -5.0) & (roots[idx, 0] < 0)))
                            .sum())
        out[sname] = s
    (E / "side-diag-band.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
