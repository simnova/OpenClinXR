#!/usr/bin/env python3
"""Bind one extracted CC0 seated clip onto one MPFB actor via retarget_bvh.

Mirrors motion_bind_stage.py but injects a SOURCE map too: the source rig is
renamed from raw joint names to MHX canonical names before retarget, so the
target map's clavicle/finger entries actually bind.

Report routing (#572): both this stage and motion_bind_stage write the SAME
output GLB, so this stage defaults its report to the asset-adjacent filename
derived from --output (<stem>.motion-bind-report.json beside the GLB) unless
--report is passed explicitly. Writing the default into tools/evidence left
the shipped asset's provenance describing a superseded bake.
"""
import argparse, hashlib, json, os, shutil, subprocess, sys, tempfile, traceback
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
    ap.add_argument("--report", default=None)
    ap.add_argument("--skin-recipe-id", default=None)
    ap.add_argument("--skin-attempt-dir", default=None)
    ap.add_argument("--skin-job-root", default=None)
    return ap.parse_args(argv)


def _default_report_path(output_path):
    """Asset-adjacent provenance name: the output GLB's '.glb' suffix replaced by '-report.json'.

    mpfb-peds-parent-aisha.motion-bind.glb -> mpfb-peds-parent-aisha.motion-bind-report.json —
    the exact filename motion-bind-cli.ts DEFAULT_REPORT ships beside the same GLB (and the one
    factory-case-cli.ts motionBindOutputs emits for the actor). Both stages write the same GLB,
    so the seated stage must not fork its record into tools/openclinxr/evidence (#572).
    """
    out = Path(output_path).resolve()
    if out.suffix == ".glb":
        return str(out.with_name(out.name[: -len(".glb")] + "-report.json"))
    return str(out.with_suffix(".json"))

def _write_report(path, payload):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

def _skin_mode(args):
    return bool(getattr(args, "skin_recipe_id", None))


def _fail(args, reason, log, extra=None):
    """Selected skin attempts record failure beside the attempt, never on the accepted report."""
    if not _skin_mode(args):
        return _reject(args.report, reason, log, extra)
    payload = {
        "schema": "openclinxr.factory-skin-stage-failure.v1",
        "reason": reason,
        "log": (log or "")[-8000:],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        **(extra or {}),
    }
    print(f"SKIN_PUBLISH_REFUSED {reason}", file=sys.stderr)
    attempt_raw = getattr(args, "skin_attempt_dir", None)
    job_raw = getattr(args, "skin_job_root", None)
    if not attempt_raw or not job_raw:
        return 2
    attempt = Path(attempt_raw).resolve()
    job = Path(job_raw).resolve()
    if not attempt.is_relative_to(job):
        print("SKIN_STAGE_FAILURE_REPORT_UNWRITTEN outside job root", file=sys.stderr)
        return 2
    failure = attempt / "stage-failure.json"
    if not attempt.is_dir():
        print("SKIN_STAGE_FAILURE_REPORT_UNWRITTEN attempt is not reserved", file=sys.stderr)
        return 2
    if failure.exists():
        print(f"SKIN_STAGE_FAILURE_REPORT_PRESERVED {failure}", file=sys.stderr)
        return 2
    try:
        with failure.open("x", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, indent=2) + "\n")
    except OSError as exc:
        print(f"SKIN_STAGE_FAILURE_REPORT_UNWRITTEN {exc!r}", file=sys.stderr)
    return 2


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
    # #585 sentinel (mirror of the canonical motion_bind_stage.py in
    # factory-stations): nameOrNone turns the target map's "None" values into
    # Python None, and this addon's addManualBones then assigns None into the
    # Bone StringProperty — Blender 5.1 RNA refuses that before the consumer's
    # own skip ever runs. The empty string is the RNA-default no-counterpart
    # value; sanitize here so the map keeps its loader-documented spelling.
    tinfo.bones = [(bname, "" if mhx is None else mhx) for (bname, mhx) in tinfo.bones]
    tinfo.boneNames = dict(tinfo.bones)
    BD.targetInfos[TARGET_NAME] = tinfo
    sinfo = CSourceInfo(scn, SOURCE_MAP_NAME)
    sinfo.readFile(source_map_path)
    sinfo.boneNames = {
        name: ("" if mhx is None else mhx) for (name, mhx) in sinfo.boneNames.items()
    }
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

def _repo_root():
    # makeclothes/ -> asset-pipeline/ -> openclinxr/ -> tools/ -> repo
    return Path(__file__).resolve().parents[4]


def _node_bin():
    for cand in (
        os.environ.get("OPENCLINXR_NODE"),
        os.environ.get("NODE"),
        shutil.which("node"),
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
    ):
        if cand and Path(cand).is_file():
            return cand
    raise RuntimeError("node_not_found_for_held_posture_correction")


