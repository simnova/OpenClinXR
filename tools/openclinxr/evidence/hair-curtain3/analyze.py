"""Assemble corrected-landmark metrics and visual evidence."""
from __future__ import annotations
import hashlib,json,shutil
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import binary_erosion

E=Path(__file__).resolve().parent
TS=Path('/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back')
TM=Path('/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back')
TAGS=('c0','c1','c2','c3','c4','c5','c6');BEST='c1';HH=210.7;C=513;FH=481.

def mask(path):return np.asarray(Image.open(path).convert('L'))>127
def warp(a,t):
 inv=(1/t['scale'],0,-t['tx']/t['scale'],0,1/t['scale'],-t['ty']/t['scale'])
 return np.asarray(Image.fromarray(a.astype(np.uint8)*255).transform((1024,1024),Image.Transform.AFFINE,inv,resample=Image.Resampling.NEAREST))>127
def edges(a,y):
 x=np.where(a[int(y)])[0];l=x[x<C];r=x[x>C]
 if not len(l) or not len(r):return None
 cv=lambda p:p/FH*HH
 return {'inner_L_mm':cv(C-l.max()),'outer_L_mm':cv(C-l.min()),'inner_R_mm':cv(r.min()-C),'outer_R_mm':cv(r.max()-C)}
def stripe(a):
 ys,xs=np.where(a)
 if not len(ys):return 0.
 q=a[ys.min():ys.max()+1,xs.min():xs.max()+1].mean(axis=0)
 return float(np.std(q)/max(np.mean(q),1e-12))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def row(tag):
 c=E/'cells'/tag;j=json.loads((c/'judge'/f'{tag}.json').read_text());meta=json.loads((c/'children-meta.json').read_text())
 fm=warp(mask(c/'children/front-id.png'),j['transform']);eye=edges(fm,319)
 rows=np.rint(np.linspace(190,675,10)).astype(int);target=mask(TM/'mask-front-v2.png')
 table=[{'row':int(y),'ours':edges(fm,y),'target':edges(target,y)} for y in rows]
 gaps=j.get('face_gaps',{}).get('eye',{});standing=j.get('standing_hair',{})
 base=json.loads((E/'cells/c0/style.json').read_text());style=json.loads((c/'style.json').read_text())
 return {'tag':tag,'diff':{k:v for k,v in style.items() if base.get(k)!=v},
  'front_iou':j['iou'],'eroded':j['iou_eroded'],'width_rms_head':j['width_rms_head'],'profile':j['profile_view']['iou'],'back':j['back_view']['iou'],
  'eye':eye,'eye_gap_ratio_L':(gaps.get('L')or{}).get('ratio'),'eye_gap_ratio_R':(gaps.get('R')or{}).get('ratio'),
  'ear_cover':float(mask(c/'children/profile_90-id.png')[300:430,295:385].mean()),'stripe_contrast':stripe(mask(c/'children/back-id.png')),
  'standing':bool(standing.get('flag')),'standing_excess_px':standing.get('excess_px'),'id_show':(j.get('id_show_through')or{}).get('fraction'),
  'front_table':table,'inside':int(((meta.get('collisionRepair')or{}).get('post_inside_total',0))),
  'collision_repair':meta.get('collisionRepair'),'over_eye':int(meta.get('overEyeCheekStrands',0)),'face_opening':int(meta.get('frontExits',0)),
  'curtain_guides':meta.get('curtainGuides',0),'curtain_children':meta.get('curtainChildren',0),'blend_children':meta.get('blendBandChildren',0),
  'smooth':meta.get('smoothMeta')}

