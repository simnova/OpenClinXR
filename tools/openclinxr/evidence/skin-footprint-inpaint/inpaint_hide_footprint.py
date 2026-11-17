"""Fill the hide-mask footprint of an MPFB skin baseColor from its own texels.

Proven-tool rule (D1/D5): the fill is cv2 Telea inpainting, one island at a
time, with every texel outside the island excluded as a source. No hand-written
diffuser, no generative model, no noise added by hand.

Islands: connected components (8-neighbour) of the union of the rasterized UV
triangles of every primitive that uses the body skin material OR an
openclinxr_hidden_ material. Rasterization matches
store st-teeth/skin-audit-2/scripts/measure.py exactly: x = u*W, y = v*H,
pixel centres inside, no dilation.

Subcommands:
  (default inpaint)  --in GLB --out GLB --footprint-mask PNG --report JSON
                       [--footprint-glb GLB]
  measure              --glb GLB --footprint-mask PNG            -> JSON stdout
  measure-image        --glb GLB --in-png PNG --footprint-mask PNG -> JSON stdout
                       (islands from the GLB UVs, pixels from the PNG)
  inpaint-image        --glb GLB --in-png PNG --footprint-mask PNG --out-png PNG
  derive-fixture       --footprint-glb GLB --out-mask PNG       -> JSON stdout

Refusals are named errors on stderr starting with INPAINT_REFUSED:, exit 2,
and no output file is written.
"""

import argparse
import hashlib
import importlib.metadata as _md
import io
import json
import os
import struct
import sys
import tempfile

import cv2
import numpy as np
from PIL import Image

TOOL_ID = "tools/openclinxr/evidence/skin-footprint-inpaint/inpaint_hide_footprint.py"
INPAINT_RADIUS = 3

COMP_TYPE_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
COMP_DTYPE = {
    5120: np.int8,
    5121: np.uint8,
    5122: np.int16,
    5123: np.uint16,
    5125: np.uint32,
    5126: np.float32,
}


def _refuse(code, detail):
    sys.stderr.write("INPAINT_REFUSED:%s: %s\n" % (code, detail))
    raise SystemExit(2)


def cv2_licence():
    try:
        lic = (_md.metadata("opencv-python").get("License") or "").strip()
    except Exception:
        lic = ""
    return {"version": cv2.__version__, "licence": lic or "unknown"}


# ---------------------------------------------------------------- GLB IO


