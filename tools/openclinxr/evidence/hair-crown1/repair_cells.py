#!/usr/bin/env python3
"""hair-crown1 repair: project penetrations out (prof1 refinish precedent),
save repaired strands, verify inside-0 on identical points.

Usage inside Blender: -- --cells CELLS_DIR --out REPAIR.json
Repairs c_den + c_slit in place (raw copies kept as *_raw.npz).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
K1 = ROOT / "tools/openclinxr/evidence/hair-look1"

sys.path[:0] = [str(K1)]
import station as ST  # noqa: E402
import base_children as children  # noqa: E402


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
    report = {}
    for tag in ("c_den", "c_slit"):
        with np.load(cells / f"{tag}.npz") as data:
            pts = np.asarray(data["points"], float)
            roots = np.asarray(data["roots"], float)
            radii = np.asarray(data["radii"], np.float32)
            apex, cx = float(data["apex_y"]), float(data["cx"])
        before = pts.copy()
        fixed, row = children.repair_outside(pts, state["handle"])
        disp = np.linalg.norm(fixed - before, axis=2)
        np.savez_compressed(cells / f"{tag}.npz", points=fixed.astype(np.float32),
                            roots=roots, radii=radii, apex_y=apex, cx=cx)
        # verify inside-0 on identical saved points (discardable second run)
        with np.load(cells / f"{tag}.npz") as data:
            check = np.asarray(data["points"], float).copy()
        _, row2 = children.repair_outside(check, state["handle"])
        report[tag] = {
            "firstInside": row["first_pass_inside"],
            "postInside": row["post_inside"],
            "postInsideTotal": int(row["post_inside_total"]),
            "movedPoints": int(row["moved_points"]),
            "maxProjectionMm": float(row["max_single_projection_mm"]),
            "repairDispMm": {"p50": float(np.percentile(disp, 50)),
                            "p95": float(np.percentile(disp, 95)),
                            "max": float(disp.max())},
            "verifyPostInsideTotal": int(row2["post_inside_total"]),
        }
        print("REPAIR", tag, row["post_inside_total"], "verify", row2["post_inside_total"], flush=True)
    Path(args.out).write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
