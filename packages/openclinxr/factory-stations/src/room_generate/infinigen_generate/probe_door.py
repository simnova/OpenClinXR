#!/usr/bin/env python3
# Copyright (C) 2026 OpenClinXR. Door + footprint probe for the generate step.
# Reads the GENERATED scene.blend (no geometry invented) and reports the
# interior clear floor plus every door-leaf / casing / entrance-cutter object
# with its world location, so the station can prove the door landed on the
# requested wall at the requested offset.
#
# Usage (inside Blender headless):
#   blender --background --python probe_door.py -- \
#     --blend <scene.blend> --room bedroom --segment 0 --output <probe.json>
#
# Exit 0 printing one JSON line and writing --output. Fails closed (exit 1)
# when no floor part or no door object is found.
from __future__ import annotations

import argparse
import json
import re
import sys


def _argv_after_double_dash():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--blend", required=True)
    p.add_argument("--room", default="bedroom")
    p.add_argument("--segment", default="0")
    p.add_argument("--output", required=True)
    args = p.parse_args(_argv_after_double_dash())

    import bpy
    from mathutils import Vector

    bpy.ops.wm.open_mainfile(filepath=args.blend)
    prefix = f"{args.room}_{args.segment}/"

    def world_aabb(objs):
        mins = [float("inf")] * 3
        maxs = [float("-inf")] * 3
        for o in objs:
            for corner in o.bound_box:
                w = o.matrix_world @ Vector(corner)
                for i in range(3):
                    mins[i] = min(mins[i], w[i])
                    maxs[i] = max(maxs[i], w[i])
        return mins, maxs

    floor_objs = [
        o
        for o in bpy.data.objects
        if o.type == "MESH" and o.data and o.name.startswith(prefix) and o.name.endswith(".floor")
    ]
    if not floor_objs:
        raise SystemExit(f"[probe] no .floor part under {prefix!r} in {args.blend}")
    fmins, fmaxs = world_aabb(floor_objs)
    room = {
        "x0": round(fmins[0], 4),
        "x1": round(fmaxs[0], 4),
        "y0": round(fmins[1], 4),
        "y1": round(fmaxs[1], 4),
        "width": round(fmaxs[0] - fmins[0], 4),
        "depth": round(fmaxs[1] - fmins[1], 4),
    }

    # Interior clear floor from the WALL inner faces (not the floor-slab
    # AABB: the slab extends through the doorway threshold to the outer
    # face, overreading depth by wt/2 on the door wall -- measured 7.88 vs
    # 7.77 on the +y stage-2 pin). For each of the four sides, the inner
    # face is the large-area axis-aligned triangle plane closest to the
    # room center; the doorway/window boolean holes only subtract ~2 m^2
    # from an ~18+ m^2 face, so the max-area plane per side is unambiguous.
    planes = {}  # (axis, side, mm) -> area
    wall_objs = [
        o
        for o in bpy.data.objects
        if o.type == "MESH" and o.data and o.name.startswith(prefix) and o.name.endswith(".wall")
    ]
    if not wall_objs:
        raise SystemExit(f"[probe] no .wall part under {prefix!r} in {args.blend}")
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for o in wall_objs:
        eval_o = o.evaluated_get(depsgraph)
        mesh = eval_o.to_mesh()
        mat = o.matrix_world
        for poly in mesh.polygons:
            n = poly.normal.copy()
            n.rotate(mat.to_3x3())
            ax = max(range(3), key=lambda i: abs(n[i]))
            if abs(n[ax]) < 0.999:
                continue
            side = 1 if n[ax] > 0 else -1
            v0 = mat @ mesh.vertices[poly.vertices[0]].co
            key = (ax, side, round(v0[ax], 3))
            area = 0.0
            vs = [mat @ mesh.vertices[vi].co for vi in poly.vertices]
            for a, b in zip(vs[1:], vs[2:]):
                area += ((vs[0] - a).cross(vs[0] - b)).length / 2.0
            planes[key] = planes.get(key, 0.0) + area
        eval_o.to_mesh_clear()
    faces = {}
    # Group by axis + which side of the origin the plane sits on (the plane
    # offset sign names the wall). Normal direction is ignored: inner faces
    # point INTO the room, outer faces point out, so side-of-origin -- not
    # normal side -- identifies the wall. Inner face = closest to center.
    x_pos = [mm for (ax, s, mm), a in planes.items() if ax == 0 and mm > 0 and a > 1.0]
    x_neg = [mm for (ax, s, mm), a in planes.items() if ax == 0 and mm < 0 and a > 1.0]
    y_pos = [mm for (ax, s, mm), a in planes.items() if ax == 1 and mm > 0 and a > 1.0]
    y_neg = [mm for (ax, s, mm), a in planes.items() if ax == 1 and mm < 0 and a > 1.0]
    if not (x_pos and x_neg and y_pos and y_neg):
        raise SystemExit(f"[probe] missing large-area wall face: +x:{len(x_pos)} -x:{len(x_neg)} +y:{len(y_pos)} -y:{len(y_neg)}")
    faces["+x"] = min(x_pos)
    faces["-x"] = max(x_neg)
    faces["+y"] = min(y_pos)
    faces["-y"] = max(y_neg)
    interior_clear = {
        "width": round(faces["+x"] - faces["-x"], 4),
        "depth": round(faces["+y"] - faces["-y"], 4),
        "faces": {k: round(v, 4) for k, v in faces.items()},
    }

    def centroid(o):
        xs = ys = zs = 0.0
        n = 0
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            xs += w[0]
            ys += w[1]
            zs += w[2]
            n += 1
        return [round(xs / n, 4), round(ys / n, 4), round(zs / n, 4)]

    def is_casing(name: str) -> bool:
        return name.startswith("DoorCasingFactory(")

    def is_leaf(name: str) -> bool:
        return re.search(r"(?<!Casing)DoorFactory\(.*\)\.spawn_asset", name) is not None

    door_objects = []
    for o in bpy.data.objects:
        if o.type != "MESH" or not o.data:
            continue
        kind = "casing" if is_casing(o.name) else ("leaf" if is_leaf(o.name) else None)
        if kind is None:
            continue
        loc = o.matrix_world.translation
        door_objects.append(
            {
                "name": o.name,
                "kind": kind,
                "centroid": centroid(o),
                "location": [round(loc[0], 4), round(loc[1], 4), round(loc[2], 4)],
            }
        )
    # The boolean cutter remnant (name 'entrance') is the exact doorway
    # center when it survives in the blend; report it alongside, never as
    # the only evidence.
    cutters = []
    for o in bpy.data.objects:
        if o.name == "entrance" and o.type == "MESH":
            loc = o.matrix_world.translation
            cutters.append([round(loc[0], 4), round(loc[1], 4), round(loc[2], 4)])
    if not door_objects:
        raise SystemExit(
            "[probe] no DoorCasingFactory/DoorFactory spawn_asset mesh in "
            f"{args.blend} — refusing a silent doorless report"
        )

    report = {
        "blend": args.blend,
        "roomPrefix": prefix,
        "interiorFloor": room,
        "interiorClear": interior_clear,
        "doorObjects": door_objects,
        "entranceCutters": cutters,
    }
    # Door placement derived from the casing centroid (the leaf may rest
    # open at an angle; the casing frames the opening). Nearest inner wall
    # plane names the wall; the along-wall coordinate minus the wall
    # midpoint is the offset (midpoint ~0; computed, not assumed).
    casings = [d for d in door_objects if d["kind"] == "casing"]
    anchor = casings[0] if casings else door_objects[0]
    cx, cy = anchor["centroid"][0], anchor["centroid"][1]
    dist = {
        "+x": abs(cx - faces["+x"]),
        "-x": abs(cx - faces["-x"]),
        "+y": abs(cy - faces["+y"]),
        "-y": abs(cy - faces["-y"]),
    }
    wall = min(dist, key=lambda k: dist[k])
    if wall in ("+y", "-y"):
        mid = (faces["+x"] + faces["-x"]) / 2.0
        offset = cx - mid
    else:
        mid = (faces["+y"] + faces["-y"]) / 2.0
        offset = cy - mid
    report["doorPlacement"] = {
        "wall": wall,
        "offsetM": round(offset, 4),
        "anchor": anchor["name"],
        "anchorCentroid": anchor["centroid"],
    }
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
