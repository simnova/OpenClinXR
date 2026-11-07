"""Judge sweep-3 cells and assemble required quantitative evidence."""
import argparse,importlib.util,json,shutil,sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw

E=Path(__file__).resolve().parent;J=Path('/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge')
TS=Path('/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back');TM=J/'target-set-back'
TAGS=('b2','r1','g1','rg1','v1','j1','p1','y1');FRONT='55,595,512';PROFILE='90,570,200';BACK='100,650,512'

def hjmod():
    s=importlib.util.spec_from_file_location('hair_judge_v6_sweep3',J/'hair_judge.py');m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;sys.path.insert(0,str(J));s.loader.exec_module(m);return m

def summ(d):
    e=d.get('face_gaps',{}).get('eye',{});bh=d.get('back_hem_v5',{});eb=d.get('eye_box_hair',{})
    return {'front_iou':d.get('iou'),'eroded':d.get('iou_eroded'),'face_gap_eye_L':(e.get('L')or{}).get('ratio'),'face_gap_eye_R':(e.get('R')or{}).get('ratio'),'profile_iou':d.get('profile_view',{}).get('iou'),'back_iou':d.get('back_view',{}).get('iou'),'back_hem_ours_skull_H':bh.get('ours'),'back_hem_target_skull_H':bh.get('target'),'eye_box_px':int(eb.get('hair_px',0)),'transform':d.get('transform'),'profile_transform':d.get('profile_view',{}).get('transform'),'back_transform':d.get('back_view',{}).get('transform')}

def warp(mask,tr):
    ys,xs=np.where(mask);out=np.zeros_like(mask);xx=np.rint(xs*tr['scale']+tr['tx']).astype(int);yy=np.rint(ys*tr['scale']+tr['ty']).astype(int);ok=(xx>=0)&(xx<1024)&(yy>=0)&(yy<1024);out[yy[ok],xx[ok]]=1;return out

def stripe(mask):
    ys,xs=np.where(mask);crop=mask[ys.min():ys.max()+1,xs.min():xs.max()+1];d=crop.mean(axis=0);return float(np.std(d)/max(np.mean(d),1e-12))

def path_share(c):
    cap=np.load(E.parent/'hair-cap8'/'cap-v8.npz');gd=np.load(c/'guides16.npz');G=np.asarray(gd['points']);R=np.asarray(gd['roots']);cx=float(cap['cx']);ear_y=float(cap['ear_y']);ear_z=float(cap['ear_top'])-.015;pfront=float(np.mean([cap['pinna_front_L'][1],cap['pinna_front_R'][1]]));ahead=np.where(R[:,1]<ear_y)[0];counts={'front':0,'over':0,'behind':0}
    for i in ahead:
        p=G[i,int(np.argmin(np.abs(G[i,:,2]-ear_z)))];outer=abs(p[0]-cx)>=.85*max(abs(float(cap['pinna_top_L'][0])-cx),abs(float(cap['pinna_top_R'][0])-cx));cls='front' if p[1]<pfront-.002 else ('over' if outer and p[1]<=ear_y+.012 else 'behind');counts[cls]+=1
    n=max(len(ahead),1);return {'n':int(len(ahead)),**{k:100*v/n for k,v in counts.items()}}

def profile_edges(ours,target):
    rows=(180,240,300,360,420,480,540);out=[]
    for y in rows:
        xo=np.where(ours[y])[0];xt=np.where(target[y])[0];out.append({'row':y,'ours_front_col':None if not len(xo) else int(xo.min()),'TS_front_col':None if not len(xt) else int(xt.min()),'delta_skull_H':None if not len(xo) or not len(xt) else float((xo.min()-xt.min())/481.)})
    return out

def added(c,j):
    fm=np.asarray(Image.open(c/'children/front-id.png').convert('L'))>127;pm=np.asarray(Image.open(c/'children/profile_90-id.png').convert('L'))>127;bm=np.asarray(Image.open(c/'children/back-id.png').convert('L'))>127
    fr=warp(fm,j['transform']);pr=warp(pm,j['profile_transform']);targetp=np.asarray(Image.open(TM/'mask-profile-v2.png').convert('L'))>127
    box=pm[300:430,295:385];ear=float(box.mean())
    x=np.where(fr[319])[0];ld=None if not np.any(x<513) else (513-int(x[x<513].max()))/481.;rd=None if not np.any(x>513) else (int(x[x>513].min())-513)/481.
    diag=json.load(open(E/'diagnosis.json'));band=diag['face_gap']['band_skull_H'];gap={'L_skull_H':ld,'R_skull_H':rd,'L_pass':ld is not None and band['L'][0]<=ld<=band['L'][1],'R_pass':rd is not None and band['R'][0]<=rd<=band['R'][1],'band_skull_H':band,'judge_clause_ratio':{'L':j['face_gap_eye_L'],'R':j['face_gap_eye_R']}}
    meta=json.load(open(c/'children-meta.json'));style=json.load(open(c/'style.json'))
    exits=7 if not style.get('front_flow_g1') else int(json.load(open(c/'row.json'))['g5']['front_lo'])
    return {'front_exits':exits,'over_eye_cheek_strands':int(meta.get('overEyeCheekStrands',0)),'ear_cover_profile_mask':ear,'ahead_ear_percent':path_share(c),'profile_front_edge':profile_edges(pr,targetp),'stripe_contrast':stripe(bm),'face_gap_TS_band':gap}

