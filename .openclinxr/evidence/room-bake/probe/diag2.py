import bpy, sys
import mathutils

def _argv_after_double_dash():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=_argv_after_double_dash()[0])

for o in bpy.context.scene.objects:
    if o.type != "MESH":
        continue
    mx = o.matrix_world.to_3x3()
    me = o.data
    buckets = {"+Z_up": 0, "-Z_down": 0, "side": 0}
    zmin_faces = 0
    for poly in me.polygons:
        n = mx @ poly.normal
        cz = (mx @ poly.center).z
        if abs(n.z) > 0.8 and n.z > 0:
            buckets["+Z_up"] += 1
        elif abs(n.z) > 0.8 and n.z < 0:
            buckets["-Z_down"] += 1
        else:
            buckets["side"] += 1
        if n.z < -0.8 and cz < 0.05:
            zmin_faces += 1
    print(f"obj={o.name} faces={len(me.polygons)} buckets={buckets} downFacesAtZ0={zmin_faces}")
    if buckets["-Z_down"]:
        # print z of downward faces
        zs = []
        for poly in me.polygons:
            n = mx @ poly.normal
            if n.z < -0.8:
                zs.append(round((mx @ poly.center).z, 3))
        zs.sort()
        print(f"   downward face z-centers: min={zs[0]} max={zs[-1]} count={len(zs)}")
