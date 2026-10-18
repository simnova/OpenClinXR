"""Any-subject face-fit landmark targets (mise python, foreground).

Card tsk_96256abb59a7b6c7. Runs the SAME MediaPipe Face Landmarker detector
that produced the committed pts_target_front.npy (detector code copied
verbatim from fit_facefit2.py:detect_points -- same task file, same
RunningMode.IMAGE, same num_faces=1; no swap, no hand-placed landmarks) on
any reference-set case's goal_front, and writes that case's target plus its
embedding entry, keyed by case id, to any-subject-targets.json.

Sources of record:
- case `aisha`: face-fit store target-front.png, sha b2f47587069b1ec0...
  (store-manifest.json + fit-report.json inputs.refSha256). This is the exact
  detector input that produced the committed pts_target_front.npy.
  (reference-set manifest.json also lists an `aisha` goal_front at
  project/edit-v9/edit-0.png sha 534c0468...; those bytes are not present on
  this machine, so the staged face-fit file -- the detector input of record
  for the fit -- is the G1 source. No re-encode: sha verified before detect.)
- case `body2`: reference-set manifest.json body2 goal_front,
  body2/goal-front.png sha b42f8105add75fb8... Bytes verified by sha wherever
  they are staged (REFERENCE_SET_STORE_ROOT/body2/goal-front.png when set,
  else the face-fit-any store vendored copy, else /tmp/goal-front.png);
  mismatch or absence is a hard refuse (no placeholder, no synthesis).

Writes (all small, in git):
  pts_target_<case>_front.npy   478x2 float64 detector output
  any-subject-targets.json      per-case target+embedding entries + G1 spread
Large input staging (>150KB): /Volumes/files/openclinxr-assets/store/
  face-fit-any/body2-goal-front.png (sha256 recorded in the JSON).
"""

import hashlib
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, "..", "..", "asset-pipeline",
                        "reference-set", "manifest.json")
FF_STORE = os.environ.get("OPENCLINXR_ASSET_STORE",
                          "/Volumes/files/openclinxr-assets/store/face-fit")
ANY_STORE = "/Volumes/files/openclinxr-assets/store/face-fit-any"
TASK_SHA = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"
AISHA_FRONT_SHA = ("b2f47587069b1ec08b55ce9a0401f4cd36d76ce8009ab83996d8ca4e2cd287be")
BODY2_GOAL_SHA = ("b42f8105add75fb8a99909126445c76cdeeecce66f431f42b02ab8d286102a97")
EYE_CORNERS = [33, 133, 362, 263]


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def detect_points(pil_path, model_path):
    """Verbatim copy of fit_facefit2.py:detect_points (same detector)."""
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    opts = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.IMAGE, num_faces=1)
    landmarker = vision.FaceLandmarker.create_from_options(opts)
    pil = Image.open(pil_path).convert("RGB")
    w, h = pil.size
    mpimg = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(pil))
    res = landmarker.detect(mpimg)
    if not res.face_landmarks:
        return None
    return np.array([[p.x * w, p.y * h] for p in res.face_landmarks[0]])


def resolve_aisha_front():
    p = os.path.join(FF_STORE, "target-front.png")
    if not os.path.isfile(p):
        raise SystemExit("any-subject refuse: aisha front absent: %s" % p)
    actual = sha256_file(p)
    if actual != AISHA_FRONT_SHA:
        raise SystemExit("any-subject refuse: aisha front sha %s != %s"
                         % (actual[:16], AISHA_FRONT_SHA[:16]))
    return p


def resolve_body2_front():
    cands = []
    env_root = os.environ.get("REFERENCE_SET_STORE_ROOT")
    if env_root:
        cands.append(os.path.join(env_root, "body2", "goal-front.png"))
    cands.append(os.path.join(ANY_STORE, "body2-goal-front.png"))
    cands.append("/tmp/goal-front.png")
    for p in cands:
        if os.path.isfile(p) and sha256_file(p) == BODY2_GOAL_SHA:
            return p
    raise SystemExit(
        "any-subject refuse: body2 goal_front sha %s not found under %s "
        "(no placeholder)" % (BODY2_GOAL_SHA[:16], cands))


def resolve_manifest_goal_front(case_id, goal_rec):
    """Resolve a manifest-driven case's goal_front bytes by its pinned sha.

    Card tsk_386c8c91eee19dca: cases beyond aisha/body2 are read from the
    reference-set manifest (case id + goal sha), never hard-coded here.
    Candidates: REFERENCE_SET_STORE_ROOT/<store_relpath>, the asset store
    copy of <store_relpath>/<path>, the face-fit-any store, /tmp. Mismatch
    or absence is a hard refuse (no placeholder, no synthesis)."""
    want = goal_rec["output"]["sha256"]
    rel = goal_rec["output"].get("store_relpath") or goal_rec["output"].get("path")
    base = os.path.basename(rel or "")
    cands = []
    env_root = os.environ.get("REFERENCE_SET_STORE_ROOT")
    if env_root and rel:
        cands.append(os.path.join(env_root, rel))
    if rel:
        cands.append(os.path.join("/Volumes/files/openclinxr-assets/store", rel))
    inp = (goal_rec.get("reference_input") or {}).get("path")
    if inp:
        cands.append(os.path.join("/Volumes/files/openclinxr-assets/store", inp))
    cands.append(os.path.join(ANY_STORE, base))
    cands.append(os.path.join("/tmp", base))
    for p in cands:
        if p and os.path.isfile(p) and sha256_file(p) == want:
            return p
    raise SystemExit(
        "any-subject refuse: %s goal_front sha %s not found under %s "
        "(no placeholder)" % (case_id, str(want)[:16], cands))


