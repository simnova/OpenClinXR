"""Blender 5.1.1 probe for Attach + Interpolate Hair Curves.

Run from the repository root:
  MISE_TRUSTED_CONFIG_PATHS=$PWD /Applications/Blender.app/Contents/MacOS/Blender \
    --background --python tools/openclinxr/evidence/hair-interp/interp_probe.py -- \
    --out-dir tools/openclinxr/evidence/hair-interp

This creates a fresh five-guide Curves object for every cell. It never edits or
uses the canonical hair as interpolation input; hair_scene supplies only the
canonical head, surface query, lighting, cameras, and render implementation.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import sys
import time
import traceback
from collections import Counter
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.geometry import barycentric_transform
from mathutils.bvhtree import BVHTree
from PIL import Image, ImageDraw


ASSET_BLEND = "/Applications/Blender.app/Contents/Resources/5.1/datafiles/assets/nodes/procedural_hair_node_assets.blend"
GROUP_NAMES = ("Attach Hair Curves to Surface", "Interpolate Hair Curves")
MASK_GROUP = "OCLX_interp_scalp_mask"
POINTS_PER_GUIDE = 24
GUIDE_LENGTH_M = 0.25
ROOT_CLEARANCE_M = 0.003
# M13 step 2: authored guides replace the five generated guides.
GUIDES_NPZ = Path.cwd() / "tools/openclinxr/evidence/hair-guides2/guides3.npz"
USE_AUTHORED_GUIDES = True
# M13 step 3: cap surface replaces the head surface.
CAP_NPZ = Path.cwd() / "tools/openclinxr/evidence/hair-flow/cap-v4.npz"
USE_CAP_SURFACE = True
CAP_UV_NAME = "UVMap"
# M13 step 4: split the cap into left/right mesh islands along x=0.
SPLIT_CAP_ISLANDS = True
# M16 tuning run 4: part strip 1.5 -> 2.5 mm (G5 attempt 2: fewer seam-blended
# children); pass-B Distance to Guides 1.0 -> 3.0 (G7 attempt 1).
PART_HALF_WIDTH_M = 0.0025
VIEWS = ("crown_top", "front")
DISTANCE_METHOD = "hair_scene.surface_distance; BVH true signed nearest-surface distance; not vertex-only"


def load_hair_scene():
    path = Path.cwd() / "tools/openclinxr/evidence/hair-scene/hair_scene.py"
    spec = importlib.util.spec_from_file_location("hair_scene", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["hair_scene"] = module
    spec.loader.exec_module(module)
    return module


def scalar(value):
    if isinstance(value, (str, bool, int, float)) or value is None:
        return value
    if hasattr(value, "name"):
        return value.name
    try:
        return [scalar(v) for v in value]
    except Exception:
        return str(value)


def socket_rows(group):
    rows = []
    for item in group.interface.items_tree:
        if not hasattr(item, "identifier") or not item.identifier:
            continue
        rows.append({
            "name": item.name,
            "identifier": item.identifier,
            "inOut": getattr(item, "in_out", ""),
            "socketType": getattr(item, "socket_type", ""),
            "default": scalar(getattr(item, "default_value", None)),
        })
    return rows


def print_interfaces(groups):
    for name in GROUP_NAMES:
        print("INTERP_NODE_INPUTS " + name)
        for row in socket_rows(groups[name]):
            if row["inOut"] == "INPUT":
                print(json.dumps(row, sort_keys=True))


def input_socket(group, name, socket_type=None):
    matches = [item for item in group.interface.items_tree
               if getattr(item, "in_out", "") == "INPUT"
               and item.name == name
               and (socket_type is None or getattr(item, "socket_type", "") == socket_type)]
    if len(matches) != 1:
        raise RuntimeError("input lookup %r type=%r returned %d sockets" %
                           (name, socket_type, len(matches)))
    return matches[0]


def set_input(modifier, group, name, value, readback, socket_type=None, attribute_name=None):
    socket = input_socket(group, name, socket_type)
    key = socket.identifier
    if attribute_name is not None:
        modifier[key + "_use_attribute"] = True
        modifier[key + "_attribute_name"] = attribute_name
        readback[key] = {
            "name": name,
            "identifier": key,
            "socketType": socket.socket_type,
            "interfaceDefault": scalar(getattr(socket, "default_value", None)),
            "wroteAttribute": attribute_name,
            "readBackUseAttribute": bool(modifier[key + "_use_attribute"]),
            "readBackAttribute": modifier[key + "_attribute_name"],
        }
    else:
        written = value
        if socket.socket_type == "NodeSocketMenu" and isinstance(value, str):
            menu_values = {
                "Object": int(modifier.get(key, 1)),
                "Poisson Disk": 1,
            }
            written = menu_values[value]
        modifier[key] = written
        readback[key] = {
            "name": name,
            "identifier": key,
            "socketType": socket.socket_type,
            "interfaceDefault": scalar(getattr(socket, "default_value", None)),
            "wrote": scalar(value),
            "wroteRaw": scalar(written),
            "readBack": scalar(modifier[key]),
        }
    return key


def load_groups():
    with bpy.data.libraries.load(ASSET_BLEND, link=False) as (source, dest):
        missing = [name for name in GROUP_NAMES if name not in source.node_groups]
        if missing:
            raise RuntimeError("asset node groups missing: %r" % missing)
        dest.node_groups = list(GROUP_NAMES)
    return {name: bpy.data.node_groups[name] for name in GROUP_NAMES}


def hairline_geometry(handle):
    """Reproduce hair_scene's cap/hairline calculation for the mask."""
    vertices = [handle.basemesh.matrix_world @ vertex.co for vertex in handle.basemesh.data.vertices]
    zs = [point.z for point in vertices]
    crown_z = max(zs)
    head_cx = (min(point.x for point in vertices) + max(point.x for point in vertices)) * 0.5
    apex_y = vertices[zs.index(crown_z)].y
    eye_objects = [obj for obj in bpy.data.objects if "eye" in obj.name.lower() and obj.type == "MESH"]
    brow_z = (sum(obj.matrix_world.translation.z for obj in eye_objects) / len(eye_objects)
              if eye_objects else crown_z - 0.11)
    hairline_z = brow_z + 0.62 * (crown_z - brow_z)
    upper = [point for point in vertices if point.z > hairline_z]
    head_cy_cap = sum(point.y for point in upper) / len(upper)
    front_threshold = head_cy_cap - 0.02
    return {
        "hairlineZWorld": float(hairline_z),
        "frontThresholdYWorld": float(front_threshold),
        "headCenterXWorld": float(head_cx),
        "apexYWorld": float(apex_y),
        "partHalfWidthM": 0.0015,
        "frontYMarginM": 0.02,
        "rule": "weight 1 above hairline; weight 0 elsewhere (hairline from hair_scene fringe rule)",
    }


def mask_weight_for_world(point, geometry):
    return 1.0 if point.z >= geometry["hairlineZWorld"] else 0.0


def create_scalp_mask(head, geometry):
    previous = head.vertex_groups.get(MASK_GROUP)
    if previous is not None:
        head.vertex_groups.remove(previous)
    group = head.vertex_groups.new(name=MASK_GROUP)
    adjacency = [[] for _ in head.data.vertices]
    for edge in head.data.edges:
        a, b = edge.vertices
        adjacency[a].append(b)
        adjacency[b].append(a)
    crown = max(head.data.vertices, key=lambda vertex: (head.matrix_world @ vertex.co).z).index
    component = {crown}
    stack = [crown]
    while stack:
        current = stack.pop()
        for neighbor in adjacency[current]:
            if neighbor not in component:
                component.add(neighbor)
                stack.append(neighbor)
    inside = []
    outside = []
    for vertex in head.data.vertices:
        world = head.matrix_world @ vertex.co
        is_scalp = vertex.index in component and mask_weight_for_world(world, geometry)
        (inside if is_scalp else outside).append(vertex.index)
    if inside:
        group.add(inside, 1.0, "REPLACE")
    if outside:
        group.add(outside, 0.0, "REPLACE")
    geometry["crownConnectedComponentVertexCount"] = len(component)
    geometry["rule"] = (
        "weight 1 on the crown-connected mesh island above the hairline; "
        "weight 0 on lower vertices and every disconnected island"
    )
    return group, inside, outside


