"""Probe for issue-345: Cycles DIFFUSE bake (albedo + AO) on the real Infinigen room.

Tests two lighting configs, reports pixel statistics per material (to confirm real
contact darkening, not a flat fill), then wires the better config's images and exports
a GLB to verify baseColorTexture survives glTF export (the #343-proven mechanism).

Run: blender --background --python probe_room_bake.py -- <input.glb> <output.glb>
"""
import argparse
import math
import os
import sys

import bpy


def _argv_after_double_dash():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)
    for img in list(bpy.data.images):
        bpy.data.images.remove(img)


def setup_cycles(scene):
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = False
    if hasattr(scene.render, "bake"):
        scene.render.bake.margin = 4
        scene.render.bake.use_clear = True


def set_world(use_light, strength):
    world = bpy.data.worlds.get("World")
    if world is None:
        world = bpy.data.worlds.new("World")
        bpy.context.scene.world = world
    world.use_nodes = True
    bg = None
    for node in world.node_tree.nodes:
        if node.type == "BACKGROUND":
            bg = node
            break
    if bg is None:
        bg = world.node_tree.nodes.new("ShaderNodeBackground")
        world.node_tree.links.new(bg.outputs["Background"], world.node_tree.nodes["World Output"].inputs["Surface"])
    bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs["Strength"].default_value = strength if use_light else 0.0


def ensure_area_light(name, location, size, strength):
    if name in bpy.data.objects:
        light = bpy.data.objects[name]
    else:
        light_data = bpy.data.lights.new(name, type="AREA")
        light = bpy.data.objects.new(name, light_data)
        bpy.context.collection.objects.link(light)
    light.location = location
    light.rotation_euler = (0, 0, 0)
    light.data.size = size
    light.data.size_y = size
    light.data.energy = strength
    return light


def ensure_uv(mesh_obj):
    me = mesh_obj.data
    if not me.uv_layers:
        bpy.ops.object.select_all(action="DESELECT")
        mesh_obj.select_set(True)
        bpy.context.view_layer.objects.active = mesh_obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")


def find_bsdf(mat):
    if not mat.use_nodes or mat.node_tree is None:
        return None
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None


def bake_material(mesh_objs, mat, image_name, resolution=1024):
    """Bake DIFFUSE for all meshes using `mat` into a packed image on that material."""
    if not mat.use_nodes or mat.node_tree is None:
        mat.use_nodes = True
    nt = mat.node_tree
    bsdf = find_bsdf(mat)
    if bsdf is None:
        raise RuntimeError(f"material {mat.name} has no Principled BSDF")

    # Bake target image.
    if image_name in bpy.data.images:
        img = bpy.data.images[image_name]
    else:
        img = bpy.data.images.new(image_name, width=resolution, height=resolution, alpha=True, float_buffer=False)
    img.colorspace_settings.name = "sRGB"

    img_tex = None
    for node in nt.nodes:
        if node.type == "TEX_IMAGE" and node.image and node.image.name == image_name:
            img_tex = node
            break
    if img_tex is None:
        img_tex = nt.nodes.new("ShaderNodeTexImage")
        img_tex.image = img
    img_tex.select = True
    nt.nodes.active = img_tex

    # Select the meshes that use this material.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_objs[0]

    # Ensure the bake uses this material's base color: the glTF-imported BSDF
    # carries baseColorFactor as a constant on Base Color — bake reads it.
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT", "COLOR"}, use_clear=True)

    # Pack so glTF export embeds bytes.
    img.pack()
    return img


