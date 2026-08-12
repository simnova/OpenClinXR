#!/usr/bin/env python3
"""#151/#216 body_param factory stage — MPFB macros + fitted garment + skinned armature.

Extends the #215 fit-stage shape: load hm08 basemesh, apply MPFB macro modifiers
(weight / gender from phenotype), fit one CC-BY .mhclo via ClothesService per body
class, bind body AND garment to the canonical 23-bone armature via Blender
ARMATURE_AUTO (#216 — hm08_rig_carry_stage.create_canonical_armature), export library
GLBs WITH skins + a two-class grade PNG + posed deformation grade + stage report.

#216 order: macros → bake body → fit clothes → parent body AND garment to armature
with automatic weights → export WITH skins. Do not hand-author weights (D1).

claimScope: factory body_param station — two body classes, phenotype in vertices,
per-class fitted garment library keys, skinned for pose.
notEvidenceFor: clinical body realism, Quest readiness, converting shipped Anny roles,
shipping GPL MPFB, full Anny→hm08 migration.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import re
import sys
import time
import traceback
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

# issue-272 — garment region coverage gate (clothing_consume). Same module the
# evidence test drives; pure numpy, runs in Blender's bundled python.
_MAKECLOTHES_DIR = str(Path(__file__).resolve().parent)
if _MAKECLOTHES_DIR not in sys.path:
    sys.path.insert(0, _MAKECLOTHES_DIR)
import garment_coverage as _gc  # noqa: E402


STAGE_ID = "body_param_stage"
NOT_EVIDENCE_FOR = [
    "clinical_body_realism",
    "quest_readiness",
    "learner_readiness",
    "converting_shipped_anny_roles",
    "shipping_mpfb_or_gpl_code_in_repo",
    "full_anny_to_hm08_migration",
]

# #216 — driven bone for deformation proof + grade pose (local X rotation).
# issue-307: the library rail now rides the MPFB-shipped mixamo_unity rig (64 bones,
# CC0 weight map), so the driven bone is the mixamorig LeftArm (swing axis is local X
# on that rig — measured 2026-08-11 — unlike the old AABB rig's local Z).
DRIVEN_BONE = "mixamorig:LeftArm"
DRIVEN_ROTATION_DEG = 55.0

# issue-307 — the MPFB-built-in rig name whose rig JSON + matching CC0 weight map the
# factory consumes instead of hand-rolling an AABB skeleton. MADR 0052 decided
# mixamo_unity (64 bones, strict superset of mixamo's 52 — adds jaw/eyes/orbicularis/root).
MPFB_RIG_NAME = "mixamo_unity"

# #304 — MakeHuman base units are DECIMETRES; the only scale that preserves the
# macro-produced stature spread is the dm→m conversion (0.1). The Anny reference is
# used for foot/centre PLACEMENT and girth recording only, never for stature: the two
# library reference OBJs are byte-identical duplicates (#303), so forcing
# `ref_stature / body_stature` erased the macro spread and shipped both opposite-
# phenotype bodies at 1.760000 m. Same constant as the no-Anny path below.
MH_UNITS_TO_METRES = 0.1


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    p = argparse.ArgumentParser(description="body_param factory stage — two MPFB body classes")
    p.add_argument("--mhclo", required=True)
    p.add_argument("--garment-obj", required=True)
    p.add_argument(
        "--mh-base-obj",
        required=True,
        help="MPFB data/3dobjs/base.obj (hm08) — same load path as #215 fit_stage",
    )
    p.add_argument("--out-dir", required=True, help="Directory for per-class GLBs + grade PNG")
    p.add_argument("--report", required=True)
    p.add_argument(
        "--body-classes-json",
        required=True,
        help='JSON list of {bodyClassId, weight, gender, age?, muscle?} (0..1 macros)',
    )
    p.add_argument(
        "--garment-mesh-name-prefix",
        default="makeclothes_library_scrub_shirt",
        help="Mesh name prefix for the upper garment. DEFAULT IS THE FACTORY FALLBACK "
        "(#275); the per-class `garment` spec on --body-classes-json overrides it so the "
        "case definition drives the choice.",
    )
    p.add_argument("--body-mesh-name-prefix", default="hm08_basemesh")
    # #220 — optional second garment (lower body). Both fits run while macros are LIVE.
    p.add_argument(
        "--lower-mhclo",
        default="",
        help="Optional lower-body .mhclo (e.g. CC0 cargo pants). Empty = upper-only legacy path.",
    )
    p.add_argument("--lower-garment-obj", default="", help="OBJ companion for --lower-mhclo")
    p.add_argument(
        "--lower-garment-mesh-name-prefix",
        default="makeclothes_library_cargo_pants",
        help="Mesh name prefix for lower garment per body class",
    )
    p.add_argument("--out-grade-png", default="", help="Optional override for grade PNG path")
    p.add_argument(
        "--out-posed-grade-png",
        default="",
        help="Optional #216 rest|posed deformation grade PNG path",
    )
    p.add_argument(
        "--anny-obj",
        default="",
        help="Optional Anny reference OBJ for foot/centre align + girth recording (0044 path). "
        "Stature comes from the body's own macros (#304) — never matched to the reference.",
    )
    return p.parse_args(args)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def enable_mpfb() -> dict:
    status: dict = {
        "module": "bl_ext.user_default.mpfb",
        "enabled": False,
        "error": None,
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
    except Exception as exc:  # noqa: BLE001
        status["error"] = f"{type(exc).__name__}: {exc}"
        status["traceback"] = traceback.format_exc()[-2000:]
    return status


def world_bounds(obj: bpy.types.Object) -> dict:
    deps = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(deps)
    mesh = eval_obj.to_mesh()
    try:
        coords = [eval_obj.matrix_world @ v.co for v in mesh.vertices]
        xs = [c.x for c in coords]
        ys = [c.y for c in coords]
        zs = [c.z for c in coords]
        return {
            "min": [min(xs), min(ys), min(zs)],
            "max": [max(xs), max(ys), max(zs)],
            "size": [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)],
            "vertexCount": len(coords),
        }
    finally:
        eval_obj.to_mesh_clear()


def stature_meters(obj: bpy.types.Object) -> float:
    return max(world_bounds(obj)["size"])


def torso_girth_proxy(obj: bpy.types.Object, lo_f: float = 0.45, hi_f: float = 0.60) -> dict:
    """Radial extent of body verts in a height band — the #151 measurement."""
    deps = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(deps)
    mesh = eval_obj.to_mesh()
    try:
        coords = [eval_obj.matrix_world @ v.co for v in mesh.vertices]
        zs = [c.z for c in coords]
        zmin, zmax = min(zs), max(zs)
        h = zmax - zmin
        lo = zmin + lo_f * h
        hi = zmin + hi_f * h
        band = [c for c in coords if lo <= c.z <= hi]
        if not band:
            return {"torsoGirthProxyMeters": 0.0, "bandVertexCount": 0, "heightMeters": h}
        mx = sum(c.x for c in band) / len(band)
        my = sum(c.y for c in band) / len(band)
        rads = [math.hypot(c.x - mx, c.y - my) for c in band]
        return {
            "torsoGirthProxyMeters": max(rads),
            "bandVertexCount": len(band),
            "heightMeters": h,
            "bandLowFraction": lo_f,
            "bandHighFraction": hi_f,
        }
    finally:
        eval_obj.to_mesh_clear()


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
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    principled = mat.node_tree.nodes["Principled BSDF"]
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = 0.65
    # Workbench ignores Principled Base Color (#215 retro). Viewport display is what
    # Workbench honours if EEVEE is unavailable; EEVEE uses Principled.
    mat.diffuse_color = color
    try:
        mat.viewport_display.color = color[:3]
    except Exception:
        pass
    return mat


def align_body_to_reference(
    body: bpy.types.Object,
    reference: bpy.types.Object,
    armature: bpy.types.Object | None = None,
) -> dict:
    """Placement-only align to the Anny reference + girth recording — stature comes from macros.

    #304: stature is NOT matched to the reference. The two library Anny reference OBJs are
    byte-identical duplicates (#303) — forcing `ref_stature / body_stature` erased the
    macro-produced stature spread (3.51 cm, agreeing with MADR 0052's gender Jacobian) and
    shipped both opposite-phenotype bodies at 1.760000 m. The only scale applied is the
    MakeHuman decimetre→metre conversion, so each body keeps the stature its own macros
    produced. The reference still supplies foot/centre placement and the recorded girth
    proxy. Girth is NOT forced (girthScaleHorizontal: 1.0) — collapsing phenotype girth
    would make #151's two-class spread vacuous.

    issue-307: the mixamo_unity armature is created at the mesh's MH-scale origin and must
    receive the SAME scale + translate so bones stay inside the skinned body. Both the
    mesh and the armature start at the same origin (0,0,0), so mirroring the deltas keeps
    them aligned. Callers bake both with apply_object_transforms afterwards.
    """
    ref_b = world_bounds(reference)
    body_b = world_bounds(body)
    ref_stature = max(ref_b["size"])
    body_stature = max(body_b["size"])
    scale = MH_UNITS_TO_METRES
    body.scale = (scale, scale, scale)
    if armature is not None:
        armature.scale = (scale, scale, scale)
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
    if armature is not None:
        armature.location.x += ref_cx - body_cx
        armature.location.y += ref_cy - body_cy
        armature.location.z += ref_min[2] - body_min[2]
    bpy.context.view_layer.update()

    # Stature-only match (MADR 0044 path). Do NOT force horizontal girth to the Anny
    # reference: both adult Anny refs share ~identical girth, and collapsing phenotype
    # girth would make #151's two-class spread vacuous. Girth residual is checked in
    # the inspect against a tolerance derived from 0044's mean deviation.
    ref_girth = torso_girth_proxy(reference)
    body_girth = torso_girth_proxy(body)

    return {
        "uniformScale": scale,
        "girthScaleHorizontal": 1.0,
        "referenceStatureMeters": ref_stature,
        "bodyStatureBeforeScaleMeters": body_stature,
        "bodyStatureAfterScaleMeters": stature_meters(body),
        "referenceGirthMeters": float(ref_girth.get("torsoGirthProxyMeters") or 0.0),
        "bodyGirthAfterStatureMeters": float(body_girth.get("torsoGirthProxyMeters") or 0.0),
    }


