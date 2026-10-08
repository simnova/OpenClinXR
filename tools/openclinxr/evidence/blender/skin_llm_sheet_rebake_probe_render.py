"""Real Blender front/back T-pose render of the MPFB aisha GLB.

Usage: blender --background --python skin_llm_sheet_rebake_probe_render.py -- <glb> <outdir>
New probe file only; never touches materialize_mpfb_humanoid_candidate.py.
"""
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
glb, outdir = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 64
scene.cycles.device = "CPU"
scene.render.resolution_x = 768
scene.render.resolution_y = 1024
scene.render.film_transparent = False

# frame camera on imported bounds
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
xs, ys, zs = [], [], []
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        xs.append(w.x)
        ys.append(w.y)
        zs.append(w.z)
cx, cy, cz = (sum(xs) / len(xs), sum(ys) / len(ys), sum(zs) / len(zs))
height = max(zs) - min(zs)
depth = max(ys) - min(ys)

cam_data = bpy.data.cameras.new("tpose_cam")
cam = bpy.data.objects.new("tpose_cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.lens = 60
cam.location = (cx, cy - max(height, depth) * 1.6, cz)
cam.rotation_euler = (1.5707963, 0.0, 0.0)

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.0
scene.collection.objects.link(sun)

world = bpy.data.worlds.new("tpose_world")
world.use_nodes = True
scene.world = world
world.node_tree.nodes["Background"].inputs[0].default_value = (0.12, 0.12, 0.14, 1.0)

scene.render.filepath = outdir + "/front.png"
bpy.ops.render.render(write_still=True)

# back view: rotate camera 180 deg around the subject
cam.location = (cx, cy + max(height, depth) * 1.6, cz)
cam.rotation_euler = (1.5707963, 0.0, 3.14159265)
scene.render.filepath = outdir + "/back.png"
bpy.ops.render.render(write_still=True)
print("rendered front/back to", outdir)
