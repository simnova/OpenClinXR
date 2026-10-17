"""Append gate verdicts + studio-beside numbers to room-rig-remeasure-report.json."""
import json
import os

DIR = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(DIR, "room-rig-remeasure-report.json")
with open(P) as f:
    r = json.load(f)

g0, g1 = r["gates"]["G0"], r["gates"]["G1"]
g3, g4 = r["gates"]["G3"], r["gates"]["G4"]

verdicts = {
    "G0": {
        "verdict": "PASS (noise floor established)",
        "detail": ("Harness is bit-deterministic: every per-region and global run-to-run "
                   "meanAbsDiff is exactly 0.0 (15a-vs-15b, 14a-vs-14b). margin/noise is "
                   "undefined as a ratio (denominator 0); enforced gates below quote absolute "
                   "margins against this exact-zero floor, which satisfies the intent of "
                   "margin/noise >= 1 (no sub-noise enforcement possible)."),
        "noise": g0,
    },
    "G1": {
        "verdict": "FAIL as written (falsifier FIRED)",
        "detail": ("Physical swap at IOR 1.5 vs untouched MeshStandard: global meanAbsDiff "
                   f"0.0128 (frac>0 px {g1['frac_px_any_diff']}, frac>1 LSB {g1['frac_px_diff_gt1']}, "
                   f"max {g1['max_abs']}), chin-region 0.0602 vs G0 noise 0.0 everywhere else. "
                   "The swap alone changes 0.1% of pixels (specular-path rounding on the "
                   "chin/jaw curve), i.e. NOT bit-identical. IOR 1.5->1.4 effect is 0.4977 "
                   "global (~39x the swap effect), so attribution of the G3/G4 deltas to IOR "
                   "stands, but the control is recorded as failed, not waved through. "
                   "Downstream gates compare 1.5 vs 1.4 (independent of G1) and are measured."),
        "numbers": g1,
    },
    "G2": {
        "verdict": "PASS",
        "detail": ("skinOverrideApplied.ior reads back exactly 1.4 on body2 "
                   "(mpfb_skin_adult_male_street_casual) and Aisha (mpfb_skin_ob_patient_aisha); "
                   "1.5 on both controls; every non-skin collectMaterialInventory entry identical "
                   "15-vs-14 on both subjects; skin type MeshPhysicalMaterial on all four, "
                   "MeshStandardMaterial on the pre-change baseline."),
    },
    "G3": {
        "verdict": "FAIL as written (2 of 4 comparisons move the wrong way; Aisha own-median below floor)",
        "detail": ("body2 HL_cheek 0.5226 -> 0.4413 (drops, stays >= 0.0618 floor: PASS); "
                   "body2 HL_own 0.0736 -> 0.0786 (RISES, stays >= 0.0393 floor: direction FAIL); "
                   "aisha HL_cheek 0.5315 -> 0.5417 (RISES: direction FAIL, above floor); "
                   "aisha HL_own 0.0000 -> 0.0000 (flat, BELOW the 0.0393 floor: FAIL). "
                   "Room rig keeps both foreheads far above the cheek-anchored matte floor "
                   "(not matte by HL_cheek), but IOR 1.4 is not a uniform sheen fix on this rig. "
                   "Goal recompute reproduces forehead-sheen-report.json both_metrics exactly "
                   "(body2 0.6054/0.1746, aisha 0.0618/0.0393), validating the instrument."),
        "floors": {"HL_cheek": 0.0618, "HL_own": 0.0393},
        "margin_note": "noise 0.0: margins absolute (body2 cheek drop 0.0813).",
    },
    "G4a": {
        "verdict": "FAIL (0 of 4 within 3 per channel; L-field 0 of 4)",
        "detail": ("body2 room-rig 14a vs goal-front: forehead [12.8, 5.92, 1.27], L_cheek "
                   "[23.75, 2.41, 4.74], R_cheek [15.08, 1.92, 4.72], chin [13.74, 1.87, 7.24]; "
                   "no region within 3 on any channel. The room rig renders ~13-24 L too bright "
                   "(face median L 66.0 vs goal 49.78; rig exposure 0.9 + IBL wash), so L fails "
                   "everywhere while chroma is closer (b* within ~5 except chin/upperlip). "
                   "Mouth-landmark studio L-field '3 of 4' does NOT hold on the room rig."),
        "studio_beside": {
            "source": "tools/openclinxr/asset-pipeline/skin/face-replay/mouth-landmark-report.json:g4_regions (studio rig, render-minus-goal)",
            "L_cheek": [1.17, -1.41, -2.43],
            "R_cheek": [0.71, -0.4, 0.03],
            "forehead": [2.64, -5.38, -3.45],
            "chin": [-2.31, 0.6, 0.7],
            "within3_count": 3,
        },
    },
    "G4b": {
        "verdict": "room-rig choice 1.0 beside station 0.9; RECOMMEND keep chain-manifest",
        "detail": ("min-max rule (max per-channel |dLab| over upperlip_skin+chin, render vs goal): "
                   "w0 26.68 / w0.5 20.12 / w0.75 16.06 / w0.9 13.74 / w1.0 13.02. "
                   "Choice flips to 1.0 on the room rig, but the margin (0.72) is small against "
                   "the ~13 L-driven residual: the driver is room-rig brightness (upperlip L "
                   "26.68 -> 11.60 monotonic with weight), not the beard pattern. No manifest change."),
    },
    "G4c": {
        "verdict": "recorded (forehead residual + gap-closure analog; no albedo transfer exists room-side)",
        "detail": ("Room forehead residual 14a [12.8, 5.92, 1.27] vs 15a [13.42, 6.37, 0.07]: "
                   "IOR closes L by 4.6% and a* by 7.1%, moves b* AWAY (gap -17.1: residual "
                   "0.07 -> 1.27). Studio sheen G5 transfer_ratio_a_F0 forehead 0.598 describes an "
                   "ALBEDO transfer (albedo_delta_a_face_mean 3.828); room-side the albedo delta is "
                   "0 by construction (IOR lives in the material, same albedo_beard), so no "
                   "same-definition ratio exists; gap-closure is the stated analog."),
        "studio_beside": {
            "transfer_ratio_a_F0_forehead": 0.598,
            "transfer_ratio_a_F0_cheeks": {"L_cheek": 1.001, "R_cheek": 0.998},
            "transfer_ratio_a_F0_chin": 0.713,
            "source": "forehead-sheen-report.json gates.G5",
        },
    },
    "G5": {
        "verdict": "recorded only, no fix",
        "detail": ("body2 face-polygon median L: render 66.0 vs goal 49.78 vs warm_medium anchor "
                   "49.26 (goal matches the anchor; the render sits ~16 L high on the room rig). "
                   "Wrinkle high-pass (5x5 box) RMS: forehead render 1.093 vs goal 6.459 (render "
                   "~6x smoother); nasolabial render 4.674 vs goal 6.039. Room renders under-express "
                   "wrinkle contrast; recorded, not gated."),
    },
    "G6": {
        "verdict": "renders complete (12 room PNGs + 4 sweep fronts + shas in report.renders); grade pending lane manager",
        "detail": ("No plastic look and no matte forehead claimed here: body2 HL_cheek 0.44 "
                   "(lit, not matte); Aisha HL_own 0.0 reads matte at the own-median scale. "
                   "Lane-manager grade pending."),
    },
}
r["verdicts"] = verdicts
with open(P, "w") as f:
    json.dump(r, f, indent=1)
    f.write("\n")
print("verdicts appended")
for k, v in verdicts.items():
    print(f"{k}: {v['verdict']}")
