#!/usr/bin/env python3
"""Retarget one BVH clip onto one MPFB actor WITHOUT the retarget_bvh addon's bake loop.

Why this exists (measured 2026-09-26, Kimodo cagematch round 2): `motion_bind_stage.py`'s
`bpy.ops.mcp.load_and_retarget` correctly imports and name-matches ANY custom `--source-map`
(verified against a trivial 3-frame, 11-joint synthetic BVH, nothing Kimodo-specific about it),
but its final per-frame bake writes only ONE keyframe per bone regardless of real per-frame
source variation -- a Blender-5.1 regression in that addon's own bake loop, not fixable from
this repo without patching a vendored GPL-2.0-or-later extension. This station bypasses that
bake loop entirely.

**Round 3 used per-bone Child-Of constraints and produced visibly wrong output** (torn garment
geometry, an anatomically implausible arm spread, 0.3-0.6 m of measured foot slide per stance
window). Diagnosed 2026-09-26 round 4: the Child-Of `inverse_matrix` was captured against the
SOURCE ARMATURE'S POSE AT FRAME 0 OF THE WALK ANIMATION, not its true rest/bind pose -- frame 0 of
a walking clip is mid-stride, not neutral, so every bone's "rest-offset correction" was calibrated
against a non-neutral reference and that error was baked into every single frame. This version
fixes that by using each armature's actual bind-pose rest matrices
(`bpy.types.Bone.matrix_local`, fixed at import time, independent of any animation frame) and
computes the retarget directly in Python rather than through a constraint, per the standard
world-space rotation-delta formula:

    target_world(t) = source_world(t) @ inverse(source_rest_world) @ target_rest_world

applied bone-by-bone in BIND ORDER (parent before child, walking the full target skeleton every
frame so a mapped bone's parent-chain world rotation -- whether that parent is itself mapped or
left at rest -- is always already resolved when needed), then converted to the target bone's own
LOCAL (parent-relative) rotation and keyframed directly. Unmapped target bones are never touched
and simply keep their rest pose (no keyframes on those channels at all).

Root translation is handled separately (rotation only comes from the formula above): the
horizontal AND vertical displacement of the source hip from ITS OWN rest position is scaled by
the ratio of the two rigs' hip heights above the floor (target/source) and applied to the target
hip's rest position. Axis correspondence between the BVH's own Y-up convention and Blender's
Z-up is NOT hand-remapped here: Blender's own BVH importer already performs that conversion at
import time, so both armatures share one consistent Z-up world once imported into the same
scene -- verified, not assumed (see the cagematch doc for the check).

**Foot locking**, added round 4: after the FK retarget above, for each foot independently, use the
clip's own per-frame contact labels (passed in via `--foot-contacts`) to find stance windows, pin
each window to the foot's own FK world position at the window's first frame via a two-bone IK
constraint (Blender `IK` constraint on the shin bone, chain length 2, targeting a keyed Empty),
enabled only during that window (constraint influence keyframed 0/1), then
`bpy.ops.nla.bake(visual_keying=True, clear_constraints=True)` folds the IK-corrected result into
the final action.

Deterministic and scripted; a new station beside `motion_bind_stage.py`, not a rewrite of it --
that stage still owns every existing shipped bind (Mesh2Motion, CMU) and is unmodified by this file.

  blender --background --python motion_bind_via_constraints_stage.py -- \\
    --actor <mpfb.glb> --clip <clip.bvh> --map <target-map.json> --source-map <source-map.json> \\
    --clip-name <name> --output <out.glb> --report <report.json> \\
    [--foot-contacts <contacts.json>]

`--foot-contacts` is a JSON array of `[frames][6]` 0/1 ints, columns
`[L_heel, L_toe, L_toeEnd, R_heel, R_toe, R_toeEnd]` (Kimodo's own `foot_contacts` export shape).
Optional: without it, the rotation-delta retarget still runs, just with no foot locking.
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

STAGE_ID = "motion_bind_via_constraints_stage"
MIN_DRIVEN_BONES = 8
MIN_TOTAL_DELTA_RAD = 0.01


def _parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Bind a BVH clip via a world-space rotation-delta retarget (no addon)")
    ap.add_argument("--actor", required=True)
    ap.add_argument("--clip", required=True)
    ap.add_argument("--map", required=True, help="Target (MPFB) bone-name -> MHX canonical map JSON")
    ap.add_argument("--source-map", required=True, help="Source (clip) bone-name -> MHX canonical map JSON")
    ap.add_argument("--clip-name", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--foot-contacts", default=None, help="Optional JSON [frames][6] contact labels")
    ap.add_argument(
        "--frame0-only",
        action="store_true",
        help="Write only frame 0 (the rest-pose retarget check) and stop before baking/foot-locking.",
    )
    return ap.parse_args(argv)


def _write_report(path: str, payload: dict) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _reject(report_path: str, reason: str, log: str, extra: dict | None = None) -> int:
    payload = {
        "schemaVersion": "openclinxr.motion-bind-via-constraints-stage.v1",
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
    """own_bone_name -> mhx_canonical_name, dropping unmapped ('None'/empty) entries."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for bname, mhx in data["bones"].items():
        if mhx and mhx != "None":
            out[bname] = mhx
    return out