def load_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, _ln = struct.unpack("<III", data[:12])
    if magic != 0x46546C67:
        raise ValueError("not a GLB: %s" % path)
    off = 12
    js = None
    binchunk = None
    while off < len(data):
        clen, ctype = struct.unpack("<II", data[off : off + 8])
        cdata = data[off + 8 : off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(cdata.decode("utf-8"))
        elif ctype == 0x004E4942:
            binchunk = cdata
        off += 8 + clen
    if js is None or binchunk is None:
        raise ValueError("GLB missing JSON or BIN chunk: %s" % path)
    return js, binchunk, ver


def get_buffer_bytes(js, binchunk):
    bufs = js.get("buffers", [])
    if bufs and "uri" in bufs[0]:
        import base64

        uri = bufs[0]["uri"]
        if uri.startswith("data:"):
            return base64.b64decode(uri.split(",", 1)[1])
        raise ValueError("external buffer uri not supported")
    return bytes(binchunk)


def accessor_array_idx(js, buf, idx):
    from numpy.lib.stride_tricks import as_strided

    acc = js["accessors"][idx]
    bv = js["bufferViews"][acc["bufferView"]]
    boff = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    n = acc["count"]
    typ = acc["type"]
    ct = acc["componentType"]
    dt = np.dtype(COMP_DTYPE[ct])
    numc = COMP_TYPE_COUNT[typ]
    itemsize = numc * dt.itemsize
    stride = bv.get("byteStride", itemsize)
    if stride == itemsize:
        arr = np.frombuffer(buf, dtype=dt, count=n * numc, offset=boff)
        return arr.reshape((n, numc))
    raw_full = np.frombuffer(buf, dtype=np.uint8)
    win = as_strided(raw_full[boff:], shape=(n, itemsize), strides=(stride, 1))
    win_c = np.ascontiguousarray(win)
    return win_c.view(dt).reshape((n, numc))


def get_indices(js, buf, prim):
    if "indices" not in prim:
        n = js["accessors"][prim["attributes"]["POSITION"]]["count"]
        return np.arange(n, dtype=np.uint32)
    return accessor_array_idx(js, buf, prim["indices"]).reshape(-1).astype(np.int64)


def get_uvs(js, buf, prim):
    if "TEXCOORD_0" not in prim["attributes"]:
        return None
    return accessor_array_idx(js, buf, prim["attributes"]["TEXCOORD_0"]).astype(np.float64)


def find_body_mesh(js):
    for mi, mesh in enumerate(js.get("meshes", [])):
        nm = (mesh.get("name") or "").lower()
        if "body" in nm and "mpfb" in nm:
            return mi, mesh
    for mi, mesh in enumerate(js.get("meshes", [])):
        if "body" in (mesh.get("name") or "").lower():
            return mi, mesh
    best = None
    bestn = -1
    for mi, mesh in enumerate(js.get("meshes", [])):
        n = sum(
            1
            for p in mesh["primitives"]
            if "openclinxr_hidden_" in ((js["materials"][p["material"]].get("name", "")) if p.get("material") is not None else "")
        )
        if n > bestn:
            bestn = n
            best = (mi, mesh)
    return best


def skin_info(js, buf=None):
    mats = js.get("materials", [])
    found = find_body_mesh(js)
    if found is None:
        return None, None
    mi, mesh = found
    skin_mat = None
    skin_mat_idx = None
    for prim in mesh["primitives"]:
        midx = prim.get("material")
        if midx is None:
            continue
        mn = mats[midx].get("name", "") or ""
        if "openclinxr_hidden_" in mn:
            continue
        if mn == "mpfb_skin_ed_chest_pain_nurse_adult" or mn.startswith("mpfb_skin"):
            skin_mat = mn
            skin_mat_idx = midx
            break
    if skin_mat is None:
        return None, (mi, mesh)
    m = mats[skin_mat_idx]
    bct = m.get("pbrMetallicRoughness", {}).get("baseColorTexture")
    if not bct:
        return (skin_mat, skin_mat_idx, None, None), (mi, mesh)
    tex_idx = bct["index"]
    tex = js["textures"][tex_idx]
    img_idx = tex["source"]
    return (skin_mat, skin_mat_idx, tex_idx, img_idx), (mi, mesh)


def image_raw_bytes(js, buf, img_idx):
    img = js["images"][img_idx]
    if "bufferView" in img:
        bv = js["bufferViews"][img["bufferView"]]
        boff = bv.get("byteOffset", 0)
        return bytes(buf[boff : boff + bv["byteLength"]])
    if "uri" in img and img["uri"].startswith("data:"):
        import base64

        return base64.b64decode(img["uri"].split(",", 1)[1])
    raise ValueError("image %d has no embedded bytes" % img_idx)


def rasterize(tris, W, H):
    mask = np.zeros((H, W), dtype=bool)
    for tri in tris:
        u = tri[:, 0]
        v = tri[:, 1]
        xs = u * W
        ys = v * H
        xmin = int(max(0, np.floor(xs.min())))
        xmax = int(min(W - 1, np.ceil(xs.max())))
        ymin = int(max(0, np.floor(ys.min())))
        ymax = int(min(H - 1, np.ceil(ys.max())))
        if xmax < xmin or ymax < ymin:
            continue
        gx = np.arange(xmin, xmax + 1, dtype=np.float64) + 0.5
        gy = np.arange(ymin, ymax + 1, dtype=np.float64) + 0.5
        XX, YY = np.meshgrid(gx, gy)
        x0, y0 = xs[0], ys[0]
        x1, y1 = xs[1], ys[1]
        x2, y2 = xs[2], ys[2]
        d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(d) < 1e-12:
            continue
        l0 = ((y1 - y2) * (XX - x2) + (x2 - x1) * (YY - y2)) / d
        l1 = ((y2 - y0) * (XX - x2) + (x0 - x2) * (YY - y2)) / d
        l2 = 1 - l0 - l1
        inside = (l0 >= -1e-9) & (l1 >= -1e-9) & (l2 >= -1e-9)
        mask[ymin : ymax + 1, xmin : xmax + 1] |= inside
    return mask


def uv_tris_for(js, buf, mesh, pred):
    mats = js.get("materials", [])
    tris = []
    for prim in mesh["primitives"]:
        midx = prim.get("material")
        mn = mats[midx].get("name", "") if midx is not None and midx < len(mats) else ""
        if not pred(midx, mn):
            continue
        idx = get_indices(js, buf, prim)
        uv = get_uvs(js, buf, prim)
        if uv is None:
            continue
        for t in idx.reshape(-1, 3):
            tris.append(uv[t])
    return tris


def hidden_uv_tris(js, buf, mesh):
    mats = js.get("materials", [])
    tris = []
    hidden_prim_count = 0
    prims_info = []
    for pi, prim in enumerate(mesh["primitives"]):
        midx = prim.get("material")
        mn = mats[midx].get("name", "") if midx is not None and midx < len(mats) else ""
        if "openclinxr_hidden_" not in (mn or ""):
            continue
        hidden_prim_count += 1
        idx = get_indices(js, buf, prim)
        uv = get_uvs(js, buf, prim)
        ntri = len(idx) // 3
        prims_info.append((pi, mn, ntri, uv is not None))
        if uv is None:
            continue
        for t in idx.reshape(-1, 3):
            tris.append(uv[t])
    return tris, hidden_prim_count, prims_info


def compute_islands(js, buf, mesh, skin_mat_idx, W, H):
    tris = uv_tris_for(
        js,
        buf,
        mesh,
        lambda midx, mn: midx == skin_mat_idx or "openclinxr_hidden_" in (mn or ""),
    )
    union = rasterize(tris, W, H).astype(np.uint8)
    n, labels = cv2.connectedComponents(union, connectivity=8)
    return union.astype(bool), labels, n - 1


def load_mask(path, W, H):
    im = Image.open(path).convert("L")
    if im.size != (W, H):
        _refuse(
            "MASK_SIZE_MISMATCH",
            "mask %s is %dx%d but skin is %dx%d" % (path, im.size[0], im.size[1], W, H),
        )
    return np.array(im) > 127


def check_refusals(fp, labels, n_islands):
    fn, flab = cv2.connectedComponents(fp.astype(np.uint8), connectivity=8)
    for k in range(1, fn):
        comp = flab == k
        isl = set(int(v) for v in np.unique(labels[comp])) - {0}
        if len(isl) > 1:
            _refuse(
                "FOOTPRINT_SPANS_ISLANDS",
                "footprint component %d (%d texels) touches islands %s" % (k, int(comp.sum()), sorted(isl)),
            )
    outside = fp & (labels == 0)
    if bool(outside.any()):
        _refuse(
            "FOOTPRINT_OUTSIDE_ISLANDS",
            "%d footprint texels lie outside every island" % int(outside.sum()),
        )
    touched = sorted(int(v) for v in set(np.unique(labels[fp])) - {0})
    return fn - 1, touched


def fill_from_own_skin(arr, fp, labels, touched):
    filled = arr.copy()
    for isl in touched:
        islmask = labels == isl
        ys, xs = np.nonzero(islmask)
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        crop = arr[y0 : y1 + 1, x0 : x1 + 1].copy()
        isl_c = islmask[y0 : y1 + 1, x0 : x1 + 1]
        fp_c = fp[y0 : y1 + 1, x0 : x1 + 1] & isl_c
        outside_c = ~isl_c
        # Canonicalize: every texel outside this island is excluded as a
        # source (marked in the inpaint mask), and its value is reset to a
        # fixed constant so joint Telea runs cannot leak outside information
        # into the island through the marching front at shared boundaries.
        # This is what makes the (iso) gate exact.
        crop[outside_c] = 0
        inpaint_mask = ((fp_c | outside_c).astype(np.uint8)) * 255
        done = cv2.inpaint(crop, inpaint_mask, INPAINT_RADIUS, cv2.INPAINT_TELEA)
        sub = filled[y0 : y1 + 1, x0 : x1 + 1]
        sub[fp_c] = done[fp_c]
    return filled


def _pair_stats(d_right, d_down):
    out = {"pairs": int(d_right.shape[0] + d_down.shape[0])}
    if out["pairs"] == 0:
        for ch in ("r", "g", "b"):
            out["mean_%s" % ch] = 0.0
            out["p95_%s" % ch] = 0.0
            out["p99_%s" % ch] = 0.0
        return out
    d = np.vstack([d_right, d_down]).astype(np.int16)
    for c, ch in enumerate("rgb"):
        col = d[:, c]
        out["mean_%s" % ch] = float(col.mean())
        out["p95_%s" % ch] = float(np.percentile(col, 95))
        out["p99_%s" % ch] = float(np.percentile(col, 99))
    return out


def seam_stats(img, fp, labels):
    lab = labels
    # Every unordered 4-neighbour pair crossing the footprint boundary exactly
    # once: one endpoint in the footprint, the other in the 4px ring, both in
    # the same non-zero island. Horizontal enumeration (x,x+1) covers both
    # left->right and right->left; vertical covers up->down and down->up.
    same_h = (lab[:, :-1] == lab[:, 1:]) & (lab[:, :-1] != 0)
    cross_h = (fp[:, :-1] != fp[:, 1:]) & same_h
    d_h = np.abs(img[:, :-1][cross_h].astype(int) - img[:, 1:][cross_h].astype(int))
    same_v = (lab[:-1, :] == lab[1:, :]) & (lab[:-1, :] != 0)
    cross_v = (fp[:-1, :] != fp[1:, :]) & same_v
    d_v = np.abs(img[:-1, :][cross_v].astype(int) - img[1:, :][cross_v].astype(int))
    return _pair_stats(d_h, d_v)


def own_delta_p95(img, domain):
    r = domain[:, :-1] & domain[:, 1:]
    d_r = np.abs(img[:, :-1][r].astype(int) - img[:, 1:][r].astype(int))
    dwn = domain[:-1, :] & domain[1:, :]
    d_d = np.abs(img[:-1, :][dwn].astype(int) - img[1:, :][dwn].astype(int))
    return _pair_stats(d_r, d_d)


def luma_std(arr):
    l = (0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]).astype(np.float64)
    m = cv2.blur(l, (5, 5))
    m2 = cv2.blur(l * l, (5, 5))
    return np.sqrt(np.maximum(m2 - m * m, 0))


