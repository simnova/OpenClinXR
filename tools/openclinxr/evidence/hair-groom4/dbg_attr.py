#!/usr/bin/env python3
"""Attribute rendered band pixels to strands via densified projection."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

E4 = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2/tools/openclinxr/evidence/hair-groom4")
sys.path.insert(0, "/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2/tools/openclinxr/hair-groom/orient")
import common_o as CO  # noqa: E402

inp = CO.load_all()
cams = json.loads(Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2/tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json").read_text())
sensor = float(cams["sensorWidthMm"])
m = np.array(cams["views"]["profile_90"]["matrixWorld"], dtype=np.float64)
inv = np.linalg.inv(m)
f = float(cams["views"]["profile_90"]["lensMm"]) / sensor * 1024.0

doc = np.load(E4 / "final/strands.npz")
pts = np.asarray(doc["points"], dtype=np.float64)
rad = np.asarray(doc["radii"], dtype=np.float64)
gi = np.asarray(doc["guide_idx"])[:, 0]
n, P, _ = pts.shape
r = np.load("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2/tools/openclinxr/evidence/hair-scalp1/roots.npz")
rxyz = np.asarray(r["xyz"], dtype=np.float64)
K = n // len(rxyz)
parent = np.repeat(np.arange(len(rxyz)), K)
tg = np.load(E4 / "tucked/guides-tucked.npz")
tuck = np.asarray(tg["tuck"])

# densify 32 -> 160 pts per strand (linear), keep owner + arc.
t = np.linspace(0, P - 1, 160)
ti0 = np.floor(t).astype(int).clip(0, P - 2)
fr = (t - ti0)[:, None]
A = pts[:, ti0, :]
B = pts[:, ti0 + 1, :]
dense = A * (1 - fr) + B * fr  # (n,160,3)
flat = dense.reshape(-1, 3)
own = np.repeat(np.arange(n), 160)
arc = np.tile(np.arange(160), n)
hw = np.ones((len(flat), 4))
hw[:, :3] = flat
lc = (inv @ hw.T).T
dep = -lc[:, 2]
cc = np.full(len(flat), -1.0)
rr = np.full(len(flat), -1.0)
ok = dep > 0
cc[ok] = 512.0 + (lc[ok, 0] / dep[ok]) * f
rr[ok] = 512.0 - (lc[ok, 1] / dep[ok]) * f

a = np.array(Image.open(E4 / "final/id512/profile_90-id.png").convert("RGBA"))[:, :, 3]
a = np.asarray(Image.fromarray(a).resize((1024, 1024), Image.NEAREST))
# band: rows 340-430, cols 330-470 @1024 (upper-mid earAEA)
band = np.zeros((1024, 1024), dtype=bool)
band[340:430, 330:470] = True
hair = (a >= 230) & band
ys, xs = np.nonzero(hair)
print("band hair px @1024-equiv:", int(hair.sum()))
hit = np.zeros(len(flat), dtype=bool)
for y, x in zip(ys[::3], xs[::3]):
    hit |= (np.abs(cc - x) < 1.2) & (np.abs(rr - y) < 1.2) & ok
sel = np.unique(own[hit])
print("strands touching band:", len(sel))
if len(sel):
    vis = rad[sel[:, None] if False else sel, 1:].max(axis=1) > 1e-6
    print("of which visible:", int(vis.sum()))
    tk = tuck[gi[sel]] > 0.5
    print("frac on tucked guides:", round(float(tk.mean()), 2))
    pr = rxyz[parent[sel]]
    print("parent roots x", np.percentile(pr[:, 0] * 1000, [5, 50, 95]).round(1).tolist(),
          "y", np.percentile(pr[:, 1] * 1000, [5, 50, 95]).round(1).tolist(),
          "z", np.percentile(pr[:, 2] * 1000, [5, 50, 95]).round(1).tolist())
    ss = dense[sel][:, ::16, :].reshape(-1, 3)
    print("strand-body xyz x", np.percentile(ss[:, 0] * 1000, [5, 50, 95]).round(1).tolist(),
          "y", np.percentile(ss[:, 1] * 1000, [5, 50, 95]).round(1).tolist(),
          "z", np.percentile(ss[:, 2] * 1000, [5, 50, 95]).round(1).tolist())
