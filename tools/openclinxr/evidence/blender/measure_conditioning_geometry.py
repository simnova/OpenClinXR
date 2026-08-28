#!/usr/bin/env python3
"""Measure the full #697 conditioning-rubric geometry metric set for one GLB.

Metrics (single consistent definition; matches conditioning-v1.json geometryMetrics):
  boundary_edge_count    edges referenced by exactly one face (open-shell tears)
  is_watertight          boundary_edge_count == 0
  welded_component_count connected components after position-welding vertices at 5dp
  largest_component_share share of welded vertices in the largest component (recorded,
                          NOT a quality predictor — the rubric bars it as a selector)
  signed_volume          divergence-theorem volume (negative sign = inverted/degenerate winding)
  surface_area           summed triangle area
  raw_triangle_count     total triangles across all scene geometry
  raw_bytes              GLB file size on disk
  wall_clock_seconds     caller-supplied bake wall clock (echoed, recorded separately from visual quality)

Usage:
  python3 measure_conditioning_geometry.py --glb path/to/model.glb --wall-clock-s 1234.5 [--out out.json]
"""
import argparse
import json
import math
from collections import Counter

import numpy as np
import trimesh


def measure(glb_path: str, wall_clock_s: float | None) -> dict:
    loaded = trimesh.load(glb_path, force="scene")
    if isinstance(loaded, trimesh.Scene):
        geoms = [g for g in loaded.geometry.values() if hasattr(g, "faces")]
    else:
        geoms = [loaded] if hasattr(loaded, "faces") else []

    total_tris = 0
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

    if not verts_list:
        return {
            "boundary_edge_count": 0,
            "is_watertight": False,
            "welded_component_count": 0,
            "largest_component_share": 0.0,
            "signed_volume": 0.0,
            "surface_area": 0.0,
            "raw_triangle_count": 0,
        }

    verts = np.concatenate(verts_list, axis=0)
    faces = np.concatenate(faces_list, axis=0)

    # Position-weld at 5 decimal places (matches measure_glb_topology.py convention).
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

    components = {}
    for u in used:
        r = find(u)
        components[r] = components.get(r, 0) + 1
    boundary_edges = sum(1 for c in edge_counts.values() if c == 1)
    largest_component_share = (
        max(components.values()) / n_welded if components else 0.0
    )

    # Signed volume via the divergence theorem; negative sign = inverted winding.
    tris = verts[faces]
    v0 = tris[:, 0]
    v1 = tris[:, 1]
    v2 = tris[:, 2]
    signed_volume = float(
        np.einsum("ij,ij->i", v0, np.cross(v1, v2)).sum() / 6.0
    )
    surface_area = float(
        np.linalg.norm(np.cross(v1 - v0, v2 - v0), axis=1).sum() * 0.5
    )

    return {
        "boundary_edge_count": boundary_edges,
        "is_watertight": boundary_edges == 0,
        "welded_component_count": len(components),
        "largest_component_share": round(largest_component_share, 6),
        "signed_volume": round(signed_volume, 6),
        "surface_area": round(surface_area, 6),
        "raw_triangle_count": total_tris,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", required=True)
    parser.add_argument("--wall-clock-s", type=float, default=None)
    parser.add_argument("--raw-bytes", type=int, default=None)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    result = {
        "glbPath": args.glb,
        "method": "trimesh scene merge; position-weld at 5dp; edge census (boundary=1 ref); "
                  "divergence-theorem signed volume; largest component share by welded vertices",
        "raw_bytes": args.raw_bytes,
        "wall_clock_seconds": args.wall_clock_s,
        **measure(args.glb, args.wall_clock_s),
    }
    text = json.dumps(result, indent=2)
    print(text)
    if args.out:
        with open(args.out, "w") as f:
            f.write(text + "\n")


if __name__ == "__main__":
    main()
