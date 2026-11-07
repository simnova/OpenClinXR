"""Blender side of the guide-cage default render (runs inside Blender only).

Reads: the pinned body GLB, the default-cage.npz ribbon solids, the pinned
camera file. Removes the library topper (same name rule as the station
runner: drop meshes carrying the topper marker, keep brow/lash furniture;
assert none remain). Builds one mesh per cage family with a distinct colour
per family group, places the pinned cameras verbatim, renders Workbench
beauty frames (512 px) for front/profile_90/back/three_quarter, and writes
a 4-panel composite + blender-opened.txt. No fitting, no network.
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

PALETTE = {
    "part": (0.95, 0.80, 0.20, 1.0),
    "temple": (0.95, 0.35, 0.15, 1.0),
    "side": (0.25, 0.70, 0.35, 1.0),
    "back": (0.20, 0.45, 0.95, 1.0),
    "nape": (0.65, 0.30, 0.80, 1.0),
}


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cage-npz", required=True)
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--glb", required=True)
    parser.add_argument("--cameras", required=True)
    parser.add_argument("--opened", required=True)
    parser.add_argument("--stem", default="default-cage")
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


def add_ribbons(cage_npz):
    doc = np.load(str(cage_npz))
    fams = sorted({k.split("/")[0] for k in doc.files})
    group_of = {"part_L": "part", "part_R": "part",
                "temple_L": "temple", "temple_R": "temple",
                "side_L": "side", "side_R": "side",
                "back": "back", "nape": "nape"}
    made = []
    for fam in fams:
        verts = np.array(doc["%s/verts" % fam], dtype=np.float64)
        faces = np.array(doc["%s/faces" % fam], dtype=np.int64)
        mesh = bpy.data.meshes.new("CAGE_%s" % fam)
        mesh.from_pydata([tuple(v) for v in verts],
                         [], [tuple(f) for f in faces])
        mesh.update()
        obj = bpy.data.objects.new("CAGE_%s" % fam, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.color = PALETTE[group_of[fam]]
        made.append(fam)
    return made


def setup_workbench(meshes):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.display.shading.color_type = "OBJECT"
    scene.display.shading.light = "STUDIO"
    for obj in meshes:
        obj.hide_render = False
        obj.hide_viewport = False


def main():
    import json
    args = cli()
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    cams = json.loads(Path(args.cameras).read_text())
    opened = [str(Path(args.cage_npz).resolve()),
              str(Path(args.glb).resolve()),
              str(Path(args.cameras).resolve())]

    kept, removed = load_body(Path(args.glb))
    made = add_ribbons(Path(args.cage_npz))
    setup_workbench(kept + [bpy.data.objects["CAGE_%s" % f] for f in made])

    cam_data = bpy.data.cameras.new("CAGE_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    camera = bpy.data.objects.new("CAGE_cam", cam_data)
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
    print("CAGE_FAMILIES %s" % (made,), flush=True)
    print("CAGE_FIGURE %s" % (outdir / (args.stem + ".png")), flush=True)


if __name__ == "__main__":
    main()
