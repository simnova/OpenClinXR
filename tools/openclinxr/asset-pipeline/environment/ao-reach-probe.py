#!/usr/bin/env python3
"""Probe: what reach does the native Cycles AO bake actually use, and what made the shipped caves?"""
from __future__ import annotations

import importlib.util
import sys

import bpy


def _argv_after_double_dash():
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]


def load_bake_module(path):
    spec = importlib.util.spec_from_file_location("room_occlusion_bake", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def closed_box():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    mat = bpy.data.materials.new("probe_mat")
    mat.use_nodes = True
    # floor 6.5x6.5 at y=0, walls 2.65 tall, ceiling at 2.65
    bpy.ops.mesh.primitive_cube_add(size=6.5, location=(0, 0, 0))
    floor = bpy.context.object
    floor.scale = (1.0, 0.02, 1.0)
    floor.name = "Floor"
    floor.data.materials.append(mat)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 1.325, 0))
    wall = bpy.context.object
    wall.scale = (6.5, 2.65, 0.05)
    wall.name = "Wall"
    wall.data.materials.append(mat)
    bpy.ops.mesh.primitive_cube_add(size=6.5, location=(0, 2.65, 0))
    ceil = bpy.context.object
    ceil.scale = (1.0, 0.02, 1.0)
    ceil.name = "Ceiling"
    ceil.data.materials.append(mat)


def main():
    ap = __import__("argparse").ArgumentParser()
    ap.add_argument("--bake-script", required=True)
    args = ap.parse_args(_argv_after_double_dash())
    mod = load_bake_module(args.bake_scipt if False else args.bake_script)

    closed_box()
    mod.setup_scene()
    scene = bpy.context.scene
    print(f"[probe] distance={scene.world.light_settings.distance if scene.world else 'NO_WORLD'}")
    print(f"[probe] max_ray_distance={scene.render.bake.max_ray_distance} samples={scene.cycles.samples}")

    results = mod.bake_ao_per_material(512)
    img = bpy.data.images.get(results["probe_mat"]["image"])
    W, H = img.size
    px = list(img.pixels)
    def lum(u, v):
        xi = min(W - 1, max(0, int(u * W)))
        yi = min(H - 1, max(0, int(v * H)))
        return px[(yi * W + xi) * 4]

    # Find a floor face near the wall and one at the center via the AO_UV layer.
    deps = bpy.context.evaluated_depsgraph_get()
    floor = bpy.data.objects["Floor"]
    lay = floor.data.uv_layers.get("AO_UV") or floor.data.uv_layers[0]
    oe = floor.evaluated_get(deps)
    me = oe.to_mesh()
    mw = floor.matrix_world
    def uv_for_world(x, z):
        best, best_d = None, None
        for poly in me.polygons:
            c = mw @ poly.center
            d = (c.x - x) ** 2 + (c.z - z) ** 2
            if best_d is None or d < best_d:
                us = [lay.data[li].uv for li in poly.loop_indices]
                best = (sum(p.x for p in us) / len(us), sum(p.y for p in us) / len(us))
                best_d = d
        return best
    center_uv = uv_for_world(0, 0)          # 3.25 m from every wall
    near_uv = uv_for_world(0.6, 0)          # 0.6 m from the wall
    print(f"[probe] floor center lum={lum(*center_uv):.4f} near-wall lum={lum(*near_uv):.4f}")

    # Now force distance = 0 (unlimited) and re-bake
    if scene.world:
        scene.world.light_settings.distance = 0.0
        results2 = mod.bake_ao_per_material(512)
        img2 = bpy.data.images.get(results2["probe_mat"]["image"])
        px2 = list(img2.pixels)
        def lum2(u, v):
            xi = min(W - 1, max(0, int(u * W)))
            yi = min(H - 1, max(0, int(v * H)))
            return px2[(yi * W + xi) * 4]
        print(f"[probe] after distance=0: floor center lum={lum2(*center_uv):.4f} near-wall lum={lum2(*near_uv):.4f}")


if __name__ == "__main__":
    main()