def check_target(case, pts, size, require_inside):
    w, h = size
    assert pts.shape == (478, 2), (case, pts.shape)
    inside = bool(((pts[:, 0] >= 0) & (pts[:, 0] < w)
                   & (pts[:, 1] >= 0) & (pts[:, 1] < h)).all())
    outside = int((~((pts[:, 0] >= 0) & (pts[:, 0] < w)
                     & (pts[:, 1] >= 0) & (pts[:, 1] < h))).sum())
    if require_inside:
        assert inside, "%s: %d points outside %sx%s" % (case, outside, w, h)
    corners = {i: [round(float(v), 3) for v in pts[i]] for i in EYE_CORNERS}
    lw = abs(float(pts[133, 0] - pts[33, 0]))
    rw = abs(float(pts[263, 0] - pts[362, 0]))
    assert lw > 10 and rw > 10, "%s: eye-corner pairs degenerate" % case
    return corners, outside


def main():
    model = os.path.join(FF_STORE, "face_landmarker.task")
    if sha256_file(model) != TASK_SHA:
        raise SystemExit("any-subject refuse: task bundle sha drift")
    manifest = json.load(open(MANIFEST))
    assert (manifest["cases"]["body2"]["references"]["goal_front"]
            ["output"]["sha256"] == BODY2_GOAL_SHA), "manifest body2 sha drift"

    # Stage body2 bytes into the face-fit-any store (>150KB rule) when the
    # reference-set root is not configured on this machine.
    staged = os.path.join(ANY_STORE, "body2-goal-front.png")
    src_body2 = resolve_body2_front()
    if os.path.abspath(src_body2) != os.path.abspath(staged):
        os.makedirs(ANY_STORE, exist_ok=True)
        shutil.copyfile(src_body2, staged)
    assert sha256_file(staged) == BODY2_GOAL_SHA
    src_aisha = resolve_aisha_front()

    emb = json.load(open(os.path.join(HERE, "embedding.json")))
    emb_sha = sha256_file(os.path.join(HERE, "embedding.json"))
    legacy = np.load(os.path.join(HERE, "pts_target_front.npy"))

    cases = {}
    for case, src in (("aisha", src_aisha), ("body2", staged)):
        pil_size = Image.open(src).size
        runs = [detect_points(src, model) for _ in range(3 if case == "aisha" else 1)]
        assert all(r is not None and r.shape == (478, 2) for r in runs), \
            "%s: detector found no face" % case
        if case == "aisha":
            spread = float(max(float(np.abs(r - legacy).max()) for r in runs))
            payload_match = all(
                hashlib.sha256(r.tobytes()).hexdigest()
                == hashlib.sha256(legacy.tobytes()).hexdigest() for r in runs)
            print("ANY_G1 runs=3 maxAbsDiff=%.6f byteIdentical=%s"
                  % (spread, payload_match))
            assert spread == 0.0 and payload_match, "G1: aisha drift"
        pts = runs[0]
        corners, outside = check_target(case, pts, pil_size,
                                          require_inside=(case != "aisha"))
        out_npy = os.path.join(HERE, "pts_target_%s_front.npy" % case)
        np.save(out_npy, pts)
        if case == "aisha":
            assert (open(out_npy, "rb").read()
                    == open(os.path.join(HERE, "pts_target_front.npy"), "rb").read()), \
                "G1: aisha per-case npy not byte-identical to legacy"
        cases[case] = {
            "source": {
                "aisha": "face-fit store target-front.png (detector input of record)",
                "body2": "reference-set body2/goal-front.png (manifest.json)",
            }[case],
            "sourceSha256": sha256_file(src),
            "imageSize": [int(pil_size[0]), int(pil_size[1])],
            "targetNpy": "tools/openclinxr/evidence/face-fit/pts_target_%s_front.npy" % case,
            "targetSha256": sha256_file(out_npy),
            "nPoints": 478,
            "allInsideImage": bool(outside == 0),
            "outsideCount": int(outside),
            "eyeCorners": corners,
            "embedding": {
                "file": "tools/openclinxr/evidence/face-fit/embedding.json",
                "sha256": emb_sha,
                "n": int(len(emb["landmarks"])),
                "trackN": 35,
                "contourExcluded": [58, 172, 234, 288, 454],
                "fallbacks": int(emb["fallbacks"]),
                "note": "shared neutral-mesh barycentric triples (base-derived, subject-independent)",
            },
        }
        print("ANY_TARGET %s n=478 inside=%sx%s corners L=%.1f R=%.1f" % (
            case, pil_size[0], pil_size[1],
            abs(float(pts[133, 0] - pts[33, 0])),
            abs(float(pts[263, 0] - pts[362, 0]))))

    # Aisha 3q (front-fit record; body2 has no reference-set goal_yaw).
    q_path = os.path.join(FF_STORE, "target-3q-left.png")
    q_sha = sha256_file(q_path)
    assert q_sha == "f5e719a7d4575a043ea6e1d5f1cbc44f28d8140186b219925bfb8c05af13b624"
    cases["aisha"]["source3q"] = "face-fit store target-3q-left.png"
    cases["aisha"]["source3qSha256"] = q_sha
    cases["aisha"]["target3qNpy"] = \
        "tools/openclinxr/evidence/face-fit/pts_target_3q.npy"
    cases["aisha"]["target3qSha256"] = sha256_file(
        os.path.join(HERE, "pts_target_3q.npy"))
    cases["body2"]["source3q"] = None
    cases["body2"]["note"] = ("no reference-set goal_yaw for body2; "
                              "front-only fit (same 2x yaw-scan exclusion rule)")

    # Manifest-driven extra cases (card tsk_386c8c91eee19dca): every
    # reference-set case beyond aisha/body2 carrying a goal_front prompt +
    # output sha gets the same detector/model treatment as body2 (single
    # run, inside-gated, shared embedding entry, front-only). aisha/body2
    # above are untouched so their entries reproduce byte-identically.
    for case in sorted(manifest["cases"]):
        if case in cases:
            continue
        goal_rec = ((manifest["cases"][case] or {}).get("references") or {}).get("goal_front")
        if not isinstance(goal_rec, dict):
            continue
        if not isinstance(goal_rec.get("prompt"), str):
            continue
        if not isinstance((goal_rec.get("output") or {}).get("sha256"), str):
            continue
        src = resolve_manifest_goal_front(case, goal_rec)
        pil_size = Image.open(src).size
        runs = [detect_points(src, model)]
        assert all(r is not None and r.shape == (478, 2) for r in runs), \
            "%s: detector found no face" % case
        pts = runs[0]
        corners, outside = check_target(case, pts, pil_size, require_inside=True)
        out_npy = os.path.join(HERE, "pts_target_%s_front.npy" % case)
        np.save(out_npy, pts)
        cases[case] = {
            "source": "reference-set %s goal_front (manifest.json)" % case,
            "sourceSha256": sha256_file(src),
            "imageSize": [int(pil_size[0]), int(pil_size[1])],
            "targetNpy": "tools/openclinxr/evidence/face-fit/pts_target_%s_front.npy" % case,
            "targetSha256": sha256_file(out_npy),
            "nPoints": 478,
            "allInsideImage": bool(outside == 0),
            "outsideCount": int(outside),
            "eyeCorners": corners,
            "embedding": {
                "file": "tools/openclinxr/evidence/face-fit/embedding.json",
                "sha256": emb_sha,
                "n": int(len(emb["landmarks"])),
                "trackN": 35,
                "contourExcluded": [58, 172, 234, 288, 454],
                "fallbacks": int(emb["fallbacks"]),
                "note": "shared neutral-mesh barycentric triples (base-derived, subject-independent)",
            },
        }
        print("ANY_TARGET %s n=478 inside=%sx%s corners L=%.1f R=%.1f" % (
            case, pil_size[0], pil_size[1],
            abs(float(pts[133, 0] - pts[33, 0])),
            abs(float(pts[263, 0] - pts[362, 0]))))
        cases[case]["source3q"] = None
        cases[case]["note"] = ("no reference-set goal_yaw for %s; "
                               "front-only fit (same 2x yaw-scan exclusion rule)" % case)

    doc = {
        "card": "tsk_96256abb59a7b6c7",
        "detector": {
            "model": "MediaPipe Face Landmarker (Apache-2.0)",
            "taskFile": os.path.join(FF_STORE, "face_landmarker.task"),
            "taskSha256": TASK_SHA,
            "runningMode": "IMAGE",
            "numFaces": 1,
            "nPoints": 478,
            "codeRef": ("fit_facefit2.py:detect_points verbatim copy "
                        "(same options; no swap, no hand landmarks)"),
        },
        "g1": {"runs": 3, "maxAbsDiffPx": 0.0, "byteIdentical": True,
               "legacyFile": "tools/openclinxr/evidence/face-fit/pts_target_front.npy",
               "legacySha256": sha256_file(
                   os.path.join(HERE, "pts_target_front.npy"))},
        "cases": cases,
    }
    json.dump(doc, open(os.path.join(HERE, "any-subject-targets.json"), "w"), indent=1)
    print("ANY_DONE cases=%s" % sorted(cases))


if __name__ == "__main__":
    sys.exit(main())
