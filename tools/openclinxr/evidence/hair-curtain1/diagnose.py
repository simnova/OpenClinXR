"""M1 measurements for hair-curtain-1; run before curtain_hull."""
import importlib.util,json,math,sys
from pathlib import Path
import bpy,numpy as np
from mathutils import Vector
from PIL import Image

E=Path(__file__).resolve().parent
CAP=E.parent/'hair-cap8'/'cap-v8.npz'
J=Path('/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge')
TARGET=J/'target-set-back'/'mask-front-v2.png'
HH=.2107; HPX=481.

def module(name,path):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m

def world_mesh(obj):
    deps=bpy.context.evaluated_depsgraph_get();ev=obj.evaluated_get(deps);me=ev.to_mesh()
    v=np.asarray([tuple(ev.matrix_world@q.co) for q in me.vertices],float);fs=[tuple(p.vertices) for p in me.polygons];ev.to_mesh_clear()
    f=[]
    for q in fs:
        for i in range(1,len(q)-1):f.append((q[0],q[i],q[i+1]))
    return v,np.asarray(f,int)

def section(v,f,z):
    out=[]
    for t in v[f]:
        for a,b in ((t[0],t[1]),(t[1],t[2]),(t[2],t[0])):
            da,db=float(a[2]-z),float(b[2]-z)
            if da==0:out.append(a[:2])
            if da*db<0:
                u=da/(da-db);out.append((a+u*(b-a))[:2])
    return np.asarray(out,float)

def ear_mask(p,z,cap,cx):
    ex=max(abs(float(cap['pinna_top_L'][0])-cx),abs(float(cap['pinna_top_R'][0])-cx))
    return ((np.abs(p[:,0]-cx)>max(.052,ex-.014))&(np.abs(p[:,1]-float(cap['ear_y']))<.030)&(z<float(cap['ear_top'])+.022))

def sector(a):
    a=abs(a)
    return 'front_corner' if a<35 else ('temple' if a<70 else ('above_ear' if a<105 else ('behind_ear' if a<145 else 'occiput')))

def head_profile(handle,cap):
    v,f=world_mesh(handle.head);cx=float(cap['cx']);cy=float(cap['Cy']);ear=float(cap['ear_top'])
    rows=[]
    for z in np.arange(float(cap['crown']),ear-.0025,-.005):
        raw=section(v,f,z)
        if not len(raw):continue
        clean=raw[~ear_mask(raw,z,cap,cx)]
        if not len(clean):continue
        k=int(np.argmax(np.abs(clean[:,0]-cx)))
        rows.append({'z_m':float(z),'half_width_mm':float(abs(clean[k,0]-cx)*1000),'y_at_max_m':float(clean[k,1]),'half_width_with_ear_mm':float(np.max(np.abs(raw[:,0]-cx))*1000)})
    ex=max(abs(float(cap['pinna_top_L'][0])-cx),abs(float(cap['pinna_top_R'][0])-cx))
    keep=~((np.abs(v[:,0]-cx)>max(.052,ex-.014))&(np.abs(v[:,1]-float(cap['ear_y']))<.030)&(v[:,2]<ear+.022))
    q=v[keep];ang=np.degrees(np.arctan2(np.abs(q[:,0]-cx),-(q[:,1]-cy)));rad=np.hypot(q[:,0]-cx,q[:,1]-cy)
    fine=[]
    for lo in np.arange(0.,180.,5.):
        m=(ang>=lo)&(ang<lo+5)&(q[:,2]>=ear-.010)
        if m.any():
            ids=np.where(m)[0];i=ids[int(np.argmax(rad[m]))]
            fine.append({'theta_lo_deg':float(lo),'theta_hi_deg':float(lo+5),'ridge_z_m':float(q[i,2]),'radius_mm':float(rad[i]*1000)})
    secs={}
    for name in ('front_corner','temple','above_ear','behind_ear','occiput'):
        m=np.asarray([sector(a)==name for a in ang])&(q[:,2]>=ear-.010)
        if m.any():
            ids=np.where(m)[0];i=ids[int(np.argmax(rad[m]))]
            secs[name]={'widest_contour_z_m':float(q[i,2]),'radius_mm':float(rad[i]*1000)}
    return rows,secs,fine,(v,f,cx,cy)

