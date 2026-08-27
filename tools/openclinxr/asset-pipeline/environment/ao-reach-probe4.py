#!/usr/bin/env python3
"""Empirical reach of the native Cycles AO bake: a wall plate at distance d from a floor sample."""
from __future__ import annotations
import sys, argparse
import bpy

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", type=float)
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    mat = bpy.data.materials.new("probe_mat")
    mat.use_nodes = True

    bpy.ops.mesh.primitive_grid_add(size=12, x_subdivisions=16, y_subdivisions=16, location=(0, 0, 0))
    floor = bpy.context.object; floor.name = "Floor"; floor.data.materials.append(mat)
    # wall plate: 4 x 2.65 m, at x = args.dist, standing on the floor
    d = args.dist
    bpy.ops.mesh.primitive_cube_add(size=1, location=(d, 1.325, 0))
    wall = bpy.context.object; wall.scale = (0.05, 2.65, 4.0); wall.name = "Wall"; wall.data.materials.append(mat)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 64
    scene.render.bake.margin = 4
    scene.render.bake.use_clear = True

    for obj in (floor, wall):
        if "AO_UV" not in obj.data.uv_layers:
            obj.data.uv_layers.new(name="AO_UV")
        obj.data.uv_layers.active = obj.data.uv_layers["AO_UV"]
    bpy.ops.object.select_all(action="DESELECT")
    floor.select_set(True); wall.select_set(True)
    bpy.context.view_layer.objects.active = floor
    img = bpy.data.images.get("ao_img") or bpy.data.images.new("ao_img", 512, 512, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    nt = mat.node_tree
    tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
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
    # face center nearest world (0.5, 0) -> 0.5 m from the wall at x=d (sample at x=0.5 when d=1.0 etc.)
    sx = 0.5
    best, best_d = None, None
    for poly in me.polygons:
        c = poly.center
        dd = (c.x - sx)**2 + c.y**2
        if best_d is None or dd < best_d:
            us = [lay.data[li].uv for li in poly.loop_indices]
            best = (sum(p.x for p in us)/len(us), sum(p.y for p in us)/len(us))
            best_d = dd
    val = lum(*best)
    print(f"[probe4] wall_at={d} sample_at={sx} (gap={d - 0.05 - sx:.2f}m) floor lum={val:.4f}")

if __name__ == "__main__":
    main()
