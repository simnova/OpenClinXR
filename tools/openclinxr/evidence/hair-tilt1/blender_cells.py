#!/usr/bin/env python3
"""hair-tilt1 Step 2: collider repair (existing base_children.repair_outside)
for t2/t4/t6/t4w raw strands; writes final strands.npz + audit.json."""
from __future__ import annotations
import sys, json
from pathlib import Path
import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
R1 = ROOT / "tools/openclinxr/evidence/hair-real1"
I1 = ROOT / "tools/openclinxr/evidence/hair-int1"
K1 = ROOT / "tools/openclinxr/evidence/hair-look1"
G6 = ROOT / "tools/openclinxr/evidence/hair-geo6"
L2 = ROOT / "tools/openclinxr/evidence/hair-look2"
sys.path[:0] = [str(E), str(R1), str(I1), str(K1), str(G6), str(L2)]
import run_blender as R
import base_children as base_children
import tilt as T

TAGS = ("t2", "t4", "t6", "t4w")

def converge(points, state, rounds=8):
    """Alternate repair -> end-clamp until a repair pass moves nothing
    after a clamp (i.e. the clamped result is collider-clean)."""
    cur = np.asarray(points, float).copy()
    last_audit, clamps = None, 0
    for _ in range(rounds):
        repaired, audit = base_children.repair_outside(cur.copy(), state["handle"])
        last_audit = audit
        clamped = T.clamp_ends_vertical(repaired)
        clamps += 1
        if np.array_equal(clamped.astype(np.float64), np.asarray(repaired, float)):
            return clamped, audit, True, clamps
        # audit-only probe: would repair move anything on the clamped result?
        probe, probe_audit = base_children.repair_outside(clamped.copy(), state["handle"])
        if probe_audit["moved_points"] == 0 and probe_audit["post_inside_total"] == 0:
            return clamped, probe_audit, True, clamps
        cur = probe
    final, final_audit = base_children.repair_outside(cur.copy(), state["handle"])
    return final, final_audit, False, clamps


def main():
    state = R.ST.build_state()
    for tag in TAGS:
        cell = E / "cells" / tag
        raw = np.load(cell / "strands_tilted.npz")
        pts = np.asarray(raw["points"], float)
        roots = np.asarray(raw["roots"], float)
        radii = np.asarray(raw["radii"], np.float32)
        apex = float(np.asarray(raw["apex_y"]))
        cx = float(np.asarray(raw["cx"]))
        fixed, audit, clean, clamps = converge(pts, state)
        np.savez_compressed(cell / "strands.npz", points=fixed.astype(np.float32),
                             roots=roots.astype(np.float32), radii=radii,
                             apex_y=np.array(apex), cx=np.array(cx))
        meta = json.load(open(cell / "tilt_meta.json"))
        report = {"change": {"kind": "per-child constant sheet-plane tilt + wave (a1 children pipeline copied to hair-tilt1/tilt.py; guides untouched)",
                             "tilt": meta,
                             "converge": {"rounds": clamps, "clean": bool(clean)}},
                  "collider": audit,
                  "endAngleDeg": T.endpoint_stats(fixed),
                  "partGapMm": T.part_gap(roots, cx, apex),
                  "strandCount": int(len(fixed))}
        (cell / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
        print("CELL", tag, json.dumps({"inside": audit["post_inside_total"],
                                       "endp95": report["endAngleDeg"]["p95"],
                                       "partGap": report["partGapMm"]}), flush=True)

main()
