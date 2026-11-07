"""Blender side of the guides render (runs inside Blender only).

Reads: the pinned body GLB, E/guides.npz fitted guide curves, the pinned
camera file. Removes the library topper (same name rule as the station
runner: drop meshes carrying the topper marker, keep brow/lash
furniture; assert none remain). Builds one poly-spline curve per guide
with bevel depth = fitted tube_r, single dark-hair material, places the
pinned cameras verbatim, renders Workbench beauty frames (512 px) for
front/profile_90/back/three_quarter, and writes a 4-panel composite +
blender-opened.txt. No fitting, no network.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix

RES = 512
VIEWS = ("front", "profile_90", "back", "three_quarter")
HAIR_RGBA = (0.09, 0.07, 0.06, 1.0)


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--guides-npz", required=True)
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--glb", required=True)
    parser.add_argument("--cameras", required=True)
    parser.add_argument("--opened", required=True)
    parser.add_argument("--stem", default="guides")
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


def add_guides(guides_npz):
    import json  # noqa: F401
    doc = np.load(str(guides_npz))
    curves = np.array(doc["curves_head"], dtype=np.float64)
    crown = np.array(doc["crown"], dtype=np.float64)
    names = [str(n) for n in doc["param_names"]]
    vals = dict(zip(names, [float(v) for v in doc["param_values"]]))
    tube_r = float(vals["tube_r"]) / 1000.0
    world = np.empty_like(curves)
    world[:, :, 0] = curves[:, :, 0] / 1000.0
    world[:, :, 1] = float(crown[1]) - curves[:, :, 1] / 1000.0
    world[:, :, 2] = float(crown[2]) - curves[:, :, 2] / 1000.0
    mat = bpy.data.materials.new("GUIDE_HAIR")
    mat.use_nodes = False
    mat.diffuse_color = HAIR_RGBA
    made = 0
    for g in range(world.shape[0]):
        cdata = bpy.data.curves.new("GUIDE_%d" % g, type="CURVE")
        cdata.dimensions = "3D"
        cdata.bevel_depth = tube_r
        cdata.bevel_resolution = 1
        spline = cdata.splines.new("POLY")
        pts = world[g]
        spline.points.add(len(pts) - 1)
        for k, pt in enumerate(pts):
            spline.points[k].co = (float(pt[0]), float(pt[1]),
                                   float(pt[2]), 1.0)
        obj = bpy.data.objects.new("GUIDE_%d" % g, cdata)
        bpy.context.scene.collection.objects.link(obj)
        obj.data.materials.append(mat)
        made += 1
    return made, tube_r


def main():
    import json
    args = cli()
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    cams = json.loads(Path(args.cameras).read_text())
    opened = [str(Path(args.guides_npz).resolve()),
              str(Path(args.glb).resolve()),
              str(Path(args.cameras).resolve())]

    kept, removed = load_body(Path(args.glb))
    made, tube_r = add_guides(Path(args.guides_npz))

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.light = "STUDIO"

    cam_data = bpy.data.cameras.new("GUIDE_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    camera = bpy.data.objects.new("GUIDE_cam", cam_data)
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
        panel = Image.new("RGB", (RES, RES + 28), (16, 16, 16))
        panel.paste(img, (0, 28))
        ImageDraw.Draw(panel).text((8, 7), view, fill=(255, 255, 255))
        panels.append(panel)
    frame = Image.new("RGB", (RES * 4, RES + 28), (0, 0, 0))
    for i, panel in enumerate(panels):
        frame.paste(panel, (RES * i, 0))
    frame.save(outdir / (args.stem + ".png"))
    Path(args.opened).write_text("\n".join(sorted(set(opened))) + "\n")
    print("REMOVED_TOPPERS %s" % (removed,), flush=True)
    print("GUIDE_CURVES %d tube_r_m=%.4f" % (made, tube_r), flush=True)
    print("GUIDE_FIGURE %s" % (outdir / (args.stem + ".png")), flush=True)


if __name__ == "__main__":
    main()
