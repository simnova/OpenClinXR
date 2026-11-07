"""groom34: front/3q IoU per mask R, score31-identical definition (E driver)."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

E = Path(__file__).resolve().parent
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
MASKF = {"front": "mask-front.png", "three_quarter": "mask-three_quarter.png"}


def load_id(p):
    return np.array(Image.open(str(p)).convert("RGBA"))[:, :, 3] >= 230


def load_mask(v):
    return np.array(Image.open(str(SCR / MASKF[v]))) > 127


out = {}
for R in (10, 15, 20):
    d = E / ("renders-34mask%d" % R)
    row = {}
    for v in ("front", "three_quarter"):
        ours = load_id(d / (v + "-id.png"))
        tgt = load_mask(v)
        assert ours.shape == tgt.shape, (ours.shape, tgt.shape)
        inter = int((tgt & ours).sum()); union = int((tgt | ours).sum())
        row[v] = {"iou": round(inter / union, 4), "interPx": inter,
                  "unionPx": union,
                  "missPx": int((tgt & ~ours).sum()),
                  "excessPx": int((ours & ~tgt).sum())}
    out["mask%d" % R] = row
    print("mask%d" % R, {v: row[v]["iou"] for v in row})
(E / "iou-mask.json").write_text(json.dumps(out, indent=1) + "\n")
