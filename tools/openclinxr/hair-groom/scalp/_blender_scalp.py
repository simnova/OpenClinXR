"""STEP 2 (Blender): scalp mesh = head-surface region inside the hairline loop.

Reads (read-only): body GLB, E/hairline.json (loop), scalp/uvutil.py.
The library hair object is hidden and asserted excluded.

Region rule: head faces with centroid z > 1.45 are candidates (covers the
whole scalp plus face/ears, which the loop test then excludes); a face is
kept when ANY of its vertices falls inside the loop UV polygon (superset so
the mesh covers every root; roots themselves are clipped exactly to the
loop in the roots step). UV chart: U = signed azimuth about the head axis
(seam at the back midline, side-preserving), V = elevation.

Writes: E/scalp.npz (verts/tris/uv/loop/boundary accuracy), E/scalp.obj.
Usage: Blender --background --python _blender_scalp.py -- <outdir-E>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

S2 = Path(__file__).resolve().parent
sys.path.insert(0, str(S2))
import common as C
import uvutil as U

E = Path(sys.argv[sys.argv.index("--") + 1])


def load_body(glb):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    head = max(meshes, key=lambda o: len(o.data.vertices))
    hair_objs = [o for o in meshes if "hair" in o.name.lower()]
    if not hair_objs:
        raise RuntimeError("ASSERT FAIL: no library hair object found to exclude")
    for o in hair_objs:
        o.hide_render = True
        o.hide_viewport = True
    if [o.name for o in meshes if "hair" in o.name.lower() and not o.hide_render]:
        raise RuntimeError("ASSERT FAIL: hair object still visible")
    return head, [o.name for o in hair_objs]


def main():
    doc, _ = C.load_manifest()
    C.log_open(E / "hairline.json")
    hl = json.loads((E / "hairline.json").read_text())
    body_path = C.ROOT / doc["body"]["glb"]
    C.log_open(body_path)
    head, hair_names = load_body(str(body_path))

    M = head.matrix_world
    inv = M.inverted()
    deps = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(head, deps)

    def snap(points):
        out = []
        for p in points:
            hit = tree.find_nearest(inv @ Vector(p), 0.05)
            if hit[0] is None:
                raise RuntimeError("waypoint >50mm from skin: %r" % (p,))
            w = M @ hit[0]
            n = (inv.to_3x3().inverted().transposed() @ Vector(hit[1])).normalized()
            out.append((Vector(w) + n * 0.0003)[:])
        return [[float(v) for v in q] for q in out]

    # loop2: hairline loop resampled to <=2mm steps and snapped to skin (the
    # raw loop's 21mm junction chords float off-surface and leave barrier
    # gaps; snapping puts the barrier on the skin under the chords).
    # PRIOR runs are 3-pt median smoothed (snap nearest-vertex jitter zigzags
    # the sideburn/collar in UV and folds chart triangles); TARGET points are
    # kept exact. Labels follow the raw segments.
    raw_loop = np.array(hl["loop"]["points"])
    raw_src = list(hl["loop"]["source"])
    dense = [raw_loop[0].tolist()]
    labels = [raw_src[0]]
    for i in range(len(raw_loop) - 1):
        a, b = raw_loop[i], raw_loop[i + 1]
        seg = float(np.linalg.norm(b - a))
        nn = max(1, int(round(seg / 0.002)))
        for k in range(1, nn + 1):
            dense.append((a + (b - a) * (k / nn)).tolist())
            labels.append(raw_src[i])
    labels[-1] = raw_src[-1]
    loop = np.array(snap(dense))
    is_prior = np.array([s == "PRIOR-sideburn" or s == "PRIOR-nape" or s == "PRIOR" for s in labels])
    sm = loop.copy()
    for k in range(1, len(loop) - 1):
        if is_prior[k] and is_prior[k - 1] and is_prior[k + 1]:
            sm[k] = np.median(loop[k - 1:k + 2], axis=0)
    # re-snap smoothed PRIOR points (median can float off-skin)
    loop = np.array(snap(sm.tolist()))
    print("LOOP2 n=%d nPriorSmooth=%d" % (len(loop), int(is_prior.sum())))

    # ear collar (PRIOR, stated): ... Anchored to
    # measured flap extent (|x|>=0.075, y -0.0595..-0.0349, z ..1.5562).
    # Collar anchors = topmost PRIOR-sideburn loop point per side (max z of
    # each sideburn run; CORRECTION 1: no TARGET-profile segment remains).
    lp = np.array(hl["loop"]["points"])
    ls = np.array(hl["loop"]["source"])
    runs = []
    cur = []
    for i, s in enumerate(list(ls) + [None]):
        if s == "PRIOR-sideburn":
            cur.append(i)
        else:
            if cur:
                runs.append(cur)
                cur = []
    if len(runs) != 2:
        raise RuntimeError("expected 2 sideburn runs, got %d" % len(runs))
    tb_pts = []
    for run in runs:
        top = lp[run[int(np.argmax(lp[run][:, 2]))]]
        tb_pts.append([float(top[0]), float(top[1]), float(top[2])])
    collar_segs_a, collar_segs_b = [], []
    for sign in (+1.0, -1.0):
        side = [q for q in tb_pts if (q[0] >= 0) == (sign > 0)]
        if len(side) != 1:
            raise RuntimeError("sideburn top anchor ambiguous for sign %s" % sign)
        tb = side[0]
        way = [([float(tb[0]), float(tb[1]), float(tb[2])],
                [sign * 0.074, -0.075, 1.556]),
               ([sign * 0.074, -0.075, 1.556],
                [sign * 0.073, -0.045, 1.561]),
               ([sign * 0.073, -0.045, 1.561],
                [sign * 0.068, -0.015, 1.558]),
               ([sign * 0.068, -0.015, 1.558],
                [sign * 0.060, 0.010, 1.548]),
               ([sign * 0.060, 0.010, 1.548],
                [sign * 0.058, 0.015, 1.530]),
               ([sign * 0.058, 0.015, 1.530],
                [sign * 0.055, 0.025, 1.517])]
        pts = [way[0][0]]
        for (a, b) in way:
            seg = float(np.linalg.norm(np.array(b) - np.array(a)))
            nn = max(1, int(round(seg / 0.003)))
            for k in range(1, nn + 1):
                f = k / nn
                pts.append((np.array(a) + (np.array(b) - np.array(a)) * f).tolist())
        sp = snap(pts)
        collar_segs_a += sp[:-1]
        collar_segs_b += sp[1:]
    barrier_extra = (np.array(collar_segs_a), np.array(collar_segs_b))

    verts = np.array([[v.x, v.y, v.z] for v in (M @ vv.co for vv in head.data.vertices)])
    tris = []
    for poly in head.data.polygons:
        idx = list(poly.vertices)
        for k in range(1, len(idx) - 1):
            tris.append([idx[0], idx[k], idx[k + 1]])
    tris = np.array(tris, dtype=np.int64)

    ax, ay = float(hl["axis"]["x"]), float(hl["axis"]["y"])
    ecz = float(hl["axis"]["elevCentreZ"])
    uv = U.chart(verts, ax, ay, ecz)
    # pole fix (stated): verts within 15mm of the head axis have degenerate
    # azimuth (atan2 noise grows as 1/r; the crown dome is featureless, so
    # replacing pole U by the neighbour circular mean is safe); without repair
    # their fan triangles span ~85deg in U and fake chart overlaps, and an
    # 8mm repair ring still kinks against analytic exterior az.
    edges0 = set()
    for a, b, c in tris:
        for i, j in ((a, b), (b, c), (c, a)):
            edges0.add((int(min(i, j)), int(max(i, j))))
    adj0: dict[int, list[int]] = {}
    for i, j in edges0:
        adj0.setdefault(i, []).append(j)
        adj0.setdefault(j, []).append(i)
    r_xy = np.hypot(verts[:, 0] - ax, verts[:, 1] - ay)
    pole = r_xy < 0.015
    print("POLE verts=%d" % int(pole.sum()))
    for _ in range(5):
        new_u = uv[:, 0].copy()
        for v in np.where(pole)[0]:
            nb = [w for w in adj0.get(int(v), []) if not pole[w]]
            if not nb:
                nb = adj0.get(int(v), [])
            if nb:
                ang = uv[nb, 0]
                new_u[v] = float(np.arctan2(np.sin(ang).mean(), np.cos(ang).mean()))
        uv[:, 0] = new_u
    # NOTE: `loop` is loop2 (dense, skin-snapped) from above.
    poly = U.unwrap_poly(U.chart(loop, ax, ay, ecz))
    # loop shape check: unwrapped-U monotonicity decides the inside-test model
    du = np.diff(poly[:, 0])
    mono_frac = float((du > 0).mean())
    mono = mono_frac > 0.995 or mono_frac < 0.005
    # GRAPH inside test: the loop is U-monotonic, so resample it as a function
    # V=f(U) (720 bins, median V per bin kills snap jitter; near-vertical runs
    # like the sideburn collapse to their median V -- documented) and test
    # inside = V > f(U). Subsumes the polar-cap/below rules (f<=Vmax).
    pu = poly[:, 0]
    order = np.argsort(pu, kind="stable")
    edges_u = np.linspace(pu.min(), pu.max(), 721)
    binidx = np.clip(np.digitize(pu[order], edges_u) - 1, 0, 719)
    med = np.full(720, np.nan)
    for b in range(720):
        v = poly[order][binidx == b][:, 1]
        if len(v):
            med[b] = float(np.median(v))
    ok = ~np.isnan(med)
    gu = (edges_u[:-1] + edges_u[1:]) * 0.5
    gu, gv = gu[ok], med[ok]

    def graph_inside(quv):
        quv = np.asarray(quv, dtype=np.float64)
        uq = ((quv[..., 0] - gu[0]) % (2.0 * np.pi)) + gu[0]
        return quv[..., 1] > np.interp(uq, gu, gv)
    graph_v = graph_inside(uv)
    print("GRAPH insideVerts=%d" % int(graph_v.sum()))
    # REGION (3D flood fill from the crown + graph clip + ear-box cut):
    # barrier = dense skin-snapped loop (2.5mm) + ear collar (5mm).
    # edge list + adjacency
    edges = set()
    for a, b, c in tris:
        for i, j in ((a, b), (b, c), (c, a)):
            edges.add((int(min(i, j)), int(max(i, j))))
    edges = np.array(sorted(edges), dtype=np.int64)
    emid = (verts[edges[:, 0]] + verts[edges[:, 1]]) * 0.5
    # barrier = hairline loop segments (2mm band: keeps the region edge tight
    # at the TARGET hairline) + ear-collar segments (5mm band: the coarse ear
    # bridge mesh needs a wide band to seal). Flood stops at the band's inner
    # edge, so the region stays inside the loop everywhere.
    def band(segs, width):
        a0 = np.array(segs[0])
        b0 = np.array(segs[1])
        ab = b0 - a0
        denom = (ab * ab).sum(axis=1) + 1e-18
        out = np.zeros(len(emid), dtype=bool)
        for s in range(0, len(emid), 4000):
            m = emid[s:s + 4000]
            best = np.full(len(m), 1e9)
            for k in range(0, len(a0), 200):
                a = a0[k:k + 200]
                d = m[:, None, :] - a[None, :, :]
                t = np.clip((d * ab[k:k + 200][None, :, :]).sum(axis=2) / denom[k:k + 200][None, :], 0, 1)
                p = a[None, :, :] + (ab[k:k + 200][None, :, :] * t[:, :, None])
                best = np.minimum(best, np.linalg.norm(m[:, None, :] - p, axis=2).min(axis=1))
            out[s:s + 4000] = best < width
        return out
    b_loop = band((list(loop[:-1]), list(loop[1:])), 0.0025)
    b_collar = band((list(barrier_extra[0]), list(barrier_extra[1])), 0.005)
    edge_barrier = b_loop | b_collar
    print("BARRIER loopEdges=%d collarEdges=%d" % (int(b_loop.sum()), int(b_collar.sum())))
    adj: dict[int, list[int]] = {}
    for ei, (i, j) in enumerate(edges):
        if not edge_barrier[ei]:
            adj.setdefault(i, []).append(j)
            adj.setdefault(j, []).append(i)
    crown_vi = int(np.argmax(verts[:, 2]))
    seen = np.zeros(len(verts), dtype=bool)
    seen[crown_vi] = True
    stack = [crown_vi]
    while stack:
        v = stack.pop()
        for w in adj.get(v, ()):
            if not seen[w]:
                seen[w] = True
                stack.append(w)
    # mesh faces: flooded (topology guard) AND graph-inside (exact clip),
    # minus the ear-apparatus box (stated rule): the ear flap + root groove
    # (|x|>0.075 flap measured; groove folds the azimuth chart, verified by
    # 102 flipped UV tris confined to x +-0.074, y -0.061..-0.039). The
    # rerouted sideburn stays forward of y=-0.068 / under the lobe (z<1.506),
    # clear of the box; the nape corner (|x|=0.055) is clear of its x wall.
    flood_any = seen[tris].any(axis=1)
    graph_any = graph_v[tris].any(axis=1)
    cent = verts[tris].mean(axis=1)
    ear_box = ((np.abs(cent[:, 0]) > 0.058) & (cent[:, 1] >= -0.066) & (cent[:, 1] <= -0.020)
               & (cent[:, 2] >= 1.5035) & (cent[:, 2] <= 1.562))
    keep = flood_any & graph_any & ~ear_box
    scalp_tris = tris[keep]
    n_ear_cut = int((flood_any & graph_any & ear_box).sum())
    print("EARBOX cut=%d" % n_ear_cut)

    # boundary accuracy: edges with exactly one incident scalp tri;
    kept_edges = set()
    from collections import Counter
    full_cnt = Counter()
    for a, b, c in (tuple(int(v) for v in t) for t in tris):
        for i, j in ((a, b), (b, c), (c, a)):
            full_cnt[(min(i, j), max(i, j))] += 1
    for a, b, c in scalp_tris:
        for i, j in ((a, b), (b, c), (c, a)):
            kept_edges.add((int(min(i, j)), int(max(i, j))))
    # boundary edges of the scalp patch: kept edges with <2 incident scalp tris
    cnt = Counter()
    for a, b, c in (tuple(int(v) for v in t) for t in scalp_tris):
        for i, j in ((a, b), (b, c), (c, a)):
            cnt[(min(i, j), max(i, j))] += 1
    bnd_edges = [e for e in kept_edges if cnt[e] == 1 and full_cnt.get(e, 0) == 2]
    mids = np.array([(verts[i] + verts[j]) * 0.5 for (i, j) in bnd_edges])
    # boundary accuracy, TARGET-gated (ear/collar boundaries are PRIOR and
    # excluded by construction): (1) coverage: TARGET hairline samples
    # (1mm-resampled) -> nearest scalp triangle distance; (2) overshoot:
    # boundary edges whose nearest raw-loop point is TARGET-sourced ->
    # distance to the raw loop. Both in mm.
    raw = np.array(hl["loop"]["points"])
    rsrc = np.array(hl["loop"]["source"])
    tmask = np.array([s.startswith("TARGET") for s in rsrc])
    # (1) resample TARGET raw segments to ~1mm
    tsamp = []
    for i in range(len(raw) - 1):
        if tmask[i] and tmask[i + 1]:
            a, b = raw[i], raw[i + 1]
            seg = float(np.linalg.norm(b - a))
            nn = max(1, int(round(seg / 0.001)))
            for k in range(nn):
                tsamp.append((a + (b - a) * (k / nn)).tolist())
    tsamp = np.array(tsamp)
    triA, triB, triC = verts[scalp_tris[:, 0]], verts[scalp_tris[:, 1]], verts[scalp_tris[:, 2]]
    cov = np.full(len(tsamp), 1e9)
    for s in range(0, len(tsamp), 1000):
        m = tsamp[s:s + 1000]
        # point-triangle distance, chunked over tris
        best = np.full(len(m), 1e9)
        for k in range(0, len(triA), 2000):
            A, B, Cc = triA[k:k + 2000], triB[k:k + 2000], triC[k:k + 2000]
            ab, ac = B - A, Cc - A
            ap = m[:, None, :] - A[None, :, :]
            d1 = (ap * ab[None]).sum(-1)
            d2 = (ap * ac[None]).sum(-1)
            # barycentric (Ericson 5.1.5 simplified via normal projection approx:
            # use vertex/edge Voronoi-lite: min over vertices + edge lines)
            n = np.cross(ab, ac)
            nn = np.linalg.norm(n, axis=1) + 1e-18
            dist_plane = np.abs((ap * (n / nn[None, :, None])).sum(-1))
            # inside test via barycentric
            e1, e2 = ab, ac
            d11 = (e1 * e1).sum(-1)
            d12 = (e1 * e2).sum(-1)
            d22 = (e2 * e2).sum(-1)
            den = (d11 * d22 - d12 * d12)[None, :] + 1e-18
            v = (d22[None, :] * d1 - d12[None, :] * d2) / den
            w = (d11[None, :] * d2 - d12[None, :] * d1) / den
            inside = (v >= 0) & (w >= 0) & (v + w <= 1)
            # edge distances
            def segd(p, a, b):
                ab_ = b - a
                t = np.clip(((p[:, None, :] - a[None, :, :]) * ab_[None, :, :]).sum(-1) /
                            ((ab_ * ab_).sum(-1)[None, :] + 1e-18), 0, 1)
                return np.linalg.norm(p[:, None, :] - (a[None, :, :] + ab_[None, :, :] * t[:, :, None]), axis=2)
            dface = np.where(inside, dist_plane, 1e9)
            dface = np.minimum(dface, segd(m, A, B))
            dface = np.minimum(dface, segd(m, B, Cc))
            dface = np.minimum(dface, segd(m, Cc, A))
            best = np.minimum(best, dface.min(axis=1))
        cov[s:s + 1000] = best
    cov_mm = cov * 1000.0
    # (2) overshoot: boundary edges near TARGET raw-loop points
    segs_a = raw[:-1]
    segs_b = raw[1:]
    tseg = tmask[:-1] & tmask[1:]
    mids_t = []
    for (i, j) in bnd_edges:
        m = (verts[i] + verts[j]) * 0.5
        dd = np.linalg.norm(raw[None, :, :] - m[None, None, :], axis=2).min(axis=1)
        # nearest raw point TARGET-sourced?
        if bool(tmask[np.linalg.norm(raw - m, axis=1).argmin()]):
            mids_t.append(m)
    mids_t = np.array(mids_t) if mids_t else np.zeros((0, 3))
    over = np.full(len(mids_t), 1e9)
    tA, tB = segs_a[tseg], segs_b[tseg]
    ab = tB - tA
    denom = (ab * ab).sum(axis=1) + 1e-18
    for s in range(0, len(mids_t), 2000):
        m = mids_t[s:s + 2000]
        best = np.full(len(m), 1e9)
        for k in range(0, len(tA), 200):
            a = tA[k:k + 200]
            d = m[:, None, :] - a[None, :, :]
            t = np.clip((d * ab[k:k + 200][None, :, :]).sum(axis=2) / denom[k:k + 200][None, :], 0, 1)
            p = a[None, :, :] + (ab[k:k + 200][None, :, :] * t[:, :, None])
            best = np.minimum(best, np.linalg.norm(m[:, None, :] - p, axis=2).min(axis=1))
        over[s:s + 2000] = best
    over_mm = over * 1000.0
    print("BND coverage p50=%.2f p95=%.2f max=%.2fmm (n=%d); overshoot p50=%.2f p95=%.2f max=%.2fmm (n=%d)" % (
        float(np.median(cov_mm)), float(np.percentile(cov_mm, 95)), float(cov_mm.max()), len(cov_mm),
        float(np.median(over_mm)) if len(over_mm) else -1,
        float(np.percentile(over_mm, 95)) if len(over_mm) else -1,
        float(over_mm.max()) if len(over_mm) else -1, len(over_mm)))

    np.savez(str(E / "scalp.npz"),
             verts=verts, tris=scalp_tris, uv=uv,
             loopPts=loop, loopPolyUV=poly,
             loopRaw=np.array(hl["loop"]["points"]),
             graphU=gu, graphV=gv,
             axis=np.array([ax, ay, ecz]),
             headTris=np.int64(len(tris)),
             earCutTris=np.int64(n_ear_cut),
             loopMonoFrac=np.float64(mono_frac),
             coverMm=cov_mm, overMm=over_mm)
    with open(E / "scalp.obj", "w") as f:
        f.write("# S2 scalp: copied head-surface region, no inset\n")
        for v in verts:
            f.write("v %.6f %.6f %.6f\n" % (v[0], v[1], v[2]))
        for t in uv:
            f.write("vt %.6f %.6f\n" % (t[0], t[1]))
        for a, b, c in scalp_tris:
            f.write("f %d/%d %d/%d %d/%d\n" % (a + 1, a + 1, b + 1, b + 1, c + 1, c + 1))
    C.write_opened(E / "inputs-opened.txt")
    print("SCALP_DONE headTris=%d scalpTris=%d earCut=%d monoFrac=%.4f" % (
        len(tris), len(scalp_tris), n_ear_cut, mono_frac))


main()
