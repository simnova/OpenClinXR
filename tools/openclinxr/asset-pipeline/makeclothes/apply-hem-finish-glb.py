#!/usr/bin/env python3
"""st-hemfin: apply the reusable hem-finish stage to a shipped GLB.

Calls packages/openclinxr/factory-stations/src/body_param/garment_ops.py
finish_garment_hem (the D1 stage — Blender bmesh ops, no hand-authored
vertex lists) on the named garment mesh inside a full-GLB Blender
round trip. Only the garment mesh's vertex positions change; armature,
weights, morphs, animations, materials and all other meshes are preserved
(verified per-mesh in the report — any non-garment delta fails the run).

Run (repo station script; Blender via this file only):
  blender --background --python \
    tools/openclinxr/asset-pipeline/makeclothes/apply-hem-finish-glb.py -- \
    --input <glb> --garment-mesh <meshName> --output <glb> --report <json> \
    [--no-cut]

D2 vehicle: the 4 sawn-hem assets are rebaked through the D1 stage here;
the producer + cause are recorded in each asset's .provenance.json.
"""

import argparse
import hashlib
import json
import pathlib
import sys

import bpy


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--garment-mesh", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--no-cut", action="store_true")
    return p.parse_args(argv)


def mesh_digest(obj):
    h = hashlib.sha256()
    for v in obj.data.vertices:
        h.update(("%0.6f,%0.6f,%0.6f;" % (v.co.x, v.co.y, v.co.z)).encode())
    h.update(("faces=%d;" % len(obj.data.polygons)).encode())
    return h.hexdigest()[:16]


def main():
    args = parse_args()
    here = pathlib.Path(__file__).resolve()
    body_param_dir = (
        here.parents[4] / "packages" / "openclinxr" / "factory-stations"
        / "src" / "body_param"
    )
    if str(body_param_dir) not in sys.path:
        sys.path.insert(0, str(body_param_dir))
    from garment_ops import finish_garment_hem  # noqa: E402

    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args.input)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    report = {
        "stage": "apply-hem-finish-glb",
        "input": args.input,
        "garmentMesh": args.garment_mesh,
        "meshCount": len(meshes),
        "actionCount": len(bpy.data.actions),
    }
    before = {}
    for o in meshes:
        before[o.data.name] = {
            "verts": len(o.data.vertices),
            "faces": len(o.data.polygons),
            "digest": mesh_digest(o),
        }
    report["before"] = before

    target = None
    for o in meshes:
        if o.data.name == args.garment_mesh or o.name == args.garment_mesh:
            target = o
            break
    if target is None:
        raise RuntimeError("garment mesh %r not found" % args.garment_mesh)

    bpy.context.view_layer.objects.active = target
    target.select_set(True)
    hem = finish_garment_hem(target, cut_closed_solids=not args.no_cut)
    report["hemFinish"] = hem

    after = {}
    for o in meshes:
        after[o.data.name] = {
            "verts": len(o.data.vertices),
            "faces": len(o.data.polygons),
            "digest": mesh_digest(o),
        }
    report["after"] = after
    untouched = [
        name for name in before
        if name in after and name != target.data.name
        and after[name]["digest"] != before[name]["digest"]
    ]
    report["nonGarmentChanged"] = untouched
    report["animationsPreserved"] = len(bpy.data.actions)

    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.export_scene.gltf(
        filepath=args.output,
        use_selection=True,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_materials="EXPORT",
        export_skins=True,
        export_morph=True,
        export_animations=True,
    )
    report["output"] = args.output
    pathlib.Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(args.report).write_text(json.dumps(report, indent=1))
    print("HEM_FINISH_GLB " + json.dumps(report))
    if untouched:
        raise SystemExit("non-garment meshes changed: %s" % untouched)


main()
