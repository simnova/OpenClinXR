#!/usr/bin/env python3
"""hair-groom3 STEP 2: sheen search scorer (512px, front+3q+back).

Per config x view: shared-mask (target mask & own 512 ID) colour stats
(lum p50/p90, hue, sat) vs target + bright-band coherence: fraction of
above-p85-lum shared-mask pixels in connected components >= 150 px
(bands read coherent; fibrous reads scattered). Prints one line per
config+view and band rank. Also scores groom2 identically (reference).
"""
from __future__ import annotations
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

E3 = Path(__file__).resolve().parent
E2 = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2/tools/openclinxr/evidence/hair-groom2")
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
BEAUTY = {"back": "target-back.png", "front": "target-front-a1.png", "three_quarter": "target-three_quarter-a1.png"}
MASKF = {"back": "mask-back.png", "front": "mask-front.png", "three_quarter": "mask-three_quarter.png"}
IDS = {"v2a": E3/"v2a"/"id512", "v2b": E3/"v2b"/"id512", "groom2": E2/"renders-studio"}
CFG = {"S1": ("v2b", 0.30), "S2": ("v2b", 0.22), "S3": ("v2b", 0.15), "S4": ("v2a", 0.22), "S5": ("v2a", 0.30)}

def rgb_to_hs(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-12), 0.0)
    h = np.zeros_like(mx); m = (d > 0)
    mr = m & (mx == r); mg = m & (mx == g); mb = m & (mx == b)
    h[mr] = ((g[mr] - b[mr]) / d[mr]) % 6.0
    h[mg] = (b[mg] - r[mg]) / d[mg] + 2.0
    h[mb] = (r[mb] - g[mb]) / d[mb] + 4.0
    return (h * 60.0) % 360.0, s

def stats(rgb, m):
    px = rgb[m]
    lum = (0.2126*px[:,0]+0.7152*px[:,1]+0.0722*px[:,2])*255.0
    h, s = rgb_to_hs(px)
    hc = float(np.degrees(np.angle(np.exp(1j*np.deg2rad(h)).mean()))) % 360.0
    return {"lumP50": round(float(np.percentile(lum,50)),1), "lumP90": round(float(np.percentile(lum,90)),1),
            "hue": round(hc,1), "sat": round(float(s.mean()),3), "n": int(px.shape[0]), "_lum": lum}

def bandfrac(lum, m):
    yy, xx = np.nonzero(m)
    H, W = m.shape
    sub = np.zeros_like(m, dtype=bool)
    vals = lum[yy, xx]
    thr = float(np.percentile(vals, 85))
    sub[yy[vals > thr], xx[vals > thr]] = True
    lab, nc = ndimage.label(sub)
    sizes = np.bincount(lab.ravel())[1:]
    big = sizes[sizes >= 150].sum()
    return round(float(big)/max(sub.sum(),1), 3), int(sub.sum()), int(big), round(thr,1)

def score_one(beauty_p, id_p, view):
    tgt = np.asarray(Image.open(SCR/BEAUTY[view]).convert("RGB"),dtype=np.float64)/255.0
    tmask = np.array(Image.open(SCR/MASKF[view])) > 127
    ren = np.asarray(Image.open(beauty_p).convert("RGB"),dtype=np.float64)/255.0
    H = ren.shape[0]
    if H != 1024:
        tmask = np.asarray(Image.fromarray(tmask).resize((H,H),Image.NEAREST))>0
    rid = np.array(Image.open(id_p).convert("RGBA"))[:,:,3]
    if rid.shape[0] != H:
        rid = np.asarray(Image.fromarray(rid).resize((H,H),Image.NEAREST))
    both = (rid >= 230) & tmask
    ct = stats(tgt, np.array(Image.open(SCR/MASKF[view]))>127)
    cr = stats(ren, both)
    lum2d = np.zeros((H,H)); lum2d[both] = cr["_lum"]
    bf, nbright, nbig, thr = bandfrac(lum2d, both)
    return {"colTgt": [ct["lumP50"],ct["lumP90"],ct["hue"],ct["sat"]],
            "colRen": [cr["lumP50"],cr["lumP90"],cr["hue"],cr["sat"]],
            "bandFrac": bf, "nBright": nbright, "nBig": nbig, "thr": thr, "nInter": int(both.sum())}

out = {}
for cfg,(v,rough) in CFG.items():
    out[cfg] = {"strands": v, "rough": rough, "views": {}}
    for view in ("front","three_quarter","back"):
        r = score_one(E3/"search"/cfg/(view+".png"), IDS[v]/(view+"-id.png"), view)
        out[cfg]["views"][view] = r
        print(json.dumps({"cfg":cfg,"view":view,"bandFrac":r["bandFrac"],"colRen":r["colRen"],"colTgt":r["colTgt"],"nInter":r["nInter"]}))
g2 = {"views": {}}
for view in ("front","three_quarter","back"):
    g2["views"][view] = score_one(E2/"renders-studio"/(view+".png"), E2/"renders-studio"/(view+"-id.png"), view)
out["groom2ref"] = g2
for view in ("front","three_quarter","back"):
    r = g2["views"][view]
    print(json.dumps({"cfg":"groom2ref","view":view,"bandFrac":r["bandFrac"],"colRen":r["colRen"],"colTgt":r["colTgt"],"nInter":r["nInter"]}))
(E3/"sheen_score.json").write_text(json.dumps(out,indent=1)+"\n")
