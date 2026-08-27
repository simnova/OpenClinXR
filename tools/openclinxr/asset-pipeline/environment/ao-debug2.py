#!/usr/bin/env python3
"""Debug: dump per-ray hits for the near point."""
from __future__ import annotations
import sys, argparse, importlib.util, math
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
    origin = Vector((2.64, 0.0, 0.0))
    n = Vector((0, 0, 1))
    ref = Vector((1, 0, 0))
    t1 = ref.cross(n).normalized()
    t2 = n.cross(t1).normalized()
    o = origin + n * mod.AO_RAY_ORIGIN_OFFSET
    hits = 0
    for i in range(mod.AO_SAMPLES_PER_RING):
        phi = 2.0 * math.pi * i / mod.AO_SAMPLES_PER_RING
        for tilt_deg in mod.AO_RINGS:
            tilt = math.radians(tilt_deg)
            d = math.cos(tilt) * n + math.sin(tilt) * (math.cos(phi) * t1 + math.sin(phi) * t2)
            d.normalize()
            res = bvh.ray_cast(o, d, mod.AO_REACH_METERS)
            tag = "HIT" if res is not None and res[3] is not None and res[3] >= mod.AO_MIN_HIT_DISTANCE else "open"
            if res is not None and res[3] is not None and res[3] >= mod.AO_MIN_HIT_DISTANCE:
                hits += 1
                print(f"[dbg2] phi={math.degrees(phi):6.1f} tilt={tilt_deg:3.0f} -> HIT dist={res[3]:.3f} loc=({res[0].x:.2f},{res[0].y:.2f},{res[0].z:.2f}) nrm=({res[1].x:.2f},{res[1].y:.2f},{res[1].z:.2f})")
            else:
                print(f"[dbg2] phi={math.degrees(phi):6.1f} tilt={tilt_deg:3.0f} -> open")
    print(f"[dbg2] hits={hits}/48")

if __name__ == "__main__":
    main()
