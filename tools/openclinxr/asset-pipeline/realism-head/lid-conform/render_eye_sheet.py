"""Head-framed eye-band portraits for a lid-conform sheet (Blender EEVEE).

tsk_083b92e9c7ca5d7b. Generic over any subject: the eye centres come from the
bake's own eye meshes (an `eyes`/`cornea` material, split left/right by x sign
exactly as measure_conform does), so no subject stem or mesh name is named
here, and the renderer never writes into a shipped public/ tree.

The camera is placed on the eye mid-point along the bake's own facing (glTF
face-forward +z -> Blender -Y; the export axis mapping lid_conform._gltf_to_blender
applies), at the distance that makes the visible width at the eye plane exactly
--span-mm. mmPerPx is therefore span_mm / resolution with no fitted constant,
which is the scale the any-subject landmark method converts with.

Usage (foreground, one GLB per run):
  blender --background --python render_eye_sheet.py -- \
    --glb <glb> --out-dir <dir> --label base|new [--resolution 2048] \
    [--span-mm 200] [--views front,yaw25] [--yaw-deg 25]

Writes <label>-<view>-full.png plus portrait-<label>.json (camera + projected
eye centres, the data the crop step and the report cite).
"""
import argparse
import json
import math
import pathlib
import sys

import bpy
from mathutils import Vector

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PARSER = argparse.ArgumentParser()
PARSER.add_argument("--glb", required=True)
PARSER.add_argument("--out-dir", required=True)
PARSER.add_argument("--label", required=True)
PARSER.add_argument("--resolution", type=int, default=2048)
PARSER.add_argument("--span-mm", type=float, default=200.0)
PARSER.add_argument("--fov-rad", type=float, default=0.62)
PARSER.add_argument("--views", default="front,yaw25")
PARSER.add_argument("--yaw-deg", type=float, default=25.0)
ARGS = PARSER.parse_args(ARGV)

OUT = pathlib.Path(ARGS.out_dir)
OUT.mkdir(parents=True, exist_ok=True)
EYE_MATERIAL_RE = ("eyes", "cornea")


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    for block in list(bpy.data.images):
        bpy.data.images.remove(block)


def setup_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = ARGS.resolution
    scene.render.resolution_y = ARGS.resolution
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.world = bpy.data.worlds.new("lid_sheet_world")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.16, 0.18, 0.22, 1.0)
        bg.inputs[1].default_value = 0.6
    sun = bpy.data.lights.new("lid_sheet_sun", type="SUN")
    sun.energy = 3.0
    sun.angle = 0.15
    sun_obj = bpy.data.objects.new("lid_sheet_sun", sun)
    scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (0.9, -0.35, 0.6)
    fill = bpy.data.lights.new("lid_sheet_fill", type="AREA")
    fill.energy = 60.0
    fill.size = 6.0
    fill_obj = bpy.data.objects.new("lid_sheet_fill", fill)
    scene.collection.objects.link(fill_obj)
    fill_obj.location = (0.0, 3.0, 1.6)


def import_glb(path):
    before = {o.name for o in bpy.context.scene.objects}
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o.name not in before]


def eye_centres():
    """Left/right eye world centres + forward, from the bake's own eye meshes.

    The bake tags the eye surfaces by material (the same role tags
    lid_conform_core resolves), so this finds them without any subject mesh
    name; the forward axis is read from the corneal bulge rather than assumed.
    """
    pts = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        mats = " ".join(m.name.lower() for m in obj.data.materials if m)
        if not any(k in mats for k in EYE_MATERIAL_RE):
            continue
        mw = obj.matrix_world
        pts.extend([mw @ v.co for v in obj.data.vertices])
    if len(pts) < 24:
        raise RuntimeError(f"LID_SHEET: eye meshes not found (n={len(pts)})")
    left = [p for p in pts if p.x < 0.0]
    right = [p for p in pts if p.x >= 0.0]
    if not left or not right:
        raise RuntimeError("LID_SHEET: eye meshes have no left/right split")
    lc = sum(left, Vector((0, 0, 0))) / len(left)
    rc = sum(right, Vector((0, 0, 0))) / len(right)
    mid = (lc + rc) / 2.0
    span = abs(rc.x - lc.x)
    return {"L": lc, "R": rc, "mid": mid, "spanM": span}


