#!/usr/bin/env python3
"""hair-groom29: rebuild the FINAL children recipe (re-draped + faired
guides-29 + pool60 + taper0.5 + lobe-drop) to a temp dir with the exact
prescribed flags and hash-compare points+radii vs the store file.
Pool-ref is the hair-tgt2 path of guides-8a.npz (card requirement).
Writes E/det-29.json."""
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
STORE29 = Path("/Volumes/files/openclinxr-assets/store/hair-groom29")
POOLREF = ("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2"
           "/tools/openclinxr/evidence/hair-groom8a/build/guides-8a.npz")
GUIDES = str(STORE29 / "guides-29.npz")
FLAGS = ["--region-weight", "--uv-cutoff", "0.15",
         "--pool-max-move-mm", "60", "--pool-ref", POOLREF,
         "--temple-taper", "0.5", "--lobe-drop-roots"]


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
    tmp = Path(tempfile.mkdtemp(prefix="g29-det-"))
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
             "--pinna", str(ROOT / "tools/openclinxr/evidence"
                            / "hair-hull3/workspace/ear_pinna.npz"),
             "--cameras", str(ROOT / "tools/openclinxr/hair-groom"
                              / "manifests/cameras-scorer-v3.json"),
             "--ear-frame", str(ROOT / "tools/openclinxr/evidence"
                                / "hair-groom4/tucked/earframe.json")]
            + FLAGS,
            capture_output=True, text=True, timeout=3600)
        if r.returncode != 0:
            raise RuntimeError("rebuild failed: " + r.stderr[-2000:])
        d = np.load(tmp / "strands.npz", allow_pickle=True)
        h1 = file_sha(tmp / "strands.npz")
        a1 = arr_hash(np.asarray(d["points"]), np.asarray(d["radii"]))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    store = STORE29 / "strands-29.npz"
    d0 = np.load(str(store), allow_pickle=True)
    h0 = file_sha(str(store))
    a0 = arr_hash(np.asarray(d0["points"]), np.asarray(d0["radii"]))
    bj = json.loads((E / "build-29" / "build.json").read_text())
    out = {"buildJsonSha": bj["sha256"],
           "buildJsonMatch": bool(bj["sha256"] == h0),
           "storeSha": h0, "rebuildSha": h1,
           "storeArrSha": a0, "rebuildArrSha": a1,
           "pass": bool(h0 == h1 and a0 == a1 and bj["sha256"] == h0)}
    (E / "det-29.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
