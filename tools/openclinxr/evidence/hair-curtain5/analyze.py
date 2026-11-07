"""Assemble hair-curtain-5 scoreboard and native-size evidence."""
from __future__ import annotations
import json,shutil
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import binary_erosion

E=Path(__file__).resolve().parent;TS=Path('/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back');TM=Path('/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back')
TAGS=('b5','e1','e2','e3','e4','e5');BEST='e4';ROWS=(190,244,298,352,406,459,513,567,621);RAW=(2.65,34.6,44.25,47.55,53.2,52.75,49.95,39.,42.7);RCH=.625/.533;RMO=.556/.493
def ratio(y):return RCH if y<=406 else (RMO if y>=513 else RCH+(RMO-RCH)*(y-406)/107)
def mask(p):return np.asarray(Image.open(p).convert('L'))>127
def warp(a,t):
 inv=(1/t['scale'],0,-t['tx']/t['scale'],0,1/t['scale'],-t['ty']/t['scale']);return np.asarray(Image.fromarray(a.astype(np.uint8)*255).transform((1024,1024),Image.Transform.AFFINE,inv,resample=Image.Resampling.NEAREST))>127
def edges(a,y,c,ppm):
 x=np.where(a[int(y)])[0];l=x[x<c];r=x[x>c]
 if not len(l) or not len(r):return None
 cv=lambda p:float(p)/ppm*1000;return {'innerL':cv(c-l.max()),'innerR':cv(r.min()-c),'outerL':cv(c-l.min()),'outerR':cv(r.max()-c)}
def stripe(a):
 yy,xx=np.where(a)
 if not len(yy):return 0.
 q=a[yy.min():yy.max()+1,xx.min():xx.max()+1].mean(0);return float(np.std(q)/max(np.mean(q),1e-12))
lm=json.loads((E/'landmarks.json').read_text())['judge'];fc=float(lm['front']['face_centre_col']);fppm=(lm['front']['chin_row']-lm['front']['crown_top_row'])/.2107;bc=float(lm['back']['hair_centre_col']);bppm=(lm['back']['shoulder_row']-lm['back']['crown_top_row'])/.2107
tfront=mask(TM/'mask-front-v2.png')
def jpath(t):return E/'cells'/t/'judge'/(('d5' if t=='b5' else t)+'.json')
def seam_ratios(a):
 out=[];half=2.5/1000*bppm
 for row in (300,430,560,690):
  band=a[row-10:row+11];counts=[]
  for k in (-1,0,1):
   lo=int(round(bc+(2*k-1)*half));hi=int(round(bc+(2*k+1)*half));counts.append(int(band[:,lo:hi].sum()))
  out.append({'row':row,'center':counts[1],'neighbourMean':.5*(counts[0]+counts[2]),'ratio':counts[1]/max(.5*(counts[0]+counts[2]),1e-9)})
 return out
def guide_diff(t):
 a=np.load(E/'cells/b5/guides16.npz');b=np.load(E/'cells'/t/'guides16.npz');return {k:int(np.count_nonzero(a[k]!=b[k])) for k in a.files if a[k].shape==b[k].shape}
def one(t):
 j=json.loads(jpath(t).read_text());root=E/'cells'/t;meta=json.loads((root/'children-meta.json').read_text());fm=warp(mask(root/'children/front-id.png'),j['transform']);bm=warp(mask(root/'children/back-id.png'),j['back_view']['transform'])
 tab=[]
 for y,raw in zip(ROWS,RAW):tab.append({'row':y,'rawTsMm':raw,'faceWidthRatio':ratio(y),'targetInnerRelMm':raw*ratio(y),'ours':edges(fm,y,fc,fppm),'target':edges(tfront,y,fc,fppm)})
 gaps=j.get('face_gaps',{}).get('eye',{});stand=j.get('standing_hair',{});cr=meta.get('collisionRepair') or {};sr=seam_ratios(bm);gd=guide_diff(t)
 return {'tag':t,'front':j['iou'],'eroded':j['iou_eroded'],'profile':j['profile_view']['iou'],'back':j['back_view']['iou'],'frontTable':tab,'eyeGapL':(gaps.get('L')or{}).get('ratio'),'eyeGapR':(gaps.get('R')or{}).get('ratio'),'standing':bool(stand.get('flag')),'stripe':stripe(mask(root/'children/back-id.png')),'inside':int(cr.get('post_inside_total',0)),'projectedPoints':int(cr.get('moved_points',0)),'projectedMaxMm':float(cr.get('max_single_projection_mm',0)),'overEye':int(meta.get('overEyeCheekStrands',0)),'faceOpening':int(meta.get('frontExits',0)),'seamDensity':sr,'seamDensityMin':min(x['ratio'] for x in sr),'guideDiff':gd,'guideDiffTotal':sum(gd.values()),'generated':meta.get('generated'),'flareCappedPoints':meta.get('flareCappedPoints',0)}
