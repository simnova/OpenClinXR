#!/usr/bin/env python3
"""hair-tilt5 Step 1: stronger/longer rear lean on b8 (system python).

Base b8 = copy of tilt4 r_rear/strands.npz (rear-only independent sigma4
hold 0.60). New cells built from hair-real1 a1 rear (curtain bitwise a1,
which equals b8 curtain):
  s5    rear independent sigma 5.0 hold 0.60
  h75   rear independent sigma 4.0 hold 0.75
  s5h75 rear independent sigma 5.0 hold 0.75
  jaw   b8 + curtain-only independent sigma 4.0 hold 0.60 BELOW jaw_z
        (world z), faded in over 30 mm; face/eye region stays bitwise b8.

Reads hair-real1/cells/a1/strands.npz + tilt4 r_rear/strands.npz.
Writes cells/<tag>/{strands_waved.npz, wave_meta.json}.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
A1 = ROOT / "tools/openclinxr/evidence/hair-real1/cells/a1/strands.npz"
B8SRC = ROOT / "tools/openclinxr/evidence/hair-tilt4/cells/r_rear/strands.npz"
sys.path.insert(0, str(E))
import wave as W  # noqa: E402

JAW_Z = 1.46
FADE_M = 0.030


def save(tag, waved, roots, radii, apex, cx, meta_extra):
    cell = E / "cells" / tag
    cell.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cell / "strands_waved.npz",
                        points=waved.astype(np.float32),
                        roots=roots.astype(np.float32), radii=radii,
                        apex_y=np.array(apex), cx=np.array(cx))
    meta = {"tag": tag, **meta_extra,
            "endAngleDegPreRepair": W.endpoint_stats(waved),
            "partGapMm": W.part_gap(roots, cx, apex)}
    (cell / "wave_meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    return meta


def main():
    want = set(sys.argv[1:]) or {"s5", "h75", "s5h75", "jaw"}
    src = np.load(A1)
    points = np.asarray(src["points"], float)
    roots = np.asarray(src["roots"], float)
    radii = np.asarray(src["radii"])
    apex = float(np.asarray(src["apex_y"]))
    cx = float(np.asarray(src["cx"]))
    b8 = np.load(B8SRC)
    b8_points = np.asarray(b8["points"], float)
    jobs = {
        "s5": {"sigma": 5.0, "hold": 0.60, "seed": 2026102001},
        "h75": {"sigma": 4.0, "hold": 0.75, "seed": 2026102002},
        "s5h75": {"sigma": 5.0, "hold": 0.75, "seed": 2026102003},
    }
    for tag in ("s5", "h75", "s5h75"):
        if tag not in want:
            continue
        cfg = jobs[tag]
        waved, theta, info = W.apply_lean_return_rear_held(
            points, roots, cx, apex, cfg["sigma"], cfg["seed"], cfg["hold"])
        rear = W.rear_mask(roots, apex)
        cur_diff = float(np.abs(waved[~rear] - points[~rear]).max())
        assert cur_diff == 0.0, f"curtain moved {cur_diff}"
        meta = save(tag, waved, roots, radii, apex, cx,
                    {"op": "rear-only independent lean-return (tilt5)",
                     "params": cfg, "wave": info,
                     "curtainMaxAbsDiffMm": cur_diff * 1000.0})
        w = info
        print("CELL", tag, json.dumps({
            "tangentRms": round(w["tangentDevDeg"]["rms"], 3),
            "tangentP95": round(w["tangentDevDeg"]["p95"], 3),
            "dispP50": round(w["maxDispMm"]["p50"], 3),
            "dispP95": round(w["maxDispMm"]["p95"], 3),
            "dispMax": round(w["maxDispMm"]["max"], 3),
            "dispRearP95": round(w["maxDispMmRear"]["p95"], 3),
            "thetaStdRear": round(w["thetaStdRear"], 3),
            "partGap": round(meta["partGapMm"], 3)}), flush=True)
    if "jaw" in want:
        waved, theta, info = W.apply_curtain_below_jaw(
            b8_points, roots, cx, apex, 4.0, 2026102004, 0.60, JAW_Z, FADE_M)
        rear = W.rear_mask(roots, apex)
        rear_diff = float(np.abs(waved[rear] - b8_points[rear]).max())
        assert rear_diff == 0.0, f"rear moved {rear_diff}"
        above = (~rear) & (b8_points[:, :, 2].max(axis=1) >= JAW_Z)
        # pointwise check above jaw plane stays bitwise
        mask_above = (~rear)[:, None] & (b8_points[:, :, 2] >= JAW_Z)
        assert float(np.abs(waved[mask_above] - b8_points[mask_above]).max()) == 0.0
        meta = save("jaw", waved, roots, radii, apex, cx,
                    {"op": "b8 + curtain-below-jaw lean (tilt5)",
                     "params": {"sigma": 4.0, "hold": 0.60, "seed": 2026102004,
                               "jawZ": JAW_Z, "fadeMm": FADE_M * 1000.0},
                     "wave": info, "rearMaxAbsDiffVsB8Mm": rear_diff * 1000.0})
        # stats vs a1 (load-bearing comparison) and vs b8
        _, maxdisp_a1 = W._stats(waved, points)
        print("CELL jaw", json.dumps({
            "tangentRmsVsB8": round(info["tangentDevDeg"]["rms"], 3),
            "tangentP95VsB8": round(info["tangentDevDeg"]["p95"], 3),
            "dispP50VsB8": round(info["maxDispMm"]["p50"], 3),
            "dispP95VsB8": round(info["maxDispMm"]["p95"], 3),
            "dispMaxVsB8": round(info["maxDispMm"]["max"], 3),
            "dispCurtainP95VsB8": round(info["maxDispMmCurtain"]["p95"], 3),
            "dispVsA1p50": round(float(np.percentile(maxdisp_a1, 50)), 3),
            "dispVsA1p95": round(float(np.percentile(maxdisp_a1, 95)), 3),
            "dispVsA1max": round(float(maxdisp_a1.max()), 3),
            "thetaStdCurtain": round(info["thetaStdCurtain"], 3),
            "partGap": round(meta["partGapMm"], 3)}), flush=True)


if __name__ == "__main__":
    main()
