#!/usr/bin/env python3
"""Render the HUANG q1 baseline, five lobe probes, and the full-size winner."""
from __future__ import annotations

import json
import sys
from pathlib import Path

E = Path(__file__).resolve().parent
L2 = E.parent / "hair-look2"
K = E.parents[3] / "tools/openclinxr/evidence/hair-look1"
sys.path.insert(0, str(E))
sys.path.insert(0, str(L2))
sys.path.insert(0, str(K))

import numpy as np

import cell_rel as C
import experiment as X
import material as M

C.HERE = E
RIM_FALLBACK = 26.654435328323842
_original_lights = X.ST.lights


def lights_with_rim(state, params):
    _original_lights(state, params)
    energy = float(params.get("rim_W", RIM_FALLBACK))
    for light in state["handle"].lights:
        if light.name == "OCLX_rim":
            light.data.energy = energy


def huang_material(state, obj, params):
    local_state = dict(state)
    local_state["station"] = X.ST
    return M.material(local_state, obj, params, model="HUANG")


X.ST.lights = lights_with_rim
X.ST.material = huang_material
TS = {view: X.target_photometrics(view) for view in X.PROBE_VIEWS}


def fitness(metrics):
    score = 0.0
    parts = {}
    for view in X.PROBE_VIEWS:
        measured, target = metrics[view], TS[view]
        d50 = abs(measured["p50"] - target["p50"]) / target["p50"]
        d90 = abs(measured["p90"] - target["p90"]) / target["p90"]
        score += d50 + d90
        parts[view] = {"d50": d50, "d90": d90}
    measured_bins = metrics["back"]["backProfile"]["bins"]
    target_bins = TS["back"]["backProfile"]["bins"]
    back_l1 = float(np.mean([abs(a - b) for a, b in zip(measured_bins, target_bins)
                             if a is not None and b is not None]))
    score += back_l1
    parts["backL1"] = back_l1
    measured_hl, target_hl = metrics["back"]["highlight"], TS["back"]["highlight"]
    hue = abs(measured_hl["hueDeg"] - target_hl["hueDeg"]) / 30.0
    sat = abs(measured_hl["saturation"] - target_hl["saturation"])
    score += hue + sat
    parts["hue"] = hue
    parts["sat"] = sat
    face = metrics["front"]["faceP50"]
    face_move = abs(face - 0.7275) / 0.7275
    penalty = 10.0 if face_move > 0.05 else 0.0
    score += penalty
    parts.update({"face": face, "faceMove": face_move, "penalty": penalty})
    return score, parts


def view_summary(metrics):
    return {
        view: {
            "p50": metrics[view]["p50"],
            "p90": metrics[view]["p90"],
            "highlight": metrics[view]["highlight"],
            **({"backProfile": metrics[view]["backProfile"]} if view == "back" else {}),
            **({"partSide": metrics[view]["partSide"], "faceP50": metrics[view]["faceP50"]}
               if view == "front" else {}),
        }
        for view in X.PROBE_VIEWS
    }


def main():
    q1_doc = json.load(open(L2 / "cells/q1/metrics.json"))
    q1 = q1_doc["params"]
    base = {**q1, "model": "HUANG", "lobe_R": 1.0, "lobe_T": 1.0, "lobe_SR": 1.0}
    specs = {
        "h1": ({**base, "lobe_R": 0.5}, "Reflection 0.5"),
        "h2": ({**base, "lobe_R": 0.25}, "Reflection 0.25"),
        "h3": ({**base, "lobe_R": 0.5, "lobe_SR": 1.5}, "Reflection 0.5 + Secondary Reflection 1.5"),
        "h4": ({**base, "lobe_T": 0.5}, "Transmission 0.5"),
        "h5": ({**base, "lobe_R": 0.5, "lobe_SR": 1.5,
                "roughness": q1["roughness"] + 0.08},
               "Reflection 0.5 + Secondary Reflection 1.5 + roughness +0.08"),
    }
    kids = np.asarray(np.load(K / "cells/g1/strands.npz")["points"], float)
    state = X.ST.build_state()
    baseline = C.render_cell_rel(state, kids, "huang-q1", base, size=512, samples=32, seed=0)
    compare = {}
    for view in X.PROBE_VIEWS:
        hm, cm = baseline["views"][view], q1_doc["views"][view]
        compare[view] = {
            "huang": {"p50": hm["p50"], "p90": hm["p90"]},
            "q1Chiang": {"p50": cm["p50"], "p90": cm["p90"]},
            "p50Delta": hm["p50"] - cm["p50"],
            "p90Delta": hm["p90"] - cm["p90"],
        }
    huang_check = {
        "blender": "5.1.1",
        "model": "HUANG",
        "parametrization": "MELANIN",
        "melaninAvailableUnderHuang": True,
        "colorHandling": "q1 MELANIN path retained; no conversion required",
        "lobeWeights": {"Reflection": 1.0, "Transmission": 1.0, "Secondary Reflection": 1.0},
        "render": {"size": 512, "samples": 32, "seed": 0, "lightMode": "camera_relative"},
        "params": base,
        "views": view_summary(baseline["views"]),
        "vsQ1Chiang1024x64": compare,
        "note": "Resolution/sample count differ from stored q1, so deltas include sampling and mask-resolution effects.",
    }
    (E / "huang_check.json").write_text(json.dumps(huang_check, indent=2) + "\n")
    print("HUANG_CHECK_DONE", flush=True)

    probe_out = {"base": "huang-q1", "q1Params": q1, "render": {"size": 512, "samples": 32},
                 "target": TS, "probes": {}}
    best = None
    for tag, (params, change) in specs.items():
        doc = C.render_cell_rel(state, kids, tag, params, size=512, samples=32, seed=0)
        score, parts = fitness(doc["views"])
        probe_out["probes"][tag] = {
            "change": change, "params": params, "fitness": score, "parts": parts,
            "views": view_summary(doc["views"]),
        }
        if best is None or score < best[0]:
            best = (score, tag, params)
        print(f"PROBE {tag} fitness {score:.6f}", flush=True)
    probe_out["best"] = {"tag": best[1], "fitness": best[0], "params": best[2]}
    (E / "probes-huang.json").write_text(json.dumps(probe_out, indent=2) + "\n")
    full = C.render_cell_rel(state, kids, "best", best[2], size=1024, samples=64, seed=0)
    full_score, full_parts = fitness(full["views"])
    metrics_path = E / "cells/best/metrics.json"
    full_doc = json.load(open(metrics_path))
    full_doc.update({"selectedFrom": best[1], "probeFitness512": best[0],
                     "fitness1024": full_score, "fitnessParts1024": full_parts})
    metrics_path.write_text(json.dumps(full_doc, indent=2) + "\n")
    print(f"BEST_DONE {best[1]} probe={best[0]:.6f} full={full_score:.6f}", flush=True)


main()
