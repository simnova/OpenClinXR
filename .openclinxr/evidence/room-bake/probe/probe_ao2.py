"""AO bake with limited distance: contact darkening at junctions only."""
import sys
import bpy

def _argv_after_double_dash():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]

ao_dist = float(_argv_after_double_dash()[0])

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath="apps/ui-xr/public/xr-assets/environment/infinigen-ed-exam-bay.glb")

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.cycles.use_denoising = False
scene.render.bake.margin = 4
scene.render.bake.use_clear = True
if hasattr(scene.render.bake, "cage_extrusion"):
    scene.render.bake.cage_extrusion = 0.02

world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
scene.world = world
try:
    world.cycles.ao_distance = ao_dist
    print(f"PROBE_AO2 world.cycles.ao_distance set to {ao_dist}")
except Exception as e:
    print(f"PROBE_AO2 ao_distance set failed: {e}")

def find_bsdf(mat):
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node

def mapped_stats(img):
    pixels = list(img.pixels[:])
    n = len(pixels) // 4
    vals = []
    for i in range(n):
        r = pixels[i*4]
        if r > 0.01:
            vals.append(r)
    if not vals:
        return {"mapped": 0}
    vals.sort()
    return {
        "mapped": len(vals),
        "min_p1": round(vals[int(len(vals)*0.01)], 3),
        "p10": round(vals[int(len(vals)*0.10)], 3),
        "p50": round(vals[int(len(vals)*0.50)], 3),
        "p90": round(vals[int(len(vals)*0.90)], 3),
        "max_p99": round(vals[int(len(vals)*0.99)], 3),
        "mean": round(sum(vals)/len(vals), 3),
    }

objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
by_mat = {}
for o in objs:
    mats = [m for m in o.data.materials if m is not None]
    if not mats:
        continue
    by_mat.setdefault(mats[0].name, []).append(o)

for mat_name, objs_ in by_mat.items():
    mat = bpy.data.materials[mat_name]
    if not mat.use_nodes or mat.node_tree is None:
        mat.use_nodes = True
    nt = mat.node_tree
    bsdf = find_bsdf(mat)
    img = bpy.data.images.new(f"ao_{int(ao_dist*100)}_{mat_name}", width=1024, height=1024, alpha=True)
    img_tex = nt.nodes.new("ShaderNodeTexImage")
    img_tex.image = img
    img_tex.select = True
    nt.nodes.active = img_tex
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs_:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs_[0]
    if hasattr(scene, "cycles"):
        scene.cycles.bake_type = "AO"
    bpy.ops.object.bake(type="AO", use_clear=True)
    img.update()
    print(f"PROBE_AO2 dist={ao_dist} mat={mat_name} " + str(mapped_stats(img)))
