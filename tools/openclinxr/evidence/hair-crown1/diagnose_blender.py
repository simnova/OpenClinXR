#!/usr/bin/env python3
"""hair-crown1 STEP 1 diagnosis: front/back in 3 variants (green scalp, hair-only, rim-off).

Geometry/material/rig identical to base (combo strands + tt05 params + rig block
+ TT 0.5). Only visibility/shading changes per variant. Run inside Blender.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import bpy

E = Path(__file__).resolve().parent
COUNT2 = E.parent / "hair-count2"
SCORE = COUNT2 / "score_tt.py"


def load_score_tt():
    spec = importlib.util.spec_from_file_location("hair_crown1_score_tt", SCORE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--strands", required=True)
    parser.add_argument("--params", required=True)
    parser.add_argument("--out", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def main():
    args = cli()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    S = load_score_tt()
    # score_tt.main expects CLI args; call pieces directly instead.
    import pathlib as _pl
    sys.argv = ["score_tt.py", "--strands", args.strands, "--params", args.params,
                "--out", args.out]
    S2 = S.load_score()
    orig_configure = S2.configure_color

    def configure_color_tt(obj, params):
        readback = orig_configure(obj, params)
        node = S2.find_hair_node(obj)
        sockets = {s.identifier: s for s in node.inputs}
        tt = float(params.get("lobe_T", 1.0))
        sockets["TT lobe"].default_value = tt
        return readback

    S2.configure_color = configure_color_tt
    params, _, rig = S2.read_params(_pl.Path(args.params))
    data = S2.strand_data(_pl.Path(args.strands))
    import json as _json
    landmarks = _json.loads(S2.LANDMARKS.read_text())
    state = S2.R.ST.build_state()
    hair, _, _ = S2.build_hair_scored(state, data["points"], data["radii"],
                                      "hair_crown1_diag", params)

    green_mat = bpy.data.materials.new("OCLX_diag_green")
    green_mat.use_nodes = True
    green_mat.node_tree.nodes.clear()
    mout = green_mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    emi = green_mat.node_tree.nodes.new("ShaderNodeEmission")
    emi.inputs["Color"].default_value = (0.0, 1.0, 0.0, 1.0)
    emi.inputs["Strength"].default_value = 1.0
    green_mat.node_tree.links.new(emi.outputs[0], mout.inputs["Surface"])

    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = S2.SIZE
    scene.render.resolution_percentage = 100
    scene.cycles.samples = S2.SAMPLES
    scene.cycles.seed = 0
    scene.render.image_settings.file_format = "PNG"
    scene.render.filter_size = 1.5
    scene.render.film_transparent = False

    for view in ("front", "back"):
        S2.visible(state, hair)
        S2.canonical_camera(state, view, landmarks)
        S2.R.ST.lights(state, params)
        S2.C.place_camera_relative(state, params, view)
        if rig is not None:
            S2.place_rig_all7(state, rig, view)
        old = state["handle"].hair
        state["handle"].hair = hair
        try:
            # (a) green scalp: flat-green emission on all visible meshes
            saved = {}
            for obj in bpy.data.objects:
                if obj.type == "MESH" and not obj.hide_render:
                    saved[obj.name] = list(obj.data.materials)
                    obj.data.materials.clear()
                    obj.data.materials.append(green_mat)
            scene.render.filepath = str(out / f"green_{view}.png")
            bpy.ops.render.render(write_still=True)
            state["hs"]._render_id(state["handle"], out / f"green_{view}-id.png", S2.SIZE)
            for name, mats in saved.items():
                obj = bpy.data.objects.get(name)
                if obj:
                    obj.data.materials.clear()
                    for m in mats:
                        obj.data.materials.append(m)
            print("DIAG_RENDERED green", view, flush=True)

            # (b) hair only: hide every mesh
            S2.visible(state, hair)
            S2.canonical_camera(state, view, landmarks)
            S2.R.ST.lights(state, params)
            S2.C.place_camera_relative(state, params, view)
            if rig is not None:
                S2.place_rig_all7(state, rig, view)
            hidden_mesh = [(o, o.hide_render) for o in bpy.data.objects if o.type == "MESH"]
            for o, _ in hidden_mesh:
                o.hide_render = True
            scene.render.filepath = str(out / f"haironly_{view}.png")
            bpy.ops.render.render(write_still=True)
            state["hs"]._render_id(state["handle"], out / f"haironly_{view}-id.png", S2.SIZE)
            for o, was in hidden_mesh:
                o.hide_render = was
            print("DIAG_RENDERED haironly", view, flush=True)

            # (c) rim off
            S2.visible(state, hair)
            S2.canonical_camera(state, view, landmarks)
            S2.R.ST.lights(state, params)
            S2.C.place_camera_relative(state, params, view)
            if rig is not None:
                S2.place_rig_all7(state, rig, view)
            for light in state["handle"].lights:
                if light.name == "OCLX_rim":
                    light.data.energy = 0.0
            scene.render.filepath = str(out / f"norim_{view}.png")
            bpy.ops.render.render(write_still=True)
            state["hs"]._render_id(state["handle"], out / f"norim_{view}-id.png", S2.SIZE)
            print("DIAG_RENDERED norim", view, flush=True)
        finally:
            state["handle"].hair = old
    print("DIAG_DONE", flush=True)


if __name__ == "__main__":
    main()
