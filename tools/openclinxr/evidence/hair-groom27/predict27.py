#!/usr/bin/env python3
"""hair-groom27: predict children after s14 reroute (rigid-translation
model) WITHOUT a full rebuild.

child(f) = root + sum w (G(f) - G(0)) => new_child = child + sum w dG(f)
with f = s/31 over the 41-pt guide delta field. Vectorized O(n).
Downstream stages (servo/clump/hug/keepout/projection, typically
+-10 mm) are NOT modelled: prediction screens for LARGE residuals
(verbatim-locked backbones), not px-exact gates.

Reads guides-26, guides-27, build-26/strands.npz. Writes E/predict27.json:
predicted column strands per side + attribution to backbones.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
import frames as F  # noqa: E402

G26 = np.load(str(E.parent / "hair-groom26/build-26/guides-26.npz"),
              allow_pickle=True)
G27 = np.load(str(E / "build-27/guides-27.npz"), allow_pickle=True)
C26 = np.asarray(G26["crown"], dtype=np.float64)
C27 = np.asarray(G27["crown"], dtype=np.float64)
W26 = F.head_to_world(np.asarray(G26["curves_head"], dtype=np.float64),
                      C26)
W27 = F.head_to_world(np.asarray(G27["curves_head"], dtype=np.float64),
                      C27)
dG = W27 - W26  # (2707,41,3)
print("guides moved: %d maxDelta %.1f mm" % (
    int((np.abs(dG).sum(axis=(1, 2)) > 0).sum()),
    float(np.linalg.norm(dG, axis=2).max() * 1000.0)), flush=True)

D = np.load(str(E.parent / "hair-groom26/build-26/strands.npz"),
            allow_pickle=True)
pts = np.asarray(D["points"], dtype=np.float64)
gw = np.asarray(D["guide_w"], dtype=np.float64)
gi = np.asarray(D["guide_idx"], dtype=np.int64)
n, P, _ = pts.shape
# fraction mapping: child s -> f=s/31 -> guide grid g=f*40.
f = np.arange(P) / (P - 1) * 40.0
g0 = np.floor(f).astype(int).clip(0, 39)
g1 = (g0 + 1).clip(0, 40)
t = (f - g0)
dGf = dG[:, g0, :] * (1.0 - t)[None, :, None] \
    + dG[:, g1, :] * t[None, :, None]  # (2707,32,3)
# pred = pts + sum_i w_i dGf[gi_i]
pred = pts + (dGf[gi] * gw[:, :, None, None]).sum(axis=1)
print("predicted children", pred.shape, flush=True)

pin = np.load(str(ROOT / "tools/openclinxr/evidence/hair-hull3"
                  "/workspace/ear_pinna.npz"), allow_pickle=True)
xyz = np.asarray(pin["xyz"], dtype=np.float64)
out = {"sides": {}}
for key, sgn, nm in (("idx_earXpos", 1.0, "xpos"),
                     ("idx_earXneg", -1.0, "xneg")):
    pv = xyz[np.asarray(pin[key])]
    s = {"zmin": float(pv[:, 2].min()),
         "yfront": float(pv[:, 1].max()),
         "yback": float(pv[:, 1].min()),
         "xmin": float(np.abs(pv[:, 0]).min()),
         "xmax": float(np.abs(pv[:, 0]).max())}
    for tag, arr in (("groom26", pts), ("pred27", pred)):
        flat = arr[:, 1:, :].reshape(-1, 3)
        sm = ((flat[:, 2] < s["zmin"])
              & (flat[:, 1] >= s["yback"])
              & (flat[:, 1] <= s["yfront"])
              & ((flat[:, 0] * sgn) > 0)
              & (np.abs(flat[:, 0]) >= s["xmin"] - 0.005)
              & (np.abs(flat[:, 0]) <= s["xmax"]))
        has = sm.reshape(n, P - 1).any(axis=1)
        idx = np.nonzero(has)[0]
        out["sides"].setdefault(nm, {})[tag] = int(has.sum())
        if tag == "pred27" and len(idx):
            from collections import Counter
            dom = gi[idx][np.arange(len(idx)),
                          np.argmax(gw[idx], axis=1)]
            out["sides"][nm]["topBackbones"] = [
                [int(g), int(c)] for g, c in Counter(dom).most_common(8)]
    print("%s groom26=%d pred27=%d" % (
        nm, out["sides"][nm]["groom26"], out["sides"][nm]["pred27"]),
        flush=True)
(E / "predict27.json").write_text(json.dumps(out, indent=1) + "\n")
print("WROTE E/predict27.json")