def ridge(root,fine,cx,cy):
    a=math.degrees(math.atan2(abs(float(root[0])-cx),-(float(root[1])-cy)))
    r=min(fine,key=lambda x:abs((x['theta_lo_deg']+x['theta_hi_deg'])/2-a))
    return float(r['ridge_z_m']),a,sector(a)

def target_rows(mask,geom,cap):
    v,f,cx,_=geom;out=[]
    for row in (319,271,223,175,127):
        xx=np.where(mask[row])[0];L=513-int(xx[xx<513].max()) if np.any(xx<513) else None;R=int(xx[xx>513].min())-513 if np.any(xx>513) else None
        z=float(cap['crown'])-(row-127)/HPX*HH;s=section(v,f,z);hw=float(np.max(np.abs(s[:,0]-cx))*1000) if len(s) else None
        mm=lambda p:None if p is None else p/HPX*HH*1000
        out.append({'row_px':row,'z_m':z,'target_inner_L_skull_H':None if L is None else L/HPX,'target_inner_R_skull_H':None if R is None else R/HPX,'target_inner_L_mm':mm(L),'target_inner_R_mm':mm(R),'our_head_plus_ear_half_width_mm':hw,'target_minus_our_L_mm':None if L is None or hw is None else mm(L)-hw,'target_minus_our_R_mm':None if R is None or hw is None else mm(R)-hw})
    return out

def baseline_liftoff(fine,cx,cy,cap):
    d=np.load(E/'cells/g1/guides16.npz');G,R,PH,L=(np.asarray(d[k]) for k in ('points','roots','phases','liftoff'))
    ids=np.where((R[:,1]<float(cap['ear_y']))|(np.abs(R[:,0]-cx)>=.035))[0];rec=[]
    for i in ids:
        rz,a,s=ridge(R[i],fine,cx,cy);sc=G[i][PH[i]==0];below=sc[:,2]<rz;length=0.
        if len(sc)>1:
            seg=np.linalg.norm(np.diff(sc,axis=0),axis=1);length=float(seg[below[:-1]|below[1:]].sum())
        rec.append({'guide':int(i),'sector':s,'azimuth_deg':a,'root_m':R[i].tolist(),'liftoff_z_m':float(L[i,2]),'ridge_z_m':rz,'liftoff_minus_ridge_mm':float((L[i,2]-rz)*1000),'scalp_path_below_ridge_mm':length*1000})
    dz=np.asarray([r['liftoff_minus_ridge_mm'] for r in rec]);path=np.asarray([r['scalp_path_below_ridge_mm'] for r in rec])
    sm={'n_lateral':len(rec),'within_8mm_percent':float(100*np.mean(np.abs(dz)<=8)),'lift_below_ridge_percent':float(100*np.mean(dz<-8)),'median_liftoff_minus_ridge_mm':float(np.median(dz)),'p90_abs_liftoff_minus_ridge_mm':float(np.percentile(np.abs(dz),90)),'median_scalp_path_below_ridge_mm':float(np.median(path)),'p90_scalp_path_below_ridge_mm':float(np.percentile(path,90)),'max_scalp_path_below_ridge_mm':float(np.max(path))}
    sm['cause_verdict']='SUPPORTED' if sm['lift_below_ridge_percent']>10 and sm['median_scalp_path_below_ridge_mm']>5 else 'REFUTED'
    return sm,rec

def region(root,cap):
    cx=float(cap['cx']);front=np.asarray(cap['verts'])[np.asarray(cap['forehead'],int)]
    if len(front) and float(np.linalg.norm(front-root,axis=1).min())<=.030:return 'front_band'
    side=abs(float(root[0])-cx)>=.035
    if side and root[1]<float(cap['ear_y']):return 'temple_side_ahead_ear'
    if side:return 'side_behind_ear'
    if root[1]>float(cap['apex_y'])+.015:return 'back'
    return 'top'

def period(a):
    a=np.asarray(a,float)-np.mean(a);p=np.abs(np.fft.rfft(a))**2;p[0]=0;k=int(np.argmax(p[1:])+1)
    return {'period_px':float(len(a)/k),'power_fraction':float(p[k]/max(p.sum(),1e-12))}

