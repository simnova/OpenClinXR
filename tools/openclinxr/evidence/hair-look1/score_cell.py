#!/usr/bin/env python3
"""Score one rendered cell with projected landmarks and look metrics."""
from __future__ import annotations
import argparse, importlib.util, json, sys
from pathlib import Path
import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
JUDGE=Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TARGET_MASKS=JUDGE/"target-set-back"
sys.path.insert(0,str(HERE));import diagnose as dg

def load_judge():
    spec=importlib.util.spec_from_file_location("hair_judge_v6_look1",JUDGE/"hair_judge.py");m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;sys.path.insert(0,str(JUDGE));spec.loader.exec_module(m);return m
def triple(v,keys):return ",".join(str(v[k]) for k in keys)
def front_look(image,mask):
    y=dg.lum(image);yy,xx=np.nonzero(mask);y0,y1,x0,x1=yy.min(),yy.max(),xx.min(),xx.max();h=y1-y0+1;w=x1-x0+1;Y,X=np.indices(mask.shape)
    crown=mask&(Y<=y0+.35*h)&(X>=x0+.35*w)&(X<=x0+.65*w);sides=mask&(Y>=y0+.18*h)&(Y<=y0+.68*h)&((X<=x0+.28*w)|(X>=x0+.72*w));cheek=(Y>=.40*mask.shape[0])&(Y<=.52*mask.shape[0])&(X>=.39*mask.shape[1])&(X<=.61*mask.shape[1])&~mask
    return {"p50":float(np.percentile(y[mask],50)),"p90":float(np.percentile(y[mask],90)),"partSide":float(y[crown].mean()/max(y[sides].mean(),1e-12)),"faceP50":float(np.percentile(y[cheek],50)),"maskPx":int(mask.sum())}
def main():
    ap=argparse.ArgumentParser();ap.add_argument("tag");a=ap.parse_args();d=HERE/"cells"/a.tag;lm=json.load(open(HERE/"landmarks.json"))["judge"]
    front=triple(lm["front"],("crown_top_row","chin_row","face_centre_col"));profile=triple(lm["profile"],("crown_top_row","chin_row","forehead_front_col"));back=triple(lm["back"],("crown_top_row","shoulder_row","hair_centre_col"));out=d/"judge";out.mkdir(exist_ok=True)
    j=load_judge().judge(str(d/"front.png"),str(d/"front-id.png"),a.tag,front,str(out),target_set="back",id_mask_path=str(d/"front-id.png"),profile_mask_path=str(d/"profile_90-id.png"),profile_landmarks=profile,back_mask_path=str(d/"back-id.png"),back_landmarks=back,target_front_mask=str(TARGET_MASKS/"mask-front-v2.png"),target_profile_mask=str(TARGET_MASKS/"mask-profile-v2.png"),target_back_mask=str(TARGET_MASKS/"mask-back-v3.png"),overlay_prefix="overlay-")
    z=np.load(d/"strands.npz");geom=dg.geometry(np.asarray(z["points"],float),np.asarray(z["roots"],float));ends=dg.end_angles(np.asarray(z["points"],float),np.asarray(z["roots"],float),float(z["apex_y"]));look={v:dg.image_metrics(dg.rgb(d/(v+".png")),dg.ours_mask(d/(v+"-id.png"))) for v in dg.VIEWS};fl=front_look(dg.rgb(d/"front.png"),dg.ours_mask(d/"front-id.png"));audit=json.load(open(d/"audit.json"));eye=j["face_gaps"]["eye"]
    doc={"tag":a.tag,"silhouette":{"front":j["iou"],"eroded":j["iou_eroded"],"profile":j["profile_view"]["iou"],"back":j["back_view"]["iou"]},"eyeGap":{"L":eye["L"]["ratio"],"R":eye["R"]["ratio"]},"standing":j["standing_hair"]["flag"],"showThrough":j["id_show_through"]["fraction"],"inside":audit.get("post_inside_total"),"geometry":geom,"endTangents":ends,"look":look,"frontLook":fl,"judgeJson":str(out/(a.tag+".json"))}
    (d/"metrics.json").write_text(json.dumps(doc,indent=2)+"\n");print(json.dumps({"tag":a.tag,"silhouette":doc["silhouette"],"dirStd":geom["directionAngleStdDeg"],"highpass":look["front"]["highpass"]["median"],"sheen":look["front"]["sheen"]["medianAreaPx"],"endP95":max(x["p95Deg"] for x in ends.values()),"inside":doc["inside"],"show":doc["showThrough"]},indent=2))
if __name__=="__main__":main()
