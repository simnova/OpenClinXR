"""Hair-look-1 deterministic geometry/render station.

The station rebuilds curtain5/e4 (called b6 here), then evaluates cumulative
g1..g5.  All geometry changes happen before the final collider audit.  Beauty
renders use the accepted hair-light2 material and light rig.
"""
from __future__ import annotations

import argparse, importlib.util, json, math, shutil, sys, time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
CAP = ROOT / "tools/openclinxr/evidence/hair-cap8/cap-v8.npz"
LIGHT_DOC = json.load(open(HERE / "light2-best.json"))
LIGHT = LIGHT_DOC["params"]
SEARCH_BASE = json.load(open(ROOT / "tools/openclinxr/evidence/hair-search2/best.json"))["params"]
VIEWS = ("front", "three_quarter", "profile_90", "back")
P = 32
SEED = 20261014

sys.path.insert(0, str(HERE))
import base_children as ch


def smooth(x):
    x = np.clip(x, 0., 1.)
    return x*x*(3.-2.*x)


def arc(k):
    return np.concatenate([np.zeros((len(k), 1)),
        np.cumsum(np.linalg.norm(np.diff(k, axis=1), axis=2), axis=1)], axis=1)


def pchip_slopes(x, y):
    """Fritsch-Carlson PCHIP slopes, vector y=(points,axes)."""
    h = np.diff(x); delta = np.diff(y, axis=0) / h[:, None]
    d = np.zeros_like(y)
    if len(x) == 2:
        d[:] = delta[0]
        return d
    same = delta[:-1] * delta[1:] > 0
    w1 = (2*h[1:] + h[:-1])[:, None]
    w2 = (h[1:] + 2*h[:-1])[:, None]
    denom = w1/np.where(delta[:-1] != 0, delta[:-1], 1.) + w2/np.where(delta[1:] != 0, delta[1:], 1.)
    d[1:-1] = np.where(same, (w1+w2)/denom, 0.)
    def endpoint(h0,h1,m0,m1):
        z=((2*h0+h1)*m0-h0*m1)/(h0+h1)
        z=np.where(np.sign(z)!=np.sign(m0),0.,z)
        z=np.where((np.sign(m0)!=np.sign(m1))&(np.abs(z)>3*np.abs(m0)),3*m0,z)
        return z
    d[0]=endpoint(h[0],h[1],delta[0],delta[1])
    d[-1]=endpoint(h[-1],h[-2],delta[-1],delta[-2])
    return d


def pchip_resample(kids):
    out=np.empty_like(kids); want=np.linspace(0.,1.,P)
    for i,p in enumerate(kids):
        s=np.r_[0.,np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1))]
        x=s/max(float(s[-1]),1e-12); d=pchip_slopes(x,p)
        j=np.minimum(np.maximum(np.searchsorted(x,want,side="right")-1,0),P-2)
        h=x[j+1]-x[j]; t=(want-x[j])/np.maximum(h,1e-12)
        h00=2*t**3-3*t**2+1;h10=t**3-2*t**2+t
        h01=-2*t**3+3*t**2;h11=t**3-t**2
        out[i]=h00[:,None]*p[j]+h10[:,None]*h[:,None]*d[j]+h01[:,None]*p[j+1]+h11[:,None]*h[:,None]*d[j+1]
    return out


def point_at(p, distance):
    s=np.r_[0.,np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1))]
    q=np.clip(distance,0.,s[-1]);j=min(max(np.searchsorted(s,q)-1,0),len(p)-2)
    t=(q-s[j])/max(s[j+1]-s[j],1e-12)
    return p[j]*(1-t)+p[j+1]*t


def trim_lengths(kids, fraction):
    out=np.empty_like(kids); u=np.linspace(0.,1.,P)
    for i,p in enumerate(kids):
        s=np.r_[0.,np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1))]
        L=s[-1]*float(fraction[i])
        for j,q in enumerate(u*L): out[i,j]=point_at(p,q)
    return out


def replace_bent_hem_with_trim(kids, roots, cd, curve_mm, raise_mm):
    """Apply the b6 U hem by arc-length removal, never by changing tangent."""
    cx=float(cd["cx"]); span=max(float(np.percentile(abs(kids[:,-1,0]-cx),95)),1e-6)
    x=np.clip(abs(kids[:,-1,0]-cx)/span,0,1)
    remove=(float(raise_mm)+float(curve_mm)*x*x)/1000.
    lengths=arc(kids)[:,-1]
    return trim_lengths(kids, np.clip((lengths-remove)/np.maximum(lengths,1e-9),.5,1.))


