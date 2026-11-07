"""Canonical, reusable OpenClinXR hair comparison scene.

This module deliberately owns scene construction, parameter application,
rendering, geometry access, surface queries, measurement, and fingerprinting.
It must be imported from Blender's Python runtime.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import os
import subprocess
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


REPO = Path(__file__).resolve().parents[4]
BEST_JSON = REPO / "tools/openclinxr/evidence/hair-search2/best.json"
AISHA_GLB = REPO / "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb"
HAIR_PACK = Path(os.environ.get(
    "OPENCLINXR_HAIR_EDITOR_BLEND",
    str(Path.home() / ".openclinxr-tools/haireditor/unpacked/hair/haireditor/hair.blend"),
))
MACROS = {"gender": 0.0, "age": 0.6191, "weight": 0.5024,
          "muscle": 0.5}
HAIR_ASSET = "straight_hair_to_shoulder"
PART_HALF_WIDTH = 0.0015
FRONT_Y_MARGIN = 0.02
VIEW_NAMES = ("crown_top", "crown_side", "front", "profile_90", "back_quarter")


@dataclass
class SceneHandle:
    head: object
    hair: object
    colliders: tuple
    lights: tuple
    camera: object
    basemesh: object
    target: Vector
    original_points: np.ndarray


def _track(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def _area(name, location, energy, size, target):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    _track(obj, target)
    return obj


def _load_node_groups():
    if not HAIR_PACK.exists():
        raise RuntimeError("hair pack blend not found: %s" % HAIR_PACK)
    wanted = ("Duplicate Hair Curves", "Set Hair Curve Profile")
    missing = [name for name in wanted if bpy.data.node_groups.get(name) is None]
    if missing:
        with bpy.data.libraries.load(str(HAIR_PACK), link=False) as (source, dest):
            dest.node_groups = [name for name in source.node_groups if name in missing]
    groups = tuple(bpy.data.node_groups.get(name) for name in wanted)
    if any(group is None for group in groups):
        raise RuntimeError("required hair node groups missing from %s" % HAIR_PACK)
    return groups


def _socket_identifier(group, name):
    for socket in group.interface.items_tree:
        if socket.name == name and getattr(socket, "in_out", "") == "INPUT":
            return socket.identifier
    raise RuntimeError("%s has no %s input" % (group.name, name))


def _set_modifier_input(modifier, group, name, value, required=False):
    try:
        key = _socket_identifier(group, name)
    except RuntimeError:
        if required:
            raise
        return None
    modifier[key] = value
    return key


def _delete_masked_curves(curves, doomed):
    count = len(curves.data.curves)
    attr = curves.data.attributes.new("OCLX_doomed", "BOOLEAN", "CURVE")
    attr_name = attr.name
    for index in range(count):
        attr.data[index].value = index in doomed
    group = bpy.data.node_groups.new("OCLX_mask_fringe_and_part", "GeometryNodeTree")
    group.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    group.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    source = group.nodes.new("NodeGroupInput")
    sink = group.nodes.new("NodeGroupOutput")
    named = group.nodes.new("GeometryNodeInputNamedAttribute")
    named.data_type = "BOOLEAN"
    named.inputs["Name"].default_value = attr_name
    delete = group.nodes.new("GeometryNodeDeleteGeometry")
    delete.domain = "CURVE"
    group.links.new(source.outputs[0], delete.inputs[0])
    group.links.new(named.outputs[0], delete.inputs[1])
    group.links.new(delete.outputs[0], sink.inputs[0])
    modifier = curves.modifiers.new("OCLX_mask_fringe_and_part", "NODES")
    modifier.node_group = group
    bpy.context.view_layer.objects.active = curves
    curves.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    current = curves.data.attributes.get(attr_name)
    if current is not None:
        try:
            curves.data.attributes.remove(current)
        except RuntimeError:
            # Blender can retain a required evaluated attribute; it is stable
            # scene data and does not affect the editable curve coordinates.
            pass


def _curve_array(curves):
    counts = [len(curve.points) for curve in curves.data.curves]
    if not counts or len(set(counts)) != 1:
        raise RuntimeError("editable curves do not have a single points-per-curve mode")
    result = np.empty((len(counts), counts[0], 3), dtype=np.float64)
    for ci, curve in enumerate(curves.data.curves):
        for pi, point in enumerate(curve.points):
            result[ci, pi] = point.position[:]
    return result


def _write_curve_array(curves, points):
    expected = _curve_array(curves).shape
    value = np.asarray(points, dtype=np.float64)
    if value.shape != expected or not np.isfinite(value).all():
        raise ValueError("points must be finite with shape %r, got %r" % (expected, value.shape))
    for ci, curve in enumerate(curves.data.curves):
        for pi, point in enumerate(curve.points):
            point.position = value[ci, pi]
    curves.data.update_tag()
    bpy.context.view_layer.update()


def _hair_material():
    material = bpy.data.materials.new("OCLX_hair_dark")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    hair = nodes.new("ShaderNodeBsdfHairPrincipled")
    hair.parametrization = "MELANIN"
    links.new(hair.outputs[0], output.inputs["Surface"])
    return material


def build_scene(params=None):
    """Build the single canonical scene and return its stable object handle."""
    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
    bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)

    macros = TargetService.get_default_macro_info_dict()
    macros.update(MACROS)
    basemesh = HumanService.create_human(
        mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True,
        feet_on_ground=True, scale=0.1, macro_detail_dict=macros)
    TargetService.bake_targets(basemesh)
    basemesh.name = "OCLX_collision_basemesh"
    bpy.context.view_layer.objects.active = basemesh
    bpy.ops.mpfb.setup_hair_operator()
    bpy.ops.mpfb.apply_hair_operator(hair_asset=HAIR_ASSET)
    guides = bpy.context.view_layer.objects.active
    if guides is None or guides.type != "CURVES":
        guides = bpy.data.objects.get(HAIR_ASSET)
    if guides is None or guides.type != "CURVES":
        raise RuntimeError("no curves object after apply_hair_operator")

    # The pack has 252 authoring guides.  Canonical editing starts at its
    # evaluated dense geometry, before the calibrated profile/child stack.
    depsgraph = bpy.context.evaluated_depsgraph_get()
    dense_data = guides.evaluated_get(depsgraph).data.copy()
    hair = bpy.data.objects.new("OCLX_canonical_hair", dense_data)
    bpy.context.scene.collection.objects.link(hair)
    hair.matrix_world = guides.matrix_world.copy()
    guides.hide_render = guides.hide_viewport = True

    if not AISHA_GLB.exists():
        raise RuntimeError("canonical Aisha GLB not found: %s" % AISHA_GLB)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(AISHA_GLB))
    imported = [obj for obj in bpy.data.objects if obj not in before]
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("Aisha GLB imported no mesh objects")
    head = max(meshes, key=lambda obj: len(obj.data.vertices))
    head.name = "OCLX_Aisha_head"

    for obj in bpy.data.objects:
        if obj in {hair, head}:
            continue
        lower = obj.name.lower()
        if (obj is basemesh or obj is guides or "hair" in lower or "mask" in lower
                or "helper" in lower or "glasses" in lower or "hat" in lower
                or "cap_" in lower):
            obj.hide_render = obj.hide_viewport = True
    # Imported eyes, mouth and clothing remain visible; the single largest
    # textured mesh is the evaluated surface-query head/collider.
    basemesh.hide_render = basemesh.hide_viewport = True

    world_vertices = [basemesh.matrix_world @ vertex.co for vertex in basemesh.data.vertices]
    xs = [point.x for point in world_vertices]
    ys = [point.y for point in world_vertices]
    zs = [point.z for point in world_vertices]
    crown_z = max(zs)
    head_cx = (min(xs) + max(xs)) * 0.5
    head_cy = (min(ys) + max(ys)) * 0.5
    apex_y = world_vertices[zs.index(crown_z)].y
    brow_z = None
    try:
        group_name = next((group.name for group in head.vertex_groups
                           if "eye" in group.name.lower() and "socket" in group.name.lower()), None)
        if group_name is None:
            group_name = next((group.name for group in head.vertex_groups
                               if "eye" in group.name.lower()), None)
        if group_name is not None:
            group_index = head.vertex_groups[group_name].index
            eye_points = [basemesh.matrix_world @ vertex.co for vertex in head.data.vertices
                          if any(member.group == group_index for member in vertex.groups)]
            if eye_points:
                brow_z = sum(point.z for point in eye_points) / len(eye_points)
    except Exception:
        brow_z = None
    if brow_z is None:
        eye_objects = [obj for obj in bpy.data.objects
                       if "eye" in obj.name.lower() and obj.type == "MESH"]
        if eye_objects:
            brow_z = sum(obj.matrix_world.translation.z for obj in eye_objects) / len(eye_objects)
    if brow_z is None:
        brow_z = crown_z - 0.11
    hairline_z = brow_z + 0.62 * (crown_z - brow_z)
    upper = [point for point in world_vertices if point.z > hairline_z]
    head_cy_cap = sum(point.y for point in upper) / len(upper) if upper else head_cy
    front_threshold = head_cy_cap - FRONT_Y_MARGIN
    roots = [hair.matrix_world @ hair.data.curves[index].points[0].position
             for index in range(len(hair.data.curves))]
    doomed = {
        index for index, root in enumerate(roots)
        if ((root.z < hairline_z and root.y < front_threshold)
            or (abs(root.x - head_cx) < PART_HALF_WIDTH and root.y <= apex_y))
    }
    _delete_masked_curves(hair, doomed)

    hair.data.materials.clear()
    hair.data.materials.append(_hair_material())
    duplicate, profile = _load_node_groups()
    profile_modifier = hair.modifiers.new("OCLX_hair_profile", "NODES")
    profile_modifier.node_group = profile
    _set_modifier_input(profile_modifier, profile, "Density", 1.0)
    _set_modifier_input(profile_modifier, profile, "Length", 1.0)
    _set_modifier_input(profile_modifier, profile, "Replace Radius", True)
    _set_modifier_input(profile_modifier, profile, "Radius", 0.0003, required=True)
    _set_modifier_input(profile_modifier, profile, "Shape", 0.5)
    _set_modifier_input(profile_modifier, profile, "Factor Min", 0.0)
    _set_modifier_input(profile_modifier, profile, "Factor Max", 1.0)
    duplicate_modifier = hair.modifiers.new("OCLX_dup_children", "NODES")
    duplicate_modifier.node_group = duplicate
    _set_modifier_input(duplicate_modifier, duplicate, "Amount", 4, required=True)
    _set_modifier_input(duplicate_modifier, duplicate, "Radius", 0.002, required=True)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.375
    scene.render.film_transparent = False
    scene.render.resolution_percentage = 100
    scene.cycles.seed = 0
    scene.cycles.use_denoising = True
    world = bpy.data.worlds.new("OCLX_grey_world")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.5, 0.5, 0.5, 1.0)
    background.inputs["Strength"].default_value = 0.4190625
    scene.world = world

    target = Vector((head_cx, 0.0, crown_z - 0.12))
    key = _area("OCLX_key", (head_cx - 1.2, -1.5, crown_z + 0.6), 150.0, 1.4, target)
    fill = _area("OCLX_fill", (head_cx + 1.5, -1.0, crown_z + 0.2), 40.0, 1.7, target)
    rim = _area("OCLX_rim", (head_cx + 1.0, 1.2, crown_z + 0.8), 80.0, 1.0, target)
    camera_data = bpy.data.cameras.new("OCLX_cam")
    camera_data.lens = 50.0
    camera = bpy.data.objects.new("OCLX_cam", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = (head_cx, -0.7, crown_z - 0.10)
    _track(camera, target)
    scene.camera = camera

    handle = SceneHandle(head, hair, (head, basemesh), (key, fill, rim), camera,
                         basemesh, target, _curve_array(hair).copy())
    apply_params(handle, params)
    return handle


def _best_params():
    with BEST_JSON.open() as stream:
        return json.load(stream)["params"]


def apply_params(handle, params=None):
    """Apply the complete search-round-2 vector to an existing scene."""
    values = _best_params()
    if params:
        if isinstance(params, (str, os.PathLike)):
            with open(params) as stream:
                loaded = json.load(stream)
            params = loaded.get("params", loaded)
        values.update(params)
    required = {"key_elev_deg", "key_size_m", "fill_W", "fill_elev_deg",
                "rim_W", "melanin", "redness", "roughness", "length"}
    missing = required - values.keys()
    if missing:
        raise ValueError("missing canonical parameters: %s" % sorted(missing))

    key, fill, rim = handle.lights
    key.data.size = float(values["key_size_m"])
    fill.data.energy = float(values["fill_W"])
    rim.data.energy = float(values["rim_W"])
    for light, elevation in ((key, values["key_elev_deg"]),
                             (fill, values["fill_elev_deg"])):
        dx = light.location.x - handle.target.x
        dy = light.location.y - handle.target.y
        light.location.z = handle.target.z + math.hypot(dx, dy) * math.tan(math.radians(elevation))
        _track(light, handle.target)

    material = handle.hair.data.materials.get("OCLX_hair_dark")
    node = material.node_tree.nodes.get("Principled Hair BSDF")
    if node is None:
        node = next((item for item in material.node_tree.nodes if item.type == "BSDF_HAIR_PRINCIPLED"), None)
    if node is None:
        raise RuntimeError("canonical hair shader missing")
    for name, value in (("Melanin", values["melanin"]),
                        ("Melanin Redness", values["redness"]),
                        ("Roughness", values["roughness"]),
                        ("Radial Roughness", 0.2)):
        if name in node.inputs:
            node.inputs[name].default_value = float(value)

    points = handle.original_points.copy()
    roots = points[:, :1, :]
    points = roots + (points - roots) * float(values["length"])
    _write_curve_array(handle.hair, points)
    handle.hair["OCLX_params"] = json.dumps(values, sort_keys=True)
    return values


def get_editable_points(handle):
    """Return editable hair points as (N,P,3) float64 in head-local axes."""
    local = _curve_array(handle.hair)
    transform = handle.head.matrix_world.inverted() @ handle.hair.matrix_world
    flat = np.asarray([transform @ Vector(point) for point in local.reshape(-1, 3)])
    return flat.reshape(local.shape).astype(np.float64, copy=False)


def set_editable_points(handle, pts):
    """Set editable hair points supplied in head-local axes."""
    value = np.asarray(pts, dtype=np.float64)
    transform = handle.hair.matrix_world.inverted() @ handle.head.matrix_world
    flat = np.asarray([transform @ Vector(point) for point in value.reshape(-1, 3)])
    _write_curve_array(handle.hair, flat.reshape(value.shape))


def surface_distance(handle, pts):
    """Return signed nearest-surface distance and normals for head-frame points."""
    value = np.asarray(pts, dtype=np.float64)
    if value.shape[-1] != 3 or not np.isfinite(value).all():
        raise ValueError("pts must be finite (...,3) coordinates")
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = handle.head.evaluated_get(depsgraph)
    bvh = BVHTree.FromObject(handle.head, depsgraph, deform=True, cage=False)
    head_to_eval = evaluated.matrix_world.inverted() @ handle.head.matrix_world
    eval_to_head_normal = handle.head.matrix_world.inverted().to_3x3() @ evaluated.matrix_world.to_3x3()
    distances = np.empty(value.shape[:-1], dtype=np.float64)
    normals = np.empty(value.shape, dtype=np.float64)
    for index in np.ndindex(value.shape[:-1]):
        query = head_to_eval @ Vector(value[index])
        nearest, normal, _face, _distance = bvh.find_nearest(query)
        if nearest is None:
            raise RuntimeError("BVHTree.find_nearest returned no surface")
        signed = (query - nearest).dot(normal)
        distances[index] = math.copysign((query - nearest).length, signed)
        transformed = (eval_to_head_normal @ normal).normalized()
        normals[index] = transformed[:]
    return distances, normals


def _set_view(handle, view):
    camera = handle.camera
    target = handle.target
    radius = (camera.location - target).length
    if view == "front":
        camera.location = target + Vector((0.0, -radius, 0.02))
    elif view == "profile_90":
        camera.location = target + Vector((radius, 0.0, 0.02))
    elif view == "back_quarter":
        angle = math.radians(135.0)
        camera.location = target + Vector((radius * math.sin(angle), -radius * math.cos(angle), 0.04))
    elif view == "crown_top":
        camera.location = target + Vector((0.0, -0.10, radius))
    elif view == "crown_side":
        camera.location = target + Vector((radius * 0.85, 0.0, radius * 0.52))
    else:
        raise ValueError("unknown view %r; expected one of %s" % (view, VIEW_NAMES))
    _track(camera, target)


def _render_id(handle, path, size):
    scene = bpy.context.scene
    hidden = {obj.name: obj.hide_render for obj in scene.objects}
    materials = {}
    old_world = scene.world
    old_transparent = scene.render.film_transparent
    data = handle.hair.evaluated_get(bpy.context.evaluated_depsgraph_get()).data.copy()
    if hasattr(data, "surface"):
        data.surface = None
    hair = bpy.data.objects.new("OCLX_hair_id_curves_only", data)
    scene.collection.objects.link(hair)
    hair.matrix_world = handle.hair.matrix_world.copy()
    emission = bpy.data.materials.get("OCLX_hair_id") or bpy.data.materials.new("OCLX_hair_id")
    emission.use_nodes = True
    emission.node_tree.nodes.clear()
    output = emission.node_tree.nodes.new("ShaderNodeOutputMaterial")
    shader = emission.node_tree.nodes.new("ShaderNodeEmission")
    shader.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    emission.node_tree.links.new(shader.outputs[0], output.inputs["Surface"])
    holdout = bpy.data.materials.get("OCLX_id_holdout") or bpy.data.materials.new("OCLX_id_holdout")
    holdout.use_nodes = True
    holdout.node_tree.nodes.clear()
    output = holdout.node_tree.nodes.new("ShaderNodeOutputMaterial")
    shader = holdout.node_tree.nodes.new("ShaderNodeHoldout")
    holdout.node_tree.links.new(shader.outputs[0], output.inputs["Surface"])
    id_world = bpy.data.worlds.get("OCLX_id_world") or bpy.data.worlds.new("OCLX_id_world")
    id_world.use_nodes = True
    id_world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
    try:
        for obj in scene.objects:
            if obj is hair:
                obj.hide_render = False
            elif obj.type == "MESH" and not hidden.get(obj.name, False):
                materials[obj.name] = list(obj.data.materials)
                obj.data.materials.clear()
                obj.data.materials.append(holdout)
                obj.hide_render = False
            elif obj.type in {"CURVES", "CURVE", "SURFACE", "META", "FONT"}:
                obj.hide_render = True
        hair.data.materials.clear()
        hair.data.materials.append(emission)
        scene.world = id_world
        scene.render.film_transparent = True
        scene.cycles.samples = 16
        scene.render.resolution_x = scene.render.resolution_y = size
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
    finally:
        bpy.data.objects.remove(hair, do_unlink=True)
        for name, saved in materials.items():
            obj = bpy.data.objects.get(name)
            if obj:
                obj.data.materials.clear()
                for material in saved:
                    obj.data.materials.append(material)
        for name, state in hidden.items():
            obj = bpy.data.objects.get(name)
            if obj:
                obj.hide_render = state
        scene.world = old_world
        scene.render.film_transparent = old_transparent


def render_views(handle, out_dir, size=1024, samples=64, views=("front",)):
    """Render requested beauty views and matching hair-only ID masks."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    results = {}
    for view in views:
        _set_view(handle, view)
        beauty = out / (view + ".png")
        id_path = out / (view + "-id.png")
        scene.render.resolution_x = scene.render.resolution_y = int(size)
        scene.cycles.samples = int(samples)
        scene.cycles.seed = 0
        scene.render.film_transparent = False
        scene.render.filepath = str(beauty)
        bpy.ops.render.render(write_still=True)
        _render_id(handle, id_path, int(size))
        results[view] = {"png": str(beauty), "id_png": str(id_path)}
    return results


