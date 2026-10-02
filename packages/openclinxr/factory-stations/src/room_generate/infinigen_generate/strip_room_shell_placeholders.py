#!/usr/bin/env python3
# Copyright (C) 2026 OpenClinXR. Stage-2 extract pre-pass.
# Deletes the uncut shell placeholders (bedroom_0/0 and bedroom_0/0.meshed)
# from a COPY of the generation blend so infinigen-single-room-extract.py
# exports the room shell plus Infinigen's own door leaf, casing and skirting
# (renamed into the room prefix; the bare "entrance" cutter stays out so the
# doorway holes stay open). The placeholders are the pre-boolean shells:
# keeping them would plug the doorway/window boolean holes with solid slabs.
# Operates on a copy; the generation output stays pristine.
#
# Usage: blender --background --python strip_room_shell_placeholders.py -- \
#   --blend <in.blend> --room bedroom --segment 0 --output <out.blend>
import argparse
import math
import re
import sys


def _argv_after_double_dash():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--blend", required=True)
    p.add_argument("--room", required=True)
    p.add_argument("--segment", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args(_argv_after_double_dash())

    import bpy

    bpy.ops.wm.open_mainfile(filepath=args.blend)
    prefix = f"{args.room}_{args.segment}/"
    # S5: the extract (infinigen-single-room-extract.py) only exports objects
    # under the room prefix, but Infinigen's door leaf, casing and skirting
    # never carry it. Measured on seed-205 scene.blend:
    #   leaf    "LouverDoorFactory(8790525).spawn_asset(0)" (variant of DoorFactory;
    #           LiteDoorFactory on lite-style runs; probe_door.py matches
    #           "(?<!Casing)DoorFactory(...).spawn_asset")
    #   casing  "DoorCasingFactory(8790525).spawn_asset(0)"
    #   skirt   "skirtingboard_support" (floor) + "skirtingboard_ceiling"
    #           (make_skirting_board names "skirtingboard_" + Subpart value)
    # Rename them into the prefix FIRST so the keep/drop pass below (and the
    # extract downstream) selects them; names follow the room convention
    # "<room>_<seg>/<seg>.<part>" (e.g. "bedroom_0/0.door_leaf"). The bare
    # "entrance" boolean cutter is deliberately left out so the
    # doorway/window holes stay open.
    leaf_re = re.compile(r"(?<!Casing)DoorFactory\(.*\)\.spawn_asset\(\d+\)(\.\d+)?$")
    casing_re = re.compile(r"DoorCasingFactory\(.*\)\.spawn_asset\(\d+\)(\.\d+)?$")
    skirting_names = {
        "skirtingboard_support": "skirting_floor",
        "skirtingboard_ceiling": "skirting_ceiling",
    }
    renamed = []
    leaf_objects = []
    casing_objects = []
    for kind, matcher in (
        ("door_casing", lambda n: casing_re.search(n) is not None),
        ("door_leaf", lambda n: leaf_re.search(n) is not None),
    ):
        matches = sorted(
            o.name for o in bpy.data.objects
            if o.type == "MESH" and o.data and matcher(o.name)
        )
        for index, old_name in enumerate(matches):
            obj = bpy.data.objects.get(old_name)
            if obj is None:
                continue
            stem = f"{prefix}{args.segment}.{kind}"
            new_name = stem if len(matches) == 1 else f"{stem}_{index + 1}"
            obj.name = new_name
            renamed.append(f"{old_name} -> {new_name}")
            (casing_objects if kind == "door_casing" else leaf_objects).append(obj)
    for old_name in sorted(skirting_names):
        obj = bpy.data.objects.get(old_name)
        if obj is not None and obj.type == "MESH" and obj.data:
            obj.name = f"{prefix}{args.segment}.{skirting_names[old_name]}"
            renamed.append(f"{old_name} -> {obj.name}")

    # Infinigen decorates every entrance with a random swing angle. That is
    # useful for a furnished-house generator, but the encounter-room recipe
    # specifies a closed door. Close the retained leaf in the casing's local
    # plane before the shell bake/extract, preserving the leaf's own scale and
    # vertical centre.
    #
    # Only full-height leaves (taller than 1.5 m in world) take part in the
    # symmetric distribution: small meshes that share the leaf stem (handle /
    # lite hardware split before or during extract) ride their nearest leaf
    # with the same rotation instead of being tiled across the opening as if
    # each were a full leaf. A single full-height leaf is the measured case
    # for all current room recipes and lands on the casing-bounds centre, so
    # a genuine pair remains a closed pair instead of collapsing onto one
    # side. The anchor is the casing world-bounds centre along the width
    # axis (not the casing origin, which a factory may place at a jamb).
    closed = []
    if leaf_objects and casing_objects:
        from mathutils import Matrix, Vector

        casing = casing_objects[0]
        casing_location, casing_rotation, _ = casing.matrix_world.decompose()
        width_axis = casing_rotation @ Vector((1.0, 0.0, 0.0))
        width_axis.z = 0.0
        if width_axis.length < 0.99:
            raise RuntimeError("[strip] door casing width axis is not horizontal")
        width_axis.normalize()
        casing_corners = [casing.matrix_world @ Vector(corner) for corner in casing.bound_box]
        opening_centre = sum(
            (corner.dot(width_axis) for corner in casing_corners), 0.0
        ) / len(casing_corners)

        def leaf_height(obj):
            # Strip runs in Blender (Z-up): leaf height is the local Z span.
            # Local axes are rotation-independent, so a swung leaf still
            # measures its true panel height here.
            _, _, scale = obj.matrix_world.decompose()
            local_z = [corner[2] for corner in obj.bound_box]
            return (max(local_z) - min(local_z)) * abs(scale.z)

        def leaf_width(obj):
            _, _, scale = obj.matrix_world.decompose()
            local_x = [corner[0] for corner in obj.bound_box]
            return (max(local_x) - min(local_x)) * abs(scale.x)

        def local_center(obj):
            corners = [Vector(corner) for corner in obj.bound_box]
            return sum(corners, Vector((0.0, 0.0, 0.0))) / len(corners)

        def panel_center(obj):
            return obj.matrix_world @ local_center(obj)

        # Opening anchor: the casing bounds centre in the horizontal plane.
        # (The scalar opening_centre above is the same point projected on the
        # width axis; the full point is needed so the leaf also lands in the
        # frame's depth plane rather than keeping its swung-out depth.)
        casing_mid = sum(
            [casing.matrix_world @ Vector(corner) for corner in casing.bound_box],
            Vector((0.0, 0.0, 0.0)),
        ) / len(casing.bound_box)

        full_leaves = [obj for obj in leaf_objects if leaf_height(obj) > 1.5]
        hardware = [obj for obj in leaf_objects if obj not in full_leaves]
        if not full_leaves:
            raise RuntimeError("[strip] no full-height door leaf to close")
        ordered = sorted(full_leaves, key=lambda obj: panel_center(obj).dot(width_axis))
        widths = [leaf_width(obj) for obj in ordered]
        total_width = sum(widths)
        cursor = opening_centre - total_width / 2.0
        deltas = {}
        rotation_matrix = casing_rotation.to_matrix().to_4x4()
        for obj, width in zip(ordered, widths):
            old_matrix = obj.matrix_world.copy()
            _, _, scale = old_matrix.decompose()
            swing_before = math.degrees(
                old_matrix.to_euler().z - casing.matrix_world.to_euler().z
            )
            # Desired panel centre: its distributed slot along the width axis
            # through the casing-bounds centre, keeping the panel's own height.
            # The origin then lands where it must for the ROTATED panel centre
            # to hit that point: hinge-edge origins (mesh spans [0, width]
            # from the origin, measured on stroke) and centred origins both
            # work, at any swing angle.
            slot = cursor + width / 2.0
            current = panel_center(obj)
            flat = Vector((casing_mid.x, casing_mid.y, current.z)) + width_axis * (slot - opening_centre)
            lc = local_center(obj)
            scaled = Vector((lc.x * scale.x, lc.y * scale.y, lc.z * scale.z))
            target = flat - (rotation_matrix.to_3x3() @ scaled)
            scale_matrix = Matrix.Diagonal((scale.x, scale.y, scale.z, 1.0))
            obj.matrix_world = Matrix.Translation(target) @ rotation_matrix @ scale_matrix
            cursor += width
            deltas[obj.name] = obj.matrix_world @ old_matrix.inverted()
            closed.append({
                "name": obj.name,
                "widthM": round(width, 4),
                "centre": [round(value, 4) for value in panel_center(obj)],
                "swingDegBefore": round(swing_before, 3),
            })
        for obj in hardware:
            location = obj.matrix_world.translation
            nearest = min(
                ordered,
                key=lambda leaf: (Vector((location.x, location.y, 0.0))
                                  - Vector((leaf.matrix_world.translation.x,
                                            leaf.matrix_world.translation.y, 0.0))).length,
            )
            # Hardware rides its leaf: replay the leaf's own close transform
            # so handles and lite frames stay attached to the swung panel.
            obj.matrix_world = deltas[nearest.name] @ obj.matrix_world
            closed.append({"name": obj.name, "widthM": 0.0, "hardwareOf": nearest.name})
    keep_re = re.compile(
        r"\.(wall|floor|ceiling|exterior|door_leaf|door_casing|skirting_floor|skirting_ceiling)(_\d+)?$"
    )
    removed = []
    for o in list(bpy.data.objects):
        if o.type != "MESH" or not o.name.startswith(prefix):
            continue
        if keep_re.search(o.name):
            continue
        removed.append(o.name)
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.wm.save_as_mainfile(filepath=args.output)
    print(f"[strip] renamed {len(renamed)} door/trim object(s): {renamed}")
    print(f"[strip] closed {len(closed)} door leaf/leaves in casing plane: {closed}")
    print(f"[strip] removed {len(removed)} placeholder(s): {removed}")


if __name__ == "__main__":
    main()
