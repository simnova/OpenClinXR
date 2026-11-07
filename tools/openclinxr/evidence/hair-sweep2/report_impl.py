"""Judge sweep-2 cells and assemble scoreboards/contact sheets."""
import argparse,importlib.util,json,shutil,sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw

E=Path(__file__).resolve().parent
J=Path('/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge')
TS=Path('/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back');TM=J/'target-set-back'
TAGS=('b1','h1','c1','f1','f2','l1','l2','k1','x1')
FRONT='55,595,512';PROFILE='90,570,200';BACK='100,650,512'

def hjmod():
    s=importlib.util.spec_from_file_location('hair_judge_v6_sweep2',J/'hair_judge.py');m=importlib.util.module_from_spec(s)
    sys.modules[s.name]=m;sys.path.insert(0,str(J));s.loader.exec_module(m);return m

def summ(d):
    e=d.get('face_gaps',{}).get('eye',{});bh=d.get('back_hem_v5',{});eb=d.get('eye_box_hair',{})
    return {'front_iou':d.get('iou'),'eroded':d.get('iou_eroded'),'width_rms_head':d.get('width_rms_head'),
      'face_gap_eye_L':(e.get('L')or{}).get('ratio'),'face_gap_eye_R':(e.get('R')or{}).get('ratio'),
      'profile_iou':d.get('profile_view',{}).get('iou'),'back_iou':d.get('back_view',{}).get('iou'),
      'back_hem_ours':bh.get('ours'),'back_hem_target':bh.get('target'),'eye_box':int(eb.get('hair_px',0)),
      'id_show_through':d.get('id_show_through',{}).get('fraction'),'standing_hair':d.get('standing_hair',{}).get('flag'),
      'transform':d.get('transform'),'profile_transform':d.get('profile_view',{}).get('transform'),'back_transform':d.get('back_view',{}).get('transform')}

def registered(h,c):
    f,_=h.load_view_mask(str(c/'children/front-id.png'))
    return h.register_into_target(f,np.zeros((1024,1024,3)),{'crown_top_row':55.,'chin_row':595.,'face_centre_col':512.},{'crown_top_row':127.,'chin_row':608.,'face_centre_col':513.})[0]

def added_metrics(h,c):
    f=registered(h,c);centre=513;crown=127;brow=319
    q=np.where(f[crown:brow+1,centre-2:centre+3].any(axis=1))[0];hr=None if not len(q) else int(crown+q.max())
    def outer(row):
        xx=np.where(f[int(row)])[0];return 0. if not len(xx) else float(max(centre-xx.min(),xx.max()-centre))
    skull_top=131.;sample=int(skull_top+24);head=185*np.sqrt(max(0.,1-((sample-343)/(343-skull_top))**2))
    meta=json.load(open(c/'children-meta.json'));style=json.load(open(c/'style.json'))
    if style.get('front_comb_ramp'): flow_exits=json.load(open(E/'row-flow-f2.json'))['gates']['g1']['front_exits']
    elif style.get('front_comb_scale',1.0)!=1.0: flow_exits=json.load(open(E/'row-flow-f1.json'))['gates']['g1']['front_exits']
    else: flow_exits=3
    return {'front_exits':int(flow_exits),'hairline_row_centre_ours':hr,'hairline_row_centre_target':187,
      'crown_thickness_ours_px':float(outer(sample)-head),'crown_thickness_target_px':22.99870730383587,
      'temple_thickness_ours_px':float(outer(343)-185),'temple_thickness_target_px':2.0,
      'back_seam_count':int(meta.get('backSeamCount',0))}

