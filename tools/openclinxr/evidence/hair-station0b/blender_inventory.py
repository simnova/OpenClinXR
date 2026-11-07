"""Evidence-only: inventory mesh objects found in the pinned body GLB.

Imports the GLB in Blender background mode, lists every MESH object with
vertex count + materials, dumps node extras. No scene changes are kept.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", required=True)
    parser.add_argument("--out", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def main():
    import bpy

    args = cli()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(Path(args.glb).resolve()))
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = sorted(
        [o for o in imported if o.type == "MESH"], key=lambda o: o.name
    )
    record = {"glb": str(Path(args.glb).resolve()), "objects": []}
    for obj in meshes:
        mats = []
        for slot in obj.material_slots:
            mat = slot.material
            mats.append(mat.name if mat is not None else None)
        record["objects"].append(
            {
                "name": obj.name,
                "vertices": len(obj.data.vertices),
                "polygons": len(obj.data.polygons),
                "materials": mats,
            }
        )
    Path(args.out).write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
    print("INVENTORY %d mesh objects" % len(meshes), flush=True)
    for entry in record["objects"]:
        print(
            "  %-70s verts=%6d tris=%6d mats=%s"
            % (entry["name"], entry["vertices"], entry["polygons"], entry["materials"]),
            flush=True,
        )


if __name__ == "__main__":
    main()
