#!/usr/bin/env python3
"""#330 — embed a fitted CC0 MakeClothes hair `.mhclo` into body-param library GLBs.

#222/#279 shipped a PAINTED scalp-hair REGION — a texture on the head, not hair. The
garments took the painted-shell -> fitted-`.mhclo` upgrade this cycle (#321/#322/#324);
hair never did, while 25 real MakeHuman hairstyles sat staged in the provider cache.
This stage is the hair channel of that same upgrade: it fits a staged CC0/CC-BY
`.mhclo` hair through the SAME `ClothesService.fit_clothes_to_human` the upper
(#322 toigo t-shirt), lower (#220 cargo pants) and footwear (#324) channels use (D1 —
wire the proven path, do not write a second fitter).

The licence is recorded from the hair's OWN `.mhclo` header (passed in by the CLI,
which reads it with the hair licence classifier). A generated hair shell has no
header to cite — clause (2) of the contract refuses that.

Why the fit runs against a reconstructed reference rather than the shipped GLB body:
the GLB body is re-imported from a material-split glTF export, so its vertex indexing
does not match the `.mhclo` body-vertex references (measured: the re-import merges the
primitives into 53,672 verts vs 13,380 in the source basemesh — a fit by index would
read the wrong vertices). The reference is the same MPFB `base.obj` the body_param
stage consumes, with the body class's phenotype macros re-applied as live shape keys.
The fitted hair is then placed onto the GLB body by body-bounds alignment (the
reference and GLB body are the same macro shape at 0.1 scale) and weighted to the
head bone.

claimScope: fitted library hair on body-param library GLBs, weighted to the head,
  licence recorded from the hair's own .mhclo header.
notEvidenceFor: hair on the MPFB2 materializer rail (aisha), clinical hairstyle
  realism, production readiness, quest readiness, that the hair sits flush on the
  scalp rather than intersecting it (placement is diagnosed, pixel-graded separately).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import bpy
from mathutils import Vector

# MPFB base units are decimetres; the shipped GLBs are in metres.
MH_UNITS_TO_METRES = 0.1


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    p = argparse.ArgumentParser(description="#330 embed fitted library hair into library GLB")
    p.add_argument("--glb", required=True, help="Input library GLB path")
    p.add_argument("--out", required=True, help="Output GLB path (may overwrite input)")
    p.add_argument(
        "--role",
        default="family",
        help="Actor role for hair colour (patient/family -> dark, nurse/clinical -> conservative)",
    )
    p.add_argument("--report", default="", help="Optional JSON report path")
    p.add_argument("--mh-base-obj", required=True, help="MPFB data/3dobjs/base.obj (hm08)")
    p.add_argument(
        "--phenotype-json",
        required=True,
        help='Body-class phenotype for the fit reference macros, e.g. {"weight":0.18,...}',
    )
    p.add_argument("--hair-mhclo", required=True, help="Staged hair .mhclo (provider cache)")
    p.add_argument("--hair-obj", required=True, help="Staged hair .obj companion")
    p.add_argument("--hair-style", required=True, help="Style id used in mesh/material names")
    p.add_argument("--body-class", default="adult_lean_female", help="Body class id for mesh naming")
    p.add_argument("--hair-license-token", default="", help="Licence token from the hair .mhclo header")
    p.add_argument(
        "--hair-license-source",
        default="",
        help="Licence source string (mhclo_header:...; license=...) from the classifier",
    )
    return p.parse_args(args)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def enable_mpfb() -> bool:
    try:
        bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
        return "bl_ext.user_default.mpfb" in bpy.context.preferences.addons
    except Exception:
        return False


def import_glb(path: str) -> None:
    bpy.ops.import_scene.gltf(filepath=path)


def import_obj(path: str, name: str) -> bpy.types.Object:
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path)
    created = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not created:
        raise RuntimeError(f"OBJ import produced no mesh: {path}")
    obj = created[0]
    obj.name = name
    return obj


def find_body_and_armature() -> Tuple[bpy.types.Object, Optional[bpy.types.Object]]:
    body = None
    arm = None
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            arm = obj
        if obj.type == "MESH":
            name = (obj.name or "").lower()
            if any(k in name for k in ("footwear", "shoe", "slipper", "garment", "scrub", "makeclothes")):
                continue
            if "hair" in name:
                continue
            if body is None or "basemesh" in name or "hm08" in name or "body" in name:
                if body is None or "basemesh" in name or "hm08" in name:
                    body = obj
    if body is None:
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        if not meshes:
            raise RuntimeError("no mesh in imported GLB")
        body = max(meshes, key=lambda m: len(m.data.vertices))
    return body, arm


def create_material(name: str, color: Tuple[float, float, float, float]) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.9
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    mat.diffuse_color = color
    try:
        mat.viewport_display.color = color[:3]
    except Exception:
        pass
    return mat


def hair_color(actor_role: str) -> Tuple[float, float, float, float]:
    """Conservative dark-to-mid hair for a clinical station (never a literal palette gate)."""
    role = (actor_role or "").lower()
    if "child" in role or "peds" in role:
        return (0.22, 0.14, 0.10, 1.0)
    if any(k in role for k in ("parent", "family", "guardian", "spouse")):
        return (0.16, 0.11, 0.09, 1.0)  # dark brown — the dominant natural shade
    if "patient" in role:
        return (0.13, 0.09, 0.07, 1.0)  # near-black
    return (0.18, 0.13, 0.10, 1.0)  # nurse / default — mid-dark brown


def apply_phenotype_macros(reference: bpy.types.Object, phenotype: dict) -> None:
    """#324/#330 — re-apply the body class's phenotype macros to the fit reference.

    Mirrors `apply_macros` in body_param_stage.py exactly (same TargetService path,
    macros as LIVE shape keys) so the hair fit reads the same from-mix head shape the
    stage's garment fits read. The GLB body carries these macros baked, so the fitted
    hair matches the shipped head rather than the neutral basemesh.
    """
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    from bl_ext.user_default.mpfb.entities.objectproperties import HumanObjectProperties

    macro = TargetService.get_default_macro_info_dict()
    for key in ("gender", "age", "muscle", "weight", "proportions", "height", "cupsize", "firmness"):
        if key in phenotype:
            macro[key] = float(phenotype[key])
    if isinstance(phenotype.get("race"), dict):
        macro["race"].update({k: float(v) for k, v in phenotype["race"].items()})

    for key in macro:
        if key != "race":
            HumanObjectProperties.set_value(key, macro[key], entity_reference=reference)
    for key, val in macro["race"].items():
        HumanObjectProperties.set_value(key, val, entity_reference=reference)

    TargetService.reapply_macro_details(reference, remove_zero_weight_targets=False)
    bpy.context.view_layer.update()


def apply_object_transforms(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.update()


def force_z_up_standing(obj: bpy.types.Object) -> None:
    """Make the reference basemesh Z-up standing with its sole at z=0.

    Mirrors `force_z_up_standing` in fit_stage.py / embed_library_footwear.py:
    `wm.obj_import` keeps the MakeHuman OBJ Y-up; the `.mhclo` offset scales assume a
    Z-up body, so the reference is rotated Z-up BEFORE the fit (measured on #324's
    first bake: fitting a Y-up reference inflated the shoe ~4.4x).
    """
    apply_object_transforms(obj)
    b = {a: (min(getattr(v.co, a) for v in obj.data.vertices), max(getattr(v.co, a) for v in obj.data.vertices)) for a in "xyz"}
    size = [b[a][1] - b[a][0] for a in "xyz"]
    axis = max(range(3), key=lambda i: size[i])
    if axis == 1:
        obj.rotation_euler[0] = math.radians(90.0)
    elif axis == 0:
        obj.rotation_euler[1] = math.radians(-90.0)
    bpy.context.view_layer.update()
    apply_object_transforms(obj)
    b2 = {a: (min(getattr(v.co, a) for v in obj.data.vertices), max(getattr(v.co, a) for v in obj.data.vertices)) for a in "xyz"}
    if abs(b2["z"][0]) > abs(b2["z"][1]) and b2["z"][0] < -0.1:
        obj.rotation_euler[0] = math.radians(180.0)
        bpy.context.view_layer.update()
        apply_object_transforms(obj)
    obj.location.z -= min(v.co.z for v in obj.data.vertices)
    bpy.context.view_layer.update()
    apply_object_transforms(obj)


def build_fit_reference(mh_base_obj: str, phenotype: dict) -> bpy.types.Object:
    """hm08 basemesh with the class macros applied — the fit target (intact vertex order)."""
    from bl_ext.user_default.mpfb.entities.objectproperties import GeneralObjectProperties

    ref = import_obj(mh_base_obj, "openclinxr_hair_fit_reference")
    force_z_up_standing(ref)
    GeneralObjectProperties.set_value("object_type", "Basemesh", entity_reference=ref)
    apply_phenotype_macros(ref, phenotype)
    return ref


def fit_hair(
    hair_mhclo: str,
    hair_obj: str,
    reference: bpy.types.Object,
    mesh_name: str,
) -> Tuple[bpy.types.Object, float]:
    """#330 — the SAME ClothesService.fit_clothes_to_human path the garments use."""
    from bl_ext.user_default.mpfb.services.clothesservice import ClothesService
    from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo

    hair = import_obj(hair_obj, mesh_name)
    # #321 handback (measured again on #330's first bake): bake the OBJ importer's
    # axis rotation into the MESH DATA so the hair object is identity/Z-up before the
    # fit. The fit writes BODY-LOCAL coordinates into the hair mesh; an object
    # carrying the importer's 90-degree X rotation renders those coords rotated
    # (measured: the exported hair landed at torso height, glTF y 0.73-0.94, instead
    # of on the head at 1.42-1.73). Same bake MPFB's body loader performs
    # (ObjectService.load_wavefront_file, transform_apply(rotation=True)) and the
    # same one the #321/#326 materializer applies to its garment before fitting.
    apply_object_transforms(hair)
    # The exported glTF mesh name comes from the MESH DATA name, not the object name —
    # the contract's clause (1) matches /hair/i on the MESH name.
    hair.data.name = mesh_name
    mhclo = Mhclo()
    mhclo.load(hair_mhclo)
    try:
        mhclo.clothes = hair
    except Exception:
        pass
    t_fit = time.perf_counter()
    ClothesService.fit_clothes_to_human(hair, reference, mhclo=mhclo, set_parent=False)
    fit_s = time.perf_counter() - t_fit
    bpy.context.view_layer.update()
    return hair, fit_s


