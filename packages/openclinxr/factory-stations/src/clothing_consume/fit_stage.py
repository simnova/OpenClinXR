#!/usr/bin/env python3
"""#215 MakeClothes factory FIT stage — library consumption path.

Deterministic factory station: load MPFB hm08 basemesh, fit one CC-BY .mhclo via
ClothesService.fit_clothes_to_human, export a library GLB + grade PNG + stage report.

This is NOT the cagematch probe (tools/openclinxr/evidence/blender/makeclothes_anny_reference_stage.py).
It does NOT transfer onto Anny, does NOT rewrite automate_blender.py, and does NOT vendor MPFB
(GPL — user extension only).

claimScope: local factory library artifact + provenance stamp only.
notEvidenceFor: clinical wardrobe correctness, Quest readiness, converting shipped Anny roles,
shipping GPL MPFB code, full body migration.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
import traceback
from pathlib import Path

import bpy
from mathutils import Vector

_STATION_DIR = str(Path(__file__).resolve().parent)
if _STATION_DIR not in sys.path:
    sys.path.insert(0, _STATION_DIR)
from refit_materials import assign_garment_material, assign_skin_material


STAGE_ID = "makeclothes_fit_stage"
NOT_EVIDENCE_FOR = [
    "clinical_appropriateness",
    "quest_readiness",
    "learner_readiness",
    "converting_shipped_anny_roles",
    "shipping_mpfb_or_gpl_code_in_repo",
    "full_anny_to_hm08_migration",
]


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    p = argparse.ArgumentParser(description="MakeClothes factory fit stage")
    p.add_argument("--mhclo", required=True)
    p.add_argument("--garment-obj", required=True)
    p.add_argument("--mh-base-obj", required=True, help="MPFB data/3dobjs/base.obj (hm08)")
    p.add_argument(
        "--anny-obj",
        default="",
        help="Optional Anny reference OBJ for stature/foot align (0044 ~2.3 cm mean error path)",
    )
    p.add_argument("--out-glb", required=True, help="Library GLB path (hm08 body + fitted garment)")
    p.add_argument("--out-grade-png", required=True)
    p.add_argument("--report", required=True)
    p.add_argument(
        "--garment-mesh-name",
        default="makeclothes_library_scrub_shirt",
        help="Mesh name for the fitted garment. DEFAULT IS THE FACTORY FALLBACK (#275) — "
        "the caller (fit-cli.ts) supplies the authoritative value from "
        "garment-selection-by-role.ts; this default only exists so a raw invocation "
        "still produces a named garment.",
    )
    p.add_argument("--body-mesh-name", default="hm08_basemesh_library")
    # Refit contract (pants-fit proof 2026-09-05). Optional passthrough only; when
    # absent the station keeps its legacy behavior. Values land in the report.
    p.add_argument("--garment-source-hash", default="")
    p.add_argument("--body-identity", default="")
    p.add_argument("--binding-topology-id", default="")
    p.add_argument("--license-token", default="")
    p.add_argument("--license-source", default="")
    # Per-actor body definition (2026-09-05). JSON: { macros?, statureTargetM?, bodyAssetId? }.
    # Canonical source is the MPFB macro dict + stature target derived from the
    # case-authored phenotype (body_param/phenotype_macros.py); actor-casting maps
    # role->shipped GLB (artifacts, no params), so bodyAssetId is provenance only.
    # Absent = legacy default-body behavior.
    p.add_argument("--body-definition", default="")
    # Phenotype skin_tone for the body material (case-authored phenotype).
    # Absent/unknown = legacy Display colour with a recorded reason.
    p.add_argument("--skin-tone", default="")
    # DEFAULT IS STILL THE RAW IMPORT, deliberately. `--create-human` is PROVEN for the BODY
    # (19,158 verts / 152 vgroups / no helper shell, against 73,920 / 0 / shell-shrouded) and is NOT
    # yet correct end to end: the Anny stature-align step below re-scales the body and re-parents the
    # garment, and create_human arrives already grounded and scaled, so the garment lands ~1.2 m off
    # the body. Measured, not guessed. Flipping the default before that is fixed would ship a station
    # whose garment is not on its body.
    p.add_argument("--legacy-base-obj", action="store_true",
                   help="Comparison path: raw-import data/3dobjs/base.obj, WITH its helper shell.")
    return p.parse_args(args)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def enable_mpfb() -> dict:
    status: dict = {
        "module": "bl_ext.user_default.mpfb",
        "enabled": False,
        "error": None,
        "version": None,
        "manifestPath": None,
        "licenseSpdxFromManifest": None,
    }
    try:
        bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
        status["enabled"] = "bl_ext.user_default.mpfb" in bpy.context.preferences.addons
        home = Path.home()
        manifest = (
            home
            / "Library/Application Support/Blender/5.1/extensions/user_default/mpfb/blender_manifest.toml"
        )
        if manifest.is_file():
            status["manifestPath"] = str(manifest)
            text = manifest.read_text(encoding="utf-8", errors="replace")
            for line in text.splitlines():
                if "SPDX:" in line:
                    status["licenseSpdxFromManifest"] = (
                        line.strip().strip(",").strip('"').replace("SPDX:", "")
                    )
                if line.strip().startswith("version"):
                    status["manifestVersion"] = line.split("=", 1)[-1].strip().strip('"')
    except Exception as exc:  # noqa: BLE001
        status["error"] = f"{type(exc).__name__}: {exc}"
        status["traceback"] = traceback.format_exc()[-2000:]
    return status


def world_bounds(obj: bpy.types.Object) -> dict:
    coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
    xs = [c.x for c in coords]
    ys = [c.y for c in coords]
    zs = [c.z for c in coords]
    return {
        "min": [min(xs), min(ys), min(zs)],
        "max": [max(xs), max(ys), max(zs)],
        "size": [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)],
        "vertexCount": len(coords),
    }


def stature_meters(obj: bpy.types.Object) -> float:
    return max(world_bounds(obj)["size"])


def sha256_json(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def garment_signature(obj: bpy.types.Object) -> dict:
    return {
        "vertices": len(obj.data.vertices),
        "faces": len(obj.data.polygons),
        "topologySha256": sha256_json([list(p.vertices) for p in obj.data.polygons]),
        "uvSha256": sha256_json([[list(d.uv) for d in layer.data] for layer in obj.data.uv_layers]),
        "uvLayers": len(obj.data.uv_layers),
    }


def max_binding_vertex_index(mhclo: object) -> int:
    verts = getattr(mhclo, "verts", None) or {}
    idx = [i for info in verts.values() for i in (info.get("verts") or [])]
    return max(idx) if idx else -1


def refuse_fit(report: dict, report_path: str, reason: str, t0: float) -> None:
    # Explicit refusal. Never a renamed body-derived cover shell under the garment name.
    report["status"] = "refused"
    report["refusalReason"] = reason
    refit = report.get("refit")
    if isinstance(refit, dict):
        refit["refusalReason"] = reason
    else:
        report["refit"] = {"active": True, "refusalReason": reason}
    report["totalWallClockS"] = round(time.perf_counter() - t0, 3)
    write_report(report_path, report)
    print(json.dumps({"status": "refused", "refusalReason": reason, "report": report_path}))


def parse_body_definition(raw: str) -> tuple:
    # Pure-python parse of --body-definition JSON. Returns (definition, error).
    text = (raw or "").strip()
    if not text:
        return None, None
    try:
        parsed = json.loads(text)
    except Exception as exc:  # noqa: BLE001
        return None, f"bodyDefinition is not valid JSON: {exc}"
    if not isinstance(parsed, dict):
        return None, "bodyDefinition must be a JSON object"
    macros_raw = parsed.get("macros", {})
    if not isinstance(macros_raw, dict):
        return None, "bodyDefinition.macros must be an object"
    macros: dict = {}
    for key, val in macros_raw.items():
        if key == "race":
            continue
        try:
            macros[key] = float(val)
        except (TypeError, ValueError):
            return None, f"bodyDefinition.macros.{key} is not a number"
    race = None
    if isinstance(macros_raw.get("race"), dict):
        try:
            race = {k: float(v) for k, v in macros_raw["race"].items()}
        except (TypeError, ValueError):
            return None, "bodyDefinition.macros.race values must be numbers"
    target = parsed.get("statureTargetM")
    stature_target_m = None
    if target is not None:
        try:
            stature_target_m = float(target)
        except (TypeError, ValueError):
            return None, "bodyDefinition.statureTargetM is not a number"
        if not stature_target_m > 0:
            return None, "bodyDefinition.statureTargetM must be positive"
    asset = parsed.get("bodyAssetId")
    return {
        "macros": macros,
        "race": race,
        "statureTargetM": stature_target_m,
        "bodyAssetId": str(asset) if asset is not None else None,
    }, None


def build_actor_body(HumanService, TargetService, definition: dict, mesh_name: str) -> tuple:
    # Per-actor body (pants-fit-proof.py make_body pattern): create_human with the
    # actor macro dict, bake immediately, solve height against the stature target
    # by rebuilding, ground by translation. Never scales garment or body.
    base = TargetService.get_default_macro_info_dict()
    base.update({k: v for k, v in definition["macros"].items() if k in base})
    if definition.get("race") and isinstance(base.get("race"), dict):
        base["race"].update(definition["race"])
    info: dict = {"macroKeys": sorted(definition["macros"].keys()), "heightTrials": []}

    def _make(macros: dict, name: str) -> bpy.types.Object:
        obj = HumanService.create_human(
            mask_helpers=True, detailed_helpers=True,
            extra_vertex_groups=True, feet_on_ground=False,
            macro_detail_dict=macros,
        )
        TargetService.bake_targets(obj)
        bpy.context.view_layer.update()
        obj.location.z -= world_bounds(obj)["min"][2]
        bpy.context.view_layer.update()
        obj.name = name
        return obj

    target = definition.get("statureTargetM")
    if target is not None:
        lo, hi = 0.2, 0.8
        trial = None
        for _ in range(10):
            base["height"] = (lo + hi) / 2
            trial = _make(dict(base), "body_definition_height_trial")
            height = stature_meters(trial)
            info["heightTrials"].append({"heightMacro": base["height"], "statureM": height})
            if abs(height - target) < 0.0005:
                break
            if height < target:
                lo = base["height"]
            else:
                hi = base["height"]
            bpy.data.objects.remove(trial, do_unlink=True)
            trial = None
        if trial is None:
            trial = _make(dict(base), "body_definition_height_trial")
            height = stature_meters(trial)
            info["heightTrials"].append({"heightMacro": base["height"], "statureM": height})
        body = trial
        body.name = mesh_name
        info["solvedHeightMacro"] = base["height"]
        info["measuredStatureM"] = stature_meters(body)
        info["statureTargetM"] = target
    else:
        body = _make(dict(base), mesh_name)
        info["measuredStatureM"] = stature_meters(body)
    if definition.get("bodyAssetId"):
        info["bodyAssetId"] = definition["bodyAssetId"]
    return body, info


def apply_object_transforms(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.update()


def force_z_up_standing(obj: bpy.types.Object) -> None:
    apply_object_transforms(obj)
    b = world_bounds(obj)
    size = b["size"]
    axis = max(range(3), key=lambda i: size[i])
    if axis == 1:
        obj.rotation_euler[0] = math.radians(90.0)
    elif axis == 0:
        obj.rotation_euler[1] = math.radians(-90.0)
    bpy.context.view_layer.update()
    apply_object_transforms(obj)
    b2 = world_bounds(obj)
    if abs(b2["min"][2]) > abs(b2["max"][2]) and b2["min"][2] < -0.1:
        obj.rotation_euler[0] = math.radians(180.0)
        bpy.context.view_layer.update()
        apply_object_transforms(obj)
    obj.location.z -= world_bounds(obj)["min"][2]
    bpy.context.view_layer.update()
    apply_object_transforms(obj)


def import_obj(path: str, name: str, *, force_z: bool) -> bpy.types.Object:
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path)
    created = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not created:
        raise RuntimeError(f"OBJ import produced no mesh: {path}")
    obj = created[0]
    obj.name = name
    if force_z:
        force_z_up_standing(obj)
    return obj


def make_material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    # Legacy helper — kept for callers that never migrated to refit_materials.
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    principled = mat.node_tree.nodes["Principled BSDF"]
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = 0.65
    return mat


def align_body_to_reference(body: bpy.types.Object, reference: bpy.types.Object) -> dict:
    ref_b = world_bounds(reference)
    body_b = world_bounds(body)
    ref_stature = max(ref_b["size"])
    body_stature = max(body_b["size"])
    scale = ref_stature / body_stature if body_stature > 1e-8 else 1.0
    body.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    body_b2 = world_bounds(body)
    ref_min, ref_max = ref_b["min"], ref_b["max"]
    body_min, body_max = body_b2["min"], body_b2["max"]
    ref_cx = 0.5 * (ref_min[0] + ref_max[0])
    ref_cy = 0.5 * (ref_min[1] + ref_max[1])
    body_cx = 0.5 * (body_min[0] + body_max[0])
    body_cy = 0.5 * (body_min[1] + body_max[1])
    body.location.x += ref_cx - body_cx
    body.location.y += ref_cy - body_cy
    body.location.z += ref_min[2] - body_min[2]
    bpy.context.view_layer.update()
    return {
        "uniformScale": scale,
        "referenceStatureMeters": ref_stature,
        "bodyStatureBeforeScaleMeters": body_stature,
        "bodyStatureAfterScaleMeters": stature_meters(body),
    }


def export_objects_glb(objects: list[bpy.types.Object], path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        use_selection=True,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_skins=False,
        export_animations=False,
    )


def setup_camera_front(target_z: float = 0.95, distance: float = 2.8) -> None:
    cam_data = bpy.data.cameras.new("fit_stage_cam")
    cam = bpy.data.objects.new("fit_stage_cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.location = (0.0, -distance, target_z)
    direction = Vector((0.0, 0.0, target_z)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    light_data = bpy.data.lights.new(name="fit_stage_key", type="AREA")
    light_data.energy = 120.0
    light = bpy.data.objects.new(name="fit_stage_key", object_data=light_data)
    bpy.context.scene.collection.objects.link(light)
    light.location = (1.2, -1.5, 2.0)


def render_png(path: str, res: int = 768) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.render.filepath = path
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)


def write_report(path: str, report: dict) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    report: dict = {
        "schemaVersion": "openclinxr.makeclothes-fit-stage.v1",
        "producedByStage": STAGE_ID,
        "notEvidenceFor": NOT_EVIDENCE_FOR,
        "mpfb": {},
        "steps": {},
        "materials": {},
        "artifacts": {},
        "errors": [],
        "status": "started",
    }
    t0 = time.perf_counter()
    clear_scene()
    mpfb = enable_mpfb()
    report["mpfb"] = mpfb
    write_report(args.report, report)
    if not mpfb.get("enabled"):
        report["status"] = "mpfb_load_failed"
        report["totalWallClockS"] = round(time.perf_counter() - t0, 3)
        write_report(args.report, report)
        print(json.dumps(report))
        return

    try:
        from bl_ext.user_default.mpfb.services.clothesservice import ClothesService
        from bl_ext.user_default.mpfb.entities.objectproperties import GeneralObjectProperties
        from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo
        from bl_ext.user_default.mpfb.services.humanservice import HumanService
        from bl_ext.user_default.mpfb.services.objectservice import ObjectService
    except Exception as exc:  # noqa: BLE001
        report["status"] = "mpfb_import_failed"
        report["errors"].append(f"{type(exc).__name__}: {exc}")
        report["traceback"] = traceback.format_exc()[-2000:]
        write_report(args.report, report)
        print(json.dumps(report))
        return

    # Refit contract passthrough (pants-fit proof). Absent flags = legacy path.
    body_definition, body_definition_error = parse_body_definition(args.body_definition)
    refit_active = bool(
        args.body_identity or args.binding_topology_id or args.garment_source_hash
        or body_definition is not None or body_definition_error is not None
    )
    report["refit"] = {
        "active": refit_active,
        "garmentSource": {"mhcloPath": args.mhclo, "sourceHash": args.garment_source_hash or None},
        "bodyIdentity": args.body_identity or None,
        "bindingTopologyId": args.binding_topology_id or None,
        "bodyDefinition": body_definition,
        "license": {"token": args.license_token or None, "source": args.license_source or None},
        "fitMetrics": {},
        "refusalReason": None,
    }

    if body_definition_error is not None:
        refuse_fit(report, args.report, body_definition_error, t0)
        return

    try:
        # 1) Basemesh via HumanService.create_human — the documented single call.
        #
        # THE OLD COMMENT HERE READ: "base.obj + Basemesh tag (NOT create_human; probe measured wrong
        # placement)". That rejection is withdrawn, and the reason is measured (2026-08-25).
        #
        # Raw-importing data/3dobjs/base.obj carries MakeHuman HELPER geometry — an enclosing shell
        # from shoulders to ankles. It is why every grade render this station ever produced showed a
        # hooded floor-length robe and why two reviewers misread the same frame. Measured on the
        # shipped library GLB: X spans +/-0.27 at ANKLE height, and frames with the garment hidden vs
        # shown are pixel-identical, so the robe is the body and the garment is underneath it.
        #
        # WHY THE "wrong placement" PROBE WAS WRONG, reproduced here: measuring garment bounds
        # immediately after fit_clothes_to_human returns Z [-0.162, 0.092] — apparently at the feet,
        # below ground — because the depsgraph has not updated. Both objects carry identity
        # transforms. One bpy.context.view_layer.update() and the same fit measures [0.911, 1.430],
        # hip to shoulder. A stale depsgraph read looks exactly like wrong placement.
        #
        #   raw base.obj import : 73,920 verts,   0 vertex groups, shell-shrouded
        #   create_human()      : 19,158 verts, 152 vertex groups, smooth, feet grounded, no shell
        #
        # mask_helpers=True is the DEFAULT. The shell was arriving purely by bypassing this call.
        # --mh-base-obj is retained for the --legacy-base-obj comparison path only.
        if args.legacy_base_obj:
            mh = import_obj(args.mh_base_obj, args.body_mesh_name, force_z=False)
            create_human_used = False
        elif body_definition is not None:
            # Per-actor body (pants-fit-proof.py make_body): macros + bake + stature
            # solve + grounding. build_actor_body already bakes, so the legacy
            # refit-path bake below is skipped for this body.
            from bl_ext.user_default.mpfb.services.targetservice import TargetService as _PerActorTarget

            mh, actor_body_info = build_actor_body(
                HumanService, _PerActorTarget, body_definition, args.body_mesh_name
            )
            create_human_used = True
            report["steps"]["actorBody"] = actor_body_info
        else:
            # NO macro_detail_dict — this is MPFB's DEFAULT human, deliberately, and it is NOT
            # step 3 of the operator's process ("build a make human that looks like the anny model").
            #
            # DO NOT simply add macros here. Two things make that a trap:
            #
            #  1. ORDER IS LOAD-BEARING. `materialize_mpfb_humanoid_candidate.py:1714` records that
            #     macros must be BAKED with TargetService.bake_targets IMMEDIATELY after create_human.
            #     Without the bake the glTF basis is the default human and the macros ride along as
            #     zero-weight morph targets — measured there: five macro sets exported byte-identical
            #     bases, and baking made exported stature differ 1.00-2.37 m across the height macro.
            #     This call does not bake, so macros added here would silently do nothing.
            #
            #  2. THE DERIVATION ALREADY EXISTS and must not be hand-rolled a second time.
            #     `materialize_mpfb_humanoid_candidate.py` derives the dict from a TRACKED Anny
            #     reference BY MEASUREMENT — age from the reference's head-height fraction (0.100
            #     adult vs 0.160 child), height SOLVED so the baked-and-stripped EXPORTED body reaches
            #     the reference stature, the rest MPFB defaults.
            #
            # The architecturally correct fix is not to build a phenotype body here at all. Under the
            # operator's process the materializer owns steps 1-4 (describe -> Anny phenotype -> MPFB
            # match -> drop Anny) and this station owns step 5 (clothe it). This station should take an
            # ALREADY-MATERIALIZED MPFB body, which also deletes the fit-time Anny import that
            # currently violates step 4.
            mh = HumanService.create_human(
                mask_helpers=True,
                detailed_helpers=True,
                extra_vertex_groups=True,
                feet_on_ground=True,
            )
            mh.name = args.body_mesh_name
            create_human_used = True
        # Refit material assignment: authored .mhmat + phenotype skin where the
        # sources ship them; legacy Display fallbacks ONLY with a recorded
        # reason. Refusals above return before this; records land in materials.
        mh_mat = assign_skin_material(mh, args.skin_tone or "", "hm08_skin")
        report["materials"]["body"] = mh_mat
        # The Anny reference gets the same phenotype skin like-for-like.
        GeneralObjectProperties.set_value("object_type", "Basemesh", entity_reference=mh)
        bpy.context.view_layer.update()
        report["steps"]["mhLoad"] = {
            "source": "HumanService.create_human" if create_human_used else "mpfb_data_3dobjs_base.obj",
            "path": args.mh_base_obj if not create_human_used else None,
            "bounds": world_bounds(mh),
            "statureMeters": stature_meters(mh),
            "objectIsBasemesh": bool(ObjectService.object_is_basemesh(mh)),
            "vertexCount": len(mh.data.vertices),
            "vertexGroupCount": len(mh.vertex_groups),
            "createHumanUsed": create_human_used,
        }

        # 2) Fit real .mhclo on native-unit basemesh via ClothesService
        garment = import_obj(args.garment_obj, args.garment_mesh_name, force_z=False)
        garment_mat = assign_garment_material(garment, args.mhclo, "scrub_teal")
        report["materials"]["garment"] = garment_mat
        source_signature = garment_signature(garment)

        mhclo = Mhclo()
        mhclo.load(args.mhclo)
        try:
            mhclo.clothes = garment
        except Exception:
            pass

        # Refit path (pants-fit proof): binding indices must index THIS body
        # (per-actor when bodyDefinition is present, else the station default).
        if refit_active:
            from bl_ext.user_default.mpfb.services.targetservice import TargetService

            if body_definition is None:
                TargetService.bake_targets(mh)
            bpy.context.view_layer.update()
            max_ref = max_binding_vertex_index(mhclo)
            body_verts = len(mh.data.vertices)
            if max_ref >= body_verts or len(getattr(mhclo, "verts", {})) != len(garment.data.vertices):
                refuse_fit(
                    report,
                    args.report,
                    f"binding_topology_mismatch max_ref={max_ref} body_verts={body_verts} "
                    f"binding_verts={len(getattr(mhclo, 'verts', {}))} garment_verts={len(garment.data.vertices)}",
                    t0,
                )
                return

        t_fit = time.perf_counter()
        ClothesService.fit_clothes_to_human(garment, mh, mhclo=mhclo, set_parent=True)
        fit_s = time.perf_counter() - t_fit
        bpy.context.view_layer.update()

        # THE IMPORTER ROTATION MUST GO. Measured, after four wrong explanations.
        #
        # Blender's OBJ importer applies its Y-up -> Z-up conversion as an OBJECT ROTATION rather than
        # baking it into mesh data. `fit_clothes_to_human` then writes garment vertices in MESH-LOCAL
        # space to match the basemesh, whose data is already Z-up under an identity transform. The
        # garment's leftover importer rotation tips those correct local coords back to Y-up in world.
        #
        # Symptom with --create-human before this line: body longest axis Z (1.695 m standing) while
        # the garment's height ran along Y, bounds Y [-1.430, -0.911] — the exact span the torso
        # occupies on Z. Same magnitudes, rotated -90 deg about X.
        #
        # Explanations that were WRONG, recorded so nobody re-walks them: the Anny stature-align
        # (A/B'd out, bounds byte-identical with it skipped), a decimetre/metre scale mismatch, a
        # differing staging .obj (sha256-identical to the provider cache), and a rotation carried by
        # create_human (its transform is identity and its mesh data is already Z-up).
        if create_human_used:
            garment.matrix_world = mh.matrix_world.copy()
            bpy.context.view_layer.update()
        report["steps"]["clothesServiceFit"] = {
            "api": "ClothesService.fit_clothes_to_human",
            "wallClockS": round(fit_s, 4),
            "garmentMeshName": garment.name,
            "bodyMeshName": mh.name,
            "garmentBounds": world_bounds(garment),
            "garmentVertexCount": len(garment.data.vertices),
            "garmentPolygonCount": len(garment.data.polygons),
            "garmentTriangleEstimate": sum(len(p.vertices) - 2 for p in garment.data.polygons),
            "mhclo": args.mhclo,
            "garmentObj": args.garment_obj,
            "fittedOnNativeBaseObj": True,
            "notBodySurfaceDerived": True,
        }
        if refit_active:
            # Proof rule: topology/UV hashes must survive the fit unchanged.
            fitted_signature = garment_signature(garment)
            topology_preserved = fitted_signature["topologySha256"] == source_signature["topologySha256"]
            uv_preserved = fitted_signature["uvSha256"] == source_signature["uvSha256"]
            report["refit"]["garmentSource"]["signature"] = source_signature
            report["refit"]["fitMetrics"] = {
                "topologyPreserved": topology_preserved,
                "uvPreserved": uv_preserved,
                "fitWallClockS": round(fit_s, 4),
            }
            if not (topology_preserved and uv_preserved):
                refuse_fit(
                    report, args.report,
                    f"topology_uv_changed topology={topology_preserved} uv={uv_preserved}",
                    t0,
                )
                return

        # 3) Optional stature align to Anny reference (0044 measured path)
        if args.anny_obj and Path(args.anny_obj).is_file():
            anny = import_obj(args.anny_obj, "anny_stature_reference", force_z=True)
            anny_mat = assign_skin_material(anny, args.skin_tone or "", "anny_ref")
            report["materials"]["annyReference"] = anny_mat
            if garment.parent is not mh:
                garment.parent = mh
                garment.matrix_parent_inverse = mh.matrix_world.inverted()
            align = align_body_to_reference(mh, anny)
            bpy.context.view_layer.update()
            mw_g = garment.matrix_world.copy()
            garment.parent = None
            garment.matrix_world = mw_g
            apply_object_transforms(mh)
            apply_object_transforms(garment)
            report["steps"]["annyStatureAlign"] = align
            # Remove Anny after align — reference only; must not appear in grade PNG or confuse Workbench.
            bpy.data.objects.remove(anny, do_unlink=True)
        else:
            report["steps"]["annyStatureAlign"] = {"skipped": True}

        # 4) Export library GLB (hm08 + fitted garment only)
        export_objects_glb([mh, garment], args.out_glb)
        report["artifacts"]["libraryGlb"] = args.out_glb

        # 5) Grade PNG — front of fitted garment on hm08 only (no Anny reference)
        for obj in list(bpy.data.objects):
            if obj.type == "MESH" and obj not in (mh, garment):
                obj.hide_render = True
                obj.hide_viewport = True
        mh.hide_render = False
        mh.hide_viewport = False
        garment.hide_render = False
        garment.hide_viewport = False
        # Grade re-tint applies ONLY to the recorded fallback slot, so an authored
        # garment keeps its shipped material in the grade PNG too.
        if garment.data.materials and report.get("materials", {}).get("garment", {}).get("source") == "fallback":
            mat = garment.data.materials[0]
            if mat and mat.use_nodes:
                principled = mat.node_tree.nodes.get("Principled BSDF")
                if principled:
                    principled.inputs["Base Color"].default_value = (0.08, 0.55, 0.48, 1.0)
                    principled.inputs["Roughness"].default_value = 0.55
        setup_camera_front(target_z=0.95, distance=2.8)
        render_png(args.out_grade_png)
        report["artifacts"]["gradePng"] = args.out_grade_png

        report["status"] = "completed"
        report["garmentMeshNames"] = [garment.name]
        report["bodyMeshNames"] = [mh.name]
        report["totalWallClockS"] = round(time.perf_counter() - t0, 3)
        write_report(args.report, report)
        print(json.dumps({"status": "completed", "report": args.report, "glb": args.out_glb}))
    except Exception as exc:  # noqa: BLE001
        report["status"] = "failed"
        report["errors"].append(f"{type(exc).__name__}: {exc}")
        report["traceback"] = traceback.format_exc()[-3000:]
        report["totalWallClockS"] = round(time.perf_counter() - t0, 3)
        write_report(args.report, report)
        print(json.dumps(report))
        raise


if __name__ == "__main__":
    main()
