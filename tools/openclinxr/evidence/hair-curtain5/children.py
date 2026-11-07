"""Run hair-part's own 50k child generator and five-view render path."""
import argparse, importlib.util, json, shutil, sys
from pathlib import Path
import numpy as np
from mathutils import Vector

HERE=Path(__file__).resolve().parent
BL=HERE/"children_station.py"

def load_blend():
    s=importlib.util.spec_from_file_location("hair_part_blend16",BL)
    m=importlib.util.module_from_spec(s); sys.modules[s.name]=m; s.loader.exec_module(m); return m

def front_fill_override(bp, cd, n, seed, part_front_closure=False, rear_center_fill_factor=0.):
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
    n_rear=0
    if rear_center_fill_factor>0:
        # M3/e2: the registered ID mask proves a child-density hole at x=0.
        # Sample the cap faces beside the rear continuation of the slit; do not
        # change guides or cross-side parent labels.
        rear=np.nonzero((np.abs(cent[:,0]-cx)<=.0075)&(cent[:,1]>=apex_y))[0]
        ra=area[rear];rear_area=float(ra.sum())
        n_rear=int(round(n*rear_area/max(total,1e-18)*float(rear_center_fill_factor)))
        if n_rear:
            rrng=np.random.default_rng((seed+733)&0xffffffff);rcum=np.cumsum(ra/ra.sum())
            rfi=rear[np.minimum(np.searchsorted(rcum,rrng.random(n_rear)),len(rear)-1)]
            rs=rrng.random(n_rear);rt=rrng.random(n_rear);rsq=np.sqrt(rs)
            rroots=(1-rsq)[:,None]*verts[faces[rfi,0]]+(rsq*(1-rt))[:,None]*verts[faces[rfi,1]]+(rsq*rt)[:,None]*verts[faces[rfi,2]]
            rn=np.cross(verts[faces[rfi,1]]-verts[faces[rfi,0]],verts[faces[rfi,2]]-verts[faces[rfi,0]])
            rn/=np.maximum(np.linalg.norm(rn,axis=1,keepdims=True),1e-12)
            ref=np.c_[rroots[:,0]-cx,rroots[:,1]-cy,np.full(n_rear,.05)];rn[(rn*ref).sum(axis=1)<0]*=-1
            roots=np.concatenate([roots,rroots]);nors=np.concatenate([nors,rn])
    if part_front_closure:
        ahead=np.where(roots[:,1] < apex_y)[0]
        order=ahead[np.argsort(np.abs(roots[ahead,0]-cx))]
        take=order[:max(24,int(round(.008*len(roots))))]
        rng2=np.random.default_rng((seed+509)&0xffffffff)
        side=np.where(roots[take,0]<cx,-1.,1.)
        roots[take,0]=cx+side*rng2.uniform(.0003,.0030,len(take))
    pinfo=dict(pinfo,part_n_extra=int(n_part),front_n_extra=int(n_front),front_band_area_cm2=band_area*1e4,
               rear_center_n_extra=int(n_rear),rear_center_fill_factor=float(rear_center_fill_factor))
    return roots,nors,pinfo

def smooth(u):
    u=np.clip(u,0.,1.);return u*u*(3.-2.*u)

def curtain_guide_mask(gd,cd,inner_limit_mm=None):
    """Exact rev4 front-corner+temple selection, optionally expanded inward."""
    roots=np.asarray(gd['roots']);lift=np.asarray(gd['liftoff']);cx=float(cd['cx']);cy=float(cd['Cy'])
    az=np.degrees(np.arctan2(np.abs(roots[:,0]-cx),-(roots[:,1]-cy)))
    sector=az<70.
    if inner_limit_mm is None:
        lim=np.where(lift[:,0]>=cx,.1921*.2107,.2004*.2107)
    else:
        lim=np.full(len(roots),float(inner_limit_mm)/1000.)
    out=sector & (np.abs(lift[:,0]-cx)>=lim)
    if 'frontal_drape' in gd.files:out|=np.asarray(gd['frontal_drape'],bool)
    return out

