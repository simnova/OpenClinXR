import argparse
import json
import pathlib
import sys

import bpy
from mathutils import Vector


def first_mesh_named(fragment):
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and fragment.lower() in obj.name.lower():
            return obj
    return None


def first_armature():
    for obj in bpy.context.scene.objects:
        if obj.type == "ARMATURE":
            return obj
    return None


def remove_legacy_generated_garments():
    removed = []
    legacy_tokens = ["tunic", "gown", "scrub", "clinical_underlayer", "fitted_gown"]
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        name = obj.name.lower()
        if any(token in name for token in legacy_tokens):
            removed.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)
    return removed


def import_asset(path):
    before = set(bpy.context.scene.objects)
    suffix = path.suffix.lower()
    if suffix in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif suffix == ".obj":
        bpy.ops.wm.obj_import(filepath=str(path))
    else:
        raise RuntimeError(f"Unsupported garment/humanoid asset format: {path}")
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def export_asset(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_apply=True,
    )


def imported_garment_mesh(imported):
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if not meshes:
        return None
    def score_mesh(obj):
        name = obj.name.lower()
        width = obj.dimensions.x
        height = obj.dimensions.y
        depth = obj.dimensions.z
        vertices = len(obj.data.vertices)
        flat_penalty = 5000 if depth < 0.01 or height < 0.03 else 0
        clothing_bonus = 2000 if any(token in name for token in ["shirt", "top", "polo", "tshirt", "t-shirt", "sweater", "bodice", "camisole"]) else 0
        texture_plane_penalty = 3000 if any(token in name for token in ["plane", "card", "thumb", "texture", "base_color", "normal", "roughness"]) else 0
        torso_like_bonus = 1000 if width > 0.2 and height > 0.2 else 0
        return vertices + clothing_bonus + torso_like_bonus - flat_penalty - texture_plane_penalty
    meshes.sort(key=score_mesh, reverse=True)
    garment = meshes[0]
    garment.name = "openclinxr_imported_fitted_garment_candidate"
    garment["openClinXrGarmentMeshSelection"] = {
        "candidateCount": len(meshes),
        "selectedBy": "name_bounds_vertex_count_clothing_score",
        "selectedDimensions": [garment.dimensions.x, garment.dimensions.y, garment.dimensions.z],
        "selectedVertexCount": len(garment.data.vertices),
    }
    return garment


def apply_garment_transform(garment, args):
    garment.location.x += args.garment_offset_x
    garment.location.y += args.garment_offset_y
    garment.location.z += args.garment_offset_z
    garment.rotation_euler.x += args.garment_rotation_x
    garment.rotation_euler.y += args.garment_rotation_y
    garment.rotation_euler.z += args.garment_rotation_z
    garment.scale.x *= args.garment_scale_x
    garment.scale.y *= args.garment_scale_y
    garment.scale.z *= args.garment_scale_z
    garment["openClinXrGarmentFitTransform"] = {
        "offset": [args.garment_offset_x, args.garment_offset_y, args.garment_offset_z],
        "rotation": [args.garment_rotation_x, args.garment_rotation_y, args.garment_rotation_z],
        "scale": [args.garment_scale_x, args.garment_scale_y, args.garment_scale_z],
    }


