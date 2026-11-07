"""S1 fall-trace for teleporting pair (cap v5). Logs every fall step for pair idx."""
import sys, argparse, importlib.util
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector, kdtree
from mathutils.bvhtree import BVHTree
HERE = Path(__file__).resolve().parent
def load_hs():
    p = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-p7/tools/openclinxr/evidence/hair-scene/hair_scene.py")
    s = importlib.util.spec_from_file_location("oclx_hs", str(p))
    m = importlib.util.module_from_spec(s); sys.modules[s.name] = m
    s.loader.exec_module(m); return m
def wpts(obj):
    M = obj.matrix_world
    return np.array([tuple(M @ v.co) for v in obj.data.vertices])
def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); ap.add_argument("--pair", type=int, default=20)
    aa = ap.parse_args(sys.argv[sys.argv.index("--") + 1:]); out = Path(aa.out)
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
    menton = float(cap["menton_z"])
    ears = {}
    for sgn, nm in ((-1.0, "L"), (1.0, "R")):
        seed = W[((W[:, 0] - cx) * sgn > 0.045) & (W[:, 1] >= ear_y - 0.060) & (W[:, 1] <= ear_y + 0.025) & (W[:, 2] >= ear_top - 0.050) & (W[:, 2] <= ear_top + 0.015)]
        ears[nm] = {"ear_top": seed[int(np.argmax(seed[:, 2]))], "ear_back": seed[int(np.argmax(seed[:, 1]))], "ear_front": seed[int(np.argmin(seed[:, 1]))], "lobe": seed[int(np.argmin(seed[:, 2]))]}
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
        bpy.context.scene.collection.objects.link(ho); HULLS.append(ho)
    bad = ("eye","mouth","teeth","tooth","tongue","lash","brow","nail","hair","mask","helper","glasses","hat","cap_")
    cols = [o for o in bpy.data.objects if o.type=="MESH" and o.visible_get() and o is not body and not any(b in o.name.lower() for b in bad)]
    keep_subs = ("aisha_head","toigo_t_shirt","tight_jeans","toigo_mj_cloth_shoes")
    cols = [o for o in cols if any(s in o.name.lower() for s in keep_subs)]
    colliders = [body]+cols; fall_colliders = colliders+HULLS
    print("ORDER", [o.name for o in fall_colliders])
    HULL_CLEAR=0.002; FALL_CLEAR=0.003
    REQ = {o.name:(HULL_CLEAR if o in HULLS else FALL_CLEAR) for o in fall_colliders}
    deps = bpy.context.evaluated_depsgraph_get()
    bvh_fall = {o.name: BVHTree.FromObject(o, deps, deform=True, cage=False) for o in fall_colliders}
    bvhs = {o.name: BVHTree.FromObject(o, deps, deform=True, cage=False) for o in colliders}
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
    # pick pair
    Rsel=roots_all[(roots_all[:,0]-cap_cx)>0.002]
    r = Rsel[aa.pair]; l = r.copy(); l[0]=2.0*cx-l[0]
    print("ROOT R=%s L=%s pair=%d"%(np.round(r*1000,1).tolist(),np.round(l*1000,1).tolist(),aa.pair))
    def trace_root(rr):
        p=Vector(tuple(rr)); pl=[tuple(rr)]
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
    for tag,rr in (("R",r),("L",l)):
        pl,bi=trace_root(rr)
        scalp=[]
        for q in pl:
            hq,hn=nearest_pt(bvh_body,q)
            if hq is None: break
            scalp.append(hq+hn*0.003)
        scalp=np.array(scalp)
        print("%s trace len=%d scalp len=%d bi=%s scalp_last=%s"%(tag,len(pl),len(scalp),str(bi),np.round(scalp[-1]*1000,1).tolist()))
    # now fall from scalp end with per-step logging for R side only (teleport side)
    pl,bi=trace_root(r)
    scalp=np.array([ (lambda qq: (nearest_pt(bvh_body,qq)[0]+nearest_pt(bvh_body,qq)[1]*0.003))(q) for q in pl ])
    p0=scalp[-1]; d0=scalp[-1]-scalp[-2]; d0=d0/(np.linalg.norm(d0)+1e-12)
    Z=np.array([0.0,0.0,-1.0]); YF=ear_y-0.025
    def no_fwd(v,p):
        if p[2]>menton and p[1]<YF and v[1]<0:
            v=v.copy(); v[1]=0.0
            nv=float(np.linalg.norm(v)); v=v/nv if nv>1e-9 else Z.copy()
        return v
    def fall_ok(p):
        for o in fall_colliders:
            q,n=nearest_pt(bvh_fall[o.name],p)
            if q is None: continue
            if sdist(p,q,n)<REQ[o.name]: return False
        return True
    pts=[np.array(p0,dtype=float)]; d=np.array(d0,dtype=float)/(np.linalg.norm(d0)+1e-12)
    wname=None; contact=False
    ph=np.array([d[0],d[1],0.0]); prev_h=ph/(np.linalg.norm(ph)+1e-12) if float(np.linalg.norm(ph))>1e-9 else np.array([np.sign(p0[0]-cx) or 1.0,0.0,0.0])
    zhem=menton-0.73*0.2107
    for step in range(40):
        dd=0.65*d+0.35*Z; dd=dd/(np.linalg.norm(dd)+1e-12); dd=no_fwd(dd,pts[-1])
        cand=pts[-1]+0.005*dd
        sds={}
        for o in fall_colliders:
            qq,nn=nearest_pt(bvh_fall[o.name],cand)
            if qq is None: sds[o.name]="none"; continue
            sds[o.name]=round(float(sdist(cand,qq,nn))*1000,2)
        drew_free=fall_ok(cand)
        print("step %d p=%s dd=%s cand=%s free=%s sds=%s contact=%s wname=%s"%(
            step,np.round(pts[-1]*1000,1).tolist(),np.round(dd,3).tolist(),np.round(cand*1000,1).tolist(),drew_free,sds,contact,wname))
        if contact and drew_free:
            for o in fall_colliders:
                qq,nn=nearest_pt(bvh_fall[o.name],cand)
                if qq is None: continue
                if sdist(cand,qq,nn)<REQ[o.name]+0.002: drew_free=False; break
            if drew_free: contact=False
        if drew_free:
            pts.append(cand); d=dd
        else:
            contact=True
            wo,q,n= None,None,None
            best=None
            for o in fall_colliders:
                qq,nn=nearest_pt(bvh_fall[o.name],cand)
                if qq is None: continue
                dd_=abs(sdist(cand,qq,nn))
                if best is None or dd_<best[0]: best=(dd_,o,qq,nn)
            wo,q,n=best[1],best[2],best[3]
            print("  winner=%s q=%s n=%s dist=%.2fmm"%(wo.name,np.round(q*1000,1).tolist(),np.round(n,3).tolist(),best[0]*1000))
            if wname is not None:
                qq0,nn0=nearest_pt(bvh_fall[wname],cand)
                if qq0 is not None:
                    d0w=abs(sdist(cand,qq0,nn0)); dw=abs(sdist(cand,q,n))
                    if d0w<=dw+0.0002:
                        wo=next(o for o in fall_colliders if o.name==wname); q,n=qq0,nn0
                        print("  hysteresis keep %s"%wname)
            wname=wo.name
            t=Z-(Z@n)*n; nt=float(np.linalg.norm(t))
            if nt<0.10: s=prev_h.copy()
            else:
                s=t/nt
                hh=np.array([s[0],s[1],0.0])
                if float(np.linalg.norm(hh))>1e-9: prev_h=hh/float(np.linalg.norm(hh))
            s=no_fwd(s,pts[-1])
            sn=float(np.linalg.norm(s)); s=s/sn if sn>1e-9 else Z.copy()
            pnew=np.array(pts[-1]+0.005*s)
            print("  slide s=%s nt=%.3f pnew0=%s"%(np.round(s,3).tolist(),nt,np.round(pnew*1000,1).tolist()))
            for it in range(6):
                for o in fall_colliders:
                    qq,nn=nearest_pt(bvh_fall[o.name],pnew)
                    if qq is None: continue
                    sd=sdist(pnew,qq,nn)
                    if sd<REQ[o.name]:
                        print("    proj it%d %s sd=%.2fmm qq=%s"%(it,o.name,sd*1000,np.round(qq*1000,1).tolist()))
                        pnew=qq+nn*REQ[o.name]
            mv=float(np.linalg.norm(pnew-pts[-1]))
            print("  pnew=%s mv=%.2fmm"%(np.round(pnew*1000,1).tolist(),mv*1000))
            pts.append(pnew)
            if mv>0.05:
                print("  TELEPORT-STEP")
                break
        if pts[-1][2]<=zhem: break
main()
