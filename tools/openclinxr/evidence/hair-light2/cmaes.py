#!/usr/bin/env python3
"""Round-2 CMA-ES, stability rerenders, world bisection, and report writer."""
from __future__ import annotations
import io, json, os, shutil, statistics, subprocess, sys, time
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[4]; OUT=Path(__file__).resolve().parent
sys.path.insert(0,str(OUT))
from fitness import breakdown,fitness

NAMES=("key_elev_deg","key_size_m","fill_W","fill_elev_deg","rim_W","melanin","redness","roughness","length")
BOUNDS=((25,70),(.8,2.8),(20,140),(0,50),(0,80),(.3,1.),(.2,.9),(.12,.5),(1.2,1.8))
POPULATION=10; MAX_GENERATIONS=12; SEARCH_SEED=0; SIGMA0=.25

class CMAES:
    """Minimal deterministic full-covariance CMA-ES for the [0,1]^n box."""
    def __init__(self,mean,sigma,population,rng):
        self.mean=np.asarray(mean,dtype=float); self.sigma=float(sigma); self.lam=population; self.rng=rng; self.n=len(mean); self.mu=population//2
        w=np.log(self.mu+.5)-np.log(np.arange(1,self.mu+1)); self.weights=w/w.sum(); self.mueff=1/np.sum(self.weights**2)
        n=self.n; self.cc=(4+self.mueff/n)/(n+4+2*self.mueff/n); self.cs=(self.mueff+2)/(n+self.mueff+5); self.c1=2/((n+1.3)**2+self.mueff); self.cmu=min(1-self.c1,2*(self.mueff-2+1/self.mueff)/((n+2)**2+self.mueff)); self.damps=1+2*max(0,np.sqrt((self.mueff-1)/(n+1))-1)+self.cs
        self.pc=np.zeros(n); self.ps=np.zeros(n); self.C=np.eye(n); self.B=np.eye(n); self.D=np.ones(n); self.invsqrtC=np.eye(n); self.chi=n**.5*(1-1/(4*n)+1/(21*n*n)); self.count=0; self._asked=None
    def ask(self):
        z=self.rng.randn(self.lam,self.n); y=(z*self.D)@self.B.T; x=np.clip(self.mean+self.sigma*y,0,1); self._asked=(x,y); return [row.copy() for row in x]
    def tell(self,vectors,scores):
        x=np.asarray(vectors); order=np.argsort(scores); old=self.mean.copy(); selected=x[order[:self.mu]]; self.mean=np.sum(selected*self.weights[:,None],axis=0); yw=(self.mean-old)/self.sigma
        self.ps=(1-self.cs)*self.ps+np.sqrt(self.cs*(2-self.cs)*self.mueff)*(self.invsqrtC@yw); self.count+=1
        norm=np.linalg.norm(self.ps); hsig=float(norm/np.sqrt(1-(1-self.cs)**(2*self.count))/self.chi < (1.4+2/(self.n+1)))
        self.pc=(1-self.cc)*self.pc+hsig*np.sqrt(self.cc*(2-self.cc)*self.mueff)*yw
        yi=(selected-old)/self.sigma; rankmu=sum(w*np.outer(y,y) for w,y in zip(self.weights,yi))
        self.C=(1-self.c1-self.cmu)*self.C+self.c1*(np.outer(self.pc,self.pc)+(1-hsig)*self.cc*(2-self.cc)*self.C)+self.cmu*rankmu
        self.sigma*=np.exp((self.cs/self.damps)*(norm/self.chi-1)); vals,self.B=np.linalg.eigh((self.C+self.C.T)/2); self.D=np.sqrt(np.maximum(vals,1e-18)); self.invsqrtC=self.B@np.diag(1/self.D)@self.B.T

def denormalize(v): return {n:lo+float(x)*(hi-lo) for n,x,(lo,hi) in zip(NAMES,v,BOUNDS)}
def blender_json(proc):
    while True:
        line=proc.stdout.readline()
        if not line: raise RuntimeError("Blender evaluator exited before a JSON result")
        try: return json.loads(line)
        except json.JSONDecodeError: continue

def send(proc,request):
    started=time.monotonic(); proc.stdin.write(json.dumps(request)+"\n"); proc.stdin.flush()
    result=blender_json(proc); result.setdefault("wallSeconds",time.monotonic()-started); return result

def git_blob(path):
    run=subprocess.run(["git","show",f"f01554aa4:{path}"],cwd=ROOT,capture_output=True,check=True)
    return run.stdout

