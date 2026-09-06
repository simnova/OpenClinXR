#!/usr/bin/env python3
"""Rig refitted garments onto the actor's animated figure (clothing_consume EXPAND).

EXPAND, not a new station: the refit baker (fit_stage.py) exports UNRIGGED statics
(export_skins=False, export_animations=False — 2 mesh nodes, 0 skins) while the
runtime needs rigged figures (skinned armature + carried clips). This stage consumes
a refit GLB + its station report + the actor's body definition, rebuilds the actor's
body deterministically (fit_stage.build_actor_body: create_human + bake + stature
solve + grounding — the same calls the refit path used), binds the refitted
garment(s) to the actor's armature, carries animation clips by bone-name match, and
exports a rigged figure GLB with the station report extended (rigging block).

D1 wiring (no new rigger): rig creation + garment bind reuse body_param/rig_bind.py
(create_mpfb_mixamo_rig = HumanService.add_builtin_rig mixamo_unity + shipped CC0
weights; bind_meshes_to_canonical_armature = auto-weight + body->garment projection);
clip carrying copies actions by bone NAME only (name match, no new authoring);
export follows motion_bind_stage.py (full-object export, skins + animations).

Weight source per mesh: garments whose MakeClothes binding fully covers the mesh
(.mhclo verts == garment verts, indices valid) take weights from the binding
(copy the bound body vert's bone weights); where the binding lacks them the mesh
falls back to auto-weight (+envelope) with the body projection — recorded per mesh.

Refusals (never a static mislabeled as rigged): incompatible skeleton (refit body
topology != rebuilt body, clip bones outside the actor armature), zero skins at
export, bad body definition, unresolvable meshes.

claimScope: static bind pose + carried clips only.
notEvidenceFor: new animation authoring, Quest readiness, clinical fit.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import traceback
from pathlib import Path

try:
    import bpy  # type: ignore
except ImportError:  # plain-python test harness for the pure decision half
    bpy = None  # type: ignore

_STATION_DIR = str(Path(__file__).resolve().parent)
if _STATION_DIR not in sys.path:
    sys.path.insert(0, _STATION_DIR)

STAGE_ID = "rig_refit_stage"
REPORT_SCHEMA = "openclinxr.rig-refit-stage.v1"
NOT_EVIDENCE_FOR = [
    "new_animation_authoring",
    "quest_readiness",
    "learner_readiness",
    "clinical_fit",
    "shipping_mpfb_or_gpl_code_in_repo",
]

# Weight-source vocabulary recorded per mesh. "makeclothes_binding" wins where the
# binding covers the mesh; auto-weights (or the envelope fallback) only where it
# does not — the task's binding-first rule, made enumerable for the report.
WEIGHT_SOURCE_BINDING = "makeclothes_binding"
WEIGHT_SOURCE_AUTO = "auto_weight"
WEIGHT_SOURCE_ENVELOPE_FALLBACK = "envelope_fallback"
WEIGHT_SOURCE_SHIPPED_BODY = "shipped_cc0_weights"


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    p = argparse.ArgumentParser(description="Rig refitted garments onto the actor figure")
    p.add_argument("--refit-glb", required=True, help="Unrigged refit GLB (body + garment)")
    p.add_argument("--refit-report", required=True, help="Refit station report JSON to extend")
    p.add_argument("--body-definition", required=True,
                   help="JSON per-actor body definition (same grammar as fit_stage)")
    p.add_argument("--mhclo", default="",
                   help="Authored .mhclo for binding-derived weights (default: refit report path)")
    p.add_argument("--clip-source-glb", default="",
                   help="Optional rigged GLB whose clips are carried by bone-name match")
    p.add_argument("--out-glb", required=True, help="Rigged figure GLB path")
    p.add_argument("--report", required=True, help="Extended station report path")
    return p.parse_args(args)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def rig_identity(*, refit_sha256: str, body_definition: dict, clip_sha256: str | None) -> str:
    """Deterministic identity: same refit + body -> same rigged output."""
    canonical = json.dumps(
        {
            "stageId": STAGE_ID,
            "refitSha256": refit_sha256,
            "bodyDefinition": body_definition,
            "clipSourceSha256": clip_sha256,
        },
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def describe_garment_weight_source(
    *,
    binding_covers: bool,
    binding_coverage: float,
    auto_mode: str | None = None,
) -> dict:
    """Pure-python binding-first weight-source decision. No bpy."""
    if binding_covers:
        return {
            "weightSource": WEIGHT_SOURCE_BINDING,
            "bindingCoverage": round(binding_coverage, 5),
            "reason": None,
        }
    record = {
        "weightSource": WEIGHT_SOURCE_AUTO,
        "bindingCoverage": round(binding_coverage, 5),
        "reason": "makeclothes binding lacks full coverage — auto-weights",
    }
    if auto_mode == "envelope":
        record["weightSource"] = WEIGHT_SOURCE_ENVELOPE_FALLBACK
        record["reason"] = (
            "makeclothes binding lacks full coverage and auto-weight failed — "
            "envelope fallback"
        )
    return record


def check_skeleton_compatible(
    *,
    refit_body_verts: int,
    rebuilt_body_verts: int,
    clip_bones: set,
    actor_bones: set,
) -> str | None:
    """Pure-python compatibility gate. Returns a refusal reason or None.

    Refuse on incompatible skeleton rather than shipping a static mislabeled
    as rigged: a body-vert mismatch means the refit is not this actor's body,
    and clip bones outside the actor armature mean the clips cannot ride it.
    """
    if refit_body_verts != rebuilt_body_verts:
        return (
            f"refit_body_topology_mismatch refit_body_verts={refit_body_verts} "
            f"rebuilt_body_verts={rebuilt_body_verts}"
        )
    outside = sorted(set(clip_bones) - set(actor_bones))
    if outside:
        return (
            f"clip_skeleton_mismatch {len(outside)} clip bones outside actor armature: "
            f"{outside[:8]}"
        )
    return None


def build_rigging_block(
    *,
    joint_count: int,
    bone_names: list,
    mesh_weights: list,
    animation_clips: list,
    body_rebuild: dict,
    identity: str,
) -> dict:
    """Pure-python rigging report block. No bpy."""
    return {
        "jointCount": joint_count,
        "boneNames": list(bone_names),
        "weightSourcePerMesh": list(mesh_weights),
        "animationClips": list(animation_clips),
        "bodyRebuild": dict(body_rebuild),
        "rigIdentity": identity,
        "bindPose": "static",
        "claimScope": "static_bind_pose_plus_carried_clips",
    }


def extend_refit_report(refit_report: dict, rigging: dict, *, status: str) -> dict:
    """Pure-python report extension: carry the refit block, add rigging. No bpy."""
    extended = {
        "schemaVersion": REPORT_SCHEMA,
        "producedByStage": STAGE_ID,
        "notEvidenceFor": NOT_EVIDENCE_FOR,
        "status": status,
        "refit": refit_report.get("refit"),
        "rigging": rigging,
        "errors": list(refit_report.get("errors") or []),
    }
    for key in ("garmentMeshNames", "bodyMeshNames", "materials", "mpfb"):
        if key in refit_report:
            extended[key] = refit_report[key]
    return extended


def write_report(path: str, report: dict) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def _refuse(report_path: str, refit_report: dict, reason: str, t0: float) -> None:
    rigging = build_rigging_block(
        joint_count=0,
        bone_names=[],
        mesh_weights=[],
        animation_clips=[],
        body_rebuild={},
        identity="",
    )
    rigging["refusalReason"] = reason
    report = extend_refit_report(refit_report, rigging, status="refused")
    report["totalWallClockS"] = round(time.perf_counter() - t0, 3)
    write_report(report_path, report)
    print(json.dumps({"status": "refused", "refusalReason": reason, "report": report_path}))


def _binding_coverage(Mhclo, mhclo_path: str, garment, body_vert_count: int) -> tuple[bool, float]:
    """Fraction of garment verts with a valid MakeClothes binding entry."""
    try:
        mhclo = Mhclo()
        mhclo.load(mhclo_path)
    except Exception:
        return False, 0.0
    verts = getattr(mhclo, "verts", None) or {}
    garment_count = len(garment.data.vertices)
    if not verts or len(verts) != garment_count:
        coverage = (len(verts) / garment_count) if garment_count else 0.0
        return False, coverage
    valid = 0
    for info in verts.values():
        bound = info.get("verts") or []
        if bound and all(0 <= i < body_vert_count for i in bound):
            valid += 1
    coverage = (valid / garment_count) if garment_count else 0.0
    return valid == garment_count, coverage


def _project_binding_weights(basemesh, garment, Mhclo, mhclo_path: str, bone_names: set) -> dict:
    """Copy bound body-vert bone weights onto garment verts via the .mhclo map."""
    status: dict = {"ok": False, "method": "makeclothes_binding_projection", "error": None}
    try:
        mhclo = Mhclo()
        mhclo.load(mhclo_path)
        body_group_names = {g.index: g.name for g in basemesh.vertex_groups}
        body_weights: list[list[tuple[str, float]]] = []
        for v in basemesh.data.vertices:
            wlist = []
            for ge in v.groups:
                name = body_group_names.get(ge.group)
                if name and name in bone_names and ge.weight > 1e-6:
                    wlist.append((name, float(ge.weight)))
            body_weights.append(wlist)
        garment.vertex_groups.clear()
        gmap = {}
        for name in sorted(bone_names):
            gmap[name] = garment.vertex_groups.new(name=name)
        assigned = 0
        for gi, v in enumerate(garment.data.vertices):
            info = mhclo.verts.get(gi) or {}
            bound = [i for i in (info.get("verts") or []) if 0 <= i < len(body_weights)]
            if not bound:
                continue
            accum: dict[str, float] = {}
            for bi in bound:
                for name, w in body_weights[bi]:
                    accum[name] = accum.get(name, 0.0) + w
            total = sum(accum.values()) or 1.0
            for name, w in accum.items():
                gmap[name].add([v.index], w / total, "REPLACE")
            assigned += 1
        status.update({
            "ok": assigned == len(garment.data.vertices) and assigned > 0,
            "assignedVertices": assigned,
            "garmentVertexCount": len(garment.data.vertices),
        })
        if not status["ok"]:
            status["error"] = f"binding projection assigned {assigned} verts"
    except Exception as exc:  # noqa: BLE001
        status["error"] = f"{type(exc).__name__}: {exc}"
        status["traceback"] = traceback.format_exc()[-1500:]
    return status


def _load_rig_bind(transfer_weights_fn=None):
    """Import body_param/rig_bind.py without vendoring (same pattern as mesh_io).

    rig_bind.py calls transfer_weights_body_to_garment (from body_param/
    garment_ops.py, which needs numpy + repo path helpers) but never imports
    it — under plain python3 that import would break the station test harness,
    so the caller injects the function into the loaded module's namespace.
    Pass the station-local _nearest_vertex_weight_projection (same proven
    nearest-vertex algorithm) at Blender runtime.
    """
    import importlib.util

    body_param_dir = str(Path(_STATION_DIR).parent / "body_param")
    if body_param_dir not in sys.path:
        sys.path.insert(0, body_param_dir)
    rig_bind_path = Path(body_param_dir) / "rig_bind.py"
    if not rig_bind_path.is_file():
        raise FileNotFoundError(f"rig_bind.py missing: {rig_bind_path}")
    spec = importlib.util.spec_from_file_location("rig_bind_stage_reuse", rig_bind_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {rig_bind_path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if transfer_weights_fn is not None:
        setattr(mod, "transfer_weights_body_to_garment", transfer_weights_fn)
    return mod


def _nearest_vertex_weight_projection(basemesh, garment, arm) -> dict:
    """D1 fallback: body->garment projection by nearest body vertex (world space).

    Same proven algorithm body_param/garment_ops.transfer_weights_body_to_garment
    uses. Lives in the station (not vendored into the repo's body_param package)
    so rig_refit_stage.py stays import-safe under plain python3: importing
    garment_ops at module scope would drag in numpy + repo path helpers the test
    harness does not need.
    """
    status: dict = {"ok": False, "method": "nearest_body_vertex_group_projection", "error": None}
    try:
        bone_names = {b.name for b in arm.data.bones}
        body_mw = basemesh.matrix_world
        body_pts: list = []
        body_weights: list = []
        body_group_names = {g.index: g.name for g in basemesh.vertex_groups}
        for v in basemesh.data.vertices:
            co = body_mw @ v.co
            body_pts.append((co.x, co.y, co.z))
            wlist = []
            for ge in v.groups:
                name = body_group_names.get(ge.group)
                if name and name in bone_names and ge.weight > 1e-6:
                    wlist.append((name, float(ge.weight)))
            body_weights.append(wlist)
        garment.vertex_groups.clear()
        gmap = {}
        for name in sorted(bone_names):
            gmap[name] = garment.vertex_groups.new(name=name)
        import math as _math

        assigned = 0
        for gv in garment.data.vertices:
            gco = garment.matrix_world @ gv.co
            best, best_d2 = -1, float("inf")
            for bi, (bx, by, bz) in enumerate(body_pts):
                d2 = (gco.x - bx) ** 2 + (gco.y - by) ** 2 + (gco.z - bz) ** 2
                if d2 < best_d2:
                    best, best_d2 = bi, d2
            if best < 0 or not body_weights[best]:
                continue
            total = sum(w for _, w in body_weights[best]) or 1.0
            for name, w in body_weights[best]:
                gmap[name].add([gv.index], w / total, "REPLACE")
            assigned += 1
        status.update({
            "ok": assigned == len(garment.data.vertices) and assigned > 0,
            "assignedVertices": assigned,
            "garmentVertexCount": len(garment.data.vertices),
        })
        if not status["ok"]:
            status["error"] = f"nearest projection assigned {assigned} verts"
    except Exception as exc:  # noqa: BLE001
        status["error"] = f"{type(exc).__name__}: {exc}"
        status["traceback"] = traceback.format_exc()[-1500:]
    return status


def main() -> None:
    args = parse_args()
    t0 = time.perf_counter()
    try:
        refit_report = json.loads(Path(args.refit_report).read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        write_report(args.report, {
            "schemaVersion": REPORT_SCHEMA, "producedByStage": STAGE_ID,
            "notEvidenceFor": NOT_EVIDENCE_FOR, "status": "refused",
            "refit": None,
            "rigging": {"refusalReason": f"refit_report_unreadable: {exc}"},
        })
        print(json.dumps({"status": "refused", "refusalReason": "refit_report_unreadable"}))
        return
    if not Path(args.refit_glb).is_file():
        _refuse(args.report, refit_report, f"missing_input:{args.refit_glb}", t0)
        return

    assert bpy is not None, "rig_refit_stage requires Blender bpy"
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # D1 reuse: the refit grammar + per-actor body builder come from fit_stage, the
    # rig + garment bind from body_param/rig_bind.py. Local imports: this stage only
    # runs under Blender, and fit_stage imports bpy unconditionally. The addon must
    # be enabled BEFORE any bl_ext import — importing bl_ext first reads a null
    # addon context and fails (measured 2026-09-06: TypeError NoneType
    # subscriptable in logservice via read_factory_settings-then-import order).
    from fit_stage import build_actor_body, enable_mpfb, parse_body_definition

    mpfb = enable_mpfb()
    if not mpfb.get("enabled"):
        _refuse(args.report, refit_report, "mpfb_load_failed", t0)
        return
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    from bl_ext.user_default.mpfb.services.objectservice import ObjectService
    from bl_ext.user_default.mpfb.entities.objectproperties import GeneralObjectProperties

    rig_bind = _load_rig_bind(_nearest_vertex_weight_projection)

    body_definition, body_error = parse_body_definition(args.body_definition)
    if body_error is not None or body_definition is None:
        _refuse(args.report, refit_report, body_error or "body_definition_missing", t0)
        return

    body_names = list(refit_report.get("bodyMeshNames") or [])
    garment_names = list(refit_report.get("garmentMeshNames") or [])
    if not body_names or not garment_names:
        _refuse(args.report, refit_report,
                "refit_report_missing_mesh_names: cannot attribute weight sources", t0)
        return

    try:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=args.refit_glb)
        imported = [o for o in bpy.data.objects if o not in before]
        meshes = {o.name: o for o in imported if o.type == "MESH"}
        refit_body = next((meshes[n] for n in body_names if n in meshes), None)
        refit_garments = [meshes[n] for n in garment_names if n in meshes]
        if refit_body is None or not refit_garments:
            _refuse(args.report, refit_report,
                    f"refit_meshes_unresolvable body={refit_body is not None} "
                    f"garments={len(refit_garments)}/{len(garment_names)}", t0)
            return
        refit_body_verts = len(refit_body.data.vertices)

        # Rebuild the actor's body with the refit path's own builder. The
        # scratch call solves the height macro against the stature target
        # (fit_stage._make bakes trial bodies immediately after create_human).
        # The rebuild reuses the solved height in ONE build_actor_body call:
        # identical flags (feet_on_ground=False, bake, translation grounding)
        # and identical ordering as the fit path, so the topology matches
        # vertex-for-vertex (the self-check below proves it). No re-solve.
        scratch, scratch_info = build_actor_body(
            HumanService, TargetService, body_definition, "rig_refit_height_scratch")
        scratch_verts = len(scratch.data.vertices)
        solved_height = scratch_info.get("solvedHeightMacro")
        solved_macros = dict(body_definition["macros"])
        if solved_height is not None:
            solved_macros["height"] = float(solved_height)
        bpy.data.objects.remove(scratch, do_unlink=True)
        solved_definition = {
            "macros": solved_macros,
            "race": body_definition.get("race"),
            "statureTargetM": body_definition.get("statureTargetM"),
            "bodyAssetId": body_definition.get("bodyAssetId"),
        }
        rebuilt, rebuild_info = build_actor_body(
            HumanService, TargetService, solved_definition, f"{body_names[0]}_rigged")
        if len(rebuilt.data.vertices) != scratch_verts:
            _refuse(args.report, refit_report,
                    f"rebuild_not_deterministic scratch_verts={scratch_verts} "
                    f"rebuilt_verts={len(rebuilt.data.vertices)}", t0)
            return

        GeneralObjectProperties.set_value("object_type", "Basemesh", entity_reference=rebuilt)
        bpy.context.view_layer.update()

        # Topology witness: the refit carrier GLB is an export_apply=True bake of
        # the fit path's body (14,517 verts — MASK evaluated AND applied, the
        # exporter's conjunction of live viewport depsgraph + apply), while the
        # live body is the full 19,158-vert topology with the helper MASK still
        # as a modifier. evaluated_get alone only runs the viewport half
        # (13,380 verts: the in-cage half of the conjunction), so it is NOT the
        # witness. The witness is a fit-style export round-trip of a COPY —
        # same flags the fit path exports with (export_apply=True, skins and
        # animations off) — reimported and counted. The copy is removed; only
        # the live rebuilt body (with shipped CC0 weights) ships.
        bpy.context.view_layer.update()
        witness = rebuilt.copy()
        witness.data = rebuilt.data.copy()
        bpy.context.collection.objects.link(witness)
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action="DESELECT")
        witness.select_set(True)
        bpy.context.view_layer.objects.active = witness
        witness_export = str(Path(args.out_glb).parent / "_rig_refit_topology_witness.glb")
        bpy.ops.export_scene.gltf(
            filepath=witness_export,
            use_selection=True,
            export_format="GLB",
            export_yup=True,
            export_apply=True,
            export_materials="EXPORT",
            export_skins=False,
            export_animations=False,
        )
        witness_verts = -1
        try:
            snap_witness = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=witness_export)
            for ob in bpy.data.objects:
                if ob not in snap_witness and ob.type == "MESH":
                    witness_verts = len(ob.data.vertices)
            for ob in list(bpy.data.objects):
                if ob not in snap_witness:
                    bpy.data.objects.remove(ob, do_unlink=True)
        finally:
            bpy.data.objects.remove(witness, do_unlink=True)
            try:
                Path(witness_export).unlink()
            except OSError:
                pass
        if witness_verts != refit_body_verts:
            _refuse(args.report, refit_report,
                    f"refit_body_topology_mismatch refit_body_verts={refit_body_verts} "
                    f"rebuilt_body_verts={witness_verts}", t0)
            return

        rig_created = rig_bind.create_mpfb_mixamo_rig(rebuilt)
        arm = bpy.data.objects.get(rig_created["armatureObjectName"])
        if arm is None:
            raise RuntimeError("mixamo armature missing after rig creation")
        bpy.context.view_layer.update()
        drop = min((rebuilt.matrix_world @ v.co).z for v in rebuilt.data.vertices)
        rebuilt.location.z -= drop
        arm.location.z -= drop
        bpy.context.view_layer.update()

        # Skeleton compatibility: the refit must be THIS actor's body, or the bind
        # would ship a garment on the wrong figure. Refuse, never mislabel.
        clip_bones: set = set()
        clip_actions: list = []
        if args.clip_source_glb:
            if not Path(args.clip_source_glb).is_file():
                _refuse(args.report, refit_report,
                        f"missing_input:{args.clip_source_glb}", t0)
                return
            snap_actions = set(bpy.data.actions)
            snap_objects = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=args.clip_source_glb)
            clip_actions = sorted(
                (a for a in bpy.data.actions if a not in snap_actions),
                key=lambda a: a.name,
            )
            for a in clip_actions:
                for fcu in list(getattr(a, "fcurves", None) or []):
                    path = getattr(fcu, "data_path", None) or ""
                    if 'pose.bones["' in path:
                        clip_bones.add(path.split('pose.bones["', 1)[1].split('"]', 1)[0])
            for ob in list(bpy.data.objects):
                if ob not in snap_objects:
                    bpy.data.objects.remove(ob, do_unlink=True)

        actor_bones = {b.name for b in arm.data.bones}
        refusal = check_skeleton_compatible(
            refit_body_verts=refit_body_verts,
            rebuilt_body_verts=witness_verts,
            clip_bones=clip_bones,
            actor_bones=actor_bones,
        )
        if refusal is not None:
            _refuse(args.report, refit_report, refusal, t0)
            return

        # Retire the refit carrier body (topology witness only); the rebuilt body
        # with shipped CC0 weights is what ships.
        bpy.data.objects.remove(refit_body, do_unlink=True)

        refit = refit_report.get("refit") or {}
        mhclo_path = args.mhclo or (
            ((refit.get("garmentSource") or {}).get("mhcloPath")) or ""
        )
        mesh_weights: list = [{
            "mesh": rebuilt.name,
            "weightSource": WEIGHT_SOURCE_SHIPPED_BODY,
            "reason": None,
        }]
        from bl_ext.user_default.mpfb.entities.clothes.mhclo import Mhclo
        auto_garments: list = []
        for garment in refit_garments:
            covers, coverage = (
                _binding_coverage(Mhclo, mhclo_path, garment, len(rebuilt.data.vertices))
                if mhclo_path and Path(mhclo_path).is_file()
                else (False, 0.0)
            )
            if covers:
                proj = _project_binding_weights(
                    rebuilt, garment, Mhclo, mhclo_path, actor_bones)
                if proj.get("ok"):
                    mesh_weights.append({
                        "mesh": garment.name,
                        **describe_garment_weight_source(
                            binding_covers=True, binding_coverage=coverage),
                        "projection": {k: v for k, v in proj.items() if k != "traceback"},
                    })
                    continue
                covers, coverage = False, coverage
            auto_garments.append((garment, coverage))

        # Binding-lacking garments: proven auto-weight (+envelope fallback) with the
        # body->garment projection, via rig_bind (D1 — not a new rigger).
        if auto_garments:
            first, rest = auto_garments[0][0], [g for g, _ in auto_garments[1:]]
            rig_info = rig_bind.bind_meshes_to_canonical_armature(
                rebuilt, first, weight_mode="auto",
                extra_garments=rest or None, armature=arm,
            )
            binds = rig_info.get("garmentBinds") or (
                [rig_info.get("garmentBind")] if rig_info.get("garmentBind") else [])
            by_mesh = {b.get("meshName"): b for b in binds if isinstance(b, dict)}
            for garment, coverage in auto_garments:
                g_bind = by_mesh.get(garment.name, {})
                mode = str(g_bind.get("mode") or "auto")
                if not g_bind.get("ok"):
                    _refuse(args.report, refit_report,
                            f"garment_bind_failed mesh={garment.name} mode={mode} "
                            f"error={g_bind.get('error')}", t0)
                    return
                mesh_weights.append({
                    "mesh": garment.name,
                    **describe_garment_weight_source(
                        binding_covers=False, binding_coverage=coverage,
                        auto_mode=("envelope" if g_bind.get("fallback") else "auto")),
                    "autoWeightMode": mode,
                    "autoWeightFallback": g_bind.get("fallback"),
                    "weightTransfer": (g_bind.get("weightTransfer") or {}).get("method"),
                })
        else:
            # All garments binding-weighted: the body still needs its modifier.
            rig_bind.bind_meshes_to_canonical_armature(
                rebuilt, refit_garments[0],
                weight_mode="auto",
                extra_garments=refit_garments[1:] or None, armature=arm,
            )
            # The bind above auto-weighted the garments; re-project the binding so
            # the shipped weights are the MakeClothes ones, not auto-weight's.
            for garment in refit_garments:
                proj = _project_binding_weights(
                    rebuilt, garment, Mhclo, mhclo_path, actor_bones)
                if not proj.get("ok"):
                    _refuse(args.report, refit_report,
                            f"binding_projection_lost mesh={garment.name}", t0)
                    return

        # Carry clips by bone NAME only — no retarget, no new authoring. First
        # sorted action drives the bind pose; every compatible action rides NLA.
        animation_clips: list = []
        if clip_actions:
            bpy.context.view_layer.objects.active = arm
            arm.animation_data_create()
            for i, action in enumerate(clip_actions):
                # Blender 4.4+ layered Actions expose channels, not fcurves.
                fcurves = list(getattr(action, "fcurves", None) or [])
                if not fcurves:
                    for layer in list(getattr(action, "layers", None) or []):
                        for strip in list(getattr(layer, "strips", None) or []):
                            channelbag = getattr(strip, "channelbag", None)
                            for slot in list(getattr(strip, "data_source", None) and [] or []):
                                _ = slot
                            if channelbag is not None:
                                fcurves.extend(list(getattr(channelbag, "fcurves", None) or []))
                channels = len(fcurves)
                animation_clips.append({"name": action.name, "channels": channels})
                track = arm.animation_data.nla_tracks.new()
                track.name = action.name
                strip = track.strips.new(action.name, 0, action)
                strip.extrapolation = "HOLD_FORWARD"
                if i == 0:
                    arm.animation_data.action = action
            bpy.context.view_layer.update()

        # Export guard: a GLB with missing skins is a static — refuse it, never mislabel.
        skinned = [
            o for o in (rebuilt, *refit_garments)
            if any(m.type == "ARMATURE" for m in o.modifiers)
            and any(ge.weight > 1e-6 for v in o.data.vertices for ge in v.groups)
        ]
        if len(skinned) != 1 + len(refit_garments):
            _refuse(args.report, refit_report,
                    f"zero_or_partial_skins_would_ship_static skinned={len(skinned)} "
                    f"meshes={1 + len(refit_garments)}", t0)
            return
        report_body_verts = witness_verts
        witness_verts = len(rebuilt.data.vertices)

        # Skinned export (mesh_io.export_objects_glb rule): do NOT apply modifiers
        # (would bake rest and drop the skin). Same reason the fit path keeps
        # export_apply=True only for its UNRIGGED statics.
        Path(args.out_glb).parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.object.select_all(action="DESELECT")
        for o in (arm, rebuilt, *refit_garments):
            o.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.export_scene.gltf(
            filepath=args.out_glb,
            use_selection=True,
            export_format="GLB",
            export_yup=True,
            export_apply=False,
            export_materials="EXPORT",
            export_skins=True,
            export_animations=True,
        )

        refit_sha = sha256_file(args.refit_glb)
        clip_sha = sha256_file(args.clip_source_glb) if args.clip_source_glb else None
        identity = rig_identity(
            refit_sha256=refit_sha, body_definition=body_definition, clip_sha256=clip_sha)
        rigging = build_rigging_block(
            joint_count=len(arm.data.bones),
            bone_names=[b.name for b in arm.data.bones],
            mesh_weights=mesh_weights,
            animation_clips=animation_clips,
            body_rebuild={
                "macroKeys": sorted(body_definition["macros"].keys()),
                "bodyAssetId": body_definition.get("bodyAssetId"),
                "rebuiltBodyVerts": report_body_verts,
                "refitBodyVerts": refit_body_verts,
                "rigName": rig_created.get("rigName"),
                "rigMethod": rig_created.get("method"),
            },
            identity=identity,
        )
        report = extend_refit_report(refit_report, rigging, status="completed")
        report["mpfb"] = mpfb
        report["artifacts"] = {"riggedGlb": args.out_glb}
        report["totalWallClockS"] = round(time.perf_counter() - t0, 3)
        write_report(args.report, report)
        print(json.dumps({"status": "completed", "report": args.report, "glb": args.out_glb}))
    except Exception as exc:  # noqa: BLE001
        report = extend_refit_report(
            refit_report,
            {**build_rigging_block(joint_count=0, bone_names=[], mesh_weights=[],
                                  animation_clips=[], body_rebuild={}, identity=""),
             "refusalReason": f"unhandled: {type(exc).__name__}: {exc}"},
            status="failed",
        )
        report["errors"].append(f"{type(exc).__name__}: {exc}")
        report["traceback"] = traceback.format_exc()[-3000:]
        report["totalWallClockS"] = round(time.perf_counter() - t0, 3)
        write_report(args.report, report)
        print(json.dumps(report))
        raise


if __name__ == "__main__":
    main()
