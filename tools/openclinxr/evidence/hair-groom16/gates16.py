#!/usr/bin/env python3
"""hair-groom16 hard gates: count, insideBody, pinna proximity, guide
clearance, outside-pass bound, determinism. Writes E/build/gates16.json.

Blender-lane conventions (no assignment map, exact roots):
- count: 250k <= n <= 310k ("~280k"), pointsPer == 41.
- insideBody: points s>=1 with exact-SDF < 0. Gate: <= 500.
- pinnaProximity: no VISIBLE (radius>1e-6) sample within 3 mm of any
  pinna vert. Gate: 0.
- guideClearance: 0 guide samples with SDF < 1.5 mm after the pass
  (E/build/guides-cleared.json stats). Gate: 0.
- outsidePass: <= 2% of children move > 3 mm (E/build/move16.json). Gate.
- determinism: rebuild via strands/blender_children.py with the exact
  final flags; compare points+radii array hashes. Gate: identical.
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
STRANDS = ROOT / "tools/openclinxr/hair-groom/strands"
sys.path.insert(0, str(STRANDS))
from children import sdf_sampler  # noqa: E402

SDFP = ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz"
PINNA = ROOT / "tools/openclinxr/evidence/hair-hull3/workspace/ear_pinna.npz"

BUILD_FLAGS = {
    "guides": str(ROOT / "tools/openclinxr/evidence/hair-groom8a/build"
                      / "guides-8a.npz"),
    "density": "3900000",
    "seed": "7",
    "scalp-roots": str(ROOT / "tools/openclinxr/evidence/hair-scalp1"
                           / "roots.npz"),
    "part-by-islands": "1",
    "clump-factor": "0.2",
    "lateral-keep": "0.0",
    "root-band": "0.070",
    "sideburn-tuck": "1",
    "skip-drape": "1",
    "clear-guides": "1",
    "clearance-mm": "2.0",
    "clear-thresh-mm": "2.0",
    "clear-gate-mm": "1.5",
    "outside-pass": "1",
    "outside-target-mm": "0.5",
    "outside-thresh-mm": "0.5",
    "smooth-steps": "2",
    "smooth-amount": "0.15",
    "smooth-iters": "1",
    "depth-classes": "3",
    "interp-guides": "3",
    "skip-shrink": "1",
    "colliders": "",
}

FLAG_ORDER = ["guides", "out", "density", "seed", "scalp-roots",
              "part-by-islands", "clump-factor", "lateral-keep",
              "root-band", "sideburn-tuck", "skip-drape", "clear-guides",
              "clearance-mm", "clear-thresh-mm", "clear-gate-mm",
              "guides-out", "outside-pass", "outside-target-mm",
              "outside-thresh-mm", "move-report", "smooth-steps",
              "smooth-amount", "smooth-iters", "depth-classes",
              "interp-guides", "skip-shrink", "colliders"]


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
    strands_p = Path(args.strands or (outdir / "strands-8a.npz"))
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

    # guide-clearance gate (from the build's own stats)
    _gcj = outdir / "guides-cleared.json"
    _gc = json.loads(_gcj.read_text())["guideClearStats"] if _gcj.exists() \
        else None
    guide_ok = bool(_gc and _gc["postSamplesLtGate"] == 0)
    _mj = outdir / "move16.json"
    _mv = json.loads(_mj.read_text()) if _mj.exists() else None
    outside = _mv["outsidePass"] if _mv else None
    outside_ok = bool(outside and outside["pass"])
    falsifier = _mv.get("falsifier") if _mv else None

    h1 = arr_hash(np.asarray(doc["points"]), np.asarray(doc["radii"]))
    tmp2 = Path(tempfile.mkdtemp(prefix="g16-detB-"))
    try:
        bf = dict(BUILD_FLAGS)
        cmd = [
            "/Applications/Blender.app/Contents/MacOS/Blender",
            "--background", "--python",
            str(STRANDS / "blender_children.py"), "--",
        ]
        for k in FLAG_ORDER:
            if k == "out":
                cmd += ["--out", str(tmp2 / "strands.npz")]
            elif k == "guides-out":
                cmd += ["--guides-out", str(tmp2 / "guides-cleared.npz")]
            elif k == "move-report":
                cmd += ["--move-report", str(tmp2 / "move.json")]
            else:
                cmd += ["--" + k, bf[k]]
        r = subprocess.run(cmd, capture_output=True, text=True,
                           timeout=7200)
        if r.returncode != 0:
            raise RuntimeError("rebuild failed: " + r.stderr[-2000:])
        doc2 = np.load(tmp2 / "strands.npz", allow_pickle=True)
        h2 = arr_hash(np.asarray(doc2["points"]),
                      np.asarray(doc2["radii"]))
    finally:
        shutil.rmtree(tmp2, ignore_errors=True)
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
        "outsidePass": {"fracChildrenMoveGt3mm": (
                            outside["fracChildrenMoveGt3mm"] if outside
                            else None),
                        "nChildrenMoveGt3mm": (outside["nChildrenMoveGt3mm"]
                                               if outside else None),
                        "gate": "<= 0.02 of children move > 3 mm",
                        "pass": bool(outside_ok), "hard": True},
        "falsifier": falsifier,
        "tipDriftAcross": {"n": tip_cross,
                           "note": "advisory: tips across x=0 vs own root"},
        "determinism": {"hashA": h1, "hashB": h2,
                        "pass": bool(det_ok), "hard": True},
        "buildFlags": BUILD_FLAGS,
    }
    all_ok = all(v["pass"] for v in gates.values()
                 if isinstance(v, dict) and v.get("hard"))
    gates["pass"] = bool(all_ok)
    with open(outdir / "gates16.json", "w") as f:
        json.dump(gates, f, indent=1)
    print(json.dumps(gates, indent=1))
    if not all_ok:
        raise SystemExit("GATES FAILED")


if __name__ == "__main__":
    main()
