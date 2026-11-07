#!/usr/bin/env python3
"""Look3 lobe-balance probes on q1. Runs inside Blender background.
Copied logic (not edited) from L2 cell_rel.render_cell_rel + q1_search fitness.
Redirects cells into E (hair-look3) via C.HERE patch; L2 untouched.
Usage: Blender --background --python run_probes_blender.py
"""
from __future__ import annotations
import json, sys
from pathlib import Path

E = Path(__file__).resolve().parent
L2 = E.parent / "hair-look2"
K = E.parents[3] / "tools/openclinxr/evidence/hair-look1"
sys.path.insert(0, str(L2))
sys.path.insert(0, str(K))

import numpy as np
import experiment as X
import cell_rel as C

C.HERE = E  # probe cells land in E/cells/*

# Rim honour (copied from L2/q1_search.py: rim searched, ST hard-codes it)
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

# Lobe overrides (new vs L2 station.material; lives here in E)
# Display names differ from socket identifiers (measured 2026-10-14):
#   "Reflection" -> "R lobe", "Transmission" -> "TT lobe",
#   "Secondary Reflection" -> "TRT lobe". Access MUST use identifiers.
LOBE_IDS = {"lobe_R": "R lobe", "lobe_T": "TT lobe", "lobe_SR": "TRT lobe"}
BASE_OFFSET = 0.03490658476948738  # Blender default Offset (2 deg), per lobes.json readback
_orig_mat = X.ST.material
def _mat_with_lobes(state, obj, params):
    mat = _orig_mat(state, obj, params)
    # Keyed lookup (inputs["Reflection"] / inputs["R lobe"]) raises KeyError
    # in Blender 5.1; iterate and match instead (readback path does the same).
    want = {}
    for key, ident in LOBE_IDS.items():
        if key in params:
            want[ident] = float(params[key])
    for n in mat.node_tree.nodes:
        if n.bl_idname == "ShaderNodeBsdfHairPrincipled":
            for sock in n.inputs:
                if sock.identifier in want:
                    sock.default_value = want[sock.identifier]
            if "offset_mult" in params:
                for sock in n.inputs:
                    if sock.identifier == "Offset" or sock.name == "Offset":
                        sock.default_value = BASE_OFFSET * float(params["offset_mult"])
    return mat
X.ST.material = _mat_with_lobes

TS = {v: X.target_photometrics(v) for v in X.PROBE_VIEWS}

def fitness(metrics):
    fit, parts = 0.0, {}
    for v in X.PROBE_VIEWS:
        m, t = metrics[v], TS[v]
        d50 = abs(m["p50"] - t["p50"]) / t["p50"]
        d90 = abs(m["p90"] - t["p90"]) / t["p90"]
        fit += d50 + d90
        parts[v] = {"d50": d50, "d90": d90}
    mb, tb = metrics["back"]["backProfile"]["bins"], TS["back"]["backProfile"]["bins"]
    l1 = float(np.mean([abs(a - b) for a, b in zip(mb, tb) if a is not None and b is not None]))
    fit += l1
    parts["backL1"] = l1
    mh, th = metrics["back"]["highlight"], TS["back"]["highlight"]
    dh = abs(mh["hueDeg"] - th["hueDeg"]) / 30.0 if mh["hueDeg"] is not None else 6.0
    ds = abs(mh["saturation"] - th["saturation"]) if mh["saturation"] is not None else 1.0
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
    q1 = json.load(open(L2 / "cells/q1/metrics.json"))["params"]
    probes = {
        "r1": ({**q1, "lobe_R": 0.5}, "Reflection 0.5"),
        "r2": ({**q1, "lobe_R": 0.25}, "Reflection 0.25"),
        "r3": ({**q1, "lobe_R": 0.5, "lobe_SR": 1.5}, "Reflection 0.5 + Secondary Reflection 1.5"),
        "r4": ({**q1, "roughness": q1["roughness"] + 0.08, "lobe_R": 0.5}, "roughness +0.08 with Reflection 0.5"),
        "r5": ({**q1, "offset_mult": 2.0}, "Offset (cuticle tilt) 2x"),
    }
    kids = np.asarray(np.load(K / "cells/g1/strands.npz")["points"], float)
    state = X.ST.build_state()
    out = {"base": "q1", "q1_params": q1, "probes": {},
           "r6": "SKIPPED: Principled Hair BSDF exposes lobe weights (lobes.json); no Chiang-without-weights case, no Huang switch"}
    for tag, (p, change) in probes.items():
        doc = C.render_cell_rel(state, kids, tag, p, size=512, samples=32, seed=0)
        f, parts = fitness(doc["views"])
        # lobe readback on the built object is gone with the temp object; record requested values
        out["probes"][tag] = {"change": change, "params": p, "fitness": f, "parts": parts,
                              "views": doc["views"]}
        print(f"PROBE {tag} fitness {f:.4f}", flush=True)
    (E / "probes.json").write_text(json.dumps(out, indent=2) + "\n")
    print("PROBES_DONE", flush=True)

main()
