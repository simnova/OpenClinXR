#!/usr/bin/env python3
"""groom31 STEP 0 image: groom30 back beauty + embedded (in-shirt) samples red."""
import json, sys
import numpy as np
from PIL import Image
from pathlib import Path
E = Path(__file__).resolve().parent
ROOT = E.parents[3]
CAME = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json").read_text())
SENSOR = float(CAME["sensorWidthMm"])
M = np.array(CAME["views"]["back"]["matrixWorld"], dtype=np.float64)
INV = np.linalg.inv(M); F = float(CAME["views"]["back"]["lensMm"]) / SENSOR * 1024.0
d = np.load("/Volumes/files/openclinxr-assets/store/hair-groom31/step0-sd.npz")
sd, bv, cand = d["shirt_sd_mm"], d["body_sd_mm"], d["cand_mask"]
s = np.load("/Volumes/files/openclinxr-assets/store/hair-groom30/strands-30.npz")
flat = np.asarray(s["points"], dtype=np.float64).reshape(-1, 3)
emb = cand & (sd < 0) & (bv > 0) & (np.abs(sd) < 3.0)
pe = flat[emb]
hw = np.ones((len(pe), 4)); hw[:, :3] = pe
lc = (INV @ hw.T).T; dep = -lc[:, 2]
ok = dep > 0
cc = (512.0 + (lc[ok, 0] / dep[ok]) * F).astype(int)
rr = (512.0 - (lc[ok, 1] / dep[ok]) * F).astype(int)
img = np.array(Image.open(str(E.parent / "hair-groom30/renders-30/back.png")).convert("RGB"))
on = (cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
for c, r in zip(cc[on][::2], rr[on][::2]):
    img[max(r-1,0):r+2, max(c-1,0):c+2] = (255, 0, 0)
Image.fromarray(img).save(str(E / "step0-back-shirt.png"))
print("embedded samples:", int(emb.sum()), "projected:", int(on.sum()), "img step0-back-shirt.png")