def clamp_ends_vertical(kids, tail=.040, blend=.030, max_deg=10.):
    out=kids.copy(); max_slope=math.tan(math.radians(max_deg))
    for i,p in enumerate(out):
        s=np.r_[0.,np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1))]; L=s[-1]
        anchor=point_at(p,max(0.,L-tail)); tip=p[-1].copy()
        dz=max(anchor[2]-tip[2],1e-6); lateral=tip[:2]-anchor[:2]
        mag=np.linalg.norm(lateral); cap=dz*max_slope
        target_xy=anchor[:2]+lateral*(min(1.,cap/max(mag,1e-12)))
        # At the strict zero-slope repair preserve the already-safe outward
        # tip position and move the upper tail to it.  Anchoring on the upper
        # point instead would pull the tail into shoulder/clothing colliders.
        strict = max_deg <= 0.
        if strict: target_xy=tip[:2].copy()
        for j in range(P):
            remain=L-s[j]
            if remain > tail+blend: continue
            w=smooth((tail+blend-remain)/blend) if remain>tail else 1.
            q=(L-s[j])/tail
            desired=target_xy if strict else target_xy+(anchor[:2]-target_xy)*q
            out[i,j,:2]=(1-w)*out[i,j,:2]+w*desired
    return out


def local_frames(kids, roots, cd):
    t=np.gradient(kids,axis=1);t/=np.maximum(np.linalg.norm(t,axis=2,keepdims=True),1e-12)
    centre=np.array([float(cd["cx"]),float(cd["Cy"]),float(cd["Cz"])])
    n=kids-centre;n-=t*(n*t).sum(axis=2,keepdims=True);n/=np.maximum(np.linalg.norm(n,axis=2,keepdims=True),1e-12)
    sheet=np.cross(n,t);sheet/=np.maximum(np.linalg.norm(sheet,axis=2,keepdims=True),1e-12)
    return t,n,sheet


def low_frequency(kids, roots, cd):
    rng=np.random.default_rng(SEED+2); a=np.clip(rng.normal(0.,.002,len(kids)),-.004,.004)
    phase=rng.uniform(-math.pi/2,math.pi/2,len(kids)); u=arc(kids)/np.maximum(arc(kids)[:,-1,None],1e-9)
    _,_,sheet=local_frames(kids,roots,cd)
    wave=np.sin(math.pi*u+phase[:,None])-np.sin(phase[:,None])*(1-u)
    return kids+sheet*(a[:,None]*wave)[...,None]


def clump_centres(roots, spacing=.007):
    order=np.random.default_rng(SEED+3).permutation(len(roots)); centres=[]
    for i in order:
        if not centres or np.min(np.linalg.norm(roots[np.asarray(centres)]-roots[i],axis=1))>=spacing: centres.append(int(i))
    return np.asarray(centres,dtype=int)


def subclumps(kids, roots, cd):
    from scipy.spatial import cKDTree  # Blender lacks scipy; use brute-force chunks below instead


def apply_subclumps(kids, roots, cd):
    centres=clump_centres(roots); nearest=np.empty(len(roots),dtype=int)
    for a in range(0,len(roots),1024):
        d=np.linalg.norm(roots[a:a+1024,None,:]-roots[centres][None,:,:],axis=2)
        nearest[a:a+1024]=centres[np.argmin(d,axis=1)]
    rng=np.random.default_rng(SEED+33); active=rng.random(len(kids))<.40
    s=arc(kids);w=.5*smooth(s/.100)*active[:,None]
    _,n,_=local_frames(kids,roots,cd); delta=kids[nearest]-kids
    delta-=n*(delta*n).sum(axis=2,keepdims=True)
    mag=np.linalg.norm(delta,axis=2,keepdims=True);delta*=np.minimum(1.,.002/np.maximum(mag,1e-12))
    return kids+w[...,None]*delta,{"centres":int(len(centres)),"active":int(active.sum()),"weightMax":.5,"radiusMm":2.}


def tips(kids):
    rng=np.random.default_rng(SEED+4); f=rng.uniform(.95,1.05,len(kids)); short=rng.random(len(kids))<.10;f[short]*=.85
    return trim_lengths(kids,np.minimum(f,1.)),{"short15Pct":int(short.sum()),"lengthFactorMin":float(f.min()),"lengthFactorMax":float(f.max())}


