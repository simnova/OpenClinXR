#!/usr/bin/env python3
"""G4 tick A/B: same-frame ortho front renders, pre-T2b vs post-T2b.

Usage: blender --background --python geometric-eye-g4-render.py --
  --pre <postrefit.glb> --post <g4-lash-t2b.glb> --out-dir <evidence-dir>
Writes geometric-eye-g4-tick-pre.png / -post.png (1024px, 200mm ortho at
eye height) + prints DARKPX JSON (dark px in the R-dash x-band lower-lid
box, identical box both frames).
"""
import argparse
import os
import sys

import bpy

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
P = argparse.ArgumentParser()
P.add_argument("--pre", required=True)
P.add_argument("--post", required=True)
P.add_argument("--out-dir", required=True)
ARGS = P.parse_args(ARGV)

for tag, path in (("pre", ARGS.pre), ("post", ARGS.post)):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    print(f"G4RENDER {tag} meshes:",
          len([o for o in bpy.context.scene.objects if o.type == "MESH"]), flush=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.film_transparent = False
    cam_data = bpy.data.cameras.new("G4TickCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 0.2
    cam_data.clip_start = 0.001
    cam = bpy.data.objects.new("G4TickCam", cam_data)
    scene.collection.objects.link(cam)
    # glTF head frame (x right, y up, +z anterior) -> Blender (x, -z, y):
    # face front is Blender -Y; image up is Blender +Z = head +Y.
    cam.location = (0, -0.5, 1.546)
    cam.rotation_euler = (__import__("math").pi / 2, 0, 0)
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (0.9, -0.35, 0.6)
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", "AREA"))
    fill.data.energy = 60.0
    fill.data.size = 0.2
    fill.location = (0.05, -0.3, 1.7)
    scene.collection.objects.link(fill)
    world = bpy.data.worlds.new("g4w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.18, 0.22, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    scene.world = world
    out = os.path.join(ARGS.out_dir, f"geometric-eye-g4-tick-{tag}.png")
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("G4RENDER wrote", out, flush=True)
