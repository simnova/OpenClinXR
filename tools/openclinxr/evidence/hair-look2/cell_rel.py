#!/usr/bin/env python3
"""S2/S3: camera-relative light probe renders (p6 = b7 material, p7 = p2 colour).

For each view the key and fill are placed at the same azimuth offset,
horizontal radius and height-above-target that they hold relative to the
FRONT camera, rotated to THAT view's camera azimuth. Rim stays fixed.
Usage (inside Blender): Blender --background --python cell_rel.py -- --tag p6 --params /tmp/p6_params.json [--patch-only]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
K = ROOT / "tools/openclinxr/evidence/hair-look1"

sys.path.insert(0, str(HERE))
sys.path.insert(0, str(K))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import experiment as X  # noqa: E402

ST = X.ST

# Measured from b7/g6 rig relative to the front camera (azimuth -90deg in XY):
#   key offset (-1.2,-1.5): az -128.66deg -> delta -38.66deg, r 1.9209, zoff 1.4059
#   fill offset (1.5,-1.0): az -33.69deg -> delta +56.31deg, r 1.8028, zoff 0.9915
KEY = {"dAz": -38.66, "r": 1.9209, "z": 1.4059}
FILL = {"dAz": 56.31, "r": 1.8028, "z": 0.9915}
CAM_AZ = {"front": -90.0, "three_quarter": -45.0, "profile_90": 0.0, "back": 90.0}


def place_camera_relative(state, params, view):
    target = Vector(state["handle"].target)
    az = math.radians(CAM_AZ[view])
    placed = {}
    for light in state["handle"].lights:
        if light.name == "OCLX_key":
            spec, energy = KEY, float(params.get("key_energy", 150.0))
        elif light.name == "OCLX_fill":
            spec, energy = FILL, float(params.get("fill_W", 60.477))
        else:
            continue
        a = az + math.radians(spec["dAz"])
        light.location = (target.x + spec["r"] * math.cos(a),
                          target.y + spec["r"] * math.sin(a),
                          target.z + spec["z"])
        light.data.energy = energy
        light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()
        placed[light.name] = [float(v) for v in light.location]
    return placed


def render_cell_rel(state, kids, tag, params, size=1024, samples=64, seed=0):
    cell = HERE / "cells" / tag
    cell.mkdir(parents=True, exist_ok=True)
    obj = X.make_object(state, kids, "look2_" + tag, .05, params)
    ST.visibility(state, obj)
    ST.lights(state, params)  # base first: sets rim + energies/sizes
    scene = bpy.context.scene
    scene.cycles.samples = samples
    old = state["handle"].hair
    state["handle"].hair = obj
    renders, lights_per_view = {}, {}
    try:
        for view in X.PROBE_VIEWS:
            state["c3"].set_final_view(state["handle"], view)
            lights_per_view[view] = place_camera_relative(state, params, view)
            beauty, ident = cell / f"{view}.png", cell / f"{view}-id.png"
            scene.render.resolution_x = scene.render.resolution_y = size
            scene.render.resolution_percentage = 100
            scene.cycles.samples = samples
            scene.cycles.seed = seed
            scene.render.image_settings.file_format = "PNG"
            scene.render.filter_size = 1.5
            scene.render.film_transparent = False
            scene.render.filepath = str(beauty)
            bpy.ops.render.render(write_still=True)
            state["hs"]._render_id(state["handle"], ident, size)
            renders[view] = {"png": str(beauty), "id": str(ident)}
            print("RENDERED", tag, view, flush=True)
    finally:
        state["handle"].hair = old
    metrics = {v: X.photometrics(cell / f"{v}.png", cell / f"{v}-id.png", v) for v in X.PROBE_VIEWS}
    metrics["front"].update(X.face_and_part(cell / "front.png", cell / "front-id.png"))
    doc = {"tag": tag, "params": params, "radiusMm": .05, "densityFactor": 1,
           "lightMode": "camera_relative", "lightsPerView": lights_per_view,
           "renders": renders, "views": metrics}
    (cell / "metrics.json").write_text(json.dumps(doc, indent=2) + "\n")
    return doc


def render_sparse_rel(state, kids, params, out_name):
    import numpy as np
    cd = np.load(ROOT / "tools/openclinxr/evidence/hair-cap8/cap-v8.npz")
    centre = float(cd["cx"])
    in_band = np.nonzero(np.abs(kids[:, 0, 0] - centre) <= .020)[0]
    ids = in_band[np.linspace(0, len(in_band) - 1, min(400, len(in_band))).astype(int)]
    obj = X.make_object(state, kids[ids], "patch_p7", .05, params)
    ST.visibility(state, obj)
    ST.lights(state, params)
    for o in bpy.data.objects:
        if o.type == "MESH":
            o.hide_render = True
    scene = bpy.context.scene
    state["c3"].set_final_view(state["handle"], "back")
    place_camera_relative(state, params, "back")
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 64
    scene.render.film_transparent = False
    out = HERE / "patches" / out_name
    scene.render.filepath = str(out)
    bpy.ops.render.render(write_still=True)
    print("PATCH_RENDERED", str(out), flush=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--params", required=True)
    ap.add_argument("--patch-only", action="store_true")
    a = ap.parse_args(argv)
    params = json.load(open(a.params))
    import numpy as np
    kids = np.asarray(np.load(K / "cells/g1/strands.npz")["points"], float)
    state = ST.build_state()
    if a.patch_only:
        render_sparse_rel(state, kids, params, "sparse-p7.png")
    else:
        render_cell_rel(state, kids, a.tag, params)


if __name__ == "__main__":
    main()