def variance_stats(arr, fp, labels, touched):
    dom = np.zeros_like(fp)
    for isl in touched:
        dom |= labels == isl
    std = luma_std(arr.astype(np.float64))
    in_m = fp & dom
    out_m = dom & ~fp
    med_in = float(np.median(std[in_m])) if in_m.any() else 0.0
    med_out = float(np.median(std[out_m])) if out_m.any() else 0.0
    per_island = {}
    for isl in touched:
        r = (labels == isl) & ~fp
        per_island[str(isl)] = {
            "median": float(np.median(std[r])) if r.any() else 0.0,
            "texels": int(r.sum()),
        }
    return {
        "stat": "luma 5x5 cv2.blur stddev",
        "filledMedian": med_in,
        "nonFootprintMedian": med_out,
        "ratio": (med_in / med_out) if med_out else 0.0,
        "filledTexels": int(in_m.sum()),
        "refTexels": int(out_m.sum()),
        "perIslandNonFootprintMedian": per_island,
    }


def encode_png_fixed(arr):
    buf = io.BytesIO()
    Image.fromarray(arr, "RGB").save(buf, format="PNG", optimize=False, compress_level=6)
    return buf.getvalue()


def measure_pixels(img_name, arr, fp, labels, touched, W, H):
    maxc = arr.max(axis=2)
    out = {
        "footprintTexels": int(fp.sum()),
        "footprintBlackFrac": float((maxc[fp] <= 8).mean()) if fp.sum() else 0.0,
        "islandsTouched": touched,
    }
    rgba = np.dstack([arr, np.full(arr.shape[:2], 255, np.uint8)])
    z = rgba.copy()
    z[fp] = 0
    out["offFootprintHash"] = hashlib.sha256(z.tobytes()).hexdigest()
    out["seam"] = seam_stats(arr, fp, labels)
    dom = np.zeros_like(fp)
    for isl in touched:
        dom |= labels == isl
    out["ownDeltaP95"] = own_delta_p95(arr, dom & ~fp)
    out["variance"] = variance_stats(arr, fp, labels, touched)
    return out


