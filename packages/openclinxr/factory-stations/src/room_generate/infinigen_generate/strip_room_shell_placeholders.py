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
    for old_name in sorted(skirting_names):
        obj = bpy.data.objects.get(old_name)
        if obj is not None and obj.type == "MESH" and obj.data:
            obj.name = f"{prefix}{args.segment}.{skirting_names[old_name]}"
            renamed.append(f"{old_name} -> {obj.name}")
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
    print(f"[strip] removed {len(removed)} placeholder(s): {removed}")


if __name__ == "__main__":
    main()
