"""Final 16 CMA evaluations: key-lobe geometry with face-compensating fill."""
from __future__ import annotations
import json, math, statistics, sys
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from cmaes import CMAES
import look_station as ls

NAMES=("roughness","melanin","redness","key_elev_deg","key_azimuth_delta_deg",
       "key_energy","key_size_m","fill_W","fill_elev_deg","root_dark","random")
BOUNDS=((.12,.35),(.82,1.),(.60,.90),(20.,44.),(-75.,75.),(100.,180.),
        (1.2,3.0),(40.,110.),(15.,45.),(0.,.40),(0.,.10))

def normalize(p):
 d={**ls.BASE,"key_energy":150.,"key_azimuth_delta_deg":0.,"fill_W":ls.BASE["fill_W"],
    "fill_elev_deg":ls.BASE["fill_elev_deg"],"root_dark":.3,"random":0.}
 d.update(p);return [(d[n]-lo)/(hi-lo) for n,(lo,hi) in zip(NAMES,BOUNDS)]

def denorm(v):return {n:lo+float(x)*(hi-lo) for n,x,(lo,hi) in zip(NAMES,v,BOUNDS)}

def objective(m):
 w=m["whole_front"];t=ls.TARGET_METRICS["whole_front"]
 face=abs(m["cheek"]["p50"]/ls.BASE_FACE-1.)
 terms={"p50":2*abs(math.log(w["p50"]/t["p50"])),
        "p90":2*abs(math.log(w["p90"]/t["p90"])),
        "RB":abs(math.log(w["RB"]/t["RB"])),
        "partSide":5*max(0,m["part_side_ratio"]-1.6),
        "face":100*max(0,face-.05)}
 terms["total"]=sum(terms.values());return terms

def main():
 out=HERE/"refine";out.mkdir(exist_ok=True)
 (out/"lineage.jsonl").write_text("")
 warm=json.load(open(HERE/"search/lineage.jsonl")) if False else {
  "roughness":.20744728799748446,"melanin":.8318858642281755,"redness":.8294456558210432,
  "key_elev_deg":38.,"key_energy":148.18581432335196,"key_size_m":1.968943565284564,
  "root_dark":.29801737620714847,"random":0.}
 state=ls.build_state();es=CMAES(np.clip(normalize(warm),0,1),.25,8,np.random.RandomState(20261015))
 rows=[];idx=0
 for gen in range(2):
  vectors=es.ask();scores=[]
  for v in vectors:
   p=denorm(v);rec=ls.render_candidate(state,f"refine/eval-{idx:03d}",p,("front",),512,32,0)
   m=ls.front_metrics(rec["renders"]["front"]["png"],rec["renders"]["front"]["id_png"]);fit=objective(m)
   row={"index":idx,"generation":gen,"params":p,"metrics":m,"fitness":fit,"renders":rec["renders"]}
   rows.append(row);scores.append(fit["total"])
   with open(out/"lineage.jsonl","a") as f:f.write(json.dumps(row,sort_keys=True)+"\n")
   idx+=1
  es.tell(vectors,scores)
 best=min(rows,key=lambda r:r["fitness"]["total"])
 runs=[]
 for seed in (0,1,2):
  views=ls.VIEWS if seed==0 else ("front",)
  rec=ls.render_candidate(state,f"refine-best/seed-{seed}",best["params"],views,1024,64,seed)
  m=ls.front_metrics(rec["renders"]["front"]["png"],rec["renders"]["front"]["id_png"])
  runs.append({"seed":seed,"metrics":m,"fitness":objective(m),"renders":rec["renders"]})
 spread={k:{"mean":statistics.fmean(r["metrics"]["whole_front"][k] for r in runs),
            "sd":statistics.pstdev(r["metrics"]["whole_front"][k] for r in runs)}
         for k in ("p50","p90","RB")}
 (out/"report.json").write_text(json.dumps({"evaluations":16,"warmStart":warm,"best512":best,
   "confirmation":runs,"spread":spread},indent=2)+"\n")
 print("HAIR_LIGHT2_REFINE_DONE",flush=True)

if __name__=="__main__":main()
