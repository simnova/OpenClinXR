"""CW1 globe-over-lid counterweight (handover h1 tsk_55d4f55390439822).

Counts eye-surface pixels projecting OUTSIDE the lid opening, where the
opening is the lid-margin vertex loop (skin verts in a 0.5-4 mm radial band
off each fitted globe, up/lo chains resampled to 25 stations — the same
definition the factory bake's eyeshell pass uses) projected with a fixed
orthographic camera. No colour involved: the boundary comes from the mesh,
lashes are never rasterized (hidden by construction), and both the edge
metric and CW1 derive from one deterministic projection per yaw view.

Views: front, yaw +-25, +-40 (orbit about the head centre) plus blink
closure 0.5 (eye-{left,right}-closure morph at 0.5, loop re-derived on the
morphed body). Resolution 0.12 mm/px.

Usage:
  mise exec -- python3 tools/openclinxr/evidence/realism-head/globe/cw1-protrusion.py \
    --glb <path.glb> --out <path.json>
"""

import argparse
import hashlib
import json
import struct
import sys

import numpy as np

COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


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
            vals = struct.unpack("<" + fmt * n, blob[o:o + n * sz])
            out[i] = vals
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
        # glTF matrices are column-major: transpose each into row-major
        out = out.reshape((-1, 4, 4)).transpose(0, 2, 1)
    return out


def quat_to_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def node_worlds(js):
    mats = {}
    for i, n in enumerate(js["nodes"]):
        m = np.eye(4)
        if "matrix" in n:
            m = np.array(n["matrix"]).reshape(4, 4).T  # column-major -> row
            # glTF matrices are column-major; numpy row-major: transpose
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
    node = next(n for n in js["nodes"] if n.get("mesh") == js["meshes"].index(mesh))
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
            # per-vert joint: group by joint for vectorisation
            for jid in np.unique(j[sel]):
                m = sel & (j == jid)
                out[m] += (w[m, None] * (hp[m] @ jmats[jid].T)[:, :3])
        pos = out
    world = worlds[ni]
    hp = np.concatenate([pos, np.ones((len(pos), 1))], axis=1)
    world_pos = (hp @ world.T)[:, :3]
    idx = accessor(js, blob, prim["indices"]).astype(np.int64).ravel()
    return world_pos, idx


def fit_sphere(pts):
    m = pts.mean(axis=0)
    d = pts - m
    dd = (d ** 2).sum(axis=1)
    a = 2.0 * (d[:, :, None] * d[:, None, :]).sum(axis=0)
    b = (d * dd[:, None]).sum(axis=0)
    c = np.linalg.solve(a, b) + m
    r = float(np.mean(np.linalg.norm(pts - c, axis=1)))
    return c, r


def lid_loop(body, centre, radius):
    """Lid-margin band world points (no resampling).

    Skin verts in a 0.5-3.0 mm radial band off the fitted globe within 25 mm
    laterally (the factory bake's eyeshell pass uses 0.5-4.0 mm; the tighter
    outer wall keeps brow/cheek skin out of the opening boundary). Callers
    sort the band angularly around the projected eye centre per view and fill
    that ring: the ring follows the margin instead of chording the canthi.
    """
    d = np.linalg.norm(body - centre, axis=1) - radius
    m = (d >= 0.0005) & (d <= 0.003) & (np.abs(body[:, 0] - centre[0]) < 0.025)
    pts = body[m]
    if len(pts) < 12:
        raise RuntimeError("CW1: no lid-margin loop found — refusing")
    return pts, int(m.sum())


