#!/usr/bin/env python3
"""hair-prof1 STEP 2: build the four region cells on b9 (system python).

Reads tilt5 cells/s5/strands.npz (b9 repaired). Writes
E/cells/<tag>/{strands_waved.npz, deform_meta.json}.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
B9 = ROOT / "tools/openclinxr/evidence/hair-tilt5/cells/s5/strands.npz"
sys.path.insert(0, str(E))
import deform as D  # noqa: E402

BUILDERS = {"c_pb": D.c_pb, "c_pf": D.c_pf, "c_fo": D.c_fo, "c_fc": D.c_fc,
            "c_pf2": D.c_pf2, "c_fo2": D.c_fo2, "c_fc2": D.c_fc2,
            "c_fo3": D.c_fo3, "c_fc3": D.c_fc3, "c_cr1": D.c_cr1, "c_fo4": D.c_fo4}


def main():
    want = sys.argv[1:] or sorted(BUILDERS)
    src = np.load(B9)
    points = np.asarray(src["points"], float)
    roots = np.asarray(src["roots"], float)
    radii = np.asarray(src["radii"])
    apex = float(np.asarray(src["apex_y"]))
    cx = float(np.asarray(src["cx"]))
    for tag in want:
        assert tag in BUILDERS, tag
        waved, info = BUILDERS[tag](points, roots, apex)
        st = D.stats(waved, points)
        end = D.endpoint_stats(waved)
        # part gap from roots (unchanged by construction)
        front = roots[:, 1] <= apex
        left = cx - roots[front & (roots[:, 0] < cx), 0]
        right = roots[front & (roots[:, 0] >= cx), 0] - cx
        part_gap = float((left.min() + right.min()) * 1000.0)
        cell = E / "cells" / tag
        cell.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(cell / "strands_waved.npz",
                            points=waved.astype(np.float32),
                            roots=roots.astype(np.float32), radii=radii,
                            apex_y=np.asarray(src["apex_y"]), cx=np.asarray(src["cx"]))
        meta = {"tag": tag, "base": "tilt5 s5 (b9) repaired strands.npz",
                "deform": info, "statsVsB9": st,
                "endAngleDegPreRepair": end, "partGapMm": part_gap}
        (cell / "deform_meta.json").write_text(json.dumps(meta, indent=2) + "\n")
        print("CELL", tag, json.dumps({**st, "endP95": round(end["p95"], 3),
                                       "partGap": round(part_gap, 3)}), flush=True)


if __name__ == "__main__":
    main()
