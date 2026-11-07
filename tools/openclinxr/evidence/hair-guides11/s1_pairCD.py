"""S1 level-C/D: surface_walk + fall symmetry on mirror pairs (cap v5)."""
import sys, argparse, importlib.util
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector, kdtree
from mathutils.bvhtree import BVHTree
HERE = Path(__file__).resolve().parent
def load_hs():
    for cand in [Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-p7/tools/openclinxr/evidence/hair-scene/hair_scene.py")]:
        if cand.exists(): p = cand; break
    s = importlib.util.spec_from_file_location("oclx_hs", str(p))
    m = importlib.util.module_from_spec(s); sys.modules[s.name] = m
    s.loader.exec_module(m); return m
def wpts(obj):
    M = obj.matrix_world
    return np.array([tuple(M @ v.co) for v in obj.data.vertices])
def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True)
    ap.add_argument("--cell", default="B")
    aa = ap.parse_args(sys.argv[sys.argv.index("--") + 1:]); out = Path(aa.out); CELL = aa.cell
    HS = load_hs(); h = HS.build_scene(); body = h.head
    bpy.context.view_layer.update()
    W = wpts(body)
    crown = float(W[:, 2].max()); cx = float(np.median(W[W[:, 2] > crown - 0.26][:, 0]))
    medy = float(np.median(W[:, 1]))
    F = HERE.parent / "hair-cap5"
    cap = np.load(F / "cap-v5.npz"); fb = np.load(F / "flow-b-v5.npz", allow_pickle=True)
    V = np.array(cap["verts"]); cap_cx = float(cap["cx"])
    fB = np.array(fb["f"]); roots_all = np.array(fb["roots"])
    ear_y = float(cap["ear_y"]); ear_top = float(cap["ear_top"])
    brow_z = float(cap["brow_z"]); menton_z = float(cap["menton_z"])
    menton = float(menton_z)
    # ears per side (same as guides11)
    ears = {}
    for sgn, nm in ((-1.0, "L"), (1.0, "R")):
        seed = W[((W[:, 0] - cx) * sgn > 0.045) & (W[:, 1] >= ear_y - 0.060)
                 & (W[:, 1] <= ear_y + 0.025) & (W[:, 2] >= ear_top - 0.050)
                 & (W[:, 2] <= ear_top + 0.015)]
        ears[nm] = {"ear_top": seed[int(np.argmax(seed[:, 2]))],
                    "ear_back": seed[int(np.argmax(seed[:, 1]))],
                    "ear_front": seed[int(np.argmin(seed[:, 1]))],
                    "lobe": seed[int(np.argmin(seed[:, 2]))], "n": len(seed)}
        print("EAR %s top=%s front=%s back=%s lobe=%s n=%d" % (nm, np.round(ears[nm]["ear_top"]*1000,1).tolist(), np.round(ears[nm]["ear_front"]*1000,1).tolist(), np.round(ears[nm]["ear_back"]*1000,1).tolist(), np.round(ears[nm]["lobe"]*1000,1).tolist(), len(seed)))
    for k in ("ear_top","ear_back","ear_front","lobe"):
        lx, rx = ears["L"][k], ears["R"][k]
        print("MIRROR %s d|x|=%.2f dy=%.2f dz=%.2f" % (k, abs(abs(lx[0]-cx)-abs(rx[0]-cx))*1000, abs(lx[1]-rx[1])*1000, abs(lx[2]-rx[2])*1000))
    # hulls
    import bmesh as _bmesh
    HULLS = []
    for sgn, nm in ((-1.0, "L"), (1.0, "R")):
        e = ears[nm]
        ylo, yhi = float(e["ear_front"][1]) - 0.015, float(e["ear_back"][1]) + 0.020
        zlo, zhi = float(e["lobe"][2]) - 0.025, float(e["ear_top"][2]) + 0.015
        sel = W[((W[:, 0] - cx) * sgn > 0.030) & (W[:, 1] >= ylo) & (W[:, 1] <= yhi) & (W[:, 2] >= zlo) & (W[:, 2] <= zhi)]
        me = bpy.data.meshes.new("OCLX_ear_hull_%s_mesh" % nm)
        me.from_pydata([tuple(p) for p in sel], [], []); me.update()
        bm = _bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
        _bmesh.ops.convex_hull(bm, input=list(bm.verts))
        bm.to_mesh(me); bm.free(); me.update()
        ho = bpy.data.objects.new("OCLX_ear_hull_%s" % nm, me)
        bpy.context.scene.collection.objects.link(ho)
        HULLS.append(ho)
        print("HULL %s n=%d faces=%d" % (nm, len(me.vertices), len(me.polygons)))
    bad = ("eye","mouth","teeth","tooth","tongue","lash","brow","nail","hair","mask","helper","glasses","hat","cap_")
    cols = [o for o in bpy.data.objects if o.type=="MESH" and o.visible_get() and o is not body and not any(b in o.name.lower() for b in bad)]
    keep_subs = ("aisha_head","toigo_t_shirt","tight_jeans","toigo_mj_cloth_shoes")
    cols = [o for o in cols if any(s in o.name.lower() for s in keep_subs)]
    print("colliders", [o.name for o in cols])
    colliders = [body]+cols; fall_colliders = colliders+HULLS
    HULL_CLEAR=0.002; FALL_CLEAR=0.003
    REQ = {o.name:(HULL_CLEAR if o in HULLS else FALL_CLEAR) for o in fall_colliders}
    deps = bpy.context.evaluated_depsgraph_get()
    bvhs = {o.name: BVHTree.FromObject(o, deps, deform=True, cage=False) for o in colliders}
    bvh_fall = {o.name: BVHTree.FromObject(o, deps, deform=True, cage=False) for o in fall_colliders}
    bvh_body = bvhs[body.name]
    def nearest_pt(bvh,p):
        hit,n,_,_ = bvh.find_nearest(Vector(tuple(p)))
        if hit is None: return None,None
        return np.array(tuple(hit)),np.array(tuple(n))
    def sdist(p,q,n):
        d=np.asarray(p)-q; return float(np.sign(d@n+1e-12)*np.linalg.norm(d))
    kd = kdtree.KDTree(len(V))
    for i,p in enumerate(V): kd.insert(Vector(tuple(p)),i)
    kd.balance()
    ball = np.array(sorted(set(int(v) for v in cap["exit"])|set(int(v) for v in cap["forehead"])|set(int(v) for v in cap["slit"])))
    bkd = kdtree.KDTree(len(ball))
    for vi in ball: bkd.insert(Vector(tuple(V[int(vi)])),int(vi))
    bkd.balance()
    capBVH = BVHTree.FromPolygons([Vector(tuple(p)) for p in V],[tuple(f) for f in np.array(cap["faces"])])
    w2l,l2w = body.matrix_world.inverted().copy(), body.matrix_world.copy()
    _jaw_z = menton+0.030
    def x_face(z):
        z=float(z)
        if z>=_jaw_z: return 0.048
        if z<=menton: return 0.034
        f=(z-menton)/0.030; return 0.034+f*(0.048-0.034)
    def modeB_dir(p,n):
        L=np.array([np.sign(p[0]-cx) or 1.0,0.0,0.0]); L=L-(L@n)*n
        nl=float(np.linalg.norm(L)); L=L/nl if nl>1e-9 else np.zeros(3)
        Gv=np.array([0.0,0.0,-1.0]); Gv=Gv-(Gv@n)*n
        ng=float(np.linalg.norm(Gv)); Gv=Gv/ng if ng>1e-9 else np.zeros(3)
        w=max(min(float(n[2]),1.0),0.0)**0.5
        return w*L+(1-w)*Gv,L
    def y_target(p):
        nm="L" if float(p[0])<cx else "R"
        return float(ears[nm]["ear_top"][1])-0.005
    def surface_walk(p0):
        pts=[np.array(p0,dtype=float)]; prev_n=None; end="?"
        for _ in range(400):
            q,n=nearest_pt(bvh_body,pts[-1])
            f,L=modeB_dir(pts[-1],n)
            if f[1]<0: f[1]=0.0
            if abs(pts[-1][0]-cx)<x_face(pts[-1][2])-0.005: f=f+0.8*L
            if CELL=="B":
                Yv=np.array([0.0,1.0,0.0]); Yp=Yv-(Yv@n)*n
                f=f+0.5*Yp
            nl=float(np.linalg.norm(f))
            f=f/nl if nl>1e-9 else L
            cand=pts[-1]+0.003*f
            q2,n2=nearest_pt(bvh_body,cand)
            if prev_n is not None:
                cosn=float(np.clip((n2@prev_n)/(np.linalg.norm(n2)*np.linalg.norm(prev_n)+1e-12),-1,1))
                if np.degrees(np.arccos(cosn))>60.0: end="rim-normal"; break
            pts.append(q2+n2*0.003); prev_n=n2
            if len(pts)>=4:
                if float(np.linalg.norm(pts[-1]-pts[-4]))<0.0015: end="rim-stall"; break
            lat=abs(pts[-1][0]-cx)>=x_face(pts[-1][2])-0.005
            if CELL=="B":
                if lat and pts[-1][1]>=y_target(pts[-1]): end="lateral"; break
                if pts[-1][1]>=y_target(pts[-1]): end="sweep"; break
            else:
                if lat: end="lateral"; break
            if pts[-1][2]<ear_top-0.02: end=("sweep-zfloor" if CELL=="B" else "zfloor"); break
        else: end="maxiter"
        return np.array(pts),end
    Z=np.array([0.0,0.0,-1.0]); YF=ear_y-0.025
    def no_fwd(v,p):
        if p[2]>menton and p[1]<YF and v[1]<0:
            v=v.copy(); v[1]=0.0
            nv=float(np.linalg.norm(v)); v=v/nv if nv>1e-9 else Z.copy()
        return v
    def nearest_col_fall(p):
        best=None
        for o in fall_colliders:
            q,n=nearest_pt(bvh_fall[o.name],p)
            if q is None: continue
            d=abs(sdist(p,q,n))
            if best is None or d<best[0]: best=(d,o,q,n)
        return best[1],best[2],best[3]
    PROX=0.015
    def fall_ok(p):
        for o in fall_colliders:
            q,n=nearest_pt(bvh_fall[o.name],p)
            if q is None: continue
            sd=sdist(p,q,n)
            if abs(sd)>PROX: continue
            if sd<REQ[o.name]: return False
        return True
    def fall_phase(p0,d0):
        pts=[np.array(p0,dtype=float)]; d=np.array(d0,dtype=float)/(np.linalg.norm(d0)+1e-12)
        wname=None; stall=0; contact=False; cend=False; zh=[float(pts[-1][2])]
        ph=np.array([d[0],d[1],0.0]); prev_h=ph/(np.linalg.norm(ph)+1e-12) if float(np.linalg.norm(ph))>1e-9 else np.array([np.sign(p0[0]-cx) or 1.0,0.0,0.0])
        zhem=menton-0.73*0.2107
        for _ in range(400):
            dd=0.65*d+0.35*Z; dd=dd/(np.linalg.norm(dd)+1e-12); dd=no_fwd(dd,pts[-1])
            cand=pts[-1]+0.005*dd
            drew_free=fall_ok(cand)
            if contact and drew_free:
                for o in fall_colliders:
                    qq,nn=nearest_pt(bvh_fall[o.name],cand)
                    if qq is None: continue
                    if sdist(cand,qq,nn)<REQ[o.name]+0.002: drew_free=False; break
                if drew_free: contact=False
            if drew_free:
                pts.append(cand); d=dd; zh.append(float(cand[2]))
            else:
                contact=True
                wo,q,n=nearest_col_fall(cand)
                if wname is not None:
                    qq0,nn0=nearest_pt(bvh_fall[wname],cand)
                    if qq0 is not None:
                        d0w=abs(sdist(cand,qq0,nn0)); dw=abs(sdist(cand,q,n))
                        if d0w<=dw+0.0002:
                            wo=next(o for o in fall_colliders if o.name==wname); q,n=qq0,nn0
                if wo is not None: wname=wo.name
                _up=Z if abs(float(n[2]))<0.9 else np.array([1.0,0.0,0.0])
                _u=np.cross(n,_up); _un=float(np.linalg.norm(_u))
                if _un>1e-9:
                    _u=_u/_un; _v=np.cross(n,_u)
                    _acc=np.array(n,dtype=float); _ws=1.0
                    for _du,_dv in ((0.0015,0.0),(-0.0015,0.0),(0.0,0.0015),(0.0,-0.0015)):
                        _qp=cand+_u*_du+_v*_dv
                        _qq,_nn=nearest_pt(bvh_fall[wo.name],_qp)
                        if _qq is None: continue
                        if abs(sdist(_qp,_qq,_nn))>0.010: continue
                        _w=max(0.0,float(_nn@n)); _acc=_acc+_nn*_w; _ws+=_w
                    _an=float(np.linalg.norm(_acc))
                    if _an>1e-9: n=_acc/_an
                t=Z-(Z@n)*n; nt=float(np.linalg.norm(t))
                if nt<0.10: s=prev_h.copy()
                else:
                    s=t/nt
                    hh=np.array([s[0],s[1],0.0])
                    if float(np.linalg.norm(hh))>1e-9: prev_h=hh/float(np.linalg.norm(hh))
                s=no_fwd(s,pts[-1])
                sn=float(np.linalg.norm(s)); s=s/sn if sn>1e-9 else Z.copy()
                pnew=np.array(pts[-1]+0.005*s)
                for _ in range(6):
                    moved=False
                    for o in fall_colliders:
                        qq,nn=nearest_pt(bvh_fall[o.name],pnew)
                        if qq is None: continue
                        sd1=sdist(pnew,qq,nn)
                        if abs(sd1)>PROX: continue
                        if sd1<REQ[o.name]: pnew=qq+nn*REQ[o.name]; moved=True
                    if not moved: break
                mv=float(np.linalg.norm(pnew-pts[-1]))
                if mv>=0.001: pts.append(pnew); d=s; stall=0
                else:
                    stall+=1
                    if stall>=6: cend=True; break
                zh.append(float(pts[-1][2]))
                if len(zh)>=7 and (zh[-7]-zh[-1])<0.001: cend=True; break
            if pts[-1][2]<=zhem: break
        return np.array(pts),cend
    def trace_root(r):
        p=Vector(tuple(r)); pl=[tuple(r)]
        for _ in range(100):
            _,vi,_=kd.find(p); fv=fB[vi]; nl=float(np.linalg.norm(fv))
            if nl<1e-9: break
            p_new=p+Vector(tuple(fv/nl*0.002))
            hit,_,_,_=bvh_body.find_nearest(w2l@p_new)
            p_proj=(l2w@hit) if hit is not None else p_new
            _,_,_,dist=capBVH.find_nearest(p_proj)
            if dist is None or float(dist)>0.0015:
                _,bi,_=bkd.find(p_proj); pl.append(tuple(p_proj)); return np.array(pl),int(bi)
            p=p_proj; pl.append(tuple(p))
        return np.array(pl),None
    Rsel=roots_all[(roots_all[:,0]-cap_cx)>0.002]
    Lsel=Rsel.copy(); Lsel[:,0]=2.0*cx-Lsel[:,0]
    pairs=len(Rsel)
    # build level C (scalp+surf) and D (+fall), raw, with ends
    from collections import Counter
    endR=Counter(); endL=Counter()
    CR=[]; CL=[]; DR=[]; DL=[]; CER=[]; CEL=[]
    ceR=0; ceL=0
    for r in Rsel:
        pl,bi=trace_root(r)
        scalp=[]
        for q in pl:
            hq,hn=nearest_pt(bvh_body,q)
            if hq is None: break
            scalp.append(hq+hn*0.003)
        scalp=np.array(scalp)
        if float(r[1])<ear_y:
            surf,end=surface_walk(scalp[-1]); endR[end]+=1
            full_s=np.vstack([scalp[:-1],surf])
        else:
            full_s=scalp; end="nosurf"; endR[end]+=1
        CR.append(full_s)
        d0=full_s[-1]-full_s[-2]
        fall,ce=fall_phase(full_s[-1],d0)
        DR.append(np.vstack([full_s[:-1],fall])); CER.append(bool(ce)); ceR+=int(ce)
    for l in Lsel:
        pl,bi=trace_root(l)
        scalp=[]
        for q in pl:
            hq,hn=nearest_pt(bvh_body,q)
            if hq is None: break
            scalp.append(hq+hn*0.003)
        scalp=np.array(scalp)
        if float(l[1])<ear_y:
            surf,end=surface_walk(scalp[-1]); endL[end]+=1
            full_s=np.vstack([scalp[:-1],surf])
        else:
            full_s=scalp; end="nosurf"; endL[end]+=1
        CL.append(full_s)
        d0=full_s[-1]-full_s[-2]
        fall,ce=fall_phase(full_s[-1],d0)
        DL.append(np.vstack([full_s[:-1],fall])); CEL.append(bool(ce)); ceL+=int(ce)
    def cmp(LR,LL,label):
        maxds=[]; divks=[]
        for i in range(pairs):
            a=LR[i]; b=LL[i].copy(); b[:,0]=2.0*cx-b[:,0]
            m=min(len(a),len(b))
            if m==0: maxds.append(np.nan); divks.append(-2); continue
            d=np.linalg.norm(a[:m]-b[:m],axis=1)
            tail=float(np.linalg.norm(a[-1]-b[-1])) if len(a)!=len(b) else 0.0
            maxds.append(max(float(d.max()),tail))
            k=next((k for k in range(m) if float(d[k])>0.001),(-1 if len(a)==len(b) else m))
            divks.append(int(k))
        maxds=np.array(maxds)
        print("%s pairs=%d maxd p50=%.2f p95=%.2f max=%.2f mm" % (label,pairs,float(np.nanpercentile(maxds,50))*1000,float(np.nanpercentile(maxds,95))*1000,float(np.nanmax(maxds))*1000))
        import collections
        print("%s divk " % label, dict(collections.Counter(divks).most_common(10)))
        return maxds,divks
    print("END R",dict(endR),"END L",dict(endL))
    print("CE R=%d L=%d"%(ceR,ceL))
    mC,dC=cmp(CR,CL,"LEVEL-C scalp+surf cell=%s"%CELL)
    mD,dD=cmp(DR,DL,"LEVEL-D +fall cell=%s"%CELL)
    order=np.argsort(mD,kind="stable")[::-1][:10]
    print("WORST10 level-D:")
    for rnk,i in enumerate(order):
        a=DR[i]; b=DL[i].copy(); b[:,0]=2.0*cx-b[:,0]
        m=min(len(a),len(b))
        d=np.linalg.norm(a[:m]-b[:m],axis=1)
        k=next((k for k in range(m) if float(d[k])>0.001),m)
        # locate phase: len scalp+surf vs fall start
        ls=len(CR[i])
        ph="surf" if k<ls else "fall"
        print("WORST %d pair=%d maxd=%.1fmm k=%d(%s) lenR=%d lenL=%d lenC=%d/%d rootR=%s rootL=%s"%(rnk+1,int(i),float(mD[i])*1000,int(k),ph,len(a),len(DL[i]),len(CR[i]),len(CL[i]),np.round(Rsel[i]*1000,1).tolist(),np.round(Lsel[i]*1000,1).tolist()))
        for kk in ([max(k-1,0),k] if k<m else [m-1]):
            print("  k=%d R=%s Lmir=%s d=%.2fmm"%(kk,np.round(a[kk]*1000,1).tolist() if kk<len(a) else "NA",np.round(b[kk]*1000,1).tolist() if kk<len(b) else "NA",float(d[kk])*1000 if kk<m else -1))
    np.savez(out/"s1-pairCD.npz",R=np.array(Rsel,dtype=np.float32),L=np.array(Lsel,dtype=np.float32),mC=np.array(mC),mD=np.array(mD))
    print("WROTE",out/"s1-pairCD.npz")
main()
