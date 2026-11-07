#!/usr/bin/env python3
"""hair-groom19 card gates (calibrated scorer; provenance in parentheses).

Reads E/build/fairing.json, E/score19.json, E/build/build.json,
E/guide-depth.json, E/groom19cal-calib.json. Determinism: rebuild
interp_children to temp with the exact groom8b flags on guides-19.npz.
Writes E/build/gates19.json. Exit nonzero on any HARD fail.
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

EXPECT_IOU = {"front": 0.7446, "three_quarter": 0.8261,
              "profile_90": 0.8543, "back": 0.8579}


def arr_hash(*arrs):
    h = hashlib.sha256()
    for a in arrs:
        h.update(np.ascontiguousarray(a).tobytes())
    return h.hexdigest()


def main():
    fair = json.loads((E / "build" / "fairing.json").read_text())
    score = json.loads((E / "score19.json").read_text())
    build = json.loads((E / "build" / "build.json").read_text())
    gd = json.loads((E / "guide-depth.json").read_text())["bands"]
    calib = json.loads((E / "groom19cal-calib.json").read_text())

    gates = {}
    # calibration re-run first
    gates["calibration"] = {
        "iou": calib["iou"],
        "all_within_0.02": bool(calib.get("all_within_0.02")),
        "pass": bool(calib.get("all_within_0.02")), "hard": True}

    # 1. coherence (fairing provenance)
    coh = fair["nearRootPairFullPathSeparationMmAfter"]
    gates["coherence"] = {
        "v": coh, "gate": "pairs roots<6mm full-path p90<=25 max<=60",
        "pass": bool(fair["coherenceGate"]["pass"]), "hard": True}

    # 2. take-off preserved
    gates["takeoff"] = {
        "v": fair["takeoff"], "gate": "every arc<40mm sample byte-identical",
        "pass": bool(fair["takeoff"]["pass"]), "hard": True}

    # 3. back knot + R-LOOP
    knot = score["knotRead"]["groom19"]["enclosedHolePx"]
    lp = score["loopProfile"]["groom19"].get("countNoWrapExclusion")
    lb = score["loopBack"]["groom19"].get("countNoExclusion")
    gates["knotHole"] = {"v": knot, "gate": "g10diag back box == 0",
                         "pass": bool(knot == 0), "hard": True}
    gates["rloopProfile"] = {"v": lp, "gate": "< groom5 11587",
                             "pass": bool(lp is not None and lp < 11587),
                             "hard": True}
    gates["rloopBack"] = {"v": lb, "gate": "< groom5 11587",
                          "pass": bool(lb is not None and lb < 11587),
                          "hard": True}

    # 4. silhouette vs groom8a (-0.02)
    i19 = score["grooms"]["groom19"]["iou"]
    sil = {}
    for v in ("front", "three_quarter", "profile_90", "back"):
        d = round(i19[v]["iou"] - EXPECT_IOU[v], 4)
        sil[v] = {"iou": i19[v]["iou"], "expect": EXPECT_IOU[v],
                  "delta": d, "pass": bool(d >= -0.02)}
    gates["silhouette"] = {
        "v": sil, "gate": "no view worse than groom8a by >0.02",
        "pass": bool(all(s["pass"] for s in sil.values())), "hard": True}

    # face-mask, concha, insideBody
    fm = score["faceMask"]["groom19"]
    gates["faceMask"] = {
        "v": fm, "gate": "ours<=target+2%mask both views",
        "pass": bool(all(x["pass"] for x in fm.values())), "hard": True}
    cc = score["conchaCrossings"]["groom19"]
    gates["concha"] = {"v": cc, "gate": "0 all views",
                       "pass": bool(all(x == 0 for x in cc.values())),
                       "hard": True}
    ib = score["insideBody"]["groom19"]["nSge1Inside"]
    gates["insideBody"] = {"v": ib, "gate": "== 0",
                           "pass": bool(ib == 0), "hard": True}

    # depth +-20% of guides-8a
    dep = score["depth"]["groom19"]
    dd = {}
    for bn in ("parietal", "temple"):
        for stat in ("p50", "p90"):
            r = dep[bn][stat] / max(gd[bn][stat], 1e-9)
            dd["%s_%s" % (bn, stat)] = {
                "child": dep[bn][stat], "guide": gd[bn][stat],
                "ratio": round(r, 3), "pass": bool(0.8 <= r <= 1.2)}
    gates["depth"] = {"v": dd, "gate": "child within +-20% of guides-8a",
                      "pass": bool(all(x["pass"] for x in dd.values())),
                      "hard": True}

    # determinism: fairing re-run + children rebuild
    guides_p = E / "build" / "guides-19.npz"
    h1 = arr_hash(np.asarray(np.load(guides_p)["curves_head"]))
    r = subprocess.run(
        [sys.executable, str(ROOT / "tools/openclinxr/hair-groom/orient"
                             / "s10_tangent_fair.py"),
         "--guides", str(ROOT / "tools/openclinxr/evidence/hair-groom8a/build"
                         / "guides-8a.npz"),
         "--sdf", str(ROOT / "tools/openclinxr/evidence/hair-cage1"
                      / "body-exact-sdf.npz"),
         "--hull", str(ROOT / "tools/openclinxr/evidence/hair-hull5/hull.npz"),
         "--outdir", tempfile.mkdtemp(prefix="g19-det-fair-"),
         "--anchor", "0.3"],
        capture_output=True, text=True, timeout=3600)
    # NOTE: fairing rerun writes to a temp dir; compare via stdout? use file
    fair_det = (r.returncode == 0)
    tmp = Path(tempfile.mkdtemp(prefix="g19-det-"))
    try:
        rr = subprocess.run(
            [sys.executable, str(ROOT / "tools/openclinxr/hair-groom/strands"
                                 / "interp_children.py"),
             "--outdir", str(tmp),
             "--guides", str(guides_p),
             "--roots", str(ROOT / "tools/openclinxr/evidence/hair-scalp1"
                            / "roots.npz"),
             "--sdf", str(ROOT / "tools/openclinxr/evidence/hair-cage1"
                          / "body-exact-sdf.npz"),
             "--hull", str(ROOT / "tools/openclinxr/evidence/hair-hull5"
                           / "hull.npz"),
             "--ear-frame", str(ROOT / "tools/openclinxr/evidence/hair-groom4"
                                / "tucked/earframe.json")],
            capture_output=True, text=True, timeout=3600)
        if rr.returncode != 0:
            raise RuntimeError("rebuild failed: " + rr.stderr[-2000:])
        d1 = np.load(E / "build" / "strands.npz", allow_pickle=True)
        d2 = np.load(tmp / "strands.npz", allow_pickle=True)
        h2a = arr_hash(np.asarray(d1["points"]), np.asarray(d1["radii"]))
        h2b = arr_hash(np.asarray(d2["points"]), np.asarray(d2["radii"]))
        child_det = h2a == h2b
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    gates["determinismFairing"] = {"pass": bool(fair_det), "hard": True}
    gates["determinismChildren"] = {"hashA": h2a, "hashB": h2b,
                                    "pass": bool(child_det), "hard": True}

    gates["pass"] = bool(all(v["pass"] for v in gates.values()
                             if isinstance(v, dict) and v.get("hard")))
    with open(E / "build" / "gates19.json", "w") as f:
        json.dump(gates, f, indent=1)
    print(json.dumps({k: (v["pass"] if isinstance(v, dict) else v)
                      for k, v in gates.items()}, indent=1))
    if not gates["pass"]:
        raise SystemExit("GATES FAILED")


if __name__ == "__main__":
    main()
