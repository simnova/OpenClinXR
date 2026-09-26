#!/usr/bin/env python3
"""Retarget one BVH clip onto one MPFB actor WITHOUT the retarget_bvh addon's bake loop.

Why this exists (measured 2026-09-26, Kimodo cagematch round 2): `motion_bind_stage.py`'s
`bpy.ops.mcp.load_and_retarget` correctly imports and name-matches ANY custom `--source-map`
(verified against a trivial 3-frame, 11-joint synthetic BVH, nothing Kimodo-specific about it),
but its final per-frame bake writes only ONE keyframe per bone regardless of real per-frame
source variation -- a Blender-5.1 regression in that addon's own bake loop, not fixable from
this repo without patching a vendored GPL-2.0-or-later extension. This station bypasses that
bake loop entirely using only Blender's own, separately-tested constraint-evaluation and
`bpy.ops.nla.bake` machinery:

  1. Import the actor GLB and the source BVH clip into the same scene.
  2. Pair every (target bone, source bone) that resolve to the same MHX canonical name via the
     TARGET map (this repo's `mpfb2-default-no-toes.json` convention) and SOURCE map (this
     repo's `kimodo-soma-skeleton30.json` convention).
  3. For each paired bone, add a "Child Of" constraint (rotation only; location and scale
     unchecked) from the target bone to the source bone, and set its `inverse_matrix` from the
     REST-POSE relationship between the two bones -- Blender's own, well-tested mechanism for
     "copy rotation with an automatic rest-pose offset correction" (the effect the operator
     `bpy.ops.constraint.childof_set_inverse` gives interactively; computed directly here since
     an interactive-only operator needs a real 3D-view context this headless script does not
     have). This is Child-Of restricted to rotation, not a bare Copy Rotation constraint, because
     Copy Rotation has no rest-offset correction of its own -- Child Of's `inverse_matrix` is the
     supported way to get one.
  4. Root TRANSLATION is handled separately, not via a constraint: the source root's per-frame
     world XZ (and Y height) displacement from its own rest position is scaled by the ratio of
     the two rigs' leg lengths (thigh+shin bone length at rest) and applied directly to the
     target root bone's location channel.
  5. `bpy.ops.nla.bake(visual_keying=True, clear_constraints=True)` samples the fully-evaluated
     pose (all Child-Of constraints included) at every frame into a clean new action, then
     removes the constraints -- the baked action is ordinary keyframed rotation/location data,
     with no residual dependency on the source armature.
  6. Verify every frame is keyed (same `zero_or_thin_channels` shape check `motion_bind_stage.py`
     uses) before exporting.

Deterministic and scripted; a new station beside `motion_bind_stage.py`, not a rewrite of it --
that stage still owns every existing shipped bind (Mesh2Motion, CMU) and is unmodified by this file.

  blender --background --python motion_bind_via_constraints_stage.py -- \\
    --actor <mpfb.glb> --clip <clip.bvh> --map <target-map.json> --source-map <source-map.json> \\
    --clip-name <name> --output <out.glb> --report <report.json>
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
from mathutils import Matrix

STAGE_ID = "motion_bind_via_constraints_stage"
MIN_DRIVEN_BONES = 8
MIN_TOTAL_DELTA_RAD = 0.01


def _parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Bind a BVH clip via Child-Of constraints + nla.bake (no addon)")
    ap.add_argument("--actor", required=True)
    ap.add_argument("--clip", required=True)
    ap.add_argument("--map", required=True, help="Target (MPFB) bone-name -> MHX canonical map JSON")
    ap.add_argument("--source-map", required=True, help="Source (clip) bone-name -> MHX canonical map JSON")
    ap.add_argument("--clip-name", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--report", required=True)
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
    alongside the real actor meshes -- present in the file (confirmed via a raw glTF node scan),
    though invisible in-repo capture pipelines that key off known mesh names. Clearing it here
    keeps the exported bytes limited to what this stage actually intends to ship.
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


def _leg_length(arm: bpy.types.Object, thigh: str, shin: str) -> float | None:
    pb_thigh = arm.pose.bones.get(thigh)
    pb_shin = arm.pose.bones.get(shin)
    if pb_thigh is None or pb_shin is None:
        return None
    return float(pb_thigh.bone.length + pb_shin.bone.length)


def _bone_world_rest_matrix(arm: bpy.types.Object, bone_name: str) -> Matrix | None:
    bone = arm.data.bones.get(bone_name)
    if bone is None:
        return None
    return arm.matrix_world @ bone.matrix_local


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

    # mhx canonical name -> (target_bone_name, source_bone_name), only where BOTH sides resolve
    # and both bones actually exist on their respective imported armatures.
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
        return _reject(
            args.report,
            "too_few_paired_bones",
            "\n".join(log),
            extra={"paired": paired},
        )

    # Root bone (canonical "hips") handled separately for translation; every OTHER paired bone
    # gets a rotation-only Child-Of constraint with its inverse_matrix set from the rest pose.
    root_pair = next(((c, t, s) for c, t, s in paired if c == "hips"), None)
    if root_pair is None:
        return _reject(args.report, "no_root_pair", "\n".join(log))
    _, root_target_name, root_source_name = root_pair

    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()

    constrained = 0
    for canonical, target_bone_name, source_bone_name in paired:
        if canonical == "hips":
            continue  # root: translation handled below; rotation still gets a Child-Of below
        pb = target_actor.pose.bones[target_bone_name]
        con = pb.constraints.new("CHILD_OF")
        con.name = "openclinxr_kimodo_retarget"
        con.target = source_arm
        con.subtarget = source_bone_name
        con.use_location_x = con.use_location_y = con.use_location_z = False
        con.use_scale_x = con.use_scale_y = con.use_scale_z = False
        con.use_rotation_x = con.use_rotation_y = con.use_rotation_z = True
        # Rest-pose offset correction: Child-Of's inverse_matrix is defined so that, at the frame
        # it is captured, the constrained result exactly reproduces the CURRENT (rest) pose. That
        # is: owner_world_rest = target_world(child_of_target_matrix) @ inverse_matrix, so
        # inverse_matrix = child_of_target_matrix.inverted() @ owner_world_rest. For a bone
        # constraint, "target_matrix" is the target bone's world matrix and the owner's world
        # matrix is armature_world @ pose_bone.matrix (evaluated). Captured at frame 0 (both
        # armatures in their imported rest pose) instead of the interactive
        # `constraint.childof_set_inverse` operator, which needs a live 3D-view context this
        # headless script does not have.
        target_world = source_arm.matrix_world @ source_arm.pose.bones[source_bone_name].matrix
        owner_world_rest = target_actor.matrix_world @ pb.matrix
        con.inverse_matrix = target_world.inverted() @ owner_world_rest
        constrained += 1
    log.append(f"child_of_constraints={constrained}")

    # Root rotation: same Child-Of mechanism, so the root's world ORIENTATION follows the source.
    root_pb = target_actor.pose.bones[root_target_name]
    root_con = root_pb.constraints.new("CHILD_OF")
    root_con.name = "openclinxr_kimodo_retarget"
    root_con.target = source_arm
    root_con.subtarget = root_source_name
    root_con.use_location_x = root_con.use_location_y = root_con.use_location_z = False
    root_con.use_scale_x = root_con.use_scale_y = root_con.use_scale_z = False
    root_con.use_rotation_x = root_con.use_rotation_y = root_con.use_rotation_z = True
    root_target_world = source_arm.matrix_world @ source_arm.pose.bones[root_source_name].matrix
    root_owner_world_rest = target_actor.matrix_world @ root_pb.matrix
    root_con.inverse_matrix = root_target_world.inverted() @ root_owner_world_rest

    # Determine the clip's frame range from the source armature's own action.
    src_action = source_arm.animation_data.action if source_arm.animation_data else None
    if src_action is None:
        return _reject(args.report, "clip_has_no_action", "\n".join(log))
    frame_start = int(src_action.frame_range[0])
    frame_end = int(src_action.frame_range[1])
    log.append(f"clip_frame_range={frame_start}..{frame_end}")

    # Root TRANSLATION, scaled by leg-length ratio (thigh+shin bone length at rest), applied
    # directly to the target root bone's location channel -- not via a constraint (Child-Of with
    # location enabled would copy 1:1, ignoring the two rigs' size difference).
    leg_names_source = ("LeftLeg", "LeftShin")
    leg_names_target_canonical_thigh = "thigh.L"
    leg_names_target_canonical_shin = "shin.L"
    target_thigh_name = canonical_to_target.get(leg_names_target_canonical_thigh)
    target_shin_name = canonical_to_target.get(leg_names_target_canonical_shin)
    source_leg_len = _leg_length(source_arm, *leg_names_source)
    target_leg_len = (
        _leg_length(target_actor, target_thigh_name, target_shin_name)
        if target_thigh_name and target_shin_name
        else None
    )
    if not source_leg_len or not target_leg_len:
        return _reject(
            args.report,
            "leg_length_unavailable",
            "\n".join(log),
            extra={"source_leg_len": source_leg_len, "target_leg_len": target_leg_len},
        )
    leg_ratio = target_leg_len / source_leg_len
    log.append(f"leg_length_ratio={leg_ratio:.6f} (target={target_leg_len:.4f} source={source_leg_len:.4f})")

    bpy.context.scene.frame_set(frame_start)
    bpy.context.view_layer.update()
    source_root_rest_world = (source_arm.matrix_world @ source_arm.pose.bones[root_source_name].matrix).translation.copy()
    target_root_rest_world = (target_actor.matrix_world @ root_pb.matrix).translation.copy()

    root_positions_by_frame: dict[int, tuple[float, float, float]] = {}
    for frame in range(frame_start, frame_end + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        src_world = (source_arm.matrix_world @ source_arm.pose.bones[root_source_name].matrix).translation
        delta = (src_world - source_root_rest_world) * leg_ratio
        world_target = target_root_rest_world + delta
        # Convert desired WORLD location back into the root pose bone's own (parent-relative)
        # space so a plain keyframe on pose_bone.location reproduces it after the bake clears
        # constraints. The root bone here has no bone parent (edit-bone parent is the armature
        # itself), so pose space == armature-local space; account for the armature object's own
        # world transform only.
        local = target_actor.matrix_world.inverted() @ world_target
        # location channel is relative to the bone's rest position in armature space.
        rest_local = root_pb.bone.matrix_local.translation
        root_positions_by_frame[frame] = tuple(local - rest_local)

    log.append(f"root_translation_frames={len(root_positions_by_frame)}")

    # Bake: sample the fully-evaluated pose (Child-Of constraints included) into a new action,
    # then drop the constraints. This is Blender's own tested bake path, not a hand-rolled loop.
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
        return _reject(args.report, "nla_bake_failed", "\n".join(log) + f"\n{exc!r}\n{traceback.format_exc()}")
    bpy.ops.object.mode_set(mode="OBJECT")

    baked_action = target_actor.animation_data.action if target_actor.animation_data else None
    if baked_action is None:
        return _reject(args.report, "no_action_after_bake", "\n".join(log))
    baked_action.name = args.clip_name
    log.append(f"baked_action={baked_action.name}")

    # Overlay the leg-length-scaled root translation directly onto the location channel (the
    # bake above already captured location for the root bone via visual_keying, but that capture
    # is the RAW 1:1 copy from the CHILD-OF constraint before we intended to rescale it -- root
    # translation was deliberately left OFF that constraint (use_location_* = False), so the bake
    # only wrote the target's own unchanging rest location. Insert the real, scaled values now.
    for frame, loc in root_positions_by_frame.items():
        root_pb.location = loc
        root_pb.keyframe_insert("location", frame=frame, group=root_pb.name)

    # Verify every frame is keyed -- the same shape check motion_bind_stage.py's
    # zero_or_thin_channels rejection uses.
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
        if 'pose.bones["' not in path or "rotation" not in path and "location" not in path:
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
    real = [b for b in driven if b["keyframes"] >= (frame_end - frame_start + 1) - 1 and b["totalDeltaRad"] > MIN_TOTAL_DELTA_RAD]
    expected_keyframes = frame_end - frame_start + 1
    log.append(f"driven={len(driven)} real={len(real)} expected_keyframes_per_bone={expected_keyframes}")

    if len(real) < MIN_DRIVEN_BONES:
        return _reject(
            args.report,
            "zero_or_thin_channels",
            "\n".join(log),
            extra={"driven": driven, "expectedKeyframes": expected_keyframes},
        )

    # Drop the source armature before export.
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
        "legLengthRatio": leg_ratio,
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
