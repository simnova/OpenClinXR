"""#598 grade render — front-low; height on Z; look +Y slightly down."""
import bpy
import math
import pathlib
import mathutils

REPO = pathlib.Path(__file__).resolve().parents[3]
GLB = REPO / "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb"
OUT = REPO / ".openclinxr/evidence/issue-598/nurse-feet-grade.png"

bpy.ops.wm.read_factory_settings(use_empty=True)
for o in list(bpy.context.scene.objects):
    bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.import_scene.gltf(filepath=str(GLB))
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1600
scene.render.resolution_y = 900
scene.render.filepath = str(OUT)
scene.render.image_settings.file_format = "PNG"
scene.world = bpy.data.worlds.new("W")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.12, 0.12, 0.14, 1)

for obj in scene.objects:
    if obj.type != "MESH":
        continue
    name = obj.name.lower()
    is_shoe = "footwear" in name
    is_body = name.endswith("_body")
    if not is_shoe and not is_body:
        obj.hide_render = True
        continue
    for slot in obj.material_slots:
        mat = slot.material
        if mat is None:
            continue
        mat.use_nodes = True
        nt = mat.node_tree
        principled = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if principled is None:
            continue
        base = principled.inputs["Base Color"]
        for link in list(base.links):
            nt.links.remove(link)
        if is_shoe:
            base.default_value = (0.05, 0.62, 0.48, 1.0)
        else:
            base.default_value = (0.82, 0.62, 0.52, 1.0)

cam_data = bpy.data.cameras.new("grade_cam")
cam = bpy.data.objects.new("grade_cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.type = "ORTHO"
cam_data.ortho_scale = 0.40
cam.location = (0.0, -0.75, 0.20)
cam.rotation_mode = "XYZ"
cam.rotation_euler = (math.radians(72), 0.0, 0.0)
bpy.context.view_layer.update()
look = cam.matrix_world.to_quaternion() @ mathutils.Vector((0.0, 0.0, -1.0))
print(f"LOOK_DIR {tuple(round(c,3) for c in look)} cam={tuple(round(c,3) for c in cam.location)}")

for energy, loc in ((1000, (0.5, -0.5, 0.9)), (400, (-0.5, -0.35, 0.5))):
    ld = bpy.data.lights.new(f"L{energy}", type="AREA")
    ld.energy = energy
    ld.size = 1.2
    lo = bpy.data.objects.new(f"L{energy}", ld)
    scene.collection.objects.link(lo)
    lo.location = loc

bpy.ops.render.render(write_still=True)
print(f"WROTE {OUT} bytes={OUT.stat().st_size}")
