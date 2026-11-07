"""groom38 face-front landmark probe: outer eye corners + jaw line from body GLB.

Blender --background --python faceprobe38.py -- GLB OUTJSON
Finds eye meshes, takes outer-corner verts (max |x| per eye), reports
their y (face plane) and z; jaw line = min z of body verts in the
front-face band (|x| < 25mm, eye_y - 60mm <= y <= eye_y + 5mm).
All units metres (hair space). No render.
"""
import json
import sys

import bpy
import numpy as np


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    glb, out = argv[0], argv[1]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    eyes = [o for o in bpy.data.objects
            if "lash" in o.name.lower() and o.type == "MESH"]
    corners = {}
    for o in eyes:
        w = np.asarray([list(o.matrix_world @ v.co) for v in o.data.vertices])
        for side, sel in (("xpos", w[:, 0] > 0), ("xneg", w[:, 0] < 0)):
            if not sel.any():
                continue
            ws = w[sel]
            i = int(np.argmax(np.abs(ws[:, 0])))
            if side not in corners or abs(ws[i, 0]) > abs(
                    corners[side]["x"]):
                corners[side] = {"x": float(ws[i, 0]),
                                 "y": float(ws[i, 1]),
                                 "z": float(ws[i, 2]), "obj": o.name}
    bodies = [o for o in bpy.data.objects
              if o.type == "MESH" and "body" in o.name.lower()]
    body = max(bodies, key=lambda o: len(o.data.vertices))
    bw = np.asarray([list(body.matrix_world @ v.co)
                     for v in body.data.vertices])
    eyey = float(np.mean([c["y"] for c in corners.values()]))
    # jaw line: chin underside from the body midline profile (|x|<10mm):
    # first 5mm z-slice going up whose most-anterior vert passes -0.10
    # (neck front ~-0.09 -> chin front ~-0.135; measured 2026-10-19:
    #  z=1.440 ymin=-0.091, z=1.445 ymin=-0.135). jawZ = slice bottom.
    col = bw[np.abs(bw[:, 0]) < 0.010]
    jawZ = None
    z = 1.38
    while z < 1.50:
        sel = col[(col[:, 2] >= z) & (col[:, 2] < z + 0.005)]
        if len(sel) and float(sel[:, 1].min()) < -0.10:
            jawZ = round(z, 3)
            break
        z += 0.005
    out_d = {"corners": corners, "facePlaneY": eyey,
             "jawZ": jawZ,
             "body": body.name,
             "eyeYmean": eyey}
    with open(out, "w") as f:
        json.dump(out_d, f, indent=1)
    print(json.dumps(out_d, indent=1))


main()
