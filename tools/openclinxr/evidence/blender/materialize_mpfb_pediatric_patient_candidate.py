"""Materialize a local MPFB/MakeHuman pediatric patient comparator GLB (cagematch only)."""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from datetime import datetime, timezone

import bpy


def make_material(name: str, color: tuple[float, float, float, float]):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes["Principled BSDF"]
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = 0.78
    return material


def count_skinned_meshes() -> int:
    count = 0
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and any(mod.type == "ARMATURE" for mod in obj.modifiers):
            count += 1
    return count


def bone_weight_coverage(mesh_obj: bpy.types.Object, armature_obj: bpy.types.Object) -> dict:
    bone_names = [bone.name for bone in armature_obj.data.bones]
    weighted_by_bone = {name: 0 for name in bone_names}
    dominant_by_bone = {name: 0 for name in bone_names}
    group_names = {group.index: group.name for group in mesh_obj.vertex_groups}
    unweighted = 0
    for vertex in mesh_obj.data.vertices:
        weights = {
            group_names.get(weight.group, f"group_{weight.group}"): float(weight.weight)
            for weight in vertex.groups
            if float(weight.weight) > 0.001
        }
        if not weights:
            unweighted += 1
            continue
        dominant_name = max(weights.items(), key=lambda item: item[1])[0]
        if dominant_name in dominant_by_bone:
            dominant_by_bone[dominant_name] += 1
        for bone_name in weights:
            if bone_name in weighted_by_bone:
                weighted_by_bone[bone_name] += 1
    return {
        "boneNames": bone_names,
        "boneCount": len(bone_names),
        "vertexCount": len(mesh_obj.data.vertices),
        "weightedVertexCount": len(mesh_obj.data.vertices) - unweighted,
        "unweightedVertexCount": unweighted,
        "weightedVertexCountsByBone": weighted_by_bone,
        "dominantVertexCountsByBone": dominant_by_bone,
    }