def rasterize(tris, res_mm, origin_uv, size_px, depth_buf, id_buf, eye_id):
    """Orthographic rasterize (u right, w up, tris carry (u, w, s) with
    s = depth along the view dir; nearness = -s wins the z-buffer)."""
    H, W = size_px[1], size_px[0]
    for t in tris:
        p = (t[:, :2] - origin_uv) / res_mm
        x0 = max(0, int(np.floor(p[:, 0].min())))
        x1 = min(W - 1, int(np.ceil(p[:, 0].max())))
        y0 = max(0, int(np.floor(p[:, 1].min())))
        y1 = min(H - 1, int(np.ceil(p[:, 1].max())))
        if x1 < x0 or y1 < y0:
            continue
        xs = np.arange(x0, x1 + 1)
        ys = np.arange(y0, y1 + 1)
        X, Y = np.meshgrid(xs, ys)
        v0, v1, v2 = p
        e0 = (X - v1[0]) * (v0[1] - v1[1]) - (Y - v1[1]) * (v0[0] - v1[0])
        e1 = (X - v2[0]) * (v1[1] - v2[1]) - (Y - v2[1]) * (v1[0] - v2[0])
        e2 = (X - v0[0]) * (v2[1] - v0[1]) - (Y - v0[1]) * (v2[0] - v0[0])
        area = (v1[0] - v0[0]) * (v2[1] - v0[1]) - (v2[0] - v0[0]) * (v1[1] - v0[1])
        if abs(area) < 1e-12:
            continue
        if area > 0:
            inside = (e0 >= 0) & (e1 >= 0) & (e2 >= 0)
        else:
            inside = (e0 <= 0) & (e1 <= 0) & (e2 <= 0)
        if not inside.any():
            continue
        w0 = e1 / area
        w1 = e2 / area
        w2 = 1.0 - w0 - w1
        z = -(w0 * t[0, 2] + w1 * t[1, 2] + w2 * t[2, 2])
        sub = depth_buf[y0:y1 + 1, x0:x1 + 1]
        hit = inside & (z > sub)
        if hit.any():
            sub[hit] = z[hit]
            id_buf[y0:y1 + 1, x0:x1 + 1][hit] = eye_id


def fill_polygon(poly_uv, res_mm, origin_uv, size_px):
    """Even-odd scanline fill of a closed polygon (in uv metres)."""
    H, W = size_px[1], size_px[0]
    mask = np.zeros((H, W), dtype=bool)
    p = (poly_uv - origin_uv) / res_mm
    n = len(p)
    for y in range(H):
        xs = []
        for i in range(n):
            a, b = p[i], p[(i + 1) % n]
            if (a[1] <= y < b[1]) or (b[1] <= y < a[1]):
                t = (y - a[1]) / (b[1] - a[1])
                xs.append(a[0] + t * (b[0] - a[0]))
        xs.sort()
        for k in range(0, len(xs) - 1, 2):
            x0 = max(0, int(np.ceil(xs[k])))
            x1 = min(W - 1, int(np.floor(xs[k + 1])))
            if x1 >= x0:
                mask[y, x0:x1 + 1] = True
    return mask


