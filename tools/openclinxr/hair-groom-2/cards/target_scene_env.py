"""Target-scene environment: equirect panorama of the Imagine target scene seen from the head centre.

Builds the scene by running tools/openclinxr/evidence/hair-target2/make_sources.py unchanged (it also
writes its four source renders, to <out dir>/sources), deletes the body, makes the three Area lights camera-visible, and renders a Cycles
equirectangular panorama to a float EXR. hair-groom-2 DESIGN-realism.md P1.

Usage (background):
  Blender --background --python target_scene_env.py -- <glb> <cameras.json> <out.exr> [cx cy cz] [width]
Head centre (cx, cy, cz) is in Blender world coordinates (Z up, front camera on -Y); default (0, 0, 1.52).
"""
import math
import runpy
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve()
MAKE_SOURCES = HERE.parents[2] / "evidence/hair-target2/make_sources.py"


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    glb, cams, out = argv[0], argv[1], Path(argv[2])
    centre = tuple(float(x) for x in argv[3:6]) if len(argv) >= 6 else (0.0, 0.0, 1.52)
    width = int(argv[6]) if len(argv) >= 7 else 1024

    sys.argv = [sys.argv[0], "--", glb, cams, str(out.parent / "sources")]
    runpy.run_path(str(MAKE_SOURCES), run_name="__main__")

    scene = bpy.context.scene
    lights = [o for o in bpy.data.objects if o.type == "LIGHT"]
    names = sorted(o.name for o in lights)
    if names != ["FILL", "KEY", "RIM"]:
        raise SystemExit("target scene lights unexpected: %s" % names)
    for o in list(bpy.data.objects):
        if o.type not in ("LIGHT", "CAMERA") and o.name != "Plane":
            bpy.data.objects.remove(o, do_unlink=True)
    for o in lights:
        o.visible_camera = True
        o.rotation_mode = "XYZ"

    cam_data = bpy.data.cameras.new("ENV_cam")
    cam_data.type = "PANO"
    cam_data.panorama_type = "EQUIRECTANGULAR"
    cam = bpy.data.objects.new("ENV_cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = centre
    # Camera looks along +Y (into the scene from the front camera's side), Z up.
    cam.rotation_euler = (math.pi / 2, 0.0, math.pi)
    scene.camera = cam

    scene.render.resolution_x = width
    scene.render.resolution_y = width // 2
    scene.cycles.samples = 256
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    scene.view_settings.view_transform = "Standard"
    scene.render.filepath = str(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print("ENV_WROTE %s centre=%s lights=%s remaining=%s" % (
        out, centre, names, sorted(o.name for o in bpy.data.objects)), flush=True)


main()