def full_measure(js, buf, img_idx, arr, fp):
    W = arr.shape[1]
    H = arr.shape[0]
    found = find_body_mesh(js)
    if found is None:
        _refuse("NO_BODY_MESH", "no body mesh found")
    _mi, mesh = found
    si, _ = skin_info(js)
    if si is None or si[0] is None:
        _refuse("SKIN_NOT_FOUND", "no mpfb_skin material on the body mesh")
    _skin_mat, skin_mat_idx, _tex_idx, _img_idx2 = si
    _union, labels, n_islands = compute_islands(js, buf, mesh, skin_mat_idx, W, H)
    _ncomp, touched = check_refusals(fp, labels, n_islands)
    pix = measure_pixels("", arr, fp, labels, touched, W, H)
    pix["islandCount"] = int(n_islands)
    return pix, labels, touched, si


def accessor_data_hash(js, buf):
    h = hashlib.sha256()
    for ai, acc in enumerate(js.get("accessors", [])):
        if "bufferView" in acc:
            h.update(np.ascontiguousarray(accessor_array_idx(js, buf, ai)).tobytes())
        else:
            h.update(("NOVIEW:%d;" % ai).encode())
        sp = acc.get("sparse")
        if sp:
            n = sp["count"]
            itype = sp["indices"].get("type", "SCALAR")
            for part in ("indices", "values"):
                bvi = sp[part]["bufferView"]
                bv = js["bufferViews"][bvi]
                boff = bv.get("byteOffset", 0) + sp[part].get("byteOffset", 0)
                if part == "indices":
                    numc = COMP_TYPE_COUNT[itype]
                    dt = np.dtype(COMP_DTYPE[sp[part]["componentType"]])
                else:
                    numc = COMP_TYPE_COUNT[acc["type"]]
                    dt = np.dtype(COMP_DTYPE[acc["componentType"]])
                h.update(bytes(buf[boff : boff + n * numc * dt.itemsize]))
    return h.hexdigest()


