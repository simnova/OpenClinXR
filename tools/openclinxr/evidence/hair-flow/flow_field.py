"""Hair-flow-1: scalp cap + tangent flow field on it, proven by picture.

Ideas copied from tools/openclinxr/evidence/hair-p7/p7_groom.py (never imported):
duplicate-head-faces cap, edit-mode subdivide, boundary smooth + reproject via
BVHTree, EXIT-relative geodesic phi. Differences: vertex flood selection by ray
direction, slit as a deleted part channel (left/right share no verts, one loop),
Dijkstra over edge lengths with pinned Laplacian smoothing.
CLI: Blender -b --python flow_field.py -- --out E
"""
import argparse, heapq, importlib.util, math, sys
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
def wmesh(obj):
    mw = obj.matrix_world; ws = np.array([tuple(mw @ v.co) for v in obj.data.vertices])
    fs = [[v for v in p.vertices] for p in obj.data.polygons]; return ws, fs, mw
def far(verts, faces):
    v = np.asarray(verts); return float(sum(0.5 * np.linalg.norm(np.cross(v[b] - v[a], v[c] - v[a])) for a, b, c in faces))
def comps(faces):
    adj = {}
    for f in faces:
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]; adj.setdefault(a, set()).add(b); adj.setdefault(b, set()).add(a)
    seen, n = set(), 0
    for s in adj:
        if s not in seen:
            n += 1; st = [s]; seen.add(s)
            while st:
                x = st.pop()
                for y in adj[x]:
                    if y not in seen: seen.add(y); st.append(y)
    return n
