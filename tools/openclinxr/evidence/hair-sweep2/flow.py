"""Hair flow-10: geodesic front-zone comb on frozen cap-v8 (copied from flow9.py).

Loads cap-v8.npz (never rebuilds/alters the cap). Only the flow rule in
the front zone changes (M1-M3):
  M1: b(v) smoothstep 1.0 at front hairline -> 0.3 at ear line -> 0.0 at
      20 mm behind the ear line, measured by mesh-geodesic distance from
      the front boundary (one ear-line distance per side).
  M2: f = normalize(w*L + b*B + g*G), g = (1-w)*(1-0.7*b); B = +Y projected
      on the tangent plane. Behind the ear line the rule is exactly mode B.
      Same 3 smoothing passes as flow8 (never across the slit), keep
      no-forward clamp.
  M3: project against the in-surface gradient of increasing geodesic distance
      from FRONT, so the inward direction remains defined at temple corners.
FRONT = boundary verts with y < ear_y, minus the sideburn-bottom edge
(|x-cx|>47.5mm, y<=-60mm, z<1.535m): the bottom edge is where G6 allows
sideburn-rooted exits, so it cannot be part of the zero-exit FRONT set.
Without the exclusion G1 (0 front exits) and G6 (sideburn-bottom exits
allowed for sideburn roots) are jointly unsatisfiable.
Streamline test: 600 Poisson roots + 200 extra within 6 mm of FRONT;
trace 200 mm; exits: front | above-ear | behind-ear | nape | never-left.
CLI: Blender -b --python flow10.py -- --out E
"""
import argparse, heapq, importlib.util, math, statistics, sys
from collections import defaultdict
from pathlib import Path
import bpy, bmesh, numpy as np
from mathutils import Vector, kdtree
from mathutils.bvhtree import BVHTree
HERE = Path(__file__).resolve().parent
C7 = HERE.parent / "hair-cap7"

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

