"""hair-guides-14 (copy of guides13 + M1 side clearance only in the ear band for side strands, M2 front-edge slide along the hairline, M3 front-liftoff report, M4 back/share depth split, M5 junction/hull unchanged): cap v7 + flow-b v7 inputs."""
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

def _run_heightfields(out, h, body):
    """guides12 S1: BACK Yb(x,z) + SIDE Xs(y,z) heightfields from R5 colliders."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    bad = ("eye", "mouth", "teeth", "tooth", "tongue", "lash", "brow", "nail", "hair", "mask", "helper", "glasses", "hat", "cap_")
    cols = [o for o in bpy.data.objects if o.type == "MESH" and o.visible_get()
            and o is not body and not any(b in o.name.lower() for b in bad)]
    keep_subs = ("aisha_head", "toigo_t_shirt", "tight_jeans", "toigo_mj_cloth_shoes")
    cols = [o for o in cols if any(s in o.name.lower() for s in keep_subs)]
    print("HF colliders: body=%s + %s" % (body.name, [o.name for o in cols]))
    assert len(cols) == 3, "R5 needs head + 3 garments, got %s" % [o.name for o in cols]
    colliders = [body] + cols
    deps = bpy.context.evaluated_depsgraph_get()
    body.update_tag(); bpy.context.view_layer.update()
    W = wpts(body)
    crown = float(W[:, 2].max())
    F = HERE.parent / "hair-cap7"
    cap = np.load(F / "cap-v7.npz")
    menton_z = float(cap["menton_z"]); brow_z = float(cap["brow_z"]); nasion_z = float(cap["nasion_z"])
    zhem = float(menton_z) - 0.73 * 0.2107
    bvhs = {o.name: BVHTree.FromObject(o, deps, deform=True, cage=False) for o in colliders}
    bvh_head = BVHTree.FromObject(body, deps, deform=True, cage=False)
    # BACK Yb(x,z): ray from y=+1 toward -Y, largest y over R5
    xg = np.arange(-0.30, 0.3001, 0.004)
    zg = np.arange(zhem - 0.05, crown + 0.0001, 0.004)
    Yb = np.full((len(zg), len(xg)), -np.inf)
    for ji, z in enumerate(zg):
        for ii, x in enumerate(xg):
            best = -np.inf
            for o in colliders:
                hit, _, _, _ = bvhs[o.name].ray_cast(Vector((float(x), 1.0, float(z))), Vector((0.0, -1.0, 0.0)), 3.0)
                if hit is not None and float(hit.y) > best:
                    best = float(hit.y)
            Yb[ji, ii] = best
        if ji % 20 == 0:
            print("HF Yb row %d/%d z=%.3f fin=%d" % (ji, len(zg), float(z), int(np.isfinite(Yb[ji]).sum())))
    # mirror-symmetrise by averaging with mirror (finite handling)
    Ys = Yb.copy()
    n = len(xg)
    for ii in range(n):
        jj = n - 1 - ii
        if jj < ii:
            break
        a = Yb[:, ii]; b = Yb[:, jj]
        fa = np.isfinite(a); fb = np.isfinite(b)
        both = fa & fb; one_a = fa & ~fb; one_b = fb & ~fa
        m = np.full(len(zg), -np.inf)
        m[both] = 0.5 * (a[both] + b[both])
        m[one_a] = a[one_a]; m[one_b] = b[one_b]
        Ys[:, ii] = m; Ys[:, jj] = m
    Fa = np.isfinite(Ys); Fm = Fa & Fa[:, ::-1]
    maxasym = float(np.abs(Ys[Fm] - Ys[:, ::-1][Fm]).max()) if Fm.any() else 0.0
    print("HF Yb shape=%s finite=%d/%d maxasym=%.6fmm" % (tuple(Ys.shape), int(np.isfinite(Ys).sum()), Ys.size, maxasym * 1000.0))
    # SIDE Xs(y,z): largest |x| of HEAD at (y,z), rays from both sides
    yg = np.arange(-0.20, 0.2001, 0.004)
    zgs = np.arange(menton_z - 0.02, crown + 0.0001, 0.004)
    Xs = np.full((len(zgs), len(yg)), -np.inf)
    for ji, z in enumerate(zgs):
        for ii, y in enumerate(yg):
            hr, _, _, _ = bvh_head.ray_cast(Vector((1.0, float(y), float(z))), Vector((-1.0, 0.0, 0.0)), 3.0)
            hl, _, _, _ = bvh_head.ray_cast(Vector((-1.0, float(y), float(z))), Vector((1.0, 0.0, 0.0)), 3.0)
            best = -np.inf
            if hr is not None:
                best = max(best, abs(float(hr.x)))
            if hl is not None:
                best = max(best, abs(float(hl.x)))
            Xs[ji, ii] = best
        if ji % 20 == 0:
            print("HF Xs row %d/%d z=%.3f fin=%d" % (ji, len(zgs), float(z), int(np.isfinite(Xs[ji]).sum())))
    np.savez(out / "heightfields.npz", Yb=Ys.astype(np.float64), x_Yb=xg.astype(np.float64),
             z_Yb=zg.astype(np.float64), Xs=Xs.astype(np.float64), y_Xs=yg.astype(np.float64),
             z_Xs=zgs.astype(np.float64), menton_z=np.array(menton_z), crown_z=np.array(crown),
             brow_z=np.array(brow_z), nasion_z=np.array(nasion_z), z_hem=np.array(zhem))
    print("WROTE", out / "heightfields.npz")
    from PIL import Image, ImageDraw
    def field_img(F2, title):
        A = np.array(F2, dtype=float)
        fin = np.isfinite(A)
        img = Image.new("RGB", (A.shape[1], A.shape[0]), (0, 0, 0))
        if fin.any():
            lo = float(A[fin].min()); hi = float(A[fin].max())
            span = max(hi - lo, 1e-9)
            px = img.load()
            for r in range(A.shape[0]):
                for c in range(A.shape[1]):
                    if fin[r, c]:
                        v = int(255 * (A[r, c] - lo) / span)
                        px[c, r] = (v, v, v)
        return img, lo if fin.any() else 0.0, hi if fin.any() else 0.0
    # flip z so crown at top; upscale 4x NEAREST (data unchanged, silhouette readable)
    iY, loY, hiY = field_img(Ys[::-1, :], "Yb")
    iX, loX, hiX = field_img(Xs[::-1, :], "Xs")
    iY = iY.resize((iY.size[0] * 4, iY.size[1] * 4), Image.NEAREST)
    iX = iX.resize((iX.size[0] * 4, iX.size[1] * 4), Image.NEAREST)
    lab = 44
    Wp = max(iY.size[0], iX.size[0]); Hp = iY.size[1]
    sheet = Image.new("RGB", (Wp * 2 + 30, Hp + lab), (20, 20, 20))
    dr = ImageDraw.Draw(sheet)
    sheet.paste(iY, (0, lab)); sheet.paste(iX, (Wp + 30, lab))
    dr.text((10, 8), "Yb(x,z) y=[%.3f,%.3f] x+-0.30 z[%.3f,%.3f]" % (loY, hiY, float(zg[0]), float(zg[-1])), fill=(255, 165, 0))
    dr.text((Wp + 40, 8), "Xs(y,z) |x|=[%.3f,%.3f] y+-0.20 z[%.3f,%.3f]" % (loX, hiX, float(zgs[0]), float(zgs[-1])), fill=(255, 165, 0))
    dr.text((10, 24), "crown TOP; back silhouette: head ball + neck pinch + shoulder shelf", fill=(180, 180, 180))
    sheet.save(out / "heightfields-debug.png")
    print("WROTE", out / "heightfields-debug.png")


def _jit12(xE, yE, zE, cx):
    import hashlib
    key = "%d|%d|%d" % (round(abs(float(xE) - float(cx)) * 1e4), round(float(yE) * 1e4), round(float(zE) * 1e4))
    seed = int(hashlib.md5(key.encode()).hexdigest()[:8], 16)
    return float(np.random.default_rng(seed).uniform(-0.006, 0.006))


def _yb_lookup13(Yb, xg, zg, x, z):
    """M5 hull obstacle: max over +-3 x-samples (12mm) so silhouette grazes
    still yield a support instead of a span that cuts the head side."""
    ii = int(np.argmin(np.abs(xg - float(x)))); jj = int(np.argmin(np.abs(zg - float(z))))
    a = max(ii - 3, 0); b = min(ii + 4, Yb.shape[1])
    seg = Yb[jj, a:b][np.isfinite(Yb[jj, a:b])]
    if len(seg) == 0:
        return -np.inf
    return float(seg.max())


def _grid_bilin13(F, gx, gz, x, z):
    """Bilinear sample of a heightfield grid (nearest-neighbour stairs become
    ramps, so clearance pushes and hull obstacles vary smoothly along the
    string instead of walling at 4mm cells). -inf nodes are missing: max of
    the finite nodes (conservative for an obstacle); -inf if all missing."""
    fx = (float(x) - float(gx[0])) / (float(gx[1]) - float(gx[0]))
    fz = (float(z) - float(gz[0])) / (float(gz[1]) - float(gz[0]))
    i0 = int(np.floor(fx)); j0 = int(np.floor(fz))
    i0 = max(0, min(i0, len(gx) - 2)); j0 = max(0, min(j0, len(gz) - 2))
    tx = min(max(fx - i0, 0.0), 1.0); tz = min(max(fz - j0, 0.0), 1.0)
    vals = []
    for (jj, ii, w) in ((j0, i0, (1 - tx) * (1 - tz)), ((j0, i0 + 1, tx * (1 - tz))),
                        ((j0 + 1, i0, (1 - tx) * tz)), ((j0 + 1, i0 + 1, tx * tz))):
        v = float(F[jj, ii])
        if np.isfinite(v):
            vals.append((v, w))
    if not vals:
        return -np.inf
    if len(vals) < 4:
        return float(max(v for v, w in vals))
    return float(sum(v * w for v, w in vals))


def _yb_lookup12(Yb, xg, zg, x, z):
    ii = int(np.argmin(np.abs(xg - float(x)))); jj = int(np.argmin(np.abs(zg - float(z))))
    v = float(Yb[jj, ii])
    return v


def _xs_lookup12(Xs, yg, zsg, y, z):
    ii = int(np.argmin(np.abs(yg - float(y)))); jj = int(np.argmin(np.abs(zsg - float(z))))
    return float(Xs[jj, ii])


def _t_of_root13(r, cx):
    """M3 depth seed: mirror-symmetric hash of (|x|, y, z); 50% of strands t<0.35."""
    import hashlib
    key = "%d|%d|%d" % (round(abs(float(r[0]) - float(cx)) * 1e4), round(float(r[1]) * 1e4), round(float(r[2]) * 1e4))
    seed = int(hashlib.md5(key.encode()).hexdigest()[:8], 16)
    u = float(np.random.default_rng(seed).uniform(0.0, 1.0))
    if u < 0.5:
        return u * 0.7
    return 0.35 + (u - 0.5) * 1.3


def _build_side_envelope13(Xs, yg, ear_y):
    """Kept for reference; guides14 uses _build_side_envelope14."""
    return _build_side_envelope14(Xs, yg, float(ear_y) - 0.035, float(ear_y) + 0.035)


def _build_side_envelope14(Xs, yg, elo, ehi):
    """M1 guides14 SIDE BRIDGE: flat per-z max of Xs over the ear band ONLY
    (bridges the pinna). -inf outside the band so bilinear lookups yield no
    side push there. Xs is |x|-based hence side-independent and mirror-exact."""
    E = np.full_like(np.array(Xs, dtype=float), -np.inf)
    yy = np.array(yg, dtype=float)
    band = (yy >= float(elo)) & (yy <= float(ehi))
    for jj in range(E.shape[0]):
        row = np.array(Xs[jj], dtype=float)
        seg = row[band][np.isfinite(row[band])]
        if len(seg) == 0:
            continue
        E[jj, band] = float(seg.max())
    return E


def _halfwidth12(Yb, xg, zg, z):
    jj = int(np.argmin(np.abs(zg - float(z))))
    row = Yb[jj]
    fin = np.isfinite(row)
    if not fin.any():
        return 0.0
    return float(np.abs(xg[fin]).max())


def _taut_string13(zE, yE, zH, x0, Yb, xg, zg, Zt, ytg, cvec, diag=None):
    """M2/M3/M6: G12 taut string from the lift-off point L at x0. M6: x stays
    at x0 (L.x pushed outward by the M4 side clearance only, no target-width
    easing). cvec: per-sample clearance = M3 tapered depth. Closed form."""
    N = max(int(abs(float(zE) - float(zH)) / 0.002) + 1, 8)
    zs = np.linspace(float(zE), float(zH), N)
    xs = np.full(N, float(x0))
    cv = np.array(cvec, dtype=float)
    O = np.full(N, -np.inf)
    for i in range(N):
        o = -np.inf
        v = max(_grid_bilin13(Yb, xg, zg, xs[i] - 0.012, zs[i]),
                _grid_bilin13(Yb, xg, zg, xs[i], zs[i]),
                _grid_bilin13(Yb, xg, zg, xs[i] + 0.012, zs[i]))
        if np.isfinite(v):
            o = v + cv[i]
        ix = int(np.argmin(np.abs(xg - float(xs[i]))))
        a = max(ix - 3, 0); b = min(ix + 4, Zt.shape[1])
        col = Zt[:, a:b].max(axis=1)
        m = col >= (float(zs[i]) - cv[i])
        if bool(m.any()):
            o = max(o, float(ytg[m].max()) + cv[i])
        O[i] = o
    # dilate within finite runs DOWNWARD ONLY (samples below): drape valleys
    # below bridge, but no phantom supports smear up to/above L (those flew
    # near-horizontal across the profile). Round staircases downward ditto.
    Od = O.copy()
    fin = np.isfinite(O)
    for i in range(N):
        if not fin[i]:
            continue
        a = i; b = min(i + 9, N)
        seg = O[a:b][np.isfinite(O[a:b])]
        if len(seg):
            Od[i] = float(seg.max())
    Om = Od.copy()
    for i in range(N):
        if not fin[i]:
            continue
        a = i; b = min(i + 5, N)
        seg = Od[a:b][np.isfinite(Od[a:b])]
        if len(seg) >= 3:
            Om[i] = max(float(O[i]), float(seg.mean()))
    O = Om
    sup = [0]; yc = [float(yE)]; cur = 0
    for _ in range(N + 5):
        y_c = float(yc[-1])
        rest = O[cur + 1:]
        if rest.size == 0 or bool(np.all(~np.isfinite(rest) | (rest <= y_c + 1e-4))):
            break
        zc = float(zs[cur])
        found = -1
        for j in range(N - 1, cur, -1):
            if not np.isfinite(O[j]):
                continue
            if j == cur + 1:
                found = j
                break
            kk = np.arange(cur + 1, j)
            f = (zs[kk] - zc) / (float(zs[j]) - zc)
            yl = y_c + f * (float(O[j]) - y_c)
            if bool(np.all(~np.isfinite(O[kk]) | (O[kk] <= yl + 1e-4))):
                found = j
                break
        if found < 0:
            break
        sup.append(found); yc.append(float(O[found])); cur = found
        if cur >= N - 1:
            break
    yd = np.empty(N)
    sarr = np.array(sup, dtype=int)
    for k in range(N):
        if k <= sarr[0]:
            yd[k] = float(yE)
            continue
        si = int(np.searchsorted(sarr, k, side="right")) - 1
        if si >= len(sarr) - 1:
            yd[k] = float(yc[-1])
        else:
            a = int(sarr[si]); b = int(sarr[si + 1])
            f = (float(zs[k]) - float(zs[a])) / (float(zs[b]) - float(zs[a])) if b != a else 0.0
            yd[k] = float(yc[si]) * (1.0 - f) + float(yc[si + 1]) * f
    _pts14 = np.stack([xs, yd, zs], axis=1)
    if diag is not None:
        _sarr14 = np.array(sup, dtype=int)
        _sp14 = []
        for _si in range(len(_sarr14) - 1):
            _a = int(_sarr14[_si]); _b = int(_sarr14[_si + 1])
            _dz = float(zs[_b] - zs[_a]); _dy = float(yd[_b] - yd[_a])
            _sp14.append((round(_dz * 1000, 1), round(_dy * 1000, 1),
                          round(float(np.hypot(_dz, _dy)) * 1000, 1)))
        diag.append({"zS": round(float(zE) * 1000, 1), "yE": round(float(yE) * 1000, 1),
                     "x0": round(float(x0) * 1000, 1),
                     "nsup": len(_sarr14), "spans": _sp14})
    return _pts14, sup


def _run_strings12(out, h, body, aa):
    from mathutils import Vector, kdtree
    from mathutils.bvhtree import BVHTree
    from collections import Counter
    STEM = str(aa.stem)
    MIRROR = bool(aa.mirror_test)
    S1R = bool(aa.s1_raw)
    bad = ("eye", "mouth", "teeth", "tooth", "tongue", "lash", "brow", "nail", "hair", "mask", "helper", "glasses", "hat", "cap_")
    cols = [o for o in bpy.data.objects if o.type == "MESH" and o.visible_get()
            and o is not body and not any(b in o.name.lower() for b in bad)]
    keep_subs = ("aisha_head", "toigo_t_shirt", "tight_jeans", "toigo_mj_cloth_shoes")
    cols = [o for o in cols if any(s in o.name.lower() for s in keep_subs)]
    print("colliders: body=%s + %s" % (body.name, [o.name for o in cols]))
    colliders = [body] + cols
    deps = bpy.context.evaluated_depsgraph_get()
    body.update_tag(); bpy.context.view_layer.update()
    W = wpts(body)
    crown = float(W[:, 2].max()); cx = float(np.median(W[W[:, 2] > crown - 0.26][:, 0]))
    medy = float(np.median(W[:, 1]))
    F = HERE.parent / "hair-cap7"
    cap = np.load(F / "cap-v7.npz"); fb = np.load(F / "flow-b-v7.npz", allow_pickle=True)
    V = np.array(cap["verts"]); slit = set(int(v) for v in cap["slit"])
    ear_y = float(cap["ear_y"]); ear_top = float(cap["ear_top"])
    brow_z = float(cap["brow_z"]); nasion_z = float(cap["nasion_z"]); menton_z = float(cap["menton_z"])
    menton = float(menton_z); zhem = float(menton_z) - 0.73 * 0.2107
    fB = np.array(fb["f"])
    print("crown=%.4f menton=%.4f zhem=%.4f ear_y=%.4f ear_top=%.4f brow_z=%.4f" % (crown, menton, zhem, ear_y, ear_top, brow_z))
    # R2: reuse G12 heightfields (read-only); M4 envelope built in memory.
    HF = np.load(HERE.parent / "hair-guides12" / "heightfields.npz")
    Yb = np.array(HF["Yb"]); xg = np.array(HF["x_Yb"]); zg = np.array(HF["z_Yb"])
    Xs = np.array(HF["Xs"]); yg = np.array(HF["y_Xs"]); zsg = np.array(HF["z_Xs"])
    ear_front_y = float(0.5 * (float(cap["pinna_front_L"][1]) + float(cap["pinna_front_R"][1])))
    ear_back_y = float(max(float(np.array(cap["pset"])[:, 1].max()),
                           float(np.array(cap["eset"])[:, 1].max())))
    elo14 = float(ear_front_y) - 0.010
    ehi14 = float(ear_back_y) + 0.010
    Xs_env = _build_side_envelope14(Xs, yg, elo14, ehi14)
    print("M1 earband front=%.1f back=%.1f elo=%.1f ehi=%.1f" % (
        ear_front_y * 1000, ear_back_y * 1000, elo14 * 1000, ehi14 * 1000))
    _sk = W[(W[:, 2] > crown - 0.20) & (W[:, 2] < crown - 0.02)]
    cyh = float(0.5 * (_sk[:, 1].min() + _sk[:, 1].max()))
    # Head half-width per 4mm z-bin (side-free => mirror-exact): the string
    # start x0 must clear the whole head span below L, else the first span
    # flies horizontally through the slab edge (profile beams, dives).
    _hzb = np.arange(1.40, crown + 0.0001, 0.004)
    _hHW = np.zeros(len(_hzb))
    for _bi, _bz in enumerate(_hzb):
        _sel = W[np.abs(W[:, 2] - float(_bz)) <= 0.002]
        _hHW[_bi] = float(np.abs(_sel[:, 0] - cx).max()) if len(_sel) else 0.0
    print("side-envelope ear_y=%.4f cyh=%.4f hHWmax=%.1f" % (ear_y, cyh, _hHW.max() * 1000))
    bvhs = {o.name: BVHTree.FromObject(o, deps, deform=True, cage=False) for o in colliders}
    bvh_body = bvhs[body.name]
    # top heightfield Zt(x,y) = max z over R5 (shoulder-top corner contour source)
    ZT = np.full((len(yg), len(xg)), -np.inf)
    for ji, y in enumerate(yg):
        for ii, x in enumerate(xg):
            best = -np.inf
            for o in colliders:
                hit, _, _, _ = bvhs[o.name].ray_cast(Vector((float(x), float(y), 2.2)), Vector((0.0, 0.0, -1.0)), 3.0)
                if hit is not None and float(hit.z) > best:
                    best = float(hit.z)
            ZT[ji, ii] = best
        if ji % 25 == 0:
            print("ZT row %d/%d y=%.3f fin=%d" % (ji, len(yg), float(y), int(np.isfinite(ZT[ji]).sum())))
    Zs = ZT.copy()
    nx = len(xg)
    for ii in range(nx):
        jj = nx - 1 - ii
        if jj < ii:
            break
        a = ZT[:, ii]; b = ZT[:, jj]
        fa = np.isfinite(a); fb = np.isfinite(b)
        m = np.full(len(yg), -np.inf)
        both = fa & fb
        m[both] = 0.5 * (a[both] + b[both])
        m[fa & ~fb] = a[fa & ~fb]; m[fb & ~fa] = b[fb & ~fa]
        Zs[:, ii] = m; Zs[:, jj] = m
    ZT = Zs
    print("ZT shape=%s finite=%d" % (tuple(ZT.shape), int(np.isfinite(ZT).sum())))

    def mir0(p):
        q = np.array(p, dtype=float); q[0] = -q[0]; return q

    def nearest_sym(bvh, p):
        q, n, sd, _dq = nearest_sym_dq(bvh, p)
        return q, n, sd

    def nearest_sym_dq(bvh, p):
        q1, n1 = nearest_pt(bvh, p)
        if q1 is None:
            return None, None, None, 0.0
        mp = mir0(p)
        q2, n2 = nearest_pt(bvh, mp)
        if q2 is None:
            return np.array(q1), np.array(n1), sdist(p, q1, n1), 0.0
        q2m = mir0(q2); n2m = np.array(n2, dtype=float); n2m[0] = -n2m[0]
        q = 0.5 * (np.array(q1, dtype=float) + q2m)
        nn = np.array(n1, dtype=float) + n2m; l = float(np.linalg.norm(nn))
        n = nn / l if l > 1e-9 else np.array(n1, dtype=float)
        sd = 0.5 * (sdist(p, q1, n1) + sdist(mp, np.array(q2), np.array(n2)))
        dq = float(np.linalg.norm(np.array(q1, dtype=float) - q2m))
        return q, n, sd, dq

    # M7 roots: Poisson 6mm, slit exclusion 1.0mm, ceiling 600, seed 7 (guides11-exact)
    SV = V[sorted(slit)]
    sdist_cap = np.linalg.norm(V[:, None, :] - SV[None, :, :], axis=2).min(1)
    cand = np.where(sdist_cap >= 0.0010)[0]
    rng = np.random.default_rng(7); rng.shuffle(cand)
    acc = []
    A = np.empty((0, 3))
    for i in cand:
        if len(acc) == 0 or float(np.linalg.norm(A - V[i], axis=1).min()) >= 0.006:
            acc.append(int(i)); A = V[np.array(acc)]
    prot = np.linalg.norm(V[acc][:, None, :] - SV[None, :, :], axis=2).min(1) < 0.004
    while len(acc) > 595:
        A = V[np.array(acc)]
        D = np.linalg.norm(A[:, None, :] - A[None, :, :], axis=2)
        D += np.eye(len(acc)) * 1e9
        D[prot[:, None] | prot[None, :]] = 1e9
        dmin = float(D.min())
        if dmin >= 1e8:
            break
        alive = np.ones(len(acc), bool)
        ii, jj = np.where(np.triu(D < dmin + 0.0005, 1))
        order = np.argsort(D[ii, jj])
        for a, b in zip(ii[order], jj[order]):
            if alive[a] and alive[b]:
                alive[b] = False
        if alive.all():
            break
        acc = [acc[k] for k in np.where(alive)[0]]
        prot = prot[alive]
    excluded = set()
    for _ in range(400):
        A = V[np.array(acc)]
        Dw = np.linalg.norm(V[:, None, :] - A[None, :, :], axis=2).min(1)
        if excluded:
            Dw[list(excluded)] = -1.0
        i = int(Dw.argmax())
        if float(Dw[i]) <= 0.006 or len(acc) >= 600:
            break
        if float(np.linalg.norm(SV - V[i], axis=1).min()) < 0.0010:
            excluded.add(i); continue
        acc.append(i)
    Rprod = V[np.array(acc)]
    # face helpers: canthus x + front depth map (guides11 G5-exact)
    _eyes = [o for o in bpy.data.objects if o.type == "MESH" and "eye" in o.name.lower() and o is not body]
    _canth = 0.030
    if _eyes:
        _ex = []
        for o in _eyes:
            _V = np.array([tuple(o.matrix_world @ v.co) for v in o.data.vertices])
            _ex.append(float(np.abs(_V[:, 0] - cx).max()))
        if _ex:
            _canth = float(max(_ex))
    print("canthus_x=%.1fmm" % (_canth * 1000))
    _depth = {}
    for _w in W:
        _key = (round(float(_w[0]) / 0.005), round(float(_w[2]) / 0.005))
        if _key not in _depth or float(_w[1]) < _depth[_key]:
            _depth[_key] = float(_w[1])
    hairline_z = float(np.mean(V[np.array(cap["forehead"])][:, 2]))
    kd = kdtree.KDTree(len(V))
    for i, p in enumerate(V):
        kd.insert(Vector(tuple(p)), i)
    kd.balance()
    ball = np.array(sorted(set(int(v) for v in cap["exit"]) | set(int(v) for v in cap["forehead"]) | set(int(v) for v in cap["slit"])))
    bkd = kdtree.KDTree(len(ball))
    for vi in ball:
        bkd.insert(Vector(tuple(V[int(vi)])), int(vi))
    bkd.balance()
    # M2 guides14: cap-boundary adjacency (single-face edges) for slide tangents.
    _Fcap = np.array(cap["faces"])
    _ecnt = {}
    for _f in _Fcap:
        for _k in range(3):
            _a, _b = int(_f[_k]), int(_f[(_k + 1) % 3])
            _key = (_a, _b) if _a < _b else (_b, _a)
            _ecnt[_key] = _ecnt.get(_key, 0) + 1
    from collections import defaultdict as _dd14
    badj14 = _dd14(set)
    for (_a, _b), _c in _ecnt.items():
        if _c == 1:
            badj14[_a].add(_b); badj14[_b].add(_a)
    _sb_idx = np.array(sorted(set(int(v) for v in cap["sideburn_L"]) | set(int(v) for v in cap["sideburn_R"])))
    SBSET14 = V[_sb_idx] if len(_sb_idx) else np.empty((0, 3))
    sb_min_z14 = float(SBSET14[:, 2].min()) if len(SBSET14) else float("nan")
    Ccap14 = V.mean(axis=0)

    def is_sb_root14(r):
        d = np.linalg.norm(SBSET14 - np.array(r, dtype=float), axis=1)
        return bool(d.min() < 0.005)

    def is_sb_bottom14(bv):
        bv = np.array(bv, dtype=float)
        if float(bv[2]) > sb_min_z14 + 0.005:
            return False
        return bool(np.linalg.norm(SBSET14 - bv, axis=1).min() < 0.003)

    _rx14 = [0.0]

    def boundary_tangent14(vi, n):
        nbs = [int(w) for w in badj14.get(int(vi), [])]
        if len(nbs) >= 2:
            t = V[nbs[0]] - V[nbs[1]]
        elif len(nbs) == 1:
            t = V[nbs[0]] - V[int(vi)]
        else:
            t = np.array([0.0, 1.0, 0.0])
        t = np.array(t, dtype=float)
        t = t - (t @ n) * n
        ll = float(np.linalg.norm(t))
        if ll < 1e-9:
            t = np.array([0.0, 1.0, 0.0]); t = t - (t @ n) * n
            ll = float(np.linalg.norm(t))
            if ll < 1e-9:
                t = np.array([0.0, 1.0, 0.0]); ll = 1.0
        t = t / ll
        if abs(float(t[1])) < 0.05 and abs(float(_rx14[0])) >= 0.001:
            if float(t[0]) * float(_rx14[0]) < 0.0:
                t = -t
        elif float(t[1]) < 0.0:
            t = -t
        return t
    capBVH = BVHTree.FromPolygons([Vector(tuple(p)) for p in V], [tuple(f) for f in np.array(cap["faces"])])

    def cap_dist_sym(p):
        _, _, _, d1 = capBVH.find_nearest(Vector(tuple(p)))
        _, _, _, d2 = capBVH.find_nearest(Vector(tuple(mir0(p))))
        f1 = float(d1) if d1 is not None else 1e9
        f2 = float(d2) if d2 is not None else 1e9
        return max(f1, f2)

    def trace_root(r):
        # M2 guides14 FRONT-EDGE SLIDE: a step that would leave the cap through
        # the FRONT boundary (boundary vertex y < ear_front.y, i.e. forehead
        # arch, temple recess, or sideburn front edge) does not stop: project
        # onto the boundary tangent toward increasing y and continue 2mm inside
        # the edge until the flow points back in or the ear line is reached.
        # Sideburn-bottom exits are allowed only for sideburn-rooted strands.
        sb_root = bool(is_sb_root14(r))
        _rx14[0] = float(r[0]) - cx
        p = Vector(tuple(r)); pl = [tuple(r)]
        slides = 0
        for _ in range(220):
            _, vi, _ = kd.find(p)
            _mp = mir0(np.array(tuple(p), dtype=float))
            _, vj, _ = kd.find(Vector(tuple(_mp)))
            _fj = np.array(fB[vj], dtype=float); _fj[0] = -_fj[0]
            fv = 0.5 * (np.array(fB[vi], dtype=float) + _fj)
            nl = float(np.linalg.norm(fv))
            if nl < 1e-9:
                break
            p_new = p + Vector(tuple(fv / nl * 0.002))
            q, n, _sd = nearest_sym(bvh_body, np.array(tuple(p_new), dtype=float))
            p_proj = Vector(tuple(q)) if q is not None else p_new
            if cap_dist_sym(p_proj) > 0.0015:
                _, bi2, _ = bkd.find(p_proj)
                bv = V[int(bi2)]
                front_exit = float(bv[1]) < float(ear_front_y)
                sb_bottom = bool(is_sb_bottom14(bv))
                if front_exit or (sb_bottom and not sb_root):
                    if slides >= 100:
                        pl.append(tuple(p_proj)); return np.array(pl), int(bi2)
                    q0, n0, _s0 = nearest_sym(bvh_body, np.array(tuple(p), dtype=float))
                    nn0 = np.array(n0, dtype=float) if n0 is not None else np.array([0.0, -1.0, 0.0])
                    t = boundary_tangent14(int(bi2), nn0)
                    step = np.array(tuple(p), dtype=float) + t * 0.002
                    hq2, hn2, _s2, _dq2 = nearest_sym_dq(bvh_body, step)
                    if hq2 is None:
                        pl.append(tuple(p_proj)); return np.array(pl), int(bi2)
                    cand2 = np.array(hq2); hnA = np.array(hn2, dtype=float)
                    for _ in range(5):
                        if cap_dist_sym(cand2) <= 0.0015:
                            break
                        dd = Ccap14 - cand2; dd = dd - (dd @ hnA) * hnA
                        dll = float(np.linalg.norm(dd))
                        if dll < 1e-9:
                            break
                        hq3, hn3, _s3, _dq3 = nearest_sym_dq(bvh_body, cand2 + dd / dll * 0.001)
                        if hq3 is None:
                            break
                        cand2, hnA = np.array(hq3), np.array(hn3, dtype=float)
                    p = Vector(tuple(cand2)); pl.append(tuple(cand2))
                    slides += 1
                    if float(cand2[1]) >= float(ear_front_y) - 0.002:
                        _, bi3, _ = bkd.find(Vector(tuple(cand2)))
                        return np.array(pl), int(bi3)
                    continue
                _, bi, _ = bkd.find(p_proj); pl.append(tuple(p_proj)); return np.array(pl), int(bi)
            p = p_proj; pl.append(tuple(p))
        return np.array(pl), None

    def region_of(E):
        yE = float(E[1]); zE = float(E[2])
        if zE < ear_top - 0.035:
            return "nape"
        if yE < ear_y - 0.010:
            return "forehead_temple"
        if yE > ear_y + 0.010:
            return "behind_ear"
        return "above_ear"

    def face_cross(pts):
        for p in pts:
            if abs(float(p[0]) - cx) <= _canth and menton <= float(p[2]) <= brow_z:
                yf = _depth.get((round(float(p[0]) / 0.005), round(float(p[2]) / 0.005)), None)
                if yf is not None and float(p[1]) < yf - 0.002:
                    return True
        return False

    _yf_cache = {}
    _diag_ds = []

    def _yf_raw13(x0, z):
        key = (round(float(x0) * 500.0), round(float(z) * 500.0))
        v = _yf_cache.get(key, None)
        if v is None:
            hit, _, _, _ = bvh_body.ray_cast(Vector((float(x0), -1.0, float(z))), Vector((0.0, 1.0, 0.0)), 3.0)
            v = float(hit.y) if hit is not None else float("nan")
            _yf_cache[key] = v
        return v

    def _yf_at13(x0, z):
        """Mirror-averaged front slab (bitwise-identical for mirror-pair
        strands: the pair (x0,-x0) is queried in opposite order, and IEEE
        addition commutes exactly). NaN unless both sides hit."""
        a = _yf_raw13(x0, z)
        b = _yf_raw13(-x0, z)
        if not (np.isfinite(a) and np.isfinite(b)):
            return float("nan")
        return 0.5 * (float(a) + float(b))

    def _yf_dil13(x0, z):
        """Slab-edge-robust front slab: min over +-12mm of the averaged
        query (slab-edge grazes still yield a slab instead of a missed probe
        that leaves a near-horizontal first span). G1-exact: the three
        averaged values are identical for mirror strands, min commutes."""
        vs = [_yf_at13(float(x0) - 0.012, z), _yf_at13(x0, z), _yf_at13(float(x0) + 0.012, z)]
        vs = [float(v) for v in vs if np.isfinite(v)]
        if not vs:
            return float("nan")
        return float(min(vs))

    def _front_drape13(zE, yE, zH, x0, c_at):
        """Front curtain drape: shortest closed-form path from L staying
        forward of the head slab (yf - c), down to the slab bottom zB where
        the back-hull takes over through the gap. Returns (pts, zB); zB None
        means the slab runs to the hem (drape stays front). (None, None) if
        no slab covers x0 at L, or L already starts behind the slab front
        (plain back-hull applies)."""
        _probe = _yf_dil13(x0, float(zE) - 0.004)
        if not np.isfinite(_probe):
            return None, None
        if not (float(yE) < float(_probe) - 0.002):
            return None, None
        N = max(int(abs(float(zE) - float(zH)) / 0.001) + 1, 8)
        zs = np.linspace(float(zE), float(zH), N)
        yf = np.array([_yf_dil13(x0, z) for z in zs])
        fin = np.isfinite(yf)
        zB = None
        i = 0
        while i < len(zs):
            if not fin[i]:
                i += 1
                continue
            j = i
            while j < len(zs) and fin[j]:
                j += 1
            k = j
            while k < len(zs) and not fin[k]:
                k += 1
            if k - j >= 2:
                zB = float(zs[j - 1])
                break
            i = k
        F = np.array([float(yf[t]) - c_at(float(zs[t])) if fin[t] else -np.inf for t in range(len(zs))])
        # F is an UPPER bound (string stays forward of it): dilate with the
        # minimum (conservative) and never round above raw. Kept tight (+-2)
        # so the drape hugs the face instead of floating on far-forward
        # cheek bumps (profile rectangles).
        _Ff = np.isfinite(F)
        _Fd = F.copy()
        for i in range(len(F)):
            if not _Ff[i]:
                continue
            a = max(i - 2, 0); b = min(i + 3, len(F))
            seg = F[a:b][np.isfinite(F[a:b])]
            if len(seg):
                _Fd[i] = float(seg.min())
        for i in range(len(F)):
            if not _Ff[i]:
                continue
            a = max(i - 1, 0); b = min(i + 2, len(F))
            seg = _Fd[a:b][np.isfinite(_Fd[a:b])]
            if len(seg) >= 3:
                _Fd[i] = min(float(F[i]), float(seg.mean()))
        F = _Fd
        Mm = len(zs)
        sup = [0]; yc = [float(yE)]; cur = 0
        for _ in range(Mm + 5):
            y_c = float(yc[-1])
            zc = float(zs[cur])
            found = -1
            for j in range(Mm - 1, cur, -1):
                if not np.isfinite(F[j]):
                    continue
                if j == cur + 1:
                    found = j
                    break
                kk = np.arange(cur + 1, j)
                f = (zs[kk] - zc) / (float(zs[j]) - zc)
                yl = y_c + f * (float(F[j]) - y_c)
                if bool(np.all(~np.isfinite(F[kk]) | (F[kk] >= yl - 1e-4))):
                    found = j
                    break
            if found < 0:
                break
            sup.append(found); yc.append(float(F[found])); cur = found
            if cur >= Mm - 1:
                break
        yd = np.empty(Mm)
        sarr = np.array(sup, dtype=int)
        for k2 in range(Mm):
            if k2 <= sarr[0]:
                yd[k2] = float(yE)
                continue
            si = int(np.searchsorted(sarr, k2, side="right")) - 1
            if si >= len(sarr) - 1:
                yd[k2] = float(yc[-1])
            else:
                a = int(sarr[si]); b = int(sarr[si + 1])
                f = (float(zs[k2]) - float(zs[a])) / (float(zs[b]) - float(zs[a])) if b != a else 0.0
                yd[k2] = float(yc[si]) * (1.0 - f) + float(yc[si + 1]) * f
        pts = np.stack([np.full(Mm, float(x0)), yd, zs], axis=1)
        if zB is not None:
            pts = pts[zs >= zB - 1e-9]
        return pts, zB

    def grow13(r):
        pl, bi = trace_root(r)
        if bi is None or len(pl) < 3:
            return None
        # M1 LIFT-OFF: walk the scalp as before (hybrid mirror-averaged
        # projection), but STOP at the first support point where the head
        # surface turns under: outward normal n.z <= -0.05, or the strand has
        # passed below the head's widest contour in its own vertical plane
        # (radial distance from the head axis < max-so-far by > 2mm), or the
        # cap edge (trace end). The stop point L is the lift-off point.
        scalp = []
        norms = []
        repro = 0
        stop = "edge"
        rmax = -1e9
        broken = False
        sb_root14 = bool(is_sb_root14(r))
        for qq in pl:
            hq, hn, _ss, dq = nearest_sym_dq(bvh_body, qq)
            if hq is None:
                broken = True
                break
            if dq > 0.001:
                q0, n0 = nearest_pt(bvh_body, qq)
                if q0 is not None:
                    hq, hn = np.array(q0), np.array(n0)
                    repro += 1
            pt = np.array(hq) + np.array(hn) * 0.004
            q0, n0 = nearest_pt(bvh_body, pt)
            if q0 is not None and sdist(pt, q0, n0) < 0.001:
                q1, n1 = nearest_pt(bvh_body, qq)
                if q1 is not None:
                    pt = np.array(q1) + np.array(n1) * 0.004
                    repro += 1
            rr = float(np.hypot(float(hq[0]) - cx, float(hq[1]) - cyh))
            if len(scalp) >= 2:
                _front14 = (not sb_root14) and (float(hq[1]) < float(ear_front_y))
                if _front14:
                    rmax = max(rmax, rr)
                    scalp.append(pt); norms.append(np.array(hn, dtype=float))
                    continue
                if float(hn[2]) <= -0.05:
                    stop = "normal"
                    scalp.append(pt); norms.append(np.array(hn, dtype=float))
                    break
                if rr < rmax - 0.002:
                    stop = "widest"
                    scalp.append(pt); norms.append(np.array(hn, dtype=float))
                    break
            rmax = max(rmax, rr)
            scalp.append(pt); norms.append(np.array(hn, dtype=float))
        if broken:
            return None
        scalp = np.array(scalp)
        if len(scalp) < 3:
            return None
        L = scalp[-1]
        Ln = norms[-1] / max(float(np.linalg.norm(norms[-1])), 1e-12)
        reg = region_of(L)
        xE, yE, zE = float(L[0]), float(L[1]), float(L[2])
        sgn0 = 1.0 if float(r[0]) >= cx else -1.0
        # M3 DEPTH: per-strand clearance c = 4mm + 16mm*t, tapered to 4mm
        # between z = menton-0.10 and the hem.
        t = _t_of_root13(r, cx)
        _az14 = float(np.degrees(np.arctan2(abs(float(r[0]) - cx), float(r[1]) - cyh)))
        c = (0.008 + 0.022 * float(t)) if _az14 < 60.0 else (0.004 + 0.016 * float(t))
        zH = float(zhem) + _jit12(xE, yE, zE, cx)
        _N = max(int(abs(float(zE) - float(zH)) / 0.002) + 1, 8)
        _zs = np.linspace(float(zE), float(zH), _N)
        _f = np.clip((_zs - float(zhem)) / ((float(menton) - 0.10) - float(zhem)), 0.0, 1.0)
        cvec = 0.004 + (c - 0.004) * _f

        def _c_at_z(z):
            f = min(max((float(z) - float(zhem)) / ((float(menton) - 0.10) - float(zhem)), 0.0), 1.0)
            return 0.004 + (c - 0.004) * f
        # M2: string phase is the G12 taut string from L with L's tangent.
        # M4+M6: push L.x outward by the side envelope + full c BEFORE
        # hulling, so the first span departs in free air lateral to the head
        # instead of snapping through the temple slab (M5 proviso: L is not
        # on the convex hull of the head profile in the (z,y) plane).
        _elim = _grid_bilin13(Xs_env, yg, zsg, yE, zE)
        x0 = float(xE)
        is_side14 = (abs(float(xE) - cx) >= 0.045) and (float(yE) <= float(ehi14))
        diag14 = [] if is_side14 else None
        if is_side14 and np.isfinite(_elim):
            _need0 = float(_elim) + c + 0.010
            if float(zE) > float(ear_top) - 0.032:
                _need0 += 0.003
            if abs(x0 - cx) < _need0:
                x0 = cx + sgn0 * _need0
        # Clear the head span below L: x0 beyond the max head half-width in
        # [1.44, L.z] + c, so upper spans fly in free air lateral to the
        # head instead of through the slab edge.
        _b0 = int(np.searchsorted(_hzb, 1.44, side="left"))
        _b1 = int(np.searchsorted(_hzb, float(zE), side="right"))
        if is_side14 and _b1 > _b0:
            _spanmax = float(_hHW[_b0:_b1].max()) + c
            if abs(x0 - cx) < _spanmax:
                x0 = cx + sgn0 * _spanmax
        dense, sup = None, []
        # M5 side-exit lead-in: L inside the slab y-range at x0 (mid-slab L)
        # would fly near-horizontal to the first back support (profile beams
        # grazing the slab edge). Descend vertically at (x0, yE) — outside by
        # lift-off construction (surface falls away below L; side pass holds
        # the margin) — to the slab exit, then drape/hull from there, i.e.
        # the string starts where the vertical from L meets the hull.
        _ybL = max(_grid_bilin13(Yb, xg, zg, x0 - 0.012, float(zE)),
                   _grid_bilin13(Yb, xg, zg, x0, float(zE)),
                   _grid_bilin13(Yb, xg, zg, x0 + 0.012, float(zE)))
        _yfL = _yf_dil13(x0, float(zE))
        lead = None
        zS = float(zE)
        if (np.isfinite(_ybL) and np.isfinite(_yfL)
                and float(_yfL) - 0.002 <= float(yE) <= float(_ybL) + 0.002):
            _zn = max(int(abs(float(zE) - float(zH)) / 0.002) + 1, 8)
            _zscan = np.linspace(float(zE), float(zH), _zn)
            zExit = float(zH)
            for _zz in _zscan[1:]:
                _a = _yf_dil13(x0, float(_zz))
                _b = max(_grid_bilin13(Yb, xg, zg, x0 - 0.012, float(_zz)),
                         _grid_bilin13(Yb, xg, zg, x0, float(_zz)),
                         _grid_bilin13(Yb, xg, zg, x0 + 0.012, float(_zz)))
                if not (np.isfinite(_a) and np.isfinite(_b)
                        and float(_a) - 0.002 <= float(yE) <= float(_b) + 0.002):
                    zExit = float(_zz)
                    break
            if zExit < float(zE) - 1e-9:
                _ln = max(int(abs(float(zE) - zExit) / 0.002) + 1, 2)
                _lz = np.linspace(float(zE), zExit, _ln)[1:]
                lead = np.vstack([np.array(L)[np.newaxis, :],
                                  np.stack([np.full(len(_lz), float(x0)),
                                            np.full(len(_lz), float(yE)), _lz], axis=1)])
                zS = zExit
        _N = max(int(abs(zS - float(zH)) / 0.002) + 1, 8)
        _zs = np.linspace(zS, float(zH), _N)
        _f = np.clip((_zs - float(zhem)) / ((float(menton) - 0.10) - float(zhem)), 0.0, 1.0)
        cvec = 0.004 + (c - 0.004) * _f
        drape, zB = _front_drape13(zS, yE, zH, x0, _c_at_z)
        if drape is None:
            dense, sup = _taut_string13(zS, yE, zH, x0, Yb, xg, zg, ZT, yg, cvec, diag14)
        elif zB is None or len(drape) < 2:
            if drape is not None and len(drape) >= 2:
                dense, sup = drape, []
            else:
                dense, sup = _taut_string13(zS, yE, zH, x0, Yb, xg, zg, ZT, yg, cvec, diag14)
        else:
            yX = float(drape[-1][1])
            _N2 = max(int(abs(float(zB) - float(zH)) / 0.002) + 1, 8)
            _zs2 = np.linspace(float(zB), float(zH), _N2)
            _f2 = np.clip((_zs2 - float(zhem)) / ((float(menton) - 0.10) - float(zhem)), 0.0, 1.0)
            cvec2 = 0.004 + (c - 0.004) * _f2
            back, sup = _taut_string13(float(zB), yX, zH, x0, Yb, xg, zg, ZT, yg, cvec2, diag14)
            dense = np.vstack([drape[:-1], back])
        if lead is not None:
            dense = np.vstack([lead, dense[1:]])
        # M4: side clearance = convex envelope + tapered c, x-only, single
        # enforce on the 2mm dense samples (never on the 32-pt resample: flat
        # snaps there collapse neighbours to <2.5mm). +3mm anti-chord margin
        # so resample chords stay clear. M6: only this pass may push outward.
        for k in range(len(dense)):
            if (not is_side14) or dense[k][2] < menton - 0.02:
                continue
            lim = _grid_bilin13(Xs_env, yg, zsg, dense[k][1], dense[k][2])
            if not np.isfinite(lim):
                continue
            need = float(lim) + _c_at_z(dense[k][2]) + 0.010
            if abs(float(dense[k][1]) - ear_y) <= 0.020 and ear_top - 0.032 <= float(dense[k][2]) <= ear_top + 0.004:
                need += 0.003
            dx = dense[k][0] - cx
            s = 1.0 if dx == 0 else (1.0 if dx > 0 else -1.0)
            if dx == 0:
                s = sgn0
            if abs(dx) < need:
                dense[k][0] = cx + s * need
        # Back graze guard on dense (shoulder zone only; the front curtain
        # must stay forward): y >= dilated-Yb + tapered c + 3mm.
        for k in range(len(dense)):
            _z = float(dense[k][2])
            if _z >= menton - 0.02 or _z < float(zhem) - 0.05:
                continue
            _yb = max(_grid_bilin13(Yb, xg, zg, float(dense[k][0]) - 0.012, _z),
                      _grid_bilin13(Yb, xg, zg, float(dense[k][0]), _z),
                      _grid_bilin13(Yb, xg, zg, float(dense[k][0]) + 0.012, _z))
            if not np.isfinite(_yb):
                continue
            _yny = float(_yb) + _c_at_z(_z) + 0.005
            if float(dense[k][1]) < _yny:
                dense[k][1] = _yny
        if reg == "forehead_temple" and face_cross(dense):
            return ("drop-face", reg, np.array(r))
        # M5 JUNCTION: no positional blend. Guide = scalp points up to L, then
        # string points; smooth only the tangent with a 3-point arc insert at
        # L (A/Q/B), Q biased to keep L's outward offset so nothing moves
        # inward. Closed form throughout: no push-out loops, no stepwise fall.
        P0 = scalp[-2]
        P1 = dense[1]
        t1 = L - P0; l1 = float(np.linalg.norm(t1)); t1 = t1 / l1 if l1 > 1e-12 else np.zeros(3)
        t2 = P1 - L; l2 = float(np.linalg.norm(t2)); t2 = t2 / l2 if l2 > 1e-12 else np.zeros(3)
        ar = min(0.002, 0.4 * l1, 0.4 * l2)
        A = L - t1 * ar; B = L + t2 * ar
        M = 0.5 * (A + B)
        Q = M + Ln * max(0.0, float((L - M) @ Ln))
        C = np.vstack([scalp[:-1], A[np.newaxis, :], Q[np.newaxis, :], B[np.newaxis, :], dense[1:]])
        PH = np.array([0] * (len(scalp) - 1) + [0, 1, 1] + [1] * (len(dense) - 1))
        keep = [0]
        for k in range(1, len(C)):
            if float(np.linalg.norm(C[k] - C[keep[-1]])) >= 0.001:
                keep.append(k)
        C = C[keep]; PH = PH[keep]
        if len(C) < 4:
            return None
        rs, jmap = resample_linear(C, 32)
        rph = PH[np.clip(jmap, 0, len(PH) - 1)]
        if bool(np.isnan(rs).any()):
            return None
        # Resample chords across support corners cut inside (measured to
        # 5mm). Capped outward-only touch-up on string-phase points only
        # (scalp folds collapse under flat snaps): |x| and shoulder-y
        # deficits, moves capped at 6mm so 10mm segments survive.
        for k in range(len(rs)):
            if int(rph[k]) != 1:
                continue
            _z = float(rs[k][2])
            if is_side14 and _z >= menton - 0.02:
                _lim = _grid_bilin13(Xs_env, yg, zsg, float(rs[k][1]), _z)
                if np.isfinite(_lim):
                    _f = min(max((_z - float(zhem)) / ((float(menton) - 0.10) - float(zhem)), 0.0), 1.0)
                    _need = float(_lim) + (0.004 + (c - 0.004) * _f) + 0.005
                    _dx = float(rs[k][0]) - cx
                    _s = sgn0 if _dx == 0 else (1.0 if _dx > 0 else -1.0)
                    if abs(_dx) < _need:
                        _mv = min(_need - abs(_dx), 0.006)
                        rs[k][0] = float(rs[k][0]) + _s * _mv
            elif _z >= float(zhem) - 0.05:
                _f = min(max((_z - float(zhem)) / ((float(menton) - 0.10) - float(zhem)), 0.0), 1.0)
                _yb = max(_grid_bilin13(Yb, xg, zg, float(rs[k][0]) - 0.012, _z),
                          _grid_bilin13(Yb, xg, zg, float(rs[k][0]), _z),
                          _grid_bilin13(Yb, xg, zg, float(rs[k][0]) + 0.012, _z))
                if np.isfinite(_yb):
                    _yny = float(_yb) + (0.004 + (c - 0.004) * _f) + 0.005
                    if float(rs[k][1]) < _yny:
                        rs[k][1] = min(_yny, float(rs[k][1]) + 0.012)
        _segs = np.linalg.norm(np.diff(rs, axis=0), axis=1)
        if bool((_segs < 0.0025).any()) or bool((_segs == 0.0).any()):
            if bool(getattr(aa, "diag_only", False)) and len(_diag_ds) < 8:
                _diag_ds.append(1)
                _k = int(_segs.argmin())
                print("DG-DS reg=%s drape=%s nC=%d Ltot=%.1f minseg=%.2f at=%d p0=%s p1=%s" % (
                    reg, drape is not None, len(C),
                    float(np.linalg.norm(np.diff(C, axis=0), axis=1).sum() * 1000),
                    float(_segs.min() * 1000), _k,
                    np.round(rs[_k] * 1000, 1).tolist(), np.round(rs[_k + 1] * 1000, 1).tolist()))
            return ("drop-short", reg, np.array(r))
        return (rs, rph, np.array(r), reg, sup, repro, np.array(L), float(c), stop, bool(drape is not None), float(x0), diag14)

    def _run_strings12_main():
        pass
    _run_strings12_impl(out, h, body, aa, STEM, MIRROR, S1R, colliders, cols, bvhs, bvh_body, W, crown, cx, medy,
                        cap, fB, V, ear_y, ear_top, brow_z, nasion_z, menton, menton_z, zhem, hairline_z,
                        Yb, xg, zg, Xs, yg, zsg, ZT, Rprod, _canth, _depth, trace_root, nearest_sym,
                        region_of, face_cross, grow13, Counter)


def _run_strings12_impl(out, h, body, aa, STEM, MIRROR, S1R, colliders, cols, bvhs, bvh_body, W, crown, cx,
                         medy, cap, fB, V, ear_y, ear_top, brow_z, nasion_z, menton, menton_z, zhem,
                         hairline_z, Yb, xg, zg, Xs, yg, zsg, ZT, Rprod, _canth, _depth, trace_root,
                         nearest_sym, region_of, face_cross, grow13, Counter):
    from mathutils import Vector
    # P2 probe on production exits
    regs = Counter(); regl = {}
    for r in Rprod:
        pl, bi = trace_root(r)
        if bi is None or len(pl) < 3:
            regs["trace-fail"] += 1
            continue
        q, n, _s = nearest_sym(bvh_body, pl[-1])
        E = (np.array(q) + np.array(n) * 0.004) if q is not None else np.array(pl[-1])
        rg = region_of(E)
        regs[rg] += 1
        regl.setdefault(rg, []).append(E)
    for rg, Es in regl.items():
        Es = np.array(Es)
        print("P2 %s n=%d y=[%.1f,%.1f] z=[%.1f,%.1f]" % (
            rg, len(Es), float(Es[:, 1].min()) * 1000, float(Es[:, 1].max()) * 1000,
            float(Es[:, 2].min()) * 1000, float(Es[:, 2].max()) * 1000))
    print("P2 total=%d" % int(sum(regs.values())))
    if S1R:
        _fb = np.load(HERE.parent / "hair-cap7" / "flow-b-v7.npz", allow_pickle=True)
        _fr = np.array(_fb["roots"])
        _Rsel = _fr[(_fr[:, 0]) > 0.002]
        _Lsel = _Rsel.copy(); _Lsel[:, 0] = -_Lsel[:, 0]
        print("S1RAW pairs=%d" % len(_Rsel))

        def _grow12R(rr):
            g = grow13(rr)
            if g is None or (isinstance(g, tuple) and type(g[0]) is str):
                return None
            return g[0]

        _AR = [_grow12R(rr) for rr in _Rsel]
        _AL = [_grow12R(ll) for ll in _Lsel]
        ds = []
        for a, b in zip(_AR, _AL):
            if a is None or b is None:
                continue
            B = b.copy(); B[:, 0] = -B[:, 0]
            m = min(len(a), len(b))
            ds.append(float(np.linalg.norm(a[:m] - B[:m], axis=1).max()))
        ds = np.array(ds)
        s1 = {"pairs": int(len(ds)),
              "p50_mm": float(np.percentile(ds, 50)) * 1000.0 if len(ds) else float("nan"),
              "p95_mm": float(np.percentile(ds, 95)) * 1000.0 if len(ds) else float("nan"),
              "max_mm": float(ds.max()) * 1000.0 if len(ds) else float("nan")}
        print("S1RAW strings pairs=%d p50=%.4f p95=%.4f max=%.4f mm" % (s1["pairs"], s1["p50_mm"], s1["p95_mm"], s1["max_mm"]))
        (out / "s1-raw14.json").write_text(__import__("json").dumps(s1, indent=1))
        print("WROTE", out / "s1-raw14.json")
        return
    Rmir = Rprod.copy(); Rmir[:, 0] = -Rmir[:, 0]
    drop_face = Counter()

    def build(RR):
        chains = []; regs2 = Counter(); stops = Counter()
        tr_fail = 0; d_short = 0
        for r in RR:
            g = grow13(r)
            if g is None:
                tr_fail += 1
                continue
            if isinstance(g, tuple) and type(g[0]) is str:
                drop_face[g[0] + ":" + g[1]] += 1
                if g[0] == "drop-short":
                    d_short += 1
                continue
            rs, rph, root, reg, sup, repro, Lf, cf, stopf = g[:9]
            chains.append((rs, rph, root, reg, Lf, cf, stopf, g[9], g[10], g[11]))
            regs2[reg] += 1
            stops[stopf] += 1
        print("BUILD kept=%d tracefail=%d dropshort=%d dropface=%s" % (len(chains), tr_fail, d_short, dict(drop_face)))
        return chains, regs2

    def key_of(root):
        return (round(float(root[0]) * 1e4), round(float(root[1]) * 1e4), round(float(root[2]) * 1e4))

    if MIRROR:
        ca, ra = build(Rprod)
        dropa = dict(drop_face); drop_face.clear()
        cb, rb = build(Rmir)
        da = {key_of(c[2]): c[0] for c in ca}
        db = {(-key_of(c[2])[0], key_of(c[2])[1], key_of(c[2])[2]): c[0] for c in cb}
        common = sorted(set(da) & set(db))
        if len(common):
            A = np.array([da[k] for k in common]); B = np.array([db[k] for k in common])
            Bm = B.copy(); Bm[..., 0] = -Bm[..., 0]
            md = np.linalg.norm(A - Bm, axis=2).max(axis=1)
            _im14 = int(np.argmax(md))
            _dv14 = np.linalg.norm(A[_im14] - Bm[_im14], axis=1)
            _kz14 = int(_dv14.argmax())
            print("DG-MIR worst=%.3fmm rootkey=%s at z=%.1f" % (
                float(md[_im14]) * 1000, common[_im14], float(A[_im14][_kz14][2]) * 1000))
        else:
            md = np.array([9.0])
        mir = {"p50_mm": float(np.percentile(md, 50)) * 1000, "p95_mm": float(np.percentile(md, 95)) * 1000,
               "max_mm": float(md.max()) * 1000, "n_a": int(len(ca)), "n_b": int(len(cb)), "n_pair": int(len(common))}
        print("MIRROR n_a=%d n_b=%d npair=%d p50=%.4f p95=%.4f max=%.4f mm" % (mir["n_a"], mir["n_b"], mir["n_pair"], mir["p50_mm"], mir["p95_mm"], mir["max_mm"]))
        (out / "mirror14.json").write_text(__import__("json").dumps(mir, indent=1))
        print("WROTE", out / "mirror14.json")
        chains = ca
        drop_face.update(dropa)
    else:
        chains, ra = build(Rprod)
        mir = None
    n = len(chains)
    print("CHAINS n=%d regs=%s dropface=%s" % (n, dict(ra), dict(drop_face)))
    if n == 0:
        print("NO CHAINS"); return
    G = np.array([c[0] for c in chains]); RPH = np.array([c[1] for c in chains])
    GR = np.array([c[2] for c in chains])
    LA = np.array([c[4] for c in chains]); CA = np.array([c[5] for c in chains])
    STPA = [c[6] for c in chains]
    n_roots = int(len(Rprod))
    _skh = W[(W[:, 2] > crown - 0.20) & (W[:, 2] < crown - 0.02)]
    cyh = float(0.5 * (_skh[:, 1].min() + _skh[:, 1].max()))
    # M1 lift-off histogram by region with z ranges + stop reasons
    _lreg = {}
    for gi in range(n):
        _lreg.setdefault((chains[gi][3], STPA[gi]), []).append(LA[gi])
    for (rg, st), Es in sorted(_lreg.items()):
        Es = np.array(Es)
        print("LIFT %s stop=%s n=%d y=[%.1f,%.1f] z=[%.1f,%.1f]" % (
            rg, st, len(Es), float(Es[:, 1].min()) * 1000, float(Es[:, 1].max()) * 1000,
            float(Es[:, 2].min()) * 1000, float(Es[:, 2].max()) * 1000))
    print("LIFT stops=%s" % dict(Counter(STPA)))
    ear_front_y14 = float(0.5 * (float(cap["pinna_front_L"][1]) + float(cap["pinna_front_R"][1])))
    _sbI14 = np.array(sorted(set(int(v) for v in cap["sideburn_L"]) | set(int(v) for v in cap["sideburn_R"])))
    _sbS14 = V[_sbI14] if len(_sbI14) else np.empty((0, 3))
    _flo = sum(1 for gi in range(n) if float(LA[gi][1]) < ear_front_y14 - 0.005
               and not bool(np.linalg.norm(_sbS14 - GR[gi], axis=1).min() < 0.005))
    print("M3 front-liftoff non-sideburn=%d (need 0)" % _flo)
    # G6 ear hulls (M4 bridge verification): convex hull per side over pinna
    # seed verts. Two same-side instances (one merged mesh would tent ACROSS
    # the head and swallow behind-head strings). Hidden from renders; used
    # only for the same-side inside-hull test.
    import bmesh as _bmesh
    from mathutils.bvhtree import BVHTree as _BVH
    _bvh_hulls = {}
    for sgn, nm in ((-1.0, "L"), (1.0, "R")):
        _sel = None
        for att in range(3):
            pad = att * 0.010
            _sel = W[((W[:, 0] - cx) * sgn > 0.060) & ((W[:, 0] - cx) * sgn < 0.090 + pad)
                     & (W[:, 1] >= ear_y - 0.015 - pad) & (W[:, 1] <= ear_y + 0.012 + pad)
                     & (W[:, 2] >= ear_top - 0.030 - pad) & (W[:, 2] <= ear_top + 0.002 + pad)]
            if len(_sel) >= 4:
                break
        if _sel is None or len(_sel) < 4:
            raise RuntimeError("hull box empty on side %s" % nm)
        _me = bpy.data.meshes.new("OCLX_g13_hull_%s_mesh" % nm)
        _me.from_pydata([tuple(p) for p in _sel], [], [])
        _me.update()
        _bm = _bmesh.new(); _bm.from_mesh(_me)
        _bm.verts.ensure_lookup_table()
        _bmesh.ops.convex_hull(_bm, input=list(_bm.verts))
        _bm.to_mesh(_me); _bm.free(); _me.update()
        _ho = bpy.data.objects.new("OCLX_g13_ear_hull_%s" % nm, _me)
        bpy.context.scene.collection.objects.link(_ho)
        _ho.hide_render = True
        _ho.update_tag(); bpy.context.view_layer.update()
        _bvh_hulls[nm] = _BVH.FromObject(_ho, bpy.context.evaluated_depsgraph_get(), deform=True, cage=False)
        _wv = np.array([tuple(_ho.matrix_world @ v.co) for v in _me.vertices])
        print("hull %s n=%d |x-cx|=[%.1f,%.1f] y=[%.1f,%.1f] z=[%.1f,%.1f]" % (
            nm, len(_sel), float(np.abs(_wv[:, 0] - cx).min()) * 1000,
            float(np.abs(_wv[:, 0] - cx).max()) * 1000,
            float(_wv[:, 1].min()) * 1000, float(_wv[:, 1].max()) * 1000,
            float(_wv[:, 2].min()) * 1000, float(_wv[:, 2].max()) * 1000))
    # G2
    nan_ct = int(np.isnan(G).sum())
    pts_ok = bool(all(len(g) == 32 for g in G))
    seglens = np.linalg.norm(np.diff(G, axis=1), axis=2)
    g2short = int((seglens < 0.0025).sum())
    g2zero = int((seglens == 0.0).sum())
    # G4 inside R5 + min clearance. Garment sign trusted <=0.10m (far open-edge
    # flips are not inside); every raw-inside flag is verified by +-Y ray
    # enclosure against the same collider (open cloth near a rim reads
    # inside from the nearest triangle but is unenclosed).
    from mathutils import Vector as _V
    g4min = 1e9; ins = 0; raw_ins = 0
    gmin_col = "?"; gmin_z = 0.0; gmin_p = None
    ins_ph = Counter(); ins_z = Counter(); ins_ex = []
    ins_reg = Counter(); ins_x0 = []; ins_zs = []; ins_sd = []; dg4ex = []

    def _enclosed(bvh, p):
        h1, _, _, _ = bvh.ray_cast(_V((float(p[0]), float(p[1]), float(p[2]))), _V((0.0, 1.0, 0.0)), 0.5)
        if h1 is None:
            return False
        h2, _, _, _ = bvh.ray_cast(_V((float(p[0]), float(p[1]), float(p[2]))), _V((0.0, -1.0, 0.0)), 0.5)
        return h2 is not None

    for gi in range(n):
        for k, p in enumerate(G[gi]):
            ss = []
            for o in colliders:
                q, nn = nearest_pt(bvhs[o.name], p)
                if q is None:
                    continue
                sd = sdist(p, q, nn)
                if abs(sd) < g4min:
                    g4min = abs(sd); gmin_col = o.name; gmin_z = float(p[2]); gmin_p = np.array(p)
                if sd >= 0:
                    continue
                if o is not body and abs(sd) > 0.10:
                    continue
                raw_ins += 1
                if _enclosed(bvhs[o.name], p):
                    ss.append((sd, o.name))
            if ss:
                ins += 1; ins_ph[int(RPH[gi, k])] += 1
                ins_z["above" if float(p[2]) >= menton else "below"] += 1
                ins_reg[chains[gi][3]] += 1
                ins_x0.append(float(abs(float(p[0]) - cx)))
                ins_sd.append(float(min(ss)[0]) * 1000.0)
                if len(dg4ex) < 12:
                    dg4ex.append(gi)
                    print("DG-G4 gi=%d reg=%s drape=%s ph=%d p=%s sd=%.2f %s" % (
                        gi, chains[gi][3], chains[gi][7], int(RPH[gi, k]),
                        np.round(p * 1000, 1).tolist(), float(min(ss)[0]) * 1000.0, min(ss)[1]))
                if len(ins_zs) < 4000:
                    ins_zs.append(float(p[2]))
    print("G4 inside=%d (raw=%d) min=%.2fmm[%s z=%.1f p=%s] phase=%s z=%s reg=%s ex=%s" % (
        ins, raw_ins, g4min * 1000, gmin_col, gmin_z * 1000,
        np.round(gmin_p * 1000, 1).tolist() if gmin_p is not None else None,
        dict(ins_ph), dict(ins_z), dict(ins_reg), ins_ex))
    if ins_zs:
        _iz = np.array(ins_zs)
        print("G4 inside zmin=%.1f zmax=%.1f zmed=%.1f |x|max=%.1f" % (
            _iz.min() * 1000, _iz.max() * 1000, np.median(_iz) * 1000, max(ins_x0) * 1000))
    if ins_sd:
        _is = np.array(ins_sd)
        print("G4 inside-sd p50=%.2f p95=%.2f max=%.2fmm" % (
            float(np.percentile(-_is, 50)), float(np.percentile(-_is, 95)), float((-_is).max())))
    g4deep = float((-np.array(ins_sd)).max()) if ins_sd else 0.0
    print("G4 deep=%.2fmm (bar <=1.0)" % g4deep)
    if bool(getattr(aa, "diag_only", False)):
        _dg = 0
        for gi in range(n):
            if _dg >= 10:
                break
            for k, p in enumerate(G[gi]):
                if _dg >= 10:
                    break
                qq, nn = nearest_pt(bvhs[colliders[0].name], p)
                sh = None
                for o in colliders[1:]:
                    q2, n2 = nearest_pt(bvhs[o.name], p)
                    if q2 is None:
                        continue
                    if sdist(p, q2, n2) < 0:
                        sh = (o.name, round(float(sdist(p, q2, n2)) * 1000, 2))
                if qq is None:
                    continue
                if sdist(p, qq, nn) < 0 or sh is not None:
                    yb = _yb_lookup12(Yb, xg, zg, float(p[0]), float(p[2]))
                    xsl = _xs_lookup12(Xs, yg, zsg, float(p[1]), float(p[2]))
                    ix = int(np.argmin(np.abs(xg - float(p[0]))))
                    col = ZT[:, ix]
                    m = col >= (float(p[2]) - 0.004)
                    yc = (round(float(yg[m].max()) * 1000, 1) if bool(m.any()) else "inf")
                    print("DG-IN gi=%d k=%d ph=%d p=%s sdh=%.2f shirt=%s Yb=%s Yc=%s Xs=%s" % (
                        gi, k, int(RPH[gi, k]), np.round(p * 1000, 1).tolist(),
                        round(float(sdist(p, qq, nn)) * 1000, 2), sh,
                        (round(float(yb) * 1000, 1) if np.isfinite(yb) else "inf"), yc,
                        (round(float(xsl) * 1000, 1) if np.isfinite(xsl) else "inf")))
                    _dg += 1
        _df = 0
        for gi in range(n):
            if _df >= 10:
                break
            for kk, p in enumerate(G[gi]):
                if _df >= 10:
                    break
                q, nn = nearest_pt(bvhs[body.name], p)
                if q is None:
                    continue
                if brow_z < float(q[2]) < hairline_z and sdist(p, q, nn) > 0 and float(p[1]) < float(q[1]) - 0.001 and float(nn[1]) < -0.35:
                    print("DG-FORE gi=%d k=%d ph=%d p=%s q=%s sd=%.2f" % (gi, kk, int(RPH[gi, kk]), np.round(p * 1000, 1).tolist(),
                          np.round(np.array(q) * 1000, 1).tolist(), round(float(sdist(p, q, nn)) * 1000, 2)))
                    _df += 1
                    break
        _rs = [(gi, k, r) for gi in range(n) for k, r in enumerate(turn_rates(G[gi])[0])]
        _rs.sort(key=lambda t: -t[2])
        for gi, k, r in _rs[:10]:
            print("DG-TURN gi=%d k=%d rate=%.1f ph=%d z=%.1f" % (gi, k, r, int(RPH[gi, k + 1]), float(G[gi, k + 1, 2]) * 1000))
        _hist = Counter()
        for gi in range(n):
            rr, _aa = turn_rates(G[gi])
            jn = next((k for k in range(31) if RPH[gi, k] == 0 and RPH[gi, k + 1] == 1), -1)
            for k, r in enumerate(rr):
                ph = "s0" if int(RPH[gi, k + 1]) == 0 else "s1"
                jx = "J" if 0 <= k - jn <= 1 else "-"
                bb = "lo" if r < 8 else ("mid" if r < 30 else "hi")
                _hist[(ph, jx, bb)] += 1
        print("DG-HIST %s" % dict(_hist))
        _sl = [(gi, int(np.argmin(np.linalg.norm(np.diff(G[gi], axis=0), axis=1))), float(np.linalg.norm(np.diff(G[gi], axis=0), axis=1).min() * 1000)) for gi in range(n)]
        _sl.sort(key=lambda t: t[2])
        for gi, k, m in _sl[:5]:
            print("DG-SEG gi=%d k=%d minseg=%.2fmm L=%.1fmm" % (gi, k, m, float(np.linalg.norm(np.diff(G[gi], axis=0), axis=1).sum() * 1000)))
    # G3 behind shoulder via Yb + shirt top/front
    _shirt = next(o for o in cols if "toigo_t_shirt" in o.name.lower())
    _SW = np.array([tuple(_shirt.matrix_world @ v.co) for v in _shirt.data.vertices])
    _xbins = np.arange(-0.20, 0.201, 0.010)
    _stop, _sfront = {}, {}
    for _bi in range(len(_xbins) - 1):
        _sel = _SW[(np.abs(_SW[:, 0] - cx - (_xbins[_bi] + 0.005)) <= 0.005)]
        if len(_sel) < 3:
            continue
        _top = float(_sel[:, 2].max())
        _cap = _sel[_sel[:, 2] > _top - 0.060]
        if len(_cap) < 3:
            continue
        _stop[_bi] = _top; _sfront[_bi] = float(_cap[:, 1].min())
    g3viol = 0; g3tot = 0; g3front = 0
    for gi in range(n):
        for p in G[gi]:
            _bi = int(np.searchsorted(_xbins, float(p[0]) - cx, side="right")) - 1
            if _bi not in _stop:
                continue
            if float(p[2]) >= _stop[_bi]:
                continue
            g3tot += 1
            yb = _yb_lookup12(Yb, xg, zg, float(p[0]), float(p[2]))
            if np.isfinite(yb) and float(p[1]) < yb + 0.002:
                g3viol += 1
            if float(p[1]) < _sfront[_bi]:
                g3front += 1
    print("G3 below-top=%d behind-viol=%d front-of-shoulder=%d" % (g3tot, g3viol, g3front))
    # G5 face + forehead (guides11-exact)
    g5face = 0
    for gi in range(n):
        for p in G[gi]:
            if abs(float(p[0]) - cx) <= _canth and menton <= float(p[2]) <= brow_z:
                yf = _depth.get((round(float(p[0]) / 0.005), round(float(p[2]) / 0.005)), None)
                if yf is not None and float(p[1]) < yf - 0.002:
                    g5face += 1
    g5fore = 0; g5fore_raw = 0
    g5fore_ph = Counter(); g5fore_zs = []
    for gi in range(n):
        for k, p in enumerate(G[gi]):
            q, nn = nearest_pt(bvhs[body.name], p)
            if q is None:
                continue
            if brow_z < float(q[2]) < hairline_z and sdist(p, q, nn) > 0 and float(p[1]) < float(q[1]) - 0.001:
                g5fore_raw += 1
                if float(p[2]) <= hairline_z - 0.010 and float(nn[1]) < -0.35:
                    g5fore += 1
                    g5fore_ph[int(RPH[gi, k])] += 1
                    g5fore_zs.append(float(p[2]))
    print("G8/X5 face=%d forehead=%d (raw=%d) ph=%s" % (g5face, g5fore, g5fore_raw, dict(g5fore_ph)))
    if g5fore_zs:
        _fz = np.array(g5fore_zs)
        print("G9 forehead zmin=%.1f zmax=%.1f" % (_fz.min() * 1000, _fz.max() * 1000))
    # G5 LIFT-OFF: median lift-off height of back strands (|azimuth from
    # straight back| < 60deg) + nape-cap-edge fraction.
    _az = np.degrees(np.arctan2(np.abs(LA[:, 0] - cx), LA[:, 1] - cyh))
    _back = _az < 60.0
    _lz = LA[_back][:, 2] if bool(_back.any()) else np.array([np.nan])
    g5med = float(np.median(_lz))
    _nape_edge = sum(1 for gi in range(n) if STPA[gi] == "edge" and chains[gi][3] == "nape")
    g5nape = float(_nape_edge) / max(n, 1)
    print("G5 liftoff backn=%d medz=%.1f (bar %.1f..%.1f) nape-edge=%d (%.4f)" % (
        int(_back.sum()), g5med * 1000, (crown - 0.15) * 1000, (crown - 0.06) * 1000, _nape_edge, g5nape))
    # G6 hull-inside: guide points inside the same-side ear hull.
    g6hull = 0
    g6hull_ph = Counter()
    for gi in range(n):
        _bvh = _bvh_hulls["L" if float(GR[gi][0]) < cx else "R"]
        for k, p in enumerate(G[gi]):
            qh = _bvh.find_nearest(Vector(tuple(p)))
            if qh[0] is None:
                continue
            if float((Vector(tuple(p)) - qh[0]).dot(qh[1])) < 0.0:
                g6hull += 1
                g6hull_ph[int(RPH[gi, k])] += 1
    print("G6 hull-inside=%d ph=%s" % (g6hull, dict(g6hull_ph)))
    if bool(getattr(aa, "diag_only", False)):
        _nd = 0
        for gi in range(n):
            if _nd >= 3:
                break
            if chains[gi][3] != "forehead_temple":
                continue
            if float(LA[gi][2]) < 1.595:
                continue
            print("DG-BEAM gi=%d drape=%s L=%s" % (
                gi, chains[gi][7], np.round(LA[gi] * 1000, 1).tolist()))
            for k, p in enumerate(G[gi][:10]):
                print("  k=%d ph=%d p=%s" % (k, int(RPH[gi, k]), np.round(p * 1000, 1).tolist()))
            _nd += 1
    # G7 NO ZIG-ZAG: sign changes of bend direction between consecutive
    # segment triples with |bend| > 10deg; guides with >= 2 alternations.
    zig_n = 0
    for gi in range(n):
        d = np.diff(G[gi], axis=0)
        dn = np.linalg.norm(d[:-1], axis=1) * np.linalg.norm(d[1:], axis=1) + 1e-12
        bend = np.degrees(np.arccos(np.clip((d[:-1] * d[1:]).sum(axis=1) / dn, -1, 1)))
        ax = np.cross(d[:-1], d[1:])
        ref = None; prev = 0; alt = 0
        for k in range(len(bend)):
            if bend[k] <= 10.0 or float(np.linalg.norm(ax[k])) < 1e-12:
                continue
            ak = ax[k] / float(np.linalg.norm(ax[k]))
            if ref is None:
                ref = ak; prev = 1; continue
            s = 1 if float(ak @ ref) >= 0 else -1
            if s != prev:
                alt += 1
            prev = s
        if alt >= 2:
            zig_n += 1
    rates = np.concatenate([turn_rates(g)[0] for g in G]) if n else np.array([0])
    g7p95, g7max = float(np.percentile(rates, 95)), float(rates.max())
    print("G7 zig=%d (%.4f) turn p95=%.2f max=%.2f" % (zig_n, float(zig_n) / max(n, 1), g7p95, g7max))
    if bool(getattr(aa, "diag_only", False)):
        _altloc = Counter()
        _zigc = Counter(); _zigph = Counter()
        for gi in range(n):
            d = np.diff(G[gi], axis=0)
            dn = np.linalg.norm(d[:-1], axis=1) * np.linalg.norm(d[1:], axis=1) + 1e-12
            bend = np.degrees(np.arccos(np.clip((d[:-1] * d[1:]).sum(axis=1) / dn, -1, 1)))
            ax = np.cross(d[:-1], d[1:])
            ref = None; prev = 0; alt = 0; phs = set()
            for k in range(len(bend)):
                if bend[k] <= 10.0 or float(np.linalg.norm(ax[k])) < 1e-12:
                    continue
                ak = ax[k] / float(np.linalg.norm(ax[k]))
                phs.add(int(RPH[gi, k + 1]))
                if ref is None:
                    ref = ak; prev = 1
                    continue
                s = 1 if float(ak @ ref) >= 0 else -1
                if s != prev:
                    _ph = "s0" if int(RPH[gi, k + 1]) == 0 else "s1"
                    _zb = "hi" if float(G[gi, k + 1, 2]) >= 1.50 else ("mid" if float(G[gi, k + 1, 2]) >= 1.40 else "lo")
                    _altloc[(_ph, _zb)] += 1
                    alt += 1
                prev = s
            if alt >= 2:
                _cb = "lo" if CA[gi] < 0.008 else ("mid" if CA[gi] < 0.014 else "hi")
                _zigc[_cb] += 1
                _zigph["s0" if phs == {0} else ("s1" if phs == {1} else "cross")] += 1
        print("DG-ALT %s" % dict(_altloc))
        print("DG-ZIGC %s DG-ZIGPH %s" % (dict(_zigc), dict(_zigph)))
    # G8 TRUE hem: tip z within 8mm of z_hem + jitter (3D, no mask).
    _nviol14 = 0
    for _gi in range(n):
        _D = np.diff(G[_gi], axis=0); _LL = np.linalg.norm(_D, axis=1)
        if not bool(((_LL > 0.012) & (np.abs(_D[:, 2]) < 0.002)).any()):
            continue
        _nviol14 += 1
        if _nviol14 <= 40:
            _dg14 = chains[_gi][9] or []
            _sp = _dg14[0]["spans"] if _dg14 else []
            _mx = max(_sp, key=lambda t: abs(t[1])) if _sp else (0, 0, 0)
            print("DG-HORIZ gi=%d reg=%s stop=%s drape=%s L=%s x0=%.1f c=%.1f nsup=%d first=%s maxdy=%s" % (
                _gi, chains[_gi][3], STPA[_gi], chains[_gi][7],
                np.round(LA[_gi] * 1000, 1).tolist(), chains[_gi][8] * 1000, chains[_gi][5] * 1000,
                (_dg14[0]["nsup"] if _dg14 else -1),
                (_sp[0] if _sp else None), _mx))
    print("DG-HORIZ viol=%d" % _nviol14)
    tipz = G[:, -1, 2]
    _ztarg = np.array([float(zhem) + _jit12(float(LA[gi][0]), float(LA[gi][1]), float(LA[gi][2]), cx) for gi in range(n)])
    g8bad = int((np.abs(tipz - _ztarg) > 0.008).sum())
    print("G8 hem bad=%d/%d tipstd=%.2fmm" % (g8bad, n, float(tipz.std()) * 1000.0))

    def x_at_z13(g, z):
        zz = g[:, 2]
        if float(zz.min()) > z or float(zz.max()) < z:
            return None
        for k in range(1, len(g)):
            if (zz[k - 1] - z) * (zz[k] - z) <= 0.0 and abs(zz[k] - zz[k - 1]) > 1e-12:
                f = (z - zz[k - 1]) / (zz[k] - zz[k - 1])
                return float(g[k - 1][0] * (1 - f) + g[k][0] * f)
        return None

    # X1 profile front-edge angle temple-vs-shoulder (TS 21.4deg)
    tband = [float(p[1]) for gi in range(n) for p in G[gi] if ear_top - 0.005 <= float(p[2]) <= ear_top + 0.015]
    sband = [float(p[1]) for gi in range(n) for p in G[gi] if zhem - 0.02 <= float(p[2]) <= zhem + 0.06]
    y_t = min(tband) if tband else float("nan")
    y_s = min(sband) if sband else float("nan")
    z_t = float(ear_top) + 0.005; z_s = float(zhem) + 0.02
    x1ang = float(np.degrees(np.arctan2(y_s - y_t, z_t - z_s))) if sband and tband else float("nan")
    # X1 sheet depth behind the nape at z = menton_z
    _yneck_back = _yb_lookup12(Yb, xg, zg, cx, menton)
    _mh = [float(p[1]) for gi in range(n) for p in G[gi] if abs(float(p[2]) - menton) <= 0.005]
    x1depth = float(max(_mh) - _yneck_back) if (_mh and np.isfinite(_yneck_back)) else float("nan")
    print("X1 angle=%.1f (TS 21.4) depth=%.1fmm (%.3fhh)" % (x1ang, x1depth * 1000, x1depth / 0.2107))
    # X2 back width ratio at shoulder row (TS 1.26, report only)
    hsel = W[np.abs(W[:, 2] - (ear_top - 0.015)) <= 0.0025]
    head_hw = float(np.abs(hsel[:, 0] - cx).max()) if len(hsel) else float("nan")
    z_sh = 1.38
    xs_sh = [x_at_z13(g, z_sh) for g in G]
    xs_sh = [abs(float(x) - cx) for x in xs_sh if x is not None]
    sheet_hw = float(max(xs_sh)) if xs_sh else float("nan")
    x2ratio = float(sheet_hw / head_hw) if head_hw else float("nan")
    print("X2 ratio=%.3f (TS 1.26) head_hw=%.1fmm sheet_hw=%.1fmm" % (x2ratio, head_hw * 1000, sheet_hw * 1000))
    # X3 front: outer half-width at ear row + per-side face half-gap at eye row
    _zear = float(ear_top) - 0.015
    xs_ear = [x_at_z13(g, _zear) for g in G]
    xs_ear = [abs(float(x) - cx) for x in xs_ear if x is not None]
    x3outer_hh = float(max(xs_ear)) / 0.2107 if xs_ear else float("nan")
    _zeye = 0.5 * (float(brow_z) + float(nasion_z))
    _gL = [abs(float(x) - cx) for gi, g in enumerate(G) for x in [x_at_z13(g, _zeye)]
           if x is not None and float(x) < cx]
    _gR = [abs(float(x) - cx) for gi, g in enumerate(G) for x in [x_at_z13(g, _zeye)]
           if x is not None and float(x) >= cx]
    x3gapL_hh = float(min(_gL)) / 0.2107 if _gL else float("nan")
    x3gapR_hh = float(min(_gR)) / 0.2107 if _gR else float("nan")
    print("X3 outer-ear=%.3fhh gapL=%.4f gapR=%.4f (TS 0.2266/0.2100)" % (x3outer_hh, x3gapL_hh, x3gapR_hh))
    np.savez(out / (STEM + ".npz"), points=G, roots=GR, phases=RPH, liftoff=LA,
             clearance=CA, stops=np.array(STPA),
             z_hem=np.array(zhem), menton_z=np.array(menton), crown_z=np.array(crown),
             dropped=int(n_roots - n))
    print("WROTE", out / (STEM + ".npz"))
    if bool(getattr(aa, "diag_only", False)):
        print("DIAG G1 p95=%.4f max=%.4f | G2 n=%d/%d short=%d zero=%d nan=%d | G3 viol=%d front=%d tot=%d | G4 ins=%d min=%.2f | G5 med=%.1f nape=%.4f | G6 hull=%d | G7 zig=%d p95=%.2f max=%.2f | G8 bad=%d | G9 face=%d fore=%d" % (
            (mir or {}).get("p95_mm", 999.0), (mir or {}).get("max_mm", 999.0), n, n_roots, g2short, g2zero, nan_ct,
            g3viol, g3front, g3tot, ins, g4min * 1000, g5med * 1000, g5nape, g6hull,
            zig_n, g7p95, g7max, g8bad, g5face, g5fore))
        return
    _render13(out, h, body, STEM, G, RPH, GR, LA, CA, STPA, W, crown, cx, cyh, medy, menton, brow_z, nasion_z,
              ear_y, ear_top, hairline_z, zhem, _canth, _depth, bvhs, colliders, cols, MIRROR, mir, n_roots, nan_ct,
              pts_ok, g2short, g2zero, ins, g4min, g3viol, g3front, g3tot, g5face, g5fore, g5med, g5nape,
              g6hull, zig_n, g7p95, g7max, g8bad, x1ang, x1depth, x2ratio, x3outer_hh, x3gapL_hh, x3gapR_hh,
              tipz, dict(ra), dict(drop_face), regs, _flo, g4deep)


def _render13(out, h, body, STEM, G, RPH, GR, LA, CA, STPA, W, crown, cx, cyh, medy, menton, brow_z,
               nasion_z, ear_y, ear_top, hairline_z, zhem, _canth, _depth, bvhs, colliders, cols, MIRROR, mir,
               n_roots, nan_ct, pts_ok, g2short, g2zero, ins, g4min, g3viol, g3front, g3tot, g5face, g5fore,
               g5med, g5nape, g6hull, zig_n, g7p95, g7max, g8bad, x1ang, x1depth, x2ratio, x3outer_hh,
               x3gapL_hh, x3gapR_hh, tipz, regs, dropface, p2regs, g5front, g4deep):
    import json as _json
    from collections import Counter as _Counter13
    import bpy_extras.object_utils as OU
    from mathutils import Vector
    from PIL import Image, ImageDraw
    n = len(G)
    h.hair.hide_render = h.hair.hide_viewport = True
    bpy.context.scene.view_settings.view_transform = "Standard"
    # two-colour tubes: scalp phase cyan, string phase magenta (1mm)
    curves = []
    for ci, cc4 in enumerate([(0.0, 1.0, 1.0, 1.0), (1.0, 0.0, 1.0, 1.0)]):
        cu = bpy.data.curves.new("OCLX_g12_%d" % ci, "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.001
        om = bpy.data.materials.new("OCLX_g12m_%d" % ci); om.use_nodes = True
        nt = om.node_tree; nt.nodes.clear()
        mout = nt.nodes.new("ShaderNodeOutputMaterial")
        em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = cc4; em.inputs["Strength"].default_value = 0.6
        nt.links.new(em.outputs[0], mout.inputs[0])
        cu.materials.append(om)
        to = bpy.data.objects.new("OCLX_g12_%d" % ci, cu)
        bpy.context.scene.collection.objects.link(to)
        curves.append((cu, to))
    for gi in range(n):
        g = G[gi]; ph = RPH[gi]
        for want in (0, 1):
            idx = np.where(ph == want)[0]
            if len(idx) < 2:
                continue
            runs = np.split(idx, np.where(np.diff(idx) > 1)[0] + 1)
            for run in runs:
                if len(run) < 2:
                    continue
                sp = curves[want][0].splines.new("POLY"); sp.points.add(len(run) - 1)
                for kk, j in enumerate(run):
                    p = g[j]
                    sp.points[kk].co = (float(p[0]), float(p[1]), float(p[2]), 1.0)
                sp.material_index = 0
    for _, to in curves:
        to.update_tag()
    # lift-off points as yellow dots: one octahedron (r=2.5mm) per L
    _rr = 0.0025
    _dv, _df = [], []
    for Li in LA:
        _b = len(_dv)
        _dv += [(float(Li[0]) + _rr, float(Li[1]), float(Li[2])),
                (float(Li[0]) - _rr, float(Li[1]), float(Li[2])),
                (float(Li[0]), float(Li[1]) + _rr, float(Li[2])),
                (float(Li[0]), float(Li[1]) - _rr, float(Li[2])),
                (float(Li[0]), float(Li[1]), float(Li[2]) + _rr),
                (float(Li[0]), float(Li[1]), float(Li[2]) - _rr)]
        _df += [(_b, _b + 2, _b + 4), (_b + 2, _b + 1, _b + 4), (_b + 1, _b + 3, _b + 4),
                (_b + 3, _b, _b + 4), (_b + 2, _b, _b + 5), (_b + 1, _b + 2, _b + 5),
                (_b + 3, _b + 1, _b + 5), (_b, _b + 3, _b + 5)]
    _dm = bpy.data.meshes.new("OCLX_g13_dots_mesh")
    _dm.from_pydata(_dv, [], _df); _dm.update()
    _om = bpy.data.materials.new("OCLX_g13_dots_mat"); _om.use_nodes = True
    _nt = _om.node_tree; _nt.nodes.clear()
    _mout = _nt.nodes.new("ShaderNodeOutputMaterial")
    _em = _nt.nodes.new("ShaderNodeEmission")
    _em.inputs["Color"].default_value = (1.0, 1.0, 0.0, 1.0); _em.inputs["Strength"].default_value = 0.8
    _nt.links.new(_em.outputs[0], _mout.inputs[0])
    _dm.materials.append(_om)
    _doto = bpy.data.objects.new("OCLX_g13_dots", _dm)
    bpy.context.scene.collection.objects.link(_doto)
    _doto.update_tag()
    bpy.context.view_layer.update()
    sc = bpy.context.scene; sc.render.resolution_x = sc.render.resolution_y = 1024
    sc.cycles.samples = 32; sc.cycles.seed = 0
    cam = h.camera; tgt = Vector((cx, float(np.median(W[:, 1])), menton + 0.06)); dist = 0.85

    def track(o, t):
        o.rotation_euler = (Vector(t) - o.location).to_track_quat("-Z", "Y").to_euler()

    views = [("front", tgt + Vector((0, -dist, 0.02))), ("three_quarter", tgt + Vector((dist * 0.68, -dist * 0.68, 0.14))),
             ("profileL", tgt + Vector((-dist, 0, 0.02))), ("profileR", tgt + Vector((dist, 0, 0.02))),
             ("back", tgt + Vector((0, dist, 0.08))), ("top", tgt + Vector((0, -0.10, dist)))]
    for name, loc in views:
        cam.location = tuple(loc); track(cam, tgt)
        sc.render.filepath = str(out / ((STEM + "_%s.png") % name)); bpy.ops.render.render(write_still=True)
    cells = [Image.open(out / ((STEM + "_%s.png") % v)).convert("RGB") for v, _ in views]
    Wd, Hd = cells[0].size; lab = 36
    sheet = Image.new("RGB", (Wd * 6, Hd + lab), (20, 20, 20)); dr = ImageDraw.Draw(sheet)
    for k, (v, _) in enumerate(views):
        sheet.paste(cells[k], (k * Wd, lab)); dr.text((k * Wd + 10, 10), v, fill=(0, 255, 255))
    sheet.save(out / (STEM + "-debug.png"))
    print("WROTE", out / (STEM + "-debug.png"))
    # masks: guides-only white tubes, body VISIBLE black occluder
    hid = {o.name: (o.hide_render, o.hide_viewport) for o in bpy.data.objects}
    for _, to in curves:
        pass
    cuw = bpy.data.curves.new("OCLX_g12w", "CURVE"); cuw.dimensions = "3D"; cuw.bevel_depth = 0.001
    for gi in range(n):
        sp = cuw.splines.new("POLY"); sp.points.add(31)
        for k, p in enumerate(G[gi]):
            sp.points[k].co = (float(p[0]), float(p[1]), float(p[2]), 1.0)
    tow = bpy.data.objects.new("OCLX_g12w", cuw)
    bpy.context.scene.collection.objects.link(tow)
    bodymats = list(body.data.materials)

    def render_mask(view_loc, path, bevel=0.001):
        for o in bpy.data.objects:
            if o is tow or o is body:
                o.hide_render = o.hide_viewport = False
            else:
                o.hide_render = o.hide_viewport = True
        cuw.bevel_depth = bevel
        bpy.context.view_layer.update()
        wm = bpy.data.materials.new("OCLX_mw"); wm.use_nodes = True
        wnt = wm.node_tree; wnt.nodes.clear()
        wout = wnt.nodes.new("ShaderNodeOutputMaterial")
        wem = wnt.nodes.new("ShaderNodeEmission"); wem.inputs["Color"].default_value = (1, 1, 1, 1); wem.inputs["Strength"].default_value = 1.0
        wnt.links.new(wem.outputs[0], wout.inputs[0])
        cuw.materials.clear(); cuw.materials.append(wm)
        bm = bpy.data.materials.new("OCLX_mb"); bm.use_nodes = True
        bnt = bm.node_tree; bnt.nodes.clear()
        bout = bnt.nodes.new("ShaderNodeOutputMaterial")
        bem = bnt.nodes.new("ShaderNodeEmission"); bem.inputs["Color"].default_value = (0, 0, 0, 1); bem.inputs["Strength"].default_value = 0.0
        bnt.links.new(bem.outputs[0], bout.inputs[0])
        body.data.materials.clear(); body.data.materials.append(bm)
        old_world = sc.world
        bw = bpy.data.worlds.new("OCLX_bw"); bw.use_nodes = True
        bw.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
        bw.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
        sc.world = bw
        sc.render.film_transparent = False
        cam.location = tuple(view_loc); track(cam, tgt)
        sc.render.filepath = str(path); bpy.ops.render.render(write_still=True)
        sc.world = old_world
        cuw.materials.clear()
        body.data.materials.clear()
        for mm in bodymats:
            body.data.materials.append(mm)
        for dd in (wm, bm, bw):
            try:
                bpy.data.materials.remove(dd)
            except Exception:
                try:
                    bpy.data.worlds.remove(dd)
                except Exception:
                    pass

    try:
        profL_loc = tgt + Vector((-dist, 0, 0.02))
        profR_loc = tgt + Vector((dist, 0, 0.02))
        sc.cycles.samples = 16
        render_mask(profL_loc, out / (STEM + "-proxyL-mask.png"), bevel=0.003)
        render_mask(profR_loc, out / (STEM + "-proxyR-mask.png"), bevel=0.003)
        render_mask(tgt + Vector((0, -dist, 0.02)), out / (STEM + "-front-mask.png"), bevel=0.003)
        render_mask(tgt + Vector((0, dist, 0.08)), out / (STEM + "-back-mask.png"), bevel=0.003)
        sc.cycles.samples = 32
    finally:
        for on, (hr, hv) in hid.items():
            o = bpy.data.objects.get(on)
            if o:
                o.hide_render, o.hide_viewport = hr, hv
    # G6 EAR COVER per side on guides-only 3mm profile masks: pinna bbox covered
    g6cov = {}
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
            g6cov[nm] = {"n": 0, "frac": 0.0}; continue
        pr = []; pc = []
        for p in pin:
            v = OU.world_to_camera_view(sc, cam, Vector(tuple(p)))
            pr.append(int((1 - v.y) * PHr)); pc.append(int(v.x * PWr))
        rmin, rmax = max(min(pr), 0), min(max(pr), PHr - 1)
        cmin, cmax = max(min(pc), 0), min(max(pc), PWr - 1)
        area = max((rmax - rmin + 1) * (cmax - cmin + 1), 1)
        fr = float((pmimg[rmin:rmax + 1, cmin:cmax + 1] > 128).sum() / area)
        g6cov[nm] = {"n": int(len(pin)), "frac": fr}
        print("G6 %s pinna n=%d cover=%.3f" % (nm, len(pin), fr))
    # G8 FACE GAP on the guides front mask: inner curtain edge at the eye row.
    gapL_hh = gapR_hh = float("nan")
    fmimg = np.asarray(Image.open(out / (STEM + "-front-mask.png")).convert("L"))
    PHf, PWf = fmimg.shape
    cam.location = tuple(tgt + Vector((0, -dist, 0.02))); track(cam, tgt)
    bpy.context.view_layer.update()

    def _rc14(pp):
        v = OU.world_to_camera_view(sc, cam, Vector(tuple(pp)))
        return int((1 - v.y) * PHf), int(v.x * PWf)
    z_eye14 = 0.5 * (float(brow_z) + float(nasion_z))
    r_eye14, c_cen14 = _rc14((cx, 0.0, z_eye14))
    r_crown14, _ = _rc14((cx, 0.0, float(crown)))
    r_chin14, _ = _rc14((cx, 0.0, float(menton)))
    Hpx14 = max(abs(r_chin14 - r_crown14), 1)
    if 0 <= r_eye14 < PHf:
        _row = fmimg[r_eye14] > 128
        _left = np.where(_row[:c_cen14])[0]
        _right = np.where(_row[c_cen14:])[0]
        if len(_left):
            gapL_hh = float(c_cen14 - int(_left.max())) / float(Hpx14)
        if len(_right):
            gapR_hh = float(int(_right.min())) / float(Hpx14)
    print("G8 gapL=%.4f gapR=%.4f H (TS 0.2266/0.2100, need >=0.85x)" % (gapL_hh, gapR_hh))
    # G6 BACK FILL on the guides-only 3mm back mask between lift-off band & hem.
    bmimg = np.asarray(Image.open(out / (STEM + "-back-mask.png")).convert("L"))
    PHb, PWb = bmimg.shape
    cam.location = tuple(tgt + Vector((0, dist, 0.08))); track(cam, tgt)
    bpy.context.view_layer.update()

    def _rcb14(pp):
        v = OU.world_to_camera_view(sc, cam, Vector(tuple(pp)))
        return int((1 - v.y) * PHb), int(v.x * PWb)
    z_top14 = float(LA[:, 2].min())
    r_top14, _ = _rcb14((cx, 0.0, z_top14))
    r_hem14, _ = _rcb14((cx, 0.0, float(zhem)))
    r_top14, r_hem14 = max(min(r_top14, r_hem14), 0), min(max(r_top14, r_hem14), PHb - 1)
    band14 = bmimg[r_top14:r_hem14 + 1] > 128
    cols14 = np.where(band14.any(axis=0))[0]
    if len(cols14) >= 9:
        _c0, _c1 = int(cols14.min()), int(cols14.max())
        _wdt = _c1 - _c0 + 1
        _t1 = _c0 + _wdt // 3; _t2 = _c0 + 2 * _wdt // 3
        covL = float(band14[:, _c0:_t1].sum() / max(band14[:, _c0:_t1].size, 1))
        covC = float(band14[:, _t1:_t2].sum() / max(band14[:, _t1:_t2].size, 1))
        covR = float(band14[:, _t2:_c1 + 1].sum() / max(band14[:, _t2:_c1 + 1].size, 1))
        _outer14 = 0.5 * (covL + covR)
        backfill14 = float(covC / _outer14) if _outer14 > 0 else 0.0
    else:
        covL = covC = covR = backfill14 = 0.0
    print("G6 backfill L=%.3f C=%.3f R=%.3f ratio=%.3f (need >=0.90)" % (covL, covC, covR, backfill14))
    # G6 horizontal travel after lift-off (back strands keep x = L.x).
    _trav14 = np.abs(G[:, -1, 0] - LA[:, 0])
    _backm14 = np.abs(LA[:, 0] - cx) < 0.045
    trav_viol14 = int(((_trav14 > 0.015) & _backm14).sum())
    trav_max14 = float(_trav14[_backm14].max() * 1000.0) if bool(_backm14.any()) else 0.0
    print("G6 travel viol=%d max=%.2fmm (need 0 over 15mm)" % (trav_viol14, trav_max14))
    # G7 NO HORIZONTAL RUNS on the final 32-pt guides.
    horiz14 = 0
    for _gi in range(n):
        _d = np.diff(G[_gi], axis=0)
        _L = np.linalg.norm(_d, axis=1)
        if bool(((_L > 0.012) & (np.abs(_d[:, 2]) < 0.002)).any()):
            horiz14 += 1
    print("G7 horizontal guides=%d/%d (need 0)" % (horiz14, n))
    # target-vs sheet: TS | ours x4 views, each panel 1024px
    TS = "/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back/target-%s.png"
    pairs = [("front", STEM + "_front.png"), ("three_quarter", STEM + "_three_quarter.png"),
             ("profile", STEM + "_profileL.png"), ("back", STEM + "_back.png")]
    tsc = [Image.open(TS % v).convert("RGB") for v, _ in pairs]
    orc = [Image.open(out / o).convert("RGB") for _, o in pairs]
    _w, _h = tsc[0].size
    orc = [im.resize((_w, _h)) for im in orc]
    sh = Image.new("RGB", (_w * 8, _h + lab), (20, 20, 20)); dd = ImageDraw.Draw(sh)
    for k, ((v, _), t, o) in enumerate(zip(pairs, tsc, orc)):
        sh.paste(t, (k * 2 * _w, lab)); sh.paste(o, ((k * 2 + 1) * _w, lab))
        dd.text((k * 2 * _w + 10, 10), "TS " + v, fill=(255, 255, 255))
        dd.text(((k * 2 + 1) * _w + 10, 10), "ours " + v, fill=(0, 255, 255))
    sh.save(out / "target-vs-guides14.png")
    print("WROTE", out / "target-vs-guides14.png")
    kept = (n >= 0.95 * n_roots)
    g1 = mir if mir is not None else {"p95_mm": 999.0, "max_mm": 999.0}
    zig_frac = float(zig_n) / max(n, 1)
    tipstd = float(tipz.std()) * 1000.0
    gates = [
        ("G1", "p95=%.4f max=%.4f" % (g1["p95_mm"], g1["max_mm"]), "mirror path p95<=0.5mm max<=2mm",
         g1["p95_mm"] <= 0.5 and g1["max_mm"] <= 2.0),
        ("G2", "n=%d roots=%d pts32=%s nan=%d short=%d zero=%d" % (n, n_roots, pts_ok, nan_ct, g2short, g2zero),
         "guides>=95% roots and 32pts and 0NaN and 0 segs<2.5mm and 0 zero-length",
         kept and pts_ok and nan_ct == 0 and g2short == 0 and g2zero == 0),
        ("G3", "behind-viol=%d front=%d tot=%d" % (g3viol, g3front, g3tot),
         "0 pts in front of back surface below shoulder top and 0 in front of shoulder",
         g3viol == 0 and g3front == 0),
        ("G4", "inside=%d deep=%.2fmm min=%.2fmm" % (ins, g4deep, g4min * 1000),
         "inside<=5 and none deeper than 1mm",
         ins <= 5 and g4deep <= 1.0),
        ("G5", "medz=%.1fmm nape=%.4f frontlo=%d" % (g5med * 1000, g5nape, g5front),
         "nape-edge<=10% and non-sideburn front liftoff=0",
         g5nape <= 0.10 and g5front == 0),
        ("G6", "fill=%.3f (L%.3f C%.3f R%.3f) travel_viol=%d hull=%d" % (
            backfill14, covL, covC, covR, trav_viol14, g6hull),
         "central>=0.90xouter and |x(tip)-x(L)|<=15mm for liftoff|x|<45mm (100%)",
         backfill14 >= 0.90 and trav_viol14 == 0),
        ("G7", "horiz=%d/%d" % (horiz14, n),
         "no segment >12mm with |dz|<2mm in any guide",
         horiz14 == 0),
        ("G8", "coverL=%.3f coverR=%.3f gapL=%.4f gapR=%.4f face=%d" % (
            g6cov["L"]["frac"], g6cov["R"]["frac"], gapL_hh, gapR_hh, g5face),
         "cover>=0.90 both and gap>=0.85xTS (0.2266/0.2100) and 0 face-front pts",
         g6cov["L"]["frac"] >= 0.90 and g6cov["R"]["frac"] >= 0.90
         and gapL_hh >= 0.85 * 0.2266 and gapR_hh >= 0.85 * 0.2100 and g5face == 0),
        ("G9", "hembad=%d/%d tipstd=%.2fmm" % (g8bad, n, tipstd),
         "tip z within 8mm of z_hem+jitter for 100% of non-dropped guides",
         g8bad == 0),
    ]
    for g, m, b, ok in gates:
        print("%s %s | %s %s" % (g, m, b, "PASS" if ok else "MISS"))
    stats = {"cell": "B", "stem": STEM, "brief": "hair-guides-14",
             "gates": [{"gate": g, "measured": m, "bar": b, "verdict": "PASS" if ok else "MISS"} for g, m, b, ok in gates],
             "z_hem": float(zhem), "menton_z": float(menton), "crown_z": float(crown),
             "brow_z": float(brow_z), "nasion_z": float(nasion_z),
             "count": int(n), "n_roots": int(n_roots), "dropped": int(n_roots - n),
             "drop_face": dropface, "regs": regs,
             "stops": {k: int(v) for k, v in _Counter13(STPA).items()},
             "p2": {k: int(v) for k, v in p2regs.items()},
             "c_mm": {"min": float(CA.min() * 1000), "p50": float(np.median(CA) * 1000),
                      "max": float(CA.max() * 1000)},
             "g1": mir, "g2": {"short": int(g2short), "zero": int(g2zero), "nan": int(nan_ct), "pts32": bool(pts_ok)},
             "g3": {"behind_viol": int(g3viol), "front": int(g3front), "tot": int(g3tot)},
             "g4": {"inside": int(ins), "deep_mm": float(g4deep), "min_mm": float(g4min * 1000)},
             "g5": {"liftoff_med_z": float(g5med), "nape_edge_frac": float(g5nape), "front_lo": int(g5front)},
             "g6": {"cover": {k: float(v["frac"]) for k, v in g6cov.items()}, "hull_inside": int(g6hull),
                    "backfill_ratio": float(backfill14),
                    "backfill_cov": [float(covL), float(covC), float(covR)],
                    "travel_viol": int(trav_viol14), "travel_max_mm": float(trav_max14)},
             "g7": {"horiz": int(horiz14), "zig": int(zig_n), "zig_frac": float(zig_frac),
                    "p95": float(g7p95), "max": float(g7max)},
             "g8": {"cover": {k: float(v["frac"]) for k, v in g6cov.items()},
                    "gapL_hh": (None if not np.isfinite(gapL_hh) else float(gapL_hh)),
                    "gapR_hh": (None if not np.isfinite(gapR_hh) else float(gapR_hh)),
                    "gapL_ts": 0.2266, "gapR_ts": 0.2100, "face": int(g5face)},
             "g9": {"hem_bad": int(g8bad), "tipstd_mm": float(tipstd)},
             "x4": {"turn_p95": float(g7p95), "turn_max": float(g7max), "zig_frac": float(zig_frac)},
             "x5": {"forehead": int(g5fore)},
             "x1": {"angle_ours": float(x1ang), "angle_ts": 21.4,
                    "depth_mm": float(x1depth * 1000), "depth_hh": float(x1depth / 0.2107)},
             "x2": {"ratio_ours": float(x2ratio), "ratio_ts": 1.26},
             "x3": {"outer_ear_hh": float(x3outer_hh),
                    "gapL_hh": float(x3gapL_hh), "gapR_hh": float(x3gapR_hh),
                    "gapL_ts": 0.2266, "gapR_ts": 0.2100}}
    (out / "row-guides14.json").write_text(_json.dumps(stats, indent=1))
    print("WROTE", out / "row-guides14.json")


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True)
    ap.add_argument("--cell", choices=("A", "B"), default="A")
    ap.add_argument("--mirror-test", action="store_true")
    ap.add_argument("--s1-raw", action="store_true")
    ap.add_argument("--stem", default="guides14")
    ap.add_argument("--dump-paths", action="store_true")
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--falltrace", action="store_true")
    ap.add_argument("--heightfields", action="store_true")
    ap.add_argument("--diag-only", action="store_true")
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
    if bool(getattr(aa, "heightfields", False)):
        _run_heightfields(out, h, body)
        return
    if str(aa.stem).startswith(("guides13", "guides14")):
        _run_strings12(out, h, body, aa)
        return
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
    F = HERE.parent / "hair-cap7"
    cap = np.load(F / "cap-v7.npz"); fb = np.load(F / "flow-b-v7.npz", allow_pickle=True)
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