def flyaways(kids, roots, cd):
    rng=np.random.default_rng(SEED+5); active=rng.random(len(kids))<.015;amp=rng.uniform(.006,.008,len(kids))*rng.choice((-1.,1.),len(kids));amp*=active
    u=arc(kids)/np.maximum(arc(kids)[:,-1,None],1e-9);_,_,sheet=local_frames(kids,roots,cd)
    return kids+sheet*(amp[:,None]*smooth(u))[...,None],{"active":int(active.sum()),"maxMm":float(np.abs(amp).max()*1000)}


def base_geometry(state):
    bp=state["bp"];gd=np.load(HERE/"guides16.npz");cd=np.load(CAP);style=json.load(open(HERE/"style-b6.json"));meta={}
    override=ch.front_fill_override(bp,cd,50000,bp.SEED,False,float(style["rear_center_fill_factor"]))
    raw=bp._blend_children_base(gd,cd,len(override[0]),bp.SEED,meta,_roots_override=override,
        _closure_on=True,_same_side_ahead_only=True,_weight_jitter=False)
    roots=np.asarray(meta["roots_cap"]);normals=np.asarray(meta["root_nor"])
    raw,semantic=ch.curtain_preserving_children(gd,cd,roots,float(style["curtain_blend_band_mm"]),None,0.,False,True,normals,float(style["support_fade_mm"]))
    raw=ch.apply_side_clearance(raw,roots,semantic,float(cd["cx"]),float(style["curtain_clearance_max_mm"]))
    raw,spread=ch.apply_transfer_spread(raw,roots,semantic,cd,float(style["transfer_spread_mm"]),bp.SEED)
    raw=ch.apply_curtain_transfer(raw,roots,semantic,cd,float(style["curtain_transfer_mm"]),float(style["curtain_transfer_depth_mm"]))
    raw=ch.apply_back_volume(raw,roots,cd,float(style.get("back_width_mm",0.)),float(style.get("back_depth_mm",0.)))
    raw,first=ch.repair_outside(raw,state["handle"])
    b6=ch.apply_rounded_hem(raw.copy(),roots,cd,float(style["hem_u_mm"]),float(style["hem_raise_mm"]))
    ceiling=float(cd["crown"])+float(style["standing_clamp_mm"])/1000.;b6[:,:,2]=np.minimum(b6[:,:,2],ceiling)
    b6,audit=ch.repair_outside(b6,state["handle"])
    common={"roots":roots,"normals":normals,"semantic":semantic,"cd":cd,"style":style,
            "construction":first,"audit":audit,"spread":spread}
    return raw,b6,common


def variants(state):
    raw,b6,c=base_geometry(state);cd=c["cd"];roots=c["roots"];style=c["style"]
    g1=replace_bent_hem_with_trim(raw.copy(),roots,cd,style["hem_u_mm"],style["hem_raise_mm"])
    g1=pchip_resample(g1);g1=clamp_ends_vertical(g1);g1[:,:,2]=np.minimum(g1[:,:,2],float(cd["crown"])+style["standing_clamp_mm"]/1000.);g1,a1=ch.repair_outside(g1,state["handle"])
    g2=low_frequency(g1.copy(),roots,cd);g2,a2=ch.repair_outside(g2,state["handle"])
    g3,cm=apply_subclumps(g2.copy(),roots,cd);g3,a3=ch.repair_outside(g3,state["handle"])
    g4,tm=tips(g3.copy());g4,a4=ch.repair_outside(g4,state["handle"])
    g5,fm=flyaways(g4.copy(),roots,cd);g5,a5=ch.repair_outside(g5,state["handle"])
    return {"b6":b6,"g1":g1,"g2":g2,"g3":g3,"g4":g4,"g5":g5},c,{"b6":c["audit"],"g1":a1,"g2":a2,"g3":a3,"g4":a4,"g5":a5,"g3_clumps":cm,"g4_tips":tm,"g5_flyaways":fm}


def build_state():
    bp=ch.load_blend();c3=bp.import_children3();hs=c3.load_hair_scene();handle=hs.build_scene();canonical=handle.hair
    groups=bp.load_groups_blend();uv=next((x for x in handle.head.data.uv_layers if x.active_render),None);uvn=uv.name if uv else handle.head.data.uv_layers[0].name
    cap_obj,cap_info=c3.build_cap_surface(handle,uvn)
    return {"bp":bp,"c3":c3,"hs":hs,"handle":handle,"canonical":canonical,"groups":groups,"cap":cap_obj,"cap_info":cap_info,
            "light_xy":{x.name:(float(x.location.x),float(x.location.y)) for x in handle.lights}}


