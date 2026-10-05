#!/usr/bin/env python3
"""Blender-only Round-6 operations: raw-stage render and collapse decimation."""

from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def args_map():
    raw = sys.argv[sys.argv.index("--") + 1:]
    return {raw[i][2:]: raw[i + 1] for i in range(0, len(raw), 2)}


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def only_mesh():
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"expected one mesh, got {len(meshes)}")
    return meshes[0]


def import_ply(path):
    bpy.ops.wm.ply_import(filepath=str(path))
    return only_mesh()


def bounds(obj):
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return Vector(tuple(min(p[i] for p in points) for i in range(3))), Vector(tuple(max(p[i] for p in points) for i in range(3)))


def normalize(obj, center, extent):
    low, high = bounds(obj)
    scale = extent / max(high - low)
    transform = Matrix.Translation(center) @ Matrix.Diagonal((scale, scale, scale, 1)) @ Matrix.Translation(-(low + high) / 2)
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    obj.data.transform(transform)


def lights():
    world = bpy.data.worlds.new("Studio")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.72, 0.74, 0.76, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    for name, loc, energy, size in (
        ("Key", (2.5, -2.8, 2.4), 250, 2.0),
        ("Fill", (-2.2, -1.5, 1.6), 80, 2.5),
        ("Rim", (0.2, 2.5, 2.0), 60, 1.5),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.size = energy, size
        lamp = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(lamp)
        lamp.location = loc
        lamp.rotation_euler = (Vector((0, 0, 0.5)) - lamp.location).to_track_quat("-Z", "Y").to_euler()


def material(obj, mode):
    mat = bpy.data.materials.new(mode)
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.72
    if mode == "clay":
        bsdf.inputs["Base Color"].default_value = (0.42, 0.45, 0.48, 1)
    else:
        attribute = tree.nodes.new("ShaderNodeVertexColor")
        attribute.layer_name = obj.data.color_attributes.active_color.name
        tree.links.new(attribute.outputs["Color"], bsdf.inputs["Base Color"])
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def camera(center, radius):
    data = bpy.data.cameras.new("PackCam")
    data.lens, data.clip_start, data.clip_end = 50, 0.01, 100
    cam = bpy.data.objects.new("PackCam", data)
    bpy.context.collection.objects.link(cam)
    elev, azim = math.radians(14), math.radians(40)
    cam.location = center + Vector((radius * math.cos(elev) * math.sin(azim), -radius * math.cos(elev) * math.cos(azim), radius * math.sin(elev)))
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam


def render_raw(a):
    obj = import_ply(Path(a["input"]))
    freeze = json.loads(Path(a["freeze"]).read_text())
    center = Vector(freeze["center"])
    normalize(obj, center, float(a["extent"]))
    lights()
    camera(center, float(freeze["radius"]))
    out = Path(a["out"])
    out.mkdir(parents=True, exist_ok=True)
    records = []
    for mode in ("colour", "clay"):
        material(obj, mode)
        scene = bpy.context.scene
        engines = {item.identifier for item in scene.render.bl_rna.properties["engine"].enum_items}
        scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
        scene.render.resolution_x = scene.render.resolution_y = int(a.get("resolution", 1280))
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = str(out / f"raw-fullres-{mode}.png")
        started = time.time()
        bpy.ops.render.render(write_still=True)
        records.append({"mode": mode, "path": scene.render.filepath, "seconds": time.time() - started})
    (out / "render-report.json").write_text(json.dumps({"renders": records}, indent=2) + "\n")


def decimate(a):
    obj = import_ply(Path(a["input"]))
    before = len(obj.data.loop_triangles)
    modifier = obj.modifiers.new("Round6 topology-preserving Collapse", "DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = min(1.0, int(a["target"]) / max(1, len(obj.data.polygons)))
    modifier.use_collapse_triangulate = True
    started = time.time()
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.quads_convert_to_tris(quad_method="BEAUTY", ngon_method="BEAUTY")
    bpy.ops.object.mode_set(mode="OBJECT")
    out = Path(a["out"])
    out.parent.mkdir(parents=True, exist_ok=True)
    obj.select_set(True)
    bpy.ops.wm.ply_export(filepath=str(out), export_selected_objects=True)
    report = {"method": "Blender Collapse (non-sloppy; delimit NORMAL/MATERIAL/SEAM/SHARP/UV disabled)", "trianglesBefore": before, "trianglesAfter": len(obj.data.polygons), "seconds": time.time() - started, "output": str(out)}
    Path(a["report"]).write_text(json.dumps(report, indent=2) + "\n")


def main():
    a = args_map()
    clear()
    if a["mode"] == "render-raw":
        render_raw(a)
    elif a["mode"] == "decimate":
        decimate(a)
    else:
        raise ValueError(a["mode"])


main()
