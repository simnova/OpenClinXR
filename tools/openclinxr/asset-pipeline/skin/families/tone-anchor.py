"""Tone-anchor instrument: Lab of a case's goal_front image, for a tone token with no recorded anchor.

tone-report.json holds tone_anchors_Lab only for the tokens whose goal_front facecore was
measured by hand (warm_light, warm_medium). A case whose token has no row (warm_light_child)
gets its anchor from this instrument instead: the mean CIELAB of the landmark-anchored skin
regions of the case's own goal_front image (the face-gate regions forehead, both cheeks, nose,
chin; face_gate.py region_polygons / raster_masks, landmarks by face_gate_v2.detect_median on
the pinned FaceLandmarker model). It imports face_gate, it does not copy it. No model call.

The recorded adult anchors were measured with a facecore mask this instrument does not
reproduce, so the instrument is calibrated against them rather than assumed equal:

  --calibrate   measures the goal_front of every case that has a recorded anchor plus the
                cases named in --extra-cases, writes tone-anchor-report.json: per-subject
                Lab, disagreement with the recorded anchor (dLab, Euclidean), the family the
                nearest-forehead-mean rule picks from each, and the child margin over the
                worst calibration disagreement. A measured anchor is only used when
                margin / disagreement >= 1 (the LANES.md margin-over-noise rule).
  --image P     prints one JSON line {"lab": [L,a,b], "regions": {...}, "image_sha256": ...}.

Run through mise: mise exec -C /Volumes/files/src/openclinxr -- python3 tone-anchor.py ...
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
STORE = Path("/Volumes/files/openclinxr-assets/store")
TONE_REPORT = HERE / "tone-report.json"
OUT_REPORT = HERE / "tone-anchor-report.json"
REFERENCE_MANIFEST = REPO / "tools/openclinxr/asset-pipeline/reference-set/manifest.json"
REGIONS = ("forehead", "cheek_side_a", "cheek_side_b", "nose", "chin")
# Adult goal_front images: the reference-set manifest names store_relpaths that do not exist
# under the store root, so the calibration copies live under this card-owned directory
# (sha256-verified against the manifest output sha256 before use).
CALIBRATION_COPIES = {
    "aisha": "face-station-tone-anchor/aisha-goal-front.png",
    "body2": "face-station-tone-anchor/body2-goal-front.png",
}


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def measure(image: Path) -> dict:
    sys.path.insert(0, str(REPO / "tools/openclinxr/evidence/face-gate"))
    import face_gate as v1  # noqa: E402
    import face_gate_v2 as v2  # noqa: E402

    landmarker = v1.create_landmarker()
    img = Image.open(image).convert("RGB")
    pts, info = v2.detect_median(landmarker, img)
    if pts is None:
        raise SystemExit("no face detected in the goal_front image: refused")
    w, h = img.size
    masks = v1.raster_masks(v1.region_polygons(pts), w, h)
    lab = v1.rgb_to_lab(np.asarray(img))
    union = np.zeros((h, w), bool)
    regions = {}
    for name in REGIONS:
        m = masks[name] > 0
        union |= m
        regions[name] = [round(float(v), 2) for v in lab[m].mean(axis=0)]
    anchor = [round(float(v), 2) for v in lab[union].mean(axis=0)]
    return {
        "lab": anchor,
        "regions": regions,
        "image_sha256": sha256_file(image),
        "landmark_jitter_px": info["jitter_px"],
        "region_pixels": int(union.sum()),
    }


def family_distances(anchor: list[float], families: dict) -> dict:
    return {
        fid: round(float(np.linalg.norm(np.array(anchor) - np.array(info["forehead"]))), 2)
        for fid, info in families.items()
        if "forehead" in info
    }


def pick_and_margin(distances: dict) -> tuple[str, float]:
    ranked = sorted(distances.items(), key=lambda kv: kv[1])
    return ranked[0][0], round(ranked[1][1] - ranked[0][1], 2)


def calibrate(child_case: str) -> None:
    tone = json.loads(TONE_REPORT.read_text())
    ref = json.loads(REFERENCE_MANIFEST.read_text())["cases"]
    subjects: dict = {}
    for case, rec in ref.items():
        token = rec["phenotype_tone"]
        out = rec["references"]["goal_front"]["output"]
        want = out["sha256"]
        if case in CALIBRATION_COPIES:
            image = STORE / CALIBRATION_COPIES[case]
        else:
            image = STORE / out["store_relpath"]
        if sha256_file(image) != want:
            raise SystemExit(f"{case}: goal_front sha256 != reference-set manifest ({image}): refused")
        row = measure(image)
        recorded = tone["tone_anchors_Lab"].get(token)
        dist = family_distances(row["lab"], tone["families"])
        pick, margin = pick_and_margin(dist)
        subjects[case] = {
            "phenotype_tone": token,
            "goal_front_sha256": want,
            "image": str(image),
            **row,
            "recorded_anchor_Lab": recorded,
            "disagreement_dLab": None if recorded is None else round(float(np.linalg.norm(np.array(row["lab"]) - np.array(recorded))), 2),
            "distances_to_family_forehead": dist,
            "pick": pick,
            "pick_margin": margin,
            "recorded_pick": tone["nearest"].get(token),
        }
    calibrated = {k: v for k, v in subjects.items() if v["recorded_anchor_Lab"] is not None}
    noise = max(v["disagreement_dLab"] for v in calibrated.values())
    report = {
        "version": 1,
        "instrument": "tools/openclinxr/asset-pipeline/skin/families/tone-anchor.py",
        "method": "mean CIELAB (D65, skimage rgb2lab) of the face-gate skin regions forehead, cheek_side_a, cheek_side_b, nose, chin on the goal_front image; landmarks = face_gate_v2.detect_median (median of 3, pinned FaceLandmarker model)",
        "why": "tone-report.json tone_anchors_Lab has hand-measured facecore anchors for warm_light and warm_medium only; the child token warm_light_child has no row and no recorded method to extend",
        "subjects": subjects,
        "calibration": {
            "subjects": sorted(calibrated),
            "noise_dLab_max_disagreement_with_recorded_anchor": noise,
            "noise_source": "max over the calibration subjects of |instrument anchor - recorded tone_anchors_Lab| (tone-report.json); the instrument is not the recorded method, this is its measured offset",
            "recorded_picks_reproduced": {k: v["pick"] == v["recorded_pick"] for k, v in calibrated.items()},
        },
        "child": None,
    }
    if child_case in subjects:
        c = subjects[child_case]
        report["child"] = {
            "case": child_case,
            "anchor_Lab": c["lab"],
            "pick": c["pick"],
            "margin_dLab": c["pick_margin"],
            "margin_over_noise": round(c["pick_margin"] / noise, 2),
            "rule": "the instrument anchor is used only when margin_over_noise >= 1 and the pick equals tone-report nearest[token]",
        }
    OUT_REPORT.write_text(json.dumps(report, indent=1) + "\n")
    print(f"wrote {OUT_REPORT.name}; noise {noise}; child {report['child']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image")
    ap.add_argument("--expect-sha256")
    ap.add_argument("--calibrate", action="store_true")
    ap.add_argument("--child-case", default="peds_asthma_parent_anxiety_v1")
    a = ap.parse_args()
    if a.calibrate:
        calibrate(a.child_case)
        return
    if not a.image:
        raise SystemExit("--image or --calibrate required")
    p = Path(a.image)
    if a.expect_sha256 and sha256_file(p) != a.expect_sha256:
        raise SystemExit(f"image sha256 != expected ({p}): refused")
    print(json.dumps(measure(p)))


if __name__ == "__main__":
    main()
