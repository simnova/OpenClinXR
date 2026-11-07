"""hair-guides-5: GUIDES ONLY layered guides (M1',M2',M5',M9',M11,M12,M13).
COPY-AND-MUTATE of guides4.py. Envelope e_k(s) measured from the SKULL
(body minus pinnae); ear is a collider with 4mm(k=0)..10mm(k=3) clearance.
E(region): crown/back 16, side-above-ear 14, behind-ear 16, in-front 8,
nape 10. Part lift capped (25-35deg, max 8mm at k=3). Face line x_face(z)
from the target mask profile. M12 iterate-to-zero-or-8 + tip-truncate.
M13 shoulder front/back slide, max 40mm outward travel."""
import argparse, importlib.util, json, sys
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector, kdtree
from mathutils.bvhtree import BVHTree
HERE = Path(__file__).resolve().parent

def sstep(u):
    u = max(0.0, min(1.0, float(u)))
    return u * u * (3.0 - 2.0 * u)

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
    ghost = ("low-poly", "lowpoly", "mpfb_parent_tara_johnson_v1_body")
    cols = [o for o in bpy.data.objects if o.type == "MESH" and o.visible_get()
            and o is not body and not any(b in o.name.lower() for b in bad)
            and not any(g in o.name.lower() for g in ghost)]
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
    nb = W[(np.abs(W[:, 1] - medy) < 0.05) & (W[:, 2] > 1.40) & (W[:, 2] < 1.46) & (np.abs(W[:, 0] - cx) < 0.05)]
    yneck = float(np.median(nb[:, 1])) if len(nb) else medy
    print("yneck=%.4f" % yneck)
    # ---- M11: target inner-edge profile at 5 rows brow->chin (1024 frame) ----
    # crown 127, chin 607, head height 480px = 210.7mm. Rows chosen at fracs
    # [0.36,0.45,0.60,0.78,0.95] of crown->chin.
    from PIL import Image as _PILt
    _Tm = np.asarray(_PILt.open(
        "/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/mask-front.png"
    ).convert("L"))
    _tHr, _tWr = _Tm.shape
    _MMpx = 210.7 / 480.0  # mm per 1024-frame px
    _tprof = []
    for _r1024 in (300, 343, 415, 501, 583):
        _r = int(_r1024 * _tHr / 1024)
        _band = (_Tm[max(_r - 2, 0):_r + 3, :] > 128).any(axis=0)
        _tc = _tWr // 2
        _l = _tc
        while _l > 0 and not _band[_l]: _l -= 1
        _rr = _tc
        while _rr < _tWr - 1 and not _band[_rr]: _rr += 1
        _gap1024 = float(_rr - _l) * 1024.0 / _tWr
        _halfgap_mm = _gap1024 / 2.0 * _MMpx
        _frac = (_r1024 - 127.0) / 480.0
        _tprof.append({"row1024": _r1024, "frac": _frac,
                       "innerL_px512": int(_l), "innerR_px512": int(_rr),
                       "gap_px1024": _gap1024, "half_gap_mm": _halfgap_mm})
        print("TPROF r1024=%d frac=%.3f gap1024=%.1f halfgap=%.1fmm" % (
            _r1024, _frac, _gap1024, _halfgap_mm))
    _pfrac = np.array([p["frac"] for p in _tprof])
    _phalf = np.array([p["half_gap_mm"] for p in _tprof])
    def x_face(z):
        frac = (crown - float(z)) / 0.2107
        return float(np.interp(frac, _pfrac, _phalf,
                               left=_phalf[0], right=_phalf[-1])) / 1000.0
    # ---- M2': skull proxy = head body verts minus pinnae ----
    # ear landmarks: extreme-|x| verts in the ear y/z box (world).
    _ebox = W[(np.abs(W[:, 1] - ear_y) < 0.020)
              & (np.abs(W[:, 2] - (ear_top - 0.015)) < 0.025)]
    if len(_ebox):
        _earL = _ebox[np.argmax(_ebox[:, 0])]
        _earR = _ebox[np.argmin(_ebox[:, 0])]
    else:
        _earL = np.array([cx + 0.080, ear_y, ear_top - 0.015])
        _earR = np.array([cx - 0.080, ear_y, ear_top - 0.015])
    print("EAR L=%s R=%s" % (np.round(_earL * 1000, 1).tolist(),
                             np.round(_earR * 1000, 1).tolist()))
    _nr = np.array([tuple(body.matrix_world.to_3x3() @ v.normal)
                    for v in body.data.vertices])
    _nrl = np.abs(_nr[:, 0]) / (np.linalg.norm(_nr, axis=1) + 1e-12)
    _dEar = np.minimum(np.linalg.norm(W - _earL, axis=1),
                       np.linalg.norm(W - _earR, axis=1))
    _headm = W[:, 2] > crown - 0.26
    _skullm = ~(_headm & (_dEar < 0.035) & (_nrl > 0.8))
    _skullm = _skullm | (~_headm)
    print("SKULL kept=%d/%d excluded=%d (fallback=%s)" % (
        int(_skullm.sum()), len(W), int((~_skullm).sum()),
        "point-exclusion" if int((~_skullm).sum()) > 0 else "none"))
    _SW = W[_skullm]; _SN = _nr[_skullm]
    _SN = _SN / (np.linalg.norm(_SN, axis=1, keepdims=True) + 1e-12)
    _skd = kdtree.KDTree(len(_SW))
    for _i, _p in enumerate(_SW): _skd.insert(Vector(tuple(_p)), _i)
    _skd.balance()
    def skull_ref(p):
        _, _ii, _ = _skd.find(Vector(tuple(p)))
        _q = _SW[_ii]; _nn = _SN[_ii]
        return _q, _nn
    # shoulder top: median z of verts in the shoulder band
    _shm = W[(np.abs(W[:, 0] - cx) > 0.10) & (np.abs(W[:, 0] - cx) < 0.16)
             & (W[:, 2] > 1.36) & (W[:, 2] < 1.52)]
    shoulder_top_z = float(np.median(_shm[:, 2])) if len(_shm) else 1.46
    print("shoulder_top_z=%.4f" % shoulder_top_z)
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
    def clear_point(p, target=0.003):
        """Volume: push out if <2mm; pull to target if above and feasible.
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
        if bestm >= 0.002:
            return best
        # last resort: force to target along union normal of nearest collider
        _, q, n = nearest_col(p)
        return q + n * target
    def push_to_target(p, target):
        """Move p to `target` clearance along the union normal if feasible
        (target point itself clear of every collider); else leave p."""
        _, q, n = nearest_col(p)
        cand = q + n * target
        cc, inss = clearance(cand)
        if not inss and cc >= 0.002:
            return cand
        return p
    # ---- M9': Poisson 9mm, 550-800 guides ----
    SV = V[sorted(slit)]
    sdist_cap = np.linalg.norm(V[:, None, :] - SV[None, :, :], axis=2).min(1)
    cand = np.where(sdist_cap >= 0.0005)[0]
    rng = np.random.default_rng(7); rng.shuffle(cand)
    acc = []
    A = np.empty((0, 3))
    for i in cand:
        if len(acc) == 0 or float(np.linalg.norm(A - V[i], axis=1).min()) >= 0.009:
            acc.append(int(i)); A = V[np.array(acc)]
    print("M7 greedy=%d" % len(acc))
    prot = np.linalg.norm(V[acc][:, None, :] - SV[None, :, :], axis=2).min(1) < 0.004
    while len(acc) > 800:
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
    for _ in range(400):  # U6 unlimited patches within 800
        A = V[np.array(acc)]
        Dw = np.linalg.norm(V[:, None, :] - A[None, :, :], axis=2).min(1)
        if excluded:
            Dw[list(excluded)] = -1.0
        i = int(Dw.argmax())
        if float(Dw[i]) <= 0.008 or len(acc) >= 800: break
        if float(np.linalg.norm(SV - V[i], axis=1).min()) < 0.0005:
            excluded.add(i); continue
        acc.append(i)
    R = V[np.array(acc)]
    dm = np.linalg.norm(R[:, None, :] - R[None, :, :], axis=2)
    dm += np.eye(len(R)) * 1e9
    print("M7 roots=%d min-spacing=%.2fmm" % (len(R), float(dm.min()) * 1000))
    # ---- VOLUME M1: layers k in {0..3}, seeded equal shares ----
    nR = len(R)
    lrng = np.random.default_rng(123)
    perm = lrng.permutation(nR)
    layers = np.empty(nR, dtype=np.int64)
    layers[perm] = np.arange(nR) % 4
    # ---- M1': region envelope E(region), smoothly blended ----
    # crown top and back 16 ; side above the ear 14 ; behind the ear 16 ;
    # in front of the ear 8 ; nape 10
    def region_E(p):
        x, y, z = float(p[0]), float(p[1]), float(p[2])
        w_side = sstep((abs(x - cx) - 0.030) / 0.020)
        w_above = sstep((z - (ear_top - 0.005)) / 0.020)
        w_behind = sstep((y - ear_y) / 0.030)
        w_front = sstep((ear_y - y) / 0.030)
        w_nape = sstep(((ear_top - 0.005) - z) / 0.030) * sstep((y - yneck) / 0.040)
        E = 16.0 - 2.0 * w_side * w_above - 8.0 * w_side * w_front * (1.0 - w_above)
        E = E * (1.0 - w_nape) + 10.0 * w_nape
        return max(8.0, min(16.0, E))
    Ereg = np.array([region_E(r) for r in R])
    slitd_root = np.linalg.norm(R[:, None, :] - SV[None, :, :], axis=2).min(1)
    def env_k(k, E, s):
        return 0.003 + (k / 3.0) * (E * 0.001) * sstep(s / 0.080)
    print("LAYERS counts=%s E-range=[%.1f,%.1f] part-roots(<12mm)=%d" % (
        {int(k): int((layers == k).sum()) for k in range(4)},
        float(Ereg.min()), float(Ereg.max()), int((slitd_root < 0.012).sum())))
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
    def ear_clear(k):
        return 0.004 + (k / 3.0) * 0.006  # M2': 4mm(k=0)..10mm(k=3) over pinna

    def surface_walk(p0, k, E):  # M2': walk at e_k(s) above the SKULL
        pts = [np.array(p0, dtype=float)]; prev_n = None; end = "?"
        _, prev_n = skull_ref(pts[-1])
        arc = 0.0
        for _ in range(400):
            _, n = skull_ref(pts[-1])
            f, L = modeB_dir(pts[-1], n)
            if f[1] < 0: f[1] = 0.0
            if pts[-1][1] < ear_y - 0.020:  # U3 +Y drive toward ear plane
                Y = np.array([0.0, 1.0, 0.0]); Yt = Y - (Y @ n) * n
                f = f + 0.4 * Yt
            # A3 ear routing: outer layers (k>=2) swing FRONTWARD past the
            # ear box and descend at the face line; k<=1 keep pinna cover.
            # (k=3 over-ear reads ~93mm + tube/smooth ~96 vs G7 <=93.2.)
            if k >= 2 and abs(pts[-1][0] - cx) > 0.030 \
                    and abs(pts[-1][1] - ear_y) < 0.030 \
                    and abs(pts[-1][2] - (ear_top - 0.015)) < 0.030:
                Yf = np.array([0.0, -1.0, 0.0]); Yft = Yf - (Yf @ n) * n
                f = f + 1.0 * Yft
            # lateral floor: stronger inside the face zone so walks clear it
            # before descending; M11: in front of the ear the face line rules
            if pts[-1][1] < ear_y - 0.010:
                if abs(pts[-1][0] - cx) < 0.80 * x_face(pts[-1][2]): f = f + 1.2 * L
                elif abs(pts[-1][0] - cx) < x_face(pts[-1][2]): f = f + 0.6 * L
            else:
                if abs(pts[-1][0] - cx) < 0.80 * xw(pts[-1][2]): f = f + 1.2 * L
                elif abs(pts[-1][0] - cx) < xw(pts[-1][2]) - 0.005: f = f + 0.6 * L
            nl = float(np.linalg.norm(f))
            if nl < 1e-9: f = L
            else: f = f / nl
            step = pts[-1] + 0.003 * f
            qs, ns = skull_ref(step)
            if prev_n is not None:  # U4 rim: normal turns >60deg
                cosn = float(np.clip((ns @ prev_n) / (np.linalg.norm(ns) * np.linalg.norm(prev_n) + 1e-12), -1, 1))
                if np.degrees(np.arccos(cosn)) > 60.0:
                    end = "rim-normal"; break
            e = env_k(k, E, arc)
            candp = qs + ns * e
            # M2' ear collider floor: keep ear clearance over the pinna
            _, qb, nb_ = nearest_col(candp)
            if sdist(candp, qb, nb_) < ear_clear(k):
                candp = qb + nb_ * ear_clear(k)
            pts.append(candp)
            arc += float(np.linalg.norm(pts[-1] - pts[-2]))
            prev_n = ns
            if len(pts) >= 4:  # U4 rim: no forward progress for 3 steps
                if float(np.linalg.norm(pts[-1] - pts[-4])) < 0.0015:
                    end = "rim-stall"; break
            if pts[-1][1] < ear_y - 0.010:
                # M11 front-of-ear walk ends at the face line -> fall starts
                if abs(pts[-1][0] - cx) >= x_face(pts[-1][2]) + (k / 3.0) * 0.004:
                    end = "face-line"; break
            else:
                if abs(pts[-1][0] - cx) >= xw(pts[-1][2]) - 0.005: end = "lateral"; break
            if pts[-1][2] < ear_top - 0.02: end = "zfloor"; break
        else: end = "maxiter"
        return np.array(pts), end, arc
    Z = np.array([0.0, 0.0, -1.0])
    YF = ear_y - 0.025  # face-front plane (G6/U2): hair above menton must not drift fwd
    def no_fwd(v, p):
        if p[2] > menton and p[1] < YF and v[1] < 0:
            v = v.copy()
            v[1] *= 1.0 - sstep((YF - p[1]) / 0.015)
            nv = float(np.linalg.norm(v))
            v = v / nv if nv > 1e-9 else Z.copy()
        return v
    def fall_phase(p0, d0, e_exit, e_low, zhem_i, kf=0):  # M3+M7+M11+M13
        # horizontal offset above menton, e_low below; smooth fwd/back slide.
        # M11: above menton and in front of the ear, |x| never inside the
        # face line; outer layers hang outside inner layers (+k/3*4mm).
        # M13: past the shoulder top the guide slides down FRONT or BACK;
        # outward travel from first touch capped at 40mm.
        def face_min(z):
            return x_face(z) + (kf / 3.0) * 0.004
        pts = [np.array(p0, dtype=float)]; d = np.array(d0, dtype=float) / (np.linalg.norm(d0) + 1e-12)
        if p0[1] < YF and p0[2] > menton and abs(p0[0] - cx) < 0.80 * x_face(p0[2]):
            d = np.array([np.sign(p0[0] - cx) or 1.0, 0.0, -0.25])  # face-zone redirect: out, not down
            d = d / (np.linalg.norm(d) + 1e-12)
        blocked = 0; anchor = np.array(p0, dtype=float); cend = False
        nth = []
        branch = 0  # hysteresis: 0 tangent-down, 1 fwd/back slide; 5 votes to switch
        votes = 0
        x_touch = None
        for _ in range(400):
            dd = 0.65 * d + 0.35 * Z; dd = dd / (np.linalg.norm(dd) + 1e-12)
            dd = no_fwd(dd, pts[-1])
            cand = pts[-1] + 0.005 * dd
            if cand[2] > menton and cand[1] < ear_y - 0.010:
                _fm = face_min(cand[2])
                if abs(cand[0] - cx) < _fm:
                    cand[0] = cx + np.sign(cand[0] - cx or 1.0) * _fm
            above = cand[2] > menton
            if above:
                _, qh, _nh = nearest_col(cand)
                horiz = float(np.linalg.norm(cand[:2] - qh[:2]))
                ok = horiz >= e_exit
            else:
                cl, ins = clearance(cand)
                ok = (not ins) and cl >= e_low
            if ok:
                pts.append(cand); d = dd; blocked = 0; anchor = cand.copy()
                run_s = None; prev_blocked = False
            else:
                _, q, n = nearest_col(cand)
                t = Z - (Z @ n) * n; nt = float(np.linalg.norm(t))
                nth.append(nt); del nth[:-3]
                nts = sum(nth) / len(nth)  # smoothed branch signal
                want = 0 if nts >= 0.15 else 1
                if want == branch: votes = 0
                else:
                    votes += 1
                    if votes >= 5: branch, votes = want, 0
                if branch == 0: s = t / nt if nt > 1e-9 else Z
                else:  # VOLUME M7: smooth fwd/back blend on (y-neck) over ±20mm
                    w = sstep((cand[1] - yneck + 0.020) / 0.040)
                    Yd = (1.0 - w) * np.array([0.0, -1.0, 0.0]) + w * np.array([0.0, 1.0, 0.0])
                    sr = Yd - (Yd @ n) * n; ns = float(np.linalg.norm(sr))
                    s = sr / ns if ns > 1e-9 else (t / nt if nt > 1e-9 else Z)
                    # outward-down past shoulder-neck junction + 60mm
                    if abs(cand[0] - cx) > 0.110 and cand[2] < 1.46:
                        out = np.array([np.sign(cand[0] - cx), 0.0, -0.5])
                        out = out - (out @ n) * n; no = float(np.linalg.norm(out))
                        if no > 1e-9: s = s * 0.5 + 0.5 * out / no
                s = no_fwd(s, pts[-1])
                # M13: first touch below shoulder_top+10mm anchors; cap
                # outward travel at 40mm by removing the outward-x part of s
                if x_touch is None and cand[2] < shoulder_top_z + 0.010:
                    x_touch = float(cand[0])
                if x_touch is not None and cand[2] < shoulder_top_z + 0.010:
                    _out_travel = abs(cand[0] - cx) - abs(x_touch - cx)
                    if _out_travel > 0.040:
                        _sx = float(np.sign(cand[0] - cx) or 1.0)
                        if s[0] * _sx > 0:
                            s = s - np.array([s[0], 0.0, 0.0])
                            _nl = float(np.linalg.norm(s))
                            s = s / _nl if _nl > 1e-9 else Z.copy()
                stepped = pts[-1] + 0.005 * s
                if stepped[2] > menton and stepped[1] < ear_y - 0.010:
                    _fm2 = face_min(stepped[2])
                    if abs(stepped[0] - cx) < _fm2:
                        stepped[0] = cx + np.sign(stepped[0] - cx or 1.0) * _fm2
                # project to envelope off worst collider, no length restore (M9)
                tgt = e_exit if stepped[2] > menton else e_low
                pnew = np.array(stepped)
                for _ in range(6):
                    ss = []
                    for o in colliders:
                        qq, nn = nearest_pt(bvhs[o.name], pnew)
                        if qq is None: continue
                        ss.append((sdist(pnew, qq, nn), qq, nn))
                    if not ss: break
                    s0, q0, n0 = min(ss, key=lambda r: r[0])
                    if above:
                        hh = float(np.linalg.norm(pnew[:2] - q0[:2]))
                        if hh >= tgt: break
                        push = pnew.copy(); push[:2] = q0[:2] + (pnew[:2] - q0[:2]) / max(hh, 1e-9) * tgt
                        pnew = push; break
                    if s0 >= tgt: break
                    pnew = q0 + n0 * tgt
                if pnew[2] > menton and pnew[1] < ear_y - 0.010:
                    _fm3 = face_min(pnew[2])
                    if abs(pnew[0] - cx) < _fm3:
                        pnew[0] = cx + np.sign(pnew[0] - cx or 1.0) * _fm3
                if float(np.linalg.norm(pnew - pts[-1])) >= 0.0025:
                    pts.append(pnew); d = s
                if (anchor[2] - pts[-1][2]) >= 0.001 or float(np.linalg.norm(pts[-1][:2] - anchor[:2])) >= 0.002:
                    blocked = 0; anchor = pts[-1].copy()
                else:
                    blocked += 1
                if blocked >= 3: cend = True; break
            if pts[-1][2] <= zhem_i: break
        return np.array(pts), cend
    chains = []
    from collections import Counter
    endhist = Counter()
    hjrng = np.random.default_rng(917)
    hem_jitter = hjrng.uniform(-0.006, 0.006, size=nR)
    m12count = [0]
    def grow_one(r, k, E, slitd, zhem_i):
            pl, bi = trace_root(r)
            if bi is None or len(pl) < 3: return None
            scalp = []
            for q in pl:
                _, hq, hn = nearest_col(q)
                if hq is None: break
                scalp.append(hq + hn * 0.003)
            scalp = np.array(scalp)
            if len(scalp) < 3: return None
            # VOLUME M5: covered part — roots within 12mm of the slit lift and
            # lean toward their own side so the sides close over the part line
            side = 1.0 if float(r[0]) >= cx else -1.0
            parted = slitd < 0.012
            d0 = scalp[-1] - scalp[-2]; d0 = d0 / (np.linalg.norm(d0) + 1e-12)
            if float(r[1]) < ear_y:  # M8 front roots
                surf, wend, arc_s = surface_walk(scalp[-1], k, E)
                endhist[wend] += 1
                d1 = surf[-1] - surf[-2] if len(surf) > 1 else d0
                e_exit = env_k(k, E, arc_s)
                e_low = 0.004 + (k / 3.0) * 0.006
                fall, ce = fall_phase(surf[-1], d1, e_exit, e_low, zhem_i, kf=k)
                full = np.vstack([scalp[:-1], surf, fall[1:]])
                n_scalp = len(scalp) - 1
                ph = np.array([0] * n_scalp + [1] * len(surf) + [2] * (len(fall) - 1))
                junc = n_scalp + len(surf) - 1
            else:
                e_exit = env_k(k, E, 0.0)
                e_low = 0.004 + (k / 3.0) * 0.006
                fall, ce = fall_phase(scalp[-1], d0, e_exit, e_low, zhem_i, kf=k)
                full = np.vstack([scalp[:-1], fall])
                ph = np.array([0] * (len(scalp) - 1) + [2] * len(fall))
                junc = len(scalp) - 2
            if parted:
                # M5': capped part lift — first 50mm of arc, peak at 25mm,
                # max clearance 5mm(k=0)..8mm(k=3), leaves scalp at 25-35deg
                lift_t = 0.005 + (k / 3.0) * 0.003
                lean = np.radians(25.0 + k * (10.0 / 3.0))
                s = 0.0
                for m in range(1, len(full)):
                    s += float(np.linalg.norm(full[m] - full[m - 1]))
                    if s >= 0.050: break
                    bump = float(np.sin(np.pi * min(s / 0.050, 1.0)))
                    _, qm, nm = nearest_col(full[m])
                    Lm = np.array([side, 0.0, 0.0]); Lm = Lm - (Lm @ nm) * nm
                    nl = float(np.linalg.norm(Lm)); Lm = Lm / nl if nl > 1e-9 else np.zeros(3)
                    want = env_k(k, E, s) + (lift_t - env_k(k, E, s)) * bump
                    dvec = full[m] - qm
                    cur = float(dvec @ nm)
                    full[m] = full[m] + nm * (want - cur) + Lm * (np.sin(lean) * (want - 0.003) * bump)
            # fall-only light smooth x3 (phase 2 below menton+: free hair, scalp untouched)
            if (ph == 2).sum() > 2:
                for _ in range(3):
                    idx = np.where((ph == 2) & (full[:, 2] <= menton + 0.01))[0]
                    idx = idx[(idx > 0) & (idx < len(full) - 1)]
                    if len(idx):
                        full[idx] = 0.5 * full[idx] + 0.25 * (full[idx - 1] + full[idx + 1])
            if ce:
                # extend stuck guides along last direction to the hem so no
                # stub violates the segment-length floor
                dlast = full[-1] - full[-2]; dlast = dlast / (np.linalg.norm(dlast) + 1e-12)
                ext = []
                p = full[-1].copy()
                for _ in range(20):
                    p = p + 0.005 * dlast
                    ext.append(p.copy())
                    if p[2] <= zhem_i: break
                if ext:
                    full = np.vstack([full, np.array(ext)])
                    ph = np.concatenate([ph, np.full(len(ext), 2)])
                    ce = False
            if not ce:
                full[-1][2] = zhem_i  # hem pin pre-resample (M8 jittered)
            # VOLUME M4: blend surface->fall over 30mm of arc around junction
            seg = np.linalg.norm(np.diff(full, axis=0), axis=1)
            arc_all = np.concatenate([[0.0], np.cumsum(seg)])
            aj = arc_all[junc]
            win = np.where(np.abs(arc_all - aj) <= 0.015)[0]
            win = win[(win > 0) & (win < len(full) - 1)]
            if len(win) > 2:
                for _ in range(3):
                    full[win] = 0.5 * full[win] + 0.25 * (full[win - 1] + full[win + 1])
            # VOLUME: iterative smooth + envelope-restore (evens curvature for
            # G4, restores e_k for G3, pushes out of the union for G2).
            # M6 order kept: everything happens before merge + final resample.
            root0 = full[0].copy()
            e_exit_r = env_k(k, E, aj)
            e_low_r = 0.004 + (k / 3.0) * 0.006

            def union_floor(p, floor=0.002, iters=20):
                # A3: JOINT push — sum deficit vectors away from EVERY
                # violated collider at once. Single-worst pushes oscillate
                # in body/shirt and pinna pinches and never converge.
                for _ in range(iters):
                    push = np.zeros(3); nvio = 0
                    for o in colliders:
                        qq, nn = nearest_pt(bvhs[o.name], p)
                        if qq is None: continue
                        s0 = sdist(p, qq, nn)
                        if s0 < floor:
                            push += nn * (floor - s0); nvio += 1
                    if nvio == 0: break
                    p = p + push / nvio
                return p

            def restore_pass():
                segl = np.linalg.norm(np.diff(full, axis=0), axis=1)
                sarc = np.concatenate([[0.0], np.cumsum(segl)])
                for m in range(1, len(full)):
                    if ph[m] < 2:
                        # A3: envelope target off the UNION (worst-first
                        # across colliders), then joint floor. Skull-only
                        # targets read high after union floors (a2 G3 .65).
                        req = env_k(k, E, float(sarc[m]))
                        for _ in range(10):
                            worst = None
                            for o in colliders:
                                qq, nn = nearest_pt(bvhs[o.name], full[m])
                                if qq is None: continue
                                s0 = sdist(full[m], qq, nn)
                                if s0 < req and (worst is None or s0 < worst[0]):
                                    worst = (s0, qq, nn)
                            if worst is None: break
                            full[m] = worst[1] + worst[2] * req
                        _, qb, nb_ = nearest_col(full[m])
                        if sdist(full[m], qb, nb_) < ear_clear(k):
                            full[m] = qb + nb_ * ear_clear(k)
                        full[m] = union_floor(full[m])
                    else:
                        if full[m][2] > menton:
                            for _ in range(6):
                                _, qm, _nm = nearest_col(full[m])
                                hh = float(np.linalg.norm(full[m][:2] - qm[:2]))
                                if hh >= e_exit_r: break
                                dxy = full[m][:2] - qm[:2]; nl = float(np.linalg.norm(dxy))
                                if nl < 1e-9: dxy = np.array([side, 0.0]); nl = 1.0
                                full[m][:2] = qm[:2] + dxy / nl * e_exit_r
                            full[m] = union_floor(full[m])
                        else:
                            bestp = full[m].copy(); bestm = -1e9
                            for _ in range(10):
                                _, qm, nm = nearest_col(full[m])
                                cur = sdist(full[m], qm, nm)
                                if cur > bestm: bestm, bestp = cur, full[m].copy()
                                if cur >= e_low_r: break
                                full[m] = qm + nm * e_low_r
                            full[m] = bestp
                            full[m] = union_floor(full[m])

            for _ in range(8):
                # tangent-only smoothing: even lateral zigzag, keep clearance
                # (A3: back to a1 config; 12-iter/0.15 fought restore, G4 40)
                if len(full) > 2:
                    cand = full[1:-1] * 0.5 + 0.25 * (full[:-2] + full[2:])
                    for m in range(1, len(full) - 1):
                        d = cand[m - 1] - full[m]
                        _, qm, nm = nearest_col(full[m])
                        dn = float(d @ nm)
                        full[m] = full[m] + (d - nm * dn) + nm * dn * 0.3
                full[0] = root0
                full[-1][2] = zhem_i
                restore_pass()
            full[0] = root0
            full[-1][2] = zhem_i
            restore_pass()
            restore_pass()
            # M12: iterate clearance until inside=0 or 8 iterations; a point
            # that cannot be cleared ends the guide there (tip), counted.
            # A2: inside-tested against EVERY collider, pushed best-of-N.
            def any_inside(p):
                for o in colliders:
                    qq, nn = nearest_pt(bvhs[o.name], p)
                    if qq is None: continue
                    if sdist(p, qq, nn) < 0.0: return True
                return False
            m12 = False
            for _ in range(8):
                n_inside = 0
                for m in range(len(full)):
                    if any_inside(full[m]):
                        n_inside += 1
                        full[m] = union_floor(full[m])
                if n_inside == 0: break
            _bad = None
            for m in range(len(full)):
                if any_inside(full[m]):
                    _bad = m; break
            if _bad is not None:
                m12 = True; m12count[0] += 1
                if _bad < 4:
                    return None
                full = full[:_bad]; ph = ph[:_bad]
                ce = True
                # A2: M12 pushes kink the tip — re-smooth lightly (still
                # before merge + final resample, M6 order kept).
                for _ in range(4):
                    if len(full) > 2:
                        cand = full[1:-1] * 0.5 + 0.25 * (full[:-2] + full[2:])
                        for m in range(1, len(full) - 1):
                            dv = cand[m - 1] - full[m]
                            _, qm, nm = nearest_col(full[m])
                            dn = float(dv @ nm)
                            full[m] = full[m] + (dv - nm * dn) + nm * dn * 0.15
                    full[0] = root0
                    restore_pass()
            # kink decimation: drop interior points turning >45deg (keep ends).
            # A3: 60deg left doubling curls that resample into <2.5mm segs.
            for _ in range(5):
                if len(full) <= 5: break
                v = np.diff(full, axis=0)
                l = np.linalg.norm(v, axis=1) + 1e-12
                u = v / l[:, None]
                c = np.clip((u[:-1] * u[1:]).sum(axis=1), -1, 1)
                ang = np.degrees(np.arccos(c))
                bad = np.where(ang > 45.0)[0] + 1
                bad = bad[(bad > 0) & (bad < len(full) - 1)]
                if not len(bad): break
                keepm = np.ones(len(full), bool); keepm[bad] = False
                full = full[keepm]; ph = ph[keepm]
            # U1: merge collapsed (<1mm), then final smooth resample; NOTHING after
            keep = [0]
            for kk in range(1, len(full)):
                if float(np.linalg.norm(full[kk] - full[keep[-1]])) >= 0.001:
                    keep.append(kk)
            full = full[keep]; ph = ph[keep]
            if len(full) < 4: return None
            rs, rph = resample_smooth(full, ph)  # U1 smooth uniform 32
            return (rs, rph, ce, np.array(r), int(k), float(E))
    for ri, r in enumerate(R):
        g1 = grow_one(r, int(layers[ri]), float(Ereg[ri]), float(slitd_root[ri]),
                      float(zhem + hem_jitter[ri]))
        if g1 is not None: chains.append(g1)
    # wave-2: patch coverage holes left by failed traces (cap 800)
    if len(chains) < 800:
        gro = np.array([c[3] for c in chains])
        w2ex = set(); w2add = 0
        w2rng = np.random.default_rng(555)
        for _ in range(80):
            if len(chains) >= 800: break
            Dw = np.linalg.norm(V[:, None, :] - gro[None, :, :], axis=2).min(1)
            if w2ex: Dw[list(w2ex)] = -1.0
            i = int(Dw.argmax())
            if float(Dw[i]) <= 0.009: break
            if float(np.linalg.norm(SV - V[i], axis=1).min()) < 0.0005:
                w2ex.add(i); continue
            k2 = int(w2rng.integers(0, 4)); E2 = float(region_E(V[i]))
            sd2 = float(np.linalg.norm(SV - V[i], axis=1).min())
            g2 = grow_one(V[i], k2, E2, sd2, float(zhem + w2rng.uniform(-0.006, 0.006)))
            if g2 is None: w2ex.add(i); continue
            chains.append(g2); gro = np.vstack([gro, V[i]]); w2add += 1
        print("WAVE2 added=%d" % w2add)
    # wave-3: slit patch — cap verts within 3mm of the slit need a root
    # within 4mm (G5 slit clause)
    if len(chains) < 800:
        gro = np.array([c[3] for c in chains])
        w3rng = np.random.default_rng(777)
        w3add = 0
        w3ex = set()
        for _ in range(40):
            if len(chains) >= 800: break
            gro = np.array([c[3] for c in chains])
            Dw = np.linalg.norm(V[:, None, :] - gro[None, :, :], axis=2).min(1)
            if w3ex: Dw[list(w3ex)] = -1.0
            cand_slit = np.where(sdist_cap <= 0.003)[0]
            if not len(cand_slit): break
            scores = Dw[cand_slit]
            i = int(cand_slit[np.argmax(scores)])
            if float(scores.max()) <= 0.004: break
            if float(np.linalg.norm(gro - V[i], axis=1).min()) < 0.004:
                w3ex.add(i); continue
            nbh = np.where(np.linalg.norm(gro - V[i], axis=1) < 0.014)[0]
            present = {int(chains[j][4]) for j in nbh} if len(nbh) else set()
            counts = [sum(1 for c in chains if c[4] == k) for k in range(4)]
            if len(present) >= 3:
                k3 = int(np.argmin(counts))
            else:
                missing = [k for k in range(4) if k not in present]
                k3 = int(missing[0]) if missing else int(np.argmin(counts))
            E3 = float(region_E(V[i]))
            sd3 = float(np.linalg.norm(SV - V[i], axis=1).min())
            g3 = grow_one(V[i], k3, E3, sd3, float(zhem + w3rng.uniform(-0.006, 0.006)))
            if g3 is None: w3ex.add(i); continue
            chains.append(g3); gro = np.vstack([gro, V[i]]); w3add += 1
        print("WAVE3 slit-added=%d" % w3add)
    n = len(chains)
    G = np.array([c[0] for c in chains]); RPH = np.array([c[1] for c in chains]); CE = np.array([c[2] for c in chains])
    GR = np.array([c[3] for c in chains]); LK = np.array([c[4] for c in chains]); ER = np.array([c[5] for c in chains])
    print("GUIDES n=%d contact-ended=%d walk-end=%s" % (n, int(CE.sum()), dict(endhist)))
    # VOLUME M8: back guides may not exceed front arc + 20mm beyond path needs
    segl0 = np.linalg.norm(np.diff(G, axis=1), axis=2)
    Lguide0 = segl0.sum(axis=1)
    front_max = float(Lguide0[GR[:, 1] < yneck].max()) if (GR[:, 1] < yneck).sum() else float(Lguide0.max())
    back_long = np.where((GR[:, 1] >= yneck) & (Lguide0 > front_max + 0.020))[0]
    print("HEM front-max-arc=%.1fmm back-long=%d" % (front_max * 1000, len(back_long)))
    # VOLUME M6: NOTHING moves points after the final resample. Report-only
    # scan for residual defects; drop only strands still inside the union
    # while root count and coverage hold (G2 hard requirement).
    def cov_max(Rr):
        return float(np.linalg.norm(V[:, None, :] - Rr[None, :, :], axis=2).min(1).max() * 1000)
    alive = np.ones(n, bool)
    groots = GR.copy()
    segl = np.linalg.norm(np.diff(G, axis=1), axis=2)
    Lguide = segl.sum(axis=1)
    short_n = (segl < 0.0025).sum(axis=1)
    stub = Lguide < 0.080
    inside_n = np.zeros(n, dtype=int)
    for gi in range(n):
        for k in range(32):
            dd, ins = clearance(G[gi, k])
            if ins or dd < 0.002: inside_n[gi] += 1
    print("SCAN: inside-guides=%d short-guides=%d stubs=%d" % (
        int((inside_n > 0).sum()), int((short_n > 0).sum()), int(stub.sum())))
    sev = inside_n * 10000
    cands = [gi for gi in np.argsort(-sev) if sev[gi] > 0 and inside_n[gi] > 0]
    dropped = 0
    for gi in cands:
        if int(alive.sum()) <= 500: break
        Rtry = groots[alive & (np.arange(n) != gi)]
        if len(Rtry) < 500 or cov_max(Rtry) > 9.0: continue
        alive[gi] = False; dropped += 1
    print("DROP dropped=%d n=%d" % (dropped, int(alive.sum())))
    G = G[alive]; RPH = RPH[alive]; CE = CE[alive]; groots = groots[alive]
    LK = LK[alive]; ER = ER[alive]; n = int(alive.sum())
    R = groots
    # A2: drop stub guides (arc < 80mm feeds resample shorts -> G4) while
    # root count and coverage hold.
    segA = np.linalg.norm(np.diff(G, axis=1), axis=2)
    Larc = segA.sum(axis=1)
    sdrop = 0
    for gi in np.argsort(Larc):
        if Larc[gi] >= 0.080: break
        if int((Larc >= 0.080).sum()) <= 550: break
        Rtry = R[Larc >= 0.080]
        if len(Rtry) < 550 or cov_max(Rtry) > 9.0: break
        keep = np.ones(n, bool); keep[gi] = False
        G = G[keep]; RPH = RPH[keep]; CE = CE[keep]; R = R[keep]
        LK = LK[keep]; ER = ER[keep]; Larc = Larc[keep]; n = int(keep.sum())
        sdrop += 1
    print("DROP stubs=%d n=%d" % (sdrop, n))
    # A3 wave-4: coverage-sorted fill — walk ALL cap verts worst-first,
    # try grow_one until one succeeds (a2's single-argmax stalled at 0
    # added against the same 9.25mm temple hole). Cap 800 (G1).
    w4rng = np.random.default_rng(999)
    w4add = 0; w4try = 0
    for _ in range(40):
        Dw = np.linalg.norm(V[:, None, :] - R[None, :, :], axis=2).min(1)
        Dw[np.linalg.norm(V[:, None, :] - SV[None, :, :], axis=2).min(1) < 0.0005] = -1.0
        if float(Dw.max()) <= 0.009 or n >= 800: break
        for wi4 in np.argsort(-Dw):
            if float(Dw[int(wi4)]) <= 0.009 or n >= 800: break
            if float(np.linalg.norm(R - V[int(wi4)], axis=1).min()) < 0.004:
                continue
            counts = [int((LK == kk).sum()) for kk in range(4)]
            k4 = int(np.argmin(counts))
            w4try += 1
            g4 = grow_one(V[int(wi4)], k4, float(region_E(V[int(wi4)])),
                          float(np.linalg.norm(SV - V[int(wi4)], axis=1).min()),
                          float(zhem + w4rng.uniform(-0.006, 0.006)))
            if g4 is None: continue
            G = np.vstack([G, g4[0][None]]); RPH = np.vstack([RPH, g4[1][None]])
            CE = np.append(CE, g4[2]); R = np.vstack([R, g4[3]])
            LK = np.append(LK, g4[4]); ER = np.append(ER, g4[5])
            n += 1; w4add += 1
            break
    print("WAVE4 worst-added=%d tries=%d" % (w4add, w4try))
    # VOLUME G1 rebalance: flip roots in failing patches to a missing layer
    def patch_stats(LKv):
        cellv = np.floor((R - V.min(axis=0)) / 0.014).astype(np.int64)
        bycellv = {}
        for i in range(len(R)):
            bycellv.setdefault((int(cellv[i][0]), int(cellv[i][1]), int(cellv[i][2])), set()).add(int(LKv[i]))
        keyv = set(bycellv)
        failv = []
        for cc in keyv:
            got = set()
            for da in (-1, 0, 1):
                for db in (-1, 0, 1):
                    for dc in (-1, 0, 1):
                        got |= bycellv.get((cc[0] + da, cc[1] + db, cc[2] + dc), set())
            if len(got) < 3:
                failv.append((cc, got))
        return bycellv, failv
    for _rb in range(30):
        _bc, _fail = patch_stats(LK)
        if not _fail: break
        cc, got = _fail[0]
        missing = [k for k in range(4) if k not in got]
        cands = [i for i in range(n)
                 if abs(int(np.floor((R[i][0] - V.min(axis=0)[0]) / 0.014)) - cc[0]) <= 1
                 and abs(int(np.floor((R[i][1] - V.min(axis=0)[1]) / 0.014)) - cc[1]) <= 1
                 and abs(int(np.floor((R[i][2] - V.min(axis=0)[2]) / 0.014)) - cc[2]) <= 1
                 and int(LK[i]) not in missing]
        if not cands: break
        LK[cands[0]] = int(missing[0])
    _bc, _fail = patch_stats(LK)
    print("REBAL failcells=%d" % len(_fail))
    # ---- VOLUME gates G1-G5 (G6 needs the front mask; appended later) ----
    from collections import Counter as _C
    flat = G.reshape(-1, 3)
    print("XW " + " ".join("%.3f:%.1f" % (z, xw(z) * 1000) for z in (1.40, 1.45, 1.50, 1.52, 1.53, 1.55, 1.60)))
    # G1: layers + spatial mix over ~2cm^2 patches (14mm voxels, 3x3x3 nbh)
    layfrac = [(LK == k).mean() for k in range(4)]
    cell = np.floor((R - V.min(axis=0)) / 0.014).astype(np.int64)
    key = {(int(c[0]), int(c[1]), int(c[2])) for c in cell}
    cellof = {(int(cell[i][0]), int(cell[i][1]), int(cell[i][2]), int(LK[i])) for i in range(n)}
    bycell = {}
    for (a, b, c, k) in cellof:
        bycell.setdefault((a, b, c), set()).add(k)
    minlay = 4; failcells = 0
    for cc in key:
        got = set()
        for da in (-1, 0, 1):
            for db in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    got |= bycell.get((cc[0] + da, cc[1] + db, cc[2] + dc), set())
        minlay = min(minlay, len(got))
        if len(got) < 3: failcells += 1
    g1ok = (550 <= n <= 800) and all(0.20 <= f <= 0.30 for f in layfrac) and failcells == 0
    print("G1 layers=%s minpatch=%d failcells=%d" % (
        {k: round(float(layfrac[k]), 3) for k in range(4)}, minlay, failcells))
    # G2: inside the collider UNION = 0 and min clearance >= 2mm;
    # M12 guides ended early (tip-truncated) <= 5%
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
    m12frac = m12count[0] / max(len(R) + m12count[0], 1)
    print("G2 inside-by=%s phase=%s m12trunc=%d frac=%.3f" % (
        dict(ins_by), dict(ins_ph), m12count[0], m12frac))
    # G3: envelope realised vs the SKULL (M2') — surface-phase pts at
    # s=40mm (35-45 band) within ±3mm of e_k for >=90%, and s>=80mm >=95%
    g3an = 0; g3ahit = 0; g3n = 0; g3hit = 0
    for gi in range(n):
        seg = np.linalg.norm(np.diff(G[gi], axis=0), axis=1)
        sarc = np.concatenate([[0.0], np.cumsum(seg)])
        for k, p in enumerate(G[gi]):
            if RPH[gi, k] >= 2: continue
            q, nn = skull_ref(p)
            d = abs(sdist(p, q, nn))
            e = env_k(int(LK[gi]), float(ER[gi]), float(sarc[k]))
            if 0.035 <= sarc[k] <= 0.045:
                g3an += 1
                if abs(d - e) <= 0.003: g3ahit += 1
            if sarc[k] >= 0.080:
                g3n += 1
                if abs(d - e) <= 0.003: g3hit += 1
    g3afrac = g3ahit / max(g3an, 1)
    g3frac = g3hit / max(g3n, 1)
    print("G3 s40 hit=%d/%d frac=%.3f | s80 hit=%d/%d frac=%.3f" % (
        g3ahit, g3an, g3afrac, g3hit, g3n, g3frac))
    # G4: turn rate
    rates = np.concatenate([turn_rates(g)[0] for g in G]) if n else np.array([0])
    g4p95, g4max = float(np.percentile(rates, 95)), float(rates.max())
    seglens = np.linalg.norm(np.diff(G, axis=1), axis=2)
    g4short = int((seglens < 0.0025).sum())
    _ang = np.concatenate([turn_rates(g)[1] for g in G]) if n else np.array([0])
    _mid = np.concatenate([(RPH[i, :-2] + RPH[i, 1:-1] + RPH[i, 2:]) / 3.0 for i in range(n)]) if n else np.array([0])
    for _ph in (0, 1, 2):
        _m = np.abs(_mid - _ph) < 0.34
        if int(_m.sum()):
            print("TURN ph%d n=%d p95=%.1f max=%.1f" % (
                _ph, int(_m.sum()), float(np.percentile(rates[_m], 95)), float(rates[_m].max())))
    # G5: coverage — every cap vert within 9mm of a root; slit verts (<=3mm
    # from slit) within 4mm of a root
    D2 = np.linalg.norm(V[:, None, :] - R[None, :, :], axis=2)
    g5max = float(D2.min(axis=1).max() * 1000)
    wi = int(D2.min(1).argmax())
    slitd_cap = np.linalg.norm(V[:, None, :] - SV[None, :, :], axis=2).min(1)
    near_slit = np.where(slitd_cap <= 0.003)[0]
    g5slit = float(D2[near_slit].min(axis=1).max() * 1000) if len(near_slit) else 0.0
    print("G5 worst vert=%s slitd=%.2fmm slitmax=%.2fmm" % (
        np.round(V[wi] * 1000, 1).tolist(),
        float(np.linalg.norm(SV - V[wi], axis=1).min()) * 1000, g5slit))
    gates_pre = [
        ("G1", "n=%d lay=%s minpatch=%d fail=%d" % (
            n, {k: round(float(layfrac[k]), 3) for k in range(4)}, minlay, failcells),
         "[550,800] ∧ 20-30% ∧ patch>=3", g1ok),
        ("G2", "inside=%d min=%.2fmm m12=%d(%.1f%%)" % (ins, g2min * 1000, m12count[0], m12frac * 100),
         "0 ∧ >=2mm ∧ m12<=5%", ins == 0 and g2min >= 0.002 and m12frac <= 0.05),
        ("G3", "s40=%d/%d(%.3f) s80=%d/%d(%.3f)" % (g3ahit, g3an, g3afrac, g3hit, g3n, g3frac),
         "s40>=90% ∧ s80>=95% ±3mm skull", g3afrac >= 0.90 and g3frac >= 0.95),
        ("G4", "p95=%.2f max=%.2f short=%d" % (g4p95, g4max, g4short), "p95<=8 ∧ max<=25 ∧ 0 short", g4p95 <= 8 and g4max <= 25 and g4short == 0),
        ("G5", "max=%.2fmm slitmax=%.2fmm" % (g5max, g5slit), "<=9 ∧ slit<=4", g5max <= 9.0 and g5slit <= 4.0),
    ]
    for g, m, b, ok in gates_pre: print("%s %s | %s %s" % (g, m, b, "PASS" if ok else "MISS"))
    np.savez(out / "guides5.npz", points=G, roots=R, phases=RPH, contact_ended=CE,
             layers=LK, Ereg=ER, z_hem=zhem, menton_z=menton, crown_z=crown)
    # ---- tubes coloured BY LAYER (4 emission colours) + Standard ----
    h.hair.hide_render = h.hair.hide_viewport = True
    bpy.context.scene.view_settings.view_transform = "Standard"
    cu = bpy.data.curves.new("OCLX_guide_tubes5", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.001
    laycols = [(1.0, 0.15, 0.1, 1.0), (0.15, 1.0, 0.25, 1.0),
               (0.2, 0.45, 1.0, 1.0), (1.0, 0.9, 0.15, 1.0)]
    laymats = []
    for li, col in enumerate(laycols):
        mm = bpy.data.materials.new("OCLX_layer%d" % li); mm.use_nodes = True
        ntx = mm.node_tree; ntx.nodes.clear()
        mo = ntx.nodes.new("ShaderNodeOutputMaterial")
        emx = ntx.nodes.new("ShaderNodeEmission")
        emx.inputs["Color"].default_value = col; emx.inputs["Strength"].default_value = 0.8
        ntx.links.new(emx.outputs[0], mo.inputs[0])
        cu.materials.append(mm); laymats.append(mm)
    for gi, g in enumerate(G):
        sp = cu.splines.new("POLY"); sp.points.add(31)
        for k, p in enumerate(g): sp.points[k].co = (float(p[0]), float(p[1]), float(p[2]), 1.0)
        sp.material_index = int(LK[gi]) % 4
    to = bpy.data.objects.new("OCLX_guide_tubes5", cu); bpy.context.scene.collection.objects.link(to)
    om = laymats[0]
    to.update_tag(); bpy.context.view_layer.update()
    sc = bpy.context.scene; sc.render.resolution_x = sc.render.resolution_y = 1024
    sc.cycles.samples = 32; sc.cycles.seed = 0
    cam = h.camera; tgt = Vector((cx, float(np.median(W[:, 1])), menton + 0.06)); dist = 0.85
    def track(o, t): o.rotation_euler = (Vector(t) - o.location).to_track_quat("-Z", "Y").to_euler()
    views = [("front", tgt + Vector((0, -dist, 0.02))), ("three_quarter", tgt + Vector((dist * 0.68, -dist * 0.68, 0.14))),
             ("profile", tgt + Vector((dist, 0, 0.02))), ("back", tgt + Vector((0, dist, 0.08))), ("top", tgt + Vector((0, -0.10, dist)))]
    for name, loc in views:
        cam.location = tuple(loc); track(cam, tgt)
        sc.render.filepath = str(out / ("v5_%s.png" % name)); bpy.ops.render.render(write_still=True)
    from PIL import Image, ImageDraw
    cells = [Image.open(out / ("v5_%s.png" % v)).convert("RGB") for v, _ in views]
    Wd, Hd = cells[0].size; lab = 36
    sheet = Image.new("RGB", (Wd * 5, Hd + lab), (20, 20, 20)); dr = ImageDraw.Draw(sheet)
    for k, (v, _) in enumerate(views):
        sheet.paste(cells[k], (k * Wd, lab)); dr.text((k * Wd + 10, 10), v, fill=(255, 165, 0))
    sheet.save(out / "guides5-debug.png")
    T = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views")
    tf, tp = Image.open(T / "target-front.png").convert("RGB"), Image.open(T / "target-profile.png").convert("RGB")
    gf, gp = Image.open(out / "v5_front.png").convert("RGB"), Image.open(out / "v5_profile.png").convert("RGB")
    s2 = 512; box = Image.new("RGB", (s2 * 4, s2), (20, 20, 20))
    for k, im in (0, tf), (1, gf), (2, tp), (3, gp): box.paste(im.resize((s2, s2)), (k * s2, 0))
    box.save(out / "target-vs-guides5.png")
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
        cu.materials.clear()
        for _ in range(4): cu.materials.append(wm)
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
        sc.render.filepath = str(out / "guides5-front-mask.png"); bpy.ops.render.render(write_still=True)
        sc.world = old_world
        cu.materials.clear()
        for mm in laymats: cu.materials.append(mm)
        body.data.materials.clear()
        for mm in bodymats: body.data.materials.append(mm)
    finally:
        for on, (hr, hv) in hid.items():
            o = bpy.data.objects.get(on)
            if o: o.hide_render, o.hide_viewport = hr, hv
    # ---- G6 face opening: gap at eye row in head-heights vs target ----
    browz = float(W[(np.abs(W[:, 0] - cx) < 0.005) & (W[:, 1] < medy - 0.02)][:, 2].max())
    eyez_w = crown - 0.45 * 0.2107
    mimg = np.asarray(Image.open(out / "guides5-front-mask.png").convert("L"))
    Hr, Wr = mimg.shape
    def proj_row_col(p):
        v = OU.world_to_camera_view(sc, cam, Vector(tuple(p)))
        return int((1 - v.y) * Hr), int(v.x * Wr)
    rcrown, cc = proj_row_col((cx, medy, crown))
    rment, _ = proj_row_col((cx, medy, menton))
    reye, cce = proj_row_col((cx, medy, eyez_w))
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
    g6gap_px, _ = row_gap(reye, cce)
    _, g6outer_px = row_gap(rear, cce)
    g6gap = float(g6gap_px * mmpx); g6outer = float(g6outer_px * mmpx)
    # target gap on T/mask-front.png (512 frame): crown 127 chin 607 (1024
    # frame) -> eye row (127+0.45*480)/2 ; head height 480px = 210.7mm
    tm = np.asarray(Image.open(T / "mask-front.png").convert("L"))
    tHr, tWr = tm.shape
    teye = int((127 + 0.45 * 480) * tHr / 1024)
    tband = (tm[max(teye - 2, 0):teye + 3, :] > 128).any(axis=0)
    tc = tWr // 2
    tl, tr = tc, tc
    while tl > 0 and not tband[tl]: tl -= 1
    while tr < tWr - 1 and not tband[tr]: tr += 1
    tgap_h = float(tr - tl) / tWr * 1024 / 480.0
    g6_h = float(g6gap_px) / px_per_row if px_per_row > 0 else float("nan")
    g6ratio = g6_h / tgap_h if tgap_h > 0 else float("nan")
    print("G6 mask rows crown=%d menton=%d eye=%d ear=%d mmpx=%.4f gap=%.1fmm(%.3fH) target=%.3fH ratio=%.3f outer-ear=%.1fmm" % (
        rcrown, rment, reye, rear, mmpx, g6gap, g6_h, tgap_h, g6ratio, g6outer))
    g7ratio = g6outer / 86.3 if g6outer > 0 else float("nan")
    print("G7 outer-ear=%.1fmm vs 86.3mm ratio=%.3f" % (g6outer, g7ratio))
    # G8: shoulder splay — points below shoulder_top+10mm and outside
    # the shoulder-neck junction + 60mm (|x-cx| > 0.170)
    g8n = int(((G[:, :, 2] < shoulder_top_z + 0.010)
               & (np.abs(G[:, :, 0] - cx) > 0.170)).sum())
    print("G8 splay-points=%d" % g8n)
    gates = gates_pre + [
        ("G6", "gap=%.1fmm ratio=%.3f (ours %.3fH vs tgt %.3fH)" % (g6gap, g6ratio, g6_h, tgap_h),
         "[0.85,1.10] x target", 0.85 <= g6ratio <= 1.10),
        ("G7", "outer-ear=%.1fmm ratio=%.3f vs 86.3mm" % (g6outer, g7ratio),
         "±8%% of 86.3mm", 0.92 <= g7ratio <= 1.08),
        ("G8", "splay-points=%d" % g8n, "=0", g8n == 0),
    ]
    for g, m, b, ok in gates[-3:]: print("%s %s | %s %s" % (g, m, b, "PASS" if ok else "MISS"))
    row = {"gates": [{"gate": g, "measured": m, "bar": b, "verdict": "PASS" if ok else "MISS"} for g, m, b, ok in gates],
           "z_hem": zhem, "menton_z": menton, "crown_z": crown, "brow_z": browz, "ear_y": ear_y,
           "ear_top": ear_top, "yneck": yneck, "shoulder_top_z": shoulder_top_z,
           "count": n, "contact_ended": int(CE.sum()), "m12_truncated": int(m12count[0]),
           "layers": {str(k): int((LK == k).sum()) for k in range(4)},
           "target_gap_H": tgap_h, "g6_gap_H": g6_h, "g6_ratio": g6ratio,
           "g6_outer_ear_mm": g6outer, "g7_ratio": g7ratio, "g8_splay": g8n,
           "g6_mmpx": mmpx,
           "target_inner_edge_profile": _tprof,
           "hem_front_max_arc_mm": front_max * 1000, "hem_back_long": len(back_long)}
    (out / "row-guides5.json").write_text(json.dumps(row, indent=1))
    print("WROTE", out)
main()
