#!/usr/bin/env python3
"""Dark-factory B motion-bind stage — one MPFB actor + one BVH → bound clip.

Build-time only. Invokes retarget_bvh (GPL-2.0-or-later) via bpy.ops.mcp.load_and_retarget.
Never imported by the runtime. Do not vendor the addon.

  blender --background --python motion_bind_stage.py -- \\
    --actor <mpfb.glb> --clip <walk.bvh> --map <mpfb2-default-no-toes.json> \\
    --output <out.glb> --report <report.json>
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


STAGE_ID = "motion_bind_stage"
ADDON_MODULE = "bl_ext.user_default.retarget_bvh"
TARGET_NAME = "MPFB2 default_no_toes"
CLIP_NAME = "openclinxr_retarget_cmu_07_01_walk"
MIN_DRIVEN_BONES = 8
MIN_TOTAL_DELTA_RAD = 0.01


def _parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Bind one BVH clip onto one MPFB actor via retarget_bvh")
    ap.add_argument("--actor", required=True)
    ap.add_argument("--clip", required=True)
    ap.add_argument("--map", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--report", required=True)
    return ap.parse_args(argv)


def _write_report(path: str, payload: dict) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _reject(report_path: str, reason: str, log: str, extra: dict | None = None) -> int:
    payload = {
        "schemaVersion": "openclinxr.motion-bind-stage.v1",
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


def _enable_retarget_bvh() -> tuple[bool, str]:
    import addon_utils

    try:
        addon_utils.enable(ADDON_MODULE)
    except Exception as exc:  # noqa: BLE001 — surface enable failure as reject_measured
        return False, f"addon_utils.enable({ADDON_MODULE}) raised {exc!r}"
    has_op = hasattr(bpy.ops, "mcp") and hasattr(bpy.ops.mcp, "load_and_retarget")
    return has_op, f"module={ADDON_MODULE} load_and_retarget={has_op}"


def _import_actor(path: str) -> bpy.types.Object:
    # Do not factory-reset: that drops addon prefs so BS() is None (verbose AttributeError).
    bpy.ops.import_scene.gltf(filepath=path)
    armatures = [ob for ob in bpy.context.scene.objects if ob.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError(f"no armature in imported actor {path}")
    # Prefer the armature with the most pose bones (the body, not an eye helper).
    arm = max(armatures, key=lambda ob: len(ob.pose.bones))
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    return arm


def _inject_target_map(scn: bpy.types.Scene, map_path: str) -> None:
    from bl_ext.user_default.retarget_bvh.bsettings import BD
    from bl_ext.user_default.retarget_bvh.target import CTargetInfo
    from bl_ext.user_default.retarget_bvh.utils import mcpRna

    BD.ensureInited(scn)
    info = CTargetInfo(scn, TARGET_NAME)
    info.readFile(map_path)
    BD.targetInfos[TARGET_NAME] = info
    if not any(item[0] == TARGET_NAME for item in BD.targetEnums):
        BD.targetEnums = list(BD.targetEnums) + [(TARGET_NAME, TARGET_NAME, TARGET_NAME)]
    mcpRna(scn).TargetRig = TARGET_NAME
    mcpRna(scn).TargetTPose = "Default"


def _iter_action_fcurves(action: bpy.types.Action):
    """Blender 5 layered actions have no action.fcurves — walk layers/strips/channelbags."""
    fcs = getattr(action, "fcurves", None)
    if fcs is not None and len(fcs) > 0:
        yield from fcs
        return
    for layer in getattr(action, "layers", None) or []:
        for strip in getattr(layer, "strips", []) or []:
            for bag in getattr(strip, "channelbags", []) or []:
                yield from getattr(bag, "fcurves", []) or []


def _driven_bones(arm: bpy.types.Object) -> list[dict]:
    ad = arm.animation_data
    action = ad.action if ad else None
    if action is None:
        return []
    by_bone: dict[str, dict[str, float]] = {}
    for fcu in _iter_action_fcurves(action):
        path = fcu.data_path or ""
        if 'pose.bones["' not in path or "rotation" not in path:
            continue
        name = path.split('pose.bones["', 1)[1].split('"]', 1)[0]
        keyframes = list(fcu.keyframe_points)
        if len(keyframes) < 2:
            continue
        values = [kp.co[1] for kp in keyframes]
        delta = max(values) - min(values)
        slot = by_bone.setdefault(name, {"keyframes": len(keyframes), "totalRotationDeltaRad": 0.0})
        slot["keyframes"] = max(int(slot["keyframes"]), len(keyframes))
        slot["totalRotationDeltaRad"] = float(slot["totalRotationDeltaRad"]) + abs(delta)
    return [
        {"bone": name, "keyframes": int(slot["keyframes"]), "totalRotationDeltaRad": slot["totalRotationDeltaRad"]}
        for name, slot in sorted(by_bone.items())
    ]


def _rename_action(arm: bpy.types.Object, name: str) -> str:
    ad = arm.animation_data
    if ad is None or ad.action is None:
        return ""
    ad.action.name = name
    return ad.action.name


def _export_armature_clip(arm: bpy.types.Object, out_path: str) -> None:
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    # Armature + its action only — factory stage output, not a recolour of the actor GLB.
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_skins=True,
        export_morph=False,
        export_materials="NONE",
        export_texcoords=False,
        export_normals=False,
        export_cameras=False,
        export_lights=False,
    )


def main(argv: list[str]) -> int:
    args = _parse_args(argv)
    log_lines: list[str] = []

    for required in (args.actor, args.clip, args.map):
        if not os.path.isfile(required):
            return _reject(args.report, f"missing_input:{required}", "")

    try:
        arm = _import_actor(args.actor)
        log_lines.append(f"actor_armature={arm.name} pose_bones={len(arm.pose.bones)}")
    except Exception as exc:  # noqa: BLE001
        return _reject(args.report, "actor_import_failed", f"{exc!r}\n{traceback.format_exc()}")

    # Enable after import so a later factory-reset cannot drop the operators.
    ok, enable_log = _enable_retarget_bvh()
    log_lines.append(enable_log)
    if not ok:
        return _reject(args.report, "retarget_bvh_not_runnable_headless", "\n".join(log_lines))

    try:
        from bl_ext.user_default.retarget_bvh.bsettings import BD
        from bl_ext.user_default.retarget_bvh.utils import getErrorMessage, setSilentMode
    except Exception as exc:  # noqa: BLE001
        return _reject(args.report, "retarget_bvh_import_failed", f"{exc!r}\n{traceback.format_exc()}")

    if BD.prefs is None:
        addon = bpy.context.preferences.addons.get(ADDON_MODULE)
        if addon and addon.preferences:
            BD.prefs = addon.preferences
    if BD.prefs is None:
        # Extension enable in --background sometimes leaves addons[module].preferences unset.
        # The operator exists (load_and_retarget=True); only BS().verbose etc. need a stand-in.
        class _HeadlessPrefs:
            verbose = False
            ignoreLeafBones = False
            useLimits = True
            useUnlock = False
            useBlenderBvh = True
            useNativeFbx = False

        keys = [k for k in bpy.context.preferences.addons.keys() if "retarget" in k.lower() or "bvh" in k.lower()]
        log_lines.append(f"prefs_missing addon_keys={keys}; using headless prefs stand-in")
        BD.prefs = _HeadlessPrefs()

    setSilentMode(True)
    try:
        _inject_target_map(bpy.context.scene, args.map)
        log_lines.append(f"target_map={TARGET_NAME} from {args.map}")

        bpy.ops.object.select_all(action="DESELECT")
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm

        bpy.ops.mcp.load_and_retarget(filepath=os.path.abspath(args.clip), useAutoTarget=False)
        err = getErrorMessage() or ""
        log_lines.append(f"load_and_retarget message={err!r}")
    except Exception as exc:  # noqa: BLE001
        return _reject(
            args.report,
            "load_and_retarget_raised",
            "\n".join(log_lines) + f"\n{exc!r}\n{traceback.format_exc()}",
        )

    driven = _driven_bones(arm)
    real = [
        b
        for b in driven
        if b["keyframes"] > 1 and b["totalRotationDeltaRad"] > MIN_TOTAL_DELTA_RAD
    ]
    clip_name = _rename_action(arm, CLIP_NAME) or CLIP_NAME
    log_lines.append(f"driven={len(driven)} real={len(real)} action={clip_name}")

    if len(real) < MIN_DRIVEN_BONES:
        return _reject(
            args.report,
            "zero_or_thin_channels",
            "\n".join(log_lines),
            extra={
                "sourceClip": args.clip,
                "targetRig": args.actor,
                "operator": "mcp.load_and_retarget",
                "drivenBones": driven,
                "realDrivenCount": len(real),
            },
        )

    try:
        _export_armature_clip(arm, args.output)
    except Exception as exc:  # noqa: BLE001
        return _reject(
            args.report,
            "export_failed",
            "\n".join(log_lines) + f"\n{exc!r}\n{traceback.format_exc()}",
        )

    payload = {
        "schemaVersion": "openclinxr.motion-bind-stage.v1",
        "stageId": STAGE_ID,
        "verdict": "ok",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceClip": args.clip,
        "targetRig": args.actor,
        "targetMap": args.map,
        "operator": "mcp.load_and_retarget",
        "addonModule": ADDON_MODULE,
        "outputGlb": args.output,
        "clipName": clip_name,
        "drivenBones": real,
        "drivenBoneCount": len(real),
        "totalRotationDeltaRad": sum(b["totalRotationDeltaRad"] for b in real),
        "outputBytes": os.path.getsize(args.output) if os.path.isfile(args.output) else 0,
        "log": "\n".join(log_lines),
        "claimScope": "one_actor_one_clip_retarget_bind_not_a_motion_library",
        "notEvidenceFor": [
            "clinical_motion_realism",
            "quest_readiness",
            "visual_walk_quality",
            "runtime_playback",
        ],
    }
    _write_report(args.report, payload)
    print(json.dumps({"verdict": "ok", "clipName": clip_name, "driven": len(real), "output": args.output}))
    return 0


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    try:
        raise SystemExit(main(argv))
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 — last-chance reject_measured
        report = "motion-bind-crash-report.json"
        if "--report" in argv:
            idx = argv.index("--report")
            if idx + 1 < len(argv):
                report = argv[idx + 1]
        _reject(report, "unhandled_exception", f"{exc!r}\n{traceback.format_exc()}")
        raise SystemExit(2)
