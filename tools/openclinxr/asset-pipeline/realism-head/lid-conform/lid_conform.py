"""Lid-conform Blender pass: seat the inner lid ring on the globe mesh.

Deterministic post-import body-vertex pass. For each eye, the lid-margin
ring (ring1) is located on the in-Blender body as follows:

1. The ring is DERIVED TOPOLOGICALLY (lid_conform_core.derive_eye_rings,
   the lidcurve_measure.py definition: eye-opening boundary loop nearest
   each globe centre + BFS outward rings; no hard-coded vertex indices)
   on the BASE bake GLB (BASE_GLB_PATH, staged copy of the eyeglobe base
   bake whose body is bit-identical to this bake's pre-conform body --
   measured micron-coincident at the margin, reported per bake below).
   The in-Blender post-subdiv body is watertight (measured: 0 boundary
   edges at both polygon and tessellation level), so the boundary walk
   cannot run here; the base GLB carries the identical surface WITH the
   export-time openings.
2. Each base-ring vertex is matched to its NEAREST in-Blender body vertex
   (world space; measured match ~0.002 mm at ~1 mm edge spacing, so the
   match is unambiguous). Refuses loudly on any match above
   MATCH_REFUSE_MM or on duplicate matches.
3. Each matched vertex is moved toward the globe MESH surface plus a
   0.5 mm tear-film offset along the ray from the fitted globe centre
   through the vertex (nearest BVH intersection, so the corneal bulge of
   the high-poly eye is honoured). Weight is 1 at ring1 falling to 0 at
   ring2 (LID_CONFORM weights [1.0, 0.0]); ring2/ring3 derive by BFS on
   the Blender adjacency and are recorded (ring2 is the zero anchor).

Shape-key consistency: the same local displacement is added to the Basis
AND to every other shape-key block, so each key's delta (basis -> key)
is unchanged and blink (eye-*-closure / eye-*-slit) still closes.

Called from tools/openclinxr/evidence/blender/
materialize_mpfb_humanoid_candidate.py at the call site only, after the
subdiv bake (both the helper strip and the subdiv rebuild Basis data, so
an earlier Basis edit does not reach the export -- measured zero-vert
diff). No-op for every output stem not listed in
LID_CONFORM_BY_OUTPUT_STEM.
"""

import json
import sys
from pathlib import Path

import numpy as np

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
import lid_conform_core as core  # noqa: E402

# Staged copy of the eyeglobe base bake (bit-identical body to this bake's
# pre-conform body; sha256 pinned in conform-report.json).
BASE_GLB_PATH = ("/Volumes/files/openclinxr-assets/store/lid-conform/"
                 "aisha-eyeglobe-base.glb")

# Per-output-stem lid-conform config. Absent stem = no-op (byte-stable).
# weights: [ring1, ring2] multipliers on the surface-seating displacement.
LID_CONFORM_BY_OUTPUT_STEM = {
    "aisha-lidconform": {"offsetMm": 0.5, "weights": [1.0, 0.0]},
}

TEAR_OFFSET_DEFAULT_MM = 0.5
MATCH_REFUSE_MM = 0.5


def _fit_eye_sphere(pts):
    m = pts.mean(axis=0)
    d = pts - m
    dd = (d ** 2).sum(axis=1)
    a = 2.0 * (d[:, :, None] * d[:, None, :]).sum(axis=0)
    b = (d * dd[:, None]).sum(axis=0)
    c_rel = np.linalg.solve(a, b)
    c = c_rel + m
    r = float(np.mean(np.linalg.norm(pts - c, axis=1)))
    return c, r


def _members(obj, group_name):
    g = obj.vertex_groups.get(group_name)
    if g is None:
        return []
    gi = g.index
    return [i for i, v in enumerate(obj.data.vertices)
            if any(ge.group == gi and ge.weight > 0.0 for ge in v.groups)]


def _gltf_to_blender(pts):
    """glTF world (x right, y up, face +z) -> Blender world (x right, z up).

    Matches the axis mapping the bake's own export produces (verified per
    bake by the micron-scale match diagnostics below, fail-closed).
    """
    p = np.asarray(pts, dtype=float)
    return np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1)


