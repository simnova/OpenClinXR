#!/usr/bin/env python3
"""hair-groom14 STEP 0: scorer calibration.

Scores groom8a's renders-studio with the SAME registration/masks/thresholds
as score13.py, so the calibrated scorer can be compared against groom8a's
own RESULT numbers (front 0.7446, 3q 0.8261, profile 0.8543, back 0.8579).

Usage: python3 calibrate20.py [--renders DIR] [--tag TAG]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")

VIEWS = ("front", "three_quarter", "profile_90", "back")
MASKF = {"front": "mask-front.png",
         "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png",
         "back": "mask-back.png"}

EXPECT = {"front": 0.7446, "three_quarter": 0.8261,
          "profile_90": 0.8543, "back": 0.8579}


def load_id(iddir, v):
    return (np.array(Image.open(str(iddir / (v + "-id.png")))
            .convert("RGBA"))[:, :, 3] >= 230)


def load_mask(v):
    return np.array(Image.open(str(SCR / MASKF[v]))) > 127


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--renders", default=str(
        ROOT / "tools/openclinxr/evidence/hair-groom8a/renders-studio"))
    ap.add_argument("--tag", default="groom8a")
    args = ap.parse_args()
    iddir = Path(args.renders)
    out = {"tag": args.tag, "renders": str(iddir), "iou": {}, "delta": {}}
    bad = False
    for v in VIEWS:
        ours = load_id(iddir, v)
        tgt = load_mask(v)
        inter = int((tgt & ours).sum())
        union = int((tgt | ours).sum())
        iou = inter / union
        out["iou"][v] = {
            "iou": round(iou, 4),
            "missPx": int((tgt & ~ours).sum()),
            "excessPx": int((ours & ~tgt).sum())}
        d = round(iou - EXPECT[v], 4)
        out["delta"][v] = d
        if abs(d) > 0.02:
            bad = True
        print("CAL %s %-14s iou=%.4f expect=%.4f delta=%+.4f"
              % (args.tag, v, iou, EXPECT[v], d), flush=True)
    out["all_within_0.02"] = not bad
    print("CAL all_within_0.02=%s" % (not bad), flush=True)
    Path(args.tag + "-calib.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
