#!/usr/bin/env python3
"""#131 MakeClothes + Anny-reference cagematch stage (out-of-repo MPFB authoring only).

Produces aligned body meshes, a real MakeClothes garment fit on the MH body,
an optional proximity/normal-offset transfer onto the Anny mesh, and PNG renders.
All geometry claims for the TS probe must be re-measured from the exported glTFs
via NodeIO — do not trust Blender-side vertex counts alone for the final report.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import traceback
from pathlib import Path

import bpy
from mathutils import Vector, kdtree


NOT_EVIDENCE_FOR = [
    "clinical_appropriateness",
    "production_asset_readiness",
    "quest_readiness",
    "learner_readiness",
    "b_plus_visual_realism_gate",
    "adoption_into_orchestrate_character",
    "shipping_mpfb_or_gpl_code_in_repo",
]


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--anny-obj", required=True)
    p.add_argument("--mhclo", required=True)
    p.add_argument("--garment-obj", required=True)
    p.add_argument("--mh-base-obj", required=True, help="MPFB data/3dobjs/base.obj (hm08)")
    p.add_argument("--out-dir", required=True)
    p.add_argument("--report", required=True)
    return p.parse_args(args)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def enable_mpfb() -> dict:
    status: dict = {
        "module": "bl_ext.user_default.mpfb",
        "enabled": False,
        "error": None,
        "version": None,
        "blenderVersionMin": None,
        "licenseSpdxFromManifest": None,
        "manifestPath": None,
    }
    try:
        bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
        status["enabled"] = "bl_ext.user_default.mpfb" in bpy.context.preferences.addons
        # Prefer extension package metadata when available.
        try:
            from bl_ext.user_default import mpfb as mpfb_mod  # type: ignore

            bl_info = getattr(mpfb_mod, "bl_info", {}) or {}
            status["version"] = list(bl_info.get("version", ()))
        except Exception as exc:  # noqa: BLE001
            status["versionError"] = f"{type(exc).__name__}: {exc}"

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
                    status["licenseSpdxFromManifest"] = line.strip().strip(",").strip('"').replace(
                        "SPDX:", ""
                    )
                if "blender_version_min" in line:
                    status["blenderVersionMin"] = line.split("=", 1)[-1].strip().strip('"')
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
    b = world_bounds(obj)
    # Standing height is the largest axis extent for these bases.
    return max(b["size"])


def align_body_to_reference(body: bpy.types.Object, reference: bpy.types.Object) -> dict:
    """Uniform-scale + translate body so stature and foot/center match reference."""
    ref_b = world_bounds(reference)
    body_b = world_bounds(body)
    ref_stature = max(ref_b["size"])
    body_stature = max(body_b["size"])
    scale = ref_stature / body_stature if body_stature > 1e-8 else 1.0
    body.scale = (scale, scale, scale)
    bpy.context.view_layer.update()

    # After scale, put feet on reference min-Z (Blender Z-up for MPFB humans)
    # and center X/Y on reference.
    body_b2 = world_bounds(body)
    ref_min = ref_b["min"]
    ref_max = ref_b["max"]
    body_min = body_b2["min"]
    body_max = body_b2["max"]
    ref_cx = 0.5 * (ref_min[0] + ref_max[0])
    ref_cy = 0.5 * (ref_min[1] + ref_max[1])
    body_cx = 0.5 * (body_min[0] + body_max[0])
    body_cy = 0.5 * (body_min[1] + body_max[1])
    # Feet: min Z
    dz = ref_min[2] - body_min[2]
    body.location.x += ref_cx - body_cx
    body.location.y += ref_cy - body_cy
    body.location.z += dz
    bpy.context.view_layer.update()
    return {
        "uniformScale": scale,
        "referenceStatureMeters": ref_stature,
        "bodyStatureBeforeScaleMeters": body_stature,
        "bodyStatureAfterScaleMeters": stature_meters(body),
    }


def apply_object_transforms(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.update()


def force_z_up_standing(obj: bpy.types.Object) -> dict:
    """Rotate mesh so the longest AABB axis becomes +Z (Blender standing), feet at min Z.

    Anny OBJ files are Y-up; MPFB create_human is already Z-up. Export uses export_yup=True
    so final glTF has height on +Y.
    """
    apply_object_transforms(obj)
    b = world_bounds(obj)
    size = b["size"]
    # axis index of stature
    axis = max(range(3), key=lambda i: size[i])
    # Map current stature axis onto +Z via object rotation, then apply.
    if axis == 2:
        # already Z
        pass
    elif axis == 1:
        # Y-up → rotate +90° about X so Y→Z
        obj.rotation_euler[0] = math.radians(90.0)
    else:
        # X-up → rotate -90° about Y so X→Z
        obj.rotation_euler[1] = math.radians(-90.0)
    bpy.context.view_layer.update()
    apply_object_transforms(obj)

    # If stature is inverted (head below feet), flip 180 about X
    b2 = world_bounds(obj)
    # Heuristic: for humanoids, wider in X than Y after Z-up; head is the smaller end
    # of the depth axis. Prefer minZ as feet: if the mesh has more volume at high Z, OK.
    # Simpler: if maxZ < 0, translate; if the bulk is negative Z, rotate 180 X.
    if abs(b2["min"][2]) > abs(b2["max"][2]) and b2["min"][2] < -0.1:
        obj.rotation_euler[0] = math.radians(180.0)
        bpy.context.view_layer.update()
        apply_object_transforms(obj)
        b2 = world_bounds(obj)

    # Feet on Z=0
    obj.location.z -= world_bounds(obj)["min"][2]
    bpy.context.view_layer.update()
    apply_object_transforms(obj)
    return {"statureAxisBefore": axis, "boundsAfter": world_bounds(obj)}


def import_obj(path: str, name: str) -> bpy.types.Object:
    before = set(bpy.data.objects)
    # Blender 4+/5: wm.obj_import
    bpy.ops.wm.obj_import(filepath=path)
    created = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if not created:
        raise RuntimeError(f"OBJ import produced no mesh: {path}")
    obj = created[0]
    obj.name = name
    force_z_up_standing(obj)
    return obj


def make_material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    principled = mat.node_tree.nodes["Principled BSDF"]
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = 0.65
    return mat


def export_glb(obj: bpy.types.Object, path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
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


def build_kdtree(obj: bpy.types.Object):
    size = len(obj.data.vertices)
    tree = kdtree.KDTree(size)
    for i, v in enumerate(obj.data.vertices):
        tree.insert(obj.matrix_world @ v.co, i)
    tree.balance()
    return tree


# bpy.types.Object does not accept arbitrary Python attrs — keep trees off-object.
_KDTREE_CACHE: dict[str, object] = {}


def nearest_surface_point(obj: bpy.types.Object, world_point: Vector) -> tuple[Vector, Vector]:
    """Approximate surface point + outward normal via nearest vertex + its normal."""
    key = obj.name
    tree = _KDTREE_CACHE.get(key)
    if tree is None:
        tree = build_kdtree(obj)
        _KDTREE_CACHE[key] = tree
    _co, index, _dist = tree.find(world_point)  # type: ignore[union-attr]
    v = obj.data.vertices[index]
    world_co = obj.matrix_world @ v.co
    normal = (obj.matrix_world.to_3x3() @ v.normal).normalized()
    return world_co, normal


def transfer_garment_to_target(
    garment: bpy.types.Object,
    source_body: bpy.types.Object,
    target_body: bpy.types.Object,
) -> dict:
    """Proximity/normal-offset transfer: keep cloth offset along source surface normal on target.

    For each garment vertex:
      p_src, n_src = nearest on source body
      offset = (garment_world - p_src) projected onto n_src (scalar)
      p_tgt, n_tgt = nearest on target body to p_src (same spatial locus after alignment)
      new = p_tgt + n_tgt * offset
    """
    _KDTREE_CACHE[source_body.name] = build_kdtree(source_body)
    _KDTREE_CACHE[target_body.name] = build_kdtree(target_body)

    mw = garment.matrix_world.copy()
    imw = mw.inverted()
    offsets: list[float] = []
    bpy.ops.object.select_all(action="DESELECT")
    garment.select_set(True)
    bpy.context.view_layer.objects.active = garment
    bpy.ops.object.mode_set(mode="OBJECT")

    mesh = garment.data
    for v in mesh.vertices:
        g_world = mw @ v.co
        p_src, n_src = nearest_surface_point(source_body, g_world)
        delta = g_world - p_src
        offset = delta.dot(n_src)
        offsets.append(offset)
        # Map via spatial nearest of source contact point onto target body
        p_tgt, n_tgt = nearest_surface_point(target_body, p_src)
        new_world = p_tgt + n_tgt * offset
        v.co = imw @ new_world

    mesh.update()
    bpy.context.view_layer.update()
    if offsets:
        mean_off = sum(offsets) / len(offsets)
        max_off = max(abs(o) for o in offsets)
    else:
        mean_off = 0.0
        max_off = 0.0
    return {
        "method": "proximity_normal_offset_transfer",
        "garmentVertexCount": len(offsets),
        "meanSourceOffsetMeters": mean_off,
        "maxAbsSourceOffsetMeters": max_off,
    }


def setup_camera_front(target_z: float = 0.95, distance: float = 2.6) -> None:
    cam_data = bpy.data.cameras.new("ocxr_front_cam")
    cam = bpy.data.objects.new("ocxr_front_cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (0.0, -distance, target_z)
    cam.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    cam_data.lens = 50
    bpy.context.scene.camera = cam
    light_data = bpy.data.lights.new(name="ocxr_key", type="AREA")
    light_data.energy = 250
    light = bpy.data.objects.new("ocxr_key", light_data)
    bpy.context.scene.collection.objects.link(light)
    light.location = (1.2, -1.5, 2.0)


def render_png(path: str, res: int = 768) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT" if hasattr(bpy.types, "BLENDER_EEVEE_NEXT") else "BLENDER_WORKBENCH"
    # Prefer workbench for reliability headless
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.render.filepath = path
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)


def set_visibility(objects: list[bpy.types.Object], visible: bool) -> None:
    for obj in objects:
        obj.hide_render = not visible
        obj.hide_viewport = not visible


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    report: dict = {
        "schemaVersion": "openclinxr.makeclothes-anny-reference-blender-stage.v1",
        "notEvidenceFor": NOT_EVIDENCE_FOR,
        "mpfb": {},
        "steps": {},
        "artifacts": {},
        "errors": [],
    }
    t0 = time.perf_counter()
    clear_scene()
    mpfb = enable_mpfb()
    report["mpfb"] = mpfb
    # Checkpoint early so a later failure still records load status + SPDX.
    Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    if not mpfb.get("enabled"):
        report["status"] = "mpfb_load_failed"
        report["totalWallClockS"] = round(time.perf_counter() - t0, 3)
        Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
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
        Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report))
        return

    # 1) Anny reference — force Z-up standing in Blender meters
    anny = import_obj(args.anny_obj, "anny_reference_body")
    anny.data.materials.clear()
    anny.data.materials.append(make_material("anny_ref_skin", (0.82, 0.68, 0.56, 1.0)))
    report["steps"]["annyImport"] = {
        "path": args.anny_obj,
        "bounds": world_bounds(anny),
        "statureMeters": stature_meters(anny),
    }

    # 2) MH basemesh from MPFB base.obj (hm08). Do NOT use create_human for fit:
    # ClothesService + community .mhclo are authored against base.obj rest topology/units.
    # create_human is meter-scaled and yields a wrong world-space fit for the same .mhclo
    # (measured: garment collapsed off-body). #90 path = base.obj import + tag Basemesh.
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=args.mh_base_obj)
    mh = next((o for o in bpy.data.objects if o not in before and o.type == "MESH"), None)
    if mh is None:
        raise RuntimeError(f"MH base.obj import failed: {args.mh_base_obj}")
    mh.name = "mh_body_matched"
    mh.data.materials.clear()
    mh.data.materials.append(make_material("mh_skin", (0.55, 0.62, 0.78, 1.0)))
    GeneralObjectProperties.set_value("object_type", "Basemesh", entity_reference=mh)
    # base.obj is Z-up already in MH units (~16.9 stature). Do not rewrite verts before fit.
    report["steps"]["mhCreate"] = {
        "source": "mpfb_data_3dobjs_base.obj",
        "path": args.mh_base_obj,
        "boundsBeforeAlign": world_bounds(mh),
        "statureBeforeAlignMeters": stature_meters(mh),
        "objectIsBasemesh": bool(ObjectService.object_is_basemesh(mh)),
        "vertexCount": len(mh.data.vertices),
    }

    # 3) Fit real MakeClothes garment on native-unit basemesh
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=args.garment_obj)
    garment = next((o for o in bpy.data.objects if o not in before and o.type == "MESH"), None)
    if garment is None:
        raise RuntimeError("garment OBJ import failed")
    garment.name = "makeclothes_scrub_shirt"
    garment.data.materials.clear()
    garment.data.materials.append(make_material("scrub_teal", (0.12, 0.48, 0.52, 1.0)))

    mhclo = Mhclo()
    mhclo.load(args.mhclo)
    try:
        mhclo.clothes = garment
    except Exception:
        pass

    t_fit = time.perf_counter()
    ClothesService.fit_clothes_to_human(garment, mh, mhclo=mhclo, set_parent=True)
    fit_s = time.perf_counter() - t_fit
    report["steps"]["garmentFit"] = {
        "wallClockS": round(fit_s, 4),
        "garmentBounds": world_bounds(garment),
        "garmentVertexCount": len(garment.data.vertices),
        "garmentPolygonCount": len(garment.data.polygons),
        "garmentTriangleEstimate": sum(len(p.vertices) - 2 for p in garment.data.polygons),
        "mhclo": args.mhclo,
        "garmentObj": args.garment_obj,
        "licenseHeaderHint": "read by TS probe from mhclo",
        "fittedOnNativeBaseObj": True,
    }

    # Snapshot pre-align fit (native MH units) for evidence.
    garment_on_mh_native = str(out_dir / "garment-on-mh-native-scale.glb")
    export_objects_glb([mh, garment], garment_on_mh_native)
    report["artifacts"]["garmentOnMhNativeScaleGlb"] = garment_on_mh_native

    # 4) Parent garment to MH, uniform-scale+translate MH unit to match anny meters.
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
    report["steps"]["align"] = align
    report["steps"]["mhAfterAlign"] = {
        "bounds": world_bounds(mh),
        "statureMeters": stature_meters(mh),
    }
    report["steps"]["garmentAfterAlign"] = {
        "bounds": world_bounds(garment),
        "statureSpanMeters": stature_meters(garment),
    }

    # Export aligned bodies for NodeIO measurement (export_yup → glTF +Y height)
    anny_glb = str(out_dir / "aligned-anny-body.glb")
    mh_glb = str(out_dir / "aligned-mh-body.glb")
    export_glb(anny, anny_glb)
    export_glb(mh, mh_glb)
    report["artifacts"]["alignedAnnyGlb"] = anny_glb
    report["artifacts"]["alignedMhGlb"] = mh_glb

    garment_on_mh_glb = str(out_dir / "garment-on-mh.glb")
    export_objects_glb([mh, garment], garment_on_mh_glb)
    garment_only_glb = str(out_dir / "garment-only-on-mh.glb")
    export_glb(garment, garment_only_glb)
    report["artifacts"]["garmentOnMhGlb"] = garment_on_mh_glb
    report["artifacts"]["garmentOnlyOnMhGlb"] = garment_only_glb

    # 5) Transfer garment onto Anny via proximity/normal-offset
    transfer_meta = transfer_garment_to_target(garment, mh, anny)
    report["steps"]["transfer"] = transfer_meta
    transferred_glb = str(out_dir / "garment-transferred-to-anny.glb")
    export_objects_glb([anny, garment], transferred_glb)
    transferred_only = str(out_dir / "garment-only-transferred.glb")
    export_glb(garment, transferred_only)
    report["artifacts"]["garmentTransferredToAnnyGlb"] = transferred_glb
    report["artifacts"]["garmentOnlyTransferredGlb"] = transferred_only
    report["steps"]["garmentAfterTransfer"] = {
        "bounds": world_bounds(garment),
        "triangleEstimate": sum(len(p.vertices) - 2 for p in garment.data.polygons),
    }

    # 5) Renders (Blender Workbench)
    setup_camera_front(target_z=0.95, distance=2.8)
    # MH vs anny reference (both visible)
    set_visibility([anny, mh, garment], True)
    garment.hide_render = True
    garment.hide_viewport = True
    render_png(str(out_dir / "render-mh-vs-anny.png"))
    # Garment on MH (anny hidden) — re-import is too heavy; hide anny, show garment at transfer
    # Note: garment was already transferred. Re-fit would be needed for true "on MH" render.
    # We rendered garment-on-mh GLB earlier; for visual of fit-on-MH we keep a second copy.
    # Snapshot note: transfer already mutated garment. Use GLB for MH-fit visual in TS if needed.
    # Restore by re-importing garment-only-on-mh is complex; instead render transferred state
    # and composite-label in report.
    anny.hide_render = True
    mh.hide_render = False
    garment.hide_render = False
    # garment is post-transfer; label honestly
    render_png(str(out_dir / "render-garment-after-transfer-with-mh.png"))

    anny.hide_render = False
    mh.hide_render = True
    garment.hide_render = False
    render_png(str(out_dir / "render-garment-after-transfer-with-anny.png"))

    report["artifacts"]["renderMhVsAnny"] = str(out_dir / "render-mh-vs-anny.png")
    report["artifacts"]["renderGarmentTransferWithMh"] = str(
        out_dir / "render-garment-after-transfer-with-mh.png"
    )
    report["artifacts"]["renderGarmentTransferWithAnny"] = str(
        out_dir / "render-garment-after-transfer-with-anny.png"
    )
    report["renderNotes"] = (
        "render-mh-vs-anny.png is pre-transfer bodies only (Workbench). "
        "Garment renders are AFTER proximity transfer (garment verts mutated in place). "
        "For pre-transfer garment-on-MH geometry, open garment-on-mh.glb."
    )
    report["renderer"] = "Blender 5.1.1 BLENDER_WORKBENCH"

    report["status"] = "completed"
    report["totalWallClockS"] = round(time.perf_counter() - t0, 3)
    Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"status": report["status"], "artifacts": report["artifacts"]}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        err = {
            "status": "failed",
            "error": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc()[-2500:],
        }
        # Best-effort: merge into existing stage report so mpfb load evidence is not lost.
        argv = sys.argv
        if "--" in argv:
            args = argv[argv.index("--") + 1 :]
            if "--report" in args:
                rpath = args[args.index("--report") + 1]
                Path(rpath).parent.mkdir(parents=True, exist_ok=True)
                existing: dict = {}
                if Path(rpath).is_file():
                    try:
                        existing = json.loads(Path(rpath).read_text(encoding="utf-8"))
                    except Exception:  # noqa: BLE001
                        existing = {}
                existing.update(err)
                Path(rpath).write_text(json.dumps(existing, indent=2), encoding="utf-8")
        print(json.dumps(err))
        raise
