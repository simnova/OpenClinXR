#!/usr/bin/env python3
"""groom35: 4-view IoU (score31-identical definition: -id alpha>=230 vs
target masks) for one render dir. Usage: iou35.py RENDERDIR TAG."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

E = Path(__file__).resolve().parent
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
MASKF = {"front": "mask-front.png",
         "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png",
         "back": "mask-back.png"}


def main():
    rdir, tag = Path(sys.argv[1]), sys.argv[2]
    out = {"tag": tag, "renders": str(rdir), "iou": {}}
    for v, mf in MASKF.items():
        ours = (np.array(Image.open(str(rdir / (v + "-id.png")))
                .convert("RGBA"))[:, :, 3] >= 230)
        tgt = np.array(Image.open(str(SCR / mf))) > 127
        assert ours.shape == tgt.shape, (ours.shape, tgt.shape)
        inter = int((tgt & ours).sum())
        union = int((tgt | ours).sum())
        out["iou"][v] = {"iou": round(inter / union, 4),
                         "missPx": int((tgt & ~ours).sum()),
                         "excessPx": int((ours & ~tgt).sum())}
        print("IOU %s %-14s %.4f" % (tag, v, inter / union), flush=True)
    (E / ("iou-%s.json" % tag)).write_text(json.dumps(out, indent=1)
                                           + "\n")


if __name__ == "__main__":
    main()
