"""Evidence-only: export the station body mesh (topper excluded) to numpy.

Same import + exclusion rule as the station scene: import the pinned GLB,
drop the mesh whose name carries the topper marker (keeping brow/lash
furniture), keep the largest remaining mesh as the body, write its
world-space vertices and triangle faces. Used for envelope anchoring and
the offline voxel-SDF collision grid.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", required=True)
    parser.add_argument("--out", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(argv)


def main():
    import bpy
    import numpy as np

    args = cli()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(Path(args.glb).resolve()))
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in imported if o.type == "MESH"]
    removed = []
    kept = []
    for obj in meshes:
        lowered = obj.name.lower()
        if "hair" in lowered and "brow" not in lowered and "lash" not in lowered:
            removed.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)
        else:
            kept.append(obj)
    body = max(kept, key=lambda o: len(o.data.vertices))
    mesh = body.data
    verts = np.array(
        [body.matrix_world @ v.co for v in mesh.vertices], dtype=np.float64
    )
    mesh.calc_loop_triangles()
    faces = np.array(
        [
            [mesh.loops[loop_index].vertex_index for loop_index in tri.loops]
            for tri in mesh.loop_triangles
        ],
        dtype=np.int64,
    )
    out = Path(args.out)
    np.savez(
        str(out),
        vertices=verts,
        faces=faces,
        body_object=np.array(body.name),
        removed=np.array(sorted(removed)),
    )
    print(
        "BODY_EXPORT object=%s verts=%d tris=%d removed=%s"
        % (body.name, verts.shape[0], faces.shape[0], sorted(removed)),
        flush=True,
    )


if __name__ == "__main__":
    main()