def make_camera(mid, forward, distance):
    cam = bpy.data.cameras.new("lid_sheet_cam")
    cam.angle = ARGS.fov_rad
    cam_obj = bpy.data.objects.new("lid_sheet_cam", cam)
    bpy.context.scene.collection.objects.link(cam_obj)
    cam_obj.location = mid + forward * distance
    direction = mid - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return cam_obj


def project(cam_obj, point):
    from bpy_extras.object_utils import world_to_camera_view

    scene = bpy.context.scene
    co = world_to_camera_view(scene, cam_obj, point)
    return [round(co.x * ARGS.resolution, 2),
            round((1.0 - co.y) * ARGS.resolution, 2)]


def main():
    clear_scene()
    setup_scene()
    import_glb(ARGS.glb)
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and "hair" in (obj.name or "").lower():
            obj.hide_render = True
            obj.hide_viewport = True
            print(f"LID_SHEET_HAIR_HIDDEN {obj.name}")
    eyes = eye_centres()
    mid = eyes["mid"]
    distance = (ARGS.span_mm / 1000.0) / (2.0 * math.tan(ARGS.fov_rad / 2.0))
    mm_per_px = ARGS.span_mm / float(ARGS.resolution)
    print(
        "LID_SHEET_EYES "
        + json.dumps({"mid": [round(v, 5) for v in mid],
                      "left": [round(v, 5) for v in eyes["L"]],
                      "right": [round(v, 5) for v in eyes["R"]],
                      "spanMm": round(eyes["spanM"] * 1000.0, 3),
                      "distanceM": round(distance, 5),
                      "mmPerPx": round(mm_per_px, 6),
                      "fovRad": ARGS.fov_rad,
                      "resolution": ARGS.resolution})
    )
    # Blender-facing for every bake is -Y (glTF face-forward +z).
    forward = Vector((0.0, -1.0, 0.0))
    views = {}
    for view in [v.strip() for v in ARGS.views.split(",") if v.strip()]:
        yaw = 0.0 if view == "front" else (
            ARGS.yaw_deg if view.startswith("yaw") and "-" not in view
            else -ARGS.yaw_deg)
        th = math.radians(yaw)
        # Yaw about the vertical: R_z(th) applied to the bake's own facing.
        dirv = Vector((math.cos(th) * forward.x - math.sin(th) * forward.y,
                       math.sin(th) * forward.x + math.cos(th) * forward.y,
                       0.0))
        cam = make_camera(mid, dirv, distance)
        bpy.context.scene.camera = cam
        path = OUT / f"{ARGS.label}-{view}-full.png"
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        lpx = project(cam, eyes["L"])
        rpx = project(cam, eyes["R"])
        for tag, px in (("L", lpx), ("R", rpx)):
            if not (0.0 <= px[0] < ARGS.resolution and 0.0 <= px[1] < ARGS.resolution):
                raise RuntimeError(
                    f"LID_SHEET: {view} projects {tag} eye off-frame at {px} — "
                    "the facing assumption (Blender -Y) does not hold for this bake")
        views[view] = {
            "path": str(path),
            "yawDeg": yaw,
            "leftEyePx": lpx,
            "rightEyePx": rpx,
            "eyeSpanPx": round(abs(rpx[0] - lpx[0]), 2),
        }
        print(f"LID_SHEET_RENDER {path} eyeSpanPx={views[view]['eyeSpanPx']}")
        bpy.data.objects.remove(cam, do_unlink=True)
    doc = {
        "label": ARGS.label,
        "glb": str(ARGV[ARGV.index("--glb") + 1]),
        "resolution": ARGS.resolution,
        "fovRad": ARGS.fov_rad,
        "spanMm": ARGS.span_mm,
        "distanceM": round(distance, 5),
        "mmPerPx": round(mm_per_px, 6),
        "eyeMidBlender": [round(v, 5) for v in mid],
        "eyeSpanMm": round(eyes["spanM"] * 1000.0, 3),
        "views": views,
    }
    (OUT / f"portrait-{ARGS.label}.json").write_text(
        json.dumps(doc, indent=1), encoding="utf-8")
    print(f"LID_SHEET_DONE {OUT / ('portrait-' + ARGS.label + '.json')}")


if __name__ == "__main__":
    main()