def conform_lids(human, eyes_asset, offset_mm=TEAR_OFFSET_DEFAULT_MM,
                 weights=(1.0, 0.0)):
    """Seat the lid rings on the globe mesh. Returns the LIDCONFORM record."""
    import bpy  # noqa: E402
    from mathutils import Vector  # noqa: E402
    from mathutils.bvhtree import BVHTree  # noqa: E402

    me = human.data
    mw = human.matrix_world
    mw_inv3 = mw.inverted().to_3x3()
    n_verts = len(me.vertices)
    body_world = np.array([tuple(mw @ v.co) for v in me.vertices],
                          dtype=float)
    me.update()
    me.calc_loop_triangles()

    from collections import Counter as _Counter
    _ec = _Counter()
    for _lt in me.loop_triangles:
        _vs = tuple(_lt.vertices)
        for _a, _b in ((_vs[0], _vs[1]), (_vs[1], _vs[2]), (_vs[2], _vs[0])):
            _ec[(min(_a, _b), max(_a, _b))] += 1
    _n_bnd = sum(1 for _v in _ec.values() if _v == 1)
    print(f"LIDCONFORM_DIAG verts={n_verts} polys={len(me.polygons)} "
          f"loopTris={len(me.loop_triangles)} boundaryEdges={_n_bnd} "
          f"hasKeys={bool(me.shape_keys)}")

    # Eye sides in world space (same split as resize_eyes_to_anatomy).
    eye_world_all = np.array(
        [tuple(eyes_asset.matrix_world @ v.co)
         for v in eyes_asset.data.vertices], dtype=float)
    groups = {g.name for g in eyes_asset.vertex_groups}
    if "eye.L" in groups and "eye.R" in groups:
        sides = {"L": np.array(_members(eyes_asset, "eye.L")),
                 "R": np.array(_members(eyes_asset, "eye.R"))}
    else:
        left = [i for i in range(len(eye_world_all))
                if eye_world_all[i, 0] < 0.0]
        right = [i for i in range(len(eye_world_all))
                 if eye_world_all[i, 0] >= 0.0]
        if not left or not right:
            raise RuntimeError("LIDCONFORM: eye mesh has no L/R split")
        sides = {"L": np.array(left), "R": np.array(right)}
    centres = {}
    for side, idx in sides.items():
        c, _r = _fit_eye_sphere(eye_world_all[idx])
        centres[side] = c

    # Globe BVH in world space (triangulated; honours the corneal bulge).
    em = eyes_asset.data
    em.calc_loop_triangles()
    eye_tris = [tuple(lt.vertices) for lt in em.loop_triangles]
    tree = BVHTree.FromPolygons(
        [tuple(eyes_asset.matrix_world @ v.co)
         for v in em.vertices], eye_tris)

    # Ring source: topological derivation on the base GLB (identical body
    # surface WITH the export-time openings), matched spatially here.
    bjs, bblob = core.load_glb(BASE_GLB_PATH)
    bworlds = core.node_worlds(bjs)
    bbody, bbody_idx = core.skin_mesh(bjs, bblob, bworlds, core.BODY_NAME)
    btris = bbody_idx.reshape(-1, 3)
    bsides = core.eye_sides(bjs, bblob, bworlds)

    # Blender polygon adjacency for the BFS outer rings.
    adj = {}
    for _p in me.polygons:
        _vs = [int(_v) for _v in _p.vertices]
        for _k in range(len(_vs)):
            adj.setdefault(_vs[_k], set()).add(_vs[(_k + 1) % len(_vs)])
            adj.setdefault(_vs[(_k + 1) % len(_vs)], set()).add(_vs[_k])

    disp_world = np.zeros((n_verts, 3), dtype=float)
    per_side = {}
    for side, gc in centres.items():
        bpts = bsides[side]
        bc, _, _ = core.fit_sphere_kasa(bpts)
        brings = core.derive_eye_rings(bbody, btris, bc)
        bring1 = _gltf_to_blender(bbody[brings["ring1"]])
        # Nearest in-Blender vertex per base-ring vertex.
        d2 = ((body_world[:, None, :] - bring1[None, :, :]) ** 2).sum(axis=2)
        best = d2.argmin(axis=0)
        best_d = np.sqrt(d2[best, np.arange(len(bring1))]) * 1000.0
        if (len(set(int(v) for v in best)) != len(best)):
            raise RuntimeError(
                f"LIDCONFORM: duplicate Blender matches on side {side} "
                f"-- refusing")
        if float(best_d.max()) > MATCH_REFUSE_MM:
            raise RuntimeError(
                f"LIDCONFORM: ring transfer match max "
                f"{float(best_d.max()):.3f}mm exceeds refuse "
                f"{MATCH_REFUSE_MM}mm on side {side} -- refusing")
        ring1 = np.array([int(v) for v in best])
        # BFS outward rings on the Blender adjacency (record/anchor only).
        seen = set(int(v) for v in ring1)
        outer = []
        frontier = set(seen)
        for _ in range(2):
            nxt = set()
            for v in frontier:
                for w in adj.get(v, ()):
                    if w not in seen:
                        seen.add(w)
                        nxt.add(w)
            outer.append(np.array(sorted(nxt)))
            frontier = nxt
        ring2, ring3 = outer[0], outer[1]
        weighted = [(ring1, weights[0]), (ring2, weights[1])]
        moved = 0
        maxd = 0.0
        for verts, w in weighted:
            if w == 0.0 or len(verts) == 0:
                continue
            for vi in (int(v) for v in verts):
                p = body_world[vi]
                dv = p - gc
                ln = float(np.linalg.norm(dv))
                if ln < 1e-12:
                    continue
                direction = Vector(tuple(dv / ln))
                hit = tree.ray_cast(Vector(tuple(gc)), direction)
                if hit[0] is None:
                    raise RuntimeError(
                        f"LIDCONFORM: ray from globe centre misses the eye "
                        f"mesh (side {side} vert {vi}) -- refusing")
                target = np.array(tuple(hit[0]), dtype=float) \
                    + (dv / ln) * (offset_mm / 1000.0)
                d = w * (target - p)
                disp_world[vi] += d
                moved += 1
                maxd = max(maxd, float(np.linalg.norm(d)) * 1000.0)
        per_side[side] = {
            "baseRing1": int(len(brings["ring1"])),
            "matchedRing1": int(len(ring1)),
            "matchMedMm": round(float(np.median(best_d)), 4),
            "matchMaxMm": round(float(best_d.max()), 4),
            "ring2": int(len(ring2)),
            "ring3": int(len(ring3)),
            "movedVerts": moved,
            "maxDispMm": round(maxd, 4),
        }

    # Apply the same local displacement to Basis and EVERY key block so
    # lid blink deltas are carried unchanged.
    disp_local = np.array(
        [tuple(mw_inv3 @ Vector(tuple(d))) for d in disp_world])
    nz = np.linalg.norm(disp_world, axis=1) > 1e-12
    key_blocks = list(me.shape_keys.key_blocks) \
        if me.shape_keys else []
    if not key_blocks:
        for i in np.nonzero(nz)[0]:
            v = me.vertices[int(i)]
            v.co = v.co + Vector(tuple(disp_local[int(i)]))
    else:
        for kb in key_blocks:
            for i in np.nonzero(nz)[0]:
                ii = int(i)
                kb.data[ii].co = kb.data[ii].co + Vector(
                    tuple(disp_local[ii]))
    me.update()
    bpy.context.view_layer.update()

    record = {"offsetMm": offset_mm, "weights": list(weights),
              "ringSource": "base-glb-topological",
              "baseGlb": BASE_GLB_PATH,
              "displacedVerts": int(nz.sum()), "perSide": per_side,
              "keyBlocksCarried": [kb.name for kb in key_blocks]}
    print("LIDCONFORM " + json.dumps(record))
    return record