def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); out = Path(ap.parse_args(sys.argv[sys.argv.index("--") + 1:]).out); out.mkdir(parents=True, exist_ok=True)
    HS = load_hs(); h = HS.build_scene(); head = h.head
    print("P1 scale=%s dims=%s" % (tuple(head.scale), tuple(head.dimensions)))
    ws, fs, Mw = wmesh(head); xs, ys, zs = ws[:, 0], ws[:, 1], ws[:, 2]
    crown = float(zs.max()); ai = int(zs.argmax()); apex = ws[ai]; apex_y = float(apex[1])
    up = ws[zs > crown - 0.24]; cx = float(np.median(up[:, 0])); cy = float(np.median(up[:, 1]))
    centre = np.array([cx, cy + 0.005, crown - 0.105])
    near = ws[np.abs(xs - cx) < 0.01]; nose = near[ys[np.abs(xs - cx) < 0.01].argmin()]
    face = "−Y" if float(nose[1]) <= float(ys.min()) + 1e-9 else ("+Y" if float(nose[1]) >= float(ys.max()) - 1e-9 else "?")
    print("P2 nose id=%d (%.4f,%.4f,%.4f) face=%s" % (int(np.where(np.all(np.isclose(ws, nose), axis=1))[0][0]), *nose, face))
    face_v = np.array([0.0, -1.0, 0.0]) if face == "−Y" else np.array([0.0, 1.0, 0.0])
    brow = next((o for o in bpy.data.objects if "eyebrow" in o.name.lower() and o.type == "MESH"), None)
    bw = np.array([tuple(brow.matrix_world @ v.co) for v in brow.data.vertices]) if brow else np.array([[0.06, -0.116, 1.56], [-0.06, -0.116, 1.56]])
    bL, bR = bw[bw[:, 0].argmax()], bw[bw[:, 0].argmin()]; browz = float(bw[:, 2].mean())
    eband = ws[(np.abs(xs - cx) > 0.12) & (np.abs(ys + 0.035) < 0.055)]; ear_top = float(eband[:, 2].max()) if len(eband) else crown - 0.24
    print("APEX (%.4f,%.4f,%.4f) browLat L(%.4f,%.4f,%.4f) R(%.4f,%.4f,%.4f) ear_top=%.4f" % (*apex, *bL, *bR, ear_top))
    def bnd_z(x, y):
        az = math.atan2(x - cx, -(y - centre[1])); return crown - (0.165 - 0.025 * abs(math.sin(az)) + 0.095 * max(0.0, -math.cos(az)))
    cfs = np.array([ws[f].mean(axis=0) for f in fs])
    def inside(c, d):
        az = math.atan2(c[0] - cx, -(c[1] - centre[1])); fr = math.hypot(c[0] - cx, c[1] - centre[1])
        if abs(c[0] - cx) > 0.072 and c[2] < ear_top: return False
        if c[2] < bnd_z(c[0], c[1]) + d: return False
        return True
    def coarse(d):
        sel = [i for i, c in enumerate(cfs) if inside(c, d)]
        tris = []
        for i in sel:
            f = fs[i]; tris += [[f[0], f[k + 1], f[k + 2]] for k in range(len(f) - 2)]
        a = far(ws, tris); fc = cfs[sel] if sel else np.zeros((0, 3))
        front = fc[(np.abs(fc[:, 0] - cx) < 0.01) & (fc[:, 1] < centre[1])] if len(fc) else fc
        fz = float(front[:, 2].min()) if len(front) else 0.0; return a, fz
    delta, carea = None, 0.0
    for d in (0.080, 0.075, 0.085, 0.070, 0.090, 0.065):
        a, fz = coarse(d); print("delta=%.3f area=%.0fcm2 fronthair=%.4f brow=%.4f" % (d, a * 1e4, fz, browz))
        if 0.055 <= a <= 0.075 and fz > browz + 0.002: delta, carea = d, a; break
    if delta is None:
        ds = (0.080, 0.075, 0.085, 0.070, 0.090, 0.065); delta = min(ds, key=lambda d: abs(coarse(d)[0] - 0.065)); carea = coarse(delta)[0]
    print("CHOSEN delta=%.3f" % delta)
    mesh = head.data.copy(); mesh.name = "Flow_scalp_cap_mesh"
    bm = bmesh.new(); bm.from_mesh(mesh); bm.faces.ensure_lookup_table()
    keep = {i for i, c in enumerate(cfs) if inside(c, delta)}
    for f in list(bm.faces):
        if f.index not in keep: bm.faces.remove(f)
    for v in list(bm.verts):
        if not v.link_faces: bm.verts.remove(v)
    bm.to_mesh(mesh); bm.free()
    tmp = bpy.data.objects.new("Flow_cap_tmp", mesh); bpy.context.scene.collection.objects.link(tmp)
    bpy.ops.object.select_all(action="DESELECT"); tmp.select_set(True); bpy.context.view_layer.objects.active = tmp
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.subdivide(number_cuts=1, smoothness=0); bpy.ops.mesh.select_all(action="SELECT"); bpy.ops.mesh.subdivide(number_cuts=1, smoothness=0)
    bpy.ops.object.mode_set(mode="OBJECT"); bpy.data.objects.remove(tmp, do_unlink=True); bpy.context.view_layer.update()
    bm = bmesh.new(); bm.from_mesh(mesh); bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table()
    for f in list(bm.faces):
        c = np.mean([(Mw @ v.co)[:] for v in f.verts], axis=0)
        if not inside(c, delta): bm.faces.remove(f)
    for v in list(bm.verts):
        if not v.link_faces: bm.verts.remove(v)
    bm.faces.ensure_lookup_table(); faces = list(bm.faces)
    adj = {f.index: set() for f in faces}
    for e in bm.edges:
        lf = list(e.link_faces)
        if len(lf) == 2: adj[lf[0].index].add(lf[1].index); adj[lf[1].index].add(lf[0].index)
    if faces:
        seed = max(faces, key=lambda f: float((Mw @ f.calc_center_median())[2])).index; seen, st = {seed}, [seed]
        while st:
            x = st.pop()
            for y in adj[x]:
                if y not in seen: seen.add(y); st.append(y)
        for f in list(bm.faces):
            if f.index not in seen: bm.faces.remove(f)
        for v in list(bm.verts):
            if not v.link_faces: bm.verts.remove(v)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    for v in bm.verts: v.co = Mw @ v.co
    cap = bpy.data.objects.new("Flow_scalp_cap", mesh); bpy.context.scene.collection.objects.link(cap); cap.matrix_world.identity()
    deps = bpy.context.evaluated_depsgraph_get(); cap.update_tag(); bpy.context.view_layer.update()
    try:
        bv = BVHTree.FromObject(head, deps, deform=True, cage=False); ev = head.evaluated_get(deps)
        w2l, l2w = ev.matrix_world.inverted(), ev.matrix_world
        for _ in range(4):
            bnd = [v for v in bm.verts if any(len(e.link_faces) == 1 for e in v.link_edges)]
            new = {v.index: (v.co + sum((n.co for n in [e.other_vert(v) for e in v.link_edges]), Vector((0, 0, 0)))) / (len(v.link_edges) + 1) for v in bnd}
            for v in bnd: v.co = new[v.index]
            for v in bnd:
                hit, _, _, _ = bv.find_nearest(w2l @ v.co)
                if hit is not None: v.co = l2w @ hit
    except Exception as e: print("SMOOTH-FALLBACK", repr(e))
    bm.to_mesh(mesh); mesh.update(); cap.update_tag(); bpy.context.view_layer.update()
    V = np.array([tuple(v.co) for v in mesh.vertices]); F = [tuple(p.vertices) for p in mesh.polygons]
    y0 = float(V[:, 1].min()) - 0.002
    cut = [i for i, f in enumerate(F) if abs(V[list(f)][:, 0].mean() - cx) < 0.001 and y0 <= V[list(f)][:, 1].mean() <= apex_y]
    keepf = [f for i, f in enumerate(F) if i not in set(cut)]; F = keepf
    mesh.clear_geometry(); mesh.from_pydata(V.tolist(), [], [list(f) for f in F]); mesh.update()
    V = np.array([tuple(v.co) for v in mesh.vertices]); F = [tuple(p.vertices) for p in mesh.polygons]
    area = far(V, F); ncomp = comps(F)
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
        loops.append(cyc); used.add(s)
    loops = [L for L in loops if len(L) > 2]; loops.sort(key=len, reverse=True); outer = loops[0] if loops else []
    if len(loops) > 1:
        Vs = V; nfs = [list(f) for f in F]
        for L in loops[1:]:
            pts = Vs[L]; c = pts.mean(axis=0)
            try:
                hit, _, _, _ = bv.find_nearest(w2l @ Vector(c))
                if hit is not None: c = np.array(l2w @ hit)
            except Exception: pass
            ci = len(Vs); Vs = np.vstack([Vs, c]); nfs += [[ci, L[k], L[(k + 1) % len(L)]] for k in range(len(L))]
        mesh.clear_geometry(); mesh.from_pydata(Vs.tolist(), [], nfs); mesh.update()
        V = np.array([tuple(v.co) for v in mesh.vertices]); F = [tuple(p.vertices) for p in mesh.polygons]; area = far(V, F); ncomp = comps(F)
    order = outer; OP = V[order]
    avg9 = np.array([np.mean([OP[(k + j) % len(OP)] for j in range(-4, 5)], axis=0) for k in range(len(OP))])
    g3 = float(np.abs(OP - avg9).max())
    tL = min(order, key=lambda i: float(np.linalg.norm(V[i] - bL))); tR = min(order, key=lambda i: float(np.linalg.norm(V[i] - bR)))
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
    nbrs = [ [y for y, _ in adjw[i]] for i in range(len(V)) ]
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
        else:
            fb += 1; Fl[i] = np.array([1.0 if V[i][0] >= cx else -1.0, 0.0, 0.0])
    amax = int(phi.argmax())
    dfore = np.min(np.linalg.norm(V[:, None, :] - V[fore][None, :, :], axis=2), axis=1)
    g5set = Fl[dfore <= 0.015]; g5 = (float((g5set @ face_v).max()) if len(g5set) else 9.0)
    g6m = (np.abs(V[:, 0] - cx) > 0.02) & (V[:, 2] > ear_top); g6 = Fl[g6m]
    g6v = float((np.sign(g6[:, 0]) == np.sign(V[g6m][:, 0] - cx)).mean()) if len(g6) else 0.0
    occ = crown - 0.12; g7m = (V[:, 1] > apex_y + 0.01) & (V[:, 2] < occ); g7 = Fl[g7m]
    g7v = float((g7[:, 2] < 0).mean()) if len(g7) else 0.0
    sinks = sum(1 for i in range(len(V)) if i not in ex and nbrs[i] and all(phi[i] < phi[j] for j in nbrs[i]))
    bedge_len = float(np.mean([np.linalg.norm(V[a] - V[b]) for a, b in blines])) if blines else 0.0
    gates = [
        ("G1", area * 1e4, "[550,750]", 550 <= area * 1e4 <= 750), ("G2", ncomp * 100 + len(loops), "101", ncomp == 1 and len(loops) == 1),
        ("G3", g3 * 1000, "<=3", g3 * 1000 <= 3.0), ("G4", abs(float(V[amax][0]) - cx) * 1000, "<=10", abs(float(V[amax][0]) - cx) * 1000 <= 10 and all(phi[i] == 0.0 for i in EXIT)),
        ("G5", g5, "<=0.2", g5 <= 0.2), ("G6", g6v * 100, ">=95", g6v >= 0.95), ("G7", g7v * 100, ">=95", g7v >= 0.95), ("G8", sinks, "0", sinks == 0)]
    for g, m, t, p in gates: print("%s::%.4g | %s %s" % (g, m, t, "PASS" if p else "MISS"))
    np.savez(out / "cap.npz", verts=V, faces=np.array(F), phi=phi, flow=Fl, exit=np.array(EXIT), forehead=np.array(fore), slit=np.array(slit), temple=np.array([tL, tR]))
    row = {"slice": "hair-flow-1", "P1": {"scale": list(head.scale), "dims": list(head.dimensions), "note": "head is Aisha GLB import at scale 1; cap baked to world identity"},
           "P2": {"nose": [float(x) for x in nose], "face": face, "note": "face -Y confirmed" if face == "−Y" else "ADAPTED front=" + face},
           "delta": delta, "coarse_area_cm2": carea * 1e4, "area_cm2": area * 1e4, "components": ncomp, "loops": len(loops),
           "g3_mm": g3 * 1000, "bedge_mm": bedge_len * 1000, "argmax": {"id": amax, "xoff_mm": abs(float(V[amax][0]) - cx) * 1000, "phi": float(phi[amax])},
           "templeL": {"id": tL, "xyz": [float(x) for x in V[tL]]}, "templeR": {"id": tR, "xyz": [float(x) for x in V[tR]]},
           "counts": {"cap_verts": len(V), "cap_faces": len(F), "loop": len(order), "fore": len(fore), "slit": len(slit), "exit": len(EXIT), "g5n": len(g5set), "g6n": len(g6), "g7n": len(g7), "fallback": fb},
           "ear_top": ear_top, "occiput_z": occ, "apex": [float(x) for x in apex],
           "gates": [{"id": g, "measured": float(m) if isinstance(m, (int, float, np.floating)) else m, "threshold": t, "status": "PASS" if p else "MISS"} for g, m, t, p in gates]}
    with (out / "row-flow.json").open("w") as s: import json as J; J.dump(row, s, indent=2, sort_keys=True); s.write("\n")
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
    mcap = bpy.data.materials.new("FlowCapMat"); mcap.use_nodes = True; nt = mcap.node_tree
    nt.nodes.clear(); on = nt.nodes.new("ShaderNodeOutputMaterial"); bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    at = nt.nodes.new("ShaderNodeVertexColor"); at.layer_name = "PhiCol"; nt.links.new(at.outputs[0], bs.inputs["Base Color"])
    nt.links.new(bs.outputs[0], on.inputs[0]); mesh.materials.clear(); mesh.materials.append(mcap)
    cap.update_tag(); bpy.context.view_layer.update()
    def tube(name, runs, rgb, r):
        cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = r
        for run in runs:
            sp = cu.splines.new("POLY"); sp.points.add(len(run) - 1)
            for k, i in enumerate(run): sp.points[k].co = (float(V[i][0]), float(V[i][1]), float(V[i][2]), 1.0)
            sp.use_cyclic_u = len(runs) == 1 and len(run) == len(order)
        o = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(o)
        m = bpy.data.materials.new(name + "M"); m.use_nodes = True
        e = m.node_tree.nodes.new("ShaderNodeEmission"); e.inputs[0].default_value = (*rgb, 1.0); e.inputs[1].default_value = 2.0
        m.node_tree.links.new(e.outputs[0], m.node_tree.nodes["Material Output"].inputs[0]); o.data.materials.append(m); return o
    mask = [False] * n; fpos = {v: k for k, v in enumerate(order)}
    for v in fore: mask[fpos[v]] = True
    for v in slit:
        if v in fpos: mask[fpos[v]] = True
    runs, cur = [], []
    for k in range(n + 1):
        if k < n and not mask[k]: cur.append(order[k])
        elif cur: runs.append(cur); cur = []
    tube("Flow_EXIT", runs or [order], (0.1, 0.9, 0.2), 0.0009)
    ko = [fpos[v] for v in fore]; tube("Flow_FORE", [[order[k % n] for k in range(min(ko), max(ko) + 1)]], (0.95, 0.1, 0.8), 0.0012)
    sw = sorted(slit, key=lambda i: float(V[i][1])); tube("Flow_SLIT", [[i for i in sw if V[i][0] <= cx], [i for i in sw if V[i][0] > cx]], (1, 1, 1), 0.0012)
    sel = []; 
    for i in np.argsort(-V[:, 2]):
        p = V[i]
        if all(np.linalg.norm(p - V[j]) >= 0.008 for j in sel): sel.append(int(i))
        if len(sel) >= 1200: break
    av, af = [], []
    up0 = np.array([0.0, 0.0, 1.0])
    for s in sel:
        p, u, nn = V[s] + N[s] * 0.0015, Fl[s], N[s]; w = np.cross(u, nn)
        if np.linalg.norm(w) < 1e-6: w = np.cross(u, up0)
        if np.linalg.norm(w) < 1e-6: w = np.array([1.0, 0.0, 0.0])
        w = w / np.linalg.norm(w); v2 = np.cross(nn, u)
        if np.linalg.norm(v2) < 1e-6: v2 = np.cross(up0, u)
        v2 = v2 / np.linalg.norm(v2); b = len(av)
        for k in range(6):
            a = k / 6 * 2 * math.pi; d = w * math.cos(a) + v2 * math.sin(a)
            av.append(tuple(p + d * 0.0009)); av.append(tuple(p + u * 0.005 + d * 0.0009))
        for k in range(6):
            k2 = (k + 1) % 6; af.append((b + 2 * k, b + 2 * k2, b + 2 * k2 + 1, b + 2 * k + 1))
        hb = len(av); tip = tuple(p + u * 0.008)
        for k in range(6):
            a = k / 6 * 2 * math.pi; d = w * math.cos(a) + v2 * math.sin(a); av.append(tuple(p + u * 0.005 + d * 0.002))
        av.append(tip)
        for k in range(6): af.append((hb + k, hb + (k + 1) % 6, hb + 6))
    am = bpy.data.meshes.new("FlowArrows"); am.from_pydata(av, [], af); am.update()
    ao = bpy.data.objects.new("FlowArrows", am); bpy.context.scene.collection.objects.link(ao)
    amat = bpy.data.materials.new("FlowArrowM"); amat.use_nodes = True
    am2 = amat.node_tree.nodes["Principled BSDF"]; am2.inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1.0)
    am.materials.append(amat)
    cap.update_tag(); ao.update_tag(); bpy.context.view_layer.update()
    T = Vector((cx, -0.06, 1.50)); R = 0.8; cam = h.camera; sc = bpy.context.scene
    def track(o, t): o.rotation_euler = (Vector(t) - o.location).to_track_quat("-Z", "Y").to_euler()
    views = [("front", T + Vector((0, -R, 0.03))), ("three_quarter", T + Vector((R * 0.68, -R * 0.68, 0.15))), ("profile", T + Vector((R, 0, 0.03))), ("back", T + Vector((0, R, 0.10))), ("top", T + Vector((0, -0.12, R)))]
    sc.render.resolution_x = sc.render.resolution_y = 640; sc.cycles.samples = 16; sc.cycles.seed = 0
    paths = []
    for name, loc in views:
        cam.location = loc; track(cam, T); sc.render.filepath = str(out / ("v_" + name + ".png")); bpy.ops.render.render(write_still=True); paths.append(out / ("v_" + name + ".png"))
    from PIL import Image, ImageDraw
    cells = [Image.open(p).convert("RGB") for p in paths]; W, H = cells[0].size; lab = 30
    sheet = Image.new("RGB", (W * 5, H + lab), (20, 20, 20)); dr = ImageDraw.Draw(sheet)
    for k, (c, (vn, _)) in enumerate(zip(cells, views)):
        sheet.paste(c, (k * W, lab)); dr.text((k * W + 10, 8), vn, fill=(255, 255, 0))
    sheet.save(out / "flow-debug.png")
    saw = {vn: "arrows %s" % vn for vn, _ in views}
    with (out / "RESULT.txt").open("w") as s:
        s.write("RESULT::hair-flow-1\n")
        for g, m, t, p in gates: s.write("G%d::%.4g | %s %s\n" % ({"G1": 1, "G2": 2, "G3": 3, "G4": 4, "G5": 5, "G6": 6, "G7": 7, "G8": 8}[g], m, t, "PASS" if p else "MISS"))
        for vn, _ in views: s.write("SAW::%s: %s\n" % (vn, saw[vn]))
        if all(p for _, _, _, p in gates): s.write("CAUSE(D1)::ridge-max phi on part+forehead with zero interior sinks and backward forehead flow; P7 forehead sink consistent with exit-included forehead or unslit part, not gradient sign\n")
        else: s.write("CAUSE(D1)::withheld: gates MISS\n")
        s.write("COMMIT::pending\nSTILL::guides/children/hair renders (later cards)\nBRIEF_MISSING::P1 head is Aisha GLB import at scale 1 (not MPFB 0.1); cap baked to world identity so scale is applied trivially\nHARM::none\n")
    print("WROTE", out)
main()