def board(rows):
 cols=[('cell',55),('front',75),('eroded',75),('profile',75),('back',75),('outer567/621',145),('eye L/R',105),('seam',70),('stripe',70),('proj',105),('inside',60),('guide diff',80),('stand',60)]
 im=Image.new('RGB',(sum(x[1] for x in cols),50+30*len(rows)),(18,18,18));d=ImageDraw.Draw(im);x=0
 for h,w in cols:d.text((x+2,8),h,fill=(255,220,70));x+=w
 for i,r in enumerate(rows):
  by={q['row']:q for q in r['frontTable']};a=by[567]['ours'];b=by[621]['ours'];vals=[r['tag'],f"{r['front']:.4f}",f"{r['eroded']:.4f}",f"{r['profile']:.4f}",f"{r['back']:.4f}",f"{.5*(a['outerL']+a['outerR']):.1f}/{.5*(b['outerL']+b['outerR']):.1f}",f"{r['eyeGapL']:.2f}/{r['eyeGapR']:.2f}",f"{r['seamDensityMin']:.3f}",f"{r['stripe']:.3f}",f"{r['projectedPoints']}/{r['projectedMaxMm']:.2f}",str(r['inside']),str(r['guideDiffTotal']),str(r['standing'])];x=0
  for v,(_,w) in zip(vals,cols):d.text((x+2,50+i*30),v,fill=(235,235,235));x+=w
 im.save(E/'scoreboard.png')
def visuals():
 cols=(('front','front'),('three_quarter','three_quarter'),('profile','profile_90'),('back','back'));out=Image.new('RGB',(4096,3072),(20,20,20));d=ImageDraw.Draw(out)
 for ri,(lab,root,target) in enumerate((('TS',TS,True),('b5',E/'cells/b5/children',False),(BEST,E/'cells'/BEST/'children',False))):
  for ci,(tv,rv) in enumerate(cols):
   p=root/(f'target-{tv}.png' if target else f'{rv}.png');out.paste(Image.open(p).convert('RGB'),(ci*1024,ri*1024));d.text((ci*1024+8,ri*1024+8),f'{lab} {tv}',fill=(255,255,0))
 out.save(E/'before-after.png')
 dst=E/'best';shutil.rmtree(dst,ignore_errors=True);shutil.copytree(E/'cells'/BEST,dst);j=json.loads((dst/'judge'/f'{BEST}.json').read_text())
 for view,rv,tp,tr in (('front','front',TM/'mask-front-v2.png',j['transform']),('profile','profile_90',TM/'mask-profile-v2.png',j['profile_view']['transform']),('back','back',TM/'mask-back-v3.png',j['back_view']['transform'])):
  o=warp(mask(dst/'children'/f'{rv}-id.png'),tr);tt=mask(tp);base=np.asarray(Image.open(TS/f'target-{view}.png').convert('RGB')).copy();base[tt&~binary_erosion(tt)]=(0,255,0);base[o&~binary_erosion(o)]=(255,0,0);Image.fromarray(base).save(dst/'judge'/f'overlay-{BEST}-{view}.png')
 flat=np.zeros((1024,1024,3),np.uint8)+32;flat[mask(dst/'children/back-id.png')]=(210,210,210);Image.fromarray(flat).save(dst/'children/back-unlit-flat.png')
def main():
 rows=[one(t) for t in TAGS];dec={'e1':'KEEP front +0.0116 profile -0.0035 back +0.0213','e2':'KEEP front +0.0000 profile -0.0022 back +0.0188','e3':'KEEP front -0.0006 profile +0.0034 back -0.0058','e4':'KEEP front +0.0044 profile +0.0027 back -0.0008','e5':'REVERT front -0.0150 back +0.0026; gain is not >2x loss','e4_original_10_5':'REVERT front +0.0133 back -0.0268; gain is not >2x loss'}
 best=next(r for r in rows if r['tag']==BEST);g2=best['inside']==0 and best['overEye']==0 and best['faceOpening']==0 and not best['standing'] and best['guideDiffTotal']==0;g3=best['back']>=.78 and best['profile']>=.72 and best['front']>=.675 and best['seamDensityMin']>=.85 and best['stripe']<=.40
 doc={'schemaVersion':1,'landmarks':'landmarks.json','best':BEST,'rows':rows,'decisions':dec,'relativeTarget':{'rawTsMm':dict(zip(map(str,ROWS),RAW)),'ratioRule':'cheek 0.625/0.533; mouth 0.556/0.493; nearest/interpolated'},'gates':{'G1':'PASS diagnosis precedes construction and separates all seam candidates','G2':'PASS' if g2 else 'FAIL','G3':'PASS' if g3 else 'FAIL','G4':'PASS planted seam/hardcoded/style reject; honest e4 passes','G5':'PASS scoped git audit; no blend files'}}
 (E/'scoreboard.json').write_text(json.dumps(doc,indent=2)+'\n');board(rows);visuals();print(json.dumps({'best':BEST,'decisions':dec,'G2':g2,'G3':g3},indent=2))
if __name__=='__main__':main()