def _continuous_frame_offset(blend, delta, root_normals, fade_mm, support_center):
    """Transport each cap offset in a continuous guide-local support frame."""
    tang=np.gradient(blend,axis=1);tang/=np.maximum(np.linalg.norm(tang,axis=2,keepdims=True),1e-12)
    normal=np.empty_like(blend);n0=root_normals-(root_normals*tang[:,0]).sum(axis=1)[:,None]*tang[:,0]
    n0/=np.maximum(np.linalg.norm(n0,axis=1,keepdims=True),1e-12);normal[:,0]=n0
    for j in range(1,blend.shape[1]):
        n=np.c_[blend[:,j,0]-support_center[0],blend[:,j,1]-support_center[1],np.zeros(len(blend))]
        n-=((n*tang[:,j]).sum(axis=1))[:,None]*tang[:,j]
        bad=np.linalg.norm(n,axis=1)<1e-8
        if bad.any():n[bad]=normal[bad,j-1]-(normal[bad,j-1]*tang[bad,j]).sum(axis=1)[:,None]*tang[bad,j]
        normal[:,j]=n/np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)
    lateral=np.cross(tang,normal);lateral/=np.maximum(np.linalg.norm(lateral,axis=2,keepdims=True),1e-12)
    a=(delta*tang[:,0]).sum(axis=1);b=(delta*normal[:,0]).sum(axis=1);c=(delta*lateral[:,0]).sum(axis=1)
    arc=np.concatenate([np.zeros((len(blend),1)),np.cumsum(np.linalg.norm(np.diff(blend,axis=1),axis=2),axis=1)],axis=1)
    fade=1.-smooth(arc/max(float(fade_mm)/1000.,1e-6))
    # Tangential mismatch is attachment-only. Surface-normal and lateral
    # offsets taper continuously, leaving collision-free guide tails intact.
    tangent_fade=1.-smooth(arc/.020)
    return blend+tang*(a[:,None]*tangent_fade)[...,None]+normal*b[:,None,None]+lateral*c[:,None,None]

def subset_blend(gd,roots,candidates,side_mask,allow_cross_side_behind=False,apex_y=None,
                 continuous_support=False,root_normals=None,support_fade_mm=70.,support_center=(0.,0.)):
    """Four-neighbour IDW inside one semantic guide population and side."""
    gr=np.asarray(gd['roots']);gp=np.asarray(gd['points']);out=np.empty((len(roots),gp.shape[1],3),float)
    parent=np.full((len(roots),4),-1,np.int32);nearest=np.full(len(roots),np.inf)
    groups=[]
    if allow_cross_side_behind:
        ahead=roots[:,1] < float(apex_y)
        for side in (False,True):groups.append((np.where(ahead & (side_mask==side))[0],np.where(candidates & ((gr[:,0]>=0)==side))[0]))
        groups.append((np.where(~ahead)[0],np.where(candidates)[0]))
    else:
        groups=[(np.where(side_mask==side)[0],np.where(candidates & ((gr[:,0]>=0)==side))[0]) for side in (False,True)]
    for ids,cand in groups:
        if not len(ids):continue
        if not len(cand):raise RuntimeError('semantic guide population empty on side %s'%side)
        for a in range(0,len(ids),1024):
            take=ids[a:a+1024];dist=np.linalg.norm(roots[take,None,:]-gr[cand][None,:,:],axis=2)
            k=min(4,len(cand));near=np.argpartition(dist,k-1,axis=1)[:,:k];dd=np.take_along_axis(dist,near,axis=1)
            order=np.argsort(dd,axis=1);near=np.take_along_axis(near,order,axis=1);dd=np.take_along_axis(dd,order,axis=1)
            w=1/np.maximum(dd,1e-6);w/=w.sum(axis=1,keepdims=True);cur=gp[cand[near]]
            blend=np.einsum('bk,bkpc->bpc',w,cur)
            delta=roots[take]-blend[:,0]
            if continuous_support:
                blend=_continuous_frame_offset(blend,delta,root_normals[take],support_fade_mm,support_center)
            else:
                blend+=delta[:,None,:]
                arc=np.concatenate([np.zeros((len(take),1)),np.cumsum(np.linalg.norm(np.diff(blend,axis=1),axis=2),axis=1)],axis=1)
                blend[:,:,0]-=delta[:,0,None]*smooth(arc/.040)
            out[take]=blend
            parent[take,:k]=cand[near];nearest[take]=dd[:,0]
    return out,parent,nearest