def _correct_held_posture(output_glb, clip_path, log_lines):
    """Restore the source clip's held hip/knee flexion after retarget export.

    load_and_retarget's putInTPoses() overwrites source frame 0 with the T-pose,
    so aMatrix transfers ~3 deg of relative offset instead of ~87 deg of seated
    flexion. The GLB-level correction (postprocess-seated-glbs.mjs) sets
    q_anim[i] = q_rest @ q_source_global on the four leg bones for every frame.
    Invoked from this stage so a re-bake reproduces the sit with no manual step.
    """
    script = Path(__file__).resolve().parent / "postprocess-seated-glbs.mjs"
    if not script.is_file():
        raise RuntimeError(f"missing_postprocess:{script}")
    if not os.path.isfile(output_glb):
        raise RuntimeError(f"missing_output_glb:{output_glb}")
    node = _node_bin()
    cmd = [node, str(script), "--bvh", os.path.abspath(clip_path), os.path.abspath(output_glb)]
    proc = subprocess.run(
        cmd,
        cwd=str(_repo_root()),
        capture_output=True,
        text=True,
        timeout=120,
    )
    log_lines.append(
        f"held_posture_postprocess code={proc.returncode} stdout={(proc.stdout or '')[-1500:]!r}"
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"held_posture_postprocess_failed:{proc.stderr[-2000:] if proc.stderr else proc.stdout}"
        )
    log_lines.append("held_posture_corrected=true")


def _sha256(data):
    return hashlib.sha256(data).hexdigest()


