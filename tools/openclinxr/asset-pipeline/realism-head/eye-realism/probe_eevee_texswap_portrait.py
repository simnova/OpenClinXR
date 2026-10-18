"""Scratch portrait renderer for the lidany SHEET fallback (not committed).

Head-framed front + yaw25 renders of one GLB under EEVEE (Cycles fallback),
then >=300px eye crops. Usage:
  blender --background --python /tmp/lidany_portrait.py -- \
    --glb <abs.glb> --out-dir <dir> --tag <base|new>
"""
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view


def argv_map():
    raw = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {}
    i = 0
    while i < len(raw):
        if raw[i].startswith("--") and i + 1 < len(raw):
            out[raw[i][2:]] = raw[i + 1]
            i += 2
        else:
            i += 1
    return out


ARGS = argv_map()
GLB = ARGS["glb"]
OUT = Path(ARGS["out-dir"])
TAG = ARGS["tag"]
# Bisect probe addition: optional eye-texture swap at load time (no GLB write).
# --eye-png <abs.png> replaces the pixels of the embedded globe image
# (brown_eye / iris-centred-c, both 1024x1024) before rendering.
EYE_PNG = ARGS.get("eye-png")
OUT.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

bpy.ops.import_scene.gltf(filepath=GLB)
bpy.context.view_layer.update()

if EYE_PNG:
    _src = bpy.data.images.load(EYE_PNG)
    _sw, _sh = tuple(_src.size)
    _n = 0
    for _img in bpy.data.images:
        if _img.name in ("brown_eye", "iris-centred-c"):
            assert tuple(_img.size) == (_sw, _sh), (
                f"eye swap size mismatch: {_img.name} {tuple(_img.size)} vs {(_sw, _sh)}"
            )
            _img.pixels = _src.pixels[:]
            _img.update()
            _n += 1
            print("SHEET_EYE_SWAP " + _img.name + " <- " + EYE_PNG)
    assert _n > 0, "eye swap found no brown_eye/iris-centred-c image"
    bpy.data.images.remove(_src)
for o in list(bpy.context.scene.objects):
    if o.type == "MESH" and (o.name.startswith("Icosphere") or len(o.data.vertices) < 100):
        _nm = o.name
        bpy.data.objects.remove(o, do_unlink=True)
        print("SHEET_REMOVED_STRAY " + _nm)

arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
bpy.context.view_layer.update()
hl = arm.matrix_world @ arm.data.bones["eye.L"].head_local
hr = arm.matrix_world @ arm.data.bones["eye.R"].head_local
anchor = (hl + hr) / 2.0
fl = (arm.matrix_world @ arm.data.bones["eye.L"].tail_local
      - arm.matrix_world @ arm.data.bones["eye.L"].head_local)
fr = (arm.matrix_world @ arm.data.bones["eye.R"].tail_local
      - arm.matrix_world @ arm.data.bones["eye.R"].head_local)
facing = (fl + fr).normalized()
up = __import__("mathutils").Vector((0, 0, 1))

# Hide fitted hair so the lid margin reads (same as capture rigs do).
for o in bpy.context.scene.objects:
    if o.type == "MESH" and "hair" in (o.name or "").lower():
        o.hide_render = True

scene = bpy.context.scene
scene.render.resolution_x = 1280
scene.render.resolution_y = 1280
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except Exception:
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except Exception:
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 32
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes.get("Background")
if bg:
    bg.inputs["Color"].default_value = (0.12, 0.12, 0.14, 1.0)
    bg.inputs["Strength"].default_value = 0.25


def add_area(name, loc, energy, size=0.4):
    bpy.ops.object.light_add(type="AREA", location=loc)
    lamp = bpy.context.active_object
    lamp.name = name
    lamp.data.energy = energy
    lamp.data.size = size
    return lamp


