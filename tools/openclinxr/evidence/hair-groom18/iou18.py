#!/usr/bin/env python3
"""hair-groom14 IoU helper: IoU of one render -id.png vs target mask.

Usage: iou14.py <id.png> <view> [tag]
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
MASKF = {"front": "mask-front.png",
         "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png",
         "back": "mask-back.png"}


def main():
    idp, view = sys.argv[1], sys.argv[2]
    tag = sys.argv[3] if len(sys.argv) > 3 else Path(idp).parent.name
    ours = np.array(Image.open(idp).convert("RGBA"))[:, :, 3] >= 230
    tgt = np.array(Image.open(str(SCR / MASKF[view]))) > 127
    inter = int((tgt & ours).sum())
    union = int((tgt | ours).sum())
    print("IOU %-16s %-12s %.4f  miss=%d excess=%d" % (
        tag, view, inter / union,
        int((tgt & ~ours).sum()), int((ours & ~tgt).sum())))


if __name__ == "__main__":
    main()
