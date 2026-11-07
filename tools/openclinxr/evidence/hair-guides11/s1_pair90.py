"""S1: per-step surf trace for sym-probe worst-C pair 90."""
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
def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True)
    aa = ap.parse_args(sys.argv[sys.argv.index("--") + 1:]); out = Path(aa.out)
    HS = load_hs(); h = HS.build_scene(); body = h.head
    bpy.context.view_layer.update()
    W = np.array([tuple(body.matrix_world @ v.co) for v in body.data.vertices])
    crown = float(W[:, 2].max()); cx = float(np.median(W[W[:, 2] > crown - 0.26][:, 0]))
    F = HERE.parent / "hair-cap5"
    cap = np.load(F / "cap-v5.npz"); fb = np.load(F / "flow-b-v5.npz", allow_pickle=True)
    V = np.array(cap["verts"]); cap_cx = float(cap["cx"])
    fB = np.array(fb["f"]); roots_all = np.array(fb["roots"])
    ear_y = float(cap["ear_y"]); ear_top = float(cap["ear_top"])
    menton = float(cap["menton_z"])
    deps = bpy.context.evaluated_depsgraph_get()
    bvh_body = BVHTree.FromObject(body, deps, deform=True, cage=False)
    def nearest_pt(bvh,p):
        hit,n,_,_ = bvh.find_nearest(Vector(tuple(p)))
        if hit is None: return None,None
        return np.array(tuple(hit)),np.array(tuple(n))
    def sdist(p,q,n):
        d=np.asarray(p)-q; return float(np.sign(d@n+1e-12)*np.linalg.norm(d))
    def mir3(p):
        q=np.array(p,dtype=float); q[0]=2.0*cx-q[0]; return q
    def nearest_sym(bvh, p):
        q1,n1 = nearest_pt(bvh, p)
        mp = mir3(p)
        q2,n2 = nearest_pt(bvh, mp)
        q2m = mir3(q2); n2m = np.array(n2,dtype=float); n2m[0] = -n2m[0]
        q = 0.5*(np.array(q1,dtype=float)+q2m)
        nn = np.array(n1,dtype=float)+n2m; l=float(np.linalg.norm(nn))
        n = nn/l if l>1e-9 else np.array(n1,dtype=float)
        sd = 0.5*(sdist(p,q1,n1)+sdist(mp,np.array(q2),np.array(n2)))
        return q,n,sd,q1,n1,q2,n2
    kd = kdtree.KDTree(len(V))
    for i,p in enumerate(V): kd.insert(Vector(tuple(p)),i)
    kd.balance()
    ball = np.array(sorted(set(int(v) for v in cap["exit"])|set(int(v) for v in cap["forehead"])|set(int(v) for v in cap["slit"])))
    bkd = kdtree.KDTree(len(ball))
    for vi in ball: bkd.insert(Vector(tuple(V[int(vi)])),int(vi))
    bkd.balance()
    capBVH = BVHTree.FromPolygons([Vector(tuple(p)) for p in V],[tuple(f) for f in np.array(cap["faces"])])
    w2l,l2w = body.matrix_world.inverted().copy(), body.matrix_world.copy()
    Rsel=roots_all[(roots_all[:,0]-cap_cx)>0.002]
    for pi in (90, 97):
        r = Rsel[pi]; l = r.copy(); l[0]=2.0*cx-l[0]
        print("PAIR %d rootR=%s rootL=%s"%(pi, np.round(r*1000,3).tolist(), np.round(l*1000,3).tolist()))
        for tag, rr in (("R",r),("L",l)):
            # trace with per-step vi log
            p=Vector(tuple(rr)); pl=[np.array(tuple(rr),dtype=float)]; vis=[]
            for it in range(100):
                co,vi,_=kd.find(p); vis.append(int(vi))
                fv=np.array(fB[vi],dtype=float); nl=float(np.linalg.norm(fv))
                if nl<1e-9: break
                p_new=p+Vector(tuple(fv/nl*0.002))
                pw=np.array(tuple(p_new),dtype=float)
                q,n,sd,q1,n1,q2,n2=nearest_sym(bvh_body,pw)
                p_proj=q
                _,_,_,dist=capBVH.find_nearest(Vector(tuple(p_proj)))
                if dist is None or float(dist)>0.0015:
                    _,bi,_=bkd.find(Vector(tuple(p_proj))); pl.append(p_proj); break
                p=Vector(tuple(p_proj)); pl.append(np.array(tuple(p),dtype=float))
            pl=np.array(pl)
            print(" %s trace len=%d bi=%s"%(tag,len(pl),str(bi)))
            print(" %s vis=%s"%(tag,vis))
            # scalp
            scalp=[]
            for qq in pl:
                hq,hn,sd,_,_,_,_=nearest_sym(bvh_body,qq)
                scalp.append(hq+hn*0.003)
            scalp=np.array(scalp)
            print(" %s scalp len=%d last=%s"%(tag,len(scalp),np.round(scalp[-1]*1000,3).tolist()))
        # mirror-check trace
        # (compare in next step via numbers above)
main()