def judge(tag):
    h=hjmod();c=E/'cells'/tag;o=c/'judge';o.mkdir(parents=True,exist_ok=True)
    d=h.judge(str(c/'children/front.png'),str(c/'children/front-id.png'),tag,FRONT,str(o),target_set='back',
      id_mask_path=str(c/'children/front-id.png'),profile_mask_path=str(c/'children/profile_90-id.png'),profile_landmarks=PROFILE,
      back_mask_path=str(c/'children/back-id.png'),back_landmarks=BACK,target_front_mask=str(TM/'mask-front-v2.png'),
      target_profile_mask=str(TM/'mask-profile-v2.png'),target_back_mask=str(TM/'mask-back-v3.png'),overlay_prefix='overlay-')
    r=json.load(open(c/'row.json'));r['judge']=summ(d);r['sweep2']=added_metrics(h,c)
    (c/'row.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'tag':tag,**r['judge'],**r['sweep2']},sort_keys=True))

def fmt(v,n=3):return 'NA' if v is None else (str(v) if isinstance(v,(bool,str)) else ('%.*f'%(n,v)))
def scoreboard(rows):
    C=[('cell',48),('diff',155),('kept%',62),('inside',48),('exits',48),('front',58),('eroded',58),('profile',58),('back',58),('hem O/T',88),('gap L/R',85),('ear',70),('eye',42),('hairline O/T',90),('crown O/T',90),('temple O/T',90),('seam',55)]
    im=Image.new('RGB',(sum(x[1] for x in C),42+32*len(rows)),(20,20,20));d=ImageDraw.Draw(im);x=0
    for s,w in C:d.text((x+2,8),s,fill=(255,220,80));x+=w
    base=rows[0]['style']
    for i,r in enumerate(rows):
        j=r['judge'];m=r['sweep2'];diff={k:v for k,v in r['style'].items() if base.get(k)!=v}
        v=[r['tag'],','.join('%s=%s'%z for z in diff.items())or'<none>',100*r['count']/r['n_roots'],r['g4']['inside'],m['front_exits'],j['front_iou'],j['eroded'],j['profile_iou'],j['back_iou'],fmt(j['back_hem_ours'])+'/'+fmt(j['back_hem_target']),fmt(j['face_gap_eye_L'],2)+'/'+fmt(j['face_gap_eye_R'],2),fmt(min(r['g8']['cover'].values()),2),j['eye_box'],fmt(m['hairline_row_centre_ours'],0)+'/'+fmt(m['hairline_row_centre_target'],0),fmt(m['crown_thickness_ours_px'],1)+'/'+fmt(m['crown_thickness_target_px'],1),fmt(m['temple_thickness_ours_px'],1)+'/'+fmt(m['temple_thickness_target_px'],1),m['back_seam_count']]
        x=0;y=42+i*32
        for z,(_,w) in zip(v,C):d.text((x+2,y),str(z),fill=(235,235,235));x+=w
    im.save(E/'scoreboard.png')

def sweepsheet(rows):
    S=280;im=Image.new('RGB',(S*6,28+S*len(rows)),(18,18,18));d=ImageDraw.Draw(im);d.text((5,7),'TS front | ours front | TS profile | ours profile | TS back | ours back',fill=(255,220,80))
    for i,r in enumerate(rows):
        y=28+i*S;paths=(TS/'target-front.png',E/'cells'/r['tag']/'children/front.png',TS/'target-profile.png',E/'cells'/r['tag']/'children/profile_90.png',TS/'target-back.png',E/'cells'/r['tag']/'children/back.png')
        for k,p in enumerate(paths):im.paste(Image.open(p).convert('RGB').resize((S,S),Image.Resampling.LANCZOS),(k*S,y))
        d.text((5,y+5),r['tag'],fill=(255,255,0))
    im.save(E/'sweep-sheet.png')

def assemble(best='x1'):
    rows=[]
    for t in TAGS:
        p=E/'cells'/t/'row.json'
        if p.exists():
            r=json.load(open(p))
            if 'judge' in r:rows.append(r)
    br=next(r for r in rows if r['tag']==best)
    doc={'schemaVersion':2,'fixed':{'cap':'tools/openclinxr/evidence/hair-cap8/cap-v8.npz','flow':'tools/openclinxr/evidence/hair-cap8/flow-b-v10.npz','root_seed':16,'front_landmarks':FRONT,'profile_landmarks':PROFILE,'back_landmarks':BACK},'best':best,'rows':rows}
    (E/'scoreboard.json').write_text(json.dumps(doc,indent=2)+'\n');scoreboard(rows);sweepsheet(rows)
    b=E/'best';shutil.rmtree(b,ignore_errors=True);shutil.copytree(E/'cells'/best,b)
    im=Image.new('RGB',(3072,2048),(18,18,18));d=ImageDraw.Draw(im)
    for i,(name,p) in enumerate((('TS front',TS/'target-front.png'),('ours front',b/'children/front.png'),('TS profile',TS/'target-profile.png'),('ours profile',b/'children/profile_90.png'),('TS back',TS/'target-back.png'),('ours back',b/'children/back.png'))):
        x=(i%3)*1024;y=(i//3)*1024;im.paste(Image.open(p).convert('RGB').resize((1024,1024)),(x,y));d.text((x+8,y+8),name,fill=(255,255,0))
    im.save(b/'target-vs-children.png')
    (E/'analysis.json').write_text(json.dumps({'best':best,'diagnosis':'diagnosis.json','rows':[{k:r.get(k) for k in ('tag','style_diff','count','n_roots','g4','g8','judge','sweep2')} for r in rows]},indent=2)+'\n')

def main():
    a=argparse.ArgumentParser();s=a.add_subparsers(dest='cmd',required=True);p=s.add_parser('judge');p.add_argument('tag');p=s.add_parser('assemble');p.add_argument('--best',default='x1');q=a.parse_args();judge(q.tag) if q.cmd=='judge' else assemble(q.best)
