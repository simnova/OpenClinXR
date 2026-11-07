#!/usr/bin/env python3
"""Groom22 falsifier render: retraced crossing-pair mids over the SMOOTHED
back field (x-z projection coloured by per-voxel mean disagreement)."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

S = Path(__file__).resolve().parent
HG = S.parents[3] / "tools/openclinxr/hair-groom"
sys.path.insert(0, str(HG / "orient"))
sys.path.insert(0, str(HG / "strands"))
import frames as F  # noqa: E402
from s12_back_smooth import crossing_pairs  # noqa: E402 (metric reuse)

E = Path("tools/openclinxr/evidence/hair-groom22")
STORE = Path("/Volumes/files/openclinxr-assets/store/hair-groom22")

fld = np.load(STORE / "field-smooth22.npz", allow_pickle=True)
idx = np.asarray(fld["idx"])
xyz = np.asarray(fld["xyz_mm"], float)
dirs = np.asarray(fld["dir"], float)
n = len(idx)
shape = (int(idx[:, 0].max() + 1), int(idx[:, 1].max() + 1),
         int(idx[:, 2].max() + 1))
p2r = -np.ones(shape, dtype=np.int64)
p2r[idx[:, 0], idx[:, 1], idx[:, 2]] = np.arange(n)
offs = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1)
        for c in (-1, 0, 1) if (a, b, c) != (0, 0, 0)]
back = (xyz[:, 1] < -63.5) & (xyz[:, 2] > 1510.0)
mean = np.full(n, np.nan)
for r in np.nonzero(back)[0]:
    ix, iy, iz = idx[r]
    nb = []
    for (dx, dy, dz) in offs:
        jx, jy, jz = ix + dx, iy + dy, iz + dz
        if jx < 0 or jy < 0 or jz < 0 or jx >= shape[0] \
                or jy >= shape[1] or jz >= shape[2]:
            continue
        q = p2r[jx, jy, jz]
        if q < 0:
            continue
        nb.append(float(np.degrees(np.arccos(
            min(abs(float(dirs[r] @ dirs[q])), 1.0)))))
    if nb:
        mean[r] = float(np.mean(nb))

src = np.load(STORE / "guides-22.npz", allow_pickle=True)
head = np.asarray(src["curves_head"], float)
crown = np.asarray(src["crown"], float)
curves = F.head_to_world(head, crown)
roots = curves[:, 0].copy()
tuck = np.asarray(src["tuck"]) > 0.5
pairs, winfo = crossing_pairs(curves, crown,
                              (roots[:, 1] < -0.0635)
                              & (roots[:, 2] > 1.51) & ~tuck)
print("retraced crossing pairs:", len(pairs))
win = winfo["win"]
mids = []
for (a, b) in pairs[:4000]:
    pa = curves[a][win[a]]
    pb = curves[b][win[b]]
    mids.append(((pa[len(pa) // 2] + pb[len(pb) // 2]) / 2.0).tolist())
mids = np.asarray(mids, float) * 1000.0

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(10, 8))
sel = back & np.isfinite(mean)
sc = ax.scatter(xyz[sel, 0], xyz[sel, 2], c=mean[sel], s=1,
                vmin=0, vmax=60, cmap="inferno", rasterized=True)
plt.colorbar(sc, ax=ax, label="mean 26-nb disagreement, SMOOTHED (deg)")
ax.scatter(mids[:, 0], mids[:, 2], s=4, c="cyan", alpha=0.5,
           label="re-traced crossing-pair mids (<=4000, n=%d)" % len(pairs))
ax.legend(loc="upper right", fontsize=8)
ax.set_xlabel("x (mm)")
ax.set_ylabel("z (mm)")
ax.set_title("FALSIFIER: smoothed back field + re-traced crossing pairs\n"
             "field gate met (11.85<=21.78) yet %d pairs still cross" % len(pairs))
ax.set_aspect("equal", adjustable="datalim")
fig.tight_layout()
fig.savefig(E / "falsifier.png", dpi=150)
print("wrote", E / "falsifier.png")
