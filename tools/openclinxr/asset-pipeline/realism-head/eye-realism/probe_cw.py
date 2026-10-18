"""Shared-landmark constancy witnesses for the eyeshade card.

MediaPipe landmarks jitter ~0.5px between renders of the same pose; the
CW iris/CL metrics use small populations (disc means, single max box), so
per-image detection confounds appearance change with detection jitter
(measured 2026-10-18: full-disc euclid 9.89 per-image vs 5.31 shared on
aisha-front). This probe detects ONCE on PRE and applies the same circles
to POST, isolating appearance change. Iris core = 2px-eroded disc (rim
excluded); CL peak = same max-5x5-box routine over the shared disc.

Usage:
  mise exec -C /Volumes/files/src/openclinxr -- python3 probe_cw.py
Writes eyes-runtime-shading/frames/cw.json
"""
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "sclera-shade"))
import sclera_metrics as sm  # noqa: E402
import measure_catchlight as mc  # noqa: E402

STORE = "/Volumes/files/openclinxr-assets/store/eyes-runtime-shading/frames"
CELLS = ["aisha-front", "aisha-yaw25", "body2-front", "body2-yaw25"]


def disc_vals(L, rgb, cx, cy, radius):
    h, w = L.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    inside = (xx - cx) ** 2 + (yy - cy) ** 2 <= radius**2
    return L[inside], rgb[inside]


def main():
    out = {}
    for cell in CELLS:
        pre_p = os.path.join(STORE, f"pre-{cell}.png")
        post_p = os.path.join(STORE, f"post-{cell}.png")
        pre_rgb = np.array(Image.open(pre_p).convert("RGB"))
        post_rgb = np.array(Image.open(post_p).convert("RGB"))
        Lpre = sm.srgb_to_lab_l(pre_rgb)
        Lpost = sm.srgb_to_lab_l(post_rgb)
        pts = sm.detect_landmarks(pre_rgb)
        iris_ds = []
        cl_pres = []
        cl_posts = []
        for ring, pupil in (sm.IRIS_R, sm.IRIS_L):
            ctr = pts[pupil]
            rr = float(np.max(np.linalg.norm(pts[ring] - ctr, axis=1)))
            cx, cy = float(ctr[0]), float(ctr[1])
            # Iris core: 2px-eroded disc means (rim excluded).
            _, rgb_pre = disc_vals(Lpre, pre_rgb, cx, cy, rr - 2.0)
            _, rgb_post = disc_vals(Lpost, post_rgb, cx, cy, rr - 2.0)
            d = rgb_post.mean(axis=0) - rgb_pre.mean(axis=0)
            iris_ds.append(float(np.linalg.norm(d)))
            # CL peak over the SHARED disc (same routine as measure_catchlight).
            v_pre = mc.box5_max_mean(Lpre, cx, cy, rr)
            v_post = mc.box5_max_mean(Lpost, cx, cy, rr)
            cl_pres.append(v_pre)
            cl_posts.append(v_post)
        iris_euclid = round(float(np.mean(iris_ds)), 2)
        cl_d = round(float(max(cl_posts) - max(cl_pres)), 3)
        nz = json.load(open(os.path.join(STORE, "noise.json")))
        pre_cl = json.load(open(os.path.join(STORE, f"pre-{cell}.catchlight.json")))
        out[cell] = {
            "irisCoreEuclidShared": iris_euclid,
            "irisFloor": nz[f"pre-{cell}"]["irisEuclidFloor"],
            "irisVerdict": "pass" if iris_euclid <= nz[f"pre-{cell}"]["irisEuclidFloor"] else "fail",
            "catchlightPeakDShared": cl_d,
            "catchlightNoisePRE": pre_cl["catchlightNoiseL"],
            "catchlightVerdict": "pass" if abs(cl_d) <= max(pre_cl["catchlightNoiseL"], 0.5) else "fail",
            "perEyeIrisD": [round(float(x), 2) for x in iris_ds],
            "perEyeCL": [{"pre": round(float(a), 2), "post": round(float(b), 2)} for a, b in zip(cl_pres, cl_posts)],
        }
        print(f"OK {cell} irisCore={iris_euclid} (floor {out[cell]['irisFloor']}) CLd={cl_d} (noise {pre_cl['catchlightNoiseL']})")
    json.dump(out, open(os.path.join(STORE, "cw.json"), "w"), indent=1)
    print("wrote cw.json")


if __name__ == "__main__":
    main()
