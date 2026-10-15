"""Lid-conform core: pure-python topology + ray-cast measurement shared by the
Blender bake pass (lid_conform.py) and the GLB-space gate measurement
(measure_conform.py).

Rings are derived topologically exactly as lidcurve_measure.py does
(boundary_loops :150-184 + BFS outward rings :245-263): the eye-opening
boundary loop nearest each globe centre is ring1 (1-indexed = the margin
loop), then BFS outward ring2, ring3. No hard-coded vertex indices.

GLB loading / skinning (load_glb, accessor, quat_to_mat, node_worlds,
skin_mesh) are copied from lidcurve_measure.py :33-134 (which itself copies
tools/openclinxr/evidence/realism-head/globe/cw1-protrusion.py :32-163).
"""

import json
import struct
from collections import defaultdict

import numpy as np

COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2),
        5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

BODY_NAME = "mpfb_ob_patient_aisha_body"
GLOBE_NAME = ("makeclothes_library_eyes_high_poly_globe_"
              "mpfb_ob_patient_aisha_mesh")
CORNEA_NAMES = (
    "openclinxr_eye_cornea_high_poly_left_mpfb_ob_patient_aisha_mesh",
    "openclinxr_eye_cornea_high_poly_right_mpfb_ob_patient_aisha_mesh",
)


def load_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    jlen = struct.unpack("<I", data[12:16])[0]
    js = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    clen = struct.unpack("<I", data[off:off + 4])[0]
    blob = data[off + 8:off + 8 + clen]
    return js, blob


def accessor(js, blob, idx):
    a = js["accessors"][idx]
    fmt, sz = COMP[a["componentType"]]
    n = NCOMP[a["type"]]
    dt = np.float64 if fmt == "f" else np.int64
    if "bufferView" not in a and "sparse" not in a:
        return np.zeros((a["count"], n), dtype=dt)
    if "bufferView" in a:
        bv = js["bufferViews"][a["bufferView"]]
        base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride", 0)
        out = np.empty((a["count"], n), dtype=dt)
        for i in range(a["count"]):
            o = base + (i * (stride or n * sz))
            out[i] = struct.unpack("<" + fmt * n, blob[o:o + n * sz])
    else:
        out = np.zeros((a["count"], n), dtype=dt)
    if "sparse" in a:
        sp = a["sparse"]
        ii = sp["indices"]
        iv = js["bufferViews"][ii["bufferView"]]
        ifmt, isz = COMP[ii["componentType"]]
        ibase = iv.get("byteOffset", 0) + ii.get("byteOffset", 0)
        vv = sp["values"]
        vb = js["bufferViews"][vv["bufferView"]]
        vbase = vb.get("byteOffset", 0) + vv.get("byteOffset", 0)
        for k in range(sp["count"]):
            io = ibase + k * isz
            vi = struct.unpack("<" + ifmt, blob[io:io + isz])[0]
            vo = vbase + k * n * sz
            out[vi] = struct.unpack("<" + fmt * n, blob[vo:vo + n * sz])
    if a["type"] == "MAT4":
        out = out.reshape((-1, 4, 4)).transpose(0, 2, 1)
    return out


def quat_to_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def node_worlds(js):
    mats = {}
    for i, n in enumerate(js["nodes"]):
        m = np.eye(4)
        if "matrix" in n:
            m = np.array(n["matrix"]).reshape(4, 4).T
            mats[i] = m
            continue
        t = np.array(n.get("translation", [0, 0, 0]), dtype=float)
        r = quat_to_mat(n.get("rotation", [0, 0, 0, 1]))
        s = np.array(n.get("scale", [1, 1, 1]), dtype=float)
        m[:3, :3] = r * s
        m[:3, 3] = t
        mats[i] = m
    parent = {}
    for i, n in enumerate(js["nodes"]):
        for c in n.get("children", []):
            parent[c] = i
    world = {}

    def resolve(i):
        if i in world:
            return world[i]
        m = mats[i]
        if i in parent:
            m = resolve(parent[i]) @ m
        world[i] = m
        return m

    for i in range(len(js["nodes"])):
        resolve(i)
    return world


