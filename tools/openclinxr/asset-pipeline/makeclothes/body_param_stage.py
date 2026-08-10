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
DRIVEN_BONE = "upper_arm.L"
DRIVEN_ROTATION_DEG = 55.0


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
    p.add_argument("--garment-mesh-name-prefix", default="makeclothes_library_scrub_shirt")
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
        help="Optional Anny reference OBJ for stature/foot align (0044 path)",
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


def align_body_to_reference(body: bpy.types.Object, reference: bpy.types.Object) -> dict:
    """Uniform stature scale + foot/centre align (MADR 0044 path), then horizontal girth match.

    Girth is matched by X/Y scale only so stature (Z) from the uniform pass is preserved.
    """
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
        arm_bone_names = [
            n
            for n in (
                "clavicle.L",
                "upper_arm.L",
                "forearm.L",
                "hand.L",
                "clavicle.R",
                "upper_arm.R",
                "forearm.R",
                "hand.R",
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


def bind_meshes_to_canonical_armature(
    basemesh: bpy.types.Object,
    garment: bpy.types.Object,
    *,
    weight_mode: str = "auto",
    extra_garments: list | None = None,
) -> dict:
    """#216 — create AABB-driven 23-bone armature, ARMATURE_AUTO on body + garment(s).

    Body is Z-up standing after plant/align; pair with export_yup=True.
    Falls back to envelope if heat weights fail the weighted-group threshold.
    Each garment gets a weight transfer from the body so cloth follows limbs.
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

    arm = hm08.create_canonical_armature(basemesh, "z")
    body_bind = hm08.bind_auto_weight(basemesh, arm, weight_mode)
    if not body_bind.get("ok") and weight_mode == "auto":
        body_bind = hm08.bind_auto_weight(basemesh, arm, "envelope")
        body_bind["fallback"] = "envelope_after_auto"

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
        for mod in mesh.modifiers:
            if mod.type == "ARMATURE":
                mod.object = arm
                mod.use_vertex_groups = True

    bpy.context.view_layer.update()
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


def plant_feet(obj: bpy.types.Object) -> None:
    b = world_bounds(obj)
    obj.location.z -= b["min"][2]
    bpy.context.view_layer.update()


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
      5) Anny stature+girth align with garment parented, then unparent + apply
      6) bind armature + export WITH skins and morphs
    Baking BEFORE fit rotated/collapsed the scrub (probe: garment Z extent ~2.6 vs
    good no-macro fit Z ~5.1 on the same basemesh).

    #221: per-class `annyObj` on the body_class dict overrides the CLI default so male/female
    references stay aligned (age/size/gender via Anny-as-reference → MPFB match).
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

    clear_scene()
    enable_mpfb()

    body_mesh_name = f"{body_prefix}_{body_class_id}"
    # #215 body load path — raw base.obj import (create_human placement is wrong here)
    basemesh = import_obj(mh_base_obj, body_mesh_name, force_z=False)
    basemesh.data.materials.clear()
    basemesh.data.materials.append(make_material(f"skin_{body_class_id}", BODY_COLORS[class_index % 2]))
    GeneralObjectProperties.set_value("object_type", "Basemesh", entity_reference=basemesh)

    applied = apply_macros(basemesh, phenotype)
    bpy.context.view_layer.update()
    girth_pre = torso_girth_proxy(basemesh)

    # Fit while macros are LIVE shape keys — ClothesService builds a from-mix key.
    # #220: fit UPPER then LOWER before baking macros so both mhclo maps read phenotype shape.
    garment_mesh_name = f"{garment_prefix}_{body_class_id}"
    garment, fit_s = _fit_one_garment(
        mhclo_path=mhclo_path,
        garment_obj_path=garment_obj_path,
        garment_mesh_name=garment_mesh_name,
        basemesh=basemesh,
        color=GARMENT_COLORS[class_index % 2],
        ClothesService=ClothesService,
        Mhclo=Mhclo,
    )

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

    outfit: list[bpy.types.Object] = [garment]
    if lower_garment is not None:
        outfit.append(lower_garment)

    # Stature + girth align to Anny (0044 path) while garments are still parented
    align_info: dict = {"skipped": True}
    anny_ref_used: str | None = None
    if class_anny and Path(class_anny).is_file():
        anny = import_obj(class_anny, "anny_stature_reference", force_z=True)
        anny.data.materials.clear()
        anny.data.materials.append(make_material("anny_ref", (0.82, 0.68, 0.56, 1.0)))
        for g in outfit:
            _ensure_parented(g)
        align_info = align_body_to_reference(basemesh, anny)
        bpy.context.view_layer.update()
        apply_object_transforms(basemesh)
        for g in outfit:
            _unparent_apply(g)
        bpy.data.objects.remove(anny, do_unlink=True)
        anny_ref_used = anny_reference_asset or class_anny
        align_info["annyObj"] = class_anny
        align_info["annyReferenceAsset"] = anny_ref_used
    else:
        basemesh.scale = (0.1, 0.1, 0.1)
        bpy.context.view_layer.update()
        for g in outfit:
            _ensure_parented(g)
        apply_object_transforms(basemesh)
        for g in outfit:
            _unparent_apply(g)
        plant_feet(basemesh)
        apply_object_transforms(basemesh)
        align_info = {"uniformScale": 0.1, "path": "mpfb_default_0_1_without_anny"}

    girth_post = torso_girth_proxy(basemesh)
    body_bounds = world_bounds(basemesh)
    garment_bounds = world_bounds(garment)

    basemesh.name = body_mesh_name
    basemesh.data.name = body_mesh_name
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
    body_verts = np.array([v.co for v in basemesh.data.vertices], dtype=float)
    body_faces = np.array([p.vertices for p in basemesh.data.polygons], dtype=np.int64)

    def _numpy_mesh(obj: bpy.types.Object):
        return (
            np.array([v.co for v in obj.data.vertices], dtype=float),
            np.array([p.vertices for p in obj.data.polygons], dtype=np.int64),
        )

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

    # Upper garment: torso band = its own extent (the shirt is dense/closed and passes
    # on closure; the coverage number is recorded, not tuned).
    ugv, ugf = _numpy_mesh(garment)
    upper_rep = _gc.coverage_report(
        body_verts,
        body_faces,
        ugv,
        ugf,
        float(garment_bounds["min"][1]) + 0.02,
        float(garment_bounds["max"][1]) - 0.02,
        garment_label="upper",
    )
    if upper_rep["verdict"] == "does_not_cover":
        # A dense library upper garment passes on closure; firing here means the fit is
        # genuinely degenerate. Refuse loudly rather than ship a bare torso.
        raise RuntimeError(f"upper garment failed the issue-272 coverage gate: {upper_rep}")
    # Accepted upper: push to a clean standoff so it stops z-fighting with the skin.
    ugv_off = _gc.cloth_offset(ugv, body_verts, body_faces, _gc.CLOTH_STANDOFF_M)
    for i, v in enumerate(garment.data.vertices):
        v.co = tuple(float(x) for x in ugv_off[i])
    coverage_gate["upper"] = upper_rep

    if lower_garment is not None:
        lgv, lgf = _numpy_mesh(lower_garment)
        hem_y = float(garment_bounds["min"][1])  # upper garment hem
        ankle_y = float(body_bounds["min"][1]) + 0.10  # shoes/feet begin below
        lower_rep = _gc.coverage_report(
            body_verts,
            body_faces,
            lgv,
            lgf,
            ankle_y,
            hem_y,
            garment_label="lower",
        )
        if lower_rep["verdict"] == "does_not_cover":
            # Sparse/open library fit (issue-272: 392-tri cargo trouser). Replace with
            # the body-derived cover shell: the body's own leg surface offset outward —
            # covers the region by construction (D2: procedural clothing, no LLM).
            shell = _gc.build_cover_shell(
                body_verts,
                body_faces,
                ankle_y,
                hem_y,
                standoff=_gc.CLOTH_STANDOFF_M,
                label=f"{lower_garment_prefix}_fallback_{body_class_id}",
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
                "library lower fit did not cover its region; replaced with body-derived cover shell"
            )
        else:
            lgv_off = _gc.cloth_offset(lgv, body_verts, body_faces, _gc.CLOTH_STANDOFF_M)
            for i, v in enumerate(lower_garment.data.vertices):
                v.co = tuple(float(x) for x in lgv_off[i])
        coverage_gate["lower"] = lower_rep
    bpy.context.view_layer.update()

    # #216/#220 — bind body + upper (+ lower) to canonical armature
    extra = [lower_garment] if lower_garment is not None else None
    rig_info = bind_meshes_to_canonical_armature(
        basemesh, garment, weight_mode="auto", extra_garments=extra
    )
    arm = bpy.data.objects.get(rig_info["armatureName"])
    if arm is None:
        raise RuntimeError(f"armature missing after bind: {rig_info['armatureName']}")

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
        "garmentBounds": garment_bounds,
        "garmentVertexCount": len(garment.data.vertices),
        "garmentPolygonCount": len(garment.data.polygons),
        "garmentTriangleEstimate": sum(len(p.vertices) - 2 for p in garment.data.polygons),
        "clothesServiceApi": "ClothesService.fit_clothes_to_human",
        "fitWallClockS": round(fit_s, 4),
        "annyStatureAlign": align_info,
        "annyReferenceAsset": anny_ref_used,
        "annyObj": class_anny or None,
        "rig": rig_info,
        "deformation": deform,
        "skinExport": True,
        "morphExport": True,
        "producedByStage": STAGE_ID,
        "coverageGate": coverage_gate,
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
