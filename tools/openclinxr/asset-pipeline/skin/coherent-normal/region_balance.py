"""OWN region gain helper for coherent pore normal (ph21-normal-region).

Derives a smooth UV-space amplitude field from the ACTUAL source GLB:
per-vertex dominant joint (max WEIGHTS_0 slot) -> head family (head joint +
descendants) / forearm family (lowerarm*/forearm*/lower_arm*), triangle to
dominant vertex, rasterized into 1024 UV masks, gaussian-blurred to avoid
seams. Gain = 1 + head_boost*headBlur - fore_cut*foreBlur... expressed as
head_gain/fore_gain targets:
  gain = headBlur*head_gain + foreBlur*fore_gain + (1-headBlur-foreBlur)*1.0
clipped at overlaps (head wins where both, neck/background = 1.0).

Deterministic, no RNG, no seed hunt. Applied to the heightfield BEFORE the
gradient so relief scales smoothly; no isolated dots / gravel / triangle
emboss (masks are blurred, never binary).
"""
import json
import struct

import numpy
from scipy.ndimage import gaussian_filter


def _parse_glb(path):
    d = open(path, "rb").read()
    jl, = struct.unpack("<I", d[12:16])
    gj = json.loads(d[20:20 + jl])
    off = 20 + jl
    cl, = struct.unpack("<I", d[off:off + 4])
    binary = d[off + 8:off + 8 + cl]
    return gj, binary


def _get(buf, views, accs, idx, count):
    acc = accs[idx]
    bv = views[acc["bufferView"]]
    base = (bv.get("byteOffset", 0) or 0) + (acc.get("byteOffset", 0) or 0)
    comp = acc["componentType"]
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    dtype = {5120: numpy.int8, 5121: numpy.uint8, 5122: numpy.int16,
             5123: numpy.uint16, 5125: numpy.uint32, 5126: numpy.float32}[comp]
    item = numpy.dtype(dtype).itemsize
    stride = bv.get("byteStride") or (ncomp * item)
    out = numpy.empty((count, ncomp), dtype=numpy.float64 if dtype == numpy.float32 else dtype)
    raw = buf
    if stride == ncomp * item:
        arr = numpy.frombuffer(raw[base:base + count * ncomp * item],
                               dtype=dtype).reshape(count, ncomp)
        return arr
    for i in range(count):
        s = base + i * stride
        out[i] = numpy.frombuffer(raw[s:s + ncomp * item], dtype=dtype)
    return out


