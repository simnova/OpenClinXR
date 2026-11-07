#!/usr/bin/env python3
"""groom39 STEP 1 premise probe: do shell-entering children blend guides
from more than one ear region?

Scope: +x guides of guides-36 whose resampled (32-pt, build-identical)
world path comes within 135 mm of the +x proxy outer surface. Classes by
where the path passes the mirrored earframe groom36 used
(earframe-mirror35.json; yback from the mirrored pinna box, same +x set):
  FRONT : passes anterior of the ear front plane at ear height
          (exists sample z in [ZL,ZT] with y > YF)
  OVER  : stays above the ear top across the ear's y span
          (samples with y in [YB,YF] exist and all have z > ZT)
  BEHIND: passes posterior of the pinna back plane at ear height
          (exists sample z in [ZL,ZT] with y < YB)
  NONE  : never reaches ear height (no sample z in [ZL,ZT])
  OTHER : escape with a per-guide reason (read first)
Plane expressions (metres, both sides; x mirrors, y/z identical):
  YF = -0.0462533 (earframe yPostMm = pinna yfront, anterior edge)
  YB = -0.0907587 (pinna yback, posterior edge)
  ZT =  1.5532659 (earframe zTopMm)
  ZL =  1.5082972 (earframe zLobeMm = pinna zmin)
Classes computed on +x, mirrored to -x by geometric guide pairing
(exact-mirror construction: pair deviation must be ~0). Children rooted
within 135 mm of their own-side proxy outer are MIXED iff the guides
carrying their weight (strands.npz guide_idx/guide_w rows, w > 0) span
more than one class. Shell strands via gates34.segments_in_shell on
store/hair-groom36/build-36/strands.npz.
Writes E/premise39.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

E = Path(__file__).resolve().parent
E38 = E.parent / "hair-groom38"
sys.path.insert(0, str(E.parents[2] / "openclinxr" / "hair-groom"
                      / "strands"))
sys.path.insert(0, str(E38))
import gates34 as G  # noqa: E402
import frames as F  # noqa: E402
import residual38 as R38  # noqa: E402 (shell_mask, no copy)

STORE = Path("/Volumes/files/openclinxr-assets/store")
GUIDES = STORE / "hair-groom36/guides-36.npz"
BUILD36 = STORE / "hair-groom36/build-36/strands.npz"
PROXY = STORE / "hair-groom34/ear-proxy.npz"
EARFRAME = E.parent / "hair-groom35/earframe-mirror35.json"

BAND_M = 0.135
YF = -0.0462533
YB = -0.0907587
ZT = 1.5532659
ZL = 1.5082972
P = 32


def main():
    ef = json.loads(EARFRAME.read_text())["sides"]["xpos"]
    print("earframe xpos: yPostMm=%.4f zLobeMm=%.4f zTopMm=%.4f" % (
        ef["yPostMm"], ef["zLobeMm"], ef["zTopMm"]), flush=True)
    assert abs(ef["yPostMm"] / 1000.0 - YF) < 1e-6
    assert abs(ef["zTopMm"] / 1000.0 - ZT) < 1e-6
    assert abs(ef["zLobeMm"] / 1000.0 - ZL) < 1e-6

    gdoc = np.load(str(GUIDES), allow_pickle=True)
    curves_head = np.asarray(gdoc["curves_head"], dtype=np.float64)
    crown = np.asarray(gdoc["crown"])
    n_guide = curves_head.shape[0]
    gw = F.head_to_world(curves_head, crown)
    paths = np.stack([F.resample_arc(gw[g], P) for g in range(n_guide)])
    print("guides world+resampled:", paths.shape, flush=True)
    groots = paths[:, 0, :]
    gside = np.where(groots[:, 0] >= 0, 1.0, -1.0)
    mid = np.abs(groots[:, 0]) < 0.0005
    print("guide side counts: +x=%d -x=%d mid=%d" % (
        int(((gside > 0) & ~mid).sum()), int(((gside < 0) & ~mid).sum()),
        int(mid.sum())), flush=True)

    px = np.load(str(PROXY), allow_pickle=True)
    outer = {}
    trees = {}
    for nm in ("xpos", "xneg"):
        sv = np.asarray(px[nm + "_shell_v"], dtype=np.float64)
        o = sv[:len(sv) // 2]
        outer[nm] = o
        trees[nm] = cKDTree(o)
        print(nm, "outer verts:", o.shape, "bbox x[%.1f,%.1f]mm "
              "y[%.1f,%.1f]mm z[%.1f,%.1f]mm" % (
                  o[:, 0].min() * 1000, o[:, 0].max() * 1000,
                  o[:, 1].min() * 1000, o[:, 1].max() * 1000,
                  o[:, 2].min() * 1000, o[:, 2].max() * 1000),
              flush=True)

    # scope: min distance guide-path -> same-side proxy outer
    scope = {}
    for nm, sgn in (("xpos", 1.0), ("xneg", -1.0)):
        gi = np.nonzero((np.sign(groots[:, 0]) == sgn))[0]
        d, _ = trees[nm].query(paths[gi].reshape(-1, 3))
        scope[nm] = (gi, d.reshape(len(gi), P).min(axis=1))
        print(nm, "guides in 135mm scope:",
              int((scope[nm][1] <= BAND_M).sum()), "of", len(gi),
              flush=True)

    def classify_ids(ids):
        lab = {}
        for g in ids.tolist():
            p = paths[g]
            y = p[:, 1]
            z = p[:, 2]
            eh = (z >= ZL) & (z <= ZT)
            ant = bool((eh & (y > YF)).any())
            post = bool((eh & (y < YB)).any())
            if ant and post:
                lab[g] = ("OTHER", "ear-height samples both anterior "
                          "of YF and posterior of YB (wraps ear)")
                continue
            if ant:
                lab[g] = ("FRONT", "")
                continue
            if post:
                lab[g] = ("BEHIND", "")
                continue
            in_span = (y >= YB) & (y <= YF)
            if in_span.any() and bool((z[in_span] > ZT).all()):
                lab[g] = ("OVER", "")
            elif not bool(eh.any()):
                lab[g] = ("NONE", "")
            else:
                # ear-height samples exist but all inside [YB,YF]:
                # locate vs shell bbox in x
                o = outer["xpos"]
                sx = (o[:, 0].min(), o[:, 0].max())
                xs = np.abs(p[eh & in_span][:, 0])
                if bool((xs > sx[1]).any()):
                    lab[g] = ("OTHER", "ear-height samples in-span but "
                              "lateral of shell xmax (hugs outer ear)")
                elif bool((xs < sx[0]).any()):
                    lab[g] = ("OTHER", "ear-height samples in-span but "
                              "medial of shell xmin (between ear, head)")
                else:
                    lab[g] = ("OTHER", "ear-height samples inside shell "
                              "x-range without segment hit (grazing)")
        return lab

    gpos = np.nonzero((groots[:, 0] > 0) & ~mid)[0]
    in_scope_pos = np.intersect1d(
        scope["xpos"][0][scope["xpos"][1] <= BAND_M], gpos)
    print("+x in-scope guides:", len(in_scope_pos), flush=True)
    lab_pos = classify_ids(in_scope_pos)
    classes = {}
    for k, v in lab_pos.items():
        classes[int(k)] = v

    # geometric +x -> -x pairing (exact-mirror construction)
    gneg = np.nonzero((groots[:, 0] < 0) & ~mid)[0]
    neg_paths = paths[gneg]
    pair = {}
    maxdev = 0.0
    for g in gpos.tolist():
        m = paths[g].copy()
        m[:, 0] *= -1.0
        d = np.abs(neg_paths - m[None]).max(axis=(1, 2))
        j = int(d.argmin())
        pair[g] = (int(gneg[j]), float(d[j]))
        maxdev = max(maxdev, float(d[j]))
    print("pairs: %d max pair deviation %.3g mm" % (
        len(pair), maxdev * 1000.0), flush=True)
    # transfer classes to -x; directly classify -x in-scope too
    in_scope_neg = np.intersect1d(
        scope["xneg"][0][scope["xneg"][1] <= BAND_M], gneg)
    print("-x in-scope guides:", len(in_scope_neg), flush=True)
    lab_neg_direct = classify_ids(in_scope_neg)
    rev = {pp[0]: g for g, pp in pair.items()}
    agree = sum(1 for g in in_scope_neg.tolist()
                if lab_neg_direct[g][0] == classes.get(
                    rev.get(g, -1), ("MISSING", ""))[0])
    print("-x direct-vs-transferred agreement: %d/%d" % (
        agree, len(in_scope_neg)), flush=True)
    for g in gpos.tolist():
        if g in classes:
            classes[pair[g][0]] = classes[g]
    for g in in_scope_neg.tolist():
        classes.setdefault(int(g), lab_neg_direct[g])

    # children
    D = np.load(str(BUILD36), allow_pickle=True)
    pts = np.ascontiguousarray(np.asarray(D["points"], dtype=np.float64))
    n = pts.shape[0]
    croots = np.ascontiguousarray(np.asarray(D["roots"], dtype=np.float64))
    cside = np.asarray(D["side"], dtype=np.float64)
    gi = np.asarray(D["guide_idx"], dtype=np.int64)
    gw8 = np.asarray(D["guide_w"], dtype=np.float64)
    print("children:", n, flush=True)

    out = {"bandMm": BAND_M * 1000.0,
           "planes": {
               "YF": YF, "YB": YB, "ZT": ZT, "ZL": ZL,
                "FRONT": "exists sample z in [ZL,ZT] with y > YF "
                         "(anterior of ear front plane at ear height)",
                "BEHIND": "exists sample z in [ZL,ZT] with y < YB "
                          "(posterior of pinna back plane at ear height)",
                "OVER": "no ear-height sample outside [YB,YF], and samples "
                        "with y in [YB,YF] exist and all have z > ZT "
                        "(above ear top across y span)",
               "NONE": "no sample z in [ZL,ZT] (never reaches ear height)",
               "OTHER": "escape, reason per guide"},
           "pairMaxDevMm": round(maxdev * 1000.0, 6),
           "directTransferAgree": "%d/%d" % (agree, len(in_scope_neg))}
    from collections import Counter as _C
    for nm, sgn in (("xpos", 1.0), ("xneg", -1.0)):
        sv = np.asarray(px[nm + "_shell_v"], dtype=np.float64)
        sf = np.asarray(px[nm + "_shell_f"])
        hit = R38.shell_mask(pts, sv, sf)
        hs = hit.any(axis=1)
        nseg = int(hit.sum())
        print(nm, "shell segs=%d strands=%d" % (nseg, int(hs.sum())),
              flush=True)
        sel = (cside == sgn)
        dd, _ = trees[nm].query(croots[sel])
        inband = np.zeros(n, dtype=bool)
        idx = np.nonzero(sel)[0]
        inband[idx[dd <= BAND_M]] = True
        # MIXED among in-band
        wpos = gw8 > 0
        mixed = np.zeros(n, dtype=bool)
        for i in np.nonzero(inband)[0]:
            cl = {classes.get(int(gg), ("UNCLASSIFIED", ""))[0]
                  for gg in gi[i][wpos[i]]}
            mixed[i] = len(cl) > 1
        out[nm] = {"childrenTotal": int(sel.sum()),
                   "inBandChildren": int(inband.sum()),
                   "mixedChildren": int(mixed.sum()),
                   "singleChildren": int((inband & ~mixed).sum()),
                   "shellSegs": nseg,
                   "shellStrands": int(hs.sum()),
                   "shellStrandsMixed": int((hs & mixed).sum()),
                   "shellStrandsSingle": int((hs & inband & ~mixed).sum()),
                   "shellStrandsOutOfBand": int((hs & ~inband).sum())}
    # class counts (+x scoped)
    cnt = _C(v[0] for v in classes.values())
    out["guideClasses"] = {k: int(v) for k, v in cnt.items()}
    out["otherGuides"] = {str(k): v[1] for k, v in classes.items()
                          if v[0] == "OTHER"}
    (E / "premise39.json").write_text(json.dumps(out, indent=1) + "\n")
    print("guide class counts:", dict(cnt), flush=True)
    print("OTHER guides:", len(out["otherGuides"]), flush=True)
    for k, v in out["otherGuides"].items():
        print("  OTHER guide", k, ":", v, flush=True)
    print("WROTE", E / "premise39.json", flush=True)


if __name__ == "__main__":
    main()
