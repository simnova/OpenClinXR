"""Render local body-rig appendage motion videos and pose sheets for cagematch evidence.

This is diagnostic visual evidence only. It creates a reproducible Blender scene from
an existing GLB, applies a simple rig-specific diagnostic pose sequence, and renders:
- a short video showing head, torso, arms, and legs moving
- a pose sheet with T-pose, sitting, and arms-raised frames
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import subprocess
import sys
from typing import Iterable

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    argv = [arg for arg in argv if arg != "--"]
    parser = argparse.ArgumentParser(description="Render appendage motion pose evidence.")
    parser.add_argument("--anny-glb", required=True)
    parser.add_argument("--mpfb-glb", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--fps", type=int, default=18)
    parser.add_argument("--frames", type=int, default=108)
    parser.add_argument("--resolution", type=int, default=900)
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    output_dir = pathlib.Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    runs = [
        render_one("anny", pathlib.Path(args.anny_glb), output_dir, args),
        render_one("mpfb", pathlib.Path(args.mpfb_glb), output_dir, args),
    ]
    manifest = {
        "schemaVersion": "openclinxr.appendage-motion-pose-visual-evidence.v1",
        "claimScope": "diagnostic_blender_pose_and_appendage_motion_visual_evidence_not_runtime_or_readiness",
        "runs": runs,
        "notEvidenceFor": [
            "browser_live_skinning_visibility",
            "motion_capture_quality",
            "speech2motion_quality",
            "b_plus_visual_realism_gate",
            "scene_placement_readiness",
            "quest_readiness",
            "production_asset_readiness",
            "learner_readiness",
            "clinical_validity",
            "scoring_validity",
        ],
    }
    (output_dir / "appendage-motion-pose-evidence.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def render_one(label: str, glb_path: pathlib.Path, output_dir: pathlib.Path, args: argparse.Namespace) -> dict:
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if armature is None:
        raise RuntimeError(f"No armature found in {glb_path}")

    normalize_armature_height(armature, target_height=2.2)
    setup_camera_and_light(args.resolution)
    mapping = create_diagnostic_action(label, armature, args.frames)
    proxy_materials = make_proxy_materials()
    association = build_model_association_visuals(armature, mapping, proxy_materials)
    hide_source_meshes()

    frame_dir = output_dir / f"{label}-frames"
    pose_dir = output_dir / f"{label}-pose-frames"
    frame_dir.mkdir(parents=True, exist_ok=True)
    pose_dir.mkdir(parents=True, exist_ok=True)

    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = args.frames
    bpy.context.scene.frame_set(1)
    for frame in range(1, args.frames + 1):
        bpy.context.scene.frame_set(frame)
        sync_proxy_skeleton(armature, mapping, proxy_materials, association["segmentRadiiByBone"])
        bpy.context.scene.render.filepath = str(frame_dir / f"{label}_{frame:04d}.png")
        bpy.ops.render.render(write_still=True)

    video_path = output_dir / f"{label}_appendage_motion_diagnostic.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-framerate",
            str(args.fps),
            "-i",
            str(frame_dir / f"{label}_%04d.png"),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(video_path),
        ],
        check=True,
    )

    pose_frames = {"t_pose": 1, "sitting": args.frames // 2, "arms_raised": args.frames // 4}
    pose_paths: dict[str, str] = {}
    for pose_name, frame in pose_frames.items():
        bpy.context.scene.frame_set(frame)
        sync_proxy_skeleton(armature, mapping, proxy_materials, association["segmentRadiiByBone"])
        pose_path = pose_dir / f"{label}_{pose_name}.png"
        bpy.context.scene.render.filepath = str(pose_path)
        bpy.ops.render.render(write_still=True)
        pose_paths[pose_name] = str(pose_path)

    sheet_path = output_dir / f"{label}_pose_sheet_tpose_sitting_armsraised.png"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            pose_paths["t_pose"],
            "-i",
            pose_paths["sitting"],
            "-i",
            pose_paths["arms_raised"],
            "-filter_complex",
            "hstack=inputs=3",
            str(sheet_path),
        ],
        check=True,
    )

    return {
        "label": label,
        "sourceGlbPath": str(glb_path),
        "videoPath": str(video_path),
        "poseSheetPath": str(sheet_path),
        "poseFrames": pose_paths,
        "diagnosticFrames": str(frame_dir),
        "animatedRegions": ["head", "torso", "leftArm", "rightArm", "leftLeg", "rightLeg"],
        "associationMethod": association["method"],
        "associatedRestSurfaceObjects": association["restSurfaceObjects"],
        "segmentRadiiByBone": association["segmentRadiiByBone"],
        "associationWarnings": association["warnings"],
    }


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def hide_source_meshes() -> None:
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.hide_render = True
            obj.hide_viewport = True


def normalize_armature_height(armature: bpy.types.Object, target_height: float) -> None:
    bounds = armature_bounds(armature)
    size = bounds[1] - bounds[0]
    height = max(size.z, 0.001)
    scale = target_height / height
    top_level = [obj for obj in bpy.context.scene.objects if obj.parent is None]
    empty = bpy.data.objects.new("openclinxr_appendage_evidence_root", None)
    bpy.context.collection.objects.link(empty)
    for obj in top_level:
        if obj == empty:
            continue
        matrix = obj.matrix_world.copy()
        obj.parent = empty
        obj.matrix_parent_inverse = empty.matrix_world.inverted()
        obj.matrix_world = matrix
    empty.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    bounds = armature_bounds(armature)
    center = (bounds[0] + bounds[1]) / 2
    empty.location += Vector((-center.x, -center.y, -bounds[0].z))
    bpy.context.view_layer.update()


def setup_camera_and_light(resolution: int) -> None:
    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.context.scene.eevee.taa_render_samples = 24
    bpy.context.scene.render.resolution_x = resolution
    bpy.context.scene.render.resolution_y = resolution
    bpy.context.scene.view_settings.view_transform = "Standard"
    if bpy.context.scene.world:
        bpy.context.scene.world.color = (0.08, 0.12, 0.10)

    light_data = bpy.data.lights.new("openclinxr_appendage_key", "AREA")
    light_data.energy = 700
    light_data.size = 4
    light = bpy.data.objects.new("openclinxr_appendage_key", light_data)
    bpy.context.collection.objects.link(light)
    light.location = (2.4, -3.2, 4.2)

    cam_data = bpy.data.cameras.new("openclinxr_appendage_camera")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.75
    cam = bpy.data.objects.new("openclinxr_appendage_camera", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (0, -4.8, 1.12)
    look_at(cam, Vector((0, 0, 1.05)))
    bpy.context.scene.camera = cam


def create_diagnostic_action(label: str, armature: bpy.types.Object, frame_count: int) -> dict[str, str]:
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="POSE")
    for bone in armature.pose.bones:
        bone.rotation_mode = "XYZ"
        bone.rotation_euler = (0, 0, 0)
        bone.location = (0, 0, 0)
    armature.animation_data_create()
    action = bpy.data.actions.new(f"openclinxr_{label}_all_appendage_diagnostic_pose_cycle")
    armature.animation_data.action = action

    names = {bone.name for bone in armature.pose.bones}
    mpfb = any(name.startswith("upperarm01") for name in names)
    mapping = mpfb_mapping() if mpfb else anny_mapping()
    poses = [
        (1, t_pose(mapping)),
        (max(2, frame_count // 4), arms_raised_pose(mapping)),
        (max(3, frame_count // 2), sitting_pose(mapping)),
        (max(4, (frame_count * 3) // 4), alternating_appendage_pose(mapping)),
        (frame_count, t_pose(mapping)),
    ]
    for frame, rotations in poses:
        bpy.context.scene.frame_set(frame)
        for bone_name, rotation in rotations.items():
            bone = armature.pose.bones.get(bone_name)
            if bone:
                bone.rotation_mode = "XYZ"
                bone.rotation_euler = rotation
                bone.keyframe_insert("rotation_euler", frame=frame)
    bpy.ops.object.mode_set(mode="OBJECT")
    return mapping


def make_proxy_materials() -> dict[str, bpy.types.Material]:
    colors = {
        "torso": (0.28, 0.95, 0.65, 1.0),
        "head": (0.95, 0.92, 0.78, 1.0),
        "leftArm": (0.35, 0.65, 1.0, 1.0),
        "rightArm": (0.35, 0.65, 1.0, 1.0),
        "leftLeg": (1.0, 0.64, 0.28, 1.0),
        "rightLeg": (1.0, 0.64, 0.28, 1.0),
        "joint": (1.0, 1.0, 1.0, 1.0),
        "restSurface": (0.72, 0.78, 0.82, 0.22),
    }
    materials: dict[str, bpy.types.Material] = {}
    for name, color in colors.items():
        mat = bpy.data.materials.new(f"openclinxr_appendage_{name}")
        mat.diffuse_color = color
        if color[3] < 1.0:
            mat.use_nodes = True
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                bsdf.inputs["Alpha"].default_value = color[3]
            mat.blend_method = "BLEND"
            mat.show_transparent_back = True
        materials[name] = mat
    return materials


def build_model_association_visuals(
    armature: bpy.types.Object, mapping: dict[str, str], materials: dict[str, bpy.types.Material]
) -> dict:
    radii = compute_segment_radii_from_vertex_groups(armature, mapping)
    rest_surface_result = create_rest_surface_copies(armature, materials["restSurface"])
    return {
        "method": "armature_bones_with_mesh_vertex_group_derived_segment_radii_and_rest_surface_when_bounds_are_sane",
        "segmentRadiiByBone": radii,
        "restSurfaceObjects": rest_surface_result["objects"],
        "warnings": rest_surface_result["warnings"],
    }


def compute_segment_radii_from_vertex_groups(armature: bpy.types.Object, mapping: dict[str, str]) -> dict[str, float]:
    bone_names = {
        mapping[key]
        for key in [
            "torso1",
            "torso2",
            "head",
            "leftUpperArm",
            "leftForearm",
            "rightUpperArm",
            "rightForearm",
            "leftThigh",
            "leftShin",
            "leftFoot",
            "rightThigh",
            "rightShin",
            "rightFoot",
        ]
    }
    distances: dict[str, list[float]] = {bone_name: [] for bone_name in bone_names}
    bpy.context.view_layer.update()
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name.startswith("openclinxr_appendage_"):
            continue
        group_names = {group.index: group.name for group in obj.vertex_groups}
        for vertex in obj.data.vertices:
            matching = [
                group
                for group in vertex.groups
                if group.weight >= 0.05 and group_names.get(group.group) in bone_names
            ]
            if not matching:
                continue
            dominant = max(matching, key=lambda group: group.weight)
            bone_name = group_names[dominant.group]
            bone = armature.pose.bones.get(bone_name)
            if not bone:
                continue
            point = obj.matrix_world @ vertex.co
            head = armature.matrix_world @ bone.head
            tail = armature.matrix_world @ bone.tail
            distances[bone_name].append(distance_to_segment(point, head, tail))

    radii: dict[str, float] = {}
    for bone_name, samples in distances.items():
        if not samples:
            radii[bone_name] = 0.035
            continue
        samples.sort()
        radius = samples[min(len(samples) - 1, int(len(samples) * 0.72))]
        radii[bone_name] = round(max(0.028, min(radius, 0.16)), 4)
    return radii


def create_rest_surface_copies(armature: bpy.types.Object, material: bpy.types.Material) -> dict[str, list[str]]:
    arm_min, arm_max = armature_bounds(armature)
    arm_size = arm_max - arm_min
    max_extent = max(arm_size.x, arm_size.y, arm_size.z, 0.001) * 4.5
    objects: list[str] = []
    warnings: list[str] = []
    for source in list(bpy.context.scene.objects):
        if source.type != "MESH" or source.name.startswith("openclinxr_appendage_"):
            continue
        verts = [source.matrix_world @ vertex.co for vertex in source.data.vertices]
        if not verts:
            continue
        mins = Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts)))
        maxs = Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts)))
        size = maxs - mins
        if max(size.x, size.y, size.z) > max_extent:
            warnings.append(f"skipped_rest_surface_copy_for_pathological_bounds:{source.name}")
            continue
        faces = [[vertex for vertex in polygon.vertices] for polygon in source.data.polygons]
        mesh = bpy.data.meshes.new(f"openclinxr_appendage_associated_rest_surface_mesh_{source.name}")
        mesh.from_pydata([tuple(v) for v in verts], [], faces)
        mesh.update()
        copy = bpy.data.objects.new(f"openclinxr_appendage_associated_rest_surface_{source.name}", mesh)
        bpy.context.collection.objects.link(copy)
        copy.data.materials.append(material)
        objects.append(copy.name)
    if not objects:
        warnings.append("no_rest_surface_copy_rendered;using_vertex_group_radii_only")
    return {"objects": objects, "warnings": warnings}


def sync_proxy_skeleton(
    armature: bpy.types.Object,
    mapping: dict[str, str],
    materials: dict[str, bpy.types.Material],
    segment_radii_by_bone: dict[str, float],
) -> None:
    for obj in list(bpy.context.scene.objects):
        if obj.name.startswith("openclinxr_appendage_proxy_"):
            bpy.data.objects.remove(obj, do_unlink=True)
    segments = [
        ("torso", mapping["torso1"]),
        ("torso", mapping["torso2"]),
        ("head", mapping["head"]),
        ("leftArm", mapping["leftUpperArm"]),
        ("leftArm", mapping["leftForearm"]),
        ("rightArm", mapping["rightUpperArm"]),
        ("rightArm", mapping["rightForearm"]),
        ("leftLeg", mapping["leftThigh"]),
        ("leftLeg", mapping["leftShin"]),
        ("leftLeg", mapping["leftFoot"]),
        ("rightLeg", mapping["rightThigh"]),
        ("rightLeg", mapping["rightShin"]),
        ("rightLeg", mapping["rightFoot"]),
    ]
    joint_points: list[Vector] = []
    for region, bone_name in segments:
        bone = armature.pose.bones.get(bone_name)
        if not bone:
            continue
        head = armature.matrix_world @ bone.head
        tail = armature.matrix_world @ bone.tail
        joint_points.extend([head, tail])
        create_bone_cylinder(head, tail, materials[region], segment_radii_by_bone.get(bone_name, 0.035))
    for point in joint_points:
        create_joint_sphere(point, materials["joint"], 0.028)


def create_bone_cylinder(head: Vector, tail: Vector, material: bpy.types.Material, radius: float) -> None:
    direction = tail - head
    length = direction.length
    if length <= 0.001:
        return
    bpy.ops.mesh.primitive_cylinder_add(vertices=18, radius=radius, depth=length, location=(head + tail) / 2)
    obj = bpy.context.object
    obj.name = "openclinxr_appendage_proxy_model_associated_segment"
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(material)


def create_joint_sphere(location: Vector, material: bpy.types.Material, radius: float) -> None:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = "openclinxr_appendage_proxy_joint"
    obj.data.materials.append(material)


def anny_mapping() -> dict[str, str]:
    return {
        "torso1": "spine",
        "torso2": "chest",
        "head": "head",
        "leftUpperArm": "upper_arm.L",
        "rightUpperArm": "upper_arm.R",
        "leftForearm": "forearm.L",
        "rightForearm": "forearm.R",
        "leftThigh": "thigh.L",
        "rightThigh": "thigh.R",
        "leftShin": "shin.L",
        "rightShin": "shin.R",
        "leftFoot": "foot.L",
        "rightFoot": "foot.R",
    }


def mpfb_mapping() -> dict[str, str]:
    return {
        "torso1": "spine01",
        "torso2": "spine02",
        "head": "neck01",
        "leftUpperArm": "upperarm01.L",
        "rightUpperArm": "upperarm01.R",
        "leftForearm": "lowerarm01.L",
        "rightForearm": "lowerarm01.R",
        "leftThigh": "upperleg01.L",
        "rightThigh": "upperleg01.R",
        "leftShin": "lowerleg01.L",
        "rightShin": "lowerleg01.R",
        "leftFoot": "foot.L",
        "rightFoot": "foot.R",
    }


def t_pose(mapping: dict[str, str]) -> dict[str, tuple[float, float, float]]:
    return {
        mapping["torso1"]: (0.0, 0.0, 0.0),
        mapping["torso2"]: (0.0, 0.0, 0.0),
        mapping["head"]: (0.0, 0.0, 0.0),
        mapping["leftUpperArm"]: (0.0, 0.0, -1.15),
        mapping["rightUpperArm"]: (0.0, 0.0, 1.15),
        mapping["leftForearm"]: (0.0, 0.0, 0.0),
        mapping["rightForearm"]: (0.0, 0.0, 0.0),
        mapping["leftThigh"]: (0.0, 0.0, 0.0),
        mapping["rightThigh"]: (0.0, 0.0, 0.0),
        mapping["leftShin"]: (0.0, 0.0, 0.0),
        mapping["rightShin"]: (0.0, 0.0, 0.0),
    }


def arms_raised_pose(mapping: dict[str, str]) -> dict[str, tuple[float, float, float]]:
    rotations = t_pose(mapping)
    rotations.update(
        {
            mapping["torso1"]: (0.12, 0.0, 0.0),
            mapping["torso2"]: (0.16, 0.0, 0.0),
            mapping["head"]: (-0.08, 0.0, 0.0),
            mapping["leftUpperArm"]: (-1.25, 0.0, -0.45),
            mapping["rightUpperArm"]: (-1.25, 0.0, 0.45),
            mapping["leftForearm"]: (-0.55, 0.0, -0.1),
            mapping["rightForearm"]: (-0.55, 0.0, 0.1),
            mapping["leftThigh"]: (0.06, 0.0, -0.06),
            mapping["rightThigh"]: (-0.04, 0.0, 0.06),
        }
    )
    return rotations


def sitting_pose(mapping: dict[str, str]) -> dict[str, tuple[float, float, float]]:
    rotations = t_pose(mapping)
    rotations.update(
        {
            mapping["torso1"]: (0.22, 0.0, 0.0),
            mapping["torso2"]: (-0.08, 0.0, 0.0),
            mapping["head"]: (-0.10, 0.0, 0.0),
            mapping["leftUpperArm"]: (0.32, 0.0, -0.35),
            mapping["rightUpperArm"]: (0.32, 0.0, 0.35),
            mapping["leftForearm"]: (-0.45, 0.0, -0.08),
            mapping["rightForearm"]: (-0.45, 0.0, 0.08),
            mapping["leftThigh"]: (1.12, 0.0, -0.08),
            mapping["rightThigh"]: (1.12, 0.0, 0.08),
            mapping["leftShin"]: (-1.15, 0.0, 0.0),
            mapping["rightShin"]: (-1.15, 0.0, 0.0),
            mapping["leftFoot"]: (0.18, 0.0, -0.05),
            mapping["rightFoot"]: (0.18, 0.0, 0.05),
        }
    )
    return rotations


def alternating_appendage_pose(mapping: dict[str, str]) -> dict[str, tuple[float, float, float]]:
    rotations = t_pose(mapping)
    rotations.update(
        {
            mapping["torso1"]: (-0.16, 0.0, 0.05),
            mapping["torso2"]: (0.12, 0.0, -0.05),
            mapping["head"]: (0.10, 0.0, 0.12),
            mapping["leftUpperArm"]: (-0.35, 0.0, -0.85),
            mapping["rightUpperArm"]: (0.42, 0.0, 0.65),
            mapping["leftForearm"]: (-0.35, 0.0, -0.25),
            mapping["rightForearm"]: (0.26, 0.0, 0.22),
            mapping["leftThigh"]: (0.45, 0.0, -0.12),
            mapping["rightThigh"]: (-0.25, 0.0, 0.12),
            mapping["leftShin"]: (-0.30, 0.0, 0.0),
            mapping["rightShin"]: (0.18, 0.0, 0.0),
            mapping["leftFoot"]: (0.12, 0.0, -0.08),
            mapping["rightFoot"]: (-0.08, 0.0, 0.08),
        }
    )
    return rotations


def armature_bounds(armature: bpy.types.Object) -> tuple[Vector, Vector]:
    mins = Vector((float("inf"), float("inf"), float("inf")))
    maxs = Vector((float("-inf"), float("-inf"), float("-inf")))
    bpy.context.view_layer.update()
    for bone in armature.pose.bones:
        for point in (armature.matrix_world @ bone.head, armature.matrix_world @ bone.tail):
            mins.x = min(mins.x, point.x)
            mins.y = min(mins.y, point.y)
            mins.z = min(mins.z, point.z)
            maxs.x = max(maxs.x, point.x)
            maxs.y = max(maxs.y, point.y)
            maxs.z = max(maxs.z, point.z)
    if not math.isfinite(mins.x):
        return Vector((-0.5, -0.5, 0.0)), Vector((0.5, 0.5, 2.0))
    return mins, maxs


def distance_to_segment(point: Vector, head: Vector, tail: Vector) -> float:
    segment = tail - head
    length_squared = segment.length_squared
    if length_squared <= 0.000001:
        return (point - head).length
    t = max(0.0, min(1.0, (point - head).dot(segment) / length_squared))
    closest = head + (segment * t)
    return (point - closest).length


def scene_bounds() -> tuple[Vector, Vector]:
    mins = Vector((float("inf"), float("inf"), float("inf")))
    maxs = Vector((float("-inf"), float("-inf"), float("-inf")))
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, world.x)
            mins.y = min(mins.y, world.y)
            mins.z = min(mins.z, world.z)
            maxs.x = max(maxs.x, world.x)
            maxs.y = max(maxs.y, world.y)
            maxs.z = max(maxs.z, world.z)
    if not math.isfinite(mins.x):
        return Vector((-0.5, -0.5, 0.0)), Vector((0.5, 0.5, 2.0))
    return mins, maxs


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


if __name__ == "__main__":
    main()
