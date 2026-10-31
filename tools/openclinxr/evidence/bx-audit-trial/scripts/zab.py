# A/B: delete one side vs the other side of each coincident (<1um) different-UV pair; same camera.
# If renders differ, what is shown depends on which coincident face wins the depth tie.
import sys, json, re
argv=sys.argv[sys.argv.index("--")+1:]; glb, meshpat, outp, eps, dist = argv[0], argv[1], argv[2], float(argv[3]), float(argv[4])
import bpy, bmesh, numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform
def load():
    bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=glb)
    return [x for x in bpy.context.scene.objects if x.type=="MESH" and re.search(meshpat,x.name)][0]
o=load(); me=o.data
# work on the mesh's own (bind-pose) polygons, world-transform positions
mw=o.matrix_world
bm=bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); bm.normal_update()
uv=bm.loops.layers.uv.active
F=[]
for f in bm.faces:
    for k in range(1,len(f.loops)-1):
        L=(f.loops[0],f.loops[k],f.loops[k+1])
        F.append((f.index,[mw@l.vert.co for l in L],[l[uv].uv.to_3d() for l in L] if uv else None,{l.vert.index for l in f.loops}))
tree=BVHTree.FromPolygons([c for t in F for c in t[1]],[[3*i,3*i+1,3*i+2] for i in range(len(F))])
A,B,pts=set(),set(),[]
for i,(fi,co,u,vid) in enumerate(F):
    c=sum(co,Vector())/3; n=(co[1]-co[0]).cross(co[2]-co[0]).normalized()
    for loc,hn,j,d in tree.find_nearest_range(c,eps):
        fj=F[j][0]
        if fj<=fi or vid&F[j][3] or abs(n.dot(hn))<=0.999: continue
        off=c-loc
        if abs(off.dot(hn))>=1e-6 or (off-off.dot(hn)*hn).length>=eps*0.01: continue
        if u and F[j][2] and (barycentric_transform(c,*co,*u)-barycentric_transform(loc,*F[j][1],*F[j][2])).length<=0.01: continue
        A.add(fj); B.add(fi); pts.append((c.copy(),n.copy()))
bm.free()
print("PAIRS",len(pts),"A_del",len(A),"B_del",len(B))
if not pts: sys.exit(0)
best=max(pts,key=lambda p: sum(1 for q in pts if (q[0]-p[0]).length<0.03))
cen,nrm=best
def render(delset,tag):
    o=load(); sc=bpy.context.scene
    bm=bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm,geom=[bm.faces[k] for k in delset],context="FACES_ONLY"); bm.to_mesh(o.data); bm.free()
    sc.render.engine="BLENDER_WORKBENCH"; sc.display.shading.color_type="TEXTURE"; sc.display.shading.light="FLAT"
    sc.render.resolution_x=sc.render.resolution_y=512
    out=[]
    for side in (1,-1):
        cam=bpy.data.cameras.new("c"); cam.lens=50; cam.clip_start=0.1; cam.clip_end=100
        co=bpy.data.objects.new("c",cam); sc.collection.objects.link(co)
        co.location=cen+nrm*side*dist+Vector((0.02,0.03,0.015))*dist
        co.rotation_euler=(cen-co.location).to_track_quat('-Z','Y').to_euler(); sc.camera=co
        p=f"{outp}_{tag}_{'f' if side>0 else 'b'}.png"; sc.render.filepath=p; bpy.ops.render.render(write_still=True)
        im=bpy.data.images.load(p); out.append(np.array(im.pixels[:]).reshape(512,512,4)[...,:3])
    return out
ra=render(A,"A"); rb=render(B,"B")
res={"pairs":len(pts),"center":[round(x,4) for x in cen]}
for k,s in enumerate("fb"):
    d=np.abs(ra[k]-rb[k]).max(-1); res[f"diff_px_frac_{s}"]=round(float((d>0.1).mean()),4)
print("RESULT",json.dumps(res)); json.dump(res,open(outp+".json","w"))
