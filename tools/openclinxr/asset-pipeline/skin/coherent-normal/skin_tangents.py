"""Coherent skin tangents: stdlib port of three r184 BufferGeometry.computeTangents.

Indexed-UV per-vertex tangents + handedness with Gram-Schmidt orthogonalize.
Reference: node_modules three@0.184.0 src/core/BufferGeometry.js computeTangents
(Lengyel terathon.com/code/tangent.html). Only POSITION/NORMAL/UV0/triangles.

MIT notice (three.js r184, LICENSE verbatim copy):

The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

Source path: node_modules/.pnpm/three@0.184.0/node_modules/three/LICENSE.
Actual-reference SHA: 41029aa0f06674911225eb8ac20e4894323fbb94f98be4ad3e0e65a11a17fe9a.

Parity notes: raw NORMAL used as-is (Three never renormalizes unit normals);
normalize via inverseLength multiplication (Three Vector3.normalize), not
division. Degenerate-UV triangles silently ignored; all-degenerate refuses.
"""
import json
import math
import struct


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def _normalize_mul(v):
    n = math.sqrt(_dot(v, v))
    if not math.isfinite(n) or n == 0:
        return None
    inv = 1.0 / n
    return (v[0] * inv, v[1] * inv, v[2] * inv)


def compute_tangents(positions, normals, uvs, indices):
    """positions/normals: [(x,y,z)], uvs: [(u,v)], indices: [int] flat triples.
    Returns [(x,y,z,w)] or raises ValueError (fail-closed)."""
    n = len(positions)
    if n == 0 or len(normals) != n or len(uvs) != n:
        raise ValueError("count mismatch")
    if len(indices) % 3 != 0 or not indices:
        raise ValueError("indices must be non-empty triples")
    for v in positions + normals:
        if len(v) != 3 or not all(math.isfinite(c) for c in v):
            raise ValueError("non-finite position/normal")
    for v in uvs:
        if len(v) != 2 or not all(math.isfinite(c) for c in v):
            raise ValueError("non-finite uv")
    if any(type(i) is not int or i < 0 or i >= n for i in indices):
        raise ValueError("index out of bounds")
    tan1 = [(0.0, 0.0, 0.0)] * n
    tan2 = [(0.0, 0.0, 0.0)] * n

    def add(t, v, s):
        return (t[0] + v[0] * s, t[1] + v[1] * s, t[2] + v[2] * s)

    for t in range(0, len(indices), 3):
        a, b, c = indices[t], indices[t + 1], indices[t + 2]
        pa, pb, pc = positions[a], positions[b], positions[c]
        ua, ub, uc = uvs[a], uvs[b], uvs[c]
        db = _sub(pb, pa)
        dc = _sub(pc, pa)
        dub = (ub[0] - ua[0], ub[1] - ua[1])
        duc = (uc[0] - ua[0], uc[1] - ua[1])
        denom = dub[0] * duc[1] - duc[0] * dub[1]
        r = 1.0 / denom if denom != 0.0 else float("inf")
        if not math.isfinite(r):
            continue  # degenerate UV triangle silently ignored (three parity)
        sdir = add((db[0] * duc[1], db[1] * duc[1], db[2] * duc[1]),
                   dc, -dub[1])
        sdir = (sdir[0] * r, sdir[1] * r, sdir[2] * r)
        tdir = add((dc[0] * dub[0], dc[1] * dub[0], dc[2] * dub[0]),
                   db, -duc[0])
        tdir = (tdir[0] * r, tdir[1] * r, tdir[2] * r)
        for v in (a, b, c):
            tan1[v] = add(tan1[v], sdir, 1.0)
            tan2[v] = add(tan2[v], tdir, 1.0)
    if not any(t != (0.0, 0.0, 0.0) for t in tan1):
        raise ValueError("all-degenerate uv triangles")
    out = []
    for v in range(n):
        nv = normals[v]  # raw NORMAL, never renormalized (three parity)
        t = tan1[v]
        d = _dot(nv, t)
        # Gram-Schmidt using raw normal, then inverseLength normalize
        orth = (t[0] - nv[0] * d, t[1] - nv[1] * d, t[2] - nv[2] * d)
        tn = _normalize_mul(orth)
        if tn is None:
            raise ValueError("degenerate tangent (gram-schmidt)")
        w = -1.0 if _dot(_cross(nv, t), tan2[v]) < 0.0 else 1.0
        out.append((tn[0], tn[1], tn[2], w))
    return out


