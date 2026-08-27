#!/usr/bin/env python3
"""
Locality fixture for the room occlusion bake (issue-526 phase A).

Builds a deterministic CLOSED ROOM (6.5 x 6.5 x 2.4 m — the shipped Infinigen room
class) and runs the SAME bake function the fourteen shipped rooms go through
(`bake_ao_per_material`, imported from the production script), then measures what a
near occluder does to the floor it touches versus geometry beyond the AO reach.

    region NEAR: floor 0.2-0.4 m from the +X/+Y wall corner -> must DARKEN measurably
    region FAR : the floor at the room's centre (3.25 m from every wall, 2.4 m from
                 the ceiling) -> must stay BRIGHT

The closed ceiling is the discriminator. The native Cycles AO bake is UNBOUNDED
(Blender 5.1 ignores both `max_ray_distance` and `world.light_settings.distance` for
the AO bake type — probed 2026-08-27), so it self-occludes the whole closed room to a
cave and the FAR floor reads ~0; a distance-bounded mechanism must leave the FAR floor
open because the ceiling (2.65 m) and the far walls (3.25 m) sit beyond its reach, while
the near wall (0.6 m) keeps its shadow.

The bake runs TWICE; the report carries both runs' numbers and a whole-image hash, so
the test can assert repeat-bake equality (the baker's own determinism contract) without
a second Blender invocation.

Usage:
  blender --background --python room-occlusion-locality-fixture.py -- \
    --bake-script tools/openclinxr/asset-pipeline/environment/room-occlusion-bake.py \
    --out .openclinxr/evidence/issue-526/locality-fixture.json
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys

import bpy


def _argv_after_double_dash():
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]


def load_bake_module(path):
    spec = importlib.util.spec_from_file_location("room_occlusion_bake", path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot load bake module: {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ROOM_W = 6.5
ROOM_H = 2.4  # matches the shipped Infinigen rooms (measured 2.41 m floor-to-ceiling)


def build_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.materials, bpy.data.images, bpy.data.meshes, bpy.data.node_groups):
        for item in list(block):
            try:
                block.remove(item)
            except Exception:
                pass
    # One material so the bake covers both regions in one map.
    mat = bpy.data.materials.new("locality_floor")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    out = next(n for n in mat.node_tree.nodes if n.type == "OUTPUT_MATERIAL")
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    # Subdivided floor (not one quad) so face-level sampling has spatial resolution:
    # 16x16 quads over 6.5 m -> 0.41 m cells, comparable to the bounded-AO gradient scale.
    # Blender axes: the grid is the XY plane at z=0 (normal +Z = up); walls rise in Z.
    bpy.ops.mesh.primitive_grid_add(size=ROOM_W, x_subdivisions=16, y_subdivisions=16, location=(0, 0, 0))
    floor = bpy.context.object
    floor.name = "Floor"
    floor.data.materials.append(mat)

    # Four full-height walls closing the box. The NEAR band sits 0.2-0.6 m from the
    # corner where the +X and +Y walls meet; a bounded mechanism MUST darken it strongly
    # (two walls at sub-metre distance block most of the hemisphere from a floor point).
    for (name, loc, scale) in (
        ("WallPx", (ROOM_W / 2 + 0.025, 0, ROOM_H / 2), (0.05, ROOM_W, ROOM_H)),
        ("WallNx", (-(ROOM_W / 2 + 0.025), 0, ROOM_H / 2), (0.05, ROOM_W, ROOM_H)),
        ("WallPy", (0, ROOM_W / 2 + 0.025, ROOM_H / 2), (ROOM_W, 0.05, ROOM_H)),
        ("WallNy", (0, -(ROOM_W / 2 + 0.025), ROOM_H / 2), (ROOM_W, 0.05, ROOM_H)),
    ):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        obj = bpy.context.object
        obj.name = name
        obj.scale = scale
        obj.data.materials.append(mat)

    # Ceiling closing the box at ROOM_H. Under the native (unbounded) bake this turns the
    # whole floor into a cave; under a bounded mechanism it is beyond reach.
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, ROOM_H + 0.025))
    ceiling = bpy.context.object
    ceiling.name = "Ceiling"
    ceiling.scale = (ROOM_W, ROOM_W, 0.05)
    ceiling.data.materials.append(mat)


def _img_sha(img) -> str:
    px = list(img.pixels)
    buf = bytearray()
    for v in px:
        buf += int(max(0.0, min(1.0, v)) * 65535.0).to_bytes(2, "little")
    return hashlib.sha256(bytes(buf)).hexdigest()[:16]


def measure(mod) -> dict:
    """One full bake + near/far measurement pass. Returns the report row for this run."""
    results = mod.bake_ao_per_material(512)
    if "locality_floor" not in results:
        raise SystemExit(f"fixture material was skipped by the baker: {results}")

    img = bpy.data.images.get(results["locality_floor"]["image"])
    if img is None:
        raise SystemExit("baked image missing")

    W, H = img.size
    px = list(img.pixels)  # RGBA floats 0..1

    def lum_texel(u, v):
        xi = min(W - 1, max(0, int(u * W)))
        yi = min(H - 1, max(0, int(v * H)))
        return px[(yi * W + xi) * 4]

    floor = bpy.data.objects["Floor"]
    layer = floor.data.uv_layers.get("AO_UV")
    if layer is None:
        raise SystemExit("floor has no AO_UV layer")

    depsgraph = bpy.context.evaluated_depsgraph_get()

    def texel_for_world(x, y):
        # The floor grid spans (x, y) at z=0 — the distance is measured in the grid's own
        # axes, or the nearest-face pick is unpinned (a prior version measured c.z, which
        # is 0 for every face, and read an arbitrary face's texel).
        best = None
        best_d = None
        for obj in bpy.context.scene.objects:
            if obj.type != "MESH" or "Floor" not in obj.name:
                continue
            oe = obj.evaluated_get(depsgraph)
            me = oe.to_mesh()
            lay = me.uv_layers.get("AO_UV") or me.uv_layers[0]
            mw = obj.matrix_world
            for poly in me.polygons:
                c = mw @ poly.center
                d = (c.x - x) ** 2 + (c.y - y) ** 2
                if best_d is None or d < best_d:
                    us = [lay.data[li].uv for li in poly.loop_indices]
                    u = sum(p.x for p in us) / len(us)
                    v = sum(p.y for p in us) / len(us)
                    best = (u, v)
                    best_d = d
            oe.to_mesh_clear()
        return best

    def uv_ok(u, v):
        return u is not None and v is not None and 0.0 <= u <= 1.0 and 0.0 <= v <= 1.0

    # NEAR sits in the corner where the +X and +Y walls meet (wall faces at x=3.25 and
    # y=3.25; samples at x,y = 2.85..3.05 -> 0.2-0.4 m out, so two walls block most of
    # the hemisphere). FAR is the room centre — 3.25 m from every wall, 2.4 m from the
    # ceiling — beyond any sane AO reach.
    near_uvs = [texel_for_world(x, y) for x in (2.85, 2.95, 3.05) for y in (2.85, 2.95, 3.05)]
    far_uvs = [texel_for_world(x, y) for x in (-0.4, 0.0, 0.4) for y in (-0.4, 0.0, 0.4)]
    near = min(lum_texel(u, v) for u, v in near_uvs if uv_ok(u, v))
    far = max(lum_texel(u, v) for u, v in far_uvs if uv_ok(u, v))

    return {
        "nearWall": round(near, 4),
        "far": round(far, 4),
        "darkening": round(near / far, 4) if far > 0 else None,
        "wiredSd255": results["locality_floor"]["luminanceSd255"],
        "imageSha": _img_sha(img),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bake-script", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(_argv_after_double_dash())

    mod = load_bake_module(args.bake_script)

    def fresh_run() -> dict:
        # Rebuild the scene per run — the production bake is one process per room, so the
        # determinism contract is "fresh scene + fresh bake -> identical pixels", not
        # "re-bake the same live scene" (smart_project on an existing UV layer is not
        # guaranteed stable across re-runs).
        build_scene()
        mod.setup_scene()
        return measure(mod)

    run1 = fresh_run()
    run2 = fresh_run()

    report = {
        "schemaVersion": "openclinxr.room-occlusion-locality-fixture.v1",
        "mechanism": str(getattr(mod, "AO_MECHANISM", "unknown")),
        "reachMeters": float(getattr(mod, "AO_REACH_METERS", -1)),
        "samples": 16,
        "roomMeters": {"w": ROOM_W, "h": ROOM_H},
        "run1": run1,
        "run2": run2,
        "deterministic": run1 == run2,
    }
    print("[locality] " + json.dumps(report))
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf8") as fh:
        json.dump(report, fh, indent=2)
        fh.write("\n")


if __name__ == "__main__":
    main()
