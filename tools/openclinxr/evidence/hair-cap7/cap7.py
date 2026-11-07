"""Hair-cap-7 (level set, no curve cutting): cap-v7 from s(v)=min(elev,ear).
M1: spherical coords about C=(cx,ear_y,Cz=menton+0.55*H): a=atan2(x-cx,
  -(y-Cy)) (0 fwd, +-90 sides, 180 back), e=asin((z-Cz)/|p-C|).
M2: hairline eh(|a|) (mirror-symmetric PCHIP): P1 front arch (Y-rays), P2
  sideburn ROOT +10mm (X-rays) to lobe+15mm, cap-v5 boundary behind smoothed
  with a 25-deg window. IN when e>eh(|a|).
M3: ear exclusion g(p)=dist(p,dense pinna set)-6mm; IN requires g>0.
M4: s(v)=min((e-eh)*rad2mm, g) on head copy (z>menton-0.02); refine crossing
  tris to <=2mm, marching triangles at s=0 keep s>0, largest component, weld.
M5: subdiv cap to ~2mm, slit x=0 front->apex (flow8 does flow). Run: Blender -b --python cap7.py -- --out E
"""
import argparse, importlib.util, math, sys
from collections import defaultdict
from pathlib import Path
import bpy, bmesh, numpy as np
from mathutils import Vector
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
    crown = float(zs.max()); ai = int(zs.argmax()); apex = ws[ai]; apex_y = float(apex[1])
    HSET = ws[zs > crown-0.26]; hx, hy, hz = HSET[:, 0], HSET[:, 1], HSET[:, 2]
    cx, cy = float(np.median(hx)), float(np.median(hy))
    band = HSET[(hz >= crown-0.17) & (hz <= crown-0.09)]
    eL = band[band[:, 0].argmax()]; eR = band[band[:, 0].argmin()]
    eLz = float(band[np.linalg.norm(band-eL, axis=1) <= 0.015][:, 2].max())
    eRz = float(band[np.linalg.norm(band-eR, axis=1) <= 0.015][:, 2].max())
    ear_top = min(eLz, eRz); ear_y = float(0.5*(eL[1]+eR[1]))
    H_HEAD = 0.2107; menton_z = crown-H_HEAD
    midmask = np.abs(xs-cx) < 0.004
    _cb = sorted((float(ys[i]), float(zs[i]), int(i)) for i in np.where(midmask & (zs > 1.56))[0])
    brow_y, brow_z, brow_id = _cb[0]
    _cn = sorted(((float(ys[i]), float(zs[i]), int(i)) for i in np.where(midmask & (zs >= 1.54) & (zs <= 1.56))[0]), reverse=True)
    nasion_y, nasion_z, nasion_id = _cn[0]
    print("P4 brow id=%d z=%.5f nasion id=%d z=%.5f menton_z=%.5f" % (brow_id, brow_z, nasion_id, nasion_z, menton_z))
    P1_H = np.array([0.87336, 0.86681, 0.86354, 0.84389, 0.80022, 0.68668])
    P1_Z = menton_z+P1_H*H_HEAD; DXMM = np.array([0.0, 9.2009, 18.4017, 27.6026, 36.8035, 46.0044])
    P2_ROWS = [220, 250, 280, 310, 340, 370, 400, 430]; P2_COLS = [390, 398, 403, 408, 413, 422, 436, 443]
    P2_EYE = (347, 348); P2_HPX = 452.0; PX2M = H_HEAD/P2_HPX
    P2_OFF = [(c-P2_EYE[0])/P2_HPX for c in P2_COLS]
    print("P1 " + " ".join("dx%.0f:h%.4f" % (d, hh) for d, hh in zip(DXMM, P1_H)))
    print("P2 " + " ".join("r%d:c%d=%.4fH" % (r, c, o) for r, c, o in zip(P2_ROWS, P2_COLS, P2_OFF)))
    lash = [o for o in bpy.data.objects if "eyelash" in o.name][0]
    wl = np.array([tuple(lash.matrix_world @ v.co) for v in lash.data.vertices])
    CAN = {}
    for _side, _sgn in (("L", 1), ("R", -1)):
        _pts = wl[wl[:, 0]*_sgn > 0]; _i = int(np.argmax(_pts[:, 0]*_sgn))
        CAN[_side] = (float(_pts[_i][0]), float(_pts[_i][1]), float(_pts[_i][2]))
    print("P3 canthus L=(%.1f,%.1f,%.5f) R=(%.1f,%.1f,%.5f)" % (CAN["L"][0]*1000, CAN["L"][1]*1000, CAN["L"][2], CAN["R"][0]*1000, CAN["R"][1]*1000, CAN["R"][2]))
    fs = [[v for v in p.vertices] for p in head.data.polygons]
    headBVH = BVHTree.FromPolygons([Vector(tuple(p)) for p in ws], [tuple(int(v) for v in f) for f in fs])
    # M6 (7b): PINNA by protrusion via medial-ray gap, not density.
    # Ear box per brief: |x|>55mm, y within +-45mm of ear_y, z lobe..top+8mm.
    # Smooth skull = skull surface behind the ear found by a medial ray
    # (-sign(x)); protrusion gap = distance to that hit. Measured on this
    # head: earbox 780 verts (390/390); gap p10=7.3mm, median=135.6mm.
    # Pinna flap = gap<20mm (128 verts); attachment base ring = gap<5mm
    # (58 verts). Dense temporal strip (96 verts at y<-84mm) is already
    # outside this ear box. Ellipsoid/grid smooth-skull fits were unstable
    # on this patch (hyperboloid / all-protruding), so the medial-ray skull
    # is used as the smooth-skull surface; thresholds adapted to measured gap.
    lobe_z = float(1.50371)
    earbox = ((np.abs(xs) > 0.055) & (np.abs(ys-ear_y) < 0.045)
              & (zs > lobe_z-0.005) & (zs < ear_top+0.008))
    _ebidx = np.where(earbox)[0]
    _gap = np.full(len(_ebidx), 9.0)
    for _k, _i in enumerate(_ebidx):
        _p = ws[_i]; _sgn = 1.0 if _p[0] > 0 else -1.0
        _o = Vector((float(_p[0]-_sgn*0.001), float(_p[1]), float(_p[2])))
        _hit = headBVH.ray_cast(_o, Vector((-_sgn, 0.0, 0.0)), 100.0)
        if _hit[0] is not None:
            _q = np.array(_hit[0]); _s = np.array([_sgn*0.001, 0.0, 0.0])
            _gap[_k] = float(np.linalg.norm(_q-(_p-_s)))
    _pinna_m = _gap < 0.020
    _att_m = _gap < 0.005
    PIN = {}
    for _side, _sgn in (("L", 1), ("R", -1)):
        _sel = _ebidx[_pinna_m & ((ws[_ebidx][:, 0] > 0) if _sgn > 0 else (ws[_ebidx][:, 0] < 0))]
        _pts = ws[_sel] if len(_sel) else ws[_ebidx[:1]]
        PIN[_side] = {"front": tuple(float(v) for v in _pts[int(np.argmin(_pts[:, 1]))]), "top": tuple(float(v) for v in _pts[int(np.argmax(_pts[:, 2]))]), "lobe": tuple(float(v) for v in _pts[int(np.argmin(_pts[:, 2]))]), "idx": _sel}
    for _k in ("front", "top", "lobe"):
        print("P3 ear-%s L=(%.1f,%.1f,%.4f) R=(%.1f,%.1f,%.4f)" % (_k, PIN["L"][_k][0]*1000, PIN["L"][_k][1]*1000, PIN["L"][_k][2], PIN["R"][_k][0]*1000, PIN["R"][_k][1]*1000, PIN["R"][_k][2]))
    # attachment set, mirror-symmetrized (closure under x-mirror) so g is symmetric
    _att_idx = _ebidx[_att_m]
    _att_pos = ws[_att_idx]
    _mir = _att_pos.copy(); _mir[:, 0] = 2*cx-_mir[:, 0]
    ESET = np.concatenate([_att_pos, _mir]) if len(_att_pos) else _att_pos
    _pin_full = np.zeros(len(ws), bool); _pin_full[_ebidx[_pinna_m]] = True
    print("P3 M6 earbox=%d pinna=%d (L=%d R=%d) attach=%d ESETsym=%d gap_med=%.1fmm" % (
        int(earbox.sum()), int(_pinna_m.sum()),
        int(((_pinna_m) & (ws[_ebidx][:, 0] > 0)).sum()), int(((_pinna_m) & (ws[_ebidx][:, 0] < 0)).sum()),
        len(_att_idx), len(ESET), float(np.median(_gap))*1000))
    # M1 centre + coords
    Cy = float(ear_y); Cz = float(menton_z+0.55*H_HEAD)
    print("M1 C=(%.4f,%.4f,%.4f)" % (cx, Cy, Cz))
    def ae_of(P):
        d = P-np.array([cx, Cy, Cz]); r = np.linalg.norm(d, axis=1)+1e-12
        a = np.degrees(np.arctan2(P[:, 0]-cx, -(P[:, 1]-Cy)))
        e = np.degrees(np.arcsin(np.clip((P[:, 2]-Cz)/r, -1, 1)))
        return np.abs(a), e, r
    # M2 front controls: Y-rays at (cx+-dx, P1_Z)
    front = []
    for k, dx in enumerate(DXMM):
        ee, aa = [], []
        for sgn in (1, -1) if dx > 0 else (0,):
            ox = cx+sgn*dx/1000.0
            hit = headBVH.ray_cast(Vector((ox, Cy-0.30, float(P1_Z[k]))), Vector((0.0, 1.0, 0.0)))
            p = np.array(hit[0]) if hit[0] is not None else ws[int(np.linalg.norm(ws-np.array([ox, -0.10, float(P1_Z[k])]), axis=1).argmin())]
            _a, _e, _ = ae_of(p[None, :]); ee.append(float(_e[0])); aa.append(float(_a[0]))
        front.append((float(np.mean(aa)), float(np.mean(ee))))
        print("FRONT dx=%.1fmm |a|=%.2fdeg e=%.2fdeg" % (dx, front[-1][0], front[-1][1]))
    # M2 sideburn ROOT: P2 edge +10mm, X-rays (step forward off pinna)
    CANY = 0.5*(CAN["L"][1]+CAN["R"][1]); CANZ = 0.5*(CAN["L"][2]+CAN["R"][2])
    ZB = float(PIN["L"]["lobe"][2])+0.015
    sb_yz = [(CANY+off*H_HEAD+0.010, CANZ+(P2_EYE[1]-r)*PX2M) for r, off in zip(P2_ROWS, P2_OFF)]+[(-0.0790, ZB)]
    sb = []
    for (yy, zz) in sb_yz:
        got = None
        for dy in (0.0, -0.004, -0.008, -0.012, -0.016):
            hit = headBVH.ray_cast(Vector((cx+0.25, yy+dy, zz)), Vector((-1.0, 0.0, 0.0)))
            if hit[0] is None: continue
            q = (float(hit[0][0]), float(hit[0][1]), float(hit[0][2]))
            # M8: root must sit on cheek/skull, never on the pinna flap
            # (flap |x-cx|~68mm+; cheek <=66mm). Step forward off pinna.
            if abs(q[0]-cx) <= 0.066: got = np.array(q); break
        if got is None:
            _d = np.linalg.norm(ws-np.array([cx+0.07, yy, zz]), axis=1); got = ws[int(_d.argmin())]
        _a, _e, _ = ae_of(got[None, :]); sb.append((float(_a[0]), float(_e[0])))
        print("SB y=%.1fmm z=%.4f |a|=%.2fdeg e=%.2fdeg" % (yy*1000, zz, sb[-1][0], sb[-1][1]))
    # M2 behind/nape: cap-v5 boundary, y>-0.06, smoothed 25-deg window
    _v5 = np.load(str(HERE.parent/"hair-cap5"/"cap-v5.npz"))
    V5 = np.array(_v5["verts"]); F5 = [tuple(f) for f in np.array(_v5["faces"])]
    _b5, _g5, _o5, _c5, _a5 = boundary_info(F5)
    print("V5DIAG f=%d groups=%d sizes=%s" % (len(F5), len(_g5), [len(g) for g in _g5][:8]))
    b5 = np.array(sorted({v for g in _g5 for v in g}), dtype=np.int64)
    v5slit = set(int(v) for v in _v5["slit"])
    A5b, E5b, _ = ae_of(V5[b5])
    behind = np.array([v for v, a in zip(b5, np.abs(A5b)) if a >= 60.0 and int(v) not in v5slit], dtype=np.int64)
    A0, E0, _ = ae_of(V5[behind])
    A0 = np.abs(A0); idx = np.argsort(A0); A0, E0 = A0[idx], E0[idx]
    Es = np.array([float(np.mean(E0[np.abs(A0-a) <= 12.5])) for a in A0])
    print("BEHIND n=%d |a|=[%.1f,%.1f]" % (len(A0), A0.min() if len(A0) else 0, A0.max() if len(A0) else 0))
    # M7 (7b): front arch by direct solve. The six P1 controls below are used
    # EXACTLY as the eh control points for |a| below the temple: eh(a) for
    # a<=max(front A) is PCHIP through the six front pairs only, so no
    # sideburn/behind control can drag the arch (D2: pooling 188cm2 removed).
    # Tail (a>max front) is PCHIP through [last two front + sideburn +
    # behind] for C0 continuity. Isotonic pooling applies to the tail only.
    FA = np.array([p[0] for p in front]); FE = np.array([p[1] for p in front])
    _fo = np.argsort(FA); FA, FE = FA[_fo], FE[_fo]
    eh_front = pchip(FA, FE)
    SA = np.array([p[0] for p in sb]); SE = np.array([p[1] for p in sb])
    _so = np.argsort(SA); SA, SE = SA[_so], SE[_so]
    TA = np.concatenate([FA[-2:], SA, A0]); TE = np.concatenate([FE[-2:], SE, Es])
    _to = np.argsort(TA, kind="stable"); TA, TE = TA[_to], TE[_to]
    sbs = (TA >= 35.0) & (TA <= 60.0)
    if int(sbs.sum()) >= 3:
        y = [float(v) for v in TE[sbs]]; blocks = [[v] for v in y]; i = 0
        while i < len(blocks)-1:
            a = sum(blocks[i])/len(blocks[i]); b = sum(blocks[i+1])/len(blocks[i+1])
            if a < b: blocks[i] = blocks[i]+blocks[i+1]; del blocks[i+1]; i = max(0, i-1)
            else: i += 1
        flat = []
        for bl in blocks: flat += [sum(bl)/len(bl)]*len(bl)
        TE[sbs] = np.array(flat)
        print("ISOTONIC tail pooled=%d blocks=%d" % (int(sbs.sum()), len(blocks)))
    _Tu = sorted(set(round(float(a), 1) for a in TA))
    _Te = [float(np.mean(TE[np.abs(TA-a) < 0.5])) for a in _Tu]
    eh_tail = pchip(np.array(_Tu), np.array(_Te))
    _Amax = float(FA.max())
    def eh(a):
        a = np.asarray(a, float)
        return np.where(a <= _Amax, eh_front(a), eh_tail(np.maximum(a, _Tu[0])))
    Au = np.array(_Tu); Eu = np.array(_Te)
    # full table (front six + tail) for flow8's ehf use
    _F = np.concatenate([FA[:-2], np.array(_Tu)]); _G = np.concatenate([FE[:-2], np.array(_Te)])
    _fo2 = np.argsort(_F, kind="stable"); _F, _G = _F[_fo2], _G[_fo2]
    AuF = sorted(set(round(float(a), 1) for a in _F))
    EuF = [float(np.mean(_G[np.abs(_F-a) < 0.5])) for a in AuF]
    Au, Eu = np.array(AuF), np.array(EuF)
    print("EH front n=6 |a|=[%.2f,%.2f] tail n=%d" % (FA[0], _Amax, len(_Tu)))
    for a, e in zip(FA, FE):
        print("EHFRONT |a|=%.2f e=%.2f" % (a, e))
    # M7 verify G2 BEFORE building the rest: level-set value at the six
    # target surface points must be ~0 (eh passes through them by construction)
    D2E = math.pi/180.0
    _g2v = []
    for k, dx in enumerate(DXMM):
        ox = cx+dx/1000.0
        hit = headBVH.ray_cast(Vector((ox, Cy-0.30, float(P1_Z[k]))), Vector((0.0, 1.0, 0.0)))
        p = np.array(hit[0]) if hit[0] is not None else ws[int(np.linalg.norm(ws-np.array([ox, -0.10, float(P1_Z[k])]), axis=1).argmin())]
        _a, _e, _r = ae_of(p[None, :])
        _lv = (float(_e[0])-float(eh(np.array([float(_a[0])]))[0]))*D2E*float(_r[0])*1000
        _g2v.append(abs(_lv))
        print("G2-VERIFY dx=%.1f |a|=%.2f e=%.2f surf=(%.4f,%.4f,%.4f) level=%.2fmm" % (
            dx, float(_a[0]), float(_e[0]), float(p[0]), float(p[1]), float(p[2]), _lv))
    print("G2-VERIFY max=%.2fmm %s" % (max(_g2v), "PASS" if max(_g2v) <= 1.0 else "MISS-stopslice"))
    # M6 field: g = distance to pinna ATTACHMENT set - 5mm; pinna flap
    # itself is OUT via pin_field (dist to flap - 1mm). Skull far from the
    # base stays IN, so the temple above the ear is covered (D1 fix).
    _flap_idx = _ebidx[_pinna_m]
    _flap_pos = ws[_flap_idx]
    _flap_mir = _flap_pos.copy(); _flap_mir[:, 0] = 2*cx-_flap_mir[:, 0]
    PSET = np.concatenate([_flap_pos, _flap_mir]) if len(_flap_pos) else _flap_pos
    def s_of(P, chunk=2048):
        A1, E1, R = ae_of(P)
        elev = (E1-eh(A1))*D2E*R
        g = np.empty(len(P)); pf = np.empty(len(P))
        for i0 in range(0, len(P), chunk):
            Q = P[i0:i0+chunk]
            g[i0:i0+chunk] = np.linalg.norm(Q[:, None, :]-ESET[None, :, :], axis=2).min(axis=1)-0.005
            pf[i0:i0+chunk] = np.linalg.norm(Q[:, None, :]-PSET[None, :, :], axis=2).min(axis=1)-0.001
        return np.minimum(np.minimum(elev, g), pf), elev, g
    # M8 verify G4 numerically on the level set before cutting: at each P2
    # row the IN band's front edge must sit ~10mm behind the visible edge.
    for _r, _c, _off in zip(P2_ROWS, P2_COLS, P2_OFF):
        _yv = CANY+_off*H_HEAD; _zz = CANZ+(P2_EYE[1]-_r)*PX2M
        _ys = np.linspace(_yv-0.010, _yv+0.030, 41)
        _pts = []
        for _y in _ys:
            _hit = headBVH.ray_cast(Vector((cx+0.25, float(_y), float(_zz))), Vector((-1.0, 0.0, 0.0)))
            _pts.append(np.array(_hit[0]) if _hit[0] is not None else np.array([cx+0.07, float(_y), float(_zz)]))
        _pts = np.array(_pts)
        _s, _, _ = s_of(_pts)
        _ins = [float(_y) for _y, _v in zip(_ys, _s > 0)]
        _front = min(_ins) if _ins else float("nan")
        print("G4-VERIFY row=%d edge_y=%.1fmm setback=%.1fmm %s" % (
            _r, _front*1000, (_front-_yv)*1000,
            "PASS" if 0.008 <= (_front-_yv) <= 0.014 else "CHECK"))
    # M4 head copy restricted to z>menton-0.02, triangulated
    bm0 = bmesh.new(); bm0.from_mesh(head.data)
    for v in bm0.verts: v.co = Mw @ v.co
    bmesh.ops.triangulate(bm0, faces=list(bm0.faces))
    tmp = bpy.data.meshes.new("Cap7_tmp"); bm0.to_mesh(tmp); bm0.free()
    Vall = np.array([tuple(v.co) for v in tmp.vertices])
    Fall = np.array([tuple(p.vertices) for p in tmp.polygons], dtype=np.int64)
    cen = Vall[Fall].mean(axis=1)
    keep = cen[:, 2] > menton_z-0.02
    F = Fall[keep]; used = np.unique(F)
    remap = np.full(len(Vall), -1); remap[used] = np.arange(len(used))
    V = Vall[used]; F = remap[F]
    bpy.data.meshes.remove(tmp)
    print("HEADRESTRICT v=%d f=%d" % (len(V), len(F)))
    # conforming midpoint subdivision (2 rounds: ~4mm -> ~1mm). Conforming
    # by construction (shared edge map): no T-junction cracks, so the march
    # keeps one connected cap including the hairline band.
    def split_all(V, F):
        em = {}; Vl = [np.array(p) for p in V]; NF = []
        def mid(a, b):
            k = (a, b) if a < b else (b, a)
            if k not in em: em[k] = len(Vl); Vl.append((Vl[a]+Vl[b])/2.0)
            return em[k]
        for (a, b, c) in [tuple(int(v) for v in f) for f in F]:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            NF += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        return np.array(Vl), np.array(NF, dtype=np.int64)
    for _r in range(2):
        V, F = split_all(V, F)
        print("SPLIT round=%d v=%d f=%d" % (_r, len(V), len(F)))
    s, _, _ = s_of(V)
    # marching triangles at s=0
    emap = {}; newp = []; NF = []
    def zero(a, b):
        k = (a, b) if a < b else (b, a)
        if k not in emap:
            t = float(s[a]/(s[a]-s[b]))
            emap[k] = len(V)+len(newp); newp.append(V[a]+t*(V[b]-V[a]))
        return emap[k]
    pos = s > 1e-9
    for (a, b, c) in [tuple(int(v) for v in f) for f in F]:
        pa, pb, pc = pos[a], pos[b], pos[c]
        n = int(pa)+int(pb)+int(pc)
        if n == 3: NF.append((a, b, c))
        elif n == 0: continue
        elif n == 1:
            i0 = a if pa else (b if pb else c); j1, j2 = [v for v in (a, b, c) if v != i0]
            NF.append((i0, zero(i0, j1), zero(i0, j2)))
        else:
            i0 = a if not pa else (b if not pb else c); j1, j2 = [v for v in (a, b, c) if v != i0]
            c1, c2 = zero(j1, i0), zero(j2, i0)
            NF += [(j1, j2, c1), (j2, c2, c1)]
    Vc = np.concatenate([V, np.array(newp)]) if newp else V.copy()
    Fc = np.array(NF, dtype=np.int64)
    sn, _, _ = s_of(Vc[len(s):]) if newp else (np.array([]), None, None)
    sc = np.concatenate([s, sn])
    print("MARCH v=%d f=%d" % (len(Vc), len(Fc)))
    # largest component
    em = defaultdict(list)
    for fi, f in enumerate(Fc):
        for k in range(3): em[tuple(sorted((f[k], f[(k+1) % 3])))].append(fi)
    adj = [set() for _ in range(len(Fc))]
    for o in em.values():
        for i in o:
            for j in o:
                if i != j: adj[i].add(j)
    seen = np.full(len(Fc), -1); nc = 0; best = []
    for i in range(len(Fc)):
        if seen[i] >= 0: continue
        st = [i]; seen[i] = nc; cf = [i]
        while st:
            x = st.pop()
            for y in adj[x]:
                if seen[y] < 0: seen[y] = nc; st.append(y); cf.append(y)
        if len(cf) > len(best): best = cf
        nc += 1
    Fc = Fc[best]; used = np.unique(Fc)
    remap = np.full(len(Vc), -1); remap[used] = np.arange(len(used))
    Vc = Vc[used]; Fc = remap[Fc]; sc = sc[used]
    area = float(sum(0.5*np.linalg.norm(np.cross(Vc[b]-Vc[a], Vc[c]-Vc[a])) for a, b, c in Fc))
    print("LARGEST comp=%d kept f=%d area=%.1fcm2" % (nc, len(Fc), area*1e4))
    mesh = bpy.data.meshes.new("Cap7_mesh")
    mesh.from_pydata(Vc.tolist(), [], [list(f) for f in Fc]); mesh.update()
    bm = bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-4)
    for k in range(6):
        bm.edges.ensure_lookup_table()
        med = float(np.median([e.calc_length() for e in bm.edges])) if len(bm.edges) else 0.0
        if med <= 0.0025 or k == 5: break
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1, use_grid_fill=True, use_single_edge=False, use_only_quads=False, smooth=0.0)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(mesh); bm.free(); mesh.update()
    V = np.array([tuple(v.co) for v in mesh.vertices]); F = [tuple(p.vertices) for p in mesh.polygons]
    y0 = float(V[:, 1].min())-0.002
    cut = {i for i, f in enumerate(F) if abs(V[list(f)][:, 0].mean()-cx) < 0.0012 and y0 <= V[list(f)][:, 1].mean() <= apex_y+0.002}
    delv = set()
    for i in cut:
        for v in F[i]: delv.add(v)
    track = sorted(v for v in delv if abs(float(V[v][0])-cx) <= 0.006 and y0-0.001 <= float(V[v][1]) <= apex_y+0.003)
    Fk = [f for i, f in enumerate(F) if i not in cut]
    used = sorted({v for f in Fk for v in f}); remap = {o: n for n, o in enumerate(used)}
    Vc2 = V[used]; Fc2 = [tuple(remap[v] for v in f) for f in Fk]
    slit = sorted(remap[v] for v in track if v in remap)
    mesh.clear_geometry(); mesh.from_pydata(Vc2.tolist(), [], [list(f) for f in Fc2]); mesh.update()
    V = np.array([tuple(v.co) for v in mesh.vertices]); F = [tuple(p.vertices) for p in mesh.polygons]
    area = float(sum(0.5*np.linalg.norm(np.cross(V[b]-V[a], V[c]-V[a])) for a, b, c in F))
    cL = min((v for v in slit if float(V[v][0]) <= cx), key=lambda v: float(V[v][1]), default=None)
    cR = min((v for v in slit if float(V[v][0]) > cx), key=lambda v: float(V[v][1]), default=None)
    pins = {c for c in (cL, cR) if c is not None}
    print("POST-SLIT v=%d f=%d area=%.1fcm2 cut=%d slit=%d" % (len(V), len(F), area*1e4, len(cut), len(slit)))
    bnd, groups, order, cov, badj = boundary_info(F)
    fadj = defaultdict(set)
    for f in F:
        for k in range(3): a, b = f[k], f[(k+1) % 3]; fadj[a].add(b); fadj[b].add(a)
    seen2, ncomp = set(), 0
    for x in fadj:
        if x in seen2: continue
        ncomp += 1; st = [x]; seen2.add(x)
        while st:
            y = st.pop()
            for z in fadj[y]:
                if z not in seen2: seen2.add(z); st.append(z)
    print("LOOPS n=%d sizes=%s ncomp=%d F=%d" % (len(groups), [len(g) for g in groups][:8], ncomp, len(F)))
    ball = np.array([v for g in groups for v in g], dtype=np.int64) if groups else np.array([], dtype=int)
    BV = V[ball] if len(ball) else V
    latm = (np.abs(BV[:, 0]-cx) >= 0.020) if len(ball) else np.array([], dtype=bool)
    lat = ball[latm] if latm.any() else ball
    LV = V[lat]
    brow = np.array([cx, brow_y, brow_z])
    half = 0.5*abs(float(eL[0])-float(eR[0]))*0.62
    tL = int(lat[np.linalg.norm(LV-np.array([cx+half, brow[1], brow[2]]), axis=1).argmin()]) if len(lat) else 0
    tR = int(lat[np.linalg.norm(LV-np.array([cx-half, brow[1], brow[2]]), axis=1).argmin()]) if len(lat) else 0
    def azim(p): return math.degrees(math.atan2(float(p[0])-cx, -(float(p[1])-cy)))
    azL, azR = azim(V[tL]), azim(V[tR]); lo, hi = min(azL, azR), max(azL, azR); c0 = (lo <= 0 <= hi)
    bset = set(int(v) for v in ball); sset0 = set(int(v) for v in slit) | set(int(v) for v in pins)
    fore, exl = [], []
    for v in bset:
        if v in sset0: continue
        a = azim(V[v]); (fore if ((lo <= a <= hi) if c0 else (a >= hi or a <= lo)) else exl).append(v)
    EXIT = sorted(exl)
    sb7 = {}
    for _side, _sgn in (("L", 1), ("R", -1)):
        sb7[_side] = sorted(v for v in bset if v not in sset0 and (float(V[v][0])-cx)*_sgn > 0.0475 and float(V[v][1]) <= -0.060 and ZB-0.005 <= float(V[v][2]) <= 1.620)
    print("SB7 L=%d R=%d" % (len(sb7["L"]), len(sb7["R"])))
    # M9: every extra loop is a hole to report (centroid + area). Fix the
    # field that made it, never fill.
    if len(groups) != 1:
        for _gi, _gr in enumerate(groups):
            _P = V[np.array(sorted(_gr), dtype=np.int64)]; _ce = _P.mean(axis=0)
            _cl = float(sum(np.linalg.norm(V[_gr[_k]]-V[_gr[(_k+1) % len(_gr)]]) for _k in range(len(_gr)))/2)
            print("HOLE loop=%d n=%d centroid=(%.4f,%.4f,%.4f) perim=%.1fmm" % (
                _gi, len(_gr), float(_ce[0]), float(_ce[1]), float(_ce[2]), _cl*1000))
    print("M9 loops=%d %s" % (len(groups), "PASS" if len(groups) == 1 else "MISS-hole-present"))
    # S3-like boundary relaxation: iron head-facet kinks. Regions fixed (no
    # faces added/removed); verts stay on head via reproject, travel <=~1mm.
    # 7b: EXCLUDE the front arch (fore) so G2 stays on target; 4 passes.
    _fset = set(int(v) for v in fore)
    for _p in range(4):
        mv = {}
        for v in ball:
            if int(v) in _fset: continue
            nb = [int(w) for w in badj[int(v)] if int(w) in bset]
            if not nb: continue
            m = (V[int(v)]+V[nb].mean(axis=0))/2.0
            mv[int(v)] = V[int(v)]+(m-V[int(v)])*0.3
        for v, p in mv.items():
            hit, _, _, _ = headBVH.find_nearest(Vector(tuple(p)))
            V[v] = np.array(hit) if hit is not None else p
        print("RELAX pass=%d moved=%d (fore excluded)" % (_p, len(mv)))
    mesh.clear_geometry(); mesh.from_pydata(V.tolist(), [], [list(f) for f in F]); mesh.update()
    V = np.array([tuple(v.co) for v in mesh.vertices])
    area = float(sum(0.5*np.linalg.norm(np.cross(V[b]-V[a], V[c]-V[a])) for a, b, c in F))
    v5area = float(_v5["area_cm2"])
    print("CAP7 area=%.1fcm2 v5=%.1f ncomp=%d nloops=%d" % (area*1e4, v5area, ncomp, len(groups)))
    np.savez(out/"cap-v7.npz", verts=V, faces=np.array(F), slit=np.array(slit), forehead=np.array(fore), exit=np.array(EXIT), temple=np.array([tL, tR]), cx=cx, cy=cy, crown=crown, apex=apex, apex_y=apex_y, ear_top=ear_top, ear_y=ear_y, area_cm2=area*1e4, brow_z=brow_z, nasion_z=nasion_z, menton_z=menton_z, brow_id=brow_id, nasion_id=nasion_id, eh_A=Au, eh_E=Eu, sideburn_L=np.array(sb7["L"]), sideburn_R=np.array(sb7["R"]), canthus_L=np.array(CAN["L"]), canthus_R=np.array(CAN["R"]), pinna_front_L=np.array(PIN["L"]["front"]), pinna_front_R=np.array(PIN["R"]["front"]), pinna_top_L=np.array(PIN["L"]["top"]), pinna_top_R=np.array(PIN["R"]["top"]), pinna_lobe_L=np.array(PIN["L"]["lobe"]), pinna_lobe_R=np.array(PIN["R"]["lobe"]), eset=ESET, pset=PSET, Cy=Cy, Cz=Cz)
    print("SAVED cap-v7.npz v=%d f=%d" % (len(V), len(F)))
    print("WROTE", out)
main()
