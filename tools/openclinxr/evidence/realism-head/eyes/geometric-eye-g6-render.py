#!/usr/bin/env python3
"""G6 EEVEE neutral renders: full-head bake, front portrait + eye-band
closeups at bind (rest) and closure (seal), G3/G4 neutral recipe (sun 3.0 +
AREA fill 60 + world 0.6).

Usage: blender --background --python geometric-eye-g6-render.py --
  --head <g6-head.glb> --out-dir <evidence-dir>
Writes geometric-eye-g6-eevee-{portrait,eyeband}-{bind,closure}.png (1280px).
"""
import argparse
import math
import os
import sys

import bpy

ARGV = sys.argv[sys.argv.index("__") + 1:] if "__" in sys.argv else (
    sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
P = argparse.ArgumentParser()
P.add_argument("--head", required=True)
P.add_argument("--out-dir", required=True)
ARGS = P.parse_args(ARGV)

EYE_Y = 1.546

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=ARGS.head)
print("G6RENDER meshes:", len([o for o in bpy.context.scene.objects if o.type == "MESH"]), flush=True)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1280
scene.render.resolution_y = 1280
scene.render.film_transparent = False

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.0
sun.rotation_euler = (0.9, -0.35, 0.6)
scene.collection.objects.link(sun)
fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "AREA"))
fill.data.energy = 60.0
fill.data.size = 0.2
fill.location = (0.05, -0.3, 1.7)
scene.collection.objects.link(fill)
world = bpy.data.worlds.new("g6w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.18, 0.22, 1.0)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
scene.world = world


def set_closure(v):
    n = 0
    for o in bpy.context.scene.objects:
        if o.type != "MESH" or not o.data.shape_keys:
            continue
        for k in ("eye-left-closure", "eye-right-closure", "eye-left-slit", "eye-right-slit"):
            kb = o.data.shape_keys.key_blocks.get(k)
            if kb is not None:
                kb.value = v
                n += 1
    print(f"G6RENDER closure keys set: {n}", flush=True)
    bpy.context.view_layer.update()


def shoot(tag, ortho_scale, cy, pose):
    set_closure(1.0 if pose == "closure" else 0.0)
    cam_data = bpy.data.cameras.new("G6Cam" + tag)
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho_scale
    cam_data.clip_start = 0.001
    cam = bpy.data.objects.new("G6Cam" + tag, cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0, -0.5, cy)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = cam
    out = os.path.join(ARGS.out_dir, f"geometric-eye-g6-eevee-{tag}-{pose}.png")
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("G6RENDER wrote", out, flush=True)


shoot("portrait", 0.42, 1.52, "bind")
shoot("eyeband", 0.13, EYE_Y, "bind")
shoot("eyeband", 0.13, EYE_Y, "closure")
shoot("portrait", 0.42, 1.52, "closure")
