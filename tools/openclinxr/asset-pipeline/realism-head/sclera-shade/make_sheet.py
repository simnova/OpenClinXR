"""Eye-band sheet builder (CARD tsk_57f4ae74d62739e0).

Band crops PRE | POST | goal side by side, both subjects, front and yaw25.
Each crop is native pixels (no rescale, never upscale); every crop is padded
(not scaled) to >= 420 px wide. Front panels are PRE|POST|goal; yaw25 panels
are PRE|POST (no yaw25 goal photo exists). Panels stack the three crops with
a 4px black divider, heights padded to the tallest crop.

Usage:
  mise exec -C /Volumes/files/src/openclinxr -- python3 \
    tools/openclinxr/asset-pipeline/realism-head/sclera-shade/make_sheet.py \
    --post <label> --post-front-aisha <png> --post-front-body2 <png> \
    --post-yaw25-aisha <png> --post-yaw25-body2 <png> \
    --out <sheet dir>
PRE frames and goal photos are pinned below (store + realism-95 worktree).
"""
import argparse
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sclera_metrics as sm

STORE = "/Volumes/files/openclinxr-assets/store"
PRE = {
    ("aisha", "front"): f"{STORE}/shell-placement/pre/aisha-render/ss-aisha-pre-front.png",
    ("aisha", "yaw25"): f"{STORE}/shell-placement/pre/aisha-yaw25/ss-aisha-pre-yaw25-yaw25.png",
    ("body2", "front"): f"{STORE}/shell-placement/pre/body2-render/b2s4-pre-front.png",
    ("body2", "yaw25"): f"{STORE}/shell-placement/pre/body2-yaw25/b2s4-pre-yaw25-yaw25.png",
}
GOAL = {
    "aisha": "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/project/edit-v9/edit-0.png",
    "body2": "/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/body2/goal-front.png",
}
MIN_W = 420


def eye_band_crop(path):
    """Native-pixel eye-band crop spanning both eyes with margin; >= 420 wide."""
    rgb = np.array(Image.open(path).convert("RGB"))
    h, w = rgb.shape[:2]
    pts = sm.detect_landmarks(rgb)
    polys = [pts[sm.EYE_R], pts[sm.EYE_L]]
    allp = np.vstack(polys)
    x0, y0 = allp.min(axis=0)
    x1, y1 = allp.max(axis=0)
    ew, eh = (x1 - x0), (y1 - y0)
    # margin: 0.35 eye-span each side, 1.6x height (matches metrics band feel)
    mx, my = 0.35 * ew, 0.9 * eh
    x0i, x1i = int(max(0, x0 - mx)), int(min(w, x1 + mx))
    y0i, y1i = int(max(0, y0 - my)), int(min(h, y1 + my))
    crop = rgb[y0i:y1i, x0i:x1i].copy()
    if crop.shape[1] < MIN_W:
        pad = MIN_W - crop.shape[1]
        left = pad // 2
        crop = np.pad(crop, ((0, 0), (left, pad - left), (0, 0)), mode="constant")
    return crop


def stack(crops):
    hh = max(c.shape[0] for c in crops)
    div = np.zeros((hh, 4, 3), dtype=np.uint8)
    parts = []
    for c in crops:
        if c.shape[0] < hh:
            c = np.pad(c, ((0, hh - c.shape[0]), (0, 0), (0, 0)), mode="constant")
        parts.append(c)
        parts.append(div)
    parts.pop()
    return np.concatenate(parts, axis=1)


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--post", required=True)
    ap.add_argument("--post-front-aisha", required=True)
    ap.add_argument("--post-front-body2", required=True)
    ap.add_argument("--post-yaw25-aisha", required=True)
    ap.add_argument("--post-yaw25-body2", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    post = {
        ("aisha", "front"): args.post_front_aisha,
        ("aisha", "yaw25"): args.post_yaw25_aisha,
        ("body2", "front"): args.post_front_body2,
        ("body2", "yaw25"): args.post_yaw25_body2,
    }
    manifest = {}
    for subject in ("aisha", "body2"):
        for view in ("front", "yaw25"):
            paths = [PRE[(subject, view)], post[(subject, view)]]
            if view == "front":
                paths.append(GOAL[subject])
            crops = [eye_band_crop(p) for p in paths]
            for p, c in zip(paths, crops):
                print(f"crop {subject} {view} {os.path.basename(p)}: {c.shape[1]}x{c.shape[0]}")
                assert c.shape[1] >= MIN_W, f"crop too narrow: {c.shape[1]}"
            panel = stack(crops)
            name = f"band-{subject}-{args.post}-{view}.png"
            outp = os.path.join(args.out, name)
            Image.fromarray(panel).save(outp)
            manifest[name] = sha(outp)
            print(f"wrote {outp} {panel.shape[1]}x{panel.shape[0]} sha256={manifest[name]}")
    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