def look_at(obj, target):
    con = obj.constraints.new("TRACK_TO")
    con.target = bpy.data.objects.new("look_empty", None)
    bpy.context.collection.objects.link(con.target)
    con.target.location = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"


DIST = 0.38
cam_data = bpy.data.cameras.new("SheetCam")
cam_data.lens = 85
cam = bpy.data.objects.new("SheetCam", cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam
print("SHEET_ENGINE " + scene.render.engine)
for o in bpy.context.scene.objects:
    if o.type == "MESH":
        mats = [m.name if m else None for m in o.data.materials]
        print("SHEET_MESH", o.name, len(o.data.vertices), mats[:3])


def render_view(yaw_deg, suffix):
    ang = math.radians(yaw_deg)
    ca, sa = math.cos(ang), math.sin(ang)
    off = facing * DIST
    rx = off.x * ca - off.y * sa
    ry = off.x * sa + off.y * ca
    campos = anchor + __import__("mathutils").Vector((rx, ry, off.z)) \
        + up * 0.01
    cam.location = campos
    for c in list(cam.constraints):
        cam.constraints.remove(c)
    look_at(cam, anchor)
    bpy.context.view_layer.update()
    # Re-aim lights relative to camera side.
    for o in list(bpy.data.objects):
        if o.type == "LIGHT":
            bpy.data.objects.remove(o, do_unlink=True)
    side = __import__("mathutils").Vector((-facing.y, facing.x, 0)).normalized()
    add_area("Key", campos + side * 0.6 + up * 0.5, 3.0)
    add_area("Fill", campos - side * 0.7 + up * 0.2, 1.0, size=0.6)
    add_area("Rim", anchor - facing * 0.8 + up * 0.6, 2.0)
    path = str(OUT / f"sheet-body2-{TAG}-{suffix}-full.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("SHEET_RENDER " + path)
    return path


def crop_eyes(full_path, suffix):
    import numpy as np

    eye_w = {}
    for side, bone in (("L", "eye.L"), ("R", "eye.R")):
        p3 = arm.matrix_world @ arm.data.bones[bone].head_local
        co = world_to_camera_view(scene, cam, p3)
        px = int(co.x * 1280)
        py = int((1.0 - co.y) * 1280)
        half = 210
        eye_w[side] = (max(0, px - half), max(0, py - half))
    # Read back the render via Blender image pixels.
    img = bpy.data.images.load(full_path)
    w, h = img.size
    pix = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    pix = np.flipud(pix)
    srgb = np.clip(pix[..., :3], 0, 1) ** (1.0 / 2.2)
    out8 = (srgb * 255 + 0.5).astype(np.uint8)
    import struct
    import zlib

    def write_png(path, arr):
        hh, ww, _ = arr.shape
        raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(hh))
        ihdr = struct.pack(">IIBBBBB", ww, hh, 8, 2, 0, 0, 0)
        for typ, body in ((b"IHDR", ihdr), (b"IDAT", zlib.compress(raw)),
                          (b"IEND", b"")):
            ln = struct.pack(">I", len(body))
            crc = struct.pack(">I", zlib.crc32(typ + body) & 0xFFFFFFFF)
            blob = ln + typ + body + crc
            if typ == b"IHDR":
                head = b"\x89PNG\r\n\x1a\n" + blob
            else:
                head += blob
        Path(path).write_bytes(head)

    for side, (x0, y0) in eye_w.items():
        x1 = min(w, x0 + 420)
        y1 = min(h, y0 + 420)
        crop = out8[y0:y1, x0:x1]
        cpath = str(OUT / f"sheet-body2-{TAG}-{suffix}-eye{side}-crop.png")
        write_png(cpath, crop)
        print(f"SHEET_CROP {cpath} {crop.shape[1]}x{crop.shape[0]}")


for yaw, suffix in ((0, "front"), (25, "yaw25")):
    full = render_view(yaw, suffix)
    crop_eyes(full, suffix)
print("SHEET_DONE " + TAG)
