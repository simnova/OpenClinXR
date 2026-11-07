"""Hair guides 16: support-contour lift-off and closed-form back sheet."""
import argparse, hashlib, importlib.util, json, math, sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector, kdtree
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")

# Every geometric/render tuning lever is here. Distances are metres.
STYLE = {
    "seed": 16, "roots": 600, "points": 32, "step": 0.002,
    "scalp_clear": 0.003, "slit_clear": 0.001, "query_limit": 0.015,
    "liftoff_nz": -0.05, "liftoff_depth_gain": 0.60,
    "liftoff_jitter": 0.10, "edge_band": 0.0025, "walk_steps": 220,
    "c_side_min": 0.004, "c_side_gain": 0.016,
    "c_back_min": 0.008, "c_back_gain": 0.022,
    "clear_floor": 0.004, "clear_taper_top": 0.10,
    "back_class_slop": 0.008, "z_neck_drop": 0.015,
    "hem_head_fraction": 0.73, "head_height": 0.2107, "hem_jitter": 0.006,
    "arc_min": 0.020, "arc_gain": 0.040, "arc_samples": 7,
    "arc_shrinks": 7, "arc_shrink": 0.70, "arc_safe": 0.001,
    "grid": 0.004, "x_min": -0.30, "x_max": 0.30,
    "y_min": -0.20, "y_max": 0.20, "z_pad": 0.05,
    "hull_step": 0.002, "hull_eps": 0.0001,
    "side_smooth": 5, "smooth_dense": 14,
    "curve_radius": 0.001, "mask_radius": 0.003,
    "dot_radius": 0.0025, "render_size": 1024, "samples": 16,
    "camera_dist": 0.85, "camera_target_lift": 0.06,
    "front_camera_lift": 0.02, "back_camera_lift": 0.08,
    "three_quarter_lift": 0.14, "three_quarter_xy": 0.68,
    "top_camera_y": -0.10, "part_pair_tol": 0.0005,
    "short_segment": 0.0025, "horizontal_len": 0.012,
    "horizontal_dz": 0.002, "face_band_slop": 0.0,
    "side_hang": "taut", "repair_intersections": False,
    "repair_step": 0.004, "repair_max": 0.024,
    "root_lift_mm": 0.0, "root_lift_fade_mm": 40.0,
    "child_front_fill": False, "part_same_side_ahead_only": False,
    "front_comb_scale": 1.0, "front_comb_ramp": False,
}


def parse_style(values):
    """Apply typed key=value overrides; STYLE remains the only tunable SSOT."""
    changed = {}
    for text in values:
        if "=" not in text:
            raise ValueError("--style expects key=value, got %r" % text)
        key, raw = text.split("=", 1)
        if key not in STYLE:
            raise ValueError("unknown STYLE key %r" % key)
        old = STYLE[key]
        if isinstance(old, bool):
            if raw.lower() not in ("true", "false", "1", "0"):
                raise ValueError("boolean STYLE value required for %s" % key)
            value = raw.lower() in ("true", "1")
        elif isinstance(old, int) and not isinstance(old, bool):
            value = int(raw)
        elif isinstance(old, float):
            value = float(raw)
        else:
            value = raw
        STYLE[key] = value; changed[key] = {"from": old, "to": value}
    if STYLE["side_hang"] not in ("taut", "vertical_then_taut"):
        raise ValueError("side_hang must be taut or vertical_then_taut")
    return changed


def load_scene():
    p = HERE.parent / "hair-scene" / "hair_scene.py"
    s = importlib.util.spec_from_file_location("oclx_hair_scene16", p)
    m = importlib.util.module_from_spec(s); sys.modules[s.name] = m
    s.loader.exec_module(m)
    return m.build_scene()


def world_points(obj):
    return np.array([tuple(obj.matrix_world @ v.co) for v in obj.data.vertices])


def mirror(p, cx):
    q = np.array(p, dtype=float); q[0] = 2.0 * cx - q[0]; return q


def sym_hash(p, cx, salt=""):
    q = np.array(p)
    key = "%s|%d|%d|%d" % (salt, round(abs(q[0] - cx) * 1e5),
                              round(q[1] * 1e5), round(q[2] * 1e5))
    return int(hashlib.sha256(key.encode()).hexdigest()[:16], 16)


def depth_and_jitter(root, cx):
    rng = np.random.default_rng(sym_hash(root, cx, "depth"))
    u = float(rng.random())
    t = u * 0.70 if u < 0.5 else 0.35 + (u - 0.5) * 1.30
    jn = float(rng.uniform(-STYLE["liftoff_jitter"], STYLE["liftoff_jitter"]))
    jh = float(rng.uniform(-STYLE["hem_jitter"], STYLE["hem_jitter"]))
    return t, jn, jh


def vertex_normals(verts, faces):
    n = np.zeros_like(verts)
    tri = verts[faces]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    for k in range(3): np.add.at(n, faces[:, k], fn)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    centre = np.median(verts, axis=0)
    flip = np.sum(n * (verts - centre), axis=1) < 0
    n[flip] *= -1
    return n


