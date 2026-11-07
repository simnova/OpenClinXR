#!/usr/bin/env python3
"""Geometry and image diagnosis for b6; writes diagnosis.json atomically."""
from __future__ import annotations
import json, math
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, label
from scipy.spatial import cKDTree

HERE=Path(__file__).resolve().parent
TARGET=Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
JUDGE=Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back")
VIEWS=("front","three_quarter","back")
TARGET_IMAGE={"front":"target-front.png","three_quarter":"target-three_quarter.png","back":"target-back.png"}
TARGET_MASK={"front":"mask-front-v2.png","three_quarter":"mask-three_quarter.png","back":"mask-back-v3.png"}

def rgb(p):return np.asarray(Image.open(p).convert("RGB"),dtype=float)/255.
def lum(a):return .2126*a[...,0]+.7152*a[...,1]+.0722*a[...,2]
def ours_mask(p):return np.asarray(Image.open(p).convert("RGBA"))[...,3]>=230
def target_mask(p):return np.asarray(Image.open(p).convert("L"))>=128

def image_metrics(image,mask):
    y=lum(image);local=gaussian_filter(y,8.);band=np.abs(gaussian_filter(y,1.)-gaussian_filter(y,4.))/np.maximum(local,.02)
    tile=[]
    for yy in range(0,y.shape[0],32):
        for xx in range(0,y.shape[1],32):
            m=mask[yy:yy+32,xx:xx+32]
            if m.sum()>=128:tile.append(float(np.mean(band[yy:yy+32,xx:xx+32][m])))
    vals=y[mask];threshold=float(np.percentile(vals,90));hot=(y>threshold)&mask;lab,n=label(hot)
    areas=np.bincount(lab.ravel())[1:];areas=areas[areas>0]
    return {"highpass":{"tileCount":len(tile),"median":float(np.median(tile)),"p90":float(np.percentile(tile,90))},
            "sheen":{"thresholdP90":threshold,"components":int(len(areas)),"medianAreaPx":float(np.median(areas)) if len(areas) else 0.,"maxAreaPx":int(areas.max()) if len(areas) else 0}}

def geometry(points,roots):
    rng=np.random.default_rng(20261014);ids=rng.choice(len(points),min(2000,len(points)),replace=False);fractions=(.2,.4,.6,.8);rows=[]
    tang=np.gradient(points,axis=1);tang/=np.maximum(np.linalg.norm(tang,axis=2,keepdims=True),1e-12)
    for f in fractions:
        j=int(round(f*(points.shape[1]-1)));tree=cKDTree(points[:,j]);angles=[];spacings=[]
        for i in ids:
            near=tree.query_ball_point(points[i,j],.005);near=[n for n in near if n!=i]
            if not near:continue
            dots=np.clip(tang[near,j]@tang[i,j],-1,1);angles.extend(np.degrees(np.arccos(np.abs(dots))).tolist());spacings.extend(np.linalg.norm(points[near,j]-points[i,j],axis=1).tolist())
        rows.append({"arcFraction":f,"directionAngleStdDeg":float(np.std(angles)),"directionAngleMedianDeg":float(np.median(angles)),"neighbourSpacingStdMm":float(np.std(spacings)*1000),"neighbourSpacingMedianMm":float(np.median(spacings)*1000),"pairs":len(angles)})
    return {"sampledChildren":len(ids),"radiusMm":5.,"fractions":rows,
            "directionAngleStdDeg":float(np.mean([r["directionAngleStdDeg"] for r in rows])),
            "neighbourSpacingStdMm":float(np.mean([r["neighbourSpacingStdMm"] for r in rows]))}

def end_angles(points,roots,apex):
    out={}
    for name,sel in (("frontCurtain",roots[:,1]<apex),("backHem",roots[:,1]>=apex)):
        vals=[]
        for p in points[sel]:
            s=np.r_[0.,np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1))];q=max(0.,s[-1]-.040);j=min(max(np.searchsorted(s,q)-1,0),len(p)-2);t=(q-s[j])/max(s[j+1]-s[j],1e-12);a=p[j]*(1-t)+p[j+1]*t;v=p[-1]-a;v/=max(np.linalg.norm(v),1e-12);vals.append(math.degrees(math.acos(np.clip(-v[2],-1,1))))
        out[name]={"count":int(sel.sum()),"p50Deg":float(np.percentile(vals,50)),"p95Deg":float(np.percentile(vals,95))}
    return out

def main():
    d=np.load(HERE/"cells/b6/strands.npz");points=np.asarray(d["points"],float);roots=np.asarray(d["roots"],float)
    pix={"ours":{},"target":{}}
    for v in VIEWS:
        pix["ours"][v]=image_metrics(rgb(HERE/"cells/b6"/(v+".png")),ours_mask(HERE/"cells/b6"/(v+"-id.png")))
        pix["target"][v]=image_metrics(rgb(TARGET/TARGET_IMAGE[v]),target_mask(JUDGE/TARGET_MASK[v]))
    pix["ratios"]={v:{"targetOverOursHighpassMedian":pix["target"][v]["highpass"]["median"]/max(pix["ours"][v]["highpass"]["median"],1e-12),"targetOverOursHighpassP90":pix["target"][v]["highpass"]["p90"]/max(pix["ours"][v]["highpass"]["p90"],1e-12)} for v in VIEWS}
    settings={}
    base=pix["ours"]["front"]
    for tag in ("settings-2x","settings-filter10"):
        m=image_metrics(rgb(HERE/"cells"/tag/"front.png"),ours_mask(HERE/"cells"/tag/"front-id.png"));settings[tag]={"metrics":m,"highpassMedianChangePct":100*(m["highpass"]["median"]/base["highpass"]["median"]-1),"highpassP90ChangePct":100*(m["highpass"]["p90"]/base["highpass"]["p90"]-1),"sheenMedianChangePct":100*(m["sheen"]["medianAreaPx"]/max(base["sheen"]["medianAreaPx"],1)-1)}
    geom=geometry(points,roots);ends=end_angles(points,roots,float(d["apex_y"]));ratio=float(np.median([pix["ratios"][v]["targetOverOursHighpassMedian"] for v in VIEWS]));supported=geom["directionAngleStdDeg"]<1 and ratio>2
    station=json.load(open(HERE/"baseline-station.json"));doc={"schemaVersion":1,"baseline":"hair-curtain5/e4 == b6","geometry":geom,"pixels":pix,"renderSettings":settings,"settingsMatter":bool(any(abs(r[k])>20 for r in settings.values() for k in ("highpassMedianChangePct","highpassP90ChangePct"))),"endTangents":ends,"interpolants":station["interpolants"],"causeD1":{"status":"SUPPORTED" if supported else "REFUTED","rule":"b6 direction std <1 deg AND median TS/ours highpass ratio >2","directionStdDeg":geom["directionAngleStdDeg"],"targetOverOursHighpassMedian":ratio},"causeD2":{"status":"SUPPORTED" if max(ends[x]["p95Deg"] for x in ends)>20 else "REFUTED","rule":"either end p95 >20 deg","maxP95Deg":max(ends[x]["p95Deg"] for x in ends)}}
    tmp=HERE/"diagnosis.json.tmp";tmp.write_text(json.dumps(doc,indent=2)+"\n");tmp.replace(HERE/"diagnosis.json");print(json.dumps({"causeD1":doc["causeD1"],"causeD2":doc["causeD2"],"settingsMatter":doc["settingsMatter"]},indent=2))
if __name__=="__main__":main()
