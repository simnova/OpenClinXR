"""Run hair-part's own 50k child generator and five-view render path."""
import argparse, importlib.util, json, sys
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent
BL=HERE/"children_station.py"

def load_blend():
    s=importlib.util.spec_from_file_location("hair_part_blend16",BL)
    m=importlib.util.module_from_spec(s); sys.modules[s.name]=m; s.loader.exec_module(m); return m

def front_fill_override(bp, cd, n, seed):
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
    pinfo=dict(pinfo,part_n_extra=int(n_part),front_n_extra=int(n_front),front_band_area_cm2=band_area*1e4)
    return roots,nors,pinfo

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
    if front_fill:
        override=front_fill_override(bp,cd,a.children,bp.SEED)
        kids=bp._blend_children_base(gd,cd,len(override[0]),bp.SEED,meta,_roots_override=override,
          _closure_on=True,_same_side_ahead_only=ahead)
    else:
        kids=bp.blend_children(gd,cd,a.children,bp.SEED,meta,part_closure=True,part_fill=True,
          same_side_ahead_only=ahead)
    cx=float(cd['cx']);can=max(abs(float(cd['canthus_L'][0])-cx),abs(float(cd['canthus_R'][0])-cx))
    face=((np.abs(kids[:,:,0]-cx)<=can)&(kids[:,:,2]<=float(cd['brow_z']))&(kids[:,:,2]>=float(cd['menton_z']))&(kids[:,:,1]<0))
    front_exits=int(face.any(axis=1).sum())
    seam=((np.abs(kids[:,:,0]-cx)<=.010)&(kids[:,:,1]>=float(cd['apex_y'])))
    seam_count=int(seam.any(axis=1).sum())
    obj=bp.build_blend_curves(handle,cap_obj,kids,"UVMap","guides16_children")
    _,profile=bp.add_profile(c3,obj,groups,0.00005); visible=bp.apply_r4_visibility(handle,obj)
    renders=bp.render_views_blend(c3,hs,handle,canonical,cap_obj,obj,out,"children",size=1024,samples=64)
    row={"tag":a.tag,"requested":a.children,"generated":int(len(kids)),"partClosure":True,"partFill":True,
         "frontFill":front_fill,"sameSideAheadOnly":ahead,
         "frontExits":front_exits,"backSeamCount":seam_count,
         "nan":int(np.isnan(kids).sum()),"generatorMeta":{"poisson":meta.get("poisson"),"fallback_count":meta.get("fallback_count"),"part_n_extra":meta.get("part_n_extra"),"front_n_extra":(meta.get("poisson")or{}).get("front_n_extra",meta.get("front_n_extra"))},
         "capInfo":cap_info,"profileReadback":sorted(profile),"visible":visible,"renders":renders}
    (out/"children-meta.json").write_text(json.dumps(row,indent=2,default=str)+"\n")
    print("CHILDREN16_DONE",len(kids))

if __name__=="__main__": main()
