#!/usr/bin/env python3
"""groom8b D1: part feasibility, 3q miss map, swirl guides, offset stats."""
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
sys.path.insert(0, str(ROOT / "tools/openclinxr/evidence/hair-groom8a"))
import rulers as R
from children import sdf_sampler  # noqa

SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
CAME = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"
MASKF = {"front": "mask-front.png", "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png", "back": "mask-back.png"}
IDDIR8A = ROOT / "tools/openclinxr/evidence/hair-groom8a/renders-studio"


def gapline(mask, rows, col=512, halfwin=60):
    c, w = [], []
    for r in rows:
        row = mask[r]
        lo, hi = max(col - halfwin, 0), min(col + halfwin, 1024)
        seg = row[lo:hi]
        if seg[col - lo]:
            c.append(float(col)); w.append(0); continue
        l = col - lo
        while l >= 0 and not seg[l]:
            l -= 1
        rr = col - lo
        while rr < len(seg) and not seg[rr]:
            rr += 1
        c.append(float(l + 1 + lo + (rr - l - 1) / 2))
        w.append(int(rr - l - 1))
    return np.array(c), np.array(w)


def load_mask(v):
    return np.array(Image.open(str(SCR / MASKF[v]))) > 127


def load_id8a(v):
    return (np.array(Image.open(str(IDDIR8A / (v + "-id.png")))
            .convert("RGBA"))[:, :, 3] >= 230)


out = {}
# D1: target part rows
for view, rows, hw in (("back", list(range(150, 420)), 60),
                       ("front", list(range(85, 150)), 30)):
    tm = load_mask(view)
    ct, wt = gapline(tm, rows, halfwin=hw)
    nzt = wt > 0
    out["target_part_%s" % view] = {
        "nGapRows": int(nzt.sum()), "nRows": len(rows),
        "gapStdPx": round(float(ct[nzt].std()), 2) if nzt.any() else 0.0,
        "gapMedianWidthPx": round(float(np.median(wt[nzt])), 1) if nzt.any() else 0.0,
        "gapWidthsP10": round(float(np.percentile(wt[nzt], 10)), 1) if nzt.any() else 0.0,
        "gapWidthsP90": round(float(np.percentile(wt[nzt], 90)), 1) if nzt.any() else 0.0,
        "gapRows": [int(r) for r in np.array(rows)[nzt][:60]]}
# seam-equivalent on target back rows 156-950
tm = load_mask("back")
cb, wb = gapline(tm, list(range(156, 950)), halfwin=60)
out["target_seam_back"] = {"maxGapPx": int(wb.max()),
                           "p95GapPx": round(float(np.percentile(wb, 95)), 1)}
# same on groom8a back ID for reference
am = load_id8a("back")
cb8, wb8 = gapline(am, list(range(156, 950)), halfwin=60)
out["groom8a_seam_back"] = {"maxGapPx": int(wb8.max()),
                            "p95GapPx": round(float(np.percentile(wb8, 95)), 1)}
# groom8a part rows reference
for view, rows, hw in (("back", list(range(150, 420)), 60),
                       ("front", list(range(85, 150)), 30)):
    am = load_id8a(view)
    co, wo = gapline(am, rows, halfwin=hw)
    nz = wo > 0
    out["groom8a_part_%s" % view] = {
        "nGapRows": int(nz.sum()),
        "gapStdPx": round(float(co[nz].std()), 2) if nz.any() else 0.0}

# D2: 3q miss/excess spatial: row thirds + left/right halves
tgt = load_mask("three_quarter")
ours = load_id8a("three_quarter")
miss = tgt & ~ours
exc = ours & ~tgt
ys, xs = np.nonzero(tgt)
y0, y1 = int(ys.min()), int(ys.max())
h = (y1 - y0 + 1) / 3.0
xm = int(xs.min() + (xs.max() - xs.min()) / 2)
d2 = {"missN": int(miss.sum()), "excessN": int(exc.sum())}
for i, nm in enumerate(("top", "mid", "bot")):
    lo, hi = y0 + int(i * h), y0 + int((i + 1) * h)
    band = np.zeros_like(tgt)
    band[lo:hi, :] = True
    d2[nm] = {"miss": int((miss & band).sum()),
              "excess": int((exc & band).sum()),
              "missL": int((miss & band & (np.arange(1024)[None, :] < xm)).sum()),
              "missR": int((miss & band & (np.arange(1024)[None, :] >= xm)).sum()),
              "excessL": int((exc & band & (np.arange(1024)[None, :] < xm)).sum()),
              "excessR": int((exc & band & (np.arange(1024)[None, :] >= xm)).sum())}
out["groom8a_3q_spatial"] = d2

# D3: swirl guides — project guides to back, flag image-space winders
gdoc = np.load(str(ROOT / "tools/openclinxr/evidence/hair-groom8a/build/guides-8a.npz"),
               allow_pickle=True)
