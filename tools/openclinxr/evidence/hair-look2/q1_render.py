#!/usr/bin/env python3
"""Render q1 best at 1024/64 seeds 0,1,2. Runs inside Blender background."""
from __future__ import annotations
import json, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
K = ROOT / "tools/openclinxr/evidence/hair-look1"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(K))
import numpy as np
import bpy  # noqa: F401
import experiment as X
import cell_rel as C

RIM_FALLBACK = 26.654435328323842
_orig_lights = X.ST.lights
def _lights_with_rim(state, p):
    _orig_lights(state, p)
    try:
        e = float(p.get("rim_W", RIM_FALLBACK))
    except (TypeError, ValueError):
        e = RIM_FALLBACK
    for light in state["handle"].lights:
        if light.name == "OCLX_rim":
            light.data.energy = e
X.ST.lights = _lights_with_rim

def main():
    best = json.load(open(HERE / "q1-best.json"))
    params = best["params"]
    kids = np.asarray(np.load(K / "cells/g1/strands.npz")["points"], float)
    state = X.ST.build_state()
    docs = {}
    for tag, seed in (("q1", 0), ("q1s1", 1), ("q1s2", 2)):
        docs[tag] = C.render_cell_rel(state, kids, tag, params, size=1024, samples=64, seed=seed)
        print("DONE", tag, "seed", seed, flush=True)
    spread = {}
    for v in X.PROBE_VIEWS:
        p50s = [docs[t]["views"][v]["p50"] for t in ("q1", "q1s1", "q1s2")]
        p90s = [docs[t]["views"][v]["p90"] for t in ("q1", "q1s1", "q1s2")]
        spread[v] = {
            "p50": {"seeds": p50s, "mean": float(np.mean(p50s)), "min": float(min(p50s)), "max": float(max(p50s)), "range": float(max(p50s) - min(p50s))},
            "p90": {"seeds": p90s, "mean": float(np.mean(p90s)), "min": float(min(p90s)), "max": float(max(p90s)), "range": float(max(p90s) - min(p90s))},
        }
    q1metrics = HERE / "cells" / "q1" / "metrics.json"
    doc = json.load(open(q1metrics))
    doc["seed0"] = True
    doc["seeds"] = {"q1": 0, "q1s1": 1, "q1s2": 2}
    doc["threeSeedSpread"] = spread
    doc["q1Best"] = best
    q1metrics.write_text(json.dumps(doc, indent=2) + "\n")
    print("SPREAD " + json.dumps(spread), flush=True)

main()
