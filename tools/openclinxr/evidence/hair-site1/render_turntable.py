"""Hair-site1 STEP 3: groom3 turntable under the studio rig (read-only rig).

Full 360 deg orbit at the front-camera radius/height, 50 mm lens,
720 px, Cycles low-spp + OIDN. Writes PNG frames; ffmpeg encodes mp4.
Usage (run from repo root):
  HAIR_SPP=10 Blender --background --python <this> -- --strands ... \
    --params ... --cameras ... --body-glb ... --outdir ... --opened ... \
    --frames 168
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render_before import (  # noqa: E402
    build_strand_hair, load_body, setup_cycles, setup_studio)

SIZE = 720
SPP = int(os.environ.get("HAIR_SPP", "10"))
SEED = 7
FPS = 24
RADIUS = 0.7
CAM_Z = 1.494
TARGET = Vector((0.0, 0.0, 1.45))


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--strands", required=True)
    p.add_argument("--params", required=True)
    p.add_argument("--cameras", required=True)
    p.add_argument("--body-glb", required=True)
    p.add_argument("--outdir", required=True)
    p.add_argument("--opened", required=True)
    p.add_argument("--frames", type=int, default=168)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


def look_at(loc, target):
    z = (loc - target).normalized()
    x = Vector((0.0, 0.0, 1.0)).cross(z).normalized()
    y = z.cross(x).normalized()
    mat = Matrix.Identity(4)
    mat[0][0:3] = x
    mat[1][0:3] = y
    mat[2][0:3] = z
    mat.col[3][0:3] = loc
    return mat


def main():
    t_all = time.time()
    args = cli()
    opened = [str(Path(__file__).resolve())]
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    cams = json.loads(Path(args.cameras).read_text())
    opened.append(str(Path(args.cameras).resolve()))
    params = json.loads(Path(args.params).read_text())
    opened.append(str(Path(args.params).resolve()))
    color = params["params"] if "params" in params else params

    main_body, vis, small_names = load_body(Path(args.body_glb), opened)
    small_objs = [bpy.data.objects[n] for n in small_names]
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        o.hide_render = False
        o.is_holdout = False

    doc = np.load(args.strands, allow_pickle=True)
    opened.append(str(Path(args.strands).resolve()))
    hair, mat_rec = build_strand_hair(
        np.asarray(doc["points"], dtype=np.float64),
        np.asarray(doc["radii"], dtype=np.float64), color)

    setup_studio()
    setup_cycles()
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = SIZE
    sc.cycles.samples = SPP
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.film_transparent = False

    cam_data = bpy.data.cameras.new("TURN_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    cam_data.lens = 50.0
    cam = bpy.data.objects.new("TURN_cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    bpy.ops.object.empty_add(location=(TARGET.x, TARGET.y, TARGET.z))
    anchor = bpy.context.active_object
    anchor.name = "TURN_anchor"
    trk = cam.constraints.new("TRACK_TO")
    trk.target = anchor
    trk.track_axis = "TRACK_NEGATIVE_Z"
    trk.up_axis = "UP_Y"
    bpy.context.view_layer.update()

    n = args.frames
    for i in range(n):
        out = outdir / ("f%04d.png" % i)
        if out.exists():
            print("SKIP %d/%d (exists)" % (i + 1, n), flush=True)
            continue
        th = 2.0 * math.pi * i / n
        cam.location = (RADIUS * math.sin(th),
                        -RADIUS * math.cos(th), CAM_Z)
        bpy.context.view_layer.update()
        sc.render.filepath = str(outdir / ("f%04d.png" % i))
        bpy.ops.render.render(write_still=True)
        print("FRAME %d/%d" % (i + 1, n), flush=True)

    Path(args.opened).write_text("\n".join(sorted(set(opened))) + "\n")
    print("TURNTABLE_DONE frames=%d total=%.1fs" % (n, time.time() - t_all),
          flush=True)


if __name__ == "__main__":
    main()
