"""Quick tunable bake probe for issue-345: interior light + cage extrusion.

Tests whether cage_extrusion fixes the coincident-face floor occlusion, and
tunes light strength for a sensible interior exposure with contact darkening.

Run: blender --background --python probe_iter.py -- <input.glb> <light_strength> <cage>
"""
import sys
import bpy
import mathutils


def _argv_after_double_dash():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.materials, bpy.data.images, bpy.data.meshes):
        for item in list(block):
            try:
                block.remove(item)
            except Exception:
                pass


def find_bsdf(mat):
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            return node
    return None


def pixel_stats(img):
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
    return {"min_p1": round(lo, 3), "max_p99": round(hi, 3), "mean": round(mean, 3), "frac_below_0.85": round(dark, 3)}


def main():
    args = _argv_after_double_dash()
    inp = args[0]
    light_strength = float(args[1]) if len(args) > 1 else 200.0
    cage = float(args[2]) if len(args) > 2 else 0.0

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=inp)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 4
    scene.render.bake.use_clear = True
    scene.render.bake.cage_extrusion = cage

    # World ambient fill.
    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs["Strength"].default_value = 0.15

    # Interior area light above the room (Z-up: floor z=0, ceiling z=2.4).
    light_data = bpy.data.lights.new("room_key", type="AREA")
    light = bpy.data.objects.new("room_key", light_data)
    bpy.context.collection.objects.link(light)
    light.location = (0, 0, 2.15)
    light.rotation_euler = (0, 0, 0)
    light.data.size = 3.5
    light.data.size_y = 3.5
    light.data.energy = light_strength

    # Group meshes by material.
    mesh_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    by_mat = {}
    for obj in mesh_objs:
        mats = [m for m in obj.data.materials if m is not None]
        if not mats:
            continue
        by_mat.setdefault(mats[0].name, []).append(obj)

    # Bake per material.
    stats = {}
    for mat_name, objs in by_mat.items():
        mat = bpy.data.materials[mat_name]
        if not mat.use_nodes or mat.node_tree is None:
            mat.use_nodes = True
        nt = mat.node_tree
        bsdf = find_bsdf(mat)
        img = bpy.data.images.new(f"bake_{mat_name}", width=1024, height=1024, alpha=True)
        img.colorspace_settings.name = "sRGB"
        img_tex = nt.nodes.new("ShaderNodeTexImage")
        img_tex.image = img
        img_tex.select = True
        nt.nodes.active = img_tex
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objs:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT", "COLOR"}, use_clear=True)
        img.pack()
        stats[mat_name] = pixel_stats(img)

    print(f"PROBE_ITER light={light_strength} cage={cage}")
    print("PROBE_ITER_STATS=" + str(stats))
    print("PROBE_ITER_MESHES=" + str({o.name: (round(o.matrix_world.to_3x3() @ sum((p.normal for p in o.data.polygons), mathutils.Vector((0, 0, 0))) / max(1, len(o.data.polygons)), 3) if len(o.data.polygons) else None) for o in mesh_objs}))


if __name__ == "__main__":
    main()
