"""groom31 STEP 2: gravity settle onto the body+shirt collision field.

Position-based relaxation after the child build: roots and the first
PIN_MM of arc stay pinned; free samples fall under gravity in small
steps, segment rest-lengths are re-imposed (PBD distance passes, so
length is preserved by construction), and violators are pushed out of
the UNION field (min(body, shirt - off), same encoding as the
--shirt-sdf keep-out in interp_children.py). Strands that cannot reach
the torso (total length < 50 mm, or no sample below z 1.58 m) are
frozen bit-identical. Deterministic (no RNG); vectorised over strands
(no O(n^2) passes).

Writes E/strands-settled.npz + E/settle.json.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

S9 = Path(__file__).resolve().parent
sys.path.insert(0, str(S9))
import common9 as C
from children import sdf_sampler, project_outside

P = 32
SDF_MARGIN_MM = 0.3


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--inp", required=True)
    p.add_argument("--outdir", required=True)
    p.add_argument("--sdf", required=True)
    p.add_argument("--shirt-sdf", default="")
    p.add_argument("--shirt-clear-mm", type=float, default=0.5)
    p.add_argument("--iters", type=int, default=200)
    p.add_argument("--step-mm", type=float, default=0.15)
    p.add_argument("--pin-mm", type=float, default=40.0)
    p.add_argument("--pinna", default="",
                   help="ear_pinna.npz; when set, the earlobe gate column "
                   "is cleared every iteration (same zone as the gate) "
                   "so gravity cannot re-fill it")
    p.add_argument("--freeze-len-mm", type=float, default=50.0)
    p.add_argument("--freeze-z", type=float, default=1.58)
    return p.parse_args()


def main():
    t0 = time.time()
    args = cli()
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    for f in (args.inp, args.sdf):
        C.log_open(f)
    body = np.load(args.sdf, allow_pickle=True)
    bsample, _ = sdf_sampler(body)
    off = float(args.shirt_clear_mm) - SDF_MARGIN_MM
    if str(args.shirt_sdf):
        C.log_open(args.shirt_sdf)
        sh = np.load(str(args.shirt_sdf), allow_pickle=True)
        s_h, _ = sdf_sampler(sh)

        def sample(pts_m, _b=bsample, _s=s_h, _off=off):
            bv, bi = _b(pts_m)
            sv, si = _s(pts_m)
            b2 = np.where(bi, bv, np.inf)
            # near-band + below the collar rim (no fabric above z 1.40;
            # neck-hole parity votes are garbage up there).
            near = si & (np.abs(sv) < 10.0) & (pts_m[:, 2] < 1.40)
            s2 = np.where(near, sv - _off, np.inf)
            v = np.minimum(b2, s2)
            inside = bi | near
            return np.where(inside, v, np.nan), inside
        union_on = True
    else:
        sample = bsample
        union_on = False

    D = np.load(args.inp, allow_pickle=True)
    pts0 = np.asarray(D["points"], dtype=np.float64)
    n = pts0.shape[0]
    seg = np.linalg.norm(np.diff(pts0, axis=1), axis=2)
    arc = np.concatenate([np.zeros((n, 1)), np.cumsum(seg, axis=1)],
                         axis=1)
    total = arc[:, -1]
    pin = arc <= (float(args.pin_mm) / 1000.0)
    pin[:, 0] = True
    free = ~pin
    freeze = (total < float(args.freeze_len_mm) / 1000.0) | (
        pts0[:, :, 2].min(axis=1) > float(args.freeze_z))
    live = ~freeze
    print("settle n=%d live=%d frozen=%d pinFrac=%.3f" % (
        n, int(live.sum()), int(freeze.sum()),
        float(pin.sum()) / pin.size), flush=True)

    pos = pts0.copy()
    rest = np.linalg.norm(np.diff(pts0, axis=1), axis=2) + 1e-12
    step = float(args.step_mm) / 1000.0
    nlive = live
    # earlobe gate column (per-side thresholds from the pinna): cleared
    # every iteration so gravity cannot re-fill the column the builder
    # swept. Same zone as the earlobe gate (z < zmin, y in span,
    # |x| in the ear band, same side); pushed samples go 10 mm behind
    # the back edge and the collide step settles tissue landings.
    lobe = []
    if str(args.pinna):
        C.log_open(args.pinna)
        _pdoc = np.load(str(args.pinna), allow_pickle=True)
        _pxyz = np.asarray(_pdoc["xyz"], dtype=np.float64)
        for _key, _sgn in (("idx_earXpos", 1.0),
                            ("idx_earXneg", -1.0)):
            _pv = _pxyz[np.asarray(_pdoc[_key])]
            lobe.append({"sgn": _sgn,
                         "zmin": float(_pv[:, 2].min()),
                         "yfront": float(_pv[:, 1].max()),
                         "yback": float(_pv[:, 1].min()),
                         "xmin": float(np.abs(_pv[:, 0]).min()),
                         "xmax": float(np.abs(_pv[:, 0]).max())})
    # contact before (combined field, 1.5 mm band)
    flat0 = pos[nlive][:, 1:, :].reshape(-1, 3)
    v0, i0 = sample(flat0)
    c0 = float(((i0) & (v0 >= 0.0) & (v0 <= 1.5)).sum())
    nfree0 = int(free[nlive].sum())
    livefree = free & live[:, None]
    for it in range(int(args.iters)):
        # gravity: free live samples fall one step
        pos[livefree, 2] -= step
        # column clear: push gate-zone samples behind the ear
        if lobe:
            _cs = pos[:, 1:, :]
            for _lb in lobe:
                _m = ((_cs[:, :, 2] < _lb["zmin"])
                      & (_cs[:, :, 1] >= _lb["yback"])
                      & (_cs[:, :, 1] <= _lb["yfront"])
                      & ((_cs[:, :, 0] * _lb["sgn"]) > 0)
                      & (np.abs(_cs[:, :, 0]) >= _lb["xmin"] - 0.005)
                      & (np.abs(_cs[:, :, 0]) <= _lb["xmax"]))
                _m &= live[:, None] & free[:, 1:]
                if _m.any():
                    _blk = pos[:, 1:, :]
                    _blk[_m, 1] = _lb["yback"] - 0.010
        # length: exact forward sweep first (restores the gravity
        # stretch), then collide has the last word so no iteration
        # ends with a violation. The pin set is a sample prefix
        # (arc <= pin-mm grows monotonically from the root), so placing
        # each free sample at its rest length from its (already placed)
        # predecessor -- root outward, sequential over segments --
        # restores every segment length exactly in one sweep
        # (Jacobi/Gauss-Seidel averaging only advects the boundary
        # disturbance down the chain instead of removing it).
        free1 = ~pin[:, 1:]
        for _ in range(2):
            for s in range(P - 1):
                d = pos[:, s + 1, :] - pos[:, s, :]
                L = np.linalg.norm(d, axis=1)
                ok = free1[:, s] & (L > 1e-12)
                f = np.ones(n)
                f[ok] = rest[ok, s] / L[ok]
                pos[ok, s + 1, :] = pos[ok, s, :] + d[ok] \
                    * f[ok][:, None]
        # collide: push union-field violators out (few rounds)
        fl = pos[nlive][:, 1:, :].reshape(-1, 3)
        fl, _pr = project_outside(fl, sample,
                                  margin_mm=SDF_MARGIN_MM,
                                  iters=3, over_mm=0.0)
        pos[nlive, 1:, :] = fl.reshape(int(nlive.sum()), P - 1, 3)
        if (it + 1) % 50 == 0 or it == 0:
            print("settle iter %d/%d %.0fs" % (
                it + 1, int(args.iters), time.time() - t0), flush=True)

    # final cleanup: column-clear once more, deep project (builder-grade
    # 50 rounds), one exact sweep, then a short final project so no
    # iteration ends with a violation. Length residual after the final
    # project is measured and reported (near-converged: sub-mm).
    if lobe:
        _cs = pos[:, 1:, :]
        for _lb in lobe:
            _m = ((_cs[:, :, 2] < _lb["zmin"])
                  & (_cs[:, :, 1] >= _lb["yback"])
                  & (_cs[:, :, 1] <= _lb["yfront"])
                  & ((_cs[:, :, 0] * _lb["sgn"]) > 0)
                  & (np.abs(_cs[:, :, 0]) >= _lb["xmin"] - 0.005)
                  & (np.abs(_cs[:, :, 0]) <= _lb["xmax"]))
            _m &= live[:, None] & free[:, 1:]
            if _m.any():
                _blk = pos[:, 1:, :]
                _blk[_m, 1] = _lb["yback"] - 0.010
    fl = pos[nlive][:, 1:, :].reshape(-1, 3)
    fl, _pr = project_outside(fl, sample, margin_mm=SDF_MARGIN_MM,
                              iters=50, over_mm=0.0)
    pos[nlive, 1:, :] = fl.reshape(int(nlive.sum()), P - 1, 3)
    free1 = ~pin[:, 1:]
    for s in range(P - 1):
        d = pos[:, s + 1, :] - pos[:, s, :]
        L = np.linalg.norm(d, axis=1)
        ok = free1[:, s] & (L > 1e-12)
        f = np.ones(n)
        f[ok] = rest[ok, s] / L[ok]
        pos[ok, s + 1, :] = pos[ok, s, :] + d[ok] * f[ok][:, None]
    fl = pos[nlive][:, 1:, :].reshape(-1, 3)
    fl, _prf = project_outside(fl, sample, margin_mm=SDF_MARGIN_MM,
                               iters=20, over_mm=0.0)
    pos[nlive, 1:, :] = fl.reshape(int(nlive.sum()), P - 1, 3)

    # stats
    drop = (pts0[nlive][:, :, 2] - pos[nlive][:, :, 2]) * 1000.0  # mm
    drop_free = drop[free[nlive]]
    flat1 = pos[nlive][:, 1:, :].reshape(-1, 3)
    v1, i1 = sample(flat1)
    c1 = float(((i1) & (v1 >= 0.0) & (v1 <= 1.5)).sum())
    rest1 = np.linalg.norm(np.diff(pos, axis=1), axis=2).sum(axis=1)
    lenchg = np.abs(rest1 - total) * 1000.0
    f0 = pts0[nlive].reshape(-1, 3)
    reg = {
        "shoulders": (f0[:, 2] >= 1.38) & (f0[:, 2] < 1.50)
        & (np.abs(f0[:, 0]) >= 0.08) & (np.abs(f0[:, 0]) < 0.30),
        "back_mid": (f0[:, 1] > 0.05) & (f0[:, 2] >= 1.25)
        & (f0[:, 2] < 1.45) & (np.abs(f0[:, 0]) < 0.15),
        "back_hem": (f0[:, 1] > 0.05) & (f0[:, 2] >= 1.05)
        & (f0[:, 2] < 1.25),
        "nape": (f0[:, 1] > -0.02) & (f0[:, 1] < 0.08)
        & (f0[:, 2] >= 1.45) & (f0[:, 2] < 1.55)
        & (np.abs(f0[:, 0]) < 0.08),
    }
    # region stats on free samples (roots excluded from contact bands)
    reg_out = {}
    free_live = free[nlive]  # (nLive, P)
    v0m = v0.reshape(int(nlive.sum()), P - 1)
    i0m = i0.reshape(int(nlive.sum()), P - 1)
    v1m = v1.reshape(int(nlive.sum()), P - 1)
    i1m = i1.reshape(int(nlive.sum()), P - 1)
    for name, m in reg.items():
        ml = m.reshape(int(nlive.sum()), P)
        dm = drop.reshape(int(nlive.sum()), P)
        sel = ml & free_live
        dd = dm[sel]
        cc0m = (v0m >= 0.0) & (v0m <= 1.5) & i0m
        cc1m = (v1m >= 0.0) & (v1m <= 1.5) & i1m
        sel1 = ml[:, 1:]
        reg_out[name] = {
            "nFree": int(sel.sum()),
            "dropMeanMm": round(float(dd.mean()), 3) if dd.size else 0.0,
            "dropMaxMm": round(float(dd.max()), 3) if dd.size else 0.0,
            "contactBefore": int((cc0m & sel1).sum()),
            "contactAfter": int((cc1m & sel1).sum()),
        }
    info = {
        "union": union_on, "iters": int(args.iters),
        "stepMm": float(args.step_mm), "pinMm": float(args.pin_mm),
        "finalCleanup": {"nPushed": int(_prf["nPushed"]),
                         "nInsideAfter": int(_prf["nInsideAfter"])},
        "nLive": int(nlive.sum()), "nFrozen": int(freeze.sum()),
        "dropFreeMeanMm": round(float(drop_free.mean()), 3),
        "dropFreeMaxMm": round(float(drop_free.max()), 3),
        "dropFreeP90Mm": round(float(np.percentile(drop_free, 90)), 3),
        "contactBefore": int(c0), "contactAfter": int(c1),
        "contactDenom": int(nfree0),
        "lenChangeMaxMm": round(float(lenchg.max()), 4),
        "lenChangeMeanMm": round(float(lenchg.mean()), 5),
        "regions": reg_out,
        "secs": round(time.time() - t0, 1),
    }
    out = {k: (np.asarray(D[k]) if k in D else None)
           for k in D.files}
    out["points"] = pos.astype(np.float32)
    np.savez_compressed(str(outdir / "strands-settled.npz"), **out)
    import hashlib as _hl
    h = _hl.sha256()
    with open(outdir / "strands-settled.npz", "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    info["sha256"] = h.hexdigest()
    (outdir / "settle.json").write_text(json.dumps(info, indent=1))
    C.log_open(args.inp)
    C.merge_opened(outdir / "inputs-opened.txt")
    print(json.dumps(info, indent=1))


if __name__ == "__main__":
    main()