def curtain_preserving_children(gd,cd,roots,blend_band_mm=12.,inner_limit_mm=None,root_inward_mm=0.,rear_cross_side_behind=False,
                                continuous_support=False,root_normals=None,support_fade_mm=70.):
    """Two-population interpolation with a cosine band across their cap boundary."""
    cx=float(cd['cx']);side=roots[:,0]>=cx;curtain=curtain_guide_mask(gd,cd,inner_limit_mm)
    centre=(float(cd['cx']),float(cd['Cy']))
    c,p_c,d_c=subset_blend(gd,roots,curtain,side,continuous_support=continuous_support,root_normals=root_normals,support_fade_mm=support_fade_mm,support_center=centre)
    r,p_r,d_r=subset_blend(gd,roots,~curtain,side,rear_cross_side_behind,float(cd['apex_y']),continuous_support,root_normals,support_fade_mm,centre)
    signed=d_r-d_c+float(root_inward_mm)/1000.;half=float(blend_band_mm)/2000.;wc=smooth((signed+half)/(2*half))
    kids=wc[:,None,None]*c+(1-wc)[:,None,None]*r
    region=signed>=0.
    return kids,{'curtain_guides':curtain,'curtain_region':region,'curtain_weight':wc,
                 'curtain_parents':p_c,'rear_parents':p_r,'distance_curtain_m':d_c,'distance_rear_m':d_r}

def arc_of(kids):
    return np.concatenate([np.zeros((len(kids),1)),np.cumsum(np.linalg.norm(np.diff(kids,axis=1),axis=2),axis=1)],axis=1)

def apply_side_clearance(kids,roots,info,cx,clear_max_mm):
    if clear_max_mm<=8.:return kids
    sel=info['curtain_region'];rd=np.abs(roots[:,0]-cx);rank=np.zeros(len(roots))
    if sel.any():
        lo,hi=float(rd[sel].min()),float(rd[sel].max());rank=np.clip((rd-lo)/max(hi-lo,1e-9),0,1)
    delta=(float(clear_max_mm)-8.)/1000.*rank*info['curtain_weight']
    fade=smooth(arc_of(kids)/.040);sgn=np.where(roots[:,0]>=cx,1.,-1.)
    kids[:,:,0]+=sgn[:,None]*delta[:,None]*fade
    return kids

def apply_crown_thickness(kids,roots,normals,cd,lift_mm):
    """Crown/part lift: zero at root, reaches L over the first 30mm."""
    cx=float(cd['cx']);top=(roots[:,2]>=float(cd['crown'])-.030)|(np.abs(roots[:,0]-cx)<=.012)
    ramp=smooth(arc_of(kids)/.030)
    # Confine it to the crown sheet: taper back out from 30 to 90mm arc.
    taper=1.-smooth(np.clip((arc_of(kids)-.030)/.060,0,1))
    kids[top]+=normals[top,None,:]*(float(lift_mm)/1000.)*(ramp[top]*taper[top])[...,None]
    return kids,top

