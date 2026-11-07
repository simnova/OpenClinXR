"""Pre-cell quantitative diagnosis for hair-sweep-2 (baseline b1 only)."""
import importlib.util, json, sys
from pathlib import Path
import numpy as np
from PIL import Image

E=Path(__file__).resolve().parent
CAP=E.parent/'hair-cap8'/'cap-v8.npz'
FLOW=E.parent/'hair-cap8'/'flow-b-v10.npz'
J=Path('/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge')
TM=J/'target-set-back'

def module(name,path):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s)
    sys.modules[name]=m;s.loader.exec_module(m);return m

def normals(V,F):
    n=np.zeros_like(V);tri=V[F];fn=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0])
    for k in range(3):np.add.at(n,F[:,k],fn)
    n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)
    c=np.median(V,axis=0);n[((n*(V-c)).sum(axis=1)<0)]*=-1
    return n

def nearest_dist(P,Q,block=2048):
    out=np.empty(len(P))
    for i in range(0,len(P),block):out[i:i+block]=np.linalg.norm(P[i:i+block,None,:]-Q[None,:,:],axis=2).min(axis=1)
    return out

def main():
    cap=np.load(CAP);flow=np.load(FLOW,allow_pickle=True);V=np.asarray(cap['verts']);F=np.asarray(cap['faces']);cx=float(cap['cx'])
    hj=module('hair_judge_sweep2',J/'hair_judge.py')
    raw,_=hj.load_view_mask(str(E/'cells/b1/children/front-id.png'))
    ours,_,_=hj.register_into_target(raw,np.zeros((1024,1024,3)),{'crown_top_row':55.,'chin_row':595.,'face_centre_col':512.},{'crown_top_row':127.,'chin_row':608.,'face_centre_col':513.})
    target=np.asarray(Image.open(TM/'mask-front-v2.png').convert('L'))>127
    H=481.;crown=127;centre=513;brow=319
    def hairline(mask,col):
        x0=max(0,int(round(col))-2);x1=min(mask.shape[1],int(round(col))+3)
        rr=np.where(mask[crown:brow+1,x0:x1].any(axis=1))[0]
        return None if not len(rr) else int(crown+rr.max())
    hair=[]
    for off in (0.,-.1,.1,-.2,.2,-.3,.3):
        col=centre+off*H;ro=hairline(ours,col);rt=hairline(target,col)
        hair.append({'column_h':off,'column_px':float(col),'ours_row':ro,'target_row':rt,
          'ours_from_crown_h':None if ro is None else (ro-crown)/H,'target_from_crown_h':None if rt is None else (rt-crown)/H})

    # Reconstruct the deterministic candidate order and identify all 70
    # front-band attempts; retained roots/lift-off points are matched to b1.
    roots=np.asarray(flow['roots']);slit=V[np.asarray(cap['slit'],int)]
    roots=roots[np.min(np.linalg.norm(roots[:,None]-slit[None,:],axis=2),axis=1)>=.001]
    roots=roots[np.random.default_rng(16).permutation(len(roots))]
    right=roots[roots[:,0]>cx][:400]
    candidates=np.empty((2*len(right),3));candidates[0::2]=right;candidates[1::2]=right*np.array([-1,1,1])+np.array([2*cx,0,0])
    front=V[np.asarray(cap['forehead'],int)]
    gd=np.load(E/'cells/b1/guides16.npz');GR=np.asarray(gd['roots']);GL=np.asarray(gd['liftoff'])
    kept_front=GR[nearest_dist(GR,front)<=.030]
    cand_front=candidates[nearest_dist(candidates,front)<=.030]
    dc=np.linalg.norm(cand_front[:,None]-kept_front[None,:,:],axis=2).min(axis=1)
    rejected_front=cand_front[dc>1e-5][:24]
    front_roots=np.concatenate([kept_front,rejected_front])
    N=normals(V,F);FV=np.asarray(flow['f']);w=np.asarray(flow['w']);b=np.asarray(flow['b'])
    records=[];counts={'drapes_in_front_of_ear':0,'over_ear':0,'behind_ear':0,'rejected':0}
    for i,r in enumerate(front_roots):
        vi=int(np.argmin(np.linalg.norm(V-r,axis=1)));gi=int(np.argmin(np.linalg.norm(GR-r,axis=1)));kept=float(np.linalg.norm(GR[gi]-r))<1e-5
        fi=int(np.argmin(np.linalg.norm(np.asarray(flow['roots'])-r,axis=1)));ex=str(np.asarray(flow['exit_classes'])[fi])
        cls='drapes_in_front_of_ear' if ex=='front' else ('over_ear' if ex=='above-ear' else 'behind_ear')
        counts[cls]+=1
        if not kept:counts['rejected']+=1
        terms={'lateral':float(w[vi]),'gravity':float((1-w[vi])*(1-.7*b[vi])),'comb_back':float(b[vi])}
        records.append({'index':i,'root_m':r.tolist(),'path_class':cls,'flow_exit_class':ex,'kept':kept,
          'lift_off_m':GL[gi].tolist() if kept else None,'flow_direction':FV[vi].tolist(),'flow_terms':terms})
    term_summary={k:float(np.median([q['flow_terms'][k] for q in records])) for k in ('lateral','gravity','comb_back')}

    # Generate baseline children in memory once: density and seam questions
    # are answered from the same seed/station used by the rendered b1 cell.
    bp=module('children_station_diagnosis',E/'children_station.py');meta={}
    kids=bp.blend_children(gd,cap,50000,bp.SEED,meta,part_closure=True,part_fill=True)
    cr=np.asarray(meta['roots_cap']);A=V[F[:,0]];B=V[F[:,1]];C=V[F[:,2]];area=.5*np.linalg.norm(np.cross(B-A,C-A),axis=1);cent=(A+B+C)/3
    dr=nearest_dist(cr,front);da=nearest_dist(cent,front)
    density=[]
    for lo,hi in ((0,10),(10,20),(20,30)):
        m=(dr>=lo/1000)&(dr<hi/1000);am=(da>=lo/1000)&(da<hi/1000);ac=float(area[am].sum()*1e4)
        density.append({'region':'front_%02d_%02dmm'%(lo,hi),'count':int(m.sum()),'area_cm2':ac,'density_cm2':float(m.sum()/ac)})
    for name,rm,am in (
      ('top',(np.abs(cr[:,0]-cx)<.04)&(dr>=.03),(np.abs(cent[:,0]-cx)<.04)&(da>=.03)),
      ('side',(np.abs(cr[:,0]-cx)>=.04)&(dr>=.03),(np.abs(cent[:,0]-cx)>=.04)&(da>=.03))):
        ac=float(area[am].sum()*1e4);density.append({'region':name,'count':int(rm.sum()),'area_cm2':ac,'density_cm2':float(rm.sum()/ac)})

    behind=kids[:,:,1]>=float(cap['apex_y']);near=(np.abs(kids[:,:,0]-cx)<=.010)&behind
    zlo=float(np.floor(kids[:,:,2].min()/.02)*.02);zhi=float(np.ceil(kids[:,:,2].max()/.02)*.02)
    seam=[]
    for lo in np.arange(zlo,zhi,.02):
        hit=near&(kids[:,:,2]>=lo)&(kids[:,:,2]<lo+.02);ids=np.where(hit.any(axis=1))[0]
        if len(ids):
            vals=kids[:,:,0][hit]-cx
            seam.append({'z_m':[round(float(lo),4),round(float(lo+.02),4)],'children':int(len(ids)),
              'points':int(hit.sum()),'mean_x_offset_mm':float(vals.mean()*1000),'mean_abs_x_offset_mm':float(np.abs(vals).mean()*1000)})
    root_behind=cr[:,1]>=float(cap['apex_y']);side=np.sign(cr[:,0]-cx);cross=((kids[:,:,0]-cx)*side[:,None]<0)&behind
    cross_count=int((cross&root_behind[:,None]).any(axis=1).sum())

    # Landmark-derived skull estimate: an ellipse anchored at the inferred
    # crown of the skull and the outer-ear half-width at the temple row.
    # Target skull top is 26 px below its hair apex; b1's visible centre-part
    # scalp begins 4 px below its hair apex.  Ear half-width=185 px is from
    # target-set-back landmarks (w_front_outer_ear_px=370).
    def outer(mask,row):
        xx=np.where(mask[int(row)])[0];return 0. if not len(xx) else float(max(centre-xx.min(),xx.max()-centre))
    temple_row=343
    crown_info={}
    for name,mask,skull_top in (('ours',ours,131.),('target',target,153.)):
        sample=int(round(skull_top+24))
        head=185*np.sqrt(max(0.,1-((sample-temple_row)/(temple_row-skull_top))**2))
        crown_info[name]={'sample_row':sample,'outer_hair_halfwidth_px':outer(mask,sample),'inferred_head_halfwidth_px':float(head),'thickness_px':float(outer(mask,sample)-head)}
    temple_info={name:{'row':temple_row,'outer_hair_halfwidth_px':outer(mask,temple_row),'inferred_head_halfwidth_px':185.,'thickness_px':outer(mask,temple_row)-185.} for name,mask in (('ours',ours),('target',target))}

    rejected=next(x for x in json.load(open(E/'cells/b1/row.json'))['diagnostics']['regions'] if x['region']=='front_band')['rejected']['inside']
    d0=density[0]['density_cm2'];ref=.5*(density[-1]['density_cm2']+density[-2]['density_cm2'])
    causes={
      'e_children_front_fill':{'verdict':'SUPPORTED' if d0<.85*ref else 'REFUTED','number':{'front_0_10_cm2':d0,'top_side_mean_cm2':ref}},
      'f_flow_comb_back':{'verdict':'SUPPORTED' if term_summary['comb_back']>.25 else 'REFUTED','number':term_summary},
      'g_cap_front_hairline':{'verdict':'UNKNOWN','number':hair,'reason':'registered child silhouette conflates cap edge, guide rejection, and child fill; no isolated cap-edge render'},
      'h_front_guides_rejected':{'verdict':'SUPPORTED' if rejected==24 else 'UNKNOWN','number':{'rejected_inside':rejected,'front_band_roots':70}},
      'i_no_root_lift':{'verdict':'SUPPORTED' if crown_info['ours']['thickness_px']<crown_info['target']['thickness_px'] else 'REFUTED','number':{'crown':crown_info,'temple':temple_info}},
      'seam_same_side_behind_crown':{'verdict':'SUPPORTED' if cross_count==0 else 'REFUTED','number':{'cross_centre_children':cross_count,'bands':seam}}}
    doc={'schemaVersion':1,'baseline':'b1 copied from hair-sweep1/s5','brow':{'ours_row_registered':brow,'target_row':brow,'method':'b1 projected brow row 271 registered by fixed 55/595 -> 127/608 transform; same anatomical row used for target'},
      'hairline_rows':hair,'front_band_guides':{'count':len(records),'path_counts':counts,'median_flow_terms':term_summary,'records':records},
      'children_density':density,'back_seam':{'same_side_crossing_children':cross_count,'z_bands':seam},
      'silhouette_thickness':{'method':'front-mask outer half-width minus ellipse head edge anchored by visible centre-part scalp top and target landmark outer-ear width 370 px; crown sampled 24 px below inferred skull top','crown':crown_info,'temple':temple_info},
      'causes':causes}
    (E/'diagnosis.json').write_text(json.dumps(doc,indent=2)+'\n')
    print(json.dumps({'causes':causes,'front_path_counts':counts,'density':density},indent=2))

if __name__=='__main__':main()
