"""Hair-cap-6 (M1-M4): cap-v6 = v4-rebuild MINUS exact-P1 forehead strip (M1),
PLUS sideburn tongues (M2), MINUS pinna boxes, nape smoothed (M3).

V5 defects fixed: D1 front arch low (spline EXACTLY through 6 P1 means, no
temple knots); D2 no sideburn (tongue from temple corner down P2 edge +10mm
setback to lobe+15mm, back to tragus, notch around pinna); D3 nape zig-zag
(15-pt moving-average + reproject); D4 sink root 151 (forensics + cause fix).
Flow construction (mode B M18-M23), weld 1e-4, slit, subdivision to ~2mm and
outputs are identical to flow6.py. Only the boundary definition changed (R2).

Snapping uses a WORLD-space head BVH (ray_cast preserves exact coords):
front = Y-rays fixing (x, zc6), sideburn = X-rays fixing (y, z) onto the
designed polyline, nape/behind-ear = moving-average + nearest reproject.
Gates are the brief G1-G5. Cap saved once, reloaded, then field work.
CLI: Blender -b --python flow7.py -- --out E

Mode A (comparison): phi geodesic + flow = -grad(phi), same code as flow-4.
Mode B (output): per-vertex lateral+gravity blend:
  M18: L = sign(x)*X projected on tangent plane; G = -Z projected on tangent.
  M19: w = clamp(n.z,0,1)^0.5; f = w*L + (1-w)*G.
  M20: no-forward rule in front of the ear line (FACE = -Y verified in P2).
  M21: midline behind apex (|x|<8mm): vertex sign; |x|<1mm uses G only.
  M22: 3 neighbour-average passes, never across slit / x=0 in front of apex.
  M23: 300 Poisson roots traced 2 mm steps, max 200 mm, exit classes.
D2 fix: cap material uses Attribute node + render mesh offset 0.8 mm along
  normals (flow-4 colours were lost to z-fighting with the head surface).

CLI: Blender -b --python flow5.py -- --out E
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

def bm_stats(bm):
    bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table(); bm.edges.ensure_lookup_table()
    area = sum(f.calc_area() for f in bm.faces)
    med = statistics.median([e.calc_length() for e in bm.edges]) if len(bm.edges) else 0.0
    seen, nc = set(), 0
    for f in bm.faces:
        if f.index in seen: continue
        nc += 1; st = [f]; seen.add(f.index)
        while st:
            x = st.pop()
            for e in x.edges:
                for g in e.link_faces:
                    if g.index not in seen: seen.add(g.index); st.append(g)
    return len(bm.verts), len(bm.faces), area, nc, med

def comp_detail(bm):
    faces = list(bm.faces)
    seen, comps = set(), []
    for f in faces:
        if f.index in seen: continue
        st = [f]; seen.add(f.index); cf = [f]
        while st:
            x = st.pop()
            for e in x.edges:
                for g in e.link_faces:
                    if g.index not in seen: seen.add(g.index); st.append(g); cf.append(g)
        comps.append(cf)
    out = []
    for cf in comps:
        vs = {v for f in cf for v in f.verts}
        P = np.array([tuple(v.co) for v in vs])
        out.append({"faces": cf, "nfaces": len(cf), "area": float(sum(f.calc_area() for f in cf)),
                    "bbox": (P.min(axis=0), P.max(axis=0)), "verts": list(vs), "P": P})
    out.sort(key=lambda d: -d["nfaces"])
    return out

def pair_mindist(P, Q, chunk=512):
    m = float("inf")
    for i in range(0, len(P), chunk):
        D = np.linalg.norm(P[i:i + chunk, None, :] - Q[None, :, :], axis=2)
        m = min(m, float(D.min()))
    return m

def boundary_info(F):
    cnt = defaultdict(list)
    for f in F:
        for k in range(3):
            a, b = f[k], f[(k + 1) % 3]
            cnt[tuple(sorted((a, b)))].append(f)
    bnd = [e for e, v in cnt.items() if len(v) == 1]
    adj = defaultdict(set)
    for a, b in bnd:
        adj[a].add(b); adj[b].add(a)
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

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True)
    out = Path(ap.parse_args(sys.argv[sys.argv.index("--") + 1:]).out); out.mkdir(parents=True, exist_ok=True)
    HS = load_hs(); h = HS.build_scene(); head = h.head
    print("P1 scale=%s dims=%s" % (tuple(head.scale), tuple(head.dimensions)))
    Mw = head.matrix_world.copy()
    ws = np.array([tuple(Mw @ v.co) for v in head.data.vertices])
    xs, ys, zs = ws[:, 0], ws[:, 1], ws[:, 2]
    crown = float(zs.max()); ai = int(zs.argmax()); apex = ws[ai]; apex_y = float(apex[1])
    HSET = ws[zs > crown - 0.26]
    hx, hy, hz = HSET[:, 0], HSET[:, 1], HSET[:, 2]
    cx, cy = float(np.median(hx)), float(np.median(hy))
    band = HSET[(hz >= crown - 0.17) & (hz <= crown - 0.09)]
    eL = band[band[:, 0].argmax()]; eR = band[band[:, 0].argmin()]
    eLz = float(band[np.linalg.norm(band - eL, axis=1) <= 0.015][:, 2].max())
    eRz = float(band[np.linalg.norm(band - eR, axis=1) <= 0.015][:, 2].max())
    ear_top = min(eLz, eRz)
    ear_y = float(0.5 * (eL[1] + eR[1]))
    mid = HSET[(np.abs(hx - cx) < 0.005) & (hz >= crown - 0.13) & (hz <= crown - 0.09)]
    brow = mid[mid[:, 1].argmin()]
    nose = HSET[np.abs(hx - cx) < 0.005][HSET[np.abs(hx - cx) < 0.005][:, 1].argmin()]
    face = "-Y" if float(nose[1]) < apex_y else "+Y"
    print("P2 nose (%.4f,%.4f,%.4f) apex_y=%.4f face=%s" % (*nose, apex_y, face))
    print("M6 crown=%.4f cx=%.4f cy=%.4f earL=(%.4f,%.4f,%.4f) earR=(%.4f,%.4f,%.4f) ear_top_z=%.4f ear_y=%.4f brow=(%.4f,%.4f,%.4f)" % (crown, cx, cy, *eL, *eR, ear_top, ear_y, *brow))
    g9e = (abs(eL[0] + eR[0] - 2 * cx), abs(eL[1] - eR[1]), abs(eLz - eRz))
    print("G9-ear dx=%.4f dy=%.4f dz=%.4f" % (g9e[0] * 1000, g9e[1] * 1000, g9e[2] * 1000))
    # P4: true brow ridge = most anterior midline vert above the nasion; nasion =
    # least anterior midline vert with z in [1.54,1.56]. Menton from fixed head height.
    H_HEAD = 0.2107
    menton_z = crown - H_HEAD
    midmask = np.abs(xs - cx) < 0.004
    _cb = sorted((float(ys[i]), float(zs[i]), int(i)) for i in np.where(midmask & (zs > 1.56))[0])
    brow_y, brow_z, brow_id = _cb[0]
    _cn = sorted(((float(ys[i]), float(zs[i]), int(i)) for i in np.where(midmask & (zs >= 1.54) & (zs <= 1.56))[0]), reverse=True)
    nasion_y, nasion_z, nasion_id = _cn[0]
    _cm = sorted((abs(float(zs[i]) - menton_z), int(i), float(zs[i]), float(ys[i])) for i in np.where(midmask)[0])
    print("P4 brow id=%d y=%.5f z=%.5f | nasion id=%d y=%.5f z=%.5f | old-brow_z-was-nose=1.5303" % (brow_id, brow_y, brow_z, nasion_id, nasion_y, nasion_z))
    print("P4 menton_z=%.5f (crown-0.2107) nearest-mid-vert id=%d z=%.5f y=%.5f" % (menton_z, _cm[0][1], _cm[0][2], _cm[0][3]))
    # P1 target hairline measured on TS/target-front.png (face centre col 513,
    # hair-top row 127, skull-crown row 150, chin row 608, H=458px).
    # rows L/R: 0:208 | 20:211/211 | 40:212/213 | 60:224/219 | 80:245/238 | 100:303/284
    P1_DXMM = np.array([0.0, 9.2009, 18.4017, 27.6026, 36.8035, 46.0044]) / 1000.0
    P1_H = np.array([0.87336, 0.86681, 0.86354, 0.84389, 0.80022, 0.68668])
    P1_Z = menton_z + P1_H * H_HEAD
    P1_ROWS = {0: (208, 208), 20: (211, 211), 40: (212, 213), 60: (224, 219), 80: (245, 238), 100: (303, 284)}
    BLEND_MM = 0.025
    print("P1 " + " ".join("dx%d:L%d/R%d" % (k, v[0], v[1]) for k, v in sorted(P1_ROWS.items())))
    # P2: our current (v4) hairline the same way on the mesh (read-only F).
    _v4 = np.load(str(HERE.parent / "hair-flow" / "cap-v4.npz"))
    V4 = np.array(_v4["verts"]); F4 = [tuple(f) for f in np.array(_v4["faces"])]
    fore4 = sorted(int(v) for v in _v4["forehead"]); crown4 = float(_v4["crown"])
    menton4 = crown4 - H_HEAD
    print("P2 v4-area=%.1fcm2 crown4=%.5f menton4=%.5f" % (float(_v4["area_cm2"]), crown4, menton4))
    centre = np.array([cx, cy + 0.005, crown - 0.105])
    browz = float(brow[2])
    face_v = np.array([0.0, -1.0, 0.0])
    # ---- V5B (M4/M5/M6): subtract-from-v4 + smooth-curve snap ----
    # M4: P1_H below is already the MEAN of the L/R target rows (0.687 at
    # |dx| = 0.218H). Symmetric by construction.
    # M6/G4: ear_front_y = ear_y - 10 mm. v4 boundary points at that height
    # are the joins J; faces with centroid y > ear_front_y stay bit-identical.
    ear_front_y = float(ear_y - 0.010)
    # V5 (read-only C5 reference for O2 tubes + RESULT history).
    _v5 = np.load("/Users/patrick/.grok/worktrees/src-openclinxr/hair-p7/tools/openclinxr/evidence/hair-cap5/cap-v5.npz")
    V5 = np.array(_v5["verts"]); F5 = [tuple(f) for f in np.array(_v5["faces"])]
    print("V5 loaded v=%d f=%d area=%.1fcm2" % (len(V5), len(F5), float(_v5["area_cm2"])))
    # ---- P2: target sideburn visible edge (JM mask-profile-v2; eye-corner
    # col 347 row 348; H = 452px; hairline tip row 200 col 373). ----
    P2_ROWS = [220, 250, 280, 310, 340, 370, 400, 430]
    P2_COLS = [390, 398, 403, 408, 413, 422, 436, 443]
    P2_EYE = (347, 348); P2_HPX = 452.0
    P2_OFF = [(c - P2_EYE[0]) / P2_HPX for c in P2_COLS]
    print("P2 " + " ".join("r%d:c%d=%.4fH" % (r, c, o) for r, c, o in zip(P2_ROWS, P2_COLS, P2_OFF)))
    # ---- P3: our head landmarks (probe, print, mirror error) ----
    lash = [o for o in bpy.data.objects if "eyelash" in o.name][0]
    wl = np.array([tuple(lash.matrix_world @ v.co) for v in lash.data.vertices])
    CAN = {}
    for _side, _sgn in (("L", 1), ("R", -1)):
        _pts = wl[wl[:, 0] * _sgn > 0]
        _i = int(np.argmax(_pts[:, 0] * _sgn))
        CAN[_side] = (float(_pts[_i][0]), float(_pts[_i][1]), float(_pts[_i][2]))
    print("P3 canthus L=(%.1f,%.1f,%.5f) R=(%.1f,%.1f,%.5f) mirror=(%.3f,%.3f,%.3f)mm" % (
        CAN["L"][0] * 1000, CAN["L"][1] * 1000, CAN["L"][2],
        CAN["R"][0] * 1000, CAN["R"][1] * 1000, CAN["R"][2],
        abs(CAN["L"][0] + CAN["R"][0]) * 1000, abs(CAN["L"][1] - CAN["R"][1]) * 1000,
        abs(CAN["L"][2] - CAN["R"][2]) * 1000))
    PIN = {}
    for _side, _sgn in (("L", 1), ("R", -1)):
        _m = ((xs - cx) * _sgn > 0.068) & ((xs - cx) * _sgn < 0.095) & (ys > -0.10) & (ys < 0.01) & (zs > 1.45) & (zs < 1.63)
        _pts = ws[_m]
        _ia, _ib, _ic = int(np.argmin(_pts[:, 1])), int(np.argmax(_pts[:, 2])), int(np.argmin(_pts[:, 2]))
        PIN[_side] = {"front": tuple(float(v) for v in _pts[_ia]), "top": tuple(float(v) for v in _pts[_ib]),
                      "lobe": tuple(float(v) for v in _pts[_ic]),
                      "lat": (float(eL[0]), float(eL[1]), float(eL[2])) if _side == "L" else (float(eR[0]), float(eR[1]), float(eR[2]))}
    for _k in ("front", "top", "lobe", "lat"):
        _a, _b = PIN["L"][_k], PIN["R"][_k]
        print("P3 ear-%s L=(%.1f,%.1f,%.4f) R=(%.1f,%.1f,%.4f) mirror=(%.3f,%.3f,%.3f)mm" % (
            _k, _a[0] * 1000, _a[1] * 1000, _a[2], _b[0] * 1000, _b[1] * 1000, _b[2],
            abs(_a[0] + _b[0]) * 1000, abs(_a[1] - _b[1]) * 1000, abs(_a[2] - _b[2]) * 1000))
    # M1: hairline curve zc6(|x|): monotone PCHIP (Fritsch-Carlson, no
    # overshoot on the steep 36.8->46 mm drop) through the 6 P1 means ONLY,
    # so the curve is EXACT at every G2 column. Clamped beyond 46.0044 mm.
    _kx = [0.0, 9.2009, 18.4017, 27.6026, 36.8035, 46.0044]
    _kz = [float(P1_Z[0]), float(P1_Z[1]), float(P1_Z[2]), float(P1_Z[3]), float(P1_Z[4]), float(P1_Z[5])]
    _px = np.array(_kx) / 1000.0
    _pz = np.array(_kz)
    _nn = len(_px)
    _dd = np.array([(_pz[k + 1] - _pz[k]) / (_px[k + 1] - _px[k]) for k in range(_nn - 1)])
    _mm = np.zeros(_nn); _mm[0] = _dd[0]; _mm[-1] = _dd[-1]
    for k in range(1, _nn - 1):
        if _dd[k - 1] * _dd[k] <= 0:
            _mm[k] = 0.0
        else:
            w1 = 2 * (_px[k + 1] - _px[k]) + (_px[k] - _px[k - 1])
            w2 = (_px[k + 1] - _px[k]) + 2 * (_px[k] - _px[k - 1])
            _mm[k] = (w1 + w2) / (w1 / _dd[k - 1] + w2 / _dd[k])
    def zc6(ax):
        ax = float(ax)
        if ax <= _px[0]:
            return float(_pz[0])
        if ax >= _px[-1]:
            return float(_pz[-1])
        k = int(np.searchsorted(_px, ax)) - 1
        h = _px[k + 1] - _px[k]; t = (ax - _px[k]) / h
        h00 = 2 * t ** 3 - 3 * t ** 2 + 1; h10 = t ** 3 - 2 * t ** 2 + t
        h01 = -2 * t ** 3 + 3 * t ** 2; h11 = t ** 3 - t ** 2
        return float(h00 * _pz[k] + h10 * h * _mm[k] + h01 * _pz[k + 1] + h11 * h * _mm[k + 1])
    for _tmm in _kx:
        print("CURVE6 ax=%.1fmm zc=%.4f h=%.4fH" % (_tmm, zc6(_tmm / 1000.0), (zc6(_tmm / 1000.0) - menton_z) / H_HEAD))
    # ---- V6-select: rebuild v4's coarse flood set (flow5 verbatim), then
    # SUBTRACT the exact-P1 forehead strip (M1), ADD sideburn tongues (M2),
    # CUT pinna boxes (M2, no roots on pinna). ----
    def bnd_z(x, y):
        az = math.atan2(x - cx, -(y - centre[1]))
        return crown - (0.165 - 0.025 * abs(math.sin(az)) + 0.095 * max(0.0, -math.cos(az)))
    fs = [[v for v in p.vertices] for p in head.data.polygons]
    cfs = np.array([ws[f].mean(axis=0) for f in fs])
    headBVH = BVHTree.FromPolygons([Vector(tuple(p)) for p in ws], [tuple(int(v) for v in f) for f in fs])
    # M1 temple corner T per side: Y-ray at (|x| = 46.0044 mm, z = P1_Z[5]).
    TC = {}
    for _side, _sgn in (("L", 1), ("R", -1)):
        _ox = cx + _sgn * 0.0460044
        _hit = headBVH.ray_cast(Vector((_ox, cy - 0.25, float(P1_Z[5]))), Vector((0.0, 1.0, 0.0)))
        if _hit[0] is not None and _hit[1][1] < -0.2:
            TC[_side] = (float(_hit[0][0]), float(_hit[0][1]), float(_hit[0][2]))
        else:
            _dd = np.linalg.norm(ws - np.array([_ox, -0.10, float(P1_Z[5])]), axis=1)
            _j = int(_dd.argmin())
            TC[_side] = (float(ws[_j][0]), float(ws[_j][1]), float(ws[_j][2]))
        print("TEMPLE-%s T=(%.1f,%.1f,%.5f) rayhit=%s" % (
            _side, TC[_side][0] * 1000, TC[_side][1] * 1000, TC[_side][2], _hit[0] is not None))
    # M2 root polyline per side in (y, z): T -> P2 mapped (+10 mm setback)
    # -> sideburn bottom B (lobe bottom + 15 mm). Eye-anchored mapping:
    # z = canthus_z + (eyerow - row) * px2m; y = canthus_y + off*H + 10 mm.
    PX2M = 0.2107 / 452.0
    CANY = 0.5 * (CAN["L"][1] + CAN["R"][1])
    CANZ = 0.5 * (CAN["L"][2] + CAN["R"][2])
    SB = {}
    for _side in ("L", "R"):
        _pts = [(TC[_side][1], TC[_side][2])]
        for _r, _c in zip(P2_ROWS, P2_COLS):
            _off = (_c - P2_EYE[0]) / P2_HPX
            _pts.append((CANY + _off * 0.2107 + 0.010, CANZ + (P2_EYE[1] - _r) * PX2M))
        _pts.append((-0.0790, float(PIN["L"]["lobe"][2]) + 0.015))
        SB[_side] = _pts
        print("SB-%s " % _side + " ".join("(y%.1f,z%.4f)" % (p[0] * 1000, p[1]) for p in _pts))
    SB_F = {"L": (-0.0700, float(PIN["L"]["lobe"][2]) + 0.015),
            "R": (-0.0700, float(PIN["R"]["lobe"][2]) + 0.015)}
    TONG = {"L": SB["L"] + [SB_F["L"]], "R": SB["R"] + [SB_F["R"]]}
    def pip(yz, poly):
        y, z = yz; inside = False; n = len(poly)
        for k in range(n):
            y1, z1 = poly[k]; y2, z2 = poly[(k + 1) % n]
            if (z1 > z) != (z2 > z):
                yx = y1 + (z - z1) * (y2 - y1) / (z2 - z1)
                if y < yx:
                    inside = not inside
        return inside
    # M2 pinna box (face centroids): |x| 60-100 mm, y -66..-20 mm,
    # z 1.490-1.610. Rim stays >= 6 mm from every ear landmark (G4).
    PINBOX = (0.060, 0.100, -0.066, -0.020, 1.490, 1.610)
    emap = {}
    for i, f in enumerate(fs):
        for k in range(len(f)):
            e = tuple(sorted((f[k], f[(k + 1) % len(f)]))); emap.setdefault(e, []).append(i)
    fadj = [set() for _ in fs]
    for o in emap.values():
        for i in o:
            for j in o:
                if i != j: fadj[i].add(j)
    def inside(c, d):
        if abs(c[0] - cx) > 0.072 and c[2] < ear_top: return False
        if c[2] < bnd_z(c[0], c[1]) + d: return False
        return True
    def flood(d):
        ok = {i for i, c in enumerate(cfs) if inside(c, d)}
        seed = max(ok, key=lambda i: float(cfs[i][2]))
        seen, st = {seed}, [seed]
        while st:
            x = st.pop()
            for y in fadj[x]:
                if y in ok and y not in seen: seen.add(y); st.append(y)
        tris = []
        for i in seen:
            f = fs[i]; tris += [[f[0], f[k + 1], f[k + 2]] for k in range(len(f) - 2)]
        a = float(sum(0.5 * np.linalg.norm(np.cross(ws[b] - ws[a], ws[c] - ws[a])) for a, b, c in tris))
        fc = cfs[list(seen)]
        front = fc[(np.abs(fc[:, 0] - cx) < 0.01) & (fc[:, 1] < centre[1])]
        return a, (float(front[:, 2].min()) if len(front) else 0.0), seen
    delta, carea, keep = None, 0.0, set()
    for d in (0.080, 0.075, 0.085, 0.070, 0.090, 0.065):
        a, fz, ks = flood(d); print("delta=%.3f flood-area=%.0fcm2 fronthair=%.4f brow=%.4f" % (d, a * 1e4, fz, browz))
        if 0.055 <= a <= 0.075 and fz > browz + 0.002: delta, carea, keep = d, a, ks; break
    if delta is None:
        ds = (0.080, 0.075, 0.085, 0.070, 0.090, 0.065); delta = min(ds, key=lambda d: abs(flood(d)[0] - 0.065))
        carea, _, keep = flood(delta)
    print("CHOSEN delta=%.3f flood-faces=%d (v4 rebuild)" % (delta, len(keep)))
    n_v4faces = len(keep)
    kept5, removed5 = set(), []
    for i in keep:
        c = cfs[i]
        axi = abs(float(c[0]) - cx)
        if float(c[1]) <= ear_front_y and axi <= 0.0465 and float(c[2]) < zc6(axi):
            removed5.append(i)
        else:
            kept5.add(i)
    keep = kept5
    rem_tris = []
    for i in removed5:
        f = fs[i]; rem_tris += [[f[0], f[k + 1], f[k + 2]] for k in range(len(f) - 2)]
    rem_area = float(sum(0.5 * np.linalg.norm(np.cross(ws[b] - ws[a], ws[c] - ws[a])) for a, b, c in rem_tris))
    rem_c = np.array([cfs[i] for i in removed5]) if removed5 else np.zeros((0, 3))
    rem_behind = int((rem_c[:, 1] > ear_front_y).sum()) if len(removed5) else 0
    print("STRIP v4faces=%d removed=%d kept=%d removed_coarse_area=%.2fcm2 behind_ear_removed=%d" % (n_v4faces, len(removed5), len(keep), rem_area * 1e4, rem_behind))
    assert rem_behind == 0, "strip ate behind-ear faces"
    # M2 tongue ADD (faces outside the 46.5 mm strip domain, inside polygon).
    added = {}
    for _side, _sgn in (("L", 1), ("R", -1)):
        _poly = TONG[_side]
        _ids = [i for i in range(len(fs)) if i not in keep and (cfs[i][0] - cx) * _sgn > 0.0475
                and pip((float(cfs[i][1]), float(cfs[i][2])), _poly)]
        for i in _ids:
            keep.add(i)
        _tris = []
        for i in _ids:
            f = fs[i]; _tris += [[f[0], f[k + 1], f[k + 2]] for k in range(len(f) - 2)]
        _a = float(sum(0.5 * np.linalg.norm(np.cross(ws[b] - ws[a], ws[c] - ws[a])) for a, b, c in _tris))
        added[_side] = (_ids, _a)
        print("TONGUE-%s faces=%d area=%.2fcm2" % (_side, len(_ids), _a * 1e4))
    # M2 pinna box CUT.
    _xa, _xb, _ya, _yb, _za, _zb = PINBOX
    cut = [i for i in keep if _xa <= abs(float(cfs[i][0]) - cx) <= _xb and _ya <= float(cfs[i][1]) <= _yb
           and _za <= float(cfs[i][2]) <= _zb]
    for i in cut:
        keep.discard(i)
    _ctris = []
    for i in cut:
        f = fs[i]; _ctris += [[f[0], f[k + 1], f[k + 2]] for k in range(len(f) - 2)]
    cut_area = float(sum(0.5 * np.linalg.norm(np.cross(ws[b] - ws[a], ws[c] - ws[a])) for a, b, c in _ctris))
    print("PINNACUT faces=%d area=%.2fcm2" % (len(cut), cut_area * 1e4))
    v4area = float(_v4["area_cm2"])
    mesh = head.data.copy(); mesh.name = "Cap6_scalp_cap_mesh"
    bm = bmesh.new(); bm.from_mesh(mesh)
    for v in bm.verts: v.co = Mw @ v.co
    bm.faces.ensure_lookup_table()
    for f in list(bm.faces):
        if f.index not in keep: bm.faces.remove(f)
    for v in list(bm.verts):
        if not v.link_faces: bm.verts.remove(v)
    steps = []
    r = bm_stats(bm); steps.append(("coarse-select",) + r[:4]); print("STEP coarse-select v=%d f=%d area=%.1fcm2 comp=%d med=%.2fmm" % (r[0], r[1], r[2] * 1e4, r[3], r[4] * 1000))
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
    r = bm_stats(bm); steps.append(("remove_doubles-1e-5",) + r[:4]); print("STEP remove_doubles-1e-5 v=%d f=%d area=%.1fcm2 comp=%d med=%.2fmm" % (r[0], r[1], r[2] * 1e4, r[3], r[4] * 1000))
    for k in range(6):
        r = bm_stats(bm)
        if r[4] <= 0.0025 or k == 5: break
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1, use_grid_fill=True, use_single_edge=False, use_only_quads=False, smooth=0.0)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
        r = bm_stats(bm); steps.append(("subdiv-%d" % (k + 1),) + r[:4])
        print("STEP subdiv-%d v=%d f=%d area=%.1fcm2 comp=%d med=%.2fmm" % (k + 1, r[0], r[1], r[2] * 1e4, r[3], r[4] * 1000))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    weld_recs = []
    r = bm_stats(bm); weld_recs.append((1e-5, r[3], r[0], r[1])); print("WELD dist=0.0000(baseline 1e-5) v=%d f=%d comp=%d" % (r[0], r[1], r[3]))
    for dist in (1e-4,):
        if r[3] == 1: break
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=dist)
        r = bm_stats(bm); weld_recs.append((dist, r[3], r[0], r[1])); print("WELD dist=%.4f v=%d f=%d comp=%d" % (dist, r[0], r[1], r[3]))
    r = bm_stats(bm); steps.append(("triangulate+weld",) + r[:4]); print("STEP triangulate+weld v=%d f=%d area=%.1fcm2 comp=%d med=%.2fmm" % (r[0], r[1], r[2] * 1e4, r[3], r[4] * 1000))
    bm.faces.ensure_lookup_table(); bm.verts.ensure_lookup_table(); bm.edges.ensure_lookup_table()
    comps = comp_detail(bm)
    print("D1 components=%d" % len(comps))
    pair_lines = []
    for i, c in enumerate(comps):
        lo, hi = c["bbox"]
        print("COMP::%d faces=%d area=%.2fcm2 bbox=[%.4f,%.4f,%.4f]x[%.4f,%.4f,%.4f]" % (i, c["nfaces"], c["area"] * 1e4, lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]))
    pair_d = {}
    for i in range(len(comps)):
        for j in range(i + 1, len(comps)):
            m = pair_mindist(comps[i]["P"], comps[j]["P"]); pair_d[(i, j)] = m
            print("PAIR::%d-%d mindist=%.4fmm" % (i, j, m * 1000))
            pair_lines.append((i, j, m))
    cap = bpy.data.objects.new("Cap6_scalp_cap", mesh); bpy.context.scene.collection.objects.link(cap); cap.matrix_world.identity()
    deps = bpy.context.evaluated_depsgraph_get(); cap.update_tag(); bpy.context.view_layer.update()
    bv = BVHTree.FromObject(head, deps, deform=True, cage=False); ev = head.evaluated_get(deps)
    w2l, l2w = ev.matrix_world.inverted(), ev.matrix_world
    # ---- V6 snap: S1 front Y-rays onto zc6; S2 sideburn X-rays onto the SB
    # polyline; S3 neighbour-average smoothing (nape strong, behind-ear light
    # with ear-landmark guard). World-space headBVH: rays preserve exact
    # coords, nearest pulls back onto the surface. ----
    EAR8 = [PIN[s][k] for s in ("L", "R") for k in ("front", "top", "lobe", "lat")]
    EAR8A = np.array(EAR8)
    Z_T = 0.5 * (TC["L"][2] + TC["R"][2])
    Z_B = float(PIN["L"]["lobe"][2]) + 0.015

    def seg_yz(p, a, b):
        ay, az = a; by, bz = b; py, pz = p
        dy, dz = by - ay, bz - az
        L2 = dy * dy + dz * dz
        t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, ((py - ay) * dy + (pz - az) * dz) / L2))
        return (ay + t * dy, az + t * dz)

    def sb_target(side, y, z):
        return min((seg_yz((y, z), SB[side][k], SB[side][k + 1]) for k in range(len(SB[side]) - 1)),
                   key=lambda q: (q[0] - y) ** 2 + (q[1] - z) ** 2)

    def ear_dist(p):
        return float(np.linalg.norm(EAR8A - np.array(p), axis=1).min())

    def s1s2_on_bm(bmobj, vilist=None, skip=None, tag=""):
        bmobj.verts.ensure_lookup_table()
        if vilist is None:
            _be = [(e.verts[0], e.verts[1]) for e in bmobj.edges if len(e.link_faces) == 1]
            _bs = {v.index for e in _be for v in e}
            vilist = sorted(_bs)
        n1 = n1m = n2 = n2m = 0
        for vi in vilist:
            if skip is not None and vi in skip:
                continue
            v = bmobj.verts[vi]
            x, y, z = float(v.co[0]), float(v.co[1]), float(v.co[2])
            axi = abs(x - cx)
            if y <= ear_front_y and axi <= 0.0465:
                zt = zc6(axi)
                h = headBVH.ray_cast(Vector((x, cy - 0.25, zt)), Vector((0.0, 1.0, 0.0)))
                n1 += 1
                if h[0] is not None and h[1][1] < -0.2:
                    v.co = h[0]
                else:
                    n1m += 1
            elif axi > 0.040 and y <= -0.068 and Z_B - 0.005 <= z <= 1.620 and ear_dist((x, y, z)) >= 0.012:
                sgn = 1.0 if x >= cx else -1.0
                side = "L" if sgn > 0 else "R"
                yt, zt2 = sb_target(side, y, z)
                h = headBVH.ray_cast(Vector((cx + sgn * 0.25, yt, zt2)), Vector((-sgn, 0.0, 0.0)))
                n2 += 1
                if h[0] is not None and abs(h[1][0]) > 0.25:
                    v.co = h[0]
                else:
                    n2m += 1
        print("S1S2-%s S1=%d(miss=%d) S2=%d(miss=%d)" % (tag, n1, n1m, n2, n2m))

    def s3_smooth(tag, nape_passes, mid_passes):
        for _p in range(max(nape_passes, mid_passes)):
            bm.verts.ensure_lookup_table(); bm.edges.ensure_lookup_table()
            do_nape = _p < nape_passes
            do_mid = _p < mid_passes
            if not do_nape and not do_mid:
                break
            moves = {}
            for v in bm.verts:
                x, y, z = float(v.co[0]), float(v.co[1]), float(v.co[2])
                is_bnd = any(len(e.link_faces) == 1 for e in v.link_edges)
                if not is_bnd:
                    continue
                zone = None
                if y > -0.0089:
                    if do_nape:
                        zone = "nape"
                elif y > -0.068 and abs(x - cx) > 0.040:
                    if do_mid:
                        zone = "mid"
                if zone is None:
                    continue
                nb = [e.other_vert(v) for e in v.link_edges]
                nbc = [w for w in nb if any(len(e.link_faces) == 1 for e in w.link_edges)]
                pts = [v.co] + [w.co for w in nbc]
                m = sum(pts, Vector((0.0, 0.0, 0.0))) / len(pts)
                a = 0.5 if zone == "nape" else 0.3
                moves[v.index] = v.co + (m - v.co) * a
            ng = 0
            for vi, p in moves.items():
                v = bm.verts[vi]
                old = v.co.copy()
                v.co = p
                hit, _, _, _ = headBVH.find_nearest(v.co)
                if hit is not None:
                    v.co = hit
                if ear_dist(v.co) < 0.006:
                    v.co = old
                else:
                    ng += 1
            print("S3-%s pass=%d moved=%d" % (tag, _p, ng))
    for _sr in range(2):
        s1s2_on_bm(bm, tag="pre%d" % _sr)
    s3_smooth("pre", 10, 3)
    s1s2_on_bm(bm, tag="pre-final")
    bm.to_mesh(mesh); mesh.update(); cap.update_tag(); bpy.context.view_layer.update()
    V = np.array([tuple(v.co) for v in mesh.vertices]); F = [tuple(p.vertices) for p in mesh.polygons]
    y0 = float(V[:, 1].min()) - 0.002
    cut = {i for i, f in enumerate(F) if abs(V[list(f)][:, 0].mean() - cx) < 0.0012 and y0 <= V[list(f)][:, 1].mean() <= apex_y + 0.002}
    del_verts = set()
    for i in cut:
        for v in F[i]: del_verts.add(v)
    slit_track = sorted(v for v in del_verts
                        if abs(float(V[v][0]) - cx) <= 0.006 and y0 - 0.001 <= float(V[v][1]) <= apex_y + 0.003)
    Fk = [f for i, f in enumerate(F) if i not in cut]
    used = sorted({v for f in Fk for v in f})
    remap = {old: new for new, old in enumerate(used)}
    Vc = V[used]
    Fc = [tuple(remap[v] for v in f) for f in Fk]
    slit_set = {remap[v] for v in slit_track if v in remap}
    mesh.clear_geometry(); mesh.from_pydata(Vc.tolist(), [], [list(f) for f in Fc]); mesh.update()
    V = np.array([tuple(v.co) for v in mesh.vertices]); F = [tuple(p.vertices) for p in mesh.polygons]
    area = float(sum(0.5 * np.linalg.norm(np.cross(V[b] - V[a], V[c] - V[a])) for a, b, c in F))
    print("POST-SLIT v=%d f=%d area=%.1fcm2 cutfaces=%d slittrack=%d" % (len(V), len(F), area * 1e4, len(cut), len(slit_set)))
    cornerL = min((v for v in slit_set if float(V[v][0]) <= cx), key=lambda v: float(V[v][1]), default=None)
    cornerR = min((v for v in slit_set if float(V[v][0]) > cx), key=lambda v: float(V[v][1]), default=None)
    pins = {c for c in (cornerL, cornerR) if c is not None}
    print("M14 slit=%d corners=%s" % (len(slit_set), sorted(pins)))
    _b0, _g0, _o0, _c0, _a0 = boundary_info(F)
    if _o0 and len(_o0) > 30:
        bmS = bmesh.new(); bmS.from_mesh(mesh); bmS.verts.ensure_lookup_table()
        ssetS = set(int(v) for v in slit_set) | set(int(v) for v in pins)
        s1s2_on_bm(bmS, vilist=[int(v) for v in _o0], skip=ssetS, tag="postslit")
        bmS.to_mesh(mesh); bmS.free(); mesh.update()
        V = np.array([tuple(v.co) for v in mesh.vertices]); F = [tuple(p.vertices) for p in mesh.polygons]
        area = float(sum(0.5 * np.linalg.norm(np.cross(V[b] - V[a], V[c] - V[a])) for a, b, c in F))
        print("POST-SNAP v=%d f=%d area=%.1fcm2 pins=%d (S1/S2 1 round)" % (len(V), len(F), area * 1e4, len(pins)))
    import json as J
    bnd_edges, groups, order, cov, badj = boundary_info(F)
    fadj2 = defaultdict(set)
    for f in F:
        for k in range(3):
            a, b = f[k], f[(k + 1) % 3]; fadj2[a].add(b); fadj2[b].add(a)
    seen, ncomp = set(), 0
    for s in fadj2:
        if s in seen: continue
        ncomp += 1; st = [s]; seen.add(s)
        while st:
            x = st.pop()
            for y in fadj2[x]:
                if y not in seen: seen.add(y); st.append(y)
    nloops = len(groups)
    print("LOOPS n=%d sizes=%s order=%d cov=%.3f ncomp=%d" % (nloops, [len(g) for g in groups][:8], len(order), cov, ncomp))
    OP = V[order] if order else np.zeros((0, 3))
    if len(order):
        avg9 = np.array([np.mean([OP[(k + j) % len(OP)] for j in range(-4, 5)], axis=0) for k in range(len(OP))])
        g3 = float(np.abs(OP - avg9).max())
    else: g3 = 9.0
    ball = np.array([v for g in groups for v in g]) if groups else np.array([], dtype=int)
    BV = V[ball] if len(ball) else V
    ewd = abs(float(eL[0]) - float(eR[0])); half = 0.5 * ewd * 0.62
    latm = np.abs(BV[:, 0] - cx) >= 0.020
    lat = ball[latm] if latm.any() else ball
    LV = V[lat]
    tL = int(lat[np.linalg.norm(LV - np.array([cx + half, brow[1], brow[2]]), axis=1).argmin()]) if len(lat) else 0
    tR = int(lat[np.linalg.norm(LV - np.array([cx - half, brow[1], brow[2]]), axis=1).argmin()]) if len(lat) else 0
    print("M9-temple lat-candidates=%d (of %d boundary)" % (len(lat), len(ball)))
    def azim(p):
        return math.degrees(math.atan2(float(p[0]) - cx, -(float(p[1]) - cy)))
    azL, azR = azim(V[tL]), azim(V[tR])
    lo, hi = min(azL, azR), max(azL, azR)
    contains0 = (lo <= 0 <= hi)
    bset = set(int(v) for v in ball)
    sset0 = set(int(v) for v in slit_set) | set(int(v) for v in pins)
    fore, exl = [], []
    for v in bset:
        if v in sset0: continue
        a = azim(V[v])
        infore = (lo <= a <= hi) if contains0 else (a >= hi or a <= lo)
        (fore if infore else exl).append(v)
    slit = sorted(sset0)
    assert not (set(fore) & sset0) and not (set(exl) & sset0) and not (set(fore) & set(exl)), "M14 sets overlap"
    EXIT = sorted(exl)
    # sideburn boundary ids per side (npz + G4): outer-loop verts in the
    # tongue band, excluding slit/pins.
    sb6 = {}
    for _side, _sgn in (("L", 1), ("R", -1)):
        sb6[_side] = sorted(v for v in bset if v not in sset0 and (float(V[v][0]) - cx) * _sgn > 0.0475
                            and float(V[v][1]) <= -0.060 and float(V[v][2]) <= 1.620
                            and float(V[v][2]) >= Z_B - 0.005)
    print("SB6 L=%d R=%d" % (len(sb6["L"]), len(sb6["R"])))
    def azrange(ids):
        A = sorted(azim(V[v]) for v in ids) if ids else []
        return (A[0], A[-1]) if A else (float("nan"), float("nan"))
    erng, frng, srng = azrange(EXIT), azrange(fore), azrange(slit)
    print("M14 EXIT=%d az=[%.1f,%.1f] FORE=%d az=[%.1f,%.1f] SLIT=%d az=[%.1f,%.1f] temples az=%.1f,%.1f arc_contains0=%s" % (
        len(EXIT), erng[0], erng[1], len(fore), frng[0], frng[1], len(slit), srng[0], srng[1], azL, azR, contains0))
    print("TEMPLE L id=%d (%.4f,%.4f,%.4f) R id=%d (%.4f,%.4f,%.4f)" % (tL, *V[tL], tR, *V[tR]))
    print("G9-temple dx=%.2f dy=%.2f dz=%.2f mm" % (abs(float(V[tL][0]) + float(V[tR][0]) - 2 * cx) * 1000, abs(float(V[tL][1]) - float(V[tR][1])) * 1000, abs(float(V[tL][2]) - float(V[tR][2])) * 1000))
    # A1: save the cap EXACTLY as built, then reload it; all field work below
    # uses the reloaded arrays.
    np.savez(out / "cap-v6.npz", verts=V, faces=np.array(F), slit=np.array(slit),
             forehead=np.array(fore), exit=np.array(EXIT), temple=np.array([tL, tR]),
             cx=cx, cy=cy, crown=crown, apex=apex, apex_y=apex_y, ear_top=ear_top,
             ear_y=ear_y, area_cm2=area * 1e4, g3_mm=g3 * 1000,
             brow_z=brow_z, nasion_z=nasion_z, menton_z=menton_z, brow_id=brow_id, nasion_id=nasion_id,
             removed_coarse_cm2=rem_area * 1e4, ear_front_y=ear_front_y,
             sideburn_L=np.array(sb6["L"]), sideburn_R=np.array(sb6["R"]),
             canthus_L=np.array(CAN["L"]), canthus_R=np.array(CAN["R"]),
             pinna_front_L=np.array(PIN["L"]["front"]), pinna_front_R=np.array(PIN["R"]["front"]),
             pinna_top_L=np.array(PIN["L"]["top"]), pinna_top_R=np.array(PIN["R"]["top"]),
             pinna_lobe_L=np.array(PIN["L"]["lobe"]), pinna_lobe_R=np.array(PIN["R"]["lobe"]),
             added_L_cm2=added["L"][1] * 1e4, added_R_cm2=added["R"][1] * 1e4,
             cut_pinna_cm2=cut_area * 1e4)
    _d = np.load(out / "cap-v6.npz")
    V = np.array(_d["verts"]); F = [tuple(f) for f in np.array(_d["faces"])]
    slit = sorted(int(v) for v in _d["slit"]); fore = sorted(int(v) for v in _d["forehead"])
    EXIT = sorted(int(v) for v in _d["exit"]); tL, tR = (int(v) for v in _d["temple"])
    print("CAP-V6 saved+reloaded v=%d f=%d area=%.1fcm2" % (len(V), len(F), float(_d["area_cm2"])))
    E = set()
    for f in F:
        for i in range(3): E.add(tuple(sorted((f[i], f[(i + 1) % 3]))))
    adjw = {i: [] for i in range(len(V))}
    for a, b in E:
        w = float(np.linalg.norm(V[a] - V[b])); adjw[a].append((b, w)); adjw[b].append((a, w))
    edge2f = defaultdict(list)
    for fi, f in enumerate(F):
        for k in range(3):
            edge2f[tuple(sorted((f[k], f[(k + 1) % 3])))].append(fi)
    fseen, fcomp = {}, 0
    for fi in range(len(F)):
        if fi in fseen: continue
        st = [fi]; fseen[fi] = fcomp
        while st:
            x = st.pop(); f = F[x]
            for k in range(3):
                for y in edge2f[tuple(sorted((f[k], f[(k + 1) % 3])))]:
                    if y not in fseen: fseen[y] = fcomp; st.append(y)
        fcomp += 1
    vcomp = np.full(len(V), -1)
    for fi, f in enumerate(F):
        for v in f:
            if vcomp[v] < 0: vcomp[v] = fseen[fi]
    nbridge = 0
    nbridgeskip = 0
    SP = V[sorted(sset0)] if sset0 else np.zeros((0, 3))
    def near_slit(p, r=0.005):
        return len(SP) and bool((np.linalg.norm(SP - p, axis=1) < r).any())
    if fcomp > 1:
        Bc = np.array(sorted(bset)); Bp = V[Bc]; Cb = vcomp[Bc]
        NB = len(Bc)
        CH = 1024
        for i0 in range(0, NB, CH):
            D = np.linalg.norm(Bp[i0:i0 + CH, None, :] - Bp[None, :, :], axis=2)
            ii, jj = np.where((D < 0.003) & (D > 1e-9) & (Cb[i0:i0 + CH, None] != Cb[None, :]))
            for k in range(len(ii)):
                a, b = int(Bc[i0 + ii[k]]), int(Bc[jj[k]])
                if a == b: continue
                if near_slit(V[a]) or near_slit(V[b]): nbridgeskip += 1; continue
                w = float(D[ii[k], jj[k]])
                adjw[a].append((b, w)); adjw[b].append((a, w)); nbridge += 1
        nbridge //= 2
        print("BRIDGE graph-edges=%d skipped-near-slit=%d" % (nbridge, nbridgeskip))
    else: print("BRIDGE none needed (1 component)")
    INF = float("inf"); phi = np.full(len(V), INF); ex = set(EXIT)
    for i in ex: phi[i] = 0.0
    hq = [(0.0, i) for i in ex]; heapq.heapify(hq)
    while hq:
        d, x = heapq.heappop(hq)
        if d > phi[x]: continue
        for y, w in adjw[x]:
            nd = d + w
            if nd < phi[y]: phi[y] = nd; heapq.heappush(hq, (nd, y))
    nreach = int(np.isfinite(phi).sum())
    print("REACH %d/%d finite" % (nreach, len(V)))
    unreach = set(int(i) for i in np.where(~np.isfinite(phi))[0])
    if 0 < nreach < len(V):
        phi = np.where(np.isinf(phi), phi[np.isfinite(phi)].max(), phi)
    nbrs = [[y for y, _ in adjw[i]] for i in range(len(V))]
    for _ in range(5):
        phi = np.array([0.0 if i in ex else float(np.mean([phi[j] for j in nbrs[i]])) if nbrs[i] else phi[i] for i in range(len(V))])
    bm2 = bmesh.new(); bm2.from_mesh(mesh); bm2.normal_update(); N = np.array([tuple(v.normal) for v in bm2.verts]); bm2.free()
    N = N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-12)
    G = np.zeros((len(V), 3))
    EA = np.array(list(E)); A0, A1 = EA[:, 0], EA[:, 1]; D = V[A1] - V[A0]; L2 = (D ** 2).sum(axis=1, keepdims=True) + 1e-12
    for sgn, (S, T) in ((1, (A0, A1)), (-1, (A1, A0))):
        Tm = D * sgn; Tv = Tm - (Tm * N[S]).sum(axis=1, keepdims=True) * N[S]; W = (phi[T] - phi[S]) / L2[:, 0]
        np.add.at(G, S, (Tv.T * W).T)
    Gn = np.linalg.norm(G, axis=1); fb = 0
    Fl = np.zeros_like(G)
    for i in range(len(V)):
        if Gn[i] > 1e-12: Fl[i] = -G[i] / Gn[i]
        else: fb += 1; Fl[i] = np.array([1.0 if V[i][0] >= cx else -1.0, 0.0, 0.0])
    fA = Fl.copy()
    amax = int(phi.argmax())
    # ---- MODE B (M18-M22) ----
    X = np.array([1.0, 0.0, 0.0]); Zdown = np.array([0.0, 0.0, -1.0]); Yback = np.array([0.0, -1.0, 0.0])
    sgnx = np.sign(V[:, 0] - cx)
    Lraw = (sgnx[:, None] * X[None, :])
    L = Lraw - (Lraw * N).sum(axis=1, keepdims=True) * N
    Ln = np.linalg.norm(L, axis=1, keepdims=True)
    L = np.where(Ln > 1e-6, L / np.maximum(Ln, 1e-12), 0.0)
    Craw = np.broadcast_to(Zdown, (len(V), 3)).copy()
    Gv = Craw - (Craw * N).sum(axis=1, keepdims=True) * N
    Gvn = np.linalg.norm(Gv, axis=1, keepdims=True)
    Gv = np.where(Gvn > 1e-6, Gv / np.maximum(Gvn, 1e-12), 0.0)
    w = np.clip(N[:, 2], 0.0, 1.0) ** 0.5
    fB = w[:, None] * L + (1.0 - w)[:, None] * Gv
    # M21: midline behind apex: |x|<1mm uses G only (sign rule already in L)
    m21 = (np.abs(V[:, 0] - cx) < 0.001) & (V[:, 1] > apex_y)
    fB[m21] = Gv[m21]
    def no_forward(f):
        fwd = f @ Yback
        front = (V[:, 1] < ear_y) & (fwd > 0)
        f[front] = f[front] - fwd[front, None] * Yback[None, :]
        f[front] = f[front] - (f[front] * N[front]).sum(axis=1, keepdims=True) * N[front]
        return f
    fB = no_forward(fB)
    fn = np.linalg.norm(fB, axis=1, keepdims=True)
    for i in range(len(V)):
        if fn[i, 0] > 1e-9: fB[i] = fB[i] / fn[i, 0]
        else: fB[i] = L[i] if np.linalg.norm(L[i]) > 1e-9 else np.array([1.0 if V[i][0] >= cx else -1.0, 0.0, 0.0])
    # M22: 3 smoothing passes, never across the slit / x=0 in front of apex.
    sset = set(slit)
    sgnz = np.where(sgnx >= 0, 1.0, -1.0)  # zero x -> +1 group
    nblocked = 0
    for ps in range(3):
        fnew = fB.copy()
        for i in range(len(V)):
            acc = [fB[i]]; nb = 0
            for j in nbrs[i]:
                if sgnz[i] != sgnz[j] and 0.5 * (V[i][1] + V[j][1]) <= apex_y + 0.004:
                    nblocked += 1; continue
                if (i in sset or j in sset) and sgnz[i] != sgnz[j]:
                    nblocked += 1; continue
                acc.append(fB[j]); nb += 1
            m = np.mean(acc, axis=0)
            m = m - (m @ N[i]) * N[i]
            if np.linalg.norm(m) > 1e-9: fnew[i] = m / np.linalg.norm(m)
        fB = no_forward(fnew)
        fn2 = np.linalg.norm(fB, axis=1, keepdims=True)
        for i in range(len(V)):
            if fn2[i, 0] > 1e-9: fB[i] = fB[i] / fn2[i, 0]
    print("M22 smooth-passes=3 blocked-neighbour-uses=%d" % nblocked)
    # ---- gates helper (both modes) ----
    fset = set(fore)
    dfore = np.min(np.linalg.norm(V[:, None, :] - V[fore][None, :, :], axis=2), axis=1) if fore else np.full(len(V), 9.0)
    g5mask = dfore <= 0.015
    occ = crown - 0.12
    g6mask = (np.abs(V[:, 0] - cx) > 0.02) & (V[:, 2] > ear_top)
    g7mask = (V[:, 1] > apex_y + 0.01) & (V[:, 2] < occ)
    yslit = np.array([float(V[v][1]) for v in slit]) if slit else np.array([y0, apex_y])
    ymid = float(yslit.min() + 0.5 * (yslit.max() - yslit.min())) if len(yslit) else apex_y
    SP2 = V[sorted(sset0)] if sset0 else np.zeros((0, 3))
    dslit = np.min(np.linalg.norm(V[:, None, :] - SP2[None, :, :], axis=2), axis=1) if len(slit) else np.full(len(V), 9.0)
    g13mask = (dslit <= 0.025) & (V[:, 1] <= ymid) & (V[:, 1] >= float(yslit.min()) - 0.001)
    for v in sset0: g13mask[v] = False
    def gate_vals(Ff):
        fwd5 = Ff[g5mask] @ face_v
        g5pass = float((fwd5 <= 0.05).mean()) if len(fwd5) else 0.0
        g5max = float(fwd5.max()) if len(fwd5) else 9.0
        g6 = Ff[g6mask]
        g6v = float((np.sign(g6[:, 0]) == np.sign(V[g6mask][:, 0] - cx)).mean()) if len(g6) else 0.0
        g7 = Ff[g7mask]
        g7v = float((g7[:, 2] < 0).mean()) if len(g7) else 0.0
        g13 = Ff[g13mask]
        g13v = float((np.abs(g13[:, 0]) >= np.abs(g13[:, 1])).mean()) if g13mask.sum() else 0.0
        return g5pass, g5max, g6v, g7v, g13v
    g5A, g5maxA, g6A, g7A, g13A = gate_vals(fA)
    g5B, g5maxB, g6B, g7B, g13B = gate_vals(fB)
    print("G5 pass%% A=%.2f max=%.4f | B=%.2f max=%.4f (n=%d)" % (g5A * 100, g5maxA, g5B * 100, g5maxB, int(g5mask.sum())))
    print("G6 A=%.2f%% | B=%.2f%% (n=%d)" % (g6A * 100, g6B * 100, int(g6mask.sum())))
    print("G7 A=%.2f%% | B=%.2f%% (n=%d)" % (g7A * 100, g7B * 100, int(g7mask.sum())))
    print("G13 A=%.2f%% | B=%.2f%% (n=%d)" % (g13A * 100, g13B * 100, int(g13mask.sum())))
    # G15 smoothness p95 edge angle, both modes
    def g15(Ff):
        angs = []
        for a, b in E:
            if sgnz[a] != sgnz[b] and 0.5 * (V[a][1] + V[b][1]) <= apex_y + 0.004: continue
            if (a in sset or b in sset) and sgnz[a] != sgnz[b]: continue
            c = float(np.clip(Ff[a] @ Ff[b], -1.0, 1.0))
            angs.append(math.degrees(math.acos(c)))
        return float(np.percentile(angs, 95)) if angs else 0.0, len(angs)
    g15A, n15 = g15(fA); g15B, _ = g15(fB)
    print("G15 p95deg A=%.2f | B=%.2f (edges=%d)" % (g15A, g15B, n15))
    # ---- M23 streamline test, both modes on the same 300 Poisson roots ----
    fareas = np.array([0.5 * np.linalg.norm(np.cross(V[b] - V[a], V[c] - V[a])) for a, b, c in F])
    rng = np.random.default_rng(0)
    cum = np.cumsum(fareas / fareas.sum())
    cand = []
    for _ in range(6000):
        fi = int(np.searchsorted(cum, rng.random()))
        a, b, c = F[fi]
        r1, r2 = rng.random(), rng.random()
        if r1 + r2 > 1: r1, r2 = 1 - r1, 1 - r2
        cand.append(V[a] + r1 * (V[b] - V[a]) + r2 * (V[c] - V[a]))
    cand = np.array(cand)
    order_c = rng.permutation(len(cand))
    roots = []
    dmin = 0.009
    for _try in range(6):
        roots = []
        for k in order_c:
            p = cand[k]
            if all(np.linalg.norm(p - q) >= dmin for q in roots):
                roots.append(p)
                if len(roots) >= 300: break
        if len(roots) >= 300: break
        dmin *= 0.8
    roots = np.array(roots)
    print("M23 roots=%d dmin=%.1fmm" % (len(roots), dmin * 1000))
    kd = kdtree.KDTree(len(V))
    for i, p in enumerate(V): kd.insert(Vector(tuple(p)), i)
    kd.balance()
    bkd = kdtree.KDTree(len(ball))
    for k, vi in enumerate(ball): bkd.insert(Vector(tuple(V[int(vi)])), int(vi))
    bkd.balance()
    capBVH = BVHTree.FromPolygons([Vector(tuple(p)) for p in V], [tuple(f) for f in F])
    bsetq = set(int(v) for v in ball)
    def exit_class_of(bi):
        if bi in fset: return "forehead"
        yb = float(V[bi][1])
        if yb < ear_y: return "temple-to-ear"
        if yb <= ear_y + 0.030: return "behind-ear"
        return "nape"
    def trace(Ff):
        lines, raised, classes, turns, crosses = [], [], [], [], []
        nfore = nnever = ncross = 0
        for r in roots:
            p = Vector(tuple(r))
            poly = [tuple(p)]
            _, vi0, _ = kd.find(p)
            prev = Ff[vi0] / (np.linalg.norm(Ff[vi0]) + 1e-12)
            turn = 0.0
            crossed = False
            exited = None
            for _s in range(100):
                _, vi, _ = kd.find(p)
                fv = Ff[vi]; nl = float(np.linalg.norm(fv))
                if nl < 1e-9: break
                d = fv / nl
                c = float(np.clip(prev @ d, -1.0, 1.0))
                turn += math.degrees(math.acos(c))
                prev = d
                p_new = p + Vector(tuple(d * 0.002))
                hit, _, _, _ = bv.find_nearest(w2l @ p_new)
                p_proj = (l2w @ hit) if hit is not None else p_new
                px, qx = float(p[0]) - cx, float(p_proj[0]) - cx
                if px * qx < 0 and min(float(p[1]), float(p_proj[1])) < apex_y:
                    crossed = True
                _, _, _, dist = capBVH.find_nearest(p_proj)
                if dist is None or float(dist) > 0.0015:
                    _, bi, _ = bkd.find(p_proj)
                    exited = exit_class_of(int(bi))
                    poly.append(tuple(p_proj))
                    break
                p = p_proj
                poly.append(tuple(p))
            else:
                pass
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
                rp.append(tuple(np.array(q) + N[vi] * 0.0016))
            raised.append(np.array(rp))
        return lines, raised, classes, turns, crosses, nfore, nnever, ncross
    linesA, raisedA, clsA, turnA, crossA, nforeA, nneverA, ncrossA = trace(fA)
    linesB, raisedB, clsB, turnB, crossB, nforeB, nneverB, ncrossB = trace(fB)
    def hist(cls):
        h = defaultdict(int)
        for c in cls: h[c] += 1
        return {k: h[k] for k in ("forehead", "temple-to-ear", "behind-ear", "nape", "never-left")}
    hA, hB = hist(clsA), hist(clsB)
    print("EXIT-HIST A " + str(hA) + " turn_med=%.1f turn_p95=%.1f" % (float(np.median(turnA)), float(np.percentile(turnA, 95))))
    print("EXIT-HIST B " + str(hB) + " turn_med=%.1f turn_p95=%.1f" % (float(np.median(turnB)), float(np.percentile(turnB, 95))))
    # M7 sink forensics: locate each never-left root's nearest vertex, its
    # phi/flow, neighbours' phi/flow, and distance to the slit corner pins.
    sink_idx = [i for i, c in enumerate(clsB) if c == "never-left"]
    print("SINK-B count=%d roots=%s" % (len(sink_idx), sink_idx[:5]))
    for si in sink_idx[:3]:
        _, vi, _ = kd.find(Vector(tuple(roots[si])))
        nb = nbrs[vi]
        nphi = [float(phi[j]) for j in nb]
        nfl = [tuple(np.round(fB[j], 3)) for j in nb]
        pin_d = min([float(np.linalg.norm(V[vi] - V[p])) for p in pins]) if len(pins) else 9.0
        print("SINK root=%d pos=(%.4f,%.4f,%.4f) vert=%d vpos=(%.4f,%.4f,%.4f) phi=%.4f|fB|=%.4f nphi=[%.4f,%.4f] pin_d=%.2fmm in_fore=%s in_exit=%s" % (
            si, *roots[si], vi, *V[vi], float(phi[vi]), float(np.linalg.norm(fB[vi])),
            min(nphi) if nphi else 9.0, max(nphi) if nphi else -9.0, pin_d * 1000, vi in fset, vi in ex))
        print("SINK-nb ids=%s flows=%s" % (nb[:8], nfl[:8]))
    print("G14 A fore=%d never=%d (%.2f%%) cross=%d | B fore=%d never=%d (%.2f%%) cross=%d" % (
        nforeA, nneverA, 100.0 * nneverA / max(1, len(roots)), ncrossA,
        nforeB, nneverB, 100.0 * nneverB / max(1, len(roots)), ncrossB))
    np.savez(out / "flow-b-v6.npz", verts=V, faces=np.array(F), f=fB, fA=fA, w=w,
             roots=roots, exit_classes=np.array(clsB),
             slit=np.array(slit), forehead=np.array(fore), exit=np.array(EXIT),
             cx=cx, apex_y=apex_y, ear_y=ear_y)
    slines_obj = np.empty(len(linesB), dtype=object)
    for i, P in enumerate(linesB): slines_obj[i] = P
    _z = np.load(out / "flow-b-v6.npz")
    np.savez(out / "flow-b-v6.npz", **{k: _z[k] for k in _z.files}, slines=slines_obj)
    print("SAVED flow-b-v6.npz roots=%d slines=%d" % (len(roots), len(linesB)))
    # ---- render: 3 rows x 5 views ----
    for o in bpy.data.objects:
        if o is not cap and o.type in {"CURVES", "CURVE"}: o.hide_render = o.hide_viewport = True
        if "hair" in o.name.lower() and o is not cap: o.hide_render = o.hide_viewport = True
    mesh.color_attributes.new("WCol", "FLOAT_COLOR", "POINT")
    ca = mesh.color_attributes["WCol"]
    for i in range(len(V)):
        t = float(w[i])
        c = (0.10 + 0.90 * t, 0.30 + 0.15 * t, 1.00 - 0.95 * t, 1.0)
        if i in ex: c = (0.1, 0.9, 0.2, 1.0)
        if i in fset: c = (0.95, 0.1, 0.8, 1.0)
        if i in sset: c = (1.0, 1.0, 1.0, 1.0)
        ca.data[i].color = c
    # D2 render offset: lift the render mesh 0.8 mm alongNormals (analysis arrays kept pre-offset)
    bmR = bmesh.new(); bmR.from_mesh(mesh); bmR.verts.ensure_lookup_table(); bmR.normal_update()
    for v in bmR.verts: v.co = v.co + v.normal * 0.0008
    bmR.to_mesh(mesh); bmR.free(); mesh.update()
    mcap = bpy.data.materials.new("Cap6CapMat"); mcap.use_nodes = True; nt = mcap.node_tree
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
            sp = cu.splines.new("POLY"); sp.points.add(len(run) - 1)
            for k, i in enumerate(run): sp.points[k].co = (float(V[i][0]), float(V[i][1]), float(V[i][2]) + 0.001, 1.0)
            sp.use_cyclic_u = False
        o = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(o)
        m = bpy.data.materials.new(name + "M"); m.use_nodes = True
        e = m.node_tree.nodes.new("ShaderNodeEmission"); e.inputs[0].default_value = (*rgb, 1.0); e.inputs[1].default_value = 3.0
        m.node_tree.links.new(e.outputs[0], m.node_tree.nodes["Material Output"].inputs[0]); o.data.materials.append(m); return o
    tube("Cap6_EXIT", runs_for(badj, ex) or [sorted(bset)], (0.1, 0.9, 0.2), 0.0012)
    tube("Cap6_FORE", runs_for(badj, fset) or [[tL]], (0.95, 0.1, 0.8), 0.0016)
    sw = sorted(slit, key=lambda i: float(V[i][1])); tube("Cap6_SLIT", runs_for(badj, sset) or [[i for i in sw if V[i][0] <= cx], [i for i in sw if V[i][0] > cx]], (1, 1, 1), 0.0016)
    def arrows(name, Ff, rgb):
        sel = []
        for i in np.argsort(-V[:, 2]):
            p = V[i]
            if all(np.linalg.norm(p - V[j]) >= 0.010 for j in sel): sel.append(int(i))
            if len(sel) >= 700: break
        av, af = [], []
        for s in sel:
            nn = N[s]
            p, u = V[s] + nn * 0.0028, Ff[s]
            wv = np.cross(u, nn)
            if np.linalg.norm(wv) < 1e-6: wv = np.cross(u, np.array([0.0, 0.0, 1.0]))
            if np.linalg.norm(wv) < 1e-6: wv = np.array([1.0, 0.0, 0.0])
            wv = wv / np.linalg.norm(wv); v2 = np.cross(nn, u); v2 = v2 / (np.linalg.norm(v2) + 1e-12)
            b = len(av)
            for k in range(6):
                a = k / 6 * 2 * math.pi; d = wv * math.cos(a) + v2 * math.sin(a)
                av.append(tuple(p + d * 0.0011)); av.append(tuple(p + u * 0.005 + d * 0.0011))
            for k in range(6):
                k2 = (k + 1) % 6; af.append((b + 2 * k, b + 2 * k2, b + 2 * k2 + 1, b + 2 * k + 1))
            hb = len(av); tip = tuple(p + u * 0.008)
            for k in range(6):
                a = k / 6 * 2 * math.pi; d = wv * math.cos(a) + v2 * math.sin(a); av.append(tuple(p + u * 0.005 + d * 0.0024))
            av.append(tip)
            for k in range(6): af.append((hb + k, hb + (k + 1) % 6, hb + 6))
        am = bpy.data.meshes.new(name); am.from_pydata(av, [], af); am.update()
        ao = bpy.data.objects.new(name, am); bpy.context.scene.collection.objects.link(ao)
        amat = bpy.data.materials.new(name + "M"); amat.use_nodes = True
        am2 = amat.node_tree.nodes["Principled BSDF"]; am2.inputs["Base Color"].default_value = (*rgb, 1.0)
        am.materials.append(amat); return ao
    aoA = arrows("Cap6ArrowsA", fA, (0.35, 0.05, 0.05))
    aoB = arrows("Cap6ArrowsB", fB, (0.02, 0.02, 0.02))
    # ROW3 mode-B streamlines: all traced polylines as thin dark curves
    cu = bpy.data.curves.new("Cap6SLines", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.0004
    for P in raisedB:
        Q = P[::2]
        if len(Q) < 2: continue
        sp = cu.splines.new("POLY"); sp.points.add(len(Q) - 1)
        for k, q in enumerate(Q): sp.points[k].co = (float(q[0]), float(q[1]), float(q[2]), 1.0)
    so = bpy.data.objects.new("Cap6SLines", cu); bpy.context.scene.collection.objects.link(so)
    sm = bpy.data.materials.new("Cap6SLinesM"); sm.use_nodes = True
    se = sm.node_tree.nodes.new("ShaderNodeEmission"); se.inputs[0].default_value = (0.05, 0.03, 0.02, 1.0); se.inputs[1].default_value = 1.0
    sm.node_tree.links.new(se.outputs[0], sm.node_tree.nodes["Material Output"].inputs[0]); so.data.materials.append(sm)
    cap.update_tag(); aoA.update_tag(); aoB.update_tag(); so.update_tag(); bpy.context.view_layer.update()
    HSET3 = HSET; hmin, hmax = HSET3.min(axis=0), HSET3.max(axis=0)
    HC = (hmin + hmax) / 2; HH = float(hmax[2] - hmin[2])
    dist = (HH / 0.70) / (2 * math.tan(math.atan(18.0 / 50.0)))
    cam = h.camera; sc = bpy.context.scene
    def track(o, t): o.rotation_euler = (Vector(t) - o.location).to_track_quat("-Z", "Y").to_euler()
    views = [("front", HC + np.array([0, -dist, 0.03])), ("three_quarter", HC + np.array([dist * 0.68, -dist * 0.68, 0.15])), ("profile", HC + np.array([dist, 0, 0.03])), ("back", HC + np.array([0, dist, 0.10])), ("top", HC + np.array([0, -0.12, dist]))]
    sc.render.resolution_x = sc.render.resolution_y = 1024; sc.cycles.samples = 12; sc.cycles.seed = 0
    # O3 debug: mode-B arrows + streamlines, 5 views.
    for o in [aoB, so]: o.hide_render = o.hide_viewport = False
    aoA.hide_render = aoA.hide_viewport = True
    bpy.context.view_layer.update()
    cellpaths = {}
    for name, loc in views:
        cam.location = tuple(loc); track(cam, HC)
        p = out / ("dbg_%s.png" % name)
        sc.render.filepath = str(p); bpy.ops.render.render(write_still=True)
        cellpaths[("dbg", name)] = p
    from PIL import Image, ImageDraw
    # ---- cap-6 gates G1/G2 ----
    H_PX = 458.0
    def _fore_z_at(FV, FSET, side, xmm):
        vs = [v for v in FSET if (float(FV[v][0]) <= cx if side <= 0 else float(FV[v][0]) > cx)]
        ax = sorted(((abs(float(FV[v][0]) - cx), float(FV[v][2])) for v in vs))
        if not ax: return None
        if xmm <= ax[0][0]: return ax[0][1]
        for k in range(len(ax) - 1):
            if ax[k][0] <= xmm <= ax[k + 1][0]:
                x0, z0 = ax[k]; x1, z1 = ax[k + 1]
                u = 0.0 if x1 == x0 else (xmm - x0) / (x1 - x0)
                return z0 + u * (z1 - z0)
        return ax[-1][1]
    g2rows = []
    # G2: 6 |dx| columns against the MEAN target (symmetric).
    P1_MEAN = {dx: (608 - 0.5 * (P1_ROWS[dx][0] + P1_ROWS[dx][1])) / H_PX for dx in (0, 20, 40, 60, 80, 100)}
    for dx in (0, 20, 40, 60, 80, 100):
        xmm = dx / H_PX * 0.2107
        if dx == 0:
            hT = P1_MEAN[dx]
            z6 = _fore_z_at(V, set(int(v) for v in fore), 0, 0.0)
            z5 = _fore_z_at(V5, set(int(v) for v in _v5["forehead"]), 0, 0.0)
            g2rows.append({"dx": dx, "side": "C", "hT": hT,
                           "h5": (z5 - menton_z) / 0.2107, "h6": (z6 - menton_z) / 0.2107, "z6": z6})
        else:
            for side in (-1, 1):
                hT = P1_MEAN[dx]
                z6 = _fore_z_at(V, set(int(v) for v in fore), side, xmm)
                z5 = _fore_z_at(V5, set(int(v) for v in _v5["forehead"]), side, xmm)
                g2rows.append({"dx": dx, "side": ("L" if side < 0 else "R"), "hT": hT,
                               "h5": (z5 - menton_z) / 0.2107, "h6": (z6 - menton_z) / 0.2107, "z6": z6})
    g2err = max(abs(r["hT"] - r["h6"]) for r in g2rows)
    g2colerr = {}
    for dx in (0, 20, 40, 60, 80, 100):
        rr = [r for r in g2rows if r["dx"] == dx]
        g2colerr[dx] = max(abs(r["hT"] - r["h6"]) for r in rr)
    mir = 0.0
    for dx in (20, 40, 60, 80, 100):
        zL = next(r["z6"] for r in g2rows if r["dx"] == dx and r["side"] == "L")
        zR = next(r["z6"] for r in g2rows if r["dx"] == dx and r["side"] == "R")
        mir = max(mir, abs(zL - zR))
    zBL = float(V[sb6["L"]][:, 2].min()) if len(sb6["L"]) else 9.0
    zBR = float(V[sb6["R"]][:, 2].min()) if len(sb6["R"]) else 9.0
    mir = max(mir, abs(zBL - zBR))
    g2p = all(v <= 0.02 for v in g2colerr.values())
    print("G2 maxerr=%.4fH <=0.02 mirror=%.2fmm <=1 %s" % (g2err, mir * 1000, "PASS" if (g2p and mir * 1000 <= 1.0) else "MISS"))
    for r in g2rows:
        print("G2COL dx=%d %s hT=%.4f h6=%.4f err=%.4fH" % (r["dx"], r["side"], r["hT"], r["h6"], abs(r["hT"] - r["h6"])))
    # G1: area [600,680], removed/added accounting, 1 component, mirror.
    g1v = area * 1e4
    addL, addR = added["L"][1] * 1e4, added["R"][1] * 1e4
    g1p = (600 <= g1v <= 680) and (ncomp == 1) and (mir * 1000 <= 1.0) and (10.0 <= addL <= 40.0) and (10.0 <= addR <= 40.0)
    print("G1 area=%.1f [600,680] removed_forehead=%.1f added_L=%.1f added_R=%.1f cut_pinna=%.1f ncomp=%d mirror=%.2fmm %s" % (
        g1v, rem_area * 1e4, addL, addR, cut_area * 1e4, ncomp, mir * 1000, "PASS" if g1p else "MISS"))
    # G3: whole-boundary smoothness: max deviation from 9-pt run average.
    def _zone(vid):
        x, y, z = float(V[vid][0]), float(V[vid][1]), float(V[vid][2])
        if abs(x - cx) <= 0.008 and y <= apex_y + 0.003:
            return "slit"
        if y > -0.0089:
            return "nape"
        if abs(x - cx) <= 0.052 and y <= ear_front_y:
            return "front"
        if abs(x - cx) > 0.0475 and y <= -0.060:
            return "sideburn"
        return "behind-ear"
    g3max, g3where = 0.0, None
    for _run in runs_for(badj, [int(v) for v in ball]):
        _n = len(_run)
        if _n < 3:
            continue
        _closed = _run[0] in badj[_run[-1]]
        for _k in range(_n):
            if _closed:
                _idx = [_run[(_k + j) % _n] for j in range(-4, 5)]
            else:
                _idx = [_run[_k + j] for j in range(-4, 5) if 0 <= _k + j < _n]
            _m = V[_idx].mean(axis=0)
            _d = float(np.linalg.norm(V[_run[_k]] - _m))
            if _d > g3max:
                g3max, g3where = _d, (_run[_k], _zone(_run[_k]))
    g3p = g3max * 1000 <= 3.0
    print("G3 step=%.3fmm <=3 at vert=%s zone=%s %s" % (g3max * 1000, g3where[0] if g3where else None, g3where[1] if g3where else None, "PASS" if g3p else "MISS"))
    # G4: sideburn setback 8-12 mm at each P2 row/side; pinna clearance over
    # ALL cap verts; canthus plane (sideburn zone stays behind outer canthus).
    g4rows = []
    for _r, _c in zip(P2_ROWS, P2_COLS):
        _z = CANZ + (P2_EYE[1] - _r) * PX2M
        _yvis = CANY + ((_c - P2_EYE[0]) / P2_HPX) * 0.2107
        for _side in ("L", "R"):
            _ids = sb6[_side]
            if not _ids:
                g4rows.append({"row": _r, "side": _side, "setback": 9.0})
                continue
            _P = V[_ids]
            _j = int(np.argmin(np.abs(_P[:, 2] - _z)))
            g4rows.append({"row": _r, "side": _side, "setback": float((_P[_j][1] - _yvis) * 1000)})
    g4a_min = min(r["setback"] for r in g4rows); g4a_max = max(r["setback"] for r in g4rows)
    _d2 = np.linalg.norm(V[:, None, :] - EAR8A[None, :, :], axis=2).min(axis=1)
    g4b = float(_d2.min() * 1000)
    _g4bi = int(_d2.argmin())
    _cm = (np.abs(V[:, 0] - cx) > 0.044) & (V[:, 2] < 1.60)
    g4c = float((CANY - V[_cm][:, 1].min()) * 1000) if int(_cm.sum()) else -99.0
    g4p = all(8.0 <= r["setback"] <= 12.0 for r in g4rows) and (g4b > 5.0) and (g4c <= 1.0)
    print("G4 setback=[%.1f,%.1f]mm in [8,12] pinna_min=%.2fmm>5@%d canthus_infront=%.2fmm<=1 %s" % (
        g4a_min, g4a_max, g4b, _g4bi, g4c, "PASS" if g4p else "MISS"))
    for r in g4rows:
        print("G4COL row=%d %s setback=%.2fmm" % (r["row"], r["side"], r["setback"]))
    # G5: mode-B flow gates + mirror symmetry of the field.
    fore_pct = nforeB / max(1, len(roots))
    Vm = V.copy(); Vm[:, 0] = 2 * cx - Vm[:, 0]
    mir_idx = np.zeros(len(V), dtype=int)
    for i0 in range(0, len(V), 1024):
        D = np.linalg.norm(V[i0:i0 + 1024, None, :] - Vm[None, :, :], axis=2)
        mir_idx[i0:i0 + 1024] = np.argmin(D, axis=1)
    Mir = np.zeros_like(fB); Mir[:, 0] = -fB[mir_idx, 0]; Mir[:, 1] = fB[mir_idx, 1]; Mir[:, 2] = fB[mir_idx, 2]
    sym95 = float(np.percentile(np.degrees(np.arccos(np.clip((fB * Mir).sum(axis=1), -1.0, 1.0))), 95))
    g5p = (g13B >= 0.90) and (g7B >= 0.95) and (g15B <= 25.0) and (ncrossB == 0) and (nneverB == 0) and (fore_pct <= 0.02) and (sym95 <= 1.0)
    print("G5 g13=%.2f g7=%.2f g15=%.2f cross=%d sinks=%d never=%d fore=%.2f%%<=2%% sym95=%.3fdeg<=1 %s" % (
        g13B, g7B, g15B, ncrossB, nneverB, nneverB, fore_pct * 100, sym95, "PASS" if g5p else "MISS"))
    # M4 sink stall forensics: last poly point, nearest vert, local flow.
    for si in sink_idx[:3]:
        P = np.array(linesB[si])
        tip = P[-1]
        dv = np.linalg.norm(V - tip, axis=1); vi = int(dv.argmin())
        nb = nbrs[vi]
        sp = float(np.std([float(fB[j][0]) for j in nb] + [float(fB[vi][0])])) if nb else 0.0
        print("STALL root=%d npts=%d tip=(%.4f,%.4f,%.4f) vert=%d vpos=(%.4f,%.4f,%.4f) |fB|=%.4f nspread=%.4f tip_d=%.2fmm" % (
            si, len(P), tip[0], tip[1], tip[2], vi, V[vi][0], V[vi][1], V[vi][2],
            float(np.linalg.norm(fB[vi])), sp, float(dv[vi]) * 1000))
    # ---- O3 cap6-debug strip (mode-B arrows + streamlines) ----
    vnames2 = [v[0] for v in views]
    strip = [Image.open(cellpaths[("dbg", v)]).convert("RGB") for v in vnames2]
    W2, H2 = strip[0].size; lab2 = 40
    dbg = Image.new("RGB", (W2 * 5, H2 + lab2), (20, 20, 20)); dd = ImageDraw.Draw(dbg)
    for k, v in enumerate(vnames2):
        dbg.paste(strip[k], (k * W2, lab2))
        dd.text((k * W2 + 10, lab2 - 28), "cap-v6 modeB+slines %s" % v, fill=(255, 255, 0))
    dbg.save(out / "cap6-debug.png")
    # ---- O2 hairline-compare: head + v5 (red) / v6 (green) vs target + P1 ----
    for o in [aoA, aoB, so]: o.hide_render = o.hide_viewport = True
    cap.hide_render = cap.hide_viewport = True
    head.hide_render = head.hide_viewport = False
    bpy.context.view_layer.update()
    def tube_pts(name, runs_pts, rgb, r):
        runs_pts = [q for q in runs_pts if len(q) >= 1]
        if not runs_pts: return None
        cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = r
        for q in runs_pts:
            if len(q) == 1: q = [q[0], q[0]]
            sp = cu.splines.new("POLY"); sp.points.add(len(q) - 1)
            for k, pt in enumerate(q): sp.points[k].co = (float(pt[0]), float(pt[1]), float(pt[2]), 1.0)
            sp.use_cyclic_u = False
        o = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(o)
        m = bpy.data.materials.new(name + "M"); m.use_nodes = True
        e = m.node_tree.nodes.new("ShaderNodeEmission"); e.inputs[0].default_value = (*rgb, 1.0); e.inputs[1].default_value = 3.0
        m.node_tree.links.new(e.outputs[0], m.node_tree.nodes["Material Output"].inputs[0]); o.data.materials.append(m); return o
    cnt5 = defaultdict(list)
    for f in F5:
        for k in range(3):
            a, b = f[k], f[(k + 1) % 3]; cnt5[tuple(sorted((a, b)))].append(f)
    badj5 = defaultdict(set)
    for (a, b), _fs in cnt5.items():
        if len(_fs) == 1: badj5[a].add(b); badj5[b].add(a)
    off = np.array([0.0, 0.0, 0.001])
    bnd5all = set(badj5.keys()); bnd6all = set(badj.keys())
    print("TUBES v5bnd=%d v6bnd=%d (FULL loops)" % (len(bnd5all), len(bnd6all)))
    tube_pts("Cap6_BNDv5", [V5[r] + off for r in runs_for(badj5, bnd5all)], (0.95, 0.08, 0.08), 0.0016)
    tube_pts("Cap6_BNDv6", [V[r] + off for r in runs_for(badj, bnd6all)], (0.05, 0.9, 0.25), 0.0016)
    # ear landmarks as dots (yellow): front/top/lobe/lat per side.
    _dots = [PIN[s][k] for s in ("L", "R") for k in ("front", "top", "lobe", "lat")]
    tube_pts("Cap6_EARDOTS", [[tuple(p)] for p in _dots], (1.0, 0.9, 0.1), 0.0022)
    bpy.context.view_layer.update()
    cam.location = tuple(HC + np.array([0, -dist, 0.03])); track(cam, HC)
    bpy.context.view_layer.update()
    sc.render.filepath = str(out / "compare-head.png"); bpy.ops.render.render(write_still=True)
    from bpy_extras.object_utils import world_to_camera_view as _w2c
    cuv = _w2c(sc, cam, Vector((cx, apex_y, crown))); chv = _w2c(sc, cam, Vector((cx, -0.145, menton_z)))
    Hh, Ww = sc.render.resolution_y, sc.render.resolution_x
    crown_row = (1.0 - cuv.y) * Hh; chin_row = (1.0 - chv.y) * Hh
    print("COMPARE crown_row=%.1f chin_row=%.1f span=%.1f" % (crown_row, chin_row, chin_row - crown_row))
    tgt = Image.open("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back/target-front.png").convert("RGB")
    tpanel = tgt.crop((0, 150, 1024, 608)); td = ImageDraw.Draw(tpanel)
    tpts = []
    for dx in (-100, -80, -60, -40, -20, 0, 20, 40, 60, 80, 100):
        rm = 0.5 * (P1_ROWS[abs(dx)][0] + P1_ROWS[abs(dx)][1])
        tpts.append((513 + dx, rm - 150))
    td.line(tpts, fill=(0, 255, 0), width=3)
    for (x, y) in tpts: td.ellipse([x - 5, y - 5, x + 5, y + 5], outline=(0, 255, 0), width=2)
    td.text((10, 8), "target + P1 (green)", fill=(0, 255, 0))
    cmpim = Image.open(out / "compare-head.png").convert("RGB")
    span = chin_row - crown_row; scl = 458.0 / span
    hpanel = cmpim.crop((0, int(round(crown_row)), 1024, int(round(chin_row)))).resize((int(round(1024 * scl)), 458))
    hd = ImageDraw.Draw(hpanel)
    hd.text((10, 8), "head + v5 boundary (red) + v6 boundary (green)", fill=(0, 255, 0))
    comp = Image.new("RGB", (1024 + hpanel.size[0] + 20, 458 + 40), (20, 20, 20)); cd = ImageDraw.Draw(comp)
    comp.paste(tpanel, (0, 40)); comp.paste(hpanel, (1044, 40))
    cd.text((10, 8), "hairline-compare: same crown-to-chin scale (458px)", fill=(255, 255, 0))
    comp.save(out / "hairline-compare.png")
    # ---- O2 profile: our head + FULL v5 (red) / v6 (green) vs TS profile ----
    cam.location = tuple(HC + np.array([dist, 0, 0.03])); track(cam, HC)
    bpy.context.view_layer.update()
    sc.render.filepath = str(out / "compare-profile.png"); bpy.ops.render.render(write_still=True)
    tgtP = Image.open("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back/target-profile.png").convert("RGB")
    tpd = ImageDraw.Draw(tgtP)
    P2PTS = list(zip(P2_COLS, P2_ROWS))
    tpd.line(P2PTS, fill=(255, 0, 255), width=3)
    for (x, y) in P2PTS: tpd.ellipse([x - 5, y - 5, x + 5, y + 5], outline=(255, 0, 255), width=2)
    tpd.text((10, 8), "target + P2 visible edge (magenta)", fill=(255, 0, 255))
    cmpP = Image.open(out / "compare-profile.png").convert("RGB")
    prof = Image.new("RGB", (1024 + 1024 + 20, 1024 + 40), (20, 20, 20)); pd = ImageDraw.Draw(prof)
    prof.paste(tgtP, (0, 40)); prof.paste(cmpP, (1044, 40))
    pd.text((10, 8), "profile: target + P2 edge | head + FULL v5 (red) + v6 (green) + ear dots (yellow)", fill=(255, 255, 0))
    prof.save(out / "hairline-compare-profile.png")
    # ---- O4 row-cap6.json ----
    rowcap = {
        "p1": {"face_cx": 513, "hair_top_row": 127, "skull_crown_row": 150, "chin_row": 608, "H_px": 458,
               "method": "vertical gradient + 2D temple line-fit; centre part-tip +-5px, outer +-6px",
               "rows_LR": {str(k): list(v) for k, v in sorted(P1_ROWS.items())},
               "h_frac_avg": [round(float(v), 5) for v in P1_H],
               "dx_over_H": [round(float(v / H_PX), 5) for v in (0, 20, 40, 60, 80, 100)]},
        "p2": {"profile_H": 452, "rows": list(P2_ROWS), "hair_front_col": list(P2_COLS),
               "eye_outer_col": 347, "eye_row": 348, "offsets_H": [round(float(o), 4) for o in P2_OFF],
               "lobe_row_est": 457.0, "departure_row": 475.0, "root_bottom_row": 425.0,
               "note": "forward-most hair col per row on JM mask-profile-v2; lobe eye-mapped from our-lobe z=1.5037; departure where edge leaves cheek; root bottom = lobe+15mm"},
        "p3": {"canthus_L": [round(float(v), 5) for v in CAN["L"]], "canthus_R": [round(float(v), 5) for v in CAN["R"]],
               "pinna_L": {k: [round(float(v), 5) for v in PIN["L"][k]] for k in ("front", "top", "lobe", "lat")},
               "pinna_R": {k: [round(float(v), 5) for v in PIN["R"][k]] for k in ("front", "top", "lobe", "lat")},
               "note": "canthus = outermost eyelash vert; pinna zones on head mesh; mirror error printed in log"},
        "p4": {"brow_id": int(brow_id), "brow_z": round(float(brow_z), 5),
               "nasion_id": int(nasion_id), "nasion_z": round(float(nasion_z), 5),
               "menton_z": round(float(menton_z), 5),
               "note": "old brow_z=1.5303 was nasal bone; true brow ridge is the most anterior midline vert above the nasion"},
        "gates": {
            "g1": {"area_cm2": round(g1v, 2), "removed_forehead_cm2": round(float(rem_area * 1e4), 2),
                   "added_L_cm2": round(addL, 2), "added_R_cm2": round(addR, 2),
                   "cut_pinna_cm2": round(float(cut_area * 1e4), 2),
                   "ncomp": ncomp, "nloops": nloops, "mirror_mm": round(float(mir * 1000), 3), "pass": bool(g1p)},
            "g2": {"maxerr_H": round(float(g2err), 5), "pass": bool(g2p and mir * 1000 <= 1.0),
                   "cols": [{"dx": r["dx"], "side": r["side"], "hT": round(float(r["hT"]), 4), "h5": round(float(r["h5"]), 4), "h6": round(float(r["h6"]), 4)} for r in g2rows]},
            "g3": {"step_mm": round(float(g3max * 1000), 3), "at_vert": g3where[0] if g3where else None,
                   "at_zone": g3where[1] if g3where else None, "pass": bool(g3p)},
            "g4": {"setback_min_mm": round(float(g4a_min), 2), "setback_max_mm": round(float(g4a_max), 2),
                   "pinna_min_mm": round(float(g4b), 2), "pinna_at_vert": int(_g4bi),
                   "canthus_infront_mm": round(float(g4c), 2), "pass": bool(g4p),
                   "cols": [{"row": r["row"], "side": r["side"], "setback_mm": round(float(r["setback"]), 2)} for r in g4rows]},
            "g5": {"g13": round(float(g13B), 4), "g7": round(float(g7B), 4), "g15": round(float(g15B), 2),
                   "cross": int(ncrossB), "sinks": int(nneverB), "never": int(nneverB),
                   "fore_pct": round(float(fore_pct), 4), "sym95_deg": round(float(sym95), 3), "pass": bool(g5p)}},
        "acct": {"removed_forehead_cm2": round(float(rem_area * 1e4), 2),
                 "added_L_cm2": round(addL, 2), "added_R_cm2": round(addR, 2),
                 "cut_pinna_cm2": round(float(cut_area * 1e4), 2),
                 "added_where": "sideburn tongues (P2 edge +10mm setback, lobe+15mm bottom)",
                 "removed_where": "front y<=ear_front_y ax<=46.5mm below-zc6 (exact-P1 forehead strip)"},
        "sink": {"count": int(nneverB), "roots": [int(i) for i in sink_idx[:5]]},
        "flow_b": {"hist": {k: int(hB[k]) for k in ("forehead", "temple-to-ear", "behind-ear", "nape", "never-left")},
                   "g5B": round(float(g5B), 4), "g6B": round(float(g6B), 4)},
        "files": ["flow7.py", "cap-v6.npz", "flow-b-v6.npz", "hairline-compare.png", "hairline-compare-profile.png",
                  "cap6-debug.png", "target-sideburn-overlay.png", "compare-head.png", "compare-profile.png",
                  "row-cap6.json", "check-cap6.mjs", "RESULT.txt"]}
    J.dump(rowcap, open(out / "row-cap6.json", "w"), indent=1)
    with (out / "RESULT.txt").open("w") as s:
        s.write("RESULT::hair-cap-6\n")
        s.write("P1::cx=513 crown=127 skull=150 chin=608 H=458 rows(dx:L/R)=%s\n" % (
            " ".join("%d:%d/%d" % (k, v[0], v[1]) for k, v in sorted(P1_ROWS.items()))))
        s.write("P2::rows=%s\n" % (" ".join("r%d:c%d=%.4fH" % (r, c, o) for r, c, o in zip(P2_ROWS, P2_COLS, P2_OFF))))
        s.write("P2::lobe_row_est=457 departure_row=475 root_bottom_row=425 (+21.5px=10mm root line)\n")
        s.write("P3::canthus L=(%.1f,%.1f,%.5f) R=(%.1f,%.1f,%.5f)\n" % (
            CAN["L"][0] * 1000, CAN["L"][1] * 1000, CAN["L"][2], CAN["R"][0] * 1000, CAN["R"][1] * 1000, CAN["R"][2]))
        s.write("P3::ear-front L=(%.1f,%.1f,%.4f) R=(%.1f,%.1f,%.4f) | top Lz=%.4f Rz=%.4f | lobe Lz=%.4f Rz=%.4f\n" % (
            PIN["L"]["front"][0] * 1000, PIN["L"]["front"][1] * 1000, PIN["L"]["front"][2],
            PIN["R"]["front"][0] * 1000, PIN["R"]["front"][1] * 1000, PIN["R"]["front"][2],
            PIN["L"]["top"][2], PIN["R"]["top"][2], PIN["L"]["lobe"][2], PIN["R"]["lobe"][2]))
        s.write("P4::brow id=%d z=%.5f nasion id=%d z=%.5f (old 1.5303 was nose)\n" % (int(brow_id), float(brow_z), int(nasion_id), float(nasion_z)))
        for dx in (0, 20, 40, 60, 80, 100):
            rr = [r for r in g2rows if r["dx"] == dx]
            hT = rr[0]["hT"]
            h5 = sum(r["h5"] for r in rr) / len(rr)
            h6 = sum(r["h6"] for r in rr) / len(rr)
            s.write("HAIRLINE::%.5f target %.4f | ours-v5 %.4f | ours-v6 %.4f\n" % (dx / H_PX, hT, h5, h6))
        s.write("G1::area=%.1f [600,680] removed_forehead=%.1f added_L=%.1f added_R=%.1f cut_pinna=%.1f ncomp=%d nloops=%d mirror=%.2fmm<=1 %s\n" % (
            g1v, rem_area * 1e4, addL, addR, cut_area * 1e4, ncomp, nloops, mir * 1000, "PASS" if g1p else "MISS"))
        s.write("G2::maxerr=%.4fH<=0.02 cols=%s %s\n" % (
            g2err, ",".join("%d:%.4f" % (dx, g2colerr[dx]) for dx in (0, 20, 40, 60, 80, 100)), "PASS" if (g2p and mir * 1000 <= 1.0) else "MISS"))
        s.write("G3::step=%.3fmm<=3 at_vert=%s zone=%s %s\n" % (
            g3max * 1000, g3where[0] if g3where else None, g3where[1] if g3where else None, "PASS" if g3p else "MISS"))
        s.write("G4::setback=[%.1f,%.1f]mm in [8,12] pinna_min=%.2fmm>5 canthus_infront=%.2fmm<=1 %s\n" % (
            g4a_min, g4a_max, g4b, g4c, "PASS" if g4p else "MISS"))
        s.write("G5::g13=%.2f>=0.90 g7=%.2f>=0.95 g15=%.2f<=25 cross=%d sinks=%d never=%d fore=%.2f%%<=2%% sym95=%.3fdeg<=1 %s\n" % (
            g13B, g7B, g15B, ncrossB, nneverB, nneverB, fore_pct * 100, sym95, "PASS" if g5p else "MISS"))
        s.write("HIST-B::" + " ".join("%s=%d" % (k, hB[k]) for k in ("forehead", "temple-to-ear", "behind-ear", "nape", "never-left")) + "\n")
        s.write("SINK::count=%d roots=%s (see log SINK/STALL lines; cause fix in M4)\n" % (len(sink_idx), sink_idx[:5]))
        s.write("SAW::pending-visual\n")
        causes = []
        if not g1p: causes.append("G1")
        if not (g2p and mir * 1000 <= 1.0): causes.append("G2")
        if not g3p: causes.append("G3")
        if not g4p: causes.append("G4")
        if not g5p: causes.append("G5")
        s.write("CAUSE::%s\n" % ("none" if not causes else ("MISS " + ",".join(causes) + " see row-cap6.json")))
        s.write("COMMIT::uncommitted\nSTILL::guides/children/hair renders (later cards)\nBRIEF_MISSING::none\nHARM::none\n")
    print("WROTE", out)
    print("WROTE", out)
main()
