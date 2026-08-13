# #360 grade capture — per-actor TORSO framing, LIT, so cloth weave is resolvable.
# The claim under test is that a garment now reads as FABRIC (declared diffuse texture
# consumed) while the #180 role colour survives. A torso close-up is the framing where a
# 2D texture's weave/pattern is distinguishable from a flat colour. EEVEE honours Principled
# Base Color — BLENDER_WORKBENCH ignores it and would hide the very thing under test (brief
# line). The orchestrator grades the PNGs (this worker is text-only).
import argparse
import pathlib
import sys

import bpy
from mathutils import Vector

ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
PARSER = argparse.ArgumentParser()
PARSER.add_argument("--glb", required=True)
PARSER.add_argument("--label", required=True)
PARSER.add_argument("--output", required=True)
PARSER.add_argument("--resolution", type=int, default=1600)
ARGS = PARSER.parse_args(ARGV)

OUT = pathlib.Path(ARGS.output)


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
    scene.render.resolution_y = int(ARGS.resolution * 0.8)
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("grade_world")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.16, 0.18, 0.22, 1.0)
        bg.inputs[1].default_value = 0.6
    sun = bpy.data.lights.new("grade_sun", type="SUN")
    sun.energy = 3.0
    sun.angle = 0.15
    sun_obj = bpy.data.objects.new("grade_sun", sun)
    scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (0.9, -0.35, 0.6)
    fill = bpy.data.lights.new("grade_fill", type="AREA")
    fill.energy = 60.0
    fill.size = 6.0
    fill_obj = bpy.data.objects.new("grade_fill", fill)
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


def main():
    clear_scene()
    setup_scene()
    bpy.ops.import_scene.gltf(filepath=ARGS.glb)
    aabb = scene_aabb()
    if aabb is None:
        raise RuntimeError("no mesh bounds in scene")
    lo, hi = aabb
    center = (lo + hi) / 2.0
    stature = hi.y - lo.y
    # TORSO framing: aim at ~0.6 of stature (mid-torso, where the shirt weave lives),
    # pull the camera in so the cloth texture is resolvable (vs full-figure framing).
    focus = Vector((center.x, lo.y + 0.6 * stature, center.z))
    cam = bpy.data.cameras.new("torso_cam")
    cam.angle = 0.62
    cam_obj = bpy.data.objects.new("torso_cam", cam)
    bpy.context.scene.collection.objects.link(cam_obj)
    distance = stature * 0.75
    cam_obj.location = Vector((focus.x, focus.y + distance, focus.z + stature * 0.05))
    direction = focus - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene = bpy.context.scene
    scene.camera = cam_obj
    scene.render.filepath = str(OUT)
    bpy.ops.render.render(write_still=True)
    print(f"RENDER_SAVED {scene.render.filepath}")


if __name__ == "__main__":
    main()
