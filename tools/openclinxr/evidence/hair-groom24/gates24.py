#!/usr/bin/env python3
"""hair-groom24 card gates (brief thresholds; provenance in parentheses).

Reads E/score24.json, E/groom24cal-calib.json, E/build-*/build.json,
store strands. Determinism: rebuild both children recipes to temp dirs
with the exact prescribed flags, hash-compare points+radii vs the store
files. Writes E/build/gates24.json (build/ dir holds small gate records
only; the two per-build build.json stay in build-19f/ and build-24/).
Exit nonzero on any HARD fail.
"""
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
STORE = Path("/Volumes/files/openclinxr-assets/store/hair-groom24")


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


BUILDS = {
    "groom19f": {
        "guides": str(ROOT / "tools/openclinxr/evidence/hair-groom19"
                      / "build/guides-19.npz"),
        "store": STORE / "strands-19f.npz",
        "buildjson": E / "build-19f" / "build.json",
    },
    "groom24": {
        "guides": str(ROOT / "tools/openclinxr/evidence/hair-groom21"
                      / "build/guides-21.npz"),
        "store": STORE / "strands-24.npz",
        "buildjson": E / "build-24" / "build.json",
    },
}

FLAGS = ["--region-weight", "--uv-cutoff", "0.15",
         "--pool-max-move-mm", "60"]


def rebuild(guides):
    tmp = Path(tempfile.mkdtemp(prefix="g24-det-"))
    try:
        r = subprocess.run(
            [sys.executable, str(ROOT / "tools/openclinxr/hair-groom"
                                 / "strands/interp_children.py"),
             "--outdir", str(tmp),
             "--guides", guides,
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
        return (file_sha(tmp / "strands.npz"),
                arr_hash(np.asarray(d["points"]),
                         np.asarray(d["radii"])))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    score = json.loads((E / "score24.json").read_text())
    calib = json.loads((E / "groom24cal-calib.json").read_text())
    gates = {}
    gates["calibration"] = {
        "iou": calib["iou"],
        "all_within_0.02": bool(calib.get("all_within_0.02")),
        "pass": bool(calib.get("all_within_0.02")), "hard": True}
    det = {}
    for tag, b in BUILDS.items():
        d = np.load(str(b["store"]), allow_pickle=True)
        h0 = file_sha(str(b["store"]))
        a0 = arr_hash(np.asarray(d["points"]), np.asarray(d["radii"]))
        bj = json.loads(Path(b["buildjson"]).read_text())
        assert bj["sha256"] == h0, (tag, bj["sha256"], h0)
        h1, a1 = rebuild(b["guides"])
        det[tag] = {"storeSha": h0, "rebuildSha": h1,
                    "storeArrSha": a0, "rebuildArrSha": a1,
                    "pass": bool(h0 == h1 and a0 == a1)}
    gates["determinismChildren"] = {
        "v": det, "gate": "identical points+radii hash on rebuild",
        "pass": bool(all(v["pass"] for v in det.values())),
        "hard": True}
    for tag in ("groom19f", "groom24"):
        t = dict(score["gates24"][tag])
        t["determinism"] = det[tag]["pass"]
        hard = bool(t["hard"]["pass"] and det[tag]["pass"])
        t["hardWithDeterminism"] = hard
        gates[tag] = t
    gates["pass"] = bool(
        gates["calibration"]["pass"]
        and gates["determinismChildren"]["pass"]
        and all(gates[t]["hardWithDeterminism"]
                for t in ("groom19f", "groom24")))
    (E / "build").mkdir(exist_ok=True)
    (E / "build" / "gates24.json").write_text(
        json.dumps(gates, indent=1) + "\n")
    print(json.dumps(
        {k: (v.get("hardWithDeterminism", v.get("pass"))
             if isinstance(v, dict) else v)
         for k, v in gates.items()}, indent=1))
    if not gates["pass"]:
        raise SystemExit("GATES FAILED")


if __name__ == "__main__":
    main()
