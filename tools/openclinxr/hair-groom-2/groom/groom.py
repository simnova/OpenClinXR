"""hair-groom-2 procedural strand groom (Blender 5.2 headless).

    Blender --background --factory-startup --python groom.py -- \
        --body <actor.glb> --recipe <recipe.json> --out-dir <dir> \
        [--views front,three_quarter_left,side] [--samples 96] [--seed-offset 0]

Geometry = f(recipe, seed, body). No per-strand coordinate is chosen by hand:
  1. scalp: body faces above a hairline height table (head-local, by azimuth
     around the head centre), cut at the mid-sagittal plane into two islands
     separated by partWidthMm (bmesh bisect).
  2. guide roots: seeded area-weighted dart throwing on the scalp.
  3. guides: marched through a documented field: gravity, part-away
     direction, a comb rail that keeps anterior strands lateral of the face
     until they clear it, a shoulder field that sends anterior/lateral strands
     forward of the shoulders, and a signed-distance push off body+garment at
     a fixed volume offset.
  4. children: bundled node groups Interpolate (part by mesh islands) ->
     Clump -> Frizz -> Trim, every seed from the recipe.
  5. final signed-distance push at clearanceMm off body+garment.
Writes stats.json, guides.npz-free positions hash, and one PNG per view.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ASSETS = Path(bpy.utils.resource_path("LOCAL")) / "datafiles/assets/nodes/procedural_hair_node_assets.blend"
LIB_HAIR_TAG = "makeclothes_library_hair_"
ENV_PROXY = "icosphere"            # 2 m environment proxy shipped in the GLB, never body
GARMENT_TAGS = ("shirt", "pants", "shoe", "footwear")
MIN_ISLAND_FRACTION = 0.05         # scalp islands below this area share are hairline-cut fragments
GARMENT_PUSH_RADIUS_M = 0.015      # garment sign trusted only this close to the cloth
WELD_M = 1e-5                      # seam weld distance (glTF split vertices are coincident)
RAIL_CLEARED = 0.9                 # fraction of the comb rail after which the back pull starts
RAIL_BACK_RAMP_M = 0.03            # back pull reaches full gain this far ahead of its target
SIDE_SEED_STRIDE = 101             # seed offset of the right-side child pass
PART_BY_ISLANDS = True             # children interpolate only from guides on their side of the part
STAGES = ["interpolate", "clump", "frizz", "trim"]
SCALP_UV = "UVMap"                 # spherical scalp UV; the bundled assets read the name "UVMap"
SCALP_CUTS = 4                     # flat edge cuts on hairline-adjacent body faces before masking
CANDIDATE_FACTOR = 30              # dart-throwing candidates per requested guide
POISSON_RADIUS_FACTOR = 0.75       # dart radius = factor * sqrt(scalp area / guide count)
ROOT_NORMAL_WEIGHT = 0.35          # weight of the scalp normal in a guide's first direction
ROOT_DOWN_WEIGHT = 0.25            # weight of world-down in a guide's first direction
BACK_FIELD_RATIO = 0.5             # back roots get this fraction of the forward shoulder gain, backward
ESCAPE_STEPS = 40                  # outward march steps for a point the projection cannot settle
ESCAPE_STEP_M = 0.001
PUSH_PASSES = 3                    # signed-distance push passes on the final strands
FRAME_HEIGHT_M = 0.57              # front frame height: target shows head top at 13%, eyes at 37%
EYE_FROM_TOP = 0.37
FOCAL_MM = 85.0
SENSOR_MM = 36.0
RES = 1024
VIEW_AZIMUTH_DEG = {"front": 0.0, "three_quarter_left": 45.0, "side": 90.0, "back": 180.0}


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--body", required=True)
    p.add_argument("--recipe", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--views", default="front,three_quarter_left,side")
    p.add_argument("--samples", type=int, default=96)
    p.add_argument("--seed-offset", type=int, default=0)
    p.add_argument("--stop-after", choices=STAGES, default=None, help="debug: truncate the child chain")
    p.add_argument("--debug-hide-hair", action="store_true", help="debug: render without the groom")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------- body
def load_body(glb):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    objs = sorted(bpy.data.objects, key=lambda o: o.name)
    hidden = []
    for o in objs:
        if o.type == "MESH" and (LIB_HAIR_TAG in o.name or o.name.lower() == ENV_PROXY):
            o.hide_render = True
            o.hide_viewport = True
            hidden.append(o.name)
    if not any(LIB_HAIR_TAG in h for h in hidden):
        raise RuntimeError("no library hair mesh found to hide")
    body = [o for o in objs if o.type == "MESH" and o.name.endswith("_body")]
    if len(body) != 1:
        raise RuntimeError("expected one *_body mesh, got %s" % [o.name for o in body])
    garments = [o for o in objs if o.type == "MESH" and not o.hide_render
                and any(t in o.name.lower() for t in GARMENT_TAGS)]
    rig = [o for o in objs if o.type == "ARMATURE"][0]
    return body[0], garments, rig, hidden


def world_bmesh(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.transform(obj.matrix_world)
    ev.to_mesh_clear()
    bm.normal_update()
    return bm


def head_frame(rig, body_bm):
    pb = rig.pose.bones["head"]
    M = rig.matrix_world @ pb.matrix
    origin = M.translation.copy()
    up = (M.to_3x3() @ Vector((0, 1, 0))).normalized()
    fwd = Vector((0, -1, 0))
    fwd = (fwd - up * fwd.dot(up)).normalized()
    right = up.cross(fwd).normalized()
    R = Matrix((right, -fwd, up))  # rows: local x (subject left), y (back), z (up)
    V = np.array([R @ (v.co - origin) for v in body_bm.verts])
    head = V[V[:, 2] > 0.0]
    centre = np.array([0.0, 0.5 * (head[:, 1].min() + head[:, 1].max()),
                       0.5 * (head[:, 2].min() + head[:, 2].max())])
    return origin, R, centre, float(head[:, 2].max())


def to_local(p, origin, R):
    return np.array(R @ (Vector(p) - origin))


# ---------------------------------------------------------------- scalp
def build_scalp(body, origin, R, centre, rc):
    bm = world_bmesh(body)
    table = np.array(rc["scalp"]["hairlineMmAboveHeadOriginByAzimuthDeg"], dtype=float)
    min_up = rc["scalp"]["minUpwardNormal"]

    def is_scalp_v(co):
        p = to_local(co, origin, R)
        rel = p - centre
        az = math.degrees(math.atan2(abs(rel[0]), -rel[1]))
        h = np.interp(az, table[:, 0], table[:, 1]) / 1000.0
        return p[2] > h

    # the shipped body is decimated (large head triangles), so faces straddling the
    # hairline are cut finer (flat subdivision keeps them on the body surface) first.
    # glTF import splits vertices along UV seams; weld them so mesh islands are
    # geometric (only the part cut separates islands).
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=WELD_M)
    bm.verts.index_update()
    keep_v = {v.index: is_scalp_v(v.co) for v in bm.verts}
    near = [f for f in bm.faces if any(keep_v[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in set(near)], context="FACES")
    edges = list({e for f in bm.faces for e in f.edges})
    bmesh.ops.subdivide_edges(bm, edges=edges, cuts=SCALP_CUTS, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.verts.index_update()
    bm.normal_update()
    keep_v = {v.index: is_scalp_v(v.co) for v in bm.verts}
    upz = Vector(R[2])
    kill = [f for f in bm.faces
            if not all(keep_v[v.index] for v in f.verts) or f.normal.dot(upz) < min_up]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    half = rc["part"]["partWidthMm"] / 2000.0
    right = Vector(R[0])
    for s in (+1.0, -1.0):
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=origin + right * (s * half), plane_no=right)
    gap = [f for f in bm.faces
           if abs(to_local(f.calc_center_median(), origin, R)[0]) < half]
    bmesh.ops.delete(bm, geom=gap, context="FACES")
    # islands; fragments left by the hairline cut on the decimated body are dropped
    bm.faces.ensure_lookup_table()
    seen, islands = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        comp, stack = [], [f]
        while stack:
            g = stack.pop()
            if g.index in seen:
                continue
            seen.add(g.index)
            comp.append(g)
            for e in g.edges:
                stack.extend(x for x in e.link_faces if x.index not in seen)
        islands.append(comp)
    total = sum(f.calc_area() for f in bm.faces)
    small = [c for c in islands if sum(f.calc_area() for f in c) < MIN_ISLAND_FRACTION * total]
    dropped = len(small)
    for c in islands:
        ca = sum(f.calc_area() for f in c)
        cc = sum((f.calc_center_median() for f in c), Vector()) / len(c)
        print("SCALP_ISLAND faces=%d areaMm2=%.0f centre=%s" % (len(c), ca * 1e6, tuple(round(x, 3) for x in cc)))
    bmesh.ops.delete(bm, geom=[f for c in small for f in c], context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    area = sum(f.calc_area() for f in bm.faces)
    # spherical UV about the head centre: injective on a star-shaped scalp, and its
    # only seam (azimuth +-pi) lies on the part cut, so neither island has a seam. It
    # replaces the body's UVMap, whose seams/overlaps made Interpolate drop children.
    for name in [k for k in bm.loops.layers.uv.keys()]:
        bm.loops.layers.uv.remove(bm.loops.layers.uv[name])
    uvl = bm.loops.layers.uv.new(SCALP_UV)
    cw = origin + Matrix(R).transposed() @ Vector(centre)
    for f in bm.faces:
        for lo in f.loops:
            q = to_local(lo.vert.co, cw, R)
            az = math.atan2(q[0], -q[1])
            el = math.atan2(q[2], math.hypot(q[0], q[1]))
            lo[uvl].uv = (0.5 + az / (2 * math.pi), 0.5 + el / math.pi)
    me = bpy.data.meshes.new("groom_scalp")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("groom_scalp", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.hide_render = True
    return ob, len(islands) - dropped, area, dropped


def side_scalp(scalp, origin, R, side):
    """Copy of the scalp holding one island (side = +1 subject left, -1 right).
    Interpolate runs once per side so children can only blend guides of their own
    side; its 'Part by Mesh Islands' option still mixed sides at the front hairline."""
    bm = bmesh.new()
    bm.from_mesh(scalp.data)
    kill = [f for f in bm.faces if to_local(f.calc_center_median(), origin, R)[0] * side < 0]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    name = "groom_scalp_%s" % ("L" if side > 0 else "R")
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.hide_render = True
    return ob


def sample_roots(scalp, n, seed):
    me = scalp.data
    me.calc_loop_triangles()
    uv = me.uv_layers[SCALP_UV].data
    tri_v = np.array([[me.vertices[i].co[:] for i in t.vertices] for t in me.loop_triangles])
    tri_uv = np.array([[uv[l].uv[:] for l in t.loops] for t in me.loop_triangles])
    tri_n = np.array([t.normal[:] for t in me.loop_triangles])
    a = 0.5 * np.linalg.norm(np.cross(tri_v[:, 1] - tri_v[:, 0], tri_v[:, 2] - tri_v[:, 0]), axis=1)
    rng = np.random.default_rng(seed)
    m = n * CANDIDATE_FACTOR
    ti = rng.choice(len(a), size=m, p=a / a.sum())
    r1, r2 = rng.random(m), rng.random(m)
    s = np.sqrt(r1)
    bary = np.stack([1 - s, s * (1 - r2), s * r2], 1)
    P = np.einsum("mk,mkd->md", bary, tri_v[ti])
    UV = np.einsum("mk,mkd->md", bary, tri_uv[ti])
    radius = POISSON_RADIUS_FACTOR * math.sqrt(a.sum() / n)
    cell = radius
    grid, acc = {}, []
    for i in range(m):
        key = tuple(np.floor(P[i] / cell).astype(int))
        ok = True
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for j in grid.get((key[0] + dx, key[1] + dy, key[2] + dz), ()):
                        if np.sum((P[j] - P[i]) ** 2) < radius * radius:
                            ok = False
                            break
                    if not ok:
                        break
                if not ok:
                    break
        if ok:
            grid.setdefault(key, []).append(i)
            acc.append(i)
            if len(acc) == n:
                break
    acc = np.array(acc)
    return P[acc], UV[acc], tri_n[ti[acc]], radius


# ---------------------------------------------------------------- guides
class Collider:
    def __init__(self, objs=(), open_cloth=False, bms=()):
        verts, polys = [], []
        owned = [world_bmesh(o) for o in objs]
        for bm in list(owned) + list(bms):
            off = len(verts)
            verts.extend(v.co.copy() for v in bm.verts)
            polys.extend([v.index + off for v in f.verts] for f in bm.faces)
        for bm in owned:
            bm.free()
        self.tree = BVHTree.FromPolygons(verts, polys)
        self.open_cloth = open_cloth

    def signed(self, p):
        loc, nrm, _, d = self.tree.find_nearest(p)
        if loc is None:
            return 1e9, None, None
        s = (p - loc).dot(nrm)
        return (d if s >= 0 else -d), loc, nrm


def push_out(p, colliders, offset):
    """Move p to >= offset outside each collider in turn (body first, then garments).
    Garments are open cloth: the nearest-face sign is only trusted within
    GARMENT_PUSH_RADIUS_M, otherwise a scalp point 'behind' the collar normal would be
    thrown onto the collar."""
    for k, c in enumerate(colliders):
        s, loc, nrm = c.signed(p)
        if loc is None or s >= offset:
            continue
        if c.open_cloth and abs(s) > GARMENT_PUSH_RADIUS_M:
            continue
        p = loc + nrm * offset
    return p


class ConvexShell:
    """Solid convex hull as half-spaces. signed(p) = max over face planes of the
    plane distance: exact depth inside, a lower bound of the distance outside, so
    the sign never depends on which face BVH nearest-search picks (a thin hull's
    edges flipped it for points across the head)."""
    open_cloth = False

    def __init__(self, hb):
        c = sum((v.co for v in hb.verts), Vector()) / len(hb.verts)
        n, d = [], []
        for f in hb.faces:
            nn = f.normal.copy()
            if nn.length < 1e-9:
                continue
            q = f.calc_center_median()
            if nn.dot(q - c) < 0:
                nn = -nn
            n.append(nn[:])
            d.append(nn.dot(q))
        self.n, self.d = np.array(n), np.array(d)

    def signed(self, p):
        v = self.n @ np.array(p[:]) - self.d
        i = int(np.argmax(v))
        nrm = Vector(self.n[i])
        return float(v[i]), Vector(p) - nrm * float(v[i]), nrm


def ear_shells(body, origin, R, rc):
    """Closed convex hull of the body vertices in a head-local box around each ear
    (recipe earShell: |x| >= minAbsXMm, y and z ranges in mm from the head-bone origin).
    Strands collide with it as a solid, so they drape over the helix and the ear-head
    groove as one smooth surface instead of following the ear relief."""
    es = rc.get("earShell")
    if not es:
        return [], []
    bm = world_bmesh(body)
    loc = [(v.co.copy(), to_local(v.co, origin, R)) for v in bm.verts]
    bm.free()
    x0 = es["minAbsXMm"] / 1000.0
    (y0, y1), (z0, z1) = [np.array(es[k]) / 1000.0 for k in ("yRangeMm", "zRangeMm")]
    shells, info = [], []
    for side in (1.0, -1.0):
        pts = [co for co, q in loc if q[0] * side >= x0 and y0 <= q[1] <= y1 and z0 <= q[2] <= z1]
        hb = bmesh.new()
        for co in pts:
            hb.verts.new(co)
        res = bmesh.ops.convex_hull(hb, input=hb.verts[:])
        bmesh.ops.delete(hb, geom=[v for v in res["geom_interior"] if isinstance(v, bmesh.types.BMVert)], context="VERTS")
        bmesh.ops.delete(hb, geom=[v for v in hb.verts if not v.link_faces], context="VERTS")
        hb.normal_update()
        shells.append(ConvexShell(hb))
        info.append({"side": "L" if side > 0 else "R", "verts": len(pts), "faces": len(hb.faces)})
        hb.free()
    return shells, info


def settle_on_body(p, body, offset):
    """Final pass: body is the G2 surface, so it goes last. Thin double-sided spots
    (ear, shoulder seam) can flip the nearest-face sign after one projection; then
    march outward along the first projection normal in ESCAPE_STEP_M steps."""
    s, loc, nrm = body.signed(p)
    if s >= offset or loc is None:
        return p
    p = loc + nrm * offset
    n0 = nrm
    for _ in range(ESCAPE_STEPS):
        s, loc, nrm = body.signed(p)
        if s >= 0.0:
            break
        p = p + n0 * ESCAPE_STEP_M
    return p


def region_length(local_rel, rc):
    L = rc["lengthMm"]
    az = math.degrees(math.atan2(abs(local_rel[0]), -local_rel[1]))
    el = math.degrees(math.atan2(local_rel[2], math.hypot(local_rel[0], local_rel[1])))
    ring = np.interp(az, [0, 50, 110, 180], [L["front"], L["temples"], L["temples"], L["nape"]])
    w_crown = float(np.clip((el - 35.0) / 30.0, 0.0, 1.0))  # 35..65 deg elevation blends to crown
    return ((1 - w_crown) * ring + w_crown * L["crown"]) / 1000.0, az


def march_guide(root, normal, origin, R, centre, collider, rc):
    f = rc["fall"]
    ds = rc["guides"]["marchStepMm"] / 1000.0
    right, back, up = Vector(R[0]), Vector(R[1]), Vector(R[2])
    down = -up
    p = Vector(root)
    pl = to_local(p, origin, R)
    rel = pl - centre
    L, az = region_length(rel, rc)
    side = 1.0 if pl[0] >= 0 else -1.0
    away = right * side
    w_part = float(np.clip(1.0 - max(0.0, rel[1]) / (rc["part"]["partFadeBackMm"] / 1000.0), 0.0, 1.0))
    anterior = az < 60.0
    frontish = az < f["frontAzimuthMaxDeg"]
    rail = f["combRailMm"] / 1000.0
    g = f["gravityPerM"]
    vol = f["volumeMm"] / 1000.0
    sh_z = f["shoulderFieldBelowHeadOriginMm"] / 1000.0
    back_target = f["combRailBackTargetMm"] / 1000.0
    hug = f.get("scalpHugGain", 0.0)
    tuck = rc.get("earTuck")
    # behind the part (root more than partFadeBackMm behind the head centre) the two
    # sides are drawn toward the midline so the back is one curtain, not a split
    conv = rc["part"].get("backConvergeGain", 0.0)
    conv_w = rc["part"].get("backConvergeWidthMm", 40.0) / 1000.0
    back_root = rel[1] > rc["part"]["partFadeBackMm"] / 1000.0
    table = np.array(rc["scalp"]["hairlineMmAboveHeadOriginByAzimuthDeg"], dtype=float)
    p = p + Vector(normal) * (f["rootLiftMm"] / 1000.0)
    d = (Vector(normal) * ROOT_NORMAL_WEIGHT + away * rc["part"]["partAwayGain"] * w_part
         + down * ROOT_DOWN_WEIGHT).normalized()
    pts = [Vector(root), p.copy()]
    arc = (p - Vector(root)).length
    while arc < L:
        lp = to_local(p, origin, R)
        steer = Vector((0, 0, 0))
        g_scale = 1.0
        if anterior and lp[2] > sh_z and abs(lp[0]) < rail:
            lack = (rail - abs(lp[0])) / rail
            steer += away * (f["combRailGain"] * g * lack)
            g_scale = (abs(lp[0]) / rail) ** 2
        steer += down * (g * g_scale)
        # the comb rail suppresses gravity near the part, so a strand would leave the
        # curved scalp on a straight tangent; over the scalp (above the hairline table)
        # it is drawn back toward the body to the volume offset (scalpHugGain)
        if hug > 0.0 and anterior and abs(lp[0]) < rail:
            r2 = lp - centre
            haz = math.degrees(math.atan2(abs(r2[0]), -r2[1]))
            if lp[2] > np.interp(haz, table[:, 0], table[:, 1]) / 1000.0:
                sb, _, nb = collider[0].signed(p)
                if nb is not None and sb > vol:
                    steer += -nb * (hug * g * min(1.0, (sb - vol) / vol))
        # anterior hair that has cleared the face laterally is drawn back to the cheek
        # plane (combRailBackTargetMm, head-centre y) so it hangs beside, not ahead of, the face
        y_rel = lp[1] - centre[1]
        if anterior and abs(lp[0]) >= RAIL_CLEARED * rail and y_rel < back_target:
            steer += back * (f["combRailBackGain"] * g * min(1.0, (back_target - y_rel) / RAIL_BACK_RAMP_M))
        # ear tuck: a strand reaching the ear band (head-local z) ahead of the ear's back
        # edge (behindYMm) is steered back, ramping in over rampMm above the ear top, so
        # it passes behind the ear and leaves the ear visible
        if tuck and abs(lp[0]) > tuck["minAbsXMm"] / 1000.0 and lp[1] < tuck["behindYMm"] / 1000.0:
            top, bot = tuck["topZMm"] / 1000.0, tuck["bottomZMm"] / 1000.0
            ramp = tuck["rampMm"] / 1000.0
            if bot < lp[2] < top + ramp:
                w = min(1.0, (top + ramp - lp[2]) / ramp)
                steer += back * (tuck["gain"] * g * w)
        if conv > 0.0 and back_root and abs(lp[0]) < conv_w:
            steer += -away * (conv * g * (1.0 - abs(lp[0]) / conv_w))
        if lp[2] < sh_z:
            steer += (-back if frontish else back * BACK_FIELD_RATIO) * (f["shoulderForwardGain"] * g)
        d = (d + steer * ds).normalized()
        q = p + d * ds
        q = push_out(q, collider, vol)
        step = q - p
        if step.length > 1e-9:
            d = step.normalized()
        arc += step.length
        p = q
        pts.append(p.copy())
        if len(pts) > 2000:
            break
    return np.array([v[:] for v in pts]), L


def relax_guide(path, collider, offset, iterations):
    """Taut-strand relaxation: Laplacian smoothing (root fixed) alternating with the
    signed-distance push, so a strand spans concavities (under the ear lobe, jaw)
    instead of wrapping into them."""
    pts = path.copy()
    for _ in range(iterations):
        pts[1:-1] = 0.5 * pts[1:-1] + 0.25 * (pts[:-2] + pts[2:])
        for i in range(1, len(pts)):
            pts[i] = push_out(Vector(pts[i]), collider, offset)[:]
    return pts


def resample(path, P):
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    t = np.linspace(0.0, s[-1], P)
    return np.stack([np.interp(t, s, path[:, k]) for k in range(3)], 1)


# ---------------------------------------------------------------- node groups
def load_assets():
    with bpy.data.libraries.load(str(ASSETS), link=False) as (src, dst):
        dst.node_groups = list(src.node_groups)


def groom_tree(rc, seed, stop_after=None):
    ng = bpy.data.node_groups.new("groom_children", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    N, L = ng.nodes, ng.links
    gi, go = N.new("NodeGroupInput"), N.new("NodeGroupOutput")

    def grp(name, values):
        n = N.new("GeometryNodeGroup")
        n.node_tree = bpy.data.node_groups[name]
        for k, v in values.items():
            n.inputs[k].default_value = v
        return n

    ch, cl, fr, tr = rc["children"], rc["clump"], rc["frizz"], rc["trim"]
    chain = [
        grp("Interpolate Hair Curves", {
            "Resting Surface": False, "Follow Surface Normal": False, "Part by Mesh Islands": PART_BY_ISLANDS,
            "Interpolation Guides": ch["interpolationGuides"], "Distribution Method": "Random",
            "Density": float(ch["densityPerM2"]), "Viewport Amount": 1.0, "Seed": seed}),
        grp("Clump Hair Curves", {
            "Factor": cl["factor"], "Shape": cl["shape"], "Tip Spread": cl["tipSpreadMm"] / 1000.0,
            "Distance Threshold": cl["distanceThresholdMm"] / 1000.0, "Seed": seed + 1,
            "Preserve Length": True, "Existing Guide Map": False,
            "Guide Distance": cl["guideDistanceMm"] / 1000.0}),
        grp("Frizz Hair Curves", {
            "Factor": fr["factor"], "Distance": fr["distanceMm"] / 1000.0, "Shape": fr["shape"],
            "Seed": seed + 2, "Preserve Length": True}),
        grp("Trim Hair Curves", {
            "Replace Length": False, "Length Factor": 1.0, "Random Offset": tr["randomOffset"],
            "Seed": seed + 3}),
    ]
    if rc["curl"]["factor"] > 0:
        raise RuntimeError("curl > 0 not wired in r1 (recipe is straight)")
    if stop_after:
        chain = chain[:STAGES.index(stop_after) + 1]
    prev = gi.outputs[0]
    for n in chain:
        L.new(prev, n.inputs["Geometry"])
        prev = n.outputs["Geometry"]
    L.new(prev, go.inputs[0])
    return ng


def make_curves(name, sizes, pos, uv=None, radius=None):
    hc = bpy.data.hair_curves.new(name)
    hc.add_curves([int(s) for s in sizes])
    hc.position_data.foreach_set("vector", pos.astype(np.float32).ravel())
    if uv is not None:
        a = hc.attributes.new("surface_uv_coordinate", "FLOAT2", "CURVE")
        a.data.foreach_set("vector", uv.astype(np.float32).ravel())
    if radius is not None:
        a = hc.attributes["radius"] if "radius" in hc.attributes else hc.attributes.new("radius", "FLOAT", "POINT")
        a.data.foreach_set("value", radius.astype(np.float32))
    ob = bpy.data.objects.new(name, hc)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def read_curves(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    c = ob.evaluated_get(dg).data
    pos = np.empty(len(c.points) * 3, dtype=np.float32)
    c.position_data.foreach_get("vector", pos)
    off = np.empty(len(c.curves) + 1, dtype=np.int32)
    c.curve_offset_data.foreach_get("value", off)
    return pos.reshape(-1, 3), off


# ---------------------------------------------------------------- shading / render
def hair_material(rc):
    sh = rc["shading"]
    m = bpy.data.materials.new("groom_hair")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    h = nt.nodes.new("ShaderNodeBsdfHairPrincipled")
    h.model = sh["model"]
    h.parametrization = "MELANIN"
    h.inputs["Melanin"].default_value = sh["melanin"]
    h.inputs["Melanin Redness"].default_value = sh["melaninRedness"]
    h.inputs["Roughness"].default_value = sh["roughness"]
    if "Radial Roughness" in h.inputs:
        h.inputs["Radial Roughness"].default_value = sh["radialRoughness"]
    if "Coat" in h.inputs:  # CHIANG only; HUANG has no coat input
        h.inputs["Coat"].default_value = sh["coat"]
    h.inputs["Random Color"].default_value = sh["randomColor"]
    h.inputs["Random Roughness"].default_value = sh["randomRoughness"]
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(h.outputs[0], o.inputs["Surface"])
    return m, h.model


def setup_render(samples):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    sc.cycles.device = "GPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.seed = 0
    sc.render.resolution_x = sc.render.resolution_y = RES
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    sc.cycles_curves.shape = "THICK"
    w = bpy.data.worlds.new("grey")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.42, 0.42, 0.42, 1.0)   # neutral grey studio sweep
    bg.inputs["Strength"].default_value = 0.6
    sc.world = w
    return [d.name for d in prefs.devices if d.use]


def add_light(name, loc, target, power, size):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = power
    ld.size = size
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(ob)


def camera_rig(origin, R, centre, ztop, eye_z, lights=None):
    tgt_xy = origin + Vector(R[1]) * centre[1]
    zc = eye_z - (0.5 - EYE_FROM_TOP) * FRAME_HEIGHT_M
    dist = (FRAME_HEIGHT_M / 2.0) / math.tan(math.atan(SENSOR_MM / 2.0 / FOCAL_MM))
    tgt = Vector((tgt_xy.x, tgt_xy.y, zc))
    cd = bpy.data.cameras.new("cam")
    cd.lens = FOCAL_MM
    cd.sensor_width = SENSOR_MM
    cd.sensor_height = SENSOR_MM
    cd.sensor_fit = "VERTICAL"
    cam = bpy.data.objects.new("cam", cd)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    # watts from recipe "lighting" (defaults = groom-r1 rig); the studio level is set
    # so skin, not hair, is not over-exposed against the neutral world
    lw = {"keyW": 220.0, "fillW": 90.0, "rimW": 160.0}
    lw.update(lights or {})
    key = tgt + Vector((-0.9, -1.4, 0.8))
    add_light("key", key, tgt, lw["keyW"], 1.0)
    add_light("fill", tgt + Vector((1.2, -1.2, 0.2)), tgt, lw["fillW"], 1.5)
    add_light("rim", tgt + Vector((0.4, 1.3, 0.9)), tgt, lw["rimW"], 0.8)

    def place(az_deg):
        a = math.radians(az_deg)
        off = Vector((math.sin(a), -math.cos(a), 0.0)) * dist
        cam.location = tgt + off
        cam.rotation_euler = (-off).to_track_quat("-Z", "Y").to_euler()
    return place, {"distM": dist, "targetZ": zc, "focalMm": FOCAL_MM, "frameHeightM": FRAME_HEIGHT_M}


# ---------------------------------------------------------------- main
def main():
    a = cli()
    t0 = time.time()
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rc = json.loads(Path(a.recipe).read_text())
    seed = int(rc["seed"]) + a.seed_offset
    body, garments, rig, hidden = load_body(Path(a.body))
    bbm = world_bmesh(body)
    origin, R, centre, ztop_local = head_frame(rig, bbm)
    bbm.free()
    scalp, islands, area, dropped = build_scalp(body, origin, R, centre, rc)
    if islands != 2:
        raise RuntimeError("scalp islands = %d, centre part needs 2" % islands)
    roots, uvs, nrms, prad = sample_roots(scalp, rc["guides"]["count"], seed)
    body_only = Collider([body])
    shells, shell_info = ear_shells(body, origin, R, rc)
    collider = [body_only] + shells + ([Collider(garments, open_cloth=True)] if garments else [])
    collider_roots = [body_only] + ([Collider(garments, open_cloth=True)] if garments else [])
    P = rc["guides"]["pointsPerStrand"]
    guides, lens = [], []
    for r, n in zip(roots, nrms):
        path, L = march_guide(r, n, origin, R, centre, collider, rc)
        guides.append(relax_guide(resample(path, P), collider, rc["fall"]["volumeMm"] / 1000.0,
                                  rc["fall"]["relaxIterations"]))
        lens.append(L)
    guides = np.array(guides)
    load_assets()
    gside = np.array([1 if to_local(r, origin, R)[0] >= 0 else -1 for r in roots])
    parts, gobs = [], []
    for side in (1, -1):
        m = gside == side
        sob = side_scalp(scalp, origin, R, side)
        gob = make_curves("groom_guides_%d" % side, [P] * int(m.sum()), guides[m].reshape(-1, 3), uv=uvs[m])
        gob.data.surface = sob
        gob.data.surface_uv_map = SCALP_UV
        mod = gob.modifiers.new("children", "NODES")
        # one seed per side so the two child distributions are independent
        mod.node_group = groom_tree(rc, seed + (0 if side > 0 else SIDE_SEED_STRIDE), a.stop_after)
        parts.append(read_curves(gob))
        gobs.append(gob)
    pos = np.concatenate([p for p, _ in parts])
    off = np.concatenate([[0], np.cumsum(np.concatenate([np.diff(o) for _, o in parts]))]).astype(np.int64)
    raw_pos = pos.copy()
    sizes = np.diff(off)
    # final signed-distance push (fixed offset), all points
    clr = rc["clearanceMm"] / 1000.0
    pushed = 0
    is_root = np.zeros(len(pos), bool)
    is_root[off[:-1]] = True   # roots sit on the scalp; the ear shell must not lift them
    for _ in range(PUSH_PASSES):
        moved = 0
        for i in range(len(pos)):
            p = Vector(pos[i])
            q = push_out(p, collider_roots if is_root[i] else collider, clr)
            if (q - p).length > 0.0:
                pos[i] = q
                moved += 1
        pushed += moved
        if moved == 0:
            break
    for i in range(len(pos)):
        p = Vector(pos[i])
        q = settle_on_body(p, body_only, clr)
        if (q - p).length > 0.0:
            pos[i] = q
            pushed += 1
    for gob in gobs:
        gob.hide_render = True
        gob.hide_viewport = True
    # strand radius taper root -> tip
    rr, tr = rc["strand"]["rootRadiusMm"] / 1000.0, rc["strand"]["tipRadiusMm"] / 1000.0
    rad = np.concatenate([np.linspace(rr, tr, s) for s in sizes])
    hob = make_curves("groom_hair", sizes, pos, radius=rad)
    mat, model = hair_material(rc)
    hob.data.materials.append(mat)
    if a.debug_hide_hair:
        hob.hide_render = True
    pos_hash = hashlib.sha256(np.ascontiguousarray(pos, dtype=np.float32).tobytes()).hexdigest()
    # G2: signed distance to body only and to body+garments
    dmin_body, dmin_all = 1e9, 1e9
    neg = 0
    sd_body = np.empty(len(pos))
    for i in range(len(pos)):
        p = Vector(pos[i])
        sb, _, _ = body_only.signed(p)
        sa = min(c.signed(p)[0] for c in collider_roots)
        sd_body[i] = sb
        dmin_body = min(dmin_body, sb)
        dmin_all = min(dmin_all, sa)
        neg += sb < 0
    loc_pos = (np.array(R) @ (pos - np.array(origin)).T).T
    np.savez_compressed(str(out / "strands.npz"), positions=pos, offsets=off, signedBodyM=sd_body,
                        localPositions=loc_pos, guides=guides, rawPositions=raw_pos, guideRoots=roots,
                        scalpVerts=np.array([v.co[:] for v in scalp.data.vertices]),
                        scalpFaceCentres=np.array([f.center[:] for f in scalp.data.polygons]),
                        scalpFaceAreas=np.array([f.area for f in scalp.data.polygons]),
                        scalpFaceNormals=np.array([f.normal[:] for f in scalp.data.polygons]))
    groom_s = time.time() - t0
    eye_z = None
    for o in bpy.data.objects:
        if o.type == "MESH" and "eyebrow" in o.name:
            bm = world_bmesh(o)
            zs = [v.co.z for v in bm.verts]
            eye_z = 0.5 * (min(zs) + max(zs)) - 0.022   # eye centre ~22 mm below brow centre
            bm.free()
    stats = {
        "recipe": Path(a.recipe).name, "recipeSha256": sha256_file(a.recipe),
        "body": str(a.body), "bodySha256": sha256_file(a.body), "seed": seed,
        "hiddenObjects": hidden, "garmentsVisibleAndColliding": [g.name for g in garments],
        "scalp": {"islands": islands, "fragmentsDropped": dropped, "areaM2": area, "faces": len(scalp.data.polygons),
                  "rule": "body faces whose every vertex sits above the head-local hairline table "
                          "(mm above head-bone origin, interpolated by azimuth around the head centre, "
                          "0=front 180=back) and whose normal has head-up component >= minUpwardNormal; "
                          "cut by two bisect planes at +-partWidthMm/2 from the mid-sagittal plane"},
        "headFrame": {"origin": list(origin), "centreLocal": centre.tolist()},
        "guides": {"count": int(len(guides)), "pointsPerStrand": P, "poissonRadiusMm": prad * 1000,
                   "lengthMmMin": min(lens) * 1000, "lengthMmMax": max(lens) * 1000},
        "strands": {"count": int(len(sizes)), "pointsPerStrandMin": int(sizes.min()),
                    "pointsPerStrandMax": int(sizes.max()), "pointsTotal": int(len(pos))},
        "positionsSha256": pos_hash,
        "clearance": {"pushedPoints": int(pushed), "minSignedMmBody": dmin_body * 1000,
                      "minSignedMmBodyGarments": dmin_all * 1000, "negativePointsBody": int(neg)},
        "earShell": {"recipe": rc.get("earShell"), "hulls": shell_info},
        "groomSeconds": groom_s,
    }
    views = [v for v in a.views.split(",") if v]
    if views:
        devs = setup_render(a.samples)
        place, cam = camera_rig(origin, R, centre, ztop_local, eye_z, rc.get("lighting"))
        stats["render"] = {"engine": "CYCLES", "devices": devs, "samples": a.samples, "denoise": True,
                           "hairModel": model, "lighting": rc.get("lighting"), "curveShape": "THICK", "resolution": RES, "camera": cam,
                           "views": {}}
        for v in views:
            place(VIEW_AZIMUTH_DEG[v])
            bpy.context.scene.render.filepath = str(out / (v + ".png"))
            t1 = time.time()
            bpy.ops.render.render(write_still=True)
            stats["render"]["views"][v] = {"seconds": time.time() - t1, "png": str(out / (v + ".png"))}
            print("VIEW_DONE", v, round(time.time() - t1, 1), flush=True)
    (out / "stats.json").write_text(json.dumps(stats, indent=2, sort_keys=True))
    print("GROOM_DONE", json.dumps({k: stats[k] for k in ("strands", "positionsSha256", "clearance", "guides")}), flush=True)


main()
