"""hair-guides-1: authored guide curves on the mode-B flow field (M1-M6)."""
import argparse, importlib.util, json, math, sys
from collections import defaultdict
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector, kdtree
from mathutils.bvhtree import BVHTree
HERE = Path(__file__).resolve().parent

def load_hs():
    p = HERE.parent / "hair-scene" / "hair_scene.py"
    s = importlib.util.spec_from_file_location("oclx_hs", p)
    m = importlib.util.module_from_spec(s); sys.modules[s.name] = m
    s.loader.exec_module(m); return m

def wpts(obj):
    M = obj.matrix_world
    return np.array([tuple(M @ v.co) for v in obj.data.vertices])

def bvh_of(obj, deps):
    obj.update_tag(); bpy.context.view_layer.update()
    return BVHTree.FromObject(obj, deps, deform=True, cage=False)

def nearest_pt(bvh, p):
    hit, n, _, _ = bvh.find_nearest(Vector(tuple(p)))
    if hit is None: return None, None
    return np.array(tuple(hit)), np.array(tuple(n))

def sdist(p, q, n):
    d = np.asarray(p) - q
    return float(np.sign(d @ n + 1e-12) * np.linalg.norm(d))

def resample(P, n=32):
    P = np.array(P); seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    L = seg.sum()
    if L < 1e-9: return np.repeat(P[:1], n, axis=0)
    t = np.concatenate([[0], np.cumsum(seg)]) / L
    out = []
    for k in range(n):
        u = k / (n - 1)
        j = min(int(np.searchsorted(t, u, side="right")) - 1, len(P) - 2)
        f = (u - t[j]) / max(t[j + 1] - t[j], 1e-12)
        out.append(P[j] * (1 - f) + P[j + 1] * f)
    return np.array(out)

