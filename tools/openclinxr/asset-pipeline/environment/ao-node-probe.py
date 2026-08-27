#!/usr/bin/env python3
"""Probe: does the Cycles AO SHADER NODE's distance bound a baked EMIT AO? (floor+ceiling plates)"""
from __future__ import annotations
import sys
import bpy

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
mat = bpy.data.materials.new("probe_mat")
mat.use_nodes = True
nt = mat.node_tree

bpy.ops.mesh.primitive_grid_add(size=6.5, x_subdivisions=8, y_subdivisions=8, location=(0, 0, 0))
floor = bpy.context.object; floor.name = "Floor"; floor.data.materials.append(mat)
bpy.ops.mesh.primitive_cube_add(size=6.5, location=(0, 2.675, 0))
ceil = bpy.context.object; ceil.scale = (1.0, 0.05, 1.0); ceil.name = "Ceiling"; ceil.data.materials.append(mat)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 64
scene.render.bake.margin = 4
scene.render.bake.use_clear = True

def bake_with_distance(dist):
    # Rebuild the emission chain with an AO node at the given distance
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = dist
    ao.samples = 32
    emit = nt.nodes.new("ShaderNodeEmission")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(ao.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    img = bpy.data.images.get("ao_img") or bpy.data.images.new("ao_img", 512, 512, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.nodes.active = tex
    for obj in (floor, ceil):
        if "AO_UV" not in obj.data.uv_layers:
            obj.data.uv_layers.new(name="AO_UV")
        obj.data.uv_layers.active = obj.data.uv_layers["AO_UV"]
    bpy.ops.object.select_all(action="DESELECT")
    floor.select_set(True); ceil.select_set(True)
    bpy.context.view_layer.objects.active = floor
    bpy.ops.object.bake(type="EMIT", use_clear=True)
    px = list(img.pixels)
    def lum(u, v):
        return px[(min(511, max(0, int(v*512))) * 512 + min(511, max(0, int(u*512)))) * 4]
    deps = bpy.context.evaluated_depsgraph_get()
    oe = floor.evaluated_get(deps); me = oe.to_mesh()
    lay = me.uv_layers.get("AO_UV") or me.uv_layers[0]
    best, best_d = None, None
    for poly in me.polygons:
        c = poly.center
        dd = c.x**2 + c.y**2
        if best_d is None or dd < best_d:
            us = [lay.data[li].uv for li in poly.loop_indices]
            best = (sum(p.x for p in us)/len(us), sum(p.y for p in us)/len(us))
            best_d = dd
    return lum(*best)

for dist in (0.5, 2.0, 5.0, 20.0):
    v = bake_with_distance(dist)
    print(f"[aonode] ao_node.distance={dist}: floor-center lum={v:.4f}")

if __name__ == "__main__":
    pass
