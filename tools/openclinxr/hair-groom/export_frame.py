"""Blender side of the station: body load, scorer-frame cameras, projections.

Runs inside Blender background mode; invoked by run.py, never imported.
Reads: this script, the pinned body GLB. Writes: station-frame.npz,
Workbench beauty renders (512 px), blender-opened.json.

Body loading below copies the minimum of the repo's shared comparison
scene loader (import the pinned GLB, keep the largest mesh as the head /
surface object, target = (bbox centre x, 0.0, crown z - 0.12)). The loader
itself is NOT imported.

Camera placement uses ONLY the pinned scorer camera file (lensMm, location,
matrixWorld verbatim per view; sensor width from the same file). There is no
aim-point rule and no per-view tracking: the camera matrix is assigned
directly, so station renders sit in the scorer frame by construction. Full
provenance of the pinned constants lives in the station evidence record
(this directory is banned from naming the scorer file or any look-card
evidence path).

Anatomy rules (reimplemented, scene-relative, deterministic):
  crown       bare-head vertex with max world z (lowest index wins ties)
  menton      anterior midline vertex nearest z = crown - 0.2106
              (|x - cx| <= 2 mm, y < 0, z > crown - 0.35)
  brow        |x - cx| <= 2 mm, y < 0 vertex nearest z = crown - 0.0882
  face_centre (0, menton y, menton z)
  shoulder    (0, 0, crown - 0.2549) plane point
Render triple per view at FRAME px: front (crown, menton, face_centre col),
profile_90 (crown, menton, brow col), back (crown, shoulder, face_centre col).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

FRAME = 1024
RES = 512

PALETTE = (
    (0.85, 0.55, 0.45, 1.0),
    (0.20, 0.45, 0.85, 1.0),
    (0.25, 0.70, 0.35, 1.0),
    (0.90, 0.80, 0.25, 1.0),
    (0.70, 0.30, 0.75, 1.0),
    (0.30, 0.80, 0.80, 1.0),
    (0.90, 0.45, 0.20, 1.0),
    (0.55, 0.55, 0.60, 1.0),
)


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--glb", required=True)
    parser.add_argument("--cameras", required=True)
    parser.add_argument("--opened", required=True)
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


def exclude_library_topper(meshes):
    """Remove library hairpiece meshes from the station scene (station0b).

    Keeps brow/lash face furniture: any mesh whose name carries "brow"
    or "lash" is retained. Returns (kept, removed_names) and asserts no
    remaining mesh name still carries the hairpiece marker.
    """
    removed = []
    kept = []
    for obj in meshes:
        lowered = obj.name.lower()
        if "hair" in lowered and "brow" not in lowered and "lash" not in lowered:
            removed.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)
        else:
            kept.append(obj)
    remaining = [obj.name for obj in kept if "hair" in obj.name.lower()]
    if remaining:
        raise RuntimeError("hairpiece exclusion incomplete: %r" % (remaining,))
    return kept, sorted(removed)


def anatomy(head):
    world = [head.matrix_world @ vertex.co for vertex in head.data.vertices]
    xs = [p.x for p in world]
    crown = max(range(len(world)), key=lambda i: (world[i].z, -i))
    crown_z = float(world[crown].z)
    cx = (min(xs) + max(xs)) * 0.5
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
    want = crown_z - 0.0882
    brow = min(
        (i for i, p in enumerate(world) if abs(p.x - cx) <= 0.002 and p.y < 0.0),
        key=lambda i: (abs(world[i].z - want), i),
    )
    m = world[menton]
    points = {
        "crown": Vector(world[crown]),
        "menton": Vector(m),
        "brow": Vector(world[brow]),
        "face_centre": Vector((0.0, m.y, m.z)),
        "shoulder": Vector((0.0, 0.0, crown_z - 0.2549)),
    }
    target = Vector((float(cx), 0.0, crown_z - 0.12))
    return points, target, crown_z, float(cx)


def setup_workbench(meshes):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.display.shading.color_type = "OBJECT"
    scene.display.shading.light = "STUDIO"
    for index, obj in enumerate(meshes):
        obj.color = PALETTE[index % len(PALETTE)]
        obj.hide_render = False
        obj.hide_viewport = False


def project(scene, camera, points):
    out = {}
    for name, co in points.items():
        ndc = world_to_camera_view(scene, camera, co)
        out[name] = {
            "col": float(ndc.x * FRAME),
            "row": float((1.0 - ndc.y) * FRAME),
            "depth": float(ndc.z),
        }
    return out


def main():
    args = cli()
    manifest = json.loads(Path(args.manifest).read_text())
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    cams = json.loads(Path(args.cameras).read_text())
    cams_sha = hashlib.sha256(Path(args.cameras).read_bytes()).hexdigest()
    opened = [str(Path(__file__).resolve()), str(Path(args.glb).resolve()),
              str(Path(args.cameras).resolve())]

    head, meshes = load_body(Path(args.glb))
    meshes, removed_toppers = exclude_library_topper(meshes)
    points, target, crown_z, cx = anatomy(head)
    setup_workbench(meshes)

    cam_data = bpy.data.cameras.new("STATION_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    camera = bpy.data.objects.new("STATION_cam", cam_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    payload = {
        "frame": np.int64(FRAME),
        "render_res": np.int64(RES),
        "sensor_width_mm": np.float64(cam_data.sensor_width),
        "camerasFileSha256": np.array(cams_sha),
        "seed": np.int64(manifest["seed"]),
        "target": np.array([target.x, target.y, target.z], dtype=np.float64),
        "crown_z": np.float64(crown_z),
        "bbox_cx": np.float64(cx),
        "removed_toppers": np.array(sorted(removed_toppers)),
    }
    projected_all = {}
    order = list(manifest["cameras"])
    for view in order:
        rec = cams["views"][view]
        cam_data.lens = float(rec["lensMm"])
        camera.matrix_world = Matrix(rec["matrixWorld"])
        bpy.context.view_layer.update()
        payload["%s/location" % view] = np.array(
            [float(v) for v in camera.location], dtype=np.float64)
        payload["%s/matrix_world" % view] = np.array(
            [[float(v) for v in row] for row in camera.matrix_world], dtype=np.float64
        )
        payload["%s/lens_mm" % view] = np.float64(camera.data.lens)
        beauty = outdir / ("%s.png" % view)
        bpy.context.scene.render.filepath = str(beauty)
        bpy.ops.render.render(write_still=True)
        payload["%s/render_png" % view] = np.array(str(beauty.name))
        projected_all[view] = project(bpy.context.scene, camera, points)

    for view in order:
        for name in ("crown", "menton", "brow", "face_centre", "shoulder"):
            rec = projected_all[view][name]
            payload["%s/%s_row" % (view, name)] = np.float64(rec["row"])
            payload["%s/%s_col" % (view, name)] = np.float64(rec["col"])
    for name, co in points.items():
        payload["point3d/%s" % name] = np.array([co.x, co.y, co.z], dtype=np.float64)

    frame_path = outdir / "station-frame.npz"
    np.savez(str(frame_path), **dict(sorted(payload.items())))
    (outdir / "projected.json").write_text(
        json.dumps(projected_all, indent=2, sort_keys=True) + "\n"
    )
    Path(args.opened).write_text("\n".join(sorted(set(opened))) + "\n")
    print("REMOVED_TOPPERS %s" % (sorted(removed_toppers),), flush=True)
    print("STATION_FRAME", str(frame_path), flush=True)


if __name__ == "__main__":
    main()
