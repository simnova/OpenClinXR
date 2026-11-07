#!/usr/bin/env python3
"""HUANG colour/variation CMA-ES search from hair-look3 h5.

Runs inside Blender. Geometry is the immutable hair-look1 g1 strand set used
by hair-look3. Search renders are 512px/32 samples; the winner is rerendered at
1024px/64 samples with Cycles seeds 0, 1, and 2.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

E = Path(__file__).resolve().parent
L3 = E.parent / "hair-look3"
L2 = E.parent / "hair-look2"
K = E.parents[3] / "tools/openclinxr/evidence/hair-look1"
sys.path.insert(0, str(L3))
sys.path.insert(0, str(L2))
sys.path.insert(0, str(K))

import bpy  # noqa: F401
import numpy as np
from cmaes import CMAES

import cell_rel as C
import experiment as X
import material as M

C.HERE = E

NAMES = ("melanin", "redness", "lobe_R", "lobe_SR", "roughness", "random")
BOUNDS = (
    (0.78, 0.95),
    (0.25, 0.75),
    (0.35, 0.70),
    (0.80, 2.00),
    (0.25, 0.45),
    (0.00, 0.30),
)
START = {
    "melanin": 0.95,  # h5=0.97, clipped to the requested search range
    "redness": 0.37295693048012835,
    "lobe_R": 0.5,
    "lobe_SR": 1.5,
    "roughness": 0.38419042212641097,
    "random": 0.0,
}
FIXED = {
    "key_energy": 149.37668031234784,
    "key_elev_deg": 46.53246179277051,
    "fill_W": 51.79189232647554,
    "rim_W": 5.274066184423127,
    "key_azimuth_delta_deg": -31.689290105080133,
    "key_size_m": 1.6326859138340684,
    "fill_elev_deg": 15.0,
    "root_dark": 0.05,
    "model": "HUANG",
    "lobe_T": 1.0,
}
FACE_TARGET = 0.7335
RIM_FALLBACK = FIXED["rim_W"]


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
    mat = M.material(local_state, obj, params, model="HUANG")
    for node in mat.node_tree.nodes:
        if node.bl_idname == "ShaderNodeBsdfHairPrincipled":
            for socket in node.inputs:
                if socket.identifier == "Random" or socket.name == "Random":
                    socket.default_value = float(params.get("random", 0.0))
    return mat


X.ST.lights = lights_with_rim
X.ST.material = huang_material
TS = {view: X.target_photometrics(view) for view in X.PROBE_VIEWS}


def target_front_regions():
    image = X.rgb(X.target_image("front"))
    mask = X.mask_l(X.target_mask("front"))
    y = X.luminance(image)
    yy, xx = np.nonzero(mask)
    y0, y1, x0, x1 = yy.min(), yy.max(), xx.min(), xx.max()
    h, w = y1 - y0 + 1, x1 - x0 + 1
    yy_grid, xx_grid = np.indices(mask.shape)
    crown = mask & (yy_grid <= y0 + .35 * h) & (xx_grid >= x0 + .35 * w) & (xx_grid <= x0 + .65 * w)
    sides = mask & (yy_grid >= y0 + .18 * h) & (yy_grid <= y0 + .68 * h) & ((xx_grid <= x0 + .28 * w) | (xx_grid >= x0 + .72 * w))
    return {
        "partSide": float(y[crown].mean() / max(y[sides].mean(), 1e-12)),
        "faceP50": FACE_TARGET,
    }


TS["front"].update(target_front_regions())


def start_vec():
    return np.asarray([
        (min(max(START[name], low), high) - low) / (high - low)
        for name, (low, high) in zip(NAMES, BOUNDS)
    ])


def denorm(vector):
    return {
        name: low + float(value) * (high - low)
        for name, value, (low, high) in zip(NAMES, vector, BOUNDS)
    }


def hue_delta(a, b):
    # Preserve the L2 fitness definition exactly (non-circular absolute hue).
    return abs(a - b) / 30.0


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
    back_l1 = float(np.mean([
        abs(a - b) for a, b in zip(measured_bins, target_bins)
        if a is not None and b is not None
    ]))
    score += back_l1
    parts["backL1"] = back_l1
    measured_hl = metrics["back"]["highlight"]
    target_hl = TS["back"]["highlight"]
    dh = hue_delta(measured_hl["hueDeg"], target_hl["hueDeg"]) if measured_hl["hueDeg"] is not None else 6.0
    ds = abs(measured_hl["saturation"] - target_hl["saturation"]) if measured_hl["saturation"] is not None else 1.0
    score += 3.0 * dh + 3.0 * ds
    parts["hue"] = dh
    parts["sat"] = ds
    parts["hueWeight"] = 3.0
    parts["satWeight"] = 3.0
    face = metrics["front"]["faceP50"]
    face_move = abs(face - FACE_TARGET) / FACE_TARGET
    penalty = 10.0 if face_move > 0.05 else 0.0
    score += penalty
    parts.update({"face": face, "faceMove": face_move, "penalty": penalty})
    return score, parts


def compact_views(views):
    return {
        view: {
            "p50": views[view]["p50"],
            "p90": views[view]["p90"],
            "highlight": views[view]["highlight"],
            **({"partSide": views[view]["partSide"], "faceP50": views[view]["faceP50"]} if view == "front" else {}),
            **({"backProfile": views[view]["backProfile"]} if view == "back" else {}),
        }
        for view in X.PROBE_VIEWS
    }


def seed_spread(seed_docs):
    out = {"seeds": [0, 1, 2], "views": {}}
    maxima = []
    for view in X.PROBE_VIEWS:
        row = {}
        for key in ("p50", "p90"):
            values = [doc["views"][view][key] for doc in seed_docs]
            spread = max(values) - min(values)
            row[key] = {"min": min(values), "max": max(values), "spread": spread}
            maxima.append(spread)
        for key in ("hueDeg", "saturation"):
            values = [doc["views"][view]["highlight"][key] for doc in seed_docs]
            spread = max(values) - min(values)
            row[key] = {"min": min(values), "max": max(values), "spread": spread}
        if view == "front":
            for key in ("partSide", "faceP50"):
                values = [doc["views"][view][key] for doc in seed_docs]
                spread = max(values) - min(values)
                row[key] = {"min": min(values), "max": max(values), "spread": spread}
                maxima.append(spread)
        out["views"][view] = row
    out["maxP50P90PartFaceSpread"] = max(maxima)
    return out


def main():
    E.mkdir(parents=True, exist_ok=True)
    kids = np.asarray(np.load(K / "cells/g1/strands.npz")["points"], float)
    state = X.ST.build_state()
    optimizer = CMAES(start_vec(), 0.22, 6, np.random.RandomState(4))
    best = None
    with (E / "search.jsonl").open("w") as log:
        index = 0
        for generation in range(3):
            vectors = optimizer.ask()
            scores = []
            for vector in vectors:
                params = denorm(vector)
                params.update(FIXED)
                tag = f"eval{index:02d}"
                doc = C.render_cell_rel(state, kids, tag, params, size=512, samples=32, seed=0)
                score, parts = fitness(doc["views"])
                record = {
                    "eval": index,
                    "generation": generation,
                    "params": params,
                    "fitness": score,
                    "parts": parts,
                    "views": compact_views(doc["views"]),
                }
                log.write(json.dumps(record) + "\n")
                log.flush()
                print(f"EVAL {index} gen {generation} fitness {score:.6f}", flush=True)
                scores.append(score)
                if best is None or score < best[0]:
                    best = (score, index, dict(params), parts)
                index += 1
            optimizer.tell(vectors, scores)

    seed_docs = []
    for seed, tag in ((0, "best"), (1, "best_s1"), (2, "best_s2")):
        seed_docs.append(C.render_cell_rel(state, kids, tag, best[2], size=1024, samples=64, seed=seed))
    full_score, full_parts = fitness(seed_docs[0]["views"])
    spread = seed_spread(seed_docs)
    best_path = E / "cells/best/metrics.json"
    best_doc = json.loads(best_path.read_text())
    best_doc.update({
        "selectedEval": best[1],
        "searchFitness512": best[0],
        "searchFitnessParts512": best[3],
        "fitness1024": full_score,
        "fitnessParts1024": full_parts,
        "targets": TS,
        "seedMetrics": {str(seed): compact_views(doc["views"]) for seed, doc in enumerate(seed_docs)},
        "seedSpread": spread,
        "geometrySource": str(K / "cells/g1/strands.npz"),
        "geometryChanged": False,
        "silhouetteChanged": False,
    })
    best_path.write_text(json.dumps(best_doc, indent=2) + "\n")
    (E / "best.json").write_text(json.dumps({
        "fitness512": best[0],
        "eval": best[1],
        "params": best[2],
        "fitness1024": full_score,
    }, indent=2) + "\n")
    print("BEST " + json.dumps({"eval": best[1], "fitness512": best[0], "fitness1024": full_score, "params": best[2]}), flush=True)


main()
