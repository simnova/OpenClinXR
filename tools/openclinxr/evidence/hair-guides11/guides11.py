"""hair-guides-10 (copy of guides8 + S1 mirror-test, S2 back-sweep): guides7 + M1 ear-hull bridge, M2 no early stop, M3 F_hem=0, M4 slope slide, M5 face-line/back-sweep cells."""
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
HULL_CLEAR = 0.004  # S2(ii)+G6: 4mm clearance, ear hull as collider
FALL_CLEAR = 0.004  # S2+G6: 5mm steps at 4mm clearance (no post-resample moves)
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
    ap.add_argument("--mirror-test", action="store_true")
    ap.add_argument("--s1-raw", action="store_true")
    ap.add_argument("--stem", default="guides10")
    ap.add_argument("--dump-paths", action="store_true")
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--falltrace", action="store_true")
    aa = ap.parse_args(sys.argv[sys.argv.index("--") + 1:]); out = Path(aa.out)
    global CELL; CELL = aa.cell
    global MIRROR_TEST, STEM; MIRROR_TEST = aa.mirror_test; STEM = aa.stem
    global S1RAW; S1RAW = aa.s1_raw
    global DUMPPATHS; DUMPPATHS = aa.dump_paths
    global PROBE; PROBE = aa.probe
    global FALLTRACE; FALLTRACE = aa.falltrace
    global TRACESET, TRACELOG, CURGI, CURRUN; TRACESET = set(); TRACELOG = {}; CURGI = -1; CURRUN = "solo"
    if FALLTRACE:
        import os as _os
        _tp = "/tmp/falltrace.json"
        if _os.path.exists(_tp):
            TRACESET = set(json.load(open(_tp)))
        else:
            TRACESET = set([104, 181, 412, 43, 107])
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
    F = HERE.parent / "hair-cap5"
    cap = np.load(F / "cap-v5.npz"); fb = np.load(F / "flow-b-v5.npz", allow_pickle=True)
    V = np.array(cap["verts"]); slit = set(int(v) for v in cap["slit"])
    ear_y = float(cap["ear_y"]); ear_top = float(cap["ear_top"])
    ear_front_y = float(cap["ear_front_y"])
    brow_z = float(cap["brow_z"]); nasion_z = float(cap["nasion_z"]); menton_z = float(cap["menton_z"])
    # R3: cap v5 carries measured brow/nasion/menton; the old mesh-derived brow
    # constant 1.5303 sat at the nose. Use cap values for gates/hem from here on.
    menton = float(menton_z); zhem = float(menton_z) - 0.73 * 0.2107
    fB = np.array(fb["f"])
    print("crown=%.4f menton=%.4f zhem=%.4f ear_y=%.4f ear_top=%.4f brow_z=%.4f nasion_z=%.4f ear_front_y=%.4f" % (crown, menton, zhem, ear_y, ear_top, brow_z, nasion_z, ear_front_y))
    hairline_z = float(np.mean(np.array(cap["forehead"]) * 0.0 + V[np.array(cap["forehead"])][:, 2]))
    print("hairline_z=%.4f" % hairline_z)
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
    # ---- M1: ear hulls hulled per side, merged into ONE collider object ----
    # S1: a single hull instance keeps mirror-averaged walk queries bitwise-exact
    # (two per-side BVH instances broke exactness via index-order tie-breaks).
    # S2/G6: TIGHT pinna box from cap landmarks (the old box used the misnamed
    # P1 ear_front temple point and spanned the whole sideburn y -112..+5, so
    # temple strands walked through hull interior and counted G6-inside).
    _hull_vv, _hull_ff = [], []
    for sgn, nm in ((-1.0, "L"), (1.0, "R")):
        ylo, yhi = ear_y - 0.020, ear_y + 0.015
        zlo, zhi = ear_top - 0.035, ear_top + 0.005
        sel = None
        for att in range(3):
            pad = att * 0.010
            sel = W[((W[:, 0] - cx) * sgn > 0.045 - pad) & ((W[:, 0] - cx) * sgn < 0.090 + pad)
                    & (W[:, 1] >= ylo - pad) & (W[:, 1] <= yhi + pad)
                    & (W[:, 2] >= zlo - pad) & (W[:, 2] <= zhi + pad)]
            print("M1 hull %s attempt %d box |x|=[%.1f,%.1f] y=[%.1f,%.1f] z=[%.1f,%.1f] n=%d" % (
                nm, att + 1, (0.045 - pad) * 1000, (0.090 + pad) * 1000,
                (ylo - pad) * 1000, (yhi + pad) * 1000,
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
        base = len(_hull_vv)
        _hull_vv += [tuple(v.co) for v in me.vertices]
        _hull_ff += [tuple(p.vertices[i] + base for i in range(len(p.vertices))) for p in me.polygons]
        print("M1 hull %s verts=%d faces=%d" % (nm, len(me.vertices), len(me.polygons)))
        bpy.data.meshes.remove(me)
    _hme = bpy.data.meshes.new("OCLX_ear_hull_mesh")
    _hme.from_pydata(_hull_vv, [], _hull_ff); _hme.update()
    _ho = bpy.data.objects.new("OCLX_ear_hull", _hme)
    bpy.context.scene.collection.objects.link(_ho)
    _ho.hide_render = True  # hidden from render; collider in fall phase only
    _ho.update_tag(); bpy.context.view_layer.update()
    HULLS = [_ho]
    print("M1 hull merged verts=%d faces=%d" % (len(_hme.vertices), len(_hme.polygons)))
    fall_colliders = colliders + HULLS  # R5 + ear hulls (fall phase only)
    if PROBE:
        dd = {"W": W.astype(np.float32), "cx": np.array(cx), "medy": np.array(medy),
              "ear_top_y": np.array(ear_top), "ear_y": np.array(ear_y)}
        for ho in HULLS:
            me = ho.data
            vv = np.array([tuple(ho.matrix_world @ v.co) for v in me.vertices], dtype=np.float64)
            ff = np.array([tuple(p.vertices) for p in me.polygons], dtype=object)
            tag = ("L" if ho.name.endswith("_L") else ("R" if ho.name.endswith("_R") else "M"))
            dd["hull" + tag + "_v"] = vv.astype(np.float32)
            dd["hull" + tag + "_f"] = ff
        np.savez(out / "stage1-probe.npz", **dd)
        print("WROTE", out / "stage1-probe.npz")
        return
    REQ = {o.name: (HULL_CLEAR if o in HULLS else FALL_CLEAR) for o in fall_colliders}
    PROX = 0.015  # S1 broadphase: a 5mm fall step never touches a surface 15mm
    # away; without it a faceted far hull's edge-face sign flip (measured
    # -86.62mm on hull_L for a right-side point) teleports the strand 84.68mm
    bvhs = {o.name: bvh_of(o, deps) for o in colliders}
    bvh_fall = {o.name: bvh_of(o, deps) for o in fall_colliders}
    bvh_body = bvhs[body.name]
    def mir0(p):
        """Mirror about x=0 (exact involution: mir(mir(p))==p bitwise). cx~1e-9."""
        q = np.array(p, dtype=float); q[0] = -q[0]; return q
    def nearest_sym(bvh, p):
        """S1 mirror-averaged query: bitwise-identical (up to mirror) for p and
        mir0(p), so the walk is a symmetric function of its root despite BVH
        index-order tie-breaks (measured 0.13mm from one plain projection)."""
        q1, n1 = nearest_pt(bvh, p)
        if q1 is None: return None, None, None
        mp = mir0(p)
        q2, n2 = nearest_pt(bvh, mp)
        if q2 is None: return np.array(q1), np.array(n1), sdist(p, q1, n1)
        q2m = mir0(q2); n2m = np.array(n2, dtype=float); n2m[0] = -n2m[0]
        q = 0.5 * (np.array(q1, dtype=float) + q2m)
        nn = np.array(n1, dtype=float) + n2m; l = float(np.linalg.norm(nn))
        n = nn / l if l > 1e-9 else np.array(n1, dtype=float)
        sd = 0.5 * (sdist(p, q1, n1) + sdist(mp, np.array(q2), np.array(n2)))
        return q, n, sd
    def clearance_sym(p):
        m = 1e9; inside = False
        for o in colliders:
            q, n, s = nearest_sym(bvhs[o.name], p)
            if q is None: continue
            m = min(m, abs(s))
            if s < 0: inside = True
        return (0.0 if inside else m), inside
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
    def cap_dist_sym(p):
        """S1 symmetric cap distance: max of both-side distances so mirror-pair
        traces exit on the same step (capBVH ties broke exit timing per side)."""
        _, _, _, d1 = capBVH.find_nearest(Vector(tuple(p)))
        _, _, _, d2 = capBVH.find_nearest(Vector(tuple(mir0(p))))
        f1 = float(d1) if d1 is not None else 1e9
        f2 = float(d2) if d2 is not None else 1e9
        return max(f1, f2)
    def trace_root(r):
        p = Vector(tuple(r)); pl = [tuple(r)]
        for _ in range(100):
            _, vi, _ = kd.find(p)
            _mp = mir0(np.array(tuple(p), dtype=float))
            _, vj, _ = kd.find(Vector(tuple(_mp)))
            _fj = np.array(fB[vj], dtype=float); _fj[0] = -_fj[0]
            fv = 0.5 * (np.array(fB[vi], dtype=float) + _fj)  # S1: mirror-averaged
            # flow so KD index-order ties cannot fork mirror-pair traces
            nl = float(np.linalg.norm(fv))
            if nl < 1e-9: break
            p_new = p + Vector(tuple(fv / nl * 0.002))
            # cap space == world (body at origin); sym-averaged body projection
            q, n, _sd = nearest_sym(bvh_body, np.array(tuple(p_new), dtype=float))
            p_proj = Vector(tuple(q)) if q is not None else p_new
            if cap_dist_sym(p_proj) > 0.0015:
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
    def surface_walk(p0, sweep=True, dest_y=None):  # S2(i): sweep only for cap-exits in front
        # of the ear line; otherwise face-line walk to lateral (CELL-A style)
        pts = [np.array(p0, dtype=float)]; prev_n = None; end = "?"
        dosweep = bool(sweep and CELL == "B")
        # S2/G3: the sweep must land BEHIND the G3 ear plane (ear_front_y) at rim
        # height: the spec destination (ear_top.y-5mm) sits 1.2mm FORWARD of that
        # plane, so strands ending there violate G3 on their first fall step.
        # dest_y jitters per guide (production) to spread landings behind the
        # plane instead of converging every strand onto one ring (G4 gaps).
        if dest_y is None: dest_y = ear_y
        for _ in range(400):
            q, n, _s = nearest_sym(bvh_body, pts[-1])
            f, L = modeB_dir(pts[-1], n)
            if f[1] < 0: f[1] = 0.0
            # M1: base lateral floor 0.8 only (1.6x face-zone gain and +Y drive removed)
            if abs(pts[-1][0] - cx) < x_face(pts[-1][2]) - 0.005: f = f + 0.8 * L
            if dosweep:  # M5 back-sweep: backward component on the tangent
                Yv = np.array([0.0, 1.0, 0.0]); Yp = Yv - (Yv @ n) * n
                f = f + 0.5 * Yp
            nl = float(np.linalg.norm(f))
            if nl < 1e-9: f = L
            else: f = f / nl
            cand = pts[-1] + 0.003 * f
            q2, n2, _s2 = nearest_sym(bvh_body, cand)
            if prev_n is not None:  # U4 rim: normal turns >60deg
                cosn = float(np.clip((n2 @ prev_n) / (np.linalg.norm(n2) * np.linalg.norm(prev_n) + 1e-12), -1, 1))
                if np.degrees(np.arccos(cosn)) > 60.0:
                    end = "rim-normal"; break
            pts.append(q2 + n2 * 0.004)
            prev_n = n2
            if len(pts) >= 4:  # U4 rim: no forward progress for 3 steps
                if float(np.linalg.norm(pts[-1] - pts[-4])) < 0.0015:
                    end = "rim-stall"; break
            lat = abs(pts[-1][0] - cx) >= x_face(pts[-1][2]) - 0.005
            if dosweep:
                got = (pts[-1][1] >= dest_y) and (pts[-1][2] <= ear_top + 0.015)
                if lat and got: end = "lateral"; break
                if got: end = "sweep"; break
            else:
                if lat: end = "lateral"; break
            if pts[-1][2] < ear_top - 0.02:
                end = ("sweep-zfloor" if dosweep else "zfloor"); break
        else: end = "maxiter"
        # No comb: two comb variants (plain +Y, climbing +Y+Z) were tried in
        # attempts 2-3. Both failed (9-16/158 reached destination; the rest
        # rimmed on the pinna front or stalled, driving CE to 22%, gaps to
        # ~20mm and turn-max past 180). A stalled surf end falls from where it
        # stands; the curtain this leaves is measured honestly in G3.
        return np.array(pts), end
    Z = np.array([0.0, 0.0, -1.0])
    YF = ear_y - 0.025  # face-front plane (G6/U2): hair above menton must not drift fwd
    def no_fwd(v, p):
        # Forward-drift pin for forward-zone strands above the chin (keeps hair
        # out of the face). Below-menton pinning was tried in attempt 3: it did
        # not move the curtain count and coincided with CE exploding to 22%
        # (pinned slides stagnating into stalls). Reverted; the jaw-throat
        # funnel below the chin remains the open mechanism (see RESULT).
        if p[2] > menton and p[1] < YF and v[1] < 0:
            v = v.copy(); v[1] = 0.0
            nv = float(np.linalg.norm(v))
            v = v / nv if nv > 1e-9 else Z.copy()
        return v
    EAR_BOT = ear_top - EAR_BOT_DROP
    def nearest_col_fall(p):
        best = None
        for o in fall_colliders:
            q, n, sd = nearest_sym(bvh_fall[o.name], p)
            if q is None: continue
            d = abs(sd)
            if best is None or d < best[0]: best = (d, o, q, n)
        return best[1], best[2], best[3]
    def fall_ok(p):
        for o in fall_colliders:
            q, n, sd = nearest_sym(bvh_fall[o.name], p)
            if q is None: continue
            if abs(sd) > PROX: continue  # S1 broadphase: far surface, sign untrusted
            if sd < REQ[o.name]: return False
        return True
    def fall_phase(p0, d0, over_ear=False, gi=-1, mem_h=None):  # M4 slope slide on R5+hulls
        TRON = bool(FALLTRACE and gi in TRACESET)
        TR = [] if TRON else None
        if TRON: TR.append({"ev": "entry", "p0": np.round(np.array(p0, dtype=float) * 1000, 3).tolist(), "d0": np.round(np.array(d0, dtype=float), 4).tolist(), "over_ear": bool(over_ear)})
        pts = [np.array(p0, dtype=float)]; d = np.array(d0, dtype=float) / (np.linalg.norm(d0) + 1e-12)
        wname = None  # S1-F1: current slide surface (winner hysteresis, 0.2mm)
        stall = 0  # S1-F2: consecutive sub-mm slide steps
        contact = False  # S1-F3: contact stickiness (no free-drill while grazing)
        # S2: flat-top fallback keeps the ARRIVAL horizontal direction (mem_h),
        # not the vertical entry vector (whose horizontal part is zero and would
        # fork to sign(x), sliding crown hair sideways to the temples).
        _mh = np.array(mem_h if mem_h is not None else d0, dtype=float)
        _mh = np.array([_mh[0], _mh[1], 0.0]); _mhn = float(np.linalg.norm(_mh))
        if _mhn > 1e-9: prev_h = _mh / _mhn
        else:
            ph0 = np.array([d[0], d[1], 0.0]); prev_h = ph0 / (np.linalg.norm(ph0) + 1e-12) if float(np.linalg.norm(ph0)) > 1e-9 else np.array([np.sign(p0[0] - cx) or 1.0, 0.0, 0.0])
        cend = False; zh = [float(pts[-1][2])]
        for _ in range(400):
            dd = 0.65 * d + 0.35 * Z; dd = dd / (np.linalg.norm(dd) + 1e-12)
            dd = no_fwd(dd, pts[-1])
            cand = pts[-1] + 0.005 * dd
            drew_free = fall_ok(cand)
            if contact and drew_free:
                # S1-F3: stay glued until clearly free (>REQ+2mm on every collider)
                for o in fall_colliders:
                    qq, nn, sd0 = nearest_sym(bvh_fall[o.name], cand)
                    if qq is None: continue
                    if abs(sd0) > PROX: continue  # S1 broadphase: far surface
                    if sd0 < REQ[o.name] + 0.002:
                        drew_free = False; break
                if drew_free: contact = False
            if drew_free:
                pts.append(cand); d = dd; zh.append(float(cand[2]))
                if TRON:
                    sds = {}
                    for o in fall_colliders:
                        qq, nn = nearest_pt(bvh_fall[o.name], cand)
                        if qq is None: continue
                        sds[o.name] = round(float(sdist(cand, qq, nn)) * 1000, 3)
                    TR.append({"ev": "free", "p": np.round(pts[-2] * 1000, 3).tolist(), "dd": np.round(dd, 4).tolist(), "sds": sds})
            else:
                contact = True
                wo, q, n = nearest_col_fall(cand)
                if wname is not None:  # S1-F1 hysteresis: keep surface within 0.2mm
                    qq0, nn0, sd00 = nearest_sym(bvh_fall[wname], cand)
                    if qq0 is not None:
                        d0w = abs(sd00)
                        dw = abs(sdist(cand, q, n))
                        if d0w <= dw + 0.0002:
                            wo = next(o for o in fall_colliders if o.name == wname)
                            q, n = qq0, nn0
                if wo is not None: wname = wo.name
                # S1-F4: smooth the slide normal over a 1.5mm disc (kill facet lottery)
                _up = Z if abs(float(n[2])) < 0.9 else np.array([1.0, 0.0, 0.0])
                _u = np.cross(n, _up); _un = float(np.linalg.norm(_u))
                if _un > 1e-9:
                    _u = _u / _un; _v = np.cross(n, _u)
                    _acc = np.array(n, dtype=float); _ws = 1.0
                    for _du, _dv in ((0.0015, 0.0), (-0.0015, 0.0), (0.0, 0.0015), (0.0, -0.0015)):
                        _qp = cand + _u * _du + _v * _dv
                        _qq, _nn, _sd = nearest_sym(bvh_fall[wo.name], _qp)
                        if _qq is None: continue
                        if abs(_sd) > 0.010: continue
                        _w = max(0.0, float(_nn @ n)); _acc = _acc + _nn * _w; _ws += _w
                    _an = float(np.linalg.norm(_acc))
                    if _an > 1e-9: n = _acc / _an
                t = Z - (Z @ n) * n; nt = float(np.linalg.norm(t))
                if TRON:
                    sds = {}
                    for o in fall_colliders:
                        qq, nn = nearest_pt(bvh_fall[o.name], cand)
                        if qq is None: continue
                        sds[o.name] = round(float(sdist(cand, qq, nn)) * 1000, 3)
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
                        qq, nn, sd1 = nearest_sym(bvh_fall[o.name], pnew)
                        if qq is None: continue
                        if abs(sd1) > PROX: continue  # S1 broadphase: far surface
                        if sd1 < REQ[o.name]:
                            pnew = qq + nn * REQ[o.name]; moved = True
                    if not moved: break
                mv = float(np.linalg.norm(pnew - pts[-1]))
                if mv >= 0.001:  # S1-F2: sub-mm slide steps are not emitted
                    pts.append(pnew); d = s; stall = 0
                else:
                    stall += 1
                    if stall >= 6:
                        cend = True
                        if TRON: TR.append({"ev": "stall-end", "p": np.round(pts[-1] * 1000, 3).tolist()})
                        break
                if TRON:
                    TR.append({"ev": "slide", "p": np.round(pts[-1] * 1000, 3).tolist(),
                               "winner": (wo.name if wo is not None else None), "sds": sds, "nt": round(nt, 4),
                               "s": np.round(s, 4).tolist(), "mv_mm": round(mv * 1000, 4), "emitted": bool(mv >= 0.001)})
                zh.append(float(pts[-1][2]))
                if len(zh) >= 7 and (zh[-7] - zh[-1]) < 0.001:
                    cend = True; break
            if pts[-1][2] <= zhem: break
        if TRON:
            TR.append({"ev": "exit", "npts": len(pts), "cend": bool(cend), "zlast": round(float(pts[-1][2]), 4)})
            TRACELOG.setdefault(CURRUN, []).append({"gi": gi, "steps": TR})
        return np.array(pts), cend
    if S1RAW:
        # ---- brief S1: TEST exact-mirror pairs, scalp-only then full, raw ----
        _fr = np.array(fb["roots"])
        _ccx = float(cap["cx"])
        _Rsel = _fr[(_fr[:, 0] - _ccx) > 0.002]
        _Lsel = _Rsel.copy(); _Lsel[:, 0] = -_Lsel[:, 0]
        print("S1RAW pairs=%d (roots x>2mm mirrored about x=0)" % len(_Rsel))

        def _grow_levels(rr):
            pl, bi = trace_root(rr)
            if bi is None or len(pl) < 3: return None
            scalp = []
            for qq in pl:
                hq, hn, _ss = nearest_sym(bvh_body, qq)
                if hq is None: break
                scalp.append(hq + hn * 0.003)
            scalp = np.array(scalp)
            if len(scalp) < 3: return None
            if float(rr[1]) < ear_y:
                surf, _wend = surface_walk(scalp[-1])
                stag = np.vstack([scalp[:-1], surf])
            else:
                stag = scalp
            d0 = stag[-1] - stag[-2]
            fall, ce = fall_phase(stag[-1], d0)
            full = np.vstack([stag[:-1], fall])
            return stag, full, bool(ce)

        _SR = [_grow_levels(rr) for rr in _Rsel]
        _SL = [_grow_levels(ll) for ll in _Lsel]
        _ceR = int(sum(1 for a in _SR if a is not None and a[2]))
        _ceL = int(sum(1 for a in _SL if a is not None and a[2]))
        print("S1RAW contact-ended R=%d L=%d" % (_ceR, _ceL))

        def _cmp(level, thr=0.001):
            ds, dks, keeps = [], [], []
            for i, (a, b) in enumerate(zip(_SR, _SL)):
                if a is None or b is None: continue
                A = a[level]; B = b[level].copy(); B[:, 0] = -B[:, 0]
                m = min(len(A), len(B))
                if m == 0: continue
                d = np.linalg.norm(A[:m] - B[:m], axis=1)
                tail = float(np.linalg.norm(A[-1] - B[-1])) if len(A) != len(B) else 0.0
                md = max(float(d.max()), tail)
                k = next((k for k in range(m) if float(d[k]) > thr), (-1 if len(A) == len(B) else m))
                ds.append(md); dks.append(int(k)); keeps.append(i)
            return np.array(ds), np.array(dks), np.array(keeps)

        _out = {}
        for _lv, _nm in ((0, "scalp"), (1, "full")):
            _ds, _dks, _kp = _cmp(_lv)
            _s = {"pairs": int(len(_ds)),
                  "p50_mm": float(np.percentile(_ds, 50)) * 1000.0 if len(_ds) else float("nan"),
                  "p95_mm": float(np.percentile(_ds, 95)) * 1000.0 if len(_ds) else float("nan"),
                  "max_mm": float(_ds.max()) * 1000.0 if len(_ds) else float("nan")}
            print("S1RAW %s pairs=%d maxd p50=%.4f p95=%.4f max=%.4f mm" % (
                _nm, _s["pairs"], _s["p50_mm"], _s["p95_mm"], _s["max_mm"]))
            _order = np.argsort(_ds, kind="stable")[::-1][:10]
            _s["worst10"] = []
            for _rnk, _jj in enumerate(_order):
                _i = int(_kp[_jj])
                _a = _SR[_i][_lv]; _b = _SL[_i][_lv].copy(); _b[:, 0] = -_b[:, 0]
                _m = min(len(_a), len(_b))
                _dd = np.linalg.norm(_a[:_m] - _b[:_m], axis=1)
                _k = next((k for k in range(_m) if float(_dd[k]) > 0.001), _m)
                print("S1RAW-WORST-%s %d pair=%d maxd=%.3fmm k=%d lenR=%d lenL=%d rootR=%s" % (
                    _nm, _rnk + 1, _i, float(_ds[_jj]) * 1000.0, int(_k),
                    len(_a), len(_SL[_i][_lv]), np.round(_Rsel[_i] * 1000, 2).tolist()))
                _s["worst10"].append({"pair": _i, "maxd_mm": float(_ds[_jj]) * 1000.0,
                                      "k": int(_k), "lenR": int(len(_a)),
                                      "lenL": int(len(_SL[_i][_lv]))})
            _out[_nm] = _s
        _out["ce"] = {"R": _ceR, "L": _ceL}
        (out / "s1-raw.json").write_text(json.dumps(_out, indent=1))
        print("WROTE", out / "s1-raw.json")
        # ---- S1RAW detail trace for worst-full pairs (per-quantity at k-1,k) ----
        _pm = None
        try:
            _Vm = np.array(cap["verts"])
            _pm = np.empty(len(_Vm), dtype=int)
            _Wm = np.stack([-_Vm[:, 0], _Vm[:, 1], _Vm[:, 2]], axis=1)
            for _s0 in range(0, len(_Vm), 4000):
                _qq = _Wm[_s0:_s0 + 4000]
                _dd = ((_qq[:, None, :] - _Vm[None, :, :]) ** 2).sum(2)
                _pm[_s0:_s0 + 4000] = _dd.argmin(1)
        except Exception as _ex:
            print("S1RAW partner map failed: %s" % _ex)

        def _trace_detail(rr):
            steps = []
            p = Vector(tuple(rr)); pl = [np.array(tuple(rr), dtype=float)]
            for _it in range(100):
                _co, _vi, _ = kd.find(p)
                _mp = mir0(np.array(tuple(p), dtype=float))
                _, _vj, _ = kd.find(Vector(tuple(_mp)))
                _fj = np.array(fB[_vj], dtype=float); _fj[0] = -_fj[0]
                _fv = 0.5 * (np.array(fB[_vi], dtype=float) + _fj)
                _nl = float(np.linalg.norm(_fv))
                if _nl < 1e-9:
                    steps.append({"it": _it, "branch": "zero-flow", "vi": int(_vi)}); break
                _pw = np.array(tuple(p), dtype=float) + _fv / _nl * 0.002
                _q, _n, _sd = nearest_sym(bvh_body, _pw)
                if _q is None:
                    steps.append({"it": _it, "branch": "no-hit", "vi": int(_vi)}); break
                _cd = cap_dist_sym(Vector(tuple(_q)))
                _rec = {"it": _it, "p": np.array(tuple(p), dtype=float),
                        "vi": int(_vi), "vi_xyz": np.array(tuple(V[int(_vi)])),
                        "fv": _fv, "p_new": _pw, "q": np.array(_q), "n": np.array(_n),
                        "capdist": _cd,
                        "branch": ("exit" if _cd > 0.0015 else "cont")}
                steps.append(_rec); pl.append(np.array(_q))
                if _cd > 0.0015:
                    break
                p = Vector(tuple(_q))
            return np.array(pl), steps

        _fw = _out["full"]["worst10"][:6]
        for _w in _fw:
            _i = int(_w["pair"])
            for _tag, _rr in (("R", _Rsel[_i]), ("L", _Lsel[_i])):
                _pl, _st = _trace_detail(_rr)
                _k = int(_w["k"])
                for _kk in ([_k - 1, _k] if _k > 0 else [_k]):
                    if 0 <= _kk < len(_st):
                        _s = _st[_kk]
                        _mp = int(_pm[int(_s["vi"])]) if _pm is not None else -1
                        print("S1RAW-DETAIL pair=%d k=%d %s pos=%s vi=%d vi_xyz=%s partner=%d fv=%s capdist=%.4fmm branch=%s" % (
                            _i, _kk, _tag,
                            np.round(_s["p"] * 1000, 3).tolist(), int(_s["vi"]),
                            np.round(_s["vi_xyz"] * 1000, 2).tolist(), _mp,
                            np.round(_s["fv"], 4).tolist(),
                            float(_s["capdist"]) * 1000.0, _s["branch"]))
        # ---- S1RAW debug render: orange 1mm tubes over body+garments ----
        h.hair.hide_render = h.hair.hide_viewport = True
        bpy.context.scene.view_settings.view_transform = "Standard"
        _cu = bpy.data.curves.new("OCLX_s1raw_tubes", "CURVE")
        _cu.dimensions = "3D"; _cu.bevel_depth = 0.001
        _om = bpy.data.materials.new("OCLX_s1raw_orange"); _om.use_nodes = True
        _ont = _om.node_tree; _ont.nodes.clear()
        _oout = _ont.nodes.new("ShaderNodeOutputMaterial")
        _oem = _ont.nodes.new("ShaderNodeEmission")
        _oem.inputs["Color"].default_value = (1.0, 0.45, 0.0, 1.0)
        _oem.inputs["Strength"].default_value = 1.0
        _ont.links.new(_oem.outputs[0], _oout.inputs[0])
        _cu.materials.append(_om)
        for _a, _b in zip(_SR, _SL):
            for _P in ((_a[1] if _a is not None else None), (_b[1] if _b is not None else None)):
                if _P is None or len(_P) < 2: continue
                _sp = _cu.splines.new("POLY"); _sp.points.add(len(_P) - 1)
                for _kk, _pp in enumerate(_P):
                    _sp.points[_kk].co = (float(_pp[0]), float(_pp[1]), float(_pp[2]), 1.0)
                _sp.material_index = 0
        _to = bpy.data.objects.new("OCLX_s1raw_tubes", _cu)
        bpy.context.scene.collection.objects.link(_to)
        _to.update_tag(); bpy.context.view_layer.update()
        _hid = {o.name: (o.hide_render, o.hide_viewport) for o in bpy.data.objects}
        _keep = {body.name, _to.name} | {o.name for o in cols}
        for o in bpy.data.objects:
            if o.name in _keep: o.hide_render = o.hide_viewport = False
            else: o.hide_render = o.hide_viewport = True
        bpy.context.view_layer.update()
        _sc = bpy.context.scene
        _sc.render.resolution_x = _sc.render.resolution_y = 1024
        _sc.cycles.samples = 16; _sc.cycles.seed = 0
        _cam = h.camera
        _tgt = Vector((cx, float(np.median(W[:, 1])), menton + 0.06)); _d1 = 0.85

        def _track(o, t):
            o.rotation_euler = (Vector(t) - o.location).to_track_quat("-Z", "Y").to_euler()

        _v4 = [("front", _tgt + Vector((0, -_d1, 0.02))), ("back", _tgt + Vector((0, _d1, 0.08))),
               ("profileR", _tgt + Vector((_d1, 0, 0.02))), ("profileL", _tgt + Vector((-_d1, 0, 0.02)))]
        from PIL import Image as _I4, ImageDraw as _D4
        _c4 = []
        for _vn, _loc in _v4:
            _cam.location = tuple(_loc); _track(_cam, _tgt)
            _sc.render.filepath = str(out / ("s1raw-tmp-%s.png" % _vn))
            bpy.ops.render.render(write_still=True)
            _c4.append(_I4.open(out / ("s1raw-tmp-%s.png" % _vn)).convert("RGB"))
        _Wd4, _Hd4 = _c4[0].size; _lab4 = 36
        _sh4 = _I4.new("RGB", (_Wd4 * 4, _Hd4 + _lab4), (20, 20, 20)); _dr4 = _D4.Draw(_sh4)
        for _kk, (_vn, _) in enumerate(_v4):
            _sh4.paste(_c4[_kk], (_kk * _Wd4, _lab4)); _dr4.text((_kk * _Wd4 + 10, 10), _vn, fill=(255, 165, 0))
        _sh4.save(out / "stage1-debug.png")
        print("WROTE", out / "stage1-debug.png")
        for o in bpy.data.objects:
            if o.name in _hid: o.hide_render, o.hide_viewport = _hid[o.name]
        import os as _os4
        for _vn, _ in _v4:
            try: _os4.remove(out / ("s1raw-tmp-%s.png" % _vn))
            except Exception: pass
        return
    from collections import Counter
    endhist = Counter()
    m1count = [0]
    def grow_raw(r, gi=-1):
            pl, bi = trace_root(r)
            if bi is None or len(pl) < 3: return None
            scalp = []
            for q in pl:
                hq, hn, _ss = nearest_sym(bvh_body, q)
                if hq is None: break
                scalp.append(hq + hn * 0.004)
            scalp = np.array(scalp)
            if len(scalp) < 3: return None
            d0 = scalp[-1] - scalp[-2]; d0 = d0 / (np.linalg.norm(d0) + 1e-12)
            m1 = False; exit_y = None; swept = False
            front_root = bool(float(r[1]) < ear_y)
            exit_front = bool(float(pl[-1][1]) < ear_front_y)  # S2(i): streamline
            # leaves the cap in front of the ear line -> back-sweep the skull;
            # a front root leaving behind the ear line is already back -> fall
            # directly (no face-line walk: that would drag it to the temple).
            if front_root and exit_front:
                surf, wend = surface_walk(scalp[-1], sweep=True)
                swept = bool(CELL == "B")
                endhist[wend] += 1
                exit_y = float(surf[-1][1])
                # M2: side band keeps guides-6 behaviour (face line, then fall);
                # the M1 hull carries side guides over the ear. m1 = side label.
                if ear_y + M1_BAND_LO <= exit_y <= ear_y + M1_BAND_HI:
                    m1 = True; m1count[0] += 0  # counted after truncate below
                darr = surf[-1] - surf[-2] if len(surf) > 1 else d0
                d1 = np.array([0.0, 0.0, -1.0])  # S2(ii): vertical fall entry
                fall, ce = fall_phase(surf[-1], d1, over_ear=m1, gi=gi, mem_h=darr)
                full = np.vstack([scalp[:-1], surf, fall[1:]])
                ph = np.array([0] * (len(scalp) - 1) + [1] * len(surf) + [2] * (len(fall) - 1))
            elif front_root:
                endhist["direct-behind"] += 1
                exit_y = float(scalp[-1][1])
                d1 = np.array([0.0, 0.0, -1.0])  # S2(ii): vertical fall entry
                fall, ce = fall_phase(scalp[-1], d1, over_ear=False, gi=gi, mem_h=d0)
                full = np.vstack([scalp[:-1], fall])
                ph = np.array([0] * (len(scalp) - 1) + [2] * len(fall))
            else:
                d1 = np.array([0.0, 0.0, -1.0])  # S2(ii): vertical fall entry
                fall, ce = fall_phase(scalp[-1], d1, over_ear=False, gi=gi, mem_h=d0)
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
                # S2(iv): hem pin with per-guide seeded jitter +-6mm
                full[-1][2] = zhem + float(_jit_rng.uniform(-0.006, 0.006))
            return (full, ph, ce, np.array(r), m1, exit_y, swept)
    _jit_rng = np.random.default_rng(11)
    def build_chains(Rroots, _wave2):
        chains_raw = []
        endhist.clear()
        for _gi, r in enumerate(Rroots):
            g1 = grow_raw(r, _gi)
            if g1 is not None: chains_raw.append(g1)
        # wave-2: patch coverage holes left by failed traces (cap 600)
        if _wave2 and len(chains_raw) < 600:
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
        for gi, (full, ph, ce, root, m1, exit_y, swept) in enumerate(chains_raw):
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
                            _, ins = clearance_sym(cand)
                            if not ins:
                                full[j] = cand; moved = True; break
                            step *= 0.5
                        # if never outside, keep original point (no push into collider)
            full, ph = kink_clean(full, ph)
            if len(full) < 4:
                drop_pre += 1; continue
            # S2/G6: pre-resample inside-push (2 passes): mid-guide grazes
            # (shirt-hug pinches, pinna folds) are pushed to surface+REQ BEFORE
            # resampling — post-resample nothing moves (v), so this is the last
            # enforcement point. PROX-guarded so a far flipped sign can never
            # teleport a point (S1 cause). fall_ok stays the trim gate.
            for _ in range(2):
                for j in range(len(full)):
                    w = None
                    for o in fall_colliders:
                        qq, nn = nearest_pt(bvh_fall[o.name], full[j])
                        if qq is None: continue
                        sd = sdist(full[j], qq, nn)
                        if abs(sd) > PROX: continue
                        if sd < REQ[o.name] and (w is None or sd < w[0]):
                            w = (sd, qq, nn, o)
                    if w is not None:
                        full[j] = w[1] + w[2] * REQ[w[3].name]
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
            # S2(v): freeze after resample — nothing moves afterwards (M4 post
            # settle removed; clearance is enforced pre-resample by flare gating
            # plus trailing trim, and counted post-resample in G6).
            chains.append((rs, rph, ce, root, m1, was_trunc, swept))

        return chains, dict(endhist), len(chains_raw), int(trunc_kept), int(drop_pre), int(drop_post), [c[5] for c in chains_raw], chains_raw
    Rmir = R.copy(); Rmir[:, 0] = 2.0 * cx - Rmir[:, 0]
    mirror_runs = {}
    if MIRROR_TEST:
        CURRUN = "a"; chains_a, end_a, raw_a, tk_a, dp_a, dq_a, ex_a, raws_a = build_chains(R, False)
        CURRUN = "b"; chains_b, end_b, raw_b, tk_b, dp_b, dq_b, ex_b, raws_b = build_chains(Rmir, False)
        if FALLTRACE:
            (out / "stage1-falltrace.json").write_text(json.dumps(TRACELOG))
            print("WROTE", out / "stage1-falltrace.json")
            return
        mirror_runs = {"a": (chains_a, end_a, raw_a), "b": (chains_b, end_b, raw_b)}
        chains, end_snap, n_raw = chains_a, end_a, raw_a
        trunc_kept, drop_pre, drop_post = tk_a, dp_a, dq_a
        raw_exits = ex_a
        endhist.clear(); endhist.update(end_snap)
        if DUMPPATHS:
            d = {}
            for tag, raws, roots in (("a", raws_a, R), ("b", raws_b, Rmir)):
                d["roots_" + tag] = np.array(roots, dtype=np.float32)
                d["fulls_" + tag] = np.array([np.array(c[0], dtype=np.float32) for c in raws], dtype=object)
                d["phs_" + tag] = np.array([np.array(c[1], dtype=np.int8) for c in raws], dtype=object)
                d["ce_" + tag] = np.array([bool(c[2]) for c in raws])
            np.savez(out / "stage1-paths.npz", **d)
            print("WROTE", out / "stage1-paths.npz")
            return
    else:
        chains, end_snap, n_raw, trunc_kept, drop_pre, drop_post, raw_exits, _raws = build_chains(R, True)
        endhist.clear(); endhist.update(end_snap)
    n = len(chains)
    G = np.array([c[0] for c in chains]); RPH = np.array([c[1] for c in chains]); CE = np.array([c[2] for c in chains])
    GR = np.array([c[3] for c in chains]); M1F = np.array([c[4] for c in chains])
    TRUNC = np.array([c[5] for c in chains]); SWEPT = np.array([c[6] for c in chains])
    _front = GR[:, 1] < ear_y
    print("S2 swept=%d front-nosweep=%d back=%d" % (
        int(SWEPT.sum()), int((~SWEPT & _front).sum()), int((~_front).sum())))
    n_trunc = int(TRUNC.sum()) + int(drop_pre) + int(drop_post)
    pass  # n_raw set by build_chains driver
    print("GUIDES n=%d raw=%d contact-ended=%d m1side=%d walk-end=%s" % (n, n_raw, int(CE.sum()), int(M1F.sum()), dict(endhist)))
    print("TRUNC kept=%d drop_pre=%d drop_post=%d total=%d (%.1f%%)" % (
        int(TRUNC.sum()), int(drop_pre), int(drop_post), n_trunc, 100.0 * n_trunc / max(n_raw, 1)))
    # P1 probe: surface-exit band counts (pre-truncation exit_y from grow_raw)
    p1_exit = np.array([e for e in raw_exits if e is not None], dtype=float)
    p1_above = int((p1_exit > ear_y).sum()) if len(p1_exit) else 0
    p1_band = int(((p1_exit >= ear_y - 0.025) & (p1_exit <= ear_y + 0.010)).sum()) if len(p1_exit) else 0
    p1_m1 = int(((p1_exit >= ear_y + M1_BAND_LO) & (p1_exit <= ear_y + M1_BAND_HI)).sum()) if len(p1_exit) else 0
    print("P1 exits n=%d y>ear_y=%d band[ear_y-25mm,ear_y+10mm]=%d m1band[ear_y-30mm,ear_y+25mm]=%d" % (
        len(p1_exit), p1_above, p1_band, p1_m1))
    groots = GR.copy()
    n_poisson = int(len(R))
    R = groots
    print("FREEZE n=%d (no post-resample moves)" % n)
    F_HEM = float(FLARE_PROFILE["F_hem"])
    # ---- gates G6 (colliders), G3 (behind shoulder), G5 (face/forehead) ----
    from collections import Counter as _C
    flat = G.reshape(-1, 3)
    print("XW " + " ".join("%.3f:%.1f" % (z, xw(z) * 1000) for z in (1.40, 1.45, 1.50, 1.52, 1.53, 1.55, 1.60)))
    g2min = 1e9; ins = 0; ins_by = _C(); ins_ph = _C()
    for gi in range(n):
        for k, p in enumerate(G[gi]):
            ss = []
            for o in fall_colliders:  # G6: inside R5+hulls, min clearance raw
                q, n_ = nearest_pt(bvh_fall[o.name], p)
                if q is None: continue
                ss.append((sdist(p, q, n_), o.name))
            s0 = min(s for s, _ in ss)
            g2min = min(g2min, abs(s0))
            if s0 < 0:
                ins += 1; ins_by[min(ss)[1]] += 1; ins_ph[int(RPH[gi, k])] += 1
    print("G6 inside=%d min=%.2fmm by=%s phase=%s" % (ins, g2min * 1000, dict(ins_by), dict(ins_ph)))
    # G3-earfront plane: the brief writes "ear_front.y" (dot attribute = the P1
    # mesh landmark, y~-96.9, the sideburn line), not the cap field ear_front_y
    # (-48.9, the ear-front rim plane used for S2(i) sweep gating). A temple
    # strand at y~-70 is legal framing under the mesh plane but a violation
    # under the cap plane; only deep forward falls fail the mesh plane.
    ear_front_mesh_y = float(ears["L"]["ear_front"][1])
    print("ear_front_mesh_y=%.4f" % ear_front_mesh_y)
    # G3-curtain: BEHIND THE SHOULDER from the t-shirt mesh: per-x-bin shoulder
    # top and the SHOULDER-CAP front (min y of shirt verts within 60mm below
    # the top): a guide point below top-10mm and in front of the cap front
    # reads as a front curtain (the full-column front is the chest front
    # itself, which on-chest hair never crosses, so it cannot see the defect).
    _shirt = next(o for o in cols if "toigo_t_shirt" in o.name.lower())
    _SW = np.array([tuple(_shirt.matrix_world @ v.co) for v in _shirt.data.vertices])
    _xbins = np.arange(-0.20, 0.201, 0.010)
    _stop, _sfront = {}, {}
    for _bi in range(len(_xbins) - 1):
        _sel = _SW[(np.abs(_SW[:, 0] - cx - (_xbins[_bi] + 0.005)) <= 0.005)]
        if len(_sel) < 3: continue
        _top = float(_sel[:, 2].max())
        _cap = _sel[_sel[:, 2] > _top - 0.060]
        if len(_cap) < 3: continue
        _stop[_bi] = _top; _sfront[_bi] = float(_cap[:, 1].min())
    print("G3 shirt bins=%d top range=[%.1f,%.1f]mm" % (
        len(_stop), min(_stop.values()) * 1000 if _stop else 0, max(_stop.values()) * 1000 if _stop else 0))
    g3viol = 0; g3tot = 0; g3ex = []
    for gi in range(n):
        for k, p in enumerate(G[gi]):
            _bi = int(np.searchsorted(_xbins, float(p[0]) - cx, side="right")) - 1
            if _bi not in _stop: continue
            g3tot += 1
            if float(p[2]) < _stop[_bi] - 0.010 and float(p[1]) < _sfront[_bi]:
                g3viol += 1
                if len(g3ex) < 5: g3ex.append(np.round(p * 1000, 1).tolist())
    g3frac = 100.0 * g3viol / max(g3tot, 1)
    g3ear = 0; g3earex = []
    for gi in range(n):
        for k, p in enumerate(G[gi]):
            if int(RPH[gi, k]) == 2 and float(p[2]) < ear_top and float(p[1]) < ear_front_mesh_y:
                g3ear += 1
                if len(g3earex) < 5: g3earex.append(np.round(p * 1000, 1).tolist())
    print("G3 front-curtain viol=%d/%d (%.2f%%) ex=%s | fall-in-front-of-ear=%d ex=%s" % (
        g3viol, g3tot, g3frac, g3ex, g3ear, g3earex))
    browz = float(brow_z)
    # G5 face: canthi x from the eye meshes; face-front depth map from head verts
    _eyes = [o for o in bpy.data.objects if o.type == "MESH" and "eye" in o.name.lower()
             and o is not body]
    _canth = 0.030
    if _eyes:
        _ex = []
        for o in _eyes:
            _V = np.array([tuple(o.matrix_world @ v.co) for v in o.data.vertices])
            _ex.append(float(np.abs(_V[:, 0] - cx).max()))
        if _ex: _canth = float(max(_ex))
    print("G5 canthus_x=%.1fmm from %s" % (_canth * 1000, [o.name for o in _eyes]))
    _depth = {}
    for _w in W:
        _key = (round(float(_w[0]) / 0.005), round(float(_w[2]) / 0.005))
        if _key not in _depth or float(_w[1]) < _depth[_key]: _depth[_key] = float(_w[1])
    g5face = 0; g5facex = []
    for gi in range(n):
        for k, p in enumerate(G[gi]):
            if abs(float(p[0]) - cx) <= _canth and menton <= float(p[2]) <= browz:
                _yf = _depth.get((round(float(p[0]) / 0.005), round(float(p[2]) / 0.005)), None)
                if _yf is not None and float(p[1]) < _yf - 0.002:
                    g5face += 1
                    if len(g5facex) < 5: g5facex.append(np.round(p * 1000, 1).tolist())
    # G5 forehead: nearest head point below the cap front boundary, above brow_z,
    # guide point outside and forward of it
    g5fore = 0; g5forex = []
    for gi in range(n):
        for k, p in enumerate(G[gi]):
            q, nn = nearest_pt(bvh_body, p)
            if q is None: continue
            if browz < float(q[2]) < hairline_z and sdist(p, q, nn) > 0 and float(p[1]) < float(q[1]) - 0.001:
                g5fore += 1
                if len(g5forex) < 5: g5forex.append(np.round(p * 1000, 1).tolist())
    print("G5 face viol=%d ex=%s | forehead viol=%d ex=%s" % (g5face, g5facex, g5fore, g5forex))
    rates = np.concatenate([turn_rates(g)[0] for g in G]) if n else np.array([0])
    g7p95, g7max = float(np.percentile(rates, 95)), float(rates.max())
    seglens = np.linalg.norm(np.diff(G, axis=1), axis=2)
    g2short = int((seglens < 0.0025).sum())
    g2zero = int((seglens == 0.0).sum())
    g2short_frac = float(g2short) / max(seglens.size, 1)
    nan_ct = int(np.isnan(G).sum())
    pts_ok = bool(all(len(g) == 32 for g in G))
    trunc_pct = 100.0 * n_trunc / max(n_raw, 1)
    ce_frac = 100.0 * int(CE.sum()) / max(n, 1)
    n_roots = int(n_poisson)
    print("G2 n=%d roots=%d pts32=%s nan=%d ce=%.1f%% short=%.3f%% zero=%d" % (
        n, n_roots, pts_ok, nan_ct, ce_frac, g2short_frac * 100.0, g2zero))
    print("G7 turn p95=%.2f max=%.2f deg/cm" % (g7p95, g7max))
    # G4: ear-row neighbour gap per side (azimuth order, 3D gaps, no wrap)
    EAR_ROW_Z = ear_top - 0.015
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
        dd = np.linalg.norm(np.diff(sel, axis=0), axis=1)  # G4: no wrap chord
        g5side[nm] = {"n": int(len(sel)), "maxgap_mm": float(dd.max() * 1000.0) if len(dd) else 0.0}
    _gg = [g5side["L"]["maxgap_mm"], g5side["R"]["maxgap_mm"]]
    _gbal = (min(_gg) / max(_gg)) if max(_gg) > 0 else 0.0
    print("G4 ear-row L n=%d gap=%.1fmm | R n=%d gap=%.1fmm balance=%.2f" % (
        g5side["L"]["n"], g5side["L"]["maxgap_mm"], g5side["R"]["n"], g5side["R"]["maxgap_mm"], _gbal))
    # ---- O2 groups (front curtain cyan / side-over-ear yellow / back magenta) ----
    GRP = np.where(M1F, 1, np.where((RPH == 1).any(axis=1), 0, 2))
    print("GRP front=%d side=%d back=%d" % (int((GRP == 0).sum()), int((GRP == 1).sum()), int((GRP == 2).sum())))
    np.savez(out / (STEM + ".npz"), points=G, roots=R, phases=RPH, group=GRP,
             contact_ended=CE, z_hem=zhem, menton_z=menton, crown_z=crown)
    # ---- O2 tubes: 3 groups (front curtain cyan / side-over-ear yellow / back magenta) ----
    h.hair.hide_render = h.hair.hide_viewport = True
    bpy.context.scene.view_settings.view_transform = "Standard"
    cu = bpy.data.curves.new("OCLX_guide_tubes10", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.001
    grp_cols = [(0.0, 1.0, 1.0, 1.0), (1.0, 0.85, 0.0, 1.0), (1.0, 0.0, 1.0, 1.0)]
    grp_mats = []
    for gi_col, cc4 in enumerate(grp_cols):
        om = bpy.data.materials.new("OCLX_guide_debug10_%d" % gi_col); om.use_nodes = True
        nt = om.node_tree; nt.nodes.clear()
        mout = nt.nodes.new("ShaderNodeOutputMaterial")
        em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = cc4; em.inputs["Strength"].default_value = 0.6
        nt.links.new(em.outputs[0], mout.inputs[0])
        cu.materials.append(om); grp_mats.append(om)
    for gi, g in enumerate(G):
        sp = cu.splines.new("POLY"); sp.points.add(31)
        for k, p in enumerate(g): sp.points[k].co = (float(p[0]), float(p[1]), float(p[2]), 1.0)
        sp.material_index = int(GRP[gi])
    to = bpy.data.objects.new("OCLX_guide_tubes10", cu); bpy.context.scene.collection.objects.link(to)
    to.update_tag(); bpy.context.view_layer.update()
    # (no hull wire overlay in v11 beauty: it drew spikes around the ear)
    sc = bpy.context.scene; sc.render.resolution_x = sc.render.resolution_y = 1024
    sc.cycles.samples = (16 if MIRROR_TEST else 32); sc.cycles.seed = 0
    cam = h.camera; tgt = Vector((cx, float(np.median(W[:, 1])), menton + 0.06)); dist = 0.85
    def track(o, t): o.rotation_euler = (Vector(t) - o.location).to_track_quat("-Z", "Y").to_euler()
    views = [("front", tgt + Vector((0, -dist, 0.02))), ("three_quarter", tgt + Vector((dist * 0.68, -dist * 0.68, 0.14))),
             ("profileL", tgt + Vector((-dist, 0, 0.02))), ("profileR", tgt + Vector((dist, 0, 0.02))),
             ("back", tgt + Vector((0, dist, 0.08))), ("top", tgt + Vector((0, -0.10, dist)))]
    if not MIRROR_TEST:
        for name, loc in views:
            cam.location = tuple(loc); track(cam, tgt)
            sc.render.filepath = str(out / ((STEM + "_%s.png") % name)); bpy.ops.render.render(write_still=True)
    for ho in HULLS:  # re-hide hulls before masks/measurements
        try: ho.modifiers.remove(ho.modifiers["OCLX_wire10"])
        except Exception: pass
        ho.hide_render = True
    bpy.context.view_layer.update()
    from PIL import Image, ImageDraw
    if not MIRROR_TEST:
        cells = [Image.open(out / ((STEM + "_%s.png") % v)).convert("RGB") for v, _ in views]
        Wd, Hd = cells[0].size; lab = 36
        sheet = Image.new("RGB", (Wd * 6, Hd + lab), (20, 20, 20)); dr = ImageDraw.Draw(sheet)
        for k, (v, _) in enumerate(views):
            sheet.paste(cells[k], (k * Wd, lab)); dr.text((k * Wd + 10, 10), v, fill=(255, 165, 0))
        sheet.save(out / (STEM + "-debug.png"))
        print("WROTE", out / (STEM + "-debug.png"))
    if MIRROR_TEST:
        Ga = np.array([c[0] for c in chains_a]); CEa = np.array([c[2] for c in chains_a]); GRa = np.array([c[3] for c in chains_a]); RPHa = np.array([c[1] for c in chains_a])
        Gb = np.array([c[0] for c in chains_b]); CEb = np.array([c[2] for c in chains_b]); GRb = np.array([c[3] for c in chains_b])
        Gm = Gb.copy(); Gm[..., 0] = 2.0 * cx - Gm[..., 0]
        md = np.linalg.norm(Ga - Gm, axis=2).max(axis=1)
        divk = np.array([next((k for k in range(32) if float(np.linalg.norm(Ga[i, k] - Gm[i, k])) > 0.002), -1) for i in range(len(Ga))])
        print("MIRROR n_a=%d n_b=%d raw_a=%d raw_b=%d" % (len(Ga), len(Gb), raw_a, raw_b))
        print("MIRROR maxdist p50=%.2fmm p95=%.2fmm max=%.2fmm" % (float(np.percentile(md, 50)) * 1000, float(np.percentile(md, 95)) * 1000, float(md.max()) * 1000))
        ERZ = ear_top - 0.015
        def ear_gap(Ge):
            zzr = Ge[:, :, 2]
            pts = []
            for gi, g in enumerate(Ge):
                zz = g[:, 2]
                if float(zz.min()) > ERZ or float(zz.max()) < ERZ: continue
                k = next((k for k in range(1, len(g)) if (zz[k - 1] - ERZ) * (zz[k] - ERZ) <= 0.0), None)
                if k is None: continue
                f = 0.0 if abs(zz[k] - zz[k - 1]) < 1e-12 else (ERZ - zz[k - 1]) / (zz[k] - zz[k - 1])
                pts.append(g[k - 1] * (1 - f) + g[k] * f)
            pts = np.array(pts) if len(pts) else np.zeros((0, 3))
            o = {}
            for sgn, nm in ((-1.0, "L"), (1.0, "R")):
                sel = pts[(pts[:, 0] - cx) * sgn > 0] if len(pts) else np.zeros((0, 3))
                if len(sel) < 2: o[nm] = {"n": int(len(sel)), "maxgap_mm": 999.0}; continue
                az = np.arctan2(sel[:, 1] - medy, sel[:, 0] - cx)
                sel = sel[np.argsort(az, kind="stable")]
                o[nm] = {"n": int(len(sel)), "maxgap_mm": float(np.linalg.norm(np.diff(sel, axis=0), axis=1).max() * 1000.0)}
            return o
        side_a = np.where(GRa[:, 0] - cx >= 0.0, "R", "L")
        for nm in ("L", "R"):
            idx = np.where(side_a == nm)[0]
            print("MIRROR-A side %s n=%d ce=%d" % (nm, len(idx), int(CEa[idx].sum()) if len(idx) else 0))
        gapa = ear_gap(Ga); gapb = ear_gap(Gb)
        print("MIRROR-A gaps L n=%d gap=%.1fmm | R n=%d gap=%.1fmm" % (gapa["L"]["n"], gapa["L"]["maxgap_mm"], gapa["R"]["n"], gapa["R"]["maxgap_mm"]))
        print("MIRROR-B gaps L n=%d gap=%.1fmm | R n=%d gap=%.1fmm" % (gapb["L"]["n"], gapb["L"]["maxgap_mm"], gapb["R"]["n"], gapb["R"]["maxgap_mm"]))
        w10 = np.argsort(md, kind="stable")[::-1][:10]
        for rnk, i in enumerate(w10):
            k = int(divk[i])
            ph = int(RPHa[i, k]) if k >= 0 else -1
            pt = np.round(Ga[i, k] * 1000, 1).tolist() if k >= 0 else None
            print("MIRROR-WORST %d gi=%d side=%s maxd=%.1fmm diverge_k=%d phase=%d xyz=%s" % (rnk + 1, int(i), str(side_a[i]), float(md[i]) * 1000, k, ph, pt))
        s1 = {"n_a": int(len(Ga)), "n_b": int(len(Gb)),
              "per_side": {nm: {"n": int((side_a == nm).sum()), "ce": int(CEa[side_a == nm].sum())} for nm in ("L", "R")},
              "ear_gap_a": gapa, "ear_gap_b": gapb,
              "mirror": {"p50_mm": float(np.percentile(md, 50)) * 1000, "p95_mm": float(np.percentile(md, 95)) * 1000, "max_mm": float(md.max()) * 1000},
              "worst10": [{"gi": int(i), "side": str(side_a[i]), "maxd_mm": float(md[i]) * 1000, "diverge_k": int(divk[i]),
                            "phase": int(RPHa[i, int(divk[i])]) if int(divk[i]) >= 0 else -1} for i in w10]}
        s1p = out / "mirror-test.json"
        s1p.write_text(json.dumps({"mirror_resampled": s1}, indent=1))
        print("WROTE", s1p)
        om = bpy.data.materials.new("OCLX_stage1_orange"); om.use_nodes = True
        ont = om.node_tree; ont.nodes.clear()
        oout = ont.nodes.new("ShaderNodeOutputMaterial")
        oem = ont.nodes.new("ShaderNodeEmission"); oem.inputs["Color"].default_value = (1.0, 0.45, 0.0, 1.0); oem.inputs["Strength"].default_value = 1.0
        ont.links.new(oem.outputs[0], oout.inputs[0])
        cu.materials.clear(); cu.materials.append(om)
        for sp in cu.splines: sp.material_index = 0
        hid2 = {o.name: (o.hide_render, o.hide_viewport) for o in bpy.data.objects}
        keep = {body.name, to.name} | {o.name for o in cols}
        for o in bpy.data.objects:
            if o.name in keep: o.hide_render = o.hide_viewport = False
            else: o.hide_render = o.hide_viewport = True
        bpy.context.view_layer.update()
        d1 = 0.85
        v4 = [("front", tgt + Vector((0, -d1, 0.02))), ("back", tgt + Vector((0, d1, 0.08))),
              ("profileR", tgt + Vector((d1, 0, 0.02))), ("profileL", tgt + Vector((-d1, 0, 0.02)))]
        from PIL import Image as _I4, ImageDraw as _D4
        c4 = []
        for vn, loc in v4:
            cam.location = tuple(loc); track(cam, tgt)
            sc.render.filepath = str(out / ("stage1-tmp-%s.png" % vn)); bpy.ops.render.render(write_still=True)
            c4.append(_I4.open(out / ("stage1-tmp-%s.png" % vn)).convert("RGB"))
        Wd4, Hd4 = c4[0].size; lab4 = 36
        sh4 = _I4.new("RGB", (Wd4 * 4, Hd4 + lab4), (20, 20, 20)); dr4 = _D4.Draw(sh4)
        for kk, (vn, _) in enumerate(v4):
            sh4.paste(c4[kk], (kk * Wd4, lab4)); dr4.text((kk * Wd4 + 10, 10), vn, fill=(255, 165, 0))
        sh4.save(out / "stage1-debug.png")
        print("WROTE", out / "stage1-debug.png")
        for o in bpy.data.objects:
            if o.name in hid2: o.hide_render, o.hide_viewport = hid2[o.name]
        cu.materials.clear()
        for mm in grp_mats: cu.materials.append(mm)
        for sp in cu.splines: pass
        import os as _os4
        for vn, _ in v4:
            try: _os4.remove(out / ("stage1-tmp-%s.png" % vn))
            except Exception: pass
    # ---- masks: guides-only white tubes, body VISIBLE as black occluder ----
    import bpy_extras.object_utils as OU
    hid = {o.name: (o.hide_render, o.hide_viewport) for o in bpy.data.objects}
    bodymats = list(body.data.materials)
    def render_mask(view_loc, path):
        for o in bpy.data.objects:
            if o is to or o is body: o.hide_render = o.hide_viewport = False
            else: o.hide_render = o.hide_viewport = True
        wm = bpy.data.materials.new("OCLX_mask10_white"); wm.use_nodes = True
        wnt = wm.node_tree; wnt.nodes.clear()
        wout = wnt.nodes.new("ShaderNodeOutputMaterial")
        wem = wnt.nodes.new("ShaderNodeEmission"); wem.inputs["Color"].default_value = (1, 1, 1, 1); wem.inputs["Strength"].default_value = 1.0
        wnt.links.new(wem.outputs[0], wout.inputs[0])
        cu.materials.clear(); cu.materials.append(wm)
        bm = bpy.data.materials.new("OCLX_mask10_black"); bm.use_nodes = True
        bnt = bm.node_tree; bnt.nodes.clear()
        bout = bnt.nodes.new("ShaderNodeOutputMaterial")
        bem = bnt.nodes.new("ShaderNodeEmission"); bem.inputs["Color"].default_value = (0, 0, 0, 1); bem.inputs["Strength"].default_value = 0.0
        bnt.links.new(bem.outputs[0], bout.inputs[0])
        body.data.materials.clear(); body.data.materials.append(bm)
        old_world = sc.world
        bw = bpy.data.worlds.new("OCLX_black10_world"); bw.use_nodes = True
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
        profL_loc = tgt + Vector((-dist, 0, 0.02))
        profR_loc = tgt + Vector((dist, 0, 0.02))
        back_loc = tgt + Vector((0, dist, 0.08))
        sc.cycles.samples = 16
        render_mask(front_loc, out / (STEM + "-front-mask.png"))
        render_mask(profL_loc, out / (STEM + "-profileL-mask.png"))
        render_mask(profR_loc, out / (STEM + "-profileR-mask.png"))
        render_mask(back_loc, out / (STEM + "-back-mask.png"))
        # G4 proxy: 3mm tubes per side for pinna-bbox coverage
        cu.bevel_depth = 0.003
        bpy.context.view_layer.update()
        render_mask(profL_loc, out / (STEM + "-proxyL-mask.png"))
        render_mask(profR_loc, out / (STEM + "-proxyR-mask.png"))
        cu.bevel_depth = 0.001
        bpy.context.view_layer.update()
        sc.cycles.samples = 32
    finally:
        for on, (hr, hv) in hid.items():
            o = bpy.data.objects.get(on)
            if o: o.hide_render, o.hide_viewport = hr, hv
    # ---- image measurements: G4 ear cover per side, G8 back hem ----
    mimg = np.asarray(Image.open(out / (STEM + "-front-mask.png")).convert("L"))
    Hr, Wr = mimg.shape
    cam.location = tuple(tgt + Vector((0, -dist, 0.02))); track(cam, tgt)
    bpy.context.view_layer.update()

    def proj_row_col(img, p):
        Hh, Ww = img.shape
        v = OU.world_to_camera_view(sc, cam, Vector(tuple(p)))
        return int((1 - v.y) * Hh), int(v.x * Ww)
    rcrown, cc = proj_row_col(mimg, (cx, medy, crown))
    rment, _ = proj_row_col(mimg, (cx, medy, menton))
    Hpx = float(abs(rcrown - rment)); mmpx = 210.7 / Hpx if Hpx > 0 else float("nan")
    print("G-rows crown=%d menton=%d Hpx=%.1f" % (rcrown, rment, Hpx))
    # G4: per-side pinna-bbox hair fraction on 3mm proxy profile masks
    g4cov = {}
    for sgn, nm, mf in ((-1.0, "L", "proxyL"), (1.0, "R", "proxyR")):
        pmimg = np.asarray(Image.open(out / (STEM + "-%s-mask.png" % mf)).convert("L"))
        PHr, PWr = pmimg.shape
        cam.location = tuple(tgt + Vector((sgn * dist, 0, 0.02))); track(cam, tgt)
        bpy.context.view_layer.update()
        pin = W[(np.abs(W[:, 1] - ear_y) <= 0.012) & (W[:, 2] >= ear_top - 0.032)
                & (W[:, 2] <= ear_top + 0.002) & ((W[:, 0] - cx) * sgn > 0.040)]
        if len(pin) == 0:
            pin = W[(np.abs(W[:, 1] - ear_y) <= 0.015) & (W[:, 2] >= ear_top - 0.035)
                    & (W[:, 2] <= ear_top + 0.005) & ((W[:, 0] - cx) * sgn > 0.030)]
        if len(pin) == 0:
            g4cov[nm] = {"n": 0, "frac": 0.0}; continue
        pr = []; pc = []
        for p in pin:
            v = OU.world_to_camera_view(sc, cam, Vector(tuple(p)))
            pr.append(int((1 - v.y) * PHr)); pc.append(int(v.x * PWr))
        rmin, rmax = max(min(pr), 0), min(max(pr), PHr - 1)
        cmin, cmax = max(min(pc), 0), min(max(pc), PWr - 1)
        area = max((rmax - rmin + 1) * (cmax - cmin + 1), 1)
        fr = float((pmimg[rmin:rmax + 1, cmin:cmax + 1] > 128).sum() / area)
        g4cov[nm] = {"n": int(len(pin)), "frac": fr,
                     "bbox": [int(rmin), int(rmax), int(cmin), int(cmax)]}
        print("G4 %s pinna n=%d bbox rows %d-%d cols %d-%d cover=%.3f" % (
            nm, len(pin), rmin, rmax, cmin, cmax, fr))
    # G8: hem on the guides-only BACK mask: lowest row with a run >= 2% width,
    # in head-heights below the chin, within +-0.06 of 0.73. Scan restricted to
    # the central 60% of columns: rectilinear edge-stretch throws wide side
    # falls far below their true z, which is not the sheet hem (full-width
    # lowest run reported alongside for audit).
    bimg = np.asarray(Image.open(out / (STEM + "-back-mask.png")).convert("L"))
    BHr, BWr = bimg.shape
    cam.location = tuple(tgt + Vector((0, dist, 0.08))); track(cam, tgt)
    bpy.context.view_layer.update()

    def proj_back(p):
        v = OU.world_to_camera_view(sc, cam, Vector(tuple(p)))
        return int((1 - v.y) * BHr), int(v.x * BWr)
    _rcrownB, _ccB = proj_back((cx, medy, crown))
    _rmentB, _ = proj_back((cx, medy, menton))
    _HpxB = float(abs(_rcrownB - _rmentB))
    _need = int(0.02 * BWr)
    _c0, _c1 = int(0.20 * BWr), int(0.80 * BWr)
    _hem_r = -1
    for _r in range(BHr - 1, -1, -1):
        _row = (bimg[_r, _c0:_c1] > 128).astype(np.int32)
        _d = np.diff(np.concatenate([[0], _row, [0]]))
        _starts = np.where(_d == 1)[0]; _ends = np.where(_d == -1)[0]
        if len(_starts) and int((_ends - _starts).max()) >= _need:
            _hem_r = int(_r); break
    _hem_full = -1
    for _r in range(BHr - 1, -1, -1):
        _row = (bimg[_r] > 128).astype(np.int32)
        _d = np.diff(np.concatenate([[0], _row, [0]]))
        _starts = np.where(_d == 1)[0]; _ends = np.where(_d == -1)[0]
        if len(_starts) and int((_ends - _starts).max()) >= _need:
            _hem_full = int(_r); break
    g8hh = float((_hem_r - _rmentB) / _HpxB) if (_hem_r >= 0 and _HpxB > 0) else float("nan")
    print("G8 back hem row=%d (full-width %d) chin row=%d Hpx=%.1f hem=%.3f head-heights (need %.0fpx run)" % (
        _hem_r, _hem_full, _rmentB, _HpxB, g8hh, _need))
    # G8 diagnostic: project every guide tip through the back camera — separates
    # projection nonlinearity (all tips low) from stragglers (few tips low).
    _tiprows = []
    for _g in G:
        _v = OU.world_to_camera_view(sc, cam, Vector(tuple(_g[-1])))
        _tiprows.append(int((1 - _v.y) * BHr))
    _tiprows = np.array(_tiprows)
    _tipz = G[:, -1, 2]
    print("G8 tips rows p50=%d p95=%d max=%d | tip-z p50=%.1f p05=%.1f min=%.1f mm" % (
        int(np.percentile(_tiprows, 50)), int(np.percentile(_tiprows, 95)), int(_tiprows.max()),
        float(np.percentile(_tipz, 50)) * 1000, float(np.percentile(_tipz, 5)) * 1000,
        float(_tipz.min()) * 1000))
    ce_frac = 100.0 * int(CE.sum()) / max(n, 1)
    gates = [
        ("G2", "n=%d roots=%d pts=%d nan=%d ce=%.1f%% short=%.3f%% zero=%d" % (
            n, n_roots, 32 if pts_ok else 0, nan_ct, ce_frac, g2short_frac * 100.0, g2zero),
         "guides within +-10%% of %d roots and 32 pts and 0 NaN and ce<=8%% and short<=1%% and 0 zero-length" % n_roots,
         (0.9 * n_roots <= n <= 1.1 * n_roots) and pts_ok and nan_ct == 0 and ce_frac <= 8.0
         and g2short_frac <= 0.01 and g2zero == 0),
        ("G3", "curtain=%.2f%% earfront=%d" % (g3frac, g3ear),
         "front-curtain pts<=2%% and 0 fall-phase pts in front of ear_front.y below ear-top rim",
         g3frac <= 2.0 and g3ear == 0),
        ("G4", "coverL=%.3f coverR=%.3f gapL=%.1f gapR=%.1f" % (
            g4cov["L"]["frac"], g4cov["R"]["frac"],
            g5side["L"]["maxgap_mm"], g5side["R"]["maxgap_mm"]),
         "pinna cover>=0.90 both sides and ear-row gap<=12mm both and gaps within 20%%",
         g4cov["L"]["frac"] >= 0.90 and g4cov["R"]["frac"] >= 0.90
         and g5side["L"]["maxgap_mm"] <= 12.0 and g5side["R"]["maxgap_mm"] <= 12.0
         and _gbal >= 0.80),
        ("G5", "face=%d forehead=%d" % (g5face, g5fore),
         "0 face pts and 0 forehead pts", g5face == 0 and g5fore == 0),
        ("G6", "inside=%d min=%.2fmm" % (ins, g2min * 1000), "0 inside and min>=1.0mm",
         ins == 0 and g2min >= 0.0010),
        ("G7", "p95=%.2f max=%.2f" % (g7p95, g7max),
         "turn p95<=10 and max<=45 deg/cm", g7p95 <= 10 and g7max <= 45),
        ("G8", "hem=%.3f" % g8hh, "back-mask hem within +-0.06 of 0.73 head-heights",
         abs(g8hh - 0.73) <= 0.06),
    ]
    for g, m, b, ok in gates: print("%s %s | %s %s" % (g, m, b, "PASS" if ok else "MISS"))
    earj = {nm: {kk: (vv.tolist() if isinstance(vv, np.ndarray) else vv)
                 for kk, vv in e.items()} for nm, e in ears.items()}
    stats = {"cell": CELL, "stem": STEM, "brief": "hair-guides-11/S2",
             "gates": [{"gate": g, "measured": m, "bar": b, "verdict": "PASS" if ok else "MISS"} for g, m, b, ok in gates],
             "z_hem": zhem, "menton_z": menton, "crown_z": crown, "brow_z": browz, "nasion_z": nasion_z,
             "hairline_z": hairline_z, "ear_y": ear_y, "ear_top": ear_top, "ear_front_y": ear_front_y,
             "ear_row_z": EAR_ROW_Z, "yneck": yneck, "count": n, "n_roots": n_roots,
             "contact_ended": int(CE.sum()),
             "contact_ended_frac": float(ce_frac), "m1_side": int(M1F.sum()), "trunc_kept": int(TRUNC.sum()),
             "swept": int(SWEPT.sum()),
             "drop_pre": int(drop_pre), "drop_post": int(drop_post), "n_raw": int(n_raw), "n_trunc": int(n_trunc),
             "ears": earj,
             "hulls": [{"name": ho.name, "faces": len(ho.data.polygons), "verts": len(ho.data.vertices)} for ho in HULLS],
             "x_face_jaw_mm": 48.0, "x_face_menton_mm": 34.0, "x_face_jaw_z": _jaw_z,
             "grp": {"front": int((GRP == 0).sum()), "side": int((GRP == 1).sum()), "back": int((GRP == 2).sum())},
             "mask_rows": {"crown": int(rcrown), "menton": int(rment),
                           "Hpx": float(Hpx), "mmpx": float(mmpx)},
             "g2": {"short": int(g2short), "short_frac": float(g2short_frac), "zero": int(g2zero),
                    "nan": int(nan_ct), "pts32": bool(pts_ok)},
             "g3": {"viol": int(g3viol), "tot": int(g3tot), "frac_pct": float(g3frac),
                    "ex": g3ex, "earfront": int(g3ear), "earfront_ex": g3earex},
             "g4": {"cover": {k: float(v["frac"]) for k, v in g4cov.items()}, "ear_row": g5side,
                    "gap_balance": float(_gbal)},
             "g5": {"face": int(g5face), "face_ex": g5facex, "forehead": int(g5fore),
                    "forehead_ex": g5forex, "canthus_x": float(_canth)},
             "g6": {"inside": int(ins), "min_mm": float(g2min * 1000),
                    "by": {k: int(v) for k, v in ins_by.items()},
                    "phase": {str(k): int(v) for k, v in ins_ph.items()}},
             "g7": {"p95": float(g7p95), "max": float(g7max)},
             "g8": {"hem_hh": float(g8hh), "hem_row": int(_hem_r), "chin_row": int(_rmentB),
                    "hem_row_fullwidth": int(_hem_full)},
             "walk_end": {k: int(v) for k, v in endhist.items()}}
    (out / "row-guides11.json").write_text(json.dumps(stats, indent=1))
    print("WROTE", out / "row-guides11.json")
main()
