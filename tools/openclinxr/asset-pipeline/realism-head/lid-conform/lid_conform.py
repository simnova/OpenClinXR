"""Lid-conform Blender pass: seat the inner lid ring on the globe mesh.

Deterministic post-import body-vertex pass. For each eye, the lid-margin
ring (ring1) is located on the in-Blender body as follows:

1. The ring is DERIVED TOPOLOGICALLY (lid_conform_core.derive_eye_rings,
   the lidcurve_measure.py definition: eye-opening boundary loop nearest
   each globe centre + BFS outward rings; no hard-coded vertex indices)
   on the SUBJECT'S OWN pre-conform bake GLB (base_glb_for_case, the
   eyeglobe base bake whose body is bit-identical to this bake's
   pre-conform body -- measured micron-coincident at the margin,
   reported per bake below). The in-Blender post-subdiv body is
   watertight (measured: 0 boundary edges at both polygon and
   tessellation level), so the boundary walk cannot run here; the base
   GLB carries the identical surface WITH the export-time openings.
   Body/globe/cornea meshes inside that GLB resolve BY ROLE
   (lid_conform_core resolve_*_mesh_name: the mpfb_skin_* body material,
   the node-referenced eye-material globe, the openclinxr_eye_cornea_mat
   corneas -- tags the materializer already writes for every subject).
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
diff). No-op for every case id not listed in LID_CONFORM_BY_CASE_ID.

Fissure targets (any-subject-report.json): aisha 26.8 bakes toward the
27.7 case goal (conform-report.json); body2's target converts its own
eye-corner landmarks (any-subject-targets.json) to mm with its own
pre-conform bake head scale (temple ruler 127-356, method in the
report), minus the 0.9 seat-pullback the aisha prototype measured.
"""

import json
import sys
from pathlib import Path

import numpy as np

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
import lid_conform_core as core  # noqa: E402

# Store roots holding each case's own pre-conform eyeglobe base bake
# (bit-identical body to the conformed bake's pre-conform body; sha256
# pinned in the conform record). Built per case id -- no stem literal.
_LID_STORE = "/Volumes/files/openclinxr-assets/store/lid-conform"
_LID_ANY_STORE = "/Volumes/files/openclinxr-assets/store/lid-conform-any"


def base_glb_for_case(case_id):
    """Ring-source GLB for a case: the subject's own pre-conform bake."""
    store = _LID_STORE if case_id == "aisha" else _LID_ANY_STORE
    return f"{store}/{case_id}-eyeglobe-base.glb"


# Per-case lid-conform config. Absent case = no-op (byte-stable).
# H1 (widen-then-seat): rigid canthus patches widen the margin loop to
# targetWidthMm along the lid surface first (K/M/D patch geometry, no
# hand-placed vertices); then each ring1 vert seats toward the globe
# surface +offsetMm with a gap-adaptive weight (1 inside seatFloorMm,
# falling to 0 at seatCeilingMm -- flesh canthi stay in flesh). ring2
# stays the zero anchor. Lash roots follow the lid field (lashFollowMm).
LID_CONFORM_BY_CASE_ID = {
    "aisha": {"offsetMm": 0.5, "weights": [1.0, 0.0],
              "targetWidthMm": 26.8, "patchK": 6, "patchM": 8,
              "patchD": 2, "seatCeilingMm": 1.5,
              "seatFloorMm": 0.5, "lashFollowMm": 4.0},
    "body2": {"offsetMm": 0.5, "weights": [1.0, 0.0],
              "targetWidthMm": 25.0, "patchK": 6, "patchM": 8,
              "patchD": 2, "seatCeilingMm": 1.5,
              "seatFloorMm": 0.5, "lashFollowMm": 4.0},
}


