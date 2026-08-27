#!/usr/bin/env python3
"""Debug: does bounded_ao_at darken a floor point near a wall in the closed box?"""
from __future__ import annotations
import sys, argparse, importlib.util
import bpy
from mathutils import Vector

def load_bake_module(path):
    spec = importlib.util.spec_from_file_location("room_occlusion_bake", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def build_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    mat = bpy.data.materials.new("locality_floor")
    mat.use_nodes = True
    bpy.ops.mesh.primitive_grid_add(size=6.5, x_subdivisions=16, y_subdivisions=16, location=(0, 0, 0))
    floor = bpy.context.object; floor.name = "Floor"; floor.data.materials.append(mat)
    for (name, loc, scale) in (
        ("WallPx", (3.275, 1.325, 0), (0.05, 2.65, 6.5)),
        ("WallNx", (-3.275, 1.325, 0), (0.05, 2.65, 6.5)),
        ("WallPz", (0, 1.325, 3.275), (6.5, 2.65, 0.05)),
        ("WallNz", (0, 1.325, -3.275), (6.5, 2.65, 0.05)),
    ):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        obj = bpy.context.object; obj.name = name; obj.scale = scale; obj.data.materials.append(mat)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 2.675, 0))
    ceil = bpy.context.object; ceil.scale = (6.5, 0.05, 6.5); ceil.name = "Ceiling"; ceil.data.materials.append(mat)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bake-script", required=True)
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    mod = load_bake_module(args.bake_script)
    build_scene()
    bvh = mod.build_scene_bvh()
    print(f"[dbg] bvh built: tris in bvh ok")
    import math, random
    rng = random.Random(mod.AO_SAMPLE_SEED)
    # near floor point 0.6m from the +X wall (wall face at x=3.25)
    for pt in ((2.64, 0.2, 0.0), (2.64, 0.0, 0.0), (0.2, 0.2, 0.0)):
        origin = Vector(pt)
        normal = Vector((0, 0, 1))
        val = mod.bounded_ao_at(bvh, origin, normal, rng.random() * 2 * math.pi)
        print(f"[dbg] point {pt} -> ao={val:.4f}")
    # direct ray test: from near point toward the wall
    origin = Vector((2.64, 0.0, 0.0))
    direction = Vector((1, 0, 0.17)).normalized()
    res = bvh.ray_cast(origin, direction, 2.0)
    print(f"[dbg] ray toward wall: {res}")
    direction2 = Vector((0, 0, 1)).normalized()
    res2 = bvh.ray_cast(origin, direction2, 2.0)
    print(f"[dbg] ray straight up: {res2}")
    direction3 = Vector((1, 0, 0.5)).normalized()
    res3 = bvh.ray_cast(origin, direction3, 2.0)
    print(f"[dbg] ray up+toward wall 26deg: {res3}")

if __name__ == "__main__":
    main()
