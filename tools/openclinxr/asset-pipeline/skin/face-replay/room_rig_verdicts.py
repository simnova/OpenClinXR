"""Append/refresh gate verdicts (handback 1) in room-rig-remeasure-report.json."""
import json
import os

DIR = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(DIR, "room-rig-remeasure-report.json")
with open(P) as f:
    r = json.load(f)

g1 = r["gates"]["G1"]

verdicts = {
    "G0": {
        "verdict": "PASS (noise floor established)",
        "detail": ("Harness is bit-deterministic: every per-region and global run-to-run "
                   "meanAbsDiff is exactly 0.0 (15a-vs-15b, 14a-vs-14b). margin/noise is "
                   "undefined as a ratio (denominator 0); enforced gates below quote absolute "
                   "margins against this exact-zero floor."),
    },
    "G1": {
        "verdict": "PASS (exact; falsifier no longer fires)",
        "detail": ("BEFORE (hand-copy swap, commit 92b02d570): global meanAbsDiff 0.0128 "
                   "(chin-region 0.0602, 0.1% px differ, max 54) vs G0 noise 0.0: falsifier "
                   "fired. AFTER (full-state copy: MeshStandardMaterial.prototype.copy + "
                   "restored {STANDARD, PHYSICAL} defines + ior): base-vs-15a global "
                   f"meanAbsDiff {g1['global']}, frac>0 {g1['frac_px_any_diff']}, "
                   f"max {g1['max_abs']}: bit-identical. The swap alone changes nothing; "
                   "the silhouette diff was dropped side/blend/depth state, as diagnosed."),
        "before": {"global_mad": 0.0128, "chin_mad": 0.0602, "frac_px_gt1": 0.001042, "max_abs": 54},
        "after": g1,
    },
    "G2": {
        "verdict": "PASS",
        "detail": ("skinOverrideApplied.ior reads back exactly 1.4 on body2 "
                   "(mpfb_skin_adult_male_street_casual) and Aisha (mpfb_skin_ob_patient_aisha); "
                   "1.5 on both controls; every non-skin collectMaterialInventory entry identical "
                   "15-vs-14 on both subjects; skin type MeshPhysicalMaterial on all four, "
                   "MeshStandardMaterial on the pre-change baseline. Recomputed on the re-rendered "
                   "images."),
    },
    "G3": {
        "verdict": "FAIL as written, with the Aisha own-median clause report-only (floor unreachable on this rig)",
        "detail": ("Recomputed on the re-rendered images (moves at edges only). Aisha HL_own is "
                   "0.0 at IOR 1.5 AND at IOR 1.4: the 0.0393 floor is unreachable on this rig "
                   "regardless of IOR, so that clause is report-only (reason: rig, not IOR). "
                   "Remaining clauses: body2 cheek drops and stays above floor (PASS); body2 own "
                   "and Aisha cheek rise (direction FAIL). Not matte by HL_cheek on both."),
        "aisha_own_median_floor_unreachable": True,
    },
    "G4a": {
        "verdict": "FAIL (0 of 4 within 3 per channel; L-field 0 of 4)",
        "detail": ("Recomputed on the re-rendered images. Room rig renders sit ~13-24 L high "
                   "(rig exposure 0.9 + IBL wash); mouth-landmark studio L-field '3 of 4' does "
                   "not hold on the room rig."),
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
        "detail": ("min-max rule over upperlip_skin+chin, render vs goal. Recomputed on the "
                   "re-rendered fronts; driver is room-rig brightness, not the beard pattern. "
                   "No manifest change."),
    },
    "G4c": {
        "verdict": "recorded (IOR gap closure; albedo-edit transfer NOT MEASURED room-side)",
        "detail": ("Renamed: ior_gap_closure (was forehead_transfer). The studio "
                   "transfer_ratio_a_F0 (forehead 0.598) describes an ALBEDO transfer "
                   "(albedo_delta_a_face_mean 3.828); room-side the albedo delta is 0 by "
                   "construction, so no same-definition ratio exists and the +3.828 a* edit "
                   "was not re-baked for the room rig: recorded as not measured, reason stated "
                   "in gates.G4.albedo_edit_transfer."),
        "studio_beside": {
            "transfer_ratio_a_F0_forehead": 0.598,
            "transfer_ratio_a_F0_cheeks": {"L_cheek": 1.001, "R_cheek": 0.998},
            "transfer_ratio_a_F0_chin": 0.713,
            "source": "forehead-sheen-report.json gates.G5",
        },
    },
    "G5": {
        "verdict": "recorded only, no fix (pore-scale + crease-scale side by side)",
        "detail": ("Handback 1: the 5x5 box high-pass resolves pores (render forehead far below "
                   "goal), so a crease-scale DoG band (sigmas from forehead bbox height) is "
                   "recorded beside it for forehead + nasolabial, render vs goal. Both record-only."),
    },
    "G6": {
        "verdict": "renders refreshed (base/15a/14a body2 fronts re-rendered) + grade: lane-manager PASS",
        "detail": ("Lane-manager grade on native-1280 room renders: IOR 1.4 vs 1.5 subtle and "
                   "correct in direction (slightly less glint on brow and nose bridge), no plastic "
                   "look, forehead not matte, both subjects."),
    },
}
r["verdicts"] = verdicts
with open(P, "w") as f:
    json.dump(r, f, indent=1)
    f.write("\n")
print("verdicts refreshed (handback 1)")
for k, v in verdicts.items():
    print(f"{k}: {v['verdict']}")
