# Blender headless: body landmarks for the v2 rubric frames.
#   Blender -b -P body_probe.py -- <body.glb> <out.json>
# Writes the side-view (camera on +x) silhouettes of the shipped body, densified along mesh edges:
#   faceFront: per z bin (0.5 mm), the most forward (min y) body point with |x| < 0.06 m
#   scalpTop:  per y bin (0.5 mm), the highest body point (max z) with z > 1.50 m
#   eyeZ: eye.L/eye.R bone head z
import bpy, sys, json
import numpy as np
glb, out = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
dg = bpy.context.evaluated_depsgraph_get()
body = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('_body')][0]
e = body.evaluated_get(dg); me = e.to_mesh()
V = np.array([tuple(e.matrix_world @ v.co) for v in me.vertices])
E = np.array([tuple(ed.vertices) for ed in me.edges])
t = np.linspace(0, 1, 12)[:, None, None]
P = (V[E[:, 0]][None] * (1 - t) + V[E[:, 1]][None] * t).reshape(-1, 3)
rig = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
eyes = [tuple(rig.matrix_world @ b.head) for b in rig.pose.bones if b.name in ('eye.L', 'eye.R')]
F = P[(np.abs(P[:, 0]) < 0.06) & (P[:, 2] > 1.40) & (P[:, 2] < 1.68)]
zb = np.round(np.arange(1.40, 1.68, 0.0005), 4)
iz = np.floor((F[:, 2] - 1.40) / 0.0005).astype(int)
face = [[float(zb[i]), float(F[iz == i, 1].min())] for i in range(len(zb)) if (iz == i).any()]
S = P[P[:, 2] > 1.50]
yb = np.round(np.arange(-0.16, 0.12, 0.0005), 4)
iy = np.floor((S[:, 1] + 0.16) / 0.0005).astype(int)
scalp = [[float(yb[i]), float(S[iy == i, 2].max())] for i in range(len(yb)) if (iy == i).any()]
json.dump(dict(body=glb, eyeZ=float(np.mean([p[2] for p in eyes])), faceFront_z_minY=face, scalpTop_y_maxZ=scalp),
          open(out, 'w'))
print('BODY_PROBE', out, len(face), len(scalp))
