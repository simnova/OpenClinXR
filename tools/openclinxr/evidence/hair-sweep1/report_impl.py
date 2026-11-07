"""Judge sweep cells and assemble the required tables and contact sheets."""
import argparse, importlib.util, json, shutil, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

E=Path(__file__).resolve().parent
J=Path('/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge')
TS=Path('/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back')
TM=J/'target-set-back'; TAGS=('b0','s1','s2','s3','s4','s5','s6')
FRONT='55,595,512'; PROFILE='90,570,200'; BACK='100,650,512'

def hjmod():
    s=importlib.util.spec_from_file_location('hair_judge_v6',J/'hair_judge.py');m=importlib.util.module_from_spec(s)
    sys.modules[s.name]=m;sys.path.insert(0,str(J));s.loader.exec_module(m);return m

def summ(d):
    e=d.get('face_gaps',{}).get('eye',{});bh=d.get('back_hem_v5',{})
    return {'front_iou':d.get('iou'),'eroded':d.get('iou_eroded'),'width_rms_head':d.get('width_rms_head'),
      'face_gap_eye_L':(e.get('L')or{}).get('ratio'),'face_gap_eye_R':(e.get('R')or{}).get('ratio'),
      'profile_iou':d.get('profile_view',{}).get('iou'),'back_iou':d.get('back_view',{}).get('iou'),
      'back_hem_ours':bh.get('ours'),'back_hem_target':bh.get('target'),
      'id_show_through':d.get('id_show_through',{}).get('fraction'),
      'standing_hair':d.get('standing_hair',{}).get('flag'),'transform':d.get('transform'),
      'profile_transform':d.get('profile_view',{}).get('transform'),'back_transform':d.get('back_view',{}).get('transform')}

def reg_masks(h,c):
    f,_=h.load_view_mask(str(c/'children/front-id.png'));p,_=h.load_view_mask(str(c/'children/profile_90-id.png'))
    f,_,_=h.register_into_target(f,np.zeros((1024,1024,3)),{'crown_top_row':55.,'chin_row':595.,'face_centre_col':512.},{'crown_top_row':127.,'chin_row':608.,'face_centre_col':513.})
    p,_,_=h.register_view(p,None,*h.parse_triple(PROFILE),*h.back_view_defaults('profile'))
    tf=np.array(Image.open(TM/'mask-front-v2.png').convert('L'))>127;tp=np.array(Image.open(TM/'mask-profile-v2.png').convert('L'))>127
    return f,p,tf,tp

def fedges(mask,r,centre=513,H=481.):
    x=np.where(mask[int(r)])[0];l=x[x<centre];q=x[x>centre]
    cv=lambda v:None if v is None else float(v/H)
    return {'outer_L':cv(l.min()-centre if len(l)else None),'inner_L':cv(l.max()-centre if len(l)else None),
      'inner_R':cv(q.min()-centre if len(q)else None),'outer_R':cv(q.max()-centre if len(q)else None)}

def edge_tables(h,c):
    f,p,tf,tp=reg_masks(h,c);rows=np.rint(np.linspace(127,646,8)).astype(int)
    front=[{'row':int(r),'head_y':float((r-127)/481),'ours':fedges(f,r),'target':fedges(tf,r)} for r in rows]
    right=float(np.median(np.where(tp)[1]))>344
    def pe(m,r):
        x=np.where(m[int(r)])[0]
        return None if not len(x) else float(((x.min()if right else x.max())-344)/452)
    prows=np.rint(np.linspace(125,640,8)).astype(int)
    profile=[{'row':int(r),'head_y':float((r-125)/452),'ours_front':pe(p,r),'target_front':pe(tp,r)} for r in prows]
    return {'front':front,'profile':profile,'profile_face_right':bool(right)}

