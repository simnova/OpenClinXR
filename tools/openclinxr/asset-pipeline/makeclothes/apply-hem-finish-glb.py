#!/usr/bin/env python3
"""st-hemfin: apply the reusable hem-finish stage to a shipped GLB.

Calls packages/openclinxr/factory-stations/src/body_param/garment_ops.py
finish_garment_hem (the D1 stage — Blender bmesh ops, no hand-authored
vertex lists) on the named garment mesh inside a full-GLB Blender
import, then grafts ONLY that garment mesh back into the input bytes
(graft-hem-garment.mjs). Untouched meshes keep their exact input
POSITION/index bytes (st-palette round 5 C2: the full round-trip export
rewrote eyebrows/body/pants); the graft verifies this and fails loudly
on any drift. Only the garment mesh's vertex positions change; armature,
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


def _normalise_mask_cutoff(glb_path):
    """Re-stamp explicit alphaCutoff 0.5 on MASK materials (export hygiene).

    Blender's glTF exporter omits alphaCutoff when it equals the spec default
    (0.5), but the hide-mask contracts pin it explicit
    (the-nurse-sternal-t-is-classified-from-the-glb.test.ts:189,
    hide-mask-stops-below-the-head). The value is semantically identical to
    the default; only its presence is restored. Returns the patched count.
    """
    import struct as _struct

    raw = bytearray(pathlib.Path(glb_path).read_bytes())
    json_len = _struct.unpack("<I", bytes(raw[12:16]))[0]
    doc = json.loads(bytes(raw[20:20 + json_len]).decode("utf8"))
    patched = 0
    for m in doc.get("materials", []):
        if m.get("alphaMode") == "MASK" and "alphaCutoff" not in m:
            m["alphaCutoff"] = 0.5
            patched += 1
    if patched:
        new_json = json.dumps(doc, separators=(",", ":")).encode("utf8")
        # GLB JSON chunk is 4-byte aligned; pad with spaces (valid JSON ws).
        pad = (-len(new_json)) % 4
        new_json += b" " * pad
        rest = bytes(raw[20 + json_len:])
        total = 12 + 8 + len(new_json) + len(rest)
        rebuilt = (
            bytes(raw[:8])
            + _struct.pack("<I", total)
            + _struct.pack("<I", len(new_json))
            + bytes(raw[16:20])
            + new_json
            + rest
        )
        assert len(rebuilt) == total, (len(rebuilt), total)
        pathlib.Path(glb_path).write_bytes(rebuilt)
    return patched


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


def _purge_degenerate(mesh_obj):
    """Drop faces whose corners coincide to 5dp (the holes-test weld key).

    Blender's glTF import silently drops SOME zero-area faces (measured:
    nurse pants 2704 -> 2689 tris, fever shirt 4883 -> 4882), leaving
    surviving twins as singly-linked singles that read as micro-boundary
    loops. Deleting the 5dp-degenerate remainder up front makes the round
    trip lossless w.r.t. loop topology: zero-area faces are never surface,
    skinning, or morphs (indexed by vertex; only index entries vanish, and
    only DELETE ops run — no face is recreated, so surviving loop data such
    as UVs is untouched). Body/eyes/hair are never round-tripped: detection
    is mesh-level and bmesh opens only when something will be deleted.
    Returns the removed face count.
    """
    import bmesh as _bm

    mesh = mesh_obj.data
    verts = mesh.vertices
    degen = []
    for poly in mesh.polygons:
        keys = set()
        for li in poly.loop_indices:
            co = verts[mesh.loops[li].vertex_index].co
            keys.add("%.5f,%.5f,%.5f" % (co.x, co.y, co.z))
        if len(keys) < len(poly.loop_indices):
            degen.append(poly.index)
    if not degen:
        return 0
    bm = _bm.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    _bm.ops.delete(bm, geom=[bm.faces[i] for i in degen], context="FACES")
    bm.verts.ensure_lookup_table()
    orphans = [v for v in bm.verts if not v.link_faces]
    if orphans:
        _bm.ops.delete(bm, geom=orphans, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return len(degen)


def _is_fitted_garment(mesh_name):
    n = mesh_name or ""
    return ("makeclothes_library" in n or "real_garment" in n)


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
    purged = {}
    # st-palette round 5 C2/C3: the degenerate purge runs on the TARGET
    # garment only. Purging every fitted garment mutated out-of-scope
    # meshes (nurse pants 2704 -> 2676 tris); untouched meshes now come
    # from the input file via the graft, so only the finished mesh may
    # lose faces here.
    for o in meshes:
        if o.data.name == args.garment_mesh or o.name == args.garment_mesh:
            n = _purge_degenerate(o)
            if n:
                purged[o.data.name] = n
    if purged:
        report["degeneratePurge"] = purged
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
    # st-palette round 5 C2: the Blender export round trip rewrites meshes
    # it does not finish (nurse eyebrows 9597/9856 -> 8690/10838, body
    # verts 8437 -> 8455). Export to a temp file, then graft ONLY the
    # finished garment mesh back into the input bytes: every other mesh
    # keeps its exact input accessor data (verified by the graft script,
    # which fails loudly on any drift).
    tmp_export = str(pathlib.Path(args.output).parent / (pathlib.Path(args.output).stem + ".tmp-blender.glb"))
    bpy.ops.export_scene.gltf(
        filepath=tmp_export,
        use_selection=True,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_materials="EXPORT",
        export_skins=True,
        export_morph=True,
        export_animations=True,
    )
    import shutil as _shutil
    import subprocess as _subprocess

    graft_script = str(here.parent / "graft-hem-garment.mjs")
    node_bin = _shutil.which("node")
    if node_bin is None:
        raise RuntimeError("graft needs node on PATH (graft-hem-garment.mjs)")
    graft_report_path = str(pathlib.Path(args.report).parent / (pathlib.Path(args.report).stem + ".graft.json"))
    _subprocess.run(
        [node_bin, graft_script,
         "--origin", args.input,
         "--finished", tmp_export,
         "--garment", target.data.name,
         "--output", args.output,
         "--report", graft_report_path],
        check=True,
    )
    report["graftReport"] = graft_report_path
    report["maskCutoffNormalised"] = _normalise_mask_cutoff(args.output)
    report["output"] = args.output
    pathlib.Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(args.report).write_text(json.dumps(report, indent=1))
    print("HEM_FINISH_GLB " + json.dumps(report))
    if untouched:
        raise SystemExit("non-garment meshes changed: %s" % untouched)


main()