def skin_mesh(js, blob, worlds, mesh_name, morph_weights=None):
    mesh = next(m for m in js["meshes"] if m.get("name") == mesh_name)
    prim = mesh["primitives"][0]
    at = prim["attributes"]
    pos = accessor(js, blob, at["POSITION"]).astype(float)
    if morph_weights:
        names = mesh.get("extras", {}).get("targetNames", [])
        for tname, w in morph_weights.items():
            if tname in names and w:
                tgt = prim["targets"][names.index(tname)]
                pos = pos + w * accessor(js, blob, tgt["POSITION"]).astype(float)
    node = next(n for n in js["nodes"]
                if n.get("mesh") == js["meshes"].index(mesh))
    ni = js["nodes"].index(node)
    if "skin" in node:
        sk = js["skins"][node["skin"]]
        joints = np.array(accessor(js, blob, at["JOINTS_0"]), dtype=int)
        wts = np.array(accessor(js, blob, at["WEIGHTS_0"]), dtype=float)
        wts = wts / np.maximum(wts.sum(axis=1, keepdims=True), 1e-12)
        ibm = accessor(js, blob, sk["inverseBindMatrices"])
        jmats = [worlds[j] @ ibm[k] for k, j in enumerate(sk["joints"])]
        jmats = np.stack(jmats)
        out = np.zeros_like(pos)
        hp = np.concatenate([pos, np.ones((len(pos), 1))], axis=1)
        for k in range(4):
            j = joints[:, k]
            w = wts[:, k]
            sel = w > 0
            if not sel.any():
                continue
            for jid in np.unique(j[sel]):
                m = sel & (j == jid)
                out[m] += (w[m, None] * (hp[m] @ jmats[jid].T)[:, :3])
        pos = out
    world = worlds[ni]
    hp = np.concatenate([pos, np.ones((len(pos), 1))], axis=1)
    world_pos = (hp @ world.T)[:, :3]
    idx = accessor(js, blob, prim["indices"]).astype(np.int64).ravel()
    return world_pos, idx


def boundary_loops(tris):
    """lidcurve_measure.py :150-184 verbatim logic."""
    ec = defaultdict(int)
    for t in tris:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            ec[(min(a, b), max(a, b))] += 1
    adj = defaultdict(list)
    for (a, b), v in ec.items():
        if v == 1:
            adj[a].append(b)
            adj[b].append(a)
    seen = set()
    loops = []
    for s in sorted(adj):
        if s in seen:
            continue
        loop = [s]
        seen.add(s)
        prev, cur = None, s
        while True:
            nxts = [x for x in adj[cur] if x != prev]
            if not nxts:
                break
            nxt = nxts[0]
            if nxt == s:
                break
            if nxt in seen:
                loop.append(nxt)
                break
            loop.append(nxt)
            seen.add(nxt)
            prev, cur = cur, nxt
            if len(loop) > 20000:
                break
        loops.append(np.array(loop))
    return loops


def derive_eye_rings(body_pos, body_tris, globe_centre):
    """Topological rings for one eye (lidcurve_measure.py :221-263 logic).

    Returns dict with 1-indexed ring1 (= margin boundary loop nearest the
    globe centre), ring2, ring3 (BFS outward), as int index arrays.
    """
    loops = boundary_loops(body_tris)
    scored = []
    for lp in loops:
        cen = body_pos[lp].mean(axis=0)
        scored.append((float(np.linalg.norm(cen - globe_centre)), len(lp), lp))
    scored.sort(key=lambda s: s[0])
    if not scored:
        raise RuntimeError(
            "LIDCONFORM: no boundary loops on the body mesh — refusing "
            "(the mesh is watertight at this stage; no lid ring derivable)")
    ring1 = scored[0][2]
    adj = defaultdict(set)
    for t in body_tris:
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            adj[int(a)].add(int(b))
            adj[int(b)].add(int(a))
    seen = set(int(v) for v in ring1)
    rings = [np.array(sorted(seen))]
    frontier = set(seen)
    for _ in range(3):
        nxt = set()
        for v in frontier:
            for w in adj[v]:
                if w not in seen:
                    seen.add(w)
                    nxt.add(w)
        rings.append(np.array(sorted(nxt)))
        frontier = nxt
    return {"ring1": rings[0], "ring2": rings[1], "ring3": rings[2],
            "loopDistMm": scored[0][0] * 1000.0,
            "loopLen": len(ring1)}


def fit_sphere_kasa(pts):
    a = np.concatenate([2.0 * pts, np.ones((len(pts), 1))], axis=1)
    b = (pts ** 2).sum(axis=1)
    sol, *_ = np.linalg.lstsq(a, b, rcond=None)
    c = sol[:3]
    r = float(np.sqrt(max(sol[3] + c @ c, 0.0)))
    resid = np.linalg.norm(pts - c, axis=1) - r
    return c, r, float(np.sqrt((resid ** 2).mean()))


