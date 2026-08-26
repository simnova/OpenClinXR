#!/usr/bin/env python3
"""
#480 L4 — bake the existing `gown` kind onto an MPFB mesh (D1: wire, do not author).

Loads the tracked isolated-subject precedent `mpfb-viseme-inspect.glb` (D3/D4, 137-joint
MPFB rail, jaw + eyes + face targets) and invokes the PROVEN Anny-rail gown builder
`automate_blender.apply_role_clothing_material_regions` with
`phenotype.garmentLayers = ["hospital_gown"]` ON AN MPFB MESH — the rail-trap clause (2)
forbids copying the 23-joint Anny gowned body.

The gown builder authors geometry in body-local Y-up (height on Y). The shipped GLB is
glTF Y-up, and Blender's glTF importer converts it to Z-up local data (height on Z). So the
body is copied and rotated -90 deg about X directly in mesh data (bmesh), the gown kind is
invoked on the copy (so the builder's painting/footwear side effects touch only the
discardable copy, not the shipped body surface), and the produced gown + declaration meshes
are rotated back +90 deg about X, re-parented to the real body, and the builder's
Anny-rail footwear slippers are discarded (the MPFB body already wears fitted toigo flats).

REGENERATION PATH (SS6r): Blender-only, on the existing shipped base GLB. It does NOT run
`orchestrate_character` (which, without the `anny` package, silently emits ~0.8 MB stubs).
No new geometry is authored: the swept gown parameter set at automate_blender.py:3527
(sleeve_along = arm_len * 0.42, bot_y = 0.32 * body_height, torso_rows/cols 11x16, locked
gown colour _GARMENT_COLOR_GOWN) is consumed as-is.

Run:
  blender --background --python tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py -- \
      --input-glb apps/ui-xr/public/generated-humanoids/mpfb-viseme-inspect.glb \
      --output-glb apps/ui-xr/public/generated-humanoids/mpfb-gown-inspect.glb
"""

import argparse
import json
import math
import pathlib
import re
import sys

import bpy
from mathutils import Matrix

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
_ANNY_DIR = REPO_ROOT / "tools/openclinxr/asset-pipeline/anny"
if str(_ANNY_DIR) not in sys.path:
    sys.path.insert(0, str(_ANNY_DIR))

from automate_blender import apply_role_clothing_material_regions  # noqa: E402

GEN = REPO_ROOT / "apps/ui-xr/public/generated-humanoids"

# #487: a gowned body never wears trousers. The source MPFB inspect GLB already carries
# makeclothes_library_cargo_pants as a separate mesh object; it passes through the export
# untouched unless removed. Classify on name AND a vertex floor, never name alone — the
# 3-vertex declaration markers must never count as a garment.
LOWER_GARMENT_RE = re.compile(r"(cargo_pants|_pants|trouser)", re.IGNORECASE)
MIN_REAL_GARMENT_VERTS = 100


def _strip_lower_garments(body):
    """Remove any real lower garment from the imported scene before the gown is baked.

    The gown builder operates on a copy of the body surface only and never touches the
    pre-existing cargo_pants object, so it survives to export and pokes through the skirt
    (#485: +16.6 mm on 56% of thigh-band vertices)."""
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH" or o is body:
            continue
        if len(o.data.vertices) < MIN_REAL_GARMENT_VERTS:
            continue
        if not LOWER_GARMENT_RE.search(o.name):
            continue
        print(f"STRIP_LOWER_GARMENT {o.name!r} verts={len(o.data.vertices)}")
        bpy.data.objects.remove(o, do_unlink=True)


def _strip_existing_gown():
    """Remove a gown the INPUT already carries before the builder re-bakes one.

    The regeneration path runs `--input-glb` on a previously gowned asset (the #684
    shape: input == the shipped cast asset), and the builder emits a NEW gown mesh. The
    input's gown object is not in the builder's `created` set, so without this strip it
    survives to export and the GLB carries two overlapping hospital gowns — the old
    conformal shell (3419 verts, normal-dot ~0.99) and the new draped one, which
    confounds every normal-dot contract on the shipped asset (#686)."""
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH":
            continue
        if "real_garment" not in o.name.lower():
            continue
        print(f"STRIP_EXISTING_GOWN {o.name!r} verts={len(o.data.vertices)}")
        bpy.data.objects.remove(o, do_unlink=True)


def _find_body():
    # The body is the *_body mesh (the eyes/gaze helper is *_body_mesh.low-poly). Name-based,
    # not vertex-count: the fitted toigo flats shoe imports at 115k verts, more than the body.
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name.endswith("_body"):
            return o
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no mesh objects after import")
    return max(meshes, key=lambda o: len(o.data.materials))


def _find_armature():
    for o in bpy.context.scene.objects:
        if o.type == "ARMATURE":
            return o
    raise RuntimeError("no armature after import")


