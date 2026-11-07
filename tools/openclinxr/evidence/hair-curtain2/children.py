"""Run hair-part's own 50k child generator and five-view render path."""
import argparse, importlib.util, json, shutil, sys
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent
BL=HERE/"children_station.py"

def load_blend():
    s=importlib.util.spec_from_file_location("hair_part_blend16",BL)
    m=importlib.util.module_from_spec(s); sys.modules[s.name]=m; s.loader.exec_module(m); return m

def front_fill_override(bp, cd, n, seed, part_front_closure=False):
    """Baseline poisson+part-fill roots plus one extra front-edge density."""
    verts,faces,apex_y,cx,cy,_slit,forehead=bp.cap_parts(cd)
    roots,nors,pinfo=bp.poisson_roots(verts,faces,cx,cy,apex_y,n,seed)
    n_part,finfo=bp._part_extra_count(verts,faces,apex_y,n)
    if n_part>0:
        pr,pn=bp._sample_strip_roots(verts,faces,cx,cy,apex_y,n_part,(seed+bp.PART_FILL["SEED_OFFSET"])&0xffffffff)
        roots=np.concatenate([roots,pr]);nors=np.concatenate([nors,pn])
    A=verts[faces[:,0]];B=verts[faces[:,1]];C=verts[faces[:,2]]
    area=.5*np.linalg.norm(np.cross(B-A,C-A),axis=1);cent=(A+B+C)/3
    edge=verts[np.asarray(forehead,dtype=int)]
    dist=np.full(len(cent),np.inf)
    for j in range(0,len(cent),2048):
        dist[j:j+2048]=np.linalg.norm(cent[j:j+2048,None,:]-edge[None,:,:],axis=2).min(axis=1)
    band=np.nonzero(dist<=.012)[0]; band_area=float(area[band].sum()); total=float(area.sum())
    n_front=int(round(n*band_area/max(total,1e-18)))
    rng=np.random.default_rng((seed+211)&0xffffffff);fa=area[band];cum=np.cumsum(fa/fa.sum())
    fi=band[np.minimum(np.searchsorted(cum,rng.random(n_front)),len(band)-1)]
    s=rng.random(n_front);t=rng.random(n_front);sq=np.sqrt(s)
    fr=(1-sq)[:,None]*verts[faces[fi,0]]+(sq*(1-t))[:,None]*verts[faces[fi,1]]+(sq*t)[:,None]*verts[faces[fi,2]]
    fn=np.cross(verts[faces[fi,1]]-verts[faces[fi,0]],verts[faces[fi,2]]-verts[faces[fi,0]])
    fn/=np.maximum(np.linalg.norm(fn,axis=1,keepdims=True),1e-12)
    ref=np.c_[fr[:,0]-cx,fr[:,1]-cy,np.full(n_front,.05)];fn[(fn*ref).sum(axis=1)<0]*=-1
    roots=np.concatenate([roots,fr]);nors=np.concatenate([nors,fn])
    if part_front_closure:
        ahead=np.where(roots[:,1] < apex_y)[0]
        order=ahead[np.argsort(np.abs(roots[ahead,0]-cx))]
        take=order[:max(24,int(round(.008*len(roots))))]
        rng2=np.random.default_rng((seed+509)&0xffffffff)
        side=np.where(roots[take,0]<cx,-1.,1.)
        roots[take,0]=cx+side*rng2.uniform(.0003,.0030,len(take))
    pinfo=dict(pinfo,part_n_extra=int(n_part),front_n_extra=int(n_front),front_band_area_cm2=band_area*1e4)
    return roots,nors,pinfo

def origin_region(points, cd):
    """Five disjoint M1 origin bins used by f4's interpolation fence."""
    p=np.asarray(points);cx=float(cd['cx']);cy=float(cd['Cy']);ear_y=float(cd['ear_y'])
    out=np.full(len(p),4,dtype=np.int8)  # top
    out[p[:,1]>float(cd['apex_y'])+.015]=3  # back
    side=np.abs(p[:,0]-cx)>=.035
    out[side & (p[:,1]>=ear_y)]=2  # side behind ear
    out[side & (p[:,1]<ear_y)]=1   # temple ahead ear
    fv=np.asarray(cd['verts'])[np.asarray(cd['forehead'],int)]
    for j in range(0,len(p),1024):
        d=np.linalg.norm(p[j:j+1024,None,:]-fv[None,:,:],axis=2).min(axis=1)
        out[j:j+1024][d<=.030]=0
    return out

