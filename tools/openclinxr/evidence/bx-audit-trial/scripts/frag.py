import sys,math
argv=sys.argv[sys.argv.index("--")+1:]; lib,glb,outp=argv
sys.path.insert(0,lib)
import bpy,bx_audit
from mathutils import Vector
from mathutils.bvhtree import BVHTree
bx_audit._import(glb); o=[x for x in bpy.context.scene.objects if x.type=="MESH"][0]
box=[o.matrix_world@Vector(c) for c in o.bound_box]
diag=(Vector([max(c[k] for c in box) for k in range(3)])-Vector([min(c[k] for c in box) for k in range(3)])).length
tol,gap=diag*2e-3,diag*1e-2
bm,*_=bx_audit._welded(o,True,diag*1e-6); isl=bx_audit._islands(bm,1.0)
root=list(range(len(isl)))
def find(i):
    while root[i]!=i: root[i]=root[root[i]]; i=root[i]
    return i
for i in range(len(isl)):
    for j in range(i+1,len(isl)):
        a,b=isl[i],isl[j]
        if any(b["lo"][k]>a["hi"][k]+tol or a["lo"][k]>b["hi"][k]+tol for k in range(3)) or find(i)==find(j): continue
        if bx_audit._attached(a,b,tol): root[find(i)]=find(j)
g={}
for i in range(len(isl)): g.setdefault(find(i),[]).append(i)
main=max(g.values(),key=lambda x: sum(isl[i]["area"] for i in x))
far=[i for i in range(len(isl)) if i not in main]
print("ISLANDS",len(isl),"main",len(main),"other",len(far),"other_area_frac",round(sum(isl[i]["area"] for i in far)/sum(p["area"] for p in isl),4))
print("OTHER_SIZES_mm",sorted([round(max(isl[i]["hi"][k]-isl[i]["lo"][k] for k in range(3))*1000,1) for i in far])[-10:])
co,po=[],[]
for i in far:
    po+=[[k+len(co) for k in p] for p in isl[i]["polys"]]; co+=isl[i]["coords"]
me=bpy.data.meshes.new("frag"); me.from_pydata(co,[],po); fo=bpy.data.objects.new("frag",me); bpy.context.scene.collection.objects.link(fo)
red=bpy.data.materials.new("r"); red.diffuse_color=(1,0,0,1); me.materials.append(red)
sc=bpy.context.scene; sc.render.engine="BLENDER_WORKBENCH"; sc.display.shading.color_type="MATERIAL"; sc.display.shading.light="STUDIO"
sc.render.resolution_x=sc.render.resolution_y=640
cen=sum(box,Vector())/8
for k,az in enumerate((20,200)):
    cam=bpy.data.cameras.new("c"); cam.lens=50; c=bpy.data.objects.new("c",cam); sc.collection.objects.link(c)
    a=math.radians(az); c.location=cen+Vector((math.sin(a),-math.cos(a),0.4))*diag*1.4
    c.rotation_euler=(cen-c.location).to_track_quat('-Z','Z').to_euler(); sc.camera=c
    sc.render.filepath=f"{outp}_{k}.png"; bpy.ops.render.render(write_still=True)
