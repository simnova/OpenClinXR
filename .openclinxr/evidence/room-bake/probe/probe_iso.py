"""Isolation probe: bake floor material with wall/exterior/ceiling hidden or visible."""
import sys
import bpy

def _argv_after_double_dash():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]

mode = _argv_after_double_dash()[0]

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath="apps/ui-xr/public/xr-assets/environment/infinigen-ed-exam-bay.glb")

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.cycles.use_denoising = False
scene.render.bake.margin = 4
scene.render.bake.use_clear = True

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
light.data.energy = 200

def find_bsdf(mat):
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node

def pixel_stats(img):
    pixels = list(img.pixels[:])
    n = len(pixels) // 4
    lum = [0.2126*pixels[i*4] + 0.7152*pixels[i*4+1] + 0.0722*pixels[i*4+2] for i in range(n)]
    lum.sort()
    return {"min_p1": round(lum[int(n*0.01)],3), "max_p99": round(lum[int(n*0.99)],3), "mean": round(sum(lum)/n,3)}

objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
# visibility policy per mode
for o in objs:
    o.hide_render = False
if mode == "floor_only":
    for o in objs:
        if o.name != "dining-room_0/0.floor":
            o.hide_render = True
elif mode == "floor_plus_walls":
    for o in objs:
        if o.name not in ("dining-room_0/0.floor", "dining-room_0/0.wall"):
            o.hide_render = True
elif mode == "floor_hide_wall":
    for o in objs:
        if o.name == "dining-room_0/0.wall":
            o.hide_render = True

floor = next(o for o in objs if o.name == "dining-room_0/0.floor")
mat = floor.data.materials[0]
nt = mat.node_tree
bsdf = find_bsdf(mat)
img = bpy.data.images.new("iso", width=512, height=512, alpha=True)
img_tex = nt.nodes.new("ShaderNodeTexImage")
img_tex.image = img
img_tex.select = True
nt.nodes.active = img_tex
bpy.ops.object.select_all(action="DESELECT")
floor.select_set(True)
bpy.context.view_layer.objects.active = floor
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT", "COLOR"}, use_clear=True)
print(f"PROBE_ISO mode={mode} floor_stats=" + str(pixel_stats(img)))
