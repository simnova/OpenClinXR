"""facefit2 check-render (Blender, foreground only).

Applies fit_file_weights.json via TargetService (shape-key truth, the same
deltas the fit used) and renders the fitted mesh with the base-front.png
pipeline (Workbench, ortho 0.55, 1024). The render is the CHECK, never the
objective (CW): score_render.py re-detects and compares against the analytic
fit within detector noise.

Run foreground:
  Blender --background --python \
    tools/openclinxr/evidence/face-fit/render_fitted_facefit2.py
"""

import json
import os

import bpy
import numpy as np
from mathutils import Vector

OUT = "/Users/patrick/.grok/worktrees/src-openclinxr/facefit2/tools/openclinxr/evidence/face-fit"
MPFB_218 = "/Users/patrick/Library/Application Support/Blender/5.2/extensions/user_default/mpfb/data/targets"
MPFB_51 = "/Users/patrick/Library/Application Support/Blender/5.1/extensions/user_default/mpfb/data/targets"
RES = 1024
ORTHO_SCALE = 0.55


def target_path(sub, stem):
    for base in (MPFB_218 if sub in ("asym", "macrodetails") else MPFB_51,):
        for ext in (".target.gz", ".target"):
            p = os.path.join(base, sub, stem + ext)
            if os.path.isfile(p):
                return p
    # base face targets also exist under 5.2 data; fall back there
    for ext in (".target.gz", ".target"):
        p = os.path.join(MPFB_218, sub, stem + ext)
        if os.path.isfile(p):
            return p
    raise RuntimeError("missing target file: %s/%s" % (sub, stem))


def main():
    fw = json.load(open(os.path.join(OUT, "fit_file_weights.json")))
    file_weights = fw["fileWeights"]
    sub_of = fw["subOf"]
    nz = {s: v for s, v in file_weights.items() if v > 1e-9}
    print("FF2_RENDER nonzero files=%d" % len(nz))

    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService

    human = HumanService.create_human(feet_on_ground=True)
    bpy.context.view_layer.update()

    for stem in sorted(nz):
        sub = sub_of[stem]
        path = target_path(sub, stem)
        name = TargetService.filename_to_shapekey_name(os.path.basename(path), encode_name=False)
        TargetService.load_target(human, str(path), weight=float(nz[stem]), name=name)
    bpy.context.view_layer.update()
    print("FF2_RENDER applied=%d" % len(nz))

    base = np.array([tuple(v.co) for v in human.data.vertices], dtype=np.float64)
    head = base[(base[:, 2] > 1.30) & (np.abs(base[:, 0]) < 0.35)]
    c = head.mean(axis=0)
    cx, cy, cz = float(c[0]), float(c[1]), float(c[2])

    for ob in list(bpy.data.objects):
        if ob != human:
            bpy.data.objects.remove(ob, do_unlink=True)
    scene = bpy.context.scene
    scene.render.resolution_x = RES
    scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "OBJECT"
    try:
        scene.display.shading.background_type = "WORLD"
    except Exception:
        pass
    world = bpy.data.worlds.new("FaceFit2Gray")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.5, 0.5, 0.5, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    scene.world = world
    try:
        human.color = (0.72, 0.72, 0.72, 1.0)
    except Exception:
        pass

    cd = bpy.data.cameras.new("ff2_front")
    cd.type = "ORTHO"
    cd.ortho_scale = ORTHO_SCALE
    ob = bpy.data.objects.new("ff2_front", cd)
    scene.collection.objects.link(ob)
    ob.location = Vector((cx, cy - 2.0, cz))
    d = Vector((cx, cy, cz)) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.camera = ob
    scene.render.filepath = os.path.join(OUT, "fitted-front.png")
    bpy.ops.render.render(write_still=True)
    print("FF2_RENDERED fitted-front.png")


main()
