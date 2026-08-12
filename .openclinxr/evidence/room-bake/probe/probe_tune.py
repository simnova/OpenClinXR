"""Tune light strength for the room bake: try N strengths in one Blender run,
report mapped-texel stats (image pre-filled with 0.5 gray, bake without clear).
"""
import sys
import bpy

def _argv_after_double_dash():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]

strengths = [float(x) for x in _argv_after_double_dash()]

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath="apps/ui-xr/public/xr-assets/environment/infinigen-ed-exam-bay.glb")

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.cycles.use_denoising = False
scene.render.bake.margin = 4

world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = (1, 1, 1, 1)
bg.inputs["Strength"].default_value = 0.15

light_data = bpy.data.lights.new("room_key", type="AREA")
light = bpy.data.objects.new("room_key", light_data)
bpy.context.collection.objects.link(light)
light.location = (0, 0, 2.15)
light.data.size = 3.5
light.data.size_y = 3.5

def find_bsdf(mat):
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node

def mapped_stats(img):
    """Stats over texels that differ from the 0.5 gray fill (i.e. mapped by the mesh)."""
    pixels = list(img.pixels[:])
    n = len(pixels) // 4
    mapped = []
    for i in range(n):
        r, g, b = pixels[i*4], pixels[i*4+1], pixels[i*4+2]
        if abs(r - 0.5) > 0.02 or abs(g - 0.5) > 0.02 or abs(b - 0.5) > 0.02:
            mapped.append(0.2126*r + 0.7152*g + 0.0722*b)
    if not mapped:
        return {"mapped_texels": 0}
    mapped.sort()
    return {
        "mapped_texels": len(mapped),
        "min_p1": round(mapped[int(len(mapped)*0.01)], 3),
        "max_p99": round(mapped[int(len(mapped)*0.99)], 3),
        "mean": round(sum(mapped)/len(mapped), 3),
        "frac_below_0.5": round(sum(1 for v in mapped if v < 0.5)/len(mapped), 3),
        "frac_above_0.9": round(sum(1 for v in mapped if v > 0.9)/len(mapped), 3),
    }

objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
by_mat = {}
for o in objs:
    mats = [m for m in o.data.materials if m is not None]
    if not mats:
        continue
    by_mat.setdefault(mats[0].name, []).append(o)

for strength in strengths:
    light.data.energy = strength
    stats = {}
    for mat_name, objs_ in by_mat.items():
        mat = bpy.data.materials[mat_name]
        if not mat.use_nodes or mat.node_tree is None:
            mat.use_nodes = True
        nt = mat.node_tree
        bsdf = find_bsdf(mat)
        img = bpy.data.images.new(f"tune_{int(strength)}_{mat_name}", width=512, height=512, alpha=True)
        # Pre-fill with 0.5 gray (fast slice assignment).
        img.pixels[:] = [0.5, 0.5, 0.5, 1.0] * (512 * 512)
        img_tex = nt.nodes.new("ShaderNodeTexImage")
        img_tex.image = img
        img_tex.select = True
        nt.nodes.active = img_tex
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs_:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs_[0]
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT", "COLOR"}, use_clear=False)
        img.update()
        stats[mat_name] = mapped_stats(img)
    print(f"PROBE_TUNE strength={strength} " + str(stats))
