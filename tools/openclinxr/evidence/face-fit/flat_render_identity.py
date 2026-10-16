"""Identity-gate flat render (Blender foreground, card tsk_2c547dda8753bba0 h1).

Appearance-free FACE-framed front render of a shipped bake: every visible
mesh material slot gets one uniform grey Principled BSDF (no skin texture, no
vertex colours), Blender EEVEE (never BLENDER_WORKBENCH), ortho front camera
(res 1024, ortho_scale from --ortho-scale, default 0.55 = cameras.json front),
aimed at the body's head centre like render_fitted_facefit2.py.

h1 framing: hair, brow-card, lash and garment meshes are hidden (hide_render)
so brow landmarks read skin, not hair; only body + eyes + teeth render. Face
framing is set externally: render once, detect the render interocular px,
re-render with --ortho-scale scaled by render/goal until within 10% (goal
interocular from the case target npy, indices 33/263).

Usage:
  blender --background --python tools/openclinxr/evidence/face-fit/flat_render_identity.py \
    -- --glb <shipped.glb> --out <flat-front.png> [--ortho-scale 0.31]
"""

import argparse
import os
import re
import sys

import bpy
from mathutils import Vector

GREY = (0.72, 0.72, 0.72, 1.0)
RES = 1024
ORTHO_SCALE = 0.55

# h1: hide hair, brow-cards, lashes and garments (everything MakeClothes
# except the eyes); body + eyes + teeth render.
HIDE_RES = (
    re.compile(r"hair", re.I),
    re.compile(r"eyebrow|eyelash", re.I),
)


def hide_extra(ob) -> bool:
    name = ob.name
    for rx in HIDE_RES:
        if rx.search(name):
            return True
    low = name.lower()
    if low.startswith("makeclothes_library_") and "eyes" not in low:
        return True
    return False


def parse_argv():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ortho-scale", type=float, default=ORTHO_SCALE)
    return ap.parse_args(argv)


def main():
    args = parse_argv()
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)

    bpy.ops.import_scene.gltf(filepath=args.glb)
    bpy.context.view_layer.update()

    meshes = [ob for ob in bpy.data.objects if ob.type == "MESH"]
    if not meshes:
        raise RuntimeError("flat render refuse: no meshes imported from %s" % args.glb)

    hidden = sorted(ob.name for ob in meshes if hide_extra(ob))
    for ob in meshes:
        if hide_extra(ob):
            ob.hide_render = True
    visible = [ob for ob in meshes if not hide_extra(ob)]
    if not visible:
        raise RuntimeError("flat render refuse: hide pass left no visible mesh")

    flat = bpy.data.materials.new("IdentityFlatGrey")
    flat.use_nodes = True
    bsdf = flat.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        raise RuntimeError("flat render refuse: Principled BSDF absent")
    bsdf.inputs["Base Color"].default_value = GREY
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    for ob in meshes:
        ob.data.materials.clear()
        ob.data.materials.append(flat)

    # Head centre in world space (same recipe as render_fitted_facefit2.py).
    world_cos = []
    for ob in visible:
        mat = ob.matrix_world
        for v in ob.data.vertices:
            world_cos.append(mat @ v.co)
    import numpy as _np

    allv = _np.array([tuple(c) for c in world_cos])
    head = allv[(allv[:, 2] > 1.30) & (_np.abs(allv[:, 0]) < 0.35)]
    if len(head) == 0:
        head = allv
    c = head.mean(axis=0)
    cx, cy, cz = float(c[0]), float(c[1]), float(c[2])

    scene = bpy.context.scene
    scene.render.resolution_x = RES
    scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.engine = "BLENDER_EEVEE"
    try:
        scene.eevee.taa_render_samples = 64
    except Exception:
        pass

    world = bpy.data.worlds.new("IdentityFlatWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.25, 0.25, 0.25, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    scene.world = world

    sun_data = bpy.data.lights.new("IdentitySun", type="SUN")
    sun_data.energy = 3.0
    sun = bpy.data.objects.new("IdentitySun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (0.5, 0.3, 0.0)

    fill_data = bpy.data.lights.new("IdentityFill", type="SUN")
    fill_data.energy = 0.8
    fill = bpy.data.objects.new("IdentityFill", fill_data)
    scene.collection.objects.link(fill)
    fill.rotation_euler = (0.5, -0.6, 0.0)

    cd = bpy.data.cameras.new("identity_front")
    cd.type = "ORTHO"
    cd.ortho_scale = args.ortho_scale
    cam = bpy.data.objects.new("identity_front", cd)
    scene.collection.objects.link(cam)
    cam.location = Vector((cx, cy - 2.0, cz))
    d = Vector((cx, cy, cz)) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    out = args.out
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("IDENTITY_FLAT_RENDERED %s meshes=%d visible=%d hidden=%d ortho=%.4f" % (
        out, len(meshes), len(visible), len(hidden), args.ortho_scale))
    print("IDENTITY_FLAT_HIDDEN %s" % ",".join(hidden))


main()