def baseline_document():
    doc=json.loads(git_blob("tools/openclinxr/evidence/hair-search/best.json"))
    beauty=np.asarray(Image.open(io.BytesIO(git_blob("tools/openclinxr/evidence/hair-search/best-1024.png"))).convert("RGB"),dtype=np.float64)/255
    alpha=np.asarray(Image.open(io.BytesIO(git_blob("tools/openclinxr/evidence/hair-search/best-1024-id.png"))).convert("RGBA"),dtype=np.float64)[...,3]/255
    mask=alpha>=.9; lum=.2126*beauty[...,0]+.7152*beauty[...,1]+.0722*beauty[...,2]; vals=lum[mask]; p90=float(np.percentile(vals,90))
    ys=np.nonzero(mask)[0]; top,bottom=int(ys.min()),int(ys.max()); bright=mask&(lum>p90); n=int(bright.sum())
    metrics=dict(doc["metrics"]); metrics["sheenTopFrac"]=float(bright[:top+max(1,int(.3*(bottom-top+1)))+1].sum())/n if n else 0.
    metrics.setdefault("maskPx",int(mask.sum())); metrics.setdefault("meanRBSpread",.0)
    params={k:v for k,v in doc["params"].items() if k in NAMES}; params["length"]=1.0
    return {"metrics":metrics,"fitness":fitness(metrics),"params":params,"sourceCommit":"f01554aa4","sourcePng":"hair-search/best-1024.png"}

def progress(rows,bests,baseline_png):
    width,thumb,gh=2048,512,260; sheet=Image.new("RGB",(width,gh+thumb),(22,22,22)); draw=ImageDraw.Draw(sheet)
    if bests:
        lo,hi=min(bests),max(bests); pts=[]
        for i,v in enumerate(bests): pts.append((30+i*(width-60)/max(1,len(bests)-1),20+(v-lo)/max(1e-9,hi-lo)*(gh-50)))
        if len(pts)>1: draw.line(pts,fill=(65,190,255),width=4)
        for x,y in pts: draw.ellipse((x-4,y-4,x+4,y+4),fill=(255,210,40))
        draw.text((30,5),"best-so-far fitness per generation (lower is better)",fill="white")
    good=sorted((r for r in rows if r.get("ok")),key=lambda r:r["fitness"])
    panels=[("v1 baseline",baseline_png)]+[(label,Path(r["beautyPath"])) for label,r in zip(("best","second","third"),good[:3])]
    for i,(label,path) in enumerate(panels):
        panel=Image.open(path).convert("RGB").resize((thumb,thumb),Image.Resampling.LANCZOS); sheet.paste(panel,(i*thumb,gh)); draw.rectangle((i*thumb,gh,i*thumb+200,gh+24),fill=(0,0,0)); draw.text((i*thumb+6,gh+5),label,fill=(255,255,0))
    sheet.save(OUT/"search-progress.png")

def target_profile_metrics(path):
    a=np.asarray(Image.open(path).convert("L"),dtype=np.float64)/255.; m=a>=.9; ys,xs=np.nonzero(m)
    if not len(ys): return None
    top,bottom,left,right=map(int,(ys.min(),ys.max(),xs.min(),xs.max())); chin=int(round(.60*(m.shape[0]-1)))
    return {"hairBottomRowBelowChinFraction":max(0.,(bottom-chin)/max(1.,chin-top)),"hairBackExtent":float(right-left+1)/max(1.,bottom-top+1),"hairTopPx":top,"hairBottomPx":bottom,"chinPx":chin,"hairLeftPx":left,"hairRightPx":right}