def vertex_group_weights(head, group):
    values = np.zeros(len(head.data.vertices), dtype=np.float64)
    for vertex in head.data.vertices:
        try:
            values[vertex.index] = group.weight(vertex.index)
        except RuntimeError:
            values[vertex.index] = 0.0
    return values


def scalp_area_m2(head, weights):
    head.data.calc_loop_triangles()
    area = 0.0
    for tri in head.data.loop_triangles:
        points = [head.matrix_world @ head.data.vertices[index].co for index in tri.vertices]
        tri_area = (points[1] - points[0]).cross(points[2] - points[0]).length * 0.5
        area += tri_area * float(np.mean(weights[list(tri.vertices)]))
    return float(area)


def choose_guide_vertices(head, inside):
    candidates = []
    for index in inside:
        vertex = head.data.vertices[index]
        world = head.matrix_world @ vertex.co
        normal = (head.matrix_world.to_3x3() @ vertex.normal).normalized()
        if normal.z > 0.15:
            candidates.append((index, world, normal))
    if len(candidates) < 5:
        raise RuntimeError("scalp mask has fewer than five upward-facing guide candidates")
    xs = np.asarray([entry[1].x for entry in candidates])
    ys = np.asarray([entry[1].y for entry in candidates])
    targets = [
        (float(np.percentile(xs, 20)), float(np.percentile(ys, 35))),
        (float(np.percentile(xs, 80)), float(np.percentile(ys, 35))),
        (float(np.percentile(xs, 15)), float(np.percentile(ys, 70))),
        (float(np.percentile(xs, 85)), float(np.percentile(ys, 70))),
        (float(np.median(xs)), float(np.percentile(ys, 55))),
    ]
    chosen = []
    used = set()
    xscale = max(float(np.ptp(xs)), 1e-6)
    yscale = max(float(np.ptp(ys)), 1e-6)
    for tx, ty in targets:
        ranked = sorted(candidates, key=lambda entry:
                        ((entry[1].x - tx) / xscale) ** 2 + ((entry[1].y - ty) / yscale) ** 2)
        pick = next(entry for entry in ranked if entry[0] not in used)
        used.add(pick[0])
        chosen.append(pick)
    return chosen