def pixel_stats(img):
    """min/max/mean luminance + fraction of pixels below 0.85 (darkening evidence)."""
    pixels = list(img.pixels[:])
    n = len(pixels) // 4
    lum = []
    for i in range(n):
        r, g, b = pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]
        lum.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
    lum.sort()
    lo = lum[int(n * 0.01)]
    hi = lum[int(n * 0.99)]
    mean = sum(lum) / n
    dark = sum(1 for v in lum if v < 0.85) / n
    return {"min_p1": round(lo, 4), "max_p99": round(hi, 4), "mean": round(mean, 4), "frac_below_0.85": round(dark, 4)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input_glb")
    ap.add_argument("output_glb")
    args = ap.parse_args(_argv_after_double_dash())

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=args.input_glb)

    scene = bpy.context.scene
    setup_cycles(scene)

    mesh_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in mesh_objs:
        ensure_uv(o)

    # Group meshes by material name (first material slot).
    by_mat = {}
    for obj in mesh_objs:
        mats = [m for m in obj.data.materials if m is not None]
        if not mats:
            continue
        mat = mats[0]
        by_mat.setdefault(mat.name, []).append(obj)

    # --- Config A: world ambient only ---
    set_world(True, 1.0)
    if "room_probe_key" in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects["room_probe_key"], do_unlink=True)
    stats_a = {}
    for mat_name, objs in by_mat.items():
        mat = bpy.data.materials[mat_name]
        img = bake_material(objs, mat, f"probe_a_{mat_name}")
        stats_a[mat_name] = pixel_stats(img)

    # --- Config B: dim world + soft area light INSIDE the room (Z-up room: floor z=0, ceiling z=2.4) ---
    set_world(True, 0.15)
    ensure_area_light("room_probe_key", (0, 0, 2.2), 3.5, 400)
    stats_b = {}
    for mat_name, objs in by_mat.items():
        mat = bpy.data.materials[mat_name]
        img = bake_material(objs, mat, f"probe_b_{mat_name}")
        stats_b[mat_name] = pixel_stats(img)

    # --- Config C: same light, but flip normals on meshes whose interior faces point away ---
    import mathutils

    def flip_if_interior_dark():
        for obj in mesh_objs:
            mx = obj.matrix_world.to_3x3()
            me = obj.data
            flipped = 0
            for poly in me.polygons:
                n = mx @ poly.normal
                # A face "faces the room interior" if its normal points toward room center.
                center_dir = mathutils.Vector((0, 0, 1.2)) - (mx @ poly.center)
                if n.dot(center_dir) < 0:
                    flipped += 1
            if flipped > len(me.polygons) / 2:
                me.flip_normals()
                print(f"PROBE_FLIP={obj.name} flipped {flipped}/{len(me.polygons)}")

    flip_if_interior_dark()
    stats_c = {}
    for mat_name, objs in by_mat.items():
        mat = bpy.data.materials[mat_name]
        img = bake_material(objs, mat, f"probe_c_{mat_name}")
        stats_c[mat_name] = pixel_stats(img)

    # --- Wire config C images as Base Color and export ---
    for mat_name in by_mat:
        mat = bpy.data.materials[mat_name]
        nt = mat.node_tree
        bsdf = find_bsdf(mat)
        img = bpy.data.images[f"probe_c_{mat_name}"]
        img_tex = None
        for node in nt.nodes:
            if node.type == "TEX_IMAGE" and node.image and node.image.name == img.name:
                img_tex = node
                break
        if img_tex is None:
            img_tex = nt.nodes.new("ShaderNodeTexImage")
            img_tex.image = img
        # Replace constant Base Color with texture.
        for link in list(bsdf.inputs["Base Color"].links):
            nt.links.remove(link)
        nt.links.new(img_tex.outputs["Color"], bsdf.inputs["Base Color"])

    # Remove the probe light so no light node ships in the GLB.
    if "room_probe_key" in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects["room_probe_key"], do_unlink=True)

    os.makedirs(os.path.dirname(args.output_glb), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=args.output_glb, export_format="GLB", export_animations=False)

    print("PROBE_STATS_A=" + str(stats_a))
    print("PROBE_STATS_B=" + str(stats_b))
    print("PROBE_STATS_C=" + str(stats_c))
    print("PROBE_EXPORTED=" + args.output_glb)


if __name__ == "__main__":
    main()