def measure(png, id_png):
    """Measure beauty pixels under the opaque hair ID mask."""
    from PIL import Image
    rgb = np.asarray(Image.open(png).convert("RGB"), dtype=np.float64) / 255.0
    rgba = np.asarray(Image.open(id_png).convert("RGBA"), dtype=np.float64) / 255.0
    mask = rgba[..., 3] >= 0.9
    luminance = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    values = luminance[mask]
    percentiles = np.percentile(values, [10, 50, 90]) if values.size else (0.0, 0.0, 0.0)
    selected = rgb[mask]
    rb = float(selected[:, 0].mean() / max(selected[:, 2].mean(), 1e-12)) if len(selected) else 0.0
    spread = float((selected[:, 0] - selected[:, 2]).mean()) if len(selected) else 0.0
    height, width = luminance.shape
    face = luminance[int(height * .25):int(height * .70), int(width * .30):int(width * .70)]
    face = face[face > .30]
    corner = min(32, height, width)
    background = np.mean([
        luminance[:corner, :corner].mean(), luminance[:corner, -corner:].mean(),
        luminance[-corner:, :corner].mean(), luminance[-corner:, -corner:].mean(),
    ])
    return {"p10": float(percentiles[0]), "p50": float(percentiles[1]),
            "p90": float(percentiles[2]), "R/B": rb, "maskPx": int(mask.sum()),
            "meanRMinusBSpread": spread,
            "faceLuminance": float(face.mean()) if face.size else 0.0,
            "backgroundLuminance": float(background)}


