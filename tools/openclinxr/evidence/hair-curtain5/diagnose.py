"""M1 measurements for hair-curtain-5; run before constructing e-cells."""
from __future__ import annotations
import importlib.util, json, sys
from pathlib import Path
import numpy as np
from PIL import Image

E=Path(__file__).resolve().parent
CAP=E.parent/'hair-cap8'/'cap-v8.npz'
J=Path('/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge')
TM=J/'target-set-back'; ROWS=(300,430,560,690); DEPTH_ROWS=(250,340,430,520,610,700)

def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);out=importlib.util.module_from_spec(spec);sys.modules[name]=out;spec.loader.exec_module(out);return out
def mask(path):return np.asarray(Image.open(path).convert('L'))>127
def warp(a,t):
 inv=(1/t['scale'],0,-t['tx']/t['scale'],0,1/t['scale'],-t['ty']/t['scale'])
 return np.asarray(Image.fromarray(a.astype(np.uint8)*255).transform((1024,1024),Image.Transform.AFFINE,inv,resample=Image.Resampling.NEAREST))>127
def density_bins(a,centre,ppm,row):
 half=2.5/1000*ppm;band=a[max(0,row-10):min(a.shape[0],row+11)];bins=[]
 for k in range(-4,5):
  lo=int(round(centre+(2*k-1)*half));hi=max(lo+1,int(round(centre+(2*k+1)*half)))
  x0=max(0,lo);x1=min(a.shape[1],hi)
  bins.append({'xMm':[5*k-2.5,5*k+2.5],'occupied':int(band[:,x0:x1].sum()),'pixels':int(band.shape[0]*(x1-x0))})
 center=bins[4]['occupied'];neigh=.5*(bins[3]['occupied']+bins[5]['occupied'])
 return {'row':row,'bins':bins,'centerToNeighbours':float(center/max(neigh,1e-9))}
def seam_luminance(path,centre,ppm,row):
 rgb=np.asarray(Image.open(path).convert('RGB'),float)/255.;gray=rgb@np.array((.2126,.7152,.0722));band=gray[max(0,row-10):min(1024,row+11)]
 w=max(1,int(round(2.5/1000*ppm)));c=int(round(centre));center=float(band[:,c-w:c+w+1].mean());left=float(band[:,c-3*w:c-w].mean());right=float(band[:,c+w+1:c+3*w+1].mean());neigh=.5*(left+right)
 return {'row':row,'center':center,'neighbours':neigh,'centerToNeighbours':center/max(neigh,1e-9)}
def edge_table(ours,target,rows,centre,ppm):
 out=[]
 for row in rows:
  xo,xt=np.where(ours[row])[0],np.where(target[row])[0]
  if not len(xo) or not len(xt):out.append({'row':row,'oursMm':None,'targetMm':None,'deltaMm':None});continue
  om=float(xo.max()-centre)/ppm*1000;tm=float(xt.max()-centre)/ppm*1000
  out.append({'row':row,'oursMm':om,'targetMm':tm,'deltaMm':om-tm})
 return out