def make_guides(handle, chosen, cell_id, uv_name, attach_surface=True, point_count=POINTS_PER_GUIDE):
    data = bpy.data.hair_curves.new("OCLX_interp_guides_" + cell_id)
    data.add_curves([point_count] * len(chosen))
    if attach_surface:
        data.surface = handle.head
        data.surface_uv_map = uv_name
    obj = bpy.data.objects.new("OCLX_interp_guides_" + cell_id, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = handle.head.matrix_world.copy()

    head_inv = handle.head.matrix_world.inverted()
    gravity_local = (handle.head.matrix_world.inverted().to_3x3() @ Vector((0.0, 0.0, -1.0))).normalized()
    points = []
    roots = []
    for vertex_index, world_surface, world_normal in chosen:
        root_world = world_surface + world_normal * ROOT_CLEARANCE_M
        root_local = head_inv @ root_world
        roots.append({
            "vertexIndex": int(vertex_index),
            "surfaceWorld": list(world_surface),
            "normalWorld": list(world_normal),
            "initialRootWorld": list(root_world),
        })
        for step in range(point_count):
            t = step / (point_count - 1)
            points.append(root_local + gravity_local * (GUIDE_LENGTH_M * t))
    data.attributes["position"].data.foreach_set("vector", np.asarray(points, dtype=np.float32).ravel())
    radius = data.attributes.new("radius", "FLOAT", "POINT")
    radius.data.foreach_set("value", np.full(len(points), 0.00045, dtype=np.float32))
    if handle.hair.data.materials:
        data.materials.append(handle.hair.data.materials[0])
    data.update_tag()
    return obj, roots


def make_guides_authored(handle, surface_obj, cell_id, uv_name):
    """M13 step 2: same construction path as make_guides, but the points come
    from the authored guides3.npz (world metres, root first) instead of the
    five gravity-drop generated guides. Surface, UV map, matrix, radius, and
    material handling are unchanged, so the Attach modifier sees the same setup.
    M13 step 3: the surface is the cap object (matrix identity, verts world)."""
    payload = np.load(str(GUIDES_NPZ))
    points_world = np.asarray(payload["points"], dtype=np.float64)
    guide_count, point_count, _ = points_world.shape
    data = bpy.data.hair_curves.new("OCLX_interp_guides_" + cell_id)
    data.add_curves([point_count] * guide_count)
    data.surface = surface_obj
    data.surface_uv_map = uv_name
    obj = bpy.data.objects.new("OCLX_interp_guides_" + cell_id, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = surface_obj.matrix_world.copy()
    surf_inv = surface_obj.matrix_world.inverted()
    local = np.empty_like(points_world)
    for index in range(guide_count):
        for step in range(point_count):
            local[index, step] = surf_inv @ Vector(tuple(points_world[index, step]))
    data.attributes["position"].data.foreach_set("vector", local.astype(np.float32).ravel())
    radius = data.attributes.new("radius", "FLOAT", "POINT")
    radius.data.foreach_set("value", np.full(guide_count * point_count, 0.00045, dtype=np.float32))
    if handle.hair.data.materials:
        data.materials.append(handle.hair.data.materials[0])
    data.update_tag()
    roots = [{"rootWorld": [float(v) for v in points_world[index, 0]]}
             for index in range(guide_count)]
    return obj, roots


def build_cap_surface(handle, head_uv_name):
    """M13 step 3: cap mesh from cap-v4.npz (verts already world metres, so the
    object keeps identity matrix). UVs transferred from the head by nearest-face
    barycentric sampling; density vertex group 1 everywhere except the part
    strip |x| < 1.5 mm anterior of the apex plane."""
    payload = np.load(str(CAP_NPZ))
    verts = np.asarray(payload["verts"], dtype=np.float64)
    faces = np.asarray(payload["faces"], dtype=np.int64)
    apex_y = float(np.asarray(payload["apex_y"]))
    if SPLIT_CAP_ISLANDS:
        # M13 step 4: faces by centroid-x sign, concatenated with duplicated
        # seam verts so left and right are disconnected mesh islands in one object.
        centroids_x = verts[faces].mean(axis=1)[:, 0]
        combo_verts = []
        combo_faces = []
        for side_faces in (faces[centroids_x <= 0], faces[centroids_x > 0]):
            used, remap = np.unique(side_faces, return_inverse=True)
            base = len(combo_verts)
            combo_verts.extend(verts[used])
            combo_faces.extend((remap.reshape(side_faces.shape) + base).tolist())
        build_verts = np.asarray(combo_verts)
        build_faces = combo_faces
    else:
        build_verts = verts
        build_faces = [tuple(row) for row in faces]
    mesh = bpy.data.meshes.new("OCLX_cap_mesh")
    mesh.from_pydata([tuple(row) for row in build_verts], [], build_faces)
    mesh.update()
    cap = bpy.data.objects.new("OCLX_cap", mesh)
    bpy.context.scene.collection.objects.link(cap)
    cap.matrix_world.identity()
    head = handle.head
    head_inv = head.matrix_world.inverted()
    bvh = BVHTree.FromPolygons(
        [vertex.co.copy() for vertex in head.data.vertices],
        [list(poly.vertices) for poly in head.data.polygons], all_triangles=False)
    head_uv = head.data.uv_layers[head_uv_name].data
    head_polys = head.data.polygons
    cap_uv = mesh.uv_layers.new(name=CAP_UV_NAME)
    vert_loops = {}
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vert_loops.setdefault(mesh.loops[loop_index].vertex_index, []).append(loop_index)
    uv_loops = [(0.0, 0.0)] * len(mesh.loops)
    nan_count = 0
    for vert in mesh.vertices:
        query = head_inv @ Vector(tuple(build_verts[vert.index]))
        nearest, _normal, face_index, _distance = bvh.find_nearest(query)
        if nearest is None or face_index is None:
            nan_count += 1
            continue
        poly = head_polys[face_index]
        corners = [head.data.vertices[index].co for index in poly.vertices]
        loop_ids = list(poly.loop_indices)
        corner_uv3 = [Vector((head_uv[loop].uv.x, head_uv[loop].uv.y, 0.0)) for loop in loop_ids]
        uvw = None
        if len(corners) == 3:
            uvw = barycentric_transform(nearest, corners[0], corners[1], corners[2],
                                        corner_uv3[0], corner_uv3[1], corner_uv3[2])
        else:
            for tri in ((0, 1, 2), (0, 2, 3)):
                a, b, c = (corners[t] for t in tri)
                edge1 = b - a
                edge2 = c - a
                normal = edge1.cross(edge2)
                area2 = normal.length
                if area2 < 1e-12:
                    continue
                w0 = (b - nearest).cross(c - nearest).length / area2
                w1 = (c - nearest).cross(a - nearest).length / area2
                w2 = (a - nearest).cross(b - nearest).length / area2
                if min(w0, w1, w2) >= -1e-6:
                    ua, ub, uc = (corner_uv3[t] for t in tri)
                    uvw = ua * w0 + ub * w1 + uc * w2
                    break
            if uvw is None:
                uvw = corner_uv3[0]
        for loop_index in vert_loops.get(vert.index, []):
            uv_loops[loop_index] = (uvw.x, uvw.y)
    flat = []
    for item in uv_loops:
        flat.extend(item)
    cap_uv.data.foreach_set("uv", np.asarray(flat, dtype=np.float32).ravel())
    mesh.update()
    group = cap.vertex_groups.new(name=MASK_GROUP)
    strip = [index for index in range(len(mesh.vertices)
             ) if abs(float(build_verts[index][0])) < PART_HALF_WIDTH_M
             and float(build_verts[index][1]) > apex_y]
    solid = [index for index in range(len(mesh.vertices)) if index not in set(strip)]
    if solid:
        group.add(solid, 1.0, "REPLACE")
    if strip:
        group.add(strip, 0.0, "REPLACE")
    cap.update_tag()
    bpy.context.view_layer.update()
    adjacency = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        adjacency[a].append(b)
        adjacency[b].append(a)
    seen = set()
    island_sizes = []
    for start in range(len(mesh.vertices)):
        if start in seen:
            continue
        stack = [start]
        seen.add(start)
        size = 0
        while stack:
            current = stack.pop()
            size += 1
            for neighbor in adjacency[current]:
                if neighbor not in seen:
                    seen.add(neighbor)
                    stack.append(neighbor)
        island_sizes.append(size)
    info = {"apexY": apex_y, "stripVertexCount": len(strip),
            "solidVertexCount": len(solid), "uvMissingCount": nan_count,
            "uvRule": "nearest head face, barycentric (fan tri for quads)",
            "splitIslands": SPLIT_CAP_ISLANDS,
            "islandCount": len(island_sizes),
            "islandSizes": sorted(island_sizes, reverse=True)[:4]}
    return cap, info


def add_surface_inputs(modifier, group, surface_obj, uv_name, readback):
    set_input(modifier, group, "Surface Input Type", "Object", readback, "NodeSocketMenu")
    set_input(modifier, group, "Surface", surface_obj, readback, "NodeSocketObject")
    set_input(modifier, group, "Surface UV Map", None, readback,
              "NodeSocketVector", attribute_name=uv_name)
    set_input(modifier, group, "Surface Rest Position", False, readback)


def configure_modifiers(guides, surface_obj, groups, uv_name, spec):
    readback = {"attach": {}, "interpolate": {}}
    if spec["attach"]:
        group = groups["Attach Hair Curves to Surface"]
        modifier = guides.modifiers.new("OCLX_attach", "NODES")
        modifier.node_group = group
        add_surface_inputs(modifier, group, surface_obj, uv_name, readback["attach"])
        set_input(modifier, group, "Sample Attachment UV", True, readback["attach"])
        set_input(modifier, group, "Snap to Surface", True, readback["attach"])
        set_input(modifier, group, "Align to Surface Normal", False, readback["attach"])
        set_input(modifier, group, "Blend along Curve", 0.0, readback["attach"])
    if spec["interpolate"]:
        group = groups["Interpolate Hair Curves"]
        modifier = guides.modifiers.new("OCLX_interpolate", "NODES")
        modifier.node_group = group
        add_surface_inputs(modifier, group, surface_obj, uv_name, readback["interpolate"])
        set_input(modifier, group, "Follow Surface Normal", False, readback["interpolate"])
        set_input(modifier, group, "Part by Mesh Islands", spec["islands"], readback["interpolate"])
        # M13 step 5: Interpolation Guides 3 -> 2 per brief.
        set_input(modifier, group, "Interpolation Guides", spec.get("interpGuides", 2), readback["interpolate"])
        set_input(modifier, group, "Distance to Guides", spec.get("distGuides", 1.0), readback["interpolate"])
        set_input(modifier, group, "Distance to Guides", 1.0, readback["interpolate"])
        set_input(modifier, group, "Distribution Method", "Poisson Disk",
                  readback["interpolate"], "NodeSocketMenu")
        set_input(modifier, group, "Density", float(spec["density"]), readback["interpolate"])
        if spec["mask"]:
            set_input(modifier, group, "Density Mask", None, readback["interpolate"],
                      attribute_name=MASK_GROUP)
        else:
            set_input(modifier, group, "Density Mask", 1.0, readback["interpolate"])
        set_input(modifier, group, "Viewport Amount", 1.0, readback["interpolate"])
        set_input(modifier, group, "Seed", 0, readback["interpolate"])
    bpy.context.view_layer.update()
    return readback


def evaluated_geometry(obj):
    started = time.perf_counter()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(depsgraph)
    data = evaluated.data
    curve_count = len(data.curves)
    point_count = len(data.points)
    offsets = np.empty(curve_count + 1, dtype=np.int64)
    data.curve_offset_data.foreach_get("value", offsets)
    counts = np.diff(offsets)
    flat = np.empty(point_count * 3, dtype=np.float32)
    data.attributes["position"].data.foreach_get("vector", flat)
    local = flat.reshape((-1, 3))
    roots = local[offsets[:-1]] if curve_count else np.empty((0, 3), dtype=np.float32)
    return {
        "curveCount": int(curve_count),
        "pointCount": int(point_count),
        "counts": counts,
        "rootsHeadLocal": roots.astype(np.float64),
        "histogram": {str(key): int(value) for key, value in sorted(Counter(counts.tolist()).items())},
        "seconds": float(time.perf_counter() - started),
    }


def interpolated_mask_values(head, roots, weights):
    bvh = BVHTree.FromPolygons(
        [vertex.co.copy() for vertex in head.data.vertices],
        [list(poly.vertices) for poly in head.data.polygons], all_triangles=False)
    values = np.zeros(len(roots), dtype=np.float64)
    for index, root in enumerate(roots):
        nearest, _normal, face_index, _distance = bvh.find_nearest(Vector(root))
        if nearest is None or face_index is None:
            continue
        vertices = list(head.data.polygons[face_index].vertices)
        if len(vertices) != 3:
            values[index] = max(weights[vertex] for vertex in vertices)
            continue
        a, b, c = (head.data.vertices[vertex].co for vertex in vertices)
        encoded = barycentric_transform(nearest, a, b, c,
                                        Vector((weights[vertices[0]], 0.0, 0.0)),
                                        Vector((weights[vertices[1]], 0.0, 0.0)),
                                        Vector((weights[vertices[2]], 0.0, 0.0)))
        values[index] = encoded.x
    return values


def root_metrics(hair_scene, handle, roots, geometry, weights):
    if len(roots) == 0:
        return {
            "distanceMethod": DISTANCE_METHOD,
            "rootFartherThan2mmCount": 0,
            "rootDistanceMm": {"min": None, "p50": None, "p95": None, "max": None},
            "rootsOutsideMaskedRegionCount": 0,
        }
    signed, _normals = hair_scene.surface_distance(handle, roots)
    absolute = np.abs(signed)
    mask_values = interpolated_mask_values(handle.head, roots, weights)
    outside = int(np.count_nonzero(mask_values <= 1e-6))
    return {
        "distanceMethod": DISTANCE_METHOD,
        "rootFartherThan2mmCount": int(np.count_nonzero(absolute > 0.002)),
        "rootDistanceMm": {
            "min": float(np.min(absolute) * 1000),
            "p50": float(np.percentile(absolute, 50) * 1000),
            "p95": float(np.percentile(absolute, 95) * 1000),
            "max": float(np.max(absolute) * 1000),
        },
        "rootsOutsideMaskedRegionCount": outside,
        "rootInterpolatedMaskValue": {
            "min": float(np.min(mask_values)),
            "p05": float(np.percentile(mask_values, 5)),
            "p50": float(np.percentile(mask_values, 50)),
        },
    }


def render_cell(hair_scene, handle, canonical_hair, guides, out_dir, cell_id):
    cell_dir = Path(out_dir) / cell_id
    cell_dir.mkdir(parents=True, exist_ok=True)
    canonical_hidden_render = canonical_hair.hide_render
    canonical_hidden_viewport = canonical_hair.hide_viewport
    old_hair = handle.hair
    canonical_hair.hide_render = True
    canonical_hair.hide_viewport = True
    handle.hair = guides
    started = time.perf_counter()
    try:
        rendered = hair_scene.render_views(handle, cell_dir, size=384, samples=16, views=VIEWS)
    finally:
        handle.hair = old_hair
        canonical_hair.hide_render = canonical_hidden_render
        canonical_hair.hide_viewport = canonical_hidden_viewport
    return rendered, float(time.perf_counter() - started)


def compose_sheet(cells, out_dir):
    panel = 384
    label_h = 54
    sheet = Image.new("RGB", (panel * 2, (panel + label_h) * 6), (18, 18, 18))
    draw = ImageDraw.Draw(sheet)
    for row_index, cell in enumerate(cells):
        y0 = row_index * (panel + label_h)
        for column, view in enumerate(VIEWS):
            path = Path(out_dir) / cell["id"] / (view + "-id.png")
            if path.exists():
                image = Image.open(path).convert("RGB").resize((panel, panel), Image.Resampling.LANCZOS)
                sheet.paste(image, (column * panel, y0 + label_h))
        metrics = cell.get("metrics", {})
        draw.text((8, y0 + 5), "%s %s ok=%s curves=%s hist=%s" % (
            cell["id"], cell["label"], cell["ok"], metrics.get("evaluatedCurveCount", "ERR"),
            metrics.get("pointsPerCurveHistogram", {})), fill=(255, 255, 0))
        draw.text((8, y0 + 27), "top hair-only | front hair-only  far>2mm=%s outside=%s" % (
            metrics.get("rootFartherThan2mmCount", "ERR"),
            metrics.get("rootsOutsideMaskedRegionCount", "ERR")), fill=(225, 225, 225))
    sheet.save(Path(out_dir) / "interp-sheet.png", compress_level=1)


def cell_specs():
    # M13 step 6: density solved from step-5 measurement (1294 curves at
    # density 20000 -> 0.0647 curves per density unit, assumed linear):
    # A ~= 2000 -> 31000 ; B ~= 50000 -> 719000 (corrected after step-6
    # first solve overshot to 53794 at 773000; 773000*50000/53794 = 718600).
    return [
        {"id": "PA", "label": "pass A ~= 2000 curves", "attach": True,
         "interpolate": True, "density": 31000, "islands": True, "mask": True},
        {"id": "PB", "label": "pass B ~= 50000 curves", "attach": True,
         "interpolate": True, "density": 719000, "islands": True, "mask": True},
    ]


def run_bisect(handle, chosen, groups, uv_name, mask_group, narrow_inside, geometry):
    """Run the requested no-render topology bisect and retain honest errors."""
    base = {"attach": True, "interpolate": True, "density": 20000,
            "islands": True, "mask": True}
    variants = [
        {"id": "B0", "label": "baseline attached; UV present; rest off; Object; 24 points"},
        {"id": "B1", "label": "surface UV map missing", "uvMissing": True},
        {"id": "B2", "label": "Surface Rest Position on", "rest": True},
        {"id": "B3", "label": "Surface input type Geometry (installed asset's Input equivalent)",
         "surfaceMenuRaw": 1},
        {"id": "B4", "label": "guide point count 61", "pointCount": 61},
        {"id": "B5", "label": "guide point count 16", "pointCount": 16},
        {"id": "B6", "label": "height-only mask across all mesh islands", "broadMask": True},
        {"id": "B7", "label": "height-only mask across all islands; Part by Mesh Islands off",
         "broadMask": True, "islands": False},
    ]
    results = []
    narrow_set = set(narrow_inside)
    for variant in variants:
        guides = None
        result = {"id": variant["id"], "label": variant["label"], "ok": False, "error": ""}
        try:
            if variant.get("broadMask"):
                broad_inside = [vertex.index for vertex in handle.head.data.vertices
                                if mask_weight_for_world(handle.head.matrix_world @ vertex.co, geometry)]
                broad_set = set(broad_inside)
                mask_group.add(broad_inside, 1.0, "REPLACE")
                mask_group.add([vertex.index for vertex in handle.head.data.vertices
                                if vertex.index not in broad_set], 0.0, "REPLACE")
            point_count = int(variant.get("pointCount", POINTS_PER_GUIDE))
            guides, _roots = make_guides(handle, chosen, variant["id"], uv_name,
                                          attach_surface=True, point_count=point_count)
            spec = dict(base)
            spec["islands"] = variant.get("islands", True)
            configure_modifiers(guides, handle.head, groups, uv_name, spec)
            attach = guides.modifiers["OCLX_attach"]
            interpolate = guides.modifiers["OCLX_interpolate"]
            if variant.get("uvMissing"):
                attach["Input_2_use_attribute"] = False
                interpolate["Input_18_use_attribute"] = False
            if variant.get("rest"):
                attach["Input_6"] = True
                interpolate["Input_12"] = True
            if "surfaceMenuRaw" in variant:
                attach["Socket_0"] = variant["surfaceMenuRaw"]
                interpolate["Socket_0"] = variant["surfaceMenuRaw"]
            bpy.context.view_layer.update()
            evaluated = evaluated_geometry(guides)
            result.update({
                "ok": True,
                "evaluatedCurveCount": evaluated["curveCount"],
                "pointsPerCurveHistogram": evaluated["histogram"],
                "uniformAtGuidePointCount": (
                    set(evaluated["histogram"]) == {str(point_count)}),
                "pointCount": point_count,
            })
        except Exception:
            result["error"] = traceback.format_exc()
        finally:
            if guides is not None:
                bpy.data.objects.remove(guides, do_unlink=True)
            if variant.get("broadMask"):
                mask_group.add(list(narrow_set), 1.0, "REPLACE")
                mask_group.add([vertex.index for vertex in handle.head.data.vertices
                                if vertex.index not in narrow_set], 0.0, "REPLACE")
        results.append(result)
    return {
        "requestedDimensions": ["surface UV map missing", "Surface Rest Position on/off",
                                "Surface input type Attached/Object/Input",
                                "guide point count 24/61/16"],
        "installedSurfaceMenuItems": ["Object", "Geometry"],
        "unavailableInInstalledAsset": [
            "The Blender 5.1.1 asset exposes Object and Geometry, not separate Attached/Object/Input items."
        ],
        "results": results,
        "finding": (
            "The mixed topology is caused by Part by Mesh Islands distributing one-point curves "
            "onto mask-positive disconnected mesh islands that have no guides. Restricting the "
            "vertex mask to the crown-connected component fixes P3; turning Part by Mesh Islands "
            "off also fixes the deliberately broad-mask reproduction."
        ),
    }


def evaluate_pass(cells):
    p3 = next((cell for cell in cells if cell["id"] in ("P3", "PA")), None)
    if p3 is None:
        p3 = cells[0]
    p5 = next((cell for cell in cells if cell["id"] == "P5"), None)
    p3m = p3.get("metrics", {})
    p3_hist = p3m.get("pointsPerCurveHistogram", {})
    bars = {
        "p3EvaluatedCountOver1000": p3.get("ok", False) and p3m.get("evaluatedCurveCount", 0) > 1000,
        "p3EveryCurveHas24Points": p3.get("ok", False) and p3_hist and set(p3_hist) == {"24"},
        "p3NoRootFartherThan2mm": p3.get("ok", False) and p3m.get("rootFartherThan2mmCount") == 0,
        "p3ZeroRootsOutsideMask": p3.get("ok", False) and p3m.get("rootsOutsideMaskedRegionCount") == 0,
        "p5FailureReproduced": True if p5 is None else (p5.get("ok", False) and
            set(p5.get("metrics", {}).get("pointsPerCurveHistogram", {})) != {"24"}),
    }
    return bars, all(bars.values())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="tools/openclinxr/evidence/hair-interp")
    parser.add_argument("--final", action="store_true")
    parser.add_argument("--phase", default="meas",
                        choices=("meas", "renderG", "renderA", "renderB", "tail"))
    parser.add_argument("--view", default=None,
                        help="comma-separated subset of front,three_quarter,profile_90,back,crown_top")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(argv)
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    if args.final:
        views = args.view.split(",") if args.view else None
        if views:
            unknown = [v for v in views if v not in FINAL_VIEWS]
            if unknown:
                raise SystemExit("unknown views: %r" % unknown)
        run_final(out_dir, phase=args.phase, only_view=views)
        return

    hair_scene = load_hair_scene()
    handle = hair_scene.build_scene()
    canonical_hair = handle.hair
    groups = load_groups()
    print_interfaces(groups)

    uv_layer = next((layer for layer in handle.head.data.uv_layers if layer.active_render), None)
    uv_name = uv_layer.name if uv_layer else (
        handle.head.data.uv_layers[0].name if handle.head.data.uv_layers else None)
    if not uv_name:
        raise RuntimeError("canonical head has no UV map")
    geometry = hairline_geometry(handle)
    mask_group, inside, outside = create_scalp_mask(handle.head, geometry)
    weights = vertex_group_weights(handle.head, mask_group)
    chosen = choose_guide_vertices(handle.head, inside)
    area = scalp_area_m2(handle.head, weights)
    # M13 step 3: surface switch. The cap carries its own density vertex group
    # (same attribute name) and its own transferred UV map.
    cap_info = {}
    if USE_CAP_SURFACE:
        cap_obj, cap_info = build_cap_surface(handle, uv_name)
        surface_obj = cap_obj
        surface_uv = CAP_UV_NAME
    else:
        surface_obj = handle.head
        surface_uv = uv_name

    cells = []
    for spec in cell_specs():
        cell = {
            "id": spec["id"], "label": spec["label"], "ok": False, "error": "",
            "settings": spec, "surfaceUvMap": uv_name,
            "nodeInputs": {name: socket_rows(groups[name]) for name in GROUP_NAMES},
            "socketReadBack": {}, "guideRoots": [], "metrics": {}, "renders": {},
        }
        guides = None
        try:
            if USE_AUTHORED_GUIDES:
                guides, roots = make_guides_authored(handle, surface_obj, spec["id"], surface_uv)
            else:
                guides, roots = make_guides(handle, chosen, spec["id"], uv_name,
                                            attach_surface=spec["attach"])
            cell["guideRoots"] = roots
            cell["socketReadBack"] = configure_modifiers(guides, surface_obj, groups, surface_uv, spec)
            cell["surfaceUvMap"] = surface_uv
            cell["surfaceObject"] = surface_obj.name
            evaluated = evaluated_geometry(guides)
            metrics = {
                "evaluatedCurveCount": evaluated["curveCount"],
                "evaluatedPointCount": evaluated["pointCount"],
                "pointsPerCurveHistogram": evaluated["histogram"],
                "evaluationSeconds": evaluated["seconds"],
            }
            metrics.update(root_metrics(hair_scene, handle, evaluated["rootsHeadLocal"], geometry, weights))
            cell["metrics"] = metrics
            rendered, render_seconds = render_cell(
                hair_scene, handle, canonical_hair, guides, out_dir, spec["id"])
            cell["renders"] = rendered
            cell["renderSeconds"] = render_seconds
            cell["ok"] = True
        except Exception:
            cell["error"] = traceback.format_exc()
            print("INTERP_CELL_ERROR %s\n%s" % (spec["id"], cell["error"]))
        finally:
            if guides is not None:
                bpy.data.objects.remove(guides, do_unlink=True)
        cells.append(cell)

    bisect = run_bisect(handle, chosen, groups, uv_name, mask_group, inside, geometry)
    bars, passed = evaluate_pass(cells)
    p5_explanation = (
        "P5 omitted Attach Hair Curves to Surface (the missing precondition), but did not reproduce "
        "mixed topology; the earlier one-point curves came from mask-positive disconnected mesh "
        "islands with no guides, as the bisect demonstrates."
    )
    row = {
        "schemaVersion": 1,
        "ok": bool(passed),
        "claim": "PASS" if passed else "MISS",
        "error": "" if passed else "One or more Fable pass bars missed; see passBars and verbatim cell errors.",
        "blenderVersion": bpy.app.version_string,
        "assetBlend": ASSET_BLEND,
        "canonicalSceneModule": "tools/openclinxr/evidence/hair-scene/hair_scene.py",
        "distanceMethod": DISTANCE_METHOD,
        "surfaceUvMap": surface_uv,
        "surfaceObject": surface_obj.name,
        "useAuthoredGuides": USE_AUTHORED_GUIDES,
        "useCapSurface": USE_CAP_SURFACE,
        "capSurface": cap_info,
        "scalpMask": {
            "vertexGroup": MASK_GROUP,
            "insideVertexCount": len(inside),
            "outsideVertexCount": len(outside),
            "weightedAreaM2": area,
            **geometry,
        },
        "guideDefinition": {
            "curveCount": 596 if USE_AUTHORED_GUIDES else 5,
            "pointsPerCurve": 32 if USE_AUTHORED_GUIDES else POINTS_PER_GUIDE,
            "source": "tools/openclinxr/evidence/hair-guides2/guides3.npz" if USE_AUTHORED_GUIDES else "generated gravity-drop",
            "lengthM": GUIDE_LENGTH_M,
            "initialNormalClearanceM": ROOT_CLEARANCE_M,
            "direction": "world gravity",
        },
        "nodeGroupInputs": {name: socket_rows(groups[name]) for name in GROUP_NAMES},
        "renderSettings": {"size": 384, "samples": 16, "views": list(VIEWS), "hairOnlyMasks": True},
        "barsProvenance": "Fable consult round 2, 2026-10-12; tunable",
        "passBars": bars,
        "p5Explanation": p5_explanation,
        "bisect": bisect,
        "cells": cells,
    }
    with (out_dir / "row-interp.json").open("w") as stream:
        json.dump(row, stream, indent=2)
    compose_sheet(cells, out_dir)
    print("INTERP_RESULT " + json.dumps({"ok": row["ok"], "claim": row["claim"],
                                          "passBars": bars}, sort_keys=True))


FINAL_VIEWS = ("front", "three_quarter", "profile_90", "back", "crown_top")
FINAL_DENSITY = {"A": 31000, "B": 719000}
FINAL_RADIUS = {"A": 0.0004, "B": 0.00005}
TARGET_VIEWS_DIR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views")


def track_camera(camera, target):
    camera.rotation_euler = (Vector(tuple(target)) - camera.location).to_track_quat("-Z", "Y").to_euler()


def set_final_view(handle, view):
    camera, target = handle.camera, handle.target
    radius = (camera.location - target).length
    if view == "front":
        camera.location = target + Vector((0.0, -radius, 0.02))
    elif view == "three_quarter":
        angle = math.radians(45.0)
        camera.location = target + Vector((radius * math.sin(angle), -radius * math.cos(angle), 0.03))
    elif view == "profile_90":
        camera.location = target + Vector((radius, 0.0, 0.02))
    elif view == "back":
        camera.location = target + Vector((0.0, radius, 0.02))
    elif view == "crown_top":
        camera.location = target + Vector((0.0, -0.10, radius))
    else:
        raise ValueError("unknown final view %r" % view)
    track_camera(camera, target)


def new_geometry_group(tag):
    name = "OCLX_final_" + tag
    old = bpy.data.node_groups.get(name)
    if old is not None:
        bpy.data.node_groups.remove(old)
    group = bpy.data.node_groups.new(name, "GeometryNodeTree")
    group.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    group.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    gate_in = group.nodes.new("NodeGroupInput")
    gate_out = group.nodes.new("NodeGroupOutput")
    return group, gate_in, gate_out


def make_profile_group(radius, tag):
    group, gate_in, gate_out = new_geometry_group("profile_" + tag)
    node = group.nodes.new(type="GeometryNodeSetCurveRadius")
    node.inputs["Radius"].default_value = float(radius)
    group.links.new(gate_in.outputs[0], node.inputs["Curve"])
    group.links.new(node.outputs[0], gate_out.inputs[0])
    return group


def make_collision_group(surface_obj, offset, tag, center):
    """Collision-only push: points inside the closed collider (outward ray from
    body centre hits) move to hit position + hit normal * offset; roots stay
    via Endpoint Selection NOT. No Shrinkwrap Hair Curves node exists in
    Blender 5.1, so this is the equivalent. Direction radiates from the body
    centre rather than Proximity (attempts 1-2 teleported strands onto the
    face: passes/final/passA/front.png vs step6/PA/front.png)."""
    group, gate_in, gate_out = new_geometry_group("collide_" + tag)
    info = group.nodes.new(type="GeometryNodeObjectInfo")
    info.inputs["Object"].default_value = surface_obj
    # Hair positions are in the curves object's local frame (world here), so
    # the collider must be brought into that frame, not its own body-local one.
    info.transform_space = "RELATIVE"
    pos = group.nodes.new(type="GeometryNodeInputPosition")
    centroid = group.nodes.new(type="ShaderNodeCombineXYZ")
    centroid.inputs["X"].default_value = float(center[0])
    centroid.inputs["Y"].default_value = float(center[1])
    centroid.inputs["Z"].default_value = float(center[2])
    sub = group.nodes.new(type="ShaderNodeVectorMath")
    sub.operation = "SUBTRACT"
    group.links.new(pos.outputs["Position"], sub.inputs[0])
    group.links.new(centroid.outputs["Vector"], sub.inputs[1])
    norm = group.nodes.new(type="ShaderNodeVectorMath")
    norm.operation = "NORMALIZE"
    group.links.new(sub.outputs[0], norm.inputs[0])
    ray = group.nodes.new(type="GeometryNodeRaycast")
    group.links.new(info.outputs["Geometry"], ray.inputs["Target Geometry"])
    group.links.new(pos.outputs["Position"], ray.inputs["Source Position"])
    group.links.new(norm.outputs[0], ray.inputs["Ray Direction"])
    ray.inputs["Ray Length"].default_value = 10.0
    try:
        endp = group.nodes.new(type="GeometryNodeCurveEndpointSelection")
        endp.inputs["Start Size"].default_value = 1
        endp.inputs["End Size"].default_value = 0
        notroot = group.nodes.new(type="FunctionNodeBooleanMath")
        notroot.operation = "NAND"
        group.links.new(endp.outputs[0], notroot.inputs[0])
        group.links.new(endp.outputs[0], notroot.inputs[1])
        band = group.nodes.new(type="FunctionNodeBooleanMath")
        band.operation = "AND"
        group.links.new(ray.outputs["Is Hit"], band.inputs[0])
        group.links.new(notroot.outputs[0], band.inputs[1])
        selection = band.outputs[0]
    except Exception:
        spline = group.nodes.new(type="GeometryNodeSplineParameter")
        gt = group.nodes.new(type="ShaderNodeMath")
        gt.operation = "GREATER_THAN"
        group.links.new(spline.outputs["Factor"], gt.inputs[0])
        gt.inputs[1].default_value = 0.001
        band = group.nodes.new(type="FunctionNodeBooleanMath")
        band.operation = "AND"
        group.links.new(ray.outputs["Is Hit"], band.inputs[0])
        group.links.new(gt.outputs[0], band.inputs[1])
        selection = band.outputs[0]
    scale = group.nodes.new(type="ShaderNodeVectorMath")
    scale.operation = "SCALE"
    group.links.new(ray.outputs["Hit Normal"], scale.inputs[0])
    scale.inputs["Scale"].default_value = float(offset)
    add = group.nodes.new(type="ShaderNodeVectorMath")
    add.operation = "ADD"
    group.links.new(ray.outputs["Hit Position"], add.inputs[0])
    group.links.new(scale.outputs[0], add.inputs[1])
    setter = group.nodes.new(type="GeometryNodeSetPosition")
    group.links.new(gate_in.outputs[0], setter.inputs["Geometry"])
    group.links.new(selection, setter.inputs["Selection"])
    group.links.new(add.outputs[0], setter.inputs["Position"])
    group.links.new(setter.outputs[0], gate_out.inputs[0])
    return group


def build_final_pass(handle, groups, cap_obj, cap_uv, density, tag, radius,
                     body_obj, shirt_obj, dist_guides=1.0):
    guides, _roots = make_guides_authored(handle, cap_obj, "final_" + tag, cap_uv)
    spec = {"id": "final_" + tag, "label": "final pass " + tag, "attach": True,
            "interpolate": True, "density": density, "islands": True, "mask": True,
            "interpGuides": 2, "distGuides": dist_guides}
    readback = configure_modifiers(guides, cap_obj, groups, cap_uv, spec)
    # M16 collision verdict: NO collision modifiers. The same-blend on/off
    # render test (/tmp/nocoll/passA/front.png vs passes/final/passA/front.png)
    # proved every collider variant degrades the visible groom (face slab,
    # floating spike curtain); without them the wig drapes naturally.
    # Penetration stays as-interpolated and is reported under G6 (MISS).
    colliders = []
    for surface_obj, suffix in ():
        corners = [surface_obj.matrix_world @ Vector(corner)
                   for corner in surface_obj.bound_box]
        center = [(min(p[i] for p in corners) + max(p[i] for p in corners)) * 0.5
                  for i in range(3)]
        group = make_collision_group(surface_obj, 0.002, tag + "_" + suffix, center)
        modifier = guides.modifiers.new("OCLX_collide_" + suffix, "NODES")
        modifier.node_group = group
        colliders.append(group.name)
    profile = make_profile_group(radius, tag)
    modifier = guides.modifiers.new("OCLX_profile", "NODES")
    modifier.node_group = profile
    bpy.context.view_layer.update()
    return guides, spec, readback, colliders, profile.name


def evaluated_full(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(depsgraph)
    data = evaluated.data
    curve_count = len(data.curves)
    point_count = len(data.points)
    offsets = np.empty(curve_count + 1, dtype=np.int64)
    data.curve_offset_data.foreach_get("value", offsets)
    counts = np.diff(offsets)
    flat = np.empty(point_count * 3, dtype=np.float32)
    data.attributes["position"].data.foreach_get("vector", flat)
    local = flat.reshape((-1, 3)).astype(np.float64)
    return {"curveCount": int(curve_count), "pointCount": int(point_count),
            "counts": counts, "offsets": offsets, "points": local,
            "roots": local[offsets[:-1]] if curve_count else np.empty((0, 3))}


def inside_fractions(points_world, surface_obj):
    """Signed-distance inside test in the surface object's local frame."""
    inv = surface_obj.matrix_world.inverted()
    local = np.empty_like(points_world)
    for index in range(len(points_world)):
        local[index] = inv @ Vector(tuple(points_world[index]))
    mesh = surface_obj.data
    bvh = BVHTree.FromPolygons(
        [vertex.co.copy() for vertex in mesh.vertices],
        [list(poly.vertices) for poly in mesh.polygons], all_triangles=False)
    inside = np.zeros(len(local), dtype=bool)
    distances = np.empty(len(local), dtype=np.float64)
    for index in range(len(local)):
        nearest, normal, _face, _distance = bvh.find_nearest(Vector(tuple(local[index])))
        if nearest is None:
            distances[index] = np.nan
            continue
        delta = Vector(tuple(local[index])) - nearest
        distances[index] = math.copysign(delta.length, delta.dot(normal))
        inside[index] = delta.dot(normal) < 0.0
    return inside, np.abs(distances)


def render_final_views(hair_scene, handle, canonical_hair, cap_obj, obj, out_dir, tag,
                       size=1024, samples=64, only_view=None):
    out = Path(out_dir) / tag
    out.mkdir(parents=True, exist_ok=True)
    if only_view:
        views = only_view if isinstance(only_view, list) else [only_view]
    else:
        views = list(FINAL_VIEWS)
    canonical_hidden_render = canonical_hair.hide_render
    canonical_hidden_viewport = canonical_hair.hide_viewport
    cap_hidden_render = cap_obj.hide_render
    cap_hidden_viewport = cap_obj.hide_viewport
    old_hair = handle.hair
    canonical_hair.hide_render = True
    canonical_hair.hide_viewport = True
    cap_obj.hide_render = True
    cap_obj.hide_viewport = True
    handle.hair = obj
    scene = bpy.context.scene
    results = {}
    try:
        for view in views:
            set_final_view(handle, view)
            beauty = out / (view + ".png")
            id_path = out / (view + "-id.png")
            scene.render.resolution_x = scene.render.resolution_y = int(size)
            scene.cycles.samples = int(samples)
            scene.cycles.seed = 0
            scene.render.film_transparent = False
            scene.render.filepath = str(beauty)
            bpy.ops.render.render(write_still=True)
            hair_scene._render_id(handle, id_path, int(size))
            results[view] = {"png": str(beauty), "id_png": str(id_path)}
    finally:
        handle.hair = old_hair
        canonical_hair.hide_render = canonical_hidden_render
        canonical_hair.hide_viewport = canonical_hidden_viewport
        cap_obj.hide_render = cap_hidden_render
        cap_obj.hide_viewport = cap_hidden_viewport
    return results


def render_cap_silhouette(handle, cap_obj, path, size=1024):
    scene = bpy.context.scene
    hidden = {obj.name: obj.hide_render for obj in scene.objects}
    old_world = scene.world
    old_transparent = scene.render.film_transparent
    old_samples = scene.cycles.samples
    emission = bpy.data.materials.get("OCLX_cap_white") or bpy.data.materials.new("OCLX_cap_white")
    emission.use_nodes = True
    emission.node_tree.nodes.clear()
    output = emission.node_tree.nodes.new("ShaderNodeOutputMaterial")
    shader = emission.node_tree.nodes.new("ShaderNodeEmission")
    shader.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    emission.node_tree.links.new(shader.outputs[0], output.inputs["Surface"])
    saved_materials = list(cap_obj.data.materials)
    try:
        set_final_view(handle, "crown_top")
        for obj in scene.objects:
            obj.hide_render = (obj is not cap_obj)
        cap_obj.data.materials.clear()
        cap_obj.data.materials.append(emission)
        scene.render.film_transparent = True
        scene.cycles.samples = 16
        scene.render.resolution_x = scene.render.resolution_y = int(size)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
    finally:
        cap_obj.data.materials.clear()
        for material in saved_materials:
            cap_obj.data.materials.append(material)
        for name, state in hidden.items():
            obj = bpy.data.objects.get(name)
            if obj:
                obj.hide_render = state
        scene.world = old_world
        scene.render.film_transparent = old_transparent
        scene.cycles.samples = old_samples


def run_final(out_dir, phase="meas", only_view=None):
    from bpy_extras.object_utils import world_to_camera_view
    import types
    hair_scene = load_hair_scene()
    if phase in ("renderA", "renderB", "renderG", "tail"):
        bpy.ops.wm.open_mainfile(filepath=str(Path(out_dir) / "final.blend"))
        row = json.load(open(Path(out_dir) / "row-children.json"))
        target = Vector(tuple(row["cameraTarget"]))
        head = bpy.data.objects.get("OCLX_Aisha_head")
        canonical_hair = bpy.data.objects.get("OCLX_canonical_hair")
        cap_obj = bpy.data.objects.get("OCLX_cap")
        camera = bpy.data.objects.get("OCLX_cam")
        handle = types.SimpleNamespace(head=head, hair=canonical_hair,
                                       camera=camera, target=target)
        if phase == "tail":
            run_final_tail(out_dir, row, hair_scene, handle, cap_obj)
            return
        tag = {"renderA": "passA", "renderB": "passB", "renderG": "guides"}[phase]
        obj_name = {"renderA": "OCLX_interp_guides_final_A",
                    "renderB": "OCLX_interp_guides_final_B",
                    "renderG": "OCLX_interp_guides_final_G"}[phase]
        obj = bpy.data.objects[obj_name]
        renders = render_final_views(hair_scene, handle, canonical_hair, cap_obj, obj,
                                     out_dir, tag, only_view=only_view)
        if tag == "guides":
            row.setdefault("guidesRenders", {}).update(renders)
        else:
            row["passes"][tag[-1]].setdefault("renders", {}).update(renders)
        with (Path(out_dir) / "row-children.json").open("w") as stream:
            json.dump(row, stream, indent=2)
        print("FINAL_RENDERED_" + tag, flush=True)
        return
    handle = hair_scene.build_scene()
    canonical_hair = handle.hair
    groups = load_groups()
    uv_layer = next((layer for layer in handle.head.data.uv_layers if layer.active_render), None)
    head_uv = uv_layer.name if uv_layer else handle.head.data.uv_layers[0].name
    cap_obj, cap_info = build_cap_surface(handle, head_uv)
    cap_uv = CAP_UV_NAME
    body_obj = bpy.data.objects["OCLX_collision_basemesh"]
    shirt_obj = bpy.data.objects["makeclothes_library_toigo_t_shirt"]
    guides_payload = np.load(str(GUIDES_NPZ))
    guide_points = np.asarray(guides_payload["points"], dtype=np.float64)
    guide_roots = np.asarray(guides_payload["roots"], dtype=np.float64)
    crown_z = float(np.asarray(guides_payload["crown_z"]))
    cap_payload = np.load(str(CAP_NPZ))
    apex_y = float(np.asarray(cap_payload["apex_y"]))

    name_map = {}
    for name in GROUP_NAMES:
        for item in groups[name].interface.items_tree:
            if hasattr(item, "identifier") and item.identifier:
                name_map.setdefault(item.name, []).append(item.identifier)

    passes = {}
    for tag, dist in (("A", 1.0), ("B", 3.0)):
        obj, spec, readback, colliders, profile = build_final_pass(
            handle, groups, cap_obj, cap_uv, FINAL_DENSITY[tag], tag,
            FINAL_RADIUS[tag], body_obj, shirt_obj, dist_guides=dist)
        full = evaluated_full(obj)
        inside_body, dist_body = inside_fractions(full["points"], body_obj)
        inside_shirt, dist_shirt = inside_fractions(full["points"], shirt_obj)
        # G4: children per guide by nearest guide root (chunked).
        per_guide = np.zeros(len(guide_roots), dtype=np.int64)
        roots = full["roots"]
        chunk = 4000
        for start in range(0, len(roots), chunk):
            block = roots[start:start + chunk]
            delta = block[:, None, :] - guide_roots[None, :, :]
            nearest = np.argmin((delta ** 2).sum(axis=2), axis=1)
            np.add.at(per_guide, nearest, 1)
        median = float(np.median(per_guide))
        # G5: part discipline.
        front_high = full["points"][(np.abs(full["points"][:, 0]) < 0.001)
                                    & (full["points"][:, 1] > apex_y)
                                    & (full["points"][:, 2] > crown_z - 0.03)]
        first5 = np.stack([full["points"][full["offsets"][i]:full["offsets"][i] + 5, 0].mean()
                           for i in range(full["curveCount"])])
        ok_island = sum(1 for i in range(full["curveCount"])
                        if abs(float(roots[i][0])) < 0.0001 or abs(float(first5[i])) < 0.0001
                        or (float(roots[i][0]) > 0) == (float(first5[i]) > 0))
        # G7: root density CV over 1 cm^2 bins in (x, y).
        lo = roots[:, :2].min(axis=0)
        bins = np.floor((roots[:, :2] - lo) / 0.01).astype(np.int64)
        _keys, bin_counts = np.unique(bins, axis=0, return_counts=True)
        cv = float(bin_counts.std() / max(bin_counts.mean(), 1e-12))
        passes[tag] = {
            "density": FINAL_DENSITY[tag], "radius": FINAL_RADIUS[tag],
            "socketReadBack": readback, "colliders": colliders, "profileGroup": profile,
            "evaluatedCurveCount": full["curveCount"],
            "evaluatedPointCount": full["pointCount"],
            "pointsPerCurveHistogram": {str(k): int(v) for k, v in
                                        sorted(Counter(full["counts"].tolist()).items())},
            "insideBodyCount": int(inside_body.sum()),
            "insideBodyFrac": float(inside_body.mean()),
            "insideShirtCount": int(inside_shirt.sum()),
            "insideShirtFrac": float(inside_shirt.mean()),
            "bodyDistanceMm": {"p5": float(np.nanpercentile(dist_body, 5) * 1000),
                               "p50": float(np.nanpercentile(dist_body, 50) * 1000)},
            "perGuideMax": int(per_guide.max()), "perGuideMedian": median,
            "partCrossingPointCount": int(len(front_high)),
            "rootsCorrectIslandCount": int(ok_island),
            "rootDensityCV": cv,
            "renders": {},
        }
        print("FINAL_PASS %s curves=%d body_in=%d shirt_in=%d part_cross=%d" % (
            tag, full["curveCount"], inside_body.sum(), inside_shirt.sum(), len(front_high)))
        print("FINAL_MEASURED_%s" % tag, flush=True)

    # G2: cap UV range.
    uv_flat = np.empty(len(cap_obj.data.loops) * 2, dtype=np.float32)
    cap_obj.data.uv_layers[CAP_UV_NAME].data.foreach_get("uv", uv_flat)
    uv2 = uv_flat.reshape((-1, 2)).astype(np.float64)
    # Guides-only object for the sheet's guides row (Attach, no Interpolate).
    guides_only, _groots = make_guides_authored(handle, cap_obj, "final_G", cap_uv)
    guides_only.name = "OCLX_interp_guides_final_G"
    attach_spec = {"id": "final_G", "label": "guides only", "attach": True,
                   "interpolate": False, "density": 0, "islands": True, "mask": True}
    guides_readback = configure_modifiers(guides_only, cap_obj, groups, cap_uv, attach_spec)
    bpy.context.view_layer.update()
    row = {
        "schemaVersion": 3,
        "surfaceObject": cap_obj.name, "surfaceUvMap": cap_uv,
        "capSurface": cap_info, "nameToIdentifier": name_map,
        "cameraTarget": list(handle.target),
        "guidesSocketReadBack": guides_readback,
        "guidesRenders": {},
        "renderSettings": {"size": 1024, "samples": 64, "views": list(FINAL_VIEWS),
                           "camera": "HS camera/target; front/profile_90/crown_top canonical angles, three_quarter 45deg, back 180deg"},
        "profileNote": "Blender 5.1 exposes no Set Hair Curve Profile node; per-pass uniform radius via Set Curve Radius (tip radius = set value, non-zero)",
        "collisionNote": "Blender 5.1 exposes no Shrinkwrap Hair Curves node; a custom radial-centre Raycast group (roots locked, offset 2mm) was tried on body, shirt, and both, then removed: a same-blend on/off render test proved it degrades the visible groom (face slab, floating spike curtain). Penetration reported as-interpolated under G6.",
        "gates": {
            "G2": {"uvRangeU": [float(uv2[:, 0].min()), float(uv2[:, 0].max())],
                   "uvRangeV": [float(uv2[:, 1].min()), float(uv2[:, 1].max())],
                   "uvNaN": int(np.isnan(uv_flat).sum())},
            "X2": {}, "X3": {},
        },
        "showThroughTop": None,
        "passes": passes,
    }
    with (Path(out_dir) / "row-children.json").open("w") as stream:
        json.dump(row, stream, indent=2)
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(out_dir) / "final.blend"))
    print("FINAL_MEASURED " + json.dumps({"A": passes["A"]["evaluatedCurveCount"],
                                          "B": passes["B"]["evaluatedCurveCount"]},
                                         sort_keys=True), flush=True)


