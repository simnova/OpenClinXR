#!/usr/bin/env python3
"""hair-groom7 STEP 3b: A-D gates + groom6-carry gates (groom6 vs groom7).

Reads E/baseline.json (boxes), E/score7.json, renders, strands.
Writes E/score7x.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
EN = Path(__file__).resolve().parent
EO = ROOT / "tools/openclinxr/evidence/hair-groom6"
RO = EO / "renders-studio"
RN = EN / "renders-studio"
GO = EO / "build" / "strands.npz"
GN = EN / "build" / "strands.npz"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
CAMS = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"
PINNA = ROOT / "tools/openclinxr/evidence/hair-hull3/workspace/ear_pinna.npz"
ROOTS = ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz"
SDFP = ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz"
MASKF = {"front": "mask-front.png",
         "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png",
         "back": "mask-back.png"}

sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
from children import sdf_sampler  # noqa: E402

base = json.loads((EN / "baseline.json").read_text())
s6 = json.loads((EN / "score7.json").read_text())
b6 = json.loads((EN / "build.json").read_text())
part_x = float(b6["part"]["partX"])
cams = json.loads(CAMS.read_text())
sensor = float(cams["sensorWidthMm"])
PROJ = {}
for v in ("front", "three_quarter", "profile_90", "back"):
    M = np.array(cams["views"][v]["matrixWorld"], dtype=np.float64)
    f = float(cams["views"][v]["lensMm"]) / sensor * 1024.0
    PROJ[v] = (np.linalg.inv(M), f)


def project(pts, v):
    inv, f = PROJ[v]
    pts = np.asarray(pts, dtype=np.float64)
    hw = np.ones((len(pts), 4))
    hw[:, :3] = pts
    lc = (inv @ hw.T).T
    dep = -lc[:, 2]
    cc = np.full(len(pts), -1.0)
    rr = np.full(len(pts), -1.0)
    ok = dep > 0
    cc[ok] = 512.0 + (lc[ok, 0] / dep[ok]) * f
    rr[ok] = 512.0 - (lc[ok, 1] / dep[ok]) * f
    return cc, rr, dep


def boxm(r0, r1, c0, c1):
    b = np.zeros((1024, 1024), dtype=bool)
    b[max(r0, 0):min(r1, 1024), max(c0, 0):min(c1, 1024)] = True
    return b


out = {"gates": {}}

# ---- A ----
pdoc = np.load(PINNA, allow_pickle=True)
A = {}
sample, _ = sdf_sampler(np.load(str(SDFP), allow_pickle=True))
for tag, Rp, Gp in (("groom6", RO, GO), ("groom7", RN, GN)):
    D = np.load(str(Gp), allow_pickle=True)
    pts = np.asarray(D["points"], dtype=np.float64)
    rad = np.asarray(D["radii"], dtype=np.float64)
    n, P, _ = pts.shape
    for key, ainfo in base["A_templeBox"].items():
        view = key.split("/")[0]
        a = np.array(Image.open(Rp / (view + "-id.png"))
                     .convert("RGBA"))[:, :, 3]
        b = ainfo["box"]
        bm = boxm(b["r0"], b["r1"], b["c0"], b["c1"])
        h = bm & (a >= 230)
        t = np.array(Image.open(SCR / MASKF[view])) > 127
        tpx = int((bm & t).sum())
        ours = int(h.sum())
        trans = float(((a >= 30) & (a < 230) & bm).sum()
                      / max(int((bm & (a >= 30)).sum()), 1))
        tipcc, tiprr, _ = project(pts[:, -1, :], view)
        intip = (tipcc >= b["c0"]) & (tipcc < b["c1"]) \
            & (tiprr >= b["r0"]) & (tiprr < b["r1"])
        tiprad = rad[:, -1] > 1e-6
        ntip = int((intip & tiprad).sum())
        far = 0
        if (intip & tiprad).any():
            vals, inside = sample(pts[intip & tiprad][:, -1, :])
            vals = np.where(inside, vals, 999.0)
            far = int((vals > 3.0).sum())
        A["%s/%s" % (tag, key)] = {
            "oursPx": ours, "targetPx": tpx,
            "ratioVsTarget": round(ours / max(tpx, 1), 3),
            "gateRatioOk": bool(ours <= 2 * max(tpx, 1)),
            "tipsInBox": ntip, "tipsGt3mm": far,
            "gateTipsOk": bool(far == 0),
            "transFrac": round(trans, 4)}
out["A"] = A
print("A " + json.dumps(A, indent=1), flush=True)

# ---- B ----
B = {}
aB = np.array(Image.open(RN / "back-id.png").convert("RGBA"))[:, :, 3]
tB = np.array(Image.open(SCR / MASKF["back"])) > 127
ys, xs = np.nonzero(tB)
y0, y1 = int(ys.min()), int(ys.max()) + 1
x0, x1 = int(xs.min()), int(xs.max()) + 1
W = x1 - x0
low0 = y0 + 2 * (y1 - y0) // 3
edge = int(round(0.15 * W))
for nm, bm in (("left", boxm(low0, y1, x0, x0 + edge)),
               ("right", boxm(low0, y1, x1 - edge, x1))):
    hair = bm & (aB >= 30)
    trans = float(((aB >= 30) & (aB < 230) & bm).sum()
                  / max(int(hair.sum()), 1))
    miss = float((bm & tB & ~(aB >= 230)).sum()
                 / max(int((bm & tB).sum()), 1))
    B[nm] = {"alphaLt09": round(trans, 4),
             "gateAlphaOk": bool(trans <= 0.05),
             "maskMiss": round(miss, 4),
             "gateMissOk": bool(miss <= 0.10)}
out["B"] = B
print("B " + json.dumps(B, indent=1), flush=True)

# ---- C ----
C = {}


def gapline(mask, rows, col=512, halfwin=60):
    c, w = [], []
    for r in rows:
        row = mask[r]
        lo, hi = max(col - halfwin, 0), min(col + halfwin, 1024)
        seg = row[lo:hi]
        if seg[col - lo]:
            c.append(float(col))
            w.append(0)
            continue
        l = col - lo
        while l >= 0 and not seg[l]:
            l -= 1
        rr = col - lo
        while rr < len(seg) and not seg[rr]:
            rr += 1
        c.append(float(l + 1 + lo + (rr - l - 1) / 2))
        w.append(int(rr - l - 1))
    return np.array(c), np.array(w)


for view, rows, hw in (("back", list(range(150, 420)), 60),
                       ("front", list(range(85, 150)), 30)):
    row = {}
    for tag, Rp in (("groom6", RO), ("groom7", RN)):
        am = np.array(Image.open(Rp / (view + "-id.png"))
                      .convert("RGBA"))[:, :, 3] >= 230
        co, wo = gapline(am, rows, halfwin=hw)
        nz = wo > 0
        row[tag] = {"gapStdPx": round(float(co[nz].std()), 2)
                    if nz.any() else 0.0,
                    "gapMedianWidthPx": round(float(np.median(wo[nz])), 1)
                    if nz.any() else 0.0,
                    "nGapRows": int(nz.sum())}
    tm = np.array(Image.open(SCR / MASKF[view])) > 127
    ct, wt = gapline(tm, rows, halfwin=hw)
    nzt = wt > 0
    row["target"] = {"gapStdPx": round(float(ct[nzt].std()), 2)
                     if nzt.any() else 0.0,
                     "gapMedianWidthPx": round(float(np.median(wt[nzt])), 1)
                     if nzt.any() else 0.0,
                     "nGapRows": int(nzt.sum())}
    C[view] = row
# crossings within 40 mm arc, groom6 (stored parent map)
D6 = np.load(str(GN), allow_pickle=True)
pts = np.asarray(D6["points"], dtype=np.float64)
rad = np.asarray(D6["radii"], dtype=np.float64)
n, P, _ = pts.shape
parent = np.asarray(D6["parent"], dtype=np.int64)
rdoc = np.load(str(ROOTS), allow_pickle=True)
rxyz = np.asarray(rdoc["xyz"], dtype=np.float64)
rside = np.where(rxyz[:, 0] >= part_x, 1.0, -1.0)[parent]
arc = np.zeros((n, P))
arc[:, 1:] = np.cumsum(np.linalg.norm(np.diff(pts, axis=1), axis=2), axis=1)
near = arc < 0.040
xs = pts[:, :, 0] - part_x
cross40 = near[:, 1:] & ((xs[:, 1:] >= 0) != (rside >= 0)[:, None])
vis = rad[:, 1:] > 1e-6
hit = cross40 & vis
C["crossWithin40mm"] = {
    "nStrands": int(np.unique(np.repeat(np.arange(n), P - 1)[
        hit.reshape(-1)]).size) if hit.any() else 0,
    "nSamples": int(hit.sum()),
    "gateOk": bool(not hit.any())}
out["C"] = C
print("C " + json.dumps(C, indent=1), flush=True)

# ---- D ----
D = {"iouFront": {
    "groom6": s6["grooms"]["groom6"]["iou"]["front"]["iou"],
    "groom7": s6["grooms"]["groom7"]["iou"]["front"]["iou"],
    "gateOk": bool(s6["grooms"]["groom7"]["iou"]["front"]["iou"] >= 0.55)}}
for band in ("curtainL", "curtainR"):
    D[band] = base["D_front"][band]
    D["%s_g6" % band] = "see score7 contour front"
D["contourFrontGN"] = s6["grooms"]["groom7"]["contour"]["front"]
out["D"] = D
print("D " + json.dumps(D, indent=1), flush=True)

# ---- groom6-carry gates ----
r20 = s6["review20"]
carry = {
    "seamGN": s6["grooms"]["groom7"]["seam"],
    "seamOk": bool(s6["grooms"]["groom7"]["seam"]["maxGapPx"] <= 4),
    "frizzRulerPass": bool(s6["frizzRuler"]["gatePass"]),
    "pinnaVisible": {k: v for k, v in r20["pinnaVisibility"].items()
                     if k.startswith("groom7/profile")},
    "pinnaOk": bool(all(v["visible"] >= 0.80
                        for k, v in r20["pinnaVisibility"].items()
                        if k.startswith("groom7/profile"))),
    "conchaCrossOk": bool(all(v["nStrands"] == 0
                              for k, v in r20["conchaCrossingsStrand"].items()
                              if k.startswith("groom7"))),
    "foeOk": True,  # recomputed below vs groom6 rule
    "transCore": {k: r20["translucency"]["groom7"][k] for k in
                  ("back/crown", "back/hemCore", "back/nape",
                   "profile_90/behindEarCore-xpos",
                   "profile_90/behindEarCore-xneg")},
    "transCoreOk": bool(all(
        r20["translucency"]["groom7"][k]["frac"] <= 0.05 for k in
        ("back/crown", "back/hemCore", "back/nape",
         "profile_90/behindEarCore-xpos",
         "profile_90/behindEarCore-xneg"))),
    "streak": r20["streakWidth"],
    "streakOk": bool(r20["streakWidth"]["groom7"]["median"]
                     <= 2 * r20["streakWidth"]["target"]["median"]),
    "iou": {v: {"groom6": s6["grooms"]["groom6"]["iou"][v]["iou"],
                "groom7": s6["grooms"]["groom7"]["iou"][v]["iou"]}
            for v in ("front", "three_quarter", "profile_90", "back")},
}
carry["foeOk"] = bool(all(v["nStrands"] == 0
                          for k, v in r20["frontOfEarAboveSideburn"].items()
                          if k.startswith("groom7/three_quarter")
                          or k.startswith("groom6/profile")))
out["carry"] = carry
print("CARRY " + json.dumps(carry, indent=1), flush=True)

(EN / "score7x.json").write_text(json.dumps(out, indent=1) + "\n")
print("STEP3b done", flush=True)
