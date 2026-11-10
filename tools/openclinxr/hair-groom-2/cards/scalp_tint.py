"""P2 scalp tint: strand-root density baked into the actor's skin albedo inside a runtime GLB.

    blender -b --factory-startup --python scalp_tint.py -- <in.glb> <strands.npz> <out.glb> <record.json> \
        [--sigma-mm S] [--rho-frac F] [--amax A] [--root-dark K] [--wide-sigma-mm SW --wide-amax AW]
        [--sideburn-weight WS] [--close-mm RC [--close-soft-mm SC]]

DESIGN-realism.md P2 (T6). Production card hair sits on a scalp painted toward the hair colour, so the
part and the hairline show tinted skin under the cards rather than bare skin. Here the tint comes from the
groom itself: every strand root (strands.npz positions[offsets[:-1]], Blender Z-up) is projected to the
nearest body triangle (mathutils BVHTree), splatted at its UV into a density image at the albedo's size,
blurred with a Gaussian of sigma S mm (three box passes, px/mm measured from the scalp triangles), and
mapped to coverage a = amax * (1 - exp(-D / (F * median D over root pixels))). With --wide-sigma-mm SW and
--wide-amax AW, a = max(a, the same map at sigma SW and amax AW): a soft hairline and a tinted part.
With --sideburn-weight WS < 1, roots in the groom's sideburn zone (head-local localPositions against the
ear landmarks and earHairline of the groom's stats.json: |x| >= minAbsXMm, yFront - sideburnWidthMm -
sideburnRampMm <= y < yFront, z < zTopMm) carry weight WS, and a is multiplied by the blurred local mean
weight. P2 st2 grade: the sideburn cards sweep behind the ear, so root density alone painted a solid patch
in front of it, where the target shows skin.
With --close-mm RC, a is multiplied by the root-presence mask closed (dilated, then eroded) by RC mm and
blurred by SC mm: a narrow part gap, with roots on both sides, is filled and keeps its tint, while skin
outside the edge of the root field loses it (p2a showed tint on the forehead below the part base, on the
neck below the ear and behind the ear; a density-ratio erosion removed those but also bared the part).
The albedo becomes skin * (1 - a) + hair * a in linear light, hair = alpha-weighted mean linear colour of
the hair_cards baseColorTexture x baseColorFactor x K.

Only the skin baseColorTexture image bytes change (same size, PNG); the bufferViews are repacked, every
other byte stays identical. The shipped body GLB is not read or written. Deterministic: no random draws.
claimScope: scalp/part/hairline colour under the hair in one runtime GLB.
notEvidenceFor: hair-colour retint (apply_actor_hair_colour does not touch the baked tint), geometry.
"""
from __future__ import annotations

import hashlib
import io
import json
import struct
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "asset-pipeline" / "makeclothes"))
from transplant_fitted_brow import encode_glb, parse_glb, view_bytes  # noqa: E402

BODY_MESH = "mpfb_ob_patient_aisha_v1_body"
COMP = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def accessor(doc, binary, i):
    a = doc["accessors"][i]
    v = doc["bufferViews"][a["bufferView"]]
    dt = np.dtype(COMP[a["componentType"]])
    n = NCOMP[a["type"]]
    stride = v.get("byteStride", dt.itemsize * n)
    start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    if stride == dt.itemsize * n:
        return np.frombuffer(binary, dt, a["count"] * n, start).reshape(a["count"], n)
    rows = np.frombuffer(binary, np.uint8, (a["count"] - 1) * stride + dt.itemsize * n, start)
    return np.lib.stride_tricks.as_strided(rows, (a["count"], dt.itemsize * n), (stride, 1)).copy().view(dt)


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def box(img, r, axis):
    if r < 1:
        return img
    c = np.cumsum(np.pad(img, [(r + 1, r) if ax == axis else (0, 0) for ax in range(img.ndim)]), axis=axis)
    hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
    lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
    return (hi - lo) / (2 * r + 1)


def gauss(img, sigma_px):
    # three box passes: each box variance (w^2-1)/12
    w = max(1, int(round(np.sqrt(12 * sigma_px**2 / 3 + 1))))
    r = w // 2
    for _ in range(3):
        img = box(box(img, r, 0), r, 1)
    return img


def repack(doc, binary, replace):
    out = bytearray()
    for i, v in enumerate(doc["bufferViews"]):
        data = replace.get(i, view_bytes(doc, binary, i))
        out += b"\0" * (-len(out) % 4)
        v["byteOffset"] = len(out)
        v["byteLength"] = len(data)
        out += data
    out += b"\0" * (-len(out) % 4)
    doc["buffers"][0]["byteLength"] = len(out)
    return bytes(out)