def build_cap_queries(verts, faces, flow, boundary, cx):
    tree = kdtree.KDTree(len(verts))
    for i, p in enumerate(verts): tree.insert(Vector(tuple(p)), i)
    tree.balance()
    btree = kdtree.KDTree(len(boundary))
    for i in boundary: btree.insert(Vector(tuple(verts[i])), int(i))
    btree.balance()
    bvh = BVHTree.FromPolygons([Vector(tuple(p)) for p in verts], [tuple(f) for f in faces])
    normals = vertex_normals(verts, faces)

    def sym_vertex(p):
        _, ia, da = tree.find(Vector(tuple(p)))
        _, ib, db = tree.find(Vector(tuple(mirror(p, cx))))
        if max(float(da), float(db)) > STYLE["query_limit"]: return None
        qa = verts[ia]; qb = mirror(verts[ib], cx)
        na = normals[ia]; nb = mirror(normals[ib], 0.0)
        fa = flow[ia]; fb = mirror(flow[ib], 0.0)
        q = 0.5 * (qa + qb); n = na + nb; f = fa + fb
        n /= max(float(np.linalg.norm(n)), 1e-12)
        f -= n * float(f @ n); f /= max(float(np.linalg.norm(f)), 1e-12)
        return q, n, f, int(ia)

    def sym_surface(p):
        qa, na, _, da = bvh.find_nearest(Vector(tuple(p)))
        mp = mirror(p, cx)
        qb, nb, _, db = bvh.find_nearest(Vector(tuple(mp)))
        if qa is None or qb is None or max(float(da), float(db)) > STYLE["query_limit"]: return None
        qa = np.array(qa); qb = mirror(np.array(qb), cx)
        na = np.array(na); nb = mirror(np.array(nb), 0.0)
        q = 0.5 * (qa + qb); n = na + nb
        n /= max(float(np.linalg.norm(n)), 1e-12)
        return q, n

    def boundary_distance(p):
        _, _, da = btree.find(Vector(tuple(p)))
        _, _, db = btree.find(Vector(tuple(mirror(p, cx))))
        return 0.5 * (float(da) + float(db))
    return sym_vertex, sym_surface, boundary_distance


