#!/usr/bin/env python3
"""Tearline geometry probe: cause pin + G2/G3-byte measurement from GLB bytes.

Reads (never writes) a baked GLB:
- tearline mesh: tri count, tri94 verts/centroid (lash-tick owner record),
- body eye-opening boundary -> per-side lower-lid loop (lash method:
  edges used by exactly one face, eye-window filtered, per-side 3mm
  x-bins, min-y vert per bin),
- per-tri centroid distance to the lower loop + signed below-loop offset,
- G2: lower-loop arc-length fraction within 1.0 mm of the tearline,
- G3-byte: closure=1.0 applied to body loop (nearest-vert delta);
  tearline verts (static: final.glb tearline prims carry 0 morph targets)
  farther than 1.0 mm in front of / below the closed seam count as outside.

Usage: probe_tearline.py <glb>
"""
import json
import struct
import sys

import numpy as np

_CT = {5120: "i1", 5121: "u1", 5122: "i2", 5123: "u2", 5125: "u4", 5126: "f4"}
_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
_SZ = {"i1": 1, "u1": 1, "i2": 2, "u2": 2, "u4": 4, "f4": 4}


def load_glb(path):
    raw = open(path, "rb").read()
    assert raw[:4] == b"glTF", path
    jl = struct.unpack("<I", raw[12:16])[0]
    g = json.loads(raw[20:20 + jl])
    blob = raw[20 + jl + 8:]
    return g, blob


def make_reader(g, blob):
    def acc(i):
        a = g["accessors"][i]
        dt = np.dtype(_CT[a["componentType"]])
        n, nc = a["count"], _NC[a["type"]]
        if "bufferView" not in a:
            sp = a.get("sparse")
            if not sp:
                return np.zeros((n, nc))
            ibv = g["bufferViews"][sp["indices"]["bufferView"]]
            ibase = ibv.get("byteOffset", 0) + sp["indices"].get("byteOffset", 0)
            idx = np.frombuffer(blob, dtype=np.dtype(_CT[sp["indices"]["componentType"]]),
                                count=sp["count"], offset=ibase).astype(int)
            vbv = g["bufferViews"][sp["values"]["bufferView"]]
            vbase = vbv.get("byteOffset", 0) + sp["values"].get("byteOffset", 0)
            val = np.frombuffer(blob, dtype=np.dtype(_CT[a["componentType"]]),
                                count=sp["count"] * nc, offset=vbase).reshape(-1, nc)
            out = np.zeros((n, nc))
            out[idx] = val
            return out
        bv = g["bufferViews"][a["bufferView"]]
        base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        sz = _SZ[_CT[a["componentType"]]]
        st = bv.get("byteStride")
        if st and st != nc * sz:
            s = np.frombuffer(blob, dtype=np.uint8, count=n * st, offset=base).reshape(n, st)
            cols = []
            for k in range(nc):
                cols.append(s[:, k * sz:(k + 1) * sz].reshape(n, -1).view(dt).reshape(n))
            return np.stack(cols, 1)
        return np.frombuffer(blob, dtype=dt, count=n * nc, offset=base).reshape(n, nc)
    return acc


def node_matrix(n):
    m = np.eye(4)
    if n.get("matrix") is not None:
        return np.array(n["matrix"], dtype=float).reshape(4, 4).T
    t = n.get("translation", [0, 0, 0])
    r = n.get("rotation", [0, 0, 0, 1])
    s = n.get("scale", [1, 1, 1])
    x, y, z, w = r
    R = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    m[:3, :3] = R * np.array(s)
    m[:3, 3] = t
    return m


def joint_world_matrices(g):
    nodes = g["nodes"]
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []) or []:
            parent[c] = i
    world = {}

    def W(i):
        if i in world:
            return world[i]
        m = node_matrix(nodes[i])
        world[i] = (W(parent[i]) @ m) if i in parent else m
        return world[i]

    for i in range(len(nodes)):
        W(i)
    return world


