# #180 grade capture — the peds cast, LIT, front + group framing.
# The claim under test is that a learner can tell the three actors apart (comparative),
# so the group framing is the primary view. EEVEE honours Principled Base Color —
# BLENDER_WORKBENCH ignores it and would hide the very thing under test (brief line).
# The orchestrator grades the PNGs (this worker is text-only).
import argparse
import pathlib
import sys

import bpy
from mathutils import Vector

ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
PARSER = argparse.ArgumentParser()
PARSER.add_argument("--child", required=True)
PARSER.add_argument("--parent", required=True)
PARSER.add_argument("--nurse", required=True)
PARSER.add_argument("--output-dir", required=True)
PARSER.add_argument("--resolution", type=int, default=1600)
ARGS = PARSER.parse_args(ARGV)

OUT = pathlib.Path(ARGS.output_dir)
OUT.mkdir(parents=True, exist_ok=True)

SLOTS = [("child", -1.15), ("parent", 0.0), ("nurse", 1.15)]


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
    scene.render.resolution_y = int(ARGS.resolution * 0.72)
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


def make_camera(center, distance, height, look_at):
    cam = bpy.data.cameras.new("grade_cam")
    cam.angle = 0.62
    cam_obj = bpy.data.objects.new("grade_cam", cam)
    bpy.context.scene.collection.objects.link(cam_obj)
    cam_obj.location = Vector((center.x, height, center.z - distance))
    direction = Vector((look_at.x - cam_obj.location.x, look_at.y - cam_obj.location.y, look_at.z - cam_obj.location.z))
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return cam_obj


def render_view(label, camera):
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.filepath = str(OUT / f"{label}.png")
    bpy.ops.render.render(write_still=True)
    print(f"RENDER_SAVED {scene.render.filepath}")


def hide_all_but_slot(slot_x):
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            wx = (o.matrix_world @ Vector((0, 0, 0))).x
            o.hide_render = abs(wx - slot_x) > 0.4
            o.hide_viewport = o.hide_render


def unhide_all():
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            o.hide_render = False
            o.hide_viewport = False


def main():
    clear_scene()
    setup_scene()

    actors = [
        ("child", ARGS.child, -1.15),
        ("parent", ARGS.parent, 0.0),
        ("nurse", ARGS.nurse, 1.15),
    ]
    for label, glb, slot_x in actors:
        before = {o.name for o in bpy.context.scene.objects}
        bpy.ops.import_scene.gltf(filepath=glb)
        after = {o.name for o in bpy.context.scene.objects}
        new_roots = [o for o in bpy.context.scene.objects if o.name in after - before and o.parent is None]
        for o in new_roots:
            o.location = o.location + Vector((slot_x, 0.0, 0.0))
        print(f"SLOT {label} x={slot_x} roots={len(new_roots)}")

    aabb = scene_aabb()
    center = (aabb[0] + aabb[1]) / 2.0
    size = (aabb[1] - aabb[0]).length

    # GROUP front — the comparative claim (all three, lit, EEVEE).
    cam = make_camera(center, size * 1.35, center.y + 0.15, center)
    render_view("group-front", cam)
    bpy.data.objects.remove(cam, do_unlink=True)

    # Per-actor front — each alone, framed to its own bounds.
    for label, _glb, slot_x in actors:
        hide_all_but_slot(slot_x)
        a = scene_aabb()
        c = (a[0] + a[1]) / 2.0
        s = (a[1] - a[0]).length
        cam = make_camera(c, s * 1.5, c.y + 0.1, c)
        render_view(f"{label}-front", cam)
        bpy.data.objects.remove(cam, do_unlink=True)
        unhide_all()

    print(f"GRADE_DONE {OUT}")


if __name__ == "__main__":
    main()
