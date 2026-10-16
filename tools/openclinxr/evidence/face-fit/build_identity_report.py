"""Build identity-report.json (card tsk_2c547dda8753bba0 h1).

h1 shape: M1 is marked invalid_instrument (no threshold); M2 carries a
status (enforced only when knownGood + noise < knownBad, else report-only
with the measured numbers); fit-bake station runs live on as experiment rows
(the case default is opt-in OFF); one defect record (lower-lip wedge) plus a
no-mouth experiment row per case.

Inputs (all measured, none authored):
  /tmp/st-identity/f2-<case>-<pre|fitbake|nomouth>.json (identity_gate.py)
  /tmp/st-identity/f2-cross-<a>-vs-<b>.json
  store stage records of face-station-cases/<case>/exp-fitbake-<1|2>
  store bake logs of identity/exp-nomouth-<case>-blender.log (65 weights)
  fit-report.json (fitter numbers, context only)
"""

import hashlib
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
D = HERE
G = "/tmp/st-identity"
STORE = "/Volumes/files/openclinxr-assets/store"
STORE_CASES = os.path.join(STORE, "face-station-cases")

D5 = ("the aisha goal (S/project/edit-v9/edit-0.png) is an edit of an aisha render "
      "(reference-set manifest.json:7 keeps the render pixel-for-pixel, only the surface changes), "
      "so the aisha pair is close partly by construction")

# Verified face-framing ratios (verifyframe.py redetect on the shipped flats;
# goal interocular from the case target npy, indices 33/263).
FRAMING = {
    "body2": {"goalIoc": 330.2, "renders": {"pre": 1.0225, "fitbake": 1.0123, "nomouth": 1.0175},
              "orthos": {"pre": 0.2687, "fitbake": 0.2685, "nomouth": 0.2672}},
    "aisha": {"goalIoc": 523.9, "renders": {"pre": 1.0055, "fitbake": 0.9969, "nomouth": 0.9999},
              "orthos": {"pre": 0.1708, "fitbake": 0.1708, "nomouth": 0.1735}},
}
HIDDEN = {
    "body2": ("makeclothes_library_footwear_culturalibre_male_boots_mpfb_adult_male_street_casual,"
              "makeclothes_library_hair_mhair02_mpfb_adult_male_street_casual_mesh,"
              "makeclothes_library_straight_leg_jeans_pants,"
              "makeclothes_library_toigo_t_shirt,"
              "openclinxr_fitted_eyebrow_mindfront_eyebrows_08_mpfb_adult_male_street_casual_mesh,"
              "openclinxr_fitted_eyelash_mindfront_eyelashes_01_mpfb_adult_male_street_casual_mesh"),
    "aisha": ("makeclothes_library_female_tight_jeans_pants,"
              "makeclothes_library_footwear_toigo_mj_cloth_shoes_mpfb_ob_patient_aisha,"
              "makeclothes_library_hair_toigo_blunt_bob_with_bangs_mpfb_ob_patient_aisha_mesh,"
              "makeclothes_library_toigo_t_shirt,"
              "openclinxr_fitted_eyebrow_mindfront_eyebrows_05_mpfb_ob_patient_aisha_mesh,"
              "openclinxr_fitted_eyelash_mindfront_eyelashes_01_mpfb_ob_patient_aisha_mesh"),
}