def main(argv):
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from PIL import Image

    pos_args, opts = [], {"--sigma-mm": 1.2, "--rho-frac": 0.25, "--amax": 0.9, "--root-dark": 0.8,
                         "--wide-sigma-mm": 0.0, "--wide-amax": 0.0, "--sideburn-weight": 1.0,
                         "--close-mm": 0.0, "--close-soft-mm": 0.5}
    it = iter(argv)
    for a in it:
        if a in opts:
            opts[a] = float(next(it))
        else:
            pos_args.append(a)
    src, strands_p, dst, rec_p = map(Path, pos_args)
    doc, binary, raw = parse_glb(src)

    mesh = next(m for m in doc["meshes"] if m["name"] == BODY_MESH)
    prim = mesh["primitives"][0]
    mat = doc["materials"][prim["material"]]
    P = accessor(doc, binary, prim["attributes"]["POSITION"]).astype(np.float64)
    UV = accessor(doc, binary, prim["attributes"]["TEXCOORD_0"]).astype(np.float64)
    T = accessor(doc, binary, prim["indices"]).reshape(-1, 3).astype(np.int64)
    tex_i = mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    img_i = doc["textures"][tex_i]["source"]
    img_view = doc["images"][img_i]["bufferView"]
    albedo = Image.open(io.BytesIO(view_bytes(doc, binary, img_view)))
    mode = albedo.mode
    alb = np.asarray(albedo.convert("RGB"), np.float64) / 255.0
    H, W = alb.shape[:2]

    s = np.load(strands_p)
    roots_b = s["positions"][s["offsets"][:-1]].astype(np.float64)
    roots = np.stack([roots_b[:, 0], roots_b[:, 2], -roots_b[:, 1]], 1)  # Blender Z-up -> glTF Y-up

    bvh = BVHTree.FromPolygons([Vector(p) for p in P], T.tolist(), all_triangles=True)
    def project(pts):
        uv = np.zeros((len(pts), 2))
        dd = np.zeros(len(pts))
        for k, r in enumerate(pts):
            loc, _n, fi, d = bvh.find_nearest(Vector(r))
            a, b, c = (P[j] for j in T[fi])
            l = np.array(loc)
            v0, v1, v2 = b - a, c - a, l - a
            d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1
            den = d00 * d11 - d01 * d01
            wb = (d11 * d20 - d01 * d21) / den
            wc = (d00 * d21 - d01 * d20) / den
            uv[k] = UV[T[fi, 0]] * (1 - wb - wc) + UV[T[fi, 1]] * wb + UV[T[fi, 2]] * wc
            dd[k] = d
        return uv, dd

    ruv, dist = project(roots)

    # px per mm on the scalp: triangles holding a root
    hit = set()
    for k in range(0, len(roots), 50):
        hit.add(bvh.find_nearest(Vector(roots[k]))[2])
    hit = np.array(sorted(hit))
    tri = P[T[hit]]
    area3 = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1) * 1e6
    tuv = UV[T[hit]] * [W, H]
    area2 = 0.5 * np.abs(np.cross(tuv[:, 1] - tuv[:, 0], tuv[:, 2] - tuv[:, 0]))
    px_mm = float(np.median(np.sqrt(area2 / np.maximum(area3, 1e-12))))

    px = np.clip((ruv * [W, H]).astype(np.int64), 0, [W - 1, H - 1])
    x0, y0 = px.min(0)
    x1, y1 = px.max(0)
    sig_px = opts["--sigma-mm"] * px_mm
    m = int(np.ceil(4 * max(sig_px, opts["--wide-sigma-mm"] * px_mm))) + 2
    x0, y0, x1, y1 = max(0, x0 - m), max(0, y0 - m), min(W, x1 + m + 1), min(H, y1 + m + 1)
    D = np.zeros((y1 - y0, x1 - x0))
    np.add.at(D, (px[:, 1] - y0, px[:, 0] - x0), 1.0)
    Db = gauss(D, sig_px)
    # isolated roots (projected onto a far UV island) would paint a dot: drop roots whose own blurred
    # density is under 5% of the median, then splat again
    own = Db[px[:, 1] - y0, px[:, 0] - x0]
    keep = own >= 0.05 * float(np.median(own))
    dropped = int((~keep).sum())
    D = np.zeros_like(D)
    np.add.at(D, (px[keep, 1] - y0, px[keep, 0] - x0), 1.0)
    Db = gauss(D, sig_px)
    sb_stats = None
    if opts["--sideburn-weight"] < 1:
        st = json.loads((strands_p.parent / "stats.json").read_text())
        loc = s["localPositions"][s["offsets"][:-1]].astype(np.float64) * 1000.0
        eh = st["earHairline"]
        zone = np.zeros(len(loc), bool)
        for side, e in (("L", 1.0), ("R", -1.0)):
            ea = st["earLandmarksMm"][side]
            lo = ea["yFrontMm"] - eh["sideburnWidthMm"] - eh["sideburnRampMm"]
            zone |= ((loc[:, 0] * e) >= eh["minAbsXMm"]) & (loc[:, 1] >= lo) & (loc[:, 1] < ea["yFrontMm"]) \
                & (loc[:, 2] < ea["zTopMm"])
        wts = np.where(zone, opts["--sideburn-weight"], 1.0)
        sb_stats = {"zoneRoots": int(zone.sum())}
    rho0 = opts["--rho-frac"] * float(np.median(Db[D > 0]))
    a = opts["--amax"] * (1 - np.exp(-Db / rho0))
    if opts["--wide-sigma-mm"] > 0 and opts["--wide-amax"] > 0:
        # second, broad and weaker layer: soft hairline and tinted part skin, the fine layer keeps the gap
        Dw = gauss(D, opts["--wide-sigma-mm"] * px_mm)
        aw = opts["--wide-amax"] * (1 - np.exp(-Dw / (opts["--rho-frac"] * float(np.median(Dw[D > 0])))))
        a = np.maximum(a, aw)
    if opts["--close-mm"] > 0:
        # gate to the closed root field: dilate then erode the root-presence mask by close-mm, so a narrow
        # part gap (roots on both sides) is filled and keeps its tint, while skin outside the field edge
        # (forehead below the part base, neck, behind the ear) loses it; soft edge over close-soft-mm
        O = (Db >= 0.05 * float(np.median(Db[D > 0]))).astype(np.float64)
        rc = opts["--close-mm"] * px_mm
        dil = (gauss(O, rc) > 0.1).astype(np.float64)
        clo = (gauss(dil, rc) > 0.9).astype(np.float64)
        a = a * np.clip(gauss(clo, opts["--close-soft-mm"] * px_mm), 0, 1)
    if sb_stats is not None:
        Ww = np.zeros_like(D)
        np.add.at(Ww, (px[keep, 1] - y0, px[keep, 0] - x0), wts[keep])
        sw = max(sig_px, opts["--wide-sigma-mm"] * px_mm)
        Dsw = gauss(D, sw)
        a = a * np.clip(np.where(Dsw > 1e-9, gauss(Ww, sw) / np.maximum(Dsw, 1e-9), 1.0), 0, 1)

    hmat_i = next(i for i, mm in enumerate(doc["materials"]) if mm.get("name") == "hair_cards")
    hmat = doc["materials"][hmat_i]
    hpbr = hmat["pbrMetallicRoughness"]
    himg = doc["images"][doc["textures"][hpbr["baseColorTexture"]["index"]]["source"]]
    ha = np.asarray(Image.open(io.BytesIO(view_bytes(doc, binary, himg["bufferView"]))).convert("RGBA"), np.float64) / 255
    w = ha[..., 3:]
    hair = (srgb_to_lin(ha[..., :3]) * w).reshape(-1, 3).sum(0) / w.sum()
    hair = hair * np.array(hpbr.get("baseColorFactor", [1, 1, 1, 1])[:3]) * opts["--root-dark"]

    replace = {}

    lin = srgb_to_lin(alb[y0:y1, x0:x1])
    lin = lin * (1 - a[..., None]) + hair * a[..., None]
    out = alb.copy()
    out[y0:y1, x0:x1] = lin_to_srgb(lin)
    out8 = np.round(out * 255).astype(np.uint8)
    im = Image.fromarray(out8, "RGB")
    if mode == "RGBA":
        im.putalpha(albedo.getchannel("A"))
    buf = io.BytesIO()
    im.save(buf, "PNG", compress_level=9)
    doc["images"][img_i]["mimeType"] = "image/png"
    replace[img_view] = buf.getvalue()
    new_bin = repack(doc, binary, replace)
    glb = encode_glb(doc, new_bin)
    dst.write_bytes(glb)

    Image.fromarray(np.round(a / max(opts["--amax"], 1e-9) * 255).astype(np.uint8)).save(rec_p.with_suffix(".coverage.png"))
    rec = {
        "tool": "tools/openclinxr/hair-groom-2/cards/scalp_tint.py",
        "input": str(src), "inputSha256": hashlib.sha256(raw).hexdigest(),
        "strands": str(strands_p), "strandsSha256": hashlib.sha256(strands_p.read_bytes()).hexdigest(),
        "output": str(dst), "outputSha256": hashlib.sha256(glb).hexdigest(),
        "options": {k.lstrip("-"): v for k, v in opts.items()},
        "roots": len(roots), "rootsDroppedIsolated": dropped, "sideburn": sb_stats, "rootToSkinMm": {q: float(np.percentile(dist, p) * 1000) for q, p in (("p50", 50), ("p99", 99), ("max", 100))},
        "pxPerMm": px_mm, "sigmaPx": sig_px, "rho0": rho0,
        "uvBoxPx": [int(x0), int(y0), int(x1), int(y1)],
        "hairLinear": hair.tolist(), "albedoImage": doc["images"][img_i].get("name"), "albedoPx": [W, H],
    }
    rec_p.write_text(json.dumps(rec, indent=1))
    print("SCALP_TINT", json.dumps(rec))


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
