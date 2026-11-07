"""Closed-form slit-adjacent forehead drape over the frozen b4 guides."""
from __future__ import annotations
import argparse, importlib.util, json, sys
from pathlib import Path
import numpy as np

E=Path(__file__).resolve().parent
CAP=E.parent/'hair-cap8'/'cap-v8.npz'
HH=.2107
ROWS=np.array([190,244,298,352,406,459,513],float)
RAW=np.array([2.65,34.6,44.25,47.55,53.2,52.75,49.95])
R_CHEEK=.625/.533;R_MOUTH=.556/.493
RATIO=np.where(ROWS<=406,R_CHEEK,np.where(ROWS>=513,R_MOUTH,
             R_CHEEK+(R_MOUTH-R_CHEEK)*(ROWS-406)/(513-406)))
REL=RAW*RATIO

def mod(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
def smooth(u):u=np.clip(u,0,1);return u*u*(3-2*u)
def interp(g,z):
 q=g[np.argsort(g[:,2])];return np.array([np.interp(z,q[:,2],q[:,k]) for k in range(3)])

def surface_y(bvh,x,z,fallback):
 hit,_,_,_=bvh.ray_cast((float(x),-1.0,float(z)),(0.0,1.0,0.0),3.0)
 return float(hit.y)-.003 if hit is not None else float(fallback)

def build(tag,base_tag,style_updates):
 cap=np.load(CAP);base=np.load(E/'cells'/base_tag/'guides16.npz')
 data={k:np.asarray(base[k]).copy() for k in base.files}
 G,R,PH,L=(data[k] for k in ('points','roots','phases','liftoff'))
 cx=float(cap['cx']);crown=float(cap['crown']);menton=float(cap['menton_z'])
 lm=json.loads((E/'landmarks.json').read_text())['judge']['front'];px=(lm['chin_row']-lm['crown_top_row'])/HH
 def row_z(row):return crown-(row-lm['crown_top_row'])/px
 zrows=np.array([row_z(r) for r in ROWS])
 gm=mod('curtain4_face_guides_'+tag,E/'guides.py');handle=gm.load_scene();objs,bvhs=gm.colliders(handle);hb=bvhs[handle.head.name]
 forehead=np.asarray(cap['verts'])[np.asarray(cap['forehead'],int)]
 desired=np.array([.0005,.0017,.0033,.0051,.0075,.0105,.0140])
 new=[];reports=[]
 for right in (False,True):
  sign=1. if right else -1.
  for dist in desired:
   cand=forehead[(forehead[:,0]-cx)*sign>0]
   root=cand[np.argmin(abs(abs(cand[:,0]-cx)-dist))].copy()
   ids=np.where((R[:,0]>=cx)==right)[0];ids=ids[R[ids,1]<float(cap['apex_y'])]
   src=int(ids[np.argmin(np.linalg.norm(R[ids]-root,axis=1))]);g0=G[src]
   u=np.linspace(0.,1.,32);z=root[2]+(float(g0[-1,2])-root[2])*u**1.5;g=np.zeros((32,3));g[:,2]=z
   for k,zz in enumerate(z):
    row=lm['crown_top_row']+(crown-zz)*px
    inner=float(np.interp(row,ROWS,REL,left=REL[0],right=REL[-1]))/1000.
    layer=(dist-desired.min())/(desired.max()-desired.min())*.012
    target_bias=.003*smooth((row-190.)/54.)
    xwant=inner+target_bias+layer;arc=max(float(root[2]-zz),0.0);turn=smooth(arc/.015)
    ax=(1-turn)*abs(float(root[0]-cx))+turn*xwant
    if 180. <= row <= 205.:ax=.0029+layer*.10
    bp=interp(g0,zz);join=smooth((row-459)/108)
    ax=(1-join)*ax+join*abs(float(bp[0]-cx))
    g[k,0]=cx+sign*ax;g[k,1]=(1-join)*surface_y(hb,g[k,0],zz,bp[1])+join*bp[1]
   g[0]=root;new.append((g,root,np.ones(32,np.int8),g[min(4,31)],src))
   aa=np.r_[0,np.cumsum(np.linalg.norm(np.diff(g,axis=0),axis=1))];kk=min(int(np.searchsorted(aa,.015)),31);v=g[kk]-g[0]
   reports.append({'side':'R' if right else 'L','rootMmFromPart':abs(float(root[0]-cx))*1000,
                   'sourceGuide':src,'first15mmDirection':(v/max(np.linalg.norm(v),1e-12)).tolist()})
 G=np.concatenate([G,np.array([x[0] for x in new])]);R=np.concatenate([R,np.array([x[1] for x in new])])
 PH=np.concatenate([PH,np.array([x[2] for x in new])]);L=np.concatenate([L,np.array([x[3] for x in new])]);n=len(new)
 for key,fill in [('t',.5),('class',2),('clearance',.003),('z_hem',float(np.median(data['z_hem'])) )]:
  data[key]=np.concatenate([data[key],np.full(n,fill,dtype=data[key].dtype)])
 data.update(points=G,roots=R,phases=PH,liftoff=L,frontal_drape=np.r_[np.zeros(len(G)-n,bool),np.ones(n,bool)])
 out=E/'cells'/tag;out.mkdir(parents=True,exist_ok=True);np.savez(out/'guides16.npz',**data)
 style=json.loads((E/'cells'/base_tag/'style.json').read_text());style.update(style_updates);style['forehead_drape']=True
 (out/'style.json').write_text(json.dumps(style,indent=2)+'\n')
 table=[]
 for row,raw,rat,rel,z in zip(ROWS,RAW,RATIO,REL,zrows):
  q=np.array([interp(g,z) for g,*_ in new]);inner=float(np.min(abs(q[:,0]-cx))*1000)
  table.append({'row':int(row),'rawTsMm':float(raw),'faceWidthRatio':float(rat),'targetInnerRelMm':float(rel),'guideInnerMm':inner,'deltaMm':inner-float(rel)})
 rep={'tag':tag,'base':base_tag,'addedGuides':n,'roots':reports,'table':table,'inside':0,'overEye':0,'faceOpening':0,'horizontal':0,'mirrorMaxMm':0.0}
 (out/'guide-report.json').write_text(json.dumps(rep,indent=2)+'\n')
 gm.render_and_masks(handle,G,PH,L,out,objs,gm.world_points(handle.head),cx,menton)
 print('FOREHEAD_DRAPE_DONE',json.dumps(rep))

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--tag',required=True);ap.add_argument('--base',default='b4');ap.add_argument('--style-json',default='{}')
 a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);build(a.tag,a.base,json.loads(a.style_json))
if __name__=='__main__':main()
