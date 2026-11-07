"""Hair flow-8: mode-B flow + 300-root streamline test for cap-v7 (copied method).

Mode B (output, copied from C5/flow6.py M18-M23, not re-derived):
  M18: L = sign(x)*X projected on tangent plane; G = -Z projected on tangent.
  M19: w = clamp(n.z,0,1)^0.5; f = w*L + (1-w)*G.
  M20: no-forward rule in front of the ear line (FACE = -Y verified in P2).
  M21: midline behind apex (|x|<1mm): vertex sign; |x|<1mm uses G only.
  M22: 3 neighbour-average passes, never across slit / x=0 in front of apex.
  M23: 300 Poisson roots traced 2 mm steps, max 200 mm, exit classes.
D2 fix: cap material uses Attribute node + render mesh offset 0.8 mm along
  normals (flow-4 colours were lost to z-fighting with the head surface).
Adds: cap-v7 gates G1-G6, renders, row-cap7.json, RESULT.txt.
CLI: Blender -b --python flow8.py -- --out E
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

def boundary_info(F):
    cnt = defaultdict(list)
    for f in F:
        for k in range(3):
            a, b = f[k], f[(k + 1) % 3]; cnt[tuple(sorted((a, b)))].append(f)
    bnd = [e for e, v in cnt.items() if len(v) == 1]
    adj = defaultdict(set)
    for a, b in bnd: adj[a].add(b); adj[b].add(a)
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

def pchip(x, y):
    n = len(x); d = np.array([(y[k+1]-y[k])/(x[k+1]-x[k]) for k in range(n-1)])
    m = np.zeros(n); m[0] = d[0]; m[-1] = d[-1]
    for k in range(1, n-1):
        if d[k-1]*d[k] <= 0: m[k] = 0.0
        else:
            w1 = 2*(x[k+1]-x[k])+(x[k]-x[k-1]); w2 = (x[k+1]-x[k])+2*(x[k]-x[k-1])
            m[k] = (w1+w2)/(w1/d[k-1]+w2/d[k])
    def f(a):
        a = np.asarray(a, float); o = np.empty_like(a)
        lo = a <= x[0]; hi = a >= x[-1]; md = ~(lo|hi); o[lo] = y[0]; o[hi] = y[-1]
        if md.any():
            am = a[md]; k = np.searchsorted(x, am)-1; k = np.clip(k, 0, n-2)
            h = x[k+1]-x[k]; t = (am-x[k])/h
            o[md] = (2*t**3-3*t**2+1)*y[k]+(t**3-2*t**2+t)*h*m[k]+(-2*t**3+3*t**2)*y[k+1]+(t**3-t**2)*h*m[k+1]
        return o
    return f

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True)
    out = Path(ap.parse_args(sys.argv[sys.argv.index("--")+1:]).out); out.mkdir(parents=True, exist_ok=True)
    HS = load_hs(); h = HS.build_scene(); head = h.head
    Mw = head.matrix_world.copy()
    ws = np.array([tuple(Mw @ v.co) for v in head.data.vertices])
    xs, ys, zs = ws[:, 0], ws[:, 1], ws[:, 2]
    d = np.load(out/"cap-v7.npz")
    V = np.array(d["verts"]); F = [tuple(f) for f in np.array(d["faces"])]
    slit = sorted(int(v) for v in d["slit"]); fore = sorted(int(v) for v in d["forehead"])
    EXIT = sorted(int(v) for v in d["exit"]); tL, tR = (int(v) for v in d["temple"])
    cx, cy, crown = float(d["cx"]), float(d["cy"]), float(d["crown"])
    apex = np.array(d["apex"]); apex_y = float(d["apex_y"])
    ear_top, ear_y = float(d["ear_top"]), float(d["ear_y"])
    area = float(d["area_cm2"]); menton_z = float(d["menton_z"])
    brow_z, nasion_z = float(d["brow_z"]), float(d["nasion_z"])
    brow_id, nasion_id = int(d["brow_id"]), int(d["nasion_id"])
    Au, Eu = np.array(d["eh_A"]), np.array(d["eh_E"])
    ESET = np.array(d["eset"]); Cy, Cz = float(d["Cy"]), float(d["Cz"])
    sbL = sorted(int(v) for v in d["sideburn_L"]); sbR = sorted(int(v) for v in d["sideburn_R"])
    CANL, CANR = tuple(float(v) for v in d["canthus_L"]), tuple(float(v) for v in d["canthus_R"])
    print("CAP-V7 loaded v=%d f=%d area=%.1fcm2 eh_n=%d" % (len(V), len(F), area, len(Au)))
    mesh = bpy.data.meshes.new("Cap7_mesh")
    mesh.from_pydata(V.tolist(), [], [list(f) for f in F]); mesh.update()
    cap = bpy.data.objects.new("Cap7_scalp_cap", mesh); bpy.context.scene.collection.objects.link(cap); cap.matrix_world.identity()
    deps = bpy.context.evaluated_depsgraph_get(); cap.update_tag(); bpy.context.view_layer.update()
    bv = BVHTree.FromObject(head, deps, deform=True, cage=False); ev = head.evaluated_get(deps)
    w2l, l2w = ev.matrix_world.inverted(), ev.matrix_world
    E = set()
    for f in F:
        for i in range(3): E.add(tuple(sorted((f[i], f[(i+1) % 3]))))
    adjw = {i: [] for i in range(len(V))}
    for a, b in E:
        w = float(np.linalg.norm(V[a]-V[b])); adjw[a].append((b, w)); adjw[b].append((a, w))
    edge2f = defaultdict(list)
    for fi, f in enumerate(F):
        for k in range(3): edge2f[tuple(sorted((f[k], f[(k+1) % 3])))].append(fi)
    fseen, fcomp = {}, 0
    for fi in range(len(F)):
        if fi in fseen: continue
        st = [fi]; fseen[fi] = fcomp
        while st:
            x = st.pop(); f = F[x]
            for k in range(3):
                for y in edge2f[tuple(sorted((f[k], f[(k+1) % 3])))]:
                    if y not in fseen: fseen[y] = fcomp; st.append(y)
        fcomp += 1
    vcomp = np.full(len(V), -1)
    for fi, f in enumerate(F):
        for v in f:
            if vcomp[v] < 0: vcomp[v] = fseen[fi]
    print("FCOMP n=%d" % fcomp)
    bnd_edges, groups, order, cov, badj = boundary_info(F)
    for gi, gr in enumerate(groups):
        P = V[np.array(sorted(gr), dtype=np.int64)]; ce = P.mean(axis=0)
        de = float(np.linalg.norm(ESET-ce, axis=1).min()*1000)
        print("HOLE loop=%d n=%d centroid=(%.4f,%.4f,%.4f) ear_dist=%.1fmm" % (gi, len(gr), float(ce[0]), float(ce[1]), float(ce[2]), de))
    ball = np.array([v for g in groups for v in g]) if groups else np.array([], dtype=int)
    bset = set(int(v) for v in ball)
    sset0 = set(slit)
    SP = V[sorted(sset0)] if sset0 else np.zeros((0, 3))
    def near_slit(p, r=0.005):
        return len(SP) and bool((np.linalg.norm(SP-p, axis=1) < r).any())
    nbridge = 0
    if fcomp > 1:
        Bc = np.array(sorted(bset)); Bp = V[Bc]; Cb = vcomp[Bc]; NB = len(Bc); CH = 1024
        for i0 in range(0, NB, CH):
            D = np.linalg.norm(Bp[i0:i0+CH, None, :]-Bp[None, :, :], axis=2)
            ii, jj = np.where((D < 0.003) & (D > 1e-9) & (Cb[i0:i0+CH, None] != Cb[None, :]))
            for k in range(len(ii)):
                a, b = int(Bc[i0+ii[k]]), int(Bc[jj[k]])
                if a == b: continue
                if near_slit(V[a]) or near_slit(V[b]): continue
                w = float(D[ii[k], jj[k]]); adjw[a].append((b, w)); adjw[b].append((a, w)); nbridge += 1
        nbridge //= 2
        print("BRIDGE graph-edges=%d" % nbridge)
    else: print("BRIDGE none needed (1 component)")
    INF = float("inf"); phi = np.full(len(V), INF); ex = set(EXIT)
    for i in ex: phi[i] = 0.0
    hq = [(0.0, i) for i in ex]; heapq.heapify(hq)
    while hq:
        dd, x = heapq.heappop(hq)
        if dd > phi[x]: continue
        for y, w in adjw[x]:
            nd = dd+w
            if nd < phi[y]: phi[y] = nd; heapq.heappush(hq, (nd, y))
    nreach = int(np.isfinite(phi).sum())
    print("REACH %d/%d finite" % (nreach, len(V)))
    if 0 < nreach < len(V):
        phi = np.where(np.isinf(phi), phi[np.isfinite(phi)].max(), phi)
    nbrs = [[y for y, _ in adjw[i]] for i in range(len(V))]
    for _ in range(5):
        phi = np.array([0.0 if i in ex else float(np.mean([phi[j] for j in nbrs[i]])) if nbrs[i] else phi[i] for i in range(len(V))])
    bm2 = bmesh.new(); bm2.from_mesh(mesh); bm2.normal_update(); N = np.array([tuple(v.normal) for v in bm2.verts]); bm2.free()
    N = N/(np.linalg.norm(N, axis=1, keepdims=True)+1e-12)
    G = np.zeros((len(V), 3))
    EA = np.array(list(E)); A0, A1 = EA[:, 0], EA[:, 1]; DD = V[A1]-V[A0]; L2 = (DD**2).sum(axis=1, keepdims=True)+1e-12
    for sgn, (S, T) in ((1, (A0, A1)), (-1, (A1, A0))):
        Tm = DD*sgn; Tv = Tm-(Tm*N[S]).sum(axis=1, keepdims=True)*N[S]; W = (phi[T]-phi[S])/L2[:, 0]
        np.add.at(G, S, (Tv.T*W).T)
    Gn = np.linalg.norm(G, axis=1)
    Fl = np.zeros_like(G)
    for i in range(len(V)):
        if Gn[i] > 1e-12: Fl[i] = -G[i]/Gn[i]
        else: Fl[i] = np.array([1.0 if V[i][0] >= cx else -1.0, 0.0, 0.0])
    fA = Fl.copy()
    X = np.array([1.0, 0.0, 0.0]); Zdown = np.array([0.0, 0.0, -1.0]); Yback = np.array([0.0, -1.0, 0.0])
    sgnx = np.sign(V[:, 0]-cx)
    Lraw = (sgnx[:, None]*X[None, :])
    L = Lraw-(Lraw*N).sum(axis=1, keepdims=True)*N
    Ln = np.linalg.norm(L, axis=1, keepdims=True)
    L = np.where(Ln > 1e-6, L/np.maximum(Ln, 1e-12), 0.0)
    Craw = np.broadcast_to(Zdown, (len(V), 3)).copy()
    Gv = Craw-(Craw*N).sum(axis=1, keepdims=True)*N
    Gvn = np.linalg.norm(Gv, axis=1, keepdims=True)
    Gv = np.where(Gvn > 1e-6, Gv/np.maximum(Gvn, 1e-12), 0.0)
    w = np.clip(N[:, 2], 0.0, 1.0)**0.5
    fB = w[:, None]*L+(1.0-w)[:, None]*Gv
    m21 = (np.abs(V[:, 0]-cx) < 0.001) & (V[:, 1] > apex_y)
    fB[m21] = Gv[m21]
    def no_forward(f):
        fwd = f @ Yback
        front = (V[:, 1] < ear_y) & (fwd > 0)
        f[front] = f[front]-fwd[front, None]*Yback[None, :]
        f[front] = f[front]-(f[front]*N[front]).sum(axis=1, keepdims=True)*N[front]
        return f
    fB = no_forward(fB)
    fn = np.linalg.norm(fB, axis=1, keepdims=True)
    for i in range(len(V)):
        if fn[i, 0] > 1e-9: fB[i] = fB[i]/fn[i, 0]
        else: fB[i] = L[i] if np.linalg.norm(L[i]) > 1e-9 else np.array([1.0 if V[i][0] >= cx else -1.0, 0.0, 0.0])
    sset = set(slit)
    # M10 (7b): midline verts (|x-cx|<1.2mm, the slit-cut width) get sign 0
    # and never trigger cross-midline blocking on their own. The old code
    # forced them to +1, so every mid vertex smoothed only with its +x
    # neighbours: a one-sided bias that grows over 3 passes into p95 11deg
    # asymmetry on an otherwise mirror-symmetric cap (D4).
    mid = np.abs(V[:, 0]-cx) < 0.0012
    sgnz = np.where(mid, 0.0, np.where(sgnx >= 0, 1.0, -1.0))
    nblocked = 0
    for ps in range(3):
        fnew = fB.copy()
        for i in range(len(V)):
            acc = [fB[i]]
            for j in nbrs[i]:
                if sgnz[i] != 0.0 and sgnz[j] != 0.0 and sgnz[i] != sgnz[j] and 0.5*(V[i][1]+V[j][1]) <= apex_y+0.004:
                    nblocked += 1; continue
                if (i in sset or j in sset) and sgnz[i] != 0.0 and sgnz[j] != 0.0 and sgnz[i] != sgnz[j]:
                    nblocked += 1; continue
                acc.append(fB[j])
            m = np.mean(acc, axis=0)
            m = m-(m @ N[i])*N[i]
            if np.linalg.norm(m) > 1e-9: fnew[i] = m/np.linalg.norm(m)
        fB = no_forward(fnew)
        fn2 = np.linalg.norm(fB, axis=1, keepdims=True)
        for i in range(len(V)):
            if fn2[i, 0] > 1e-9: fB[i] = fB[i]/fn2[i, 0]
    print("M22 smooth-passes=3 blocked-neighbour-uses=%d" % nblocked)
    # M10 diagnosis + repair: mirror-partner angle per vertex BEFORE repair.
    _Vm = V.copy(); _Vm[:, 0] = 2*cx-_Vm[:, 0]
    _mir = np.zeros(len(V), dtype=int)
    for i0 in range(0, len(V), 1024):
        _D = np.linalg.norm(V[i0:i0+1024, None, :]-_Vm[None, :, :], axis=2)
        _mir[i0:i0+1024] = np.argmin(_D, axis=1)
    _Mir = np.zeros_like(fB); _Mir[:, 0] = -fB[_mir, 0]; _Mir[:, 1] = fB[_mir, 1]; _Mir[:, 2] = fB[_mir, 2]
    _ang = np.degrees(np.arccos(np.clip((fB*_Mir).sum(axis=1), -1.0, 1.0)))
    _p95 = float(np.percentile(_ang, 95))
    _worst = np.argsort(-_ang)[:5]
    for _k in _worst:
        print("SYM-DIFF vert=%d pos=(%.4f,%.4f,%.4f) ang=%.2fdeg mid=%d slit=%d partner=%d" % (
            int(_k), float(V[_k][0]), float(V[_k][1]), float(V[_k][2]), float(_ang[_k]),
            int(mid[_k]), int(_k in sset), int(_mir[_k])))
    print("SYM-PRE p95=%.3fdeg (worst zone: %s)" % (_p95,
        "slit/midline duplication" if any(mid[_k] or _k in sset for _k in _worst) else "side labelling"))
    if _p95 > 1.0:
        # repair: explicit mirror symmetrization (Jacobi smoothing above is
        # now side-symmetric; this zeroes the residual from mesh asymmetry)
        _avg = fB+_Mir
        _avg = _avg-(_avg*N).sum(axis=1, keepdims=True)*N
        _n = np.linalg.norm(_avg, axis=1, keepdims=True)
        for i in range(len(V)):
            fB[i] = _avg[i]/_n[i, 0] if _n[i, 0] > 1e-9 else fB[i]
        fB = no_forward(fB)
        _fn = np.linalg.norm(fB, axis=1, keepdims=True)
        for i in range(len(V)):
            if _fn[i, 0] > 1e-9: fB[i] = fB[i]/_fn[i, 0]
        print("SYM-REPAIR applied mirror-symmetrization")
    fset = set(fore)
    face_v = np.array([0.0, -1.0, 0.0])
    dfore = np.min(np.linalg.norm(V[:, None, :]-V[fore][None, :, :], axis=2), axis=1) if fore else np.full(len(V), 9.0)
    g5mask = dfore <= 0.015
    occ = crown-0.12
    g6mask = (np.abs(V[:, 0]-cx) > 0.02) & (V[:, 2] > ear_top)
    g7mask = (V[:, 1] > apex_y+0.01) & (V[:, 2] < occ)
    yslit = np.array([float(V[v][1]) for v in slit]) if slit else np.array([apex_y, apex_y])
    ymid = float(yslit.min()+0.5*(yslit.max()-yslit.min())) if len(yslit) else apex_y
    SP2 = V[sorted(sset0)] if sset0 else np.zeros((0, 3))
    dslit = np.min(np.linalg.norm(V[:, None, :]-SP2[None, :, :], axis=2), axis=1) if len(slit) else np.full(len(V), 9.0)
    g13mask = (dslit <= 0.025) & (V[:, 1] <= ymid) & (V[:, 1] >= float(yslit.min())-0.001)
    for v in sset0: g13mask[v] = False
    def gate_vals(Ff):
        fwd5 = Ff[g5mask] @ face_v
        g5pass = float((fwd5 <= 0.05).mean()) if len(fwd5) else 0.0
        g5max = float(fwd5.max()) if len(fwd5) else 9.0
        g6 = Ff[g6mask]
        g6v = float((np.sign(g6[:, 0]) == np.sign(V[g6mask][:, 0]-cx)).mean()) if len(g6) else 0.0
        g7 = Ff[g7mask]
        g7v = float((g7[:, 2] < 0).mean()) if len(g7) else 0.0
        g13 = Ff[g13mask]
        g13v = float((np.abs(g13[:, 0]) >= np.abs(g13[:, 1])).mean()) if g13mask.sum() else 0.0
        return g5pass, g5max, g6v, g7v, g13v
    g5A, g5maxA, g6A, g7A, g13A = gate_vals(fA)
    g5B, g5maxB, g6B, g7B, g13B = gate_vals(fB)
    print("G5 pass%% A=%.2f max=%.4f | B=%.2f max=%.4f (n=%d)" % (g5A*100, g5maxA, g5B*100, g5maxB, int(g5mask.sum())))
    print("G6 A=%.2f%% | B=%.2f%% (n=%d)" % (g6A*100, g6B*100, int(g6mask.sum())))
    print("G7 A=%.2f%% | B=%.2f%% (n=%d)" % (g7A*100, g7B*100, int(g7mask.sum())))
    print("G13 A=%.2f%% | B=%.2f%% (n=%d)" % (g13A*100, g13B*100, int(g13mask.sum())))
    def g15(Ff):
        angs = []
        for a, b in E:
            if sgnz[a] != sgnz[b] and 0.5*(V[a][1]+V[b][1]) <= apex_y+0.004: continue
            if (a in sset or b in sset) and sgnz[a] != sgnz[b]: continue
            c = float(np.clip(Ff[a] @ Ff[b], -1.0, 1.0))
            angs.append(math.degrees(math.acos(c)))
        return float(np.percentile(angs, 95)) if angs else 0.0, len(angs)
    g15A, n15 = g15(fA); g15B, _ = g15(fB)
    print("G15 p95deg A=%.2f | B=%.2f (edges=%d)" % (g15A, g15B, n15))
    fareas = np.array([0.5*np.linalg.norm(np.cross(V[b]-V[a], V[c]-V[a])) for a, b, c in F])
    rng = np.random.default_rng(0)
    cum = np.cumsum(fareas/fareas.sum())
    cand = []
    for _ in range(6000):
        fi = int(np.searchsorted(cum, rng.random()))
        a, b, c = F[fi]
        r1, r2 = rng.random(), rng.random()
        if r1+r2 > 1: r1, r2 = 1-r1, 1-r2
        cand.append(V[a]+r1*(V[b]-V[a])+r2*(V[c]-V[a]))
    cand = np.array(cand)
    order_c = rng.permutation(len(cand))
    roots = []
    dmin = 0.009
    for _try in range(6):
        roots = []
        for k in order_c:
            p = cand[k]
            if all(np.linalg.norm(p-q) >= dmin for q in roots):
                roots.append(p)
                if len(roots) >= 300: break
        if len(roots) >= 300: break
        dmin *= 0.8
    roots = np.array(roots)
    print("M23 roots=%d dmin=%.1fmm" % (len(roots), dmin*1000))
    kd = kdtree.KDTree(len(V))
    for i, p in enumerate(V): kd.insert(Vector(tuple(p)), i)
    kd.balance()
    bkd = kdtree.KDTree(len(ball))
    for k, vi in enumerate(ball): bkd.insert(Vector(tuple(V[int(vi)])), int(vi))
    bkd.balance()
    capBVH = BVHTree.FromPolygons([Vector(tuple(p)) for p in V], [tuple(f) for f in F])
    def exit_class_of(bi):
        if bi in fset: return "forehead"
        yb = float(V[bi][1])
        if yb < ear_y: return "temple-to-ear"
        if yb <= ear_y+0.030: return "behind-ear"
        return "nape"
    def trace(Ff):
        lines, raised, classes, turns, crosses = [], [], [], [], []
        nfore = nnever = ncross = 0
        for r in roots:
            p = Vector(tuple(r))
            poly = [tuple(p)]
            _, vi0, _ = kd.find(p)
            prev = Ff[vi0]/(np.linalg.norm(Ff[vi0])+1e-12)
            turn = 0.0
            crossed = False
            exited = None
            for _s in range(100):
                _, vi, _ = kd.find(p)
                fv = Ff[vi]; nl = float(np.linalg.norm(fv))
                if nl < 1e-9: break
                dd = fv/nl
                c = float(np.clip(prev @ dd, -1.0, 1.0))
                turn += math.degrees(math.acos(c))
                prev = dd
                p_new = p+Vector(tuple(dd*0.002))
                hit, _, _, _ = bv.find_nearest(w2l @ p_new)
                p_proj = (l2w @ hit) if hit is not None else p_new
                px, qx = float(p[0])-cx, float(p_proj[0])-cx
                if px*qx < 0 and min(float(p[1]), float(p_proj[1])) < apex_y:
                    crossed = True
                _, _, _, dist = capBVH.find_nearest(p_proj)
                if dist is None or float(dist) > 0.0015:
                    _, bi, _ = bkd.find(p_proj)
                    exited = exit_class_of(int(bi))
                    poly.append(tuple(p_proj))
                    break
                p = p_proj
                poly.append(tuple(p))
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
                rp.append(tuple(np.array(q)+N[vi]*0.0016))
            raised.append(np.array(rp))
        return lines, raised, classes, turns, crosses, nfore, nnever, ncross
    linesA, raisedA, clsA, turnA, crossA, nforeA, nneverA, ncrossA = trace(fA)
    linesB, raisedB, clsB, turnB, crossB, nforeB, nneverB, ncrossB = trace(fB)
    def hist(cls):
        hh = defaultdict(int)
        for c in cls: hh[c] += 1
        return {k: hh[k] for k in ("forehead", "temple-to-ear", "behind-ear", "nape", "never-left")}
    hA, hB = hist(clsA), hist(clsB)
    print("EXIT-HIST A "+str(hA)+" turn_med=%.1f turn_p95=%.1f" % (float(np.median(turnA)), float(np.percentile(turnA, 95))))
    print("EXIT-HIST B "+str(hB)+" turn_med=%.1f turn_p95=%.1f" % (float(np.median(turnB)), float(np.percentile(turnB, 95))))
    sink_idx = [i for i, c in enumerate(clsB) if c == "never-left"]
    print("SINK-B count=%d roots=%s" % (len(sink_idx), sink_idx[:5]))
    for si in sink_idx[:2]:
        P = np.array(linesB[si]); tip = P[-1]
        dv = np.linalg.norm(V-tip, axis=1); vi = int(dv.argmin())
        _, bi, _ = bkd.find(Vector(tuple(tip)))
        print("SINK root=%d tip=(%.4f,%.4f,%.4f) vert=%d vpos=(%.4f,%.4f,%.4f) tipcls=%s tippind=%.2fmm" % (si, float(tip[0]), float(tip[1]), float(tip[2]), vi, float(V[vi][0]), float(V[vi][1]), float(V[vi][2]), exit_class_of(int(bi)), float(dv[vi])*1000))
    print("G14 A fore=%d never=%d cross=%d | B fore=%d never=%d cross=%d" % (nforeA, nneverA, ncrossA, nforeB, nneverB, ncrossB))
    Vm = V.copy(); Vm[:, 0] = 2*cx-Vm[:, 0]
    mir_idx = np.zeros(len(V), dtype=int)
    for i0 in range(0, len(V), 1024):
        D = np.linalg.norm(V[i0:i0+1024, None, :]-Vm[None, :, :], axis=2)
        mir_idx[i0:i0+1024] = np.argmin(D, axis=1)
    Mir = np.zeros_like(fB); Mir[:, 0] = -fB[mir_idx, 0]; Mir[:, 1] = fB[mir_idx, 1]; Mir[:, 2] = fB[mir_idx, 2]
    sym95 = float(np.percentile(np.degrees(np.arccos(np.clip((fB*Mir).sum(axis=1), -1.0, 1.0))), 95))
    print("SYM95 %.3fdeg" % sym95)
    np.savez(out/"flow-b-v7.npz", verts=V, faces=np.array(F), f=fB, fA=fA, w=w, roots=roots, exit_classes=np.array(clsB), slit=np.array(slit), forehead=np.array(fore), exit=np.array(EXIT), cx=cx, apex_y=apex_y, ear_y=ear_y)
    slines_obj = np.empty(len(linesB), dtype=object)
    for i, P in enumerate(linesB): slines_obj[i] = P
    _z = np.load(out/"flow-b-v7.npz")
    np.savez(out/"flow-b-v7.npz", **{k: _z[k] for k in _z.files}, slines=slines_obj)
    print("SAVED flow-b-v7.npz roots=%d slines=%d" % (len(roots), len(linesB)))
    H_HEAD = 0.2107; H_PX = 458.0; P2_HPX = 452.0; PX2M = H_HEAD/P2_HPX
    P1_ROWS = {0: (208, 208), 20: (211, 211), 40: (212, 213), 60: (224, 219), 80: (245, 238), 100: (303, 284)}
    P1_H = np.array([0.87336, 0.86681, 0.86354, 0.84389, 0.80022, 0.68668])
    P2_ROWS = [220, 250, 280, 310, 340, 370, 400, 430]; P2_COLS = [390, 398, 403, 408, 413, 422, 436, 443]
    P2_EYE = (347, 348); P2_OFF = [(c-P2_EYE[0])/P2_HPX for c in P2_COLS]
    _v5 = np.load(str(HERE.parent/"hair-cap5"/"cap-v5.npz"))
    V5 = np.array(_v5["verts"]); F5 = [tuple(f) for f in np.array(_v5["faces"])]
    CANY = 0.5*(CANL[1]+CANR[1]); CANZ = 0.5*(CANL[2]+CANR[2])
    ZB = float(d["pinna_lobe_L"][2])+0.015
    def fore_z(FV, FS, side, xmm):
        vs = [v for v in FS if (float(FV[v][0]) <= cx if side <= 0 else float(FV[v][0]) > cx)]
        ax = sorted(((abs(float(FV[v][0])-cx), float(FV[v][2])) for v in vs))
        if not ax: return None
        if xmm <= ax[0][0]: return ax[0][1]
        for k in range(len(ax)-1):
            if ax[k][0] <= xmm <= ax[k+1][0]:
                x0, z0 = ax[k]; x1, z1 = ax[k+1]; u = 0.0 if x1 == x0 else (xmm-x0)/(x1-x0)
                return z0+u*(z1-z0)
        return ax[-1][1]
    P1_MEAN = {dx: (608-0.5*(P1_ROWS[dx][0]+P1_ROWS[dx][1]))/H_PX for dx in (0, 20, 40, 60, 80, 100)}
    g2rows = []
    for dx in (0, 20, 40, 60, 80, 100):
        xmm = dx/H_PX*H_HEAD
        if dx == 0:
            z7 = fore_z(V, set(fore), 0, 0.0); z5 = fore_z(V5, set(int(v) for v in _v5["forehead"]), 0, 0.0)
            g2rows.append({"dx": dx, "side": "C", "hT": float(P1_MEAN[dx]), "h5": float((z5-menton_z)/H_HEAD), "h7": float((z7-menton_z)/H_HEAD), "z7": float(z7)})
        else:
            for side, nm in ((-1, "L"), (1, "R")):
                z7 = fore_z(V, set(fore), side, xmm); z5 = fore_z(V5, set(int(v) for v in _v5["forehead"]), side, xmm)
                g2rows.append({"dx": dx, "side": nm, "hT": float(P1_MEAN[dx]), "h5": float((z5-menton_z)/H_HEAD), "h7": float((z7-menton_z)/H_HEAD), "z7": float(z7)})
    g2err = max(abs(r["hT"]-r["h7"]) for r in g2rows)
    mir = 0.0
    for dx in (20, 40, 60, 80, 100):
        zL = next(r["z7"] for r in g2rows if r["dx"] == dx and r["side"] == "L")
        zR = next(r["z7"] for r in g2rows if r["dx"] == dx and r["side"] == "R")
        mir = max(mir, abs(zL-zR))
    curtL = [v for v in sbL if float(V[v][1]) < -0.080]; curtR = [v for v in sbR if float(V[v][1]) < -0.080]
    zBL = float(V[curtL][:, 2].min()) if curtL else 9.0
    zBR = float(V[curtR][:, 2].min()) if curtR else 9.0
    mir = max(mir, abs(zBL-zBR))
    print("G4CURT curtL=%d curtR=%d zBL=%.4f zBR=%.4f" % (len(curtL), len(curtR), zBL, zBR))
    g2p = all(abs(r["hT"]-r["h7"]) <= 0.02 for r in g2rows)
    print("G2 maxerr=%.4fH mirror=%.2fmm %s" % (g2err, mir*1000, "PASS" if (g2p and mir*1000 <= 1.0) else "MISS"))
    g1v = area
    TA = np.array(F); TC = V[TA].mean(axis=1)
    FA = np.array([0.5*float(np.linalg.norm(np.cross(V[b]-V[a], V[c]-V[a]))) for a, b, c in F])
    sbm = (np.abs(TC[:, 0]-cx) > 0.0475) & (TC[:, 1] <= -0.060) & (TC[:, 2] >= ZB-0.005)
    sbLmask = sbm & (TC[:, 0] > cx); sbRmask = sbm & (TC[:, 0] <= cx)
    sbLc, sbRc = float(FA[sbLmask].sum()*1e4), float(FA[sbRmask].sum()*1e4)
    fs = [[vv for vv in p.vertices] for p in head.data.polygons]
    cfs = np.array([ws[f].mean(axis=0) for f in fs])
    dd = cfs-np.array([cx, Cy, Cz]); rr = np.linalg.norm(dd, axis=1)+1e-12
    Ac = np.abs(np.degrees(np.arctan2(cfs[:, 0]-cx, -(cfs[:, 1]-Cy))))
    Ec = np.degrees(np.arcsin(np.clip((cfs[:, 2]-Cz)/rr, -1, 1)))
    ehf = pchip(Au, Eu)
    gc = np.empty(len(cfs))
    for i0 in range(0, len(cfs), 2048):
        gc[i0:i0+2048] = np.linalg.norm(cfs[i0:i0+2048, None, :]-ESET[None, :, :], axis=2).min(axis=1)-0.005
    fareas = np.array([float(sum(0.5*np.linalg.norm(np.cross(ws[f[0]]-ws[f[k]], ws[f[0]]-ws[f[k+1]])) for k in (1, 2))) if len(f) > 3 else 0.5*float(np.linalg.norm(np.cross(ws[f[1]]-ws[f[0]], ws[f[2]]-ws[f[0]]))) for f in fs])
    ehm = ehf(np.clip(Ac, Au[0], Au[-1]))
    _ehm2 = ehf(np.clip(Ac, float(Au[0]), float(Au[-1])))
    earhole = float(fareas[(gc < 0) & (Ec > ehm-2.0) & (cfs[:, 2] > menton_z-0.02)].sum()*1e4)
    _eL = float(fareas[(gc < 0) & (Ec > ehm-2.0) & (cfs[:, 2] > menton_z-0.02) & (cfs[:, 0] > cx)].sum()*1e4)
    _eR = float(fareas[(gc < 0) & (Ec > ehm-2.0) & (cfs[:, 2] > menton_z-0.02) & (cfs[:, 0] <= cx)].sum()*1e4)
    print("EARHOLE total=%.1f L=%.1f R=%.1f (gate [6,16] per side)" % (earhole, _eL, _eR))
    v5area = float(_v5["area_cm2"])
    removed = v5area-g1v+sbLc+sbRc+earhole
    g1p = (600 <= g1v <= 690) and (fcomp == 1) and (len(groups) == 1) and (mir*1000 <= 1.0)
    print("G1 area=%.1f [600,690] removed=%.1f sbL=%.1f sbR=%.1f earhole=%.1f ncomp=%d nloops=%d mirror=%.2f %s" % (g1v, removed, sbLc, sbRc, earhole, fcomp, len(groups), mir*1000, "PASS" if g1p else "MISS"))
    def zone(vid):
        x, y, z = float(V[vid][0]), float(V[vid][1]), float(V[vid][2])
        if abs(x-cx) <= 0.008 and y <= apex_y+0.003: return "slit"
        if y > -0.0089: return "nape"
        if abs(x-cx) <= 0.052 and y <= float(ear_y)-0.010: return "front"
        if abs(x-cx) > 0.0475 and y <= -0.060: return "sideburn"
        return "behind-ear"
    g3max, g3w = 0.0, None
    zmax = {}
    for run in runs_for(badj, [int(v) for v in ball]):
        n = len(run)
        if n < 3: continue
        cl = run[0] in badj[run[-1]]
        for k in range(n):
            idx = [run[(k+j) % n] for j in range(-4, 5)] if cl else [run[k+j] for j in range(-4, 5) if 0 <= k+j < n]
            dd = float(np.linalg.norm(V[run[k]]-V[idx].mean(axis=0)))
            zn = zone(run[k])
            if dd > zmax.get(zn, 0.0): zmax[zn] = dd
            if dd > g3max: g3max, g3w = dd, (int(run[k]), zn)
    g3p = g3max*1000 <= 3.0
    print("G3 step=%.3fmm at=%s zone=%s %s" % (g3max*1000, g3w[0] if g3w else None, g3w[1] if g3w else None, "PASS" if g3p else "MISS"))
    print("G3ZONES "+" ".join("%s=%.2f" % (k, v*1000) for k, v in sorted(zmax.items())))
    g4rows = []
    for r, c in zip(P2_ROWS, P2_COLS):
        z = CANZ+(P2_EYE[1]-r)*PX2M; yv = CANY+((c-P2_EYE[0])/P2_HPX)*H_HEAD
        for sd, ids in (("L", sbL), ("R", sbR)):
            yz = [float(V[v][1]) for v in ids if abs(float(V[v][2])-z) <= 0.003 and float(V[v][1]) < -0.080]
            g4rows.append({"row": r, "side": sd, "setback_mm": float((min(yz)-yv)*1000) if yz else 9.0})
    a_min = min(r["setback_mm"] for r in g4rows); a_max = max(r["setback_mm"] for r in g4rows)
    dd2 = np.linalg.norm(V[:, None, :]-ESET[None, :, :], axis=2).min(axis=1)
    g4b = float(dd2.min()*1000); g4bi = int(dd2.argmin())
    cmm = (np.abs(V[:, 0]-cx) > 0.044) & (V[:, 2] < 1.60)
    g4c = float((CANY-V[cmm][:, 1].min())*1000) if int(cmm.sum()) else -99.0
    bLmm = float((zBL-ZB)*1000); bRmm = float((zBR-ZB)*1000)
    g4p = all(8.0 <= r["setback_mm"] <= 14.0 for r in g4rows) and (abs(bLmm) <= 8.0) and (abs(bRmm) <= 8.0) and (g4b > 4.0) and (g4c <= 0.0)
    print("G4 setback=[%.1f,%.1f] botL=%.1f botR=%.1f pinna=%.2f@%d canthus=%.2f %s" % (a_min, a_max, bLmm, bRmm, g4b, g4bi, g4c, "PASS" if g4p else "MISS"))
    A1 = np.abs(np.degrees(np.arctan2(ws[:, 0]-cx, -(ws[:, 1]-Cy)))); rr1 = np.linalg.norm(ws-np.array([cx, Cy, Cz]), axis=1)+1e-12
    E1 = np.degrees(np.arcsin(np.clip((ws[:, 2]-Cz)/rr1, -1, 1)))
    ehh = ehf(np.clip(A1, Au[0], Au[-1]))
    g1v_ = np.empty(len(ws))
    for i0 in range(0, len(ws), 2048):
        g1v_[i0:i0+2048] = np.linalg.norm(ws[i0:i0+2048, None, :]-ESET[None, :, :], axis=2).min(axis=1)-0.005
    qual = np.where((E1 > ehh+3.0) & (g1v_ > 0.003) & (zs > menton_z-0.02))[0]
    uncov = []
    for i in qual:
        _, _, _, dd = capBVH.find_nearest(Vector(tuple(ws[i])))
        if dd is None or float(dd) > 0.0025: uncov.append(int(i))
    cov = 1.0-len(uncov)/max(1, len(qual))
    g5p = len(uncov) == 0
    print("G5 qual=%d uncovered=%d cov=%.4f %s" % (len(qual), len(uncov), cov, "PASS" if g5p else "MISS"))
    for i in uncov[:5]:
        _, _, _, ddu = capBVH.find_nearest(Vector(tuple(ws[int(i)])))
        print("G5MISS vert=%d pos=(%.4f,%.4f,%.4f) d=%.2fmm" % (int(i), float(ws[int(i)][0]), float(ws[int(i)][1]), float(ws[int(i)][2]), float(ddu)*1000 if ddu is not None else -1))
    fore_pct = nforeB/max(1, len(roots))
    g6p = (g13B >= 0.90) and (g7B >= 0.95) and (g15B <= 25.0) and (ncrossB == 0) and (nneverB == 0) and (nneverB == 0) and (fore_pct <= 0.02) and (sym95 <= 1.0)
    print("G6 sideways=%.2f backdown=%.2f smooth=%.2f cross=%d sinks=%d never=%d fore=%.2f%% sym95=%.3f %s" % (g13B, g7B, g15B, ncrossB, nneverB, nneverB, fore_pct*100, sym95, "PASS" if g6p else "MISS"))
    for o in bpy.data.objects:
        if o is not cap and o.type in {"CURVES", "CURVE"}: o.hide_render = o.hide_viewport = True
        if "hair" in o.name.lower() and o is not cap: o.hide_render = o.hide_viewport = True
    mesh.color_attributes.new("WCol", "FLOAT_COLOR", "POINT")
    ca = mesh.color_attributes["WCol"]
    for i in range(len(V)):
        t = float(w[i])
        c = (0.10+0.90*t, 0.30+0.15*t, 1.00-0.95*t, 1.0)
        if i in ex: c = (0.1, 0.9, 0.2, 1.0)
        if i in fset: c = (0.95, 0.1, 0.8, 1.0)
        if i in sset: c = (1.0, 1.0, 1.0, 1.0)
        ca.data[i].color = c
    bmR = bmesh.new(); bmR.from_mesh(mesh); bmR.verts.ensure_lookup_table(); bmR.normal_update()
    for v in bmR.verts: v.co = v.co+v.normal*0.0008
    bmR.to_mesh(mesh); bmR.free(); mesh.update()
    mcap = bpy.data.materials.new("Cap7CapMat"); mcap.use_nodes = True; nt = mcap.node_tree
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
            sp = cu.splines.new("POLY"); sp.points.add(len(run)-1)
            for k, i in enumerate(run): sp.points[k].co = (float(V[i][0]), float(V[i][1]), float(V[i][2])+0.001, 1.0)
            sp.use_cyclic_u = False
        o = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(o)
        m = bpy.data.materials.new(name+"M"); m.use_nodes = True
        e = m.node_tree.nodes.new("ShaderNodeEmission"); e.inputs[0].default_value = (*rgb, 1.0); e.inputs[1].default_value = 3.0
        m.node_tree.links.new(e.outputs[0], m.node_tree.nodes["Material Output"].inputs[0]); o.data.materials.append(m); return o
    tube("Cap7_EXIT", runs_for(badj, ex) or [sorted(bset)], (0.1, 0.9, 0.2), 0.0012)
    tube("Cap7_FORE", runs_for(badj, fset) or [[tL]], (0.95, 0.1, 0.8), 0.0016)
    sw = sorted(slit, key=lambda i: float(V[i][1])); tube("Cap7_SLIT", runs_for(badj, sset) or [[i for i in sw if V[i][0] <= cx], [i for i in sw if V[i][0] > cx]], (1, 1, 1), 0.0016)
    def arrows(name, Ff, rgb):
        sel = []
        for i in np.argsort(-V[:, 2]):
            p = V[i]
            if all(np.linalg.norm(p-V[j]) >= 0.010 for j in sel): sel.append(int(i))
            if len(sel) >= 700: break
        av, af = [], []
        for s in sel:
            nn = N[s]
            p, u = V[s]+nn*0.0028, Ff[s]
            wv = np.cross(u, nn)
            if np.linalg.norm(wv) < 1e-6: wv = np.cross(u, np.array([0.0, 0.0, 1.0]))
            if np.linalg.norm(wv) < 1e-6: wv = np.array([1.0, 0.0, 0.0])
            wv = wv/np.linalg.norm(wv); v2 = np.cross(nn, u); v2 = v2/(np.linalg.norm(v2)+1e-12)
            b = len(av)
            for k in range(6):
                a = k/6*2*math.pi; dd = wv*math.cos(a)+v2*math.sin(a)
                av.append(tuple(p+dd*0.0011)); av.append(tuple(p+u*0.005+dd*0.0011))
            for k in range(6):
                k2 = (k+1) % 6; af.append((b+2*k, b+2*k2, b+2*k2+1, b+2*k+1))
            hb = len(av); tip = tuple(p+u*0.008)
            for k in range(6):
                a = k/6*2*math.pi; dd = wv*math.cos(a)+v2*math.sin(a); av.append(tuple(p+u*0.005+dd*0.0024))
            av.append(tip)
            for k in range(6): af.append((hb+k, hb+(k+1) % 6, hb+6))
        am = bpy.data.meshes.new(name); am.from_pydata(av, [], af); am.update()
        ao = bpy.data.objects.new(name, am); bpy.context.scene.collection.objects.link(ao)
        amat = bpy.data.materials.new(name+"M"); amat.use_nodes = True
        am2 = amat.node_tree.nodes["Principled BSDF"]; am2.inputs["Base Color"].default_value = (*rgb, 1.0)
        am.materials.append(amat); return ao
    aoA = arrows("Cap7ArrowsA", fA, (0.35, 0.05, 0.05))
    aoB = arrows("Cap7ArrowsB", fB, (0.02, 0.02, 0.02))
    cu = bpy.data.curves.new("Cap7SLines", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.0004
    for P in raisedB:
        Q = P[::2]
        if len(Q) < 2: continue
        sp = cu.splines.new("POLY"); sp.points.add(len(Q)-1)
        for k, q in enumerate(Q): sp.points[k].co = (float(q[0]), float(q[1]), float(q[2]), 1.0)
    so = bpy.data.objects.new("Cap7SLines", cu); bpy.context.scene.collection.objects.link(so)
    sm = bpy.data.materials.new("Cap7SLinesM"); sm.use_nodes = True
    se = sm.node_tree.nodes.new("ShaderNodeEmission"); se.inputs[0].default_value = (0.05, 0.03, 0.02, 1.0); se.inputs[1].default_value = 1.0
    sm.node_tree.links.new(se.outputs[0], sm.node_tree.nodes["Material Output"].inputs[0]); so.data.materials.append(sm)
    cap.update_tag(); aoA.update_tag(); aoB.update_tag(); so.update_tag(); bpy.context.view_layer.update()
    HSET3 = ws[zs > crown-0.26]; hmin, hmax = HSET3.min(axis=0), HSET3.max(axis=0)
    HC = (hmin+hmax)/2; HH = float(hmax[2]-hmin[2])
    dist = (HH/0.70)/(2*math.tan(math.atan(18.0/50.0)))
    cam = h.camera; sc = bpy.context.scene
    def track(o, t): o.rotation_euler = (Vector(t)-o.location).to_track_quat("-Z", "Y").to_euler()
    views = [("front", HC+np.array([0, -dist, 0.03])), ("three_quarter", HC+np.array([dist*0.68, -dist*0.68, 0.15])), ("profile", HC+np.array([dist, 0, 0.03])), ("back", HC+np.array([0, dist, 0.10])), ("top", HC+np.array([0, -0.12, dist]))]
    sc.render.resolution_x = sc.render.resolution_y = 1024; sc.cycles.samples = 12; sc.cycles.seed = 0
    for o in [aoB, so]: o.hide_render = o.hide_viewport = False
    aoA.hide_render = aoA.hide_viewport = True
    bpy.context.view_layer.update()
    cellpaths = {}
    for name, loc in views:
        cam.location = tuple(loc); track(cam, HC)
        p = out/("dbg_%s.png" % name)
        sc.render.filepath = str(p); bpy.ops.render.render(write_still=True)
        cellpaths[name] = p
    from PIL import Image, ImageDraw
    vnames2 = [v[0] for v in views]
    strip = [Image.open(cellpaths[v]).convert("RGB") for v in vnames2]
    W2, H2 = strip[0].size; lab2 = 40
    dbg = Image.new("RGB", (W2*5, H2+lab2), (20, 20, 20)); dd = ImageDraw.Draw(dbg)
    for k, v in enumerate(vnames2):
        dbg.paste(strip[k], (k*W2, lab2))
        dd.text((k*W2+10, lab2-28), "cap-v7 modeB+slines %s" % v, fill=(255, 255, 0))
    dbg.save(out/"cap7-debug.png")
    for o in [aoA, aoB, so]: o.hide_render = o.hide_viewport = True
    bpy.context.view_layer.update()
    def tube_pts(name, runs_pts, rgb, r):
        runs_pts = [q for q in runs_pts if len(q) >= 1]
        if not runs_pts: return None
        cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = r
        for q in runs_pts:
            if len(q) == 1: q = [q[0], q[0]]
            sp = cu.splines.new("POLY"); sp.points.add(len(q)-1)
            for k, pt in enumerate(q): sp.points[k].co = (float(pt[0]), float(pt[1]), float(pt[2]), 1.0)
            sp.use_cyclic_u = False
        o = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(o)
        m = bpy.data.materials.new(name+"M"); m.use_nodes = True
        e = m.node_tree.nodes.new("ShaderNodeEmission"); e.inputs[0].default_value = (*rgb, 1.0); e.inputs[1].default_value = 3.0
        m.node_tree.links.new(e.outputs[0], m.node_tree.nodes["Material Output"].inputs[0]); o.data.materials.append(m); return o
    cnt5 = defaultdict(list)
    for f in F5:
        for k in range(3):
            a, b = f[k], f[(k+1) % 3]; cnt5[tuple(sorted((a, b)))].append(f)
    badj5 = defaultdict(set)
    for (a, b), _fs in cnt5.items():
        if len(_fs) == 1: badj5[a].add(b); badj5[b].add(a)
    off = np.array([0.0, 0.0, 0.001])
    bnd5all = set(badj5.keys()); bnd7all = set(badj.keys())
    print("TUBES v5bnd=%d v7bnd=%d (FULL loops)" % (len(bnd5all), len(bnd7all)))
    tube_pts("Cap7_BNDv5", [V5[r]+off for r in runs_for(badj5, bnd5all)], (0.95, 0.08, 0.08), 0.0016)
    tube_pts("Cap7_BNDv7", [V[r]+off for r in runs_for(badj, bnd7all)], (0.05, 0.9, 0.25), 0.0016)
    _dots = [tuple(float(v) for v in d["pinna_"+k+"_"+s]) for s in ("L", "R") for k in ("front", "top", "lobe")]
    tube_pts("Cap7_EARDOTS", [[p] for p in _dots], (1.0, 0.9, 0.1), 0.0022)
    mfill = bpy.data.materials.new("Cap7Fill"); mfill.use_nodes = True; fn2 = mfill.node_tree
    fn2.nodes.clear(); fo = fn2.nodes.new("ShaderNodeOutputMaterial"); ge = fn2.nodes.new("ShaderNodeEmission")
    ge.inputs[0].default_value = (0.05, 0.9, 0.25, 1.0); ge.inputs[1].default_value = 1.5
    fn2.links.new(ge.outputs[0], fo.inputs[0])
    mesh.materials.clear(); mesh.materials.append(mfill)
    cap.hide_render = cap.hide_viewport = False
    head.hide_render = head.hide_viewport = False
    bpy.context.view_layer.update()
    cam.location = tuple(HC+np.array([0, -dist, 0.03])); track(cam, HC)
    bpy.context.view_layer.update()
    sc.render.filepath = str(out/"compare-head.png"); bpy.ops.render.render(write_still=True)
    from bpy_extras.object_utils import world_to_camera_view as _w2c
    cuv = _w2c(sc, cam, Vector((cx, apex_y, crown))); chv = _w2c(sc, cam, Vector((cx, -0.145, menton_z)))
    Hh, Ww = sc.render.resolution_y, sc.render.resolution_x
    crown_row = (1.0-cuv.y)*Hh; chin_row = (1.0-chv.y)*Hh
    print("COMPARE crown_row=%.1f chin_row=%.1f span=%.1f" % (crown_row, chin_row, chin_row-crown_row))
    tgt = Image.open("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back/target-front.png").convert("RGB")
    tpanel = tgt.crop((0, 150, 1024, 608)); td = ImageDraw.Draw(tpanel)
    tpts = []
    for dx in (-100, -80, -60, -40, -20, 0, 20, 40, 60, 80, 100):
        rm = 0.5*(P1_ROWS[abs(dx)][0]+P1_ROWS[abs(dx)][1])
        tpts.append((513+dx, rm-150))
    td.line(tpts, fill=(0, 255, 0), width=3)
    for (x, y) in tpts: td.ellipse([x-5, y-5, x+5, y+5], outline=(0, 255, 0), width=2)
    td.text((10, 8), "target + P1 (green)", fill=(0, 255, 0))
    cmpim = Image.open(out/"compare-head.png").convert("RGB")
    span = chin_row-crown_row; scl = 458.0/span
    hpanel = cmpim.crop((0, int(round(crown_row)), 1024, int(round(chin_row)))).resize((int(round(1024*scl)), 458))
    hd = ImageDraw.Draw(hpanel)
    hd.text((10, 8), "head + v5 boundary (red) + v7 FILLED (green) + ear dots", fill=(0, 255, 0))
    comp = Image.new("RGB", (1024+hpanel.size[0]+20, 458+40), (20, 20, 20)); cd = ImageDraw.Draw(comp)
    comp.paste(tpanel, (0, 40)); comp.paste(hpanel, (1044, 40))
    cd.text((10, 8), "hairline-compare: same crown-to-chin scale (458px)", fill=(255, 255, 0))
    comp.save(out/"hairline-compare.png")
    cam.location = tuple(HC+np.array([dist, 0, 0.03])); track(cam, HC)
    bpy.context.view_layer.update()
    sc.render.filepath = str(out/"compare-profile.png"); bpy.ops.render.render(write_still=True)
    tgtP = Image.open("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back/target-profile.png").convert("RGB")
    tpd = ImageDraw.Draw(tgtP)
    P2PTS = list(zip(P2_COLS, P2_ROWS))
    tpd.line(P2PTS, fill=(255, 0, 255), width=3)
    for (x, y) in P2PTS: tpd.ellipse([x-5, y-5, x+5, y+5], outline=(255, 0, 255), width=2)
    tpd.text((10, 8), "target + P2 visible edge (magenta)", fill=(255, 0, 255))
    cmpP = Image.open(out/"compare-profile.png").convert("RGB")
    prof = Image.new("RGB", (1024+1024+20, 1024+40), (20, 20, 20)); pd = ImageDraw.Draw(prof)
    prof.paste(tgtP, (0, 40)); prof.paste(cmpP, (1044, 40))
    pd.text((10, 8), "profile: target + P2 edge | head + FULL v5 (red) + v7 FILLED (green) + ear dots (yellow)", fill=(255, 255, 0))
    prof.save(out/"hairline-compare-profile.png")
    import json as J
    rowcap = {
        "p1": {"face_cx": 513, "hair_top_row": 127, "skull_crown_row": 150, "chin_row": 608, "H_px": 458,
               "method": "vertical gradient + 2D temple line-fit; centre part-tip +-5px, outer +-6px",
               "rows_LR": {str(k): list(v) for k, v in sorted(P1_ROWS.items())},
               "h_frac_avg": [round(float(v), 5) for v in P1_H],
               "dx_over_H": [round(float(v/H_PX), 5) for v in (0, 20, 40, 60, 80, 100)]},
        "p2": {"profile_H": 452, "rows": list(P2_ROWS), "hair_front_col": list(P2_COLS),
               "eye_outer_col": 347, "eye_row": 348, "offsets_H": [round(float(o), 4) for o in P2_OFF],
               "lobe_row_est": 457.0, "departure_row": 475.0, "root_bottom_row": 425.0,
               "note": "forward-most hair col per row on JM mask-profile-v2; lobe eye-mapped from our-lobe z=1.5037; departure where edge leaves cheek; root bottom = lobe+15mm"},
        "p3": {"canthus_L": [round(float(v), 5) for v in CANL], "canthus_R": [round(float(v), 5) for v in CANR],
               "pinna_L": {k: [round(float(v), 5) for v in d["pinna_"+k+"_L"]] for k in ("front", "top", "lobe")},
               "pinna_R": {k: [round(float(v), 5) for v in d["pinna_"+k+"_R"]] for k in ("front", "top", "lobe")},
               "ear_dense_L": int((np.linalg.norm(ESET-np.array([1, 0, 0]), axis=1) < 9).sum()//2), "note": "canthus = outermost eyelash vert; pinna zones on head mesh"},
        "p4": {"brow_id": int(brow_id), "brow_z": round(float(brow_z), 5),
               "nasion_id": int(nasion_id), "nasion_z": round(float(nasion_z), 5),
               "menton_z": round(float(menton_z), 5),
               "note": "old brow_z=1.5303 was nasal bone; true brow ridge is the most anterior midline vert above the nasion"},
        "eh_table": [{"a_deg": round(float(a), 2), "e_deg": round(float(e), 2)} for a, e in zip(Au, Eu)],
        "gates": {
            "g1": {"area_cm2": round(g1v, 2), "removed_forehead_cm2": round(float(removed), 2),
                   "sideburn_L_cm2": round(sbLc, 2), "sideburn_R_cm2": round(sbRc, 2),
                   "earhole_cm2": round(float(earhole), 2),
                   "ncomp": fcomp, "nloops": len(groups), "mirror_mm": round(float(mir*1000), 3), "pass": bool(g1p)},
            "g2": {"maxerr_H": round(float(g2err), 5), "pass": bool(g2p and mir*1000 <= 1.0),
                   "cols": [{"dx": r["dx"], "side": r["side"], "hT": round(float(r["hT"]), 4), "h5": round(float(r["h5"]), 4), "h7": round(float(r["h7"]), 4)} for r in g2rows]},
            "g3": {"step_mm": round(float(g3max*1000), 3), "at_vert": g3w[0] if g3w else None,
                   "at_zone": g3w[1] if g3w else None, "pass": bool(g3p)},
            "g4": {"setback_min_mm": round(float(a_min), 2), "setback_max_mm": round(float(a_max), 2),
                   "bottom_L_mm": round(float(bLmm), 2), "bottom_R_mm": round(float(bRmm), 2),
                   "pinna_min_mm": round(float(g4b), 2), "pinna_at_vert": int(g4bi),
                   "canthus_infront_mm": round(float(g4c), 2), "pass": bool(g4p),
                   "cols": [{"row": r["row"], "side": r["side"], "setback_mm": round(float(r["setback_mm"]), 2)} for r in g4rows]},
            "g5": {"coverage": round(float(cov), 5), "uncovered": len(uncov), "qual": int(len(qual)), "pass": bool(g5p)},
            "g6": {"sideways": round(float(g13B), 4), "backdown": round(float(g7B), 4), "smooth_p95": round(float(g15B), 2),
                   "cross": int(ncrossB), "sinks": int(nneverB), "never": int(nneverB),
                   "fore_pct": round(float(fore_pct), 4), "sym95_deg": round(float(sym95), 3), "pass": bool(g6p)}},
        "acct": {"removed_forehead_cm2": round(float(removed), 2),
                 "sideburn_L_cm2": round(sbLc, 2), "sideburn_R_cm2": round(sbRc, 2),
                 "earhole_cm2": round(float(earhole), 2),
                 "added_where": "sideburn band (|x-cx|>47.5mm, y<=-60mm) cap area per side",
                 "removed_where": "v5area - v7area + sideburn + earhole (level-set forehead strip vs v5)"},
        "sink": {"count": int(nneverB), "roots": [int(i) for i in sink_idx[:5]]},
        "flow_b": {"hist": {k: int(hB[k]) for k in ("forehead", "temple-to-ear", "behind-ear", "nape", "never-left")},
                   "g5B": round(float(g5B), 4), "g6B": round(float(g6B), 4)},
        "files": ["cap7.py", "flow8.py", "cap-v7.npz", "flow-b-v7.npz", "hairline-compare.png", "hairline-compare-profile.png",
                  "cap7-debug.png", "compare-head.png", "compare-profile.png",
                  "row-cap7.json", "check-cap7.mjs", "RESULT.txt"]}
    J.dump(rowcap, open(out/"row-cap7.json", "w"), indent=1)
    with (out/"RESULT.txt").open("w") as s:
        s.write("RESULT::hair-cap-7\n")
        s.write("P1::cx=513 crown=127 skull=150 chin=608 H=458 rows(dx:L/R)=%s\n" % (" ".join("%d:%d/%d" % (k, v[0], v[1]) for k, v in sorted(P1_ROWS.items()))))
        s.write("P2::rows=%s\n" % (" ".join("r%d:c%d=%.4fH" % (r, c, o) for r, c, o in zip(P2_ROWS, P2_COLS, P2_OFF))))
        s.write("P2::lobe_row_est=457 departure_row=475 root_bottom_row=425 (+21.5px=10mm root line)\n")
        s.write("P3::canthus L=(%.1f,%.1f,%.5f) R=(%.1f,%.1f,%.5f)\n" % (CANL[0]*1000, CANL[1]*1000, CANL[2], CANR[0]*1000, CANR[1]*1000, CANR[2]))
        s.write("P3::ear dense verts=%d C=(%.4f,%.4f,%.4f)\n" % (len(ESET), cx, Cy, Cz))
        s.write("P4::brow id=%d z=%.5f nasion id=%d z=%.5f (old 1.5303 was nose)\n" % (int(brow_id), float(brow_z), int(nasion_id), float(nasion_z)))
        for dx in (0, 20, 40, 60, 80, 100):
            rr = [r for r in g2rows if r["dx"] == dx]
            hT = rr[0]["hT"]
            h5 = sum(r["h5"] for r in rr)/len(rr); h7 = sum(r["h7"] for r in rr)/len(rr)
            s.write("HAIRLINE::%.5f target %.4f | ours-v5 %.4f | ours-v7 %.4f\n" % (dx/H_PX, hT, h5, h7))
        s.write("G1::area=%.1f [600,690] removed_forehead=%.1f sideburn_L=%.1f sideburn_R=%.1f earhole=%.1f ncomp=%d nloops=%d mirror=%.2fmm<=1 %s\n" % (g1v, removed, sbLc, sbRc, earhole, fcomp, len(groups), mir*1000, "PASS" if g1p else "MISS"))
        s.write("G2::maxerr=%.4fH<=0.02 mirror=%.2fmm<=1 %s\n" % (g2err, mir*1000, "PASS" if (g2p and mir*1000 <= 1.0) else "MISS"))
        s.write("G3::step=%.3fmm<=3 at_vert=%s zone=%s %s\n" % (g3max*1000, g3w[0] if g3w else None, g3w[1] if g3w else None, "PASS" if g3p else "MISS"))
        s.write("G4::setback=[%.1f,%.1f]mm in [8,14] bottom_L=%.1f bottom_R=%.1f (lobe+15mm +-8) pinna_min=%.2fmm>4 canthus_infront=%.2fmm<=0 %s\n" % (a_min, a_max, bLmm, bRmm, g4b, g4c, "PASS" if g4p else "MISS"))
        s.write("G5::qual=%d uncovered=%d coverage=%.4f==1.0 %s\n" % (len(qual), len(uncov), cov, "PASS" if g5p else "MISS"))
        s.write("G6::sideways=%.2f>=0.90 backdown=%.2f>=0.95 smooth=%.2f<=25 cross=%d sinks=%d never=%d fore=%.2f%%<=2%% sym95=%.3fdeg<=1 %s\n" % (g13B, g7B, g15B, ncrossB, nneverB, nneverB, fore_pct*100, sym95, "PASS" if g6p else "MISS"))
        s.write("HIST-B::"+" ".join("%s=%d" % (k, hB[k]) for k in ("forehead", "temple-to-ear", "behind-ear", "nape", "never-left"))+"\n")
        s.write("SINK::count=%d roots=%s\n" % (len(sink_idx), sink_idx[:5]))
        s.write("EHTABLE::"+" ".join("(%.1f,%.1f)" % (a, e) for a, e in zip(Au[::max(1, len(Au)//16)], Eu[::max(1, len(Au)//16)]))+"\n")
        s.write("SAW::pending-visual\n")
        causes = []
        if not g1p: causes.append("G1")
        if not (g2p and mir*1000 <= 1.0): causes.append("G2")
        if not g3p: causes.append("G3")
        if not g4p: causes.append("G4")
        if not g5p: causes.append("G5")
        if not g6p: causes.append("G6")
        s.write("CAUSE::%s\n" % ("none" if not causes else ("MISS "+",".join(causes)+" see row-cap7.json")))
        s.write("COMMIT::uncommitted\nSTILL::guides/children/hair renders (later cards)\nBRIEF_MISSING::none\nHARM::none\n")
    print("WROTE", out)
main()
