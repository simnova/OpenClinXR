import bpy, sys, os, math, json
from mathutils import Vector
A = sys.argv[sys.argv.index("--")+1:]
HIGH, LOW, OUTDIR = A[0], A[1], A[2]
os.makedirs(OUTDIR, exist_ok=True)
bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()

def imp(p, tag):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=p)
    new = [o for o in bpy.context.scene.objects if o not in before and o.type == "MESH"]
    # join multi-primitive imports into one object
    if len(new) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for o in new: o.select_set(True)
        bpy.context.view_layer.objects.active = new[0]
        bpy.ops.object.join()
        new = [bpy.context.view_layer.objects.active]
    o = new[0]; o.name = tag
    return o

low  = imp(LOW,  "LOW")
high = imp(HIGH, "HIGH")

# derive extrusion from geometry, do not pick it
xs=[];ys=[];zs=[]
for c in low.bound_box:
    w = low.matrix_world @ Vector(c); xs.append(w.x); ys.append(w.y); zs.append(w.z)
diag = math.dist((min(xs),min(ys),min(zs)), (max(xs),max(ys),max(zs)))
extrusion = diag * 0.02          # 2% of the object diagonal
cage_ray  = diag * 0.04

res = int(os.environ.get("BAKE_RES","2048"))
img = bpy.data.images.new("bakedNormal", res, res, alpha=False, float_buffer=False)
img.colorspace_settings.name = "Non-Color"

mat = low.data.materials[0] if low.data.materials else bpy.data.materials.new("m")
if not low.data.materials: low.data.materials.append(mat)
mat.use_nodes = True
nt = mat.node_tree
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
nt.nodes.active = tex

sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 8
bs = sc.render.bake
bs.use_selected_to_active = True
bs.cage_extrusion = extrusion
bs.max_ray_distance = cage_ray
bs.margin = 8
bs.normal_space = "TANGENT"
bs.use_clear = True

bpy.ops.object.select_all(action="DESELECT")
high.select_set(True); low.select_set(True)
bpy.context.view_layer.objects.active = low

report = {"high": HIGH, "low": LOW, "resolution": res,
          "objectDiagonalMeters": round(diag,5),
          "cageExtrusionMeters": round(extrusion,5),
          "maxRayDistanceMeters": round(cage_ray,5)}
try:
    bpy.ops.object.bake(type="NORMAL", use_clear=True)
    p = os.path.join(OUTDIR, "baked-normal.png")
    img.filepath_raw = p; img.file_format = "PNG"; img.save()
    report["status"] = "baked"; report["normalMapPath"] = p
except Exception as e:
    report["status"] = "failed"; report["error"] = str(e)

json.dump(report, open(os.path.join(OUTDIR,"bake-report.json"),"w"), indent=2)
print("BAKE_STATUS " + report["status"])
