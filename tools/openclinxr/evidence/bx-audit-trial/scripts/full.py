import sys,math
argv=sys.argv[sys.argv.index("--")+1:]; glb,outp,hl=argv[0],argv[1],argv[2]
import bpy
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=glb)
sc=bpy.context.scene; ms=[o for o in sc.objects if o.type=="MESH"]
pts=[o.matrix_world@Vector(c) for o in ms for c in o.bound_box]
lo=Vector([min(p[k] for p in pts) for k in range(3)]); hi=Vector([max(p[k] for p in pts) for k in range(3)])
cen=(lo+hi)/2; r=(hi-lo).length/2
# highlight named parts in red
if hl!="-":
    red=bpy.data.materials.new("hl"); red.diffuse_color=(1,0,0,1)
    for o in ms:
        if (o.name in hl[1:].split(",")) if hl.startswith("@") else any(h in o.name for h in hl.split(",")):
            o.data.materials.clear(); o.data.materials.append(red)
sc.render.engine="BLENDER_WORKBENCH"; sc.display.shading.color_type="TEXTURE"; sc.display.shading.light="STUDIO"
sc.render.resolution_x=sc.render.resolution_y=512
for k,(az) in enumerate((30,120)):
    cam=bpy.data.cameras.new("c"); cam.lens=50; co=bpy.data.objects.new("c",cam); sc.collection.objects.link(co)
    a=math.radians(az); co.location=cen+Vector((math.sin(a),-math.cos(a),0.35))*r*2.6
    co.rotation_euler=(cen-co.location).to_track_quat('-Z','Z').to_euler(); sc.camera=co
    sc.render.filepath=f"{outp}_{k}.png"; bpy.ops.render.render(write_still=True)
