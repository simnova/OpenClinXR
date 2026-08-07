#!/usr/bin/env python3
"""
#85 follow-up: re-export ed_chest_pain_adult_cast.glb with #67 self-standing bind.

Measured defect on the promoted cast (from _garment_cand adult_bod):
  - armature root rotation = identity (load guard passes)
  - pelvis rest = ~-90° X, T≈(0, 0.20, -0.82)  — Z-up bone rest
  - body mesh AABB height on Y (0..1.78)         — Y-up mesh
  - peds_nurse control: pelvis identity, T≈(0, 0.81, 0.19), mesh Y-up

That mesh/joint basis split is the #58/#67 class: three.js skins the figure off-axis
(diagonal float) while armature-root identity checks stay green.

Repair: import GLB → apply align_y_height_bind_for_gltf_yup_export → export_yup=False.
Does NOT scale or re-proportion mesh geometry.

Usage:
  blender --background --python tools/openclinxr/asset-pipeline/anny/repair_ed_adult_cast_bind.py -- \\
    --input apps/ui-xr/public/generated-humanoids/ed_chest_pain_adult_cast.glb \\
    --output apps/ui-xr/public/generated-humanoids/ed_chest_pain_adult_cast.glb
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

import bpy
from mathutils import Matrix


def _argv_after_double_dash() -> List[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images):
        for item in list(block):
            try:
                block.remove(item)
            except Exception:
                pass


def find_armature() -> "bpy.types.Object | None":
    preferred = "openclinxr_canonical_humanoid_armature"
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE" and obj.name == preferred:
            return obj
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            return obj
    return None


def align_y_height_bind_for_gltf_yup_export(arm_obj: "bpy.types.Object") -> Dict[str, Any]:
    """Same contract as automate_blender.align_y_height_bind_for_gltf_yup_export (#67)."""
    bones = list(arm_obj.data.bones)
    if not bones:
        return {"applied": False, "reason": "no_bones", "exportYup": True}

    ys = [float(b.head_local.y) for b in bones]
    zs = [float(b.head_local.z) for b in bones]
    y_span = max(ys) - min(ys)
    z_span = max(zs) - min(zs)

    # Ensure armature object is identity — never leave a leftover root quaternion.
    arm_obj.rotation_mode = "XYZ"
    arm_obj.rotation_euler = (0.0, 0.0, 0.0)
    try:
        arm_obj.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
    except Exception:
        pass

    # Mesh children: identity local under armature.
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        skinned = any(
            getattr(m, "type", None) == "ARMATURE" and getattr(m, "object", None) == arm_obj
            for m in obj.modifiers
        )
        if obj.parent == arm_obj or skinned:
            # Keep world transform while reparenting under armature with identity local.
            mw = obj.matrix_world.copy()
            obj.parent = arm_obj
            obj.matrix_parent_inverse = Matrix.Identity(4)
            obj.matrix_world = mw
            # Force identity local after bake into mesh data when mesh is already Y-height.
            bpy.context.view_layer.update()

    bpy.context.view_layer.update()

    # Prefer export_yup=False when bones (or meshes) are Y-primary — matches working peds export.
    mesh_y_primary = False
    for obj in bpy.data.objects:
        if obj.type != "MESH" or not obj.data or not obj.data.vertices:
            continue
        ys_m = [float(v.co.y) for v in obj.data.vertices]
        zs_m = [float(v.co.z) for v in obj.data.vertices]
        if max(ys_m) - min(ys_m) > (max(zs_m) - min(zs_m)) * 1.1:
            mesh_y_primary = True
            break

    export_yup = not (y_span > z_span * 1.1 or mesh_y_primary)
    # #67 working path for Y-height Anny content: export_yup=False always when mesh is Y-primary.
    if mesh_y_primary:
        export_yup = False

    print(
        f"[repair] bind align: ySpan={y_span:.4f} zSpan={z_span:.4f} "
        f"meshYPrimary={mesh_y_primary} export_yup={export_yup}"
    )
    return {
        "applied": True,
        "method": "identity_object_export_yup_false_y_height_self_standing",
        "exportYup": export_yup,
        "ySpan": round(y_span, 6),
        "zSpan": round(z_span, 6),
        "meshYPrimary": mesh_y_primary,
    }


def apply_rest_pose_as_rest(arm_obj: "bpy.types.Object") -> None:
    """Bake current pose into rest so residual object/bone rotations don't reappear."""
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.select_set(True)
    try:
        bpy.ops.object.mode_set(mode="POSE")
        bpy.ops.pose.select_all(action="SELECT")
        bpy.ops.pose.armature_apply(selected=False)
        bpy.ops.object.mode_set(mode="OBJECT")
    except Exception as exc:
        print(f"[repair] pose apply skipped: {exc}")
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:
            pass


def reparent_meshes_as_armature_siblings(arm_obj: "bpy.types.Object") -> int:
    """
    Peds working assets parent gown/hair/body as direct children of the armature.
    The broken adult cast nested gown+hair under the body mesh node; reparent to
    armature so skinning matches the working hierarchy (no geometry scale).
    """
    moved = 0
    for obj in list(bpy.data.objects):
        if obj.type != "MESH":
            continue
        if obj.parent is None:
            continue
        if obj.parent == arm_obj:
            continue
        # Nested under another mesh or helper — lift to armature.
        mw = obj.matrix_world.copy()
        obj.parent = arm_obj
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_world = mw
        moved += 1
    bpy.context.view_layer.update()
    return moved


def export_glb(path: str, export_yup: bool) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=export_yup,
        export_animations=True,
        export_nla_strips=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texture_dir="",
    )
    print(f"[repair] exported {path} export_yup={export_yup}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", default="")
    args = parser.parse_args(_argv_after_double_dash())

    inp = Path(args.input).resolve()
    out = Path(args.output).resolve()
    if not inp.is_file():
        print(f"[repair] missing input: {inp}", file=sys.stderr)
        return 2

    clear_scene()
    print(f"[repair] import {inp}")
    bpy.ops.import_scene.gltf(filepath=str(inp))
    bpy.context.view_layer.update()

    arm = find_armature()
    if arm is None:
        print("[repair] no armature found", file=sys.stderr)
        return 3

    moved = reparent_meshes_as_armature_siblings(arm)
    print(f"[repair] reparented nested meshes to armature: {moved}")

    # Clear pose to rest before align.
    bpy.context.view_layer.objects.active = arm
    try:
        bpy.ops.object.mode_set(mode="POSE")
        bpy.ops.pose.select_all(action="SELECT")
        bpy.ops.pose.transforms_clear()
        bpy.ops.object.mode_set(mode="OBJECT")
    except Exception as exc:
        print(f"[repair] pose clear skipped: {exc}")

    align = align_y_height_bind_for_gltf_yup_export(arm)
    export_yup = bool(align.get("exportYup", False))

    # If bones are still Z-primary after import, rotate rest data into Y-up once.
    bones = list(arm.data.bones)
    ys = [float(b.head_local.y) for b in bones]
    zs = [float(b.head_local.z) for b in bones]
    y_span = max(ys) - min(ys) if bones else 0.0
    z_span = max(zs) - min(zs) if bones else 0.0
    if z_span > y_span * 1.1:
        print(f"[repair] bones Z-primary (y={y_span:.3f} z={z_span:.3f}) — apply +90° X to rest data then export_yup=False")
        # Edit-mode rotate all bones +90° about armature X so height is on Y.
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.mode_set(mode="EDIT")
        rot = Matrix.Rotation(1.5707963267948966, 4, "X")  # +90° X
        for eb in arm.data.edit_bones:
            eb.transform(rot)
        bpy.ops.object.mode_set(mode="OBJECT")
        # Also rotate mesh vertex data the same way so mesh stays bound.
        for obj in bpy.data.objects:
            if obj.type != "MESH":
                continue
            me = obj.data
            me.transform(rot)
            me.update()
        bpy.context.view_layer.update()
        export_yup = False
        align["boneRestRotatedX90"] = True
        align["exportYup"] = False

    apply_rest_pose_as_rest(arm)
    align2 = align_y_height_bind_for_gltf_yup_export(arm)
    export_yup = bool(align2.get("exportYup", export_yup))

    export_glb(str(out), export_yup=export_yup)

    report = {
        "ok": True,
        "input": str(inp),
        "output": str(out),
        "align": align,
        "alignAfterBoneFix": align2,
        "nestedMeshesReparented": moved,
        "exportYup": export_yup,
        "claimScope": "bind_pose_repair_export_only_not_geometry_scale_or_visual_realism",
        "notEvidenceFor": [
            "production_asset_readiness",
            "b_plus_visual_realism_gate",
            "clinical_validity",
            "scoring_validity",
        ],
    }
    if args.report:
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"[repair] wrote report {args.report}")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