def choose_roots(flow_data, verts, slit_ids, cx, count, paired):
    roots = np.array(flow_data["roots"], dtype=float)
    slit = verts[np.array(slit_ids, dtype=int)]
    keep = np.min(np.linalg.norm(roots[:, None] - slit[None, :], axis=2), axis=1) >= STYLE["slit_clear"]
    roots = roots[keep]
    rng = np.random.default_rng(STYLE["seed"]); roots = roots[rng.permutation(len(roots))]
    if not paired: return roots[:count]
    right = roots[roots[:, 0] > cx]
    right = right[:count // 2]
    out = np.empty((2 * len(right), 3))
    out[0::2] = right; out[1::2] = np.array([mirror(p, cx) for p in right])
    return out


def colliders(handle):
    exact = ("OCLX_Aisha_head", "toigo_t_shirt", "tight_jeans_pants", "toigo_cloth_shoes")
    aliases = {"toigo_cloth_shoes": ("toigo_cloth_shoes", "footwear_toigo_mj_cloth_shoes")}
    found = []
    for token in exact:
        names = aliases.get(token, (token,))
        hits = [o for o in bpy.data.objects if o.type == "MESH" and any(n.lower() in o.name.lower() for n in names)]
        if token == "OCLX_Aisha_head": hits = [handle.head]
        if not hits: raise RuntimeError("missing R5 collider %s" % token)
        found.append(hits[0])
    deps = bpy.context.evaluated_depsgraph_get()
    return found, {o.name: BVHTree.FromObject(o, deps, deform=True, cage=False) for o in found}


def symmetrise_field(a):
    b = a[:, ::-1]
    both = np.isfinite(a) & np.isfinite(b)
    one = np.where(np.isfinite(a), a, b)
    return np.where(both, 0.5 * (a + b), one)


def make_heightfields(objs, bvhs, head, zhem, crown, menton, out):
    step = STYLE["grid"]
    xg = np.arange(STYLE["x_min"], STYLE["x_max"] + step / 2, step)
    zg = np.arange(zhem - STYLE["z_pad"], crown + step / 2, step)
    yg = np.arange(STYLE["y_min"], STYLE["y_max"] + step / 2, step)
    zsg = np.arange(menton - STYLE["z_neck_drop"] - step, crown + step / 2, step)
    yh = np.full((len(zg), len(xg)), -np.inf); yt = yh.copy()
    for j, z in enumerate(zg):
        for i, x in enumerate(xg):
            for obj in objs:
                hit, _, _, _ = bvhs[obj.name].ray_cast(Vector((x, 1.0, z)), Vector((0, -1, 0)), 3.0)
                if hit is None: continue
                if obj is head: yh[j, i] = max(yh[j, i], float(hit.y))
                yt[j, i] = max(yt[j, i], float(hit.y))
    zneck = menton - STYLE["z_neck_drop"]
    yh[zg < zneck] = -np.inf; yt[zg >= zneck] = -np.inf
    xs = np.full((len(zsg), len(yg)), -np.inf); hb = bvhs[head.name]
    for j, z in enumerate(zsg):
        for i, y in enumerate(yg):
            a, _, _, _ = hb.ray_cast(Vector((1, y, z)), Vector((-1, 0, 0)), 3.0)
            b, _, _, _ = hb.ray_cast(Vector((-1, y, z)), Vector((1, 0, 0)), 3.0)
            vals = [abs(float(q.x)) for q in (a, b) if q is not None]
            if vals: xs[j, i] = max(vals)
    yh, yt = symmetrise_field(yh), symmetrise_field(yt)
    np.savez(out / "heightfields.npz", Yb_head=yh, Yb_torso=yt, Xs=xs,
             x=xg, z=zg, y=yg, zs=zsg, z_neck=zneck)
    return {"Yh": yh, "Yt": yt, "Xs": xs, "x": xg, "z": zg,
            "y": yg, "zs": zsg, "z_neck": zneck}


def bilinear(field, gx, gz, x, z):
    fx = (x - gx[0]) / (gx[1] - gx[0]); fz = (z - gz[0]) / (gz[1] - gz[0])
    i = max(0, min(int(math.floor(fx)), len(gx) - 2)); j = max(0, min(int(math.floor(fz)), len(gz) - 2))
    tx = max(0.0, min(fx - i, 1.0)); tz = max(0.0, min(fz - j, 1.0))
    vals = [(field[j, i], (1-tx)*(1-tz)), (field[j, i+1], tx*(1-tz)),
            (field[j+1, i], (1-tx)*tz), (field[j+1, i+1], tx*tz)]
    fin = [(float(v), w) for v, w in vals if np.isfinite(v)]
    if not fin: return -np.inf
    if len(fin) < 4: return max(v for v, _ in fin)
    return sum(v*w for v, w in fin)


def trace_scalp(root, t, jitter, q_vertex, q_surface, edge_distance, cx, apex_y):
    cur = np.array(root); points = []; normals = []; stop = "trace_fail"
    threshold = max(STYLE["liftoff_nz"], STYLE["liftoff_nz"] + STYLE["liftoff_depth_gain"] * t + jitter)
    for _ in range(STYLE["walk_steps"]):
        vq = q_vertex(cur); sq = q_surface(cur)
        if vq is None or sq is None: break
        support, normal = sq; flow = vq[2]
        point = support + STYLE["scalp_clear"] * normal
        if points and np.linalg.norm(point - points[-1]) < STYLE["step"] * 0.25: break
        points.append(point); normals.append(normal)
        if len(points) >= 3 and float(normal[2]) <= threshold:
            stop = "normal"; break
        if edge_distance(support) <= STYLE["edge_band"]:
            stop = "front_edge" if support[1] < apex_y else "nape_edge"
            break
        target = support + flow * STYLE["step"]
        nq = q_surface(target)
        if nq is None: break
        cur = nq[0]
    if len(points) < 2: return None
    return np.array(points), np.array(normals), stop


def clearance(t, back):
    return ((STYLE["c_back_min"] + STYLE["c_back_gain"] * t) if back else
            (STYLE["c_side_min"] + STYLE["c_side_gain"] * t))


def taper_clear(c, z, zhem, menton):
    top = menton - STYLE["clear_taper_top"]
    u = np.clip((z - zhem) / max(top - zhem, 1e-9), 0.0, 1.0)
    return STYLE["clear_floor"] + (c - STYLE["clear_floor"]) * u


def obstacle_samples(L, zhem, c, field, hf):
    n = max(8, int(abs(L[2] - zhem) / STYLE["hull_step"]) + 1)
    zs = np.linspace(L[2], zhem, n); obs = np.full(n, -np.inf)
    for i, z in enumerate(zs):
        y = bilinear(field, hf["x"], hf["z"], L[0], z)
        if np.isfinite(y): obs[i] = y + taper_clear(c, z, zhem, hf["menton"])
    return zs, obs


def taut_hull(L, zhem, c, field, hf):
    zs, obs = obstacle_samples(L, zhem, c, field, hf)
    support = [0]; ys = [float(L[1])]; cur = 0
    while cur < len(zs) - 1:
        found = None
        for j in range(len(zs) - 1, cur, -1):
            if not np.isfinite(obs[j]): continue
            mid = np.arange(cur + 1, j)
            if not len(mid): found = j; break
            f = (zs[mid] - zs[cur]) / (zs[j] - zs[cur])
            line = ys[-1] + f * (obs[j] - ys[-1])
            if np.all(~np.isfinite(obs[mid]) | (obs[mid] <= line + STYLE["hull_eps"])):
                found = j; break
        if found is None: break
        support.append(found); ys.append(float(obs[found])); cur = found
        if cur == len(zs) - 1: break
    out = np.zeros((len(zs), 3)); out[:, 0] = L[0]; out[:, 2] = zs
    for k in range(len(zs)):
        i = max(0, np.searchsorted(support, k, side="right") - 1)
        if i >= len(support) - 1: out[k, 1] = ys[-1]
        else:
            a, b = support[i], support[i+1]
            f = (zs[k] - zs[a]) / (zs[b] - zs[a])
            out[k, 1] = ys[i] + f * (ys[i+1] - ys[i])
    return out


def vertical_then_taut(L, zhem, c, field, hf):
    """Hang vertically until first obstacle contact, then use its taut hull."""
    zs, obs = obstacle_samples(L, zhem, c, field, hf)
    hit = np.where(np.isfinite(obs) & (obs >= float(L[1]) - STYLE["hull_eps"]))[0]
    if not len(hit):
        out = np.zeros((len(zs), 3)); out[:, 0] = L[0]; out[:, 1] = L[1]; out[:, 2] = zs
        return out
    k = int(hit[0])
    contact = np.array((L[0], max(float(L[1]), float(obs[k])), float(zs[k])))
    tail = taut_hull(contact, zhem, c, field, hf)
    if k == 0: return tail
    vertical = np.zeros((k + 1, 3)); vertical[:, 0] = L[0]
    vertical[:, 1] = L[1]; vertical[:, 2] = zs[:k + 1]; vertical[-1] = contact
    return np.vstack([vertical[:-1], tail])


def side_envelope(hf, ear_lo, ear_hi):
    band = (hf["y"] >= ear_lo) & (hf["y"] <= ear_hi)
    out = np.full(len(hf["zs"]), -np.inf)
    for j in range(len(out)):
        row = hf["Xs"][j, band]; row = row[np.isfinite(row)]
        if len(row): out[j] = float(row.max())
    return out


def route_side_x(string, L, c, hf, envelope, ear_lo, ear_hi, cx):
    sign = 1.0 if L[0] >= cx else -1.0; raw = string[:, 0].copy()
    held = abs(L[0] - cx)
    for i, p in enumerate(string):
        if p[2] >= hf["z_neck"] and ear_lo <= p[1] <= ear_hi:
            lim = float(np.interp(p[2], hf["zs"], envelope, left=-np.inf, right=-np.inf))
            if np.isfinite(lim): held = max(held, lim + c)
        raw[i] = cx + sign * held
    radius = STYLE["side_smooth"] // 2; smooth = raw.copy()
    for i in range(len(raw)): smooth[i] = np.mean(raw[max(0, i-radius):min(len(raw), i+radius+1)])
    string[:, 0] = smooth; string[0, 0] = L[0]
    return string


def signed_distance(bvh, p):
    q, n, _, d = bvh.find_nearest(Vector(tuple(p)))
    if q is None or float(d) > STYLE["query_limit"]: return None
    return math.copysign(float(d), float((Vector(tuple(p)) - q).dot(n)) + 1e-12)


def fillet_arc(scalp, string, normal, radius, collider_bvhs):
    L = scalp[-1]; t0 = L - scalp[-2]; t1 = string[1] - L
    t0 /= max(np.linalg.norm(t0), 1e-12); t1 /= max(np.linalg.norm(t1), 1e-12)
    theta = math.acos(float(np.clip(t0 @ t1, -1, 1)))
    if theta < 1e-3: return scalp, string[1:]
    for _ in range(STYLE["arc_shrinks"]):
        d = radius * math.tan(theta / 2)
        d = min(d, 0.45 * np.linalg.norm(L-scalp[-2]), 0.45 * np.linalg.norm(string[1]-L))
        r = d / max(math.tan(theta / 2), 1e-9)
        A, B = L - t0*d, L + t1*d
        axis = np.cross(t0, t1); axis /= max(np.linalg.norm(axis), 1e-12)
        inward = np.cross(axis, t0); inward /= max(np.linalg.norm(inward), 1e-12)
        C = A + inward*r
        va = A - C; arc = []
        for u in np.linspace(0, theta, STYLE["arc_samples"]):
            v = va*math.cos(u) + np.cross(axis, va)*math.sin(u) + axis*(axis@va)*(1-math.cos(u))
            arc.append(C + v)
        arc = np.array(arc)
        safe = True
        for p in arc:
            for bvh in collider_bvhs.values():
                sd = signed_distance(bvh, p)
                if sd is not None and sd < -STYLE["arc_safe"]: safe = False
        if safe:
            return np.vstack([scalp[:-1], arc]), string[1:]
        radius *= STYLE["arc_shrink"]
    return scalp, string[1:]


def resample_smooth(points, phases):
    # Centripetal Hermite form: unlike uniform Catmull-Rom it does not loop
    # or overshoot at the very unequal scalp/arc/string spacings.
    p = np.asarray(points); dense = []
    dt = np.sqrt(np.maximum(np.linalg.norm(np.diff(p, axis=0), axis=1), 1e-12))
    tt = np.r_[0.0, np.cumsum(dt)]
    for i in range(len(p)-1):
        p0, p1, p2, p3 = p[max(0,i-1)], p[i], p[i+1], p[min(len(p)-1,i+2)]
        t0, t1, t2, t3 = tt[max(0,i-1)], tt[i], tt[i+1], tt[min(len(p)-1,i+2)]
        m1=(p2-p0)/max(t2-t0,1e-12); m2=(p3-p1)/max(t3-t1,1e-12); h=t2-t1
        for u in np.linspace(0, 1, STYLE["smooth_dense"], endpoint=False):
            u2,u3=u*u,u*u*u; h00=2*u3-3*u2+1; h10=u3-2*u2+u; h01=-2*u3+3*u2; h11=u3-u2
            dense.append(h00*p1+h10*h*m1+h01*p2+h11*h*m2)
    dense.append(p[-1]); dense = np.array(dense)
    arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(dense, axis=0), axis=1))]
    want = np.linspace(0, arc[-1], STYLE["points"]); out = np.empty((STYLE["points"], 3))
    for k, s in enumerate(want):
        j = min(max(np.searchsorted(arc, s)-1, 0), len(dense)-2)
        u = (s-arc[j])/max(arc[j+1]-arc[j], 1e-12); out[k] = dense[j]*(1-u)+dense[j+1]*u
    srcarc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
    ph = np.array([phases[min(np.searchsorted(srcarc, s), len(phases)-1)] for s in want], dtype=np.int8)
    return out, ph


