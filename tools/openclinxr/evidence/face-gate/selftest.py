#!/usr/bin/env python3
"""Self-test for face_gate.py (deterministic, LLM-free).

(a) target vs itself: every clause passes with zero deltas.
(b) target-flat-front vs target-front: all deltas = NOISE FLOOR.
(c) target with HSV saturation x1.6 must FAIL skinPass via C2/C3/C4.
(d) horizontally mirrored target: skinPass must pass; C6 reported separately
    (a mirror flips lighting direction, so a direction-sensitive C6 fails).
(e) every render listed in the brief + clause table.

Writes selftest.json into the gate out dir. Run AFTER face_gate.py CLI so
report.json exists, or pass --run-cli to run it first (not needed here).
"""
import json
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
from face_gate import (THRESHOLDS, clause_cells, compare_pair,
                       create_landmarker, load_rgb, round_clauses,
                       round_stats)

TARGET = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "target-views",
                                       "target-front.png"))
FLAT = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "target-views",
                                     "target-flat-front.png"))
RENDERS = [
    "../variants-product/p0-shipped-front.png",
    "../variants-product/p1-graded-front.png",
    "../variants-product/v5-toigo_light_skin_with_natural_makeup-front.png",
    "../variants-product/v5-toigo_light_skin_female_with_violet_makeup-front.png",
    "../realism-95/shader/aisha-fine-b-s2.00-v0.92-l1.png",
    "../realism-95/upscale/aisha-detail-still.png",
]
OUT = os.path.join(SCRIPT_DIR, "out")
TMP = os.path.join(OUT, "selftest_tmp")


def r3(x):
    return None if x is None else round(float(x), 3)


def sat_boost(rgb, factor=1.6):
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(np.float64)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * factor, 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB)