def main():
    lineage=OUT/"lineage.jsonl"; lineage.write_text("")
    base=baseline_document(); baseline_png=OUT/"_baseline-v1.png"; baseline_png.write_bytes(git_blob("tools/openclinxr/evidence/hair-search/best-1024.png"))
    env=os.environ.copy(); env["MISE_TRUSTED_CONFIG_PATHS"]=str(ROOT)
    proc=subprocess.Popen(["blender","--background","--python",str(OUT/"search.py")],cwd=ROOT,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
    ready=blender_json(proc)
    if not ready.get("ready"): raise RuntimeError(ready.get("error","Blender setup failed"))
    rng=np.random.RandomState(SEARCH_SEED); es=CMAES([.5]*len(NAMES),SIGMA0,POPULATION,rng)
    rows=[]; generation_best=[]; best_so_far=[]; index=0
    for generation in range(MAX_GENERATIONS):
        vectors=es.ask(); scores=[]
        for vector in vectors:
            params=denormalize(vector); request={"index":index,"generation":generation,"params":params,"size":512,"samples":32,"cyclesSeed":0,"stem":f"eval-{index:04d}"}; sent=time.monotonic()
            try: result=send(proc,request)
            except Exception as exc: result={"ok":False,"error":str(exc),"wallSeconds":time.monotonic()-sent}
            if result.get("ok"):
                score=fitness(result["metrics"]); row={"ok":True,"index":index,"generation":generation,"params":params,"metrics":result["metrics"],"fitness":score,"renderSeconds":result["renderSeconds"],"wallSeconds":result["wallSeconds"],"gitSha":subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip(),"seed":SEARCH_SEED,"cyclesSeed":0,"beautyPath":result["beautyPath"],"idPath":result["idPath"],"strandsAfter":result["strandsAfter"],"lengthReadBack":result["lengthReadBack"]}
            else:
                score=1e9; row={"ok":False,"index":index,"generation":generation,"params":params,"fitness":score,"renderSeconds":max(1e-6,float(result.get("wallSeconds",time.monotonic()-sent))),"error":result.get("error","unknown evaluator error")}
            with lineage.open("a") as h: h.write(json.dumps(row,sort_keys=True)+"\n")
            rows.append(row); scores.append(score); index+=1
        es.tell(vectors,scores); gb=min(scores); generation_best.append(gb); best_so_far.append(min(generation_best)); progress(rows,best_so_far,baseline_png)
        if generation>=3 and (best_so_far[-4]-best_so_far[-1])/max(abs(best_so_far[-4]),1e-9)<.01: break
    good=sorted((r for r in rows if r.get("ok")),key=lambda r:r["fitness"])
    if not good: raise RuntimeError("all CMA-ES evaluations failed; see lineage.jsonl verbatim errors")
    best=good[0]

    # Six fixed-parameter bisection renders; background is not a CMA variable.
    lo,hi=.01,1.20; bis=[]
    for iteration in range(6):
        strength=(lo+hi)/2; result=send(proc,{"index":1001000+iteration,"params":best["params"],"size":512,"samples":32,"cyclesSeed":0,"worldStrength":strength,"stem":f"world-{iteration}"})
        if not result.get("ok"): raise RuntimeError(result.get("error","world bisection render failed"))
        rec={"iteration":iteration,"worldStrength":strength,"backgroundLuminance":result["metrics"]["bg"],"faceLuminance":result["metrics"]["face"],"renderSeconds":result["renderSeconds"]}; bis.append(rec)
        if rec["backgroundLuminance"]<.50: lo=strength
        else: hi=strength
    chosen=min(bis,key=lambda r:abs(r["backgroundLuminance"]-.50)); world_strength=chosen["worldStrength"]

    # Top three candidates, three independent Cycles seeds each.
    top3=[]
    for rank,candidate in enumerate(good[:3],1):
        runs=[]
        for cycles_seed in (0,1,2):
            result=send(proc,{"index":1100000+rank*10+cycles_seed,"params":candidate["params"],"size":512,"samples":32,"cyclesSeed":cycles_seed,"worldStrength":world_strength,"stem":f"top{rank}-seed{cycles_seed}"})
            if not result.get("ok"): raise RuntimeError(result.get("error","top-three seed render failed"))
            runs.append({"cyclesSeed":cycles_seed,"p10":result["metrics"]["p10"],"p50":result["metrics"]["p50"],"p90":result["metrics"]["p90"],"fitness":fitness(result["metrics"]),"renderSeconds":result["renderSeconds"]})
        summary={k:{"mean":statistics.fmean(r[k] for r in runs),"sd":statistics.pstdev(r[k] for r in runs)} for k in ("p10","p50","p90","fitness")}
        top3.append({"rank":rank,"lineageIndex":candidate["index"],"params":candidate["params"],"runs":runs,"summary":summary})
    (OUT/"top3-seeds.json").write_text(json.dumps({"cyclesSeeds":[0,1,2],"candidates":top3},indent=2,sort_keys=True)+"\n")

    final=send(proc,{"index":1200000,"params":best["params"],"size":1024,"samples":64,"cyclesSeed":0,"worldStrength":world_strength,"stem":"best-1024"})
    if not final.get("ok"): raise RuntimeError(final.get("error","final render failed"))
    profile=send(proc,{"index":1200001,"params":best["params"],"size":1024,"samples":64,"cyclesSeed":0,"worldStrength":world_strength,"camera":"profile","stem":"profile-best"})
    if not profile.get("ok"): raise RuntimeError(profile.get("error","best profile render failed"))
    baseline_profile=send(proc,{"index":1200002,"params":base["params"],"size":1024,"samples":64,"cyclesSeed":0,"worldStrength":.3,"camera":"profile","stem":"profile-baseline"})
    if not baseline_profile.get("ok"): raise RuntimeError(baseline_profile.get("error","baseline profile render failed"))
    proc.stdin.write('{"quit":true}\n'); proc.stdin.flush(); proc.wait(timeout=30)

    seed_mean=top3[0]["summary"]["fitness"]["mean"]; seed_sd=top3[0]["summary"]["fitness"]["sd"]; margin=base["fitness"]-seed_mean; accepted=margin>2*seed_sd
    final_metrics=final["metrics"]; best_doc={**best,"ok":accepted,"error":"" if accepted else "new best does not beat search v1 by more than 2 sd of its 3-seed fitness spread","baselineFitness":base["fitness"],"acceptanceMargin":margin,"acceptanceThreshold":2*seed_sd,"seedFitnessMean":seed_mean,"seedFitnessSd":seed_sd,"metrics":final_metrics,"lineageMetrics":best["metrics"],"finalFitness":fitness(final_metrics),"fitnessBreakdown":breakdown(final_metrics),"best1024Png":"best-1024.png","best1024IdPng":"best-1024-id.png","worldStrength":world_strength}
    (OUT/"best.json").write_text(json.dumps(best_doc,indent=2,sort_keys=True)+"\n")
    bounds=[]
    for name,(lo_b,hi_b) in zip(NAMES,BOUNDS):
        value=best["params"][name]; frac=(value-lo_b)/(hi_b-lo_b); bounds.append({"parameter":name,"value":value,"within5PctOfBound":frac<=.05 or frac>=.95,"bound":"low" if frac<=.05 else ("high" if frac>=.95 else None),"fractionThroughRange":frac})
    target_mask=Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/mask-profile.png")
    profiles={"graded":False,"baseline":baseline_profile["profileMetrics"],"best":profile["profileMetrics"],"reference":target_profile_metrics(target_mask) if target_mask.exists() else None,"referencePath":str(target_mask),"referenceError":None if target_mask.exists() else f"missing: {target_mask}"}
    face_ok=all(.55<=r["faceLuminance"]<=.70 for r in bis)
    report={"ok":accepted and .48<=chosen["backgroundLuminance"]<=.52 and face_ok,"error":"" if accepted else best_doc["error"],"evaluations":len(rows),"generations":len(generation_best),"seed":SEARCH_SEED,"population":POPULATION,"sigma0":SIGMA0,"meanRenderSeconds":statistics.fmean(r["renderSeconds"] for r in rows),"bestParams":best["params"],"boundsHitTable":bounds,"baseline":base,"best":{"lineageMetrics":best["metrics"],"lineageFitness":best["fitness"],"finalMetrics":final_metrics,"finalFitness":fitness(final_metrics)},"acceptance":{"passed":accepted,"baselineFitness":base["fitness"],"bestThreeSeedMean":seed_mean,"bestThreeSeedSd":seed_sd,"improvement":margin,"requiredImprovement":2*seed_sd},"backgroundBisection":{"iterations":bis,"finalWorldStrength":world_strength,"finalBackgroundLuminance":chosen["backgroundLuminance"],"faceDriftWithinBand":face_ok},"profileMetrics":profiles,"pinned":{"profileRadius":.0003,"amount":4,"exposure":-.375,"viewTransform":"Standard","camera":"image-rim fixed front; 90-degree profile only for ungraded descriptors","crown":"unmodified image-rim structural stage","trim":"removed"},"finalRender":{"renderSeconds":final["renderSeconds"],"strandsAfter":final["strandsAfter"],"lengthReadBack":final["lengthReadBack"]}}
    if not (.48<=chosen["backgroundLuminance"]<=.52): report["ok"]=False; report["error"]=(report["error"]+"; " if report["error"] else "")+"six-iteration world bisection did not reach background [0.48,0.52]"
    if not face_ok: report["ok"]=False; report["error"]=(report["error"]+"; " if report["error"] else "")+"face luminance left [0.55,0.70] during world bisection"
    (OUT/"report.json").write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    for pattern in ("eval-*.png","world-*.png","top*-seed*.png","profile-baseline*.png","_baseline-v1.png"):
        for path in OUT.glob(pattern): path.unlink()

if __name__=="__main__": main()