def _clear_default_scene() -> None:
    """Remove Blender's default startup objects (Cube/Camera/Light).

    MEASURED 2026-09-26: `--background --python` still loads the user's default startup scene
    unless `--factory-startup` is passed, so the default Cube ends up exported into the output GLB
    alongside the real actor meshes (confirmed via a raw glTF node scan). Clearing it here keeps
    the exported bytes limited to what this stage actually intends to ship.
    """
    for ob in list(bpy.context.scene.objects):
        bpy.data.objects.remove(ob, do_unlink=True)


def _import_actor(path: str) -> bpy.types.Object:
    _clear_default_scene()
    bpy.ops.import_scene.gltf(filepath=path)
    armatures = [ob for ob in bpy.context.scene.objects if ob.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError(f"no armature in imported actor {path}")
    return max(armatures, key=lambda ob: len(ob.pose.bones))


def _import_clip(path: str) -> bpy.types.Object:
    ext = os.path.splitext(path)[1].lower()
    startup = set(bpy.context.scene.objects)
    if ext == ".bvh":
        bpy.ops.import_anim.bvh(filepath=path, use_fps_scale=False, target="ARMATURE")
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        raise RuntimeError(f"unsupported clip extension: {ext}")
    new_objects = set(bpy.context.scene.objects) - startup
    armatures = [ob for ob in new_objects if ob.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError(f"no armature imported from clip {path}")
    return max(armatures, key=lambda ob: len(ob.pose.bones))


def _rest_world_matrix(arm: bpy.types.Object, bone_name: str) -> Matrix:
    """The bone's fixed BIND-POSE world matrix -- `Bone.matrix_local` (armature-space rest,
    independent of any animation frame), NOT `PoseBone.matrix` (which varies with the current
    frame and is wrong to use as a "rest" reference -- see the round-4 diagnosis in the module
    docstring)."""
    return arm.matrix_world @ arm.data.bones[bone_name].matrix_local


def _topo_order(arm: bpy.types.Object) -> list[bpy.types.PoseBone]:
    """All pose bones, parents before children."""
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


def main(argv: list[str]) -> int:
    args = _parse_args(argv)
    log: list[str] = []

    for required in (args.actor, args.clip, args.map, args.source_map):
        if not os.path.isfile(required):
            return _reject(args.report, f"missing_input:{required}", "")

    try:
        target_actor = _import_actor(args.actor)
        log.append(f"actor_armature={target_actor.name} pose_bones={len(target_actor.pose.bones)}")
    except Exception as exc:  # noqa: BLE001
        return _reject(args.report, "actor_import_failed", f"{exc!r}\n{traceback.format_exc()}")

    try:
        source_arm = _import_clip(args.clip)
        log.append(f"source_armature={source_arm.name} pose_bones={len(source_arm.pose.bones)}")
    except Exception as exc:  # noqa: BLE001
        return _reject(args.report, "clip_import_failed", f"{exc!r}\n{traceback.format_exc()}")

    try:
        target_map = _load_bone_map(args.map)
        source_map = _load_bone_map(args.source_map)
    except Exception as exc:  # noqa: BLE001
        return _reject(args.report, "map_load_failed", f"{exc!r}\n{traceback.format_exc()}")

    canonical_to_target = {mhx: bname for bname, mhx in target_map.items()}
    canonical_to_source = {mhx: bname for bname, mhx in source_map.items()}
    paired: list[tuple[str, str, str]] = []  # (canonical, target_bone, source_bone)
    for canonical, target_bone in canonical_to_target.items():
        source_bone = canonical_to_source.get(canonical)
        if source_bone is None:
            continue
        if target_bone not in target_actor.pose.bones:
            continue
        if source_bone not in source_arm.pose.bones:
            continue
        paired.append((canonical, target_bone, source_bone))
    log.append(f"paired_bones={len(paired)}")
    if len(paired) < MIN_DRIVEN_BONES:
        return _reject(args.report, "too_few_paired_bones", "\n".join(log), extra={"paired": paired})

    root_pair = next(((c, t, s) for c, t, s in paired if c == "hips"), None)
    if root_pair is None:
        return _reject(args.report, "no_root_pair", "\n".join(log))
    _, root_target_name, root_source_name = root_pair
    target_to_source = {t: s for _, t, s in paired}

    for pb in target_actor.pose.bones:
        pb.rotation_mode = "QUATERNION"

    # Precompute fixed rest-pose world rotations for every target bone (the WHOLE skeleton, not
    # just paired bones -- an unmapped ancestor's constant rest value is still needed when a
    # mapped descendant asks "what is my parent's world rotation"). `target_rest_world` /
    # `source_rest_world` keep the FULL 4x4 (needed for the hip-height translation below);
    # `target_rest_rot` / `source_rest_rot` are the ROTATION-ONLY 3x3 parts used for the per-frame
    # delta chain -- MEASURED 2026-09-26: composing full 4x4 affine rest matrices in the delta
    # formula (`source_world_t @ source_rest.inverted() @ target_rest`) mixes the SOURCE's moving
    # world TRANSLATION into the result through the rotation multiplications, producing a bone
    # "world matrix" whose translation is a meaningless function of the source's animated
    # position -- not the target's own rest position. That is what sent limbs flying arbitrarily
    # far from the torso on every non-rest frame while frame 0 (numerically closest to identity)
    # looked fine in isolation. Rotation-only 3x3 matrices avoid this entirely; translation is
    # handled separately, correctly, by the existing hip-height-ratio root logic below.
    target_order = _topo_order(target_actor)
    target_rest_world: dict[str, Matrix] = {pb.name: _rest_world_matrix(target_actor, pb.name) for pb in target_order}
    source_rest_world: dict[str, Matrix] = {
        s: _rest_world_matrix(source_arm, s) for _, _, s in paired
    }
    target_rest_rot: dict[str, Matrix] = {name: m.to_3x3() for name, m in target_rest_world.items()}
    source_rest_rot: dict[str, Matrix] = {name: m.to_3x3() for name, m in source_rest_world.items()}

    # Per-bone fixed "rest local-to-parent" ROTATION: world_rot(bone) = parent_world_rot @
    # rest_local_to_parent[bone] @ pose_local_rot(bone). For the armature root (no bone parent),
    # parent_world_rot is identity (armature-space IS the top-level space).
    identity = Matrix.Identity(3)
    rest_local_to_parent: dict[str, Matrix] = {}
    for pb in target_order:
        parent_rest = target_rest_rot[pb.parent.name] if pb.parent is not None else identity
        rest_local_to_parent[pb.name] = parent_rest.inverted() @ target_rest_rot[pb.name]

    src_action = source_arm.animation_data.action if source_arm.animation_data else None
    if src_action is None:
        return _reject(args.report, "clip_has_no_action", "\n".join(log))
    frame_start = int(src_action.frame_range[0])
    frame_end = int(src_action.frame_range[1])
    log.append(f"clip_frame_range={frame_start}..{frame_end}")

    # Hip-height ratio (target/source), from REST bone matrices, floor assumed at world Z=0 for
    # both rigs (standard convention for both MPFB and this BVH import). Axis correspondence:
    # Blender's own BVH importer already converts the source clip's Y-up into Blender's Z-up at
    # import time, so both armatures share one Z-up world here -- verified by inspecting the
    # imported source root's rest Z (a positive, human-hip-height-plausible value; see the
    # cagematch doc), not assumed.
    target_hip_z_rest = target_rest_world[root_target_name].translation.z
    source_hip_z_rest = source_rest_world[root_source_name].translation.z
    if target_hip_z_rest <= 0 or source_hip_z_rest <= 0:
        return _reject(
            args.report,
            "hip_height_non_positive",
            "\n".join(log),
            extra={"target_hip_z_rest": target_hip_z_rest, "source_hip_z_rest": source_hip_z_rest},
        )
    hip_height_ratio = target_hip_z_rest / source_hip_z_rest
    log.append(
        f"hip_height_ratio={hip_height_ratio:.6f} "
        f"(target_rest_z={target_hip_z_rest:.4f} source_rest_z={source_hip_z_rest:.4f})"
    )

    target_root_rest_pos = target_rest_world[root_target_name].translation.copy()
    source_root_rest_pos = source_rest_world[root_source_name].translation.copy()

    def retarget_frame(frame: int) -> dict[str, Matrix]:
        """Compute this frame's WORLD ROTATION (3x3) for every target bone, parent-first."""
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        current_world: dict[str, Matrix] = {}
        for pb in target_order:
            src_name = target_to_source.get(pb.name)
            if src_name is not None:
                source_world_rot_t = (source_arm.matrix_world @ source_arm.pose.bones[src_name].matrix).to_3x3()
                total = source_world_rot_t @ source_rest_rot[src_name].inverted() @ target_rest_rot[pb.name]
                current_world[pb.name] = total
            else:
                current_world[pb.name] = target_rest_rot[pb.name]
        return current_world

    def apply_pose(frame: int, current_world: dict[str, Matrix], keyframe: bool) -> None:
        for pb in target_order:
            if pb.name not in target_to_source and pb.name != root_target_name:
                continue  # unmapped: leave at rest, no keyframe
            parent_world = current_world[pb.parent.name] if pb.parent is not None else identity
            local = rest_local_to_parent[pb.name].inverted() @ parent_world.inverted() @ current_world[pb.name]
            pb.rotation_quaternion = local.to_quaternion()
            if keyframe:
                pb.keyframe_insert("rotation_quaternion", frame=frame, group=pb.name)

        # Root translation: hip-height-ratio-scaled delta from rest, same ratio for horizontal
        # and vertical components (both already in one consistent Z-up world post-import).
        root_pb = target_actor.pose.bones[root_target_name]
        src_name = root_source_name
        source_world_pos = (source_arm.matrix_world @ source_arm.pose.bones[src_name].matrix).translation
        delta = (source_world_pos - source_root_rest_pos) * hip_height_ratio
        world_target_pos = target_root_rest_pos + delta
        local_pos = target_actor.matrix_world.inverted() @ world_target_pos
        rest_local_pos = root_pb.bone.matrix_local.translation
        root_pb.location = local_pos - rest_local_pos
        if keyframe:
            root_pb.keyframe_insert("location", frame=frame, group=root_pb.name)

    # Frame-0 rest-pose check: verify the retarget is sane BEFORE animating or baking anything.
    frame0_world = retarget_frame(frame_start)
    apply_pose(frame_start, frame0_world, keyframe=False)
    bpy.context.view_layer.update()
    log.append("frame0_pose_applied_for_verification")

    if args.frame0_only:
        # MEASURED 2026-09-26: export_animations=False exports the armature's REST pose
        # (bone.matrix_local / bind pose) regardless of the pose_bone rotations apply_pose() just
        # set -- it does NOT reflect the retarget at all, so the very first verification render
        # this flag exists for was silently checking nothing. Keyframe frame_start explicitly and
        # export the (single-frame) action instead, so the exported bytes are the actual result.
        apply_pose(frame_start, frame0_world, keyframe=True)
        if target_actor.animation_data and target_actor.animation_data.action:
            target_actor.animation_data.action.name = args.clip_name
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        bpy.data.objects.remove(source_arm, do_unlink=True)
        bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB", export_animations=True)
        payload = {
            "schemaVersion": "openclinxr.motion-bind-via-constraints-stage.v1",
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

    # Full retarget: every frame, keyframed.
    for frame in range(frame_start, frame_end + 1):
        world = retarget_frame(frame)
        apply_pose(frame, world, keyframe=True)
    log.append(f"retargeted_frames={frame_end - frame_start + 1}")

    baked_action = target_actor.animation_data.action if target_actor.animation_data else None
    if baked_action is None:
        return _reject(args.report, "no_action_after_retarget", "\n".join(log))
    baked_action.name = args.clip_name
    log.append(f"action={baked_action.name}")

    # Foot locking (optional; only if contact labels were supplied).
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

        # canonical foot/shin bone names on the target
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
                empty.location = target_actor.matrix_world.inverted() @ pin_pos
                # Ease influence in/out over 1 frame either side to avoid a hard pop.
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

    # Verify every frame is keyed -- the same shape check motion_bind_stage.py's
    # zero_or_thin_channels rejection uses, applied via the layered-action-aware iterator.
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
            args.report,
            "zero_or_thin_channels",
            "\n".join(log),
            extra={"driven": driven, "expectedKeyframes": expected_keyframes},
        )

    bpy.data.objects.remove(source_arm, do_unlink=True)

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB", export_animations=True)

    payload = {
        "schemaVersion": "openclinxr.motion-bind-via-constraints-stage.v1",
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
