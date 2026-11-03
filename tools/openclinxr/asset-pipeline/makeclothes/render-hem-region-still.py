#!/usr/bin/env python3
"""st-hemfin: render hem-region before/after stills for a shipped GLB.

Frames the camera on the lowest band of the named garment mesh (the hem),
using an identical camera for the before/after pair when --ref-glb names
the framing source. WORKBENCH studio stills at full resolution; no
hand-authored geometry, no scene edits to the asset.

Run (repo station script; Blender via this file only):
  blender --background --python \\
    tools/openclinxr/asset-pipeline/makeclothes/render-hem-region-still.py -- \\
    --shots /path/to/shots.json

shots.json: [{"name": "<out basename>", "glb": "<target>", "garment": "<mesh>",
              "ref": "<framing source glb>", "out": "<png path>",
              "side": 1.0}, ...]
side +1.0 puts the camera on +Y (MPFB front); -1.0 on -Y (Anny front).
"""

import argparse
import json
import math
import pathlib
import sys

import bpy
import mathutils


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--shots", required=True)
    p.add_argument("--width", type=int, default=1920)
    p.add_argument("--height", type=int, default=1080)
    return p.parse_args(argv)


def garment_hem_frame(garment_obj):
    mesh = garment_obj.data
    mat = garment_obj.matrix_world
    worlds = [mat @ v.co for v in mesh.vertices]
    zs = [c.z for c in worlds]
    lo, hi = min(zs), max(zs)
    band = [c for c in worlds if c.z <= lo + 0.06 * (hi - lo)]
    cx = sum(c.x for c in band) / len(band)
    cy = sum(c.y for c in band) / len(band)
    cz = sum(c.z for c in band) / len(band)
    extent = max(
        max(c.x for c in band) - min(c.x for c in band),
        max(c.z for c in band) - min(c.z for c in band),
        0.05,
    )
    return (cx, cy, cz), extent


def framing_from(ref_glb, garment_name):
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=ref_glb)
    garment = None
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.data.name == garment_name:
            garment = obj
            break
    if garment is None:
        raise RuntimeError(f"garment mesh {garment_name} not in {ref_glb}")
    return garment_hem_frame(garment)


def render_shot(shot, width, height):
    # Identical camera for before/after: frame the hem band from the front
    # (MPFB faces +Y), target slightly above the band mean, distance from
    # the band extent so the hem region fills the frame either way.
    (cx, cy, cz), extent = framing_from(shot["ref"], shot["garment"])
    dist = max(extent * 2.6, 0.55)
    side = float(shot.get("side", 1.0))

    # Load the render target into a fresh scene, then build the camera.
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=shot["glb"])
    cam_data = bpy.data.cameras.new("HemCam")
    cam_data.lens = 50.0
    cam_obj = bpy.data.objects.new("HemCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    cam_obj.location = (cx, cy + side * dist, cz + 0.38 * dist)
    loc = cam_obj.location
    direction = mathutils.Vector((cx - loc[0],
                                  cy - loc[1],
                                  (cz + 0.04) - loc[2]))
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    sun_data = bpy.data.lights.new("HemSun", type="SUN")
    sun_data.energy = 3.0
    sun_obj = bpy.data.objects.new("HemSun", sun_data)
    bpy.context.scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (math.radians(35), 0, math.radians(-30))

    scene = bpy.context.scene
    scene.camera = cam_obj
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.filepath = shot["out"]
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print(f"STILL {shot['name']} hem_z={cz:.3f} extent={extent:.3f} -> {shot['out']}")


def main():
    args = parse_args()
    shots = json.loads(pathlib.Path(args.shots).read_text())
    for shot in shots:
        render_shot(shot, args.width, args.height)


if __name__ == "__main__":
    main()
