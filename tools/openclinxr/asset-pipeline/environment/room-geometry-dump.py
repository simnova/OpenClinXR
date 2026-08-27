#!/usr/bin/env python3
"""Dump the geometry structure of a shipped room GLB as Blender sees it."""
from __future__ import annotations
import sys, argparse
import bpy

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.import_scene.gltf(filepath=args.input)
    print(f"[geom] objects={len(bpy.context.scene.objects)}")
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        me = obj.data
        mats = [m.name for m in me.materials if m]
        # world AABB
        mw = obj.matrix_world
        xs = []; ys = []; zs = []
        for v in me.vertices:
            p = mw @ v.co
            xs.append(p.x); ys.append(p.y); zs.append(p.z)
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        print(f"[geom] {obj.name}: tris={tris} faces={len(me.polygons)} verts={len(me.vertices)} mats={mats}")
        print(f"        AABB x[{min(xs):.2f},{max(xs):.2f}] y[{min(ys):.2f},{max(ys):.2f}] z[{min(zs):.2f},{max(zs):.2f}]")
        # coplanar-face proximity: for each face, min distance to any OTHER face plane
        # sample: min distance from each face center to any other face center
        centers = [mw @ p.center for p in me.polygons]
        norms = [mw.to_3x3() @ p.normal for p in me.polygons]
        import math
        close = 0
        for i, c in enumerate(centers):
            for j, d in enumerate(centers):
                if i == j: continue
                dist = (c - d).length
                if dist < 0.35:
                    close += 1
                    break
        print(f"        faces_with_another_face_within_0.35m: {close}/{len(centers)}")

if __name__ == "__main__":
    main()
