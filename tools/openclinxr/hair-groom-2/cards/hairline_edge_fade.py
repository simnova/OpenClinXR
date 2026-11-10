"""P2 hairline edge fade: soften the outer side edge of the cards that form the hairline, in a runtime GLB.

    blender -b --factory-startup --python-use-system-env --python hairline_edge_fade.py -- \
        <in.glb> <strands.npz> <out.glb> <record.json> [--frac U] [--len-mm L] [--edge-sigma-mm SE] [--edge-ratio RE]

With a centre part the hair sweeps sideways from the part, so the front hairline is the side edge of the
frontmost cards, not their root ends (P2 st9-st12: an alpha ramp over the first 6-20 mm from the root left
the hairline falloff at 6 px). Per card (connected component of the hair_cards primitive):
- near-root vertices: within L mm of the card's root midpoint;
- each u-half of those vertices is projected to the skin (BVHTree) and reads the strand-root density blurred
  by SE mm, over its median over root pixels;
- the half with the lower ratio is the outer side; if its ratio < RE the card is a hairline card with weight
  clip((RE - ratio) / .3, 0, 1);
- in its atlas cell, alpha over the outer U fraction of the cell width is multiplied by
  1 - weight * (1 - smoothstep(distance from the outer edge / (U x width))), along the rows within L mm of
  the root, then back to full alpha over the next L mm.
Only the hair atlas image bytes change; bufferViews are repacked. Deterministic.
claimScope: hairline outline softness in one runtime GLB. notEvidenceFor: wisps, flyaways, geometry.
"""
from __future__ import annotations

import hashlib
import io
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from scalp_tint import BODY_MESH, accessor, encode_glb, gauss, parse_glb, repack, view_bytes  # noqa: E402