def d2_probe(handle,cap):
    bp=module('curtain_children_station_diag',E/'children_station.py');gd=np.load(E/'cells/g1/guides16.npz');meta={}
    kids=bp.blend_children(gd,cap,50000,bp.SEED,meta,part_closure=True,part_fill=True,same_side_ahead_only=True);roots=np.asarray(meta['roots_cap'])
    names=('front_band','temple_side_ahead_ear','side_behind_ear','back','top');reg=np.asarray([region(r,cap) for r in roots])
    import bpy_extras.object_utils as OU
    sc=bpy.context.scene;cam=handle.camera;cx=float(cap['cx']);ment=float(cap['menton_z']);d=.85
    hv=np.asarray([tuple(handle.head.matrix_world@v.co) for v in handle.head.data.vertices]);tgt=Vector((cx,float(np.median(hv[:,1])),ment+.06));cam.location=tgt+Vector((0,d,.08));cam.rotation_euler=(tgt-cam.location).to_track_quat('-Z','Y').to_euler();bpy.context.view_layer.update()
    den={};canvas=np.zeros((1024,1024,3),np.uint8);colors={'front_band':(255,80,80),'temple_side_ahead_ear':(255,180,40),'side_behind_ear':(70,220,255),'back':(120,255,100),'top':(210,100,255)}
    for name in names:
        hist=np.zeros(1024,float);pts=kids[reg==name][:,::2,:].reshape(-1,3)
        for p in pts:
            uv=OU.world_to_camera_view(sc,cam,Vector(tuple(p)));x=int(np.clip(round(uv.x*1023),0,1023))
            if 0<=uv.y<=1:hist[x]+=1
            y=int(round((1-uv.y)*1023))
            if 0<=x<1024 and 0<=y<1024:canvas[y,x]=colors[name]
        if hist.max():hist/=hist.max()
        den[name]=hist.tolist()
    Image.fromarray(canvas).save(E/'origin-regions-back.png')
    total=np.sum(np.asarray(list(den.values())),axis=0);over=np.sum(np.asarray(list(den.values()))>.25,axis=0)
    base=np.asarray(Image.open(E/'cells/g1/children/back-id.png').convert('L'),float).mean(axis=0)/255.;corr=float(np.corrcoef(base,over)[0,1]) if np.std(over) else 0.
    verdict='SUPPORTED' if corr>=.35 else ('REFUTED' if corr<=.10 else 'UNKNOWN')
    return {'region_counts':{n:int(np.sum(reg==n)) for n in names},'per_region_column_density':den,'combined_density':total.tolist(),'overlap_region_count':over.tolist(),'baseline_column_density':base.tolist(),'baseline_period':period(base),'overlap_vs_bright_band_correlation':corr,'cause_verdict':verdict,'render':'origin-regions-back.png'}

def main():
    g=module('curtain_guides_diag',E/'guides.py');handle=g.load_scene();cap=np.load(CAP)
    prof,secs,fine,geom=head_profile(handle,cap);tr=target_rows(np.asarray(Image.open(TARGET).convert('L'))>127,geom,cap);eye=tr[0];delta=float(np.mean([eye['target_minus_our_L_mm'],eye['target_minus_our_R_mm']]));tv='SUPPORTED' if -5<=delta<=20 else 'REFUTED'
    ls,lr=baseline_liftoff(fine,geom[2],geom[3],cap);d2=d2_probe(handle,cap)
    doc={'schemaVersion':1,'card':'hair-curtain-1','baseline':'hair-sweep3/g1 adopted as b3','measurement_order':'written before curtain_hull first run','head_half_width_profile':prof,'ridge_by_sector':secs,'ridge_fine_azimuth':fine,'target_front_rows':tr,'target_eye_row_registration':{'verdict':tv,'target_minus_our_mean_mm':delta,'support_band_mm':[-5.,20.]},'baseline_lateral_liftoff':{'summary':ls,'records':lr},'D2_origin_overlap':d2,'causes':{'D1':{'verdict':ls['cause_verdict'],'number':ls},'D2':{'verdict':d2['cause_verdict'],'number':{'overlap_vs_bright_band_correlation':d2['overlap_vs_bright_band_correlation'],'period_px':d2['baseline_period']['period_px']}}}}
    (E/'diagnosis.json').write_text(json.dumps(doc,indent=2)+'\n');print(json.dumps({'D1':doc['causes']['D1'],'D2':doc['causes']['D2'],'eye_row':doc['target_eye_row_registration'],'ridge':secs},indent=2))
if __name__=='__main__':main()