def body_edge(path,hair,row,right):
    a=np.asarray(Image.open(path).convert('RGB'),float)/255.;rr=a[int(round(row))]
    bg=np.median(np.vstack((a[:40,:40].reshape(-1,3),a[:40,-40:].reshape(-1,3))),axis=0)
    fg=np.linalg.norm(rr-bg,axis=1)>.09;fg&=~hair[int(round(row))];x=np.where(fg)[0]
    return None if not len(x)else int(x.max()if right else x.min())

def nape(h,c):
    _,p,_,tp=reg_masks(h,c);right=float(np.median(np.where(tp)[1]))>344;out=[]
    for dz in np.linspace(.02,-.06,5):
        ro=570-dz/.2107*480;rt=577-dz/.2107*452
        def one(mask,path,row,H):
            # At the nape the dominant contiguous hair run begins on the
            # neck-back boundary and ends at the outer silhouette.  Using
            # that run avoids target-photo background texture/shoulder pixels.
            x=np.where(mask[int(round(row))])[0]
            if not len(x):return None
            cuts=np.where(np.diff(x)>1)[0]+1;runs=np.split(x,cuts);run=max(runs,key=len)
            return float((int(run[-1])-int(run[0]))/H)
        out.append({'z_from_menton_m':float(dz),'ours_row':float(ro),'target_row':float(rt),
          'ours_depth_hh':one(p,c/'children/profile_90.png',ro,480.),'target_depth_hh':one(tp,TS/'target-profile.png',rt,452.)})
    return out

