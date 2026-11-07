#!/usr/bin/env python3
"""hair-groom4 STEP 2: score density/clump configs A/B/C @512 vs groom3.

Shared-mask colour + bright-band coherence (groom3 sheen_score.py metric
verbatim) for three_quarter + back, groom3-512 reference (search/S3
beauties + v2b 512 IDs), render times, and a crop comparison sheet
(ear 3q, back crown, back mid; rows target | groom3 | A | B | C).
Writes E/search4.json + E/search4_crops.png.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

E4 = Path(__file__).resolve().parent
ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
E3 = ROOT / "tools/openclinxr/evidence/hair-groom3"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
BEAUTY = {"back": "target-back.png",
          "three_quarter": "target-three_quarter-a1.png"}
MASKF = {"back": "mask-back.png",
         "three_quarter": "mask-three_quarter.png"}
CFG = ("cfgA", "cfgB", "cfgC", "cfgF")
VIEWS = ("three_quarter", "back")
G3B = {"three_quarter": E3 / "search/S3/three_quarter.png",
       "back": E3 / "search/S3/back.png"}
G3I = {"three_quarter": E3 / "v2b/id512/three_quarter-id.png",
       "back": E3 / "v2b/id512/back-id.png"}


def rgb_to_hs(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-12), 0.0)
    h = np.zeros_like(mx)
    m = (d > 0)
    mr = m & (mx == r)
    mg = m & (mx == g)
    mb = m & (mx == b)
    h[mr] = ((g[mr] - b[mr]) / d[mr]) % 6.0
    h[mg] = (b[mg] - r[mg]) / d[mg] + 2.0
    h[mb] = (r[mb] - g[mb]) / d[mb] + 4.0
    return (h * 60.0) % 360.0, s


def stats(rgb, m):
    px = rgb[m]
    lum = (0.2126 * px[:, 0] + 0.7152 * px[:, 1]
           + 0.0722 * px[:, 2]) * 255.0
    h, s = rgb_to_hs(px)
    hc = float(np.degrees(np.angle(
        np.exp(1j * np.deg2rad(h)).mean()))) % 360.0
    return {"lumP50": round(float(np.percentile(lum, 50)), 1),
            "lumP90": round(float(np.percentile(lum, 90)), 1),
            "hue": round(hc, 1), "sat": round(float(s.mean()), 3),
            "n": int(px.shape[0]), "_lum": lum}


def bandfrac(lum, m):
    yy, xx = np.nonzero(m)
    sub = np.zeros_like(m, dtype=bool)
    vals = lum[yy, xx]
    thr = float(np.percentile(vals, 85))
    sub[yy[vals > thr], xx[vals > thr]] = True
    lab, _ = ndimage.label(sub)
    sizes = np.bincount(lab.ravel())[1:]
    big = sizes[sizes >= 150].sum()
    return (round(float(big) / max(sub.sum(), 1), 3), int(sub.sum()),
            int(big), round(thr, 1))


def score_one(beauty_p, id_p, view):
    H = 512
    tgt = np.asarray(Image.open(SCR / BEAUTY[view]).convert("RGB"),
                       dtype=np.float64) / 255.0
    tmask = np.array(Image.open(SCR / MASKF[view]).resize(
        (H, H), Image.NEAREST)) > 127
    ren = np.asarray(Image.open(beauty_p).convert("RGB"),
                     dtype=np.float64) / 255.0
    rid = np.array(Image.open(id_p).convert("RGBA"))[:, :, 3]
    both = (rid >= 230) & tmask
    ct = stats(tgt, np.array(Image.open(SCR / MASKF[view])) > 127)
    cr = stats(ren, both)
    lum2d = np.zeros((H, H))
    lum2d[both] = cr["_lum"]
    bf, nbright, nbig, thr = bandfrac(lum2d, both)
    return {"colTgt": [ct["lumP50"], ct["lumP90"], ct["hue"], ct["sat"]],
            "colRen": [cr["lumP50"], cr["lumP90"], cr["hue"], cr["sat"]],
            "bandFrac": bf, "nBright": nbright, "nBig": nbig,
            "thr": thr, "nInter": int(both.sum())}


out = {"groom3": {"views": {}}, "cfgs": {}}
for view in VIEWS:
    out["groom3"]["views"][view] = score_one(G3B[view], G3I[view], view)
for cfg in CFG:
    out["cfgs"][cfg] = {"views": {}}
    for view in VIEWS:
        # c08 beauties (r512c08) + pigment-independent IDs (r512).
        out["cfgs"][cfg]["views"][view] = score_one(
            E4 / cfg / "r512c08" / (view + ".png"),
            E4 / cfg / "r512" / (view + "-id.png"), view)
    rt = json.loads((E4 / cfg / "r512" / "render-times.json").read_text())
    out["cfgs"][cfg]["seconds512"] = rt["seconds"]
(E4 / "search4.json").write_text(json.dumps(out, indent=1) + "\n")
for cfg in CFG:
    for view in VIEWS:
        r = out["cfgs"][cfg]["views"][view]
        g = out["groom3"]["views"][view]
        print("%s %s band %.3f (g3 %.3f) col %s (g3 %s) tgt %s" % (
            cfg, view, r["bandFrac"], g["bandFrac"], r["colRen"],
            g["colRen"], r["colTgt"]))

# crop sheet: cols ear-3q | back crown | back mid; rows target|g3|A|B|C.
CROPS = {"ear3q": ("three_quarter", 380, 660, 330, 610),
         "crown": ("back", 412, 636, 140, 364),
         "mid": ("back", 362, 686, 364, 688)}
T = 300
rows = [("target", None), ("groom3", None), ("A", "cfgA"), ("B", "cfgB"),
        ("C", "cfgC"), ("F", "cfgF")]
sheet = Image.new("RGB", (140 + 3 * T, 6 * (T + 24)), (18, 18, 18))
dr = ImageDraw.Draw(sheet)
for i, (label, cfg) in enumerate(rows):
    for j, (cn, (v, c0, c1, r0, r1)) in enumerate(CROPS.items()):
        if cfg is None:
            if label == "target":
                src = SCR / (BEAUTY[v])
            else:
                src = G3B[v] if v in G3B else None
            im = Image.open(src).convert("RGB")
            if im.size != (512, 512):
                # groom3-512 search beauties are 512; scale crop box
                s = im.size[0] / 1024.0
                box = (int(c0 * s), int(r0 * s), int(c1 * s),
                       int(r1 * s))
            else:
                box = (c0 // 2, r0 // 2, c1 // 2, r1 // 2)
            cell = im.crop(box).resize((T, T))
        else:
            im = Image.open(E4 / cfg / "r512c08" / (v + ".png")).convert(
                "RGB")
            s = im.size[0] / 1024.0
            box = (int(c0 * s), int(r0 * s), int(c1 * s), int(r1 * s))
            cell = im.crop(box).resize((T, T))
        sheet.paste(cell, (140 + j * T, i * (T + 24) + 24))
        if i == 0:
            dr.text((140 + j * T + 8, 4), cn, fill=(240, 240, 240))
    dr.text((12, i * (T + 24) + (T + 24) // 2), label,
            fill=(240, 240, 240))
sheet.save(E4 / "search4_crops.png")
print("wrote search4.json + search4_crops.png")
