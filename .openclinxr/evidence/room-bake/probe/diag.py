import bpy, sys

def _argv_after_double_dash():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]

inp = _argv_after_double_dash()[0]
bpy.ops.import_scene.gltf(filepath=inp)
print("=== OBJECTS ===")
for o in bpy.context.scene.objects:
    if o.type == "MESH":
        me = o.data
        # world-space face normal average and bbox
        mx = o.matrix_world
        normals = []
        for poly in me.polygons:
            n = mx.to_3x3() @ poly.normal
            normals.append(n)
        avg = sum(normals, __import__("mathutils").Vector((0,0,0))) / len(normals)
        bb = [mx @ __import__("mathutils").Vector(v) for v in o.bound_box]
        print(f"obj={o.name} tris={len(me.polygons)} faces={len(me.polygons)} avgNormal={tuple(round(x,3) for x in avg)} bbox_min={tuple(round(x,2) for x in bb[0])} bbox_max={tuple(round(x,2) for x in bb[6])} uv={len(me.uv_layers)}")
        for i, mat in enumerate(me.materials):
            print(f"   slot{i}: mat={mat.name if mat else None}")
print("=== MATERIALS ===")
for mat in bpy.data.materials:
    if not mat.use_nodes or mat.node_tree is None:
        print(f"mat={mat.name}: NO NODES")
        continue
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            bc = node.inputs["Base Color"].default_value
            met = node.inputs["Metallic"].default_value if "Metallic" in node.inputs else None
            rough = node.inputs["Roughness"].default_value if "Roughness" in node.inputs else None
            alpha = node.inputs["Alpha"].default_value if "Alpha" in node.inputs else None
            print(f"mat={mat.name}: baseColor={tuple(round(x,3) for x in bc)} metallic={met} roughness={rough} alpha={alpha}")
