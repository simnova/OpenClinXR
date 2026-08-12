"""
Measure a hospital-bed-like GLB: AABB + largest horizontal surface band (deck candidate).

Usage:
  blender --background --python tools/openclinxr/factory/equipment-lane/measure-deck-glb.py -- \
    --glb path/to/model.glb --out path/to/report.json

claimScope: numeric deck/length measure for bank promotion gate.
notEvidenceFor: clinical accuracy, Quest readiness.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args(argv: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    i = 0
    while i < len(argv):
        if argv[i] == "--glb" and i + 1 < len(argv):
            out["glb"] = argv[i + 1]
            i += 2
        elif argv[i] == "--out" and i + 1 < len(argv):
            out["out"] = argv[i + 1]
            i += 2
        else:
            i += 1
    return out


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block)


def import_glb(path: str) -> None:
    bpy.ops.import_scene.gltf(filepath=path)


def world_bounds() -> tuple[Vector, Vector]:
    mins = Vector((math.inf, math.inf, math.inf))
    maxs = Vector((-math.inf, -math.inf, -math.inf))
    any_mesh = False
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        any_mesh = True
        for corner in obj.bound_box:
            w = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, w.x)
            mins.y = min(mins.y, w.y)
            mins.z = min(mins.z, w.z)
            maxs.x = max(maxs.x, w.x)
            maxs.y = max(maxs.y, w.y)
            maxs.z = max(maxs.z, w.z)
    if not any_mesh:
        raise RuntimeError("no mesh objects after import")
    return mins, maxs


def largest_horizontal_band(bin_size: float = 0.01) -> dict:
    """Area-weighted bands of near-horizontal faces by world Z."""
    bins: dict[int, float] = {}
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        mesh.calc_loop_triangles()
        mw = obj.matrix_world
        for tri in mesh.loop_triangles:
            verts = [mw @ mesh.vertices[i].co for i in tri.vertices]
            n = (verts[1] - verts[0]).cross(verts[2] - verts[0])
            area = n.length * 0.5
            if area < 1e-8:
                continue
            n.normalize()
            # horizontal if world-Z component dominates
            if abs(n.z) < 0.85:
                continue
            z = (verts[0].z + verts[1].z + verts[2].z) / 3.0
            key = int(math.floor(z / bin_size))
            bins[key] = bins.get(key, 0.0) + area
    if not bins:
        return {"deckTopM": None, "deckAreaM2": 0.0, "bins": []}
    best_key = max(bins.keys(), key=lambda k: bins[k])
    deck_z = (best_key + 0.5) * bin_size
    ranked = sorted(
        [{"z": (k + 0.5) * bin_size, "area": a} for k, a in bins.items()],
        key=lambda r: -r["area"],
    )[:8]
    return {"deckTopM": deck_z, "deckAreaM2": bins[best_key], "bins": ranked}


def main() -> None:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    args = parse_args(argv)
    glb = args.get("glb")
    out = args.get("out")
    if not glb or not out:
        raise SystemExit("need --glb and --out")
    clear_scene()
    import_glb(glb)
    mins, maxs = world_bounds()
    size = maxs - mins
    # Ground so minZ = 0 for deck-height readability
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.location.z -= mins.z
    bpy.context.view_layer.update()
    mins2, maxs2 = world_bounds()
    size2 = maxs2 - mins2
    band = largest_horizontal_band()
    report = {
        "glb": glb,
        "aabbMin": [mins2.x, mins2.y, mins2.z],
        "aabbMax": [maxs2.x, maxs2.y, maxs2.z],
        "sizeM": {"x": size2.x, "y": size2.y, "z": size2.z},
        # Prefer longer horizontal as length for beds (X or Y)
        "lengthM": max(size2.x, size2.y),
        "widthM": min(size2.x, size2.y),
        "heightM": size2.z,
        "deckTopM": band["deckTopM"],
        "deckAreaM2": band["deckAreaM2"],
        "topHorizontalBands": band["bins"],
        "spec": {
            "hospitalBed": {"lengthM": 2.15, "widthM": 0.98, "deckTopM": 0.58},
            "stretcher": {"lengthM": 2.0, "widthM": 0.72, "deckTopM": 0.72},
        },
    }
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"ok": True, "out": out, "lengthM": report["lengthM"], "deckTopM": report["deckTopM"]}))


if __name__ == "__main__":
    main()
