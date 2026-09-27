#!/usr/bin/env python3
# Copyright (C) 2026 OpenClinXR. Stage-2 extract pre-pass.
# Deletes the uncut shell placeholders (bedroom_0/0 and bedroom_0/0.meshed)
# from a COPY of the generation blend so infinigen-single-room-extract.py
# exports only wall/floor/ceiling/exterior -- the same 4-node set the
# shipped ward GLB carries. The placeholders are the pre-boolean shells:
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
    keep_re = re.compile(r"\.(wall|floor|ceiling|exterior)$")
    removed = []
    for o in list(bpy.data.objects):
        if o.type != "MESH" or not o.name.startswith(prefix):
            continue
        if keep_re.search(o.name):
            continue
        removed.append(o.name)
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.wm.save_as_mainfile(filepath=args.output)
    print(f"[strip] removed {len(removed)} placeholder(s): {removed}")


if __name__ == "__main__":
    main()
