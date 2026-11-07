#!/usr/bin/env python3
"""hair-tilt2 c1: transport2 r1 children + best w-setting (w7i).

Best rule (declared before building): max back-highlight band count among
w-cells passing the IoU and orientation KEEP clauses (all four fail the 2x
band clause, so bands rank them): w7i 458 > w7m 397 > w10m 390 > w4i 321.
w7i also passes every IoU view and every orientation view within 1 deg.

Base: hair-transport2/cells/r1/strands.npz (final, collider-clean
curtain-only transport). Same w7i operator (7 deg peak, in-plane, L=80 mm,
5 mm phase field, SAME seed 2026101711 so the phase field — roots are
identical — applies the same wave; only the base differs). Writes
cells/c1/{strands_waved.npz, wave_meta.json}.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
R1 = ROOT / "tools/openclinxr/evidence/hair-transport2/cells/r1/strands.npz"
sys.path.insert(0, str(E))
import wave as W  # noqa: E402


def main():
    src = np.load(R1)
    points = np.asarray(src["points"], float)
    roots = np.asarray(src["roots"], float)
    radii = np.asarray(src["radii"])
    apex = float(np.asarray(src["apex_y"]))
    cx = float(np.asarray(src["cx"]))
    waved, info = W.apply_wave(points, roots, cx, 7.0, w_in=1.0, w_out=0.0,
                               wave_len_mm=80.0, seed=2026101711)
    cell = E / "cells" / "c1"
    cell.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cell / "strands_waved.npz",
                        points=waved.astype(np.float32),
                        roots=roots.astype(np.float32), radii=radii,
                        apex_y=np.array(apex), cx=np.array(cx))
    meta = {"tag": "c1", "op": "r1 (curtain-only transport) + w7i wave",
            "params": {"targetDeg": 7.0, "weightsInOut": [1.0, 0.0],
                       "waveLenMm": 80.0, "secondLenMm": 80.0 / 2.3,
                       "seed": 2026101711, "phaseFieldMm": 5.0,
                       "partProtectMm": 3.0, "fadeInMm": 15.0, "fadeOutMm": 20.0,
                       "source": "hair-transport2 r1 strands.npz",
                       "selection": "w7i: max back bands (458) among w-cells passing IoU+orientation KEEP clauses"},
            "wave": info,
            "endAngleDegPreRepair": W.endpoint_stats(waved),
            "partGapMm": W.part_gap(roots, cx, apex)}
    (cell / "wave_meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print("CELL c1", json.dumps({
        "tangentRms": round(info["tangentDevDeg"]["rms"], 3),
        "tangentP95": round(info["tangentDevDeg"]["p95"], 3),
        "dispP50": round(info["maxDispMm"]["p50"], 3),
        "dispP95": round(info["maxDispMm"]["p95"], 3),
        "partGap": round(meta["partGapMm"], 3)}), flush=True)


if __name__ == "__main__":
    main()