def resample_smooth(kids,cd):
    """Uniform-arc resample plus capped Laplacian smoothing (32 points)."""
    out=np.empty_like(kids);u=np.linspace(0.,1.,kids.shape[1])
    for i in range(len(kids)):
        s=np.r_[0.,np.cumsum(np.linalg.norm(np.diff(kids[i],axis=0),axis=1))]
        q=s/max(float(s[-1]),1e-9)
        for axis in range(3):out[i,:,axis]=np.interp(u,q,kids[i,:,axis])
    total_move=np.zeros(out.shape[:2])
    centre=np.array([float(cd['cx']),float(cd['Cy']),float(cd['Cz'])])
    for _ in range(3):
        proposal=out.copy();proposal[:,1:-1]=.25*out[:,:-2]+.5*out[:,1:-1]+.25*out[:,2:]
        delta=proposal-out;mag=np.linalg.norm(delta,axis=2);scale=np.minimum(1.,.0015/np.maximum(mag,1e-12));delta*=scale[...,None]
        radial=out-centre;rl=np.maximum(np.linalg.norm(radial,axis=2,keepdims=True),1e-9);radial/=rl
        inward=(delta*radial).sum(axis=2)<0
        protected=inward&(out[:,:,2]>=float(cd['menton_z']))
        delta[protected]-=((delta[protected]*radial[protected]).sum(axis=1))[:,None]*radial[protected]
        delta[:,0]=0;delta[:,-1]=0;out+=delta;total_move+=np.linalg.norm(delta,axis=2)
    return out,{'max_move_mm':float(total_move.max()*1000),'p95_move_mm':float(np.percentile(total_move,95)),'iterations':3,'cap_per_iteration_mm':1.5}

def repair_outside(kids,handle,clearance_mm=.2,include_detail=False):
    """Project penetrations out with the frozen guide gate's exact colliders."""
    s=importlib.util.spec_from_file_location('hair_curtain3_collision_guides',HERE/'guides.py')
    gm=importlib.util.module_from_spec(s);sys.modules[s.name]=gm;s.loader.exec_module(gm)
    objs,bvhs=gm.colliders(handle);flat=kids.reshape(-1,3);moved=np.zeros(len(flat),bool)
    before={};post={};max_move=0.
    passes=3
    for pass_no in range(passes):
        counts={o.name:0 for o in objs}
        for obj in objs:
            bvh=bvhs[obj.name]
            for i,p in enumerate(flat):
                q,n,_,dist=bvh.find_nearest(Vector(tuple(p)))
                if q is None or float(dist)>gm.STYLE['query_limit']:continue
                sd=float(dist) if float((Vector(tuple(p))-q).dot(n))>=0 else -float(dist)
                if sd<0:
                    shift=(-sd+clearance_mm/1000.)*np.asarray(n,float)
                    flat[i]+=shift;moved[i]=True;counts[obj.name]+=1
                    max_move=max(max_move,float(np.linalg.norm(shift))*1000.)
        if pass_no==0:before=counts
        if not sum(counts.values()):break
    residual=set()
    for obj in objs:
        bvh=bvhs[obj.name];count=0
        for i,p in enumerate(flat):
            sd=gm.signed_distance(bvh,p)
            if sd is not None and sd<0:count+=1;residual.add(i)
        post[obj.name]=count
    # A handful of points can oscillate inside overlapping head/shirt BVHs.
    # Final-audit relocation uses the nearest already-safe point on the same
    # polyline; it neither deletes a strand nor claims an impossible projection.
    relocated=0;npts=kids.shape[1]
    for idx in sorted(residual):
        strand,j=divmod(idx,npts)
        for radius in range(1,npts):
            found=False
            for qj in (j-radius,j+radius):
                if qj<0 or qj>=npts:continue
                q=kids[strand,qj]
                if all((gm.signed_distance(bvhs[o.name],q) is None or gm.signed_distance(bvhs[o.name],q)>=0) for o in objs):
                    flat[idx]=q;relocated+=1;found=True;break
            if found:break
    if relocated:
        post={}
        for obj in objs:
            bvh=bvhs[obj.name];post[obj.name]=sum(1 for p in flat if (gm.signed_distance(bvh,p) is not None and gm.signed_distance(bvh,p)<0))
    row={'colliders':[o.name for o in objs],'first_pass_inside':before,
                 'post_inside':post,'post_inside_total':sum(post.values()),
                 'moved_points':int(moved.sum()),'max_single_projection_mm':max_move,
                 'clearance_mm':clearance_mm,'passes':passes,'audit_relocated_points':relocated}
    if include_detail:row['moved_point_mask_shape']=[int(x) for x in kids.shape[:2]]
    return kids,row