def main():
    os.makedirs(TMP, exist_ok=True)
    report = json.load(open(os.path.join(OUT, "report.json")))
    landmarker = create_landmarker()
    target_rgb = load_rgb(TARGET)
    out = {}

    # (a) self-comparison from the CLI report.
    self_cl = report["self"]["clauses"]

    def leaf_values(cl):
        vals = {}
        for r, v in cl["C1"]["regions"].items():
            if isinstance(v, dict):
                vals["C1." + r] = v["value"]
        vals["C1.assignment"] = cl["C1"].get("assignment")
        vals["C1.max"] = cl["C1"]["value"]
        vals["C2.a_spread"] = cl["C2"]["a_spread"]["value"]
        vals["C2.L_spread"] = cl["C2"]["L_spread"]["value"]
        vals["C3.a_diff"] = cl["C3"]["a_diff"]["value"]
        vals["C3.b_diff"] = cl["C3"]["b_diff"]["value"]
        vals["C3.L_ratio"] = cl["C3"]["L_ratio"]["value"]
        vals["C4"] = cl["C4"]["value"]
        vals["C5"] = cl["C5"]["value"]
        # C6 stored as delta from the target's own value (absolute target
        # value lives in cl["C6"]["target_value"]); self-comparison is 0.
        vals["C6"] = cl["C6"]["value"] - cl["C6"]["target_value"]
        vals["C6_target_value"] = cl["C6"]["target_value"]
        return vals

    a_vals = leaf_values(self_cl)
    out["a_self"] = {"clauses": self_cl, "skinPass": report["self"]["skinPass"],
                     "lightingPass": report["self"]["lightingPass"],
                     # Cross-assignment C1 _vs_ entries are search candidates,
                     # not deltas: excluded from the zero check.
                     "all_zero": all(abs(v or 0) < 1e-6 for k, v in
                                     a_vals.items()
                                     if isinstance(v, (int, float))
                                     and "_vs_" not in k
                                     and k != "C6_target_value"),
                     "pass": bool(report["self"]["skinPass"] and
                                  report["self"]["lightingPass"])}

    # (b) noise floor from flat-front.
    flat_entry = report["renders"]["target-flat-front"]
    b_vals = leaf_values(flat_entry["clauses"])
    tight = []
    checks = [("C1.forehead", "C1_de2000"), ("C1.max", "C1_de2000"),
              ("C2.a_spread", "C2a_abstol"), ("C2.L_spread", "C2b_abstol"),
              ("C3.a_diff", "C3a_abstol"), ("C3.b_diff", "C3b_abstol"),
              ("C3.L_ratio", "C3ratio_abstol"), ("C4", "C4_abstol"),
              ("C5", "C5_abstol")]
    for leaf, thr in checks:
        if abs(b_vals[leaf]) >= THRESHOLDS[thr]["value"]:
            tight.append({"leaf": leaf, "noise_floor": b_vals[leaf],
                          "threshold": THRESHOLDS[thr]["value"]})
    out["b_noise_floor"] = {"render": "target-flat-front",
                            "clauses": flat_entry["clauses"],
                            "skinPass": flat_entry["skinPass"],
                            "lightingPass": flat_entry["lightingPass"],
                            "leaf_values": b_vals,
                            "thresholds_tighter_than_noise": tight}

    # (c) saturation x1.6 must FAIL skinPass via C2/C3/C4.
    sat_rgb = sat_boost(target_rgb)
    sat_path = os.path.join(TMP, "target-sat1.6.png")
    Image.fromarray(sat_rgb).save(sat_path)
    cmp_c = compare_pair(landmarker, target_rgb, sat_rgb)
    cl_c = round_clauses(cmp_c["clauses"])
    via = [k for k in ("C2", "C3", "C4") if not cmp_c["clauses"][k]["pass"]]
    out["c_sat1.6"] = {"clauses": cl_c,
                       "skinPass": cmp_c["clauses"]["skinPass"],
                       "failed_via_C2_C3_C4": via,
                       "required_fail": True,
                       "pass": bool(not cmp_c["clauses"]["skinPass"] and via),
                       "vacuous": bool(cmp_c["clauses"]["skinPass"])}

    # (d) mirror must pass skinPass (C6 reported separately).
    mir_rgb = np.asarray(Image.fromarray(target_rgb).transpose(
        Image.FLIP_LEFT_RIGHT))
    mir_path = os.path.join(TMP, "target-mirror.png")
    Image.fromarray(mir_rgb).save(mir_path)
    cmp_d = compare_pair(landmarker, target_rgb, mir_rgb)
    cl_d = round_clauses(cmp_d["clauses"])
    out["d_mirror"] = {"clauses": cl_d,
                       "skinPass": cmp_d["clauses"]["skinPass"],
                       "lightingPass": cmp_d["clauses"]["lightingPass"],
                       "note": "mirror flips lighting direction; C6 fail is "
                               "correct direction-sensitive behaviour",
                       "pass": bool(cmp_d["clauses"]["skinPass"])}

    # (e) render table from the CLI report.
    rows = []
    for rel in RENDERS:
        stem = os.path.splitext(os.path.basename(rel))[0]
        e = report["renders"][stem]
        rows.append({"render": stem, "scale": e["alignment"]["scale"],
                     "upscaled": e["alignment"]["upscaled"],
                     "cells": clause_cells(e["clauses"]),
                     "skinPass": e["skinPass"],
                     "lightingPass": e["lightingPass"]})
    out["e_renders"] = rows

    # (f) multi-render CLI: every --render (repeated flags) produces a row.
    f_out = os.path.join(TMP, "multi_render")
    f_renders = [TARGET, FLAT,
                 os.path.normpath(os.path.join(SCRIPT_DIR, RENDERS[0]))]
    cmd = [sys.executable, os.path.join(SCRIPT_DIR, "face_gate.py"),
           "--target", TARGET, "--out", f_out]
    for rp in f_renders:
        cmd += ["--render", rp]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    f_rep = json.load(open(os.path.join(f_out, "report.json"))) \
        if proc.returncode == 0 else {"renders": {}}
    f_names = sorted(f_rep.get("renders", {}).keys())
    out["f_multi_render"] = {
        "cmd_renders": len(f_renders), "rows": f_names,
        "pass": bool(proc.returncode == 0 and
                     len(f_rep.get("renders", {})) == len(f_renders))}

    with open(os.path.join(OUT, "selftest.json"), "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
        f.write("\n")

    print("== (a) self: skin=%s light=%s all_zero=%s" % (
        out["a_self"]["skinPass"], out["a_self"]["lightingPass"],
        out["a_self"]["all_zero"]))
    print("== (b) noise floor (flat-front): skin=%s light=%s" % (
        flat_entry["skinPass"], flat_entry["lightingPass"]))
    for k, v in b_vals.items():
        print("   %-28s %s" % (k, ("%.3f" % v) if isinstance(
            v, (int, float)) else v))
    print("   thresholds tighter than noise: %s" %
          (tight if tight else "none"))
    print("== (c) sat1.6: skinPass=%s failed_via=%s vacuous=%s cells=%s" % (
        out["c_sat1.6"]["skinPass"], via, out["c_sat1.6"]["vacuous"],
        clause_cells(cmp_c["clauses"])))
    print("== (d) mirror: skinPass=%s lightingPass=%s cells=%s" % (
        out["d_mirror"]["skinPass"], out["d_mirror"]["lightingPass"],
        clause_cells(cmp_d["clauses"])))
    print("== (e) renders:")
    for r in rows:
        print("   %-50s scale=%.3f%s skin=%s light=%s" % (
            r["render"], r["scale"], " UP" if r["upscaled"] else "",
            r["skinPass"], r["lightingPass"]))
        for k, v in r["cells"].items():
            print("      %s: %s" % (k, v))
    print("== (f) multi-render: rows=%s pass=%s" % (
        out["f_multi_render"]["rows"], out["f_multi_render"]["pass"]))
    ok = out["a_self"]["pass"] and out["c_sat1.6"]["pass"] and \
        out["d_mirror"]["pass"] and out["f_multi_render"]["pass"]
    print("SELFTEST %s" % ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
