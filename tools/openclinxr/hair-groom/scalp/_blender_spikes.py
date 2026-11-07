"""STEP 6a (Blender): 5mm root spikes on Aisha, library hair excluded.

Reads (read-only): body GLB, E/roots.npz, manifest + pinned cameras.
Spike i: 4-sided cone, base radius 0.35mm at root + n*0.2mm, tip at root +
n*5.0mm along the stored face normal; single mesh, single distinct (red)
material; no strands. Library hair hidden + asserted excluded.
Renders 512px front / three_quarter / profile_90 / crown_top with the pinned
cameras. Writes: E/spike_<view>.png.
Usage: Blender --background --python _blender_spikes.py -- <outdir-E>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

S2 = Path(__file__).resolve().parent
sys.path.insert(0, str(S2))
import common as C

E = Path(sys.argv[sys.argv.index("--") + 1])
RES = 512


def main():
    doc, _ = C.load_manifest()
    cams, _ = C.load_cameras(doc)
    C.log_open(E / "roots.npz")
    R = np.load(E / "roots.npz")
    P, N = R["xyz"], R["normal"]
    n = len(P)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(C.ROOT / doc["body"]["glb"]))
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    hair_objs = [o for o in meshes if "hair" in o.name.lower()]
    if not hair_objs:
        raise RuntimeError("ASSERT FAIL: no library hair object found to exclude")
    for o in hair_objs:
        o.hide_render = True
        o.hide_viewport = True
    if [o.name for o in meshes if "hair" in o.name.lower() and not o.hide_render]:
        raise RuntimeError("ASSERT FAIL: hair object still visible")

    # spike cones (base quad + tip), one merged mesh
    verts = []
    tris = []
    for i in range(n):
        p = Vector(P[i])
        nv = Vector(N[i]).normalized()
        # tangent frame
        up = Vector((0.0, 0.0, 1.0)) if abs(nv.z) < 0.9 else Vector((1.0, 0.0, 0.0))
        t1 = (nv.cross(up)).normalized()
        t2 = (nv.cross(t1)).normalized()
        b = p + nv * 0.0002
        rad = 0.00035
        base = [b + (t1 * np.cos(a) + t2 * np.sin(a)) * rad for a in (0.0, np.pi / 2, np.pi, 3 * np.pi / 2)]
        tip = p + nv * 0.005
        k = len(verts)
        verts += [[v.x, v.y, v.z] for v in base] + [[tip.x, tip.y, tip.z]]
        for e in range(4):
            tris.append([k + e, k + (e + 1) % 4, k + 4])
    me = bpy.data.meshes.new("S2_spikes")
    me.from_pydata(verts, [], tris)
    me.update()
    ob = bpy.data.objects.new("S2_spikes", me)
    bpy.context.scene.collection.objects.link(ob)
    mat = bpy.data.materials.new("S2_spike_red")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1.0, 0.02, 0.06, 1.0)
    em.inputs["Strength"].default_value = 1.0
    mat.node_tree.links.new(em.outputs["Emission"], out.inputs["Surface"])
    # Workbench MATERIAL shading shows the viewport display color, not nodes
    mat.diffuse_color = (1.0, 0.02, 0.06, 1.0)
    me.materials.append(mat)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = scene.render.resolution_y = RES
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.light = "STUDIO"
    cam_data = bpy.data.cameras.new("S2SPIKE_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    camera = bpy.data.objects.new("S2SPIKE_cam", cam_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    for view in ("front", "three_quarter", "profile_90", "crown_top"):
        rec = cams["views"][view]
        cam_data.lens = float(rec["lensMm"])
        camera.matrix_world = Matrix(rec["matrixWorld"])
        bpy.context.view_layer.update()
        scene.render.filepath = str(E / ("spike_%s.png" % view))
        bpy.ops.render.render(write_still=True)
    C.write_opened(E / "inputs-opened.txt")
    print("SPIKES_DONE n=%d views=4" % n)


main()
