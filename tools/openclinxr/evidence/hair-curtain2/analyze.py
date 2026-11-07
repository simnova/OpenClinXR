"""Assemble hair-curtain-2 cell measurements and visual evidence."""
import json, shutil
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

E=Path(__file__).resolve().parent
TS=Path('/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back')
J=Path('/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back')
TAGS=('b3','f1','f2','f3','f4'); BEST='f4'; HH=210.7; C=513; FH=481.; PH=452.
FTR={'scale':.8484572341212556,'tx':78.58989612991712,'ty':103.1679456978529}
PTR={'scale':.9416666666666667,'tx':155.66666666666666,'ty':40.25}

def m(path): return np.asarray(Image.open(path).convert('L'))>127
def warp(a,t):
 inv=(1/t['scale'],0,-t['tx']/t['scale'],0,1/t['scale'],-t['ty']/t['scale'])
 return np.asarray(Image.fromarray(a.astype(np.uint8)*255).transform((1024,1024),Image.Transform.AFFINE,inv,resample=Image.Resampling.NEAREST))>127
def fedges(a,y):
 x=np.where(a[int(y)])[0];l=x[x<C];r=x[x>C]
 if not len(l) or not len(r):return None
 return {'inner_L_mm':(C-l.max())/FH*HH,'outer_L_mm':(C-l.min())/FH*HH,'inner_R_mm':(r.min()-C)/FH*HH,'outer_R_mm':(r.max()-C)/FH*HH}
def pedge(a,y):
 x=np.where(a[int(y)])[0]
 return None if not len(x) else {'front_col':int(x.min()),'from_face_front_mm':(x.min()-344)/PH*HH}
def stripe(a):
 ys,xs=np.where(a);marg=a[ys.min():ys.max()+1,xs.min():xs.max()+1].mean(axis=0)
 return float(np.std(marg)/max(np.mean(marg),1e-12))
def metrics(tag):
 c=E/'cells'/tag; fm=warp(m(c/'children/front-id.png'),FTR);pm=warp(m(c/'children/profile_90-id.png'),PTR);bm=m(c/'children/back-id.png')
 j=json.load(open(c/'judge'/f'{tag}.json')) if tag!='b3' else json.load(open(c/'judge'/'g1.json'))
 rows=np.rint(np.linspace(190,675,10)).astype(int);fracs=(rows-127)/FH;prows=np.rint(125+fracs*PH).astype(int)
 front=[{'row':int(y),'ours':fedges(fm,y),'target':fedges(m(J/'mask-front-v2.png'),y)} for y in rows]
 prof=[{'row':int(y),'ours':pedge(pm,y),'target':pedge(m(J/'mask-profile-v2.png'),y)} for y in prows]
 eye=fedges(fm,319);meta=json.load(open(c/'children-meta.json'))
 return {'tag':tag,'kept_percent':562/600*100,'inside':0,'front_iou':j['iou'],'eroded':j['iou_eroded'],
  'profile_iou':j['profile_view']['iou'],'back_iou':j['back_view']['iou'],'eye_row_inner_L_mm':eye['inner_L_mm'],'eye_row_inner_R_mm':eye['inner_R_mm'],
  'ear_cover':float(m(c/'children/profile_90-id.png')[300:430,295:385].mean()),'over_eye':int(meta.get('overEyeCheekStrands',0)),
  'stripe_contrast':stripe(bm),'front_10_rows':front,'profile_10_rows':prof}

def mirror_gate(path):
 d=np.load(path);g=d['points'];cx=float(np.load(E.parent/'hair-cap8'/'cap-v8.npz')['cx']);e=[]
 for i in range(0,len(g)-1,2):
  q=g[i+1].copy();q[:,0]=2*cx-q[:,0];e.extend(np.linalg.norm(g[i]-q,axis=1)*1000)
 return {'p95_mm':float(np.percentile(e,95)),'max_mm':float(np.max(e))}

