#!/usr/bin/env python3
"""hair-cover1 STEP 1c: density attribution + surround-fibre mapping (system python)."""
import json
import numpy as np
from pathlib import Path
from PIL import Image
from collections import defaultdict

E = Path("tools/openclinxr/evidence/hair-cover1")
BASE = E / "base"
S = 1024

score = json.load(open(BASE / "score.json"))
M = np.array(score["render"]["cameras"]["profile_90"]["matrixWorld"], float)
f = 50.0 / 36.0 * S

d = np.load(BASE / "strands.npz")
P = np.asarray(d["points"], float)
R = np.asarray(d["roots"], float)
apex = float(np.asarray(d["apex_y"]))
cx = float(np.asarray(d["cx"]))
N = len(P)

Minv = np.linalg.inv(M)
Pc = (Minv @ np.concatenate(
    [P.reshape(-1, 3), np.ones((N * 32, 1))], axis=1).T).T[:, :3]
u = (S / 2 + f * Pc[:, 0] / (-Pc[:, 2])).reshape(N, 32)
v = (S / 2 - f * Pc[:, 1] / (-Pc[:, 2])).reshape(N, 32)

rear = R[:, 1] > apex
outer = (~rear) & (np.abs(R[:, 0] - cx) > 0.055)
inner = (~rear) & (~outer)
groups = [("rear_sheet", rear), ("curtain_outer", outer), ("curtain_inner", inner)]

hole = np.load(E / "hole-mask.npy")
hair = np.asarray(Image.open(BASE / "profile_90-id.png").convert("RGBA"))[..., 3] >= 230
solid = hair & (~hole)

CELL = 4
G = S // CELL
dens = {}
for gname, sel in groups:
    grid = np.zeros((G, G), np.float32)
    uu = np.clip((u[sel][:, ::2].ravel() / CELL).astype(int), 0, G - 1)
    vv = np.clip((v[sel][:, ::2].ravel() / CELL).astype(int), 0, G - 1)
    np.add.at(grid, (vv, uu), 1)
    dens[gname] = grid

rng = np.random.default_rng(0)
hy, hx = np.where(hole)
sy, sx = np.where(solid)
hole_xy = np.stack([hx, hy], axis=-1)[rng.choice(
    len(hx), size=min(6000, len(hx)), replace=False)] // CELL
solid_xy = np.stack([sx, sy], axis=-1)[rng.choice(
    len(sx), size=min(6000, len(sx)), replace=False)] // CELL

rep, share_h, share_s = {}, {}, {}
for gname, _ in groups:
    grid = dens[gname]
    hv = grid[hole_xy[:, 1], hole_xy[:, 0]]
    sv = grid[solid_xy[:, 1], solid_xy[:, 0]]
    rep[gname] = {
        "medianDensityAtHoles": float(np.median(hv)),
        "medianDensityAtSolid": float(np.median(sv)),
        "ratioHoleOverSolid": float(np.median(hv) / max(np.median(sv), 1e-9)),
        "fracZeroAtHoles": float((hv == 0).mean()),
        "fracZeroAtSolid": float((sv == 0).mean())}
    share_h[gname] = float(hv.mean())
    share_s[gname] = float(sv.mean())
    print(gname, json.dumps(rep[gname]))
print("mean density shares at holes:", json.dumps(share_h))
print("mean density shares at solid:", json.dumps(share_s))

# surround fibres: 8px grid index over subsampled projected points
PU = u[:, ::4].ravel()
PV = v[:, ::4].ravel()
FIB = np.repeat(np.arange(N), 8)
ARC = np.tile((np.arange(8) * 4 + 2), N)  # mid-arc index of each sample
GX = np.clip((PU / 8).astype(int), 0, 127)
GY = np.clip((PV / 8).astype(int), 0, 127)
index = defaultdict(list)
for k in range(len(GX)):
    index[(int(GX[k]), int(GY[k]))].append(k)
print("index cells:", len(index), "pts:", len(GX))
glabel = np.zeros(N, np.int8)
glabel[outer] = 1
glabel[inner] = 2
GNAMES = ["rear_sheet", "curtain_outer", "curtain_inner"]

hys2, hxs2 = np.where(hole)
samp = rng.choice(len(hys2), size=min(3000, len(hys2)), replace=False)
rec = []
for q in range(len(samp)):
    px, py = float(hxs2[samp[q]]), float(hys2[samp[q]])
    gx, gy = int(px // 8), int(py // 8)
    found = None
    for rad in range(0, 8):
        cand = []
        for dx in range(-rad, rad + 1):
            for dy in (-rad, rad) if rad else (0,):
                cand.extend(index.get((gx + dx, gy + dy), ()))
            if rad:
                for dy in range(-rad + 1, rad):
                    for dx in (-rad, rad):
                        cand.extend(index.get((gx + dx, gy + dy), ()))
        if cand:
            kk = np.array(cand)
            dd = np.hypot(PU[kk] - px, PV[kk] - py)
            j = int(np.argmin(dd))
            if dd[j] <= (rad + 1) * 8 * 1.5:
                found = (kk[j], float(dd[j]))
                break
    if found is not None:
        k, dist = found
        fb = int(FIB[k])
        rec.append((GNAMES[int(glabel[fb])], float(R[fb, 0] * 1000),
                    float(R[fb, 1] * 1000), float(P[fb, 0, 2]),
                    int(ARC[k]), dist))
print("surround records:", len(rec), "of", len(samp))
rx = np.array([r[1] for r in rec])
ry = np.array([r[2] for r in rec])
arc = np.array([r[4] for r in rec])
gg = np.array([r[0] for r in rec])
dd = np.array([r[5] for r in rec])
print("surround group frac:",
      {g: float((gg == g).mean()) for g in GNAMES})
print("surround root_x mm p5/p50/p95:", np.percentile(rx, [5, 50, 95]).tolist())
print("surround root_y mm p5/p50/p95:", np.percentile(ry, [5, 50, 95]).tolist())
print("apex_y mm:", apex * 1000)
print("surround arc-idx p5/p50/p95:", np.percentile(arc, [5, 50, 95]).tolist())
print("surround dist px p50/p95:", np.percentile(dd, [50, 95]).tolist())
# root zone of surround, split by group
for g in GNAMES:
    sel = gg == g
    if sel.sum():
        print(g, "n", int(sel.sum()), "rootx",
              np.percentile(rx[sel], [5, 50, 95]).round(1).tolist(),
              "rooty", np.percentile(ry[sel], [5, 50, 95]).round(1).tolist(),
              "arc", np.percentile(arc[sel], [5, 50, 95]).tolist())

out = {
    "density": rep,
    "meanDensityShareHoles": share_h,
    "meanDensityShareSolid": share_s,
    "surround": {
        "n": len(rec),
        "groupFrac": {g: float((gg == g).mean()) for g in GNAMES},
        "rootXmm_p5p50p95": np.percentile(rx, [5, 50, 95]).tolist(),
        "rootYmm_p5p50p95": np.percentile(ry, [5, 50, 95]).tolist(),
        "arcIdx_p5p50p95": np.percentile(arc, [5, 50, 95]).tolist(),
        "distPx_p50p95": np.percentile(dd, [50, 95]).tolist(),
        "apexYmm": apex * 1000,
    },
}
(E / "attribution.json").write_text(json.dumps(out, indent=2) + "\n")
print("WROTE attribution.json")
