#!/usr/bin/env python3
"""hair-ends1 STEP 1: comb ruler (system python, numpy+PIL).

Bands (TARGET frame 1024, from shape_ruler triples):
  back hem band      = target lower-40% rows [LO,YB] (back LO=547 YB=823)
  profile lower-sheet= target lower-40% rows [572,870]
Both are the full lower sheet; overlay draws them as rectangles.

Registration: ours -> target via shape_ruler.register_mask similarity
(scale+translation from projected-landmark triples, NEAREST for masks,
BILINEAR for beauty). Column signals computed in TARGET frame so ours
and TS share columns.

(a) column-luminance periodicity: L(x) = mean beauty luminance over band
rows per column, over interior columns (target fill>=50% AND ours
fill>=50% in band). Detrend by subtracting 31-wide median. FFT rfft;
combPower = sum |F|^2 for periods 3..15px / sum |F|^2 all k>0.
Also reports peak period.

(b) hem edge softness: per interior hem column, y_bottom from mask;
hair level = median luminance yb-15..yb-6, bg = median yb+6..yb+15
(beauty luminance). 10/90% crossing rows between yb-15..yb+15;
transition = |y90-y10| px. Mean over columns. Uses beauty (photo vs
render), so TS soft ends and our blunt ends compare directly.

(c) fibre facts: from strands.npz radii idx0/16/31 (mm) + lower-25%
arc (idx24..31) lateral-from-vertical angle std/p50/p90. Lower fibres
= tip_z<1.42 (hem1 convention).

Usage: python3 comb_ruler.py <tag> [<tag> ...]
  tag = subdir of E holding <view>.png + <view>-id.png (back, profile_90).
  Writes E/comb_<tag>.json; overlay E/comb-ruler.png for first tag.
"""
from __future__ import annotations
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

E = Path("tools/openclinxr/evidence/hair-ends1")
HEM2 = Path("tools/openclinxr/evidence/hair-hem2")
import sys as _sys
_sys.path.insert(0, str(HEM2))
from shape_ruler import register_mask, register_beauty, RENDER_TRIPLE, TARGET_TRIPLE  # noqa
J = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back")
T = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
S = 1024
TMASK = {"back": "mask-back-v3.png", "profile_90": "mask-profile-v2.png"}
TPHOTO = {"back": "target-back.png", "profile_90": "target-profile.png"}
SHEET_Z = 1.42

def lum(rgb):
    rgb = np.asarray(rgb, float) / 255.0
    return 0.2126*rgb[...,0]+0.7152*rgb[...,1]+0.0722*rgb[...,2]

def band_rows(view):
    # target lower-40% rows (from hem2 shape_base)
    if view=="back": return 547, 823
    return 572, 870

def interior_cols(tmask_band, omask_band):
    # fill>=50% of band rows
    tf = tmask_band.sum(axis=0) >= 0.5*tmask_band.shape[0]
    of = omask_band.sum(axis=0) >= 0.5*omask_band.shape[0]
    return tf & of

def medfilt1(x, w=31):
    p = w//2
    pad = np.pad(x,(p,p),mode="edge")
    win = np.lib.stride_tricks.sliding_window_view(pad, w)
    return np.median(win, axis=1)

def periodicity(L):
    n = len(L)
    d = L - medfilt1(L, 31)
    d = d - d.mean()
    F = np.fft.rfft(d)
    P = np.abs(F)**2
    freqs = np.arange(len(P))
    with np.errstate(divide="ignore"):
        periods = np.where(freqs>0, n/np.maximum(freqs,1), np.inf)
    sel = (periods>=3)&(periods<=15)&(freqs>0)
    tot = P[1:].sum()
    comb = P[sel].sum()
    frac = float(comb/max(tot,1e-12))
    peak = None
    if sel.sum():
        k = int(np.argmax(P*sel))
        peak = float(n/max(k,1))
    return frac, float(comb), float(tot), peak, d

