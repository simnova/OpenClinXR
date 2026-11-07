#!/usr/bin/env python3
"""STEP 2 (hair-tilt2) collider audit inside Blender.

Same flow as hair-transport2/repair.py (the EXISTING audit): for each
cell, load strands_waved.npz, run base_children.repair_outside alternating
with the strict end clamp (wave.py replica of station.clamp_ends_vertical
strict mode), write strands.npz + audit.json + gates (inside / end-p95 /
part-gap).

Run: /Applications/Blender.app/Contents/MacOS/Blender --background \
       --python repair.py -- <cell> [<cell> ...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path[:0] = [str(E),
                str(ROOT / "tools/openclinxr/evidence/hair-int1"),
                str(ROOT / "tools/openclinxr/evidence/hair-look1"),
                str(ROOT / "tools/openclinxr/evidence/hair-look2")]
import run_blender as R  # noqa: E402
import base_children as B  # noqa: E402
import wave as W  # noqa: E402


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    assert argv, "pass cell names"
    state = R.ST.build_state()
    for tag in argv:
        cell = E / "cells" / tag
        raw = dict(np.load(cell / "strands_waved.npz"))
        points = np.asarray(raw["points"], float)
        roots = np.asarray(raw["roots"], float)
        audits = []
        for _ in range(3):
            points, audit = B.repair_outside(points, state["handle"])
            audits.append(audit)
            points = W.clamp_ends_vertical(points)
        points, audit = B.repair_outside(points, state["handle"])
        audits.append(audit)
        np.savez_compressed(cell / "strands.npz", points=points.astype(np.float32),
                            roots=roots.astype(np.float32), radii=np.asarray(raw["radii"]),
                            apex_y=np.asarray(raw["apex_y"]), cx=np.asarray(raw["cx"]))
        meta = json.load(open(cell / "wave_meta.json"))
        report = {"change": {"kind": "zero-mean per-fibre wave (hair-tilt2/wave.py; guides untouched)",
                             "wave": meta},
                  "colliderPasses": audits, "collider": audit,
                  "endAngleDeg": W.endpoint_stats(points),
                  "partGapMm": W.part_gap(roots, float(np.asarray(raw["cx"])),
                                           float(np.asarray(raw["apex_y"]))),
                  "strandCount": int(len(points))}
        report["gates"] = {"colliderInsideZero": audit["post_inside_total"] == 0,
                           "endP95AtMost10Deg": report["endAngleDeg"]["p95"] <= 10.0,
                           "partGapAtMost3Mm": report["partGapMm"] <= 3.0}
        (cell / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
        print("REPAIRED", tag, json.dumps(report["gates"]), json.dumps(report["endAngleDeg"]),
              report["partGapMm"], flush=True)


if __name__ == "__main__":
    main()
