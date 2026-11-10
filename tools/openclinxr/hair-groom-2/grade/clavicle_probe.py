# Blender headless: import body GLB, print clavicle/shoulder bone world heads.
import bpy, sys, json
glb = sys.argv[sys.argv.index('--')+1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
out={}
for ob in bpy.data.objects:
    if ob.type=='ARMATURE':
        for b in ob.pose.bones:
            n=b.name.lower()
            if any(k in n for k in ('clav','shoulder','neck','head','spine')):
                h=ob.matrix_world@b.head; t=ob.matrix_world@b.tail
                out[b.name]=[list(map(float,h)),list(map(float,t))]
print('CLAV_JSON'+json.dumps(out))