def case_config(case_id):
    """Config for a case id, or None (no-op). Never raises on unknown."""
    cfg = LID_CONFORM_BY_CASE_ID.get(case_id)
    if cfg is None:
        return None
    out = dict(cfg)
    out["baseGlb"] = base_glb_for_case(case_id)
    return out

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
                 weights=(1.0, 0.0), target_width_mm=None, patch_k=6,
                 patch_m=8, patch_d=2, seat_ceiling_mm=1.5,
                 seat_floor_mm=0.5, lash_follow_mm=4.0,
                 ring_source_glb=None, case_id=None):
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

    # Ring source: topological derivation on the subject's OWN pre-conform
    # bake GLB (identical body surface WITH the export-time openings),
    # meshes resolved by role; matched spatially here.
    _ring_glb = ring_source_glb or (
        base_glb_for_case(case_id) if case_id else None)
    if not _ring_glb:
        raise RuntimeError(
            "LIDCONFORM: no ring-source GLB (pass ring_source_glb or "
            "case_id) -- refusing")
    bjs, bblob = core.load_glb(_ring_glb)
    bworlds = core.node_worlds(bjs)
    bbody, bbody_idx = core.skin_mesh(
        bjs, bblob, bworlds, core.resolve_body_mesh_name(bjs))
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
        # Order ring1 along the loop; canthus tips = PCA extremes.
        _rset = set(int(v) for v in ring1)
        _start = int(ring1[0])
        _order = [_start]
        _prev, _cur = None, _start
        while True:
            _nxts = [w for w in adj.get(_cur, ()) if w in _rset
                     and w != _prev]
            if not _nxts:
                break
            _nxt = _nxts[0]
            if _nxt == _start:
                break
            _order.append(_nxt)
            _prev, _cur = _cur, _nxt
            if len(_order) > len(_rset) + 2:
                raise RuntimeError(
                    f"LIDCONFORM: margin loop walk failed on side {side} "
                    f"-- refusing")
        if len(_order) != len(_rset):
            raise RuntimeError(
                f"LIDCONFORM: margin loop walk covers {len(_order)}/"
                f"{len(_rset)} on side {side} -- refusing")
        _P = body_world[np.array(_order)]
        _cc = _P - _P.mean(axis=0)
        _u, _sv, _vt = np.linalg.svd(_cc, full_matrices=False)
        _ax = _vt[0]
        if abs(float(_ax[0])) < 0.5:
            raise RuntimeError(
                f"LIDCONFORM: margin long axis not lateral on side "
                f"{side} -- refusing")
        _t = _cc @ _ax
        _n = len(_order)
        _i_min, _i_max = int(np.argmin(_t)), int(np.argmax(_t))
        _cx = float(_P.mean(axis=0)[0])
        _cur_w = float(_P[:, 0].max() - _P[:, 0].min())

        # H1 WIDEN: rigid canthus patches (tip +-K loop steps + BFS
        # depth<=D, SAME lateral vector per patch) + cosine blend over
        # the next M loop steps + deeper BFS (flat lid absorbs shear).
        _need = None
        _patch_sizes = []
        if target_width_mm is not None:
            from collections import deque as _deque
            _need = target_width_mm / 1000.0 - _cur_w
            for _tip in (_i_min, _i_max):
                _core = set()
                for _k in range(-patch_k, patch_k + 1):
                    _core.add(_order[(_tip + _k) % _n])
                _depth = {v: 0 for v in _core}
                _q = _deque(_core)
                while _q:
                    _v = _q.popleft()
                    if _depth[_v] >= patch_d + 2:
                        continue
                    for _w in adj.get(_v, ()):
                        if _w not in _depth:
                            _depth[_w] = _depth[_v] + 1
                            _q.append(_w)
                _allv = np.array(list(_depth.keys()))
                _dd = ((body_world[_allv][:, None, :]
                       - body_world[np.array(_order)][None, :, :]) ** 2
                       ).sum(axis=2)
                _aoi = _dd.argmin(axis=1)
                _arcd = np.zeros(len(_allv))
                for _j, _a in enumerate(_aoi):
                    _arcd[_j] = min((_a - _tip) % _n, (_tip - _a) % _n)
                _wloop = np.cos(np.clip((_arcd - patch_k) / patch_m, 0, 1)
                                * np.pi / 2.0) ** 2
                _wloop = np.where(_arcd <= patch_k, 1.0, _wloop)
                _dep = np.array([_depth[v] for v in _allv])
                _wdep = np.where(_dep <= patch_d, 1.0,
                                 np.where(_dep == patch_d + 1, 0.5, 0.15))
                _wtot = _wloop * _wdep
                _lat = 1.0 if body_world[_order[_tip]][0] > _cx else -1.0
                _dv = np.zeros((len(_allv), 3))
                _dv[:, 0] = _lat * (_need / 2.0) * _wtot
                disp_world[_allv] += _dv
                _patch_sizes.append(int(len(_allv)))

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
        # H1 SEAT (gap-adaptive): full seating toward surface+offset for
        # near-globe verts, falling to 0 at seat_ceiling_mm (flesh stays).
        # Ring2 keeps weight 0 (anchor).
        moved = 0
        maxd = 0.0
        seated = 0
        flesh = 0
        widen_max = 0.0
        for vi in (int(v) for v in ring1):
            widen_max = max(widen_max,
                            float(np.linalg.norm(disp_world[vi])) * 1000.0)
        for vi in (int(v) for v in ring1):
            p = body_world[vi] + disp_world[vi]
            dv = p - gc
            ln = float(np.linalg.norm(dv))
            if ln < 1e-12:
                continue
            direction = Vector(tuple(dv / ln))
            hit = tree.ray_cast(Vector(tuple(gc)), direction)
            if hit[0] is None:
                flesh += 1
                continue
            t_hit = float((np.array(tuple(hit[0])) - gc) @ (dv / ln))
            gap_mm = (ln - t_hit) * 1000.0
            gw = min(max((seat_ceiling_mm - gap_mm)
                         / (seat_ceiling_mm - seat_floor_mm),
                         0.0), 1.0) * weights[0]
            if gw <= 0.0:
                flesh += 1
                continue
            target = np.array(tuple(hit[0]), dtype=float) \
                + (dv / ln) * (offset_mm / 1000.0)
            d = gw * (target - p)
            disp_world[vi] += d
            moved += 1
            seated += 1
            maxd = max(maxd, float(np.linalg.norm(d)) * 1000.0)
        if weights[1] != 0.0:
            raise RuntimeError("LIDCONFORM: ring2 weight must be 0")
        per_side[side] = {
            "baseRing1": int(len(brings["ring1"])),
            "matchedRing1": int(len(ring1)),
            "matchMedMm": round(float(np.median(best_d)), 4),
            "matchMaxMm": round(float(best_d.max()), 4),
            "preWidenWidthMm": round(_cur_w * 1000.0, 3),
            "widenNeedMm": round((_need * 1000.0 if _need is not None
                                  else 0.0), 3),
            "patchSizes": _patch_sizes,
            "ring2": int(len(ring2)),
            "ring3": int(len(ring3)),
            "seatedVerts": seated,
            "fleshVerts": flesh,
            "movedVerts": moved,
            "maxSeatMm": round(maxd, 4),
            "maxWidenMm": round(widen_max, 4),
        }

    # C4 lash follow (the card's permitted exception): lash verts take the
    # lid-field displacement of their nearest moved body vert, falling to
    # 0 at lash_follow_mm (roots follow the margin, tips stay).
    lash_obj = next(
        (o for o in bpy.context.scene.objects
         if o.type == "MESH" and "eyelash" in (o.name or "").lower()),
        None,
    )
    lash_info = {"found": lash_obj is not None, "movedVerts": 0,
                 "maxFollowMm": 0.0,
                 "keyBlocks": 0}
    if lash_obj is not None and float(lash_follow_mm) > 0.0:
        _lmw = lash_obj.matrix_world
        _lmw_inv3 = _lmw.inverted().to_3x3()
        _moved_idx = np.nonzero(
            np.linalg.norm(disp_world, axis=1) > 1e-12)[0]
        _moved_pos = body_world[_moved_idx] + disp_world[_moved_idx]
        _moved_d = disp_world[_moved_idx]
        _lash_disp = np.zeros((len(lash_obj.data.vertices), 3))
        for _li, _lv in enumerate(lash_obj.data.vertices):
            _lp = np.array(tuple(_lmw @ _lv.co))
            _dd = np.linalg.norm(_moved_pos - _lp, axis=1)
            _j = int(np.argmin(_dd))
            _dist = float(_dd[_j])
            if _dist < float(lash_follow_mm):
                _lash_disp[_li] = _moved_d[_j] * (
                    1.0 - _dist / float(lash_follow_mm))
                lash_info["movedVerts"] += 1
                lash_info["maxFollowMm"] = max(
                    lash_info["maxFollowMm"],
                    float(np.linalg.norm(_lash_disp[_li])) * 1000.0)
        _ld = np.array([tuple(_lmw_inv3 @ Vector(tuple(d)))
                        for d in _lash_disp])
        _lnz = np.linalg.norm(_lash_disp, axis=1) > 1e-12
        _lkb = list(lash_obj.data.shape_keys.key_blocks) \
            if lash_obj.data.shape_keys else []
        lash_info["keyBlocks"] = len(_lkb)
        if not _lkb:
            for _i in np.nonzero(_lnz)[0]:
                _v = lash_obj.data.vertices[int(_i)]
                _v.co = _v.co + Vector(tuple(_ld[int(_i)]))
        else:
            for _kb in _lkb:
                for _i in np.nonzero(_lnz)[0]:
                    _ii = int(_i)
                    _kb.data[_ii].co = _kb.data[_ii].co + Vector(
                        tuple(_ld[_ii]))
        lash_obj.data.update()

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
              "ringSource": "own-pre-conform-bake-topological",
              "baseGlb": _ring_glb,
              "h1": {"targetWidthMm": target_width_mm, "patchK": patch_k,
                     "patchM": patch_m, "patchD": patch_d,
                     "seatCeilingMm": seat_ceiling_mm,
                     "seatFloorMm": seat_floor_mm,
                     "lashFollowMm": lash_follow_mm},
              "displacedVerts": int(nz.sum()), "perSide": per_side,
              "lashFollow": lash_info,
              "keyBlocksCarried": [kb.name for kb in key_blocks]}
    print("LIDCONFORM " + json.dumps(record))
    return record
