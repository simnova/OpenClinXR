"""Blender side of the hull figure (runs inside Blender only).

Reads: the pinned body GLB, E/../workspace/hull_surface.obj, the pinned
camera file, the target three_quarter mask (display tile). Removes the
library topper (same name rule as the station runner: drop meshes carrying
the topper marker, keep brow/lash furniture; assert none remain). Imports
the hull surface with a light clearly-visible hair material (EEVEE, blend
BLEND, alpha 0.6), places the pinned cameras verbatim plus the virtual
mirrored profile camera (matrixWorld mirrored across the x = 0 plane:
R' = F R F, t' = F t, same lens/sensor), renders 512 px frames for
front/profile_90/profile_90_mirror/back/three_quarter, and writes a
6-panel composite (E/hull.png: 5 renders + the target three_quarter image
beside the 3q render; display only, no score) + E/blender-opened.txt.
No fitting.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix

RES = 512
VIEWS = ("front", "profile_90", "profile_90_mirror", "back", "three_quarter")
MIRROR_OF = {"profile_90_mirror": "profile_90"}
HULL_RGBA = (0.85, 0.70, 0.52, 0.60)


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--obj", required=True)
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--glb", required=True)
    parser.add_argument("--cameras", required=True)
    parser.add_argument("--target-3q", required=True)
    parser.add_argument("--opened", required=True)
    parser.add_argument("--stem", default="hull")
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


def add_hull(obj_path):
    before = set(bpy.data.objects)
    try:
        # OBJ holds world metres in Z-up studio coords (x right,
        # y posterior, z up): declare file axes so the importer applies
        # the identity (default Y-up import would tip the hull backwards).
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
    mat = bpy.data.materials.new("HULL_HAIR")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = HULL_RGBA
    bsdf.inputs["Alpha"].default_value = HULL_RGBA[3]
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = "BLENDED"
    if hasattr(mat, "blend_method"):
        mat.blend_method = "BLEND"
    hull.data.materials.append(mat)
    tris = len(hull.data.polygons)
    return hull.name, tris


def mirrored_matrix(rec):
    """Mirror a camera pose across the x = 0 plane (R' = F R F, t' = F t)."""
    F = np.diag([-1.0, 1.0, 1.0])
    mat = np.array(rec["matrixWorld"], dtype=np.float64)
    out = np.eye(4)
    out[:3, :3] = F @ mat[:3, :3] @ F
    out[:3, 3] = F @ mat[:3, 3]
    return Matrix(out.tolist())


def main():
    import json
    args = cli()
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    cams = json.loads(Path(args.cameras).read_text())
    opened = [str(Path(args.obj).resolve()),
              str(Path(args.glb).resolve()),
              str(Path(args.cameras).resolve()),
              str(Path(args.target_3q).resolve())]

    kept, removed = load_body(Path(args.glb))
    hull_name, tris = add_hull(Path(args.obj))

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.eevee.taa_render_samples = 64

    cam_data = bpy.data.cameras.new("HULL_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    camera = bpy.data.objects.new("HULL_cam", cam_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    from PIL import Image, ImageDraw
    panels = []
    for view in VIEWS:
        if view in MIRROR_OF:
            rec = cams["views"][MIRROR_OF[view]]
            cam_data.lens = float(rec["lensMm"])
            camera.matrix_world = mirrored_matrix(rec)
        else:
            rec = cams["views"][view]
            cam_data.lens = float(rec["lensMm"])
            camera.matrix_world = Matrix(rec["matrixWorld"])
        bpy.context.view_layer.update()
        beauty = outdir / ("%s-%s.png" % (args.stem, view))
        bpy.context.scene.render.filepath = str(beauty)
        bpy.ops.render.render(write_still=True)
        img = Image.open(beauty).convert("RGB")
        panel = Image.new("RGB", (RES, RES + 28), (16, 16, 16))
        panel.paste(img, (0, 28))
        ImageDraw.Draw(panel).text((8, 7), view, fill=(255, 255, 255))
        panels.append(panel)
    target = Image.open(args.target_3q).convert("RGB").resize((RES, RES))
    tpanel = Image.new("RGB", (RES, RES + 28), (16, 16, 16))
    tpanel.paste(target, (0, 28))
    ImageDraw.Draw(tpanel).text((8, 7), "target three_quarter (display)",
                                fill=(255, 255, 255))
    panels.append(tpanel)
    frame = Image.new("RGB", (RES * len(panels), RES + 28), (0, 0, 0))
    for i, panel in enumerate(panels):
        frame.paste(panel, (RES * i, 0))
    frame.save(outdir / (args.stem + ".png"))
    Path(args.opened).write_text("\n".join(sorted(set(opened))) + "\n")
    print("REMOVED_TOPPERS %s" % (removed,), flush=True)
    print("HULL_OBJECT %s tris=%d" % (hull_name, tris), flush=True)
    print("HULL_FIGURE %s" % (outdir / (args.stem + ".png")), flush=True)


if __name__ == "__main__":
    main()
