#!/usr/bin/env python3
"""hair-groom6 STEP 1: baselines on groom5 for A-D + temple diagnosis.

Writes E/baseline.json, E/temple-diag.json. Reads groom5 only.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
E6 = ROOT / "tools/openclinxr/evidence/hair-groom6"
E5 = ROOT / "tools/openclinxr/evidence/hair-groom5"
E2 = ROOT / "tools/openclinxr/evidence/hair-groom2"
E0 = ROOT / "tools/openclinxr/evidence/hair-orient0"
R5 = E5 / "renders-studio"
G5 = Path("/Volumes/files/src/openclinxr/.openclinxr/asset-production"
          "/hair-groom5/strands.npz")
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
CAMS = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"
PINNA = ROOT / "tools/openclinxr/evidence/hair-hull3/workspace/ear_pinna.npz"
ROOTS = ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz"
SDFP = ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz"
GTUCK = ROOT / "tools/openclinxr/evidence/hair-groom4/tucked/guides-tucked.npz"
EFRAME = ROOT / "tools/openclinxr/evidence/hair-groom4/tucked/earframe.json"
BEAUTY = {"front": "target-front-a1.png",
          "three_quarter": "target-three_quarter-a1.png",
          "profile_90": "target-profile.png",
          "back": "target-back.png"}
MASKF = {"front": "mask-front.png",
         "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png",
         "back": "mask-back.png"}

sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
from children import sdf_sampler  # noqa: E402

t0 = time.time()
opened = [str(G5), str(CAMS), str(PINNA), str(ROOTS), str(SDFP),
          str(GTUCK), str(EFRAME)]

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


def alpha5(view):
    return np.array(Image.open(R5 / (view + "-id.png"))
                    .convert("RGBA"))[:, :, 3]


pdoc = np.load(PINNA, allow_pickle=True)
pin = {s: np.asarray(pdoc["xyz"], dtype=np.float64)[np.asarray(pdoc[k])]
       for s, k in (("xpos", "idx_earXpos"), ("xneg", "idx_earXneg"))}


def pinproj(view, side):
    cc, rr, dd = project(pin[side], view)
    ok = ((cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024) & (dd > 0))
    return cc, rr, dd, ok


out = {"groom": "groom5", "scope": "A-D baselines for groom6"}

# ---------------- A: temple box, profile + 3q ----------------
A = {}
for view in ("profile_90", "three_quarter"):
    a = alpha5(view)
    t = np.array(Image.open(SCR / MASKF[view])) > 127
    opened.append(str(SCR / MASKF[view]))
    for side in ("xpos", "xneg"):
        cc, rr, dd, ok = pinproj(view, side)
        c0, r0 = float(cc[ok].mean()), float(rr[ok].mean())
        top = float(rr[ok].min())
        med = float(np.median(cc[ok]))
        toward = 1.0 if 512.0 >= med else -1.0
        cA = int(med + toward * 5)
        cB = int(med + toward * 65)
        lo, hi = sorted([cA, cB])
        bm = boxm(int(top) - 60, int(top) + 10, lo, hi)
        h = bm & (a >= 230)
        A["%s/%s" % (view, side)] = {
            "box": {"r0": int(top) - 60, "r1": int(top) + 10,
                    "c0": lo, "c1": hi},
            "oursPx": int(h.sum()),
            "targetPx": int((bm & t).sum()),
            "ratioVsTarget": round(float(h.sum())
                                   / max(int((bm & t).sum()), 1), 3),
        }
out["A_templeBox"] = A
print("A " + json.dumps(A, indent=1), flush=True)

# ---------------- B: back hem side edges ----------------
aB = alpha5("back")
tB = np.array(Image.open(SCR / MASKF["back"])) > 127
opened.append(str(SCR / MASKF["back"]))
ys, xs = np.nonzero(tB)
y0, y1 = int(ys.min()), int(ys.max()) + 1
x0, x1 = int(xs.min()), int(xs.max()) + 1
W = x1 - x0
low0 = y0 + 2 * (y1 - y0) // 3  # lower third
edge = int(round(0.15 * W))
boxes = {"left": boxm(low0, y1, x0, x0 + edge),
         "right": boxm(low0, y1, x1 - edge, x1)}
B = {"rows": [low0, y1], "hemWidthPx": W, "edgePx": edge}
for nm, bm in boxes.items():
    hair = bm & (aB >= 30)
    trans = ((aB >= 30) & (aB < 230) & bm).sum()
    miss = (bm & tB & ~(aB >= 230)).sum()
    B[nm] = {"alphaLt09Frac": round(float(trans) / max(int(hair.sum()), 1), 4),
             "nHair": int(hair.sum()),
             "maskMissFrac": round(float(miss) / max(int((bm & tB).sum()), 1), 4),
             "nTarget": int((bm & tB).sum())}
out["B_hemEdges"] = B
print("B " + json.dumps(B, indent=1), flush=True)

# ---------------- C: part straightness/width/crossings ----------------
b5 = json.loads((E5 / "build.json").read_text())
part_x = float(b5["part"]["partX"])


def part_gapline(idmask, rows, col=512, halfwin=60):
    """Per row: widest non-hair gap containing col within +-halfwin."""
    centers, widths = [], []
    for r in rows:
        row = idmask[r]
        lo = max(col - halfwin, 0)
        hi = min(col + halfwin, 1024)
        seg = row[lo:hi]
        if seg[col - lo]:
            # col itself is hair: gap width 0 at col
            centers.append(float(col))
            widths.append(0)
            continue
        l = col - lo
        while l >= 0 and not seg[l]:
            l -= 1
        rr = col - lo
        while rr < len(seg) and not seg[rr]:
            rr += 1
        centers.append(float(lo + (l + 1 + rr + lo - lo) / 2 - 0.5)
                       if False else float(l + 1 + lo + (rr - l - 1) / 2))
        widths.append(int(rr - l - 1))
    return np.array(centers), np.array(widths)


C = {"partX": part_x}
for view, rows in (("back", list(range(150, 420))),
                   ("front", list(range(150, 300)))):
    am = alpha5(view) >= 230
    tm = np.array(Image.open(SCR / MASKF[view])) > 127
    co, wo = part_gapline(am, rows)
    ct, wt = part_gapline(tm, rows)
    nz = wo > 0
    nzt = wt > 0
    C[view] = {
        "rows": [rows[0], rows[-1]],
        "ours": {"gapStdPx": round(float(co[nz].std()), 2) if nz.any() else 0.0,
                 "gapMedianWidthPx": round(float(np.median(wo[nz])), 1)
                 if nz.any() else 0.0,
                 "nGapRows": int(nz.sum())},
        "target": {"gapStdPx": round(float(ct[nzt].std()), 2)
                   if nzt.any() else 0.0,
                   "gapMedianWidthPx": round(float(np.median(wt[nzt])), 1)
                   if nzt.any() else 0.0,
                   "nGapRows": int(nzt.sum())},
    }
print("C part " + json.dumps(C, indent=1), flush=True)

# crossings within 40 mm arc of scalp
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
K = 13
parent = np.repeat(np.arange(n_root), K)
parent = np.concatenate([parent,
                         np.repeat(np.nonzero(_proot)[0], 7)])
assert len(parent) == n, (len(parent), n)
rside = np.where(rxyz[:, 0] >= part_x, 1.0, -1.0)[parent]
arc = np.zeros((n, P))
arc[:, 1:] = np.cumsum(np.linalg.norm(np.diff(pts, axis=1), axis=2), axis=1)
near = arc < 0.040
xs = pts[:, :, 0] - part_x
cross40 = near[:, 1:] & ((xs[:, 1:] >= 0) != (rside >= 0)[:, None])
vis = rad[:, 1:] > 1e-6
hit = cross40 & vis
C["crossWithin40mm"] = {"nStrands": int(np.unique(
    np.repeat(np.arange(n), P - 1)[hit.reshape(-1)]).size)
    if hit.any() else 0,
    "nSamples": int(hit.sum())}
out["C_part"] = C

# ---------------- D: front curtain bands + IoU ----------------
aF = alpha5("front") >= 230
tF = np.array(Image.open(SCR / MASKF["front"])) > 127
inter = (aF & tF).sum()
union = (aF | tF).sum()
ys, xs = np.nonzero(tF)
fy0, fy1, fx0, fx1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
fw = fx1 - fx0
bandW = fw // 3
D = {"iou": round(float(inter) / float(union), 4),
     "rows": [fy0, fy1], "cols": [fx0, fx1]}


def regional_pq(fitted, target):
    bf = fitted ^ ndimage.binary_erosion(fitted)
    bt = target ^ ndimage.binary_erosion(target)
    edt_t = ndimage.distance_transform_edt(~bt)
    edt_f = ndimage.distance_transform_edt(~bf)
    fr, fc = np.nonzero(bf)
    tr, tc = np.nonzero(bt)
    out_f = ~target[fr, fc] if fr.size else np.zeros(0, dtype=bool)
    out_t = ~fitted[tr, tc] if tr.size else np.zeros(0, dtype=bool)
    de = edt_t[fr, fc][out_f] if fr.size else np.zeros(0)
    dm = edt_f[tr, tc][out_t] if tr.size else np.zeros(0)
    q = lambda a, p: round(float(np.percentile(a, p)), 1) \
        if a.size else 0.0
    return {"excessN": int(out_f.sum()), "excessP50": q(de, 50),
            "excessP95": q(de, 95), "missN": int(out_t.sum()),
            "missP50": q(dm, 50), "missP95": q(dm, 95)}


mid0 = fy0 + (fy1 - fy0) // 3
mid1 = fy0 + 2 * (fy1 - fy0) // 3
for nm, bm in (("curtainL", boxm(mid0, mid1, fx0, fx0 + bandW)),
               ("curtainR", boxm(mid0, mid1, fx1 - bandW, fx1)),
               ("curtainMid", boxm(mid0, mid1, fx0 + bandW, fx1 - bandW))):
    D[nm] = regional_pq(aF & bm, tF & bm)
out["D_front"] = D
print("D " + json.dumps(D, indent=1), flush=True)

# ---------------- streak width (bandpass, score5 recipe) ----------------
def streak_bp(beauty):
    L = (0.2126 * beauty[140:500, 380:660, 0]
         + 0.7152 * beauty[140:500, 380:660, 1]
         + 0.0722 * beauty[140:500, 380:660, 2])
    widths = []
    for i in range(0, L.shape[0], 8):
        row = L[i]
        bp = ndimage.gaussian_filter1d(row, 3, mode="nearest") \
            - ndimage.gaussian_filter1d(row, 12, mode="nearest")
        mm = bp > 0
        d = np.diff(np.concatenate([[0], mm.view(np.int8), [0]]))
        s = np.nonzero(d == 1)[0]
        e = np.nonzero(d == -1)[0]
        widths.extend((e - s).tolist())
    w = np.array(widths)
    w = w[w >= 2]
    return {"median": round(float(np.median(w)), 1),
            "p25": round(float(np.percentile(w, 25)), 1),
            "p75": round(float(np.percentile(w, 75)), 1)}


b5img = np.asarray(Image.open(R5 / "back.png").convert("RGB"),
                   dtype=np.float64)
opened.append(str(R5 / "back.png"))
tb = np.asarray(Image.open(SCR / "target-back.png").convert("RGB"),
                dtype=np.float64)
opened.append(str(SCR / "target-back.png"))
out["streakWidth"] = {"groom5": streak_bp(b5img), "target": streak_bp(tb)}
print("streak " + json.dumps(out["streakWidth"]), flush=True)

# ---------------- eigen residual per hull region ----------------
F = np.load(str(E0 / "field.npz"), allow_pickle=True)
opened.append(str(E0 / "field.npz"))
xyz = np.asarray(F["xyz_mm"], dtype=np.float64)
gap = np.asarray(F["gap"], dtype=np.float64)
beta = np.asarray(F["beta"], dtype=np.float64)
nv = np.asarray(F["nviews"], dtype=np.int64)
resid = json.loads(str(F["resid"][0]))
qx = np.quantile(xyz[:, 0], [0.33, 0.66])
qz = np.quantile(xyz[:, 2], [0.33, 0.66])
print("hull cuts qx=%s qz=%s" % (qx.tolist(), qz.tolist()), flush=True)
regions = {
    "temple_xpos": (xyz[:, 0] > qx[1]),
    "temple_xneg": (xyz[:, 0] < qx[0]),
    "crown": ((xyz[:, 0] >= qx[0]) & (xyz[:, 0] <= qx[1])
              & (xyz[:, 2] > qz[1])),
    "back_mid": ((xyz[:, 0] >= qx[0]) & (xyz[:, 0] <= qx[1])
                 & (xyz[:, 2] <= qz[1]) & (xyz[:, 2] > qz[0])),
    "back_hem": (xyz[:, 2] <= qz[0]),
}
o2 = np.load(str(E2 / "orient2d.npz"))
opened.append(str(E2 / "orient2d.npz"))
CONF_FLOOR = 0.30
eig = {}


def unpack_state(packed, vi):
    return (np.asarray(packed, dtype=np.int64) // (3 ** vi)) % 3


hull = None
try:
    sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/orient"))
    import common_o as CO  # noqa: E402
    inp = CO.load_all()
    hull = inp["hull"]
    hviews = [str(v) for v in hull["views"]]
    vidx = {v: hviews.index(v) for v in ("front", "three_quarter",
                                        "profile_90", "back")}
    packed = np.array(hull["states_packed"])
    xs = np.array(hull["xs"], dtype=np.float64)
    ys = np.array(hull["ys"], dtype=np.float64)
    zs = np.array(hull["zs"], dtype=np.float64)
    spacing = float(hull["spacing"])
    assert abs(spacing - 2.0) < 1e-9
    camsO, sensorO = inp["cams"], inp["sensor"]
except Exception as e:  # noqa: BLE001
    print("hull reload failed: %s" % e, flush=True)

rng = np.random.RandomState(7)
for nm, m in regions.items():
    idx_all = np.nonzero(m)[0]
    row = {"n": int(m.sum()),
           "gapMean": round(float(gap[m].mean()), 3),
           "gapP10": round(float(np.percentile(gap[m], 10)), 3),
           "betaMean": round(float(beta[m].mean()), 3),
           "fracPurePrior": round(float((beta[m] == 0).mean()), 3),
           "fracNvLt2": round(float((nv[m] < 2).mean()), 3)}
    # true eigen residual l0/trace on a subsample (rebuilt M, s02 math)
    if hull is not None and len(idx_all):
        take = idx_all if len(idx_all) <= 1500 else rng.choice(
            idx_all, 1500, replace=False)
        idx = np.asarray(F["idx"], dtype=np.int64)[take]
        P3 = xyz[take] / 1000.0
        M = np.zeros((len(take), 3, 3))
        W = np.zeros(len(take))
        for vi, view in enumerate(("front", "three_quarter",
                                   "profile_90", "back")):
            cam = camsO["views"][view]
            mat = np.array(cam["matrixWorld"], dtype=np.float64)
            Rw2c = np.linalg.inv(mat)[:3, :3]
            Cc = mat[:3, 3]
            f = float(cam["lensMm"]) / float(sensorO) * 1024.0
            cc, rr, dep = CO.C2.ENV.project_to_render(P3, cam, sensorO)
            infr = ((cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
                    & (dep > 0))
            st = unpack_state(packed, vidx[view])[idx[:, 0], idx[:, 1],
                                                  idx[:, 2]]
            ci = np.clip(np.rint(cc).astype(np.int64), 0, 1023)
            ri = np.clip(np.rint(rr).astype(np.int64), 0, 1023)
            ang = np.array(o2[view + "/angle"])
            cf = np.array(o2[view + "/conf"])
            w = np.where(infr, cf[ri, ci], 0.0)
            use = infr & (st == 0) & (w >= CONF_FLOOR)
            if use.sum() == 0:
                continue
            a2 = np.deg2rad(ang[ri[use], ci[use]].astype(np.float64))
            tu, tv = -np.sin(a2), np.cos(a2)
            dcam = np.stack([tu / f, -tv / f, np.zeros_like(tu)], axis=1)
            dw = dcam @ Rw2c
            ray = P3[use] - Cc
            nvv = np.cross(ray, dw)
            nl = np.linalg.norm(nvv, axis=1)
            nl[nl == 0] = 1.0
            nvv /= nl[:, None]
            wu = w[use]
            uu = np.nonzero(use)[0]
            M[uu] += wu[:, None, None] * nvv[:, :, None] * nvv[:, None, :]
            W[uu] += wu
        lam, _ = np.linalg.eigh(M)
        tr = np.maximum(lam.sum(axis=1), 1e-12)
        res = lam[:, 0] / tr
        has = W > 0
        row["eigenResid"] = {
            "n": int(has.sum()),
            "mean": round(float(res[has].mean()), 3) if has.any() else None,
            "p95": round(float(np.percentile(res[has], 95)), 3)
            if has.any() else None,
            "flagGt03": bool(float(res[has].mean()) > 0.3)
            if has.any() else False}
    eig[nm] = row
    print("EIG %s %s" % (nm, json.dumps(row)), flush=True)
out["eigenResidual"] = {"regions": eig, "cuts": {"qx": qx.tolist(),
                                                 "qz": qz.tolist()},
                        "viewResid": resid,
                        "note": "eigenResid=l0/trace on <=1500-voxel "
                        "subsample per region (rebuilt M, s02 math); "
                        "flag where mean>0.3"}

(E6 / "baseline.json").write_text(json.dumps(out, indent=1) + "\n")

# ---------------- temple diagnosis ----------------
gdoc = np.load(str(GTUCK), allow_pickle=True)
print("tuck keys: %s" % ([k for k in gdoc.files],), flush=True)
crowng = np.asarray(gdoc["crown"], dtype=np.float64)
ch = np.asarray(gdoc["curves_head"], dtype=np.float64)
tuck_g = np.asarray(gdoc["tuck"], dtype=np.float64) \
    if "tuck" in gdoc.files else np.zeros(ch.shape[0])
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/route"))
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/cage"))
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom"))
import common2 as C2  # noqa: E402
gw = C2.head_to_world(ch, crowng)
groot = gw[:, 0, :]
# guide arc lengths
glen = np.linalg.norm(np.diff(gw, axis=1), axis=2).sum(axis=1) * 1000.0

# root classes (children.py rules)
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
_tbox = [0.045, 0.085, -0.135, -0.040]
_tuckbox = ((np.abs(rxyz[:, 0]) >= _tbox[0])
            & (np.abs(rxyz[:, 0]) < _tbox[1])
            & (rxyz[:, 1] >= _tbox[2]) & (rxyz[:, 1] < _tbox[3]))
gi = np.asarray(D5["guide_idx"])
gw_all = np.asarray(D5["guide_w"])
dom = gi[np.arange(n), gw_all.argmax(axis=1)]
offmag = np.linalg.norm(rxyz[parent] - groot[dom], axis=1) * 1000.0
slen = arc[:, -1] * 1000.0

# strands with visible samples in either temple box (strand-level diag)
flat = pts[:, 1:, :].reshape(-1, 3)
visflat = vis.reshape(-1)
sidflat = np.repeat(np.arange(n), P - 1)
diag = {"boxes": {}}
strandset = set()
tips_off = {}
sample, _grid = sdf_sampler(np.load(str(SDFP), allow_pickle=True))
for view in ("profile_90", "three_quarter"):
    for side in ("xpos", "xneg"):
        key = "%s/%s" % (view, side)
        r0b, r1b = A[key]["box"]["r0"], A[key]["box"]["r1"]
        c0b, c1b = A[key]["box"]["c0"], A[key]["box"]["c1"]
        cc, rr, dep = project(flat, view)
        inb = (cc >= c0b) & (cc < c1b) & (rr >= r0b) & (rr < r1b)
        hit = inb & visflat
        sids = np.unique(sidflat[hit]) if hit.any() else np.array([], int)
        # tips in box + SDF at tip
        tipcc, tiprr, _td = project(pts[:, -1, :], view)
        intip = (tipcc >= c0b) & (tipcc < c1b) & (tiprr >= r0b) & (tiprr < r1b)
        tiprad = rad[:, -1] > 1e-6
        ntip = int((intip & tiprad).sum())
        far = 0
        if (intip & tiprad).any():
            vals, inside = sample(pts[intip & tiprad][:, -1, :])
            vals = np.where(inside, vals, 999.0)
            far = int((vals > 3.0).sum())
        diag["boxes"][key] = {"nStrands": int(len(sids)),
                              "nTipsInBox": ntip,
                              "nTipsGt3mmOffSkin": far}
        strandset.update(sids.tolist())
        print("DIAGBOX %s strands=%d tips=%d far=%d"
              % (key, len(sids), ntip, far), flush=True)

sids = np.array(sorted(strandset), dtype=int)
proots = parent[sids]
rules = []
for i, s in enumerate(sids):
    r = int(proots[i])
    rules.append({
        "strand": int(s), "root": r,
        "rootXyzMm": [round(float(v) * 1000.0, 1) for v in rxyz[r]],
        "lenMm": round(float(slen[s]), 1),
        "sideburn": bool(_sbroot[r]),
        "tuckClass": bool(_tuckroot[r]),
        "tuckBox": bool(_tuckbox[r]),
        "domGuide": int(dom[s]),
        "domGuideTucked": bool(tuck_g[dom[s]] > 0.5),
        "domGuideLenMm": round(float(glen[dom[s]]), 1),
        "offsetMm": round(float(offmag[s]), 1),
    })
by_rule = {}
for r in rules:
    k = ("sideburn-short" if r["sideburn"]
         else ("tuck-class" if r["tuckClass"] else "other-temple"))
    by_rule.setdefault(k, []).append(r)
diag["nStrandsTotal"] = len(sids)
for k, v in by_rule.items():
    ll = np.array([x["lenMm"] for x in v])
    oo = np.array([x["offsetMm"] for x in v])
    diag["rule_" + k] = {
        "n": len(v),
        "lenMin": round(float(ll.min()), 1),
        "lenP50": round(float(np.median(ll)), 1),
        "lenMax": round(float(ll.max()), 1),
        "offP50": round(float(np.median(oo)), 1),
        "offMax": round(float(oo.max()), 1),
        "fracDomGuideTucked": round(float(np.mean(
            [x["domGuideTucked"] for x in v])), 3),
        "rootIds": [x["root"] for x in v][:60],
        "lengths": [x["lenMm"] for x in v][:60],
    }
    print("RULE %s n=%d len %.1f/%.1f/%.1f off p50=%.1f max=%.1f "
          "tucked=%.3f" % (k, len(v), ll.min(), np.median(ll), ll.max(),
                            np.median(oo), oo.max(), np.mean(
                                [x["domGuideTucked"] for x in v])), flush=True)
# verdict: dominant rule by count
dom_rule = max(by_rule, key=lambda k: len(by_rule[k])) if by_rule else "none"
diag["verdict"] = (
    "dominant rule in temple boxes: %s (n=%d/%d). "
    "sideburn-short roots sit BELOW the helix top by construction; "
    "temple-box strands above it are %s."
    % (dom_rule, len(by_rule.get(dom_rule, [])),
       len(sids), "tuck-class/other-temple" if dom_rule != "sideburn-short"
       else "sideburn shorts leaking above the helix-top line"))
diag["note"] = ("roots: scalp root ids feeding strands with visible "
                "samples in the profile/3q temple boxes above the helix "
                "top; lengths = strand arc mm; offset = root-to-dominant-"
                "guide 3D mm (frame-transport swing scale)")
(E6 / "temple-diag.json").write_text(json.dumps(diag, indent=1) + "\n")
(E6 / "inputs-opened.txt").write_text("\n".join(sorted(set(opened))) + "\n")
print("STEP1 done in %.0fs" % (time.time() - t0), flush=True)
