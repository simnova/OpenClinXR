#!/usr/bin/env python3
from __future__ import annotations
import json, shutil
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont

HERE=Path(__file__).resolve().parent
TARGET=Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
TAGS=("b6","g1","g2","g3","g4","g5","g6")
DEC={"b6":("BASE","accepted curtain5/e4"),"g1":("KEPT","end p95 and constraints pass"),"g2":("REVERTED","high-pass moved down"),"g3":("REVERTED","high-pass moved down"),"g4":("REVERTED","end p95 failed after shortening/audit"),"g5":("REVERTED","high-pass moved down"),"g6":("KEPT","light re-solve on unchanged g1 geometry")}
def load(t):return json.load(open(HERE/"cells"/t/"metrics.json"))
def safety(t):
 z=np.load(HERE/"cells"/t/"strands.npz");p=np.asarray(z["points"]);cd=np.load(HERE.parents[3]/"tools/openclinxr/evidence/hair-cap8/cap-v8.npz");cx=float(cd["cx"]);can=max(abs(float(cd["canthus_L"][0])-cx),abs(float(cd["canthus_R"][0])-cx));face=(np.abs(p[:,:,0]-cx)<=can)&(p[:,:,2]<=float(cd["brow_z"]))&(p[:,:,2]>=float(cd["menton_z"]))&(p[:,:,1]<float(cd["cy"]));n=int(face.any(axis=1).sum());return n,n
def make_sheet():
 rows=[("TS",None),("b6","b6"),("g1","g1"),("g6","g6")];views=[("front",(0,0,1024,1024)),("three_quarter",(0,0,1024,1024)),("profile_90",(0,0,1024,1024)),("back",(0,0,1024,1024)),("ear crop",(100,240,484,624)),("back crop",(320,280,704,664))];tile=384;labelh=32;canvas=Image.new("RGB",(tile*len(views),len(rows)*(tile+labelh)),"white");d=ImageDraw.Draw(canvas)
 for ri,(label,tag) in enumerate(rows):
  for ci,(view,box) in enumerate(views):
   source="three_quarter" if view=="ear crop" else "back" if view=="back crop" else view
   if tag is None:p=TARGET/("target-profile.png" if source=="profile_90" else f"target-{source}.png")
   else:p=HERE/"cells"/tag/(source+".png")
   im=Image.open(p).convert("RGB");im=im.crop(box).resize((tile,tile),Image.Resampling.LANCZOS);x=ci*tile;y=ri*(tile+labelh)+labelh;canvas.paste(im,(x,y));d.text((x+6,ri*(tile+labelh)+8),f"{label} | {view}",fill="black")
 canvas.save(HERE/"look-sheet.png")
def scoreboard_png(rows):
 w,h=1500,70+44*len(rows);im=Image.new("RGB",(w,h),"white");d=ImageDraw.Draw(im);d.text((16,16),"hair-look-1 scoreboard",fill="black");heads="cell decision   IoU front/profile/back   dir std   highpass xb6   sheen med   end p95   p50   part/side   show";d.text((16,45),heads,fill="black")
 for i,r in enumerate(rows):
  s=f"{r['tag']:>3} {r['decision']:<9} {r['iou']['front']:.4f}/{r['iou']['profile']:.4f}/{r['iou']['back']:.4f}    {r['directionStdDeg']:.2f}      {r['highpassXB6']:.3f}          {r['sheenMedianPx']:.1f}       {r['endP95Deg']:.2f}    {r['p50']:.3f}   {r['partSide']:.3f}      {r['showThrough']:.3f}";d.text((16,70+i*44),s,fill=(0,100,0) if r['decision'] in ('KEPT','BASE') else (150,0,0))
 im.save(HERE/"scoreboard.png")
def main():
 b=load("b6");diag=json.load(open(HERE/"diagnosis.json"));target_med=float(np.median([diag["pixels"]["target"][v]["highpass"]["median"] for v in ("front","three_quarter","back")]));base_hp=b["look"]["front"]["highpass"]["median"];base_eye=b["eyeGap"];rows=[]
 for t in TAGS:
  m=load(t);over,opening=safety(t);hp=m["look"]["front"]["highpass"]["median"];dec,why=DEC[t];row={"tag":t,"decision":dec,"why":why,"iou":{k:m["silhouette"][k] for k in ("front","profile","back")},"deltaIoU":{k:m["silhouette"][k]-b["silhouette"][k] for k in ("front","profile","back")},"directionStdDeg":m["geometry"]["directionAngleStdDeg"],"spacingStdMm":m["geometry"]["neighbourSpacingStdMm"],"highpassMedian":hp,"highpassXB6":hp/base_hp,"highpassXTS":hp/target_med,"sheenMedianPx":m["look"]["front"]["sheen"]["medianAreaPx"],"endP95Deg":max(x["p95Deg"] for x in m["endTangents"].values()),"p50":m["frontLook"]["p50"],"partSide":m["frontLook"]["partSide"],"faceP50":m["frontLook"]["faceP50"],"inside":m["inside"],"overEye":over,"faceOpening":opening,"eyeGapDeltaMax":max(abs(m["eyeGap"][s]-base_eye[s]) for s in ("L","R")),"showThrough":m["showThrough"],"standing":m["standing"],"landmarkSource":"projected:landmarks.json","clumpWeight":.5 if t=="g3" else 0};rows.append(row)
 gates={"G1":"PASS diagnosis precedes cells; D1 REFUTED and D2 SUPPORTED by measured rules","G2":"PASS kept g1/g6 constraints","G3":"FAIL high-pass 2x, sheen 0.5x, and g6 p50 within 25% TS are unmet","G4":"pending self-test","G5":"PASS scoped tree/no blend"};doc={"schemaVersion":1,"baseline":"b6 == hair-curtain5/e4","cells":rows,"gates":gates,"bestG":"g1","final":"g6","targetHighpassMedian":target_med};(HERE/"scoreboard.json").write_text(json.dumps(doc,indent=2)+"\n");scoreboard_png(rows);make_sheet();best=HERE/"best";best.mkdir(exist_ok=True)
 for name in ("strands.npz","metrics.json","audit.json"):shutil.copy2(HERE/"cells/g1"/name,best/("g1-"+name))
 for name in ("front.png","three_quarter.png","profile_90.png","back.png","front-id.png","three_quarter-id.png","profile_90-id.png","back-id.png","params.json","metrics.json"):shutil.copy2(HERE/"cells/g6"/name,best/name)
 print("FINALIZE_DONE")
if __name__=="__main__":main()
