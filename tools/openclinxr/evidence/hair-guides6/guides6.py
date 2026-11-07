"""hair-guides-6: guides3 + M1 face line (x_face), M2 over-ear slide, M3 tip hygiene."""
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

def resample_linear(P, n=32):
    P = np.array(P); seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    L = seg.sum()
    if L < 1e-9: return np.repeat(P[:1], n, axis=0), np.zeros(n, dtype=int)
    t = np.concatenate([[0], np.cumsum(seg)]) / L
    out, jmap = [], []
    for k in range(n):
        u = k / (n - 1)
        j = min(int(np.searchsorted(t, u, side="right")) - 1, len(P) - 2)
        jmap.append(j)
        f = (u - t[j]) / max(t[j + 1] - t[j], 1e-12)
        out.append(P[j] * (1 - f) + P[j + 1] * f)
    return np.array(out), np.array(jmap)

def resample_smooth(P, PH, n=32):
    """U1: centripetal Catmull-Rom interpolant, uniform arc-length samples."""
    P = np.array(P, dtype=float)
    if len(P) < 4:
        return resample_linear(P, n)
    m = len(P)
    segs = np.linalg.norm(np.diff(P, axis=0), axis=1)
    dt = np.sqrt(segs + 1e-12)
    t = np.concatenate([[0.0], np.cumsum(dt)])
    te = []
    for i in range(m - 1):
        p0 = P[max(i - 1, 0)]; p1 = P[i]; p2 = P[i + 1]; p3 = P[min(i + 2, m - 1)]
        t0 = t[max(i - 1, 0)]; t1 = t[i]; t2 = t[i + 1]; t3 = t[min(i + 2, m - 1)]
        m1 = (p2 - p0) / max(t2 - t0, 1e-12); m2 = (p3 - p1) / max(t3 - t1, 1e-12)
        h = t2 - t1
        for s in np.linspace(0, 1, 16, endpoint=False):
            h00 = 2 * s**3 - 3 * s**2 + 1; h10 = s**3 - 2 * s**2 + s
            h01 = -2 * s**3 + 3 * s**2; h11 = s**3 - s**2
            te.append(h00 * p1 + h10 * h * m1 + h01 * p2 + h11 * h * m2)
    te.append(P[-1])
    dense = np.array(te)
    seg = np.linalg.norm(np.diff(dense, axis=0), axis=1)
    L = seg.sum()
    if L < 1e-9: return np.repeat(P[:1], n, axis=0), np.zeros(n, dtype=int)
    td = np.concatenate([[0], np.cumsum(seg)]) / L
    out = []
    for k in range(n):
        u = k / (n - 1)
        j = min(int(np.searchsorted(td, u, side="right")) - 1, len(dense) - 2)
        f = (u - td[j]) / max(td[j + 1] - td[j], 1e-12)
        out.append(dense[j] * (1 - f) + dense[j + 1] * f)
    seg0 = np.linalg.norm(np.diff(P, axis=0), axis=1)
    L0 = seg0.sum(); t0 = np.concatenate([[0], np.cumsum(seg0)]) / L0
    ph = []
    for k in range(n):
        u = k / (n - 1)
        j = min(int(np.searchsorted(t0, u, side="right")) - 1, len(P) - 2)
        ph.append(PH[j])
    return np.array(out), np.array(ph)

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
    # ---- U2: x_wide(z) in temple plane y=ear_y-25mm, +-8mm slab (excludes pinnae) ----
    yplane = ear_y - 0.025
    sel = W[np.abs(W[:, 1] - yplane) <= 0.008]
    print("U2 slab n=%d" % len(sel))
    zb = np.arange(1.28, 1.641, 0.005); tab = np.full(len(zb), np.nan)
    for i, z in enumerate(zb):
        q = sel[np.abs(sel[:, 2] - z) <= 0.0025][:, 0]
        if len(q) >= 3: tab[i] = float(np.abs(q - cx).max())
    ok = ~np.isnan(tab)
    print("U2 bins=%d/%d range=[%.1f,%.1f]mm" % (int(ok.sum()), len(zb), float(np.nanmin(tab)) * 1000, float(np.nanmax(tab)) * 1000))
    if ok.sum() < 10: print("XWIDE_UNMEASURABLE"); return
    tab[~ok] = np.interp(zb[~ok], zb[ok], tab[ok])
    tab = np.convolve(tab, np.ones(3) / 3, mode="same")
    def xw(z): return float(np.interp(z, zb, tab))
    # ---- M1: face line x_face(z): 48mm hairline->jaw, taper to 34mm at menton ----
    _jaw_z = menton + 0.030
    def x_face(z):
        z = float(z)
        if z >= _jaw_z: return 0.048
        if z <= menton: return 0.034
        f = (z - menton) / 0.030
        return 0.034 + f * (0.048 - 0.034)
    nb = W[(np.abs(W[:, 1] - medy) < 0.05) & (W[:, 2] > 1.40) & (W[:, 2] < 1.46) & (np.abs(W[:, 0] - cx) < 0.05)]
    yneck = float(np.median(nb[:, 1])) if len(nb) else medy
    print("yneck=%.4f" % yneck)
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
    def clear_point(p):
        """U1 final-clearance per point: <2mm -> 3mm along collider normal, no restore.
        Best-of-N across colliders so body/garment pinches settle outside both."""
        p = np.array(p, dtype=float)
        best = p; bestm = -1e9
        for _ in range(10):
            ss = []
            for o in colliders:
                q, n = nearest_pt(bvhs[o.name], p)
                if q is None: continue
                ss.append((sdist(p, q, n), q, n))
            if not ss: break
            s0, q0, n0 = min(ss, key=lambda r: r[0])
            if s0 > bestm: bestm, best = s0, p.copy()
            if s0 >= 0.002: break
            p = q0 + n0 * 0.003
        return best if bestm >= 0.002 else p
    # ---- M7/U6/D2: Poisson 6mm, slit exclusion 1.0mm, ceiling 600 ----
    SV = V[sorted(slit)]
    sdist_cap = np.linalg.norm(V[:, None, :] - SV[None, :, :], axis=2).min(1)
    cand = np.where(sdist_cap >= 0.0010)[0]
    rng = np.random.default_rng(7); rng.shuffle(cand)
    acc = []
    A = np.empty((0, 3))
    for i in cand:
        if len(acc) == 0 or float(np.linalg.norm(A - V[i], axis=1).min()) >= 0.006:
            acc.append(int(i)); A = V[np.array(acc)]
    print("M7 greedy=%d" % len(acc))
    prot = np.linalg.norm(V[acc][:, None, :] - SV[None, :, :], axis=2).min(1) < 0.004
    while len(acc) > 595:
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
    excluded = set()
    for _ in range(400):  # U6 unlimited patches within 600
        A = V[np.array(acc)]
        Dw = np.linalg.norm(V[:, None, :] - A[None, :, :], axis=2).min(1)
        if excluded:
            Dw[list(excluded)] = -1.0
        i = int(Dw.argmax())
        if float(Dw[i]) <= 0.006 or len(acc) >= 600: break
        if float(np.linalg.norm(SV - V[i], axis=1).min()) < 0.0010:
            excluded.add(i); continue
        acc.append(i)
    R = V[np.array(acc)]
    dm = np.linalg.norm(R[:, None, :] - R[None, :, :], axis=2)
    dm += np.eye(len(R)) * 1e9
    print("M7 roots=%d min-spacing=%.2fmm" % (len(R), float(dm.min()) * 1000))
    # ---- retrace streamlines ----
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
    def surface_walk(p0):  # M1 face line (guides6): x_face stop, 0.8 floor only
        pts = [np.array(p0, dtype=float)]; prev_n = None; end = "?"
        for _ in range(400):
            q, n = nearest_pt(bvh_body, pts[-1])
            f, L = modeB_dir(pts[-1], n)
            if f[1] < 0: f[1] = 0.0
            # M1: base lateral floor 0.8 only (1.6x face-zone gain and +Y drive removed)
            if abs(pts[-1][0] - cx) < x_face(pts[-1][2]) - 0.005: f = f + 0.8 * L
            nl = float(np.linalg.norm(f))
            if nl < 1e-9: f = L
            else: f = f / nl
            cand = pts[-1] + 0.003 * f
            q2, n2 = nearest_pt(bvh_body, cand)
            if prev_n is not None:  # U4 rim: normal turns >60deg
                cosn = float(np.clip((n2 @ prev_n) / (np.linalg.norm(n2) * np.linalg.norm(prev_n) + 1e-12), -1, 1))
                if np.degrees(np.arccos(cosn)) > 60.0:
                    end = "rim-normal"; break
            pts.append(q2 + n2 * 0.003)
            prev_n = n2
            if len(pts) >= 4:  # U4 rim: no forward progress for 3 steps
                if float(np.linalg.norm(pts[-1] - pts[-4])) < 0.0015:
                    end = "rim-stall"; break
            if abs(pts[-1][0] - cx) >= x_face(pts[-1][2]) - 0.005: end = "lateral"; break
            if pts[-1][2] < ear_top - 0.02: end = "zfloor"; break
        else: end = "maxiter"
        return np.array(pts), end
    Z = np.array([0.0, 0.0, -1.0])
    YF = ear_y - 0.025  # face-front plane (G6/U2): hair above menton must not drift fwd
    def no_fwd(v, p):
        if p[2] > menton and p[1] < YF and v[1] < 0:
            v = v.copy(); v[1] = 0.0
            nv = float(np.linalg.norm(v))
            v = v / nv if nv > 1e-9 else Z.copy()
        return v
    def fall_phase(p0, d0):  # M1/M2 (guides6): no face-zone redirect; over-ear slide
        pts = [np.array(p0, dtype=float)]; d = np.array(d0, dtype=float) / (np.linalg.norm(d0) + 1e-12)
        # M1: face-zone outward redirect removed (guides fall from the face line).
        blocked = 0; anchor = np.array(p0, dtype=float); cend = False
        nth = []
        for _ in range(400):
            dd = 0.65 * d + 0.35 * Z; dd = dd / (np.linalg.norm(dd) + 1e-12)
            dd = no_fwd(dd, pts[-1])
            cand = pts[-1] + 0.005 * dd
            cl, ins = clearance(cand)
            if not ins and cl >= 0.004:
                pts.append(cand); d = dd; blocked = 0; anchor = cand.copy()
                run_s = None; prev_blocked = False
            else:
                _, q, n = nearest_col(cand)
                t = Z - (Z @ n) * n; nt = float(np.linalg.norm(t))
                nth.append(nt); del nth[:-3]
                nts = sum(nth) / len(nth)  # smoothed branch: no rapid flip-flop
                if nts >= 0.15: s = t / nt if nt > 1e-9 else Z
                else:  # M2: above the menton slide forward (-Y, over the pinna,
                    # never behind the ear); below the neck keep fwd/back split
                    if cand[2] > menton:
                        Yd = np.array([0.0, -1.0, 0.0])
                    else:
                        Yd = np.array([0.0, -1.0, 0.0]) if cand[1] < yneck else np.array([0.0, 1.0, 0.0])
                    sr = Yd - (Yd @ n) * n; ns = float(np.linalg.norm(sr))
                    s = sr / ns if ns > 1e-9 else (t / nt if nt > 1e-9 else Z)
                s = no_fwd(s, pts[-1])
                stepped = pts[-1] + 0.005 * s
                # M2: project to 3mm off worst collider, no length restore
                pnew = np.array(stepped)
                for _ in range(6):
                    ss = []
                    for o in colliders:
                        qq, nn = nearest_pt(bvhs[o.name], pnew)
                        if qq is None: continue
                        ss.append((sdist(pnew, qq, nn), qq, nn))
                    if not ss: break
                    s0, q0, n0 = min(ss, key=lambda r: r[0])
                    if s0 >= 0.003: break
                    pnew = q0 + n0 * 0.003
                if float(np.linalg.norm(pnew - pts[-1])) >= 0.0025:
                    pts.append(pnew); d = s
                if (anchor[2] - pts[-1][2]) >= 0.001 or float(np.linalg.norm(pts[-1][:2] - anchor[:2])) >= 0.002:
                    blocked = 0; anchor = pts[-1].copy()
                else:
                    blocked += 1
                if blocked >= 3: cend = True; break
            if pts[-1][2] <= zhem: break
        return np.array(pts), cend
    chains = []
    from collections import Counter
    endhist = Counter()
    def grow_one(r):
            pl, bi = trace_root(r)
            if bi is None or len(pl) < 3: return None
            scalp = []
            for q in pl:
                hq, hn = nearest_pt(bvh_body, q)
                if hq is None: break
                scalp.append(hq + hn * 0.003)
            scalp = np.array(scalp)
            if len(scalp) < 3: return None
            d0 = scalp[-1] - scalp[-2]; d0 = d0 / (np.linalg.norm(d0) + 1e-12)
            if float(r[1]) < ear_y:  # M8 front roots
                surf, wend = surface_walk(scalp[-1])
                endhist[wend] += 1
                d1 = surf[-1] - surf[-2] if len(surf) > 1 else d0
                fall, ce = fall_phase(surf[-1], d1)
                full = np.vstack([scalp[:-1], surf, fall[1:]])
                ph = np.array([0] * (len(scalp) - 1) + [1] * len(surf) + [2] * (len(fall) - 1))
            else:
                fall, ce = fall_phase(scalp[-1], d0)
                full = np.vstack([scalp[:-1], fall])
                ph = np.array([0] * (len(scalp) - 1) + [2] * len(fall))
            # fall-only light smooth x3 (phase 2 below menton+: free hair, scalp untouched)
            if (ph == 2).sum() > 2:
                for _ in range(3):
                    idx = np.where((ph == 2) & (full[:, 2] <= menton + 0.01))[0]
                    idx = idx[(idx > 0) & (idx < len(full) - 1)]
                    if len(idx):
                        full[idx] = 0.5 * full[idx] + 0.25 * (full[idx - 1] + full[idx + 1])
            # M3: tip hygiene — drop terminal points after the last still-descending
            # point (no upward hook at the tip)
            if len(full) >= 2:
                last_desc = None
                for k in range(1, len(full)):
                    if full[k][2] < full[k - 1][2] - 1e-9:
                        last_desc = k
                if last_desc is not None and last_desc + 1 < len(full):
                    full = full[:last_desc + 1]; ph = ph[:last_desc + 1]
            # U1: merge collapsed (<1mm), NO fast smooth, NO segfix
            keep = [0]
            for k in range(1, len(full)):
                if float(np.linalg.norm(full[k] - full[keep[-1]])) >= 0.001:
                    keep.append(k)
            full = full[keep]; ph = ph[keep]
            if len(full) < 4: return None
            if not ce:
                full[-1][2] = zhem  # hem pin pre-resample (no restore in clearance)
            rs, rph = resample_smooth(full, ph)  # U1 smooth uniform 32
            return (rs, rph, ce, np.array(r))
    for r in R:
        g1 = grow_one(r)
        if g1 is not None: chains.append(g1)
    # wave-2: patch coverage holes left by failed traces (cap 600)
    if len(chains) < 600:
        gro = np.array([c[3] for c in chains])
        w2ex = set(); w2add = 0
        for _ in range(60):
            if len(chains) >= 600: break
            Dw = np.linalg.norm(V[:, None, :] - gro[None, :, :], axis=2).min(1)
            if w2ex: Dw[list(w2ex)] = -1.0
            i = int(Dw.argmax())
            if float(Dw[i]) <= 0.009: break
            if float(np.linalg.norm(SV - V[i], axis=1).min()) < 0.0010:
                w2ex.add(i); continue
            g2 = grow_one(V[i])
            if g2 is None: w2ex.add(i); continue
            chains.append(g2); gro = np.vstack([gro, V[i]]); w2add += 1
        print("WAVE2 added=%d" % w2add)
    n = len(chains)
    G = np.array([c[0] for c in chains]); RPH = np.array([c[1] for c in chains]); CE = np.array([c[2] for c in chains])
    GR = np.array([c[3] for c in chains])
    print("GUIDES n=%d contact-ended=%d walk-end=%s" % (n, int(CE.sum()), dict(endhist)))
    # M3 (guides6): after the final resample nothing moves — no post-resample
    # clearance mutation and no drop pass (measurement only below).
    groots = GR.copy()
    R = groots
    print("FREEZE n=%d (no post-resample moves)" % n)
    # ---- gates ----
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
    g3bad = 0; g3n = 0; below = []; g3badph = _C()
    for gi in range(n):
        for k, p in enumerate(G[gi]):
            q, nn = nearest_pt(bvh_body, p)
            d = abs(sdist(p, q, nn))
            if RPH[gi, k] < 2:
                g3n += 1
                if not (0.002 <= d <= 0.006):
                    g3bad += 1; g3badph[int(RPH[gi, k])] += 1
            elif p[2] <= menton:
                m = min(abs(sdist(p, *nearest_pt(bvhs[o.name], p))) for o in colliders)
                below.append(m)
    below = np.array(below)
    print("G3 badphase=%s" % dict(g3badph))
    browz = float(W[(np.abs(W[:, 0] - cx) < 0.005) & (W[:, 1] < medy - 0.02)][:, 2].max())
    g6 = 0; g6ex = []; g6ph = _C()
    for gi in range(n):
        for k, p in enumerate(G[gi]):
            if menton <= p[2] <= browz and p[1] < ear_y - 0.025 and abs(p[0] - cx) < 0.80 * xw(p[2]):
                g6 += 1; g6ph[int(RPH[gi, k])] += 1
                if len(g6ex) < 5: g6ex.append(np.round(p * 1000, 1).tolist())
    print("G6 violators=%d ex=%s phase=%s" % (g6, g6ex, dict(g6ph)))
    rates = np.concatenate([turn_rates(g)[0] for g in G]) if n else np.array([0])
    g7p95, g7max = float(np.percentile(rates, 95)), float(rates.max())
    seglens = np.linalg.norm(np.diff(G, axis=1), axis=2)
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
    eyez = browz
    g11req = 0.80 * 2 * xw(eyez) * 1000
    gates_pre = [
        ("G1", "%d" % n, "[350,600]", 350 <= n <= 600),
        ("G2", "inside=%d min=%.2fmm" % (ins, g2min * 1000), "0 ∧ >=2mm", ins == 0 and g2min >= 0.002),
        ("G3", "bad=%d/%d" % (g3bad, g3n), ">=99.5% in [2,6]mm", g3n > 0 and g3bad / g3n <= 0.005),
        ("G5", "p95=%.1fmm max=%.1fmm" % (float(np.percentile(below, 95)) * 1000, float(below.max()) * 1000) if len(below) else "n/a", "p95<=35 ∧ max<=65", len(below) and float(np.percentile(below, 95)) <= 0.035 and float(below.max()) <= 0.065),
        ("G6", "%d" % g6, "0", g6 == 0),
        ("G7", "p95=%.2f max=%.2f short=%d" % (g7p95, g7max, g7short), "p95<=8 ∧ max<=25 ∧ 0 short", g7p95 <= 8 and g7max <= 25 and g7short == 0),
        ("G8", "hemdz=%.2fmm cend=%.1f%% stray=%.2f%%" % (g8hemdz, g8cfrac, g8stray), "hem<=5mm ∧ cend<=10% ∧ stray<3%", (g8hemdz <= 5.0) and g8cfrac <= 10.0 and g8stray < 3),
        ("G9", "max=%.2fmm" % g9max, "<=9mm", g9max <= 9.0),
        ("G10", "|meanx|=%.2fmm" % g10, "<=5mm", g10 <= 5.0),
    ]
    for g, m, b, ok in gates_pre: print("%s %s | %s %s" % (g, m, b, "PASS" if ok else "MISS"))
    np.savez(out / "guides6.npz", points=G, roots=R, phases=RPH, contact_ended=CE, z_hem=zhem, menton_z=menton, crown_z=crown)
    # ---- tubes U7 emission-only 0.6 + Standard ----
    h.hair.hide_render = h.hair.hide_viewport = True
    bpy.context.scene.view_settings.view_transform = "Standard"
    cu = bpy.data.curves.new("OCLX_guide_tubes6", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.001
    for g in G:
        sp = cu.splines.new("POLY"); sp.points.add(31)
        for k, p in enumerate(g): sp.points[k].co = (float(p[0]), float(p[1]), float(p[2]), 1.0)
    to = bpy.data.objects.new("OCLX_guide_tubes6", cu); bpy.context.scene.collection.objects.link(to)
    om = bpy.data.materials.new("OCLX_guide_debug6"); om.use_nodes = True
    nt = om.node_tree; nt.nodes.clear()
    mout = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (1.0, 0.3, 0.0, 1.0); em.inputs["Strength"].default_value = 0.6
    nt.links.new(em.outputs[0], mout.inputs[0])
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
        sc.render.filepath = str(out / ("v6_%s.png" % name)); bpy.ops.render.render(write_still=True)
    from PIL import Image, ImageDraw
    cells = [Image.open(out / ("v6_%s.png" % v)).convert("RGB") for v, _ in views]
    Wd, Hd = cells[0].size; lab = 36
    sheet = Image.new("RGB", (Wd * 5, Hd + lab), (20, 20, 20)); dr = ImageDraw.Draw(sheet)
    for k, (v, _) in enumerate(views):
        sheet.paste(cells[k], (k * Wd, lab)); dr.text((k * Wd + 10, 10), v, fill=(255, 165, 0))
    sheet.save(out / "guides6-debug.png")
    T = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views")
    tf, tp = Image.open(T / "target-front.png").convert("RGB"), Image.open(T / "target-profile.png").convert("RGB")
    gf, gp = Image.open(out / "v6_front.png").convert("RGB"), Image.open(out / "v6_profile.png").convert("RGB")
    s2 = 512; box = Image.new("RGB", (s2 * 4, s2), (20, 20, 20))
    for k, im in (0, tf), (1, gf), (2, tp), (3, gp): box.paste(im.resize((s2, s2)), (k * s2, 0))
    box.save(out / "target-vs-guides6.png")
    # ---- U5: guides-only front mask with scene front camera ----
    # body stays VISIBLE as a black occluder (back hair must not fill the face gap)
    import bpy_extras.object_utils as OU
    hid = {o.name: (o.hide_render, o.hide_viewport) for o in bpy.data.objects}
    bodymats = list(body.data.materials)
    try:
        for o in bpy.data.objects:
            if o is to or o is body: o.hide_render = o.hide_viewport = False
            else: o.hide_render = o.hide_viewport = True
        wm = bpy.data.materials.new("OCLX_mask_white"); wm.use_nodes = True
        wnt = wm.node_tree; wnt.nodes.clear()
        wout = wnt.nodes.new("ShaderNodeOutputMaterial")
        wem = wnt.nodes.new("ShaderNodeEmission"); wem.inputs["Color"].default_value = (1, 1, 1, 1); wem.inputs["Strength"].default_value = 1.0
        wnt.links.new(wem.outputs[0], wout.inputs[0])
        cu.materials.clear(); cu.materials.append(wm)
        bm = bpy.data.materials.new("OCLX_mask_black"); bm.use_nodes = True
        bnt = bm.node_tree; bnt.nodes.clear()
        bout = bnt.nodes.new("ShaderNodeOutputMaterial")
        bem = bnt.nodes.new("ShaderNodeEmission"); bem.inputs["Color"].default_value = (0, 0, 0, 1); bem.inputs["Strength"].default_value = 0.0
        bnt.links.new(bem.outputs[0], bout.inputs[0])
        body.data.materials.clear(); body.data.materials.append(bm)
        old_world = sc.world
        bw = bpy.data.worlds.new("OCLX_black_world"); bw.use_nodes = True
        bw.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
        bw.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
        sc.world = bw
        sc.render.film_transparent = False
        cam.location = tuple(tgt + Vector((0, -dist, 0.02))); track(cam, tgt)
        sc.render.filepath = str(out / "guides-front-mask.png"); bpy.ops.render.render(write_still=True)
        sc.world = old_world
        cu.materials.clear(); cu.materials.append(om)
        body.data.materials.clear()
        for mm in bodymats: body.data.materials.append(mm)
    finally:
        for on, (hr, hv) in hid.items():
            o = bpy.data.objects.get(on)
            if o: o.hide_render, o.hide_viewport = hr, hv
    # ---- U5 measure on mask pixels: column profile, box-smooth, mass edges ----
    mimg = np.asarray(Image.open(out / "guides-front-mask.png").convert("L"))
    Hr, Wr = mimg.shape
    def proj_row_col(p):
        v = OU.world_to_camera_view(sc, cam, Vector(tuple(p)))
        return int((1 - v.y) * Hr), int(v.x * Wr)
    rcrown, cc = proj_row_col((cx, medy, crown))
    rment, _ = proj_row_col((cx, medy, menton))
    reye, cce = proj_row_col((cx, medy, eyez))
    rear, _ = proj_row_col((cx, medy, ear_top - 0.015))
    px_per_row = abs(rcrown - rment); mmpx = 210.7 / px_per_row if px_per_row > 0 else float("nan")
    def row_gap(r, c0):
        band = (mimg[max(r - 3, 0):r + 4, :] > 128).any(axis=0).astype(float)
        k = np.ones(21) / 21
        sm = np.convolve(band, k, mode="same")
        thr = 0.3 * sm.max() if sm.max() > 0 else 1.0
        left = np.where(sm[:c0] > thr)[0]; right = np.where(sm[c0:] > thr)[0]
        if not len(left) or not len(right): return 0.0, 0.0
        gap = float(right[0] + c0 - left[-1])
        outer = float(max(c0 - left[0], right[-1])) if len(right) else 0.0
        return gap, outer
    g11gap_px, _ = row_gap(reye, cce)
    _, g11outer_px = row_gap(rear, cce)
    g11gap = float(g11gap_px * mmpx); g11outer = float(g11outer_px * mmpx)
    print("G11 mask rows crown=%d menton=%d eye=%d ear=%d mmpx=%.4f gap=%.1fmm req=%.1fmm outer-ear=%.1fmm" % (
        rcrown, rment, reye, rear, mmpx, g11gap, g11req, g11outer))
    gates = gates_pre + [("G11", "gap=%.1fmm req=%.1fmm outer=%.1fmm" % (g11gap, g11req, g11outer), "gap>=req", g11gap >= g11req)]
    for g, m, b, ok in gates[-1:]: print("%s %s | %s %s" % (g, m, b, "PASS" if ok else "MISS"))
    row = {"gates": [{"gate": g, "measured": m, "bar": b, "verdict": "PASS" if ok else "MISS"} for g, m, b, ok in gates],
           "z_hem": zhem, "menton_z": menton, "crown_z": crown, "brow_z": browz, "ear_y": ear_y,
           "ear_top": ear_top, "yneck": yneck, "count": n, "contact_ended": int(CE.sum()),
           "xwide_eyez_mm": xw(eyez) * 1000, "g11_outer_ear_mm": g11outer, "g11_mmpx": mmpx,
           "x_face_jaw_mm": 48.0, "x_face_menton_mm": 34.0, "x_face_jaw_z": _jaw_z,
           "m1_floor_gain": 0.8, "m1_plusY_removed": True, "m1_face_redirect_removed": True,
           "m2_slide": "forward-above-menton, 3mm projection", "m3_tip_truncate": True,
           "m3_freeze": True}
    (out / "row-guides6.json").write_text(json.dumps(row, indent=1))
    print("WROTE", out)
main()
