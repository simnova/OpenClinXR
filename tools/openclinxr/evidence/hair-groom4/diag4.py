#!/usr/bin/env python3
"""hair-groom4 STEP 1: diagnose ear wrap + back-crown part on groom3 strands.

Native-crop root-region / guide-id projection renders + measured causes:
 (1) ear: strands with samples in front-of-lobe / neck-drop zones
     (zones from pinna projection per side/view) attributed to parent
     root region + guide ids; tip-in-zone strands (the hanging loop).
 (2) part: part-band root/child counts, child exit-direction stats
     (angle vs lateral-perpendicular, scalp-normal lift), dominant
     guides; target vs groom3 part-line width (px, back crown crop).
 (4) front: target-outline vs groom3-ID outer-edge gap at neck/chest
     rows (px + mm via projection scale) -> curtain-widen estimate.

Writes E/diag4.json + E/diag4_ear_3q.png + E/diag4_ear_profile.png +
E/diag4_part_back.png. numpy+PIL only.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E4 = Path(__file__).resolve().parent
ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
E3 = ROOT / "tools/openclinxr/evidence/hair-groom3"
E2 = ROOT / "tools/openclinxr/evidence/hair-groom2"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
TGT = {"three_quarter": "target-three_quarter-a1.png",
       "profile_90": "target-profile.png", "back": "target-back.png",
       "front": "target-front-a1.png"}
MSKF = {"three_quarter": "mask-three_quarter.png",
        "profile_90": "mask-profile.png", "back": "mask-back.png",
        "front": "mask-front.png"}
CAMS = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"
PINNA = ROOT / "tools/openclinxr/evidence/hair-hull3/workspace/ear_pinna.npz"
ROOTS = ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz"
G3STR = E3 / "strands.npz"
PART_X = 0.0001401995879485164

REG_COL = {"part": (255, 80, 80), "crown": (80, 200, 255),
           "temple": (255, 220, 80), "sideburn": (255, 140, 40),
           "side": (160, 160, 160), "nape": (140, 255, 140)}


def load_proj(views):
    cams = json.loads(CAMS.read_text())
    sensor = float(cams["sensorWidthMm"])
    proj = {}
    for v in views:
        m = np.array(cams["views"][v]["matrixWorld"], dtype=np.float64)
        f = float(cams["views"][v]["lensMm"]) / sensor * 1024.0
        proj[v] = (np.linalg.inv(m), f)
    return proj


def project(pts, inv, f):
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


def region_of(xyz):
    x, y, z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    lab = np.full(len(xyz), "side", dtype=object)
    lab[(np.abs(x) < 0.008) & (z > 1.575)] = "part"
    lab[(z >= 1.590) & (np.abs(x) >= 0.008)] = "crown"
    lab[(np.abs(x) >= 0.045) & (np.abs(x) < 0.072)
        & (y >= -0.135) & (y < -0.085)] = "temple"
    lab[(np.abs(x) >= 0.052) & (y >= -0.100)
        & (y < -0.040)] = "sideburn"
    lab[(y >= 0.0)] = "nape"
    return lab


def main():
    E4.mkdir(parents=True, exist_ok=True)
    out = {}
    sdoc = np.load(G3STR)
    pts = np.asarray(sdoc["points"], dtype=np.float64)
    roots_sub = np.asarray(sdoc["roots"], dtype=np.float64)
    gi = np.asarray(sdoc["guide_idx"])[:, 0]
    n, P, _ = pts.shape
    rdoc = np.load(ROOTS)
    rxyz = np.asarray(rdoc["xyz"], dtype=np.float64)
    rnorm = np.asarray(rdoc["normal"], dtype=np.float64)
    rnorm /= np.linalg.norm(rnorm, axis=1, keepdims=True) + 1e-12
    K = n // len(rxyz)
    parent = np.repeat(np.arange(len(rxyz)), K)
    lab = region_of(rxyz[parent])
    pdoc = np.load(PINNA, allow_pickle=True)
    pin_all = np.asarray(pdoc["xyz"], dtype=np.float64)
    pin = {"xpos": pin_all[np.asarray(pdoc["idx_earXpos"])],
           "xneg": pin_all[np.asarray(pdoc["idx_earXneg"])]}
    # lobeDirector: bottom 20 mm of each pinna = lobe; neck = below.
    lobe = {}
    for side, pv in pin.items():
        zmin = float(pv[:, 2].min())
        lobe[side] = {"zmin": zmin, "zLobeTop": zmin + 0.020,
                      "xC": float(np.median(pv[:, 0])),
                      "yBack": float(np.quantile(pv[:, 1], 0.90))}
    out["lobeZones"] = {k: v for k, v in lobe.items()}

    proj = load_proj(("three_quarter", "profile_90", "back", "front"))
    # ---- (1) EAR: zones from pinna projection per side/view ----
    ear = {}
    dots = {}  # view -> (cc, rr, colour-key) for render
    for v in ("three_quarter", "profile_90"):
        inv, f = proj[v]
        zones = {}
        for side, pv in pin.items():
            cc, rr, dep = project(pv, inv, f)
            m = (cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
            cc0, rr0 = float(cc[m].mean()), float(rr[m].mean())
            # face side in px: project lobe centroid shifted anterior (-y)
            lc = pv.mean(axis=0) + np.array([0, -0.05, 0.0])
            fx, fy, _ = project(lc[None, :], inv, f)
            sx = 1.0 if float(fx[0]) - cc0 >= 0 else -1.0
            bb = {"c0": float(cc[m].min()), "c1": float(cc[m].max()),
                  "r0": float(rr[m].min()), "r1": float(rr[m].max())}
            h = bb["r1"] - bb["r0"]
            lobe_rows = [bb["r1"] - 0.30 * h, bb["r1"]]
            # front-of-lobe: anterior of lobe bbox, 60 px wide
            flo = {"cols": sorted([bb["c0"] if sx < 0 else bb["c1"],
                                   (bb["c0"] if sx < 0 else bb["c1"])
                                   + sx * 60.0]),
                   "rows": lobe_rows}
            # neck-drop: below pinna bottom +70 rows, ear width +/-
            neck = {"cols": [bb["c0"] - 25.0, bb["c1"] + 25.0],
                    "rows": [bb["r1"], bb["r1"] + 70.0]}
            zones[side] = {"bbox": bb, "faceSx": sx, "frontLobe": flo,
                           "neck": neck}
        ear[v] = {"zones": zones}
        # attribute strand samples (every 4th, s>=1)
        samp = pts[:, 1::4, :].reshape(-1, 3)
        per = samp.shape[0] // n
        owner = np.repeat(np.arange(n), per)
        cc, rr, dep = project(samp, inv, f)
        view_attr = {}
        for zname in ("frontLobe", "neck"):
            cnt = np.zeros(n, dtype=int)
            for side in ("xpos", "xneg"):
                z = zones[side][zname]
                inb = (cc >= z["cols"][0]) & (cc <= z["cols"][1]) \
                    & (rr >= z["rows"][0]) & (rr <= z["rows"][1]) \
                    & (dep > 0)
                np.add.at(cnt, owner[inb], 1)
            sel = cnt >= 2
            rl, rc = np.unique(lab[sel], return_counts=True)
            gl, gc = np.unique(gi[sel], return_counts=True)
            topg = sorted(zip(gl.tolist(), gc.tolist()),
                          key=lambda t: -t[1])[:10]
            # tips in zone (hanging loop candidates)
            tc, tr, td = project(pts[:, -1, :], inv, f)
            tip = np.zeros(n, dtype=bool)
            for side in ("xpos", "xneg"):
                z = zones[side][zname]
                tip |= (tc >= z["cols"][0]) & (tc <= z["cols"][1]) \
                    & (tr >= z["rows"][0]) & (tr <= z["rows"][1]) \
                    & (td > 0)
            view_attr[zname] = {
                "nStrands": int(sel.sum()),
                "regions": {str(k): int(z) for k, z in zip(rl, rc)},
                "topGuides": [[int(g), int(c)] for g, c in topg],
                "nTipsInZone": int(tip.sum())}
        ear[v]["attr"] = view_attr
        # dots for render: samples in either zone coloured by region
        keep = np.zeros(len(samp), dtype=bool)
        for side in ("xpos", "xneg"):
            for zname in ("frontLobe", "neck"):
                z = zones[side][zname]
                keep |= (cc >= z["cols"][0]) & (cc <= z["cols"][1]) \
                    & (rr >= z["rows"][0]) & (rr <= z["rows"][1])
        dots[v] = (cc[keep], rr[keep], lab[owner[keep]])
    out["ear"] = ear

    # ---- (2) PART: band counts + exit directions + width ----
    pr = rxyz[parent]
    part_band = (np.abs(pr[:, 0] - PART_X) < 0.012) & (pr[:, 1] <= 0.0342)
    out["partBand"] = {"nRoots": int((np.abs(
        rxyz[:, 0] - PART_X) < 0.012).sum()),
        "nRootsCrownZone": int(part_band.sum() // max(K, 1)),
        "nChildren": int(part_band.sum())}
    d0 = pts[:, 1, :] - pts[:, 0, :]
    d0 /= np.linalg.norm(d0, axis=2 if False else 1)[:, None] + 1e-12 \
        if False else 1.0
    d0n = np.linalg.norm(d0, axis=1, keepdims=True) + 1e-12
    d0 = d0 / d0n
    sgn = np.where(pr[:, 0] >= PART_X, 1.0, -1.0)
    lat = np.zeros_like(d0)
    lat[:, 0] = sgn
    nn = rnorm[parent]
    lat_t = lat - (lat * nn).sum(axis=1)[:, None] * nn
    lat_t /= np.linalg.norm(lat_t, axis=1, keepdims=True) + 1e-12
    cosang = np.clip((d0 * lat_t).sum(axis=1), -1.0, 1.0)
    ang = np.degrees(np.arccos(cosang))
    lift = (d0 * nn).sum(axis=1)
    pb = part_band
    out["partExit"] = {
        "angleVsPerpFlat_p50": round(float(np.percentile(ang[pb], 50)), 1),
        "angleVsPerpFlat_p95": round(float(np.percentile(ang[pb], 95)), 1),
        "normalLift_p50": round(float(np.percentile(lift[pb], 50)), 3),
        "normalLiftGlobal_p50": round(float(np.percentile(lift, 50)), 3)}
    gl2, gc2 = np.unique(gi[pb], return_counts=True)
    out["partTopGuides"] = [[int(g), int(c)] for g, c in
                            sorted(zip(gl2.tolist(), gc2.tolist()),
                                   key=lambda t: -t[1])[:10]]

    def part_width(beauty_path, rows=(150, 360), cols=(460, 564)):
        b = np.asarray(Image.open(beauty_path).convert("RGB"),
                       dtype=np.float64)
        lum = (0.2126 * b[..., 0] + 0.7152 * b[..., 1]
               + 0.0722 * b[..., 2])
        r0, r1, c0, c1 = rows[0], rows[1], cols[0], cols[1]
        prof = lum[r0:r1, c0:c1].mean(axis=0)
        # part = bright gap between dark hair: peak above hair baseline
        base = float(np.percentile(prof, 20))
        pk = float(prof.max())
        half = base + 0.5 * (pk - base)
        wide = np.nonzero(prof >= half)[0]
        # longest contiguous run around the peak
        i0 = int(np.argmax(prof))
        lo = i0
        while lo - 1 >= 0 and prof[lo - 1] >= half:
            lo -= 1
        hi = i0
        while hi + 1 < len(prof) and prof[hi + 1] >= half:
            hi += 1
        return {"widthPx": int(hi - lo + 1), "peakCol": int(c0 + i0),
                "base": round(base, 1), "peak": round(pk, 1)}

    out["partWidthTarget"] = part_width(SCR / TGT["back"])
    out["partWidthGroom3"] = part_width(E3 / "renders-studio/back.png")

    # ---- (4) FRONT gap: target outline vs groom3 ID outer edge ----
    tm = np.array(Image.open(SCR / MSKF["front"])) > 127
    gid = np.array(Image.open(E3 / "renders-studio/front-id.png")
                   .convert("RGBA"))[:, :, 3] >= 230
    gaps = []
    for r in range(450, 701):
        tt = np.nonzero(tm[r])[0]
        gg = np.nonzero(gid[r])[0]
        if len(tt) == 0 or len(gg) == 0:
            continue
        gaps.append((int(tt.min() - gg.min()), int(gg.max() - tt.max())))
    gaps = np.array(gaps)
    # px->mm at curtain depth: project 10 mm x-step at (±80, -40, 1500)mm
    inv_f, f_f = proj["front"]
    a = np.array([[0.080, -0.040, 1.500]])
    bpt = np.array([[0.090, -0.040, 1.500]])
    ca, ra, _ = project(a, inv_f, f_f)
    cb, rb, _ = project(bpt, inv_f, f_f)
    pxmm = float(abs(cb[0] - ca[0])) / 10.0
    out["frontGap"] = {
        "rows": [450, 700],
        "leftGapPx_p50": round(float(np.percentile(gaps[:, 0], 50)), 1),
        "rightGapPx_p50": round(float(np.percentile(gaps[:, 1], 50)), 1),
        "pxPerMm": round(pxmm, 3),
        "leftGapMm_p50": round(float(np.percentile(gaps[:, 0], 50))
                               / pxmm, 1),
        "rightGapMm_p50": round(float(np.percentile(gaps[:, 1], 50))
                                / pxmm, 1)}

    (E4 / "diag4.json").write_text(json.dumps(out, indent=1) + "\n")

    # ---- renders: native crops with zones + region dots ----
    CROPS = {"three_quarter": (380, 660, 330, 610),
             "profile_90": (250, 530, 270, 550),
             "back": (412, 636, 140, 364)}
    for v, wink in (("three_quarter", "3q ear"),
                    ("profile_90", "profile ear")):
        c0, c1, r0, r1 = CROPS[v]
        tgt = Image.open(SCR / TGT[v]).convert("RGB").crop((c0, r0, c1, r1))
        g3 = Image.open(E3 / ("renders-studio/%s.png" % v)).convert(
            "RGB").crop((c0, r0, c1, r1))
        W, H = tgt.size
        sheet = Image.new("RGB", (2 * W, 2 * H + 30), (18, 18, 18))
        dr = ImageDraw.Draw(sheet)
        dr.text((8, 4), "target %s  |  groom3  |  zones+region dots" % wink,
                fill=(240, 240, 240))
        sheet.paste(tgt, (0, 30))
        sheet.paste(g3, (W, 30))
        # zone overlay + dots on groom3 tile
        ov = g3.copy()
        dr2 = ImageDraw.Draw(ov, "RGBA")
        cc, rr, lb = dots[v]
        for side in ("xpos", "xneg"):
            for zname, col in (("frontLobe", (255, 60, 60)),
                               ("neck", (255, 160, 40))):
                z = ear[v]["zones"][side][zname]
                dr2.rectangle([z["cols"][0] - c0, z["rows"][0] - r0,
                               z["cols"][1] - c0, z["rows"][1] - r0],
                              outline=col, width=2)
        dot_layer = Image.new("RGBA", ov.size, (0, 0, 0, 0))
        dd = ImageDraw.Draw(dot_layer)
        m = (cc >= c0) & (cc < c1) & (rr >= r0) & (rr < r1)
        idx = np.nonzero(m)[0]
        # cap dots for file size
        if len(idx) > 20000:
            idx = idx[::len(idx) // 20000]
        for i in idx:
            dd.point((float(cc[i]) - c0, float(rr[i]) - r0),
                     fill=REG_COL.get(str(lb[i]), (255, 255, 255)))
        ov = Image.alpha_composite(ov.convert("RGBA"), dot_layer).convert(
            "RGB")
        sheet.paste(tgt.crop((0, 0, W, H)), (0, 30))
        sheet.paste(ov, (0, 30 + H))
        sheet.paste(g3, (W, 30))
        sheet.paste(g3.crop((0, 0, W, H)), (W, 30 + H))
        sheet.save(E4 / ("diag4_ear_%s.png" % v.split("_")[0]))
    # back crown: region dots on groom3 crop
    c0, c1, r0, r1 = CROPS["back"]
    tgt = Image.open(SCR / TGT["back"]).convert("RGB").crop(
        (c0, r0, c1, r1))
    g3 = Image.open(E3 / "renders-studio/back.png").convert("RGB").crop(
        (c0, r0, c1, r1))
    inv_b, f_b = proj["back"]
    samp = pts[:, 1::4, :].reshape(-1, 3)
    owner2 = np.repeat(np.arange(n), samp.shape[0] // n)
    ccb, rrb, _ = project(samp, inv_b, f_b)
    ov = g3.copy().convert("RGBA")
    dot_layer = Image.new("RGBA", ov.size, (0, 0, 0, 0))
    dd = ImageDraw.Draw(dot_layer)
    m = (ccb >= c0) & (ccb < c1) & (rrb >= r0) & (rrb < r1)
    idx = np.nonzero(m)[0]
    if len(idx) > 20000:
        idx = idx[::len(idx) // 20000]
    for i in idx:
        dd.point((float(ccb[i]) - c0, float(rrb[i]) - r0),
                 fill=REG_COL.get(str(lab[owner2[i]]), (255, 255, 255)))
    ov = Image.alpha_composite(ov, dot_layer).convert("RGB")
    W, H = tgt.size
    sheet = Image.new("RGB", (2 * W, H + 30), (18, 18, 18))
    dr = ImageDraw.Draw(sheet)
    dr.text((8, 4), "target back crown | groom3 + region dots",
            fill=(240, 240, 240))
    sheet.paste(tgt, (0, 30))
    sheet.paste(ov, (W, 30))
    sheet.save(E4 / "diag4_part_back.png")
    print(json.dumps({k: out[k] for k in
                      ("partBand", "partExit", "partWidthTarget",
                       "partWidthGroom3", "frontGap")}, indent=1))
    print("earAttr3q", json.dumps(ear["three_quarter"]["attr"], indent=1))
    print("earAttrProf", json.dumps(ear["profile_90"]["attr"], indent=1))


if __name__ == "__main__":
    main()
