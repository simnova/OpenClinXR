"""24-evaluation light/material CMA-ES warm-started from hair-light2."""
from __future__ import annotations
import json, math, shutil, statistics, sys
from pathlib import Path
import bpy
import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE));import station as st
from cmaes import CMAES

NAMES=("roughness","melanin","redness","key_elev_deg","key_azimuth_delta_deg","key_energy","key_size_m","fill_W","fill_elev_deg","root_dark")
BOUNDS=((.12,.35),(.82,1.),(.60,.90),(20.,44.),(-75.,75.),(100.,180.),(1.2,3.),(40.,110.),(15.,45.),(0.,.40))
WARM=dict(st.LIGHT)

def normalize(p):return [(float(p[n])-lo)/(hi-lo) for n,(lo,hi) in zip(NAMES,BOUNDS)]
def denorm(v):return {n:lo+float(x)*(hi-lo) for n,x,(lo,hi) in zip(NAMES,v,BOUNDS)}
def image(p):return np.asarray(Image.open(p).convert("RGB"),float)/255.
def mask(p):return np.asarray(Image.open(p).convert("RGBA"))[...,3]>=230
def look(im,m):
    y=.2126*im[...,0]+.7152*im[...,1]+.0722*im[...,2];yy,xx=np.nonzero(m);y0,y1,x0,x1=yy.min(),yy.max(),xx.min(),xx.max();h=y1-y0+1;w=x1-x0+1;Y,X=np.indices(m.shape);c=m&(Y<=y0+.35*h)&(X>=x0+.35*w)&(X<=x0+.65*w);s=m&(Y>=y0+.18*h)&(Y<=y0+.68*h)&((X<=x0+.28*w)|(X>=x0+.72*w));cheek=(Y>=.40*m.shape[0])&(Y<=.52*m.shape[0])&(X>=.39*m.shape[1])&(X<=.61*m.shape[1])&~m
    return {"p50":float(np.percentile(y[m],50)),"p90":float(np.percentile(y[m],90)),"partSide":float(y[c].mean()/max(y[s].mean(),1e-12)),"faceP50":float(np.percentile(y[cheek],50))}
def objective(m,target,base_face):
    terms={"p50":2*abs(math.log(max(m["p50"],1e-9)/target["p50"])),"p90":abs(math.log(max(m["p90"],1e-9)/target["p90"])),"partSide":5*max(0,m["partSide"]-1.6),"face":100*max(0,abs(m["faceP50"]/base_face-1)-.05)};terms["total"]=sum(terms.values());return terms
def main():
    state=st.build_state();z=np.load(HERE/"cells/g1/strands.npz");kids=np.asarray(z["points"],float);obj=st.object_for(state,kids,"g6_search")
    base=json.load(open(HERE/"cells/b6/metrics.json"))["frontLook"];tm=np.asarray(Image.open(st.TARGET/"target-front.png").convert("RGB"),float)/255. if hasattr(st,"TARGET") else image(Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back/target-front.png"));tmask=np.asarray(Image.open(Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back/mask-front-v2.png")).convert("L"))>=128;target_y=.2126*tm[...,0]+.7152*tm[...,1]+.0722*tm[...,2];target={"p50":float(np.percentile(target_y[tmask],50)),"p90":float(np.percentile(target_y[tmask],90))}
    out=HERE/"search";out.mkdir(exist_ok=True);(out/"lineage.jsonl").write_text("");es=CMAES(np.clip(normalize(WARM),0,1),.16,8,np.random.RandomState(20261014));rows=[];idx=0
    for gen in range(3):
        vecs=es.ask();scores=[]
        for v in vecs:
            p=denorm(v);st.material(state,obj,p);rec=st.render(state,obj,f"search/eval-{idx:03d}",( "front",),512,32,0,1.5,p);m=look(image(rec["front"]["png"]),mask(rec["front"]["id_png"]));fit=objective(m,target,base["faceP50"]);row={"index":idx,"generation":gen,"params":p,"metrics":m,"fitness":fit};rows.append(row);scores.append(fit["total"]);open(out/"lineage.jsonl","a").write(json.dumps(row,sort_keys=True)+"\n");idx+=1
        es.tell(vecs,scores)
    best=min(rows,key=lambda r:r["fitness"]["total"]);p=best["params"];runs=[]
    for seed in (0,1,2):
        st.material(state,obj,p);tag="g6" if seed==0 else f"g6-seed{seed}";views=st.VIEWS if seed==0 else ("front",);rec=st.render(state,obj,tag,views,1024,64,seed,1.5,p);m=look(image(rec["front"]["png"]),mask(rec["front"]["id_png"]));runs.append({"seed":seed,"metrics":m,"fitness":objective(m,target,base["faceP50"]),"renders":rec})
    g6=HERE/"cells/g6";shutil.copy2(HERE/"cells/g1/strands.npz",g6/"strands.npz");shutil.copy2(HERE/"cells/g1/audit.json",g6/"audit.json");spread={k:{"mean":statistics.fmean(x["metrics"][k] for x in runs),"sd":statistics.pstdev(x["metrics"][k] for x in runs)} for k in ("p50","p90","partSide","faceP50")};doc={"evaluations":24,"warmStart":WARM,"target":target,"baseFaceP50":base["faceP50"],"best512":best,"params":p,"confirmation":runs,"spread":spread};(out/"report.json").write_text(json.dumps(doc,indent=2)+"\n");(g6/"params.json").write_text(json.dumps(doc,indent=2)+"\n");print("LIGHT_SEARCH_DONE",json.dumps({"best":best["fitness"],"params":p,"spread":spread}))
if __name__=="__main__":main()