def project(pts, u, w, v, centre):
    """Project to (u, w, s) in MILLIMETRES (pts are metres)."""
    d = (pts - centre) * 1000.0
    return np.stack([d @ u, d @ w, d @ v], axis=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--res-mm", type=float, default=0.12)
    ap.add_argument("--box-mm", type=float, default=130.0)
    args = ap.parse_args()

    js, blob = load_glb(args.glb)
    worlds = node_worlds(js)

    with open(args.glb, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()

    body_name = "mpfb_ob_patient_aisha_body"
    eye_names = [
        "makeclothes_library_eyes_high_poly_globe_mpfb_ob_patient_aisha_mesh",
        "openclinxr_eye_cornea_high_poly_left_mpfb_ob_patient_aisha_mesh",
        "openclinxr_eye_cornea_high_poly_right_mpfb_ob_patient_aisha_mesh",
    ]

    body, body_idx = skin_mesh(js, blob, worlds, body_name)
    eyes = [skin_mesh(js, blob, worlds, n) for n in eye_names]
    # Robust L/R assignment: cornea meshes are cleanly separated per side;
    # globe verts join the side whose cornea centroid is nearer (an x-median
    # split mis-assigns when the two eyes hold unequal vert counts).
    cornea = {m: pts for m, (pts, _) in zip(eye_names[1:], eyes[1:])}
    cen = {m: pts.mean(axis=0) for m, pts in cornea.items()}
    left_name = min(cen, key=lambda m: cen[m][0])
    globe_pts = eyes[0][0]
    d = {m: np.linalg.norm(globe_pts - cen[m], axis=1) for m in cen}
    sides = {}
    for m in cen:
        other = [k for k in cen if k != m][0]
        tag = "L" if m == left_name else "R"
        sides[tag] = np.concatenate([
            cornea[m], globe_pts[d[m] < d[other]]])
    # label check via eye.L / eye.R joint bind positions
    try:
        ni = {n.get("name"): k for k, n in enumerate(js["nodes"])}
        xl = float(worlds[ni["eye.L"]][:3, 3][0])
        xr = float(worlds[ni["eye.R"]][:3, 3][0])
        if not (xl < xr):
            sides = {"L": sides["R"], "R": sides["L"]}
    except KeyError:
        pass

    centres, radii = {}, {}
    for tag, pts in sides.items():
        c, r = fit_sphere(pts)
        centres[tag], radii[tag] = c, r
    head = (centres["L"] + centres["R"]) / 2.0

    res = args.res_mm
    W = H = int(args.box_mm / res)
    origin = np.array([-args.box_mm / 2.0, -args.box_mm / 2.0])

    views = {"front": 0.0, "yaw25": 25.0, "yaw-25": -25.0,
             "yaw40": 40.0, "yaw-40": -40.0}

    def frame(body_pts, morph_label):
        loops = {}
        for tag in ("L", "R"):
            loop, nband = lid_loop(body_pts, centres[tag], radii[tag])
            loops[tag] = (loop, nband)
        out = {}
        # GLB world: +Y up, face toward +Z (eyes anterior to the head joint).
        # Front view looks along -Z; yaw orbits the camera about head height.
        up = np.array([0.0, 1.0, 0.0])
        for vname, deg in views.items():
            th = np.radians(deg)
            v = np.array([-np.sin(th), 0.0, -np.cos(th)])
            u = np.cross(v, up)
            u = u / np.linalg.norm(u)
            w = np.cross(u, v)
            b_uv = project(body_pts, u, w, v, head)
            e_uv = [project(e[0], u, w, v, head) for e in eyes]
            e_idx = [e[1] for e in eyes]
            depth = np.full((H, W), -np.inf)
            ids = np.zeros((H, W), dtype=np.int8)
            # cull tris far from the eyes (45 mm)
            keep = np.linalg.norm(body_pts - head, axis=1) < 0.045
            btris = b_uv[body_idx.reshape(-1, 3)]
            cull = keep[body_idx.reshape(-1, 3)].all(axis=1)
            rasterize(btris[cull], res, origin, (W, H), depth, ids, 1)
            for uv, ix in zip(e_uv, e_idx):
                tris = uv[ix.reshape(-1, 3)]
                rasterize(tris, res, origin, (W, H), depth, ids, 2)
            per = {}

            def ring_mask(band_world):
                proj = project(band_world, u, w, v, head)[:, :2]
                ec = project(centres[tag][None, :], u, w, v, head)[0][:2]
                ang = np.arctan2(proj[:, 1] - ec[1], proj[:, 0] - ec[0])
                poly = proj[np.argsort(ang)]
                return fill_polygon(poly, res, origin, (W, H))

            for tag in ("L", "R"):
                mask = ring_mask(loops[tag][0])
                per[tag] = {
                    "openingPx": int(mask.sum()),
                    "cw1Px": 0,  # filled below per-side
                    "edgeRPx": int(((ids == 1) & mask).sum()),
                }
            # per-side split of outside-eye pixels by nearest centre u
            ys, xss = np.nonzero(ids == 2)
            if len(xss):
                cLu = float((centres["L"] - head) @ u) * 1000.0
                cRu = float((centres["R"] - head) @ u) * 1000.0
                xu = xss * res + origin[0]
                side = np.where(np.abs(xu - cLu) < np.abs(xu - cRu), "L", "R")
                # rebuild per-side opening masks for the outside test
                for tag in ("L", "R"):
                    m = ring_mask(loops[tag][0])
                    sel = side == tag
                    per[tag]["cw1Px"] = int(
                        (~m[ys[sel], xss[sel]]).sum())
            out[vname] = per
        return out, {t: {"loopBandVerts": int(loops[t][1]),
                         "ringPts": int(len(loops[t][0]))}
                     for t in ("L", "R")}

    frames, loopinfo = frame(body, "neutral")
    morph = {"eye-left-closure": 0.5, "eye-right-closure": 0.5}
    body_blink, _ = skin_mesh(js, blob, worlds, body_name, morph_weights=morph)
    blink, blinkloops = frame(body_blink, "blink0.5")

    report = {
        "tool": "tools/openclinxr/evidence/realism-head/globe/cw1-protrusion.py",
        "glbSha256": sha,
        "resMm": res,
        "eyeCentresM": {t: [round(float(v), 6) for v in centres[t]] for t in ("L", "R")},
        "eyeRadiiMm": {t: round(radii[t] * 1000.0, 3) for t in ("L", "R")},
        "loops": loopinfo,
        "frames": {"neutral": frames, "blink0.5": blink},
    }
    with open(args.out, "w") as f:
        json.dump(report, f, indent=1)
    tot = {v: sum(frames[v][t]["cw1Px"] for t in ("L", "R")) for v in views}
    totb = sum(blink["front"][t]["cw1Px"] for t in ("L", "R")) if "front" in blink else 0
    print(f"CW1 {args.glb.split('/')[-1]} " + json.dumps(
        {"neutral": tot, "blink0.5front": totb}))


if __name__ == "__main__":
    sys.exit(main())
