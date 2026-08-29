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
    [--yaw-deg <degrees>] [--keep-interior-hull-faces] \
    [--predicate-output <path>] [--allow-predicate-refuse]

`--yaw-deg` rotates the room about the world up axis (blend Z) BEFORE centering, so a
room whose outer wall (real hull) sits on one side can be oriented to the face a
consumer needs (e.g. the +Z face the interior-camera derivation uses). Geometry is
untouched — this is a deterministic orientation transform only (D1).

`--aspect-lo` / `--aspect-hi` enforce the room's declared aspect_ratio_range at extract
time (D9): the selected room's floor aspect (longest/shortest horizontal extent of its
.floor parts) must fall inside the range or the extract REFUSES (exit 2). Infinigen's
`aspect_ratio_range` constrains the FLOORPLAN footprint only (graph.py suggest_dimensions),
so the declaration reaches the extracted room only when the bake supplies a floorplan whose
target room honours it — this gate is what stops a future bake silently shipping a room
whose floor ignores the declared range.

`--drop-interior-hull-faces` is ON BY DEFAULT (2026-08-18): the extract removes
exterior-mesh faces whose world centroid lies strictly inside the wall/floor/ceiling
interior volume (2 cm float guard) — the black-frame fix for rooms whose Infinigen
exterior mesh carries interior wall fragments that occlude the derived interior camera.
The outer shell survives, so the interior-camera stand-off derivation still has its hull.
`--keep-interior-hull-faces` opts OUT (the pre-fix behaviour; the predicate then flags the
intruding faces and refuses the bake unless `--allow-predicate-refuse` is given).
`--drop-interior-hull-faces` is accepted for backward compatibility and is the default.

After export the extract runs the deterministic room predicate
(`room_extract_predicate.py`): aspect / floor area / ceiling height / hull front-facing
count toward the doorway-side eyes / doorway-candidate survive count, against thresholds
derived from the two shipped rooms (ED known-good, peds post-719cadf8). A failed
predicate REFUSES the bake (exit 2) unless `--allow-predicate-refuse`; `--predicate-output`
writes the predicate JSON to a file.

Exit 0 on success; prints one JSON line: { room, segment, parts,
  triangleCount, meshCount, materialCount, extentMeters, floorTopY, exportPath,
  predicate, droppedInteriorHullFaces }.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from typing import Dict, List

