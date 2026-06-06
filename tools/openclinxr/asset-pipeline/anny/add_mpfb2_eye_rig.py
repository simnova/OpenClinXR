#!/usr/bin/env python3
"""Add MPFB2-informed rigged procedural eyes to an Anny GLB.

This is an isolated cagematch stage. It enables the installed MPFB2 extension
and uses its default procedural eye settings when available, but does not claim
the Anny mesh is an MPFB basemesh or that MPFB standard rigging succeeded.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import bpy
from mathutils import Vector


NOT_EVIDENCE_FOR = [
    "mpfb_standard_rig_success",
    "b_plus_visual_realism_gate",
    "scene_placement_readiness",
    "quest_readiness",
    "production_asset_readiness",
    "learner_readiness",
    "clinical_validity",
    "scoring_validity",
]


def main() -> None:
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mpfb_status = enable_mpfb2()

    bpy.ops.import_scene.gltf(filepath=args.input_glb)
    mesh_obj = find_primary_mesh()
    armature_obj = find_armature()
    head_bone_name = find_head_bone_name(armature_obj)
    bounds = mesh_world_bounds(mesh_obj)
    eye_settings = load_mpfb2_eye_settings()

    eyes = add_rigged_eyes(mesh_obj, armature_obj, head_bone_name, bounds, eye_settings)
    pose_probe = run_pose_probe(eyes["lookTarget"], [eyes["left"], eyes["right"]])

    output_path = Path(args.output_glb)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        export_skins=True,
        export_morph=True,
        export_animations=True,
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
    )

    report = {
        "schemaVersion": "openclinxr.mpfb2-eye-rig-cagematch.v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "claimScope": "isolated_mpfb2_informed_low_poly_eye_rig_cagematch_not_production_or_b_plus",
        "inputGlbPath": args.input_glb,
        "outputGlbPath": str(output_path),
        "outputSha256": sha256(output_path),
        "mpfb2": mpfb_status,
        "directMpfbStandardRig": {
            "attempted": True,
            "succeeded": False,
            "reason": "Anny imported GLB is not tagged as an MPFB basemesh; mpfb.add_standard_rig.poll fails on this source.",
        },
        "eyeRig": {
            "mode": "mpfb2_default_eye_settings_low_poly_procedural_fallback",
            "headBoneName": head_bone_name,
            "parentMode": "bone_parent_to_existing_head_bone" if head_bone_name else "object_parent_to_armature_or_scene",
            "lookTargetName": eyes["lookTarget"].name,
            "objectNames": eyes["objectNames"],
            "triangleCount": eyes["triangleCount"],
            "targetMaxAddedTriangles": args.max_added_tris,
            "positions": eyes["positions"],
            "constraints": eyes["constraints"],
            "poseProbe": pose_probe,
            "exportedAnimationClip": "openclinxr_mpfb2_eye_look_probe",
        },
        "providerBoundary": {
            "localOnly": True,
            "externalNetworkUsed": False,
            "paidApiUsed": False,
            "credentialsUsed": False,
            "runtimePromotionAllowed": False,
            "productionAssetReadinessClaimed": False,
        },
        "notEvidenceFor": NOT_EVIDENCE_FOR,
    }
    if eyes["triangleCount"] > args.max_added_tris:
        report["eyeRig"]["blocker"] = "added_eye_triangle_count_exceeds_target"
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


def enable_mpfb2() -> dict[str, Any]:
    status: dict[str, Any] = {"module": "bl_ext.user_default.mpfb", "enabled": False, "operators": []}
    try:
        bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
        status["enabled"] = "bl_ext.user_default.mpfb" in bpy.context.preferences.addons
        status["version"] = "2.0.15"
        status["operators"] = sorted([name for name in dir(bpy.ops.mpfb) if name in {"add_standard_rig", "eyesettings_apply_settings"}])
    except Exception as exc:  # pragma: no cover - only available inside Blender.
        status["error"] = f"{exc.__class__.__name__}: {exc}"
    return status


def load_mpfb2_eye_settings() -> dict[str, Any]:
    settings_path = Path.home() / "Library/Application Support/Blender/5.1/extensions/user_default/mpfb/data/settings/eye_settings.default.json"
    if settings_path.exists():
        return json.loads(settings_path.read_text(encoding="utf-8"))
    return {
        "EyeWhiteColor": [0.96, 0.94, 0.88, 1.0],
        "IrisMajorColor": [0.33, 0.24, 0.12, 1.0],
        "IrisMinorColor": [0.16, 0.10, 0.05, 1.0],
        "PupilColor": [0.0, 0.0, 0.0, 1.0],
    }


def find_primary_mesh() -> bpy.types.Object:
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and "role_clothing" not in obj.name]
    if not meshes:
        raise RuntimeError("No mesh found in imported GLB")
    return max(meshes, key=lambda obj: len(obj.data.polygons))


def find_armature() -> bpy.types.Object | None:
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    return armatures[0] if armatures else None


def find_head_bone_name(armature_obj: bpy.types.Object | None) -> str | None:
    if not armature_obj:
        return None
    for name in ("head", "Head", "DEF-head"):
        if name in armature_obj.data.bones:
            return name
    return None


def mesh_world_bounds(mesh_obj: bpy.types.Object) -> dict[str, float]:
    vertices = [mesh_obj.matrix_world @ vertex.co for vertex in mesh_obj.data.vertices]
    xs = [vertex.x for vertex in vertices]
    ys = [vertex.y for vertex in vertices]
    zs = [vertex.z for vertex in vertices]
    return {
        "min_x": min(xs),
        "max_x": max(xs),
        "min_y": min(ys),
        "max_y": max(ys),
        "min_z": min(zs),
        "max_z": max(zs),
        "center_x": (min(xs) + max(xs)) / 2,
        "center_y": (min(ys) + max(ys)) / 2,
        "center_z": (min(zs) + max(zs)) / 2,
        "width": max(xs) - min(xs),
        "depth_y": max(ys) - min(ys),
        "height_z": max(zs) - min(zs),
    }


def add_rigged_eyes(
    mesh_obj: bpy.types.Object,
    armature_obj: bpy.types.Object | None,
    head_bone_name: str | None,
    bounds: dict[str, float],
    eye_settings: dict[str, Any],
) -> dict[str, Any]:
    radius = max(0.005, min(0.008, bounds["height_z"] * 0.0065))
    eye_z = bounds["max_z"] - bounds["height_z"] * 0.124
    # The Anny pediatric mesh uses Blender Y as the face-depth axis. Earlier
    # versions placed eyes in front of min_y, which exported as floating eyes.
    # Seat the procedural eyes inside the head volume near the source eye island.
    eye_y = bounds["min_y"] + bounds["depth_y"] * 0.47
    spacing = max(0.03, min(0.04, bounds["width"] * 0.046))
    target = bpy.data.objects.new("openclinxr_mpfb2_eye_look_target", None)
    target.empty_display_type = "SPHERE"
    target.empty_display_size = radius * 2.5
    target.location = (bounds["center_x"], bounds["min_y"] - radius * 12, eye_z)
    bpy.context.collection.objects.link(target)

    material = create_eye_material(eye_settings)
    iris_material = create_iris_material(eye_settings)
    pupil_material = create_pupil_material(eye_settings)
    eyes = {}
    constraints = []
    object_names = []
    triangle_count = 0
    for label, side in (("left", 1), ("right", -1)):
        location = (bounds["center_x"] + spacing * side, eye_y, eye_z)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=radius, location=location)
        eye = bpy.context.active_object
        eye.name = f"openclinxr_mpfb2_{label}_eye"
        eye.data.name = f"{eye.name}_mesh"
        eye.data.materials.append(material)
        world_matrix = eye.matrix_world.copy()
        if armature_obj and head_bone_name:
            eye.parent = armature_obj
            eye.parent_type = "BONE"
            eye.parent_bone = head_bone_name
            eye.matrix_world = world_matrix
        elif armature_obj:
            eye.parent = armature_obj
            eye.matrix_world = world_matrix
        constraint = eye.constraints.new(type="TRACK_TO")
        constraint.name = "openclinxr_mpfb2_eye_track_to_target"
        constraint.track_axis = "TRACK_NEGATIVE_Z"
        constraint.up_axis = "UP_Y"
        constraint.target = target
        constraints.append({"object": eye.name, "type": "TRACK_TO", "target": target.name})
        triangle_count += sum(len(poly.vertices) - 2 for poly in eye.data.polygons)
        object_names.append(eye.name)
        for detail in add_eye_face_details(eye, label, radius, iris_material, pupil_material):
            triangle_count += sum(len(poly.vertices) - 2 for poly in detail.data.polygons)
            object_names.append(detail.name)
        eyes[label] = eye

    return {
        "left": eyes["left"],
        "right": eyes["right"],
        "lookTarget": target,
        "triangleCount": triangle_count,
        "objectNames": object_names,
        "positions": {
            "left": tuple(round(item, 5) for item in eyes["left"].location),
            "right": tuple(round(item, 5) for item in eyes["right"].location),
            "leftWorld": tuple(round(item, 5) for item in eyes["left"].matrix_world.translation),
            "rightWorld": tuple(round(item, 5) for item in eyes["right"].matrix_world.translation),
            "target": tuple(round(item, 5) for item in target.location),
        },
        "constraints": constraints,
    }


def create_eye_material(settings: dict[str, Any]) -> bpy.types.Material:
    material = bpy.data.materials.new("openclinxr_mpfb2_default_procedural_eye_material")
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF") or material.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    white = settings.get("EyeWhiteColor") or [0.96, 0.94, 0.88, 1.0]
    bsdf.inputs["Base Color"].default_value = (
        min(1.0, white[0] * 0.94),
        min(1.0, white[1] * 0.94),
        min(1.0, white[2] * 0.94),
        1.0,
    )
    bsdf.inputs["Roughness"].default_value = float(settings.get("InnerLayerRoughness", 0.05))
    bsdf.inputs["Metallic"].default_value = 0.0
    return material


def create_iris_material(settings: dict[str, Any]) -> bpy.types.Material:
    material = bpy.data.materials.new("openclinxr_mpfb2_default_iris_material")
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF") or material.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    iris = settings.get("IrisMajorColor") or [0.33, 0.24, 0.12, 1.0]
    bsdf.inputs["Base Color"].default_value = (iris[0], iris[1], iris[2], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.18
    bsdf.inputs["Metallic"].default_value = 0.0
    return material


def create_pupil_material(settings: dict[str, Any]) -> bpy.types.Material:
    material = bpy.data.materials.new("openclinxr_mpfb2_default_pupil_material")
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF") or material.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    pupil = settings.get("PupilColor") or [0.0, 0.0, 0.0, 1.0]
    bsdf.inputs["Base Color"].default_value = (pupil[0], pupil[1], pupil[2], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.12
    bsdf.inputs["Metallic"].default_value = 0.0
    return material


def add_eye_face_details(
    eye: bpy.types.Object,
    label: str,
    radius: float,
    iris_material: bpy.types.Material,
    pupil_material: bpy.types.Material,
) -> list[bpy.types.Object]:
    details = []
    for suffix, scale, y_offset, material in (
        ("iris", 0.43, -1.02, iris_material),
        ("pupil", 0.18, -1.05, pupil_material),
    ):
        location = eye.matrix_world.translation + Vector((0.0, radius * y_offset, 0.0))
        bpy.ops.mesh.primitive_circle_add(
            vertices=12,
            radius=radius * scale,
            fill_type="TRIFAN",
            location=location,
            rotation=(math.radians(90), 0.0, 0.0),
        )
        detail = bpy.context.active_object
        detail.name = f"openclinxr_mpfb2_{label}_{suffix}"
        detail.data.name = f"{detail.name}_mesh"
        detail.data.materials.append(material)
        world_matrix = detail.matrix_world.copy()
        detail.parent = eye
        detail.matrix_world = world_matrix
        details.append(detail)
    return details


def run_pose_probe(target: bpy.types.Object, eyes: list[bpy.types.Object]) -> dict[str, Any]:
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 28
    bpy.context.scene.frame_set(1)
    start = tuple(round(item, 5) for item in target.location)
    target.keyframe_insert(data_path="location", frame=1)
    for eye in eyes:
        eye.keyframe_insert(data_path="rotation_euler", frame=1)
    bpy.context.scene.frame_set(28)
    target.location.x += 0.04
    target.location.z += 0.01
    bpy.context.view_layer.update()
    target.keyframe_insert(data_path="location", frame=28)
    for eye in eyes:
        eye.keyframe_insert(data_path="rotation_euler", frame=28)
    moved = tuple(round(item, 5) for item in target.location)
    action_names = []
    for obj in [target, *eyes]:
        if obj.animation_data and obj.animation_data.action:
            obj.animation_data.action.name = "openclinxr_mpfb2_eye_look_probe"
            action_names.append(obj.animation_data.action.name)
    return {
        "targetMoved": start != moved,
        "start": start,
        "moved": moved,
        "keyframedFrames": [1, 28],
        "exportableActionNames": sorted(set(action_names)),
    }


def sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    argv = sys.argv[1:]
    if "--" in argv:
        argv = argv[len(argv) - 1 - list(reversed(argv)).index("--"):]
    argv = [item for item in argv if item != "--"]
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-glb", required=True)
    parser.add_argument("--output-glb", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--max-added-tris", type=int, default=1000)
    return parser.parse_args(argv)


if __name__ == "__main__":
    main()