def _curve_signature(curves_data):
    counts = [len(curve.points) for curve in curves_data.curves]
    if not counts:
        return {"curveCount": 0, "pointsPerCurveMode": 0}
    values, frequency = np.unique(np.asarray(counts), return_counts=True)
    mode = int(values[np.argmax(frequency)])
    return {"curveCount": len(counts), "pointsPerCurveMode": mode}


def fingerprint(handle):
    """Return the complete comparison-scene identity as JSON-safe values."""
    editable = _curve_signature(handle.hair.data)
    evaluated = handle.hair.evaluated_get(bpy.context.evaluated_depsgraph_get())
    final = _curve_signature(evaluated.data)
    source_hash = subprocess.run(
        ["git", "hash-object", str(Path(__file__).resolve())], cwd=REPO,
        check=True, capture_output=True, text=True).stdout.strip()
    with BEST_JSON.open() as stream:
        params = json.load(stream)["params"]
    params_hash = hashlib.sha256(json.dumps(
        params, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    scene = bpy.context.scene
    background = scene.world.node_tree.nodes.get("Background")
    return {
        "headObjectName": handle.head.name,
        "headVertexCount": len(handle.head.data.vertices),
        "hairObjectName": handle.hair.name,
        "editableGeometry": editable,
        "evaluatedGeometry": final,
        "modifierStack": [modifier.name for modifier in handle.hair.modifiers],
        "lights": [{"name": light.name, "energy": float(light.data.energy)}
                   for light in handle.lights],
        "cameraMatrixWorld": [[float(value) for value in row]
                              for row in handle.camera.matrix_world],
        "cameraFocalLength": float(handle.camera.data.lens),
        "worldStrength": float(background.inputs["Strength"].default_value),
        "viewTransform": scene.view_settings.view_transform,
        "exposure": float(scene.view_settings.exposure),
        "materialNames": sorted(material.name for material in bpy.data.materials),
        "moduleGitSha": source_hash,
        "bestParamsSha256": params_hash,
    }