def same_origin_children(gd, cd, roots):
    """Blend only guide roots from the same M1 origin bin and side.

    Four inverse-distance neighbours preserve interpolation while preventing
    front/temple, side, and back guide populations from mixing into stripes.
    """
    gr=np.asarray(gd['roots']);gp=np.asarray(gd['points']);rr=origin_region(roots,cd);rg=origin_region(gr,cd)
    cx=float(cd['cx']);side_r=roots[:,0]>=cx;side_g=gr[:,0]>=cx
    out=np.empty((len(roots),gp.shape[1],3),float)
    for reg in range(5):
      for side in (False,True):
        ids=np.where((rr==reg)&(side_r==side))[0];cand=np.where((rg==reg)&(side_g==side))[0]
        if not len(ids):continue
        if not len(cand):cand=np.where(side_g==side)[0]
        for a in range(0,len(ids),1024):
            take=ids[a:a+1024];dist=np.linalg.norm(roots[take,None,:]-gr[cand][None,:,:],axis=2)
            k=min(4,len(cand));near=np.argpartition(dist,k-1,axis=1)[:,:k];dd=np.take_along_axis(dist,near,axis=1)
            w=1/np.maximum(dd,1e-6);w/=w.sum(axis=1,keepdims=True);cur=gp[cand[near]]
            blend=np.einsum('bk,bkpc->bpc',w,cur);blend+=roots[take,None,:]-blend[:,:1,:];out[take]=blend
    return out

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--guides"); ap.add_argument("--cap",required=True); ap.add_argument("--out"); ap.add_argument("--tag",required=True); ap.add_argument("--children",type=int,default=50000)
    a=ap.parse_args(sys.argv[sys.argv.index("--")+1:]); cell=HERE/"cells"/a.tag
    out=Path(a.out) if a.out else cell; out.mkdir(parents=True,exist_ok=True)
    guides=Path(a.guides) if a.guides else cell/"guides16.npz"
    bp=load_blend(); c3=bp.import_children3(); hs=c3.load_hair_scene(); handle=hs.build_scene(); canonical=handle.hair
    groups=bp.load_groups_blend(); uv=next((x for x in handle.head.data.uv_layers if x.active_render),None); uvn=uv.name if uv else handle.head.data.uv_layers[0].name
    cap_obj,cap_info=c3.build_cap_surface(handle,uvn); gd=np.load(guides); cd=np.load(a.cap); meta={}
    style=json.load(open(cell/"style.json"))
    front_fill=bool(style.get("child_front_fill",False));ahead=bool(style.get("part_same_side_ahead_only",False))
    pclose=bool(style.get("part_front_closure",False));wj=bool(style.get("child_weight_jitter",False))
    if front_fill:
        override=front_fill_override(bp,cd,a.children,bp.SEED,pclose)
        kids=bp._blend_children_base(gd,cd,len(override[0]),bp.SEED,meta,_roots_override=override,
          _closure_on=True,_same_side_ahead_only=ahead,_weight_jitter=wj)
    else:
        kids=bp.blend_children(gd,cd,a.children,bp.SEED,meta,part_closure=True,part_fill=True,
          same_side_ahead_only=ahead,weight_jitter=wj)
    roots_cap=np.asarray(meta.get('roots_cap'))
    if bool(style.get('same_origin_interpolation',False)):
        kids=same_origin_children(gd,cd,roots_cap)
    if bool(style.get('layered_clearance',False)):
        rd=np.abs(roots_cap[:,0]-float(cd['cx']));rank=np.argsort(np.argsort(rd))/max(len(rd)-1,1)
        spread=.010+.010*rank
        arc=np.concatenate([np.zeros((len(kids),1)),np.cumsum(np.linalg.norm(np.diff(kids,axis=1),axis=2),axis=1)],axis=1)
        fade=np.clip(arc/.040,0,1);fade=fade*fade*(3-2*fade)
        side=np.where(roots_cap[:,0]>=float(cd['cx']),1.,-1.)
        kids[:,:,0]+=side[:,None]*spread[:,None]*fade
    lat=float(style.get('child_lateral_jitter_mm',0.0))/1000.0
    if lat>0:
        rng=np.random.default_rng(bp.SEED+911);off=rng.uniform(-lat,lat,len(kids))
        arc=np.concatenate([np.zeros((len(kids),1)),np.cumsum(np.linalg.norm(np.diff(kids,axis=1),axis=2),axis=1)],axis=1)
        fade=np.clip(arc/.035,0,1);fade=fade*fade*(3-2*fade)
        kids[:,:,0]+=off[:,None]*fade
    cx=float(cd['cx']);can=max(abs(float(cd['canthus_L'][0])-cx),abs(float(cd['canthus_R'][0])-cx))
    face=((np.abs(kids[:,:,0]-cx)<=can)&(kids[:,:,2]<=float(cd['brow_z']))&(kids[:,:,2]>=float(cd['menton_z']))&(kids[:,:,1]<float(cd['cy'])))
    front_exits=int(face.any(axis=1).sum());over_eye_cheek=int(face.any(axis=1).sum())
    seam=((np.abs(kids[:,:,0]-cx)<=.010)&(kids[:,:,1]>=float(cd['apex_y'])))
    seam_count=int(seam.any(axis=1).sum())
    obj=bp.build_blend_curves(handle,cap_obj,kids,"UVMap","guides16_children")
    _,profile=bp.add_profile(c3,obj,groups,0.00005); visible=bp.apply_r4_visibility(handle,obj)
    renders=bp.render_views_blend(c3,hs,handle,canonical,cap_obj,obj,out,"children",size=1024,samples=64)
    shutil.copy2(out/'children'/'back-id.png',out/'children'/'back-unlit-id.png')
    np.savez(out/'children-analysis.npz',roots=roots_cap,root_x=roots_cap[:,0],root_y=roots_cap[:,1])
    row={"tag":a.tag,"requested":a.children,"generated":int(len(kids)),"partClosure":True,"partFill":True,
         "frontFill":front_fill,"sameSideAheadOnly":ahead,
         "frontExits":front_exits,"overEyeCheekStrands":over_eye_cheek,"backSeamCount":seam_count,
         "partFrontClosure":pclose,"weightJitter":wj,"layeredClearance":bool(style.get('layered_clearance',False)),
         "nan":int(np.isnan(kids).sum()),"generatorMeta":{"poisson":meta.get("poisson"),"fallback_count":meta.get("fallback_count"),"part_n_extra":meta.get("part_n_extra"),"front_n_extra":(meta.get("poisson")or{}).get("front_n_extra",meta.get("front_n_extra"))},
         "capInfo":cap_info,"profileReadback":sorted(profile),"visible":visible,"renders":renders}
    (out/"children-meta.json").write_text(json.dumps(row,indent=2,default=str)+"\n")
    print("CHILDREN16_DONE",len(kids))

if __name__=="__main__": main()
