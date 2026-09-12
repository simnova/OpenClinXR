#!/usr/bin/env python3
"""Render isolated front_lit captures at several frames for a motion-bind GLB.

Usage:
  blender --background --python render_seated_clip_frames.py -- \
    --actor <motion-bind.glb> --output-dir <dir> --frames 0,20,45,70,89

The orchestrator grades the pixels; this worker produces the PNGs.
"""
import argparse, bpy, json, math, sys, pathlib
from mathutils import Vector

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
PARSER = argparse.ArgumentParser()
PARSER.add_argument("--actor", required=True, help="Path to the motion-bind GLB")
PARSER.add_argument("--output-dir", required=True, help="Directory for rendered PNGs")
PARSER.add_argument("--frames", default="0,20,45,70,89", help="Comma-separated frame numbers")
PARSER.add_argument("--resolution", type=int, default=1600)
ARGS = parser.parse_args(ARGV) if False else PARSER.parse_args(ARGV)

OUT = pathlib.Path(ARGS.output_dir)
OUT.mkdir(parents=True, exist_ok=True)

FRAMES = [int(f.strip()) for f in ARGS.frames.split(",")]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    for block in list(bpy.data.images):
        bpy.data.images.remove(block)


def setup_scene(frame_count):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = ARGS.resolution
    scene.render.resolution_y = int(ARGS.resolution * 0.72)
    scene.render.film_transparent = False
    scene.frame_start = 0
    scene.frame_end = max(frame_count - 1, 0)
    scene.frame_current = 0
    # World
    scene.world = bpy.data.worlds.new("capture_world")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.16, 0.18, 0.22, 1.0)
        bg.inputs[1].default_value = 0.6
    # Lighting
    sun = bpy.data.lights.new("capture_sun", type="SUN")
    sun.energy = 3.0
    sun.angle = 0.15
    sun_obj = bpy.data.objects.new("capture_sun", sun)
    scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (0.9, -0.35, 0.6)
    fill = bpy.data.lights.new("capture_fill", type="AREA")
    fill.energy = 60.0
    fill.size = 6.0
    fill_obj = bpy.data.objects.new("capture_fill", fill)
    scene.collection.objects.link(fill_obj)
    fill_obj.location = (0.0, 3.0, 1.6)


def scene_aabb():
    corners = []
    for o in bpy.context.scene.objects:
        if o.type != "MESH" or o.hide_render:
            continue
        for c in o.bound_box:
            corners.append(o.matrix_world @ Vector(c))
    if not corners:
        return None
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def setup_camera():
    aabb = scene_aabb()
    if aabb is None:
        return
    lo, hi = aabb
    center = (lo + hi) / 2
    extent = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
    distance = extent * 1.8
    cam = bpy.data.cameras.new("capture_cam")
    cam.lens = 85
    cam_obj = bpy.data.objects.new("capture_cam", cam)
    bpy.context.scene.collection.objects.link(cam_obj)
    cam_obj.location = (center.x, center.y - distance, center.z + extent * 0.15)
    # Look at center
    direction = center - cam_obj.location
    rot_quat = direction.to_track_quat('-Z', 'Y')
    cam_obj.rotation_euler = rot_quat.to_euler()
    bpy.context.scene.camera = cam_obj


def import_actor(glb_path):
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    # Find armature
    armatures = [ob for ob in bpy.context.scene.objects if ob.type == "ARMATURE"]
    return max(armatures, key=lambda ob: len(ob.pose.bones)) if armatures else None


def get_frame_count(arm):
    ad = arm.animation_data
    if ad is None:
        return 1
    # Check NLA strips first (GLB imports store clips there)
    max_frame = 0
    if ad.nla_tracks:
        for track in ad.nla_tracks:
            for strip in track.strips:
                if strip.frame_end > max_frame:
                    max_frame = strip.frame_end
    if max_frame > 0:
        return int(max_frame) + 1
    # Fall back to action fcurves
    action = ad.action
    if action is None:
        return 1
    fcurves = list(action.fcurves) if hasattr(action, 'fcurves') else []
    for fc in fcurves:
        if fc.keyframe_points:
            last_kp = fc.keyframe_points[-1]
            if last_kp.co[0] > max_frame:
                max_frame = last_kp.co[0]
    return int(max_frame) + 1 if max_frame > 0 else 1


def main():
    actor_path = pathlib.Path(ARGS.actor)
    if not actor_path.is_file():
        print(f"ERROR: actor not found: {actor_path}", file=sys.stderr)
        return 1

    clear_scene()
    arm = import_actor(str(actor_path))
    if arm is None:
        print(f"ERROR: no armature found in {actor_path}", file=sys.stderr)
        return 1

    frame_count = get_frame_count(arm)
    setup_scene(frame_count)
    setup_camera()

    stem = actor_path.stem.replace(".motion-bind", "")
    rendered = []
    for frame in FRAMES:
        if frame >= frame_count:
            frame = min(frame, frame_count - 1)
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        out_path = OUT / f"{stem}-front_lit-frame{frame:04d}.png"
        bpy.context.scene.render.filepath = str(out_path)
        bpy.ops.render.render(write_still=True)
        rendered.append(str(out_path))
        print(f"CAPTURED frame={frame} -> {out_path}")

    # Write capture manifest
    manifest = {
        "actor": str(actor_path),
        "stem": stem,
        "clipName": "openclinxr_retarget_seated_talking_cc0",
        "frames": FRAMES,
        "frameCount": frame_count,
        "rendered": rendered,
        "resolution": ARGS.resolution,
    }
    manifest_path = OUT / f"{stem}-capture-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"MANIFEST -> {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
