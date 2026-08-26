import bpy, sys, os
A=sys.argv[sys.argv.index("--")+1:]
GLB, NRM, OUT = A[0], A[1], A[2]
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=GLB)
meshes=[o for o in bpy.context.scene.objects if o.type=="MESH"]
attached=0
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
        attached+=1
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB",
                          export_normals=True, export_tangents=True,
                          export_image_format="AUTO", use_selection=False)
print(f"EXPORT_DONE attached={attached}")
