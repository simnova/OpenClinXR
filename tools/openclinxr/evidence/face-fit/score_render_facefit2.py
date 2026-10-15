"""facefit2 render score (mise python, foreground): re-detect CHECK.

Detects MediaPipe landmarks on fitted-front.png (Blender render of the
fitted mesh), aligns to the base frame on STABLE, and compares against the
goal alignment. Updates fit-report.json checkRender. The render is the
check, never the objective (CW).
"""

import hashlib
import json
import os

import numpy as np
from PIL import Image

D = "/Users/patrick/.grok/worktrees/src-openclinxr/facefit2/tools/openclinxr/evidence/face-fit"
MODEL = os.path.join(D, "face_landmarker.task")
STABLE = [33, 133, 362, 263, 168, 6]


def detect_points(pil_path):
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    opts = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=MODEL),
        running_mode=vision.RunningMode.IMAGE, num_faces=1)
    landmarker = vision.FaceLandmarker.create_from_options(opts)
    pil = Image.open(pil_path).convert("RGB")
    w, h = pil.size
    mpimg = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(pil))
    res = landmarker.detect(mpimg)
    assert res.face_landmarks, "no face in " + pil_path
    return np.array([[p.x * w, p.y * h] for p in res.face_landmarks[0]])


def umeyama_similarity(src, dst):
    mu_s = src.mean(0)
    mu_d = dst.mean(0)
    a = src - mu_s
    b = dst - mu_d
    h = a.T @ b / len(src)
    u, sv, vt = np.linalg.svd(h)
    r = vt.T @ u.T
    if np.linalg.det(r) < 0:
        vt[-1] *= -1
        r = vt.T @ u.T
    cov = h * len(src)
    s = float((r * cov).trace() / ((a ** 2).sum()))
    t = mu_d - s * (r @ mu_s)
    return s, r, t


def main():
    report = json.load(open(os.path.join(D, "fit-report.json")))
    report0 = json.load(open(os.path.join(D, "fit-report.json")))
    emb = json.load(open(os.path.join(D, "embedding.json")))
    contour = set(report0["embedding"]["contourExcluded"])
    landmarks = [lm for lm in emb["landmarks"] if lm not in contour]
    mmpp = emb["mmPerPix"]
    print("FF2_SCORE track=%d" % len(landmarks))
    pts_base = np.load(os.path.join(D, "pts_base_front.npy"))
    pts_tgt = np.load(os.path.join(D, "pts_target_front.npy"))
    pts_fit = detect_points(os.path.join(D, "fitted-front.png"))
    np.save(os.path.join(D, "pts_fitted_front.npy"), pts_fit)

    # same alignments as the fit: goal->base and fitted-render->base on STABLE
    s, rm, t = umeyama_similarity(np.array([pts_tgt[i] for i in STABLE]),
                                  np.array([pts_base[i] for i in STABLE]))
    tgt_al = s * (pts_tgt @ rm.T) + t
    sf, rf, tf = umeyama_similarity(np.array([pts_fit[i] for i in STABLE]),
                                    np.array([pts_base[i] for i in STABLE]))
    fit_al = sf * (pts_fit @ rf.T) + tf

    d = np.array([fit_al[lm] - tgt_al[lm] for lm in landmarks]) * mmpp
    redetect = float(np.sqrt((d ** 2).mean()))
    analytic = report["aisha"]["onTrackMm"]
    floor = report["selfCheck"]["detectorRmsMm"]
    ok = bool(redetect <= analytic + floor)
    print("FF2_REDETECT redetect=%.3f analytic=%.3f floor=%.3f pass=%s" % (
        redetect, analytic, floor, ok))
    report["checkRender"] = {
        "png": "tools/openclinxr/evidence/face-fit/fitted-front.png",
        "pts": "tools/openclinxr/evidence/face-fit/pts_fitted_front.npy",
        "redetectMm": round(redetect, 3),
        "analyticMm": analytic,
        "detectorFloorMm": floor,
        "pass": ok,
        "gate": "redetect <= analytic + detector floor (render confirms fit)",
        "sha256": hashlib.sha256(
            open(os.path.join(D, "fitted-front.png"), "rb").read()).hexdigest(),
    }
    json.dump(report, open(os.path.join(D, "fit-report.json"), "w"), indent=1)


main()
