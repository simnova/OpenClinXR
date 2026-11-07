#!/usr/bin/env python3
"""hair-groom20 card gates (calibrated scorer; provenance in parentheses).

Reads E/build/fairing.json, E/score20.json, E/build/build.json,
E/groom20cal-calib.json. Determinism: rerun s10 fairing to temp with the
exact card flags on guides-8a+guides-19; rebuild interp_children to temp
with the exact groom8b flags on guides-20.npz.
Writes E/build/gates20.json. Exit nonzero on any HARD fail.
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


def arr_hash(*arrs):
    h = hashlib.sha256()
    for a in arrs:
        h.update(np.ascontiguousarray(a).tobytes())
    return h.hexdigest()


def main():
    fair = json.loads((E / "build" / "fairing.json").read_text())
    score = json.loads((E / "score20.json").read_text())
    build = json.loads((E / "build" / "build.json").read_text())
    calib = json.loads((E / "groom20cal-calib.json").read_text())

    gates = {}
    gates["calibration"] = {
        "iou": calib["iou"],
        "all_within_0.02": bool(calib.get("all_within_0.02")),
        "pass": bool(calib.get("all_within_0.02")), "hard": True}

    # BACK coherence (fairing provenance)
    coh = fair["nearRootPairFullPathSeparationMmAfterBACK"]
    gates["coherenceBACK"] = {
        "v": coh,
        "gate": "BACK pairs roots<6mm full-path p90<=25 max<=60",
        "pass": bool(fair["coherenceGateBACK"]["pass"]), "hard": True}

    # take-off + front-identical
    gates["takeoffBACK"] = {
        "v": fair["takeoffBACK"],
        "gate": "every BACK arc<15mm sample byte-identical to guides-8a",
        "pass": bool(fair["takeoffBACK"]["pass"]), "hard": True}
    gates["frontIdentical"] = {
        "v": fair["frontIdentical"],
        "gate": "every FRONT guide byte-identical to guides-19",
        "regionSplit": fair["regionSplit"],
        "pass": bool(fair["frontIdentical"]["pass"]), "hard": True}

    # back knot + R-LOOP
    knot = score["knotRead"]["groom20"]["enclosedHolePx"]
    lp = score["loopProfile"]["groom20"].get("countNoWrapExclusion")
    lb = score["loopBack"]["groom20"].get("countNoExclusion")
    gates["knotHole"] = {"v": knot, "gate": "g10diag back box == 0",
                         "pass": bool(knot == 0), "hard": True}
    gates["rloopProfile"] = {"v": lp, "gate": "< groom5 11587",
                             "pass": bool(lp is not None and lp < 11587),
                             "hard": True}
    gates["rloopBack"] = {"v": lb, "gate": "< groom5 11587",
                          "pass": bool(lb is not None and lb < 11587),
                          "hard": True}

    # silhouette gates per card: back>=0.84, profile>=0.83, front>=0.77, 3q>=0.82
    i20 = score["grooms"]["groom20"]["iou"]
    sil = {}
    for v, th in (("front", 0.77), ("three_quarter", 0.82),
                  ("profile_90", 0.83), ("back", 0.84)):
        sil[v] = {"iou": i20[v]["iou"], "gate": th,
                  "delta": round(i20[v]["iou"] - th, 4),
                  "pass": bool(i20[v]["iou"] >= th)}
    gates["silhouette"] = {
        "v": sil,
        "gate": "back>=0.84 profile>=0.83 front>=0.77 3q>=0.82",
        "pass": bool(all(s["pass"] for s in sil.values())), "hard": True}

    # face-mask front only per card + concha + insideBody
    fm = score["faceMask"]["groom20"]
    gates["faceMaskFront"] = {
        "v": fm["front"], "gate": "front ours<=target+2%mask",
        "pass": bool(fm["front"]["pass"]), "hard": True}
    cc = score["conchaCrossings"]["groom20"]
    gates["concha"] = {"v": cc, "gate": "0 all views",
                       "pass": bool(all(x == 0 for x in cc.values())),
                       "hard": True}
    ib = score["insideBody"]["groom20"]["nSge1Inside"]
    gates["insideBody"] = {"v": ib, "gate": "== 0",
                           "pass": bool(ib == 0), "hard": True}

    # determinism: fairing re-run + children rebuild
    guides_p = E / "build" / "guides-20.npz"
    h1 = arr_hash(np.asarray(np.load(guides_p)["curves_head"]))
    with tempfile.TemporaryDirectory(prefix="g20-det-fair-") as td:
        r = subprocess.run(
            [sys.executable, str(ROOT / "tools/openclinxr/hair-groom/orient"
                                 / "s10_tangent_fair.py"),
             "--guides", str(ROOT / "tools/openclinxr/evidence/hair-groom8a/build"
                             / "guides-8a.npz"),
             "--guides19", str(ROOT / "tools/openclinxr/evidence/hair-groom19/build"
                               / "guides-19.npz"),
             "--sdf", str(ROOT / "tools/openclinxr/evidence/hair-cage1"
                          / "body-exact-sdf.npz"),
             "--hull", str(ROOT / "tools/openclinxr/evidence/hair-hull5"
                           / "hull.npz"),
             "--outdir", td,
             "--anchor", "0.3"],
            capture_output=True, text=True, timeout=3600)
        fair_det = (r.returncode == 0)
        if fair_det:
            h1b = arr_hash(np.asarray(np.load(Path(td) / "guides-20.npz")["curves_head"]))
            fair_det = (h1b == h1)
    tmp = Path(tempfile.mkdtemp(prefix="g20-det-"))
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

    # falsifier record: fires only if coherence passes AND knot remains in raw
    gates["falsifier"] = {
        "v": {"coherenceBACKPass": bool(fair["coherenceGateBACK"]["pass"])},
        "gate": "FIRES iff BACK coherence passes and crossing locks remain "
                "in the raw interpolation (render BACK guides in knot box "
                "coloured by id and stop)",
        "pass": True}

    gates["pass"] = bool(all(v["pass"] for v in gates.values()
                             if isinstance(v, dict) and v.get("hard")))
    with open(E / "build" / "gates20.json", "w") as f:
        json.dump(gates, f, indent=1)
    print(json.dumps({k: (v["pass"] if isinstance(v, dict) else v)
                      for k, v in gates.items()}, indent=1))
    if not gates["pass"]:
        raise SystemExit("GATES FAILED")


if __name__ == "__main__":
    main()