def build_gain(glb_path, size=1024, head_gain=1.0, fore_gain=0.72, blur=8.0, return_hard=False):
    gj, binary = _parse_glb(glb_path)
    views = gj["bufferViews"]
    accs = gj["accessors"]
    # joint families from first skinned node (same rule as instrument)
    skins = gj.get("skins", [])
    if not skins:
        raise SystemExit("REFUSE: no skins in source GLB")
    # node->joint index: instrument uses skin.listJoints order == skins[0].joints
    joints = skins[0]["joints"]
    nodes = gj["nodes"]
    # find 'head' node index
    head_node = next(i for i, n in enumerate(nodes) if n.get("name") == "head")
    # descendants via children walk
    head_set = set()

    def walk(ni):
        head_set.add(ni)
        for c in nodes[ni].get("children", []):
            walk(c)
    walk(head_node)
    head_joints = {j for j, ni in enumerate(joints) if ni in head_set}
    import re
    fore_joints = {j for j, ni in enumerate(joints)
                   if re.match(r"^(lowerarm|forearm|lower_arm)", nodes[ni].get("name") or "", re.I)}
    head_mask = numpy.zeros((size, size), numpy.float32)
    fore_mask = numpy.zeros((size, size), numpy.float32)
    head_tris = fore_tris = 0
    for mesh in gj["meshes"]:
        for prim in mesh["primitives"]:
            if "material" not in prim:
                continue
            mat = gj["materials"][prim["material"]]
            if not mat.get("name", "").startswith("mpfb_skin_"):
                continue
            at = prim["attributes"]
            n = accs[at["POSITION"]]["count"]
            uv = _get(binary, views, accs, at["TEXCOORD_0"], n).astype(numpy.float64)
            ij = _get(binary, views, accs, at["JOINTS_0"], n)
            w = _get(binary, views, accs, at["WEIGHTS_0"], n).astype(numpy.float64)
            idx = prim.get("indices")
            if idx is None:
                continue
            tri = _get(binary, views, accs, idx, accs[idx]["count"]).reshape(-1, 3)
            dom = ij[numpy.arange(n), w.argmax(axis=1)]
            domw = w.max(axis=1)
            best = numpy.empty(len(tri), numpy.int32)
            for t in range(len(tri)):
                a, b, c = tri[t]
                bj, bw = dom[a], domw[a]
                if domw[b] > bw:
                    bj, bw = dom[b], domw[b]
                if domw[c] > bw:
                    bj, bw = dom[c], domw[c]
                best[t] = bj
            is_head = numpy.array([j in head_joints for j in best])
            is_fore = numpy.array([j in fore_joints for j in best])
            for fam, mask, flag in ((is_head, head_mask, True), (is_fore, fore_mask, False)):
                sel = numpy.nonzero(fam)[0]
                if flag:
                    head_tris += len(sel)
                else:
                    fore_tris += len(sel)
                for t in sel:
                    a, b, c = tri[t]
                    au, av = uv[a]
                    bu, bv = uv[b]
                    cu, cv = uv[c]
                    min_u, max_u = min(au, bu, cu), max(au, bu, cu)
                    min_v, max_v = min(av, bv, cv), max(av, bv, cv)
                    x0 = max(0, int(numpy.floor(min_u * size)) - 1)
                    x1 = min(size - 1, int(numpy.ceil(max_u * size)) + 1)
                    y0 = max(0, int(numpy.floor((1 - max_v) * size)) - 1)
                    y1 = min(size - 1, int(numpy.ceil((1 - min_v) * size)) + 1)
                    if x1 < x0 or y1 < y0:
                        continue
                    ys, xs = numpy.mgrid[y0:y1 + 1, x0:x1 + 1]
                    cx = (xs + 0.5) / size
                    cy = (size - 0.5 - ys) / size
                    d1 = (cx - bu) * (av - bv) - (au - bu) * (cy - bv)
                    d2 = (cx - cu) * (bv - cv) - (bu - cu) * (cy - cv)
                    d3 = (cx - au) * (cv - av) - (cu - au) * (cy - av)
                    # pointInTri: not (hasNeg and hasPos)
                    has_neg = (d1 < 0) | (d2 < 0) | (d3 < 0)
                    has_pos = (d1 > 0) | (d2 > 0) | (d3 > 0)
                    inside = (~(has_neg & has_pos)).astype(numpy.float32)
                    cur = mask[y0:y1 + 1, x0:x1 + 1]
                    numpy.maximum(cur, inside, out=cur)
    hb = gaussian_filter(head_mask, blur)
    fb = gaussian_filter(fore_mask, blur)
    numpy.clip(hb, 0, 1, out=hb)
    numpy.clip(fb, 0, 1, out=fb)
    # head wins overlaps; background stays 1.0
    fb = fb * (1 - hb)
    rest = numpy.clip(1 - hb - fb, 0, 1)
    gain = hb * head_gain + fb * fore_gain + rest * 1.0
    info = {
        "headTexels": int((head_mask > 0).sum()),
        "foreTexels": int((fore_mask > 0).sum()),
        "headTris": int(head_tris), "foreTris": int(fore_tris),
        "blur": blur, "headGain": head_gain, "foreGain": fore_gain}
    if return_hard:
        return gain.astype(numpy.float64), info, head_mask, fore_mask
    return gain.astype(numpy.float64), info


def hard_masks(glb_path, size=1024):
    _, info, hm, fm = build_gain(glb_path, size=size, blur=0.0, return_hard=True)
    return hm, fm
