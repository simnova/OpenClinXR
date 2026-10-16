#!/usr/bin/env python3
"""measure_eye_corner.py — geometric gates for the lid-loop corner fill.

Ports the wt/eyeglobe cw1-protrusion.py instrument (read-only; that file is
not edited): fixed orthographic camera, 0.12 mm/px, lid-opening ring frozen
as BASE body vertex indices, per-view rasterization of body / eye / fill.

Reports per view (front, yaw +-25, +-40):
  edgePx      body-skin pixels inside the lid opening  (G2: fill < base)
  eyeInsidePx eye pixels inside the opening            (CW1: fill >= .95 base)
  fillPx      fill pixels inside the opening (diagnostic)
plus blink closure 1.0 + slit 1.0:
  fillOutsideClosedPx  fill pixels outside the closed ring (diagnostic;
    the CW2 gate itself is render-occlusion-aware, measured in the sheet:
    visible fill pixels at blink must be 0)
and CW3:
  cw3maxMm  max over fill verts of signed anterior (+Z world) distance to
    the nearest frozen lid-loop vert (gate <= 0 mm).

Usage:
  measure_eye_corner.py --base <base.glb> --fill <fill.glb> --out <report.json>

Bodies must be bit-identical (POSITION sha compared); the ring transfers
exactly, per the H2 correctness note in cw1-protrusion.py.
"""

import argparse
import hashlib
import json
import struct
import sys

import numpy as np

COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2),
        5125: ("I", 4), 5126: ("f", 4)}
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


def mesh_by_sub(js, sub):
    hits = [m for m in js["meshes"] if sub.lower() in m.get("name", "").lower()]
    if len(hits) != 1:
        raise RuntimeError(f"mesh /{sub}/ hits={len(hits)}")
    return hits[0]


def find_body_mesh(js):
    """Root MPFB body mesh (lid-conform exports): name ends with _body.

    The eye3-era `patient_aisha_body.` substring matches neither
    aisha-lidconform (mpfb_ob_patient_aisha_body) nor body2-lidconform
    (mpfb_adult_male_street_casual_body), so match the root exactly.
    Excludes .high-poly / .teeth / .tongue shells by construction.
    """
    import re

    hits = [m for m in js["meshes"] if re.search(r"_body$", m.get("name", ""))]
    if len(hits) != 1:
        raise RuntimeError(f"body mesh hits={len(hits)}")
    return hits[0]


def skin_prims(js, blob, worlds, mesh, morph_weights=None):
    """All prims of a mesh skinned to world; returns (pos, tris)."""
    P_all, T_all = [], []
    base = 0
    names = (mesh.get("extras", {}) or {}).get("targetNames", [])
    for prim in mesh["primitives"]:
        at = prim["attributes"]
        pos = accessor(js, blob, at["POSITION"]).astype(float)
        if morph_weights:
            for tname, w in morph_weights.items():
                if tname in names and w:
                    tgt = prim["targets"][names.index(tname)]
                    pos = pos + w * accessor(
                        js, blob, tgt["POSITION"]).astype(float)
        node = next(n for n in js["nodes"]
                    if n.get("mesh") == js["meshes"].index(mesh))
        ni = js["nodes"].index(node)
        if "skin" in node:
            sk = js["skins"][node["skin"]]
            joints = np.array(accessor(js, blob, at["JOINTS_0"]), dtype=int)
            wts = np.array(accessor(js, blob, at["WEIGHTS_0"]), dtype=float)
            wts = wts / np.maximum(wts.sum(axis=1, keepdims=True), 1e-12)
            ibm = accessor(js, blob, sk["inverseBindMatrices"])
            jmats = [worlds[j] @ ibm[k]
                     for k, j in enumerate(sk["joints"])]
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
        wpos = (hp @ world.T)[:, :3]
        P_all.append(wpos)
        if "indices" in prim:
            idx = accessor(js, blob, prim["indices"]).astype(np.int64).ravel()
            T_all.append((idx.reshape(-1, 3) + base))
        base += len(wpos)
    P = np.concatenate(P_all)
    T = np.concatenate(T_all) if T_all else np.zeros((0, 3), dtype=np.int64)
    return P, T


def fit_sphere(pts):
    m = pts.mean(axis=0)
    d = pts - m
    dd = (d ** 2).sum(axis=1)
    a = 2.0 * (d[:, :, None] * d[:, None, :]).sum(axis=0)
    b = (d * dd[:, None]).sum(axis=0)
    c = np.linalg.solve(a, b) + m
    r = float(np.mean(np.linalg.norm(pts - c, axis=1)))
    return c, r


