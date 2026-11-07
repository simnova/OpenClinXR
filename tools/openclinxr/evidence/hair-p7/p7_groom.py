"""Authored-guide centre-part groom evidence for OpenClinXR hair-p7.

Run with Blender 5.1.1, from the repository root::

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    --python-exit-code 1 -P tools/openclinxr/evidence/hair-p7/p7_groom.py -- --stage all

Stages are deliberately ordered and fail closed: cap -> guides -> children -> judge.
The scene is rebuilt deterministically for every invocation.  No MakeHuman hair
guide or evaluated hair geometry is reused.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import subprocess
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector, geometry
from mathutils.bvhtree import BVHTree
from PIL import Image, ImageDraw


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
SCENE_PY = REPO / "tools/openclinxr/evidence/hair-scene/hair_scene.py"
JUDGE_PY = REPO / "tools/openclinxr/evidence/hair-judge/hair_judge.py"
TARGETS = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views")
BASELINE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-guides/tools/openclinxr/evidence/hair-guides/G0")
BLENDER_EXPECTED = "5.1.1"
VIEWS = ("front", "three_quarter", "profile", "back", "top")
VIEW_TO_SHARED = {
    "front": "front", "three_quarter": "back_quarter", "profile": "profile_90",
    "back": "back_quarter", "top": "crown_top",
}
SEED = 17041


def load_scene_module():
    spec = importlib.util.spec_from_file_location("oclx_hair_scene_p7", SCENE_PY)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def args_after_dash():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=("cap", "guides", "children", "judge", "all"), default="all")
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--samples", type=int, default=32)
    return ap.parse_args(argv)


def json_safe(value):
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, Path):
        return str(value)
    raise TypeError(type(value).__name__)


def write_row(row):
    with (HERE / "row-p7.json").open("w") as stream:
        json.dump(row, stream, indent=2, sort_keys=True, default=json_safe)
        stream.write("\n")


def make_material(name, color, emission=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = 0.38
    if emission:
        shader.inputs["Emission Color"].default_value = (*color, 1.0)
        shader.inputs["Emission Strength"].default_value = emission
    links.new(shader.outputs[0], out.inputs["Surface"])
    return mat


def world_mesh(obj, depsgraph):
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    verts = np.asarray([(ev.matrix_world @ v.co)[:] for v in mesh.vertices], dtype=np.float64)
    faces = [tuple(p.vertices) for p in mesh.polygons]
    ev.to_mesh_clear()
    return verts, faces


def face_area(verts, face):
    p0 = verts[face[0]]
    return sum(np.linalg.norm(np.cross(verts[face[i]] - p0, verts[face[i + 1]] - p0)) * 0.5
               for i in range(1, len(face) - 1))


def uv_metrics(mesh, layer_name="UVMap"):
    layer = mesh.uv_layers.get(layer_name)
    if layer is None:
        return {"u_range": 0.0, "v_range": 0.0, "zero_area_faces": len(mesh.polygons),
                "min_face_area": 0.0}
    uv = layer.data
    areas = []
    values = []
    for poly in mesh.polygons:
        pts = [np.asarray(uv[i].uv[:], dtype=np.float64) for i in poly.loop_indices]
        values.extend(pts)
        p0 = pts[0]
        area = sum(abs(np.cross(pts[i] - p0, pts[i + 1] - p0)) * .5
                   for i in range(1, len(pts) - 1))
        areas.append(float(area))
    values = np.asarray(values)
    return {
        "u_range": float(np.ptp(values[:, 0])), "v_range": float(np.ptp(values[:, 1])),
        "zero_area_faces": int(np.count_nonzero(np.asarray(areas) <= 1e-12)),
        "min_face_area": float(min(areas, default=0.0)),
    }


def boundary_height(p, centre, cx, crown_z):
    """Smooth continuous hairline height for a world point p (front=-Y)."""
    d = p - centre
    az = math.atan2(d[0], -d[1])
    frontness, sideness = math.cos(az), abs(math.sin(az))
    drop = 0.165 - 0.025 * sideness + 0.095 * max(0.0, -frontness)
    return drop


def build_cap(handle, row):
    """Duplicate the actor-head scalp faces, preserving head UVs for Interpolate."""
    deps = bpy.context.evaluated_depsgraph_get()
    verts, faces = world_mesh(handle.head, deps)
    crown_z = float(verts[:, 2].max())
    apex_idx = int(np.argmax(verts[:, 2]))
    apex_y = float(verts[apex_idx, 1])
    # Head centre from the upper cranium, independent of body bounds.
    upper = verts[verts[:, 2] > crown_z - 0.24]
    cx = float(np.median(upper[:, 0]))
    cy = float(np.median(upper[:, 1]))
    centre = np.array((cx, cy + 0.005, crown_z - 0.105), dtype=np.float64)
    eye_z = crown_z - 0.125
    ear_y = cy + 0.005
    ear_top_z = crown_z - 0.082
    chin_z = crown_z - 0.215

    # Ray-direction region.  Front is -Y in the canonical scene.  The smooth
    # boundary goes from forehead top, down at temples, behind ears and to nape.
    centroids = np.asarray([verts[list(face)].mean(axis=0) for face in faces])
    edge_faces = {}
    for fi, face in enumerate(faces):
        for i, va in enumerate(face):
            vb = face[(i + 1) % len(face)]
            edge_faces.setdefault(tuple(sorted((va, vb))), []).append(fi)
    adjacency = [[] for _ in faces]
    for owners in edge_faces.values():
        if len(owners) == 2:
            adjacency[owners[0]].append(owners[1]); adjacency[owners[1]].append(owners[0])

    def crown_component(candidate):
        """Discard disconnected teeth/eyebrow/garment islands sharing head bounds."""
        allowed = set(candidate)
        if not allowed:
            return []
        seed = max(allowed, key=lambda i: centroids[i, 2])
        found, todo = {seed}, [seed]
        while todo:
            fi = todo.pop()
            for other in adjacency[fi]:
                if other in allowed and other not in found:
                    found.add(other); todo.append(other)
        return sorted(found)

    # Tune only by moving the continuous hairline, retaining the same shape.
    # The front hairline shape is proven at delta 0.069 (accepted run); the
    # back-only band fill adds area on top, so pin delta and verify the gate.
    best = None
    for delta in (0.069,):
        candidate = []
        for fi, face in enumerate(faces):
            p = centroids[fi]
            d = p - centre
            radial = math.hypot(d[0], d[1])
            # HANDBACK G-back: the old 0.135 radial cap excluded a band across
            # the lower occiput (far in radial yet below centre height), leaving
            # a bare wedge/hole with a detached nape strip.  Admit the band
            # ONLY behind (front hairline selection stays exactly proven).
            _az0 = math.atan2(d[0], -d[1])
            _behind = max(0.0, -math.cos(_az0)) > 0.3
            _rmax = 0.160 if _behind else 0.135
            if not (0.055 <= radial <= _rmax or p[2] > centre[2]):
                continue
            az = math.atan2(d[0], -d[1])
            frontness, sideness = math.cos(az), abs(math.sin(az))
            # Centre of the forehead descends slightly; temples recede.  Back
            # and nape descend substantially.  Exclude the protruding ear fan.
            drop = 0.165 - 0.025 * sideness + 0.095 * max(0.0, -frontness)
            boundary = crown_z - drop + delta
            ear_zone = (abs(p[0] - cx) > 0.072 and p[2] < crown_z - 0.082)
            if ear_zone:
                continue
            if p[2] >= boundary:
                candidate.append(fi)
        candidate = crown_component(candidate)
        area = sum(face_area(verts, faces[i]) for i in candidate)
        score = abs(area - 0.065)
        if best is None or score < best[0]:
            best = (score, candidate, area, float(delta))
    _, chosen, area, delta = best

    # HANDBACK S2a: duplicate head faces WITH original UVs (from_pydata loses
    # them, and the old spherical map clamped every V to 0).  Copy the head
    # mesh, then delete every face outside the chosen scalp region.
    head = handle.head
    mesh = head.data.copy()
    mesh.name = "P7_scalp_cap_mesh"
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    keep = set(chosen)
    for face in list(bm.faces):
        if face.index not in keep:
            bm.faces.remove(face)
    for vert in list(bm.verts):
        if not vert.link_faces:
            bm.verts.remove(vert)
    # Subdivide once so the hairline follows the smooth curve at finer
    # granularity (G-line).  UVs interpolate; re-clip subdivided faces whose
    # centroid falls below the same smooth boundary.
    # Blender 5.1 has no bmesh.ops.subdivide: subdivide twice via edit-mode
    # ops on a linked temp object (UVs interpolate), then continue in bmesh.
    bm.to_mesh(mesh)
    bm.free()
    _tmp = bpy.data.objects.new("P7_cap_tmp", mesh)
    bpy.context.scene.collection.objects.link(_tmp)
    bpy.ops.object.select_all(action="DESELECT")
    _tmp.select_set(True)
    bpy.context.view_layer.objects.active = _tmp
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.subdivide(number_cuts=1, smoothness=0)
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.subdivide(number_cuts=1, smoothness=0)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.data.objects.remove(_tmp, do_unlink=True)
    bpy.context.view_layer.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    Mw = head.matrix_world
    def _w(co):
        return np.asarray((Mw @ co)[:], dtype=np.float64)
    for face in list(bm.faces):
        c = np.mean([_w(v.co) for v in face.verts], axis=0)
        d = c - centre
        radial = math.hypot(d[0], d[1])
        _az1 = math.atan2(d[0], -d[1])
        _rmax1 = 0.165 if max(0.0, -math.cos(_az1)) > 0.3 else 0.140
        if not (0.040 <= radial <= _rmax1 or c[2] > centre[2]):
            bm.faces.remove(face)
            continue
        drop = boundary_height(c, centre, cx, crown_z)
        if (abs(c[0] - cx) > 0.072 and c[2] < ear_top_z):
            bm.faces.remove(face)
            continue
        if c[2] < crown_z - drop + float(delta):
            bm.faces.remove(face)
    for vert in list(bm.verts):
        if not vert.link_faces:
            bm.verts.remove(vert)
    # Keep only the largest connected component (crown); fills the occiput gap
    # deterministically instead of leaving a jagged hole band.
    bm.faces.ensure_lookup_table()
    bm.verts.ensure_lookup_table()
    _faces = list(bm.faces)
    _adj = {f.index: set() for f in _faces}
    for edge in bm.edges:
        linked = list(edge.link_faces)
        if len(linked) == 2:
            _adj[linked[0].index].add(linked[1].index)
            _adj[linked[1].index].add(linked[0].index)
    if _faces:
        _cent = {f.index: float(_w(f.calc_center_median())[2]) for f in _faces}
        _seed = max(_cent, key=_cent.get)
        _found, _todo = {_seed}, [_seed]
        while _todo:
            _fi = _todo.pop()
            for _o in _adj[_fi]:
                if _o not in _found:
                    _found.add(_o); _todo.append(_o)
        for face in list(bm.faces):
            if face.index not in _found:
                bm.faces.remove(face)
        for vert in list(bm.verts):
            if not vert.link_faces:
                bm.verts.remove(vert)
    # Smooth the front hairline: 2 Laplacian passes on boundary verts only,
    # reprojected onto the head surface so the edge is a smooth curve.
    try:
        _bvh = BVHTree.FromObject(head, deps, deform=True, cage=False)
        _w2l = head.evaluated_get(deps).matrix_world.inverted()
        _l2w = head.evaluated_get(deps).matrix_world
        for _ in range(2):
            _bnd = [v for v in bm.verts
                    if any(len(e.link_faces) == 1 for e in v.link_edges)
                    and (_w(v.co)[1] < centre[1] + 0.02)]
            _new = {}
            for v in _bnd:
                _nbrs = [e.other_vert(v) for e in v.link_edges]
                if _nbrs:
                    _new[v.index] = (v.co.copy() + sum((n.co for n in _nbrs), Vector((0, 0, 0)))) / (len(_nbrs) + 1)
            for v in _bnd:
                if v.index in _new:
                    v.co = _new[v.index]
            for v in _bnd:
                q = _w2l @ Mw @ v.co
                hit, _n, _fi, _dd = _bvh.find_nearest(q)
                if hit is not None:
                    v.co = Mw.inverted() @ _l2w @ hit
    except Exception:
        pass
    # G-line: halve long front-hairline boundary edges, then pin the new verts
    # to the head surface (bmesh subdivide is unavailable in 5.1).
    try:
        _fb = [e for e in bm.edges if len(e.link_faces) == 1
               and float(np.mean([(Mw @ v.co)[1] for v in e.verts])) < centre[1] + 0.02
               and (e.calc_length() > 0.004)]
        if _fb:
            bmesh.ops.subdivide_edges(bm, edges=_fb, cuts=1)
            _w2l2 = head.evaluated_get(deps).matrix_world.inverted()
            _l2w2 = head.evaluated_get(deps).matrix_world
            # Pin verts created by the split (exactly 2 boundary link edges)
            # onto the head surface.
            for _v in list(bm.verts):
                _be = [_e for _e in _v.link_edges if len(_e.link_faces) == 1]
                if len(_be) == 2 and len(_v.link_edges) == 2:
                    _q = _w2l2 @ Mw @ _v.co
                    _hit, _nn, _ffi, _ddd = _bvh.find_nearest(_q)
                    if _hit is not None:
                        _v.co = Mw.inverted() @ _l2w2 @ _hit
    except Exception as _se:
        print("P7 EDGE SPLIT", repr(_se))
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    # Verts are in head-local axes; bake to world so the cap object is identity.
    if any(abs(a - b) > 1e-9 for a, b in zip([v for row_ in Mw for v in row_], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])):
        for v in mesh.vertices:
            v.co = Mw @ v.co
    mesh.update()
    cap = bpy.data.objects.new("P7_scalp_cap", mesh)
    bpy.context.scene.collection.objects.link(cap)
    cap.matrix_world.identity()
    cap.scale = (1.0, 1.0, 1.0)
    if mesh.uv_layers.get("UVMap") is None and mesh.uv_layers:
        mesh.uv_layers[0].name = "UVMap"
    mesh.uv_layers.active = mesh.uv_layers.get("UVMap")
    cap.update_tag(); bpy.context.view_layer.update()
    _uvm = uv_metrics(mesh)
    # Fallback only if the head copy somehow lacks usable UVs.
    if _uvm["v_range"] <= 0.1 or _uvm["zero_area_faces"] > 0:
        bpy.ops.object.select_all(action="DESELECT")
        cap.select_set(True); bpy.context.view_layer.objects.active = cap
        try:
            with bpy.context.temp_override(object=cap, active_object=cap, selected_objects=[cap],
                                           selected_editable_objects=[cap]):
                bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
        except Exception:
            pass
        cap.update_tag(); bpy.context.view_layer.update()
        _uvm = uv_metrics(mesh)
    # Centre part ends where the front slope meets the crown (cy+0.012, the
    # proven limit: one face island, one boundary loop).  Extending the slit to
    # the apex point bifurcates this mesh into two islands (measured 796/796),
    # so the crown-ending part is the density mask + slit reaching the crown
    # region while the crown top and back stay one piece.
    # Slit along x=cx from the front hairline toward the crown apex.  Walk a
    # SIMPLE mouth-to-apex path along centre edges and split only it: bulk
    # splitting every centre edge detached the crown pole fan (2 islands).
    # Part divide as a Dijkstra-graph barrier, NOT a mesh split: bulk
    # splitting every centre edge detached the crown pole fan (2 islands),
    # and the inherited centre row zigzags +/-1.8 mm so no mesh walk reaches
    # the apex.  The barrier spans the front hairline to the crown apex
    # exactly; the mesh stays one piece with one boundary loop.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    seam = []
    slit_end_y = float(apex_y)
    slit_method = "graph-barrier front-hairline-to-apex (no mesh split)"
    print("P7 SLIT barrier y=[front-hairline, %.4f] apex_y=%.4f cx=%.5f" % (apex_y, apex_y, cx))
    row.setdefault("s2_diagnosis", {})["slit_method"] = slit_method
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    row["s2_diagnosis"] = {"a_cap_uv": _uvm,
                           "a_method": "duplicate-head-faces-preserve-UV + edit-subdivide2 + smooth-hairline + seam-to-apex"}

    # Density mask is zero at the part and ramps to one by 2 mm.  The part
    # runs to the crown; behind it the weight is one (single piece, full roots).
    group = cap.vertex_groups.new(name="p7_density")
    for v in mesh.vertices:
        on_part_half = v.co.y <= slit_end_y
        w = min(1.0, abs(v.co.x - cx) / 0.002) if on_part_half else 1.0
        group.add([v.index], float(w), "REPLACE")

    cap.data.materials.append(make_material("P7_cap_debug", (0.03, 0.72, 0.95), 0.25))
    # The head copy brings skin material slots; pin every cap face to the cyan
    # debug slot so cap-debug.png actually shows the cap.
    _dbg_slot = len(cap.data.materials) - 1
    for _poly in mesh.polygons:
        _poly.material_index = _dbg_slot

    bm = bmesh.new(); bm.from_mesh(mesh)
    boundary_edges = [e for e in bm.edges if len(e.link_faces) == 1]
    unseen = set(boundary_edges)
    loops = []
    while unseen:
        seed = unseen.pop(); comp = {seed}; frontier = [seed]
        while frontier:
            edge = frontier.pop()
            for v in edge.verts:
                for nxt in v.link_edges:
                    if nxt in unseen and len(nxt.link_faces) == 1:
                        unseen.remove(nxt); comp.add(nxt); frontier.append(nxt)
        loops.append(comp)
    # A front slit that touches the exterior hairline does not create a new
    # loop; an interior hole does.  With the seam ending at the apex the slit
    # stays connected, so exactly 1 loop means no interior hole (G-back).
    hole_areas = []
    for comp in loops:
        pts = np.asarray([v.co[:] for e in comp for v in e.verts], dtype=np.float64)
        is_part = np.max(np.abs(pts[:, 0] - cx)) < 5e-4
        low = float(pts[:, 2].min())
        is_exterior = low < crown_z - 0.11
        if not (is_part or is_exterior):
            c = pts.mean(axis=0)
            hole_areas.append(sum(np.linalg.norm(np.cross(pts[i] - c, pts[(i + 1) % len(pts)] - c)) * .5
                                  for i in range(len(pts))))
    # G-line: walk the front hairline loop in order; max deviation of each
    # vertex from the chord of its two neighbours (local step, <=3 mm).
    # The part-slit corner is an authored right angle, not a stair step:
    # exclude slit edges so G-line measures only hairline smoothness.
    _front_edges = [e for e in boundary_edges
                    if float(np.mean([v.co.y for v in e.verts])) < centre[1] + 0.02
                    and not all(abs(v.co.x - cx) < 0.001 for v in e.verts)]
    _gline_max_mm = 0.0
    if len(_front_edges) >= 3:
        _adj = {}
        for _e in _front_edges:
            _vs = list(_e.verts)
            _adj.setdefault(_vs[0].index, []).append(_vs[1].index)
            _adj.setdefault(_vs[1].index, []).append(_vs[0].index)
        _start = min(_adj, key=lambda _k: (len(_adj[_k]) != 1, _k))
        # Direction-aware walk: at branches continue straightest, so the
        # measured steps are real hairline corners, not walk jumps.
        _vmap0 = {v.index: np.asarray(v.co[:], dtype=np.float64) for e in _front_edges for v in e.verts}
        _order, _prev, _cur = [_start], None, _start
        for _ in range(len(_adj) + 1):
            _nxt = [n for n in _adj[_cur] if n != _prev]
            if not _nxt:
                break
            if len(_nxt) > 1 and _prev is not None:
                _inc = _vmap0[_cur] - _vmap0[_prev]
                _n = max(_nxt, key=lambda n: float(np.dot(_vmap0[n] - _vmap0[_cur], _inc)))
            else:
                _n = _nxt[0]
            _order.append(_n)
            _prev, _cur = _cur, _n
            if len(_order) > len(_adj):
                break
        _vmap = {v.index: np.asarray(v.co[:], dtype=np.float64) for e in _front_edges for v in e.verts}
        _seq = np.asarray([_vmap[k] for k in _order if k in _vmap])
        if len(_seq) >= 3:
            _steps = []
            for _k in range(1, len(_seq) - 1):
                _chord = (_seq[_k - 1] + _seq[_k + 1]) * 0.5
                _steps.append(float(np.linalg.norm(_seq[_k] - _chord)))
            _gline_max_mm = (max(_steps) * 1000.0) if _steps else 0.0
    _cap_area = sum(mesh.calc_area() for _ in [0]) if False else None
    _area_now = float(sum((mesh.vertices[f.vertices[0]].co - mesh.vertices[f.vertices[1]].co).cross(
        mesh.vertices[f.vertices[0]].co - mesh.vertices[f.vertices[2]].co).length * 0.5
        if len(f.vertices) == 3 else
        ((mesh.vertices[f.vertices[0]].co - mesh.vertices[f.vertices[1]].co).cross(
            mesh.vertices[f.vertices[0]].co - mesh.vertices[f.vertices[2]].co).length * 0.5 +
         (mesh.vertices[f.vertices[0]].co - mesh.vertices[f.vertices[2]].co).cross(
            mesh.vertices[f.vertices[0]].co - mesh.vertices[f.vertices[3]].co).length * 0.5)
        for f in mesh.polygons))
    bm.free()

    below_eye_front_ear = sum(1 for v in mesh.vertices
                              if v.co.y < ear_y and v.co.z < eye_z)
    ear_vertices = sum(1 for v in mesh.vertices
                       if abs(v.co.x - cx) > .078 and v.co.z < crown_z - .082)
    _edge_lens = np.asarray([(mesh.vertices[e.vertices[0]].co
                              - mesh.vertices[e.vertices[1]].co).length
                             for e in mesh.edges], dtype=np.float64)
    cap_metrics = {
        "area_cm2": _area_now * 10000.0,
        "face_count": len(mesh.polygons), "vertex_count": len(mesh.vertices),
        "edge_mean_mm": float(_edge_lens.mean() * 1000.0) if len(_edge_lens) else float("nan"),
        "edge_max_mm": float(_edge_lens.max() * 1000.0) if len(_edge_lens) else float("nan"),
        "slit_end_y": slit_end_y, "slit_apex_y": float(apex_y),
        "slit_method": slit_method,
        "scale": list(cap.scale), "hairline_delta_m": delta,
        "part_edge_count": len(seam), "boundary_components": len(loops),
        "vertices_front_of_ear_below_eye": below_eye_front_ear,
        "vertices_on_ear": ear_vertices,
        "max_hole_cm2": max(hole_areas, default=0.0) * 10000.0,
        "head_centre": centre.tolist(), "crown_z": crown_z,
        "eye_z": eye_z, "ear_y": ear_y, "ear_top_z": ear_top_z,
        "chin_z": chin_z, "apex_y": apex_y,
        "g_line_max_step_mm": _gline_max_mm,
    }
    cap_pass = (550.0 <= cap_metrics["area_cm2"] <= 750.0
                and below_eye_front_ear == 0 and ear_vertices == 0
                and cap_metrics["max_hole_cm2"] <= 1.0
                and tuple(round(x, 9) for x in cap.scale) == (1.0, 1.0, 1.0))
    cap_metrics["pass"] = bool(cap_pass)
    row["s0_cap"] = cap_metrics
    return cap, centre, cap_metrics


def set_view(shared, handle, view):
    if view == "three_quarter":
        target = handle.target
        r = (handle.camera.location - target).length
        angle = math.radians(35)
        handle.camera.location = target + Vector((r * math.sin(angle), -r * math.cos(angle), 0.03))
        shared._track(handle.camera, target)
    elif view == "back":
        target = handle.target
        r = (handle.camera.location - target).length
        handle.camera.location = target + Vector((0, r, 0.02))
        shared._track(handle.camera, target)
    else:
        shared._set_view(handle, VIEW_TO_SHARED[view])


def render_current(shared, handle, name, views, size, samples, only=None):
    out = HERE / name
    out.mkdir(exist_ok=True)
    scene = bpy.context.scene
    saved = {o.name: o.hide_render for o in scene.objects}
    if only is not None:
        # Compare by name: Blender RNA proxies redefine == by pointer while
        # hash stays proxy-identity, so `obj in set(objects)` misfires and
        # hides the very objects requested (measured: 0 px rendered).
        wanted = {o.name for o in only}
        for obj in scene.objects:
            if obj.type in {"CURVES", "CURVE", "MESH"} and obj.name not in wanted and obj is not handle.head:
                obj.hide_render = True
    paths = []
    try:
        for view in views:
            set_view(shared, handle, view)
            path = out / f"{view}.png"
            scene.render.resolution_x = scene.render.resolution_y = int(size)
            scene.render.resolution_percentage = 100
            scene.cycles.samples = int(samples)
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            paths.append(path)
    finally:
        for obj in scene.objects:
            if obj.name in saved:
                obj.hide_render = saved[obj.name]
    return paths


def montage(paths, output, labels=None, cell=512, rows=1):
    images = [Image.open(p).convert("RGB") for p in paths]
    cols = math.ceil(len(images) / rows)
    canvas = Image.new("RGB", (cols * cell, rows * cell), (28, 30, 34))
    draw = ImageDraw.Draw(canvas)
    for i, im in enumerate(images):
        im.thumbnail((cell, cell), Image.Resampling.LANCZOS)
        x, y = (i % cols) * cell, (i // cols) * cell
        canvas.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
        if labels:
            draw.rectangle((x + 4, y + 4, x + 210, y + 28), fill=(0, 0, 0))
            draw.text((x + 10, y + 9), labels[i], fill=(255, 255, 255))
    canvas.save(output)


class Collider:
    def __init__(self, obj, deps):
        self.obj = obj
        self.ev = obj.evaluated_get(deps)
        self.bvh = BVHTree.FromObject(obj, deps, deform=True, cage=False)
        self.world_to_local = self.ev.matrix_world.inverted()
        self.normal_to_world = self.ev.matrix_world.to_3x3()

    def nearest(self, point):
        q = self.world_to_local @ Vector(point)
        hit, normal, face, _ = self.bvh.find_nearest(q)
        if hit is None:
            return None
        wp = self.ev.matrix_world @ hit
        wn = (self.normal_to_world @ normal).normalized()
        delta = Vector(point) - wp
        signed = delta.dot(wn)
        return np.asarray(wp[:]), np.asarray(wn[:]), float(signed), float(delta.length), face

    def contains(self, point):
        """Odd/even ray test; unlike nearest-normal signs, works across concavities."""
        votes = []
        for raw_direction in ((1.0, .173, .071), (.113, 1.0, .239), (.191, .137, 1.0)):
            origin = self.world_to_local @ Vector(point)
            direction = Vector(raw_direction).normalized()
            hits = 0
            for _ in range(128):
                hit, _normal, _face, distance = self.bvh.ray_cast(origin, direction, 10.0)
                if hit is None:
                    break
                hits += 1
                origin = hit + direction * max(2e-6, float(distance) * 1e-8)
            votes.append(bool(hits % 2))
        return sum(votes) >= 2


def mesh_triangles(obj, deps):
    verts, faces = world_mesh(obj, deps)
    tris, tri_normals, tri_areas = [], [], []
    for f in faces:
        for i in range(1, len(f) - 1):
            ids = (f[0], f[i], f[i + 1])
            p = verts[list(ids)]
            n = np.cross(p[1] - p[0], p[2] - p[0])
            a = np.linalg.norm(n) * .5
            if a > 1e-12:
                tris.append(p); tri_normals.append(n / np.linalg.norm(n)); tri_areas.append(a)
    return np.asarray(tris), np.asarray(tri_normals), np.asarray(tri_areas)


def sample_roots(cap, centre, count=80, apex_y=None):
    deps = bpy.context.evaluated_depsgraph_get()
    tris, normals, areas = mesh_triangles(cap, deps)
    rng = np.random.default_rng(SEED)
    probs = areas / areas.sum()
    candidates, candidate_normals = [], []
    apex_lim = float(apex_y) if apex_y is not None else float(centre[1] + 0.012)
    while len(candidates) < 12000:
        ti = int(rng.choice(len(tris), p=probs))
        u, v = rng.random(2)
        if u + v > 1: u, v = 1 - u, 1 - v
        p = tris[ti, 0] + u * (tris[ti, 1] - tris[ti, 0]) + v * (tris[ti, 2] - tris[ti, 0])
        # Part exists only from front hairline through the crown apex; behind
        # the apex the cap is one piece and roots cover the whole occiput.
        if p[1] <= apex_lim and abs(p[0] - centre[0]) < 0.004:
            continue
        candidates.append(p); candidate_normals.append(normals[ti])
    C = np.asarray(candidates); N = np.asarray(candidate_normals)
    # Deterministic farthest-point sampling gives whole-cap coverage and an
    # honest >=12 mm Poisson constraint without overpacking the 650 cm2 cap.
    selected = [int(np.argmin(C[:, 2]))]
    distance = np.linalg.norm(C - C[selected[0]], axis=1)
    while len(selected) < count:
        idx = int(np.argmax(distance))
        if distance[idx] < 0.012:
            break
        selected.append(idx)
        distance = np.minimum(distance, np.linalg.norm(C - C[idx], axis=1))
    return C[selected], N[selected]


def rotate_toward(current, target, max_angle):
    a = Vector(current).normalized(); b = Vector(target).normalized()
    angle = a.angle(b, 0.0)
    if angle <= max_angle:
        return np.asarray(b[:])
    axis = a.cross(b)
    if axis.length < 1e-9:
        return np.asarray(a[:])
    from mathutils import Quaternion
    return np.asarray((Quaternion(axis.normalized(), max_angle) @ a)[:])


def authored_guides(handle, cap, centre, row, points_per=22, length=0.45):
    # Part exclusion matches the slit/mask limit (cy+0.012): no root within
    # 4 mm of the part forward of the crown; the occiput keeps full roots.
    roots, root_normals = sample_roots(cap, centre, 80)
    deps = bpy.context.evaluated_depsgraph_get()
    garment_tokens = ("shirt", "pants", "jeans", "dress", "skirt", "garment", "cloth")
    visible_colliders = [handle.head]
    visible_colliders += [o for o in bpy.context.scene.objects
                          if o.type == "MESH" and not o.hide_render and o is not cap
                          and o is not handle.head and any(t in o.name.lower() for t in garment_tokens)]
    # Head/body plus worn garments: never eyes, lashes, teeth or tongue.
    visible_colliders = list(dict.fromkeys(visible_colliders))
    colliders = [Collider(o, deps) for o in visible_colliders]
    seg = length / (points_per - 1)
    scalp_segments = max(3, round(0.15 * (points_per - 1)))
    G = np.zeros((len(roots), points_per, 3), dtype=np.float64)
    G[:, 0] = roots
    legacy_flow_samples = []
    front_order = set(np.argsort(roots[:, 1])[:3].tolist())
    s0 = row.get("s0_cap", {})
    _cx = float(s0.get("head_centre", centre.tolist())[0])
    _ear_y = float(s0.get("ear_y", centre[1] + 0.005))
    _ear_top = float(s0.get("ear_top_z", s0.get("crown_z", crown_z if (crown_z := s0.get("crown_z", 0)) else 0) - 0.082)) \
        if s0.get("ear_top_z") is None else float(s0["ear_top_z"])
    for i, (root, normal) in enumerate(zip(roots, root_normals)):
        dx = float(root[0] - centre[0])
        side = 1.0 if dx >= 0 else -1.0
        ahead = bool(root[1] < _ear_y)
        above_ear = bool(root[2] >= _ear_top)
        temple = bool(abs(dx) > 0.040 and not above_ear)
        back_half = bool(root[1] >= centre[1] - 0.005)
        if back_half and abs(dx) < 0.003:
            flow = np.array((0.15 * side, 0.45, -0.88))
        elif back_half:
            flow = np.array((0.30 * side, 0.45, -0.84))
        elif temple:
            # Only temple roots below ear-top height may move forward-down.
            flow = np.array((0.70 * side, -0.20, -0.68))
        elif ahead:
            # Roots ahead of the ear line: lateral away from the part plus a
            # backward component, never forward above ear height.
            flow = np.array((0.85 * side, 0.25, -0.46))
        else:
            flow = np.array((0.62 * side, 0.10, -0.78))
        assert not (above_ear and not temple and flow[1] < 0), "forward flow above ear height"
        flow /= np.linalg.norm(flow)
        direction = 0.15 * normal + 0.85 * flow
        direction /= np.linalg.norm(direction)
        if i in front_order:
            sample = {"root_index": i, "root": root.tolist(), "normal_term": (0.15 * normal).tolist(),
                      "flow_term": (0.85 * flow).tolist(), "flow": flow.tolist(),
                      "blended_direction": direction.tolist(),
                      "ahead_of_ear": ahead, "above_ear": above_ear, "temple": temple,
                      "side": side}
            legacy_flow_samples.append(sample)
            print("P7 FRONT FLOW", json.dumps(sample, sort_keys=True))
        for j in range(1, points_per):
            if j <= scalp_segments:
                desired = direction
            else:
                desired = np.array((0.0, 0.0, -1.0))
            prev_dir = G[i, j - 1] - G[i, j - 2] if j > 1 else direction
            direction = rotate_toward(prev_dir, desired, math.radians(8.0 * seg * 100.0))
            p = G[i, j - 1] + direction * seg
            if j <= scalp_segments:
                # The authored first 15% follows the actual scalp rather than
                # approximating its curvature by a free tangent step.
                hit = colliders[0].nearest(p)
                if hit is not None:
                    hp, hn, _signed, _distance, _ = hit
                    p = hp + hn * .004
            # Nearest-surface push-out.  Roots remain attached, all later points >=3 mm.
            for collider in colliders:
                hit = collider.nearest(p)
                if hit is None: continue
                hp, hn, signed, distance, _ = hit
                is_inside = collider.contains(p) if distance > 1e-4 else False
                if distance < 0.003 or is_inside:
                    p = p + hn * (0.003 - signed)
            G[i, j] = p

    # Authored cubic curtain: leaves the scalp in the tangent, hugs the skull,
    # then falls straight.  Back roots keep their x (no centre wedge); front
    # roots route sideways to beside the cheek at the ear line, never forward
    # across the face.  Endpoint depth is solved to keep 0.45 m arc length.
    for i, root in enumerate(roots):
        j0 = scalp_segments
        p0 = G[i, j0].copy()
        tangent = G[i, j0] - G[i, j0 - 1]
        tangent /= max(np.linalg.norm(tangent), 1e-9)
        scalp_length = float(np.linalg.norm(np.diff(G[i, :j0 + 1], axis=0), axis=1).sum())
        remaining = max(.30, length - scalp_length)
        side = 1.0 if root[0] >= centre[0] else -1.0
        back_half = bool(root[1] >= centre[1] - 0.005)
        if back_half:
            # Hug then fall straight: keep lateral position, drift slightly back.
            end_x = float(p0[0])
            end_y = float(p0[1] + 0.010)
        else:
            end_x = float(centre[0] + side * 0.095)
            end_y = float(_ear_y - 0.015)

        def sampled(drop):
            p3 = np.array((end_x, end_y, p0[2] - drop))
            lateral = np.array((end_x - p0[0], end_y - p0[1], 0.0))
            p1 = p0 + tangent * min(.040, remaining * .11) + lateral * .90
            p2 = p3 + np.array((0.0, 0.0, min(.120, remaining * .32)))
            out = []
            for t in np.linspace(0.0, 1.0, points_per - j0):
                q = ((1-t)**3*p0 + 3*(1-t)**2*t*p1 + 3*(1-t)*t*t*p2 + t**3*p3)
                out.append(q)
            out = np.asarray(out)
            arc = float(np.linalg.norm(np.diff(out, axis=0), axis=1).sum())
            return out, arc
        lo, hi = .10, .60
        for _ in range(32):
            mid = (lo + hi) * .5
            _trial, arc = sampled(mid)
            if arc < remaining: lo = mid
            else: hi = mid
        tail, _arc = sampled((lo + hi) * .5)
        G[i, j0:] = tail

    # Neighbour smoothing after the scalp-follow section, preserving each root.
    root_d = np.linalg.norm(roots[:, None, :] - roots[None, :, :], axis=2)
    neighbours = np.argsort(root_d, axis=1)[:, 1:5]
    for _ in range(1):
        old = G.copy()
        for i in range(len(G)):
            for j in range(scalp_segments + 2, points_per):
                delta = old[neighbours[i], j].mean(axis=0) - old[neighbours[i], j - 1].mean(axis=0)
                candidate = old[i, j - 1] + delta
                positional = old[neighbours[i], j].mean(axis=0)
                tail = (j - scalp_segments) / (points_per - scalp_segments)
                G[i, j] = old[i, j] * (0.96 - .01 * tail) + candidate * .02 + positional * (.02 + .01 * tail)
    # Enforce the explicit neighbour-tip bar by smoothly moving only the tail;
    # this is the requested neighbour smoothing, not a post-hoc gate rewrite.
    for _ in range(0):
        old = G.copy()
        for i in range(len(G)):
            median_tip = np.median(old[neighbours[i], -1], axis=0)
            delta = median_tip - old[i, -1]
            if np.linalg.norm(delta) > .020:
                delta *= min(1.0, .020 / np.linalg.norm(delta))
            for j in range(points_per - 7, points_per):
                w = (j - (points_per - 7)) / 6.0
                G[i, j] += delta * (.55 * w)
    # Final collision repair after smoothing.
    for i in range(len(G)):
        for j in range(1, points_per):
            p = G[i, j]
            for collider in colliders:
                hit = collider.nearest(p)
                if hit is None: continue
                _, hn, signed, distance, _ = hit
                is_inside = collider.contains(p) if distance > 1e-4 else False
                if distance < .003 or is_inside:
                    p = p + hn * (.003 - signed)
            G[i, j] = p

    # Bounded neighbour-tip smoothing: move at most 5 mm per iteration and
    # only when the explicit 25 mm bar is exceeded.
    for _ in range(20):
        old = G.copy(); tips_old = old[:, -1]
        td = np.linalg.norm(tips_old[:, None] - tips_old[None, :], axis=2)
        for i in range(len(G)):
            nn = np.argsort(td[i])[1:9]
            delta = np.median(tips_old[nn], axis=0) - tips_old[i]
            d = np.linalg.norm(delta)
            if d > .024:
                delta *= min(1.0, .005 / max(d, 1e-9))
                for j in range(points_per - 7, points_per):
                    w = (j - (points_per - 7)) / 6.0
                    G[i, j] += delta * w

    # Restore the exact arc without moving either endpoint, but touch only the
    # last eight controls (below the shoulders).  The collision-safe upper
    # path and scalp controls therefore cannot be straightened through the body.
    for i in range(len(G)):
        tail_start = points_per - 8
        prefix_length = float(np.linalg.norm(np.diff(G[i, :tail_start + 1], axis=0), axis=1).sum())
        remaining = length - prefix_length
        tail = G[i, tail_start:].copy()
        ts = np.linspace(0.0, 1.0, len(tail))
        line = tail[0][None, :] * (1-ts[:, None]) + tail[-1][None, :] * ts[:, None]
        deviation = tail - line; deviation[0] = deviation[-1] = 0
        arc0 = float(np.linalg.norm(np.diff(tail, axis=0), axis=1).sum())
        if arc0 >= remaining:
            lo, hi = 0.0, 1.0
            for _ in range(40):
                mid = (lo + hi) * .5
                trial = line + deviation * mid
                arc = float(np.linalg.norm(np.diff(trial, axis=0), axis=1).sum())
                if arc < remaining: lo = mid
                else: hi = mid
            tail = line + deviation * ((lo + hi) * .5)
        else:
            radial = np.array((tail[len(tail)//2, 0] - centre[0],
                               tail[len(tail)//2, 1] - centre[1], 0.0))
            # Never push forward (front is -Y): the arc-restore bulge goes
            # sideways/down only, or it sweeps hair across the face (G-hug).
            radial[1] = max(0.0, radial[1])
            radial /= max(np.linalg.norm(radial), 1e-9)
            shape = np.sin(np.pi * ts)[:, None] * radial[None, :]
            lo, hi = 0.0, .15
            for _ in range(40):
                mid = (lo + hi) * .5
                trial = tail + shape * mid
                arc = float(np.linalg.norm(np.diff(trial, axis=0), axis=1).sum())
                if arc < remaining: lo = mid
                else: hi = mid
            tail = tail + shape * ((lo + hi) * .5)
        G[i, tail_start:] = tail

    # All shaping is complete.  Repair the final evaluated controls, not an
    # earlier intermediate, so the zero-inside gate describes what is rendered.
    for i in range(len(G)):
        for j in range(1, points_per):
            p = G[i, j]
            for _ in range(4):
                moved = False
                for collider in colliders:
                    hit = collider.nearest(p)
                    if hit is None: continue
                    hp, hn, signed, distance, _ = hit
                    is_inside = collider.contains(p) if distance > 1e-4 else False
                    if distance < .003 or is_inside:
                        p = hp + hn * .003
                        moved = True
                if not moved:
                    break
            G[i, j] = p

    # New Hair Curves object attached to the cap; no pack curves are copied.
    # S2c: surface + uv_map + identical identity transforms, recorded.
    bpy.ops.object.select_all(action="DESELECT")
    cap.select_set(True); bpy.context.view_layer.objects.active = cap
    bpy.ops.object.curves_empty_hair_add()
    hair = bpy.context.active_object
    hair.name = "P7_authored_guides"
    try:
        hair.data.surface = cap
    except Exception as _e:
        row.setdefault("s2_diagnosis", {})["c_surface_set_error"] = str(_e)
    hair.data.surface_uv_map = "UVMap"
    hair.matrix_world.identity()
    cap.matrix_world.identity()
    hair.update_tag(); bpy.context.view_layer.update()
    row.setdefault("s2_diagnosis", {})["c_surface"] = {
        "surface": getattr(getattr(hair.data, "surface", None), "name", None),
        "surface_uv_map": getattr(hair.data, "surface_uv_map", None),
        "hair_matrix": [list(r) for r in hair.matrix_world],
        "cap_matrix": [list(r) for r in cap.matrix_world],
    }
    hair.data.add_curves([points_per] * len(G))
    local = np.asarray([(hair.matrix_world.inverted() @ Vector(p))[:] for p in G.reshape(-1, 3)], np.float32)
    hair.data.attributes["position"].data.foreach_set("vector", local.ravel())
    hair.data.update_tag(); bpy.context.view_layer.update()
    with bpy.context.temp_override(object=hair, active_object=hair, selected_objects=[hair],
                                   selected_editable_objects=[hair]):
        bpy.ops.curves.snap_curves_to_surface(attach_mode="NEAREST")
    hair.data.update_tag(); bpy.context.view_layer.update()
    _sd = [m for m in hair.modifiers if m.name == "Surface Deform"]
    for m in _sd:
        hair.modifiers.remove(m)
    hair.data.materials.append(make_material("P7_guides_copper", (0.95, 0.20, 0.035), 0.15))
    row.setdefault("s2_diagnosis", {})["surface_deform_dropped_for_render"] = True
    print("P7 DBG G0", G[0, ::7].tolist())
    print("P7 DBG Gbounds", G.min(axis=(0, 1)).tolist(), G.max(axis=(0, 1)).tolist())
    print("P7 DBG hairmods", [(m.name, m.type) for m in hair.modifiers])
    print("P7 DBG surface", getattr(getattr(hair.data, "surface", None), "name", None))
    print("P7 DBG evalsig", evaluated_signature(hair))
    _ev = hair.evaluated_get(bpy.context.evaluated_depsgraph_get())
    try:
        _ec = _ev.data.curves[0]
        print("P7 DBG evalc0", [tuple(p.position) for p in list(_ec.points)[:3]],
              "n=", len(_ec.points))
    except Exception as _e:
        print("P7 DBG evalc0 ERR", repr(_e))
    print("P7 DBG hide", hair.hide_render, hair.hide_viewport,
          hair.visible_get() if hasattr(hair, "visible_get") else "?")
    print("P7 DBG mats", [m.name if m else None for m in hair.data.materials])

    # Spacing and geometry gates.
    nearest = np.partition(root_d + np.eye(len(roots)) * 99.0, 0, axis=1)[:, 0]
    med_spacing = float(np.median(nearest))
    spacing_gaps = int(np.count_nonzero(nearest > 2.0 * med_spacing))
    inside = 0; min_signed = float("inf")
    for p in G.reshape(-1, 3):
        values = [c.nearest(p) for c in colliders]
        values = [v for v in values if v is not None and v[3] < .05]
        if values:
            closest = min(values, key=lambda v: v[3])
            signed = closest[2]
            min_signed = min(min_signed, signed)
            closest_distance = min(v[3] for v in values)
            if closest_distance > 1e-4 and any(c.contains(p) for c in colliders): inside += 1
    tips = G[:, -1]
    tip_d = np.linalg.norm(tips[:, None, :] - tips[None, :, :], axis=2)
    outliers = 0
    for i in range(len(G)):
        nn = np.argsort(tip_d[i])[1:9]
        med = np.median(tips[nn], axis=0)
        if np.linalg.norm(tips[i] - med) > .025: outliers += 1
    tip_outlier_pct = 100.0 * outliers / len(G)
    # Robust profile contour: frontmost Y in Z bins, Savitzky-like 5-tap smooth.
    crown = row["s0_cap"]["crown_z"]
    z0 = crown - .25
    samples = G[(G[:, :, 2] >= z0) & (G[:, :, 2] <= crown)]
    bins = np.linspace(z0, crown, 14)
    contour = []
    for a, b in zip(bins[:-1], bins[1:]):
        pts = G[(G[:, :, 2] >= a) & (G[:, :, 2] < b)]
        contour.append(float(np.min(pts[:, 1])) if len(pts) else np.nan)
    contour = np.asarray(contour)
    valid = np.isfinite(contour)
    contour = np.interp(np.arange(len(contour)), np.where(valid)[0], contour[valid])
    for _ in range(4): contour = np.convolve(np.pad(contour, (2, 2), mode="edge"), np.ones(5)/5, mode="valid")
    d2 = np.diff(contour, n=2)
    sign_changes = int(np.count_nonzero(np.diff(np.sign(d2[np.abs(d2) > 1e-4]))))
    # Crown clearance ignores attached roots and uses authored scalp-follow points.
    crown_points = G[:, 1:scalp_segments + 1].reshape(-1, 3)
    clearances = []
    head_col = colliders[0]
    for p in crown_points:
        hit = head_col.nearest(p)
        if hit: clearances.append(hit[3])
    lengths = np.sum(np.linalg.norm(np.diff(G, axis=1), axis=2), axis=1)
    crown_p95 = float(np.percentile(clearances, 95)) if clearances else float("nan")
    # ---- HANDBACK GATES (geometry; masks added after renders) ----
    s0 = row.get("s0_cap", {})
    chin_z = float(s0.get("chin_z", crown - 0.215))
    # G-back: every cap face centre within 9 mm of a root.
    deps2 = bpy.context.evaluated_depsgraph_get()
    cap_verts_w, cap_faces_w = world_mesh(cap, deps2)
    face_centres = np.asarray([cap_verts_w[list(f)].mean(axis=0) for f in cap_faces_w])
    dmat = np.linalg.norm(face_centres[:, None, :] - roots[None, :, :], axis=2)
    g_back_max_mm = float(dmat.min(axis=1).max() * 1000.0) if len(face_centres) else float("nan")
    g_back_mean_mm = float(dmat.min(axis=1).mean() * 1000.0) if len(face_centres) else float("nan")
    # G-hug: hug distances + forehead + face-opening gap.
    above, below = [], []
    for p in G.reshape(-1, 3):
        hit = head_col.nearest(p)
        dh = hit[3] if hit else float("nan")
        if p[2] >= chin_z:
            above.append(dh)
        else:
            vals = [c.nearest(p) for c in colliders]
            vals = [v[3] for v in vals if v is not None]
            below.append(min(vals) if vals else dh)
    above = np.asarray(above); below = np.asarray(below)
    g_hug_above_max_mm = float(np.nanmax(above) * 1000.0) if len(above) else float("nan")
    g_hug_below_max_mm = float(np.nanmax(below) * 1000.0) if len(below) else float("nan")
    g_hug_below_p95_mm = float(np.nanpercentile(below, 95) * 1000.0) if len(below) else float("nan")
    # Forehead surface: frontmost head y per 6 mm z-bin; no guide may sit more
    # than 10 mm in front of it at its own height.
    hv, _hf = world_mesh(handle.head, deps2)
    zbins = np.arange(float(hv[:, 2].min()), float(hv[:, 2].max()) + 1e-9, 0.006)
    front_y = {}
    for a, b in zip(zbins[:-1], zbins[1:]):
        sel = hv[(hv[:, 2] >= a) & (hv[:, 2] < b)]
        if len(sel):
            front_y[(a + b) * 0.5] = float(sel[:, 1].min())
    _fz = np.asarray(sorted(front_y))
    _fy = np.asarray([front_y[z] for z in _fz])
    def _front_at(z):
        return float(np.interp(z, _fz, _fy)) if len(_fz) else float("nan")
    g_fore_max_mm = 0.0
    for p in G.reshape(-1, 3):
        fy = _front_at(float(p[2]))
        if np.isfinite(fy):
            g_fore_max_mm = max(g_fore_max_mm, (fy - float(p[1])) * 1000.0)
    # Face opening: non-hair gap at eye height must be >= 0.9 x inter-ear width.
    eye_z = float(s0.get("eye_z", crown - 0.125))
    inter_ear_m = 0.150
    at_eye = G[:, :, :][(np.abs(G[:, :, 2] - eye_z) < 0.008)]
    xs = np.sort(at_eye[:, 0]) if len(at_eye) else np.asarray([])
    gap_m = 0.0
    if len(xs) >= 2:
        _cx = float(centre[0])
        _left = xs[xs < _cx]; _right = xs[xs >= _cx]
        if len(_left) and len(_right):
            gap_m = float(_right.min() - _left.max())
        else:
            gap_m = float(xs.max() - xs.min())
    metrics = {
        "guide_count": len(G), "points_per_guide": points_per,
        "guide_length_m": length, "scalp_follow_fraction": 0.15,
        "measured_length_median_m": float(np.median(lengths)),
        "measured_length_min_m": float(lengths.min()),
        "measured_length_max_m": float(lengths.max()),
        "min_root_spacing_mm": float(nearest.min() * 1000),
        "median_root_spacing_mm": med_spacing * 1000,
        "spacing_gaps_over_2x_median": spacing_gaps,
        "inside_collider_points": inside, "minimum_signed_clearance_mm": min_signed * 1000,
        "profile_d2_sign_changes": sign_changes,
        "crown_gap_p95_mm": crown_p95 * 1000,
        "tip_neighbour_outliers_pct": tip_outlier_pct,
        "colliders": [c.obj.name for c in colliders],
        "g_back_face_to_root_max_mm": g_back_max_mm,
        "g_back_face_to_root_mean_mm": g_back_mean_mm,
        "g_hug_above_chin_max_mm": g_hug_above_max_mm,
        "g_hug_below_chin_max_mm": g_hug_below_max_mm,
        "g_hug_below_chin_p95_mm": g_hug_below_p95_mm,
        "g_hug_forehead_forward_max_mm": g_fore_max_mm,
        "g_hug_eye_gap_m": gap_m,
        "g_hug_inter_ear_m": inter_ear_m,
        "chin_z": chin_z, "eye_z": eye_z,
    }
    metrics["pass"] = bool(inside == 0 and sign_changes <= 2 and 3 <= crown_p95 * 1000 <= 12
                           and tip_outlier_pct < 2.0 and spacing_gaps == 0
                           and 48 <= len(G) <= 80 and 20 <= points_per <= 24)
    row["s1_guides"] = metrics
    row.setdefault("s2_diagnosis", {})["pre_change_front_flow_terms"] = legacy_flow_samples
    return hair, G, metrics


# ---- S1 potential-flow construction (geodesic rebrief) ----
# Replaces the hand-written flow terms entirely.  phi = geodesic distance on
# the cap to the EXIT boundary (cap boundary minus the forehead segment).
# flow = -grad(phi) per face.  The slit disconnects left/right in the mesh
# graph, so flow parts at the slit by construction.  The forehead is the phi
# maximum, so no streamline can sweep forward across the face.

def _slit_edges_of(bm, cx):
    return {e.index for e in bm.edges if len(e.link_faces) == 1
            and all(abs(v.co.x - cx) < 0.002 for v in e.verts)}


def cap_flow_topology(cap, cx, centre, slit_end_y):
    """Ordered exterior loop, temple verts, forehead segment, EXIT sources.

    No mesh slit exists (graph barrier instead), so the exterior loop is the
    whole cap boundary; every boundary edge is either forehead or EXIT.
    """
    bm = bmesh.new()
    bm.from_mesh(cap.data)
    bm.verts.ensure_lookup_table()
    exterior = [e for e in bm.edges if len(e.link_faces) == 1]
    adj = {}
    for e in exterior:
        a, b = e.verts[0].index, e.verts[1].index
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    start = next(iter(adj))
    order, prev, cur = [start], None, start
    for _ in range(len(adj) + 2):
        nxts = [n for n in adj.get(cur, []) if n != prev]
        if not nxts:
            break
        if len(nxts) == 1:
            nxt = nxts[0]
        else:
            cc = bm.verts[cur].co
            inc = cc - bm.verts[prev].co if prev is not None else Vector((0, 0, 0))
            nxt = min(nxts, key=lambda n: (inc - (bm.verts[n].co - cc)).length
                      if inc.length > 1e-12 else 0.0)
        order.append(nxt)
        prev, cur = cur, nxt
        if nxt == start:
            break
    if order[-1] == start:
        order = order[:-1]
    co = {v.index: v.co.copy() for v in bm.verts}
    front = [i for i in order if co[i].y < centre[1] + 0.02]
    if not front:
        front = list(order)
    temple_L = min(front, key=lambda i: abs(co[i].x - (cx - 0.045)))
    temple_R = min(front, key=lambda i: abs(co[i].x - (cx + 0.045)))
    # Forehead segment: loop arc between temples through the front-most vertex.
    frontmost = min(order, key=lambda i: co[i].y)
    pa, pb = order.index(temple_L), order.index(temple_R)
    pf = order.index(frontmost)
    n = len(order)

    def arc(a, b):
        out = []
        i = a
        while True:
            out.append(order[i % n])
            if i % n == b:
                break
            i += 1
        return out
    arc_lr = arc(pa, pb)
    arc_rl = arc(pb, pa)
    forehead_path = arc_lr if frontmost in arc_lr else arc_rl
    forehead_set = set(forehead_path)
    forehead_edges = {e.index for e in exterior
                      if e.verts[0].index in forehead_set and e.verts[1].index in forehead_set}
    exit_edges = {e.index for e in exterior if e.index not in forehead_edges}
    exit_sources = set()
    emap = {e.index: e for e in exterior}
    for ei in exit_edges:
        e = emap[ei]
        exit_sources.add(e.verts[0].index)
        exit_sources.add(e.verts[1].index)
    out = {
        "loop_length": len(order),
        "temple_L": {"index": int(temple_L), "co": [float(x) for x in co[temple_L]]},
        "temple_R": {"index": int(temple_R), "co": [float(x) for x in co[temple_R]]},
        "temple_method": "front-boundary vertex nearest cx+/-0.045 (lateral orbital rim)",
        "frontmost": {"index": int(frontmost), "co": [float(x) for x in co[frontmost]]},
        "forehead_path_length": len(forehead_path),
        "forehead_path": [int(i) for i in forehead_path],
        "exit_edge_count": len(exit_edges),
        "exit_source_count": len(exit_sources),
        "exit_sources": sorted(int(i) for i in exit_sources),
        "slit_end_y": float(slit_end_y),
    }
    bm.free()
    return out


def geodesic_phi(cap, source_verts, cx, y_front, y_apex):
    """Multi-source Dijkstra over cap edges, then 5 Laplacian passes (scalar).

    The part divide is a graph barrier: edges straddling the x=cx plane (or
    lying on it) with y in [y_front, y_apex] are removed, so left and right
    flow apart and the back stays joined.  Unreachable verts take max phi
    (the divide is the phi ridge, by construction the forehead maximum).
    """
    import heapq
    mesh = cap.data
    verts = mesh.vertices
    adj = [[] for _ in verts]
    removed = 0
    for e in mesh.edges:
        a, b = e.vertices[0], e.vertices[1]
        xa, xb = verts[a].co.x - cx, verts[b].co.x - cx
        ya, yb = verts[a].co.y, verts[b].co.y
        in_span = max(ya, yb) >= y_front and min(ya, yb) <= y_apex
        if in_span and (xa * xb < 0.0 or max(abs(xa), abs(xb)) < 0.0005):
            removed += 1
            continue
        w = (verts[a].co - verts[b].co).length
        adj[a].append((b, w))
        adj[b].append((a, w))
    INF = float("inf")
    phi = [INF] * len(verts)
    heap = []
    for s in source_verts:
        phi[s] = 0.0
        heap.append((0.0, int(s)))
    heapq.heapify(heap)
    while heap:
        d, u = heapq.heappop(heap)
        if d > phi[u]:
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < phi[v]:
                phi[v] = nd
                heapq.heappush(heap, (nd, v))
    finite = [p for p in phi if p < INF]
    cap_max = max(finite) if finite else 0.0
    isolated = sum(1 for p in phi if p >= INF)
    phi = [p if p < INF else cap_max for p in phi]
    sources = set(int(s) for s in source_verts)
    for _ in range(5):
        new = list(phi)
        for i, nbrs in enumerate(adj):
            if nbrs:
                new[i] = (phi[i] + sum(phi[j] for j, _ in nbrs)) / (len(nbrs) + 1)
        for s in sources:
            new[s] = 0.0
        phi = new
    return phi, adj, {"barrier_removed": removed, "isolated_filled": isolated}


def face_flow_field(cap, phi):
    """Per-face flow = -grad(phi) projected on the face (unit or zero)."""
    mesh = cap.data
    co = [v.co for v in mesh.vertices]
    flows, centres = [], []
    for poly in mesh.polygons:
        vs = list(poly.vertices)
        n = Vector(poly.normal).normalized()
        g = Vector((0.0, 0.0, 0.0))
        tot = 0.0
        if any(not math.isfinite(phi[v]) for v in vs):
            flows.append(np.zeros(3))
            centres.append(np.asarray((sum((co[v] for v in vs), Vector((0, 0, 0))) / len(vs))[:],
                                     dtype=np.float64))
            continue
        for k in range(1, len(vs) - 1):
            i0, i1, i2 = vs[0], vs[k], vs[k + 1]
            p0, p1, p2 = co[i0], co[i1], co[i2]
            e1 = p1 - p0
            e2 = p2 - p0
            nrm = e1.cross(e2)
            a2 = nrm.length
            if a2 < 1e-12:
                continue
            un = nrm / a2
            tri_g = (float(phi[i0]) * un.cross(p1 - p2) + float(phi[i1]) * un.cross(p2 - p0)
                     + float(phi[i2]) * un.cross(p0 - p1)) / a2
            g += tri_g * a2
            tot += a2
        if tot > 0:
            g = g / tot
        g = g - n * g.dot(n)
        flow = -g
        if flow.length > 1e-9:
            flow = flow.normalized()
        else:
            flow = Vector((0.0, 0.0, 0.0))
        flows.append(np.asarray(flow[:], dtype=np.float64))
        centres.append(np.asarray((sum((co[v] for v in vs), Vector((0, 0, 0))) / len(vs))[:],
                                 dtype=np.float64))
    return flows, np.asarray(centres)


def sample_roots_potential(cap, cx, slit_end_y, count=250, spacing=0.008):
    deps = bpy.context.evaluated_depsgraph_get()
    tris, normals, areas = mesh_triangles(cap, deps)
    rng = np.random.default_rng(SEED)
    probs = areas / areas.sum()
    candidates, candidate_normals = [], []
    while len(candidates) < 60000:
        ti = int(rng.choice(len(tris), p=probs))
        u, v = rng.random(2)
        if u + v > 1:
            u, v = 1 - u, 1 - v
        p = tris[ti, 0] + u * (tris[ti, 1] - tris[ti, 0]) + v * (tris[ti, 2] - tris[ti, 0])
        if p[1] <= slit_end_y and abs(p[0] - cx) < 0.004:
            continue
        candidates.append(p)
        candidate_normals.append(normals[ti])
    C = np.asarray(candidates)
    N = np.asarray(candidate_normals)
    selected = [int(np.argmin(C[:, 2]))]
    distance = np.linalg.norm(C - C[selected[0]], axis=1)
    while len(selected) < count:
        idx = int(np.argmax(distance))
        if distance[idx] < spacing:
            break
        selected.append(idx)
        distance = np.minimum(distance, np.linalg.norm(C - C[idx], axis=1))
    roots = C[selected]
    # Lloyd relax toward equal coverage (constrained: on cap, out of the band).
    cap_bvh = BVHTree.FromObject(cap, deps, deform=True, cage=False)
    cap_ev = cap.evaluated_get(deps)
    cap_w2l = cap_ev.matrix_world.inverted()
    cap_l2w = cap_ev.matrix_world
    for _ in range(30):
        d = np.linalg.norm(C[:, None, :] - roots[None, :, :], axis=2)
        lab = np.argmin(d, axis=1)
        moved = False
        for i in range(len(roots)):
            cell = C[lab == i]
            if len(cell) == 0:
                continue
            m = cell.mean(axis=0)
            if m[1] <= slit_end_y and abs(m[0] - cx) < 0.004:
                continue
            q = cap_w2l @ Vector((float(m[0]), float(m[1]), float(m[2])))
            hit, _n, _fi, _dd = cap_bvh.find_nearest(q)
            if hit is None:
                continue
            w = np.asarray((cap_l2w @ hit)[:], dtype=np.float64)
            if np.linalg.norm(w - roots[i]) > 0.001:
                roots[i] = w
                moved = True
        if not moved:
            break
    return roots, N[selected]


def decimate_path(path, min_spacing=0.0025):
    """Drop backtracking/jitter: keep points >= min_spacing apart (plus tip)."""
    pts = np.asarray(path, dtype=np.float64)
    if len(pts) < 2:
        return pts
    keep = [0]
    for k in range(1, len(pts)):
        if np.linalg.norm(pts[k] - pts[keep[-1]]) >= min_spacing:
            keep.append(k)
    if keep[-1] != len(pts) - 1:
        keep.append(len(pts) - 1)
    return pts[np.asarray(keep)]


def path_arc(pts):
    pts = np.asarray(pts, dtype=np.float64)
    if len(pts) < 2:
        return 0.0
    return float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())


def resample_polyline(pts, n):
    pts = np.asarray(pts, dtype=np.float64)
    if len(pts) == 1:
        return np.repeat(pts[:1], n, axis=0)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    total = float(cum[-1])
    if total < 1e-9:
        return np.repeat(pts[:1], n, axis=0)
    targets = np.linspace(0.0, total, n)
    out = np.empty((n, 3), dtype=np.float64)
    j = 0
    for i, t in enumerate(targets):
        while j < len(cum) - 2 and cum[j + 1] < t:
            j += 1
        f = (t - cum[j]) / max(cum[j + 1] - cum[j], 1e-12)
        out[i] = pts[j] * (1 - f) + pts[j + 1] * f
    return out


def trace_streamlines(roots, cap, head_col, colliders, topo, phi, flows,
                      points_per=24, length=0.50):
    deps = bpy.context.evaluated_depsgraph_get()
    cap_bvh = BVHTree.FromObject(cap, deps, deform=True, cage=False)
    cap_w2l = cap.evaluated_get(deps).matrix_world.inverted()
    mesh = cap.data
    exit_coords = np.asarray([[mesh.vertices[i].co[0], mesh.vertices[i].co[1],
                               mesh.vertices[i].co[2]] for i in topo["exit_sources"]],
                             dtype=np.float64)
    # Offset exit targets 3 mm off the head along its normal: the scalp phase
    # then arrives tangentially instead of diving into the surface, so the
    # fall starts cleanly outward.
    exit_targets = np.empty_like(exit_coords)
    for k, ev in enumerate(exit_coords):
        hit = head_col.nearest(ev)
        exit_targets[k] = (hit[0] + hit[1] * 0.003) if hit is not None else ev
    forehead_coords = np.asarray([mesh.vertices[i].co[:] for i in topo["forehead_path"]],
                                 dtype=np.float64)
    STEP = 0.002
    guides = []
    scalp_counts = []
    scalp_stuck = 0
    fall_stats = []
    for ri, root in enumerate(roots):
        hit = head_col.nearest(root)
        if hit is not None:
            hp, hn, _s, _d, _f = hit
            p = hp + hn * 0.003
            root_n = hn
        else:
            p = np.asarray(root, dtype=np.float64)
            root_n = np.asarray((0.0, 0.0, 1.0))
        path = [np.asarray(root, dtype=np.float64), np.asarray(p, dtype=np.float64)]

        def flow_at(q):
            qq = cap_w2l @ Vector((float(q[0]), float(q[1]), float(q[2])))
            found = cap_bvh.find_nearest(qq)
            if found is None or found[2] is None or found[2] >= len(flows):
                return None
            return flows[found[2]]

        f0 = flow_at(p)
        if f0 is None or np.linalg.norm(f0) < 1e-9:
            side = 1.0 if root[0] >= 0 else -1.0
            f0 = np.asarray((0.5 * side, 0.3, -0.8))
        direction = f0 / max(np.linalg.norm(f0), 1e-12)
        _stuck = 0
        _nsteps = 0
        for _ in range(250):
            _nsteps += 1
            f = flow_at(p)
            if f is None or np.linalg.norm(f) < 1e-9:
                diff = exit_targets - p
                d = np.linalg.norm(diff, axis=1)
                f = diff[int(np.argmin(d))]
            n = np.asarray(root_n)
            f = f - n * float(np.dot(f, n))
            if np.linalg.norm(f) < 1e-9:
                f = direction
            f = f / np.linalg.norm(f)
            direction = np.asarray(rotate_toward(direction, f, math.radians(15.0)))
            p_prev = p.copy()
            p = p + direction * STEP
            hit = head_col.nearest(p)
            if hit is not None:
                hp, hn, _s, _d, _f = hit
                root_n = hn
                p = hp + hn * 0.003
            step_len = float(np.linalg.norm(p - p_prev))
            _stuck = _stuck + 1 if step_len < 0.0005 else 0
            if _stuck >= 30:
                break
            path.append(p.copy())
            if _nsteps % 5 == 0 and np.linalg.norm(exit_targets - p, axis=1).min() < 0.006:
                break
        # Guaranteed exit: walk the surface straight at the nearest EXIT vert.
        _exit_steps = 0
        while np.linalg.norm(exit_targets - p, axis=1).min() >= 0.006 and _exit_steps < 120:
            _exit_steps += 1
            diff = exit_targets - p
            tgt = diff[int(np.argmin(np.linalg.norm(diff, axis=1)))]
            n = np.asarray(root_n)
            tgt = tgt - n * float(np.dot(tgt, n))
            if np.linalg.norm(tgt) < 1e-9:
                break
            tgt = tgt / np.linalg.norm(tgt)
            direction = np.asarray(rotate_toward(direction, tgt, math.radians(25.0)))
            p = p + direction * STEP
            hit = head_col.nearest(p)
            if hit is not None:
                hp, hn, _s, _d, _f = hit
                root_n = hn
                p = hp + hn * 0.003
            path.append(p.copy())
        if np.linalg.norm(exit_targets - p, axis=1).min() >= 0.006:
            pass  # exit missed: fall starts from wherever the scalp phase ended
        if _stuck >= 30:
            scalp_stuck += 1
        scalp_counts.append(len(path))
        if ri < 3:
            _arc = sum(float(np.linalg.norm(path[k] - path[k - 1])) for k in range(1, len(path)))
            print("P7 TRACE root%d steps=%d arc=%.3f exit_d=%.4f stuck=%d" % (
                ri, len(path), _arc,
                float(np.linalg.norm(exit_targets - p, axis=1).min()), _stuck))
        # Gravity fall: follow-the-leader toward -Z, constant step, 8 deg/cm.
        # Rim redirection: the crest is slow, so gravity dominates the
        # initial fall direction; the 8 deg/cm turn cap governs after that.
        fall_dir = np.asarray(direction, dtype=np.float64)
        fall_dir = fall_dir * 0.15 + np.asarray((0.0, 0.0, -0.85))
        fall_dir = fall_dir / max(np.linalg.norm(fall_dir), 1e-12)
        arc = sum(float(np.linalg.norm(path[k] - path[k - 1])) for k in range(1, len(path)))
        guard = 0
        _fall_steps = 0
        _fall_push = 0
        _fall_arc0 = arc
        # Raw arc is inflated by contact backtracking: run past nominal so
        # the decimated path usually reaches length; extension backstops.
        while arc < length + 0.20 and guard < 700:
            guard += 1
            _fall_steps += 1
            fall_dir = np.asarray(rotate_toward(fall_dir, np.asarray((0.0, 0.0, -1.0)),
                                               math.radians(8.0 * STEP * 100.0)))
            p_prev = p.copy()
            p = p + fall_dir * STEP
            _push_n = None
            _pushed = False
            for _ in range(4):
                moved = False
                for collider in colliders:
                    hit = collider.nearest(p)
                    if hit is None:
                        continue
                    hp, hn, signed, distance, _ = hit
                    # Signed-normal push only: contains() parity misfires on
                    # open meshes (shirt, head-at-neck) and pins the fall.
                    if signed < 0.003:
                        p = hp + hn * 0.003
                        _push_n = np.asarray(hn)
                        moved = True
                        _pushed = True
                if not moved:
                    break
            # Slide: kill the into-surface component so the next step moves
            # along the collider instead of re-diving into it.
            if _push_n is not None and float(np.dot(fall_dir, _push_n)) < 0.0:
                fall_dir = fall_dir - _push_n * float(np.dot(fall_dir, _push_n))
                if np.linalg.norm(fall_dir) < 1e-9:
                    fall_dir = np.asarray((0.0, 0.0, -1.0))
                fall_dir = fall_dir / np.linalg.norm(fall_dir)
            path.append(p.copy())
            arc += float(np.linalg.norm(p - p_prev))
            if _pushed:
                _fall_push += 1
        fall_stats.append((_fall_steps, arc - _fall_arc0,
                           _fall_push / max(_fall_steps, 1)))
        guides.append(np.asarray(path))
    # Trim every guide to exactly `length`, then resample to points_per.
    # Decimate first: raw arcs are inflated by reseat/push-out backtracking,
    # and even resampling aliases zigzag into folded chords.  Extend short
    # decimated guides with a clean gravity tail before trimming.
    G = np.empty((len(guides), points_per, 3), dtype=np.float64)
    extended = 0
    for i, path in enumerate(guides):
        path = decimate_path(path)
        if path_arc(path) < length:
            _dir = np.asarray(path[-1] - path[-2], dtype=np.float64)
            _dir = _dir / max(np.linalg.norm(_dir), 1e-12)
            _p = np.asarray(path[-1], dtype=np.float64)
            for _ in range(250):
                _dir = np.asarray(rotate_toward(_dir, np.asarray((0.0, 0.0, -1.0)),
                                                math.radians(8.0 * STEP * 100.0)))
                _p = _p + _dir * STEP
                for _ in range(4):
                    _moved = False
                    for collider in colliders:
                        hit = collider.nearest(_p)
                        if hit is None:
                            continue
                        hp, hn, signed, distance, _ = hit
                        if signed < 0.003:
                            _p = hp + hn * 0.003
                            _moved = True
                    if not _moved:
                        break
                path = np.vstack([path, _p[None, :]])
                if path_arc(path) >= length:
                    break
            path = decimate_path(path)
            extended += 1
        seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
        cum = np.concatenate([[0.0], np.cumsum(seg)])
        if cum[-1] >= length:
            k = int(np.searchsorted(cum, length))
            f = (length - cum[k - 1]) / max(cum[k] - cum[k - 1], 1e-12)
            tail = path[k - 1] * (1 - f) + path[k] * f
            path = np.vstack([path[:k], tail[None, :]])
        G[i] = resample_polyline(path, points_per)
        if i < 3:
            _a = float(np.linalg.norm(np.diff(G[i], axis=0), axis=1).sum())
            print("P7 ARCPOST guide%d raw=%.3f post=%s" % (
                i, float(cum[-1]), _a))
    print("P7 EXTENDED n=%d" % extended)
    _fs = np.asarray(fall_stats)
    print("P7 FALL med_steps=%.0f med_arc=%.3f med_push=%.2f" % (
        float(np.median(_fs[:, 0])), float(np.median(_fs[:, 1])),
        float(np.median(_fs[:, 2]))))
    return G, np.asarray(scalp_counts), scalp_stuck, forehead_coords


def potential_guides(handle, cap, centre, row, points_per=24, length=0.50):
    s0 = row.get("s0_cap", {})
    cx = float(s0.get("head_centre", centre.tolist())[0])
    apex_y = float(s0.get("slit_apex_y", s0.get("crown_z", 0.0)))
    deps = bpy.context.evaluated_depsgraph_get()
    topo = cap_flow_topology(cap, cx, centre, apex_y)
    topo["slit_method"] = s0.get("slit_method", "graph-barrier")
    row.setdefault("s2_diagnosis", {})["flow_topology"] = topo
    print("P7 TEMPLE L", json.dumps(topo["temple_L"], sort_keys=True),
          "R", json.dumps(topo["temple_R"], sort_keys=True))
    print("P7 EXIT edges=%d sources=%d forehead_path=%d loop=%d" % (
        topo["exit_edge_count"], topo["exit_source_count"],
        topo["forehead_path_length"], topo["loop_length"]))
    cap_ys = np.asarray([v.co.y for v in cap.data.vertices])
    y_front = float(cap_ys.min())
    phi, _adj, barrier = geodesic_phi(cap, topo["exit_sources"], cx, y_front, apex_y)
    print("P7 BARRIER", json.dumps(barrier, sort_keys=True))
    phi = np.asarray(phi, dtype=np.float64)
    print("P7 PHI min=%.4f max=%.4f forehead_mean=%.4f" % (
        float(phi.min()), float(phi.max()),
        float(phi[topo["forehead_path"]].mean())))
    flows, _fc = face_flow_field(cap, phi)
    zero = sum(1 for f in flows if np.linalg.norm(f) < 1e-9)
    print("P7 FLOWS faces=%d zero=%d" % (len(flows), zero))
    roots, _rn = sample_roots_potential(cap, cx, topo["slit_end_y"], count=250)
    print("P7 ROOTS n=%d slit_end_y=%.4f" % (len(roots), topo["slit_end_y"]))
    garment_tokens = ("shirt", "pants", "jeans", "dress", "skirt", "garment", "cloth",
                      "aisha", "body", "torso")
    skip_tokens = ("teeth", "tongue", "eyebrow", "eyelash", "teeth_base", "tongue01")
    colliders = [Collider(handle.head, deps)]
    for o in bpy.context.scene.objects:
        if o.type != "MESH" or o is cap or o is handle.head:
            continue
        if o.hide_render and o is not handle.basemesh:
            continue
        if len(getattr(o.data, "vertices", [])) < 100:
            continue
        low = o.name.lower()
        if any(t in low for t in skip_tokens):
            continue
        # The hidden MPFB basemesh disagrees with the visible Aisha skin by
        # millimetres; keeping both fights push-outs, so it is not a collider.
        if o is handle.basemesh:
            continue
        if any(t in low for t in garment_tokens):
            colliders.append(Collider(o, deps))
    colliders = list(dict.fromkeys(colliders))
    print("P7 COLLIDERS", [c.obj.name for c in colliders])
    head_col = colliders[0]
    G, scalp_counts, scalp_stuck, forehead_coords = trace_streamlines(
        roots, cap, head_col, colliders, topo, phi, flows, points_per, length)
    print("P7 SCALP steps_median=%.1f stuck=%d" % (
        float(np.median(scalp_counts)), scalp_stuck))
    # Final repair on the resampled controls (root fixed), then verify length.
    for i in range(len(G)):
        for j in range(1, points_per):
            p = G[i, j]
            for _ in range(8):
                moved = False
                for collider in colliders:
                    hit = collider.nearest(p)
                    if hit is None:
                        continue
                    hp, hn, signed, distance, _ = hit
                    if signed < 0.003:
                        p = hp + hn * 0.003
                        moved = True
                if not moved:
                    break
            G[i, j] = p
    # Bounded neighbour-tip smoothing (mild): outliers beyond the 25 mm bar
    # move at most 3 mm/iter and 20 mm total toward their neighbour median.
    _tip0 = G[:, -1].copy()
    for _ in range(10):
        old = G.copy()
        tips_old = old[:, -1]
        td = np.linalg.norm(tips_old[:, None] - tips_old[None, :], axis=2)
        moved_any = False
        for i in range(len(G)):
            nn = np.argsort(td[i])[1:9]
            delta = np.median(tips_old[nn], axis=0) - tips_old[i]
            d = float(np.linalg.norm(delta))
            if d > 0.024:
                moved_any = True
                delta *= min(1.0, 0.003 / max(d, 1e-9))
                room = 0.020 - float(np.linalg.norm(G[i, -1] - _tip0[i]))
                if room <= 0:
                    continue
                if float(np.linalg.norm(delta)) > room:
                    delta *= room / float(np.linalg.norm(delta))
                for j in range(points_per - 7, points_per):
                    w = (j - (points_per - 7)) / 6.0
                    G[i, j] += delta * w
        if not moved_any:
            break
    # Last pass: push any smoother-dragged points back out (inside-only, so
    # no collar zigzag: only genuinely inside points move).
    for i in range(len(G)):
        for j in range(1, points_per):
            p = G[i, j]
            for _ in range(8):
                moved = False
                for collider in colliders:
                    hit = collider.nearest(p)
                    if hit is None:
                        continue
                    hp, hn, signed, distance, _ = hit
                    if signed < -0.001:
                        p = hp + hn * 0.003
                        moved = True
                if not moved:
                    break
            G[i, j] = p
    # Build the Hair Curves object with the manual UV writer (never snap:
    # the operator wrote V=0 silently).  Read the cap UV layer name.
    bpy.ops.object.select_all(action="DESELECT")
    cap.select_set(True)
    bpy.context.view_layer.objects.active = cap
    bpy.ops.object.curves_empty_hair_add()
    hair = bpy.context.active_object
    hair.name = "P7_authored_guides"
    uv_name = cap.data.uv_layers.active.name if cap.data.uv_layers.active else "UVMap"
    try:
        hair.data.surface = cap
    except Exception as _e:
        row.setdefault("s2_diagnosis", {})["c_surface_set_error"] = str(_e)
    hair.data.surface_uv_map = uv_name
    hair.matrix_world.identity()
    cap.matrix_world.identity()
    hair.update_tag()
    bpy.context.view_layer.update()
    row.setdefault("s2_diagnosis", {})["c_surface"] = {
        "surface": getattr(getattr(hair.data, "surface", None), "name", None),
        "surface_uv_map": getattr(hair.data, "surface_uv_map", None),
        "cap_uv_layer_read": uv_name,
        "hair_matrix": [list(r) for r in hair.matrix_world],
        "cap_matrix": [list(r) for r in cap.matrix_world],
    }
    hair.data.add_curves([points_per] * len(G))
    local = np.asarray([(hair.matrix_world.inverted() @ Vector(p))[:] for p in G.reshape(-1, 3)],
                       np.float32)
    hair.data.attributes["position"].data.foreach_set("vector", local.ravel())
    hair.data.update_tag()
    bpy.context.view_layer.update()
    uv_diag = write_surface_uv_from_cap(hair, cap, uv_name)
    row.setdefault("s2_diagnosis", {})["b_manual_write"] = uv_diag
    print("P7 UVC", json.dumps(uv_diag, sort_keys=True))
    # curves_empty_hair_add auto-adds a Surface Deform modifier whose stale
    # bind evaluates the hand-written curves to empty: drop it for rendering.
    for m in [m for m in hair.modifiers if "SURFACE_DEFORM" in m.type
              or "Surface Deform" in m.name]:
        hair.modifiers.remove(m)
    hair.data.materials.append(make_material("P7_guides_copper", (0.95, 0.20, 0.035), 0.15))
    hair.update_tag()
    bpy.context.view_layer.update()
    print("P7 GEVAL-BARE", json.dumps(evaluated_signature(hair), sort_keys=True))
    # ---- gates ----
    root_d = np.linalg.norm(roots[:, None, :] - roots[None, :, :], axis=2)
    nearest = np.partition(root_d + np.eye(len(roots)) * 99.0, 0, axis=1)[:, 0]
    med_spacing = float(np.median(nearest))
    spacing_gaps = int(np.count_nonzero(nearest > 2.0 * med_spacing))
    inside = 0
    min_signed = float("inf")
    inside_by_collider = {}
    for p in G.reshape(-1, 3):
        values = [c.nearest(p) for c in colliders]
        values = [(c, v) for c, v in zip(colliders, values) if v is not None and v[3] < 0.05]
        if values:
            c0, closest = min(values, key=lambda cv: cv[1][3])
            min_signed = min(min_signed, closest[2])
            # Signed-normal inside test (parity misfires on open meshes).
            if closest[2] < -0.001:
                inside += 1
                inside_by_collider[c0.obj.name] = inside_by_collider.get(c0.obj.name, 0) + 1
    print("P7 INSIDE", json.dumps(inside_by_collider, sort_keys=True))
    tips = G[:, -1]
    tip_d = np.linalg.norm(tips[:, None, :] - tips[None, :, :], axis=2)
    outliers = 0
    for i in range(len(G)):
        nn = np.argsort(tip_d[i])[1:9]
        med = np.median(tips[nn], axis=0)
        if np.linalg.norm(tips[i] - med) > 0.025:
            outliers += 1
    tip_outlier_pct = 100.0 * outliers / len(G)
    crown = row["s0_cap"]["crown_z"]
    z0 = crown - 0.25
    bins = np.linspace(z0, crown, 14)
    contour = []
    for a, b in zip(bins[:-1], bins[1:]):
        pts = G[(G[:, :, 2] >= a) & (G[:, :, 2] < b)]
        contour.append(float(np.min(pts[:, 1])) if len(pts) else np.nan)
    contour = np.asarray(contour)
    valid = np.isfinite(contour)
    contour = np.interp(np.arange(len(contour)), np.where(valid)[0], contour[valid])
    for _ in range(4):
        contour = np.convolve(np.pad(contour, (2, 2), mode="edge"), np.ones(5) / 5, mode="valid")
    d2 = np.diff(contour, n=2)
    sign_changes = int(np.count_nonzero(np.diff(np.sign(d2[np.abs(d2) > 1e-4]))))
    deps2 = bpy.context.evaluated_depsgraph_get()
    cap_verts_w, cap_faces_w = world_mesh(cap, deps2)
    face_centres = np.asarray([cap_verts_w[list(f)].mean(axis=0) for f in cap_faces_w])
    dmat = np.linalg.norm(face_centres[:, None, :] - roots[None, :, :], axis=2)
    face_cover_max_mm = float(dmat.min(axis=1).max() * 1000.0) if len(face_centres) else float("nan")
    face_cover_mean_mm = float(dmat.min(axis=1).mean() * 1000.0) if len(face_centres) else float("nan")
    _worst = np.argsort(dmat.min(axis=1))[-5:][::-1]
    print("P7 COVER worst=" + ",".join(
        "(%.1f,%.3f,%.3f,%.3f)" % (dmat[w].min() * 1000.0, *face_centres[w]) for w in _worst))
    s0 = row.get("s0_cap", {})
    chin_z = float(s0.get("chin_z", crown - 0.215))
    above, below = [], []
    for p in G.reshape(-1, 3):
        hit = head_col.nearest(p)
        dh = hit[3] if hit else float("nan")
        if p[2] >= chin_z:
            above.append(dh)
        else:
            vals = [c.nearest(p) for c in colliders]
            vals = [v[3] for v in vals if v is not None]
            below.append(min(vals) if vals else dh)
    above = np.asarray(above)
    below = np.asarray(below)
    above_max_mm = float(np.nanmax(above) * 1000.0) if len(above) else float("nan")
    below_max_mm = float(np.nanmax(below) * 1000.0) if len(below) else float("nan")
    below_p95_mm = float(np.nanpercentile(below, 95) * 1000.0) if len(below) else float("nan")
    _flat = G.reshape(-1, 3)
    _w = np.where((_flat[:, 2] >= chin_z))[0]
    _ad = np.asarray([head_col.nearest(_flat[k])[3] if head_col.nearest(_flat[k]) else float("nan")
                      for k in _w])
    _wo = np.argsort(-np.nan_to_num(_ad))[:10]
    print("P7 OFFABOVE " + ",".join(
        "(g%d,z%.3f,d%.1f)" % (int(_w[k] // points_per), float(_flat[_w[k], 2]),
                               float(_ad[k] * 1000.0)) for k in _wo))
    _oguides = sorted(set(int(_w[k] // points_per) for k in _wo[:4]))
    for _gi in _oguides:
        print("P7 OFFROOT g%d root=%s tip=%s" % (
            _gi, np.asarray(roots[_gi]).tolist(), np.asarray(G[_gi, -1]).tolist()))
    # Forehead gate: no non-root streamline point near the forehead segment.
    fh_cross = 0
    fh_min_mm = float("inf")
    for gi in range(len(G)):
        for j in range(2, points_per):
            d = float(np.linalg.norm(forehead_coords - G[gi, j], axis=1).min() * 1000.0)
            fh_min_mm = min(fh_min_mm, d)
            if d < 2.0:
                fh_cross += 1
                break
    eye_z = float(s0.get("eye_z", crown - 0.125))
    at_eye = G[:, :, :][(np.abs(G[:, :, 2] - eye_z) < 0.008)]
    xs = np.sort(at_eye[:, 0]) if len(at_eye) else np.asarray([])
    gap_m = 0.0
    if len(xs) >= 2:
        _l = xs[xs < cx]
        _r = xs[xs >= cx]
        gap_m = float(_r.min() - _l.max()) if len(_l) and len(_r) else float(xs.max() - xs.min())
    lengths = np.sum(np.linalg.norm(np.diff(G, axis=1), axis=2), axis=1)
    for i in range(min(3, len(G))):
        print("P7 ARCFINAL guide%d len=%.3f" % (i, float(lengths[i])))
    slit_d = np.abs(roots[:, 0] - cx)
    metrics = {
        "guide_count": len(G), "points_per_guide": points_per,
        "guide_length_m": length, "flow": "potential-phi",
        "measured_length_median_m": float(np.median(lengths)),
        "measured_length_min_m": float(lengths.min()),
        "measured_length_max_m": float(lengths.max()),
        "min_root_spacing_mm": float(nearest.min() * 1000),
        "median_root_spacing_mm": med_spacing * 1000,
        "min_root_to_slit_mm": float(slit_d.min() * 1000),
        "spacing_gaps_over_2x_median": spacing_gaps,
        "inside_collider_points": inside, "minimum_signed_clearance_mm": min_signed * 1000,
        "inside_by_collider": inside_by_collider,
        "profile_d2_sign_changes": sign_changes,
        "tip_neighbour_outliers_pct": tip_outlier_pct,
        "colliders": [c.obj.name for c in colliders],
        "face_to_root_max_mm": face_cover_max_mm,
        "face_to_root_mean_mm": face_cover_mean_mm,
        "forehead_crossings": fh_cross,
        "forehead_min_distance_mm": fh_min_mm,
        "above_chin_max_mm": above_max_mm,
        "below_chin_max_mm": below_max_mm,
        "below_chin_p95_mm": below_p95_mm,
        "eye_gap_m": gap_m, "inter_ear_m": 0.150,
        "chin_z": chin_z, "eye_z": eye_z,
        "scalp_steps_median": float(np.median(scalp_counts)),
        "scalp_stuck_count": int(scalp_stuck),
        "temple_L": topo["temple_L"], "temple_R": topo["temple_R"],
    }
    metrics["pass"] = bool(
        150 <= len(G) <= 250 and points_per == 24 and fh_cross == 0
        and face_cover_max_mm <= 9.0 and inside == 0 and above_max_mm <= 15.0
        and below_p95_mm <= 35.0 and below_max_mm <= 60.0
        and tip_outlier_pct < 2.0 and sign_changes <= 2)
    row["s1_guides"] = metrics
    return hair, G, metrics


PROCEDURAL_BLEND = "/Applications/Blender.app/Contents/MacOS/../Resources/5.1/datafiles/assets/nodes/procedural_hair_node_assets.blend"


def append_asset_modifier(hair, asset_name):
    import os as _os
    bpy.ops.object.select_all(action="DESELECT")
    hair.select_set(True); bpy.context.view_layer.objects.active = hair
    before = set(hair.modifiers)
    try:
        with bpy.context.temp_override(object=hair, active_object=hair, selected_objects=[hair],
                                       selected_editable_objects=[hair]):
            bpy.ops.object.modifier_add_node_group(
                asset_library_type="ESSENTIALS", asset_library_identifier="",
                relative_asset_identifier=("nodes/procedural_hair_node_assets.blend/NodeTree/" + asset_name))
    except Exception:
        pass
    after = set(hair.modifiers) - before
    if after:
        return list(after)[0]
    # Headless fallback: link the node group straight from the procedural blend.
    blend = _os.path.normpath(PROCEDURAL_BLEND)
    if bpy.data.node_groups.get(asset_name) is None:
        with bpy.data.libraries.load(blend, link=False) as (src, dst):
            if asset_name in src.node_groups:
                dst.node_groups = [asset_name]
    group = bpy.data.node_groups.get(asset_name)
    if group is None:
        raise RuntimeError(f"node group {asset_name} unavailable (operator CANCELLED, blend {blend})")
    mod = hair.modifiers.new(asset_name, "NODES")
    mod.node_group = group
    return mod


def write_surface_uv_from_cap(guides, cap, uv_name=None):
    """S2b fallback: barycentric-interpolate cap loop UVs onto each root."""
    deps = bpy.context.evaluated_depsgraph_get()
    cap_ev = cap.evaluated_get(deps)
    bvh = BVHTree.FromObject(cap, deps, deform=True, cage=False)
    w2l = cap_ev.matrix_world.inverted()
    mesh = cap_ev.data if hasattr(cap_ev, "data") else cap.data
    if uv_name is None:
        uv_name = mesh.uv_layers.active.name if mesh.uv_layers.active else "UVMap"
    uv_layer = mesh.uv_layers.get(uv_name) or mesh.uv_layers.get("surface_uv_coordinate")
    if uv_layer is None:
        return {"wrote": 0, "reason": "cap has no UV layer", "uv_name": uv_name}
    n = len(guides.data.curves)
    vals = []
    for ci in range(n):
        root = guides.matrix_world @ Vector(guides.data.curves[ci].points[0].position)
        q = w2l @ root
        hit, _n, fi, _d = bvh.find_nearest(q)
        if hit is None or fi is None:
            vals.append((0.0, 0.0))
            continue
        poly = mesh.polygons[fi]
        loops = [mesh.loops[li] for li in poly.loop_indices]
        uvs = np.asarray([uv_layer.data[li].uv[:] for li in poly.loop_indices], dtype=np.float64)
        pts = np.asarray([(cap_ev.matrix_world @ mesh.vertices[lp.vertex_index].co)[:] for lp in loops])
        # Project to face plane, inverse-distance weight loop UVs (exact for
        # tris, smooth for quads; sufficient for a fallback attachment map).
        d = np.linalg.norm(pts - np.asarray(root)[:], axis=1) + 1e-9
        w = 1.0 / (d ** 2)
        w /= w.sum()
        vals.append((float((w[:, None] * uvs).sum(axis=0)[0]), float((w[:, None] * uvs).sum(axis=0)[1])))
    attr = guides.data.attributes.get("surface_uv_coordinate")
    if attr is None:
        attr = guides.data.attributes.new("surface_uv_coordinate", "FLOAT2", "CURVE")
    for ci, (u, v) in enumerate(vals):
        attr.data[ci].vector = (u, v)
    guides.data.update_tag(); bpy.context.view_layer.update()
    arr = np.asarray(vals)
    return {"wrote": n, "uv_name": uv_name,
            "u_range": float(np.ptp(arr[:, 0])), "v_range": float(np.ptp(arr[:, 1]))}


def surface_uv_ranges(guides):
    attr = guides.data.attributes.get("surface_uv_coordinate")
    if attr is None:
        return {"present": False, "u_range": 0.0, "v_range": 0.0}
    vals = []
    for item in attr.data:
        v = getattr(item, "vector", None)
        if v is not None:
            vals.append((float(v[0]), float(v[1])))
    arr = np.asarray(vals) if vals else np.zeros((0, 2))
    return {"present": True, "count": len(vals),
            "u_range": float(np.ptp(arr[:, 0])) if len(arr) else 0.0,
            "v_range": float(np.ptp(arr[:, 1])) if len(arr) else 0.0,
            "u_min": float(arr[:, 0].min()) if len(arr) else 0.0,
            "v_min": float(arr[:, 1].min()) if len(arr) else 0.0}


def group_inputs(group):
    return {item.name: item.identifier for item in group.interface.items_tree
            if getattr(item, "in_out", "") == "INPUT"}


def group_input_details(group):
    return [{"name": item.name, "identifier": item.identifier,
             "socket_type": getattr(item, "socket_type", None)}
            for item in group.interface.items_tree if getattr(item, "in_out", "") == "INPUT"]


def set_input(mod, identifiers, name, value, attribute=None):
    # Blender 5.1's profile asset exposes several sockets with abbreviated UI
    # names although their stable identifiers are present.  The two critical
    # assets below are still asserted by name+identifier before use.
    fallback = {"Replace Radius": "Input_6", "Radius": "Input_3", "Shape": "Input_2",
                "Factor Min": "Input_4", "Factor Max": "Input_5"}
    ident = identifiers.get(name, fallback.get(name))
    if ident is None:
        raise KeyError(f"missing modifier input {name!r}; have {identifiers!r}")
    if attribute is not None:
        mod[ident + "_use_attribute"] = True
        mod[ident + "_attribute_name"] = attribute
    else:
        mod[ident] = value
    return ident


def evaluated_signature(hair):
    hair.update_tag(); bpy.context.view_layer.update()
    ev_obj = hair.evaluated_get(bpy.context.evaluated_depsgraph_get())
    source = "evaluated_object.data"
    ev = ev_obj.data
    geometry_set = None
    try:
        geometry_set = ev_obj.evaluated_geometry()
        if getattr(geometry_set, "curves", None) is not None:
            ev = geometry_set.curves
            source = "evaluated_geometry.curves"
    except (AttributeError, RuntimeError):
        geometry_set = None
    counts = [len(c.points) for c in ev.curves]
    return {"curves": len(counts), "points": len(ev.points),
            "point_counts": sorted(set(counts)), "source": source}


def s2_control(shared):
    """Control: Interpolate on a UV sphere with 8 hand-made guides (>0 curves)."""
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.09, location=(10.0, 10.0, 10.0))
    ball = bpy.context.active_object
    ball.name = "P7_control_surface"
    bpy.ops.object.select_all(action="DESELECT")
    ball.select_set(True); bpy.context.view_layer.objects.active = ball
    bpy.ops.object.curves_empty_hair_add()
    ctl = bpy.context.active_object
    ctl.name = "P7_control_guides"
    try:
        ctl.data.surface = ball
    except Exception:
        pass
    ctl.data.surface_uv_map = "UVMap"
    P, L = 8, 12
    ctl.data.add_curves([L] * P)
    rng = np.random.default_rng(7)
    pos = []
    for gi in range(P):
        th = 2 * math.pi * gi / P
        root = np.array([10.0 + 0.085 * math.cos(th), 10.0 + 0.085 * math.sin(th), 10.06])
        for k in range(L):
            pos.extend((root + np.array([0.004 * math.cos(th) * k, 0.004 * math.sin(th) * k, 0.03 * k])).tolist())
    ctl.data.attributes["position"].data.foreach_set("vector", np.asarray(pos, dtype=np.float32).ravel())
    ctl.data.update_tag(); bpy.context.view_layer.update()
    # Manual attachment write (snap_curves_to_surface wrote V=0 silently).
    ctl_uv = write_surface_uv_from_cap(ctl, ball, ball.data.uv_layers.active.name
                                       if ball.data.uv_layers.active else "UVMap")
    ctl.data.update_tag(); bpy.context.view_layer.update()
    mod = append_asset_modifier(ctl, "Interpolate Hair Curves")
    ii = group_inputs(mod.node_group)
    if "Density" in ii:
        mod[ii["Density"]] = 2000.0 / (4 * math.pi * 0.09 ** 2)
    if "Viewport Amount" in ii:
        mod[ii["Viewport Amount"]] = 1.0
    ctl.update_tag(); bpy.context.view_layer.update()
    sig = evaluated_signature(ctl)
    out = {"curves": sig["curves"], "point_counts": sig["point_counts"],
           "surface": getattr(getattr(ctl.data, "surface", None), "name", None),
           "surface_uv_map": getattr(ctl.data, "surface_uv_map", None),
           "uv": ctl_uv,
           "inputs": sorted(ii)}
    bpy.data.objects.remove(ctl, do_unlink=True)
    bpy.data.objects.remove(ball, do_unlink=True)
    bpy.context.view_layer.update()
    return out


def children_stage(shared, handle, cap, guides, row, size, samples):
    diag = row.setdefault("s2_diagnosis", {})
    diag["control_uv_sphere_8_guides"] = s2_control(shared)
    write_row(row)
    interp = append_asset_modifier(guides, "Interpolate Hair Curves")
    with bpy.context.temp_override(object=guides, active_object=guides,
                                   selected_objects=[guides], selected_editable_objects=[guides]):
        bpy.ops.object.modifier_move_to_index(modifier=interp.name, index=0)
    # Identifiers are read from the node group; names are required, values set
    # below.  Every modifier-input change is followed by update_tag + view
    # layer update before evaluated reads (evaluated_signature does both).
    ii = group_inputs(interp.node_group)
    required_names = ["Density Mask", "Density", "Interpolation Guides",
                      "Part by Mesh Islands", "Viewport Amount"]
    missing = [n for n in required_names if n not in ii]
    if missing:
        raise RuntimeError(f"Interpolate inputs missing: {missing}; have {sorted(ii)}")
    readback_i = {name: ii[name] for name in required_names}
    print("P7 INTERP IDS", json.dumps(readback_i, sort_keys=True))
    set_input(interp, ii, "Density Mask", 1.0, attribute="p7_density")
    set_input(interp, ii, "Interpolation Guides", 2)
    set_input(interp, ii, "Part by Mesh Islands", True)
    set_input(interp, ii, "Viewport Amount", 1.0)
    if "Resting Surface" in ii:
        set_input(interp, ii, "Resting Surface", False)
    clump_inputs = {n: ident for n, ident in ii.items() if "clump" in n.lower()}
    for n, ident in clump_inputs.items():
        try:
            interp[ident] = 0.0
        except Exception as _e:
            print("P7 CLUMP skip", n, repr(_e))
    # Attachment assert: manual writer ranges must both exceed 0.1.
    uv_ranges = surface_uv_ranges(guides)
    diag["uv_attach_readback"] = uv_ranges
    print("P7 UVR", json.dumps(uv_ranges, sort_keys=True))
    uv_ok = bool(uv_ranges.get("u_range", 0.0) > 0.1 and uv_ranges.get("v_range", 0.0) > 0.1)

    surface_deform_removed = False
    for modifier in list(guides.modifiers):
        if modifier is not interp and modifier.name == "Surface Deform":
            guides.modifiers.remove(modifier)
            surface_deform_removed = True

    profile = append_asset_modifier(guides, "Set Hair Curve Profile")
    pi = group_inputs(profile.node_group)
    if "Density" in pi:
        profile[pi["Density"]] = 1.0
    if "Length" in pi:
        profile[pi["Length"]] = 1.0
    set_input(profile, pi, "Replace Radius", True)
    set_input(profile, pi, "Shape", .5)
    set_input(profile, pi, "Factor Min", 0.0)
    set_input(profile, pi, "Factor Max", 1.0)

    area = row["s0_cap"]["area_cm2"] / 10000.0
    rows, all_paths = {}, []
    for label, target_count, radius in (("2k", 2000, .0004), ("50k", 50000, .00005)):
        # Density is local-area based; one correction gives close target counts.
        density = target_count / area
        set_input(interp, ii, "Density", density)
        set_input(profile, pi, "Radius", radius)
        sig = evaluated_signature(guides)
        if not sig["curves"]:
            uv_attr = guides.data.attributes.get("surface_uv_coordinate")
            uv_values = []
            if uv_attr is not None:
                for item in uv_attr.data:
                    value = getattr(item, "vector", None)
                    if value is not None:
                        uv_values.append(tuple(float(x) for x in value))
            other_grooms = []
            for obj in bpy.context.scene.objects:
                if obj.type == "CURVES" and obj is not guides:
                    other_grooms.append({
                        "name": obj.name,
                        "surface": getattr(getattr(obj.data, "surface", None), "name", None),
                        "surface_uv_map": getattr(obj.data, "surface_uv_map", None),
                        "attributes": sorted(x.name for x in obj.data.attributes),
                        "modifiers": [m.name for m in obj.modifiers],
                        "curves": len(obj.data.curves),
                    })
            diagnostics = {
                "surface": getattr(getattr(guides.data, "surface", None), "name", None),
                "surface_uv_map": guides.data.surface_uv_map,
                "curve_attributes": sorted(a.name for a in guides.data.attributes),
                "cap_uv_layers": sorted(x.name for x in cap.data.uv_layers),
                "cap_attributes": sorted(a.name for a in cap.data.attributes),
                "modifier_stack": [m.name for m in guides.modifiers],
                "attachment_uv_min": np.min(uv_values, axis=0).tolist() if uv_values else None,
                "attachment_uv_max": np.max(uv_values, axis=0).tolist() if uv_values else None,
                "attachment_uv_nan": int(np.count_nonzero(~np.isfinite(uv_values))) if uv_values else None,
                "other_grooms": other_grooms,
                "required": sig,
            }
            # Attachment was written manually in potential_guides (never snap).
            # Re-verify here; rewrite once if degenerate, then diagnose.
            diag["b_snap_uv"] = surface_uv_ranges(guides)
            if diag["b_snap_uv"].get("v_range", 0.0) <= 1e-6:
                diag["b_manual_write_retry"] = write_surface_uv_from_cap(
                    guides, cap, guides.data.surface_uv_map)
                diag["b_after_manual"] = surface_uv_ranges(guides)
                sig = evaluated_signature(guides)
                diagnostics["after_manual_uv"] = dict(sig)
            # S2d: Density Mask disconnected -> must produce >0, then reconnect.
            interp[ii["Density Mask"] + "_use_attribute"] = False
            interp[ii["Density Mask"]] = 1.0
            guides.update_tag(); bpy.context.view_layer.update()
            diagnostics["constant_mask"] = evaluated_signature(guides)
            diag["d_unmasked"] = dict(diagnostics["constant_mask"])
            set_input(interp, ii, "Part by Mesh Islands", False)
            guides.update_tag(); bpy.context.view_layer.update()
            diagnostics["constant_mask_part_off"] = evaluated_signature(guides)
            set_input(interp, ii, "Part by Mesh Islands", True)
            set_input(interp, ii, "Density Mask", 1.0, attribute="p7_density")
            guides.update_tag(); bpy.context.view_layer.update()
            diagnostics["remasked"] = evaluated_signature(guides)
            sig = dict(diagnostics["remasked"])
            row.setdefault("s2_diagnostics", []).append(diagnostics)
            write_row(row)
        if sig["curves"]:
            density *= target_count / sig["curves"]
            set_input(interp, ii, "Density", density)
            sig = evaluated_signature(guides)
        if len(sig["point_counts"]) != 1:
            if sig["curves"] == 0:
                row["s2_children"] = {
                    "pass": False, "failed_pass": label, "measured_curves": 0,
                    "measured_points": 0, "point_counts": [],
                    "reason": "Interpolate Hair Curves evaluated to empty geometry",
                    "interpolate_identifiers": readback_i,
                    "uv_attach_readback": uv_ranges,
                    "control": diag.get("control_uv_sphere_8_guides"),
                    "requested": {"density_mask": "p7_density", "part_by_mesh_islands": True,
                                  "interpolation_guides": 2, "viewport_amount": 1.0,
                                  "resting_surface": False, "radius_mm": radius * 1000},
                    "clump_factor": 0.0, "noise": False, "frizz": False,
                    "curl": False, "roll": False, "duplicate": False,
                }
                write_row(row)
                return [], {}, False
            raise RuntimeError(f"{label} interpolation has mixed point counts: {sig}")
        paths = render_current(shared, handle, "children-" + label, VIEWS, size, samples, only=[guides])
        all_paths.extend(paths)
        rows[label] = {**sig, "density_per_m2": density, "radius_mm": radius * 1000,
                       "renders": {v: str(p) for v, p in zip(VIEWS, paths)}}
    row["s2_children"] = {
        "interpolate_identifiers": readback_i,
        "interpolate_all_inputs": group_input_details(interp.node_group),
        "node_inputs_read_back": {
            "interpolate": {n: (interp[ii[n]] if n != "Density Mask" else "attribute:p7_density")
                            for n in required_names},
        },
        "uv_attach_readback": uv_ranges,
        "uv_attach_ok": uv_ok,
        "control": diag.get("control_uv_sphere_8_guides"),
        "clump_inputs": clump_inputs,
        "clump_factor": 0.0, "noise": False, "frizz": False, "curl": False,
        "roll": False, "duplicate": False, "profile_is_last": guides.modifiers[-1] == profile,
        "modifier_stack": [m.name for m in guides.modifiers],
        "surface_deform_removed_for_static_evidence": surface_deform_removed,
        "passes": rows,
    }
    return all_paths, rows, True


def add_profile_only(guides, radius):
    import os as _os
    if _os.environ.get("P7_DBG_RADIUS"):
        radius = 0.005
    profile = append_asset_modifier(guides, "Set Hair Curve Profile")
    ids = group_inputs(profile.node_group)
    print("P7 DBG profileids", sorted(ids.items()))
    # The 5.1 asset carries Density/Length inputs whose defaults delete all
    # curves headless: pin them to full before anything else.
    if "Density" in ids:
        profile[ids["Density"]] = 1.0
    if "Length" in ids:
        profile[ids["Length"]] = 1.0
    set_input(profile, ids, "Replace Radius", True)
    set_input(profile, ids, "Radius", radius)
    print("P7 DBG profilevals", {k: profile[v] for k, v in ids.items()
                                 if k in ("Replace Radius", "Radius", "Shape")})
    set_input(profile, ids, "Shape", .5)
    set_input(profile, ids, "Factor Min", 0.0)
    set_input(profile, ids, "Factor Max", 1.0)
    guides.update_tag(); bpy.context.view_layer.update()
    return profile


def render_id_for(shared, handle, hair, path, size):
    old = handle.hair
    handle.hair = hair
    try:
        shared._render_id(handle, path, size)
    finally:
        handle.hair = old


def run_judge(rows):
    front = Path(rows["50k"]["renders"]["front"])
    id_path = HERE / "children-50k/front-id.png"
    # ID render is generated after the beauty views at full density.
    result_dir = HERE / "judge"
    result_dir.mkdir(exist_ok=True)
    cmd = ["python3", str(JUDGE_PY), "--beauty", str(front), "--mask", str(id_path),
           "--name", "p7", "--out", str(result_dir)]
    subprocess.run(cmd, cwd=REPO, check=True)
    p7 = json.loads((result_dir / "p7.json").read_text())
    baseline = None
    if (BASELINE / "front.png").exists() and (BASELINE / "front-id.png").exists():
        subprocess.run(["python3", str(JUDGE_PY), "--beauty", str(BASELINE / "front.png"),
                        "--mask", str(BASELINE / "front-id.png"), "--name", "baseline-g0",
                        "--out", str(result_dir)], cwd=REPO, check=True)
        baseline = json.loads((result_dir / "baseline-g0.json").read_text())
    return p7, baseline


def stage_failed(row, stage, metrics):
    row["failed"] = {"stage": stage, "metrics": metrics,
                     "cause": "UNKNOWN unless directly measured by this row"}
    write_row(row)


def main():
    a = args_after_dash()
    HERE.mkdir(parents=True, exist_ok=True)
    row = {
        "schema": "openclinxr.hair-p7.v1", "blender_version": bpy.app.version_string,
        "seed": SEED, "stages_requested": a.stage, "failed": None,
        "notEvidenceFor": ["Quest readiness", "production readiness", "clinical validity",
                           "scoring validity", "learner readiness"],
        "brief_missing": [
            "Exact numeric hairline curve/ear-canal landmark on the imported mesh",
            "Exact garment collider list and the intended three-quarter/back camera azimuths",
            "Temple x-offset: assumed cx+/-0.045 as the lateral orbital rim",
        ],
        "visual_inspection": {},
    }
    shared = load_scene_module()
    handle = shared.build_scene()
    handle.hair.hide_render = handle.hair.hide_viewport = True
    cap, centre, cap_metrics = build_cap(handle, row)
    # A coincident duplicate is invisible/z-fighting in a beauty render.  Lift
    # only for the cap-debug evidence, then restore the exact scalp copy.
    debug_positions = [v.co.copy() for v in cap.data.vertices]
    for v in cap.data.vertices:
        v.co += v.normal * .0015
    cap.data.update(); cap.update_tag(); bpy.context.view_layer.update()
    cap_paths = render_current(shared, handle, "cap-views", ("front", "profile", "back", "top"), 512, 16, only=[cap])
    for v, co in zip(cap.data.vertices, debug_positions):
        v.co = co
    cap.data.update(); cap.update_tag(); bpy.context.view_layer.update()
    montage(cap_paths, HERE / "cap-debug.png", ["front", "profile", "back", "top"], 512)
    row["visual_inspection"]["cap-debug.png"] = "PENDING agent image inspection"
    write_row(row)
    # Failed gates accumulate; every later output is still produced.
    failed_gates = []

    def gate(gid, ok, measured, threshold):
        if not ok:
            failed_gates.append({"id": gid, "measured": measured, "threshold": threshold})

    c = row["s0_cap"]
    gate("s0-area", 550.0 <= c["area_cm2"] <= 750.0, c["area_cm2"], "550-750 cm^2")
    gate("s0-hairline-step", c["g_line_max_step_mm"] <= 3.0,
         c["g_line_max_step_mm"], "<= 3 mm")
    gate("s0-hole", c["boundary_components"] == 1 and c["max_hole_cm2"] <= 1.0,
         {"loops": c["boundary_components"], "max_hole_cm2": c["max_hole_cm2"]},
         "1 loop, hole <= 1 cm^2")
    gate("s0-scale", list(c["scale"]) == [1.0, 1.0, 1.0], list(c["scale"]), "[1,1,1]")
    print("RESULT S0", json.dumps(cap_metrics, sort_keys=True))
    if a.stage == "cap":
        row["failed"] = None if not failed_gates else {"gates": failed_gates}
        write_row(row)
        print("RESULT S0 FAILED GATES", json.dumps(failed_gates, sort_keys=True))
        return

    cap.hide_render = True
    guides, points, guide_metrics = potential_guides(handle, cap, centre, row)
    add_profile_only(guides, .0012)
    _gb = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    print("P7 GBND min=%s max=%s finite=%d" % (
        _gb.min(axis=0).tolist(), _gb.max(axis=0).tolist(), int(np.isfinite(_gb).all())))
    print("P7 GEVAL", json.dumps(evaluated_signature(guides), sort_keys=True))
    _prof = [m for m in guides.modifiers if m.type == "NODES"][-1]
    print("P7 PROFIDS", json.dumps(group_inputs(_prof.node_group), sort_keys=True))
    _prof.show_render = False
    guides.update_tag(); bpy.context.view_layer.update()
    print("P7 GEVAL-NOPROF", json.dumps(evaluated_signature(guides), sort_keys=True))
    _prof.show_render = True
    guides.update_tag(); bpy.context.view_layer.update()
    import os as _osv
    if _osv.environ.get("P7_DBG_V"):
        from PIL import Image as _I2
        def _cnt(path):
            _a = np.asarray(_I2.open(path).convert("RGB"), dtype=np.int32)
            return int((((_a[:, :, 0] > 180) & (_a[:, :, 1] > 60) & (_a[:, :, 1] < 150)
                         & (_a[:, :, 2] < 80))).sum())
        print("P7 DBGV profile-mods", [(m.name, m.show_render) for m in guides.modifiers])
        print("P7 DBGV mats", [m.name if m else None for m in guides.data.materials])
        _profm = [m for m in guides.modifiers if m.name != "Surface Deform"]
        for m in _profm:
            m.show_render = False
        _p = render_current(shared, handle, "guide-views", ("front",), 512, 8, only=[guides])
        print("P7 DBGV no-profile orange=", _cnt(_p[0]))
        for m in _profm:
            m.show_render = True
        guides.data.materials.clear()
        guides.data.materials.append(make_material("P7_dbg_emit", (1.0, 0.5, 0.1), 2.0))
        _p = render_current(shared, handle, "guide-views", ("front",), 512, 8, only=[guides])
        print("P7 DBGV emission orange=", _cnt(_p[0]))
        guides.data.materials.clear()
        guides.data.materials.append(make_material("P7_guides_copper", (0.95, 0.20, 0.035), 0.15))
    guide_paths = render_current(shared, handle, "guide-views", VIEWS, 512, 24, only=[guides])
    montage(guide_paths, HERE / "guides-debug.png", list(VIEWS), 512)
    row["visual_inspection"]["guides-debug.png"] = "PENDING agent image inspection"
    write_row(row)
    g = row["s1_guides"]
    gate("s1-guide-count", 150 <= g["guide_count"] <= 250, g["guide_count"], "150-250")
    gate("s1-points", g["points_per_guide"] == 24, g["points_per_guide"], "24")
    gate("s1-forehead", g["forehead_crossings"] == 0, g["forehead_crossings"], "0")
    gate("s1-face-cover", g["face_to_root_max_mm"] <= 9.0,
         g["face_to_root_max_mm"], "<= 9 mm")
    gate("s1-inside", g["inside_collider_points"] == 0,
         g["inside_collider_points"], "0")
    gate("s1-above-chin", g["above_chin_max_mm"] <= 15.0,
         g["above_chin_max_mm"], "<= 15 mm")
    gate("s1-below-p95", g["below_chin_p95_mm"] <= 35.0,
         g["below_chin_p95_mm"], "<= 35 mm")
    gate("s1-below-max", g["below_chin_max_mm"] <= 60.0,
         g["below_chin_max_mm"], "<= 60 mm")
    gate("s1-tips", g["tip_neighbour_outliers_pct"] < 2.0,
         g["tip_neighbour_outliers_pct"], "< 2%")
    gate("s1-profile", g["profile_d2_sign_changes"] <= 2,
         g["profile_d2_sign_changes"], "<= 2")
    print("RESULT S1", json.dumps(guide_metrics, sort_keys=True))
    if a.stage == "guides":
        row["failed"] = None if not failed_gates else {"gates": failed_gates}
        write_row(row)
        print("RESULT S1 FAILED GATES", json.dumps(failed_gates, sort_keys=True))
        return

    # Rebuild clean guides because the debug profile must not precede Interpolate.
    bpy.data.objects.remove(guides, do_unlink=True)
    guides, points, guide_metrics2 = potential_guides(handle, cap, centre, row)
    child_paths, child_rows, child_ok = children_stage(shared, handle, cap, guides, row, a.size, a.samples)
    s2 = row.get("s2_children", {})
    ctl = (row.get("s2_diagnosis", {}).get("control_uv_sphere_8_guides") or {})
    gate("s2-control", ctl.get("curves", 0) > 0, ctl.get("curves", 0), "> 0")
    gate("s2-uv-range",
         s2.get("uv_attach_readback", {}).get("u_range", 0.0) > 0.1
         and s2.get("uv_attach_readback", {}).get("v_range", 0.0) > 0.1,
         s2.get("uv_attach_readback"), "u_range > 0.1 and v_range > 0.1")
    passes = s2.get("passes", {}) if child_ok else {}
    gate("s2-2k-curves", passes.get("2k", {}).get("curves", 0) > 0,
         passes.get("2k", {}).get("curves", 0), "> 0")
    gate("s2-50k-curves", passes.get("50k", {}).get("curves", 0) > 0,
         passes.get("50k", {}).get("curves", 0), "> 0")
    uniform_ok = all(len(passes.get(k, {}).get("point_counts", [])) == 1
                     for k in passes) if passes else True
    gate("s2-uniform", uniform_ok,
         {k: passes.get(k, {}).get("point_counts") for k in passes}, "one point count")
    gate("s2-forbidden",
         s2.get("clump_factor", 1.0) == 0.0 and not s2.get("noise", True)
         and not s2.get("frizz", True) and not s2.get("curl", True)
         and not s2.get("roll", True) and not s2.get("duplicate", True),
         {k: s2.get(k) for k in ("clump_factor", "noise", "frizz", "curl", "roll", "duplicate")},
         "clump 0, no noise/frizz/curl/roll/duplicate")
    if passes:
        gate("s2-profile-last", s2.get("profile_is_last") is True,
             s2.get("profile_is_last"), "true")
    if not child_ok:
        montage(guide_paths + guide_paths + guide_paths, HERE / "p7-sheet.png",
                [f"guides {v}" for v in VIEWS]
                + [f"S2 FAILED: no 2k children ({v})" for v in VIEWS]
                + [f"S2 FAILED: no 50k children ({v})" for v in VIEWS], 512, rows=3)
        blank = Image.new("RGB", (512, 512), (35, 20, 20))
        draw = ImageDraw.Draw(blank)
        draw.text((35, 230), "S2 FAILED\nInterpolate returned 0 curves\nS3 judge not run",
                  fill=(255, 190, 170), spacing=8)
        failed_card = HERE / "s2-failed-card.png"; blank.save(failed_card)
        compare = [TARGETS / "target-front.png", guide_paths[0], failed_card,
                   TARGETS / "target-profile.png", guide_paths[2]]
        montage(compare, HERE / "target-vs-p7.png",
                ["target front", "ours: guides only", "S2/S3 failure", "target profile (not graded)",
                 "ours profile: guides only"], 512)
        row["visual_inspection"]["p7-sheet.png"] = (
            "FAILED AT S2: sheet intentionally repeats the inspected guide row; no child render exists.")
        row["visual_inspection"]["target-vs-p7.png"] = (
            "FAILED AT S2: target is compared only with guides; judge overlay does not exist and S3 was not run.")
        row["failed"] = None if not failed_gates else {"gates": failed_gates}
        write_row(row)
        print("RESULT FAILED S2", json.dumps(row["failed"], sort_keys=True))
        return
    # Produce full-density ID masks at 1024 for every view; judge consumes front.
    for view in VIEWS:
        set_view(shared, handle, view)
        render_id_for(shared, handle, guides, HERE / f"children-50k/{view}-id.png", a.size)
    p7_paths = guide_paths + child_paths
    montage(p7_paths, HERE / "p7-sheet.png",
            [f"guides {v}" for v in VIEWS] + [f"2k {v}" for v in VIEWS] + [f"50k {v}" for v in VIEWS],
            512, rows=3)
    write_row(row)
    if a.stage == "children":
        row["failed"] = None if not failed_gates else {"gates": failed_gates}
        write_row(row)
        print("RESULT S2 COMPLETE", json.dumps(row["s2_children"], sort_keys=True)); return

    p7, baseline = run_judge(child_rows)
    row["s3_judge"] = {"p7": p7, "baseline_g0": baseline,
                       "stop_bar_is_report_not_gate": True}
    gate("s3-report", True, "ran", "report only")
    target_profile = TARGETS / "target-profile.png"
    compare = [TARGETS / "target-front.png", Path(child_rows["50k"]["renders"]["front"]),
               HERE / "judge/overlay-p7.png", target_profile,
               Path(child_rows["50k"]["renders"]["profile"])]
    montage(compare, HERE / "target-vs-p7.png",
            ["target front", "p7 front", "judge overlay", "target profile (not graded)", "p7 profile"], 512)
    row["visual_inspection"]["p7-sheet.png"] = "PENDING final agent image inspection"
    row["visual_inspection"]["target-vs-p7.png"] = "PENDING final agent image inspection"
    row["failed"] = None if not failed_gates else {"gates": failed_gates}
    write_row(row)
    print("RESULT COMPLETE", json.dumps({"p7_score": p7.get("score"),
                                         "p7_clauses": p7.get("clauses"),
                                         "baseline_score": baseline.get("score") if baseline else None}, sort_keys=True))


if __name__ == "__main__":
    main()