def apply_back_volume(kids,roots,cd,width_mm,depth_mm):
    """Spread only the rear sheet below nape; scalp points are unchanged."""
    if width_mm==0 and depth_mm==0:return kids
    cx=float(cd['cx']);apex=float(cd['apex_y']);menton=float(cd['menton_z'])
    rear=roots[:,1]>=apex
    fall=smooth(np.clip((menton-kids[:,:,2])/.075,0,1))
    side=np.where(roots[:,0]>=cx,1.,-1.)
    kids[:,:,0]+=rear[:,None]*side[:,None]*(width_mm/1000.)*fall
    kids[:,:,1]+=rear[:,None]*(depth_mm/1000.)*fall
    return kids

def apply_rounded_hem(kids,roots,cd,curve_mm,raise_mm=0.):
    """Target-mask U: raise the whole hem, increasingly toward the sides."""
    if curve_mm==0 and raise_mm==0:return kids
    cx=float(cd['cx']);span=max(float(np.percentile(abs(kids[:,-1,0]-cx),95)),1e-6)
    x=np.clip(abs(kids[:,-1,0]-cx)/span,0,1)
    dz=(raise_mm+curve_mm*x*x)/1000.
    for i in range(len(kids)):
        kids[i,-4:,2]+=dz[i]*np.linspace(.2,1.,4)
    return kids

def apply_curtain_transfer(kids,roots,info,cd,width_mm,depth_mm):
    """Slide side-curtain strands outward/down over trapezius into sheet edge."""
    if info is None or (width_mm==0 and depth_mm==0):return kids
    cx=float(cd['cx']);earz=.5*(float(cd['pinna_lobe_L'][2])+float(cd['pinna_lobe_R'][2]))
    sel=np.asarray(info['curtain_region'],bool)&(roots[:,1]<float(cd['apex_y']));fade=smooth(np.clip((earz-kids[:,:,2])/.090,0,1))
    side=np.where(roots[:,0]>=cx,1.,-1.)
    kids[:,:,0]+=sel[:,None]*side[:,None]*(width_mm/1000.)*fade
    kids[:,:,1]+=sel[:,None]*(depth_mm/1000.)*fade
    return kids

def apply_transfer_spread(kids,roots,info,cd,spread_mm,seed=16):
    """Spread the inherited fixed-height front-to-rear bend across strands."""
    if info is None or spread_mm<=0:return kids,{'count':0,'heightStdMm':0.}
    sel=np.asarray(info['curtain_region'],bool);ids=np.where(sel)[0];cx=float(cd['cx']);menton=float(cd['menton_z'])
    rank=np.clip(np.abs(roots[ids,0]-cx)/max(float(np.percentile(np.abs(roots[ids,0]-cx),95)),1e-9),0,1)
    rng=np.random.default_rng(int(seed)+1201);shift=(rank-.5)*(spread_mm/1000.)+rng.uniform(-.0015,.0015,len(ids))
    out=kids.copy();heights=[]
    for n,i in enumerate(ids):
        g=kids[i];order=np.argsort(g[:,2]);zasc=g[order,2];yasc=g[order,1];heights.append(menton-.020+shift[n])
        shifted=np.interp(g[:,2]+shift[n],zasc,yasc,left=yasc[0],right=yasc[-1])
        band=smooth(np.clip((menton-.020-g[:,2])/.045,0,1))*(1-smooth(np.clip((menton-.105-g[:,2])/.035,0,1)))
        out[i,:,1]=(1-band)*g[:,1]+band*shifted
    return out,{'count':int(len(ids)),'heightStdMm':float(np.std(heights)*1000),'minShiftMm':float(shift.min()*1000),'maxShiftMm':float(shift.max()*1000),
                'surface':'seeded lateral-monotone transfer-height interpolation'}