def add_mpfb_body_motion_probe(armature_obj: bpy.types.Object) -> str:
    clip_name = "openclinxr_mpfb_body_motion_probe_pediatric_breathing"
    bpy.context.view_layer.objects.active = armature_obj
    bpy.ops.object.mode_set(mode="POSE")
    armature_obj.animation_data_create()
    action = bpy.data.actions.new(clip_name)
    armature_obj.animation_data.action = action

    def pose(frame: int, rotations: dict[str, tuple[float, float, float]]) -> None:
        bpy.context.scene.frame_set(frame)
        for bone_name, rotation in rotations.items():
            bone = armature_obj.pose.bones.get(bone_name)
            if not bone:
                continue
            bone.rotation_mode = "XYZ"
            bone.rotation_euler = rotation
            bone.keyframe_insert("rotation_euler", frame=frame)

    pose(1, {
        "spine01": (0.0, 0.0, 0.0),
        "spine02": (0.0, 0.0, 0.0),
        "neck01": (0.0, 0.0, 0.0),
        "upperarm01.L": (0.0, 0.0, -0.04),
        "upperarm01.R": (0.0, 0.0, 0.04),
        "lowerarm01.L": (0.0, 0.0, -0.02),
        "lowerarm01.R": (0.0, 0.0, 0.02),
        "upperleg01.L": (0.0, 0.0, 0.0),
        "upperleg01.R": (0.0, 0.0, 0.0),
        "lowerleg01.L": (0.0, 0.0, 0.0),
        "lowerleg01.R": (0.0, 0.0, 0.0),
        "foot.L": (0.0, 0.0, 0.0),
        "foot.R": (0.0, 0.0, 0.0),
    })
    pose(24, {
        "spine01": (0.035, 0.0, 0.0),
        "spine02": (0.050, 0.0, 0.0),
        "neck01": (-0.020, 0.0, 0.0),
        "upperarm01.L": (0.08, 0.0, -0.08),
        "upperarm01.R": (0.08, 0.0, 0.08),
        "lowerarm01.L": (0.035, 0.0, -0.04),
        "lowerarm01.R": (0.035, 0.0, 0.04),
        "upperleg01.L": (0.026, 0.0, -0.010),
        "upperleg01.R": (-0.018, 0.0, 0.010),
        "lowerleg01.L": (-0.020, 0.0, 0.0),
        "lowerleg01.R": (0.012, 0.0, 0.0),
        "foot.L": (0.010, 0.0, -0.006),
        "foot.R": (-0.006, 0.0, 0.006),
    })
    pose(48, {
        "spine01": (-0.004, 0.0, 0.0),
        "spine02": (-0.006, 0.0, 0.0),
        "neck01": (0.010, 0.0, 0.0),
        "upperarm01.L": (0.02, 0.0, -0.03),
        "upperarm01.R": (0.02, 0.0, 0.03),
        "lowerarm01.L": (0.01, 0.0, -0.01),
        "lowerarm01.R": (0.01, 0.0, 0.01),
        "upperleg01.L": (-0.012, 0.0, 0.006),
        "upperleg01.R": (0.018, 0.0, -0.006),
        "lowerleg01.L": (0.010, 0.0, 0.0),
        "lowerleg01.R": (-0.014, 0.0, 0.0),
        "foot.L": (-0.006, 0.0, 0.004),
        "foot.R": (0.006, 0.0, -0.004),
    })
    pose(72, {
        "spine01": (0.0, 0.0, 0.0),
        "spine02": (0.0, 0.0, 0.0),
        "neck01": (0.0, 0.0, 0.0),
        "upperarm01.L": (0.0, 0.0, -0.04),
        "upperarm01.R": (0.0, 0.0, 0.04),
        "lowerarm01.L": (0.0, 0.0, -0.02),
        "lowerarm01.R": (0.0, 0.0, 0.02),
        "upperleg01.L": (0.0, 0.0, 0.0),
        "upperleg01.R": (0.0, 0.0, 0.0),
        "lowerleg01.L": (0.0, 0.0, 0.0),
        "lowerleg01.R": (0.0, 0.0, 0.0),
        "foot.L": (0.0, 0.0, 0.0),
        "foot.R": (0.0, 0.0, 0.0),
    })
    track = armature_obj.animation_data.nla_tracks.new()
    track.name = clip_name
    track.strips.new(clip_name, 1, action)
    bpy.ops.object.mode_set(mode="OBJECT")
    return clip_name


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="MPFB pediatric patient cagematch comparator.")
    parser.add_argument("--output-glb", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--child-scale", type=float, default=0.62)
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.mpfb.create_human()

    human = bpy.data.objects["Human"]
    human.name = "mpfb_peds_patient_child_body_mesh"
    human.data.name = "mpfb_peds_patient_child_body"
    human.scale = (args.child_scale, args.child_scale, args.child_scale)
    bpy.ops.object.transform_apply(scale=True)
    human.data.materials.clear()
    human.data.materials.append(make_material("mpfb_peds_child_skin", (0.78, 0.62, 0.52, 1.0)))

    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = human
    human.select_set(True)
    bpy.ops.mpfb.add_standard_rig()
    bpy.ops.mpfb.load_face_shape_keys()

    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if armature is None:
        raise RuntimeError("MPFB standard rig was not created")
    armature.name = "mpfb_peds_patient_child_standard_rig"
    body_motion_clip = add_mpfb_body_motion_probe(armature)

    output_glb = pathlib.Path(args.output_glb)
    output_glb.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output_glb),
        export_format="GLB",
        export_animations=True,
        export_nla_strips=True,
    )

    morph_count = max(0, len(human.data.shape_keys.key_blocks) - 1) if human.data.shape_keys else 0
    body_rig = bone_weight_coverage(human, armature)
    report = {
        "schemaVersion": "openclinxr.mpfb-pediatric-patient-cagematch.v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "claimScope": "local_mpfb_makehuman_pediatric_comparator_not_runtime_promotion",
        "outputGlbPath": str(output_glb),
        "childScaleApplied": args.child_scale,
        "mpfb2": {
            "module": "bl_ext.user_default.mpfb",
            "standardRigCreated": armature is not None,
            "faceShapeKeyCount": morph_count,
        },
        "bodyRigDiagnostics": {
            "schemaVersion": "openclinxr.mpfb-body-rig-diagnostics.v1",
            "standardRigCreated": True,
            "skinnedMeshCount": count_skinned_meshes(),
            "bodyMotionProbeClipName": body_motion_clip,
            **body_rig,
            "claimScope": "mpfb_standard_rig_body_motion_probe_not_readiness_or_quality_grade",
            "notEvidenceFor": [
                "motion_capture_quality",
                "speech2motion_quality",
                "b_plus_visual_realism_gate",
                "production_asset_readiness",
                "quest_readiness",
                "learner_readiness",
                "clinical_validity",
                "scoring_validity",
            ],
        },
        "providerBoundary": {
            "localOnly": True,
            "externalNetworkUsed": False,
            "paidApiUsed": False,
            "makehumanSourceEmbedded": False,
            "runtimePromotionAllowed": False,
            "productionAssetReadinessClaimed": False,
        },
        "notEvidenceFor": [
            "b_plus_visual_realism_gate",
            "production_asset_readiness",
            "quest_readiness",
            "learner_readiness",
            "clinical_validity",
            "scoring_validity",
        ],
    }
    report_path = pathlib.Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"EXPORTED {output_glb}")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
