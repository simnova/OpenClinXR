"""Treatment M: photo surfaces on the existing shell. Materials, lights, camera, and two cards."""
import bpy
import bmesh
from mathutils import Vector

bpy.ops.wm.open_mainfile(
    filepath="/Users/patrick/.openclinxr-tools/infinigen/outputs/carpet_trim_seed7_fix/scene.blend"
)

IMG = "/Users/patrick/.grok/sessions/%2FVolumes%2Ffiles%2Fsrc%2Fopenclinxr/01a0c701-2de0-7c91-b7b0-4b81a622ad55/images"
CEILING_IMG = IMG + "/4.jpg"
FLOOR_IMG = IMG + "/7.jpg"
DOOR_IMG = IMG + "/5.jpg"
LIGHT_IMG = IMG + "/2.jpg"


def principled(name, color, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def image_object(name, path, scale_xy, roughness, emission):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "sRGB"
    tex.image = img
    tex.extension = "REPEAT"
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale_xy, scale_xy, scale_xy)
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if emission > 0:
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emission
    bsdf.inputs["Roughness"].default_value = roughness
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def uv_image(name, path, emission, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "sRGB"
    tex.image = img
    tex.extension = "EXTEND"
    coord = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(coord.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if emission > 0:
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emission
    bsdf.inputs["Roughness"].default_value = roughness
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def sheet_vinyl():
    mat = bpy.data.materials.new("sheet_vinyl")
    mat.use_nodes = True
    nt = mat.node_tree
    nodes = nt.nodes
    links = nt.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    geo = nodes.new("ShaderNodeNewGeometry")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(geo.outputs["Position"], sep.inputs["Vector"])
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (2.5, 160.0, 1.0)
    links.new(geo.outputs["Position"], mapping.inputs["Vector"])
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 1.0
    noise.inputs["Detail"].default_value = 4.0
    noise.inputs["Roughness"].default_value = 0.62
    links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    grain = nodes.new("ShaderNodeMapRange")
    grain.inputs["From Min"].default_value = 0.42
    grain.inputs["From Max"].default_value = 0.58
    grain.inputs["To Min"].default_value = 0.0
    grain.inputs["To Max"].default_value = 0.55
    grain.clamp = True
    links.new(noise.outputs["Fac"], grain.inputs["Value"])
    mix_line = nodes.new("ShaderNodeMix")
    mix_line.data_type = "RGBA"
    mix_line.inputs["A"].default_value = (0.93, 0.86, 0.72, 1)
    mix_line.inputs["B"].default_value = (0.78, 0.70, 0.54, 1)
    links.new(grain.outputs["Result"], mix_line.inputs["Factor"])

    def axis_dist(socket, at):
        sub = nodes.new("ShaderNodeMath")
        sub.operation = "SUBTRACT"
        sub.inputs[1].default_value = at
        links.new(socket, sub.inputs[0])
        ab = nodes.new("ShaderNodeMath")
        ab.operation = "ABSOLUTE"
        links.new(sub.outputs["Value"], ab.inputs[0])
        return ab.outputs["Value"]

    nearest = nodes.new("ShaderNodeMath")
    nearest.operation = "MINIMUM"
    links.new(axis_dist(sep.outputs["X"], 11.05), nearest.inputs[0])
    links.new(axis_dist(sep.outputs["X"], 12.45), nearest.inputs[1])
    seam_map = nodes.new("ShaderNodeMapRange")
    seam_map.inputs["From Min"].default_value = 0.002
    seam_map.inputs["From Max"].default_value = 0.010
    seam_map.inputs["To Min"].default_value = 1.0
    seam_map.inputs["To Max"].default_value = 0.0
    seam_map.clamp = True
    links.new(nearest.outputs["Value"], seam_map.inputs["Value"])
    seam_mix = nodes.new("ShaderNodeMix")
    seam_mix.data_type = "RGBA"
    seam_mix.inputs["B"].default_value = (0.66, 0.60, 0.52, 1)
    links.new(seam_map.outputs["Result"], seam_mix.inputs["Factor"])
    links.new(mix_line.outputs["Result"], seam_mix.inputs["A"])
    links.new(seam_mix.outputs["Result"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.55
    spec = bsdf.inputs.get("Specular IOR Level") or bsdf.inputs.get("Specular")
    if spec is not None:
        spec.default_value = 0.22
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def refresh_view_layer():
    bpy.context.view_layer.update()

def quad(name, coords, uvs, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(coords, [], [(0, 1, 2, 3)])
    mesh.uv_layers.new(name="UVMap")
    uv_layer = mesh.uv_layers.active.data
    for i, pair in enumerate(uvs):
        uv_layer[i].uv = pair
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    mesh.materials.append(mat)
    return obj


wall_mat = principled("drywall", (0.94, 0.94, 0.92), 0.68)
cove_mat = principled("cove_gray", (0.58, 0.59, 0.60), 0.55)
ceil_mat = image_object("acoustic_tiles", CEILING_IMG, 0.42, 0.9, 0.0)
floor_mat = sheet_vinyl()

for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    if obj.name.endswith(".ceiling"):
        obj.data.materials.clear()
        obj.data.materials.append(ceil_mat)
    elif obj.name.endswith(".wall"):
        obj.data.materials.clear()
        obj.data.materials.append(wall_mat)
    elif obj.name.endswith(".floor"):
        obj.data.materials.clear()
        obj.data.materials.append(floor_mat)
    elif obj.name == "skirtingboard_support":
        obj.data.materials.clear()
        obj.data.materials.append(cove_mat)
    elif obj.name == "skirtingboard_ceiling":
        obj.data.materials.clear()
        obj.data.materials.append(wall_mat)

# House windows in this view. Hide the glass and cover the cut with drywall.
hide_windows = {
    "WindowFactory(84149).spawn_asset(4)",
    "WindowFactory(84149).spawn_asset(5)",
    "window.004",
    "window.005",
}
for obj in bpy.data.objects:
    if obj.name in hide_windows:
        obj.hide_render = True

quad(
    "window_cap",
    [
        (12.80, 9.670, 0.30),
        (12.80, 9.670, 2.74),
        (15.05, 9.670, 2.74),
        (15.05, 9.670, 0.30),
    ],
    [(0, 0), (0, 1), (1, 1), (1, 0)],
    wall_mat,
)

# Closed maple leaf in the casing, hiding the open louver slab.
door_name = "LouverDoorFactory(5789929).spawn_asset(1)"
if door_name in bpy.data.objects:
    bpy.data.objects[door_name].hide_render = True
casing_mat = principled("casing_paint", (0.90, 0.90, 0.88), 0.5)
for obj in bpy.data.objects:
    if obj.type == "MESH" and "Casing" in obj.name:
        obj.data.materials.clear()
        obj.data.materials.append(casing_mat)

quad(
    "maple_leaf",
    [
        (10.20, 9.64, 0.16),
        (10.16, 9.64, 2.50),
        (10.96, 9.64, 2.50),
        (11.00, 9.64, 0.16),
    ],
    [(0, 0), (0, 1), (1, 1), (1, 0)],
    uv_image("maple_door_photo", DOOR_IMG, 0.0, 0.48),
)

quad(
    "troffer_face",
    [
        (10.700, 9.950, 2.732),
        (12.500, 9.950, 2.732),
        (12.500, 10.550, 2.732),
        (10.700, 10.550, 2.732),
    ],
    [(0, 0), (1, 0), (1, 1), (0, 1)],
    uv_image("troffer_photo", LIGHT_IMG, 0.55, 0.4),
)

refresh_view_layer()

cam_loc = Vector((12.10, 11.45, 1.42))
look = Vector((10.30, 9.52, 1.68))
cam_data = bpy.data.cameras.new("clinic_m")
cam = bpy.data.objects.new("clinic_m", cam_data)
bpy.context.collection.objects.link(cam)
bpy.context.scene.camera = cam
cam.location = cam_loc
cam.rotation_euler = (look - cam_loc).to_track_quat("-Z", "Y").to_euler()
cam_data.lens = 12

light_data = bpy.data.lights.new("down", "AREA")
for obj in list(bpy.data.objects):
    if obj.type == "LIGHT":
        obj.data.energy = 0
        obj.hide_render = True

light_data.energy = 10
light_data.shape = "RECTANGLE"
light_data.size = 1.3
light_data.size_y = 0.5
light_data.color = (1.0, 0.96, 0.90)
light = bpy.data.objects.new("down", light_data)
bpy.context.collection.objects.link(light)
light.location = Vector((11.8, 10.85, 2.60))

wash_data = bpy.data.lights.new("ceiling_wash", "AREA")
wash_data.energy = 14
wash_data.size = 3.0
wash_data.color = (1.0, 1.0, 0.98)
wash = bpy.data.objects.new("ceiling_wash", wash_data)
bpy.context.collection.objects.link(wash)
wash.location = Vector((12.0, 11.5, 1.4))
wash.rotation_euler = (3.1416, 0, 0)

scene = bpy.context.scene
world = scene.world
if world and world.use_nodes:
    nt = world.node_tree
    bg = None
    for node in nt.nodes:
        if node.type != "BACKGROUND":
            continue
        if any(link.from_node == node and link.to_node.type == "OUTPUT_WORLD" for link in nt.links):
            bg = node
    if bg:
        for link in list(nt.links):
            if link.to_node == bg:
                nt.links.remove(link)
        bg.inputs[0].default_value = (0.96, 0.95, 0.93, 1)
        bg.inputs[1].default_value = 0.35
try:
    scene.view_settings.view_transform = "Standard"
except Exception:
    pass
scene.view_settings.exposure = 0.0

for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.filepath = (
    "/Volumes/files/src/openclinxr/.openclinxr/evidence/room-realism-shell/room-clinic-xu.png"
)

nt = ceil_mat.node_tree
ctex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
cbsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
for link in list(nt.links):
    if link.from_node == ctex and link.to_node == cbsdf and link.to_socket.name == "Base Color":
        nt.links.remove(link)
cbright = nt.nodes.new("ShaderNodeBrightContrast")
cbright.inputs["Bright"].default_value = 0.28
cbright.inputs["Contrast"].default_value = 0.22
nt.links.new(ctex.outputs["Color"], cbright.inputs["Color"])
nt.links.new(cbright.outputs["Color"], cbsdf.inputs["Base Color"])
tmat = bpy.data.materials["troffer_photo"]
tnt = tmat.node_tree
ttex = next(n for n in tnt.nodes if n.type == "TEX_IMAGE")
tbsdf = next(n for n in tnt.nodes if n.type == "BSDF_PRINCIPLED")
for link in list(tnt.links):
    if link.from_node == ttex and link.to_socket.name in {"Base Color", "Emission Color"}:
        tnt.links.remove(link)
mix = tnt.nodes.new("ShaderNodeMixRGB")
mix.blend_type = "MIX"
mix.inputs["Fac"].default_value = 0.52
mix.inputs["Color2"].default_value = (1.0, 0.96, 0.88, 1)
tnt.links.new(ttex.outputs["Color"], mix.inputs["Color1"])
tnt.links.new(mix.outputs["Color"], tbsdf.inputs["Base Color"])
tnt.links.new(mix.outputs["Color"], tbsdf.inputs["Emission Color"])
bpy.ops.render.render(write_still=True)
print("WROTE", scene.render.filepath)