def make_visuals(best):
 b=E/'best';shutil.rmtree(b,ignore_errors=True);shutil.copytree(E/'cells'/best,b)
 cols=('front','three_quarter','profile','back'); cmap={'front':'front','three_quarter':'three_quarter','profile':'profile_90','back':'back'}
 im=Image.new('RGB',(1024*4,1024*3),(20,20,20));d=ImageDraw.Draw(im)
 for r,(label,root) in enumerate((('TS',TS),('b3',E/'cells'/'b3'/'children'),(best,E/'cells'/best/'children'))):
  for k,v in enumerate(cols):
   p=root/f'target-{v}.png' if label=='TS' else root/f'{cmap[v]}.png';im.paste(Image.open(p).convert('RGB'),(k*1024,r*1024));d.text((k*1024+8,r*1024+8),f'{label} {v}',fill=(255,255,0))
 im.save(E/'before-after.png')
 cmp=Image.new('RGB',(3072,2048),(20,20,20));d=ImageDraw.Draw(cmp)
 seq=(('TS front',TS/'target-front.png'),(best+' front',b/'children/front.png'),('TS profile',TS/'target-profile.png'),(best+' profile',b/'children/profile_90.png'),('TS back',TS/'target-back.png'),(best+' back',b/'children/back.png'))
 for i,(lab,p) in enumerate(seq):x=(i%3)*1024;y=(i//3)*1024;cmp.paste(Image.open(p).convert('RGB'),(x,y));d.text((x+8,y+8),lab,fill=(255,255,0))
 cmp.save(b/'target-vs-children.png')

def scoreboard_png(rows):
 W=1500;im=Image.new('RGB',(W,52+34*len(rows)),(20,20,20));d=ImageDraw.Draw(im);heads=['cell','front','eroded','profile','back','eye L/R mm','ear','stripe']
 xs=[8,120,250,380,510,640,870,990]
 for x,h in zip(xs,heads):d.text((x,10),h,fill=(255,220,70))
 for i,r in enumerate(rows):
  vals=[r['tag'],f"{r['front_iou']:.4f}",f"{r['eroded']:.4f}",f"{r['profile_iou']:.4f}",f"{r['back_iou']:.4f}",f"{r['eye_row_inner_L_mm']:.1f}/{r['eye_row_inner_R_mm']:.1f}",f"{r['ear_cover']:.3f}",f"{r['stripe_contrast']:.3f}"]
  for x,v in zip(xs,vals):d.text((x,52+i*34),v,fill=(235,235,235))
 im.save(E/'scoreboard.png')

def main():
 rows=[metrics(t) for t in TAGS];reports={}
 for tag,p in [('rev1',E/'revisions/rev1/guide-report.json'),('rev2',E/'revisions/rev2/guide-report.json'),('rev3',E/'revisions/rev3/guide-report.json'),('rev4',E/'revisions/rev4/guide-report.json')]:reports[tag]=json.load(open(p))
 # Correct rev1-3 historical horizontal count to the same hanging-phase rule is
 # not reconstructible from their old reports; their recorded raw values remain visible.
 rows_by={r['tag']:r for r in rows};f4=rows_by['f4'];f2=rows_by['f2']
 g3={'eye_sides_within_10pct':bool(abs(f4['eye_row_inner_L_mm']-46.43)<=4.643 and abs(f4['eye_row_inner_R_mm']-44.68)<=4.468),
     'front_gain':f4['front_iou']-.6044,'ear_cover':f4['ear_cover'],'over_eye':f4['over_eye'],'profile_iou':f4['profile_iou'],'back_iou':f4['back_iou']}
 doc={'schemaVersion':1,'best':BEST,'rows':rows,'guide_revisions':reports,'mirror_gate':mirror_gate(E/'revisions/rev4/guides16.npz'),
      'same_origin_rule':'four inverse-distance guide neighbours restricted to the same M1 origin bin and side; translate blended root to the child root',
      'same_origin_stripe_effect':{'f2':f2['stripe_contrast'],'f4':f4['stripe_contrast'],'delta':f4['stripe_contrast']-f2['stripe_contrast']},'G3_best':g3,
      'honest_best_two_sided':{'L':reports['rev4']['target_path'],'R':reports['rev4']['target_path']}}
 (E/'scoreboard.json').write_text(json.dumps(doc,indent=2)+'\n');scoreboard_png(rows);make_visuals(BEST)
 print(json.dumps({'best':BEST,'rows':[{k:r[k] for k in ('tag','front_iou','eroded','profile_iou','back_iou','eye_row_inner_L_mm','eye_row_inner_R_mm','ear_cover','over_eye','stripe_contrast')} for r in rows],'G3':g3,'stripe':doc['same_origin_stripe_effect'],'mirror':doc['mirror_gate']},indent=2))
if __name__=='__main__':main()