def path_inside(points, bvhs):
    for p in points:
        for bvh in bvhs.values():
            sd = signed_distance(bvh, p)
            if sd is not None and sd < 0: return True
    return False


def generate(roots, cap, flow, hf, qv, qs, qed, ear_lo, ear_hi, bvhs):
    cx = float(cap["cx"]); apex = float(cap["apex_y"]); menton = float(cap["menton_z"])
    zbase = menton - STYLE["hem_head_fraction"] * STYLE["head_height"]
    env = side_envelope(hf, ear_lo, ear_hi); result = []
    for root in roots:
        t, jn, jh = depth_and_jitter(root, cx)
        traced = trace_scalp(root, t, jn, qv, qs, qed, cx, apex)
        if traced is None: continue
        scalp, norms, stop = traced
        if STYLE["root_lift_mm"] > 0.0:
            # Additional scalp clearance is exactly zero at the root and
            # rises smoothly over the requested arc.  The displaced lift-off
            # point then feeds the existing fillet/taut-string construction.
            arc = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(scalp, axis=0), axis=1))]
            fade = max(STYLE["root_lift_fade_mm"] / 1000.0, 1e-9)
            u = np.clip(arc / fade, 0.0, 1.0)
            rise = u * u * (3.0 - 2.0 * u)
            scalp = scalp + norms * (STYLE["root_lift_mm"] / 1000.0) * rise[:, None]
        L = scalp[-1]; zhem = zbase + jh
        yh = bilinear(hf["Yh"], hf["x"], hf["z"], L[0], L[2])
        back = bool(np.isfinite(yh) and L[1] >= yh - STYLE["back_class_slop"])
        c0 = clearance(t, back); field = np.maximum(hf["Yh"], hf["Yt"]) if back else hf["Yt"]
        increments = [0.0]
        if STYLE["repair_intersections"]:
            increments += list(np.arange(STYLE["repair_step"], STYLE["repair_max"] + 1e-9,
                                         STYLE["repair_step"]))
        built = None
        for extra in increments:
            c = c0 + float(extra)
            if not back and STYLE["side_hang"] == "vertical_then_taut":
                string = vertical_then_taut(L, zhem, c, field, hf)
            else:
                string = taut_hull(L, zhem, c, field, hf)
            if not back: string = route_side_x(string, L, c, hf, env, ear_lo, ear_hi, cx)
            arc_scalp, tail = fillet_arc(scalp, string, norms[-1], STYLE["arc_min"]+STYLE["arc_gain"]*t, bvhs)
            combined = np.vstack([arc_scalp, tail]); phases = np.r_[np.zeros(len(arc_scalp), np.int8), np.ones(len(tail), np.int8)]
            points, rph = resample_smooth(combined, phases); points[-1, 2] = zhem
            built = (points, rph, root, L, t, int(back), c, zhem, stop, float(extra))
            if not path_inside(points, bvhs): break
        result.append(built)
    return result