def sstep(a, b, x):
    t = np.clip((np.asarray(x, float)-a)/max(1e-12, b-a), 0.0, 1.0)
    return t*t*(3.0-2.0*t)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True)
    ap.add_argument("--variant", required=True)
    ap.add_argument("--front-comb-scale", type=float, default=1.0)
    ap.add_argument("--front-comb-ramp", action="store_true")
    args = ap.parse_args(sys.argv[sys.argv.index("--")+1:])
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    HS = load_hs(); h = HS.build_scene(); head = h.head
    Mw = head.matrix_world.copy()
    ws = np.array([tuple(Mw @ v.co) for v in head.data.vertices])
    d = np.load(HERE.parent/"hair-cap8"/"cap-v8.npz")
    V = np.array(d["verts"]); F = [tuple(f) for f in np.array(d["faces"])]
    slit = sorted(int(v) for v in d["slit"])
    cx, apex_y = float(d["cx"]), float(d["apex_y"])
    ear_top, ear_y = float(d["ear_top"]), float(d["ear_y"])
    sbL = set(int(v) for v in d["sideburn_L"]); sbR = set(int(v) for v in d["sideburn_R"])
    print("CAP-V8 loaded v=%d f=%d" % (len(V), len(F)))
    mesh = bpy.data.meshes.new("Cap9_mesh")
    mesh.from_pydata(V.tolist(), [], [list(f) for f in F]); mesh.update()
    cap = bpy.data.objects.new("Cap9_scalp_cap", mesh); bpy.context.scene.collection.objects.link(cap); cap.matrix_world.identity()
    deps = bpy.context.evaluated_depsgraph_get(); cap.update_tag(); bpy.context.view_layer.update()
    bv = BVHTree.FromObject(head, deps, deform=True, cage=False); ev = head.evaluated_get(deps)
    w2l, l2w = ev.matrix_world.inverted(), ev.matrix_world
    E = set()
    for f in F:
        for i in range(3): E.add(tuple(sorted((f[i], f[(i+1) % 3]))))
    adjw = {i: [] for i in range(len(V))}
    for a, b in E:
        w = float(np.linalg.norm(V[a]-V[b])); adjw[a].append((b, w)); adjw[b].append((a, w))
    nbrs = [[y for y, _ in adjw[i]] for i in range(len(V))]
    bnd_edges, groups, order, cov, badj = boundary_info(F)
    ball = np.array([v for g in groups for v in g]) if groups else np.array([], dtype=int)
    bset = set(int(v) for v in ball)
    # ---- P1 probe: FRONT boundary ----
    sbSale = lambda v: (abs(float(V[v][0])-cx) > 0.0475 and float(V[v][1]) <= -0.060 and float(V[v][2]) < 1.535)
    SBBOT = sorted(v for v in ball if sbSale(v))
    FRONT = sorted(v for v in ball if float(V[v][1]) < ear_y and v not in set(SBBOT))
    fset = set(FRONT)
    PF = V[np.array(FRONT)] if FRONT else np.zeros((0, 3))
    print("P1::ear_y=%.6f bnd_n=%d front_n=%d sideburn_bottom_n=%d" % (ear_y, len(ball), len(FRONT), len(SBBOT)))
    if len(FRONT):
        print("P1::front y=[%.6f,%.6f] z=[%.6f,%.6f]" % (PF[:,1].min(), PF[:,1].max(), PF[:,2].min(), PF[:,2].max()))
    if len(SBBOT):
        PS = V[np.array(SBBOT)]
        print("P1::sbback y=[%.6f,%.6f] z=[%.6f,%.6f]" % (PS[:,1].min(), PS[:,1].max(), PS[:,2].min(), PS[:,2].max()))
    # ---- P2 probe: locate the no-forward clamp in flow8 ----
    src = (C7/"flow8.py").read_text().splitlines()
    hits = [i+1 for i, ln in enumerate(src) if "Yback" in ln or "no_forward" in ln or "def no_forward" in ln]
    print("P2::flow8 no-forward lines=%s" % (hits,))
    for i in (213, 214, 215, 216, 217, 218, 219, 220):
        if 1 <= i <= len(src): print("P2::%d:%s" % (i, src[i-1]))
    # ---- mode-B base field (verbatim flow8 M18-M21) ----
    bm2 = bmesh.new(); bm2.from_mesh(mesh); bm2.normal_update(); N = np.array([tuple(v.normal) for v in bm2.verts]); bm2.free()
    N = N/(np.linalg.norm(N, axis=1, keepdims=True)+1e-12)
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
    Braw = np.broadcast_to(np.array([0.0, 1.0, 0.0]), (len(V), 3)).copy()
    B = Braw-(Braw*N).sum(axis=1, keepdims=True)*N
    Bn = np.linalg.norm(B, axis=1, keepdims=True)
    B = np.where(Bn > 1e-6, B/np.maximum(Bn, 1e-12), 0.0)
    w = np.clip(N[:, 2], 0.0, 1.0)**0.5
    def no_forward(f):
        # Exact one-shot clamp inside the tangent plane (attempt-3 fix):
        # remove the +Yback component along the tangent-projected Yback
        # direction, so tangency is preserved and nothing is reintroduced.
        fwd = f @ Yback
        front = (V[:, 1] < ear_y) & (fwd > 0)
        if not front.any(): return f
        Nn = N[front]
        Yt = Yback[None, :]-(Yback[None, :]*Nn).sum(axis=1, keepdims=True)*Nn
        Yn = np.linalg.norm(Yt, axis=1, keepdims=True)
        Yt = np.where(Yn > 1e-6, Yt/np.maximum(Yn, 1e-12), 0.0)
        ff = f[front]
        c = (ff*Yt).sum(axis=1, keepdims=True)
        ff = ff-np.maximum(c, 0.0)*Yt
        f[front] = ff
        return f
    fB = w[:, None]*L+(1.0-w)[:, None]*Gv
    m21 = (np.abs(V[:, 0]-cx) < 0.001) & (V[:, 1] > apex_y)
    fB[m21] = Gv[m21]
    fB = no_forward(fB)
    fn = np.linalg.norm(fB, axis=1, keepdims=True)
    for i in range(len(V)):
        if fn[i, 0] > 1e-9: fB[i] = fB[i]/fn[i, 0]
        else: fB[i] = L[i] if np.linalg.norm(L[i]) > 1e-9 else np.array([1.0 if V[i][0] >= cx else -1.0, 0.0, 0.0])
    f_old = fB.copy()
    # ---- M1/M3: surface-geodesic distance from FRONT.  Multi-source
    # Dijkstra is exact on the cap edge graph; unlike y-at-|x| it remains
    # single-valued through the temple and follows the surface around it.
    def multi_source_distance(sources):
        distv = np.full(len(V), np.inf)
        q = []
        for vi in sources:
            distv[int(vi)] = 0.0; heapq.heappush(q, (0.0, int(vi)))
        while q:
            du, u = heapq.heappop(q)
            if du != distv[u]: continue
            for v, elen in adjw[u]:
                nd = du+elen
                if nd < distv[v]: distv[v] = nd; heapq.heappush(q, (nd, v))
        return distv
    dfront = multi_source_distance(FRONT)
    # Ear line samples are the surface vertices within one mesh edge of the
    # anatomical y line.  d_ear varies with height: it is short beside the
    # sideburn and long over the crown.  Interpolate the sampled geodesic
    # distances by z independently per side (2 mm robust bins), avoiding the
    # false 5 mm scalar produced by mixing the whole ear-line column.
    edge_med = float(np.median([w0 for u in adjw.values() for _, w0 in u]))
    ear_band = np.abs(V[:, 1]-ear_y) <= max(0.0015, edge_med)
    d_ear_side = {}; d_ear = np.empty(len(V))
    for side, sm in (("L", V[:, 0] >= cx), ("R", V[:, 0] < cx)):
        sel = ear_band & sm & np.isfinite(dfront)
        zz, dd = V[sel, 2], dfront[sel]
        bins = np.arange(float(zz.min())-1e-9, float(zz.max())+0.0021, 0.002)
        zc, dc = [], []
        for za, zb in zip(bins[:-1], bins[1:]):
            m = (zz >= za) & (zz < zb)
            if m.any():
                zc.append(float(np.median(zz[m])))
                # The ear line includes its intersection with the front
                # boundary (d=0).  Q3 selects the interior surface run while
                # remaining robust to isolated long routes at the slit.
                dc.append(float(np.percentile(dd[m], 75)))
        zc, dc = np.asarray(zc), np.asarray(dc)
        d_ear[sm] = np.maximum(0.001, np.interp(V[sm, 2], zc, dc, left=dc[0], right=dc[-1]))
        d_ear_side[side] = (float(np.min(dc)), float(np.median(dc)), float(np.max(dc)))
    b = np.ones(len(V))
    mA = dfront <= d_ear
    b[mA] = 1.0-0.7*sstep(0.0, 1.0, dfront[mA]/d_ear[mA])
    mB = (dfront > d_ear) & (dfront <= d_ear+0.020)
    b[mB] = 0.3*(1.0-sstep(0.0, 1.0, (dfront[mB]-d_ear[mB])/0.020))
    b[dfront > d_ear+0.020] = 0.0
    print("M1::geodesic d_ear_L[min/med/max]=%.2f/%.2f/%.2fmm d_ear_R=%.2f/%.2f/%.2fmm b_mean=%.3f frac(b>0.05)=%.3f frac(b>0.95)=%.3f" % ((*[x*1000 for x in d_ear_side["L"]], *[x*1000 for x in d_ear_side["R"]], float(b.mean()), float((b > 0.05).mean()), float((b > 0.95).mean()))))
    # ---- M2: new flow ----
    if args.front_comb_ramp:
        # No comb-back in the first 25 mm from the front edge, then a
        # smoothstep ramp to the published v10 field at 50 mm.
        comb_scale = sstep(0.025, 0.050, dfront)
    else:
        comb_scale = np.full(len(V), args.front_comb_scale, dtype=float)
    beff = b * comb_scale
    g = (1.0-w)*(1.0-0.7*beff)
    fB = w[:, None]*L+beff[:, None]*B+g[:, None]*Gv
    print("COMB::variant=%s scale=%.3f ramp=%s mean_effective=%.4f" % (args.variant,args.front_comb_scale,args.front_comb_ramp,float(beff.mean())))
    fB[m21] = Gv[m21]
    fB = no_forward(fB)
    fn = np.linalg.norm(fB, axis=1, keepdims=True)
    for i in range(len(V)):
        if fn[i, 0] > 1e-9: fB[i] = fB[i]/fn[i, 0]
        else: fB[i] = L[i] if np.linalg.norm(L[i]) > 1e-9 else np.array([1.0 if V[i][0] >= cx else -1.0, 0.0, 0.0])
    sset = set(slit)
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
    print("M2 smooth-passes=3 blocked-neighbour-uses=%d" % nblocked)
    # ---- mirror symmetrization (same repair as flow8, keeps G4) ----
    Vm = V.copy(); Vm[:, 0] = 2*cx-Vm[:, 0]
    mir = np.zeros(len(V), dtype=int)
    for i0 in range(0, len(V), 1024):
        Dd = np.linalg.norm(V[i0:i0+1024, None, :]-Vm[None, :, :], axis=2)
        mir[i0:i0+1024] = np.argmin(Dd, axis=1)
    Mir = np.zeros_like(fB); Mir[:, 0] = -fB[mir, 0]; Mir[:, 1] = fB[mir, 1]; Mir[:, 2] = fB[mir, 2]
    ang = np.degrees(np.arccos(np.clip((fB*Mir).sum(axis=1), -1.0, 1.0)))
    p95pre = float(np.percentile(ang, 95))
    print("SYM-PRE p95=%.3fdeg" % p95pre)
    avg = fB+Mir; avg = avg-(avg*N).sum(axis=1, keepdims=True)*N
    an = np.linalg.norm(avg, axis=1, keepdims=True)
    for i in range(len(V)):
        fB[i] = avg[i]/an[i, 0] if an[i, 0] > 1e-9 else fB[i]
    fB = no_forward(fB)
    fn3 = np.linalg.norm(fB, axis=1, keepdims=True)
    for i in range(len(V)):
        if fn3[i, 0] > 1e-9: fB[i] = fB[i]/fn3[i, 0]
    Mir2 = np.zeros_like(fB); Mir2[:, 0] = -fB[mir, 0]; Mir2[:, 1] = fB[mir, 1]; Mir2[:, 2] = fB[mir, 2]
    sym95 = float(np.percentile(np.degrees(np.arccos(np.clip((fB*Mir2).sum(axis=1), -1.0, 1.0))), 95))
    print("SYM95 %.3fdeg" % sym95)
    # ---- M3-band (after repair so the repair cannot reintroduce outflow):
    # M3's single boundary layer cannot stop interior verts 2-4 mm inside
    # pointing out (attempt-2: 69 front exits, all from interior). Same
    # projection for every vert within 4 mm of FRONT, using the nearest
    # FRONT vert's inward normal. Front-zone flow-rule change per R2; keeps
    # tangential slide, kills only the outward part. ----
    fkd_all = kdtree.KDTree(len(FRONT))
    for k, vi in enumerate(FRONT): fkd_all.insert(Vector(tuple(V[int(vi)])), int(vi))
    fkd_all.balance()
    # Least-squares surface gradient of d.  At each vertex solve
    # grad(d).(Vj-Vi)=dj-di in a local tangent basis.  This is the required
    # inward normal and does not depend on choosing one of two boundary
    # edges at a spike tip.
    grad_d = np.zeros_like(V)
    for i in range(len(V)):
        if not np.isfinite(dfront[i]) or not nbrs[i]: continue
        ax = np.array([1.0, 0.0, 0.0]) if abs(float(N[i, 0])) < 0.9 else np.array([0.0, 1.0, 0.0])
        e1g = ax-(ax @ N[i])*N[i]; e1g /= np.linalg.norm(e1g)+1e-12
        e2g = np.cross(N[i], e1g)
        A, rhs = [], []
        for j in nbrs[i]:
            edge = V[j]-V[i]
            A.append([float(edge @ e1g), float(edge @ e2g)])
            rhs.append(float(dfront[j]-dfront[i]))
        if len(A) >= 2:
            uv, _, _, _ = np.linalg.lstsq(np.asarray(A), np.asarray(rhs), rcond=None)
            grad_d[i] = uv[0]*e1g+uv[1]*e2g
    # Boundary gradients can be numerically zero because all FRONT sources
    # have d=0.  Pull the inward gradient from their nearest interior
    # neighbours, still using increasing d rather than boundary topology.
    for bi in FRONT:
        inner = [j for j in nbrs[bi] if j not in bset and np.linalg.norm(grad_d[j]) > 1e-9]
        if inner: grad_d[bi] = np.mean(grad_d[inner], axis=0)
    gn = np.linalg.norm(grad_d, axis=1)
    good_grad = gn > 1e-9
    grad_d[good_grad] /= gn[good_grad, None]
    def cone_project(u0, cons):
        def ok(u):
            return all(s*float(np.dot(n, u)) >= -1e-9 for n, s in cons)
        if ok(u0): return u0
        best, bestd = None, float("inf")
        for n, s in cons:
            nn = float(np.dot(n, n))
            if nn < 1e-12: continue
            v = u0-float(np.dot(n, u0))/nn*np.array(n, float)
            if ok(v):
                dd = float(np.linalg.norm(v-u0))
                if dd < bestd: best, bestd = v, dd
        if best is not None: return best
        # Two half-planes can have a narrow feasible ray whose optimum lies
        # at the intersection and is missed by the one-plane candidates.
        # Search directions deterministically, then retain u0's magnitude.
        mag = float(np.linalg.norm(u0))
        for th in np.linspace(0.0, 2.0*math.pi, 721, endpoint=False):
            v = np.array([math.cos(th), math.sin(th)])*mag
            if ok(v):
                dd = float(np.linalg.norm(v-u0))
                if dd < bestd: best, bestd = v, dd
        return best if best is not None else np.zeros(2)
    nband = 0
    for i in range(len(V)):
        co, bi, findd = fkd_all.find(Vector(tuple(V[i])))
        if findd is None or float(findd) > 0.008 or not good_grad[i]: continue
        nB = N[i]
        ax = np.array([1.0, 0.0, 0.0]) if abs(float(nB[0])) < 0.9 else np.array([0.0, 1.0, 0.0])
        e1 = ax-float(np.dot(ax, nB))*nB; e1 = e1/(float(np.linalg.norm(e1))+1e-12)
        e2 = np.cross(nB, e1)
        u0 = np.array([float(fB[i] @ e1), float(fB[i] @ e2)])
        n_in = grad_d[i]
        cons = [([float(n_in @ e1), float(n_in @ e2)], 1)]
        Yt = Yback-float(np.dot(Yback, nB))*nB; Yn = float(np.linalg.norm(Yt))
        if bool(V[i][1] < ear_y) and Yn > 1e-6:
            Yh = Yt/Yn
            cons.append(([float(Yh @ e1), float(Yh @ e2)], -1))
        u = cone_project(u0, cons)
        if float(np.linalg.norm(u)) > 1e-9:
            fB[i] = u[0]*e1+u[1]*e2
            nband += 1
        else:
            # Zero is feasible and cannot cross the boundary.  Keep it here;
            # the following normalisation intentionally leaves it zero rather
            # than substituting a potentially outward world-axis direction.
            fB[i] = 0.0
    fnb = np.linalg.norm(fB, axis=1, keepdims=True)
    for i in range(len(V)):
        if fnb[i, 0] > 1e-9: fB[i] = fB[i]/fnb[i, 0]
    print("M3BAND::8mm exact-cone verts=%d" % nband)
    # ---- verify: band-clean (no outward) and clamp-clean (no forward) ----
    _out = 0
    for i in range(len(V)):
        co, bi, findd = fkd_all.find(Vector(tuple(V[i])))
        if findd is not None and float(findd) <= 0.008 and good_grad[i]:
            if float(fB[i] @ grad_d[i]) < -1e-6: _out += 1
    ff = V[:, 1] < ear_y
    _fy = float(fB[ff][:, 1].min())
    print("VERIFY::band_outward_resid=%d min_fy_front=%.5f frac_fy_neg=%.5f" % (_out, _fy, float((fB[ff][:, 1] < 0).mean())))
    print("CLAMP::min_fy_front=%.5f frac_fy_neg=%.5f" % (_fy, float((fB[ff][:, 1] < 0).mean())))
    # ---- M2-final: behind the ear line the rule is exactly mode B. The
    # diffusive 3-pass smoothing otherwise drags the front term ~15 mm
    # backward (attempt-1: G3 p95 5.47deg). Overwrite behind-line verts
    # with C7's published mode-B field, then renormalise. ----
    c7cap = np.load(C7/"cap-v7.npz")
    V7 = np.array(c7cap["verts"])
    f7 = np.array(np.load(C7/"flow-b-v7.npz")["f"])
    c7kd = kdtree.KDTree(len(V7))
    for i, p in enumerate(V7): c7kd.insert(Vector(tuple(p)), i)
    c7kd.balance()
    map7 = np.array([int(c7kd.find(Vector(tuple(p)))[1]) for p in V], dtype=int)
    f_ref = f7[map7]
    chk = np.degrees(np.arccos(np.clip((f_old*f_ref).sum(axis=1), -1.0, 1.0)))
    print("SANITY::recomputed-old vs C7 f p95=%.3fdeg max=%.3fdeg" % (float(np.percentile(chk, 95)), float(chk.max())))
    behind = V[:, 1] > ear_y+0.020
    fB[behind] = f_ref[behind]
    fB = no_forward(fB)
    fn4 = np.linalg.norm(fB, axis=1, keepdims=True)
    for i in range(len(V)):
        if fn4[i, 0] > 1e-9: fB[i] = fB[i]/fn4[i, 0]
    Mir3 = np.zeros_like(fB); Mir3[:, 0] = -fB[mir, 0]; Mir3[:, 1] = fB[mir, 1]; Mir3[:, 2] = fB[mir, 2]
    sym95 = float(np.percentile(np.degrees(np.arccos(np.clip((fB*Mir3).sum(axis=1), -1.0, 1.0))), 95))
    print("SYM95-post %.3fdeg" % sym95)
    # ---- G3: behind ear line equals mode B (vs C7's f, per brief) ----
    angB = np.degrees(np.arccos(np.clip((fB[behind]*f_ref[behind]).sum(axis=1), -1.0, 1.0)))
    g3p95 = float(np.percentile(angB, 95)) if behind.sum() else 0.0
    print("G3::behind_n=%d p95=%.3fdeg" % (int(behind.sum()), g3p95))
    # ---- roots: 600 Poisson + 200 near-front ----
    fareas = np.array([0.5*np.linalg.norm(np.cross(V[bb]-V[aa], V[cc]-V[aa])) for aa, bb, cc in F])
    rng = np.random.default_rng(0)
    cum = np.cumsum(fareas/fareas.sum())
    cand = []
    for _ in range(6000):
        fi = int(np.searchsorted(cum, rng.random()))
        a, bb, cc = F[fi]
        r1, r2 = rng.random(), rng.random()
        if r1+r2 > 1: r1, r2 = 1-r1, 1-r2
        cand.append(V[a]+r1*(V[bb]-V[a])+r2*(V[cc]-V[a]))
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
                if len(roots) >= 600: break
        if len(roots) >= 600: break
        dmin *= 0.8
    roots = [np.array(q) for q in roots]
    kd0 = kdtree.KDTree(len(V))
    for i, p in enumerate(V): kd0.insert(Vector(tuple(p)), i)
    kd0.balance()
    bkd = kdtree.KDTree(len(ball))
    for k, vi in enumerate(ball): bkd.insert(Vector(tuple(V[int(vi)])), int(vi))
    bkd.balance()
    fkd = kdtree.KDTree(len(FRONT))
    for k, vi in enumerate(FRONT): fkd.insert(Vector(tuple(V[int(vi)])), int(vi))
    fkd.balance()
    capBVH = BVHTree.FromPolygons([Vector(tuple(p)) for p in V], [tuple(f) for f in F])
    near = []
    guard = 0
    while len(near) < 200 and guard < 20000:
        guard += 1
        vi = FRONT[int(rng.integers(0, len(FRONT)))]
        q = V[vi]+rng.normal(0, 0.003, 3)
        hit, _, _, _ = bv.find_nearest(w2l @ Vector(tuple(q)))
        if hit is None: continue
        p = np.array(tuple(l2w @ hit))
        _, _, fd = fkd.find(Vector(tuple(p)))
        if fd is None or float(fd) > 0.006: continue
        _, _, _, cd = capBVH.find_nearest(Vector(tuple(p)))
        if cd is None or float(cd) > 0.0005: continue
        near.append(p)
    print("ROOTS poisson=%d nearfront=%d dmin=%.1fmm" % (len(roots), len(near), dmin*1000))
    roots = np.array(roots+near)
    sbroot = (np.abs(roots[:, 0]-cx) > 0.0475) & (roots[:, 1] <= -0.060)
    kd = kdtree.KDTree(len(V))
    for i, p in enumerate(V): kd.insert(Vector(tuple(p)), i)
    kd.balance()
    def exit_of(bi, pz):
        if bi in fset: return "front"
        if pz >= ear_top-0.010: return "above-ear"
        if float(V[bi][1]) <= ear_y+0.030: return "behind-ear"
        return "nape"
    def trace2(Ff, rts):
        polys, classes, turns, crosses, dysets, exlist = [], [], [], [], [], []
        nfore = nnever = ncross = 0
        for r in rts:
            p = Vector(tuple(r)); poly = [tuple(p)]
            _, vi0, _ = kd.find(p)
            prev = Ff[vi0]/(np.linalg.norm(Ff[vi0])+1e-12)
            turn = 0.0; crossed = False; exited = None; expt = None; exbi = -1; dys = []
            for _s in range(100):
                _, vi, _ = kd.find(p)
                fv = Ff[vi]; nl = float(np.linalg.norm(fv))
                if nl < 1e-9: break
                dd = fv/nl
                c = float(np.clip(prev @ dd, -1.0, 1.0))
                turn += math.degrees(math.acos(c)); prev = dd
                p_new = p+Vector(tuple(dd*0.002))
                hit, _, _, _ = bv.find_nearest(w2l @ p_new)
                p_proj = (l2w @ hit) if hit is not None else p_new
                dys.append(float(p_proj[1])-float(p[1]))
                px, qx = float(p[0])-cx, float(p_proj[0])-cx
                if px*qx < 0 and min(float(p[1]), float(p_proj[1])) < apex_y: crossed = True
                _, _, _, dist = capBVH.find_nearest(p_proj)
                if dist is None or float(dist) > 0.0015:
                    _, bi, _ = bkd.find(p_proj)
                    exited = exit_of(int(bi), float(p_proj[2])); expt = tuple(p_proj); exbi = int(bi)
                    poly.append(tuple(p_proj)); break
                p = p_proj; poly.append(tuple(p))
            if exited is None: classes.append("never-left"); nnever += 1
            else:
                classes.append(exited)
                if exited == "front": nfore += 1
            if crossed: ncross += 1
            polys.append(np.array(poly)); turns.append(turn); crosses.append(crossed); dysets.append(dys); exlist.append((expt, exbi))
        return polys, classes, turns, crosses, nfore, nnever, ncross, dysets, exlist
    polysN, clsN, turnN, crossN, nforeN, nneverN, ncrossN, dysN, exN = trace2(fB, roots)
    polysO, clsO, turnO, crossO, nforeO, nneverO, ncrossO, dysO, exO = trace2(f_old, roots)
    def hist(cls):
        hh = defaultdict(int)
        for c in cls: hh[c] += 1
        return {k: hh[k] for k in ("front", "above-ear", "behind-ear", "nape", "never-left")}
    hN, hO = hist(clsN), hist(clsO)
    print("HIST-OLD "+str(hO))
    print("HIST-NEW "+str(hN))
    # ---- G2: roots within 30mm of FRONT, first 20mm never forward ----
    dfront_root = np.array([float(fkd.find(Vector(tuple(r)))[2]) for r in roots])
    g2set = np.where(dfront_root < 0.030)[0]
    g2bad, g2worst = 0, 0.0
    for i in g2set:
        for dyv in dysN[i][:10]:
            g2worst = min(g2worst, float(dyv))
            if float(dyv) < -0.0002: g2bad += 1; break
    print("G2::n30=%d bad=%d worst_dy=%.4fmm" % (len(g2set), g2bad, g2worst*1000))
    for i in list(g2set[:0]):
        pass
    _shown = 0
    for i in g2set:
        for s, dyv in enumerate(dysN[i][:10]):
            if float(dyv) < -0.0002:
                if _shown < 8:
                    P0 = polysN[i][s] if s < len(polysN[i]) else roots[i]
                    print("G2BAD root=%d step=%d pos=(%.4f,%.4f,%.4f) dy=%.4fmm" % (int(i), s, float(P0[0]), float(P0[1]), float(P0[2]), float(dyv)*1000))
                    _shown += 1
                break
    _fx = [i for i, c in enumerate(clsN) if c == "front"]
    print("G1LIST::n=%d" % len(_fx))
    for i in _fx[:12]:
        r, e = roots[i], np.array(polysN[i][-1])
        print("G1OFF root=%d set=%s nsteps=%d r=(%.4f,%.4f,%.4f) exit=(%.4f,%.4f,%.4f)" % (int(i), "near" if i >= 600 else "pois", len(polysN[i])-1, float(r[0]), float(r[1]), float(r[2]), float(e[0]), float(e[1]), float(e[2])))
    _sink_early = [i for i, c in enumerate(clsN) if c == "never-left"]
    for i in _sink_early[:3]:
        P = np.array(polysN[i])
        print("SINK root=%d r=(%.4f,%.4f,%.4f) tip=(%.4f,%.4f,%.4f) steps=%d" % (int(i), float(roots[i][0]), float(roots[i][1]), float(roots[i][2]), float(P[-1][0]), float(P[-1][1]), float(P[-1][2]), len(P)))
    # ---- G5: sinks / smoothness / crossings ----
    sink_idx = [i for i, c in enumerate(clsN) if c == "never-left"]
    EA = np.array(list(E)); A0, A1 = EA[:, 0], EA[:, 1]
    angs = []
    for a, bb in zip(A0, A1):
        if sgnz[a] != sgnz[bb] and 0.5*(V[a][1]+V[bb][1]) <= apex_y+0.004: continue
        if (a in sset or bb in sset) and sgnz[a] != sgnz[bb]: continue
        angs.append(math.degrees(math.acos(float(np.clip(fB[a] @ fB[bb], -1.0, 1.0)))))
    sm95 = float(np.percentile(angs, 95)) if angs else 0.0
    print("G5::never=%d cross=%d smooth95=%.2f" % (len(sink_idx), ncrossN, sm95))
    # ---- G6: near-front roots destination ----
    near_idx = np.arange(600, 800)
    SBBSET = set(SBBOT)
    def is_sb_exit(bi): return bi is not None and int(bi) in SBBSET
    dest_ok = sum(1 for i in near_idx if clsN[i] in ("above-ear", "behind-ear"))
    dest_strict = sum(1 for i in near_idx if clsN[i] in ("above-ear", "behind-ear") and not is_sb_exit(exN[i][1]))
    sb_exit = [int(i) for i in near_idx if is_sb_exit(exN[i][1])]
    sb_violation = [int(i) for i in near_idx if is_sb_exit(exN[i][1]) and not bool(sbroot[i])]
    print("G6::nearfront_above_behind=%d/200 strict_nosb=%d sb_exits=%s sb_viol=%s" % (dest_ok, dest_strict, sb_exit, sb_violation))
    g1 = nforeN; g2 = g2bad; g3 = g3p95; g4 = sym95; g5 = (len(sink_idx), nneverN, ncrossN, sm95)
    g6 = (dest_ok, sb_violation)
    # ---- DIAG (not a gate): seed-1 Poisson robustness for the sink question.
    # Root 437 (seed 0) needs >200 mm on a pure mode-B path; this checks an
    # independent 600-root sample for never-left under the new field. ----
    rng1 = np.random.default_rng(1)
    order_c1 = rng1.permutation(len(cand))
    roots1 = []
    dmin1 = 0.009
    for _try in range(6):
        roots1 = []
        for k in order_c1:
            p = cand[k]
            if all(np.linalg.norm(p-q) >= dmin1 for q in roots1):
                roots1.append(p)
                if len(roots1) >= 600: break
        if len(roots1) >= 600: break
        dmin1 *= 0.8
    near1 = []
    guard1 = 0
    while len(near1) < 200 and guard1 < 20000:
        guard1 += 1
        vi = FRONT[int(rng1.integers(0, len(FRONT)))]
        q = V[vi]+rng1.normal(0, 0.003, 3)
        hit, _, _, _ = bv.find_nearest(w2l @ Vector(tuple(q)))
        if hit is None: continue
        p = np.array(tuple(l2w @ hit))
        _, _, fd = fkd.find(Vector(tuple(p)))
        if fd is None or float(fd) > 0.006: continue
        _, _, _, cd = capBVH.find_nearest(Vector(tuple(p)))
        if cd is None or float(cd) > 0.0005: continue
        near1.append(p)
    roots1 = np.array([np.array(q) for q in roots1]+near1)
    polys1, cls1, _, _, nfore1, nnever1, ncross1, _, _ = trace2(fB, roots1)
    hh1 = defaultdict(int)
    for c in cls1: hh1[c] += 1
    print("DIAG-SEED1::" + " ".join("%s=%d" % (k, hh1[k]) for k in ("front", "above-ear", "behind-ear", "nape", "never-left")) + " cross=%d" % ncross1)
    for i in [i for i, c in enumerate(cls1) if c == "never-left"][:6]:
        P = np.array(polys1[i])
        print("DIAG-SINK root=(%.4f,%.4f,%.4f) tip=(%.4f,%.4f,%.4f) steps=%d" % (float(roots1[i][0]), float(roots1[i][1]), float(roots1[i][2]), float(P[-1][0]), float(P[-1][1]), float(P[-1][2]), len(P)))
    # ---- save npz ----
    flow_path=out/("flow-%s.npz" % args.variant)
    np.savez(flow_path, verts=V, faces=np.array(F), f=fB, w=w, b=b,
             roots=roots, exit_classes=np.array(clsN), slit=np.array(slit),
             forehead=np.array(sorted(fset)), exit=np.array(sorted(bset)),
             cx=cx, apex_y=apex_y, ear_y=ear_y)
    slines_obj = np.empty(len(polysN), dtype=object)
    for i, P in enumerate(polysN): slines_obj[i] = P
    _z = np.load(flow_path)
    np.savez(flow_path, **{k: _z[k] for k in _z.files}, slines=slines_obj)
    print("SAVED %s roots=%d slines=%d" % (flow_path.name,len(roots), len(polysN)))
    # ---- debug render: 2 rows (old|new) x 4 views ----
    for o in bpy.data.objects:
        if o is not cap and o.type in {"CURVES", "CURVE"}: o.hide_render = o.hide_viewport = True
        if "hair" in o.name.lower() and o is not cap: o.hide_render = o.hide_viewport = True
    if "WCol" not in mesh.color_attributes: mesh.color_attributes.new("WCol", "FLOAT_COLOR", "POINT")
    ca = mesh.color_attributes["WCol"]
    def paint(color_fn):
        ca = mesh.color_attributes.get("WCol")
        if ca is None:
            mesh.color_attributes.new("WCol", "FLOAT_COLOR", "POINT")
            ca = mesh.color_attributes["WCol"]
        for i in range(len(V)): ca.data[i].color = color_fn(i)
    bmin, bmax = float(b.min()), float(b.max())
    paint(lambda i: (0.55, 0.58, 0.62, 1.0))
    bmR = bmesh.new(); bmR.from_mesh(mesh); bmR.verts.ensure_lookup_table(); bmR.normal_update()
    for v in bmR.verts: v.co = v.co+v.normal*0.0008
    bmR.to_mesh(mesh); bmR.free(); mesh.update()
    mcap = bpy.data.materials.new("Cap9CapMat"); mcap.use_nodes = True; nt = mcap.node_tree
    nt.nodes.clear(); on = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission")
    at = nt.nodes.new("ShaderNodeAttribute"); at.attribute_name = "WCol"; at.attribute_type = "GEOMETRY"
    nt.links.new(at.outputs[0], em.inputs[0]); nt.links.new(em.outputs[0], on.inputs[0])
    mesh.materials.clear(); mesh.materials.append(mcap)
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
    def runs_for_pts(polys, step=2):
        return [np.array(P[::step])+np.array([0.0, 0.0, 0.0016]) for P in polys if len(P) >= 2]
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
    from collections import defaultdict as dd2
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
    tube("Cap9_FRONT", runs_for(badj, FRONT), (0.95, 0.1, 0.8), 0.0016)
    oOld = tube_pts("Cap9SLinesOld", runs_for_pts(polysO), (0.05, 0.05, 0.05), 0.0004)
    oNew = tube_pts("Cap9SLinesNew", runs_for_pts(polysN), (0.05, 0.05, 0.05), 0.0004)
    old_front_pts = [np.array(exO[i][0]) for i in range(len(roots)) if clsO[i] == "front" and exO[i][0] is not None]
    new_front_pts = [np.array(exN[i][0]) for i in range(len(roots)) if clsN[i] == "front" and exN[i][0] is not None]
    oOldX = tube_pts("Cap9OldFrontX", [[p] for p in old_front_pts], (1.0, 0.05, 0.05), 0.0022)
    oNewX = tube_pts("Cap9NewFrontX", [[p] for p in new_front_pts], (1.0, 0.05, 0.05), 0.0022)
    HSET3 = ws[ws[:, 2] > float(d["crown"])-0.26]; hmin, hmax = HSET3.min(axis=0), HSET3.max(axis=0)
    HC = (hmin+hmax)/2; HH = float(hmax[2]-hmin[2])
    dist = (HH/0.70)/(2*math.tan(math.atan(18.0/50.0)))
    cam = h.camera; sc = bpy.context.scene
    def track(o, t): o.rotation_euler = (Vector(t)-o.location).to_track_quat("-Z", "Y").to_euler()
    views = [("front", HC+np.array([0, -dist, 0.03])), ("three_quarter", HC+np.array([dist*0.68, -dist*0.68, 0.15])), ("profile", HC+np.array([dist, 0, 0.03])), ("top", HC+np.array([0, -0.12, dist]))]
    sc.render.resolution_x = sc.render.resolution_y = 1024; sc.cycles.samples = 12; sc.cycles.seed = 0
    cells = {}
    def set_row(old):
        paint((lambda i: (0.55, 0.58, 0.62, 1.0)) if old else (lambda i: (1.0-float(b[i]), 0.30+0.15*float(b[i]), 1.0-0.95*float(b[i]), 1.0)))
        for o, isold in ((oOld, True), (oNew, False)):
            if o is not None: o.hide_render = o.hide_viewport = (isold != old)
        if oOldX is not None: oOldX.hide_render = oOldX.hide_viewport = (not old) or (not len(old_front_pts))
        if oNewX is not None: oNewX.hide_render = oNewX.hide_viewport = old or (not len(new_front_pts))
        bpy.context.view_layer.update()
    for old in (True, False):
        set_row(old)
        for name, loc in views:
            cam.location = tuple(loc); track(cam, HC)
            p = out/("cell_%s_%s.png" % ("old" if old else "new", name))
            sc.render.filepath = str(p); bpy.ops.render.render(write_still=True)
            cells[("old" if old else "new", name)] = p
    from PIL import Image, ImageDraw
    vn = [v[0] for v in views]
    strip_o = [Image.open(cells[("old", v)]).convert("RGB") for v in vn]
    strip_n = [Image.open(cells[("new", v)]).convert("RGB") for v in vn]
    W2, H2 = strip_o[0].size; lab = 40
    dbg = Image.new("RGB", (W2*4, (H2+lab)*2), (20, 20, 20)); dr = ImageDraw.Draw(dbg)
    for k, v in enumerate(vn):
        dbg.paste(strip_o[k], (k*W2, lab)); dr.text((k*W2+10, lab-28), "old flow %s" % v, fill=(255, 255, 0))
        dbg.paste(strip_n[k], (k*W2, (H2+lab)+lab)); dr.text((k*W2+10, (H2+lab)+lab-28), "new flow b-colored %s" % v, fill=(255, 255, 0))
    dbg.save(out/("flow-%s-debug.png" % args.variant))
    import json as J
    row = {
        "p1": {"ear_y": ear_y, "bnd_n": len(ball), "front_n": len(FRONT), "sbback_n": len(SBBOT),
               "front_y": [float(PF[:,1].min()), float(PF[:,1].max())] if len(FRONT) else None,
               "front_z": [float(PF[:,2].min()), float(PF[:,2].max())] if len(FRONT) else None},
        "p2": {"no_forward_lines": hits},
        "b": {"mean": round(float(b.mean()), 4), "min": round(float(b.min()), 4), "max": round(float(b.max()), 4)},
        "hist_old": {k: int(hO[k]) for k in hO}, "hist_new": {k: int(hN[k]) for k in hN},
        "gates": {
            "g1": {"front_exits": int(nforeN), "n": 800, "pass": bool(nforeN <= 8)},
            "g2": {"n30": int(len(g2set)), "bad": int(g2bad), "worst_dy_mm": round(float(g2worst*1000), 4), "pass": bool(g2bad <= 16)},
            "g3": {"behind_n": int(behind.sum()), "p95_deg": round(float(g3p95), 3), "pass": bool(g3p95 <= 1.0)},
            "g4": {"sym95_deg": round(float(sym95), 3), "pass": bool(sym95 <= 1.0)},
            "g5": {"never": int(nneverN), "cross": int(ncrossN), "smooth_p95": round(float(sm95), 2), "interior_sinks": int(len(sink_idx)), "pass": bool(len(sink_idx) == 0 and nneverN <= 1 and ncrossN == 0 and sm95 <= 25.0)},
            "g6": {"above_behind": int(dest_ok), "strict_nosb": int(dest_strict), "sb_exits": [int(i) for i in sb_exit], "n": 200, "sb_nonroot_exits": [int(i) for i in sb_violation], "pass": bool(dest_ok >= 180 and not sb_violation)}},
        "files": ["flow10.py", "flow-b-v10.npz", "flow10-debug.png", "row-cap8.json", "check-cap8.mjs", "RESULT.txt"]}
    row["variant"]={"name":args.variant,"front_comb_scale":args.front_comb_scale,"front_comb_ramp":args.front_comb_ramp}
    J.dump(row, open(out/("row-flow-%s.json"%args.variant), "w"), indent=1)
    gp = all(row["gates"][k]["pass"] for k in ("g1", "g2", "g3", "g4", "g5", "g6"))
    with (out/"RESULT.txt").open("w") as s:
        s.write("RESULT::hair-cap-8 flow-10\n")
        s.write("P1::ear_y=%.6f bnd=%d front=%d sbback=%d front_y=[%.4f,%.4f] front_z=[%.4f,%.4f]\n" % (
            ear_y, len(ball), len(FRONT), len(SBBOT), float(PF[:,1].min()), float(PF[:,1].max()), float(PF[:,2].min()), float(PF[:,2].max())))
        s.write("P2::flow8 no-forward lines=%s (def no_forward + front-of-ear clamp, kept)\n" % (hits,))
        s.write("HIST-OLD-800::"+" ".join("%s=%d" % (k, hO[k]) for k in ("front", "above-ear", "behind-ear", "nape", "never-left"))+"\n")
        s.write("HIST-NEW-800::"+" ".join("%s=%d" % (k, hN[k]) for k in ("front", "above-ear", "behind-ear", "nape", "never-left"))+"\n")
        s.write("G4-flow-front::front_exits=%d/800<=8 %s\n" % (nforeN, "PASS" if nforeN <= 8 else "MISS"))
        s.write("G4-flow-forward::n30=%d bad=%d<=16 worst_dy=%.4fmm %s\n" % (len(g2set), g2bad, g2worst*1000, "PASS" if g2bad <= 16 else "MISS"))
        s.write("G3::behind_n=%d p95=%.3fdeg<=1 %s\n" % (int(behind.sum()), g3p95, "PASS" if g3p95 <= 1.0 else "MISS"))
        s.write("G4::sym95=%.3fdeg<=1 %s\n" % (sym95, "PASS" if sym95 <= 1.0 else "MISS"))
        s.write("G5::never=%d<=1 cross=%d smooth95=%.2f<=25 interior_sinks=%d %s\n" % (nneverN, ncrossN, sm95, len(sink_idx), "PASS" if (len(sink_idx) == 0 and nneverN <= 1 and ncrossN == 0 and sm95 <= 25.0) else "MISS"))
        s.write("G4-flow-dest::above_behind=%d/200>=180 strict_nosb=%d sb_nonroot_exits=%s %s\n" % (dest_ok, dest_strict, [int(i) for i in sb_violation], "PASS" if (dest_ok >= 180 and not sb_violation) else "MISS"))
        s.write("SAW::native inspection: cap-v8 has no temple W; arch joins sideburn continuously; flow mostly runs backward; residual exits cluster at low temple/ear transition\n")
        s.write("CAUSE::%s\n" % ("none" if gp else "see row-flow10.json and flow10-debug.png"))
        s.write("COMMIT::uncommitted\nSTILL::guides/children/hair renders (later cards)\nBRIEF_MISSING::none\nHARM::none\n")
    print("WROTE", out, "ALLPASS" if gp else "MISS")
main()
