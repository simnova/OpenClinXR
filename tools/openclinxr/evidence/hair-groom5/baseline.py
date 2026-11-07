#!/usr/bin/env python3
"""hair-groom5 STEP 1: baselines on groom3 (Review 20 A/B/C measures).

Translucency: fraction of hair-ID pixels (alpha>=30) with alpha<230
(<0.9) per view + boxes (crown, back hem, nape, behind ear).
Streak width: median light/dark run width in the back crop (groom3 +
target). Pinna visibility: 1 - hair cover over projected pinna hull
(profile). Concha: 11px-box ID px + strand-level crossing counts
(visible samples inside the box AND anterior of the pinna); front-of-ear
above-sideburn strand count. Writes E/baseline.json. numpy+PIL+scipy.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import ConvexHull, Delaunay

E5 = Path(__file__).resolve().parent
ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
E3 = ROOT / "tools/openclinxr/evidence/hair-groom3"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
CAMS = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"
PINNA = ROOT / "tools/openclinxr/evidence/hair-hull3/workspace/ear_pinna.npz"
G3STR = E3 / "strands.npz"
VIEWS = ("front", "three_quarter", "profile_90", "back")
ALPHA_HAIR = 30
ALPHA_SOLID = 230  # 0.9*255 = 229.5


def load_alpha(view, rdir):
    return np.array(Image.open(rdir / (view + "-id.png")).convert("RGBA"))[:, :, 3]


def load_beauty(path):
    a = np.array(Image.open(path).convert("RGB"), dtype=np.float64)
    return a


def lum(rgb):
    return (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2])


def trans_frac(alpha, mask=None):
    m = alpha >= ALPHA_HAIR if mask is None else (mask & (alpha >= ALPHA_HAIR))
    n = int(m.sum())
    if n == 0:
        return {"frac": 0.0, "nHair": 0, "nTrans": 0}
    t = int(((alpha >= ALPHA_HAIR) & (alpha < ALPHA_SOLID) & m).sum())
    return {"frac": round(t / n, 4), "nHair": n, "nTrans": t}


def box_mask(shape, r0, r1, c0, c1):
    m = np.zeros(shape, dtype=bool)
    m[r0:r1, c0:c1] = True
    return m


def main():
    out = {"alphaHair": ALPHA_HAIR, "alphaSolid": ALPHA_SOLID, "groom": "groom3"}
    R3 = E3 / "renders-studio"

    # ---- B translucency ----
    boxes_back = {
        "crown": box_mask((1024, 1024), 140, 364, 412, 636),
        "backHem": box_mask((1024, 1024), 690, 830, 300, 724),
        "nape": box_mask((1024, 1024), 480, 640, 440, 585),
    }
    trans = {}
    for v in VIEWS:
        a = load_alpha(v, R3)
        trans[v] = {"global": trans_frac(a)}
    aback = load_alpha("back", R3)
    for name, m in boxes_back.items():
        trans["back"][name] = trans_frac(aback, m)

    # ---- cameras + pinna projection ----
    cams = json.loads(CAMS.read_text())
    sensor = float(cams["sensorWidthMm"])
    proj = {}
    for v in ("front", "three_quarter", "profile_90"):
        M = np.array(cams["views"][v]["matrixWorld"], dtype=np.float64)
        f = float(cams["views"][v]["lensMm"]) / sensor * 1024.0
        proj[v] = (np.linalg.inv(M), f)
    pdoc = np.load(PINNA, allow_pickle=True)
    pin = {s: np.asarray(pdoc["xyz"], dtype=np.float64)[np.asarray(pdoc[k])]
           for s, k in (("xpos", "idx_earXpos"), ("xneg", "idx_earXneg"))}

    def project(pts, v):
        inv, f = proj[v]
        hw = np.ones((len(pts), 4))
        hw[:, :3] = np.asarray(pts, dtype=np.float64)
        lc = (inv @ hw.T).T
        dep = -lc[:, 2]
        cc = np.full(len(pts), -1.0)
        rr = np.full(len(pts), -1.0)
        ok = dep > 0
        cc[ok] = 512.0 + (lc[ok, 0] / dep[ok]) * f
        rr[ok] = 512.0 - (lc[ok, 1] / dep[ok]) * f
        return cc, rr, dep

    # behind-ear boxes (profile, pinna centroid +-70px) translucency
    trans["profile_90"]["behindEar"] = {}
    for side in ("xpos", "xneg"):
        cc, rr, dd = project(pin[side], "profile_90")
        m = (cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024) & (dd > 0)
        c0, r0 = float(cc[m].mean()), float(rr[m].mean())
        bm = box_mask((1024, 1024), max(int(r0) - 70, 0), min(int(r0) + 70, 1024),
                      max(int(c0) - 70, 0), min(int(c0) + 70, 1024))
        trans["profile_90"]["behindEar"][side] = trans_frac(load_alpha("profile_90", R3), bm)
    out["translucency"] = trans

    # ---- A pinna visibility (profile hull) + concha boxes ----
    pinvis, concha = {}, {}
    for v in ("front", "three_quarter", "profile_90"):
        a = load_alpha(v, R3)
        pinvis[v] = {}
        concha[v] = {}
        for side in ("xpos", "xneg"):
            cc, rr, dd = project(pin[side], v)
            m = (cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024) & (dd > 0)
            c0, r0 = float(cc[m].mean()), float(rr[m].mean())
            bx = (slice(max(int(r0) - 5, 0), int(r0) + 6),
                  slice(max(int(c0) - 5, 0), int(c0) + 6))
            concha[v][side] = {"id230": int((a[bx] >= ALPHA_SOLID).sum()),
                               "id30": int((a[bx] >= ALPHA_HAIR).sum())}
            p2 = np.stack([cc[m], rr[m]], axis=1)
            tri = Delaunay(p2[ConvexHull(p2).vertices])
            c0b, c1b = max(int(p2[:, 0].min()) - 2, 0), min(int(p2[:, 0].max()) + 3, 1024)
            r0b, r1b = max(int(p2[:, 1].min()) - 2, 0), min(int(p2[:, 1].max()) + 3, 1024)
            yy, xx = np.nonzero(np.ones((r1b - r0b, c1b - c0b)))
            sub = tri.find_simplex(np.stack([xx + c0b, yy + r0b], axis=1)) >= 0
            hull = np.zeros((1024, 1024), dtype=bool)
            hull[r0b:r1b, c0b:c1b][sub.reshape(r1b - r0b, c1b - c0b)] = True
            nh = int(hull.sum())
            for thr, tag in ((ALPHA_HAIR, "cover30"), (ALPHA_SOLID, "cover230")):
                cov = float(((a >= thr) & hull).sum() / max(nh, 1))
                pinvis[v][side + "/" + tag] = {"cover": round(cov, 4),
                                               "visible": round(1 - cov, 4),
                                               "nHull": nh}
    out["pinnaVisibility"] = pinvis
    out["conchaBoxesID"] = concha

    # ---- A strand-level: concha crossings + front-of-ear above sideburn ----
    S = np.load(G3STR, allow_pickle=True)
    pts = np.asarray(S["points"], dtype=np.float64)
    rad = np.asarray(S["radii"], dtype=np.float64)
    n, P, _ = pts.shape
    vis = rad[:, 1:] > 1e-6
    flat = pts[:, 1:, :].reshape(-1, 3)
    visflat = vis.reshape(-1)
    strandidx = np.repeat(np.arange(n), P - 1)
    strand_cross = {}
    front_above = {}
    for v in ("front", "three_quarter", "profile_90"):
        cc, rr, dep = project(flat, v)
        strand_cross[v] = {}
        for side in ("xpos", "xneg"):
            pcc, prr, pdep = project(pin[side], v)
            pm = (pcc >= 0) & (pcc < 1024) & (prr >= 0) & (prr < 1024) & (pdep > 0)
            c0, r0 = float(pcc[pm].mean()), float(prr[pm].mean())
            pd = float(np.median(pdep[pm]))
            inbx = (cc >= c0 - 5) & (cc <= c0 + 5) & (rr >= r0 - 5) & (rr <= r0 + 5)
            cross = inbx & visflat & (dep >= pd - 0.003) & (dep <= pd + 0.030)
            strand_cross[v][side] = {"nSamples": int(cross.sum()),
                                     "nStrands": int(np.unique(strandidx[cross]).size)
                                     if cross.any() else 0}
        # front-of-ear above sideburn line: visible samples anterior of the
        # pinna back plane (depth < pinna depth - 3mm) in the ear x/z zone,
        # at/above helix top (use max depth margin: any view)
        strand_cross[v]["note"] = "box 11px; depth window pinna-3mm..pinna+30mm"
    # world-space front-of-ear above sideburn (view-independent)
    foe = {}
    for side, sgn in (("xpos", 1.0), ("xneg", -1.0)):
        pv = pin[side]
        yPost = float(pv[:, 1].max())
        zTop = float(pv[:, 2].max())
        xEar = float(np.median(pv[:, 0]))
        sub = pts[:, 1:, :]
        zone = (np.abs(sub[:, :, 0] - xEar) < 0.025) & (sub[:, :, 2] >= zTop) \
            & (sub[:, :, 1] < yPost - 0.003)
        hit = zone & vis
        foe[side] = {"nSamples": int(hit.sum()),
                     "nStrands": int(np.unique(np.repeat(np.arange(n), P - 1)[hit.reshape(-1)]).size)
                     if hit.any() else 0,
                     "zTopMm": round(zTop * 1000.0, 1)}
    out["conchaCrossingsStrand"] = strand_cross
    out["frontOfEarAboveSideburn"] = foe

    # ---- C streak width: back crop rows, groom3 + target ----
    def streak_width(beauty, r0=140, r1=500, c0=380, c1=660):
        L = lum(beauty[r0:r1, c0:c1])
        widths = []
        for i in range(0, L.shape[0], 8):
            row = L[i]
            bg = ndimage.median_filter(row, size=61, mode="nearest")
            sig = row - bg
            thr = 0.5 * float(np.std(sig))
            if thr < 1e-9:
                continue
            m = np.abs(sig) > thr
            # run lengths
            d = np.diff(np.concatenate([[0], m.view(np.int8), [0]]))
            starts = np.nonzero(d == 1)[0]
            ends = np.nonzero(d == -1)[0]
            widths.extend((ends - starts).tolist())
        widths = np.array(widths)
        widths = widths[(widths >= 2) & (widths <= 200)]
        return {"median": round(float(np.median(widths)), 1),
                "p25": round(float(np.percentile(widths, 25)), 1),
                "p75": round(float(np.percentile(widths, 75)), 1),
                "nRuns": int(len(widths))}

    g3b = load_beauty(R3 / "back.png")
    tgt = load_beauty(SCR / "target-back.png")
    out["streakWidth"] = {"groom3": streak_width(g3b), "target": streak_width(tgt),
                          "box": "back rows140-500 cols380-660 step8, bg med61, thr 0.5std"}

    def streak_wide(beauty, r0=140, r1=500, c0=380, c1=660):
        # clump-ribbon bands: bandpass sigma3-sigma12 (keeps ~6-25px
        # features: fine texture + ribbons, drops illumination falloff),
        # runs above/below zero.
        L = lum(beauty[r0:r1, c0:c1])
        widths = []
        for i in range(0, L.shape[0], 8):
            row = L[i]
            bp = ndimage.gaussian_filter1d(row, 3, mode="nearest") \
                - ndimage.gaussian_filter1d(row, 12, mode="nearest")
            m = bp > 0
            d = np.diff(np.concatenate([[0], m.view(np.int8), [0]]))
            starts = np.nonzero(d == 1)[0]
            ends = np.nonzero(d == -1)[0]
            widths.extend((ends - starts).tolist())
        widths = np.array(widths)
        widths = widths[widths >= 2]
        return {"median": round(float(np.median(widths)), 1),
                "p25": round(float(np.percentile(widths, 25)), 1),
                "p75": round(float(np.percentile(widths, 75)), 1),
                "nRuns": int(len(widths))}

    out["streakWidthWide"] = {"groom3": streak_wide(g3b), "target": streak_wide(tgt),
                              "box": "same crop, bandpass sigma3-sigma12 zero-crossing runs"}
    # groom3 N x d
    b3 = json.loads((E3 / "build.json").read_text())
    out["groom3NxD"] = {"N": b3["counts"]["children"],
                        "rRootMm": b3["radiiMm"]["root"], "rTipMm": b3["radiiMm"]["tip"]}
    (E5 / "baseline.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
