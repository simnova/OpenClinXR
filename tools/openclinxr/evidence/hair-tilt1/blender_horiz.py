#!/usr/bin/env python3
"""Horizontal-test Blender renders: (b) a1 unlit emission back/profile, (c) resampled-64 lit back/profile."""
from __future__ import annotations
import sys, json
from pathlib import Path
import bpy
import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
R1 = ROOT / "tools/openclinxr/evidence/hair-real1"
I1 = ROOT / "tools/openclinxr/evidence/hair-int1"
K1 = ROOT / "tools/openclinxr/evidence/hair-look1"
G6 = ROOT / "tools/openclinxr/evidence/hair-geo6"
L2 = ROOT / "tools/openclinxr/evidence/hair-look2"
L5 = ROOT / "tools/openclinxr/evidence/hair-look5"
sys.path[:0] = [str(R1), str(I1), str(K1), str(G6), str(L2)]
import run_blender as R

PARAMS = json.load(open(L5 / "cells/best/metrics.json"))["params"]
SIZE = 1024
OUT = E / "horiz-renders"
OUT.mkdir(parents=True, exist_ok=True)

def build_object(state, data, name):
    return R.build_hair(state, data["points"], data["radii"], name, PARAMS)

def visible(state, obj):
    for other in bpy.data.objects:
        if other.type == "CURVES":
            other.hide_render = other.hide_viewport = other != obj
    state["canonical"].hide_render = state["canonical"].hide_viewport = True
    state["cap"].hide_render = state["cap"].hide_viewport = True
    obj.hide_render = obj.hide_viewport = False
    state["bp"].apply_r4_visibility(state["handle"], obj)

def emission_material(obj):
    mat = bpy.data.materials.new("OCLX_horiz_flat_emission")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0.5, 0.5, 0.5, 1.0)
    em.inputs["Strength"].default_value = 1.0
    links.new(em.outputs[0], out.inputs["Surface"])
    obj.data.materials.clear()
    obj.data.materials.append(mat)

def render_lit(state, obj, path, view, samples=64):
    visible(state, obj)
    R.C.place_camera_relative(state, PARAMS, view)
    R.ST.lights(state, PARAMS)
    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.cycles.seed = 0
    scene.render.image_settings.file_format = "PNG"
    scene.render.filter_size = 1.5
    scene.render.film_transparent = False
    scene.render.filepath = str(path)
    old = state["handle"].hair
    state["handle"].hair = obj
    try:
        bpy.ops.render.render(write_still=True)
    finally:
        state["handle"].hair = old
    print("RENDERED", path.name, view, flush=True)

def render_id(state, obj, path):
    visible(state, obj)
    old = state["handle"].hair
    state["handle"].hair = obj
    try:
        state["hs"]._render_id(state["handle"], path, SIZE)
    finally:
        state["handle"].hair = old
    print("ID", path.name, flush=True)

def main():
    state = R.ST.build_state()
    # (b) a1 unlit
    d = np.load(R1 / "cells/a1/strands.npz")
    data = {"points": np.asarray(d["points"], float), "radii": np.asarray(d["radii"], np.float32)}
    obj_u = build_object(state, data, "horiz_a1_unlit")
    emission_material(obj_u)
    for view in ("back", "profile_90"):
        R.C.place_camera_relative(state, PARAMS, view)
        render_lit(state, obj_u, OUT / f"a1-unlit-{view}.png", view, samples=16)
    # (c) resampled lit (builder is fixed at P=32; patch to 64 for this build only)
    r = np.load(E / "resampled-64.npz")
    rdata = {"points": np.asarray(r["points"], float), "radii": np.asarray(r["radii"], np.float32)}
    _P = state["bp"].P
    state["bp"].P = int(rdata["points"].shape[1])
    try:
        obj_r = R.build_hair(state, rdata["points"], rdata["radii"], "horiz_res64_lit", PARAMS)
    finally:
        state["bp"].P = _P
    for view in ("back", "profile_90"):
        render_lit(state, obj_r, OUT / f"res64-lit-{view}.png", view, samples=64)
        R.C.place_camera_relative(state, PARAMS, view)
        render_id(state, obj_r, OUT / f"res64-lit-{view}-id.png")

main()