def material(state,obj,params):
    mat=state["canonical"].data.materials[0].copy();obj.data.materials.clear();obj.data.materials.append(mat)
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;nodes.clear();out=nodes.new("ShaderNodeOutputMaterial");hair=nodes.new("ShaderNodeBsdfHairPrincipled");hair.parametrization="MELANIN";links.new(hair.outputs[0],out.inputs["Surface"])
    mel=float(params.get("melanin",LIGHT["melanin"]));rough=float(params.get("roughness",LIGHT["roughness"]));hair.inputs["Melanin Redness"].default_value=float(params.get("redness",LIGHT["redness"]));hair.inputs["Radial Roughness"].default_value=.2
    info=nodes.new("ShaderNodeHairInfo");ramp=nodes.new("ShaderNodeValToRGB");ramp.color_ramp.elements[0].position=0.;ramp.color_ramp.elements[0].color=(min(1.,mel*(1+float(params.get("root_dark",LIGHT["root_dark"])))),)*3+(1.,);ramp.color_ramp.elements[1].position=.075;ramp.color_ramp.elements[1].color=(mel,mel,mel,1.);links.new(info.outputs["Intercept"],ramp.inputs["Fac"]);links.new(ramp.outputs["Color"],hair.inputs["Melanin"]);hair.inputs["Roughness"].default_value=rough
    return mat


def lights(state,p):
    target=Vector(state["handle"].target);vals={"OCLX_key":(p.get("key_elev_deg",LIGHT["key_elev_deg"]),p.get("key_energy",LIGHT["key_energy"]),p.get("key_size_m",LIGHT["key_size_m"])),"OCLX_fill":(p.get("fill_elev_deg",LIGHT["fill_elev_deg"]),p.get("fill_W",LIGHT["fill_W"]),1.7),"OCLX_rim":(40.,SEARCH_BASE["rim_W"],1.)}
    for light in state["handle"].lights:
        elev,energy,size=map(float,vals[light.name]);x,y=state["light_xy"][light.name]
        if light.name=="OCLX_key":
            a=math.radians(float(p.get("key_azimuth_delta_deg",LIGHT["key_azimuth_delta_deg"])));dx,dy=x-target.x,y-target.y;x,y=target.x+dx*math.cos(a)-dy*math.sin(a),target.y+dx*math.sin(a)+dy*math.cos(a)
        light.location.x,light.location.y=x,y;rad=math.hypot(x-target.x,y-target.y);light.location.z=target.z+rad*math.tan(math.radians(elev));light.data.energy=energy;light.data.size=size;light.rotation_euler=(target-light.location).to_track_quat("-Z","Y").to_euler()


def object_for(state,kids,tag,tip_taper=False):
    obj=state["bp"].build_blend_curves(state["handle"],state["cap"],kids,"UVMap",tag)
    radii=np.full((len(kids),P),.00005,dtype=np.float32)
    if tip_taper:
        a=arc(kids);remain=a[:,-1,None]-a;u=np.clip((.030-remain)/.030,0,1);radii*=1-.7*smooth(u)
    obj.data.attributes["radius"].data.foreach_set("value",radii.ravel());material(state,obj,LIGHT);return obj


def visibility(state,obj):
    for o in bpy.data.objects:
        if o.type=="CURVES":o.hide_render=o.hide_viewport=(o is not obj)
    state["canonical"].hide_render=state["canonical"].hide_viewport=True;state["cap"].hide_render=state["cap"].hide_viewport=True;obj.hide_render=obj.hide_viewport=False
    state["bp"].apply_r4_visibility(state["handle"],obj)


def render(state,obj,tag,views=VIEWS,size=1024,samples=64,seed=0,filter_width=1.5,params=None):
    out=HERE/"cells"/tag;out.mkdir(parents=True,exist_ok=True);visibility(state,obj);lights(state,params or LIGHT);scene=bpy.context.scene;old=state["handle"].hair;state["handle"].hair=obj;rec={}
    try:
        for view in views:
            state["c3"].set_final_view(state["handle"],view);beauty=out/(view+".png");ident=out/(view+"-id.png");scene.render.resolution_x=scene.render.resolution_y=size;scene.render.resolution_percentage=100;scene.cycles.samples=samples;scene.cycles.seed=seed;scene.render.image_settings.file_format="PNG";scene.render.filter_size=filter_width;scene.render.film_transparent=False;scene.render.filepath=str(beauty);bpy.ops.render.render(write_still=True);state["hs"]._render_id(state["handle"],ident,size);rec[view]={"png":str(beauty),"id_png":str(ident)};print("RENDERED",tag,view,flush=True)
    finally:state["handle"].hair=old
    return rec


