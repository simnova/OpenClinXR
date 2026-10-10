#!/usr/bin/env python3
"""Render a side-view strip of 6 frames covering a stop clip's last ~1.5 m of travel plus
the hold, Blender EEVEE.

Camera FIXED in world (never parented, never following), side-on perpendicular to the
root-travel direction, framed to hold the FULL body including both feet plus a floor
band below them: distance derived from measured head height and lens geometry with a
1.1x margin, then verified programmatically (head + both toes projected into camera
space must land inside 0.02..0.98 on every rendered frame; one widen-and-retry if not).
The floor is a distinct dark material with emissive tick strips every 0.1 m along the
travel direction so slide reads against the floor. Body keeps its imported materials
(EEVEE, never Workbench).

Frame times are chosen from the rig's own root track: the first frame whose root XZ is
within 1.5 m of the final root XZ, then 6 evenly spaced frames to the action end.

Usage:
  blender --background --python tools/openclinxr/factory/kimodo-loop/render_stop_strip.py -- \\
    --glb <stop.glb> --clip <clip-name> --out <strip.png>
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

REGION_METERS = 1.5
TICK_EVERY_M = 0.1


def parse_args(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", required=True)
    ap.add_argument("--clip", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=960)
    ap.add_argument("--height", type=int, default=540)
    return ap.parse_args(argv)


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
    start, end = int(action.frame_range[0]), int(action.frame_range[1])

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.film_transparent = False
    scene.frame_start = start
    scene.frame_end = end

    # Root track over the action: travel direction, region start, head height.
    roots = {}
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        roots[frame] = eval_pose_world(arm, "root")
    root_end = roots[end]
    travel = Vector((root_end.x - roots[start].x, root_end.y - roots[start].y, 0))
    if travel.length < 1e-6:
        raise RuntimeError("root travel is zero; not a root-motion clip")
    travel.normalize()
    side = Vector((-travel.y, travel.x, 0))
    region_start_frame = next(
        f for f in range(start, end + 1)
        if math.hypot(roots[f].x - root_end.x, roots[f].y - root_end.y) <= REGION_METERS
    )
    frames = [round(region_start_frame + f * (end - region_start_frame) / 5) for f in range(6)]
    # Framing span from the actual motion (a collapsed bind must still frame fully):
    # lowest toe to highest head across the rendered frames.
    span_lo, span_hi = float("inf"), float("-inf")
    for frame in frames:
        scene.frame_set(frame)
        for b in ("head", "toe1-1.L", "toe1-1.R"):
            span_lo = min(span_lo, eval_pose_world(arm, b).z)
            span_hi = max(span_hi, eval_pose_world(arm, b).z)
    aim_z = (span_lo + span_hi) / 2
    region_center = Vector((
        (roots[region_start_frame].x + root_end.x) / 2,
        (roots[region_start_frame].y + root_end.y) / 2,
        0,
    ))

    # World set: distinct dark floor, emissive 0.1 m ticks, sun, all fixed in world.
    bpy.ops.mesh.primitive_plane_add(size=30, location=(region_center.x, region_center.y, 0))
    floor = bpy.context.active_object
    floor_mat = bpy.data.materials.new("STOP_STRIP_FLOOR")
    floor_mat.use_nodes = True
    bsdf = floor_mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.16, 0.16, 0.17, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    floor.data.materials.append(floor_mat)
    tick_mat = bpy.data.materials.new("STOP_STRIP_TICK")
    tick_mat.use_nodes = True
    tick_bsdf = tick_mat.node_tree.nodes.get("Principled BSDF")
    tick_bsdf.inputs["Base Color"].default_value = (1.0, 0.85, 0.2, 1.0)
    tick_bsdf.inputs["Emission Color"].default_value = (1.0, 0.85, 0.2, 1.0)
    tick_bsdf.inputs["Emission Strength"].default_value = 1.5
    tick_lo = math.floor((region_start_frame and (roots[region_start_frame].x * travel.x + roots[region_start_frame].y * travel.y)) - 0.5) - 1
    tick_hi = math.ceil(root_end.x * travel.x + root_end.y * travel.y + 0.5) + 1
    n_ticks = int((tick_hi - tick_lo) / TICK_EVERY_M)
    for i in range(n_ticks + 1):
        s = tick_lo + i * TICK_EVERY_M
        cx = region_center.x + travel.x * (s - (region_center.x * travel.x + region_center.y * travel.y))
        cy = region_center.y + travel.y * (s - (region_center.x * travel.x + region_center.y * travel.y))
        bpy.ops.mesh.primitive_plane_add(size=1, location=(cx, cy, 0.002))
        tick = bpy.context.active_object
        tick.scale = (0.004, 0.6, 1.0)
        tick.rotation_euler[2] = math.atan2(travel.y, travel.x)
        tick.data.materials.append(tick_mat)
    bpy.ops.object.light_add(type="SUN", location=(region_center.x + 3, region_center.y - 4, 6))
    bpy.context.active_object.data.energy = 3.0

    # Camera: fixed, level, side-on; distance from lens geometry + margin.
    bpy.ops.object.camera_add()
    cam = bpy.context.active_object
    cam.data.sensor_fit = "VERTICAL"
    cam.data.sensor_height = 16.0
    cam.data.lens = 24.0
    vfov = 2 * math.atan(16.0 / (2 * 24.0))
    aim_z = (span_lo + span_hi) / 2
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