def apply_flare_cap(kids,cd,extra_mm):
    """Cap shoulder outward x at the TS outer edge plus the brief's margin."""
    if extra_mm<=0:return kids,0
    crown=float(cd['crown']);z567=crown-(567-103)/((583-103)/.2107);z621=crown-(621-103)/((583-103)/.2107)
    lo,hi=min(z567,z621),max(z567,z621);changed=0
    for j in range(kids.shape[1]):
        z=kids[:,j,2];u=np.clip((z567-z)/max(z567-z621,1e-9),0,1);limit=(93.3+(97.2-93.3)*u+float(extra_mm))/1000.
        active=(z>=lo-.015)&(z<=hi+.015)&(np.abs(kids[:,j,0]-float(cd['cx']))>limit)
        changed+=int(active.sum());kids[active,j,0]=float(cd['cx'])+np.sign(kids[active,j,0]-float(cd['cx']))*limit[active]
    return kids,changed

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
    rear_fill=float(style.get('rear_center_fill_factor',0.))
    if front_fill:
        override=front_fill_override(bp,cd,a.children,bp.SEED,pclose,rear_fill)
        kids=bp._blend_children_base(gd,cd,len(override[0]),bp.SEED,meta,_roots_override=override,
          _closure_on=True,_same_side_ahead_only=ahead,_weight_jitter=wj)
    else:
        kids=bp.blend_children(gd,cd,a.children,bp.SEED,meta,part_closure=True,part_fill=True,
          same_side_ahead_only=ahead,weight_jitter=wj)
    roots_cap=np.asarray(meta.get('roots_cap'));root_nor=np.asarray(meta.get('root_nor'))
    semantic=None;crown_top=np.zeros(len(roots_cap),bool);smooth_meta=None
    transfer_spread_meta=None
    if bool(style.get('curtain_preserving_interpolation',False)):
        kids,semantic=curtain_preserving_children(gd,cd,roots_cap,float(style.get('curtain_blend_band_mm',12.)),style.get('curtain_inner_limit_mm'),float(style.get('curtain_root_inward_mm',0.)),bool(style.get('rear_cross_side_behind',False)),bool(style.get('continuous_support',False)),root_nor,float(style.get('support_fade_mm',70.)))
        kids=apply_side_clearance(kids,roots_cap,semantic,float(cd['cx']),float(style.get('curtain_clearance_max_mm',8.)))
        lift=float(style.get('crown_thickness_mm',0.))
        if lift>0:kids,crown_top=apply_crown_thickness(kids,roots_cap,root_nor,cd,lift)
        kids,transfer_spread_meta=apply_transfer_spread(kids,roots_cap,semantic,cd,float(style.get('transfer_spread_mm',0.)),bp.SEED)
        kids=apply_curtain_transfer(kids,roots_cap,semantic,cd,float(style.get('curtain_transfer_mm',0.)),float(style.get('curtain_transfer_depth_mm',0.)))
        kids=apply_back_volume(kids,roots_cap,cd,float(style.get('back_width_mm',0.)),float(style.get('back_depth_mm',0.)))
    construction_meta=None
    if bool(style.get('construction_clearance',False)):
        kids,construction_meta=repair_outside(kids,handle)
    if bool(style.get('resample_smooth',False)):
        kids,smooth_meta=resample_smooth(kids,cd)
    kids=apply_rounded_hem(kids,roots_cap,cd,float(style.get('hem_u_mm',0.)),float(style.get('hem_raise_mm',0.)))
    flare_changed=0
    kids,flare_changed=apply_flare_cap(kids,cd,float(style.get('flare_cap_extra_mm',0.)))
    standing_clamped=0
    if bool(style.get('standing_clamp',False)):
        ceiling=float(cd['crown'])+float(style.get('standing_clamp_mm',-4.))/1000.
        high=kids[:,:,2]>ceiling
        standing_clamped=int(high.sum());kids[:,:,2]=np.minimum(kids[:,:,2],ceiling)
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
    collision_meta=None
    if bool(style.get('curtain_preserving_interpolation',False)):
        kids,collision_meta=repair_outside(kids,handle)
    cx=float(cd['cx']);can=max(abs(float(cd['canthus_L'][0])-cx),abs(float(cd['canthus_R'][0])-cx))
    face=((np.abs(kids[:,:,0]-cx)<=can)&(kids[:,:,2]<=float(cd['brow_z']))&(kids[:,:,2]>=float(cd['menton_z']))&(kids[:,:,1]<float(cd['cy'])))
    front_exits=int(face.any(axis=1).sum());over_eye_cheek=int(face.any(axis=1).sum())
    seam=((np.abs(kids[:,:,0]-cx)<=.010)&(kids[:,:,1]>=float(cd['apex_y'])))
    seam_count=int(seam.any(axis=1).sum())
    obj=bp.build_blend_curves(handle,cap_obj,kids,"UVMap","guides16_children")
    _,profile=bp.add_profile(c3,obj,groups,0.00005); visible=bp.apply_r4_visibility(handle,obj)
    renders=bp.render_views_blend(c3,hs,handle,canonical,cap_obj,obj,out,"children",size=1024,samples=64)
    shutil.copy2(out/'children'/'back-id.png',out/'children'/'back-unlit-id.png')
    analysis={'roots':roots_cap,'root_x':roots_cap[:,0],'root_y':roots_cap[:,1],'crown_top':crown_top}
    if semantic:
        analysis.update({k:v for k,v in semantic.items()})
    np.savez(out/'children-analysis.npz',**analysis)
    row={"tag":a.tag,"requested":a.children,"generated":int(len(kids)),"partClosure":True,"partFill":True,
         "frontFill":front_fill,"sameSideAheadOnly":ahead,
         "frontExits":front_exits,"overEyeCheekStrands":over_eye_cheek,"backSeamCount":seam_count,
         "partFrontClosure":pclose,"weightJitter":wj,"layeredClearance":bool(style.get('layered_clearance',False)),
         "curtainPreserving":bool(style.get('curtain_preserving_interpolation',False)),
         "curtainGuides":int(semantic['curtain_guides'].sum()) if semantic else 0,
         "curtainChildren":int(semantic['curtain_region'].sum()) if semantic else 0,
         "blendBandChildren":int(((semantic['curtain_weight']>0)&(semantic['curtain_weight']<1)).sum()) if semantic else 0,
         "curtainBlendBandMm":style.get('curtain_blend_band_mm'),"curtainInnerLimitMm":style.get('curtain_inner_limit_mm'),"curtainRootInwardMm":style.get('curtain_root_inward_mm',0),
         "curtainClearanceMaxMm":style.get('curtain_clearance_max_mm'),"crownThicknessMm":style.get('crown_thickness_mm',0),
         "continuousSupport":bool(style.get('continuous_support',False)),"supportFadeMm":style.get('support_fade_mm'),
         "resampleSmooth":bool(style.get('resample_smooth',False)),"smoothMeta":smooth_meta,
         "constructionClearance":construction_meta,"rearCrossSideBehind":bool(style.get('rear_cross_side_behind',False)),
         "backWidthMm":style.get('back_width_mm',0),"backDepthMm":style.get('back_depth_mm',0),"hemUMm":style.get('hem_u_mm',0),"hemRaiseMm":style.get('hem_raise_mm',0),
         "curtainTransferMm":style.get('curtain_transfer_mm',0),"curtainTransferDepthMm":style.get('curtain_transfer_depth_mm',0),
         "rearCenterFillFactor":rear_fill,"transferSpreadMm":style.get('transfer_spread_mm',0),"transferSpreadMeta":transfer_spread_meta,
         "flareCapExtraMm":style.get('flare_cap_extra_mm',0),"flareCappedPoints":flare_changed,
         "standingClamp":bool(style.get('standing_clamp',False)),"standingClampMm":style.get('standing_clamp_mm'),"standingClampedPoints":standing_clamped,
         "collisionRepair":collision_meta,
         "nan":int(np.isnan(kids).sum()),"generatorMeta":{"poisson":meta.get("poisson"),"fallback_count":meta.get("fallback_count"),"part_n_extra":meta.get("part_n_extra"),"front_n_extra":(meta.get("poisson")or{}).get("front_n_extra",meta.get("front_n_extra"))},
         "capInfo":cap_info,"profileReadback":sorted(profile),"visible":visible,"renders":renders}
    (out/"children-meta.json").write_text(json.dumps(row,indent=2,default=str)+"\n")
    print("CHILDREN16_DONE",len(kids))

if __name__=="__main__": main()
