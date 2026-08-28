import bpy, sys, os, json
A = sys.argv[sys.argv.index("--")+1:]
GLB, OUT = A[0], A[1]
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=GLB)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    json.dump({"status": "failed", "error": "no meshes"}, open(OUT.replace(".glb", ".uv-report.json"), "w"), indent=2)
    print("UV_STATUS no_meshes")
    sys.exit(2)
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
joined = bpy.context.view_layer.objects.active
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=66, island_margin=0.01, area_weight=0.0)
bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True)
report = {
    "status": "unwrapped",
    "input": GLB,
    "output": OUT,
    "meshCount": len(meshes),
    "note": "smart_uv_project applied because the simplified rung carried no TEXCOORD_0",
}
json.dump(report, open(OUT.replace(".glb", ".uv-report.json"), "w"), indent=2)
print("UV_STATUS unwrapped")
