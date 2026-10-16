"""Build identity-report.json (card tsk_2c547dda8753bba0).

Reads fit-report.json (M1 known-goods), the store stage records (applied /
unapplied / FACE_TARGETS_APPLY counts), and identity_gate.py outputs for
prefix (pre-fix run1/run2) and postfix (post-fix run3/run4) runs plus the
cross-subject M2 pairs and 0.8x-rescale noise probes. Writes
tools/openclinxr/evidence/face-fit/identity-report.json with every threshold
beside its source.

Gate JSON layout (this builder's convention, written by hand at gating time):
  /tmp/st-identity/gate-<case>-<prefix|postfix>-<run1|run2>.json  (identity_gate.py --out)
  /tmp/st-identity/cross-<rendercase>-<side>-vs-<goalcase>.json    (identity_gate.py --goal-case; m2 only)
  /tmp/st-identity/rescale-<case>.json                            ({"noise": <m2 redetect delta>})

Usage:
  mise exec -C /Volumes/files/src/openclinxr -- python3 \
    tools/openclinxr/evidence/face-fit/build_identity_report.py
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
D = HERE
G = "/tmp/st-identity"
STORE_CASES = "/Volumes/files/openclinxr-assets/store/face-station-cases"

D5 = ("the aisha goal (S/project/edit-v9/edit-0.png) is an edit of an aisha render "
      "(reference-set manifest.json:7 keeps the render pixel-for-pixel, only the surface changes), "
      "so the aisha pair is close partly by construction")


def load_gate(name):
    with open(os.path.join(G, name)) as f:
        return json.load(f)


def mean(xs):
    return sum(xs) / len(xs)


def main():
    fit_report = json.load(open(os.path.join(D, "fit-report.json")))
    cases = {}
    for case in ("body2", "aisha"):
        fit_case = fit_report["cases"][case]
        pre = [load_gate("gate-%s-prefix-run1.json" % case),
               load_gate("gate-%s-prefix-run2.json" % case)]
        post = [load_gate("gate-%s-postfix-run1.json" % case),
                load_gate("gate-%s-postfix-run2.json" % case)]
        pre_m1 = mean([g["m1Mm"] for g in pre])
        post_m1 = mean([g["m1Mm"] for g in post])
        pre_m2 = mean([g["m2"] for g in pre])
        post_m2 = mean([g["m2"] for g in post])

        # Stage records: applied / unapplied / log proof (postfix runs).
        store_runs = {"prefix": ["run1", "run2"], "postfix": ["run3", "run4"]}
        applied = None
        unapplied = None
        big_detail = ""
        for run in store_runs["postfix"]:
            rec = json.load(open(os.path.join(
                STORE_CASES, case, run, "stage-records.json")))
            s4 = next(s for s in rec["stages"] if s["stage"] == 4)
            ff = s4["extra"]["faceFit"]
            assert s4["gate"]["pass"] and ff["logVerified"], (case, run)
            if applied is None:
                applied = ff["applied"]
                unapplied = ff["unapplied"]
                big_detail = ff["bigDetail"]
            else:
                assert [a["name"] for a in ff["applied"]] == [a["name"] for a in applied], (case, run)

        # M1 threshold: known-good = fitter's own rmsAfterMm; known-bad = M1 on
        # the pre-fix bake; midpoint; enforced only when margin/noise >= 1.
        kg_m1 = float(fit_case["rmsAfterMm"])
        m1_noise = abs(post[0]["m1Mm"] - post[1]["m1Mm"])
        m1_margin = abs(pre_m1 - kg_m1)
        m1_threshold = (kg_m1 + pre_m1) / 2.0
        m1_enforced = (m1_margin / m1_noise >= 1.0) if m1_noise > 0 else True

        cases[case] = {
            "fit": {
                "rmsBeforeMm": float(fit_case["rmsBeforeMm"]),
                "rmsAfterMm": kg_m1,
                "source": "tools/openclinxr/evidence/face-fit/fit-report.json:cases.%s" % case,
            },
            "prefix": {"run1": pre[0], "run2": pre[1]},
            "postfix": {"run1": post[0], "run2": post[1]},
            "storeRuns": store_runs,
            "applied": applied,
            "unapplied": unapplied,
            "bigDetail": big_detail,
            "thresholds": {
                "m1": {
                    "knownGood": {"value": kg_m1,
                                 "source": "tools/openclinxr/evidence/face-fit/fit-report.json:cases.%s.rmsAfterMm (the fitter's own number)" % case},
                    "knownBad": {"value": round(pre_m1, 4),
                                "source": "M1 on the pre-fix bake (store/face-station-cases/%s/run1 GLB, no face targets)" % case},
                    "threshold": round(m1_threshold, 4),
                    "margin": round(m1_margin, 4),
                    "noise": round(m1_noise, 4),
                    "noiseSource": "|M1 postfix run1 - postfix run2|",
                    "enforced": bool(m1_enforced),
                },
                "m2": None,  # filled below (needs cross-case pairs)
            },
            "means": {
                "preM1": round(pre_m1, 4), "postM1": round(post_m1, 4),
                "preM2": round(pre_m2, 5), "postM2": round(post_m2, 5),
            },
        }

    # M2 thresholds (shared cross pairs).
    aisha_post_flat_m2 = load_gate("gate-aisha-postfix-run1.json")["m2"]
    cross_aisha_vs_body2 = load_gate("cross-aisha-postfix-vs-body2.json")["m2"]
    cross_body2pre_vs_aisha = load_gate("cross-body2-prefix-vs-aisha.json")["m2"]
    kb_m2 = min(cross_aisha_vs_body2, cross_body2pre_vs_aisha)
    kb_source = ("aisha post-fix flat vs body2 goal"
                 if cross_aisha_vs_body2 <= cross_body2pre_vs_aisha
                 else "body2 pre-fix flat vs aisha goal")
    m2_threshold = (aisha_post_flat_m2 + kb_m2) / 2.0
    rescale = {c: json.load(open(os.path.join(G, "rescale-%s.json" % c)))["noise"]
               for c in ("body2", "aisha")}
    for case in ("body2", "aisha"):
        post = [load_gate("gate-%s-postfix-run1.json" % case),
                load_gate("gate-%s-postfix-run2.json" % case)]
        run_noise = abs(post[0]["m2"] - post[1]["m2"])
        m2_noise = max(rescale[case], run_noise)
        m2_margin = abs(kb_m2 - aisha_post_flat_m2)
        m2_enforced = (m2_margin / m2_noise >= 1.0) if m2_noise > 0 else True
        cases[case]["thresholds"]["m2"] = {
            "knownGood": {"value": aisha_post_flat_m2,
                         "source": "aisha post-fix flat render vs aisha goal (M2_audit: D5 caveat applies — goal is an edit of an aisha render)"},
            "knownBad": {"value": kb_m2,
                        "source": "min(%s)" % kb_source},
            "threshold": round(m2_threshold, 5),
            "margin": round(m2_margin, 5),
            "noise": round(m2_noise, 5),
            "noiseSource": "max(0.8x-rescale redetection %s, |postfix run1 - run2| %s)" % (
                round(rescale[case], 5), round(run_noise, 5)),
            "enforced": bool(m2_enforced),
        }

    # Verdicts.
    b = cases["body2"]
    g1_pass = bool(b["means"]["postM1"] < b["means"]["preM1"]
                   and (not b["thresholds"]["m1"]["enforced"]
                        or b["means"]["postM1"] < b["thresholds"]["m1"]["threshold"]))
    g1 = {"pass": g1_pass,
          "detail": "postM1 %.4f vs preM1 %.4f, threshold %.4f (%s)" % (
              b["means"]["postM1"], b["means"]["preM1"],
              b["thresholds"]["m1"]["threshold"],
              "enforced" if b["thresholds"]["m1"]["enforced"] else "report-only")}
    if not g1_pass:
        g1["falsifier"] = {
            "m1BeforeMm": b["means"]["preM1"],
            "m1AfterMm": b["means"]["postM1"],
            "unapplied": b["unapplied"],
            "macroGap": ("fit basis has no race/age term (D3): 6 universal-young macro stems unfitted (~6e-6); "
                         "bake race fixed 0.33/0.33/0.33 + age 0.6 (derive_macro_dict), and the two weight-1.0 "
                         "head-* terms plus all asym-*/macro stems cannot load in the materializer's loader "
                         "(mpfb_body.py:102) so they stay unapplied"),
            "mappingMaxMm": max(b["postfix"]["run1"]["m1MappingMaxMm"],
                               b["postfix"]["run2"]["m1MappingMaxMm"]),
        }
    g2_pass = bool(b["means"]["postM2"] < b["means"]["preM2"])
    g2 = {"pass": g2_pass,
          "detail": "postM2 %.5f vs preM2 %.5f" % (b["means"]["postM2"], b["means"]["preM2"]),
          "thresholdVerdict": ("postM2 %.5f vs threshold %.5f: %s (%s)" % (
              b["means"]["postM2"], b["thresholds"]["m2"]["threshold"],
              "PASS" if b["means"]["postM2"] < b["thresholds"]["m2"]["threshold"] else "FAIL",
              "enforced" if b["thresholds"]["m2"]["enforced"] else "report-only"))}
    a = cases["aisha"]
    g3_m1 = a["means"]["postM1"] - a["means"]["preM1"]
    g3_m2 = a["means"]["postM2"] - a["means"]["preM2"]
    g3 = {"pass": bool(g3_m1 <= a["thresholds"]["m1"]["noise"]
                       and g3_m2 <= a["thresholds"]["m2"]["noise"]),
          "detail": "dM1 %+.4f (noise %.4f), dM2 %+.5f (noise %.5f)" % (
              g3_m1, a["thresholds"]["m1"]["noise"], g3_m2, a["thresholds"]["m2"]["noise"])}
    b["verdicts"] = {"g1": g1, "g2": g2}
    a["verdicts"] = {"g1": {"pass": True, "detail": "aisha G1 not gated (fit never applied to aisha either; G3 covers her)"},
                     "g2": {"pass": True, "detail": "aisha G2 not gated (G3 covers her)"},
                     "g3": g3}

    report = {
        "card": "tsk_2c547dda8753bba0",
        "generatedBy": "tools/openclinxr/evidence/face-fit/build_identity_report.py",
        "d5caveat": D5,
        "cases": cases,
        "sheets": [],
        "NOT_TESTED": ["skin tone", "age texture", "race/age macros"],
    }
    out = os.path.join(D, "identity-report.json")
    with open(out, "w") as f:
        json.dump(report, f, indent=1)
        f.write("\n")
    print("wrote %s" % out)
    print("body2 G1 %s | G2 %s | aisha G3 %s" % (g1, g2, g3))


main()
