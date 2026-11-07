"""hair-guides-2: extended surface phase + contact slide (M7-M10)."""
import argparse, importlib.util, json, sys
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
    if L < 1e-9: return np.repeat(P[:1], n, axis=0), None
    t = np.concatenate([[0], np.cumsum(seg)]) / L
    out = []
    jmap = []
    for k in range(n):
        u = k / (n - 1)
        j = min(int(np.searchsorted(t, u, side="right")) - 1, len(P) - 2)
        jmap.append(j)
        f = (u - t[j]) / max(t[j + 1] - t[j], 1e-12)
        out.append(P[j] * (1 - f) + P[j + 1] * f)
    return np.array(out), np.array(jmap)

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
    W = wpts(body)
    crown = float(W[:, 2].max()); cx = float(np.median(W[W[:, 2] > crown - 0.26][:, 0]))
    medy = float(np.median(W[:, 1]))
    bad = ("eye", "mouth", "teeth", "tooth", "tongue", "lash", "brow", "nail", "hair", "mask", "helper", "glasses", "hat", "cap_")
    cols = [o for o in bpy.data.objects if o.type == "MESH" and o.visible_get()
            and o is not body and not any(b in o.name.lower() for b in bad)]
    print("colliders: body=%s + %s" % (body.name, [o.name for o in cols]))
    colliders = [body] + cols
    menton = crown - 0.2107; zhem = menton - 0.116
    F = HERE.parent / "hair-flow"
    cap = np.load(F / "cap-v4.npz"); fb = np.load(F / "flow-b.npz", allow_pickle=True)
    V = np.array(cap["verts"]); slit = set(int(v) for v in cap["slit"])
    ear_y = float(cap["ear_y"]); ear_top = float(cap["ear_top"])
    fB = np.array(fb["f"])
    print("crown=%.4f menton=%.4f zhem=%.4f ear_y=%.4f ear_top=%.4f" % (crown, menton, zhem, ear_y, ear_top))
    # ---- x_wide(z): body half-width in ear-line plane, 3 attempts ----
    xwide = None
    for att, yw in enumerate((0.015, 0.025, 10.0)):
        sel = W[np.abs(W[:, 1] - ear_y) <= yw]
        if len(sel) < 100: print("xwide att%d: only %d verts" % (att, len(sel))); continue
        zb = np.arange(1.28, 1.641, 0.005); tab = np.full(len(zb), np.nan)
        for i, z in enumerate(zb):
            q = sel[np.abs(sel[:, 2] - z) <= 0.0025][:, 0]
            if len(q): tab[i] = float(np.abs(q - cx).max())
        ok = ~np.isnan(tab)
        print("xwide att%d: bins=%d/%.0f tab=[%.1f,%.1f]mm" % (att, int(ok.sum()), len(zb),
              float(np.nanmin(tab)) * 1000, float(np.nanmax(tab)) * 1000))
        if ok.sum() < 10: print("xwide att%d: only %d bins" % (att, int(ok.sum()))); continue
        tab[~ok] = np.interp(zb[~ok], zb[ok], tab[ok])
        tab = np.convolve(tab, np.ones(3) / 3, mode="same")
        if np.isnan(tab).any() or (tab <= 0.001).any(): print("xwide att%d: degenerate" % att); continue
        xwide = (zb, tab); print("xwide att%d ok yw=%.3f range=[%.1f,%.1f]mm" % (att, yw, tab.min() * 1000, tab.max() * 1000)); break
    if xwide is None: print("XWIDE_UNMEASURABLE after 3 attempts"); return
    zb, tab = xwide
    def xw(z): return float(np.interp(z, zb, tab))
    nb = W[(np.abs(W[:, 1] - medy) < 0.05) & (W[:, 2] > 1.40) & (W[:, 2] < 1.46) & (np.abs(W[:, 0] - cx) < 0.05)]
    yneck = float(np.median(nb[:, 1])) if len(nb) else medy
    print("yneck=%.4f eye: brow_z next" % yneck)
    bvhs = {o.name: bvh_of(o, deps) for o in colliders}
    bvh_body = bvhs[body.name]
    def clearance(p):
        m = 1e9; inside = False
        for o in colliders:
            q, n = nearest_pt(bvhs[o.name], p)
            if q is None: continue
            s = sdist(p, q, n); m = min(m, abs(s))
            if s < 0: inside = True
        return (0.0 if inside else m), inside
    def nearest_col(p):
        best = None
        for o in colliders:
            q, n = nearest_pt(bvhs[o.name], p)
            if q is None: continue
            d = abs(sdist(p, q, n))
            if best is None or d < best[0]: best = (d, o, q, n)
        return best[1], best[2], best[3]
    def project_out(p):  # to 4mm off the most-violating collider, no length restore
        p = np.array(p)
        for _ in range(6):
            ss = []
            for o in colliders:
                q, n = nearest_pt(bvhs[o.name], p)
                if q is None: continue
                ss.append((sdist(p, q, n), q, n))
            if not ss: break
            s0, q0, n0 = min(ss, key=lambda r: r[0])
            if s0 >= 0.004: break
            p = q0 + n0 * 0.004
        return p
    # ---- M7: Poisson 6mm, slit exclusion 1.5mm, keep forehead exits ----
    SV = V[sorted(slit)]
    sdist_cap = np.linalg.norm(V[:, None, :] - SV[None, :, :], axis=2).min(1)
    cand = np.where(sdist_cap >= 0.0015)[0]
    rng = np.random.default_rng(7); rng.shuffle(cand)
    acc = []
    A = np.empty((0, 3))
    for i in cand:
        if len(acc) == 0 or float(np.linalg.norm(A - V[i], axis=1).min()) >= 0.006:
            acc.append(int(i)); A = V[np.array(acc)]
    R = V[np.array(acc)]
    print("M7 greedy=%d" % len(R))
    prot = np.linalg.norm(V[acc][:, None, :] - SV[None, :, :], axis=2).min(1) < 0.004
    while len(acc) > 445:  # batch-sweep decimation: drop one member of every closest pair
        A = V[np.array(acc)]
        D = np.linalg.norm(A[:, None, :] - A[None, :, :], axis=2)
        D += np.eye(len(acc)) * 1e9
        D[prot[:, None] | prot[None, :]] = 1e9
        dmin = float(D.min())
        if dmin >= 1e8: break
        alive = np.ones(len(acc), bool)
        ii, jj = np.where(np.triu(D < dmin + 0.0005, 1))
        order = np.argsort(D[ii, jj])
        for a, b in zip(ii[order], jj[order]):
            if alive[a] and alive[b]: alive[b] = False
        if alive.all(): break
        acc = [acc[k] for k in np.where(alive)[0]]
        prot = prot[alive]
    for _ in range(60):  # farthest-point refill: worst-covered cap verts first, up to 450
        A = V[np.array(acc)]
        Dw = np.linalg.norm(V[:, None, :] - A[None, :, :], axis=2).min(1)
        i = int(Dw.argmax())
        if float(Dw[i]) <= 0.009 or len(acc) >= 450: break
        if float(np.linalg.norm(SV - V[i], axis=1).min()) < 0.0015: sdist_cap[i] = 0.0; continue
        acc.append(i)
    while len(acc) < 445:  # filler guard for G1 if sweep overshot
        A = V[np.array(acc)]
        Dw = np.linalg.norm(V[:, None, :] - A[None, :, :], axis=2).min(1)
        i = int(Dw.argmax())
        if float(Dw[i]) <= 0.00605 or len(acc) >= 445: break
        if float(np.linalg.norm(SV - V[i], axis=1).min()) < 0.0015: sdist_cap[i] = 0.0; continue
        acc.append(i)
    R = V[np.array(acc)]
    print("M7 roots=%d min-spacing=%.2fmm" % (len(R), float(np.linalg.norm(R[:, None, :] - R[None, :, :], axis=2)[np.eye(len(R)) == 0].min()) * 1000))
    # ---- retrace streamlines with flow5 stepping ----
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
    def modeB_dir(p, n):
        L = np.array([np.sign(p[0] - cx) or 1.0, 0.0, 0.0]); L = L - (L @ n) * n
        nl = float(np.linalg.norm(L)); L = L / nl if nl > 1e-9 else np.zeros(3)
        Gv = np.array([0.0, 0.0, -1.0]); Gv = Gv - (Gv @ n) * n
        ng = float(np.linalg.norm(Gv)); Gv = Gv / ng if ng > 1e-9 else np.zeros(3)
        w = max(min(float(n[2]), 1.0), 0.0) ** 0.5
        return w * L + (1 - w) * Gv, L
    def surface_walk(p0, d0):  # M8: body-surface phase for front roots
        pts = [np.array(p0)]; prog = np.array(p0); end = "?"
        for _ in range(400):
            q, n = nearest_pt(bvh_body, pts[-1])
            f, L = modeB_dir(pts[-1], n)
            if f[1] < 0: f[1] = 0.0  # no-forward (brief order: rule, no-forward, floor, norm)
            if abs(pts[-1][0] - cx) < xw(pts[-1][2]) - 0.005: f = f + 0.8 * L  # lateral floor
            nl = float(np.linalg.norm(f))
            if nl < 1e-9: f = L
            else: f = f / nl
            cand = pts[-1] + 0.003 * f
            q2, n2 = nearest_pt(bvh_body, cand)
            pts.append(q2 + n2 * 0.003)
            if abs(pts[-1][0] - cx) >= xw(pts[-1][2]) - 0.005: end = "lateral"; break
            if pts[-1][2] < ear_top - 0.02: end = "zfloor"; break
            if len(pts) % 20 == 0:
                if float(np.linalg.norm(pts[-1] - prog)) < 0.001: end = "stall"; break
                prog = pts[-1].copy()
        else: end = "maxiter"
        return np.array(pts), end
    Z = np.array([0.0, 0.0, -1.0])
    def fall_phase(p0, d0):  # M3 + M9 contact slide
        pts = [np.array(p0)]; d = np.array(d0) / (np.linalg.norm(d0) + 1e-12)
        blocked = 0; anchor = np.array(p0); cend = False
        for _ in range(400):
            dd = 0.65 * d + 0.35 * Z; dd = dd / (np.linalg.norm(dd) + 1e-12)
            cand = pts[-1] + 0.005 * dd
            cl, ins = clearance(cand)
            if not ins and cl >= 0.004:
                pts.append(cand); d = dd; blocked = 0; anchor = cand.copy()
            else:
                _, q, n = nearest_col(cand)
                t = Z - (Z @ n) * n; nt = float(np.linalg.norm(t))
                if nt >= 0.15: s = t / nt
                else:
                    hh = np.array([cand[0] - cx, cand[1] - yneck, 0.0]); hh = hh - (hh @ n) * n
                    nh = float(np.linalg.norm(hh)); s = hh / nh if nh > 1e-9 else (t / nt if nt > 1e-9 else Z)
                stepped = pts[-1] + 0.005 * s
                pnew = project_out(stepped)  # all colliders, not body only
                if float(np.linalg.norm(pnew - pts[-1])) >= 0.0025:
                    pts.append(pnew); d = s
                if (anchor[2] - pts[-1][2]) >= 0.001 or float(np.linalg.norm(pts[-1][:2] - anchor[:2])) >= 0.002:
                    blocked = 0; anchor = pts[-1].copy()
                else:
                    blocked += 1
                if blocked >= 3: cend = True; break
            if pts[-1][2] <= zhem: break
        return np.array(pts), cend
    chains, phases, cends = [], [], []
    from collections import Counter
    endhist = Counter()
    for r in R:
        pl, bi = trace_root(r)
        if bi is None or len(pl) < 3: continue
        scalp = []
        for q in pl:
            hq, hn = nearest_pt(bvh_body, q)
            if hq is None: break
            scalp.append(hq + hn * 0.003)
        scalp = np.array(scalp)
        if len(scalp) < 3: continue
        d0 = scalp[-1] - scalp[-2]; d0 = d0 / (np.linalg.norm(d0) + 1e-12)
        if float(r[1]) < ear_y:  # M8 front roots
            surf, wend = surface_walk(scalp[-1], d0)
            endhist[wend] += 1
            d1 = surf[-1] - surf[-2] if len(surf) > 1 else d0
            fall, ce = fall_phase(surf[-1], d1)
            full = np.vstack([scalp[:-1], surf, fall[1:]])
            ph = np.array([0] * (len(scalp) - 1) + [1] * len(surf) + [2] * (len(fall) - 1))
        else:
            fall, ce = fall_phase(scalp[-1], d0)
            full = np.vstack([scalp[:-1], fall])
            ph = np.array([0] * (len(scalp) - 1) + [2] * len(fall))
        mask = np.concatenate([[True], np.linalg.norm(np.diff(full, axis=0), axis=1) > 0.001])
        full = full[mask]; ph = ph[mask]
        if len(full) < 4: continue
        seg = np.linalg.norm(np.diff(full, axis=0), axis=1); s = np.concatenate([[0], np.cumsum(seg)])
        for _ in range(3):  # fast constrained smooth, endpoints fixed
            seg = np.linalg.norm(np.diff(full, axis=0), axis=1); s = np.concatenate([[0], np.cumsum(seg)])
            csum = np.vstack([np.zeros(3), np.cumsum(full, axis=0)])
            lo = np.searchsorted(s, s - 0.008); hi = np.searchsorted(s, s + 0.008)
            cnt = np.maximum(hi - lo, 1)
            full[1:-1] = (csum[hi[1:-1]] - csum[lo[1:-1]]) / cnt[1:-1][:, None]
        for k in range(len(full) - 1):  # re-project by phase
            if ph[k] < 2:
                hq, hn = nearest_pt(bvh_body, full[k]); full[k] = hq + hn * 0.003
            else:
                full[k] = project_out(full[k])
        if not ce:
            full[-1][2] = zhem; full[-1] = project_out(full[-1]); full[-1][2] = zhem
        rs, jm = resample(full)
        chains.append((rs, ph[jm], ce))
    n = len(chains)
    G = np.array([c[0] for c in chains]); RPH = np.array([c[1] for c in chains]); CE = np.array([c[2] for c in chains])
    print("GUIDES n=%d contact-ended=%d walk-end=%s" % (n, int(CE.sum()), dict(endhist)))
    T = G[:, -1, :].copy()  # tip decluster, hem tips only, z pinned
    hem = np.where(~CE)[0]
    if len(hem):
        for _pass in range(2):
            D = np.linalg.norm(T[hem][:, None, :] - T[hem][None, :, :], axis=2)
            idx = np.argsort(D, axis=1)[:, 1:9]
            Th = T[hem]
            for a, gi in enumerate(hem):
                m = np.median(Th[idx[a]], axis=0)
                v = m - Th[a]; v[2] = 0; nv = float(np.linalg.norm(v))
                if nv > 1e-9:
                    cand = Th[a] + v / nv * min(nv * 0.5, 0.010)
                    if float(np.linalg.norm(cand - G[gi, -2])) >= 0.003: Th[a] = cand
            T[hem] = Th
        G[:, -1, :2] = T[:, :2]
    for gi in range(n):  # violator-only re-projection + tip placement
        for k in range(32):
            if RPH[gi, k] < 2:
                q, nn = nearest_pt(bvh_body, G[gi, k]); d = abs(sdist(G[gi, k], q, nn))
                dd, ins = clearance(G[gi, k])
                if ins or not (0.002 <= d <= 0.006):
                    G[gi, k] = project_out(G[gi, k])  # helper-collider intersections included
            else:
                dd, ins = clearance(G[gi, k])
                if ins or dd < 0.002: G[gi, k] = project_out(G[gi, k])
        if not CE[gi]:
            base = G[gi, -1].copy(); base[2] = zhem
            rad = base[:2] - np.array([cx, medy]); rad = rad / (np.linalg.norm(rad) + 1e-12)
            done = False
            for rr in np.arange(0, 0.031, 0.002):
                angs = [0.0] if rr == 0 else np.linspace(0, 2 * np.pi, 8, endpoint=False)
                for a in angs:
                    c = base.copy()
                    if rr > 0: c[:2] += (rad * np.cos(a) + np.array([-rad[1], rad[0]]) * np.sin(a)) * rr
                    dd, ins = clearance(c)
                    if not ins and dd >= 0.004: G[gi, -1] = c; done = True; break
                if done: break
            if not done: CE[gi] = True  # tip unplaceable at hem: contact-ended, keep traced tip
    for _sweep in range(3):  # enforce M9/G7: no segment shorter than 2.5mm
        fixed = 0
        for gi in range(n):
            for k in range(31):
                v = G[gi, k + 1] - G[gi, k]; L = float(np.linalg.norm(v))
                if L >= 0.0025: continue
                if L < 1e-9:
                    w = G[gi, min(k + 2, 31)] - G[gi, k] if k + 2 <= 31 else G[gi, k] - G[gi, max(k - 1, 0)]
                    v = w if float(np.linalg.norm(w)) > 1e-9 else np.array([1.0, 0.0, 0.0])
                    L = float(np.linalg.norm(v))
                G[gi, k + 1] = G[gi, k] + v / L * 0.0025
                if RPH[gi, k + 1] < 2:
                    q, nn = nearest_pt(bvh_body, G[gi, k + 1])
                    dd, ins = clearance(G[gi, k + 1])
                    if ins: G[gi, k + 1] = project_out(G[gi, k + 1])
                else:
                    dd, ins = clearance(G[gi, k + 1])
                    if ins or dd < 0.002: G[gi, k + 1] = project_out(G[gi, k + 1])
                fixed += 1
        if fixed == 0: break
    print("SEGFIX remainder=%d" % fixed)
    # Curves object
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
    print("CURVES count=%d" % len(go.data.curves))
    # ---- gates G1-G11 ----
    from collections import Counter as _C
    flat = G.reshape(-1, 3)
    print("XW " + " ".join("%.3f:%.1f" % (z, xw(z) * 1000) for z in (1.40, 1.45, 1.50, 1.52, 1.53, 1.55, 1.60)))
    g2min = 1e9; ins = 0; ins_by = _C(); ins_ph = _C()
    for gi in range(n):
        for k, p in enumerate(G[gi]):
            ss = []
            for o in colliders:
                q, n_ = nearest_pt(bvhs[o.name], p)
                if q is None: continue
                ss.append((sdist(p, q, n_), o.name))
            s0 = min(s for s, _ in ss)
            g2min = min(g2min, abs(s0))
            if s0 < 0:
                ins += 1; ins_by[min(ss)[1]] += 1; ins_ph[int(RPH[gi, k])] += 1
    print("G2 inside-by=%s phase=%s" % (dict(ins_by), dict(ins_ph)))
    g3bad = 0; g3n = 0; below = []
    for gi in range(n):
        for k, p in enumerate(G[gi]):
            q, nn = nearest_pt(bvh_body, p)
            d = abs(sdist(p, q, nn))
            if RPH[gi, k] < 2:
                g3n += 1
                if not (0.002 <= d <= 0.006): g3bad += 1
            elif p[2] <= menton:
                m = min(abs(sdist(p, *nearest_pt(bvhs[o.name], p))) for o in colliders)
                below.append(m)
    below = np.array(below)
    browz = float(W[(np.abs(W[:, 0] - cx) < 0.005) & (W[:, 1] < medy - 0.02)][:, 2].max())
    g6 = 0; g6ex = []; g6ph = _C()
    for gi in range(n):
        for k, p in enumerate(G[gi]):
            if menton <= p[2] <= browz and p[1] < ear_y and abs(p[0] - cx) < 0.80 * xw(p[2]):
                g6 += 1; g6ph[int(RPH[gi, k])] += 1
                if len(g6ex) < 5: g6ex.append(np.round(p * 1000, 1).tolist())
    print("G6 violators=%d ex=%s phase=%s" % (g6, g6ex, dict(g6ph)))
    rates = np.concatenate([turn_rates(g)[0] for g in G]) if n else np.array([0])
    g7p95, g7max = float(np.percentile(rates, 95)), float(rates.max())
    seglens = np.linalg.norm(np.diff(G, axis=0), axis=2)
    g7short = int((seglens < 0.0025).sum())
    tips = G[:, -1, :]; tz = np.abs(tips[:, 2] - zhem)
    g8hemdz = float(np.abs(tz[~CE]).max() * 1000) if (~CE).sum() else 0.0
    g8cfrac = float(CE.mean() * 100)
    D = np.linalg.norm(tips[:, None, :] - tips[None, :, :], axis=2); D.sort(axis=1)
    g8stray = float((np.median(D[:, 1:9], axis=1) > 0.025).mean() * 100)
    D2 = np.linalg.norm(V[:, None, :] - R[None, :, :], axis=2)
    g9max = float(D2.min(axis=1).max() * 1000)
    wi = int(D2.min(1).argmax())
    print("G9 worst vert=%s slitd=%.2fmm" % (np.round(V[wi] * 1000, 1).tolist(), float(np.linalg.norm(SV - V[wi], axis=1).min()) * 1000))
    g10 = float(abs(flat[:, 0].mean() - cx) * 1000)
    eyez = browz; band = flat[np.abs(flat[:, 2] - eyez) <= 0.012]
    lr = band[band[:, 0] > cx][:, 0]; ll = band[band[:, 0] <= cx][:, 0]
    g11gap = float(lr.min() - ll.max()) * 1000 if len(lr) and len(ll) else float("nan")
    g11req = 0.85 * 2 * xw(eyez) * 1000
    earband = flat[np.abs(flat[:, 2] - (ear_top - 0.015)) <= 0.015]
    g11outer = float(np.abs(earband[:, 0] - cx).max() * 1000) if len(earband) else float("nan")
    print("G11 gap=%.1f req=%.1f outer-ear=%.1fmm" % (g11gap, g11req, g11outer))
    gates = [
        ("G1", "%d" % n, "[350,450]", 350 <= n <= 450),
        ("G2", "inside=%d min=%.2fmm" % (ins, g2min * 1000), "0 ∧ >=2mm", ins == 0 and g2min >= 0.002),
        ("G3", "bad=%d/%d" % (g3bad, g3n), ">=99.5% in [2,6]mm", g3n > 0 and g3bad / g3n <= 0.005),
        ("G5", "p95=%.1fmm max=%.1fmm" % (float(np.percentile(below, 95)) * 1000, float(below.max()) * 1000) if len(below) else "n/a", "p95<=35 ∧ max<=65", len(below) and float(np.percentile(below, 95)) <= 0.035 and float(below.max()) <= 0.065),
        ("G6", "%d" % g6, "0", g6 == 0),
        ("G7", "p95=%.2f max=%.2f short=%d" % (g7p95, g7max, g7short), "p95<=8 ∧ max<=25 ∧ 0 short", g7p95 <= 8 and g7max <= 25 and g7short == 0),
        ("G8", "hemdz=%.2fmm cend=%.1f%% stray=%.2f%%" % (g8hemdz, g8cfrac, g8stray), "hem<=5mm ∧ cend<=10% ∧ stray<3%", (g8hemdz <= 5.0) and g8cfrac <= 10.0 and g8stray < 3),
        ("G9", "max=%.2fmm" % g9max, "<=9mm", g9max <= 9.0),
        ("G10", "|meanx|=%.2fmm" % g10, "<=5mm", g10 <= 5.0),
        ("G11", "gap=%.1fmm req=%.1fmm outer=%.1fmm" % (g11gap, g11req, g11outer), "gap>=req", g11gap >= g11req),
    ]
    for g, m, b, ok in gates: print("%s %s | %s %s" % (g, m, b, "PASS" if ok else "MISS"))
    np.savez(out / "guides2.npz", points=G, roots=R, contact_ended=CE, z_hem=zhem, menton_z=menton, crown_z=crown)
    row = {"gates": [{"gate": g, "measured": m, "bar": b, "verdict": "PASS" if ok else "MISS"} for g, m, b, ok in gates],
           "z_hem": zhem, "menton_z": menton, "crown_z": crown, "brow_z": browz, "ear_y": ear_y,
           "ear_top": ear_top, "yneck": yneck, "count": n, "contact_ended": int(CE.sum()),
           "xwide_eyez_mm": xw(eyez) * 1000, "g11_outer_ear_mm": g11outer}
    (out / "row-guides2.json").write_text(json.dumps(row, indent=1))
    # ---- renders: M10 orange tubes over body+garment, grey bg ----
    h.hair.hide_render = h.hair.hide_viewport = True
    cu = bpy.data.curves.new("OCLX_guide_tubes2", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.001
    for g in G:
        sp = cu.splines.new("POLY"); sp.points.add(31)
        for k, p in enumerate(g): sp.points[k].co = (float(p[0]), float(p[1]), float(p[2]), 1.0)
    to = bpy.data.objects.new("OCLX_guide_tubes2", cu); bpy.context.scene.collection.objects.link(to)
    om = bpy.data.materials.new("OCLX_guide_orange2"); om.use_nodes = True
    nt = om.node_tree; nt.nodes.clear()
    mout = nt.nodes.new("ShaderNodeOutputMaterial")
    pr = nt.nodes.new("ShaderNodeBsdfPrincipled"); pr.inputs["Base Color"].default_value = (0.62, 0.16, 0.015, 1.0); pr.inputs["Roughness"].default_value = 0.7
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (1.0, 0.35, 0.02, 1.0); em.inputs["Strength"].default_value = 1.0
    mx = nt.nodes.new("ShaderNodeMixShader"); mx.inputs[0].default_value = 0.25
    nt.links.new(pr.outputs[0], mx.inputs[1]); nt.links.new(em.outputs[0], mx.inputs[2]); nt.links.new(mx.outputs[0], mout.inputs[0])
    cu.materials.append(om)
    print("MAT slot=%s" % (to.material_slots[0].material.name if len(to.material_slots) else None))
    to.update_tag(); bpy.context.view_layer.update()
    sc = bpy.context.scene; sc.render.resolution_x = sc.render.resolution_y = 1024
    sc.cycles.samples = 32; sc.cycles.seed = 0
    cam = h.camera; tgt = Vector((cx, float(np.median(W[:, 1])), menton + 0.06)); dist = 0.85
    def track(o, t): o.rotation_euler = (Vector(t) - o.location).to_track_quat("-Z", "Y").to_euler()
    views = [("front", tgt + Vector((0, -dist, 0.02))), ("three_quarter", tgt + Vector((dist * 0.68, -dist * 0.68, 0.14))),
             ("profile", tgt + Vector((dist, 0, 0.02))), ("back", tgt + Vector((0, dist, 0.08))), ("top", tgt + Vector((0, -0.10, dist)))]
    for name, loc in views:
        cam.location = tuple(loc); track(cam, tgt)
        sc.render.filepath = str(out / ("v2_%s.png" % name)); bpy.ops.render.render(write_still=True)
    from PIL import Image, ImageDraw
    cells = [Image.open(out / ("v2_%s.png" % v)).convert("RGB") for v, _ in views]
    Wd, Hd = cells[0].size; lab = 36
    sheet = Image.new("RGB", (Wd * 5, Hd + lab), (20, 20, 20)); dr = ImageDraw.Draw(sheet)
    for k, (v, _) in enumerate(views):
        sheet.paste(cells[k], (k * Wd, lab)); dr.text((k * Wd + 10, 10), v, fill=(255, 165, 0))
    sheet.save(out / "guides-debug.png")
    T = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views")
    tf, tp = Image.open(T / "target-front.png").convert("RGB"), Image.open(T / "target-profile.png").convert("RGB")
    gf, gp = Image.open(out / "v2_front.png").convert("RGB"), Image.open(out / "v2_profile.png").convert("RGB")
    s2 = 512; box = Image.new("RGB", (s2 * 4, s2), (20, 20, 20))
    for k, im in (0, tf), (1, gf), (2, tp), (3, gp): box.paste(im.resize((s2, s2)), (k * s2, 0))
    box.save(out / "target-vs-guides.png")
    px = np.asarray(Image.open(out / "v2_front.png").convert("RGB"), dtype=float).reshape(-1, 3)
    br = px[px.max(axis=1) > 180]
    orfrac = float(((br[:, 0] > 150) & (br[:, 0] - br[:, 2] > 40)).mean()) if len(br) else 0.0
    print("ORANGE brightfrac=%.3f orangefrac=%.3f" % (len(br) / len(px), orfrac))
    print("WROTE", out)
main()
