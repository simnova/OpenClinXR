#!/usr/bin/env python3
"""groom36 STEP2: exact-mirror guide+root set (import mirror34? no: new
construction; reuses frames + gates34 primitives only).

Input: STEP1 routed guides (guides-36routed.npz, 2707) + mask20 roots
(roots-34mask20.npz, 13446).
Construction: keep every guide/root with root x > +MID once, keep
midline (|x| <= MID, MID = 0.5 mm) once, DROP every original -x guide/
root, append the exact world-mirror (x -> -x) of each +x entry.
Output: guides-36.npz + roots-36.npz + pool-ref-36.npz (same index
selection + mirroring applied to guides-8amirror) + mirror36.json
(stats + symmetry proof).
Provenance: deterministic (index order, no search); mirrors are exact
negations (deviation 0.0 by construction, verified below).
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
sys.path.insert(0, str(E.parents[2] / "openclinxr" / "hair-groom"
                        / "strands"))
import frames as F  # noqa: E402

MID_MM = 0.5
S36 = Path("/Volumes/files/openclinxr-assets/store/hair-groom34")
S35 = Path("/Volumes/files/openclinxr-assets/store/hair-groom35")
S36O = Path("/Volumes/files/openclinxr-assets/store/hair-groom36")


def sha16(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()[:16]


def main():
    gdoc = dict(np.load(str(S36O / "step1" / "guides-36routed.npz"),
                        allow_pickle=True))
    rdoc = dict(np.load(str(S36 / "roots-34mask20.npz"), allow_pickle=True))
    ref = dict(np.load(str(S36 / "guides-8amirror.npz"), allow_pickle=True))
    ch = np.asarray(gdoc["curves_head"], dtype=np.float64)
    crown = np.asarray(gdoc["crown"], dtype=np.float64)
    W = F.head_to_world(ch, crown)
    grx = W[:, 0, 0] * 1000.0  # root x, mm
    pos = np.nonzero(grx > MID_MM)[0]
    mid = np.nonzero(np.abs(grx) <= MID_MM)[0]
    neg = np.nonzero(grx < -MID_MM)[0]
    keep = np.concatenate([pos, mid])

    new_ch = np.concatenate([ch[keep], ch[pos].copy()], axis=0)
    new_ch[len(keep):, :, 0] *= -1.0  # exact world mirror (x = head/1000)

    out_g = dict(gdoc)
    out_g["curves_head"] = new_ch
    n_new = len(keep) + len(pos)
    for k in ("tuck", "band", "route", "status", "ok_idx"):
        a = np.asarray(gdoc[k])
        out_g[k] = np.concatenate([a[keep], a[pos]])
    out_g["ok_idx"] = np.arange(n_new, dtype=np.int64)
    out_g["spec_sha"] = np.array(["earroute36"])
    out_g["verdict"] = np.array(["EARROUTE36"])
    out_g["roots_file"] = np.array([
        "groom36 STEP2 exact mirror: +x(n=%d)+mid(n=%d) kept once, "
        "-x(n=%d) dropped, +x mirrored; STEP1-routed +x source" % (
            len(pos), len(mid), len(neg))])
    np.savez_compressed(str(S36O / "guides-36.npz"), **out_g)

    # ---- roots (same partition on xyz; normal x negated, uv u negated).
    rxyz = np.asarray(rdoc["xyz"], dtype=np.float64)
    rrx = rxyz[:, 0] * 1000.0
    rpos = np.nonzero(rrx > MID_MM)[0]
    rmid = np.nonzero(np.abs(rrx) <= MID_MM)[0]
    rneg = np.nonzero(rrx < -MID_MM)[0]
    rkeep = np.concatenate([rpos, rmid])
    out_r = dict(rdoc)
    new_xyz = np.concatenate([rxyz[rkeep], rxyz[rpos].copy()], axis=0)
    new_xyz[len(rkeep):, 0] *= -1.0
    out_r["xyz"] = new_xyz
    rn = np.asarray(rdoc["normal"], dtype=np.float64)
    new_n = np.concatenate([rn[rkeep], rn[rpos].copy()], axis=0)
    new_n[len(rkeep):, 0] *= -1.0
    new_n[len(rkeep):] /= np.linalg.norm(new_n[len(rkeep):], axis=1,
                                         keepdims=True)
    out_r["normal"] = new_n
    ruv = np.asarray(rdoc["uv"], dtype=np.float64)
    new_uv = np.concatenate([ruv[rkeep], ruv[rpos].copy()], axis=0)
    new_uv[len(rkeep):, 0] *= -1.0
    out_r["uv"] = new_uv
    for k, v in rdoc.items():
        a = np.asarray(v)
        if a.shape and a.shape[0] == len(rxyz) and k not in (
                "xyz", "normal", "uv"):
            out_r[k] = np.concatenate([a[rkeep], a[rpos]])
    np.savez_compressed(str(S36O / "roots-36.npz"), **out_r)

    # ---- pool-ref: same row selection/mirroring on guides-8amirror.
    rch = np.asarray(ref["curves_head"], dtype=np.float64)
    assert rch.shape == ch.shape, (rch.shape, ch.shape)
    new_ref = np.concatenate([rch[keep], rch[pos].copy()], axis=0)
    new_ref[len(keep):, :, 0] *= -1.0
    out_ref = dict(ref)
    out_ref["curves_head"] = new_ref
    np.savez_compressed(str(S36O / "pool-ref-36.npz"), **out_ref)

    # ---- symmetry proof: every row must have a mirror partner < 0.01 mm.
    Wn = F.head_to_world(new_ch, crown)
    nW = len(Wn)
    nP, nM = len(pos), len(mid)
    # construction proof (exact by index): mirror of kept +x block ==
    # appended -x block; midline self-mirror deviation reported.
    pmir = Wn[:nP].copy()
    pmir[:, :, 0] *= -1.0
    constr_dev = np.abs(pmir - Wn[nP + nM:]).max(axis=(1, 2)) * 1000.0
    mcur = Wn[nP:nP + nM].copy()
    mcur[:, :, 0] *= -1.0
    mid_self = np.abs(mcur - Wn[nP:nP + nM]).max(axis=(1, 2)) * 1000.0
    mir = Wn.copy()
    mir[:, :, 0] *= -1.0
    # partner search on roots (orchestrator metric) + curve deviation.
    from scipy.spatial import cKDTree
    tree = cKDTree(Wn[:, 0, :])
    dd, ii = tree.query(np.ascontiguousarray(mir[:, 0, :]))
    dev = np.abs(mir[ii] - Wn).max(axis=(1, 2)) * 1000.0
    rx = Wn[:, 0, 0] * 1000.0
    side = np.where(rx > MID_MM, "pos",
                    np.where(rx < -MID_MM, "neg", "mid"))
    stats = {"n": int(nW), "nPos": int((side == "pos").sum()),
             "nMid": int((side == "mid").sum()),
             "nNeg": int((side == "neg").sum()),
             "midIds": [int(i) for i in np.nonzero(side == "mid")[0]],
             "constructionDevMm": {
                 "posMirrorMax": round(float(constr_dev.max()), 9),
                 "posMirrorNExact": int((constr_dev < 0.01).sum()),
                 "midSelfMirrorMax": round(float(mid_self.max()), 6)},
             "pairDevMm": {"p50": round(float(np.median(dev)), 6),
                           "p90": round(float(np.percentile(dev, 90)), 6),
                           "max": round(float(dev.max()), 6)},
             "nExact001": int((dev < 0.01).sum()),
             "inexactIds": [int(i) for i in np.nonzero(dev >= 0.01)[0]],
             "inexactNote": "nearest-root metric; duplicate roots share "
                            "one site so the tree may pair a guide with "
                            "the wrong duplicate (construction pairing "
                            "above is exact for all 1366+1366)",
             "roots": {"n": int(len(new_xyz)),
                       "nPos": int((new_xyz[:, 0] * 1000.0 > MID_MM).sum()),
                       "nMid": int((np.abs(new_xyz[:, 0]) * 1000.0
                                    <= MID_MM).sum()),
                       "nNeg": int((new_xyz[:, 0] * 1000.0 < -MID_MM).sum())}}
    # roots proof (same metric).
    rtree = cKDTree(np.ascontiguousarray(new_xyz))
    rq = new_xyz.copy()
    rq[:, 0] *= -1.0
    rdd, rii = rtree.query(rq)
    rdev_mm = np.abs(new_xyz[rii] - rq).max(axis=1) * 1000.0
    # construction proof for roots: mirror of +x block == -x block.
    nr = len(rpos) + len(rmid)
    rq_constr = new_xyz[:len(rpos)].copy()
    rq_constr[:, 0] *= -1.0
    rconstr = np.abs(rq_constr - new_xyz[nr:]).max(axis=1) * 1000.0
    stats["roots"].update(
        {"constructionDevMm": {"posMirrorMax": round(float(rconstr.max()),
                                                     9)},
         "pairDevMm": {"p50": round(float(np.median(rdev_mm)), 6),
                       "max": round(float(rdev_mm.max()), 6),
                       "nExact001": int((rdev_mm < 0.01).sum())},
         "inexactIds": [int(i) for i in np.nonzero(rdev_mm >= 0.01)[0]],
         "inexactNote": "24 midline singletons kept once per card; "
                        "self-mirror dev = 2|x| <= 1 mm"})
    stats.update({"guidesIn": str(S36O / "step1" / "guides-36routed.npz"),
                  "rootsIn": str(S36 / "roots-34mask20.npz"),
                  "sha": {"guides36": sha16(str(S36O / "guides-36.npz")),
                          "roots36": sha16(str(S36O / "roots-36.npz")),
                          "poolRef36": sha16(
                              str(S36O / "pool-ref-36.npz"))}})
    (E / "mirror36.json").write_text(json.dumps(stats, indent=1) + "\n")
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
