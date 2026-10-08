"""Baseline + Imagine-albedo rebake T-pose renders of the MPFB aisha GLB.

Usage: blender --background --python skin_llm_sheet_rebake_probe_tpose.py -- <glb> <imagine_albedo_png> <outdir>

1. Imports the GLB, hides hair objects, Cycles front+back -> front.png, back.png.
2. Assigns the Imagine albedo png to the MPFB skin material base color,
   re-renders front+back -> rebaked_front.png, rebaked_back.png.
   (The albedo quadrant crop is done outside Blender with system python;
   Blender's bundled python has no PIL.)
New probe file only; never touches materialize_mpfb_humanoid_candidate.py.
"""
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, ALBEDO, OUTDIR = argv[0], argv[1], argv[2]
os.makedirs(OUTDIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

# Hide hair if present (keep head/face visible for the skin rebake read).
for o in bpy.context.scene.objects:
    if "hair" in o.name.lower() and o.type in {"MESH", "CURVE"}:
        o.hide_render = True
        o.hide_viewport = True
        print("hid hair object:", o.name)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 64
scene.cycles.device = "CPU"
scene.render.resolution_x = 768
scene.render.resolution_y = 1024
scene.render.film_transparent = False

objs = [o for o in scene.objects if o.type == "MESH" and not o.hide_render]
xs, ys, zs = [], [], []
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        xs.append(w.x)
        ys.append(w.y)
        zs.append(w.z)
cx, cy, cz = sum(xs) / len(xs), sum(ys) / len(ys), sum(zs) / len(zs)
height = max(zs) - min(zs)
depth = max(ys) - min(ys)

cam_data = bpy.data.cameras.new("tpose_cam")
cam = bpy.data.objects.new("tpose_cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.lens = 60
dist = max(height, depth) * 1.6

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.0
scene.collection.objects.link(sun)

world = bpy.data.worlds.new("tpose_world")
world.use_nodes = True
scene.world = world
world.node_tree.nodes["Background"].inputs[0].default_value = (0.12, 0.12, 0.14, 1.0)


def render_pair(prefix: str) -> None:
    cam.location = (cx, cy - dist, cz)
    cam.rotation_euler = (1.5707963, 0.0, 0.0)
    scene.render.filepath = os.path.join(OUTDIR, prefix + "_front.png")
    bpy.ops.render.render(write_still=True)
    cam.location = (cx, cy + dist, cz)
    cam.rotation_euler = (1.5707963, 0.0, 3.14159265)
    scene.render.filepath = os.path.join(OUTDIR, prefix + "_back.png")
    bpy.ops.render.render(write_still=True)


render_pair("base")
print("baseline front/back done")

# Rebake: Imagine albedo -> MPFB skin material base color.
skin_mat = bpy.data.materials.get("mpfb_skin_parent_tara_johnson_v1")
assert skin_mat is not None, "skin material mpfb_skin_parent_tara_johnson_v1 not found"
skin_mat.use_nodes = True
nodes = skin_mat.node_tree.nodes
links = skin_mat.node_tree.links
principled = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
assert principled is not None, "no Principled BSDF in skin material"
tex = nodes.new("ShaderNodeTexImage")
tex.image = bpy.data.images.load(ALBEDO)
tex.image.colorspace_settings.name = "sRGB"
links.new(tex.outputs["Color"], principled.inputs["Base Color"])
print("assigned imagine albedo to", skin_mat.name)

render_pair("rebaked")
print("rebaked front/back done ->", OUTDIR)
