#!/usr/bin/env python3
"""hair-tilt2 Step 1: build zero-mean wave cells from a1 (system python).

Cells (L = 80 mm, 5 mm phase-field coherence):
  w4i  peak ~4 deg,  in-plane (1.0/0.0)
  w7i  peak ~7 deg,  in-plane (1.0/0.0)
  w7m  peak ~7 deg,  mixed 30/70 in/out
  w10m peak ~10 deg, mixed 30/70 in/out

Reads hair-real1/cells/a1/strands.npz (guides untouched). Writes
cells/<tag>/{strands_waved.npz, wave_meta.json} with realised tangent
deviation (rms/p95 deg) and max displacement (p50/p95 mm).

c1 (r1 + best w-setting) is built separately by build_c1.py AFTER the
w-cells are scored, since it needs the winner.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
A1 = ROOT / "tools/openclinxr/evidence/hair-real1/cells/a1/strands.npz"
sys.path.insert(0, str(E))
import wave as W  # noqa: E402

CELLS = {
    "w4i": {"target_deg": 4.0, "w_in": 1.0, "w_out": 0.0, "seed": 2026101701},
    "w7i": {"target_deg": 7.0, "w_in": 1.0, "w_out": 0.0, "seed": 2026101711},
    "w7m": {"target_deg": 7.0, "w_in": 0.3, "w_out": 0.7, "seed": 2026101721},
    "w10m": {"target_deg": 10.0, "w_in": 0.3, "w_out": 0.7, "seed": 2026101731},
}


def main():
    want = set(sys.argv[1:]) or set(CELLS)
    src = np.load(A1)
    points = np.asarray(src["points"], float)
    roots = np.asarray(src["roots"], float)
    radii = np.asarray(src["radii"])
    apex = float(np.asarray(src["apex_y"]))
    cx = float(np.asarray(src["cx"]))
    for tag in CELLS:
        if tag not in want:
            continue
        cfg = CELLS[tag]
        waved, info = W.apply_wave(points, roots, cx, cfg["target_deg"],
                                   w_in=cfg["w_in"], w_out=cfg["w_out"],
                                   wave_len_mm=80.0, seed=cfg["seed"])
        cell = E / "cells" / tag
        cell.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(cell / "strands_waved.npz",
                            points=waved.astype(np.float32),
                            roots=roots.astype(np.float32), radii=radii,
                            apex_y=np.array(apex), cx=np.array(cx))
        meta = {"tag": tag, "op": "zero-mean per-fibre wave (no root rotation)",
                "params": {"targetDeg": cfg["target_deg"],
                           "weightsInOut": [cfg["w_in"], cfg["w_out"]],
                           "waveLenMm": 80.0, "secondLenMm": 80.0 / 2.3,
                           "seed": cfg["seed"], "phaseFieldMm": 5.0,
                           "partProtectMm": 3.0, "fadeInMm": 15.0,
                           "fadeOutMm": 20.0, "source": "hair-real1 a1"},
                "wave": info,
                "endAngleDegPreRepair": W.endpoint_stats(waved),
                "partGapMm": W.part_gap(roots, cx, apex)}
        (cell / "wave_meta.json").write_text(json.dumps(meta, indent=2) + "\n")
        print("CELL", tag, json.dumps({
            "tangentRms": round(info["tangentDevDeg"]["rms"], 3),
            "tangentP95": round(info["tangentDevDeg"]["p95"], 3),
            "dispP50": round(info["maxDispMm"]["p50"], 3),
            "dispP95": round(info["maxDispMm"]["p95"], 3),
            "peakOut": round(info["amplitudesMm"]["peakOutMm"], 3),
            "partGap": round(meta["partGapMm"], 3)}), flush=True)


if __name__ == "__main__":
    main()
