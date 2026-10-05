#!/usr/bin/env python3
"""Blender EEVEE front + three-quarter render of the factory-treated ECG cart.

Usage:
    blender -b --python render-ecg-cart-factory.py -- <cart.glb> <outdir>

1280x1280 EEVEE (not Workbench: Workbench discards baked PBR materials).
Background is solid dark studio grey, distinct from the cart's mid-grey body.
Camera uses the frozen ecg-cart-camera-freeze.json center/radius.
"""

import math
import os
import sys

import bpy


def parse_args():
    argv = sys.argv
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    if len(args) != 2:
        raise SystemExit("usage: blender -b --python render-ecg-cart-factory.py -- <cart.glb> <outdir>")
    return args[0], args[1]


def track_to(camera, target):
    constraint = camera.constraints.new(type="TRACK_TO")
    constraint.target = target
    constraint.track_axis = "TRACK_NEGATIVE_Z"
    constraint.up_axis = "UP_Y"


def main():
    glb_path, outdir = parse_args()
    os.makedirs(outdir, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 1280
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.eevee.taa_render_samples = 64

    world = bpy.data.worlds.new("StudioGrey")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.055, 0.055, 0.06, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    scene.world = world

    center = (-0.00834, 0.0, 0.01587)
    radius = 1.79126
    bpy.ops.object.empty_add(location=center)
    target = bpy.context.active_object
    dist = radius * 1.5

    sun = bpy.data.lights.new("Key", type="SUN")
    sun.energy = 3.0
    sun_obj = bpy.data.objects.new("Key", sun)
    scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(50), 0.0, math.radians(30))
    fill = bpy.data.lights.new("Fill", type="SUN")
    fill.energy = 0.8
    fill_obj = bpy.data.objects.new("Fill", fill)
    scene.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(30), 0.0, math.radians(-140))

    views = {"front": (0.0, 10.0), "three_quarter": (40.0, 14.0)}
    for name, (azim_deg, elev_deg) in views.items():
        azim = math.radians(azim_deg)
        elev = math.radians(elev_deg)
        loc = (
            center[0] + dist * math.cos(elev) * math.sin(azim),
            center[1] - dist * math.cos(elev) * math.cos(azim),
            center[2] + dist * math.sin(elev),
        )
        cam_data = bpy.data.cameras.new(name)
        cam_data.lens = 50.0
        cam_obj = bpy.data.objects.new(name, cam_data)
        scene.collection.objects.link(cam_obj)
        cam_obj.location = loc
        track_to(cam_obj, target)
        scene.camera = cam_obj
        scene.render.filepath = os.path.join(outdir, f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"wrote {scene.render.filepath}", flush=True)


main()
