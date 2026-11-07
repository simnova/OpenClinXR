#!/usr/bin/env python3
"""hair-cover1 STEP 1b: attribute profile hole pixels to strand groups (system python).

Groups by root proxy (strands.npz carries no per-fibre class label):
  rear_sheet    roots y > apex
  curtain_outer y <= apex and |root_x-cx| > 55mm
  curtain_inner y <= apex and |root_x-cx| <= 55mm
x arc-half: root-half (pts 0-15) vs tip-half (pts 16-31).
Projection: profile camera matrixWorld from base/score.json, f from lens/sensor
(sensor hypothesis validated against the ID mask bbox below).
Attribution: rasterize each subgroup's projected segments (thickness 2px),
dilate stepwise; each hole pixel goes to the subgroup claiming it at the
smallest dilation. % of hole area per group.
"""
import json
import numpy as np
import cv2
from pathlib import Path
from PIL import Image

E = Path("tools/openclinxr/evidence/hair-cover1")
BASE = E / "base"
S = 1024

score = json.load(open(BASE / "score.json"))
cam = score["render"]["cameras"]["profile_90"]
M = np.array(cam["matrixWorld"], float)
lens = float(cam["lensMm"])
print("lens", lens, "loc", cam["location"])

d = np.load(BASE / "strands.npz")
P = np.asarray(d["points"], float)
R = np.asarray(d["roots"], float)
apex = float(np.asarray(d["apex_y"]))
cx = float(np.asarray(d["cx"]))
N = len(P)
print("fibres", N, "apex", apex, "cx", cx)

# world -> camera
Minv = np.linalg.inv(M)
Pw = np.concatenate([P.reshape(-1, 3), np.ones((N * 32, 1))], axis=1)
Pc = (Minv @ Pw.T).T[:, :3]
Xc, Yc, Zc = Pc[:, 0], Pc[:, 1], Pc[:, 2]
depth = -Zc
print("depth range", depth.min(), depth.max(), "frac behind camera", (depth <= 0).mean())

def project(sensor):
    f = lens / sensor * S
    u = S / 2 + f * Xc / depth
    v = S / 2 - f * Yc / depth
    return u, v

hair = np.asarray(Image.open(BASE / "profile_90-id.png").convert("RGBA"))[..., 3] >= 230
hys, hxs = np.where(hair)
print("mask bbox rows", hys.min(), hys.max(), "cols", hxs.min(), hxs.max())

for sensor in (36.0, 24.0):
    u, v = project(sensor)
    ok = (depth > 0) & (u > -200) & (u < S + 200) & (v > -200) & (v < S + 200)
    uu, vv = u[ok], v[ok]
    print(f"sensor {sensor}: proj bbox rows {vv.min():.0f}-{vv.max():.0f} "
          f"cols {uu.min():.0f}-{uu.max():.0f} kept {ok.mean():.3f}")

SENSOR = 36.0
u, v = project(SENSOR)
u = u.reshape(N, 32); v = v.reshape(N, 32)
depth_r = depth.reshape(N, 32)

# groups
rear = R[:, 1] > apex
outer = (~rear) & (np.abs(R[:, 0] - cx) > 0.055)
inner = (~rear) & (~outer)
print("counts rear/outer/inner:", rear.sum(), outer.sum(), inner.sum())

hole = np.load(E / "hole-mask.npy")
assert hole.shape == (S, S)

# rasterize subgroup segments, subsample fibres by 1 (all) but every segment;
# 69k polylines x cv2 is OK (~tens of seconds)
groups = {"rear_sheet": rear, "curtain_outer": outer, "curtain_inner": inner}
covers = {}
STEP = 2  # draw every 2nd segment to halve cost; thickness covers gaps
for gname, sel in groups.items():
    for half, sl in (("root", slice(0, 16)), ("tip", slice(16, 32))):
        key = f"{gname}__{half}"
        img = np.zeros((S, S), np.uint8)
        idx = np.where(sel)[0]
        pts = np.stack([u[idx][:, sl], v[idx][:, sl]], axis=-1)  # (F,16,2)
        segs = pts.reshape(-1, 2, 2)
        # drop segments with any endpoint offscreen-far or behind camera
        dd = depth_r[idx][:, sl].reshape(-1, 2)
        keep = (dd > 0).all(axis=1)
        xmin, xmax = segs[:, :, 0].min(axis=1), segs[:, :, 0].max(axis=1)
        ymin, ymax = segs[:, :, 1].min(axis=1), segs[:, :, 1].max(axis=1)
        keep &= (xmax > 0) & (xmin < S) & (ymax > 0) & (ymin < S)
        cnt = 0
        for s in segs[keep][::1]:
            cv2.line(img, (int(round(s[0, 0])), int(round(s[0, 1]))),
                     (int(round(s[1, 0])), int(round(s[1, 1]))), 1, 2)
            cnt += 1
        covers[key] = img
        print(key, "fibres", int(sel.sum()), "lines", cnt,
              "cover px", int((img > 0).sum()))

# stepwise exclusive attribution
order = sorted(covers)
dilations = [0, 2, 5, 10, 20, 40]
claimed = np.zeros((S, S), bool)
attrib = {}
remaining = hole.copy()
for dd in dilations:
    k = 2 * dd + 1
    for key in order:
        m = cv2.dilate(covers[key], np.ones((k, k), np.uint8)) > 0
        take = remaining & m
        attrib.setdefault(key, {})[f"d{dd}"] = int(take.sum())
        remaining &= ~take
    print(f"d<={dd}: claimed cum {100*(hole.sum()-remaining.sum())/hole.sum():.1f}%")
attrib["_unclaimed"] = int(remaining.sum())
total = int(hole.sum())
out = {"sensorHypothesisMm": SENSOR, "lensMm": lens,
       "groups": {g: {"fibres": int(s.sum())} for g, s in groups.items()},
       "holePixels": total, "perSubgroupDilatedClaims": attrib}
# collapse to % per group (sum over halves and dilations)
per_group = {}
for gname in groups:
    px = sum(attrib[f"{gname}__{h}"][f"d{dd}"]
             for h in ("root", "tip") for dd in dilations)
    per_group[gname] = {"holePixels": px, "pctOfHole": 100 * px / total}
per_half = {}
for h in ("root", "tip"):
    px = sum(attrib[f"{g}__{h}"][f"d{dd}"] for g in groups for dd in dilations)
    per_half[h] = {"holePixels": px, "pctOfHole": 100 * px / total}
out["perGroupPctOfHole"] = per_group
out["perHalfPctOfHole"] = per_half
out["unclaimed"] = {"holePixels": int(remaining.sum()),
                    "pctOfHole": 100 * float(remaining.sum()) / total}
print(json.dumps({**per_group, **per_half, "unclaimed": out["unclaimed"]}, indent=1))
(E / "attribution.json").write_text(json.dumps(out, indent=2) + "\n")

# visual check: projected coverage vs mask (group colors) + holes red
vis = np.zeros((S, S, 3), np.uint8)
cols = {"rear_sheet": (255, 0, 0), "curtain_outer": (0, 255, 0),
        "curtain_inner": (0, 0, 255)}
for gname, c in cols.items():
    m = ((covers[f"{gname}__root"] + covers[f"{gname}__tip"]) > 0)
    vis[m] = c
vis[hole] = (255, 255, 255)
Image.fromarray(vis).save(E / "attribution-vis.png")
print("WROTE attribution.json + attribution-vis.png")
