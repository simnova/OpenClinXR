#!/usr/bin/env python3
"""G2 EEVEE sheet: front ortho render of the geometric eye (L side; R hidden,
both eyes share the eye-local origin) + side-by-side with the prior look
(iris-centred-c.png L crop). Run: blender --background --python <this file>.
Writes geometric-eye-g2-render.png and geometric-eye-g2-sheet.png (this dir)."""
import os
import math
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
GLB = os.path.join(HERE, "geometric-eye-anterior.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

# glTF Y-up -> Blender Z-up sends the eye-local +z (anterior) to Blender -y.
# (Setting the imported root's rotation has no effect on matrix_world in
#  background mode, so the camera is placed on -y looking +y instead.)
for o in bpy.data.objects:
    if o.name.endswith("_R"):
        o.hide_render = True

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.film_transparent = True

cam_data = bpy.data.cameras.new("GeoEyeCam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 30.0
cam = bpy.data.objects.new("GeoEyeCam", cam_data)
scene.collection.objects.link(cam)
cam.location = (0, -60, 0)
cam.rotation_euler = (math.pi / 2, 0, 0)  # forward -z -> +y (anterior), up stays +z
scene.camera = cam

sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.0
scene.collection.objects.link(sun)
area = bpy.data.objects.new("area", bpy.data.lights.new("area", "AREA"))
area.data.energy = 400.0
area.data.size = 10.0
area.location = (8, -10, 30)
scene.collection.objects.link(area)
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 1.0

scene.render.filepath = os.path.join(HERE, "geometric-eye-g2-render.png")
bpy.ops.render.render(write_still=True)
print("wrote", scene.render.filepath)
