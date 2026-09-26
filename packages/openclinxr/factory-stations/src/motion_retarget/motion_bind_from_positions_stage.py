#!/usr/bin/env python3
"""Retarget onto one MPFB actor from Kimodo's own per-frame global JOINT POSITIONS -- not BVH
rotations, and not the source's rest pose at all.

Why this exists (measured 2026-09-26, Kimodo cagematch rounds 2-4): every attempt driven by the
BVH-imported source armature's own rotations -- the addon's bake (round 2), Child-Of constraints
(round 3), and a hand-computed world-space rotation-delta formula (round 4) -- produced a visibly
wrong pose, because each depends on the source armature's REST orientation being anatomically
meaningful on every axis, and BVH format does not encode bone roll/twist at all (only a direction
per joint); Blender's BVH importer has to invent a roll per edit bone, and that invented value is
not a comparable reference. This station sidesteps the question entirely by never reading a BVH
rotation, or a BVH rest pose, at all.

Source data: Kimodo's own `posed_joints` array from the generated `.npz` (SOMA77 global joint
positions per frame, sliced to the ~27 joints this pipeline needs), converted from Kimodo's native
Y-up to Blender's Z-up ONCE, explicitly, by a small preprocessing script
(`export_joint_positions.py`, scratch, not committed) that also VERIFIES the conversion: head above
pelvis and feet lowest on frame 0. This station reads that verified JSON, not the BVH file.

Per mapped bone (parent-first, bind order):

  - LIMB and SPINE bones: a "swing" rotation that rotates the TARGET bone's own REST DIRECTION
    (a fixed, unambiguous value read from the target's own authored rig -- `Bone.matrix_local`'s
    local +Y axis in world space) to point along the SOURCE SEGMENT direction at frame t
    (source_child_position(t) - source_own_position(t), from positions only). This is computed via
    `rest_dir.rotation_difference(desired_dir)`, the minimal (shortest-arc) rotation between two
    vectors, which by construction carries no twist around the resulting axis -- "keep twist from
    parent" is satisfied by NOT adding any twist component ourselves, not by an explicit inherit
    step. Composed onto the target's own rest world rotation:
    `desired_world_rotation(t) = swing(t) @ target_rest_world_rotation`.
  - HIPS (pelvis): a full orthonormal basis from the hip landmarks -- lateral = normalize(right
    hip - left hip), a fixed world-up vector, forward = up x lateral -- built fresh every frame
    from source positions and once from the target's own rest hip positions, with the target's
    rest world rotation as the fixed anchor (same structural pattern as the swing case, generalized
    from one axis to a full 3-axis basis).
  - Everything is converted to each bone's LOCAL (parent-relative) rotation using the already-
    resolved parent world rotation this same frame, and keyframed directly. Unmapped target bones
    keep their rest pose untouched.

Root TRANSLATION: pelvis (Hips) position, scaled by the ratio of the two rigs' hip heights above
the floor (target/source), same as prior rounds.

Foot locking: identical mechanism to the prior round (two-bone IK on the shin bone targeting a
keyed Empty per contact-labelled stance window, baked with `bpy.ops.nla.bake`), included here
rather than duplicated in a third file.

A new station beside `motion_bind_stage.py` and `motion_bind_via_constraints_stage.py`, neither of
which this file modifies.

  blender --background --python motion_bind_from_positions_stage.py -- \\
    --actor <mpfb.glb> --joint-positions <positions.json> --map <target-map.json> \\
    --clip-name <name> --output <out.glb> --report <report.json> \\
    [--foot-contacts <contacts.json>] [--frame0-only]

`--joint-positions` is the JSON `export_joint_positions.py` writes: `{jointName: [[x,y,z], ...],
"_frames": N}`, already in Blender Z-up, already verified.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

STAGE_ID = "motion_bind_from_positions_stage"
MIN_DRIVEN_BONES = 8
MIN_TOTAL_DELTA_RAD = 0.01
WORLD_UP = Vector((0.0, 0.0, 1.0))

# canonical target-map name -> (source joint name, source CHILD joint name for the swing direction)
# Indices/names per nv-tlabs/kimodo kimodo/skeleton/definitions.py:SOMASkeleton77, read from
# source 2026-09-26. Root ("hips") is handled separately via the hip-plane basis method.
SWING_SEGMENTS: dict[str, tuple[str, str]] = {
    "spine": ("Spine1", "Spine2"),
    "spine-1": ("Spine2", "Chest"),
    "chest": ("Chest", "Neck1"),
    "neck": ("Neck1", "Neck2"),
    "head": ("Neck2", "Head"),
    "shoulder.L": ("LeftShoulder", "LeftArm"),
    "upper_arm.L": ("LeftArm", "LeftForeArm"),
    "forearm.L": ("LeftForeArm", "LeftHand"),
    "hand.L": ("LeftHand", "LeftHandMiddle1"),
    "shoulder.R": ("RightShoulder", "RightArm"),
    "upper_arm.R": ("RightArm", "RightForeArm"),
    "forearm.R": ("RightForeArm", "RightHand"),
    "hand.R": ("RightHand", "RightHandMiddle1"),
    "thigh.L": ("LeftLeg", "LeftShin"),
    "shin.L": ("LeftShin", "LeftFoot"),
    "foot.L": ("LeftFoot", "LeftToeBase"),
    "toe.L": ("LeftToeBase", "LeftToeEnd"),
    "thigh.R": ("RightLeg", "RightShin"),
    "shin.R": ("RightShin", "RightFoot"),
    "foot.R": ("RightFoot", "RightToeBase"),
    "toe.R": ("RightToeBase", "RightToeEnd"),
}
HIP_LATERAL_JOINTS = ("RightLeg", "LeftLeg")  # (right, left) -- matches SkeletonBase.hip_joint_idx convention


def _parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Bind from Kimodo's own joint positions via swing-only retarget (no BVH rotations)")
    ap.add_argument("--actor", required=True)
    ap.add_argument("--joint-positions", required=True)
    ap.add_argument("--map", required=True, help="Target (MPFB) bone-name -> MHX canonical map JSON")
    ap.add_argument("--clip-name", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--foot-contacts", default=None)
    ap.add_argument("--frame0-only", action="store_true")
    return ap.parse_args(argv)


def _write_report(path: str, payload: dict) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _reject(report_path: str, reason: str, log: str, extra: dict | None = None) -> int:
    payload = {
        "schemaVersion": "openclinxr.motion-bind-from-positions-stage.v1",
        "stageId": STAGE_ID,
        "verdict": "reject_measured",
        "reason": reason,
        "log": log[-8000:],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        **(extra or {}),
    }
    _write_report(report_path, payload)
    print(f"REJECT_MEASURED {reason}", file=sys.stderr)
    print(log[-2000:], file=sys.stderr)
    return 2


def _load_bone_map(path: str) -> dict[str, str]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return {bname: mhx for bname, mhx in data["bones"].items() if mhx and mhx != "None"}


def _clear_default_scene() -> None:
    for ob in list(bpy.context.scene.objects):
        bpy.data.objects.remove(ob, do_unlink=True)


def _import_actor(path: str) -> bpy.types.Object:
    _clear_default_scene()
    bpy.ops.import_scene.gltf(filepath=path)
    armatures = [ob for ob in bpy.context.scene.objects if ob.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError(f"no armature in imported actor {path}")
    return max(armatures, key=lambda ob: len(ob.pose.bones))


def _rest_world_matrix(arm: bpy.types.Object, bone_name: str) -> Matrix:
    return arm.matrix_world @ arm.data.bones[bone_name].matrix_local


def _topo_order(arm: bpy.types.Object) -> list[bpy.types.PoseBone]:
    ordered: list[bpy.types.PoseBone] = []
    seen: set[str] = set()

    def visit(pb: bpy.types.PoseBone) -> None:
        if pb.name in seen:
            return
        if pb.parent is not None:
            visit(pb.parent)
        seen.add(pb.name)
        ordered.append(pb)

    for pb in arm.pose.bones:
        visit(pb)
    return ordered


def _basis_from_hips(right_hip: Vector, left_hip: Vector) -> Matrix:
    """Orthonormal (lateral, up, forward) world-space basis from two hip landmarks + world up."""
    lateral = (right_hip - left_hip).normalized()
    forward = WORLD_UP.cross(lateral).normalized()
    up = lateral.cross(forward).normalized()
    return Matrix((lateral, up, forward)).transposed()  # columns = basis vectors


def main(argv: list[str]) -> int:
    args = _parse_args(argv)
    log: list[str] = []

    for required in (args.actor, args.joint_positions, args.map):
        if not os.path.isfile(required):
            return _reject(args.report, f"missing_input:{required}", "")

    try:
        target_actor = _import_actor(args.actor)
        log.append(f"actor_armature={target_actor.name} pose_bones={len(target_actor.pose.bones)}")
    except Exception as exc:  # noqa: BLE001
        return _reject(args.report, "actor_import_failed", f"{exc!r}\n{traceback.format_exc()}")

    try:
        joints = json.loads(Path(args.joint_positions).read_text(encoding="utf-8"))
        frame_count = int(joints.pop("_frames"))
    except Exception as exc:  # noqa: BLE001
        return _reject(args.report, "joint_positions_load_failed", f"{exc!r}\n{traceback.format_exc()}")

    def jpos(name: str, frame_index: int) -> Vector:
        return Vector(joints[name][frame_index])

    try:
        target_map = _load_bone_map(args.map)
    except Exception as exc:  # noqa: BLE001
        return _reject(args.report, "map_load_failed", f"{exc!r}\n{traceback.format_exc()}")

    canonical_to_target = {mhx: bname for bname, mhx in target_map.items()}
    root_target_name = canonical_to_target.get("hips")
    if not root_target_name or root_target_name not in target_actor.pose.bones:
        return _reject(args.report, "no_root_target", "\n".join(log))

    # bone -> (own_source_joint, child_source_joint), only where both the target bone exists and
    # both source joint names are present in the exported positions.
    swing_pairs: dict[str, tuple[str, str]] = {}
    for canonical, (own_j, child_j) in SWING_SEGMENTS.items():
        target_name = canonical_to_target.get(canonical)
        if not target_name or target_name not in target_actor.pose.bones:
            continue
        if own_j not in joints or child_j not in joints:
            continue
        swing_pairs[target_name] = (own_j, child_j)
    log.append(f"swing_pairs={len(swing_pairs)}")
    if len(swing_pairs) < MIN_DRIVEN_BONES:
        return _reject(args.report, "too_few_swing_pairs", "\n".join(log), extra={"pairs": list(swing_pairs)})

    for pb in target_actor.pose.bones:
        pb.rotation_mode = "QUATERNION"

    target_order = _topo_order(target_actor)
    target_rest_world: dict[str, Matrix] = {pb.name: _rest_world_matrix(target_actor, pb.name) for pb in target_order}
    target_rest_rot: dict[str, Matrix] = {name: m.to_3x3() for name, m in target_rest_world.items()}
    identity3 = Matrix.Identity(3)
    rest_local_to_parent: dict[str, Matrix] = {}
    for pb in target_order:
        parent_rest = target_rest_rot[pb.parent.name] if pb.parent is not None else identity3
        rest_local_to_parent[pb.name] = parent_rest.inverted() @ target_rest_rot[pb.name]

    # Fixed rest DIRECTION (local +Y in world space) for every swing bone.
    rest_dir_world: dict[str, Vector] = {
        name: (target_rest_rot[name] @ Vector((0.0, 1.0, 0.0))).normalized() for name in swing_pairs
    }

    # Root hip-height ratio + rest basis for the pelvis plane method.
    target_hip_z_rest = target_rest_world[root_target_name].translation.z
    if target_hip_z_rest <= 0:
        return _reject(args.report, "target_hip_height_non_positive", "\n".join(log))
    source_hip_z_rest = jpos("Hips", 0).z
    if source_hip_z_rest <= 0:
        return _reject(args.report, "source_hip_height_non_positive", "\n".join(log))
    hip_height_ratio = target_hip_z_rest / source_hip_z_rest
    log.append(f"hip_height_ratio={hip_height_ratio:.6f}")

    thigh_l_name = canonical_to_target.get("thigh.L")
    thigh_r_name = canonical_to_target.get("thigh.R")
    if not thigh_l_name or not thigh_r_name or thigh_l_name not in target_rest_world or thigh_r_name not in target_rest_world:
        return _reject(args.report, "target_thighs_unmapped", "\n".join(log))
    target_rest_pelvis_basis = _basis_from_hips(
        target_rest_world[thigh_r_name].translation, target_rest_world[thigh_l_name].translation
    )
    pelvis_correction = target_rest_rot[root_target_name] @ target_rest_pelvis_basis.inverted()

    target_root_rest_pos = target_rest_world[root_target_name].translation.copy()
    source_root_rest_pos = jpos("Hips", 0)

    def retarget_frame(frame_index: int) -> dict[str, Matrix]:
        current_world: dict[str, Matrix] = {}
        for pb in target_order:
            if pb.name == root_target_name:
                right_hip = jpos(HIP_LATERAL_JOINTS[0], frame_index)
                left_hip = jpos(HIP_LATERAL_JOINTS[1], frame_index)
                current_basis = _basis_from_hips(right_hip, left_hip)
                current_world[pb.name] = pelvis_correction @ current_basis
            elif pb.name in swing_pairs:
                own_j, child_j = swing_pairs[pb.name]
                own_pos = jpos(own_j, frame_index)
                child_pos = jpos(child_j, frame_index)
                seg = child_pos - own_pos
                if seg.length < 1e-6:
                    current_world[pb.name] = target_rest_rot[pb.name]
                else:
                    seg = seg.normalized()
                    swing = rest_dir_world[pb.name].rotation_difference(seg).to_matrix()
                    current_world[pb.name] = swing @ target_rest_rot[pb.name]
            else:
                current_world[pb.name] = target_rest_rot[pb.name]
        return current_world

    def apply_pose(frame_number: int, current_world: dict[str, Matrix], keyframe: bool) -> None:
        for pb in target_order:
            if pb.name != root_target_name and pb.name not in swing_pairs:
                continue
            parent_world = current_world[pb.parent.name] if pb.parent is not None else identity3
            local = rest_local_to_parent[pb.name].inverted() @ parent_world.inverted() @ current_world[pb.name]
            pb.rotation_quaternion = local.to_quaternion()
            if keyframe:
                pb.keyframe_insert("rotation_quaternion", frame=frame_number, group=pb.name)

        root_pb = target_actor.pose.bones[root_target_name]
        frame_index = frame_number - 1  # BVH-derived frame numbers start at 1; positions are 0-indexed
        src_pos = jpos("Hips", max(0, frame_index))
        delta = (src_pos - source_root_rest_pos) * hip_height_ratio
        world_target_pos = target_root_rest_pos + delta
        local_pos = target_actor.matrix_world.inverted() @ world_target_pos
        rest_local_pos = root_pb.bone.matrix_local.translation
        root_pb.location = local_pos - rest_local_pos
        if keyframe:
            root_pb.keyframe_insert("location", frame=frame_number, group=root_pb.name)

    frame_start, frame_end = 1, frame_count  # 1-indexed to match this repo's other BVH-sourced clips

    frame0_world = retarget_frame(0)
    apply_pose(frame_start, frame0_world, keyframe=args.frame0_only)
    bpy.context.view_layer.update()
    log.append("frame0_pose_applied_for_verification")

    if args.frame0_only:
        if target_actor.animation_data and target_actor.animation_data.action:
            target_actor.animation_data.action.name = args.clip_name
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB", export_animations=True)
        payload = {
            "schemaVersion": "openclinxr.motion-bind-from-positions-stage.v1",
            "stageId": STAGE_ID,
            "verdict": "frame0_only",
            "hipHeightRatio": hip_height_ratio,
            "output": args.output,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "log": "\n".join(log),
        }
        _write_report(args.report, payload)
        print(json.dumps({"verdict": "frame0_only", "output": args.output}))
        return 0

    for frame_number in range(frame_start, frame_end + 1):
        world = retarget_frame(frame_number - 1)
        apply_pose(frame_number, world, keyframe=True)
    log.append(f"retargeted_frames={frame_end - frame_start + 1}")

    baked_action = target_actor.animation_data.action if target_actor.animation_data else None
    if baked_action is None:
        return _reject(args.report, "no_action_after_retarget", "\n".join(log))
    baked_action.name = args.clip_name

    ik_used = False
    if args.foot_contacts:
        try:
            contacts = json.loads(Path(args.foot_contacts).read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            return _reject(args.report, "foot_contacts_load_failed", "\n".join(log) + f"\n{exc!r}")

        def stance_windows(col: int) -> list[tuple[int, int]]:
            windows: list[tuple[int, int]] = []
            start = -1
            for i, row in enumerate(contacts):
                f = frame_start + i
                in_contact = row[col] == 1
                if in_contact and start == -1:
                    start = f
                if not in_contact and start != -1:
                    if f - 1 > start:
                        windows.append((start, f - 1))
                    start = -1
            if start != -1 and frame_end > start:
                windows.append((start, frame_end))
            return windows

        foot_specs = [
            ("L", canonical_to_target.get("foot.L"), canonical_to_target.get("shin.L"), 1),
            ("R", canonical_to_target.get("foot.R"), canonical_to_target.get("shin.R"), 4),
        ]
        for side, foot_name, shin_name, contact_col in foot_specs:
            if not foot_name or not shin_name:
                continue
            windows = stance_windows(contact_col)
            if not windows:
                continue
            foot_pb = target_actor.pose.bones[foot_name]
            empty = bpy.data.objects.new(f"ik_target_{side}", None)
            bpy.context.scene.collection.objects.link(empty)
            ik = target_actor.pose.bones[shin_name].constraints.new("IK")
            ik.name = f"openclinxr_footlock_{side}"
            ik.target = empty
            ik.chain_count = 2
            ik.influence = 0.0
            empty.keyframe_insert("location", frame=frame_start)
            ik.keyframe_insert("influence", frame=frame_start)
            for win_start, win_end in windows:
                bpy.context.scene.frame_set(win_start)
                bpy.context.view_layer.update()
                pin_world = target_actor.matrix_world @ foot_pb.matrix
                pin_pos = pin_world.translation.copy()
                fade = 1
                for f, val in (
                    (max(frame_start, win_start - fade), 0.0),
                    (win_start, 1.0),
                    (win_end, 1.0),
                    (min(frame_end, win_end + fade), 0.0),
                ):
                    empty.location = target_actor.matrix_world.inverted() @ pin_pos
                    empty.keyframe_insert("location", frame=f)
                    ik.influence = val
                    ik.keyframe_insert("influence", frame=f)
            ik_used = True
        log.append(f"foot_locking_applied={ik_used}")

        if ik_used:
            bpy.ops.object.select_all(action="DESELECT")
            target_actor.select_set(True)
            bpy.context.view_layer.objects.active = target_actor
            bpy.ops.object.mode_set(mode="POSE")
            bpy.ops.pose.select_all(action="SELECT")
            try:
                bpy.ops.nla.bake(
                    frame_start=frame_start,
                    frame_end=frame_end,
                    only_selected=True,
                    visual_keying=True,
                    clear_constraints=True,
                    clear_parents=False,
                    use_current_action=False,
                    bake_types={"POSE"},
                )
            except Exception as exc:  # noqa: BLE001
                bpy.ops.object.mode_set(mode="OBJECT")
                return _reject(args.report, "footlock_bake_failed", "\n".join(log) + f"\n{exc!r}\n{traceback.format_exc()}")
            bpy.ops.object.mode_set(mode="OBJECT")
            old_action = baked_action
            baked_action = target_actor.animation_data.action
            if old_action is not None and old_action != baked_action and old_action.name == args.clip_name:
                old_action.name = f"{args.clip_name}__pre_footlock"
                bpy.data.actions.remove(old_action, do_unlink=True)
            baked_action.name = args.clip_name
            for empty_ob in [ob for ob in bpy.context.scene.objects if ob.name.startswith("ik_target_")]:
                bpy.data.objects.remove(empty_ob, do_unlink=True)

    def iter_fcurves(action: bpy.types.Action):
        fcs = getattr(action, "fcurves", None)
        if fcs is not None and len(fcs) > 0:
            yield from fcs
            return
        for layer in getattr(action, "layers", None) or []:
            for strip in getattr(layer, "strips", []) or []:
                for bag in getattr(strip, "channelbags", []) or []:
                    yield from getattr(bag, "fcurves", []) or []

    by_bone: dict[str, dict[str, float | int]] = {}
    for fcu in iter_fcurves(baked_action):
        path = fcu.data_path or ""
        if 'pose.bones["' not in path or ("rotation" not in path and "location" not in path):
            continue
        name = path.split('pose.bones["', 1)[1].split('"]', 1)[0]
        kfs = list(fcu.keyframe_points)
        if len(kfs) < 2:
            continue
        values = [kp.co[1] for kp in kfs]
        delta = max(values) - min(values)
        slot = by_bone.setdefault(name, {"keyframes": len(kfs), "totalDeltaRad": 0.0})
        slot["keyframes"] = max(int(slot["keyframes"]), len(kfs))
        slot["totalDeltaRad"] = float(slot["totalDeltaRad"]) + abs(delta)

    driven = [
        {"bone": name, "keyframes": int(v["keyframes"]), "totalDeltaRad": v["totalDeltaRad"]}
        for name, v in sorted(by_bone.items())
    ]
    expected_keyframes = frame_end - frame_start + 1
    real = [b for b in driven if b["keyframes"] >= expected_keyframes - 1 and b["totalDeltaRad"] > MIN_TOTAL_DELTA_RAD]
    log.append(f"driven={len(driven)} real={len(real)} expected_keyframes_per_bone={expected_keyframes}")

    if len(real) < MIN_DRIVEN_BONES:
        return _reject(
            args.report, "zero_or_thin_channels", "\n".join(log),
            extra={"driven": driven, "expectedKeyframes": expected_keyframes},
        )

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB", export_animations=True)

    payload = {
        "schemaVersion": "openclinxr.motion-bind-from-positions-stage.v1",
        "stageId": STAGE_ID,
        "verdict": "ok",
        "clipName": baked_action.name,
        "driven": len(driven),
        "realDrivenCount": len(real),
        "expectedKeyframesPerBone": expected_keyframes,
        "hipHeightRatio": hip_height_ratio,
        "footLockingApplied": ik_used,
        "drivenBones": driven,
        "output": args.output,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "log": "\n".join(log),
    }
    _write_report(args.report, payload)
    print(json.dumps({"verdict": "ok", "clipName": baked_action.name, "driven": len(driven), "real": len(real)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]))