# ---- glTF reader: strict accessor boundary + tangent append (binder glue calls in) ----
_CT = {5121: ("B", 1), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
_INDEX_CT = {5121, 5123, 5125}


def _is_int(x):
    return type(x) is int


def read_accessor_floats(doc, binary, idx):
    """Strict-boundary float reader. Refuses sparse/normalized/non-finite/bad types,
    negative/non-int offsets-counts-lengths (bool rejected), view crossing whole-BIN,
    stride only via bufferView byteStride aligned >= row bytes, bad index refs."""
    acc = doc["accessors"][idx]
    if acc.get("sparse") is not None:
        raise ValueError("sparse accessor refused")
    if acc.get("normalized"):
        raise ValueError("normalized accessor refused")
    ct = acc.get("componentType")
    if ct not in _CT:
        raise ValueError("unsupported componentType")
    fmt, sz = _CT[ct]
    tp = acc.get("type")
    ncomp = _NCOMP.get(tp)
    if ncomp is None:
        raise ValueError("bad accessor type")
    for k in ("count", "bufferView"):
        v = acc.get(k)
        if not _is_int(v) or v < 0:
            raise ValueError("bad accessor " + k)
    for k in ("byteOffset",):
        v = acc.get(k, 0)
        if not _is_int(v) or v < 0:
            raise ValueError("bad accessor " + k)
    bvi = acc["bufferView"]
    if not _is_int(bvi) or bvi < 0 or bvi >= len(doc.get("bufferViews", [])):
        raise ValueError("bad bufferView ref")
    v = doc["bufferViews"][bvi]
    for k in ("byteOffset", "byteLength"):
        x = v.get(k, 0) if k == "byteOffset" else v.get(k)
        if not _is_int(x) or x < 0:
            raise ValueError("bad bufferView " + k)
    if v.get("buffer", 0) != 0:
        raise ValueError("only buffer 0 supported")
    for k in ("byteStride",):
        if k in v and (not _is_int(v[k]) or v[k] < 0):
            raise ValueError("bad bufferView stride")
    for k in ("byteOffset",):
        if k in acc and (not _is_int(acc[k]) or acc[k] < 0):
            raise ValueError("bad accessor offset")
    base = v.get("byteOffset", 0) + acc.get("byteOffset", 0)
    row = ncomp * sz
    stride = acc.get("byteStride", v.get("byteStride", row))
    if not _is_int(stride) or stride < row or stride % 1 != 0:
        raise ValueError("bad stride")
    if "byteStride" in acc:
        raise ValueError("stride only via bufferView")
    views = doc["bufferViews"]
    end = base + (acc["count"] - 1) * stride + row if acc["count"] else base
    if base < v.get("byteOffset", 0) or end > v.get("byteOffset", 0) + v["byteLength"]:
        raise ValueError("accessor crosses view bounds")
    if end > len(binary):
        raise ValueError("accessor out of bounds")
    out = []
    for i in range(acc["count"]):
        rowv = []
        for k in range(ncomp):
            o = base + i * stride + k * sz
            rowv.append(struct.unpack("<" + fmt, binary[o:o + sz])[0])
        if any(not math.isfinite(c) for c in rowv):
            raise ValueError("non-finite accessor value")
        out.append(tuple(rowv))
    return out


def read_indices(doc, binary, idx):
    acc = doc["accessors"][idx]
    if acc.get("type") != "SCALAR":
        raise ValueError("bad index type")
    if acc.get("componentType") not in _INDEX_CT:
        raise ValueError("indices must be unsigned 5121/5123/5125")
    return [int(x[0]) for x in read_accessor_floats(doc, binary, idx)]


def compute_skin_tangents_for_primitive(doc, binary, prim, skin_mat):
    """Exactly-one-skin-primitive helper: validates MODE TRIANGLES, no TANGENT,
    indexed POSITION/NORMAL/UV0, then computes. Returns (tangents, meta)."""
    if prim.get("material") != skin_mat:
        raise ValueError("not skin primitive")
    if prim.get("mode", 4) != 4:
        raise ValueError("primitive mode must be TRIANGLES(4)")
    ats = prim.get("attributes") or {}
    if "TANGENT" in ats:
        raise ValueError("primitive already has TANGENT")
    for req, tp in (("POSITION", "VEC3"), ("NORMAL", "VEC3"), ("TEXCOORD_0", "VEC2")):
        if req not in ats:
            raise ValueError("tangent source missing " + req)
        acc = doc["accessors"][ats[req]]
        if acc.get("type") != tp or acc.get("componentType") != 5126:
            raise ValueError("tangent source bad accessor for " + req)
    if prim.get("indices") is None:
        raise ValueError("tangent source needs indexed triangles")
    pos = read_accessor_floats(doc, binary, ats["POSITION"])
    nrm = read_accessor_floats(doc, binary, ats["NORMAL"])
    uv = read_accessor_floats(doc, binary, ats["TEXCOORD_0"])
    idx = read_indices(doc, binary, prim["indices"])
    tans = compute_tangents(pos, nrm, uv, idx)
    return tans, {"count": len(tans)}


def append_skin_tangents(doc, newbin, skin_mat):
    """Stage all validation, then pack/append exactly one TANGENT view+accessor.

    Selection/read/compute happen before ANY mutation; refusal leaves doc/BIN
    untouched. Returns (newbin_bytes, metadata)."""
    import hashlib as _hl
    # ---- stage: select exactly one skin primitive + validate ----
    targets = []
    for mi, m in enumerate(doc.get("meshes", [])):
        for pi, p in enumerate(m.get("primitives", [])):
            if p.get("material") == skin_mat:
                targets.append((mi, pi))
    if len(targets) != 1:
        raise ValueError("exactly one skin primitive required: found %d" % len(targets))
    mi, pi = targets[0]
    prim = doc["meshes"][mi]["primitives"][pi]
    tans, _m = compute_skin_tangents_for_primitive(doc, bytes(newbin), prim, skin_mat)
    # ---- stage: pack ALL raw rows first (no doc/BIN touch yet) ----
    import struct as _st
    raw = bytearray()
    for t in tans:
        raw += _st.pack("<4f", *t)
    full_raw_sha = _hl.sha256(bytes(raw)).hexdigest()
    # ---- commit: single aligned append, exact 1 view + 1 accessor + attr ----
    blob = bytearray(newbin)
    while len(blob) % 4:
        blob += b"\x00"
    views = doc["bufferViews"]
    voff = len(blob)
    blob += bytes(raw)
    views.append({"buffer": 0, "byteOffset": voff, "byteLength": len(raw)})
    ai = len(doc["accessors"])
    doc["accessors"].append({"bufferView": len(views) - 1, "componentType": 5126,
                              "count": len(tans), "type": "VEC4"})
    prim["attributes"]["TANGENT"] = ai
    import os as _os
    meta = {"targetMesh": mi, "targetPrim": pi, "count": len(tans),
            "tangentCount": len(tans), "tangentSha": full_raw_sha,
            "bytesSha": full_raw_sha, "fullRawSha": full_raw_sha,
            "helperFile": "skin_tangents.py",
            "helperSha": _hl.sha256(open(_os.path.abspath(__file__), "rb").read()).hexdigest()}
    return bytes(blob), meta
