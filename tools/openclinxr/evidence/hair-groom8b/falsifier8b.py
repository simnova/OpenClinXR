#!/usr/bin/env python3
"""groom8b falsifier support: guides winding under the upper-right
back swirl region. Ranks guides rooted in the region by total
turning angle; lists the top ids (the brief asks for them)."""
import json
import sys
from pathlib import Path
import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
import frames as F

gdoc = np.load(str(ROOT / "tools/openclinxr/evidence/hair-groom8a/build"
                   "/guides-8a.npz"), allow_pickle=True)
gh = np.asarray(gdoc["curves_head"], dtype=np.float64)
crown = np.asarray(gdoc["crown"], dtype=np.float64)
gw = F.head_to_world(gh, crown) * 1000.0  # mm
tuck = np.asarray(gdoc["tuck"], dtype=np.float64)

tot = np.zeros(len(gw))
disp = np.zeros(len(gw))
for g in range(len(gw)):
    c = gw[g]
    d = np.diff(c, axis=0)
    u = d / (np.linalg.norm(d, axis=1, keepdims=True) + 1e-12)
    dots = np.clip((u[:-1] * u[1:]).sum(axis=1), -1, 1)
    tot[g] = float(np.degrees(np.arccos(dots)).sum())
    disp[g] = float(np.linalg.norm(c[-1] - c[0]))

r = gw[:, 0, :]
region = (r[:, 0] < -15.0) & (r[:, 0] > -100.0) \
    & (r[:, 1] >= -60.0) & (r[:, 1] <= 34.2) \
    & (r[:, 2] > 1600.0) & (tuck < 0.5)
idx = np.nonzero(region)[0]
order = idx[np.argsort(-tot[idx])]
print("region guides:", int(region.sum()))
# back-projection presence in the swirl box (rows 150-420, cols 512-765)
cams = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests"
                   "/cameras-scorer-v3.json").read_text())
M = np.array(cams["views"]["back"]["matrixWorld"], dtype=np.float64)
inv = np.linalg.inv(M)
f = float(cams["views"]["back"]["lensMm"]) / float(
    cams["sensorWidthMm"]) * 1024.0
out = []
for g in order[:25]:
    pts = gw[g] / 1000.0
    hw = np.ones((len(pts), 4))
    hw[:, :3] = pts
    lc = (inv @ hw.T).T
    dep = -lc[:, 2]
    cc = 512.0 + (lc[:, 0] / np.maximum(dep, 1e-9)) * f
    rr = 512.0 - (lc[:, 1] / np.maximum(dep, 1e-9)) * f
    inbox = int(((dep > 0) & (cc >= 512) & (cc < 765)
                 & (rr >= 150) & (rr < 420)).sum())
    out.append({"id": int(g), "totalTurnDeg": round(float(tot[g]), 1),
                "dispMm": round(float(disp[g]), 1),
                "swirlBoxSamples": inbox})
    print("guide %d turn %.0f disp %.0f box %d" % (
        g, tot[g], disp[g], inbox))
(E / "falsifier8b.json").write_text(json.dumps(
    {"region": "x[-100,-15] y[-60,34.2] z>1600 tuck=0",
     "nRegion": int(region.sum()), "top": out}, indent=1))
