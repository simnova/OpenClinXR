# For each coplanar overlap bx_audit would count, compare the texel each face shows at that point.
import sys, json, re
argv=sys.argv[sys.argv.index("--")+1:]; glb, out, eps = argv[0], argv[1], float(argv[2])
import bpy, bmesh
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=glb)
dg=bpy.context.evaluated_depsgraph_get()
def tris(o):
    bm=bmesh.new(); bm.from_object(o, dg); bm.transform(o.matrix_world)
    bmesh.ops.triangulate(bm, faces=bm.faces[:]); bm.faces.ensure_lookup_table(); bm.normal_update()
    uv=bm.loops.layers.uv.active
    T=[]
    for f in bm.faces:
        T.append(([v.co.copy() for v in f.verts],[l[uv].uv.to_3d() if uv else None for l in f.loops], f.normal.copy(), [v.index for v in f.verts]))
    bm.free(); return T
mesh=[o for o in bpy.context.scene.objects if o.type=="MESH"]
data={o.name:tris(o) for o in mesh}
trees={n:BVHTree.FromPolygons([c for t in T for c in t[0]],[[3*i,3*i+1,3*i+2] for i in range(len(T))]) for n,T in data.items()}
pat=re.compile(r"eyebrow|eyelash|garment|pants|jeans|gown|hair|teeth|boots|body|geometry",re.I)
res={}
names=[n for n in data if pat.search(n)]
for a in names:
  for b in names:
    if b<a: continue
    A,B,tb=data[a],data[b],trees[b]
    buckets=[0,0,0]; coinc_opp=0; n=0; maxd=0; uvd=[]
    for i,(co,uv,nrm,vid) in enumerate(A):
        c=(co[0]+co[1]+co[2])/3
        for loc,hn,j,dist in tb.find_nearest_range(c, eps):
            if a==b and (j==i or set(vid)&set(B[j][3])): continue
            d=nrm.dot(hn)
            if abs(d)<=0.999: continue
            off=c-loc
            if (off-off.dot(hn)*hn).length>=eps*0.01: continue
            n+=1; maxd=max(maxd,dist)
            sep=abs(off.dot(hn)); bk=0 if sep<1e-6 else (1 if sep<1e-5 else 2); buckets[bk]+=1
            if bk==0: coinc_opp += (d<0)
            if bk==0 and a==b and uv[0] is not None and B[j][1][0] is not None:
                ua=barycentric_transform(c,*co,*uv); ub=barycentric_transform(loc,*B[j][0],*B[j][1])
                uvd.append((ua-ub).length)
    if n:
        k={"pairs":n,"sep_lt_1um":buckets[0],"sep_1_10um":buckets[1],"sep_gt_10um":buckets[2],"coincident_opposite_facing":coinc_opp}
        if uvd:
            uvd.sort(); k["coincident_uv_delta_median"]=round(uvd[len(uvd)//2],4); k["coincident_uv_delta_gt_0.01"]=sum(1 for x in uvd if x>0.01)
        res[f"{a} <-> {b}"]=k
json.dump(res,open(out,"w"),indent=1); print("DONE")