def material(name, color):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color; em.inputs["Strength"].default_value = 0.8
    nt.links.new(em.outputs[0], out.inputs[0]); return m


def curves_object(name, points, phases, radius):
    objs = []
    for phase, color in ((0, (0,1,1,1)), (1, (1,0,1,1))):
        cu = bpy.data.curves.new(name+str(phase), "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = radius
        cu.materials.append(material(name+"mat"+str(phase), color))
        ob = bpy.data.objects.new(name+str(phase), cu); bpy.context.scene.collection.objects.link(ob); objs.append(ob)
        for g, ph in zip(points, phases):
            idx = np.where(ph == phase)[0]
            for run in np.split(idx, np.where(np.diff(idx)>1)[0]+1):
                if len(run)<2: continue
                sp=cu.splines.new("POLY"); sp.points.add(len(run)-1)
                for k,j in enumerate(run): sp.points[k].co=(*map(float,g[j]),1)
    return objs


def dot_object(liftoff):
    r=STYLE["dot_radius"]; vv=[]; ff=[]
    for p in liftoff:
        b=len(vv); x,y,z=p; vv += [(x+r,y,z),(x-r,y,z),(x,y+r,z),(x,y-r,z),(x,y,z+r),(x,y,z-r)]
        ff += [(b,b+2,b+4),(b+2,b+1,b+4),(b+1,b+3,b+4),(b+3,b,b+4),(b+2,b,b+5),(b+1,b+2,b+5),(b+3,b+1,b+5),(b,b+3,b+5)]
    me=bpy.data.meshes.new("OCLX_liftoff16_mesh"); me.from_pydata(vv,[],ff); me.materials.append(material("OCLX_yellow16",(1,1,0,1)))
    ob=bpy.data.objects.new("OCLX_liftoff16",me); bpy.context.scene.collection.objects.link(ob); return ob


def render_and_masks(handle, guides, phases, liftoff, out, objs, W, cx, menton):
    from PIL import Image, ImageDraw
    handle.hair.hide_render=handle.hair.hide_viewport=True
    co=curves_object("OCLX_guides16_",guides,phases,STYLE["curve_radius"]); dots=dot_object(liftoff)
    sc=bpy.context.scene; sc.render.resolution_x=sc.render.resolution_y=STYLE["render_size"]; sc.cycles.samples=STYLE["samples"]
    cam=handle.camera; tgt=Vector((cx,float(np.median(W[:,1])),menton+STYLE["camera_target_lift"])); d=STYLE["camera_dist"]
    def track(): cam.rotation_euler=(tgt-cam.location).to_track_quat("-Z","Y").to_euler()
    views=[("front",(0,-d,STYLE["front_camera_lift"])),("three_quarter",(d*STYLE["three_quarter_xy"],-d*STYLE["three_quarter_xy"],STYLE["three_quarter_lift"])),
           ("profileL",(-d,0,STYLE["front_camera_lift"])),("profileR",(d,0,STYLE["front_camera_lift"])),
           ("back",(0,d,STYLE["back_camera_lift"])),("top",(0,STYLE["top_camera_y"],d))]
    for name,off in views:
        cam.location=tgt+Vector(off); track(); sc.render.filepath=str(out/("guides16_%s.png"%name)); bpy.ops.render.render(write_still=True)
    imgs=[Image.open(out/("guides16_%s.png"%n)).convert("RGB") for n,_ in views]
    sheet=Image.new("RGB",(STYLE["render_size"]*6,STYLE["render_size"]+30),(18,18,18)); dr=ImageDraw.Draw(sheet)
    for i,((n,_),im) in enumerate(zip(views,imgs)): sheet.paste(im,(i*STYLE["render_size"],30)); dr.text((i*STYLE["render_size"]+8,8),n,fill=(0,255,255))
    sheet.save(out/"guides16-debug.png")
    # Guides-only masks, with the head as black occluder.
    white=material("OCLX_mask_white16",(1,1,1,1)); black=material("OCLX_mask_black16",(0,0,0,1)); oldm=list(handle.head.data.materials)
    oldworld=sc.world; bw=bpy.data.worlds.new("OCLX_black_world16"); bw.use_nodes=True; bw.node_tree.nodes["Background"].inputs["Color"].default_value=(0,0,0,1); sc.world=bw
    for ob in co: ob.data.bevel_depth=STYLE["mask_radius"]; ob.data.materials.clear(); ob.data.materials.append(white)
    handle.head.data.materials.clear(); handle.head.data.materials.append(black); dots.hide_render=True
    hidden={o.name:o.hide_render for o in bpy.data.objects}
    for o in bpy.data.objects: o.hide_render = not (o in co or o is handle.head or o is cam or o.type=="LIGHT")
    for name,off in views:
        cam.location=tgt+Vector(off); track(); sc.render.filepath=str(out/("guides16-%s-mask.png"%name)); bpy.ops.render.render(write_still=True)
    for o in bpy.data.objects:
        if o.name in hidden: o.hide_render=hidden[o.name]
    handle.head.data.materials.clear()
    for m in oldm: handle.head.data.materials.append(m)
    sc.world=oldworld
    target_names=("front","three_quarter","profile","back"); ours=("front","three_quarter","profileR","back")
    comp=Image.new("RGB",(STYLE["render_size"]*4,STYLE["render_size"]*2),(18,18,18)); dr=ImageDraw.Draw(comp)
    for i,(tn,on) in enumerate(zip(target_names,ours)):
        comp.paste(Image.open(TARGET/("target-%s.png"%tn)).convert("RGB"),(i*STYLE["render_size"],0))
        comp.paste(Image.open(out/("guides16_%s.png"%on)).convert("RGB"),(i*STYLE["render_size"],STYLE["render_size"]))
        dr.text((i*STYLE["render_size"]+8,8),"TS "+tn,fill=(255,255,0)); dr.text((i*STYLE["render_size"]+8,STYLE["render_size"]+8),"ours "+on,fill=(0,255,255))
    comp.save(out/"target-vs-guides16.png")


def mask_metrics(out, W, handle, liftoff, classes, guides, phases, hf, cap):
    from PIL import Image
    import bpy_extras.object_utils as OU
    sc=bpy.context.scene; cam=handle.camera; cx=float(cap["cx"]); menton=float(cap["menton_z"]); crown=float(cap["crown"]); d=STYLE["camera_dist"]
    tgt=Vector((cx,float(np.median(W[:,1])),menton+STYLE["camera_target_lift"]))
    def setcam(off): cam.location=tgt+Vector(off); cam.rotation_euler=(tgt-cam.location).to_track_quat("-Z","Y").to_euler(); bpy.context.view_layer.update()
    cover={}
    for sign,name,view in ((-1,"L","profileL"),(1,"R","profileR")):
        im=np.asarray(Image.open(out/("guides16-%s-mask.png"%view)).convert("L")); setcam((sign*d,0,STYLE["front_camera_lift"]))
        ear_y=0.5*(float(cap["pinna_front_L"][1])+float(cap["pinna_front_R"][1])); et=float(cap["ear_top"])
        pin=W[(abs(W[:,1]-ear_y)<=0.012)&(W[:,2]>=et-0.032)&(W[:,2]<=et+0.002)&((W[:,0]-cx)*sign>0.04)]
        rc=[((1-OU.world_to_camera_view(sc,cam,Vector(tuple(p))).y)*im.shape[0],OU.world_to_camera_view(sc,cam,Vector(tuple(p))).x*im.shape[1]) for p in pin]
        if rc:
            rr=[int(a) for a,_ in rc]; cc=[int(b) for _,b in rc]; a,b=max(min(rr),0),min(max(rr),im.shape[0]-1); c,e=max(min(cc),0),min(max(cc),im.shape[1]-1)
            cover[name]=float((im[a:b+1,c:e+1]>128).mean())
        else: cover[name]=0.0
    im=np.asarray(Image.open(out/"guides16-back-mask.png").convert("L"))>128; setcam((0,d,STYLE["back_camera_lift"]))
    cols=np.where(im.any(axis=0))[0]; fill=0.0
    if len(cols)>8:
        a,b=int(cols.min()),int(cols.max()); q=max((b-a+1)//3,1)
        cov=[float(im[:,a:a+q].mean()),float(im[:,a+q:a+2*q].mean()),float(im[:,a+2*q:b+1].mean())]
        fill=cov[1]/max(0.5*(cov[0]+cov[2]),1e-9)
    back=np.where(classes==1)[0]; travel=[float(np.ptp(guides[i,phases[i]==1,0])) for i in back]
    return cover,fill,travel


def measurements(data, roots, hf, bvhs, cap, out, handle, W):
    G=np.array([x[0] for x in data]); PH=np.array([x[1] for x in data]); L=np.array([x[3] for x in data]); T=np.array([x[4] for x in data]); C=np.array([x[5] for x in data]); zhem=np.array([x[7] for x in data]); stops=[x[8] for x in data]
    seg=np.linalg.norm(np.diff(G,axis=1),axis=2); short=int((seg<STYLE["short_segment"]).sum()); zero=int((seg<=1e-9).sum())
    pair=[]
    for i in range(0,len(G)-1,2): pair.append(float(np.linalg.norm(G[i]-np.array([mirror(p,float(cap["cx"])) for p in G[i+1]]),axis=1).max()))
    inside=0; deep=0.0
    for g in G:
        for p in g:
            for bvh in bvhs.values():
                sd=signed_distance(bvh,p)
                if sd is not None and sd<0: inside+=1; deep=max(deep,-sd*1000)
    behind=front=0
    for g in G:
        for p in g:
            if p[2]>=hf["z_neck"]: continue
            y=bilinear(hf["Yt"],hf["x"],hf["z"],p[0],p[2])
            if np.isfinite(y) and p[1]<y: behind+=1; front+=1
    horiz=0
    for g,ph in zip(G,PH):
        d=np.diff(g,axis=0); ln=np.linalg.norm(d,axis=1); hp=(ph[:-1]==1)&(ph[1:]==1)
        if np.any(hp&(ln>STYLE["horizontal_len"])&(np.abs(d[:,2])<STYLE["horizontal_dz"])): horiz+=1
    can=max(abs(float(cap["canthus_L"][0])),abs(float(cap["canthus_R"][0]))); brow=float(cap["brow_z"]); ment=float(cap["menton_z"])
    face=int(((np.abs(G[:,:,0]-float(cap["cx"]))<=can)&(G[:,:,2]<=brow)&(G[:,:,2]>=ment)&(G[:,:,1]<0)).sum())
    cover,fill,travel=mask_metrics(out,W,handle,L,C,G,PH,hf,cap)
    backz=L[C==1,2]; band=float(np.percentile(backz,90)-np.percentile(backz,10)) if len(backz) else 0.0
    g1={"p95_mm":float(np.percentile(pair,95)*1000) if pair else 0.0,"max_mm":float(max(pair)*1000) if pair else 0.0}
    row={"count":len(G),"n_roots":len(roots),"style":STYLE,"counts":{"class":{"back":int(C.sum()),"side":int((C==0).sum())},"stop":{k:stops.count(k) for k in sorted(set(stops))}},
      "g1":g1,"g2":{"pts32":G.shape[1:]==(32,3),"nan":int(np.isnan(G).sum()),"short":short,"zero":zero},
      "g3":{"behind_viol":behind,"front":front},"g4":{"inside":inside,"deep_mm":deep},
      "g5":{"nape_edge_frac":stops.count("nape_edge")/max(len(G),1),"front_lo":stops.count("front_edge"),"back_band_mm":band*1000},
      "g6":{"backfill_ratio":fill,"travel_viol":int(sum(x>0.015 for x in travel)),"travel_max_mm":max(travel,default=0)*1000},
      "g7":{"horiz":horiz},"g8":{"cover":cover,"face":face},"g9":{"hem_bad":int((np.abs(G[:,-1,2]-zhem)>0.008).sum())}}
    row["gates"]=gate_rows(row)
    # X1/X2 geometric estimates.
    side=G[C==0]; angle=float("nan")
    if len(side):
        top=side[:,:,2]>float(cap["menton_z"]); bot=side[:,:,2]<float(cap["menton_z"])-0.08
        if top.any() and bot.any(): angle=math.degrees(math.atan2(abs(float(np.median(side[:,:,1][bot])-np.median(side[:,:,1][top]))),0.08))
    yneck=bilinear(hf["Yt"],hf["x"],hf["z"],float(cap["cx"]),float(cap["menton_z"])); hairy=float(np.max(G[:,:,1][abs(G[:,:,2]-float(cap["menton_z"]))<0.01]))
    earz=float(cap["ear_top"])-0.015; shz=float(cap["menton_z"])-0.07
    hhw=max(abs(float(cap["pinna_top_L"][0])),abs(float(cap["pinna_top_R"][0]))); pts=G[abs(G[:,:,2]-shz)<0.012]
    ratio=float(np.max(abs(pts[:,0]-float(cap["cx"]))))/max(hhw,1e-9) if len(pts) else float("nan")
    row["X1"]={"angle_ours_deg":angle,"angle_ts_deg":21.4,"nape_depth_hh":(hairy-yneck)/STYLE["head_height"] if np.isfinite(yneck) else None,"nape_depth_ts_hh":0.42}
    row["X2"]={"ratio_ours":ratio,"ratio_ts":1.26}; row["X3"]={"judge":None}
    return row


def root_region(root, cap):
    """Mutually exclusive diagnostic regions, in brief priority order."""
    cx = float(cap["cx"]); front = np.asarray(cap["verts"])[np.asarray(cap["forehead"], int)]
    if len(front) and float(np.linalg.norm(front - root, axis=1).min()) <= 0.030:
        return "front_band"
    can = max(abs(float(cap["canthus_L"][0])-cx), abs(float(cap["canthus_R"][0])-cx))
    earx = max(abs(float(cap["pinna_top_L"][0])-cx), abs(float(cap["pinna_top_R"][0])-cx))
    if abs(float(root[0])-cx) >= 0.72 * earx and float(root[2]) >= float(cap["ear_top"])-0.025:
        return "side_above_ear"
    if abs(float(root[0])-cx) >= 0.75 * can and float(root[1]) <= float(cap["apex_y"])+0.020:
        return "temple"
    if float(root[1]) > float(cap["apex_y"])+0.015: return "back"
    return "top"


def diagnostic_table(attempts, cap):
    names = ("front_band", "temple", "top", "side_above_ear", "back")
    rows = {n: {"region": n, "n_roots": 0, "n_kept": 0,
                "rejected": {"face": 0, "inside": 0, "horizontal": 0},
                "liftoff_y": [], "liftoff_z": [], "hang_angle_deg": []} for n in names}
    shoulder_z = float(cap["menton_z"]) - 0.070
    for item, why, kept in attempts:
        reg = root_region(item[2], cap); r = rows[reg]; r["n_roots"] += 1
        if not kept:
            if why in r["rejected"]: r["rejected"][why] += 1
            continue
        r["n_kept"] += 1; L = item[3]; g = item[0]
        r["liftoff_y"].append(float(L[1])); r["liftoff_z"].append(float(L[2]))
        j = int(np.argmin(abs(g[:, 2] - shoulder_z))); q = g[j] - L
        vertical = abs(float(q[2])); lateral = float(np.linalg.norm(q[:2]))
        r["hang_angle_deg"].append(math.degrees(math.atan2(lateral, max(vertical, 1e-9))))
    for r in rows.values():
        for k in ("liftoff_y", "liftoff_z", "hang_angle_deg"):
            vals = r[k]; r["median_" + k] = float(np.median(vals)) if vals else None; del r[k]
    return list(rows.values())


def gate_rows(r):
    specs=[("G1",r["g1"]["p95_mm"]<=0.5 and r["g1"]["max_mm"]<=2,"p95<=0.5mm max<=2mm"),
      ("G2",r["count"]>=.95*r["n_roots"] and r["g2"]["pts32"] and r["g2"]["nan"]==0 and r["g2"]["short"]==0,"kept>=95%; 32 points; 0 NaN/short"),
      ("G3",r["g3"]["behind_viol"]==0 and r["g3"]["front"]==0,"0 points in front of shoulder/torso"),
      ("G4",r["g4"]["inside"]<=5 and r["g4"]["deep_mm"]<=1,"inside<=5; depth<=1mm"),
      ("G5",r["g5"]["nape_edge_frac"]<=.10 and r["g5"]["front_lo"]/max(r["count"],1)<=.02 and r["g5"]["back_band_mm"]>=25,"nape<=10%; front<=2%; back band>=25mm"),
      ("G6",r["g6"]["backfill_ratio"]>=.90 and r["g6"]["travel_viol"]==0,"centre/outer>=0.90; back travel<=15mm"),
      ("G7",r["g7"]["horiz"]<=.01*r["count"],"horizontal runs<=1%"),
      ("G8",r["g8"]["cover"].get("L",0)>=.90 and r["g8"]["cover"].get("R",0)>=.90 and r["g8"]["face"]==0,"ear cover>=0.90; face points=0"),
      ("G9",r["g9"]["hem_bad"]==0,"every tip within 8mm of z_hem")]
    return [{"gate":g,"measured":json.dumps(r[g.lower()],sort_keys=True),"bar":bar,"verdict":"PASS" if ok else "MISS"} for g,ok,bar in specs]


def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--cap",required=True); ap.add_argument("--flow",required=True); ap.add_argument("--out"); ap.add_argument("--tag",required=True); ap.add_argument("--style",nargs="*",default=[]); ap.add_argument("--roots",type=int,default=STYLE["roots"]); ap.add_argument("--mirror-test",action="store_true")
    a=ap.parse_args(sys.argv[sys.argv.index("--")+1:]); style_diff=parse_style(a.style)
    out=Path(a.out) if a.out else HERE/"cells"/a.tag; out.mkdir(parents=True,exist_ok=True)
    cap=np.load(a.cap); flow=np.load(a.flow,allow_pickle=True); V=np.array(cap["verts"]); F=np.array(cap["faces"]); f=np.array(flow["f"]); cx=float(cap["cx"])
    handle=load_scene(); W=world_points(handle.head); objs,bvhs=colliders(handle); crown=float(cap["crown"]); menton=float(cap["menton_z"]); zhem=menton-STYLE["hem_head_fraction"]*STYLE["head_height"]
    hf=make_heightfields(objs,bvhs,handle.head,zhem,crown,menton,out); hf["menton"]=menton
    boundary=sorted(set(map(int,cap["exit"]))|set(map(int,cap["slit"]))|set(map(int,cap["forehead"])))
    qv,qs,qed=build_cap_queries(V,F,f,boundary,cx); candidates=choose_roots(flow,V,cap["slit"],cx,a.roots+200,a.mirror_test)
    ear_lo=0.5*(float(cap["pinna_front_L"][1])+float(cap["pinna_front_R"][1]))-0.010
    ear_back=max(float(np.max(cap["eset"][:,1])),float(np.max(cap["pset"][:,1]))); ear_hi=ear_back+0.010
    raw=generate(candidates,cap,flow,hf,qv,qs,qed,ear_lo,ear_hi,bvhs)
    # Repair clearance can differ by a numerical boundary sample across a
    # mirror pair.  Preserve the card's exact-mirror invariant by adopting
    # the more-cleared member as the pair geometry before validity checks.
    if a.mirror_test and STYLE["repair_intersections"]:
        paired=[]
        for i in range(0,len(raw)-1,2):
            a0,a1=raw[i],raw[i+1]; src=a0 if a0[9]>=a1[9] else a1
            if src[2][0] >= cx: right=src
            else:
                right=(np.array([mirror(p,cx) for p in src[0]]),src[1].copy(),mirror(src[2],cx),mirror(src[3],cx),*src[4:])
            left=(np.array([mirror(p,cx) for p in right[0]]),right[1].copy(),mirror(right[2],cx),mirror(right[3],cx),*right[4:])
            paired.extend((right,left))
        raw=paired
    # Candidate oversampling preserves the requested Poisson-root count when
    # a trace cannot take three honest surface steps. Mirror mode admits whole
    # pairs only, and rejects a pair if either guide crosses the canthus band.
    can=max(abs(float(cap["canthus_L"][0])),abs(float(cap["canthus_R"][0])))
    rejected={"face":0,"inside":0,"horizontal":0}; attempts=[]
    def valid_path(item):
        g,ph=item[0],item[1]
        if bool(((abs(g[:,0]-cx)<=can)&(g[:,2]<=float(cap["brow_z"]))&(g[:,2]>=menton)&(g[:,1]<0)).any()):
            return "face"
        q=np.diff(g,axis=0); ln=np.linalg.norm(q,axis=1); hang=(ph[:-1]==1)&(ph[1:]==1)
        if bool(np.any(hang&(ln>STYLE["horizontal_len"])&(abs(q[:,2])<STYLE["horizontal_dz"]))):
            return "horizontal"
        for p in g:
            for bvh in bvhs.values():
                sd=signed_distance(bvh,p)
                if sd is not None and sd<0: return "inside"
        return None
    data=[]
    if a.mirror_test:
        for i in range(0,len(raw)-1,2):
            why=valid_path(raw[i]) or valid_path(raw[i+1])
            if why is None:
                data.extend((raw[i],raw[i+1])); attempts.extend(((raw[i],None,True),(raw[i+1],None,True)))
            else:
                rejected[why]+=2; attempts.extend(((raw[i],why,False),(raw[i+1],why,False)))
            if len(data)>=a.roots: break
    else:
        for item in raw:
            why=valid_path(item)
            if why is None: data.append(item); attempts.append((item,None,True))
            else: rejected[why]+=1; attempts.append((item,why,False))
            if len(data)>=a.roots: break
    data=data[:a.roots]
    if not data: raise RuntimeError("no guides generated")
    G=np.array([x[0] for x in data]); PH=np.array([x[1] for x in data]); R=np.array([x[2] for x in data]); L=np.array([x[3] for x in data]); T=np.array([x[4] for x in data]); C=np.array([x[5] for x in data]); CL=np.array([x[6] for x in data]); ZH=np.array([x[7] for x in data])
    np.savez(out/"guides16.npz",points=G,roots=R,phases=PH,liftoff=L,t=T,**{"class":C},clearance=CL,z_hem=ZH,menton_z=menton,crown_z=crown)
    (out/"style.json").write_text(json.dumps(STYLE,indent=2)+"\n")
    render_and_masks(handle,G,PH,L,out,objs,W,cx,menton)
    row=measurements(data,np.empty((a.roots,3)),hf,bvhs,cap,out,handle,W); row["tag"]=a.tag; row["style_diff"]=style_diff; row["run"]={"cap":str(Path(a.cap)), "flow":str(Path(a.flow)), "mirror_test":bool(a.mirror_test), "candidates":int(len(candidates)), "raw":int(len(raw)), "assessed":int(len(attempts)), "rejected":rejected}
    row["diagnostics"]={"regions":diagnostic_table(attempts,cap),"repair_count":int(sum(x[0][9]>0 for x in attempts if x[2]))}
    (out/"row.json").write_text(json.dumps(row,indent=2)+"\n")
    print("ROW16 "+json.dumps({g["gate"]:g["verdict"] for g in row["gates"]},sort_keys=True))


if __name__ == "__main__": main()
