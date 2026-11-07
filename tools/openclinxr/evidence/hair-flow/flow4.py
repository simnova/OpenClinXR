"""Hair-flow-4: M14 slit tracked at split time, M15 no-cross Dijkstra,
M16 black-NaN + blue->orange ramp + iso-lines, M17 15pt/10pass smooth pre-phi.

Copies flow3.py structure (never imports it). Changes vs flow-3:
M14: slit verts = verts incident to faces deleted by the x=0 channel cut
  (recorded at split time on the subdivided mesh, so no tracking through
  subdivision is needed) plus the two front slit corner verts (frontmost
  channel-mouth verts each side); EXIT = boundary minus forehead minus slit;
  assert the three sets are disjoint.
M15: Dijkstra must not cross the slit (face channel already gaps it); KD
  bridges forbidden within 5 mm of any slit vert.
M16: unreachable/NaN verts BLACK; ramp blue(0)->orange(max), no skin value;
  phi iso-lines every 20 mm darkened in vertex colours (cheap).
M17: hairline fit BEFORE phi: boundary verts moved toward 15-point moving
  average along boundary order, BVH-reprojected, 10 passes, only the two
  front slit corners pinned; G3 then measured vs 9-point average.
G4 restated (slit phi>0 everywhere, min>=30mm, argmax |x|<=10mm); G12
  withdrawn; G13 added (front-half near-slit flow leaves sideways).
CLI: Blender -b --python flow4.py -- --out E
"""
import argparse, heapq, importlib.util, math, statistics, sys
from collections import defaultdict
from pathlib import Path
import bpy, bmesh, numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
HERE = Path(__file__).resolve().parent

def load_hs():
    p = HERE.parent / "hair-scene" / "hair_scene.py"
    s = importlib.util.spec_from_file_location("oclx_hs", p)
    m = importlib.util.module_from_spec(s); sys.modules[s.name] = m
    s.loader.exec_module(m); return m

def bm_stats(bm):
    bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table(); bm.edges.ensure_lookup_table()
    area = sum(f.calc_area() for f in bm.faces)
    med = statistics.median([e.calc_length() for e in bm.edges]) if len(bm.edges) else 0.0
    seen, nc = set(), 0
    for f in bm.faces:
        if f.index in seen: continue
        nc += 1; st = [f]; seen.add(f.index)
        while st:
            x = st.pop()
            for e in x.edges:
                for g in e.link_faces:
                    if g.index not in seen: seen.add(g.index); st.append(g)
    return len(bm.verts), len(bm.faces), area, nc, med

def comp_detail(bm):
    """M11/D1: per-component faces, area, bbox, vert coords (world-baked)."""
    faces = list(bm.faces)
    seen, comps = set(), []
    for f in faces:
        if f.index in seen: continue
        st = [f]; seen.add(f.index); cf = [f]
        while st:
            x = st.pop()
            for e in x.edges:
                for g in e.link_faces:
                    if g.index not in seen: seen.add(g.index); st.append(g); cf.append(g)
        comps.append(cf)
    out = []
    for cf in comps:
        vs = {v for f in cf for v in f.verts}
        P = np.array([tuple(v.co) for v in vs])
        out.append({"faces": cf, "nfaces": len(cf), "area": float(sum(f.calc_area() for f in cf)),
                    "bbox": (P.min(axis=0), P.max(axis=0)), "verts": list(vs), "P": P})
    out.sort(key=lambda d: -d["nfaces"])
    return out

def pair_mindist(P, Q, chunk=512):
    m = float("inf")
    for i in range(0, len(P), chunk):
        D = np.linalg.norm(P[i:i + chunk, None, :] - Q[None, :, :], axis=2)
        m = min(m, float(D.min()))
    return m

def boundary_info(F):
    """Undirected boundary-edge components (=loops when manifold degree-2);
    greedy order of the largest group (prev-avoiding walk)."""
    cnt = defaultdict(list)
    for f in F:
        for k in range(3):
            a, b = f[k], f[(k + 1) % 3]
            cnt[tuple(sorted((a, b)))].append(f)
    bnd = [e for e, v in cnt.items() if len(v) == 1]
    adj = defaultdict(set)
    for a, b in bnd:
        adj[a].add(b); adj[b].add(a)
    seen, groups = set(), []
    for s in adj:
        if s in seen: continue
        st = [s]; seen.add(s); g = [s]
        while st:
            x = st.pop()
            for y in adj[x]:
                if y not in seen: seen.add(y); st.append(y); g.append(y)
        groups.append(g)
    groups.sort(key=len, reverse=True)
    order, cov = [], 0.0
    if groups:
        gset = set(groups[0])
        degs = {v: len(adj[v]) for v in groups[0]}
        s = min(groups[0], key=lambda v: (degs[v] != 2, v))
        used = {s}; order = [s]; prev, cur = None, s
        while True:
            cands = [w for w in adj[cur] if w != prev and w not in used]
            if not cands:
                cands = [w for w in adj[cur] if w != prev and w == s]
                if cands: break  # closed
                break
            nxt = min(cands, key=lambda w: (degs[w] != 2, w))
            order.append(nxt); used.add(nxt); prev, cur = cur, nxt
            if len(order) > len(gset) + 2: break
        cov = len(used) / max(1, len(gset))
    return bnd, groups, order, cov, adj

