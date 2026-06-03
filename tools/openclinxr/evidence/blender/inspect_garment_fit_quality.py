import argparse
import json
import pathlib
import sys

import bpy
from mathutils import Vector


def import_asset(path):
    suffix = path.suffix.lower()
    if suffix in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif suffix == ".obj":
        bpy.ops.wm.obj_import(filepath=str(path))
    else:
        raise RuntimeError(f"Unsupported asset format: {path}")


def mesh_bounds(obj):
    coords = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return {
        "min": [min(getattr(v, axis) for v in coords) for axis in ("x", "y", "z")],
        "max": [max(getattr(v, axis) for v in coords) for axis in ("x", "y", "z")],
    }


def extent(bounds, axis):
    return bounds["max"][axis] - bounds["min"][axis]


def center(bounds, axis):
    return (bounds["min"][axis] + bounds["max"][axis]) / 2


def main():
    parser = argparse.ArgumentParser(description="Inspect humanoid/garment fit quality from GLB/OBJ bounds.")
    parser.add_argument("--asset", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--body-name-fragment", default="Reom")
    parser.add_argument("--garment-name-fragment", default="garment")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    import_asset(pathlib.Path(args.asset))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    body = next((obj for obj in meshes if args.body_name_fragment.lower() in obj.name.lower()), None)
    garment = next((obj for obj in meshes if args.garment_name_fragment.lower() in obj.name.lower()), None)
    if body is None:
        body = max(meshes, key=lambda obj: len(obj.data.vertices))
    if garment is None:
        garment = next((obj for obj in meshes if obj != body), None)
    if body is None or garment is None:
        raise RuntimeError("Could not resolve body and garment meshes")

    body_bounds = mesh_bounds(body)
    garment_bounds = mesh_bounds(garment)
    body_width = extent(body_bounds, 0)
    garment_width = extent(garment_bounds, 0)
    body_height = extent(body_bounds, 1)
    garment_height = extent(garment_bounds, 1)
    report = {
        "schemaVersion": "2026-05-27",
        "claimBoundary": "geometric fit heuristic only; not visual, Quest, production, clinical, or scoring readiness",
        "asset": args.asset,
        "bodyObject": body.name,
        "garmentObject": garment.name,
        "bodyBounds": body_bounds,
        "garmentBounds": garment_bounds,
        "metrics": {
            "widthRatio": round(garment_width / body_width, 3) if body_width else None,
            "heightRatio": round(garment_height / body_height, 3) if body_height else None,
            "centerOffset": [
                round(center(garment_bounds, axis) - center(body_bounds, axis), 4)
                for axis in range(3)
            ],
            "frontBackDepth": round(extent(garment_bounds, 2), 4),
        },
        "heuristicFinding": "large_flat_panel_risk" if extent(garment_bounds, 2) < 0.08 else "has_some_depth",
    }
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"output": str(output), "heuristicFinding": report["heuristicFinding"], "metrics": report["metrics"]}, indent=2))


if __name__ == "__main__":
    main()
