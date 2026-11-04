#!/usr/bin/env python3
"""Render deterministic Cycles original/Vitruvian humanoid comparison sheets.

Run with Blender, not host Python:
  blender --background --factory-startup --python vitruvian_cycles_2up.py -- \
    --orig original.glb --new vitruvian.glb --out evidence-dir

The original actor defines one fixed studio rig and four orthographic cameras.
It is then removed and the comparison actor is imported into the same scene.
No source GLB is modified.  ``--dry-run`` performs both imports, validates the
framing and optional OPENCLINXR_skin_shade carrier, and writes manifest.json.
"""

import argparse
import hashlib
import json
import math
import os
import pathlib
import struct
import sys
import tempfile
import time
import zlib

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


EXTENSION = "OPENCLINXR_skin_shade"
SEED = 20261104
IRIS_TO_GLOBE_DIAMETER = 0.5
FRAME_NAMES = {
    "F1": "face",
    "F2": "left-eye",
    "F3": "right-eye",
    "F4": "cheek",
}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def parse_args():
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--orig", required=True, type=pathlib.Path)
    parser.add_argument("--new", required=True, type=pathlib.Path)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    parser.add_argument("--detail-strength", type=float)
    parser.add_argument("--samples", type=int, default=256)
    parser.add_argument("--res", type=int, default=2048)
    parser.add_argument(
        "--frames",
        default="F1,F2,F3,F4",
        help="comma-separated subset of F1,F2,F3,F4 (default: all)",
    )
    parser.add_argument("--dry-run", action="store_true")
    # 900 W at ~0.6 m clipped skin and sclera to white on the first run (2026-11-04).
    parser.add_argument("--light-scale", type=float, default=0.012)
    args = parser.parse_args(raw)
    args.orig = args.orig.resolve()
    args.new = args.new.resolve()
    args.out = args.out.resolve()
    args.frames = [part.strip().upper() for part in args.frames.split(",") if part.strip()]
    require(args.orig.is_file(), f"original GLB does not exist: {args.orig}")
    require(args.new.is_file(), f"Vitruvian GLB does not exist: {args.new}")
    require(args.samples > 0, f"--samples must be positive, got {args.samples}")
    require(args.res >= 1024, f"--res must be >= 1024 for the 300 px iris gate, got {args.res}")
    require(args.frames, "--frames selected no framings")
    require(
        len(set(args.frames)) == len(args.frames)
        and all(frame in FRAME_NAMES for frame in args.frames),
        f"--frames must be a unique subset of {','.join(FRAME_NAMES)}, got {args.frames}",
    )
    if args.detail_strength is not None:
        require(
            args.detail_strength >= 0.0,
            f"--detail-strength must be >= 0, got {args.detail_strength}",
        )
    args.out.mkdir(parents=True, exist_ok=True)
    return args


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_glb(path):
    data = path.read_bytes()
    require(data[:4] == b"glTF", f"not a binary glTF file: {path}")
    version, total = struct.unpack_from("<II", data, 4)
    require(version == 2, f"GLB version must be 2, got {version}: {path}")
    require(total == len(data), f"GLB declared {total} bytes but file has {len(data)}: {path}")
    chunks = []
    cursor = 12
    while cursor < len(data):
        require(cursor + 8 <= len(data), f"truncated GLB chunk header: {path}")
        length, kind = struct.unpack_from("<I4s", data, cursor)
        cursor += 8
        require(cursor + length <= len(data), f"truncated GLB chunk body: {path}")
        chunks.append((kind, data[cursor : cursor + length]))
        cursor += length
    require(chunks and chunks[0][0] == b"JSON", f"GLB has no leading JSON chunk: {path}")
    gltf = json.loads(chunks[0][1].decode("utf-8").rstrip(" \t\r\n\x00"))
    binary = next((body for kind, body in chunks if kind == b"BIN\x00"), b"")
    return gltf, binary


