"""Step 3b: detector-independent alignment via ECC translation.

For each view, estimate the translation mapping target->source with
OpenCV ECC (affine, translation-only read-out) on two regions that the
edit must not touch:
  1. background: grey backdrop (low saturation in SOURCE), eroded.
  2. face interior: shrunk face bbox from the face landmarker (front /
     three_quarter only; profile/back have no usable face box).
Also report the fraction of background pixels that change strongly
(should be ~0 if the camera did not move).
Writes ecc.json to T.
"""
import json
from pathlib import Path

import cv2
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


def ecc_shift(src_g, tgt_g, mask, iters=200):
    warp = np.eye(2, 3, dtype=np.float32)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, iters, 1e-6)
    try:
        _cc, warp = cv2.findTransformECC(src_g, tgt_g, warp,
                                         cv2.MOTION_TRANSLATION, crit, mask, 1)
    except cv2.error as e:
        return None, str(e)
    return (float(warp[0, 2]), float(warp[1, 2])), None


face_opt = vision.FaceLandmarkerOptions(
    base_options=mp_python.BaseOptions(
        model_asset_path=str(MODELS / "face_landmarker.task")),
    running_mode=vision.RunningMode.IMAGE, num_faces=1,
    min_face_detection_confidence=0.3)

out = {}
for view in ("front", "three_quarter", "profile", "back"):
    s = np.asarray(Image.open(T / SRC[view]).convert("RGB"))
    t = np.asarray(Image.open(T / TGT[view]).convert("RGB"))
    sg = (cv2.cvtColor(s, cv2.COLOR_RGB2GRAY)).astype(np.float32) / 255.0
    tg = (cv2.cvtColor(t, cv2.COLOR_RGB2GRAY)).astype(np.float32) / 255.0
    hsv = cv2.cvtColor(s, cv2.COLOR_RGB2HSV)
    bg = ((hsv[:, :, 1] < 25) & (hsv[:, :, 2] > 70)).astype(np.uint8) * 255
    bg = cv2.erode(bg, np.ones((15, 15), np.uint8))
    rec = {"bg_px": int((bg > 0).sum())}
    (res, err) = ecc_shift(sg, tg, bg)
    rec["bg_shift_xy"] = [round(res[0], 2), round(res[1], 2)] if err is None else None
    rec["bg_ecc_error"] = err
    rec["bg_shift_mag"] = round(float(np.hypot(*res)), 2) if err is None else None
    strong = (np.abs(s.astype(np.float32) - t.astype(np.float32)).mean(axis=2) > 40)
    rec["bg_strong_change_frac"] = round(float(strong[bg > 0].mean()), 4)
    # Face interior box (shrunk bbox around eyes+nose from landmarker on source).
    rec["face_shift_xy"] = None
    img = mp.Image.create_from_file(str(T / SRC[view]))
    with vision.FaceLandmarker.create_from_options(face_opt) as det:
        res = det.detect(img)
    if res.face_landmarks:
        w, h = Image.open(T / SRC[view]).size
        pts = np.array([(p.x * w, p.y * h) for p in res.face_landmarks[0]])
        x0, y0 = pts.min(axis=0)
        x1, y1 = pts.max(axis=0)
        bw, bh = x1 - x0, y1 - y0
        # Interior: central 50% x 40% (eyes/nose), avoids hair-covered contour.
        ix0, ix1 = int(x0 + bw * 0.25), int(x0 + bw * 0.75)
        iy0, iy1 = int(y0 + bh * 0.25), int(y0 + bh * 0.65)
        fmask = np.zeros((h, w), np.uint8)
        fmask[iy0:iy1, ix0:ix1] = 255
        (fres, ferr) = ecc_shift(sg, tg, fmask)
        rec["face_box"] = [ix0, iy0, ix1, iy1]
        rec["face_shift_xy"] = [round(fres[0], 2), round(fres[1], 2)] if ferr is None else None
        rec["face_ecc_error"] = ferr
        rec["face_shift_mag"] = round(float(np.hypot(*fres)), 2) if ferr is None else None
    out[view] = rec
    print(view, json.dumps(rec))

(T / "ecc.json").write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
