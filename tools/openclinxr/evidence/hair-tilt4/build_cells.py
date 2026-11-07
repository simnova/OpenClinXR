#!/usr/bin/env python3
"""hair-tilt4 Step 1: rear-only lean-return cells from a1 (system python).

Cells (all lean-return, first 60% held, last 40% returned, 3 mm part
protection, 15 mm fade-in, in-plane, guides untouched):
  r_rear          (a) independent theta~N(0,4deg), rear only
  r_rear_coh      (a+b) coherent 10 mm theta field, sigma 4, rear only
  r_rear_coh_comp (a+b+c) coherent sigma 4 rear + outline compensation
  r_rear_coh6     (a+b) coherent 10 mm theta field, sigma 6, rear only

Reads hair-real1/cells/a1/strands.npz. Writes
cells/<tag>/{strands_waved.npz, wave_meta.json}. Curtain fibres are
bitwise identical to a1 (verified max abs diff == 0).
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
    want = set(sys.argv[1:]) or {"r_rear", "r_rear_coh", "r_rear_coh_comp", "r_rear_coh6"}
    src = np.load(A1)
    points = np.asarray(src["points"], float)
    roots = np.asarray(src["roots"], float)
    radii = np.asarray(src["radii"])
    apex = float(np.asarray(src["apex_y"]))
    cx = float(np.asarray(src["cx"]))
    jobs = {
        "r_rear": {"sigma": 4.0, "seed": 2026101901, "coherent": False, "comp": False},
        "r_rear_coh": {"sigma": 4.0, "seed": 2026101911, "coherent": True, "comp": False},
        "r_rear_coh_comp": {"sigma": 4.0, "seed": 2026101911, "coherent": True, "comp": True},
        "r_rear_coh6": {"sigma": 6.0, "seed": 2026101921, "coherent": True, "comp": False},
    }
    for tag in jobs:
        if tag not in want:
            continue
        cfg = jobs[tag]
        waved, theta, info = W.apply_lean_return_rear(
            points, roots, cx, apex, cfg["sigma"], cfg["seed"], cfg["coherent"])
        comp_report = None
        if cfg["comp"]:
            waved, comp_report = W.compensate_outline(points, waved, roots, cx, apex, 12)
            ang, maxdisp = W._stats(waved, points)
            rear = W.rear_mask(roots, apex)
            rear_disp = maxdisp[rear]
            info["postComp"] = {
                "tangentRms": float(np.sqrt(np.mean(ang ** 2))),
                "tangentP95": float(np.percentile(ang, 95)),
                "dispP50": float(np.percentile(maxdisp, 50)),
                "dispP95": float(np.percentile(maxdisp, 95)),
                "dispMax": float(maxdisp.max()),
                "dispRearP50": float(np.percentile(rear_disp, 50)),
                "dispRearP95": float(np.percentile(rear_disp, 95)),
            }
        # curtain bitwise check
        rear = W.rear_mask(roots, apex)
        cur_diff = float(np.abs(waved[~rear] - points[~rear]).max()) if (~rear).sum() else 0.0
        assert cur_diff == 0.0, f"curtain moved {cur_diff}"
        a_rows, _ = W.sheet_halfwidths(points, roots, cx, apex, 12)
        l_rows, _ = W.sheet_halfwidths(waved, roots, cx, apex, 12)
        hw = [{"bin": a["bin"],
               "a1HalfMm": round(a["half"] * 1000.0, 3),
               "leanedHalfMm": round(b["half"] * 1000.0, 3)}
              for a, b in zip(a_rows, l_rows)]
        cell = E / "cells" / tag
        cell.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(cell / "strands_waved.npz",
                            points=waved.astype(np.float32),
                            roots=roots.astype(np.float32), radii=radii,
                            apex_y=np.array(apex), cx=np.array(cx))
        meta = {"tag": tag, "op": "rear-only lean-return (tilt4)", "params": cfg,
                "wave": info, "curtainMaxAbsDiffMm": cur_diff * 1000.0,
                "halfwidthMm": hw,
                "compensation": comp_report,
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
            "dispRearP95": round(w["maxDispMmRear"]["p95"], 3),
            "thetaStdRear": round(w["thetaStdRear"], 3),
            "partGap": round(meta["partGapMm"], 3),
            "postComp": info.get("postComp")}), flush=True)
        print("HALFWIDTH", tag, json.dumps(hw), flush=True)


if __name__ == "__main__":
    main()
