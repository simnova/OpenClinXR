#!/usr/bin/env python3
"""Measure GLB topology metrics for TRELLIS escape-hatch comparisons.

Metrics (single consistent definition across HF / control / remesh):
  tris          — total triangles summed across all scene geometry
  verts         — total vertices summed across all scene geometry
  components    — connected components after position-welding vertices at 5dp
  boundary_edges — edges referenced by exactly one face (open-shell tears)
  nonmanifold   — edges referenced by more than two faces

Usage:
  python3 measure_glb_topology.py --glb path/to/model.glb [--out out.json]
"""
import argparse
import json
from collections import Counter

import numpy as np
import trimesh


def measure(glb_path):
    loaded = trimesh.load(glb_path, force="scene")
    if isinstance(loaded, trimesh.Scene):
        geoms = [g for g in loaded.geometry.values() if hasattr(g, "faces")]
    else:
        geoms = [loaded] if hasattr(loaded, "faces") else []

    total_tris = 0
    total_verts = 0
    verts_list = []
    faces_list = []
    offset = 0
    for m in geoms:
        if len(m.faces) == 0:
            continue
        verts_list.append(np.asarray(m.vertices, dtype=np.float64))
        faces_list.append(np.asarray(m.faces, dtype=np.int64) + offset)
        offset += len(m.vertices)
        total_tris += int(len(m.faces))
        total_verts += int(len(m.vertices))

    if not verts_list:
        return {
            "tris": 0,
            "verts": 0,
            "components": 0,
            "boundary_edges": 0,
            "nonmanifold": 0,
        }

    verts = np.concatenate(verts_list, axis=0)
    faces = np.concatenate(faces_list, axis=0)

    # Position-weld at 5 decimal places (matches the compare metric convention).
    key_to_id = {}
    remap = np.empty(len(verts), dtype=np.int64)
    for i in range(len(verts)):
        v = verts[i]
        key = f"{v[0]:.5f},{v[1]:.5f},{v[2]:.5f}"
        if key not in key_to_id:
            key_to_id[key] = len(key_to_id)
        remap[i] = key_to_id[key]
    n_welded = len(key_to_id)

    parent = list(range(n_welded))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    used = set()
    edge_counts = Counter()
    for f in faces:
        a = int(remap[f[0]])
        b = int(remap[f[1]])
        c = int(remap[f[2]])
        union(a, b)
        union(b, c)
        used.update((a, b, c))
        edge_counts[tuple(sorted((a, b)))] += 1
        edge_counts[tuple(sorted((b, c)))] += 1
        edge_counts[tuple(sorted((c, a)))] += 1

    components = len({find(u) for u in used})
    boundary_edges = sum(1 for c in edge_counts.values() if c == 1)
    nonmanifold = sum(1 for c in edge_counts.values() if c > 2)

    return {
        "tris": total_tris,
        "verts": total_verts,
        "components": components,
        "boundary_edges": boundary_edges,
        "nonmanifold": nonmanifold,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", required=True)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    result = {
        "glbPath": args.glb,
        "method": "trimesh scene merge; position-weld at 5dp; edge census (boundary=1 ref, nonmanifold>2 refs)",
        **measure(args.glb),
    }
    text = json.dumps(result, indent=2)
    print(text)
    if args.out:
        with open(args.out, "w") as f:
            f.write(text + "\n")


if __name__ == "__main__":
    main()
