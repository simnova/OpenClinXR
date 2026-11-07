"""Step 3: alignment check source vs target per view (MediaPipe tasks API).

Face landmarker (468 pts) + pose landmarker (33 pts), Apache-2.0, same role
as hair-reg3q's MediaPipe Face/Pose. Landmarks detected in BOTH images are
matched; shift = Euclidean px distance; report p95. p95 > 6 px -> MISALIGNED.
Face is expected to fail on the back view (no face visible) -> face N/A.
Writes alignment.json to T.
"""
import json
from pathlib import Path

import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
from PIL import Image

T = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v1")
MODELS = Path("/tmp/ht2-models")
SRC = {"front": "source-front.png", "three_quarter": "source-three_quarter.png",
       "profile": "source-profile_90.png", "back": "source-back.png"}
TGT = {"front": "target-front.png", "three_quarter": "target-three_quarter.png",
       "profile": "target-profile.png", "back": "target-back.png"}

face_opt = vision.FaceLandmarkerOptions(
    base_options=mp_python.BaseOptions(
        model_asset_path=str(MODELS / "face_landmarker.task")),
    running_mode=vision.RunningMode.IMAGE, num_faces=1,
    min_face_detection_confidence=0.3)
pose_opt = vision.PoseLandmarkerOptions(
    base_options=mp_python.BaseOptions(
        model_asset_path=str(MODELS / "pose_landmarker.task")),
    running_mode=vision.RunningMode.IMAGE, num_poses=1,
    min_pose_detection_confidence=0.3)


def face_pts(path):
    img = mp.Image.create_from_file(str(path))
    with vision.FaceLandmarker.create_from_options(face_opt) as det:
        res = det.detect(img)
    if not res.face_landmarks:
        return None
    w, h = Image.open(path).size
    return np.array([(p.x * w, p.y * h) for p in res.face_landmarks[0]])


def pose_pts(path):
    img = mp.Image.create_from_file(str(path))
    with vision.PoseLandmarker.create_from_options(pose_opt) as det:
        res = det.detect(img)
    if not res.pose_landmarks:
        return None
    w, h = Image.open(path).size
    lm = res.pose_landmarks[0]
    return (np.array([(p.x * w, p.y * h) for p in lm]),
            np.array([p.presence for p in lm]))


# Rigid face interior (nose + eye rings): unaffected by added hair or makeup.
RIGID_FACE = [1, 2, 4, 5, 6, 8, 9, 168, 33, 133, 160, 159, 158, 153, 144, 145,
              362, 263, 387, 386, 385, 374, 380, 381, 70, 63, 105, 66, 107,
              55, 65, 52, 53, 46, 295, 285, 336, 296, 334, 293, 300, 283, 282,
              295, 271]


out = {}
for view in ("front", "three_quarter", "profile", "back"):
    rec = {"view": view}
    shifts = []
    fa, fb = face_pts(T / SRC[view]), face_pts(T / TGT[view])
    if fa is None or fb is None:
        rec["face"] = {"status": "NOT_DETECTED", "n": 0}
    else:
        d = np.linalg.norm(fa - fb, axis=1)
        dr = d[RIGID_FACE]
        shifts.append(dr)
        rec["face"] = {"status": "OK", "n_all": int(len(d)),
                       "n_rigid": int(len(dr)),
                       "all_p95": round(float(np.percentile(d, 95)), 2),
                       "rigid_p50": round(float(np.median(dr)), 2),
                       "rigid_p95": round(float(np.percentile(dr, 95)), 2),
                       "rigid_max": round(float(dr.max()), 2)}
    pa, pb = pose_pts(T / SRC[view]), pose_pts(T / TGT[view])
    if pa is None or pb is None:
        rec["pose"] = {"status": "NOT_DETECTED", "n": 0}
    else:
        (a, presa), (b, presb) = pa, pb
        keep = (presa > 0.5) & (presb > 0.5)
        d = np.linalg.norm(a[keep] - b[keep], axis=1)
        shifts.append(d)
        rec["pose"] = {"status": "OK", "n_present_both": int(keep.sum()),
                       "p50": round(float(np.median(d)), 2) if len(d) else None,
                       "p95": round(float(np.percentile(d, 95)), 2) if len(d) else None,
                       "max": round(float(d.max()), 2) if len(d) else None}
    if shifts:
        all_d = np.concatenate(shifts)
        rec["combined_p95"] = round(float(np.percentile(all_d, 95)), 2)
        rec["combined_n"] = int(len(all_d))
        rec["verdict"] = "MISALIGNED" if rec["combined_p95"] > 6.0 else "ALIGNED"
    else:
        rec["combined_p95"] = None
        rec["verdict"] = "NO_LANDMARKS"
    out[view] = rec
    print(view, json.dumps(rec))

(T / "alignment.json").write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