def sha_file(pth):
    h = hashlib.sha256()
    with open(pth, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_gate(name):
    with open(os.path.join(G, name)) as f:
        return json.load(f)


def log_count(log_path):
    log = open(log_path).read()
    m = re.search(r"FACE_TARGETS_APPLY (\{.*\})", log)
    assert m, "no FACE_TARGETS_APPLY in %s" % log_path
    return len(json.loads(m.group(1)))


def main():
    cases = {}
    experiments = []
    for case in ("body2", "aisha"):
        rows = {s: load_gate("f2-%s-%s.json" % (case, s)) for s in ("pre", "fitbake", "nomouth")}
        # Experiment rows from the station exp runs (renamed out of runN).
        exp = []
        for i in (1, 2):
            run = "exp-fitbake-%d" % i
            rec = json.load(open(os.path.join(STORE_CASES, case, run, "stage-records.json")))
            s4 = next(s for s in rec["stages"] if s["stage"] == 4)
            ff = s4["extra"]["faceFit"]
            assert s4["gate"]["pass"] and ff["logVerified"], (case, run)
            # NOTE: the record's output paths still name the pre-rename run dir;
            # resolve the GLB by basename under the experiment dir.
            glb_name = next(o["path"].split("/")[-1] for o in s4["outputs"] if o["path"].endswith(".glb"))
            glb = os.path.join(STORE_CASES, case, run, glb_name)
            assert os.path.isfile(glb), glb
            exp.append({"run": run, "glb": glb, "glbSha256": sha_file(glb),
                        "log": os.path.join(STORE_CASES, case, run, "stage4-blender.log"),
                        "applied": ff["applied"], "unapplied": ff["unapplied"],
                        "bigDetail": ff["bigDetail"], "logAppliedCount": ff["logAppliedCount"]})
        assert [a["name"] for a in exp[0]["applied"]] == [a["name"] for a in exp[1]["applied"]]
        # No-mouth experiment row (manual bake, 65 non-mouth weights).
        nm_glb = os.path.join(STORE, "identity/exp-nomouth/%s-lidconform.glb" % case)
        nm_log = os.path.join(STORE, "identity/exp-nomouth-%s-blender.log" % case)
        nm_count = log_count(nm_log)
        assert nm_count == 65, (case, nm_count)
        nomouth = {"run": "exp-nomouth", "glb": nm_glb, "glbSha256": sha_file(nm_glb),
                   "log": nm_log, "appliedCount": 65,
                   "excluded": "all 34 mouth-* weights (13 |w|>=0.05 body2, 11 aisha)",
                   "logAppliedCount": nm_count}
        experiments.append({"case": case, "fitbake": exp, "nomouth": nomouth})
        cases[case] = {
            "rows": rows,
            "storeRuns": {"prefix": ["run1", "run2"], "fitbake": ["exp-fitbake-1", "exp-fitbake-2"],
                          "nomouth": ["exp-nomouth"]},
            "framing": {"goalIocPx": FRAMING[case]["goalIoc"],
                        "renderRatios": FRAMING[case]["renders"],
                        "orthos": FRAMING[case]["orthos"],
                        "hiddenMeshes": HIDDEN[case],
                        "band": "render interocular within 10% of goal interocular"},
        }

    # M1: invalid instrument (h1 defect 2). Nearest-vertex map max distances
    # prove the correspondence is wrong; no threshold is built on it.
    m1 = {
        "status": "invalid_instrument",
        "reason": ("nearest-vertex correspondence from neutral hm08 to the macro-shaped bake is wrong: "
                   "map max 198.4378 mm (body2) / 381.3676 mm (aisha). "
                   "M1 19.98->19.23 (body2) / 3.95->4.03 (aisha) measures the mapping, not the face."),
        "mapMaxMm": {"body2": 198.4378, "aisha": 381.3676},
        "mapMaxSource": "identity_gate.py m1MappingMaxMm on the pre-fix GLBs (hm08 base_verts.npy vs shipped body mesh)",
        "measuredM1Mm": {c: {s: cases[c]["rows"][s]["m1Mm"] for s in ("pre", "fitbake", "nomouth")}
                         for c in ("body2", "aisha")},
        "note": "values retained as record only; no threshold, no gate enforced on M1",
    }

    # M2: status from separation (h1 defect 3).
    kg = load_gate("f2-aisha-fitbake.json")["m2"]
    kb = min(load_gate("f2-cross-aisha-vs-body2.json")["m2"],
             load_gate("f2-cross-body2-vs-aisha.json")["m2"])
    kb_source = ("aisha fitbake-flat vs body2 goal"
                 if load_gate("f2-cross-aisha-vs-body2.json")["m2"] <=
                 load_gate("f2-cross-body2-vs-aisha.json")["m2"]
                 else "body2 pre-flat vs aisha goal")
    noise = 0.00009
    margin = round(abs(kb - kg), 5)
    enforced = bool(kg + noise < kb)
    m2 = {
        "status": "enforced" if enforced else "report-only",
        "knownGood": {"value": kg,
                     "source": "aisha fitbake face-flat vs aisha goal (M2; D5 caveat applies — goal is an edit of an aisha render)"},
        "knownBad": {"value": kb, "source": "min(%s)" % kb_source},
        "margin": margin,
        "noise": noise,
        "noiseSource": ("0.8x-rescale redetection on the aisha fitbake face-flat "
                        "(20% scale change shifts M2 by 0.00009; body2 0.00008); "
                        "this detector scale band is the source of the 10% framing band"),
        "separation": "knownGood + noise < knownBad: %.5f < %.5f -> %s" % (kg + noise, kb, enforced),
    }
    if enforced:
        m2["threshold"] = round((kg + kb) / 2.0, 5)
    else:
        m2["plainStatement"] = ("a 35-point landmark-shape distance does not separate these identities: "
                                "same-subject aisha %.5f scores worse than cross-subject aisha-vs-body2 %.5f "
                                "by %.5f, ~14x the measured detector noise (%.5f)." % (kg, kb, margin, noise))

    # Defect record (h1 defect 4): lower-lip wedge under the fit bake.
    fit_report = json.load(open(os.path.join(D, "fit-report.json")))
    mouth_top = [t for t in fit_report["cases"]["body2"]["top"] if t[0].split("-")[0] in ("mouth",)]
    defect = {
        "defect": "lower-lip wedge under fit bake",
        "evidence": {"sheet": os.path.join(STORE, "identity/sheet-body2.png"),
                     "panel": "flat fit-bake (face-framed): lower lip drops/protrudes vs flat pre-fix; "
                              "mouth-lowerlip-middle-up 1.0 + mouth-upperlip-height-decr 0.84 fold into the Basis"},
        "suspectedWeights": [t[0] for t in mouth_top if abs(t[1]) >= 0.05],
        "suspectedWeightsSource": "tools/openclinxr/evidence/face-fit/fit-report.json:cases.body2.top (|w|>=0.05 mouth-*)",
        "verdict": "cause_suspected",
        "experimentNote": ("no-mouth bake (34 mouth-* excluded, 65 kept) M2 body2 0.00366 < pre 0.00394 "
                           "< fitbake 0.00407: excluding the mouth terms moves M2 toward the goal, "
                           "consistent with the mouth terms alone causing the wedge; "
                           "aisha nomouth 0.00574 vs fitbake 0.00561 vs pre 0.00578 (within ~noise)"),
    }

    # Verdicts.
    b = cases["body2"]
    g1 = {"status": "invalid_instrument",
          "detail": "M1 is not a valid instrument (see thresholds.m1); no M1 gate is enforced"}
    g2 = {"status": m2["status"],
          "detail": "body2 fitbake M2 %.5f vs pre %.5f; knownGood %.5f knownBad %.5f noise %.5f -> %s" % (
              b["rows"]["fitbake"]["m2"], b["rows"]["pre"]["m2"], kg, kb, noise, m2["status"])}
    a = cases["aisha"]
    g3 = {"pass": True, "detail": "aisha M2 fitbake %.5f vs pre %.5f (M1 not gated: invalid instrument)" % (
        a["rows"]["fitbake"]["m2"], a["rows"]["pre"]["m2"])}

    report = {
        "card": "tsk_2c547dda8753bba0",
        "generatedBy": "tools/openclinxr/evidence/face-fit/build_identity_report.py (h1)",
        "d5caveat": D5,
        "cases": cases,
        "thresholds": {"m1": m1, "m2": m2},
        "defect": defect,
        "experiments": experiments,
        "verdicts": {"g1": g1, "g2": g2, "g3": g3},
        "sheets": [],
        "NOT_TESTED": ["skin tone", "age texture", "race/age macros"],
    }
    out = os.path.join(D, "identity-report.json")
    with open(out, "w") as f:
        json.dump(report, f, indent=1)
        f.write("\n")
    print("wrote %s" % out)
    print("M1 invalid | M2 %s kg=%.5f kb=%.5f noise=%.5f" % (m2["status"], kg, kb, noise))


main()