def main(argv):
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from PIL import Image

    pos, opts = [], {"--frac": 0.35, "--len-mm": 40.0, "--edge-sigma-mm": 4.0, "--edge-ratio": 0.75}
    it = iter(argv)
    for a in it:
        if a in opts:
            opts[a] = float(next(it))
        else:
            pos.append(a)
    src, strands_p, dst, rec_p = map(Path, pos)
    doc, binary, raw = parse_glb(src)

    prim = next(m for m in doc["meshes"] if m["name"] == BODY_MESH)["primitives"][0]
    P = accessor(doc, binary, prim["attributes"]["POSITION"]).astype(np.float64)
    UV = accessor(doc, binary, prim["attributes"]["TEXCOORD_0"]).astype(np.float64)
    T = accessor(doc, binary, prim["indices"]).reshape(-1, 3).astype(np.int64)
    tex = doc["materials"][prim["material"]]["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    from PIL import Image as _I
    W, H = _I.open(io.BytesIO(view_bytes(doc, binary, doc["images"][doc["textures"][tex]["source"]]["bufferView"]))).size
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

    s = np.load(strands_p)
    rb = s["positions"][s["offsets"][:-1]].astype(np.float64)
    ruv, _ = project(np.stack([rb[:, 0], rb[:, 2], -rb[:, 1]], 1))
    px = np.clip((ruv * [W, H]).astype(np.int64), 0, [W - 1, H - 1])
    D = np.zeros((H, W))
    np.add.at(D, (px[:, 1], px[:, 0]), 1.0)
    # px/mm from the body triangles under the roots
    hit = np.unique([bvh.find_nearest(Vector((r[0], r[2], -r[1])))[2] for r in rb[::50]])
    tri = P[T[hit]]
    a3 = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1) * 1e6
    tuv = UV[T[hit]] * [W, H]
    e1, e2 = tuv[:, 1] - tuv[:, 0], tuv[:, 2] - tuv[:, 0]
    a2 = 0.5 * np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])
    px_mm = float(np.median(np.sqrt(a2 / np.maximum(a3, 1e-12))))
    x0, y0 = px.min(0) - 64
    x1, y1 = px.max(0) + 64
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
    De = np.zeros((H, W))
    De[y0:y1, x0:x1] = gauss(D[y0:y1, x0:x1], opts["--edge-sigma-mm"] * px_mm)
    med = float(np.median(De[D > 0]))

    hmat_i = next(i for i, mm in enumerate(doc["materials"]) if mm.get("name") == "hair_cards")
    himg = doc["images"][doc["textures"][doc["materials"][hmat_i]["pbrMetallicRoughness"]["baseColorTexture"]["index"]]["source"]]
    hprim = next(pp for m_ in doc["meshes"] for pp in m_["primitives"] if pp.get("material") == hmat_i)
    HP = accessor(doc, binary, hprim["attributes"]["POSITION"]).astype(np.float64)
    HUV = accessor(doc, binary, hprim["attributes"]["TEXCOORD_0"]).astype(np.float64)
    HT = accessor(doc, binary, hprim["indices"]).reshape(-1, 3).astype(np.int64)
    par = np.arange(len(HP))

    def find(x):
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x
    for t0, t1, t2 in HT:
        for u_, v_ in ((t0, t1), (t1, t2)):
            ru, rv = find(u_), find(v_)
            if ru != rv:
                par[ru] = rv
    comp = np.array([find(i) for i in range(len(HP))])
    huv_b, hd = project(HP)
    hpx = np.clip((huv_b * [W, H]).astype(np.int64), 0, [W - 1, H - 1])
    hratio = De[hpx[:, 1], hpx[:, 0]] / med

    A = np.asarray(Image.open(io.BytesIO(view_bytes(doc, binary, himg["bufferView"]))).convert("RGBA")).copy()
    ah, aw = A.shape[:2]
    alpha = A[..., 3].astype(np.float64)
    order = np.argsort(comp, kind="stable")
    bounds = np.r_[0, np.nonzero(np.diff(comp[order]))[0] + 1, len(order)]
    L = opts["--len-mm"]
    faded = []
    for k in range(len(bounds) - 1):
        ids = order[bounds[k]:bounds[k + 1]]
        if len(ids) < 6:
            continue
        r = ids[np.argsort(hd[ids])[:2]]
        rm = HP[r].mean(0)
        dist = np.linalg.norm(HP[ids] - rm, axis=1) * 1000.0
        near = ids[dist <= L]
        if len(near) < 4:
            continue
        u_lo, u_hi = HUV[ids, 0].min(), HUV[ids, 0].max()
        um = 0.5 * (u_lo + u_hi)
        lo_side, hi_side = near[HUV[near, 0] < um], near[HUV[near, 0] >= um]
        if not len(lo_side) or not len(hi_side):
            continue
        rl, rh = float(hratio[lo_side].mean()), float(hratio[hi_side].mean())
        outer_lo = rl < rh
        ratio = min(rl, rh)
        wgt = float(np.clip((opts["--edge-ratio"] - ratio) / 0.3, 0, 1))
        if wgt <= 0:
            continue
        # v per mm along the card from the root midpoint, by least squares over the card's vertices
        v_root = HUV[r, 1].mean()
        dv = HUV[ids, 1] - v_root
        vmm = float(np.sum(dv * dist) / max(np.sum(dist * dist), 1e-9))
        if abs(vmm) < 1e-9:
            continue
        c0, c1 = int(np.floor(u_lo * aw)), int(np.ceil(u_hi * aw))
        v_end = v_root + vmm * 2 * L
        r0, r1 = int(np.floor(min(v_root, v_end) * ah)), int(np.ceil(max(v_root, v_end) * ah))
        r0, r1, c0, c1 = max(r0, 0), min(r1, ah), max(c0, 0), min(c1, aw)
        if r1 <= r0 or c1 <= c0:
            continue
        cols = (np.arange(c0, c1) + 0.5) / aw
        du = (cols - u_lo) if outer_lo else (u_hi - cols)
        tu = np.clip(du / (opts["--frac"] * (u_hi - u_lo)), 0, 1)
        su = tu * tu * (3 - 2 * tu)
        rows = (np.arange(r0, r1) + 0.5) / ah
        mm = np.abs(rows - v_root) / abs(vmm)
        tv = np.clip((mm - L) / L, 0, 1)
        gv = 1 - tv * tv * (3 - 2 * tv)
        alpha[r0:r1, c0:c1] *= 1 - wgt * gv[:, None] * (1 - su)[None, :]
        faded.append(round(wgt, 3))
    A[..., 3] = np.round(alpha).astype(np.uint8)
    hb = io.BytesIO()
    Image.fromarray(A).save(hb, "PNG", compress_level=9)
    himg["mimeType"] = "image/png"
    glb = encode_glb(doc, repack(doc, binary, {himg["bufferView"]: hb.getvalue()}))
    dst.write_bytes(glb)
    rec = {"tool": "tools/openclinxr/hair-groom-2/cards/hairline_edge_fade.py", "input": str(src),
           "inputSha256": hashlib.sha256(raw).hexdigest(), "output": str(dst),
           "outputSha256": hashlib.sha256(glb).hexdigest(), "options": {k.lstrip("-"): v for k, v in opts.items()},
           "cards": len(bounds) - 1, "faded": len(faded), "meanWeight": float(np.mean(faded)) if faded else 0.0,
           "pxPerMm": px_mm}
    rec_p.write_text(json.dumps(rec, indent=1))
    print("EDGE_FADE", json.dumps(rec))


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
