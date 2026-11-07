#!/usr/bin/env python3
"""hair-tilt1 Step 2 (per cell): repair -> clamp -> repair -> clamp -> probe.
Saves final strands.npz + audit.json. Usage: Blender --background --python
blender_cell_one.py -- --tag t2"""
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

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
tag = argv[argv.index("--tag") + 1]

state = R.ST.build_state()
cell = E / "cells" / tag
raw = np.load(cell / "strands_tilted.npz")
pts = np.asarray(raw["points"], float)
roots = np.asarray(raw["roots"], float)
radii = np.asarray(raw["radii"], np.float32)
apex = float(np.asarray(raw["apex_y"]))
cx = float(np.asarray(raw["cx"]))

r1, a1 = base_children.repair_outside(pts.copy(), state["handle"])
print("ROUND", tag, "R1", json.dumps({"moved": a1["moved_points"], "post": a1["post_inside_total"]}), flush=True)
c1 = T.clamp_ends_vertical(r1)
r2, a2 = base_children.repair_outside(c1.copy(), state["handle"])
print("ROUND", tag, "R2", json.dumps({"moved": a2["moved_points"], "post": a2["post_inside_total"]}), flush=True)
c2 = T.clamp_ends_vertical(r2)
probe, pa = base_children.repair_outside(c2.copy(), state["handle"])
print("ROUND", tag, "PROBE", json.dumps({"moved": pa["moved_points"], "post": pa["post_inside_total"],
                                         "first": pa["first_pass_inside"]}), flush=True)
if pa["moved_points"] == 0 and pa["post_inside_total"] == 0:
    fixed, audit, clean = c2, pa, True
else:
    fixed, audit, clean = np.asarray(probe), pa, False
np.savez_compressed(cell / "strands.npz", points=np.asarray(fixed, np.float32),
                     roots=roots.astype(np.float32), radii=radii,
                     apex_y=np.array(apex), cx=np.array(cx))
meta = json.load(open(cell / "tilt_meta.json"))
report = {"change": {"kind": "per-child constant sheet-plane tilt + wave (a1 children pipeline copied to hair-tilt1/tilt.py; guides untouched)",
                     "tilt": meta,
                     "schedule": "repair->clamp->repair->clamp->probe",
                     "rounds": {"R1": {"moved_points": a1["moved_points"], "post_inside_total": a1["post_inside_total"]},
                                "R2": {"moved_points": a2["moved_points"], "post_inside_total": a2["post_inside_total"]},
                                "probe": {"moved_points": pa["moved_points"], "post_inside_total": pa["post_inside_total"],
                                          "first_pass_inside": pa["first_pass_inside"]}},
                     "clean": bool(clean)},
          "collider": audit,
          "endAngleDeg": T.endpoint_stats(np.asarray(fixed, float)),
          "partGapMm": T.part_gap(roots, cx, apex),
          "strandCount": int(len(fixed))}
(cell / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
print("CELL", tag, json.dumps({"clean": clean, "inside": audit["post_inside_total"],
                               "endp95": report["endAngleDeg"]["p95"],
                               "partGap": report["partGapMm"]}), flush=True)
