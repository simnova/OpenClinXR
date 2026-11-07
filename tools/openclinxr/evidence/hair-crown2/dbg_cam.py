#!/usr/bin/env python3
"""Debug: print camera/target state and project known 3D points."""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[4]
SCORE = ROOT / "tools/openclinxr/evidence/hair-score/score.py"


def load_score():
    spec = importlib.util.spec_from_file_location("hair_crown2_dbg", SCORE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main():
    S = load_score()
    params, _, _ = S.read_params(Path("tools/openclinxr/evidence/hair-crown2/params.json"))
    landmarks = json.loads(S.LANDMARKS.read_text())
    state = S.R.ST.build_state()
    scene = bpy.context.scene
    print("RES", scene.render.resolution_x, scene.render.resolution_y,
          scene.render.resolution_percentage, flush=True)
    print("TARGET", list(state["handle"].target), flush=True)
    for view in ("front", "back"):
        S.canonical_camera(state, view, landmarks)
        cam = state["handle"].camera
        bpy.context.view_layer.update()
        print(view, "after-canonical loc", [round(float(v), 4) for v in cam.location],
              "rot", [round(float(v), 4) for v in cam.rotation_euler],
              "lens", round(float(cam.data.lens), 3), flush=True)
        S.C.place_camera_relative(state, params, view)
        bpy.context.view_layer.update()
        print(view, "after-relative loc", [round(float(v), 4) for v in cam.location],
              "rot", [round(float(v), 4) for v in cam.rotation_euler],
              "lens", round(float(cam.data.lens), 3), flush=True)
        for name, co in (("crown", (0.0, -0.0535, 1.6599)),
                         ("hairlineC", (0.0, -0.1220, 1.6100)),
                         ("nose", (0.0, -0.1300, 1.4500))):
            ndc = world_to_camera_view(scene, cam, Vector(co))
            print(view, name, "ndc", round(float(ndc.x), 4), round(float(ndc.y), 4),
                  "px", round(float(ndc.x) * 1024, 1),
                  round((1.0 - float(ndc.y)) * 1024, 1), flush=True)


if __name__ == "__main__":
    main()