def judge(tag):
    h=hjmod();c=E/'cells'/tag;o=c/'judge';o.mkdir(parents=True,exist_ok=True)
    d=h.judge(str(c/'children/front.png'),str(c/'children/front-id.png'),tag,FRONT,str(o),target_set='back',
      id_mask_path=str(c/'children/front-id.png'),profile_mask_path=str(c/'children/profile_90-id.png'),profile_landmarks=PROFILE,
      back_mask_path=str(c/'children/back-id.png'),back_landmarks=BACK,target_front_mask=str(TM/'mask-front-v2.png'),
      target_profile_mask=str(TM/'mask-profile-v2.png'),target_back_mask=str(TM/'mask-back-v3.png'),overlay_prefix='overlay-')
    r=json.load(open(c/'row.json'));r['judge']=summ(d);r['edges']=edge_tables(h,c);r['nape_depth']=nape(h,c)
    (c/'row.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'tag':tag,**r['judge']},sort_keys=True))

def fmt(v,n=3):return 'NA'if v is None else(str(v)if isinstance(v,bool)else('%.*f'%(n,v)))
def scoreboard(rows):
    C=[('cell',65),('kept%',70),('inside',60),('horiz',55),('ear L/R',95),('front',65),('eroded',65),('width',65),('gap L/R',95),('profile',65),('back',65),('hem O/T',100),('ID',60),('stand',55)]
    im=Image.new('RGB',(sum(x[1]for x in C),42+34*len(rows)),(20,20,20));d=ImageDraw.Draw(im);x=0
    for s,w in C:d.text((x+3,8),s,fill=(255,220,80));x+=w
    for i,r in enumerate(rows):
        j=r['judge'];v=[r['tag'],fmt(100*r['count']/r['n_roots'],1),str(r['g4']['inside']),str(r['g7']['horiz']),fmt(r['g8']['cover'].get('L'),2)+'/'+fmt(r['g8']['cover'].get('R'),2),fmt(j['front_iou']),fmt(j['eroded']),fmt(j['width_rms_head']),fmt(j['face_gap_eye_L'],2)+'/'+fmt(j['face_gap_eye_R'],2),fmt(j['profile_iou']),fmt(j['back_iou']),fmt(j['back_hem_ours'])+'/'+fmt(j['back_hem_target']),fmt(j['id_show_through']),str(j['standing_hair'])];x=0;y=42+i*34
        for z,(_,w)in zip(v,C):d.text((x+3,y),z,fill=(235,235,235));x+=w
    im.save(E/'scoreboard.png')

def sweepsheet(rows):
    S=300;im=Image.new('RGB',(S*6,28+S*len(rows)),(18,18,18));d=ImageDraw.Draw(im);d.text((5,7),'TS front | ours front | TS profile | ours profile | TS back | ours back',fill=(255,220,80))
    for i,r in enumerate(rows):
        y=28+i*S;paths=(TS/'target-front.png',E/'cells'/r['tag']/'children/front.png',TS/'target-profile.png',E/'cells'/r['tag']/'children/profile_90.png',TS/'target-back.png',E/'cells'/r['tag']/'children/back.png')
        for k,p in enumerate(paths):im.paste(Image.open(p).convert('RGB').resize((S,S),Image.Resampling.LANCZOS),(k*S,y))
        d.text((5,y+5),r['tag'],fill=(255,255,0))
    im.save(E/'sweep-sheet.png')

def assemble(best=None):
    rows=[]
    for t in TAGS:
        p=E/'cells'/t/'row.json'
        if p.exists():
            r=json.load(open(p))
            if 'judge'in r:rows.append(r)
    cand=[r for r in rows if r['tag']in('s1','s2','s3','s4')];seed=max(cand,key=lambda r:r['judge']['front_iou'])
    br=next((r for r in rows if r['tag']==best),None)if best else max(rows,key=lambda r:r['judge']['front_iou'])
    doc={'schemaVersion':1,'fixed':{'cap':'tools/openclinxr/evidence/hair-cap8/cap-v8.npz','flow':'tools/openclinxr/evidence/hair-cap8/flow-b-v10.npz','root_seed':16,'front_landmarks':FRONT,'profile_landmarks':PROFILE,'back_landmarks':BACK},'s6_seed':seed['tag'],'best':br['tag'],'rows':rows}
    (E/'scoreboard.json').write_text(json.dumps(doc,indent=2)+'\n');scoreboard(rows);sweepsheet(rows)
    b=E/'best';shutil.rmtree(b,ignore_errors=True);shutil.copytree(E/'cells'/br['tag'],b)
    im=Image.new('RGB',(3072,2048),(18,18,18));d=ImageDraw.Draw(im)
    for i,(name,p)in enumerate((('TS front',TS/'target-front.png'),('ours front',b/'children/front.png'),('TS profile',TS/'target-profile.png'),('ours profile',b/'children/profile_90.png'),('TS back',TS/'target-back.png'),('ours back',b/'children/back.png'))):
        x=(i%3)*1024;y=(i//3)*1024;im.paste(Image.open(p).convert('RGB').resize((1024,1024)),(x,y));d.text((x+8,y+8),name,fill=(255,255,0))
    im.save(b/'target-vs-children.png')
    g=np.load(b/'guides16.npz');j=br['judge'];tip=float(np.median(g['z_hem']));delta=(j['back_hem_ours']-j['back_hem_target'])*.2107;desired=tip+delta
    m6={'true_tip_z_m':tip,'judge_ours':j['back_hem_ours'],'judge_target':j['back_hem_target'],'camera_registration':j['back_transform'],'desired_z_hem_m':desired,'desired_head_heights_below_chin':float((float(g['menton_z'])-desired)/.2107)}
    b0=next(r for r in rows if r['tag']=='b0');(E/'analysis.json').write_text(json.dumps({'best':br['tag'],'M3':{'b0':b0['diagnostics'],'best':br['diagnostics'],'edges_b0':b0['edges'],'edges_best':br['edges']},'M6':m6,'M7':br['nape_depth']},indent=2)+'\n');print(json.dumps({'s6_seed':seed['tag'],'best':br['tag'],'M6':m6},indent=2))

def main():
    a=argparse.ArgumentParser();s=a.add_subparsers(dest='cmd',required=True);p=s.add_parser('judge');p.add_argument('tag');p=s.add_parser('assemble');p.add_argument('--best');q=a.parse_args();judge(q.tag)if q.cmd=='judge'else assemble(q.best)