def rasterize(tris_uv, res_mm, origin_uv, size_px, depth, ids, eye_id):
    H, W = size_px[1], size_px[0]
    for t in tris_uv:
        xs = (t[:, 0] - origin_uv[0]) / res_mm
        ys = (t[:, 1] - origin_uv[1]) / res_mm
        x0 = max(0, int(np.floor(xs.min())))
        x1 = min(W - 1, int(np.ceil(xs.max())))
        y0 = max(0, int(np.floor(ys.min())))
        y1 = min(H - 1, int(np.ceil(ys.max())))
        if x1 < x0 or y1 < y0:
            continue
        d = np.array([[xs[1] - xs[0], xs[2] - xs[0]],
                      [ys[1] - ys[0], ys[2] - ys[0]]])
        det = d[0, 0] * d[1, 1] - d[0, 1] * d[1, 0]
        if abs(det) < 1e-12:
            continue
        inv = np.array([[d[1, 1], -d[0, 1]], [-d[1, 0], d[0, 0]]]) / det
        yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        px = xx + 0.5 - xs[0]
        py = yy + 0.5 - ys[0]
        w1 = inv[0, 0] * px + inv[0, 1] * py
        w2 = inv[1, 0] * px + inv[1, 1] * py
        w0 = 1.0 - w1 - w2
        inside = (w0 >= -1e-9) & (w1 >= -1e-9) & (w2 >= -1e-9)
        if not inside.any():
            continue
        w2 = 1.0 - w0 - w1
        z = -(w0 * t[0, 2] + w1 * t[1, 2] + w2 * t[2, 2])
        sub = depth[y0:y1 + 1, x0:x1 + 1]
        hit = inside & (z > sub)
        if hit.any():
            sub[hit] = z[hit]
            ids[y0:y1 + 1, x0:x1 + 1][hit] = eye_id