def _rotate_mesh_data(obj, rx_rad):
    """Rotate the mesh data vertices about local X (bakes into the data, bypasses object
    transform / parenting / armature-modifier interference)."""
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(rx_rad, 4, "X"))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def _weld_by_position(obj, dist=0.0001):
    """Merge coincident vertices. The shipped MPFB body is split by glTF material seams
    (8 material regions exported as non-welded primitives -> 99 face-adjacency components);
    the Anny gown builder's chest-seed flood-fill assumes a single connected body surface.
    Welding the coincident seam verts restores the canonical 13,380-vert single surface."""
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def _local_bounds(o):
    xs = [v.co.x for v in o.data.vertices]
    ys = [v.co.y for v in o.data.vertices]
    zs = [v.co.z for v in o.data.vertices]
    return (
        round(min(xs), 3), round(max(xs), 3),
        round(min(ys), 3), round(max(ys), 3),
        round(min(zs), 3), round(max(zs), 3),
    )


def _new_objects_after(before_names):
    return [o for o in bpy.context.scene.objects if o.name not in before_names]


def main() -> None:
    ap = argparse.ArgumentParser(description="#480 bake MPFB gown inspect GLB")
    ap.add_argument("--input-glb", default=str(GEN / "mpfb-viseme-inspect.glb"))
    ap.add_argument("--output-glb", default=str(GEN / "mpfb-gown-inspect.glb"))
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    for o in list(bpy.context.scene.objects):
        bpy.data.objects.remove(o, do_unlink=True)

    bpy.ops.import_scene.gltf(filepath=str(REPO_ROOT / args.input_glb))
    bpy.context.view_layer.update()

    body = _find_body()
    armature = _find_armature()
    print(f"IMPORTED body={body.name!r} verts={len(body.data.vertices)} armature={armature.name!r}")
    print(f"BODY_LOCAL x={_local_bounds(body)}")

    _strip_lower_garments(body)
    _strip_existing_gown()
    bpy.context.view_layer.update()

    before = {o.name for o in bpy.context.scene.objects}

    # Clean, unparented Y-up body copy. The builder reads local Y as height; the real body
    # stays untouched (Z-up, shipped skin/hide materials intact). No parent, no armature
    # modifier, no shape keys: bmesh from_mesh/to_mesh inside the builder drops/corrupts
    # shape keys, and a parented+modifier copy defeats direct vertex rotation.
    body_copy = body.copy()
    body_copy.data = body.data.copy()
    bpy.context.collection.objects.link(body_copy)
    body_copy.name = f"{body.name}__gown_bake_copy"
    body_copy.data.name = f"{body.name}__gown_bake_copy"
    body_copy.parent = None
    body_copy.matrix_parent_inverse = Matrix.Identity(4)
    body_copy.modifiers.clear()
    if body_copy.data.shape_keys is not None:
        body_copy.shape_key_clear()
    _rotate_mesh_data(body_copy, -math.pi / 2.0)
    _weld_by_position(body_copy)
    bpy.context.view_layer.update()
    print(f"BODY_COPY_YUP x={_local_bounds(body_copy)} verts={len(body_copy.data.vertices)}")

    # Invoke the existing gown kind on the MPFB body copy — the D1 wiring point. The swept
    # #200 parameter set (0.42 sleeve, 0.32 hem) and the locked gown colour are the
    # builder's own; nothing is re-swept or re-authored here.
    phenotype = {
        "garmentLayers": ["hospital_gown"],
        "clothing_style": "clinical_exam_hospital_gown_chest_pain",
        "clothing_color": "soft_blue",
        "fabricPalette": "hospital_gown_blue_pattern",
        "role_visual_cue": "ed_chest_pain_patient",
        "skin_tone": "warm_medium",
        "hair_color": "brown",
        "eye_color": "brown",
    }
    result = apply_role_clothing_material_regions(body_copy, "patient", phenotype, armature)
    bpy.context.view_layer.update()
    print("GOWN_BUILDER_RESULT " + json.dumps({k: result.get(k) for k in (
        "realGarmentLayers", "declaredUpperGarmentLayers", "declaredUpperGarmentLayerCount",
        "lowerFaceCount", "armFaceCount", "skippedTorsoPaintBecauseRealGarment",
    ) if k in result}, default=str))

    created = _new_objects_after(before)
    print(f"CREATED_OBJECTS {[o.name for o in created]}")

    # Keep only the gown shell + declaration micro-tri. Rotate them back to Z-up local data
    # and re-home onto the real body + real rig. The Anny-rail footwear slippers and the
    # discardable painted body copy are dropped (the MPFB body already wears toigo flats).
    kept = []
    discard = []
    for obj in created:
        if obj.type != "MESH":
            continue
        name = obj.name.lower()
        if "real_garment" in name or "declared_upper_layers" in name:
            _rotate_mesh_data(obj, math.pi / 2.0)
            obj.parent = body
            obj.matrix_parent_inverse = Matrix.Identity(4)
            # Re-point the armature modifier to the real rig (belt-and-braces; it already
            # points there because the real armature was passed as arm_obj).
            for mod in obj.modifiers:
                if mod.type == "ARMATURE":
                    mod.object = armature
            kept.append(obj)
        else:
            discard.append(obj)

    # Re-parent first, THEN delete the discarded copies (deleting a parent while children
    # still reference it raises a StructRNA ReferenceError).
    for obj in discard:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()

    for obj in kept:
        print(f"KEPT {obj.name!r} x={_local_bounds(obj)}")

    bpy.ops.object.select_all(action="SELECT")
    out = REPO_ROOT / args.output_glb
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_skins=True,
        export_morph=True,
        export_texcoords=True,
        export_normals=True,
    )
    print(f"EXPORTED {out} {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
