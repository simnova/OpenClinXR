#!/usr/bin/env python3
"""G3 seal renders: ortho front captures of the single-eye seal assemblies.

Usage: blender --background --python geometric-eye-g3-seal-render.py --
  --asm-dir <dir-with-g3-*-*.glb> --out-dir <evidence-dir>
Writes geometric-eye-g3-seal-<side>-<pose>.png (1024px, 50mm ortho).
Ortho (not perspective) so mm map linearly and near-clip cannot blank the
frame -- the failure mode met with the perspective sheet harness at 44mm.
"""
import argparse
import math
import os
import sys

import bpy

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
P = argparse.ArgumentParser()
P.add_argument("--asm-dir", required=True)
P.add_argument("--out-dir", required=True)
ARGS = P.parse_args(ARGV)

JOBS = [("L", "bind"), ("L", "closure"), ("L", "slit"), ("R", "closure")]

for side, pose in JOBS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = os.path.join(ARGS.asm_dir, f"g3-{side}-{pose}.glb")
    bpy.ops.import_scene.gltf(filepath=path)
    names = [o.name for o in bpy.context.scene.objects if o.type == "MESH"]
    print(f"G3RENDER {side}-{pose} meshes: {len(names)}", flush=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.film_transparent = False
    cam_data = bpy.data.cameras.new("G3SealCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 0.05
    cam_data.clip_start = 0.001
    cam = bpy.data.objects.new("G3SealCam", cam_data)
    scene.collection.objects.link(cam)
    # assembly is eye-centred head-frame glTF: anterior +z -> Blender -Y.
    cam.location = (0, -0.5, 0)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (0.9, -0.35, 0.6)
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "AREA"))
    fill.data.energy = 60.0
    fill.data.size = 0.2
    fill.location = (0.05, -0.3, 0.15)
    scene.collection.objects.link(fill)
    world = bpy.data.worlds.new("g3w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (
        0.16, 0.18, 0.22, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    scene.world = world
    out = os.path.join(
        ARGS.out_dir, f"geometric-eye-g3-seal-{side}-{pose}.png")
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("G3RENDER wrote", out, flush=True)