def main():
 lm=json.loads((E/'landmarks.json').read_text())['judge'];cap=np.load(CAP);gd=np.load(E/'cells/b5/guides16.npz');jdoc=json.loads((E/'cells/b5/judge/d5.json').read_text())
 bc=float(lm['back']['hair_centre_col']);bppm=(lm['back']['shoulder_row']-lm['back']['crown_top_row'])/.2107
 pc=float(lm['profile']['forehead_front_col']);pppm=(lm['profile']['chin_row']-lm['profile']['crown_top_row'])/.2107
 fc=float(lm['front']['face_centre_col']);fppm=(lm['front']['chin_row']-lm['front']['crown_top_row'])/.2107
 back=warp(mask(E/'cells/b5/children/back-id.png'),jdoc['back_view']['transform']);profile=warp(mask(E/'cells/b5/children/profile_90-id.png'),jdoc['profile_view']['transform']);front=warp(mask(E/'cells/b5/children/front-id.png'),jdoc['transform'])
 target_back=mask(TM/'mask-back-v3.png');target_profile=mask(TM/'mask-profile-v2.png');target_front=mask(TM/'mask-front-v2.png')
 density=[density_bins(back,bc,bppm,row) for row in ROWS];luminance=[seam_luminance(E/'cells/b5/children/back.png',bc,bppm,row) for row in ROWS]
 G=np.asarray(gd['points']);crown=float(cap['crown']);guide_rows=[]
 for row in ROWS:
  z=crown-(row-lm['back']['crown_top_row'])/bppm;pts=[]
  for i,g in enumerate(G):
   q=g[np.argsort(g[:,2])];pts.append((i,float(np.interp(z,q[:,2],q[:,0]))))
  left=max((q for q in pts if q[1]<0),key=lambda q:q[1]);right=min((q for q in pts if q[1]>=0),key=lambda q:q[1])
  guide_rows.append({'row':row,'z':z,'left':{'guide':left[0],'xMm':left[1]*1000},'right':{'guide':right[0],'xMm':right[1]*1000},'gapMm':(right[1]-left[1])*1000})
 roots=np.asarray(gd['roots']);curtain=np.asarray(gd['frontal_drape'],bool);curtain|=(np.degrees(np.arctan2(abs(roots[:,0]),-(roots[:,1]-float(cap['Cy']))))<70)&(abs(roots[:,0])>=.040)
 transfer=[]
 for i in np.where(curtain)[0]:
  g=G[i];ddy=np.gradient(np.gradient(g[:,1]));valid=g[:,2]<float(cap['ear_top']);k=int(np.argmax(np.where(valid,abs(ddy),-1)))
  transfer.append({'guide':int(i),'rootXmm':float(roots[i,0]*1000),'z':float(g[k,2]),'curvatureY':float(abs(ddy[k]))})
 tz=np.array([r['z'] for r in transfer]);tsum={'count':len(transfer),'minZ':float(tz.min()),'p25Z':float(np.percentile(tz,25)),'medianZ':float(np.median(tz)),'p75Z':float(np.percentile(tz,75)),'maxZ':float(tz.max()),'stdMm':float(tz.std()*1000),'perGuide':transfer}
 flare=[]
 for row in (567,621):
  xo,xt=np.where(front[row])[0],np.where(target_front[row])[0]
  flare.append({'row':row,'oursOuterLmm':float(fc-xo.min())/fppm*1000,'oursOuterRmm':float(xo.max()-fc)/fppm*1000,'targetOuterLmm':float(fc-xt.min())/fppm*1000,'targetOuterRmm':float(xt.max()-fc)/fppm*1000})
 ch=module('curtain5_diag_children',E/'children.py');bp=ch.load_blend();c3=bp.import_children3();hs=c3.load_hair_scene();handle=hs.build_scene();meta={}
 ov=ch.front_fill_override(bp,cap,50000,bp.SEED,False);base=bp._blend_children_base(gd,cap,len(ov[0]),bp.SEED,meta,_roots_override=ov,_closure_on=True,_same_side_ahead_only=True,_weight_jitter=False);rcap=np.asarray(meta['roots_cap'])
 sem,sinfo=ch.curtain_preserving_children(gd,cap,rcap,12.0);sem=ch.apply_side_clearance(sem,rcap,sinfo,float(cap['cx']),8.0);cfix,creport=ch.repair_outside(sem.copy(),handle,include_detail=True);smooth,_=ch.resample_smooth(cfix.copy(),cap);pre_final=ch.apply_rounded_hem(smooth.copy(),rcap,cap,17.,13.);final,freport=ch.repair_outside(pre_final.copy(),handle,include_detail=True)
 def attribution(before,after):
  mm=np.linalg.norm(after-before,axis=2)*1000;moved=mm>1e-7;regions={'scalp':before[:,:,2]>=float(cap['menton_z']),'nape':(before[:,:,2]<float(cap['menton_z']))&(before[:,:,2]>=float(cap['menton_z'])-.06),'shoulder':before[:,:,2]<float(cap['menton_z'])-.06,'front':before[:,:,1]<float(cap['apex_y']),'back':before[:,:,1]>=float(cap['apex_y'])}
  return {'movedPoints':int(moved.sum()),'movedChildren':int(moved.any(axis=1).sum()),'maxMm':float(mm.max()),'p95MovedMm':float(np.percentile(mm[moved],95)) if moved.any() else 0,'byRegion':{k:int((moved&v).sum()) for k,v in regions.items()}}
 construction={'constructionRepair':attribution(sem,cfix),'finalRepair':attribution(pre_final,final),'reports':{'construction':creport,'final':freport},'reason':'old subset_blend adds full root y/z delta down each tail; only x fades'}
 density_ok=all(r['centerToNeighbours']>=.85 for r in density);guide_bad=max(r['gapMm'] for r in guide_rows)>15;shade_bad=density_ok and min(r['centerToNeighbours'] for r in luminance)<.85
 candidates={'densityHole':{'status':'REFUTED' if density_ok else 'SUPPORTED','minimumRatio':min(r['centerToNeighbours'] for r in density),'threshold':.85},'guideValley':{'status':'SUPPORTED' if guide_bad else 'REFUTED','maximumGapMm':max(r['gapMm'] for r in guide_rows),'thresholdMm':15},'shadingLobes':{'status':'SUPPORTED' if shade_bad else 'REFUTED','minimumLuminanceRatio':min(r['centerToNeighbours'] for r in luminance),'requiresDensityRatioAtLeast':.85}}
 supported=[k for k,v in candidates.items() if v['status']=='SUPPORTED'];conclusion=supported[0] if len(supported)==1 else (' + '.join(supported) if supported else 'UNKNOWN');pstatus='SUPPORTED'
 doc={'schemaVersion':1,'measurementOrder':'M1 before e-cell construction','seam':{'candidates':candidates,'conclusion':conclusion,'backIdDensity5mm':density,'guideCentrePair':guide_rows,'litVsFlat':{'flatProxy':'registered back ID mask (binary/unlit)','litLuminance':luminance}},'profileFold':{'status':pstatus,'configuredTransferStartSpreadMm':0.0,'observedDominantBendStdMm':tsum['stdMm'],'reason':'all front-side guides use the same menton-70mm transfer start; observed path curvature varies but configured start spread is zero','transferHeights':tsum,'targetVsOursBackEdgeSixHeights':edge_table(profile,target_profile,DEPTH_ROWS,pc,pppm)},'frontFlare':flare,'projection':construction}
 (E/'diagnosis.json').write_text(json.dumps(doc,indent=2)+'\n');print('DIAGNOSIS_DONE',json.dumps({'seam':conclusion,'profile':pstatus,'finalProjected':construction['finalRepair']},sort_keys=True))
if __name__=='__main__':main()