def _write_publication_record(attempt, finished_bytes, receipt_bytes, outcome, bookkeeping_complete):
    payload = {
        "schema": "openclinxr.factory-skin-publication-record.v1",
        "actualOutputSha256": _sha256(finished_bytes),
        "lookupReceiptSha256": _sha256(receipt_bytes),
        "outcome": outcome,
        "receiptPrewritten": True,
        "bookkeepingComplete": bookkeeping_complete,
    }
    (Path(attempt) / "publication.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def finalize_factory_skin(source_glb, recipe_id=None, attempt_dir=None, job_root=None):
    """Bake and finish the posture-corrected GLB. Tests replace this function."""
    finish_dir = _repo_root() / "tools/openclinxr/asset-pipeline/skin/factory-finish"
    if str(finish_dir) not in sys.path:
        sys.path.insert(0, str(finish_dir))
    import importlib
    module = importlib.import_module("finalize")
    return module.finalize_source(source_glb, recipe_id, attempt_dir, job_root)


def _commit_factory_skin(args, tmp_glb, log_lines, driven, mesh_count):
    """Finish the final posture, then commit the GLB only after the receipt exists."""
    job = Path(args.skin_job_root).resolve()
    attempt = Path(args.skin_attempt_dir).resolve()
    output = Path(args.output).resolve()
    if not attempt.is_relative_to(job) or not output.is_relative_to(job):
        raise RuntimeError(f"skin publication path outside job root {job}")
    result = finalize_factory_skin(
        str(tmp_glb),
        recipe_id=args.skin_recipe_id,
        attempt_dir=str(attempt),
        job_root=str(job),
    )
    finished = Path(result.finished_glb)
    receipt = Path(result.receipt_path)
    if not finished.resolve().is_relative_to(job) or not receipt.resolve().is_relative_to(job):
        raise RuntimeError("finalizer wrote outside the job root")
    if not receipt.is_file():
        raise RuntimeError("skin receipt missing before GLB commit")
    receipt_bytes = receipt.read_bytes()
    finished_bytes = finished.read_bytes()
    claimed = json.loads(receipt_bytes).get("finishedSha256")
    observed = _sha256(finished_bytes)
    if (
        not isinstance(claimed, str)
        or len(claimed) != 64
        or any(char not in "0123456789abcdef" for char in claimed)
        or claimed != observed
    ):
        raise RuntimeError("finished GLB hash does not match its receipt")
    staging = attempt / "publication-staging.glb"
    if staging.exists():
        raise RuntimeError(f"publication staging already exists: {staging}")
    shutil.copyfile(finished, staging)
    if staging.read_bytes() != finished_bytes or not finished.is_file():
        raise RuntimeError("staged copy diverges from the immutable attempt finished GLB")
    os.replace(os.fspath(staging), args.output)
    if not finished.is_file() or finished.read_bytes() != finished_bytes:
        raise RuntimeError("publication consumed the attempt finished GLB")
    if Path(args.output).read_bytes() != finished_bytes:
        raise RuntimeError("published bytes diverged from the staged copy")
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
        "heldPostureCorrected": True,
        "skinRecipeId": args.skin_recipe_id,
        "addonModule": ADDON_MODULE,
        "outputGlb": args.output,
        "clipName": CLIP_NAME,
        "drivenBones": driven,
        "drivenBoneCount": len(driven),
        "outputMeshCount": mesh_count,
        "totalRotationDeltaRad": sum(b["totalRotationDeltaRad"] for b in driven),
        "outputBytes": os.path.getsize(args.output),
        "reportPath": args.report,
        "log": "\n".join(log_lines),
        "claimScope": "one_actor_one_cc0_seated_clip_retarget_bind_not_a_motion_library",
        "notEvidenceFor": ["clinical_motion_realism", "quest_readiness", "visual_motion_quality", "runtime_playback"],
    }
    try:
        _write_report(args.report, payload)
    except OSError:
        _write_publication_record(attempt, finished_bytes, receipt_bytes, "interrupted_recoverable", False)
        return 3
    _write_publication_record(attempt, finished_bytes, receipt_bytes, "committed", True)
    print(json.dumps({"verdict": "ok", "clipName": CLIP_NAME, "driven": len(driven), "output": args.output, "skinRecipeId": args.skin_recipe_id}))
    return 0


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
    # #572: default the provenance record to the asset-adjacent filename; an explicit
    # --report still wins so callers can route a copy into tools/openclinxr/evidence.
    if not args.report:
        args.report = _default_report_path(args.output)
    log_lines = []
    for required in (args.actor, args.clip, args.map, args.source_map):
        if not os.path.isfile(required):
            return _fail(args, f"missing_input:{required}", "")
    try:
        startup_objects = set(bpy.context.scene.objects)
        arm = _import_actor(args.actor)
        actor_objects = set(bpy.context.scene.objects) - startup_objects
        log_lines.append(
            f"actor_armature={arm.name} pose_bones={len(arm.pose.bones)} actor_objects={len(actor_objects)}"
        )
    except Exception as exc:
        return _fail(args, "actor_import_failed", f"{exc!r}\n{traceback.format_exc()}")

    ok, enable_log = _enable_retarget_bvh()
    log_lines.append(enable_log)
    if not ok:
        return _fail(args, "retarget_bvh_not_runnable_headless", "\n".join(log_lines))

    try:
        from bl_ext.user_default.retarget_bvh.bsettings import BD
        from bl_ext.user_default.retarget_bvh.utils import getErrorMessage, setSilentMode
    except Exception as exc:
        return _fail(args, "retarget_bvh_import_failed", f"{exc!r}\n{traceback.format_exc()}")

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
        return _fail(
            args,
            "load_and_retarget_raised",
            "\n".join(log_lines) + f"\n{exc!r}\n{traceback.format_exc()}",
        )

    driven = _driven_bones(arm)
    real = [b for b in driven if b["keyframes"] > 1 and b["totalRotationDeltaRad"] > MIN_TOTAL_DELTA_RAD]
    ad = arm.animation_data
    if ad is None or ad.action is None:
        return _fail(args, "no_action_after_retarget", "\n".join(log_lines))
    ad.action.name = CLIP_NAME
    log_lines.append(f"driven={len(driven)} real={len(real)} action={CLIP_NAME}")

    if len(real) < MIN_DRIVEN_BONES:
        return _fail(
            args,
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
        return _fail(args, "zero_meshes", "\n".join(log_lines), extra={"realDrivenCount": len(real)})

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    job_tmp = Path(
        os.environ.get("OPENCLINXR_JOB_TMP")
        or tempfile.mkdtemp(prefix=f"openclinxr-seated-{os.getpid()}-")
    )
    job_tmp.mkdir(parents=True, exist_ok=True)
    tmp_glb = job_tmp / f"{Path(args.output).stem}_{os.getpid()}_export.glb"
    try:
        bpy.ops.export_scene.gltf(filepath=str(tmp_glb), export_format="GLB", export_animations=True)
    except Exception as exc:
        return _fail(args, "export_failed", "\n".join(log_lines) + f"\n{exc!r}\n{traceback.format_exc()}")

    try:
        _correct_held_posture(str(tmp_glb), args.clip, log_lines)
        if getattr(args, "skin_recipe_id", None):
            return _commit_factory_skin(args, tmp_glb, log_lines, real, mesh_count)
        shutil.copy2(tmp_glb, args.output)
    except Exception as exc:
        reason = "skin_publish_refused" if getattr(args, "skin_recipe_id", None) else "held_posture_correction_failed"
        return _fail(
            args,
            reason,
            "\n".join(log_lines) + f"\n{exc!r}\n{traceback.format_exc()}",
        )
    finally:
        try:
            tmp_glb.unlink(missing_ok=True)
        except OSError:
            pass

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
        "heldPostureCorrected": True,
        "addonModule": ADDON_MODULE,
        "outputGlb": args.output,
        "clipName": CLIP_NAME,
        "drivenBones": real,
        "drivenBoneCount": len(real),
        "outputMeshCount": mesh_count,
        "totalRotationDeltaRad": sum(b["totalRotationDeltaRad"] for b in real),
        "outputBytes": os.path.getsize(args.output),
        "reportPath": args.report,
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