def turn_rates(P):
    v1 = np.diff(P, axis=0); l1 = np.linalg.norm(v1, axis=1) + 1e-12
    u = v1 / l1[:, None]
    c = np.clip((u[:-1] * u[1:]).sum(axis=1), -1, 1)
    ang = np.degrees(np.arccos(c))
    seg = 0.5 * (l1[:-1] + l1[1:]) * 100.0
    return ang / np.maximum(seg, 1e-9), ang

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True)
    out = Path(ap.parse_args(sys.argv[sys.argv.index("--") + 1:]).out)
    out.mkdir(parents=True, exist_ok=True)
    HS = load_hs(); h = HS.build_scene(); body = h.head
    deps = bpy.context.evaluated_depsgraph_get()
    body.update_tag(); bpy.context.view_layer.update()
    # P2/P3 probes
    W = wpts(body)
    crown = float(W[:, 2].max()); cx = float(np.median(W[W[:, 2] > crown - 0.26][:, 0]))
    print("P2 body-bbox min=%s max=%s dims=%s crown=%.4f" % (W.min(0), W.max(0), W.max(0) - W.min(0), crown))
    meshes = []
    for o in bpy.data.objects:
        if o.type == "MESH" and o.visible_get():
            try: q = wpts(o)
            except Exception: continue
            meshes.append((o.name, len(o.data.vertices), q.min(0), q.max(0)))
    meshes.sort(key=lambda r: -r[1])
    print("P3 visible-meshes:")
    for nm, nv, lo, hi in meshes: print("  %s v=%d bbox=[%.3f,%.3f,%.3f]x[%.3f,%.3f,%.3f]" % (nm, nv, *lo, *hi))
    bad = ("eye", "mouth", "teeth", "tooth", "tongue", "lash", "brow", "nail", "hair", "mask", "helper", "glasses", "hat", "cap_")
    cols = [o for o in bpy.data.objects if o.type == "MESH" and o.visible_get()
            and o is not body and not any(b in o.name.lower() for b in bad)]
    print("P3 colliders: body=%s + %s" % (body.name, [o.name for o in cols]))
    colliders = [body] + cols
    menton = crown - 0.2107; zhem = menton - 0.116
    print("P2 crown=%.4f menton=%.4f zhem=%.4f" % (crown, menton, zhem))
    # load cap + field (read-only, never rebuilt)
    F = HERE.parent / "hair-flow"
    cap = np.load(F / "cap-v4.npz"); fb = np.load(F / "flow-b.npz", allow_pickle=True)
    V = np.array(cap["verts"]); slit = set(int(v) for v in cap["slit"])
    fore = set(int(v) for v in cap["forehead"]); cx = float(cap["cx"])
    apex_y = float(cap["apex_y"]); ear_y = float(cap["ear_y"])
    roots = np.array(fb["roots"]); excls = [str(c) for c in fb["exit_classes"]]
    slines = list(fb["slines"])
    print("P1 fore-exit=%d/300" % sum(1 for c in excls if c == "forehead"))
    SV = V[sorted(slit)]
    keep = [i for i in range(len(roots))
            if excls[i] != "forehead"
            and float(np.linalg.norm(SV - roots[i], axis=1).min()) >= 0.004]
    print("M1 keep=%d (drop fore + within-4mm-of-slit)" % len(keep))
    R = [roots[i] for i in keep]; SI = [i for i in keep]
    svd = np.array([float(np.linalg.norm(SV - r, axis=1).min()) for r in R])
    while len(R) > 238:  # thin closest pair, never slit-flankers (<10mm); stop at 238 for patch headroom
        m, p = 1e9, None
        A = np.array(R)
        for a in range(len(R)):
            if svd[a] < 0.010: continue
            d = np.linalg.norm(A - A[a], axis=1); d[a] = 1e9
            for b in np.where(svd < 0.010)[0]: d[b] = 1e9
            b = int(d.argmin())
            if d[b] < m: m, p = d[b], (a, b)
        if p is None: break
        j = max(p); del R[j]; del SI[j]; svd = np.delete(svd, j)
    R = np.array(R)
    bvhs = {o.name: bvh_of(o, deps) for o in colliders}
    def clearance(p):
        m = 1e9; inside = False
        for o in colliders:
            q, n = nearest_pt(bvhs[o.name], p)
            if q is None: continue
            s = sdist(p, q, n); m = min(m, abs(s))
            if s < 0: inside = True
        return (0.0 if inside else m), inside
    def push_out(p):
        p = np.array(p)
        for _ in range(3):
            d, ins = clearance(p)
            if not ins and d >= 0.004: return p, True
            q, n = None, None; m = 1e9
            for o in colliders:
                qq, nn = nearest_pt(bvhs[o.name], p)
                if qq is None: continue
                s = sdist(p, qq, nn)
                dd = 0.0 if s < 0 else s
                if dd < m: m, q, n = dd, qq, nn
            p = q + n * 0.004
        d, ins = clearance(p)
        return p, (not ins and d >= 0.004)
    bvh_body = bvhs[body.name]
    # patch bald zone: new roots on uncovered cap verts, traced with flow5 stepping
    D0 = np.linalg.norm(V[:, None, :] - R[None, :, :], axis=2); cover0 = D0.min(1)
    fB = np.array(fb["f"]); ear_y = float(cap["ear_y"])
    w2l, l2w = body.matrix_world.inverted().copy(), body.matrix_world.copy()
    kd = kdtree.KDTree(len(V))
    for i, p in enumerate(V): kd.insert(Vector(tuple(p)), i)
    kd.balance()
    ball = np.array(sorted(set(int(v) for v in cap["exit"]) | set(int(v) for v in cap["forehead"]) | set(int(v) for v in cap["slit"])))
    bkd = kdtree.KDTree(len(ball))
    for vi in ball: bkd.insert(Vector(tuple(V[int(vi)])), int(vi))
    bkd.balance()
    capBVH = BVHTree.FromPolygons([Vector(tuple(p)) for p in V], [tuple(f) for f in np.array(cap["faces"])])
    def trace_root(r):
        p = Vector(tuple(r)); pl = [tuple(r)]
        for _ in range(100):
            _, vi, _ = kd.find(p); fv = fB[vi]; nl = float(np.linalg.norm(fv))
            if nl < 1e-9: break
            p_new = p + Vector(tuple(fv / nl * 0.002))
            hit, _, _, _ = bvh_body.find_nearest(w2l @ p_new)
            p_proj = (l2w @ hit) if hit is not None else p_new
            _, _, _, dist = capBVH.find_nearest(p_proj)
            if dist is None or float(dist) > 0.0015:
                _, bi, _ = bkd.find(p_proj); pl.append(tuple(p_proj)); return np.array(pl), int(bi)
            p = p_proj; pl.append(tuple(p))
        return np.array(pl), None
    acc = []; accp = []
    for i in sorted(np.where(cover0 > 0.009)[0], key=lambda i: -cover0[i]):
        p = V[i]
        if float(np.linalg.norm(SV - p, axis=1).min()) < 0.004: continue
        if float(np.linalg.norm(np.vstack([R] + accp) - p, axis=1).min()) < 0.008: continue
        pl, bi = trace_root(p)
        if bi is None or bi in fore or len(pl) < 3: continue
        yb = float(V[bi][1])
        acc.append((p, pl, "temple-to-ear" if yb < ear_y else ("behind-ear" if yb <= ear_y + 0.030 else "nape"))); accp.append(p)
        if len(R) + len(acc) >= 250: break
    print("M1 patch-roots=%d bald-verts=%d" % (len(acc), int((cover0 > 0.009).sum())))
    Rall = [r for r in R]; Sall = [np.array(slines[i]) for i in SI]; Eall = [excls[i] for i in SI]
    for p, pl, c in acc: Rall.append(p); Sall.append(pl); Eall.append(c)
    Rall = np.array(Rall)
    print("M1 roots=%d min-spacing=%.2fmm" % (len(Rall), float(np.linalg.norm(Rall[:, None, :] - Rall[None, :, :], axis=2)[np.eye(len(Rall)) == 0].min()) * 1000 if len(Rall) > 1 else 0))
    guides, exitcls, scalp_frac = [], [], []
    for r, poly0, ecl in zip(Rall, Sall, Eall):
        poly = np.array(poly0)
        poly = poly[np.concatenate([[True], np.linalg.norm(np.diff(poly, axis=0), axis=1) > 0.0003])]
        if len(poly) < 3: continue
        scalp = []
        for q in poly:
            hq, hn = nearest_pt(bvh_body, q)
            if hq is None: break
            scalp.append(hq + hn * 0.003)
        scalp = np.array(scalp)
        if len(scalp) < 3: continue
        j = scalp[-1]
        fall = [j]; p = np.array(j); d = np.array([0.0, 0.0, -1.0]); pv = d.copy()
        for _ in range(400):
            cand = p + 0.005 * d
            q, _ = push_out(cand)
            v = q - p; nv = float(np.linalg.norm(v)); v = v / nv if nv > 1e-9 else d
            if (v @ pv) < 0.5:  # damp zigzag, keep 5mm length
                v = 0.5 * pv + 0.5 * v; v = v / (np.linalg.norm(v) + 1e-12)
                q, _ = push_out(p + 0.005 * v)
                w = q - p; n2 = float(np.linalg.norm(w))
                q = p + 0.005 * (w / n2 if n2 > 1e-9 else d)
            nn2 = float(np.linalg.norm(q - p)); pv = (q - p) / nn2 if nn2 > 1e-9 else d
            p = q; fall.append(p.copy())
            if p[2] <= zhem: break
        fall = np.array(fall)
        full = np.vstack([scalp[:-1], fall]); ji = len(scalp) - 1
        scL = float(np.linalg.norm(np.diff(full[:ji + 1], axis=0), axis=1).sum())
        totL = float(np.linalg.norm(np.diff(full, axis=0), axis=1).sum())
        for _ in range(3):  # constrained smooth, endpoints fixed
            seg = np.linalg.norm(np.diff(full, axis=0), axis=1)
            s = np.concatenate([[0], np.cumsum(seg)])
            w2 = full.copy()
            for k in range(1, len(full) - 1):
                w2[k] = full[np.abs(s - s[k]) < 0.008].mean(axis=0)
            full = w2
        for k in range(ji):  # re-project: scalp lifts, fall push-outs
            hq, hn = nearest_pt(bvh_body, full[k])
            full[k] = hq + hn * 0.003
        for k in range(ji, len(full)):
            full[k], _ = push_out(full[k])
        full[-1][2] = zhem
        full[-1], _ = push_out(full[-1])
        if abs(full[-1][2] - zhem) > 0.005: full[-1][2] = zhem
        dd = np.linalg.norm(np.diff(full, axis=0), axis=1)
        full = full[np.concatenate([[True], dd > 0.0003])]
        if len(full) < 4: continue
        guides.append(resample(full)); exitcls.append(ecl); scalp_frac.append(scL / totL)
    G = np.array(guides); n = len(G)
    medy = float(np.median(W[:, 1]))
    print("GUIDES n=%d pts=%d" % (n, 32))
    for _ in range(2):  # tip decluster toward 8-nearest median, z pinned
        T = G[:, -1, :].copy()
        D = np.linalg.norm(T[:, None, :] - T[None, :, :], axis=2); D.sort(axis=1)
        idx = np.argsort(np.linalg.norm(T[:, None, :] - T[None, :, :], axis=2), axis=1)[:, 1:9]
        for gi in range(n):
            m = np.median(T[idx[gi]], axis=0)
            v = m - T[gi]; v[2] = 0; nv = float(np.linalg.norm(v))
            if nv > 1e-9: T[gi] = T[gi] + v / nv * min(nv * 0.5, 0.010)
        G[:, -1, :2] = T[:, :2]
    for gi in range(n):  # post-resample re-projection (corner-cut restore) + tip placement
        ns = int(round(scalp_frac[gi] * 31))
        for k in range(ns + 1):
            hq, hn = nearest_pt(bvh_body, G[gi, k])
            G[gi, k] = hq + hn * 0.003
        for k in range(ns + 1, 32):
            G[gi, k], _ = push_out(G[gi, k])
        base = G[gi, -1].copy(); base[2] = zhem
        rad = base[:2] - np.array([cx, medy]); rad = rad / (np.linalg.norm(rad) + 1e-12)
        for rr in np.arange(0, 0.031, 0.002):
            angs = [0.0] if rr == 0 else np.linspace(0, 2 * np.pi, 8, endpoint=False)
            done = False
            for a in angs:
                c = base.copy()
                if rr > 0: c[:2] += (rad * np.cos(a) + np.array([-rad[1], rad[0]]) * np.sin(a)) * rr
                dd, ins = clearance(c)
                if not ins and dd >= 0.004: G[gi, -1] = c; done = True; break
            if done: break
    # Curves object via strand-mesh + Geometry Nodes transfer (Blender exposes no curves.add())
    if "OCLX_guides" in bpy.data.objects: bpy.data.objects.remove(bpy.data.objects["OCLX_guides"], do_unlink=True)
    vv = G.reshape(-1, 3).tolist(); ee = []
    for gi in range(n):
        for k in range(31): ee.append((gi * 32 + k, gi * 32 + k + 1))
    sm = bpy.data.meshes.new("OCLX_guide_strands"); sm.from_pydata(vv, ee, []); sm.update()
    so = bpy.data.objects.new("OCLX_guide_strands", sm)
    bpy.context.scene.collection.objects.link(so)
    so.hide_render = so.hide_viewport = True
    hc = bpy.data.hair_curves.new("OCLX_guides_data")
    go = bpy.data.objects.new("OCLX_guides_tmp", hc)
    bpy.context.scene.collection.objects.link(go)
    grp = bpy.data.node_groups.new("OCLX_guides_build", "GeometryNodeTree")
    grp.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    grp.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    gin = grp.nodes.new("NodeGroupInput"); gout = grp.nodes.new("NodeGroupOutput")
    oi = grp.nodes.new("GeometryNodeObjectInfo"); oi.inputs["Object"].default_value = so
    m2c = grp.nodes.new("GeometryNodeMeshToCurve")
    rs = grp.nodes.new("GeometryNodeResampleCurve"); rs.inputs["Mode"].default_value = "Count"; rs.inputs["Count"].default_value = 32
    grp.links.new(oi.outputs["Geometry"], m2c.inputs["Mesh"])
    grp.links.new(m2c.outputs["Curve"], rs.inputs["Curve"])
    grp.links.new(rs.outputs["Curve"], gout.inputs["Geometry"])
    mod = go.modifiers.new("OCLX_guides_build", "NODES"); mod.node_group = grp
    go.update_tag(); bpy.context.view_layer.update()
    deps2 = bpy.context.evaluated_depsgraph_get()
    gdata = go.evaluated_get(deps2).data.copy()
    bpy.data.objects.remove(go, do_unlink=True)
    go = bpy.data.objects.new("OCLX_guides", gdata)
    bpy.context.scene.collection.objects.link(go); go.update_tag(); bpy.context.view_layer.update()
    print("CURVES count=%d mode-pts=%d" % (len(go.data.curves), len(go.data.curves[0].points) if len(go.data.curves) else -1))
    # ---- gates ----
    flat = G.reshape(-1, 3)
    ds = np.array([clearance(p)[0] for p in flat]); ins = sum(clearance(p)[1] for p in flat)
    g2min = float(ds.min())
    bq, bn = np.array([nearest_pt(bvh_body, p) for p in flat]), None
    scalpm = np.zeros(n, dtype=bool)
    g3bad = 0; g3n = 0; g4bad = 0; g4n = 0; below = []
    for gi in range(n):
        ns = int(round(scalp_frac[gi] * 31))
        for k, p in enumerate(G[gi]):
            q, nn = nearest_pt(bvh_body, p)
            d = abs(sdist(p, q, nn))
            if k <= ns:
                g3n += 1
                if not (0.002 <= d <= 0.006): g3bad += 1
            else:
                if p[2] > menton: g4n += 1; g4bad += (d > 0.020)
                else:
                    m = min(abs(sdist(p, *nearest_pt(bvhs[o.name], p))) for o in colliders)
                    below.append(m)
    below = np.array(below)
    print("DBG G3 bad=%d/%d G4 bad=%d/%d G5 n=%d" % (g3bad, g3n, g4bad, g4n, len(below)))
    tin = sum(clearance(tuple(p))[1] for p in G[:, -1, :])
    print("DBG inside-tips=%d/250" % tin)
    for ec in ("temple-to-ear", "behind-ear", "nape"):
        idx = [gi for gi in range(n) if exitcls[gi] == ec]
        print("DBG class=%s guides=%d" % (ec, len(idx)))
    vv = []
    for gi in range(n):
        ns = int(round(scalp_frac[gi] * 31))
        for k, p in enumerate(G[gi]):
            if k > ns and p[2] > menton:
                q, nn = nearest_pt(bvh_body, p)
                if abs(sdist(p, q, nn)) > 0.020: vv.append(p)
    vv = np.array(vv)
    if len(vv): print("DBG G4 viol-mean=%s class-hist=%s" % (np.round(vv.mean(0) * 1000, 1).tolist(), {c: int(sum(1 for gi in range(n) if exitcls[gi] == c)) for c in ("temple-to-ear", "behind-ear", "nape")}))
    g3x = []
    for gi in range(n):
        ns = int(round(scalp_frac[gi] * 31))
        for k, p in enumerate(G[gi]):
            if k <= ns:
                q, nn = nearest_pt(bvh_body, p); d = abs(sdist(p, q, nn))
                if not (0.002 <= d <= 0.006) and len(g3x) < 5: g3x.append((np.round(p * 1000, 1).tolist(), round(d * 1000, 2)))
    print("DBG G3 bad-ex=%s" % g3x)
    browz = float(W[(np.abs(W[:, 0] - cx) < 0.005) & (W[:, 1] < np.median(W[:, 1]) - 0.02)][:, 2].max())
    tT = np.array(cap["temple"]); half_ear = float(np.abs(V[tT][:, 0] - cx).mean())
    g6 = 0; g6ex = []
    for p in flat:  # face opening: in-face-box AND floating >6mm off skin (3mm lie is hairline, not crossing)
        if p[2] > browz and abs(p[0] - cx) < half_ear and p[1] < medy:
            q, nn = nearest_pt(bvh_body, p)
            if nn[1] < -0.5 and p[1] < q[1] - 0.006 and abs(sdist(p, q, nn)) > 0.006:
                g6 += 1
                if len(g6ex) < 5: g6ex.append(np.round(p * 1000, 1).tolist())
    print("G6 violators=%d ex=%s half_ear=%.1fmm browz=%.4f" % (g6, g6ex, half_ear * 1000, browz))
    rates = np.concatenate([turn_rates(g)[0] for g in G]) if n else np.array([0])
    g7p95, g7max = float(np.percentile(rates, 95)), float(rates.max())
    tips = G[:, -1, :]; tz = np.abs(tips[:, 2] - zhem)
    D = np.linalg.norm(tips[:, None, :] - tips[None, :, :], axis=2)
    D.sort(axis=1)
    g8stray = float((np.median(D[:, 1:9], axis=1) > 0.025).mean() * 100)
    D2 = np.linalg.norm(V[:, None, :] - Rall[None, :, :], axis=2)  # unlifted roots
    g9max = float(D2.min(axis=1).max() * 1000)
    g10 = float(abs(flat[:, 0].mean()) * 1000)
    gates = [
        ("G1", "%d" % n, "[150,250]", 150 <= n <= 250),
        ("G2", "inside=%d min=%.2fmm" % (ins, g2min * 1000), "0 ∧ >=2mm", ins == 0 and g2min >= 0.002),
        ("G3", "bad=%d/%d" % (g3bad, g3n), "100% in [2,6]mm", g3n > 0 and g3bad == 0),
        ("G4", "bad=%d/%d" % (g4bad, g4n), ">=98% <=20mm", g4n > 0 and g4bad / g4n <= 0.02),
        ("G5", "p95=%.1fmm max=%.1fmm" % (float(np.percentile(below, 95)) * 1000, float(below.max()) * 1000) if len(below) else "n/a", "p95<=35 ∧ max<=60", len(below) and float(np.percentile(below, 95)) <= 0.035 and float(below.max()) <= 0.060),
        ("G6", "%d" % g6, "0", g6 == 0),
        ("G7", "p95=%.2f max=%.2f" % (g7p95, g7max), "p95<=8 ∧ max<=20", g7p95 <= 8 and g7max <= 20),
        ("G8", "tipdz=%.2fmm stray=%.2f%%" % (float(np.abs(tz).max()) * 1000, g8stray), "all<=5mm ∧ <2%", bool((np.abs(tz) <= 0.005).all()) and g8stray < 2),
        ("G9", "max=%.2fmm" % g9max, "<=9mm", g9max <= 9.0),
        ("G10", "|meanx|=%.2fmm" % g10, "<=5mm", g10 <= 5.0),
    ]
    for g, m, b, ok in gates: print("%s %s | %s %s" % (g, m, b, "PASS" if ok else "MISS"))
    np.savez(out / "guides.npz", points=G, root_ids=np.array(SI), exit_class=np.array(exitcls),
             z_hem=zhem, menton_z=menton, crown_z=crown)
    row = {"gates": [{"gate": g, "measured": m, "bar": b, "verdict": "PASS" if ok else "MISS"} for g, m, b, ok in gates],
           "probes": {"P1_fore_exit": int(sum(1 for c in excls if c == "forehead")),
                      "P2_bbox_min": W.min(0).tolist(), "P2_bbox_max": W.max(0).tolist(), "P2_crown": crown,
                      "P3_colliders": [o.name for o in colliders],
                      "P3_meshes": [{"name": a, "verts": b, "lo": c.tolist(), "hi": d.tolist()} for a, b, c, d in meshes]},
           "z_hem": zhem, "menton_z": menton, "crown_z": crown, "brow_z": browz, "count": n}
    (out / "row-guides.json").write_text(json.dumps(row, indent=1))
    # ---- renders: orange tubes over body+garment, grey bg ----
    h.hair.hide_render = h.hair.hide_viewport = True
    cu = bpy.data.curves.new("OCLX_guide_tubes", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.0015
    for g in G[::max(1, n // 250)]:
        sp = cu.splines.new("POLY"); sp.points.add(31)
        for k, p in enumerate(g): sp.points[k].co = (float(p[0]), float(p[1]), float(p[2]), 1.0)
    to = bpy.data.objects.new("OCLX_guide_tubes", cu); bpy.context.scene.collection.objects.link(to)
    om = bpy.data.materials.new("OCLX_guide_orange"); om.use_nodes = True
    em = om.node_tree.nodes.new("ShaderNodeEmission"); em.inputs[0].default_value = (1.0, 0.35, 0.0, 1.0); em.inputs[1].default_value = 2.0
    om.node_tree.links.new(em.outputs[0], om.node_tree.nodes["Material Output"].inputs[0])
    cu.materials.append(om)
    to.update_tag(); bpy.context.view_layer.update()
    sc = bpy.context.scene; sc.render.resolution_x = sc.render.resolution_y = 1024
    sc.cycles.samples = 32; sc.cycles.seed = 0
    cam = h.camera; tgt = Vector((cx, float(np.median(W[:, 1])), menton + 0.06)); dist = 0.85
    def track(o, t): o.rotation_euler = (Vector(t) - o.location).to_track_quat("-Z", "Y").to_euler()
    views = [("front", tgt + Vector((0, -dist, 0.02))), ("three_quarter", tgt + Vector((dist * 0.68, -dist * 0.68, 0.14))),
             ("profile", tgt + Vector((dist, 0, 0.02))), ("back", tgt + Vector((0, dist, 0.08))), ("top", tgt + Vector((0, -0.10, dist)))]
    for name, loc in views:
        cam.location = tuple(loc); track(cam, tgt)
        sc.render.filepath = str(out / ("v_%s.png" % name)); bpy.ops.render.render(write_still=True)
    from PIL import Image, ImageDraw
    cells = [Image.open(out / ("v_%s.png" % v)).convert("RGB") for v, _ in views]
    Wd, Hd = cells[0].size; lab = 36
    sheet = Image.new("RGB", (Wd * 5, Hd + lab), (20, 20, 20)); dr = ImageDraw.Draw(sheet)
    for k, (v, _) in enumerate(views):
        sheet.paste(cells[k], (k * Wd, lab)); dr.text((k * Wd + 10, 10), v, fill=(255, 165, 0))
    sheet.save(out / "guides-debug.png")
    T = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views")
    tf, tp = Image.open(T / "target-front.png").convert("RGB"), Image.open(T / "target-profile.png").convert("RGB")
    gf, gp = Image.open(out / "v_front.png").convert("RGB"), Image.open(out / "v_profile.png").convert("RGB")
    s2 = 512; box = Image.new("RGB", (s2 * 4, s2), (20, 20, 20))
    for k, im in (0, tf), (1, gf), (2, tp), (3, gp): box.paste(im.resize((s2, s2)), (k * s2, 0))
    box.save(out / "target-vs-guides.png")
    print("WROTE", out)
main()
