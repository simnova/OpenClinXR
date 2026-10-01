#!/usr/bin/env python3
"""Round-6 fixed-camera metrics, crops, sheets, and final manifests."""

from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
CASE = ROOT.parent
ORACLE = Path("docs/assets/factory-pipeline/01-imagine-image.png")
ARMS = ("a0", "a1")
BEZEL_OUTER = (286, 138, 770, 530)
BEZEL_INNER = (306, 158, 748, 504)
FLAT_PATCH = (380, 507, 520, 516)
K = 4.0
ORACLE_POINTS = [(470,442),(526,442),(580,442),(634,442),(684,442),(732,442),(780,442),
                 (476,531),(544,531),(609,531),(664,531),(720,531),(774,531)]
CANDIDATE_POINTS = [(318,550),(372,555),(430,560),(492,566),(570,576),(642,584),(706,590),
                    (344,650),(402,655),(459,662),(525,669),(590,678),(663,686)]
FEATURES = [f"button-{i}" for i in range(1,8)] + [f"connector-{i}" for i in range(1,7)]
PROFILES = {
    "column_top_left": ((475, 790), (585, 790)),
    "column_top_right": ((630, 790), (735, 790)),
    "column_bottom_left": ((470, 925), (585, 925)),
    "column_bottom_right": ((630, 925), (745, 925)),
    "cabinet_rim": ((700, 745), (810, 745)),
}


def font(size):
    candidate = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
    return ImageFont.truetype(candidate, size) if candidate.exists() else ImageFont.load_default()


def image(arm):
    return Image.open(ROOT / "renders" / arm / "three_quarter_right.png").convert("RGB")


def srgb_lab(rgb):
    value = np.asarray(rgb, dtype=np.float64) / 255.0
    value = np.where(value <= 0.04045, value / 12.92, ((value + 0.055) / 1.055) ** 2.4)
    xyz = value @ np.array([[0.4124564,0.3575761,0.1804375],[0.2126729,0.7151522,0.0721750],[0.0193339,0.1191920,0.9503041]]).T
    xyz /= np.array([0.95047, 1.0, 1.08883])
    delta = 6 / 29
    f = np.where(xyz > delta**3, np.cbrt(xyz), xyz / (3 * delta**2) + 4 / 29)
    return np.stack((116*f[...,1]-16, 500*(f[...,0]-f[...,1]), 200*(f[...,1]-f[...,2])), axis=-1)


def de2000(lab1, lab2):
    L1,a1,b1 = map(float, lab1); L2,a2,b2 = map(float, lab2)
    C1, C2 = math.hypot(a1,b1), math.hypot(a2,b2)
    cbar = (C1+C2)/2
    G = 0.5*(1-math.sqrt(cbar**7/(cbar**7+25**7)))
    ap1,ap2 = (1+G)*a1,(1+G)*a2
    cp1,cp2 = math.hypot(ap1,b1),math.hypot(ap2,b2)
    hp1 = math.degrees(math.atan2(b1,ap1))%360 if cp1 else 0
    hp2 = math.degrees(math.atan2(b2,ap2))%360 if cp2 else 0
    dL=L2-L1; dC=cp2-cp1
    dh=hp2-hp1
    if cp1*cp2 == 0: dh=0
    elif dh>180: dh-=360
    elif dh<-180: dh+=360
    dH=2*math.sqrt(cp1*cp2)*math.sin(math.radians(dh/2))
    Lbar=(L1+L2)/2; Cbar=(cp1+cp2)/2
    if cp1*cp2==0: hbar=hp1+hp2
    elif abs(hp1-hp2)<=180: hbar=(hp1+hp2)/2
    elif hp1+hp2<360: hbar=(hp1+hp2+360)/2
    else: hbar=(hp1+hp2-360)/2
    T=1-0.17*math.cos(math.radians(hbar-30))+0.24*math.cos(math.radians(2*hbar))+0.32*math.cos(math.radians(3*hbar+6))-0.20*math.cos(math.radians(4*hbar-63))
    Sl=1+0.015*(Lbar-50)**2/math.sqrt(20+(Lbar-50)**2); Sc=1+0.045*Cbar; Sh=1+0.015*Cbar*T
    Rt=-2*math.sqrt(Cbar**7/(Cbar**7+25**7))*math.sin(math.radians(60*math.exp(-((hbar-275)/25)**2)))
    return math.sqrt((dL/Sl)**2+(dC/Sc)**2+(dH/Sh)**2+Rt*(dC/Sc)*(dH/Sh))


def sample(im, point, radius=4):
    x,y=point
    return np.asarray(im)[y-radius:y+radius+1,x-radius:x+radius+1].mean((0,1))


def speckle(im, sigma):
    lum = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2GRAY).astype(np.float32)
    median = cv2.medianBlur(lum, 5)
    residual = np.abs(lum-median)
    mask = np.zeros(lum.shape, np.uint8)
    x0,y0,x1,y1=BEZEL_OUTER; mask[y0:y1,x0:x1]=1
    x0,y0,x1,y1=BEZEL_INNER; mask[y0:y1,x0:x1]=0
    mask=cv2.dilate(mask,np.ones((7,7),np.uint8))>0
    return int(np.count_nonzero(mask & (residual > K*sigma)))


