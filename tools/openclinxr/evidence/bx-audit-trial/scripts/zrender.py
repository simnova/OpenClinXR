# Locate coincident (<1um), different-UV face pairs in one mesh and render close-ups at them.
import sys, json, re, math
argv=sys.argv[sys.argv.index("--")+1:]; glb, meshpat, outp, eps = argv[0], argv[1], argv[2], float(argv[3])
import bpy, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=glb)
dg=bpy.context.evaluated_depsgraph_get()
o=[x for x in bpy.context.scene.objects if x.type=="MESH" and re.search(meshpat,x.name)][0]
bm=bmesh.new(); bm.from_object(o,dg); bm.transform(o.matrix_world); bmesh.ops.triangulate(bm,faces=bm.faces[:]); bm.faces.ensure_lookup_table(); bm.normal_update()
uv=bm.loops.layers.uv.active
T=[([v.co.copy() for v in f.verts],[l[uv].uv.to_3d() for l in f.loops] if uv else None,f.normal.copy(),{v.index for v in f.verts}) for f in bm.faces]
tree=BVHTree.FromPolygons([c for t in T for c in t[0]],[[3*i,3*i+1,3*i+2] for i in range(len(T))])
pts=[]
for i,(co,u,n,vid) in enumerate(T):
    c=sum(co,Vector())/3
    for loc,hn,j,d in tree.find_nearest_range(c,eps):
        if j==i or vid&T[j][3] or abs(n.dot(hn))<=0.999: continue
        off=c-loc
        if abs(off.dot(hn))>=1e-6 or (off-off.dot(hn)*hn).length>=eps*0.01: continue
        if u and T[j][1]:
            if (barycentric_transform(c,*co,*u)-barycentric_transform(loc,*T[j][0],*T[j][1])).length<=0.01: continue
        pts.append((c.copy(),n.copy(), n.dot(hn)>0))
print("COINCIDENT_DIFF_UV",len(pts), "same_facing", sum(p[2] for p in pts))
if not pts: sys.exit(0)
# densest cluster: point with most neighbours within 2 cm
best=max(pts,key=lambda p: sum(1 for q in pts if (q[0]-p[0]).length<0.02))
cen=best[0]; nrm=best[1] if best[1].length>0 else Vector((0,-1,0))
sc=bpy.context.scene; sc.render.engine="BLENDER_WORKBENCH"; sc.display.shading.color_type="TEXTURE"; sc.display.shading.light="FLAT"
sc.render.resolution_x=sc.render.resolution_y=768
for k,(side) in enumerate((1,-1)):
    cam=bpy.data.cameras.new("c"); cam.lens=50; cam.clip_start=0.1; cam.clip_end=100
    co=bpy.data.objects.new("c",cam); sc.collection.objects.link(co)
    co.location=cen+nrm*side*0.12+Vector((0.01,0.013,0.007))
    d=cen-co.location; co.rotation_euler=d.to_track_quat('-Z','Y').to_euler(); sc.camera=co
    sc.render.filepath=f"{outp}_{'front' if side>0 else 'back'}.png"; bpy.ops.render.render(write_still=True)
json.dump({"n":len(pts),"center":list(cen),"normal":list(nrm)},open(outp+".json","w"))