def mesh_bounds(obj: bpy.types.Object) -> Dict[str, Any]:
    """WORLD-space bounds — `matrix_world` applied.

    The #321/#330 failure class is treating an object's LOCAL coords as world coords:
    the GLB body's local frame can differ from the Blender scene frame (a rotation on
    the object), so any landmark alignment must run in world space. The hair object is
    baked to identity before placement (local == world for it), so translating its
    local vertices by a world-space delta is exact.
    """
    mw = obj.matrix_world
    xs = [(mw @ v.co).x for v in obj.data.vertices]
    ys = [(mw @ v.co).y for v in obj.data.vertices]
    zs = [(mw @ v.co).z for v in obj.data.vertices]
    return {
        "min": [min(xs), min(ys), min(zs)],
        "max": [max(xs), max(ys), max(zs)],
        "size": [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)],
        "centre": [0.5 * (min(xs) + max(xs)), 0.5 * (min(ys) + max(ys)), 0.5 * (min(zs) + max(zs))],
        "vertexCount": len(obj.data.vertices),
    }


def head_joint_dominant_verts(
    obj: bpy.types.Object,
    arm: bpy.types.Object,
) -> List[bpy.types.MeshVertex]:
    """Body vertices whose dominant bone is a head/neck bone (#330 placement anchor).

    Same vocabulary the footwear channel uses for the foot extent: dominant = the
    bone-named vertex group with the highest weight (the mixamo_unity rig's
    `mixamorig:Head` / `mixamorig:Neck`). Used for placement DIAGNOSTICS only — the
    primary placement is body-bounds alignment, and this block verifies the hair
    actually overlaps the head it is supposed to sit on.
    """
    bone_names = {b.name for b in arm.data.bones}
    head_bones = {n for n in bone_names if n.lower() in ("mixamorig:head", "mixamorig:neck") or n.lower().endswith("head")}
    if not head_bones:
        raise RuntimeError("#330 hair: no head/neck bones on the armature")
    group_names = {g.index: g.name for g in obj.vertex_groups}
    out: List[bpy.types.MeshVertex] = []
    for v in obj.data.vertices:
        best_w = 0.0
        best_name = None
        for ge in v.groups:
            name = group_names.get(ge.group)
            if name in head_bones and ge.weight > best_w:
                best_w = ge.weight
                best_name = name
        if best_name is not None:
            out.append(v)
    if len(out) < 100:
        raise RuntimeError(f"#330 hair: too few head-joint-dominant body verts ({len(out)})")
    return out


