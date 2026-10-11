#!/usr/bin/env python3
"""Render a side-view strip of 6 frames covering the baked stepping turn, Blender EEVEE.

Adapted from tools/openclinxr/factory/kimodo-loop/render_stop_strip.py for a turn, not
a stop: the turn has ~0.1 m of root travel (not 1.5 m), so frames spread evenly across
the whole action, and the fixed camera sits side-on to the FINAL facing (passed via
--facing-deg in the assay's three.js yaw convention) instead of perpendicular to a
travel direction. Floor ticks run both axes (a turn spreads feet in all directions).
Framing verify (head + both toes inside 0.02..0.98 every frame) and floor-under-toes
are unchanged.

Usage:
  blender --background --python tools/openclinxr/evidence/foot-plant/stepping-turn/render_stepping_strip.py -- \
    --glb <bake.glb> --clip <clip-name> --facing-deg <deg> --out <strip.png>
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

TICK_EVERY_M = 0.1


def parse_args(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", required=True)
    ap.add_argument("--clip", required=True)
    ap.add_argument("--facing-deg", type=float, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=960)
    ap.add_argument("--height", type=int, default=540)
    ap.add_argument("--garments-on", action="store_true",
                    help="keep garments/hair/shoes and original materials (secondary check)")
    return ap.parse_args(argv)


# Grading-render rule (operator, 2026-10-11): hide all garment and hair meshes, show
# the BODY ONLY, with distinct material colours on thigh, shin and foot so the knee
# hinge and foot contact read. substrings matched against imported object names.
HIDE_SUBSTRINGS = ("lab_coat", "scrub_", "footwear", "_shoes", "hair", "eyebrow", "eyelash")

THIGH_BONES = ("upperleg01.L", "upperleg01.R", "upperleg02.L", "upperleg02.R")
SHIN_BONES = ("lowerleg01.L", "lowerleg01.R", "lowerleg02.L", "lowerleg02.R")
FOOT_BONES = ("foot.L", "foot.R", "toe1-1.L", "toe1-1.R")


def flat_material(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.7
    bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 0.35
    return mat


def apply_body_only(arm):
    """Hide garments/hair/shoes; recolor the largest mesh by leg segment. Returns body."""
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no meshes after glTF import")
    for o in meshes:
        lname = o.name.lower()
        if any(s in lname for s in HIDE_SUBSTRINGS):
            o.hide_render = True
    shown = [o for o in meshes if not o.hide_render]
    body = max(shown, key=lambda o: len(o.data.vertices))
    print(f"body mesh: {body.name} verts={len(body.data.vertices)}", flush=True)
    mesh = body.data
    gray = flat_material("STEP_BODY", (0.55, 0.57, 0.60))
    thigh = flat_material("STEP_THIGH", (1.0, 0.30, 0.10))
    shin = flat_material("STEP_SHIN", (0.10, 0.75, 0.65))
    foot = flat_material("STEP_FOOT", (1.0, 0.85, 0.15))
    mesh.materials.clear()
    for m in (gray, thigh, shin, foot):
        mesh.materials.append(m)

    def seg_of(bone_name):
        if bone_name in THIGH_BONES:
            return 1
        if bone_name in SHIN_BONES:
            return 2
        if bone_name in FOOT_BONES:
            return 3
        return 0

    group_seg = {}
    for i, vg in enumerate(body.vertex_groups):
        group_seg[i] = seg_of(vg.name)
    counts = [0, 0, 0, 0]
    for poly in mesh.polygons:
        best_seg = 0
        best_w = 0.0
        for vi in poly.vertices:
            for g in mesh.vertices[vi].groups:
                seg = group_seg.get(g.group, 0)
                if seg and g.weight > best_w:
                    best_w = g.weight
                    best_seg = seg
        poly.material_index = best_seg
        counts[best_seg] += 1
    print(f"face segments gray/thigh/shin/foot: {counts}", flush=True)
    return body


def arm_world(arm):
    deps = bpy.context.evaluated_depsgraph_get()
    eval_arm = arm.evaluated_get(deps)
    return eval_arm.matrix_world.translation.copy()


def eval_pose_world(arm, bone_name):
    deps = bpy.context.evaluated_depsgraph_get()
    eval_arm = arm.evaluated_get(deps)
    bone = eval_arm.pose.bones.get(bone_name)
    if bone is None:
        raise RuntimeError(f"bone not found: {bone_name}")
    return (eval_arm.matrix_world @ bone.matrix).translation.copy()


def main(argv):
    args = parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args.glb)
    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError("no armature after glTF import")
    arm = armatures[0]
    action = bpy.data.actions.get(args.clip)
    if action is None:
        raise RuntimeError(f"action not found: {args.clip}")
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    if not args.garments_on:
        apply_body_only(arm)
    start, end = int(action.frame_range[0]), int(action.frame_range[1])

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.film_transparent = False
    scene.frame_start = start
    scene.frame_end = end

    # Six evenly spaced frames across the whole turn (no travel region to find).
    frames = [round(start + f * (end - start) / 5) for f in range(6)]

    # Root track off the armature object (turn travel lives on the skeleton root
    # node, not on a root bone).
    roots = {}
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        roots[frame] = arm_world(arm)
    region_center = Vector((0, 0, 0))
    for frame in frames:
        region_center += roots[frame]
    region_center /= len(frames)
    region_center.z = 0

    # Framing span from the actual motion: lowest toe to highest head.
    span_lo, span_hi = float("inf"), float("-inf")
    for frame in frames:
        scene.frame_set(frame)
        for b in ("head", "toe1-1.L", "toe1-1.R"):
            span_lo = min(span_lo, eval_pose_world(arm, b).z)
            span_hi = max(span_hi, eval_pose_world(arm, b).z)
    aim_z = (span_lo + span_hi) / 2

    # World set: distinct dark floor, emissive 0.1 m ticks on both axes, sun.
    bpy.ops.mesh.primitive_plane_add(size=30, location=(region_center.x, region_center.y, 0))
    floor = bpy.context.active_object
    floor_mat = bpy.data.materials.new("STEP_STRIP_FLOOR")
    floor_mat.use_nodes = True
    bsdf = floor_mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.16, 0.16, 0.17, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    floor.data.materials.append(floor_mat)
    tick_mat = bpy.data.materials.new("STEP_STRIP_TICK")
    tick_mat.use_nodes = True
    tick_bsdf = tick_mat.node_tree.nodes.get("Principled BSDF")
    tick_bsdf.inputs["Base Color"].default_value = (1.0, 0.85, 0.2, 1.0)
    tick_bsdf.inputs["Emission Color"].default_value = (1.0, 0.85, 0.2, 1.0)
    tick_bsdf.inputs["Emission Strength"].default_value = 1.5
    for axis in ("x", "y"):
        for s in [i * TICK_EVERY_M for i in range(-15, 16)]:
            cx = region_center.x + (s if axis == "x" else 0)
            cy = region_center.y + (s if axis == "y" else 0)
            bpy.ops.mesh.primitive_plane_add(size=1, location=(cx, cy, 0.002))
            tick = bpy.context.active_object
            tick.scale = (0.004 if axis == "x" else 0.6, 0.6 if axis == "x" else 0.004, 1.0)
            tick.data.materials.append(tick_mat)
    bpy.ops.object.light_add(type="SUN", location=(region_center.x + 3, region_center.y - 4, 6))
    bpy.context.active_object.data.energy = 5.0
    bpy.ops.object.light_add(type="SUN", location=(region_center.x - 4, region_center.y + 3, 4))
    bpy.context.active_object.data.energy = 1.5

    # Camera: fixed, level, side-on to the final facing. Assay yaw convention is
    # three.js (dir x/z = sin/cos of yaw); Blender maps (x,y,z)->(x,-z,y), so the
    # facing in Blender xy is (sin, -cos) and the side vector is (cos, sin).
    phi = math.radians(args.facing_deg)
    side = Vector((math.cos(phi), math.sin(phi), 0))
    bpy.ops.object.camera_add()
    cam = bpy.context.active_object
    cam.data.sensor_fit = "VERTICAL"
    cam.data.sensor_height = 16.0
    cam.data.lens = 24.0
    vfov = 2 * math.atan(16.0 / (2 * 24.0))
    dist = ((span_hi - span_lo) + 0.6) / (2 * math.tan(vfov / 2)) * 1.1
    bpy.ops.object.empty_add(location=(region_center.x, region_center.y, aim_z))
    target = bpy.context.active_object
    track = cam.constraints.new(type="TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"
    scene.camera = cam

    def bounds_ok(cam_loc):
        cam.location = cam_loc
        bpy.context.view_layer.update()
        worst = 0.0
        for frame in frames:
            scene.frame_set(frame)
            pts = [eval_pose_world(arm, b) for b in ("head", "toe1-1.L", "toe1-1.R")]
            for p in pts:
                v = world_to_camera_view(scene, cam, p)
                worst = max(worst, abs(v.x - 0.5) * 2, abs(v.y - 0.5) * 2)
        return worst, worst < 0.96

    base_loc = Vector((region_center.x, region_center.y, 0)) + side * dist
    base_loc.z = aim_z
    worst, ok = bounds_ok(base_loc)
    print(f"framing check dist={dist:.2f} worst={worst:.3f} ok={ok}", flush=True)
    if not ok:
        dist *= 1.35
        retry_loc = Vector((region_center.x, region_center.y, 0)) + side * dist
        retry_loc.z = aim_z
        worst, ok = bounds_ok(retry_loc)
        print(f"framing retry dist={dist:.2f} worst={worst:.3f} ok={ok}", flush=True)
    if not ok:
        raise RuntimeError(f"framing failed: worst={worst:.3f}; feet/head leave frame")

    # Floor height under the lowest sampled toe, fixed for all frames.
    toe_min_z = float("inf")
    for frame in frames:
        scene.frame_set(frame)
        for toe in ("toe1-1.L", "toe1-1.R"):
            toe_min_z = min(toe_min_z, eval_pose_world(arm, toe).z)
    floor.location.z = toe_min_z - 0.001
    print(f"toe_min_z={toe_min_z:.4f} span={span_hi - span_lo:.3f}", flush=True)

    rendered = []
    tmpdir = Path(args.out).parent
    for i, frame in enumerate(frames):
        scene.frame_set(frame)
        path = str(tmpdir / f"_strip_frame{i}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        rendered.append(path)
        print(f"rendered frame {frame} -> {path}", flush=True)

    images = [bpy.data.images.load(p) for p in rendered]
    w, h = images[0].size
    strip = bpy.data.images.new("strip", width=w * len(images), height=h)
    strip_pixels = [0.0] * (w * len(images) * h * 4)
    for i, img in enumerate(images):
        px = list(img.pixels)
        for y in range(h):
            for x in range(w):
                src = (y * w + x) * 4
                dst = (y * (w * len(images)) + (i * w + x)) * 4
                strip_pixels[dst:dst + 4] = px[src:src + 4]
    strip.pixels = strip_pixels
    strip.filepath_raw = args.out
    strip.file_format = "PNG"
    strip.save()
    print(f"wrote strip {args.out}: {len(images)} frames of {w}x{h}", flush=True)


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
