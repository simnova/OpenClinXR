import argparse
import pathlib

import bpy
import numpy as np


def make_material(name, color):
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    material.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = color
    material.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.78
    return material


def parse_args():
    argv = []
    if "--" in __import__("sys").argv:
        argv = __import__("sys").argv[__import__("sys").argv.index("--") + 1 :]
    parser = argparse.ArgumentParser(description="Materialize a local MPFB humanoid GLB comparator.")
    parser.add_argument("--output", required=True)
    return parser.parse_args(argv)


def main():
    args = parse_args()
    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.mpfb.create_human()

    human = bpy.data.objects["Human"]
    human.name = "mpfb_ob_patient_aisha_body_mesh"
    human.data.name = "mpfb_ob_patient_aisha_body"
    human.data.materials.clear()
    human.data.materials.append(make_material("mpfb_skin_warm_ob_patient", (0.68, 0.53, 0.44, 1.0)))

    # #222: wire the proven bounds-derived scalp/hair material region from the Anny rail
    # (tools/openclinxr/asset-pipeline/anny/automate_blender.py:4201) instead of hand-authoring
    # a UV sphere (D1: "do not have workers hand-author bespoke geometry"). The function is not
    # topology-bound: it derives the region from mesh bounds, auto-detects the dominant height
    # axis, and excludes the front mid-face band (#73). MPFB create_human is Blender-local
    # Z-up with the face at -Y (measured 2026-08-11: nose tip at y=-0.168, head positive
    # extreme at +0.054) — exactly what the function's Z-height branch expects, so NO Z-flip is
    # applied. A 180-deg Z flip (the pre-#317 assumption that create_human faces +Y) pushes the
    # face to +Y, the face-band exclusion never fires (skippedFaceFrontFaceCount=0), and the
    # scalp paint covers the eyes/brows — which strands their morph-target deltas on the scalp
    # primitive at export and made #317's face census read them as empty.
    import sys as _sys

    _anny_dir = pathlib.Path(__file__).resolve().parents[4] / "tools/openclinxr/asset-pipeline/anny"
    if str(_anny_dir) not in _sys.path:
        _sys.path.insert(0, str(_anny_dir))
    from automate_blender import apply_mesh_native_scalp_hair_material_region  # noqa: E402

    scalp_hair_region = apply_mesh_native_scalp_hair_material_region(
        human, {"hair_color": "black", "hair_density": 0.65}
    )
    print(f"SCALP_HAIR_REGION {scalp_hair_region}")

    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = human
    human.select_set(True)
    bpy.ops.mpfb.add_standard_rig()

    # #317: replace the MPFB UI operator with the proven TargetService path.
    # bpy.ops.mpfb.load_face_shape_keys() reads FACEOPS_PROPERTIES from the panel, finds nothing
    # in a headless run, warns, and returns FINISHED — the bake looked green while Aisha shipped
    # with ZERO face targets (D1: wire the proven tool, do not hand-author morph geometry).
    # body_param_stage.load_mpfb_face_shape_keys walks the MPFB extension target tree and calls
    # TargetService.filename_to_shapekey_name + TargetService.load_target directly — the path
    # that gave the two hm08 library bodies their 27 face targets and 13 working mouth shapes.
    import sys as _sys2

    _makeclothes_dir = (
        pathlib.Path(__file__).resolve().parents[4] / "tools/openclinxr/asset-pipeline/makeclothes"
    )
    if str(_makeclothes_dir) not in _sys2.path:
        _sys2.path.insert(0, str(_makeclothes_dir))
    from body_param_stage import load_mpfb_face_shape_keys  # noqa: E402

    face_status = load_mpfb_face_shape_keys(human)
    print(f"FACE_TARGETS {face_status}")
    if face_status.get("error") or (face_status.get("loaded") or 0) < 8:
        raise RuntimeError(f"face target load failed: {face_status}")
    mouth_named = [n for n in (face_status.get("names") or []) if any(
        k in n for k in ("mouth", "lip", "jaw")
    )]
    print(f"FACE_TARGETS_MOUTH_NAMED {len(mouth_named)} {mouth_named}")
    if len(mouth_named) < 8:
        raise RuntimeError(
            f"fewer than 8 mouth-named face targets loaded ({len(mouth_named)}); "
            f"a bake that ships without usable mouth morphs must fail loudly"
        )

    # #318: strip MakeHuman's clothes and hair FITTING SHELLS with the proven MPFB export
    # service (D1). `bpy.ops.mpfb.create_human()` materialises the FULL base.obj including
    # helper geometry — 36,972 tris, exactly MADR 0052's "with helpers" figure — and Aisha
    # has shipped with those shells since #263 (graded 2026-08-11: a floor-length robe and a
    # hood with flat quads across the face, hiding the correct body beneath). 
    # ExportService.bake_modifiers_remove_helpers (exportservice.py:79, remove_helpers=True)
    # is the MPFB-shipped strip; the documented result is 26,756 tris / 13,380 verts (MADR
    # 0052 cross-check). ORDER IS LOAD-BEARING: the face targets must load on the FULL base
    # topology above — deleting helper verts re-maps shape-key blocks, and a target loaded
    # after the strip would mis-index (body_param_stage.py #221 A2). The FACS keys loaded
    # above survive on body-surface verts; Blender updates their key blocks when the helper
    # verts are deleted.
    verts_before_strip = len(human.data.vertices)
    tris_before_strip = sum(max(len(p.vertices) - 2, 0) for p in human.data.polygons)
    from bl_ext.user_default.mpfb.services.exportservice import ExportService  # noqa: E402

    ExportService.bake_modifiers_remove_helpers(
        human, bake_masks=False, bake_subdiv=False, remove_helpers=True, also_proxy=True
    )
    bpy.context.view_layer.update()
    verts_after_strip = len(human.data.vertices)
    tris_after_strip = sum(max(len(p.vertices) - 2, 0) for p in human.data.polygons)
    print(
        f"HELPER_STRIP verts {verts_before_strip} -> {verts_after_strip}; "
        f"tris {tris_before_strip} -> {tris_after_strip}"
    )

    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if armature is None:
        raise RuntimeError("MPFB standard rig was not created")
    armature.name = "mpfb_ob_patient_aisha_standard_rig"

    # #321: fit a real MakeHuman garment on the helper-stripped basemesh via the
    # PROVEN ClothesService path (D1) — the same code body_param_stage.py uses for
    # the hm08 library rail. Do not hand-author garment geometry and do not write a
    # new fitter. ORDER IS LOAD-BEARING: the fit runs AFTER the #318 helper strip
    # because .mhclo vertex refs index the canonical 13,380-vert hm08 basemesh
    # topology — exactly what the strip leaves. The toigo basic tucked t-shirt is
    # CC0 (mhclo header) and references only body verts (max ref 11,017 < 13,380);
    # the polo references 3,648 helper verts and CANNOT fit a stripped basemesh —
    # it is refused loudly, not fitted against absent indices (clause 3).
    # CLINICAL CHOICE: the least-wrong garment for an OB triage patient. A hospital
    # gown is not in the cached library and a scrub shirt is staff wear; a patient
    # presenting in street clothes (a basic t-shirt) is plausible triage staging.
    import sys as _sys3

    _stage_dir = pathlib.Path(__file__).resolve().parents[4] / "tools/openclinxr/asset-pipeline/makeclothes"
    if str(_stage_dir) not in _sys3.path:
        _sys3.path.insert(0, str(_stage_dir))
    from body_param_stage import import_obj, apply_object_transforms, transfer_weights_body_to_garment  # noqa: E402

    _garment_dir = (
        pathlib.Path(__file__).resolve().parents[4]
        / ".openclinxr-local/provider-cache/garments/sources/makehuman-shirts01/toigo_basic_tucked_t-shirt"
    )
    garment_obj = _garment_dir / "t_shirt_basic_tucked.obj"
    garment_mhclo = _garment_dir / "toigo_basic_tucked_t-shirt.mhclo"
    if not garment_obj.is_file() or not garment_mhclo.is_file():
        raise RuntimeError(f"toigo t-shirt sources missing in provider cache: {_garment_dir}")

    from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo  # noqa: E402
    from bl_ext.user_default.mpfb.services.clothesservice import ClothesService  # noqa: E402

    garment = import_obj(str(garment_obj), "makeclothes_library_toigo_t_shirt", force_z=False)
    # #321 handback: bake the OBJ importer's axis rotation into mesh data so the garment object is
    # identity/Z-up — the SAME bake MPFB's body loader performs on the basemesh
    # (`ObjectService.load_wavefront_file`, transform_apply(rotation=True)). The fit writes BODY-LOCAL
    # coordinates into the garment mesh; a garment object carrying the importer's 90-degree X rotation
    # renders those coords rotated (measured: garment on the floor with Y/Z swapped). apply_object_transforms
    # is the proven helper body_param_stage uses; this is a bake, not a hand-written matrix.
    apply_object_transforms(garment)
    garment.data.materials.clear()
    # Name matches the GARMENT_MATERIAL regex the evidence RED reads (makeclothes/shirt).
    garment.data.materials.append(
        make_material("mat_makeclothes_library_toigo_t_shirt", (0.30, 0.45, 0.62, 1.0))
    )
    mhclo = Mhclo()
    mhclo.load(str(garment_mhclo))
    try:
        mhclo.clothes = garment
    except Exception:
        pass
    garment_verts_before = len(garment.data.vertices)
    ClothesService.fit_clothes_to_human(garment, human, mhclo=mhclo, set_parent=True)
    bpy.context.view_layer.update()
    garment_verts_after = len(garment.data.vertices)
    garment_tris = sum(max(len(p.vertices) - 2, 0) for p in garment.data.polygons)
    # Bind the garment to the same armature so it deforms with the body (the proven
    # weight projection body_param_stage runs for the hm08 rail; not a rigid shell).
    weights = transfer_weights_body_to_garment(human, garment, armature)
    print(
        f"GARMENT_FIT {garment.name} verts {garment_verts_before} -> {garment_verts_after} "
        f"tris {garment_tris} weights {weights}"
    )

    # #323: body-part hiding under the fitted garment — wire the PROVEN tool from
    # the sibling rail (D1), do not write a second hider. The MPFB2 rail has NO
    # body-part hiding: the fitted t-shirt and the body it is fitted to both
    # render, and the body pokes through the cloth in large skin-coloured patches
    # across chest, abdomen, shoulders and collar (graded on #321's placement
    # fix). The library rail solves exactly this with
    # body_param_stage.apply_body_hide_material_region (body_param_stage.py:651)
    # — the §6s research answer: HIDE the body under the garment (alpha mask)
    # rather than push the cloth out. The mask is per-triangle from
    # garment_coverage.body_hide_mask (signed clearance < HIDE_EPSILON_M against
    # the BODY's outward normal — winding-proof, _orient_outward), and it paints
    # an alpha-0 material so the hidden faces never render; geometry, rig and
    # shape keys are untouched (only polygon material indices change). The glTF
    # exporter maps the constant alpha-0 Principled input to alphaMode=MASK /
    # alphaCutoff=0.5, so the faces are DISCARDED at render (measured on the
    # library rail's shipped bytes).
    #
    # ORDER IS LOAD-BEARING: the mask runs AFTER the fit + weight transfer so it
    # covers the FINAL garment footprint (the fit writes body-local coordinates
    # into the garment mesh, and the export reads material indices at export
    # time). It does NOT push the garment further out — #322 measured the raw
    # MakeClothes fit at median ~0.7 mm (half the surface coincident with the
    # skin) and the 1.5 cm shipping standoff already survives; hiding is the
    # other half of the fix and standoff alone did not stop the poke-through.
    #
    # #295 SCOPE: the mask is scoped away from the hands from the start via
    # body_param_stage.scope_hide_mask_away_from_hands — a body face whose
    # vertices are dominated by a hand/finger joint is a BARE hand (the garment
    # terminates at the wrist), and leaving it under the alpha-MASK would discard
    # it and show a stump where the sleeve was — the mitten defect on a second
    # rail.
    import sys as _sys4

    _stage_dir2 = (
        pathlib.Path(__file__).resolve().parents[4] / "tools/openclinxr/asset-pipeline/makeclothes"
    )
    if str(_stage_dir2) not in _sys4.path:
        _sys4.path.insert(0, str(_stage_dir2))
    from body_param_stage import (  # noqa: E402
        apply_body_hide_material_region,
        scope_hide_mask_away_from_hands,
        world_bounds,
    )
    from garment_coverage import HIDE_EPSILON_M, body_hide_mask  # noqa: E402

    def _triangulate_numpy(obj: bpy.types.Object):
        # Fan triangulation mirroring body_param_stage._numpy_mesh: the coverage
        # predicate assumes triangle faces, and MPFB bodies / OBJ imports are
        # quad/n-gon meshes (body 13,380 verts / 26,756 tris = 13,378 quads).
        # WORLD coordinates (matrix_world @ v.co) so the body and garment share
        # one frame regardless of object transforms — the same frame world_bounds
        # reports the band in. Feeding raw quads to the predicate garbles the
        # surface (issue-277, measured on the library gate's first run).
        mw = obj.matrix_world
        verts = np.array([tuple(mw @ v.co) for v in obj.data.vertices], dtype=float)
        faces: list[tuple[int, int, int]] = []
        for p in obj.data.polygons:
            iv = list(p.vertices)
            if len(iv) == 3:
                faces.append((int(iv[0]), int(iv[1]), int(iv[2])))
            else:
                # fan triangulation from vertex 0 — the SAME order
                # apply_body_hide_material_region consumes (polygon fan order),
                # so the per-triangle mask maps back to the right polygons.
                for i in range(1, len(iv) - 1):
                    faces.append((int(iv[0]), int(iv[i]), int(iv[i + 1])))
        return verts, np.array(faces, dtype=np.int64)

    body_verts, body_faces = _triangulate_numpy(human)
    garment_verts, garment_faces = _triangulate_numpy(garment)
    gb = world_bounds(garment)
    hide_info = body_hide_mask(
        body_verts,
        body_faces,
        garment_verts,
        garment_faces,
        float(gb["min"][2]),
        float(gb["max"][2]),
        hide_epsilon_m=HIDE_EPSILON_M,
        height_axis=2,
    )
    hide_mask = hide_info.pop("hideMask")
    if hide_info["hiddenFaceCount"] == 0:
        print(
            "BODY_HIDE WARNING: body_hide_mask found no poking body faces under the "
            "fitted garment — the #323 poke-through would not be fixed; report this"
        )
    # #295 — never discard a bare hand: scope the mask to the covered region.
    hide_mask, hand_faces_unhidden = scope_hide_mask_away_from_hands(human, hide_mask, armature)
    applied = apply_body_hide_material_region(human, hide_mask, slot="upper")
    print(
        f"BODY_HIDE {hide_info} "
        f"handFacesUnhidden {hand_faces_unhidden} "
        f"appliedPolygonCount {applied['appliedPolygonCount']} "
        f"hiddenMaterialName {applied['hiddenMaterialName']} "
        f"bodyBlenderVerts {len(human.data.vertices)} "
        f"garmentBlenderVerts {len(garment.data.vertices)}"
    )

    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 90
    action = bpy.data.actions.new("ClinicalIdleConversation")
    armature.animation_data_create()
    armature.animation_data.action = action

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    for frame, head_z, spine_x, arm_l_z, arm_r_z in [
        (1, 0.00, 0.00, 0.00, 0.00),
        (30, 0.05, 0.025, -0.10, 0.08),
        (60, -0.035, -0.015, 0.04, -0.06),
        (90, 0.00, 0.00, 0.00, 0.00),
    ]:
        bpy.context.scene.frame_set(frame)
        for bone_name, rotation in [
            ("head", (0.0, 0.0, head_z)),
            ("spine03", (spine_x, 0.0, 0.0)),
            ("upperarm01.L", (0.0, 0.0, arm_l_z)),
            ("upperarm01.R", (0.0, 0.0, arm_r_z)),
        ]:
            pose_bone = armature.pose.bones.get(bone_name)
            if pose_bone:
                pose_bone.rotation_mode = "XYZ"
                pose_bone.rotation_euler = rotation
                pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame)
    bpy.ops.object.mode_set(mode="OBJECT")

    if human.data.shape_keys:
        human.data.shape_keys.animation_data_create()
        human.data.shape_keys.animation_data.action = bpy.data.actions.new("ClinicalExpressionMicroTransition")
        key_blocks = list(human.data.shape_keys.key_blocks)[1:3]
        for frame, value in [(1, 0.0), (30, 0.15), (60, 0.05), (90, 0.0)]:
            bpy.context.scene.frame_set(frame)
            for key in key_blocks:
                key.value = value
                key.keyframe_insert(data_path="value", frame=frame)

    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", export_animations=True)
    print(f"EXPORTED {output}")


if __name__ == "__main__":
    main()
