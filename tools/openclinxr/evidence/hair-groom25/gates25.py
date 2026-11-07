#!/usr/bin/env python3
"""hair-groom25 card gates (brief thresholds; provenance in parentheses).

Reads E/score25-{25a,25b,25c}.json, E/groom25cal-calib.json,
E/build-*/build.json, store strands. Determinism: rebuild all four
children recipes to temp dirs with the exact prescribed flags
(+ --pool-ref guides-8a), hash-compare points+radii vs the store
files. Fairing determinism: re-run the s11 winner recipe, compare
guide sha. Writes E/build/gates25.json. Exit nonzero on any HARD fail.
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
STORE = Path("/Volumes/files/openclinxr-assets/store/hair-groom25")
POOLREF = str(ROOT / "tools/openclinxr/evidence/hair-groom8a"
              / "build/guides-8a.npz")
SDF = str(ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz")
HULL = str(ROOT / "tools/openclinxr/evidence/hair-hull5/hull.npz")


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


GUIDES = {
    "ctrl": str(ROOT / "tools/openclinxr/evidence/hair-groom19"
                / "build/guides-19.npz"),
    "25a": str(E / "build-25a/guides-25a.npz"),
    "25b": str(E / "build-25b/guides-25b.npz"),
    "25c": str(E / "build-25c/guides-25c.npz"),
}

FLAGS = ["--region-weight", "--uv-cutoff", "0.15",
         "--pool-max-move-mm", "60", "--pool-ref", POOLREF]


def rebuild_children(tag):
    tmp = Path(tempfile.mkdtemp(prefix="g25-det-"))
    try:
        r = subprocess.run(
            [sys.executable, str(ROOT / "tools/openclinxr/hair-groom"
                                 / "strands/interp_children.py"),
             "--outdir", str(tmp),
             "--guides", GUIDES[tag],
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
    calib = json.loads((E / "groom25cal-calib.json").read_text())
    gates = {"calibration": {
        "iou": calib["iou"],
        "all_within_0.02": bool(calib.get("all_within_0.02")),
        "pass": bool(calib.get("all_within_0.02")), "hard": True}}
    scores = {}
    for test in ("25a", "25b", "25c"):
        scores[test] = json.loads(
            (E / ("score25-%s.json" % test)).read_text())
    det = {}
    for tag in ("ctrl", "25a", "25b", "25c"):
        store = STORE / ("strands-%s.npz" % tag)
        d = np.load(str(store), allow_pickle=True)
        h0 = file_sha(str(store))
        a0 = arr_hash(np.asarray(d["points"]), np.asarray(d["radii"]))
        bj = json.loads((E / ("build-%s" % tag) / "build.json").read_text())
        assert bj["sha256"] == h0, (tag, bj["sha256"], h0)
        h1, a1 = rebuild_children(tag)
        det[tag] = {"storeSha": h0, "rebuildSha": h1,
                    "storeArrSha": a0, "rebuildArrSha": a1,
                    "pass": bool(h0 == h1 and a0 == a1)}
    gates["determinismChildren"] = {
        "v": det, "gate": "identical points+radii hash on rebuild",
        "pass": bool(all(v["pass"] for v in det.values())),
        "hard": True}
    # fairing determinism: re-run winner (25b) recipe, compare guide sha
    tmp = Path(tempfile.mkdtemp(prefix="g25-fair-"))
    try:
        r = subprocess.run(
            [sys.executable, str(ROOT / "tools/openclinxr/hair-groom"
                                 / "orient/s11_back_coherent.py"),
             "--guides", GUIDES["ctrl"], "--sdf", SDF, "--hull", HULL,
             "--outdir", str(tmp), "--stem", "guides-25b",
             "--anchor", "0.6"],
            capture_output=True, text=True, timeout=1200)
        if r.returncode != 0:
            raise RuntimeError("fairing rebuild failed: " + r.stderr[-2000:])
        h_orig = file_sha(str(E / "build-25b/guides-25b.npz"))
        h_new = file_sha(str(tmp / "guides-25b.npz"))
        gates["determinismFairing"] = {
            "origSha": h_orig, "rebuildSha": h_new,
            "pass": bool(h_orig == h_new), "hard": True}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    # front/temple byte-identical: non-BACK guides of guides-25b vs guides-19
    g19 = np.load(GUIDES["ctrl"], allow_pickle=True)
    g25 = np.load(GUIDES["25b"], allow_pickle=True)
    h19 = np.asarray(g19["curves_head"])
    h25 = np.asarray(g25["curves_head"])
    w19 = h19  # head-mm bits; compare non-BACK rows via fairing record
    fair = json.loads((E / "build-25b/guides-25b-fairing.json").read_text())
    gates["frontTempleIdentical"] = {
        "frontPass": bool(fair["frontIdentical"]["pass"]),
        "wZeroPass": bool(fair["wZeroIdentical"]["pass"]),
        "pass": bool(fair["frontIdentical"]["pass"]
                     and fair["wZeroIdentical"]["pass"]),
        "hard": True}
    for test in ("25a", "25b", "25c"):
        t = dict(scores[test]["gates25"])
        for tag in ("ctrl", test):
            e = dict(t[tag])
            e["determinism"] = det[tag]["pass"]
            hard = bool(e["hard"]["pass"] and det[tag]["pass"])
            e["hardWithDeterminism"] = hard
            gates["%s-vs-%s" % (tag, test)] = e
    gates["pass"] = bool(
        gates["calibration"]["pass"]
        and gates["determinismChildren"]["pass"]
        and gates["determinismFairing"]["pass"]
        and gates["frontTempleIdentical"]["pass"]
        and all(gates["%s-vs-%s" % (tag, test)]["hardWithDeterminism"]
                for test in ("25a", "25b", "25c") for tag in ("ctrl", test)))
    (E / "build").mkdir(exist_ok=True)
    (E / "build" / "gates25.json").write_text(
        json.dumps(gates, indent=1) + "\n")
    print(json.dumps(
        {k: (v.get("hardWithDeterminism", v.get("pass"))
             if isinstance(v, dict) else v)
         for k, v in gates.items()}, indent=1))
    if not gates["pass"]:
        raise SystemExit("GATES FAILED")


if __name__ == "__main__":
    main()
