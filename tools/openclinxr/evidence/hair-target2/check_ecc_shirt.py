"""Step 3c: shirt-region ECC + overlay strips for visual read.

Shirt = pink pixels in SOURCE (R>150, R-B>40, R-G>50), lower 60% of frame,
eroded: the region the edit must not touch. ECC translation target->source.
Also writes overlay-<view>.png (red=source edges, cyan=target edges) to T.
Appends shirt_ecc + overlay path into ecc.json.
"""
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

T = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v1")
SRC = {"front": "source-front.png", "three_quarter": "source-three_quarter.png",
       "profile": "source-profile_90.png", "back": "source-back.png"}
TGT = {"front": "target-front.png", "three_quarter": "target-three_quarter.png",
       "profile": "target-profile.png", "back": "target-back.png"}

ecc = json.loads((T / "ecc.json").read_text())


def ecc_shift(src_g, tgt_g, mask, iters=300):
    warp = np.eye(2, 3, dtype=np.float32)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, iters, 1e-6)
    try:
        _cc, warp = cv2.findTransformECC(src_g, tgt_g, warp,
                                         cv2.MOTION_TRANSLATION, crit, mask, 1)
    except cv2.error as e:
        return None, str(e).split("\n")[0]
    return (float(warp[0, 2]), float(warp[1, 2])), None


for view in ("front", "three_quarter", "profile", "back"):
    s = np.asarray(Image.open(T / SRC[view]).convert("RGB"))
    t = np.asarray(Image.open(T / TGT[view]).convert("RGB"))
    R, G, B = s[:, :, 0].astype(np.int16), s[:, :, 1].astype(np.int16), s[:, :, 2].astype(np.int16)
    # Rendered shirt is washed-out pink-grey ~(203,187,191); skin is more
    # saturated (B<=~150); backdrop is darker grey (~170). Sampled medians.
    shirt = ((R > 175) & (G > 160) & (B > 160)
             & (np.abs(R - B) < 30) & (np.abs(R - G) < 35)).astype(np.uint8) * 255
    h, w = shirt.shape
    shirt[:int(h * 0.45), :] = 0
    shirt = cv2.erode(shirt, np.ones((15, 15), np.uint8))
    rec = ecc[view]
    rec["shirt_px"] = int((shirt > 0).sum())
    sg = cv2.cvtColor(s, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    tg = cv2.cvtColor(t, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    (res, err) = ecc_shift(sg, tg, shirt)
    rec["shirt_shift_xy"] = [round(res[0], 2), round(res[1], 2)] if err is None else None
    rec["shirt_shift_mag"] = round(float(np.hypot(*res)), 2) if err is None else None
    rec["shirt_ecc_error"] = err
    # Overlay: red = source Canny edges, cyan = target Canny edges.
    se = cv2.Canny(cv2.cvtColor(s, cv2.COLOR_RGB2GRAY), 80, 180)
    te = cv2.Canny(cv2.cvtColor(t, cv2.COLOR_RGB2GRAY), 80, 180)
    ov = np.zeros((h, w, 3), np.uint8)
    ov[:, :, 0] = np.maximum(se, te)  # red channel: both
    ov[:, :, 1] = te  # green: target only -> cyan where target-only
    ov[:, :, 2] = te
    # source-only edges appear pure red; target-only appear cyan; shared appear white-ish
    Image.fromarray(ov).save(T / ("overlay-%s.png" % view))
    rec["overlay"] = "overlay-%s.png" % view
    print(view, json.dumps({k: rec[k] for k in ("shirt_px", "shirt_shift_xy",
                                                "shirt_shift_mag", "shirt_ecc_error")}))

(T / "ecc.json").write_text(json.dumps(ecc, indent=2, sort_keys=True) + "\n")
