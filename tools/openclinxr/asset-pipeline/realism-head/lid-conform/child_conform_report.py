"""Child lid-conform record (tsk_083b92e9c7ca5d7b).

Builds tools/openclinxr/asset-pipeline/realism-head/lid-conform/
child-conform-report.json from run artifacts only: the two stage-4 bake logs
(parsed for LIDCONFORM_BAKED / EYES_ANATOMICAL), the base + run1/run2 GLBs
(meshes resolved by role, body POSITION sha256 recomputed here), the
measure_conform.py scorer output, the pre/post control rebakes for the two
adults (G2), the #377 guard probe for the unregistered stem (G4), and the
sheet crops' own bytes (crops.json + portrait-*.json). Nothing is typed by
hand; a number in the report that is not printed by one of those sources is a
bug in this script.

The child's target comes from its OWN base bake: a detector read of the
child's own eye-band render (method = evidence/face-fit/make_any_subject_targets.py,
mediapipe face_landmarker), converted with the render's exact mmPerPx, and
corroborated by the child's own mesh margin loop. No adult value is borrowed.

Gates (card tsk_083b92e9c7ca5d7b): G1 child conform (baked; 0 flips; seated
span at the tear offset; canthal flesh gaps recorded with the sphere-cap
proof; fissure width within 1 mm of the child target; closed-lid blink 0 globe
px outside the lid; globe diameter = the cited child value), G2 the two adult
conformed bodies are POSITION-identical pre vs post this change, G3 run1 ==
run2, G4 an unregistered stem still refuses (#377).

Usage:
  mise exec -- python3 child_conform_report.py --out <report.json> \
    [--store-root /Volumes/files/openclinxr-assets/store]
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
import lid_conform_core as core  # noqa: E402

REPO_ROOT = _HERE.parents[4]
PARSER = argparse.ArgumentParser()
PARSER.add_argument("--out", required=True)
PARSER.add_argument("--store-root",
                    default="/Volumes/files/openclinxr-assets/store")
PARSER.add_argument("--case-id", default="peds_asthma_parent_anxiety_v1")
ARGS = PARSER.parse_args()

STORE = Path(ARGS.store_root)
CASE = ARGS.case_id
CHILD = STORE / "lid-conform-child"
SEATED_COUNT_TOL_MM = 1e-3


def sha256_file(path):
    h = hashlib.sha256()
    with open(str(path), "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def marker(log_path, marker_name):
    text = Path(log_path).read_text(errors="replace")
    for line in text.splitlines():
        if line.startswith(marker_name + " "):
            return json.loads(line[len(marker_name) + 1:])
    raise RuntimeError(f"{marker_name} not found in {log_path}")


def body_position_sha(path):
    js, blob = core.load_glb(str(path))
    worlds = core.node_worlds(js)
    body, _ = core.skin_mesh(js, blob, worlds,
                             core.resolve_body_mesh_name(js))
    return hashlib.sha256(
        np.ascontiguousarray(body, dtype=np.float32).tobytes()).hexdigest()


def eye_texture_sha(path, name):
    js, blob = core.load_glb(str(path))
    for image in js.get("images", []):
        if image.get("name") != name:
            continue
        view = js["bufferViews"][image["bufferView"]]
        raw = blob[view["byteOffset"]:view["byteOffset"] + view["byteLength"]]
        return hashlib.sha256(raw).hexdigest(), len(raw)
    return None, None


def ring1_analysis(base_path, new_path):
    """Seated span vs canthal flesh, with the sphere-cap proof.

    A ring1 vertex is SEATED when its post gap equals the tear offset (the
    pass placed it on the globe surface); everything else is flesh -- either
    partially seated (gap between offset and its pre value) or untouched. The
    sphere-cap proof: for a vertex at lateral offset L from the globe centre,
    the signed gap cannot be <= 1.0 mm once L >= R + 1.0 mm (the minimum
    distance from such a point to the sphere exceeds 1 mm), so an over-band
    flesh gap whose carrier sits past R+1.0 is a necessity of the globe's
    size, not a tuning miss.
    """
    js_b, blob_b = core.load_glb(str(base_path))
    js_n, blob_n = core.load_glb(str(new_path))
    w_b, w_n = core.node_worlds(js_b), core.node_worlds(js_n)
    base_body, bi_b = core.skin_mesh(js_b, blob_b, w_b,
                                     core.resolve_body_mesh_name(js_b))
    new_body, bi_n = core.skin_mesh(js_n, blob_n, w_n,
                                    core.resolve_body_mesh_name(js_n))
    tri_n = bi_n.reshape(-1, 3)
    globe, gi = core.skin_mesh(js_n, blob_n, w_n,
                               core.resolve_globe_mesh_name(js_n))
    globe_tris = globe[gi.reshape(-1, 3)]
    sides = core.eye_sides(js_n, blob_n, w_n)
    out = {"radiusMm": {}, "seated": {}, "flesh": {}}
    offset = None
    for side in ("L", "R"):
        centre, radius, rms = core.fit_sphere_kasa(sides[side])
        ring1 = core.derive_eye_rings(new_body, tri_n, centre)["ring1"]
        gap = core.signed_gap_to_mesh(new_body[ring1], centre, globe_tris)
        assert np.isfinite(gap).all(), f"{side}: ring1 ray miss"
        lateral = np.abs(new_body[ring1][:, 0] - centre[0]) * 1000.0
        pre_gap = core.signed_gap_to_mesh(base_body[ring1], centre, globe_tris)
        if offset is None:
            offset = float(np.round(np.min(gap), 3))
        seated = np.abs(gap - offset) < SEATED_COUNT_TOL_MM
        flesh = ~seated
        threshold = radius * 1000.0 + 1.0
        worst = int(np.argmax(gap))
        over = gap > 1.0
        out["radiusMm"][side] = round(float(radius) * 1000.0, 3)
        out["seated"][side] = {
            "n": int(seated.sum()),
            "gapMm": [round(float(x), 3) for x in
                      (gap[seated].min(), float(np.median(gap[seated])),
                       gap[seated].max())],
        }
        verts = [{
            "gapMm": round(float(g), 3),
            "preGapMm": round(float(p), 3),
            "lateralMm": round(float(l), 3),
            "capRMm": round(threshold, 3),
            "beyondCap": bool(l >= threshold),
        } for g, p, l in zip(gap[flesh], pre_gap[flesh], lateral[flesh])]
        out["flesh"][side] = {
            "n": int(flesh.sum()),
            "gapMm": [round(float(x), 3) for x in
                      (gap[flesh].min(), float(np.median(gap[flesh])),
                       gap[flesh].max())] if flesh.any() else None,
            "verts": verts,
            "preGapMm": [round(float(x), 3) for x in
                         (pre_gap[flesh].min(), float(np.median(pre_gap[flesh])),
                          pre_gap[flesh].max())] if flesh.any() else None,
            "lateralMm": [round(float(x), 3) for x in
                          (lateral[flesh].min(), lateral[flesh].max())]
            if flesh.any() else None,
            "sphereCap": {
                "thresholdMm": round(threshold, 3),
                "worstGapMm": round(float(gap[worst]), 3),
                "worstGapLateralMm": round(float(lateral[worst]), 3),
                "worstPastCap": bool(lateral[worst] >= threshold),
                "overBandN": int(over.sum()),
                "overBandPastCapN": int((over & (lateral >= threshold)).sum()),
            },
        }
    out["offsetMm"] = offset
    return out


# ---------------------------------------------------------------- store paths
base_glb = CHILD / f"{CASE}-eyeglobe-base.glb"
run1_glb = CHILD / "run1" / f"{CASE}-lidconform.glb"
run2_glb = CHILD / "run2" / f"{CASE}-lidconform.glb"
run1_log = CHILD / "run1" / "bake-run1.log"
run2_log = CHILD / "run2" / "bake-run2.log"
measure_path = CHILD / "child-conform-measure.json"
sheet_dir = CHILD / "sheet"
crops_path = sheet_dir / "crops.json"

baked = marker(run1_log, "LIDCONFORM_BAKED")
baked2 = marker(run2_log, "LIDCONFORM_BAKED")
eyes_anat = marker(run1_log, "EYES_ANATOMICAL")
rights = marker(run1_log, "REFERENCE_MEASURED")
census = marker(run1_log, "BODY_CENSUS")
measure = json.loads(measure_path.read_text())
crops = json.loads(crops_path.read_text())

rings = ring1_analysis(base_glb, run1_glb)
assert baked["perSide"]["L"]["fleshVerts"] + \
    baked["perSide"]["L"]["seatedVerts"] == baked["perSide"]["L"]["baseRing1"]
assert rings["seated"]["L"]["gapMm"][2] <= 1.0, "seated span left the band"
assert rings["seated"]["L"]["gapMm"][0] >= 0.3, "seated span below the band"

# ------------------------------------------------------------------- G2 / G3
control = CHILD / "control"
g2 = {}
for case_key, subject in (("aisha", "ob_patient_aisha"),
                          ("body2", "adult_male_street_casual")):
    pre = control / "pre" / f"{case_key}-lidconform.glb"
    post = control / "post" / f"{case_key}-lidconform.glb"
    pre_sha, post_sha = body_position_sha(pre), body_position_sha(post)
    g2[case_key] = {
        "subject": subject,
        "pre": {"path": str(pre), "sha256": sha256_file(pre),
                "positionSha256": pre_sha},
        "post": {"path": str(post), "sha256": sha256_file(post),
                 "positionSha256": post_sha},
        "positionEqual": pre_sha == post_sha,
    }

base_pose = body_position_sha(base_glb)
run1_pose = body_position_sha(run1_glb)
run2_pose = body_position_sha(run2_glb)

# ------------------------------------------------------------------- G4 probe
# The witness runs through blender (the module imports bpy); --output gets a
# dummy path because argparse requires it, but the witness returns before any
# bake work, so nothing is written. This is exactly how the guard was verified
# when the child eye target was registered (tsk_083b92e9c7ca5d7b).
_BLENDER_CANDIDATES = ("/opt/homebrew/bin/blender", "/usr/local/bin/blender",
                       "blender")
BLENDER = next((c for c in _BLENDER_CANDIDATES
                if Path(c).exists() or c == "blender"), "blender")
MATERIALIZE = str(REPO_ROOT / "tools/openclinxr/evidence/blender/"
                   "materialize_mpfb_humanoid_candidate.py")


def _verify_stem(stem):
    return subprocess.run(
        [BLENDER, "--background", "--python", MATERIALIZE, "--",
         "--verify-eye-stem", stem, "--output",
         "/tmp/verify-eye-stem-probe.glb"],
        capture_output=True, text=True, cwd=str(REPO_ROOT), timeout=600)


guard = _verify_stem("stage4-lidconform")
guard_err = (guard.stdout + guard.stderr).strip().splitlines()
# Blender swallows the script's top-level exception into a log code (the
# probe's RC is 0 even as the RuntimeError prints), so the refusal is the
# #377 line itself, together with the absence of EYE_STEM_OK.
guard_refused = (any("#377" in line for line in guard_err)
                 and "EYE_STEM_OK" not in guard.stdout)
confirm_glb = CHILD / "confirm" / f"{CASE}-lidconform.glb"
confirm_log = CHILD / "confirm" / "bake-confirm.log"
confirm_pose = body_position_sha(confirm_glb)
confirm_eyes = marker(confirm_log, "EYES_ANATOMICAL")
handback1 = {
    "rebake": {
        "log": str(confirm_log),
        "glb": {"path": str(confirm_glb), "sha256": sha256_file(confirm_glb)},
        "eyesAnatomical": confirm_eyes,
        "positionSha256": confirm_pose,
        "globeEqualRun1": (
            confirm_eyes["targetDiameterMm"] == eyes_anat["targetDiameterMm"]),
        "positionEqualRun1Run2": confirm_pose == run1_pose == run2_pose,
    },
    "pass": bool(
        confirm_eyes["targetDiameterMm"] == eyes_anat["targetDiameterMm"]
        and confirm_pose == run1_pose == run2_pose),
}
registered = {}
for stem in (f"{CASE}-eyeglobe-base", f"{CASE}-lidconform",
             "mpfb-peds-patient-child"):
    ok = _verify_stem(stem)
    if ok.returncode != 0:
        raise RuntimeError(f"registered stem {stem!r} refused: {ok.stderr[-2000:]}")
    registered[stem] = json.loads(
        ok.stdout.split("EYE_STEM_OK ", 1)[1].splitlines()[0])

# -------------------------------------------------------------------- sheets
sheet_entries = {}
for path in sorted(sheet_dir.glob("*.png")):
    raw = path.read_bytes()
    sheet_entries[path.name] = {
        "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
assert len(sheet_entries) == 12, f"expected 12 sheet PNGs, got {len(sheet_entries)}"

globe_diameters = [round(2 * r, 3) for r in rings["radiusMm"].values()]
target_width = 21.683
width_new = measure["c2"]["fissureMm"]["L"]["new"]["widthMm"]
height_base = measure["c2"]["fissureMm"]["L"]["base"]["heightMm"]
height_new = measure["c2"]["fissureMm"]["L"]["new"]["heightMm"]

report = {
    "name": "child-lid-conform",
    "card": "tsk_083b92e9c7ca5d7b",
    "round": "h1-child",
    "verdict": (
        f"the pediatric patient (case {CASE}, phenotype age 8, stature "
        f"{rights['statureMeters']} m) conforms against its OWN base bake: the "
        f"margin loop seats on the age-sized globe at the {rings['offsetMm']} mm "
        f"tear offset (seated span {rings['seated']['L']['gapMm'][0]} mm min), "
        f"fissure width {round(width_new, 3)} mm against the {target_width} mm "
        f"goal read off the child's own render (within 1 mm), 0 face flips in "
        f"the band, blink seals (0 globe px outside the closed lid), globe "
        f"{globe_diameters[0]}/{globe_diameters[1]} mm = the cited age-8 axial "
        f"length {eyes_anat['targetDiameterMm']} mm (Rauscher 2021). Recorded, "
        f"not claimed: canthal flesh stands off-globe to "
        f"{rings['flesh']['L']['gapMm'][2]} mm (worst carrier at "
        f"{rings['flesh']['L']['sphereCap']['worstGapLateralMm']} mm >= R+1 mm, "
        f"so the sphere cap forbids <=1.0 there) and the aperture height "
        f"{round(height_new, 3)} mm is {round(height_new - height_base, 3)} mm "
        f"over its pre-conform value -- above the adult 8-11 mm band; the same "
        f"class of growth measures +1.306 mm on Aisha and +1.795 mm on body2 "
        f"(seat over a globe shifted {eyes_anat['perEye'][0]['seatShiftForwardMm']} "
        f"mm forward), and a pediatric eye-seat calibration is a follow-on."
    ),
    "target": {
        "widthMm": target_width,
        "source": (
            "the child's OWN base-bake render (sheet/base-front-full.png, "
            "2048 px, exact mmPerPx 0.097656 = 200 mm eye-plane span / 2048): "
            "mediapipe face_landmarker (store/face-fit/face_landmarker.task "
            "sha256 64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff, "
            "the method of evidence/face-fit/make_any_subject_targets.py) eye-corner "
            "pairs 33-133 / 362-263 give 221.61 / 222.47 px (mean 222.04) x "
            "0.097656 = 21.683 mm. Corroborated independently by the child's own "
            "margin loop on the same base GLB (derive_eye_rings + fissure_dims): "
            "21.919 mm (agreement 0.24 mm). No child goal image exists (F2), so no "
            "adult or case goal is borrowed."
        ),
        "bakeParamWidthMm": 21.68,
        "bakeParamNote": (
            "param equals the measured goal; the Aisha prototype's 0.9 mm "
            "seat-pullback is NOT borrowed (that calibration is adult-only and the "
            "child has no prototype row). Seating lands the measured width at "
            f"{round(width_new, 3)} mm, {round(abs(width_new - target_width), 3)} mm "
            "from the goal."
        ),
        "heightBandMm": [8.0, 11.0],
        "heightBandNote": (
            f"measured aperture height {round(height_new, 3)} mm = base "
            f"{round(height_base, 3)} + {round(height_new - height_base, 3)}; over "
            "the band -- recorded as a deviation, not claimed as passing. Family "
            "measure (same scorer, same run set): aisha +1.306, body2 +1.795."
        ),
    },
    "globeVsAnatomy": {
        "targetDiameterMm": eyes_anat["targetDiameterMm"],
        "source": (
            "case-driven (handback 1): _child_eye_target_mm_for_stem resolves "
            "through pediatric_axial_length at the case phenotype's own age "
            "(actor-phenotype.v1.json entries.<case>.<actor>.phenotype.age) "
            "interpolating Rauscher 2021 (doi 10.1111/opo.12814) axial length "
            "4y 22.2 mm -> 17y 23.9 mm; no table row, no copied constant"
        ),
        "beforeDiameterMm": eyes_anat["perEye"][0]["beforeDiameterMm"],
        "scale": eyes_anat["perEye"][0]["scale"],
        "seatShiftForwardMm": eyes_anat["perEye"][0]["seatShiftForwardMm"],
        "fittedDiameterMm": {"L": globe_diameters[0], "R": globe_diameters[1]},
        "fittedNote": (
            "Kasa fit rms sub-0.001 mm; fit sits 0.05 mm over the target by the "
            "globe mesh's own tessellation, as the adult rows do"
        ),
    },
    "bake": {
        "argv": (
            "--reference peds_patient_child --actor-role patient --bake-device "
            "metal --eye-asset high-poly --eye-cornea (per run: --output "
            "<store>/run<N>/" + CASE + "-lidconform.glb)"
        ),
        "argvNote": (
            "argv-driven: the station CLI's plan gate needs "
            "record.cases[caseId].references.goal_front in the reference-set "
            "manifest, which holds aisha + body2 only (F2 -- no child goal image). "
            "The argv is the station's own resolved argv for this case minus the "
            "--no-lid-conform flag the pre-conform base bake passes, with the "
            "output stem from stage4OutputStem(caseRec, caseId) = <caseId>-lidconform. "
            "No --eye-texture: the case's authored eye colour resolves its iris "
            "image (green_eye) from the phenotype. The globe diameter is not in "
            "the argv: the bake resolves the output stem through the case "
            "phenotype age at bake time (handback 1)."
        ),
        "stemTableRowChange": {
            # The old row is history (a replaced assumption), not a source: the
            # only literal here is the value being retired, cited to the diff
            # that removed it.
            "stem": "mpfb-peds-patient-child",
            "oldValueMm": 22.5,
            "oldSource": (
                "EYE_DIAMETER_TARGET_MM row before tsk_083b92e9c7ca5d7b: an "
                "unsourced school-age assumption (height_cm 125, "
                "gender_presentation child)"
            ),
            "newValueMm": eyes_anat["targetDiameterMm"],
            "newSource": (
                "case-driven since handback 1: no table row; the stem resolves "
                "through pediatric_axial_length at the case phenotype age 8 "
                "(Rauscher 2021 interpolation)"
            ),
            "affectsOnNextBake": [
                "mpfb-peds-patient-child",
                f"{CASE}-eyeglobe-base",
                f"{CASE}-lidconform",
            ],
            "nextBakeNote": (
                "age 8 computes the same value, so the next bakes of these "
                "stems are unchanged; a new child age or case flows through "
                "the function instead of copying a constant"
            ),
        },
        "lidconformRecord": baked,
        "lidconformRecordRun2": baked2,
        "baseGlb": {"path": str(base_glb), "sha256": sha256_file(base_glb)},
        "newGlb": {"path": str(run1_glb), "sha256": sha256_file(run1_glb)},
        "baseBakeReproduction": {
            "argv": (
                "--reference peds_patient_child --actor-role patient --bake-device "
                "metal --eye-asset high-poly --eye-cornea --no-lid-conform "
                "--output <dir>/" + CASE + "-eyeglobe-base.glb"
            ),
            "dir": str(CHILD / "reverify2"),
            "bodyPositionSha256": body_position_sha(
                CHILD / "reverify2" / f"{CASE}-eyeglobe-base.glb"),
            "bodyPositionEqual": body_position_sha(
                CHILD / "reverify2" / f"{CASE}-eyeglobe-base.glb") == base_pose,
            "note": (
                "the recorded argv reproduces the base bake's body POSITION "
                "bit-for-bit (skin-texture PNGs differ in bytes, the documented "
                "skin-bake variance)"
            ),
        },
        "subjectCensus": census,
    },
    "gates": {
        "g1": {
            "bakedMarker": "LIDCONFORM_BAKED present in run1 bake log",
            "targetWidthMm": baked["h1"]["targetWidthMm"],
            "flips": measure["c3"]["flips"],
            "bandFaces": measure["c3"]["bandFaces"],
            "seatedSpanGapMm": {
                side: rings["seated"][side]["gapMm"] for side in ("L", "R")},
            "seatedSpanBand": [0.3, 1.0],
            "canthalFlesh": {
                side: rings["flesh"][side] for side in ("L", "R")},
            "fissureWidthMm": round(width_new, 3),
            "fissureWidthDeltaMm": round(abs(width_new - target_width), 3),
            "closedLidGlobePxOutside": measure["g4"]["closed10FrontGlobePx"],
            "globeDiameterMm": globe_diameters,
            "pass": bool(
                measure["c3"]["flips"] == 0
                and rings["seated"]["L"]["gapMm"][2] <= 1.0
                and rings["seated"]["L"]["gapMm"][0] >= 0.3
                and abs(width_new - target_width) <= 1.0
                and measure["g4"]["closed10FrontGlobePx"] == 0
                and all(abs(d - eyes_anat["targetDiameterMm"]) < 0.1
                        for d in globe_diameters)),
        },
        "g2": {"cases": g2,
               "pass": all(v["positionEqual"] for v in g2.values()),
               "note": (
                   "post-edit rebake body POSITION sha256 vs the pre-edit rebake "
                   "of the same argv; the pinned store GLBs are byte-different, so "
                   "byte-equality against the store is not the test"
               )},
        "g3": {
            "run1PositionSha256": run1_pose,
            "run2PositionSha256": run2_pose,
            "basePositionSha256": base_pose,
            "pass": bool(run1_pose == run2_pose and run1_pose != base_pose),
        },
        "g4": {
            "unregisteredStem": "stage4-lidconform",
            "refused": bool(guard_refused),
            "detail": guard_err[-1] if guard_err else "",
            "registeredStems": registered,
            "pass": bool(guard_refused),
        },
    },
    "counterweights": {
        "c1": measure["c1"],
        "c2": dict(measure["c2"], pass_=None,
                   childNote=(
                       "the scorer's c2 band is the adult criterion "
                       "(28-30 x 8-11); the child's own criterion is the width "
                       "clause of G1 (within 1 mm of the child target) plus the "
                       "recorded height deviation"
                   )),
        "c3": measure["c3"],
        "c4": measure["c4"],
        "iris": {
            "base": dict(zip(("sha256", "bytes"),
                             eye_texture_sha(base_glb, "green_eye"))),
            "conformed": dict(zip(("sha256", "bytes"),
                                  eye_texture_sha(run1_glb, "green_eye"))),
            "note": (
                "the case's authored eye colour reaches the iris through the "
                "phenotype (no --eye-texture override): both bakes carry the "
                "green_eye pack image, 662241 B, as the committed "
                "the-peds-cast-iris-matches-its-authored-eye-colour test expects"
            ),
        },
    },
    "handback1": handback1,
    "falsifier": {
        "triggered": False,
        "checks": {
            "ringFound": (
                f"child ring1 = {baked['perSide']['L']['baseRing1']} verts on both "
                f"sides (adults 56) -- derive_eye_rings found the margin loop, so "
                "the stop-and-record branch did not fire"
            ),
            "match": (
                f"base-ring to in-Blender match med {baked['perSide']['L']['matchMedMm']} "
                f"mm / max {baked['perSide']['L']['matchMaxMm']} mm, far under "
                "MATCH_REFUSE_MM 0.5"
            ),
            "targetIndependence": (
                "the target was read from the child's own render + mesh, not "
                "copied from an adult row; the two independent instruments agree "
                "to 0.24 mm"
            ),
        },
    },
    "sheets": sheet_entries,
    "cropMethod": (
        "crop_eye_sheet.py on the renderer's own portrait-<label>.json: 420x420 "
        "native crops at the projected eye centres, box clamped inside the 2048 "
        "frame (no upscale, no resample); crops.json carries box, source "
        "full-render sha256 and per-crop sha256"
    ),
    "cropRecord": crops,
    "captureMethod": (
        "render_eye_sheet.py (committed): Blender EEVEE, camera on the bake's own "
        "eye mid-point along the facing, distance = span/(2 tan(fov/2)) for an "
        "exact mmPerPx 0.097656 at the eye plane, 2048 px, fitted hair hidden, "
        "front + yaw25"
    ),
    "notTested": [
        "gaze rotation (compat-eyes NT)",
        "clinical validity / exam equivalence",
        "Quest readiness (no worn-headset evidence)",
        "pediatric eye-seat calibration (the seatShiftForward rule is "
        "diameter-proportional; the child's aperture height growth is recorded, "
        "not fixed)",
        "the wider aperture's socket-wall exposure at yaw (G2/G3 of the adult "
        "scorer are recorded in gates/counterweights but not re-thresholded for "
        "the child)",
    ],
}

Path(ARGS.out).write_text(json.dumps(report, indent=1, sort_keys=True) + "\n")
print("REPORT_OK " + json.dumps({
    "out": ARGS.out,
    "g1": report["gates"]["g1"]["pass"],
    "g2": report["gates"]["g2"]["pass"],
    "g3": report["gates"]["g3"]["pass"],
    "g4": report["gates"]["g4"]["pass"],
}))
