#!/usr/bin/env python3
"""hair-part1 driver: hair-top1's part/side metric on a groom strands.npz.

Imports hair-top1/metric.py (no copy): its rig (hair-int1 run_blender),
render_one, crown_metrics (crown_top +/-3 mm part vs 7-24 mm sides) and
front_part_side (front rows above own hairline; TS = set-back target).
Run inside Blender, twice (render, then measure in a fresh state):
  Blender -b --python part1_metric.py -- --strands S --tag T
  Blender -b --python part1_metric.py -- --strands S --tag T --measure
Writes E/cells/T/<5 hair-top1 views>{,-id}.png and E/cells/T/part.json.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
TOP1 = E.parent / "hair-top1"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


M = load("hair_top1_metric", TOP1 / "metric.py")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--strands", required=True)
    p.add_argument("--tag", required=True)
    p.add_argument("--measure", action="store_true")
    a = p.parse_args(argv)
    raw = Path(a.strands).read_bytes()
    d = np.load(a.strands)
    points = np.asarray(d["points"], float)
    radii = np.asarray(d["radii"], np.float32)
    cell = E / "cells" / a.tag
    state = M.R.ST.build_state()
    if not a.measure:
        # Same view order as hair-top1 build_render (render_views over
        # VIEWS): the crown camera/light state depends on it.
        obj = M.build_object(state, points, radii, "hair_part1_" + a.tag)
        secs = M.render_views(state, obj, "../../hair-part1/cells/" + a.tag)
        (cell / "render-times.json").write_text(json.dumps(secs) + "\n")
        return
    # Measure in a fresh state, as hair-top1 finalize does.
    state["c3"].set_final_view(state["handle"], "crown_top")
    crown = M.crown_metrics(state, cell)
    front = M.front_part_side(cell / "front.png", cell / "front-id.png")
    ts = M.front_part_side(M.TARGET / "target-front.png",
                           M.TARGET_MASKS / "mask-front-v2.png", True)
    secs = json.loads((cell / "render-times.json").read_text())
    out = {"tag": a.tag, "strands": a.strands,
           "strandsSha256": hashlib.sha256(raw).hexdigest()[:16],
           "nStrands": int(len(points)),
           "crownTop": crown, "frontHonest": front, "TS": ts,
           "renderSeconds": secs}
    (cell / "part.json").write_text(json.dumps(out, indent=1) + "\n")
    print("PART1", a.tag, "crown_top", round(crown["partSide"], 6),
          "front", round(front["partSide"], 6), "TS",
          round(ts["partSide"], 6), flush=True)


main()