def runs_for(adj, members):
    """True boundary runs: greedy walks over boundary adjacency restricted to
    members (no chords across the mesh)."""
    unvis = set(members); runs = []
    while unvis:
        s = min(unvis, key=lambda v: (sum(1 for w in adj[v] if w in unvis) >= 2, v))
        run = [s]; unvis.discard(s); prev, cur = None, s
        while True:
            cands = [w for w in adj[cur] if w in unvis and w != prev]
            if not cands: break
            nxt = min(cands); run.append(nxt); unvis.discard(nxt); prev, cur = cur, nxt
        runs.append(run)
    return [r for r in runs if r]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True)
    out = Path(ap.parse_args(sys.argv[sys.argv.index("--") + 1:]).out); out.mkdir(parents=True, exist_ok=True)
    HS = load_hs(); h = HS.build_scene(); head = h.head
    print("P1 scale=%s dims=%s" % (tuple(head.scale), tuple(head.dimensions)))
    Mw = head.matrix_world.copy()
    ws = np.array([tuple(Mw @ v.co) for v in head.data.vertices])
    xs, ys, zs = ws[:, 0], ws[:, 1], ws[:, 2]
    crown = float(zs.max()); ai = int(zs.argmax()); apex = ws[ai]; apex_y = float(apex[1])
    HSET = ws[zs > crown - 0.26]
    hx, hy, hz = HSET[:, 0], HSET[:, 1], HSET[:, 2]
    cx, cy = float(np.median(hx)), float(np.median(hy))
    band = HSET[(hz >= crown - 0.17) & (hz <= crown - 0.09)]
    eL = band[band[:, 0].argmax()]; eR = band[band[:, 0].argmin()]
    eLz = float(band[np.linalg.norm(band - eL, axis=1) <= 0.015][:, 2].max())
    eRz = float(band[np.linalg.norm(band - eR, axis=1) <= 0.015][:, 2].max())
    ear_top = min(eLz, eRz)
    mid = HSET[(np.abs(hx - cx) < 0.005) & (hz >= crown - 0.13) & (hz <= crown - 0.09)]
    brow = mid[mid[:, 1].argmin()]
    nose = HSET[np.abs(hx - cx) < 0.005][HSET[np.abs(hx - cx) < 0.005][:, 1].argmin()]
    face = "-Y" if float(nose[1]) < apex_y else "+Y"
    print("P2 nose (%.4f,%.4f,%.4f) apex_y=%.4f face=%s" % (*nose, apex_y, face))
    print("M6 crown=%.4f cx=%.4f cy=%.4f earL=(%.4f,%.4f,%.4f) earR=(%.4f,%.4f,%.4f) ear_top_z=%.4f brow=(%.4f,%.4f,%.4f)" % (crown, cx, cy, *eL, *eR, ear_top, *brow))
    g9e = (abs(eL[0] + eR[0] - 2 * cx), abs(eL[1] - eR[1]), abs(eLz - eRz))
    print("G9-ear dx=%.4f dy=%.4f dz=%.4f" % (g9e[0] * 1000, g9e[1] * 1000, g9e[2] * 1000))
    centre = np.array([cx, cy + 0.005, crown - 0.105])
    browz = float(brow[2])
    face_v = np.array([0.0, -1.0, 0.0])
    def bnd_z(x, y):
        az = math.atan2(x - cx, -(y - centre[1]))
        return crown - (0.165 - 0.025 * abs(math.sin(az)) + 0.095 * max(0.0, -math.cos(az)))
    fs = [[v for v in p.vertices] for p in head.data.polygons]
    cfs = np.array([ws[f].mean(axis=0) for f in fs])
    emap = {}
    for i, f in enumerate(fs):
        for k in range(len(f)):
            e = tuple(sorted((f[k], f[(k + 1) % len(f)]))); emap.setdefault(e, []).append(i)
    fadj = [set() for _ in fs]
    for o in emap.values():
        for i in o:
            for j in o:
                if i != j: fadj[i].add(j)
    def inside(c, d):
        if abs(c[0] - cx) > 0.072 and c[2] < ear_top: return False
        if c[2] < bnd_z(c[0], c[1]) + d: return False
        return True
    def flood(d):
        ok = {i for i, c in enumerate(cfs) if inside(c, d)}
        seed = max(ok, key=lambda i: float(cfs[i][2]))
        seen, st = {seed}, [seed]
        while st:
            x = st.pop()
            for y in fadj[x]:
                if y in ok and y not in seen: seen.add(y); st.append(y)
        tris = []
        for i in seen:
            f = fs[i]; tris += [[f[0], f[k + 1], f[k + 2]] for k in range(len(f) - 2)]
        a = float(sum(0.5 * np.linalg.norm(np.cross(ws[b] - ws[a], ws[c] - ws[a])) for a, b, c in tris))
        fc = cfs[list(seen)]
        front = fc[(np.abs(fc[:, 0] - cx) < 0.01) & (fc[:, 1] < centre[1])]
        return a, (float(front[:, 2].min()) if len(front) else 0.0), seen
    delta, carea, keep = None, 0.0, set()
    for d in (0.080, 0.075, 0.085, 0.070, 0.090, 0.065):
        a, fz, ks = flood(d); print("delta=%.3f flood-area=%.0fcm2 fronthair=%.4f brow=%.4f" % (d, a * 1e4, fz, browz))
        if 0.055 <= a <= 0.075 and fz > browz + 0.002: delta, carea, keep = d, a, ks; break
    if delta is None:
        ds = (0.080, 0.075, 0.085, 0.070, 0.090, 0.065); delta = min(ds, key=lambda d: abs(flood(d)[0] - 0.065))
        carea, _, keep = flood(delta)
    print("CHOSEN delta=%.3f flood-faces=%d" % (delta, len(keep)))
    mesh = head.data.copy(); mesh.name = "Flow3_scalp_cap_mesh"
    bm = bmesh.new(); bm.from_mesh(mesh)
    for v in bm.verts: v.co = Mw @ v.co
    bm.faces.ensure_lookup_table()
    for f in list(bm.faces):
        if f.index not in keep: bm.faces.remove(f)
    for v in list(bm.verts):
        if not v.link_faces: bm.verts.remove(v)
    steps = []
    r = bm_stats(bm); steps.append(("coarse-select",) + r[:4]); print("STEP coarse-select v=%d f=%d area=%.1fcm2 comp=%d med=%.2fmm" % (r[0], r[1], r[2] * 1e4, r[3], r[4] * 1000))
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
    r = bm_stats(bm); steps.append(("remove_doubles-1e-5",) + r[:4]); print("STEP remove_doubles-1e-5 v=%d f=%d area=%.1fcm2 comp=%d med=%.2fmm" % (r[0], r[1], r[2] * 1e4, r[3], r[4] * 1000))
    for k in range(6):
        r = bm_stats(bm)
        if r[4] <= 0.0025 or k == 5: break
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1, use_grid_fill=True, use_single_edge=False, use_only_quads=False, smooth=0.0)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
        r = bm_stats(bm); steps.append(("subdiv-%d" % (k + 1),) + r[:4])
        print("STEP subdiv-%d v=%d f=%d area=%.1fcm2 comp=%d med=%.2fmm" % (k + 1, r[0], r[1], r[2] * 1e4, r[3], r[4] * 1000))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    # M11 weld trial: A1 keeps 1e-4 (1e-3 made 3 sliver components, not used).
    weld_recs = []
    r = bm_stats(bm); weld_recs.append((1e-5, r[3], r[0], r[1])); print("WELD dist=0.0000(baseline 1e-5) v=%d f=%d comp=%d" % (r[0], r[1], r[3]))
    for dist in (1e-4,):
        if r[3] == 1: break
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=dist)
        r = bm_stats(bm); weld_recs.append((dist, r[3], r[0], r[1])); print("WELD dist=%.4f v=%d f=%d comp=%d" % (dist, r[0], r[1], r[3]))
    r = bm_stats(bm); steps.append(("triangulate+weld",) + r[:4]); print("STEP triangulate+weld v=%d f=%d area=%.1fcm2 comp=%d med=%.2fmm" % (r[0], r[1], r[2] * 1e4, r[3], r[4] * 1000))
    # D1 component table (post-weld, pre-smooth)
    bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table(); bm.edges.ensure_lookup_table()
    comps = comp_detail(bm)
    print("D1 components=%d" % len(comps))
    pair_lines = []
    for i, c in enumerate(comps):
        lo, hi = c["bbox"]
        print("COMP::%d faces=%d area=%.2fcm2 bbox=[%.4f,%.4f,%.4f]x[%.4f,%.4f,%.4f]" % (i, c["nfaces"], c["area"] * 1e4, lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]))
    pair_d = {}
    for i in range(len(comps)):
        for j in range(i + 1, len(comps)):
            m = pair_mindist(comps[i]["P"], comps[j]["P"]); pair_d[(i, j)] = m
            print("PAIR::%d-%d mindist=%.4fmm" % (i, j, m * 1000))
            pair_lines.append((i, j, m))
    cap = bpy.data.objects.new("Flow3_scalp_cap", mesh); bpy.context.scene.collection.objects.link(cap); cap.matrix_world.identity()
    deps = bpy.context.evaluated_depsgraph_get(); cap.update_tag(); bpy.context.view_layer.update()
    bv = BVHTree.FromObject(head, deps, deform=True, cage=False); ev = head.evaluated_get(deps)
    w2l, l2w = ev.matrix_world.inverted(), ev.matrix_world
    for _ in range(5):  # M8: smooth boundary verts ALONG the boundary (boundary-
        # neighbour average only, so the hairline is not eroded inward), reproject
        bnd_edges = [(e.verts[0], e.verts[1]) for e in bm.edges if len(e.link_faces) == 1]
        bnbr = defaultdict(set)
        for a, b in bnd_edges: bnbr[a].add(b); bnbr[b].add(a)
        bnd = [v for v in bm.verts if v in bnbr]
        new = {v.index: (v.co + sum((w.co for w in bnbr[v]), Vector((0, 0, 0)))) / (len(bnbr[v]) + 1) for v in bnd}
        for v in bnd: v.co = new[v.index]
        for v in bnd:
            hit, _, _, _ = bv.find_nearest(w2l @ v.co)
            if hit is not None: v.co = l2w @ hit
    bm.to_mesh(mesh); mesh.update(); cap.update_tag(); bpy.context.view_layer.update()
    V = np.array([tuple(v.co) for v in mesh.vertices]); F = [tuple(p.vertices) for p in mesh.polygons]
    y0 = float(V[:, 1].min()) - 0.002
    # M14: slit tracked AT SPLIT TIME. Channel cut on the subdivided mesh, so
    # no tracking through subdivision is needed. Deleted faces:
    cut = {i for i, f in enumerate(F) if abs(V[list(f)][:, 0].mean() - cx) < 0.0012 and y0 <= V[list(f)][:, 1].mean() <= apex_y + 0.002}
    # slit verts = kept verts incident to a deleted face, inside a 6 mm strip
    # around x=cx and the split y-range (the two channel edges), recorded now:
    del_verts = set()
    for i in cut:
        for v in F[i]: del_verts.add(v)
    slit_track = sorted(v for v in del_verts
                        if abs(float(V[v][0]) - cx) <= 0.006 and y0 - 0.001 <= float(V[v][1]) <= apex_y + 0.003)
    # compact away verts left faceless by the cut (channel-centre strip verts
    # would otherwise be isolated graph nodes unreachable by Dijkstra: D2/G10)
    Fk = [f for i, f in enumerate(F) if i not in cut]
    used = sorted({v for f in Fk for v in f})
    remap = {old: new for new, old in enumerate(used)}
    Vc = V[used]
    Fc = [tuple(remap[v] for v in f) for f in Fk]
    slit_set = {remap[v] for v in slit_track if v in remap}
    mesh.clear_geometry(); mesh.from_pydata(Vc.tolist(), [], [list(f) for f in Fc]); mesh.update()
    V = np.array([tuple(v.co) for v in mesh.vertices]); F = [tuple(p.vertices) for p in mesh.polygons]
    area = float(sum(0.5 * np.linalg.norm(np.cross(V[b] - V[a], V[c] - V[a])) for a, b, c in F))
    print("POST-SLIT v=%d f=%d area=%.1fcm2 cutfaces=%d slittrack=%d" % (len(V), len(F), area * 1e4, len(cut), len(slit_set)))
    # M14 front slit corners: frontmost channel-mouth vert on each side of x=cx
    cornerL = min((v for v in slit_set if float(V[v][0]) <= cx), key=lambda v: float(V[v][1]), default=None)
    cornerR = min((v for v in slit_set if float(V[v][0]) > cx), key=lambda v: float(V[v][1]), default=None)
    pins = {c for c in (cornerL, cornerR) if c is not None}
    print("M14 slit=%d corners=%s" % (len(slit_set), sorted(pins)))
    # M17: fit the boundary to a smooth closed curve BEFORE phi. 10 passes:
    # boundary verts move toward their 15-point moving average along boundary
    # order, re-projected to the head surface by BVH; only the slit corners
    # pinned. Coords-only, so slit indices stay valid.
    _b0, _g0, _o0, _c0, _a0 = boundary_info(F)
    if _o0 and len(_o0) > 30:
        bmS = bmesh.new(); bmS.from_mesh(mesh); bmS.verts.ensure_lookup_table()
        for ps in range(10):
            P = np.array([tuple(v.co) for v in bmS.verts]); OP = P[_o0]; m = len(_o0)
            avg15 = np.array([np.mean([OP[(k + j) % m] for j in range(-7, 8)], axis=0) for k in range(m)])
            for k, vi in enumerate(_o0):
                if vi in pins: continue
                bmS.verts[vi].co = 0.5 * bmS.verts[vi].co + 0.5 * Vector(avg15[k])
            for vi in _o0:
                if vi in pins: continue
                v = bmS.verts[vi]
                hit, _, _, _ = bv.find_nearest(w2l @ v.co)
                if hit is not None: v.co = l2w @ hit
        bmS.to_mesh(mesh); bmS.free(); mesh.update()
        V = np.array([tuple(v.co) for v in mesh.vertices]); F = [tuple(p.vertices) for p in mesh.polygons]
        area = float(sum(0.5 * np.linalg.norm(np.cross(V[b] - V[a], V[c] - V[a])) for a, b, c in F))
        print("POST-SMOOTH17 v=%d f=%d area=%.1fcm2 passes=10 pins=%d" % (len(V), len(F), area * 1e4, len(pins)))
    import json as J
    bnd_edges, groups, order, cov, badj = boundary_info(F)
    # honest geometric components on final F (numpy, no bmesh index fragility)
    fadj2 = defaultdict(set)
    for f in F:
        for k in range(3):
            a, b = f[k], f[(k + 1) % 3]; fadj2[a].add(b); fadj2[b].add(a)
    seen, ncomp = set(), 0
    for s in fadj2:
        if s in seen: continue
        ncomp += 1; st = [s]; seen.add(s)
        while st:
            x = st.pop()
            for y in fadj2[x]:
                if y not in seen: seen.add(y); st.append(y)
    nloops = len(groups)
    print("LOOPS n=%d sizes=%s order=%d cov=%.3f ncomp=%d" % (nloops, [len(g) for g in groups][:8], len(order), cov, ncomp))
    OP = V[order] if order else np.zeros((0, 3))
    if len(order):
        avg9 = np.array([np.mean([OP[(k + j) % len(OP)] for j in range(-4, 5)], axis=0) for k in range(len(OP))])
        g3 = float(np.abs(OP - avg9).max())
    else: g3 = 9.0
    # M9 temples from boundary verts
    ball = np.array([v for g in groups for v in g]) if groups else np.array([], dtype=int)
    BV = V[ball] if len(ball) else V
    ewd = abs(float(eL[0]) - float(eR[0])); half = 0.5 * ewd * 0.62
    # M9 lateral intent (attempt-2 fix): attempt-1 unconstrained Euclidean snap
    # put both temples on the front hairline (x=+/-13.9mm, 13mm from the part
    # mouth) because brow y (-0.1585) sits ~120mm ahead of the side boundary,
    # so the front hairline always wins nearest-3D-point. Constrain candidates
    # to side boundary verts (|x-cx|>=20mm) so temples sit at the lateral
    # hairline where M9's "lateral brow ends" anatomically are.
    latm = np.abs(BV[:, 0] - cx) >= 0.020
    lat = ball[latm] if latm.any() else ball
    LV = V[lat]
    tL = int(lat[np.linalg.norm(LV - np.array([cx + half, brow[1], brow[2]]), axis=1).argmin()]) if len(lat) else 0
    tR = int(lat[np.linalg.norm(LV - np.array([cx - half, brow[1], brow[2]]), axis=1).argmin()]) if len(lat) else 0
    print("M9-temple lat-candidates=%d (of %d boundary)" % (len(lat), len(ball)))
    # M14 labels: SLIT = tracked split-time set (never sources); FOREHEAD =
    # boundary verts in the temple-to-temple arc containing 0 deg, minus slit;
    # EXIT = all other boundary verts. The three sets are asserted disjoint.
    def azim(p):
        return math.degrees(math.atan2(float(p[0]) - cx, -(float(p[1]) - cy)))
    azL, azR = azim(V[tL]), azim(V[tR])
    lo, hi = min(azL, azR), max(azL, azR)
    contains0 = (lo <= 0 <= hi)
    bset = set(int(v) for v in ball)
    sset0 = set(int(v) for v in slit_set) | set(int(v) for v in pins)
    fore, exl = [], []
    for v in bset:
        if v in sset0: continue
        a = azim(V[v])
        infore = (lo <= a <= hi) if contains0 else (a >= hi or a <= lo)
        (fore if infore else exl).append(v)
    slit = sorted(sset0)
    assert not (set(fore) & sset0) and not (set(exl) & sset0) and not (set(fore) & set(exl)), "M14 sets overlap"
    EXIT = sorted(exl)
    def azrange(ids):
        A = sorted(azim(V[v]) for v in ids) if ids else []
        return (A[0], A[-1]) if A else (float("nan"), float("nan"))
    erng, frng, srng = azrange(EXIT), azrange(fore), azrange(slit)
    print("M14 EXIT=%d az=[%.1f,%.1f] FORE=%d az=[%.1f,%.1f] SLIT=%d az=[%.1f,%.1f] temples az=%.1f,%.1f arc_contains0=%s" % (
        len(EXIT), erng[0], erng[1], len(fore), frng[0], frng[1], len(slit), srng[0], srng[1], azL, azR, contains0))
    print("TEMPLE L id=%d (%.4f,%.4f,%.4f) R id=%d (%.4f,%.4f,%.4f)" % (tL, *V[tL], tR, *V[tR]))
    print("G9-temple dx=%.2f dy=%.2f dz=%.2f mm" % (abs(float(V[tL][0]) + float(V[tR][0]) - 2 * cx) * 1000, abs(float(V[tL][1]) - float(V[tR][1])) * 1000, abs(float(V[tL][2]) - float(V[tR][2])) * 1000))
    E = set()
    for f in F:
        for i in range(3): E.add(tuple(sorted((f[i], f[(i + 1) % 3]))))
    adjw = {i: [] for i in range(len(V))}
    for a, b in E:
        w = float(np.linalg.norm(V[a] - V[b])); adjw[a].append((b, w)); adjw[b].append((a, w))
    # M11 bridges: boundary-vert pairs across FINAL-F components < 3mm.
    # face components on final F (numpy indices, no bmesh fragility)
    edge2f = defaultdict(list)
    for fi, f in enumerate(F):
        for k in range(3):
            edge2f[tuple(sorted((f[k], f[(k + 1) % 3])))].append(fi)
    fseen, fcomp = {}, 0
    for fi in range(len(F)):
        if fi in fseen: continue
        st = [fi]; fseen[fi] = fcomp
        while st:
            x = st.pop(); f = F[x]
            for k in range(3):
                for y in edge2f[tuple(sorted((f[k], f[(k + 1) % 3])))]:
                    if y not in fseen: fseen[y] = fcomp; st.append(y)
        fcomp += 1
    vcomp = np.full(len(V), -1)
    for fi, f in enumerate(F):
        for v in f:
            if vcomp[v] < 0: vcomp[v] = fseen[fi]
    nbridge = 0
    nbridgeskip = 0
    SP = V[sorted(sset0)] if sset0 else np.zeros((0, 3))
    def near_slit(p, r=0.005):
        return len(SP) and bool((np.linalg.norm(SP - p, axis=1) < r).any())
    if fcomp > 1:
        Bc = np.array(sorted(bset)); Bp = V[Bc]; Cb = vcomp[Bc]
        NB = len(Bc)
        CH = 1024
        for i0 in range(0, NB, CH):
            D = np.linalg.norm(Bp[i0:i0 + CH, None, :] - Bp[None, :, :], axis=2)
            ii, jj = np.where((D < 0.003) & (D > 1e-9) & (Cb[i0:i0 + CH, None] != Cb[None, :]))
            for k in range(len(ii)):
                a, b = int(Bc[i0 + ii[k]]), int(Bc[jj[k]])
                if a == b: continue
                # M15: no bridge within 5 mm of the slit (never bridge the part)
                if near_slit(V[a]) or near_slit(V[b]): nbridgeskip += 1; continue
                w = float(D[ii[k], jj[k]])
                adjw[a].append((b, w)); adjw[b].append((a, w)); nbridge += 1
        nbridge //= 2
        print("BRIDGE graph-edges=%d skipped-near-slit=%d (<3mm cross-component boundary pairs)" % (nbridge, nbridgeskip))
    else: print("BRIDGE none needed (1 component)")
    INF = float("inf"); phi = np.full(len(V), INF); ex = set(EXIT)
    for i in ex: phi[i] = 0.0
    hq = [(0.0, i) for i in ex]; heapq.heapify(hq)
    while hq:
        d, x = heapq.heappop(hq)
        if d > phi[x]: continue
        for y, w in adjw[x]:
            nd = d + w
            if nd < phi[y]: phi[y] = nd; heapq.heappush(hq, (nd, y))
    nreach = int(np.isfinite(phi).sum())
    print("REACH %d/%d finite" % (nreach, len(V)))
    unreach = set(int(i) for i in np.where(~np.isfinite(phi))[0])
    if 0 < nreach < len(V):
        phi = np.where(np.isinf(phi), phi[np.isfinite(phi)].max(), phi)
    nbrs = [[y for y, _ in adjw[i]] for i in range(len(V))]
    for _ in range(5):
        phi = np.array([0.0 if i in ex else float(np.mean([phi[j] for j in nbrs[i]])) if nbrs[i] else phi[i] for i in range(len(V))])
    bm2 = bmesh.new(); bm2.from_mesh(mesh); bm2.normal_update(); N = np.array([tuple(v.normal) for v in bm2.verts]); bm2.free()
    G = np.zeros((len(V), 3))
    EA = np.array(list(E)); A0, A1 = EA[:, 0], EA[:, 1]; D = V[A1] - V[A0]; L2 = (D ** 2).sum(axis=1, keepdims=True) + 1e-12
    for sgn, (S, T) in ((1, (A0, A1)), (-1, (A1, A0))):
        Tm = D * sgn; Tv = Tm - (Tm * N[S]).sum(axis=1, keepdims=True) * N[S]; W = (phi[T] - phi[S]) / L2[:, 0]
        np.add.at(G, S, (Tv.T * W).T)
    Gn = np.linalg.norm(G, axis=1); fb = 0
    Fl = np.zeros_like(G)
    for i in range(len(V)):
        if Gn[i] > 1e-12: Fl[i] = -G[i] / Gn[i]
        else: fb += 1; Fl[i] = np.array([1.0 if V[i][0] >= cx else -1.0, 0.0, 0.0])
    amax = int(phi.argmax())
    fset = set(fore); sset = set(slit)
    dfore = np.min(np.linalg.norm(V[:, None, :] - V[fore][None, :, :], axis=2), axis=1) if fore else np.full(len(V), 9.0)
    g5set = Fl[dfore <= 0.015]; g5 = (float((g5set @ face_v).max()) if len(g5set) else 9.0)
    g6m = (np.abs(V[:, 0] - cx) > 0.02) & (V[:, 2] > ear_top); g6 = Fl[g6m]
    g6v = float((np.sign(g6[:, 0]) == np.sign(V[g6m][:, 0] - cx)).mean()) if len(g6) else 0.0
    occ = crown - 0.12; g7m = (V[:, 1] > apex_y + 0.01) & (V[:, 2] < occ); g7 = Fl[g7m]
    g7v = float((g7[:, 2] < 0).mean()) if len(g7) else 0.0
    sinks = sum(1 for i in range(len(V)) if i not in ex and nbrs[i] and all(phi[i] < phi[j] for j in nbrs[i]))
    bedge_len = float(np.mean([np.linalg.norm(V[a] - V[b]) for a, b in bnd_edges])) if bnd_edges else 0.0
    g9t = (abs(float(V[tL][0]) + float(V[tR][0]) - 2 * cx) * 1000, abs(float(V[tL][1]) - float(V[tR][1])) * 1000, abs(float(V[tL][2]) - float(V[tR][2])) * 1000)
    g9 = max(max(g9e) * 1000, max(g9t))
    # G4 restated: slit phi strictly positive everywhere, min >= 30 mm,
    # argmax within 10 mm of x=0
    slitphi = np.array([float(phi[v]) for v in slit]) if slit else np.array([0.0])
    g4min = float(slitphi.min()) if len(slitphi) else 0.0
    g4allpos = bool((slitphi > 0).all()) if len(slitphi) else False
    g4xoff = abs(float(V[amax][0]) - cx) * 1000
    g4 = g4allpos and g4min >= 0.030 and g4xoff <= 10.0
    # G13: verts within 25 mm of the slit and in the front half of the slit:
    # flow leaves the part sideways (|flow.x| >= |flow.y|)
    yslit = np.array([float(V[v][1]) for v in slit]) if slit else np.array([y0, apex_y])
    ymid = float(yslit.min() + 0.5 * (yslit.max() - yslit.min())) if len(yslit) else apex_y
    g13v, g13n = 0.0, 0
    if len(slit):
        SP2 = V[sorted(sset0)]
        dslit = np.min(np.linalg.norm(V[:, None, :] - SP2[None, :, :], axis=2), axis=1)
        g13m = (dslit <= 0.025) & (V[:, 1] <= ymid) & (V[:, 1] >= float(yslit.min()) - 0.001)
        g13m[list(sset0)] = False
        g13n = int(g13m.sum())
        if g13n: g13v = float((np.abs(Fl[g13m][:, 0]) >= np.abs(Fl[g13m][:, 1])).mean())
    print("G4 slitmin=%.1fmm allpos=%s xoff=%.2fmm G13 side=%.1f%% n=%d" % (g4min * 1000, g4allpos, g4xoff, g13v * 100, g13n))
    # G10/G11 (G12 withdrawn per brief D4)
    g10v = 100.0 * nreach / len(V)
    minexit = min((abs(azim(V[v])) for v in EXIT), default=999.0)
    g11 = (len(EXIT) > 0 and len(fore) > 0 and contains0 and minexit >= 20.0)
    print("G10 reach=%.2f%% G11 minexit|az|=%.1f" % (g10v, minexit))
    gates = [
        ("G1", area * 1e4, "[550,750]+2%", (550 <= area * 1e4 <= 750) and abs(area - carea) / carea <= 0.02),
        ("G2", ncomp * 100 + nloops, "101", ncomp == 1 and nloops == 1),
        ("G3", g3 * 1000, "<=3", g3 * 1000 <= 3.0),
        ("G4", g4min * 1000, "slitmin>=30+allpos+xoff<=10", g4),
        ("G5", g5, "<=0.2", g5 <= 0.2), ("G6", g6v * 100, ">=95", g6v >= 0.95), ("G7", g7v * 100, ">=95", g7v >= 0.95), ("G8", sinks, "0", sinks == 0),
        ("G9", g9, "<=5", g9 <= 5.0),
        ("G10", g10v, "100", nreach == len(V)),
        ("G11", float(minexit), "EXIT|az|>=20+forehas0", g11),
        ("G13", g13v * 100, ">=90", g13v >= 0.90 if g13n else False)]
    for g, m, t, p in gates: print("%s::%.4g | %s %s" % (g, m, t, "PASS" if p else "MISS"))
    # region phi colours for SAW (nape = back region by y, not azimuth: the
    # azimuth>150 selection was empty on this head, which printed nan)
    pm, pM = float(phi.min()), float(phi.max())
    def phicol(ids):
        return float(np.mean(phi[ids])) if len(ids) else float("nan")
    backm = V[:, 1] > apex_y + 0.01
    Ecology = {"forehead": phicol(fore), "slit": phicol(slit), "exit": 0.0, "max": pM,
               "above_ear": (float(np.mean(phi[g6m])) if g6m.any() else float("nan")),
               "nape": (float(np.mean(phi[backm & (V[:, 2] < occ)])) if (backm & (V[:, 2] < occ)).any() else float("nan"))}
    print("PHICOL " + str({k: round(v / max(pM, 1e-12), 3) for k, v in Ecology.items()}))
    np.savez(out / "cap.npz", verts=V, faces=np.array(F), phi=phi, flow=Fl, exit=np.array(EXIT), forehead=np.array(fore), slit=np.array(slit), temple=np.array([tL, tR]))
    row = {"slice": "hair-flow-4",
           "P1": {"scale": list(head.scale), "dims": list(head.dimensions), "note": "head is Aisha GLB largest mesh (whole body); landmarks restricted to z>crown-0.26 head-only set"},
           "P2": {"nose": [float(x) for x in nose], "face": face, "note": "face -Y confirmed: nose y %.4f < apex y %.4f" % (float(nose[1]), apex_y)},
           "M6": {"crown": crown, "cx": cx, "cy": cy, "earL": [float(x) for x in eL], "earR": [float(x) for x in eR], "ear_top_z": ear_top, "brow": [float(x) for x in brow]},
           "M11": {"weld_trial": [{"dist_m": d, "components": c, "verts": v, "faces": f} for d, c, v, f in weld_recs], "bridges": nbridge,
                   "components": [{"faces": c["nfaces"], "area_cm2": c["area"] * 1e4, "bbox": [c["bbox"][0].tolist(), c["bbox"][1].tolist()]} for c in comps],
                   "pair_mindist_mm": [{"pair": [i, j], "mm": m * 1000} for i, j, m in pair_lines]},
           "M14": {"exit": len(EXIT), "exit_az": list(erng), "forehead": len(fore), "forehead_az": list(frng), "slit": len(slit), "slit_az": list(srng),
                   "temple_az": [azL, azR], "arc_contains0": bool(contains0), "minexit_absaz": float(minexit),
                   "disjoint": True, "corners": sorted(int(c) for c in pins),
                   "slit_phi_min_m": float(g4min), "slit_phi_allpos": bool(g4allpos), "g13n": int(g13n), "g13frac": float(g13v),
                   "bridges_skipped_near_slit": int(nbridgeskip), "unreachable": sorted(unreach)},
           "delta": delta, "coarse_area_cm2": carea * 1e4, "area_cm2": area * 1e4, "components": ncomp, "loops": nloops, "loop_sizes": [len(g) for g in groups][:8],
           "loop_order": len(order), "loop_cov": cov,
           "steps": [{"op": s[0], "verts": s[1], "faces": s[2], "area_cm2": s[3] * 1e4, "components": s[4]} for s in steps],
           "g3_mm": g3 * 1000, "bedge_mm": bedge_len * 1000, "argmax": {"id": amax, "xoff_mm": abs(float(V[amax][0]) - cx) * 1000, "phi": float(phi[amax])},
           "templeL": {"id": tL, "xyz": [float(x) for x in V[tL]]}, "templeR": {"id": tR, "xyz": [float(x) for x in V[tR]]},
           "counts": {"cap_verts": len(V), "cap_faces": len(F), "boundary": len(bset), "fore": len(fore), "slit": len(slit), "exit": len(EXIT), "g5n": len(g5set), "g6n": len(g6), "g7n": len(g7), "fallback": fb},
           "reach": [nreach, len(V)], "ear_top": ear_top, "occiput_z": occ, "apex": [float(x) for x in apex], "phicol": Ecology,
           "gates": [{"id": g, "measured": float(m) if isinstance(m, (int, float, np.floating)) else m, "threshold": t, "status": "PASS" if p else "MISS"} for g, m, t, p in gates]}
    with (out / "row-flow.json").open("w") as s: J.dump(row, s, indent=2, sort_keys=True); s.write("\n")
    for o in bpy.data.objects:
        if o is not cap and o.type in {"CURVES", "CURVE"}: o.hide_render = o.hide_viewport = True
        if "hair" in o.name.lower() and o is not cap: o.hide_render = o.hide_viewport = True
    mesh.color_attributes.new("PhiCol", "BYTE_COLOR", "POINT")
    ca = mesh.color_attributes["PhiCol"]
    # M16: unreachable/NaN verts BLACK; ramp blue(0)->orange(max) with no
    # skin-coloured value; phi iso-lines every 20 mm darkened (cheap).
    for i in range(len(V)):
        if i in unreach or not np.isfinite(float(phi[i])):
            ca.data[i].color = (0.0, 0.0, 0.0, 1.0); continue
        t = (float(phi[i]) - pm) / max(pM - pm, 1e-12)
        c = (t, 0.20 + 0.25 * t, 1.0 - t, 1.0)  # blue -> orange
        if (float(phi[i]) % 0.020) < 0.0015: c = (c[0] * 0.35, c[1] * 0.35, c[2] * 0.35, 1.0)
        if i in ex: c = (0.1, 0.9, 0.2, 1.0)
        if i in fset: c = (0.95, 0.1, 0.8, 1.0)
        if i in sset: c = (1.0, 1.0, 1.0, 1.0)
        ca.data[i].color = c
    mcap = bpy.data.materials.new("Flow3CapMat"); mcap.use_nodes = True; nt = mcap.node_tree
    nt.nodes.clear(); on = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission")
    at = nt.nodes.new("ShaderNodeVertexColor"); at.layer_name = "PhiCol"; nt.links.new(at.outputs[0], em.inputs[0])
    nt.links.new(em.outputs[0], on.inputs[0]); mesh.materials.clear(); mesh.materials.append(mcap)
    cap.update_tag(); bpy.context.view_layer.update()
    def tube(name, runs, rgb, r):
        runs = [run for run in runs if len(run) >= 1]
        if not runs: return None
        cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = r
        for run in runs:
            if len(run) == 1: run = [run[0], run[0]]
            sp = cu.splines.new("POLY"); sp.points.add(len(run) - 1)
            for k, i in enumerate(run): sp.points[k].co = (float(V[i][0]), float(V[i][1]), float(V[i][2]), 1.0)
            sp.use_cyclic_u = False
        o = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(o)
        m = bpy.data.materials.new(name + "M"); m.use_nodes = True
        e = m.node_tree.nodes.new("ShaderNodeEmission"); e.inputs[0].default_value = (*rgb, 1.0); e.inputs[1].default_value = 3.0
        m.node_tree.links.new(e.outputs[0], m.node_tree.nodes["Material Output"].inputs[0]); o.data.materials.append(m); return o
    # EXIT/FOREHEAD/SLIT runs = true boundary walks (no chords)
    tube("Flow3_EXIT", runs_for(badj, ex) or [sorted(bset)], (0.1, 0.9, 0.2), 0.0012)
    tube("Flow3_FORE", runs_for(badj, fset) or [[tL]], (0.95, 0.1, 0.8), 0.0016)
    sw = sorted(slit, key=lambda i: float(V[i][1])); tube("Flow3_SLIT", runs_for(badj, sset) or [[i for i in sw if V[i][0] <= cx], [i for i in sw if V[i][0] > cx]], (1, 1, 1), 0.0016)
    sel = []
    for i in np.argsort(-V[:, 2]):
        p = V[i]
        if all(np.linalg.norm(p - V[j]) >= 0.010 for j in sel): sel.append(int(i))
        if len(sel) >= 700: break
    av, af = [], []
    for s in sel:
        p, u, nn = V[s] + N[s] * 0.002, Fl[s], N[s]
        w = np.cross(u, nn)
        if np.linalg.norm(w) < 1e-6: w = np.cross(u, np.array([0.0, 0.0, 1.0]))
        if np.linalg.norm(w) < 1e-6: w = np.array([1.0, 0.0, 0.0])
        w = w / np.linalg.norm(w); v2 = np.cross(nn, u); v2 = v2 / (np.linalg.norm(v2) + 1e-12)
        b = len(av)
        for k in range(6):
            a = k / 6 * 2 * math.pi; d = w * math.cos(a) + v2 * math.sin(a)
            av.append(tuple(p + d * 0.0011)); av.append(tuple(p + u * 0.005 + d * 0.0011))
        for k in range(6):
            k2 = (k + 1) % 6; af.append((b + 2 * k, b + 2 * k2, b + 2 * k2 + 1, b + 2 * k + 1))
        hb = len(av); tip = tuple(p + u * 0.008)
        for k in range(6):
            a = k / 6 * 2 * math.pi; d = w * math.cos(a) + v2 * math.sin(a); av.append(tuple(p + u * 0.005 + d * 0.0024))
        av.append(tip)
        for k in range(6): af.append((hb + k, hb + (k + 1) % 6, hb + 6))
    am = bpy.data.meshes.new("Flow3Arrows"); am.from_pydata(av, [], af); am.update()
    ao = bpy.data.objects.new("Flow3Arrows", am); bpy.context.scene.collection.objects.link(ao)
    amat = bpy.data.materials.new("Flow3ArrowM"); amat.use_nodes = True
    am2 = amat.node_tree.nodes["Principled BSDF"]; am2.inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1.0)
    am.materials.append(amat)
    cap.update_tag(); ao.update_tag(); bpy.context.view_layer.update()
    HSET3 = HSET; hmin, hmax = HSET3.min(axis=0), HSET3.max(axis=0)
    HC = (hmin + hmax) / 2; HH = float(hmax[2] - hmin[2])
    dist = (HH / 0.70) / (2 * math.tan(math.atan(18.0 / 50.0)))
    cam = h.camera; sc = bpy.context.scene
    def track(o, t): o.rotation_euler = (Vector(t) - o.location).to_track_quat("-Z", "Y").to_euler()
    views = [("front", HC + np.array([0, -dist, 0.03])), ("three_quarter", HC + np.array([dist * 0.68, -dist * 0.68, 0.15])), ("profile", HC + np.array([dist, 0, 0.03])), ("back", HC + np.array([0, dist, 0.10])), ("top", HC + np.array([0, -0.12, dist]))]
    sc.render.resolution_x = sc.render.resolution_y = 1024; sc.cycles.samples = 16; sc.cycles.seed = 0
    paths = []
    for name, loc in views:
        cam.location = tuple(loc); track(cam, HC); sc.render.filepath = str(out / ("v_" + name + ".png")); bpy.ops.render.render(write_still=True); paths.append(out / ("v_" + name + ".png"))
    from PIL import Image, ImageDraw
    cells = [Image.open(p).convert("RGB") for p in paths]; W, H = cells[0].size; lab = 40
    sheet = Image.new("RGB", (W * 5, H + lab), (20, 20, 20)); dr = ImageDraw.Draw(sheet)
    for k, (c, (vn, _)) in enumerate(zip(cells, views)):
        sheet.paste(c, (k * W, lab)); dr.text((k * W + 10, 8), vn, fill=(255, 255, 0))
    sheet.save(out / "flow-debug.png")
    with (out / "RESULT4.txt").open("w") as s:
        s.write("RESULT::hair-flow-4\n")
        for g, m, t, p in gates: s.write("G%d::%.4g | %s %s\n" % (int(g[1:]), m, t, "PASS" if p else "MISS"))
        s.write("STEPS::" + "; ".join("%s v=%d f=%d area=%.1fcm2 comp=%d" % (x[0], x[1], x[2], x[3] * 1e4, x[4]) for x in steps) + "\n")
        s.write("WELD::" + "; ".join("dist=%.4f comp=%d v=%d f=%d" % w for w in weld_recs) + "\n")
        for i, c in enumerate(comps):
            lo, hi = c["bbox"]
            s.write("D1::COMP %d faces=%d area=%.2fcm2 bbox=[%.4f,%.4f,%.4f]x[%.4f,%.4f,%.4f]\n" % (i, c["nfaces"], c["area"] * 1e4, lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]))
        for i, j, m in pair_lines: s.write("D1::PAIR %d-%d mindist=%.4fmm\n" % (i, j, m * 1000))
        s.write("D1::BRIDGES=%d SKIPPED_NEAR_SLIT=%d\n" % (nbridge, nbridgeskip))
        s.write("M14::EXIT=%d az=[%.1f,%.1f] FOREHEAD=%d az=[%.1f,%.1f] SLIT=%d az=[%.1f,%.1f] temples_az=[%.1f,%.1f] arc_contains0=%s minexit_absaz=%.1f disjoint=True corners=%s slit_phi_min_mm=%.1f slit_allpos=%s\n" % (
            len(EXIT), erng[0], erng[1], len(fore), frng[0], frng[1], len(slit), srng[0], srng[1], azL, azR, contains0, minexit, sorted(int(c) for c in pins), g4min * 1000, g4allpos))
        P = {k: (v / max(pM, 1e-12)) for k, v in Ecology.items()}
        s.write("PHICOL::front_hairline=%.2f part_slit=%.2f above_ear=%.2f nape=%.2f unreachable=%d black_regions=see-SAW\n" % (P["forehead"], P["slit"], P["above_ear"], P["nape"], len(unreach)))
        s.write("SAW::TBD-view\n")
        if all(p for _, _, _, p in gates): s.write("CAUSE(D1)::see D1 table\n")
        else: s.write("CAUSE(D1)::withheld: gates MISS\n")
        s.write("COMMIT::pending\nSTILL::guides/children/hair renders (later cards)\nHARM::none\n")
    print("WROTE", out)
main()
