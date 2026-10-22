#!/usr/bin/env python3
"""G5 catchlight re-prove: old room-0.5 + quad@(1,8,6) recipe on the TRUE r7.8 cap.

Reads: geometric-eye-anterior.glb (L side; R hidden).
Lighting analogue of the eye-finish landed recipe (recorded, NOT photometric
identity across harnesses: three.js PMREM RoomEnvironment+quad vs EEVEE):
  world background strength 0.5 (room-0.5 analogue) + AREA quad at eye-local
  direction (1,8,6) x200mm, size 40mm (same 0.2rad angular size as 2.0@10).

Cells (1024^2 ortho-30, camera fixed front):
  cap-room05      true cap, world .5 + quad      (re-prove cell)
  shell-room05    CONTROL old-shell-profile cap (r12.239 c+0.95, same ring),
                  world .5 + quad
  cap-roomonly    true cap, world .5, no quad    (room veil floor)
  cap-quadonly    true cap, world 0 + quad       (dot isolation)
  caponly-room05  cap alone, Principled transmission IOR 1.376 (fresnel)
  shellonly-room05 control cap alone, same fresnel material
  cap-yaw-p25     full eye rotated +25deg about Y (gaze; camera fixed)
  cap-yaw-m25     full eye rotated -25deg about Y
Usage: blender --background --python geometric-eye-g5-catchlight.py
Writes: geometric-eye-g5-<cell>.png (this dir). Prints exposure stats.
"""
import math
import os

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
GLB = os.path.join(HERE, "geometric-eye-anterior.glb")

QUAD_DIR = np.array([1.0, 8.0, 6.0])  # eye-local (x right, y up, +z anterior)
QUAD_DIST = 60.0
QUAD_SIZE = 12.0
# Blender-unit falloff: E = P/(4 pi d^2); P=150k -> E~3.3 at the 24-unit
# eye, same order as the G2 sun (3.0) that actually lit the G2 sheet.
# (1500W was 100x under: E~0.03, invisible against the world.)
QUAD_ENERGY = 150000.0
WORLD_ROOM = 0.5

# eye-local (x,y,z) -> Blender (x,-z,y): anterior +z -> Blender -Y.
def to_blender(p):
    return (p[0], -p[2], p[1])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
eye_objs = [o for o in bpy.data.objects if o.type == "MESH"]
for o in eye_objs:
    if o.name.endswith("_R"):
        o.hide_render = True

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.film_transparent = True

