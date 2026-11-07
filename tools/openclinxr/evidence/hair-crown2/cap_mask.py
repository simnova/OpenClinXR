#!/usr/bin/env python3
"""hair-crown2 STEP 1: cap-visibility masks (Cycles as the occluder).

Renders the cap (head-mesh UV region that hair covers) as flat-white
emission with every other R4-visible mesh flat black and hair hidden, from
the exact beauty cameras. A white pixel = under-hair scalp is the first
surface along that ray = inside the anatomical hairline. Face/forehead skin
below the hairline can never be white: the cap does not extend there.

Run inside Blender:
  Blender --background --python cap_mask.py -- --params PARAMS.json --out OUTDIR
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import bpy

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
SCORE = ROOT / "tools/openclinxr/evidence/hair-score/score.py"
SIZE = 1024
SAMPLES = 16


def load_score():
    spec = importlib.util.spec_from_file_location("hair_crown2_score_v3m", SCORE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--params", required=True)
    parser.add_argument("--out", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def flat(mat_name, color):
    mat = bpy.data.materials.new(mat_name)
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    emi = mat.node_tree.nodes.new("ShaderNodeEmission")
    emi.inputs["Color"].default_value = (*color, 1.0)
    emi.inputs["Strength"].default_value = 1.0
    mat.node_tree.links.new(emi.outputs[0], out.inputs["Surface"])
    return mat


def main():
    args = cli()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    S = load_score()
    params, _, _ = S.read_params(Path(args.params))
    landmarks = json.loads(S.LANDMARKS.read_text())
    state = S.R.ST.build_state()
    cap = state["cap"]
    white = flat("OCLX_crown2_capwhite", (1.0, 1.0, 1.0))
    black = flat("OCLX_crown2_capblack", (0.0, 0.0, 0.0))
    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.cycles.samples = SAMPLES
    scene.cycles.seed = 0
    scene.render.image_settings.file_format = "PNG"
    scene.render.filter_size = 1.5
    scene.render.film_transparent = False
    for view in ("front", "back"):
        S.canonical_camera(state, view, landmarks)
        S.C.place_camera_relative(state, params, view)
        # Same R4 visibility as beauty, with the cap standing in for hair.
        state["bp"].apply_r4_visibility(state["handle"], cap)
        saved = {}
        for obj in bpy.data.objects:
            if obj.type == "MESH" and not obj.hide_render:
                saved[obj.name] = list(obj.data.materials)
                obj.data.materials.clear()
                obj.data.materials.append(white if obj is cap else black)
        scene.render.filepath = str(out / f"capmask_{view}.png")
        bpy.ops.render.render(write_still=True)
        for name, mats in saved.items():
            obj = bpy.data.objects.get(name)
            if obj is not None:
                obj.data.materials.clear()
                for m in mats:
                    obj.data.materials.append(m)
        print("CAPMASK_RENDERED", view, flush=True)
    print("CAPMASK_DONE", flush=True)


if __name__ == "__main__":
    main()
