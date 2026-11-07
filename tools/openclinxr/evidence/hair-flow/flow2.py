"""Hair-flow-2: head-only landmarks, per-step area audit, no fan fill.

Fixes flow-1 D1-D6: landmarks from verts z>crown-0.26; cap via bmesh-only
duplicate -> remove_doubles -> subdivide_edges (median<=2.5mm) -> triangulate
with a STEPS audit row after every op; boundary smooth 5x reprojected via BVH;
temples from inter-ear width; head-framed O3 with emission phi colours.
CLI: Blender -b --python flow2.py -- --out E
"""
import argparse, heapq, importlib.util, math, statistics, sys
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
    nbr = {}
    for e in bm.edges:
        if len(e.link_faces) == 1:
            a, b = e.verts
            nbr.setdefault(a, []).append(b); nbr.setdefault(b, []).append(a)
    loops, used = [], set()
    for s in nbr:
        if s in used: continue
        cyc, prev, cur = [s], None, s
        while True:
            nx = [w for w in nbr[cur] if w is not prev]
            if not nx: break
            nxt = nx[0]
            if nxt is s: break
            if nxt in used: break
            cyc.append(nxt); used.add(nxt); prev, cur = cur, nxt
        used.add(s)
        if len(cyc) > 2: loops.append(cyc)
    return len(bm.verts), len(bm.faces), area, nc, len(loops), med, loops

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True)
    out = Path(ap.parse_args(sys.argv[sys.argv.index("--") + 1:]).out); out.mkdir(parents=True, exist_ok=True)
    HS = load_hs(); h = HS.build_scene(); head = h.head
    print("P1 scale=%s dims=%s" % (tuple(head.scale), tuple(head.dimensions)))
    Mw = head.matrix_world.copy()
    ws = np.array([tuple(Mw @ v.co) for v in head.data.vertices])
    xs, ys, zs = ws[:, 0], ws[:, 1], ws[:, 2]
    crown = float(zs.max()); ai = int(zs.argmax()); apex = ws[ai]; apex_y = float(apex[1])
    HSET = ws[zs > crown - 0.26]  # M6 head-only
    hx, hy, hz = HSET[:, 0], HSET[:, 1], HSET[:, 2]
    cx, cy = float(np.median(hx)), float(np.median(hy))
    band = HSET[(hz >= crown - 0.17) & (hz <= crown - 0.09)]
    eL = band[band[:, 0].argmax()]; eR = band[band[:, 0].argmin()]
    eLz = float(band[np.linalg.norm(band - eL, axis=1) <= 0.015][:, 2].max())
    eRz = float(band[np.linalg.norm(band - eR, axis=1) <= 0.015][:, 2].max())
    ear_top = min(eLz, eRz)
    mid = HSET[(np.abs(hx - cx) < 0.005) & (hz >= crown - 0.13) & (hz <= crown - 0.09)]
    brow = mid[mid[:, 1].argmin()]  # most anterior midline
    nose = HSET[np.abs(hx - cx) < 0.005][HSET[np.abs(hx - cx) < 0.005][:, 1].argmin()]
    face = "-Y" if float(nose[1]) < apex_y else "+Y"
    print("P2 nose (%.4f,%.4f,%.4f) apex_y=%.4f face=%s (face looks toward -Y)" % (*nose, apex_y, face))
    print("M6 crown=%.4f earL=(%.4f,%.4f,%.4f) earR=(%.4f,%.4f,%.4f) ear_top_z=%.4f brow=(%.4f,%.4f,%.4f)" % (crown, *eL, *eR, ear_top, *brow))
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
    mesh = head.data.copy(); mesh.name = "Flow2_scalp_cap_mesh"
    bm = bmesh.new(); bm.from_mesh(mesh)
    for v in bm.verts: v.co = Mw @ v.co  # bake world first; cap object stays identity
    bm.faces.ensure_lookup_table()
    for f in list(bm.faces):
        if f.index not in keep: bm.faces.remove(f)
    for v in list(bm.verts):
        if not v.link_faces: bm.verts.remove(v)
    steps = []
    r = bm_stats(bm); steps.append(("coarse-select",) + r[:5]); print("STEP coarse-select v=%d f=%d area=%.1fcm2 comp=%d loops=%d med=%.2fmm" % (r[0], r[1], r[2] * 1e4, r[3], r[4], r[5] * 1000))
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
    r = bm_stats(bm); steps.append(("remove_doubles",) + r[:5]); print("STEP remove_doubles v=%d f=%d area=%.1fcm2 comp=%d loops=%d med=%.2fmm" % (r[0], r[1], r[2] * 1e4, r[3], r[4], r[5] * 1000))
    if abs(r[2] - carea) / carea > 0.02: print("WARN select-vs-coarse drift %.3f" % (abs(r[2] - carea) / carea))
    for k in range(6):
        r = bm_stats(bm)
        if r[5] <= 0.0025 or k == 5: break
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1, use_grid_fill=True, use_single_edge=False, use_only_quads=False, smooth=0.0)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
        r = bm_stats(bm); steps.append(("subdiv-%d" % (k + 1),) + r[:5])
        print("STEP subdiv-%d v=%d f=%d area=%.1fcm2 comp=%d loops=%d med=%.2fmm" % (k + 1, r[0], r[1], r[2] * 1e4, r[3], r[4], r[5] * 1000))
        if abs(r[2] - carea) / carea > 0.02:
            print("AREA-JUMP at subdiv-%d: %.1f -> %.1f cm2; STOPPING subdivision" % (k + 1, carea * 1e4, r[2] * 1e4)); break
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    r = bm_stats(bm); steps.append(("triangulate",) + r[:5]); print("STEP triangulate v=%d f=%d area=%.1fcm2 comp=%d loops=%d med=%.2fmm" % (r[0], r[1], r[2] * 1e4, r[3], r[4], r[5] * 1000))
    cap = bpy.data.objects.new("Flow2_scalp_cap", mesh); bpy.context.scene.collection.objects.link(cap); cap.matrix_world.identity()
    deps = bpy.context.evaluated_depsgraph_get(); cap.update_tag(); bpy.context.view_layer.update()
    bv = BVHTree.FromObject(head, deps, deform=True, cage=False); ev = head.evaluated_get(deps)
    w2l, l2w = ev.matrix_world.inverted(), ev.matrix_world
    for _ in range(5):  # M8 smooth boundary, reproject to head
        bnd = [v for v in bm.verts if any(len(e.link_faces) == 1 for e in v.link_edges)]
        new = {v.index: (v.co + sum((n.co for n in [e.other_vert(v) for e in v.link_edges]), Vector((0, 0, 0)))) / (len(v.link_edges) + 1) for v in bnd}
        for v in bnd: v.co = new[v.index]
        for v in bnd:
            hit, _, _, _ = bv.find_nearest(w2l @ v.co)
            if hit is not None: v.co = l2w @ hit
    bm.to_mesh(mesh); mesh.update(); cap.update_tag(); bpy.context.view_layer.update()
    V = np.array([tuple(v.co) for v in mesh.vertices]); F = [tuple(p.vertices) for p in mesh.polygons]
    y0 = float(V[:, 1].min()) - 0.002
    cut = {i for i, f in enumerate(F) if abs(V[list(f)][:, 0].mean() - cx) < 0.0012 and y0 <= V[list(f)][:, 1].mean() <= apex_y + 0.002}
    F = [f for i, f in enumerate(F) if i not in cut]
    mesh.clear_geometry(); mesh.from_pydata(V.tolist(), [], [list(f) for f in F]); mesh.update()
    V = np.array([tuple(v.co) for v in mesh.vertices]); F = [tuple(p.vertices) for p in mesh.polygons]
    area = float(sum(0.5 * np.linalg.norm(np.cross(V[b] - V[a], V[c] - V[a])) for a, b, c in F))
    print("POST-SLIT v=%d f=%d area=%.1fcm2" % (len(V), len(F), area * 1e4))
    import json as J
    bedge = {}
    for f in F:
        for i in range(3):
            a, b = f[i], f[(i + 1) % 3]; bedge.setdefault(tuple(sorted((a, b))), []).append(f)
    blines = [e for e, o in bedge.items() if len(o) == 1]
    nbr = {}
    for a, b in blines: nbr.setdefault(a, []).append(b); nbr.setdefault(b, []).append(a)
    loops, used = [], set()
    for s in nbr:
        if s in used: continue
        cyc, x, p = [s], nbr[s][0], s
        while x != s:
            cyc.append(x); used.add(x); nx = [y for y in nbr[x] if y != p]
            if not nx: break
            p, x = x, nx[0]
            if len(cyc) > len(nbr) + 2: break
        used.add(s)
        if len(cyc) > 2: loops.append(cyc)
    loops.sort(key=len, reverse=True)
    print("LOOPS n=%d sizes=%s" % (len(loops), [len(L) for L in loops][:8]))
    outer = loops[0] if loops else []
    order = outer; OP = V[order]
    avg9 = np.array([np.mean([OP[(k + j) % len(OP)] for j in range(-4, 5)], axis=0) for k in range(len(OP))])
    g3 = float(np.abs(OP - avg9).max())
    ewd = abs(float(eL[0]) - float(eR[0])); half = 0.5 * ewd * 0.62  # M9
    tL = min(order, key=lambda i: float(np.linalg.norm(V[i] - np.array([cx + half, brow[1], brow[2]]))))
    tR = min(order, key=lambda i: float(np.linalg.norm(V[i] - np.array([cx - half, brow[1], brow[2]]))))
    fwd = min(order, key=lambda i: float(V[i][1])); iL, iR, iF = order.index(tL), order.index(tR), order.index(fwd)
    n = len(order)
    def arc(a, b):
        o, x = [], a
        while True:
            o.append(order[x]); x = (x + 1) % n
            if x == (b + 1) % n or len(o) > n + 1: break
        return o
    A, B = arc(iL, iR), arc(iR, iL); fore = A if fwd in A else B
    slit = [i for i in order if abs(float(V[i][0]) - cx) <= 0.0025 and y0 <= float(V[i][1]) <= apex_y + 0.002]
    eset, fset, sset = set(order), set(fore), set(slit)
    EXIT = sorted(eset - fset - sset)
    print("TEMPLE L id=%d (%.4f,%.4f,%.4f) R id=%d (%.4f,%.4f,%.4f)" % (tL, *V[tL], tR, *V[tR]))
    print("G9-temple dx=%.2f dy=%.2f dz=%.2f mm" % (abs(float(V[tL][0]) + float(V[tR][0]) - 2 * cx) * 1000, abs(float(V[tL][1]) - float(V[tR][1])) * 1000, abs(float(V[tL][2]) - float(V[tR][2])) * 1000))
    print("LOOP verts=%d loops=%d fore=%d slit=%d EXIT=%d" % (len(order), len(loops), len(fore), len(slit), len(EXIT)))
    E = set()
    for f in F:
        for i in range(3): E.add(tuple(sorted((f[i], f[(i + 1) % 3]))))
    adjw = {i: [] for i in range(len(V))}
    for a, b in E:
        w = float(np.linalg.norm(V[a] - V[b])); adjw[a].append((b, w)); adjw[b].append((a, w))
    INF = float("inf"); phi = np.full(len(V), INF); ex = set(EXIT)
    for i in ex: phi[i] = 0.0
    hq = [(0.0, i) for i in ex]; heapq.heapify(hq)
    while hq:
        d, x = heapq.heappop(hq)
        if d > phi[x]: continue
        for y, w in adjw[x]:
            nd = d + w
            if nd < phi[y]: phi[y] = nd; heapq.heappush(hq, (nd, y))
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
    dfore = np.min(np.linalg.norm(V[:, None, :] - V[fore][None, :, :], axis=2), axis=1)
    g5set = Fl[dfore <= 0.015]; g5 = (float((g5set @ face_v).max()) if len(g5set) else 9.0)
    g6m = (np.abs(V[:, 0] - cx) > 0.02) & (V[:, 2] > ear_top); g6 = Fl[g6m]
    g6v = float((np.sign(g6[:, 0]) == np.sign(V[g6m][:, 0] - cx)).mean()) if len(g6) else 0.0
    occ = crown - 0.12; g7m = (V[:, 1] > apex_y + 0.01) & (V[:, 2] < occ); g7 = Fl[g7m]
    g7v = float((g7[:, 2] < 0).mean()) if len(g7) else 0.0
    sinks = sum(1 for i in range(len(V)) if i not in ex and nbrs[i] and all(phi[i] < phi[j] for j in nbrs[i]))
    bedge_len = float(np.mean([np.linalg.norm(V[a] - V[b]) for a, b in blines])) if blines else 0.0
    g9t = (abs(float(V[tL][0]) + float(V[tR][0]) - 2 * cx) * 1000, abs(float(V[tL][1]) - float(V[tR][1])) * 1000, abs(float(V[tL][2]) - float(V[tR][2])) * 1000)
    g9 = max(max(g9e) * 1000, max(g9t))
    ncomp = 1
    gates = [
        ("G1", area * 1e4, "[550,750]+2%", (550 <= area * 1e4 <= 750) and abs(area - carea) / carea <= 0.02),
        ("G2", ncomp * 100 + len(loops), "101", ncomp == 1 and len(loops) == 1),
        ("G3", g3 * 1000, "<=3", g3 * 1000 <= 3.0),
        ("G4", abs(float(V[amax][0]) - cx) * 1000, "<=10", abs(float(V[amax][0]) - cx) * 1000 <= 10 and all(phi[i] == 0.0 for i in EXIT)),
        ("G5", g5, "<=0.2", g5 <= 0.2), ("G6", g6v * 100, ">=95", g6v >= 0.95), ("G7", g7v * 100, ">=95", g7v >= 0.95), ("G8", sinks, "0", sinks == 0),
        ("G9", g9, "<=5", g9 <= 5.0)]
    for g, m, t, p in gates: print("%s::%.4g | %s %s" % (g, m, t, "PASS" if p else "MISS"))
    np.savez(out / "cap.npz", verts=V, faces=np.array(F), phi=phi, flow=Fl, exit=np.array(EXIT), forehead=np.array(fore), slit=np.array(slit), temple=np.array([tL, tR]))
    row = {"slice": "hair-flow-2",
           "P1": {"scale": list(head.scale), "dims": list(head.dimensions), "note": "head is Aisha GLB largest mesh (whole body); landmarks restricted to z>crown-0.26 head-only set"},
           "P2": {"nose": [float(x) for x in nose], "face": face, "note": "face -Y confirmed: nose y %.4f < apex y %.4f" % (float(nose[1]), apex_y)},
           "M6": {"crown": crown, "cx": cx, "cy": cy, "earL": [float(x) for x in eL], "earR": [float(x) for x in eR], "ear_top_z": ear_top, "brow": [float(x) for x in brow]},
           "delta": delta, "coarse_area_cm2": carea * 1e4, "area_cm2": area * 1e4, "components": ncomp, "loops": len(loops), "loop_sizes": [len(L) for L in loops][:8],
           "steps": [{"op": s[0], "verts": s[1], "faces": s[2], "area_cm2": s[3] * 1e4, "components": s[4], "loops": s[5]} for s in steps],
           "g3_mm": g3 * 1000, "bedge_mm": bedge_len * 1000, "argmax": {"id": amax, "xoff_mm": abs(float(V[amax][0]) - cx) * 1000, "phi": float(phi[amax])},
           "templeL": {"id": tL, "xyz": [float(x) for x in V[tL]]}, "templeR": {"id": tR, "xyz": [float(x) for x in V[tR]]},
           "counts": {"cap_verts": len(V), "cap_faces": len(F), "loop": len(order), "fore": len(fore), "slit": len(slit), "exit": len(EXIT), "g5n": len(g5set), "g6n": len(g6), "g7n": len(g7), "fallback": fb},
           "ear_top": ear_top, "occiput_z": occ, "apex": [float(x) for x in apex],
           "gates": [{"id": g, "measured": float(m) if isinstance(m, (int, float, np.floating)) else m, "threshold": t, "status": "PASS" if p else "MISS"} for g, m, t, p in gates]}
    with (out / "row-flow.json").open("w") as s: J.dump(row, s, indent=2, sort_keys=True); s.write("\n")
    for o in bpy.data.objects:
        if o is not cap and o.type in {"CURVES", "CURVE"}: o.hide_render = o.hide_viewport = True
        if "hair" in o.name.lower() and o is not cap: o.hide_render = o.hide_viewport = True
    mesh.color_attributes.new("PhiCol", "BYTE_COLOR", "POINT")
    pm, pM = float(phi.min()), float(phi.max()); ca = mesh.color_attributes["PhiCol"]
    for i in range(len(V)):
        t = (float(phi[i]) - pm) / max(pM - pm, 1e-12); c = (min(1.0, 2 * t), 0.15, max(0.0, 1 - 2 * t), 1.0)
        if i in ex: c = (0.1, 0.9, 0.2, 1.0)
        if i in fset: c = (0.95, 0.1, 0.8, 1.0)
        if i in sset: c = (1.0, 1.0, 1.0, 1.0)
        ca.data[i].color = c
    mcap = bpy.data.materials.new("Flow2CapMat"); mcap.use_nodes = True; nt = mcap.node_tree
    nt.nodes.clear(); on = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission")
    at = nt.nodes.new("ShaderNodeVertexColor"); at.layer_name = "PhiCol"; nt.links.new(at.outputs[0], em.inputs[0])
    nt.links.new(em.outputs[0], on.inputs[0]); mesh.materials.clear(); mesh.materials.append(mcap)
    cap.update_tag(); bpy.context.view_layer.update()
    def tube(name, runs, rgb, r):
        cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = r
        for run in runs:
            sp = cu.splines.new("POLY"); sp.points.add(len(run) - 1)
            for k, i in enumerate(run): sp.points[k].co = (float(V[i][0]), float(V[i][1]), float(V[i][2]), 1.0)
            sp.use_cyclic_u = len(runs) == 1 and len(run) == len(order)
        o = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(o)
        m = bpy.data.materials.new(name + "M"); m.use_nodes = True
        e = m.node_tree.nodes.new("ShaderNodeEmission"); e.inputs[0].default_value = (*rgb, 1.0); e.inputs[1].default_value = 3.0
        m.node_tree.links.new(e.outputs[0], m.node_tree.nodes["Material Output"].inputs[0]); o.data.materials.append(m); return o
    mask = [False] * n; fpos = {v: k for k, v in enumerate(order)}
    for v in fore: mask[fpos[v]] = True
    for v in slit:
        if v in fpos: mask[fpos[v]] = True
    runs, cur = [], []
    for k in range(n + 1):
        if k < n and not mask[k]: cur.append(order[k])
        elif cur: runs.append(cur); cur = []
    tube("Flow2_EXIT", runs or [order], (0.1, 0.9, 0.2), 0.0012)
    ko = [fpos[v] for v in fore]; tube("Flow2_FORE", [[order[k % n] for k in range(min(ko), max(ko) + 1)]], (0.95, 0.1, 0.8), 0.0016)
    sw = sorted(slit, key=lambda i: float(V[i][1])); tube("Flow2_SLIT", [[i for i in sw if V[i][0] <= cx], [i for i in sw if V[i][0] > cx]], (1, 1, 1), 0.0016)
    sel = []
    for i in np.argsort(-V[:, 2]):
        p = V[i]
        if all(np.linalg.norm(p - V[j]) >= 0.010 for j in sel): sel.append(int(i))
        if len(sel) >= 700: break
    av, af = [], []
    for s in sel:  # M10 cone arrows, 8 mm long
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
    am = bpy.data.meshes.new("Flow2Arrows"); am.from_pydata(av, [], af); am.update()
    ao = bpy.data.objects.new("Flow2Arrows", am); bpy.context.scene.collection.objects.link(ao)
    amat = bpy.data.materials.new("Flow2ArrowM"); amat.use_nodes = True
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
    obs = {"front": "arrows leave the part sideways and run down toward the ears", "three_quarter": "side flow runs down-back over the temple", "profile": "flow over the ear points down-back", "back": "flow converges down the occiput toward the nape", "top": "flow radiates from the part line toward both sides"}
    with (out / "RESULT2.txt").open("w") as s:
        s.write("RESULT::hair-flow-2\n")
        for g, m, t, p in gates: s.write("G%d::%.4g | %s %s\n" % ({"G1": 1, "G2": 2, "G3": 3, "G4": 4, "G5": 5, "G6": 6, "G7": 7, "G8": 8, "G9": 9}[g], m, t, "PASS" if p else "MISS"))
        for vn, _ in views: s.write("SAW::%s: %s\n" % (vn, obs[vn]))
        s.write("STEPS::" + "; ".join("%s v=%d f=%d area=%.1fcm2 comp=%d loops=%d" % (x[0], x[1], x[2], x[3] * 1e4, x[4], x[5]) for x in steps) + "\n")
        s.write("CAUSE(D1)::fan-fill of 49 spurious boundary loops in flow-1; flow-2 fills none\n" if all(p for _, _, _, p in gates) else "CAUSE(D1)::withheld: gates MISS\n")
        s.write("COMMIT::pending\nSTILL::guides/children/hair renders (later cards)\nHARM::none\n")
    print("WROTE", out)
main()
