#!/usr/bin/env python3
"""groom33: rebuild the groom33 children recipe (build-31 EXACT minus
--lobe-sweep-postcap; NO --lobe-tuck per build-31 lobeTuck off) to a temp
dir and hash-compare points+radii vs store strands-33.
Writes E/det-33.json."""
from __future__ import annotations

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
STORE = Path("/Volumes/files/openclinxr-assets/store/hair-groom33")
POOLREF = str(ROOT / "tools/openclinxr/evidence/hair-groom8a"
              / "build/guides-8a.npz")
GUIDES = str(E.parent / "hair-groom30/build-30/guides-30.npz")
SHIRTSDF = "/Volumes/files/openclinxr-assets/store/hair-groom31/shirt-sdf-4mm.npz"
# groom33 = build-31 exact recipe MINUS --lobe-sweep-postcap.
FLAGS = ["--region-weight", "--uv-cutoff", "0.15",
         "--pool-max-move-mm", "60", "--pool-ref", POOLREF,
         "--temple-taper", "0.5", "--lobe-drop-roots",
         "--sideburn-cap-lobe", "--cap-reproject",
         "--shirt-sdf", SHIRTSDF, "--shirt-clear-mm", "0.5"]


def file_sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def arr_hash(*arrs):
    h = hashlib.sha256()
    for a in arrs:
        h.update(np.ascontiguousarray(a).tobytes())
    return h.hexdigest()


def main():
    tmp = Path(tempfile.mkdtemp(prefix="g33-det-"))
    try:
        r = subprocess.run(
            [sys.executable, str(ROOT / "tools/openclinxr/hair-groom"
                                 / "strands/interp_children.py"),
             "--outdir", str(tmp), "--guides", GUIDES,
             "--roots", str(ROOT / "tools/openclinxr/evidence"
                            / "hair-scalp1/roots.npz"),
             "--sdf", str(ROOT / "tools/openclinxr/evidence"
                           / "hair-cage1/body-exact-sdf.npz"),
             "--hull", str(ROOT / "tools/openclinxr/evidence"
                           / "hair-hull5/hull.npz"),
             "--ear-frame", str(ROOT / "tools/openclinxr/evidence"
                                / "hair-groom4/tucked/earframe.json")]
            + FLAGS,
            capture_output=True, text=True, timeout=3600)
        if r.returncode != 0:
            raise RuntimeError("rebuild failed: " + r.stderr[-2000:])
        d = np.load(tmp / "strands.npz", allow_pickle=True)
        h1 = file_sha(tmp / "strands.npz")
        a1 = arr_hash(np.asarray(d["points"]), np.asarray(d["radii"]))
        p1 = np.asarray(d["points"])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    ref = STORE / "strands.npz"
    d0 = np.load(str(ref), allow_pickle=True)
    h0 = file_sha(str(ref))
    a0 = arr_hash(np.asarray(d0["points"]), np.asarray(d0["radii"]))
    p0 = np.asarray(d0["points"])
    maxabs = float(np.max(np.abs(p1 - p0))) if p1.shape == p0.shape else -1.0
    out = {"refSha": h0, "rebuildSha": h1,
           "refArrSha": a0, "rebuildArrSha": a1,
           "shapes": [list(p0.shape), list(p1.shape)],
           "maxAbsDiffMm": maxabs * 1000.0,
           "flags": FLAGS,
           "pass": bool(h0 == h1 and a0 == a1),
           "note": "groom33 recipe (no sweep, no tuck, no settle); "
                   "compares vs store strands-33"}
    (E / "det-33.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
