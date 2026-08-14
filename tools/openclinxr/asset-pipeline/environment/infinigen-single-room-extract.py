#!/usr/bin/env python3
"""
Extract ONE named Infinigen room from a generated multi-room scene.blend and
export it centered with the floor top at y=0 — the #236 mesh-name selection
technique plus the centering the #336 bake uses (see PROVENANCE.md). Geometry
stays Infinigen's; this step only selects, transforms and exports (D1).

Room naming in Infinigen blends (Z-up): `<room>_<segment>/<part>` e.g.
`dining-room_0/0.wall`, `dining-room_0/0.floor`, `dining-room_0/0.ceiling`,
`dining-room_0/0.exterior`. A room NAME can carry several DISJOINT segments
(`bedroom_0/0`, `bedroom_0/1`, ...); select one segment so the exported room is
one enclosed space, not a union of two.

Centering: the floor part's world max-Z (its top) becomes y=0 and the room's
X/Y AABB centre becomes the origin. The runtime re-derives both from the room's
own geometry anyway (positionInfinigenRoom); this keeps the baked asset in the
shipped convention ("floor top at y=0, centered at origin").

Usage (inside Blender 5.1 headless):
  blender --background --python infinigen-single-room-extract.py -- \
    --blend <scene.blend> --room <room_name> --segment <idx> --output <out.glb> \
    [--yaw-deg <degrees>]

`--yaw-deg` rotates the room about the world up axis (blend Z) BEFORE centering,
so a room whose outer wall (real hull) sits on one side can be oriented to the
face a consumer needs (e.g. the +Z face the interior-camera derivation uses).
Geometry is untouched — this is a deterministic orientation transform only (D1).

Exit 0 on success; prints one JSON line: { room, segment, parts,
  triangleCount, meshCount, materialCount, extentMeters, floorTopY, exportPath }.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from typing import Dict, List

import bpy
from mathutils import Matrix, Vector


def _argv_after_double_dash() -> List[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--blend", required=True, help="Generated Infinigen scene.blend")
    p.add_argument("--room", required=True, help="Room name, e.g. dining-room")
    p.add_argument("--segment", required=True, help="Room segment index, e.g. 0")
    p.add_argument("--output", required=True, help="Output GLB path")
    p.add_argument(
        "--yaw-deg",
        type=float,
        default=0.0,
        help="Rotate the room about the world up axis (blend Z) before centering/export",
    )
    return p.parse_args(_argv_after_double_dash())


def main() -> int:
    args = parse_args()

    bpy.ops.wm.open_mainfile(filepath=args.blend)

    prefix = f"{args.room}_{args.segment}/"
    objs = [
        o
        for o in bpy.data.objects
        if o.type == "MESH" and o.data and o.name.startswith(prefix)
    ]
    if not objs:
        raise SystemExit(
            f"no mesh objects match {prefix!r} in {args.blend} — room name or segment wrong"
        )

    # Optional deterministic orientation: rotate the room about the world up axis
    # BEFORE the AABB/centering pass, so the centering applies to the rotated room.
    if args.yaw_deg:
        rot = Matrix.Rotation(math.radians(args.yaw_deg), 4, "Z")
        for o in objs:
            o.matrix_world = rot @ o.matrix_world
        bpy.context.view_layer.update()

    # World AABB over the selection (Z-up blend: X/Y horizontal, Z up).
    mins = [float("inf")] * 3
    maxs = [float("-inf")] * 3
    for o in objs:
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            for i in range(3):
                mins[i] = min(mins[i], w[i])
                maxs[i] = max(maxs[i], w[i])

    # Floor top = world max-Z across meshes whose name ends in ".floor".
    floor_top = None
    for o in objs:
        if not re.search(r"\.floor$", o.name):
            continue
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            floor_top = max(floor_top or w[2], w[2])
    if floor_top is None:
        raise SystemExit(f"no mesh ending in '.floor' under {prefix!r} — cannot ground the room")

    cx = (mins[0] + maxs[0]) / 2.0
    cy = (mins[1] + maxs[1]) / 2.0
    for o in objs:
        o.location.x -= cx
        o.location.y -= cy
        o.location.z -= floor_top
    bpy.context.view_layer.update()

    # Export with transforms applied, so the vertices land in the centered frame.
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=args.output,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
    )

    tris = 0
    mats: set[str] = set()
    parts: set[str] = set()
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        for slot in o.material_slots:
            if slot.material:
                mats.add(slot.material.name)
        parts.add(o.name.split("/")[1])

    print(
        json.dumps(
            {
                "room": args.room,
                "segment": args.segment,
                "parts": sorted(parts),
                "triangleCount": tris,
                "meshCount": len(objs),
                "materialCount": len(mats),
                "extentMeters": [round(maxs[0] - mins[0], 3), round(maxs[1] - mins[1], 3), round(maxs[2] - mins[2], 3)],
                "floorTopY": round(floor_top, 3),
                "exportPath": args.output,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
