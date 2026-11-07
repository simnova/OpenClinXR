#!/usr/bin/env python3
"""Reproduce the historical profile scores by changing only camera history."""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import bpy
from mathutils import Vector

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
TOP = ROOT / "tools/openclinxr/evidence/hair-top1/cells/t1"
LOOK5 = ROOT / "tools/openclinxr/evidence/hair-look5/cells/best/metrics.json"
STRANDS = TOP / "strands.npz"

sys.path.insert(0, str(E))
import score as S  # noqa: E402


def matrix(camera):
    return {
        "location": [float(value) for value in camera.location],
        "radiusFromTarget": float((camera.location - Vector(tuple(STATE["handle"].target))).length),
        "matrixWorld": [[float(value) for value in row] for row in camera.matrix_world],
    }


def prepare_cell(path: Path):
    path.mkdir(parents=True, exist_ok=True)
    for name in ("front.png", "front-id.png", "back-id.png"):
        shutil.copy2(TOP / name, path / name)


def render_profile(path: Path):
    prepare_cell(path)
    S.visible(STATE, HAIR)
    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = S.SIZE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filter_size = 1.5
    old = STATE["handle"].hair
    STATE["handle"].hair = HAIR
    try:
        STATE["hs"]._render_id(STATE["handle"], path / "profile_90-id.png", S.SIZE)
    finally:
        STATE["handle"].hair = old
    return S.run_judge(path, LANDMARKS)


def ious(document):
    return {
        "front": float(document["iou"]),
        "profile": float(document["profile_view"]["iou"]),
        "back": float(document["back_view"]["iou"]),
    }


STATE = S.R.ST.build_state()
LANDMARKS = json.loads(S.LANDMARKS.read_text())
PARAMS, _ = S.read_params(LOOK5)
DATA = S.strand_data(STRANDS)
HAIR = S.R.build_hair(STATE, DATA["points"], DATA["radii"], "hair_score_camera_verification", PARAMS)
CAMERA = STATE["handle"].camera
INITIAL_LOCATION = CAMERA.location.copy()
INITIAL_ROTATION = CAMERA.rotation_euler.copy()

# hair-real1/check_baseline_render: a new scene, then profile directly.
STATE["c3"].set_final_view(STATE["handle"], "profile_90")
bpy.context.view_layer.update()
fresh_camera = matrix(CAMERA)
fresh_dir = E / "verification/fresh-profile"
fresh = ious(render_profile(fresh_dir))

# hair-top1/build_render: I1's five views leave the camera at crown_top;
# T1 then renders front, three-quarter, profile.  No other setting changes.
CAMERA.location = INITIAL_LOCATION
CAMERA.rotation_euler = INITIAL_ROTATION
for view in ("front", "three_quarter", "profile_90", "back", "crown_top"):
    STATE["c3"].set_final_view(STATE["handle"], view)
for view in ("front", "three_quarter", "profile_90"):
    STATE["c3"].set_final_view(STATE["handle"], view)
bpy.context.view_layer.update()
drifted_camera = matrix(CAMERA)
drifted_dir = E / "verification/drifted-profile"
drifted = ious(render_profile(drifted_dir))

stored = ious(json.loads((TOP / "judge/t1.json").read_text()))
real = json.loads((ROOT / "tools/openclinxr/evidence/hair-real1/baseline-rerender/judge-summary.json").read_text())["iou"]
document = {
    "schemaVersion": 1,
    "cause": "children3.set_final_view derives radius from the preceding camera; hair-top1 rendered T1 after I1 crown_top, while hair-real1 rerendered profile from a fresh scene",
    "controlledVariable": "camera history only",
    "fixed": {
        "strands": S.input_record(STRANDS),
        "params": S.input_record(LOOK5),
        "resolutionPx": S.SIZE,
        "idSamples": 16,
        "filterSize": 1.5,
        "idThreshold": "alpha>=230",
        "objectsVisible": "same R4 body holdouts and one saved T1 strands object",
        "landmarks": {**S.input_record(S.LANDMARKS), "values": LANDMARKS["judge"]},
        "judgeV6": S.input_record(S.JUDGE),
    },
    "freshProfile": {"camera": fresh_camera, "iou": fresh, "id": S.input_record(fresh_dir / "profile_90-id.png")},
    "driftedProfile": {"camera": drifted_camera, "iou": drifted, "id": S.input_record(drifted_dir / "profile_90-id.png")},
    "references": {"hairTop1Stored": stored, "hairReal1Reraster": real},
    "reproduced": {
        "hairTop1Profile": abs(drifted["profile"] - stored["profile"]) < 5e-7,
        "hairReal1Profile": abs(fresh["profile"] - float(real["profile"])) < 5e-7,
    },
    "pipelineDiff": {
        "cameraMatrix": "different because radius is inherited from prior view",
        "resolution": "same: 1024",
        "filmAndFilter": "same: transparent ID, filter 1.5",
        "idSettings": "same: hair-scene holdout ID, 16 samples, judge alpha>=230",
        "objectsVisible": "same",
        "strandSource": "same saved hair-top1 T1 strands.npz",
        "judgeLandmarks": "same hair-curtain3/landmarks.json",
    },
}
(E / "diff.json").write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
print("PROFILE_CAMERA_DIFF", json.dumps({"fresh": fresh, "drifted": drifted, "reproduced": document["reproduced"]}, sort_keys=True), flush=True)
