#!/usr/bin/env python3
"""Bind one extracted CC0 seated clip onto one MPFB actor via retarget_bvh.

Mirrors motion_bind_stage.py but injects a SOURCE map too: the source rig is
renamed from raw joint names to MHX canonical names before retarget, so the
target map's clavicle/finger entries actually bind.
"""
import argparse, json, os, sys, traceback
from datetime import datetime, timezone
from pathlib import Path

import bpy

STAGE_ID = "seated_clip_bind_stage"
ADDON_MODULE = "bl_ext.user_default.retarget_bvh"
TARGET_NAME = "MPFB2 default_no_toes"
SOURCE_MAP_NAME = "Mesh2Motion human-base-animations (Sitting_Talking)"
CLIP_NAME = "openclinxr_retarget_seated_talking_cc0"
MIN_DRIVEN_BONES = 8
MIN_TOTAL_DELTA_RAD = 0.01

def _parse_args(argv):
    ap = argparse.ArgumentParser(description="Bind seated CC0 clip onto MPFB actor")
    ap.add_argument("--actor", required=True)
    ap.add_argument("--clip", required=True)
    ap.add_argument("--map", required=True)
    ap.add_argument("--source-map", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--report", required=True)
    return ap.parse_args(argv)

def _write_report(path, payload):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

def _reject(report_path, reason, log, extra=None):
    payload = {
        "schemaVersion": "openclinxr.seated-clip-bind.v1",
        "stageId": STAGE_ID,
        "verdict": "reject_measured",
        "reason": reason,
        "log": log[-8000:],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        **(extra or {}),
    }
    _write_report(report_path, payload)
    print(f"REJECT_MEASURED {reason}", file=sys.stderr)
    return 2

def _enable_retarget_bvh():
    import addon_utils
    try:
        addon_utils.enable(ADDON_MODULE)
    except Exception as exc:
        return False, f"addon_utils.enable raised {exc!r}"
    has_op = hasattr(bpy.ops, "mcp") and hasattr(bpy.ops.mcp, "load_and_retarget")
    return has_op, f"module={ADDON_MODULE} load_and_retarget={has_op}"

def _import_actor(path):
    bpy.ops.import_scene.gltf(filepath=path)
    armatures = [ob for ob in bpy.context.scene.objects if ob.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError(f"no armature in imported actor {path}")
    arm = max(armatures, key=lambda ob: len(ob.pose.bones))
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    return arm

def _inject_maps(scn, target_map_path, source_map_path):
    from bl_ext.user_default.retarget_bvh.bsettings import BD
    from bl_ext.user_default.retarget_bvh.source import CSourceInfo
    from bl_ext.user_default.retarget_bvh.target import CTargetInfo
    from bl_ext.user_default.retarget_bvh.utils import mcpRna

    BD.ensureInited(scn)
    tinfo = CTargetInfo(scn, TARGET_NAME)
    tinfo.readFile(target_map_path)
    BD.targetInfos[TARGET_NAME] = tinfo
    sinfo = CSourceInfo(scn, SOURCE_MAP_NAME)
    sinfo.readFile(source_map_path)
    BD.sourceInfos[SOURCE_MAP_NAME] = sinfo
    BD.activeSrcInfo = sinfo
    if not any(item[0] == TARGET_NAME for item in BD.targetEnums):
        BD.targetEnums = list(BD.targetEnums) + [(TARGET_NAME, TARGET_NAME, TARGET_NAME)]
    mcpRna(scn).TargetRig = TARGET_NAME
    mcpRna(scn).TargetTPose = "Default"
    # SourceRig stays Automatic: load_and_retarget's findSourceArmature(auto=True)
    # fingerprints against known maps and will match ours by name.
    return sinfo

def _iter_action_fcurves(action):
    fcs = getattr(action, "fcurves", None)
    if fcs is not None and len(fcs) > 0:
        yield from fcs
        return
    for layer in getattr(action, "layers", None) or []:
        for strip in getattr(layer, "strips", []) or []:
            for bag in getattr(strip, "channelbags", []) or []:
                yield from getattr(bag, "fcurves", []) or []

def _driven_bones(arm):
    ad = arm.animation_data
    action = ad.action if ad else None
    if action is None:
        return []
    by_bone = {}
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
        {"bone": n, "keyframes": int(s["keyframes"]), "totalRotationDeltaRad": s["totalRotationDeltaRad"]}
        for n, s in sorted(by_bone.items())
    ]

def main(argv):
    args = _parse_args(argv)
    log_lines = []
    for required in (args.actor, args.clip, args.map, args.source_map):
        if not os.path.isfile(required):
            return _reject(args.report, f"missing_input:{required}", "")
    try:
        startup_objects = set(bpy.context.scene.objects)
        arm = _import_actor(args.actor)
        actor_objects = set(bpy.context.scene.objects) - startup_objects
        log_lines.append(
            f"actor_armature={arm.name} pose_bones={len(arm.pose.bones)} actor_objects={len(actor_objects)}"
        )
    except Exception as exc:
        return _reject(args.report, "actor_import_failed", f"{exc!r}\n{traceback.format_exc()}")

    ok, enable_log = _enable_retarget_bvh()
    log_lines.append(enable_log)
    if not ok:
        return _reject(args.report, "retarget_bvh_not_runnable_headless", "\n".join(log_lines))

    try:
        from bl_ext.user_default.retarget_bvh.bsettings import BD
        from bl_ext.user_default.retarget_bvh.utils import getErrorMessage, setSilentMode
    except Exception as exc:
        return _reject(args.report, "retarget_bvh_import_failed", f"{exc!r}\n{traceback.format_exc()}")

    if BD.prefs is None:
        addon = bpy.context.preferences.addons.get(ADDON_MODULE)
        if addon and addon.preferences:
            BD.prefs = addon.preferences
    if BD.prefs is None:
        class _HeadlessPrefs:
            verbose = False
            ignoreLeafBones = False
            useLimits = True
            useUnlock = False
            useBlenderBvh = True
            useNativeFbx = False
        BD.prefs = _HeadlessPrefs()
        log_lines.append("prefs_missing; using headless prefs stand-in")

    setSilentMode(True)
    try:
        sinfo = _inject_maps(bpy.context.scene, args.map, args.source_map)
        log_lines.append(f"injected source_map={sinfo.name} entries={len(sinfo.bones)}")
        bpy.ops.object.select_all(action="DESELECT")
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.mcp.load_and_retarget(filepath=os.path.abspath(args.clip), useAutoTarget=False)
        err = getErrorMessage() or ""
        log_lines.append(f"load_and_retarget message={err!r}")
    except Exception as exc:
        return _reject(
            args.report,
            "load_and_retarget_raised",
            "\n".join(log_lines) + f"\n{exc!r}\n{traceback.format_exc()}",
        )

    driven = _driven_bones(arm)
    real = [b for b in driven if b["keyframes"] > 1 and b["totalRotationDeltaRad"] > MIN_TOTAL_DELTA_RAD]
    ad = arm.animation_data
    if ad is None or ad.action is None:
        return _reject(args.report, "no_action_after_retarget", "\n".join(log_lines))
    ad.action.name = CLIP_NAME
    log_lines.append(f"driven={len(driven)} real={len(real)} action={CLIP_NAME}")

    if len(real) < MIN_DRIVEN_BONES:
        return _reject(
            args.report,
            "zero_or_thin_channels",
            "\n".join(log_lines),
            extra={"drivenBones": driven, "realDrivenCount": len(real)},
        )

    extras = {ob for ob in bpy.context.scene.objects if ob.type == "ARMATURE" and ob not in actor_objects}
    for ob in list(extras):
        bpy.data.objects.remove(ob, do_unlink=True)
    for ob in list(startup_objects):
        if ob.name in bpy.data.objects:
            bpy.data.objects.remove(ob, do_unlink=True)
    mesh_count = sum(1 for ob in bpy.context.scene.objects if ob.type == "MESH")
    log_lines.append(f"scene_meshes={mesh_count}")
    if mesh_count < 1:
        return _reject(args.report, "zero_meshes", "\n".join(log_lines), extra={"realDrivenCount": len(real)})

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    try:
        bpy.ops.export_scene.gltf(filepath=args.output, export_format="GLB", export_animations=True)
    except Exception as exc:
        return _reject(args.report, "export_failed", "\n".join(log_lines) + f"\n{exc!r}\n{traceback.format_exc()}")

    payload = {
        "schemaVersion": "openclinxr.seated-clip-bind.v1",
        "stageId": STAGE_ID,
        "verdict": "ok",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceClip": args.clip,
        "targetRig": args.actor,
        "targetMap": args.map,
        "sourceMap": args.source_map,
        "operator": "mcp.load_and_retarget",
        "addonModule": ADDON_MODULE,
        "outputGlb": args.output,
        "clipName": CLIP_NAME,
        "drivenBones": real,
        "drivenBoneCount": len(real),
        "outputMeshCount": mesh_count,
        "totalRotationDeltaRad": sum(b["totalRotationDeltaRad"] for b in real),
        "outputBytes": os.path.getsize(args.output),
        "log": "\n".join(log_lines),
        "claimScope": "one_actor_one_cc0_seated_clip_retarget_bind_not_a_motion_library",
        "notEvidenceFor": ["clinical_motion_realism", "quest_readiness", "visual_motion_quality", "runtime_playback"],
    }
    _write_report(args.report, payload)
    print(json.dumps({"verdict": "ok", "clipName": CLIP_NAME, "driven": len(real), "output": args.output}))
    return 0

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    raise SystemExit(main(argv))
