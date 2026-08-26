import bpy, math, sys, os
from mathutils import Vector
A=sys.argv[sys.argv.index("--")+1:]
GLB, NRM, OUT = A[0], A[1], A[2]
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=GLB)
meshes=[o for o in bpy.context.scene.objects if o.type=="MESH"]
xs=[];ys=[];zs=[]
for o in meshes:
    for c in o.bound_box:
        w=o.matrix_world @ Vector(c); xs.append(w.x); ys.append(w.y); zs.append(w.z)
cx,cy,cz=(min(xs)+max(xs))/2,(min(ys)+max(ys))/2,(min(zs)+max(zs))/2
rad=max(max(xs)-min(xs),max(ys)-min(ys),max(zs)-min(zs))

if NRM != "NONE":
    for o in meshes:
        for m in o.data.materials:
            if not m: continue
            m.use_nodes=True; nt=m.node_tree
            bsdf=next((n for n in nt.nodes if n.type=="BSDF_PRINCIPLED"), None)
            if not bsdf: continue
            img=bpy.data.images.load(NRM); img.colorspace_settings.name="Non-Color"
            tex=nt.nodes.new("ShaderNodeTexImage"); tex.image=img
            nm=nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

w=bpy.data.worlds.new("w"); bpy.context.scene.world=w; w.use_nodes=True
w.node_tree.nodes["Background"].inputs[0].default_value=(0.09,0.11,0.10,1)
w.node_tree.nodes["Background"].inputs[1].default_value=1.0
def lamp(name,loc,energy):
    d=bpy.data.lights.new(name,"AREA"); d.energy=energy; d.size=rad*3
    o=bpy.data.objects.new(name,d); o.location=loc; bpy.context.collection.objects.link(o)
    tr=o.constraints.new("TRACK_TO"); tr.target=meshes[0]; return o
lamp("key",(cx+rad*2,cy-rad*2,cz+rad*2.2),rad*rad*900)
lamp("fill",(cx-rad*2,cy-rad*1.5,cz+rad*1.2),rad*rad*300)
cd=bpy.data.cameras.new("c"); cam=bpy.data.objects.new("c",cd); bpy.context.collection.objects.link(cam)
bpy.context.scene.camera=cam; cd.lens=50
tr=cam.constraints.new("TRACK_TO"); tr.target=meshes[0]
sc=bpy.context.scene; sc.render.engine="BLENDER_EEVEE"
sc.render.resolution_x=900; sc.render.resolution_y=900
a=math.radians(35); e=math.radians(35); d=rad*2.6
cam.location=(cx+d*math.cos(e)*math.sin(a), cy-d*math.cos(e)*math.cos(a), cz+d*math.sin(e))
sc.render.filepath=OUT
bpy.ops.render.render(write_still=True)
print("AB_DONE")
