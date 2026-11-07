#!/usr/bin/env python3
"""Verify final tilt cells are collider-clean post-clamp (audit only)."""
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

for tag in ("t2", "t4", "t6", "t4w"):
    cell = E / "cells" / tag
    d = np.load(cell / "strands.npz")
    pts = np.asarray(d["points"], float)
    if "state" not in dir():
        state = R.ST.build_state()
    fixed, audit = base_children.repair_outside(pts.copy(), state["handle"])
    moved = int((np.linalg.norm(fixed - pts, axis=2).max(axis=1) > 1e-9).sum())
    print("VERIFY", tag, json.dumps({"first_pass_inside": audit["first_pass_inside"],
                                     "post_inside_total": audit["post_inside_total"],
                                     "moved_strands": moved}), flush=True)
