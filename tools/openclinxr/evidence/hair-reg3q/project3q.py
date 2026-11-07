"""One-off 3/4 projection probe (evidence script, NOT station code).

Loads the pinned MPFB Aisha GLB, places the pinned scorer three_quarter
camera verbatim (lensMm, matrixWorld, sensorWidthMm from the pinned
cameras file), renders a 512px Workbench beauty, and projects the
anatomy points used for the 3/4 registration pairs into the 1024px
scorer frame.

Anatomy reuses the station rules verbatim for crown / menton / brow /
face_centre / shoulder (midline bands, crown-relative offsets), plus:
  nose_tip   most-anterior (min y) vertex, |x-cx|<=3mm,
             z in [crown-0.21, crown-0.05]
  philtrum   most-anterior vertex, |x-cx|<=3mm,
             z in [menton_z+0.008, nose_z-0.004]
             (falls back to midline vertex nearest (menton+nose)/2)
  acromion_L most-lateral (max x) vertex, z in [crown-0.30, crown-0.20]
             (camera side is +x for the three_quarter camera)

Usage (background Blender):
  Blender --background --python project3q.py -- \
    --glb <aisha.glb> --cameras <cameras-scorer-v3.json> --outdir <E dir>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

FRAME = 1024
RES = 512
VIEW = "three_quarter"


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", required=True)
    parser.add_argument("--cameras", required=True)
    parser.add_argument("--outdir", required=True)
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
    head = max(meshes, key=lambda obj: len(obj.data.vertices))
    return head, sorted(meshes, key=lambda obj: obj.name)


def anatomy(head):
    world = [head.matrix_world @ v.co for v in head.data.vertices]
    xs = [p.x for p in world]
    crown = max(range(len(world)), key=lambda i: (world[i].z, -i))
    crown_z = float(world[crown].z)
    cx = (min(xs) + max(xs)) * 0.5

    def band(zlo, zhi, xhalf=0.003):
        return [i for i, p in enumerate(world)
                if abs(p.x - cx) <= xhalf and p.y < 0.0
                and zlo <= p.z <= zhi]

    menton = None
    want_chin = crown_z - 0.2106
    for i, p in enumerate(world):
        if abs(p.x - cx) <= 0.002 and p.y < 0.0 and p.z > crown_z - 0.35:
            key = (abs(p.z - want_chin), i)
            if menton is None or key < menton[0]:
                menton = (key, i)
    if menton is None:
        raise RuntimeError("no menton candidate in anterior midline band")
    menton = menton[1]
    m = world[menton]

    want = crown_z - 0.0882
    brow = min(
        (i for i, p in enumerate(world) if abs(p.x - cx) <= 0.002 and p.y < 0.0),
        key=lambda i: (abs(world[i].z - want), i),
    )

    nose_cands = band(crown_z - 0.21, crown_z - 0.05)
    if not nose_cands:
        raise RuntimeError("no nose-tip candidate in midline band")
    nose = min(nose_cands, key=lambda i: (world[i].y, i))

    philtrum_method = "midline vertex nearest nose_z-16mm (upper-lip centre)"
    want_ph = float(world[nose].z) - 0.016
    philtrum = min(
        (i for i, p in enumerate(world)
         if abs(p.x - cx) <= 0.003 and p.y < 0.0),
        key=lambda i: (abs(world[i].z - want_ph), i),
    )
    ph_method = "nearest nose_z-16mm"

    acro_cands = [i for i, p in enumerate(world)
                  if crown_z - 0.30 <= p.z <= crown_z - 0.20]
    if not acro_cands:
        raise RuntimeError("no acromion candidate in shoulder slab")
    acromion = max(acro_cands, key=lambda i: (world[i].x, -i))

    points = {
        "crown": Vector(world[crown]),
        "menton": Vector(m),
        "brow": Vector(world[brow]),
        "face_centre": Vector((0.0, m.y, m.z)),
        "shoulder": Vector((0.0, 0.0, crown_z - 0.2549)),
        "nose_tip": Vector(world[nose]),
        "philtrum": Vector(world[philtrum]),
        "acromion_L": Vector(world[acromion]),
    }
    meta = {
        "crown_z": crown_z,
        "bbox_cx": float(cx),
        "nose_band": [crown_z - 0.21, crown_z - 0.05],
        "philtrum_method": ph_method,
        "acromion_slab": [crown_z - 0.30, crown_z - 0.20],
    }
    return points, meta


def main():
    args = cli()
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    cams = json.loads(Path(args.cameras).read_text())

    head, meshes = load_body(Path(args.glb))
    points, meta = anatomy(head)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False

    cam_data = bpy.data.cameras.new("REG3Q_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    camera = bpy.data.objects.new("REG3Q_cam", cam_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    rec = cams["views"][VIEW]
    cam_data.lens = float(rec["lensMm"])
    camera.matrix_world = Matrix(rec["matrixWorld"])
    bpy.context.view_layer.update()

    beauty = outdir / "render-3q-beauty.png"
    scene.render.filepath = str(beauty)
    bpy.ops.render.render(write_still=True)

    proj = {}
    for name, co in points.items():
        ndc = world_to_camera_view(scene, camera, co)
        proj[name] = {
            "col": float(ndc.x * FRAME),
            "row": float((1.0 - ndc.y) * FRAME),
            "depth": float(ndc.z),
        }
    (outdir / "projected-3q.json").write_text(
        json.dumps({"view": VIEW, "points": proj, "meta": meta,
                    "point3d": {k: [float(v.x), float(v.y), float(v.z)]
                                for k, v in points.items()}},
                   indent=2, sort_keys=True) + "\n"
    )
    print("REG3Q_PROJECTED", json.dumps(proj, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