def image_sheet(rows):
 best=E/'cells'/BEST/'children';f4=E/'baselines/f4/children';cols=(('front','front'),('three_quarter','three_quarter'),('profile','profile_90'),('back','back'))
 im=Image.new('RGB',(4096,3072),(20,20,20));d=ImageDraw.Draw(im)
 for ri,(lab,root,is_target) in enumerate((('TS',TS,True),('f4',f4,False),(BEST,best,False))):
  for ci,(tv,rv) in enumerate(cols):
   p=root/(f'target-{tv}.png' if is_target else f'{rv}.png');im.paste(Image.open(p).convert('RGB'),(ci*1024,ri*1024));d.text((ci*1024+8,ri*1024+8),f'{lab} {tv}',fill=(255,255,0))
 im.save(E/'before-after.png')
 b=E/'best';shutil.rmtree(b,ignore_errors=True);shutil.copytree(E/'cells'/BEST,b)
 j=json.loads((b/'judge'/f'{BEST}.json').read_text())
 def side_overlay(view,render_name,target_mask,transform):
  ours=warp(mask(best/(render_name+'-id.png')),transform);tgt=mask(target_mask);base=np.asarray(Image.open(TS/f'target-{view}.png').convert('RGB')).copy();base[tgt&~binary_erosion(tgt)]=(0,255,0);base[ours&~binary_erosion(ours)]=(255,0,0);p=b/'judge'/f'overlay-{BEST}-{view}.png';Image.fromarray(base).save(p);return p
 prof=side_overlay('profile','profile_90',TM/'mask-profile-v2.png',j['profile_view']['transform']);backov=side_overlay('back','back',TM/'mask-back-v3.png',j['back_view']['transform'])
 panels=[('TS front',TS/'target-front.png'),(BEST+' front',best/'front.png'),('front overlay',b/'judge'/f'overlay-{BEST}.png'),('TS profile',TS/'target-profile.png'),(BEST+' profile',best/'profile_90.png'),('profile overlay',prof),('TS back',TS/'target-back.png'),(BEST+' back',best/'back.png'),('back overlay',backov)]
 out=Image.new('RGB',(3072,3072),(20,20,20));d=ImageDraw.Draw(out)
 for i,(lab,p) in enumerate(panels):
  q=Image.open(p).convert('RGB').resize((1024,1024));x=(i%3)*1024;y=(i//3)*1024;out.paste(q,(x,y));d.text((x+8,y+8),lab,fill=(255,255,0))
 out.save(b/'target-vs-children.png')
 crown=Image.open(best/'crown_top.png').convert('RGB');crown.crop((260,250,765,755)).resize((1010,1010),Image.Resampling.LANCZOS).save(E/'m5-normal-closeup.png')

def scoreboard_png(rows):
 cols=[('cell',70),('front',90),('eroded',90),('width',90),('profile',90),('back',90),('inner L/R',155),('outer L/R',155),('ear',80),('stripe',80),('standing',80)]
 im=Image.new('RGB',(sum(w for _,w in cols),52+32*len(rows)),(20,20,20));d=ImageDraw.Draw(im);x=0
 for h,w in cols:d.text((x+3,8),h,fill=(255,220,70));x+=w
 for i,r in enumerate(rows):
  e=r['eye'];vals=[r['tag'],f"{r['front_iou']:.4f}",f"{r['eroded']:.4f}",f"{r['width_rms_head']:.4f}",f"{r['profile']:.4f}",f"{r['back']:.4f}",f"{e['inner_L_mm']:.1f}/{e['inner_R_mm']:.1f}",f"{e['outer_L_mm']:.1f}/{e['outer_R_mm']:.1f}",f"{r['ear_cover']:.3f}",f"{r['stripe_contrast']:.3f}",str(r['standing'])];x=0
  for val,(_,w) in zip(vals,cols):d.text((x+3,52+i*32),val,fill=(235,235,235));x+=w
 im.save(E/'scoreboard.png')

def main():
 rows=[row(t) for t in TAGS];rev=E/'revisions/rev4/guides16.npz';hashes={t:sha(E/'cells'/t/'guides16.npz') for t in TAGS}
 a=np.load(E/'cells/c1/children-analysis.npz');audit={'guideMask':a['curtain_guides'].astype(bool).tolist(),'curtainRegion':a['curtain_region'].astype(bool).tolist(),'weight':a['curtain_weight'].astype(float).tolist(),'parents':a['curtain_parents'].astype(int).tolist()};(E/'parent-audit.json').write_text(json.dumps(audit,separators=(',',':'))+'\n')
 g=np.load(rev)['points'];seg=np.linalg.norm(np.diff(g,axis=1),axis=2)*1000;tan=np.diff(g,axis=1);tan/=np.maximum(np.linalg.norm(tan,axis=2,keepdims=True),1e-12);ang=np.degrees(np.arccos(np.clip((tan[:,:-1]*tan[:,1:]).sum(2),-1,1)))
 facet={'guide_segment_median_mm':float(np.median(seg)),'guide_segment_p10_p90_mm':[float(x) for x in np.percentile(seg,[10,90])],'segments_2_4mm_fraction':float(np.mean((seg>=2)&(seg<=4))),'adjacent_turn_gt10deg_fraction':float(np.mean(ang>10)),'blend_band_children':next(r for r in rows if r['tag']==BEST)['blend_children'],'verdict':'polyline curvature (not literal 3mm steps); c6 required','c6_smoothing':next(r for r in rows if r['tag']=='c6')['smooth']}
 doc={'schemaVersion':1,'landmarks':'landmarks.json','ceilings':json.loads((E/'ceilings.json').read_text()),'best':BEST,'rows':rows,'guide_hashes':hashes,'rev4_hash':sha(rev),'guide_diff_count_c0_c4':0,'c5_guide_diff_count':0,'c5_curtain_child_diff':next(r for r in rows if r['tag']=='c5')['curtain_children']-next(r for r in rows if r['tag']=='c4')['curtain_children'],'facet':facet,'target_reference_mm':{'inner_L':46.4,'inner_R':44.7,'outer_L':81.5,'outer_R':82.8}}
 (E/'scoreboard.json').write_text(json.dumps(doc,indent=2)+'\n');(E/'facet-analysis.json').write_text(json.dumps(facet,indent=2)+'\n');scoreboard_png(rows);image_sheet(rows)
 print(json.dumps({'best':BEST,'rows':[{k:r[k] for k in ('tag','front_iou','eroded','width_rms_head','profile','back','eye','ear_cover','stripe_contrast','standing')} for r in rows],'facet':facet},indent=2))
if __name__=='__main__':main()