def json_shape_hash(js):
    red = json.loads(json.dumps(js))
    for b in red.get("buffers", []):
        b["byteLength"] = 0
    for bv in red.get("bufferViews", []):
        bv["byteOffset"] = 0
        bv["byteLength"] = 0
    return hashlib.sha256(json.dumps(red, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def do_inpaint(args):
    js, binchunk, version = load_glb(args["in"])
    buf = get_buffer_bytes(js, binchunk)
    si, _ = skin_info(js)
    if si is None or si[0] is None:
        _refuse("SKIN_NOT_FOUND", "no mpfb_skin material on the body mesh of %s" % args["in"])
    skin_mat, skin_mat_idx, tex_idx, img_idx = si
    tex = js["textures"][tex_idx]
    raw = image_raw_bytes(js, buf, img_idx)
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    W, H = im.size
    arr = np.array(im)
    fp = load_mask(args["footprint_mask"], W, H)
    if args.get("footprint_glb"):
        fjs, fbin, _fv = load_glb(args["footprint_glb"])
        fbuf = get_buffer_bytes(fjs, fbin)
        _fsi, fmi = skin_info(fjs, fbuf)
        _fidx, fmesh = fmi
        ftris, _nhp, _hp = hidden_uv_tris(fjs, fbuf, fmesh)
        fp_glb = rasterize(ftris, W, H)
        if fp_glb.shape != fp.shape or bool((fp_glb != fp).any()):
            _refuse(
                "FOOTPRINT_MISMATCH_GLB",
                "mask differs from --footprint-glb rasterization (%d texels differ)"
                % int((fp_glb != fp).sum()),
            )
    pix, labels, touched, _si = full_measure(js, buf, img_idx, arr, fp)
    filled = fill_from_own_skin(arr, fp, labels, touched)
    seam_filled = seam_stats(filled, fp, labels)
    seam_black = seam_stats(arr, fp, labels)
    png_bytes = encode_png_fixed(filled)
    out_js, out_bin = rebuild_glb(js, buf, img_idx, png_bytes)
    cv = cv2_licence()
    report = {
        "tool": TOOL_ID,
        "cv2": cv,
        "inpaint": {"method": "cv2.inpaint INPAINT_TELEA", "radius": INPAINT_RADIUS, "perIslandCrop": True},
        "skin": {
            "mat": skin_mat,
            "matIdx": skin_mat_idx,
            "texIdx": tex_idx,
            "imgIdx": img_idx,
            "name": js["images"][img_idx].get("name", ""),
            "W": W,
            "H": H,
            "mimeType": js["images"][img_idx].get("mimeType", ""),
            "sampler": tex.get("sampler"),
            "beforeRawSha256": hashlib.sha256(raw).hexdigest(),
        },
        "footprintTexels": pix["footprintTexels"],
        "footprintComponents": int(cv2.connectedComponents(fp.astype(np.uint8), connectivity=8)[0] - 1),
        "islandsTouched": touched,
        "islandCount": pix["islandCount"],
        "beforeBlackFrac": pix["footprintBlackFrac"],
        "afterBlackFrac": float((filled[fp].max(axis=1) <= 8).mean()) if fp.sum() else 0.0,
        "seamFilled": seam_filled,
        "seamShippedBlack": seam_black,
        "seamReferenceM5aFreshSplice": {"mean_r": 8.62, "mean_g": 26.38, "mean_b": 32.90},
        "variance": variance_stats(filled, fp, labels, touched),
        "offFootprintHash": measure_pixels("", filled, fp, labels, touched, W, H)["offFootprintHash"],
    }
    # Atomic write (m3): stage both outputs as temp files in their final
    # directories, then rename only after both succeed. A failing report
    # write must not leave a seemingly-successful output GLB behind.
    out_dir = os.path.dirname(os.path.abspath(args["out"])) or "."
    rep_dir = os.path.dirname(os.path.abspath(args["report"])) or "."
    fd_glb, tmp_glb = tempfile.mkstemp(prefix=".p2e-glb-", suffix=".tmp", dir=out_dir)
    fd_rep, tmp_rep = tempfile.mkstemp(prefix=".p2e-report-", suffix=".tmp", dir=rep_dir)
    try:
        with os.fdopen(fd_glb, "wb") as f:
            f.write(out_js)
            f.write(out_bin)
        with os.fdopen(fd_rep, "w") as f:
            json.dump(report, f, indent=1)
        os.replace(tmp_glb, os.path.abspath(args["out"]))
        os.replace(tmp_rep, os.path.abspath(args["report"]))
    except BaseException:
        for p in (tmp_glb, tmp_rep):
            try:
                os.unlink(p)
            except OSError:
                pass
        raise
    sys.stdout.write(json.dumps(report, indent=1) + "\n")


def rebuild_glb(js, buf, img_idx, new_png):
    js = json.loads(json.dumps(js))
    img = js["images"][img_idx]
    if "bufferView" not in img:
        raise ValueError("skin image has no bufferView; refusing to rewrite uri images")
    skin_bv = img["bufferView"]
    parts = []
    for i, bv in enumerate(js["bufferViews"]):
        boff = bv.get("byteOffset", 0)
        blen = bv["byteLength"]
        parts.append(new_png if i == skin_bv else bytes(buf[boff : boff + blen]))
    new_bin = b"".join(parts)
    off = 0
    for i, part in enumerate(parts):
        js["bufferViews"][i]["byteOffset"] = off
        js["bufferViews"][i]["byteLength"] = len(part)
        off += len(part)
    js["buffers"][0]["byteLength"] = len(new_bin)
    json_bytes = json.dumps(js, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    pad = (4 - len(new_bin) % 4) % 4
    new_bin += b"\x00" * pad
    total = 12 + 8 + len(json_bytes) + 8 + len(new_bin)
    header = struct.pack("<III", 0x46546C67, 2, total)
    return header + struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes + struct.pack(
        "<II", len(new_bin), 0x004E4942
    ) + new_bin, b""


def do_measure(args):
    from_glb = "glb" in args and args["glb"] is not None
    src = args["glb"] if from_glb else None
    js, binchunk, _v = load_glb(src)
    buf = get_buffer_bytes(js, binchunk)
    si, _ = skin_info(js)
    if si is None or si[0] is None:
        _refuse("SKIN_NOT_FOUND", "no mpfb_skin material on the body mesh of %s" % src)
    skin_mat, skin_mat_idx, tex_idx, img_idx = si
    tex = js["textures"][tex_idx]
    if from_glb and "in_png" in args and args["in_png"] is not None:
        arr = np.array(Image.open(args["in_png"]).convert("RGB"))
    else:
        raw = image_raw_bytes(js, buf, img_idx)
        arr = np.array(Image.open(io.BytesIO(raw)).convert("RGB"))
    W, H = arr.shape[1], arr.shape[0]
    fp = load_mask(args["footprint_mask"], W, H)
    pix, _labels, touched, _si = full_measure(js, buf, img_idx, arr, fp)
    cv = cv2_licence()
    imgrecs = []
    for i, imrec in enumerate(js.get("images", [])):
        try:
            r = image_raw_bytes(js, buf, i)
        except ValueError:
            r = None
        imgrecs.append(
            {
                "idx": i,
                "name": imrec.get("name", ""),
                "mimeType": imrec.get("mimeType", ""),
                "sha256": hashlib.sha256(r).hexdigest() if r is not None else None,
            }
        )
    out = {
        "tool": TOOL_ID,
        "cv2": cv,
        "glb": src,
        "skin": {
            "mat": skin_mat,
            "matIdx": skin_mat_idx,
            "texIdx": tex_idx,
            "imgIdx": img_idx,
            "name": js["images"][img_idx].get("name", ""),
            "W": W,
            "H": H,
            "mimeType": js["images"][img_idx].get("mimeType", ""),
            "sampler": tex.get("sampler"),
        },
        "images": imgrecs,
        "accessorDataHash": accessor_data_hash(js, buf),
        "jsonShapeHash": json_shape_hash(js),
    }
    out.update(pix)
    sys.stdout.write(json.dumps(out, indent=1) + "\n")


def do_inpaint_image(args):
    js, binchunk, _v = load_glb(args["glb"])
    buf = get_buffer_bytes(js, binchunk)
    si, _ = skin_info(js)
    if si is None or si[0] is None:
        _refuse("SKIN_NOT_FOUND", "no mpfb_skin material on the body mesh of %s" % args["glb"])
    _skin_mat, skin_mat_idx, _tex_idx, _img_idx = si
    arr = np.array(Image.open(args["in_png"]).convert("RGB"))
    W, H = arr.shape[1], arr.shape[0]
    fp = load_mask(args["footprint_mask"], W, H)
    found = find_body_mesh(js)
    _mi, mesh = found
    _union, labels, n_islands = compute_islands(js, buf, mesh, skin_mat_idx, W, H)
    _ncomp, touched = check_refusals(fp, labels, n_islands)
    filled = fill_from_own_skin(arr, fp, labels, touched)
    Image.fromarray(filled, "RGB").save(args["out_png"], format="PNG", optimize=False, compress_level=6)
    sys.stdout.write(json.dumps({"out": args["out_png"], "islandsTouched": touched}) + "\n")


def do_iso_probe(args):
    js, binchunk, _v = load_glb(args["glb"])
    buf = get_buffer_bytes(js, binchunk)
    si, _ = skin_info(js, buf)
    if si is None or si[0] is None:
        _refuse("SKIN_NOT_FOUND", "no mpfb_skin material on the body mesh of %s" % args["glb"])
    _skin_mat, skin_mat_idx, _tex_idx, _img_idx = si
    arr = None
    if args.get("in_png") is not None:
        arr = np.array(Image.open(args["in_png"]).convert("RGB"))
    if arr is None:
        raw = image_raw_bytes(js, buf, si[3])
        arr = np.array(Image.open(io.BytesIO(raw)).convert("RGB"))
    W, H = arr.shape[1], arr.shape[0]
    fp = load_mask(args["footprint_mask"], W, H)
    found = find_body_mesh(js)
    _mi, mesh = found
    _union, labels, n_islands = compute_islands(js, buf, mesh, skin_mat_idx, W, H)
    _ncomp, touched = check_refusals(fp, labels, n_islands)
    ref = fill_from_own_skin(arr, fp, labels, touched)
    probes = []
    for isl in sorted(touched):
        islmask = labels == isl
        pert = arr.copy()
        pert[~islmask] = 255 - pert[~islmask]
        got = fill_from_own_skin(pert, fp, labels, touched)
        same = bool((ref[islmask] == got[islmask]).all())
        probes.append(
            {
                "island": int(isl),
                "islandTexels": int(islmask.sum()),
                "islandFootprintTexels": int((fp & islmask).sum()),
                "perturbedTexels": int((~islmask).sum()),
                "identicalInsideIsland": same,
            }
        )
    # Legacy single-island fields name the largest footprint-bearing island so
    # older readers keep working; the gate asserts on `probes` (every island).
    best = max(probes, key=lambda p: p["islandFootprintTexels"])
    sys.stdout.write(
        json.dumps(
            {
                "island": best["island"],
                "islandTexels": best["islandTexels"],
                "islandFootprintTexels": best["islandFootprintTexels"],
                "perturbedTexels": best["perturbedTexels"],
                "identicalInsideIsland": best["identicalInsideIsland"],
                "islands": sorted(int(v) for v in touched),
                "probes": probes,
                "allIdentical": bool(all(p["identicalInsideIsland"] for p in probes)),
            }
        )
        + "\n"
    )


def do_derive_fixture(args):
    fjs, fbin, _fv = load_glb(args["footprint_glb"])
    fbuf = get_buffer_bytes(fjs, fbin)
    fsi, fmi = skin_info(fjs, fbuf)
    if fsi is None or fsi[0] is None:
        _refuse("SKIN_NOT_FOUND", "no mpfb_skin material in %s" % args["footprint_glb"])
    _fmat, _fmidx, _ftidx, fimgidx = fsi
    raw = image_raw_bytes(fjs, fbuf, fimgidx)
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    W, H = im.size
    _fidx, fmesh = fmi
    ftris, nhp, hp = hidden_uv_tris(fjs, fbuf, fmesh)
    fp = rasterize(ftris, W, H)
    Image.fromarray((fp.astype(np.uint8)) * 255, "L").save(args["out_mask"], format="PNG", optimize=False, compress_level=6)
    with open(args["out_mask"], "rb") as f:
        msha = hashlib.sha256(f.read()).hexdigest()
    out = {
        "tool": TOOL_ID,
        "footprintGlb": args["footprint_glb"],
        "hiddenPrims": hp,
        "hiddenPrimCount": nhp,
        "hiddenTriCount": len(ftris),
        "W": W,
        "H": H,
        "footprintTexels": int(fp.sum()),
        "maskSha256": msha,
    }
    sys.stdout.write(json.dumps(out, indent=1) + "\n")


def main(argv):
    if argv and argv[0] in ("measure", "measure-image", "inpaint-image", "derive-fixture", "iso-probe"):
        cmd = argv[0]
        rest = argv[1:]
        if cmd == "iso-probe":
            ap = argparse.ArgumentParser()
            ap.add_argument("--glb", required=True)
            ap.add_argument("--in-png", default=None)
            ap.add_argument("--footprint-mask", required=True)
            a = ap.parse_args(rest)
            do_iso_probe({"glb": a.glb, "in_png": a.in_png, "footprint_mask": a.footprint_mask})
        elif cmd == "measure":
            ap = argparse.ArgumentParser()
            ap.add_argument("--glb", required=True)
            ap.add_argument("--footprint-mask", required=True)
            a = ap.parse_args(rest)
            do_measure({"glb": a.glb, "footprint_mask": a.footprint_mask})
        elif cmd == "measure-image":
            ap = argparse.ArgumentParser()
            ap.add_argument("--glb", required=True)
            ap.add_argument("--in-png", required=True)
            ap.add_argument("--footprint-mask", required=True)
            a = ap.parse_args(rest)
            do_measure({"glb": a.glb, "in_png": a.in_png, "footprint_mask": a.footprint_mask})
        elif cmd == "inpaint-image":
            ap = argparse.ArgumentParser()
            ap.add_argument("--glb", required=True)
            ap.add_argument("--in-png", required=True)
            ap.add_argument("--footprint-mask", required=True)
            ap.add_argument("--out-png", required=True)
            a = ap.parse_args(rest)
            do_inpaint_image(
                {"glb": a.glb, "in_png": a.in_png, "footprint_mask": a.footprint_mask, "out_png": a.out_png}
            )
        elif cmd == "derive-fixture":
            ap = argparse.ArgumentParser()
            ap.add_argument("--footprint-glb", required=True)
            ap.add_argument("--out-mask", required=True)
            a = ap.parse_args(rest)
            do_derive_fixture({"footprint_glb": a.footprint_glb, "out_mask": a.out_mask})
        return
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_path", required=True)
    ap.add_argument("--out", dest="out_path", required=True)
    ap.add_argument("--footprint-mask", dest="footprint_mask", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--footprint-glb", dest="footprint_glb", default=None)
    a = ap.parse_args(argv)
    do_inpaint(
        {
            "in": a.in_path,
            "out": a.out_path,
            "footprint_mask": a.footprint_mask,
            "report": a.report,
            "footprint_glb": a.footprint_glb,
        }
    )


if __name__ == "__main__":
    main(sys.argv[1:])
