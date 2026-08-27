#!/usr/bin/env python3
"""Clean probe: floor plate + ceiling plate only. Does the native AO bake respect world distance?"""
from __future__ import annotations
import sys, argparse
import bpy

def main():
    ap = argparse.ArgumentParser()
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    mat = bpy.data.materials.new("probe_mat")
    mat.use_nodes = True

    # Floor plate 6.5x6.5 at y=0 (subdivided grid so we can read a center texel)
    bpy.ops.mesh.primitive_grid_add(size=6.5, x_subdivisions=8, y_subdivisions=8, location=(0, 0, 0))
    floor = bpy.context.object; floor.name = "Floor"; floor.data.materials.append(mat)
    # Ceiling plate 6.5x6.5 at y=2.65
    bpy.ops.mesh.primitive_cube_add(size=6.5, location=(0, 2.675, 0))
    ceil = bpy.context.object; ceil.scale = (1.0, 0.05, 1.0); ceil.name = "Ceiling"; ceil.data.materials.append(mat)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.render.bake.margin = 4
    scene.render.bake.use_clear = True

    def bake_and_read():
        # per-material group bake like the production script: select floor+ceiling, AO_UV active
        for obj in (floor, ceil):
            if "AO_UV" not in obj.data.uv_layers:
                obj.data.uv_layers.new(name="AO_UV")
            obj.data.uv_layers.active = obj.data.uv_layers["AO_UV"]
        bpy.ops.object.select_all(action="DESELECT")
        floor.select_set(True); ceil.select_set(True)
        bpy.context.view_layer.objects.active = floor
        img = bpy.data.images.get("ao_img") or bpy.data.images.new("ao_img", 512, 512, alpha=False)
        img.colorspace_settings.name = "Non-Color"
        # attach image to material so it is the active bake target
        nt = mat.node_tree
        tex = None
        for n in nt.nodes:
            if n.type == "TEX_IMAGE": tex = n
        if tex is None:
            tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.nodes.active = tex
        bpy.ops.object.bake(type="AO", use_clear=True)
        px = list(img.pixels)
        def lum(u, v):
            return px[(min(511, max(0, int(v*512))) * 512 + min(511, max(0, int(u*512)))) * 4]
        deps = bpy.context.evaluated_depsgraph_get()
        oe = floor.evaluated_get(deps); me = oe.to_mesh()
        lay = me.uv_layers.get("AO_UV") or me.uv_layers[0]
        # face center nearest world (0,0)
        best, best_d = None, None
        for poly in me.polygons:
            c = poly.center
            d = c.x**2 + c.y**2
            if best_d is None or d < best_d:
                us = [lay.data[li].uv for li in poly.loop_indices]
                best = (sum(p.x for p in us)/len(us), sum(p.y for p in us)/len(us))
                best_d = d
        return lum(*best)

    for dist in (10.0, 5.0, 2.0, 1.0, 0.5, 0.0):
        scene.world.light_settings.distance = dist
        v = bake_and_read()
        print(f"[probe3] world.distance={dist}: floor-center AO lum={v:.4f}")

if __name__ == "__main__":
    main()
