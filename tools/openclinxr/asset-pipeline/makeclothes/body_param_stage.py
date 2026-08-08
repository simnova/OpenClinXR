#!/usr/bin/env python3
"""#151 body_param factory stage — MPFB macro phenotype reaches vertices.

Extends the #215 fit-stage shape: load hm08 basemesh, apply MPFB macro modifiers
(weight / gender from phenotype), fit one CC-BY .mhclo via ClothesService per body
class, export library GLBs + a two-class grade PNG + stage report.

NOT create_human placement path as the sole entry: we use ObjectService.load_base_mesh
+ HumanObjectProperties + TargetService.reapply_macro_details (headless-stable, measured
in issue-151 macro probe). ClothesService.fit_clothes_to_human already evaluates the
post-macro mix shape key.

claimScope: factory body_param station — two body classes, phenotype in vertices,
per-class fitted garment library keys.
notEvidenceFor: clinical body realism, Quest readiness, converting shipped Anny roles,
shipping GPL MPFB, full Anny→hm08 migration, armature rebind completeness.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
import traceback
from pathlib import Path

import bpy
from mathutils import Vector


STAGE_ID = "body_param_stage"
NOT_EVIDENCE_FOR = [
    "clinical_body_realism",
    "quest_readiness",
    "learner_readiness",
    "converting_shipped_anny_roles",
    "shipping_mpfb_or_gpl_code_in_repo",
    "full_anny_to_hm08_migration",
    "armature_rebind_completeness",
]


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
    p.add_argument("--out-grade-png", default="", help="Optional override for grade PNG path")
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
        export_morph=False,
    )


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
    0: (0.08, 0.52, 0.95, 1.0),  # vivid blue
    1: (0.10, 0.62, 0.28, 1.0),  # vivid green
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
) -> dict:
    """Build one body class.

    Order measured in issue-151 fit-orient probe:
      1) load base.obj exactly as #215 (import_obj, NOT create_human)
      2) set Basemesh tag + apply macros as live shape keys
      3) ClothesService.fit while shape keys are LIVE (fit reads a from-mix key)
      4) bake_targets so export does not drop the macro deformation
      5) Anny stature align / 0.1 scale with garment parented, then unparent + apply
    Baking BEFORE fit rotated/collapsed the scrub (probe: garment Z extent ~2.6 vs
    good no-macro fit Z ~5.1 on the same basemesh).
    """
    from bl_ext.user_default.mpfb.services.targetservice import TargetService

    body_class_id = str(body_class["bodyClassId"])
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

    # Fit while macros are LIVE shape keys — ClothesService builds a from-mix key
    garment_mesh_name = f"{garment_prefix}_{body_class_id}"
    garment = import_obj(garment_obj_path, garment_mesh_name, force_z=False)
    garment.data.materials.clear()
    garment.data.materials.append(
        make_material(f"garment_{body_class_id}", GARMENT_COLORS[class_index % 2])
    )

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

    # Bake macros into body vertices AFTER fit (export_morph=False would otherwise drop them)
    TargetService.bake_targets(basemesh)
    bpy.context.view_layer.update()

    # Strip helper geometry after fit so grade shows body + scrub, not the MH helper "dress"
    helper_strip = strip_helper_geometry(basemesh)
    bpy.context.view_layer.update()

    # Stature align to Anny (same as #215) while garment is still parented
    align_info: dict = {"skipped": True}
    if anny_obj and Path(anny_obj).is_file():
        anny = import_obj(anny_obj, "anny_stature_reference", force_z=True)
        anny.data.materials.clear()
        anny.data.materials.append(make_material("anny_ref", (0.82, 0.68, 0.56, 1.0)))
        if garment.parent is not basemesh:
            garment.parent = basemesh
            garment.matrix_parent_inverse = basemesh.matrix_world.inverted()
        align_info = align_body_to_reference(basemesh, anny)
        bpy.context.view_layer.update()
        mw_g = garment.matrix_world.copy()
        garment.parent = None
        garment.matrix_world = mw_g
        apply_object_transforms(basemesh)
        apply_object_transforms(garment)
        bpy.data.objects.remove(anny, do_unlink=True)
    else:
        basemesh.scale = (0.1, 0.1, 0.1)
        bpy.context.view_layer.update()
        if garment.parent is not basemesh:
            garment.parent = basemesh
            garment.matrix_parent_inverse = basemesh.matrix_world.inverted()
        apply_object_transforms(basemesh)
        mw_g = garment.matrix_world.copy()
        garment.parent = None
        garment.matrix_world = mw_g
        apply_object_transforms(garment)
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

    glb_path = out_dir / f"body_param_{body_class_id}.glb"
    export_objects_glb([basemesh, garment], str(glb_path))

    return {
        "bodyClassId": body_class_id,
        "phenotype": phenotype,
        "appliedMacro": applied,
        "macroBakedBeforeFit": False,
        "macroBakedAfterFit": True,
        "helperStrip": helper_strip,
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
        "producedByStage": STAGE_ID,
    }


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
        # Shift whole group
        for obj in created:
            obj.location.x += (i - 0.5 * (len(class_results) - 1)) * spacing
            # Reinforce distinct materials by mesh name (export may keep Scrub_Shirt / base)
            name_l = (obj.name + " " + (obj.data.name or "")).lower()
            if "scrub" in name_l or "garment" in name_l or "makeclothes" in name_l or "cloth" in name_l:
                obj.data.materials.clear()
                obj.data.materials.append(
                    make_material(f"g_{cr['bodyClassId']}", GARMENT_COLORS[i % 2])
                )
            else:
                obj.data.materials.clear()
                obj.data.materials.append(
                    make_material(f"b_{cr['bodyClassId']}", BODY_COLORS[i % 2])
                )
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


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    grade_path = args.out_grade_png or str(out_dir / "body-classes-grade.png")

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

        grade_engine = render_grade_sheet(class_results, grade_path, out_dir)
        report["artifacts"] = {
            "gradePng": grade_path,
            "gradeRenderEngine": grade_engine,
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
                    "gradePng": grade_path,
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