def extension_record(path, require_detail=False):
    gltf, binary = read_glb(path)
    carriers = []
    for index, material in enumerate(gltf.get("materials", [])):
        extension = (material.get("extensions") or {}).get(EXTENSION)
        if extension is not None:
            carriers.append((index, material.get("name") or f"material-{index}", extension))
    if require_detail:
        require(carriers, f"missing {EXTENSION} material extension in {path}")
    if not carriers:
        return None
    detail_carriers = [row for row in carriers if row[2].get("detailNormalTexture") is not None]
    if require_detail:
        require(
            len(detail_carriers) == 1,
            f"expected exactly one {EXTENSION}.detailNormalTexture in {path}, found {len(detail_carriers)}",
        )
    if not detail_carriers:
        return {
            "extension": EXTENSION,
            "carriers": [name for _, name, _ in carriers],
            "detailNormalTexture": None,
        }
    require(
        len(detail_carriers) == 1,
        f"ambiguous {EXTENSION}: found {len(detail_carriers)} detail-normal carriers in {path}",
    )
    material_index, material_name, extension = detail_carriers[0]
    texture_info = extension["detailNormalTexture"]
    require("index" in texture_info, f"{EXTENSION}.detailNormalTexture.index missing in {path}")
    texture_index = int(texture_info["index"])
    textures = gltf.get("textures", [])
    require(0 <= texture_index < len(textures), f"detail texture index {texture_index} is out of range")
    texture = textures[texture_index]
    source = texture.get("source")
    if source is None:
        source = (texture.get("extensions") or {}).get("KHR_texture_basisu", {}).get("source")
    require(source is not None, f"detail texture {texture_index} has no image source in {path}")
    images = gltf.get("images", [])
    require(0 <= source < len(images), f"detail image index {source} is out of range")
    image = images[source]
    require("bufferView" in image, f"detail image {source} is not embedded in a bufferView: {path}")
    view_index = int(image["bufferView"])
    views = gltf.get("bufferViews", [])
    require(0 <= view_index < len(views), f"detail image bufferView {view_index} is out of range")
    view = views[view_index]
    require(int(view.get("buffer", 0)) == 0, "detail image must use GLB buffer 0")
    start = int(view.get("byteOffset", 0))
    end = start + int(view["byteLength"])
    require(end <= len(binary), f"detail image bufferView exceeds BIN chunk: {path}")
    transform = (texture_info.get("extensions") or {}).get("KHR_texture_transform", {})
    scale = transform.get("scale", [1.0, 1.0])
    offset = transform.get("offset", [0.0, 0.0])
    require(len(scale) == 2 and all(float(x) > 0 for x in scale), f"invalid detail UV scale: {scale}")
    require(len(offset) == 2, f"invalid detail UV offset: {offset}")
    nominal_strength = float(extension.get("detailNormalStrength", 1.0))
    require(nominal_strength >= 0.0, f"invalid detailNormalStrength: {nominal_strength}")
    return {
        "extension": EXTENSION,
        "materialIndex": material_index,
        "materialName": material_name,
        "textureIndex": texture_index,
        "imageIndex": source,
        "imageName": image.get("name"),
        "mimeType": image.get("mimeType"),
        "imageBytes": binary[start:end],
        "imageSha256": hashlib.sha256(binary[start:end]).hexdigest(),
        "texCoord": int(texture_info.get("texCoord", 0)),
        "transform": {
            "scale": [float(scale[0]), float(scale[1])],
            "offset": [float(offset[0]), float(offset[1])],
            "rotation": float(transform.get("rotation", 0.0)),
        },
        "nominalStrength": nominal_strength,
    }


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.users == 0:
            bpy.data.collections.remove(collection)


def import_actor(path):
    before = set(bpy.data.objects)
    result = bpy.ops.import_scene.gltf(filepath=str(path))
    require("FINISHED" in result, f"Blender glTF import failed for {path}: {result}")
    bpy.context.view_layer.update()
    objects = [obj for obj in bpy.data.objects if obj not in before]
    require(objects, f"Blender glTF import created no objects for {path}")
    meshes = [obj for obj in objects if obj.type == "MESH"]
    require(meshes, f"GLB import contains no mesh objects: {path}")
    # Same subject isolation as the three.js harness (hideHair): scalp hair is an alpha
    # card that imports as an opaque slab over the brow and eyes.
    for obj in meshes:
        if "_hair_" in obj.name.lower():
            obj.hide_render = True
    return objects


def remove_actor(objects):
    for obj in objects:
        if obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.armatures,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.textures,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)
    bpy.context.view_layer.update()


def material_names(obj):
    return [slot.material.name.lower() for slot in obj.material_slots if slot.material]


def find_actor_parts(objects, source):
    armatures = [obj for obj in objects if obj.type == "ARMATURE"]
    require(len(armatures) == 1, f"expected one armature in {source}, found {len(armatures)}")
    armature = armatures[0]
    missing_bones = [name for name in ("eye.L", "eye.R") if name not in armature.data.bones]
    require(not missing_bones, f"missing eye bones {missing_bones} in {source}")
    meshes = [obj for obj in objects if obj.type == "MESH"]
    eye_candidates = [
        obj
        for obj in meshes
        if any("eyes_" in name or "library_eyes" in name for name in material_names(obj))
    ]
    if not eye_candidates:
        eye_candidates = [
            obj
            for obj in meshes
            if "eye" in (obj.name + " " + obj.data.name).lower()
            and not any(token in (obj.name + " " + obj.data.name).lower() for token in ("brow", "lash", "tear", "cornea"))
        ]
    require(
        len(eye_candidates) == 1,
        f"missing or ambiguous eye mesh in {source}: found {[obj.name for obj in eye_candidates]}",
    )
    skin_candidates = [obj for obj in meshes if any("skin" in name for name in material_names(obj))]
    require(
        len(skin_candidates) == 1,
        f"missing or ambiguous skin/body mesh in {source}: found {[obj.name for obj in skin_candidates]}",
    )
    return armature, eye_candidates[0], skin_candidates[0]


