"""hair-children-4: diagnose displaced children (D1), mutate, finish.

Phases (run from repo root):
  Blender --background --python tools/openclinxr/evidence/hair-children/children4.py -- --phase diag
  ... --phase mutN  (M18 single mutations, 384px front renders to E/diag/)
  ... --phase final (M19 pass A/B with real profile + shrinkwrap, 1024 renders, judge inputs)

M17 measures on the existing E/final/final.blend; nothing is changed.
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

E = Path.cwd() / "tools/openclinxr/evidence/hair-children"
FINAL = E / "final"
DIAG = E / "diag"
GUIDES_NPZ = Path.cwd() / "tools/openclinxr/evidence/hair-guides2/guides3.npz"

CAP_NAME = "OCLX_cap"
GUIDES_NAME = "OCLX_interp_guides_final_G"
CHILD_A = "OCLX_interp_guides_final_A"
CHILD_B = "OCLX_interp_guides_final_B"
HEAD_NAME = "OCLX_Aisha_head"
BASE_NAME = "OCLX_collision_basemesh"


def mat_info(obj):
    m = obj.matrix_world
    rows = [[float(m[r][c]) for c in range(4)] for r in range(4)]
    ident = all(abs(rows[r][c] - (1.0 if r == c else 0.0)) < 1e-9
                for r in range(4) for c in range(4))
    return {"name": obj.name, "type": obj.type,
            "matrix_world": rows, "identity": bool(ident),
            "location": [float(v) for v in obj.location],
            "scale": [float(v) for v in obj.scale],
            "parent": obj.parent.name if obj.parent else None}


def evaluated_curves(obj):
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(depsgraph)
    data = ev.data
    n = len(data.curves)
    offsets = np.empty(n + 1, dtype=np.int64)
    if n:
        data.curve_offset_data.foreach_get("value", offsets)
        counts = np.diff(offsets)
        total = int(offsets[-1])
        flat = np.empty(total * 3, dtype=np.float32)
        data.attributes["position"].data.foreach_get("vector", flat)
        local = flat.reshape((-1, 3)).astype(np.float64)
    else:
        counts, local, total = np.zeros(0), np.zeros((0, 3)), 0
    return {"n": n, "offsets": offsets if n else np.zeros(1, dtype=np.int64),
            "counts": counts, "local": local,
            "matrix": obj.matrix_world.copy()}


def world_of(points_local, mat):
    out = np.empty_like(points_local)
    for i in range(len(points_local)):
        out[i] = mat @ Vector(tuple(points_local[i]))
    return out


def cap_bvh_world(cap):
    mesh = cap.data
    mat = cap.matrix_world
    verts = [mat @ v.co.copy() for v in mesh.vertices]
    polys = [list(p.vertices) for p in mesh.polygons]
    return BVHTree.FromPolygons(verts, polys, all_triangles=False)


def run_diag_c(guides, cap, npz_points, npz_roots):
    # baseline: authored (unevaluated) positions vs npz
    npt = len(guides.data.points)
    flat0 = np.empty(npt * 3, dtype=np.float32)
    guides.data.attributes["position"].data.foreach_get("vector", flat0)
    orig = flat0.reshape((-1, 3)).astype(np.float64)
    gmat = guides.matrix_world
    orig_world = world_of(orig, gmat)
    n0 = len(guides.data.curves)
    off0 = np.empty(n0 + 1, dtype=np.int64)
    guides.data.curve_offset_data.foreach_get("value", off0)
    oroots = orig_world[off0[:-1]]
    d0 = np.linalg.norm(oroots - npz_roots, axis=1) if n0 == len(npz_roots) else None
    sec = {"curves": int(n0),
           "origRootShiftMm": None if d0 is None else {
               "mean": float(d0.mean() * 1000),
               "max": float(d0.max() * 1000)}}
    # evaluated (after Attach)
    evg = evaluated_curves(guides)
    g_world = world_of(evg["local"], evg["matrix"])
    go = evg["offsets"]
    gn = evg["n"]
    gcounts = evg["counts"]
    sec.update({"evaluatedCurves": int(gn),
                "pointHist": {str(k): int((gcounts == k).sum())
                              for k in sorted(set(gcounts.tolist()))}})
    if gn == len(npz_roots) and (gcounts == npz_points.shape[1]).all():
        groots = g_world[go[:-1]]
        d_roots = np.linalg.norm(groots - npz_roots, axis=1)
        sec["rootShiftMm"] = {
            "mean": float(d_roots.mean() * 1000),
            "p10": float(np.percentile(d_roots, 10) * 1000),
            "p50": float(np.median(d_roots) * 1000),
            "p90": float(np.percentile(d_roots, 90) * 1000),
            "p95": float(np.percentile(d_roots, 95) * 1000),
            "max": float(d_roots.max() * 1000)}
        sec["evalRootCentroid"] = [float(v) for v in groots.mean(axis=0)]
        sec["npzRootCentroid"] = [float(v) for v in npz_roots.mean(axis=0)]
        sec["centroidShiftMm"] = [
            float(v * 1000) for v in (groots.mean(axis=0) - npz_roots.mean(axis=0))]
        rest = np.concatenate(
            [g_world[go[i] + 1:go[i + 1]] - npz_points[i, 1:go[i + 1] - go[i]]
             for i in range(gn)])
        d_rest = np.linalg.norm(rest, axis=1)
        sec["nonRootShiftMm"] = {"mean": float(d_rest.mean() * 1000),
                                 "p95": float(np.percentile(d_rest, 95) * 1000),
                                 "max": float(d_rest.max() * 1000)}
        # are evaluated guide roots still on the cap?
        cap_inv = cap.matrix_world.inverted()
        glocal = world_of(groots, cap_inv)
        bvh = BVHTree.FromPolygons(
            [v.co.copy() for v in cap.data.vertices],
            [list(p.vertices) for p in cap.data.polygons], all_triangles=False)
        d_cap = np.empty(len(glocal))
        for i in range(len(glocal)):
            _l, _n, _f, dist = bvh.find_nearest(Vector(tuple(glocal[i])))
            d_cap[i] = float(dist) if dist is not None else float("nan")
        sec["evalRootToCapMm"] = {"mean": float(np.nanmean(d_cap) * 1000),
                                  "p50": float(np.nanmedian(d_cap) * 1000),
                                  "p95": float(np.nanpercentile(d_cap, 95) * 1000),
                                  "max": float(np.nanmax(d_cap) * 1000)}
        # evaluated guide points: how many are inside the head cuboid (face region)?
        sec["evalPointsCentroid"] = [float(v) for v in g_world.mean(axis=0)]
        sec["npzPointsCentroid"] = [float(v) for v in npz_points.mean(axis=(0, 1))]
    else:
        sec["countMismatch"] = True
    return sec


def run_diag_d(cap):
    uv_layer = cap.data.uv_layers.get("UVMap")
    n_loops = len(cap.data.loops)
    flat = np.empty(n_loops * 2, dtype=np.float32)
    uv_layer.data.foreach_get("uv", flat)
    loop_uv = flat.reshape((-1, 2)).astype(np.float64)
    tris = []
    for poly in cap.data.polygons:
        li = list(poly.loop_indices)
        uv = [loop_uv[i] for i in li]
        if len(uv) == 3:
            tris.append(uv)
        elif len(uv) == 4:
            tris.append([uv[0], uv[1], uv[2]])
            tris.append([uv[0], uv[2], uv[3]])
    T = np.asarray(tris, dtype=np.float64) * 2048.0
    S = 2048
    cover = np.zeros((S, S), dtype=np.int32)
    masks = [None] * len(T)
    for j, t in enumerate(T):
        xs, ys = t[:, 0], t[:, 1]
        x0, x1 = max(int(np.floor(xs.min())), 0), min(int(np.ceil(xs.max())), S - 1)
        y0, y1 = max(int(np.floor(ys.min())), 0), min(int(np.ceil(ys.max())), S - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5,
                             np.arange(y0, y1 + 1) + 0.5)
        d = (t[1, 1] - t[2, 1]) * (t[0, 0] - t[2, 0]) + (t[2, 0] - t[1, 0]) * (t[0, 1] - t[2, 1])
        if abs(d) < 1e-12:
            continue
        l0 = ((t[1, 1] - t[2, 1]) * (gx - t[2, 0]) + (t[2, 0] - t[1, 0]) * (gy - t[2, 1])) / d
        l1 = ((t[2, 1] - t[0, 1]) * (gx - t[2, 0]) + (t[0, 0] - t[2, 0]) * (gy - t[2, 1])) / d
        l2 = 1 - l0 - l1
        m = (l0 >= -1e-9) & (l1 >= -1e-9) & (l2 >= -1e-9)
        if m.any():
            cover[y0:y1 + 1, x0:x1 + 1][m] += 1
            masks[j] = (y0, x0, m)
    twice = int((cover >= 2).sum())
    once = int((cover >= 1).sum())
    polys = list(cap.data.polygons)
    overlap_faces = 0
    k = 0
    for poly in polys:
        nt = 2 if len(poly.loop_indices) == 4 else 1
        hit = False
        for j in range(k, k + nt):
            entry = masks[j]
            if entry is None:
                continue
            y0, x0, m = entry
            if (cover[y0:y0 + m.shape[0], x0:x0 + m.shape[1]][m] >= 2).any():
                hit = True
                break
        if hit:
            overlap_faces += 1
        k += nt
    return {"uvTris": int(len(T)), "capFaces": int(len(polys)),
            "pixelsCovered": once,
            "pixelsCoveredTwice": twice,
            "fracCoveredTwice": float(twice / max(once, 1)),
            "facesTouchingOverlap": int(overlap_faces),
            "fracFacesOverlap": float(overlap_faces / max(len(polys), 1))}


def run_diag():
    DIAG.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(FINAL / "final.blend"))
    out = {"blenderVersion": bpy.app.version_string}
    try:
        # (a) matrices
        mats = {}
        for name in (CAP_NAME, GUIDES_NAME, CHILD_A, CHILD_B,
                     HEAD_NAME, BASE_NAME, "OCLX_canonical_hair"):
            obj = bpy.data.objects.get(name)
            mats[name] = mat_info(obj) if obj else None
        out["a_matrices"] = mats
        for name, info in mats.items():
            if info is None:
                print("DIAG_A %s MISSING" % name)
            else:
                print("DIAG_A %s identity=%s loc=%s scale=%s parent=%s" % (
                    name, info["identity"], info["location"],
                    info["scale"], info["parent"]))

        cap = bpy.data.objects[CAP_NAME]
        guides = bpy.data.objects[GUIDES_NAME]
        childa = bpy.data.objects[CHILD_A]
        payload = np.load(str(GUIDES_NPZ))
        npz_points = np.asarray(payload["points"], dtype=np.float64)
        npz_roots = np.asarray(payload["roots"], dtype=np.float64)
        out["npz"] = {"shape": list(npz_points.shape),
                      "rootZmin": float(npz_roots[:, 2].min()),
                      "rootZmax": float(npz_roots[:, 2].max())}

        # (b) 200 random children of pass A
        ev = evaluated_curves(childa)
        roots_local = ev["local"][ev["offsets"][:-1]] if ev["n"] else np.zeros((0, 3))
        roots_world = world_of(roots_local, ev["matrix"])
        rng = np.random.default_rng(0)
        idx = rng.choice(len(roots_world), size=min(200, len(roots_world)),
                         replace=False)
        sample = roots_world[idx]
        cap_mat = cap.matrix_world
        cap_inv = cap_mat.inverted()
        sample_caplocal = world_of(sample, cap_inv)
        mesh = cap.data
        bvh_local = BVHTree.FromPolygons(
            [v.co.copy() for v in mesh.vertices],
            [list(p.vertices) for p in mesh.polygons], all_triangles=False)
        d_cap = np.empty(len(sample))
        for i in range(len(sample)):
            _loc, _no, _fi, dist = bvh_local.find_nearest(Vector(tuple(sample_caplocal[i])))
            d_cap[i] = float(dist) if dist is not None else float("nan")
        delta = sample[:, None, :] - npz_roots[None, :, :]
        dist2 = (delta ** 2).sum(axis=2)
        nearest = np.argmin(dist2, axis=1)
        d_guide = np.sqrt(dist2[np.arange(len(sample)), nearest])
        off = sample - npz_roots[nearest]
        out["b_children"] = {
            "childCount": int(ev["n"]),
            "sample": int(len(sample)),
            "rootToCapMm": {"mean": float(np.nanmean(d_cap) * 1000),
                            "p50": float(np.nanmedian(d_cap) * 1000),
                            "p95": float(np.nanpercentile(d_cap, 95) * 1000),
                            "max": float(np.nanmax(d_cap) * 1000)},
            "rootToGuideMm": {"mean": float(d_guide.mean() * 1000),
                              "p50": float(np.median(d_guide) * 1000),
                              "p95": float(np.percentile(d_guide, 95) * 1000),
                              "max": float(d_guide.max() * 1000)},
            "offsetMeanMm": [float(v * 1000) for v in off.mean(axis=0)],
            "offsetSdMm": [float(v * 1000) for v in off.std(axis=0)],
        }
        print("DIAG_B " + json.dumps(out["b_children"], sort_keys=True))

        # (c) guides after Attach (G has Attach only) vs npz originals
        try:
            c_sec = run_diag_c(guides, cap, npz_points, npz_roots)
        except Exception:
            c_sec = {"error": traceback.format_exc()}
            print("DIAG_C_ERROR\n%s" % c_sec["error"])
        out["c_guides"] = c_sec
        print("DIAG_C " + json.dumps(c_sec, sort_keys=True))

        # (d) cap UV uniqueness: rasterise at 2048, pixels covered twice
        try:
            d_sec = run_diag_d(cap)
        except Exception:
            d_sec = {"error": traceback.format_exc()}
            print("DIAG_D_ERROR\n%s" % d_sec["error"])
        out["d_uv"] = d_sec
        print("DIAG_D " + json.dumps(d_sec, sort_keys=True))

        # (e) render-visible objects
        vis = sorted(o.name for o in bpy.data.objects if not o.hide_render)
        out["e_visible"] = vis
        print("DIAG_E visible=%s" % vis)
    except Exception:
        out["error"] = traceback.format_exc()
        print("DIAG_ERROR\n%s" % out["error"])
    with (DIAG / "d1.json").open("w") as stream:
        json.dump(out, stream, indent=2)
    print("DIAG_WRITTEN " + str(DIAG / "d1.json"))


MUTS = ["baseline", "no-solidify", "no-attach-hand-uv",
        "smart-project", "snap-off", "hide-only"]

GROUP_NAMES4 = ("Attach Hair Curves to Surface", "Interpolate Hair Curves",
                "Set Hair Curve Profile", "Shrinkwrap Hair Curves")
ASSET_BLEND = ("/Applications/Blender.app/Contents/Resources/5.1/"
               "datafiles/assets/nodes/procedural_hair_node_assets.blend")


def load_groups4():
    with bpy.data.libraries.load(ASSET_BLEND, link=False) as (source, dest):
        missing = [n for n in GROUP_NAMES4 if n not in source.node_groups]
        if missing:
            raise RuntimeError("asset node groups missing: %r" % missing)
        dest.node_groups = list(GROUP_NAMES4)
    return {n: bpy.data.node_groups[n] for n in GROUP_NAMES4}


def import_children3():
    import importlib.util
    path = E / "children3.py"
    spec = importlib.util.spec_from_file_location("children3", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["children3"] = module
    spec.loader.exec_module(module)
    return module


def write_surface_uv_hand(guides_obj, cap_obj):
    """children1 M2: per-root BVH nearest on cap -> barycentric loop-UV interp
    -> CURVE-domain FLOAT2 `surface_uv_coordinate` on the guides."""
    mesh = cap_obj.data
    cap_inv = cap_obj.matrix_world.inverted()
    bvh = BVHTree.FromPolygons(
        [v.co.copy() for v in mesh.vertices],
        [list(p.vertices) for p in mesh.polygons], all_triangles=False)
    uv_layer = mesh.uv_layers.get("UVMap")
    n_loops = len(mesh.loops)
    flat = np.empty(n_loops * 2, dtype=np.float32)
    uv_layer.data.foreach_get("uv", flat)
    loop_uv = flat.reshape((-1, 2))
    n_curves = len(guides_obj.data.curves)
    npt = len(guides_obj.data.points)
    flat0 = np.empty(npt * 3, dtype=np.float32)
    guides_obj.data.attributes["position"].data.foreach_get("vector", flat0)
    pts = flat0.reshape((-1, 3)).astype(np.float64)
    off0 = np.empty(n_curves + 1, dtype=np.int64)
    guides_obj.data.curve_offset_data.foreach_get("value", off0)
    gmat = guides_obj.matrix_world
    uvs = np.empty((n_curves, 2), dtype=np.float32)
    nan_count = 0
    from mathutils.geometry import barycentric_transform as bary
    for i in range(n_curves):
        world = gmat @ Vector(tuple(pts[off0[i]]))
        query = cap_inv @ world
        nearest, _no, face_index, _dist = bvh.find_nearest(Vector(tuple(query)))
        if nearest is None or face_index is None:
            nan_count += 1
            uvs[i] = (float("nan"), float("nan"))
            continue
        poly = mesh.polygons[face_index]
        verts = [mesh.vertices[v].co for v in poly.vertices]
        lids = list(poly.loop_indices)
        cuv = [Vector((float(loop_uv[l][0]), float(loop_uv[l][1]), 0.0)) for l in lids]
        if len(verts) == 3:
            uvw = bary(nearest, verts[0], verts[1], verts[2], cuv[0], cuv[1], cuv[2])
        else:
            uvw = None
            for tri in ((0, 1, 2), (0, 2, 3)):
                a, b, c = (verts[t] for t in tri)
                e1, e2 = b - a, c - a
                area2 = e1.cross(e2).length
                if area2 < 1e-12:
                    continue
                w0 = (b - nearest).cross(c - nearest).length / area2
                w1 = (c - nearest).cross(a - nearest).length / area2
                w2 = (a - nearest).cross(b - nearest).length / area2
                if min(w0, w1, w2) >= -1e-6:
                    ua, ub, uc = (cuv[t] for t in tri)
                    uvw = ua * w0 + ub * w1 + uc * w2
                    break
            if uvw is None:
                uvw = cuv[0]
        uvs[i] = (uvw.x, uvw.y)
    attr = guides_obj.data.attributes.get("surface_uv_coordinate")
    if attr is None:
        attr = guides_obj.data.attributes.new("surface_uv_coordinate", "FLOAT2", "CURVE")
    attr.data.foreach_set("vector", uvs.ravel())
    guides_obj.update_tag()
    bpy.context.view_layer.update()
    return {"curves": int(n_curves), "nan": int(nan_count),
            "uMin": float(np.nanmin(uvs[:, 0])), "uMax": float(np.nanmax(uvs[:, 0])),
            "vMin": float(np.nanmin(uvs[:, 1])), "vMax": float(np.nanmax(uvs[:, 1]))}


def smart_project_cap_uv(cap_obj):
    bpy.context.view_layer.objects.active = cap_obj
    cap_obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    cap_obj.select_set(False)
    bpy.context.view_layer.update()
    mesh = cap_obj.data
    uv_layer = mesh.uv_layers.get("UVMap")
    n_loops = len(mesh.loops)
    flat = np.empty(n_loops * 2, dtype=np.float32)
    uv_layer.data.foreach_get("uv", flat)
    uv2 = flat.reshape((-1, 2)).astype(np.float64)
    return {"uMin": float(uv2[:, 0].min()), "uMax": float(uv2[:, 0].max()),
            "vMin": float(uv2[:, 1].min()), "vMax": float(uv2[:, 1].max()),
            "nan": int(np.isnan(flat).sum())}


def socket_rows4(group):
    rows = []
    for item in group.interface.items_tree:
        if not hasattr(item, "identifier") or not item.identifier:
            continue
        default = getattr(item, "default_value", None)
        if isinstance(default, (str, bool, int, float)) or default is None:
            scalar = default
        elif hasattr(default, "name"):
            scalar = default.name
        else:
            try:
                scalar = [float(v) for v in default]
            except Exception:
                scalar = str(default)
        rows.append({"name": item.name, "identifier": item.identifier,
                     "inOut": getattr(item, "in_out", ""),
                     "socketType": getattr(item, "socket_type", ""),
                     "default": scalar})
    return rows


def collider_uv_name(obj):
    layers = obj.data.uv_layers
    active = next((l for l in layers if l.active_render), None)
    return (active.name if active else layers[0].name) if len(layers) else None


def add_shrinkwrap(c3, guides, groups, collider, tag):
    group = groups["Shrinkwrap Hair Curves"]
    modifier = guides.modifiers.new("OCLX_shrink_" + tag, "NODES")
    modifier.node_group = group
    readback = {}
    c3.set_input(modifier, group, "Surface Input Type", "Object", readback,
                 "NodeSocketMenu")
    c3.set_input(modifier, group, "Surface", collider, readback, "NodeSocketObject")
    uvn = collider_uv_name(collider)
    if uvn is not None:
        try:
            c3.set_input(modifier, group, "Surface UV Map", None, readback,
                         "NodeSocketVector", attribute_name=uvn)
        except RuntimeError as err:
            readback["SurfaceUVMapSkipped"] = str(err)
    c3.set_input(modifier, group, "Factor", 1.0, readback)
    c3.set_input(modifier, group, "Offset Distance", 0.002, readback)
    c3.set_input(modifier, group, "Above Surface", 0.0, readback)
    try:
        c3.set_input(modifier, group, "Smoothing Steps", 0, readback)
    except RuntimeError as err:
        readback["SmoothingSkipped"] = str(err)
    c3.set_input(modifier, group, "Lock Roots", True, readback)
    bpy.context.view_layer.update()
    return modifier, readback


def add_profile(c3, guides, groups, radius):
    group = groups["Set Hair Curve Profile"]
    modifier = guides.modifiers.new("OCLX_profile", "NODES")
    modifier.node_group = group
    readback = {}
    for name, value in (("Radius", float(radius)), ("Shape", 0.0),
                        ("Replace Radius", True), ("Density", 1.0),
                        ("Length", 1.0), ("Factor Min", 0.0), ("Factor Max", 1.0)):
        try:
            c3.set_input(modifier, group, name, value, readback)
        except RuntimeError as err:
            readback[name + "_SKIPPED"] = str(err)
    bpy.context.view_layer.update()
    return modifier, readback


def eval_radius_minmax(guides):
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    data = guides.evaluated_get(depsgraph).data
    npt = len(data.points)
    flat = np.empty(npt, dtype=np.float32)
    try:
        data.attributes["radius"].data.foreach_get("value", flat)
    except Exception:
        return None
    return {"min": float(flat.min()), "max": float(flat.max())}


def run_final1():
    """M19 collision decision + density solve. Saves E/solve.json."""
    import collections
    c3 = import_children3()
    hs = c3.load_hair_scene()
    handle = hs.build_scene()
    canonical = handle.hair
    groups = load_groups4()
    for name in ("Set Hair Curve Profile", "Shrinkwrap Hair Curves"):
        print("INPUTS_" + name)
        for row in socket_rows4(groups[name]):
            if row["inOut"] == "INPUT":
                print(json.dumps(row, sort_keys=True))
    uv_layer = next((l for l in handle.head.data.uv_layers if l.active_render), None)
    head_uv = uv_layer.name if uv_layer else handle.head.data.uv_layers[0].name
    cap, cap_info = c3.build_cap_surface(handle, head_uv)
    guides, _roots = c3.make_guides_authored(handle, cap, "solveA", "UVMap")
    hand = write_surface_uv_hand(guides, cap)
    spec = {"id": "solveA", "label": "solve A", "attach": False,
            "interpolate": True, "density": 31000, "islands": True, "mask": True,
            "interpGuides": 2, "distGuides": 1.0}
    interp_readback = c3.configure_modifiers(guides, cap, groups, "UVMap", spec)
    full0 = c3.evaluated_full(guides)
    ca0 = int(full0["curveCount"])
    density_a = int(round(31000 * 2000 / max(ca0, 1)))
    mod_interp = guides.modifiers["OCLX_interpolate"]
    grp_interp = groups["Interpolate Hair Curves"]
    rb2 = {}
    c3.set_input(mod_interp, grp_interp, "Density", float(density_a), rb2)
    bpy.context.view_layer.update()
    body = bpy.data.objects["OCLX_collision_basemesh"]
    shirt = bpy.data.objects.get("makeclothes_library_toigo_t_shirt")
    if shirt is None:
        shirt = next(o for o in bpy.data.objects if "t_shirt" in o.name.lower())
    prof_mod, prof_rb = add_profile(c3, guides, groups, 0.0004)
    rad = eval_radius_minmax(guides)
    full_nocoll = c3.evaluated_full(guides)
    in_body0, d_body0 = c3.inside_fractions(full_nocoll["points"], body)
    in_shirt0, _d_shirt0 = c3.inside_fractions(full_nocoll["points"], shirt)
    no_coll = {"curves": int(full_nocoll["curveCount"]),
               "insideBody": int(in_body0.sum()),
               "insideBodyFrac": float(in_body0.mean()),
               "insideShirt": int(in_shirt0.sum()),
               "insideShirtFrac": float(in_shirt0.mean()),
               "bodyDistMm": {"p5": float(np.nanpercentile(d_body0, 5) * 1000),
                              "p50": float(np.nanpercentile(d_body0, 50) * 1000)}}
    print("SOLVE_NOCOLL " + json.dumps(no_coll, sort_keys=True))
    sh_body, rb_body = add_shrinkwrap(c3, guides, groups, body, "body")
    sh_shirt, rb_shirt = add_shrinkwrap(c3, guides, groups, shirt, "shirt")
    full_coll = c3.evaluated_full(guides)
    in_body1, d_body1 = c3.inside_fractions(full_coll["points"], body)
    in_shirt1, _d_shirt1 = c3.inside_fractions(full_coll["points"], shirt)
    with_coll = {"curves": int(full_coll["curveCount"]),
                 "insideBody": int(in_body1.sum()),
                 "insideBodyFrac": float(in_body1.mean()),
                 "insideShirt": int(in_shirt1.sum()),
                 "insideShirtFrac": float(in_shirt1.mean()),
                 "bodyDistMm": {"p5": float(np.nanpercentile(d_body1, 5) * 1000),
                                "p50": float(np.nanpercentile(d_body1, 50) * 1000)}}
    print("SOLVE_COLL " + json.dumps(with_coll, sort_keys=True))
    # 384 front renders both ways for the visible-degradation verdict
    canonical.hide_render = canonical.hide_viewport = True
    cap.hide_render = cap.hide_viewport = True
    old_hair = handle.hair
    handle.hair = guides
    try:
        c3.set_final_view(handle, "front")
        scene = bpy.context.scene
        scene.render.resolution_x = scene.render.resolution_y = 384
        scene.cycles.samples = 16
        scene.cycles.seed = 0
        scene.render.film_transparent = False
        cdir = DIAG / "collide-compare"
        cdir.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(cdir / "with-collide.png")
        bpy.ops.render.render(write_still=True)
        for mod in (sh_body, sh_shirt):
            mod.show_render = False
            mod.show_viewport = False
        bpy.context.view_layer.update()
        scene.render.filepath = str(cdir / "without-collide.png")
        bpy.ops.render.render(write_still=True)
        for mod in (sh_body, sh_shirt):
            mod.show_render = True
            mod.show_viewport = True
        bpy.context.view_layer.update()
    finally:
        handle.hair = old_hair
    density_b = int(round(density_a * 50000 / max(no_coll["curves"], 1)))
    solve = {"densityA": density_a, "densityB": density_b,
             "countAt31000": ca0, "handUV": hand,
             "profileRadius": rad, "profileReadback": prof_rb,
             "shrinkBodyReadback": rb_body, "shrinkShirtReadback": rb_shirt,
             "shirtObject": shirt.name, "bodyObject": body.name,
             "noCollide": no_coll, "withCollide": with_coll,
             "interpReadbackKeys": sorted(interp_readback.get("interpolate", {}).keys())}
    with (E / "solve.json").open("w") as stream:
        json.dump(solve, stream, indent=2)
    print("SOLVE_WRITTEN " + json.dumps(
        {"densityA": density_a, "densityB": density_b}, sort_keys=True))


def build_pass4(c3, handle, groups, cap, tag, density, radius, body, shirt,
                dist_guides=1.0):
    guides, _roots = c3.make_guides_authored(handle, cap, "final4_" + tag, "UVMap")
    guides.name = "OCLX_child4_" + tag
    hand = write_surface_uv_hand(guides, cap)
    spec = {"id": "final4_" + tag, "label": "final4 pass " + tag, "attach": False,
            "interpolate": True, "density": density, "islands": True, "mask": True,
            "interpGuides": 2, "distGuides": dist_guides}
    readback = c3.configure_modifiers(guides, cap, groups, "UVMap", spec)
    colliders = []
    for collider, suffix in ((body, "body"), (shirt, "shirt")):
        mod, rb = add_shrinkwrap(c3, guides, groups, collider, tag + "_" + suffix)
        colliders.append({"modifier": mod.name, "collider": collider.name,
                          "readback": rb})
    prof_mod, prof_rb = add_profile(c3, guides, groups, radius)
    return guides, {"handUV": hand, "spec": spec, "readback": readback,
                    "colliders": colliders, "profile": prof_rb,
                    "profileMod": prof_mod.name}


def pass_metrics4(c3, guides, body, shirt, guide_roots0, apex_y, crown_z):
    import collections
    full = c3.evaluated_full(guides)
    roots = full["roots"]
    inside_body, dist_body = c3.inside_fractions(full["points"], body)
    inside_shirt, _dist_shirt = c3.inside_fractions(full["points"], shirt)
    per_guide = np.zeros(len(guide_roots0), dtype=np.int64)
    dmin = np.empty(len(roots))
    chunk = 4000
    for start in range(0, len(roots), chunk):
        block = roots[start:start + chunk]
        delta = block[:, None, :] - guide_roots0[None, :, :]
        d2 = (delta ** 2).sum(axis=2)
        nearest = np.argmin(d2, axis=1)
        np.add.at(per_guide, nearest, 1)
        dmin[start:start + chunk] = np.sqrt(d2[np.arange(len(block)), nearest])
    median = float(np.median(per_guide))
    front_high = full["points"][(np.abs(full["points"][:, 0]) < 0.001)
                                & (full["points"][:, 1] > apex_y)
                                & (full["points"][:, 2] > crown_z - 0.03)]
    first5 = np.stack([full["points"][full["offsets"][i]:full["offsets"][i] + 5, 0].mean()
                       for i in range(full["curveCount"])])
    ok_island = sum(1 for i in range(full["curveCount"])
                    if abs(float(roots[i][0])) < 0.0001 or abs(float(first5[i])) < 0.0001
                    or (float(roots[i][0]) > 0) == (float(first5[i]) > 0))
    lo = roots[:, :2].min(axis=0)
    bins = np.floor((roots[:, :2] - lo) / 0.01).astype(np.int64)
    _keys, bin_counts = np.unique(bins, axis=0, return_counts=True)
    cv = float(bin_counts.std() / max(bin_counts.mean(), 1e-12))
    return {"full": full, "evaluatedCurveCount": int(full["curveCount"]),
            "evaluatedPointCount": int(full["pointCount"]),
            "pointsPerCurveHistogram": {
                str(k): int(v) for k, v in
                sorted(collections.Counter(full["counts"].tolist()).items())},
            "insideBodyCount": int(inside_body.sum()),
            "insideBodyFrac": float(inside_body.mean()),
            "insideShirtCount": int(inside_shirt.sum()),
            "insideShirtFrac": float(inside_shirt.mean()),
            "bodyDistanceMm": {"p5": float(np.nanpercentile(dist_body, 5) * 1000),
                               "p50": float(np.nanpercentile(dist_body, 50) * 1000)},
            "perGuideMax": int(per_guide.max()), "perGuideMedian": median,
            "partCrossingPointCount": int(len(front_high)),
            "rootsCorrectIslandCount": int(ok_island),
            "rootsCorrectIslandFrac": float(ok_island / max(full["curveCount"], 1)),
            "rootDensityCV": cv,
            "rootToGuideMm": {"mean": float(dmin.mean() * 1000),
                              "p50": float(np.median(dmin) * 1000),
                              "p95": float(np.percentile(dmin, 95) * 1000),
                              "max": float(dmin.max() * 1000)}}


def render_views4(c3, hs, handle, canonical, cap, obj, out_dir, tag,
                  size=1024, samples=64):
    out = Path(out_dir) / tag
    out.mkdir(parents=True, exist_ok=True)
    hide = {o.name: (o.hide_render, o.hide_viewport) for o in bpy.data.objects}
    old_hair = handle.hair
    try:
        for o in bpy.data.objects:
            if o is obj or o is handle.camera or o.type == "LIGHT":
                o.hide_render = False
            elif o.type in ("CURVES",):
                o.hide_render = True
        canonical.hide_render = canonical.hide_viewport = True
        cap.hide_render = cap.hide_viewport = True
        handle.hair = obj
        scene = bpy.context.scene
        results = {}
        for view in ("front", "three_quarter", "profile_90", "back", "crown_top"):
            c3.set_final_view(handle, view)
            beauty = out / (view + ".png")
            id_path = out / (view + "-id.png")
            scene.render.resolution_x = scene.render.resolution_y = int(size)
            scene.cycles.samples = int(samples)
            scene.cycles.seed = 0
            scene.render.film_transparent = False
            scene.render.filepath = str(beauty)
            bpy.ops.render.render(write_still=True)
            hs._render_id(handle, id_path, int(size))
            results[view] = {"png": str(beauty), "id_png": str(id_path)}
            print("RENDERED4 %s/%s" % (tag, view), flush=True)
    finally:
        handle.hair = old_hair
        for name, (hr, hv) in hide.items():
            o = bpy.data.objects.get(name)
            if o:
                o.hide_render, o.hide_viewport = hr, hv
    return results


def face_box_hair_pixels(id_png, rows=(300, 583), half_width=100, centre=512):
    from PIL import Image as PILImage
    rgba = np.asarray(PILImage.open(id_png).convert("RGBA"), dtype=np.float64) / 255.0
    mask = rgba[..., 3] > 0.5
    box = np.zeros_like(mask, dtype=bool)
    box[rows[0]:rows[1] + 1, centre - half_width:centre + half_width + 1] = True
    return int((mask & box).sum()), int(mask.sum())


def show_through_top4(c3, handle, cap, id_png):
    from PIL import Image as PILImage
    sil_path = FINAL / "cap-silhouette-top4.png"
    c3.render_cap_silhouette(handle, cap, sil_path)
    sil = np.asarray(PILImage.open(sil_path).convert("RGBA"), dtype=np.float64) / 255.0
    cap_mask = sil[..., 3] > 0.5
    top_id = np.asarray(PILImage.open(id_png).convert("RGBA"), dtype=np.float64) / 255.0
    hair_mask = top_id[..., 3] > 0.5
    return float(((cap_mask) & (~hair_mask)).sum() / max(cap_mask.sum(), 1))


def run_final2():
    """M19: pass A + pass B + guides row, 1024 renders, row-children.json, blend."""
    c3 = import_children3()
    hs = c3.load_hair_scene()
    handle = hs.build_scene()
    canonical = handle.hair
    groups = load_groups4()
    solve = json.load(open(E / "solve.json"))
    uv_layer = next((l for l in handle.head.data.uv_layers if l.active_render), None)
    head_uv = uv_layer.name if uv_layer else handle.head.data.uv_layers[0].name
    cap, cap_info = c3.build_cap_surface(handle, head_uv)
    body = bpy.data.objects["OCLX_collision_basemesh"]
    shirt = bpy.data.objects.get("makeclothes_library_toigo_t_shirt")
    if shirt is None:
        shirt = next(o for o in bpy.data.objects if "t_shirt" in o.name.lower())
    payload = np.load(str(GUIDES_NPZ))
    g0 = np.asarray(payload["points"], dtype=np.float64)[:, 0, :]
    apex_y = float(np.asarray(np.load(str(Path.cwd() / "tools/openclinxr/evidence/hair-flow/cap-v4.npz"))["apex_y"]))
    crown_z = float(np.asarray(payload["crown_z"]))
    # re-solve A from final1's measured yield (2238 @ 42524, target 2000)
    density_a = int(round(42524 * 2000 / 2238))
    print("DENSITY_A %d" % density_a, flush=True)
    obj_a, info_a = build_pass4(c3, handle, groups, cap, "A", density_a, 0.0004,
                                body, shirt, dist_guides=1.0)
    met_a = pass_metrics4(c3, obj_a, body, shirt, g0, apex_y, crown_z)
    print("PASS_A curves=%d body_in=%d shirt_in=%d part_cross=%d" % (
        met_a["evaluatedCurveCount"], met_a["insideBodyCount"],
        met_a["insideShirtCount"], met_a["partCrossingPointCount"]), flush=True)
    density_b = int(round(density_a * 50000 / max(met_a["evaluatedCurveCount"], 1)))
    print("DENSITY_B %d" % density_b, flush=True)
    obj_b, info_b = build_pass4(c3, handle, groups, cap, "B", density_b, 0.00005,
                                body, shirt, dist_guides=3.0)
    met_b = pass_metrics4(c3, obj_b, body, shirt, g0, apex_y, crown_z)
    print("PASS_B curves=%d body_in=%d shirt_in=%d part_cross=%d" % (
        met_b["evaluatedCurveCount"], met_b["insideBodyCount"],
        met_b["insideShirtCount"], met_b["partCrossingPointCount"]), flush=True)
    # guides-only row object (hand UV, profile, no interpolate)
    obj_g, _gr = c3.make_guides_authored(handle, cap, "final4_G", "UVMap")
    obj_g.name = "OCLX_child4_G"
    hand_g = write_surface_uv_hand(obj_g, cap)
    prof_g, prof_g_rb = add_profile(c3, obj_g, groups, 0.00045)
    FINAL.mkdir(parents=True, exist_ok=True)
    renders_a = render_views4(c3, hs, handle, canonical, cap, obj_a, FINAL, "passA")
    renders_b = render_views4(c3, hs, handle, canonical, cap, obj_b, FINAL, "passB")
    renders_g = render_views4(c3, hs, handle, canonical, cap, obj_g, FINAL, "guides")
    # G9 root->cap + G10 face box + show-through
    for met, obj in ((met_a, obj_a), (met_b, obj_b)):
        full = met["full"]
        cap_inv = cap.matrix_world.inverted()
        roots_caplocal = np.empty_like(full["roots"])
        for i in range(len(full["roots"])):
            roots_caplocal[i] = cap_inv @ Vector(tuple(full["roots"][i]))
        bvh = BVHTree.FromPolygons(
            [v.co.copy() for v in cap.data.vertices],
            [list(p.vertices) for p in cap.data.polygons], all_triangles=False)
        d_cap = np.empty(len(roots_caplocal))
        step = max(1, len(roots_caplocal) // 5000)
        for i in range(0, len(roots_caplocal), step):
            _l, _no, _fi, dist = bvh.find_nearest(Vector(tuple(roots_caplocal[i])))
            d_cap[i] = float(dist) if dist is not None else float("nan")
        met["rootToCapMm"] = {"mean": float(np.nanmean(d_cap) * 1000),
                              "max": float(np.nanmax(d_cap) * 1000)}
    for tag, met, renders in (("A", met_a, renders_a), ("B", met_b, renders_b)):
        # offset vector (sampled for B)
        roots = met["full"]["roots"]
        idx = np.arange(len(roots)) if len(roots) <= 5000 else \
            np.random.default_rng(0).choice(len(roots), 5000, replace=False)
        sample = roots[idx]
        delta = sample[:, None, :] - g0[None, :, :]
        nearest = np.argmin((delta ** 2).sum(axis=2), axis=1)
        off = sample - g0[nearest]
        met["offsetMeanMm"] = [float(v * 1000) for v in off.mean(axis=0)]
        met["offsetSdMm"] = [float(v * 1000) for v in off.std(axis=0)]
        box_count, mask_total = face_box_hair_pixels(renders["front"]["id_png"])
        met["faceBoxHairPixels"] = box_count
        met["faceBoxMaskTotal"] = mask_total
        met["renders"] = renders
    show_a = show_through_top4(c3, handle, cap, renders_a["crown_top"]["id_png"])
    show_b = show_through_top4(c3, handle, cap, renders_b["crown_top"]["id_png"])
    name_map = {}
    for name in GROUP_NAMES4:
        for item in groups[name].interface.items_tree:
            if hasattr(item, "identifier") and item.identifier:
                name_map.setdefault(item.name, []).append(item.identifier)
    d1 = json.load(open(DIAG / "d1.json"))
    steps = json.load(open(DIAG / "steps.json")) if (DIAG / "steps.json").exists() else []
    for tag, met, info, density, radius in (
            ("A", met_a, info_a, density_a, 0.0004),
            ("B", met_b, info_b, density_b, 0.00005)):
        full = met.pop("full")
        met.update({"density": density, "radius": radius,
                    "socketReadBack": info["readback"],
                    "colliders": [{k: v for k, v in c.items() if k != "modifier"}
                                  for c in info["colliders"]],
                    "profileGroup": "Set Hair Curve Profile",
                    "profileReadback": info["profile"],
                    "radiusMinMax": eval_radius_minmax(
                        obj_a if tag == "A" else obj_b)})
    row = {
        "schemaVersion": 4,
        "surfaceObject": cap.name, "surfaceUvMap": "UVMap",
        "attachment": "no Attach modifier; hand-written CURVE-domain "
                      "surface_uv_coordinate (children1 M2); Interpolate alone",
        "causeD1": "Attach Hair Curves to Surface (Snap to Surface on) teleports "
                   "guides: evaluated guide roots shift mean 415 mm, centroid "
                   "(dy +59 mm, dz -375 mm); cap/object matrices all identity; "
                   "cap UVs 96% overlapped. Before/after: mut0 Attach-on displaced "
                   "vs mut2 Attach-off on-scalp, same density/seed/scene.",
        "capSurface": cap_info, "nameToIdentifier": name_map,
        "cameraTarget": list(handle.target),
        "d1_diagnosis": d1,
        "mutation_log": steps,
        "collideCompare": {"without": solve["noCollide"], "with": solve["withCollide"],
                           "verdict": "kept on: no visible degradation at 384px; "
                                      "inside-body 42%->22%, shirt 9.5%->5.8%"},
        "renderSettings": {"size": 1024, "samples": 64,
                           "views": ["front", "three_quarter", "profile_90",
                                     "back", "crown_top"],
                           "camera": "HS camera/target via set_final_view"},
        "profileNote": "Real Set Hair Curve Profile group (Blender 5.1.1 bundled "
                       "procedural_hair_node_assets.blend): Radius per pass, Shape 0, "
                       "Replace Radius on. Corrects the false note in the superseded "
                       "row-children.json.",
        "collisionNote": "Real Shrinkwrap Hair Curves group (same asset blend): "
                         "Above Surface 0.0, Offset Distance 2 mm, Lock Roots on, "
                         "Factor 1.0, against body then t-shirt. Corrects the false "
                         "note in the superseded row-children.json.",
        "showThroughTop": {"A": show_a, "B": show_b},
        "guidesHandUV": hand_g,
        "guidesRenders": renders_g,
        "passes": {"A": met_a, "B": met_b},
        "judge": None,
    }
    with (FINAL / "row-children.json").open("w") as stream:
        json.dump(row, stream, indent=2)
    bpy.ops.wm.save_as_mainfile(filepath=str(FINAL / "final.blend"))
    print("FINAL4_DONE " + json.dumps(
        {"A": met_a["evaluatedCurveCount"], "B": met_b["evaluatedCurveCount"],
         "showA": show_a, "showB": show_b}, sort_keys=True), flush=True)


def run_final3():
    """M19 correction: rebuild B at re-solved density (G3B was missed in final2).
    Rebuilds A at its recorded density for blend provenance; re-renders B only.
    Updates FINAL/row-children.json passes.B + showThroughTop.B; re-saves blend."""
    c3 = import_children3()
    hs = c3.load_hair_scene()
    handle = hs.build_scene()
    canonical = handle.hair
    groups = load_groups4()
    old_row = json.load(open(FINAL / "row-children.json"))
    old_b = old_row["passes"]["B"]
    old_a = old_row["passes"]["A"]
    density_b = int(round(old_b["density"] * 50000 / max(old_b["evaluatedCurveCount"], 1)))
    print("DENSITY_B2 %d" % density_b, flush=True)
    uv_layer = next((l for l in handle.head.data.uv_layers if l.active_render), None)
    head_uv = uv_layer.name if uv_layer else handle.head.data.uv_layers[0].name
    cap, cap_info = c3.build_cap_surface(handle, head_uv)
    body = bpy.data.objects["OCLX_collision_basemesh"]
    shirt = bpy.data.objects.get("makeclothes_library_toigo_t_shirt")
    if shirt is None:
        shirt = next(o for o in bpy.data.objects if "t_shirt" in o.name.lower())
    payload = np.load(str(GUIDES_NPZ))
    g0 = np.asarray(payload["points"], dtype=np.float64)[:, 0, :]
    cap4 = np.load(str(Path.cwd() / "tools/openclinxr/evidence/hair-flow/cap-v4.npz"))
    apex_y = float(np.asarray(cap4["apex_y"]))
    crown_z = float(np.asarray(payload["crown_z"]))
    obj_a, info_a = build_pass4(c3, handle, groups, cap, "A", old_a["density"],
                                0.0004, body, shirt, dist_guides=1.0)
    met_a_new = pass_metrics4(c3, obj_a, body, shirt, g0, apex_y, crown_z)
    obj_b, info_b = build_pass4(c3, handle, groups, cap, "B", density_b, 0.00005,
                                body, shirt, dist_guides=3.0)
    met_b = pass_metrics4(c3, obj_b, body, shirt, g0, apex_y, crown_z)
    print("PASS_B2 curves=%d body_in=%d shirt_in=%d part_cross=%d" % (
        met_b["evaluatedCurveCount"], met_b["insideBodyCount"],
        met_b["insideShirtCount"], met_b["partCrossingPointCount"]), flush=True)
    FINAL.mkdir(parents=True, exist_ok=True)
    renders_b = render_views4(c3, hs, handle, canonical, cap, obj_b, FINAL, "passB")
    roots = met_b["full"]["roots"]
    idx = np.random.default_rng(0).choice(len(roots), min(5000, len(roots)),
                                          replace=False)
    sample = roots[idx]
    delta = sample[:, None, :] - g0[None, :, :]
    nearest = np.argmin((delta ** 2).sum(axis=2), axis=1)
    off = sample - g0[nearest]
    met_b["offsetMeanMm"] = [float(v * 1000) for v in off.mean(axis=0)]
    met_b["offsetSdMm"] = [float(v * 1000) for v in off.std(axis=0)]
    box_count, mask_total = face_box_hair_pixels(renders_b["front"]["id_png"])
    met_b["faceBoxHairPixels"] = box_count
    met_b["faceBoxMaskTotal"] = mask_total
    met_b["renders"] = renders_b
    full = met_b.pop("full")
    cap_inv = cap.matrix_world.inverted()
    bvh = BVHTree.FromPolygons(
        [v.co.copy() for v in cap.data.vertices],
        [list(p.vertices) for p in cap.data.polygons], all_triangles=False)
    d_cap = np.empty(len(full["roots"]))
    step = max(1, len(full["roots"]) // 5000)
    for i in range(0, len(full["roots"]), step):
        q = cap_inv @ Vector(tuple(full["roots"][i]))
        _l, _no, _fi, dist = bvh.find_nearest(q)
        d_cap[i] = float(dist) if dist is not None else float("nan")
    met_b["rootToCapMm"] = {"mean": float(np.nanmean(d_cap) * 1000),
                            "max": float(np.nanmax(d_cap) * 1000)}
    met_b.update({"density": density_b, "radius": 0.00005,
                  "socketReadBack": info_b["readback"],
                  "colliders": [{k: v for k, v in c.items() if k != "modifier"}
                                for c in info_b["colliders"]],
                  "profileGroup": "Set Hair Curve Profile",
                  "profileReadback": info_b["profile"],
                  "radiusMinMax": eval_radius_minmax(obj_b)})
    old_row["passes"]["B"] = met_b
    old_row["passes"]["Battempts"] = (old_row["passes"].get("Battempts", 1) + 1
                                      if isinstance(old_row["passes"].get("Battempts"), int)
                                      else 2)
    old_row["showThroughTop"]["B"] = show_through_top4(
        c3, handle, cap, renders_b["crown_top"]["id_png"])
    old_row["blendProvenance"] = {
        "note": "final.blend re-saved by final3: A rebuilt at recorded density "
                "(fresh count %d vs rendered %d; A renders/metrics kept from final2), "
                "B rebuilt at re-solved density and re-rendered." % (
                    met_a_new["evaluatedCurveCount"], old_a["evaluatedCurveCount"])}
    with (FINAL / "row-children.json").open("w") as stream:
        json.dump(old_row, stream, indent=2)
    bpy.ops.wm.save_as_mainfile(filepath=str(FINAL / "final.blend"))
    print("FINAL3_DONE " + json.dumps(
        {"B": met_b["evaluatedCurveCount"],
         "showB": old_row["showThroughTop"]["B"]}, sort_keys=True), flush=True)


def run_mut(n):
    c3 = import_children3()
    what = MUTS[n]
    vdir = DIAG / ("%d-%s" % (n, what))
    vdir.mkdir(parents=True, exist_ok=True)
    hs = c3.load_hair_scene()
    handle = hs.build_scene()
    canonical = handle.hair
    groups = c3.load_groups()
    uv_layer = next((l for l in handle.head.data.uv_layers if l.active_render), None)
    head_uv = uv_layer.name if uv_layer else handle.head.data.uv_layers[0].name
    cap, cap_info = c3.build_cap_surface(handle, head_uv)
    notes = {"capInfo": cap_info}
    if what == "smart-project":
        notes["smartProject"] = smart_project_cap_uv(cap)
    if what == "no-solidify":
        notes["capModifiers"] = [m.type for m in cap.modifiers]
        notes["solidifyPresent"] = any(m.type == "SOLIDIFY" for m in cap.modifiers)
    guides, _roots = c3.make_guides_authored(handle, cap, "mut%d" % n, "UVMap")
    use_attach = what != "no-attach-hand-uv"
    if not use_attach:
        notes["handUV"] = write_surface_uv_hand(guides, cap)
    spec = {"id": "mut%d" % n, "label": what, "attach": use_attach,
            "interpolate": True, "density": 31000, "islands": True, "mask": True,
            "interpGuides": 2, "distGuides": 1.0}
    readback = c3.configure_modifiers(guides, cap, groups, "UVMap", spec)
    if what == "snap-off":
        snap_key = next(k for k, v in readback["attach"].items()
                        if v.get("name") == "Snap to Surface")
        guides.modifiers["OCLX_attach"][snap_key] = False
        guides.update_tag()
        bpy.context.view_layer.update()
        notes["snapOffKey"] = snap_key
    full = c3.evaluated_full(guides)
    payload = np.load(str(GUIDES_NPZ))
    g0 = np.asarray(payload["points"], dtype=np.float64)[:, 0, :]
    roots = full["roots"]
    chunk = 4000
    dmin = np.empty(len(roots))
    for start in range(0, len(roots), chunk):
        block = roots[start:start + chunk]
        delta = block[:, None, :] - g0[None, :, :]
        dmin[start:start + chunk] = np.sqrt((delta ** 2).sum(axis=2)).min(axis=1)
    n_curves = int(full["curveCount"])
    step = {"n": n, "what": what, "children": n_curves,
            "rootToGuideMm": {"mean": float(dmin.mean() * 1000) if n_curves else None,
                              "p95": float(np.percentile(dmin, 95) * 1000) if n_curves else None,
                              "max": float(dmin.max() * 1000) if n_curves else None},
            "hist": {str(k): int(v) for k, v in
                     sorted(__import__("collections").Counter(full["counts"].tolist()).items())},
            "notes": notes}
    # visibility: mirror final renders (hide canonical + cap); hide-only goes further
    canonical.hide_render = canonical.hide_viewport = True
    cap.hide_render = cap.hide_viewport = True
    if what == "hide-only":
        hidden_extra = []
        for obj in bpy.data.objects:
            if obj in (guides, handle.head, handle.camera):
                continue
            if obj.type not in ("MESH", "CURVES"):
                continue
            ln = obj.name.lower()
            if ("t_shirt" in ln or "jeans" in ln or "shoes" in ln
                    or ln == "oclx_aisha_head"
                    or ("eye" in ln and "brow" not in ln and "lash" not in ln)):
                continue
            obj.hide_render = True
            hidden_extra.append(obj.name)
        notes["hiddenExtra"] = sorted(hidden_extra)
    old_hair = handle.hair
    handle.hair = guides
    try:
        c3.set_final_view(handle, "front")
        scene = bpy.context.scene
        scene.render.resolution_x = scene.render.resolution_y = 384
        scene.cycles.samples = 16
        scene.cycles.seed = 0
        scene.render.film_transparent = False
        beauty = vdir / "front.png"
        scene.render.filepath = str(beauty)
        bpy.ops.render.render(write_still=True)
        hs._render_id(handle, vdir / "front-id.png", 384)
        step["renders"] = {"front": str(beauty),
                           "id": str(vdir / "front-id.png")}
    finally:
        handle.hair = old_hair
    steps_path = DIAG / "steps.json"
    steps = json.load(open(steps_path)) if steps_path.exists() else []
    steps = [s for s in steps if s.get("n") != n] + [step]
    with steps_path.open("w") as stream:
        json.dump(steps, stream, indent=2)
    print("MUT_STEP " + json.dumps(step, sort_keys=True))
    print("MUT_WRITTEN " + str(vdir))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", default="diag")
    parser.add_argument("--cell", default="")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(argv)
    if args.phase == "diag":
        run_diag()
    elif args.phase == "lane":
        run_lane(args.cell)
    elif args.phase.startswith("mut"):
        run_mut(int(args.phase[3:]))
    elif args.phase == "final1":
        run_final1()
    elif args.phase == "final2":
        run_final2()
    elif args.phase == "final3":
        run_final3()
    else:
        raise SystemExit("unknown phase %r" % args.phase)


# (main entry moved to end of file: lane cells appended below)


# ---- hair-lanes-1 (appended copy-and-mutate of the final4 path above) ----
# C0 = pass-A inputs as shipped (Follow off, IG 2, Poisson, mask attr,
# Distance as configured, islands on, seed 0) + identical Shrinkwrap/Profile
# in every cell. Attach FORBIDDEN (hand UV only). R3-strict evaluation.
import collections as _collections

LE = Path.cwd() / "tools/openclinxr/evidence/hair-lanes"
LANE_RADIUS = 0.0004
LANE_TARGET = 2000
LANE_LO, LANE_HI = 1900, 2100
LANE_START_DENSITY = 38002
LANE_SIZE = 512
LANE_SAMPLES = 32

LANE_CELLS = [
    {"id": "C0", "change": "baseline (pass-A inputs as shipped)",
     "follow": False, "interp": 2, "maskAttr": True, "distribRaw": 1},
    {"id": "C1", "change": "Follow Surface Normal on",
     "follow": True, "interp": 2, "maskAttr": True, "distribRaw": 1},
    {"id": "C2", "change": "Interpolation Guides 4",
     "follow": False, "interp": 4, "maskAttr": True, "distribRaw": 1},
    {"id": "C3", "change": "Interpolation Guides 3",
     "follow": False, "interp": 3, "maskAttr": True, "distribRaw": 1},
    {"id": "C4", "change": "Density Mask constant 1.0 (no attribute)",
     "follow": False, "interp": 2, "maskAttr": False, "distribRaw": 1},
    {"id": "C5", "change": "Distribution Random",
     "follow": False, "interp": 2, "maskAttr": True, "distribRaw": 0},
    {"id": "C6", "change": "Follow on + Interpolation Guides 4",
     "follow": True, "interp": 4, "maskAttr": True, "distribRaw": 1},
]

LANE_BODY_KEEP = ("OCLX_Aisha_head",
                  "mpfb_parent_tara_johnson_v1_body_mesh",
                  "makeclothes_library_toigo_t_shirt",
                  "makeclothes_library_female_tight_jeans_pants",
                  "makeclothes_library_footwear_toigo_mj_cloth_shoes_mpfb_peds_anxious_parent")


def lane_evaluated(guides):
    """R3-strict: update_tag + view_layer.update, then a FRESH depsgraph."""
    guides.update_tag()
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    data = guides.evaluated_get(depsgraph).data
    n = len(data.curves)
    offsets = np.empty(n + 1, dtype=np.int64)
    if n:
        data.curve_offset_data.foreach_get("value", offsets)
        counts = np.diff(offsets)
        total = int(offsets[-1])
        flat = np.empty(total * 3, dtype=np.float32)
        data.attributes["position"].data.foreach_get("vector", flat)
        local = flat.reshape((-1, 3)).astype(np.float64)
    else:
        counts, local, total = np.zeros(0), np.zeros((0, 3)), 0
    mat = guides.matrix_world.copy()
    world = world_of(local, mat) if total else local
    roots = world[offsets[:-1]] if n else np.zeros((0, 3))
    return {"n": n, "counts": counts, "offsets": offsets,
            "points": world, "roots": roots}


def lane_curve_count(guides):
    return lane_evaluated(guides)["n"]


def lane_read_inputs(c3, mod_interp, grp_interp):
    def key(name):
        return c3.input_socket(grp_interp, name).identifier
    k_follow = key("Follow Surface Normal")
    k_interp = key("Interpolation Guides")
    k_dist = key("Distance to Guides")
    k_islands = key("Part by Mesh Islands")
    k_seed = key("Seed")
    k_dens = key("Density")
    k_menu = key("Distribution Method")
    k_mask = key("Density Mask")
    if bool(mod_interp[k_mask + "_use_attribute"]):
        mask = "attr:" + str(mod_interp[k_mask + "_attribute_name"])
    else:
        mask = float(mod_interp[k_mask])
    menu_raw = int(mod_interp[k_menu])
    return {"followSurfaceNormal": bool(mod_interp[k_follow]),
            "interpolationGuides": int(mod_interp[k_interp]),
            "distributionMethod": {0: "Random", 1: "Poisson Disk"}.get(
                menu_raw, "menu<%d>" % menu_raw),
            "distributionRaw": menu_raw,
            "densityMask": mask,
            "distanceToGuides": float(mod_interp[k_dist]),
            "partByMeshIslands": bool(mod_interp[k_islands]),
            "density": float(mod_interp[k_dens]),
            "seed": int(mod_interp[k_seed])}


def lane_gutters(scalp):
    """Connected 4-components of the scalp-visible mask; returns sorted sizes."""
    H, W = scalp.shape
    idx = np.full((H, W), -1, dtype=np.int32)
    ys, xs = np.nonzero(scalp)
    m = len(ys)
    if not m:
        return []
    idx[ys, xs] = np.arange(m, dtype=np.int32)
    parent = list(range(m))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for k in range(m):
        y, x = int(ys[k]), int(xs[k])
        if x > 0 and idx[y, x - 1] >= 0:
            a, b = find(k), find(int(idx[y, x - 1]))
            if a != b:
                parent[a] = b
        if y > 0 and idx[y - 1, x] >= 0:
            a, b = find(k), find(int(idx[y - 1, x]))
            if a != b:
                parent[a] = b
    sizes = {}
    for k in range(m):
        r = find(k)
        sizes[r] = sizes.get(r, 0) + 1
    return sorted(sizes.values(), reverse=True)


def lane_top_analysis(id_png, sil_path):
    from PIL import Image as PILImage
    hair = (np.asarray(PILImage.open(id_png).convert("RGBA"),
                       dtype=np.float64) / 255.0)[..., 3] > 0.5
    sil = (np.asarray(PILImage.open(sil_path).convert("RGBA"),
                      dtype=np.float64) / 255.0)[..., 3] > 0.5
    cap_n = int(sil.sum())
    hair_n = int((sil & hair).sum())
    scalp = sil & (~hair)
    show = float(scalp.sum() / max(cap_n, 1))
    sizes = lane_gutters(scalp)
    big = [s for s in sizes if s > 20]
    return {"capPixels": cap_n, "hairPixels": hair_n,
            "showThrough": show, "gutterCount": len(big),
            "gutterSizes": big[:12]}


def run_lane(cell_id):
    cells = {c["id"]: c for c in LANE_CELLS}
    if cell_id not in cells:
        raise SystemExit("unknown cell %r" % cell_id)
    cell = cells[cell_id]
    (LE / "cells").mkdir(parents=True, exist_ok=True)
    c3 = import_children3()
    hs = c3.load_hair_scene()
    handle = hs.build_scene()
    canonical = handle.hair
    groups = load_groups4()
    uv_layer = next((l for l in handle.head.data.uv_layers if l.active_render), None)
    head_uv = uv_layer.name if uv_layer else handle.head.data.uv_layers[0].name
    cap, cap_info = c3.build_cap_surface(handle, head_uv)
    body = bpy.data.objects["OCLX_collision_basemesh"]
    shirt = bpy.data.objects.get("makeclothes_library_toigo_t_shirt")
    if shirt is None:
        shirt = next(o for o in bpy.data.objects if "t_shirt" in o.name.lower())
    payload = np.load(str(GUIDES_NPZ))
    g0 = np.asarray(payload["points"], dtype=np.float64)[:, 0, :]
    apex_y = float(np.asarray(np.load(str(
        Path.cwd() / "tools/openclinxr/evidence/hair-flow/cap-v4.npz"))["apex_y"]))
    crown_z = float(np.asarray(payload["crown_z"]))

    guides, _roots = c3.make_guides_authored(handle, cap, "lane_" + cell_id, "UVMap")
    guides.name = "OCLX_lane_" + cell_id
    hand = write_surface_uv_hand(guides, cap)
    spec = {"id": "lane_" + cell_id, "label": cell["change"], "attach": False,
            "interpolate": True, "density": LANE_START_DENSITY, "islands": True,
            "mask": cell["maskAttr"], "interpGuides": 2, "distGuides": 1.0}
    c3.configure_modifiers(guides, cap, groups, "UVMap", spec)
    mod_interp = guides.modifiers["OCLX_interpolate"]
    grp_interp = groups["Interpolate Hair Curves"]
    override_rb = {}
    if cell["follow"]:
        c3.set_input(mod_interp, grp_interp, "Follow Surface Normal",
                     True, override_rb)
    if cell["interp"] != 2:
        c3.set_input(mod_interp, grp_interp, "Interpolation Guides",
                     int(cell["interp"]), override_rb)
    if cell["distribRaw"] != 1:
        sock = c3.input_socket(grp_interp, "Distribution Method")
        mod_interp[sock.identifier] = int(cell["distribRaw"])
        override_rb[sock.identifier] = {
            "name": "Distribution Method", "identifier": sock.identifier,
            "wroteRaw": int(cell["distribRaw"]),
            "readBack": int(mod_interp[sock.identifier])}
    guides.update_tag()
    bpy.context.view_layer.update()

    attempts = []
    density = LANE_START_DENSITY
    for _ in range(4):
        rb = {}
        c3.set_input(mod_interp, grp_interp, "Density", float(density), rb)
        n = lane_curve_count(guides)
        attempts.append({"density": density, "curves": int(n)})
        print("LANE_SOLVE %s density=%d curves=%d" % (cell_id, density, n), flush=True)
        if LANE_LO <= n <= LANE_HI:
            break
        density = int(round(density * LANE_TARGET / max(n, 1)))
    inputs = lane_read_inputs(c3, mod_interp, grp_interp)

    colliders = []
    for collider, suffix in ((body, "body"), (shirt, "shirt")):
        mod, rb = add_shrinkwrap(c3, guides, groups, collider,
                                 "lane" + cell_id + "_" + suffix)
        colliders.append({"collider": collider.name, "readback": rb})
    _prof_mod, prof_rb = add_profile(c3, guides, groups, LANE_RADIUS)

    full = lane_evaluated(guides)
    roots, points = full["roots"], full["points"]
    inside_body, dist_body = c3.inside_fractions(points, body)
    inside_shirt, _dist_shirt = c3.inside_fractions(points, shirt)
    per_guide = np.zeros(len(g0), dtype=np.int64)
    dmin = np.empty(len(roots))
    chunk = 4000
    for start in range(0, len(roots), chunk):
        block = roots[start:start + chunk]
        delta = block[:, None, :] - g0[None, :, :]
        d2 = (delta ** 2).sum(axis=2)
        nearest = np.argmin(d2, axis=1)
        np.add.at(per_guide, nearest, 1)
        dmin[start:start + chunk] = np.sqrt(d2[np.arange(len(block)), nearest])
    front_high = points[(np.abs(points[:, 0]) < 0.001)
                        & (points[:, 1] > apex_y)
                        & (points[:, 2] > crown_z - 0.03)]
    first5 = np.stack([points[full["offsets"][i]:full["offsets"][i] + 5, 0].mean()
                       for i in range(full["n"])])
    ok_island = sum(1 for i in range(full["n"])
                    if abs(float(roots[i][0])) < 0.0001 or abs(float(first5[i])) < 0.0001
                    or (float(roots[i][0]) > 0) == (float(first5[i]) > 0))
    lo = roots[:, :2].min(axis=0)
    bins = np.floor((roots[:, :2] - lo) / 0.01).astype(np.int64)
    _keys, bin_counts = np.unique(bins, axis=0, return_counts=True)
    cv = float(bin_counts.std() / max(bin_counts.mean(), 1e-12))
    cap_inv = cap.matrix_world.inverted()
    bvh = BVHTree.FromPolygons(
        [v.co.copy() for v in cap.data.vertices],
        [list(p.vertices) for p in cap.data.polygons], all_triangles=False)
    d_cap = np.empty(len(roots))
    step = max(1, len(roots) // 2000)
    for i in range(0, len(roots), step):
        q = cap_inv @ Vector(tuple(roots[i]))
        _l, _no, _fi, dist = bvh.find_nearest(q)
        d_cap[i] = float(dist) if dist is not None else float("nan")
    idx = np.arange(len(roots)) if len(roots) <= 5000 else \
        np.random.default_rng(0).choice(len(roots), 5000, replace=False)
    sample = roots[idx]
    delta = sample[:, None, :] - g0[None, :, :]
    nearest = np.argmin((delta ** 2).sum(axis=2), axis=1)
    off = sample - g0[nearest]

    # M4 renders: crown top + front at 512, existing lights, only body/garments/cell
    keep = {guides.name, handle.camera.name}
    keep |= {o.name for o in bpy.data.objects if o.type == "LIGHT"}
    for name in LANE_BODY_KEEP:
        if bpy.data.objects.get(name) is not None:
            keep.add(name)
    saved = {o.name: o.hide_render for o in bpy.data.objects}
    old_hair = handle.hair
    renders = {}
    try:
        for o in bpy.data.objects:
            o.hide_render = o.name not in keep
        handle.hair = guides
        scene = bpy.context.scene
        for view in ("crown_top", "front"):
            c3.set_final_view(handle, view)
            scene.render.resolution_x = scene.render.resolution_y = LANE_SIZE
            scene.cycles.samples = LANE_SAMPLES
            scene.cycles.seed = 0
            scene.render.film_transparent = False
            beauty = LE / "cells" / (cell_id + "-" + view + ".png")
            id_path = LE / "cells" / (cell_id + "-" + view + "-id.png")
            scene.render.filepath = str(beauty)
            bpy.ops.render.render(write_still=True)
            hs._render_id(handle, id_path, LANE_SIZE)
            renders[view] = {"png": str(beauty), "id_png": str(id_path)}
            print("LANE_RENDERED %s/%s" % (cell_id, view), flush=True)
    finally:
        handle.hair = old_hair
        for name, state in saved.items():
            o = bpy.data.objects.get(name)
            if o:
                o.hide_render = state
    sil_path = LE / "cells" / (cell_id + "-cap-silhouette.png")
    c3.render_cap_silhouette(handle, cap, sil_path, size=LANE_SIZE)
    top = lane_top_analysis(renders["crown_top"]["id_png"], sil_path)

    out = {
        "cell": cell_id, "change": cell["change"],
        "specIntent": {k: cell[k] for k in ("follow", "interp", "maskAttr", "distribRaw")},
        "blenderVersion": bpy.app.version_string,
        "inputs": inputs, "overrideReadback": override_rb,
        "densityAttempts": attempts, "density": inputs["density"],
        "radius": LANE_RADIUS, "handUV": hand,
        "colliders": [c["collider"] for c in colliders],
        "profileReadback": prof_rb,
        "evaluatedCurveCount": int(full["n"]),
        "evaluatedPointCount": int(full["points"].shape[0]),
        "pointsPerCurveHistogram": {
            str(k): int(v) for k, v in
            sorted(_collections.Counter(full["counts"].tolist()).items())},
        "insideBodyCount": int(inside_body.sum()),
        "insideBodyFrac": float(inside_body.mean()),
        "insideShirtCount": int(inside_shirt.sum()),
        "insideShirtFrac": float(inside_shirt.mean()),
        "bodyDistanceMm": {"p5": float(np.nanpercentile(dist_body, 5) * 1000),
                           "p50": float(np.nanpercentile(dist_body, 50) * 1000)},
        "perGuideMax": int(per_guide.max()),
        "perGuideMedian": float(np.median(per_guide)),
        "partCrossingPointCount": int(len(front_high)),
        "rootsCorrectIslandCount": int(ok_island),
        "rootsCorrectIslandFrac": float(ok_island / max(full["n"], 1)),
        "rootDensityCV": cv,
        "rootToGuideMm": {"mean": float(dmin.mean() * 1000),
                          "p50": float(np.median(dmin) * 1000),
                          "p95": float(np.percentile(dmin, 95) * 1000),
                          "max": float(dmin.max() * 1000)},
        "rootToCapMm": {"mean": float(np.nanmean(d_cap) * 1000),
                        "max": float(np.nanmax(d_cap) * 1000)},
        "offsetMeanMm": [float(v * 1000) for v in off.mean(axis=0)],
        "offsetSdMm": [float(v * 1000) for v in off.std(axis=0)],
        "showThroughTop": top["showThrough"],
        "gutterCount": top["gutterCount"],
        "gutterSizes": top["gutterSizes"],
        "capPixels": top["capPixels"],
        "hairPixelsTop": top["hair_n"] if "hair_n" in top else top["hairPixels"],
        "renders": renders,
        "capSilhouette": str(sil_path),
        "visibleSet": sorted(keep),
    }
    with (LE / "cells" / (cell_id + ".json")).open("w") as stream:
        json.dump(out, stream, indent=2)
    print("LANE_DONE " + json.dumps(
        {k: out[k] for k in ("cell", "evaluatedCurveCount", "insideBodyFrac",
                             "rootDensityCV", "showThroughTop", "gutterCount",
                             "partCrossingPointCount", "density")}, sort_keys=True),
        flush=True)

if __name__ == "__main__":
    main()
