from __future__ import annotations

try:
    import bpy
    from mathutils import Vector
except ImportError:
    bpy = None
    Vector = None
import numpy as np

import importlib.util
import json
import traceback
from pathlib import Path

from constants import MH_UNITS_TO_METRES
from paths import TOOLS_OPENCLINXR


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
    # hm08 stage lives at tools/openclinxr/evidence/blender/ (not vendored into this package).
    rig_path = TOOLS_OPENCLINXR / "evidence" / "blender" / "hm08_rig_carry_stage.py"
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

