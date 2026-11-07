"""hair-groom34 per-side gates (NEW module; no existing behaviour touched).

Provenance: earlobe31.py (3D column + image boxes), score31.py (concha),
ear_proxy.py (symmetric inflated ear shells). Differences vs priors:
  * ear definition is the +x pinna set mirrored for -x (never the file
    idx_earXneg set);
  * gate primitive is strand SEGMENTS (31 per strand) vs the inflated
    ear shell (exact segment-triangle pierce + midpoint-in-solid);
  * image boxes are computed per (view, side) for standard AND mirrored
    scorer cameras; -x boxes are graded on mirrored-camera renders.

All lengths in metres unless noted. CLI: `python gates34.py --strands P
--proxy P --cameras C --renders-mirror D --renders D --out J` scores one
build; E drivers import the functions instead (no copy).
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
EVID = ROOT / "tools/openclinxr/evidence"
PINNA = EVID / "hair-hull4/workspace/ear_pinna.npz"
SDFP = EVID / "hair-cage1/body-exact-sdf.npz"


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def mirrored_sides():
    """Earlobe column definition from the +x pinna set, mirrored."""
    pin = np.load(str(PINNA), allow_pickle=True)
    xyz = np.asarray(pin["xyz"], dtype=np.float64)
    pv = xyz[np.asarray(pin["idx_earXpos"])]
    base = {"zmin": float(pv[:, 2].min()),
            "yfront": float(pv[:, 1].max()),
            "yback": float(pv[:, 1].min()),
            "xmin": float(np.abs(pv[:, 0]).min()),
            "xmax": float(np.abs(pv[:, 0]).max()),
            "nPinnaVerts": int(len(pv)),
            "provenance": "idx_earXpos mirrored across x=0; "
                          "idx_earXneg ignored"}
    return {"xpos": dict(base, sgn=1.0),
            "xneg": dict(base, sgn=-1.0)}


def load_proj(camfile):
    cams = json.loads(Path(camfile).read_text())
    sensor = float(cams["sensorWidthMm"])
    proj = {}
    for v, rec in cams["views"].items():
        M = np.array(rec["matrixWorld"], dtype=np.float64)
        proj[v] = (np.linalg.inv(M),
                   float(rec["lensMm"]) / sensor * 1024.0)
    return proj


def project(pts, inv, f):
    hw = np.ones((len(pts), 4))
    hw[:, :3] = np.asarray(pts, dtype=np.float64)
    lc = (inv @ hw.T).T
    dep = -lc[:, 2]
    cc = np.full(len(pts), -1.0)
    rr = np.full(len(pts), -1.0)
    ok = dep > 0
    cc[ok] = 512.0 + (lc[ok, 0] / dep[ok]) * f
    rr[ok] = 512.0 - (lc[ok, 1] / dep[ok]) * f
    return cc, rr, dep


def boxm(r0, r1, c0, c1, n=1024):
    b = np.zeros((n, n), dtype=bool)
    b[max(r0, 0):min(r1, n), max(c0, 0):min(c1, n)] = True
    return b


def image_boxes(sides, proj, views=("front", "three_quarter",
                                     "profile_90", "back")):
    """Under-lobe pixel boxes per (view, side), earlobe31 corner method."""
    out = {}
    for v in views:
        inv, f = proj[v]
        for nm, s in sides.items():
            xm = s["sgn"] * (s["xmin"] + s["xmax"]) / 2.0
            corners = np.array([
                [xm, s["yback"], s["zmin"]],
                [xm, s["yfront"], s["zmin"]],
                [xm, s["yback"], s["zmin"] - 0.025],
                [xm, s["yfront"], s["zmin"] - 0.025]])
            cc, rr, _ = project(corners, inv, f)
            out["%s/%s" % (v, nm)] = {
                "rows": [round(float(rr.min()), 1),
                         round(float(rr.max()), 1)],
                "cols": [round(float(cc.min()), 1),
                         round(float(cc.max()), 1)],
                "intRows": [int(np.floor(rr.min())), int(np.ceil(rr.max()))],
                "intCols": [int(np.floor(cc.min())), int(np.ceil(cc.max()))]}
    return out


def earlobe_columns(pts, sides):
    """3D under-lobe column counts per side (earlobe31 rule, mirrored)."""
    n, P, _ = pts.shape
    g = {}
    for nm, s in sides.items():
        sgn = s["sgn"]
        flat = pts[:, 1:, :].reshape(-1, 3)
        sm = ((flat[:, 2] < s["zmin"])
              & (flat[:, 1] >= s["yback"])
              & (flat[:, 1] <= s["yfront"])
              & ((flat[:, 0] * sgn) > 0)
              & (np.abs(flat[:, 0]) >= s["xmin"] - 0.005)
              & (np.abs(flat[:, 0]) <= s["xmax"]))
        has = sm.reshape(n, P - 1).any(axis=1)
        sm25 = sm & (flat[:, 2] >= s["zmin"] - 0.025)
        has25 = sm25.reshape(n, P - 1).any(axis=1)
        tips = pts[:, -1, :]
        tm = ((tips[:, 2] < s["zmin"])
              & (tips[:, 1] >= s["yback"])
              & (tips[:, 1] <= s["yfront"])
              & ((tips[:, 0] * sgn) > 0)
              & (np.abs(tips[:, 0]) >= s["xmin"] - 0.005)
              & (np.abs(tips[:, 0]) <= s["xmax"]))
        tm25 = tm & (tips[:, 2] >= s["zmin"] - 0.025)
        g[nm] = {"strands": int(has.sum()), "samples": int(sm.sum()),
                 "tips": int(tm.sum()), "strands25mm": int(has25.sum()),
                 "samples25mm": int(sm25.sum()),
                 "tips25mm": int(tm25.sum())}
    return g


def _mt_intersect(orig, dv, tv0, tv1, tv2):
    """Vectorized Moller-Trumbore; returns bool per segment."""
    eps = 1e-12
    e1 = tv1 - tv0
    e2 = tv2 - tv0
    p = np.cross(dv, e2)
    det = np.einsum("ij,j->i", p, e1)
    ok = np.abs(det) > eps
    inv = np.zeros_like(det)
    inv[ok] = 1.0 / det[ok]
    tvec = orig - tv0
    u = np.einsum("ij,ij->i", p, tvec) * inv
    q = np.cross(tvec, e1)
    v = np.einsum("ij,ij->i", q, dv) * inv
    t = np.einsum("ij,j->i", q, e2) * inv
    return ok & (u >= 0.0) & (u <= 1.0) & (v >= 0.0) & (u + v <= 1.0) \
        & (t >= 0.0) & (t <= 1.0)


def segments_in_shell(pts, shell_v, shell_f, chunk=40000):
    """SEGMENTS intersecting the closed shell: pierce OR midpoint-inside.

    Prefilter: segment AABB vs shell bbox (exact, vectorized). Exact:
    per-tri Moller-Trumbore on survivors; midpoint-in-solid by +X ray
    parity on survivors. Returns dict with counts + exemplar ids.
    """
    pts = np.ascontiguousarray(pts, dtype=np.float64)
    n, P, _ = pts.shape
    sv = np.ascontiguousarray(shell_v, dtype=np.float64)
    sf = np.ascontiguousarray(shell_f, dtype=np.int64)
    tris = sv[sf]  # (T,3,3)
    tmin = tris.min(axis=1)
    tmax = tris.max(axis=1)
    sbmin = sv.min(axis=0)
    sbmax = sv.max(axis=0)
    hit_seg = np.zeros((n, P - 1), dtype=bool)
    for a in range(0, n, chunk):
        sl = slice(a, min(a + chunk, n))
        p0 = pts[sl, :-1, :].reshape(-1, 3)
        p1 = pts[sl, 1:, :].reshape(-1, 3)
        m = p0.shape[0]
        smin = np.minimum(p0, p1)
        smax = np.maximum(p0, p1)
        cand = ((smax[:, 0] >= sbmin[0]) & (smin[:, 0] <= sbmax[0])
                & (smax[:, 1] >= sbmin[1]) & (smin[:, 1] <= sbmax[1])
                & (smax[:, 2] >= sbmin[2]) & (smin[:, 2] <= sbmax[2]))
        ci = np.nonzero(cand)[0]
        if not len(ci):
            continue
        q0, q1 = p0[ci], p1[ci]
        dv = q1 - q0
        pierced = np.zeros(len(ci), dtype=bool)
        for t in range(len(tris)):
            if pierced.all():
                break
            if not ((tmax[t] >= smin[ci].min(axis=0)).all()
                    and (tmin[t] <= smax[ci].max(axis=0)).all()):
                continue
            hit = _mt_intersect(q0, dv, tris[t, 0], tris[t, 1], tris[t, 2])
            pierced |= hit
        # midpoint-in-solid (+X parity) for the rest
        rest = np.nonzero(~pierced)[0]
        if len(rest):
            mid = (q0[rest] + q1[rest]) / 2.0
            dd = np.zeros(len(rest), dtype=np.int32)
            dvx = np.zeros_like(mid)
            dvx[:, 0] = 1.0
            for t in range(len(tris)):
                hit = _mt_intersect(mid, dvx, tris[t, 0], tris[t, 1],
                                    tris[t, 2])
                dd += hit.astype(np.int32)
            pierced[rest] |= (dd % 2) == 1
        full = np.zeros(m, dtype=bool)
        full[ci] = pierced
        hit_seg[sl] = full.reshape(min(chunk, n - a), P - 1)
    nseg = int(hit_seg.sum())
    has = hit_seg.any(axis=1)
    return {"nSegments": nseg, "nStrands": int(has.sum()),
            "exStrands": [int(i) for i in np.nonzero(has)[0][:10]]}


def concha34(pts, rad, proj, pin_xyz):
    """Concha crossings per (view, side) with the SYMMETRIC definition.

    pin_xyz: +x pinna verts; -x hull = mirrored. score31 projective
    method (2D hull, depth in front of pinna - 3mm, visible radii).
    """
    from scipy.spatial import ConvexHull as _CH, Delaunay as _DE, \
        cKDTree as _KT
    out = {}
    for v in ("front", "three_quarter", "profile_90"):
        inv, f = proj[v]
        for nm, sgn in (("xpos", 1.0), ("xneg", -1.0)):
            pv = pin_xyz.copy()
            pv[:, 0] *= sgn
            hw = np.ones((pv.shape[0], 4))
            hw[:, :3] = pv
            lc = (inv @ hw.T).T
            dep = -lc[:, 2]
            ok = dep > 0
            cc = 512.0 + (lc[ok, 0] / dep[ok]) * f
            rr = 512.0 - (lc[ok, 1] / dep[ok]) * f
            inm = (cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
            p2 = np.stack([cc[inm], rr[inm]], axis=1)
            pdep = dep[ok][inm]
            if len(p2) < 3:
                out["%s/%s" % (v, nm)] = 0
                continue
            tri = _DE(p2[_CH(p2).vertices])
            tree = _KT(p2)
            flat = pts[:, 1:, :].reshape(-1, 3)
            hw2 = np.ones((len(flat), 4))
            hw2[:, :3] = flat
            lc2 = (inv @ hw2.T).T
            dep2 = -lc2[:, 2]
            cc2 = np.full(len(flat), -1.0)
            rr2 = np.full(len(flat), -1.0)
            ok2 = dep2 > 0
            cc2[ok2] = 512.0 + (lc2[ok2, 0] / dep2[ok2]) * f
            rr2[ok2] = 512.0 - (lc2[ok2, 1] / dep2[ok2]) * f
            inm2 = (cc2 >= 0) & (cc2 < 1024) & (rr2 >= 0) & (rr2 < 1024)
            simp = tri.find_simplex(
                np.stack([cc2[inm2], rr2[inm2]], axis=1)) >= 0
            ii = np.nonzero(inm2)[0][simp]
            if not len(ii):
                out["%s/%s" % (v, nm)] = 0
                continue
            _, ji = tree.query(np.stack([cc2[ii], rr2[ii]], axis=1), k=1)
            cov = dep2[ii] < pdep[ji] - 0.003
            vr = (rad[:, 1:].reshape(-1) > 1e-6)[ii[cov]]
            out["%s/%s" % (v, nm)] = int(vr.sum())
    return out


def segments_gt30(pts):
    L = np.linalg.norm(np.diff(pts, axis=1), axis=2)
    gt = L > 0.030
    d = np.diff(pts, axis=1)
    hz = np.abs(d[:, :, 2]) < 0.3 * np.linalg.norm(d, axis=2)
    return {"nGt30mm": int(gt.sum()),
            "nNearHorizontal": int((gt & hz).sum()),
            "maxMm": round(float(L.max() * 1000.0), 2)}


def inside_body(pts):
    import sys as _sys
    _sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
    from children import sdf_sampler
    sample, _ = sdf_sampler(np.load(str(SDFP), allow_pickle=True))
    vals, ins = sample(pts[:, 1:, :].reshape(-1, 3))
    return {"nSge1Inside": int((ins & (vals < 0.0)).sum())}


def mirror_iou(idneg, idpos):
    a = (np.array(Image.open(str(idneg)).convert("RGBA"))[:, :, 3]
         >= 230)
    b = (np.array(Image.open(str(idpos)).convert("RGBA"))[:, :, 3]
         >= 230)
    f = np.fliplr(a)
    inter = int((f & b).sum())
    union = int((f | b).sum())
    return {"iou": round(inter / union, 4) if union else 0.0,
            "interPx": inter, "unionPx": union,
            "note": "flipped -x ID vs +x ID (no target on -x)"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strands", required=True)
    ap.add_argument("--proxy", required=True)
    ap.add_argument("--cameras", required=True)
    ap.add_argument("--renders", default="")
    ap.add_argument("--renders-mirror", default="")
    ap.add_argument("--cameras-mirror", default="")
    ap.add_argument("--out", required=True)
    ap.add_argument("--tag", default="build")
    args = ap.parse_args()

    D = np.load(args.strands, allow_pickle=True)
    pts = np.asarray(D["points"], dtype=np.float64)
    rad = np.asarray(D["radii"], dtype=np.float64)
    P = np.load(args.proxy, allow_pickle=True)
    pin = np.load(str(PINNA), allow_pickle=True)
    pin_xyz = np.asarray(pin["xyz"], dtype=np.float64)[
        np.asarray(pin["idx_earXpos"])]

    sides = mirrored_sides()
    out = {"tag": args.tag, "strands": str(args.strands),
           "strandsSha256": sha256(args.strands)[:16],
           "sidesM": sides, "perSide": {}}
    for nm in ("xpos", "xneg"):
        sv = np.asarray(P[nm + "_shell_v"], dtype=np.float64)
        sf = np.asarray(P[nm + "_shell_f"], dtype=np.int64)
        shell = segments_in_shell(pts, sv, sf)
        col = earlobe_columns(pts, sides)
        out["perSide"][nm] = {"shell": shell, "column": col[nm]}
    out["concha34"] = concha34(pts, rad, load_proj(args.cameras), pin_xyz)
    out["segmentsGt30"] = segments_gt30(pts)
    out["insideBody"] = inside_body(pts)
    boxes = image_boxes(sides, load_proj(args.cameras))
    out["boxesStd"] = boxes
    if args.renders:
        rd = Path(args.renders)
        img = {}
        for key, b in boxes.items():
            v = key.split("/")[0]
            aid = (np.array(Image.open(str(rd / (v + "-id.png")))
                            .convert("RGBA"))[:, :, 3] >= 230)
            r0, r1 = max(b["intRows"][0], 0), min(b["intRows"][1], 1024)
            c0, c1 = max(b["intCols"][0], 0), min(b["intCols"][1], 1024)
            img[key] = {"box": [r0, r1, c0, c1],
                        "hairIDpx": int(aid[r0:r1, c0:c1].sum())}
        out["imgStd"] = img
    if args.renders_mirror and args.cameras_mirror:
        boxesm = image_boxes(sides, load_proj(args.cameras_mirror),
                             views=("three_quarter", "profile_90"))
        out["boxesMirror"] = boxesm
        rdm = Path(args.renders_mirror)
        imgm = {}
        for key, b in boxesm.items():
            v = key.split("/")[0]
            aid = (np.array(Image.open(str(rdm / (v + "-id.png")))
                            .convert("RGBA"))[:, :, 3] >= 230)
            r0, r1 = max(b["intRows"][0], 0), min(b["intRows"][1], 1024)
            c0, c1 = max(b["intCols"][0], 0), min(b["intCols"][1], 1024)
            imgm[key] = {"box": [r0, r1, c0, c1],
                         "hairIDpx": int(aid[r0:r1, c0:c1].sum())}
        out["imgMirror"] = imgm
        # -x IoU: flipped mirrored-render ID vs standard +x ID
        mir = {}
        if args.renders:
            for v in ("three_quarter", "profile_90"):
                pn = Path(args.renders_mirror) / (v + "-id.png")
                pp = Path(args.renders) / (v + "-id.png")
                if pn.exists() and pp.exists():
                    mir[v] = mirror_iou(pn, pp)
        out["mirrorIou"] = mir
    Path(args.out).write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps({k: v for k, v in out.items()
                      if k not in ("sidesM", "boxesStd")}, indent=1)[:3000])


if __name__ == "__main__":
    main()