import bpy
import bmesh
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
    p.add_argument(
        "--drop-interior-hull-faces",
        action="store_true",
        help=(
            "Drop exterior-mesh faces whose world centroid lies strictly inside the "
            "wall/floor/ceiling interior volume (2 cm float guard). Keeps the hull as the "
            "room's outer shell only; removes hull fragments that intrude into the interior "
            "and would occlude the derived interior camera (black-frame, 2026-08-17). "
            "ON BY DEFAULT since 2026-08-18; kept for backward-compatible call sites."
        ),
    )
    p.add_argument(
        "--keep-interior-hull-faces",
        action="store_true",
        help=(
            "Opt OUT of the default --drop-interior-hull-faces pass. The shipped-bytes "
            "default is to drop intruding hull faces; the predicate then measures the "
            "surviving front-facing count and refuses (exit 2) unless --allow-predicate-refuse."
        ),
    )
    p.add_argument(
        "--predicate-output",
        help="Optional file to write the room predicate JSON to (the full derived thresholds)",
    )
    p.add_argument(
        "--aspect-lo",
        type=float,
        default=None,
        help=(
            "Declared aspect_ratio_range low bound (>= 1). The selected room's floor "
            "aspect (longest/shortest horizontal extent of its .floor parts) must fall "
            "inside [--aspect-lo, --aspect-hi] or the extract REFUSES (exit 2) — the "
            "declared aspect reaches the extracted room, not only the floorplan (D9). "
            "Omit for stations whose room has no declared aspect range."
        ),
    )
    p.add_argument(
        "--aspect-hi",
        type=float,
        default=None,
        help="Declared aspect_ratio_range high bound; see --aspect-lo (requires --aspect-lo).",
    )
    p.add_argument(
        "--allow-predicate-refuse",
        action="store_true",
        help=(
            "Continue (exit 0) even when the room predicate refuses the room. Escape hatch "
            "for experimentation only; the shipped bake path refuses."
        ),
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

    # Black-frame fix (2026-08-17, DEFAULT ON since 2026-08-18): drop exterior-mesh
    # faces that intrude into the interior volume. Measured on
    # `infinigen-pediatric-urgent-care-bay.glb`: the exterior mesh carried a full-height
    # interior L-shaped wall fragment (10 faces / 7.95 m2, normals facing the derived
    # interior eye) that occluded the entire viewport from inside (0.3% non-black;
    # hide-hull flips it to 97.4%). The interior volume is the wall/floor/ceiling AABB
    # (the same parts the runtime treats as "interior"); a face whose world centroid is
    # strictly inside it (2 cm float guard) is an intruding fragment, not part of the
    # outer shell. The shell faces lie at or outside that AABB, so they survive and the
    # +Z stand-off the interior-camera derivation needs is kept. `--keep-interior-hull-faces`
    # opts out (the pre-fix behaviour); the predicate then flags the intruding faces.
    drop_hull_faces = not args.keep_interior_hull_faces
    dropped = 0
    if drop_hull_faces:
        interior_mins = [float("inf")] * 3
        interior_maxs = [float("-inf")] * 3
        for o in objs:
            if not re.search(r"\.(wall|floor|ceiling)$", o.name):
                continue
            for corner in o.bound_box:
                w = o.matrix_world @ Vector(corner)
                for i in range(3):
                    interior_mins[i] = min(interior_mins[i], w[i])
                    interior_maxs[i] = max(interior_maxs[i], w[i])

        FLOAT_GUARD = 0.02  # metres; precision guard, not a design number

        def intrudes(world_centroid) -> bool:
            return all(
                interior_mins[i] + FLOAT_GUARD < world_centroid[i] < interior_maxs[i] - FLOAT_GUARD
                for i in range(3)
            )

        for o in objs:
            if not re.search(r"\.exterior$", o.name):
                continue
            bm = bmesh.new()
            bm.from_mesh(o.data)
            mat = o.matrix_world
            remove = [
                f
                for f in bm.faces
                if intrudes(mat @ f.calc_center_median())
            ]
            for f in remove:
                bm.faces.remove(f)
            dropped += len(remove)
            bm.to_mesh(o.data)
            bm.free()
            bpy.context.view_layer.update()
        print(f"[extract] dropped {dropped} interior-intruding exterior face(s)")

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
    floor_mins = [float("inf")] * 2
    floor_maxs = [float("-inf")] * 2
    for o in objs:
        if not re.search(r"\.floor$", o.name):
            continue
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            floor_top = max(floor_top or w[2], w[2])
            floor_mins[0] = min(floor_mins[0], w[0])
            floor_mins[1] = min(floor_mins[1], w[1])
            floor_maxs[0] = max(floor_maxs[0], w[0])
            floor_maxs[1] = max(floor_maxs[1], w[1])
    if floor_top is None:
        raise SystemExit(f"no mesh ending in '.floor' under {prefix!r} — cannot ground the room")

    # Declared-aspect gate (D9): `aspect_ratio_range` constrains the FLOORPLAN in Infinigen
    # (graph.py suggest_dimensions), not the individual room, so the declaration only reaches
    # the extracted room when this step enforces it. The floor's horizontal extents (X/Y in the
    # blend Z-up frame) give the usable footprint; the aspect must fall inside the declared
    # range or the extract REFUSES — a future bake cannot ship a room whose floor ignores the
    # declared aspect. Translation/rotation invariant, so measured before centering.
    floor_aspect = None
    if args.aspect_lo is not None or args.aspect_hi is not None:
        if args.aspect_lo is None or args.aspect_hi is None:
            raise SystemExit("--aspect-lo and --aspect-hi must be given together")
        fx = floor_maxs[0] - floor_mins[0]
        fy = floor_maxs[1] - floor_mins[1]
        if min(fx, fy) <= 0:
            raise SystemExit(
                f"declared-aspect gate: floor under {prefix!r} has degenerate horizontal "
                f"extent {fx:.3f} x {fy:.3f} — cannot measure aspect"
            )
        floor_aspect = max(fx, fy) / min(fx, fy)
        if not (args.aspect_lo <= floor_aspect <= args.aspect_hi):
            raise SystemExit(
                f"declared-aspect gate REFUSED this bake: floor aspect {floor_aspect:.3f} "
                f"({fx:.3f} x {fy:.3f} m) outside declared aspect_ratio_range "
                f"({args.aspect_lo}, {args.aspect_hi}) — the declaration must reach the "
                f"extracted room, not only the floorplan (re-run with a floorplan whose "
                f"target room honours the declared range)"
            )

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

    # Deterministic extract-time room predicate (2026-08-18): aspect / floor area /
    # ceiling height / hull front-facing count toward the doorway-side eyes / doorway
    # candidate survive count, against thresholds derived from the two shipped rooms
    # (ED known-good, peds post-719cadf8). Measured on the SHIPPED geometry frame the
    # runtime re-derives (centred, floor top at y=0). A refused room blocks the bake
    # (exit 2) unless --allow-predicate-refuse — a future bake cannot ship a pocket-only
    # room or a hull that still intrudes on the derived interior camera.
    _script_dir = os.path.dirname(os.path.abspath(__file__))
    if _script_dir not in sys.path:
        sys.path.insert(0, _script_dir)
    from room_extract_predicate import evaluate  # same-directory module (D1: one implementation)

    predicate_parts: Dict[str, List[List[List[float]]]] = {}
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        tri_list = []
        for lt in me.loop_triangles:
            verts = [o.matrix_world @ me.vertices[i].co for i in lt.vertices]
            # glTF export converts Blender Z-up to glTF Y-up via a -90 deg rotation about
            # X: (x, y, z)_blend -> (x, z, -y)_glb. The predicate measures the SHIPPED/GLB
            # frame (floor top y=0, doorway side +Z) — the same frame the runtime
            # re-derives and the evidence dry-run dumps — so the payload must be in that
            # frame or the +Z doorway-side convention would silently point at a different
            # wall. Measured: without this, the peds extract reported aspect 394 / floor
            # area 0.07 (the floor's depth axis read as its 1.3 cm thickness).
            tri_list.append(
                [[round(v[0], 4), round(v[2], 4), round(-v[1], 4)] for v in verts]
            )
        predicate_parts[o.name] = tri_list

    predicate = evaluate({"room": args.room, "parts": predicate_parts})
    if args.predicate_output:
        with open(args.predicate_output, "w", encoding="utf-8") as pf:
            json.dump(predicate, pf, indent=2)
    if not predicate["pass"] and not args.allow_predicate_refuse:
        raise SystemExit(
            "room predicate REFUSED this bake: "
            + "; ".join(predicate["refuseReasons"])
            + " (re-run with --allow-predicate-refuse to force through; a refused room must not ship)"
        )

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
                "declaredAspect": [args.aspect_lo, args.aspect_hi],
                "floorAspect": round(floor_aspect, 3) if floor_aspect is not None else None,
                "exportPath": args.output,
                "predicate": predicate,
                "droppedInteriorHullFaces": dropped,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