def fill_polygon(poly_uv, res_mm, origin_uv, size_px):
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
    d = (pts - centre) * 1000.0
    return np.stack([d @ u, d @ w, d @ v], axis=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--fill", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--res-mm", type=float, default=0.12)
    ap.add_argument("--box-mm", type=float, default=130.0)
    args = ap.parse_args()

    recs = {}
    for tag, path in (("base", args.base), ("fill", args.fill)):
        js, blob = load_glb(path)
        worlds = node_worlds(js)
        with open(path, "rb") as f:
            sha = hashlib.sha256(f.read()).hexdigest()
        body = find_body_mesh(js)
        globe = mesh_by_sub(js, "globe")
        # Lid-conform exports split the cornea into left/right meshes;
        # concatenate all (eye3 bake had one).
        cornea_hits = [m for m in js["meshes"] if "cornea" in m.get("name", "").lower()]
        if not cornea_hits:
            raise RuntimeError("mesh /cornea/ hits=0")
        body_pos, body_tris = skin_prims(js, blob, worlds, body)
        globe_pos, globe_tris = skin_prims(js, blob, worlds, globe)
        cpos, ctris = [], []
        for cm in cornea_hits:
            p, _ = skin_prims(js, blob, worlds, cm)
            cpos.append(p)
        import numpy as _np

        cornea_pos = _np.concatenate(cpos)
        try:
            fillm = mesh_by_sub(js, "corner_fill")
            fill_pos, fill_tris = skin_prims(js, blob, worlds, fillm)
            has_fill = True
        except RuntimeError:
            fill_pos, fill_tris = np.zeros((0, 3)), np.zeros((0, 3),
                                                             dtype=np.int64)
            has_fill = False
        ni = {n.get("name"): k for k, n in enumerate(js["nodes"])}
        jw = {nm: worlds[ni[nm]] for nm in ("eye.L", "eye.R", "head")}
        jx = {nm: float(jw[nm][0, 3]) for nm in ("eye.L", "eye.R")}
        # eye sides by nearer joint x (world).
        E = np.concatenate([globe_pos, cornea_pos])
        dL = np.abs(E[:, 0] - jx["eye.L"])
        dR = np.abs(E[:, 0] - jx["eye.R"])
        eye_pts = {"L": E[dL < dR], "R": E[dR <= dL]}
        centres, radii = {}, {}
        for s, pts in eye_pts.items():
            c, r = fit_sphere(pts)
            centres[s], radii[s] = c, r
        # orbit pivot = eye midpoint (the cw1-protrusion instrument's
        # head): pivoting on the head joint swings the eyes out of the
        # 130 mm box at yaw (measured: far ring at -110 mm, clipped).
        head = (centres["L"] + centres["R"]) / 2.0
        # body POSITION sha (all prims) for the bit-identical check.
        h = hashlib.sha256()
        for prim in body["primitives"]:
            h.update(np.ascontiguousarray(
                accessor(js, blob,
                         prim["attributes"]["POSITION"])).tobytes())
        recs[tag] = {"js": js, "blob": blob, "worlds": worlds, "sha": sha,
                     "body": body, "body_pos": body_pos,
                     "body_tris": body_tris, "globe_pos": globe_pos,
                     "globe_tris": globe_tris, "cornea_pos": cornea_pos,
                     "fill_pos": fill_pos, "fill_tris": fill_tris,
                     "has_fill": has_fill, "head": head,
                     "centres": centres, "radii": radii,
                     "bodyPosSha": h.hexdigest()}

    if recs["base"]["bodyPosSha"] != recs["fill"]["bodyPosSha"]:
        raise RuntimeError("bodies differ; frozen ring would not transfer")
    base = recs["base"]
    # freeze the lid ring on the BASE body, VISIBLE SKIN PRIM ONLY (prim 0
    # carries the mpfb_skin material; prims 1-7 are hidden interior shells
    # whose verts sit 0.5-3 mm off the globe sphere and would poison the
    # ring with face-interior points). Indices are concatenated-body
    # offsets; prim 0 leads, so they transfer exactly.
    n_skin = base["js"]["accessors"][base["body"]["primitives"][0][
        "attributes"]["POSITION"]]["count"]
    skin_pos = base["body_pos"][:n_skin]
    bring_idx = {}
    for s in ("L", "R"):
        c, r = base["centres"][s], base["radii"][s]
        d = np.linalg.norm(skin_pos - c, axis=1) - r
        m = (d >= 0.0005) & (d <= 0.003) & \
            (np.abs(skin_pos[:, 0] - c[0]) < 0.025)
        idx = np.nonzero(m)[0].astype(np.int64)
        if len(idx) < 12:
            raise RuntimeError("no lid-margin loop — refusing")
        bring_idx[s] = idx

    res = args.res_mm
    W = H = int(args.box_mm / res)
    origin = np.array([-args.box_mm / 2.0, -args.box_mm / 2.0])
    views = {"front": 0.0, "yaw25": 25.0, "yaw-25": -25.0, "yaw40": 40.0,
             "yaw-40": -40.0}

    def frame(rec, body_pts, rings, with_fill):
        out = {}
        up = np.array([0.0, 1.0, 0.0])
        for vname, deg in views.items():
            th = np.radians(deg)
            v = np.array([-np.sin(th), 0.0, -np.cos(th)])
            u = np.cross(v, up)
            u = u / np.linalg.norm(u)
            w = np.cross(u, v)
            head = rec["head"]
            b_uv = project(body_pts, u, w, v, head)
            g_uv = project(rec["globe_pos"], u, w, v, head)
            c_uv = project(rec["cornea_pos"], u, w, v, head)
            depth = np.full((H, W), -np.inf)
            ids = np.zeros((H, W), dtype=np.int8)
            keep = np.linalg.norm(body_pts - head, axis=1) < 0.045
            btris = b_uv[rec["body_tris"]]
            cull = keep[rec["body_tris"]].all(axis=1)
            rasterize(btris[cull], res, origin, (W, H), depth, ids, 1)
            # eye tris: globe prim tris + cornea prim tris.
            tris = [g_uv[rec["globe_tris"]]]
            cn = next(n for n in rec["js"]["nodes"]
                      if n.get("mesh") is not None and "cornea" in rec[
                          "js"]["meshes"][n["mesh"]].get("name", ""))
            cm = rec["js"]["meshes"][cn["mesh"]]
            cidx = accessor(rec["js"], rec["blob"],
                            cm["primitives"][0]["indices"]).astype(
                                np.int64).ravel()
            tris.append(c_uv[cidx.reshape(-1, 3)])
            for t in tris:
                rasterize(t, res, origin, (W, H), depth, ids, 2)
            if with_fill and rec["has_fill"]:
                f_uv = project(rec["fill_pos"], u, w, v, head)
                rasterize(f_uv[rec["fill_tris"]], res, origin, (W, H),
                          depth, ids, 3)

            def ring_mask(band_world, tag):
                proj = project(band_world, u, w, v, head)[:, :2]
                ec = project(rec["centres"][tag][None, :], u, w, v,
                             head)[0][:2]
                ang = np.arctan2(proj[:, 1] - ec[1], proj[:, 0] - ec[0])
                poly = proj[np.argsort(ang)]
                return fill_polygon(poly, res, origin, (W, H))

            per = {}
            for tag in ("L", "R"):
                mask = ring_mask(rings[tag], tag)
                per[tag] = {
                    "openingPx": int(mask.sum()),
                    "edgePx": int(((ids == 1) & mask).sum()),
                    "eyeInsidePx": int(((ids == 2) & mask).sum()),
                    "fillPx": int(((ids == 3) & mask).sum()) if with_fill
                    else 0,
                }
            out[vname] = per
        return out

    rings_neutral = {s: base["body_pos"][bring_idx[s]] for s in ("L", "R")}
    edge_base = frame(base, base["body_pos"], rings_neutral, False)
    fill = recs["fill"]
    rings_fill = {s: fill["body_pos"][bring_idx[s]] for s in ("L", "R")}
    edge_fill = frame(fill, fill["body_pos"], rings_fill, True)

    # blink closure 1.0 + slit 1.0 (diagnostic geometric count).
    closed = {"eye-left-closure": 1.0, "eye-right-closure": 1.0,
              "eye-left-slit": 1.0, "eye-right-slit": 1.0}
    fjs, fblob, fw = fill["js"], fill["blob"], fill["worlds"]
    fillm = mesh_by_sub(fjs, "corner_fill")
    body_blink, _ = skin_prims(fjs, fblob, fw, fill["body"], closed)
    fpos_blink, ftris_blink = skin_prims(fjs, fblob, fw, fillm, closed)
    rings_blink = {s: body_blink[bring_idx[s]] for s in ("L", "R")}
    blink = frame({**fill, "fill_pos": fpos_blink,
                   "fill_tris": ftris_blink}, body_blink, rings_blink, True)

    # CW3 (world, anterior +Z): per fill vert, the signed distance in front
    # of the lid-margin surface = fill z minus the max VISIBLE-skin z
    # among skin-prim verts within 10 mm in the frontal (XY) plane — the
    # tissue the grader sees around each canthus concavity (rolls, bridge,
    # cheek). Band-loop-limited refs see only the diving notch floor and
    # would bury any mouth-plane membrane by construction; the 3 mm
    # band-floor version is reported alongside as a diagnostic. Gate:
    # visible-skin 10 mm version <= 0.
    loop_world = np.concatenate([rings_fill["L"], rings_fill["R"]])
    n_skin = fill["js"]["accessors"][fill["body"]["primitives"][0][
        "attributes"]["POSITION"]]["count"]
    skin_world = fill["body_pos"][:n_skin]
    dmax = dmax3 = -1e9
    for p in fill["fill_pos"]:
        dxy = np.linalg.norm(skin_world[:, :2] - p[:2], axis=1)
        near = skin_world[dxy < 0.010]
        ref = near[:, 2].max() if len(near) else skin_world[:, 2].max()
        dmax = max(dmax, float(p[2] - ref))
        dxyb = np.linalg.norm(loop_world[:, :2] - p[:2], axis=1)
        near3 = loop_world[dxyb < 0.003]
        ref3 = near3[:, 2].max() if len(near3) else loop_world[:, 2].max()
        dmax3 = max(dmax3, float(p[2] - ref3))
    cw3maxMm = round(dmax * 1000.0, 4)
    cw3max3mmMm = round(dmax3 * 1000.0, 4)

    def tot(fr, key):
        return {v: sum(fr[v][t][key] for t in ("L", "R")) for v in views}

    report = {
        "tool": "tools/openclinxr/asset-pipeline/makeclothes/eye-corner/measure_eye_corner.py",
        "baseGlbSha256": base["sha"],
        "fillGlbSha256": fill["sha"],
        "bodyPosSha256": base["bodyPosSha"],
        "resMm": res,
        "loops": {s: {"loopBandVerts": int(len(bring_idx[s]))}
                  for s in ("L", "R")},
        "edgeBase": tot(edge_base, "edgePx"),
        "edgeFill": tot(edge_fill, "edgePx"),
        "eyeInsideBase": tot(edge_base, "eyeInsidePx"),
        "eyeInsideFill": tot(edge_fill, "eyeInsidePx"),
        "fillPx": tot(edge_fill, "fillPx"),
        "blinkFillOutsideClosed": tot(blink, "fillPx"),
        "cw3maxMm": cw3maxMm,
        "cw3max3mmMm": cw3max3mmMm,
        "perSide": {"base": edge_base, "fill": edge_fill},
    }
    with open(args.out, "w") as f:
        json.dump(report, f, indent=1)
    print(json.dumps({"edgeBase": report["edgeBase"],
                      "eyeInsideBase": report["eyeInsideBase"],
                      "eyeInsideFill": report["eyeInsideFill"],
                      "cw3maxMm": cw3maxMm,
                      "cw3max3mmMm(diag)": cw3max3mmMm,
                      "blinkFillOutsideClosed(diag)":
                      report["blinkFillOutsideClosed"]}, indent=1))


if __name__ == "__main__":
    sys.exit(main())