def place_hair_on_body(
    hair: bpy.types.Object,
    reference: bpy.types.Object,
    body: bpy.types.Object,
    arm: bpy.types.Object,
) -> dict:
    """Scale the fitted hair from MH units into the GLB body frame.

    The fit placed the hair in the reference basemesh's local frame (dm, Z-up, sole
    near z=0). The GLB body is the SAME macro shape at metres scale — the reference
    and the body share base.obj topology and the same phenotype macros (the #324
    fit-reconstruction that already works for footwear), so the hair is transferred by
    BODY-BOUNDS alignment: scale 0.1, then translate the reference frame onto the GLB
    body frame (centre X/Y, sole Z). Head-joint-dominant vertices are measured for
    verification and recorded in the placement diagnostics — the pixel grader is the
    authority on whether the hair sits on the scalp, not this alignment.
    """
    for v in hair.data.vertices:
        v.co *= MH_UNITS_TO_METRES
    bpy.context.view_layer.update()

    ref_b = mesh_bounds(reference)
    glb_b = mesh_bounds(body)
    # The hair vertices are scaled by MH_UNITS_TO_METRES (0.1) above; the reference
    # bounds must be scaled the same way or the delta carries the reference's raw dm
    # coordinates (measured: hair landed ~1 m off the head's depth on the first pass).
    delta = Vector(
        (
            glb_b["centre"][0] - MH_UNITS_TO_METRES * ref_b["centre"][0],
            glb_b["centre"][1] - MH_UNITS_TO_METRES * ref_b["centre"][1],
            glb_b["min"][2] - MH_UNITS_TO_METRES * ref_b["min"][2],
        )
    )
    for v in hair.data.vertices:
        v.co += delta
    # The shipped GLB body is NOT exactly the scaled reference: the Anny stature
    # align scaled it to a different total height (measured: glb 1.7325 m vs
    # 0.1*ref 1.6945 m — 2.24%). The head sits at the TOP of the body, so the hair
    # must be stretched about the sole by the same ratio or it lands low on the
    # taller shipped head. This is the uniform height ratio, never a fitted number.
    ref_scaled_height = MH_UNITS_TO_METRES * ref_b["size"][2]
    glb_height = glb_b["size"][2]
    if ref_scaled_height > 1e-6 and abs(glb_height - ref_scaled_height) > 1e-4:
        vert_scale = glb_height / ref_scaled_height
        for v in hair.data.vertices:
            v.co.z = (v.co.z - glb_b["min"][2]) * vert_scale + glb_b["min"][2]
        bpy.context.view_layer.update()
        heightRatio = round(vert_scale, 6)
    else:
        heightRatio = 1.0
    bpy.context.view_layer.update()

    head_verts = head_joint_dominant_verts(body, arm)
    mw = body.matrix_world
    head_world_z = [(mw @ v.co).z for v in head_verts]
    head_min_z = min(head_world_z)
    head_max_z = max(head_world_z)
    head_cx = sum((mw @ v.co).x for v in head_verts) / len(head_verts)
    head_cy = sum((mw @ v.co).y for v in head_verts) / len(head_verts)
    hair_b = mesh_bounds(hair)
    overlap = not (hair_b["max"][2] < head_min_z or hair_b["min"][2] > head_max_z)
    gap = head_min_z - hair_b["max"][2] if hair_b["max"][2] < head_min_z else 0.0

    return {
        "anchor": "world_body_bounds_alignment_scale_0.1_with_stature_ratio",
        "placementDeltaM": [round(delta.x, 6), round(delta.y, 6), round(delta.z, 6)],
        "statureHeightRatio": heightRatio,
        "referenceBounds": {k: [round(x, 5) for x in ref_b[k]] if isinstance(ref_b[k], list) else ref_b[k] for k in ("min", "max", "size")},
        "glbBodyBounds": {k: [round(x, 5) for x in glb_b[k]] if isinstance(glb_b[k], list) else glb_b[k] for k in ("min", "max", "size")},
        "hairBoundsAfterPlacement": {k: [round(x, 5) for x in hair_b[k]] if isinstance(hair_b[k], list) else hair_b[k] for k in ("min", "max", "size")},
        "headJointVerts": {
            "count": len(head_verts),
            "minZ": round(head_min_z, 5),
            "maxZ": round(head_max_z, 5),
            "centreX": round(head_cx, 5),
            "centreY": round(head_cy, 5),
        },
        "headOverlap": {
            "overlaps": overlap,
            "gapAboveHeadM": round(gap, 5),
        },
    }