gh = np.asarray(gdoc["curves_head"], dtype=np.float64)
crown = np.asarray(gdoc["crown"], dtype=np.float64)
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
import frames as F
gw = F.head_to_world(gh, crown)  # metres
cams = json.loads(CAME.read_text())
sensor = float(cams["sensorWidthMm"])
M = np.array(cams["views"]["back"]["matrixWorld"], dtype=np.float64)
inv = np.linalg.inv(M)
f = float(cams["views"]["back"]["lensMm"]) / sensor * 1024.0
flat = gw.reshape(-1, 3)
hw = np.ones((len(flat), 4)); hw[:, :3] = flat
lc = (inv @ hw.T).T
dep = -lc[:, 2]
cc = 512.0 + (lc[:, 0] / np.maximum(dep, 1e-9)) * f
rr = 512.0 - (lc[:, 1] / np.maximum(dep, 1e-9)) * f
cc = cc.reshape(len(gw), -1); rr = rr.reshape(len(gw), -1)
dep = dep.reshape(len(gw), -1)
# target back orientation field (structure tensor of target beauty)
tb = np.array(Image.open(str(SCR / "target-back.png")).convert("L"), dtype=np.float64)
gx = ndimage.sobel(tb, axis=1); gy = ndimage.sobel(tb, axis=0)
gxx = ndimage.gaussian_filter(gx * gx, 6); gyy = ndimage.gaussian_filter(gy * gy, 6)
gxy = ndimage.gaussian_filter(gx * gy, 6)
t_ang = 0.5 * np.arctan2(2 * gxy, gxx - gyy) + np.pi / 2  # hair dir (perp to grad)
t_mag = np.sqrt((gxx - gyy) ** 2 + 4 * gxy ** 2)
# swirl box: upper-right back (image coords?) — find from groom8a excess comps later;
# here: whole-mask guide segments deviation
tmask = load_mask("back")
bad_guides = []
for g in range(len(gw)):
    c = cc[g]; r = rr[g]
    ok = (dep[g] > 0) & (c >= 0) & (c < 1024) & (r >= 0) & (r < 1024)
    if ok.sum() < 8:
        continue
    ci = np.clip(c[ok].astype(int), 0, 1023); ri = np.clip(r[ok].astype(int), 0, 1023)
    d = np.diff(np.stack([c[ok], r[ok]], axis=1), axis=0)
    L = np.linalg.norm(d, axis=1)
    tot = L.sum()
    if tot < 40.0:
        continue
    ga = np.arctan2(d[:, 1], d[:, 0])
    ta = t_ang[ri[:-1], ci[:-1]]
    tm_ = t_mag[ri[:-1], ci[:-1]]
    dd = np.abs((ga - ta + np.pi / 2) % np.pi - np.pi / 2)
    wgt = L * (tm_ > np.median(t_mag[tmask]))
    frac = float(wgt[dd > np.radians(25)].sum() / max(wgt.sum(), 1e-9))
    if frac > 0.3 and tmask[ri[:-1], ci[:-1]].mean() > 0.5:
        bad_guides.append((g, round(frac, 2), round(float(tot), 1)))
out["swirl_guides_fracGt30"] = bad_guides[:40]
out["nSwirlGuides"] = len(bad_guides)

# D4: root->guide-root distances (translation magnitudes if alone)
rdoc = np.load(str(ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz"),
               allow_pickle=True)
rxyz = np.asarray(rdoc["xyz"], dtype=np.float64)
groot = gw[:, 21, :] if False else None
# guide roots in world metres: resample? guide root = first stored pt
from scipy.spatial import cKDTree
gr = F.resample_arc(gw[0], 32)  # shape check only
gr_all = np.stack([F.resample_arc(gw[g], 32) for g in range(len(gw))])
guide_root = gr_all[:, 0, :]
tree = cKDTree(guide_root)
d3, _ = tree.query(rxyz, k=4)
out["root_guideRoot_dist_mm"] = {
    "k1p50": round(float(np.median(d3[:, 0])) * 1000, 2),
    "k1p90": round(float(np.percentile(d3[:, 0], 90)) * 1000, 2),
    "k1max": round(float(d3[:, 0].max()) * 1000, 2),
    "k4maxP50": round(float(np.median(d3[:, 3])) * 1000, 2)}
# D5: roots near part line in crown region
b8 = json.loads((ROOT / "tools/openclinxr/evidence/hair-groom8a/build/build.json").read_text())
px = float(b8["part"]["partX"])
for wmm in (1.0, 1.5, 2.0, 2.5, 3.0):
    m = (np.abs(rxyz[:, 0] - px) < wmm / 1000.0) & (rxyz[:, 1] >= -0.060) & (rxyz[:, 1] <= 0.0342)
    out["partstrip_roots_w%.1f" % wmm] = int(m.sum())

(E / "diag_d1.json").write_text(json.dumps(out, indent=1))
print(json.dumps(out, indent=1)[:6000])
