#!/usr/bin/env python3
"""#641 diag 5: isolate the floor object.
A) bake it ALONE with the script's exact node flow (restore albedo + fresh target).
B) same geometry, TRIVIAL material (BSDF + output + target node only).
Both use DIFFUSE DIRECT+INDIRECT+COLOR at 1024. Prints meanL and UV-region samples."""
import sys
import os
import importlib.util

args = sys.argv[sys.argv.index("--") + 1:]
REPO = args[0]
INPUT = args[1]
_SPEC = importlib.util.spec_from_file_location(
    "room_albedo_ao_bake",
    os.path.join(REPO, "tools/openclinxr/asset-pipeline/environment/room-albedo-ao-bake.py"),
)
rb = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = rb
assert _SPEC.loader is not None
_SPEC.loader.exec_module(rb)
import bpy  # noqa: E402


def mean_l(img):
    pixels = list(img.pixels)
    n = img.size[0] * img.size[1]
    acc = 0.0
    for i in range(n):
        acc += 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2]
    return (acc / n) * 255.0


def bake_active(img, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT", "COLOR"}, use_clear=True)
    return mean_l(img)


rb.clear_scene()
bpy.ops.import_scene.gltf(filepath=INPUT)
bbox = rb.scene_bbox()
rb.setup_scene(bbox, "distributed")

floor_mat = next(m for m in bpy.data.materials if "marble" in m.name and "tile" in m.name)
floor_obj = next(
    o for o in bpy.context.scene.objects
    if o.type == "MESH" and o.data.materials and o.data.materials[0] == floor_mat
)

# --- A) bake the floor ALONE, script's exact flow ---
for o in list(bpy.context.scene.objects):
    if o != floor_obj:
        bpy.data.objects.remove(o, do_unlink=True)

rb.restore_bright_albedo(floor_mat, "floor")
nt = floor_mat.node_tree
img_name = rb.bake_image_name_for_material(floor_mat)
if img_name in bpy.data.images:
    bpy.data.images.remove(bpy.data.images[img_name])
img = bpy.data.images.new(img_name, width=1024, height=1024, alpha=True, float_buffer=False)
img.colorspace_settings.name = "sRGB"
img_tex = next(
    (n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image and n.image.name == img_name),
    None,
)
if img_tex is None:
    img_tex = nt.nodes.new("ShaderNodeTexImage")
img_tex.image = img
img_tex.select = True
nt.nodes.active = img_tex
mean_a = bake_active(img, [floor_obj])
print(f"[diag5] A) floor ALONE, script flow: meanL={mean_a:.2f}")

# --- B) trivial material on the same geometry ---
mat2 = bpy.data.materials.new("diag_trivial")
mat2.use_nodes = True
nt2 = mat2.node_tree
for node in list(nt2.nodes):
    nt2.nodes.remove(node)
bsdf2 = nt2.nodes.new("ShaderNodeBsdfPrincipled")
bsdf2.inputs["Base Color"].default_value = (0.96, 0.95, 0.93, 1.0)
out2 = nt2.nodes.new("ShaderNodeOutputMaterial")
nt2.links.new(bsdf2.outputs["BSDF"], out2.inputs["Surface"])
img2 = bpy.data.images.new("diag_trivial_img", width=1024, height=1024, alpha=True)
img2.colorspace_settings.name = "sRGB"
tex2 = nt2.nodes.new("ShaderNodeTexImage")
tex2.image = img2
tex2.select = True
nt2.nodes.active = tex2
floor_obj.data.materials.clear()
floor_obj.data.materials.append(mat2)
mean_b = bake_active(img2, [floor_obj])
print(f"[diag5] B) floor alone, trivial material: meanL={mean_b:.2f}")

# sample both images in the UVMap region u:[0,0.375] v:[0,0.639]
for label, im in (("A", img), ("B", img2)):
    pix = list(im.pixels)
    w, h = im.size
    vals = []
    for y in range(0, h, 128):
        row = []
        for x in range(0, w, 128):
            i = (y * w + x) * 4
            row.append(f"{round(pix[i] * 255)},{round(pix[i + 1] * 255)},{round(pix[i + 2] * 255)}")
        vals.append(f"y={y}: " + " ".join(row))
    print(f"[diag5] {label} image samples:")
    for v in vals:
        print("   ", v)
