#!/usr/bin/env python3
"""hair-groom6 STEP 1b: corrected temple diagnosis + refined part measures.

Fixes: guide roots via frames.head_to_world (metres); box translucency +
isolated-component read; per-rule short/trimmed breakdown; roots whose
strands are fully trimmed (stipple dots); front part rows that actually
cover the hairline part.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
E6 = ROOT / "tools/openclinxr/evidence/hair-groom6"
E5 = ROOT / "tools/openclinxr/evidence/hair-groom5"
R5 = E5 / "renders-studio"
G5 = Path("/Volumes/files/src/openclinxr/.openclinxr/asset-production"
          "/hair-groom5/strands.npz")
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
CAMS = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"
PINNA = ROOT / "tools/openclinxr/evidence/hair-hull3/workspace/ear_pinna.npz"
ROOTS = ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz"
GTUCK = ROOT / "tools/openclinxr/evidence/hair-groom4/tucked/guides-tucked.npz"
EFRAME = ROOT / "tools/openclinxr/evidence/hair-groom4/tucked/earframe.json"
MASKF = {"front": "mask-front.png",
         "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png",
         "back": "mask-back.png"}

sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
import frames as F  # noqa: E402

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


base = json.loads((E6 / "baseline.json").read_text())
b5 = json.loads((E5 / "build.json").read_text())
part_x = float(b5["part"]["partX"])
pdoc = np.load(PINNA, allow_pickle=True)
pin = {s: np.asarray(pdoc["xyz"], dtype=np.float64)[np.asarray(pdoc[k])]
       for s, k in (("xpos", "idx_earXpos"), ("xneg", "idx_earXneg"))}

D5 = np.load(str(G5), allow_pickle=True)
pts = np.asarray(D5["points"], dtype=np.float64)
rad = np.asarray(D5["radii"], dtype=np.float64)
n, P, _ = pts.shape
rdoc = np.load(str(ROOTS), allow_pickle=True)
rxyz = np.asarray(rdoc["xyz"], dtype=np.float64)
n_root = rxyz.shape[0]
YV = 0.0342
_proot = ((np.abs(rxyz[:, 0] - part_x) < 12.0 / 1000.0)
          & (rxyz[:, 1] >= -0.060) & (rxyz[:, 1] <= YV))
parent = np.concatenate([np.repeat(np.arange(n_root), 13),
                         np.repeat(np.nonzero(_proot)[0], 7)])
assert len(parent) == n
arc = np.zeros((n, P))
arc[:, 1:] = np.cumsum(np.linalg.norm(np.diff(pts, axis=1), axis=2), axis=1)
slen = arc[:, -1] * 1000.0
vis = rad[:, 1:] > 1e-6
vislen = (np.linalg.norm(np.diff(pts, axis=1), axis=2)
          * vis).sum(axis=1) * 1000.0  # visible arc mm
fully_trimmed = ~vis.any(axis=1)

gdoc = np.load(str(GTUCK), allow_pickle=True)
crowng = np.asarray(gdoc["crown"], dtype=np.float64)
ch = np.asarray(gdoc["curves_head"], dtype=np.float64)
tuck_g = np.asarray(gdoc["tuck"], dtype=np.float64)
gw = F.head_to_world(ch, crowng)
groot = gw[:, 0, :]
print("groot range m: x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]"
      % (groot[:, 0].min(), groot[:, 0].max(), groot[:, 1].min(),
         groot[:, 1].max(), groot[:, 2].min(), groot[:, 2].max()),
      flush=True)
glen = np.linalg.norm(np.diff(gw, axis=1), axis=2).sum(axis=1) * 1000.0

earframe = json.loads(EFRAME.read_text())
_rmm = rxyz * 1000.0
_tuckroot = np.zeros(n_root, dtype=bool)
for _sgn, _side in ((1.0, "xpos"), (-1.0, "xneg")):
    _rows = (_rmm[:, 0] * _sgn > 0)
    _tb = earframe["sides"][_side]["tuckBoxMm"]
    _tuckroot |= _rows & (np.abs(_rmm[:, 0]) >= _tb["xLo"]) \
        & (np.abs(_rmm[:, 0]) < _tb["xHi"]) \
        & (_rmm[:, 1] < _tb["yMax"]) \
        & (_rmm[:, 2] >= _tb["zLo"]) \
        & (_rmm[:, 2] < _tb["zHi"])
_sbroot = np.zeros(n_root, dtype=bool)
for _skey, _ssgn in (("idx_earXpos", 1.0), ("idx_earXneg", -1.0)):
    _pv = np.asarray(pdoc["xyz"], dtype=np.float64)[
        np.asarray(pdoc[_skey])]
    _yB = float(np.quantile(_pv[:, 1], 0.90))
    _zT = float(_pv[:, 2].max())
    _zM = float(_pv[:, 2].min())
    _rows = (rxyz[:, 0] * _ssgn > 0)
    _sbroot |= (_rows & (np.abs(rxyz[:, 0]) >= 0.035)
                & (np.abs(rxyz[:, 0]) < 0.100)
                & (rxyz[:, 1] < _yB + 0.010)
                & (rxyz[:, 2] < _zT)
                & (rxyz[:, 2] > _zM - 0.070))
gi = np.asarray(D5["guide_idx"])
gw_all = np.asarray(D5["guide_w"])
dom = gi[np.arange(n), gw_all.argmax(axis=1)]
offmag = np.linalg.norm(rxyz[parent] - groot[dom], axis=1) * 1000.0
print("offmag p50=%.1f max=%.1f mm; slen p50=%.1f; vislen p50=%.1f; "
      "fully_trimmed=%d" % (np.median(offmag), offmag.max(),
                             np.median(slen), np.median(vislen),
                             int(fully_trimmed.sum())), flush=True)

# box quality read: translucency + isolated components in temple boxes
Q = {}
for key, ainfo in base["A_templeBox"].items():
    view = key.split("/")[0]
    a = np.array(Image.open(R5 / (view + "-id.png"))
                 .convert("RGBA"))[:, :, 3]
    b = ainfo["box"]
    bm = boxm(b["r0"], b["r1"], b["c0"], b["c1"])
    h = bm & (a >= 30)
    trans = float(((a >= 30) & (a < 230) & bm).sum() / max(int(h.sum()), 1))
    solid = (bm & (a >= 230))
    lab, _ = ndimage.label(solid)
    sz = np.bincount(lab.ravel())
    iso = int(np.isin(lab, np.nonzero(sz[1:] < 30)[0] + 1).sum()) \
        if len(sz) > 1 else 0
    Q[key] = {"transFrac": round(trans, 4), "nHair": int(h.sum()),
              "isoPx": iso,
              "isoFrac": round(iso / max(int(solid.sum()), 1), 4)}
    print("QUAL %s %s" % (key, Q[key]), flush=True)

# per-rule breakdown of strands with visible samples in the boxes,
# split by visible length; plus stipple-dot roots (fully trimmed
# strands whose ROOTS project into the boxes)
flat = pts[:, 1:, :].reshape(-1, 3)
visflat = vis.reshape(-1)
sidflat = np.repeat(np.arange(n), P - 1)
diag = {"boxes": {}, "quality": Q}
strandset = set()
for key, ainfo in base["A_templeBox"].items():
    view = key.split("/")[0]
    b = ainfo["box"]
    cc, rr, dep = project(flat, view)
    inb = (cc >= b["c0"]) & (cc < b["c1"]) & (rr >= b["r0"]) & (rr < b["r1"])
    hit = inb & visflat
    sids = np.unique(sidflat[hit]) if hit.any() else np.array([], int)
    # stipple: fully-trimmed strands whose root (s=0) projects in box
    rcc, rrr, _ = project(pts[fully_trimmed][:, 0, :], view)
    inb_r = (rcc >= b["c0"]) & (rcc < b["c1"]) & (rrr >= b["r0"]) \
        & (rrr < b["r1"])
    stip = np.nonzero(fully_trimmed)[0][inb_r]
    diag["boxes"][key] = {"nStrands": int(len(sids)),
                          "nStippleRoots": int(len(stip)),
                          "stippleRootIds": [int(x) for x in stip[:60]]}
    strandset.update(sids.tolist())
    print("DIAGBOX %s strands=%d stippleRoots=%d"
          % (key, len(sids), len(stip)), flush=True)

sids = np.array(sorted(strandset), dtype=int)
proots = parent[sids]
groups: dict[str, list] = {}
for i, s in enumerate(sids):
    r = int(proots[i])
    k = ("sideburn-short" if _sbroot[r]
         else ("tuck-class" if _tuckroot[r] else "other-temple"))
    groups.setdefault(k, []).append((s, r))
for k, v in groups.items():
    vv = np.array(v)
    ss = vv[:, 0]
    rr2 = vv[:, 1]
    ll = slen[ss]
    vl = vislen[ss]
    oo = offmag[ss]
    short = vl < 60.0
    trim = fully_trimmed[ss]
    dg = dom[ss]
    diag["rule_" + k] = {
        "n": len(v),
        "lenMin/P50/Max": [round(float(ll.min()), 1),
                            round(float(np.median(ll)), 1),
                            round(float(ll.max()), 1)],
        "visLenMin/P50/Max": [round(float(vl.min()), 1),
                               round(float(np.median(vl)), 1),
                               round(float(vl.max()), 1)],
        "nVisLenLt60": int(short.sum()),
        "nFullyTrimmed": int(trim.sum()),
        "offMin/P50/Max": [round(float(oo.min()), 1),
                            round(float(np.median(oo)), 1),
                            round(float(oo.max()), 1)],
        "nOffGt15": int((oo > 15.0).sum()),
        "fracDomGuideTucked": round(float((tuck_g[dg] > 0.5).mean()), 3),
        "domGuideLenP50": round(float(np.median(glen[dg])), 1),
        "rootIdsShort": [int(rr2[j]) for j in np.nonzero(short)[0][:60]],
        "lengthsShort": [round(float(vl[j]), 1)
                         for j in np.nonzero(short)[0][:60]],
    }
    print("RULE %s %s" % (k, json.dumps(diag["rule_" + k])), flush=True)

dom_rule = max(groups, key=lambda k: len(groups[k]))
short_total = sum(int((vislen[np.array([s for s, _ in groups[k]])] < 60.0).sum())
                  for k in groups)
diag["verdict"] = (
    "dominant class by strand count in temple boxes: %s "
    "(%d/%d strands). Short visible-length (<60mm) strands in boxes: "
    "%d; fully-trimmed stipple roots projecting into boxes counted per "
    "box above. sideburn-short roots sit BELOW the helix top by "
    "construction (their n=%d here are box-edge spill); the fuzz above "
    "the helix-top line is temple roots (tuck-class + other-temple) "
    "whose transported offsets (p50 %.1fmm) swing children forward of "
    "the tuck route, plus trimmed-strand root dots."
    % (dom_rule, len(groups[dom_rule]), len(sids), short_total,
       len(groups.get("sideburn-short", [])),
       float(np.median(offmag[sids])) if len(sids) else 0.0))
diag["note"] = ("offset = root-to-dominant-guide 3D mm = frame-transport "
                "swing scale; visLen = visible-sample arc mm; stipple = "
                "roots whose strands are fully trimmed (radii~0 at s>=1) "
                "but whose s=0 root dots still render")
(E6 / "temple-diag.json").write_text(json.dumps(diag, indent=1) + "\n")

# refined front part: hairline rows only, narrow window
am = np.array(Image.open(R5 / "front-id.png").convert("RGBA"))[:, :, 3] >= 230
tm = np.array(Image.open(SCR / MASKF["front"])) > 127
rows = list(range(150, 215))


def gapline(mask, rows, col=512, halfwin=30):
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


co, wo = gapline(am, rows)
ct, wt = gapline(tm, rows)
ref = {"rows": [150, 214], "halfwin": 30,
       "ours": {"gapStdPx": round(float(co[wo > 0].std()), 2)
                if (wo > 0).any() else 0.0,
                "gapMedianWidthPx": round(float(np.median(wo[wo > 0])), 1)
                if (wo > 0).any() else 0.0,
                "nGapRows": int((wo > 0).sum())},
       "target": {"gapStdPx": round(float(ct[wt > 0].std()), 2)
                  if (wt > 0).any() else 0.0,
                  "gapMedianWidthPx": round(float(np.median(wt[wt > 0])), 1)
                  if (wt > 0).any() else 0.0,
                  "nGapRows": int((wt > 0).sum())}}
print("FRONT-HAIRLINE-PART " + json.dumps(ref), flush=True)
base["C_part"]["frontHairline"] = ref
base["A_quality"] = Q
(E6 / "baseline.json").write_text(json.dumps(base, indent=1) + "\n")
print("STEP1b done", flush=True)
