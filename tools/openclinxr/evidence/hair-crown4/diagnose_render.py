#!/usr/bin/env python3
"""hair-crown4 STEP 1 diagnosis render: hair-only + cap-green, front/three_quarter.

Cap rendered as flat green emission, hair with scored material, everything
else hidden. Root UVs computed in-Blender via world_to_camera_view and saved
for PIL overlay (red dots). No liner, no strip.

Run inside Blender:
  Blender --background --python diagnose_render.py -- \
    --strands SPREAD.npz --params PARAMS.json --out OUTDIR
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import bpy
import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
SCORE = ROOT / "tools/openclinxr/evidence/hair-score/score.py"
SIZE = 1024
SAMPLES = 64


def load_score():
    spec = importlib.util.spec_from_file_location("hair_crown4_diag_score", SCORE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--strands", required=True)
    p.add_argument("--params", required=True)
    p.add_argument("--out", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


def flat_green():
    mat = bpy.data.materials.new("OCLX_crown4_capgreen")
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    emi = mat.node_tree.nodes.new("ShaderNodeEmission")
    emi.inputs["Color"].default_value = (0.0, 1.0, 0.0, 1.0)
    emi.inputs["Strength"].default_value = 1.0
    mat.node_tree.links.new(emi.outputs[0], out.inputs["Surface"])
    return mat


def flat_black():
    mat = bpy.data.materials.new("OCLX_crown4_capblack")
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    emi = mat.node_tree.nodes.new("ShaderNodeEmission")
    emi.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    emi.inputs["Strength"].default_value = 1.0
    mat.node_tree.links.new(emi.outputs[0], out.inputs["Surface"])
    return mat
    mat = bpy.data.materials.new("OCLX_crown4_capgreen")
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    emi = mat.node_tree.nodes.new("ShaderNodeEmission")
    emi.inputs["Color"].default_value = (0.0, 1.0, 0.0, 1.0)
    emi.inputs["Strength"].default_value = 1.0
    mat.node_tree.links.new(emi.outputs[0], out.inputs["Surface"])
    return mat


def main():
    args = cli()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    S = load_score()
    orig_configure = S.configure_color

    def configure_color_tt(obj, params):
        readback = orig_configure(obj, params)
        node = S.find_hair_node(obj)
        sockets = {s.identifier: s for s in node.inputs}
        sockets["TT lobe"].default_value = float(params.get("lobe_T", 1.0))
        readback["TT lobe"] = float(sockets["TT lobe"].default_value)
        return readback

    S.configure_color = configure_color_tt
    params, _, rig = S.read_params(Path(args.params))
    data = S.strand_data(Path(args.strands))
    landmarks = json.loads(S.LANDMARKS.read_text())
    state = S.R.ST.build_state()
    cap = state["cap"]
    green = flat_green()
    saved = list(cap.data.materials)
    cap.data.materials.clear()
    cap.data.materials.append(green)

    hair, _, _ = S.build_hair_scored(
        state, data["points"], data["radii"], "hair_crown4_diag", params)
    # cap green; every other R4-visible mesh flat black (cap_mask.py
    # precedent: black occludes the cap far side so green = first-surface
    # scalp only). Hair stays visible.
    black = flat_black()
    state["bp"].apply_r4_visibility(state["handle"], hair)
    saved_all: dict = {}
    for o in bpy.data.objects:
        if o.type == "MESH" and not o.hide_render and o is not cap:
            saved_all[o.name] = list(o.data.materials)
            o.data.materials.clear()
            o.data.materials.append(black)
    cap.hide_render = cap.hide_viewport = False
    hair.hide_render = hair.hide_viewport = False

    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.cycles.samples = SAMPLES
    scene.cycles.seed = 0
    scene.render.image_settings.file_format = "PNG"
    scene.render.filter_size = 1.5
    scene.render.film_transparent = False

    roots = np.asarray(np.load(args.strands)["roots"], dtype=float)
    from bpy_extras.object_utils import world_to_camera_view
    uv_record = {}
    for view in ("front", "three_quarter"):
        S.canonical_camera(state, view, landmarks)
        S.C.place_camera_relative(state, params, view)
        if rig is not None:
            try:
                S.place_rig_all7(state, rig, view)
            except Exception as err:
                print("DIAG rig skipped", err, flush=True)
        scene.render.filepath = str(out / f"diag_{view}.png")
        bpy.ops.render.render(write_still=True)
        cam = state["handle"].camera
        scene_obj = scene
        uvs = []
        step = max(len(roots) // 6000, 1)
        for i in range(0, len(roots), step):
            co = roots[i]
            from mathutils import Vector
            uv = world_to_camera_view(scene_obj, cam, Vector((float(co[0]), float(co[1]), float(co[2]))))
            uvs.append([int(i), round(float(uv.x * SIZE), 1), round(float((1.0 - uv.y) * SIZE), 1), round(float(uv.z), 4)])
        uv_record[view] = {
            "camera": [[float(v) for v in row] for row in cam.matrix_world],
            "lensMm": float(cam.data.lens),
            "rootStep": step,
            "uvs": uvs,
        }
        print("DIAG_RENDERED", view, len(uvs), flush=True)
    (out / "diag_root_uv.json").write_text(json.dumps(uv_record) + "\n")
    cap.data.materials.clear()
    for m in saved:
        cap.data.materials.append(m)
    for name, mats in saved_all.items():
        obj = bpy.data.objects.get(name)
        if obj is not None:
            obj.data.materials.clear()
            for m in mats:
                obj.data.materials.append(m)
    print("DIAG_DONE", flush=True)


if __name__ == "__main__":
    main()
