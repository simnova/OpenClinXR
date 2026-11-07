#!/usr/bin/env python3
"""Q1 CMA-ES light+colour search from p7 start. Runs inside Blender background.

Search dims: melanin, redness, roughness, key_energy, key_elev_deg, fill_W, rim_W.
Fixed: key_azimuth_delta_deg, key_size_m, fill_elev_deg, root_dark (p7 values).
Renders via cell_rel.render_cell_rel (size 512, samples 32, seed 0).
Fitness: sum over views |p50-TS|/TS + |p90-TS|/TS + back-profile L1 to TS bins
  + |hue-TS|/30 + |sat-TS| (back highlight); +10 penalty if face cheek p50
  moves >5% from b7 0.7275. 18 evals (3 gens x pop 6). Logs q1-search.jsonl.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
K = ROOT / "tools/openclinxr/evidence/hair-look1"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(K))

import numpy as np

import bpy  # noqa: F401  (inside Blender)

import experiment as X
import cell_rel as C
from cmaes import CMAES

NAMES = ("melanin", "redness", "roughness", "key_energy",
         "key_elev_deg", "fill_W", "rim_W")
BOUNDS = ((0.80, 0.97), (0.30, 0.60), (0.12, 0.35), (40., 200.),
          (25., 70.), (20., 140.), (0., 60.))
START = {"melanin": 0.94, "redness": 0.15, "roughness": 0.30,
         "key_energy": 121.20520887976956,
         "key_elev_deg": 40.161821774411294,
         "fill_W": 83.34681733694208, "rim_W": 26.654435328323842}
FIXED = {"key_azimuth_delta_deg": -31.689290105080133,
         "key_size_m": 1.6326859138340684,
         "fill_elev_deg": 15.0, "root_dark": 0.05}
RIM_FALLBACK = 26.654435328323842

# ST.lights hard-codes rim to SEARCH_BASE rim_W; honour searched rim_W.
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

TS = {v: X.target_photometrics(v) for v in X.PROBE_VIEWS}


def start_vec():
    return [(min(max(START[n], lo), hi) - lo) / (hi - lo)
            for n, (lo, hi) in zip(NAMES, BOUNDS)]


def denorm(v):
    return {n: lo + float(x) * (hi - lo)
            for n, x, (lo, hi) in zip(NAMES, v, BOUNDS)}


def fitness(metrics):
    fit = 0.0
    parts = {}
    for v in X.PROBE_VIEWS:
        m = metrics[v]
        t = TS[v]
        d50 = abs(m["p50"] - t["p50"]) / t["p50"]
        d90 = abs(m["p90"] - t["p90"]) / t["p90"]
        fit += d50 + d90
        parts[v] = {"d50": d50, "d90": d90}
    mb = metrics["back"]["backProfile"]["bins"]
    tb = TS["back"]["backProfile"]["bins"]
    l1 = float(np.mean([abs(a - b) for a, b in zip(mb, tb)
                        if a is not None and b is not None]))
    fit += l1
    parts["backL1"] = l1
    mh = metrics["back"]["highlight"]
    th = TS["back"]["highlight"]
    dh = abs(mh["hueDeg"] - th["hueDeg"]) / 30.0 \
        if mh["hueDeg"] is not None else 6.0
    ds = abs(mh["saturation"] - th["saturation"]) \
        if mh["saturation"] is not None else 1.0
    fit += dh + ds
    parts["hue"] = dh
    parts["sat"] = ds
    face = metrics["front"]["faceP50"]
    move = abs(face - 0.7275) / 0.7275
    pen = 10.0 if move > 0.05 else 0.0
    fit += pen
    parts["face"] = face
    parts["faceMove"] = move
    parts["penalty"] = pen
    return fit, parts


def main():
    kids = np.asarray(np.load(K / "cells/g1/strands.npz")["points"], float)
    state = X.ST.build_state()
    rng = np.random.RandomState(0)
    opt = CMAES(start_vec(), 0.25, 6, rng)
    log = open(HERE / "q1-search.jsonl", "w")
    best = None
    idx = 0
    for g in range(3):
        vecs = opt.ask()
        scores = []
        for v in vecs:
            p = denorm(v)
            p.update(FIXED)
            tag = f"q1-eval{idx:02d}"
            doc = C.render_cell_rel(state, kids, tag, p,
                                    size=512, samples=32, seed=0)
            f, parts = fitness(doc["views"])
            rec = {"eval": idx, "gen": g, "params": p, "fitness": f,
                   "parts": parts,
                   "views": {vv: {"p50": doc["views"][vv]["p50"],
                                  "p90": doc["views"][vv]["p90"]}
                             for vv in X.PROBE_VIEWS}}
            log.write(json.dumps(rec) + "\n")
            log.flush()
            print(f"EVAL {idx} gen {g} fitness {f:.4f}", flush=True)
            scores.append(f)
            if best is None or f < best[0]:
                best = (f, idx, p)
            idx += 1
        opt.tell(vecs, scores)
    log.close()
    json.dump({"fitness": best[0], "eval": best[1], "params": best[2]},
              open(HERE / "q1-best.json", "w"), indent=2)
    print("BEST " + json.dumps({"fitness": best[0], "eval": best[1],
                                "params": best[2]}), flush=True)


main()
