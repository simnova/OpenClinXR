#!/usr/bin/env python3
"""hair-groom18 hard gates: count, insideBody, pinna proximity, guide
clearance, height-transfer record, determinism. Writes E/build/gates18.json.

Blender-lane conventions (no assignment map, exact roots):
- count: 250k <= n <= 310k, pointsPer == 41.
- insideBody: points s>=1 with exact-SDF < 0. Gate: <= 500.
- pinnaProximity: no VISIBLE (radius>1e-6) sample within 3 mm of any
  pinna vert. Gate: 0.
- guideClearance: 0 guide samples with SDF < 1.5 mm after the groom16
  clearance pass (groom16 build/guides-cleared.json stats). Gate: 0.
- heightTransfer: build/height-transfer.json exists, bounded solver
  (stepBound.maxStepMm <= 10, maxTotalMoveMm <= 150), postInside 0.
- determinism: re-run rerun_transfer18.py (same inputs) and compare
  points+child_move_mm array hashes. Gate: identical. (The transfer is
  pure numpy, no RNG; the Blender pre-build determinism is checked
  separately by rebuilding strands-18-pre to temp — see RESULT.)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
STRANDS = ROOT / "tools/openclinxr/hair-groom/strands"
sys.path.insert(0, str(STRANDS))
from children import sdf_sampler  # noqa: E402

SDFP = ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz"
PINNA = ROOT / "tools/openclinxr/evidence/hair-hull3/workspace/ear_pinna.npz"

# Card-spec pre-build flags (strands-18-pre.npz; verified markers from
# build-pre.log: no GUIDE_CLEAR/TUCK lines, DEPTH_CUTS [] = 1 class,
# CLASS_SHARES single class, curves=251401):
# blender_children.py --guides <groom16 guides-cleared.npz>
#   --density 3900000 --seed 7 --scalp-roots hair-scalp1/roots.npz
#   --part-by-islands 1 --clump-factor 0.2 --sideburn-tuck 0 --skip-drape 1
#   --clear-guides 0 --outside-pass 0 --height-transfer 0
#   --depth-classes 1 --interp-guides 3 --distance-to-guides 0.02
#   --follow-surface-normal 0 --skip-clump 0 --skip-noise 0
#   --skip-shrink 1 --skip-smooth 1 --colliders ""
# then rerun_transfer18.py (bounded SDF height transfer, same function the
# Blender --height-transfer path calls).
BUILD_FLAGS = {
    "guides": str(ROOT / "tools/openclinxr/evidence/hair-groom16/build"
                      / "guides-cleared.npz"),
    "density": "3900000",
    "seed": "7",
    "scalp-roots": str(ROOT / "tools/openclinxr/evidence/hair-scalp1"
                            / "roots.npz"),
    "part-by-islands": "1",
    "clump-factor": "0.2",
    "sideburn-tuck": "0",
    "skip-drape": "1",
    "clear-guides": "0",
    "outside-pass": "0",
    "height-transfer": "rerun_transfer18.py",
    "depth-classes": "1",
    "interp-guides": "3",
    "distance-to-guides": "0.02",
    "follow-surface-normal": "0",
    "skip-clump": "0",
    "skip-noise": "0",
    "skip-shrink": "1",
    "skip-smooth": "1",
    "colliders": "",
    "transferBounds": {"maxStepMm": 10.0, "maxTotalMoveMm": 150.0,
                       "iters": 120, "tolMm": 0.05, "relax": 0.8},
}


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--outdir", default=str(E / "build"))
    p.add_argument("--strands", default=None)
    return p.parse_args()


def arr_hash(*arrs):
    h = hashlib.sha256()
    for a in arrs:
        h.update(np.ascontiguousarray(a).tobytes())
    return h.hexdigest()


def main():
    args = cli()
    outdir = Path(args.outdir)
    strands_p = Path(args.strands or (outdir / "strands-18.npz"))
    doc = np.load(strands_p, allow_pickle=True)
    pts = np.asarray(doc["points"], dtype=np.float64)
    radii = np.asarray(doc["radii"], dtype=np.float64)
    n, p, _ = pts.shape

    count_ok = (250000 <= n <= 310000) and (p == 41)

    sdoc = np.load(str(SDFP), allow_pickle=True)
    sample, _ = sdf_sampler(sdoc)
    vals, inside = sample(pts[:, 1:, :].reshape(-1, 3))
    n_inside = int((inside & (vals < 0.0)).sum())
    inside_ok = n_inside <= 500

    pdoc = np.load(str(PINNA), allow_pickle=True)
    pinna_m = np.vstack([
        np.asarray(pdoc["xyz"], dtype=np.float64)[
            np.asarray(pdoc["idx_earXpos"])],
        np.asarray(pdoc["xyz"], dtype=np.float64)[
            np.asarray(pdoc["idx_earXneg"])]])
    from scipy.spatial import cKDTree as _KDT2
    _ptree = _KDT2(pinna_m)
    _flat = pts[:, 1:, :].reshape(-1, 3)
    _pd, _ = _ptree.query(_flat, k=1)
    _vis = radii[:, 1:].ravel() > 1e-6
    n_pinnear = int((_pd[_vis] < 0.003).sum())
    pinnear_ok = n_pinnear == 0

    rx = pts[:, 0, 0]
    tx = pts[:, -1, 0]
    tip_cross = int((((rx >= 0) != (tx >= 0))).sum())

    _gcj = (ROOT / "tools/openclinxr/evidence/hair-groom16/build"
            / "guides-cleared.json")
    _gc = json.loads(_gcj.read_text())["guideClearStats"] if _gcj.exists() \
        else None
    guide_ok = bool(_gc and _gc["postSamplesLtGate"] == 0)

    _htj = outdir / "height-transfer.json"
    _ht = json.loads(_htj.read_text()) if _htj.exists() else None
    ht_ok = bool(
        _ht and _ht.get("postInsideSamples", 1) == 0
        and _ht.get("stepBound", {}).get("maxStepMm", 999) <= 10.0
        and _ht.get("stepBound", {}).get("maxTotalMoveMm", 999) <= 150.0)

    h1 = arr_hash(np.asarray(doc["points"]),
                  np.asarray(doc["child_move_mm"]))
    r = subprocess.run(
        [sys.executable, str(E / "rerun_transfer18.py")],
        capture_output=True, text=True, timeout=1800,
        cwd=str(ROOT))
    if r.returncode != 0:
        raise RuntimeError("transfer rerun failed: " + r.stderr[-2000:])
    doc2 = np.load(strands_p, allow_pickle=True)
    h2 = arr_hash(np.asarray(doc2["points"]),
                  np.asarray(doc2["child_move_mm"]))
    det_ok = h1 == h2

    gates = {
        "count": {"n": n, "pointsPer": p, "expectBand": [250000, 310000],
                  "pass": bool(count_ok), "hard": True},
        "insideBody": {"nSge1Inside": n_inside, "gate": "<= 500",
                       "pass": bool(inside_ok), "hard": True},
        "pinnaProximity": {"clearMm": 3.0,
                           "nVisibleSamplesLt": n_pinnear,
                           "pass": bool(pinnear_ok), "hard": True},
        "guideClearance": {"postSamplesLtGate": (_gc["postSamplesLtGate"]
                                                  if _gc else None),
                           "gate": "0 samples < 1.5 mm",
                           "pass": bool(guide_ok), "hard": True},
        "heightTransfer": {
            "postInside": (_ht["postInsideSamples"] if _ht else None),
            "residMaxMm": (_ht["residMm_max"] if _ht else None),
            "pathMaxMm": (_ht["moveMm_max"] if _ht else None),
            "netMaxMm": (_ht["netMm_max"] if _ht else None),
            "fracGt3mm": (_ht["fracChildrenMovedGt3mm"] if _ht else None),
            "gate": "postInside==0, bounded (10/150mm)",
            "pass": bool(ht_ok), "hard": True},
        "tipDriftAcross": {"n": tip_cross,
                           "note": "advisory: tips across x=0 vs own root"},
        "determinism": {"hashA": h1, "hashB": h2,
                        "pass": bool(det_ok), "hard": True},
        "buildFlags": BUILD_FLAGS,
    }
    all_ok = all(v["pass"] for v in gates.values()
                 if isinstance(v, dict) and v.get("hard"))
    gates["pass"] = bool(all_ok)
    with open(outdir / "gates18.json", "w") as f:
        json.dump(gates, f, indent=1)
    print(json.dumps(gates, indent=1))
    if not all_ok:
        raise SystemExit("GATES FAILED")


if __name__ == "__main__":
    main()