def evaluated_points(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        return [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def bone_point(armature, name, tail=False):
    bone = armature.data.bones[name]
    local = bone.tail_local if tail else bone.head_local
    return armature.matrix_world @ local


def actor_geometry(objects, source):
    armature, eye_mesh, skin_mesh = find_actor_parts(objects, source)
    left = bone_point(armature, "eye.L")
    right = bone_point(armature, "eye.R")
    left_facing = bone_point(armature, "eye.L", tail=True) - left
    right_facing = bone_point(armature, "eye.R", tail=True) - right
    facing = left_facing + right_facing
    require(facing.length > 1e-6, f"eye bones have no usable facing direction in {source}")
    facing.normalize()
    up = Vector((0.0, 0.0, 1.0))
    facing = facing - up * facing.dot(up)
    require(facing.length > 1e-6, f"eye-bone facing is parallel to world up in {source}")
    facing.normalize()
    side = up.cross(facing)
    side.normalize()
    center = (left + right) * 0.5
    iod = (left - right).length
    require(0.025 <= iod <= 0.09, f"implausible interocular distance {iod:.5f} m in {source}")
    all_eye_points = evaluated_points(eye_mesh)
    require(len(all_eye_points) >= 48,  # shipped MPFB eyes_low_poly is 96 verts (two globes)
            f"eye mesh has only {len(all_eye_points)} evaluated vertices in {source}")
    eye_points = {"left": [], "right": []}
    for point in all_eye_points:
        target = "left" if (point - left).length <= (point - right).length else "right"
        eye_points[target].append(point)
    require(
        min(len(points) for points in eye_points.values()) >= 30,
        f"eye mesh did not split into two globes in {source}: "
        + ", ".join(f"{key}={len(value)}" for key, value in eye_points.items()),
    )
    skin_points = evaluated_points(skin_mesh)
    head_points = []
    for point in skin_points:
        delta = point - center
        if (
            abs(delta.dot(side)) <= 1.55 * iod
            and -1.75 * iod <= delta.dot(up) <= 1.90 * iod
            and abs(delta.dot(facing)) <= 1.60 * iod
        ):
            head_points.append(point)
    require(len(head_points) >= 500, f"head bounds selected only {len(head_points)} skin vertices in {source}")
    return {
        "armature": armature,
        "eyeMesh": eye_mesh,
        "skinMesh": skin_mesh,
        "left": left,
        "right": right,
        "center": center,
        "facing": facing,
        "side": side,
        "up": up,
        "iod": iod,
        "eyePoints": eye_points,
        "headPoints": head_points,
    }


def axis_bounds(points, axis):
    values = [point.dot(axis) for point in points]
    return min(values), max(values)


def bounds_center(points, side, up, facing):
    sx = axis_bounds(points, side)
    sy = axis_bounds(points, up)
    sz = axis_bounds(points, facing)
    return side * ((sx[0] + sx[1]) * 0.5) + up * ((sy[0] + sy[1]) * 0.5) + facing * ((sz[0] + sz[1]) * 0.5)


def look_at(obj, target):
    direction = target - obj.location
    require(direction.length > 1e-6, f"cannot aim {obj.name}: camera/light is at target")
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_camera(name, target, scale, facing, distance):
    data = bpy.data.cameras.new(name)
    data.type = "ORTHO"
    data.ortho_scale = scale
    data.lens = 85.0
    data.clip_start = 0.001
    data.clip_end = max(10.0, distance * 10.0)
    camera = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(camera)
    camera.location = target + facing * distance
    look_at(camera, target)
    return camera


def projected_bounds(scene, camera, points):
    coords = [world_to_camera_view(scene, camera, point) for point in points]
    require(coords, f"no points supplied for framing check: {camera.name}")
    require(all(point.z > 0 for point in coords), f"{camera.name} has subject points behind the camera")
    return {
        "minX": min(point.x for point in coords),
        "maxX": max(point.x for point in coords),
        "minY": min(point.y for point in coords),
        "maxY": max(point.y for point in coords),
    }


def camera_record(camera, target, bounds, extra=None):
    record = {
        "name": camera.name,
        "projection": "ORTHO",
        "orthoScaleMeters": camera.data.ortho_scale,
        "lensMmMetadataOnly": camera.data.lens,
        "location": list(camera.location),
        "rotationEulerRadians": list(camera.rotation_euler),
        "target": list(target),
        "projectedBoundsNormalized": bounds,
    }
    if extra:
        record.update(extra)
    return record


def build_cameras(scene, geometry, resolution):
    side, up, facing = geometry["side"], geometry["up"], geometry["facing"]
    head_points = geometry["headPoints"]
    head_min, head_max = axis_bounds(head_points, up)
    head_height = head_max - head_min
    require(head_height > 0.12, f"head bounds height is only {head_height:.5f} m")
    head_target = bounds_center(head_points, side, up, facing)
    distance = max(head_height * 4.0, geometry["iod"] * 8.0)
    cameras = {}
    records = {}

    face = add_camera("F1-face", head_target, head_height / 0.84, facing, distance)
    bpy.context.view_layer.update()
    face_bounds = projected_bounds(scene, face, head_points)
    face_fill = face_bounds["maxY"] - face_bounds["minY"]
    require(face_fill >= 0.8, f"F1 head fill is {face_fill:.4f}, required >= 0.8")
    require(
        face_bounds["minX"] >= 0.0 and face_bounds["maxX"] <= 1.0
        and face_bounds["minY"] >= 0.0 and face_bounds["maxY"] <= 1.0,
        f"F1 head bounds leave frame: {face_bounds}",
    )
    cameras["F1"] = face
    records["F1"] = camera_record(face, head_target, face_bounds, {"headFillHeight": face_fill})

    for frame, label, center in (
        ("F2", "left", geometry["left"]),
        ("F3", "right", geometry["right"]),
    ):
        points = geometry["eyePoints"][label]
        eye_side = axis_bounds(points, side)
        globe_width = eye_side[1] - eye_side[0]
        require(globe_width > 0.01, f"{frame} globe width is implausible: {globe_width:.5f} m")
        # Keep a measured 720 px globe at any accepted output resolution.  With
        # the measured 0.5 iris/globe ratio this gives a conservative 360 px
        # iris instead of making the >=300 px gate resolution-dependent.
        target_globe_fraction = 720.0 / resolution
        require(target_globe_fraction < 0.8, f"{frame} resolution leaves no eye context")
        scale = globe_width / target_globe_fraction
        camera = add_camera(f"{frame}-{label}-eye", center, scale, facing, distance)
        bpy.context.view_layer.update()
        bounds = projected_bounds(scene, camera, points)
        require(
            bounds["minX"] >= 0.0 and bounds["maxX"] <= 1.0
            and bounds["minY"] >= 0.0 and bounds["maxY"] <= 1.0,
            f"{frame} eye bounds leave frame: {bounds}",
        )
        globe_px = (bounds["maxX"] - bounds["minX"]) * resolution
        iris_px = globe_px * IRIS_TO_GLOBE_DIAMETER
        require(iris_px >= 300.0, f"{frame} estimated iris is {iris_px:.1f}px, required >= 300px")
        cameras[frame] = camera
        records[frame] = camera_record(
            camera,
            center,
            bounds,
            {
                "globeWidthMeters": globe_width,
                "projectedGlobePx": globe_px,
                "irisPx": iris_px,
                "irisEstimate": "0.5 * evaluated eye-globe projected width",
            },
        )

    right_points = geometry["eyePoints"]["right"]
    eye_vertical = axis_bounds(right_points, up)
    eye_radius = (eye_vertical[1] - eye_vertical[0]) * 0.5
    require(eye_radius > 0.005, f"cannot derive cheek target: eye radius is {eye_radius:.5f} m")
    cheek_target = geometry["right"] - up * (1.65 * eye_radius) + side * (0.8 * eye_radius)
    target_px_per_mm = 10.0
    cheek_scale = resolution / (target_px_per_mm * 1000.0)
    cheek = add_camera("F4-cheek", cheek_target, cheek_scale, facing, distance)
    bpy.context.view_layer.update()
    cheek_bounds = projected_bounds(scene, cheek, [cheek_target])
    px_per_mm = resolution / cheek.data.ortho_scale / 1000.0
    require(px_per_mm >= 8.0, f"F4 scale is {px_per_mm:.3f}px/mm, required >= 8")
    require(
        0.0 <= cheek_bounds["minX"] <= 1.0 and 0.0 <= cheek_bounds["minY"] <= 1.0,
        f"F4 cheek target leaves frame: {cheek_bounds}",
    )
    cameras["F4"] = cheek
    records["F4"] = camera_record(
        cheek,
        cheek_target,
        cheek_bounds,
        {
            "pxPerMm": px_per_mm,
            "targetDerivation": "right eye center - 1.65 eye radii up + 0.8 eye radii lateral",
            "denoiser": False,
        },
    )
    return cameras, records, head_target


LIGHT_SCALE = 1.0


def add_area(name, location, target, power, size):
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = power * LIGHT_SCALE
    data.shape = "DISK"
    data.size = size
    light = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(light)
    light.location = location
    look_at(light, target)
    return light


def build_studio(scene, geometry, target):
    side, up, facing = geometry["side"], geometry["up"], geometry["facing"]
    iod = geometry["iod"]
    lights = [
        add_area("Key", target + facing * (7.0 * iod) - side * (5.0 * iod) + up * (4.0 * iod), target, 900.0, 0.55),
        add_area("Fill", target + facing * (5.5 * iod) + side * (5.5 * iod) + up * (1.5 * iod), target, 350.0, 0.8),
        add_area("Rim", target - facing * (4.0 * iod) + side * (3.0 * iod) + up * (5.0 * iod), target, 700.0, 0.45),
    ]
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    require(background is not None, "Blender world has no Background node")
    background.inputs["Color"].default_value = (0.18, 0.18, 0.18, 1.0)
    background.inputs["Strength"].default_value = 0.18
    return {
        "world": {"colorLinearRGBA": [0.18, 0.18, 0.18, 1.0], "strength": 0.18},
        "lights": [
            {
                "name": light.name,
                "type": light.data.type,
                "powerWatts": light.data.energy,
                "sizeMeters": light.data.size,
                "location": list(light.location),
                "rotationEulerRadians": list(light.rotation_euler),
            }
            for light in lights
        ],
    }


def configure_render(scene, args):
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = args.res
    scene.render.resolution_y = args.res
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    scene.cycles.samples = args.samples
    scene.cycles.seed = SEED
    scene.cycles.use_animated_seed = False
    scene.cycles.use_denoising = False
    scene.render.use_compositing = False
    scene.view_settings.view_transform = "AgX"
    # Blender/OCIO releases have used both spellings for this AgX look.
    for look in ("AgX - Medium High Contrast", "Medium High Contrast", "None"):
        try:
            scene.view_settings.look = look
            break
        except TypeError:
            continue
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    device = {"requested": "METAL GPU", "selected": "not-selected-dry-run", "enabledDevices": []}
    if not args.dry_run:
        try:
            preferences = bpy.context.preferences.addons["cycles"].preferences
            preferences.compute_device_type = "METAL"
            preferences.get_devices()
            enabled = []
            for candidate in preferences.devices:
                candidate.use = candidate.type == "METAL"
                if candidate.use:
                    enabled.append(candidate.name)
            require(enabled, "Cycles reports no Metal device")
            scene.cycles.device = "GPU"
            device = {"requested": "METAL GPU", "selected": "GPU", "enabledDevices": enabled}
        except Exception as exc:
            scene.cycles.device = "CPU"
            device = {
                "requested": "METAL GPU",
                "selected": "CPU fallback",
                "enabledDevices": [],
                "fallbackReason": str(exc),
            }
    return device


def find_imported_material(material_name):
    matches = [
        material
        for material in bpy.data.materials
        if material.name == material_name or material.name.startswith(material_name + ".")
    ]
    require(
        len(matches) == 1,
        f"cannot map GLB extension material {material_name!r} to exactly one Blender material; "
        f"found {[material.name for material in matches]}",
    )
    return matches[0]


def wire_detail_normal(record, override_strength, out_dir):
    if not record or record.get("textureIndex") is None:
        return {"extensionPresent": bool(record), "mode": "no-detail-normal"}
    strength = record["nominalStrength"] if override_strength is None else override_strength
    base = {
        "extensionPresent": True,
        "material": record["materialName"],
        "textureIndex": record["textureIndex"],
        "imageIndex": record["imageIndex"],
        "imageName": record["imageName"],
        "imageSha256": record["imageSha256"],
        "texCoord": record["texCoord"],
        "uvTransform": record["transform"],
        "nominalStrength": record["nominalStrength"],
        "effectiveStrength": strength,
    }
    if strength == 0.0:
        base.update(
            {
                "mode": "bypass-zero-strength",
                "nodesAdded": [],
                "reason": "strength 0 leaves the imported shader graph byte-for-byte untouched",
            }
        )
        return base
    require(record["mimeType"] == "image/png", f"detail normal must be image/png, got {record['mimeType']}")
    material = find_imported_material(record["materialName"])
    require(material.use_nodes and material.node_tree, f"skin material has no node graph: {material.name}")
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = [node for node in nodes if node.type == "BSDF_PRINCIPLED"]
    require(len(principled) == 1, f"expected one Principled BSDF in {material.name}, found {len(principled)}")
    normal_input = principled[0].inputs.get("Normal")
    require(normal_input is not None, f"Principled BSDF has no Normal input in {material.name}")
    old_link = normal_input.links[0] if normal_input.is_linked else None

    suffix = ".png"
    handle = tempfile.NamedTemporaryFile(
        prefix=f"vitruvian_detail_{os.getpid()}_", suffix=suffix, dir=str(out_dir), delete=False
    )
    temp_path = pathlib.Path(handle.name)
    try:
        handle.write(record["imageBytes"])
        handle.close()
        image = bpy.data.images.load(str(temp_path), check_existing=False)
        image.name = f"Vitruvian detail normal {record['imageSha256'][:8]}"
        image.colorspace_settings.name = "Non-Color"
        image.pack()
    finally:
        if not handle.closed:
            handle.close()
        temp_path.unlink(missing_ok=True)

    uv = nodes.new("ShaderNodeTexCoord")
    uv.name = "Vitruvian Detail UV"
    mapping = nodes.new("ShaderNodeMapping")
    mapping.name = "Vitruvian Detail UV Transform"
    mapping.vector_type = "POINT"
    scale = record["transform"]["scale"]
    offset = record["transform"]["offset"]
    mapping.inputs["Scale"].default_value = (scale[0], scale[1], 1.0)
    mapping.inputs["Location"].default_value = (offset[0], offset[1], 0.0)
    mapping.inputs["Rotation"].default_value[2] = record["transform"]["rotation"]
    texture = nodes.new("ShaderNodeTexImage")
    texture.name = "Vitruvian Pore Detail Normal"
    texture.image = image
    texture.interpolation = "Linear"
    texture.extension = "REPEAT"
    normal = nodes.new("ShaderNodeNormalMap")
    normal.name = "Vitruvian Tangent Detail Normal"
    normal.space = "TANGENT"
    normal.inputs["Strength"].default_value = strength
    links.new(uv.outputs["UV"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], texture.inputs["Vector"])
    links.new(texture.outputs["Color"], normal.inputs["Color"])
    combine = None
    if old_link is None:
        links.new(normal.outputs["Normal"], normal_input)
        combine_method = "detail tangent normal -> Principled Normal (no base normal was linked)"
    else:
        base_socket = old_link.from_socket
        links.remove(old_link)
        add = nodes.new("ShaderNodeVectorMath")
        add.name = "Vitruvian Add Base And Detail Normals"
        add.operation = "ADD"
        normalize = nodes.new("ShaderNodeVectorMath")
        normalize.name = "Vitruvian Normalize Combined Normal"
        normalize.operation = "NORMALIZE"
        links.new(base_socket, add.inputs[0])
        links.new(normal.outputs["Normal"], add.inputs[1])
        links.new(add.outputs["Vector"], normalize.inputs[0])
        links.new(normalize.outputs["Vector"], normal_input)
        combine = [add.name, normalize.name]
        combine_method = "normalized vector sum of imported base normal and tangent detail normal"
    base.update(
        {
            "mode": "wired",
            "nodesAdded": [uv.name, mapping.name, texture.name, normal.name] + (combine or []),
            "links": "UV -> Mapping(scale/offset/rotation) -> embedded PNG(Non-Color, Repeat) -> Normal Map(Tangent) -> Principled Normal",
            "baseNormalBeforeWiring": old_link.from_node.name if old_link else None,
            "combineMethod": combine_method,
        }
    )
    return base


def render_variant(scene, cameras, frames, tag, out_dir):
    timings = {}
    for frame in frames:
        directory = out_dir / f"{frame}-{FRAME_NAMES[frame]}"
        directory.mkdir(parents=True, exist_ok=True)
        scene.camera = cameras[frame]
        scene.render.filepath = str(directory / f"{tag}.png")
        scene.cycles.use_denoising = False
        started = time.monotonic()
        result = bpy.ops.render.render(write_still=True)
        require("FINISHED" in result, f"Cycles render failed for {tag} {frame}: {result}")
        timings[frame] = round(time.monotonic() - started, 3)
    return timings


def paeth(a, b, c):
    estimate = a + b - c
    pa, pb, pc = abs(estimate - a), abs(estimate - b), abs(estimate - c)
    return a if pa <= pb and pa <= pc else b if pb <= pc else c


def read_png(path):
    data = path.read_bytes()
    require(data[:8] == b"\x89PNG\r\n\x1a\n", f"not a PNG: {path}")
    cursor = 8
    payload = bytearray()
    width = height = bit_depth = color_type = None
    while cursor < len(data):
        length = struct.unpack_from(">I", data, cursor)[0]
        kind = data[cursor + 4 : cursor + 8]
        body = data[cursor + 8 : cursor + 8 + length]
        cursor += 12 + length
        if kind == b"IHDR":
            width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(
                ">IIBBBBB", body
            )
            require((compression, filtering, interlace) == (0, 0, 0), f"unsupported PNG encoding: {path}")
        elif kind == b"IDAT":
            payload.extend(body)
        elif kind == b"IEND":
            break
    require(bit_depth == 8 and color_type in (2, 6), f"PNG must be 8-bit RGB/RGBA: {path}")
    channels = 3 if color_type == 2 else 4
    raw = zlib.decompress(bytes(payload))
    stride = width * channels
    require(len(raw) == height * (stride + 1), f"unexpected PNG scanline size: {path}")
    rows = []
    previous = bytearray(stride)
    offset = 0
    for _ in range(height):
        filter_type = raw[offset]
        scan = bytearray(raw[offset + 1 : offset + 1 + stride])
        offset += stride + 1
        require(filter_type <= 4, f"unsupported PNG filter {filter_type}: {path}")
        for index in range(stride):
            left = scan[index - channels] if index >= channels else 0
            above = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            if filter_type == 1:
                scan[index] = (scan[index] + left) & 255
            elif filter_type == 2:
                scan[index] = (scan[index] + above) & 255
            elif filter_type == 3:
                scan[index] = (scan[index] + ((left + above) >> 1)) & 255
            elif filter_type == 4:
                scan[index] = (scan[index] + paeth(left, above, upper_left)) & 255
        if channels == 3:
            rgba = bytearray()
            for index in range(0, len(scan), 3):
                rgba.extend(scan[index : index + 3])
                rgba.append(255)
            rows.append(rgba)
        else:
            rows.append(scan)
        previous = scan
    return width, height, rows


def png_chunk(kind, body):
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)


def write_png(path, width, height, rows):
    require(len(rows) == height and all(len(row) == width * 4 for row in rows), "invalid RGBA sheet rows")
    raw = b"".join(b"\x00" + bytes(row) for row in rows)
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(raw, 6))
        + png_chunk(b"IEND", b"")
    )


