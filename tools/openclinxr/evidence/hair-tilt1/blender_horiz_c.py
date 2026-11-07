#!/usr/bin/env python3
"""Horizontal-test part (c): resampled-64 lit back/profile + IDs."""
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

def visible(state, obj):
    for other in bpy.data.objects:
        if other.type == "CURVES":
            other.hide_render = other.hide_viewport = other != obj
    state["canonical"].hide_render = state["canonical"].hide_viewport = True
    state["cap"].hide_render = state["cap"].hide_viewport = True
    obj.hide_render = obj.hide_viewport = False
    state["bp"].apply_r4_visibility(state["handle"], obj)

def main():
    state = R.ST.build_state()
    r = np.load(E / "resampled-64.npz")
    rdata = {"points": np.asarray(r["points"], float), "radii": np.asarray(r["radii"], np.float32)}
    _P = state["bp"].P
    state["bp"].P = int(rdata["points"].shape[1])
    try:
        obj_r = R.build_hair(state, rdata["points"], rdata["radii"], "horiz_res64_lit", PARAMS)
    finally:
        state["bp"].P = _P
    for view in ("back", "profile_90"):
        visible(state, obj_r)
        R.C.place_camera_relative(state, PARAMS, view)
        R.ST.lights(state, PARAMS)
        scene = bpy.context.scene
        scene.render.resolution_x = scene.render.resolution_y = SIZE
        scene.render.resolution_percentage = 100
        scene.cycles.samples = 64
        scene.cycles.seed = 0
        scene.render.image_settings.file_format = "PNG"
        scene.render.filter_size = 1.5
        scene.render.film_transparent = False
        scene.render.filepath = str(OUT / f"res64-lit-{view}.png")
        old = state["handle"].hair
        state["handle"].hair = obj_r
        try:
            bpy.ops.render.render(write_still=True)
            state["hs"]._render_id(state["handle"], OUT / f"res64-lit-{view}-id.png", SIZE)
        finally:
            state["handle"].hair = old
        print("RENDERED res64", view, flush=True)

main()
