"""Step 4: hair masks target-vs-source.

Hair candidate = pixels with mean|tgt-src| > DIFF (=40) AND hair-like
colour in TARGET: maxRGB in [15,130], (R-G) in [-5,30], (R-B) in [3,50],
(G-B) in [0,25] (dark warm brown; medians sampled: curtain 62/47/39,
crown 44/33/27 vs skin 195/169/152, shirt 197/181/184, backdrop 169^3).
Cleaned with 5x5 open then 5x5 close; keep components with >100 px overlap
with the head ROI (source non-backdrop pixels in the upper 55% of frame,
dilated 21px) = largest head-attached hair mass.
Body silhouette (source) = non-backdrop pixels (|V-170|>25 or S>12).
Ear line: face-mesh bbox on source (front/three_quarter: top+0.55h) else
source-pose ear-y (profile/back).
Writes mask-<view>.png, masks-overlay.png; prints mask stats JSON.
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
DIFF = 40

face_opt = vision.FaceLandmarkerOptions(
    base_options=mp_python.BaseOptions(
        model_asset_path=str(MODELS / "face_landmarker.task")),
    running_mode=vision.RunningMode.IMAGE, num_faces=1,
    min_face_detection_confidence=0.3)
pose_opt = vision.PoseLandmarkerOptions(
    base_options=mp_python.BaseOptions(
        model_asset_path=str(MODELS / "pose_landmarker.task")),
    running_mode=vision.RunningMode.IMAGE, num_poses=1)


def nonbg(rgb):
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(np.int16)
    v = hsv[:, :, 2]
    return ((np.abs(v - 170) > 25) | (hsv[:, :, 1] > 12))


def ear_y(view, src_path):
    if view in ("front", "three_quarter"):
        img = mp.Image.create_from_file(str(src_path))
        with vision.FaceLandmarker.create_from_options(face_opt) as det:
            res = det.detect(img)
        assert res.face_landmarks, "no face in %s" % src_path
        w, h = Image.open(src_path).size
        pts = np.array([(p.x * w, p.y * h) for p in res.face_landmarks[0]])
        (x0, y0), (x1, y1) = pts.min(axis=0), pts.max(axis=0)
        return float(y0 + 0.55 * (y1 - y0))
    img = mp.Image.create_from_file(str(src_path))
    with vision.PoseLandmarker.create_from_options(pose_opt) as det:
        res = det.detect(img)
    assert res.pose_landmarks, "no pose in %s" % src_path
    w, h = Image.open(src_path).size
    lm = res.pose_landmarks[0]
    ys = []
    for i in (7, 8):  # lear, rear
        ys.append(lm[i].y * h)
    return float(np.mean(ys))


stats, overlays = {}, []
for view in ("front", "three_quarter", "profile", "back"):
    s = np.asarray(Image.open(T / SRC[view]).convert("RGB"))
    t = np.asarray(Image.open(T / TGT[view]).convert("RGB"))
    h, w, _ = s.shape
    diff = np.abs(s.astype(np.float32) - t.astype(np.float32)).mean(axis=2)
    R, G, B = (t[:, :, i].astype(np.int16) for i in range(3))
    mx = t.max(axis=2).astype(np.int16)
    branchA = ((diff > DIFF) & (mx >= 8) & (mx <= 130)
               & (R - G >= -5) & (R - G <= 30)
               & (R - B >= 3) & (R - B <= 50)
               & (G - B >= 0) & (G - B <= 25))
    # Branch B: near-black occlusion seams (target mx<8 where source was
    # backdrop/skin, diff>100). Nothing else in frame is near-black.
    branchB = (mx < 8) & (diff > 100)
    cand = ((branchA | branchB)).astype(np.uint8) * 255
    cand = cv2.morphologyEx(cand, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    cand = cv2.morphologyEx(cand, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    body = nonbg(s)
    headroi = (body & (np.arange(h)[:, None] < int(h * 0.55)))
    headroi = cv2.dilate(headroi.astype(np.uint8) * 255, np.ones((21, 21), np.uint8)) > 0
    n, lab, comp_stats, _cent = cv2.connectedComponentsWithStats(cand, 8)
    keep = np.zeros((h, w), bool)
    for i in range(1, n):
        overlap = int(((lab == i) & headroi).sum())
        if overlap > 100:
            keep |= (lab == i)
    # Fill holes fully enclosed by the hair mass (specular highlights on
    # the crown that exceed the warm-dark colour box).
    from scipy.ndimage import binary_fill_holes
    keep = binary_fill_holes(keep)
    mask = (keep.astype(np.uint8)) * 255
    Image.fromarray(mask).save(T / ("mask-%s.png" % view))
    ey = ear_y(view, T / SRC[view])
    headabove = (body & (np.arange(h)[:, None] < int(ey)))
    cov = float((keep & headabove).sum() / max(1, headabove.sum()))
    inside = float((keep & body).sum() / max(1, keep.sum()))
    rec = {"hair_px": int(keep.sum()),
           "hair_frac_frame": round(float(keep.mean()), 4),
           "ear_y": round(ey, 1),
           "head_above_ears_px": int(headabove.sum()),
           "head_above_ears_covered_frac": round(cov, 4),
           "hair_inside_body_frac": round(inside, 4)}
    stats[view] = rec
    print(view, json.dumps(rec))
    ov = t.copy()
    ov[keep] = (0.55 * ov[keep] + 0.45 * np.array([0, 255, 0])).astype(np.uint8)
    overlays.append(Image.fromarray(ov).resize((512, 512)))

sheet = Image.new("RGB", (512 * 4, 512), (255, 255, 255))
for i, im in enumerate(overlays):
    sheet.paste(im, (i * 512, 0))
sheet.save(T / "masks-overlay.png")
(T / "masks.json").write_text(json.dumps(stats, indent=2, sort_keys=True) + "\n")
print("wrote masks-overlay.png", sheet.size)
