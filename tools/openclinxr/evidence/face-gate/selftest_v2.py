#!/usr/bin/env python3
"""Self-test for face_gate_v2.py (deterministic, LLM-free).

(a) target vs itself passes G8, G9, G10.
(b) target-flat vs target: every new quantity (noise floor); verifies each
    threshold formula's max()/1.5x floor is wider than the pair difference.
(c) ../solve/final-front.png must FAIL G9 (exit-gating). G10 is evaluated
    against the same known-bad: as specified it PASSES the known-bad
    (target sclera mask is redder than any render's: makeup/liner), so a
    G10 non-fail is recorded as VACUOUS-AS-SPECIFIED with full numbers and
    does not gate the exit code; see RESULT-v2.md.
(d) synthetic G8 negative: target upper lip darkened by 20 L -> G8 fails.
(e) synthetic G9 negative: 12px near-white 3px-tall line on the target
    aperture -> G9 fails.
(f) determinism: 3x detect_points on the target; max abs difference per
    new quantity + the tool's median-of-3 residual jitter.

Writes out-v2/selftest.json. Exit 0 iff (a),(c-G9),(d),(e) hold.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
import face_gate as v1
from face_gate_v2 import (aperture_scan, detect_median, eye_measure,
                          g8_verdict, g10_verdict, lab_of, lip_split)

TARGET = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "target-views",
                                       "target-front.png"))
FLAT = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "target-views",
                                     "target-flat-front.png"))
FINAL = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "solve",
                                      "final-front.png"))
OUT = os.path.join(SCRIPT_DIR, "out-v2")


def measures(landmarker, path):
    rgb = v1.load_rgb(path)
    h, w = rgb.shape[:2]
    q, jit = detect_median(landmarker, Image.fromarray(rgb))
    _, L, A, B, ch = lab_of(rgb)
    sp = lip_split(L, q, w, h)
    ap = aperture_scan(L, ch, q, w, h, sp["LLo"])
    ey = eye_measure(L, A, B, q, w, h)
    return {"rgb": rgb, "q": q, "jit": jit, "split": sp, "ap": ap, "eyes": ey}


def main():
    os.makedirs(OUT, exist_ok=True)
    lm = v1.create_landmarker()
    out = {}
    T = measures(lm, TARGET)
    F = measures(lm, FLAT)
    R = measures(lm, FINAL)

    # (a) self.
    g8s = g8_verdict(T["split"], T["split"], F["split"])
    g9s = {"pass": T["ap"]["maxrun"] < 3, "maxrun": T["ap"]["maxrun"]}
    g10s = g10_verdict(T["eyes"], T["eyes"], F["eyes"])
    out["a_self"] = {"G8": g8s, "G9": g9s, "G10": g10s,
                     "pass": bool(g8s["pass"] and g9s["pass"]
                                  and g10s["pass"])}

    # (b) noise floor: every new quantity + threshold-vs-difference check.
    d_dL = abs(T["split"]["dL"] - F["split"]["dL"])
    sclA_t = (T["eyes"]["A"]["sclA"] + T["eyes"]["B"]["sclA"]) / 2.0
    sclA_f = (F["eyes"]["A"]["sclA"] + F["eyes"]["B"]["sclA"]) / 2.0
    d_scl = abs(sclA_t - sclA_f)
    g8f = g8_verdict(F["split"], T["split"], F["split"])
    g10f = g10_verdict(F["eyes"], T["eyes"], F["eyes"])
    out["b_noise_floor"] = {
        "dL_target": T["split"]["dL"], "dL_flat": F["split"]["dL"],
        "dL_diff": d_dL, "dL_thr_formula": g8f["dL_thr"],
        "thr_wider_than_noise": bool(g8f["dL_thr"] > d_dL),
        "thr_note": ("formula max(4, 1.5*%.3f=%.3f): floor 4 applies, "
                     "wider than noise %.3f" % (d_dL, 1.5 * d_dL, d_dL)),
        "sdUp_target": T["split"]["sdUp"], "sdUp_flat": F["split"]["sdUp"],
        "sdLo_target": T["split"]["sdLo"], "sdLo_flat": F["split"]["sdLo"],
        "sclA_target": sclA_t, "sclA_flat": sclA_f, "sclA_diff": d_scl,
        "sclA_thr_above_target": g10f["sclA_thr"] - sclA_t,
        "sclA_note": ("formula max(3, 1.5*%.3f=%.3f): floor 3 applies"
                      % (d_scl, 1.5 * d_scl)),
        "G9_target_maxrun": T["ap"]["maxrun"],
        "G9_flat_maxrun": F["ap"]["maxrun"],
        "G9_note": "brief constants (+25/8/3px) hold for both (maxrun 0)",
        "flat_G8_pass": g8f["pass"], "flat_G10_pass": g10f["pass"]}

    # (c) known-bad.
    g8r = g8_verdict(R["split"], T["split"], F["split"])
    g9r = {"pass": bool(R["ap"]["maxrun"] < 3), "maxrun": R["ap"]["maxrun"],
           "peakL": R["ap"]["peakL"], "thr": R["ap"]["thr"],
           "nbad": R["ap"]["nbad"]}
    g10r = g10_verdict(R["eyes"], T["eyes"], F["eyes"])
    g10_vacuous = bool(g10r["pass"])
    out["c_known_bad"] = {
        "G8": g8r, "G9": g9r, "G10": g10r,
        "G9_fails": bool(not g9r["pass"]),
        "G10_fails": bool(not g10r["pass"]),
        "G10_vacuous_as_specified": g10_vacuous,
        "G10_note": ("target sclera a* (%.2f) redder than final (%.2f): "
                     "mean-a* construction cannot fail it; target catch "
                     "required=%s" % (g10r["sclA_target"],
                                      g10r["sclA_render"],
                                      g10r["catch_required_eyes"] or "none"))}

    # (d) synthetic G8 negative: darken target upper lip by 20 L.
    from skimage.color import lab2rgb, rgb2lab  # noqa
    h, w = T["rgb"].shape[:2]
    q = T["q"]
    xx0, yy0 = float(q[78][0]), float(q[78][1])
    xx1, yy1 = float(q[308][0]), float(q[308][1])
    if xx0 > xx1:
        xx0, yy0, xx1, yy1 = xx1, yy1, xx0, yy0
    xs = np.arange(int(round(xx0)), int(round(xx1)) + 1)
    ys = yy0 + (yy1 - yy0) * (xs - xx0) / max(xx1 - xx0, 1e-9)
    line_y = np.full(w, np.nan)
    line_y[np.clip(xs, 0, w - 1)] = ys
    yy, xx = np.mgrid[0:h, 0:w]
    outer = np.array([q[i] for i in v1.INDICES["lips_outer"]])
    inner = np.array([q[i] for i in v1.INDICES["lips_inner"]])
    lipm = np.zeros((h, w), np.uint8)
    import cv2
    cv2.fillPoly(lipm, [outer.astype(np.int32)], 1)
    hole = np.zeros((h, w), np.uint8)
    cv2.fillPoly(hole, [inner.astype(np.int32)], 1)
    lipm = lipm * (1 - hole)
    upmask = np.logical_and(lipm > 0, yy < line_y[xx])
    lab = rgb2lab(T["rgb"].astype(np.float64) / 255.0)
    lab[:, :, 0][upmask] = np.clip(lab[:, :, 0][upmask] - 20.0, 0, 100)
    neg8 = np.clip(lab2rgb(lab) * 255.0, 0, 255).astype(np.uint8)
    _, Ln8, _, _, _ = lab_of(neg8)
    sp8 = lip_split(Ln8, q, w, h)
    g8n = g8_verdict(sp8, T["split"], F["split"])
    out["d_synth_G8"] = {"G8": g8n, "fails": bool(not g8n["pass"])}

    # (e) synthetic G9 negative: 12px near-white 3px-tall aperture line.
    neg9 = T["rgb"].copy()
    xm = (int(round(xx0)) + int(round(xx1))) // 2
    ym = int(round((yy0 + yy1) / 2.0))
    neg9[ym - 1:ym + 2, xm - 6:xm + 6] = (235, 233, 230)
    _, Ln9, _, _, ch9 = lab_of(neg9)
    sp9 = lip_split(Ln9, q, w, h)
    ap9 = aperture_scan(Ln9, ch9, q, w, h, sp9["LLo"])
    out["e_synth_G9"] = {"maxrun": ap9["maxrun"], "peakL": ap9["peakL"],
                         "thr": ap9["thr"], "nbad": ap9["nbad"],
                         "fails": bool(ap9["maxrun"] >= 3)}

    # (f) determinism: 3x raw detections, max abs diff per new quantity.
    runs = []
    for _ in range(3):
        qq = v1.detect_points(lm, Image.fromarray(T["rgb"]))
        _, Lq, Aq, Bq, chq = lab_of(T["rgb"])
        spq = lip_split(Lq, qq, w, h)
        apq = aperture_scan(Lq, chq, qq, w, h, spq["LLo"])
        eyq = eye_measure(Lq, Aq, Bq, qq, w, h)
        runs.append({"dL": spq["dL"], "sdUp": spq["sdUp"],
                     "sdLo": spq["sdLo"], "maxrun": apq["maxrun"],
                     "peakL": apq["peakL"],
                     "sclA": (eyq["A"]["sclA"] + eyq["B"]["sclA"]) / 2.0})
    spread = {}
    for k in ("dL", "sdUp", "sdLo", "maxrun", "peakL", "sclA"):
        vs = [rr[k] for rr in runs]
        spread[k] = max(vs) - min(vs)
    out["f_determinism"] = {
        "runs": runs, "max_abs_diff_per_quantity": spread,
        "median_tool_jitter_px": {"target": T["jit"]["jitter_px"],
                                  "flat": F["jit"]["jitter_px"],
                                  "final": R["jit"]["jitter_px"]},
        "jitter_note": ("median-of-3 inside the tool; residual jitter "
                        "above")}

    with open(os.path.join(OUT, "selftest.json"), "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
        f.write("\n")

    print("== (a) self: G8=%s G9=%s(maxrun %d) G10=%s -> %s" % (
        g8s["pass"], g9s["pass"], g9s["maxrun"], g10s["pass"],
        "PASS" if out["a_self"]["pass"] else "FAIL"))
    print("== (b) noise: dL_t=%.3f dL_f=%.3f diff=%.3f thr=%.3f wider=%s" % (
        T["split"]["dL"], F["split"]["dL"], d_dL, g8f["dL_thr"],
        out["b_noise_floor"]["thr_wider_than_noise"]))
    print("   sdUp t/f=%.2f/%.2f sdLo t/f=%.2f/%.2f sclA t/f=%.2f/%.2f "
          "thr+=%.2f G9runs t/f=%d/%d" % (
              T["split"]["sdUp"], F["split"]["sdUp"], T["split"]["sdLo"],
              F["split"]["sdLo"], sclA_t, sclA_f,
              g10f["sclA_thr"] - sclA_t, T["ap"]["maxrun"],
              F["ap"]["maxrun"]))
    print("== (c) final-front: G9 %s(run=%d peak=%.1f thr=%.1f) G8 %s "
          "(ddL=%.2f thr=%.2f) G10 %s(a*=%.2f thr=%.2f catch-req=%s)" % (
              "FAIL" if not g9r["pass"] else "pass", g9r["maxrun"],
              g9r["peakL"], g9r["thr"],
              "FAIL" if not g8r["pass"] else "pass", g8r["dL_diff"],
              g8r["dL_thr"], "FAIL" if not g10r["pass"] else "PASS(vacuous)",
              g10r["sclA_render"], g10r["sclA_thr"],
              g10r["catch_required_eyes"] or "none"))
    print("== (d) synth-G8 (upper -20L): %s (ddL=%.2f thr=%.2f)" % (
        "FAIL" if out["d_synth_G8"]["fails"] else "PASS?!",
        g8n["dL_diff"], g8n["dL_thr"]))
    print("== (e) synth-G9 (12px white line): %s (run=%d peak=%.1f)" % (
        "FAIL" if out["e_synth_G9"]["fails"] else "PASS?!",
        ap9["maxrun"], ap9["peakL"]))
    print("== (f) determinism max-abs-diff: %s" % (
        {k: round(float(v), 4) for k, v in spread.items()}))
    print("   median-tool jitter px: tgt=%s flat=%s final=%s" % (
        T["jit"]["jitter_px"], F["jit"]["jitter_px"], R["jit"]["jitter_px"]))
    ok = bool(out["a_self"]["pass"] and out["c_known_bad"]["G9_fails"]
              and out["d_synth_G8"]["fails"] and out["e_synth_G9"]["fails"])
    print("SELFTEST %s%s" % ("PASS" if ok else "FAIL",
                             " (G10 recorded vacuous-as-specified)"
                             if g10_vacuous else ""))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
