#!/usr/bin/env python3
"""hair-groom24: score groom24 (guides-21+flags) vs groom19f (guides-19+flags) (studio rig, skull registration).

Same shell as score8a (body-occluded ID alpha>=230, aisha-v3 masks):
IoU/miss/excess, regional, rowband, two-sided R-PROTRUDE, A temple
boxes + tips>3mm, B hem boxes, C part (gap rows + median width +
crossWithin40mm), seam full + below-part, R-LOOP profile (no wrap
exclusion) + back equivalent, concha crossings, R-GROOVE v2 3q,
back strand-deviation runs, lobe boxes, depth bands.
Reads renders-studio + build outputs. Writes E/score19.json.
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
REF = sys.argv[sys.argv.index("--ref") + 1] if "--ref" in sys.argv else "ctrl"
TEST = sys.argv[sys.argv.index("--test") + 1] if "--test" in sys.argv else "opt"
E19 = ROOT / "tools/openclinxr/evidence/hair-groom19"
E25 = ROOT / "tools/openclinxr/evidence/hair-groom25"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
SCR2 = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/set-back")
CAME = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"
PINNA = ROOT / "tools/openclinxr/evidence/hair-hull3/workspace/ear_pinna.npz"
ROOTS = ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz"
SDFP = ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz"
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
sys.path.insert(0, str(E))
sys.path.insert(0, str(E19))  # rulers19.py lives in groom19 (read-only)
from children import sdf_sampler  # noqa: E402
import rulers19 as R  # noqa: E402 (E-local verbatim copy of groom16 rulers)

VIEWS = ("front", "three_quarter", "profile_90", "back")
MASKF = {"front": "mask-front.png",
         "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png",
         "back": "mask-back.png"}
STORE25 = Path("/Volumes/files/openclinxr-assets/store/hair-groom25")
STORE26 = Path("/Volumes/files/openclinxr-assets/store/hair-groom26")
STORE27 = Path("/Volumes/files/openclinxr-assets/store/hair-groom27")
STORE30 = Path("/Volumes/files/openclinxr-assets/store/hair-groom30")
E26 = E.parent / "hair-groom26"
_RENDERS = {"ctrl": E25 / "renders-ctrl",
            "26": E26 / "renders-26",
            "27": E / "renders-27",
            "30": E / "renders-30"}
_STRANDS = {"ctrl": STORE25 / "strands-ctrl.npz",
            "26": STORE26 / "strands-26.npz",
            "27": STORE27 / "strands-27.npz",
            "30": STORE30 / "strands-30.npz"}
IDDIR = {REF: _RENDERS[REF], TEST: _RENDERS[TEST]}
STORE = STORE27
SN = {REF: _STRANDS[REF], TEST: _STRANDS[TEST]}
TGTB = {"front": "target-front-a1.png",
        "three_quarter": "target-three_quarter-a1.png",
        "profile_90": "target-profile.png",
        "back": "target-back.png"}


def load_id(tag, v):
    return (np.array(Image.open(str(IDDIR[tag] / (v + "-id.png")))
            .convert("RGBA"))[:, :, 3] >= 230)


def load_mask(v):
    return np.array(Image.open(str(SCR / MASKF[v]))) > 127


def _colour_means(out, IDDIR):
    """Mean hair RGB (front beauty, id alpha>=230) groom24 vs groom19f."""
    means = {}
    for tag in (REF, TEST):
        rgb = np.array(Image.open(
            str(IDDIR[tag] / "front.png")).convert("RGB"),
            dtype=np.float64)
        a = np.array(Image.open(
            str(IDDIR[tag] / "front-id.png")).convert("RGBA"))[:, :, 3]
        sel = a >= 230
        means[tag] = [round(float(rgb[:, :, i][sel].mean()), 2)
                      for i in range(3)]
    ratio = [round(means[TEST][i] / max(means[REF][i], 1e-9), 3)
             for i in range(3)]
    return {TEST: means[TEST], REF: means[REF],
            "ratio": ratio}


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
    for tag in (REF, TEST):
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

    base = json.loads(
        (ROOT / "tools/openclinxr/evidence/hair-groom6"
         "/baseline.json").read_text())
    cams = json.loads(CAME.read_text())
    sensor = float(cams["sensorWidthMm"])
    PROJ = {}
    for v in VIEWS:
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
    # ---- A temple boxes ----
    A = {}
    D8 = {}
    for tag in (REF, TEST):
        D = np.load(str(SN[tag]), allow_pickle=True)
        D8[tag] = D
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

    # ---- B hem side boxes (groom8b) ----
    B = {}
    tB = load_mask("back")
    ys, xs = np.nonzero(tB)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    W = x1 - x0
    low0 = y0 + 2 * (y1 - y0) // 3
    edge = int(round(0.15 * W))
    for tag in (REF, TEST):
        aB = np.array(Image.open(
            IDDIR[tag] / "back-id.png").convert("RGBA"))[:, :, 3]
        Bh = {}
        for nm, bm in (("left", boxm(low0, y1, x0, x0 + edge)),
                       ("right", boxm(low0, y1, x1 - edge, x1))):
            hair = bm & (aB >= 30)
            trans = float(((aB >= 30) & (aB < 230) & bm).sum()
                          / max(int(hair.sum()), 1))
            miss = float((bm & tB & ~(aB >= 230)).sum()
                          / max(int((bm & tB).sum()), 1))
            Bh[nm] = {"alphaLt09": round(trans, 4),
                      "maskMiss": round(miss, 4)}
        B[tag] = Bh
    out["B"] = B

    # ---- C part ----
    Cc = {}
    # Blender lane: exact roots, no assignment map, no build.json.
    # part_x = crown x (~0); crossing measured vs each child's own root.
    part_x = 0.0
    for view, rows, hw in (("back", list(range(150, 420)), 60),
                           ("front", list(range(85, 150)), 30)):
        row = {}
        for tag in (REF, TEST):
            am = load_id(tag, view)
            co, wo = gapline(am, rows, halfwin=hw)
            nz = wo > 0
            row[tag] = {"gapStdPx": round(float(co[nz].std()), 2)
                        if nz.any() else 0.0,
                        "nGapRows": int(nz.sum()),
                        "gapMedianWidthPx": round(float(np.median(wo[nz])), 1)
                        if nz.any() else 0.0}
        tm = load_mask(view)
        ct, wt = gapline(tm, rows, halfwin=hw)
        nzt = wt > 0
        row["target"] = {"gapStdPx": round(float(ct[nzt].std()), 2)
                         if nzt.any() else 0.0,
                         "nGapRows": int(nzt.sum()),
                         "gapMedianWidthPx": round(float(np.median(wt[nzt])), 1)
                         if nzt.any() else 0.0}
        Cc[view] = row
    PP = {}
    for tag in (REF, TEST):
        pts = np.asarray(D8[tag]["points"], dtype=np.float64)
        rad = np.asarray(D8[tag]["radii"], dtype=np.float64)
        PP[tag] = (pts, rad)
        n, P, _ = pts.shape
        rside = np.where(pts[:, 0, 0] >= part_x, 1.0, -1.0)
        arc = np.zeros((n, P))
        arc[:, 1:] = np.cumsum(np.linalg.norm(np.diff(pts, axis=1), axis=2),
                                axis=1)
        near = arc < 0.040
        xs = pts[:, :, 0] - part_x
        cross40 = near[:, 1:] & ((xs[:, 1:] >= 0) != (rside >= 0)[:, None])
        vis = rad[:, 1:] > 1e-6
        hit = cross40 & vis
        rx = pts[:, 0, 0] - part_x
        tx = pts[:, -1, 0] - part_x
        Cc["crossWithin40mm_" + tag] = {
            "nSamples": int(hit.sum()),
            "tipAcross": int((((rx >= 0) != (tx >= 0))).sum()),
            "note": "own-root side reference (exact roots, no assignment)"}
    out["C"] = Cc
    # ---- seam (back midline rows 156-950 full + below-part 210+) ----
    seam = {}
    for tag in (REF, TEST):
        amb = load_id(tag, "back")
        co, wo = gapline(amb, list(range(156, 950)), halfwin=60)
        co2, wo2 = gapline(amb, list(range(210, 950)), halfwin=60)
        seam[tag] = {
            "maxGapPx": int(wo.max()) if wo.size else 0,
            "p95GapPx": round(float(np.percentile(wo, 95)), 1)
            if wo.size else 0.0,
            "belowPartMaxGapPx": int(wo2.max()) if wo2.size else 0,
            "belowPartP95GapPx": round(
                float(np.percentile(wo2, 95)), 1)
            if wo2.size else 0.0,
            "belowPartGapRows": int((wo2 > 0).sum())}
    out["seam"] = seam

    # ---- R-LOOP profile + back equivalent (no exclusions), per tag ----
    proj = R.load_cams()
    boxes = R.wrap_boxes_mm()
    ear_top = R.profile_ear_top_row(proj)
    z_ear = float(np.asarray(
        np.load(str(PINNA), allow_pickle=True)["xyz"],
        dtype=np.float64)[:, 2].mean() * 1000.0)
    loopProfile = {}
    loopBack = {}
    for tag in (REF, TEST):
        pts, rad = PP[tag]
        ptsmm = pts * 1000.0
        lp = R.loop_profile(ptsmm, rad, z_ear, proj, boxes, ear_top)
        loopProfile[tag] = {k: v for k, v in lp.items() if k != "apexPx"}
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
            if 0 <= cc < 1024 and rr < ear_top \
                    and rad[h, a:bb + 1].max() > 1e-6:
                n_all += 1
        loopProfile[tag]["countNoWrapExclusion"] = int(n_all)
        invB, fB = proj["back"]
        n_back = 0
        for (h, a, bb, apex) in ev:
            hw = np.array([apex[0] / 1000.0, apex[1] / 1000.0,
                           apex[2] / 1000.0, 1.0])
            lc = invB @ hw
            dep = -lc[2]
            if dep <= 0:
                continue
            cc = 512.0 + (lc[0] / dep) * fB
            rr = 512.0 - (lc[1] / dep) * fB
            if 0 <= cc < 1024 and 0 <= rr < 1024 \
                    and rad[h, a:bb + 1].max() > 1e-6:
                n_back += 1
        loopBack[tag] = {"countNoExclusion": int(n_back),
                         "nEvents": int(len(ev))}
    out["loopProfile"] = loopProfile
    out["loopBack"] = loopBack

    # ---- concha strand crossings (same simplified projective) ----
    pdoc = np.load(str(PINNA), allow_pickle=True)
    px = np.asarray(pdoc["xyz"], dtype=np.float64)
    from scipy.spatial import ConvexHull as _CH, Delaunay as _DE, \
        cKDTree as _KT
    concha = {}
    _ccproj = {}
    for v in ("front", "three_quarter", "profile_90"):
        _ccproj[v] = PROJ[v]
    for tag in (REF, TEST):
        pts, rad = PP[tag]
        ccross = {}
        for v in ("front", "three_quarter", "profile_90"):
            inv, f = _ccproj[v]
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
        concha[tag] = ccross
    out["conchaCrossings"] = concha
    # ---- R-GROOVE v2 3q (beauty + mask; ref = target R) ----
    b3 = np.array(Image.open(str(IDDIR[TEST] / "three_quarter.png"))
                  .convert("RGB"), dtype=np.float64)
    m3 = load_mask("three_quarter")
    tb3 = np.array(Image.open(str(SCR2 / "target-three_quarter-a1.png"))
                   .convert("RGB"), dtype=np.float64) \
        if (SCR2 / "target-three_quarter-a1.png").exists() else None
    if tb3 is None:
        tb3 = np.array(Image.open(str(SCR / TGTB["three_quarter"]))
                       .convert("RGB"), dtype=np.float64)
    ref_R = float(R.band_energies(tb3, load_mask("three_quarter"))["R"])
    out["groove3q"] = {"targetR": round(ref_R, 4),
                       TEST: R.groove_v2(b3, m3, ref_R)}
    b3a = np.array(Image.open(str(IDDIR[REF] / "three_quarter.png"))
                   .convert("RGB"), dtype=np.float64)
    out["groove3q"][REF] = R.groove_v2(b3a, m3, ref_R)

    # ---- lobe boxes (below-lobe anterior fringe must read 0) ----
    lobe = {}
    for tag in (REF, TEST):
        aL = np.array(Image.open(
            IDDIR[tag] / "three_quarter-id.png").convert("RGBA"))[
                :, :, 3]
        aP = np.array(Image.open(
            IDDIR[tag] / "profile_90-id.png").convert("RGBA"))[
                :, :, 3]
        tot = 0
        detail = {}
        for _lv, _aL in (("three_quarter", aL), ("profile_90", aP)):
            _invL, _fL = PROJ[_lv]
            for _lk in ("idx_earXpos", "idx_earXneg"):
                _pvL = np.asarray(pdoc["xyz"], dtype=np.float64)[
                    np.asarray(pdoc[_lk])]
                _phL = np.ones((_pvL.shape[0], 4))
                _phL[:, :3] = _pvL
                _plcL = (_invL @ _phL.T).T
                _pdepL = -_plcL[:, 2]
                _pokL = _pdepL > 0
                _pccL = 512.0 + (_plcL[_pokL, 0] / _pdepL[_pokL]) * _fL
                _prrL = 512.0 - (_plcL[_pokL, 1] / _pdepL[_pokL]) * _fL
                _pmL = (_pccL >= 0) & (_pccL < 1024) & (_prrL >= 0) \
                    & (_prrL < 1024)
                if not _pmL.any():
                    continue
                _med = float(np.median(_pccL[_pmL]))
                _bot = float(_prrL[_pmL].max())
                _sgnL = 1.0 if 512.0 >= _med else -1.0
                _loL = min(_med + _sgnL * 2.0, _med + _sgnL * 45.0)
                _hiL = max(_med + _sgnL * 2.0, _med + _sgnL * 45.0)
                _bm = boxm(int(_bot - 10), int(_bot + 30),
                           int(_loL), int(_hiL))
                _n = int((_bm & (_aL >= 230)).sum())
                tot += _n
                detail["%s/%s" % (_lv, _lk)] = _n
        lobe[tag] = {"hairIdPx": int(tot), "boxes": detail}
    out["lobeBoxes"] = lobe

    # ---- back strand-deviation runs (>25 deg over >40 px) ----
    tb = np.array(Image.open(str(SCR / TGTB["back"])).convert(
        "L"), dtype=np.float64)
    gx = ndimage.sobel(tb, axis=1)
    gy = ndimage.sobel(tb, axis=0)
    gxx = ndimage.gaussian_filter(gx * gx, 6)
    gyy = ndimage.gaussian_filter(gy * gy, 6)
    gxy = ndimage.gaussian_filter(gx * gy, 6)
    t_ang = 0.5 * np.arctan2(2 * gxy, gxx - gyy) + np.pi / 2
    t_mag = np.sqrt((gxx - gyy) ** 2 + 4 * gxy ** 2)
    tmask = load_mask("back")
    mag_med = float(np.median(t_mag[tmask]))
    devres = {}
    for tag in (REF, TEST):
        pp = np.asarray(D8[tag]["points"], dtype=np.float64)
        rr_ = np.asarray(D8[tag]["radii"], dtype=np.float64)
        inv, f = PROJ["back"]
        flat = pp.reshape(-1, 3)
        hw = np.ones((len(flat), 4))
        hw[:, :3] = flat
        lc = (inv @ hw.T).T
        dep = -lc[:, 2]
        cc = np.full(len(flat), -1.0)
        rrw = np.full(len(flat), -1.0)
        ok = dep > 0
        cc[ok] = 512.0 + (lc[ok, 0] / dep[ok]) * f
        rrw[ok] = 512.0 - (lc[ok, 1] / dep[ok]) * f
        cc = cc.reshape(len(pp), -1)
        rrw = rrw.reshape(len(pp), -1)
        nbad = 0
        badex = []
        step = 4096
        for a in range(0, len(pp), step):
            sl = slice(a, min(a + step, len(pp)))
            d = np.diff(np.stack([cc[sl], rrw[sl]], axis=2), axis=1)
            L = np.linalg.norm(d, axis=2)
            ga = np.arctan2(d[:, :, 1], d[:, :, 0])
            ci = np.clip(np.round(cc[sl][:, :-1]).astype(int), 0, 1023)
            ri = np.clip(np.round(rrw[sl][:, :-1]).astype(int), 0, 1023)
            ta = t_ang[ri, ci]
            tm = t_mag[ri, ci]
            okm = (tm > mag_med) & tmask[ri, ci]
            dd = np.abs((ga - ta + np.pi / 2) % np.pi - np.pi / 2)
            bad = (dd > np.radians(25)) & okm \
                & (rr_[sl][:, :-1] > 1e-6)
            _nchl = sl.stop - sl.start
            runlen = np.zeros(_nchl)
            cur = np.zeros(_nchl)
            for s in range(bad.shape[1]):
                cur = np.where(bad[:, s], cur + L[:, s], 0.0)
                runlen = np.maximum(runlen, cur)
            over = np.nonzero(runlen > 40.0)[0]
            nbad += int(len(over))
            badex += (over[:5] + a).tolist()
            del d, L, ga, ci, ri, ta, tm
        devres[tag] = {"nStrandsDevGt25Over40px": int(nbad),
                       "exIds": badex[:10]}
    out["backDeviation"] = devres

    # ---- depth bands (same shell-arc definition as depth8a) ----
    depth = {}
    for tag in (REF, TEST):
        pp = np.asarray(D8[tag]["points"], dtype=np.float64)
        seg = np.linalg.norm(np.diff(pp, axis=1), axis=2)
        arc = np.concatenate([np.zeros((len(pp), 1)),
                              np.cumsum(seg, axis=1)], axis=1)
        shell = (arc >= 0.010) & (arc <= 0.080)
        flatp = pp[:, 1:, :].reshape(-1, 3)
        vals, inside = sample(flatp)
        vals = np.where(inside, vals, np.nan)
        bandm = {"parietal": (np.abs(pp[:, 0, 0] * 1000.0) >= 50.0)
                 & (np.abs(pp[:, 0, 0] * 1000.0) < 85.0),
                 "temple": (np.abs(pp[:, 0, 0] * 1000.0) >= 35.0)
                 & (np.abs(pp[:, 0, 0] * 1000.0) < 85.0)
                 & (pp[:, 0, 1] * 1000.0 >= -135.0)
                 & (pp[:, 0, 1] * 1000.0 < -40.0),
                 "crown": pp[:, 0, 2] >= 1.60,
                 "back": pp[:, 0, 1] > 0.0342}
        dd = {}
        for bn, bm in bandm.items():
            sel = (shell[:, 1:] & bm[:, None]).reshape(-1)
            v = vals.reshape(-1)[sel]
            v = v[np.isfinite(v)]
            dd[bn] = {"n": int(v.size),
                      "p50": round(float(np.percentile(v, 50)), 2)
                      if v.size else 0.0,
                      "p90": round(float(np.percentile(v, 90)), 2)
                      if v.size else 0.0,
                      "std": round(float(v.std()), 2) if v.size else 0.0}
        depth[tag] = dd
    out["depth"] = depth

    # ---- back mid/hem core alpha<0.9 (sheer-sheet regression gate) ----
    core = {}
    for tag in (REF, TEST):
        aC = np.array(Image.open(
            IDDIR[tag] / "back-id.png").convert("RGBA"))[:, :, 3]
        ys, xs = np.nonzero(tB)
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        W = x1 - x0
        mid0 = y0 + (y1 - y0) // 3
        corebox = boxm(mid0, y1, x0 + int(0.15 * W), x1 - int(0.15 * W))
        hair = corebox & tB
        sheer = float(((aC < 230) & hair).sum() / max(int(hair.sum()), 1))
        core[tag] = {"alphaLt09Frac": round(sheer, 4),
                     "corePx": int(hair.sum())}
    out["backCore"] = core

    # ---- target lobe boxes (is gate-0 feasible?) ----
    tlobe = {}
    for _lv in ("three_quarter", "profile_90"):
        tL = load_mask(_lv)
        _invL, _fL = PROJ[_lv]
        for _lk in ("idx_earXpos", "idx_earXneg"):
            _pvL = np.asarray(pdoc["xyz"], dtype=np.float64)[
                np.asarray(pdoc[_lk])]
            _phL = np.ones((_pvL.shape[0], 4))
            _phL[:, :3] = _pvL
            _plcL = (_invL @ _phL.T).T
            _pdepL = -_plcL[:, 2]
            _pokL = _pdepL > 0
            _pccL = 512.0 + (_plcL[_pokL, 0] / _pdepL[_pokL]) * _fL
            _prrL = 512.0 - (_plcL[_pokL, 1] / _pdepL[_pokL]) * _fL
            _pmL = (_pccL >= 0) & (_pccL < 1024) & (_prrL >= 0) \
                & (_prrL < 1024)
            if not _pmL.any():
                continue
            _med = float(np.median(_pccL[_pmL]))
            _bot = float(_prrL[_pmL].max())
            _sgnL = 1.0 if 512.0 >= _med else -1.0
            _loL = min(_med + _sgnL * 2.0, _med + _sgnL * 45.0)
            _hiL = max(_med + _sgnL * 2.0, _med + _sgnL * 45.0)
            _bm = boxm(int(_bot - 10), int(_bot + 30),
                       int(_loL), int(_hiL))
            tlobe["target/%s/%s" % (_lv, _lk)] = int((_bm & tL).sum())
    out["lobeBoxes"]["targetMaskPx"] = tlobe

    # ---- groom19: seam REDEFINITION. The <=4 px seam gate contradicts
    # any part restoration literally (the target's own part is a wider
    # gap). Redefined: no bare gap wider than the TARGET's own part
    # outside the part rows. part_rows = back rows where the target
    # itself gapes; ours must not exceed the target's own part-max
    # anywhere else.
    _srows = list(range(156, 950))
    _tm = load_mask("back")
    _ct, _wt = gapline(_tm, _srows, halfwin=60)
    _co9, _wo9 = gapline(load_id(TEST, "back"), _srows, halfwin=60)
    _prows = _wt > 0
    _tpart_max = int(_wt[_prows].max()) if _prows.any() else 0
    _out9 = int(_wo9[~_prows].max()) if (~_prows).any() else 0
    _out8 = None
    _amb8 = load_id(REF, "back")
    _co8, _wo8 = gapline(_amb8, _srows, halfwin=60)
    _out8 = int(_wo8[~_prows].max()) if (~_prows).any() else 0
    out["seamRedefined"] = {
        "targetPartRows": int(_prows.sum()),
        "targetPartMaxGapPx": _tpart_max,
        "groom19OutsideMaxGapPx": _out9,
        "groom19fOutsideMaxGapPx": _out8,
        "note": "gate: groom19OutsideMax <= targetPartMax"}

    # ---- groom19: hairline band luminance contrast, front + 3q.
    # DEFINITION: band = top 3%-20% of the target hair-mask bbox height
    # x full mask width; contrast = p95-p5 of beauty grayscale inside
    # the band (hair dark vs skin bright: the band straddles the
    # hairline edge). Gate: ours/target within 1.5x either way.
    def hairline_contrast(view, tgt_path, tag):
        tmask = load_mask(view)
        ys, xs = np.nonzero(tmask)
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        H = y1 - y0
        band = boxm(int(y0 + 0.03 * H), int(y0 + 0.20 * H), x0, x1)
        tb = np.array(Image.open(str(tgt_path)).convert(
            "L"), dtype=np.float64)
        ob = np.array(Image.open(str(
            IDDIR[tag] / (view + ".png"))).convert(
                "L"), dtype=np.float64)
        tc = float(np.percentile(tb[band], 95)
                   - np.percentile(tb[band], 5))
        oc = float(np.percentile(ob[band], 95)
                   - np.percentile(ob[band], 5))
        return {"box": [int(y0 + 0.03 * H), int(y0 + 0.20 * H), x0, x1],
                "targetContrast": round(tc, 2),
                "oursContrast": round(oc, 2),
                "ratio": round(oc / max(tc, 1e-9), 3)}
    _t3 = (SCR2 / "target-three_quarter-a1.png")
    if not _t3.exists():
        _t3 = SCR / TGTB["three_quarter"]
    hl = {}
    for tag in (REF, TEST):
        hl[tag] = {
            "front": hairline_contrast("front", SCR / TGTB["front"], tag),
            "three_quarter": hairline_contrast("three_quarter", _t3, tag)}
    out["hairlineContrast"] = hl

    # ---- groom19: back knot/hole native-resolution read (quantitative
    # proxies for the visual read: swirl box rows 150-420 cols 512-765
    # = the falsifier region's projection). bare = ID alpha < 30 inside
    # the box-clipped target hair; hole = largest bare connected
    # component NOT touching the box border (fully enclosed bald spot).
    knot = {}
    for tag in (REF, TEST):
        _aB = np.array(Image.open(
            IDDIR[tag] / "back-id.png").convert("RGBA"))[:, :, 3]
        _kbox = boxm(150, 420, 512, 765)
        _khair = _kbox & _tm
        _bare = _kbox & (_aB < 30) & (_tm > 0)
        _lab, _nlab = ndimage.label(_bare)
        _border = set(np.unique(np.concatenate(
            [_lab[150, 512:765], _lab[419, 512:765],
             _lab[150:420, 512], _lab[150:420, 764]])))
        _hole = 0
        for _li in range(1, _nlab + 1):
            if _li not in _border:
                _hole = max(_hole, int((_lab == _li).sum()))
        knot[tag] = {
            "box": [150, 420, 512, 765],
            "boxTargetHairPx": int(_khair.sum()),
            "barePx": int((_bare & (_tm > 0)).sum()),
            "bareFracOfBoxHair": round(float(
                (_bare & (_tm > 0)).sum()
                / max(int(_khair.sum()), 1)), 4),
            "enclosedHolePx": int(_hole)}
    knot["note"] = ("gate: enclosedHolePx == 0 (no hole in the back crop)")
    out["knotRead"] = knot

    # ---- groom19 NEW sections: insideBody / pinna / face /
    # sideburn / hairline-band coverage / counts ----
    sdfdoc = np.load(str(SDFP), allow_pickle=True)
    from children import sdf_sampler as _sdf_sampler
    _sample, _ = _sdf_sampler(sdfdoc)
    inside = {}
    pinna = {}
    _pdoc = np.load(str(PINNA), allow_pickle=True)
    _pinna_m = np.vstack([
        np.asarray(_pdoc["xyz"], dtype=np.float64)[
            np.asarray(_pdoc["idx_earXpos"])],
        np.asarray(_pdoc["xyz"], dtype=np.float64)[
            np.asarray(_pdoc["idx_earXneg"])]])
    from scipy.spatial import cKDTree as _KDT
    _ptree = _KDT(_pinna_m)
    for tag in (REF, TEST):
        pts, rad = PP[tag]
        _vals, _ins = _sample(pts[:, 1:, :].reshape(-1, 3))
        inside[tag] = {"nSge1Inside": int((_ins & (_vals < 0.0)).sum())}
        _flat = pts[:, 1:, :].reshape(-1, 3)
        _pd, _ = _ptree.query(_flat, k=1)
        _vis = (rad[:, 1:].reshape(-1) > 1e-6)
        pinna[tag] = {"nVisibleLt3mm": int((_pd[_vis] < 0.003).sum()),
                      "clearMm": 3.0}
    out["insideBody"] = inside
    out["pinnaProx"] = pinna

    # face mask (gates9 shell, per tag)
    from scipy import ndimage as _ndi
    from PIL import Image as _PILImage
    _ST = np.load(str(E19 / "station-frame.npz"), allow_pickle=True)
    face = {}
    for tag in (REF, TEST):
        _fr = {}
        for _v in ("front", "three_quarter"):
            if _v == "front":
                _tb = SCR / "target-front-a1.png"
            else:
                _tb = SCR2 / "target-three_quarter-a1.png"
                if not _tb.exists():
                    _tb = SCR / "target-three_quarter-a1.png"
            _timg = np.array(
                _PILImage.open(str(_tb)).convert("RGB"), dtype=np.float64)
            _R, _G, _B = _timg[:, :, 0], _timg[:, :, 1], _timg[:, :, 2]
            _skin = (_R > 120.0) & ((_R - _G) > 15.0) \
                & ((_R - _G) < 70.0) & (_G > _B)
            _brow = float(np.asarray(
                _ST["%s/brow_row" % _v]).ravel()[0])
            _men = float(np.asarray(
                _ST["%s/menton_row" % _v]).ravel()[0])
            _fc = float(np.asarray(
                _ST["%s/face_centre_col" % _v]).ravel()[0])
            _frr = float(np.asarray(
                _ST["%s/face_centre_row" % _v]).ravel()[0])
            _bandm = np.zeros((1024, 1024), dtype=bool)
            _bandm[max(int(_brow), 0):min(int(_men) + 15, 1024), :] = True
            _cand = _skin & _bandm
            _lab, _nl = _ndi.label(_cand)
            _seed = _lab[min(int(_frr), 1023), min(int(_fc), 1023)]
            _face = (_lab == _seed) & (_seed > 0)
            _face = _ndi.binary_dilation(_face, iterations=2)
            _tmask = np.array(_PILImage.open(str(
                SCR / ("mask-front.png" if _v == "front"
                        else "mask-three_quarter.png"))).convert("L")) > 127
            _tgt_n = int((_face & _tmask).sum())
            _id = np.array(_PILImage.open(str(
                IDDIR[tag] / (_v + "-id.png"))).convert("RGBA"))[
                    :, :, 3] >= 230
            _ours_n = int((_face & _id).sum())
            _allow = _tgt_n + 0.02 * int(_face.sum())
            _fr[_v] = {"maskPx": int(_face.sum()),
                       "targetHairPx": _tgt_n, "oursHairPx": _ours_n,
                       "allowPx": round(_allow, 1),
                       "pass": bool(_ours_n <= _allow)}
        face[tag] = _fr
    out["faceMask"] = face

    # sideburn box (groom10diag [r0,r1,c0,c1] on three_quarter)
    _sb = boxm(330, 380, 610, 660)
    _st = load_mask("three_quarter")
    _stpx = int((_sb & _st).sum())
    sideburn = {}
    for tag in (REF, TEST):
        _a = (np.array(Image.open(
            str(IDDIR[tag] / "three_quarter-id.png")).convert("RGBA"))[
                :, :, 3] >= 230)
        _opx = int((_sb & _a).sum())
        sideburn[tag] = {"oursPx": _opx, "targetPx": _stpx,
                         "ratio": round(_opx / max(_stpx, 1), 3)}
    out["sideburn"] = sideburn

    # hairline-band coverage (front + 3q): band = top 3-20% of target
    # mask bbox; coverage = ours/target ID px; enclosed bare holes =
    # largest connected (target & ~ours) component touching NEITHER
    # the mask border NOR... (border-touching allowed: silhouette edge)
    band = {}
    for _v in ("front", "three_quarter"):
        _tm = load_mask(_v)
        _ys, _xs = np.nonzero(_tm)
        _y0, _y1 = int(_ys.min()), int(_ys.max()) + 1
        _x0, _x1 = int(_xs.min()), int(_xs.max()) + 1
        _H = _y1 - _y0
        _bb = boxm(int(_y0 + 0.03 * _H), int(_y0 + 0.20 * _H), _x0, _x1)
        _tp = int((_bb & _tm).sum())
        _bd = {"targetPx": _tp, "box": [int(_y0 + 0.03 * _H),
                                        int(_y0 + 0.20 * _H), _x0, _x1]}
        for tag in (REF, TEST):
            _a = (np.array(Image.open(
                str(IDDIR[tag] / (_v + "-id.png"))).convert("RGBA"))[
                    :, :, 3] >= 230)
            _op = int((_bb & _a).sum())
            _bare = _tm & ~_a
            _lab, _nl = _ndi.label(_bare)
            _bys, _bxs = np.nonzero(_tm)
            _edge = set(np.unique(np.concatenate(
                [_lab[_bys.min(), :], _lab[_bys.max(), :],
                 _lab[:, _bxs.min()], _lab[:, _bxs.max()]])))
            _hole = 0
            for _li in range(1, _nl + 1):
                if _li not in _edge:
                    _hole = max(_hole, int((_lab == _li).sum()))
            _bd[tag] = {"oursPx": _op,
                        "coverage": round(_op / max(_tp, 1), 3),
                        "enclosedBareMaxPx": int(_hole)}
        band[_v] = _bd
    out["hairlineBand"] = band

    # counts / radii / suppressed
    counts = {}
    for tag in (REF, TEST):
        pts, rad = PP[tag]
        counts[tag] = {
            "n": int(pts.shape[0]), "pointsPer": int(pts.shape[1]),
            "radiusMin": float(rad.min()), "radiusMax": float(rad.max()),
            "zeroSuppressed": int((rad.max(axis=1) <= 0).sum())}
    out["counts"] = counts

    # ---- hair-groom19: bangs (groom17 geometric metric: child samples
    # forward of the forehead plane inside the face box, world-space) ----
    _fb = np.load(str(E19 / "station-frame.npz"), allow_pickle=True)
    _brow = np.asarray(_fb["point3d/brow"], dtype=np.float64).ravel()
    _men = np.asarray(_fb["point3d/menton"], dtype=np.float64).ravel()
    _cro = np.asarray(_fb["point3d/crown"], dtype=np.float64).ravel()
    _fpy = float(_brow[1])
    _zlo = float(min(_men[2], _brow[2]))
    _zhi = float(_cro[2])
    bangs = {}
    for tag in (REF, TEST):
        _pp, _rr = PP[tag]
        _fl = _pp.reshape(-1, 3)
        _bm = ((_fl[:, 1] < _fpy) & (np.abs(_fl[:, 0]) <= 0.080)
               & (_fl[:, 2] >= _zlo) & (_fl[:, 2] <= _zhi))
        bangs[tag] = int(_bm.sum())
    out["bangsSamples"] = bangs


    # ---- hair-groom24 gate table (brief gates; honest PASS/FAIL).
    # Brief HARD gates (both builds): front IoU within +-0.01 of 0.7913
    # (groom19); 3q >= 0.83; profile >= 0.81; back >= 0.80; concha 0/0/0;
    # insideBody 0; face-mask front pass; determinism (in gates24.json).
    # Everything else is report-only.
    G24 = {}
    for _tag in (REF, TEST):
        _iou = out["grooms"][_tag]["iou"]
        _fmf = out["faceMask"][_tag]["front"]
        _ib = out["insideBody"][_tag]["nSge1Inside"]
        _cc = out["conchaCrossings"][_tag]
        _fi = _iou["front"]["iou"]
        _t = {}
        _t["frontIoU"] = {
            "v": _fi, "ref": 0.7913,
            "delta": round(_fi - 0.7913, 4),
            "gate": "within +-0.01 of groom19 0.7913",
            "pass": bool(abs(_fi - 0.7913) <= 0.01)}
        _t["q3IoU"] = {
            "v": _iou["three_quarter"]["iou"], "gate": ">= 0.83",
            "pass": bool(_iou["three_quarter"]["iou"] >= 0.83)}
        _t["profileIoU"] = {
            "v": _iou["profile_90"]["iou"], "gate": ">= 0.81",
            "pass": bool(_iou["profile_90"]["iou"] >= 0.81)}
        _t["backIoU"] = {
            "v": _iou["back"]["iou"], "gate": ">= 0.80",
            "pass": bool(_iou["back"]["iou"] >= 0.80)}
        _t["concha"] = {
            "v": _cc, "gate": "0 all views",
            "pass": bool(all(v == 0 for v in _cc.values()))}
        _t["insideBody"] = {
            "v": _ib, "gate": "== 0", "pass": bool(_ib == 0)}
        _t["faceMaskFront"] = {
            "v": _fmf,
            "gate": "ours<=target+2%mask, front view",
            "pass": bool(_fmf["pass"])}
        _t["faceMask3q_report"] = {
            "v": out["faceMask"][_tag]["three_quarter"],
            "gate": "report only (groom19 3q FAILs this)",
            "pass": True}
        _t["knotHole_report"] = {
            "v": out["knotRead"][_tag]["enclosedHolePx"],
            "bareFrac": out["knotRead"][_tag]["bareFracOfBoxHair"],
            "gate": "report only (groom19 == 0)",
            "pass": True}
        _t["rloop_report"] = {
            "profile": out["loopProfile"][_tag].get(
                "countNoWrapExclusion"),
            "back": out["loopBack"][_tag].get("countNoExclusion"),
            "gate": "report only (groom19 85k/96k vs <11587)",
            "pass": True}
        _t["hard"] = {
            "pass": bool(_t["frontIoU"]["pass"]
                         and _t["q3IoU"]["pass"]
                         and _t["profileIoU"]["pass"]
                         and _t["backIoU"]["pass"]
                         and _t["concha"]["pass"]
                         and _t["insideBody"]["pass"]
                         and _t["faceMaskFront"]["pass"])}
        G24[_tag] = _t
    _col = _colour_means(out, IDDIR)
    G24["colourNoRegress_report"] = {
        "v": _col, "gate": "mean RGB within 0.7..1.3x groom19f",
        "pass": bool(all(0.7 <= _col["ratio"][i] <= 1.3 for i in range(3)))}
    _dp = out["depth"][TEST]
    _gd_path = E19 / "guide-depth.json"
    _gd = (json.loads(_gd_path.read_text())["bands"]
           if _gd_path.exists() else None)
    if _gd:
        _dd = {}
        for _bn in ("parietal", "temple"):
            for _st in ("p50", "p90"):
                _r = _dp[_bn][_st] / max(_gd[_bn][_st], 1e-9)
                _dd["%s_%s" % (_bn, _st)] = {
                    "child": _dp[_bn][_st], "guide": _gd[_bn][_st],
                    "ratio": round(_r, 3),
                    "pass": bool(0.8 <= _r <= 1.2)}
        G24["depth_report"] = {
            "v": _dd, "gate": "report only (groom19 p50s FAIL, p90s pass)",
            "pass": True}
    G24["pass"] = "see gates26.json (needs determinism rebuild)"
    out["gates26"] = G24

    (E / ("score30-" + TEST + ".json")).write_text(json.dumps(out, indent=1) + "\n")
    print("wrote E/score30-" + TEST + ".json in %.0fs" % (time.time() - t0))
    print("GATES24 " + json.dumps(
        {k: (v["pass"] if isinstance(v, dict) and "pass" in v else v)
         for k, v in G24.items()}, indent=1))


if __name__ == "__main__":
    main()
