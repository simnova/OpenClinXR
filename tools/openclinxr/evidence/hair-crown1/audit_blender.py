#!/usr/bin/env python3
"""hair-crown1 collider audit: discardable repair_outside on identical points.

Usage inside Blender: -- --cells CELLS_DIR --out AUDIT.json
Audits combo (sanity, expect 0) + c_den/c_slit/c_lift. Reports
first_pass_inside and post_inside_total per cell; strands are NOT modified
(repair runs on a copy; cell NPZs already written by build_cells.py).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
K1 = ROOT / "tools/openclinxr/evidence/hair-look1"
PROF1 = E.parent / "hair-prof1/cells/combo/strands.npz"

sys.path[:0] = [str(K1)]
import station as ST  # noqa: E402
import base_children as children  # noqa: E402
import numpy as np


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cells", required=True)
    parser.add_argument("--out", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def main():
    args = cli()
    cells = Path(args.cells)
    state = ST.build_state()
    result = {}
    targets = {"combo": PROF1, "c_den": cells / "c_den.npz",
               "c_slit": cells / "c_slit.npz", "c_lift": cells / "c_lift.npz"}
    for tag, path in targets.items():
        with np.load(path) as data:
            pts = np.asarray(data["points"], float).copy()
        _, row = children.repair_outside(pts, state["handle"])
        result[tag] = {
            "first_pass_inside": row["first_pass_inside"],
            "post_inside": row["post_inside"],
            "post_inside_total": int(row["post_inside_total"]),
            "moved_points": int(row["moved_points"]),
        }
        print("AUDIT", tag, row["post_inside_total"], flush=True)
    Path(args.out).write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
