#!/usr/bin/env python3
"""groom39 follow-up breakdown: shell strands by guide class-set.

Reuses classify39 (guide classes, now including midline guides) and
residual38.shell_mask + gates34 (no copy). Writes E/breakdown39.json:
per side children totals, in-band, MIXED/single, shell strands by
sorted class tuple, backbone-class histogram of shell strands, midline
guide usage, and the STOP-condition fractions.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

E = Path(__file__).resolve().parent
sys.path.insert(0, str(E))
sys.path.insert(0, str(E.parents[2] / "openclinxr" / "hair-groom"
                        / "strands"))
sys.path.insert(0, str(E.parent / "hair-groom38"))
import classify39 as C39  # noqa: E402
import residual38 as R38  # noqa: E402

STORE = Path("/Volumes/files/openclinxr-assets/store")
BUILD36 = STORE / "hair-groom36/build-36/strands.npz"
PROXY = STORE / "hair-groom34/ear-proxy.npz"


def main():
    classes, pair, maxdev = C39.guide_classes()
    lab = {g: v[0] for g, v in classes.items()}
    print("classified guides:", len(lab), "pairMaxDevMm=%.4g" % (
        maxdev * 1000.0), flush=True)
    print("class counts:", dict(Counter(lab.values())), flush=True)

    D = np.load(str(BUILD36), allow_pickle=True)
    pts = np.ascontiguousarray(np.asarray(D["points"], dtype=np.float64))
    n = pts.shape[0]
    croots = np.ascontiguousarray(np.asarray(D["roots"], dtype=np.float64))
    cside = np.asarray(D["side"], dtype=np.float64)
    gi = np.asarray(D["guide_idx"], dtype=np.int64)
    gw = np.asarray(D["guide_w"], dtype=np.float64)
    px = np.load(str(PROXY), allow_pickle=True)
    # per-child class-set from the child's OWN side classes (no shell mask)
    key = np.full(n, "", dtype=object)
    is_mixed = np.zeros(n, dtype=bool)
    backbone_lab = np.full(n, "", dtype=object)
    for nm, sgn in (("xpos", 1.0), ("xneg", -1.0)):
        sv = np.asarray(px[nm + "_shell_v"], dtype=np.float64)
        outer = sv[:len(sv) // 2]
        sel = (cside == sgn)
        dd, _ = cKDTree(outer).query(croots[sel])
        idx = np.nonzero(sel)[0]
        band = idx[dd <= C39.BAND_M]
        wpos = gw > 0
        for i in band.tolist():
            used = gi[i][wpos[i]]
            cl = sorted({lab.get(int(g), "UNCLASSIFIED") for g in used})
            key[i] = "+".join(cl)
            is_mixed[i] = len(cl) > 1
            bb = int(used[np.argmax(gw[i][wpos[i]])])
            backbone_lab[i] = lab.get(bb, "UNCLASSIFIED")
    out = {}
    for nm, sgn in (("xpos", 1.0), ("xneg", -1.0)):
        sv = np.asarray(px[nm + "_shell_v"], dtype=np.float64)
        sf = np.asarray(px[nm + "_shell_f"])
        hit = R38.shell_mask(pts, sv, sf)
        hs = hit.any(axis=1)
        sel = (cside == sgn)
        hss = hs  # gates34 convention: all hitters of this side's shell
        c = Counter(key[i] if key[i] else "OUT-OF-BAND"
                    for i in np.nonzero(hss)[0])
        bb = Counter(backbone_lab[i] if backbone_lab[i] else "OUT-OF-BAND"
                     for i in np.nonzero(hss)[0])
        cross = int((hss & ~sel).sum())
        inband_hit = hss & (key != "")
        out[nm] = {"childrenTotal": int(sel.sum()),
                   "inBandChildren": int((key != "")[sel].sum()),
                   "mixedChildren": int((is_mixed & sel).sum()),
                   "singleChildren": int(((key != "") & ~is_mixed
                                          & sel).sum()),
                   "shellSegs": int(hit.sum()),
                   "shellStrands": int(hss.sum()),
                   "shellCrossSide": cross,
                   "shellMixed": int((hss & is_mixed).sum()),
                   "shellSingle": int((hss & (key != "") & ~is_mixed).sum()),
                   "shellOutOfBand": int((hss & (key == "")).sum()),
                   "shellByClassSet": {k: int(v) for k, v in
                                       c.most_common()},
                   "shellBackboneClass": {k: int(v) for k, v in
                                          bb.most_common()}}
        frac = out[nm]["shellMixed"] / max(1, out[nm]["shellStrands"])
        out[nm]["mixedFracOfShell"] = round(frac, 4)
        print(nm, "shell=%d mixed=%d single=%d oob=%d frac=%.3f" % (
            out[nm]["shellStrands"], out[nm]["shellMixed"],
            out[nm]["shellSingle"], out[nm]["shellOutOfBand"], frac),
            flush=True)
    # midline-guide usage across all children
    mid_ids = [g for g in lab if g not in
               [p[0] for p in pair.values()] and g not in pair]
    use_mid = np.isin(gi, np.array(mid_ids)).any(axis=1)
    out["midlineGuides"] = {"n": len(mid_ids), "ids": sorted(mid_ids),
                            "classes": {str(g): lab[g] for g in
                                        sorted(mid_ids)},
                            "childrenUsing": int(use_mid.sum())}
    print("midline:", out["midlineGuides"]["n"], "guides,",
          out["midlineGuides"]["childrenUsing"], "children use them",
          flush=True)
    (E / "breakdown39.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE", E / "breakdown39.json", flush=True)


if __name__ == "__main__":
    main()
