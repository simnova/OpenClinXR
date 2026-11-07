"""Blender side of the hull2 figure (runs inside Blender only).

Reads: the pinned body GLB, E/../workspace/hull_surface.obj, the pinned
camera file, the four aisha-v2 target images (display tiles). Removes
the library topper (same name rule as the station runner). Imports the
hull surface with an OPAQUE light-grey hair material (EEVEE, blend
OPAQUE, roughness 0.55) lit by the world plus an explicit SUN key and
a weaker SUN fill so the hull shape reads with simple shading (the
hull1 figure's translucent alpha-0.6 murk hid exactly the asymmetry
this slice diagnoses). Renders 512 px frames for front / three_quarter
/ profile_90 / back, and writes an 8-panel composite (E/hull.png:
render,target pairs per view; targets display only, no score) plus
per-view PNGs and E/blender-opened.txt. No fitting.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy

RES = 512
VIEWS = ("front", "three_quarter", "profile_90", "back")
TARGETS = {"front": "target-front.png",
           "three_quarter": "target-three_quarter.png",
           "profile_90": "target-profile.png",
           "back": "target-back.png"}
HULL_RGB = (0.78, 0.78, 0.80, 1.0)


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--obj", required=True)
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--glb", required=True)
    parser.add_argument("--cameras", required=True)
    parser.add_argument("--targets-dir", required=True)
    parser.add_argument("--opened", required=True)
    parser.add_argument("--stem", default="hull")
    parser.add_argument("--shadeless", action="store_true",
                        help="flat emission material, no suns: measurement "
                             "silhouette pass (diagnostic only)")
    parser.add_argument("--res", type=int, default=RES)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def load_body(glb):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    imported = [obj for obj in bpy.data.objects if obj not in before]
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("body GLB imported no mesh objects")
    removed = []
    removed_ids = set()
    for obj in list(meshes):
        lowered = obj.name.lower()
        if "hair" in lowered and "brow" not in lowered \
                and "lash" not in lowered:
            removed.append(obj.name)
            removed_ids.add(id(obj))
            bpy.data.objects.remove(obj, do_unlink=True)
    kept = [obj for obj in meshes if id(obj) not in removed_ids]
    remaining = [obj.name for obj in kept if "hair" in obj.name.lower()]
    if remaining:
        raise RuntimeError("topper exclusion incomplete: %r" % (remaining,))
    return kept, sorted(removed)


def add_hull(obj_path, shadeless=False):
    from mathutils import Matrix  # noqa: F401  (import guard parity)
    before = set(bpy.data.objects)
    try:
        bpy.ops.wm.obj_import(filepath=str(obj_path),
                              forward_axis="NEGATIVE_Y", up_axis="Z")
    except AttributeError:
        bpy.ops.import_scene.obj(filepath=str(obj_path),
                                 axis_forward="-Y", axis_up="Z")
    hull_objs = [o for o in bpy.data.objects
                 if o not in before and o.type == "MESH"]
    if not hull_objs:
        raise RuntimeError("hull OBJ imported no mesh")
    hull = hull_objs[0]
    mat = bpy.data.materials.new("HULL_HAIR_OPAQUE")
    hull.data.materials.append(mat)
    if shadeless:
        mat.node_tree.nodes.clear()
        out = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
        em = mat.node_tree.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        mat.node_tree.links.new(em.outputs["Emission"],
                                out.inputs["Surface"])
        tris = len(hull.data.polygons)
        return hull.name, tris
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = HULL_RGB
    for key in ("Metallic", "Specular"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = 0.0
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = 0.55
    if "Alpha" in bsdf.inputs:
        bsdf.inputs["Alpha"].default_value = 1.0
    if hasattr(mat, "surface_render_method"):
        # Blender 5.1 EEVEE: ('DITHERED', 'BLENDED'); DITHERED is the
        # opaque option (no alpha sorting, solid surface).
        try:
            mat.surface_render_method = "DITHERED"
        except TypeError:
            pass
    if hasattr(mat, "blend_method"):
        try:
            mat.blend_method = "OPAQUE"
        except TypeError:
            pass
    mat.use_backface_culling = False
    tris = len(hull.data.polygons)
    return hull.name, tris


def add_sun(name, energy, rotation_euler):
    data = bpy.data.lights.new(name, "SUN")
    data.energy = energy
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.rotation_euler = rotation_euler
    return obj.name


def main():
    import json
    from mathutils import Matrix
    args = cli()
    res = int(args.res)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    tdir = Path(args.targets_dir)
    cams = json.loads(Path(args.cameras).read_text())
    opened = [str(Path(args.obj).resolve()),
              str(Path(args.glb).resolve()),
              str(Path(args.cameras).resolve())]
    for t in TARGETS.values():
        opened.append(str((tdir / t).resolve()))

    kept, removed = load_body(Path(args.glb))
    hull_name, tris = add_hull(Path(args.obj),
                               shadeless=args.shadeless)
    if not args.shadeless:
        add_sun("HULL_key", 3.0, (0.6, 0.15, 0.9))
        add_sun("HULL_fill", 0.8, (2.4, -0.2, -2.2))
    else:
        scene0 = bpy.context.scene
        scene0.world.node_tree.nodes["Background"].inputs[0].default_value = \
            (0.0, 0.0, 0.0, 1.0)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    try:
        scene.eevee.taa_render_samples = 64
    except AttributeError:
        pass

    cam_data = bpy.data.cameras.new("HULL_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    camera = bpy.data.objects.new("HULL_cam", cam_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    from PIL import Image, ImageDraw
    panels = []
    for view in VIEWS:
        rec = cams["views"][view]
        cam_data.lens = float(rec["lensMm"])
        camera.matrix_world = Matrix(rec["matrixWorld"])
        bpy.context.view_layer.update()
        beauty = outdir / ("%s-%s.png" % (args.stem, view))
        bpy.context.scene.render.filepath = str(beauty)
        bpy.ops.render.render(write_still=True)
        img = Image.open(beauty).convert("RGB")
        panel = Image.new("RGB", (res, res + 28), (16, 16, 16))
        panel.paste(img, (0, 28))
        ImageDraw.Draw(panel).text((8, 7), view + " hull (opaque)",
                                   fill=(255, 255, 255))
        panels.append(panel)
        target = Image.open(tdir / TARGETS[view]).convert("RGB")
        target = target.resize((res, res))
        tpanel = Image.new("RGB", (res, res + 28), (16, 16, 16))
        tpanel.paste(target, (0, 28))
        ImageDraw.Draw(tpanel).text((8, 7), view + " target (display)",
                                    fill=(255, 255, 255))
        panels.append(tpanel)
    frame = Image.new("RGB", (res * len(panels), res + 28), (0, 0, 0))
    for i, panel in enumerate(panels):
        frame.paste(panel, (res * i, 0))
    frame.save(outdir / (args.stem + ".png"))
    Path(args.opened).write_text("\n".join(sorted(set(opened))) + "\n")
    print("REMOVED_TOPPERS %s" % (removed,), flush=True)
    print("HULL_OBJECT %s tris=%d" % (hull_name, tris), flush=True)
    print("HULL_FIGURE %s" % (outdir / (args.stem + ".png")), flush=True)


if __name__ == "__main__":
    main()