cam_data = bpy.data.cameras.new("G5Cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 30.0
cam = bpy.data.objects.new("G5Cam", cam_data)
scene.collection.objects.link(cam)
cam.location = (0, -60, 0)
cam.rotation_euler = (math.pi / 2, 0, 0)
scene.camera = cam

world = bpy.data.worlds.new("g5w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[1].default_value = WORLD_ROOM
scene.world = world

quad_pos = tuple((QUAD_DIR / np.linalg.norm(QUAD_DIR) * QUAD_DIST).tolist())
area = bpy.data.objects.new("quad", bpy.data.lights.new("quad", "AREA"))
area.data.energy = QUAD_ENERGY
area.data.size = QUAD_SIZE
area.location = to_blender(quad_pos)
scene.collection.objects.link(area)
# aim the quad at the eye centre (origin)
import mathutils
vec = mathutils.Vector((0, 0, 0)) - mathutils.Vector(area.location)
area.rotation_euler = vec.to_track_quat("-Z", "Y").to_euler()

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 0.0  # recipe has no sun; kept at 0, recorded
scene.collection.objects.link(sun)

# ---- CONTROL: old-shell-profile cap (r=12.239 centred +0.95, same ring) ----
R_SHELL, C_SHELL = 12.239, 0.95
Z_RING = 10.417
rim = math.asin(math.sqrt(max(0.0, R_SHELL**2 - (Z_RING - C_SHELL)**2)) / R_SHELL)
NU, NV = 96, 40
verts, faces = [], []
for iu in range(NU + 1):
    th = 2 * math.pi * iu / NU
    for iv in range(NV + 1):
        ph = rim * iv / NV
        x = R_SHELL * math.sin(ph) * math.cos(th)
        y = R_SHELL * math.sin(ph) * math.sin(th)
        z = C_SHELL + R_SHELL * math.cos(ph)
        verts.append(to_blender((x, y, z)))
for iu in range(NU):
    for iv in range(NV):
        a = iu * (NV + 1) + iv
        b = (iu + 1) * (NV + 1) + iv
        faces.append((a, b, b + 1, a + 1))
cmesh = bpy.data.meshes.new("ShellControl")
cmesh.from_pydata(verts, [], faces)
cmesh.update()
cobj = bpy.data.objects.new("eye_geo_shellcontrol_L", cmesh)
scene.collection.objects.link(cobj)
cobj.hide_render = True
for p in cmesh.polygons:
    p.use_smooth = True

# (cap_L resolved below; material assigned after its lookup)
cap_objs = [o for o in eye_objs if "_cap_L" in o.name]
assert len(cap_objs) == 1, [o.name for o in eye_objs]
cap_L = cap_objs[0]
# control cap wears the SAME alpha-blend cap material as the true cap, so the
# only delta between the cells is curvature (old smooth shell vs true r7.8).
cobj.data.materials.append(cap_L.data.materials[0])


def show(names):
    for o in eye_objs + [cobj]:
        base = o.name.replace("eye_geo_", "")
        o.hide_render = o.name.endswith("_R") or (names is not None and base not in names)


def render(cell, world_strength=None, quad_on=True, yaw_deg=0.0, fresnel=False):
    if world_strength is not None:
        world.node_tree.nodes["Background"].inputs[1].default_value = world_strength
    area.hide_render = not quad_on
    for o in eye_objs:
        o.rotation_euler = (0, 0, math.radians(yaw_deg))
    cobj.rotation_euler = (0, 0, math.radians(yaw_deg))
    # yaw about eye-local Y == Blender Z (mapping (x,y,z)->(x,-z,y))
    if fresnel:
        for o in eye_objs + [cobj]:
            o.hide_render = True
        target = cobj if "shell" in cell else cap_L
        target.hide_render = False
        mat = bpy.data.materials.new("G5Fresnel")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
        for key, val in (("Transmission Weight", 1.0), ("Transmission", 1.0)):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = val
        if "IOR" in bsdf.inputs:
            bsdf.inputs["IOR"].default_value = 1.376
        bsdf.inputs["Roughness"].default_value = 0.05
        target.data.materials.clear()
        target.data.materials.append(mat)
    scene.render.filepath = os.path.join(HERE, f"geometric-eye-g5-{cell}.png")
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath, flush=True)


show({"sclera_L", "cap_L", "disc_L"})
render("cap-room05")
show({"sclera_L", "disc_L"})
cobj.hide_render = False
render("shell-room05")
render("shell-roomonly", quad_on=False)
cobj.hide_render = True
show({"sclera_L", "cap_L", "disc_L"})
render("cap-roomonly", quad_on=False)
render("cap-quadonly", world_strength=0.0, quad_on=True)
# restore world for remaining cells
world.node_tree.nodes["Background"].inputs[1].default_value = WORLD_ROOM
render("caponly-room05", fresnel=True)
# rebuild non-fresnel visibility: reimport is cheapest honest reset
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
eye_objs = [o for o in bpy.data.objects if o.type == "MESH"]
for o in eye_objs:
    if o.name.endswith("_R"):
        o.hide_render = True
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.film_transparent = True
scene.camera = bpy.data.objects["G5Cam"] if "G5Cam" in bpy.data.objects else None
# NOTE: factory reset wiped lights/camera/world; re-create minimal set.
if scene.camera is None:
    cam_data = bpy.data.cameras.new("G5Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 30.0
    cam = bpy.data.objects.new("G5Cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0, -60, 0)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = cam
world = bpy.data.worlds.new("g5w2")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[1].default_value = WORLD_ROOM
scene.world = world
area = bpy.data.objects.new("quad2", bpy.data.lights.new("quad2", "AREA"))
area.data.energy = QUAD_ENERGY
area.data.size = QUAD_SIZE
area.location = to_blender(tuple((QUAD_DIR / np.linalg.norm(QUAD_DIR) * QUAD_DIST).tolist()))
scene.collection.objects.link(area)
import mathutils as _mu
area.rotation_euler = (_mu.Vector((0, 0, 0)) - _mu.Vector(area.location)).to_track_quat("-Z", "Y").to_euler()
# shell control does not survive the reset; rebuild visibility only for yaw cells
show_names = {"sclera_L", "cap_L", "disc_L"}
# G2-sheet precedent: object rotation has no effect on matrix_world in
# background Blender 5.1, so the yaw is baked into the mesh verts instead
# (honest gaze analogue: rigid rotation about the globe centre == origin).
from mathutils import Matrix as _M
for o in eye_objs:
    base = o.name.replace("eye_geo_", "")
    o.hide_render = o.name.endswith("_R") or base not in show_names
for o in eye_objs:
    if not o.hide_render:
        o.data.transform(_M.Rotation(math.radians(25.0), 4, "Z"))
scene.render.filepath = os.path.join(HERE, "geometric-eye-g5-cap-yaw-p25.png")
bpy.ops.render.render(write_still=True)
print("wrote", scene.render.filepath, flush=True)
area.hide_render = True  # room-only parallax twin: no dot contamination
scene.render.filepath = os.path.join(HERE, "geometric-eye-g5-cap-yaw-p25-roomonly.png")
bpy.ops.render.render(write_still=True)
print("wrote", scene.render.filepath, flush=True)
area.hide_render = False
for o in eye_objs:
    if not o.hide_render:
        # mesh already carries +25 from the p25 cell: -50 lands net -25.
        o.data.transform(_M.Rotation(math.radians(-50.0), 4, "Z"))
scene.render.filepath = os.path.join(HERE, "geometric-eye-g5-cap-yaw-m25.png")
bpy.ops.render.render(write_still=True)
print("wrote", scene.render.filepath, flush=True)
area.hide_render = True
scene.render.filepath = os.path.join(HERE, "geometric-eye-g5-cap-yaw-m25-roomonly.png")
bpy.ops.render.render(write_still=True)
print("wrote", scene.render.filepath, flush=True)
area.hide_render = False
# shellonly fresnel cell: re-add control cap alone on a clean import
for o in eye_objs:
    o.hide_render = True
cmesh2 = bpy.data.meshes.new("ShellControl2")
cmesh2.from_pydata(verts, [], faces)
cmesh2.update()
cobj2 = bpy.data.objects.new("eye_geo_shellcontrol2_L", cmesh2)
scene.collection.objects.link(cobj2)
for p in cmesh2.polygons:
    p.use_smooth = True
mat2 = bpy.data.materials.new("G5Fresnel2")
mat2.use_nodes = True
bsdf2 = mat2.node_tree.nodes["Principled BSDF"]
bsdf2.inputs["Base Color"].default_value = (1, 1, 1, 1)
for key, val in (("Transmission Weight", 1.0), ("Transmission", 1.0)):
    if key in bsdf2.inputs:
        bsdf2.inputs[key].default_value = val
if "IOR" in bsdf2.inputs:
    bsdf2.inputs["IOR"].default_value = 1.376
bsdf2.inputs["Roughness"].default_value = 0.05
cobj2.data.materials.clear()
cobj2.data.materials.append(mat2)
scene.render.filepath = os.path.join(HERE, "geometric-eye-g5-shellonly-room05.png")
bpy.ops.render.render(write_still=True)
print("wrote", scene.render.filepath, flush=True)
