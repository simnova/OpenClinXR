"""hair-guides-8: guides7 + M1 ear-hull bridge, M2 no early stop, M3 F_hem=0, M4 slope slide, M5 face-line/back-sweep cells."""
import argparse, importlib.util, json, sys
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector, kdtree
from mathutils.bvhtree import BVHTree
HERE = Path(__file__).resolve().parent

# ---- M2 flare_profile (style parameter table; P2 target flare profile, mm) ----
# P2 (T/mask-front.png x2 to 1024; centre col 514; mm = px*210.7/480):
#   row1024 607: hw 209px = 91.8mm | 657: 219px = 96.1mm | 707: 247px = 108.4mm
#   757: 265px = 116.3mm | 807: 275px = 120.7mm | hem 859: 185px = 81.2mm (tip)
# Rendered guides6 children outer matches target to ~9px (4mm) mid-shaft; the
# tip differs (blunt hem vs wispy tip). F_hem=15mm per brief expectation
# (12-20mm) so the rendered children outer edge meets the target outer edge
# at the hemi-shaft rows after registration scale; tune in attempts 2-3.
FLARE_PROFILE = {
    "F_hem": 0.0,
    "shape": "smoothstep t=(menton-z)/(menton-zhem), flare=F_hem*t^2*(3-2t)",
    "P2_target_hw_mm": {"r607": 91.8, "r657": 96.1, "r707": 108.4,
                        "r757": 116.3, "r807": 120.7, "hem859_tip": 81.2},
    "attempt": 8,
}
CELL = "A"  # overridden by --cell
HULL_CLEAR = 0.002  # M1: clearance over the ear hulls
FALL_CLEAR = 0.003  # M4: 5mm steps at 3mm clearance
M1_BAND_LO = -0.030  # surface-exit y rel ear_y (temple side)
M1_BAND_HI = 0.025   # surface-exit y rel ear_y (behind-ear side)
EAR_TOP_OFF = 0.005  # surface phase ends at ear_top + 5mm (or cap edge first)
EAR_BOT_DROP = 0.030  # over-ear straight fall until ear_top - 30mm
HEAD_CLEAR = 0.003  # 3mm clearance from OCLX_Aisha_head over the pinna

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
    ap.add_argument("--cell", choices=("A", "B"), default="A")
    aa = ap.parse_args(sys.argv[sys.argv.index("--") + 1:]); out = Path(aa.out)
    global CELL; CELL = aa.cell
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
    # R5: colliders are exactly head + 3 garments (drop anything else, e.g.
    # low-poly backing, so gates measure the approved set only).
    keep_subs = ("aisha_head", "toigo_t_shirt", "tight_jeans", "toigo_mj_cloth_shoes")
    cols = [o for o in cols if any(s in o.name.lower() for s in keep_subs)]
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
    print("yneck=%.4f cell=%s" % (yneck, CELL))
    # ---- P1: ear landmarks per side from OCLX_Aisha_head ----
    import bmesh as _bmesh
    ears = {}
    for sgn, nm in ((-1.0, "L"), (1.0, "R")):
        seed = W[((W[:, 0] - cx) * sgn > 0.045) & (W[:, 1] >= ear_y - 0.060)
                 & (W[:, 1] <= ear_y + 0.025) & (W[:, 2] >= ear_top - 0.050)
                 & (W[:, 2] <= ear_top + 0.015)]
        print("P1 seed %s n=%d" % (nm, len(seed)))
        if len(seed) < 4:
            raise RuntimeError("P1 seed region empty on side %s" % nm)
        ears[nm] = {"ear_top": seed[int(np.argmax(seed[:, 2]))],
                    "ear_back": seed[int(np.argmax(seed[:, 1]))],
                    "ear_front": seed[int(np.argmin(seed[:, 1]))],
                    "lobe": seed[int(np.argmin(seed[:, 2]))], "n": len(seed)}
        for k in ("ear_top", "ear_back", "ear_front", "lobe"):
            print("P1 %s.%s xyz=%s" % (nm, k, np.round(ears[nm][k] * 1000, 1).tolist()))
    for k in ("ear_top", "ear_back", "ear_front", "lobe"):
        lx, rx = ears["L"][k], ears["R"][k]
        print("P1 mirror %s d|x|=%.2fmm dy=%.2fmm dz=%.2fmm" % (
            k, abs(abs(lx[0] - cx) - abs(rx[0] - cx)) * 1000,
            abs(lx[1] - rx[1]) * 1000, abs(lx[2] - rx[2]) * 1000))
    # ---- M1: ear hull per side = convex hull of head verts in the landmark box ----
    HULLS = []
    for sgn, nm in ((-1.0, "L"), (1.0, "R")):
        e = ears[nm]
        ylo, yhi = float(e["ear_front"][1]) - 0.015, float(e["ear_back"][1]) + 0.020
        zlo, zhi = float(e["lobe"][2]) - 0.025, float(e["ear_top"][2]) + 0.015
        sel = None
        for att in range(3):
            pad = att * 0.010
            sel = W[((W[:, 0] - cx) * sgn > 0.030) & (W[:, 1] >= ylo - pad)
                    & (W[:, 1] <= yhi + pad) & (W[:, 2] >= zlo - pad)
                    & (W[:, 2] <= zhi + pad)]
            print("M1 hull %s attempt %d box y=[%.1f,%.1f] z=[%.1f,%.1f] n=%d" % (
                nm, att + 1, (ylo - pad) * 1000, (yhi + pad) * 1000,
                (zlo - pad) * 1000, (zhi + pad) * 1000, len(sel)))
            if len(sel) >= 4:
                break
        if sel is None or len(sel) < 4:
            raise RuntimeError("M1 hull box empty on side %s" % nm)
        me = bpy.data.meshes.new("OCLX_ear_hull_%s_mesh" % nm)
        me.from_pydata([tuple(p) for p in sel], [], [])
        me.update()
        bm = _bmesh.new(); bm.from_mesh(me)
        bm.verts.ensure_lookup_table()
        try:
            _bmesh.ops.convex_hull(bm, input=list(bm.verts))
        except Exception as ex:
            print("M1 hull %s convex_hull failed: %s" % (nm, ex))
            if att >= 2:
                raise
        bm.to_mesh(me); bm.free(); me.update()
        if len(me.polygons) < 4:
            raise RuntimeError("M1 hull %s degenerate (%d faces)" % (nm, len(me.polygons)))
        ho = bpy.data.objects.new("OCLX_ear_hull_%s" % nm, me)
        bpy.context.scene.collection.objects.link(ho)
        ho.hide_render = True  # hidden from render; collider in fall phase only
        ho.update_tag(); bpy.context.view_layer.update()
        HULLS.append(ho)
        print("M1 hull %s verts=%d faces=%d" % (ho.name, len(me.vertices), len(me.polygons)))
    fall_colliders = colliders + HULLS  # R5 + ear hulls (fall phase only)
    REQ = {o.name: (HULL_CLEAR if o in HULLS else FALL_CLEAR) for o in fall_colliders}
    bvhs = {o.name: bvh_of(o, deps) for o in colliders}
    bvh_fall = {o.name: bvh_of(o, deps) for o in fall_colliders}
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
    def y_target(p):
        nm = "L" if float(p[0]) < cx else "R"
        return float(ears[nm]["ear_top"][1]) - 0.005
    def surface_walk(p0):  # A: guides6 face line; B: + back-sweep to ear-top rim
        pts = [np.array(p0, dtype=float)]; prev_n = None; end = "?"
        for _ in range(400):
            q, n = nearest_pt(bvh_body, pts[-1])
            f, L = modeB_dir(pts[-1], n)
            if f[1] < 0: f[1] = 0.0
            # M1: base lateral floor 0.8 only (1.6x face-zone gain and +Y drive removed)
            if abs(pts[-1][0] - cx) < x_face(pts[-1][2]) - 0.005: f = f + 0.8 * L
            if CELL == "B":  # M5 back-sweep: backward component on the tangent
                Yv = np.array([0.0, 1.0, 0.0]); Yp = Yv - (Yv @ n) * n
                f = f + 0.5 * Yp
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
            lat = abs(pts[-1][0] - cx) >= x_face(pts[-1][2]) - 0.005
            if CELL == "B":
                if lat and pts[-1][1] >= y_target(pts[-1]): end = "lateral"; break
                if pts[-1][1] >= y_target(pts[-1]): end = "sweep"; break
            else:
                if lat: end = "lateral"; break
            if pts[-1][2] < ear_top - 0.02:
                end = ("sweep-zfloor" if CELL == "B" else "zfloor"); break
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
    EAR_BOT = ear_top - EAR_BOT_DROP
    def nearest_col_fall(p):
        best = None
        for o in fall_colliders:
            q, n = nearest_pt(bvh_fall[o.name], p)
            if q is None: continue
            d = abs(sdist(p, q, n))
            if best is None or d < best[0]: best = (d, o, q, n)
        return best[1], best[2], best[3]
    def fall_ok(p):
        for o in fall_colliders:
            q, n = nearest_pt(bvh_fall[o.name], p)
            if q is None: continue
            if sdist(p, q, n) < REQ[o.name]: return False
        return True
    def fall_phase(p0, d0, over_ear=False):  # M4 slope slide on R5+hulls
        pts = [np.array(p0, dtype=float)]; d = np.array(d0, dtype=float) / (np.linalg.norm(d0) + 1e-12)
        ph = np.array([d[0], d[1], 0.0]); prev_h = ph / (np.linalg.norm(ph) + 1e-12) if float(np.linalg.norm(ph)) > 1e-9 else np.array([np.sign(p0[0] - cx) or 1.0, 0.0, 0.0])
        cend = False; zh = [float(pts[-1][2])]
        for _ in range(400):
            dd = 0.65 * d + 0.35 * Z; dd = dd / (np.linalg.norm(dd) + 1e-12)
            dd = no_fwd(dd, pts[-1])
            cand = pts[-1] + 0.005 * dd
            if fall_ok(cand):
                pts.append(cand); d = dd; zh.append(float(cand[2]))
            else:
                _, q, n = nearest_col_fall(cand)
                t = Z - (Z @ n) * n; nt = float(np.linalg.norm(t))
                if nt < 0.10:  # truly flat: keep previous horizontal direction
                    s = prev_h.copy()
                else:
                    s = t / nt
                    hh = np.array([s[0], s[1], 0.0])
                    if float(np.linalg.norm(hh)) > 1e-9: prev_h = hh / float(np.linalg.norm(hh))
                s = no_fwd(s, pts[-1])
                sn = float(np.linalg.norm(s)); s = s / sn if sn > 1e-9 else Z.copy()
                pnew = np.array(pts[-1] + 0.005 * s)
                for _ in range(6):
                    moved = False
                    for o in fall_colliders:
                        qq, nn = nearest_pt(bvh_fall[o.name], pnew)
                        if qq is None: continue
                        if sdist(pnew, qq, nn) < REQ[o.name]:
                            pnew = qq + nn * REQ[o.name]; moved = True
                    if not moved: break
                if float(np.linalg.norm(pnew - pts[-1])) >= 1e-6:
                    pts.append(pnew); d = s
                zh.append(float(pts[-1][2]))
                if len(zh) >= 7 and (zh[-7] - zh[-1]) < 0.001:
                    cend = True; break
            if pts[-1][2] <= zhem: break
        return np.array(pts), cend
    chains_raw = []
    from collections import Counter
    endhist = Counter()
    m1count = [0]
    def grow_raw(r):
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
            m1 = False; exit_y = None
            if float(r[1]) < ear_y:  # M8 front roots
                surf, wend = surface_walk(scalp[-1])
                endhist[wend] += 1
                exit_y = float(surf[-1][1])
                # M2: side band keeps guides-6 behaviour (face line, then fall);
                # the M1 hull carries side guides over the ear. m1 = side label.
                if ear_y + M1_BAND_LO <= exit_y <= ear_y + M1_BAND_HI:
                    m1 = True; m1count[0] += 0  # counted after truncate below
                d1 = surf[-1] - surf[-2] if len(surf) > 1 else d0
                fall, ce = fall_phase(surf[-1], d1, over_ear=m1)
                full = np.vstack([scalp[:-1], surf, fall[1:]])
                ph = np.array([0] * (len(scalp) - 1) + [1] * len(surf) + [2] * (len(fall) - 1))
            else:
                fall, ce = fall_phase(scalp[-1], d0, over_ear=False)
                full = np.vstack([scalp[:-1], fall])
                ph = np.array([0] * (len(scalp) - 1) + [2] * len(fall))
            # fall-only light smooth x3 (phase 2 below menton+: free hair, scalp untouched)
            if (ph == 2).sum() > 2:
                for _ in range(3):
                    idx = np.where((ph == 2) & (full[:, 2] <= menton + 0.01))[0]
                    idx = idx[(idx > 0) & (idx < len(full) - 1)]
                    if len(idx):
                        full[idx] = 0.5 * full[idx] + 0.25 * (full[idx - 1] + full[idx + 1])
                for _ in range(2):  # M4 zigzag damp: all free hair
                    idx = np.where(ph == 2)[0]
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
            return (full, ph, ce, np.array(r), m1, exit_y)
    for r in R:
        g1 = grow_raw(r)
        if g1 is not None: chains_raw.append(g1)
    # wave-2: patch coverage holes left by failed traces (cap 600)
    if len(chains_raw) < 600:
        gro = np.array([c[3] for c in chains_raw])
        w2ex = set(); w2add = 0
        for _ in range(60):
            if len(chains_raw) >= 600: break
            Dw = np.linalg.norm(V[:, None, :] - gro[None, :, :], axis=2).min(1)
            if w2ex: Dw[list(w2ex)] = -1.0
            i = int(Dw.argmax())
            if float(Dw[i]) <= 0.009: break
            if float(np.linalg.norm(SV - V[i], axis=1).min()) < 0.0010:
                w2ex.add(i); continue
            g2 = grow_raw(V[i])
            if g2 is None: w2ex.add(i); continue
            chains_raw.append(g2); gro = np.vstack([gro, V[i]]); w2add += 1
        print("WAVE2 added=%d" % w2add)
    # ---- M2: rank guides by |x| at chin height within side, then flare ----
    def x_at_z(P, z):
        zz = P[:, 2]
        if float(zz.min()) >= z: return float(P[int(np.argmin(zz)), 0])
        if float(zz.max()) <= z: return float(P[int(np.argmax(zz)), 0])
        for k in range(1, len(P)):
            if (zz[k - 1] - z) * (zz[k] - z) <= 0.0 and abs(zz[k] - zz[k - 1]) > 1e-12:
                f = (z - zz[k - 1]) / (zz[k] - zz[k - 1])
                return float(P[k - 1][0] * (1 - f) + P[k][0] * f)
        return float(P[int(np.argmin(np.abs(zz - z))), 0])
    xchin = np.array([x_at_z(c[0], menton) for c in chains_raw])
    side = np.where(xchin - cx >= 0.0, 1.0, -1.0)
    rank = np.zeros(len(chains_raw))
    for s in (-1.0, 1.0):
        idx = np.where(side == s)[0]
        order = idx[np.argsort(np.abs(xchin[idx] - cx), kind="stable")]
        for pos, gi in enumerate(order):
            rank[gi] = pos / max(len(order) - 1, 1)
    F_HEM = float(FLARE_PROFILE["F_hem"])
    print("M2 flare F_hem=%.1fmm sides L=%d R=%d" % (F_HEM * 1000, int((side < 0).sum()), int((side > 0).sum())))
    def flare_of(z):
        t = (menton - float(z)) / max(menton - zhem, 1e-12)
        t = min(max(t, 0.0), 1.0)
        return F_HEM * t * t * (3.0 - 2.0 * t)
    # ---- M3: kink drop (>45deg), clearance truncate, resample ----
    def kink_clean(P, PH):
        P = [np.array(p, dtype=float) for p in P]; H = list(PH)
        for _ in range(3):
            drop = set()
            for k in range(1, len(P) - 1):
                a = P[k] - P[k - 1]; b = P[k + 1] - P[k]
                na = float(np.linalg.norm(a)); nb = float(np.linalg.norm(b))
                if na < 1e-12 or nb < 1e-12: continue
                ang = float(np.degrees(np.arccos(np.clip((a @ b) / (na * nb), -1, 1))))
                if ang > 45.0: drop.add(k)
            if not drop: break
            P = [p for j, p in enumerate(P) if j not in drop]
            H = [h for j, h in enumerate(H) if j not in drop]
            if len(P) < 4: break
        # re-merge <1mm after drops
        keep = [0]
        for k in range(1, len(P)):
            if float(np.linalg.norm(P[k] - P[keep[-1]])) >= 0.001: keep.append(k)
        return np.array([P[k] for k in keep]), np.array([H[k] for k in keep])
    chains = []; trunc_kept = 0; drop_pre = 0; drop_post = 0
    for gi, (full, ph, ce, root, m1, exit_y) in enumerate(chains_raw):
        full = full.copy()
        rr = float(rank[gi])
        if rr > 0.0:
            for j in range(len(full)):
                if full[j][2] < menton:
                    fl = flare_of(full[j][2]) * rr
                    if fl <= 0.0: continue
                    dv = full[j].copy(); dv[0] -= cx; dv[1] -= yneck; dv[2] = 0.0
                    nl = float(np.linalg.norm(dv))
                    if nl < 1e-9:
                        dv = np.array([np.sign(full[j][0] - cx) or 1.0, 0.0, 0.0])
                    else: dv = dv / nl
                    step = fl
                    moved = False
                    for _ in range(10):
                        cand = full[j] + step * dv
                        _, ins = clearance(cand)
                        if not ins:
                            full[j] = cand; moved = True; break
                        step *= 0.5
                    # if never outside, keep original point (no push into collider)
        full, ph = kink_clean(full, ph)
        if len(full) < 4:
            drop_pre += 1; continue
        # M3 final clearance (attempt 3): trailing trim — cut the guide at
        # its LAST outside point, i.e. remove only a trailing inside run.
        # Mid-guide grazes are kept and counted in G2 (same pinch family as
        # guides6: shirt-hug + pinna folds); cutting them mid-guide caused
        # the attempt-1 stub/shorts/gap damage. Post-resample is measure-only
        # (guides6 freeze): corner-cuts are counted in G2, guides are kept.
        out_idx = None
        for j in range(len(full) - 1, -1, -1):
            if fall_ok(full[j]):
                out_idx = j; break
        was_trunc = False
        if out_idx is None:
            drop_pre += 1; continue
        if out_idx < len(full) - 1:
            if out_idx + 1 < 4:
                drop_pre += 1; continue
            full = full[:out_idx + 1]; ph = ph[:out_idx + 1]
            trunc_kept += 1
            was_trunc = True
        rs, rph = resample_smooth(full, ph)  # U1 smooth uniform 32
        # M4 clearance settle: single worst-projection pass for truly-inside
        # points only (no iteration: iterating collapses folds onto planes).
        for k in range(len(rs)):
            w = None
            for o in fall_colliders:
                qq, nn = nearest_pt(bvh_fall[o.name], rs[k])
                if qq is None: continue
                s0 = sdist(rs[k], qq, nn)
                if s0 < 0.0 and (w is None or s0 < w[0]): w = (s0, qq, nn, o)
            if w is not None:
                rs[k] = w[1] + w[2] * REQ[w[3].name]
        chains.append((rs, rph, ce, root, m1, was_trunc))
    n = len(chains)
    G = np.array([c[0] for c in chains]); RPH = np.array([c[1] for c in chains]); CE = np.array([c[2] for c in chains])
    GR = np.array([c[3] for c in chains]); M1F = np.array([c[4] for c in chains])
    TRUNC = np.array([c[5] for c in chains])
    n_trunc = int(TRUNC.sum()) + int(drop_pre) + int(drop_post)
    n_raw = len(chains_raw)
    print("GUIDES n=%d raw=%d contact-ended=%d m1side=%d walk-end=%s" % (n, n_raw, int(CE.sum()), int(M1F.sum()), dict(endhist)))
    print("TRUNC kept=%d drop_pre=%d drop_post=%d total=%d (%.1f%%)" % (
        int(TRUNC.sum()), int(drop_pre), int(drop_post), n_trunc, 100.0 * n_trunc / max(n_raw, 1)))
    # P1 probe: surface-exit band counts (pre-truncation exit_y from grow_raw)
    p1_exit = np.array([c[5] for c in chains_raw if c[5] is not None], dtype=float)
    p1_above = int((p1_exit > ear_y).sum()) if len(p1_exit) else 0
    p1_band = int(((p1_exit >= ear_y - 0.025) & (p1_exit <= ear_y + 0.010)).sum()) if len(p1_exit) else 0
    p1_m1 = int(((p1_exit >= ear_y + M1_BAND_LO) & (p1_exit <= ear_y + M1_BAND_HI)).sum()) if len(p1_exit) else 0
    print("P1 exits n=%d y>ear_y=%d band[ear_y-25mm,ear_y+10mm]=%d m1band[ear_y-30mm,ear_y+25mm]=%d" % (
        len(p1_exit), p1_above, p1_band, p1_m1))
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
            for o in fall_colliders:  # G2: inside R5+hulls, min clearance raw
                q, n_ = nearest_pt(bvh_fall[o.name], p)
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
                m = min(abs(sdist(p, *nearest_pt(bvh_fall[o.name], p))) for o in fall_colliders)
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
    g6p95, g6max = float(np.percentile(rates, 95)), float(rates.max())
    seglens = np.linalg.norm(np.diff(G, axis=1), axis=2)
    g6short = int((seglens < 0.0025).sum())
    nan_ct = int(np.isnan(G).sum())
    pts_ok = bool(all(len(g) == 32 for g in G))
    trunc_pct = 100.0 * n_trunc / max(n_raw, 1)
    print("G1 n=%d pts32=%s nan=%d trunc=%d (%.1f%%)" % (n, pts_ok, nan_ct, n_trunc, trunc_pct))
    # G5: ear-row / hem-row outer half-width (guides geometry, interp at z)
    EAR_ROW_Z = ear_top - 0.015
    def outer_hw(z):
        vals = []
        for g in G:
            zz = g[:, 2]
            if float(zz.min()) > z or float(zz.max()) < z: continue
            k = next((k for k in range(1, len(g)) if (zz[k - 1] - z) * (zz[k] - z) <= 0.0), None)
            if k is None: continue
            if abs(zz[k] - zz[k - 1]) < 1e-12: x = float(g[k][0])
            else:
                f = (z - zz[k - 1]) / (zz[k] - zz[k - 1])
                x = float(g[k - 1][0] * (1 - f) + g[k][0] * f)
            vals.append(abs(x - cx))
        return (max(vals) * 1000.0) if vals else 0.0
    g5ear = outer_hw(EAR_ROW_Z); g5hem = outer_hw(zhem)
    print("G5 ear=%.1fmm (tgt 86.3) hem=%.1fmm (tgt 120.7)" % (g5ear, g5hem))
    # G7: continuity at the ear row per side (azimuth order, 3D gaps)
    def pts_at_z(z):
        out = []
        for gi, g in enumerate(G):
            zz = g[:, 2]
            if float(zz.min()) > z or float(zz.max()) < z: continue
            k = next((k for k in range(1, len(g)) if (zz[k - 1] - z) * (zz[k] - z) <= 0.0), None)
            if k is None: continue
            if abs(zz[k] - zz[k - 1]) < 1e-12: p = g[k].copy()
            else:
                f = (z - zz[k - 1]) / (zz[k] - zz[k - 1])
                p = g[k - 1] * (1 - f) + g[k] * f
            out.append(p)
        return np.array(out)
    ear_pts = pts_at_z(EAR_ROW_Z)
    g5side = {}
    for sgn, nm in ((-1.0, "L"), (1.0, "R")):
        sel = ear_pts[(ear_pts[:, 0] - cx) * sgn > 0] if len(ear_pts) else np.zeros((0, 3))
        if len(sel) < 2:
            g5side[nm] = {"n": int(len(sel)), "maxgap_mm": 999.0}; continue
        az = np.arctan2(sel[:, 1] - medy, sel[:, 0] - cx)
        sel = sel[np.argsort(az, kind="stable")]
        dd = np.linalg.norm(np.diff(sel, axis=0), axis=1)  # G5: no wrap chord
        g5side[nm] = {"n": int(len(sel)), "maxgap_mm": float(dd.max() * 1000.0) if len(dd) else 0.0}
    g7gap = max(g5side["L"]["maxgap_mm"], g5side["R"]["maxgap_mm"])
    print("G5 ear-row L n=%d gap=%.1fmm | R n=%d gap=%.1fmm" % (
        g5side["L"]["n"], g5side["L"]["maxgap_mm"], g5side["R"]["n"], g5side["R"]["maxgap_mm"]))
    np.savez(out / "guides8.npz", points=G, roots=R, phases=RPH, contact_ended=CE, z_hem=zhem, menton_z=menton, crown_z=crown)
    # ---- O2 tubes: 3 groups (front curtain cyan / side-over-ear yellow / back magenta) ----
    GRP = np.where(M1F, 1, np.where((RPH == 1).any(axis=1), 0, 2))
    print("GRP front=%d side=%d back=%d" % (int((GRP == 0).sum()), int((GRP == 1).sum()), int((GRP == 2).sum())))
    h.hair.hide_render = h.hair.hide_viewport = True
    bpy.context.scene.view_settings.view_transform = "Standard"
    cu = bpy.data.curves.new("OCLX_guide_tubes8", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.001
    grp_cols = [(0.0, 1.0, 1.0, 1.0), (1.0, 0.85, 0.0, 1.0), (1.0, 0.0, 1.0, 1.0)]
    grp_mats = []
    for gi_col, cc4 in enumerate(grp_cols):
        om = bpy.data.materials.new("OCLX_guide_debug8_%d" % gi_col); om.use_nodes = True
        nt = om.node_tree; nt.nodes.clear()
        mout = nt.nodes.new("ShaderNodeOutputMaterial")
        em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = cc4; em.inputs["Strength"].default_value = 0.6
        nt.links.new(em.outputs[0], mout.inputs[0])
        cu.materials.append(om); grp_mats.append(om)
    for gi, g in enumerate(G):
        sp = cu.splines.new("POLY"); sp.points.add(31)
        for k, p in enumerate(g): sp.points[k].co = (float(p[0]), float(p[1]), float(p[2]), 1.0)
        sp.material_index = int(GRP[gi])
    to = bpy.data.objects.new("OCLX_guide_tubes8", cu); bpy.context.scene.collection.objects.link(to)
    to.update_tag(); bpy.context.view_layer.update()
    # O2: ear hulls as wire overlay in the tube views only (hidden from render elsewhere)
    hwm = bpy.data.materials.new("OCLX_hull_wire8"); hwm.use_nodes = True
    hnt = hwm.node_tree; hnt.nodes.clear()
    hout = hnt.nodes.new("ShaderNodeOutputMaterial")
    hem = hnt.nodes.new("ShaderNodeEmission"); hem.inputs["Color"].default_value = (1.0, 0.85, 0.0, 1.0); hem.inputs["Strength"].default_value = 0.6
    hnt.links.new(hem.outputs[0], hout.inputs[0])
    for ho in HULLS:
        ho.hide_render = False
        md = ho.modifiers.new("OCLX_wire8", "WIREFRAME"); md.thickness = 0.0004
        if len(ho.data.materials) == 0: ho.data.materials.append(hwm)
        else: ho.data.materials[0] = hwm
        ho.update_tag()
    bpy.context.view_layer.update()
    sc = bpy.context.scene; sc.render.resolution_x = sc.render.resolution_y = 1024
    sc.cycles.samples = 32; sc.cycles.seed = 0
    cam = h.camera; tgt = Vector((cx, float(np.median(W[:, 1])), menton + 0.06)); dist = 0.85
    def track(o, t): o.rotation_euler = (Vector(t) - o.location).to_track_quat("-Z", "Y").to_euler()
    views = [("front", tgt + Vector((0, -dist, 0.02))), ("three_quarter", tgt + Vector((dist * 0.68, -dist * 0.68, 0.14))),
             ("profile", tgt + Vector((dist, 0, 0.02))), ("back", tgt + Vector((0, dist, 0.08))), ("top", tgt + Vector((0, -0.10, dist)))]
    for name, loc in views:
        cam.location = tuple(loc); track(cam, tgt)
        sc.render.filepath = str(out / ("v8_%s.png" % name)); bpy.ops.render.render(write_still=True)
    for ho in HULLS:  # re-hide hulls before masks/measurements
        try: ho.modifiers.remove(ho.modifiers["OCLX_wire8"])
        except Exception: pass
        ho.hide_render = True
    bpy.context.view_layer.update()
    from PIL import Image, ImageDraw
    cells = [Image.open(out / ("v8_%s.png" % v)).convert("RGB") for v, _ in views]
    Wd, Hd = cells[0].size; lab = 36
    sheet = Image.new("RGB", (Wd * 5, Hd + lab), (20, 20, 20)); dr = ImageDraw.Draw(sheet)
    for k, (v, _) in enumerate(views):
        sheet.paste(cells[k], (k * Wd, lab)); dr.text((k * Wd + 10, 10), v, fill=(255, 165, 0))
    sheet.save(out / ("guides8-debug-cell%s.png" % CELL))
    # ---- masks: guides-only white tubes, body VISIBLE as black occluder ----
    import bpy_extras.object_utils as OU
    hid = {o.name: (o.hide_render, o.hide_viewport) for o in bpy.data.objects}
    bodymats = list(body.data.materials)
    def render_mask(view_loc, path):
        for o in bpy.data.objects:
            if o is to or o is body: o.hide_render = o.hide_viewport = False
            else: o.hide_render = o.hide_viewport = True
        wm = bpy.data.materials.new("OCLX_mask8_white"); wm.use_nodes = True
        wnt = wm.node_tree; wnt.nodes.clear()
        wout = wnt.nodes.new("ShaderNodeOutputMaterial")
        wem = wnt.nodes.new("ShaderNodeEmission"); wem.inputs["Color"].default_value = (1, 1, 1, 1); wem.inputs["Strength"].default_value = 1.0
        wnt.links.new(wem.outputs[0], wout.inputs[0])
        cu.materials.clear(); cu.materials.append(wm)
        bm = bpy.data.materials.new("OCLX_mask8_black"); bm.use_nodes = True
        bnt = bm.node_tree; bnt.nodes.clear()
        bout = bnt.nodes.new("ShaderNodeOutputMaterial")
        bem = bnt.nodes.new("ShaderNodeEmission"); bem.inputs["Color"].default_value = (0, 0, 0, 1); bem.inputs["Strength"].default_value = 0.0
        bnt.links.new(bem.outputs[0], bout.inputs[0])
        body.data.materials.clear(); body.data.materials.append(bm)
        old_world = sc.world
        bw = bpy.data.worlds.new("OCLX_black8_world"); bw.use_nodes = True
        bw.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
        bw.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
        sc.world = bw
        sc.render.film_transparent = False
        cam.location = tuple(view_loc); track(cam, tgt)
        sc.render.filepath = str(path); bpy.ops.render.render(write_still=True)
        sc.world = old_world
        cu.materials.clear()
        for mm in grp_mats: cu.materials.append(mm)
        body.data.materials.clear()
        for mm in bodymats: body.data.materials.append(mm)
        for dd in (wm, bm, bw):
            try: bpy.data.materials.remove(dd)
            except Exception:
                try: bpy.data.worlds.remove(dd)
                except Exception: pass
    try:
        front_loc = tgt + Vector((0, -dist, 0.02))
        prof_loc = tgt + Vector((dist, 0, 0.02))
        render_mask(front_loc, out / "guides-front-mask.png")
        render_mask(prof_loc, out / "guides-profile-mask.png")
    finally:
        for on, (hr, hv) in hid.items():
            o = bpy.data.objects.get(on)
            if o: o.hide_render, o.hide_viewport = hr, hv
    # ---- image measurements: G3 face gap, G8 eye box (front mask) ----
    eyez = browz
    mimg = np.asarray(Image.open(out / "guides-front-mask.png").convert("L"))
    Hr, Wr = mimg.shape
    cam.location = tuple(tgt + Vector((0, -dist, 0.02))); track(cam, tgt)
    bpy.context.view_layer.update()
    def proj_row_col(p):
        v = OU.world_to_camera_view(sc, cam, Vector(tuple(p)))
        return int((1 - v.y) * Hr), int(v.x * Wr)
    rcrown, cc = proj_row_col((cx, medy, crown))
    rment, _ = proj_row_col((cx, medy, menton))
    reye, cce = proj_row_col((cx, medy, eyez))
    rjaw, _ = proj_row_col((cx, medy, _jaw_z))
    rear, _ = proj_row_col((cx, medy, ear_top - 0.015))
    px_per_row = abs(rcrown - rment); mmpx = 210.7 / px_per_row if px_per_row > 0 else float("nan")
    Hpx = float(px_per_row)
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
    eye_gap_px, _ = row_gap(reye, cce)
    jaw_gap_px, _ = row_gap(rjaw, cce)
    eye_frac = float(eye_gap_px / Hpx) if Hpx else 0.0
    jaw_frac = float(jaw_gap_px / Hpx) if Hpx else 0.0
    print("G3 rows crown=%d menton=%d eye=%d jaw=%d Hpx=%.1f eye=%.3f jaw=%.3f" % (
        rcrown, rment, reye, rjaw, Hpx, eye_frac, jaw_frac))
    # G8: hair px inside eye box (centre ± 0.80 × half the TARGET gap)
    tgt_eye_gap_px = 0.494 * Hpx  # judge target eye opening frac (row-blend.json)
    half = 0.5 * tgt_eye_gap_px * 0.80
    r0, r1 = max(reye - 20, 0), min(reye + 20, Hr)
    c0, c1 = max(int(cce - half), 0), min(int(cce + half), Wr)
    g8px = int((mimg[r0:r1, c0:c1] > 128).sum())
    print("G8 eyebox rows %d-%d cols %d-%d hairPx=%d" % (r0, r1, c0, c1, g8px))
    # G4 front: skin ear px outside the hair (beauty + mask edges, rows 330-420)
    beau = np.asarray(Image.open(out / "v8_front.png").convert("RGB")).astype(np.int32)
    Rb, Gb, Bb = beau[..., 0], beau[..., 1], beau[..., 2]
    skin = (Rb > 100) & (Rb - Gb > 8) & (Rb - Bb > 8) & (Gb > 80) & (Bb > 60) & (Rb < 245)
    eL = eR = 0
    for r in range(330, 421):
        if r >= Hr: break
        cols = np.where(mimg[r] > 128)[0]
        if len(cols) == 0: continue
        Lr, Rr = int(cols.min()), int(cols.max())
        eL += int(skin[r, :Lr].sum()); eR += int(skin[r, Rr + 1:].sum())
    print("G4 front earSkinL=%d earSkinR=%d" % (eL, eR))
    # G4 profile: pinna-bbox hair frac (profile mask + projected pinna verts)
    pmimg = np.asarray(Image.open(out / "guides-profile-mask.png").convert("L"))
    PHr, PWr = pmimg.shape
    cam.location = tuple(tgt + Vector((dist, 0, 0.02))); track(cam, tgt)
    bpy.context.view_layer.update()
    pin = W[(np.abs(W[:, 1] - ear_y) <= 0.012) & (W[:, 2] >= ear_top - 0.032)
            & (W[:, 2] <= ear_top + 0.002) & (np.abs(W[:, 0] - cx) > 0.040)]
    if len(pin) == 0:
        pin = W[(np.abs(W[:, 1] - ear_y) <= 0.015) & (W[:, 2] >= ear_top - 0.035)
                & (W[:, 2] <= ear_top + 0.005) & (np.abs(W[:, 0] - cx) > 0.030)]
    print("G4 pinna verts=%d" % len(pin))
    proffrac = 0.0
    if len(pin):
        pr = []; pc = []
        for p in pin:
            v = OU.world_to_camera_view(sc, cam, Vector(tuple(p)))
            pr.append(int((1 - v.y) * PHr)); pc.append(int(v.x * PWr))
        rmin, rmax = max(min(pr), 0), min(max(pr), PHr - 1)
        cmin, cmax = max(min(pc), 0), min(max(pc), PWr - 1)
        area = max((rmax - rmin + 1) * (cmax - cmin + 1), 1)
        proffrac = float((pmimg[rmin:rmax + 1, cmin:cmax + 1] > 128).sum() / area)
        print("G4 profile bbox rows %d-%d cols %d-%d hairFrac=%.3f" % (rmin, rmax, cmin, cmax, proffrac))
    def row_sides(r, c0):
        band = (mimg[max(r - 3, 0):r + 4, :] > 128).any(axis=0).astype(float)
        k = np.ones(21) / 21
        sm = np.convolve(band, k, mode="same")
        thr = 0.3 * sm.max() if sm.max() > 0 else 1.0
        left = np.where(sm[:c0] > thr)[0]; right = np.where(sm[c0:] > thr)[0]
        if not len(left) or not len(right): return 0.0, 0.0
        return float(c0 - left[-1]), float(right[0])
    eLh, eRh = row_sides(reye, cce); jLh, jRh = row_sides(rjaw, cce)
    print("G3-proxy sides eye L=%.1f R=%.1f jaw L=%.1f R=%.1f px (Hpx=%.1f)" % (eLh, eRh, jLh, jRh, Hpx))
    half7 = 0.80 * 0.175 * Hpx  # G7 eye box half-width on the guides mask
    c0b, c1b = max(int(cce - half7), 0), min(int(cce + half7), Wr)
    g7px = int((mimg[r0:r1, c0b:c1b] > 128).sum())
    print("G7-proxy eyebox cols %d-%d hairPx=%d" % (c0b, c1b, g7px))
    ce_frac = 100.0 * int(CE.sum()) / max(n, 1)
    short_frac = float((seglens < 0.0025).sum()) / max(seglens.size, 1)
    gates = [
        ("G1", "n=%d pts=%d nan=%d ce=%.1f%%" % (n, 32 if pts_ok else 0, nan_ct, ce_frac),
         "count in [536,656] and 32 pts and 0 NaN and ce<=8%",
         536 <= n <= 656 and pts_ok and nan_ct == 0 and ce_frac <= 8.0),
        ("G2", "inside=%d min=%.2fmm" % (ins, g2min * 1000), "0 inside and min>=1.0mm",
         ins == 0 and g2min >= 0.0010),
        ("G5", "Lgap=%.1fmm Rgap=%.1fmm" % (g5side["L"]["maxgap_mm"], g5side["R"]["maxgap_mm"]),
         "per-side ear-row neighbour gap<=10mm (no wrap)",
         g5side["L"]["maxgap_mm"] <= 10.0 and g5side["R"]["maxgap_mm"] <= 10.0),
        ("G6", "p95=%.2f max=%.2f short=%.3f%%" % (g6p95, g6max, short_frac * 100.0),
         "p95<=12 and max<=45 and short<=1%",
         g6p95 <= 12 and g6max <= 45 and short_frac <= 0.01),
    ]
    for g, m, b, ok in gates: print("%s %s | %s %s" % (g, m, b, "PASS" if ok else "MISS"))
    earj = {nm: {kk: (vv.tolist() if isinstance(vv, np.ndarray) else vv)
                 for kk, vv in e.items()} for nm, e in ears.items()}
    stats = {"cell": CELL,
             "gates": [{"gate": g, "measured": m, "bar": b, "verdict": "PASS" if ok else "MISS"} for g, m, b, ok in gates],
             "z_hem": zhem, "menton_z": menton, "crown_z": crown, "brow_z": browz, "ear_y": ear_y,
             "ear_top": ear_top, "ear_row_z": EAR_ROW_Z, "yneck": yneck, "count": n, "contact_ended": int(CE.sum()),
             "contact_ended_frac": float(ce_frac), "m1_side": int(M1F.sum()), "trunc_kept": int(TRUNC.sum()),
             "drop_pre": int(drop_pre), "drop_post": int(drop_post), "n_raw": int(n_raw), "n_trunc": int(n_trunc),
             "ears": earj,
             "hulls": [{"name": ho.name, "faces": len(ho.data.polygons), "verts": len(ho.data.vertices)} for ho in HULLS],
             "P2_target_hw_mm": FLARE_PROFILE["P2_target_hw_mm"],
             "x_face_jaw_mm": 48.0, "x_face_menton_mm": 34.0, "x_face_jaw_z": _jaw_z,
             "flare": {"F_hem_mm": F_HEM * 1000.0, "shape": FLARE_PROFILE["shape"], "attempt": FLARE_PROFILE["attempt"]},
             "grp": {"front": int((GRP == 0).sum()), "side": int((GRP == 1).sum()), "back": int((GRP == 2).sum())},
             "mask_rows": {"crown": int(rcrown), "menton": int(rment), "eye": int(reye), "jaw": int(rjaw),
                           "ear": int(rear), "Hpx": float(Hpx), "mmpx": float(mmpx)},
             "g2_inside": int(ins), "g2_min_mm": float(g2min * 1000), "g2_by": {k: int(v) for k, v in ins_by.items()},
             "g3_proxy": {"eye_full_frac": eye_frac, "jaw_full_frac": jaw_frac,
                          "eye_L_px": eLh, "eye_R_px": eRh, "jaw_L_px": jLh, "jaw_R_px": jRh},
             "g4_proxy": {"earSkinL": int(eL), "earSkinR": int(eR), "profHair": float(proffrac)},
             "g5": g5side, "g6_p95": float(g6p95), "g6_max": float(g6max),
             "g6_short": int((seglens < 0.0025).sum()), "g6_short_frac": float(short_frac),
             "g7_proxy_px": int(g7px), "g8_proxy_px": int(g8px),
             "g5_ear_mm": None, "g5_hem_mm": None,
             "walk_end": {k: int(v) for k, v in endhist.items()}}
    (out / "stats8.json").write_text(json.dumps(stats, indent=1))
    print("WROTE", out)
main()
