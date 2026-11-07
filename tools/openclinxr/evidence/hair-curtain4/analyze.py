"""Assemble hair-curtain-4 tables and native-size visual evidence."""
from __future__ import annotations
import json,shutil
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import binary_erosion

E=Path(__file__).resolve().parent
TS=Path('/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back')
TM=Path('/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back')
TAGS=('b4','d1','d2','d3','d4','d4r2','d5','d6');BEST='d5';HH=210.7
ROWS=(190,244,298,352,406,459,513,567,621);RAW=(2.65,34.6,44.25,47.55,53.2,52.75,49.95,39.0,42.7)
RCH=.625/.533;RMO=.556/.493
def ratio(y):return RCH if y<=406 else (RMO if y>=513 else RCH+(RMO-RCH)*(y-406)/107)
def mask(p):return np.asarray(Image.open(p).convert('L'))>127
def warp(a,t):
 inv=(1/t['scale'],0,-t['tx']/t['scale'],0,1/t['scale'],-t['ty']/t['scale'])
 return np.asarray(Image.fromarray(a.astype(np.uint8)*255).transform((1024,1024),Image.Transform.AFFINE,inv,resample=Image.Resampling.NEAREST))>127
def edges(a,y,c,ppm):
 x=np.where(a[int(y)])[0];l=x[x<c];r=x[x>c]
 if not len(l) or not len(r):return None
 cv=lambda p:float(p)/ppm*1000
 return {'innerL':cv(c-l.max()),'innerR':cv(r.min()-c),'outerL':cv(c-l.min()),'outerR':cv(r.max()-c)}
def stripe(a):
 yy,xx=np.where(a)
 if not len(yy):return 0.
 q=a[yy.min():yy.max()+1,xx.min():xx.max()+1].mean(0);return float(np.std(q)/max(np.mean(q),1e-12))
def judge_path(t):return E/'cells'/t/'judge'/(('c6' if t=='b4' else t)+'.json')

lm=json.loads((E/'landmarks.json').read_text())['judge'];fc=float(lm['front']['face_centre_col']);fppm=(lm['front']['chin_row']-lm['front']['crown_top_row'])/.2107
tfront=mask(TM/'mask-front-v2.png');tprof=mask(TM/'mask-profile-v2.png');tback=mask(TM/'mask-back-v3.png')

def depth_table(a,target,rows,c,ppm,back_edge=True):
 out=[]
 for y in rows:
  xo=np.where(a[y])[0];xt=np.where(target[y])[0]
  if not len(xo) or not len(xt):continue
  if back_edge:ov=float(xo.max()-c)/ppm*1000;tv=float(xt.max()-c)/ppm*1000
  else:ov=float(max(abs(xo-c)))/ppm*1000;tv=float(max(abs(xt-c)))/ppm*1000
  out.append({'row':int(y),'oursMm':ov,'targetMm':tv,'deltaMm':ov-tv})
 return out

def one(t):
 j=json.loads(judge_path(t).read_text());c=E/'cells'/t;meta=json.loads((c/'children-meta.json').read_text())
 fm=warp(mask(c/'children/front-id.png'),j['transform']);pm=warp(mask(c/'children/profile_90-id.png'),j['profile_view']['transform']);bm=warp(mask(c/'children/back-id.png'),j['back_view']['transform'])
 tab=[]
 for y,raw in zip(ROWS,RAW):
  r=ratio(y);tab.append({'row':y,'rawTsMm':raw,'faceWidthRatio':r,'targetInnerRelMm':raw*r,'ours':edges(fm,y,fc,fppm),'target':edges(tfront,y,fc,fppm)})
 gaps=j.get('face_gaps',{}).get('eye',{});standing=j.get('standing_hair',{});cr=meta.get('collisionRepair') or {}
 pppm=(lm['profile']['chin_row']-lm['profile']['crown_top_row'])/.2107;bppm=(lm['back']['shoulder_row']-lm['back']['crown_top_row'])/.2107
 return {'tag':t,'front':j['iou'],'eroded':j['iou_eroded'],'width_rms_head':j['width_rms_head'],'profile':j['profile_view']['iou'],'back':j['back_view']['iou'],
  'frontTable':tab,'eyeGapL':(gaps.get('L')or{}).get('ratio'),'eyeGapR':(gaps.get('R')or{}).get('ratio'),
  'earCover':float(mask(c/'children/profile_90-id.png')[300:430,295:385].mean()),'standing':bool(standing.get('flag')),
  'stripe':stripe(mask(c/'children/back-id.png')),'inside':int(cr.get('post_inside_total',0)),'projectedPoints':int(cr.get('moved_points',0)),'projectedMaxMm':float(cr.get('max_single_projection_mm',0)),
  'overEye':int(meta.get('overEyeCheekStrands',0)),'faceOpening':int(meta.get('frontExits',0)),'backSeamCount':int(meta.get('backSeamCount',0)),
  'profileDepth':depth_table(pm,tprof,(250,340,430,520,610,700),float(lm['profile']['forehead_front_col']),pppm,True),
  'backWidth':depth_table(bm,tback,(250,340,430,520,610,700),float(lm['back']['hair_centre_col']),bppm,False)}