def world_bounds(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    mins = Vector((min(corner.x for corner in corners), min(corner.y for corner in corners), min(corner.z for corner in corners)))
    maxs = Vector((max(corner.x for corner in corners), max(corner.y for corner in corners), max(corner.z for corner in corners)))
    return mins, maxs


def normalize_garment_to_torso(garment, body, body_measurements=None):
    body_min, body_max = world_bounds(body)
    garment_min, garment_max = world_bounds(garment)
    body_size = body_max - body_min
    garment_size = garment_max - garment_min
    if min(garment_size.x, garment_size.y, garment_size.z) <= 0:
        raise RuntimeError("Cannot normalize garment with zero-sized world bounds")

    measured_torso = (body_measurements or {}).get("targetTorso", {})
    target_size_values = measured_torso.get("size")
    target_center_values = measured_torso.get("center")
    target_size = Vector(tuple(target_size_values)) if target_size_values else Vector((
        max(body_size.x * 1.12, 0.18),
        max(body_size.y * 1.08, 0.08),
        max(body_size.z * 0.34, 0.34),
    ))
    scale_candidates = [
        target_size.x / garment_size.x,
        target_size.z / garment_size.z,
    ]
    uniform_scale = min(scale_candidates)
    uniform_scale = max(min(uniform_scale, 12.0), 0.02)
    garment.scale = (garment.scale.x * uniform_scale, garment.scale.y * uniform_scale, garment.scale.z * uniform_scale)
    bpy.context.view_layer.update()

    garment_min, garment_max = world_bounds(garment)
    garment_center = (garment_min + garment_max) * 0.5
    target_center = Vector(tuple(target_center_values)) if target_center_values else Vector((
        (body_min.x + body_max.x) * 0.5,
        (body_min.y + body_max.y) * 0.5,
        body_min.z + body_size.z * 0.61,
    ))
    garment.location += target_center - garment_center
    bpy.context.view_layer.update()
    normalized_min, normalized_max = world_bounds(garment)
    garment["openClinXrGarmentTorsoBoundsNormalization"] = {
        "bodyBoundsMin": [body_min.x, body_min.y, body_min.z],
        "bodyBoundsMax": [body_max.x, body_max.y, body_max.z],
        "targetCenter": [target_center.x, target_center.y, target_center.z],
        "targetSize": [target_size.x, target_size.y, target_size.z],
        "sourceSizeBeforeScale": [garment_size.x, garment_size.y, garment_size.z],
        "uniformScaleApplied": uniform_scale,
        "normalizedBoundsMin": [normalized_min.x, normalized_min.y, normalized_min.z],
        "normalizedBoundsMax": [normalized_max.x, normalized_max.y, normalized_max.z],
        "measurementSource": body_measurements.get("archetypeId") if body_measurements else "derived_from_body_bounds",
    }


def apply_cloth_material_fallback(garment, args):
    material = bpy.data.materials.new("openclinxr_imported_clinical_garment_material")
    material.use_nodes = True
    material.diffuse_color = (
        args.garment_material_r,
        args.garment_material_g,
        args.garment_material_b,
        args.garment_material_a,
    )
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = material.diffuse_color
        bsdf.inputs["Roughness"].default_value = 0.78
    garment.data.materials.clear()
    garment.data.materials.append(material)
    garment["openClinXrGarmentMaterialFallback"] = {
        "reason": "source_garment_texture_unavailable_or_low_contrast_in_webxr_candidate",
        "color": [
            args.garment_material_r,
            args.garment_material_g,
            args.garment_material_b,
            args.garment_material_a,
        ],
    }


def fit_garment_to_body(garment, body, armature, args):
    shrinkwrap = garment.modifiers.new("openclinxr_body_shrinkwrap_fit", "SHRINKWRAP")
    shrinkwrap.target = body
    shrinkwrap.offset = args.shrinkwrap_offset
    shrinkwrap.wrap_method = "NEAREST_SURFACEPOINT"

    if not any(mod.type == "BEVEL" for mod in garment.modifiers):
        garment.modifiers.new("openclinxr_softened_garment_edges", "BEVEL").width = 0.012
    if not any(mod.type == "WEIGHTED_NORMAL" for mod in garment.modifiers):
        garment.modifiers.new("openclinxr_weighted_normals", "WEIGHTED_NORMAL")

    if armature is not None:
        if not any(mod.type == "ARMATURE" for mod in garment.modifiers):
            arm = garment.modifiers.new("openclinxr_armature_deformation", "ARMATURE")
            arm.object = armature
        garment.parent = armature
        data_transfer = garment.modifiers.new("openclinxr_nearest_body_weights", "DATA_TRANSFER")
        data_transfer.object = body
        data_transfer.use_vert_data = True
        data_transfer.data_types_verts = {"VGROUP_WEIGHTS"}
        data_transfer.vert_mapping = "NEAREST"
        data_transfer.mix_mode = "REPLACE"
    garment["openClinXrGarmentProvider"] = "garment_fitter_local"
    garment["openClinXrGarmentClaimBoundary"] = "local_blender_fit_candidate_not_clinical_or_production_readiness"
    return garment


def main():
    parser = argparse.ArgumentParser(description="Fit an external garment mesh onto a humanoid GLB and export a candidate GLB.")
    parser.add_argument("--humanoid", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--garment", required=True)
    parser.add_argument("--license-record", required=True)
    parser.add_argument("--body-name-fragment", default="body")
    parser.add_argument("--garment-offset-x", type=float, default=0.0)
    parser.add_argument("--garment-offset-y", type=float, default=0.0)
    parser.add_argument("--garment-offset-z", type=float, default=0.0)
    parser.add_argument("--garment-rotation-x", type=float, default=0.0)
    parser.add_argument("--garment-rotation-y", type=float, default=0.0)
    parser.add_argument("--garment-rotation-z", type=float, default=0.0)
    parser.add_argument("--garment-scale-x", type=float, default=1.0)
    parser.add_argument("--garment-scale-y", type=float, default=1.0)
    parser.add_argument("--garment-scale-z", type=float, default=1.0)
    parser.add_argument("--disable-torso-bounds-normalization", action="store_true")
    parser.add_argument("--body-measurements")
    parser.add_argument("--garment-material-r", type=float, default=0.08)
    parser.add_argument("--garment-material-g", type=float, default=0.33)
    parser.add_argument("--garment-material-b", type=float, default=0.38)
    parser.add_argument("--garment-material-a", type=float, default=1.0)
    parser.add_argument("--shrinkwrap-offset", type=float, default=0.055)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    import_asset(pathlib.Path(args.humanoid))
    removed_legacy = remove_legacy_generated_garments()
    body = first_mesh_named(args.body_name_fragment) or next((obj for obj in bpy.context.scene.objects if obj.type == "MESH"), None)
    if body is None:
        raise RuntimeError("No body mesh found for garment fitting")
    armature = first_armature()
    license_record = pathlib.Path(args.license_record)
    if not license_record.exists():
        raise RuntimeError(f"License record not found: {license_record}")
    body_measurements = None
    if args.body_measurements:
        measurements_path = pathlib.Path(args.body_measurements)
        if not measurements_path.exists():
            raise RuntimeError(f"Body measurements not found: {measurements_path}")
        body_measurements = json.loads(measurements_path.read_text())
    garment = imported_garment_mesh(import_asset(pathlib.Path(args.garment)))
    if garment is None:
        raise RuntimeError("No garment mesh found in --garment asset")
    apply_garment_transform(garment, args)
    if not args.disable_torso_bounds_normalization:
        normalize_garment_to_torso(garment, body, body_measurements)
    apply_cloth_material_fallback(garment, args)
    garment["openClinXrGarmentLicenseRecord"] = str(license_record)
    garment["openClinXrRemovedLegacyGeneratedGarments"] = removed_legacy
    fit_garment_to_body(garment, body, armature, args)
    export_asset(pathlib.Path(args.output))


if __name__ == "__main__":
    main()
