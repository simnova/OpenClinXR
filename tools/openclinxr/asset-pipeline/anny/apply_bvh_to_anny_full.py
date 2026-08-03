#!/usr/bin/env python3
"""
Retarget open BVH locomotion onto a *full* Anny/MakeHuman (~163) armature.

Pipeline (proven MH-style path):
  1) Load Anny mesh (OBJ) + rest skeleton sidecar (163 bones + full LBS)
  2) Build full armature in Y-up mesh space
  3) Import BVH, map joints → Anny bones (CMU / MB-Lab / Bandai tables)
  4) Copy-rotation constraints, bake action, export GLB

Usage:
  blender --background --python apply_bvh_to_anny_full.py -- \\
    --mesh path/to.anny_base.obj \\
    --rest-skeleton path/to.anny_rest_skeleton.json \\
    --bvh path/to/walk.bvh \\
    --output-glb path/to.out.glb \\
    --map mblab|cmu|bandai|auto
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

try:
    import bpy
    from mathutils import Matrix, Vector, Euler, Quaternion
except ImportError:
    print("ERROR: run with blender --background --python ...")
    sys.exit(1)


# --- Joint name maps: BVH joint → Anny bone label ---
# Anny/MH legs: upperleg01 (hip) → upperleg02 → lowerleg01 (knee) → lowerleg02 → foot
# Drive hip/knee joints (*01), NOT mid-segment only. Feet default OFF (see is_skip_default).
# CMU (cgspeed / classic) common names.
# Do NOT map LHipJoint/RHipJoint → pelvis.L/R: those CMU nodes are near-zero
# offset "pad" joints; driving Anny pelvis.* twists the hip chain.
MAP_CMU: Dict[str, str] = {
    "Hips": "root",
    "LeftUpLeg": "upperleg01.L",
    "LeftLeg": "lowerleg01.L",
    "LeftFoot": "foot.L",
    "LeftToeBase": "toe1-1.L",
    "RightUpLeg": "upperleg01.R",
    "RightLeg": "lowerleg01.R",
    "RightFoot": "foot.R",
    "RightToeBase": "toe1-1.R",
    "LowerBack": "spine05",
    "Spine": "spine04",
    "Spine1": "spine02",
    "Spine2": "spine01",
    "Neck": "neck01",
    "Neck1": "neck02",
    "Head": "head",
    "LeftShoulder": "clavicle.L",
    "LeftArm": "upperarm01.L",
    "LeftForeArm": "lowerarm01.L",
    "LeftHand": "wrist.L",
    "RightShoulder": "clavicle.R",
    "RightArm": "upperarm01.R",
    "RightForeArm": "lowerarm01.R",
    "RightHand": "wrist.R",
}

# MB-Lab walking.bvh (local open sample; game-like names)
MAP_MBLAB: Dict[str, str] = {
    "pelvis": "root",
    "spine01": "spine05",
    "spine02": "spine04",
    "spine03": "spine02",
    "neck": "neck02",
    "head": "head",
    "clavicle_L": "clavicle.L",
    "upperarm_L": "upperarm01.L",
    "lowerarm_L": "lowerarm01.L",
    "hand_L": "wrist.L",
    "thumb01_L": "finger1-1.L",
    "index01_L": "finger2-1.L",
    "middle01_L": "finger3-1.L",
    "ring01_L": "finger4-1.L",
    "pinky01_L": "finger5-1.L",
    "clavicle_R": "clavicle.R",
    "upperarm_R": "upperarm01.R",
    "lowerarm_R": "lowerarm01.R",
    "hand_R": "wrist.R",
    "thumb01_R": "finger1-1.R",
    "index01_R": "finger2-1.R",
    "middle01_R": "finger3-1.R",
    "ring01_R": "finger4-1.R",
    "pinky01_R": "finger5-1.R",
    "thigh_L": "upperleg01.L",
    "calf_L": "lowerleg01.L",
    "foot_L": "foot.L",
    "toes_L": "toe1-1.L",
    "thigh_R": "upperleg01.R",
    "calf_R": "lowerleg01.R",
    "foot_R": "foot.R",
    "toes_R": "toe1-1.R",
}

# Bandai Namco research BVH (Hips/Spine style)
MAP_BANDAI: Dict[str, str] = {
    "joint_Root": "root",
    "Hips": "root",
    "Spine": "spine05",
    "Chest": "spine02",
    "Neck": "neck02",
    "Head": "head",
    "Shoulder_L": "clavicle.L",
    "UpperArm_L": "upperarm01.L",
    "LowerArm_L": "lowerarm01.L",
    "Hand_L": "wrist.L",
    "Shoulder_R": "clavicle.R",
    "UpperArm_R": "upperarm01.R",
    "LowerArm_R": "lowerarm01.R",
    "Hand_R": "wrist.R",
    "UpperLeg_L": "upperleg01.L",
    "LowerLeg_L": "lowerleg01.L",
    "Foot_L": "foot.L",
    "UpperLeg_R": "upperleg01.R",
    "LowerLeg_R": "lowerleg01.R",
    "Foot_R": "foot.R",
    # alternate Bandai spellings
    "LeftUpLeg": "upperleg01.L",
    "LeftLeg": "lowerleg01.L",
    "LeftFoot": "foot.L",
    "RightUpLeg": "upperleg01.R",
    "RightLeg": "lowerleg01.R",
    "RightFoot": "foot.R",
    "LeftArm": "upperarm01.L",
    "LeftForeArm": "lowerarm01.L",
    "LeftHand": "wrist.L",
    "RightArm": "upperarm01.R",
    "RightForeArm": "lowerarm01.R",
    "RightHand": "wrist.R",
    "LeftShoulder": "clavicle.L",
    "RightShoulder": "clavicle.R",
}

# Optional rest-local bones (only when flags disable drive).
# Feet are driven from BVH by default again (plantigrade skip was too aggressive).
DEFAULT_SKIP_DRIVE: frozenset = frozenset(
    {
        "wrist.L",
        "wrist.R",
    }
)


# --- Diagnostics / fail-loud self-check thresholds (see BVH-RETARGET-HANDOFF) ---
# A healthy walk/run shows tens of degrees of joint motion; a Blender-5 layered-action
# slot bug (mute without action_slot restore) bakes an identity/static A-pose that still
# reports "playing". These thresholds turn that (and other silent failures) into a
# non-zero exit at bake time instead of a broken GLB shipped downstream.
MIN_MOTION_DEG = 5.0            # max joint delta below this => static/near-static bake
MIN_THIGH_SWING_DEG = 10.0     # locomotion thigh (upperleg01.L/R) must actually swing
MAX_EXPLODE_RATIO = 3.0        # animated mesh bbox / rest bbox; higher => LBS shred/desync
MAX_UNWEIGHTED_FRACTION = 0.01 # fraction of vertices with no bone weight
STANDING_Y_OVER_Z_MIN = 1.15   # skeleton must be taller (Y) than deep (Z): not a lying rest

# Source-license provenance for the shipping gate (Phase 5). Product GLBs may only
# bake license-clean sources; MB-Lab samples are AGPL and stay local-validation only.
LICENSE_BY_SOURCE_PREFIX: Dict[str, str] = {
    "mblab": "AGPL-local-only",
    "cmu": "free-all-uses",
    "bandai": "CC-BY-NC",
}
PRODUCT_ALLOWED_LICENSES: frozenset = frozenset({"free-all-uses"})


def license_for_source(bvh_path: str) -> str:
    """Map a BVH source filename to its license posture (see proof-animations/LICENSE-*)."""
    base = os.path.basename(bvh_path).lower()
    for prefix, lic in LICENSE_BY_SOURCE_PREFIX.items():
        if base.startswith(prefix):
            return lic
    return "unknown"


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--mesh", required=True, help="Anny Y-up OBJ")
    ap.add_argument("--rest-skeleton", required=True, help="*.anny_rest_skeleton.json with fullSkinning")
    ap.add_argument("--bvh", required=True, action="append", help="BVH path (repeatable)")
    ap.add_argument("--output-glb", required=True)
    ap.add_argument("--map", default="auto", choices=["auto", "cmu", "mblab", "bandai"])
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--scale-bvh", type=float, default=0.01, help="BVH unit scale (cm→m often 0.01)")
    ap.add_argument(
        "--body-only",
        action="store_true",
        default=True,
        help="Skip finger/toe maps (default). Axis-mismatch on extremities mutates mesh badly.",
    )
    ap.add_argument(
        "--include-extremities",
        action="store_true",
        help="Map fingers/toes too (riskier; bad roll mutates LBS).",
    )
    ap.add_argument(
        "--drive-feet",
        action="store_true",
        default=True,
        help="Drive foot.L/R from BVH (default ON).",
    )
    ap.add_argument(
        "--no-drive-feet",
        action="store_true",
        help="Leave feet at rest vs shin (plantigrade; no BVH ankle).",
    )
    ap.add_argument(
        "--drive-hands",
        action="store_true",
        default=True,
        help="Drive wrist.L/R from BVH (default ON; hand fans naturally). Self-check catches bad-axis shred.",
    )
    ap.add_argument(
        "--no-drive-hands",
        action="store_true",
        help="Leave wrists at forearm rest (hands ride the forearm rigidly).",
    )
    ap.add_argument(
        "--root-motion",
        action="store_true",
        default=True,
        help="Transfer planar/vertical root translation deltas (default on).",
    )
    ap.add_argument("--no-root-motion", action="store_true", help="Keep Anny root translation fixed.")
    ap.add_argument(
        "--root-yaw-only",
        action="store_true",
        help="Constrain root delta to yaw (fixes CMU forward dive). Auto-on for --map cmu.",
    )
    ap.add_argument(
        "--no-root-yaw-only",
        action="store_true",
        help="Disable the root yaw-only constraint even for CMU.",
    )
    ap.add_argument(
        "--strict",
        action="store_true",
        default=True,
        help="Fail the bake (non-zero exit) on any diagnostics blocker (default ON).",
    )
    ap.add_argument(
        "--no-strict",
        action="store_true",
        help="Emit diagnostics but do not fail the bake (diagnostic-only run).",
    )
    ap.add_argument(
        "--product",
        action="store_true",
        help="Product bake: only license-clean sources allowed (blocks AGPL MB-Lab).",
    )
    return ap.parse_args(argv)


def is_extremity_bone(anny_name: str) -> bool:
    n = anny_name.lower()
    return (
        n.startswith("finger")
        or n.startswith("toe")
        or "thumb" in n
        or n.startswith("index")
        or n.startswith("middle")
        or n.startswith("ring")
        or n.startswith("pinky")
    )


def should_skip_drive(anny_name: str, *, drive_feet: bool, drive_hands: bool, body_only: bool) -> bool:
    """Filter which mapped joints get BVH motion. Fingers/toes still body-only skipped."""
    if body_only and is_extremity_bone(anny_name):
        return True
    # foot.L/R are not extremity_bone; drive unless --no-drive-feet
    if anny_name in ("foot.L", "foot.R"):
        return not drive_feet
    if anny_name.startswith("toe"):
        return not drive_feet  # toes only if feet driven and not body_only
    if anny_name in ("wrist.L", "wrist.R") or anny_name in DEFAULT_SKIP_DRIVE:
        return not drive_hands
    return False


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_obj(path: str) -> bpy.types.Object:
    bpy.ops.wm.obj_import(filepath=path) if hasattr(bpy.ops.wm, "obj_import") else bpy.ops.import_scene.obj(filepath=path)
    meshes = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    if not meshes:
        meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("No mesh after OBJ import")
    return meshes[0]


def snap_rest_bones_to_mesh(rest: Dict[str, Any], mesh: bpy.types.Object) -> Dict[str, Any]:
    """
    Shift annyBones/runtimeBones so joint heads sit in the skinned mesh.
    Anny rest export often leaves bones ~0.29 m (~11–12\") above skin centroids.
    """
    full = rest.get("fullSkinning") or {}
    names = full.get("boneNames") or [b["name"] for b in rest.get("annyBones") or []]
    indices = full.get("vertexBoneIndices")
    weights = full.get("vertexBoneWeights")
    bones = rest.get("annyBones") or []
    if not bones or not indices or not weights:
        return {"applied": False, "reason": "missing_bones_or_fullSkinning"}

    # Prefer mesh evaluated verts (OBJ local)
    mesh_verts = [(float(v.co.x), float(v.co.y), float(v.co.z)) for v in mesh.data.vertices]
    if len(mesh_verts) != len(indices):
        return {
            "applied": False,
            "reason": "vertex_count_mismatch",
            "meshV": len(mesh_verts),
            "skinV": len(indices),
        }

    # Inline median snap (keep Blender script dependency-light)
    dys: List[float] = []
    dxs: List[float] = []
    dzs: List[float] = []
    name_to_bone = {b["name"]: b for b in bones}
    for bi, bname in enumerate(names):
        b = name_to_bone.get(bname)
        if not b:
            continue
        pts: List[Tuple[float, float, float]] = []
        for vi, (ii, ww) in enumerate(zip(indices, weights)):
            for j, raw in enumerate(ii):
                if int(raw) == bi and float(ww[j]) >= 0.4:
                    pts.append(mesh_verts[vi])
                    break
        if len(pts) < 8:
            continue
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        cz = sum(p[2] for p in pts) / len(pts)
        h = b["head"]
        dxs.append(float(h[0]) - cx)
        dys.append(float(h[1]) - cy)
        dzs.append(float(h[2]) - cz)

    if len(dys) < 4:
        return {"applied": False, "reason": "insufficient_skin_samples", "n": len(dys)}

    def med(vals: List[float]) -> float:
        s = sorted(vals)
        return s[len(s) // 2]

    ox, oy, oz = med(dxs), med(dys), med(dzs)
    # Only correct large vertical bind error (ignore noise < 2 cm)
    if abs(oy) < 0.02 and abs(ox) < 0.02 and abs(oz) < 0.02:
        return {"applied": False, "reason": "offset_below_threshold", "offset": [ox, oy, oz]}

    for group in (rest.get("annyBones") or [], rest.get("runtimeBones") or []):
        for b in group:
            for key in ("head", "tail"):
                p = b.get(key)
                if not p or len(p) < 3:
                    continue
                b[key] = [
                    round(float(p[0]) - ox, 6),
                    round(float(p[1]) - oy, 6),
                    round(float(p[2]) - oz, 6),
                ]
    # Landmarks if present
    lm = rest.get("bindLandmarks") or {}
    if isinstance(lm, dict):
        for k, p in list(lm.items()):
            if isinstance(p, (list, tuple)) and len(p) >= 3:
                lm[k] = [
                    round(float(p[0]) - ox, 6),
                    round(float(p[1]) - oy, 6),
                    round(float(p[2]) - oz, 6),
                ]
        rest["bindLandmarks"] = lm

    rest["bindSnap"] = {
        "offset": [ox, oy, oz],
        "offsetYInches": round(oy * 39.3701, 2),
        "sampleBones": len(dys),
        "method": "median_bone_minus_skinned_centroid",
        "appliedIn": "apply_bvh_to_anny_full.snap_rest_bones_to_mesh",
    }
    return {"applied": True, **rest["bindSnap"]}


def detect_map(bvh_path: str, forced: str) -> Tuple[str, Dict[str, str]]:
    if forced != "auto":
        return forced, {"cmu": MAP_CMU, "mblab": MAP_MBLAB, "bandai": MAP_BANDAI}[forced]
    text = open(bvh_path, "r", errors="ignore").read(4000)
    if "LeftUpLeg" in text or "LHipJoint" in text:
        return "cmu", MAP_CMU
    if "upperarm_L" in text or "thigh_L" in text:
        return "mblab", MAP_MBLAB
    if "joint_Root" in text or "UpperArm_L" in text or ("Hips" in text and "Chest" in text):
        return "bandai", MAP_BANDAI
    # default try mblab then cmu
    return "mblab", MAP_MBLAB


def build_full_anny_armature(rest: Dict[str, Any]) -> bpy.types.Object:
    bones_data = rest.get("annyBones") or []
    if not bones_data:
        raise RuntimeError("rest skeleton missing annyBones")
    arm_data = bpy.data.armatures.new("anny_full_mh_armature")
    arm_obj = bpy.data.objects.new("anny_full_mh_armature", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones
    created: Dict[str, Any] = {}
    for b in bones_data:
        name = b["name"]
        head = b["head"]
        tail = b["tail"]
        bone = eb.new(name)
        bone.head = Vector((float(head[0]), float(head[1]), float(head[2])))
        bone.tail = Vector((float(tail[0]), float(tail[1]), float(tail[2])))
        if (bone.tail - bone.head).length < 1e-4:
            bone.tail = bone.head + Vector((0, 0.03, 0))
        created[name] = bone
    for b in bones_data:
        name = b["name"]
        parent = b.get("parent")
        if parent and parent in created and name in created:
            created[name].parent = created[parent]
            created[name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def apply_full_skinning(mesh: bpy.types.Object, arm: bpy.types.Object, rest: Dict[str, Any]) -> Dict[str, Any]:
    full = rest.get("fullSkinning") or {}
    names = full.get("boneNames") or [b["name"] for b in rest.get("annyBones") or []]
    indices = full.get("vertexBoneIndices")
    weights = full.get("vertexBoneWeights")
    vcount = len(mesh.data.vertices)
    if not indices or len(indices) != vcount:
        return {"applied": False, "reason": "missing_fullSkinning_or_vertex_mismatch", "meshV": vcount}

    # Ensure mesh and armature share origin in mesh-local Y-up space.
    bpy.context.view_layer.update()
    arm.matrix_world = Matrix.Identity(4)
    mesh.matrix_world = Matrix.Identity(4)

    if not any(m.type == "ARMATURE" and m.object == arm for m in mesh.modifiers):
        mod = mesh.modifiers.new("anny_full_armature", "ARMATURE")
        mod.object = arm
    mesh.parent = arm
    # Correct parent inverse so mesh stays put after parenting.
    mesh.matrix_parent_inverse = arm.matrix_world.inverted() @ mesh.matrix_world

    while mesh.vertex_groups:
        mesh.vertex_groups.remove(mesh.vertex_groups[0])
    groups = {n: mesh.vertex_groups.new(name=n) for n in names}

    for vi in range(vcount):
        for bi, bw in zip(indices[vi], weights[vi]):
            bi = int(bi)
            bw = float(bw)
            if bw <= 1e-8 or bi < 0 or bi >= len(names):
                continue
            groups[names[bi]].add([vi], bw, "REPLACE")
    return {"applied": True, "boneCount": len(names), "vertexCount": vcount}


def _rest_matrix_arm(arm: bpy.types.Object, pb: bpy.types.PoseBone) -> Matrix:
    """Bind-rest bone matrix in armature space (edit bone), independent of pose/action."""
    return pb.bone.matrix_local.copy()


def _rest_world_quat(arm: bpy.types.Object, pb: bpy.types.PoseBone) -> Quaternion:
    return (arm.matrix_world @ _rest_matrix_arm(arm, pb)).to_quaternion().normalized()


def _rest_parent_world_quat(arm: bpy.types.Object, pb: bpy.types.PoseBone) -> Quaternion:
    if pb.parent:
        return _rest_world_quat(arm, pb.parent)
    return arm.matrix_world.to_quaternion().normalized()


def align_bvh_to_anny(
    bvh_arm: bpy.types.Object,
    anny_arm: bpy.types.Object,
    pairs: List[Tuple[str, str]],
) -> Dict[str, Any]:
    """Place BVH armature so its *bind* root matches Anny root (translation only)."""
    if not pairs:
        return {"aligned": False}
    anny_root_name, bvh_root_name = pairs[0]
    bpy.context.view_layer.update()
    apb = anny_arm.pose.bones.get(anny_root_name)
    bpb = bvh_arm.pose.bones.get(bvh_root_name)
    if not apb or not bpb:
        return {"aligned": False, "reason": "missing_root"}
    # Use edit-bone rest so frame-1 pose / layered-action state cannot bias hips.
    anny_w = anny_arm.matrix_world @ _rest_matrix_arm(anny_arm, apb)
    bvh_w = bvh_arm.matrix_world @ _rest_matrix_arm(bvh_arm, bpb)
    delta = anny_w.to_translation() - bvh_w.to_translation()
    bvh_arm.location = bvh_arm.location + delta
    bpy.context.view_layer.update()
    return {
        "aligned": True,
        "delta": [float(delta.x), float(delta.y), float(delta.z)],
        "annyRoot": anny_root_name,
        "bvhRoot": bvh_root_name,
    }


def import_bvh(path: str, scale: float, fps: int) -> bpy.types.Object:
    # Blender 3/4/5 BVH import
    try:
        bpy.ops.import_anim.bvh(
            filepath=path,
            global_scale=scale,
            frame_start=1,
            use_fps_scale=True,
            update_scene_fps=True,
            update_scene_duration=True,
            axis_forward="-Z",
            axis_up="Y",
        )
    except TypeError:
        bpy.ops.import_anim.bvh(filepath=path, global_scale=scale)
    arms = [o for o in bpy.context.selected_objects if o.type == "ARMATURE"]
    if not arms:
        arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE" and o.name != "anny_full_mh_armature"]
    if not arms:
        raise RuntimeError(f"BVH import produced no armature: {path}")
    return arms[-1]


def strip_prefix(name: str) -> str:
    if ":" in name:
        return name.split(":", 1)[1]
    return name


def map_bvh_to_anny(bvh_arm: bpy.types.Object, anny_arm: bpy.types.Object, joint_map: Dict[str, str]) -> List[Tuple[str, str]]:
    """Return list of (anny_bone, bvh_bone) pairs that exist on both (one source per Anny bone)."""
    bvh_names = {strip_prefix(b.name): b.name for b in bvh_arm.pose.bones}
    for b in bvh_arm.pose.bones:
        bvh_names[b.name] = b.name
    pairs: List[Tuple[str, str]] = []
    used_anny: set = set()
    anny_set = {b.name for b in anny_arm.pose.bones}
    for bvh_key, anny_name in joint_map.items():
        if anny_name not in anny_set or anny_name in used_anny:
            continue
        src = bvh_names.get(bvh_key) or bvh_names.get(bvh_key.replace("_", ""))
        if not src:
            for k, v in bvh_names.items():
                if k.lower() == bvh_key.lower():
                    src = v
                    break
        if src:
            pairs.append((anny_name, src))
            used_anny.add(anny_name)
    return pairs


def _world_quat(arm: bpy.types.Object, pb: bpy.types.PoseBone) -> Quaternion:
    return (arm.matrix_world @ pb.matrix).to_quaternion().normalized()


def _parent_world_quat(arm: bpy.types.Object, pb: bpy.types.PoseBone) -> Quaternion:
    if pb.parent:
        return _world_quat(arm, pb.parent)
    return arm.matrix_world.to_quaternion().normalized()


def _set_world_rotation_basis_only(
    arm: bpy.types.Object,
    pb: bpy.types.PoseBone,
    world_q: Quaternion,
) -> None:
    """
    Set pose-bone world orientation via *rotation_quaternion only* (location=0).

    Prior keep-length `pb.matrix = ...` decomposed into non-zero matrix_basis
    translations on unconnected MH bones; keyframing those locations crumpled LBS
    on playback. Solving for matrix_basis rotation against the current parent pose
    preserves bone lengths through the rest hierarchy without location channels.
    """
    pb.rotation_mode = "QUATERNION"
    pb.location = Vector((0.0, 0.0, 0.0))
    pb.scale = Vector((1.0, 1.0, 1.0))

    R_arm = (arm.matrix_world.to_quaternion().inverted() @ world_q).normalized().to_matrix()
    bone_rest = pb.bone.matrix_local
    if pb.parent:
        # pose = parent_pose @ inv(parent_rest) @ bone_rest @ basis
        # basis_R = inv(parent_pose @ inv(parent_rest) @ bone_rest) @ R_arm
        parent_pose = pb.parent.matrix
        parent_rest = pb.parent.bone.matrix_local
        M = parent_pose @ parent_rest.inverted() @ bone_rest
        R_basis = M.to_3x3().inverted() @ R_arm
    else:
        R_basis = bone_rest.to_3x3().inverted() @ R_arm
    pb.rotation_quaternion = R_basis.to_quaternion().normalized()


def _rest_bone_y_world(arm: bpy.types.Object, bone_name: str) -> Optional[Vector]:
    pb = arm.pose.bones.get(bone_name)
    if not pb:
        return None
    M = arm.matrix_world @ pb.bone.matrix_local
    return (M.to_3x3() @ Vector((0, 1, 0))).normalized()


def _rest_bone_z_world(arm: bpy.types.Object, bone_name: str) -> Optional[Vector]:
    pb = arm.pose.bones.get(bone_name)
    if not pb:
        return None
    M = arm.matrix_world @ pb.bone.matrix_local
    return (M.to_3x3() @ Vector((0, 0, 1))).normalized()


def align_bvh_limb_frame_to_anny(
    bvh_arm: bpy.types.Object,
    anny_arm: bpy.types.Object,
    pairs: List[Tuple[str, str]],
) -> Dict[str, Any]:
    """
    Object-level rotate BVH so mean rest limb directions match Anny.

    Roll-only cannot fix ~90° bone-Y mismatches (MB-Lab legs often rest along
    a different world axis than Anny after BVH import). MB-Lab's own engine
    rotates the source skeleton to align spine/shoulders; we extend that to
    thigh/calf mean bone-Y so parent-local deltas land on the right hinge plane.
    """
    name_to_bvh = {a: b for a, b in pairs}
    limb_pairs = [
        ("upperleg01.L", "upperleg01.R"),
        ("lowerleg01.L", "lowerleg01.R"),
        ("upperarm01.L", "upperarm01.R"),
    ]
    a_vecs: List[Vector] = []
    b_vecs: List[Vector] = []
    for left, right in limb_pairs:
        for n in (left, right):
            bn = name_to_bvh.get(n)
            if not bn:
                continue
            ay = _rest_bone_y_world(anny_arm, n)
            by = _rest_bone_y_world(bvh_arm, bn)
            if ay is not None and by is not None:
                a_vecs.append(ay)
                b_vecs.append(by)
    if len(a_vecs) < 2:
        return {"limbFrameAligned": False, "reason": "insufficient_limb_bones"}

    a_mean = Vector((0.0, 0.0, 0.0))
    b_mean = Vector((0.0, 0.0, 0.0))
    for v in a_vecs:
        a_mean += v
    for v in b_vecs:
        b_mean += v
    a_mean /= float(len(a_vecs))
    b_mean /= float(len(b_vecs))
    if a_mean.length < 1e-6 or b_mean.length < 1e-6:
        return {"limbFrameAligned": False, "reason": "degenerate_mean"}
    a_mean.normalize()
    b_mean.normalize()

    # Rotation taking b_mean → a_mean
    dot = max(-1.0, min(1.0, b_mean.dot(a_mean)))
    ang = math.acos(dot)
    if ang < math.radians(0.5):
        return {"limbFrameAligned": True, "angleDeg": 0.0, "skipped": "already_aligned"}
    if ang > math.radians(179.0):
        # 180° flip: pick a stable perpendicular axis
        axis = b_mean.cross(Vector((1, 0, 0)))
        if axis.length < 1e-4:
            axis = b_mean.cross(Vector((0, 0, 1)))
        axis.normalize()
    else:
        axis = b_mean.cross(a_mean).normalized()

    # Pivot about BVH root rest head
    root_bvh = pairs[0][1] if pairs else None
    pivot = Vector((0, 0, 0))
    if root_bvh:
        pb = bvh_arm.pose.bones.get(root_bvh)
        if pb:
            pivot = (bvh_arm.matrix_world @ pb.bone.matrix_local).to_translation().copy()

    R = Matrix.Rotation(ang, 4, axis)
    T1 = Matrix.Translation(-pivot)
    T2 = Matrix.Translation(pivot)
    bvh_arm.matrix_world = T2 @ R @ T1 @ bvh_arm.matrix_world
    bpy.context.view_layer.update()
    return {
        "limbFrameAligned": True,
        "angleDeg": round(math.degrees(ang), 2),
        "axis": [round(v, 4) for v in axis],
        "method": "mean_limb_bone_y",
        "samples": len(a_vecs),
    }


def _shortest_quat_delta(q0: Quaternion, q1: Quaternion) -> Quaternion:
    """Body-fixed delta inv(q0)*q1 on the short arc (avoid 360° flips)."""
    d = (q0.inverted() @ q1).normalized()
    if d.w < 0.0:
        d = Quaternion((-d.w, -d.x, -d.y, -d.z)).normalized()
    return d


def align_anny_rolls_to_bvh(
    anny_arm: bpy.types.Object,
    bvh_arm: bpy.types.Object,
    pairs: List[Tuple[str, str]],
) -> Dict[str, Any]:
    """
    MB-Lab RetargetEngine.align_bones_z_axis + mid-chain propagation.

    1) Re-roll mapped Anny edit bones so rest Z matches BVH rest Z (world).
    2) Propagate roll to unmapped mid-bones (*02, neck01, …) by inheriting the
       nearest mapped ancestor's rest Z (stops LBS twist between rolled joints).

    Must run *before* skinning so bind pose uses the new matrix_local.
    Head/tail (limb direction) stay put; only roll changes.
    """
    z_world_by_anny: Dict[str, Vector] = {}
    for anny_name, bvh_name in pairs:
        bpb = bvh_arm.pose.bones.get(bvh_name)
        apb = anny_arm.pose.bones.get(anny_name)
        if not bpb or not apb:
            continue
        z_bvh_arm = Vector(bpb.bone.z_axis).normalized()
        z_world = (bvh_arm.matrix_world.to_3x3() @ z_bvh_arm).normalized()
        z_world_by_anny[anny_name] = z_world

    if not z_world_by_anny:
        return {"rolled": 0, "reason": "no_pairs"}

    mapped = set(z_world_by_anny.keys())

    bpy.context.view_layer.objects.active = anny_arm
    try:
        bpy.ops.object.mode_set(mode="OBJECT")
    except Exception:
        pass
    bpy.ops.object.mode_set(mode="EDIT")
    rolled: List[Dict[str, Any]] = []
    mid_rolled: List[str] = []
    anny_mw_inv = anny_arm.matrix_world.inverted().to_3x3()

    # Pass 1: mapped bones → BVH rest Z
    for anny_name, z_world in z_world_by_anny.items():
        eb = anny_arm.data.edit_bones.get(anny_name)
        if not eb:
            continue
        z_anny_arm = (anny_mw_inv @ z_world).normalized()
        before = float(eb.roll)
        eb.align_roll(z_anny_arm)
        rolled.append(
            {
                "bone": anny_name,
                "kind": "mapped",
                "rollBefore": round(before, 4),
                "rollAfter": round(float(eb.roll), 4),
                "rollDeltaDeg": round(math.degrees(float(eb.roll) - before), 2),
            }
        )

    # Pass 2: mid-chain — topological order, inherit nearest mapped ancestor Z
    # Build parent map from edit bones
    children: Dict[str, List[str]] = {}
    roots: List[str] = []
    for eb in anny_arm.data.edit_bones:
        if eb.parent:
            children.setdefault(eb.parent.name, []).append(eb.name)
        else:
            roots.append(eb.name)

    # Nearest mapped ancestor roll target (world Z of that mapped bone after pass1)
    def mapped_ancestor_z(name: str) -> Optional[Vector]:
        eb = anny_arm.data.edit_bones.get(name)
        while eb and eb.parent:
            eb = eb.parent
            if eb.name in mapped:
                # After align_roll, bone.z_axis is updated in edit mode
                return (anny_arm.matrix_world.to_3x3() @ Vector(eb.z_axis)).normalized()
        return None

    # BFS from roots
    queue = list(roots)
    while queue:
        name = queue.pop(0)
        for ch in children.get(name, []):
            queue.append(ch)
        if name in mapped:
            continue
        eb = anny_arm.data.edit_bones.get(name)
        if not eb:
            continue
        # Only mid-chain on driven limbs (has mapped descendant or mapped ancestor)
        has_mapped_anc = mapped_ancestor_z(name) is not None
        # mapped descendant?
        def has_mapped_desc(n: str) -> bool:
            for c in children.get(n, []):
                if c in mapped or has_mapped_desc(c):
                    return True
            return False

        if not (has_mapped_anc and has_mapped_desc(name)):
            continue
        z_w = mapped_ancestor_z(name)
        if z_w is None:
            continue
        z_anny_arm = (anny_mw_inv @ z_w).normalized()
        before = float(eb.roll)
        eb.align_roll(z_anny_arm)
        mid_rolled.append(name)
        rolled.append(
            {
                "bone": name,
                "kind": "mid_chain",
                "rollBefore": round(before, 4),
                "rollAfter": round(float(eb.roll), 4),
                "rollDeltaDeg": round(math.degrees(float(eb.roll) - before), 2),
            }
        )

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    deltas = [abs(r["rollDeltaDeg"]) for r in rolled]
    mean_abs = round(sum(deltas) / len(deltas), 2) if deltas else 0.0
    print(
        f"[bvh] roll-align mapped={len(mapped)} mid={len(mid_rolled)} "
        f"total={len(rolled)} mean_abs_delta_deg={mean_abs}"
    )
    return {
        "rolled": len(rolled),
        "mappedRolled": len(mapped),
        "midChainRolled": len(mid_rolled),
        "meanAbsRollDeltaDeg": mean_abs,
        "maxAbsRollDeltaDeg": round(max(deltas), 2) if deltas else 0.0,
        "midBones": mid_rolled[:24],
        "sample": rolled[:16],
        "method": "align_roll_mapped_plus_mid_chain",
    }


def filter_drive_pairs(
    pairs: List[Tuple[str, str]],
    *,
    drive_feet: bool,
    drive_hands: bool,
    body_only: bool,
) -> List[Tuple[str, str]]:
    return [
        (a, b)
        for a, b in pairs
        if not should_skip_drive(a, drive_feet=drive_feet, drive_hands=drive_hands, body_only=body_only)
    ]


def _align_bvh_facing_to_anny(
    bvh_arm: bpy.types.Object,
    anny_arm: bpy.types.Object,
    pairs: List[Tuple[str, str]],
) -> Dict[str, Any]:
    """
    Yaw-align BVH to Anny using hips→head + shoulder vectors (MB-Lab-style idea,
    translation-only was not enough when rest bone axes differ by ~70–130°).
    """
    name_a = {a: b for a, b in pairs}
    def rest_head(arm, name):
        pb = arm.pose.bones.get(name)
        if not pb:
            return None
        return (arm.matrix_world @ _rest_matrix_arm(arm, pb)).to_translation()

    # Prefer root/pelvis + head; fall back to spine
    a_hip = rest_head(anny_arm, "root") or rest_head(anny_arm, "spine05")
    b_hip_n = name_a.get("root") or name_a.get("spine05")
    b_hip = rest_head(bvh_arm, b_hip_n) if b_hip_n else None
    a_head = rest_head(anny_arm, "head") or rest_head(anny_arm, "neck02")
    b_head_n = name_a.get("head") or name_a.get("neck02")
    b_head = rest_head(bvh_arm, b_head_n) if b_head_n else None
    if not (a_hip and b_hip and a_head and b_head):
        return {"facingAligned": False, "reason": "missing_spine_markers"}

    def horiz(v: Vector) -> Vector:
        h = Vector((v.x, 0.0, v.z))
        return h.normalized() if h.length > 1e-6 else Vector((0, 0, 1))

    # Up-axis of character in XZ (Y-up world): use hip→head projected? better: shoulder line.
    a_cl = rest_head(anny_arm, "clavicle.L") or rest_head(anny_arm, "upperarm01.L")
    a_cr = rest_head(anny_arm, "clavicle.R") or rest_head(anny_arm, "upperarm01.R")
    b_cl_n = name_a.get("clavicle.L") or name_a.get("upperarm01.L")
    b_cr_n = name_a.get("clavicle.R") or name_a.get("upperarm01.R")
    b_cl = rest_head(bvh_arm, b_cl_n) if b_cl_n else None
    b_cr = rest_head(bvh_arm, b_cr_n) if b_cr_n else None

    if a_cl and a_cr and b_cl and b_cr:
        a_sh = horiz(a_cr - a_cl)
        b_sh = horiz(b_cr - b_cl)
    else:
        # Fall back: facing from spine lean in XZ is weak; use identity.
        return {"facingAligned": False, "reason": "missing_shoulders"}

    # Angle from b_sh to a_sh around +Y
    cross = b_sh.x * a_sh.z - b_sh.z * a_sh.x
    dot = max(-1.0, min(1.0, b_sh.dot(a_sh)))
    ang = math.atan2(cross, dot)
    # Rotate BVH object around world Y through its hip
    R = Matrix.Rotation(ang, 4, "Y")
    # Keep hip world position stable
    hip_before = b_hip.copy()
    bvh_arm.matrix_world = R @ bvh_arm.matrix_world
    bpy.context.view_layer.update()
    hip_after = rest_head(bvh_arm, b_hip_n)
    if hip_after is not None:
        bvh_arm.location += hip_before - hip_after
        bpy.context.view_layer.update()
    return {
        "facingAligned": True,
        "yawDeg": round(math.degrees(ang), 2),
        "method": "shoulder_line_xz",
    }


def _iter_action_fcurves(action: bpy.types.Action):
    """
    Yield fcurves from either the legacy `action.fcurves` or Blender-5 *layered* actions
    (`action.layers[].strips[].channelbags[].fcurves`). Legacy `.fcurves` is empty under
    layered actions, which silently zeroed the keyframe count / interpolation / fingerprint.
    """
    fcs = getattr(action, "fcurves", None)
    if fcs is not None and len(fcs) > 0:
        for fc in fcs:
            yield fc
        return
    layers = getattr(action, "layers", None) or []
    for layer in layers:
        for strip in getattr(layer, "strips", []) or []:
            for cb in getattr(strip, "channelbags", []) or []:
                for fc in getattr(cb, "fcurves", []) or []:
                    yield fc


def _bone_world_head(arm: bpy.types.Object, name: str) -> Optional[Vector]:
    pb = arm.pose.bones.get(name)
    if not pb:
        return None
    return (arm.matrix_world @ pb.matrix).to_translation()


def _evaluated_mesh_world_bbox(mesh: bpy.types.Object) -> Optional[Tuple[Vector, Vector]]:
    """World-space AABB of the *deformed* (armature-evaluated) mesh at the current frame."""
    deps = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(deps)
    me = ev.to_mesh()
    try:
        if not me.vertices:
            return None
        mw = mesh.matrix_world
        first = mw @ me.vertices[0].co
        lo = Vector(first)
        hi = Vector(first)
        for v in me.vertices:
            w = mw @ v.co
            lo.x, lo.y, lo.z = min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)
            hi.x, hi.y, hi.z = max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)
        return (lo, hi)
    finally:
        ev.to_mesh_clear()


def _bbox_max_dim(bbox: Tuple[Vector, Vector]) -> float:
    d = bbox[1] - bbox[0]
    return max(d.x, d.y, d.z)


def _spine_lean_deg(arm: bpy.types.Object, root_name: str) -> float:
    """Angle of the pelvis->head vector from world +Y. Upright walk ~small; hunch ~large."""
    p = _bone_world_head(arm, root_name)
    h = _bone_world_head(arm, "head")
    if p is None or h is None:
        return 0.0
    d = h - p
    if d.length < 1e-6:
        return 0.0
    try:
        return math.degrees(d.normalized().angle(Vector((0.0, 1.0, 0.0))))
    except Exception:
        return 0.0


def retarget_and_bake(
    anny_arm: bpy.types.Object,
    bvh_arm: bpy.types.Object,
    pairs: List[Tuple[str, str]],
    action_name: str,
    *,
    mesh: Optional[bpy.types.Object] = None,
    rest_max_dim: float = 0.0,
    root_motion: bool = True,
    root_yaw_only: bool = False,
) -> Dict[str, Any]:
    """
    Parent-local body-fixed deltas after MB-Lab-style roll align.

    Assumes Anny mapped bones were re-rolled so rest Z ≈ BVH rest Z
    (see align_anny_rolls_to_bvh). Then:

      L_b0 / L_a0 from edit-bone parent-local at bind
      D   = inv(L_b0) · L_b(t)
      L_a = L_a0 · D
      R_a = R_ap_current · L_a

    Rotation-only matrix_basis apply (no limb location keys).
    """
    bpy.context.view_layer.objects.active = anny_arm
    bpy.ops.object.mode_set(mode="POSE")

    for pb in anny_arm.pose.bones:
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion((1, 0, 0, 0))
        pb.location = Vector((0, 0, 0))
        pb.scale = Vector((1, 1, 1))

    scene = bpy.context.scene
    frame_start, frame_end = 1, 60
    if bvh_arm.animation_data and bvh_arm.animation_data.action:
        act = bvh_arm.animation_data.action
        try:
            frame_start = int(act.frame_range[0])
            frame_end = int(act.frame_range[1])
        except Exception:
            pass
    frame_end = min(frame_end, frame_start + 240)
    scene.frame_start = frame_start
    scene.frame_end = max(frame_end, frame_start + 1)

    root_name = pairs[0][0] if pairs else "root"

    # Match BVH object frame to Anny (hips / facing / limb-Y), then sample.
    # Anny rolls were already fixed at bind; BVH object still needs per-clip align.
    align_info = align_bvh_to_anny(bvh_arm, anny_arm, pairs)
    face_info = _align_bvh_facing_to_anny(bvh_arm, anny_arm, pairs)
    align_bvh_to_anny(bvh_arm, anny_arm, pairs)
    limb_info = align_bvh_limb_frame_to_anny(bvh_arm, anny_arm, pairs)
    align_info2 = align_bvh_to_anny(bvh_arm, anny_arm, pairs)
    print(f"[bvh] align={align_info} face={face_info} limb={limb_info} realign={align_info2}")
    bpy.context.view_layer.update()

    rest_L_a0: Dict[str, Quaternion] = {}
    rest_L_b0: Dict[str, Quaternion] = {}
    rest_bvh_root_loc = Vector((0, 0, 0))

    for anny_name, bvh_name in pairs:
        apb = anny_arm.pose.bones.get(anny_name)
        bpb = bvh_arm.pose.bones.get(bvh_name)
        if not apb or not bpb:
            continue
        Ra = _rest_world_quat(anny_arm, apb)
        Rb = _rest_world_quat(bvh_arm, bpb)
        Rap = _rest_parent_world_quat(anny_arm, apb)
        Rbp = _rest_parent_world_quat(bvh_arm, bpb)
        rest_L_a0[anny_name] = (Rap.inverted() @ Ra).normalized()
        rest_L_b0[bvh_name] = (Rbp.inverted() @ Rb).normalized()

    if pairs:
        bpb0 = bvh_arm.pose.bones.get(pairs[0][1])
        if bpb0:
            rest_bvh_root_loc = (
                bvh_arm.matrix_world @ _rest_matrix_arm(bvh_arm, bpb0)
            ).to_translation().copy()

    if bvh_arm.animation_data and bvh_arm.animation_data.action:
        ad = bvh_arm.animation_data
        if getattr(ad, "action_slot", None) is None:
            suitable = list(getattr(ad, "action_suitable_slots", []) or [])
            if suitable:
                ad.action_slot = suitable[0]
                print(f"[bvh] rebound action_slot={ad.action_slot.name}")
    bpy.context.view_layer.update()

    depth: Dict[str, int] = {}

    def bone_depth(name: str) -> int:
        if name in depth:
            return depth[name]
        pb = anny_arm.pose.bones.get(name)
        if not pb or not pb.parent:
            depth[name] = 0
        else:
            depth[name] = bone_depth(pb.parent.name) + 1
        return depth[name]

    ordered_pairs = sorted(
        [(a, b) for a, b in pairs if a in rest_L_a0 and b in rest_L_b0],
        key=lambda ab: bone_depth(ab[0]),
    )

    anny_arm.animation_data_create()
    action = bpy.data.actions.new(action_name)
    anny_arm.animation_data.action = action

    bpy.ops.object.mode_set(mode="POSE")
    max_delta_deg = 0.0
    per_bone_delta: Dict[str, float] = {}
    anim_max_dim = 0.0
    spine_lean_max = 0.0
    # Sample the evaluated (deformed) mesh bbox + spine lean at a few frames spread
    # across the clip: cheap explosion / hunch detection without per-frame evaluation cost.
    _span = max(1, frame_end - frame_start)
    sample_frames = {frame_start + round(_span * t) for t in (0.0, 0.25, 0.5, 0.75, 1.0)}
    sample_bone = ordered_pairs[1][0] if len(ordered_pairs) > 1 else (ordered_pairs[0][0] if ordered_pairs else "")
    for f in range(frame_start, frame_end + 1):
        scene.frame_set(f)
        bpy.context.view_layer.update()

        for anny_name, bvh_name in ordered_pairs:
            apb = anny_arm.pose.bones.get(anny_name)
            bpb = bvh_arm.pose.bones.get(bvh_name)
            if not apb or not bpb:
                continue

            R_b = _world_quat(bvh_arm, bpb)
            R_bp = _parent_world_quat(bvh_arm, bpb)
            L_b = (R_bp.inverted() @ R_b).normalized()
            L_b0 = rest_L_b0[bvh_name]
            L_a0 = rest_L_a0[anny_name]
            D = _shortest_quat_delta(L_b0, L_b)
            if anny_name == root_name and root_yaw_only:
                # Some sources (CMU) drive a spurious pelvis pitch/roll that dives the whole
                # body forward. Keep only the yaw (turning) component of the root delta so the
                # pelvis stays upright and the walk lean comes from the spine, not the hips.
                de = D.to_euler("YXZ")
                de.x = 0.0
                de.z = 0.0
                D = de.to_quaternion()
            try:
                deg = float(D.angle) * 180.0 / math.pi
                max_delta_deg = max(max_delta_deg, deg)
                per_bone_delta[anny_name] = max(per_bone_delta.get(anny_name, 0.0), deg)
            except Exception:
                pass
            L_a = (L_a0 @ D).normalized()
            R_ap = _parent_world_quat(anny_arm, apb)
            R_desired = (R_ap @ L_a).normalized()

            _set_world_rotation_basis_only(anny_arm, apb, R_desired)

            if anny_name == root_name and root_motion:
                bvh_loc = (bvh_arm.matrix_world @ bpb.matrix).to_translation()
                apb.location = bvh_loc - rest_bvh_root_loc
            else:
                apb.location = Vector((0.0, 0.0, 0.0))

            apb.keyframe_insert(data_path="rotation_quaternion", frame=f)
            if anny_name == root_name:
                apb.keyframe_insert(data_path="location", frame=f)

            bpy.context.view_layer.update()

        if f in sample_frames:
            bbox = _evaluated_mesh_world_bbox(mesh) if mesh is not None else None
            if bbox is not None:
                anim_max_dim = max(anim_max_dim, _bbox_max_dim(bbox))
            spine_lean_max = max(spine_lean_max, _spine_lean_deg(anny_arm, root_name))

    fcurve_count = 0
    for fc in _iter_action_fcurves(action):
        fcurve_count += 1
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"

    track = anny_arm.animation_data.nla_tracks.new()
    track.name = action_name
    track.strips.new(action_name, frame_start, action)
    anny_arm.animation_data.action = None

    thigh_swing = max(
        per_bone_delta.get("upperleg01.L", 0.0),
        per_bone_delta.get("upperleg01.R", 0.0),
    )
    mean_delta = (sum(per_bone_delta.values()) / len(per_bone_delta)) if per_bone_delta else 0.0
    explode_ratio = (anim_max_dim / rest_max_dim) if rest_max_dim > 1e-6 else 0.0
    metrics = {
        "action": action_name,
        "frames": [frame_start, frame_end],
        "mappedPairs": len(ordered_pairs),
        "keyedBones": len(per_bone_delta),
        "fcurveCount": fcurve_count,
        "maxJointDeltaDeg": round(max_delta_deg, 3),
        "meanJointDeltaDeg": round(mean_delta, 3),
        "thighSwingDeg": round(thigh_swing, 3),
        "perBoneDeltaDeg": {k: round(v, 2) for k, v in sorted(per_bone_delta.items())},
        "animatedMaxDimM": round(anim_max_dim, 4),
        "explodeRatio": round(explode_ratio, 3),
        "spineLeanDeg": round(spine_lean_max, 2),
        "rootMotion": root_motion,
        "sampleBone": sample_bone,
    }
    print(
        f"[bvh] baked {action_name} method=parent_local_after_full_align "
        f"frames={frame_start}..{frame_end} pairs={len(ordered_pairs)} "
        f"root_motion={root_motion} max_joint_delta_deg={max_delta_deg:.1f} "
        f"thigh_swing_deg={thigh_swing:.1f} explode_ratio={explode_ratio:.2f} "
        f"spine_lean_deg={spine_lean_max:.1f} sample={sample_bone}"
    )
    return metrics


def export_glb(path: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    # Ensure object mode for export operators
    try:
        bpy.ops.object.mode_set(mode="OBJECT")
    except Exception:
        pass
    # Remove BVH source armatures (keep Anny full rig only)
    to_remove = [
        o
        for o in list(bpy.context.scene.objects)
        if o.type == "ARMATURE" and o.name != "anny_full_mh_armature"
    ]
    for o in to_remove:
        bpy.data.objects.remove(o, do_unlink=True)

    # Drop orphan unnamed actions so glTF does not ship Action / Action.001 noise.
    arm = bpy.data.objects.get("anny_full_mh_armature")
    keep_action_names = set()
    if arm and arm.animation_data:
        for track in arm.animation_data.nla_tracks:
            for strip in track.strips:
                if strip.action:
                    keep_action_names.add(strip.action.name)
        arm.animation_data.action = None
    for act in list(bpy.data.actions):
        if act.name not in keep_action_names:
            bpy.data.actions.remove(act)

    # Ensure an active object
    if arm:
        bpy.context.view_layer.objects.active = arm
        # Rest pose for bind.
        bpy.ops.object.mode_set(mode="POSE")
        bpy.ops.pose.select_all(action="SELECT")
        bpy.ops.pose.transforms_clear()
        bpy.ops.object.mode_set(mode="OBJECT")
    # Mesh is already Y-up; export_yup would re-rotate and desync bones.
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=False,
        export_animations=True,
        export_nla_strips=True,
        export_materials="EXPORT",
        use_selection=False,
    )


def compute_rest_pose_metrics(arm: bpy.types.Object, root_name: str = "root") -> Dict[str, Any]:
    """
    Assert the self-standing invariant (export_yup=False upright bones in mesh-local Y-up).
    Detects the lying-rest regression (the export_yup=True trap that explodes in three.js):
    a healthy rest is taller in Y than deep in Z and pelvis->head points predominantly +Y.
    """
    lo: Optional[Vector] = None
    hi: Optional[Vector] = None
    for pb in arm.pose.bones:
        m = arm.matrix_world @ pb.bone.matrix_local
        head = m.to_translation()
        tail = head + (m.to_3x3() @ Vector((0.0, pb.bone.length, 0.0)))
        for p in (head, tail):
            if lo is None:
                lo = Vector(p)
                hi = Vector(p)
            else:
                lo.x, lo.y, lo.z = min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)
                hi.x, hi.y, hi.z = max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)
    if lo is None or hi is None:
        return {"standing": False, "reason": "no_bones"}
    ext = hi - lo
    y_over_z = ext.y / ext.z if ext.z > 1e-6 else 999.0
    pelvis = _bone_world_head(arm, root_name)
    head_h = _bone_world_head(arm, "head")
    pelvis_to_head_up = True
    lean_deg = 0.0
    if pelvis is not None and head_h is not None:
        d = head_h - pelvis
        if d.length > 1e-6:
            pelvis_to_head_up = d.y > abs(d.x) and d.y > abs(d.z)
            try:
                lean_deg = math.degrees(d.normalized().angle(Vector((0.0, 1.0, 0.0))))
            except Exception:
                lean_deg = 0.0
    standing = (y_over_z >= STANDING_Y_OVER_Z_MIN) and pelvis_to_head_up
    return {
        "standing": bool(standing),
        "skeletonYoverZ": round(y_over_z, 3),
        "pelvisToHeadUpY": bool(pelvis_to_head_up),
        "restLeanDeg": round(lean_deg, 2),
    }


def compute_skinning_quality(mesh: bpy.types.Object) -> Dict[str, Any]:
    """Per-vertex weight coverage: catch unweighted verts / degenerate skinning."""
    vcount = len(mesh.data.vertices)
    unweighted = 0
    max_weights = 0
    for v in mesh.data.vertices:
        effective = [g for g in v.groups if g.weight > 1e-6]
        if not effective:
            unweighted += 1
        max_weights = max(max_weights, len(effective))
    return {
        "vertexCount": vcount,
        "unweightedVertexCount": unweighted,
        "unweightedFraction": round(unweighted / vcount, 5) if vcount else 1.0,
        "maxWeightsPerVertex": max_weights,
    }


def compute_anim_fingerprint(arm: bpy.types.Object, quant_digits: int = 6) -> str:
    """
    Deterministic hash of all baked animation channels (NLA strip actions),
    quantized so the same params -> same fingerprint. Used by the determinism guard.
    """
    h = hashlib.sha256()
    ad = arm.animation_data
    if not ad:
        return "no_animation_data"
    strips = []
    for track in ad.nla_tracks:
        for strip in track.strips:
            if strip.action:
                strips.append(strip.action)
    for action in sorted(strips, key=lambda a: a.name):
        h.update(action.name.encode("utf-8"))
        fcs = sorted(
            _iter_action_fcurves(action), key=lambda c: (c.data_path, c.array_index)
        )
        for fc in fcs:
            h.update(f"|{fc.data_path}[{fc.array_index}]".encode("utf-8"))
            for kp in fc.keyframe_points:
                fr = round(float(kp.co[0]), 3)
                val = round(float(kp.co[1]), quant_digits)
                h.update(f":{fr},{val}".encode("utf-8"))
    return h.hexdigest()[:32]


def assert_bake_healthy(diagnostics: Dict[str, Any], *, strict: bool, product: bool) -> List[str]:
    """
    Turn every known silent-failure trap into a hard error. Returns the blocker list;
    raises SystemExit(2) when strict and any blocker is present.
    """
    blockers: List[str] = []
    rest = diagnostics.get("restPose", {})
    if not rest.get("standing", False):
        blockers.append("rest_not_standing_y_up")
    skin = diagnostics.get("skinning", {})
    if skin.get("unweightedFraction", 1.0) > MAX_UNWEIGHTED_FRACTION:
        blockers.append(f"unweighted_vertices:{skin.get('unweightedVertexCount')}")

    for clip in diagnostics.get("clips", []):
        name = clip.get("action", "")
        low = name.lower()
        if clip.get("maxJointDeltaDeg", 0.0) < MIN_MOTION_DEG:
            blockers.append(f"static_bake:{name}")  # Blender-5 slot bug / muted action
        if clip.get("fcurveCount", 0) == 0 or clip.get("keyedBones", 0) == 0:
            blockers.append(f"no_keyframes:{name}")
        if ("walk" in low or "run" in low) and clip.get("thighSwingDeg", 0.0) < MIN_THIGH_SWING_DEG:
            blockers.append(f"no_thigh_swing:{name}")
        if clip.get("explodeRatio", 0.0) > MAX_EXPLODE_RATIO:
            blockers.append(f"mesh_explode:{name}={clip.get('explodeRatio')}")
        if product and clip.get("license") not in PRODUCT_ALLOWED_LICENSES:
            blockers.append(f"product_shipping_agpl_clip:{name}={clip.get('license')}")

    if blockers:
        print(f"[bvh] SELF-CHECK BLOCKERS: {blockers}")
        if strict:
            raise SystemExit(2)
    else:
        print("[bvh] self-check OK — no blockers")
    return blockers


def write_rigging_report_sibling(arm: bpy.types.Object, glb_path: str) -> str:
    """
    Emit the `<glb>_rigging_report.json` sibling the isolated lab defaults to (index.html:50),
    so the BVH output is self-describing (HUD `report:bindBones`) and align-OFF is asserted by
    metadata, not convention. The GLB is self-standing (export_yup=False), so runtime align is
    not required — this report documents that.
    """
    landmark_map = {
        "pelvis": "root",
        "head": "head",
        "hand.L": "wrist.L",
        "hand.R": "wrist.R",
        "foot.L": "foot.L",
        "foot.R": "foot.R",
        "upper_arm.L": "upperarm01.L",
        "upper_arm.R": "upperarm01.R",
    }
    bones = []
    top_y = -1e9
    top_pos = [0.0, 0.0, 0.0]
    lo_y = 1e9
    for pb in arm.pose.bones:
        m = arm.matrix_world @ pb.bone.matrix_local
        head = m.to_translation()
        tail = head + (m.to_3x3() @ Vector((0.0, pb.bone.length, 0.0)))
        bones.append(
            {
                "name": pb.name,
                "head": [round(head.x, 6), round(head.y, 6), round(head.z, 6)],
                "tail": [round(tail.x, 6), round(tail.y, 6), round(tail.z, 6)],
                "parent": pb.parent.name if pb.parent else None,
            }
        )
        for p in (head, tail):
            if p.y > top_y:
                top_y = p.y
                top_pos = [round(p.x, 6), round(p.y, 6), round(p.z, 6)]
            lo_y = min(lo_y, p.y)
    landmarks: Dict[str, Any] = {}
    for key, bone_name in landmark_map.items():
        pb = arm.pose.bones.get(bone_name)
        if not pb:
            continue
        h = (arm.matrix_world @ pb.bone.matrix_local).to_translation()
        landmarks[key] = [round(h.x, 6), round(h.y, 6), round(h.z, 6)]

    report = {
        "schemaVersion": "openclinxr.bvh-anny-rigging-report.v1",
        "exportBasis": {
            "method": "mesh_local_y_up_export_yup_false_self_standing",
            "bindBonesEmitted": True,
            "runtimeAlign": "self_standing_no_runtime_align_needed",
        },
        "bindBones": {"bones": bones, "landmarks": landmarks},
        "attachmentPoints": {
            "head_top": top_pos,
            "bodyHeightM": round(top_y - lo_y, 6),
        },
        "claimScope": "rig_interop_map_not_clinical_validity",
        "notEvidenceFor": ["clinical_validity", "production_asset_readiness", "quest_readiness"],
    }
    sibling = os.path.splitext(glb_path)[0] + "_rigging_report.json"
    with open(sibling, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    print(f"[bvh] rigging-report sibling {sibling} (bones={len(bones)} landmarks={len(landmarks)})")
    return sibling


def main() -> None:
    args = parse_args()
    clear_scene()
    rest = json.loads(open(args.rest_skeleton, "r", encoding="utf-8").read())
    print(f"[bvh] mesh={args.mesh}")
    mesh = import_obj(args.mesh)
    snap = snap_rest_bones_to_mesh(rest, mesh)
    print(f"[bvh] bindSnap={snap}")
    print(f"[bvh] building full Anny armature ({rest.get('sourceBoneCount')} bones)")
    arm = build_full_anny_armature(rest)

    body_only = not args.include_extremities
    drive_feet = bool(args.drive_feet) and not bool(args.no_drive_feet)
    drive_hands = bool(args.drive_hands) and not bool(args.no_drive_hands)
    use_root_motion = args.root_motion and not args.no_root_motion
    strict = bool(args.strict) and not bool(args.no_strict)
    product = bool(args.product)
    bpy.context.scene.render.fps = args.fps

    # --- MB-Lab-style roll align BEFORE skinning (bind pose must include new rolls) ---
    roll_info: Dict[str, Any] = {"rolled": 0, "reason": "no_bvh"}
    if args.bvh:
        probe_path = args.bvh[0]
        map_name0, joint_map0 = detect_map(probe_path, args.map)
        print(f"[bvh] roll-probe import {probe_path} map={map_name0}")
        probe_arm = import_bvh(probe_path, args.scale_bvh, args.fps)
        pairs0 = filter_drive_pairs(
            map_bvh_to_anny(probe_arm, arm, joint_map0),
            drive_feet=drive_feet,
            drive_hands=drive_hands,
            body_only=body_only,
        )
        # 1) hips  2) shoulder yaw  3) limb-frame (bone-Y)  4) re-snap hips  5) rolls
        align_bvh_to_anny(probe_arm, arm, pairs0)
        face0 = _align_bvh_facing_to_anny(probe_arm, arm, pairs0)
        align_bvh_to_anny(probe_arm, arm, pairs0)
        limb0 = align_bvh_limb_frame_to_anny(probe_arm, arm, pairs0)
        align_bvh_to_anny(probe_arm, arm, pairs0)
        print(f"[bvh] pre-skin face={face0} limbFrame={limb0}")
        roll_info = align_anny_rolls_to_bvh(arm, probe_arm, pairs0)
        roll_info["preSkinFace"] = face0
        roll_info["preSkinLimbFrame"] = limb0
        # Drop probe armature (clips re-import cleanly below).
        bpy.data.objects.remove(probe_arm, do_unlink=True)
        for act in list(bpy.data.actions):
            bpy.data.actions.remove(act)

    skin = apply_full_skinning(mesh, arm, rest)
    print(f"[bvh] skinning={skin} (after roll-align)")

    # Rest-pose diagnostics: self-standing invariant + rest bbox (explode baseline) + weights.
    bpy.context.view_layer.update()
    rest_bbox = _evaluated_mesh_world_bbox(mesh)
    rest_max_dim = _bbox_max_dim(rest_bbox) if rest_bbox else 0.0
    rest_pose_metrics = compute_rest_pose_metrics(arm)
    skin_quality = compute_skinning_quality(mesh)
    print(f"[bvh] restPose={rest_pose_metrics} restMaxDimM={rest_max_dim:.3f} skinQuality={skin_quality}")

    clips_meta = []
    for bvh_path in args.bvh:
        map_name, joint_map = detect_map(bvh_path, args.map)
        print(f"[bvh] import {bvh_path} map={map_name}")
        bvh_arm = import_bvh(bvh_path, args.scale_bvh, args.fps)
        names = [b.name for b in bvh_arm.pose.bones[:12]]
        print(f"[bvh] source bones sample: {names}")
        pairs = map_bvh_to_anny(bvh_arm, arm, joint_map)
        before = len(pairs)
        pairs = filter_drive_pairs(
            pairs, drive_feet=drive_feet, drive_hands=drive_hands, body_only=body_only
        )
        print(
            f"[bvh] drive filter: {before} → {len(pairs)} pairs "
            f"(body_only={body_only} drive_feet={drive_feet} drive_hands={drive_hands})"
        )
        print(f"[bvh] mapped pairs={len(pairs)}: {pairs[:12]}...")
        if len(pairs) < 6:
            print("[bvh] WARNING: few bone pairs — try --map cmu|mblab|bandai")
        base = os.path.splitext(os.path.basename(bvh_path))[0]
        clip = f"openclinxr_bvh_{map_name}_{base}"[:60]
        root_yaw_only = (bool(args.root_yaw_only) or map_name == "cmu") and not bool(args.no_root_yaw_only)
        clip_metrics = retarget_and_bake(
            arm,
            bvh_arm,
            pairs,
            clip,
            mesh=mesh,
            rest_max_dim=rest_max_dim,
            root_motion=use_root_motion,
            root_yaw_only=root_yaw_only,
        )
        clip_metrics.update(
            {
                "name": clip,
                "bvh": os.path.abspath(bvh_path),
                "map": map_name,
                "mappedBones": len(pairs),
                "method": "parent_local_after_full_align",
                "bodyOnly": body_only,
                "driveFeet": drive_feet,
                "driveHands": drive_hands,
                "footPolicy": "rest_vs_shin" if not drive_feet else "bvh_driven",
                "license": license_for_source(bvh_path),
                "pairs": [{"anny": a, "bvh": b} for a, b in pairs],
            }
        )
        clips_meta.append(clip_metrics)

    print(f"[bvh] export {args.output_glb}")
    export_glb(args.output_glb)
    write_rigging_report_sibling(arm, args.output_glb)

    # --- Diagnostics + fail-loud self-check (Phase 1) ---
    fingerprint = compute_anim_fingerprint(arm)
    diagnostics: Dict[str, Any] = {
        "thresholds": {
            "minMotionDeg": MIN_MOTION_DEG,
            "minThighSwingDeg": MIN_THIGH_SWING_DEG,
            "maxExplodeRatio": MAX_EXPLODE_RATIO,
            "maxUnweightedFraction": MAX_UNWEIGHTED_FRACTION,
            "standingYoverZmin": STANDING_Y_OVER_Z_MIN,
        },
        "restPose": rest_pose_metrics,
        "restMaxDimM": round(rest_max_dim, 4),
        "skinning": skin_quality,
        "fingerprint": fingerprint,
        "product": product,
        "strict": strict,
        "clips": [
            {
                "action": c.get("name") or c.get("action"),
                "license": c.get("license"),
                "maxJointDeltaDeg": c.get("maxJointDeltaDeg"),
                "meanJointDeltaDeg": c.get("meanJointDeltaDeg"),
                "thighSwingDeg": c.get("thighSwingDeg"),
                "explodeRatio": c.get("explodeRatio"),
                "spineLeanDeg": c.get("spineLeanDeg"),
                "fcurveCount": c.get("fcurveCount"),
                "keyedBones": c.get("keyedBones"),
            }
            for c in clips_meta
        ],
    }
    # Compute blockers without raising yet, so the report always lands for the gate.
    blockers = assert_bake_healthy(diagnostics, strict=False, product=product)
    diagnostics["blockers"] = blockers
    diagnostics["healthy"] = not blockers

    report = {
        "schemaVersion": "openclinxr.bvh-anny-full-retarget.v3",
        "mesh": os.path.abspath(args.mesh),
        "restSkeleton": os.path.abspath(args.rest_skeleton),
        "outputGlb": os.path.abspath(args.output_glb),
        "annyBoneCount": rest.get("sourceBoneCount"),
        "skinning": skin,
        "retargetMethod": "parent_local_after_full_align",
        "rollAlign": roll_info,
        "bindSnap": rest.get("bindSnap") or snap,
        "retargetNotes": (
            "Full align pipeline: (1) hip translate (2) shoulder yaw (3) mean limb bone-Y "
            "object rotate (4) re-snap hips (5) MB-Lab-style align_roll on mapped bones + "
            "mid-chain *02 inheritance BEFORE skinning (6) parent-local body-fixed deltas "
            "with shortest-arc quaternions, rotation_quaternion only. CMU skips LHipJoint/"
            "RHipJoint pad joints. No knee pole."
        ),
        "clips": clips_meta,
        "diagnostics": diagnostics,
        "purpose": "CMU-class BVH retarget onto full Anny/MH bone set for locomotion validation",
        "claimScope": "animation_retarget_validation_not_clinical_validity",
        "notEvidenceFor": [
            "clinical_validity",
            "scoring_validity",
            "production_asset_readiness",
            "quest_readiness",
            "b_plus_visual_realism_gate",
        ],
    }
    rp = os.path.splitext(args.output_glb)[0] + ".bvh-retarget-report.json"
    with open(rp, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    print(f"[bvh] report {rp}")
    print("[bvh] done")

    # Enforce the self-check AFTER the report is written so the gate can read blockers.
    if blockers and strict:
        print(f"[bvh] FAIL (strict): {len(blockers)} blocker(s): {blockers}")
        raise SystemExit(2)


if __name__ == "__main__":
    main()