def judge(tag):
    h=hjmod();c=E/'cells'/tag;o=c/'judge';o.mkdir(parents=True,exist_ok=True)
    d=h.judge(str(c/'children/front.png'),str(c/'children/front-id.png'),tag,FRONT,str(o),target_set='back',id_mask_path=str(c/'children/front-id.png'),profile_mask_path=str(c/'children/profile_90-id.png'),profile_landmarks=PROFILE,back_mask_path=str(c/'children/back-id.png'),back_landmarks=BACK,target_front_mask=str(TM/'mask-front-v2.png'),target_profile_mask=str(TM/'mask-profile-v2.png'),target_back_mask=str(TM/'mask-back-v3.png'),overlay_prefix='overlay-')
    r=json.load(open(c/'row.json'));r['tag']=tag;r['judge']=summ(d);r['sweep3']=added(c,r['judge']);(c/'row.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'tag':tag,**r['judge'],**r['sweep3']},sort_keys=True))

def scoreboard(rows):
    cols=[('cell',42),('diff',220),('kept',55),('in',35),('exit',38),('eye',38),('front',58),('profile',58),('back',58),('ear',50),('F/O/B%',115),('stripe',55)]
    im=Image.new('RGB',(sum(w for _,w in cols),42+30*len(rows)),(20,20,20));d=ImageDraw.Draw(im);x=0
    for s,w in cols:d.text((x+2,8),s,fill=(255,220,80));x+=w
    base=rows[0]['style']
    for i,r in enumerate(rows):
        m=r['sweep3'];j=r['judge'];diff={k:v for k,v in r['style'].items() if base.get(k)!=v};p=m['ahead_ear_percent'];vals=[r['tag'],','.join('%s=%s'%z for z in diff.items())or'<none>','%.1f'%(100*r['count']/r['n_roots']),r['g4']['inside'],m['front_exits'],m['over_eye_cheek_strands'],'%.4f'%j['front_iou'],'%.4f'%j['profile_iou'],'%.4f'%j['back_iou'],'%.3f'%m['ear_cover_profile_mask'],'%.0f/%.0f/%.0f'%(p['front'],p['over'],p['behind']),'%.3f'%m['stripe_contrast']]
        x=0;y=42+i*30
        for v,(_,w) in zip(vals,cols):d.text((x+2,y),str(v),fill=(235,235,235));x+=w
    im.save(E/'scoreboard.png')

def sweepsheet(rows):
    S=280;im=Image.new('RGB',(S*6,28+S*len(rows)),(18,18,18));d=ImageDraw.Draw(im);d.text((5,7),'TS front | ours front | TS profile | ours profile | TS back | ours back',fill=(255,220,80))
    for i,r in enumerate(rows):
        y=28+i*S;paths=(TS/'target-front.png',E/'cells'/r['tag']/'children/front.png',TS/'target-profile.png',E/'cells'/r['tag']/'children/profile_90.png',TS/'target-back.png',E/'cells'/r['tag']/'children/back.png')
        for k,p in enumerate(paths):im.paste(Image.open(p).convert('RGB').resize((S,S),Image.Resampling.LANCZOS),(k*S,y))
        d.text((5,y+5),r['tag'],fill=(255,255,0))
    im.save(E/'sweep-sheet.png')

def assemble(best):
    rows=[json.load(open(E/'cells'/t/'row.json')) for t in TAGS];base=rows[0]['style']
    for r in rows:r['style_diff']={k:v for k,v in r['style'].items() if base.get(k)!=v}
    doc={'schemaVersion':3,'fixed':{'cap':'tools/openclinxr/evidence/hair-cap8/cap-v8.npz','flow':'tools/openclinxr/evidence/hair-sweep3/flow-f2.npz','root_seed':16,'front_landmarks':FRONT,'profile_landmarks':PROFILE,'back_landmarks':BACK},'best':best,'rows':rows};(E/'scoreboard.json').write_text(json.dumps(doc,indent=2)+'\n');scoreboard(rows);sweepsheet(rows)
    b=E/'best';shutil.rmtree(b,ignore_errors=True);shutil.copytree(E/'cells'/best,b)
    im=Image.new('RGB',(3072,2048),(18,18,18));d=ImageDraw.Draw(im)
    for i,(name,p) in enumerate((('TS front',TS/'target-front.png'),('ours front',b/'children/front.png'),('TS profile',TS/'target-profile.png'),('ours profile',b/'children/profile_90.png'),('TS back',TS/'target-back.png'),('ours back',b/'children/back.png'))):
        x=(i%3)*1024;y=(i//3)*1024;im.paste(Image.open(p).convert('RGB'),(x,y));d.text((x+8,y+8),name,fill=(255,255,0))
    im.save(b/'target-vs-children.png');(E/'analysis.json').write_text(json.dumps({'best':best,'diagnosis':'diagnosis.json','rows':[{'tag':r['tag'],'style_diff':r['style_diff'],'gates':r['gates'],'judge':r['judge'],'sweep3':r['sweep3']} for r in rows]},indent=2)+'\n')

def main():
    a=argparse.ArgumentParser();s=a.add_subparsers(dest='cmd',required=True);p=s.add_parser('judge');p.add_argument('tag');p=s.add_parser('assemble');p.add_argument('--best',required=True);q=a.parse_args();judge(q.tag) if q.cmd=='judge' else assemble(q.best)
if __name__=='__main__':main()