def softness(beau_lum, mask):
    # per-column 10-90% luminance transition around y_bottom
    H, W = mask.shape
    vals = []
    cols = np.where(mask.any(axis=0))[0]
    for x in cols:
        rows = np.where(mask[:,x])[0]
        if len(rows)==0: continue
        yb = int(rows.max())
        if yb-16<0 or yb+16>=H: continue
        prof = beau_lum[yb-15:yb+16, x]  # 31 rows
        hair = float(np.median(prof[0:10]))   # yb-15..yb-6
        bg = float(np.median(prof[21:31]))    # yb+6..yb+15
        if abs(bg-hair)<1e-6: continue
        lo, hi = min(hair,bg), max(hair,bg)
        t10, t90 = lo+0.1*(hi-lo), lo+0.9*(hi-lo)
        # crossing rows (first from hair side)
        idx = np.arange(len(prof))
        if bg>hair:
            i10 = np.where(prof>=t10)[0]
            i90 = np.where(prof>=t90)[0]
        else:
            i10 = np.where(prof<=t10)[0]
            i90 = np.where(prof<=t90)[0]
        if len(i10)==0 or len(i90)==0: continue
        vals.append(abs(float(i90[0])-float(i10[0])))
    if not vals: return float("nan"), 0
    return float(np.mean(vals)), int(len(vals))

def fibre_facts(strands_path):
    d = np.load(strands_path)
    P = np.asarray(d["points"], float); R = np.asarray(d["radii"], float)*1000.0
    out = {"n": int(len(P))}
    for idx,label in [(0,"root"),(16,"mid"),(31,"tip")]:
        v = R[:,idx]
        out[label] = {"p50": round(float(np.median(v)),4), "mean": round(float(np.mean(v)),4), "p90": round(float(np.percentile(v,90)),4)}
    tips = P[:,-1]
    low = tips[:,2] < SHEET_Z
    out["lowerN"] = int(low.sum())
    for m,label in [(np.ones(len(P),bool),"all"),(low,"lower")]:
        v = R[m][:,16] if m.sum() else np.array([0])
        out[f"mid_{label}"] = {"p50": round(float(np.median(v)),4)}
    # lower-25% arc angles from vertical (z)
    seg = P[low][:,24:31,:]  # 7 segs per fibre
    v = np.diff(P[low][:,24:32,:], axis=1)
    horiz = np.linalg.norm(v[...,:2], axis=-1)
    vert = np.abs(v[...,2])+1e-12
    ang = np.degrees(np.arctan2(horiz, vert)).ravel()
    out["lowerArcAngle"] = {"p50": round(float(np.median(ang)),3), "p90": round(float(np.percentile(ang,90)),3), "std": round(float(ang.std()),3), "nSeg": int(ang.size)}
    return out

def ruler_for(view, ours_beau_reg_lum, ours_reg, tgt_mask, tgt_lum):
    lo, yb = band_rows(view)
    tb = tgt_mask[lo:yb+1,:]; ob = ours_reg[lo:yb+1,:]
    cols = interior_cols(tb, ob)
    # column signals over band
    Lt = tgt_lum[lo:yb+1,:][:,cols].mean(axis=0) if cols.sum()>10 else np.array([])
    Lo = ours_beau_reg_lum[lo:yb+1,:][:,cols].mean(axis=0) if cols.sum()>10 else np.array([])
    ft, ct, tt, peakt, dt = periodicity(Lt) if len(Lt)>10 else (float("nan"),0,0,None,None)
    fo, co, to, peako, do = periodicity(Lo) if len(Lo)>10 else (float("nan"),0,0,None,None)
    st, nt = softness(tgt_lum, tgt_mask)
    so, no = softness(ours_beau_reg_lum, ours_reg)
    return {"band":[lo,yb], "nIntCols": int(cols.sum()),
        "tgtCombFrac": round(ft,4), "tgtPeakPeriodPx": peakt,
        "oursCombFrac": round(fo,4), "oursPeakPeriodPx": peako,
        "tgtSoftPx": round(st,3), "tgtSoftN": nt,
        "oursSoftPx": round(so,3), "oursSoftN": no}