def main():
    path = sys.argv[1]
    g, blob = load_glb(path)
    acc = make_reader(g, blob)

    tear = next(m for m in g["meshes"] if "tearline" in m["name"])
    tp = tear["primitives"][0]
    TV = np.array(acc(tp["attributes"]["POSITION"]), dtype=float)
    TI = np.array(acc(tp["indices"]).ravel(), dtype=int).reshape(-1, 3)
    print(f"TEARLINE verts={len(TV)} tris={len(TI)} targets={len(tp.get('targets', []) or [])}")
    tri94 = TI[94]
    print(f"tri94 verts={tuple(tri94)} centroid={((TV[tri94].mean(axis=0)) * 1000).round(3)}mm")
    for v in tri94:
        print(f"  v{v}={(TV[v] * 1000).round(3)}mm")

    body = next(m for m in g["meshes"] if "body" in m["name"].lower())
    names = (body.get("extras", {}) or {}).get("targetNames", [])
    BVs, BF = [], []
    off = 0
    for p in body["primitives"]:
        V = np.array(acc(p["attributes"]["POSITION"]), dtype=float)
        I = np.array(acc(p["indices"]).ravel(), dtype=int).reshape(-1, 3) + off
        off += len(V)
        BVs.append(V)
        BF.append(I)
    BV = np.vstack(BVs)
    BF = np.vstack(BF)
    print(f"BODY verts={len(BV)} tris={len(BF)} prims={len(body['primitives'])}")

    # Pose the body into render space: exact linear-blend skinning
    # (bind POSITION vs the unskinned tearline differ by the head pose,
    # measured ~2.5mm systematic at the eye without this step).
    sk = g["skins"][0]
    JM = joint_world_matrices(g)
    IBM = np.array(acc(sk["inverseBindMatrices"]), dtype=float).reshape(-1, 4, 4).transpose(0, 2, 1)
    JMATS = np.stack([JM[j] @ IBM[k] for k, j in enumerate(sk["joints"])])
    BVs = []
    for p in body["primitives"]:
        V = np.array(acc(p["attributes"]["POSITION"]), dtype=float)
        J = np.array(acc(p["attributes"]["JOINTS_0"]), dtype=int)
        W8 = np.array(acc(p["attributes"]["WEIGHTS_0"]), dtype=float)
        M = JMATS[J]
        homo = np.concatenate([V, np.ones((len(V), 1))], axis=1)
        BVs.append(np.einsum("vk,vkij,vj->vi", W8, M, homo)[:, :3])
    BIND = BV
    BV = np.vstack(BVs)
    print(f"SKIN maxShift={(np.linalg.norm(BV - BIND, axis=1).max()) * 1000:.2f}mm")

    eyes = next(m for m in g["meshes"] if "eyes_low_poly" in m["name"] or "library_eyes" in m["name"])
    Eith = []
    for p in eyes["primitives"]:
        V = np.array(acc(p["attributes"]["POSITION"]), dtype=float)
        if "JOINTS_0" in p["attributes"]:
            J = np.array(acc(p["attributes"]["JOINTS_0"]), dtype=int)
            W8 = np.array(acc(p["attributes"]["WEIGHTS_0"]), dtype=float)
            M = JMATS[J]
            homo = np.concatenate([V, np.ones((len(V), 1))], axis=1)
            V = np.einsum("vk,vkij,vj->vi", W8, M, homo)[:, :3]
        Eith.append(V)
    EV = np.vstack(Eith)
    centers = {}
    for side, sel in (("L", EV[:, 0] < 0), ("R", EV[:, 0] >= 0)):
        pts = EV[sel]
        c = pts.mean(axis=0)
        centers[side] = (c, float(np.linalg.norm(pts - c, axis=1).mean()))
        print(f"EYE {side} center={(c * 1000).round(2)}mm r={centers[side][1] * 1000:.2f}mm")

    # boundary edges (used by exactly one face), eye-window filtered
    ec = {}
    for a, b, c in BF:
        for u, v in ((a, b), (b, c), (c, a)):
            k = (u, v) if u < v else (v, u)
            ec[k] = ec.get(k, 0) + 1
    loops = {}
    for side, (c, r) in centers.items():
        pts = []
        for (u, v), n in ec.items():
            if n != 1:
                continue
            for w in (u, v):
                p = BV[w]
                if abs(p[0] - c[0]) < 0.025 and abs(p[1] - c[1]) < 0.03 and abs(p[2] - c[2]) < 0.05:
                    pts.append(p)
        pts = np.array(pts)
        xs = np.arange(pts[:, 0].min(), pts[:, 0].max() + 1e-9, 0.003)
        loop = []
        for i in range(len(xs) - 1):
            sel = pts[(pts[:, 0] >= xs[i]) & (pts[:, 0] < xs[i + 1])]
            if len(sel):
                loop.append(sel[np.argmin(sel[:, 1])])
        loops[side] = np.array(loop)
        print(f"LOOP {side} n={len(loops[side])}", end="")
        if len(loops[side]):
            print(f" xspan={((loops[side][:, 0].max() - loops[side][:, 0].min()) * 1000):.1f}mm")
        else:
            print(" EMPTY")

    # per-tri distance to lower loop (same-side tris only: centroid x sign
    # matches the eye centre; the inter-eye gap dwarfs the margin width)
    cenAll = TV[TI].mean(axis=1)
    for side, loop in loops.items():
        cx = centers[side][0][0]
        same = cenAll[:, 0] * cx > 0
        cen = cenAll[same]
        tids = np.where(same)[0]
        TSV = TV[np.unique(TI[same])] if same.any() else np.empty((0, 3))
        d = np.linalg.norm(cen[:, None, :] - loop[None, :, :], axis=2).min(axis=1)
        # signed below-loop: loop y at nearest-x bin
        order = np.argsort(loop[:, 0])
        lx, ly = loop[order][:, 0], loop[order][:, 1]
        below = np.interp(np.clip(cen[:, 0], lx[0], lx[-1]), lx, ly) - cen[:, 1]
        print(f"DIST {side}: ntris={len(cen)} min={d.min() * 1000:.2f} max={d.max() * 1000:.2f} "
              f"mean={d.mean() * 1000:.2f}mm tris>1.0mm={(d > 0.001).sum()} "
              f"tris>2.0mm={(d > 0.002).sum()}")
        print(f"BELOW {side}: max_below={below.max() * 1000:.2f}mm "
              f"tris>1.0mm_below={(below > 0.001).sum()}")
        idx = np.argsort(-below)[:6]
        print(f"  worst local={idx.tolist()} global={tids[idx].tolist()} "
              f"below_mm={(below[idx] * 1000).round(2).tolist()} "
              f"dist_mm={(d[idx] * 1000).round(2).tolist()}")
        # coverage: loop arc length within 1mm of same-side tearline verts
        seg = np.linalg.norm(np.diff(loop[order], axis=0), axis=1)
        total = seg.sum()
        dl = np.linalg.norm(loop[order][:, None, :] - TSV[None, :, :], axis=2).min(axis=1)
        cov = seg[dl[:-1] < 0.001].sum() / total if total else 0
        print(f"COVERAGE {side}: {cov * 100:.1f}% within 1.0mm of tearline "
              f"(loop_len={total * 1000:.1f}mm)")

    # G3-byte: closure=1.0
    for side in ("L", "R"):
        key = f"eye-{('left' if side == 'L' else 'right')}-closure"
        if key not in names:
            print(f"BLINK {side}: no {key}")
            continue
        ki = names.index(key)
        deltas = []
        for p in body["primitives"]:
            tg = p.get("targets", [])
            if len(tg) > ki and "POSITION" in tg[ki]:
                deltas.append(np.array(acc(tg[ki]["POSITION"]), dtype=float))
            else:
                n = acc(p["attributes"]["POSITION"]).shape[0]
                deltas.append(np.zeros((n, 3)))
        BD = np.vstack(deltas)
        mag = np.linalg.norm(BD, axis=1)
        print(f"BLINK {side}: {key} maxDelta={mag.max() * 1000:.2f}mm "
              f"verts>0.05mm={(mag > 0.00005).sum()}")


if __name__ == "__main__":
    main()