FONT = {
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "B": ("11110", "10001", "10001", "11110", "10001", "10001", "11110"),
    "C": ("01111", "10000", "10000", "10000", "10000", "10000", "01111"),
    "D": ("11110", "10001", "10001", "10001", "10001", "10001", "11110"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "F": ("11111", "10000", "10000", "11110", "10000", "10000", "10000"),
    "G": ("01111", "10000", "10000", "10111", "10001", "10001", "01111"),
    "H": ("10001", "10001", "10001", "11111", "10001", "10001", "10001"),
    "I": ("11111", "00100", "00100", "00100", "00100", "00100", "11111"),
    "J": ("00111", "00010", "00010", "00010", "10010", "10010", "01100"),
    "K": ("10001", "10010", "10100", "11000", "10100", "10010", "10001"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "M": ("10001", "11011", "10101", "10101", "10001", "10001", "10001"),
    "N": ("10001", "11001", "10101", "10011", "10001", "10001", "10001"),
    "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "P": ("11110", "10001", "10001", "11110", "10000", "10000", "10000"),
    "Q": ("01110", "10001", "10001", "10001", "10101", "10010", "01101"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "U": ("10001", "10001", "10001", "10001", "10001", "10001", "01110"),
    "V": ("10001", "10001", "10001", "10001", "10001", "01010", "00100"),
    "W": ("10001", "10001", "10001", "10101", "10101", "11011", "10001"),
    "X": ("10001", "10001", "01010", "00100", "01010", "10001", "10001"),
    "Y": ("10001", "10001", "01010", "00100", "00100", "00100", "00100"),
    "Z": ("11111", "00001", "00010", "00100", "01000", "10000", "11111"),
    "0": ("01110", "10001", "10011", "10101", "11001", "10001", "01110"),
    "1": ("00100", "01100", "00100", "00100", "00100", "00100", "01110"),
    "2": ("01110", "10001", "00001", "00010", "00100", "01000", "11111"),
    "3": ("11110", "00001", "00001", "01110", "00001", "00001", "11110"),
    "4": ("00010", "00110", "01010", "10010", "11111", "00010", "00010"),
    "5": ("11111", "10000", "10000", "11110", "00001", "00001", "11110"),
    "6": ("01110", "10000", "10000", "11110", "10001", "10001", "01110"),
    "7": ("11111", "00001", "00010", "00100", "01000", "01000", "01000"),
    "8": ("01110", "10001", "10001", "01110", "10001", "10001", "01110"),
    "9": ("01110", "10001", "10001", "01111", "00001", "00001", "01110"),
    " ": ("00000",) * 7,
}


def draw_text(rows, panel_x, panel_width, text, scale=2):
    text = text.upper()
    require(all(char in FONT for char in text), f"sheet label has unsupported glyph: {text}")
    glyph_width = 6 * scale
    width = len(text) * glyph_width - scale
    x0 = panel_x + max(0, (panel_width - width) // 2)
    y0 = 5
    for char_index, char in enumerate(text):
        glyph = FONT[char]
        for gy, line in enumerate(glyph):
            for gx, on in enumerate(line):
                if on == "1":
                    for yy in range(scale):
                        for xx in range(scale):
                            x = x0 + char_index * glyph_width + gx * scale + xx
                            y = y0 + gy * scale + yy
                            offset = x * 4
                            rows[y][offset : offset + 4] = b"\xee\xee\xee\xff"


def make_sheet(orig_path, new_path, sheet_path, orig_sha, new_sha):
    ow, oh, orig_rows = read_png(orig_path)
    nw, nh, new_rows = read_png(new_path)
    require((ow, oh) == (nw, nh), f"panel dimensions differ: {(ow, oh)} vs {(nw, nh)}")
    strip_height = 24
    sheet_width = ow + nw
    rows = [bytearray(b"\x18\x18\x18\xff" * sheet_width) for _ in range(strip_height)]
    for y in range(oh):
        rows.append(bytearray(orig_rows[y] + new_rows[y]))
    draw_text(rows, 0, ow, f"original {orig_sha[:8]}")
    draw_text(rows, ow, nw, f"Vitruvian {new_sha[:8]}")
    write_png(sheet_path, sheet_width, oh + strip_height, rows)
    maximum = 0
    total = 0
    count = ow * oh * 3
    for left, right in zip(orig_rows, new_rows):
        for index in range(0, len(left), 4):
            for channel in range(3):
                delta = abs(left[index + channel] - right[index + channel])
                maximum = max(maximum, delta)
                total += delta
    return {
        "maxAbs8bit": maximum,
        "maxAbsNormalized": maximum / 255.0,
        "meanAbs8bit": total / count,
        "meanAbsNormalized": total / count / 255.0,
        "comparedChannels": count,
        "panelSizePx": [ow, oh],
        "sheetSizePx": [sheet_width, oh + strip_height],
        "layout": "24 px label strip above native-resolution original | Vitruvian panels; no resampling",
    }


def validate_comparison_geometry(reference, comparison, source):
    iod_ratio = comparison["iod"] / reference["iod"]
    center_delta = (comparison["center"] - reference["center"]).length
    require(0.98 <= iod_ratio <= 1.02, f"comparison interocular scale changed: ratio {iod_ratio:.5f} in {source}")
    require(
        center_delta <= reference["iod"] * 0.1,
        f"comparison eye center moved {center_delta:.5f} m; fixed cameras would not be comparable: {source}",
    )
    return {"interocularRatioToOriginal": iod_ratio, "eyeCenterDeltaMeters": center_delta}


def validate_comparison_framing(scene, cameras, comparison, resolution, source):
    records = {}
    face_bounds = projected_bounds(scene, cameras["F1"], comparison["headPoints"])
    face_fill = face_bounds["maxY"] - face_bounds["minY"]
    require(face_fill >= 0.8, f"comparison F1 head fill is {face_fill:.4f}, required >= 0.8: {source}")
    require(
        face_bounds["minX"] >= 0.0 and face_bounds["maxX"] <= 1.0
        and face_bounds["minY"] >= 0.0 and face_bounds["maxY"] <= 1.0,
        f"comparison F1 head bounds leave fixed frame: {face_bounds}: {source}",
    )
    records["F1"] = {"projectedBoundsNormalized": face_bounds, "headFillHeight": face_fill}
    for frame, label in (("F2", "left"), ("F3", "right")):
        bounds = projected_bounds(scene, cameras[frame], comparison["eyePoints"][label])
        require(
            bounds["minX"] >= 0.0 and bounds["maxX"] <= 1.0
            and bounds["minY"] >= 0.0 and bounds["maxY"] <= 1.0,
            f"comparison {frame} eye bounds leave fixed frame: {bounds}: {source}",
        )
        globe_px = (bounds["maxX"] - bounds["minX"]) * resolution
        iris_px = globe_px * IRIS_TO_GLOBE_DIAMETER
        require(iris_px >= 300.0, f"comparison {frame} iris is {iris_px:.1f}px, required >= 300: {source}")
        records[frame] = {
            "projectedBoundsNormalized": bounds,
            "projectedGlobePx": globe_px,
            "irisPx": iris_px,
        }
    return records


def public_extension_record(record):
    if record is None:
        return None
    return {key: value for key, value in record.items() if key not in ("imageBytes",)}


def main():
    global LIGHT_SCALE
    args = parse_args()
    LIGHT_SCALE = args.light_scale
    started = time.monotonic()
    original_sha = sha256(args.orig)
    new_sha = sha256(args.new)
    new_extension = extension_record(args.new, require_detail=args.detail_strength is not None)
    reset_scene()
    scene = bpy.context.scene
    device = configure_render(scene, args)

    original_objects = import_actor(args.orig)
    original_geometry = actor_geometry(original_objects, args.orig)
    cameras, camera_records, rig_target = build_cameras(scene, original_geometry, args.res)
    rig = build_studio(scene, original_geometry, rig_target)
    original_times = {} if args.dry_run else render_variant(scene, cameras, args.frames, "orig", args.out)
    remove_actor(original_objects)

    new_objects = import_actor(args.new)
    comparison_geometry = actor_geometry(new_objects, args.new)
    geometry_check = validate_comparison_geometry(original_geometry, comparison_geometry, args.new)
    comparison_framing = validate_comparison_framing(
        scene, cameras, comparison_geometry, args.res, args.new
    )
    wiring = wire_detail_normal(new_extension, args.detail_strength, args.out)
    new_times = {} if args.dry_run else render_variant(scene, cameras, args.frames, "new", args.out)

    comparisons = {}
    if not args.dry_run:
        for frame in args.frames:
            directory = args.out / f"{frame}-{FRAME_NAMES[frame]}"
            comparisons[frame] = make_sheet(
                directory / "orig.png",
                directory / "new.png",
                directory / "2up.png",
                original_sha,
                new_sha,
            )

    manifest = {
        "schemaVersion": "openclinxr.vitruvian-cycles-2up.v1",
        "status": "dry-run" if args.dry_run else "rendered",
        "inputs": {
            "original": {"path": str(args.orig), "sha256": original_sha, "sha8": original_sha[:8]},
            "vitruvian": {"path": str(args.new), "sha256": new_sha, "sha8": new_sha[:8]},
        },
        "args": {
            "detailStrengthOverride": args.detail_strength,
            "samples": args.samples,
            "resolutionPx": args.res,
            "frames": args.frames,
            "dryRun": args.dry_run,
        },
        "extension": public_extension_record(new_extension),
        "detailNormalWiring": wiring,
        "geometryCheck": geometry_check,
        "comparisonFramingChecks": comparison_framing,
        "rig": rig,
        "cameras": camera_records,
        "renderSettings": {
            "engine": "CYCLES",
            "device": device,
            "samples": args.samples,
            "seed": SEED,
            "animatedSeed": False,
            "denoiser": False,
            "denoiserNote": "disabled for every frame; F4 must remain un-denoised so pores survive",
            "viewTransform": scene.view_settings.view_transform,
            "look": scene.view_settings.look,
            "exposure": scene.view_settings.exposure,
            "gamma": scene.view_settings.gamma,
            "resolutionPx": [args.res, args.res],
            "filmTransparent": False,
        },
        "outputs": {
            frame: {
                "directory": str(args.out / f"{frame}-{FRAME_NAMES[frame]}"),
                "orig": None if args.dry_run else "orig.png",
                "new": None if args.dry_run else "new.png",
                "2up": None if args.dry_run else "2up.png",
            }
            for frame in args.frames
        },
        "pixelComparisons": comparisons,
        "wallTimeSeconds": {
            "originalByFrame": original_times,
            "vitruvianByFrame": new_times,
            "total": round(time.monotonic() - started, 3),
        },
        "notEvidenceFor": {
            "clinicalValidity": True,
            "examEquivalence": True,
            "questReadiness": True,
            "runtimeShipGate": True,
        },
        "shipGate": "three.js vitruvian-compare.ts remains the runtime ship gate",
    }
    manifest_path = args.out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"VITRUVIAN_CYCLES_2UP manifest={manifest_path} status={manifest['status']}")


if __name__ == "__main__":
    main()