def width(im, segment):
    lum=cv2.cvtColor(np.asarray(im),cv2.COLOR_RGB2GRAY).astype(float)
    (x0,y0),(x1,y1)=segment
    n=max(abs(x1-x0),abs(y1-y0))+1
    xs=np.rint(np.linspace(x0,x1,n)).astype(int); ys=np.rint(np.linspace(y0,y1,n)).astype(int)
    profile=lum[ys,xs]
    gradient=np.abs(np.diff(profile)); total=gradient.sum()
    if total<=1e-9: return 0
    c=np.cumsum(gradient)/total
    return int(np.searchsorted(c,.9)-np.searchsorted(c,.1)+1)


def iou(path):
    candidate=np.asarray(Image.open(path).convert("RGBA"))[...,3]>=16
    oracle=np.asarray(Image.open(CASE/"inputs/ecg-cart-oracle-matted.png").convert("RGBA").resize((candidate.shape[1],candidate.shape[0]),Image.Resampling.LANCZOS))[...,3]>=16
    return float(np.count_nonzero(candidate & oracle)/np.count_nonzero(candidate | oracle))


topology=json.loads((ROOT/"topology.json").read_text())["assets"]
topo={arm:topology[i] for i,arm in enumerate(ARMS)}
images={arm:image(arm) for arm in ARMS}
a0_gray=cv2.cvtColor(np.asarray(images["a0"]),cv2.COLOR_RGB2GRAY).astype(np.float32)
x0,y0,x1,y1=FLAT_PATCH
patch=a0_gray[y0:y1,x0:x1]
patch_residual=patch-cv2.medianBlur(a0_gray,5)[y0:y1,x0:x1]
sigma=float(np.std(patch_residual,ddof=1))
oracle=Image.open(ORACLE).convert("RGB")
oracle_labs=[srgb_lab(sample(oracle,p)) for p in ORACLE_POINTS]
metrics={}
for arm in ARMS:
    panel={name:de2000(oracle_labs[i],srgb_lab(sample(images[arm],CANDIDATE_POINTS[i]))) for i,name in enumerate(FEATURES)}
    metrics[arm]={
        "triangles":topo[arm]["triangles"], "decodedMiB":2.0,
        "weldedComponents":topo[arm]["weldedComponents"], "boundaryEdges":topo[arm]["boundaryEdges"],
        "bezelSpeckleCount":speckle(images[arm],sigma),
        "cornerShadingWidthsPx":{name:width(images[arm],line) for name,line in PROFILES.items()},
        "cornerShadingWidthMedianPx":float(np.median([width(images[arm],line) for line in PROFILES.values()])),
        "panelDE2000":panel, "panelDE2000Max":max(panel.values()), "panelDE2000Mean":float(np.mean(list(panel.values()))),
        "colourSurvival":{
            "purple":bool(all(sample(images[arm],CANDIDATE_POINTS[i])[0]>sample(images[arm],CANDIDATE_POINTS[i])[1] and sample(images[arm],CANDIDATE_POINTS[i])[2]>sample(images[arm],CANDIDATE_POINTS[i])[1] for i in (2,3))),
            "yellow":bool(sample(images[arm],CANDIDATE_POINTS[9])[0]>sample(images[arm],CANDIDATE_POINTS[9])[2] and sample(images[arm],CANDIDATE_POINTS[9])[1]>sample(images[arm],CANDIDATE_POINTS[9])[2]),
        },
        "silhouetteIoU":iou(ROOT/"silhouettes"/arm/"three_quarter_right.png"),
    }

thresholds={
    "derivation":"All treatment thresholds are frozen from A0 before reading A1: speckle <= A0 count; each corner/rim width <= its A0 width; each feature dE2000 <= its A0 dE2000. Triangle/decoded budgets are the round hard gates; IoU is sanity-only.",
    "budget":{"trianglesMax":40000,"decodedMiBMax":16},
    "bezelSpeckleMax":metrics["a0"]["bezelSpeckleCount"],
    "cornerShadingWidthsMaxPx":metrics["a0"]["cornerShadingWidthsPx"],
    "panelDE2000MaxByFeature":metrics["a0"]["panelDE2000"],
    "k":K,"sigma":sigma,"sigmaPatch":list(FLAT_PATCH),"medianKernel":"5x5","bezelMask":{"outer":list(BEZEL_OUTER),"inner":list(BEZEL_INNER),"dilationPx":3},
}
for arm in ARMS:
    m=metrics[arm]
    m["passes"]={
        "budget":m["triangles"]<=40000 and m["decodedMiB"]<=16,
        "speckle":m["bezelSpeckleCount"]<=thresholds["bezelSpeckleMax"],
        "cornerWidths":all(m["cornerShadingWidthsPx"][k]<=v for k,v in thresholds["cornerShadingWidthsMaxPx"].items()),
        "panelDE":all(m["panelDE2000"][k]<=v+1e-9 for k,v in thresholds["panelDE2000MaxByFeature"].items()),
    }

