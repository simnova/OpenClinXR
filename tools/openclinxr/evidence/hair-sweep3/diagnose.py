"""Pre-cell quantitative diagnosis for hair-sweep-3 baseline b2."""
import importlib.util,json,sys
from pathlib import Path
import numpy as np
from PIL import Image

E=Path(__file__).resolve().parent
CAP=E.parent/'hair-cap8'/'cap-v8.npz';FLOW=E/'flow-f2.npz'
J=Path('/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge');TM=J/'target-set-back'

def module(name,path):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m

def nearest_rows(mask,rows,centre=513):
    out=[]
    for name,row in rows:
        rr=max(0,min(mask.shape[0]-1,int(round(row))));xx=np.where(mask[rr])[0]
        left=centre-int(xx[xx<centre].max()) if np.any(xx<centre) else None;right=int(xx[xx>centre].min())-centre if np.any(xx>centre) else None
        out.append({'height':name,'row':rr,'left_edge_from_centre_px':left,'right_edge_from_centre_px':right,'left_skull_H':None if left is None else left/481.,'right_skull_H':None if right is None else right/481.})
    return out

def dominant_period(a):
    a=np.asarray(a,float);a=a-np.mean(a)
    if len(a)<8 or not np.any(a):return {'bins':None,'power_fraction':0.0}
    p=np.abs(np.fft.rfft(a))**2;p[0]=0;k=int(np.argmax(p[1:])+1)
    return {'bins':float(len(a)/k),'power_fraction':float(p[k]/max(p.sum(),1e-12))}

def main():
    cap=np.load(CAP);flow=np.load(FLOW,allow_pickle=True);gd=np.load(E/'cells/b2/guides16.npz')
    G=np.asarray(gd['points']);R=np.asarray(gd['roots']);C=np.asarray(gd['class']);cx=float(cap['cx'])
    ear_y=float(cap['ear_y']);ear_z=float(cap['ear_top'])-.015;ment=float(cap['menton_z']);collar=ment-.070
    ahead=np.where(R[:,1]<ear_y)[0];pfront=float(np.mean([cap['pinna_front_L'][1],cap['pinna_front_R'][1]]))
    records=[];counts={'front':0,'over':0,'behind':0}
    for i in ahead:
        pts={}
        for name,z in (('ear',ear_z),('menton',ment),('collarbone',collar)):
            p=G[i,int(np.argmin(np.abs(G[i,:,2]-z)))];pts[name]={'x_m':float(p[0]),'y_m':float(p[1]),'z_m':float(p[2])}
        ep=pts['ear'];outer=abs(ep['x_m']-cx)>=.85*max(abs(float(cap['pinna_top_L'][0])-cx),abs(float(cap['pinna_top_R'][0])-cx))
        cls='front' if ep['y_m']<pfront-.002 else ('over' if outer and ep['y_m']<=ear_y+.012 else 'behind');counts[cls]+=1
        records.append({'guide':int(i),'root_m':R[i].tolist(),'built_obstacle':'rear_Yb' if int(C[i])==1 else ('front_side_Xs' if int(C[i])==2 else 'side_Xs'),'points':pts,'ear_class':cls})
    n=max(len(ahead),1);shares={k:100*v/n for k,v in counts.items()}

    target=np.asarray(Image.open(TM/'mask-front-v2.png').convert('L'))>127;target_profile=np.asarray(Image.open(TM/'mask-profile-v2.png').convert('L'))>127
    crown=float(cap['crown']);hh=.2107;row_for=lambda z:127.+(crown-z)/hh*481.
    named=[('ear',row_for(ear_z)),('menton',row_for(ment)),('collarbone',row_for(collar))];ts_front=nearest_rows(target,named);ts_profile=[]
    for name,row in named:
        rr=max(0,min(1023,int(round(row))));xx=np.where(target_profile[rr])[0]
        ts_profile.append({'height':name,'row':rr,'front_edge_col':None if not len(xx) else int(xx.min()),'front_edge_from_profile_landmark_skull_H':None if not len(xx) else (200-int(xx.min()))/481.})

    mask=np.asarray(Image.open(E/'cells/b2/children/back-id.png').convert('L'))>127;ys,xs=np.where(mask);x0,x1=int(xs.min()),int(xs.max());y0,y1=int(ys.min()),int(ys.max())
    density=mask[y0:y1+1,x0:x1+1].mean(axis=0);dp=dominant_period(density);contrast=float(np.std(density)/max(np.mean(density),1e-12))
    bp=module('children_station_sweep3_diag',E/'children_station.py');meta={}
    bp.blend_children(gd,cap,50000,bp.SEED,meta,part_closure=True,part_fill=True,same_side_ahead_only=True)
    rx=np.asarray(meta['roots_cap'])[:,0]-cx;px_per_m=481./hh;bins=np.linspace(rx.min(),rx.max(),max(32,int((rx.max()-rx.min())*px_per_m)+1));hist,_=np.histogram(rx,bins);gp=dominant_period(hist)
    gh,_=np.histogram(R[:,0]-cx,bins);ggp=dominant_period(gh)
    stripes={'unlit_source':'cells/b2/children/back-id.png (flat emission ID pass)','column_density':density.tolist(),'contrast_std_over_mean':contrast,'dominant_period_px':dp['bins'],'dominant_power_fraction':dp['power_fraction'],'child_root_period_px':gp['bins'],'guide_spacing_period_px':ggp['bins'],'survive_unlit':bool(contrast>.08 and dp['power_fraction']>.03)}

    eye_row=319;xx=np.where(target[eye_row])[0];ld=(513-int(xx[xx<513].max()))/481.;rd=(int(xx[xx>513].min())-513)/481.
    face={'row':eye_row,'TS_derived_skull_H':{'L':float(ld),'R':float(rd)},'band_skull_H':{'L':[float(ld-.02),float(ld+.02)],'R':[float(rd-.02),float(rd+.02)]},'judge_clause':'hair-judge v6 face-gap eye ratio (ours/target), reported separately and not edited'}
    rear_share=100*sum(q['built_obstacle']=='rear_Yb' for q in records)/n
    causes={'r_obstacle_routing':{'verdict':'SUPPORTED' if rear_share>50 else 'REFUTED','number':{'ahead_root_count':len(ahead),'rear_Yb_percent':rear_share,'ear_class_percent':shares}},'g_flow':{'verdict':'SUPPORTED','number':{'baseline_f2_exit_probe':'598/800 behind-ear; 0 above-ear','requested_comb_back':.2,'requested_gravity':'raised in first 25 mm, ramp by 50 mm'}},'D3_stripes':{'verdict':'SUPPORTED' if stripes['survive_unlit'] else 'REFUTED','number':{k:v for k,v in stripes.items() if k!='column_density'}}}
    doc={'schemaVersion':1,'baseline':'b2 copied byte-for-byte from hair-sweep2/cells/x1','units':{'chin_H_m':.2107,'mask_skull_H_px':481},'ahead_of_ear_paths':{'ear_y_m':ear_y,'counts':counts,'percent':shares,'records':records},'target_path_points':{'front':ts_front,'profile':ts_profile},'stripes':stripes,'face_gap':face,'causes':causes}
    (E/'diagnosis.json').write_text(json.dumps(doc,indent=2)+'\n');print(json.dumps({'causes':causes,'face_gap':face,'stripe':{k:v for k,v in stripes.items() if k!='column_density'}},indent=2))

if __name__=='__main__':main()