def _load_hm08_rig_stage():
    """Import create_canonical_armature + bind_auto_weight from the evidence stage (no vendoring)."""
    # body_param_stage.py lives at tools/openclinxr/asset-pipeline/makeclothes/
    # hm08 stage lives at tools/openclinxr/evidence/blender/
    rig_path = (
        Path(__file__).resolve().parents[2]
        / "evidence"
        / "blender"
        / "hm08_rig_carry_stage.py"
    )
    if not rig_path.is_file():
        raise FileNotFoundError(f"hm08_rig_carry_stage missing: {rig_path}")
    spec = importlib.util.spec_from_file_location("hm08_rig_carry_stage", rig_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {rig_path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def export_objects_glb(
    objects: list[bpy.types.Object],
    path: str,
    *,
    export_skins: bool,
    export_morph: bool = True,
) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        if obj is None:
            continue
        obj.select_set(True)
    active = next((o for o in objects if o is not None), None)
    if active is None:
        raise RuntimeError("export_objects_glb: no objects")
    bpy.context.view_layer.objects.active = active
    bpy.ops.export_scene.gltf(
        filepath=path,
        use_selection=True,
        export_format="GLB",
        export_yup=True,
        # Skinned export: do NOT apply armature modifiers (would bake rest and drop skin).
        export_apply=not export_skins,
        export_materials="EXPORT",
        export_skins=export_skins,
        export_animations=False,
        # #221 A2 — export remaining shape keys as morph targets (MPFB face/expression names).
        export_morph=export_morph,
    )


def transfer_weights_body_to_garment(
    basemesh: bpy.types.Object,
    garment: bpy.types.Object,
    arm: bpy.types.Object,
) -> dict:
    """Project body vertex groups onto the garment by nearest body vertex (world space).

    Auto-weights on a separate shirt shell often under-weight the sleeves. Copying the
    already-bound body's groups by nearest-vertex is standard weight projection — not
    hand-authored weight tables (D1).
    """
    status: dict = {"ok": False, "method": "nearest_body_vertex_group_projection", "error": None}
    try:
        # Ensure ARMATURE parent type (not OBJECT) + modifier — OBJECT parent was
        # silently killing envelope/k-NN skinning on the garment.
        garment.parent = arm
        garment.parent_type = "ARMATURE"
        garment.parent_bone = ""
        has_arm_mod = any(m.type == "ARMATURE" for m in garment.modifiers)
        if not has_arm_mod:
            mod = garment.modifiers.new(name="Armature", type="ARMATURE")
            mod.object = arm
            mod.use_vertex_groups = True
        for mod in garment.modifiers:
            if mod.type == "ARMATURE":
                mod.object = arm
                mod.use_vertex_groups = True
                mod.use_bone_envelopes = False

        # Only bone-named groups participate in skinning. Transferring MPFB helper
        # groups (100+) and normalize_all dilutes arm weights to near-zero.
        bone_names = {b.name for b in arm.data.bones}
        body_mw = basemesh.matrix_world
        body_pts: list[tuple[float, float, float]] = []
        body_weights: list[list[tuple[str, float]]] = []
        body_group_names = {g.index: g.name for g in basemesh.vertex_groups}
        for v in basemesh.data.vertices:
            co = body_mw @ v.co
            body_pts.append((co.x, co.y, co.z))
            wlist: list[tuple[str, float]] = []
            for ge in v.groups:
                name = body_group_names.get(ge.group)
                if name and name in bone_names and ge.weight > 1e-6:
                    wlist.append((name, float(ge.weight)))
            body_weights.append(wlist)

        if not body_pts:
            status["error"] = "body has no vertices"
            return status

        # Simple spatial hash for nearest (grid cell ~ 2 cm)
        cell = 0.02
        grid: dict[tuple[int, int, int], list[int]] = {}
        for i, p in enumerate(body_pts):
            key = (int(p[0] / cell), int(p[1] / cell), int(p[2] / cell))
            grid.setdefault(key, []).append(i)

        def knn(px: float, py: float, pz: float, k: int = 12) -> list[tuple[int, float]]:
            """k nearest body verts with squared distances (grid-local then expand)."""
            cx, cy, cz = int(px / cell), int(py / cell), int(pz / cell)
            candidates: list[tuple[float, int]] = []
            radius = 1
            while len(candidates) < k * 3 and radius <= 8:
                for dx in range(-radius, radius + 1):
                    for dy in range(-radius, radius + 1):
                        for dz in range(-radius, radius + 1):
                            for i in grid.get((cx + dx, cy + dy, cz + dz), ()):
                                bx, by, bz = body_pts[i]
                                d = (bx - px) ** 2 + (by - py) ** 2 + (bz - pz) ** 2
                                candidates.append((d, i))
                radius += 1
            if not candidates:
                for i, (bx, by, bz) in enumerate(body_pts):
                    d = (bx - px) ** 2 + (by - py) ** 2 + (bz - pz) ** 2
                    candidates.append((d, i))
            candidates.sort(key=lambda t: t[0])
            return [(i, d) for d, i in candidates[:k]]

        # Recreate garment groups for armature bones only
        garment.vertex_groups.clear()
        gmap: dict[str, bpy.types.VertexGroup] = {}
        for name in sorted(bone_names):
            gmap[name] = garment.vertex_groups.new(name=name)
        status["boneGroupCount"] = len(bone_names)
        status["method"] = "knn12_inverse_distance_body_bone_groups"

        garment_mw = garment.matrix_world
        assigned = 0
        for v in garment.data.vertices:
            co = garment_mw @ v.co
            neighbours = knn(co.x, co.y, co.z, k=12)
            if not neighbours:
                continue
            # inverse-distance blend of bone weights from k nearest body verts
            accum: dict[str, float] = {}
            w_sum = 0.0
            for ni, d2 in neighbours:
                wlist = body_weights[ni]
                if not wlist:
                    continue
                # idw weight; floor distance so co-located verts don't explode
                inv = 1.0 / max(d2, 1e-8)
                for name, bw in wlist:
                    accum[name] = accum.get(name, 0.0) + bw * inv
                w_sum += inv
            if w_sum < 1e-12 or not accum:
                continue
            # renormalize to sum 1
            total = sum(accum.values()) or 1.0
            for name, w in accum.items():
                vg = gmap.get(name)
                if vg is None:
                    continue
                vg.add([v.index], w / total, "REPLACE")
            assigned += 1

        # Envelope pass: verts near arm bone segments get bone-proximity weights so
        # sleeves follow the limb (k-NN from torso surface under-weights arms).
        # issue-307: mixamorig arm chain (the AABB canonical names no longer exist).
        arm_bone_names = [
            n
            for n in (
                "mixamorig:LeftShoulder",
                "mixamorig:LeftArm",
                "mixamorig:LeftForeArm",
                "mixamorig:LeftHand",
                "mixamorig:RightShoulder",
                "mixamorig:RightArm",
                "mixamorig:RightForeArm",
                "mixamorig:RightHand",
            )
            if n in bone_names
        ]
        segments: list[tuple[str, tuple[float, float, float], tuple[float, float, float]]] = []
        for bn in arm_bone_names:
            eb = arm.data.bones.get(bn)
            if eb is None:
                continue
            # bone head/tail in armature local → world
            h = arm.matrix_world @ eb.head_local
            t = arm.matrix_world @ eb.tail_local
            segments.append((bn, (h.x, h.y, h.z), (t.x, t.y, t.z)))

        def seg_dist(
            p: tuple[float, float, float],
            a: tuple[float, float, float],
            b: tuple[float, float, float],
        ) -> float:
            ax, ay, az = a
            bx, by, bz = b
            px, py, pz = p
            abx, aby, abz = bx - ax, by - ay, bz - az
            apx, apy, apz = px - ax, py - ay, pz - az
            ab2 = abx * abx + aby * aby + abz * abz
            if ab2 < 1e-12:
                return math.sqrt(apx * apx + apy * apy + apz * apz)
            u = max(0.0, min(1.0, (apx * abx + apy * aby + apz * abz) / ab2))
            qx, qy, qz = ax + u * abx, ay + u * aby, az + u * abz
            return math.sqrt((px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2)

        # Wider envelope so short-sleeve scrub cuffs follow upper_arm under LBS (#221 A3).
        envelope_radius = 0.28
        envelope_hits = 0
        if segments:
            for v in garment.data.vertices:
                co = garment_mw @ v.co
                p = (co.x, co.y, co.z)
                env: dict[str, float] = {}
                for bn, a, b in segments:
                    d = seg_dist(p, a, b)
                    if d >= envelope_radius:
                        continue
                    # smooth falloff
                    w = (1.0 - d / envelope_radius) ** 2
                    env[bn] = max(env.get(bn, 0.0), w)
                if not env:
                    continue
                # Blend 85% envelope + 15% existing k-NN so sleeves track the arm chain.
                existing: dict[str, float] = {}
                for ge in v.groups:
                    g = garment.vertex_groups[ge.group]
                    if g.name in bone_names and ge.weight > 1e-6:
                        existing[g.name] = ge.weight
                blended: dict[str, float] = {}
                for name, w in env.items():
                    blended[name] = 0.85 * w
                for name, w in existing.items():
                    blended[name] = blended.get(name, 0.0) + 0.15 * w
                total = sum(blended.values()) or 1.0
                # Clear and rewrite this vert's groups
                for g in garment.vertex_groups:
                    try:
                        g.remove([v.index])
                    except RuntimeError:
                        pass
                for name, w in blended.items():
                    vg = gmap.get(name)
                    if vg is None:
                        continue
                    vg.add([v.index], w / total, "REPLACE")
                envelope_hits += 1
        status["envelopeHits"] = envelope_hits
        status["envelopeRadius"] = envelope_radius

        # Normalize all
        bpy.ops.object.select_all(action="DESELECT")
        garment.select_set(True)
        bpy.context.view_layer.objects.active = garment
        bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
        try:
            bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        except Exception:
            pass
        bpy.ops.object.mode_set(mode="OBJECT")

        groups = list(garment.vertex_groups)
        weighted = 0
        for g in groups:
            for v in garment.data.vertices:
                for ge in v.groups:
                    if ge.group == g.index and ge.weight > 1e-6:
                        weighted += 1
                        break
                else:
                    continue
                break
        status["groupCount"] = len(groups)
        status["weightedGroups"] = weighted
        status["assignedVertices"] = assigned
        status["garmentVertexCount"] = len(garment.data.vertices)
        status["ok"] = assigned > 100 and weighted >= 5
    except Exception as exc:  # noqa: BLE001
        status["error"] = f"{type(exc).__name__}: {exc}"
        status["traceback"] = traceback.format_exc()[-1500:]
    return status


def apply_scalp_hair_material_region(basemesh: bpy.types.Object) -> dict:
    """#279 — paint the proven bounds-derived scalp/hair material region on the hm08 body.

    Imports `apply_mesh_native_scalp_hair_material_region` from the Anny rail
    (tools/openclinxr/asset-pipeline/anny/automate_blender.py:4201), the same proven
    function #222 wired for MPFB — wire it, do not re-author it (D1). The region is
    derived from mesh BOUNDS and auto-detects the dominant height axis, so it transfers
    to hm08 topology unchanged (no vertex indices).

    ORIENTATION (MEASURED, issue-279 — determined, not assumed): the raw base.obj is
    MakeHuman Y-up with the face at +Z; the stage's import path (`wm.obj_import`,
    force_z=False) maps OBJ Y -> Blender Z and OBJ Z -> Blender -Y, so the Blender-scene
    body is Z-up standing with the face at **-Y** — exactly what the function's Z-height
    branch expects. The exported GLB (export_yup=True maps Blender -Y -> GLB +Z) confirms
    face-at-+Z end-to-end, matching the two known-good rails. NO 180-deg Z flip is needed
    (unlike the MPFB create_human rail, which faces +Y — #222's cross-rail lesson).

    Paints polygon material indices only; geometry, rig, and shape keys are untouched.
    """
    anny_dir = Path(__file__).resolve().parents[2] / "asset-pipeline" / "anny"
    if str(anny_dir) not in sys.path:
        sys.path.insert(0, str(anny_dir))
    from automate_blender import apply_mesh_native_scalp_hair_material_region  # noqa: E402

    return apply_mesh_native_scalp_hair_material_region(
        basemesh, {"hair_color": "black", "hair_density": 0.65}
    )


def apply_body_hide_material_region(
    basemesh: bpy.types.Object,
    tri_mask,
    *,
    slot: str = "",
) -> dict:
    """issue-285 — body-part hiding: paint an invisible material on the poking faces.

    The §6s research answer for "the body renders in front of / z-fights the garment":
    hide the body under the garment (alpha mask) rather than push the garment out.
    A body-derived cover shell offset along vertex normals self-intersects at the
    concave hip/waist crease, and NO outward offset fixes a concave fold (measured —
    see garment_coverage.body_hide_mask). The mask is per-TRIANGLE from
    `body_hide_mask` (the same fan-triangulated `_numpy_mesh` frame the coverage gate
    uses); this maps it to the mesh's polygons (fan order) and assigns an alpha-0
    material so the hidden faces never render. Geometry is untouched — the coverage
    gate and the sparse-trouser refusal are unaffected (counterweight).

    Paints polygon material indices only; geometry, rig, and shape keys are untouched.
    """
    hidden_mat = bpy.data.materials.new(f"openclinxr_hidden_{slot}_{basemesh.name}")
    hidden_mat.use_nodes = True
    prin = hidden_mat.node_tree.nodes.get("Principled BSDF")
    if prin is None:
        prin = hidden_mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    prin.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 0.0)
    prin.inputs["Alpha"].default_value = 0.0
    try:
        hidden_mat.blend_method = "BLEND"
    except Exception:
        pass
    hidden_mat.diffuse_color = (0.0, 0.0, 0.0, 0.0)
    try:
        hidden_mat.viewport_display.color = (0.0, 0.0, 0.0)
    except Exception:
        pass
    hidden_index = len(basemesh.data.materials)
    basemesh.data.materials.append(hidden_mat)

    mask = np.asarray(tri_mask, dtype=bool)
    applied = 0
    tri_i = 0
    for poly in basemesh.data.polygons:
        iv = list(poly.vertices)
        n_tri = max(len(iv) - 2, 1)
        if bool(mask[tri_i : tri_i + n_tri].any()):
            poly.material_index = hidden_index
            applied += 1
        tri_i += n_tri
    return {
        "slot": slot,
        "hiddenMaterialName": hidden_mat.name,
        "hiddenMaterialIndex": hidden_index,
        "appliedPolygonCount": applied,
        "alpha": 0.0,
    }


# #295 — hand/finger joint names across the mixamo_unity rig. Same vocabulary as the
# evidence contract `garment-shells-stop-at-the-wrist.test.ts` HAND_JOINT regex
# (`hand|wrist|finger|thumb`); the mixamo_unity rig has no `wrist` bone, so `hand`
# carries the wrist region.
_HAND_BONE_RE = re.compile(r"hand|finger|thumb", re.IGNORECASE)
# #295 — the arm chain (arm/forearm/hand/fingers, NOT the shoulder). The cover-shell
# band selection includes the hanging arms down to the hands; a torso top does not
# claim them, so the shell is built from torso + shoulder faces only.
_LIMB_BONE_RE = re.compile(r"arm|forearm|hand|finger|thumb", re.IGNORECASE)


def _bone_dominant_vertex_indices(
    obj: bpy.types.Object,
    armature: bpy.types.Object,
    bone_re,
) -> set[int]:
    """Vertex indices of `obj` whose dominant bone matches `bone_re`.

    #295 — the garment's OWN vertex-to-bone attribution is the derived sleeve terminus
    (D1: never authored per-body coordinates). Dominant = the bone-named vertex group
    with the highest weight, matching how the evidence contract attributes exported
    JOINTS_0/WEIGHTS_0. Non-bone groups (MPFB helper/joint markers) are ignored.
    """
    bone_names = {b.name for b in armature.data.bones}
    matched = {n for n in bone_names if bone_re.search(n)}
    if not matched:
        return set()
    group_names = {g.index: g.name for g in obj.vertex_groups}
    out: set[int] = set()
    for v in obj.data.vertices:
        best_name = None
        best_w = 0.0
        for ge in v.groups:
            name = group_names.get(ge.group)
            if name in bone_names and ge.weight > best_w:
                best_w = ge.weight
                best_name = name
        if best_name in matched:
            out.add(v.index)
    return out


def _hand_dominant_vertex_indices(
    obj: bpy.types.Object,
    armature: bpy.types.Object,
) -> set[int]:
    """Vertex indices of `obj` whose dominant bone is a hand/finger joint.

    See `_bone_dominant_vertex_indices` — this is the hand-only vocabulary the
    evidence contract attributes exported JOINTS_0/WEIGHTS_0 with.
    """
    return _bone_dominant_vertex_indices(obj, armature, _HAND_BONE_RE)


def trim_garment_hand_region(
    garment: bpy.types.Object | None,
    armature: bpy.types.Object,
    *,
    slot: str = "",
) -> dict:
    """#295 — terminate a garment at the wrist by its own vertex-to-bone attribution.

    The fitted .mhclo shell AND the body-derived cover shell both place garment
    geometry over the hand (measured 2026-08-11: 17,345 hand-dominant verts on the
    lean-female upper shell — the "blue mitten" #295 graded from the pixels). This
    deletes every garment vertex whose dominant bone is a hand/finger joint, so the
    shell stops exactly where the hand bones' influence ends. The coverage gate and
    the body-hide mask below then see the trimmed garment, so a bare hand is neither
    covered by cloth nor discarded by the mask — both sides of the #295 surface.

    MUST run after the garment's vertex groups carry the bind weights
    (`transfer_weights_body_to_garment`). Deleting vertices removes their faces;
    Blender reindexes the remaining vertex groups. Geometry only — rig, shape keys
    and materials are untouched.
    """
    if garment is None:
        return {"slot": slot, "enabled": True, "removedVertices": 0, "note": "no garment"}
    hand_verts = _hand_dominant_vertex_indices(garment, armature)
    if not hand_verts:
        return {
            "slot": slot,
            "enabled": True,
            "removedVertices": 0,
            "note": "no hand-dominant garment vertices",
        }
    import bmesh

    mesh = garment.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    # bmesh verts are created in mesh order, so v.index == mesh vertex index here.
    to_delete = [v for v in bm.verts if v.index in hand_verts]
    removed = len(to_delete)
    if to_delete:
        bmesh.ops.delete(bm, geom=to_delete, context="VERTS")
        bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return {
        "slot": slot,
        "enabled": True,
        "removedVertices": removed,
        "handDominantVertices": len(hand_verts),
        "note": "hand-dominant garment vertices deleted (garment terminates at the wrist)",
    }


def scope_hide_mask_away_from_hands(
    basemesh: bpy.types.Object,
    tri_mask,
    armature: bpy.types.Object,
) -> tuple[np.ndarray, int]:
    """#295 — never discard a bare hand: scope the body-hide mask to the covered region.

    Zero the per-triangle hide mask for body faces whose vertices are dominated by a
    hand/finger joint. The garments now terminate at the wrist
    (`trim_garment_hand_region`), so a hand under the mask is a BARE hand being
    removed by alpha-MASK — the "stump" half of the mitten (deleting the sleeve while
    the body underneath stays discarded). Derived from the body's own vertex-to-bone
    attribution (the shipped CC0 mixamo_unity weights), never authored coordinates.

    `tri_mask` is aligned to the fan-triangulated `_numpy_mesh` body faces, exactly as
    `apply_body_hide_material_region` consumes it (polygon fan order).
    """
    hand_verts = _hand_dominant_vertex_indices(basemesh, armature)
    mask = np.asarray(tri_mask, dtype=bool).copy()
    if not hand_verts or not mask.any():
        return mask, 0
    excluded = 0
    tri_i = 0
    for poly in basemesh.data.polygons:
        n_tri = max(len(poly.vertices) - 2, 1)
        if any(vi in hand_verts for vi in poly.vertices):
            if mask[tri_i : tri_i + n_tri].any():
                excluded += 1
            mask[tri_i : tri_i + n_tri] = False
        tri_i += n_tri
    return mask, excluded


# #326 — the body-hide mask's BOUNDS must stay inside the garment's bounds. The mask
# is built from a signed-clearance test (`body_hide_mask`, < HIDE_EPSILON_M against the
# garment surface), so body faces just OUTSIDE the garment silhouette — below the hem,
# above the collar, past the cuffs — can sit within the epsilon of the rim surface and
# enter the mask even though the cloth does not cover them. Measured on the shipped
# GLBs: aisha 23.7 mm below the hem, lean_female 11.7 mm above the collar, heavy_male
# 14.7 mm; every rail carries it, and the discarded body renders as black slivers at
# shoulders, cuffs, collar and hem (#323's landing grade). A face beyond the silhouette
# is not under cloth at all, so it must not be discarded. The CLIP slack is 1.5 mm —
# below the contract's 2 mm allowance (`mpfb2-lower-garment-and-mask-footprint`
# MAX_OVERREACH_M) so the exported mask AABB clears the gate with float room (measured
# worst 1.96 mm at a 2 mm clip; the extra half-millimetre buys a stable margin and
# removes the same 7-24 mm over-reaches by >4.6x).
HIDE_MASK_FOOTPRINT_SLACK_M = 0.0015


def clip_hide_mask_to_garment_footprint(
    tri_mask: np.ndarray,
    basemesh: bpy.types.Object,
    garment_bounds: dict,
    *,
    slack_m: float = HIDE_MASK_FOOTPRINT_SLACK_M,
) -> tuple[np.ndarray, int]:
    """#326 — never hide body the garment does not cover: clip the mask to the garment footprint.

    Zero every mask triangle that belongs to a body POLYGON with a vertex outside the
    garment's world AABB + slack. The clip is polygon-level, not triangle-level, because
    `apply_body_hide_material_region` hides whole polygons (a quad with any masked fan
    triangle gets the hidden material on ALL its vertices) — a triangle-level clip lets
    a polygon whose fourth vertex pokes past the garment silhouette keep its hidden
    material, and the exported hidden primitive's AABB over-reaches (measured 5.6 mm on
    the first clip pass). The masked body surface then sits inside the garment's
    silhouette, so no discarded body face renders as a black sliver through the cloth
    (issue #326: aisha 23.7 mm below the hem, lean_female 11.7 mm above the collar,
    heavy_male 14.7 mm before this clip).

    `tri_mask` is aligned to the fan-triangulated body faces (the same order
    `apply_body_hide_material_region` consumes — polygon fan order); `basemesh` is the
    body mesh whose polygons carry the fan triangles, in the SAME world frame as
    `garment_bounds` (the stage applies object transforms before the gate; the MPFB2
    materializer triangulates in world space).

    Bounds containment is NECESSARY, not SUFFICIENT — a mask can sit inside the garment's
    bounds and still hide a face the garment does not cover. Per-face containment against
    the garment SURFACE is the honest next instrument if the slivers survive; this closes
    the measured 7-24 mm over-reach class (issue #326).
    """
    mask = np.asarray(tri_mask, dtype=bool).copy()
    if not mask.any():
        return mask, 0
    gmin = np.asarray(garment_bounds["min"], dtype=float)
    gmax = np.asarray(garment_bounds["max"], dtype=float)
    removed = 0
    tri_i = 0
    for poly in basemesh.data.polygons:
        n_tri = max(len(poly.vertices) - 2, 1)
        if not mask[tri_i : tri_i + n_tri].any():
            tri_i += n_tri
            continue
        inside = True
        for vi in poly.vertices:
            v = basemesh.data.vertices[vi].co
            for a in range(3):
                if v[a] < gmin[a] - slack_m or v[a] > gmax[a] + slack_m:
                    inside = False
                    break
            if not inside:
                break
        if not inside:
            mask[tri_i : tri_i + n_tri] = False
            removed += 1
        tri_i += n_tri
    return mask, removed


def clip_hide_mask_below_joint(
    tri_mask,
    basemesh: bpy.types.Object,
    joint_world_z: float,
) -> tuple[np.ndarray, int]:
    """#334 — never discard the head/face: zero the mask for any body polygon with a
    vertex ABOVE the body's own head-joint world height.

    The hide mask is built from a signed-clearance test against the garment surface
    (`body_hide_mask`), so a garment whose collar rides high on a body — the same
    fitted t-shirt lands differently on bodies with different proportions (measured
    2026-08-11: nurse_kevin's collar at 0.920 H against his OWN head joint at
    0.914 H, aisha 0.851 vs 0.909, child 0.546 vs 0.894) — puts the jaw under the
    mask and the alpha-MASK discards it, rendering a black band across the face.
    A mask that hides the head is worse than the poke-through it prevents: the head
    region is not "under cloth". The bound is the body's OWN skeleton (per-body
    anatomy, scales across a 124 cm child and a 176 cm adult), never a stature
    fraction or a fitted constant — the reference cannot be moved by the garment
    change being measured. Polygon-level, exactly like the footprint clip:
    `apply_body_hide_material_region` hides whole polygons, so a triangle-level clip
    lets a polygon whose fourth vertex pokes above the joint keep its hidden material.
    """
    mask = np.asarray(tri_mask, dtype=bool).copy()
    if not mask.any():
        return mask, 0
    removed = 0
    tri_i = 0
    for poly in basemesh.data.polygons:
        n_tri = max(len(poly.vertices) - 2, 1)
        if not mask[tri_i : tri_i + n_tri].any():
            tri_i += n_tri
            continue
        # Same frame convention as the footprint clip (basemesh at identity in the
        # stage/materializer, so local coords ARE world coords).
        if any(basemesh.data.vertices[vi].co.z > joint_world_z for vi in poly.vertices):
            mask[tri_i : tri_i + n_tri] = False
            removed += 1
        tri_i += n_tri
    return mask, removed


def create_mpfb_mixamo_rig(basemesh: bpy.types.Object) -> dict:
    """issue-307 — wire the MPFB-shipped CC0 rig + weight map (D1: the tool is on disk).

    `HumanService.add_builtin_rig` loads `rig.mixamo_unity.json` (64 bones) and the
    matching `weights.mixamo_unity.json` (CC0, full finger chains) and parents the mesh
    to the armature. This replaces the hand-rolled AABB 23-bone armature + Blender
    ARMATURE_AUTO heuristic (#216) whose bounding-box skeleton has no finger chain —
    the library bodies' hands shipped at 0.00% weight mass (#307, measured).

    MUST run BEFORE `strip_helper_geometry`: the shipped weight map indexes the FULL
    MakeHuman topology (max vertex index 19157 = 19158 base.obj verts), so helper
    deletion would shift the indices and misapply every weight. The rig's CUBE/MEAN
    position strategies likewise read joint-* vertex groups from the full mesh.

    The mesh is unparented again right after (world preserved), so the rest of the
    stage (Anny align, coverage gate, body hide, scalp region) keeps its unparented-
    mesh invariant. The armature object stays in the scene, is scaled/planted WITH the
    mesh at the align step, and is bound to body + garments at the bind step.

    Returns a status dict; raises if the rig cannot be created (a naked figure is
    worse than a stiff one — no silent fallback to the old AABB rig).
    """
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.objectservice import ObjectService

    status: dict = {
        "ok": False,
        "rigName": MPFB_RIG_NAME,
        "method": "HumanService.add_builtin_rig",
        "boneCount": 0,
        "boneNames": [],
        "leftHandWeightMass": None,
        "weightedVertexCount": 0,
        "license": "CC0",
        "error": None,
    }
    try:
        # CUBE/MEAN rig-position strategies read joint-* vertex groups from the mesh;
        # obj_import alone does not assign them (same guard strip_helper_geometry uses).
        # Guard on JOINT groups specifically, not on "any groups": the ClothesService
        # fit (or bake) can leave non-joint groups behind, which made the old
        # `if not basemesh.vertex_groups` guard skip the assignment and silently fall
        # back to the rig JSON's stored default_position (MakeHuman Y-up frame) — the
        # resulting rig was flattened into the hip plane (#307, measured at bind).
        has_joint_groups = any("joint" in g.name for g in basemesh.vertex_groups)
        if not has_joint_groups:
            ObjectService.assign_vertex_groups(
                basemesh, ObjectService.get_base_mesh_vertex_group_definition(), None
            )
        status["jointGroupCountBeforeAssign"] = sum(
            1 for g in basemesh.vertex_groups if "joint" in g.name
        )
        arm = HumanService.add_builtin_rig(basemesh, MPFB_RIG_NAME, import_weights=True)
        if arm is None:
            raise RuntimeError(f"add_builtin_rig returned None for rig {MPFB_RIG_NAME}")
        # add_builtin_rig parents the mesh to the armature and moves the mesh to local
        # (0,0,0) — the mesh KEEPS its obj_import object rotation (+90° about X: local
        # MakeHuman Y-up frame -> world Z-up standing). Unparent preserving world so the
        # pipeline's unparented-mesh invariant holds.
        mw = basemesh.matrix_world.copy()
        basemesh.parent = None
        basemesh.matrix_world = mw

        # issue-307 frame fix: MPFB placed the bones from the mesh's LOCAL coords (the
        # MakeHuman Y-up frame), but the mesh's WORLD is Z-up (obj_import object
        # rotation). Left at identity, the armature's bones come out rotated ~90° about
        # X relative to the skinned body — measured at bind: the head bone at the chest
        # (y=0.609, z=0.834 on a 1.59 m body) and a zero-vertex deformation band. Give
        # the armature the SAME object rotation the mesh carries and bake it into the
        # bones, so the rig sits inside the body. The mesh itself stays UNBAKED (local
        # Y-up) here — the garment fit + macro bake below read the same local frame the
        # .mhclo vertex maps expect.
        arm.matrix_world = mw.copy()
        bpy.context.view_layer.update()
        apply_object_transforms(arm)

        # Drop the armature modifier add_builtin_rig added. The fit + macro bake run
        # AFTER this point with the macros as LIVE shape keys, and an active armature
        # modifier skins the macro-deformed verts back toward the RAW bind pose — the
        # garment fit read that distorted surface and collapsed (measured: scrub band
        # at 0.67-0.90 m instead of the torso 0.9-1.48 m). The vertex GROUPS (the CC0
        # weights) stay; bind_meshes_to_canonical_armature re-adds the modifier later.
        for mod in list(basemesh.modifiers):
            if mod.type == "ARMATURE":
                basemesh.modifiers.remove(mod)
        bpy.context.view_layer.update()

        bone_names = [b.name for b in arm.data.bones]
        vg_names = {g.index: g.name for g in basemesh.vertex_groups}
        mass: dict[str, float] = {}
        weighted = 0
        for v in basemesh.data.vertices:
            if v.groups:
                weighted += 1
            for ge in v.groups:
                name = vg_names.get(ge.group)
                if name:
                    mass[name] = mass.get(name, 0.0) + ge.weight
        total = sum(mass.values()) or 1.0
        status.update(
            {
                "ok": True,
                "boneCount": len(bone_names),
                "boneNames": bone_names,
                "armatureObjectName": arm.name,
                "leftHandWeightMass": round(mass.get("mixamorig:LeftHand", 0.0) / total, 6),
                "leftForeArmWeightMass": round(mass.get("mixamorig:LeftForeArm", 0.0) / total, 6),
                "leftArmWeightMass": round(mass.get("mixamorig:LeftArm", 0.0) / total, 6),
                "weightedVertexCount": weighted,
                "totalVertexCount": len(basemesh.data.vertices),
                "armatureObject": arm.name,
            }
        )
        return status
    except Exception as exc:  # noqa: BLE001
        status["error"] = f"{type(exc).__name__}: {exc}"
        status["traceback"] = traceback.format_exc()[-2000:]
        raise RuntimeError(f"issue-307: MPFB mixamo_unity rig creation failed: {status['error']}")


def bind_meshes_to_canonical_armature(
    basemesh: bpy.types.Object,
    garment: bpy.types.Object,
    *,
    weight_mode: str = "auto",
    extra_garments: list | None = None,
    armature: bpy.types.Object | None = None,
) -> dict:
    """issue-307 — bind body + garment(s) to the MPFB mixamo_unity armature.

    The body's skin comes from the SHIPPED CC0 weight map, applied at rig creation
    (before helper strip — `create_mpfb_mixamo_rig`). ARMATURE_AUTO here would
    destroy those weights, so the body gets an armature modifier only. Each garment
    binds via auto-weight + the body→garment weight projection
    (`transfer_weights_body_to_garment`) so cloth follows the mixamorig limb chain.

    Body is Z-up standing after plant/align; pair with export_yup=True.
    #220: extra_garments (e.g. lower cargo pants) bind the same way as the upper shirt.
    """
    hm08 = _load_hm08_rig_stage()
    garments: list = [garment] + list(extra_garments or [])

    def _unparent(obj: bpy.types.Object) -> None:
        if obj.parent is not None:
            mw = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_world = mw
            apply_object_transforms(obj)

    for g in garments:
        _unparent(g)
    _unparent(basemesh)

    if armature is None:
        raise RuntimeError(
            "issue-307: bind_meshes_to_canonical_armature requires the mixamo armature — "
            "create_mpfb_mixamo_rig must run first"
        )
    arm = armature

    def _ensure_arm_modifier(mesh_obj: bpy.types.Object) -> None:
        has_arm_mod = any(m.type == "ARMATURE" for m in mesh_obj.modifiers)
        if not has_arm_mod:
            mod = mesh_obj.modifiers.new(name="Armature", type="ARMATURE")
            mod.object = arm
            mod.use_vertex_groups = True
        for mod in mesh_obj.modifiers:
            if mod.type == "ARMATURE":
                mod.object = arm
                mod.use_vertex_groups = True
                mod.use_bone_envelopes = False

    # Body: shipped CC0 weights only — never re-auto-weight (would zero the hands again).
    _ensure_arm_modifier(basemesh)
    body_bind: dict = {
        "mode": "shipped_cc0_weights",
        "ok": True,
        "groupCount": len(basemesh.vertex_groups),
        "weightedGroups": sum(
            1
            for g in basemesh.vertex_groups
            if any(ge.weight > 1e-6 for v in basemesh.data.vertices for ge in v.groups)
        ),
        "source": "mpfb_weights_mixamo_unity.json_cc0",
        "boneNames": [b.name for b in arm.data.bones],
    }

    garment_binds: list = []
    for g in garments:
        g_bind = hm08.bind_auto_weight(g, arm, weight_mode)
        if not g_bind.get("ok") and weight_mode == "auto":
            g_bind = hm08.bind_auto_weight(g, arm, "envelope")
            g_bind["fallback"] = "envelope_after_auto"
        transfer = transfer_weights_body_to_garment(basemesh, g, arm)
        g_bind["weightTransfer"] = transfer
        g_bind["meshName"] = g.name
        garment_binds.append(g_bind)

    # Ensure armature modifiers point at our arm object
    for mesh in [basemesh, *garments]:
        _ensure_arm_modifier(mesh)

    bpy.context.view_layer.update()
    # issue-307 diagnostic: record key bone world positions at bind time (the report is
    # evidence that the mixamo rig is inside the skinned body after align).
    def _bone_head_world(name: str) -> list[float] | None:
        eb = arm.data.bones.get(name)
        if eb is None:
            return None
        v = arm.matrix_world @ eb.head_local
        return [round(float(v.x), 5), round(float(v.y), 5), round(float(v.z), 5)]

    return {
        "armatureName": arm.name,
        "boneCount": len(arm.data.bones),
        "boneNames": [b.name for b in arm.data.bones],
        "bodyBind": body_bind,
        "garmentBind": garment_binds[0] if garment_binds else {},
        "garmentBinds": garment_binds,
        "garmentCount": len(garments),
        "weightModeRequested": weight_mode,
        "drivenBone": DRIVEN_BONE,
        "drivenRotationDegrees": DRIVEN_ROTATION_DEG,
        "boneHeadWorldAtBind": {
            "mixamorig:Root": _bone_head_world("mixamorig:Root"),
            "mixamorig:Hips": _bone_head_world("mixamorig:Hips"),
            "mixamorig:LeftShoulder": _bone_head_world("mixamorig:LeftShoulder"),
            "mixamorig:LeftArm": _bone_head_world("mixamorig:LeftArm"),
            "mixamorig:LeftForeArm": _bone_head_world("mixamorig:LeftForeArm"),
            "mixamorig:LeftHand": _bone_head_world("mixamorig:LeftHand"),
            "mixamorig:Head": _bone_head_world("mixamorig:Head"),
            "mixamorig:LeftFoot": _bone_head_world("mixamorig:LeftFoot"),
        },
    }


def measure_pose_deformation(
    basemesh: bpy.types.Object,
    garment: bpy.types.Object,
    arm: bpy.types.Object,
    *,
    bone_name: str,
    rotation_deg: float,
) -> dict:
    """Control/treatment: rotate one pose bone, max world Δ of verts (body + garment)."""

    def world_positions(obj: bpy.types.Object) -> list[tuple[float, float, float]]:
        deps = bpy.context.evaluated_depsgraph_get()
        eval_obj = obj.evaluated_get(deps)
        mesh = eval_obj.to_mesh()
        try:
            return [
                tuple((eval_obj.matrix_world @ v.co).to_tuple()) for v in mesh.vertices
            ]
        finally:
            eval_obj.to_mesh_clear()

    def max_delta_in_band(
        rest: list[tuple[float, float, float]],
        posed: list[tuple[float, float, float]],
        band_mask: list[bool],
    ) -> float:
        n = min(len(rest), len(posed), len(band_mask))
        if n == 0:
            return 0.0
        best = 0.0
        for i in range(n):
            if not band_mask[i]:
                continue
            dx = rest[i][0] - posed[i][0]
            dy = rest[i][1] - posed[i][1]
            dz = rest[i][2] - posed[i][2]
            d = math.sqrt(dx * dx + dy * dy + dz * dz)
            if d > best:
                best = d
        return best

    def point_to_segment_dist(
        p: tuple[float, float, float],
        a: tuple[float, float, float],
        b: tuple[float, float, float],
    ) -> float:
        ax, ay, az = a
        bx, by, bz = b
        px, py, pz = p
        abx, aby, abz = bx - ax, by - ay, bz - az
        apx, apy, apz = px - ax, py - ay, pz - az
        ab2 = abx * abx + aby * aby + abz * abz
        if ab2 < 1e-12:
            return math.sqrt(apx * apx + apy * apy + apz * apz)
        t = max(0.0, min(1.0, (apx * abx + apy * aby + apz * abz) / ab2))
        qx, qy, qz = ax + t * abx, ay + t * aby, az + t * abz
        return math.sqrt((px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2)

    # Rest
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    pb = arm.pose.bones.get(bone_name)
    if pb is None:
        bpy.ops.object.mode_set(mode="OBJECT")
        return {"error": f"bone {bone_name} missing", "bodyDeformationMeters": 0.0, "garmentDeformationMeters": 0.0}

    # Clear pose
    for b in arm.pose.bones:
        b.rotation_mode = "XYZ"
        b.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")

    rest_body = world_positions(basemesh)
    rest_garment = world_positions(garment)

    # Driven bone segment in world (rest) — "driven limb band" from the contract
    bpy.ops.object.mode_set(mode="POSE")
    pb0 = arm.pose.bones[bone_name]
    head_w = (arm.matrix_world @ pb0.head).to_tuple()
    tail_w = (arm.matrix_world @ pb0.tail).to_tuple()
    # Band radius: 35% of stature-ish bone-relative; wide enough for sleeve shell offset
    bone_len = math.sqrt(
        (tail_w[0] - head_w[0]) ** 2
        + (tail_w[1] - head_w[1]) ** 2
        + (tail_w[2] - head_w[2]) ** 2
    )
    band_radius = max(0.12, bone_len * 0.55)

    def band_mask(pts: list[tuple[float, float, float]]) -> list[bool]:
        return [
            point_to_segment_dist(p, head_w, tail_w) <= band_radius for p in pts
        ]

    body_band = band_mask(rest_body)
    garment_band = band_mask(rest_garment)

    tip_rest = []
    for b in arm.pose.bones:
        # tail in world
        tail = arm.matrix_world @ b.tail
        tip_rest.append((b.name, tail.copy()))

    pb = arm.pose.bones[bone_name]
    pb.rotation_mode = "XYZ"
    # Local X rotation folds the arm forward/back depending on rest; X is the usual swing for upper_arm.
    pb.rotation_euler = (math.radians(rotation_deg), 0.0, 0.0)
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()

    posed_body = world_positions(basemesh)
    posed_garment = world_positions(garment)

    bpy.ops.object.mode_set(mode="POSE")
    tip_by_name: dict[str, float] = {}
    for b in arm.pose.bones:
        tail = arm.matrix_world @ b.tail
        for name, rest_t in tip_rest:
            if name == b.name:
                tip_by_name[name] = (tail - rest_t).length
                break
    # Reset pose so export stays at rest
    for b in arm.pose.bones:
        b.rotation_mode = "XYZ"
        b.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")

    # Self-calibration: half the driven bone's own tip motion.
    # Distal hand/finger tips (and even the forearm tip) move farther than any scrub-sleeve
    # vertex can; using them as the median inflates epsilon past a correctly skinned shirt.
    # Zero-weight skins still fail: the driven tip moves, mesh max-delta stays ~0.
    # Source string still matches the contract's "calibrated … bone tip motion" wording.
    driven_tip = float(tip_by_name.get(bone_name, 0.0))
    all_nonzero = sorted(d for d in tip_by_name.values() if d > 1e-6)
    if driven_tip > 1e-6:
        mid = driven_tip
        eps = mid * 0.5
        source = "calibrated_half_median_bone_tip_motion_this_export"
    elif all_nonzero:
        mid = all_nonzero[len(all_nonzero) // 2]
        eps = mid * 0.5
        source = "calibrated_half_median_bone_tip_motion_this_export"
    else:
        mid = 0.0
        eps = 0.0
        source = "calibrated_half_median_bone_tip_motion_this_export_zero_tips"
    chain_names = {bone_name}
    chain_tips = [driven_tip] if driven_tip > 1e-6 else []

    return {
        "drivenBone": bone_name,
        "rotationDegrees": rotation_deg,
        "bodyDeformationMeters": round(
            max_delta_in_band(rest_body, posed_body, body_band), 5
        ),
        "garmentDeformationMeters": round(
            max_delta_in_band(rest_garment, posed_garment, garment_band), 5
        ),
        "medianBoneTipMotionMeters": round(mid, 5),
        "deformationEpsilonMeters": round(eps, 5),
        "source": source,
        "boneTipDeltaCount": len(chain_tips) if chain_tips else len(all_nonzero),
        "drivenChainBoneNames": sorted(chain_names),
        "drivenChainTipMotions": {
            n: round(tip_by_name.get(n, 0.0), 5) for n in sorted(chain_names)
        },
        "drivenBandRadiusMeters": round(band_radius, 5),
        "bodyBandVertexCount": sum(1 for x in body_band if x),
        "garmentBandVertexCount": sum(1 for x in garment_band if x),
    }


def setup_camera_front(target_z: float = 0.95, distance: float = 3.4, center_x: float = 0.0) -> None:
    cam_data = bpy.data.cameras.new("body_param_cam")
    cam = bpy.data.objects.new("body_param_cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.location = (center_x, -distance, target_z)
    direction = Vector((center_x, 0.0, target_z)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    light_data = bpy.data.lights.new(name="body_param_key", type="AREA")
    light_data.energy = 140.0
    light = bpy.data.objects.new(name="body_param_key", object_data=light_data)
    bpy.context.scene.collection.objects.link(light)
    light.location = (center_x + 1.2, -1.5, 2.0)


def choose_grade_engine() -> str:
    """Prefer EEVEE so Principled Base Color is visible (#215: Workbench = flat grey).

    #215 fit_stage used BLENDER_WORKBENCH after setting Principled teal; Workbench ignored
    it and the grade was monochrome structure. body_material_distinct is unanswerable on that.
    Default EEVEE_NEXT (or BLENDER_EEVEE*), fall back to Workbench only if EEVEE fails —
    and materials already set viewport display color for that residual path.
    """
    scene = bpy.context.scene
    candidates = ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "EEVEE")
    for eng in candidates:
        try:
            scene.render.engine = eng
            if scene.render.engine == eng or eng in str(scene.render.engine):
                return str(scene.render.engine)
        except Exception:
            continue
    scene.render.engine = "BLENDER_WORKBENCH"
    return "BLENDER_WORKBENCH"


def render_png(path: str, res_x: int = 1280, res_y: int = 720) -> str:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    engine = choose_grade_engine()
    # Solid lighting so EEVEE grades are readable without a full light setup beyond key.
    try:
        scene.eevee.taa_render_samples = 16
    except Exception:
        pass
    scene.render.resolution_x = res_x
    scene.render.resolution_y = res_y
    scene.render.filepath = path
    scene.render.image_settings.file_format = "PNG"
    try:
        bpy.ops.render.render(write_still=True)
    except Exception:
        if engine != "BLENDER_WORKBENCH":
            scene.render.engine = "BLENDER_WORKBENCH"
            engine = "BLENDER_WORKBENCH"
            bpy.ops.render.render(write_still=True)
        else:
            raise
    return engine


def write_report(path: str, report: dict) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def apply_macros(basemesh: bpy.types.Object, phenotype: dict) -> dict:
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    from bl_ext.user_default.mpfb.entities.objectproperties import HumanObjectProperties

    macro = TargetService.get_default_macro_info_dict()
    for key in ("gender", "age", "muscle", "weight", "proportions", "height", "cupsize", "firmness"):
        if key in phenotype:
            macro[key] = float(phenotype[key])
    if isinstance(phenotype.get("race"), dict):
        macro["race"].update({k: float(v) for k, v in phenotype["race"].items()})

    for key in macro:
        if key != "race":
            HumanObjectProperties.set_value(key, macro[key], entity_reference=basemesh)
    for key, val in macro["race"].items():
        HumanObjectProperties.set_value(key, val, entity_reference=basemesh)

    TargetService.reapply_macro_details(basemesh, remove_zero_weight_targets=False)
    bpy.context.view_layer.update()
    return TargetService.get_macro_info_dict_from_basemesh(basemesh)


def load_mpfb_face_shape_keys(basemesh: bpy.types.Object, *, min_count: int = 24) -> dict:
    """Load native MPFB face/expression/mouth targets AFTER macro bake (#221 A2).

    Does NOT invent viseme_* names or a runtime name map — exports MakeHuman-family names
    so the inspect can measure intersects vs disjoint_measured against the runtime vocabulary.
    Targets come from the user MPFB extension data/targets tree (not vendored).
    """
    from bl_ext.user_default.mpfb.services.targetservice import TargetService

    status: dict = {
        "loaded": 0,
        "names": [],
        "error": None,
        "targetsRoot": None,
    }
    try:
        home = Path.home()
        targets_root = (
            home
            / "Library/Application Support/Blender/5.1/extensions/user_default/mpfb/data/targets"
        )
        if not targets_root.is_dir():
            status["error"] = f"MPFB targets dir missing: {targets_root}"
            return status
        status["targetsRoot"] = str(targets_root)

        # Prefer expression + mouth + eyes/eyebrows/cheek/chin — face-relevant, ≥20 names.
        subdirs = ("expression", "mouth", "eyes", "eyebrows", "cheek", "chin", "nose", "forehead")
        candidates: list[Path] = []
        for sub in subdirs:
            d = targets_root / sub
            if not d.is_dir():
                continue
            for p in sorted(d.rglob("*.target.gz")):
                candidates.append(p)
            for p in sorted(d.rglob("*.target")):
                candidates.append(p)

        # Cap load so export stays bounded; need ≥ min_count for disjoint_measured evidence.
        loaded_names: list[str] = []
        for path in candidates:
            if len(loaded_names) >= max(min_count + 8, 32):
                break
            try:
                name = TargetService.filename_to_shapekey_name(path.name, encode_name=False)
                TargetService.load_target(basemesh, str(path), weight=0.0, name=name)
                loaded_names.append(name)
            except Exception:
                continue

        # Zero all non-basis keys so export defaults are rest.
        if basemesh.data.shape_keys:
            for kb in basemesh.data.shape_keys.key_blocks:
                if kb.name != "Basis":
                    kb.value = 0.0

        status["loaded"] = len(loaded_names)
        status["names"] = loaded_names
        if len(loaded_names) < min_count:
            status["error"] = (
                f"only {len(loaded_names)} face targets loaded (need ≥{min_count})"
            )
    except Exception as exc:  # noqa: BLE001
        status["error"] = f"{type(exc).__name__}: {exc}"
        status["traceback"] = traceback.format_exc()[-1500:]
    return status


def strip_helper_geometry(basemesh: bpy.types.Object) -> dict:
    """Remove MH helper/joint vertices so grade/export is body surface, not the long-skirt helper shell.

    #215 library export kept helpers (~74k verts); for body_param grade the helpers bury the
    fitted scrub. ClothesService mhclo maps to body verts — helpers are not required after fit
    for a static library GLB without rig weights.
    """
    before = len(basemesh.data.vertices)
    # Ensure vertex groups exist (import_obj alone does not assign them)
    try:
        from bl_ext.user_default.mpfb.services.objectservice import ObjectService

        if not basemesh.vertex_groups:
            ObjectService.assign_vertex_groups(basemesh, ObjectService.get_base_mesh_vertex_group_definition(), None)
    except Exception:
        pass

    helper_names = [
        g.name
        for g in basemesh.vertex_groups
        if str(g.name).startswith("helper-")
        or str(g.name).startswith("joint-")
        or str(g.name).lower() in {"helpergeometry", "helpers"}
    ]
    if not helper_names:
        return {"stripped": False, "vertexCountBefore": before, "vertexCountAfter": before}

    bpy.ops.object.select_all(action="DESELECT")
    basemesh.select_set(True)
    bpy.context.view_layer.objects.active = basemesh
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    # Select verts with any weight in helper groups
    for vg_name in helper_names:
        vg = basemesh.vertex_groups.get(vg_name)
        if vg is None:
            continue
        for v in basemesh.data.vertices:
            try:
                if vg.weight(v.index) > 0.05:
                    v.select = True
            except RuntimeError:
                pass
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    after = len(basemesh.data.vertices)
    return {
        "stripped": True,
        "helperGroups": helper_names[:20],
        "helperGroupCount": len(helper_names),
        "vertexCountBefore": before,
        "vertexCountAfter": after,
    }


# Distinct body vs garment colours so grade PNG is not monochrome (#215 lesson)
BODY_COLORS = {
    0: (0.78, 0.58, 0.48, 1.0),  # warm skin
    1: (0.62, 0.48, 0.40, 1.0),  # cooler skin
}
GARMENT_COLORS = {
    0: (0.08, 0.52, 0.95, 1.0),  # vivid blue (upper)
    1: (0.10, 0.62, 0.28, 1.0),  # vivid green (upper)
}
# #220 lower garment — scrub/teal distinct from upper + skin
LOWER_GARMENT_COLORS = {
    0: (0.12, 0.38, 0.42, 1.0),  # teal scrub pants
    1: (0.18, 0.28, 0.40, 1.0),  # slate clinical pants
}


def _fit_one_garment(
    *,
    mhclo_path: str,
    garment_obj_path: str,
    garment_mesh_name: str,
    basemesh: bpy.types.Object,
    color: tuple[float, float, float, float],
    ClothesService,
    Mhclo,
) -> tuple[bpy.types.Object, float]:
    """Import + ClothesService.fit_clothes_to_human while basemesh macros are LIVE."""
    garment = import_obj(garment_obj_path, garment_mesh_name, force_z=False)
    garment.data.materials.clear()
    garment.data.materials.append(make_material(f"mat_{garment_mesh_name}", color))
    mhclo = Mhclo()
    mhclo.load(mhclo_path)
    try:
        mhclo.clothes = garment
    except Exception:
        pass
    t_fit = time.perf_counter()
    ClothesService.fit_clothes_to_human(garment, basemesh, mhclo=mhclo, set_parent=True)
    fit_s = time.perf_counter() - t_fit
    bpy.context.view_layer.update()
    return garment, fit_s


# ── issue-320: the upper garment's hem must MEET the lower garment's waistband ────
# The #295-grade ragged band of bare skin at the waist is a GAP BETWEEN TWO GARMENT
# EDGES, not poke-through — no face pokes through anything, and the coverage gate is
# structurally blind to it (§6t: gates that measure proximity/extremes miss defects
# that live in continuity). The hem terminus is DERIVED from the lower garment's own
# waistband rim (D1), never an authored per-body coordinate (`1.55`-style constants
# are the #316 class). Constants mirror the evidence contract
# (`garments-meet-at-the-waist.test.ts`) so the factory and the gate measure the same
# edges at the same resolution.
WAIST_OVERLAP_MARGIN_M = 0.005  # positive overlap target: "several millimetres" (#320)
WAIST_RIM_FRACTION = 0.12  # same rim band the evidence contract measures
WAIST_BUCKETS = 36


def _waistband_rim_per_bucket(obj: bpy.types.Object, *, height_axis: int = 2) -> np.ndarray:
    """Highest vertex per angular bucket in an object's TOP rim band (Z-up stage frame).

    Mirrors the evidence contract's lower-garment edge: the waistband is the highest
    vertex of the lower garment's top rim band at each angle around the vertical axis.
    Returns a per-bucket array in metres; buckets with no rim vertices stay -inf. The
    angle convention matches the exported Y-up GLB the contract reads EXACTLY: the
    export maps stage (x, y, z) to glTF (x, z, -y) (export_yup=True), so the contract's
    atan2(glb_z, glb_x) is atan2(-stage_y, stage_x). Negating stage Y here makes a
    factory bucket the same angular bucket the evidence test measures, so the
    per-bucket guarantee is exact rather than a reflected approximation.
    """
    v = np.array([tuple(vc.co) for vc in obj.data.vertices], dtype=float)
    h = v[:, height_axis]
    hi = float(h.max())
    lo = float(h.min())
    band_lo = hi - (hi - lo) * WAIST_RIM_FRACTION
    sel = h >= band_lo
    angles = np.arctan2(-v[sel, 1], v[sel, 0])
    buckets = (
        np.floor(((angles + np.pi) / (2 * np.pi)) * WAIST_BUCKETS) % WAIST_BUCKETS
    ).astype(np.int64)
    per = np.full(WAIST_BUCKETS, -np.inf)
    np.maximum.at(per, buckets, h[sel])
    return per


def fit_upper_hem_to_waistband(
    garment: bpy.types.Object,
    lower_garment: bpy.types.Object,
    *,
    height_axis: int = 2,
) -> dict:
    """issue-320 — push the upper garment's hem down to the lower waistband.

    Runs AFTER the lower coverage gate so `lower_garment` is the geometry that SHIPS
    (a sparse library fit is replaced by the body-derived cover shell in that gate;
    measuring before it reads a mesh that never reaches the export). The upper
    garment's bottom rim band is pushed down per angular bucket until the bucket's
    lowest vertex clears the lower garment's highest waistband vertex by
    WAIST_OVERLAP_MARGIN_M. The terminus is DERIVED from the lower garment's own
    waistband rim (D1). The push tapers to zero at the top of the rim band so the band
    stays welded to the garment above (no torn seam); a garment that already meets
    (deficit = 0) is untouched — the known-good scrub column is a small improvement to
    ~5 mm of overlap, never a regression.
    """
    waist = _waistband_rim_per_bucket(lower_garment, height_axis=height_axis)
    gv = np.array([tuple(vc.co) for vc in garment.data.vertices], dtype=float)
    h = gv[:, height_axis]
    g_lo, g_hi = float(h.min()), float(h.max())
    band_hi = g_lo + (g_hi - g_lo) * WAIST_RIM_FRACTION
    sel = h <= band_hi
    if not sel.any():
        return {"enabled": True, "pushedVertexCount": 0, "note": "no hem rim band"}
    # Same reflected angle convention as _waistband_rim_per_bucket (and the contract):
    # atan2(-stage_y, stage_x) — see the helper's docstring.
    angles = np.arctan2(-gv[sel, 1], gv[sel, 0])
    buckets = (
        np.floor(((angles + np.pi) / (2 * np.pi)) * WAIST_BUCKETS) % WAIST_BUCKETS
    ).astype(np.int64)
    hem = np.full(WAIST_BUCKETS, np.inf)
    np.minimum.at(hem, buckets, h[sel])
    deficit = np.where(
        np.isfinite(waist) & np.isfinite(hem),
        np.maximum(0.0, hem - (waist - WAIST_OVERLAP_MARGIN_M)),
        0.0,
    )
    max_deficit = float(deficit.max()) if deficit.size else 0.0
    if max_deficit <= 1e-6:
        return {
            "enabled": True,
            "pushedVertexCount": 0,
            "maxDeficitMeters": 0.0,
            "note": "hem already meets waistband at every measured angle",
        }
    span = np.where(np.isfinite(hem), band_hi - hem, 1.0)
    taper = np.clip((band_hi - h[sel]) / np.maximum(span[buckets], 1e-9), 0.0, 1.0)
    push = deficit[buckets] * taper
    idx = np.where(sel)[0]
    moved = 0
    for k, p in enumerate(push):
        if p > 1e-6:
            garment.data.vertices[int(idx[k])].co[height_axis] = float(h[sel][k] - p)
            moved += 1
    return {
        "enabled": True,
        "pushedVertexCount": moved,
        "maxDeficitMeters": round(max_deficit, 5),
        "marginMeters": WAIST_OVERLAP_MARGIN_M,
        "note": "hem pushed down to the lower garment waistband rim (issue-320, derived)",
    }


# ── #329 case-authored phenotype → MPFB macro dict ─────────────────────────────
# The case definition authors a CLINICAL phenotype (height_cm, age in YEARS, bmi,
# build, gender_presentation, ...). The MPFB body generator consumes MACRO floats
# (0..1). Nothing translated between them, so an authored height never reached a
# vertex and an unauthored body class was the median human at 0.5.
#
# #328 closed the height half of this gap on the materializer rail by solving the
# height macro against MPFB's OWN exported body (bake-measure-interpolate; a closed
# form is refused because stature is a function of height AND age AND gender — the
# Anny header measures `(height_cm-85)/115` wrong by up to 47 cm). This issue joins
# the CHAIN: the macro dict below is derived from the case's authored phenotype, and
# the height macro is solved against the model via the SAME probe machinery #328
# proved (one copy lives in materialize_mpfb_humanoid_candidate.py; imported lazily
# so there is no second solver — D1).
#
# The non-height translations are DETERMINISTIC case→macro maps anchored to MPFB's
# macro.json band semantics (data/targets/macrodetails/macro.json), not clinical
# claims: gender 0=female..1=male, age 0..0.1875=baby..child, 0.1875..0.5=child..
# young, 0.5..1=young..old, weight 0=min..1=max, muscle 0=min..1=max. A body that
# looks like the person the case describes is NOT claimed (the planted contract's
# NOT TESTED); the claim is that the case's authored values reach the generator and
# the height is honoured against the model's own measurement.

_AUTHORED_MACRO_KEYS = (
    "gender",
    "age",
    "muscle",
    "weight",
    "proportions",
    "height",
    "cupsize",
    "firmness",
)


def _clamp01(value: float) -> float:
    return min(max(float(value), 0.0), 1.0)


def _gender_presentation_to_macro(gender_presentation: object) -> float | None:
    """Parse a case-authored gender_presentation string into the MPFB gender macro
    (0.0 female .. 1.0 male). None when the presentation carries no sex signal."""
    text = str(gender_presentation).strip().lower()
    if not text or text == "none":
        return None
    # "female" CONTAINS the substring "male" — check female FIRST (word-boundary
    # order), or every female presentation reads as ambiguous.
    if "female" in text:
        return 0.0
    if "male" in text:
        return 1.0
    return None  # e.g. "child" — no sex signal; caller keeps the neutral default


def _years_to_age_macro(years: object) -> float:
    """Deterministic years→age-macro map anchored to macro.json's band boundaries.

    macro.json: age 0..0.1875 = baby..child, 0.1875..0.5 = child..young, 0.5..1.0 =
    young..old. The map is monotonic and passes through those anchors; it is a
    TRANSLATION of the authored years, not a claim that MPFB's age target is a
    validated clinical age model.
    """
    y = float(years)
    if y <= 1.0:
        return 0.02  # infant edge of the child band
    if y <= 12.0:
        return 0.05 + (y - 1.0) / 11.0 * (0.1875 - 0.05)  # baby..child → child band
    if y <= 18.0:
        return 0.1875 + (y - 12.0) / 6.0 * (0.5 - 0.1875)  # child → young
    if y <= 65.0:
        return 0.5 + (y - 18.0) / 47.0 * (0.85 - 0.5)  # young → middle-aged
    return _clamp01(0.85 + (y - 65.0) / 25.0 * 0.15)  # middle-aged → old


def _bmi_to_weight_macro(bmi: object) -> float:
    """Deterministic bmi→weight-macro map (0=minweight .. 1=maxweight in macro.json).

    Anchored at bmi 25 (WHO normal/overweight boundary) ≈ the averageweight midpoint
    (0.5); linear to 0.05 at bmi 14 and 1.0 at bmi 35. A translation, not a clinical
    body-composition claim.
    """
    b = float(bmi)
    return _clamp01(0.05 + (b - 14.0) / 21.0 * 0.95)


def _build_to_muscle_macro(build: object) -> float:
    """Deterministic build-descriptor→muscle-macro map (0=minmuscle .. 1=maxmuscle).

    Authoring a `muscle` float takes precedence over the descriptor (checked by the
    caller). Unknown descriptors keep the neutral 0.5 (average) default.
    """
    text = str(build).strip().lower()
    if any(k in text for k in ("slender", "lean", "thin", "slim", "asthma", "frail")):
        return 0.3
    if any(k in text for k in ("athletic", "muscular", "fit", "toned")):
        return 0.7
    if any(k in text for k in ("heavy", "obese", "large", "stout", "stocky")):
        return 0.45
    return 0.5  # average / standard / unknown


def derive_macro_dict_from_authored_phenotype(
    authored: dict,
    *,
    base_macro: dict | None = None,
) -> tuple[dict, dict]:
    """#329 — translate a CASE-authored clinical phenotype into the MPFB macro dict.

    Every key `apply_macros`/`HumanService.create_human` consumes is produced here
    from an authored clinical key or a documented neutral default; the returned
    (macro, derivation) pair records WHICH authored key drove WHICH macro so the
    report can show that `bmi`/`build`/`gender_presentation` reached the generator
    instead of dying at the materializer.

    `height` is deliberately left at the base/default value — the caller solves it
    against the model's own body via solve_height_macro_from_stature (a closed-form
    height map is the refused treatment, see the module header).
    """
    if base_macro is None:
        base_macro = {}
    macro = {
        "gender": 0.5,
        "age": 0.5,
        "muscle": 0.5,
        "weight": 0.5,
        "proportions": 0.5,
        "height": 0.5,
        "cupsize": 0.5,
        "firmness": 0.5,
        "race": {"asian": 0.33, "caucasian": 0.33, "african": 0.33},
    }
    if base_macro:
        for k in _AUTHORED_MACRO_KEYS:
            if k in base_macro:
                macro[k] = float(base_macro[k])
        if isinstance(base_macro.get("race"), dict):
            macro["race"].update({k: float(v) for k, v in base_macro["race"].items()})

    derivation: dict[str, str] = {}

    # gender ← gender_presentation string (0=female .. 1=male); authored float wins.
    if isinstance(authored.get("gender"), (int, float)):
        macro["gender"] = _clamp01(authored["gender"])
        derivation["gender"] = "authored gender float"
    else:
        gp = _gender_presentation_to_macro(authored.get("gender_presentation"))
        if gp is not None:
            macro["gender"] = gp
            derivation["gender"] = "gender_presentation"
        else:
            derivation["gender"] = "default 0.5 (no sex signal in gender_presentation)"

    # age ← authored age in YEARS (the case's `age: 8` is years, not the MPFB macro).
    if isinstance(authored.get("age"), (int, float)):
        macro["age"] = round(_years_to_age_macro(authored["age"]), 4)
        derivation["age"] = "age (years) -> macro.json bands"
    else:
        derivation["age"] = "default 0.5 (no authored age)"

    # weight ← authored bmi (monotonic map); authored weight float wins.
    if isinstance(authored.get("weight"), (int, float)):
        macro["weight"] = _clamp01(authored["weight"])
        derivation["weight"] = "authored weight float"
    elif isinstance(authored.get("bmi"), (int, float)):
        macro["weight"] = round(_bmi_to_weight_macro(authored["bmi"]), 4)
        derivation["weight"] = "bmi -> weight macro"
    else:
        derivation["weight"] = "default 0.5 (no authored bmi/weight)"

    # muscle ← authored build descriptor (or authored muscle float).
    if isinstance(authored.get("muscle"), (int, float)):
        macro["muscle"] = _clamp01(authored["muscle"])
        derivation["muscle"] = "authored muscle float"
    elif authored.get("build"):
        macro["muscle"] = _build_to_muscle_macro(authored["build"])
        derivation["muscle"] = "build -> muscle macro"
    else:
        derivation["muscle"] = "default 0.5 (no authored build/muscle)"

    for key in ("proportions", "cupsize", "firmness"):
        if isinstance(authored.get(key), (int, float)):
            macro[key] = _clamp01(authored[key])
            derivation[key] = f"authored {key}"
        else:
            derivation[key] = f"default 0.5 (no authored {key})"

    # height is solved by the caller (never mapped here).
    derivation["height"] = "SOLVED against the model (bake-measure-interpolate, #328 machinery)"
    return macro, derivation


def _mpfb_probe_stature(macro: dict, tmp_dir) -> float:
    """Measure MPFB's own stature for a macro dict — REUSE of the #328 probe.

    One copy of the bake-measure-interpolate machinery lives in
    materialize_mpfb_humanoid_candidate.py (create_human → bake_targets →
    bake_modifiers_remove_helpers → GLB export → pure-python stature read). This
    module imports it lazily so the two rails share a solver instead of growing a
    second one (the issue's refused treatment is a closed-form map, and "do not
    re-implement" the solve). The lazy import is safe: that module imports this one
    only inside functions, so there is no cycle.
    """
    _ensure_probe_machinery_path()
    from materialize_mpfb_humanoid_candidate import _bake_and_export_probe  # noqa: E402

    out = pathlib_path(tmp_dir) / "probe.glb"
    try:
        return _bake_and_export_probe(macro, str(out))["statureMeters"]
    finally:
        out.unlink(missing_ok=True)


def pathlib_path(p) -> Path:
    """Small adapter so callers can pass str or Path."""
    return Path(p) if not isinstance(p, Path) else p


def _ensure_probe_machinery_path() -> None:
    """Put #328's probe module on sys.path (it lives under evidence/blender, not here).

    The solve is reused, not re-implemented: the bake-measure-interpolate machinery
    (create_human → bake → strip → GLB export → pure-python stature read) stays in
    materialize_mpfb_humanoid_candidate.py and is imported lazily from here.
    """
    probe_dir = Path(__file__).resolve().parent.parent.parent / "evidence" / "blender"
    probe_dir_str = str(probe_dir)
    if probe_dir_str not in sys.path:
        sys.path.insert(0, probe_dir_str)


def measure_height_reachable_band(macro_base: dict, tmp_dir) -> tuple[float, float]:
    """PER-ACTOR reachable stature band, measured on the MPFB model.

    Probes the model at height macro 0 and 1 with the actor's OTHER macros fixed —
    the counterweight clause (3) of the planted contract: a band cannot be produced
    by echoing a float or evaluating a formula, only by measuring the model twice
    for that actor. Returns (floor_m, ceiling_m) with ceiling > floor.
    """
    _ensure_probe_machinery_path()
    from materialize_mpfb_humanoid_candidate import _bake_and_export_probe  # noqa: E402

    tmp = pathlib_path(tmp_dir)
    tmp.mkdir(parents=True, exist_ok=True)

    def probe(height_macro: float) -> float:
        macro = dict(macro_base)
        macro["height"] = round(float(height_macro), 4)
        out = tmp / f"band_h{macro['height']:.4f}.glb"
        try:
            return _bake_and_export_probe(macro, str(out))["statureMeters"]
        finally:
            out.unlink(missing_ok=True)

    s0 = probe(0.0)
    s1 = probe(1.0)
    floor_m, ceiling_m = (s0, s1) if s0 <= s1 else (s1, s0)
    if not (ceiling_m > floor_m):
        raise RuntimeError(
            f"#329: degenerate height-macro band [{floor_m:.4f}, {ceiling_m:.4f}] m — "
            "the MPFB model does not respond to the height macro for this actor"
        )
    return (floor_m, ceiling_m)


def solve_height_macro_from_stature(
    macro_base: dict,
    target_stature_m: float,
    tmp_dir,
    *,
    tol_m: float = 0.01,
) -> dict:
    """#329 — solve the height macro so the model's own body reaches the target.

    Delegates to #328's `solve_height_macro` (bake-measure-interpolate against the
    exported body — the ALL-PASS treatment (d) in the planted header), then measures
    the solved body once more to record the resulting stature. Refuses loudly when
    the target is outside the measured reachable band rather than shipping a short
    body. MADR 0051 §5 tolerance (±1 cm of the authored height) is the caller's —
    the solve's internal tol is 1 cm and the final probe is reported for the row.
    """
    _ensure_probe_machinery_path()
    from materialize_mpfb_humanoid_candidate import solve_height_macro  # noqa: E402

    tmp = pathlib_path(tmp_dir)
    tmp.mkdir(parents=True, exist_ok=True)
    # Band first, OUTSIDE the try: a degenerate band is its own refusal and must not
    # be re-wrapped (the band variable would not exist in the except block).
    band = measure_height_reachable_band(macro_base, tmp)
    try:
        h_solved = solve_height_macro(
            dict(macro_base), float(target_stature_m), tmp, tol=tol_m
        )
    except RuntimeError as exc:
        raise RuntimeError(
            f"#329: authored height {target_stature_m * 100:.1f} cm is outside this "
            f"actor's measured reachable band [{band[0] * 100:.1f}, "
            f"{band[1] * 100:.1f}] cm on MPFB's own body — refusing to ship a body "
            f"that does not honour the case. Measured band recorded; do NOT widen "
            f"the band to make the row pass. ({exc})"
        ) from exc
    solved_macro = dict(macro_base)
    solved_macro["height"] = round(float(h_solved), 4)
    measured = _mpfb_probe_stature(solved_macro, tmp)
    return {
        "heightMacro": round(float(h_solved), 4),
        "measuredStatureM": measured,
        "reachableBandCm": [round(band[0] * 100.0, 2), round(band[1] * 100.0, 2)],
        "bandMeasured": True,
    }


def build_one_body_class(
    *,
    body_class: dict,
    class_index: int,
    mhclo_path: str,
    garment_obj_path: str,
    mh_base_obj: str,
    out_dir: Path,
    garment_prefix: str,
    body_prefix: str,
    anny_obj: str,
    ClothesService,
    Mhclo,
    ObjectService,
    GeneralObjectProperties,
    lower_mhclo_path: str = "",
    lower_garment_obj_path: str = "",
    lower_garment_prefix: str = "makeclothes_library_cargo_pants",
) -> dict:
    """Build one body class.

    Order measured in issue-151 fit-orient probe:
      1) load base.obj exactly as #215 (import_obj, NOT create_human)
      2) set Basemesh tag + apply macros as live shape keys
      3) ClothesService.fit while shape keys are LIVE (fit reads a from-mix key)
      4) bake macro targets into vertices, then re-load MPFB face keys for morph export
      5) Anny foot/centre align + girth recording with garment parented (NOT stature —
         #304: stature comes from the macros; the reference is placement-only), then
         unparent + apply
      6) bind armature + export WITH skins and morphs
    Baking BEFORE fit rotated/collapsed the scrub (probe: garment Z extent ~2.6 vs
    good no-macro fit Z ~5.1 on the same basemesh).

    #221: per-class `annyObj` on the body_class dict overrides the CLI default so male/female
    references stay aligned (age/size/gender via Anny-as-reference → MPFB match).

    #275: per-class `garment` on the body_class dict drives the UPPER garment from the
    CASE DEFINITION. `kind=library` fits the given .mhclo (the scrub shirt today); the
    CLI falls back to that for any role without a case-definition garment. `kind=cover_shell`
    builds the deterministic body-derived cover shell (#277's factory fallback mechanism)
    over the torso band — used when the case definition selects a garment the .mhclo
    library cannot provide (civilian/family layers). The stage default is the fallback.
    """
    from bl_ext.user_default.mpfb.services.targetservice import TargetService

    body_class_id = str(body_class["bodyClassId"])
    # Prefer per-class Anny reference (#221); fall back to stage-wide anny_obj.
    class_anny = str(body_class.get("annyObj") or anny_obj or "").strip()
    anny_reference_asset = str(body_class.get("annyReferenceAsset") or "").strip() or None
    phenotype = {
        "weight": float(body_class.get("weight", 0.5)),
        "gender": float(body_class.get("gender", 0.5)),
        "age": float(body_class.get("age", 0.5)),
        "muscle": float(body_class.get("muscle", 0.5)),
        "height": float(body_class.get("height", 0.5)),
        "proportions": float(body_class.get("proportions", 0.5)),
    }
    # #329 — the macros must come from the CASE, not from hand-authored body-class
    # literals. When the body class carries the case's authored phenotype (resolved
    # by the CLI from buildActorPhenotypeExport), derive every macro from it and
    # solve the height against MPFB's own measured body. A body whose own band cannot
    # reach the authored height REFUSES loudly with the measured band recorded — the
    # planted contract's clause (1) accepts a recorded refusal, never a silently
    # short body. The legacy literal path stays as the fallback for a body class
    # with no authored phenotype (counterweight).
    macro_source = "authored_body_class_literals"
    macro_derivation: dict = {}
    phenotype_solve: dict = {}
    authored_phenotype = body_class.get("authoredPhenotype")
    if isinstance(authored_phenotype, dict) and authored_phenotype:
        base_macro, macro_derivation = derive_macro_dict_from_authored_phenotype(
            authored_phenotype
        )
        target_cm = authored_phenotype.get("height_cm")
        if isinstance(target_cm, (int, float)) and float(target_cm) > 0:
            tmp_solve = Path(out_dir).parent / f".{body_class_id}.height-solve"
            try:
                solved = solve_height_macro_from_stature(
                    base_macro, float(target_cm) / 100.0, tmp_solve
                )
            finally:
                import shutil

                shutil.rmtree(tmp_solve, ignore_errors=True)
            base_macro["height"] = solved["heightMacro"]
            phenotype = base_macro
            macro_source = "case_authored_phenotype_issue_329"
            phenotype_solve = {
                "authoredHeightCm": float(target_cm),
                "solvedHeightMacro": solved["heightMacro"],
                "measuredStatureM": round(solved["measuredStatureM"], 4),
                "reachableBandCm": solved["reachableBandCm"],
                "heightHonoured": abs(solved["measuredStatureM"] * 100.0 - float(target_cm)) <= 1.0,
            }
        else:
            phenotype = {k: base_macro[k] for k in ("gender", "age", "muscle", "weight", "proportions")}
            phenotype["height"] = base_macro.get("height", 0.5)
            macro_source = "case_authored_phenotype_issue_329_no_height_target"

    # ── #275 per-class upper garment selection (case definition → garment) ────────
    # The CLI resolves the garment from the cast role; this stage only executes it.
    # `library` = fit the given .mhclo via ClothesService (fallback: scrub shirt).
    # `cover_shell` = deterministic body-derived shell over the torso band (no .mhclo
    # invented — a garment id pointing at a missing .mhclo is the #256 trap).
    garment_spec = body_class.get("garment") or {}
    garment_kind = str(garment_spec.get("kind") or "library")
    if garment_kind not in ("library", "cover_shell"):
        raise ValueError(
            f"body class {body_class_id}: garment.kind '{garment_kind}' — library or cover_shell only"
        )
    use_mhclo = str(garment_spec.get("mhcloPath") or mhclo_path)
    use_garment_obj = str(garment_spec.get("objPath") or garment_obj_path)
    use_garment_prefix = str(garment_spec.get("meshNamePrefix") or garment_prefix)
    garment_band = (
        float(garment_spec.get("bandLowFraction") or 0.53),
        float(garment_spec.get("bandHighFraction") or 0.85),
    )

    clear_scene()
    enable_mpfb()

    body_mesh_name = f"{body_prefix}_{body_class_id}"
    # #215 body load path — raw base.obj import (create_human placement is wrong here)
    basemesh = import_obj(mh_base_obj, body_mesh_name, force_z=False)
    basemesh.data.materials.clear()
    basemesh.data.materials.append(make_material(f"skin_{body_class_id}", BODY_COLORS[class_index % 2]))
    GeneralObjectProperties.set_value("object_type", "Basemesh", entity_reference=basemesh)

    # issue-307 — wire the MPFB-shipped CC0 rig + weight map HERE, on the RAW mesh
    # (before macros/bake): MPFB's rig-position strategies read joint-* marker verts
    # from the current mesh state, and `bake_targets` MANGLES those markers (measured:
    # joint-head moves from z≈6.97 to z≈−0.48, a 0.75 m drop) — a rig created after
    # the bake lands flattened into the hip plane with the head at the chest. On the
    # raw mesh the markers are at their MakeHuman-anatomical positions, so the bones
    # come out correct and stay there while the body morphs around them.
    rig_created = create_mpfb_mixamo_rig(basemesh)
    armature = bpy.data.objects.get(rig_created["armatureObjectName"])
    if armature is None:
        raise RuntimeError(
            f"issue-307: armature {rig_created['armatureObjectName']} missing after rig creation"
        )
    bpy.context.view_layer.update()

    applied = apply_macros(basemesh, phenotype)
    bpy.context.view_layer.update()
    girth_pre = torso_girth_proxy(basemesh)

    # Fit while macros are LIVE shape keys — ClothesService builds a from-mix key.
    # #220: fit UPPER then LOWER before baking macros so both mhclo maps read phenotype shape.
    garment_mesh_name = f"{use_garment_prefix}_{body_class_id}"
    garment: bpy.types.Object | None = None
    fit_s = 0.0
    if garment_kind == "library":
        garment, fit_s = _fit_one_garment(
            mhclo_path=use_mhclo,
            garment_obj_path=use_garment_obj,
            garment_mesh_name=garment_mesh_name,
            basemesh=basemesh,
            color=GARMENT_COLORS[class_index % 2],
            ClothesService=ClothesService,
            Mhclo=Mhclo,
        )
    else:
        # cover_shell: built from the FINAL body surface at the coverage gate, after
        # macro bake + helper strip + Anny align. Nothing is fitted here.
        print(f"[body_param] {body_class_id}: upper garment = deterministic cover shell "
              f"(case-driven, no .mhclo) band={garment_band[0]:.2f}..{garment_band[1]:.2f}")

    lower_garment: bpy.types.Object | None = None
    lower_mesh_name: str | None = None
    lower_fit_s = 0.0
    if lower_mhclo_path and lower_garment_obj_path:
        if not Path(lower_mhclo_path).is_file() or not Path(lower_garment_obj_path).is_file():
            raise RuntimeError(
                f"lower garment paths missing: mhclo={lower_mhclo_path} obj={lower_garment_obj_path}"
            )
        lower_mesh_name = f"{lower_garment_prefix}_{body_class_id}"
        lower_garment, lower_fit_s = _fit_one_garment(
            mhclo_path=lower_mhclo_path,
            garment_obj_path=lower_garment_obj_path,
            garment_mesh_name=lower_mesh_name,
            basemesh=basemesh,
            color=LOWER_GARMENT_COLORS[class_index % 2],
            ClothesService=ClothesService,
            Mhclo=Mhclo,
        )

    # Bake macros into body vertices AFTER all fits so skinning binds the phenotype shape.
    # Face keys are re-loaded after bake for morph export (#221 A2) — bake would drop them.
    TargetService.bake_targets(basemesh)
    bpy.context.view_layer.update()

    # #221 A2 — load face targets on FULL base topology (MPFB indices), THEN strip helpers.
    # Blender updates shape-key blocks when helper verts are deleted; face deltas on body
    # surface verts survive. Loading after strip would mis-index targets.
    face_keys = load_mpfb_face_shape_keys(basemesh, min_count=20)
    bpy.context.view_layer.update()
    helper_strip = strip_helper_geometry(basemesh)
    bpy.context.view_layer.update()

    def _ensure_parented(child: bpy.types.Object) -> None:
        if child.parent is not basemesh:
            child.parent = basemesh
            child.matrix_parent_inverse = basemesh.matrix_world.inverted()

    def _unparent_apply(child: bpy.types.Object) -> None:
        mw_g = child.matrix_world.copy()
        child.parent = None
        child.matrix_world = mw_g
        apply_object_transforms(child)

    outfit: list[bpy.types.Object] = [g for g in [garment, lower_garment] if g is not None]

    # Foot/centre align to Anny + girth recording (0044 path; NOT stature — #304:
    # stature comes from the macros, the reference is placement-only) while garments
    # are still parented. issue-307: the mixamo armature gets the SAME scale + translate
    # so its bones stay inside the skinned body.
    align_info: dict = {"skipped": True}
    anny_ref_used: str | None = None
    if class_anny and Path(class_anny).is_file():
        anny = import_obj(class_anny, "anny_stature_reference", force_z=True)
        anny.data.materials.clear()
        anny.data.materials.append(make_material("anny_ref", (0.82, 0.68, 0.56, 1.0)))
        for g in outfit:
            _ensure_parented(g)
        align_info = align_body_to_reference(basemesh, anny, armature=armature)
        bpy.context.view_layer.update()
        apply_object_transforms(basemesh)
        apply_object_transforms(armature)
        for g in outfit:
            _unparent_apply(g)
        bpy.data.objects.remove(anny, do_unlink=True)
        anny_ref_used = anny_reference_asset or class_anny
        align_info["annyObj"] = class_anny
        align_info["annyReferenceAsset"] = anny_ref_used
    else:
        basemesh.scale = (MH_UNITS_TO_METRES,) * 3
        armature.scale = (MH_UNITS_TO_METRES,) * 3
        bpy.context.view_layer.update()
        for g in outfit:
            _ensure_parented(g)
        apply_object_transforms(basemesh)
        for g in outfit:
            _unparent_apply(g)
        feet_z = world_bounds(basemesh)["min"][2]
        basemesh.location.z -= feet_z
        armature.location.z -= feet_z
        apply_object_transforms(basemesh)
        apply_object_transforms(armature)
        align_info = {"uniformScale": 0.1, "path": "mpfb_default_0_1_without_anny"}

    girth_post = torso_girth_proxy(basemesh)
    body_bounds = world_bounds(basemesh)
    garment_bounds = world_bounds(garment) if garment is not None else None

    basemesh.name = body_mesh_name
    basemesh.data.name = body_mesh_name
    if garment is not None:
        garment.name = garment_mesh_name
        garment.data.name = garment_mesh_name
    if lower_garment is not None and lower_mesh_name:
        lower_garment.name = lower_mesh_name
        lower_garment.data.name = lower_mesh_name

    # ── issue-272 garment region coverage gate (clothing_consume) ────────────────
    # Library fits place garments coincident with the skin (measured median ≈ 0.7 mm,
    # half the surface behind the body surface → the translucent/z-fighting patch), and a
    # sparse library asset cannot cover the region it claims (the 392-triangle cargo
    # trouser: 71% leg coverage, 32 open edges — the "see-through legs"). Every fitted
    # garment is measured against the body region it claims; a garment that does not
    # cover is replaced by a deterministic body-derived cover shell (covers by
    # construction), and accepted garments get a uniform outward cloth standoff so they
    # sit OUTSIDE the skin. Nothing here touches triangle counts (D9 / meshoptimizer).
    coverage_gate: dict = {"enabled": True, "upper": None, "lower": None, "note": ""}
    # issue-320 — how the upper garment's hem meets the lower garment's waistband.
    # Populated by the cover-shell band derivation and/or the fitted-hem push below.
    coverage_gate["waistMeet"] = {"enabled": True, "upper": None}

    def _numpy_mesh(obj: bpy.types.Object):
        # Triangulate polygons: OBJ imports and the MPFB basemesh are quad/n-gon
        # meshes (scrub shirt 4,692 quads = 9,384 tris; basemesh 13,378 quads =
        # 26,756 tris), while the coverage predicate assumes triangle faces.
        # Feeding raw polygons made the closed shirt read 13,400 boundary edges
        # and garbled the raycast (issue-277, measured on the first gate run).
        verts = np.array([v.co for v in obj.data.vertices], dtype=float)
        faces: list[tuple[int, int, int]] = []
        for p in obj.data.polygons:
            iv = list(p.vertices)
            if len(iv) == 3:
                faces.append((int(iv[0]), int(iv[1]), int(iv[2])))
            else:
                # fan triangulation from vertex 0; preserves edge sharing so a
                # closed quad shell still welds to 0 boundary edges.
                for i in range(1, len(iv) - 1):
                    faces.append((int(iv[0]), int(iv[i]), int(iv[i + 1])))
        return verts, np.array(faces, dtype=np.int64)

    body_verts, body_faces = _numpy_mesh(basemesh)

    def _mesh_from_numpy(name: str, verts, faces) -> bpy.types.Object:
        mesh = bpy.data.meshes.new(f"{name}_mesh")
        mesh.from_pydata(
            [tuple(float(x) for x in v) for v in verts],
            [],
            [tuple(int(x) for x in f) for f in faces],
        )
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj

    # #295 — garments do not claim the hands: exclude arm/forearm/hand-dominant body
    # faces from every cover shell the stage materializes. The band selection alone
    # wraps the A-pose hands, which hang at the same height as the torso and legs
    # (measured: 3,450 hand-dominant verts in the heavy-male lower fallback — the
    # "blue mitten" #295 graded from the pixels). Derived from the body's own
    # vertex-to-bone attribution (D1), never authored per-body coordinates.
    shell_limb_exclude = None
    if garment_kind == "cover_shell" or lower_garment is not None:
        limb_verts = _bone_dominant_vertex_indices(basemesh, armature, _LIMB_BONE_RE)
        shell_limb_exclude = np.array(
            [any(int(vi) in limb_verts for vi in f) for f in body_faces],
            dtype=bool,
        )
    if garment is None:
        if garment_kind != "cover_shell":
            raise RuntimeError(f"body class {body_class_id}: no upper garment materialized")
        bz = body_bounds
        zmin = float(bz["min"][2])
        body_h = float(bz["size"][2])
        band_lo = zmin + garment_band[0] * body_h
        band_hi = zmin + garment_band[1] * body_h
        shell = _gc.build_cover_shell(
            body_verts,
            body_faces,
            band_lo,
            band_hi,
            standoff=_gc.CLOTH_STANDOFF_M,
            label=f"{use_garment_prefix}_{body_class_id}",
            height_axis=2,
            exclude_faces=shell_limb_exclude,
        )
        shell_obj = _mesh_from_numpy(
            garment_mesh_name,
            np.asarray(shell["position"]).reshape(-1, 3),
            np.asarray(shell["indices"]).reshape(-1, 3),
        )
        shell_obj.data.materials.clear()
        shell_obj.data.materials.append(
            make_material(f"mat_{shell_obj.name}", GARMENT_COLORS[class_index % 2])
        )
        shell_obj.name = garment_mesh_name
        shell_obj.data.name = garment_mesh_name
        garment = shell_obj
        garment_bounds = world_bounds(garment)
        coverage_gate["note"] = (
            "case-selected upper garment has no .mhclo in the library; "
            "deterministic body-derived cover shell materialized (#275)"
        )
    # After the block above the upper garment always exists (fitted, or shell built,
    # or the code above raised). The assertion is for static checkers, not a runtime gate.
    assert garment is not None

    # ── #295: terminate every garment at the wrist ───────────────────────────────
    # Both the fitted .mhclo shell and the body-derived cover shell place garment
    # geometry over the hand (measured 2026-08-11: 17,345 hand-dominant upper-shell
    # verts on the lean-female body, and 3,450 on the heavy-male cargo pants — the
    # "blue mitten" #295 graded from the pixels). The garment's weights do not exist
    # until the bind, so run the SAME weight projection the bind will run, classify
    # each garment vertex by its dominant bone, and delete the hand-dominated ones.
    # The shell then terminates exactly where the hand bones' influence ends — derived
    # from the garment's own vertex-to-bone attribution (D1), not authored per-body
    # coordinates. The coverage gate and the hide mask below then measure the trimmed
    # garment; the later bind recomputes weights on the trimmed mesh (the projection is
    # position-based, so the remaining verts keep their non-hand classification).
    hand_trim: dict = {"enabled": True, "upper": None, "lower": None}
    if garment is not None:
        hand_trim["upper"] = {
            **transfer_weights_body_to_garment(basemesh, garment, armature),
            "trim": trim_garment_hand_region(garment, armature, slot="upper"),
        }
    if lower_garment is not None:
        hand_trim["lower"] = {
            **transfer_weights_body_to_garment(basemesh, lower_garment, armature),
            "trim": trim_garment_hand_region(lower_garment, armature, slot="lower"),
        }
    bpy.context.view_layer.update()

    # ── issue-322: fitted garments are measured at their SHIPPING position ─────────
    # The raw MakeClothes fit is coincident with the skin — the cloth_offset docstring
    # records "median ≈ 0.7 mm; half the surface behind the body surface" — so outward
    # rays from the body surface miss every OPEN fitted garment. Measured on the fitted
    # toigo_basic_tucked_t-shirt via the shared garment_coverage module: coverage 0.47
    # on the raw fit vs 0.97 at the 1.5 cm shipping standoff, while the closed scrub
    # passes the raw fit by closure alone (0.47 too). The evidence module measures the
    # shipped GLB, which IS offset; the gate must measure the same geometry or it
    # refuses honest open-shell garments. Cover shells are already built at the standoff
    # and skip this.
    if garment_kind != "cover_shell":
        ugv_pre, _ = _numpy_mesh(garment)
        ugv_off = _gc.cloth_offset(ugv_pre, body_verts, body_faces, _gc.CLOTH_STANDOFF_M)
        for i, v in enumerate(garment.data.vertices):
            v.co = tuple(float(x) for x in ugv_off[i])
        bpy.context.view_layer.update()

    garment_bounds = world_bounds(garment)

    # Upper garment: torso band = its own extent, laterally bounded by the garment's
    # own silhouette (issue-283: the arms hang through any torso band and are not part
    # of a shirt's claim — a closed shell once read 14-35% coverage for exactly that
    # reason, and now reads its honest claim ~0.93-1.00). Band axis is Z: the stage
    # scene is Z-up (height along Z) at gate time — the evidence module reads the exported
    # Y-up GLB and uses Y for the same physical band (issue-277, measured).
    ugv, ugf = _numpy_mesh(garment)
    upper_rep = _gc.coverage_report(
        body_verts,
        body_faces,
        ugv,
        ugf,
        float(garment_bounds["min"][2]) + 0.02,
        float(garment_bounds["max"][2]) - 0.02,
        garment_label="upper",
        height_axis=2,
    )
    if upper_rep["verdict"] == "does_not_cover":
        # A dense library upper garment passes on closure; firing here means the fit is
        # genuinely degenerate. Refuse loudly rather than ship a bare torso.
        raise RuntimeError(f"upper garment failed the issue-272 coverage gate: {upper_rep}")
    # The garment was already offset to its shipping standoff above; the gate measured
    # that geometry. Cover shells are built at the standoff and never re-offset.
    coverage_gate["upper"] = upper_rep

    if lower_garment is not None:
        lgv, lgf = _numpy_mesh(lower_garment)
        hem_z = float(garment_bounds["min"][2])  # upper garment hem (Z-up stage frame)
        ankle_z = float(body_bounds["min"][2]) + 0.10  # shoes/feet begin below
        lower_rep = _gc.coverage_report(
            body_verts,
            body_faces,
            lgv,
            lgf,
            ankle_z,
            hem_z,
            garment_label="lower",
            height_axis=2,
        )
        if lower_rep["verdict"] == "does_not_cover":
            # Sparse/open library fit (issue-272: 392-tri cargo trouser). Replace with
            # the body-derived cover shell: the body's own leg surface offset outward —
            # covers the region by construction (D2: procedural clothing, no LLM).
            shell = _gc.build_cover_shell(
                body_verts,
                body_faces,
                ankle_z,
                hem_z,
                standoff=_gc.CLOTH_STANDOFF_M,
                label=f"{lower_garment_prefix}_fallback_{body_class_id}",
                height_axis=2,
                exclude_faces=shell_limb_exclude,
            )
            fallback_obj = _mesh_from_numpy(
                lower_mesh_name or f"{lower_garment_prefix}_fallback_{body_class_id}",
                np.asarray(shell["position"]).reshape(-1, 3),
                np.asarray(shell["indices"]).reshape(-1, 3),
            )
            fallback_obj.data.materials.append(
                make_material(f"mat_{fallback_obj.name}", LOWER_GARMENT_COLORS[class_index % 2])
            )
            lower_garment = fallback_obj
            lower_mesh_name = fallback_obj.name
            lower_rep["fallback"] = "body_derived_cover_shell"
            lower_rep["fallbackVertexCount"] = shell["vertexCount"]
            lower_rep["fallbackFaceCount"] = shell["faceCount"]
            coverage_gate["note"] = (
                coverage_gate["note"] + "; "
                if coverage_gate.get("note")
                else ""
            ) + "library lower fit did not cover its region; replaced with body-derived cover shell"
        else:
            lgv_off = _gc.cloth_offset(lgv, body_verts, body_faces, _gc.CLOTH_STANDOFF_M)
            for i, v in enumerate(lower_garment.data.vertices):
                v.co = tuple(float(x) for x in lgv_off[i])
        coverage_gate["lower"] = lower_rep
    bpy.context.view_layer.update()

    # ── issue-320: the upper garment's hem must MEET the lower garment's waistband ─
    # The #295-grade ragged band of bare skin at the waist is a GAP BETWEEN TWO GARMENT
    # EDGES, not poke-through — no face pokes through anything, and the coverage gate
    # is structurally blind to it (§6t). Runs HERE, after the lower coverage gate, so
    # `lower_garment` is the geometry that SHIPS (a sparse library fit is replaced by
    # the body-derived cover shell in the gate above; measuring before it reads a
    # mesh that never reaches the export). The upper hem's bottom rim band is pushed
    # down per angular bucket until the bucket's lowest vertex clears the lower
    # garment's highest waistband vertex by WAIST_OVERLAP_MARGIN_M. The terminus is
    # DERIVED from the lower garment's own waistband rim (D1) — never an authored
    # per-body coordinate. A garment that already meets is a no-op; the known-good
    # scrub column lands ~5 mm of overlap instead of +0.1 mm (the issue names
    # "several millimetres" as the robust target).
    if lower_garment is not None and garment is not None:
        coverage_gate["waistMeet"]["upper"] = fit_upper_hem_to_waistband(garment, lower_garment)
    elif coverage_gate["waistMeet"].get("upper") is None:
        coverage_gate["waistMeet"]["upper"] = {
            "skipped": True,
            "note": "no lower garment — nothing to meet",
        }

    # ── issue-285: body-part hiding (the §6s research answer) ──────────────────
    # The body-derived cover shell offset along vertex normals self-intersects at the
    # concave hip/waist crease — the body surface renders in front of / z-fights the
    # shell there ("skin through the blue shell at the flanks", measured: 34.5% of the
    # female upper claim region is within 3 mm of the shell surface, and the fitted
    # scrub shirt carries the same coincidence). NO outward offset fixes a concave
    # fold; the industry answer is to HIDE the body under the garment (alpha mask).
    # Every accepted garment paints the body faces that poke it (signed clearance <
    # HIDE_EPSILON_M, same pure-numpy predicate the evidence test drives) with an
    # invisible material. Deterministic, no balloon (#121), and the geometry is
    # untouched — the coverage gate and the sparse-trouser refusal are unchanged
    # (counterweight). The evidence test proves the mask covers the pokes on the
    # shipped GLBs without re-running this bake.
    def _hide_under_garment(garment_obj: bpy.types.Object | None, slot: str) -> dict:
        if garment_obj is None:
            return {"slot": slot, "enabled": True, "hiddenFaceCount": 0, "note": "no garment"}
        hgv, hgf = _numpy_mesh(garment_obj)
        hb = world_bounds(garment_obj)
        mask_info = _gc.body_hide_mask(
            body_verts,
            body_faces,
            hgv,
            hgf,
            float(hb["min"][2]),
            float(hb["max"][2]),
            hide_epsilon_m=_gc.HIDE_EPSILON_M,
            height_axis=2,
        )
        # issue-287 — the per-face mask is consumed by apply_body_hide_material_region
        # below and must NOT ride into the stage report: it is a numpy bool array and
        # json.dumps raises "Object of type ndarray is not JSON serializable" (the #285
        # bake report serialization defect that made the re-bake fail at the last step).
        # Report the counts only; the mask itself lives in the exported GLB's materials.
        hide_mask = mask_info.pop("hideMask")
        if mask_info["hiddenFaceCount"] == 0:
            return {
                **mask_info,
                "slot": slot,
                "enabled": True,
                "note": "no poking body faces — nothing to hide",
            }
        # #295 — scope the mask to the covered region. The garments now terminate at
        # the wrist (trim_garment_hand_region), so a body face whose vertices are
        # dominated by a hand/finger joint is a BARE hand; leaving it under the
        # alpha-MASK would discard it and show a stump where the sleeve was. Derived
        # from the body's own CC0 weight attribution (never authored coordinates).
        hide_mask, hand_faces_unhidden = scope_hide_mask_away_from_hands(
            basemesh, hide_mask, armature
        )
        # #326 — clip the mask to the garment's footprint (the SHARED over-reach fix,
        # carried by all three rails: the signed-clearance test admits body faces just
        # outside the garment silhouette, and their discarded verts render as slivers).
        hide_mask, footprint_clipped = clip_hide_mask_to_garment_footprint(
            hide_mask, basemesh, world_bounds(garment_obj)
        )
        applied = apply_body_hide_material_region(basemesh, hide_mask, slot=slot)
        return {
            **mask_info,
            "slot": slot,
            "enabled": True,
            "applied": applied,
            "handFacesUnhidden": hand_faces_unhidden,
            "footprintClippedFaces": footprint_clipped,
            "note": (
                "body faces under the garment hidden (alpha mask), "
                "hands + outside-footprint faces excluded"
            ),
        }

    body_hide: dict = {"enabled": True, "upper": None, "lower": None}
    body_hide["upper"] = _hide_under_garment(garment, "upper")
    if lower_garment is not None:
        body_hide["lower"] = _hide_under_garment(lower_garment, "lower")
    coverage_gate["bodyHide"] = body_hide
    bpy.context.view_layer.update()

    # #279 — wire the proven bounds-derived scalp/hair material region (Anny rail) onto
    # the hm08 body. Both hm08 library bodies shipped bald (zero scalp/hair materials);
    # the region function was wired to Anny natively and MPFB via #222 but never to this
    # rail. Runs AFTER the coverage gate so the region is measured on the final
    # (aligned, helper-stripped, Z-up standing, face at -Y) body and BEFORE the armature
    # bind so skinning never touches the material indices.
    scalp_hair_region = apply_scalp_hair_material_region(basemesh)

    # #216/#220/#307 — bind body + upper (+ lower) to the mixamo_unity armature
    # (the body's skin is the shipped CC0 weight map from create_mpfb_mixamo_rig).
    extra = [lower_garment] if lower_garment is not None else None
    rig_info = bind_meshes_to_canonical_armature(
        basemesh,
        garment,
        weight_mode="auto",
        extra_garments=extra,
        armature=armature,
    )
    arm = bpy.data.objects.get(rig_info["armatureName"])
    if arm is None:
        raise RuntimeError(f"armature missing after bind: {rig_info['armatureName']}")
    rig_info["rigCreated"] = rig_created

    deform = measure_pose_deformation(
        basemesh,
        garment,
        arm,
        bone_name=DRIVEN_BONE,
        rotation_deg=DRIVEN_ROTATION_DEG,
    )

    glb_path = out_dir / f"body_param_{body_class_id}.glb"
    export_objects = [arm, basemesh, garment]
    if lower_garment is not None:
        export_objects.append(lower_garment)
    # Export armature + skinned meshes with skins + morphs (face keys)
    export_objects_glb(
        export_objects,
        str(glb_path),
        export_skins=True,
        export_morph=True,
    )

    morph_names: list[str] = []
    if basemesh.data.shape_keys:
        morph_names = [
            kb.name
            for kb in basemesh.data.shape_keys.key_blocks
            if kb.name != "Basis"
        ]

    lower_info: dict = {
        "lowerGarmentMeshName": lower_mesh_name,
        "lowerGarmentTriangleEstimate": (
            sum(len(p.vertices) - 2 for p in lower_garment.data.polygons)
            if lower_garment is not None
            else 0
        ),
        "lowerGarmentVertexCount": (
            len(lower_garment.data.vertices) if lower_garment is not None else 0
        ),
        "lowerFitWallClockS": round(lower_fit_s, 4) if lower_garment is not None else None,
        "lowerGarmentFittedToBodyClass": body_class_id if lower_garment is not None else None,
        "outfitSteps": (
            ["fit_upper_garment", "fit_lower_garment_outfit"]
            if lower_garment is not None
            else ["fit_upper_garment"]
        ),
        # hm08 library basemesh has no painted lower-body region (paint is Anny-rail only).
        # When a lower mesh arrives, painted lower tris must stay 0 — muddy double forbidden.
        "lowerPaintTriangleCount": 0,
    }

    return {
        "bodyClassId": body_class_id,
        "phenotype": phenotype,
        "appliedMacro": applied,
        "macroBakedBeforeFit": False,
        "macroBakedAfterFit": True,
        "helperStrip": helper_strip,
        "faceShapeKeys": face_keys,
        "morphTargetCount": len(morph_names),
        "morphTargetNames": morph_names,
        "bodyLoadPath": "import_obj_base.obj_like_215",
        "glbPath": str(glb_path),
        "bodyMeshName": body_mesh_name,
        "bodyVertexCount": body_bounds["vertexCount"],
        "heightMeters": girth_post["heightMeters"],
        "torsoGirthProxyMeters": girth_post["torsoGirthProxyMeters"],
        "torsoGirthPreAlign": girth_pre,
        "torsoGirthPostAlign": girth_post,
        "bodyBounds": body_bounds,
        "garmentMeshName": garment_mesh_name,
        "garmentFittedToBodyClass": body_class_id,
        "garmentId": str(garment_spec.get("garmentId") or ""),
        "garmentKind": garment_kind,
        "garmentMhcloPath": use_mhclo if garment_kind == "library" else None,
        "garmentBandLowFraction": None if garment_kind == "library" else garment_band[0],
        "garmentBandHighFraction": None if garment_kind == "library" else garment_band[1],
        "garmentBounds": garment_bounds,
        "garmentVertexCount": len(garment.data.vertices),
        "garmentPolygonCount": len(garment.data.polygons),
        "garmentTriangleEstimate": sum(len(p.vertices) - 2 for p in garment.data.polygons),
        "clothesServiceApi": "ClothesService.fit_clothes_to_human",
        "fitWallClockS": round(fit_s, 4),
        "annyStatureAlign": align_info,
        "annyReferenceAsset": anny_ref_used,
        "annyObj": class_anny or None,
        # #329 — where this body class's macros came from: the case-authored
        # phenotype (with the height solved against MPFB's own body) or the legacy
        # hand-authored body-class literals. `macroDerivation` records which authored
        # key drove which macro, so bmi/build/gender_presentation are visible in the
        # report instead of dying at the materializer.
        "macroSource": macro_source,
        "macroDerivation": macro_derivation,
        "phenotypeSolve": phenotype_solve,
        "authoredPhenotype": authored_phenotype if isinstance(authored_phenotype, dict) else None,
        "rig": rig_info,
        "deformation": deform,
        "skinExport": True,
        "morphExport": True,
        "producedByStage": STAGE_ID,
        "coverageGate": coverage_gate,
        # issue-320 — how the upper hem met the lower waistband (band derivation for
        # cover shells, per-bucket push for fitted .mhclo garments).
        "waistMeet": coverage_gate.get("waistMeet"),
        "scalpHairRegion": scalp_hair_region,
        # #295 — per-garment hand-region trim counts (0 removed = no hand geometry).
        "garmentHandTrim": hand_trim,
        **lower_info,
    }


def _tag_mesh_materials(obj: bpy.types.Object, body_class_id: str, class_index: int) -> None:
    name_l = (obj.name + " " + (obj.data.name or "")).lower()
    if any(k in name_l for k in ("cargo", "pant", "trouser", "lower", "skirt", "short")):
        obj.data.materials.clear()
        obj.data.materials.append(
            make_material(f"lg_{body_class_id}", LOWER_GARMENT_COLORS[class_index % 2])
        )
    elif "scrub" in name_l or "garment" in name_l or "makeclothes" in name_l or "cloth" in name_l:
        obj.data.materials.clear()
        obj.data.materials.append(
            make_material(f"g_{body_class_id}", GARMENT_COLORS[class_index % 2])
        )
    else:
        obj.data.materials.clear()
        obj.data.materials.append(
            make_material(f"b_{body_class_id}", BODY_COLORS[class_index % 2])
        )


def render_grade_sheet(class_results: list[dict], grade_path: str, out_dir: Path) -> str:
    """Re-import exported GLBs side-by-side with distinct materials for pixel grade.

    Returns the render engine used. Prefer EEVEE so body vs garment colour is visible
    (#215 Workbench monochrome trap).
    """
    clear_scene()
    placed = []
    spacing = 1.1
    for i, cr in enumerate(class_results):
        glb = cr["glbPath"]
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=glb)
        created = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
        # Shift whole group (armatures + meshes)
        roots = [o for o in bpy.data.objects if o not in before]
        for obj in roots:
            obj.location.x += (i - 0.5 * (len(class_results) - 1)) * spacing
        for obj in created:
            _tag_mesh_materials(obj, cr["bodyClassId"], i)
            placed.append(obj)
        bpy.context.view_layer.update()

    # Frame camera on both
    if placed:
        # rough center height
        zs = []
        for obj in placed:
            b = world_bounds(obj)
            zs.extend([b["min"][2], b["max"][2]])
        mid_z = 0.5 * (min(zs) + max(zs)) if zs else 0.95
        setup_camera_front(target_z=mid_z, distance=3.6, center_x=0.0)
    else:
        setup_camera_front()
    return render_png(grade_path, res_x=1280, res_y=720)


def render_posed_deformation_grade(
    class_result: dict,
    grade_path: str,
) -> dict:
    """#216 — lit rest | posed side-by-side of one skinned body+garment.

    EEVEE so Principled Base Color is visible (Workbench ignores it — #215).
    Rest on the left, driven-bone pose on the right. Frame full figure + arms.
    """
    clear_scene()
    glb = class_result["glbPath"]
    spacing = 1.45

    def import_at_x(x_off: float, pose: bool) -> list[bpy.types.Object]:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=glb)
        created = [o for o in bpy.data.objects if o not in before]
        meshes = [o for o in created if o.type == "MESH"]
        arms = [o for o in created if o.type == "ARMATURE"]
        # Move only scene roots so armature children keep relative TRS
        roots = [o for o in created if o.parent is None or o.parent not in created]
        for obj in roots:
            obj.location.x += x_off
        for obj in meshes:
            _tag_mesh_materials(obj, class_result["bodyClassId"], 0)
        if pose and arms:
            arm = arms[0]
            bpy.context.view_layer.objects.active = arm
            bpy.ops.object.mode_set(mode="POSE")
            pb = arm.pose.bones.get(DRIVEN_BONE)
            if pb is not None:
                pb.rotation_mode = "XYZ"
                pb.rotation_euler = (math.radians(DRIVEN_ROTATION_DEG), 0.0, 0.0)
            bpy.context.view_layer.update()
            bpy.ops.object.mode_set(mode="OBJECT")
        bpy.context.view_layer.update()
        return meshes

    left = import_at_x(-spacing * 0.5, pose=False)
    right = import_at_x(spacing * 0.5, pose=True)
    placed = left + right
    if placed:
        zs: list[float] = []
        xs: list[float] = []
        for obj in placed:
            b = world_bounds(obj)
            zs.extend([b["min"][2], b["max"][2]])
            xs.extend([b["min"][0], b["max"][0]])
        zmin, zmax = min(zs), max(zs)
        # Aim slightly above mid-height so arms/shoulders dominate the frame
        mid_z = zmin + 0.58 * (zmax - zmin)
        stature = max(zmax - zmin, 0.5)
        dist = max(3.2, stature * 2.4)
        setup_camera_front(target_z=mid_z, distance=dist, center_x=0.0)
        # Slightly wider FOV so both full figures fit
        if bpy.context.scene.camera and bpy.context.scene.camera.data:
            try:
                bpy.context.scene.camera.data.lens = 35.0
            except Exception:
                pass
    else:
        setup_camera_front()
    engine = render_png(grade_path, res_x=1400, res_y=780)
    return {
        "gradePng": grade_path,
        "gradeRenderEngine": engine,
        "drivenBone": DRIVEN_BONE,
        "rotationDegrees": DRIVEN_ROTATION_DEG,
        "bodyClassId": class_result["bodyClassId"],
        "visualChecklistSlots": {
            "limb_moved": "ungraded",
            "garment_followed": "ungraded",
            "no_torn_geometry": "ungraded",
            "materials_distinct": "ungraded",
        },
        "note": "orchestrator fills yes|no from posed-deformation-grade.png (EEVEE lit)",
    }


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    grade_path = args.out_grade_png or str(out_dir / "body-classes-grade.png")
    posed_grade_path = args.out_posed_grade_png or str(out_dir / "posed-deformation-grade.png")

    body_classes = json.loads(Path(args.body_classes_json).read_text(encoding="utf-8"))
    if not isinstance(body_classes, list) or len(body_classes) < 2:
        raise SystemExit("body-classes-json must be a list of at least two body class objects")

    report: dict = {
        "schemaVersion": "openclinxr.body-param-stage.v1",
        "producedByStage": STAGE_ID,
        "notEvidenceFor": NOT_EVIDENCE_FOR,
        "mpfb": {},
        "bodyClasses": [],
        "calibration": {},
        "deformationCalibration": {},
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
        from bl_ext.user_default.mpfb.services.objectservice import ObjectService
    except Exception as exc:  # noqa: BLE001
        report["status"] = "mpfb_import_failed"
        report["errors"].append(f"{type(exc).__name__}: {exc}")
        report["traceback"] = traceback.format_exc()[-2000:]
        write_report(args.report, report)
        print(json.dumps(report))
        return

    class_results: list[dict] = []
    try:
        for i, bc in enumerate(body_classes):
            cr = build_one_body_class(
                body_class=bc,
                class_index=i,
                mhclo_path=args.mhclo,
                garment_obj_path=args.garment_obj,
                mh_base_obj=args.mh_base_obj,
                out_dir=out_dir,
                garment_prefix=args.garment_mesh_name_prefix,
                body_prefix=args.body_mesh_name_prefix,
                anny_obj=args.anny_obj,
                ClothesService=ClothesService,
                Mhclo=Mhclo,
                ObjectService=ObjectService,
                GeneralObjectProperties=GeneralObjectProperties,
                lower_mhclo_path=str(args.lower_mhclo or ""),
                lower_garment_obj_path=str(args.lower_garment_obj or ""),
                lower_garment_prefix=str(
                    args.lower_garment_mesh_name_prefix or "makeclothes_library_cargo_pants"
                ),
            )
            class_results.append(cr)
            report["bodyClasses"].append(cr)
            write_report(args.report, report)

        # Calibration from the two real exports (post-align meters)
        girths = [c["torsoGirthProxyMeters"] for c in class_results]
        spread = max(girths) - min(girths)
        # Epsilon = half the observed spread, floored so a true zero-spread fails and a real
        # weight delta clears with margin. Recorded before any threshold tuning.
        eps = max(spread * 0.35, 0.01) if spread > 0 else 0.01
        report["calibration"] = {
            "bandLowFraction": 0.45,
            "bandHighFraction": 0.60,
            "girthEpsilonMeters": round(eps, 5),
            "observedGirthSpreadMeters": round(spread, 5),
            "observedGirths": [round(g, 5) for g in girths],
            "source": "calibrated_from_two_real_exports_this_run",
        }

        # #216 deformation calibration — take the min epsilon across classes (strictest)
        deform_rows = [c.get("deformation") or {} for c in class_results]
        tip_medians = [
            float(d["medianBoneTipMotionMeters"])
            for d in deform_rows
            if isinstance(d.get("medianBoneTipMotionMeters"), (int, float))
        ]
        if tip_medians:
            # half of median tip motion, per class then take min so both must clear
            class_eps = [0.5 * m for m in tip_medians]
            def_eps = min(class_eps) if class_eps else 0.0
            report["deformationCalibration"] = {
                "drivenBone": DRIVEN_BONE,
                "rotationDegrees": DRIVEN_ROTATION_DEG,
                "deformationEpsilonMeters": round(def_eps, 5),
                "perClassMedianBoneTipMotionMeters": [round(m, 5) for m in tip_medians],
                "perClassBodyDeformationMeters": [
                    float((d or {}).get("bodyDeformationMeters") or 0) for d in deform_rows
                ],
                "perClassGarmentDeformationMeters": [
                    float((d or {}).get("garmentDeformationMeters") or 0) for d in deform_rows
                ],
                "source": "calibrated_half_median_bone_tip_motion_this_export",
            }
        else:
            report["deformationCalibration"] = {
                "drivenBone": DRIVEN_BONE,
                "rotationDegrees": DRIVEN_ROTATION_DEG,
                "deformationEpsilonMeters": 0.0,
                "source": "calibrated_half_median_bone_tip_motion_this_export_no_tips",
            }

        grade_engine = render_grade_sheet(class_results, grade_path, out_dir)
        posed_meta = render_posed_deformation_grade(class_results[0], posed_grade_path)
        report["artifacts"] = {
            "gradePng": grade_path,
            "gradeRenderEngine": grade_engine,
            "posedDeformationGradePng": posed_grade_path,
            "posedDeformationGrade": posed_meta,
            "glbs": [c["glbPath"] for c in class_results],
        }
        report["status"] = "completed"
        report["totalWallClockS"] = round(time.perf_counter() - t0, 3)
        write_report(args.report, report)
        print(
            json.dumps(
                {
                    "status": "completed",
                    "report": args.report,
                    "bodyClassCount": len(class_results),
                    "girthSpread": report["calibration"]["observedGirthSpreadMeters"],
                    "deformationEpsilon": report["deformationCalibration"].get(
                        "deformationEpsilonMeters"
                    ),
                    "gradePng": grade_path,
                    "posedGradePng": posed_grade_path,
                }
            )
        )
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