def main():
    tags = sys.argv[1:] or ["base"]
    tmasks = {v: np.asarray(Image.open(J/TMASK[v]).convert("L"))>127 for v in ["back","profile_90"]}
    tphotos = {v: lum(Image.open(T/TPHOTO[v]).convert("RGB")) for v in ["back","profile_90"]}
    first_panels = []
    for tag in tags:
        d = E/tag if (E/tag/"back-id.png").exists() else E/"scores"/tag
        res = {"method": "ours->target judge similarity; band=target lower40 rows; comb=3-15px FFT power frac of detrended band column-mean luminance; soft=10-90% luminance transition at y_bottom"}
        for v in ["back","profile_90"]:
            ours_m = np.asarray(Image.open(d/f"{v}-id.png").convert("RGBA"))[...,3]>=230
            ours_b = np.asarray(Image.open(d/f"{v}.png").convert("RGB"))
            a_r,b_r,c_r = RENDER_TRIPLE[v if v in RENDER_TRIPLE else v]
            # shape_ruler keys: profile_90
            a_r,b_r,c_r = RENDER_TRIPLE[v]
            a_t,b_t,c_t = TARGET_TRIPLE[v]
            oreg, tr = register_mask(ours_m, a_r,b_r,c_r, a_t,b_t,c_t)
            beau_reg = register_beauty(ours_b, tr)
            beau_lum = lum(beau_reg)
            r = ruler_for(v, beau_lum, oreg, tmasks[v], tphotos[v])
            r["transform"] = {k: round(float(x),4) for k,x in tr.items()}
            res[v] = r
            print(f"{tag} {v}: comb ours={r['oursCombFrac']} tgt={r['tgtCombFrac']} soft ours={r['oursSoftPx']} tgt={r['tgtSoftPx']} cols={r['nIntCols']}", flush=True)
            if tag==tags[0]:
                # overlay: target photo + band rect + ours outline? simple side-by-side with band
                import numpy as _np
                photo = _np.asarray(Image.open(T/TPHOTO[v]).convert("RGB"))
                lo,yb = band_rows(v)
                ov = photo.copy()
                ov[lo:lo+3,:,0]=255; ov[yb-2:yb+1,:,0]=255
                beau = _np.asarray(Image.fromarray(ours_b).transform((S,S), Image.AFFINE, (1/tr["scale"],0,-tr["tx"]/tr["scale"],0,1/tr["scale"],-tr["ty"]/tr["scale"]), Image.BILINEAR))
                ov2 = beau.copy()
                ov2[lo:lo+3,:,2]=255; ov2[yb-2:yb+1,:,2]=255
                first_panels.append((_np.hstack([ov, ov2]))[::2,::2])
        sp = E/"base"/"strands.npz" if (E/"base"/"strands.npz").exists() else None
        sdir = (E/tag/"strands.npz") if (E/tag/"strands.npz").exists() else (E/"scores"/tag/"strands_src.npz" if False else None)
        # fibre facts from rendered strands: base dir or cells dir
        cand = [E/tag/"strands.npz", E/"cells"/tag/"strands.npz", E/"base"/"strands.npz"]
        fjs = None
        for c in cand:
            if c.exists(): fjs = fibre_facts(str(c)); fjs["src"]=str(c); break
        if fjs: res["fibres"]=fjs
        (E/f"comb_{tag.replace('/','_')}.json").write_text(json.dumps(res,indent=2)+"\n")
        print("WROTE", E/f"comb_{tag.replace('/','_')}.json", flush=True)
    if first_panels:
        sheet = _np.vstack(first_panels)
        Image.fromarray(sheet).save(E/"comb-ruler.png")
        print("WROTE", E/"comb-ruler.png", sheet.shape, flush=True)

if __name__=="__main__":
    main()
