#!/usr/bin/env python3
"""STEP 1: 2D orientation maps for the four aisha-v3 targets.

Gabor bank: hair-score/orientation.py (pinned: KSIZE 15, wavelength
4.0 px, sigma 3.0, gamma 0.5, psi 0, 180 orientations at 1 deg steps;
single scale). Confidence = (peak - mean) / (peak + eps) (module
definition). Identity registration (v4 manifest): render frame IS the
target frame, no warp. Orientation_map runs on a mask-bbox crop (+8 px
margin = kernel radius 7 + 1; interior exact) and is embedded back to
the full 1024 frame.

Angle convention (measured, synthetic λ=4 grating probe): orientation_map
returns the Gabor wave-vector/normal angle a (filter-theta frame, mod
180); the strand TANGENT line is a+90 deg. Tangent image vector in
(dcol, drow) px: t = (-sin a, cos a). All downstream stages (plane
construction, residual angles, guide agreement) use this mapping; the
residual report validates it (a 90 deg flip would read ~90 deg).

Outputs: E/orient2d.npz (angle/filter-theta float32 + conf float32 +
mask per view, full 1024 frame) + E/orient2d.png (per view: target
thumb + orientation-as-hue/brightness=confidence map).
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np

S10 = Path(__file__).resolve().parent
sys.path.insert(0, str(S10))
sys.path.insert(0, str(S10.parent / "route"))
sys.path.insert(0, str(S10.parent / "cage"))
sys.path.insert(0, str(S10.parent))
import common_o as CO  # noqa: E402

sys.path.insert(0, str(CO.ROOT / "tools/openclinxr/evidence/hair-score"))
import orientation as ORI  # noqa: E402  (Gabor bank, read-only import)

MARGIN = 8  # >= kernel radius 7 -> crop interior exact


def tangent_from_angle(a):
    """Strand tangent unit vectors in (dcol, drow) from filter angle."""
    return np.stack([-np.sin(np.deg2rad(a)), np.cos(np.deg2rad(a))],
                    axis=-1)


def hsv_map(angles, conf, mask):
    """Orientation as hue (angle/180), brightness = confidence."""
    h = (np.asarray(angles, dtype=np.float64) % 180.0) / 180.0
    v = np.clip(np.asarray(conf, dtype=np.float64), 0, 1)
    v = np.where(mask, v, 0.0)
    s = np.where(mask, 1.0, 0.0)
    i = (h * 6.0).astype(np.int64) % 6
    f = h * 6.0 - np.floor(h * 6.0)
    p = v * (1 - s)
    q = v * (1 - f * s)
    t = v * (1 - (1 - f) * s)
    r = np.choose(i, [v, q, p, p, t, v])
    g = np.choose(i, [t, v, v, q, p, p])
    b = np.choose(i, [p, p, t, v, v, q])
    return np.stack([r, g, b], axis=-1)


def main():
    t0 = time.time()
    CO.track(S10 / "s01_orient2d.py")
    CO.track(CO.ROOT / "tools/openclinxr/evidence/hair-score"
             / "orientation.py")
    inp = CO.load_all()
    out = {}
    stats = {}
    for view in CO.VIEWS4:
        beauty = inp["targets"][view]
        mask = np.array(inp["masks"][view], dtype=bool)
        gray = (0.2126 * beauty[..., 0] + 0.7152 * beauty[..., 1]
                + 0.0722 * beauty[..., 2])
        ys, xs = np.nonzero(mask)
        y0, y1 = max(int(ys.min()) - MARGIN, 0), min(int(ys.max())
                                                    + MARGIN + 1, 1024)
        x0, x1 = max(int(xs.min()) - MARGIN, 0), min(int(xs.max())
                                                    + MARGIN + 1, 1024)
        a_crop, c_crop = ORI.orientation_map(gray[y0:y1, x0:x1])
        ang = np.zeros((1024, 1024), dtype=np.float32)
        conf = np.zeros((1024, 1024), dtype=np.float32)
        ang[y0:y1, x0:x1] = a_crop
        conf[y0:y1, x0:x1] = c_crop
        out[view + "/angle"] = ang
        out[view + "/conf"] = conf
        out[view + "/mask"] = mask
        cm = conf[mask]
        stats[view] = {
            "maskPx": int(mask.sum()),
            "confMean": round(float(cm.mean()), 3),
            "confMin": round(float(cm.min()), 3),
            "confP5": round(float(np.percentile(cm, 5)), 3),
            "bbox": [y0, y1, x0, x1]}
        print("MAP %s mask=%d confMean=%.3f confMin=%.3f" % (
            view, stats[view]["maskPx"], stats[view]["confMean"],
            stats[view]["confMin"]), flush=True)
    CO.E0.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(str(CO.E0 / "orient2d.npz"), **out)
    print("WROTE orient2d.npz", flush=True)

    # Figure: per view (target | orientation-as-colour).
    from PIL import Image
    cols = []
    for view in CO.VIEWS4:
        tgt = (np.clip(inp["targets"][view], 0, 1) * 255).astype(np.uint8)
        mp = hsv_map(out[view + "/angle"], out[view + "/conf"],
                     out[view + "/mask"])
        col = np.zeros((512 * 2 + 28, 512, 3), dtype=np.uint8)
        col[:512] = np.asarray(Image.fromarray(tgt).resize((512, 512)))
        col[512 + 28:] = (np.clip(mp, 0, 1) * 255).astype(np.uint8)[
            ::2, ::2][:512]
        cols.append(col)
    fig = np.zeros((512 * 2 + 28, 512 * 4, 3), dtype=np.uint8)
    labels = ["front target/map", "three_quarter target/map",
              "profile_90 target/map", "back target/map"]
    for i, col in enumerate(cols):
        fig[:, 512 * i:512 * (i + 1)] = col[:fig.shape[0]]
    Image.fromarray(fig).save(CO.E0 / "orient2d.png")
    print("WROTE orient2d.png views=%s" % (labels,), flush=True)
    import json
    (CO.E0 / "orient2d-stats.json").write_text(
        json.dumps(stats, indent=1) + "\n")
    CO.write_inputs_log([S10 / "s01_orient2d.py", CO.E0 / "orient2d.npz"])
    print("STEP1 done in %.0fs" % (time.time() - t0), flush=True)


if __name__ == "__main__":
    main()