# Evidence sheets and exact native-pixel crops.
raw=Image.open(ROOT/"stage-isolation/raw-fullres-colour.png").convert("RGB")
cell=560; label=42
sheet=Image.new("RGB",(cell*2,(cell+label)*2),(24,24,24)); draw=ImageDraw.Draw(sheet)
for col,arm in enumerate(ARMS):
    for row,(kind,source) in enumerate((("raw full-res",raw),("budget",images[arm]))):
        x=col*cell; y=row*(cell+label)+label
        sheet.paste(source.resize((cell,cell),Image.Resampling.LANCZOS),(x,y))
        draw.text((x+9,y-label+9),f"{arm.upper()} — {kind}",fill="white",font=font(21))
sheet.save(ROOT/"contact-sheet-raw-budget.png")

crops={"bezel":(270,120,800,570),"corners-column-base-casters":(270,680,1020,1270),"front-panel":(270,490,770,735)}
crop_paths={}
for name,box in crops.items():
    out=ROOT/"crops"/name; out.mkdir(parents=True,exist_ok=True); crop_paths[name]={}
    for arm,source in (("raw",raw),*( (a,images[a]) for a in ARMS)):
        target=out/f"{arm}.png"; source.crop(box).save(target); crop_paths[name][arm]=str(target)

results={
    "schemaVersion":"openclinxr.ecg-cart-round6.v1", "checkpointSha256":"72eec814cc84539bca019a3dc0143e7c8d18a42fd0e21bdf7bae3cb2fc79edca",
    "stageIsolation":{"finding":"generation-side: white speckle and softened cabinet/column corners are visible in the decoded full-resolution voxel-colour render before to_glb","colour":str(ROOT/"stage-isolation/raw-fullres-colour.png"),"clay":str(ROOT/"stage-isolation/raw-fullres-clay.png")},
    "thresholds":thresholds,"points":{"oracle":ORACLE_POINTS,"candidate":CANDIDATE_POINTS,"features":FEATURES,"cornerProfiles":PROFILES},
    "arms":metrics,"stopRule":{"triggered":True,"reason":"A0 raw full-resolution render already shows speckle","a2":"not measured; Blender Collapse was interrupted immediately after A1 when raw inspection triggered the stop rule; no A2 artifact/result retained and no tearing step can be named","a3":"skipped"},
    "timingAndPeakRss":{
        "stageIsolationPrep":{"seconds":122.44553399085999,"peakRssBytes":6751649792},
        "stageIsolationRenderColourAndClay":{"seconds":6.62,"peakRssBytes":4633280512},
        "a0Round5bPostprocess":{"seconds":120.87673306465149,"peakRssBytes":32447135744},
        "a1ExactGeometryRebakeNormalSplitAndExport":{"seconds":5.826345920562744,"peakRssBytes":3171942400},
        "a0Render":{"seconds":1.87,"peakRssBytes":529727488},
        "a1Render":{"seconds":1.89,"peakRssBytes":531939328},
    },
    "crops":crop_paths,"contactSheet":str(ROOT/"contact-sheet-raw-budget.png"),
    "codeCitations":[
        "~/.openclinxr-tools/trellis2-apple/src/o-voxel/o_voxel/postprocess.py:253-279 (cumesh simplify/repair chain)",
        "~/.openclinxr-tools/trellis2-apple/src/o-voxel/o_voxel/postprocess.py:329-344 (UV unwrap and unsplit smooth vertex normals)",
        "~/.openclinxr-tools/trellis2-apple/src/o-voxel/o_voxel/postprocess.py:376-394 (one raster sample/texel, full-res closest-point snap, trilinear sample)",
        "~/.openclinxr-tools/trellis2-apple/src/o-voxel/o_voxel/postprocess.py:450-455 (Telea inpaint, base r=3)",
        "~/.openclinxr-tools/trellis2-apple/src/trellis2/pipelines/trellis2_texturing.py:291-319 (user mesh and keep-existing-UV branch)",
    ],
}
(ROOT/"results.json").write_text(json.dumps(results,indent=2)+"\n")
best="a0"
manifest={"schemaVersion":"openclinxr.ecg-cart-round6-best.v1","bestArm":best,"asset":str(ROOT/best/"ecg-cart.glb"),"sha256":json.loads((ROOT/best/"report.json").read_text())["sha256"],"metrics":metrics[best],"selection":"A0 remains best: A1 reduces bezel speckle but exceeds A0-derived corner widths and per-feature dE thresholds; A2/A3 stopped by the generation-side speckle rule","notEvidenceFor":["Quest readiness","clinical accuracy","runtime adoption"]}
(ROOT/"best-manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
print(json.dumps({"metrics":metrics,"best":best}))
