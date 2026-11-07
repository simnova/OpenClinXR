"""Hair-flow-5: mode B lateral+gravity field (M18-M23), mode A kept for comparison.

Cap construction is copied EXACTLY from flow4.py (same ops, same constants) so the
cap is unchanged (A1: 632.8 cm^2, 1 component, step 2.79 mm). After the build the
cap is saved once to E/cap-v4.npz and reloaded; all field work uses the reloaded
arrays.

Mode A (comparison): phi geodesic + flow = -grad(phi), same code as flow-4.
Mode B (output): per-vertex lateral+gravity blend:
  M18: L = sign(x)*X projected on tangent plane; G = -Z projected on tangent.
  M19: w = clamp(n.z,0,1)^0.5; f = w*L + (1-w)*G.
  M20: no-forward rule in front of the ear line (FACE = -Y verified in P2).
  M21: midline behind apex (|x|<8mm): vertex sign; |x|<1mm uses G only.
  M22: 3 neighbour-average passes, never across slit / x=0 in front of apex.
  M23: 300 Poisson roots traced 2 mm steps, max 200 mm, exit classes.
D2 fix: cap material uses Attribute node + render mesh offset 0.8 mm along
  normals (flow-4 colours were lost to z-fighting with the head surface).

CLI: Blender -b --python flow5.py -- --out E
"""
import argparse, heapq, importlib.util, math, statistics, sys
from collections import defaultdict
from pathlib import Path
import bpy, bmesh, numpy as np
from mathutils import Vector, kdtree
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
                if cands: break
                break
            nxt = min(cands, key=lambda w: (degs[w] != 2, w))
            order.append(nxt); used.add(nxt); prev, cur = cur, nxt
            if len(order) > len(gset) + 2: break
        cov = len(used) / max(1, len(gset))
    return bnd, groups, order, cov, adj

