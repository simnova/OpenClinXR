"""Source renders: Aisha (library hair topper excluded, pink shirt) from the
four pinned scorer-v3 cameras at 1024x1024, Cycles, grey studio backdrop,
soft even lighting.

RIG (stated for the record):
  - Engine: CYCLES, 1024x1024, 64 samples, OpenImageDenoise, CPU.
  - Film: transparent OFF; World background solid mid-grey (0.5,0.5,0.5).
  - Backdrop: large plane behind subject (y +2.2 m side), matte light grey
    (0.72,0.72,0.74 roughness 1.0), catches soft shadow.
  - Lights: key Area (front-left, 100 W, size 2 m), fill Area (front-right,
    40 W, size 2 m), rim Area (behind-top, 60 W), plus soft ambient via
    world background. All neutral white (1,1,1).
  - Body: mpfb-peds-parent-aisha.glb, library hairpiece mesh excluded
    (name contains 'hair', keeps brow/lash). Shirt mesh
    (makeclothes_library_toigo_t_shirt) overridden with matte pink
    Principled (0.91, 0.55, 0.64, roughness 0.9) short-sleeve sweater look.
    All other materials kept as imported.
  - Cameras: lensMm / matrixWorld / sensorWidthMm verbatim from the pinned
    cameras-scorer-v3.json for front, three_quarter, profile_90, back.

Usage (background):
  Blender --background --python make_sources.py -- <glb> <cameras.json> <outdir>
"""
import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix

VIEWS = ("front", "three_quarter", "profile_90", "back")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    glb, cams_path, outdir = argv[0], argv[1], Path(argv[2])
    outdir.mkdir(parents=True, exist_ok=True)
    cams = json.loads(Path(cams_path).read_text())

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    imported = [o for o in bpy.data.objects if o not in before]

    removed = []
    for obj in list(imported):
        low = obj.name.lower()
        if obj.type == "MESH" and "hair" in low and "brow" not in low and "lash" not in low:
            removed.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)
    print("REMOVED_TOPPERS %s" % (sorted(removed),), flush=True)

    # Pink shirt override.
    pink = bpy.data.materials.new("AISHA_PINK_SHIRT")
    pink.use_nodes = True
    bsdf = pink.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.91, 0.55, 0.64, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    for obj in bpy.data.objects:
        if obj.type == "MESH" and "toigo_t_shirt" in obj.name.lower():
            obj.data.materials.clear()
            obj.data.materials.append(pink)
            print("PINK_SHIRT %s" % obj.name, flush=True)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True

    world = bpy.data.worlds["World"]
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.5, 0.5, 0.5, 1.0)
    bg.inputs["Strength"].default_value = 1.0

    # Backdrop plane behind subject (+Y side; front camera looks from -Y).
    bpy.ops.mesh.primitive_plane_add(size=12.0, location=(0.0, 2.2, 1.0))
    backdrop = bpy.context.active_object
    backdrop.rotation_euler[0] = 0.0
    bmat = bpy.data.materials.new("AISHA_BACKDROP")
    bmat.use_nodes = True
    bbsdf = bmat.node_tree.nodes["Principled BSDF"]
    bbsdf.inputs["Base Color"].default_value = (0.72, 0.72, 0.74, 1.0)
    bbsdf.inputs["Roughness"].default_value = 1.0
    backdrop.data.materials.append(bmat)

    def area(name, loc, energy, size=2.0):
        bpy.ops.object.light_add(type="AREA", location=loc)
        lamp = bpy.context.active_object
        lamp.name = name
        lamp.data.energy = energy
        lamp.data.size = size
        lamp.data.color = (1.0, 1.0, 1.0)
        return lamp

    area("KEY", (-1.5, -2.0, 2.2), 100.0)
    area("FILL", (1.5, -2.0, 1.8), 40.0)
    area("RIM", (0.0, 2.0, 2.6), 60.0, size=1.5)

    cam_data = bpy.data.cameras.new("AISHA_SRC_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    cam = bpy.data.objects.new("AISHA_SRC_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    for view in VIEWS:
        rec = cams["views"][view]
        cam_data.lens = float(rec["lensMm"])
        cam.matrix_world = Matrix(rec["matrixWorld"])
        bpy.context.view_layer.update()
        scene.render.filepath = str(outdir / ("source-%s.png" % view))
        bpy.ops.render.render(write_still=True)
        print("WROTE %s" % (outdir / ("source-%s.png" % view)), flush=True)


main()
