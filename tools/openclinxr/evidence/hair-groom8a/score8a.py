#!/usr/bin/env python3
"""hair-groom8a STEP 3: score groom8a vs groom5 (studio rig, skull registration).

Same shell as score7 (body-occluded ID alpha>=230, aisha-v3 masks):
IoU/miss/excess per view, regional contour p50/p95, per-row-band
contour miss/excess p95 (top/mid/bottom thirds -- the two-sided gate
data), two-sided R-PROTRUDE (excess comps via rulers.protrude +
mirror miss comps via rulers.protrude(tgt, ours)), A temple boxes, B
hem boxes, C part (gapline + crossWithin40mm), D front IoU, back seam,
R-LOOP profile (rulers.loop_profile, NO wrap-zone exclusion per the
card), concha strand crossings (projective, simplified).
Reads renders-studio + build outputs. Writes E/score8a.json.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
E5 = ROOT / "tools/openclinxr/evidence/hair-groom5"
E6 = ROOT / "tools/openclinxr/evidence/hair-groom6"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
CAME = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"
PINNA = ROOT / "tools/openclinxr/evidence/hair-hull3/workspace/ear_pinna.npz"
ROOTS = ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz"
SDFP = ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz"
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
sys.path.insert(0, str(E))
from children import sdf_sampler  # noqa: E402
import rulers as R  # noqa: E402 (kept verbatim from groom7)

VIEWS = ("front", "three_quarter", "profile_90", "back")
MASKF = {"front": "mask-front.png",
         "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png",
         "back": "mask-back.png"}
IDDIR = {"groom5": E5 / "renders-studio", "groom8a": E / "renders-studio"}
SN = {"groom5": Path("/Volumes/files/src/openclinxr/.openclinxr/"
                     "asset-production/hair-groom5/strands.npz"),
      "groom8a": E / "build" / "strands.npz"}


def load_id(tag, v):
    return (np.array(Image.open(str(IDDIR[tag] / (v + "-id.png")))
            .convert("RGBA"))[:, :, 3] >= 230)


def load_mask(v):
    return np.array(Image.open(str(SCR / MASKF[v]))) > 127


def regional_pq(fitted, target):
    bf = fitted ^ ndimage.binary_erosion(fitted)
    bt = target ^ ndimage.binary_erosion(target)
    edt_t = ndimage.distance_transform_edt(~bt)
    edt_f = ndimage.distance_transform_edt(~bf)
    fr, fc = np.nonzero(bf)
    tr, tc = np.nonzero(bt)
    out_f = ~target[fr, fc] if fr.size else np.zeros(0, dtype=bool)
    out_t = ~fitted[tr, tc] if tr.size else np.zeros(0, dtype=bool)
    de = edt_t[fr, fc][out_f] if fr.size else np.zeros(0)
    dm = edt_f[tr, tc][out_t] if tr.size else np.zeros(0)
    q = lambda a, p: round(float(np.percentile(a, p)), 1) \
        if a.size else 0.0  # noqa: E731
    return {"excessN": int(out_f.sum()), "excessP50": q(de, 50),
            "excessP95": q(de, 95),
            "missN": int(out_t.sum()), "missP50": q(dm, 50),
            "missP95": q(dm, 95)}


def rowband_contour(fitted, target):
    """Per-row boundary miss/excess distances, banded by target-masked
    row thirds. miss[row] = distance from a target-boundary pixel to
    the fitted mask (0 if covered); excess[row] = mirror."""
    bt = target ^ ndimage.binary_erosion(target)
    bf = fitted ^ ndimage.binary_erosion(fitted)
    edt_f = ndimage.distance_transform_edt(~fitted)
    edt_t = ndimage.distance_transform_edt(~target)
    tr, tc = np.nonzero(bt)
    fr, fc = np.nonzero(bf)
    tmiss = edt_f[tr, tc] * (~fitted[tr, tc]).astype(np.float64)
    texc = edt_t[fr, fc] * (~target[fr, fc]).astype(np.float64)
    ys = np.nonzero(target.any(axis=1))[0]
    y0, y1 = int(ys.min()), int(ys.max())
    h = (y1 - y0 + 1) / 3.0
    out = {}
    for i, nm in enumerate(("top", "mid", "bot")):
        lo, hi = y0 + int(i * h), y0 + int((i + 1) * h)
        m = (tr >= lo) & (tr < hi)
        e = (fr >= lo) & (fr < hi)
        q = lambda a, p: round(float(np.percentile(a, p)), 1) \
            if a.size else 0.0  # noqa: E731
        out[nm] = {"missP95": q(tmiss[m], 95),
                   "missN": int((tmiss[m] > 0).sum()),
                   "excessP95": q(texc[e], 95),
                   "excessN": int((texc[e] > 0).sum())}
    return out


def boxm(r0, r1, c0, c1):
    b = np.zeros((1024, 1024), dtype=bool)
    b[max(r0, 0):min(r1, 1024), max(c0, 0):min(c1, 1024)] = True
    return b


def gapline(mask, rows, col=512, halfwin=60):
    c, w = [], []
    for r in rows:
        row = mask[r]
        lo, hi = max(col - halfwin, 0), min(col + halfwin, 1024)
        seg = row[lo:hi]
        if seg[col - lo]:
            c.append(float(col))
            w.append(0)
            continue
        l = col - lo
        while l >= 0 and not seg[l]:
            l -= 1
        rr = col - lo
        while rr < len(seg) and not seg[rr]:
            rr += 1
        c.append(float(l + 1 + lo + (rr - l - 1) / 2))
        w.append(int(rr - l - 1))
    return np.array(c), np.array(w)


def main():
    t0 = time.time()
    out = {"grooms": {}}
    for tag in ("groom5", "groom8a"):
        g = {}
        iou = {}
        for v in VIEWS:
            ours = load_id(tag, v)
            tgt = load_mask(v)
            inter = int((tgt & ours).sum())
            union = int((tgt | ours).sum())
            iou[v] = {"iou": round(inter / union, 4),
                      "missPx": int((tgt & ~ours).sum()),
                      "excessPx": int((ours & ~tgt).sum())}
            g["regional_%s" % v] = regional_pq(ours, tgt)
            g["rowband_%s" % v] = rowband_contour(ours, tgt)
            # two-sided R-PROTRUDE: excess comps + mirror miss comps
            pe = R.protrude(ours, tgt)
            pm = R.protrude(tgt, ours)
            g["protrude_%s" % v] = {
                "excess": {"nFail": pe["nFail"],
                           "top": [(c["area"], c["maxDistPx"],
                                    c["centroid"])
                                   for c in pe["top"][:4]]},
                "miss": {"nFail": pm["nFail"],
                         "top": [(c["area"], c["maxDistPx"],
                                  c["centroid"])
                                 for c in pm["top"][:4]]}}
        g["iou"] = iou
        out["grooms"][tag] = g
        print("SCORE %s iou=%s" % (
            tag, {v: iou[v]["iou"] for v in VIEWS}), flush=True)

    # ---- A temple boxes (groom6 baseline boxes) ----
    base = json.loads((E6 / "baseline.json").read_text())
    cams = json.loads(CAME.read_text())
    sensor = float(cams["sensorWidthMm"])
    PROJ = {}
    for v in ("front", "three_quarter", "profile_90", "back"):
        M = np.array(cams["views"][v]["matrixWorld"], dtype=np.float64)
        PROJ[v] = (np.linalg.inv(M),
                   float(cams["views"][v]["lensMm"]) / sensor * 1024.0)

    def project(pts, v):
        inv, f = PROJ[v]
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

    sample, _ = sdf_sampler(np.load(str(SDFP), allow_pickle=True))
    A = {}
    for tag in ("groom5", "groom8a"):
        D = np.load(str(SN[tag]), allow_pickle=True)
        pts = np.asarray(D["points"], dtype=np.float64)
        rad = np.asarray(D["radii"], dtype=np.float64)
        for key, ainfo in base["A_templeBox"].items():
            view = key.split("/")[0]
            a = np.array(Image.open(
                IDDIR[tag] / (view + "-id.png")).convert("RGBA"))[
                    :, :, 3]
            b = ainfo["box"]
            bm = boxm(b["r0"], b["r1"], b["c0"], b["c1"])
            ours = int((bm & (a >= 230)).sum())
            t = load_mask(view)
            tpx = int((bm & t).sum())
            trans = float(((a >= 30) & (a < 230) & bm).sum()
                          / max(int((bm & (a >= 30)).sum()), 1))
            tipcc, tiprr, _ = project(pts[:, -1, :], view)
            intip = (tipcc >= b["c0"]) & (tipcc < b["c1"]) \
                & (tiprr >= b["r0"]) & (tiprr < b["r1"])
            tiprad = rad[:, -1] > 1e-6
            far = 0
            if (intip & tiprad).any():
                vals, inside = sample(pts[intip & tiprad][:, -1, :])
                vals = np.where(inside, vals, 999.0)
                far = int((vals > 3.0).sum())
            A["%s/%s" % (tag, key)] = {
                "oursPx": ours, "targetPx": tpx,
                "ratioVsTarget": round(ours / max(tpx, 1), 3),
                "tipsGt3mm": far, "transFrac": round(trans, 4)}
    out["A"] = A

    # ---- B hem side boxes ----
    B = {}
    aB = np.array(Image.open(
        IDDIR["groom8a"] / "back-id.png").convert("RGBA"))[:, :, 3]
    tB = load_mask("back")
    ys, xs = np.nonzero(tB)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    W = x1 - x0
    low0 = y0 + 2 * (y1 - y0) // 3
    edge = int(round(0.15 * W))
    for nm, bm in (("left", boxm(low0, y1, x0, x0 + edge)),
                   ("right", boxm(low0, y1, x1 - edge, x1))):
        hair = bm & (aB >= 30)
        trans = float(((aB >= 30) & (aB < 230) & bm).sum()
                      / max(int(hair.sum()), 1))
        miss = float((bm & tB & ~(aB >= 230)).sum()
                     / max(int((bm & tB).sum()), 1))
        B[nm] = {"alphaLt09": round(trans, 4), "maskMiss": round(miss, 4)}
    out["B"] = B

    # ---- C part ----
    C = {}
    b8 = json.loads((E / "build" / "build.json").read_text())
    part_x = float(b8["part"]["partX"])
    for view, rows, hw in (("back", list(range(150, 420)), 60),
                           ("front", list(range(85, 150)), 30)):
        row = {}
        for tag in ("groom5", "groom8a"):
            am = load_id(tag, view)
            co, wo = gapline(am, rows, halfwin=hw)
            nz = wo > 0
            row[tag] = {"gapStdPx": round(float(co[nz].std()), 2)
                        if nz.any() else 0.0,
                        "nGapRows": int(nz.sum())}
        tm = load_mask(view)
        ct, wt = gapline(tm, rows, halfwin=hw)
        nzt = wt > 0
        row["target"] = {"gapStdPx": round(float(ct[nzt].std()), 2)
                         if nzt.any() else 0.0,
                         "nGapRows": int(nzt.sum())}
        C[view] = row
    D8 = np.load(str(SN["groom8a"]), allow_pickle=True)
    pts = np.asarray(D8["points"], dtype=np.float64)
    rad = np.asarray(D8["radii"], dtype=np.float64)
    n, P, _ = pts.shape
    parent = np.asarray(D8["parent"], dtype=np.int64)
    rxyz = np.asarray(np.load(str(ROOTS), allow_pickle=True)["xyz"],
                      dtype=np.float64)
    rside = np.where(rxyz[:, 0] >= part_x, 1.0, -1.0)[parent]
    arc = np.zeros((n, P))
    arc[:, 1:] = np.cumsum(np.linalg.norm(np.diff(pts, axis=1), axis=2),
                           axis=1)
    near = arc < 0.040
    xs = pts[:, :, 0] - part_x
    cross40 = near[:, 1:] & ((xs[:, 1:] >= 0) != (rside >= 0)[:, None])
    vis = rad[:, 1:] > 1e-6
    hit = cross40 & vis
    C["crossWithin40mm"] = {"nStrands": 0, "nSamples": int(hit.sum()),
                            "gateOk": bool(not hit.any())}
    out["C"] = C

    # ---- seam (back midline rows 156-950, max gap px) ----
    am = load_id("groom8a", "back")
    co, wo = gapline(am, list(range(156, 950)), halfwin=60)
    out["seam"] = {"maxGapPx": int(wo.max()) if wo.size else 0,
                   "p95GapPx": round(float(np.percentile(wo, 95)), 1)
                   if wo.size else 0.0}

    # ---- R-LOOP profile, NO wrap-zone exclusion (card) ----
    ptsmm = pts * 1000.0
    proj = R.load_cams()
    boxes = R.wrap_boxes_mm()
    ear_top = R.profile_ear_top_row(proj)
    z_ear = float(np.asarray(
        np.load(str(PINNA), allow_pickle=True)["xyz"],
        dtype=np.float64)[:, 2].mean() * 1000.0)
    lp = R.loop_profile(ptsmm, rad, z_ear, proj, boxes, ear_top)
    # card: no wrap-zone exclusion -> recount including wrap exिcluded
    out["loopProfile"] = {k: v for k, v in lp.items() if k != "apexPx"}
    out["loopProfile"]["note"] = \
        "rulers.loop_profile as kept; plus recount with no wrap exclusion"
    # recount without wrap exclusion: visible turn events in profile
    ev = R.turn_events(ptsmm, rad)
    inv, f = proj["profile_90"]
    n_all = 0
    for (h, a, bb, apex) in ev:
        hw = np.array([apex[0] / 1000.0, apex[1] / 1000.0,
                       apex[2] / 1000.0, 1.0])
        lc = inv @ hw
        dep = -lc[2]
        if dep <= 0:
            continue
        cc = 512.0 + (lc[0] / dep) * f
        rr = 512.0 - (lc[1] / dep) * f
        if 0 <= cc < 1024 and rr < ear_top and rad[h, a:bb + 1].max() \
                > 1e-6:
            n_all += 1
    out["loopProfile"]["countNoWrapExclusion"] = int(n_all)

    # ---- concha strand crossings (simplified projective) ----
    pdoc = np.load(str(PINNA), allow_pickle=True)
    px = np.asarray(pdoc["xyz"], dtype=np.float64)
    from scipy.spatial import ConvexHull as _CH, Delaunay as _DE, \
        cKDTree as _KT
    ccross = {}
    for v in ("front", "three_quarter", "profile_90"):
        inv, f = PROJ[v]
        tot = 0
        for _side, _key in (("xpos", "idx_earXpos"),
                            ("xneg", "idx_earXneg")):
            pv = px[np.asarray(pdoc[_key])]
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
                continue
            _, ji = tree.query(np.stack([cc2[ii], rr2[ii]], axis=1), k=1)
            cov = dep2[ii] < pdep[ji] - 0.003
            vr = (rad[:, 1:].reshape(-1) > 1e-6)[ii[cov]]
            tot += int(vr.sum())
        ccross[v] = int(tot)
    out["conchaCrossings"] = ccross

    (E / "score8a.json").write_text(json.dumps(out, indent=1) + "\n")
    print("wrote E/score8a.json in %.0fs" % (time.time() - t0))


if __name__ == "__main__":
    main()