def save_geometry(tag,kids,common,audit):
    d=HERE/"cells"/tag;d.mkdir(parents=True,exist_ok=True);np.savez_compressed(d/"strands.npz",points=kids.astype(np.float32),roots=common["roots"].astype(np.float32),apex_y=float(common["cd"]["apex_y"]),cx=float(common["cd"]["cx"]));(d/"audit.json").write_text(json.dumps(audit,indent=2,default=str)+"\n")


def baseline():
    state=build_state();_raw,kids,c=base_geometry(state);save_geometry("b6",kids,c,c["audit"]);obj=object_for(state,kids,"look_b6");render(state,obj,"b6");render(state,obj,"settings-2x",("front",),1024,128,0,1.5);render(state,obj,"settings-filter10",("front",),1024,64,0,1.0);(HERE/"baseline-station.json").write_text(json.dumps({"interpolants":{"guideStation":"centripetal Hermite (hair-curtain5/guides.py:436)","curtainTransfer":"linear numpy.interp (base_children.py:280)","b6FinalResample":"none"},"lightParams":LIGHT,"audit":c["audit"]},indent=2,default=str)+"\n");print("BASELINE_DONE",flush=True)


def one_cell(tag,parent):
    state=build_state();cd=np.load(CAP);extra={}
    if tag=="g1":
        raw,_b6,c=base_geometry(state);roots=c["roots"];style=c["style"]
        kids=replace_bent_hem_with_trim(raw.copy(),roots,cd,style["hem_u_mm"],style["hem_raise_mm"])
        kids=pchip_resample(kids);kids=clamp_ends_vertical(kids);kids[:,:,2]=np.minimum(kids[:,:,2],float(cd["crown"])+style["standing_clamp_mm"]/1000.)
        # Collision projection can reintroduce a lateral tail.  Re-clamp to a
        # zero-slope target, then subject that result to the final audit too.
        kids,_preaudit=ch.repair_outside(kids,state["handle"])
        kids=clamp_ends_vertical(kids,tail=.040,blend=.030,max_deg=0.)
    else:
        src=np.load(HERE/"cells"/parent/"strands.npz");kids=np.asarray(src["points"],float);roots=np.asarray(src["roots"],float);c={"roots":roots,"cd":cd}
        if tag=="g2":kids=low_frequency(kids,roots,cd)
        elif tag=="g3":kids,extra=apply_subclumps(kids,roots,cd)
        elif tag=="g4":
            kids,extra=tips(kids);kids,_preaudit=ch.repair_outside(kids,state["handle"]);kids=clamp_ends_vertical(kids,tail=.040,blend=.030,max_deg=0.)
        elif tag=="g5":
            kids,extra=flyaways(kids,roots,cd);kids,_preaudit=ch.repair_outside(kids,state["handle"]);kids=clamp_ends_vertical(kids,tail=.040,blend=.030,max_deg=0.)
        else:raise ValueError(tag)
    kids,audit=ch.repair_outside(kids,state["handle"]);save_geometry(tag,kids,c,audit);obj=object_for(state,kids,"look_"+tag,tip_taper=tag in ("g4","g5"));rec=render(state,obj,tag)
    (HERE/"cells"/tag/"station.json").write_text(json.dumps({"tag":tag,"parent":parent,"audit":audit,"extra":extra,"renders":rec},indent=2,default=str)+"\n");print("CELL_DONE",tag,parent,flush=True)


def rerender(tag,params,seed=0,size=1024,samples=64,out_tag=None):
    state=build_state();kids=np.load(HERE/"cells"/tag/"strands.npz")["points"];obj=object_for(state,kids,"look_"+tag,tip_taper=tag in ("g4","g5","g6"));material(state,obj,params);LIGHT.update(params);render(state,obj,out_tag or tag,VIEWS,size,samples,seed)


def main():
    ap=argparse.ArgumentParser();ap.add_argument("phase",choices=("baseline","cell","rerender"));ap.add_argument("--tag");ap.add_argument("--parent",default="b6");ap.add_argument("--params");ap.add_argument("--out-tag");ap.add_argument("--seed",type=int,default=0)
    argv=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else sys.argv[1:]
    a=ap.parse_args(argv)
    if a.phase=="baseline":baseline()
    elif a.phase=="cell":one_cell(a.tag,a.parent)
    else:rerender(a.tag,json.load(open(a.params)),a.seed,out_tag=a.out_tag)

if __name__=="__main__":main()
