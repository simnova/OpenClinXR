#!/usr/bin/env python3
"""hair-prof1 refinish: clamp ends, save, then verify inside on a copy.

Addresses repair-tilted tips (c_pb endP95 13.6 > 10 gate): strict end clamp
last, with inside-0 verified by a discardable repair_outside on identical
points. Ends with clamp => ends good; the verify pass only REPORTS.

Run: Blender --background --python refinish.py -- <cell>
Prints REFINISH <tag> <endP95> <verifyInside> <verifyMoved>.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
T5 = ROOT / "tools/openclinxr/evidence/hair-tilt5"
sys.path[:0] = [str(E),
                str(ROOT / "tools/openclinxr/evidence/hair-int1"),
                str(ROOT / "tools/openclinxr/evidence/hair-look1"),
                str(ROOT / "tools/openclinxr/evidence/hair-look2"),
                str(T5)]
import run_blender as R  # noqa: E402
import base_children as B  # noqa: E402
import wave as W  # noqa: E402


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    assert len(argv) == 1, "pass one cell name"
    tag = argv[0]
    cell = E / "cells" / tag
    state = R.ST.build_state()
    raw = dict(np.load(cell / "strands.npz"))
    points = np.asarray(raw["points"], float)
    points = W.clamp_ends_vertical(points)
    end = W.endpoint_stats(points)
    np.savez_compressed(cell / "strands.npz", points=points.astype(np.float32),
                        roots=np.asarray(raw["roots"], dtype=np.float32),
                        radii=np.asarray(raw["radii"]),
                        apex_y=np.asarray(raw["apex_y"]), cx=np.asarray(raw["cx"]))
    probe, audit = B.repair_outside(points.copy(), state["handle"])
    moved = float(np.abs(probe - points).max()) * 1000.0
    print("REFINISH", tag, "endP95=%.3f" % end["p95"],
          "verifyInside=%s" % audit["post_inside_total"],
          "verifyMaxMoveMm=%.4f" % moved, flush=True)


if __name__ == "__main__":
    main()