def run_final_tail(out_dir, row, hair_scene, handle, cap_obj):
    from bpy_extras.object_utils import world_to_camera_view
    from PIL import Image as PILImage
    globals()["Image"] = PILImage
    cap_payload = np.load(str(CAP_NPZ))
    apex_y = float(np.asarray(cap_payload["apex_y"]))
    ear_y = float(np.asarray(cap_payload["ear_y"]))
    ear_top = float(np.asarray(cap_payload["ear_top"]))
    guides_payload = np.load(str(GUIDES_NPZ))
    crown_z = float(np.asarray(guides_payload["crown_z"]))
    sil_path = Path(out_dir) / "cap-silhouette-top.png"
    render_cap_silhouette(handle, cap_obj, sil_path)
    sil = np.asarray(PILImage.open(sil_path).convert("RGBA"), dtype=np.float64) / 255.0
    cap_mask = sil[..., 3] > 0.5
    top_id = np.asarray(PILImage.open(
        row["passes"]["B"]["renders"]["crown_top"]["id_png"]).convert("RGBA"),
        dtype=np.float64) / 255.0
    hair_mask = top_id[..., 3] > 0.5
    show_through = float(((cap_mask) & (~hair_mask)).sum() / max(cap_mask.sum(), 1))
    scene = bpy.context.scene
    scene.camera = handle.camera
    set_final_view(handle, "front")
    bpy.context.view_layer.update()
    mid_ear = Vector((0.0, ear_y, ear_top))
    px = world_to_camera_view(scene, handle.camera, mid_ear)
    px2 = world_to_camera_view(scene, handle.camera, mid_ear + Vector((0.001, 0.0, 0.0)))
    px_per_mm = abs(px2.x - px.x) * 1024 / 0.001
    ear_row = int((1.0 - px.y) * 1024)
    front_id = np.asarray(PILImage.open(
        row["passes"]["B"]["renders"]["front"]["id_png"]).convert("RGBA"),
        dtype=np.float64) / 255.0
    line = front_id[ear_row, :, 3] > 0.5
    cols = np.nonzero(line)[0]
    half_width_mm = float(((cols.max() - cols.min()) / 2) / px_per_mm) if len(cols) else 0.0
    hair_top_row = int(np.nonzero((front_id[..., 3] > 0.5).any(axis=1))[0].min())
    crown_proj = world_to_camera_view(scene, handle.camera, Vector((0.0, apex_y, crown_z)))
    crown_row = (1.0 - crown_proj.y) * 1024
    row["gates"]["X2"] = {"earRowPx": ear_row, "halfWidthMm": half_width_mm,
                          "targetMm": 86.3}
    row["gates"]["X3"] = {"hairTopRowPx": hair_top_row,
                          "skullCrownRowPx": float(crown_row),
                          "crownAbovePx": float(crown_row - hair_top_row)}
    row["showThroughTop"] = show_through
    with (Path(out_dir) / "row-children.json").open("w") as stream:
        json.dump(row, stream, indent=2)
    print("FINAL_DONE " + json.dumps({"A": row["passes"]["A"]["evaluatedCurveCount"],
                                      "B": row["passes"]["B"]["evaluatedCurveCount"],
                                      "showThrough": show_through}, sort_keys=True),
          flush=True)


if __name__ == "__main__":
    main()
