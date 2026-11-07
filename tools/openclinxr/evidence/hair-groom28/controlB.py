#!/usr/bin/env python3
"""hair-groom28 CONTROL B: mirror guides-19 across x=0, fair with the
stock groom25 recipe (anchor 0.6), compare.

Test B1 (code x-symmetry): fair(mirror(g19)) vs mirror(fair(g19)=g25b).
Test B2 (geometry): per-side hem-scatter stats on the mirrored fairing --
does the strong outward hem swing move to +x with the mirrored narrow
curtain, or stay on -x with the code?

Writes E/controlB.json. Fairing itself via stock s11 CLI (no code copy).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
T2 = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
B2B = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2b")
sys.path.insert(0, str(B2B / "tools/openclinxr/hair-groom/strands"))
import frames as F  # noqa: E402

G19 = T2 / "tools/openclinxr/evidence/hair-groom19/build/guides-19.npz"
G25B = T2 / "tools/openclinxr/evidence/hair-groom25/build-25b/guides-25b.npz"
Y_EAR = -0.0635
Z_NAPE = 1.51


def mirror_world(w, crown):
    wm = w.copy()
    wm[..., 0] *= -1.0
    cm = crown.copy()
    cm[0] *= -1.0
    return wm, cm


def world_to_head(w, crown):
    h = np.empty_like(w)
    h[..., 0] = w[..., 0] * 1000.0
    h[..., 1] = (float(crown[1]) - w[..., 1]) * 1000.0
    h[..., 2] = (float(crown[2]) - w[..., 2]) * 1000.0
    return h


def main():
    d19 = np.load(str(G19), allow_pickle=True)
    h19 = np.asarray(d19["curves_head"], dtype=np.float64)
    c19 = np.asarray(d19["crown"], dtype=np.float64)
    w19 = F.head_to_world(h19, c19)
    wm19, cm19 = mirror_world(w19, c19)
    hm19 = world_to_head(wm19, cm19)
    payload = {k: np.asarray(d19[k]) for k in d19.files}
    payload["curves_head"] = hm19.astype(np.float64)
    payload["crown"] = np.asarray(cm19, dtype=np.float64)
    mir = Path("/tmp/hair28/guides-19mir.npz")
    np.savez_compressed(mir, **payload)

    # fair the mirrored input with the STOCK station recipe
    r = subprocess.run(
        ["mise", "exec", "--", "python3",
         str(B2B / "tools/openclinxr/hair-groom/orient/s11_back_coherent.py"),
         "--guides", str(mir),
         "--sdf", str(T2 / "tools/openclinxr/evidence/hair-cage1"
                       "/body-exact-sdf.npz"),
         "--hull", str(T2 / "tools/openclinxr/evidence/hair-hull5/hull.npz"),
         "--outdir", "/tmp/hair28", "--stem", "guides-28B",
         "--anchor", "0.6"],
        capture_output=True, text=True, cwd=str(B2B))
    if r.returncode != 0:
        print(r.stderr[-3000:])
        raise SystemExit("stock s11 on mirrored input failed")
    fB = json.loads(r.stdout)

    dB = np.load("/tmp/hair28/guides-28B.npz", allow_pickle=True)
    hB = np.asarray(dB["curves_head"], dtype=np.float64)
    cB = np.asarray(dB["crown"], dtype=np.float64)
    wB = F.head_to_world(hB, cB)

    # B1: compare against mirror(fair(orig))
    d25 = np.load(str(G25B), allow_pickle=True)
    w25 = F.head_to_world(np.asarray(d25["curves_head"], float),
                          np.asarray(d25["crown"], float))
    w25mir, _ = mirror_world(w25, np.asarray(d25["crown"], float))
    b1 = float(np.abs(wB - w25mir).max() * 1000.0)

    # B2: per-side hem scatter on the MIRRORED fairing (mirror-frame sides)
    roots = wm19[:, 0]
    tuck = np.asarray(d19["tuck"]) > 0.5
    back = (roots[:, 1] < Y_EAR) & (roots[:, 2] > Z_NAPE)
    graph = back & ~tuck
    delta = (wB - wm19) * 1000.0
    hem = delta[:, -1]
    b2 = {}
    for sname, smask in (("posX", roots[:, 0] >= 0.0),
                         ("negX", roots[:, 0] < 0.0)):
        m = graph & smask
        idx = np.nonzero(m)[0]
        hx = hem[idx, 0]
        out = (((hx > 5.0) & (roots[idx, 0] >= 0))
               | ((hx < -5.0) & (roots[idx, 0] < 0))).sum()
        b2[sname] = {"n": int(m.sum()),
                     "hemDxMean": round(float(hx.mean()), 3),
                     "hemDxOutMean": round(
                         float(np.where(roots[idx, 0] >= 0, hx, -hx)
                               .mean()), 3),
                     "nHemOut": int(out)}
    out = {"B1_maxWorldMm_fairMirror_vs_mirrorFair": b1,
           "B1_codeXSymmetric": bool(b1 < 1e-9),
           "B2_mirroredFairingSides": b2,
           "fairingRecord": {k: fB[k] for k in ("guides",)},
           "note": ("B2 posX here = mirror of original -x narrow curtain. "
                    "If the strong outward scatter follows it, geometry "
                    "(input drape shape) drives the one-sided loss.") }
    (E / "controlB.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