def visuals():
 best=E/'cells'/BEST/'children';b4=E/'cells/b4/children';f4=E/'baselines/f4/children';cols=(('front','front'),('three_quarter','three_quarter'),('profile','profile_90'),('back','back'))
 out=Image.new('RGB',(4096,4096),(20,20,20));d=ImageDraw.Draw(out)
 for ri,(lab,root,target) in enumerate((('TS',TS,True),('f4',f4,False),('c6/b4',b4,False),(BEST,best,False))):
  for ci,(tv,rv) in enumerate(cols):
   p=root/(f'target-{tv}.png' if target else f'{rv}.png');out.paste(Image.open(p).convert('RGB'),(ci*1024,ri*1024));d.text((ci*1024+8,ri*1024+8),f'{lab} {tv}',fill=(255,255,0))
 out.save(E/'before-after.png')
 dst=E/'best';shutil.rmtree(dst,ignore_errors=True);shutil.copytree(E/'cells'/BEST,dst)
 j=json.loads((dst/'judge'/f'{BEST}.json').read_text())
 specs=(('front','front',TM/'mask-front-v2.png',j['transform']),('profile','profile_90',TM/'mask-profile-v2.png',j['profile_view']['transform']),('back','back',TM/'mask-back-v3.png',j['back_view']['transform']))
 for view,rv,tp,tr in specs:
  o=warp(mask(best/f'{rv}-id.png'),tr);tt=mask(tp);base=np.asarray(Image.open(TS/f'target-{view}.png').convert('RGB')).copy();base[tt&~binary_erosion(tt)]=(0,255,0);base[o&~binary_erosion(o)]=(255,0,0);Image.fromarray(base).save(dst/'judge'/f'overlay-{BEST}-{view}.png')
 shutil.copy2(E/'cells/d1/guides16_front.png',E/'guides-debug.png')

def board(rows):
 cols=[('cell',70),('front',85),('eroded',85),('width',85),('profile',85),('back',85),('in244',80),('in298',80),('out567',90),('out621',90),('eye L/R',100),('ear',70),('proj',110),('stripe',70),('stand',65)]
 im=Image.new('RGB',(sum(x[1] for x in cols),50+30*len(rows)),(18,18,18));d=ImageDraw.Draw(im);x=0
 for h,w in cols:d.text((x+2,8),h,fill=(255,220,70));x+=w
 for i,r in enumerate(rows):
  by={q['row']:q for q in r['frontTable']};e244=by[244]['ours'];e298=by[298]['ours'];e567=by[567]['ours'];e621=by[621]['ours']
  vals=[r['tag'],f"{r['front']:.4f}",f"{r['eroded']:.4f}",f"{r['width_rms_head']:.4f}",f"{r['profile']:.4f}",f"{r['back']:.4f}",f"{e244['innerL']:.1f}",f"{e298['innerL']:.1f}",f"{e567['outerL']:.1f}/{e567['outerR']:.1f}",f"{e621['outerL']:.1f}/{e621['outerR']:.1f}",f"{r['eyeGapL']:.2f}/{r['eyeGapR']:.2f}",f"{r['earCover']:.3f}",f"{r['projectedPoints']}/{r['projectedMaxMm']:.1f}",f"{r['stripe']:.3f}",str(r['standing'])]
  x=0
  for v,(_,w) in zip(vals,cols):d.text((x+2,50+i*30),v,fill=(235,235,235));x+=w
 im.save(E/'scoreboard.png')

def main():
 rows=[one(t) for t in TAGS];dec={'d1':'KEEP +0.0969 front','d2':'KEEP; all view regressions <0.01, projection improved','d3':'REVERT seam count worsened 4285->4297','d4':'REVERT profile/back regression','d4r2':'REVERT back regression','d5':'KEEP profile/back improved','d6':'REVERT back regression'}
 doc={'schemaVersion':1,'landmarks':'landmarks.json','best':BEST,'rows':rows,'decisions':dec,'relativeTarget':{'rawTsMm':dict(zip(map(str,ROWS),RAW)),'ratioRule':'cheek 0.625/0.533; mouth 0.556/0.493; nearest/interpolated'},'gates':{'G2':'PASS','G3':'FAIL profile/back gain and projection report','G4':'PASS planted eye/floating/hardcoded/style rejects; honest d1 passes','G5':'PASS'}}
 (E/'scoreboard.json').write_text(json.dumps(doc,indent=2)+'\n');board(rows);visuals();print(json.dumps({'best':BEST,'decisions':dec},indent=2))
if __name__=='__main__':main()