def eye_sides(js, blob, worlds):
    """Split globe+cornea verts into L/R (lidcurve_measure.py :199-208)."""
    globe, _ = skin_mesh(js, blob, worlds, GLOBE_NAME)
    cor = {}
    for name in CORNEA_NAMES:
        pts, _ = skin_mesh(js, blob, worlds, name)
        cor[name] = pts
    names = list(cor)
    cen = {m: cor[m].mean(axis=0) for m in names}
    left_name = min(cen, key=lambda m: cen[m][0])
    d = {m: np.linalg.norm(globe - cen[m], axis=1) for m in names}
    ni = {n.get("name"): k for k, n in enumerate(js["nodes"])}
    swap = not (float(worlds[ni["eye.L"]][:3, 3][0])
                < float(worlds[ni["eye.R"]][:3, 3][0]))
    sides = {}
    sides["R" if swap else "L"] = np.concatenate(
        [cor[names[0]], globe[d[names[0]] < d[names[1]]]])
    sides["L" if swap else "R"] = np.concatenate(
        [cor[names[1]], globe[d[names[0]] >= d[names[1]]]])
    return sides


def ray_cast_mesh(origins, dirs, tri_verts):
    """Nearest positive-t ray/triangle intersection (Moller-Trumbore).

    origins (N,3), dirs (N,3) unit, tri_verts (T,3,3). Returns t (N,)
    with inf where no hit. Vectorised over triangles in chunks.
    """
    n = len(origins)
    best = np.full(n, np.inf)
    v0 = tri_verts[:, 0]
    e1 = tri_verts[:, 1] - v0
    e2 = tri_verts[:, 2] - v0
    chunk = 2048
    for s in range(0, len(tri_verts), chunk):
        ee1 = e1[s:s + chunk]  # (C,3)
        ee2 = e2[s:s + chunk]
        vv0 = v0[s:s + chunk]
        p = np.cross(dirs[:, None, :], ee2[None, :, :])  # (N,C,3)
        det = np.einsum("nci,ci->nc", p, ee1)
        valid = np.abs(det) > 1e-12
        inv = np.zeros_like(det)
        inv[valid] = 1.0 / det[valid]
        tvec = origins[:, None, :] - vv0[None, :, :]
        u = np.einsum("nci,nci->nc", p, tvec) * inv
        q = np.cross(tvec, ee1[None, :, :])
        v = np.einsum("nci,nci->nc", q, dirs[:, None, :]) * inv
        t = np.einsum("nci,nci->nc", q, ee2[None, :, :]) * inv
        hit = valid & (u >= 0.0) & (v >= 0.0) & (u + v <= 1.0) & (t > 1e-9)
        t = np.where(hit, t, np.inf)
        best = np.minimum(best, t.min(axis=1))
    return best


def signed_gap_to_mesh(verts, centre, globe_tris):
    """Signed gap (mm) of verts vs the globe MESH surface.

    Ray from the globe centre through each vert; gap = (t_hit - |v-c|).
    Positive = outside the surface (honours the corneal bulge, unlike a
    sphere fit). Returns mm array with +inf where the ray misses.
    """
    d = verts - centre
    dist = np.linalg.norm(d, axis=1)
    dirs = d / np.maximum(dist, 1e-12)[:, None]
    t = ray_cast_mesh(centre[None, :].repeat(len(verts), axis=0), dirs,
                      globe_tris)
    # lidcurve convention: positive = outside the surface.
    return (dist - t) * 1000.0


def fissure_dims(loop_pts):
    """Palpebral fissure width x height (mm) from the margin loop.

    Width = widest 3D extent (PCA first axis ~ canthus to canthus);
    height = vertical extent of the middle third (clinical VPF is read at
    the pupillary midline). Both in mm.
    """
    p = np.asarray(loop_pts) * 1000.0
    c = p - p.mean(axis=0)
    _u, _s, vt = np.linalg.svd(c, full_matrices=False)
    width = float((c @ vt[0]).max() - (c @ vt[0]).min())
    xs = p[:, 0]
    lo, hi = xs.min(), xs.max()
    mid = p[(xs >= lo + (hi - lo) / 3.0) & (xs <= lo + 2 * (hi - lo) / 3.0)]
    height = float(mid[:, 1].max() - mid[:, 1].min()) if len(mid) else 0.0
    return {"widthMm": width, "heightMm": height}


def face_normals(pos, tris):
    a = pos[tris[:, 0]]
    b = pos[tris[:, 1]]
    c = pos[tris[:, 2]]
    n = np.cross(b - a, c - a)
    l = np.linalg.norm(n, axis=1)
    l[l < 1e-18] = 1e-18
    return n / l[:, None]


def count_flips(base_pos, new_pos, tris, vert_set):
    """Faces touching vert_set whose normal reversed (dot < 0)."""
    sel = np.zeros(len(tris), dtype=bool)
    flat = np.isin(tris.ravel(), np.asarray(list(vert_set))).reshape(-1, 3)
    sel = flat.any(axis=1)
    n0 = face_normals(base_pos, tris[sel])
    n1 = face_normals(new_pos, tris[sel])
    return int(((n0 * n1).sum(axis=1) < 0.0).sum()), int(sel.sum())
