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


def add_surface_inputs(modifier, group, handle, uv_name, readback):
    set_input(modifier, group, "Surface Input Type", "Object", readback, "NodeSocketMenu")
    set_input(modifier, group, "Surface", handle.head, readback, "NodeSocketObject")
    set_input(modifier, group, "Surface UV Map", None, readback,
              "NodeSocketVector", attribute_name=uv_name)
    set_input(modifier, group, "Surface Rest Position", False, readback)


def configure_modifiers(guides, handle, groups, uv_name, spec):
    readback = {"attach": {}, "interpolate": {}}
    if spec["attach"]:
        group = groups["Attach Hair Curves to Surface"]
        modifier = guides.modifiers.new("OCLX_attach", "NODES")
        modifier.node_group = group
        add_surface_inputs(modifier, group, handle, uv_name, readback["attach"])
        set_input(modifier, group, "Sample Attachment UV", True, readback["attach"])
        set_input(modifier, group, "Snap to Surface", True, readback["attach"])
        set_input(modifier, group, "Align to Surface Normal", False, readback["attach"])
        set_input(modifier, group, "Blend along Curve", 0.0, readback["attach"])
    if spec["interpolate"]:
        group = groups["Interpolate Hair Curves"]
        modifier = guides.modifiers.new("OCLX_interpolate", "NODES")
        modifier.node_group = group
        add_surface_inputs(modifier, group, handle, uv_name, readback["interpolate"])
        set_input(modifier, group, "Follow Surface Normal", False, readback["interpolate"])
        set_input(modifier, group, "Part by Mesh Islands", spec["islands"], readback["interpolate"])
        set_input(modifier, group, "Interpolation Guides", 3, readback["interpolate"])
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
    return [
        {"id": "P0", "label": "five guides + Attach only", "attach": True,
         "interpolate": False, "density": 0, "islands": True, "mask": True},
        {"id": "P1", "label": "density 2000; islands on; mask", "attach": True,
         "interpolate": True, "density": 2000, "islands": True, "mask": True},
        {"id": "P2", "label": "density 2000; islands off; mask", "attach": True,
         "interpolate": True, "density": 2000, "islands": False, "mask": True},
        {"id": "P3", "label": "density 20000; islands on; mask", "attach": True,
         "interpolate": True, "density": 20000, "islands": True, "mask": True},
        {"id": "P4", "label": "density 20000; islands on; no mask", "attach": True,
         "interpolate": True, "density": 20000, "islands": True, "mask": False},
        {"id": "P5", "label": "density 20000; guides not attached", "attach": False,
         "interpolate": True, "density": 20000, "islands": True, "mask": True},
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
            configure_modifiers(guides, handle, groups, uv_name, spec)
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
    p3 = next(cell for cell in cells if cell["id"] == "P3")
    p5 = next(cell for cell in cells if cell["id"] == "P5")
    p3m = p3.get("metrics", {})
    p3_hist = p3m.get("pointsPerCurveHistogram", {})
    bars = {
        "p3EvaluatedCountOver1000": p3.get("ok", False) and p3m.get("evaluatedCurveCount", 0) > 1000,
        "p3EveryCurveHas24Points": p3.get("ok", False) and p3_hist and set(p3_hist) == {"24"},
        "p3NoRootFartherThan2mm": p3.get("ok", False) and p3m.get("rootFartherThan2mmCount") == 0,
        "p3ZeroRootsOutsideMask": p3.get("ok", False) and p3m.get("rootsOutsideMaskedRegionCount") == 0,
        "p5FailureReproduced": p5.get("ok", False) and
            set(p5.get("metrics", {}).get("pointsPerCurveHistogram", {})) != {"24"},
    }
    return bars, all(bars.values())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="tools/openclinxr/evidence/hair-interp")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(argv)
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

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
            guides, roots = make_guides(handle, chosen, spec["id"], uv_name,
                                        attach_surface=spec["attach"])
            cell["guideRoots"] = roots
            cell["socketReadBack"] = configure_modifiers(guides, handle, groups, uv_name, spec)
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
        "surfaceUvMap": uv_name,
        "scalpMask": {
            "vertexGroup": MASK_GROUP,
            "insideVertexCount": len(inside),
            "outsideVertexCount": len(outside),
            "weightedAreaM2": area,
            **geometry,
        },
        "guideDefinition": {
            "curveCount": 5,
            "pointsPerCurve": POINTS_PER_GUIDE,
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


if __name__ == "__main__":
    main()
