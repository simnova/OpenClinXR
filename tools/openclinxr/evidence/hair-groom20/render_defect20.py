"""Blender/EEVEE isolated A/B/C renders for the four groom10diag boxes.

A = faired guides active in the box (cyan 0.40mm tubes).
B = raw station interpolation (magenta).
C = final children (white-grey).
Same scorer-v3 cameras; 1024px with border crop per box.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--evidence", required=True)
    p.add_argument("--cameras", required=True)
    p.add_argument("--body", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


BOXES = {
    "back-knot": ("back", [150, 420, 512, 765]),
    "behind-ear-loops": ("profile_90", [270, 550, 250, 530]),
    "sideburn-tuft": ("three_quarter", [330, 610, 380, 660]),
    "hairline-band": ("front", [98, 196, 291, 733]),
}


def mat(name, color):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.7
    return m


def hair_obj(name, points, radii, material):
    points = np.asarray(points, dtype=np.float32)
    radii = np.asarray(radii, dtype=np.float32)
    n, P, _ = points.shape
    data = bpy.data.hair_curves.new(name + "_data")
    data.add_curves([P] * n)
    data.attributes["position"].data.foreach_set("vector", points.ravel())
    if "radius" in data.attributes:
        data.attributes["radius"].data.foreach_set("value", radii.ravel())
    else:
        a = data.attributes.new("radius", "FLOAT", "POINT")
        a.data.foreach_set("value", radii.ravel())
    data.materials.append(material)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def clear_curves():
    for obj in list(bpy.data.objects):
        if obj.type == "CURVES":
            bpy.data.objects.remove(obj, do_unlink=True)


def main():
    a = cli()
    E = Path(a.evidence)
    cams = json.loads(Path(a.cameras).read_text())
    sys.path.insert(0, str(Path(a.evidence).parents[1] / "hair-groom/strands"))
    import frames as F
    gdoc = np.load(E / "build" / "guides-20.npz", allow_pickle=True)
    gw = F.head_to_world(np.asarray(gdoc["curves_head"]),
                         np.asarray(gdoc["crown"])).astype(np.float32)
    raw = np.asarray(np.load(E / "defect-raw.npz")["points"], dtype=np.float32)
    fin = np.load(E / "build" / "strands.npz", allow_pickle=True)
    fpts = np.asarray(fin["points"], dtype=np.float32)
    frad = np.asarray(fin["radii"], dtype=np.float32)
    gi = np.asarray(fin["guide_idx"], dtype=np.int64)
    ids = json.loads((E / "defect-ids.json").read_text())

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(Path(a.body)))
    grey = mat("diag_body_grey", (0.30, 0.32, 0.35, 1))
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            continue
        low = o.name.lower()
        if "hair" in low and "brow" not in low and "lash" not in low:
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        o.data.materials.clear()
        o.data.materials.append(grey)

    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = 1024
    sc.render.resolution_y = 1024
    sc.render.image_settings.file_format = "PNG"
    sc.render.film_transparent = False
    world = sc.world or bpy.data.worlds.new("WORLD")
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (
        0.015, 0.015, 0.02, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
    for name, loc, energy, size in (
            ("KEY", (-1.5, -2.0, 2.2), 900.0, 2.0),
            ("FILL", (1.5, -2.0, 1.8), 500.0, 2.0),
            ("RIM", (0.0, 2.0, 2.6), 700.0, 1.5)):
        bpy.ops.object.light_add(type="AREA", location=loc)
        lamp = bpy.context.active_object
        lamp.name = name
        lamp.data.energy = energy
        lamp.data.shape = "DISK"
        lamp.data.size = size
    cd = bpy.data.cameras.new("diag_cam")
    cd.sensor_width = float(cams["sensorWidthMm"])
    cam = bpy.data.objects.new("diag_cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam

    mA = mat("guide_cyan", (0.00, 0.95, 1.00, 1))
    mB = mat("raw_magenta", (1.00, 0.10, 0.75, 1))
    mC = mat("final_grey", (0.85, 0.85, 0.88, 1))

    for name, (view, box) in BOXES.items():
        sel = np.asarray(ids[name]["ids"], dtype=np.int64)
        gsel = np.unique(gi[sel][:, 0])
        A = gw[gsel]
        Ar = np.full(A.shape[:2], 0.0004, dtype=np.float32)
        B = raw[sel]
        Br = np.full(B.shape[:2], 0.00005, dtype=np.float32)
        C = fpts[sel]
        Cr = frad[sel]
        rec = cams["views"][view]
        cam.matrix_world = Matrix(rec["matrixWorld"])
        cam.data.lens = float(rec["lensMm"])
        r0, r1, c0, c1 = box
        sc.render.use_border = True
        sc.render.use_crop_to_border = True
        sc.render.border_min_x = c0 / 1024.0
        sc.render.border_max_x = c1 / 1024.0
        sc.render.border_min_y = 1.0 - r1 / 1024.0
        sc.render.border_max_y = 1.0 - r0 / 1024.0
        for panel, P_, R_, m in (("a", A, Ar, mA), ("b", B, Br, mB),
                                 ("c", C, Cr, mC)):
            clear_curves()
            hair_obj(name + panel, P_, R_, m)
            sc.render.filepath = str(E / ("defect-%s-%s.png" % (name, panel)))
            bpy.ops.render.render(write_still=True)
        print("DEFECT %s done (A guides %d, BC strands %d)" % (
            name, len(gsel), len(sel)), flush=True)


if __name__ == "__main__":
    main()
