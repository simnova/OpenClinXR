#!/usr/bin/env python3
"""hair-tilt3 Step 1: build long-wavelength lean cells from a1 (system python).

Cells (5 mm phase field, in-plane only, part protection + 20 mm tip fade
as tilt2):
  L240  single sine wavelength 240 mm, peak tangent 4 deg
  L450  single sine wavelength 450 mm (~half period/strand), peak 4 deg
  L450x6 single sine wavelength 450 mm, peak 6 deg
  LR    lean-return: per-fibre theta ~ N(0,4deg) first 60% arc, smooth
        return to unwaved strand over last 40% (tip displacement 0)

Reads hair-real1/cells/a1/strands.npz (guides untouched). Writes
cells/<tag>/{strands_waved.npz, wave_meta.json} with realised tangent
deviation (rms/p95 deg) and max displacement (p50/p95/max mm).
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


def main():
    want = set(sys.argv[1:]) or {"L240", "L450", "L450x6", "LR"}
    src = np.load(A1)
    points = np.asarray(src["points"], float)
    roots = np.asarray(src["roots"], float)
    radii = np.asarray(src["radii"])
    apex = float(np.asarray(src["apex_y"]))
    cx = float(np.asarray(src["cx"]))
    jobs = {
        "L240": ("long", {"target_deg": 4.0, "wave_len_mm": 240.0,
                          "seed": 2026101801}),
        "L450": ("long", {"target_deg": 4.0, "wave_len_mm": 450.0,
                          "seed": 2026101811}),
        "L450x6": ("long", {"target_deg": 6.0, "wave_len_mm": 450.0,
                            "seed": 2026101821}),
        "LR": ("lean", {"sigma_deg": 4.0, "seed": 2026101831}),
    }
    for tag in jobs:
        if tag not in want:
            continue
        kind, cfg = jobs[tag]
        if kind == "long":
            waved, info = W.apply_long_wave(points, roots, cx,
                                            cfg["target_deg"],
                                            wave_len_mm=cfg["wave_len_mm"],
                                            seed=cfg["seed"])
            op = "single-sine long-wavelength lean, in-plane (no root rotation)"
            params = {"targetDeg": cfg["target_deg"],
                      "waveLenMm": cfg["wave_len_mm"],
                      "seed": cfg["seed"], "phaseFieldMm": 5.0,
                      "partProtectMm": 3.0, "fadeInMm": 15.0,
                      "fadeOutMm": 20.0, "source": "hair-real1 a1"}
        else:
            waved, theta, info = W.apply_lean_return(points, roots, cx,
                                                     cfg["sigma_deg"],
                                                     cfg["seed"])
            op = ("per-fibre lean-return: theta~N(0,4deg) first 60% arc, "
                  "smooth return over last 40% (tip displacement 0)")
            params = {"sigmaDeg": cfg["sigma_deg"], "seed": cfg["seed"],
                      "splitFrac": 0.6, "partProtectMm": 3.0,
                      "fadeInMm": 15.0, "source": "hair-real1 a1"}
        cell = E / "cells" / tag
        cell.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(cell / "strands_waved.npz",
                            points=waved.astype(np.float32),
                            roots=roots.astype(np.float32), radii=radii,
                            apex_y=np.array(apex), cx=np.array(cx))
        meta = {"tag": tag, "op": op, "params": params, "wave": info,
                "endAngleDegPreRepair": W.endpoint_stats(waved),
                "partGapMm": W.part_gap(roots, cx, apex)}
        (cell / "wave_meta.json").write_text(json.dumps(meta, indent=2) + "\n")
        w = info
        print("CELL", tag, json.dumps({
            "tangentRms": round(w["tangentDevDeg"]["rms"], 3),
            "tangentP95": round(w["tangentDevDeg"]["p95"], 3),
            "dispP50": round(w["maxDispMm"]["p50"], 3),
            "dispP95": round(w["maxDispMm"]["p95"], 3),
            "dispMax": round(w["maxDispMm"]["max"], 3),
            "partGap": round(meta["partGapMm"], 3)}), flush=True)


if __name__ == "__main__":
    main()
