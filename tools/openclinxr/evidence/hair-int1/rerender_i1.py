#!/usr/bin/env python3
"""Rerender i1 with the supported root-density correction only."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import run_blender as R


def main():
    src = np.load(R.G6 / "cells/f1/strands.npz")
    points = np.asarray(src["points"], float)
    roots = np.asarray(src["roots"], float)
    radii = np.asarray(src["radii"], np.float32)
    cx = float(src["cx"])
    near = np.flatnonzero((np.abs(roots[:, 0] - cx) <= .003) & (roots[:, 1] <= float(src["apex_y"])))
    ids = near[::2]
    add = points[ids].copy()
    side = np.where(add[:, 0, 0] >= cx, 1.0, -1.0)
    add[:, :, 0] += side[:, None] * .00004
    dense_points = np.concatenate([points, add])
    dense_radii = np.concatenate([radii, radii[ids]])
    state = R.ST.build_state()
    patch = R.scalp_patch(state)
    obj = R.build_hair(state, dense_points, dense_radii, "hair_int1_i1_root_density")
    R.render_full(state, obj, patch, "i1", False)
    close = R.render_closeup(state, [obj], patch, "i1", False, obj)
    diagnosis = R.json.load(open(R.E / "part-diagnosis.json"))
    diagnosis["candidates"]["a"]["status"] = "REFUTED"
    diagnosis["candidates"]["b"]["status"] = "SUPPORTED"
    diagnosis["candidates"]["c"]["status"] = "REFUTED"
    diagnosis["appliedToI1"] = {
        "scalpDarkening": False,
        "rootDensity50Percent": True,
        "roughnessPlus015": False,
        "supported": ["b"],
    }
    diagnosis["i1Band"] = R.close_metrics(state, close)
    (R.E / "part-diagnosis.json").write_text(R.json.dumps(diagnosis, indent=2) + "\n")


if __name__ == "__main__":
    main()
