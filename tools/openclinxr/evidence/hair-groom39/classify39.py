#!/usr/bin/env python3
"""groom39 shared guide-region classification (import, no copy).

Planes (metres, both sides; x mirrors, y/z identical), checked in order
FRONT / BEHIND / OVER / NONE / OTHER:
  YF = -0.0462533 (earframe-mirror35 yPostMm = pinna yfront)
  YB = -0.0907587 (mirrored pinna yback, gates34.mirrored_sides)
  ZT =  1.5532659 (earframe zTopMm)
  ZL =  1.5082972 (earframe zLobeMm = pinna zmin)
guide_classes() classifies every guides-36 guide (world, resampled 32,
build-identical) and returns (classes, pair) where classes[g] =
(label, reason) and pair maps +x guide -> (-x guide, dev_m).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

E39 = Path(__file__).resolve().parent
sys.path.insert(0, str(E39.parents[2] / "openclinxr" / "hair-groom"
                      / "strands"))
import frames as F  # noqa: E402

STORE = Path("/Volumes/files/openclinxr-assets/store")
GUIDES = STORE / "hair-groom36/guides-36.npz"
PROXY = STORE / "hair-groom34/ear-proxy.npz"
EARFRAME = E39.parent / "hair-groom35/earframe-mirror35.json"

BAND_M = 0.135
YF = -0.0462533
YB = -0.0907587
ZT = 1.5532659
ZL = 1.5082972
P = 32


def load_paths():
    gdoc = np.load(str(GUIDES), allow_pickle=True)
    curves_head = np.asarray(gdoc["curves_head"], dtype=np.float64)
    crown = np.asarray(gdoc["crown"])
    gw = F.head_to_world(curves_head, crown)
    return np.stack([F.resample_arc(gw[g], P) for g in range(gw.shape[0])])


def classify_ids(paths, ids, shell_xmax, shell_xmin):
    lab = {}
    for g in ids.tolist():
        p = paths[g]
        y = p[:, 1]
        z = p[:, 2]
        eh = (z >= ZL) & (z <= ZT)
        ant = bool((eh & (y > YF)).any())
        post = bool((eh & (y < YB)).any())
        if ant and post:
            lab[g] = ("OTHER", "ear-height samples both anterior of YF "
                      "and posterior of YB (wraps ear)")
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
            xs = np.abs(p[eh & in_span][:, 0])
            if bool((xs > shell_xmax).any()):
                lab[g] = ("OTHER", "ear-height samples in-span but "
                          "lateral of shell xmax (hugs outer ear)")
            elif bool((xs < shell_xmin).any()):
                lab[g] = ("OTHER", "ear-height samples in-span but "
                          "medial of shell xmin (between ear, head)")
            else:
                lab[g] = ("OTHER", "ear-height samples inside shell "
                          "x-range without segment hit (grazing)")
    return lab


def guide_classes():
    paths = load_paths()
    groots = paths[:, 0, :]
    mid = np.abs(groots[:, 0]) < 0.0005
    gpos = np.nonzero((groots[:, 0] > 0) & ~mid)[0]
    gneg = np.nonzero((groots[:, 0] < 0) & ~mid)[0]
    gmid = np.nonzero(mid)[0]
    px = np.load(str(PROXY), allow_pickle=True)
    trees = {}
    outers = {}
    for nm in ("xpos", "xneg"):
        sv = np.asarray(px[nm + "_shell_v"], dtype=np.float64)
        o = np.ascontiguousarray(sv[:len(sv) // 2])
        outers[nm] = o
        trees[nm] = cKDTree(o)
    o = outers["xpos"]
    classes = {}
    for ids, nm in ((gpos, "xpos"), (gneg, "xneg"), (gmid, "xpos")):
        d, _ = trees[nm].query(paths[ids].reshape(-1, 3))
        scoped = ids[d.reshape(len(ids), P).min(axis=1) <= BAND_M]
        for g, v in classify_ids(paths, scoped, o[:, 0].max(),
                                 o[:, 0].min()).items():
            classes[int(g)] = v
    # geometric +x -> -x pairing
    neg_paths = paths[gneg]
    pair = {}
    maxdev = 0.0
    for g in gpos.tolist():
        m = paths[g].copy()
        m[:, 0] *= -1.0
        d = np.abs(neg_paths - m[None]).max(axis=(1, 2))
        j = int(d.argmin())
        pair[int(g)] = (int(gneg[j]), float(d[j]))
        maxdev = max(maxdev, float(d[j]))
    return classes, pair, maxdev
