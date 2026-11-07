#!/usr/bin/env python3
"""groom8b hard gates: count, part assignment, inside body, pinna
proximity, determinism (rebuild), lane metric, frames self-test.
Writes E/build/gates.json. Exit nonzero on any HARD fail.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
import frames as F  # noqa: E402
from children import sdf_sampler  # noqa: E402

P = 32


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--outdir", default=str(E / "build"))
    p.add_argument("--expect", type=int, default=198170)
    return p.parse_args()


def arr_hash(*arrs):
    h = hashlib.sha256()
    for a in arrs:
        h.update(np.ascontiguousarray(a).tobytes())
    return h.hexdigest()


def autocorr(d):
    d = np.asarray(d, dtype=np.float64)
    d = d - d.mean()
    denom = float((d ** 2).sum())
    if denom == 0.0:
        return np.ones(1)
    full = np.correlate(d, d, mode="full")
    return full[len(full) // 2:] / denom


def main():
    args = cli()
    outdir = Path(args.outdir)
    E8b = outdir.parent if outdir.name == "build" else outdir
    strands_p = outdir / "strands.npz"
    doc = np.load(strands_p, allow_pickle=True)
    pts = np.asarray(doc["points"], dtype=np.float64)
    radii = np.asarray(doc["radii"], dtype=np.float64)
    n, p, _ = pts.shape
    build = json.loads((outdir / "build.json").read_text())
    part_x = float(build["part"]["partX"])
    guides_path = build["inputs"]["guides"]
    roots_path = build["inputs"]["roots"]
    sdf_path = build["inputs"]["sdf"]

    count_ok = (n == args.expect) and (p == P)

    gdoc = np.load(guides_path, allow_pickle=True)
    crown_g = np.asarray(gdoc["crown"], dtype=np.float64)
    gw_full = F.head_to_world(np.asarray(gdoc["curves_head"]), crown_g)
    gi = np.asarray(doc["guide_idx"])
    rxyz_p = np.asarray(np.load(roots_path,
                                allow_pickle=True)["xyz"], dtype=np.float64)
    parent = np.asarray(doc["parent"], dtype=np.int64)
    _YV = 0.0342
    _gs0 = np.where(gw_full[:, 0, 0] >= part_x, 1.0, -1.0)
    rside_p = np.where(rxyz_p[:, 0] >= part_x, 1.0, -1.0)[parent]
    above_v = (rxyz_p[:, 1] <= _YV)[parent]
    K = 4
    _cross = (_gs0[gi] != rside_p[:, None])
    assign_cross = int((_cross & above_v[:, None]).sum())
    assign_cross_below = int((_cross & ~above_v[:, None]).sum())
    assign_ok = assign_cross == 0
    gw = gw_full
    rx = pts[:, 0, 0] - part_x
    tx = pts[:, -1, 0] - part_x
    tip_cross = int(((rx >= 0) != (tx >= 0)).sum())
    tip_over = (np.abs(tx[(rx >= 0) != (tx >= 0)])
                if tip_cross else np.array([0.0]))
    _gst = np.where(gw[:, -1, 0] >= part_x, 1.0, -1.0)
    guide_tip_cross = int((_gs0 != _gst).sum())

    sdoc = np.load(sdf_path, allow_pickle=True)
    sample, _ = sdf_sampler(sdoc)
    vals, inside = sample(pts[:, 1:, :].reshape(-1, 3))
    n_inside = int((inside & (vals < 0.0)).sum())
    inside_ok = n_inside == 0

    pdoc = np.load(str(ROOT / "tools/openclinxr/evidence/hair-hull3"
                       "/workspace/ear_pinna.npz"), allow_pickle=True)
    pinna_m = np.vstack([
        np.asarray(pdoc["xyz"], dtype=np.float64)[
            np.asarray(pdoc["idx_earXpos"])],
        np.asarray(pdoc["xyz"], dtype=np.float64)[
            np.asarray(pdoc["idx_earXneg"])]])
    from scipy.spatial import cKDTree as _KDT2
    _ptree = _KDT2(pinna_m)
    _flat = pts[:, 1:, :].reshape(-1, 3)
    _pd, _ = _ptree.query(_flat, k=1)
    _vis = (np.asarray(radii, dtype=np.float64)[:, 1:].ravel() > 1e-6)
    n_pinnear = int(((_pd[_vis] < 0.003)).sum())
    pinnear_ok = n_pinnear == 0

    h1 = arr_hash(np.asarray(doc["points"]), np.asarray(doc["radii"]))
    tmp = Path(tempfile.mkdtemp(prefix="g8b-det-"))
    try:
        r = subprocess.run(
            [sys.executable,
             str(ROOT / "tools/openclinxr/hair-groom/strands"
                 / "interp_children.py"),
             "--outdir", str(tmp), "--guides", guides_path,
             "--roots", roots_path, "--sdf", sdf_path,
             "--ear-frame", str(ROOT / "tools/openclinxr/evidence"
                                / "hair-groom4/tucked/earframe.json")],
            capture_output=True, text=True, timeout=3600)
        if r.returncode != 0:
            raise RuntimeError("rebuild failed: " + r.stderr[-2000:])
        doc2 = np.load(tmp / "strands.npz", allow_pickle=True)
        h2 = arr_hash(np.asarray(doc2["points"]),
                      np.asarray(doc2["radii"]))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    det_ok = h1 == h2

    BIN_MM = 0.5
    mid = pts[:, P // 2, :]
    gmid = gw[:, 15, :]
    y_cut = float(crown_g[1]) + 0.02
    back = mid[:, 1] > y_cut
    sel = mid[back, 0]
    gsel = gmid[gmid[:, 1] > y_cut, 0]
    gsel_sorted = np.sort(gsel)
    gaps = np.diff(gsel_sorted)
    gaps = gaps[gaps > 0.5 / 1000.0]
    guide_spacing_m = float(np.median(gaps)) if len(gaps) else 0.01
    lo, hi = float(sel.min()), float(sel.max())
    nb = max(8, int(round((hi - lo) * 1000.0 / BIN_MM)))
    hist, _ = np.histogram(sel, bins=nb, range=(lo, hi))
    Rr = autocorr(hist)
    Le = max(2, int(round(guide_spacing_m * 1000.0 / BIN_MM)))
    loW = max(1, Le - 1)
    num = float(Rr[Le]) if Le < len(Rr) else 0.0
    flank = ([float(Rr[loW - 1])] if loW - 1 >= 0 else [])
    flank += ([float(Rr[Le + 1])] if Le + 1 < len(Rr) else [])
    den = float(np.mean(flank)) if flank else 1.0
    peak_ratio = num / den if den > 0.01 else (1.0 if num <= 0.01 else 9.99)
    lane_ok = bool(peak_ratio < 1.5)

    frames_self = F.self_test()

    gates = {
        "count": {"n": n, "pointsPer": p, "expect": args.expect,
                  "pass": bool(count_ok), "hard": True},
        "partCrossings": {"nAssignAcross": assign_cross,
                           "pass": bool(assign_ok), "hard": True,
                           "nAssignAcrossBelowVertexAllowed":
                           assign_cross_below,
                           "tipDriftAcross": tip_cross,
                           "tipOvershootMmP50": round(
                               float(np.median(tip_over)) * 1000.0, 2),
                           "tipOvershootMmMax": round(
                               float(tip_over.max()) * 1000.0, 2),
                           "guideTipCross": guide_tip_cross},
        "insideBody": {"nSge1Inside": n_inside,
                       "pass": bool(inside_ok), "hard": True},
        "pinnaProximity": {"clearMm": 3.0,
                           "nVisibleSamplesLt": n_pinnear,
                           "pass": bool(pinnear_ok), "hard": True},
        "determinism": {"hashA": h1, "hashB": h2,
                        "pass": bool(det_ok), "hard": True},
        "lane": {"nBackStrands": int(len(sel)),
                 "guideSpacingMm": round(guide_spacing_m * 1000.0, 2),
                 "lagBins": Le, "peakRatio": round(float(peak_ratio), 3),
                 "pass": bool(lane_ok), "hard": True},
        "framesSelfTest": frames_self,
    }
    all_ok = all(v["pass"] for v in gates.values()
                 if isinstance(v, dict) and v.get("hard"))
    gates["pass"] = bool(all_ok)
    with open(outdir / "gates.json", "w") as f:
        json.dump(gates, f, indent=1)
    print(json.dumps(gates, indent=1))
    if not all_ok:
        raise SystemExit("GATES FAILED")


if __name__ == "__main__":
    main()