def weight_hair_to_head(obj: bpy.types.Object, arm: bpy.types.Object) -> str:
    """Weight the hair 100% to the head bone + armature modifier (skinned, not rigid).

    The exported GLB therefore carries JOINTS_0/WEIGHTS_0 on the hair primitive — the
    contract's "skinned, not a rigid prop" clause reads exactly that.
    """
    bone_names = [b.name for b in arm.data.bones]
    candidates = ["mixamorig:Head", "Head", "head"]
    bone = next((b for b in candidates if b in bone_names), None)
    if bone is None:
        raise RuntimeError(f"#330 hair: armature missing head bone (have {bone_names[:12]}…)")
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    mod = obj.modifiers.new("openclinxr_hair_armature", "ARMATURE")
    mod.object = arm
    mod.use_vertex_groups = True
    mod.use_bone_envelopes = False
    obj.parent = arm
    obj.matrix_parent_inverse = arm.matrix_world.inverted()
    return bone


def export_glb(path: str) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.data.objects:
        if obj.type in ("MESH", "ARMATURE"):
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        use_selection=True,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_materials="EXPORT",
        export_skins=True,
        export_animations=False,
        # #226: preserve face morph targets when re-exporting after the hair embed.
        export_morph=True,
    )


def main() -> None:
    args = parse_args()
    glb = Path(args.glb).resolve()
    out = Path(args.out).resolve()
    if not glb.is_file():
        raise SystemExit(f"missing glb: {glb}")

    if not enable_mpfb():
        raise SystemExit("#330 hair: MPFB addon failed to load — ClothesService unavailable")

    clear_scene()
    import_glb(str(glb))
    body, arm = find_body_and_armature()
    print(f"[blender] #330 hair body={body.name} arm={arm.name if arm else None} role={args.role}")
    if arm is None:
        raise RuntimeError("#330 hair: no armature in GLB")

    # Strip any prior fitted hair meshes so re-bake is idempotent.
    for obj in list(bpy.data.objects):
        n = (obj.name or "").lower()
        if obj.type == "MESH" and "hair" in n and "scalp" not in n:
            bpy.data.objects.remove(obj, do_unlink=True)

    try:
        phenotype = json.loads(args.phenotype_json)
    except Exception as exc:
        raise SystemExit(f"#330 hair: bad --phenotype-json: {exc}") from exc

    reference = build_fit_reference(args.mh_base_obj, phenotype)
    mesh_name = f"makeclothes_library_hair_{args.hair_style}_{args.body_class}_mesh"
    hair, fit_s = fit_hair(args.hair_mhclo, args.hair_obj, reference, mesh_name)
    placement = place_hair_on_body(hair, reference, body, arm)
    bpy.data.objects.remove(reference, do_unlink=True)

    mat = create_material(
        f"openclinxr_fitted_hair_{args.hair_style}_{args.body_class}_mat",
        hair_color(args.role),
    )
    hair.data.materials.append(mat)
    bone = weight_hair_to_head(hair, arm)
    for poly in hair.data.polygons:
        poly.use_smooth = True

    hair_b = mesh_bounds(hair)
    meta = {
        "mode": "makeclothes_library_hair_fit_via_clothesservice_v1",
        "revision": "issue_330_fitted_cc0_mhclo_not_painted_region",
        "hairId": f"{args.hair_style}_hm08",
        "style": args.hair_style,
        "licenseToken": args.hair_license_token,
        "licenseSource": args.hair_license_source,
        "clothesServiceApi": "ClothesService.fit_clothes_to_human",
        "fitWallClockS": round(fit_s, 4),
        "fittedAgainst": "mpfb_base_obj_with_body_class_phenotype_macros",
        "meshName": mesh_name,
        "objectName": hair.name,
        "materialName": hair.data.materials[0].name if hair.data.materials else None,
        "weightedBone": bone,
        "faceCount": len(hair.data.polygons),
        "vertexCount": hair_b["vertexCount"],
        "triangleEstimate": sum(len(p.vertices) - 2 for p in hair.data.polygons),
        "minZ": round(hair_b["min"][2], 6),
        "maxZ": round(hair_b["max"][2], 6),
        "placement": placement,
        "role": (args.role or "").lower(),
        "makeclothesHairSearch": "makehuman-hair01_cc0_ccby_subset_zero_helper_refs",
        "claimScope": "fitted_library_hair_on_library_body_param_glb_with_mhclo_header_licence",
        "notEvidenceFor": [
            "mpfb2_materializer_rail_hair",
            "clinical_hairstyle_realism",
            "production_asset_readiness",
            "quest_readiness",
            "scalp_flush_placement",
        ],
    }

    out.parent.mkdir(parents=True, exist_ok=True)
    export_glb(str(out))
    print(f"[blender] #330 wrote {out} faces={meta['faceCount']} bone={bone}")

    if args.report:
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(
                {
                    "schemaVersion": "openclinxr.library-hair-embed.v1",
                    "input": str(glb),
                    "output": str(out),
                    "role": args.role,
                    "hairRegion": meta,
                },
                indent=2,
            )
            + "\n"
        )
        print(f"[blender] #330 report {report_path}")


if __name__ == "__main__":
    main()