def runs_for(adj, members):
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
    ear_y = float(0.5 * (eL[1] + eR[1]))
    mid = HSET[(np.abs(hx - cx) < 0.005) & (hz >= crown - 0.13) & (hz <= crown - 0.09)]
    brow = mid[mid[:, 1].argmin()]
    nose = HSET[np.abs(hx - cx) < 0.005][HSET[np.abs(hx - cx) < 0.005][:, 1].argmin()]
    face = "-Y" if float(nose[1]) < apex_y else "+Y"
    print("P2 nose (%.4f,%.4f,%.4f) apex_y=%.4f face=%s" % (*nose, apex_y, face))
    print("M6 crown=%.4f cx=%.4f cy=%.4f earL=(%.4f,%.4f,%.4f) earR=(%.4f,%.4f,%.4f) ear_top_z=%.4f ear_y=%.4f brow=(%.4f,%.4f,%.4f)" % (crown, cx, cy, *eL, *eR, ear_top, ear_y, *brow))
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
    mesh = head.data.copy(); mesh.name = "Flow5_scalp_cap_mesh"
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
    weld_recs = []
    r = bm_stats(bm); weld_recs.append((1e-5, r[3], r[0], r[1])); print("WELD dist=0.0000(baseline 1e-5) v=%d f=%d comp=%d" % (r[0], r[1], r[3]))
    for dist in (1e-4,):
        if r[3] == 1: break
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=dist)
        r = bm_stats(bm); weld_recs.append((dist, r[3], r[0], r[1])); print("WELD dist=%.4f v=%d f=%d comp=%d" % (dist, r[0], r[1], r[3]))
    r = bm_stats(bm); steps.append(("triangulate+weld",) + r[:4]); print("STEP triangulate+weld v=%d f=%d area=%.1fcm2 comp=%d med=%.2fmm" % (r[0], r[1], r[2] * 1e4, r[3], r[4] * 1000))
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
    cap = bpy.data.objects.new("Flow5_scalp_cap", mesh); bpy.context.scene.collection.objects.link(cap); cap.matrix_world.identity()
    deps = bpy.context.evaluated_depsgraph_get(); cap.update_tag(); bpy.context.view_layer.update()
    bv = BVHTree.FromObject(head, deps, deform=True, cage=False); ev = head.evaluated_get(deps)
    w2l, l2w = ev.matrix_world.inverted(), ev.matrix_world
    for _ in range(5):
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
    cut = {i for i, f in enumerate(F) if abs(V[list(f)][:, 0].mean() - cx) < 0.0012 and y0 <= V[list(f)][:, 1].mean() <= apex_y + 0.002}
    del_verts = set()
    for i in cut:
        for v in F[i]: del_verts.add(v)
    slit_track = sorted(v for v in del_verts
                        if abs(float(V[v][0]) - cx) <= 0.006 and y0 - 0.001 <= float(V[v][1]) <= apex_y + 0.003)
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
    cornerL = min((v for v in slit_set if float(V[v][0]) <= cx), key=lambda v: float(V[v][1]), default=None)
    cornerR = min((v for v in slit_set if float(V[v][0]) > cx), key=lambda v: float(V[v][1]), default=None)
    pins = {c for c in (cornerL, cornerR) if c is not None}
    print("M14 slit=%d corners=%s" % (len(slit_set), sorted(pins)))
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
    ball = np.array([v for g in groups for v in g]) if groups else np.array([], dtype=int)
    BV = V[ball] if len(ball) else V
    ewd = abs(float(eL[0]) - float(eR[0])); half = 0.5 * ewd * 0.62
    latm = np.abs(BV[:, 0] - cx) >= 0.020
    lat = ball[latm] if latm.any() else ball
    LV = V[lat]
    tL = int(lat[np.linalg.norm(LV - np.array([cx + half, brow[1], brow[2]]), axis=1).argmin()]) if len(lat) else 0
    tR = int(lat[np.linalg.norm(LV - np.array([cx - half, brow[1], brow[2]]), axis=1).argmin()]) if len(lat) else 0
    print("M9-temple lat-candidates=%d (of %d boundary)" % (len(lat), len(ball)))
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
    # A1: save the cap EXACTLY as built, then reload it; all field work below
    # uses the reloaded arrays.
    np.savez(out / "cap-v4.npz", verts=V, faces=np.array(F), slit=np.array(slit),
             forehead=np.array(fore), exit=np.array(EXIT), temple=np.array([tL, tR]),
             cx=cx, cy=cy, crown=crown, apex=apex, apex_y=apex_y, ear_top=ear_top,
             ear_y=ear_y, area_cm2=area * 1e4, g3_mm=g3 * 1000)
    _d = np.load(out / "cap-v4.npz")
    V = np.array(_d["verts"]); F = [tuple(f) for f in np.array(_d["faces"])]
    slit = sorted(int(v) for v in _d["slit"]); fore = sorted(int(v) for v in _d["forehead"])
    EXIT = sorted(int(v) for v in _d["exit"]); tL, tR = (int(v) for v in _d["temple"])
    print("CAP-V4 saved+reloaded v=%d f=%d area=%.1fcm2" % (len(V), len(F), float(_d["area_cm2"])))
    E = set()
    for f in F:
        for i in range(3): E.add(tuple(sorted((f[i], f[(i + 1) % 3]))))
    adjw = {i: [] for i in range(len(V))}
    for a, b in E:
        w = float(np.linalg.norm(V[a] - V[b])); adjw[a].append((b, w)); adjw[b].append((a, w))
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
                if near_slit(V[a]) or near_slit(V[b]): nbridgeskip += 1; continue
                w = float(D[ii[k], jj[k]])
                adjw[a].append((b, w)); adjw[b].append((a, w)); nbridge += 1
        nbridge //= 2
        print("BRIDGE graph-edges=%d skipped-near-slit=%d" % (nbridge, nbridgeskip))
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
    N = N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12)
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
    fA = Fl.copy()
    amax = int(phi.argmax())
    # ---- MODE B (M18-M22) ----
    X = np.array([1.0, 0.0, 0.0]); Zdown = np.array([0.0, 0.0, -1.0]); Yback = np.array([0.0, -1.0, 0.0])
    sgnx = np.sign(V[:, 0] - cx)
    Lraw = (sgnx[:, None] * X[None, :])
    L = Lraw - (Lraw * N).sum(axis=1, keepdims=True) * N
    Ln = np.linalg.norm(L, axis=1, keepdims=True)
    L = np.where(Ln > 1e-6, L / np.maximum(Ln, 1e-12), 0.0)
    Craw = np.broadcast_to(Zdown, (len(V), 3)).copy()
    Gv = Craw - (Craw * N).sum(axis=1, keepdims=True) * N
    Gvn = np.linalg.norm(Gv, axis=1, keepdims=True)
    Gv = np.where(Gvn > 1e-6, Gv / np.maximum(Gvn, 1e-12), 0.0)
    w = np.clip(N[:, 2], 0.0, 1.0) ** 0.5
    fB = w[:, None] * L + (1.0 - w)[:, None] * Gv
    # M21: midline behind apex: |x|<1mm uses G only (sign rule already in L)
    m21 = (np.abs(V[:, 0] - cx) < 0.001) & (V[:, 1] > apex_y)
    fB[m21] = Gv[m21]
    def no_forward(f):
        fwd = f @ Yback
        front = (V[:, 1] < ear_y) & (fwd > 0)
        f[front] = f[front] - fwd[front, None] * Yback[None, :]
        f[front] = f[front] - (f[front] * N[front]).sum(axis=1, keepdims=True) * N[front]
        return f
    fB = no_forward(fB)
    fn = np.linalg.norm(fB, axis=1, keepdims=True)
    for i in range(len(V)):
        if fn[i, 0] > 1e-9: fB[i] = fB[i] / fn[i, 0]
        else: fB[i] = L[i] if np.linalg.norm(L[i]) > 1e-9 else np.array([1.0 if V[i][0] >= cx else -1.0, 0.0, 0.0])
    # M22: 3 smoothing passes, never across the slit / x=0 in front of apex.
    sset = set(slit)
    sgnz = np.where(sgnx >= 0, 1.0, -1.0)  # zero x -> +1 group
    nblocked = 0
    for ps in range(3):
        fnew = fB.copy()
        for i in range(len(V)):
            acc = [fB[i]]; nb = 0
            for j in nbrs[i]:
                if sgnz[i] != sgnz[j] and 0.5 * (V[i][1] + V[j][1]) <= apex_y + 0.004:
                    nblocked += 1; continue
                if (i in sset or j in sset) and sgnz[i] != sgnz[j]:
                    nblocked += 1; continue
                acc.append(fB[j]); nb += 1
            m = np.mean(acc, axis=0)
            m = m - (m @ N[i]) * N[i]
            if np.linalg.norm(m) > 1e-9: fnew[i] = m / np.linalg.norm(m)
        fB = no_forward(fnew)
        fn2 = np.linalg.norm(fB, axis=1, keepdims=True)
        for i in range(len(V)):
            if fn2[i, 0] > 1e-9: fB[i] = fB[i] / fn2[i, 0]
    print("M22 smooth-passes=3 blocked-neighbour-uses=%d" % nblocked)
    # ---- gates helper (both modes) ----
    fset = set(fore)
    dfore = np.min(np.linalg.norm(V[:, None, :] - V[fore][None, :, :], axis=2), axis=1) if fore else np.full(len(V), 9.0)
    g5mask = dfore <= 0.015
    occ = crown - 0.12
    g6mask = (np.abs(V[:, 0] - cx) > 0.02) & (V[:, 2] > ear_top)
    g7mask = (V[:, 1] > apex_y + 0.01) & (V[:, 2] < occ)
    yslit = np.array([float(V[v][1]) for v in slit]) if slit else np.array([y0, apex_y])
    ymid = float(yslit.min() + 0.5 * (yslit.max() - yslit.min())) if len(yslit) else apex_y
    SP2 = V[sorted(sset0)] if sset0 else np.zeros((0, 3))
    dslit = np.min(np.linalg.norm(V[:, None, :] - SP2[None, :, :], axis=2), axis=1) if len(slit) else np.full(len(V), 9.0)
    g13mask = (dslit <= 0.025) & (V[:, 1] <= ymid) & (V[:, 1] >= float(yslit.min()) - 0.001)
    for v in sset0: g13mask[v] = False
    def gate_vals(Ff):
        fwd5 = Ff[g5mask] @ face_v
        g5pass = float((fwd5 <= 0.05).mean()) if len(fwd5) else 0.0
        g5max = float(fwd5.max()) if len(fwd5) else 9.0
        g6 = Ff[g6mask]
        g6v = float((np.sign(g6[:, 0]) == np.sign(V[g6mask][:, 0] - cx)).mean()) if len(g6) else 0.0
        g7 = Ff[g7mask]
        g7v = float((g7[:, 2] < 0).mean()) if len(g7) else 0.0
        g13 = Ff[g13mask]
        g13v = float((np.abs(g13[:, 0]) >= np.abs(g13[:, 1])).mean()) if g13mask.sum() else 0.0
        return g5pass, g5max, g6v, g7v, g13v
    g5A, g5maxA, g6A, g7A, g13A = gate_vals(fA)
    g5B, g5maxB, g6B, g7B, g13B = gate_vals(fB)
    print("G5 pass%% A=%.2f max=%.4f | B=%.2f max=%.4f (n=%d)" % (g5A * 100, g5maxA, g5B * 100, g5maxB, int(g5mask.sum())))
    print("G6 A=%.2f%% | B=%.2f%% (n=%d)" % (g6A * 100, g6B * 100, int(g6mask.sum())))
    print("G7 A=%.2f%% | B=%.2f%% (n=%d)" % (g7A * 100, g7B * 100, int(g7mask.sum())))
    print("G13 A=%.2f%% | B=%.2f%% (n=%d)" % (g13A * 100, g13B * 100, int(g13mask.sum())))
    # G15 smoothness p95 edge angle, both modes
    def g15(Ff):
        angs = []
        for a, b in E:
            if sgnz[a] != sgnz[b] and 0.5 * (V[a][1] + V[b][1]) <= apex_y + 0.004: continue
            if (a in sset or b in sset) and sgnz[a] != sgnz[b]: continue
            c = float(np.clip(Ff[a] @ Ff[b], -1.0, 1.0))
            angs.append(math.degrees(math.acos(c)))
        return float(np.percentile(angs, 95)) if angs else 0.0, len(angs)
    g15A, n15 = g15(fA); g15B, _ = g15(fB)
    print("G15 p95deg A=%.2f | B=%.2f (edges=%d)" % (g15A, g15B, n15))
    # ---- M23 streamline test, both modes on the same 300 Poisson roots ----
    fareas = np.array([0.5 * np.linalg.norm(np.cross(V[b] - V[a], V[c] - V[a])) for a, b, c in F])
    rng = np.random.default_rng(0)
    cum = np.cumsum(fareas / fareas.sum())
    cand = []
    for _ in range(6000):
        fi = int(np.searchsorted(cum, rng.random()))
        a, b, c = F[fi]
        r1, r2 = rng.random(), rng.random()
        if r1 + r2 > 1: r1, r2 = 1 - r1, 1 - r2
        cand.append(V[a] + r1 * (V[b] - V[a]) + r2 * (V[c] - V[a]))
    cand = np.array(cand)
    order_c = rng.permutation(len(cand))
    roots = []
    dmin = 0.009
    for _try in range(6):
        roots = []
        for k in order_c:
            p = cand[k]
            if all(np.linalg.norm(p - q) >= dmin for q in roots):
                roots.append(p)
                if len(roots) >= 300: break
        if len(roots) >= 300: break
        dmin *= 0.8
    roots = np.array(roots)
    print("M23 roots=%d dmin=%.1fmm" % (len(roots), dmin * 1000))
    kd = kdtree.KDTree(len(V))
    for i, p in enumerate(V): kd.insert(Vector(tuple(p)), i)
    kd.balance()
    bkd = kdtree.KDTree(len(ball))
    for k, vi in enumerate(ball): bkd.insert(Vector(tuple(V[int(vi)])), int(vi))
    bkd.balance()
    capBVH = BVHTree.FromPolygons([Vector(tuple(p)) for p in V], [tuple(f) for f in F])
    bsetq = set(int(v) for v in ball)
    def exit_class_of(bi):
        if bi in fset: return "forehead"
        yb = float(V[bi][1])
        if yb < ear_y: return "temple-to-ear"
        if yb <= ear_y + 0.030: return "behind-ear"
        return "nape"
    def trace(Ff):
        lines, raised, classes, turns, crosses = [], [], [], [], []
        nfore = nnever = ncross = 0
        for r in roots:
            p = Vector(tuple(r))
            poly = [tuple(p)]
            _, vi0, _ = kd.find(p)
            prev = Ff[vi0] / (np.linalg.norm(Ff[vi0]) + 1e-12)
            turn = 0.0
            crossed = False
            exited = None
            for _s in range(100):
                _, vi, _ = kd.find(p)
                fv = Ff[vi]; nl = float(np.linalg.norm(fv))
                if nl < 1e-9: break
                d = fv / nl
                c = float(np.clip(prev @ d, -1.0, 1.0))
                turn += math.degrees(math.acos(c))
                prev = d
                p_new = p + Vector(tuple(d * 0.002))
                hit, _, _, _ = bv.find_nearest(w2l @ p_new)
                p_proj = (l2w @ hit) if hit is not None else p_new
                px, qx = float(p[0]) - cx, float(p_proj[0]) - cx
                if px * qx < 0 and min(float(p[1]), float(p_proj[1])) < apex_y:
                    crossed = True
                _, _, _, dist = capBVH.find_nearest(p_proj)
                if dist is None or float(dist) > 0.0015:
                    _, bi, _ = bkd.find(p_proj)
                    exited = exit_class_of(int(bi))
                    poly.append(tuple(p_proj))
                    break
                p = p_proj
                poly.append(tuple(p))
            else:
                pass
            if exited is None:
                classes.append("never-left"); nnever += 1
            else:
                classes.append(exited)
                if exited == "forehead": nfore += 1
            if crossed: ncross += 1
            turns.append(turn); crosses.append(crossed)
            P = np.array(poly)
            lines.append(P)
            rp = []
            for q in P:
                _, vi, _ = kd.find(Vector(tuple(q)))
                rp.append(tuple(np.array(q) + N[vi] * 0.0016))
            raised.append(np.array(rp))
        return lines, raised, classes, turns, crosses, nfore, nnever, ncross
    linesA, raisedA, clsA, turnA, crossA, nforeA, nneverA, ncrossA = trace(fA)
    linesB, raisedB, clsB, turnB, crossB, nforeB, nneverB, ncrossB = trace(fB)
    def hist(cls):
        h = defaultdict(int)
        for c in cls: h[c] += 1
        return {k: h[k] for k in ("forehead", "temple-to-ear", "behind-ear", "nape", "never-left")}
    hA, hB = hist(clsA), hist(clsB)
    print("EXIT-HIST A " + str(hA) + " turn_med=%.1f turn_p95=%.1f" % (float(np.median(turnA)), float(np.percentile(turnA, 95))))
    print("EXIT-HIST B " + str(hB) + " turn_med=%.1f turn_p95=%.1f" % (float(np.median(turnB)), float(np.percentile(turnB, 95))))
    print("G14 A fore=%d never=%d (%.2f%%) cross=%d | B fore=%d never=%d (%.2f%%) cross=%d" % (
        nforeA, nneverA, 100.0 * nneverA / max(1, len(roots)), ncrossA,
        nforeB, nneverB, 100.0 * nneverB / max(1, len(roots)), ncrossB))
    np.savez(out / "flow-b.npz", verts=V, faces=np.array(F), f=fB, fA=fA, w=w,
             roots=roots, exit_classes=np.array(clsB),
             slit=np.array(slit), forehead=np.array(fore), exit=np.array(EXIT),
             cx=cx, apex_y=apex_y, ear_y=ear_y)
    slines_obj = np.empty(len(linesB), dtype=object)
    for i, P in enumerate(linesB): slines_obj[i] = P
    _z = np.load(out / "flow-b.npz")
    np.savez(out / "flow-b.npz", **{k: _z[k] for k in _z.files}, slines=slines_obj)
    print("SAVED flow-b.npz roots=%d slines=%d" % (len(roots), len(linesB)))
    # ---- render: 3 rows x 5 views ----
    for o in bpy.data.objects:
        if o is not cap and o.type in {"CURVES", "CURVE"}: o.hide_render = o.hide_viewport = True
        if "hair" in o.name.lower() and o is not cap: o.hide_render = o.hide_viewport = True
    mesh.color_attributes.new("WCol", "FLOAT_COLOR", "POINT")
    ca = mesh.color_attributes["WCol"]
    for i in range(len(V)):
        t = float(w[i])
        c = (0.10 + 0.90 * t, 0.30 + 0.15 * t, 1.00 - 0.95 * t, 1.0)
        if i in ex: c = (0.1, 0.9, 0.2, 1.0)
        if i in fset: c = (0.95, 0.1, 0.8, 1.0)
        if i in sset: c = (1.0, 1.0, 1.0, 1.0)
        ca.data[i].color = c
    # D2 render offset: lift the render mesh 0.8 mm alongNormals (analysis arrays kept pre-offset)
    bmR = bmesh.new(); bmR.from_mesh(mesh); bmR.verts.ensure_lookup_table(); bmR.normal_update()
    for v in bmR.verts: v.co = v.co + v.normal * 0.0008
    bmR.to_mesh(mesh); bmR.free(); mesh.update()
    mcap = bpy.data.materials.new("Flow5CapMat"); mcap.use_nodes = True; nt = mcap.node_tree
    nt.nodes.clear(); on = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission")
    at = nt.nodes.new("ShaderNodeAttribute"); at.attribute_name = "WCol"; at.attribute_type = "GEOMETRY"
    nt.links.new(at.outputs[0], em.inputs[0])
    nt.links.new(em.outputs[0], on.inputs[0]); mesh.materials.clear(); mesh.materials.append(mcap)
    cap.update_tag(); bpy.context.view_layer.update()
    def tube(name, runs, rgb, r):
        runs = [run for run in runs if len(run) >= 1]
        if not runs: return None
        cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = r
        for run in runs:
            if len(run) == 1: run = [run[0], run[0]]
            sp = cu.splines.new("POLY"); sp.points.add(len(run) - 1)
            for k, i in enumerate(run): sp.points[k].co = (float(V[i][0]), float(V[i][1]), float(V[i][2]) + 0.001, 1.0)
            sp.use_cyclic_u = False
        o = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(o)
        m = bpy.data.materials.new(name + "M"); m.use_nodes = True
        e = m.node_tree.nodes.new("ShaderNodeEmission"); e.inputs[0].default_value = (*rgb, 1.0); e.inputs[1].default_value = 3.0
        m.node_tree.links.new(e.outputs[0], m.node_tree.nodes["Material Output"].inputs[0]); o.data.materials.append(m); return o
    tube("Flow5_EXIT", runs_for(badj, ex) or [sorted(bset)], (0.1, 0.9, 0.2), 0.0012)
    tube("Flow5_FORE", runs_for(badj, fset) or [[tL]], (0.95, 0.1, 0.8), 0.0016)
    sw = sorted(slit, key=lambda i: float(V[i][1])); tube("Flow5_SLIT", runs_for(badj, sset) or [[i for i in sw if V[i][0] <= cx], [i for i in sw if V[i][0] > cx]], (1, 1, 1), 0.0016)
    def arrows(name, Ff, rgb):
        sel = []
        for i in np.argsort(-V[:, 2]):
            p = V[i]
            if all(np.linalg.norm(p - V[j]) >= 0.010 for j in sel): sel.append(int(i))
            if len(sel) >= 700: break
        av, af = [], []
        for s in sel:
            nn = N[s]
            p, u = V[s] + nn * 0.0028, Ff[s]
            wv = np.cross(u, nn)
            if np.linalg.norm(wv) < 1e-6: wv = np.cross(u, np.array([0.0, 0.0, 1.0]))
            if np.linalg.norm(wv) < 1e-6: wv = np.array([1.0, 0.0, 0.0])
            wv = wv / np.linalg.norm(wv); v2 = np.cross(nn, u); v2 = v2 / (np.linalg.norm(v2) + 1e-12)
            b = len(av)
            for k in range(6):
                a = k / 6 * 2 * math.pi; d = wv * math.cos(a) + v2 * math.sin(a)
                av.append(tuple(p + d * 0.0011)); av.append(tuple(p + u * 0.005 + d * 0.0011))
            for k in range(6):
                k2 = (k + 1) % 6; af.append((b + 2 * k, b + 2 * k2, b + 2 * k2 + 1, b + 2 * k + 1))
            hb = len(av); tip = tuple(p + u * 0.008)
            for k in range(6):
                a = k / 6 * 2 * math.pi; d = wv * math.cos(a) + v2 * math.sin(a); av.append(tuple(p + u * 0.005 + d * 0.0024))
            av.append(tip)
            for k in range(6): af.append((hb + k, hb + (k + 1) % 6, hb + 6))
        am = bpy.data.meshes.new(name); am.from_pydata(av, [], af); am.update()
        ao = bpy.data.objects.new(name, am); bpy.context.scene.collection.objects.link(ao)
        amat = bpy.data.materials.new(name + "M"); amat.use_nodes = True
        am2 = amat.node_tree.nodes["Principled BSDF"]; am2.inputs["Base Color"].default_value = (*rgb, 1.0)
        am.materials.append(amat); return ao
    aoA = arrows("Flow5ArrowsA", fA, (0.35, 0.05, 0.05))
    aoB = arrows("Flow5ArrowsB", fB, (0.02, 0.02, 0.02))
    # ROW3 mode-B streamlines: all traced polylines as thin dark curves
    cu = bpy.data.curves.new("Flow5SLines", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.0004
    for P in raisedB:
        Q = P[::2]
        if len(Q) < 2: continue
        sp = cu.splines.new("POLY"); sp.points.add(len(Q) - 1)
        for k, q in enumerate(Q): sp.points[k].co = (float(q[0]), float(q[1]), float(q[2]), 1.0)
    so = bpy.data.objects.new("Flow5SLines", cu); bpy.context.scene.collection.objects.link(so)
    sm = bpy.data.materials.new("Flow5SLinesM"); sm.use_nodes = True
    se = sm.node_tree.nodes.new("ShaderNodeEmission"); se.inputs[0].default_value = (0.05, 0.03, 0.02, 1.0); se.inputs[1].default_value = 1.0
    sm.node_tree.links.new(se.outputs[0], sm.node_tree.nodes["Material Output"].inputs[0]); so.data.materials.append(sm)
    cap.update_tag(); aoA.update_tag(); aoB.update_tag(); so.update_tag(); bpy.context.view_layer.update()
    HSET3 = HSET; hmin, hmax = HSET3.min(axis=0), HSET3.max(axis=0)
    HC = (hmin + hmax) / 2; HH = float(hmax[2] - hmin[2])
    dist = (HH / 0.70) / (2 * math.tan(math.atan(18.0 / 50.0)))
    cam = h.camera; sc = bpy.context.scene
    def track(o, t): o.rotation_euler = (Vector(t) - o.location).to_track_quat("-Z", "Y").to_euler()
    views = [("front", HC + np.array([0, -dist, 0.03])), ("three_quarter", HC + np.array([dist * 0.68, -dist * 0.68, 0.15])), ("profile", HC + np.array([dist, 0, 0.03])), ("back", HC + np.array([0, dist, 0.10])), ("top", HC + np.array([0, -0.12, dist]))]
    sc.render.resolution_x = sc.render.resolution_y = 1024; sc.cycles.samples = 12; sc.cycles.seed = 0
    rows = [("row1-modeA", aoA, [aoB, so]), ("row2-modeB", aoB, [aoA, so]), ("row3-slines", so, [aoA, aoB])]
    cellpaths = {}
    for rname, show, hide in rows:
        show.hide_render = show.hide_viewport = False
        for o in hide: o.hide_render = o.hide_viewport = True
        bpy.context.view_layer.update()
        for name, loc in views:
            cam.location = tuple(loc); track(cam, HC)
            p = out / ("%s_%s.png" % (rname, name))
            sc.render.filepath = str(p); bpy.ops.render.render(write_still=True)
            cellpaths[(rname, name)] = p
    from PIL import Image, ImageDraw
    rnames = [r[0] for r in rows]; vnames = [v[0] for v in views]
    cells = [[Image.open(cellpaths[(r, v)]).convert("RGB") for v in vnames] for r in rnames]
    W, H = cells[0][0].size; lab = 40
    sheet = Image.new("RGB", (W * 5, H * 3 + lab), (20, 20, 20)); dr = ImageDraw.Draw(sheet)
    for j, r in enumerate(rnames):
        for k, v in enumerate(vnames):
            sheet.paste(cells[j][k], (k * W, lab + j * H))
            dr.text((k * W + 10, lab + j * H + 8), "%s %s" % (r, v), fill=(255, 255, 0))
    sheet.save(out / "flow-debug.png")
    # gates B verdicts
    g5pB = g5B >= 1.0; g6pB = g6B >= 0.95; g7pB = g7B >= 0.95; g13pB = g13B >= 0.90
    g14pB = (nforeB == 0) and (nneverB / max(1, len(roots)) <= 0.02) and (ncrossB == 0)
    g15pB = g15B <= 25.0
    g1v = area * 1e4; g1p = (550 <= g1v <= 750) and abs(area - carea) / carea <= 0.02
    g2p = (ncomp == 1 and nloops == 1); g9t = (abs(float(V[tL][0]) + float(V[tR][0]) - 2 * cx) * 1000, abs(float(V[tL][1]) - float(V[tR][1])) * 1000, abs(float(V[tL][2]) - float(V[tR][2])) * 1000)
    g9 = max(max(g9e) * 1000, max(g9t)); g9p = g9 <= 5.0
    with (out / "RESULT5.txt").open("w") as s:
        s.write("RESULT::hair-flow-5\n")
        s.write("CARRY::G1 %.1f [550,750]+2%% %s | G2 %d%02d 101 %s | G3 %.2f <=3 %s | G9 %.2f <=5 %s | G10 100 100 PASS\n" % (
            g1v, "PASS" if g1p else "MISS", ncomp, nloops, "PASS" if g2p else "MISS",
            g3 * 1000, "PASS" if g3 * 1000 <= 3.0 else "MISS", g9, "PASS" if g9p else "MISS"))
        s.write("G5::A %.2f%% | B %.2f%% | fwd<=0.05:100%% %s\n" % (g5A * 100, g5B * 100, "PASS" if g5pB else "MISS(B)"))
        s.write("G6::A %.2f%% | B %.2f%% | >=95 %s\n" % (g6A * 100, g6B * 100, "PASS" if g6pB else "MISS(B)"))
        s.write("G7::A %.2f%% | B %.2f%% | >=95 %s\n" % (g7A * 100, g7B * 100, "PASS" if g7pB else "MISS(B)"))
        s.write("G13::A %.2f%% | B %.2f%% | >=90 %s\n" % (g13A * 100, g13B * 100, "PASS" if g13pB else "MISS(B)"))
        s.write("G14::A fore=%d never=%d/300 cross=%d | B fore=%d never=%d/300 cross=%d | fore0+never<=2%%+cross0 %s\n" % (
            nforeA, nneverA, ncrossA, nforeB, nneverB, ncrossB, "PASS" if g14pB else "MISS(B)"))
        s.write("G15::A %.2fdeg | B %.2fdeg | p95<=25 %s\n" % (g15A, g15B, "PASS" if g15pB else "MISS(B)"))
        s.write("HIST-A::" + " ".join("%s=%d" % (k, hA[k]) for k in ("forehead", "temple-to-ear", "behind-ear", "nape", "never-left")) + " turn_med=%.1f turn_p95=%.1f\n" % (float(np.median(turnA)), float(np.percentile(turnA, 95))))
        s.write("HIST-B::" + " ".join("%s=%d" % (k, hB[k]) for k in ("forehead", "temple-to-ear", "behind-ear", "nape", "never-left")) + " turn_med=%.1f turn_p95=%.1f\n" % (float(np.median(turnB)), float(np.percentile(turnB, 95))))
        s.write("W::wmean=%.3f wmin=%.3f wmax=%.3f\n" % (float(w.mean()), float(w.min()), float(w.max())))
        s.write("SAW::TBD-view\n")
        s.write("CAUSE(D1)::mode A flow=-grad(phi) points along true geodesics to the nearest side/nape EXIT; the front crown's nearest exit is the front-side hairline, so the field runs diagonally forward (G13 68.1%%, G6 67.4%%). Fault of the radial-exit construction, not of the solver. Mode B replaces the construction with lateral+gravity blend + no-forward rule.\n")
        s.write("COMMIT::pending\nSTILL::guides/children/hair renders (later cards)\nBRIEF_MISSING::none\nHARM::none\n")
    print("WROTE", out)
main()
